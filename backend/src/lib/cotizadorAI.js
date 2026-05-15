// Cotizador inteligente para Andreu Logistics.
// Calcula precio de flete basado en distancia real (Mapbox Directions API)
// + parámetros configurables del mercado mexicano.

const db = require('../db');
const apiKeys = require('./commandAi/apiKeysStore');

// ── Helpers ──────────────────────────────────────
const TAU = Math.PI * 2;
const R_TIERRA = 6371; // km

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * TAU) / 360;
  const dLng = ((lng2 - lng1) * TAU) / 360;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * TAU) / 360) *
    Math.cos((lat2 * TAU) / 360) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.sqrt(a));
}

// Cache de configuración (5 min)
let _cfgCache = null;
let _cfgTs = 0;
async function cargarConfig() {
  if (_cfgCache && Date.now() - _cfgTs < 5 * 60 * 1000) return _cfgCache;
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa WHERE clave LIKE 'cotizador_%'
  `);
  const cfg = {};
  for (const r of rows) {
    cfg[r.clave] = isNaN(parseFloat(r.valor)) ? r.valor : parseFloat(r.valor);
  }
  _cfgCache = cfg;
  _cfgTs = Date.now();
  return cfg;
}

// ── Geocoding con Mapbox ─────────────────────────
async function geocodificar(direccion, token) {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(direccion)}&country=mx&limit=1&access_token=${token}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Geocoding falló (${r.status})`);
  const data = await r.json();
  const feat = data.features?.[0];
  if (!feat) return null;
  return {
    nombre: feat.properties?.full_address || feat.properties?.name || direccion,
    lat: feat.geometry.coordinates[1],
    lng: feat.geometry.coordinates[0],
  };
}

