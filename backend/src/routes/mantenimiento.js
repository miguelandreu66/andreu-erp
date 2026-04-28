const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Crear registro de mantenimiento
router.post('/', auth(['director','admin','logistica']), async (req, res) => {
  const { unidad_id, operador_id, tipo, descripcion, costo, fecha, kilometraje, proximo_km, proximo_fecha, estado } = req.body;
  if (!tipo || !descripcion || !fecha) return res.status(400).json({ error: 'Faltan campos requeridos' });
  try {
    const { rows } = await db.query(
      `INSERT INTO mantenimientos
       (unidad_id, operador_id, tipo, descripcion, costo, fecha, kilometraje, proximo_km, proximo_fecha, estado, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [unidad_id||null, operador_id||null, tipo, descripcion, costo||0, fecha, kilometraje||0, proximo_km||null, proximo_fecha||null, estado||'completado', req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Error al registrar mantenimiento' }); }
});

// Listar mantenimientos
router.get('/', auth(), async (req, res) => {
  const { unidad_id, tipo, estado } = req.query;
  let q = `SELECT m.*, u.placas, u.descripcion as unidad_desc, o.nombre as operador_nombre
           FROM mantenimientos m
           LEFT JOIN unidades u ON m.unidad_id = u.id
           LEFT JOIN operadores o ON m.operador_id = o.id
           WHERE 1=1`;
  const params = [];
  if (unidad_id) { params.push(unidad_id); q += ` AND m.unidad_id=$${params.length}`; }
  if (tipo) { params.push(tipo); q += ` AND m.tipo=$${params.length}`; }
  if (estado) { params.push(estado); q += ` AND m.estado=$${params.length}`; }
  q += ' ORDER BY m.fecha DESC LIMIT 200';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Próximos mantenimientos
router.get('/proximos', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT m.*, u.placas, u.descripcion as unidad_desc
    FROM mantenimientos m
    LEFT JOIN unidades u ON m.unidad_id = u.id
    WHERE m.proximo_fecha IS NOT NULL
    AND m.proximo_fecha <= NOW() + INTERVAL '30 days'
    AND m.estado = 'completado'
    ORDER BY m.proximo_fecha ASC
  `);
  res.json(rows);
});

// Costo por unidad
router.get('/costos-unidad', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT u.placas, u.descripcion,
      SUM(m.costo) as costo_total,
      COUNT(*) as num_mantenimientos,
      MAX(m.fecha) as ultimo_mantenimiento
    FROM mantenimientos m
    LEFT JOIN unidades u ON m.unidad_id = u.id
    WHERE m.fecha >= NOW() - INTERVAL '6 months'
    GROUP BY u.id, u.placas, u.descripcion
    ORDER BY costo_total DESC
  `);
  res.json(rows);
});

// Unidades
router.get('/unidades', auth(), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM unidades WHERE activo=true ORDER BY placas');
  res.json(rows);
});

router.post('/unidades', auth(['director','admin']), async (req, res) => {
  const { placas, descripcion } = req.body;
  const { rows } = await db.query(
    'INSERT INTO unidades (placas, descripcion) VALUES ($1,$2) RETURNING *',
    [placas, descripcion]
  );
  res.json(rows[0]);
});

module.exports = router;
