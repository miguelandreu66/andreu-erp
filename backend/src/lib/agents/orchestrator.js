// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Orchestrator de Agentes IA
// ════════════════════════════════════════════════════════════════
// Helper común para invocar agentes Claude con system prompt + tools.
//
// Cada agente del sistema Andreu se registra aquí con:
//   - modelo (claude-opus-4-7 | claude-sonnet-4-6 | claude-haiku-4-5)
//   - system prompt (la "personalidad" + reglas + límites del agente)
//   - tools (funciones que puede llamar para consultar/modificar DB)
//   - cache_control para reducir costos
//
// El orchestrator:
//   - Cachea el cliente Anthropic
//   - Aplica prompt caching estable (system + tools)
//   - Ejecuta el tool-use loop con safety cap
//   - Trackea tokens + costo USD
//   - Persiste conversaciones para auditoría
//
// Uso:
//   const r = await invocarAgente('ceo', {
//     mensaje: 'Análisis del mes',
//     historial: [],
//     usuario_id: 1,
//   });
// ════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('../../db');
const apiKeys = require('../commandAi/apiKeysStore');

const MAX_ITERACIONES = 10;
const MAX_TOKENS_DEFAULT = 4096;

// Precios USD por 1M tokens
const PRECIOS = {
  'claude-opus-4-7':    { in: 5.00,  out: 25.00, thinking: 25.00 },
  'claude-opus-4-6':    { in: 5.00,  out: 25.00, thinking: 25.00 },
  'claude-sonnet-4-6':  { in: 3.00,  out: 15.00, thinking: 15.00 },
  'claude-haiku-4-5':   { in: 1.00,  out: 5.00,  thinking: 5.00 },
};

// Cache de cliente Anthropic (invalidado si cambia la API key)
let _client = null;
let _clientKey = null;

async function getClient() {
  const apiKey = await apiKeys.leer('anthropic_api_key');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado. Activa la API en Configuración → API Keys.');
  if (_client && _clientKey === apiKey) return _client;
  _client = new Anthropic({ apiKey, maxRetries: 4 });
  _clientKey = apiKey;
  return _client;
}

// ════════════════════════════════════════════════════════════════
// REGISTRY DE AGENTES — definidos en archivos separados
// ════════════════════════════════════════════════════════════════

const AGENTES = {};

function registrarAgente(nombre, definicion) {
  if (!definicion.systemPrompt) throw new Error(`Agente ${nombre} sin systemPrompt`);
  if (!definicion.modelo) definicion.modelo = 'claude-sonnet-4-6';
  if (!definicion.tools) definicion.tools = [];
  if (!definicion.ejecutarTool) definicion.ejecutarTool = async () => ({ error: 'No tool runner' });
  AGENTES[nombre] = definicion;
}

function obtenerAgente(nombre) {
  const a = AGENTES[nombre];
  if (!a) throw new Error(`Agente "${nombre}" no registrado`);
  return a;
}

function listarAgentes() {
  return Object.entries(AGENTES).map(([nombre, def]) => ({
    nombre,
    titulo: def.titulo || nombre,
    descripcion: def.descripcion || '',
    modelo: def.modelo,
    emoji: def.emoji || '🤖',
    rol: def.rol || 'asistente',
  }));
}

// ════════════════════════════════════════════════════════════════
// INVOCACIÓN — el corazón del orchestrator
// ════════════════════════════════════════════════════════════════

