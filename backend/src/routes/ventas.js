const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── Rutas fijas ANTES de /:id para evitar conflictos ──

// GET /resumen-dia
router.get('/resumen-dia', auth(), async (req, res) => {
  const f = req.query.fecha || new Date().toISOString().split('T')[0];
  try {
    const { rows } = await db.query(`
      SELECT
        vd.descripcion                                              AS producto,
        COUNT(DISTINCT v.id)                                        AS operaciones,
        SUM(vd.subtotal)                                            AS total,
        SUM(vd.subtotal) FILTER (WHERE v.tipo_pago = 'Efectivo')    AS efectivo,
        SUM(vd.subtotal) FILTER (WHERE v.tipo_pago = 'Transferencia') AS transferencia
      FROM ventas v
      JOIN ventas_detalle vd ON v.id = vd.venta_id
      WHERE v.fecha = $1
      GROUP BY vd.descripcion
      ORDER BY SUM(vd.subtotal) DESC
    `, [f]);
    const { rows: [tot] } = await db.query(
      'SELECT SUM(COALESCE(total, monto)) AS total, COUNT(*) AS ops FROM ventas WHERE fecha = $1',
      [f]
    );
    res.json({ por_producto: rows, totales: tot });
  } catch (e) {
    console.error('resumen-dia:', e.message);
    res.status(500).json({ error: 'Error al obtener resumen del día' });
  }
});

// GET /resumen-semana
router.get('/resumen-semana', auth(), async (req, res) => {
  const si = req.query.semana_inicio || (() => {
    const d = new Date(); const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  })();
  const sf = new Date(new Date(si).getTime() + 6 * 86400000).toISOString().split('T')[0];
  try {
    const { rows } = await db.query(`
      SELECT fecha, SUM(COALESCE(total, monto)) AS total, COUNT(*) AS ops
      FROM ventas WHERE fecha BETWEEN $1 AND $2
      GROUP BY fecha ORDER BY fecha
    `, [si, sf]);
    const { rows: [tot] } = await db.query(
      'SELECT SUM(COALESCE(total, monto)) AS total FROM ventas WHERE fecha BETWEEN $1 AND $2',
      [si, sf]
    );
    res.json({ por_dia: rows, total: tot.total || 0, semana_inicio: si, semana_fin: sf });
  } catch (e) {
    console.error('resumen-semana:', e.message);
    res.status(500).json({ error: 'Error al obtener resumen semanal' });
  }
});

// ── CRUD principal ──

