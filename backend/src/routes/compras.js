const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── Utilidad: adjuntar detalle a órdenes ─────────────────────────
async function adjuntarDetalle(ordenes, dbConn) {
  if (!ordenes.length) return ordenes;
  const conn = dbConn || db;
  const ids  = ordenes.map(o => o.id);
  const { rows: items } = await conn.query(
    'SELECT * FROM ordenes_compra_detalle WHERE orden_id = ANY($1) ORDER BY orden_id, id',
    [ids]
  );
  const map = {};
  items.forEach(i => { (map[i.orden_id] = map[i.orden_id] || []).push(i); });
  ordenes.forEach(o => { o.items = map[o.id] || []; });
  return ordenes;
}

// ══════════════════════════════════════════════════════════════════
// ÓRDENES DE COMPRA
// ══════════════════════════════════════════════════════════════════

// GET /ordenes — listar órdenes con filtros
router.get('/ordenes', auth(), async (req, res) => {
  const { estado, proveedor_id } = req.query;
  let q = `
    SELECT oc.*,
           p.nombre  AS proveedor_nombre,
           u.nombre  AS solicitado_nombre,
           au.nombre AS autorizado_nombre
    FROM ordenes_compra oc
    LEFT JOIN proveedores p  ON oc.proveedor_id     = p.id
    LEFT JOIN usuarios    u  ON oc.solicitado_por   = u.id
    LEFT JOIN usuarios    au ON oc.autorizado_por   = au.id
    WHERE 1=1
  `;
  const params = [];
  if (estado)       { params.push(estado);       q += ` AND oc.estado = $${params.length}`; }
  if (proveedor_id) { params.push(proveedor_id); q += ` AND oc.proveedor_id = $${params.length}`; }
  q += ' ORDER BY oc.created_at DESC LIMIT 200';

  try {
    const { rows } = await db.query(q, params);
    await adjuntarDetalle(rows);
    res.json(rows);
  } catch (e) {
    console.error('listar ordenes:', e.message);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});

// GET /ordenes/:id — detalle de una orden
router.get('/ordenes/:id', auth(), async (req, res) => {
  try {
    const { rows: [oc] } = await db.query(`
      SELECT oc.*,
             p.nombre  AS proveedor_nombre, p.telefono AS proveedor_tel,
             u.nombre  AS solicitado_nombre,
             au.nombre AS autorizado_nombre
      FROM ordenes_compra oc
      LEFT JOIN proveedores p  ON oc.proveedor_id   = p.id
      LEFT JOIN usuarios    u  ON oc.solicitado_por = u.id
      LEFT JOIN usuarios    au ON oc.autorizado_por = au.id
      WHERE oc.id = $1
    `, [req.params.id]);
    if (!oc) return res.status(404).json({ error: 'Orden no encontrada' });
    await adjuntarDetalle([oc]);
    res.json(oc);
  } catch (e) {
    console.error('detalle orden:', e.message);
    res.status(500).json({ error: 'Error al obtener orden' });
  }
});

// POST /ordenes — crear orden de compra
router.post('/ordenes', auth(['director','admin']), async (req, res) => {
  const { proveedor_id, fecha, fecha_entrega_esperada, descuento, notas, items } = req.body;
  if (!proveedor_id || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Faltan proveedor o productos' });

  for (const it of items) {
    if (!it.descripcion || !(it.cantidad_pedida > 0) || !(it.precio_unitario >= 0))
      return res.status(400).json({ error: 'Cada línea requiere descripción, cantidad y precio' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const subtotal = items.reduce((s, i) => s + parseFloat(i.cantidad_pedida) * parseFloat(i.precio_unitario), 0);
    const desc     = parseFloat(descuento) || 0;
    const total    = subtotal - desc;

    const { rows: [oc] } = await client.query(`
      INSERT INTO ordenes_compra
        (proveedor_id, fecha, fecha_entrega_esperada, subtotal, descuento, total, notas, solicitado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [proveedor_id, fecha || new Date().toISOString().split('T')[0],
        fecha_entrega_esperada || null, subtotal, desc, total, notas || null, req.usuario.id]);

    // Folio = OC-XXXXXX
    const folio = 'OC-' + String(oc.id).padStart(5, '0');
    await client.query('UPDATE ordenes_compra SET folio = $1 WHERE id = $2', [folio, oc.id]);
    oc.folio = folio;

    for (const it of items) {
      const sub = parseFloat(it.cantidad_pedida) * parseFloat(it.precio_unitario);
      await client.query(`
        INSERT INTO ordenes_compra_detalle
          (orden_id, inventario_id, descripcion, cantidad_pedida, precio_unitario, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [oc.id, it.inventario_id || null, it.descripcion, it.cantidad_pedida, it.precio_unitario, sub]);
    }

    await client.query('COMMIT');

    const { rows: detalle } = await db.query(
      'SELECT * FROM ordenes_compra_detalle WHERE orden_id = $1 ORDER BY id', [oc.id]
    );
    res.json({ ...oc, items: detalle });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('crear orden:', e.message);
    res.status(500).json({ error: 'Error al crear orden de compra' });
  } finally {
    client.release();
  }
});

// PUT /ordenes/:id/autorizar — autorizar OC (solo admin/director → Nataly)
router.put('/ordenes/:id/autorizar', auth(['director','admin']), async (req, res) => {
  try {
    const { rows: [oc] } = await db.query(
      `SELECT id, estado FROM ordenes_compra WHERE id = $1`, [req.params.id]
    );
    if (!oc) return res.status(404).json({ error: 'Orden no encontrada' });
    if (oc.estado !== 'borrador')
      return res.status(400).json({ error: 'Solo se pueden autorizar órdenes en borrador' });

    const { rows: [updated] } = await db.query(`
      UPDATE ordenes_compra
      SET estado = 'autorizada', autorizado_por = $1, fecha_autorizacion = NOW()
      WHERE id = $2 RETURNING *
    `, [req.usuario.id, req.params.id]);
    res.json(updated);
  } catch (e) {
    console.error('autorizar orden:', e.message);
    res.status(500).json({ error: 'Error al autorizar orden' });
  }
});

// PUT /ordenes/:id/cancelar
router.put('/ordenes/:id/cancelar', auth(['director','admin']), async (req, res) => {
  try {
    const { rows: [oc] } = await db.query('SELECT estado FROM ordenes_compra WHERE id=$1', [req.params.id]);
    if (!oc) return res.status(404).json({ error: 'Orden no encontrada' });
    if (['recibida','cancelada'].includes(oc.estado))
      return res.status(400).json({ error: 'No se puede cancelar esta orden' });

    const { rows: [updated] } = await db.query(
      `UPDATE ordenes_compra SET estado='cancelada' WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json(updated);
  } catch (e) {
    console.error('cancelar orden:', e.message);
    res.status(500).json({ error: 'Error al cancelar orden' });
  }
});

// POST /ordenes/:id/recepcion — recibir mercancía, sube inventario y genera CxP
router.post('/ordenes/:id/recepcion', auth(['director','admin','logistica']), async (req, res) => {
  const { fecha, notas, items } = req.body;
  // items: [{ orden_detalle_id, cantidad }]
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Indica qué artículos se recibieron' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [oc] } = await client.query(
      'SELECT * FROM ordenes_compra WHERE id = $1', [req.params.id]
    );
    if (!oc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada' }); }
    if (!['autorizada','recibida_parcial'].includes(oc.estado))
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La orden debe estar autorizada para recibir' }); }

    // Crear recepción
    const { rows: [rec] } = await client.query(`
      INSERT INTO recepciones (orden_id, fecha, notas, registrado_por)
      VALUES ($1,$2,$3,$4) RETURNING *
    `, [oc.id, fecha || new Date().toISOString().split('T')[0], notas || null, req.usuario.id]);

    let totalRecibido = 0;

    for (const it of items) {
      if (!(it.cantidad > 0)) continue;

      // Obtener línea de la orden
      const { rows: [linea] } = await client.query(
        'SELECT * FROM ordenes_compra_detalle WHERE id=$1 AND orden_id=$2',
        [it.orden_detalle_id, oc.id]
      );
      if (!linea) continue;

      const cantRec = Math.min(parseFloat(it.cantidad),
        parseFloat(linea.cantidad_pedida) - parseFloat(linea.cantidad_recibida));
      if (cantRec <= 0) continue;

      // Detalle de recepción
      await client.query(`
        INSERT INTO recepciones_detalle (recepcion_id, orden_detalle_id, descripcion, cantidad)
        VALUES ($1,$2,$3,$4)
      `, [rec.id, linea.id, linea.descripcion, cantRec]);

      // Actualizar cantidad recibida en detalle de OC
      await client.query(`
        UPDATE ordenes_compra_detalle
        SET cantidad_recibida = cantidad_recibida + $1
        WHERE id = $2
      `, [cantRec, linea.id]);

      // Subir inventario si tiene inventario_id
      if (linea.inventario_id) {
        await client.query(
          'UPDATE inventario SET existencia = existencia + $1, updated_at = NOW() WHERE id = $2',
          [cantRec, linea.inventario_id]
        );
      }

      totalRecibido += cantRec * parseFloat(linea.precio_unitario);
    }

    // Revisar si la orden quedó completa o parcial
    const { rows: lineas } = await client.query(
      'SELECT cantidad_pedida, cantidad_recibida FROM ordenes_compra_detalle WHERE orden_id=$1',
      [oc.id]
    );
    const todosCompletos = lineas.every(l =>
      parseFloat(l.cantidad_recibida) >= parseFloat(l.cantidad_pedida)
    );
    const nuevoEstado = todosCompletos ? 'recibida' : 'recibida_parcial';
    await client.query(
      'UPDATE ordenes_compra SET estado=$1 WHERE id=$2', [nuevoEstado, oc.id]
    );

    // Crear cuenta por pagar si hay monto
    let cxp = null;
    if (totalRecibido > 0) {
      const diasCredito = 30; // crédito estándar de 30 días con proveedor
      const fechaVenc   = new Date();
      fechaVenc.setDate(fechaVenc.getDate() + diasCredito);
      const { rows: [cp] } = await client.query(`
        INSERT INTO cuentas_pagar
          (proveedor_id, orden_id, concepto, monto_total, fecha_emision, fecha_vencimiento, registrado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [
        oc.proveedor_id,
        oc.id,
        `Recepción ${oc.folio} — ${new Date().toLocaleDateString('es-MX')}`,
        totalRecibido,
        fecha || new Date().toISOString().split('T')[0],
        fechaVenc.toISOString().split('T')[0],
        req.usuario.id
      ]);
      cxp = cp;
    }

    await client.query('COMMIT');
    res.json({ recepcion: rec, estado_orden: nuevoEstado, cuenta_pagar: cxp });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('recepcion:', e.message);
    res.status(500).json({ error: 'Error al registrar recepción' });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════════
// CUENTAS POR PAGAR
// ══════════════════════════════════════════════════════════════════

// GET /cuentas-pagar/resumen
router.get('/cuentas-pagar/resumen', auth(), async (req, res) => {
  try {
    const { rows: [r] } = await db.query(`
      SELECT
        COUNT(*)                                                             AS cuentas,
        COALESCE(SUM(monto_total - monto_pagado), 0)                         AS total_por_pagar,
        COALESCE(SUM(monto_total - monto_pagado)
          FILTER (WHERE fecha_vencimiento < CURRENT_DATE), 0)                AS vencido,
        COALESCE(SUM(monto_total - monto_pagado)
          FILTER (WHERE fecha_vencimiento >= CURRENT_DATE OR fecha_vencimiento IS NULL), 0) AS por_vencer,
        COUNT(DISTINCT proveedor_id)                                         AS proveedores_con_deuda
      FROM cuentas_pagar
      WHERE estado IN ('pendiente','parcial')
    `);
    res.json(r);
  } catch (e) {
    console.error('cxp resumen:', e.message);
    res.status(500).json({ error: 'Error al obtener resumen' });
  }
});

// GET /cuentas-pagar — listar con filtros
router.get('/cuentas-pagar', auth(), async (req, res) => {
  const { proveedor_id, estado, vencidas } = req.query;
  let q = `
    SELECT cp.*,
           cp.monto_total - cp.monto_pagado       AS saldo_pendiente,
           CURRENT_DATE - cp.fecha_vencimiento     AS dias_vencido,
           p.nombre  AS proveedor_nombre,
           oc.folio  AS orden_folio,
           u.nombre  AS registrado_nombre
    FROM cuentas_pagar cp
    LEFT JOIN proveedores    p  ON cp.proveedor_id = p.id
    LEFT JOIN ordenes_compra oc ON cp.orden_id     = oc.id
    LEFT JOIN usuarios       u  ON cp.registrado_por = u.id
    WHERE cp.estado IN ('pendiente','parcial')
  `;
  const params = [];
  if (proveedor_id) { params.push(proveedor_id); q += ` AND cp.proveedor_id = $${params.length}`; }
  if (estado)       { params.push(estado);        q += ` AND cp.estado = $${params.length}`; }
  if (vencidas === 'true') q += ' AND cp.fecha_vencimiento < CURRENT_DATE';
  q += ' ORDER BY cp.fecha_vencimiento ASC NULLS LAST';

  try {
    const { rows } = await db.query(q, params);
    res.json(rows);
  } catch (e) {
    console.error('listar cxp:', e.message);
    res.status(500).json({ error: 'Error al obtener cuentas por pagar' });
  }
});

// POST /cuentas-pagar/:id/pago — registrar pago a proveedor
router.post('/cuentas-pagar/:id/pago', auth(['director','admin']), async (req, res) => {
  const { monto, tipo_pago, fecha, referencia, notas } = req.body;
  if (!monto || parseFloat(monto) <= 0)
    return res.status(400).json({ error: 'El monto debe ser mayor a $0' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: [cp] } = await client.query(
      'SELECT * FROM cuentas_pagar WHERE id=$1', [req.params.id]
    );
    if (!cp) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Cuenta no encontrada' }); }

    const saldo       = parseFloat(cp.monto_total) - parseFloat(cp.monto_pagado);
    const montoAplicar = Math.min(parseFloat(monto), saldo);

    if (montoAplicar <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Esta cuenta ya está liquidada' });
    }

    // Registrar pago
    const { rows: [pago] } = await client.query(`
      INSERT INTO pagos_proveedor
        (cuenta_pagar_id, fecha, monto, tipo_pago, referencia, notas, registrado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [cp.id, fecha || new Date().toISOString().split('T')[0],
        montoAplicar, tipo_pago || 'Transferencia',
        referencia || null, notas || null, req.usuario.id]);

    // Actualizar cuenta
    const nuevoPagado = parseFloat(cp.monto_pagado) + montoAplicar;
    const nuevoEstado = nuevoPagado >= parseFloat(cp.monto_total) ? 'pagado' : 'parcial';
    await client.query(
      'UPDATE cuentas_pagar SET monto_pagado=$1, estado=$2 WHERE id=$3',
      [nuevoPagado, nuevoEstado, cp.id]
    );

    await client.query('COMMIT');
    res.json({ pago, estado: nuevoEstado, saldo_restante: parseFloat(cp.monto_total) - nuevoPagado });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('registrar pago proveedor:', e.message);
    res.status(500).json({ error: 'Error al registrar pago' });
  } finally {
    client.release();
  }
});

module.exports = router;
