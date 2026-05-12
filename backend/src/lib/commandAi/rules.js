const db = require('../../db');

// Umbrales operativos del motor de reglas (ajustables sin redeploy futuro)
const UMBRALES = {
  minutosGpsSinSenal: 15,
  minutosParadaSospechosa: 25,
  velocidadMaximaKmh: 90,
  desviacionDieselAlerta: 0.18,
  desviacionDieselCritica: 0.30,
  scoreMinimo: 75,
};

// Evalúa el estado actual de la flota y devuelve un array de alertas candidatas.
// No persiste — separar evaluación de persistencia permite hacer dry-run.
async function evaluarReglas() {
  const alertas = [];

  const { rows: estado } = await db.query(`
    SELECT
      u.id           AS unidad_id,
      u.placas,
      u.descripcion,
      ulp.viaje_id,
      ulp.lat,
      ulp.lng,
      ulp.velocidad_kmh,
      ulp.minutos_desde_ultimo,
      v.operador_id,
      op.nombre      AS operador_nombre,
      v.destino,
      v.km_recorridos AS km_viaje,
      v.diesel_litros AS litros_viaje,
      CASE
        WHEN v.km_recorridos > 0 THEN v.diesel_litros / v.km_recorridos
        ELSE NULL
      END            AS rend_actual_lt_km,
      db_base.rendimiento_esperado_lt_km AS rend_esperado_lt_km
    FROM unidades u
    LEFT JOIN unidades_ultima_posicion ulp ON ulp.unidad_id = u.id
    LEFT JOIN viajes    v  ON v.id  = ulp.viaje_id
    LEFT JOIN operadores op ON op.id = v.operador_id
    LEFT JOIN diesel_baselines db_base
           ON db_base.unidad_id = u.id
          AND (db_base.destino = v.destino OR db_base.destino IS NULL)
    WHERE u.activo = true
  `);

  const bucketCuartoHora = Math.floor(Date.now() / (15 * 60 * 1000));

  for (const u of estado) {
    const minSinSenal = u.minutos_desde_ultimo == null
      ? null
      : parseFloat(u.minutos_desde_ultimo);

    if (minSinSenal !== null && minSinSenal >= UMBRALES.minutosGpsSinSenal) {
      alertas.push({
        tipo: 'gps_sin_senal',
        nivel: 'critico',
        unidad_id: u.unidad_id,
        operador_id: u.operador_id,
        viaje_id: u.viaje_id,
        descripcion: `${u.placas} sin señal GPS por ${Math.round(minSinSenal)} minutos.`,
        recomendacion: 'Contactar operador. Si no responde en 5 min, escalar a admin.',
        dedupe_key: `gps_sin_senal:${u.unidad_id}:${bucketCuartoHora}`,
        metadata: { minutos_sin_senal: Math.round(minSinSenal) },
      });
    }

    const vel = u.velocidad_kmh == null ? 0 : parseFloat(u.velocidad_kmh);
    if (vel > UMBRALES.velocidadMaximaKmh) {
      alertas.push({
        tipo: 'exceso_velocidad',
        nivel: vel > UMBRALES.velocidadMaximaKmh + 20 ? 'alto' : 'medio',
        unidad_id: u.unidad_id,
        operador_id: u.operador_id,
        viaje_id: u.viaje_id,
        descripcion: `${u.placas} circulando a ${vel.toFixed(0)} km/h (límite operativo ${UMBRALES.velocidadMaximaKmh}).`,
        recomendacion: 'Registrar infracción operativa y advertir al operador.',
        dedupe_key: `exceso_velocidad:${u.unidad_id}:${bucketCuartoHora}`,
        metadata: { velocidad_kmh: vel },
      });
    }

    if (u.rend_actual_lt_km && u.rend_esperado_lt_km) {
      const actual = parseFloat(u.rend_actual_lt_km);
      const esperado = parseFloat(u.rend_esperado_lt_km);
      const diff = (actual - esperado) / esperado;
      if (diff >= UMBRALES.desviacionDieselAlerta) {
        alertas.push({
          tipo: 'diesel_anomalia',
          nivel: diff >= UMBRALES.desviacionDieselCritica ? 'critico' : 'alto',
          unidad_id: u.unidad_id,
          operador_id: u.operador_id,
          viaje_id: u.viaje_id,
          descripcion: `${u.placas} consume ${actual.toFixed(2)} lt/km vs esperado ${esperado.toFixed(2)} lt/km (+${(diff * 100).toFixed(0)}%).`,
          recomendacion: 'Revisar ticket de carga, ruta, manejo, posible fuga o falla mecánica.',
          dedupe_key: `diesel_anomalia:${u.unidad_id}:${u.viaje_id || 'general'}`,
          metadata: { rend_actual: actual, rend_esperado: esperado, exceso_pct: diff },
        });
      }
    }
  }

  const { rows: bajos } = await db.query(`
    SELECT DISTINCT ON (s.operador_id)
      s.operador_id, s.score, s.periodo_fin, op.nombre
    FROM scoring_snapshots s
    JOIN operadores op ON op.id = s.operador_id
    WHERE s.score < $1
    ORDER BY s.operador_id, s.periodo_fin DESC
  `, [UMBRALES.scoreMinimo]);

  for (const b of bajos) {
    alertas.push({
      tipo: 'operador_bajo_desempeno',
      nivel: 'alto',
      unidad_id: null,
      operador_id: b.operador_id,
      viaje_id: null,
      descripcion: `${b.nombre} con score ${b.score}/100 (último período ${b.periodo_fin}).`,
      recomendacion: 'Revisar incidencias, consumo diesel y puntualidad. Aplicar plan correctivo.',
      dedupe_key: `operador_bajo_desempeno:${b.operador_id}:${b.periodo_fin}`,
      metadata: { score: b.score },
    });
  }

  // Documentos vencidos o por vencer
  try {
    const { rows: docs } = await db.query(`
      SELECT
        d.id, d.tipo, d.nombre, d.vigencia_fin, d.unidad_id,
        u.placas,
        (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
        CASE
          WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido'
          ELSE 'por_vencer'
        END AS estado
      FROM unidad_documentos d
      JOIN unidades u ON u.id = d.unidad_id
      WHERE d.vigencia_fin IS NOT NULL
        AND d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval
    `);

    const NOMBRES_TIPO = {
      tarjeta_circulacion: 'Tarjeta de circulación',
      poliza_seguro: 'Póliza de seguro',
      permiso_sct: 'Permiso SCT',
      verificacion_vehicular: 'Verificación vehicular',
      comprobante_propiedad: 'Comprobante de propiedad',
      tarjeta_caja_remolque: 'Tarjeta caja/remolque',
      foto_unidad: 'Foto de unidad',
      factura_unidad: 'Factura de unidad',
      tenencia: 'Tenencia',
      otro: 'Otro documento',
    };

    for (const d of docs) {
      const nombreTipo = NOMBRES_TIPO[d.tipo] || d.tipo;
      const vencido = d.estado === 'vencido';
      alertas.push({
        tipo: vencido ? 'documento_vencido' : 'documento_por_vencer',
        nivel: vencido ? 'critico' : (d.dias_restantes <= 7 ? 'alto' : 'medio'),
        unidad_id: d.unidad_id,
        operador_id: null,
        viaje_id: null,
        descripcion: vencido
          ? `${nombreTipo} de ${d.placas} VENCIÓ hace ${Math.abs(d.dias_restantes)} día(s) (${d.vigencia_fin}).`
          : `${nombreTipo} de ${d.placas} vence en ${d.dias_restantes} día(s) (${d.vigencia_fin}).`,
        recomendacion: vencido
          ? 'NO usar esa unidad para viajes federales hasta renovar. Riesgo de multa en retén.'
          : 'Tramitar renovación esta semana. Subir documento actualizado en el módulo Unidades.',
        dedupe_key: `${vencido ? 'documento_vencido' : 'documento_por_vencer'}:${d.id}:${new Date().toISOString().slice(0, 10)}`,
        metadata: { documento_id: d.id, tipo: d.tipo, dias_restantes: d.dias_restantes, vigencia_fin: d.vigencia_fin },
      });
    }
  } catch (e) {
    console.warn('rules docs unidad check skipped:', e.message);
  }

  // Documentos de operadores próximos a vencer o vencidos
  try {
    const { rows: docsOp } = await db.query(`
      SELECT
        d.id, d.tipo, d.nombre, d.vigencia_fin, d.operador_id,
        op.nombre AS operador_nombre,
        (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
        CASE WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido' ELSE 'por_vencer' END AS estado
      FROM operador_documentos d
      JOIN operadores op ON op.id = d.operador_id
      WHERE d.vigencia_fin IS NOT NULL
        AND d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval
    `);

    const NOMBRES_TIPO_OP = {
      licencia_federal: 'Licencia federal',
      examen_medico: 'Examen médico',
      ine: 'INE',
      curp: 'CURP',
      rfc: 'RFC',
      comprobante_domicilio: 'Comprobante de domicilio',
      antecedentes_no_penales: 'Antecedentes no penales',
      contrato_laboral: 'Contrato laboral',
      foto_perfil: 'Foto de perfil',
      capacitacion: 'Capacitación',
      otro: 'Otro documento',
    };

    for (const d of docsOp) {
      const nombreTipo = NOMBRES_TIPO_OP[d.tipo] || d.tipo;
      const vencido = d.estado === 'vencido';
      const esCritico = vencido && (d.tipo === 'licencia_federal' || d.tipo === 'examen_medico');
      alertas.push({
        tipo: vencido ? 'op_documento_vencido' : 'op_documento_por_vencer',
        nivel: esCritico ? 'critico' : vencido ? 'alto' : (d.dias_restantes <= 7 ? 'alto' : 'medio'),
        unidad_id: null,
        operador_id: d.operador_id,
        viaje_id: null,
        descripcion: vencido
          ? `${nombreTipo} de ${d.operador_nombre} VENCIÓ hace ${Math.abs(d.dias_restantes)} día(s) (${d.vigencia_fin}).`
          : `${nombreTipo} de ${d.operador_nombre} vence en ${d.dias_restantes} día(s) (${d.vigencia_fin}).`,
        recomendacion: esCritico
          ? 'NO asignar viajes federales a este operador hasta renovar. Riesgo legal y de multa.'
          : vencido
            ? 'Solicitar renovación inmediata al operador.'
            : 'Recordar al operador renovar este documento esta semana.',
        dedupe_key: `${vencido ? 'op_documento_vencido' : 'op_documento_por_vencer'}:${d.id}:${new Date().toISOString().slice(0, 10)}`,
        metadata: { documento_id: d.id, tipo: d.tipo, dias_restantes: d.dias_restantes, vigencia_fin: d.vigencia_fin },
      });
    }
  } catch (e) {
    console.warn('rules docs operador check skipped:', e.message);
  }

  return alertas;
}

// Persiste alertas usando dedupe_key (ON CONFLICT DO NOTHING).
// Devuelve cuántas eran nuevas vs cuántas se intentaron.
async function persistirAlertas(alertas) {
  if (!alertas.length) return { evaluadas: 0, creadas: 0 };
  let creadas = 0;
  for (const a of alertas) {
    const { rowCount } = await db.query(`
      INSERT INTO alertas
        (tipo, nivel, unidad_id, operador_id, viaje_id, descripcion, recomendacion, dedupe_key, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (dedupe_key) DO NOTHING
    `, [
      a.tipo, a.nivel, a.unidad_id, a.operador_id, a.viaje_id,
      a.descripcion, a.recomendacion, a.dedupe_key, a.metadata || {},
    ]);
    creadas += rowCount;
  }
  return { evaluadas: alertas.length, creadas };
}

module.exports = { evaluarReglas, persistirAlertas, UMBRALES };
