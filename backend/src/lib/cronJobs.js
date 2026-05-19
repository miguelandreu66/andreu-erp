// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Cron Jobs (operación propia)
// El módulo broker se separó al sistema VIVO.
// ════════════════════════════════════════════════════════════════

const cron = require('node-cron');
const db   = require('../db');
const { evaluarReglas, persistirAlertas } = require('./commandAi/rules');
const { guardarSnapshot }     = require('./commandAi/scoring');
const { recomputarBaselines } = require('./commandAi/diesel');
const { briefingEjecutivo }   = require('./commandAi/comercial');
const auditorIA               = require('./commandAi/auditorIA');

const TZ = process.env.CRON_TZ || 'America/Mexico_City';
const JOBS = new Map();

async function logJob(nombre, resultado, error = null, manual = false) {
  try {
    await db.query(`
      INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
      VALUES (NULL, $1, 'cron', $2, $3)
    `, [
      `cron_${nombre}${manual ? '_manual' : ''}`,
      { resultado, error: error?.message || null },
      manual ? 'manual' : 'scheduler',
    ]);
  } catch (e) {
    console.warn('cron audit log skip:', e.message);
  }
}

const TAREAS = {
  evaluar_reglas: {
    schedule: '*/5 * * * *',
    descripcion: 'Evaluar motor de reglas y persistir nuevas alertas',
    ejecutar: async () => {
      const candidatas = await evaluarReglas();
      return await persistirAlertas(candidatas);
    },
  },
  scoring_snapshot: {
    schedule: '0 6 * * *',
    descripcion: 'Guardar snapshot diario de scoring de operadores (30 días)',
    ejecutar: () => guardarSnapshot(30),
  },
  briefing_diario: {
    schedule: '0 8 * * *',
    descripcion: 'Generar briefing ejecutivo del día',
    ejecutar: async () => {
      const b = await briefingEjecutivo();
      return {
        generado_en: b.generado_en,
        alertas_criticas: b.metricas?.alertas_criticas || 0,
        clientes_activos: b.metricas?.clientes_activos || 0,
        recomendaciones: b.recomendaciones?.length || 0,
      };
    },
  },
  diesel_baselines: {
    schedule: '0 3 * * 1',
    descripcion: 'Recalcular baselines de rendimiento diesel (semanal lunes)',
    ejecutar: () => recomputarBaselines(),
  },
  cfdi_reintentos: {
    schedule: '*/15 * * * *',
    descripcion: 'Reintentar CFDIs fallidos automáticamente (cada 15 min, max 3 reintentos)',
    ejecutar: async () => {
      const { rows: pendientes } = await db.query(`
        SELECT c.id, c.viaje_id,
          (SELECT COUNT(*) FROM cfdi_eventos WHERE cfdi_id = c.id AND evento = 'error_pac')::int AS intentos
        FROM cfdi_emitidos c
        WHERE c.estado = 'fallido'
          AND c.viaje_id IS NOT NULL
          AND c.created_at > NOW() - INTERVAL '24 hours'
        LIMIT 10
      `);
      const elegibles = pendientes.filter(p => (p.intentos || 0) < 3);
      let exitos = 0, fallidos = 0;
      for (const p of elegibles) {
        try {
          const facturama = require('./fiscal/facturama');
          const builder = require('./fiscal/cfdiBuilder');
          if (!await facturama.isAvailable()) break;

          const { rows: [viaje] } = await db.query('SELECT * FROM viajes WHERE id = $1', [p.viaje_id]);
          if (!viaje) { fallidos++; continue; }
          const { rows: [cliente] } = await db.query('SELECT * FROM clientes WHERE id = $1', [viaje.cliente_id]);
          if (!cliente) { fallidos++; continue; }

          const { payload } = await builder.construirPayload({ viaje, cliente });
          const resp = await facturama.emitirCfdi(payload);
          const uuid = resp.Complement?.TaxStamp?.Uuid || resp.Id || null;
          const facturamaId = resp.Id || null;

          let xmlBuf = null, pdfBuf = null;
          if (facturamaId) {
            try { xmlBuf = await facturama.descargarXml(facturamaId); } catch {}
            try { pdfBuf = await facturama.descargarPdf(facturamaId); } catch {}
          }

          await db.query(`
            UPDATE cfdi_emitidos
            SET estado = 'emitido', uuid_fiscal = $1, fecha_emision = NOW(),
                pac_respuesta = $2, xml_bytes = $3, pdf_bytes = $4,
                error_mensaje = NULL, updated_at = NOW()
            WHERE id = $5
          `, [uuid, resp, xmlBuf, pdfBuf, p.id]);

          await db.query(`UPDATE viajes SET facturado = true, cfdi_id = $1 WHERE id = $2`, [p.id, viaje.id]);
          await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle) VALUES ($1, 'reintento_exitoso', $2)`,
            [p.id, { uuid, intentos: p.intentos + 1 }]);
          exitos++;
        } catch (e) {
          await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle) VALUES ($1, 'reintento_fallido', $2)`,
            [p.id, { error: e.message, intentos: p.intentos + 1 }]);
          fallidos++;
        }
      }
      return { reintentos: elegibles.length, exitos, fallidos };
    },
  },
  auditor_ia_semanal: {
    schedule: '0 7 * * 1',
    descripcion: 'Auditor IA semanal — Claude analiza módulos y emite hallazgos (lunes 7 AM)',
    ejecutar: async () => {
      const { rows: [{ valor: activo }] } = await db.query(`
        SELECT valor FROM configuracion_empresa WHERE clave = 'auditor_ia_activo'
      `);
      if (activo !== 'true') {
        return { skipped: true, motivo: 'auditor_ia_activo=false' };
      }
      const r = await auditorIA.ejecutarAuditoria({ tipo: 'programada' });
      return {
        ejecucion_id: r.ejecucion_id,
        hallazgos: r.hallazgos_insertados,
        costo_usd: r.costo_usd.toFixed(4),
        modelo: r.modelo,
      };
    },
  },
};

