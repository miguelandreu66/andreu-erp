const router = require('express').Router();
const jwt = require('jsonwebtoken');
const estadoCuenta = require('../lib/reportes/estadoCuentaCliente');
const reporteViaje = require('../lib/reportes/reporteViaje');
const reporteFlotaMes = require('../lib/reportes/reporteFlotaMes');

// Auth con token por header o ?token=... (descargas en nueva pestaña)
function authQueryOrHeader(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(decoded.rol)) {
        return res.status(403).json({ error: 'Sin permisos' });
      }
      req.usuario = decoded;
      next();
    } catch {
      res.status(401).json({ error: 'Token inválido' });
    }
  };
}

function stream(doc, res, filename) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${encodeURIComponent(filename)}.pdf"`,
    'Cache-Control': 'private, no-store',
  });
  doc.pipe(res);
}

const ROLES_LECTURA = ['director','admin','logistica','monitoreo','caja'];

router.get('/estado-cuenta/:cliente_id',
  authQueryOrHeader(['director','admin','caja']),
  async (req, res) => {
    try {
      const doc = await estadoCuenta.generar(req.params.cliente_id, {
        desde: req.query.desde,
        hasta: req.query.hasta,
      });
      stream(doc, res, `estado-cuenta-${req.params.cliente_id}`);
    } catch (e) {
      console.error('pdf estado-cuenta:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

router.get('/viaje/:viaje_id',
  authQueryOrHeader(ROLES_LECTURA),
  async (req, res) => {
    try {
      const doc = await reporteViaje.generar(req.params.viaje_id);
      stream(doc, res, `viaje-${req.params.viaje_id}`);
    } catch (e) {
      console.error('pdf viaje:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

router.get('/flota-mes/:yyyymm',
  authQueryOrHeader(['director','admin','logistica','monitoreo']),
  async (req, res) => {
    try {
      const doc = await reporteFlotaMes.generar(req.params.yyyymm);
      stream(doc, res, `flota-${req.params.yyyymm}`);
    } catch (e) {
      console.error('pdf flota-mes:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

module.exports = router;
