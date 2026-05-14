const db = require('../../db');
const { nuevoDoc, header, aplicarFooters, kpiRow, fmt$, fmtN, COLOR } = require('./comun');

async function generar(viajeId) {
  const { rows: [v] } = await db.query(`
    SELECT
      v.*, u.placas, u.descripcion AS unidad_desc, u.marca, u.modelo,
      op.nombre AS operador_nombre, op.licencia AS operador_licencia,
      op.telefono AS operador_telefono
    FROM viajes v
    LEFT JOIN unidades u ON u.id = v.unidad_id
    LEFT JOIN operadores op ON op.id = v.operador_id
    WHERE v.id = $1
  `, [viajeId]);
  if (!v) throw new Error('Viaje no encontrado');

  const rendimiento = v.km_recorridos > 0 && v.diesel_litros > 0
    ? (parseFloat(v.diesel_litros) / parseFloat(v.km_recorridos)).toFixed(3)
    : null;

  const doc = nuevoDoc({ titulo: `Comprobante de viaje #${v.id}` });

  header(doc, {
    titulo: `Comprobante de viaje #${v.id}`,
    subtitulo: `${v.origen || 'Origen'} → ${v.destino} · ${v.fecha?.toISOString?.().slice(0, 10) || v.fecha}`,
  });

  // Datos del viaje
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Detalle');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.text);
  const linea = (label, valor) => {
    doc.fillColor(COLOR.muted).text(`${label}: `, { continued: true });
    doc.fillColor(COLOR.text).text(valor || '—');
  };
  linea('Origen', v.origen);
  linea('Destino', v.destino);
  linea('Carga', v.carga);
  linea('Toneladas', v.toneladas != null ? fmtN(v.toneladas) + ' t' : null);
  linea('Estado', v.estado);
  linea('Fecha', v.fecha?.toISOString?.().slice(0, 10) || v.fecha);
  doc.moveDown(0.6);

  // Unidad y operador
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Unidad asignada');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10);
  linea('Placas', v.placas);
  linea('Descripción', v.unidad_desc);
  linea('Marca/Modelo', v.marca ? `${v.marca} ${v.modelo || ''}`.trim() : null);
  doc.moveDown(0.6);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Operador');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10);
  linea('Nombre', v.operador_nombre);
  linea('Licencia federal', v.operador_licencia);
  linea('Teléfono', v.operador_telefono);
  doc.moveDown(1);

  // KPIs operativos
  kpiRow(doc, [
    { label: 'Km recorridos', valor: fmtN(v.km_recorridos || 0) + ' km', color: COLOR.navy },
    { label: 'Diesel consumido', valor: fmtN(v.diesel_litros || 0) + ' L', color: COLOR.amber },
    { label: 'Costo diesel', valor: fmt$(v.diesel_costo), color: COLOR.red },
    { label: 'Rendimiento', valor: rendimiento ? `${rendimiento} lt/km` : '—', color: COLOR.navy },
  ]);

  // Notas
  if (v.notas) {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Notas');
    doc.font('Helvetica').fontSize(10).fillColor(COLOR.muted).text(v.notas);
  }

  // Sello
  doc.moveDown(2);
  const w = doc.page.width;
  doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLOR.muted)
     .text('Este comprobante es informativo, no constituye factura fiscal. Para CFDI 4.0 con Carta Porte 3.1, contacte a administración.',
       50, doc.y, { width: w - 100, align: 'center' });

  aplicarFooters(doc);
  doc.end();
  return doc;
}

module.exports = { generar };
