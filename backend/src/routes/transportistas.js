const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

const ROLES_LECTURA = ['director','admin','caja','logistica','monitoreo'];
const ROLES_ESCRITURA = ['director','admin'];

// ── CRUD Transportistas externos ────────────────
router.get('/', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT t.*,
             (SELECT COUNT(*)::int FROM viajes v
              WHERE v.transportista_externo_id = t.id
                AND v.fecha >= date_trunc('month', CURRENT_DATE)) AS viajes_mes,
             (SELECT COALESCE(SUM(v.comision_andreu), 0)::float FROM viajes v
              WHERE v.transportista_externo_id = t.id
                AND v.fecha >= date_trunc('month', CURRENT_DATE)) AS comision_mes
      FROM transportistas_externos t
      ORDER BY t.activo DESC, t.calificacion DESC, t.razon_social
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
router.get('/sugerir/:lead_id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [lead] } = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.lead_id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    // Scoring: transportista mejor calificado + cubre el tipo_carga + cubre zona destino (si aplicable)
    const { rows: candidatos } = await db.query(`
      SELECT *,
        (CASE WHEN $1 = ANY(tipos_carga) THEN 50 ELSE 0 END) +
        (calificacion * 10) +
        (CASE WHEN total_viajes > 0 THEN LEAST(20, total_viajes * 2) ELSE 0 END) AS score
      FROM transportistas_externos
      WHERE activo = true
        AND ($1 = ANY(tipos_carga) OR cardinality(tipos_carga) = 0)
      ORDER BY score DESC, calificacion DESC
      LIMIT 5
    `, [lead.tipo_carga]);

    res.json({
      lead: { id: lead.id, folio: lead.folio, tipo_carga: lead.tipo_carga, destino: lead.destino },
      sugerencias: candidatos,
      mensaje: candidatos.length === 0
        ? `No hay transportistas registrados que muevan "${lead.tipo_carga}". Da de alta uno primero.`
        : `Top ${candidatos.length} transportistas para "${lead.tipo_carga}" ordenados por scoring IA.`,
    });
  } catch (e) {
    console.error('sugerir:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
