const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

const { evaluarReglas, persistirAlertas, UMBRALES } = require('../lib/commandAi/rules');
const { generarResumen }    = require('../lib/commandAi/supervisor');
const claudeSupervisor      = require('../lib/commandAi/claudeSupervisor');
const apiKeys               = require('../lib/commandAi/apiKeysStore');
const { calcularScoring, guardarSnapshot } = require('../lib/commandAi/scoring');
const { recomputarBaselines, listarBaselines, analisisForense } = require('../lib/commandAi/diesel');
const {
  cobranzaVencida, clientesEnRiesgo, cotizacionesPendientes,
  preciosPorRuta, briefingEjecutivo,
} = require('../lib/commandAi/comercial');
const cronJobs = require('../lib/cronJobs');

// Roles con acceso al módulo Command AI
const ROLES_LECTURA  = ['director','admin','logistica','monitoreo'];
const ROLES_ESCRITURA = ['director','admin','logistica'];
// Dashboard e insights comerciales: Auxiliar Administrativo (caja) también puede leer
const ROLES_DASHBOARD = ['director','admin','logistica','monitoreo','caja'];

// Helper: registrar acción en audit_log (no falla si no se puede)
async function auditar(usuario_id, accion, entidad, entidad_id, detalle, ip) {
  try {
    await db.query(`
      INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [usuario_id, accion, entidad, entidad_id, detalle || {}, ip]);
  } catch (e) {
    console.warn('audit_log skip:', e.message);
  }
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD — estado consolidado de la flota
// ══════════════════════════════════════════════════════════════════
router.get('/dashboard', auth(ROLES_DASHBOARD), async (_req, res) => {
  try {
    const { rows: posiciones } = await db.query(`
      SELECT
        u.id AS unidad_id, u.placas, u.descripcion, u.marca, u.modelo,
        op.id AS operador_id, op.nombre AS operador,
        ulp.lat, ulp.lng, ulp.velocidad_kmh, ulp.rumbo,
        ulp.minutos_desde_ultimo, ulp.registrado_en,
        ulp.viaje_id, v.destino, v.estado AS viaje_estado,
        CASE
          WHEN ulp.minutos_desde_ultimo IS NULL THEN 'sin_datos'
          WHEN ulp.minutos_desde_ultimo > 15    THEN 'sin_senal'
          WHEN ulp.velocidad_kmh > 90           THEN 'alerta'
          WHEN v.estado = 'En ruta'             THEN 'en_ruta'
          WHEN ulp.velocidad_kmh = 0            THEN 'detenido'
          ELSE 'activa'
        END AS estado_visual
      FROM unidades u
      LEFT JOIN unidades_ultima_posicion ulp ON ulp.unidad_id = u.id
      LEFT JOIN viajes    v  ON v.id  = ulp.viaje_id
      LEFT JOIN operadores op ON op.id = v.operador_id
      WHERE u.activo = true
      ORDER BY u.placas
    `);

    const { rows: [resumen] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM unidades WHERE activo = true)::int        AS unidades_activas,
        (SELECT COUNT(*) FROM viajes WHERE estado = 'En ruta')::int     AS viajes_en_ruta,
        (SELECT COUNT(*) FROM alertas WHERE estado = 'pendiente' AND nivel = 'critico')::int AS alertas_criticas,
        (SELECT COUNT(*) FROM alertas WHERE estado IN ('pendiente','atendida'))::int         AS alertas_totales,
        (SELECT COALESCE(SUM(diesel_costo), 0) FROM viajes
         WHERE fecha >= CURRENT_DATE - INTERVAL '7 days')::float        AS diesel_7d,
        (SELECT COALESCE(SUM(diesel_litros), 0) FROM viajes
         WHERE fecha >= CURRENT_DATE - INTERVAL '7 days')::float        AS litros_7d
    `);

    res.json({ posiciones, resumen });
  } catch (e) {
    console.error('command-ai/dashboard:', e.message);
    res.status(500).json({ error: 'Error al cargar dashboard' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GPS — ingesta y consulta
// ══════════════════════════════════════════════════════════════════

// POST /gps/ping — un solo ping (mobile o webhook GPS)
router.post('/gps/ping', auth(ROLES_ESCRITURA), async (req, res) => {
  const { unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, odometro_km, fuente } = req.body;
  if (!unidad_id || lat == null || lng == null) {
    return res.status(400).json({ error: 'unidad_id, lat y lng son obligatorios' });
  }
  try {
    const { rows: [row] } = await db.query(`
      INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, odometro_km, fuente)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, registrado_en
    `, [unidad_id, viaje_id || null, lat, lng, velocidad_kmh || 0, rumbo || null, odometro_km || null, fuente || 'mobile']);
    res.json({ ok: true, ...row });
  } catch (e) {
    console.error('gps/ping:', e.message);
    res.status(500).json({ error: 'Error al guardar ping' });
  }
});

// POST /gps/batch — ingesta masiva (provider webhook)
router.post('/gps/batch', auth(ROLES_ESCRITURA), async (req, res) => {
  const pings = req.body?.pings;
  if (!Array.isArray(pings) || pings.length === 0) {
    return res.status(400).json({ error: 'Se requiere array pings[]' });
  }
  try {
    const values = [];
    const params = [];
    pings.forEach((p, i) => {
      const base = i * 8;
      values.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8})`);
      params.push(
        p.unidad_id, p.viaje_id || null, p.lat, p.lng,
        p.velocidad_kmh || 0, p.rumbo || null, p.odometro_km || null, p.fuente || 'gps_provider'
      );
    });
    const { rowCount } = await db.query(`
      INSERT INTO gps_pings (unidad_id, viaje_id, lat, lng, velocidad_kmh, rumbo, odometro_km, fuente)
      VALUES ${values.join(',')}
    `, params);
    res.json({ ok: true, recibidos: rowCount });
  } catch (e) {
    console.error('gps/batch:', e.message);
    res.status(500).json({ error: 'Error en ingesta masiva' });
  }
});

// GET /gps/latest — última posición de cada unidad activa
router.get('/gps/latest', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        u.id AS unidad_id, u.placas, u.descripcion,
        ulp.lat, ulp.lng, ulp.velocidad_kmh, ulp.rumbo,
        ulp.minutos_desde_ultimo, ulp.registrado_en, ulp.fuente
      FROM unidades u
      LEFT JOIN unidades_ultima_posicion ulp ON ulp.unidad_id = u.id
      WHERE u.activo = true
      ORDER BY u.placas
    `);
    res.json(rows);
  } catch (e) {
    console.error('gps/latest:', e.message);
    res.status(500).json({ error: 'Error al consultar posiciones' });
  }
});

// GET /gps/unidad/:id — track de una unidad (default últimas 24h)
router.get('/gps/unidad/:id', auth(ROLES_LECTURA), async (req, res) => {
  const horas = parseInt(req.query.horas) || 24;
  const max   = Math.min(parseInt(req.query.max) || 500, 2000);
  try {
    const { rows } = await db.query(`
      SELECT id, lat, lng, velocidad_kmh, rumbo, registrado_en, viaje_id
      FROM gps_pings
      WHERE unidad_id = $1
        AND registrado_en >= NOW() - ($2::int || ' hours')::interval
      ORDER BY registrado_en ASC
      LIMIT $3
    `, [req.params.id, horas, max]);
    res.json(rows);
  } catch (e) {
    console.error('gps/unidad:', e.message);
    res.status(500).json({ error: 'Error al consultar trayecto' });
  }
});

// ══════════════════════════════════════════════════════════════════
// ALERTAS
// ══════════════════════════════════════════════════════════════════

// GET /alertas — lista con filtros
router.get('/alertas', auth(ROLES_LECTURA), async (req, res) => {
  const { estado, nivel, limit = 100 } = req.query;
  const where = [];
  const params = [];
  if (estado) { params.push(estado); where.push(`a.estado = $${params.length}`); }
  if (nivel)  { params.push(nivel);  where.push(`a.nivel  = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));
  try {
    const { rows } = await db.query(`
      SELECT
        a.*,
        u.placas, u.descripcion AS unidad_descripcion,
        op.nombre AS operador_nombre,
        ua.nombre AS atendida_por_nombre,
        ur.nombre AS resuelta_por_nombre
      FROM alertas a
      LEFT JOIN unidades   u  ON u.id  = a.unidad_id
      LEFT JOIN operadores op ON op.id = a.operador_id
      LEFT JOIN usuarios   ua ON ua.id = a.atendida_por
      LEFT JOIN usuarios   ur ON ur.id = a.resuelta_por
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE a.nivel WHEN 'critico' THEN 0 WHEN 'alto' THEN 1 WHEN 'medio' THEN 2 ELSE 3 END,
        a.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) {
    console.error('alertas list:', e.message);
    res.status(500).json({ error: 'Error al listar alertas' });
  }
});

// POST /alertas/evaluar — corre motor de reglas, persiste deduplicadas
router.post('/alertas/evaluar', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const candidatas = await evaluarReglas();
    const resultado  = await persistirAlertas(candidatas);
    await auditar(req.usuario?.id, 'alertas_evaluar', 'alertas', null,
      { umbrales: UMBRALES, ...resultado }, req.ip);
    res.json({ ok: true, ...resultado, umbrales: UMBRALES });
  } catch (e) {
    console.error('alertas evaluar:', e.message);
    res.status(500).json({ error: 'Error al evaluar reglas' });
  }
});

// PUT /alertas/:id/atender
router.put('/alertas/:id/atender', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const { rows: [row] } = await db.query(`
      UPDATE alertas
      SET estado = 'atendida', atendida_at = NOW(), atendida_por = $1
      WHERE id = $2 AND estado = 'pendiente'
      RETURNING *
    `, [req.usuario.id, req.params.id]);
    if (!row) return res.status(404).json({ error: 'Alerta no encontrada o no pendiente' });
    await auditar(req.usuario.id, 'alerta_atender', 'alertas', row.id, null, req.ip);
    res.json(row);
  } catch (e) {
    console.error('alerta atender:', e.message);
    res.status(500).json({ error: 'Error al atender alerta' });
  }
});

