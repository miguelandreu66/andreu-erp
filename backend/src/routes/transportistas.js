const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

const ROLES_LECTURA = ['director','admin','caja','logistica','monitoreo'];
const ROLES_ESCRITURA = ['director','admin'];

// ── CRUD Transportistas externos ────────────────
router.get('/', auth(ROLES_LECTURA), async (req, res) => {
  const { solo_verificados, estado, incluir_inactivos } = req.query;
  const where = [];
  const params = [];
  if (solo_verificados === 'true') {
    where.push(`t.estado_verificacion = 'verificado'`);
    where.push(`t.activo = true`);
  } else if (estado) {
    params.push(estado);
    where.push(`t.estado_verificacion = $${params.length}`);
  }
  if (!incluir_inactivos && solo_verificados !== 'true' && !estado) {
    // por default ocultar inactivos
    where.push(`t.activo = true`);
  }
  try {
    const { rows } = await db.query(`
      SELECT t.*,
             (SELECT COUNT(*)::int FROM viajes v
              WHERE v.transportista_externo_id = t.id
                AND v.fecha >= date_trunc('month', CURRENT_DATE)) AS viajes_mes,
             (SELECT COALESCE(SUM(v.comision_andreu), 0)::float FROM viajes v
              WHERE v.transportista_externo_id = t.id
                AND v.fecha >= date_trunc('month', CURRENT_DATE)) AS comision_mes,
             chk.cumple_para_verificacion,
             chk.tiene_constancia_fiscal,
             chk.permiso_sct_vigente,
             chk.poliza_seguro_vigente,
             chk.tiene_ine_representante,
             chk.tiene_contrato,
             chk.tiene_docs_vencidos_criticos
      FROM transportistas_externos t
      LEFT JOIN transportistas_checklist chk ON chk.transportista_id = t.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY
        CASE t.estado_verificacion
          WHEN 'verificado' THEN 1
          WHEN 'en_revision' THEN 2
          WHEN 'pendiente' THEN 3
          WHEN 'suspendido' THEN 4
          WHEN 'rechazado' THEN 5
        END,
        t.score_automatico DESC,
        t.calificacion DESC,
        t.razon_social
    `, params);
    res.json(rows);
  } catch (e) {
    console.error('transp list:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [t] } = await db.query('SELECT * FROM transportistas_externos WHERE id = $1', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth(ROLES_ESCRITURA), async (req, res) => {
  const {
    razon_social, nombre_comercial, rfc, contacto_nombre, telefono, email, direccion,
    tipos_carga, tipos_unidad, zonas_cobertura,
    comision_pct_acordada, condiciones_pago, notas,
  } = req.body;
  if (!razon_social) return res.status(400).json({ error: 'razon_social es obligatorio' });
  try {
    const { rows: [t] } = await db.query(`
      INSERT INTO transportistas_externos
        (razon_social, nombre_comercial, rfc, contacto_nombre, telefono, email, direccion,
         tipos_carga, tipos_unidad, zonas_cobertura,
         comision_pct_acordada, condiciones_pago, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      razon_social.trim(), nombre_comercial?.trim() || null, rfc?.trim() || null,
      contacto_nombre?.trim() || null, telefono?.trim() || null, email?.trim() || null, direccion?.trim() || null,
      tipos_carga || [], tipos_unidad || [], zonas_cobertura || [],
      comision_pct_acordada || 15, condiciones_pago?.trim() || null, notas?.trim() || null,
    ]);
    res.json(t);
  } catch (e) {
    console.error('transp crear:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', auth(ROLES_ESCRITURA), async (req, res) => {
  const b = req.body;
  try {
    const { rows: [t] } = await db.query(`
      UPDATE transportistas_externos SET
        razon_social = COALESCE($1, razon_social),
        nombre_comercial = $2,
        rfc = $3,
        contacto_nombre = $4,
        telefono = $5,
        email = $6,
        direccion = $7,
        tipos_carga = COALESCE($8, tipos_carga),
        tipos_unidad = COALESCE($9, tipos_unidad),
        zonas_cobertura = COALESCE($10, zonas_cobertura),
        comision_pct_acordada = COALESCE($11, comision_pct_acordada),
        condiciones_pago = $12,
        calificacion = COALESCE($13, calificacion),
        activo = COALESCE($14, activo),
        notas = $15,
        updated_at = NOW()
      WHERE id = $16 RETURNING *
    `, [
      b.razon_social?.trim() || null, b.nombre_comercial?.trim() || null, b.rfc?.trim() || null,
      b.contacto_nombre?.trim() || null, b.telefono?.trim() || null, b.email?.trim() || null,
      b.direccion?.trim() || null, b.tipos_carga, b.tipos_unidad, b.zonas_cobertura,
      b.comision_pct_acordada, b.condiciones_pago?.trim() || null, b.calificacion,
      b.activo, b.notas?.trim() || null, req.params.id,
    ]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });
    res.json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', auth(['director']), async (req, res) => {
  try {
    await db.query('DELETE FROM transportistas_externos WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── IA: Sugerir top transportistas para un lead ──
// SÓLO devuelve verificados con docs críticos vigentes (filtro de seguridad)
router.get('/sugerir/:lead_id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [lead] } = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.lead_id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    // Scoring: sólo verificados, con tipo_carga match + score automático + calificación
    const { rows: candidatos } = await db.query(`
      SELECT t.*,
        (CASE WHEN $1 = ANY(t.tipos_carga) THEN 50 ELSE 0 END) +
        (t.calificacion * 10) +
        (t.score_automatico * 0.3) +
        (CASE WHEN t.total_viajes_completados > 0 THEN LEAST(20, t.total_viajes_completados * 2) ELSE 0 END) AS score
      FROM transportistas_externos t
      WHERE t.activo = true
        AND t.estado_verificacion = 'verificado'
        AND ($1 = ANY(t.tipos_carga) OR cardinality(t.tipos_carga) = 0)
      ORDER BY score DESC, t.score_automatico DESC, t.calificacion DESC
      LIMIT 5
    `, [lead.tipo_carga]);

    // Conteo total para el mensaje (cuántos NO verificados estamos filtrando)
    const { rows: [conteos] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE activo = true AND estado_verificacion = 'verificado'
                         AND ($1 = ANY(tipos_carga) OR cardinality(tipos_carga) = 0))::int AS verificados_match,
        COUNT(*) FILTER (WHERE activo = true AND estado_verificacion != 'verificado'
                         AND ($1 = ANY(tipos_carga) OR cardinality(tipos_carga) = 0))::int AS no_verificados_match
      FROM transportistas_externos
    `, [lead.tipo_carga]);

    res.json({
      lead: { id: lead.id, folio: lead.folio, tipo_carga: lead.tipo_carga, destino: lead.destino },
      sugerencias: candidatos,
      conteos,
      mensaje: candidatos.length === 0
        ? `No hay transportistas VERIFICADOS para "${lead.tipo_carga}". ${conteos.no_verificados_match > 0 ? `Hay ${conteos.no_verificados_match} pendientes de verificar.` : 'Da de alta uno primero.'}`
        : `Top ${candidatos.length} transportistas verificados para "${lead.tipo_carga}".`,
    });
  } catch (e) {
    console.error('sugerir:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Checklist de verificación ────────────────────
// Devuelve qué tiene y qué le falta al transportista para pasar a verificado
router.get('/:id/checklist', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [t] } = await db.query(`
      SELECT t.*, chk.*
      FROM transportistas_externos t
      LEFT JOIN transportistas_checklist chk ON chk.transportista_id = t.id
      WHERE t.id = $1
    `, [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });

    const requisitos = [
      { clave: 'constancia_fiscal',  label: 'Constancia de situación fiscal SAT', cumple: t.tiene_constancia_fiscal, critico: true },
      { clave: 'permiso_sct',        label: 'Permiso SCT/SICT vigente',           cumple: t.permiso_sct_vigente,      critico: true },
      { clave: 'poliza_seguro',      label: 'Póliza de seguro de carga vigente',  cumple: t.poliza_seguro_vigente,    critico: true },
      { clave: 'ine_representante',  label: 'INE del representante legal',        cumple: t.tiene_ine_representante,  critico: true },
      { clave: 'contrato_servicios', label: 'Contrato de servicios firmado',      cumple: t.tiene_contrato,           critico: true },
    ];
    const faltantes = requisitos.filter(r => !r.cumple);

    res.json({
      transportista: {
        id: t.id,
        razon_social: t.razon_social,
        estado_verificacion: t.estado_verificacion,
        verificado_at: t.verificado_at,
        motivo_rechazo: t.motivo_rechazo,
      },
      requisitos,
      faltantes_count: faltantes.length,
      tiene_docs_vencidos_criticos: !!t.tiene_docs_vencidos_criticos,
      cumple_para_verificacion: !!t.cumple_para_verificacion,
      bloqueo_asignacion: t.estado_verificacion !== 'verificado' || !!t.tiene_docs_vencidos_criticos,
      mensaje_bloqueo: t.estado_verificacion !== 'verificado'
        ? `Estado: ${t.estado_verificacion}. No se puede asignar leads hasta que sea verificado.`
        : t.tiene_docs_vencidos_criticos
          ? 'Tiene documentos críticos vencidos. Renovar para poder asignar leads.'
          : null,
    });
  } catch (e) {
    console.error('transp checklist:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Director: Aprobar verificación ────────────────
router.put('/:id/verificar', auth(['director']), async (req, res) => {
  try {
    // Validar que cumple los criterios mínimos
    const { rows: [chk] } = await db.query(`
      SELECT * FROM transportistas_checklist WHERE transportista_id = $1
    `, [req.params.id]);
    if (!chk) return res.status(404).json({ error: 'Transportista no encontrado' });

    if (!chk.cumple_para_verificacion) {
      const faltan = [];
      if (!chk.tiene_constancia_fiscal)   faltan.push('constancia fiscal');
      if (!chk.permiso_sct_vigente)       faltan.push('permiso SCT vigente');
      if (!chk.poliza_seguro_vigente)     faltan.push('póliza de seguro vigente');
      if (!chk.tiene_ine_representante)   faltan.push('INE representante');
      if (!chk.tiene_contrato)            faltan.push('contrato firmado');
      if (chk.tiene_docs_vencidos_criticos) faltan.push('renovar docs críticos vencidos');
      return res.status(400).json({
        error: `No cumple para verificar. Falta: ${faltan.join(', ')}.`,
        faltantes: faltan,
      });
    }

    // Próxima revisión a 1 año
    const { rows: [t] } = await db.query(`
      UPDATE transportistas_externos
      SET estado_verificacion = 'verificado',
          verificado_at = NOW(),
          verificado_por = $1,
          motivo_rechazo = NULL,
          fecha_proxima_revision = CURRENT_DATE + INTERVAL '1 year',
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [req.usuario.id, req.params.id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_verificar', 'transportistas_externos', $2, $3, $4)
      `, [req.usuario.id, t.id, { razon_social: t.razon_social }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, transportista: t, mensaje: '✅ Transportista verificado. Ahora puede recibir leads.' });
  } catch (e) {
    console.error('verificar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Director: Rechazar transportista ──────────────
router.put('/:id/rechazar', auth(['director']), async (req, res) => {
  const { motivo } = req.body || {};
  if (!motivo || motivo.trim().length < 5) {
    return res.status(400).json({ error: 'Motivo de rechazo requerido (mínimo 5 caracteres)' });
  }
  try {
    const { rows: [t] } = await db.query(`
      UPDATE transportistas_externos
      SET estado_verificacion = 'rechazado',
          motivo_rechazo = $1,
          verificado_at = NULL,
          verificado_por = $2,
          activo = false,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `, [motivo.trim(), req.usuario.id, req.params.id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_rechazar', 'transportistas_externos', $2, $3, $4)
      `, [req.usuario.id, t.id, { motivo }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, transportista: t });
  } catch (e) {
    console.error('rechazar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Director: Suspender (temporal, sin rechazar definitivo) ───
router.put('/:id/suspender', auth(['director']), async (req, res) => {
  const { motivo } = req.body || {};
  try {
    const { rows: [t] } = await db.query(`
      UPDATE transportistas_externos
      SET estado_verificacion = 'suspendido',
          motivo_rechazo = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [motivo?.trim() || 'Suspendido por director', req.params.id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_suspender', 'transportistas_externos', $2, $3, $4)
      `, [req.usuario.id, t.id, { motivo }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, transportista: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Director: Reactivar (de suspendido/rechazado → en_revision) ──
router.put('/:id/reactivar', auth(['director']), async (req, res) => {
  try {
    const { rows: [t] } = await db.query(`
      UPDATE transportistas_externos
      SET estado_verificacion = 'en_revision',
          motivo_rechazo = NULL,
          activo = true,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'transp_reactivar', 'transportistas_externos', $2, $3, $4)
      `, [req.usuario.id, t.id, { razon_social: t.razon_social }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, transportista: t });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Recalcular score automático ──
router.post('/:id/recalcular-score', auth(['director','admin']), async (req, res) => {
  try {
    const { rows: [r] } = await db.query('SELECT recalcular_score_transportista($1) AS score', [req.params.id]);
    res.json({ ok: true, score: r.score });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
