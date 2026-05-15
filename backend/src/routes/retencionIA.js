const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const retencion = require('../lib/commandAi/retencionIA');

const ROLES_LECTURA = ['director','admin','caja'];
const ROLES_ESCRITURA = ['director','admin'];

// Dashboard
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows: [funnel] } = await db.query('SELECT * FROM retencion_funnel');

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'enviada')::int                            AS enviadas_30d,
        COUNT(*) FILTER (WHERE estado = 'fallida')::int                            AS fallidas_30d,
        COUNT(*) FILTER (WHERE cliente_recupero = true)::int                       AS recuperados_30d,
        COUNT(*) FILTER (WHERE cliente_respondio = true)::int                      AS respondieron_30d
      FROM cliente_acciones_retencion
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const { rows: porTipo } = await db.query(`
      SELECT tipo_accion, COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE estado = 'enviada')::int AS enviadas,
             COUNT(*) FILTER (WHERE cliente_recupero = true)::int AS recuperados
      FROM cliente_acciones_retencion
      WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY tipo_accion
      ORDER BY n DESC
    `);

    const { rows: [cfg0] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'retencion_activa'`);

    res.json({
      funnel,
      stats,
      por_tipo_accion: porTipo,
      activa: cfg0?.valor === 'true',
    });
  } catch (e) {
    console.error('retencion dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Segmentos: clientes por clasificación
router.get('/segmentos/:clasif', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT cs.*, c.nombre, c.telefono, c.email, c.tipo
      FROM cliente_scoring_actual cs
      JOIN clientes c ON c.id = cs.cliente_id
      WHERE cs.clasificacion = $1
      ORDER BY cs.score_retencion DESC NULLS LAST
      LIMIT 200
    `, [req.params.clasif]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Listar acciones
router.get('/acciones', auth(ROLES_LECTURA), async (req, res) => {
  const { tipo, estado, cliente_id, limit = 100 } = req.query;
  const where = []; const params = [];
  if (tipo)       { params.push(tipo);       where.push(`a.tipo_accion = $${params.length}`); }
  if (estado)     { params.push(estado);     where.push(`a.estado = $${params.length}`); }
  if (cliente_id) { params.push(cliente_id); where.push(`a.cliente_id = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));
  try {
    const { rows } = await db.query(`
      SELECT a.*, c.nombre AS cliente_nombre, c.tipo AS cliente_tipo
      FROM cliente_acciones_retencion a
      JOIN clientes c ON c.id = a.cliente_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Detalle de una acción
router.get('/acciones/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [a] } = await db.query(`
      SELECT a.*, c.nombre AS cliente_nombre, c.tipo AS cliente_tipo,
             c.telefono, c.email,
             s.viajes_30d, s.viajes_90d, s.viajes_total, s.ingresos_total,
             s.cambio_ingresos_pct, s.dias_sin_actividad, s.ltv
      FROM cliente_acciones_retencion a
      JOIN clientes c ON c.id = a.cliente_id
      LEFT JOIN cliente_scoring_retencion s ON s.id = a.scoring_id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'No encontrada' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Disparar ciclo manual (solo director)
router.post('/correr-ciclo', auth(['director']), async (req, res) => {
  try {
    const soloScoring = req.body?.solo_scoring === true;
    const r = await retencion.correrCicloDiario({ soloScoring });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
        VALUES ($1, 'retencion_ciclo_manual', 'sistema', $2, $3)
      `, [req.usuario.id, r, req.ip]);
    } catch (_) {}

    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ejecutar acción manual para un cliente
router.post('/cliente/:cliente_id/accion', auth(ROLES_ESCRITURA), async (req, res) => {
  const { tipo_accion, mensaje, canal, desc_pct } = req.body || {};
  try {
    const { rows: [cliente] } = await db.query('SELECT * FROM clientes WHERE id = $1', [req.params.cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const cfg = await retencion.leerConfig();
    if (canal) cfg.retencion_canal_default = canal;

    // Score reciente
    const scoring = await retencion.calcularScoringCliente(cliente.id, cfg);
    if (!scoring) return res.status(400).json({ error: 'Cliente sin historial' });

    const accion = retencion.decidirAccion(tipo_accion ? scoring.clasificacion : scoring.clasificacion);
    const accionOverride = tipo_accion ? { tipo: tipo_accion, desc_pct: parseFloat(desc_pct || 0) } : accion;
    if (!accionOverride) return res.status(400).json({ error: 'Cliente "estable" — no requiere acción' });

    const r = await retencion.ejecutarAccion({
      cliente, scoring, scoringId: null, accion: accionOverride, cfg, mensaje,
    });
    res.json(r);
  } catch (e) {
    console.error('accion manual:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Configuración
router.get('/configuracion', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'retencion_%' ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion', auth(['director']), async (req, res) => {
  const body = req.body || {};
  try {
    let n = 0;
    for (const [k, v] of Object.entries(body)) {
      if (!k.startsWith('retencion_')) continue;
      const valor = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      await db.query(`
        INSERT INTO configuracion_empresa (clave, valor, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
      `, [k, valor]);
      n++;
    }
    res.json({ ok: true, actualizados: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
