const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Crear cliente
router.post('/', auth(['director','admin','caja']), async (req, res) => {
  const { nombre, telefono, direccion, tipo, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const { rows } = await db.query(
      `INSERT INTO clientes (nombre, telefono, direccion, tipo, notas, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nombre, telefono, direccion, tipo||'publico_general', notas, req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Cliente ya registrado' });
    res.status(500).json({ error: 'Error al crear cliente' });
  }
});

// Listar clientes
router.get('/', auth(), async (req, res) => {
  const { tipo, buscar } = req.query;
  let q = `SELECT c.*,
    COALESCE(SUM(v.monto),0) as total_compras,
    COUNT(v.id) as num_compras,
    MAX(v.fecha) as ultima_compra
    FROM clientes c
    LEFT JOIN ventas v ON v.cliente_id = c.id
    WHERE c.activo = true`;
  const params = [];
  if (tipo) { params.push(tipo); q += ` AND c.tipo = $${params.length}`; }
  if (buscar) { params.push('%'+buscar+'%'); q += ` AND (c.nombre ILIKE $${params.length} OR c.telefono ILIKE $${params.length})`; }
  q += ' GROUP BY c.id ORDER BY total_compras DESC';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Detalle de cliente con historial
router.get('/:id', auth(), async (req, res) => {
  const { rows: cliente } = await db.query('SELECT * FROM clientes WHERE id=$1', [req.params.id]);
  if (!cliente.length) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { rows: historial } = await db.query(
    'SELECT * FROM ventas WHERE cliente_id=$1 ORDER BY fecha DESC LIMIT 50',
    [req.params.id]
  );
  const { rows: stats } = await db.query(`
    SELECT
      COALESCE(SUM(monto),0) as total_compras,
      COUNT(*) as num_compras,
      COALESCE(AVG(monto),0) as ticket_promedio,
      MAX(fecha) as ultima_compra,
      MIN(fecha) as primera_compra
    FROM ventas WHERE cliente_id=$1
  `, [req.params.id]);
  res.json({ ...cliente[0], historial, stats: stats[0] });
});

// Actualizar cliente
router.put('/:id', auth(['director','admin','caja']), async (req, res) => {
  const { nombre, telefono, direccion, tipo, notas } = req.body;
  const { rows } = await db.query(
    'UPDATE clientes SET nombre=$1, telefono=$2, direccion=$3, tipo=$4, notas=$5 WHERE id=$6 RETURNING *',
    [nombre, telefono, direccion, tipo, notas, req.params.id]
  );
  res.json(rows[0]);
});

// Top clientes
router.get('/stats/top', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT c.nombre, c.tipo, c.telefono,
      SUM(v.monto) as total,
      COUNT(v.id) as compras,
      MAX(v.fecha) as ultima
    FROM clientes c
    JOIN ventas v ON v.cliente_id = c.id
    WHERE v.fecha >= NOW() - INTERVAL '30 days'
    GROUP BY c.id, c.nombre, c.tipo, c.telefono
    ORDER BY total DESC LIMIT 10
  `);
  res.json(rows);
});

module.exports = router;
