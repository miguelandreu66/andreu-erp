// ════════════════════════════════════════════════════════════════
// CANAL WHATSAPP — Twilio API (sin SDK, fetch directo)
// ════════════════════════════════════════════════════════════════
// Twilio cobra ~$0.005 por mensaje WhatsApp + costos por conversación.
// Para desarrollo: usar sandbox (gratis) en https://www.twilio.com/console/sms/whatsapp/sandbox
// Para producción: número WhatsApp Business aprobado.
// ════════════════════════════════════════════════════════════════

const apiKeys = require('../commandAi/apiKeysStore');
const db = require('../../db');

async function _credentials() {
  const [sid, token, from] = await Promise.all([
    apiKeys.leer('twilio_account_sid'),
    apiKeys.leer('twilio_auth_token'),
    apiKeys.leer('twilio_whatsapp_from'),
  ]);
  if (!sid || !token || !from) {
    throw new Error('Twilio no configurado. Falta account_sid, auth_token o whatsapp_from en Configuración → API Keys.');
  }
  return { sid, token, from };
}

async function isAvailable() {
  try {
    const [sid, token, from] = await Promise.all([
      apiKeys.leer('twilio_account_sid'),
      apiKeys.leer('twilio_auth_token'),
      apiKeys.leer('twilio_whatsapp_from'),
    ]);
    return !!(sid && token && from);
  } catch { return false; }
}

// Normaliza un número mexicano a formato E.164 (+52...)
function normalizarTelefono(numero) {
  if (!numero) return null;
  let n = String(numero).replace(/[\s\-\(\)]/g, '');
  if (n.startsWith('whatsapp:')) return n;
  if (n.startsWith('+')) return n;
  // Formato local: 10 dígitos → +521 + número
  if (/^\d{10}$/.test(n)) return `+521${n}`;
  // Con código país: 52 + 10 dígitos
  if (/^52\d{10}$/.test(n)) return `+${n}`;
  // Con 1 de wh: 521 + 10 dígitos
  if (/^521\d{10}$/.test(n)) return `+${n}`;
  return null;
}

function aFormatoWhatsapp(numero) {
  const norm = normalizarTelefono(numero);
  if (!norm) return null;
  return norm.startsWith('whatsapp:') ? norm : `whatsapp:${norm}`;
}

// ════════════════════════════════════════════════════════════════
// Enviar mensaje WhatsApp via Twilio
// ════════════════════════════════════════════════════════════════
async function enviar({ to, body, mediaUrl }) {
  const { sid, token, from } = await _credentials();
  const dest = aFormatoWhatsapp(to);
  if (!dest) throw new Error(`Número inválido: ${to}`);

  const params = new URLSearchParams({
    To: dest,
    From: from,
    Body: body,
  });
  if (mediaUrl) {
    if (Array.isArray(mediaUrl)) {
      mediaUrl.forEach(u => params.append('MediaUrl', u));
    } else {
      params.append('MediaUrl', mediaUrl);
    }
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await r.json();
  if (!r.ok) {
    throw new Error(`Twilio ${r.status}: ${data.message || JSON.stringify(data)}`);
  }
  return {
    id_externo: data.sid,
    estado: data.status,
    fecha: data.date_created,
  };
}

// ════════════════════════════════════════════════════════════════
// Procesar webhook entrante de Twilio
// (cliente respondió en WhatsApp)
// ════════════════════════════════════════════════════════════════
async function procesarMensajeEntrante(payload) {
  // Log inmediato
  try {
    await db.query(`
      INSERT INTO canales_webhooks_log (proveedor, evento, payload)
      VALUES ('twilio', 'incoming_whatsapp', $1)
    `, [payload]);
  } catch (_) {}

  const from = payload.From; // formato: whatsapp:+5217771234567
  const body = payload.Body || '';
  const messageSid = payload.MessageSid;

  if (!from || !body) return { ok: false, motivo: 'payload incompleto' };

  // Buscar conversación activa por este número
  const numeroLimpio = from.replace('whatsapp:', '');
  const { rows: [conv] } = await db.query(`
    SELECT c.*, l.folio AS lead_folio
    FROM lead_conversaciones c
    JOIN leads l ON l.id = c.lead_id
    WHERE c.canal = 'whatsapp'
      AND (c.identificador = $1 OR c.identificador = $2 OR c.identificador = $3)
      AND c.estado IN ('activa', 'pausada')
    ORDER BY c.created_at DESC LIMIT 1
  `, [numeroLimpio, from, numeroLimpio.replace('+', '')]).catch(() => ({ rows: [] }));

  if (!conv) {
    // Nadie en sistema con este número — guarda para review manual
    return { ok: true, motivo: 'sin_conversacion', from, body };
  }

  // Insertar mensaje entrante
  const { rows: [msg] } = await db.query(`
    INSERT INTO lead_mensajes
      (conversacion_id, direccion, remitente, contenido, contenido_tipo, id_externo, estado_envio)
    VALUES ($1, 'entrante', 'cliente', $2, 'texto', $3, 'recibido')
    RETURNING id
  `, [conv.id, body, messageSid]);

  // Marcar conversación: cliente respondió
  await db.query(`
    UPDATE lead_conversaciones
    SET cliente_respondio = true,
        total_mensajes = total_mensajes + 1,
        ultimo_mensaje_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
  `, [conv.id]);

  return { ok: true, conversacion_id: conv.id, mensaje_id: msg.id, lead_id: conv.lead_id };
}

module.exports = {
  isAvailable,
  enviar,
  procesarMensajeEntrante,
  normalizarTelefono,
  aFormatoWhatsapp,
};
