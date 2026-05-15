const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Registrar viaje
router.post('/', auth(['director','admin','logistica']), async (req, res) => {
  const { fecha, operador_id, unidad_id, origen, destino, carga,
          diesel_litros, diesel_costo, km_recorridos, toneladas, estado, notas } = req.body;
  if (!fecha || !operador_id || !destino) return res.status(400).json({ error: 'Faltan campos requeridos' });
  try {
    const { rows } = await db.query(
      `INSERT INTO viajes
         (fecha, operador_id, unidad_id, origen, destino, carga,
          diesel_litros, diesel_costo, km_recorridos, toneladas, estado, notas, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [fecha, operador_id, unidad_id||null, origen||null, destino,
       carga, diesel_litros||0, diesel_costo||0,
       km_recorridos||0, toneladas||0, estado||'Completado', notas||null, req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('registrar viaje:', e.message);
    res.status(500).json({ error: 'Error al registrar viaje' });
  }
});

// Obtener viajes
router.get('/', auth(), async (req, res) => {
  const { fecha_inicio, fecha_fin, operador_id, estado } = req.query;
  let q = `SELECT v.*, o.nombre as operador_nombre, u.placas as unidad_placas
           FROM viajes v 
           LEFT JOIN operadores o ON v.operador_id=o.id
           LEFT JOIN unidades u ON v.unidad_id=u.id
           WHERE 1=1`;
  const params = [];
  if (fecha_inicio) { params.push(fecha_inicio); q += ` AND v.fecha >= $${params.length}`; }
  if (fecha_fin) { params.push(fecha_fin); q += ` AND v.fecha <= $${params.length}`; }
  if (operador_id) { params.push(operador_id); q += ` AND v.operador_id = $${params.length}`; }
  if (estado) { params.push(estado); q += ` AND v.estado = $${params.length}`; }
  q += ' ORDER BY v.fecha DESC, v.created_at DESC LIMIT 500';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Rendimiento por operador en semana
router.get('/rendimiento-semana', auth(), async (req, res) => {
  const { semana_inicio } = req.query;
  const si = semana_inicio || (() => {
    const d = new Date(); const day = d.getDay();
    const diff = d.getDate() - day + (day===0?-6:1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  })();
  const sf = new Date(new Date(si).getTime() + 6*24*60*60*1000).toISOString().split('T')[0];
  const { rows } = await db.query(`
    SELECT 
      o.nombre as operador,
      COUNT(*) FILTER (WHERE v.estado='Completado') as completados,
      COUNT(*) as total,
      SUM(v.diesel_litros) as diesel_litros,
      SUM(v.diesel_costo) as diesel_costo
    FROM viajes v
    LEFT JOIN operadores o ON v.operador_id=o.id
    WHERE v.fecha BETWEEN $1 AND $2
    GROUP BY o.nombre ORDER BY completados DESC
  `, [si, sf]);
  res.json({ operadores: rows, semana_inicio: si, semana_fin: sf });
});

// Actualizar estado — con hook a Auto-CFDI si está activo
router.put('/:id/estado', auth(['director','admin','logistica']), async (req, res) => {
  const { estado } = req.body;
  const { rows } = await db.query('UPDATE viajes SET estado=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [estado, req.params.id]);
  const viaje = rows[0];
  if (!viaje) return res.status(404).json({ error: 'Viaje no encontrado' });

  res.json(viaje);

  // ── Auto-emisión CFDI cuando viaje pasa a Completado ──
  if (estado === 'Completado' && !viaje.facturado && viaje.cliente_id) {
    // Fire-and-forget (no bloquea response)
    (async () => {
      try {
        const { rows: [{ valor: autoEmitir }] } = await db.query(
          `SELECT valor FROM configuracion_empresa WHERE clave = 'cfdi_auto_emitir'`
        );
        if (autoEmitir !== 'true') return;

        // Verificar que el cliente tenga datos fiscales mínimos
        const { rows: [cliente] } = await db.query(
          `SELECT rfc_fiscal, razon_social FROM clientes WHERE id = $1`, [viaje.cliente_id]
        );
        if (!cliente?.rfc_fiscal || !cliente?.razon_social) {
          console.warn(`[Auto-CFDI] Viaje ${viaje.id}: cliente ${viaje.cliente_id} sin RFC/razón social, omitiendo`);
          return;
        }
        if (!viaje.monto_cobrado_cliente || parseFloat(viaje.monto_cobrado_cliente) <= 0) {
          console.warn(`[Auto-CFDI] Viaje ${viaje.id}: sin monto cobrado, omitiendo`);
          return;
        }

        // Llamar internamente al builder y emitir
        const facturama = require('../lib/fiscal/facturama');
        const builder = require('../lib/fiscal/cfdiBuilder');
        const envio = require('../lib/fiscal/envioCliente');

        if (!await facturama.isAvailable()) {
          console.warn(`[Auto-CFDI] Facturama no configurado`);
          return;
        }

        // Cargar relacionados
        const { rows: [unidad] } = await db.query('SELECT * FROM unidades WHERE id = $1', [viaje.unidad_id || 0]);
        const { rows: [operador] } = await db.query('SELECT * FROM operadores WHERE id = $1', [viaje.operador_id || 0]);

        const { payload, valorUnitarioSinIva, importeIva } = await builder.construirPayload({
          viaje, cliente, unidad: unidad || null, operador: operador || null,
        });

        const { rows: [{ valor: serie }] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'fiscal_serie_cfdi'`);
        const { rows: [{ siguiente_folio_cfdi: folio }] } = await db.query(`SELECT siguiente_folio_cfdi($1)`, [serie || 'A']);
        const { modo } = await facturama.getModoUrl();

        const { rows: [cfdiRow] } = await db.query(`
          INSERT INTO cfdi_emitidos
            (viaje_id, cliente_id, serie, folio, tipo_comprobante, forma_pago, metodo_pago, uso_cfdi,
             moneda, subtotal, total_iva, total,
             receptor_rfc, receptor_razon_social, receptor_regimen, receptor_cp, receptor_email,
             tiene_carta_porte, origen_cp, destino_cp, distancia_km, peso_bruto_kg,
             estado, pac_proveedor, pac_modo, emitido_por)
          VALUES ($1,$2,$3,$4,'I',$5,$6,$7,$8,$9,$10,$11,
                  $12,$13,$14,$15,$16,
                  $17,$18,$19,$20,$21,
                  'emitiendo','facturama',$22,$23)
          RETURNING id
        `, [
          viaje.id, viaje.cliente_id, serie || 'A', folio,
          payload.PaymentForm, payload.PaymentMethod, payload.Receiver.CfdiUse,
          payload.Currency, valorUnitarioSinIva, importeIva, valorUnitarioSinIva + importeIva,
          cliente.rfc_fiscal, cliente.razon_social, cliente.regimen_fiscal,
          cliente.codigo_postal_fiscal, cliente.email_facturacion || null,
          !!payload.Complemento, viaje.origen_codigo_postal, viaje.destino_codigo_postal,
          viaje.distancia_km, viaje.peso_bruto_total_kg,
          modo, null,
        ]);
        const cfdiId = cfdiRow.id;

        const resp = await facturama.emitirCfdi(payload);
        const uuid = resp.Complement?.TaxStamp?.Uuid || resp.Id || null;
        const facturamaId = resp.Id || null;

        let xmlBuf = null, pdfBuf = null;
        if (facturamaId) {
          try { xmlBuf = await facturama.descargarXml(facturamaId); } catch {}
          try { pdfBuf = await facturama.descargarPdf(facturamaId); } catch {}
        }

        await db.query(`
          UPDATE cfdi_emitidos SET estado = 'emitido', uuid_fiscal = $1, fecha_emision = NOW(),
            pac_respuesta = $2, xml_bytes = $3, pdf_bytes = $4, updated_at = NOW()
          WHERE id = $5
        `, [uuid, resp, xmlBuf, pdfBuf, cfdiId]);

        await db.query(`UPDATE viajes SET facturado = true, cfdi_id = $1 WHERE id = $2`, [cfdiId, viaje.id]);

        await db.query(`INSERT INTO cfdi_eventos (cfdi_id, evento, detalle) VALUES ($1, 'auto_emitido', $2)`,
          [cfdiId, { trigger: 'viaje_completado', viaje_id: viaje.id, uuid }]);

        // Enviar al cliente si auto-envío
        const { rows: [{ valor: autoEnv }] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'cfdi_auto_enviar_cliente'`);
        if (autoEnv === 'true') {
          try { await envio.enviarCfdiACliente(cfdiId); }
          catch (e) { console.warn(`[Auto-CFDI] envío cliente falló: ${e.message}`); }
        }
        console.log(`[Auto-CFDI] Viaje ${viaje.id} → CFDI ${cfdiId} (UUID ${uuid?.slice(0, 8)}...)`);
      } catch (e) {
        console.error(`[Auto-CFDI] Viaje ${viaje.id} falló:`, e.message);
      }
    })();
  }
});

// Eliminar
router.delete('/:id', auth(['director','admin']), async (req, res) => {
  await db.query('DELETE FROM viajes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
