// ════════════════════════════════════════════════════════════════
// CANAL EMAIL — SendGrid API (Andreu Logistics)
// ════════════════════════════════════════════════════════════════
// Plan gratuito: 100 emails/día.
// Para producción: dominio verificado + DKIM/SPF configurado.
// ════════════════════════════════════════════════════════════════

const apiKeys = require('../commandAi/apiKeysStore');

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
  return {
    id_externo: r.headers.get('x-message-id') || `sg-${Date.now()}`,
    estado: 'enviado',
  };
}

module.exports = { isAvailable, enviar };
