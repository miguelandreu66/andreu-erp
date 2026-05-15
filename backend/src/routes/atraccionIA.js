const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const atraccion = require('../lib/commandAi/atraccionIA');
const tracking = require('../lib/marketing/tracking');

const ROLES_LECTURA = ['director','admin'];
const ROLES_ESCRITURA = ['director','admin'];

// ────────────────────────────────────────────────────────────────
// Tracking público (sin auth, viene del cotizador)
// ────────────────────────────────────────────────────────────────
router.post('/tracking/visita', async (req, res) => {
  const { session_id, evento, utms, referrer, landing_path } = req.body || {};
  try {
    const id = await tracking.registrarVisita({
      sessionId: session_id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      evento,
      utms: utms || {},
      referrer,
      landingPath: landing_path,
    });
    res.json({ ok: !!id, visita_id: id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────────
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows: funnelCanal } = await db.query(`SELECT * FROM marketing_funnel_canal LIMIT 20`);

    const { rows: [resumen] } = await db.query(`
      SELECT
        COUNT(*)::int                                                  AS visitas_30d,
        COUNT(DISTINCT session_id)::int                                AS sesiones_unicas_30d,
        COUNT(*) FILTER (WHERE evento = 'submit_cotizar')::int         AS submits_30d,
        COUNT(*) FILTER (WHERE convertido = true)::int                 AS conversiones_30d
      FROM marketing_visitas
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    `);

    const { rows: [contenidoStats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado = 'borrador')::int    AS borradores,
        COUNT(*) FILTER (WHERE estado = 'aprobado')::int    AS aprobados,
        COUNT(*) FILTER (WHERE estado = 'publicado')::int   AS publicados,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS generados_30d
      FROM contenido_generado
    `);

    const { rows: campanas } = await db.query(`
      SELECT * FROM marketing_campanas WHERE activa = true ORDER BY fecha_inicio DESC LIMIT 10
    `);

    const { rows: [cfgRow] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'atraccion_ia_activa'`);

    res.json({
      activa: cfgRow?.valor === 'true',
      resumen,
      funnel_canal: funnelCanal,
      contenido_stats: contenidoStats,
      campanas_activas: campanas,
    });
  } catch (e) {
    console.error('atraccion dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────
// Contenido generado
// ────────────────────────────────────────────────────────────────
router.get('/contenido', auth(ROLES_LECTURA), async (req, res) => {
  const { tipo, estado, limit = 50 } = req.query;
  const where = []; const params = [];
  if (tipo)   { params.push(tipo);   where.push(`tipo = $${params.length}`); }
  if (estado) { params.push(estado); where.push(`estado = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 50, 200));
  try {
    const { rows } = await db.query(`
      SELECT id, tipo, titulo, resumen_corto, keywords, tema, estado,
             vistas, clicks, leads_atribuidos, modelo_usado, costo_usd,
             aprobado_at, publicado_at, url_publicado, created_at
      FROM contenido_generado
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/contenido/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`SELECT * FROM contenido_generado WHERE id = $1`, [req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generar nuevo contenido manualmente
router.post('/contenido/generar', auth(ROLES_ESCRITURA), async (req, res) => {
  const { tipo, tema } = req.body || {};
  if (!['linkedin_post','blog_post','caso_exito','boletin_email','tweet','instagram_caption'].includes(tipo)) {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  try {
    const r = await atraccion.generarContenido({ tipo, tema, usuarioId: req.usuario.id });
    res.json(r);
  } catch (e) {
    console.error('generar contenido:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Aprobar contenido
router.put('/contenido/:id/aprobar', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`
      UPDATE contenido_generado
      SET estado = 'aprobado', aprobado_por = $1, aprobado_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND estado = 'borrador'
      RETURNING *
    `, [req.usuario.id, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrado o ya aprobado' });
    res.json({ ok: true, contenido: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar como publicado
router.put('/contenido/:id/publicar', auth(ROLES_ESCRITURA), async (req, res) => {
  const { url_publicado } = req.body || {};
  try {
    const { rows: [c] } = await db.query(`
      UPDATE contenido_generado
      SET estado = 'publicado', publicado_at = NOW(), url_publicado = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [url_publicado || null, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, contenido: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rechazar contenido
router.put('/contenido/:id/rechazar', auth(ROLES_ESCRITURA), async (req, res) => {
  const { motivo } = req.body || {};
  try {
    const { rows: [c] } = await db.query(`
      UPDATE contenido_generado
      SET estado = 'rechazado', motivo_rechazo = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [motivo || 'Sin motivo', req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, contenido: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Editar contenido (para ajustes antes de publicar)
router.put('/contenido/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const { titulo, contenido, resumen_corto, call_to_action } = req.body || {};
  try {
    const { rows: [c] } = await db.query(`
      UPDATE contenido_generado
      SET titulo = COALESCE($1, titulo),
          contenido = COALESCE($2, contenido),
          resumen_corto = COALESCE($3, resumen_corto),
          call_to_action = COALESCE($4, call_to_action),
          updated_at = NOW()
      WHERE id = $5 RETURNING *
    `, [titulo, contenido, resumen_corto, call_to_action, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true, contenido: c });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Correr ciclo manual
router.post('/correr-ciclo', auth(['director']), async (_req, res) => {
  try { res.json(await atraccion.correrCicloSemanal()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────
// Campañas (CRUD)
// ────────────────────────────────────────────────────────────────
router.get('/campanas', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM marketing_campanas ORDER BY activa DESC, fecha_inicio DESC LIMIT 50`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/campanas', auth(ROLES_ESCRITURA), async (req, res) => {
  const { nombre, canal, utm_source, utm_medium, utm_campaign, fecha_inicio, fecha_fin,
          presupuesto_mxn, meta_leads, meta_ingresos, notas } = req.body || {};
  if (!nombre || !canal) return res.status(400).json({ error: 'nombre y canal requeridos' });
  try {
    const { rows: [c] } = await db.query(`
      INSERT INTO marketing_campanas
        (nombre, canal, utm_source, utm_medium, utm_campaign, fecha_inicio, fecha_fin,
         presupuesto_mxn, meta_leads, meta_ingresos, notas, creada_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *
    `, [nombre, canal, utm_source, utm_medium, utm_campaign,
        fecha_inicio || new Date(), fecha_fin || null,
        parseFloat(presupuesto_mxn || 0), parseInt(meta_leads || 0),
        parseFloat(meta_ingresos || 0), notas, req.usuario.id]);
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/campanas/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const b = req.body || {};
  try {
    const { rows: [c] } = await db.query(`
      UPDATE marketing_campanas
      SET nombre = COALESCE($1, nombre),
          canal = COALESCE($2, canal),
          utm_source = $3, utm_medium = $4, utm_campaign = $5,
          fecha_fin = $6, presupuesto_mxn = COALESCE($7, presupuesto_mxn),
          gasto_real_mxn = COALESCE($8, gasto_real_mxn),
          meta_leads = COALESCE($9, meta_leads),
          meta_ingresos = COALESCE($10, meta_ingresos),
          activa = COALESCE($11, activa),
          notas = $12, updated_at = NOW()
      WHERE id = $13 RETURNING *
    `, [b.nombre, b.canal, b.utm_source, b.utm_medium, b.utm_campaign,
        b.fecha_fin, b.presupuesto_mxn, b.gasto_real_mxn, b.meta_leads,
        b.meta_ingresos, b.activa, b.notas, req.params.id]);
    if (!c) return res.status(404).json({ error: 'No encontrada' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/campanas/:id', auth(['director']), async (req, res) => {
  try {
    await db.query(`DELETE FROM marketing_campanas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ────────────────────────────────────────────────────────────────
// Configuración
// ────────────────────────────────────────────────────────────────
router.get('/configuracion', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'atraccion_%' ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion', auth(['director']), async (req, res) => {
  const body = req.body || {};
  try {
    let n = 0;
    for (const [k, v] of Object.entries(body)) {
      if (!k.startsWith('atraccion_')) continue;
      const valor = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      await db.query(`
        INSERT INTO configuracion_empresa (clave, valor, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
      `, [k, valor]);
      n++;
    }
    res.json({ ok: true, actualizados: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
