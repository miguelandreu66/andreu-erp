// ════════════════════════════════════════════════════════════════
// FACTURAMA — PAC para emitir CFDI 4.0 + Carta Porte 3.0
// ════════════════════════════════════════════════════════════════
// Docs API: https://apisandbox.facturama.mx/docs/api
// Sandbox: https://apisandbox.facturama.mx/api/
// Producción: https://api.facturama.mx/api/
//
// Endpoints clave:
//   POST /api-lite/3/cfdis           — emitir CFDI (lite version, más simple)
//   POST /3/cfdis                    — emitir CFDI (versión completa con XML opcional)
//   GET  /cfdi/xml/issued/{id}       — descargar XML emitido
//   GET  /cfdi/pdf/issued/{id}       — descargar PDF emitido
//   DELETE /cfdi/{id}?type=issued&motive=02  — cancelar
//
// Costo:
//   - Sandbox: gratis ilimitado
//   - Producción: ~$1 MXN por timbre, paquetes prepagados
// ════════════════════════════════════════════════════════════════

const apiKeys = require('../commandAi/apiKeysStore');
const db = require('../../db');

async function _credentials() {
  const [user, pass] = await Promise.all([
    apiKeys.leer('facturama_username'),
    apiKeys.leer('facturama_password'),
  ]);
  if (!user || !pass) {
    throw new Error('Facturama no configurado. Falta username o password en Configuración → API Keys.');
  }
  return { user, pass };
}

async function getModoUrl() {
  const { rows: [row] } = await db.query(`SELECT valor FROM configuracion_empresa WHERE clave = 'fiscal_pac_modo'`);
  const modo = row?.valor || 'sandbox';
  const baseUrl = modo === 'produccion'
    ? 'https://api.facturama.mx/api'
    : 'https://apisandbox.facturama.mx/api';
  return { modo, baseUrl };
}

async function isAvailable() {
  try {
    const [u, p] = await Promise.all([
      apiKeys.leer('facturama_username'),
      apiKeys.leer('facturama_password'),
    ]);
    return !!(u && p);
  } catch { return false; }
}

function _basicAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function _fetch(method, path, body = null) {
  const { user, pass } = await _credentials();
  const { baseUrl } = await getModoUrl();
  const url = `${baseUrl}${path}`;

  const opts = {
    method,
    headers: {
      'Authorization': _basicAuth(user, pass),
      'Accept': 'application/json',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { _raw: text }; }

  if (!r.ok) {
    const detalle = data?.Message || data?.ModelState ? JSON.stringify(data).slice(0, 800) : (data._raw || `HTTP ${r.status}`);
    const err = new Error(`Facturama ${r.status}: ${detalle}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ════════════════════════════════════════════════════════════════
// Emitir CFDI 4.0
// ════════════════════════════════════════════════════════════════
async function emitirCfdi(cfdiPayload) {
  // El payload debe seguir el schema de Facturama (CfdiIssued)
  // ver: https://apisandbox.facturama.mx/docs/api
  return await _fetch('POST', '/3/cfdis', cfdiPayload);
}

// Descargar XML como buffer
async function descargarXml(facturamaId) {
  const { user, pass } = await _credentials();
  const { baseUrl } = await getModoUrl();
  const r = await fetch(`${baseUrl}/cfdi/xml/issued/${facturamaId}`, {
    headers: { 'Authorization': _basicAuth(user, pass) },
  });
  if (!r.ok) throw new Error(`Facturama xml ${r.status}`);
  const json = await r.json();  // viene como { Content: "base64...", ContentEncoding: "base64" }
  if (json.ContentEncoding === 'base64' && json.Content) {
    return Buffer.from(json.Content, 'base64');
  }
  return Buffer.from(JSON.stringify(json));
}

// Descargar PDF como buffer
async function descargarPdf(facturamaId) {
  const { user, pass } = await _credentials();
  const { baseUrl } = await getModoUrl();
  const r = await fetch(`${baseUrl}/cfdi/pdf/issued/${facturamaId}`, {
    headers: { 'Authorization': _basicAuth(user, pass) },
  });
  if (!r.ok) throw new Error(`Facturama pdf ${r.status}`);
  const json = await r.json();
  if (json.ContentEncoding === 'base64' && json.Content) {
    return Buffer.from(json.Content, 'base64');
  }
  return Buffer.from(JSON.stringify(json));
}

// Cancelar CFDI
// motivo: '01' Error con relación, '02' Error sin relación, '03' No se llevó a cabo la operación, '04' Operación nominativa relacionada en factura global
async function cancelarCfdi(facturamaId, motivo = '02', uuidSustitucion = null) {
  let path = `/cfdi/${facturamaId}?type=issued&motive=${motivo}`;
  if (uuidSustitucion) path += `&uuidReplacement=${uuidSustitucion}`;
  return await _fetch('DELETE', path);
}

// Verificar status (con uuid del SAT)
async function consultarStatus(uuid) {
  return await _fetch('GET', `/cfdi/status?uuid=${uuid}`);
}

module.exports = {
  isAvailable,
  getModoUrl,
  emitirCfdi,
  descargarXml,
  descargarPdf,
  cancelarCfdi,
  consultarStatus,
};
