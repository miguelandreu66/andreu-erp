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

// Actualizar estado
router.put('/:id/estado', auth(['director','admin','logistica']), async (req, res) => {
  const { estado } = req.body;
  const { rows } = await db.query('UPDATE viajes SET estado=$1 WHERE id=$2 RETURNING *', [estado, req.params.id]);
  res.json(rows[0]);
});

// Eliminar
router.delete('/:id', auth(['director','admin']), async (req, res) => {
  await db.query('DELETE FROM viajes WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
