const router = require('express').Router();
const multer = require('multer');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const auth   = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ROLES_LECTURA   = ['director','admin','logistica','caja'];
const ROLES_ESCRITURA = ['director','admin'];

const TIPOS_VALIDOS = [
  'constancia_fiscal','permiso_sct','poliza_seguro','poliza_seguro_unidad',
  'acta_constitutiva','ine_representante','comprobante_domicilio',
  'opinion_cumplimiento','referencias_comerciales','contrato_servicios','otro',
];

// Documentos CRÍTICOS para verificación
const TIPOS_CRITICOS = ['constancia_fiscal','permiso_sct','poliza_seguro','ine_representante','contrato_servicios'];

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

router.get('/config', auth(ROLES_LECTURA), (_req, res) => {
  res.json({ tipos: TIPOS_VALIDOS, tipos_criticos: TIPOS_CRITICOS, max_bytes: 10 * 1024 * 1024 });
});

// Listar documentos de un transportista
router.get('/:transportista_id/documentos', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        d.id, d.transportista_id, d.tipo, d.nombre, d.mime_type, d.tamano_bytes,
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
      FROM transportista_documentos d
      LEFT JOIN usuarios usr ON usr.id = d.subido_por
      WHERE d.transportista_id = $1
      ORDER BY d.tipo, d.created_at DESC
    `, [req.params.transportista_id]);
    res.json(rows);
  } catch (e) {
    console.error('transp docs list:', e.message);
    res.status(500).json({ error: 'Error al listar documentos' });
  }
});

// Subir documento
router.post('/:transportista_id/documentos', auth(ROLES_ESCRITURA), upload.single('archivo'), async (req, res) => {
  const transpId = parseInt(req.params.transportista_id);
  const { tipo, nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_VALIDOS.join(', ')}` });
  }

  const { rows: [t] } = await db.query('SELECT id FROM transportistas_externos WHERE id = $1', [transpId]);
  if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });

  try {
    const { rows: [doc] } = await db.query(`
      INSERT INTO transportista_documentos
        (transportista_id, tipo, nombre, archivo_bytes, mime_type, tamano_bytes,
         vigencia_inicio, vigencia_fin, alertar_dias_antes, notas, subido_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, transportista_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas,
                subido_por, created_at, updated_at
    `, [
      transpId, tipo, nombre || req.file.originalname,
      req.file.buffer, req.file.mimetype, req.file.size,
      vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : 30,
      notas || null, req.usuario.id,
    ]);

    // Si el transportista ya estaba verificado y suben un doc crítico nuevo,
    // pasa a 'en_revision' para que director re-valide
    if (TIPOS_CRITICOS.includes(tipo)) {
      await db.query(`
        UPDATE transportistas_externos
        SET estado_verificacion = CASE
          WHEN estado_verificacion = 'verificado' THEN 'en_revision'
          WHEN estado_verificacion = 'pendiente' THEN 'en_revision'
          ELSE estado_verificacion
        END,
        updated_at = NOW()
        WHERE id = $1
      `, [transpId]);
    }

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_documento_subir', 'transportista_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo, transportista_id: transpId, tamano: req.file.size }, req.ip]);
    } catch (_) {}

    res.json(doc);
  } catch (e) {
    console.error('transp docs upload:', e.message);
    res.status(500).json({ error: e.message || 'Error al subir documento' });
  }
});

// Stream archivo
router.get('/documentos/:id/archivo', authQueryOrHeader(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query(`
      SELECT archivo_bytes, mime_type, nombre FROM transportista_documentos WHERE id = $1
    `, [req.params.id]);
    if (!doc || !doc.archivo_bytes) return res.status(404).json({ error: 'Archivo no encontrado' });

    const buf = Buffer.isBuffer(doc.archivo_bytes) ? doc.archivo_bytes : Buffer.from(doc.archivo_bytes);
    res.set({
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Length': buf.length,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.nombre || 'documento')}"`,
      'Cache-Control': 'private, max-age=300',
    });
    res.send(buf);
  } catch (e) {
    console.error('transp docs stream:', e.message);
    res.status(500).json({ error: 'Error al servir archivo' });
  }
});

// Actualizar metadata (vigencia, notas)
router.put('/documentos/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const { nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;
  try {
    const { rows: [doc] } = await db.query(`
      UPDATE transportista_documentos
      SET nombre = COALESCE($1, nombre),
          vigencia_inicio = $2,
          vigencia_fin = $3,
          alertar_dias_antes = COALESCE($4, alertar_dias_antes),
          notas = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, transportista_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas
    `, [
      nombre || null, vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : null,
      notas || null, req.params.id,
    ]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (e) {
    console.error('transp docs update:', e.message);
    res.status(500).json({ error: 'Error al actualizar documento' });
  }
});

// Eliminar documento (sólo director)
router.delete('/documentos/:id', auth(['director']), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query('SELECT id, tipo, transportista_id FROM transportista_documentos WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    await db.query('DELETE FROM transportista_documentos WHERE id = $1', [req.params.id]);

    // Si era doc crítico y el transportista estaba verificado, degrada a en_revision
    if (TIPOS_CRITICOS.includes(doc.tipo)) {
      await db.query(`
        UPDATE transportistas_externos
        SET estado_verificacion = CASE
          WHEN estado_verificacion = 'verificado' THEN 'en_revision'
          ELSE estado_verificacion
        END,
        updated_at = NOW()
        WHERE id = $1
      `, [doc.transportista_id]);
    }

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_documento_eliminar', 'transportista_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo: doc.tipo, transportista_id: doc.transportista_id }, req.ip]);
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    console.error('transp docs delete:', e.message);
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
});

// Alertas de vigencia globales (todos los transportistas)
router.get('/documentos/alertas-vigencia', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM transportista_documentos_alertas
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
    console.error('transp docs alertas:', e.message);
    res.status(500).json({ error: 'Error al consultar alertas de vigencia' });
  }
});

module.exports = router;
