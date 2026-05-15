// BYOK — almacén de API keys de terceros (Anthropic, Mapbox, etc.)
// Las keys se guardan en la tabla configuracion_empresa.
// Prioridad de lectura: env var → BD. Cache de 5 min para no martillar la BD.

const db = require('../../db');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // clave → { valor, ts }

const CLAVES_VALIDAS = {
  anthropic_api_key: {
    label: 'Anthropic API Key',
    descripcion: 'Activa el Supervisor IA conversacional con Claude Sonnet 4.6',
    env_var: 'ANTHROPIC_API_KEY',
    validador: v => typeof v === 'string' && v.startsWith('sk-ant-') && v.length > 20,
    formato_esperado: 'sk-ant-api03-...',
  },
  mapbox_public_token: {
    label: 'Mapbox Public Token',
    descripcion: 'Activa el mapa en vivo de la flota',
    env_var: 'MAPBOX_PUBLIC_TOKEN',
    validador: v => typeof v === 'string' && v.startsWith('pk.') && v.length > 30,
    formato_esperado: 'pk.eyJ...',
  },
  // ── Canales del Vendedor IA (Fase 16) ─────────────────────────
  twilio_account_sid: {
    label: 'Twilio Account SID',
    descripcion: 'Vendedor IA — autenticación con Twilio (WhatsApp + SMS)',
    env_var: 'TWILIO_ACCOUNT_SID',
    validador: v => typeof v === 'string' && /^AC[a-f0-9]{32}$/.test(v),
    formato_esperado: 'AC...32 hex chars',
  },
  twilio_auth_token: {
    label: 'Twilio Auth Token',
    descripcion: 'Vendedor IA — token secreto de Twilio',
    env_var: 'TWILIO_AUTH_TOKEN',
    validador: v => typeof v === 'string' && v.length >= 30 && v.length <= 64,
    formato_esperado: 'string 30-64 chars',
  },
  twilio_whatsapp_from: {
    label: 'Twilio WhatsApp From',
    descripcion: 'Número WhatsApp de Andreu (sandbox o productivo)',
    env_var: 'TWILIO_WHATSAPP_FROM',
    validador: v => typeof v === 'string' && /^whatsapp:\+\d{10,15}$/.test(v),
    formato_esperado: 'whatsapp:+5217771234567',
  },
  sendgrid_api_key: {
    label: 'SendGrid API Key',
    descripcion: 'Vendedor IA — envío de emails transaccionales',
    env_var: 'SENDGRID_API_KEY',
    validador: v => typeof v === 'string' && v.startsWith('SG.') && v.length > 30,
    formato_esperado: 'SG....',
  },
  sendgrid_from_email: {
    label: 'SendGrid From Email',
    descripcion: 'Email remitente verificado en SendGrid (ej. ventas@andreulogistics.com)',
    env_var: 'SENDGRID_FROM_EMAIL',
    validador: v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    formato_esperado: 'usuario@dominio.com',
  },
  sendgrid_from_name: {
    label: 'SendGrid From Name',
    descripcion: 'Nombre del remitente que ve el cliente en su bandeja',
    env_var: 'SENDGRID_FROM_NAME',
    validador: v => typeof v === 'string' && v.length >= 2 && v.length <= 100,
    formato_esperado: 'Andreu Logistics — Ventas',
  },
  // ── PAC Facturama (Fase 17 — CFDI + Carta Porte) ──────────────
  facturama_username: {
    label: 'Facturama Username',
    descripcion: 'Usuario de Facturama (PAC para emitir CFDI 4.0 + Carta Porte)',
    env_var: 'FACTURAMA_USERNAME',
    validador: v => typeof v === 'string' && v.length >= 3 && v.length <= 100,
    formato_esperado: 'tu usuario Facturama',
  },
  facturama_password: {
    label: 'Facturama Password',
    descripcion: 'Contraseña/API key de Facturama',
    env_var: 'FACTURAMA_PASSWORD',
    validador: v => typeof v === 'string' && v.length >= 6 && v.length <= 200,
    formato_esperado: 'contraseña o token de Facturama',
  },
};

async function leer(clave) {
  // 1. env var (prioridad absoluta — para deploys serios)
  if (CLAVES_VALIDAS[clave]?.env_var && process.env[CLAVES_VALIDAS[clave].env_var]) {
    return process.env[CLAVES_VALIDAS[clave].env_var];
  }

  // 2. cache
  const cached = cache.get(clave);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.valor;
  }

  // 3. BD
  try {
    const { rows: [row] } = await db.query(
      'SELECT valor FROM configuracion_empresa WHERE clave = $1',
      [clave]
    );
    const valor = row?.valor || null;
    cache.set(clave, { valor, ts: Date.now() });
    return valor;
  } catch (e) {
    console.warn(`apiKeysStore.leer(${clave}):`, e.message);
    return null;
  }
}

async function guardar(clave, valor, usuarioId) {
  if (!CLAVES_VALIDAS[clave]) throw new Error(`Clave desconocida: ${clave}`);
  const def = CLAVES_VALIDAS[clave];
  if (!def.validador(valor)) {
    throw new Error(`Formato inválido. Esperado: ${def.formato_esperado}`);
  }

  await db.query(`
    INSERT INTO configuracion_empresa (clave, valor, descripcion, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (clave) DO UPDATE SET
      valor = EXCLUDED.valor,
      updated_at = NOW()
  `, [clave, valor, def.descripcion]);

  cache.delete(clave); // invalidar cache

  try {
    await db.query(`
      INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
      VALUES ($1, 'api_key_guardar', 'configuracion_empresa', $2, 'system')
    `, [usuarioId || null, { clave, longitud: valor.length }]);
  } catch (_) {}

  return { ok: true };
}

async function eliminar(clave, usuarioId) {
  if (!CLAVES_VALIDAS[clave]) throw new Error(`Clave desconocida: ${clave}`);
  // No la borramos, la dejamos vacía (mantiene la fila por si hay tracking)
  await db.query(
    'UPDATE configuracion_empresa SET valor = $1, updated_at = NOW() WHERE clave = $2',
    ['', clave]
  );
  cache.delete(clave);
  try {
    await db.query(`
      INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
      VALUES ($1, 'api_key_eliminar', 'configuracion_empresa', $2, 'system')
    `, [usuarioId || null, { clave }]);
  } catch (_) {}
  return { ok: true };
}

async function disponibilidad() {
  const claves = Object.keys(CLAVES_VALIDAS);
  const estado = {};
  for (const c of claves) {
    const def = CLAVES_VALIDAS[c];
    const desdeEnv = !!process.env[def.env_var];
    let desdeBd = false;
    try {
      const { rows: [row] } = await db.query(
        'SELECT valor FROM configuracion_empresa WHERE clave = $1',
        [c]
      );
      desdeBd = !!(row?.valor && def.validador(row.valor));
    } catch (_) {}
    estado[c] = {
      label: def.label,
      descripcion: def.descripcion,
      formato_esperado: def.formato_esperado,
      configurado: desdeEnv || desdeBd,
      origen: desdeEnv ? 'env' : desdeBd ? 'bd' : null,
    };
  }
  return estado;
}

module.exports = { leer, guardar, eliminar, disponibilidad, CLAVES_VALIDAS };
