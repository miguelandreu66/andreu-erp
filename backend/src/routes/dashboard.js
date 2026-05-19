const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth(), async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const si = new Date(new Date().setDate(
      new Date().getDate() - new Date().getDay() + (new Date().getDay() === 0 ? -6 : 1)
    )).toISOString().split('T')[0];
    const sf = new Date(new Date(si).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Consultas principales
    const [
      ventasHoy, ventasSemana,
      gastosHoy, gastosSemana,
      viajesHoy, viajesSemana,
      inventario, nominaSemana, gastosPendientes
    ] = await Promise.all([
      db.query('SELECT COALESCE(SUM(COALESCE(total,monto)),0) AS total FROM ventas WHERE fecha=$1', [hoy]),
      db.query('SELECT COALESCE(SUM(COALESCE(total,monto)),0) AS total FROM ventas WHERE fecha BETWEEN $1 AND $2', [si, sf]),
      db.query("SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE fecha=$1 AND estado_aprobacion!='rechazado'", [hoy]),
      db.query("SELECT COALESCE(SUM(monto),0) AS total FROM gastos WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion!='rechazado'", [si, sf]),
      db.query("SELECT COUNT(*) AS total FROM viajes WHERE fecha=$1 AND estado='Completado'", [hoy]),
      db.query("SELECT COUNT(*) AS total FROM viajes WHERE fecha BETWEEN $1 AND $2 AND estado='Completado'", [si, sf]),
      db.query('SELECT * FROM inventario ORDER BY producto'),
      db.query('SELECT COALESCE(SUM(total_pago),0) AS total FROM nomina_pagos WHERE semana_inicio=$1', [si]),
      db.query("SELECT COUNT(*) AS total FROM gastos WHERE estado_aprobacion='pendiente'"),
    ]);

    // CXC — cuentas por cobrar (safe: falla silenciosamente si no existe la tabla)
    const cxcData = await db.query(`
      SELECT
        COALESCE(SUM(COALESCE(v.total, v.monto) - COALESCE(ab.ya_abonado, 0)), 0) AS total_por_cobrar,
        COUNT(*) FILTER (
          WHERE CURRENT_DATE - COALESCE(v.fecha_vencimiento, v.fecha) > 30
        ) AS cuentas_vencidas
      FROM ventas v
      LEFT JOIN (
        SELECT venta_id, SUM(monto) AS ya_abonado FROM abonos GROUP BY venta_id
      ) ab ON ab.venta_id = v.id
      WHERE v.estado_pago IN ('pendiente','parcial')
    `).catch(() => ({ rows: [{ total_por_cobrar: 0, cuentas_vencidas: 0 }] }));

    // CxP — cuentas por pagar (safe: falla silenciosamente si no existe la tabla)
    const cxpData = await db.query(`
      SELECT
        COALESCE(SUM(monto_original - COALESCE(monto_pagado, 0)), 0) AS total_por_pagar,
        COUNT(*) FILTER (
          WHERE fecha_vencimiento <= CURRENT_DATE + INTERVAL '7 days'
        ) AS proximas_a_vencer
      FROM cuentas_pagar
      WHERE estado IN ('pendiente','parcial')
    `).catch(() => ({ rows: [{ total_por_pagar: 0, proximas_a_vencer: 0 }] }));

    const cxc = cxcData.rows[0];
    const cxp = cxpData.rows[0];

    const ingSemana = parseFloat(ventasSemana.rows[0].total);
    const egrSemana = parseFloat(gastosSemana.rows[0].total);
    const margen = ingSemana > 0 ? ((ingSemana - egrSemana) / ingSemana * 100).toFixed(1) : 0;
    const viajesSemanaCount = parseInt(viajesSemana.rows[0].total);
    const nomSemana = parseFloat(nominaSemana.rows[0].total);
    const cxcVencidas = parseInt(cxc.cuentas_vencidas) || 0;
    const cxpProximas = parseInt(cxp.proximas_a_vencer) || 0;

    // ── Alertas automáticas ─────────────────────────────────────────
    const alertas = [];

    if (parseFloat(ventasHoy.rows[0].total) === 0 && new Date().getHours() >= 14) {
      alertas.push({ tipo: 'amber', msg: 'Sin ventas registradas hoy. Confirmar con Chilapa.', modulo: 'caja' });
    }

    const gSinComp = await db.query(
      "SELECT COUNT(*) AS total FROM gastos WHERE fecha BETWEEN $1 AND $2 AND comprobante=false AND estado_aprobacion!='rechazado'",
      [si, sf]
    );
    if (parseInt(gSinComp.rows[0].total) > 0) {
      alertas.push({ tipo: 'red', msg: `${gSinComp.rows[0].total} gasto(s) sin comprobante esta semana.`, modulo: 'gastos' });
    }

    if (parseInt(gastosPendientes.rows[0].total) > 0) {
      alertas.push({ tipo: 'amber', msg: `${gastosPendientes.rows[0].total} gasto(s) pendientes de aprobación.`, modulo: 'gastos' });
    }

    if (viajesSemanaCount < 15 && new Date().getDay() >= 4) {
      alertas.push({ tipo: 'amber', msg: `Solo ${viajesSemanaCount} viajes esta semana. Meta: 25.`, modulo: 'flota' });
    }

    if (nomSemana < 30000) {
      alertas.push({ tipo: 'amber', msg: `Nómina semana: $${nomSemana.toLocaleString('es-MX')} / $30,000 mínimo.`, modulo: 'nomina' });
    }

    if (ingSemana > 0 && parseFloat(margen) < 15) {
      alertas.push({ tipo: 'red', msg: `Margen ${margen}% — por debajo del 15% objetivo.`, modulo: 'reportes' });
    }

    if (cxcVencidas > 0) {
      const totalCXC = Math.round(parseFloat(cxc.total_por_cobrar)).toLocaleString('es-MX');
      alertas.push({ tipo: 'red', msg: `${cxcVencidas} cuenta(s) por cobrar vencidas (+30 días). Total: $${totalCXC}.`, modulo: 'cxc' });
    }

    if (cxpProximas > 0) {
      alertas.push({ tipo: 'amber', msg: `${cxpProximas} pago(s) a proveedor(es) vence(n) en los próximos 7 días.`, modulo: 'compras' });
    }

    inventario.rows.forEach(inv => {
      if (parseFloat(inv.existencia) <= parseFloat(inv.punto_reorden)) {
        alertas.push({ tipo: 'amber', msg: `Inventario bajo: ${inv.producto} (${inv.existencia} ${inv.unidad}).`, modulo: 'inventario' });
      }
    });

    if (alertas.length === 0) alertas.push({ tipo: 'green', msg: 'Todo en orden. Sin alertas activas.', modulo: 'general' });

    res.json({
      hoy,
      semana: { inicio: si, fin: sf },
      ventas_hoy:      parseFloat(ventasHoy.rows[0].total),
      ventas_semana:   ingSemana,
      gastos_hoy:      parseFloat(gastosHoy.rows[0].total),
      gastos_semana:   egrSemana,
      viajes_hoy:      parseInt(viajesHoy.rows[0].total),
      viajes_semana:   viajesSemanaCount,
      utilidad_semana: ingSemana - egrSemana,
      margen_semana:   parseFloat(margen),
      nomina_semana:   nomSemana,
      caja_estimada:   ingSemana - egrSemana,
      inventario:      inventario.rows,
      alertas,
      meta_viajes: 25,
      min_nomina:  30000,
      // CXC
      cxc_total_por_cobrar: parseFloat(cxc.total_por_cobrar) || 0,
      cxc_cuentas_vencidas: cxcVencidas,
      // CxP
      cxp_total_por_pagar:   parseFloat(cxp.total_por_pagar) || 0,
      cxp_proximas_a_vencer: cxpProximas,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en dashboard' });
  }
});

