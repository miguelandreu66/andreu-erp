// Andreu Logistics — Routes de Agentes IA (7 agentes)

const router = require('express').Router();
const auth = require('../middleware/auth');
const db = require('../db');
const { invocarAgente, listarAgentes, obtenerAgente } = require('../lib/agents/orchestrator');

require('../lib/agents/_registry');

const ROLES = ['director','admin','caja','logistica'];
const ROLES_DIRECTIVOS = ['director','admin'];

router.get('/', auth(ROLES), (_req, res) => {
  res.json({ agentes: listarAgentes() });
});

router.get('/:nombre', auth(ROLES), (req, res) => {
  try {
    const a = obtenerAgente(req.params.nombre);
    res.json({
      nombre: req.params.nombre,
      titulo: a.titulo,
      descripcion: a.descripcion,
      rol: a.rol,
      modelo: a.modelo,
      emoji: a.emoji,
      tools: (a.tools || []).map(t => ({ name: t.name, description: t.description })),
    });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

router.post('/:nombre/conversar', auth(ROLES), async (req, res) => {
  const { mensaje, historial = [], contexto_extra = null } = req.body || {};
  if (!mensaje?.trim()) return res.status(400).json({ error: 'mensaje requerido' });
  try {
    const r = await invocarAgente(req.params.nombre, {
      mensaje, historial, contexto_extra,
      usuario_id: req.usuario.id,
    });
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/historial/invocaciones', auth(ROLES_DIRECTIVOS), async (req, res) => {
  const { agente, dias = 30, limit = 100 } = req.query;
  const params = [parseInt(dias)];
  const where = [`created_at >= CURRENT_DATE - $1::int * INTERVAL '1 day'`];
  if (agente) { params.push(agente); where.push(`nombre_agente = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));
  try {
    const { rows } = await db.query(`
      SELECT i.*, u.nombre AS usuario_nombre
      FROM agentes_invocaciones i
      LEFT JOIN usuarios u ON u.id = i.usuario_id
      WHERE ${where.join(' AND ')}
      ORDER BY i.created_at DESC LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/historial/costos', auth(ROLES_DIRECTIVOS), async (req, res) => {
  const dias = parseInt(req.query.dias || 30);
  try {
    const { rows } = await db.query(`
      SELECT nombre_agente, COUNT(*)::int AS invocaciones,
        COALESCE(SUM(costo_usd), 0)::float AS costo_total_usd,
        COALESCE(AVG(costo_usd), 0)::float AS costo_promedio_usd,
        COALESCE(SUM(tokens_in + tokens_out), 0)::int AS tokens_total
      FROM agentes_invocaciones
      WHERE created_at >= CURRENT_DATE - $1::int * INTERVAL '1 day'
      GROUP BY nombre_agente ORDER BY costo_total_usd DESC
    `, [dias]);
    res.json({
      periodo_dias: dias,
      por_agente: rows,
      costo_total: rows.reduce((s, r) => s + parseFloat(r.costo_total_usd), 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
