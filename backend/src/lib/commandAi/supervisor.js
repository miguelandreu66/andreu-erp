const db = require('../../db');

// Fase 1: resumen determinístico construido con queries.
// Fase 2 (siguiente sprint): conectar Claude API con tool-use.
async function generarResumen() {
  const { rows: porNivel } = await db.query(`
    SELECT nivel, COUNT(*)::int AS n
    FROM alertas
    WHERE estado IN ('pendiente','atendida')
    GROUP BY nivel
  `);
  const counts = { critico: 0, alto: 0, medio: 0, bajo: 0 };
  porNivel.forEach(r => { counts[r.nivel] = r.n; });
  const total = counts.critico + counts.alto + counts.medio + counts.bajo;

  const { rows: [criticaReciente] } = await db.query(`
    SELECT a.descripcion, u.placas, op.nombre AS operador
    FROM alertas a
    LEFT JOIN unidades   u  ON u.id  = a.unidad_id
    LEFT JOIN operadores op ON op.id = a.operador_id
    WHERE a.estado IN ('pendiente','atendida') AND a.nivel = 'critico'
    ORDER BY a.created_at DESC
    LIMIT 1
  `);

  const { rows: [peor] } = await db.query(`
    SELECT op.id, op.nombre, s.score, s.periodo_fin
    FROM scoring_snapshots s
    JOIN operadores op ON op.id = s.operador_id
    WHERE s.periodo_fin >= CURRENT_DATE - INTERVAL '30 days'
    ORDER BY s.score ASC
    LIMIT 1
  `);

  const { rows: [topViaje] } = await db.query(`
    SELECT id, COALESCE(origen, 'Origen N/D') AS origen, destino, diesel_costo, fecha
    FROM viajes
    WHERE fecha >= CURRENT_DATE - INTERVAL '7 days'
    ORDER BY diesel_costo DESC NULLS LAST
    LIMIT 1
  `);

  const { rows: [flota] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE activo = true)::int AS activas,
      (SELECT COUNT(*) FROM unidades_ultima_posicion WHERE minutos_desde_ultimo <= 15)::int AS reportando,
      (SELECT COUNT(*) FROM viajes WHERE estado = 'En ruta')::int AS en_ruta
    FROM unidades
  `);

  const lineas = [
    `Supervisor IA — ${new Date().toLocaleString('es-MX')}`,
    `Flota: ${flota.reportando}/${flota.activas} unidades reportando. ${flota.en_ruta} viaje(s) en ruta.`,
    `Alertas activas: ${total} (${counts.critico} críticas, ${counts.alto} altas, ${counts.medio} medias, ${counts.bajo} bajas).`,
    criticaReciente
      ? `Atención inmediata: ${criticaReciente.descripcion}`
      : 'Sin alertas críticas activas.',
    peor
      ? `Operador a revisar: ${peor.nombre} (score ${peor.score}/100, período hasta ${peor.periodo_fin}).`
      : 'Sin datos de scoring reciente — corre un snapshot para evaluar operadores.',
    topViaje
      ? `Viaje destacado: ${topViaje.origen} → ${topViaje.destino} (${topViaje.fecha}).`
      : 'Sin viajes en últimos 7 días.',
    'Recomendación: atiende primero alertas críticas y altas; deja reportes secundarios para el cierre del día.',
  ];

  return {
    texto: lineas.join('\n'),
    counts,
    total_alertas: total,
    flota,
    generado_en: new Date().toISOString(),
  };
}

module.exports = { generarResumen };
