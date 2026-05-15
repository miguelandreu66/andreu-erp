const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const auth = require('../middleware/auth');

// Lista de operadores (cualquier usuario logeado puede ver)
router.get('/', auth(), async (req, res) => {
  const { rows } = await db.query('SELECT * FROM operadores WHERE activo=true ORDER BY nombre');
  res.json(rows);
});

// ── ENDPOINTS PARA USUARIOS CON ROL 'operador' (self-data only) ──
// El operador ve SU propio perfil (basado en usuarios.operador_id)
router.get('/mi-perfil', auth(['operador','director','admin','logistica']), async (req, res) => {
  try {
    if (!req.usuario.operador_id && req.usuario.rol === 'operador') {
      return res.status(404).json({ error: 'Tu usuario no está vinculado a un operador. Pide al admin que lo configure.' });
    }
    const operadorId = req.query.operador_id || req.usuario.operador_id;
    if (!operadorId) return res.status(400).json({ error: 'No hay operador asociado' });
    const { rows: [op] } = await db.query('SELECT * FROM operadores WHERE id = $1', [operadorId]);
    if (!op) return res.status(404).json({ error: 'Operador no encontrado' });
    res.json(op);
  } catch (e) {
    console.error('mi-perfil:', e.message);
    res.status(500).json({ error: 'Error al consultar perfil' });
  }
});

// El operador ve SOLO sus viajes
router.get('/mis-viajes', auth(['operador','director','admin','logistica','monitoreo']), async (req, res) => {
  try {
    let operadorId = req.usuario.operador_id;
    if (!operadorId && req.usuario.rol !== 'operador') {
      // Para roles no-operador, permite query param
      operadorId = req.query.operador_id;
    }
    if (!operadorId) {
      return res.status(400).json({ error: 'No hay operador asociado. Especifica operador_id en la query.' });
    }
    const dias = Math.min(parseInt(req.query.dias) || 30, 365);
    const { rows } = await db.query(`
      SELECT v.*, u.placas, u.descripcion AS unidad_descripcion
      FROM viajes v
      LEFT JOIN unidades u ON u.id = v.unidad_id
      WHERE v.operador_id = $1
        AND v.fecha >= CURRENT_DATE - ($2::int || ' days')::interval
      ORDER BY v.fecha DESC, v.id DESC
    `, [operadorId, dias]);
    res.json(rows);
  } catch (e) {
    console.error('mis-viajes:', e.message);
    res.status(500).json({ error: 'Error al consultar viajes' });
  }
});

// Crear acceso de usuario para un operador existente
// Esto crea la fila en usuarios + setea operador_id vinculado
router.post('/:id/crear-acceso', auth(['director']), async (req, res) => {
  const operadorId = parseInt(req.params.id);
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const { rows: [op] } = await db.query('SELECT * FROM operadores WHERE id = $1 AND activo = true', [operadorId]);
    if (!op) return res.status(404).json({ error: 'Operador no encontrado o inactivo' });

    // Verificar si ya tiene usuario vinculado
    const { rows: [existente] } = await db.query('SELECT id FROM usuarios WHERE operador_id = $1', [operadorId]);
    if (existente) {
      return res.status(409).json({ error: 'Este operador ya tiene un acceso de usuario asociado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows: [nuevo] } = await db.query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, operador_id)
      VALUES ($1, $2, $3, 'operador', $4)
      RETURNING id, nombre, email, rol, operador_id
    `, [op.nombre, email.trim().toLowerCase(), hash, operadorId]);

    res.json({ ok: true, usuario: nuevo, operador: op });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    console.error('crear-acceso:', e.message);
    res.status(500).json({ error: 'Error al crear acceso' });
  }
});

// ── CRUD original ──
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
