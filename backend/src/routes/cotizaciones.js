const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── GET / — lista con filtros ─────────────────────────────────────
router.get('/', auth(), async (req, res) => {
  const { estado, q } = req.query;
  const params = [];
  let where = '1=1';
  if (estado && estado !== 'todas') { params.push(estado); where += ` AND c.estado = $${params.length}`; }
  if (q) { params.push(`%${q}%`); where += ` AND (c.folio ILIKE $${params.length} OR cl.nombre ILIKE $${params.length} OR c.cliente_nombre_libre ILIKE $${params.length})`; }

  try {
    const { rows } = await db.query(`
      SELECT
        c.id, c.folio, c.fecha, c.fecha_vencimiento, c.estado,
        c.subtotal, c.descuento, c.total, c.notas, c.condiciones, c.venta_id,
        COALESCE(cl.nombre, c.cliente_nombre_libre, 'Sin cliente') AS cliente_nombre,
        cl.telefono AS cliente_telefono,
        u.nombre AS creado_nombre,
        c.created_at
      FROM cotizaciones c
      LEFT JOIN clientes  cl ON c.cliente_id  = cl.id
      LEFT JOIN usuarios  u  ON c.creado_por  = u.id
      WHERE ${where}
      ORDER BY c.created_at DESC
      LIMIT 300
    `, params);
    res.json(rows);
  } catch (e) {
    console.error('cotizaciones list:', e.message);
    res.status(500).json({ error: 'Error al listar cotizaciones' });
  }
});

// ── GET /:id — detalle con items (ANTES de rutas con params) ──────
router.get('/:id', auth(), async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`
      SELECT c.*,
        COALESCE(cl.nombre, c.cliente_nombre_libre, 'Sin cliente') AS cliente_nombre,
        cl.telefono AS cliente_telefono,
        u.nombre AS creado_nombre
      FROM cotizaciones c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN usuarios u  ON c.creado_por = u.id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!c) return res.status(404).json({ error: 'Cotización no encontrada' });

    const { rows: items } = await db.query(
      'SELECT * FROM cotizaciones_detalle WHERE cotizacion_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json({ ...c, items });
  } catch (e) {
    console.error('cotizacion detail:', e.message);
    res.status(500).json({ error: 'Error al obtener cotización' });
  }
});

// ── POST / — crear cotización ─────────────────────────────────────
router.post('/', auth(['director','admin','caja']), async (req, res) => {
  const { cliente_id, cliente_nombre_libre, items, fecha_vencimiento, notas, condiciones, descuento } = req.body;
  if (!items || items.length === 0)
    return res.status(400).json({ error: 'Agrega al menos un producto o servicio' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const subtotal = items.reduce((s, it) =>
      s + parseFloat(it.cantidad) * parseFloat(it.precio_unitario), 0);
    const desc  = parseFloat(descuento) || 0;
    const total = subtotal - desc;

    // Por defecto vence en 30 días si no se indica
    const vence = fecha_vencimiento || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })();

    const { rows: [cot] } = await client.query(`
      INSERT INTO cotizaciones
        (cliente_id, cliente_nombre_libre, subtotal, descuento, total,
         fecha_vencimiento, notas, condiciones, creado_por, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'borrador')
      RETURNING *
    `, [cliente_id || null, cliente_nombre_libre || null, subtotal, desc, total,
        vence, notas || null, condiciones || null, req.usuario.id]);

    const folio = 'COT-' + String(cot.id).padStart(5, '0');
    await client.query('UPDATE cotizaciones SET folio=$1 WHERE id=$2', [folio, cot.id]);

    for (const it of items) {
      const sub = parseFloat(it.cantidad) * parseFloat(it.precio_unitario);
      await client.query(`
        INSERT INTO cotizaciones_detalle
          (cotizacion_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [cot.id, it.inventario_id || null, it.descripcion,
          parseFloat(it.cantidad), parseFloat(it.precio_unitario), sub]);
    }

    await client.query('COMMIT');
    res.json({ ...cot, folio, items });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('crear cotizacion:', e.message);
    res.status(500).json({ error: 'Error al crear cotización' });
  } finally {
    client.release();
  }
});

// ── PUT /:id/estado — cambiar estado ─────────────────────────────
router.put('/:id/estado', auth(['director','admin','caja']), async (req, res) => {
  const { estado } = req.body;
  const validos = ['borrador','enviada','aceptada','rechazada'];
  if (!validos.includes(estado))
    return res.status(400).json({ error: 'Estado inválido' });
  try {
    const { rows: [c] } = await db.query(
      'UPDATE cotizaciones SET estado=$1 WHERE id=$2 AND estado!=\'convertida\' RETURNING *',
      [estado, req.params.id]
    );
    if (!c) return res.status(400).json({ error: 'No se puede cambiar una cotización ya convertida' });
    res.json(c);
  } catch (e) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

// ── POST /:id/convertir — convertir a venta ───────────────────────
router.post('/:id/convertir', auth(['director','admin','caja']), async (req, res) => {
  const { tipo_pago = 'Efectivo', tipo_venta = 'contado', fecha_vencimiento_venta } = req.body;
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [cot] } = await client.query(
      'SELECT * FROM cotizaciones WHERE id=$1', [req.params.id]
    );
    if (!cot)      { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cotización no encontrada' }); }
    if (cot.venta_id) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Ya fue convertida a venta' }); }

    const { rows: items } = await client.query(
      'SELECT * FROM cotizaciones_detalle WHERE cotizacion_id=$1', [req.params.id]
    );

    // Crear venta
    const { rows: [venta] } = await client.query(`
      INSERT INTO ventas
        (fecha, cliente_id, subtotal, descuento, total, tipo_pago, tipo_venta,
         estado_pago, fecha_vencimiento, notas, registrado_por)
      VALUES (CURRENT_DATE,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [cot.cliente_id, cot.subtotal, cot.descuento, cot.total,
        tipo_pago, tipo_venta,
        tipo_venta === 'credito' ? 'pendiente' : 'pagado',
        fecha_vencimiento_venta || null,
        `Convertida de cotización ${cot.folio}`,
        req.usuario.id]);

    for (const it of items) {
      await client.query(`
        INSERT INTO ventas_detalle
          (venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [venta.id, it.inventario_id || null, it.descripcion,
          it.cantidad, it.precio_unitario, it.subtotal]);

      if (it.inventario_id) {
        await client.query(
          'UPDATE inventario SET existencia = existencia - $1 WHERE id=$2',
          [it.cantidad, it.inventario_id]
        );
      }
    }

    await client.query(
      "UPDATE cotizaciones SET estado='convertida', venta_id=$1 WHERE id=$2",
      [venta.id, cot.id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, venta_id: venta.id, folio: cot.folio });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('convertir cotizacion:', e.message);
    res.status(500).json({ error: 'Error al convertir cotización' });
  } finally {
    client.release();
  }
});

module.exports = router;
