const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');
const asignador = require('../lib/commandAi/asignadorIA');

const ROLES_LECTURA = ['director','admin','logistica'];
const ROLES_DECIDE  = ['director','admin'];

// Dashboard
router.get('/dashboard', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows: [resumen] } = await db.query(`SELECT * FROM asignador_resumen`);
    const { rows: pendientes } = await db.query(`
      SELECT v.*, c.nombre AS cliente_nombre
      FROM viajes v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE (v.operador_id IS NULL OR v.unidad_id IS NULL)
        AND v.estado NOT IN ('Cancelado','Completado')
        AND v.transportista_externo_id IS NULL
        AND v.fecha >= CURRENT_DATE - INTERVAL '30 days'
      ORDER BY v.fecha ASC
      LIMIT 30
    `);
    const { rows: [{ valor: activo }] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'asignador_activo'`);
    const { rows: [{ valor: autoApr }] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'asignador_auto_aprobar'`);
    res.json({
      resumen, viajes_sin_asignar: pendientes,
      activo: activo === 'true',
      auto_aprobar: autoApr === 'true',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sugerir asignación para un viaje
router.post('/sugerir/:viaje_id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const r = await asignador.sugerirAsignacion(req.params.viaje_id, { leadId: req.body?.lead_id });
    res.json(r);
  } catch (e) {
    console.error('asignador sugerir:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Aplicar asignación
router.post('/:id/aplicar', auth(ROLES_DECIDE), async (req, res) => {
  try {
    const r = await asignador.aplicarAsignacion(req.params.id, { aprobadaPorUsuario: req.usuario.id });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rechazar asignación
router.post('/:id/rechazar', auth(ROLES_DECIDE), async (req, res) => {
  const { motivo } = req.body || {};
  try {
    const { rows: [a] } = await db.query(`
      UPDATE asignaciones_ia
      SET estado = 'rechazada', motivo_rechazo = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *
    `, [motivo || 'Sin motivo', req.params.id]);
    if (!a) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true, asignacion: a });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Historial
router.get('/historial', auth(ROLES_LECTURA), async (req, res) => {
  const { tipo, estado, limit = 50 } = req.query;
  const where = []; const params = [];
  if (tipo) { params.push(tipo); where.push(`a.tipo_operacion = $${params.length}`); }
  if (estado) { params.push(estado); where.push(`a.estado = $${params.length}`); }
  params.push(Math.min(parseInt(limit) || 50, 200));
  try {
    const { rows } = await db.query(`
      SELECT a.*,
             v.origen, v.destino, v.fecha AS viaje_fecha, v.tipo_carga,
             o.nombre AS operador_nombre,
             u.placa AS unidad_placa,
             t.razon_social AS transportista_razon_social
      FROM asignaciones_ia a
      LEFT JOIN viajes v ON v.id = a.viaje_id
      LEFT JOIN operadores o ON o.id = a.operador_id
      LEFT JOIN unidades u ON u.id = a.unidad_id
      LEFT JOIN transportistas_externos t ON t.id = a.transportista_externo_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Detalle de una asignación
router.get('/:id', auth(ROLES_LECTURA), async (req, res) => {
  try {
    const { rows: [a] } = await db.query(`
      SELECT a.*,
             v.origen, v.destino, v.fecha AS viaje_fecha, v.tipo_carga, v.toneladas,
             v.precio_final, c.nombre AS cliente_nombre,
             o.nombre AS operador_nombre, o.telefono AS operador_telefono,
             u.placa AS unidad_placa, u.capacidad_carga_ton AS unidad_capacidad,
             t.razon_social AS transportista_razon_social,
             t.contacto_nombre AS transportista_contacto, t.telefono AS transportista_telefono,
             t.calificacion AS transportista_calificacion
      FROM asignaciones_ia a
      LEFT JOIN viajes v ON v.id = a.viaje_id
      LEFT JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN operadores o ON o.id = a.operador_id
      LEFT JOIN unidades u ON u.id = a.unidad_id
      LEFT JOIN transportistas_externos t ON t.id = a.transportista_externo_id
      WHERE a.id = $1
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'No encontrada' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-notificar
router.post('/:id/notificar', auth(ROLES_DECIDE), async (req, res) => {
  try {
    const { rows: [a] } = await db.query(`SELECT * FROM asignaciones_ia WHERE id = $1`, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'No encontrada' });
    const { rows: [viaje] } = await db.query('SELECT * FROM viajes WHERE id = $1', [a.viaje_id]);

    let decision = { tipo_operacion: a.tipo_operacion };
    if (a.tipo_operacion === 'propio') {
      const { rows: [op] } = await db.query('SELECT * FROM operadores WHERE id = $1', [a.operador_id]);
      const { rows: [un] } = await db.query('SELECT * FROM unidades WHERE id = $1', [a.unidad_id]);
      decision.operador = op;
      decision.unidad = un;
    } else {
      const { rows: [t] } = await db.query('SELECT * FROM transportistas_externos WHERE id = $1', [a.transportista_externo_id]);
      decision.transportista = t;
      decision.precio_broker_sugerido = a.precio_broker_sugerido;
    }
    const r = await asignador.notificarAsignacion({ asignacionId: a.id, viaje, decision });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configuración
router.get('/configuracion/get', auth(ROLES_LECTURA), async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT clave, valor, descripcion FROM configuracion_empresa
      WHERE clave LIKE 'asignador_%' ORDER BY clave
    `);
    res.json(Object.fromEntries(rows.map(r => [r.clave, r])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/configuracion/set', auth(['director']), async (req, res) => {
  const body = req.body || {};
  try {
    let n = 0;
    for (const [k, v] of Object.entries(body)) {
      if (!k.startsWith('asignador_')) continue;
      const valor = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
      await db.query(`
        INSERT INTO configuracion_empresa (clave, valor, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
      `, [k, valor]);
      n++;
    }
    res.json({ ok: true, actualizados: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
