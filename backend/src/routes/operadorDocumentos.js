const router = require('express').Router();
const multer = require('multer');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const auth   = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ROLES_LECTURA   = ['director','admin','logistica','monitoreo'];
const ROLES_ESCRITURA = ['director','admin','logistica'];

const TIPOS_VALIDOS = [
  'licencia_federal','examen_medico','ine','curp','rfc',
  'comprobante_domicilio','antecedentes_no_penales','contrato_laboral',
  'foto_perfil','capacitacion','otro',
];

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
  res.json({ tipos: TIPOS_VALIDOS, max_bytes: 10 * 1024 * 1024 });
});

router.get('/:operador_id/documentos', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        d.id, d.operador_id, d.tipo, d.nombre, d.archivo_url, d.mime_type, d.tamano_bytes,
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
      FROM operador_documentos d
      LEFT JOIN usuarios usr ON usr.id = d.subido_por
      WHERE d.operador_id = $1
      ORDER BY d.tipo, d.created_at DESC
    `, [req.params.operador_id]);
    res.json(rows);
  } catch (e) {
    console.error('op docs list:', e.message);
    res.status(500).json({ error: 'Error al listar documentos' });
  }
});

router.post('/:operador_id/documentos', auth(ROLES_ESCRITURA), upload.single('archivo'), async (req, res) => {
  const operadorId = parseInt(req.params.operador_id);
  const { tipo, nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;

  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_VALIDOS.join(', ')}` });
  }

  const { rows: [op] } = await db.query('SELECT id FROM operadores WHERE id = $1', [operadorId]);
  if (!op) return res.status(404).json({ error: 'Operador no encontrado' });

  try {
    const { rows: [doc] } = await db.query(`
      INSERT INTO operador_documentos
        (operador_id, tipo, nombre, archivo_bytes, mime_type, tamano_bytes,
         vigencia_inicio, vigencia_fin, alertar_dias_antes, notas, subido_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, operador_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas,
                subido_por, created_at, updated_at
    `, [
      operadorId, tipo, nombre || req.file.originalname,
      req.file.buffer, req.file.mimetype, req.file.size,
      vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : 30,
      notas || null, req.usuario.id,
    ]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'op_documento_subir', 'operador_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo, operador_id: operadorId, tamano: req.file.size }, req.ip]);
    } catch (_) {}

    res.json(doc);
  } catch (e) {
    console.error('op docs upload:', e.message);
    res.status(500).json({ error: e.message || 'Error al subir documento' });
  }
});

router.get('/documentos/:id/archivo', authQueryOrHeader(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query(`
      SELECT archivo_bytes, mime_type, nombre FROM operador_documentos WHERE id = $1
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
    console.error('op docs stream:', e.message);
    res.status(500).json({ error: 'Error al servir archivo' });
  }
});

router.put('/documentos/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const { nombre, vigencia_inicio, vigencia_fin, alertar_dias_antes, notas } = req.body;
  try {
    const { rows: [doc] } = await db.query(`
      UPDATE operador_documentos
      SET nombre = COALESCE($1, nombre),
          vigencia_inicio = $2,
          vigencia_fin = $3,
          alertar_dias_antes = COALESCE($4, alertar_dias_antes),
          notas = $5,
          updated_at = NOW()
      WHERE id = $6
      RETURNING id, operador_id, tipo, nombre, mime_type, tamano_bytes,
                vigencia_inicio, vigencia_fin, alertar_dias_antes, notas
    `, [
      nombre || null, vigencia_inicio || null, vigencia_fin || null,
      alertar_dias_antes ? parseInt(alertar_dias_antes) : null,
      notas || null, req.params.id,
    ]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (e) {
    console.error('op docs update:', e.message);
    res.status(500).json({ error: 'Error al actualizar documento' });
  }
});

router.delete('/documentos/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const { rows: [doc] } = await db.query('SELECT id, tipo, operador_id FROM operador_documentos WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    await db.query('DELETE FROM operador_documentos WHERE id = $1', [req.params.id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'op_documento_eliminar', 'operador_documentos', $2, $3, $4)
      `, [req.usuario.id, doc.id, { tipo: doc.tipo, operador_id: doc.operador_id }, req.ip]);
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    console.error('op docs delete:', e.message);
    res.status(500).json({ error: 'Error al eliminar documento' });
  }
});

router.get('/documentos/alertas-vigencia', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM operador_documentos_alertas
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
    console.error('op docs alertas:', e.message);
    res.status(500).json({ error: 'Error al consultar alertas de vigencia' });
  }
});

module.exports = router;
