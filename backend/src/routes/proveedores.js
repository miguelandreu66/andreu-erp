const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// GET / — listar proveedores
router.get('/', auth(), async (req, res) => {
  try {
    const soloActivos = req.query.activos === 'true';
    const q = `SELECT * FROM proveedores ${soloActivos ? 'WHERE activo = true' : ''} ORDER BY nombre`;
    const { rows } = await db.query(q);
    res.json(rows);
  } catch (e) {
    console.error('listar proveedores:', e.message);
    res.status(500).json({ error: 'Error al obtener proveedores' });
  }
});

// POST / — crear proveedor
router.post('/', auth(['director','admin']), async (req, res) => {
  const { nombre, contacto, telefono, email, direccion, rfc, productos, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  try {
    const { rows: [p] } = await db.query(`
      INSERT INTO proveedores (nombre, contacto, telefono, email, direccion, rfc, productos, notas, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [nombre, contacto||null, telefono||null, email||null,
        direccion||null, rfc||null, productos||null, notas||null, req.usuario.id]);
    res.json(p);
  } catch (e) {
    console.error('crear proveedor:', e.message);
    res.status(500).json({ error: 'Error al crear proveedor' });
  }
});

// PUT /:id — actualizar proveedor
router.put('/:id', auth(['director','admin']), async (req, res) => {
  const { nombre, contacto, telefono, email, direccion, rfc, productos, notas } = req.body;
  try {
    const { rows: [p] } = await db.query(`
      UPDATE proveedores
      SET nombre=$1, contacto=$2, telefono=$3, email=$4,
          direccion=$5, rfc=$6, productos=$7, notas=$8
      WHERE id=$9 RETURNING *
    `, [nombre, contacto||null, telefono||null, email||null,
        direccion||null, rfc||null, productos||null, notas||null, req.params.id]);
    if (!p) return res.status(404).json({ error: 'Proveedor no encontrado' });
    res.json(p);
  } catch (e) {
    console.error('actualizar proveedor:', e.message);
    res.status(500).json({ error: 'Error al actualizar proveedor' });
  }
});

// PUT /:id/toggle — activar / desactivar
router.put('/:id/toggle', auth(['director','admin']), async (req, res) => {
  try {
    const { rows: [p] } = await db.query(
      'UPDATE proveedores SET activo = NOT activo WHERE id = $1 RETURNING id, nombre, activo',
      [req.params.id]
    );
    res.json(p);
  } catch (e) {
    console.error('toggle proveedor:', e.message);
    res.status(500).json({ error: 'Error al cambiar estado' });
  }
});

module.exports = router;
