const db = require('../../db');
const { nuevoDoc, header, aplicarFooters, tabla, kpiRow, fmt$, COLOR } = require('./comun');

async function generar(clienteId, { desde, hasta } = {}) {
  const fechaFin = hasta || new Date().toISOString().slice(0, 10);
  const fechaInicio = desde || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const { rows: [cliente] } = await db.query('SELECT * FROM clientes WHERE id = $1', [clienteId]);
  if (!cliente) throw new Error('Cliente no encontrado');

  // Facturas/ventas en periodo
  const { rows: ventas } = await db.query(`
    SELECT id, fecha, fecha_vencimiento, total, estado_pago, tipo_pago
    FROM ventas
    WHERE cliente_id = $1 AND fecha BETWEEN $2 AND $3
    ORDER BY fecha DESC
  `, [clienteId, fechaInicio, fechaFin]);

  // Resumen
  const totalFacturado = ventas.reduce((s, v) => s + parseFloat(v.total || 0), 0);
  const pagado = ventas.filter(v => v.estado_pago === 'pagado').reduce((s, v) => s + parseFloat(v.total || 0), 0);
  const saldo = totalFacturado - pagado;
  const vencidas = ventas.filter(v =>
    v.estado_pago !== 'pagado' &&
    v.fecha_vencimiento &&
    new Date(v.fecha_vencimiento) < new Date()
  );
  const montoVencido = vencidas.reduce((s, v) => s + parseFloat(v.total || 0), 0);

  const doc = nuevoDoc({ titulo: `Estado de cuenta · ${cliente.nombre}` });

  header(doc, {
    titulo: 'Estado de cuenta',
    subtitulo: `${cliente.nombre} · Período ${fechaInicio} a ${fechaFin}`,
  });

  // Datos del cliente
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.text).text('Cliente');
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.muted);
  if (cliente.telefono) doc.text(`Tel: ${cliente.telefono}`);
  if (cliente.direccion) doc.text(`Dirección: ${cliente.direccion}`);
  if (cliente.tipo) doc.text(`Tipo: ${cliente.tipo}`);
  doc.moveDown(1);

  // KPIs
  kpiRow(doc, [
    { label: 'Total facturado', valor: fmt$(totalFacturado), color: COLOR.navy },
    { label: 'Pagado', valor: fmt$(pagado), color: COLOR.green },
    { label: 'Saldo pendiente', valor: fmt$(saldo), color: saldo > 0 ? COLOR.amber : COLOR.green },
    { label: 'Vencido', valor: fmt$(montoVencido), color: montoVencido > 0 ? COLOR.red : COLOR.muted },
  ]);

  // Tabla de facturas
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text).text('Movimientos del período');
  doc.moveDown(0.3);

  tabla(doc, {
    cols: [
      { key: 'fecha', label: 'Fecha', width: 80 },
      { key: 'id', label: 'Folio', width: 60 },
      { key: 'total', label: 'Total', width: 90, align: 'right' },
      { key: 'estado_pago', label: 'Estado', width: 90 },
      { key: 'fecha_vencimiento', label: 'Vence', width: 80 },
      { key: 'vencido', label: '', width: 110 },
    ],
    rows: ventas.map(v => {
      const venc = v.fecha_vencimiento && new Date(v.fecha_vencimiento) < new Date() && v.estado_pago !== 'pagado';
      return {
        fecha: v.fecha?.toISOString?.().slice(0, 10) || v.fecha,
        id: '#' + v.id,
        total: fmt$(v.total),
        estado_pago: v.estado_pago === 'pagado' ? '✓ Pagado' : 'Pendiente',
        fecha_vencimiento: v.fecha_vencimiento?.toISOString?.().slice(0, 10) || v.fecha_vencimiento || '—',
        vencido: venc ? '⚠ VENCIDA' : '',
      };
    }),
    emptyMsg: 'Sin facturas en el período seleccionado.',
  });

  // Nota al final
  if (montoVencido > 0) {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.red)
       .text(`⚠ Cobranza vencida: ${fmt$(montoVencido)}`, { width: doc.page.width - 100 });
    doc.font('Helvetica').fontSize(9).fillColor(COLOR.muted)
       .text(`Te pedimos atender estos pagos a la brevedad. Para aclaraciones, contáctanos.`, { width: doc.page.width - 100 });
  }

  aplicarFooters(doc);
  doc.end();
  return doc;
}

module.exports = { generar };
