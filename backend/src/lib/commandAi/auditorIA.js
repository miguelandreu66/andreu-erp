// ════════════════════════════════════════════════════════════════
// AUDITOR IA — Análisis profundo semanal de la operación
// ════════════════════════════════════════════════════════════════
// Usa Claude Opus 4.7 con adaptive thinking + structured output.
// Recopila datos de 8 módulos, manda contexto rico a Claude, parsea
// hallazgos estructurados y los persiste con workflow.
// El director marca aplicada/descartada → se usa como aprendizaje
// para la siguiente auditoría (Claude no repite descartados).
// ════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('../../db');
const apiKeys = require('./apiKeysStore');

const MODELO_DEFAULT = 'claude-opus-4-7';
const MAX_TOKENS_OUTPUT = 16000;

// Precios USD por 1M tokens (Opus 4.7)
const PRECIO_INPUT_USD  = 5.00 / 1_000_000;
const PRECIO_OUTPUT_USD = 25.00 / 1_000_000;

// ── Cliente Anthropic on-demand ──
async function getClient() {
  const apiKey = await apiKeys.leer('anthropic_api_key');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado. El Auditor IA requiere API key de Anthropic en Configuración.');
  return new Anthropic({ apiKey, maxRetries: 4 });
}

// ════════════════════════════════════════════════════════════════
// RECOPILACIÓN DE CONTEXTO — toma snapshots de 8 módulos
// ════════════════════════════════════════════════════════════════
async function recopilarContexto() {
  const ctx = {
    generado_at: new Date().toISOString(),
    rango_analisis: 'últimas 12 semanas',
  };

  // 1) Ingresos por semana últimas 12 semanas
  const { rows: ingresos } = await db.query(`
    SELECT
      to_char(date_trunc('week', fecha), 'YYYY-"W"IW') AS semana,
      COUNT(*)::int AS viajes,
      COALESCE(SUM(monto_cobrado_cliente), 0)::float AS ingresos_propios,
      COALESCE(SUM(comision_andreu), 0)::float AS comisiones_broker
    FROM viajes
    WHERE fecha >= CURRENT_DATE - INTERVAL '12 weeks'
    GROUP BY 1 ORDER BY 1
  `).catch(() => ({ rows: [] }));
  ctx.ingresos_semana = ingresos;

  // 2) Operadores: scoring actual + tendencia
  const { rows: operadores } = await db.query(`
    SELECT
      o.id, o.nombre,
      COUNT(v.id)::int AS viajes_mes,
      COALESCE(AVG(v.km_recorridos)::float, 0) AS km_promedio,
      COALESCE(SUM(v.litros_diesel) / NULLIF(SUM(v.km_recorridos), 0), 0)::float AS lt_por_km
    FROM operadores o
    LEFT JOIN viajes v ON v.operador_id = o.id
      AND v.fecha >= CURRENT_DATE - INTERVAL '30 days'
    WHERE o.activo = true
    GROUP BY o.id, o.nombre
    ORDER BY viajes_mes DESC
    LIMIT 30
  `).catch(() => ({ rows: [] }));
  ctx.operadores = operadores;

  // 3) Clientes: cambios de comportamiento
  const { rows: clientes } = await db.query(`
    WITH ventana_actual AS (
      SELECT cliente_id, COUNT(*)::int AS viajes_30d, SUM(monto_cobrado_cliente)::float AS ingresos_30d
      FROM viajes
      WHERE cliente_id IS NOT NULL
        AND fecha >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY cliente_id
    ), ventana_anterior AS (
      SELECT cliente_id, COUNT(*)::int AS viajes_anteriores, SUM(monto_cobrado_cliente)::float AS ingresos_anteriores
      FROM viajes
      WHERE cliente_id IS NOT NULL
        AND fecha >= CURRENT_DATE - INTERVAL '60 days'
        AND fecha < CURRENT_DATE - INTERVAL '30 days'
      GROUP BY cliente_id
    )
    SELECT
      c.id, c.nombre, c.tipo,
      COALESCE(va.viajes_30d, 0) AS viajes_30d,
      COALESCE(van.viajes_anteriores, 0) AS viajes_30d_anteriores,
      COALESCE(va.ingresos_30d, 0)::float AS ingresos_30d,
      COALESCE(van.ingresos_anteriores, 0)::float AS ingresos_30d_anteriores
    FROM clientes c
    LEFT JOIN ventana_actual va  ON va.cliente_id = c.id
    LEFT JOIN ventana_anterior van ON van.cliente_id = c.id
    WHERE (va.viajes_30d > 0 OR van.viajes_anteriores > 0)
    ORDER BY GREATEST(COALESCE(va.ingresos_30d, 0), COALESCE(van.ingresos_anteriores, 0)) DESC
    LIMIT 50
  `).catch(() => ({ rows: [] }));
  ctx.clientes = clientes;

  // 4) Rutas: top origen-destino con margen
  const { rows: rutas } = await db.query(`
    SELECT
      origen, destino,
      COUNT(*)::int AS viajes,
      AVG(km_recorridos)::float AS km_promedio,
      SUM(monto_cobrado_cliente)::float AS ingresos_totales,
      SUM(COALESCE(litros_diesel, 0) * 27.0)::float AS gasto_diesel_estimado,
      AVG(monto_cobrado_cliente)::float AS ticket_promedio
    FROM viajes
    WHERE fecha >= CURRENT_DATE - INTERVAL '90 days'
      AND origen IS NOT NULL AND destino IS NOT NULL
    GROUP BY origen, destino
    HAVING COUNT(*) >= 2
    ORDER BY ingresos_totales DESC
    LIMIT 20
  `).catch(() => ({ rows: [] }));
  ctx.rutas = rutas;

  // 5) Broker: cashflow + concentración + transportistas
  const { rows: [brokerExp] } = await db.query(`SELECT * FROM broker_cashflow_exposicion`).catch(() => ({ rows: [{}] }));
  const { rows: brokerCl } = await db.query(`SELECT * FROM broker_concentracion_clientes LIMIT 5`).catch(() => ({ rows: [] }));
  const { rows: brokerTr } = await db.query(`SELECT * FROM broker_concentracion_transportistas LIMIT 5`).catch(() => ({ rows: [] }));
  const { rows: transps } = await db.query(`
    SELECT id, razon_social, estado_verificacion, calificacion, total_viajes_completados, total_incidentes, score_automatico
    FROM transportistas_externos WHERE activo = true ORDER BY score_automatico DESC LIMIT 20
  `).catch(() => ({ rows: [] }));
  ctx.broker = {
    exposicion: brokerExp || {},
    top_clientes_broker: brokerCl,
    top_transportistas: brokerTr,
    transportistas_red: transps,
  };

  // 6) Gastos diesel anomalías por unidad
  const { rows: gastos } = await db.query(`
    WITH baseline AS (
      SELECT unidad_id, AVG(litros_diesel / NULLIF(km_recorridos, 0))::float AS lt_km_baseline
      FROM viajes
      WHERE fecha >= CURRENT_DATE - INTERVAL '90 days'
        AND fecha < CURRENT_DATE - INTERVAL '14 days'
        AND km_recorridos > 0 AND litros_diesel > 0
      GROUP BY unidad_id
    ), actual AS (
      SELECT unidad_id, AVG(litros_diesel / NULLIF(km_recorridos, 0))::float AS lt_km_actual,
             SUM(litros_diesel)::float AS litros_recientes
      FROM viajes
      WHERE fecha >= CURRENT_DATE - INTERVAL '14 days'
        AND km_recorridos > 0 AND litros_diesel > 0
      GROUP BY unidad_id
    )
    SELECT u.placa, u.id AS unidad_id,
           b.lt_km_baseline, a.lt_km_actual,
           ((a.lt_km_actual - b.lt_km_baseline) / NULLIF(b.lt_km_baseline, 0) * 100)::float AS desvio_pct,
           a.litros_recientes
    FROM baseline b
    JOIN actual a ON a.unidad_id = b.unidad_id
    JOIN unidades u ON u.id = b.unidad_id
    WHERE a.lt_km_actual > 0
    ORDER BY ABS((a.lt_km_actual - b.lt_km_baseline)) DESC
    LIMIT 15
  `).catch(() => ({ rows: [] }));
  ctx.diesel_anomalias = gastos;

  // 7) Mantenimientos vencidos o próximos
  const { rows: manten } = await db.query(`
    SELECT u.placa, m.tipo_servicio, m.km_objetivo, m.km_alerta, u.km_actual,
           CASE WHEN u.km_actual >= m.km_objetivo THEN 'vencido'
                WHEN u.km_actual >= m.km_alerta   THEN 'proximo'
                ELSE 'vigente' END AS estado_servicio
    FROM mantenimiento_programado m
    JOIN unidades u ON u.id = m.unidad_id
    WHERE m.activo = true
      AND u.km_actual >= m.km_alerta
    ORDER BY (u.km_actual - m.km_objetivo) DESC
    LIMIT 20
  `).catch(() => ({ rows: [] }));
  ctx.mantenimiento = manten;

  // 8) Documentos por vencer
  const { rows: docsUnid } = await db.query(`
    SELECT u.placa, d.tipo, d.vigencia_fin, (d.vigencia_fin - CURRENT_DATE)::int AS dias
    FROM unidad_documentos d
    JOIN unidades u ON u.id = d.unidad_id
    WHERE d.vigencia_fin IS NOT NULL
      AND d.vigencia_fin <= CURRENT_DATE + INTERVAL '60 days'
    ORDER BY d.vigencia_fin
    LIMIT 30
  `).catch(() => ({ rows: [] }));
  const { rows: docsOp } = await db.query(`
    SELECT o.nombre AS operador, d.tipo, d.vigencia_fin, (d.vigencia_fin - CURRENT_DATE)::int AS dias
    FROM operador_documentos d
    JOIN operadores o ON o.id = d.operador_id
    WHERE d.vigencia_fin IS NOT NULL
      AND d.vigencia_fin <= CURRENT_DATE + INTERVAL '60 days'
    ORDER BY d.vigencia_fin
    LIMIT 30
  `).catch(() => ({ rows: [] }));
  ctx.documentos_por_vencer = { unidades: docsUnid, operadores: docsOp };

  // 9) Leads cotizador (CRM)
  const { rows: leadsStats } = await db.query(`
    SELECT estado, COUNT(*)::int AS n, COALESCE(SUM(precio_final), 0)::float AS valor
    FROM leads
    WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
    GROUP BY estado
  `).catch(() => ({ rows: [] }));
  const { rows: leadsTopVal } = await db.query(`
    SELECT folio, empresa, contacto_nombre, precio_final, estado, created_at,
           EXTRACT(DAYS FROM NOW() - created_at)::int AS dias_sin_atender
    FROM leads
    WHERE estado IN ('nuevo','contactado','propuesta_enviada','negociando')
    ORDER BY precio_final DESC
    LIMIT 10
  `).catch(() => ({ rows: [] }));
  ctx.leads = { por_estado: leadsStats, top_pendientes: leadsTopVal };

  // 10) Aprendizaje: decisiones pasadas (qué descartó/aplicó el director)
  const { rows: aprendizaje } = await db.query(`
    SELECT tipo, categoria, severidad, titulo, status, notas_director, decidida_at
    FROM auditoria_ia_aprendizaje
    LIMIT 50
  `).catch(() => ({ rows: [] }));
  ctx.aprendizaje_director = aprendizaje;

  return ctx;
}

