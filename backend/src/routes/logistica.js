const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── Constantes de alerta ──────────────────────────────────────────
const META_LT_KM_MIN  = 1.8;   // óptimo mínimo
const META_LT_KM_MAX  = 2.0;   // óptimo máximo → arriba de esto = alerta

// ── Helper: rango de fechas desde query ──────────────────────────
function rango(query) {
  const hoy  = new Date().toISOString().split('T')[0];
  const { periodo, fecha_inicio, fecha_fin } = query;
  if (fecha_inicio && fecha_fin) return { fi: fecha_inicio, ff: fecha_fin };
  if (periodo === 'semana') {
    const d = new Date(); const day = d.getDay();
    const fi = new Date(d); fi.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    const ff = new Date(fi); ff.setDate(fi.getDate() + 6);
    return { fi: fi.toISOString().split('T')[0], ff: ff.toISOString().split('T')[0] };
  }
  if (periodo === 'mes') {
    const d = new Date();
    return { fi: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`, ff: hoy };
  }
  // default: últimos 30 días
  const fi = new Date(); fi.setDate(fi.getDate() - 30);
  return { fi: fi.toISOString().split('T')[0], ff: hoy };
}

// ══════════════════════════════════════════════════════════════════
// GET /kpis — resumen general
// ══════════════════════════════════════════════════════════════════
router.get('/kpis', auth(), async (req, res) => {
  const { fi, ff } = rango(req.query);
  try {
    const { rows: [kpi] } = await db.query(`
      SELECT
        COUNT(*)  FILTER (WHERE estado = 'Completado')          AS viajes_completados,
        COUNT(*)                                                  AS viajes_total,
        COALESCE(SUM(diesel_litros)  FILTER (WHERE estado='Completado'), 0) AS total_litros,
        COALESCE(SUM(diesel_costo)   FILTER (WHERE estado='Completado'), 0) AS total_costo_diesel,
        COALESCE(SUM(km_recorridos)  FILTER (WHERE estado='Completado'), 0) AS total_km,
        COALESCE(SUM(toneladas)      FILTER (WHERE estado='Completado'), 0) AS total_toneladas,
        COALESCE(
          SUM(diesel_litros) FILTER (WHERE estado='Completado' AND km_recorridos > 0)
          / NULLIF(SUM(km_recorridos) FILTER (WHERE estado='Completado' AND km_recorridos > 0), 0),
        0) AS rendimiento_flota,
        COALESCE(
          SUM(diesel_costo) FILTER (WHERE estado='Completado' AND toneladas > 0)
          / NULLIF(SUM(toneladas) FILTER (WHERE estado='Completado' AND toneladas > 0), 0),
        0) AS costo_por_tonelada
      FROM viajes
      WHERE fecha BETWEEN $1 AND $2
    `, [fi, ff]);

    // Disponibilidad de flota
    const { rows: [disp] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE activo = true)  AS total_activas,
        COUNT(*)                                AS total_unidades
      FROM unidades
    `);
    const { rows: [enMant] } = await db.query(`
      SELECT COUNT(DISTINCT unidad_id) AS en_mantenimiento
      FROM mantenimientos
      WHERE estado = 'en_proceso'
    `);

    const activas    = parseInt(disp.total_activas)    || 0;
    const enMantNum  = parseInt(enMant.en_mantenimiento) || 0;
    const disponibles = Math.max(0, activas - enMantNum);
    const pct_disponibilidad = activas > 0 ? Math.round((disponibles / activas) * 100) : 100;

    res.json({
      ...kpi,
      disponibles,
      total_activas: activas,
      en_mantenimiento: enMantNum,
      pct_disponibilidad,
      fecha_inicio: fi,
      fecha_fin: ff,
      meta_lt_km_min: META_LT_KM_MIN,
      meta_lt_km_max: META_LT_KM_MAX,
    });
  } catch (e) {
    console.error('kpis logistica:', e.message);
    res.status(500).json({ error: 'Error al calcular KPIs' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /por-operador — ranking de operadores
// ══════════════════════════════════════════════════════════════════
router.get('/por-operador', auth(), async (req, res) => {
  const { fi, ff } = rango(req.query);
  try {
    const { rows } = await db.query(`
      SELECT
        o.id                                                        AS operador_id,
        o.nombre                                                    AS operador,
        COUNT(*) FILTER (WHERE v.estado = 'Completado')             AS viajes,
        COALESCE(SUM(v.km_recorridos)  FILTER (WHERE v.estado='Completado'), 0) AS km_total,
        COALESCE(SUM(v.diesel_litros)  FILTER (WHERE v.estado='Completado'), 0) AS litros_total,
        COALESCE(SUM(v.diesel_costo)   FILTER (WHERE v.estado='Completado'), 0) AS costo_total,
        COALESCE(SUM(v.toneladas)      FILTER (WHERE v.estado='Completado'), 0) AS toneladas_total,
        COALESCE(
          SUM(v.diesel_litros) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0), 0),
        0) AS rendimiento_lt_km,
        COALESCE(
          SUM(v.diesel_costo) FILTER (WHERE v.estado='Completado' AND v.toneladas > 0)
          / NULLIF(SUM(v.toneladas) FILTER (WHERE v.estado='Completado' AND v.toneladas > 0), 0),
        0) AS costo_por_ton
      FROM operadores o
      LEFT JOIN viajes v ON v.operador_id = o.id AND v.fecha BETWEEN $1 AND $2
      WHERE o.activo = true
      GROUP BY o.id, o.nombre
      ORDER BY viajes DESC, rendimiento_lt_km ASC
    `, [fi, ff]);
    res.json(rows);
  } catch (e) {
    console.error('por-operador:', e.message);
    res.status(500).json({ error: 'Error al calcular rendimiento por operador' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /por-unidad — ranking de unidades
// ══════════════════════════════════════════════════════════════════
router.get('/por-unidad', auth(), async (req, res) => {
  const { fi, ff } = rango(req.query);
  try {
    const { rows } = await db.query(`
      SELECT
        u.id                                                        AS unidad_id,
        u.placas,
        u.descripcion,
        u.marca,
        u.modelo,
        COUNT(*) FILTER (WHERE v.estado = 'Completado')             AS viajes,
        COALESCE(SUM(v.km_recorridos)  FILTER (WHERE v.estado='Completado'), 0) AS km_total,
        COALESCE(SUM(v.diesel_litros)  FILTER (WHERE v.estado='Completado'), 0) AS litros_total,
        COALESCE(SUM(v.diesel_costo)   FILTER (WHERE v.estado='Completado'), 0) AS costo_total,
        COALESCE(SUM(v.toneladas)      FILTER (WHERE v.estado='Completado'), 0) AS toneladas_total,
        COALESCE(
          SUM(v.diesel_litros) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0), 0),
        0) AS rendimiento_lt_km,
        COALESCE(
          SUM(v.diesel_costo) FILTER (WHERE v.estado='Completado' AND v.toneladas > 0)
          / NULLIF(SUM(v.toneladas) FILTER (WHERE v.estado='Completado' AND v.toneladas > 0), 0),
        0) AS costo_por_ton
      FROM unidades u
      LEFT JOIN viajes v ON v.unidad_id = u.id AND v.fecha BETWEEN $1 AND $2
      WHERE u.activo = true
      GROUP BY u.id, u.placas, u.descripcion, u.marca, u.modelo
      ORDER BY viajes DESC, rendimiento_lt_km ASC
    `, [fi, ff]);
    res.json(rows);
  } catch (e) {
    console.error('por-unidad:', e.message);
    res.status(500).json({ error: 'Error al calcular rendimiento por unidad' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /destinos — análisis por destino
// ══════════════════════════════════════════════════════════════════
router.get('/destinos', auth(), async (req, res) => {
  const { fi, ff } = rango(req.query);
  try {
    const { rows } = await db.query(`
      SELECT
        destino,
        COUNT(*)                                         AS viajes,
        COALESCE(AVG(km_recorridos) FILTER (WHERE km_recorridos > 0), 0) AS km_promedio,
        COALESCE(AVG(diesel_costo),  0)                  AS costo_promedio,
        COALESCE(SUM(toneladas),     0)                  AS toneladas_total,
        COALESCE(SUM(diesel_costo),  0)                  AS costo_total
      FROM viajes
      WHERE estado = 'Completado'
        AND fecha BETWEEN $1 AND $2
      GROUP BY destino
      ORDER BY viajes DESC
      LIMIT 20
    `, [fi, ff]);
    res.json(rows);
  } catch (e) {
    console.error('destinos:', e.message);
    res.status(500).json({ error: 'Error al calcular destinos' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /alertas — operadores y unidades fuera de rango
// ══════════════════════════════════════════════════════════════════
router.get('/alertas', auth(), async (req, res) => {
  // Usar siempre últimos 30 días para alertas
  const hoy = new Date().toISOString().split('T')[0];
  const fi30 = new Date(); fi30.setDate(fi30.getDate() - 30);
  const fi = fi30.toISOString().split('T')[0];

  try {
    // Operadores con rendimiento > META_LT_KM_MAX (queman demasiado)
    const { rows: opAlertas } = await db.query(`
      SELECT
        o.nombre AS operador,
        COUNT(v.id) AS viajes,
        ROUND(
          SUM(v.diesel_litros) FILTER (WHERE v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.km_recorridos > 0), 0)
        , 2) AS rendimiento_lt_km,
        SUM(v.diesel_costo) AS costo_diesel
      FROM operadores o
      JOIN viajes v ON v.operador_id = o.id
      WHERE v.estado = 'Completado'
        AND v.fecha BETWEEN $1 AND $2
        AND v.km_recorridos > 0
      GROUP BY o.id, o.nombre
      HAVING
        SUM(v.diesel_litros) FILTER (WHERE v.km_recorridos > 0)
        / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.km_recorridos > 0), 0)
        > $3
      ORDER BY rendimiento_lt_km DESC
    `, [fi, hoy, META_LT_KM_MAX]);

    // Unidades con rendimiento > META_LT_KM_MAX
    const { rows: unAlertas } = await db.query(`
      SELECT
        u.placas,
        u.descripcion,
        COUNT(v.id) AS viajes,
        ROUND(
          SUM(v.diesel_litros) FILTER (WHERE v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.km_recorridos > 0), 0)
        , 2) AS rendimiento_lt_km,
        SUM(v.diesel_costo) AS costo_diesel
      FROM unidades u
      JOIN viajes v ON v.unidad_id = u.id
      WHERE v.estado = 'Completado'
        AND v.fecha BETWEEN $1 AND $2
        AND v.km_recorridos > 0
      GROUP BY u.id, u.placas, u.descripcion
      HAVING
        SUM(v.diesel_litros) FILTER (WHERE v.km_recorridos > 0)
        / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.km_recorridos > 0), 0)
        > $3
      ORDER BY rendimiento_lt_km DESC
    `, [fi, hoy, META_LT_KM_MAX]);

    // Mantenimientos vencidos
    const { rows: mantVencidos } = await db.query(`
      SELECT DISTINCT ON (unidad_id)
        u.placas, u.descripcion,
        m.tipo, m.proximo_fecha, m.proximo_km,
        CURRENT_DATE - m.proximo_fecha AS dias_vencido
      FROM mantenimientos m
      JOIN unidades u ON m.unidad_id = u.id
      WHERE m.proximo_fecha < CURRENT_DATE
        AND m.estado = 'completado'
      ORDER BY unidad_id, m.proximo_fecha ASC
    `);

    res.json({
      operadores_alerta: opAlertas,
      unidades_alerta:   unAlertas,
      mantenimientos_vencidos: mantVencidos,
      meta_lt_km_max: META_LT_KM_MAX,
      periodo: `${fi} al ${hoy}`,
    });
  } catch (e) {
    console.error('alertas logistica:', e.message);
    res.status(500).json({ error: 'Error al calcular alertas' });
  }
});

module.exports = router;
