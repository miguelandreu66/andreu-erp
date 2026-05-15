// ════════════════════════════════════════════════════════════════
// RETENCIÓN AUTOPILOT — clasifica clientes y dispara acciones
// ════════════════════════════════════════════════════════════════
// Cron diario 6 AM:
//   1. Calcula scoring de cada cliente activo
//   2. Lo clasifica (nuevo, en_crecimiento, recurrente, en_riesgo, etc.)
//   3. Para cada clasificación que requiere acción, verifica cooldown
//   4. Genera mensaje personalizado (template o Claude Haiku)
//   5. Envía por WhatsApp o Email
//   6. Trackea si el cliente respondió o volvió a operar
// ════════════════════════════════════════════════════════════════

const db = require('../../db');
const apiKeys = require('./apiKeysStore');
const wa = require('../canales/whatsapp');
const mail = require('../canales/email');

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

async function leerConfig() {
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave LIKE 'retencion_%'
  `);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

function dentroDeHorario(cfg) {
  const ahora = new Date();
  const hMx = (ahora.getUTCHours() - 6 + 24) % 24;
  const min = ahora.getUTCMinutes();
  const minutos = hMx * 60 + min;
  const [hi, mi] = (cfg.retencion_horario_inicio || '09:00').split(':').map(Number);
  const [hf, mf] = (cfg.retencion_horario_fin    || '20:00').split(':').map(Number);
  return minutos >= hi*60 + mi && minutos <= hf*60 + mf;
}

// ════════════════════════════════════════════════════════════════
// PASO 1: Calcular scoring por cliente
// ════════════════════════════════════════════════════════════════
async function calcularScoringCliente(clienteId, cfg) {
  // Métricas del cliente
  const { rows: [m] } = await db.query(`
    SELECT
      -- Últimos 30 días
      COUNT(*) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '30 days')::int AS viajes_30d,
      -- Días 30 a 60
      COUNT(*) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '60 days'
                       AND fecha < CURRENT_DATE - INTERVAL '30 days')::int AS viajes_60d_prev,
      COUNT(*) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '90 days')::int AS viajes_90d,
      COUNT(*) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '180 days')::int AS viajes_180d,
      COUNT(*)::int AS viajes_total,

      COALESCE(SUM(monto_cobrado_cliente) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '30 days'), 0)::float AS ingresos_30d,
      COALESCE(SUM(monto_cobrado_cliente) FILTER (WHERE fecha >= CURRENT_DATE - INTERVAL '60 days'
                                                  AND fecha < CURRENT_DATE - INTERVAL '30 days'), 0)::float AS ingresos_60d_prev,
      COALESCE(SUM(monto_cobrado_cliente), 0)::float AS ingresos_total,
      COALESCE(AVG(monto_cobrado_cliente), 0)::float AS promedio_ticket,

      MIN(fecha)::date AS primer_viaje,
      MAX(fecha)::date AS ultimo_viaje,
      (CURRENT_DATE - MAX(fecha)::date)::int AS dias_sin_actividad
    FROM viajes
    WHERE cliente_id = $1
  `, [clienteId]);

  if (!m || m.viajes_total === 0) {
    return null; // sin historial, no clasificable
  }

  // Cambios %
  const cambioViajesPct = m.viajes_60d_prev > 0
    ? ((m.viajes_30d - m.viajes_60d_prev) / m.viajes_60d_prev) * 100
    : (m.viajes_30d > 0 ? 100 : 0);
  const cambioIngresosPct = m.ingresos_60d_prev > 0
    ? ((m.ingresos_30d - m.ingresos_60d_prev) / m.ingresos_60d_prev) * 100
    : (m.ingresos_30d > 0 ? 100 : 0);

  // Umbrales config
  const diasNuevo     = parseInt(cfg.retencion_dias_nuevo || 30);
  const diasInactivo  = parseInt(cfg.retencion_dias_inactivo || 60);
  const diasPerdido   = parseInt(cfg.retencion_dias_perdido || 120);
  const umbralCrec    = parseFloat(cfg.retencion_umbral_crecimiento_pct || 30);
  const umbralRiesgo  = parseFloat(cfg.retencion_umbral_riesgo_pct || 50);
  const viajesRecur   = parseInt(cfg.retencion_viajes_recurrente || 5);

  const diasSinActividad = parseInt(m.dias_sin_actividad || 0);
  const esNuevo = m.viajes_total <= 2 && diasSinActividad <= diasNuevo;

  // Clasificación
  let clasificacion;
  if (diasSinActividad >= diasPerdido) {
    clasificacion = 'perdido';
  } else if (diasSinActividad >= diasInactivo) {
    clasificacion = 'inactivo';
  } else if (esNuevo) {
    clasificacion = 'nuevo';
  } else if (m.viajes_90d >= viajesRecur) {
    clasificacion = 'recurrente';
  } else if (cambioIngresosPct >= umbralCrec && m.viajes_30d > 0) {
    clasificacion = 'en_crecimiento';
  } else if (cambioIngresosPct <= -umbralRiesgo && m.viajes_60d_prev > 0) {
    clasificacion = 'en_riesgo';
  } else {
    clasificacion = 'estable';
  }

  // LTV simple
  const ltv = parseFloat(m.ingresos_total || 0);
  // Score 0-100 (más alto = más valioso retener)
  const scoreLtv = Math.min(50, ltv / 10000 * 10);  // 10pts por cada $10k
  const scoreFrecuencia = Math.min(30, m.viajes_total * 2);
  const scoreReciente   = diasSinActividad < 30 ? 20 : diasSinActividad < 60 ? 10 : 0;
  const score = Math.round(scoreLtv + scoreFrecuencia + scoreReciente);

  return {
    clasificacion,
    viajes_30d: m.viajes_30d,
    viajes_60d_prev: m.viajes_60d_prev,
    viajes_90d: m.viajes_90d,
    viajes_180d: m.viajes_180d,
    viajes_total: m.viajes_total,
    ingresos_30d: m.ingresos_30d,
    ingresos_60d_prev: m.ingresos_60d_prev,
    ingresos_total: m.ingresos_total,
    cambio_viajes_pct: Math.round(cambioViajesPct * 10) / 10,
    cambio_ingresos_pct: Math.round(cambioIngresosPct * 10) / 10,
    dias_sin_actividad: diasSinActividad,
    primer_viaje: m.primer_viaje,
    ultimo_viaje: m.ultimo_viaje,
    promedio_ticket: m.promedio_ticket,
    ltv,
    score_retencion: score,
  };
}

async function persistirScoring(clienteId, scoring) {
  const { rows: [r] } = await db.query(`
    INSERT INTO cliente_scoring_retencion
      (cliente_id, clasificacion, viajes_30d, viajes_60d_prev, viajes_90d, viajes_180d,
       ingresos_30d, ingresos_60d_prev, ingresos_total,
       cambio_viajes_pct, cambio_ingresos_pct, dias_sin_actividad,
       ltv, promedio_ticket, score_retencion)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING id
  `, [
    clienteId, scoring.clasificacion, scoring.viajes_30d, scoring.viajes_60d_prev,
    scoring.viajes_90d, scoring.viajes_180d, scoring.ingresos_30d, scoring.ingresos_60d_prev,
    scoring.ingresos_total, scoring.cambio_viajes_pct, scoring.cambio_ingresos_pct,
    scoring.dias_sin_actividad, scoring.ltv, scoring.promedio_ticket, scoring.score_retencion,
  ]);
  return r.id;
}

// ════════════════════════════════════════════════════════════════
// PASO 2: Decidir si requiere acción + qué tipo
// ════════════════════════════════════════════════════════════════
function decidirAccion(clasificacion) {
  const acciones = {
    nuevo:           { tipo: 'bienvenida_nuevo',           desc_pct: 0 },
    en_crecimiento:  { tipo: 'agradecimiento_crecimiento', desc_pct: 0 },
    recurrente:      { tipo: 'oferta_contrato_anual',      desc_pct: 10 },
    en_riesgo:       { tipo: 'preventivo_en_riesgo',       desc_pct: 7 },
    inactivo:        { tipo: 'reactivacion_inactivo',      desc_pct: 12 },
    perdido:         { tipo: 'ultimo_intento_perdido',     desc_pct: 15 },
    estable:         null,  // no requiere acción
  };
  return acciones[clasificacion] || null;
}

// ════════════════════════════════════════════════════════════════
// PASO 3: Verificar cooldown
// ════════════════════════════════════════════════════════════════
async function puedeContactar(clienteId, cooldownDias) {
  const { rows: [row] } = await db.query(`
    SELECT MAX(created_at) AS ultima
    FROM cliente_acciones_retencion
    WHERE cliente_id = $1 AND estado IN ('enviada','respondida')
  `, [clienteId]);
  if (!row.ultima) return true;
  const diasDesde = (Date.now() - new Date(row.ultima).getTime()) / 86400_000;
  return diasDesde >= cooldownDias;
}

// ════════════════════════════════════════════════════════════════
// PASO 4: Generar mensaje (template o Claude opcional)
// ════════════════════════════════════════════════════════════════
function templateMensaje({ tipoAccion, cliente, scoring, descPct }) {
  const nombre = cliente.nombre.split(' ')[0];  // primer nombre
  const cambioTxt = scoring.cambio_ingresos_pct > 0
    ? `+${scoring.cambio_ingresos_pct.toFixed(0)}%`
    : `${scoring.cambio_ingresos_pct.toFixed(0)}%`;

  const plantillas = {
    bienvenida_nuevo:
      `¡Hola ${nombre}! 👋 Bienvenido a *Andreu Logistics*. Gracias por confiar en nosotros. Estamos para servirte. Si tienes cualquier duda sobre tu servicio, responde este mensaje. 🚚`,

    agradecimiento_crecimiento:
      `¡${nombre}! 🚀 Vemos que tu operación con nosotros creció ${cambioTxt} el último mes. Gracias por confiar en *Andreu Logistics*. Para clientes en crecimiento como tú, te ofrecemos *${descPct ? descPct + '% de descuento' : 'tarifas preferenciales'}* en tu siguiente cotización. ¿Cuándo tienes próximo envío?`,

    oferta_contrato_anual:
      `${nombre}, eres uno de nuestros clientes más leales (${scoring.viajes_total} viajes). 🤝\n\nQueremos premiarte con un *contrato anual* que incluye:\n• ${descPct}% descuento permanente\n• Prioridad de asignación\n• Tarifa fija sin sobresaltos\n\n¿Te interesa que platiquemos esta semana?`,

    preventivo_en_riesgo:
      `Hola ${nombre} 👋\n\nNotamos que tu actividad bajó ${Math.abs(scoring.cambio_ingresos_pct).toFixed(0)}% vs el mes pasado. ¿Pasó algo? ¿Hay algo que podamos mejorar en nuestro servicio?\n\nPara recompensar tu confianza, te ofrezco *${descPct}% de descuento* en tu próximo envío. ¿Le entramos?`,

    reactivacion_inactivo:
      `¡${nombre}, te extrañamos! 😊\n\nLlevas ${scoring.dias_sin_actividad} días sin operar con nosotros. Para reactivar tu cuenta, te ofrezco *${descPct}% de descuento* en tu próximo servicio.\n\nResponde *SI* y te activo la cotización con el descuento aplicado.`,

    ultimo_intento_perdido:
      `${nombre}, último intento antes de cerrar tu cuenta. 🙏\n\nLlevas ${scoring.dias_sin_actividad} días sin operar. Si quieres volver con nosotros, te doy un *${descPct}% de descuento* + condiciones flexibles. Solo responde "VOLVER" y te contacto personalmente.`,
  };

  return plantillas[tipoAccion] || `Hola ${nombre}, te contactamos de Andreu Logistics.`;
}

async function generarMensajePersonalizado({ tipoAccion, cliente, scoring, descPct, cfg }) {
  // Si no usa Claude o no hay key, usa template
  if (cfg.retencion_usar_claude !== 'true') {
    return templateMensaje({ tipoAccion, cliente, scoring, descPct });
  }
  try {
    const k = await apiKeys.leer('anthropic_api_key');
    if (!k) return templateMensaje({ tipoAccion, cliente, scoring, descPct });
    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey: k, maxRetries: 2 });
    const modelo = cfg.retencion_modelo_claude || 'claude-haiku-4-5';

    const contexto = `Eres el equipo de retención de Andreu Logistics (transporte B2B Cuernavaca). Genera UN mensaje de WhatsApp para el cliente. Máx 4 oraciones, formato WhatsApp (*negrita* + emojis con moderación). NO uses "Estimado". Tono directo y cálido como mexicano.