function iniciar() {
  if (process.env.ENABLE_CRON === 'false') {
    console.log('[CRON] Deshabilitado por ENABLE_CRON=false');
    return;
  }

  for (const [nombre, def] of Object.entries(TAREAS)) {
    const job = cron.schedule(def.schedule, async () => {
      const t0 = Date.now();
      console.log(`[CRON] ${nombre} iniciando...`);
      try {
        const r = await def.ejecutar();
        const ms = Date.now() - t0;
        console.log(`[CRON] ${nombre} OK (${ms}ms):`, JSON.stringify(r));
        await logJob(nombre, { ...r, duracion_ms: ms });
      } catch (e) {
        console.error(`[CRON] ${nombre} ERROR:`, e.message);
        await logJob(nombre, null, e);
      }
    }, { timezone: TZ, scheduled: true });

    JOBS.set(nombre, job);
  }

  console.log(`[CRON] ${JOBS.size} job(s) programados (timezone: ${TZ}):`);
  for (const [nombre, def] of Object.entries(TAREAS)) {
    console.log(`  - ${nombre}: ${def.schedule} — ${def.descripcion}`);
  }
}

function estado() {
  return Object.entries(TAREAS).map(([nombre, def]) => ({
    nombre,
    schedule: def.schedule,
    descripcion: def.descripcion,
    activo: JOBS.has(nombre),
  }));
}

async function disparar(nombre, usuarioId = null) {
  const def = TAREAS[nombre];
  if (!def) throw new Error(`Job no encontrado: ${nombre}`);
  const t0 = Date.now();
  try {
    const r = await def.ejecutar();
    const ms = Date.now() - t0;
    await logJob(nombre, { ...r, duracion_ms: ms, ejecutado_por: usuarioId }, null, true);
    return { ok: true, duracion_ms: ms, resultado: r };
  } catch (e) {
    await logJob(nombre, null, e, true);
    throw e;
  }
}

module.exports = { iniciar, estado, disparar, tareasDisponibles: () => Object.keys(TAREAS) };
