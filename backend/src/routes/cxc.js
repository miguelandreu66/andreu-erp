const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── Helper: base query de cuentas pendientes ──────────────────────
const CXC_BASE = `
  SELECT
    v.id,
    v.fecha,
    v.fecha_vencimiento,
    COALESCE(v.total, v.monto)                 AS total,
    v.estado_pago,
    v.tipo_pago,
    v.notas,
    c.id                                        AS cliente_id,
    c.nombre                                    AS cliente_nombre,
    c.telefono                                  AS cliente_telefono,
    u.nombre                                    AS registrado_nombre,
    COALESCE(SUM(a.monto), 0)                   AS total_abonado,
    COALESCE(v.total, v.monto)
      - COALESCE(SUM(a.monto), 0)               AS saldo_pendiente,
    CURRENT_DATE
      - COALESCE(v.fecha_vencimiento, v.fecha)  AS dias_transcurridos
  FROM ventas v
  LEFT JOIN clientes  c ON v.cliente_id      = c.id
  LEFT JOIN usuarios  u ON v.registrado_por  = u.id
  LEFT JOIN abonos    a ON v.id              = a.venta_id
  WHERE v.estado_pago IN ('pendiente','parcial')
  GROUP BY v.id, c.id, c.nombre, c.telefono, u.nombre
`;

// GET /resumen — tarjetas del encabezado
router.get('/resumen', auth(), async (req, res) => {
  try {
    const { rows: [r] } = await db.query(`
      WITH cxc AS (${CXC_BASE})
      SELECT
        COUNT(*)                                                AS cuentas,
        COALESCE(SUM(saldo_pendiente), 0)                       AS total_por_cobrar,
        COALESCE(SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos > 30), 0) AS vencido,
        COALESCE(SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos <= 30), 0) AS por_vencer,
        COUNT(DISTINCT cliente_id)                              AS clientes_con_saldo
      FROM cxc
    `);
    res.json(r);
  } catch (e) {
    console.error('cxc resumen:', e.message);
    res.status(500).json({ error: 'Error al obtener resumen CXC' });
  }
});

// GET /antiguedad — reporte de antigüedad de saldos por tramos
router.get('/antiguedad', auth(), async (req, res) => {
  try {
    const { rows } = await db.query(`
      WITH cxc AS (${CXC_BASE})
      SELECT
        cliente_nombre,
        cliente_id,
        SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos BETWEEN 0 AND 30)  AS d_0_30,
        SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos BETWEEN 31 AND 60) AS d_31_60,
        SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos BETWEEN 61 AND 90) AS d_61_90,
        SUM(saldo_pendiente) FILTER (WHERE dias_transcurridos > 90)              AS d_mas_90,
        SUM(saldo_pendiente)                                                     AS total
      FROM cxc
      GROUP BY cliente_id, cliente_nombre
      HAVING SUM(saldo_pendiente) > 0
      ORDER BY SUM(saldo_pendiente) DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('cxc antiguedad:', e.message);
    res.status(500).json({ error: 'Error al obtener antigüedad' });
  }
});

// GET / — lista de cuentas por cobrar con filtros opcionales
router.get('/', auth(), async (req, res) => {
  const { cliente_id, vencidas } = req.query;
  let extra = '';
  const params = [];
  if (cliente_id) { params.push(cliente_id); extra += ` AND v.cliente_id = $${params.length}`; }

  try {
    const baseConFiltro = CXC_BASE.replace('WHERE v.estado_pago', `WHERE ${extra ? extra.replace('AND ', '') + ' AND' : ''} v.estado_pago`);

    // Reescribir query con filtros antes del GROUP BY
    const q = `
      SELECT
        v.id,
        v.fecha,
        v.fecha_vencimiento,
        COALESCE(v.total, v.monto)                 AS total,
        v.estado_pago,
        v.tipo_pago,
        v.notas,
        c.id                                        AS cliente_id,
        c.nombre                                    AS cliente_nombre,
        c.telefono                                  AS cliente_telefono,
        u.nombre                                    AS registrado_nombre,
        COALESCE(SUM(a.monto), 0)                   AS total_abonado,
        COALESCE(v.total, v.monto)
          - COALESCE(SUM(a.monto), 0)               AS saldo_pendiente,
        CURRENT_DATE
          - COALESCE(v.fecha_vencimiento, v.fecha)  AS dias_transcurridos
      FROM ventas v
      LEFT JOIN clientes  c ON v.cliente_id      = c.id
      LEFT JOIN usuarios  u ON v.registrado_por  = u.id
      LEFT JOIN abonos    a ON v.id              = a.venta_id
      WHERE v.estado_pago IN ('pendiente','parcial')
        ${cliente_id ? `AND v.cliente_id = $${params.length + (params.length === 0 ? 1 : 0)}` : ''}
      GROUP BY v.id, c.id, c.nombre, c.telefono, u.nombre
      HAVING (COALESCE(v.total, v.monto) - COALESCE(SUM(a.monto), 0)) > 0
        ${vencidas === 'true' ? 'AND (CURRENT_DATE - COALESCE(v.fecha_vencimiento, v.fecha)) > 30' : ''}
      ORDER BY saldo_pendiente DESC
    `;

    const finalParams = cliente_id ? [cliente_id] : [];
    const { rows } = await db.query(q, finalParams);

    // Adjuntar items de cada venta
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const { rows: detalles } = await db.query(
        'SELECT * FROM ventas_detalle WHERE venta_id = ANY($1) ORDER BY venta_id, id',
        [ids]
      );
      const map = {};
      detalles.forEach(d => { (map[d.venta_id] = map[d.venta_id] || []).push(d); });
      rows.forEach(v => { v.items = map[v.id] || []; });
    }
    res.json(rows);
  } catch (e) {
    console.error('cxc list:', e.message);
    res.status(500).json({ error: 'Error al obtener cuentas por cobrar' });
  }
});

// GET /:venta_id/abonos — historial de abonos de una venta
router.get('/:venta_id/abonos', auth(), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT a.*, u.nombre AS registrado_nombre
      FROM abonos a
      LEFT JOIN usuarios u ON a.registrado_por = u.id
      WHERE a.venta_id = $1
      ORDER BY a.fecha DESC, a.created_at DESC
    `, [req.params.venta_id]);
    res.json(rows);
  } catch (e) {
    console.error('abonos list:', e.message);
    res.status(500).json({ error: 'Error al obtener abonos' });
  }
});

