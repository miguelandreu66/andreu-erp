const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

router.post('/', auth(['director','admin','caja','logistica']), async (req, res) => {
  const { fecha, categoria, monto, comprobante, descripcion } = req.body;
  if (!fecha || !categoria || !monto) return res.status(400).json({ error: 'Faltan campos requeridos' });
  const estado = req.usuario.rol === 'director' || req.usuario.rol === 'admin' ? 'aprobado' : 'pendiente';
  try {
    const { rows } = await db.query(
      `INSERT INTO gastos (fecha, categoria, monto, comprobante, descripcion, estado_aprobacion, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fecha, categoria, monto, comprobante||false, descripcion, estado, req.usuario.id]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Error al registrar gasto' }); }
});

router.get('/', auth(), async (req, res) => {
  const { fecha_inicio, fecha_fin, categoria, estado_aprobacion } = req.query;
  let q = `SELECT g.*, u.nombre as registrado_nombre, a.nombre as aprobado_nombre
           FROM gastos g
           LEFT JOIN usuarios u ON g.registrado_por=u.id
           LEFT JOIN usuarios a ON g.aprobado_por=a.id
           WHERE 1=1`;
  const params = [];
  if (fecha_inicio) { params.push(fecha_inicio); q += ` AND g.fecha >= $${params.length}`; }
  if (fecha_fin) { params.push(fecha_fin); q += ` AND g.fecha <= $${params.length}`; }
  if (categoria) { params.push(categoria); q += ` AND g.categoria = $${params.length}`; }
  if (estado_aprobacion) { params.push(estado_aprobacion); q += ` AND g.estado_aprobacion = $${params.length}`; }
  q += ' ORDER BY g.fecha DESC, g.created_at DESC LIMIT 500';
  const { rows } = await db.query(q, params);
  res.json(rows);
});

// Aprobar / rechazar gasto
router.put('/:id/aprobar', auth(['director','admin']), async (req, res) => {
  const { accion } = req.body; // 'aprobado' o 'rechazado'
  const { rows } = await db.query(
    'UPDATE gastos SET estado_aprobacion=$1, aprobado_por=$2 WHERE id=$3 RETURNING *',
    [accion, req.usuario.id, req.params.id]
  );
  res.json(rows[0]);
});

// Resumen por categoría en semana
router.get('/resumen-semana', auth(), async (req, res) => {
  const { semana_inicio } = req.query;
  const si = semana_inicio || (() => {
    const d = new Date(); const day = d.getDay();
    const diff = d.getDate() - day + (day===0?-6:1);
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
  })();
  const sf = new Date(new Date(si).getTime() + 6*24*60*60*1000).toISOString().split('T')[0];
  const { rows } = await db.query(`
    SELECT categoria, SUM(monto) as total, COUNT(*) as ops,
           COUNT(*) FILTER (WHERE comprobante=false) as sin_comprobante
    FROM gastos WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion != 'rechazado'
    GROUP BY categoria ORDER BY SUM(monto) DESC
  `, [si, sf]);
  const totales = await db.query(
    'SELECT SUM(monto) as total FROM gastos WHERE fecha BETWEEN $1 AND $2 AND estado_aprobacion != $3',
    [si, sf, 'rechazado']
  );
  res.json({ por_categoria: rows, total: totales.rows[0].total || 0 });
});

router.delete('/:id', auth(['director','admin']), async (req, res) => {
  await db.query('DELETE FROM gastos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
