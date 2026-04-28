const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Enviar notificación WhatsApp via Twilio
const enviarWhatsApp = async (para, mensaje) => {
  if (!process.env.TWILIO_SID || !process.env.TWILIO_TOKEN) {
    console.log('WhatsApp no configurado — mensaje:', mensaje);
    return { ok: false, razon: 'No configurado' };
  }
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM}`,
          To: `whatsapp:${para}`,
          Body: mensaje
        })
      }
    );
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// Enviar reporte diario manualmente
router.post('/reporte-dia', auth(['director','admin']), async (req, res) => {
  const { telefono } = req.body;
  const hoy = new Date().toISOString().split('T')[0];

  const [ventas, gastos, viajes] = await Promise.all([
    db.query('SELECT producto, SUM(monto) as total FROM ventas WHERE fecha=$1 GROUP BY producto', [hoy]),
    db.query('SELECT categoria, SUM(monto) as total FROM gastos WHERE fecha=$1 AND estado_aprobacion!=\'rechazado\' GROUP BY categoria', [hoy]),
    db.query('SELECT COUNT(*) as completados FROM viajes WHERE fecha=$1 AND estado=\'Completado\'', [hoy])
  ]);

  const fmt = n => '$' + Math.round(n||0).toLocaleString('es-MX');
  const totalV = ventas.rows.reduce((a,v) => a + parseFloat(v.total), 0);
  const totalG = gastos.rows.reduce((a,g) => a + parseFloat(g.total), 0);
  const fmtDate = d => { const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

  let msg = `📊 *REPORTE DIARIO — GRUPO ANDREU*\n`;
  msg += `Fecha: ${fmtDate(hoy)}\n`;
  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += `💵 *VENTAS: ${fmt(totalV)}*\n`;
  ventas.rows.forEach(v => { msg += `  · ${v.producto}: ${fmt(v.total)}\n`; });
  msg += `\n📋 *EGRESOS: ${fmt(totalG)}*\n`;
  gastos.rows.forEach(g => { msg += `  · ${g.categoria}: ${fmt(g.total)}\n`; });
  msg += `\n🚛 *FLOTA: ${viajes.rows[0]?.completados || 0} viaje(s)*\n`;
  msg += `\n✅ *RESULTADO: ${fmt(totalV - totalG)}*\n`;
  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += `_Sistema ERP Grupo Andreu_`;

  const result = await enviarWhatsApp(telefono || process.env.DIRECTOR_WHATSAPP, msg);
  res.json({ ok: result.ok, mensaje: msg });
});

// Alerta de gasto sin comprobante
router.post('/alerta-gasto', auth(['director','admin']), async (req, res) => {
  const { gasto_id } = req.body;
  const { rows } = await db.query(
    'SELECT g.*, u.nombre as registrado_nombre FROM gastos g LEFT JOIN usuarios u ON g.registrado_por=u.id WHERE g.id=$1',
    [gasto_id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Gasto no encontrado' });
  const g = rows[0];
  const msg = `⚠️ *ALERTA — Gasto sin comprobante*\n\nCategoría: ${g.categoria}\nMonto: $${Math.round(g.monto).toLocaleString('es-MX')}\nRegistrado por: ${g.registrado_nombre}\nDescripción: ${g.descripcion || 'Sin descripción'}\n\nSolicitar comprobante urgente.`;
  const result = await enviarWhatsApp(process.env.DIRECTOR_WHATSAPP, msg);
  res.json({ ok: result.ok });
});

// Configuración de notificaciones
router.get('/config', auth(['director','admin']), async (req, res) => {
  res.json({
    configurado: !!(process.env.TWILIO_SID && process.env.TWILIO_TOKEN),
    director_whatsapp: process.env.DIRECTOR_WHATSAPP ? '****' + process.env.DIRECTOR_WHATSAPP.slice(-4) : null
  });
});

module.exports = router;
module.exports.enviarWhatsApp = enviarWhatsApp;