// PUT /alertas/:id/resolver
router.put('/alertas/:id/resolver', auth(ROLES_ESCRITURA), async (req, res) => {
  const { notas } = req.body || {};
  try {
    const { rows: [row] } = await db.query(`
      UPDATE alertas
      SET estado = 'resuelta', resuelta_at = NOW(), resuelta_por = $1, notas = $2
      WHERE id = $3 AND estado IN ('pendiente','atendida')
      RETURNING *
    `, [req.usuario.id, notas || null, req.params.id]);
    if (!row) return res.status(404).json({ error: 'Alerta no encontrada o ya resuelta' });
    await auditar(req.usuario.id, 'alerta_resolver', 'alertas', row.id, { notas }, req.ip);
    res.json(row);
  } catch (e) {
    console.error('alerta resolver:', e.message);
    res.status(500).json({ error: 'Error al resolver alerta' });
  }
});

// PUT /alertas/:id/descartar
router.put('/alertas/:id/descartar', auth(ROLES_ESCRITURA), async (req, res) => {
  const { notas } = req.body || {};
  try {
    const { rows: [row] } = await db.query(`
      UPDATE alertas
      SET estado = 'descartada', resuelta_at = NOW(), resuelta_por = $1, notas = $2
      WHERE id = $3 AND estado IN ('pendiente','atendida')
      RETURNING *
    `, [req.usuario.id, notas || null, req.params.id]);
    if (!row) return res.status(404).json({ error: 'Alerta no encontrada' });
    await auditar(req.usuario.id, 'alerta_descartar', 'alertas', row.id, { notas }, req.ip);
    res.json(row);
  } catch (e) {
    console.error('alerta descartar:', e.message);
    res.status(500).json({ error: 'Error al descartar alerta' });
  }
});

