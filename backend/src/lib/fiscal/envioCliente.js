// ════════════════════════════════════════════════════════════════
// Envío automático de CFDI al cliente (email + WhatsApp)
// ════════════════════════════════════════════════════════════════

const db = require('../../db');
const mail = require('../canales/email');
const wa = require('../canales/whatsapp');

function plantillaEmailCfdi({ cliente_nombre, folio_completo, uuid, monto_total, ruta, fecha_emision, link_pdf, link_xml }) {
  const fmt$ = n => '$' + parseFloat(n).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:#fff;padding:28px;">
      <h1 style="margin:0;font-size:24px;">📄 Tu factura está lista</h1>
      <p style="margin:6px 0 0;opacity:0.9;">Andreu Logistics · CFDI 4.0 + Carta Porte 3.0</p>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="font-size:16px;margin:0 0 14px;">Hola <strong>${cliente_nombre}</strong>,</p>
      <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 20px;">
        Adjunto encontrarás la factura del servicio que te brindamos. Te la enviamos en formato XML (para tu contabilidad) y PDF (para tu visualización).
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin-bottom:20px;">
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Folio</div>
          <div style="font-size:16px;font-weight:700;color:#16a34a;">${folio_completo}</div>
        </td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">UUID Fiscal SAT</div>
          <div style="font-size:13px;font-family:monospace;color:#1A1A1A;">${uuid || '—'}</div>
        </td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;">Servicio</div>
          <div style="font-size:14px;color:#1A1A1A;">${ruta}</div>
        </td></tr>
        <tr><td style="padding:14px 18px;background:#f0fdf4;">
          <div style="font-size:11px;color:#15803d;text-transform:uppercase;font-weight:600;">Total facturado</div>
          <div style="font-size:28px;font-weight:800;color:#15803d;">${fmt$(monto_total)}</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding-bottom:8px;">
          ${link_pdf ? `<a href="${link_pdf}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;margin:4px;">📄 Descargar PDF</a>` : ''}
          ${link_xml ? `<a href="${link_xml}" style="display:inline-block;background:#1B3A6B;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;margin:4px;">📋 Descargar XML</a>` : ''}
        </td></tr>
      </table>

      <p style="font-size:13px;color:#6b7280;line-height:1.6;margin:20px 0 0;text-align:center;">
        Esta factura es válida ante el SAT. Conserva el XML para tu contabilidad.<br>
        Cualquier duda, responde este correo. Gracias por confiar en Andreu Logistics. 🚚
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Envía CFDI al cliente por los canales configurados.
 */
async function enviarCfdiACliente(cfdiId) {
  const { rows: [cfdi] } = await db.query(`
    SELECT c.*, cl.nombre AS cliente_nombre, cl.email AS cliente_email,
           cl.email_facturacion, cl.telefono AS cliente_telefono,
           v.origen, v.destino
    FROM cfdi_emitidos c
    LEFT JOIN clientes cl ON cl.id = c.cliente_id
    LEFT JOIN viajes v ON v.id = c.viaje_id
    WHERE c.id = $1
  `, [cfdiId]);

  if (!cfdi) throw new Error('CFDI no encontrado');
  if (cfdi.estado !== 'emitido' && cfdi.estado !== 'enviado') {
    throw new Error(`CFDI no está emitido (estado: ${cfdi.estado})`);
  }

  // Leer config de canales
  const { rows: cfgs } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave IN ('cfdi_canales_envio')
  `);
  const cfg = Object.fromEntries(cfgs.map(c => [c.clave, c.valor]));
  const canales = (cfg.cfdi_canales_envio || 'email').split(',').map(s => s.trim());

  const baseUrl = process.env.BACKEND_URL || 'https://andreu-erp-production.up.railway.app';
  const linkPdf = `${baseUrl}/api/cfdi/${cfdi.id}/pdf-publico/${cfdi.uuid_fiscal}`;
  const linkXml = `${baseUrl}/api/cfdi/${cfdi.id}/xml-publico/${cfdi.uuid_fiscal}`;

  const emailDestino = cfdi.cliente_email_facturacion || cfdi.cliente_email || cfdi.receptor_email;
  const folioCompleto = `${cfdi.serie}${cfdi.folio}`;
  const ruta = cfdi.origen && cfdi.destino ? `${cfdi.origen} → ${cfdi.destino}` : '—';

  const resultados = { email: null, whatsapp: null };

  // Email
  if (canales.includes('email') && emailDestino) {
    try {
      if (!(await mail.isAvailable())) {
        resultados.email = { ok: false, motivo: 'sendgrid_no_disponible' };
      } else {
        const html = plantillaEmailCfdi({
          cliente_nombre: cfdi.cliente_nombre || cfdi.receptor_razon_social,
          folio_completo: folioCompleto,
          uuid: cfdi.uuid_fiscal,
          monto_total: cfdi.total,
          ruta,
          fecha_emision: cfdi.fecha_emision,
          link_pdf: linkPdf,
          link_xml: linkXml,
        });
        const r = await mail.enviar({
          to: emailDestino,
          subject: `Factura Andreu Logistics — ${folioCompleto} (UUID ${cfdi.uuid_fiscal?.slice(0, 8) || '...'}...)`,
          html,
          text: `Tu factura ${folioCompleto} por $${parseFloat(cfdi.total).toLocaleString('es-MX')} ya está disponible. Descarga PDF: ${linkPdf} | XML: ${linkXml}`,
        });
        resultados.email = { ok: true, id_externo: r.id_externo };
      }
    } catch (e) {
      resultados.email = { ok: false, error: e.message };
    }
  }

  // WhatsApp
  if (canales.includes('whatsapp') && cfdi.cliente_telefono) {
    try {
      if (!(await wa.isAvailable())) {
        resultados.whatsapp = { ok: false, motivo: 'twilio_no_disponible' };
      } else {
        const tel = wa.normalizarTelefono(cfdi.cliente_telefono);
        const body = `📄 *Factura Andreu Logistics*\n\nFolio: *${folioCompleto}*\nUUID: ${cfdi.uuid_fiscal}\nTotal: *$${parseFloat(cfdi.total).toLocaleString('es-MX')}*\n\nDescarga:\n📄 PDF: ${linkPdf}\n📋 XML: ${linkXml}\n\n¡Gracias por preferirnos! 🚚`;
        const r = await wa.enviar({ to: tel, body });
        resultados.whatsapp = { ok: true, id_externo: r.id_externo };
      }
    } catch (e) {
      resultados.whatsapp = { ok: false, error: e.message };
    }
  }

  // Actualizar registro
  const exito = (resultados.email?.ok || resultados.whatsapp?.ok);
  if (exito) {
    const canalesExito = [];
    if (resultados.email?.ok) canalesExito.push('email');
    if (resultados.whatsapp?.ok) canalesExito.push('whatsapp');
    await db.query(`
      UPDATE cfdi_emitidos
      SET enviado_cliente = true,
          enviado_cliente_at = NOW(),
          enviado_canales = $1,
          estado = CASE WHEN estado = 'emitido' THEN 'enviado' ELSE estado END,
          updated_at = NOW()
      WHERE id = $2
    `, [canalesExito, cfdiId]);

    await db.query(`
      INSERT INTO cfdi_eventos (cfdi_id, evento, detalle)
      VALUES ($1, 'enviado_cliente', $2)
    `, [cfdiId, { canales: canalesExito, resultados }]);
  }

  return { ok: exito, resultados };
}

module.exports = { enviarCfdiACliente };
