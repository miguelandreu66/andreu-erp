// Vendedor IA — admin (dashboard, conversaciones, intervención manual, config)
const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const vendedor = require('../lib/commandAi/vendedorIA');
const wa = require('../lib/canales/whatsapp');
const mail = require('../lib/canales/email');

const ROLES = ['director','admin','caja'];

// Dashboard / Funnel KPIs
router.get('/dashboard', auth(ROLES), async (_req, res) => {
  try {
    const { rows: [funnel] } = await db.query('SELECT * FROM vendedor_ia_funnel');

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'activa')::int                     AS conversaciones_activas,
        COUNT(*) FILTER (WHERE estado = 'intervenida_humano')::int          AS pendientes_humano,
        COUNT(*) FILTER (WHERE estado = 'cerrada_ganada')::int              AS cerradas_ganadas,
        COUNT(*) FILTER (WHERE cliente_respondio = true)::int               AS con_respuesta_cliente
      FROM lead_conversaciones
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const { rows: [drip] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'programado')::int  AS drip_pendientes,
        COUNT(*) FILTER (WHERE estado = 'enviado')::int     AS drip_enviados,
        COUNT(*) FILTER (WHERE estado = 'cancelado')::int   AS drip_cancelados
      FROM lead_drip_envios
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const [waOk, mailOk] = await Promise.all([wa.isAvailable(), mail.isAvailable()]);
    const cfg = await vendedor.leerConfig();

    res.json({
      funnel,
      stats,
      drip,
      activo: cfg.vendedor_ia_activo === 'true',
      canales: {
        whatsapp: waOk,
        email: mailOk,
      },
      config: cfg,
    });
  } catch (e) {
    console.error('vendedor dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Listar conversaciones
router.get('/conversaciones', auth(ROLES), async (req, res) => {
  const { estado, limit = 50 } = req.query;
  const where = [];
  const params = [];
  if (estado) { params.push(estado); where.push(`c.estado = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 50, 200));
  try {
    const { rows } = await db.query(`
      SELECT c.*, l.folio, l.contacto_nombre, l.empresa, l.email, l.telefono,
             l.origen, l.destino, l.precio_final, l.estado AS lead_estado,
             l.tipo_carga, l.tipo_operacion
      FROM lead_conversaciones c
      JOIN leads l ON l.id = c.lead_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.ultimo_mensaje_at DESC NULLS LAST, c.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Detalle de conversación con sus mensajes
router.get('/conversaciones/:id', auth(ROLES), async (req, res) => {
  try {
    const { rows: [conv] } = await db.query(`
      SELECT c.*, l.folio, l.contacto_nombre, l.empresa, l.email, l.telefono,
             l.origen, l.destino, l.precio_final, l.estado AS lead_estado,
             l.tipo_carga, l.tipo_operacion, l.created_at AS lead_created
      FROM lead_conversaciones c
      JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { rows: mensajes } = await db.query(`
      SELECT * FROM lead_mensajes
      WHERE conversacion_id = $1
      ORDER BY id ASC
    `, [req.params.id]);

    res.json({ conversacion: conv, mensajes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar mensaje manual (intervención humana)
router.post('/conversaciones/:id/mensaje', auth(['director','admin']), async (req, res) => {
  const { contenido } = req.body || {};
  if (!contenido?.trim()) return res.status(400).json({ error: 'contenido vacío' });
  try {
    const { rows: [conv] } = await db.query('SELECT * FROM lead_conversaciones WHERE id = $1', [req.params.id]);
    if (!conv) return res.status(404).json({ error: 'Conversación no encontrada' });

    let resultado;
    if (conv.canal === 'whatsapp') {
      resultado = await wa.enviar({ to: conv.identificador, body: contenido });
    } else if (conv.canal === 'email') {
      const { rows: [lead] } = await db.query('SELECT folio, origen, destino FROM leads WHERE id = $1', [conv.lead_id]);
      resultado = await mail.enviar({
        to: conv.identificador,
        subject: `Re: ${lead.folio} — ${lead.origen} → ${lead.destino}`,
        html: `<p>${contenido.replace(/\n/g, '<br>')}</p>`,
        text: contenido,
      });
    } else {
      return res.status(400).json({ error: `Canal no soportado: ${conv.canal}` });
    }

    const { rows: [msg] } = await db.query(`
      INSERT INTO lead_mensajes
        (conversacion_id, direccion, remitente, contenido, contenido_tipo, id_externo, estado_envio, enviado_por)
      VALUES ($1, 'saliente', 'humano', $2, 'texto', $3, $4, $5)
      RETURNING *
    `, [req.params.id, contenido, resultado.id_externo || null, resultado.estado || 'enviado', req.usuario.id]);

    await db.query(`
      UPDATE lead_conversaciones
      SET total_mensajes = total_mensajes + 1, ultimo_mensaje_at = NOW(),
          intervenido_por = $1, intervenido_at = NOW(), updated_at = NOW()
      WHERE id = $2
    `, [req.usuario.id, req.params.id]);

    res.json({ ok: true, mensaje: msg, resultado_envio: resultado });
  } catch (e) {
    console.error('mensaje manual:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Cambiar estado de conversación (pausar, intervenir, cerrar)
router.put('/conversaciones/:id/estado', auth(['director','admin']), async (req, res) => {
  const { estado, notas } = req.body || {};
  if (!['activa','pausada','intervenida_humano','cerrada_ganada','cerrada_perdida'].includes(estado)) {
    return res.status(400).json({ error: 'estado inválido' });
  }
  try {
    const { rows: [c] } = await db.query(`
      UPDATE lead_conversaciones
      SET estado = $1,
          notas_director = COALESCE($2, notas_director),
          intervenido_por = $3, intervenido_at = NOW(), updated_at = NOW()
      WHERE id = $4 RETURNING *
    `, [estado, notas || null, req.usuario.id, req.params.id]);
    if (!c) return res.status(404).json({ error: 'Conversación no encontrada' });
    res.json({ ok: true, conversacion: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reenviar cotización manualmente (a un lead específico)
router.post('/leads/:lead_id/reenviar', auth(['director','admin']), async (req, res) => {
  try {
    const r = await vendedor.procesarLeadNuevo(req.params.lead_id);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Disparar manualmente el procesador de drip pendientes
router.post('/drip/procesar', auth(['director']), async (_req, res) => {
  try {
    const r = await vendedor.procesarDripPendientes();
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configuración
router.get('/configuracion', auth(ROLES), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'vendedor_ia_%' ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion', auth(['director']), async (req, res) => {
  const body = req.body || {};
  const claves_validas = [
    'vendedor_ia_activo', 'vendedor_ia_horario_inicio', 'vendedor_ia_horario_fin',
    'vendedor_ia_descuento_max_pct', 'vendedor_ia_modelo', 'vendedor_ia_canales_default',
    'vendedor_ia_envio_inmediato',
    'vendedor_ia_drip_d1', 'vendedor_ia_drip_d3', 'vendedor_ia_drip_d7', 'vendedor_ia_drip_d14',
  ];
  try {
    let n = 0;
    for (const [k, v] of Object.entries(body)) {
      if (!claves_validas.includes(k)) continue;
      const valor = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      await db.query(`UPDATE configuracion_empresa SET valor = $1, updated_at = NOW() WHERE clave = $2`, [valor, k]);
      n++;
    }
    res.json({ ok: true, actualizados: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
