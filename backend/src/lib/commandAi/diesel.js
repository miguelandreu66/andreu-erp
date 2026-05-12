const db = require('../../db');

// Recalcula baselines de rendimiento (lt/km) por unidad y por (unidad, destino).
// Requiere mínimo 3 muestras de viajes Completados con km y litros > 0.
async function recomputarBaselines() {
  const { rows: general } = await db.query(`
    SELECT
      unidad_id,
      ROUND(AVG(diesel_litros / km_recorridos)::numeric, 3)::float        AS prom,
      ROUND(COALESCE(STDDEV_POP(diesel_litros / km_recorridos), 0)::numeric, 3)::float AS desv,
      COUNT(*)::int                                                       AS muestras
    FROM viajes
    WHERE estado = 'Completado'
      AND km_recorridos > 0
      AND diesel_litros > 0
    GROUP BY unidad_id
    HAVING COUNT(*) >= 3
  `);
  for (const r of general) {
    await db.query(`
      INSERT INTO diesel_baselines
        (unidad_id, destino, rendimiento_esperado_lt_km, rendimiento_desviacion, muestras, recalculado_en)
      VALUES ($1, NULL, $2, $3, $4, NOW())
      ON CONFLICT (unidad_id) WHERE destino IS NULL DO UPDATE SET
        rendimiento_esperado_lt_km = EXCLUDED.rendimiento_esperado_lt_km,
        rendimiento_desviacion     = EXCLUDED.rendimiento_desviacion,
        muestras                   = EXCLUDED.muestras,
        recalculado_en             = NOW()
    `, [r.unidad_id, r.prom, r.desv || 0.15, r.muestras]);
  }

  const { rows: porDestino } = await db.query(`
    SELECT
      unidad_id,
      destino,
      ROUND(AVG(diesel_litros / km_recorridos)::numeric, 3)::float        AS prom,
      ROUND(COALESCE(STDDEV_POP(diesel_litros / km_recorridos), 0)::numeric, 3)::float AS desv,
      COUNT(*)::int                                                       AS muestras
    FROM viajes
    WHERE estado = 'Completado'
      AND km_recorridos > 0
      AND diesel_litros > 0
      AND destino IS NOT NULL
    GROUP BY unidad_id, destino
    HAVING COUNT(*) >= 3
  `);
  for (const r of porDestino) {
    await db.query(`
      INSERT INTO diesel_baselines
        (unidad_id, destino, rendimiento_esperado_lt_km, rendimiento_desviacion, muestras, recalculado_en)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (unidad_id, destino) WHERE destino IS NOT NULL DO UPDATE SET
        rendimiento_esperado_lt_km = EXCLUDED.rendimiento_esperado_lt_km,
        rendimiento_desviacion     = EXCLUDED.rendimiento_desviacion,
        muestras                   = EXCLUDED.muestras,
        recalculado_en             = NOW()
    `, [r.unidad_id, r.destino, r.prom, r.desv || 0.15, r.muestras]);
  }

  return { generales: general.length, por_destino: porDestino.length };
}

// Lista todos los baselines con info de la unidad
async function listarBaselines() {
  const { rows } = await db.query(`
    SELECT
      b.id, b.unidad_id, b.destino,
      b.rendimiento_esperado_lt_km, b.rendimiento_desviacion,
      b.muestras, b.recalculado_en,
      u.placas, u.descripcion
    FROM diesel_baselines b
    JOIN unidades u ON u.id = b.unidad_id
    ORDER BY u.placas, b.destino NULLS FIRST
  `);
  return rows;
}

// Análisis forense por unidad: viajes recientes vs baseline
async function analisisForense(unidadId, diasVentana = 30) {
  const { rows } = await db.query(`
    SELECT
      v.id, v.fecha, v.origen, v.destino,
      v.km_recorridos, v.diesel_litros, v.diesel_costo,
      ROUND((v.diesel_litros / NULLIF(v.km_recorridos, 0))::numeric, 3)::float AS rend_real_lt_km,
      b_dest.rendimiento_esperado_lt_km AS rend_esperado_destino,
      b_gen.rendimiento_esperado_lt_km  AS rend_esperado_general
    FROM viajes v
    LEFT JOIN diesel_baselines b_dest
           ON b_dest.unidad_id = v.unidad_id AND b_dest.destino = v.destino
    LEFT JOIN diesel_baselines b_gen
           ON b_gen.unidad_id  = v.unidad_id AND b_gen.destino IS NULL
    WHERE v.unidad_id = $1
      AND v.fecha >= CURRENT_DATE - ($2::int || ' days')::interval
      AND v.km_recorridos > 0
    ORDER BY v.fecha DESC
  `, [unidadId, diasVentana]);
  return rows;
}

module.exports = { recomputarBaselines, listarBaselines, analisisForense };
