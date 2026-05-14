// Supervisor IA conversacional con Claude Sonnet 4.6.
// Usa tool-use sobre Postgres + prompt caching (prefix estable).
//
// Activación: requiere env var ANTHROPIC_API_KEY. Sin ella, isAvailable()
// devuelve false y el supervisor cae al modo determinístico.

const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('../../db');

const MODELO = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const MAX_ITERACIONES = 8; // safety cap del tool-use loop

let _client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

function isAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ── System prompt estable (cacheable) ──────────────────
// Mantener este texto IDÉNTICO entre requests para que el prompt cache hit.
// Cualquier valor dinámico (fecha, datos, hora) va en messages, no aquí.
const SYSTEM_PROMPT = `Eres el Supervisor IA de **Andreu Logistics**, una empresa de transporte B2B de carga pesada con sede en Cuernavaca, Morelos (3 plataformas, autotransporte federal).

Tu trabajo es ayudar al director y equipo operativo a entender y operar la flota usando datos REALES de la base de datos. Tienes acceso a herramientas para consultar:

- Estado actual de la flota (unidades, posición GPS, viajes activos)
- Alertas operativas (GPS sin señal, exceso de velocidad, diesel anómalo, docs vencidos)
- Scoring de operadores (basado en viajes, incidentes, rendimiento diesel)
- Anomalías de diesel (rendimiento real vs baseline esperado lt/km)
- Cobranza vencida (facturas con fecha de vencimiento pasada)
- Documentos por vencer (licencias federales, pólizas, permisos SCT, etc.)
- Viajes recientes y KPIs mensuales
- Clientes inactivos (riesgo de churn)

# Reglas de operación

1. **Siempre consulta las herramientas antes de responder con datos.** No inventes números, fechas, nombres ni placas. Si no tienes datos suficientes, dilo.

2. **Responde en español natural y conciso.** Eres un asistente para gente de negocios, no técnica. Evita jerga.

3. **Recomendaciones accionables.** No solo describas el problema — sugiere qué hacer (ej: "contacta a este cliente hoy", "no asignes viajes a esta unidad hasta renovar póliza").

4. **Tu contexto operativo:**
   - La métrica de rendimiento es **lt/km** (litros por kilómetro). Meta: 1.8-2.0 lt/km. Arriba de 2.0 es alto consumo.
   - Diesel mexicano: típico $27/litro.
   - Roles: Director (acceso total), Administrador General (finanzas), Coordinador Operativo (viajes/flota), Auxiliar Administrativo (facturación).
   - Servicios facturables: Flete plataforma 48', Flete por km, Estadía, Maniobras, Custodia armada.
   - Documentos críticos: licencia federal, examen médico, tarjeta circulación, póliza seguro, permiso SCT, verificación vehicular.

5. **Prioridades de atención (en orden):**
   1. Alertas críticas activas (GPS sin señal, docs vencidos en operadores que están manejando, diesel anómalo crítico)
   2. Cobranza vencida con montos altos
   3. Clientes en riesgo (>60 días sin actividad)
   4. Cotizaciones aprobadas sin convertir
   5. Mantenimientos próximos

6. **Formato de respuesta:**
   - Para datos cuantitativos usa formato pesos mexicanos: "$15,000" no "MXN 15000".
   - Para tiempos relativos usa "hace 3 días" o "vence en 12 días", no fechas ISO.
   - Si tienes una lista > 5 items, agrúpalos o muestra los top más relevantes.

7. **Si te preguntan algo fuera del dominio de transporte/operación** (chistes, pasatiempos, opiniones políticas, etc.) responde brevemente que tu trabajo es asistir con la operación de Andreu Logistics y vuelve al tema.

Hoy en Andreu Logistics, ayuda al usuario con lo que necesite.`;

