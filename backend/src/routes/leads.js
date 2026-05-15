const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const cotizador = require('../lib/cotizadorAI');
const cotizacionPdf = require('../lib/reportes/cotizacionPdf');
const vendedor = require('../lib/commandAi/vendedorIA');
const asignador = require('../lib/commandAi/asignadorIA');
const tracking = require('../lib/marketing/tracking');

// ══════════════════════════════════════════════════════════════════
// ENDPOINT PÚBLICO — sin login, expuesto al mundo
// Recibe cotización, guarda lead, devuelve precio
// ══════════════════════════════════════════════════════════════════
router.post('/cotizar', async (req, res) => {
  const {
    contacto_nombre, empresa, rfc, email, telefono,
    origen, destino, toneladas, tipo_carga, fecha_solicitada,
    recurrencia, servicios_extras, hora_salida, comentarios,
    // Tracking UTMs (Fase 20)
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    referrer, landing_path, session_id,
  } = req.body || {};

  // Validación básica
  if (!contacto_nombre || !origen || !destino) {
    return res.status(400).json({ error: 'contacto_nombre, origen y destino son obligatorios' });
  }
  if (!email && !telefono) {
    return res.status(400).json({ error: 'Necesitamos al menos un email o teléfono para contactarte' });
  }

  // Anti-spam básico: longitud de campos
  if (contacto_nombre.length > 200 || (empresa || '').length > 300 || origen.length > 300 || destino.length > 300) {
    return res.status(400).json({ error: 'Datos demasiado largos' });
  }

  try {
    // 1. Calcular cotización
    const cot = await cotizador.cotizar({
      origen, destino, toneladas, tipo_carga, fecha_solicitada,
      recurrencia, servicios_extras, hora_salida,
    });

    // 2. Generar folio
    const { rows: [folioRow] } = await db.query('SELECT generar_folio_lead() AS folio');
    const folio = folioRow.folio;

    // 3. Guardar lead
    const { rows: [lead] } = await db.query(`
      INSERT INTO leads (
        folio, contacto_nombre, empresa, rfc, email, telefono,
        origen, destino,
        origen_lat, origen_lng, destino_lat, destino_lng,
        toneladas, tipo_carga, fecha_solicitada, recurrencia,
        servicios_extras, comentarios,
        distancia_km, duracion_horas,
        precio_base, precio_recargos, precio_descuentos, precio_extras, precio_final,
        costo_estimado, margen_pct,
        desglose, modelo_usado,
        tipo_operacion,
        generado_por_ip, generado_por_ua, generado_por_origen
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,
        $9,$10,$11,$12,
        $13,$14,$15,$16,
        $17,$18,
        $19,$20,
        $21,$22,$23,$24,$25,
        $26,$27,
        $28,$29,
        $30,
        $31,$32,$33
      )
      RETURNING id, folio, precio_final, tipo_operacion, created_at
    `, [
      folio, contacto_nombre.trim(), empresa?.trim() || null, rfc?.trim() || null,
      email?.trim() || null, telefono?.trim() || null,
      origen.trim(), destino.trim(),
      cot.ruta.origen_coords?.lat || null, cot.ruta.origen_coords?.lng || null,
      cot.ruta.destino_coords?.lat || null, cot.ruta.destino_coords?.lng || null,
      toneladas || null, tipo_carga || 'general', fecha_solicitada || null, recurrencia || 'unico',
      JSON.stringify(servicios_extras || []), comentarios?.trim() || null,
      cot.ruta.distancia_km, cot.ruta.duracion_horas,
      cot.precio.base, cot.precio.monto_recargos, cot.precio.monto_descuentos,
      cot.precio.monto_extras, cot.precio.total_con_iva,
      cot.costos.total, cot.analisis.margen_pct,
      JSON.stringify(cot), cot.ruta.modelo,
      cot.tipo_operacion || 'pendiente_decidir',
      req.ip, (req.headers['user-agent'] || '').slice(0, 500), 'web_publico',
    ]);

    // Guardar UTMs en el lead (tracking de canal)
    if (utm_source || utm_medium || utm_campaign || referrer) {
      try {
        await db.query(`
          UPDATE leads
          SET utm_source = $1, utm_medium = $2, utm_campaign = $3,
              utm_content = $4, utm_term = $5,
              referrer = $6, landing_path = $7
          WHERE id = $8
        `, [
          utm_source || null, utm_medium || null, utm_campaign || null,
          utm_content || null, utm_term || null,
          (referrer || '').slice(0, 1000), (landing_path || '').slice(0, 200),
          lead.id,
        ]);
      } catch (_) {}
    }
    // Marcar visita como convertida
    if (session_id) {
      try { await tracking.marcarConvertida(session_id, lead.id); } catch (_) {}
    }

    // Audit
    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES (NULL, 'lead_cotizacion_publica', 'leads', $1, $2, $3)
      `, [lead.id, {
        folio, precio_final: cot.precio.total_con_iva,
        distancia_km: cot.ruta.distancia_km,
        margen_pct: cot.analisis.margen_pct,
        utm_source, utm_campaign,
      }, req.ip]);
    } catch (_) {}

    res.json({
      ok: true,
      lead_id: lead.id,
      folio,
      cotizacion: cot,
      mensaje: '✅ Tu cotización está lista. Te contactaremos pronto.',
    });

    // ── Vendedor IA: dispara contacto automático en background ──
    // Fire-and-forget (no bloquea el response al cliente público)
    vendedor.procesarLeadNuevo(lead.id).catch(e => {
      console.warn('[VendedorIA] procesarLeadNuevo falló:', e.message);
    });
  } catch (e) {
    console.error('cotizar:', e.message);
    res.status(500).json({ error: e.message || 'No pudimos generar tu cotización. Intenta de nuevo.' });
  }
});

// PDF público de cotización por folio (sin login — el folio actúa como token)
router.get('/pdf/:folio', async (req, res) => {
  try {
    const doc = await cotizacionPdf.generar(req.params.folio);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cotizacion-${req.params.folio}.pdf"`,
    });
    doc.pipe(res);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════
// ADMIN — gestión de leads (requiere login)
// ══════════════════════════════════════════════════════════════════
const ROLES_LEAD = ['director','admin','caja'];

router.get('/', auth(ROLES_LEAD), async (req, res) => {
  const { estado, limit = 100 } = req.query;
  try {
    const where = [];
    const params = [];
    if (estado) { params.push(estado); where.push(`estado = $${params.length}`); }
    params.push(Math.min(parseInt(limit) || 100, 500));

    const { rows } = await db.query(`
      SELECT id, folio, contacto_nombre, empresa, email, telefono,
             origen, destino, distancia_km, toneladas, tipo_carga, recurrencia,
             precio_final, costo_estimado, margen_pct, estado,
             cliente_id, viaje_id, generado_por_origen,
             created_at, contactado_at
      FROM leads
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `, params);

    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE estado='nuevo')::int           AS nuevos,
        COUNT(*) FILTER (WHERE estado='contactado')::int      AS contactados,
        COUNT(*) FILTER (WHERE estado='propuesta_enviada')::int AS propuesta,
        COUNT(*) FILTER (WHERE estado='negociando')::int      AS negociando,
        COUNT(*) FILTER (WHERE estado='ganado')::int          AS ganados,
        COUNT(*) FILTER (WHERE estado='perdido')::int         AS perdidos,
        COALESCE(SUM(precio_final) FILTER (WHERE estado IN ('nuevo','contactado','propuesta_enviada','negociando')), 0)::float AS pipeline_value,
        COALESCE(SUM(precio_final) FILTER (WHERE estado='ganado' AND created_at >= date_trunc('month', CURRENT_DATE)), 0)::float AS ganado_mes
      FROM leads
    `);

    res.json({ leads: rows, stats });
  } catch (e) {
    console.error('leads list:', e.message);
    res.status(500).json({ error: 'Error al listar leads' });
  }
});

router.get('/:id', auth(ROLES_LEAD), async (req, res) => {
  try {
    const { rows: [lead] } = await db.query(`
      SELECT l.*, c.nombre AS cliente_nombre
      FROM leads l
      LEFT JOIN clientes c ON c.id = l.cliente_id
      WHERE l.id = $1
    `, [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
    res.json(lead);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/estado', auth(ROLES_LEAD), async (req, res) => {
  const { estado, notas_internas, motivo_perdido } = req.body || {};
  if (!['nuevo','contactado','propuesta_enviada','negociando','ganado','perdido','spam'].includes(estado)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  try {
    const camposExtra = [];
    const paramsExtra = [];
    if (estado === 'contactado') {
      camposExtra.push(`contactado_at = NOW()`);
      camposExtra.push(`contactado_por = $${paramsExtra.length + 4}`);
      paramsExtra.push(req.usuario.id);
    }
    if (motivo_perdido) {
      camposExtra.push(`motivo_perdido = $${paramsExtra.length + 4}`);
      paramsExtra.push(motivo_perdido);
    }

    const { rows: [lead] } = await db.query(`
      UPDATE leads
      SET estado = $1, notas_internas = COALESCE($2, notas_internas), updated_at = NOW()
      ${camposExtra.length ? ', ' + camposExtra.join(', ') : ''}
      WHERE id = $3
      RETURNING *
    `, [estado, notas_internas || null, req.params.id, ...paramsExtra]);

    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'lead_cambio_estado', 'leads', $2, $3, $4)
      `, [req.usuario.id, lead.id, { estado, motivo_perdido }, req.ip]);
    } catch (_) {}

    res.json(lead);
  } catch (e) {
    console.error('lead estado:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Convertir lead en cliente (1 click)
router.post('/:id/convertir-cliente', auth(['director','admin']), async (req, res) => {
  try {
    const { rows: [lead] } = await db.query('SELECT * FROM leads WHERE id = $1', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });
    if (lead.cliente_id) {
      return res.status(409).json({ error: 'Este lead ya fue convertido a cliente' });
    }

    // Crear cliente
    const tipo = req.body?.tipo || 'constructora';
    const { rows: [cliente] } = await db.query(`
      INSERT INTO clientes (nombre, telefono, direccion, tipo, notas, creado_por)
      VALUES ($1, $2, NULL, $3, $4, $5)
      RETURNING *
    `, [
      lead.empresa || lead.contacto_nombre,
      lead.telefono,
      tipo,
      `Convertido desde lead ${lead.folio}. Contacto: ${lead.contacto_nombre}. ${lead.email ? 'Email: ' + lead.email : ''}`,
      req.usuario.id,
    ]);

    // Vincular y marcar ganado
    await db.query(`
      UPDATE leads SET cliente_id = $1, estado = 'ganado', updated_at = NOW()
      WHERE id = $2
    `, [cliente.id, req.params.id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'lead_convertir', 'leads', $2, $3, $4)
      `, [req.usuario.id, req.params.id, { cliente_id: cliente.id }, req.ip]);
    } catch (_) {}

    res.json({ ok: true, cliente, lead_folio: lead.folio });

    // ── Asignador IA: crea viaje + asignación automática ──
    // Fire-and-forget (no bloquea response)
    (async () => {
      try {
        const { rows: [{ valor: activo }] } = await db.query(
          `SELECT valor FROM configuracion_empresa WHERE clave = 'asignador_activo'`
        );
        if (activo !== 'true') return;

        // Crear viaje base a partir del lead
        const { rows: [v] } = await db.query(`
          INSERT INTO viajes (
            fecha, cliente_id, origen, destino, carga,
            toneladas, km_recorridos, monto_cobrado_cliente,
            tipo_carga, tipo_operacion, estado, registrado_por,
            descripcion_mercancia
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente_decidir', 'Programado', $10, $11)
          RETURNING *
        `, [
          lead.fecha_solicitada || new Date().toISOString().split('T')[0],
          cliente.id, lead.origen, lead.destino, lead.tipo_carga || 'general',
          parseFloat(lead.toneladas || 0), parseFloat(lead.distancia_km || 0),
          parseFloat(lead.precio_final || 0), lead.tipo_carga || 'general',
          req.usuario.id, lead.comentarios?.slice(0, 300) || null,
        ]);

        // Sugerir asignación
        const sug = await asignador.sugerirAsignacion(v.id, { leadId: lead.id });

        // Si auto-aprobar y confianza alta, aplicar directo
        if (await asignador.debeAutoAprobar(sug.decision.confianza)) {
          await asignador.aplicarAsignacion(sug.asignacion.id, { aprobadaPorUsuario: req.usuario.id, esAuto: true });
          console.log(`[Asignador-Auto] Lead ${lead.folio} → Viaje ${v.id} → Asignado (${sug.decision.tipo_operacion})`);
        } else {
          console.log(`[Asignador] Lead ${lead.folio} → Viaje ${v.id} → Sugerencia pendiente aprobación (confianza ${sug.decision.confianza})`);
        }
      } catch (e) {
        console.error(`[Asignador] Lead ${lead.id} falló:`, e.message);
      }
    })();
  } catch (e) {
    console.error('convertir cliente:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Asignar transportista externo a un lead (workflow broker)
// FILTRO DE SEGURIDAD: bloquea si el transportista no está verificado o tiene docs vencidos
router.post('/:id/asignar-transportista', auth(['director','admin']), async (req, res) => {
  const { transportista_externo_id, precio_transportista } = req.body || {};
  if (!transportista_externo_id || !precio_transportista) {
    return res.status(400).json({ error: 'transportista_externo_id y precio_transportista requeridos' });
  }
  try {
    const { rows: [lead] } = await db.query('SELECT precio_final FROM leads WHERE id = $1', [req.params.id]);
    if (!lead) return res.status(404).json({ error: 'Lead no encontrado' });

    // ── FILTRO ANTI-RIESGO ──
    const { rows: [t] } = await db.query(`
      SELECT t.id, t.razon_social, t.estado_verificacion, t.activo,
             chk.tiene_docs_vencidos_criticos, chk.cumple_para_verificacion
      FROM transportistas_externos t
      LEFT JOIN transportistas_checklist chk ON chk.transportista_id = t.id
      WHERE t.id = $1
    `, [transportista_externo_id]);

    if (!t) return res.status(404).json({ error: 'Transportista no encontrado' });
    if (!t.activo) return res.status(403).json({
      error: `Transportista "${t.razon_social}" está inactivo. No puede recibir leads.`,
      codigo: 'TRANSP_INACTIVO',
    });
    if (t.estado_verificacion !== 'verificado') {
      return res.status(403).json({
        error: `Transportista "${t.razon_social}" no está verificado (estado: ${t.estado_verificacion}). Completa documentación y verifícalo antes de asignarle leads.`,
        codigo: 'TRANSP_NO_VERIFICADO',
        estado: t.estado_verificacion,
      });
    }
    if (t.tiene_docs_vencidos_criticos) {
      return res.status(403).json({
        error: `Transportista "${t.razon_social}" tiene documentos críticos vencidos (Permiso SCT o Póliza de seguro). Renueva antes de asignar.`,
        codigo: 'TRANSP_DOCS_VENCIDOS',
      });
    }

    const precioCliente = parseFloat(lead.precio_final);
    const precioTransp = parseFloat(precio_transportista);
    const comision = precioCliente - precioTransp;

    const { rows: [actualizado] } = await db.query(`
      UPDATE leads
      SET tipo_operacion = 'broker',
          transportista_externo_id = $1,
          precio_transportista = $2,
          comision_andreu = $3,
          updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [transportista_externo_id, precioTransp, comision, req.params.id]);

    try {
      await db.query(`
        INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
        VALUES ($1, 'lead_asignar_transportista', 'leads', $2, $3, $4)
      `, [req.usuario.id, req.params.id, { transportista_externo_id, precio_transportista: precioTransp, comision }, req.ip]);
    } catch (_) {}

    res.json({
      ok: true,
      lead: actualizado,
      analisis: {
        precio_cliente: precioCliente,
        precio_transportista: precioTransp,
        comision_andreu: comision,
        margen_broker_pct: ((comision / precioCliente) * 100).toFixed(1),
      },
    });
  } catch (e) {
    console.error('asignar-transportista:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Resumen del módulo broker (cartera, comisiones, ranking)
router.get('/broker/resumen', auth(['director','admin']), async (_req, res) => {
  try {
    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo_operacion = 'broker')::int                              AS leads_broker_total,
        COUNT(*) FILTER (WHERE tipo_operacion = 'broker' AND estado = 'ganado')::int        AS leads_broker_ganados,
        COALESCE(SUM(comision_andreu) FILTER (WHERE tipo_operacion = 'broker' AND estado = 'ganado'), 0)::float AS comisiones_total,
        COALESCE(SUM(comision_andreu) FILTER (
          WHERE tipo_operacion = 'broker' AND estado = 'ganado'
            AND created_at >= date_trunc('month', CURRENT_DATE)
        ), 0)::float                                                                         AS comisiones_mes
      FROM leads
    `);
    const { rows: top } = await db.query(`
      SELECT t.id, t.razon_social, t.calificacion,
             COUNT(l.id)::int AS leads_asignados,
             COUNT(l.id) FILTER (WHERE l.estado = 'ganado')::int AS leads_ganados,
             COALESCE(SUM(l.comision_andreu) FILTER (WHERE l.estado = 'ganado'), 0)::float AS comisiones
      FROM transportistas_externos t
      LEFT JOIN leads l ON l.transportista_externo_id = t.id
      WHERE t.activo = true
      GROUP BY t.id, t.razon_social, t.calificacion
      ORDER BY comisiones DESC
      LIMIT 10
    `);
    res.json({ stats, top_transportistas: top });
  } catch (e) {
    console.error('broker resumen:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', auth(['director']), async (req, res) => {
  try {
    await db.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
