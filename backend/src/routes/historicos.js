const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Comparativo semana actual vs semana anterior
router.get('/semanas', auth(), async (req, res) => {
  const d = new Date();
  const day = d.getDay();
  const siActual = new Date(new Date().setDate(d.getDate() - day + (day===0?-6:1))).toISOString().split('T')[0];
  const sfActual = new Date(new Date(siActual).getTime() + 6*24*60*60*1000).toISOString().split('T')[0];
  const siAnterior = new Date(new Date(siActual).getTime() - 7*24*60*60*1000).toISOString().split('T')[0];
  const sfAnterior = new Date(new Date(siAnterior).getTime() + 6*24*60*60*1000).toISOString().split('T')[0];

  const [actual, anterior] = await Promise.all([
    db.query(`SELECT
      COALESCE(SUM(v.monto),0) as ventas,
      COALESCE((SELECT SUM(monto) FROM gastos WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion!='rechazado'),0) as gastos,
      (SELECT COUNT(*) FROM viajes WHERE fecha BETWEEN $1 AND $2 AND estado='Completado') as viajes,
      (SELECT COALESCE(SUM(diesel_costo),0) FROM viajes WHERE fecha BETWEEN $1 AND $2) as diesel
      FROM ventas v WHERE v.fecha BETWEEN $1 AND $2`, [siActual, sfActual]),
    db.query(`SELECT
      COALESCE(SUM(v.monto),0) as ventas,
      COALESCE((SELECT SUM(monto) FROM gastos WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion!='rechazado'),0) as gastos,
      (SELECT COUNT(*) FROM viajes WHERE fecha BETWEEN $1 AND $2 AND estado='Completado') as viajes,
      (SELECT COALESCE(SUM(diesel_costo),0) FROM viajes WHERE fecha BETWEEN $1 AND $2) as diesel
      FROM ventas v WHERE v.fecha BETWEEN $1 AND $2`, [siAnterior, sfAnterior])
  ]);

  const a = actual.rows[0]; const ant = anterior.rows[0];
  const delta = (a, b) => b > 0 ? (((a - b) / b) * 100).toFixed(1) : 0;

  res.json({
    actual: { ...a, semana_inicio: siActual },
    anterior: { ...ant, semana_inicio: siAnterior },
    deltas: {
      ventas: delta(parseFloat(a.ventas), parseFloat(ant.ventas)),
      gastos: delta(parseFloat(a.gastos), parseFloat(ant.gastos)),
      viajes: delta(parseInt(a.viajes), parseInt(ant.viajes)),
    }
  });
});

// Ventas por mes — últimos 6 meses
router.get('/mensual', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') as mes,
      TO_CHAR(fecha, 'Mon YY') as mes_label,
      SUM(monto) as ventas,
      COUNT(*) as operaciones
    FROM ventas
    WHERE fecha >= NOW() - INTERVAL '6 months'
    GROUP BY TO_CHAR(fecha, 'YYYY-MM'), TO_CHAR(fecha, 'Mon YY')
    ORDER BY mes
  `);
  const { rows: gastosMes } = await db.query(`
    SELECT
      TO_CHAR(fecha, 'YYYY-MM') as mes,
      SUM(monto) as gastos
    FROM gastos
    WHERE fecha >= NOW() - INTERVAL '6 months'
    AND estado_aprobacion != 'rechazado'
    GROUP BY TO_CHAR(fecha, 'YYYY-MM')
    ORDER BY mes
  `);

  const combinado = rows.map(r => ({
    ...r,
    gastos: parseFloat(gastosMes.find(g => g.mes === r.mes)?.gastos || 0),
    utilidad: parseFloat(r.ventas) - parseFloat(gastosMes.find(g => g.mes === r.mes)?.gastos || 0)
  }));
  res.json(combinado);
});

// Ventas por producto — histórico
router.get('/por-producto', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      producto,
      SUM(monto) as total,
      COUNT(*) as operaciones,
      AVG(monto) as ticket_promedio,
      MAX(fecha) as ultima_venta
    FROM ventas
    WHERE fecha >= NOW() - INTERVAL '30 days'
    GROUP BY producto
    ORDER BY total DESC
  `);
  res.json(rows);
});

// Viajes por semana — últimas 8 semanas
router.get('/viajes-semanas', auth(), async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      DATE_TRUNC('week', fecha) as semana,
      COUNT(*) FILTER (WHERE estado='Completado') as completados,
      SUM(diesel_costo) as costo_diesel,
      COUNT(DISTINCT operador_id) as operadores_activos
    FROM viajes
    WHERE fecha >= NOW() - INTERVAL '8 weeks'
    GROUP BY DATE_TRUNC('week', fecha)
    ORDER BY semana
  `);
  res.json(rows.map(r => ({
    ...r,
    semana_label: new Date(r.semana).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
  })));
});

// Margen por semana — últimas 8 semanas
router.get('/margen-semanas', auth(), async (req, res) => {
  const { rows: ventasSem } = await db.query(`
    SELECT DATE_TRUNC('week', fecha) as semana, SUM(monto) as ventas
    FROM ventas WHERE fecha >= NOW() - INTERVAL '8 weeks'
    GROUP BY DATE_TRUNC('week', fecha) ORDER BY semana
  `);
  const { rows: gastosSem } = await db.query(`
    SELECT DATE_TRUNC('week', fecha) as semana, SUM(monto) as gastos
    FROM gastos WHERE fecha >= NOW() - INTERVAL '8 weeks' AND estado_aprobacion!='rechazado'
    GROUP BY DATE_TRUNC('week', fecha) ORDER BY semana
  `);

  const combinado = ventasSem.map(v => {
    const g = gastosSem.find(g => g.semana.getTime() === v.semana.getTime());
    const ventas = parseFloat(v.ventas);
    const gastos = parseFloat(g?.gastos || 0);
    const margen = ventas > 0 ? ((ventas - gastos) / ventas * 100).toFixed(1) : 0;
    return {
      semana_label: new Date(v.semana).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }),
      ventas, gastos, margen: parseFloat(margen)
    };
  });
  res.json(combinado);
});

module.exports = router;
