// ════════════════════════════════════════════════════════════════
// ATRACCIÓN AUTÓNOMA — Generador de contenido marketing con Claude
// ════════════════════════════════════════════════════════════════
// Cada lunes 10 AM (semanal):
//   - Genera 1 post de LinkedIn profesional sobre transporte
//   - Cada 2 semanas: 1 blog post SEO
//   - Cada mes: boletín email con tendencias
//
// El contenido se inserta como "borrador" y el director aprueba/publica.
// Si auto_publicar = true, se marca como aprobado automáticamente.
// ════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('../../db');
const apiKeys = require('./apiKeysStore');

const PRECIO_INPUT  = 3.00 / 1_000_000;   // Sonnet 4.6
const PRECIO_OUTPUT = 15.00 / 1_000_000;

async function getClient() {
  const k = await apiKeys.leer('anthropic_api_key');
  if (!k) throw new Error('Anthropic API Key no configurada');
  return new Anthropic({ apiKey: k, maxRetries: 3 });
}

async function leerConfig() {
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave LIKE 'atraccion_%'
  `);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

async function obtenerContextoEmpresa() {
  // Datos reales recientes para que Claude tenga material
  const [stats, rutas, op] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '30 days')::int AS viajes_mes,
        COUNT(DISTINCT cliente_id) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '90 days')::int AS clientes_activos,
        COALESCE(SUM(monto_cobrado_cliente) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '30 days'), 0)::float AS ingresos_mes
      FROM viajes
    `).catch(() => ({ rows: [{}] })),
    db.query(`
      SELECT origen || ' → ' || destino AS ruta, COUNT(*)::int AS viajes
      FROM viajes
      WHERE fecha >= CURRENT_DATE - INTERVAL '90 days'
        AND origen IS NOT NULL AND destino IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5
    `).catch(() => ({ rows: [] })),
    db.query(`
      SELECT clave, valor FROM configuracion_empresa
      WHERE clave IN ('andreu_capacidades_carga','andreu_capacidades_zonas')
    `).catch(() => ({ rows: [] })),
  ]);
  const cfgs = Object.fromEntries(op.rows.map(r => [r.clave, r.valor]));
  return {
    viajes_ultimo_mes: stats.rows[0]?.viajes_mes || 0,
    clientes_activos: stats.rows[0]?.clientes_activos || 0,
    rutas_top: rutas.rows,
    capacidades_carga: cfgs.andreu_capacidades_carga,
    zonas: cfgs.andreu_capacidades_zonas,
  };
}

