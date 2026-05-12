const db = require('../../db');

// Insights comerciales generados por la IA — todos derivados de queries.
// Diseñados para Andreu Logistics: B2B carga pesada, cobranza 30d, sin POS.

// ── 1) Cobranza vencida (ventas pendientes con fecha_vencimiento pasada) ─
async function cobranzaVencida() {
  const { rows } = await db.query(`
    SELECT
      v.id, v.fecha, v.fecha_vencimiento, v.total, v.estado_pago,
      c.id AS cliente_id, c.nombre AS cliente, c.telefono,
      (CURRENT_DATE - v.fecha_vencimiento)::int AS dias_vencido
    FROM ventas v
    LEFT JOIN clientes c ON c.id = v.cliente_id
    WHERE v.estado_pago = 'pendiente'
      AND v.fecha_vencimiento IS NOT NULL
      AND v.fecha_vencimiento < CURRENT_DATE
    ORDER BY v.fecha_vencimiento ASC
    LIMIT 25
  `);
  const totalVencido = rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
  return { items: rows, total_vencido: totalVencido, count: rows.length };
}

// ── 2) Clientes inactivos (sin actividad en 60d — riesgo churn) ─
async function clientesEnRiesgo(dias = 60) {
  const { rows } = await db.query(`
    WITH ultima_actividad AS (
      SELECT cliente_id, MAX(fecha) AS ultima_fecha
      FROM (
        SELECT cliente_id, fecha FROM ventas WHERE cliente_id IS NOT NULL
        UNION ALL
        SELECT cliente_id, fecha FROM cotizaciones WHERE cliente_id IS NOT NULL
      ) acts
      GROUP BY cliente_id
    )
    SELECT
      c.id, c.nombre, c.telefono, c.tipo,
      ua.ultima_fecha,
      CASE WHEN ua.ultima_fecha IS NULL THEN NULL
           ELSE (CURRENT_DATE - ua.ultima_fecha)::int END AS dias_sin_actividad,
      (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE cliente_id = c.id)::float AS valor_historico
    FROM clientes c
    LEFT JOIN ultima_actividad ua ON ua.cliente_id = c.id
    WHERE c.activo = true
      AND (ua.ultima_fecha IS NULL OR ua.ultima_fecha < CURRENT_DATE - ($1::int || ' days')::interval)
    ORDER BY valor_historico DESC NULLS LAST, c.nombre
    LIMIT 20
  `, [dias]);
  return { items: rows, count: rows.length, dias_corte: dias };
}

// ── 3) Cotizaciones aprobadas sin convertir a viaje/venta ─
async function cotizacionesPendientes() {
  const { rows } = await db.query(`
    SELECT
      co.id, co.folio, co.fecha, co.fecha_vencimiento, co.total, co.estado,
      c.id AS cliente_id, c.nombre AS cliente, c.telefono,
      (CURRENT_DATE - co.fecha)::int AS dias_desde_emision,
      CASE
        WHEN co.fecha_vencimiento IS NOT NULL AND co.fecha_vencimiento < CURRENT_DATE THEN true
        ELSE false
      END AS vencida
    FROM cotizaciones co
    LEFT JOIN clientes c ON c.id = co.cliente_id
    WHERE co.venta_id IS NULL
      AND co.estado IN ('aprobada','aceptada','enviada','pendiente')
    ORDER BY co.fecha ASC
    LIMIT 20
  `);
  const totalPotencial = rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
  return { items: rows, count: rows.length, total_potencial: totalPotencial };
}

// ── 4) Precio sugerido por ruta basado en histórico ─
async function preciosPorRuta() {
  const { rows } = await db.query(`
    SELECT
      v.destino,
      v.origen,
      COUNT(*)::int                                                  AS viajes,
      ROUND(AVG(v.km_recorridos)::numeric, 1)::float                  AS km_promedio,
      ROUND(AVG(v.diesel_costo)::numeric, 2)::float                   AS diesel_promedio,
      ROUND(AVG(ven.total)::numeric, 2)::float                        AS precio_promedio,
      ROUND(MIN(ven.total)::numeric, 2)::float                        AS precio_min,
      ROUND(MAX(ven.total)::numeric, 2)::float                        AS precio_max,
      MAX(v.fecha)                                                    AS ultimo_viaje
    FROM viajes v
    LEFT JOIN ventas ven
           ON ven.cliente_id IS NOT NULL
          AND ven.fecha = v.fecha
          AND ven.notas ILIKE '%' || v.destino || '%'
    WHERE v.estado = 'Completado'
      AND v.destino IS NOT NULL
      AND v.fecha >= CURRENT_DATE - INTERVAL '180 days'
    GROUP BY v.destino, v.origen
    HAVING COUNT(*) >= 2
    ORDER BY viajes DESC
    LIMIT 15
  `);
  return { items: rows, count: rows.length };
}

