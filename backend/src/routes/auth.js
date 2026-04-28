const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  try {
    const { rows } = await db.query('SELECT * FROM usuarios WHERE email=$1 AND activo=true', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
  } catch (e) {
    res.status(500).json({ error: 'Error de servidor' });
  }
});

// Crear usuario (solo director y admin)
router.post('/registro', auth(['director', 'admin']), async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password || !rol) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol',
      [nombre, email, hash, rol]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Email ya registrado' });
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

// Listar usuarios
router.get('/usuarios', auth(['director', 'admin']), async (req, res) => {
  const { rows } = await db.query('SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY nombre');
  res.json(rows);
});

// Cambiar contraseña
router.put('/password', auth(), async (req, res) => {
  const { password_actual, password_nueva } = req.body;
  try {
    const { rows } = await db.query('SELECT password_hash FROM usuarios WHERE id=$1', [req.usuario.id]);
    const valid = await bcrypt.compare(password_actual, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Contraseña actual incorrecta' });
    const hash = await bcrypt.hash(password_nueva, 10);
    await db.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [hash, req.usuario.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// Desactivar usuario
router.put('/usuarios/:id/toggle', auth(['director']), async (req, res) => {
  const { rows } = await db.query(
    'UPDATE usuarios SET activo = NOT activo WHERE id=$1 RETURNING id, nombre, activo',
    [req.params.id]
  );
  res.json(rows[0]);
});

module.exports = router;