// ════════════════════════════════════════════════════════════════
// PROMPT — system + contexto
// ════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Eres el **Auditor IA** de Andreu Logistics, empresa B2B de transporte de carga pesada en Cuernavaca, Morelos. 3 plataformas de 48' propias + red broker de transportistas externos verificados.

# Tu trabajo
Cada semana analizas TODOS los datos del negocio y entregas un reporte ejecutivo al director (Miguel Andreu) con:

1. **ERRORES detectados** — cosas que están mal AHORITA y requieren acción inmediata (caídas de ingresos, operadores rindiendo bajo, clientes enfriándose, unidades con servicio vencido, transportistas broker con docs por vencer, gastos atípicos, cashflow comprometido).

2. **OPORTUNIDADES de crecimiento** — cosas para capturar (rutas rentables sub-explotadas, clientes con potencial de crecer, leads de alto valor sin atender, segmentos de mercado nuevos, capacidad ociosa, mejoras de proceso con impacto en $$$).

# Reglas estrictas
- **Cada hallazgo debe tener números reales del snapshot**. No inventes datos. Si no hay evidencia suficiente para un hallazgo, NO lo emitas.
- **Cuantifica el impacto en pesos mexicanos**. Estima cuánto te puede costar el problema o cuánto puedes ganar con la oportunidad. Si no puedes estimar, omite el campo.
- **Acción recomendada concreta y accionable**. Nada genérico tipo "mejorar el servicio". Sé específico: "Llamar al cliente X hoy", "Programar servicio a unidad placa Y antes del viernes", "Subir docs vencidos del transportista Z".
- **Aprende del director**: revisa "aprendizaje_director" en el contexto. Si el director DESCARTÓ algo similar antes con notas, NO repitas ese tipo de hallazgo. Si APLICÓ varios de un tipo, prioriza más de ese estilo.
- **Severidad realista**:
  - "critico" = pierde dinero diario o riesgo legal/operativo grave
  - "alto" = oportunidad de >$50k mxn o problema con impacto en 7-14d
  - "medio" = mejora útil pero no urgente
  - "bajo" = nice-to-have