// ── Definición de tools (JSON Schema) ──────────────────
const TOOLS = [
  {
    name: 'get_fleet_status',
    description: 'Devuelve el estado actual de toda la flota: unidades activas, su última posición GPS, velocidad, operador asignado y estado visual (en ruta, sin señal, alerta, detenida).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_alerts',
    description: 'Lista alertas operativas activas. Filtros opcionales por estado (pendiente/atendida/resuelta) y nivel (bajo/medio/alto/critico).',
    input_schema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['pendiente', 'atendida', 'resuelta', 'descartada'], description: 'Filtro por estado' },
        nivel: { type: 'string', enum: ['bajo', 'medio', 'alto', 'critico'], description: 'Filtro por nivel' },
        limit: { type: 'integer', description: 'Máximo de resultados (default 20)', default: 20 },
      },
    },
  },
  {
    name: 'get_operator_scoring',
    description: 'Devuelve el ranking de operadores con su score 0-100, viajes, rendimiento lt/km e incidentes en una ventana de tiempo (default 30 días).',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Días hacia atrás (default 30)', default: 30 },
      },
    },
  },
  {
    name: 'get_diesel_anomalies',
    description: 'Devuelve unidades con consumo de diesel anómalo: rendimiento real vs baseline esperado. Útil para detectar fugas, ordeña o mal manejo.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_cobranza_vencida',
    description: 'Lista facturas/ventas pendientes con fecha de vencimiento pasada. Incluye cliente, monto y días vencido.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_documentos_por_vencer',
    description: 'Lista documentos de unidades y operadores que vencen pronto o ya vencieron (licencia federal, póliza, tarjeta circulación, examen médico, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        dias_anticipacion: { type: 'integer', description: 'Días de anticipación para considerar "por vencer" (default 30)', default: 30 },
      },
    },
  },
  {
    name: 'get_viajes_recientes',
    description: 'Lista los viajes más recientes con su operador, unidad, ruta, diesel y estado.',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Días hacia atrás (default 7)', default: 7 },
        limit: { type: 'integer', description: 'Máximo de resultados (default 15)', default: 15 },
      },
    },
  },
  {
    name: 'get_clientes_inactivos',
    description: 'Lista clientes activos sin venta ni cotización en los últimos N días — riesgo de pérdida (churn).',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'integer', description: 'Días sin actividad (default 60)', default: 60 },
      },
    },
  },
  {
    name: 'get_kpis_mes',
    description: 'KPIs de operación de un mes específico: viajes completados, km totales, toneladas movidas, gasto en diesel, ingresos, utilidad estimada, rendimiento flota.',
    input_schema: {
      type: 'object',
      properties: {
        yyyymm: { type: 'string', description: 'Mes en formato YYYY-MM. Si se omite usa el mes actual.' },
      },
    },
  },
];

