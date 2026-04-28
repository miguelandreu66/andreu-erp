// ====== EMPLEADOS ======
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth(['director','admin']), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM empleados WHERE activo=true ORDER BY area, nombre');
  res.json(rows);
});

router.post('/', auth(['director','admin']), async (req, res) => {
  const { nombre, puesto, area, sueldo_semanal, telefono, fecha_ingreso } = req.body;
  if (!nombre || !puesto || !area || !sueldo_semanal) return res.status(400).json({ error: 'Faltan campos' });
  try {
    const { rows } = await db.query(
      'INSERT INTO empleados (nombre, puesto, area, sueldo_semanal, telefono, fecha_ingreso) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [nombre, puesto, area, sueldo_semanal, telefono, fecha_ingreso]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Error al crear empleado' }); }
});

router.put('/:id', auth(['director','admin']), async (req, res) => {
  const { nombre, puesto, area, sueldo_semanal, telefono } = req.body;
  const { rows } = await db.query(
    'UPDATE empleados SET nombre=$1, puesto=$2, area=$3, sueldo_semanal=$4, telefono=$5 WHERE id=$6 RETURNING *',
    [nombre, puesto, area, sueldo_semanal, telefono, req.params.id]
  );
  res.json(rows[0]);
});

router.put('/:id/baja', auth(['director']), async (req, res) => {
  const { rows } = await db.query('UPDATE empleados SET activo=false WHERE id=$1 RETURNING id, nombre', [req.params.id]);
  res.json(rows[0]);
});

module.exports = router;
