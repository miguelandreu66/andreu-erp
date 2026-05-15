const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const auditor = require('../lib/commandAi/auditorIA');

const ROLES_LECTURA = ['director','admin'];
const ROLES_EJECUCION = ['director'];

// ──────────────────────────────────────────────
// Listar ejecuciones recientes
// ──────────────────────────────────────────────
router.get('/ejecuciones', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM auditoria_ia_resumen
      ORDER BY iniciada_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (e) {
    console.error('auditorIA list:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Detalle de una ejecución con sus hallazgos
router.get('/ejecuciones/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [e] } = await db.query(`
      SELECT * FROM auditoria_ia_resumen WHERE id = $1
    `, [req.params.id]);
    if (!e) return res.status(404).json({ error: 'Ejecución no encontrada' });

    const { rows: hallazgos } = await db.query(`
      SELECT h.*, usr.nombre AS decidida_por_nombre
      FROM auditoria_ia_hallazgos h
      LEFT JOIN usuarios usr ON usr.id = h.decidida_por
      WHERE h.ejecucion_id = $1
      ORDER BY
        CASE h.severidad WHEN 'critico' THEN 1 WHEN 'alto' THEN 2 WHEN 'medio' THEN 3 ELSE 4 END,
        h.tipo,
        h.id
    `, [req.params.id]);

    res.json({ ejecucion: e, hallazgos });
  } catch (e) {
    console.error('auditorIA detalle:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Hallazgos abiertos (todos los pendientes/en_progreso)
// ──────────────────────────────────────────────
router.get('/hallazgos', auth(ROLES_LECTURA), async (req, res) => {
  const { status, tipo, categoria, severidad, limit = 100 } = req.query;
  const where = [];
  const params = [];
  if (status)    { params.push(status);    where.push(`h.status = $${params.length}`); }
  else           { where.push(`h.status IN ('pendiente','en_progreso')`); }
  if (tipo)      { params.push(tipo);      where.push(`h.tipo = $${params.length}`); }
  if (categoria) { params.push(categoria); where.push(`h.categoria = $${params.length}`); }
  if (severidad) { params.push(severidad); where.push(`h.severidad = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));

  try {
    const { rows } = await db.query(`
      SELECT h.*, e.iniciada_at AS ejecucion_fecha, e.semana_iso,
             usr.nombre AS decidida_por_nombre
      FROM auditoria_ia_hallazgos h
      JOIN auditoria_ia_ejecuciones e ON e.id = h.ejecucion_id
      LEFT JOIN usuarios usr ON usr.id = h.decidida_por
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE h.severidad WHEN 'critico' THEN 1 WHEN 'alto' THEN 2 WHEN 'medio' THEN 3 ELSE 4 END,
        h.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resumen general (para dashboard)
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows: [ultimaEj] } = await db.query(`
      SELECT * FROM auditoria_ia_resumen
      WHERE estado = 'completada'
      ORDER BY iniciada_at DESC LIMIT 1
    `);

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pendiente')::int                              AS abiertos,
        COUNT(*) FILTER (WHERE status = 'pendiente' AND severidad = 'critico')::int    AS criticos_abiertos,
        COUNT(*) FILTER (WHERE status = 'aplicada')::int                               AS aplicadas_total,
        COUNT(*) FILTER (WHERE status = 'descartada')::int                             AS descartadas_total,
        COALESCE(SUM(impacto_mxn) FILTER (WHERE status = 'pendiente' AND tipo = 'oportunidad'), 0)::float
                                                                                       AS oportunidad_mxn_abierta,
        COALESCE(SUM(impacto_mxn) FILTER (WHERE status = 'aplicada'), 0)::float        AS impacto_aplicado_mxn
      FROM auditoria_ia_hallazgos
    `);

    const { rows: porCategoria } = await db.query(`
      SELECT categoria, COUNT(*)::int AS n
      FROM auditoria_ia_hallazgos
      WHERE status IN ('pendiente','en_progreso')
      GROUP BY categoria
      ORDER BY n DESC
    `);

    res.json({
      ultima_ejecucion: ultimaEj || null,
      stats,
      por_categoria: porCategoria,
    });
  } catch (e) {
    console.error('auditorIA dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Ejecutar auditoría on-demand (botón "Auditar ahora")
// ──────────────────────────────────────────────
router.post('/ejecutar', auth(ROLES_EJECUCION), async (req, res) => {
  try {
    // Verificar que no haya otra en curso
    const { rows: [enCurso] } = await db.query(`
      SELECT id FROM auditoria_ia_ejecuciones WHERE estado = 'en_curso'
        AND iniciada_at > NOW() - INTERVAL '15 minutes'
      ORDER BY iniciada_at DESC LIMIT 1
    `);
    if (enCurso) {
      return res.status(409).json({
        error: 'Ya hay una auditoría en curso. Espera a que termine.',
        ejecucion_id: enCurso.id,
      });
    }

    const r = await auditor.ejecutarAuditoria({
      tipo: 'manual',
      iniciada_por: req.usuario.id,
    });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'auditor_ia_ejecutar', 'auditoria_ia_ejecuciones', $2, $3, $4)
      `, [req.usuario.id, r.ejecucion_id, {
        hallazgos: r.hallazgos_insertados, costo_usd: r.costo_usd, duracion_ms: r.duracion_ms,
      }, req.ip]);
    } catch (_) {}

    res.json(r);
  } catch (e) {
    console.error('auditorIA ejecutar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Workflow: cambiar status de un hallazgo
// ──────────────────────────────────────────────
router.put('/hallazgos/:id/status', auth(ROLES_LECTURA), async (req, res) => {
  const { status, notas } = req.body || {};
  if (!['pendiente','en_progreso','aplicada','descartada','expirada'].includes(status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  try {
    const decidiendo = ['aplicada','descartada'].includes(status);
    const { rows: [h] } = await db.query(`
      UPDATE auditoria_ia_hallazgos
      SET status = $1,
          notas_director = COALESCE($2, notas_director),
          decidida_por = CASE WHEN $3 THEN $4 ELSE decidida_por END,
          decidida_at = CASE WHEN $3 THEN NOW() ELSE decidida_at END,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [status, notas || null, decidiendo, req.usuario.id, req.params.id]);
    if (!h) return res.status(404).json({ error: 'Hallazgo no encontrado' });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'auditor_ia_status', 'auditoria_ia_hallazgos', $2, $3, $4)
      `, [req.usuario.id, h.id, { status, titulo: h.titulo, notas }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, hallazgo: h });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────
// Configuración (modelo, costo, schedule, activo)
// ──────────────────────────────────────────────
router.get('/configuracion', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'auditor_ia_%'
      ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion', auth(['director']), async (req, res) => {
  const { modelo, max_costo_usd, schedule_cron, activo } = req.body || {};
  try {
    const updates = [];
    if (modelo)          updates.push(['auditor_ia_modelo', modelo]);
    if (max_costo_usd)   updates.push(['auditor_ia_max_costo_usd', String(max_costo_usd)]);
    if (schedule_cron)   updates.push(['auditor_ia_schedule_cron', schedule_cron]);
    if (activo != null)  updates.push(['auditor_ia_activo', activo ? 'true' : 'false']);
    for (const [k, v] of updates) {
      await db.query(`UPDATE configuracion_empresa SET valor = $1, updated_at = NOW() WHERE clave = $2`, [v, k]);
    }
    res.json({ ok: true, actualizados: updates.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
