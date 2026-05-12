const cron = require('node-cron');
const db   = require('../db');
const { evaluarReglas, persistirAlertas } = require('./commandAi/rules');
const { guardarSnapshot }     = require('./commandAi/scoring');
const { recomputarBaselines } = require('./commandAi/diesel');
const { briefingEjecutivo }   = require('./commandAi/comercial');

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
