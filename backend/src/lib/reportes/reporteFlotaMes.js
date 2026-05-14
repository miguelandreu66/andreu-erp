const db = require('../../db');
const { nuevoDoc, header, aplicarFooters, kpiRow, tabla, fmt$, fmtN, COLOR } = require('./comun');

async function generar(yyyymm) {
  const [yyyy, mm] = (yyyymm || new Date().toISOString().slice(0, 7)).split('-');
  const fi = `${yyyy}-${mm}-01`;
  const ff = new Date(parseInt(yyyy), parseInt(mm), 0).toISOString().slice(0, 10); // último día del mes
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const nombreMes = `${meses[parseInt(mm) - 1]} ${yyyy}`;

  const { rows: [kpi] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE estado = 'Completado')::int                    AS viajes_completados,
      COALESCE(SUM(km_recorridos)  FILTER (WHERE estado='Completado'), 0)::float AS total_km,
      COALESCE(SUM(toneladas)      FILTER (WHERE estado='Completado'), 0)::float AS total_ton,
      COALESCE(SUM(diesel_litros)  FILTER (WHERE estado='Completado'), 0)::float AS total_litros,
      COALESCE(SUM(diesel_costo)   FILTER (WHERE estado='Completado'), 0)::float AS total_diesel,
      COALESCE(
        SUM(diesel_litros) FILTER (WHERE estado='Completado' AND km_recorridos > 0)
        / NULLIF(SUM(km_recorridos) FILTER (WHERE estado='Completado' AND km_recorridos > 0), 0)
      , 0)::float                                                            AS rend_flota
    FROM viajes
    WHERE fecha BETWEEN $1 AND $2
  `, [fi, ff]);

  const { rows: [ing] } = await db.query(`
    SELECT
      COALESCE(SUM(total), 0)::float AS ingresos,
      COUNT(*)::int                  AS facturas
    FROM ventas
    WHERE fecha BETWEEN $1 AND $2
  `, [fi, ff]);

  const { rows: topOps } = await db.query(`
    SELECT op.nombre, COUNT(v.id)::int AS viajes,
           COALESCE(SUM(v.km_recorridos), 0)::float AS km,
           COALESCE(SUM(v.toneladas), 0)::float AS ton
    FROM operadores op
    LEFT JOIN viajes v ON v.operador_id = op.id AND v.fecha BETWEEN $1 AND $2 AND v.estado = 'Completado'
    WHERE op.activo = true
    GROUP BY op.id, op.nombre
    HAVING COUNT(v.id) > 0
    ORDER BY viajes DESC, km DESC
    LIMIT 10
  `, [fi, ff]);

  const { rows: topRutas } = await db.query(`
    SELECT destino, COUNT(*)::int AS viajes,
           ROUND(AVG(km_recorridos)::numeric, 0)::int AS km_prom,
           COALESCE(SUM(diesel_costo), 0)::float AS diesel_total
    FROM viajes
    WHERE fecha BETWEEN $1 AND $2 AND estado = 'Completado' AND destino IS NOT NULL
    GROUP BY destino
    ORDER BY viajes DESC
    LIMIT 10
  `, [fi, ff]);

  const utilidad = ing.ingresos - kpi.total_diesel;

  const doc = nuevoDoc({ titulo: `Reporte ejecutivo ${nombreMes}` });

  header(doc, {
    titulo: `Reporte ejecutivo · ${nombreMes}`,
    subtitulo: `Operación de flota del ${fi} al ${ff}`,
  });

  // KPIs principales
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text).text('Indicadores clave');
  doc.moveDown(0.3);
  kpiRow(doc, [
    { label: 'Viajes completados', valor: kpi.viajes_completados.toString(), color: COLOR.navy },
    { label: 'KM totales', valor: fmtN(kpi.total_km), color: COLOR.navy },
    { label: 'Toneladas movidas', valor: fmtN(kpi.total_ton), color: COLOR.navy },
    { label: 'Diesel total', valor: fmt$(kpi.total_diesel), color: COLOR.red },
  ]);
  kpiRow(doc, [
    { label: 'Ingresos facturados', valor: fmt$(ing.ingresos), color: COLOR.green },
    { label: 'Utilidad estimada', valor: fmt$(utilidad), color: utilidad >= 0 ? COLOR.green : COLOR.red },
    { label: 'Rendimiento flota', valor: kpi.rend_flota.toFixed(2) + ' lt/km', color: COLOR.amber },
    { label: 'Litros consumidos', valor: fmtN(kpi.total_litros), color: COLOR.amber },
  ]);

  // Top operadores
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text).text('Top operadores del mes');
  doc.moveDown(0.3);
  tabla(doc, {
    cols: [
      { key: 'pos', label: '#', width: 30 },
      { key: 'nombre', label: 'Operador', width: 220 },
      { key: 'viajes', label: 'Viajes', width: 70, align: 'right' },
      { key: 'km', label: 'KM', width: 90, align: 'right' },
      { key: 'ton', label: 'Toneladas', width: 100, align: 'right' },
    ],
    rows: topOps.map((o, i) => ({
      pos: i + 1,
      nombre: o.nombre,
      viajes: o.viajes,
      km: fmtN(o.km),
      ton: fmtN(o.ton),
    })),
    emptyMsg: 'Sin viajes completados en este mes.',
  });

  // Top rutas
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.text).text('Top destinos del mes');
  doc.moveDown(0.3);
  tabla(doc, {
    cols: [
      { key: 'pos', label: '#', width: 30 },
      { key: 'destino', label: 'Destino', width: 240 },
      { key: 'viajes', label: 'Viajes', width: 70, align: 'right' },
      { key: 'km_prom', label: 'KM prom.', width: 80, align: 'right' },
      { key: 'diesel_total', label: 'Diesel', width: 90, align: 'right' },
    ],
    rows: topRutas.map((r, i) => ({
      pos: i + 1,
      destino: r.destino,
      viajes: r.viajes,
      km_prom: fmtN(r.km_prom),
      diesel_total: fmt$(r.diesel_total),
    })),
    emptyMsg: 'Sin destinos registrados este mes.',
  });

  aplicarFooters(doc);
  doc.end();
  return doc;
}

module.exports = { generar };