// ── 5) Briefing ejecutivo (consolida todo en texto + métricas) ─
async function briefingEjecutivo() {
  const [{ rows: [resumen] }, cv, cr, cp] = await Promise.all([
    db.query(`
      SELECT
        (SELECT COUNT(*) FROM viajes WHERE estado = 'En ruta')::int                                AS viajes_en_ruta,
        (SELECT COUNT(*) FROM viajes WHERE estado = 'Completado' AND fecha >= CURRENT_DATE - INTERVAL '7 days')::int AS viajes_7d,
        (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE fecha >= CURRENT_DATE - INTERVAL '30 days')::float    AS ingresos_30d,
        (SELECT COALESCE(SUM(diesel_costo), 0) FROM viajes WHERE fecha >= CURRENT_DATE - INTERVAL '30 days')::float AS diesel_30d,
        (SELECT COUNT(*) FROM alertas WHERE estado = 'pendiente' AND nivel = 'critico')::int       AS alertas_criticas,
        (SELECT COUNT(*) FROM clientes WHERE activo = true)::int                                   AS clientes_activos
    `),
    cobranzaVencida(),
    clientesEnRiesgo(60),
    cotizacionesPendientes(),
  ]);

  const lineas = [
    `📊 BRIEFING EJECUTIVO — ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
    '',
    `🚛 Operación:`,
    `   • ${resumen.viajes_en_ruta} viaje(s) en ruta ahora`,
    `   • ${resumen.viajes_7d} viajes completados últimos 7 días`,
    `   • ${resumen.alertas_criticas} alertas críticas pendientes`,
    '',
    `💰 Comercial:`,
    `   • Ingresos últimos 30d: $${resumen.ingresos_30d.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
    `   • Diesel últimos 30d: $${resumen.diesel_30d.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
    `   • ${resumen.clientes_activos} clientes activos en cartera`,
    '',
    `⚠️ Atención requerida:`,
    `   • Cobranza vencida: ${cv.count} facturas — $${cv.total_vencido.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
    `   • Clientes en riesgo de pérdida (>60d sin actividad): ${cr.count}`,
    `   • Cotizaciones sin convertir: ${cp.count} — potencial $${cp.total_potencial.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`,
    '',
  ];

  const recomendaciones = [];
  if (cv.count > 0) {
    recomendaciones.push(`Enviar recordatorio de pago a los ${cv.count} clientes con cobranza vencida (revisa tab Comercial IA).`);
  }
  if (cr.count > 0) {
    recomendaciones.push(`Contactar a los ${cr.count} clientes inactivos antes de que se pierdan definitivamente.`);
  }
  if (cp.count > 0) {
    recomendaciones.push(`Convertir las ${cp.count} cotizaciones aprobadas en órdenes de viaje.`);
  }
  if (resumen.alertas_criticas > 0) {
    recomendaciones.push(`Atender las ${resumen.alertas_criticas} alertas críticas en el tab Alertas antes de cualquier otra cosa.`);
  }
  if (recomendaciones.length === 0) {
    recomendaciones.push('Operación estable. Buen momento para planeación estratégica y mantenimientos preventivos.');
  }

  lineas.push('🎯 Recomendación IA:');
  recomendaciones.forEach((r, i) => lineas.push(`   ${i + 1}. ${r}`));

  return {
    texto: lineas.join('\n'),
    metricas: resumen,
    alertas: {
      cobranza_vencida: { count: cv.count, monto: cv.total_vencido },
      clientes_en_riesgo: { count: cr.count },
      cotizaciones_pendientes: { count: cp.count, potencial: cp.total_potencial },
    },
    recomendaciones,
    generado_en: new Date().toISOString(),
  };
}

module.exports = {
  cobranzaVencida,
  clientesEnRiesgo,
  cotizacionesPendientes,
  preciosPorRuta,
  briefingEjecutivo,
};