- **Top 15-25 hallazgos máximo**. Mejor concentrarte en lo que mueve la aguja que en listar todo.

# Contexto operativo Andreu
- Andreu opera carga **general/frágil** con plataformas 48'. Refrigerada/peligrosa/líquidos van a BROKER (transportistas externos).
- Meta rendimiento diesel: 1.8-2.0 lt/km. Arriba de 2.0 es alto consumo.
- Zonas propias: Morelos, CDMX, EdoMex, Guerrero, Puebla, Oaxaca. Fuera de eso → broker.
- Documentos críticos: licencia federal, permiso SCT, póliza seguro, tarjeta circulación, verificación.

# Formato de salida
Devuelve UN ÚNICO objeto JSON con esta estructura exacta. No texto fuera del JSON:

{
  "resumen_ejecutivo": "string de 2-4 oraciones que el director lee en 30 segundos para entender la semana",
  "hallazgos": [
    {
      "tipo": "error" | "oportunidad",
      "categoria": "ingresos" | "operadores" | "clientes" | "rutas" | "broker" | "cashflow" | "gastos" | "mantenimiento" | "leads" | "documentos" | "otro",
      "severidad": "critico" | "alto" | "medio" | "bajo",
      "titulo": "string corto y específico (máx 120 chars)",
      "descripcion": "explicación con NÚMEROS REALES del snapshot, máx 400 chars",
      "evidencia": { /* objeto con los datos clave que sustentan, sin inventar */ },
      "accion_recomendada": "qué hacer concretamente, máx 300 chars",
      "impacto_mxn": número | null,
      "ventana_dias": número | null,
      "confianza": "baja" | "media" | "alta",
      "entidad_tipo": "operador" | "cliente" | "unidad" | "transportista" | "ruta" | "viaje" | null,
      "entidad_ids": [array de ids si aplica]
    }
  ]
}`;

function construirMensajeUsuario(contexto) {
  const fence = '```';
  return `Aquí tienes el snapshot completo de Andreu Logistics generado el ${contexto.generado_at}.

Analiza profundamente y devuelve el JSON con resumen_ejecutivo + hallazgos según el formato del system prompt.

${fence}json
${JSON.stringify(contexto, null, 2)}
${fence}

Recuerda:
- Solo emite hallazgos con evidencia REAL del snapshot
- Aprende del director: no repitas tipos de hallazgos que descartó
- Cuantifica impacto en MXN cuando sea posible
- Acciones concretas, no genéricas`;
}