// ════════════════════════════════════════════════════════════════
// Prompts especializados por tipo de contenido
// ════════════════════════════════════════════════════════════════
function promptParaTipo(tipo, tema, contexto, tono) {
  const base = `Eres el equipo de marketing de Andreu Logistics, empresa B2B de transporte de carga pesada en Cuernavaca, Morelos (3 plataformas 48' + red broker de transportistas verificados).

CONTEXTO REAL DE LA EMPRESA:
- Movemos carga general, frágil y otros con flota propia
- Cuando no podemos (refrigerados, peligrosos) actuamos como BROKER conectando clientes con transportistas verificados
- Zonas: ${contexto.zonas || 'Morelos, CDMX, EdoMex, Guerrero, Puebla, Oaxaca'}
- ${contexto.viajes_ultimo_mes} viajes último mes · ${contexto.clientes_activos} clientes activos
- Cumplimos Carta Porte 3.0 del SAT desde 2024

TONO: ${tono}

`;

  const prompts = {
    linkedin_post: base + `Genera 1 POST DE LINKEDIN profesional (200-400 palabras) sobre el tema: "${tema}".

REGLAS:
- Empieza con un gancho fuerte (pregunta provocadora o dato impactante)
- Cuerpo con 3-4 puntos clave usando datos REALES de transporte mexicano
- Termina con una pregunta o CTA para invitar comentarios
- Usa emojis con moderación (3-5 máximo)
- Hashtags al final: 5-7 relevantes (#TransporteB2B #CartaPorte #LogísticaMéxico etc.)
- NO uses bullet points robóticos (•). Usa narrativa fluida.
- NO presumir, sino aportar valor

Devuelve JSON:
{
  "titulo": "string corto descriptivo (60 chars max, para uso interno)",
  "contenido": "el post completo listo para copiar a LinkedIn",
  "resumen_corto": "1 oración resumen para previews internos",
  "keywords": ["tag1","tag2","tag3","tag4","tag5"],
  "call_to_action": "frase del CTA al final del post"
}`,

    blog_post: base + `Genera 1 BLOG POST optimizado para SEO (800-1200 palabras) sobre: "${tema}".

REGLAS:
- Título atractivo con keyword principal al inicio
- Meta description de 140-155 chars
- Estructura clara con H2 cada 200-300 palabras
- Datos reales del sector transporte mexicano (cuando sea posible cita estadísticas)
- Casos prácticos o ejemplos concretos
- Termina con un CTA claro hacia /cotizar
- NO contenido genérico. Aporta valor real.

Devuelve JSON:
{
  "titulo": "título SEO con keyword principal (max 70 chars)",
  "contenido": "el blog post completo en Markdown",
  "resumen_corto": "meta description 140-155 chars",
  "keywords": ["keyword principal", "keyword secundaria 1", "keyword secundaria 2", "..."],
  "call_to_action": "CTA hacia /cotizar"
}`,

    caso_exito: base + `Genera 1 CASO DE ÉXITO ficticio pero realista (400-600 palabras) basado en operaciones de Andreu sobre: "${tema}".

REGLAS:
- Empieza con el reto del cliente
- Solución que Andreu aportó (datos concretos: km, toneladas, días, ahorro)
- Resultado cuantificado
- Quote del cliente (puedes inventar un nombre creíble + cargo)
- Tono profesional, datos verosímiles

Devuelve JSON:
{
  "titulo": "Caso de éxito: [nombre cliente] + [logro principal]",
  "contenido": "el caso completo",
  "resumen_corto": "1 oración con el logro principal cuantificado",
  "keywords": ["caso éxito","industria","servicio"],
  "call_to_action": "frase de cierre que invite a contactar"
}`,

    boletin_email: base + `Genera 1 BOLETÍN MENSUAL en formato email para clientes y prospectos sobre: "${tema}".

REGLAS:
- Asunto (subject) atractivo, max 60 chars, sin spam triggers
- Saludo cálido
- 3 secciones cortas:
  1. Tendencia del mes en transporte/logística (datos reales)
  2. Tip práctico para optimizar costos o cumplir SAT
  3. Caso real o anécdota interesante
- Cierre con CTA hacia cotizar o agendar llamada
- Tono cercano pero profesional

Devuelve JSON:
{
  "titulo": "subject line del email",
  "contenido": "cuerpo del email en texto plano (saltos de línea con \\n)",
  "resumen_corto": "preview text que aparece junto al subject",
  "keywords": ["newsletter","tendencias","tip"],
  "call_to_action": "CTA principal"
}`,
  };

  return prompts[tipo] || prompts.linkedin_post;
}