// POST /:venta_id/abono — registrar un abono y recalcular estado
router.post('/:venta_id/abono', auth(['director','admin','caja']), async (req, res) => {
  const { monto, tipo_pago, fecha, notas } = req.body;
  const venta_id = req.params.venta_id;

  if (!monto || parseFloat(monto) <= 0)
    return res.status(400).json({ error: 'El monto debe ser mayor a $0' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Verificar venta existe y tiene saldo
    const { rows: [venta] } = await client.query(
      'SELECT id, COALESCE(total, monto) AS total FROM ventas WHERE id = $1',
      [venta_id]
    );
    if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const { rows: [{ ya_abonado }] } = await client.query(
      'SELECT COALESCE(SUM(monto), 0) AS ya_abonado FROM abonos WHERE venta_id = $1',
      [venta_id]
    );

    const saldo = parseFloat(venta.total) - parseFloat(ya_abonado);
    const montoAbono = Math.min(parseFloat(monto), saldo); // no abonar más del saldo

    if (montoAbono <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta venta ya está liquidada' });
    }

    // Insertar abono
    const { rows: [abono] } = await client.query(`
      INSERT INTO abonos (venta_id, fecha, monto, tipo_pago, notas, registrado_por)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [venta_id, fecha || new Date().toISOString().split('T')[0], montoAbono,
        tipo_pago || 'Efectivo', notas || null, req.usuario.id]);

    // Recalcular estado_pago
    const nuevoAbonado = parseFloat(ya_abonado) + montoAbono;
    const nuevoEstado  = nuevoAbonado >= parseFloat(venta.total) ? 'pagado' : 'parcial';

    await client.query(
      'UPDATE ventas SET estado_pago = $1 WHERE id = $2',
      [nuevoEstado, venta_id]
    );

    await client.query('COMMIT');
    res.json({ abono, estado_pago: nuevoEstado, saldo_restante: parseFloat(venta.total) - nuevoAbonado });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('registrar abono:', e.message);
    res.status(500).json({ error: 'Error al registrar abono' });
  } finally {
    client.release();
  }
});

module.exports = router;
