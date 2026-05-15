// ════════════════════════════════════════════════════════════════
// ROUTES — CFDI 4.0 + Carta Porte 3.0
// ════════════════════════════════════════════════════════════════

const router = require('express').Router();
const jwt = require('jsonwebtoken');
const db = require('../db');
const auth = require('../middleware/auth');
const facturama = require('../lib/fiscal/facturama');
const builder = require('../lib/fiscal/cfdiBuilder');
const envio = require('../lib/fiscal/envioCliente');

const ROLES_LECTURA = ['director','admin','caja'];
const ROLES_EMITIR = ['director','admin','caja'];
const ROLES_CANCELAR = ['director','admin'];

// ════════════════════════════════════════════════════════════════
// Dashboard / Resumen
// ════════════════════════════════════════════════════════════════
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const [pacOk, facturamaModo] = await Promise.all([
      facturama.isAvailable(),
      facturama.getModoUrl(),
    ]);

    // Config fiscal completa?
    const { rows: cfgRows } = await db.query(`
      SELECT clave, valor FROM configuracion_empresa
      WHERE clave IN ('fiscal_rfc','fiscal_razon_social','fiscal_regimen_fiscal','fiscal_codigo_postal')
    `);
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));
    const fiscalCompleto = !!(cfg.fiscal_rfc && cfg.fiscal_razon_social && cfg.fiscal_regimen_fiscal && cfg.fiscal_codigo_postal);

    // Stats del mes actual
    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*)::int                                                     AS total_mes,
        COUNT(*) FILTER (WHERE estado = 'emitido' OR estado = 'enviado')::int AS emitidos_mes,
        COUNT(*) FILTER (WHERE estado = 'borrador')::int                  AS borradores_mes,
        COUNT(*) FILTER (WHERE estado = 'fallido')::int                   AS fallidos_mes,
        COUNT(*) FILTER (WHERE estado = 'cancelado')::int                 AS cancelados_mes,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('emitido','enviado')), 0)::float AS monto_emitido_mes,
        COALESCE(SUM(total) FILTER (WHERE enviado_cliente = true), 0)::float AS monto_enviado_cliente_mes
      FROM cfdi_emitidos
      WHERE created_at >= date_trunc('month', CURRENT_DATE)
    `);

    const { rows: porMes } = await db.query(`
      SELECT * FROM cfdi_resumen_mes LIMIT 6
    `);

    // Auto-emisión config
    const { rows: autoCfgs } = await db.query(`
      SELECT clave, valor FROM configuracion_empresa
      WHERE clave IN ('cfdi_auto_emitir','cfdi_auto_enviar_cliente','cfdi_canales_envio')
    `);
    const autoCfg = Object.fromEntries(autoCfgs.map(r => [r.clave, r.valor]));

    res.json({
      pac: {
        proveedor: 'facturama',
        configurado: pacOk,
        modo: facturamaModo.modo,
      },
      fiscal_completo: fiscalCompleto,
      auto: {
        emitir: autoCfg.cfdi_auto_emitir === 'true',
        enviar_cliente: autoCfg.cfdi_auto_enviar_cliente === 'true',
        canales: autoCfg.cfdi_canales_envio || 'email',
      },
      stats_mes: stats,
      historico: porMes,
    });
  } catch (e) {
    console.error('cfdi dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// Listar CFDIs con filtros
// ════════════════════════════════════════════════════════════════
router.get('/', auth(ROLES_LECTURA), async (req, res) => {
  const { estado, viaje_id, cliente_id, limit = 100 } = req.query;
  const where = []; const params = [];
  if (estado)     { params.push(estado);     where.push(`c.estado = $${params.length}`); }
  if (viaje_id)   { params.push(viaje_id);   where.push(`c.viaje_id = $${params.length}`); }
  if (cliente_id) { params.push(cliente_id); where.push(`c.cliente_id = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 100, 500));

  try {
    const { rows } = await db.query(`
      SELECT c.id, c.serie, c.folio, c.uuid_fiscal, c.fecha_emision,
             c.estado, c.tipo_comprobante, c.total, c.subtotal, c.total_iva,
             c.receptor_rfc, c.receptor_razon_social, c.tiene_carta_porte,
             c.enviado_cliente, c.enviado_cliente_at, c.viaje_id, c.cliente_id,
             c.pac_modo, c.created_at,
             cl.nombre AS cliente_nombre,
             v.origen, v.destino
      FROM cfdi_emitidos c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN viajes v ON v.id = c.viaje_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Detalle
router.get('/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [cfdi] } = await db.query(`
      SELECT c.*, cl.nombre AS cliente_nombre, cl.email AS cliente_email,
             v.origen, v.destino, v.fecha
      FROM cfdi_emitidos c
      LEFT JOIN clientes cl ON cl.id = c.cliente_id
      LEFT JOIN viajes v ON v.id = c.viaje_id
      WHERE c.id = $1
    `, [req.params.id]);
    if (!cfdi) return res.status(404).json({ error: 'CFDI no encontrado' });

    const { rows: conceptos } = await db.query(`SELECT * FROM cfdi_conceptos WHERE cfdi_id = $1 ORDER BY orden_idx`, [req.params.id]);
    const { rows: eventos } = await db.query(`SELECT * FROM cfdi_eventos WHERE cfdi_id = $1 ORDER BY created_at DESC`, [req.params.id]);

    // No mandar bytes en JSON
    delete cfdi.xml_bytes;
    delete cfdi.pdf_bytes;

    res.json({ cfdi, conceptos, eventos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// Emitir CFDI a partir de un viaje
// ════════════════════════════════════════════════════════════════
router.post('/emitir-viaje/:viaje_id', auth(ROLES_EMITIR), async (req, res) => {
  const viajeId = parseInt(req.params.viaje_id);
  try {
    // Lock anti-doble: ya emitido?
    const { rows: [yaExiste] } = await db.query(`
      SELECT id, uuid_fiscal, estado FROM cfdi_emitidos
      WHERE viaje_id = $1 AND estado IN ('emitido','enviado','emitiendo','borrador')
      ORDER BY id DESC LIMIT 1
    `, [viajeId]);
    if (yaExiste && ['emitido','enviado','emitiendo'].includes(yaExiste.estado)) {
      return res.status(409).json({ error: `Este viaje ya tiene CFDI ${yaExiste.estado} (id ${yaExiste.id})`, cfdi_id: yaExiste.id });
    }

    // Cargar viaje + cliente
    const { rows: [viaje] } = await db.query(`SELECT * FROM viajes WHERE id = $1`, [viajeId]);
    if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });
    if (!viaje.cliente_id) return res.status(400).json({ error: 'El viaje no tiene cliente asociado' });

    const { rows: [cliente] } = await db.query(`SELECT * FROM clientes WHERE id = $1`, [viaje.cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente del viaje no encontrado' });

    const { rows: [unidad] } = await db.query(`SELECT * FROM unidades WHERE id = $1`, [viaje.unidad_id || 0]);
    const { rows: [operador] } = await db.query(`SELECT * FROM operadores WHERE id = $1`, [viaje.operador_id || 0]);

    // Construir payload
    const { payload, valorUnitarioSinIva, importeIva, subtotalServicio } = await builder.construirPayload({
      viaje, cliente, unidad: unidad || null, operador: operador || null,
    });

    // Insertar como borrador
    const { rows: [serieRow] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'fiscal_serie_cfdi'`);
    const serie = serieRow?.valor || 'A';
    const { rows: [{ siguiente_folio_cfdi: folio }] } = await db.query(`SELECT siguiente_folio_cfdi($1)`, [serie]);
    const { modo } = await facturama.getModoUrl();

    const { rows: [cfdiRow] } = await db.query(`
      INSERT INTO cfdi_emitidos
        (viaje_id, cliente_id, serie, folio, tipo_comprobante, forma_pago, metodo_pago, uso_cfdi,
         moneda, subtotal, total_iva, total,
         receptor_rfc, receptor_razon_social, receptor_regimen, receptor_cp, receptor_email,
         tiene_carta_porte, origen_cp, destino_cp, distancia_km, peso_bruto_kg,
         estado, pac_proveedor, pac_modo, emitido_por)
      VALUES ($1,$2,$3,$4,'I',$5,$6,$7,
              $8,$9,$10,$11,
              $12,$13,$14,$15,$16,
              $17,$18,$19,$20,$21,
              'emitiendo','facturama',$22,$23)
      RETURNING *
    `, [
      viajeId, cliente.id, serie, folio,
      payload.PaymentForm, payload.PaymentMethod, payload.Receiver.CfdiUse,
      payload.Currency, valorUnitarioSinIva, importeIva, valorUnitarioSinIva + importeIva,
      cliente.rfc_fiscal, cliente.razon_social, cliente.regimen_fiscal,
      cliente.codigo_postal_fiscal, cliente.email_facturacion || cliente.email,
      !!payload.Complemento, viaje.origen_codigo_postal, viaje.destino_codigo_postal,
      viaje.distancia_km, viaje.peso_bruto_total_kg,
      modo, req.usuario.id,
    ]);
    const cfdiId = cfdiRow.id;

    await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle, usuario_id) VALUES ($1, 'creado', $2, $3)`,
      [cfdiId, { folio: `${serie}${folio}`, payload_resumen: { items: payload.Items.length, tiene_cartaporte: !!payload.Complemento } }, req.usuario.id]);

    // Emitir al PAC
    try {
      const resp = await facturama.emitirCfdi(payload);
      const uuid = resp.Complement?.TaxStamp?.Uuid || resp.Id || null;
      const facturamaId = resp.Id || null;

      // Descargar XML + PDF si tenemos id
      let xmlBuf = null, pdfBuf = null;
      if (facturamaId) {
        try { xmlBuf = await facturama.descargarXml(facturamaId); } catch (e) { console.warn('xml dl:', e.message); }
        try { pdfBuf = await facturama.descargarPdf(facturamaId); } catch (e) { console.warn('pdf dl:', e.message); }
      }

      await db.query(`
        UPDATE cfdi_emitidos
        SET estado = 'emitido',
            uuid_fiscal = $1,
            fecha_emision = COALESCE(NOW(), fecha_emision),
            pac_respuesta = $2,
            xml_bytes = $3,
            pdf_bytes = $4,
            updated_at = NOW()
        WHERE id = $5
      `, [uuid, resp, xmlBuf, pdfBuf, cfdiId]);

      // Persistir el concepto principal
      await db.query(`
        INSERT INTO cfdi_conceptos
          (cfdi_id, clave_prod_serv, clave_unidad, descripcion, cantidad, valor_unitario, importe, base_iva, tasa_iva, importe_iva, es_carta_porte, orden_idx)
        VALUES ($1, $2, $3, $4, 1, $5, $5, $5, 0.16, $6, true, 1)
      `, [cfdiId, payload.Items[0].ProductCode, payload.Items[0].UnitCode, payload.Items[0].Description,
          valorUnitarioSinIva, importeIva]);

      await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle, usuario_id) VALUES ($1, 'certificado', $2, $3)`,
        [cfdiId, { uuid, facturama_id: facturamaId }, req.usuario.id]);

      // Marcar viaje como facturado
      await db.query(`UPDATE viajes SET facturado = true, cfdi_id = $1, updated_at = NOW() WHERE id = $2`, [cfdiId, viajeId]);

      // Auto-enviar al cliente si está activado
      const { rows: [{ valor: autoEnv }] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'cfdi_auto_enviar_cliente'`);
      let envioResult = null;
      if (autoEnv === 'true') {
        try { envioResult = await envio.enviarCfdiACliente(cfdiId); }
        catch (e) { console.warn('envio cliente:', e.message); }
      }

      try {
        await db.query(`
          INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
          VALUES ($1, 'cfdi_emitir', 'cfdi_emitidos', $2, $3, $4)
        `, [req.usuario.id, cfdiId, { uuid, folio: `${serie}${folio}`, viaje_id: viajeId, monto: valorUnitarioSinIva + importeIva }, req.ip]);
      } catch (_) {}

      res.json({
        ok: true,
        cfdi_id: cfdiId,
        uuid,
        folio_completo: `${serie}${folio}`,
        total: valorUnitarioSinIva + importeIva,
        estado: envioResult?.ok ? 'enviado' : 'emitido',
        envio_cliente: envioResult,
      });
    } catch (e) {
      // PAC falló — marcar como fallido pero NO borrar (deja folio reservado)
      await db.query(`
        UPDATE cfdi_emitidos
        SET estado = 'fallido', error_mensaje = $1, updated_at = NOW()
        WHERE id = $2
      `, [e.message.slice(0, 2000), cfdiId]);
      await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle) VALUES ($1, 'error_pac', $2)`,
        [cfdiId, { error: e.message, status: e.status, data: e.data }]);
      throw e;
    }
  } catch (e) {
    console.error('emitir cfdi:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Reintentar un fallido
router.post('/:id/reintentar', auth(ROLES_EMITIR), async (req, res) => {
  try {
    const { rows: [cfdi] } = await db.query(`SELECT viaje_id FROM cfdi_emitidos WHERE id = $1 AND estado = 'fallido'`, [req.params.id]);
    if (!cfdi) return res.status(404).json({ error: 'CFDI fallido no encontrado' });
    if (!cfdi.viaje_id) return res.status(400).json({ error: 'Sin viaje asociado' });
    // Borrar el fallido y volver a emitir desde el viaje
    await db.query(`DELETE FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    // Redirigir al endpoint de emitir
    req.params.viaje_id = cfdi.viaje_id;
    return router.handle({ ...req, method: 'POST', url: `/emitir-viaje/${cfdi.viaje_id}` }, res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reenviar al cliente
router.post('/:id/enviar-cliente', auth(ROLES_EMITIR), async (req, res) => {
  try {
    const r = await envio.enviarCfdiACliente(req.params.id);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cancelar
router.post('/:id/cancelar', auth(ROLES_CANCELAR), async (req, res) => {
  const { motivo = '02', uuid_sustitucion } = req.body || {};
  try {
    const { rows: [cfdi] } = await db.query(`SELECT * FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    if (!cfdi) return res.status(404).json({ error: 'CFDI no encontrado' });
    if (cfdi.estado === 'cancelado') return res.status(409).json({ error: 'Ya cancelado' });
    if (!cfdi.uuid_fiscal) return res.status(400).json({ error: 'CFDI sin UUID — no fue timbrado' });

    // Buscar facturama_id en pac_respuesta
    const facturamaId = cfdi.pac_respuesta?.Id;
    if (!facturamaId) return res.status(400).json({ error: 'Sin Facturama ID — cancela manualmente en el portal del PAC' });

    const acuse = await facturama.cancelarCfdi(facturamaId, motivo, uuid_sustitucion);

    await db.query(`
      UPDATE cfdi_emitidos
      SET estado = 'cancelado',
          motivo_cancelacion = $1,
          acuse_cancelacion = $2,
          cancelado_at = NOW(),
          cancelado_por = $3,
          updated_at = NOW()
      WHERE id = $4
    `, [motivo, acuse, req.usuario.id, req.params.id]);

    await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle, usuario_id) VALUES ($1, 'cancelado', $2, $3)`,
      [req.params.id, { motivo, acuse }, req.usuario.id]);

    res.json({ ok: true, acuse });
  } catch (e) {
    console.error('cancelar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// Descargas (con auth)
// ════════════════════════════════════════════════════════════════
router.get('/:id/xml', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`SELECT xml_bytes, serie, folio FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    if (!c || !c.xml_bytes) return res.status(404).json({ error: 'XML no disponible' });
    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${c.serie}${c.folio}.xml"`,
    });
    res.send(c.xml_bytes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/pdf', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`SELECT pdf_bytes, serie, folio FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    if (!c || !c.pdf_bytes) return res.status(404).json({ error: 'PDF no disponible' });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${c.serie}${c.folio}.pdf"`,
    });
    res.send(c.pdf_bytes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Descarga pública (con UUID como token — el cliente accede sin login)
router.get('/:id/xml-publico/:uuid', async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`SELECT xml_bytes, serie, folio, uuid_fiscal FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    if (!c || !c.xml_bytes || c.uuid_fiscal !== req.params.uuid) {
      return res.status(404).json({ error: 'XML no disponible' });
    }
    res.set({
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${c.serie}${c.folio}.xml"`,
    });
    res.send(c.xml_bytes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/pdf-publico/:uuid', async (req, res) => {
  try {
    const { rows: [c] } = await db.query(`SELECT pdf_bytes, serie, folio, uuid_fiscal FROM cfdi_emitidos WHERE id = $1`, [req.params.id]);
    if (!c || !c.pdf_bytes || c.uuid_fiscal !== req.params.uuid) {
      return res.status(404).json({ error: 'PDF no disponible' });
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${c.serie}${c.folio}.pdf"`,
    });
    res.send(c.pdf_bytes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════
// Configuración fiscal
// ════════════════════════════════════════════════════════════════
router.get('/configuracion/empresa', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'fiscal_%' OR clave LIKE 'cartaporte_%' OR clave LIKE 'cfdi_%'
      ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion/empresa', auth(['director','admin']), async (req, res) => {
  const body = req.body || {};
  try {
    let n = 0;
    for (const [k, v] of Object.entries(body)) {
      if (!k.startsWith('fiscal_') && !k.startsWith('cartaporte_') && !k.startsWith('cfdi_')) continue;
      const valor = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v ?? '');
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