// Reporte del día en texto (para WhatsApp)
router.get('/reporte-dia', auth(), async (req, res) => {
  const hoy = req.query.fecha || new Date().toISOString().split('T')[0];
  const [ventas, gastos, viajes] = await Promise.all([
    db.query(`
      SELECT vd.descripcion AS producto, SUM(vd.subtotal) AS total
      FROM ventas v
      JOIN ventas_detalle vd ON vd.venta_id = v.id
      WHERE v.fecha = $1
      GROUP BY vd.descripcion
      UNION ALL
      SELECT v.producto, SUM(v.monto) AS total
      FROM ventas v
      WHERE v.fecha = $1 AND v.producto IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ventas_detalle WHERE venta_id = v.id)
      GROUP BY v.producto
    `, [hoy]).catch(() =>
      db.query('SELECT producto, SUM(monto) AS total FROM ventas WHERE fecha=$1 GROUP BY producto', [hoy])
    ),
    db.query("SELECT categoria, SUM(monto) AS total, COUNT(*) FILTER (WHERE comprobante=false) AS sin_comp FROM gastos WHERE fecha=$1 AND estado_aprobacion!='rechazado' GROUP BY categoria", [hoy]),
    db.query("SELECT o.nombre AS operador, v.destino, v.estado FROM viajes v LEFT JOIN operadores o ON v.operador_id=o.id WHERE v.fecha=$1", [hoy]),
  ]);
  const totalVentas = ventas.rows.reduce((a, v) => a + parseFloat(v.total), 0);
  const totalGastos = gastos.rows.reduce((a, g) => a + parseFloat(g.total), 0);
  const fmtDate = d => { const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
  const fmt = n => `$${Math.round(n).toLocaleString('es-MX')}`;

  let txt = `REPORTE DIARIO — GRUPO ANDREU\n`;
  txt += `Fecha: ${fmtDate(hoy)}\n`;
  txt += `────────────────────────\n`;
  txt += `VENTAS: ${fmt(totalVentas)}\n`;
  ventas.rows.forEach(v => { txt += `  · ${v.producto}: ${fmt(v.total)}\n`; });
  txt += `\nEGRESOS: ${fmt(totalGastos)}\n`;
  gastos.rows.forEach(g => { txt += `  · ${g.categoria}: ${fmt(g.total)}${parseInt(g.sin_comp) > 0 ? ' ⚠ sin comprobante' : ''}\n`; });
  txt += `\nFLOTA: ${viajes.rows.filter(v => v.estado === 'Completado').length} viaje(s)\n`;
  viajes.rows.forEach(v => { txt += `  · ${v.operador} → ${v.destino} [${v.estado}]\n`; });
  txt += `\nRESULTADO: ${fmt(totalVentas - totalGastos)}\n`;
  txt += `────────────────────────\n`;
  txt += `Sistema ERP Grupo Andreu`;

  res.json({ texto: txt });
});

// Dashboard operativo consolidado: KPIs de flota propia con ventana móvil
// Una llamada, todos los datos para la página /operativo
router.get('/operativo', auth(['director','admin','caja','logistica','monitoreo']), async (req, res) => {
  const dias = Math.max(1, Math.min(parseInt(req.query.dias || '30', 10), 365));
  try {
    // ── KPIs principales ──
    const { rows: [kpis] } = await db.query(`
      WITH ventas_periodo AS (
        SELECT COALESCE(SUM(COALESCE(total, monto)), 0)::float AS ingresos,
               COUNT(*)::int AS facturas_emitidas,
               COALESCE(AVG(COALESCE(total, monto)), 0)::float AS ticket_promedio
        FROM ventas
        WHERE fecha >= CURRENT_DATE - ($1::int || ' days')::interval
      ),
      gastos_periodo AS (
        SELECT COALESCE(SUM(monto), 0)::float AS gastos_total
        FROM gastos
        WHERE fecha >= CURRENT_DATE - ($1::int || ' days')::interval
          AND estado_aprobacion != 'rechazado'
      ),
      viajes_periodo AS (
        SELECT COUNT(*)::int AS viajes_total,
               COUNT(*) FILTER (WHERE estado = 'Completado')::int AS viajes_completados
        FROM viajes
        WHERE fecha >= CURRENT_DATE - ($1::int || ' days')::interval
      ),
      cxc_data AS (
        SELECT COALESCE(SUM(COALESCE(v.total, v.monto) - COALESCE(ab.ya_abonado, 0)), 0)::float AS por_cobrar
        FROM ventas v
        LEFT JOIN (
          SELECT venta_id, SUM(monto) AS ya_abonado FROM abonos GROUP BY venta_id
        ) ab ON ab.venta_id = v.id
        WHERE v.tipo_venta = 'credito' AND COALESCE(v.estado_pago, 'pendiente') != 'pagado'
      )
      SELECT
        vp.ingresos, vp.facturas_emitidas, vp.ticket_promedio,
        gp.gastos_total,
        (vp.ingresos - gp.gastos_total)::float AS margen_bruto,
        vip.viajes_total, vip.viajes_completados,
        cxc.por_cobrar
      FROM ventas_periodo vp, gastos_periodo gp, viajes_periodo vip, cxc_data cxc
    `, [dias]);

    // ── Serie diaria de ingresos vs gastos ──
    const { rows: serie } = await db.query(`
      WITH dias AS (
        SELECT generate_series(
          (CURRENT_DATE - ($1::int || ' days')::interval)::date,
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS fecha
      )
      SELECT
        d.fecha::text AS fecha,
        COALESCE((SELECT SUM(COALESCE(total, monto))
                  FROM ventas WHERE fecha = d.fecha), 0)::float AS ingresos,
        COALESCE((SELECT SUM(monto)
                  FROM gastos WHERE fecha = d.fecha AND estado_aprobacion != 'rechazado'), 0)::float AS gastos,
        COALESCE((SELECT COUNT(*) FROM viajes WHERE fecha = d.fecha AND estado = 'Completado'), 0)::int AS viajes
      FROM dias d
      ORDER BY d.fecha ASC
    `, [dias]);

    // ── Top operadores por viajes completados ──
    let topOperadores = [];
    try {
      const { rows } = await db.query(`
        SELECT
          o.id,
          o.nombre,
          COUNT(v.id)::int AS viajes_total,
          COUNT(v.id) FILTER (WHERE v.estado = 'Completado')::int AS viajes_completados,
          COALESCE(AVG(NULLIF(v.kilometros, 0)), 0)::float AS km_promedio
        FROM operadores o
        LEFT JOIN viajes v ON v.operador_id = o.id
          AND v.fecha >= CURRENT_DATE - ($1::int || ' days')::interval
        WHERE o.activo = true OR o.activo IS NULL
        GROUP BY o.id, o.nombre
        HAVING COUNT(v.id) > 0
        ORDER BY viajes_completados DESC, viajes_total DESC
        LIMIT 5
      `, [dias]);
      topOperadores = rows;
    } catch { /* schema variante en operadores, ignora */ }

    // ── Gastos por categoría ──
    let gastosCategorias = [];
    try {
      const { rows } = await db.query(`
        SELECT
          COALESCE(tipo, categoria, 'otros') AS categoria,
          COUNT(*)::int AS cantidad,
          COALESCE(SUM(monto), 0)::float AS total
        FROM gastos
        WHERE fecha >= CURRENT_DATE - ($1::int || ' days')::interval
          AND estado_aprobacion != 'rechazado'
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 8
      `, [dias]);
      gastosCategorias = rows;
    } catch { /* schema variante, ignora */ }

    res.json({
      dias_ventana: dias,
      kpis,
      serie_diaria: serie,
      top_operadores: topOperadores,
      gastos_categorias: gastosCategorias,
    });
  } catch (e) {
    console.error('dashboard/operativo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
