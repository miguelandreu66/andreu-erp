require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Routes
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
app.use('/api/leads',         require('./routes/leads'));
// Docs montado ANTES para que /config y /:id/documentos no choquen con /:id de transportistas
app.use('/api/transportistas', require('./routes/transportistaDocumentos'));
app.use('/api/transportistas', require('./routes/transportistas'));
app.use('/api/broker-finanzas', require('./routes/brokerFinanzas'));
app.use('/api/auditor-ia',     require('./routes/auditorIA'));

app.get('/health', (req, res) => res.json({ status: 'ok', app: 'Andreu ERP' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Andreu ERP Backend corriendo en puerto ${PORT}`);
  require('./lib/cronJobs').iniciar();
});