// ── Implementaciones de tools (consultan Postgres) ─────
async function ejecutarTool(nombre, input) {
  switch (nombre) {
    case 'get_fleet_status': {
      const { rows } = await db.query(`
        SELECT
          u.placas, u.descripcion, u.marca, u.modelo,
          op.nombre AS operador,
          ulp.velocidad_kmh, ulp.minutos_desde_ultimo,
          v.destino, v.estado AS viaje_estado,
          CASE
            WHEN ulp.minutos_desde_ultimo IS NULL THEN 'sin_datos'
            WHEN ulp.minutos_desde_ultimo > 15    THEN 'sin_senal'
            WHEN ulp.velocidad_kmh > 90           THEN 'alerta_velocidad'
            WHEN v.estado = 'En ruta'             THEN 'en_ruta'
            WHEN ulp.velocidad_kmh = 0            THEN 'detenida'
            ELSE 'activa'
          END AS estado_visual
        FROM unidades u
        LEFT JOIN unidades_ultima_posicion ulp ON ulp.unidad_id = u.id
        LEFT JOIN viajes v ON v.id = ulp.viaje_id
        LEFT JOIN operadores op ON op.id = v.operador_id
        WHERE u.activo = true
        ORDER BY u.placas
      `);
      return { unidades: rows, total: rows.length };
    }

    case 'get_alerts': {
      const where = [];
      const params = [];
      if (input.estado) { params.push(input.estado); where.push(`a.estado = $${params.length}`); }
      if (input.nivel)  { params.push(input.nivel);  where.push(`a.nivel  = $${params.length}`); }
      params.push(Math.min(parseInt(input.limit) || 20, 100));
      const { rows } = await db.query(`
        SELECT a.tipo, a.nivel, a.descripcion, a.recomendacion, a.estado, a.created_at,
               u.placas, op.nombre AS operador
        FROM alertas a
        LEFT JOIN unidades u    ON u.id = a.unidad_id
        LEFT JOIN operadores op ON op.id = a.operador_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY
          CASE a.nivel WHEN 'critico' THEN 0 WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 ELSE 3 END,
          a.created_at DESC
        LIMIT $${params.length}
      `, params);
      return { alertas: rows, total: rows.length };
    }

    case 'get_operator_scoring': {
      const dias = Math.min(parseInt(input.dias) || 30, 365);
      const { rows } = await db.query(`
        WITH base AS (
          SELECT
            o.id AS operador_id, o.nombre,
            COUNT(v.id) FILTER (WHERE v.estado='Completado')::int AS viajes,
            COALESCE(SUM(v.diesel_litros) FILTER (WHERE v.estado='Completado' AND v.km_recorridos>0)
                    / NULLIF(SUM(v.km_recorridos) FILTER (WHERE v.estado='Completado' AND v.km_recorridos>0), 0), 0)::float AS rend_lt_km,
            COUNT(a.id) FILTER (WHERE a.nivel IN ('alto','critico'))::int AS incidentes
          FROM operadores o
          LEFT JOIN viajes v ON v.operador_id = o.id AND v.fecha >= CURRENT_DATE - ($1::int || ' days')::interval
          LEFT JOIN alertas a ON a.operador_id = o.id AND a.created_at >= NOW() - ($1::int || ' days')::interval
          WHERE o.activo = true
          GROUP BY o.id, o.nombre
        )
        SELECT nombre, viajes, ROUND(rend_lt_km::numeric, 3)::float AS rend_lt_km, incidentes,
          GREATEST(0, LEAST(100,
            100 - LEAST(40, incidentes * 10)
            - CASE WHEN rend_lt_km > 2.5 THEN 30 WHEN rend_lt_km > 2.0 THEN 15
                   WHEN rend_lt_km BETWEEN 1.8 AND 2.0 THEN 0
                   WHEN rend_lt_km > 0 AND rend_lt_km < 1.8 THEN 5 ELSE 0 END
          ))::int AS score
        FROM base ORDER BY score DESC, viajes DESC
      `, [dias]);
      return { operadores: rows, dias };
    }

    case 'get_diesel_anomalies': {
      const { rows } = await db.query(`
        SELECT
          u.placas, u.descripcion,
          v.destino,
          v.km_recorridos, v.diesel_litros,
          ROUND((v.diesel_litros / NULLIF(v.km_recorridos, 0))::numeric, 3)::float AS rend_real,
          b.rendimiento_esperado_lt_km AS rend_esperado,
          ROUND(((v.diesel_litros / NULLIF(v.km_recorridos, 0)) - b.rendimiento_esperado_lt_km)::numeric, 3)::float AS diferencia
        FROM viajes v
        JOIN unidades u ON u.id = v.unidad_id
        JOIN diesel_baselines b ON b.unidad_id = v.unidad_id AND (b.destino = v.destino OR b.destino IS NULL)
        WHERE v.estado = 'Completado' AND v.km_recorridos > 0
          AND (v.diesel_litros / v.km_recorridos) > b.rendimiento_esperado_lt_km * 1.15
          AND v.fecha >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY diferencia DESC
        LIMIT 15
      `);
      return { anomalias: rows, total: rows.length };
    }

    case 'get_cobranza_vencida': {
      const { rows } = await db.query(`
        SELECT
          v.fecha, v.fecha_vencimiento, v.total,
          c.nombre AS cliente, c.telefono,
          (CURRENT_DATE - v.fecha_vencimiento)::int AS dias_vencido
        FROM ventas v
        LEFT JOIN clientes c ON c.id = v.cliente_id
        WHERE v.estado_pago = 'pendiente'
          AND v.fecha_vencimiento IS NOT NULL
          AND v.fecha_vencimiento < CURRENT_DATE
        ORDER BY v.fecha_vencimiento ASC
        LIMIT 20
      `);
      const total_monto = rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
      return { facturas: rows, total_facturas: rows.length, total_monto };
    }

    case 'get_documentos_por_vencer': {
      const dias = Math.min(parseInt(input.dias_anticipacion) || 30, 180);
      const { rows: docsU } = await db.query(`
        SELECT 'unidad' AS entidad, u.placas AS sujeto, d.tipo, d.nombre, d.vigencia_fin,
               (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
               CASE WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido' ELSE 'por_vencer' END AS estado
        FROM unidad_documentos d JOIN unidades u ON u.id = d.unidad_id
        WHERE d.vigencia_fin IS NOT NULL
          AND d.vigencia_fin <= CURRENT_DATE + ($1::int || ' days')::interval
      `, [dias]);
      const { rows: docsO } = await db.query(`
        SELECT 'operador' AS entidad, op.nombre AS sujeto, d.tipo, d.nombre, d.vigencia_fin,
               (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
               CASE WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido' ELSE 'por_vencer' END AS estado
        FROM operador_documentos d JOIN operadores op ON op.id = d.operador_id
        WHERE d.vigencia_fin IS NOT NULL
          AND d.vigencia_fin <= CURRENT_DATE + ($1::int || ' days')::interval
      `, [dias]);
      const docs = [...docsU, ...docsO].sort((a, b) => a.dias_restantes - b.dias_restantes);
      return { documentos: docs, vencidos: docs.filter(d => d.estado === 'vencido').length, por_vencer: docs.filter(d => d.estado === 'por_vencer').length };
    }

    case 'get_viajes_recientes': {
      const dias = Math.min(parseInt(input.dias) || 7, 90);
      const limit = Math.min(parseInt(input.limit) || 15, 50);
      const { rows } = await db.query(`
        SELECT v.fecha, v.origen, v.destino, v.carga,
               v.km_recorridos, v.diesel_litros, v.diesel_costo, v.estado,
               u.placas, op.nombre AS operador
        FROM viajes v
        LEFT JOIN unidades u ON u.id = v.unidad_id
        LEFT JOIN operadores op ON op.id = v.operador_id
        WHERE v.fecha >= CURRENT_DATE - ($1::int || ' days')::interval
        ORDER BY v.fecha DESC, v.id DESC
        LIMIT $2
      `, [dias, limit]);
      return { viajes: rows, total: rows.length };
    }

    case 'get_clientes_inactivos': {
      const dias = Math.min(parseInt(input.dias) || 60, 365);
      const { rows } = await db.query(`
        WITH ultima AS (
          SELECT cliente_id, MAX(fecha) AS ultima_fecha FROM (
            SELECT cliente_id, fecha FROM ventas WHERE cliente_id IS NOT NULL
            UNION ALL
            SELECT cliente_id, fecha FROM cotizaciones WHERE cliente_id IS NOT NULL
          ) acts GROUP BY cliente_id
        )
        SELECT c.nombre, c.telefono, c.tipo,
               ua.ultima_fecha,
               CASE WHEN ua.ultima_fecha IS NULL THEN NULL
                    ELSE (CURRENT_DATE - ua.ultima_fecha)::int END AS dias_sin_actividad,
               (SELECT COALESCE(SUM(total), 0) FROM ventas WHERE cliente_id = c.id)::float AS valor_historico
        FROM clientes c
        LEFT JOIN ultima ua ON ua.cliente_id = c.id
        WHERE c.activo = true
          AND (ua.ultima_fecha IS NULL OR ua.ultima_fecha < CURRENT_DATE - ($1::int || ' days')::interval)
        ORDER BY valor_historico DESC NULLS LAST
        LIMIT 15
      `, [dias]);
      return { clientes: rows, total: rows.length, dias_corte: dias };
    }

    case 'get_kpis_mes': {
      const yyyymm = input.yyyymm || new Date().toISOString().slice(0, 7);
      const [yyyy, mm] = yyyymm.split('-');
      const fi = `${yyyy}-${mm}-01`;
      const ff = new Date(parseInt(yyyy), parseInt(mm), 0).toISOString().slice(0, 10);
      const { rows: [k] } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE estado = 'Completado')::int AS viajes_completados,
          COALESCE(SUM(km_recorridos)  FILTER (WHERE estado='Completado'), 0)::float AS total_km,
          COALESCE(SUM(toneladas)      FILTER (WHERE estado='Completado'), 0)::float AS total_toneladas,
          COALESCE(SUM(diesel_litros)  FILTER (WHERE estado='Completado'), 0)::float AS total_litros,
          COALESCE(SUM(diesel_costo)   FILTER (WHERE estado='Completado'), 0)::float AS total_diesel,
          COALESCE(SUM(diesel_litros) FILTER (WHERE estado='Completado' AND km_recorridos > 0)
                  / NULLIF(SUM(km_recorridos) FILTER (WHERE estado='Completado' AND km_recorridos > 0), 0), 0)::float AS rend_flota
        FROM viajes WHERE fecha BETWEEN $1 AND $2
      `, [fi, ff]);
      const { rows: [v] } = await db.query(`
        SELECT COALESCE(SUM(total), 0)::float AS ingresos, COUNT(*)::int AS facturas
        FROM ventas WHERE fecha BETWEEN $1 AND $2
      `, [fi, ff]);
      return {
        periodo: { inicio: fi, fin: ff, yyyymm },
        viajes_completados: k.viajes_completados,
        km_totales: k.total_km,
        toneladas: k.total_toneladas,
        litros_diesel: k.total_litros,
        gasto_diesel: k.total_diesel,
        rendimiento_flota_lt_km: k.rend_flota,
        ingresos: v.ingresos,
        facturas_emitidas: v.facturas,
        utilidad_estimada: v.ingresos - k.total_diesel,
      };
    }

    default:
      return { error: `Tool desconocido: ${nombre}` };
  }
}

// ── Conversación principal con Claude (tool-use loop) ──
async function preguntar({ mensaje, historial = [] }) {
  const client = getClient();
  if (!client) {
    throw new Error('ANTHROPIC_API_KEY no configurado. El supervisor IA conversacional requiere configurar la API key de Anthropic en Railway.');
  }

  // Construir messages: historial previo + nuevo mensaje del usuario
  const messages = [
    ...historial.map(h => ({
      role: h.role,
      content: typeof h.content === 'string' ? h.content : h.content,
    })),
    { role: 'user', content: mensaje },
  ];

  let iteraciones = 0;
  const eventos = []; // log de cada iteración para devolver al frontend
  let usageTotal = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  while (iteraciones < MAX_ITERACIONES) {
    iteraciones++;

    const response = await client.messages.create({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, // ← cachea el prefix estable
        },
      ],
      tools: TOOLS,
      messages,
    });

    // Acumular usage
    usageTotal.input_tokens += response.usage.input_tokens || 0;
    usageTotal.output_tokens += response.usage.output_tokens || 0;
    usageTotal.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
    usageTotal.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;

    // Append assistant response al historial
    messages.push({ role: 'assistant', content: response.content });

    // Si terminó normal o pidió pause_turn sin tools, salir
    if (response.stop_reason === 'end_turn') {
      const texto = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();
      return {
        respuesta: texto,
        historial: messages,
        usage: usageTotal,
        iteraciones,
        eventos,
        stop_reason: 'end_turn',
      };
    }

    if (response.stop_reason === 'refusal') {
      return {
        respuesta: 'No puedo responder esta pregunta. Intenta reformularla relacionada a la operación de Andreu Logistics.',
        historial: messages,
        usage: usageTotal,
        iteraciones,
        eventos,
        stop_reason: 'refusal',
      };
    }

    if (response.stop_reason !== 'tool_use') {
      // max_tokens, pause_turn u otros: salir con lo que tengamos
      const texto = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return {
        respuesta: texto || '(respuesta truncada o incompleta)',
        historial: messages,
        usage: usageTotal,
        iteraciones,
        eventos,
        stop_reason: response.stop_reason,
      };
    }

    // Procesar todas las tool_use blocks de esta iteración
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const tu of toolUses) {
      eventos.push({ tipo: 'tool_use', nombre: tu.name, input: tu.input });
      let resultado;
      try {
        resultado = await ejecutarTool(tu.name, tu.input || {});
      } catch (e) {
        resultado = { error: e.message };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(resultado),
        is_error: !!resultado.error,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    respuesta: 'Se alcanzó el límite de iteraciones sin obtener respuesta. Reformula tu pregunta más específicamente.',
    historial: messages,
    usage: usageTotal,
    iteraciones,
    eventos,
    stop_reason: 'max_iterations',
  };
}

module.exports = { isAvailable, preguntar, MODELO };
