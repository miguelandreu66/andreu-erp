const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── Helper: rango completo de un mes ─────────────────────────────
function rangoMes(query) {
  const ahora = new Date();
  const anio  = parseInt(query.anio) || ahora.getFullYear();
  const mes   = parseInt(query.mes)  || (ahora.getMonth() + 1);
  const fi    = `${anio}-${String(mes).padStart(2,'0')}-01`;
  const ultimo = new Date(anio, mes, 0).getDate();
  const ff    = `${anio}-${String(mes).padStart(2,'0')}-${ultimo}`;
  return { fi, ff, anio, mes };
}

// ══════════════════════════════════════════════════════════════════
// GET /ejecutivo/mensual — Estado de resultados
// ══════════════════════════════════════════════════════════════════
router.get('/ejecutivo/mensual', auth(['director','admin','monitoreo']), async (req, res) => {
  const { fi, ff, anio, mes } = rangoMes(req.query);
  try {
    // Ingresos: todas las ventas del período
    const { rows: [ing] } = await db.query(`
      SELECT
        COALESCE(SUM(COALESCE(total, monto)), 0)                              AS ventas_total,
        COALESCE(SUM(COALESCE(total, monto)) FILTER (WHERE tipo_venta='contado'), 0) AS ventas_contado,
        COALESCE(SUM(COALESCE(total, monto)) FILTER (WHERE tipo_venta='credito'), 0) AS ventas_credito,
        COUNT(*)                                                               AS num_ventas
      FROM ventas
      WHERE fecha BETWEEN $1 AND $2
    `, [fi, ff]);

    // Cobrado real (contado + abonos del período)
    const { rows: [cobrado] } = await db.query(`
      SELECT COALESCE(SUM(monto), 0) AS total_abonos
      FROM abonos WHERE fecha BETWEEN $1 AND $2
    `, [fi, ff]);
    const ventas_contado = parseFloat(ing.ventas_contado) || 0;
    const abonos_mes     = parseFloat(cobrado.total_abonos) || 0;
    const cobrado_real   = ventas_contado + abonos_mes;

    // Gastos
    const { rows: [gastos] } = await db.query(`
      SELECT COALESCE(SUM(monto), 0) AS total
      FROM gastos
      WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion = 'aprobado'
    `, [fi, ff]);

    const { rows: [diesel] } = await db.query(`
      SELECT COALESCE(SUM(diesel_costo), 0) AS total,
             COALESCE(SUM(diesel_litros), 0) AS litros
      FROM viajes
      WHERE fecha BETWEEN $1 AND $2 AND estado = 'Completado'
    `, [fi, ff]);

    const { rows: [nomina] } = await db.query(`
      SELECT COALESCE(SUM(total_pago), 0) AS total, COUNT(*) AS empleados
      FROM nomina_pagos
      WHERE semana_inicio BETWEEN $1 AND $2 AND pagado = true
    `, [fi, ff]);

    const { rows: [mant] } = await db.query(`
      SELECT COALESCE(SUM(costo), 0) AS total
      FROM mantenimientos
      WHERE fecha BETWEEN $1 AND $2
    `, [fi, ff]);

    const { rows: [compras] } = await db.query(`
      SELECT COALESCE(SUM(monto_total), 0) AS total
      FROM cuentas_pagar
      WHERE fecha_emision BETWEEN $1 AND $2
    `, [fi, ff]);

    // Ensamblar estado de resultados
    const ingresos          = parseFloat(ing.ventas_total)  || 0;
    const gasto_gastos      = parseFloat(gastos.total)      || 0;
    const gasto_diesel      = parseFloat(diesel.total)      || 0;
    const gasto_nomina      = parseFloat(nomina.total)      || 0;
    const gasto_mant        = parseFloat(mant.total)        || 0;
    const gasto_compras     = parseFloat(compras.total)     || 0;
    const total_gastos      = gasto_gastos + gasto_diesel + gasto_nomina + gasto_mant + gasto_compras;
    const utilidad          = ingresos - total_gastos;
    const margen_pct        = ingresos > 0 ? ((utilidad / ingresos) * 100).toFixed(1) : 0;

    res.json({
      periodo: { fi, ff, anio, mes },
      ingresos: {
        ventas_total:   ingresos,
        ventas_contado: ventas_contado,
        ventas_credito: parseFloat(ing.ventas_credito) || 0,
        cobrado_real,
        num_ventas:     parseInt(ing.num_ventas) || 0,
      },
      gastos: {
        nomina:       gasto_nomina,
        diesel:       gasto_diesel,
        diesel_litros: parseFloat(diesel.litros) || 0,
        operativos:   gasto_gastos,
        mantenimiento: gasto_mant,
        compras:      gasto_compras,
        total:        total_gastos,
      },
      resultado: {
        utilidad,
        margen_pct: parseFloat(margen_pct),
      },
    });
  } catch (e) {
    console.error('reporte mensual:', e.message);
    res.status(500).json({ error: 'Error al generar estado de resultados' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /ejecutivo/por-producto — ingresos y margen por producto
// ══════════════════════════════════════════════════════════════════
router.get('/ejecutivo/por-producto', auth(['director','admin','monitoreo']), async (req, res) => {
  const { fi, ff } = rangoMes(req.query);
  try {
    // Ventas por producto (desde ventas_detalle)
    const { rows: ventas } = await db.query(`
      SELECT
        vd.descripcion                    AS producto,
        COUNT(DISTINCT v.id)              AS num_ventas,
        SUM(vd.cantidad)                  AS cantidad_vendida,
        AVG(vd.precio_unitario)           AS precio_venta_prom,
        SUM(vd.subtotal)                  AS ingreso_total
      FROM ventas_detalle vd
      JOIN ventas v ON vd.venta_id = v.id
      WHERE v.fecha BETWEEN $1 AND $2
      GROUP BY vd.descripcion
      ORDER BY SUM(vd.subtotal) DESC
    `, [fi, ff]);

    // Costo promedio de compra por producto (de órdenes de compra recibidas)
    const { rows: costos } = await db.query(`
      SELECT
        ocd.descripcion,
        AVG(ocd.precio_unitario) AS costo_compra_prom
      FROM ordenes_compra_detalle ocd
      JOIN ordenes_compra oc ON ocd.orden_id = oc.id
      WHERE oc.estado IN ('recibida','recibida_parcial')
      GROUP BY ocd.descripcion
    `);

    const costosMap = {};
    costos.forEach(c => { costosMap[c.descripcion] = parseFloat(c.costo_compra_prom) || 0; });

    const total_ingresos = ventas.reduce((s, p) => s + parseFloat(p.ingreso_total), 0);

    const resultado = ventas.map(p => {
      const ingreso      = parseFloat(p.ingreso_total)     || 0;
      const precio_venta = parseFloat(p.precio_venta_prom) || 0;
      const costo        = costosMap[p.producto]           || 0;
      const margen_unit  = costo > 0 ? precio_venta - costo : null;
      const margen_pct   = costo > 0 && precio_venta > 0
        ? (((precio_venta - costo) / precio_venta) * 100).toFixed(1)
        : null;
      return {
        producto:          p.producto,
        num_ventas:        parseInt(p.num_ventas),
        cantidad_vendida:  parseFloat(p.cantidad_vendida),
        precio_venta_prom: precio_venta,
        costo_compra_prom: costo || null,
        margen_unitario:   margen_unit,
        margen_pct:        margen_pct ? parseFloat(margen_pct) : null,
        ingreso_total:     ingreso,
        pct_del_total:     total_ingresos > 0
          ? parseFloat(((ingreso / total_ingresos) * 100).toFixed(1))
          : 0,
      };
    });

    res.json({ productos: resultado, total_ingresos, periodo: { fi, ff } });
  } catch (e) {
    console.error('reporte por producto:', e.message);
    res.status(500).json({ error: 'Error al generar reporte de productos' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /ejecutivo/top-clientes — top 10 clientes por compras
// ══════════════════════════════════════════════════════════════════
router.get('/ejecutivo/top-clientes', auth(['director','admin','monitoreo']), async (req, res) => {
  const dias = parseInt(req.query.dias) || 90;
  const fi   = new Date(); fi.setDate(fi.getDate() - dias);
  const fiStr = fi.toISOString().split('T')[0];
  const hoy   = new Date().toISOString().split('T')[0];

  try {
    const { rows } = await db.query(`
      WITH compras_cliente AS (
        SELECT
          c.id,
          c.nombre,
          c.tipo,
          c.telefono,
          COUNT(v.id)                                     AS num_compras,
          COALESCE(SUM(COALESCE(v.total, v.monto)), 0)    AS total_comprado,
          MAX(v.fecha)                                    AS ultima_compra,
          AVG(COALESCE(v.total, v.monto))                 AS ticket_promedio
        FROM clientes c
        JOIN ventas v ON v.cliente_id = c.id
        WHERE v.fecha BETWEEN $1 AND $2
        GROUP BY c.id, c.nombre, c.tipo, c.telefono
      ),
      saldos_cliente AS (
        SELECT
          v.cliente_id,
          COALESCE(SUM(COALESCE(v.total, v.monto)) - COALESCE(SUM(a.monto), 0), 0) AS saldo_pendiente
        FROM ventas v
        LEFT JOIN abonos a ON a.venta_id = v.id
        WHERE v.estado_pago IN ('pendiente','parcial')
        GROUP BY v.cliente_id
      )
      SELECT
        cc.*,
        COALESCE(sc.saldo_pendiente, 0) AS saldo_pendiente
      FROM compras_cliente cc
      LEFT JOIN saldos_cliente sc ON sc.cliente_id = cc.id
      ORDER BY cc.total_comprado DESC
      LIMIT 10
    `, [fiStr, hoy]);

    res.json({ clientes: rows, periodo_dias: dias, fecha_inicio: fiStr, fecha_fin: hoy });
  } catch (e) {
    console.error('top clientes:', e.message);
    res.status(500).json({ error: 'Error al generar top clientes' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /ejecutivo/rentabilidad-flota — costos por unidad
// ══════════════════════════════════════════════════════════════════
router.get('/ejecutivo/rentabilidad-flota', auth(['director','admin','monitoreo']), async (req, res) => {
  const { fi, ff } = rangoMes(req.query);
  try {
    const { rows } = await db.query(`
      SELECT
        u.id,
        u.placas,
        u.descripcion,
        COALESCE(u.marca, '') || ' ' || COALESCE(u.modelo, '')  AS vehiculo,
        -- Operación
        COUNT(v.id)  FILTER (WHERE v.estado = 'Completado')     AS viajes,
        COALESCE(SUM(v.km_recorridos)  FILTER (WHERE v.estado='Completado'), 0) AS km_total,
        COALESCE(SUM(v.toneladas)      FILTER (WHERE v.estado='Completado'), 0) AS toneladas,
        COALESCE(SUM(v.diesel_litros)  FILTER (WHERE v.estado='Completado'), 0) AS litros,
        COALESCE(SUM(v.diesel_costo)   FILTER (WHERE v.estado='Completado'), 0) AS costo_diesel,
        -- Mantenimiento del período
        COALESCE(
          (SELECT SUM(m.costo) FROM mantenimientos m
           WHERE m.unidad_id = u.id AND m.fecha BETWEEN $1 AND $2), 0
        ) AS costo_mantenimiento,
        -- Rendimiento
        COALESCE(
          SUM(v.diesel_litros) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0), 0)
        , 0) AS rendimiento_lt_km
      FROM unidades u
      LEFT JOIN viajes v ON v.unidad_id = u.id AND v.fecha BETWEEN $1 AND $2
      WHERE u.activo = true
      GROUP BY u.id, u.placas, u.descripcion, u.marca, u.modelo
      ORDER BY (
        COALESCE(SUM(v.diesel_costo) FILTER (WHERE v.estado='Completado'), 0)
        + COALESCE(
            (SELECT SUM(m.costo) FROM mantenimientos m
             WHERE m.unidad_id = u.id AND m.fecha BETWEEN $1 AND $2), 0)
      ) DESC
    `, [fi, ff]);

    const resultado = rows.map(u => ({
      ...u,
      costo_total: parseFloat(u.costo_diesel) + parseFloat(u.costo_mantenimiento),
      costo_por_km: parseFloat(u.km_total) > 0
        ? (parseFloat(u.costo_diesel) + parseFloat(u.costo_mantenimiento)) / parseFloat(u.km_total)
        : null,
      costo_por_ton: parseFloat(u.toneladas) > 0
        ? parseFloat(u.costo_diesel) / parseFloat(u.toneladas)
        : null,
    }));

    res.json({ unidades: resultado, periodo: { fi, ff } });
  } catch (e) {
    console.error('rentabilidad flota:', e.message);
    res.status(500).json({ error: 'Error al generar rentabilidad de flota' });
  }
});

module.exports = router;