// ════════════════════════════════════════════════════════════════
// Generador principal
// ════════════════════════════════════════════════════════════════
async function generarContenido({ tipo, tema = null, usuarioId = null }) {
  const cfg = await leerConfig();
  const modelo = cfg.atraccion_ia_modelo || 'claude-sonnet-4-6';
  const tono = cfg.atraccion_ia_tono_marca || 'profesional pero cálido, mexicano';
  const temas = (cfg.atraccion_ia_temas || 'logística broker,Carta Porte 3.0,transporte B2B').split(',').map(s => s.trim());
  const temaUsar = tema || temas[Math.floor(Math.random() * temas.length)];

  const contexto = await obtenerContextoEmpresa();
  const prompt = promptParaTipo(tipo, temaUsar, contexto, tono);

  const client = await getClient();
  const t0 = Date.now();

  const resp = await client.messages.create({
    model: modelo,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const texto = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text).join('\n').trim();

  // Parsear JSON (puede venir envuelto en ```json)
  let parsed;
  try {
    const m = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = m ? m[1] : texto;
    parsed = JSON.parse(jsonStr.trim());
  } catch (e) {
    const start = texto.indexOf('{');
    const end = texto.lastIndexOf('}');
    if (start >= 0 && end > start) parsed = JSON.parse(texto.slice(start, end + 1));
    else throw new Error(`No se pudo parsear JSON: ${e.message}. Texto: ${texto.slice(0, 200)}`);
  }

  // Calcular costo
  const inT  = resp.usage?.input_tokens || 0;
  const outT = resp.usage?.output_tokens || 0;
  const costo = (inT * PRECIO_INPUT) + (outT * PRECIO_OUTPUT);

  // Insertar como borrador (o aprobado si auto_publicar)
  const autoPub = cfg.atraccion_ia_auto_publicar === 'true';
  const { rows: [c] } = await db.query(`
    INSERT INTO contenido_generado
      (tipo, titulo, contenido, resumen_corto, keywords, tema, call_to_action,
       modelo_usado, tokens_input, tokens_output, costo_usd, prompt_usado,
       estado, aprobado_por, aprobado_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [
    tipo, parsed.titulo, parsed.contenido, parsed.resumen_corto,
    parsed.keywords || [], temaUsar, parsed.call_to_action,
    modelo, inT, outT, costo, prompt.slice(0, 2000),
    autoPub ? 'aprobado' : 'borrador',
    autoPub ? usuarioId : null,
    autoPub ? new Date() : null,
  ]);

  return {
    ok: true,
    contenido_id: c.id,
    tipo,
    tema: temaUsar,
    titulo: parsed.titulo,
    duracion_ms: Date.now() - t0,
    tokens: { input: inT, output: outT },
    costo_usd: costo,
    estado: c.estado,
  };
}

// ════════════════════════════════════════════════════════════════
// Ciclo automático (cron)
// ════════════════════════════════════════════════════════════════
async function correrCicloSemanal() {
  const cfg = await leerConfig();
  if (cfg.atraccion_ia_activa !== 'true') {
    return { skipped: true, motivo: 'atraccion_ia_inactiva' };
  }
  if (!(await apiKeys.leer('anthropic_api_key'))) {
    return { skipped: true, motivo: 'sin_anthropic_api_key' };
  }

  const resultados = { linkedin: null, blog: null, boletin: null, errores: [] };

  // LinkedIn semanal (siempre)
  if (cfg.atraccion_ia_freq_linkedin === 'semanal' ||
      (cfg.atraccion_ia_freq_linkedin === 'quincenal' && new Date().getDate() <= 14) ||
      (cfg.atraccion_ia_freq_linkedin === 'mensual' && new Date().getDate() <= 7)) {
    try { resultados.linkedin = await generarContenido({ tipo: 'linkedin_post' }); }
    catch (e) { resultados.errores.push(`linkedin: ${e.message}`); }
  }

  // Blog quincenal (semanas 1 y 3 del mes)
  const semanaMes = Math.ceil(new Date().getDate() / 7);
  if (cfg.atraccion_ia_freq_blog === 'semanal' ||
      (cfg.atraccion_ia_freq_blog === 'quincenal' && [1, 3].includes(semanaMes)) ||
      (cfg.atraccion_ia_freq_blog === 'mensual' && semanaMes === 1)) {
    try { resultados.blog = await generarContenido({ tipo: 'blog_post' }); }
    catch (e) { resultados.errores.push(`blog: ${e.message}`); }
  }

  // Boletín mensual (primer lunes del mes)
  if (cfg.atraccion_ia_freq_boletin === 'mensual' && new Date().getDate() <= 7) {
    try { resultados.boletin = await generarContenido({ tipo: 'boletin_email' }); }
    catch (e) { resultados.errores.push(`boletin: ${e.message}`); }
  }

  return resultados;
}

module.exports = {
  generarContenido,
  correrCicloSemanal,
  leerConfig,
};
