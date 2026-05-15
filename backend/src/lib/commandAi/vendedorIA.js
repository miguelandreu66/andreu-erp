// ════════════════════════════════════════════════════════════════
// VENDEDOR IA 24/7 — Claude conversa con leads por WhatsApp/Email
// ════════════════════════════════════════════════════════════════
// Flujo:
//   1) Lead cotiza en /cotizar → procesarLeadNuevo()
//   2) Manda WhatsApp + email con cotización en <30s
//   3) Programa drip campaigns (d1, d3, d7, d14)
//   4) Si cliente responde → responderMensajeCliente() llama Claude
//   5) Claude puede ofrecer descuentos hasta el tope configurado
// ════════════════════════════════════════════════════════════════

const Anthropic = require('@anthropic-ai/sdk').default;
const db = require('../../db');
const apiKeys = require('./apiKeysStore');
const wa = require('../canales/whatsapp');
const mail = require('../canales/email');

const MODELO_DEFAULT = 'claude-sonnet-4-6';
const MAX_TOKENS = 1500;

async function getClient() {
  const k = await apiKeys.leer('anthropic_api_key');
  if (!k) throw new Error('Anthropic API Key no configurada');
  return new Anthropic({ apiKey: k, maxRetries: 3 });
}

async function leerConfig() {
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave LIKE 'vendedor_ia_%'
  `);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

function dentroDeHorario(cfg) {
  const ahora = new Date();
  // Convertir a hora MX (UTC-6)
  const hMx = (ahora.getUTCHours() - 6 + 24) % 24;
  const m = ahora.getUTCMinutes();
  const minutosAhora = hMx * 60 + m;
  const [hi, mi] = (cfg.vendedor_ia_horario_inicio || '08:00').split(':').map(Number);
  const [hf, mf] = (cfg.vendedor_ia_horario_fin    || '21:00').split(':').map(Number);
  const minIni = hi * 60 + mi;
  const minFin = hf * 60 + mf;
  return minutosAhora >= minIni && minutosAhora <= minFin;
}

// ════════════════════════════════════════════════════════════════
// PASO 1 — Lead nuevo entra: enviar cotización en <30s
// ════════════════════════════════════════════════════════════════
async function procesarLeadNuevo(leadId) {
  const cfg = await leerConfig();
  if (cfg.vendedor_ia_activo !== 'true') {
    return { ok: false, motivo: 'vendedor_ia_inactivo' };
  }

  const { rows: [lead] } = await db.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  if (!lead) return { ok: false, motivo: 'lead_no_encontrado' };

  const baseUrl = process.env.BACKEND_URL || 'https://andreu-erp-production.up.railway.app';
  const pdfUrl  = `${baseUrl}/api/leads/pdf/${lead.folio}`;

  const canales = (cfg.vendedor_ia_canales_default || 'whatsapp,email').split(',').map(s => s.trim());

  const resultados = { whatsapp: null, email: null };

  // ── WhatsApp ──
  if (canales.includes('whatsapp') && lead.telefono) {
    const tel = wa.normalizarTelefono(lead.telefono);
    if (tel && await wa.isAvailable()) {
      try {
        const conv = await crearConversacion(lead.id, 'whatsapp', tel);
        const mensajeWa = construirMensajeWhatsappInicial(lead, pdfUrl);
        const r = await wa.enviar({ to: tel, body: mensajeWa });
        await registrarMensajeSaliente(conv.id, mensajeWa, r);
        resultados.whatsapp = { ok: true, conv_id: conv.id, msg_id: r.id_externo };
      } catch (e) {
        resultados.whatsapp = { ok: false, error: e.message };
      }
    } else {
      resultados.whatsapp = { ok: false, motivo: tel ? 'twilio_no_disponible' : 'telefono_invalido' };
    }
  }

  // ── Email ──
  if (canales.includes('email') && lead.email) {
    if (await mail.isAvailable()) {
      try {
        const conv = await crearConversacion(lead.id, 'email', lead.email);
        const html = mail.plantillaCotizacionHtml({
          contacto_nombre: lead.contacto_nombre,
          folio: lead.folio,
          origen: lead.origen,
          destino: lead.destino,
          tipo_carga: lead.tipo_carga,
          precio_final: lead.precio_final,
          pdf_url: pdfUrl,
        });
        const subject = `🚚 Tu cotización Andreu Logistics — Folio ${lead.folio}`;
        const r = await mail.enviar({
          to: lead.email,
          subject,
          html,
          text: `Hola ${lead.contacto_nombre}, tu cotización ${lead.folio} para ${lead.origen} → ${lead.destino} está lista por $${Math.round(parseFloat(lead.precio_final)).toLocaleString('es-MX')}. Descarga el PDF: ${pdfUrl}`,
        });
        await registrarMensajeSaliente(conv.id, subject + '\n\n[HTML enviado]', r);
        resultados.email = { ok: true, conv_id: conv.id };
      } catch (e) {
        resultados.email = { ok: false, error: e.message };
      }
    } else {
      resultados.email = { ok: false, motivo: 'sendgrid_no_disponible' };
    }
  }

  // ── Programar drip campaigns ──
  await programarDripCampaigns(lead.id, cfg);

  return { ok: true, lead_id: lead.id, folio: lead.folio, resultados };
}

async function crearConversacion(leadId, canal, identificador) {
  const { rows: [conv] } = await db.query(`
    INSERT INTO lead_conversaciones (lead_id, canal, identificador, estado, ultimo_mensaje_at, total_mensajes)
    VALUES ($1, $2, $3, 'activa', NOW(), 0)
    ON CONFLICT DO NOTHING
    RETURNING *
  `, [leadId, canal, identificador]);
  if (conv) return conv;
  // Si conflict (no debería con NOT EXISTS, pero por si acaso)
  const { rows: [existente] } = await db.query(`
    SELECT * FROM lead_conversaciones
    WHERE lead_id = $1 AND canal = $2 AND identificador = $3
    ORDER BY id DESC LIMIT 1
  `, [leadId, canal, identificador]);
  return existente;
}

async function registrarMensajeSaliente(convId, contenido, resultadoEnvio) {
  const { rows: [m] } = await db.query(`
    INSERT INTO lead_mensajes
      (conversacion_id, direccion, remitente, contenido, contenido_tipo, id_externo, estado_envio)
    VALUES ($1, 'saliente', 'ia', $2, 'texto', $3, $4)
    RETURNING *
  `, [convId, contenido, resultadoEnvio.id_externo || null, resultadoEnvio.estado || 'enviado']);
  await db.query(`
    UPDATE lead_conversaciones
    SET total_mensajes = total_mensajes + 1, ultimo_mensaje_at = NOW(), updated_at = NOW()
    WHERE id = $1
  `, [convId]);
  return m;
}

function construirMensajeWhatsappInicial(lead, pdfUrl) {
  const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
  return `¡Hola ${lead.contacto_nombre}! 👋

Soy de *Andreu Logistics*. Tu cotización ya está lista:

📦 *Folio:* ${lead.folio}
🛣️ *Ruta:* ${lead.origen} → ${lead.destino}
${lead.tipo_carga ? `📋 *Carga:* ${lead.tipo_carga}\n` : ''}💰 *Total con IVA:* ${fmt$(lead.precio_final)}

📄 PDF: ${pdfUrl}

¿Tienes dudas o quieres ajustar algo? Solo responde este mensaje. Te contesto en minutos. 🚚`;
}

// ════════════════════════════════════════════════════════════════
// PASO 2 — Drip campaigns programadas
// ════════════════════════════════════════════════════════════════
async function programarDripCampaigns(leadId, cfg) {
  const ahora = new Date();
  const programados = [];

  const stages = [
    { etapa: 'seguimiento_d1',  delay_h: 24,  flag: 'vendedor_ia_drip_d1' },
    { etapa: 'seguimiento_d3',  delay_h: 72,  flag: 'vendedor_ia_drip_d3' },
    { etapa: 'seguimiento_d7',  delay_h: 168, flag: 'vendedor_ia_drip_d7' },
    { etapa: 'seguimiento_d14', delay_h: 336, flag: 'vendedor_ia_drip_d14' },
  ];

  for (const s of stages) {
    if (cfg[s.flag] !== 'true') continue;
    const fechaProg = new Date(ahora.getTime() + s.delay_h * 3600_000);
    // En cada drip, primero WhatsApp; email solo si d7 y d14
    const canales = ['seguimiento_d7','seguimiento_d14'].includes(s.etapa) ? ['whatsapp','email'] : ['whatsapp'];
    for (const canal of canales) {
      const { rows: [d] } = await db.query(`
        INSERT INTO lead_drip_envios (lead_id, etapa, canal, fecha_programada, estado)
        VALUES ($1, $2, $3, $4, 'programado') RETURNING id
      `, [leadId, s.etapa, canal, fechaProg]);
      programados.push(d.id);
    }
  }
  return programados;
}

async function procesarDripPendientes() {
  // Levanta los drips programados con fecha pasada
  const { rows: pendientes } = await db.query(`
    SELECT d.*, l.* FROM lead_drip_envios d
    JOIN leads l ON l.id = d.lead_id
    WHERE d.estado = 'programado'
      AND d.fecha_programada <= NOW()
      AND l.estado NOT IN ('ganado','perdido','spam')
    ORDER BY d.fecha_programada ASC
    LIMIT 50
  `);

  const cfg = await leerConfig();
  if (cfg.vendedor_ia_activo !== 'true') {
    return { skipped: true, motivo: 'vendedor_ia_inactivo' };
  }
  if (!dentroDeHorario(cfg)) {
    return { skipped: true, motivo: 'fuera_de_horario', pendientes: pendientes.length };
  }

  let enviados = 0, fallidos = 0, cancelados = 0;
  for (const d of pendientes) {
    try {
      // Verificar si cliente ya respondió — cancelar drip si sí
      const { rows: [conv] } = await db.query(`
        SELECT * FROM lead_conversaciones
        WHERE lead_id = $1 AND canal = $2
        ORDER BY id DESC LIMIT 1
      `, [d.lead_id, d.canal]);

      if (conv?.cliente_respondio) {
        await db.query(`
          UPDATE lead_drip_envios
          SET estado = 'cancelado', motivo_cancelado = 'cliente_respondio', procesado_at = NOW()
          WHERE id = $1
        `, [d.id]);
        cancelados++;
        continue;
      }

      // Generar mensaje según etapa
      const baseUrl = process.env.BACKEND_URL || 'https://andreu-erp-production.up.railway.app';
      const pdfUrl  = `${baseUrl}/api/leads/pdf/${d.folio}`;

      let mensaje;
      const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

      switch (d.etapa) {
        case 'seguimiento_d1':
          mensaje = `Hola ${d.contacto_nombre} 👋\n\n¿Pudiste revisar la cotización ${d.folio} de ${d.origen} → ${d.destino}?\n\nSi tienes dudas sobre tiempos, condiciones o precio, solo responde. Estoy aquí para ayudarte.`;
          break;
        case 'seguimiento_d3':
          mensaje = `${d.contacto_nombre}, te recuerdo tu cotización folio ${d.folio}.\n\nEl precio sigue vigente: ${fmt$(d.precio_final)}.\n\n¿Algo te detiene? Cuéntame y vemos cómo ayudarte.`;
          break;
        case 'seguimiento_d7': {
          const descMax = parseFloat(cfg.vendedor_ia_descuento_max_pct || 7);
          const desc = Math.min(5, descMax);
          const precioConDesc = parseFloat(d.precio_final) * (1 - desc / 100);
          mensaje = `${d.contacto_nombre}, ¿sigues con el servicio de ${d.origen} → ${d.destino}?\n\nQuiero ayudarte a cerrar: te ofrezco *${desc}% de descuento* sobre tu cotización.\n\n💰 Precio original: ${fmt$(d.precio_final)}\n🔥 Con descuento: ${fmt$(precioConDesc)}\n\n¿Le entramos esta semana?`;
          break;
        }
        case 'seguimiento_d14':
          mensaje = `${d.contacto_nombre}, última oportunidad antes de cerrar tu cotización ${d.folio}.\n\nSi sigue siendo de tu interés ${d.origen} → ${d.destino}, responde "SI" y te activo el servicio con condiciones preferenciales.\n\nSi no, no te molesto más. ¡Mucho éxito! 🙏`;
          break;
        default:
          mensaje = `Hola ${d.contacto_nombre}, te recuerdo tu cotización ${d.folio}. ¿Te puedo ayudar?`;
      }

      // Enviar
      let resultadoEnvio;
      if (d.canal === 'whatsapp') {
        const tel = wa.normalizarTelefono(d.telefono);
        if (!tel) throw new Error('Teléfono inválido');
        if (!await wa.isAvailable()) throw new Error('Twilio no disponible');
        resultadoEnvio = await wa.enviar({ to: tel, body: mensaje });
      } else if (d.canal === 'email') {
        if (!d.email) throw new Error('Email faltante');
        if (!await mail.isAvailable()) throw new Error('SendGrid no disponible');
        const html = `<p>${mensaje.replace(/\n/g, '<br>')}</p><p><a href="${pdfUrl}">📄 Descargar cotización</a></p>`;
        resultadoEnvio = await mail.enviar({
          to: d.email,
          subject: `Seguimiento Andreu Logistics — Folio ${d.folio}`,
          html,
          text: mensaje,
        });
      }

      // Registrar mensaje en conversación
      let convToUse = conv;
      if (!convToUse) {
        const ident = d.canal === 'whatsapp' ? wa.normalizarTelefono(d.telefono) : d.email;
        convToUse = await crearConversacion(d.lead_id, d.canal, ident);
      }
      const msg = await registrarMensajeSaliente(convToUse.id, mensaje, resultadoEnvio);

      await db.query(`
        UPDATE lead_drip_envios
        SET estado = 'enviado', mensaje_id = $1, procesado_at = NOW()
        WHERE id = $2
      `, [msg.id, d.id]);
      enviados++;
    } catch (e) {
      await db.query(`
        UPDATE lead_drip_envios
        SET estado = 'fallido', motivo_cancelado = $1, procesado_at = NOW()
        WHERE id = $2
      `, [e.message.slice(0, 300), d.id]);
      fallidos++;
    }
  }
  return { enviados, fallidos, cancelados, total_pendientes: pendientes.length };
}

// ════════════════════════════════════════════════════════════════
// PASO 3 — Cliente respondió: Claude le contesta
// ════════════════════════════════════════════════════════════════
const SYSTEM_VENDEDOR = `Eres el Vendedor IA de **Andreu Logistics**, empresa B2B de transporte de carga pesada con sede en Cuernavaca, Morelos. 3 plataformas 48' propias + red broker de transportistas verificados.

# Tu personalidad
- Eres mexicano, hablas natural y directo (NO formal acartonado)
- Eres confiable y resolutivo
- Cierras ventas, no solo informas
- Si el cliente está dudoso, le das razones concretas (puntualidad, seguridad, factura SAT con Carta Porte)

# Tu trabajo
Conversar con leads vía WhatsApp para CERRAR la venta. Cuando un cliente responde a una cotización, tú:

1. **Resuelves dudas sobre el servicio** usando los datos de la cotización (folio, ruta, precio, tipo de carga)
2. **Negocias razonablemente** dentro de tus límites de descuento
3. **Cierras la venta** o agendas siguiente paso (firma de contrato, pago anticipado, llamada)
4. **Escalas a humano** si:
   - Cliente quiere más descuento del que puedes ofrecer
   - Cliente tiene servicios fuera de tu capacidad (refrigerado/peligrosos sin transportista disponible)
   - Cliente pide cambios en la operación específica (cambio de fecha/hora/ruta importante)
   - Cliente está enojado o pide hablar con humano

# Datos que tienes
- Folio, ruta, precio, tipo de carga, distancia
- Tu descuento máximo permitido (te lo dicen en cada turno)
- Historial de la conversación

# Reglas estrictas
- NO inventes datos. Si no sabes algo, di "déjame consultarlo con el equipo, te contesto en una hora"
- NO ofrezcas descuentos arriba de tu límite (te lo dicen explícitamente)
- NO prometas tiempos o servicios sin confirmar
- Mantén respuestas CORTAS (máx 3 oraciones). Es WhatsApp, no email
- Usa formato WhatsApp: *negrita*, emojis con moderación
- Termina cada respuesta con una pregunta o llamado a acción cuando aplique

# Formato de salida
Devuelve un objeto JSON con esta estructura exacta:

{
  "respuesta": "texto que se envía al cliente por WhatsApp",
  "intencion_detectada": "duda_precio" | "duda_servicio" | "negociacion" | "aceptacion" | "rechazo" | "fuera_alcance" | "cambio_pedido" | "saludo",
  "descuento_ofrecido_pct": 0,
  "escalar_a_humano": false,
  "motivo_escalacion": null,
  "marcar_estado_lead": null,  // "negociando" | "ganado" | "perdido" | null
  "siguiente_paso": "string corto: qué viene"
}`;

async function responderMensajeCliente({ leadId, conversacionId, mensajeClienteId }) {
  const cfg = await leerConfig();
  if (cfg.vendedor_ia_activo !== 'true') return { ok: false, motivo: 'inactivo' };

  // Cargar contexto: lead + conversación + historial + descuento permitido
  const { rows: [lead] } = await db.query('SELECT * FROM leads WHERE id = $1', [leadId]);
  if (!lead) return { ok: false, motivo: 'lead_no_encontrado' };

  const { rows: [conv] } = await db.query('SELECT * FROM lead_conversaciones WHERE id = $1', [conversacionId]);
  if (!conv || conv.estado === 'intervenida_humano') return { ok: false, motivo: 'no_responder' };

  const { rows: historial } = await db.query(`
    SELECT direccion, remitente, contenido, created_at
    FROM lead_mensajes
    WHERE conversacion_id = $1
    ORDER BY id ASC
    LIMIT 30
  `, [conversacionId]);

  const descuentoMax = parseFloat(cfg.vendedor_ia_descuento_max_pct || 7);
  const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

  // Construir mensajes para Claude
  const claudeMessages = [];
  for (const m of historial) {
    claudeMessages.push({
      role: m.direccion === 'entrante' ? 'user' : 'assistant',
      content: m.contenido,
    });
  }

  // Contexto adicional como último user msg
  const ctxBlock = `[CONTEXTO INTERNO - no incluir en respuesta]
Lead: ${lead.contacto_nombre} de ${lead.empresa || 'particular'}
Folio: ${lead.folio}
Ruta: ${lead.origen} → ${lead.destino}
Tipo carga: ${lead.tipo_carga || 'general'}
Toneladas: ${lead.toneladas || 'sin especificar'}
Distancia: ${lead.distancia_km ? lead.distancia_km + ' km' : 'sin calcular'}
Precio cotización: ${fmt$(lead.precio_final)}
Tipo operación: ${lead.tipo_operacion} (propio = Andreu opera; broker = se conecta transportista externo)
Descuento que ya ofreció IA antes: ${parseFloat(conv.descuento_ofrecido_pct || 0)}%
Descuento MÁXIMO que puedes ofrecer en TOTAL: ${descuentoMax}%`;

  if (claudeMessages.length === 0 || claudeMessages[claudeMessages.length - 1].role === 'assistant') {
    claudeMessages.push({ role: 'user', content: ctxBlock });
  } else {
    claudeMessages[claudeMessages.length - 1].content =
      claudeMessages[claudeMessages.length - 1].content + '\n\n' + ctxBlock;
  }

  const client = await getClient();
  const modelo = cfg.vendedor_ia_modelo || MODELO_DEFAULT;

  const resp = await client.messages.create({
    model: modelo,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_VENDEDOR, cache_control: { type: 'ephemeral' } }],
    messages: claudeMessages,
  });

  const textoCompleto = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text).join('\n').trim();

  // Parsear JSON
  let parsed;
  try {
    const m = textoCompleto.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : textoCompleto);
  } catch (e) {
    // Si no parsea, usar texto crudo
    parsed = { respuesta: textoCompleto, intencion_detectada: 'duda_servicio', escalar_a_humano: false };
  }

  // Validar y aplicar
  const descOfrecido = parseFloat(parsed.descuento_ofrecido_pct || 0);
  const descAcumulado = Math.max(parseFloat(conv.descuento_ofrecido_pct || 0), descOfrecido);
  if (descAcumulado > descuentoMax) {
    parsed.escalar_a_humano = true;
    parsed.motivo_escalacion = `Cliente pide descuento >${descuentoMax}%`;
  }

  // Enviar respuesta al cliente
  let envioResultado = null;
  if (parsed.respuesta && !parsed.escalar_a_humano) {
    try {
      if (conv.canal === 'whatsapp') {
        envioResultado = await wa.enviar({ to: conv.identificador, body: parsed.respuesta });
      } else if (conv.canal === 'email') {
        envioResultado = await mail.enviar({
          to: conv.identificador,
          subject: `Re: ${lead.folio} — ${lead.origen} → ${lead.destino}`,
          html: `<p>${parsed.respuesta.replace(/\n/g, '<br>')}</p>`,
          text: parsed.respuesta,
        });
      }
      await registrarMensajeSaliente(conv.id, parsed.respuesta, envioResultado || { id_externo: null, estado: 'enviado' });
    } catch (e) {
      console.warn('vendedor IA envío:', e.message);
    }
  }

  // Si escala: marcar conversación
  if (parsed.escalar_a_humano) {
    await db.query(`
      UPDATE lead_conversaciones
      SET estado = 'intervenida_humano',
          notas_director = COALESCE(notas_director, '') || $1,
          updated_at = NOW()
      WHERE id = $2
    `, [`\n[${new Date().toISOString()}] Escalado IA: ${parsed.motivo_escalacion || 'sin motivo'}`, conv.id]);
  }

  // Si cambió descuento ofrecido
  if (descAcumulado > parseFloat(conv.descuento_ofrecido_pct || 0)) {
    await db.query(`UPDATE lead_conversaciones SET descuento_ofrecido_pct = $1 WHERE id = $2`, [descAcumulado, conv.id]);
  }

  // Si pidió cambiar estado lead
  if (parsed.marcar_estado_lead && ['negociando','ganado','perdido'].includes(parsed.marcar_estado_lead)) {
    await db.query(`UPDATE leads SET estado = $1, updated_at = NOW() WHERE id = $2`, [parsed.marcar_estado_lead, leadId]);
    if (parsed.marcar_estado_lead === 'ganado') {
      await db.query(`UPDATE lead_conversaciones SET estado = 'cerrada_ganada' WHERE id = $1`, [conv.id]);
    } else if (parsed.marcar_estado_lead === 'perdido') {
      await db.query(`UPDATE lead_conversaciones SET estado = 'cerrada_perdida' WHERE id = $1`, [conv.id]);
    }
  }

  return {
    ok: true,
    respuesta: parsed.respuesta,
    intencion: parsed.intencion_detectada,
    escalado: parsed.escalar_a_humano,
    descuento_ofrecido: descAcumulado,
    siguiente_paso: parsed.siguiente_paso,
    tokens: resp.usage,
  };
}

module.exports = {
  procesarLeadNuevo,
  responderMensajeCliente,
  procesarDripPendientes,
  leerConfig,
};