// ════════════════════════════════════════════════════════════════
// ANÁLISIS — llama a Claude Opus 4.7
// ════════════════════════════════════════════════════════════════
async function analizarConClaude(contexto, opciones = {}) {
  const client = await getClient();
  const t0 = Date.now();

  const modelo = opciones.modelo || MODELO_DEFAULT;
  const maxCostoUsd = parseFloat(opciones.max_costo_usd || 5);

  const response = await client.messages.create({
    model: modelo,
    max_tokens: MAX_TOKENS_OUTPUT,
    // Opus 4.7 sólo soporta adaptive thinking
    thinking: { type: 'adaptive', display: 'summarized' },
    // effort xhigh — el mejor para tareas analíticas profundas en 4.7
    // Si el modelo no soporta xhigh (ej. fallback a opus-4-6), la API ignora el campo
    output_config: { effort: 'xhigh' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: construirMensajeUsuario(contexto) }],
  });

  const duracionMs = Date.now() - t0;
  const usage = response.usage || {};
  const promptT     = usage.input_tokens || 0;
  const completionT = usage.output_tokens || 0;

  // Thinking tokens (si vienen)
  let thinkingT = 0;
  for (const b of response.content || []) {
    if (b.type === 'thinking') {
      // approx — la API no siempre los desglosa, asumimos están en output_tokens
      thinkingT += 0;
    }
  }

  const costoUsd = (promptT * PRECIO_INPUT_USD) + (completionT * PRECIO_OUTPUT_USD);

  if (costoUsd > maxCostoUsd * 1.2) {
    console.warn(`[AuditorIA] Costo $${costoUsd.toFixed(4)} excedió tope $${maxCostoUsd}`);
  }

  // Extraer texto del response (skip thinking blocks)
  const textoCompleto = (response.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  // Parsear JSON del response — Claude puede envolver en ```json ... ```
  let parsed;
  const matchCodeBlock = textoCompleto.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = matchCodeBlock ? matchCodeBlock[1] : textoCompleto;

  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch (e) {
    // Intento fallback: extraer el primer objeto JSON balanceado
    const start = jsonStr.indexOf('{');
    const end   = jsonStr.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(jsonStr.slice(start, end + 1)); }
      catch (e2) {
        throw new Error(`No se pudo parsear JSON del response: ${e.message}. Inicio del texto: ${textoCompleto.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Response no contiene JSON parseable: ${textoCompleto.slice(0, 200)}`);
    }
  }

  if (!parsed.hallazgos || !Array.isArray(parsed.hallazgos)) {
    throw new Error('Response no tiene array "hallazgos" válido');
  }

  return {
    resumen_ejecutivo: parsed.resumen_ejecutivo || '',
    hallazgos: parsed.hallazgos,
    modelo,
    duracion_ms: duracionMs,
    usage: {
      prompt_tokens: promptT,
      completion_tokens: completionT,
      thinking_tokens: thinkingT,
    },
    costo_usd: costoUsd,
    raw_response: response,
  };
}