// ══════════════════════════════════════════════════════════════════
// SUPERVISOR IA
// ══════════════════════════════════════════════════════════════════
router.get('/supervisor', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const [resumen, llm_disponible] = await Promise.all([
      generarResumen(),
      claudeSupervisor.isAvailable(),
    ]);
    res.json({ ...resumen, llm_disponible });
  } catch (e) {
    console.error('supervisor:', e.message);
    res.status(500).json({ error: 'Error al generar resumen IA' });
  }
});

// Disponibilidad del Claude (¿está configurado?)
router.get('/supervisor/disponible', auth(ROLES_DASHBOARD), async (_req, res) => {
  res.json({
    llm_disponible: await claudeSupervisor.isAvailable(),
    modelo: claudeSupervisor.MODELO,
  });
});

// ── BYOK: gestión de API keys ────────────────────────────
// GET disponibilidad de todas las API keys (sin revelar valores)
router.get('/config/api-keys', auth(['director','admin']), async (_req, res) => {
  try {
    res.json(await apiKeys.disponibilidad());
  } catch (e) {
    console.error('api-keys disponibilidad:', e.message);
    res.status(500).json({ error: 'Error al consultar disponibilidad' });
  }
});

// POST guardar key (con validación previa contra el proveedor)
router.post('/config/api-keys/:clave', auth(['director']), async (req, res) => {
  const { clave } = req.params;
  const { valor } = req.body || {};

  if (!valor || typeof valor !== 'string') {
    return res.status(400).json({ error: 'Falta el campo "valor" con la API key' });
  }

  try {
    // Validación específica de Anthropic: probar la key contra la API
    if (clave === 'anthropic_api_key') {
      const prueba = await claudeSupervisor.probarApiKey(valor.trim());
      if (!prueba.ok) {
        return res.status(400).json({ error: `API key inválida: ${prueba.error}` });
      }
    }

    await apiKeys.guardar(clave, valor.trim(), req.usuario.id);
    res.json({ ok: true, mensaje: `${clave} guardada correctamente.` });
  } catch (e) {
    console.error('api-keys guardar:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// DELETE remover key
router.delete('/config/api-keys/:clave', auth(['director']), async (req, res) => {
  try {
    await apiKeys.eliminar(req.params.clave, req.usuario.id);
    res.json({ ok: true });
  } catch (e) {
    console.error('api-keys eliminar:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// Chat conversacional con Claude (requiere ANTHROPIC_API_KEY)
router.post('/supervisor/preguntar', auth(ROLES_LECTURA), async (req, res) => {
  const { mensaje, historial } = req.body || {};
  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return res.status(400).json({ error: 'mensaje (string) requerido' });
  }
  if (!claudeSupervisor.isAvailable()) {
    return res.status(503).json({
      error: 'Supervisor IA conversacional no disponible. Configura ANTHROPIC_API_KEY en Railway para activarlo.',
      llm_disponible: false,
    });
  }
  try {
    const r = await claudeSupervisor.preguntar({
      mensaje: mensaje.slice(0, 4000),
      historial: Array.isArray(historial) ? historial.slice(-20) : [], // safety: max 20 turnos de contexto
    });

    // Audit
    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
        VALUES ($1, 'supervisor_preguntar', 'claude', $2, $3)
      `, [req.usuario.id, {
        iteraciones: r.iteraciones,
        usage: r.usage,
        stop_reason: r.stop_reason,
        eventos: r.eventos,
      }, req.ip]);
    } catch (_) {}

    res.json(r);
  } catch (e) {
    console.error('supervisor preguntar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// SCORING
// ══════════════════════════════════════════════════════════════════
router.get('/scoring', auth(ROLES_LECTURA), async (req, res) => {
  const dias = Math.min(parseInt(req.query.dias) || 30, 365);
  try {
    const datos = await calcularScoring(dias);
    res.json({ dias, operadores: datos });
  } catch (e) {
    console.error('scoring:', e.message);
    res.status(500).json({ error: 'Error al calcular scoring' });
  }
});

router.post('/scoring/snapshot', auth(ROLES_ESCRITURA), async (req, res) => {
  const dias = Math.min(parseInt(req.body?.dias) || 30, 365);
  try {
    const r = await guardarSnapshot(dias);
    await auditar(req.usuario.id, 'scoring_snapshot', 'scoring_snapshots', null, r, req.ip);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('scoring snapshot:', e.message);
    res.status(500).json({ error: 'Error al guardar snapshot' });
  }
});

router.get('/scoring/historico/:operador_id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT periodo_inicio, periodo_fin, score, viajes_totales, rendimiento_lt_km, incidentes
      FROM scoring_snapshots
      WHERE operador_id = $1
      ORDER BY periodo_fin DESC
      LIMIT 24
    `, [req.params.operador_id]);
    res.json(rows);
  } catch (e) {
    console.error('scoring historico:', e.message);
    res.status(500).json({ error: 'Error al consultar histórico' });
  }
});

// ══════════════════════════════════════════════════════════════════
// DIESEL INTELIGENTE
// ══════════════════════════════════════════════════════════════════
router.get('/diesel/baselines', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    res.json(await listarBaselines());
  } catch (e) {
    console.error('diesel baselines:', e.message);
    res.status(500).json({ error: 'Error al listar baselines' });
  }
});

router.post('/diesel/recomputar', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const r = await recomputarBaselines();
    await auditar(req.usuario.id, 'diesel_recomputar', 'diesel_baselines', null, r, req.ip);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error('diesel recomputar:', e.message);
    res.status(500).json({ error: 'Error al recomputar baselines' });
  }
});

router.get('/diesel/forense/:unidad_id', auth(ROLES_LECTURA), async (req, res) => {
  const dias = Math.min(parseInt(req.query.dias) || 30, 365);
  try {
    const viajes = await analisisForense(req.params.unidad_id, dias);
    res.json({ unidad_id: parseInt(req.params.unidad_id), dias, viajes });
  } catch (e) {
    console.error('diesel forense:', e.message);
    res.status(500).json({ error: 'Error al consultar forense diesel' });
  }
});

// ══════════════════════════════════════════════════════════════════
// COMERCIAL IA — insights para área de ventas/cobranza/clientes
// ══════════════════════════════════════════════════════════════════

router.get('/insights/cobranza-vencida', auth(ROLES_LECTURA), async (_req, res) => {
  try { res.json(await cobranzaVencida()); }
  catch (e) { console.error('insights cobranza:', e.message); res.status(500).json({ error: 'Error en cobranza vencida' }); }
});

router.get('/insights/clientes-riesgo', auth(ROLES_LECTURA), async (req, res) => {
  const dias = Math.min(parseInt(req.query.dias) || 60, 365);
  try { res.json(await clientesEnRiesgo(dias)); }
  catch (e) { console.error('insights clientes-riesgo:', e.message); res.status(500).json({ error: 'Error en clientes en riesgo' }); }
});

router.get('/insights/cotizaciones-pendientes', auth(ROLES_LECTURA), async (_req, res) => {
  try { res.json(await cotizacionesPendientes()); }
  catch (e) { console.error('insights cotizaciones:', e.message); res.status(500).json({ error: 'Error en cotizaciones pendientes' }); }
});

router.get('/insights/precios-ruta', auth(ROLES_LECTURA), async (_req, res) => {
  try { res.json(await preciosPorRuta()); }
  catch (e) { console.error('insights precios:', e.message); res.status(500).json({ error: 'Error en precios por ruta' }); }
});

router.get('/insights/briefing', auth(ROLES_DASHBOARD), async (_req, res) => {
  try { res.json(await briefingEjecutivo()); }
  catch (e) { console.error('insights briefing:', e.message); res.status(500).json({ error: 'Error al generar briefing' }); }
});

router.get('/insights/all', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const [briefing, cobranza, riesgo, cotiz, precios] = await Promise.all([
      briefingEjecutivo(),
      cobranzaVencida(),
      clientesEnRiesgo(60),
      cotizacionesPendientes(),
      preciosPorRuta(),
    ]);
    res.json({ briefing, cobranza, riesgo, cotizaciones: cotiz, precios });
  } catch (e) {
    console.error('insights all:', e.message);
    res.status(500).json({ error: 'Error al generar insights consolidados' });
  }
});

