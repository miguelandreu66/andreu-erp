const router = require('express').Router();
const multer = require('multer');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const auth   = require('../middleware/auth');

// Multer: memoria, máximo 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ROLES_LECTURA   = ['director','admin','logistica','monitoreo'];
const ROLES_ESCRITURA = ['director','admin','logistica'];

const TIPOS_VALIDOS = [
  'tarjeta_circulacion','poliza_seguro','permiso_sct','verificacion_vehicular',
  'comprobante_propiedad','tarjeta_caja_remolque','foto_unidad','factura_unidad',
  'tenencia','otro',
];

// ── Helper: auth que también acepta token por query param (para descargas) ──
function authQueryOrHeader(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(decoded.rol)) {
        return res.status(403).json({ error: 'Sin permisos' });
      }
      req.usuario = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Token inválido' });
    }
  };
}

// ── GET config ─────────────────────────────────
router.get('/config', auth(ROLES_LECTURA), (_req, res) => {
  res.json({
    storage_configurado: true,
    tipo_storage: 'postgres_native',
    tipos: TIPOS_VALIDOS,
    max_bytes: 10 * 1024 * 1024,
  });
});

// ── GET /unidades/:id/documentos — lista ───────
router.get('/unidades/:unidad_id/documentos', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        d.id, d.unidad_id, d.tipo, d.nombre, d.archivo_url, d.mime_type, d.tamano_bytes,
        d.vigencia_inicio, d.vigencia_fin, d.alertar_dias_antes, d.notas,
        d.subido_por, d.created_at, d.updated_at,
        usr.nombre AS subido_por_nombre,
        CASE
          WHEN d.vigencia_fin IS NULL THEN 'sin_vigencia'
          WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido'
          WHEN d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval THEN 'por_vencer'
          ELSE 'vigente'
        END AS estado_vigencia,
        CASE WHEN d.vigencia_fin IS NULL THEN NULL ELSE (d.vigencia_fin - CURRENT_DATE)::int END AS dias_restantes
      FROM unidad_documentos d
      LEFT JOIN usuarios usr ON usr.id = d.subido_por
      WHERE d.unidad_id = $1
      ORDER BY d.tipo, d.created_at DESC
    `, [req.params.unidad_id]);
    res.json(rows);
  } catch (e) {
    console.error('docs list:', e.message);
    res.status(500).json({ error: 'Error al listar documentos' });
  }
});

// ── POST /unidades/:id/documentos — upload ─────
router.post('/unidades/:unidad_id/documentos', auth(ROLES_ESCRITURA), upload.single('archivo'), async (req, res) => {
  const unidadId = parseInt(req.params.unidad_id);
  const { tipo, nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_VALIDOS.join(', ')}` });
  }

  const { rows: [u] } = await db.query('SELECT id FROM unidades WHERE id = $1', [unidadId]);
  if (!u) return res.status(404).json({ error: 'Unidad no encontrada' });

  try {
    const { rows: [doc] } = await db.query(`
      INSERT INTO unidad_documentos
        (unidad_id, tipo, nombre, archivo_bytes, mime_type, tamano_bytes,
         vigencia_inicio, vigencia_fin, alertar_dias_antes, notas, subido_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, unidad_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas,
                subido_por, created_at, updated_at
    `, [
      unidadId, tipo, nombre || req.file.originalname,
      req.file.buffer, req.file.mimetype, req.file.size,
      vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : 30,
      notas || null, req.usuario.id,
    ]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'documento_subir', 'unidad_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo, unidad_id: unidadId, tamano: req.file.size }, req.ip]);
    } catch (_) {}

    res.json(doc);
  } catch (e) {
    console.error('docs upload:', e.message);
    res.status(500).json({ error: e.message || 'Error al subir documento' });
  }
});

// ── GET /unidades/documentos/:id/archivo — stream del binario ─
// Acepta auth por header o por ?token=... (para <a target="_blank">)
router.get('/unidades/documentos/:id/archivo', authQueryOrHeader(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query(`
      SELECT archivo_bytes, mime_type, nombre, tamano_bytes
      FROM unidad_documentos
      WHERE id = $1
    `, [req.params.id]);

    if (!doc || !doc.archivo_bytes) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }

    const buf = Buffer.isBuffer(doc.archivo_bytes) ? doc.archivo_bytes : Buffer.from(doc.archivo_bytes);
    res.set({
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Length': buf.length,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.nombre || 'documento')}"`,
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buf);
  } catch (e) {
    console.error('docs stream:', e.message);
    res.status(500).json({ error: 'Error al servir archivo' });
  }
});

// ── PUT /unidades/documentos/:id — actualizar metadata ─
router.put('/unidades/documentos/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const { nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;
  try {
    const { rows: [doc] } = await db.query(`
      UPDATE unidad_documentos
      SET nombre = COALESCE($1, nombre),
          vigencia_inicio = $2,
          vigencia_fin = $3,
          alertar_dias_antes = COALESCE($4, alertar_dias_antes),
          notas = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, unidad_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas
    `, [
      nombre || null, vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : null,
      notas || null, req.params.id,
    ]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (e) {
    console.error('docs update:', e.message);
    res.status(500).json({ error: 'Error al actualizar documento' });
  }
});

// ── DELETE /unidades/documentos/:id ────────────
router.delete('/unidades/documentos/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query('SELECT id, tipo, unidad_id FROM unidad_documentos WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    await db.query('DELETE FROM unidad_documentos WHERE id = $1', [req.params.id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'documento_eliminar', 'unidad_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo: doc.tipo, unidad_id: doc.unidad_id }, req.ip]);
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    console.error('docs delete:', e.message);
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
});

// ── GET /unidades/documentos/alertas-vigencia ──
router.get('/unidades/documentos/alertas-vigencia', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM documentos_alertas_vigencia
      WHERE estado_vigencia IN ('vencido','por_vencer')
      ORDER BY
        CASE estado_vigencia WHEN 'vencido' THEN 0 ELSE 1 END,
        vigencia_fin ASC
    `);
    res.json({
      items: rows,
      count: rows.length,
      vencidos: rows.filter(r => r.estado_vigencia === 'vencido').length,
      por_vencer: rows.filter(r => r.estado_vigencia === 'por_vencer').length,
    });
  } catch (e) {
    console.error('docs alertas:', e.message);
    res.status(500).json({ error: 'Error al consultar alertas de vigencia' });
  }
});

module.exports = router;