// ════════════════════════════════════════════════════════════════
// PERSISTENCIA
// ════════════════════════════════════════════════════════════════
function semanaIso(fecha = new Date()) {
  // ISO 8601 week (YYYY-Wnn)
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

async function persistirEjecucion({ tipo, iniciada_por, semana }) {
  const { rows: [e] } = await db.query(`
    INSERT INTO auditoria_ia_ejecuciones
      (tipo, estado, iniciada_por, semana_iso)
    VALUES ($1, 'en_curso', $2, $3)
    RETURNING *
  `, [tipo || 'manual', iniciada_por || null, semana || semanaIso()]);
  return e;
}

async function completarEjecucion(ejecucionId, resultado, contextoSnapshot) {
  await db.query(`
    UPDATE auditoria_ia_ejecuciones
    SET estado = 'completada',
        modelo = $1,
        prompt_tokens = $2,
        completion_tokens = $3,
        thinking_tokens = $4,
        costo_usd = $5,
        duracion_ms = $6,
        resumen_ejecutivo = $7,
        contexto_snapshot = $8,
        raw_response = $9,
        completada_at = NOW()
    WHERE id = $10
  `, [
    resultado.modelo,
    resultado.usage.prompt_tokens,
    resultado.usage.completion_tokens,
    resultado.usage.thinking_tokens || 0,
    resultado.costo_usd,
    resultado.duracion_ms,
    resultado.resumen_ejecutivo,
    contextoSnapshot,
    { content: resultado.raw_response.content, usage: resultado.raw_response.usage, stop_reason: resultado.raw_response.stop_reason },
    ejecucionId,
  ]);

  // Insertar cada hallazgo
  let insertados = 0;
  for (const h of resultado.hallazgos) {
    // Validación mínima
    if (!h.tipo || !['error','oportunidad'].includes(h.tipo)) continue;
    if (!h.severidad || !['critico','alto','medio','bajo'].includes(h.severidad)) continue;
    if (!h.titulo || !h.descripcion || !h.accion_recomendada) continue;

    try {
      await db.query(`
        INSERT INTO auditoria_ia_hallazgos
          (ejecucion_id, tipo, categoria, severidad, titulo, descripcion,
           evidencia, accion_recomendada, impacto_mxn, ventana_dias, confianza,
           entidad_tipo, entidad_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        ejecucionId, h.tipo,
        (h.categoria || 'otro').toLowerCase().slice(0, 40),
        h.severidad,
        h.titulo.slice(0, 200),
        h.descripcion,
        h.evidencia || {},
        h.accion_recomendada,
        h.impacto_mxn || null,
        h.ventana_dias || null,
        ['baja','media','alta'].includes(h.confianza) ? h.confianza : 'media',
        h.entidad_tipo || null,
        Array.isArray(h.entidad_ids) ? h.entidad_ids.filter(x => Number.isInteger(x)) : null,
      ]);
      insertados++;
    } catch (e) {
      console.warn(`[AuditorIA] hallazgo no insertado: ${e.message}. Titulo: ${h.titulo}`);
    }
  }

  return insertados;
}

async function marcarFallida(ejecucionId, errorMsg) {
  await db.query(`
    UPDATE auditoria_ia_ejecuciones
    SET estado = 'fallida',
        error_mensaje = $1,
        completada_at = NOW()
    WHERE id = $2
  `, [errorMsg.slice(0, 2000), ejecucionId]);
}

// ════════════════════════════════════════════════════════════════
// ORQUESTADOR — ejecuta auditoría completa
// ════════════════════════════════════════════════════════════════
async function ejecutarAuditoria({ tipo = 'manual', iniciada_por = null } = {}) {
  const ejecucion = await persistirEjecucion({ tipo, iniciada_por });
  try {
    // 1) Recopilar contexto
    const contexto = await recopilarContexto();

    // 2) Leer configs
    const { rows: cfgs } = await db.query(`
      SELECT clave, valor FROM configuracion_empresa
      WHERE clave IN ('auditor_ia_modelo', 'auditor_ia_max_costo_usd')
    `);
    const cfg = Object.fromEntries(cfgs.map(c => [c.clave, c.valor]));

    // 3) Analizar con Claude
    const resultado = await analizarConClaude(contexto, {
      modelo: cfg.auditor_ia_modelo || MODELO_DEFAULT,
      max_costo_usd: cfg.auditor_ia_max_costo_usd || 5,
    });

    // 4) Persistir
    const insertados = await completarEjecucion(ejecucion.id, resultado, contexto);

    return {
      ok: true,
      ejecucion_id: ejecucion.id,
      hallazgos_emitidos: resultado.hallazgos.length,
      hallazgos_insertados: insertados,
      costo_usd: resultado.costo_usd,
      duracion_ms: resultado.duracion_ms,
      modelo: resultado.modelo,
      resumen: resultado.resumen_ejecutivo,
    };
  } catch (e) {
    console.error('[AuditorIA] error:', e.message);
    await marcarFallida(ejecucion.id, e.message);
    throw e;
  }
}

module.exports = {
  ejecutarAuditoria,
  recopilarContexto,    // expuesto para debug
  analizarConClaude,    // expuesto para tests
  semanaIso,
};
