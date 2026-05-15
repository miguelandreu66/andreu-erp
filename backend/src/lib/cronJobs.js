const cron = require('node-cron');
const db   = require('../db');
const { evaluarReglas, persistirAlertas } = require('./commandAi/rules');
const { guardarSnapshot }     = require('./commandAi/scoring');
const { recomputarBaselines } = require('./commandAi/diesel');
const { briefingEjecutivo }   = require('./commandAi/comercial');
const auditorIA               = require('./commandAi/auditorIA');
const vendedorIA              = require('./commandAi/vendedorIA');
const retencionIA             = require('./commandAi/retencionIA');
const atraccionIA             = require('./commandAi/atraccionIA');

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
      // Busca fallidos con menos de 3 intentos y los reintenta
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
          // Re-emitir: borra el fallido y vuelve a intentar
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
  atraccion_ia_semanal: {
    schedule: '0 10 * * 1',
    descripcion: 'Atracción IA — genera post LinkedIn / blog / boletín automático (lunes 10 AM)',
    ejecutar: async () => {
      return await atraccionIA.correrCicloSemanal();
    },
  },
  retencion_ia_diario: {
    schedule: '0 9 * * *',
    descripcion: 'Retención IA — scoring de clientes + acciones (9 AM diario, respeta horario)',
    ejecutar: async () => {
      return await retencionIA.correrCicloDiario();
    },
  },
  vendedor_ia_drip: {
    schedule: '*/30 * * * *',
    descripcion: 'Procesar drip campaigns del Vendedor IA (cada 30 min, respeta horario configurado)',
    ejecutar: async () => {
      return await vendedorIA.procesarDripPendientes();
    },
  },
  auditor_ia_semanal: {
    schedule: '0 7 * * 1',
    descripcion: 'Auditor IA semanal — Claude analiza 8 módulos y emite hallazgos (lunes 7 AM)',
    ejecutar: async () => {
      // Verificar si está activo
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
  broker_cashflow_watchdog: {
    schedule: '30 6 * * *',
    descripcion: 'Marcar pagos vencidos a transportistas y registrar exposición de cashflow del día',
    ejecutar: async () => {
      // 1) Marcar pagos vencidos
      const { rows: [{ broker_marcar_vencidos: nVencidos }] } = await db.query('SELECT broker_marcar_vencidos()');

      // 2) Snapshot de exposición + alertas críticas en audit_log
      const { rows: [exp] } = await db.query('SELECT * FROM broker_cashflow_exposicion');
      const { rows: clientes } = await db.query('SELECT * FROM broker_concentracion_clientes LIMIT 3');
      const { rows: transps  } = await db.query('SELECT * FROM broker_concentracion_transportistas LIMIT 3');

      const { rows: cfgs } = await db.query(`
        SELECT clave, valor FROM configuracion_empresa
        WHERE clave IN ('broker_alerta_concentracion_cliente_pct','broker_alerta_concentracion_transportista_pct')
      `);
      const cfg = Object.fromEntries(cfgs.map(c => [c.clave, parseFloat(c.valor)]));

      const alertasCriticas = [];
      if (exp.exposicion_neta > 50000) {
        alertasCriticas.push({ tipo: 'cashflow_negativo', monto: exp.exposicion_neta });
      }
      clientes.forEach(c => {
        if (c.pct_volumen >= (cfg.broker_alerta_concentracion_cliente_pct || 25) * 1.5) {
          alertasCriticas.push({ tipo: 'concentracion_cliente_critica', empresa: c.empresa, pct: c.pct_volumen });
        }
      });
      transps.forEach(t => {
        if (t.pct_volumen >= (cfg.broker_alerta_concentracion_transportista_pct || 30) * 1.5) {
          alertasCriticas.push({ tipo: 'concentracion_transportista_critica', transportista: t.transportista, pct: t.pct_volumen });
        }
      });

      return {
        pagos_marcados_vencidos: nVencidos,
        exposicion_neta: Math.round(exp.exposicion_neta || 0),
        pendiente_cobrar_cliente: Math.round(exp.pendiente_cobrar_cliente || 0),
        pendiente_pagar_transportista: Math.round(exp.pendiente_pagar_transportista || 0),
        operaciones_activas: exp.operaciones_activas,
        alertas_criticas: alertasCriticas,
      };
    },
  },
  filtro_transportistas: {
    schedule: '15 4 * * *',
    descripcion: 'Degradar transportistas con docs críticos vencidos y avisar próximas revisiones',
    ejecutar: async () => {
      // 1) Degradar verificados que ahora tienen docs críticos vencidos → en_revision
      const { rows: degradados } = await db.query(`
        UPDATE transportistas_externos t
        SET estado_verificacion = 'en_revision', updated_at = NOW()
        FROM transportistas_checklist chk
        WHERE chk.transportista_id = t.id
          AND t.estado_verificacion = 'verificado'
          AND chk.tiene_docs_vencidos_criticos = true
        RETURNING t.id, t.razon_social
      `);

      // 2) Marcar fecha_proxima_revision vencida → en_revision
      const { rows: revisiones } = await db.query(`
        UPDATE transportistas_externos
        SET estado_verificacion = 'en_revision', updated_at = NOW()
        WHERE estado_verificacion = 'verificado'
          AND fecha_proxima_revision IS NOT NULL
          AND fecha_proxima_revision <= CURRENT_DATE
        RETURNING id, razon_social
      `);

      // 3) Recalcular score de todos los activos
      await db.query(`
        UPDATE transportistas_externos
        SET score_automatico = LEAST(100, GREATEST(0,
              (calificacion * 10) +
              (total_viajes_completados * 2) -
              (total_incidentes * 15)
            )),
            updated_at = NOW()
        WHERE activo = true
      `);

      return {
        degradados_por_docs_vencidos: degradados.length,
        degradados_por_revision_anual: revisiones.length,
        muestra_degradados: degradados.slice(0, 5).map(d => d.razon_social),
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
