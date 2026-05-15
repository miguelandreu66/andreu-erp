const router = require('express').Router();
const multer = require('multer');
const db = require('../db');
const auth = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ROLES_LECTURA = ['director','admin','logistica','monitoreo','caja'];
const ROLES_ESCRITURA = ['director','admin'];

// ══════════════════════════════════════════════════════
// PROVEEDORES (catálogo)
// ══════════════════════════════════════════════════════
router.get('/proveedores', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM flotilla_proveedores ORDER BY tipo, nombre');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
// TARJETAS DE COMBUSTIBLE
// ══════════════════════════════════════════════════════
router.get('/tarjetas', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*,
             p.nombre AS proveedor_nombre, p.tipo AS proveedor_tipo, p.api_disponible,
             u.placas AS unidad_placas,
             op.nombre AS operador_nombre,
             (SELECT COUNT(*) FROM movimientos_tarjeta m WHERE m.tarjeta_id = t.id)::int AS total_movimientos,
             (SELECT MAX(fecha) FROM movimientos_tarjeta m WHERE m.tarjeta_id = t.id) AS ultimo_movimiento,
             (SELECT COALESCE(SUM(monto),0) FROM movimientos_tarjeta m
              WHERE m.tarjeta_id = t.id AND m.fecha >= date_trunc('month', CURRENT_DATE))::float AS gasto_mes
      FROM tarjetas_flotilla t
      JOIN flotilla_proveedores p ON p.id = t.proveedor_id
      LEFT JOIN unidades u ON u.id = t.unidad_id
      LEFT JOIN operadores op ON op.id = t.operador_id
      ORDER BY t.activa DESC, p.nombre, t.numero
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tarjetas', auth(ROLES_ESCRITURA), async (req, res) => {
  const { proveedor_id, numero, alias, unidad_id, operador_id, saldo_actual, limite_diario, limite_semanal, notas } = req.body;
  if (!proveedor_id || !numero) return res.status(400).json({ error: 'proveedor_id y numero son obligatorios' });
  try {
    const { rows: [t] } = await db.query(`
      INSERT INTO tarjetas_flotilla (proveedor_id, numero, alias, unidad_id, operador_id, saldo_actual, limite_diario, limite_semanal, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [proveedor_id, numero.trim(), alias || null, unidad_id || null, operador_id || null,
        saldo_actual || 0, limite_diario || null, limite_semanal || null, notas || null]);
    res.json(t);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe una tarjeta con ese número en ese proveedor' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/tarjetas/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const { alias, unidad_id, operador_id, saldo_actual, limite_diario, limite_semanal, activa, notas } = req.body;
  try {
    const { rows: [t] } = await db.query(`
      UPDATE tarjetas_flotilla
      SET alias = $1, unidad_id = $2, operador_id = $3, saldo_actual = $4,
          limite_diario = $5, limite_semanal = $6,
          activa = COALESCE($7, activa), notas = $8, updated_at = NOW()
      WHERE id = $9 RETURNING *
    `, [alias || null, unidad_id || null, operador_id || null, saldo_actual || 0,
        limite_diario || null, limite_semanal || null, activa, notas || null, req.params.id]);
    if (!t) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/tarjetas/:id', auth(['director']), async (req, res) => {
  try {
    await db.query('DELETE FROM tarjetas_flotilla WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
// MOVIMIENTOS DE TARJETA
// ══════════════════════════════════════════════════════
router.get('/tarjetas/:id/movimientos', auth(ROLES_LECTURA), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  try {
    const { rows } = await db.query(`
      SELECT * FROM movimientos_tarjeta
      WHERE tarjeta_id = $1
      ORDER BY fecha DESC
      LIMIT $2
    `, [req.params.id, limit]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tarjetas/:id/movimientos', auth(ROLES_ESCRITURA), async (req, res) => {
  const { fecha, estacion, tipo_combustible, litros, precio_litro, monto, folio_externo, notas } = req.body;
  if (!fecha || !monto) return res.status(400).json({ error: 'fecha y monto son obligatorios' });
  try {
    const { rows: [m] } = await db.query(`
      INSERT INTO movimientos_tarjeta
        (tarjeta_id, fecha, estacion, tipo_combustible, litros, precio_litro, monto, folio_externo, fuente, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9) RETURNING *
    `, [req.params.id, fecha, estacion || null, tipo_combustible || null,
        litros || null, precio_litro || null, monto, folio_externo || null,
        notas ? { notas } : {}]);
    // Actualizar saldo (descuenta el monto)
    await db.query('UPDATE tarjetas_flotilla SET saldo_actual = saldo_actual - $1, updated_at = NOW() WHERE id = $2',
      [monto, req.params.id]);
    res.json(m);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Movimiento duplicado (mismo folio + fecha)' });
    res.status(500).json({ error: e.message });
  }
});

// Upload CSV de estado de cuenta
// Esperado: CSV con columnas configurables. Formato genérico — cliente envía mapping
// Body: archivo + columnas (campo => header del CSV)
router.post('/tarjetas/:id/movimientos/upload-csv', auth(ROLES_ESCRITURA), upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo CSV' });
  try {
    const texto = req.file.buffer.toString('utf-8');
    const lineas = texto.split(/\r?\n/).filter(l => l.trim());
    if (lineas.length < 2) return res.status(400).json({ error: 'CSV vacío o sin filas de datos' });

    // Mapping de columnas: del frontend o auto-detect
    let mapping = {};
    try { mapping = JSON.parse(req.body.mapping || '{}'); } catch (_) {}

    const headers = lineas[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    // Auto-detect si no se mandó mapping
    const idx = {
      fecha: mapping.fecha != null ? mapping.fecha : headers.findIndex(h => h.includes('fecha') || h === 'date'),
      estacion: mapping.estacion != null ? mapping.estacion : headers.findIndex(h => h.includes('estacion') || h.includes('station') || h.includes('comercio') || h.includes('merchant')),
      tipo: mapping.tipo != null ? mapping.tipo : headers.findIndex(h => h.includes('producto') || h.includes('combustible') || h.includes('fuel')),
      litros: mapping.litros != null ? mapping.litros : headers.findIndex(h => h.includes('litros') || h.includes('cantidad') || h === 'liters'),
      precio: mapping.precio != null ? mapping.precio : headers.findIndex(h => h.includes('precio')),
      monto: mapping.monto != null ? mapping.monto : headers.findIndex(h => h.includes('monto') || h.includes('total') || h.includes('importe') || h === 'amount'),
      folio: mapping.folio != null ? mapping.folio : headers.findIndex(h => h.includes('folio') || h.includes('referencia') || h.includes('id')),
    };

    if (idx.fecha < 0 || idx.monto < 0) {
      return res.status(400).json({
        error: 'No se detectaron columnas fecha y/o monto. Headers detectados: ' + headers.join(', '),
        headers,
      });
    }

    let importados = 0, duplicados = 0, errores = 0;
    const detalleErrores = [];
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      const fecha = cols[idx.fecha];
      const monto = parseFloat(cols[idx.monto]);
      if (!fecha || isNaN(monto)) { errores++; continue; }
      try {
        await db.query(`
          INSERT INTO movimientos_tarjeta
            (tarjeta_id, fecha, estacion, tipo_combustible, litros, precio_litro, monto, folio_externo, fuente, metadata)
          VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, 'csv', $9)
          ON CONFLICT (tarjeta_id, folio_externo, fecha) DO NOTHING
        `, [
          req.params.id,
          fecha,
          idx.estacion >= 0 ? cols[idx.estacion] : null,
          idx.tipo >= 0 ? cols[idx.tipo] : null,
          idx.litros >= 0 && cols[idx.litros] ? parseFloat(cols[idx.litros]) : null,
          idx.precio >= 0 && cols[idx.precio] ? parseFloat(cols[idx.precio]) : null,
          monto,
          idx.folio >= 0 ? cols[idx.folio] || `csv-${i}` : `csv-${i}`,
          { fila: i, raw: cols },
        ]);
        importados++;
      } catch (_e) {
        duplicados++;
      }
    }

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'tarjeta_csv_upload', 'tarjetas_flotilla', $2, $3, $4)
      `, [req.usuario.id, parseInt(req.params.id), { importados, duplicados, errores, total_lineas: lineas.length - 1 }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, importados, duplicados, errores, total_lineas: lineas.length - 1, detalleErrores });
  } catch (e) {
    console.error('csv upload:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// TAGS DE CASETAS
// ══════════════════════════════════════════════════════
router.get('/tags', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*,
             p.nombre AS proveedor_nombre,
             u.placas AS unidad_placas,
             (SELECT COUNT(*) FROM cruces_tag c WHERE c.tag_id = t.id)::int AS total_cruces,
             (SELECT MAX(fecha) FROM cruces_tag c WHERE c.tag_id = t.id) AS ultimo_cruce,
             (SELECT COALESCE(SUM(monto),0) FROM cruces_tag c
              WHERE c.tag_id = t.id AND c.fecha >= date_trunc('month', CURRENT_DATE))::float AS gasto_mes
      FROM tags_caseta t
      JOIN flotilla_proveedores p ON p.id = t.proveedor_id
      LEFT JOIN unidades u ON u.id = t.unidad_id
      ORDER BY t.activa DESC, p.nombre, t.numero
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tags', auth(ROLES_ESCRITURA), async (req, res) => {
  const { proveedor_id, numero, alias, unidad_id, saldo_actual, notas } = req.body;
  if (!proveedor_id || !numero) return res.status(400).json({ error: 'proveedor_id y numero son obligatorios' });
  try {
    const { rows: [t] } = await db.query(`
      INSERT INTO tags_caseta (proveedor_id, numero, alias, unidad_id, saldo_actual, notas)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [proveedor_id, numero.trim(), alias || null, unidad_id || null, saldo_actual || 0, notas || null]);
    res.json(t);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe un TAG con ese número' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/tags/:id/cruces', auth(ROLES_ESCRITURA), async (req, res) => {
  const { fecha, caseta, monto, folio_externo, notas } = req.body;
  if (!fecha || !monto || !caseta) return res.status(400).json({ error: 'fecha, caseta y monto son obligatorios' });
  try {
    const { rows: [c] } = await db.query(`
      INSERT INTO cruces_tag (tag_id, fecha, caseta, monto, folio_externo, fuente, metadata)
      VALUES ($1, $2, $3, $4, $5, 'manual', $6) RETURNING *
    `, [req.params.id, fecha, caseta, monto, folio_externo || null, notas ? { notas } : {}]);
    await db.query('UPDATE tags_caseta SET saldo_actual = saldo_actual - $1, updated_at = NOW() WHERE id = $2', [monto, req.params.id]);
    res.json(c);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Cruce duplicado (mismo folio + fecha)' });
    res.status(500).json({ error: e.message });
  }
});

router.get('/tags/:id/cruces', auth(ROLES_LECTURA), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  try {
    const { rows } = await db.query(`
      SELECT * FROM cruces_tag WHERE tag_id = $1 ORDER BY fecha DESC LIMIT $2
    `, [req.params.id, limit]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════
// RESUMEN GLOBAL
// ══════════════════════════════════════════════════════
router.get('/resumen', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows: [r] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM tarjetas_flotilla WHERE activa = true)::int AS tarjetas_activas,
        (SELECT COUNT(*) FROM tags_caseta WHERE activa = true)::int AS tags_activos,
        (SELECT COALESCE(SUM(monto), 0) FROM movimientos_tarjeta
         WHERE fecha >= date_trunc('month', CURRENT_DATE))::float AS gasto_combustible_mes,
        (SELECT COALESCE(SUM(monto), 0) FROM cruces_tag
         WHERE fecha >= date_trunc('month', CURRENT_DATE))::float AS gasto_casetas_mes,
        (SELECT COALESCE(SUM(saldo_actual), 0) FROM tarjetas_flotilla WHERE activa = true)::float AS saldo_total_tarjetas,
        (SELECT COALESCE(SUM(saldo_actual), 0) FROM tags_caseta WHERE activa = true)::float AS saldo_total_tags
    `);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
