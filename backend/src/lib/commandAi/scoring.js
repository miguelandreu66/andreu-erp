const db = require('../../db');

// Calcula scoring de operadores en una ventana móvil (default 30 días).
// Score = 100 menos penalizaciones por incidentes y por consumo diesel fuera de rango (1.8–2.0 lt/km).
async function calcularScoring(diasVentana = 30) {
  const { rows } = await db.query(`
    WITH base AS (
      SELECT
        o.id   AS operador_id,
        o.nombre,
        COUNT(v.id) FILTER (WHERE v.estado = 'Completado')::int AS viajes,
        COALESCE(
          SUM(v.diesel_litros) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0)
          / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.estado='Completado' AND v.km_recorridos > 0), 0),
          0
        )::float AS rend_lt_km,
        COUNT(a.id) FILTER (WHERE a.nivel IN ('alto','critico'))::int AS incidentes
      FROM operadores o
      LEFT JOIN viajes v
             ON v.operador_id = o.id
            AND v.fecha >= CURRENT_DATE - ($1::int || ' days')::interval
      LEFT JOIN alertas a
             ON a.operador_id = o.id
            AND a.created_at >= NOW() - ($1::int || ' days')::interval
      WHERE o.activo = true
      GROUP BY o.id, o.nombre
    )
    SELECT
      operador_id,
      nombre,
      viajes,
      ROUND(rend_lt_km::numeric, 3)::float AS rend_lt_km,
      incidentes,
      GREATEST(0, LEAST(100,
        100
        - LEAST(40, incidentes * 10)
        - CASE
            WHEN rend_lt_km > 2.5 THEN 30
            WHEN rend_lt_km > 2.0 THEN 15
            WHEN rend_lt_km BETWEEN 1.8 AND 2.0 THEN 0
            WHEN rend_lt_km > 0 AND rend_lt_km < 1.8 THEN 5
            ELSE 0
          END
      ))::int AS score
    FROM base
    ORDER BY score DESC, viajes DESC
  `, [diasVentana]);
  return rows;
}

// Guarda snapshot del scoring actual (cron diario o llamada manual).
async function guardarSnapshot(diasVentana = 30) {
  const datos = await calcularScoring(diasVentana);
  const periodoFin = new Date().toISOString().slice(0, 10);
  const periodoInicio = new Date(Date.now() - diasVentana * 86400000)
    .toISOString().slice(0, 10);

  for (const d of datos) {
    await db.query(`
      INSERT INTO scoring_snapshots
        (operador_id, periodo_inicio, periodo_fin, score, viajes_totales,
         rendimiento_lt_km, incidentes, detalle)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (operador_id, periodo_inicio, periodo_fin) DO UPDATE SET
        score = EXCLUDED.score,
        viajes_totales = EXCLUDED.viajes_totales,
        rendimiento_lt_km = EXCLUDED.rendimiento_lt_km,
        incidentes = EXCLUDED.incidentes,
        detalle = EXCLUDED.detalle
    `, [
      d.operador_id, periodoInicio, periodoFin,
      d.score, d.viajes, d.rend_lt_km, d.incidentes, d,
    ]);
  }

  return {
    periodo: { inicio: periodoInicio, fin: periodoFin },
    operadores: datos.length,
  };
}

module.exports = { calcularScoring, guardarSnapshot };
