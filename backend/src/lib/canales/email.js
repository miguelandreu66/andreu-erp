// ════════════════════════════════════════════════════════════════
// CANAL EMAIL — SendGrid API (sin SDK, fetch directo)
// ════════════════════════════════════════════════════════════════
// Plan gratuito: 100 emails/día.
// Para producción: dominio verificado + DKIM/SPF configurado.
// ════════════════════════════════════════════════════════════════

const apiKeys = require('../commandAi/apiKeysStore');
const db = require('../../db');

async function _credentials() {
  const [apiKey, fromEmail, fromName] = await Promise.all([
    apiKeys.leer('sendgrid_api_key'),
    apiKeys.leer('sendgrid_from_email'),
    apiKeys.leer('sendgrid_from_name'),
  ]);
  if (!apiKey || !fromEmail) {
    throw new Error('SendGrid no configurado. Falta api_key o from_email en Configuración → API Keys.');
  }
  return { apiKey, fromEmail, fromName: fromName || 'Andreu Logistics' };
}

async function isAvailable() {
  try {
    const [k, e] = await Promise.all([
      apiKeys.leer('sendgrid_api_key'),
      apiKeys.leer('sendgrid_from_email'),
    ]);
    return !!(k && e);
  } catch { return false; }
}

function plantillaCotizacionHtml({ contacto_nombre, folio, origen, destino, tipo_carga, precio_final, pdf_url, mensaje_extra }) {
  const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1B3A6B 0%,#2c5390 100%);color:#fff;padding:32px 28px;">
            <h1 style="margin:0;font-size:26px;font-weight:800;">🚚 Andreu Logistics</h1>
            <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Transporte B2B de carga pesada</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px;">
            <p style="font-size:16px;margin:0 0 16px;">Hola <strong>${contacto_nombre}</strong>,</p>
            <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#374151;">
              Gracias por cotizar con nosotros. Aquí tienes los detalles de tu servicio:
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:0;margin-bottom:24px;">
              <tr>
                <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Folio</div>
                  <div style="font-size:18px;font-weight:700;color:#1B3A6B;margin-top:2px;">${folio}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Ruta</div>
                  <div style="font-size:15px;color:#1A1A1A;margin-top:2px;">${origen} → ${destino}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
                  <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Tipo de carga</div>
                  <div style="font-size:15px;color:#1A1A1A;margin-top:2px;">${tipo_carga || 'General'}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 20px;background:#fff8f0;">
                  <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Total con IVA</div>
                  <div style="font-size:32px;font-weight:800;color:#E87722;margin-top:4px;">${fmt$(precio_final)}</div>
                </td>
              </tr>
            </table>

            ${mensaje_extra ? `<p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 20px;background:#f0f9ff;padding:14px 16px;border-radius:8px;border-left:3px solid #1B3A6B;">${mensaje_extra}</p>` : ''}

            ${pdf_url ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr><td align="center">
                <a href="${pdf_url}" style="display:inline-block;background:#E87722;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:700;font-size:15px;">📄 Descargar cotización PDF</a>
              </td></tr>
            </table>` : ''}

            <p style="font-size:14px;line-height:1.6;color:#374151;margin:0 0 16px;">
              ¿Tienes dudas? <strong>Solo responde este email</strong> o escríbenos por WhatsApp. Un asesor te atiende en menos de 5 minutos.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:20px;">
              <tr><td style="font-size:12px;color:#6b7280;line-height:1.5;">
                <strong style="color:#1B3A6B;">Andreu Logistics</strong><br>
                Transporte B2B de carga pesada · Cuernavaca, Morelos<br>
                3 plataformas 48' propias + red de transportistas verificados
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════
// Enviar email via SendGrid
// ════════════════════════════════════════════════════════════════
async function enviar({ to, subject, html, text, replyTo }) {
  const { apiKey, fromEmail, fromName } = await _credentials();

  const payload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: fromName },
    subject,
    content: [],
  };
  if (text) payload.content.push({ type: 'text/plain', value: text });
  if (html) payload.content.push({ type: 'text/html', value: html });
  if (!payload.content.length) {
    payload.content.push({ type: 'text/plain', value: subject });
  }
  if (replyTo) payload.reply_to = { email: replyTo };

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    let detail = '';
    try { detail = await r.text(); } catch (_) {}
    throw new Error(`SendGrid ${r.status}: ${detail.slice(0, 300)}`);
  }
  // SendGrid devuelve 202 sin body; el header X-Message-Id es el tracking
  return {
    id_externo: r.headers.get('x-message-id') || `sg-${Date.now()}`,
    estado: 'enviado',
  };
}

// ════════════════════════════════════════════════════════════════
// Procesar webhook entrante (inbound parse) o event webhook
// ════════════════════════════════════════════════════════════════
async function procesarEventoEntrante(payload) {
  try {
    await db.query(`
      INSERT INTO canales_webhooks_log (proveedor, evento, payload)
      VALUES ('sendgrid', $1, $2)
    `, [Array.isArray(payload) ? payload[0]?.event || 'batch' : payload.event || 'unknown', payload]);
  } catch (_) {}

  // SendGrid Event Webhook manda array de eventos
  const eventos = Array.isArray(payload) ? payload : [payload];
  let actualizados = 0;
  for (const ev of eventos) {
    const sgMsgId = ev.sg_message_id || ev['smtp-id'] || ev.message_id;
    if (!sgMsgId) continue;
    // Actualiza estado del mensaje si lo tenemos
    const estadoMap = { delivered: 'entregado', open: 'leido', click: 'leido', bounce: 'fallido', dropped: 'fallido', deferred: 'pendiente' };
    const nuevoEstado = estadoMap[ev.event];
    if (!nuevoEstado) continue;
    try {
      await db.query(`
        UPDATE lead_mensajes SET estado_envio = $1, procesado_at = NOW()
        WHERE id_externo LIKE $2 || '%'
      `, [nuevoEstado, sgMsgId.split('.')[0]]);
      actualizados++;
    } catch (_) {}
  }
  return { ok: true, eventos: eventos.length, actualizados };
}

module.exports = {
  isAvailable,
  enviar,
  procesarEventoEntrante,
  plantillaCotizacionHtml,
};