Cliente: ${cliente.nombre}
Empresa: ${cliente.tipo || 'particular'}
Clasificación: ${scoring.clasificacion}
Métricas:
- ${scoring.viajes_total} viajes totales con Andreu
- ${scoring.viajes_30d} viajes últimos 30 días
- ${scoring.cambio_ingresos_pct >= 0 ? '+' : ''}${scoring.cambio_ingresos_pct.toFixed(0)}% cambio vs mes anterior
- ${scoring.dias_sin_actividad} días sin actividad
- LTV: $${Math.round(scoring.ltv).toLocaleString('es-MX')}

Tipo de acción: ${tipoAccion}
Descuento autorizado: ${descPct}%

Genera SOLO el mensaje, sin preámbulo. Termina con pregunta o CTA. NO uses comillas envolventes.`;

    const resp = await client.messages.create({
      model: modelo,
      max_tokens: 400,
      messages: [{ role: 'user', content: contexto }],
    });
    const texto = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return texto.replace(/^["']|["']$/g, '') || templateMensaje({ tipoAccion, cliente, scoring, descPct });
  } catch (e) {
    console.warn('[Retencion] Claude personalización falló, uso template:', e.message);
    return templateMensaje({ tipoAccion, cliente, scoring, descPct });
  }
}

// ════════════════════════════════════════════════════════════════
// PASO 5: Ejecutar acción (envío real)
// ════════════════════════════════════════════════════════════════
async function ejecutarAccion({ cliente, scoring, scoringId, accion, cfg, mensaje = null }) {
  const canal = cfg.retencion_canal_default || 'whatsapp';
  const descPct = Math.min(parseFloat(cfg.retencion_descuento_max_pct || 15), accion.desc_pct);

  // Generar mensaje
  const cuerpoMsg = mensaje || await generarMensajePersonalizado({
    tipoAccion: accion.tipo, cliente, scoring, descPct, cfg,
  });

  // Registrar acción en estado "programada"
  const { rows: [accionRow] } = await db.query(`
    INSERT INTO cliente_acciones_retencion
      (cliente_id, scoring_id, tipo_accion, clasificacion, canal, mensaje,
       descuento_ofrecido_pct, estado)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'programada')
    RETURNING id
  `, [cliente.id, scoringId, accion.tipo, scoring.clasificacion, canal, cuerpoMsg, descPct]);
  const accionId = accionRow.id;

  // Enviar
  try {
    let resultado;
    if (canal === 'whatsapp') {
      const tel = wa.normalizarTelefono(cliente.telefono);
      if (!tel) throw new Error('Cliente sin teléfono válido');
      if (!(await wa.isAvailable())) throw new Error('Twilio no configurado');
      resultado = await wa.enviar({ to: tel, body: cuerpoMsg });
    } else if (canal === 'email') {
      const dest = cliente.email_facturacion || cliente.email;
      if (!dest) throw new Error('Cliente sin email');
      if (!(await mail.isAvailable())) throw new Error('SendGrid no configurado');
      const subject = `Andreu Logistics — ${cliente.nombre.split(' ')[0]}`;
      const html = `<p>${cuerpoMsg.replace(/\n/g, '<br>').replace(/\*([^*]+)\*/g, '<strong>$1</strong>')}</p>`;
      resultado = await mail.enviar({ to: dest, subject, html, text: cuerpoMsg });
    } else {
      throw new Error(`Canal no soportado: ${canal}`);
    }

    await db.query(`
      UPDATE cliente_acciones_retencion
      SET estado = 'enviada', enviado_at = NOW(), id_externo = $1, updated_at = NOW()
      WHERE id = $2
    `, [resultado.id_externo || null, accionId]);

    return { ok: true, accion_id: accionId, canal, id_externo: resultado.id_externo };
  } catch (e) {
    await db.query(`
      UPDATE cliente_acciones_retencion
      SET estado = 'fallida', error_mensaje = $1, updated_at = NOW()
      WHERE id = $2
    `, [e.message.slice(0, 500), accionId]);
    return { ok: false, accion_id: accionId, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════
// PASO 6: Detectar recuperación (¿cliente volvió a operar?)
// ════════════════════════════════════════════════════════════════
async function detectarRecuperaciones() {
  // Para cada acción enviada con cliente perdido/inactivo, verifica si volvió
  const { rows } = await db.query(`
    SELECT a.id, a.cliente_id, a.enviado_at
    FROM cliente_acciones_retencion a
    WHERE a.estado = 'enviada'
      AND a.cliente_recupero = false
      AND a.tipo_accion IN ('reactivacion_inactivo','ultimo_intento_perdido','preventivo_en_riesgo')
      AND a.enviado_at > NOW() - INTERVAL '60 days'
  `);

  let recuperados = 0;
  for (const a of rows) {
    const { rows: [{ fecha_max }] } = await db.query(`
      SELECT MAX(fecha) AS fecha_max FROM viajes
      WHERE cliente_id = $1 AND fecha > $2::date
    `, [a.cliente_id, a.enviado_at]);

    if (fecha_max) {
      await db.query(`
        UPDATE cliente_acciones_retencion
        SET cliente_recupero = true, fecha_recuperacion = $1, updated_at = NOW()
        WHERE id = $2
      `, [fecha_max, a.id]);
      recuperados++;
    }
  }
  return recuperados;
}

// ════════════════════════════════════════════════════════════════
// ORQUESTADOR — corre todo el ciclo
// ════════════════════════════════════════════════════════════════
async function correrCicloDiario({ soloScoring = false } = {}) {
  const cfg = await leerConfig();
  const t0 = Date.now();

  // Detectar recuperaciones antes de hacer nuevas acciones
  const recuperados = await detectarRecuperaciones();

  // Cargar todos los clientes con al menos un viaje
  const { rows: clientes } = await db.query(`
    SELECT DISTINCT c.id, c.nombre, c.telefono, c.email,
           c.email_facturacion, c.tipo
    FROM clientes c
    WHERE EXISTS (SELECT 1 FROM viajes v WHERE v.cliente_id = c.id)
    LIMIT 500
  `);

  const stats = {
    scoreados: 0,
    por_clasificacion: {},
    acciones_intentadas: 0,
    acciones_exitosas: 0,
    acciones_fallidas: 0,
    omitidos_cooldown: 0,
    omitidos_estable: 0,
    omitidos_sin_canal: 0,
    recuperados_detectados: recuperados,
  };

  const ejecutar = cfg.retencion_activa === 'true' && !soloScoring;
  const horarioOk = dentroDeHorario(cfg);
  const cooldown = parseInt(cfg.retencion_cooldown_dias || 14);

  for (const c of clientes) {
    try {
      const scoring = await calcularScoringCliente(c.id, cfg);
      if (!scoring) continue;
      const scoringId = await persistirScoring(c.id, scoring);
      stats.scoreados++;
      stats.por_clasificacion[scoring.clasificacion] = (stats.por_clasificacion[scoring.clasificacion] || 0) + 1;

      if (!ejecutar || !horarioOk) continue;

      const accion = decidirAccion(scoring.clasificacion);
      if (!accion) { stats.omitidos_estable++; continue; }

      if (!(await puedeContactar(c.id, cooldown))) {
        stats.omitidos_cooldown++; continue;
      }

      // Solo si tiene canal disponible
      if (cfg.retencion_canal_default === 'whatsapp' && !c.telefono) {
        stats.omitidos_sin_canal++; continue;
      }
      if (cfg.retencion_canal_default === 'email' && !c.email && !c.email_facturacion) {
        stats.omitidos_sin_canal++; continue;
      }

      stats.acciones_intentadas++;
      const r = await ejecutarAccion({ cliente: c, scoring, scoringId, accion, cfg });
      if (r.ok) stats.acciones_exitosas++;
      else stats.acciones_fallidas++;
    } catch (e) {
      console.warn(`[Retencion] cliente ${c.id} falló:`, e.message);
    }
  }

  stats.duracion_ms = Date.now() - t0;
  return stats;
}

module.exports = {
  correrCicloDiario,
  calcularScoringCliente,
  ejecutarAccion,
  decidirAccion,
  detectarRecuperaciones,
  templateMensaje,
  leerConfig,
};
