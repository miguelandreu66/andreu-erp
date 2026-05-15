const BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const getToken = () => localStorage.getItem('andreu_token');

const headers = () => ({
  'Content-Type': 'application/json',
  ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
});

const req = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
};

// Upload multipart (no Content-Type para que el browser ponga el boundary)
const reqUpload = async (path, formData) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de servidor');
  return data;
};

// URL absoluta con token para descargas (target="_blank" pierde headers)
export const fileUrl = (path) => {
  const token = getToken();
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE}${path}${token ? `${sep}token=${encodeURIComponent(token)}` : ''}`;
};

// Helper para construir URLs de PDFs descargables
export const pdfUrl = {
  estadoCuenta:  (clienteId, desde, hasta) => {
    const qs = new URLSearchParams();
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);
    const q = qs.toString();
    return fileUrl(`/reportes-pdf/estado-cuenta/${clienteId}${q ? '?' + q : ''}`);
  },
  viaje:         (viajeId)  => fileUrl(`/reportes-pdf/viaje/${viajeId}`),
  flotaMes:      (yyyymm)   => fileUrl(`/reportes-pdf/flota-mes/${yyyymm}`),
};

export const api = {
  // Auth
  login: (email, password) => req('POST', '/auth/login', { email, password }),
  registro: (body) => req('POST', '/auth/registro', body),
  usuarios: () => req('GET', '/auth/usuarios'),
  toggleUsuario: (id) => req('PUT', `/auth/usuarios/${id}/toggle`),
  cambiarPassword: (body) => req('PUT', '/auth/password', body),

  // Dashboard
  dashboard: () => req('GET', '/dashboard'),
  reporteDia: (fecha) => req('GET', `/dashboard/reporte-dia${fecha ? '?fecha='+fecha : ''}`),

  // Ventas
  crearVenta: (body) => req('POST', '/ventas', body),
  ventas: (params='') => req('GET', `/ventas${params}`),
  detalleVenta: (id) => req('GET', `/ventas/${id}`),
  resumenDia: (fecha) => req('GET', `/ventas/resumen-dia?fecha=${fecha}`),
  resumenSemana: (si) => req('GET', `/ventas/resumen-semana${si?'?semana_inicio='+si:''}`),
  eliminarVenta: (id) => req('DELETE', `/ventas/${id}`),

  // Viajes
  crearViaje: (body) => req('POST', '/viajes', body),
  viajes: (params='') => req('GET', `/viajes${params}`),
  rendimientoSemana: (si) => req('GET', `/viajes/rendimiento-semana${si?'?semana_inicio='+si:''}`),
  actualizarEstadoViaje: (id, estado) => req('PUT', `/viajes/${id}/estado`, { estado }),
  eliminarViaje: (id) => req('DELETE', `/viajes/${id}`),

  // Gastos
  crearGasto: (body) => req('POST', '/gastos', body),
  gastos: (params='') => req('GET', `/gastos${params}`),
  aprobarGasto: (id, accion) => req('PUT', `/gastos/${id}/aprobar`, { accion }),
  resumenGastosSemana: (si) => req('GET', `/gastos/resumen-semana${si?'?semana_inicio='+si:''}`),
  eliminarGasto: (id) => req('DELETE', `/gastos/${id}`),

  // Inventario
  inventario: () => req('GET', '/inventario'),
  crearInventario: (body) => req('POST', '/inventario', body),
  actualizarInventario: (id, body) => req('PUT', `/inventario/${id}`, body),

  // Nómina
  crearPago: (body) => req('POST', '/nomina/pagos', body),
  pagarNomina: (id) => req('PUT', `/nomina/pagos/${id}/pagar`),
  pagosNomina: (params='') => req('GET', `/nomina/pagos${params}`),
  resumenNomina: (si) => req('GET', `/nomina/resumen-semana${si?'?semana_inicio='+si:''}`),
  crearAnticipo: (body) => req('POST', '/nomina/anticipos', body),
  anticipos: (params='') => req('GET', `/nomina/anticipos${params}`),
  anticiposPendientes: (emp_id) => req('GET', `/nomina/anticipos/pendientes/${emp_id}`),

  // Empleados
  empleados: () => req('GET', '/empleados'),
  crearEmpleado: (body) => req('POST', '/empleados', body),
  actualizarEmpleado: (id, body) => req('PUT', `/empleados/${id}`, body),
  bajaEmpleado: (id) => req('PUT', `/empleados/${id}/baja`),

  // Clientes
  clientes: (params='') => req('GET', `/clientes${params}`),
  crearCliente: (body) => req('POST', '/clientes', body),
  actualizarCliente: (id, body) => req('PUT', `/clientes/${id}`, body),
  detalleCliente: (id) => req('GET', `/clientes/${id}`),
  topClientes: () => req('GET', '/clientes/stats/top'),

  // Históricos
  comparativoSemanas: () => req('GET', '/historicos/semanas'),
  tendenciaMensual: () => req('GET', '/historicos/mensual'),
  ventasPorProducto: () => req('GET', '/historicos/por-producto'),
  viajesSemanas: () => req('GET', '/historicos/viajes-semanas'),
  margenSemanas: () => req('GET', '/historicos/margen-semanas'),

  // Mantenimiento
  mantenimientos: (params='') => req('GET', `/mantenimiento${params}`),
  crearMantenimiento: (body) => req('POST', '/mantenimiento', body),
  proximosMantenimientos: () => req('GET', '/mantenimiento/proximos'),
  costosUnidad: () => req('GET', '/mantenimiento/costos-unidad'),
  unidades: () => req('GET', '/mantenimiento/unidades'),
  crearUnidad: (body) => req('POST', '/mantenimiento/unidades', body),

  // Reportes ejecutivos
  reporteMensual:         (p='') => req('GET', `/reportes/ejecutivo/mensual${p}`),
  reportePorProducto:     (p='') => req('GET', `/reportes/ejecutivo/por-producto${p}`),
  reporteTopClientes:     (p='') => req('GET', `/reportes/ejecutivo/top-clientes${p}`),
  reporteRentabilidadFlota:(p='')=> req('GET', `/reportes/ejecutivo/rentabilidad-flota${p}`),

  // Logística KPIs
  logisticaKpis:        (p='') => req('GET', `/logistica/kpis${p}`),
  logisticaPorOperador: (p='') => req('GET', `/logistica/por-operador${p}`),
  logisticaPorUnidad:   (p='') => req('GET', `/logistica/por-unidad${p}`),
  logisticaDestinos:    (p='') => req('GET', `/logistica/destinos${p}`),
  logisticaAlertas:     ()     => req('GET', '/logistica/alertas'),

  // Proveedores
  proveedores:        (params='') => req('GET',  `/proveedores${params}`),
  crearProveedor:     (body)      => req('POST', '/proveedores', body),
  actualizarProveedor:(id, body)  => req('PUT',  `/proveedores/${id}`, body),
  toggleProveedor:    (id)        => req('PUT',  `/proveedores/${id}/toggle`),

  // Compras — Órdenes
  ordenesCompra:      (params='') => req('GET',  `/compras/ordenes${params}`),
  detalleOrden:       (id)        => req('GET',  `/compras/ordenes/${id}`),
  crearOrden:         (body)      => req('POST', '/compras/ordenes', body),
  autorizarOrden:     (id)        => req('PUT',  `/compras/ordenes/${id}/autorizar`),
  cancelarOrden:      (id)        => req('PUT',  `/compras/ordenes/${id}/cancelar`),
  recibirOrden:       (id, body)  => req('POST', `/compras/ordenes/${id}/recepcion`, body),

  // Compras — Cuentas por Pagar
  cuentasPagar:       (params='') => req('GET',  `/compras/cuentas-pagar${params}`),
  resumenCxP:         ()          => req('GET',  '/compras/cuentas-pagar/resumen'),
  pagarProveedor:     (id, body)  => req('POST', `/compras/cuentas-pagar/${id}/pago`, body),

  // CXC — Cuentas por Cobrar
  cxcLista:      (params='') => req('GET', `/cxc${params}`),
  cxcResumen:    ()          => req('GET', '/cxc/resumen'),
  cxcAntiguedad: ()          => req('GET', '/cxc/antiguedad'),
  cxcAbonos:        (id)       => req('GET',  `/cxc/${id}/abonos`),
  registrarAbono:   (id, body) => req('POST', `/cxc/${id}/abono`, body),
  recordatoriosCXC: ()         => req('POST', '/cxc/recordatorios', {}),

  // Notificaciones
  enviarReporteDia: (telefono) => req('POST', '/notificaciones/reporte-dia', { telefono }),
  configNotificaciones: () => req('GET', '/notificaciones/config'),

  // Cotizaciones
  cotizaciones:              (params='') => req('GET',  `/cotizaciones${params}`),
  detalleCotizacion:         (id)        => req('GET',  `/cotizaciones/${id}`),
  crearCotizacion:           (body)      => req('POST', '/cotizaciones', body),
  actualizarEstadoCotizacion:(id, estado)=> req('PUT',  `/cotizaciones/${id}/estado`, { estado }),
  convertirCotizacion:       (id, body)  => req('POST', `/cotizaciones/${id}/convertir`, body),

  operadores:         ()         => req('GET',  '/operadores'),
  crearOperador:      (body)     => req('POST', '/operadores', body),
  actualizarOperador: (id, body) => req('PUT', `/operadores/${id}`, body),
  toggleOperador:     (id)       => req('PUT', `/operadores/${id}/toggle`),

  // Datos del operador (self, basado en usuario logeado)
  opMiPerfil:    ()              => req('GET',  '/operadores/mi-perfil'),
  opMisViajes:   (dias=30)       => req('GET',  `/operadores/mis-viajes?dias=${dias}`),
  opCrearAcceso: (operadorId, email, password) =>
    req('POST', `/operadores/${operadorId}/crear-acceso`, { email, password }),

  // Flotilla — tarjetas combustible + TAGs casetas
  flotillaResumen:     ()           => req('GET',    '/flotilla/resumen'),
  flotillaProveedores: ()           => req('GET',    '/flotilla/proveedores'),
  tarjetas:            ()           => req('GET',    '/flotilla/tarjetas'),
  crearTarjeta:        (body)       => req('POST',   '/flotilla/tarjetas', body),
  actualizarTarjeta:   (id, body)   => req('PUT',    `/flotilla/tarjetas/${id}`, body),
  eliminarTarjeta:     (id)         => req('DELETE', `/flotilla/tarjetas/${id}`),
  movimientosTarjeta:  (id, limit=100) => req('GET', `/flotilla/tarjetas/${id}/movimientos?limit=${limit}`),
  crearMovimientoTarjeta: (id, body)   => req('POST',`/flotilla/tarjetas/${id}/movimientos`, body),
  uploadCsvMovimientos:(id, formData)  => reqUpload(`/flotilla/tarjetas/${id}/movimientos/upload-csv`, formData),
  tags:                ()           => req('GET',    '/flotilla/tags'),
  crearTag:            (body)       => req('POST',   '/flotilla/tags', body),
  crucesTag:           (id, limit=100) => req('GET', `/flotilla/tags/${id}/cruces?limit=${limit}`),
  crearCruceTag:       (id, body)   => req('POST',   `/flotilla/tags/${id}/cruces`, body),

  // Leads y cotizador
  leadCotizarPublico:  (body)       => req('POST',   '/leads/cotizar', body),
  leads:               (params='')  => req('GET',    `/leads${params}`),
  detalleLead:         (id)         => req('GET',    `/leads/${id}`),
  actualizarEstadoLead:(id, body)   => req('PUT',    `/leads/${id}/estado`, body),
  convertirLeadCliente:(id, body)   => req('POST',   `/leads/${id}/convertir-cliente`, body),
  eliminarLead:        (id)         => req('DELETE', `/leads/${id}`),
  asignarTransportistaLead: (id, body) => req('POST', `/leads/${id}/asignar-transportista`, body),
  brokerResumen:       ()           => req('GET',    '/leads/broker/resumen'),

  // Transportistas externos (broker network)
  transportistasExternos: (params='') => req('GET', `/transportistas${params}`),
  detalleTransportista: (id)        => req('GET',    `/transportistas/${id}`),
  crearTransportista:  (body)       => req('POST',   '/transportistas', body),
  actualizarTransportista: (id, body) => req('PUT',  `/transportistas/${id}`, body),
  eliminarTransportista: (id)       => req('DELETE', `/transportistas/${id}`),
  sugerirTransportistas: (leadId)   => req('GET',    `/transportistas/sugerir/${leadId}`),

  // Filtro / Verificación de transportistas (Fase 13)
  checklistTransportista: (id)      => req('GET',    `/transportistas/${id}/checklist`),
  verificarTransportista: (id)      => req('PUT',    `/transportistas/${id}/verificar`),
  rechazarTransportista:  (id, motivo) => req('PUT', `/transportistas/${id}/rechazar`, { motivo }),
  suspenderTransportista: (id, motivo) => req('PUT', `/transportistas/${id}/suspender`, { motivo }),
  reactivarTransportista: (id)      => req('PUT',    `/transportistas/${id}/reactivar`),
  recalcularScoreTransportista: (id) => req('POST',  `/transportistas/${id}/recalcular-score`),

  // Broker Finanzas (Fase 14)
  brokerDashboard:        ()              => req('GET',    '/broker-finanzas/dashboard'),
  brokerOperaciones:      ()              => req('GET',    '/broker-finanzas/operaciones'),
  brokerConcentracion:    ()              => req('GET',    '/broker-finanzas/concentracion'),
  brokerPagos:            (params='')     => req('GET',    `/broker-finanzas/pagos${params}`),
  crearBrokerPago:        (body)          => req('POST',   '/broker-finanzas/pagos', body),
  marcarBrokerPagoPagado: (id, body={})   => req('PUT',    `/broker-finanzas/pagos/${id}/marcar-pagado`, body),
  cancelarBrokerPago:     (id, motivo)    => req('PUT',    `/broker-finanzas/pagos/${id}/cancelar`, { motivo }),
  eliminarBrokerPago:     (id)            => req('DELETE', `/broker-finanzas/pagos/${id}`),
  registrarCobroLead:     (leadId, body)  => req('POST',   `/broker-finanzas/leads/${leadId}/cobro`, body),
  brokerConfig:           (body)          => req('PUT',    '/broker-finanzas/configuracion', body),

  // Documentos de transportistas
  transportistaDocsConfig: ()       => req('GET',    '/transportistas/config'),
  transportistaDocs:    (id)        => req('GET',    `/transportistas/${id}/documentos`),
  subirTransportistaDoc: (id, formData) => reqUpload(`/transportistas/${id}/documentos`, formData),
  actualizarTransportistaDoc: (id, body) => req('PUT', `/transportistas/documentos/${id}`, body),
  eliminarTransportistaDoc:   (id)  => req('DELETE', `/transportistas/documentos/${id}`),
  transportistaDocArchivoUrl: (id)  => fileUrl(`/transportistas/documentos/${id}/archivo`),
  alertasVigenciaTransportistas: () => req('GET',    '/transportistas/documentos/alertas-vigencia'),

  // Retención Autopilot (Fase 19)
  retencionDashboard:    ()              => req('GET',  '/retencion-ia/dashboard'),
  retencionSegmento:     (clasif)        => req('GET',  `/retencion-ia/segmentos/${clasif}`),
  retencionAcciones:     (params='')     => req('GET',  `/retencion-ia/acciones${params}`),
  retencionAccionDetalle:(id)            => req('GET',  `/retencion-ia/acciones/${id}`),
  retencionCorrerCiclo:  (soloScoring=false) => req('POST', '/retencion-ia/correr-ciclo', { solo_scoring: soloScoring }),
  retencionAccionManual: (clienteId, body) => req('POST', `/retencion-ia/cliente/${clienteId}/accion`, body),
  retencionConfig:       ()              => req('GET',  '/retencion-ia/configuracion'),
  retencionGuardarConfig:(body)          => req('PUT',  '/retencion-ia/configuracion', body),

  // Asignador IA (Fase 18)
  asignadorDashboard:    ()           => req('GET',  '/asignador-ia/dashboard'),
  asignadorSugerir:      (viajeId)    => req('POST', `/asignador-ia/sugerir/${viajeId}`),
  asignadorAplicar:      (id)         => req('POST', `/asignador-ia/${id}/aplicar`),
  asignadorRechazar:     (id, motivo) => req('POST', `/asignador-ia/${id}/rechazar`, { motivo }),
  asignadorHistorial:    (params='')  => req('GET',  `/asignador-ia/historial${params}`),
  asignadorDetalle:      (id)         => req('GET',  `/asignador-ia/${id}`),
  asignadorReNotificar:  (id)         => req('POST', `/asignador-ia/${id}/notificar`),
  asignadorConfig:       ()           => req('GET',  '/asignador-ia/configuracion/get'),
  asignadorGuardarConfig:(body)       => req('PUT',  '/asignador-ia/configuracion/set', body),

  // CFDI 4.0 + Carta Porte 3.0 (Fase 17)
  cfdiDashboard:          ()              => req('GET',  '/cfdi/dashboard'),
  cfdiList:               (params='')     => req('GET',  `/cfdi${params}`),
  cfdiDetalle:            (id)            => req('GET',  `/cfdi/${id}`),
  cfdiEmitirViaje:        (viajeId)       => req('POST', `/cfdi/emitir-viaje/${viajeId}`),
  cfdiReintentar:         (id)            => req('POST', `/cfdi/${id}/reintentar`),
  cfdiEnviarCliente:      (id)            => req('POST', `/cfdi/${id}/enviar-cliente`),
  cfdiCancelar:           (id, body)      => req('POST', `/cfdi/${id}/cancelar`, body),
  cfdiPdfUrl:             (id)            => fileUrl(`/cfdi/${id}/pdf`),
  cfdiXmlUrl:             (id)            => fileUrl(`/cfdi/${id}/xml`),
  cfdiConfigEmpresa:      ()              => req('GET',  '/cfdi/configuracion/empresa'),
  cfdiGuardarConfig:      (body)          => req('PUT',  '/cfdi/configuracion/empresa', body),

  // Vendedor IA 24/7 (Fase 16)
  vendedorDashboard:         ()                   => req('GET',  '/vendedor-ia/dashboard'),
  vendedorConversaciones:    (params='')          => req('GET',  `/vendedor-ia/conversaciones${params}`),
  vendedorConversacion:      (id)                 => req('GET',  `/vendedor-ia/conversaciones/${id}`),
  vendedorEnviarMensaje:     (convId, contenido)  => req('POST', `/vendedor-ia/conversaciones/${convId}/mensaje`, { contenido }),
  vendedorCambiarEstadoConv: (id, estado, notas)  => req('PUT',  `/vendedor-ia/conversaciones/${id}/estado`, { estado, notas }),
  vendedorReenviarLead:      (leadId)             => req('POST', `/vendedor-ia/leads/${leadId}/reenviar`),
  vendedorProcesarDrip:      ()                   => req('POST', '/vendedor-ia/drip/procesar'),
  vendedorConfig:            ()                   => req('GET',  '/vendedor-ia/configuracion'),
  vendedorGuardarConfig:     (body)               => req('PUT',  '/vendedor-ia/configuracion', body),

  // Auditor IA (Fase 15)
  auditorDashboard:      ()              => req('GET',  '/auditor-ia/dashboard'),
  auditorEjecuciones:    ()              => req('GET',  '/auditor-ia/ejecuciones'),
  auditorEjecucion:      (id)            => req('GET',  `/auditor-ia/ejecuciones/${id}`),
  auditorHallazgos:      (params='')     => req('GET',  `/auditor-ia/hallazgos${params}`),
  auditorEjecutar:       ()              => req('POST', '/auditor-ia/ejecutar'),
  auditorCambiarStatus:  (id, status, notas) => req('PUT', `/auditor-ia/hallazgos/${id}/status`, { status, notas }),
  auditorConfig:         ()              => req('GET',  '/auditor-ia/configuracion'),
  auditorGuardarConfig:  (body)          => req('PUT',  '/auditor-ia/configuracion', body),

  // Command AI / Andreu Logistics
  caiDashboard:       ()       => req('GET',  '/command-ai/dashboard'),
  caiConfig:          ()       => req('GET',  '/command-ai/config'),
  caiSupervisor:      ()       => req('GET',  '/command-ai/supervisor'),
  caiSupervisorDisponible: ()  => req('GET',  '/command-ai/supervisor/disponible'),
  caiSupervisorPreguntar: (mensaje, historial=[]) =>
    req('POST', '/command-ai/supervisor/preguntar', { mensaje, historial }),

  // BYOK — API keys
  caiApiKeysDisponibilidad: () => req('GET', '/command-ai/config/api-keys'),
  caiApiKeyValor:          (clave) => req('GET', `/command-ai/config/api-keys/${clave}/valor`),
  caiApiKeyGuardar:        (clave, valor) =>
    req('POST', `/command-ai/config/api-keys/${clave}`, { valor }),
  caiApiKeyEliminar:       (clave) =>
    req('DELETE', `/command-ai/config/api-keys/${clave}`),

  caiGpsLatest:       ()       => req('GET',  '/command-ai/gps/latest'),
  caiGpsUnidad:       (id, p='') => req('GET', `/command-ai/gps/unidad/${id}${p}`),
  caiGpsPing:         (body)   => req('POST', '/command-ai/gps/ping', body),
  caiGpsBatch:        (body)   => req('POST', '/command-ai/gps/batch', body),

  caiAlertas:         (p='')   => req('GET',  `/command-ai/alertas${p}`),
  caiEvaluarAlertas:  ()       => req('POST', '/command-ai/alertas/evaluar', {}),
  caiAtenderAlerta:   (id)         => req('PUT',  `/command-ai/alertas/${id}/atender`, {}),
  caiResolverAlerta:  (id, notas)  => req('PUT',  `/command-ai/alertas/${id}/resolver`, { notas }),
  caiDescartarAlerta: (id, notas)  => req('PUT',  `/command-ai/alertas/${id}/descartar`, { notas }),

  caiScoring:         (dias=30)  => req('GET',  `/command-ai/scoring?dias=${dias}`),
  caiScoringSnapshot: (dias=30)  => req('POST', '/command-ai/scoring/snapshot', { dias }),
  caiScoringHistorico:(id)       => req('GET',  `/command-ai/scoring/historico/${id}`),

  caiDieselBaselines: ()       => req('GET',  '/command-ai/diesel/baselines'),
  caiDieselRecomputar:()       => req('POST', '/command-ai/diesel/recomputar', {}),
  caiDieselForense:   (id, dias=30) => req('GET', `/command-ai/diesel/forense/${id}?dias=${dias}`),
  caiDieselOcr:       (formData) => reqUpload('/command-ai/diesel/ocr', formData),

  // Documentos de unidades (Cloudinary)
  docsConfig:           ()        => req('GET', '/unidades/documentos/config'),
  docsListar:           (unidadId)=> req('GET', `/unidades/${unidadId}/documentos`),
  docsSubir:            (unidadId, formData) => reqUpload(`/unidades/${unidadId}/documentos`, formData),
  docsActualizar:       (id, body)=> req('PUT', `/unidades/documentos/${id}`, body),
  docsEliminar:         (id)      => req('DELETE', `/unidades/documentos/${id}`),
  docsAlertasVigencia:  ()        => req('GET', '/unidades/documentos/alertas-vigencia'),

  // Documentos de operadores
  opDocsConfig:           ()        => req('GET', '/operadores/config'),
  opDocsListar:           (opId)    => req('GET', `/operadores/${opId}/documentos`),
  opDocsSubir:            (opId, formData) => reqUpload(`/operadores/${opId}/documentos`, formData),
  opDocsActualizar:       (id, body)=> req('PUT', `/operadores/documentos/${id}`, body),
  opDocsEliminar:         (id)      => req('DELETE', `/operadores/documentos/${id}`),
  opDocsAlertasVigencia:  ()        => req('GET', '/operadores/documentos/alertas-vigencia'),

  // Onboarding / setup status
  caiSetupStatus: ()          => req('GET', '/command-ai/setup-status'),

  // Cron / automatizaciones
  cronEstado:    ()           => req('GET', '/command-ai/cron/estado'),
  cronHistorial: (limit=50)   => req('GET', `/command-ai/cron/historial?limit=${limit}`),
  cronDisparar:  (nombre)     => req('POST', `/command-ai/cron/disparar/${nombre}`, {}),

  // Comercial IA
  caiInsightsAll:        ()    => req('GET', '/command-ai/insights/all'),
  caiBriefing:           ()    => req('GET', '/command-ai/insights/briefing'),
  caiCobranzaVencida:    ()    => req('GET', '/command-ai/insights/cobranza-vencida'),
  caiClientesRiesgo:     (d=60)=> req('GET', `/command-ai/insights/clientes-riesgo?dias=${d}`),
  caiCotizacionesPend:   ()    => req('GET', '/command-ai/insights/cotizaciones-pendientes'),
  caiPreciosRuta:        ()    => req('GET', '/command-ai/insights/precios-ruta'),
};