async function invocarAgente(nombre, { mensaje, historial = [], usuario_id = null, contexto_extra = null }) {
  const agente = obtenerAgente(nombre);
  const client = await getClient();
  const t0 = Date.now();

  // Construir mensajes: historial previo + nuevo turno
  const messages = [
    ...historial.map(h => ({
      role: h.role,
      content: typeof h.content === 'string' ? h.content : h.content,
    })),
    { role: 'user', content: contexto_extra
        ? `${mensaje}\n\n[CONTEXTO ADICIONAL]\n${contexto_extra}`
        : mensaje },
  ];

  let iteraciones = 0;
  const eventos = [];
  let usageTotal = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  while (iteraciones < MAX_ITERACIONES) {
    iteraciones++;

    // Construir system con cache_control para prompt caching
    const system = [
      {
        type: 'text',
        text: agente.systemPrompt,
        cache_control: { type: 'ephemeral' },  // estable, cachea prefix
      },
    ];

    const callParams = {
      model: agente.modelo,
      max_tokens: agente.maxTokens || MAX_TOKENS_DEFAULT,
      system,
      messages,
    };

    // Tools si el agente los tiene
    if (agente.tools && agente.tools.length > 0) {
      callParams.tools = agente.tools;
    }

    // Adaptive thinking solo en Opus 4.7
    if (agente.modelo === 'claude-opus-4-7' && agente.adaptiveThinking !== false) {
      callParams.thinking = { type: 'adaptive', display: 'summarized' };
    }

    const response = await client.messages.create(callParams);

    // Acumular usage
    usageTotal.input_tokens += response.usage.input_tokens || 0;
    usageTotal.output_tokens += response.usage.output_tokens || 0;
    usageTotal.cache_creation_input_tokens += response.usage.cache_creation_input_tokens || 0;
    usageTotal.cache_read_input_tokens += response.usage.cache_read_input_tokens || 0;

    // Append assistant response
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const texto = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n')
        .trim();

      const costoUsd = calcularCosto(agente.modelo, usageTotal);
      const duracionMs = Date.now() - t0;

      // Persistir invocación para auditoría
      await persistirInvocacion(nombre, {
        usuario_id, mensaje, respuesta: texto,
        iteraciones, usageTotal, costoUsd, duracionMs,
      });

      return {
        respuesta: texto,
        historial: messages,
        usage: usageTotal,
        costo_usd: costoUsd,
        duracion_ms: duracionMs,
        iteraciones,
        eventos,
        agente: nombre,
        modelo: agente.modelo,
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const tool of toolUses) {
        eventos.push({ tipo: 'tool_use', tool: tool.name, input: tool.input });
        try {
          const resultado = await agente.ejecutarTool(tool.name, tool.input, { usuario_id });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify(resultado).slice(0, 30000),
          });
        } catch (e) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: JSON.stringify({ error: e.message }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'refusal') {
      return {
        respuesta: 'No puedo responder esa pregunta. Reformúlala relacionada a la operación de Andreu Logistics.',
        historial: messages,
        usage: usageTotal,
        agente: nombre,
        modelo: agente.modelo,
      };
    }

    // max_tokens, pause_turn u otro: salir con lo que haya
    const texto = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return {
      respuesta: texto || '⚠️ Respuesta incompleta (stop_reason=' + response.stop_reason + ')',
      historial: messages,
      usage: usageTotal,
      costo_usd: calcularCosto(agente.modelo, usageTotal),
      duracion_ms: Date.now() - t0,
      iteraciones,
      eventos,
      agente: nombre,
      modelo: agente.modelo,
      stop_reason: response.stop_reason,
    };
  }

  throw new Error(`Agente ${nombre}: alcanzó ${MAX_ITERACIONES} iteraciones sin terminar`);
}

function calcularCosto(modelo, usage) {
  const p = PRECIOS[modelo] || PRECIOS['claude-sonnet-4-6'];
  const inputCost = (usage.input_tokens || 0) * (p.in / 1_000_000);
  const outputCost = (usage.output_tokens || 0) * (p.out / 1_000_000);
  const cacheReadCost = (usage.cache_read_input_tokens || 0) * (p.in * 0.1 / 1_000_000);
  const cacheCreateCost = (usage.cache_creation_input_tokens || 0) * (p.in * 1.25 / 1_000_000);
  return inputCost + outputCost + cacheReadCost + cacheCreateCost;
}

async function persistirInvocacion(nombre_agente, datos) {
  try {
    await db.query(`
      INSERT INTO agentes_invocaciones
        (nombre_agente, usuario_id, mensaje, respuesta, iteraciones,
         tokens_in, tokens_out, cache_read, cache_creation, costo_usd, duracion_ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      nombre_agente, datos.usuario_id, datos.mensaje?.slice(0, 5000),
      datos.respuesta?.slice(0, 10000), datos.iteraciones,
      datos.usageTotal.input_tokens || 0,
      datos.usageTotal.output_tokens || 0,
      datos.usageTotal.cache_read_input_tokens || 0,
      datos.usageTotal.cache_creation_input_tokens || 0,
      datos.costoUsd, datos.duracionMs,
    ]);
  } catch (e) {
    console.warn(`[orchestrator] persistir invocación ${nombre_agente}:`, e.message);
  }
}

module.exports = {
  registrarAgente,
  obtenerAgente,
  listarAgentes,
  invocarAgente,
  AGENTES,
};
