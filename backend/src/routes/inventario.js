// ====== INVENTARIO ======
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth(), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM inventario ORDER BY producto');
  res.json(rows);
});

router.put('/:id', auth(['director','admin','logistica']), async (req, res) => {
  const { existencia, punto_reorden, precio_unitario } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE inventario
       SET existencia=$1, punto_reorden=$2, precio_unitario=$3,
           actualizado_por=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [existencia, punto_reorden, precio_unitario ?? 0, req.usuario.id, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('actualizar inventario:', e.message);
    res.status(500).json({ error: 'Error al actualizar inventario' });
  }
});

router.post('/', auth(['director','admin']), async (req, res) => {
  const { producto, existencia, unidad, punto_reorden, precio_unitario } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO inventario (producto, existencia, unidad, punto_reorden, precio_unitario, actualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [producto, existencia || 0, unidad, punto_reorden || 0, precio_unitario || 0, req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('crear inventario:', e.message);
    res.status(500).json({ error: 'Error al crear inventario' });
  }
});

module.exports = router;
