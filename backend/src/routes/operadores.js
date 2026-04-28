const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth(), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM operadores WHERE activo=true ORDER BY nombre');
  res.json(rows);
});

router.post('/', auth(['director','admin']), async (req, res) => {
  const { nombre, telefono, licencia } = req.body;
  const { rows } = await db.query(
    'INSERT INTO operadores (nombre, telefono, licencia) VALUES ($1,$2,$3) RETURNING *',
    [nombre, telefono, licencia]
  );
  res.json(rows[0]);
});

router.put('/:id', auth(['director','admin']), async (req, res) => {
  const { nombre, telefono, licencia } = req.body;
  const { rows } = await db.query(
    'UPDATE operadores SET nombre=$1, telefono=$2, licencia=$3 WHERE id=$4 RETURNING *',
    [nombre, telefono, licencia, req.params.id]
  );
  res.json(rows[0]);
});

router.put('/:id/toggle', auth(['director']), async (req, res) => {
  const { rows } = await db.query('UPDATE operadores SET activo=NOT activo WHERE id=$1 RETURNING *', [req.params.id]);
  res.json(rows[0]);
});

module.exports = router;
