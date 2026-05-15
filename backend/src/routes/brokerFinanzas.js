const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

const ROLES_LECTURA   = ['director','admin','caja'];
const ROLES_ESCRITURA = ['director','admin'];

// ──────────────────────────────────────────────
// Resumen ejecutivo (todo en un solo endpoint para el dashboard)
// ──────────────────────────────────────────────
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    // 1) Marcar vencidos antes de leer
    await db.query('SELECT broker_marcar_vencidos()');

    // 2) Exposición global
    const { rows: [exp] } = await db.query('SELECT * FROM broker_cashflow_exposicion');

    // 3) Concentración clientes (top 10)
    const { rows: clientes } = await db.query(`
      SELECT * FROM broker_concentracion_clientes LIMIT 10
    `);

    // 4) Concentración transportistas (top 10)
    const { rows: transps } = await db.query(`
      SELECT * FROM broker_concentracion_transportistas LIMIT 10
    `);

    // 5) Umbrales configurados
    const { rows: cfgs } = await db.query(`
      SELECT clave, valor FROM configuracion_empresa
      WHERE clave IN (
        'broker_alerta_concentracion_cliente_pct',
        'broker_alerta_concentracion_transportista_pct',
        'broker_politica_pago',
        'broker_dias_credito_transportista_default'
      )
    `);
    const cfg = Object.fromEntries(cfgs.map(c => [c.clave, c.valor]));
    const umbralCliente = parseFloat(cfg.broker_alerta_concentracion_cliente_pct || 25);
    const umbralTransp  = parseFloat(cfg.broker_alerta_concentracion_transportista_pct || 30);

    // 6) Alertas activas
    const alertas = [];
    clientes.filter(c => c.pct_volumen >= umbralCliente).forEach(c => {
      alertas.push({
        tipo: 'concentracion_cliente',
        severidad: c.pct_volumen >= umbralCliente * 1.5 ? 'critica' : 'alta',
        mensaje: `${c.empresa} representa ${c.pct_volumen.toFixed(1)}% de tu volumen broker (${c.operaciones} operaciones, $${Math.round(c.volumen_trimestre).toLocaleString('es-MX')}). Diversifica antes de que se vuelva una dependencia peligrosa.`,
        entidad: c.empresa,
        pct: c.pct_volumen,
      });
    });
    transps.filter(t => t.pct_volumen >= umbralTransp).forEach(t => {
      alertas.push({
        tipo: 'concentracion_transportista',
        severidad: t.pct_volumen >= umbralTransp * 1.5 ? 'critica' : 'alta',
        mensaje: `${t.transportista} maneja ${t.pct_volumen.toFixed(1)}% de tu volumen broker. Si te queda mal, te quedas sin operación. Suma alternativas.`,
        entidad: t.transportista,
        pct: t.pct_volumen,
      });
    });

    // Exposición negativa de cashflow
    if (exp.exposicion_neta > 0) {
      alertas.push({
        tipo: 'cashflow_negativo',
        severidad: exp.exposicion_neta > 50000 ? 'critica' : 'alta',
        mensaje: `Debes $${Math.round(exp.exposicion_neta).toLocaleString('es-MX')} más a transportistas de lo que te falta cobrar. Riesgo de quedarte sin caja.`,
        monto: exp.exposicion_neta,
      });
    }

    // Pagos vencidos
    const { rows: [vencidos] } = await db.query(`
      SELECT COUNT(*)::int AS n, COALESCE(SUM(monto), 0)::float AS total
      FROM broker_pagos_transportista WHERE estado = 'vencido'
    `);
    if (vencidos.n > 0) {
      alertas.push({
        tipo: 'pagos_vencidos',
        severidad: 'critica',
        mensaje: `${vencidos.n} pago(s) a transportistas vencidos por $${Math.round(vencidos.total).toLocaleString('es-MX')}. Pagar para no romper relación.`,
        count: vencidos.n,
        monto: vencidos.total,
      });
    }

    res.json({
      exposicion: exp,
      concentracion: { clientes, transportistas: transps },
      umbrales: { cliente_pct: umbralCliente, transportista_pct: umbralTransp },
      politica_pago: cfg.broker_politica_pago || 'esperar_cobro_cliente',
      pagos_vencidos: vencidos,
      alertas,
    });
  } catch (e) {
    console.error('broker dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Operaciones broker con cashflow detallado
// ──────────────────────────────────────────────
router.get('/operaciones', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT * FROM broker_cashflow_operaciones
      ORDER BY created_at DESC LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────
// Pagos a transportistas — CRUD
// ──────────────────────────────────────────────
router.get('/pagos', auth(ROLES_LECTURA), async (req, res) => {
  const { estado, transportista_id, lead_id, limit = 100 } = req.query;
  const where = [];
  const params = [];
  if (estado)           { params.push(estado);           where.push(`estado = $${params.length}`); }
  if (transportista_id) { params.push(transportista_id); where.push(`transportista_externo_id = $${params.length}`); }
  if (lead_id)          { params.push(lead_id);          where.push(`lead_id = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));
  try {
    await db.query('SELECT broker_marcar_vencidos()');
    const { rows } = await db.query(`
      SELECT * FROM broker_pagos_alertas
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY fecha_programada ASC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pagos', auth(ROLES_ESCRITURA), async (req, res) => {
  const {
    transportista_externo_id, lead_id, viaje_id,
    concepto, monto, fecha_programada, metodo, notas,
  } = req.body || {};
  if (!transportista_externo_id || !concepto || !monto || !fecha_programada) {
    return res.status(400).json({ error: 'transportista_externo_id, concepto, monto y fecha_programada requeridos' });
  }
  try {
    // Validar que el transportista esté verificado
    const { rows: [t] } = await db.query(`
      SELECT razon_social, estado_verificacion FROM transportistas_externos WHERE id = $1
    `, [transportista_externo_id]);
    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });
    if (t.estado_verificacion !== 'verificado') {
      return res.status(403).json({
        error: `No puedes programar pagos a "${t.razon_social}" porque no está verificado. Estado: ${t.estado_verificacion}.`,
      });
    }

    const { rows: [p] } = await db.query(`
      INSERT INTO broker_pagos_transportista
        (transportista_externo_id, lead_id, viaje_id, concepto, monto,
         fecha_programada, metodo, notas, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      transportista_externo_id, lead_id || null, viaje_id || null,
      concepto.trim(), parseFloat(monto), fecha_programada,
      metodo?.trim() || null, notas?.trim() || null, req.usuario.id,
    ]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'broker_pago_programar', 'broker_pagos_transportista', $2, $3, $4)
      `, [req.usuario.id, p.id, { transportista_externo_id, monto, fecha_programada }, req.ip]);
    } catch (_) {}

    res.json(p);
  } catch (e) {
    console.error('broker pago crear:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put('/pagos/:id/marcar-pagado', auth(ROLES_ESCRITURA), async (req, res) => {
  const { metodo, referencia, fecha_pagada } = req.body || {};

  // Validación de política de pago: si "esperar_cobro_cliente" y aún no se ha cobrado del cliente → warning (no bloqueo)
  try {
    const { rows: [pago] } = await db.query(`
      SELECT p.*, l.monto_cobrado_cliente, l.precio_final
      FROM broker_pagos_transportista p
      LEFT JOIN leads l ON l.id = p.lead_id
      WHERE p.id = $1
    `, [req.params.id]);
    if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
    if (pago.estado === 'pagado') return res.status(409).json({ error: 'Este pago ya está marcado como pagado' });

    const { rows: [{ valor: politica }] } = await db.query(`
      SELECT valor FROM configuracion_empresa WHERE clave = 'broker_politica_pago'
    `);

    let warning = null;
    if (politica === 'esperar_cobro_cliente' && pago.lead_id) {
      const cobrado = parseFloat(pago.monto_cobrado_cliente || 0);
      const total   = parseFloat(pago.precio_final || 0);
      if (cobrado < total) {
        warning = `⚠️ Cliente aún no ha pagado completo ($${Math.round(cobrado).toLocaleString('es-MX')} de $${Math.round(total).toLocaleString('es-MX')}). Política actual es "esperar cobro cliente" — pagar ahora compromete tu cashflow.`;
      }
    }

    const { rows: [actualizado] } = await db.query(`
      UPDATE broker_pagos_transportista
      SET estado = 'pagado',
          fecha_pagada = COALESCE($1, CURRENT_DATE),
          metodo = COALESCE($2, metodo),
          referencia = COALESCE($3, referencia),
          pagado_por = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [fecha_pagada || null, metodo?.trim() || null, referencia?.trim() || null, req.usuario.id, req.params.id]);

    // Audit
    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'broker_pago_marcar_pagado', 'broker_pagos_transportista', $2, $3, $4)
      `, [req.usuario.id, actualizado.id, { monto: actualizado.monto, warning }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, pago: actualizado, warning });
  } catch (e) {
    console.error('marcar pagado:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put('/pagos/:id/cancelar', auth(['director']), async (req, res) => {
  const { motivo } = req.body || {};
  try {
    const { rows: [p] } = await db.query(`
      UPDATE broker_pagos_transportista
      SET estado = 'cancelado',
          notas = COALESCE(notas || ' | ', '') || 'Cancelado: ' || COALESCE($1, 'sin motivo'),
          updated_at = NOW()
      WHERE id = $2 AND estado != 'pagado'
      RETURNING *
    `, [motivo?.trim() || null, req.params.id]);
    if (!p) return res.status(404).json({ error: 'Pago no encontrado o ya está pagado' });
    res.json({ ok: true, pago: p });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/pagos/:id', auth(['director']), async (req, res) => {
  try {
    await db.query(`DELETE FROM broker_pagos_transportista WHERE id = $1 AND estado != 'pagado'`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────
// Registrar cobro del cliente en un lead broker
// ──────────────────────────────────────────────
router.post('/leads/:lead_id/cobro', auth(ROLES_ESCRITURA), async (req, res) => {
  const { monto, fecha } = req.body || {};
  if (!monto || parseFloat(monto) <= 0) {
    return res.status(400).json({ error: 'monto requerido y positivo' });
  }
  try {
    const { rows: [l] } = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.lead_id]);
    if (!l) return res.status(404).json({ error: 'Lead no encontrado' });
    if (l.tipo_operacion !== 'broker') return res.status(400).json({ error: 'Este lead no es operación broker' });

    const fechaCobro = fecha || new Date().toISOString().split('T')[0];

    const { rows: [actualizado] } = await db.query(`
      UPDATE leads
      SET monto_cobrado_cliente = COALESCE(monto_cobrado_cliente, 0) + $1,
          fecha_primer_cobro = COALESCE(fecha_primer_cobro, $2::date),
          fecha_ultimo_cobro = $2::date,
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, folio, monto_cobrado_cliente, precio_final, fecha_primer_cobro, fecha_ultimo_cobro
    `, [parseFloat(monto), fechaCobro, req.params.lead_id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'broker_cobro_cliente', 'leads', $2, $3, $4)
      `, [req.usuario.id, actualizado.id, { monto, fecha: fechaCobro, folio: actualizado.folio }, req.ip]);
    } catch (_) {}

    res.json({
      ok: true,
      lead: actualizado,
      pendiente_cobrar: parseFloat(actualizado.precio_final) - parseFloat(actualizado.monto_cobrado_cliente),
    });
  } catch (e) {
    console.error('registrar cobro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ──────────────────────────────────────────────
// Concentración detallada (para reportes)
// ──────────────────────────────────────────────
router.get('/concentracion', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const [{ rows: clientes }, { rows: transps }] = await Promise.all([
      db.query('SELECT * FROM broker_concentracion_clientes'),
      db.query('SELECT * FROM broker_concentracion_transportistas'),
    ]);
    res.json({ clientes, transportistas: transps });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────
// Configuración: cambiar umbrales y política
// ──────────────────────────────────────────────
router.put('/configuracion', auth(['director']), async (req, res) => {
  const {
    politica_pago,
    alerta_concentracion_cliente_pct,
    alerta_concentracion_transportista_pct,
    dias_credito_transportista_default,
  } = req.body || {};
  try {
    const updates = [];
    if (politica_pago && ['esperar_cobro_cliente','adelantar_con_factura','adelantar_libre'].includes(politica_pago)) {
      updates.push(['broker_politica_pago', politica_pago]);
    }
    if (alerta_concentracion_cliente_pct != null) {
      updates.push(['broker_alerta_concentracion_cliente_pct', String(alerta_concentracion_cliente_pct)]);
    }
    if (alerta_concentracion_transportista_pct != null) {
      updates.push(['broker_alerta_concentracion_transportista_pct', String(alerta_concentracion_transportista_pct)]);
    }
    if (dias_credito_transportista_default != null) {
      updates.push(['broker_dias_credito_transportista_default', String(dias_credito_transportista_default)]);
    }
    for (const [k, v] of updates) {
      await db.query(`UPDATE configuracion_empresa SET valor = $1, updated_at = NOW() WHERE clave = $2`, [v, k]);
    }
    res.json({ ok: true, actualizados: updates.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
