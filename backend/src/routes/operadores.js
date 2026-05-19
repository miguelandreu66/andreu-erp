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

// ════════════════════════════════════════════════════════════════
// ── Endpoints móviles para operadores en ruta (PWA) ──
// El operador desde la app reporta entregas y SOS
// ════════════════════════════════════════════════════════════════

// Marcar viaje como entregado con evidencia (foto base64 + notas)
router.post('/viaje/:viajeId/entregado', auth(['operador','director','admin','logistica']), async (req, res) => {
  const { foto_base64, notas, lat, lng, kilometros_final } = req.body;
  const viajeId = req.params.viajeId;
  try {
    const { rows: [v] } = await db.query('SELECT * FROM viajes WHERE id=$1', [viajeId]);
    if (!v) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (req.usuario.rol === 'operador' && v.operador_id !== req.usuario.operador_id) {
      return res.status(403).json({ error: 'No puedes marcar entregado un viaje que no es tuyo' });
    }

    await db.query(`UPDATE viajes SET estado = 'Completado', updated_at = NOW() WHERE id = $1`, [viajeId]);

    let evidenciaId = null;
    if (foto_base64) {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS viajes_evidencia (
            id          SERIAL PRIMARY KEY,
            viaje_id    INTEGER NOT NULL REFERENCES viajes(id) ON DELETE CASCADE,
            operador_id INTEGER,
            tipo        VARCHAR(20) DEFAULT 'entrega',
            foto_data   BYTEA,
            foto_mime   VARCHAR(50),
            lat         DECIMAL(10,7),
            lng         DECIMAL(10,7),
            kilometros  INTEGER,
            notas       TEXT,
            creado_en   TIMESTAMP DEFAULT NOW()
          )
        `);
        const match = foto_base64.match(/^data:([^;]+);base64,(.+)$/);
        const mime = match ? match[1] : 'image/jpeg';
        const b64 = match ? match[2] : foto_base64;
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 5 * 1024 * 1024) {
          return res.status(413).json({ error: 'Foto demasiado grande (máx 5MB)' });
        }
        const { rows: [ev] } = await db.query(`
          INSERT INTO viajes_evidencia (viaje_id, operador_id, foto_data, foto_mime, lat, lng, kilometros, notas)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
        `, [viajeId, req.usuario.operador_id || null, buf, mime, lat || null, lng || null, kilometros_final || null, notas || null]);
        evidenciaId = ev.id;
      } catch (e) {
        console.warn('evidencia no guardada:', e.message);
      }
    }

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle)
        VALUES ($1, 'marcar_entregado', 'viaje', $2, $3)
      `, [req.usuario.id, viajeId, { evidenciaId, kilometros_final, lat, lng }]);
    } catch { /* sin audit_log */ }

    res.json({ ok: true, viaje_id: viajeId, evidencia_id: evidenciaId });
  } catch (e) {
    console.error('marcar entregado:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Recuperar foto de evidencia
router.get('/evidencia/:id/archivo', auth(['director','admin','logistica','monitoreo','operador']), async (req, res) => {
  try {
    const { rows: [r] } = await db.query('SELECT foto_data, foto_mime FROM viajes_evidencia WHERE id=$1', [req.params.id]);
    if (!r || !r.foto_data) return res.status(404).end();
    res.setHeader('Content-Type', r.foto_mime || 'image/jpeg');
    res.send(r.foto_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SOS — alerta urgente del operador
router.post('/sos', auth(['operador','director','admin','logistica']), async (req, res) => {
  const { mensaje, lat, lng, unidad_id } = req.body;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sos_alertas (
        id          SERIAL PRIMARY KEY,
        operador_id INTEGER,
        usuario_id  INTEGER,
        unidad_id   INTEGER,
        mensaje     TEXT,
        lat         DECIMAL(10,7),
        lng         DECIMAL(10,7),
        status      VARCHAR(20) DEFAULT 'abierta',
        atendido_por INTEGER,
        atendido_at TIMESTAMP,
        creado_en   TIMESTAMP DEFAULT NOW()
      )
    `);
    const { rows: [sos] } = await db.query(`
      INSERT INTO sos_alertas (operador_id, usuario_id, unidad_id, mensaje, lat, lng)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, creado_en
    `, [
      req.usuario.operador_id || null,
      req.usuario.id,
      unidad_id || null,
      mensaje || 'SOS sin mensaje',
      lat || null,
      lng || null,
    ]);

    // Replicar al sistema de alertas del Autopilot si existe
    try {
      await db.query(`
        INSERT INTO alertas (unidad_id, tipo, severidad, mensaje, lat, lng, status)
        VALUES ($1, 'sos_operador', 'critica', $2, $3, $4, 'abierta')
      `, [unidad_id || null, mensaje || 'SOS desde app móvil', lat, lng]);
    } catch { /* sin tabla alertas, ignora */ }

    res.json({ ok: true, sos_id: sos.id, creado_en: sos.creado_en });
  } catch (e) {
    console.error('SOS:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Listar SOS abiertos (supervisor)
router.get('/sos/abiertos', auth(['director','admin','logistica','monitoreo']), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT s.*, o.nombre AS operador_nombre, u.placas AS unidad_placas
      FROM sos_alertas s
      LEFT JOIN operadores o ON o.id = s.operador_id
      LEFT JOIN unidades u   ON u.id = s.unidad_id
      WHERE s.status = 'abierta'
      ORDER BY s.creado_en DESC LIMIT 20
    `);
    res.json(rows);
  } catch {
    res.json([]); // tabla no creada aún
  }
});

// Atender SOS
router.put('/sos/:id/atender', auth(['director','admin','logistica']), async (req, res) => {
  try {
    const { rows: [r] } = await db.query(`
      UPDATE sos_alertas SET status='atendida', atendido_por=$1, atendido_at=NOW()
      WHERE id=$2 RETURNING *
    `, [req.usuario.id, req.params.id]);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
