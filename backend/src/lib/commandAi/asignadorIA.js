// ════════════════════════════════════════════════════════════════
// ASIGNADOR INTELIGENTE — decide a quién mandar cada viaje
// ════════════════════════════════════════════════════════════════
// Lógica determinística (rápida y barata) + Claude solo para explicación
// en lenguaje natural opcional.
//
// Flujo:
//   1. analizarOperacion()  → ¿propio o broker?
//   2. Si propio: recomendarFlotaPropia() → mejor operador+unidad
//   3. Si broker: recomendarBroker() → mejor transportista verificado
//   4. Persistir con razonamiento
//   5. Si auto_aprobar=true Y confianza=alta → aplicar
//   6. Notificar al operador/transportista por WhatsApp
// ════════════════════════════════════════════════════════════════

const db = require('../../db');
const wa = require('../canales/whatsapp');

async function leerConfig() {
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave LIKE 'asignador_%' OR clave = 'andreu_capacidades_carga' OR clave = 'andreu_capacidades_zonas'
  `);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

// ────────────────────────────────────────────────────────────────
// PASO 1: Decisión propio vs broker
// ────────────────────────────────────────────────────────────────
async function analizarOperacion({ viaje, cfg }) {
  const capacidadesCarga = (cfg.andreu_capacidades_carga || 'general,fragil,otro')
    .split(',').map(s => s.trim().toLowerCase());
  const tipo = (viaje.tipo_carga || 'general').toLowerCase();
  const requierePropio = capacidadesCarga.includes(tipo);

  return {
    tipo_operacion: requierePropio ? 'propio' : 'broker',
    motivo_inicial: requierePropio
      ? `"${tipo}" está en las capacidades de flota propia de Andreu`
      : `"${tipo}" requiere transportista externo (refrigerado/peligroso/especial)`,
  };
}

// ────────────────────────────────────────────────────────────────
// PASO 2A: Recomendar combo operador+unidad para flota propia
// ────────────────────────────────────────────────────────────────
async function recomendarFlotaPropia({ viaje, cfg }) {
  const fecha = viaje.fecha || new Date().toISOString().split('T')[0];

  // ── Operadores disponibles (no asignados a otro viaje activo en esa fecha) ──
  const { rows: operadores } = await db.query(`
    SELECT
      o.id, o.nombre, o.telefono,
      -- Viajes último mes (señal de carga laboral)
      (SELECT COUNT(*)::int FROM viajes v
       WHERE v.operador_id = o.id
         AND v.fecha >= CURRENT_DATE - INTERVAL '30 days') AS viajes_mes,
      -- Rendimiento diesel últimos 90d
      (SELECT COALESCE(SUM(litros_diesel) / NULLIF(SUM(km_recorridos), 0), 0)::float
       FROM viajes WHERE operador_id = o.id
         AND fecha >= CURRENT_DATE - INTERVAL '90 days'
         AND km_recorridos > 0 AND litros_diesel > 0) AS lt_por_km,
      -- ¿Está ocupado en esa fecha?
      EXISTS (
        SELECT 1 FROM viajes v
        WHERE v.operador_id = o.id
          AND v.fecha = $1::date
          AND v.estado IN ('En curso','Programado')
      ) AS ocupado_ese_dia,
      -- Documentos vencidos críticos
      EXISTS (
        SELECT 1 FROM operador_documentos d
        WHERE d.operador_id = o.id
          AND d.tipo IN ('licencia_federal','examen_medico')
          AND d.vigencia_fin IS NOT NULL AND d.vigencia_fin < CURRENT_DATE
      ) AS docs_vencidos
    FROM operadores o
    WHERE o.activo = true
    ORDER BY o.nombre
  `, [fecha]).catch(() => ({ rows: [] }));

  // ── Unidades disponibles ──
  const { rows: unidades } = await db.query(`
    SELECT
      u.id, u.placa, u.capacidad_carga_ton AS capacidad_ton, u.km_actual,
      -- Mantenimientos vencidos
      EXISTS (
        SELECT 1 FROM mantenimiento_programado m
        WHERE m.unidad_id = u.id AND m.activo = true
          AND u.km_actual >= m.km_objetivo
      ) AS mantenimiento_vencido,
      -- Docs vencidos
      EXISTS (
        SELECT 1 FROM unidad_documentos d
        WHERE d.unidad_id = u.id
          AND d.tipo IN ('poliza_seguro','verificacion_vehicular','tarjeta_circulacion')
          AND d.vigencia_fin IS NOT NULL AND d.vigencia_fin < CURRENT_DATE
      ) AS docs_vencidos,
      -- ¿Ocupada ese día?
      EXISTS (
        SELECT 1 FROM viajes v
        WHERE v.unidad_id = u.id
          AND v.fecha = $1::date
          AND v.estado IN ('En curso','Programado')
      ) AS ocupada_ese_dia
    FROM unidades u
    WHERE u.activa = true
    ORDER BY u.placa
  `, [fecha]).catch(() => ({ rows: [] }));

  // ── Scoring ──
  const pesoCalif = parseFloat(cfg.asignador_peso_calificacion || 30);
  const pesoDisp  = parseFloat(cfg.asignador_peso_disponibilidad || 40);
  const pesoRot   = parseFloat(cfg.asignador_peso_rotacion || 15);
  const pesoCap   = parseFloat(cfg.asignador_peso_capacidad || 15);

  // Operadores: ranking
  const operadoresRank = operadores.map(o => {
    const motivos = [];
    let score = 0;
    let elegible = true;

    if (o.docs_vencidos) { elegible = false; motivos.push('docs críticos vencidos'); }
    if (o.ocupado_ese_dia) { elegible = false; motivos.push('ocupado ese día'); }

    if (elegible) {
      // Disponibilidad: 100% si no está ocupado
      score += pesoDisp;

      // Calificación por rendimiento diesel (meta 1.8-2.0 lt/km)
      const ltkm = parseFloat(o.lt_por_km || 0);
      const factorCalif = ltkm === 0 ? 0.5
        : ltkm <= 2.0 ? 1.0
        : ltkm <= 2.3 ? 0.7
        : 0.4;
      score += pesoCalif * factorCalif;

      // Rotación: penaliza si tiene muchos viajes (>15 en último mes)
      const viajesMes = parseInt(o.viajes_mes || 0);
      const factorRot = viajesMes < 5 ? 1.0
        : viajesMes < 10 ? 0.85
        : viajesMes < 15 ? 0.6
        : 0.3;
      score += pesoRot * factorRot;

      // Capacidad: asumimos OK para flota propia
      score += pesoCap;
    }

    return {
      id: o.id, nombre: o.nombre, telefono: o.telefono,
      elegible, score: Math.round(score * 100) / 100,
      detalles: { viajes_mes: o.viajes_mes, lt_por_km: o.lt_por_km, motivos },
    };
  }).sort((a, b) => b.score - a.score);

  // Unidades: ranking
  const unidadesRank = unidades.map(u => {
    const motivos = [];
    let score = 0;
    let elegible = true;

    if (u.docs_vencidos) { elegible = false; motivos.push('docs vencidos (póliza/verificación/tarjeta)'); }
    if (u.mantenimiento_vencido) { elegible = false; motivos.push('mantenimiento vencido'); }
    if (u.ocupada_ese_dia) { elegible = false; motivos.push('ocupada ese día'); }

    if (elegible) {
      score += pesoDisp;
      score += pesoCalif;  // unidades operativas todas en buen estado
      score += pesoRot;
      // Capacidad
      const capOk = !viaje.peso_bruto_total_kg
        || !u.capacidad_ton
        || parseFloat(viaje.peso_bruto_total_kg) / 1000 <= parseFloat(u.capacidad_ton);
      if (!capOk) {
        elegible = false;
        motivos.push(`capacidad insuficiente (${u.capacidad_ton}t < ${(viaje.peso_bruto_total_kg/1000).toFixed(1)}t)`);
        score = 0;
      } else {
        score += pesoCap;
      }
    }

    return {
      id: u.id, placa: u.placa, capacidad_ton: u.capacidad_ton,
      elegible, score: Math.round(score * 100) / 100,
      detalles: { km_actual: u.km_actual, motivos },
    };
  }).sort((a, b) => b.score - a.score);

  const mejorOperador = operadoresRank.find(o => o.elegible) || null;
  const mejorUnidad = unidadesRank.find(u => u.elegible) || null;

  // Confianza
  let confianza = 'alta';
  if (!mejorOperador || !mejorUnidad) confianza = 'baja';
  else if (mejorOperador.score < 70 || mejorUnidad.score < 70) confianza = 'media';

  return {
    operador: mejorOperador,
    unidad: mejorUnidad,
    operadores_top5: operadoresRank.slice(0, 5),
    unidades_top5: unidadesRank.slice(0, 5),
    confianza,
  };
}

// ────────────────────────────────────────────────────────────────
// PASO 2B: Recomendar transportista broker
// ────────────────────────────────────────────────────────────────
async function recomendarBroker({ viaje, cfg }) {
  const tipoCarga = (viaje.tipo_carga || 'general').toLowerCase();

  // Solo verificados activos con tipo_carga match (o sin restricción)
  const { rows: candidatos } = await db.query(`
    SELECT t.*,
      -- Volumen últimos 90d (para detectar concentración)
      COALESCE((
        SELECT SUM(l.precio_transportista)::float FROM leads l
        WHERE l.transportista_externo_id = t.id
          AND l.tipo_operacion = 'broker' AND l.estado = 'ganado'
          AND l.created_at >= CURRENT_DATE - INTERVAL '90 days'
      ), 0) AS volumen_90d,
      -- Total volumen broker últimos 90d
      (SELECT COALESCE(SUM(l2.precio_transportista), 0)::float FROM leads l2
       WHERE l2.tipo_operacion = 'broker' AND l2.estado = 'ganado'
         AND l2.created_at >= CURRENT_DATE - INTERVAL '90 days') AS total_broker_90d,
      -- ¿Tiene docs críticos vencidos?
      EXISTS (
        SELECT 1 FROM transportista_documentos d
        WHERE d.transportista_id = t.id
          AND d.tipo IN ('permiso_sct','poliza_seguro')
          AND d.vigencia_fin IS NOT NULL AND d.vigencia_fin < CURRENT_DATE
      ) AS tiene_docs_vencidos
    FROM transportistas_externos t
    WHERE t.activo = true AND t.estado_verificacion = 'verificado'
      AND ($1 = ANY(t.tipos_carga) OR cardinality(t.tipos_carga) = 0)
    ORDER BY t.score_automatico DESC
  `, [tipoCarga]).catch(() => ({ rows: [] }));

  const pesoCalif = parseFloat(cfg.asignador_peso_calificacion || 30);
  const pesoDisp  = parseFloat(cfg.asignador_peso_disponibilidad || 40);
  const pesoRot   = parseFloat(cfg.asignador_peso_rotacion || 15);
  const pesoCap   = parseFloat(cfg.asignador_peso_capacidad || 15);

  // Umbral concentración (lo trae de config broker)
  const { rows: [{ valor: umbralConcCfg }] } = await db.query(`
    SELECT valor FROM configuracion_empresa WHERE clave = 'broker_alerta_concentracion_transportista_pct'
  `).catch(() => ({ rows: [{ valor: '30' }] }));
  const umbralConc = parseFloat(umbralConcCfg || 30);

  const ranking = candidatos.map(t => {
    const motivos = [];
    let score = 0;
    let elegible = true;

    if (t.tiene_docs_vencidos) {
      elegible = false; motivos.push('docs críticos vencidos');
    }

    // Capacidad: tipo de carga match
    const capMatch = (t.tipos_carga || []).map(x => x.toLowerCase()).includes(tipoCarga);
    if (elegible) {
      // Calificación
      const calif = parseFloat(t.calificacion || 3);
      score += pesoCalif * (calif / 5);

      // Disponibilidad: usamos score automático como proxy
      const scoreAuto = parseFloat(t.score_automatico || 50);
      score += pesoDisp * (scoreAuto / 100);

      // Rotación: penaliza concentración
      const pctConc = t.total_broker_90d > 0
        ? (t.volumen_90d / t.total_broker_90d) * 100
        : 0;
      let factorRot;
      if (pctConc >= umbralConc * 1.5) {
        factorRot = 0.1;
        motivos.push(`MUY concentrado (${pctConc.toFixed(0)}% del volumen)`);
      } else if (pctConc >= umbralConc) {
        factorRot = 0.5;
        motivos.push(`concentración alta (${pctConc.toFixed(0)}%)`);
      } else {
        factorRot = 1.0;
      }
      score += pesoRot * factorRot;

      // Capacidad técnica
      score += pesoCap * (capMatch ? 1.0 : 0.5);

      // Incidentes históricos: penaliza
      if (parseInt(t.total_incidentes || 0) > 2) {
        score *= 0.7;
        motivos.push(`${t.total_incidentes} incidentes históricos`);
      }
    }

    return {
      id: t.id,
      razon_social: t.razon_social,
      contacto_nombre: t.contacto_nombre,
      telefono: t.telefono,
      calificacion: parseFloat(t.calificacion || 0),
      score_automatico: parseFloat(t.score_automatico || 0),
      comision_pct: parseFloat(t.comision_pct_acordada || 15),
      pct_concentracion: t.total_broker_90d > 0
        ? Math.round((t.volumen_90d / t.total_broker_90d) * 100)
        : 0,
      elegible,
      score: Math.round(score * 100) / 100,
      capacidad_match: capMatch,
      motivos,
    };
  }).sort((a, b) => b.score - a.score);

  const mejor = ranking.find(t => t.elegible) || null;
  const precioCliente = parseFloat(viaje.precio_final || viaje.monto_cobrado_cliente || 0);
  let precioBroker = null;
  let comisionEst = null;
  if (mejor && precioCliente > 0) {
    // Sugiere precio que respete la comisión acordada
    precioBroker = Math.round(precioCliente * (1 - mejor.comision_pct / 100) * 100) / 100;
    comisionEst = Math.round((precioCliente - precioBroker) * 100) / 100;
  }

  const confianza = !mejor ? 'baja'
    : mejor.score < 50 ? 'baja'
    : mejor.score < 70 ? 'media'
    : 'alta';

  return {
    transportista: mejor,
    candidatos_top5: ranking.slice(0, 5),
    precio_broker_sugerido: precioBroker,
    comision_estimada: comisionEst,
    confianza,
    total_candidatos: candidatos.length,
  };
}

// ────────────────────────────────────────────────────────────────
// PASO 3: Genera explicación con Claude (opcional)
// ────────────────────────────────────────────────────────────────
async function generarExplicacion({ viaje, decision, cfg }) {
  if (cfg.asignador_usar_claude_explicacion !== 'true') {
    return null;
  }
  try {
    const apiKeys = require('./apiKeysStore');
    const apiKey = await apiKeys.leer('anthropic_api_key');
    if (!apiKey) return null;

    const Anthropic = require('@anthropic-ai/sdk').default;
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    const modelo = cfg.asignador_modelo_explicacion || 'claude-haiku-4-5';

    const promptUser = `Eres el asignador de operaciones de Andreu Logistics. Analizaste el viaje y elegiste esta asignación. Genera UN PÁRRAFO de 2-3 oraciones explicando AL DIRECTOR la decisión en español natural, mencionando los números clave. Sin saludos ni cierres.

Viaje: ${viaje.origen} → ${viaje.destino} · ${viaje.tipo_carga || 'general'} · ${viaje.toneladas ? viaje.toneladas + 't' : 'sin peso'}

Decisión: ${decision.tipo_operacion.toUpperCase()}
${decision.tipo_operacion === 'propio' ? `Operador asignado: ${decision.operador?.nombre || 'ninguno disponible'} (score ${decision.operador?.score || 0})
Unidad asignada: ${decision.unidad?.placa || 'ninguna disponible'} (score ${decision.unidad?.score || 0})` :
`Transportista: ${decision.transportista?.razon_social || 'ninguno'} (score ${decision.transportista?.score || 0}, ★${decision.transportista?.calificacion || 0})
Precio a transportista: $${decision.precio_broker_sugerido || 0}
Comisión Andreu: $${decision.comision_estimada || 0}`}
Confianza: ${decision.confianza}`;

    const resp = await client.messages.create({
      model: modelo,
      max_tokens: 250,
      messages: [{ role: 'user', content: promptUser }],
    });
    const texto = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
    return texto || null;
  } catch (e) {
    console.warn('[Asignador] explicación Claude falló:', e.message);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────
// PASO 4: Notificar al operador o transportista por WhatsApp
// ────────────────────────────────────────────────────────────────
async function notificarAsignacion({ asignacionId, viaje, decision }) {
  if (!(await wa.isAvailable())) return { ok: false, motivo: 'twilio_no_disponible' };

  const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
  const fechaTxt = viaje.fecha ? new Date(viaje.fecha).toLocaleDateString('es-MX', { day:'2-digit', month:'short' }) : 'por confirmar';

  if (decision.tipo_operacion === 'propio' && decision.operador?.telefono) {
    const tel = wa.normalizarTelefono(decision.operador.telefono);
    if (!tel) return { ok: false, motivo: 'tel_invalido' };

    const body = `🚚 *Nueva asignación de viaje*\n\nHola ${decision.operador.nombre}, te asignamos:\n\n📦 *Ruta:* ${viaje.origen} → ${viaje.destino}\n📅 *Fecha:* ${fechaTxt}\n${decision.unidad?.placa ? `🚛 *Unidad:* ${decision.unidad.placa}\n` : ''}${viaje.toneladas ? `⚖️ *Toneladas:* ${viaje.toneladas}\n` : ''}\nRevisa detalles en la app o pregunta al coordinador. ¡Buen viaje! 💪`;

    try {
      const r = await wa.enviar({ to: tel, body });
      await db.query(`
        UPDATE asignaciones_ia
        SET notificado_operador = true, notificado_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [asignacionId]);
      return { ok: true, canal: 'whatsapp', destinatario: decision.operador.nombre, id_externo: r.id_externo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  if (decision.tipo_operacion === 'broker' && decision.transportista?.telefono) {
    const tel = wa.normalizarTelefono(decision.transportista.telefono);
    if (!tel) return { ok: false, motivo: 'tel_invalido' };

    const body = `📦 *Servicio asignado — Andreu Logistics*\n\nHola ${decision.transportista.contacto_nombre || decision.transportista.razon_social},\n\nTenemos un servicio para ti:\n\n🛣️ *Ruta:* ${viaje.origen} → ${viaje.destino}\n📅 *Fecha:* ${fechaTxt}\n${viaje.tipo_carga ? `📋 *Carga:* ${viaje.tipo_carga}\n` : ''}${viaje.toneladas ? `⚖️ *Toneladas:* ${viaje.toneladas}\n` : ''}💰 *Precio acordado:* ${fmt$(decision.precio_broker_sugerido)}\n\n¿Confirmas disponibilidad? Responde *SI* para aceptar.`;

    try {
      const r = await wa.enviar({ to: tel, body });
      await db.query(`
        UPDATE asignaciones_ia
        SET notificado_transportista = true, notificado_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [asignacionId]);
      return { ok: true, canal: 'whatsapp', destinatario: decision.transportista.razon_social, id_externo: r.id_externo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  return { ok: false, motivo: 'sin_telefono' };
}

// ════════════════════════════════════════════════════════════════
// ORQUESTADOR PRINCIPAL
// ════════════════════════════════════════════════════════════════
async function sugerirAsignacion(viajeId, { leadId = null } = {}) {
  const cfg = await leerConfig();

  // Cargar viaje
  const { rows: [viaje] } = await db.query('SELECT * FROM viajes WHERE id = $1', [viajeId]);
  if (!viaje) throw new Error('Viaje no encontrado');

  // 1) Decidir tipo operación
  const analisis = await analizarOperacion({ viaje, cfg });

  // 2) Recomendar
  let resultadoPropio = null, resultadoBroker = null;
  let decision;

  if (analisis.tipo_operacion === 'propio') {
    resultadoPropio = await recomendarFlotaPropia({ viaje, cfg });

    // Fallback: si no hay operador o unidad disponible, intenta broker
    if (!resultadoPropio.operador || !resultadoPropio.unidad) {
      resultadoBroker = await recomendarBroker({ viaje, cfg });
      if (resultadoBroker.transportista) {
        analisis.tipo_operacion = 'broker';
        analisis.motivo_inicial += '. Fallback a broker: sin operador/unidad disponible en flota propia';
        decision = {
          tipo_operacion: 'broker',
          transportista: resultadoBroker.transportista,
          precio_broker_sugerido: resultadoBroker.precio_broker_sugerido,
          comision_estimada: resultadoBroker.comision_estimada,
          confianza: resultadoBroker.confianza,
          candidatos_top5: resultadoBroker.candidatos_top5,
        };
      } else {
        decision = {
          tipo_operacion: 'propio',
          operador: resultadoPropio.operador,
          unidad: resultadoPropio.unidad,
          confianza: 'baja',
          candidatos_top5: { operadores: resultadoPropio.operadores_top5, unidades: resultadoPropio.unidades_top5 },
        };
      }
    } else {
      decision = {
        tipo_operacion: 'propio',
        operador: resultadoPropio.operador,
        unidad: resultadoPropio.unidad,
        confianza: resultadoPropio.confianza,
        candidatos_top5: { operadores: resultadoPropio.operadores_top5, unidades: resultadoPropio.unidades_top5 },
      };
    }
  } else {
    resultadoBroker = await recomendarBroker({ viaje, cfg });
    decision = {
      tipo_operacion: 'broker',
      transportista: resultadoBroker.transportista,
      precio_broker_sugerido: resultadoBroker.precio_broker_sugerido,
      comision_estimada: resultadoBroker.comision_estimada,
      confianza: resultadoBroker.confianza,
      candidatos_top5: resultadoBroker.candidatos_top5,
    };
  }

  // Alertas
  const alertas = [];
  if (decision.tipo_operacion === 'propio') {
    if (!decision.operador) alertas.push({ tipo: 'sin_operador', mensaje: 'No hay operadores disponibles ese día' });
    if (!decision.unidad) alertas.push({ tipo: 'sin_unidad', mensaje: 'No hay unidades disponibles ese día' });
    if (decision.operador?.score < 50) alertas.push({ tipo: 'operador_bajo_score', mensaje: `Score bajo (${decision.operador.score})` });
  } else {
    if (!decision.transportista) alertas.push({ tipo: 'sin_transportista', mensaje: 'No hay transportistas verificados con match' });
    if (decision.transportista?.pct_concentracion >= 30) {
      alertas.push({ tipo: 'concentracion_alta', mensaje: `Transportista representa ${decision.transportista.pct_concentracion}% del volumen broker 90d` });
    }
  }

  // 3) Explicación con Claude
  const explicacion = await generarExplicacion({ viaje, decision, cfg });
  const motivo = explicacion || analisis.motivo_inicial;

  // 4) Persistir
  const { rows: [a] } = await db.query(`
    INSERT INTO asignaciones_ia
      (viaje_id, lead_id, tipo_operacion, decision_motivo, confianza,
       operador_id, unidad_id, operador_score, unidad_score,
       transportista_externo_id, transportista_score,
       precio_broker_sugerido, comision_estimada,
       candidatos, alertas, estado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'sugerida')
    RETURNING *
  `, [
    viajeId, leadId, decision.tipo_operacion, motivo, decision.confianza,
    decision.operador?.id || null, decision.unidad?.id || null,
    decision.operador?.score || null, decision.unidad?.score || null,
    decision.transportista?.id || null, decision.transportista?.score || null,
    decision.precio_broker_sugerido || null, decision.comision_estimada || null,
    decision.candidatos_top5, alertas,
  ]);

  return {
    asignacion: a,
    decision,
    alertas,
    explicacion: motivo,
  };
}

// ════════════════════════════════════════════════════════════════
// Aplicar asignación (efecto real)
// ════════════════════════════════════════════════════════════════
async function aplicarAsignacion(asignacionId, { aprobadaPorUsuario = null, esAuto = false } = {}) {
  const { rows: [a] } = await db.query(`
    SELECT a.*, v.precio_final FROM asignaciones_ia a
    LEFT JOIN leads v ON v.id = a.lead_id
    WHERE a.id = $1
  `, [asignacionId]);
  if (!a) throw new Error('Asignación no encontrada');
  if (a.estado === 'aplicada') throw new Error('Ya está aplicada');

  // Actualizar viaje
  if (a.tipo_operacion === 'propio') {
    await db.query(`
      UPDATE viajes
      SET operador_id = $1, unidad_id = $2,
          estado = CASE WHEN estado IS NULL OR estado = '' THEN 'Programado' ELSE estado END,
          updated_at = NOW()
      WHERE id = $3
    `, [a.operador_id, a.unidad_id, a.viaje_id]);
  } else {
    await db.query(`
      UPDATE viajes
      SET tipo_operacion = 'broker',
          transportista_externo_id = $1,
          monto_pagado_transportista = $2,
          comision_andreu = $3,
          estado = CASE WHEN estado IS NULL OR estado = '' THEN 'Programado' ELSE estado END,
          updated_at = NOW()
      WHERE id = $4
    `, [a.transportista_externo_id, a.precio_broker_sugerido, a.comision_estimada, a.viaje_id]);
  }

  await db.query(`
    UPDATE asignaciones_ia
    SET estado = 'aplicada',
        aprobada_por = $1, aprobada_at = NOW(),
        fue_auto = $2, updated_at = NOW()
    WHERE id = $3
  `, [aprobadaPorUsuario, esAuto, asignacionId]);

  // Cargar viaje fresh
  const { rows: [viaje] } = await db.query('SELECT * FROM viajes WHERE id = $1', [a.viaje_id]);

  // Notificar
  const cfg = await leerConfig();
  let notificacion = null;
  if ((a.tipo_operacion === 'propio' && cfg.asignador_notificar_operador === 'true')
   || (a.tipo_operacion === 'broker' && cfg.asignador_notificar_transportista === 'true')) {

    // Cargar entidad para tener telefono
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

    try {
      notificacion = await notificarAsignacion({ asignacionId, viaje, decision });
    } catch (e) {
      notificacion = { ok: false, error: e.message };
    }
  }

  try {
    await db.query(`
      INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
      VALUES ($1, 'asignacion_aplicar', 'asignaciones_ia', $2, $3, 'system')
    `, [aprobadaPorUsuario, asignacionId, { tipo: a.tipo_operacion, viaje_id: a.viaje_id, auto: esAuto }]);
  } catch (_) {}

  return { ok: true, asignacion_id: asignacionId, notificacion };
}

// Decide si auto-aprobar según config
async function debeAutoAprobar(confianza) {
  const cfg = await leerConfig();
  if (cfg.asignador_activo !== 'true') return false;
  if (cfg.asignador_auto_aprobar !== 'true') return false;
  const umbral = cfg.asignador_umbral_confianza_auto || 'alta';
  const rank = { baja: 1, media: 2, alta: 3 };
  return rank[confianza] >= rank[umbral];
}

module.exports = {
  sugerirAsignacion,
  aplicarAsignacion,
  debeAutoAprobar,
  notificarAsignacion,
};
