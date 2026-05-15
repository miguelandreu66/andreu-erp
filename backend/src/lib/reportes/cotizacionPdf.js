const db = require('../../db');
const { nuevoDoc, header, aplicarFooters, kpiRow, fmt$, COLOR } = require('./comun');

async function generar(folioOId) {
  // Acepta folio (COT-2026-00001) o id numérico
  let lead;
  if (/^COT-/i.test(String(folioOId))) {
    const r = await db.query('SELECT * FROM leads WHERE folio = $1', [folioOId.toUpperCase()]);
    lead = r.rows[0];
  } else {
    const r = await db.query('SELECT * FROM leads WHERE id = $1', [parseInt(folioOId)]);
    lead = r.rows[0];
  }
  if (!lead) throw new Error('Cotización no encontrada');

  const c = lead.desglose || {};
  const precio = c.precio || {};
  const ruta = c.ruta || {};

  const doc = nuevoDoc({ titulo: `Cotización ${lead.folio}` });

  header(doc, {
    titulo: `Cotización ${lead.folio}`,
    subtitulo: `Generada ${new Date(lead.created_at).toLocaleDateString('es-MX', { dateStyle: 'long' })} · Válida 7 días`,
  });

  // Datos del cliente
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Cliente');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
  const linea = (l, v) => {
    if (!v) return;
    doc.fillColor(COLOR.muted).text(`${l}: `, { continued: true });
    doc.fillColor(COLOR.text).text(String(v));
  };
  linea('Contacto', lead.contacto_nombre);
  linea('Empresa', lead.empresa);
  linea('RFC', lead.rfc);
  linea('Email', lead.email);
  linea('Teléfono', lead.telefono);
  doc.moveDown(0.8);

  // Servicio cotizado
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Servicio solicitado');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10);
  linea('Origen', lead.origen);
  linea('Destino', lead.destino);
  linea('Distancia estimada', `${lead.distancia_km || ruta.distancia_km || '—'} km`);
  linea('Duración estimada', `${lead.duracion_horas || ruta.duracion_horas || '—'} hrs`);
  linea('Carga', `${lead.tipo_carga}${lead.toneladas ? ` · ${lead.toneladas} ton` : ''}`);
  linea('Recurrencia', lead.recurrencia);
  if (lead.fecha_solicitada) linea('Fecha solicitada', new Date(lead.fecha_solicitada).toLocaleDateString('es-MX'));
  doc.moveDown(0.6);

  // Precio destacado
  kpiRow(doc, [
    { label: 'Subtotal', valor: fmt$(precio.subtotal || lead.precio_final), color: COLOR.navy },
    { label: 'IVA 16%', valor: fmt$(precio.iva || (lead.precio_final * 0.16 / 1.16)), color: COLOR.muted },
    { label: 'TOTAL', valor: fmt$(precio.total_con_iva || lead.precio_final), color: COLOR.orange },
  ]);

  // Desglose
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Desglose de la cotización');
  doc.moveDown(0.3);

  const drawRow = (k, v, opts = {}) => {
    const y = doc.y;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.bold ? 11 : 10);
    doc.fillColor(opts.color || COLOR.text);
    doc.text(k, 50, y, { width: 300, continued: false });
    doc.text(v, 350, y, { width: 200, align: 'right' });
    doc.moveDown(0.1);
  };

  drawRow('Precio base', fmt$(precio.base || 0));
  for (const r of (precio.recargos || [])) {
    drawRow(`  + ${r.concepto} (${r.pct}%)`, `+ ${fmt$(r.monto)}`, { color: COLOR.muted });
  }
  for (const d of (precio.descuentos || [])) {
    drawRow(`  − ${d.concepto} (${d.pct}%)`, `− ${fmt$(d.monto)}`, { color: COLOR.green });
  }
  for (const e of (precio.extras || [])) {
    drawRow(`  + ${e.concepto}`, `+ ${fmt$(e.monto)}`, { color: COLOR.muted });
  }

  doc.moveDown(0.2);
  drawRow('Subtotal', fmt$(precio.subtotal || lead.precio_final), { bold: true });
  drawRow('IVA 16%', fmt$(precio.iva || 0), { color: COLOR.muted });
  drawRow('TOTAL CON IVA', fmt$(precio.total_con_iva || lead.precio_final), { bold: true, color: COLOR.orange });

  // Condiciones
  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Condiciones de servicio');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted);
  [
    `Cotización válida por 7 días naturales a partir de la fecha de emisión.`,
    `Precio sujeto a disponibilidad de flota y confirmación de fecha definitiva.`,
    `Pago: transferencia bancaria a 15 días naturales contra entrega del CFDI.`,
    `Servicio incluye: chofer con licencia federal, seguro de mercancía estándar, combustible, casetas en autopistas federales.`,
    `Servicios extras (estadía > 4hrs, maniobras, custodia armada) se facturan adicional según tarifas vigentes.`,
    `Para confirmar este servicio, responde a este correo o llama directamente con tu folio ${lead.folio}.`,
  ].forEach(t => doc.text('• ' + t, { width: doc.page.width - 100 }));

  // Datos contacto Andreu
  doc.moveDown(1);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.navy).text('Contacto Andreu Logistics');
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
  doc.text('Cuernavaca, Morelos · Autotransporte federal de carga');
  doc.text('Folio de tu cotización: ' + lead.folio);

  aplicarFooters(doc);
  doc.end();
  return doc;
}

module.exports = { generar };
