const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

// Registrar pago de nómina
router.post('/pagos', auth(['director','admin']), async (req, res) => {
  const { empleado_id, semana_inicio, sueldo_base, bonos, deducciones, anticipos_aplicados, notas } = req.body;
  if (!empleado_id || !semana_inicio || !sueldo_base) return res.status(400).json({ error: 'Faltan campos' });
  const total = parseFloat(sueldo_base) + parseFloat(bonos||0) - parseFloat(deducciones||0) - parseFloat(anticipos_aplicados||0);
  try {
    const { rows } = await db.query(
      `INSERT INTO nomina_pagos (empleado_id, semana_inicio, sueldo_base, bonos, deducciones, anticipos_aplicados, total_pago, notas, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [empleado_id, semana_inicio, sueldo_base, bonos||0, deducciones||0, anticipos_aplicados||0, total, notas, req.usuario.id]
    );
    // Si hay anticipos aplicados, marcarlos
    if (anticipos_aplicados > 0) {
      await db.query('UPDATE anticipos SET aplicado=true WHERE empleado_id=$1 AND aplicado=false', [empleado_id]);
    }
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Error al registrar pago' }); }
});

// Marcar como pagado
router.put('/pagos/:id/pagar', auth(['director','admin']), async (req, res) => {
  const { rows } = await db.query(
    'UPDATE nomina_pagos SET pagado=true, fecha_pago=CURRENT_DATE WHERE id=$1 RETURNING *',
    [req.params.id]
  );
  res.json(rows[0]);
});

// Obtener pagos de nómina
router.get('/pagos', auth(['director','admin']), async (req, res) => {
  const { semana_inicio, empleado_id } = req.query;
  let q = `SELECT np.*, e.nombre as empleado_nombre, e.puesto, e.area
           FROM nomina_pagos np
           LEFT JOIN empleados e ON np.empleado_id=e.id
           WHERE 1=1`;
  const params = [];
  if (semana_inicio) { params.push(semana_inicio); q += ` AND np.semana_inicio = $${params.length}`; }
  if (empleado_id) { params.push(empleado_id); q += ` AND np.empleado_id = $${params.length}`; }
  q += ' ORDER BY np.semana_inicio DESC, e.nombre';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Resumen nómina semanal
router.get('/resumen-semana', auth(['director','admin']), async (req, res) => {
  const { semana_inicio } = req.query;
  const si = semana_inicio || (() => {
    const d = new Date(); const day = d.getDay();
    const diff = d.getDate() - day + (day===0?-6:1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  })();
  const { rows } = await db.query(`
    SELECT 
      SUM(total_pago) as total_nomina,
      SUM(total_pago) FILTER (WHERE pagado=true) as pagado,
      SUM(total_pago) FILTER (WHERE pagado=false) as pendiente,
      COUNT(*) as empleados_en_nomina,
      SUM(bonos) as total_bonos,
      SUM(deducciones) as total_deducciones
    FROM nomina_pagos WHERE semana_inicio=$1
  `, [si]);
  res.json({ ...rows[0], semana_inicio: si });
});

// Anticipos
router.post('/anticipos', auth(['director','admin']), async (req, res) => {
  const { empleado_id, monto, fecha, motivo } = req.body;
  try {
    const { rows } = await db.query(
      'INSERT INTO anticipos (empleado_id, monto, fecha, motivo, registrado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [empleado_id, monto, fecha, motivo, req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Error al registrar anticipo' }); }
});

router.get('/anticipos', auth(['director','admin']), async (req, res) => {
  const { empleado_id, aplicado } = req.query;
  let q = `SELECT a.*, e.nombre as empleado_nombre FROM anticipos a LEFT JOIN empleados e ON a.empleado_id=e.id WHERE 1=1`;
  const params = [];
  if (empleado_id) { params.push(empleado_id); q += ` AND a.empleado_id=$${params.length}`; }
  if (aplicado !== undefined) { params.push(aplicado === 'true'); q += ` AND a.aplicado=$${params.length}`; }
  q += ' ORDER BY a.fecha DESC';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Anticipos pendientes por empleado
router.get('/anticipos/pendientes/:empleado_id', auth(['director','admin']), async (req, res) => {
  const { rows } = await db.query(
    'SELECT SUM(monto) as total FROM anticipos WHERE empleado_id=$1 AND aplicado=false',
    [req.params.empleado_id]
  );
  res.json({ total: rows[0].total || 0 });
});

module.exports = router;
