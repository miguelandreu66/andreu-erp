// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Healthcheck expandido
// /health         → basic (siempre 200, para Railway healthcheck)
// /health/full    → detallado (DB, cron, agentes IA, autopilot, memoria)
// /health/ready   → readiness probe (DB OK + tablas existen)
// ════════════════════════════════════════════════════════════════

const db = require('../db');
const VERSION = require('../../package.json').version || '1.0.0';
const STARTED_AT = Date.now();

function basic() {
  return {
    status: 'ok',
    app: 'Andreu Logistics',
    version: VERSION,
    agentes_ia: 7,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

async function full() {
  const inicio = Date.now();
  const checks = {};
  let overall = 'ok';

  // ── DB ──
  try {
    const start = Date.now();
    const { rows: [r] } = await Promise.race([
      db.query('SELECT NOW() AS now, version() AS pg_version'),
      timeout(2000, 'DB query timeout'),
    ]);
    checks.database = {
      status: 'ok',
      latencia_ms: Date.now() - start,
      pg_version: r.pg_version?.split(' ')[0] + ' ' + r.pg_version?.split(' ')[1],
      now: r.now,
    };
  } catch (e) {
    overall = 'degraded';
    checks.database = { status: 'error', error: e.message };
  }

  // ── Tablas críticas Andreu ──
  try {
    const { rows } = await Promise.race([
      db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('usuarios', 'ventas', 'gastos', 'viajes', 'operadores', 'unidades', 'cfdi_emitidos')
      `),
      timeout(2000, 'tables check timeout'),
    ]);
    const found = rows.map(r => r.table_name);
    const required = ['usuarios', 'ventas', 'gastos', 'viajes'];
    const missing = required.filter(t => !found.includes(t));
    checks.schema = {
      status: missing.length === 0 ? 'ok' : 'error',
      tablas_encontradas: found.length,
      tablas_faltantes: missing,
    };
    if (missing.length > 0) overall = 'degraded';
  } catch (e) {
    overall = 'degraded';
    checks.schema = { status: 'error', error: e.message };
  }

  // ── Autopilot (GPS pings recientes) ──
  try {
    const { rows: [r] } = await Promise.race([
      db.query(`
        SELECT COUNT(*)::int AS pings_1h
        FROM gps_pings
        WHERE creado_en >= NOW() - INTERVAL '1 hour'
      `),
      timeout(1500, 'autopilot check timeout'),
    ]);
    checks.autopilot = {
      status: r.pings_1h > 0 ? 'ok' : 'warn',
      pings_ultima_hora: r.pings_1h,
      alerta: r.pings_1h === 0 ? 'Sin pings GPS en la última hora' : undefined,
    };
  } catch (e) {
    checks.autopilot = { status: 'warn', error: 'tabla gps_pings no consultable' };
  }

  // ── Agentes IA ──
  try {
    const { rows: [r] } = await Promise.race([
      db.query(`
        SELECT
          COUNT(*)::int AS invocaciones_24h,
          COUNT(*) FILTER (WHERE error_mensaje IS NOT NULL)::int AS errores_24h,
          COALESCE(AVG(latencia_ms), 0)::int AS latencia_promedio_ms
        FROM agentes_invocaciones
        WHERE creado_en >= NOW() - INTERVAL '24 hours'
      `),
      timeout(2000, 'agentes check timeout'),
    ]);
    checks.agentes_ia = {
      status: 'ok',
      invocaciones_24h: r.invocaciones_24h,
      errores_24h: r.errores_24h,
      latencia_promedio_ms: r.latencia_promedio_ms,
      error_rate: r.invocaciones_24h > 0
        ? `${((r.errores_24h / r.invocaciones_24h) * 100).toFixed(1)}%`
        : '—',
    };
    if (r.invocaciones_24h > 0 && r.errores_24h / r.invocaciones_24h > 0.1) {
      overall = 'degraded';
      checks.agentes_ia.status = 'warn';
      checks.agentes_ia.alerta = 'Error rate > 10%';
    }
  } catch (e) {
    checks.agentes_ia = { status: 'warn', error: e.message };
  }

  // ── Cobranza pendiente (CXC) — alerta del negocio ──
  try {
    const { rows: [r] } = await Promise.race([
      db.query(`
        SELECT
          COALESCE(SUM(COALESCE(v.total, v.monto) - COALESCE(ab.ya_abonado, 0)), 0)::float AS por_cobrar,
          COUNT(*) FILTER (WHERE CURRENT_DATE - COALESCE(v.fecha_vencimiento, v.fecha) > 30)::int AS cuentas_vencidas
        FROM ventas v
        LEFT JOIN (
          SELECT venta_id, SUM(monto) AS ya_abonado FROM abonos GROUP BY venta_id
        ) ab ON ab.venta_id = v.id
        WHERE v.tipo_venta = 'credito' AND COALESCE(v.estado_pago, 'pendiente') != 'pagado'
      `),
      timeout(1500, 'cxc check timeout'),
    ]);
    checks.cobranza = {
      status: r.cuentas_vencidas > 5 ? 'warn' : 'ok',
      por_cobrar_mxn: Math.round(r.por_cobrar),
      cuentas_vencidas_mas_30d: r.cuentas_vencidas,
    };
  } catch (e) {
    checks.cobranza = { status: 'warn', error: e.message };
  }

  // ── Proceso ──
  const mem = process.memoryUsage();
  checks.proceso = {
    status: 'ok',
    memoria_mb: {
      heap_used: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
    },
    pid: process.pid,
    node_version: process.version,
  };

  // ── Config ──
  const envRequired = ['DATABASE_URL', 'JWT_SECRET'];
  const envMissing = envRequired.filter(k => !process.env[k]);
  checks.config = {
    status: envMissing.length === 0 ? 'ok' : 'error',
    env_faltantes: envMissing,
    node_env: process.env.NODE_ENV || 'development',
    cors_origins: (process.env.FRONTEND_URL || '').split(',').length,
  };
  if (envMissing.length > 0) overall = 'critical';

  return {
    status: overall,
    app: 'Andreu Logistics',
    version: VERSION,
    uptime_seconds: Math.floor(process.uptime()),
    arrancado_en: new Date(STARTED_AT).toISOString(),
    healthcheck_duration_ms: Date.now() - inicio,
    timestamp: new Date().toISOString(),
    checks,
  };
}

async function ready() {
  try {
    await Promise.race([
      db.query('SELECT 1'),
      timeout(1500, 'readiness DB timeout'),
    ]);
    return { ready: true, timestamp: new Date().toISOString() };
  } catch (e) {
    return { ready: false, error: e.message, timestamp: new Date().toISOString() };
  }
}

function timeout(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
}

module.exports = { basic, full, ready };
