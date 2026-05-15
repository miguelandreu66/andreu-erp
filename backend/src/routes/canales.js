// ════════════════════════════════════════════════════════════════
// WEBHOOKS de canales — Twilio (WhatsApp) + SendGrid (Email events)
// Endpoints PÚBLICOS (los llaman Twilio/SendGrid). Sin auth normal.
// Seguridad: validar firma o verificar IP/headers según proveedor.
// ════════════════════════════════════════════════════════════════

const router = require('express').Router();
const express = require('express');
const wa = require('../lib/canales/whatsapp');
const mail = require('../lib/canales/email');
const vendedor = require('../lib/commandAi/vendedorIA');

// Twilio manda form-encoded
router.use('/whatsapp', express.urlencoded({ extended: true }));

// ════════════════════════════════════════════════════════════════
// Webhook entrante de Twilio WhatsApp (cliente respondió)
// ════════════════════════════════════════════════════════════════
router.post('/whatsapp/incoming', async (req, res) => {
  try {
    const r = await wa.procesarMensajeEntrante(req.body);

    // Responder a Twilio inmediatamente (sin cuerpo TwiML para no autoresponder)
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');

    // Si se vinculó a una conversación, disparar respuesta IA en background
    if (r.ok && r.conversacion_id && r.lead_id) {
      // No await — async fire-and-forget
      vendedor.responderMensajeCliente({
        leadId: r.lead_id,
        conversacionId: r.conversacion_id,
        mensajeClienteId: r.mensaje_id,
      }).catch(e => console.error('vendedor IA respond err:', e.message));
    }
  } catch (e) {
    console.error('whatsapp webhook:', e.message);
    res.set('Content-Type', 'text/xml');
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// ════════════════════════════════════════════════════════════════
// Webhook de status de Twilio (entregado, leído, fallido)
// ════════════════════════════════════════════════════════════════
router.post('/whatsapp/status', async (req, res) => {
  try {
    const db = require('../db');
    const { MessageSid, MessageStatus } = req.body || {};
    if (MessageSid) {
      const estadoMap = {
        sent: 'enviado',
        delivered: 'entregado',
        read: 'leido',
        failed: 'fallido',
        undelivered: 'fallido',
      };
      const estado = estadoMap[MessageStatus];
      if (estado) {
        await db.query(`UPDATE lead_mensajes SET estado_envio = $1, procesado_at = NOW() WHERE id_externo = $2`, [estado, MessageSid]);
      }
    }
    res.sendStatus(204);
  } catch (e) {
    console.error('whatsapp status:', e.message);
    res.sendStatus(204);
  }
});

// ════════════════════════════════════════════════════════════════
// Webhook de SendGrid (eventos de email: open, click, bounce, etc.)
// ════════════════════════════════════════════════════════════════
router.post('/email/events', express.json({ limit: '5mb' }), async (req, res) => {
  try {
    await mail.procesarEventoEntrante(req.body);
    res.sendStatus(204);
  } catch (e) {
    console.error('email webhook:', e.message);
    res.sendStatus(204);
  }
});

module.exports = router;
