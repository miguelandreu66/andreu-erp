// Helpers compartidos para generación de PDFs con branding Andreu Logistics.

const PDFDocument = require('pdfkit');

// Paleta de marca
const COLOR = {
  navy: '#1B3A6B',
  orange: '#E87722',
  text: '#1A1A1A',
  muted: '#6b7280',
  light: '#F4F4F2',
  border: '#e5e7eb',
  red: '#dc2626',
  green: '#16a34a',
  amber: '#d97706',
};

function nuevoDoc(opts = {}) {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    info: {
      Title: opts.titulo || 'Reporte Andreu Logistics',
      Author: 'Andreu Logistics',
      Producer: 'Andreu Logistics ERP',
    },
    bufferPages: true,
  });
  return doc;
}

// Header común — barra superior con marca + título de reporte
function header(doc, { titulo, subtitulo }) {
  const w = doc.page.width;
  doc.save();
  doc.rect(0, 0, w, 70).fill(COLOR.navy);
  doc.fillColor('#fff')
     .font('Helvetica-Bold').fontSize(18).text('ANDREU LOGISTICS', 50, 22, { width: w - 100 });
  doc.font('Helvetica').fontSize(9).fillColor('#cbd5e1')
     .text('Tu carga, en las manos correctas. · Cuernavaca, Morelos', 50, 44, { width: w - 100 });

  // Right-side: fecha generación
  doc.fontSize(9).fillColor('#cbd5e1')
     .text(`Generado ${new Date().toLocaleString('es-MX')}`, 50, 22, { width: w - 100, align: 'right' });
  doc.restore();

  // Título del reporte (debajo del header)
  doc.moveDown(2);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLOR.navy).text(titulo, { width: w - 100 });
  if (subtitulo) {
    doc.font('Helvetica').fontSize(11).fillColor(COLOR.muted).text(subtitulo);
  }
  doc.moveDown(0.5);
  // línea naranja
  const y = doc.y;
  doc.strokeColor(COLOR.orange).lineWidth(2).moveTo(50, y).lineTo(w - 50, y).stroke();
  doc.moveDown(1);
  doc.strokeColor('#000').lineWidth(1).fillColor(COLOR.text);
}

// Footer común — paginación + datos de la empresa
function aplicarFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const w = doc.page.width;
    const h = doc.page.height;
    doc.save();
    doc.strokeColor(COLOR.border).lineWidth(0.5).moveTo(50, h - 50).lineTo(w - 50, h - 50).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COLOR.muted)
       .text(`Andreu Logistics · Cuernavaca, Morelos · Autotransporte federal de carga`, 50, h - 40, { width: w - 100, align: 'left', lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, 50, h - 40, { width: w - 100, align: 'right', lineBreak: false });
    doc.restore();
  }
}

// Tabla simple. cols = [{ key, label, width, align? }]
function tabla(doc, { cols, rows, emptyMsg = 'Sin datos' }) {
  const startX = 50;
  let y = doc.y + 6;
  const rowH = 18;
  const totalW = cols.reduce((s, c) => s + c.width, 0);

  // Header de tabla
  doc.save();
  doc.rect(startX, y, totalW, rowH).fill(COLOR.navy);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
  let x = startX + 6;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x, y + 5, { width: c.width - 12, align: c.align || 'left', lineBreak: false });
    x += c.width;
  }
  doc.restore();
  y += rowH;

  if (rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLOR.muted)
       .text(emptyMsg, startX, y + 10, { width: totalW, align: 'center' });
    doc.y = y + 28;
    return;
  }

  doc.font('Helvetica').fontSize(9).fillColor(COLOR.text);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Salto de página si no cabe
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 80;
    }

    // Banda zebra
    if (i % 2 === 1) {
      doc.save();
      doc.rect(startX, y, totalW, rowH).fill(COLOR.light);
      doc.restore();
      doc.fillColor(COLOR.text);
    }

    x = startX + 6;
    for (const c of cols) {
      const val = r[c.key];
      doc.text(val == null ? '—' : String(val), x, y + 5, {
        width: c.width - 12,
        align: c.align || 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += c.width;
    }
    // borde inferior fino
    doc.save().strokeColor(COLOR.border).lineWidth(0.3).moveTo(startX, y + rowH).lineTo(startX + totalW, y + rowH).stroke().restore();
    y += rowH;
  }
  doc.y = y + 10;
  doc.fillColor(COLOR.text);
}

// KPI box (3-4 por fila)
function kpiRow(doc, kpis) {
  const startX = 50;
  const w = doc.page.width - 100;
  const boxW = (w - (kpis.length - 1) * 10) / kpis.length;
  const h = 48;
  let y = doc.y;

  for (let i = 0; i < kpis.length; i++) {
    const k = kpis[i];
    const x = startX + i * (boxW + 10);
    doc.save();
    doc.roundedRect(x, y, boxW, h, 6).fillAndStroke('#fff', COLOR.border);
    doc.fillColor(COLOR.muted).font('Helvetica').fontSize(8)
       .text((k.label || '').toUpperCase(), x + 10, y + 8, { width: boxW - 20, lineBreak: false });
    doc.fillColor(k.color || COLOR.navy).font('Helvetica-Bold').fontSize(16)
       .text(k.valor, x + 10, y + 22, { width: boxW - 20, lineBreak: false });
    doc.restore();
  }
  doc.y = y + h + 10;
  doc.fillColor(COLOR.text);
}

function fmt$(n) {
  return '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
}
function fmtN(n) {
  return (parseFloat(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 });
}
function fmtPct(n) {
  return (parseFloat(n) || 0).toFixed(1) + '%';
}

module.exports = {
  COLOR, nuevoDoc, header, aplicarFooters, tabla, kpiRow,
  fmt$, fmtN, fmtPct,
};