// ── Distancia y duración con Mapbox Directions ───
async function calcularRuta(origen, destino, token) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?access_token=${token}&overview=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Directions falló (${r.status})`);
  const data = await r.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No se encontró ruta entre los puntos');
  return {
    distancia_km: route.distance / 1000,
    duracion_horas: route.duration / 3600,
    modelo: 'mapbox_directions',
  };
}

// ── Cotizador principal ──────────────────────────
/**
 * @param {Object} input
 * @param {string} input.origen
 * @param {string} input.destino
 * @param {number} input.toneladas
 * @param {string} input.tipo_carga - general | peligrosa | refrigerada | fragil | liquidos | otro
 * @param {string} input.fecha_solicitada - YYYY-MM-DD
 * @param {string} input.recurrencia - unico | redondo | mensual_2 | mensual_4 | anual
 * @param {string[]} input.servicios_extras - ['maniobras', 'custodia_armada']
 */
async function cotizar(input) {
  const cfg = await cargarConfig();
  if (cfg.cotizador_activo === false || cfg.cotizador_activo === 'false') {
    throw new Error('El cotizador está deshabilitado. Contacta directamente a Andreu Logistics.');
  }

  // 1. Geocodificar + calcular ruta
  const mapboxToken = await apiKeys.leer('mapbox_public_token');
  let origen_geo, destino_geo, ruta;

  if (mapboxToken) {
    try {
      origen_geo = await geocodificar(input.origen, mapboxToken);
      destino_geo = await geocodificar(input.destino, mapboxToken);
      if (origen_geo && destino_geo) {
        ruta = await calcularRuta(origen_geo, destino_geo, mapboxToken);
      }
    } catch (e) {
      console.warn('Mapbox falló, usando estimación:', e.message);
    }
  }

  // Fallback: estimación si no hay Mapbox o falló
  if (!ruta) {
    // Estimación rough: si tenemos coords usa haversine × 1.3 (factor carretera)
    if (origen_geo && destino_geo) {
      const km_recta = haversineKm(origen_geo.lat, origen_geo.lng, destino_geo.lat, destino_geo.lng);
      ruta = {
        distancia_km: km_recta * 1.3,
        duracion_horas: (km_recta * 1.3) / 65, // 65 km/h promedio
        modelo: 'haversine_estimate',
      };
    } else {
      // Sin geocoding ni nada: estimación muy genérica
      ruta = {
        distancia_km: 200, // fallback default
        duracion_horas: 3.5,
        modelo: 'fallback_default',
      };
    }
  }

  const km = ruta.distancia_km;
  const horas = ruta.duracion_horas;

  // 2. Costos operativos estimados
  const litros = km * cfg.cotizador_rendimiento_flota;
  const costo_diesel = litros * cfg.cotizador_precio_diesel_litro;
  const costo_casetas = km * cfg.cotizador_factor_casetas_km;
  const costo_operador = horas * cfg.cotizador_costo_operador_hora;
  const costo_mantenimiento = km * cfg.cotizador_costo_mantenimiento_km;
  const costo_administracion = (costo_diesel + costo_casetas + costo_operador) * 0.15;
  const costo_total = costo_diesel + costo_casetas + costo_operador + costo_mantenimiento + costo_administracion;

  // 3. Precio base comercial
  const precio_minimo = cfg.cotizador_precio_minimo_viaje;
  const precio_por_km = km * cfg.cotizador_tarifa_km_base;
  let precio_base = Math.max(precio_minimo, precio_por_km);

  // 4. Recargos
  const recargos = [];
  let recargos_pct = 0;
  if ((input.toneladas || 0) > 30) {
    recargos.push({ concepto: 'Carga > 30 ton', pct: cfg.cotizador_recargo_toneladas_extra });
    recargos_pct += cfg.cotizador_recargo_toneladas_extra / 100;
  }
  if (input.tipo_carga === 'peligrosa') {
    recargos.push({ concepto: 'Carga peligrosa', pct: cfg.cotizador_recargo_peligrosa_pct });
    recargos_pct += cfg.cotizador_recargo_peligrosa_pct / 100;
  }
  if (input.tipo_carga === 'refrigerada' || input.tipo_carga === 'fragil') {
    recargos.push({ concepto: 'Carga refrigerada/frágil', pct: cfg.cotizador_recargo_refrigerada_pct });
    recargos_pct += cfg.cotizador_recargo_refrigerada_pct / 100;
  }
  // Nocturno: si hora_salida >= 20:00. Usamos campo opcional o asumimos diurno
  if (input.hora_salida && parseInt(input.hora_salida.split(':')[0]) >= 20) {
    recargos.push({ concepto: 'Salida nocturna', pct: cfg.cotizador_recargo_nocturno_pct });
    recargos_pct += cfg.cotizador_recargo_nocturno_pct / 100;
  }
  const monto_recargos = precio_base * recargos_pct;

  // 5. Descuentos
  const descuentos = [];
  let descuentos_pct = 0;
  if (input.recurrencia === 'redondo') {
    descuentos.push({ concepto: 'Viaje redondo con regreso', pct: cfg.cotizador_descuento_redondo_pct });
    descuentos_pct += cfg.cotizador_descuento_redondo_pct / 100;
  }
  if (input.recurrencia === 'mensual_4') {
    descuentos.push({ concepto: 'Recurrencia ≥ 4 viajes/mes', pct: cfg.cotizador_descuento_4viajes_pct });
    descuentos_pct += cfg.cotizador_descuento_4viajes_pct / 100;
  }
  if (input.recurrencia === 'anual') {
    descuentos.push({ concepto: 'Contrato anual ≥ 50 viajes', pct: cfg.cotizador_descuento_anual_pct });
    descuentos_pct += cfg.cotizador_descuento_anual_pct / 100;
  }
  const subtotal_con_recargos = precio_base + monto_recargos;
  const monto_descuentos = subtotal_con_recargos * descuentos_pct;

  // 6. Servicios extras
  const extras = [];
  let monto_extras = 0;
  const ext = input.servicios_extras || [];
  if (ext.includes('custodia_armada')) {
    const m = km * cfg.cotizador_custodia_armada_km;
    extras.push({ concepto: 'Custodia armada', monto: m });
    monto_extras += m;
  }
  if (ext.includes('maniobras')) {
    extras.push({ concepto: 'Maniobras de carga/descarga', monto: cfg.cotizador_maniobras });
    monto_extras += cfg.cotizador_maniobras;
  }
  if (ext.includes('estadia')) {
    // Estadía estimada: 2 hrs típico cobrable después de las 4 libres
    const m = cfg.cotizador_estadia_hora * 2;
    extras.push({ concepto: 'Estadía estimada (2 hrs)', monto: m });
    monto_extras += m;
  }

  // 7. Precio final
  const subtotal = subtotal_con_recargos - monto_descuentos;
  const precio_final = subtotal + monto_extras;

  // 8. IVA y total con impuestos
  const iva = precio_final * 0.16;
  const total_con_iva = precio_final + iva;

  // 9. Margen calculado
  const margen_pct = costo_total > 0 ? ((precio_final - costo_total) / precio_final) * 100 : 0;
  const margen_objetivo = cfg.cotizador_margen_objetivo_pct;
  const alerta_margen_bajo = margen_pct < margen_objetivo;

  // 10. Determinar si es candidato a broker
  // Si tipo_carga NO está en las capacidades de Andreu → broker
  const capacidadesCarga = (cfg.andreu_capacidades_carga || 'general,fragil')
    .split(',').map(s => s.trim().toLowerCase());
  const tipoNormalizado = (input.tipo_carga || 'general').toLowerCase();
  const tipo_operacion = capacidadesCarga.includes(tipoNormalizado) ? 'propio' : 'broker';

  let analisis_broker = null;
  if (tipo_operacion === 'broker') {
    analisis_broker = {
      motivo: `Andreu no opera carga de tipo "${tipoNormalizado}" con flota propia (solo: ${capacidadesCarga.join(', ')}).`,
      sugerencia: 'Andreu actuará como broker, conectándote con un transportista especializado de nuestra red. Mismo precio para ti.',
      markup_pct_andreu: cfg.broker_markup_default_pct || 15,
    };
  }

  return {
    ruta: {
      origen: origen_geo?.nombre || input.origen,
      destino: destino_geo?.nombre || input.destino,
      origen_coords: origen_geo ? { lat: origen_geo.lat, lng: origen_geo.lng } : null,
      destino_coords: destino_geo ? { lat: destino_geo.lat, lng: destino_geo.lng } : null,
      distancia_km: Math.round(km * 10) / 10,
      duracion_horas: Math.round(horas * 10) / 10,
      modelo: ruta.modelo,
    },
    tipo_operacion,
    analisis_broker,
    costos: {
      diesel: Math.round(costo_diesel),
      casetas: Math.round(costo_casetas),
      operador: Math.round(costo_operador),
      mantenimiento: Math.round(costo_mantenimiento),
      administracion: Math.round(costo_administracion),
      total: Math.round(costo_total),
    },
    precio: {
      base: Math.round(precio_base),
      recargos: recargos.map(r => ({ ...r, monto: Math.round(precio_base * (r.pct / 100)) })),
      monto_recargos: Math.round(monto_recargos),
      descuentos: descuentos.map(d => ({ ...d, monto: Math.round(subtotal_con_recargos * (d.pct / 100)) })),
      monto_descuentos: Math.round(monto_descuentos),
      extras: extras.map(e => ({ ...e, monto: Math.round(e.monto) })),
      monto_extras: Math.round(monto_extras),
      subtotal: Math.round(precio_final),
      iva: Math.round(iva),
      total_con_iva: Math.round(total_con_iva),
    },
    analisis: {
      margen_pct: Math.round(margen_pct * 10) / 10,
      margen_objetivo,
      alerta_margen_bajo,
      mensaje_analisis: alerta_margen_bajo
        ? `⚠️ Margen ${margen_pct.toFixed(1)}% está debajo del objetivo (${margen_objetivo}%). Considera renegociar o rechazar.`
        : `✓ Margen ${margen_pct.toFixed(1)}% es saludable.`,
    },
    parametros_usados: {
      tarifa_km: cfg.cotizador_tarifa_km_base,
      precio_minimo: cfg.cotizador_precio_minimo_viaje,
      diesel_litro: cfg.cotizador_precio_diesel_litro,
      rendimiento: cfg.cotizador_rendimiento_flota,
    },
  };
}

module.exports = { cotizar, cargarConfig };