// ══════════════════════════════════════════════════════════════════
// SETUP STATUS — onboarding progress
// ══════════════════════════════════════════════════════════════════
router.get('/setup-status', auth(ROLES_DASHBOARD), async (_req, res) => {
  try {
    const { rows: [r] } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM unidades WHERE activo = true)::int                                   AS unidades,
        (SELECT COUNT(*) FROM operadores WHERE activo = true)::int                                 AS operadores,
        (SELECT COUNT(*) FROM clientes WHERE activo = true)::int                                   AS clientes,
        (SELECT COUNT(*) FROM viajes)::int                                                         AS viajes,
        (SELECT COUNT(*) FROM unidad_documentos WHERE archivo_bytes IS NOT NULL)::int              AS docs_unidades,
        (SELECT COUNT(*) FROM operador_documentos WHERE archivo_bytes IS NOT NULL)::int            AS docs_operadores,
        (SELECT COUNT(*) FROM operador_documentos
           WHERE tipo = 'licencia_federal' AND vigencia_fin IS NOT NULL)::int                      AS licencias_con_vigencia,
        (SELECT COUNT(*) FROM gps_pings WHERE registrado_en >= NOW() - INTERVAL '24 hours')::int   AS pings_24h
    `);

    const pasos = [
      {
        id: 'unidades',
        titulo: 'Da de alta tus unidades',
        descripcion: 'Empieza con tus 3 plataformas. Sin unidades no se pueden registrar viajes.',
        ruta: '/unidades',
        icono: '🚛',
        completo: r.unidades > 0,
        progreso: Math.min(r.unidades, 3),
        meta: 3,
      },
      {
        id: 'operadores',
        titulo: 'Registra a tus operadores',
        descripcion: 'Nombre, teléfono y número de licencia federal de cada operador.',
        ruta: '/operadores',
        icono: '👤',
        completo: r.operadores > 0,
        progreso: Math.min(r.operadores, 3),
        meta: 3,
      },
      {
        id: 'docs_operadores',
        titulo: 'Sube licencias federales',
        descripcion: 'Licencia federal con su fecha de vencimiento. La IA te alertará antes que venza.',
        ruta: '/operadores',
        icono: '🪪',
        completo: r.licencias_con_vigencia > 0,
        progreso: r.licencias_con_vigencia,
        meta: r.operadores || 1,
      },
      {
        id: 'clientes',
        titulo: 'Agrega tus clientes principales',
        descripcion: 'Constructoras, distribuidoras y empresas a las que les das servicio.',
        ruta: '/clientes',
        icono: '👥',
        completo: r.clientes > 0,
        progreso: Math.min(r.clientes, 5),
        meta: 5,
      },
      {
        id: 'primer_viaje',
        titulo: 'Registra tu primer viaje',
        descripcion: 'Origen, destino, operador, unidad, diesel y km recorridos.',
        ruta: '/registro-movil',
        icono: '🚀',
        completo: r.viajes > 0,
        progreso: r.viajes > 0 ? 1 : 0,
        meta: 1,
      },
    ];

    const completos = pasos.filter(p => p.completo).length;
    const completion_pct = Math.round((completos / pasos.length) * 100);

    res.json({
      pasos,
      completos,
      total: pasos.length,
      completion_pct,
      conteos: r,
      onboarding_completo: completion_pct === 100,
    });
  } catch (e) {
    console.error('setup-status:', e.message);
    res.status(500).json({ error: 'Error al consultar estado de setup' });
  }
});

// ══════════════════════════════════════════════════════════════════
// AUTOMATIZACIONES (cron jobs)
// ══════════════════════════════════════════════════════════════════
router.get('/cron/estado', auth(ROLES_LECTURA), (_req, res) => {
  res.json(cronJobs.estado());
});

router.post('/cron/disparar/:job', auth(ROLES_ESCRITURA), async (req, res) => {
  try {
    const r = await cronJobs.disparar(req.params.job, req.usuario.id);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/cron/historial', auth(ROLES_LECTURA), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const { rows } = await db.query(`
      SELECT id, accion, detalle, ip, created_at
      FROM audit_log
      WHERE accion LIKE 'cron_%'
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(rows);
  } catch (e) {
    console.error('cron historial:', e.message);
    res.status(500).json({ error: 'Error al consultar historial' });
  }
});

// ══════════════════════════════════════════════════════════════════
// CONFIGURACIÓN — exponer umbrales para que el frontend los muestre
// ══════════════════════════════════════════════════════════════════
router.get('/config', auth(ROLES_LECTURA), (_req, res) => {
  res.json({ umbrales: UMBRALES, version: '1.2.0' });
});

module.exports = router;
