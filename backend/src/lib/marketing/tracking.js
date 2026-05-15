// ════════════════════════════════════════════════════════════════
// MARKETING TRACKING — captura UTMs + visitas anónimas
// ════════════════════════════════════════════════════════════════

const db = require('../../db');

/**
 * Registra una visita anónima al cotizador.
 */
async function registrarVisita({ sessionId, ip, userAgent, evento = 'view', utms = {}, referrer = null, landingPath = '/cotizar' }) {
  try {
    const { rows: [v] } = await db.query(`
      INSERT INTO marketing_visitas
        (session_id, ip, user_agent, evento,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         referrer, landing_path)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id
    `, [
      sessionId, ip, (userAgent || '').slice(0, 500), evento,
      utms.utm_source || null, utms.utm_medium || null, utms.utm_campaign || null,
      utms.utm_content || null, utms.utm_term || null,
      referrer, landingPath,
    ]);
    return v.id;
  } catch (e) {
    console.warn('tracking visita:', e.message);
    return null;
  }
}

/**
 * Marca una visita como convertida (cuando submit cotizar)
 */
async function marcarConvertida(sessionId, leadId) {
  if (!sessionId || !leadId) return;
  try {
    await db.query(`
      UPDATE marketing_visitas
      SET convertido = true, lead_id = $1
      WHERE session_id = $2
        AND created_at >= NOW() - INTERVAL '24 hours'
    `, [leadId, sessionId]);
  } catch (e) {
    console.warn('tracking convertida:', e.message);
  }
}

module.exports = { registrarVisita, marcarConvertida };