// POST / — registrar venta multi-producto con transacción
router.post('/', auth(['director','admin','caja']), async (req, res) => {
  const { fecha, cliente_id, tipo_pago, tipo_venta, descuento, notas, fecha_vencimiento, items } = req.body;

  if (!fecha || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Faltan fecha o productos' });

  for (const it of items) {
    if (!it.descripcion || !(it.cantidad > 0) || !(it.precio_unitario >= 0))
      return res.status(400).json({ error: 'Cada línea requiere descripción, cantidad y precio' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const subtotal  = items.reduce((s, i) => s + parseFloat(i.cantidad) * parseFloat(i.precio_unitario), 0);
    const desc      = parseFloat(descuento) || 0;
    const total     = subtotal - desc;
    const tv        = tipo_venta || 'contado';
    const ep        = tv === 'credito' ? 'pendiente' : 'pagado';
    const primerProd = items[0].descripcion;

    const { rows: [venta] } = await client.query(`
      INSERT INTO ventas
        (fecha, producto, monto, tipo_pago, cliente_id, notas, registrado_por,
         subtotal, descuento, total, tipo_venta, estado_pago, fecha_vencimiento)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      fecha, primerProd, total, tipo_pago || 'Efectivo',
      cliente_id || null, notas || null, req.usuario.id,
      subtotal, desc, total, tv, ep,
      tv === 'credito' ? (fecha_vencimiento || null) : null
    ]);

    for (const it of items) {
      const sub = parseFloat(it.cantidad) * parseFloat(it.precio_unitario);
      await client.query(`
        INSERT INTO ventas_detalle
          (venta_id, inventario_id, descripcion, cantidad, precio_unitario, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [venta.id, it.inventario_id || null, it.descripcion, it.cantidad, it.precio_unitario, sub]);

      if (it.inventario_id) {
        await client.query(
          'UPDATE inventario SET existencia = existencia - $1, updated_at = NOW() WHERE id = $2',
          [it.cantidad, it.inventario_id]
        );
      }
    }

    await client.query('COMMIT');

    const { rows: detalle } = await client.query(
      'SELECT * FROM ventas_detalle WHERE venta_id = $1 ORDER BY id', [venta.id]
    );
    res.json({ ...venta, items: detalle });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('crear venta:', e.message);
    res.status(500).json({ error: 'Error al registrar venta' });
  } finally {
    client.release();
  }
});

// GET / — listar ventas con filtros opcionales
router.get('/', auth(), async (req, res) => {
  const { fecha_inicio, fecha_fin, cliente_id, estado_pago } = req.query;
  let q = `
    SELECT v.*,
           COALESCE(v.total, v.monto)  AS total_calc,
           u.nombre                    AS registrado_nombre,
           c.nombre                    AS cliente_nombre
    FROM ventas v
    LEFT JOIN usuarios u ON v.registrado_por = u.id
    LEFT JOIN clientes c ON v.cliente_id     = c.id
    WHERE 1=1
  `;
  const params = [];
  if (fecha_inicio) { params.push(fecha_inicio); q += ` AND v.fecha >= $${params.length}`; }
  if (fecha_fin)    { params.push(fecha_fin);    q += ` AND v.fecha <= $${params.length}`; }
  if (cliente_id)   { params.push(cliente_id);   q += ` AND v.cliente_id = $${params.length}`; }
  if (estado_pago)  { params.push(estado_pago);  q += ` AND v.estado_pago = $${params.length}`; }
  q += ' ORDER BY v.fecha DESC, v.created_at DESC LIMIT 500';

  try {
    const { rows } = await db.query(q, params);
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { rows: items } = await db.query(
        'SELECT * FROM ventas_detalle WHERE venta_id = ANY($1) ORDER BY venta_id, id',
        [ids]
      );
      const map = {};
      items.forEach(i => { (map[i.venta_id] = map[i.venta_id] || []).push(i); });
      rows.forEach(v => { v.items = map[v.id] || []; });
    }
    res.json(rows);
  } catch (e) {
    console.error('listar ventas:', e.message);
    res.status(500).json({ error: 'Error al obtener ventas' });
  }
});

// GET /:id — detalle de una venta
router.get('/:id', auth(), async (req, res) => {
  try {
    const { rows: [venta] } = await db.query(`
      SELECT v.*, u.nombre AS registrado_nombre, c.nombre AS cliente_nombre
      FROM ventas v
      LEFT JOIN usuarios u ON v.registrado_por = u.id
      LEFT JOIN clientes c ON v.cliente_id     = c.id
      WHERE v.id = $1
    `, [req.params.id]);
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });
    const { rows: items } = await db.query(
      'SELECT * FROM ventas_detalle WHERE venta_id = $1 ORDER BY id', [venta.id]
    );
    res.json({ ...venta, items });
  } catch (e) {
    console.error('detalle venta:', e.message);
    res.status(500).json({ error: 'Error al obtener venta' });
  }
});

// DELETE /:id — eliminar y restaurar inventario
router.delete('/:id', auth(['director','admin']), async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: items } = await client.query(
      'SELECT * FROM ventas_detalle WHERE venta_id = $1 AND inventario_id IS NOT NULL',
      [req.params.id]
    );
    for (const it of items) {
      await client.query(
        'UPDATE inventario SET existencia = existencia + $1, updated_at = NOW() WHERE id = $2',
        [it.cantidad, it.inventario_id]
      );
    }
    await client.query('DELETE FROM ventas WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('eliminar venta:', e.message);
    res.status(500).json({ error: 'Error al eliminar venta' });
  } finally {
    client.release();
  }
});

module.exports = router;
