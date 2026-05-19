// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Sistema de operación de flota propia
// El módulo broker (Vendedor IA, Asignador IA, Retención IA, Atracción IA,
// Broker, Filtro transportistas) se separó al sistema independiente VIVO.
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const {
  helmetMiddleware, corsConfig,
  loginLimiter, cotizadorLimiter, apiLimiter, agentesIaLimiter, gpsLimiter,
} = require('./lib/seguridad');

const app = express();

// Confiar en proxy de Railway para detectar IP real
app.set('trust proxy', 1);

// Seguridad
app.use(helmetMiddleware);
app.use(cors(corsConfig()));
app.use(express.json({ limit: '10mb' }));

// ── Rate limiters específicos en endpoints sensibles ──
app.use('/api/auth/login', loginLimiter);
app.use('/api/cotizaciones/publico', cotizadorLimiter);
app.use('/api/agentes', agentesIaLimiter);
// GPS endpoints permiten ráfagas (proveedor + app móvil)
app.use('/api/command-ai/gps', gpsLimiter);
// Limiter general para el resto
app.use('/api', apiLimiter);

// ── Routes — operación propia ───────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/viajes', require('./routes/viajes'));
app.use('/api/gastos', require('./routes/gastos'));
app.use('/api/inventario', require('./routes/inventario'));
app.use('/api/nomina', require('./routes/nomina'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/operadores', require('./routes/operadores'));
app.use('/api/empleados', require('./routes/empleados'));
app.use('/api/clientes', require('./routes/clientes'));
app.use('/api/historicos', require('./routes/historicos'));
app.use('/api/mantenimiento', require('./routes/mantenimiento'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/cxc',           require('./routes/cxc'));
app.use('/api/proveedores',   require('./routes/proveedores'));
app.use('/api/logistica',     require('./routes/logistica'));
app.use('/api/reportes',      require('./routes/reportes'));
app.use('/api/compras',       require('./routes/compras'));
app.use('/api/cotizaciones',  require('./routes/cotizaciones'));
app.use('/api/command-ai',    require('./routes/commandAi'));
app.use('/api',               require('./routes/unidadDocumentos'));
app.use('/api/operadores',    require('./routes/operadorDocumentos'));
app.use('/api/reportes-pdf',  require('./routes/reportesPdf'));
app.use('/api/flotilla',      require('./routes/flotillaTarjetas'));
app.use('/api/auditor-ia',    require('./routes/auditorIA'));
app.use('/api/cfdi',          require('./routes/cfdi'));            // CFDI + Carta Porte
app.use('/api/agentes',       require('./routes/agentes'));         // 7 agentes IA

// ── Healthchecks ────────────────────────────────────
const health = require('./lib/healthcheck');
app.get('/health',       (req, res) => res.json(health.basic()));
app.get('/health/full',  async (req, res) => {
  const r = await health.full();
  res.status(r.status === 'critical' ? 503 : 200).json(r);
});
app.get('/health/ready', async (req, res) => {
  const r = await health.ready();
  res.status(r.ready ? 200 : 503).json(r);
});

// Handler global de errores (último recurso)
app.use((err, req, res, _next) => {
  if (err.message?.includes('Origen no permitido')) {
    return res.status(403).json({ error: 'CORS bloqueado' });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Andreu Logistics Backend corriendo en puerto ${PORT}`);
  try {
    require('./lib/cronJobs').iniciar();
  } catch (e) {
    console.warn('[CRON] no iniciado:', e.message);
  }
});
