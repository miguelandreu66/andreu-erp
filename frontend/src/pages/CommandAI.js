import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
const fmtN = n => (parseFloat(n) || 0).toLocaleString('es-MX');
const fmt2 = n => (parseFloat(n) || 0).toFixed(2);

const COLOR_NIVEL = {
  critico: { bg: '#fee2e2', border: '#dc2626', text: '#991b1b', label: '🔴 CRÍTICO' },
  alto:    { bg: '#ffedd5', border: '#ea580c', text: '#9a3412', label: '🟠 ALTO' },
  medio:   { bg: '#fef3c7', border: '#d97706', text: '#92400e', label: '🟡 MEDIO' },
  bajo:    { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a', label: '🔵 BAJO' },
};

const COLOR_ESTADO_UNIDAD = {
  en_ruta:   { bg: '#16a34a', txt: 'En ruta' },
  activa:    { bg: '#22c55e', txt: 'Activa' },
  detenido:  { bg: '#6b7280', txt: 'Detenida' },
  alerta:    { bg: '#dc2626', txt: 'Alerta' },
  sin_senal: { bg: '#7c2d12', txt: 'Sin señal' },
  sin_datos: { bg: '#9ca3af', txt: 'Sin datos' },
};

function Tabs({ value, onChange, items }) {
  return (
    <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #e5e7eb', marginBottom: 20, flexWrap: 'wrap' }}>
      {items.map(it => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          style={{
            padding: '10px 16px',
            border: 'none',
            background: value === it.id ? '#1A1A1A' : 'transparent',
            color: value === it.id ? '#fff' : '#1A1A1A',
            borderRadius: '8px 8px 0 0',
            cursor: 'pointer',
            fontWeight: value === it.id ? 700 : 500,
            fontSize: 14,
          }}
        >{it.icon} {it.label}</button>
      ))}
    </div>
  );
}

function Badge({ nivel }) {
  const c = COLOR_NIVEL[nivel] || COLOR_NIVEL.bajo;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{c.label}</span>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabDashboard({ data, onRefresh, autoRefresh, setAutoRefresh }) {
  if (!data) return <div>Cargando...</div>;
  const { posiciones, resumen } = data;

  return (
    <div>
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">Unidades activas</div>
          <div className="metric-value navy">{resumen.unidades_activas}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Viajes en ruta</div>
          <div className="metric-value orange">{resumen.viajes_en_ruta}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Alertas críticas</div>
          <div className="metric-value red">{resumen.alertas_criticas}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Alertas totales</div>
          <div className="metric-value">{resumen.alertas_totales}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Diesel últimos 7d</div>
          <div className="metric-value red">{fmt$(resumen.diesel_7d)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Litros últimos 7d</div>
          <div className="metric-value">{fmtN(resumen.litros_7d)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '24px 0 12px' }}>
        <h3 style={{ margin: 0 }}>Flota en vivo</h3>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh (30s)
          </label>
          <button onClick={onRefresh} style={btnSecondary}>↻ Refrescar</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              <th style={th}>Unidad</th>
              <th style={th}>Operador</th>
              <th style={th}>Estado</th>
              <th style={{ ...th, textAlign: 'right' }}>Velocidad</th>
              <th style={th}>Última señal</th>
              <th style={th}>Destino</th>
            </tr>
          </thead>
          <tbody>
            {posiciones.map(p => {
              const est = COLOR_ESTADO_UNIDAD[p.estado_visual] || COLOR_ESTADO_UNIDAD.sin_datos;
              return (
                <tr key={p.unidad_id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{p.placas}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{p.descripcion || '—'}</div>
                  </td>
                  <td style={td}>{p.operador || <span style={{ color: '#9ca3af' }}>Sin operador</span>}</td>
                  <td style={td}>
                    <span style={{
                      background: est.bg, color: '#fff', padding: '3px 10px',
                      borderRadius: 999, fontSize: 12, fontWeight: 600,
                    }}>{est.txt}</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {p.velocidad_kmh != null ? `${fmt2(p.velocidad_kmh)} km/h` : '—'}
                  </td>
                  <td style={td}>
                    {p.minutos_desde_ultimo != null
                      ? <span style={{ color: p.minutos_desde_ultimo > 15 ? '#dc2626' : '#16a34a' }}>
                          hace {Math.round(p.minutos_desde_ultimo)} min
                        </span>
                      : <span style={{ color: '#9ca3af' }}>Sin datos GPS</span>}
                  </td>
                  <td style={td}>{p.destino || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabAlertas({ alertas, onEvaluar, onAtender, onResolver, onDescartar, evaluando }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={onEvaluar} disabled={evaluando} style={btnPrimary}>
          {evaluando ? 'Evaluando...' : '⚡ Evaluar reglas ahora'}
        </button>
        <span style={{ fontSize: 13, color: '#6b7280' }}>
          Corre el motor de reglas, genera alertas nuevas (deduplicadas por ventana de 15 min)
        </span>
      </div>

      {alertas.length === 0 ? (
        <div style={{ padding: 40, background: '#f0fdf4', borderRadius: 12, textAlign: 'center', color: '#166534' }}>
          ✓ Sin alertas activas
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {alertas.map(a => {
            const c = COLOR_NIVEL[a.nivel] || COLOR_NIVEL.bajo;
            return (
              <div key={a.id} style={{
                background: '#fff', border: `1px solid ${c.border}`, borderLeft: `4px solid ${c.border}`,
                borderRadius: 10, padding: 14,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 250 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                      <Badge nivel={a.nivel} />
                      <strong>{a.tipo.replace(/_/g, ' ').toUpperCase()}</strong>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        {new Date(a.created_at).toLocaleString('es-MX')}
                      </span>
                      {a.estado !== 'pendiente' && (
                        <span style={{ fontSize: 11, background: '#f3f4f6', padding: '2px 8px', borderRadius: 4 }}>
                          {a.estado}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, marginBottom: 6 }}>{a.descripcion}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>
                      {a.placas && <>🚛 {a.placas} · </>}
                      {a.operador_nombre && <>👤 {a.operador_nombre}</>}
                    </div>
                    {a.recomendacion && (
                      <div style={{ fontSize: 13, marginTop: 8, padding: 8, background: '#f9fafb', borderRadius: 6, color: '#374151' }}>
                        💡 <strong>IA recomienda:</strong> {a.recomendacion}
                      </div>
                    )}
                  </div>
                  {a.estado === 'pendiente' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => onAtender(a.id)} style={btnSmall}>Atender</button>
                      <button onClick={() => onResolver(a.id)}  style={{ ...btnSmall, background: '#16a34a', color: '#fff' }}>Resolver</button>
                      <button onClick={() => onDescartar(a.id)} style={{ ...btnSmall, background: '#f3f4f6' }}>Descartar</button>
                    </div>
                  )}
                  {a.estado === 'atendida' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => onResolver(a.id)}  style={{ ...btnSmall, background: '#16a34a', color: '#fff' }}>Resolver</button>
                      <button onClick={() => onDescartar(a.id)} style={{ ...btnSmall, background: '#f3f4f6' }}>Descartar</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabSupervisor({ resumen, onRefresh }) {
  const [llmDisponible, setLlmDisponible] = useState(resumen?.llm_disponible);
  const [modo, setModo] = useState(resumen?.llm_disponible ? 'chat' : 'briefing');
  const [mensajes, setMensajes] = useState([]); // [{role: 'user'|'assistant', text: '...'}]
  const [input, setInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorChat, setErrorChat] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (resumen?.llm_disponible !== undefined) setLlmDisponible(resumen.llm_disponible);
  }, [resumen]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  const enviar = async () => {
    const texto = input.trim();
    if (!texto || enviando) return;
    setErrorChat(null);
    setEnviando(true);
    const previo = [...mensajes];
    setMensajes([...previo, { role: 'user', text: texto }]);
    setInput('');
    try {
      const historialClaude = previo.map(m => ({
        role: m.role,
        content: m.text,
      }));
      const r = await api.caiSupervisorPreguntar(texto, historialClaude);
      setMensajes(curr => [...curr, {
        role: 'assistant',
        text: r.respuesta,
        usage: r.usage,
        eventos: r.eventos,
        iteraciones: r.iteraciones,
      }]);
    } catch (e) {
      setErrorChat(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const sugerencias = [
    '¿Cuál es el estado de la flota ahora?',
    '¿Qué alertas críticas tengo pendientes?',
    '¿Qué cliente debo cobrar primero?',
    '¿Qué documentos vencen este mes?',
    '¿Cuál es mi mejor operador?',
    'Dame el resumen del día',
  ];

  if (!resumen) return <div>Cargando supervisor...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>🤖 Supervisor IA</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setModo('chat')}
            style={{ ...btnSmall, background: modo === 'chat' ? '#1A1A1A' : '#fff', color: modo === 'chat' ? '#fff' : '#1A1A1A' }}>
            💬 Chat IA
          </button>
          <button onClick={() => setModo('briefing')}
            style={{ ...btnSmall, background: modo === 'briefing' ? '#1A1A1A' : '#fff', color: modo === 'briefing' ? '#fff' : '#1A1A1A' }}>
            📋 Briefing
          </button>
          <button onClick={onRefresh} style={btnSecondary}>↻</button>
        </div>
      </div>

      {modo === 'briefing' && (
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#fff', padding: 24, borderRadius: 14,
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 14, lineHeight: 1.8,
          whiteSpace: 'pre-wrap',
        }}>
          {resumen.texto}
        </div>
      )}

      {modo === 'chat' && !llmDisponible && (
        <ActivarChatIA onActivado={() => { setLlmDisponible(true); onRefresh(); }} />
      )}

      {modo === 'chat' && llmDisponible && (
        <div>
          <div ref={scrollRef} style={{
            background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12,
            padding: 16, height: 480, overflowY: 'auto', marginBottom: 12,
          }}>
            {mensajes.length === 0 ? (
              <div>
                <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 20px' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🤖</div>
                  <h4 style={{ margin: '0 0 8px', color: '#374151' }}>Pregúntame lo que necesites</h4>
                  <p style={{ fontSize: 13, marginBottom: 20 }}>
                    Tengo acceso a tu flota, alertas, operadores, diesel, cobranza y documentos. Pregúntame.
                  </p>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>Ejemplos:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sugerencias.map((s, i) => (
                    <button key={i} onClick={() => setInput(s)} style={{
                      background: '#fff', border: '1px solid #d1d5db', borderRadius: 999,
                      padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#374151',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              mensajes.map((m, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}>
                  <div style={{
                    maxWidth: '85%',
                    background: m.role === 'user' ? '#1B3A6B' : '#fff',
                    color: m.role === 'user' ? '#fff' : '#111',
                    border: m.role === 'user' ? 'none' : '1px solid #e5e7eb',
                    padding: '10px 14px',
                    borderRadius: 12,
                    whiteSpace: 'pre-wrap',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}>
                    {m.text}
                    {m.eventos && m.eventos.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: m.role === 'user' ? '#cbd5e1' : '#9ca3af', borderTop: '1px solid ' + (m.role === 'user' ? '#3b5998' : '#e5e7eb'), paddingTop: 6 }}>
                        🔍 Consultas: {m.eventos.map(e => e.nombre).join(', ')}
                        {m.usage && (
                          <span> · {(m.usage.input_tokens + m.usage.output_tokens).toLocaleString()} tokens
                            {m.usage.cache_read_input_tokens > 0 && ` (${m.usage.cache_read_input_tokens} cache hit)`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {enviando && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', padding: '10px 14px', borderRadius: 12, color: '#6b7280', fontSize: 13 }}>
                  Pensando<span style={{ animation: 'pulse 1s infinite' }}>...</span>
                </div>
              </div>
            )}
          </div>

          {errorChat && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
              ⚠️ {errorChat}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
              placeholder="Pregúntale al supervisor IA..."
              disabled={enviando}
              style={{
                flex: 1, padding: '12px 16px', fontSize: 14, borderRadius: 10,
                border: '1px solid #d1d5db', outline: 'none',
              }}
            />
            <button onClick={enviar} disabled={enviando || !input.trim()} style={btnPrimary}>
              {enviando ? '...' : 'Enviar'}
            </button>
            {mensajes.length > 0 && (
              <button onClick={() => setMensajes([])} style={btnSecondary} title="Limpiar conversación">🗑</button>
            )}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            Claude Sonnet 4.6 · Las respuestas se generan consultando tu BD en vivo · Prompt caching activo
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabScoring({ scoring, onSnapshot, snapping }) {
  if (!scoring) return <div>Cargando...</div>;
  const ops = scoring.operadores || [];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Ranking operadores · últimos {scoring.dias}d</h3>
        <button onClick={onSnapshot} disabled={snapping} style={btnPrimary}>
          {snapping ? 'Guardando...' : '📸 Guardar snapshot'}
        </button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {ops.map((o, idx) => {
          const scoreColor = o.score >= 90 ? '#16a34a' : o.score >= 75 ? '#d97706' : '#dc2626';
          return (
            <div key={o.operador_id} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14,
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#9ca3af', minWidth: 36 }}>#{idx + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{o.nombre}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  {o.viajes} viajes · {o.rend_lt_km ? `${fmt2(o.rend_lt_km)} lt/km` : 'sin datos diesel'} · {o.incidentes} incidentes
                </div>
              </div>
              <div style={{
                fontSize: 32, fontWeight: 900, color: scoreColor, minWidth: 80, textAlign: 'right',
              }}>{o.score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabDiesel({ baselines, onRecomputar, recomputando }) {
  if (!baselines) return <div>Cargando...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, flex: 1 }}>Baselines de diesel (rendimiento esperado lt/km)</h3>
        <button onClick={onRecomputar} disabled={recomputando} style={btnPrimary}>
          {recomputando ? 'Recalculando...' : '🧮 Recalcular baselines'}
        </button>
      </div>
      {baselines.length === 0 ? (
        <div style={{ padding: 30, background: '#fff7ed', borderRadius: 10, color: '#9a3412' }}>
          ⚠️ Aún no hay baselines calculados. Asegúrate de tener al menos 3 viajes completados por unidad y luego pulsa
          "Recalcular baselines".
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={th}>Unidad</th>
                <th style={th}>Destino</th>
                <th style={{ ...th, textAlign: 'right' }}>Rend. esperado</th>
                <th style={{ ...th, textAlign: 'right' }}>Desviación</th>
                <th style={{ ...th, textAlign: 'right' }}>Muestras</th>
                <th style={th}>Recalculado</th>
              </tr>
            </thead>
            <tbody>
              {baselines.map(b => (
                <tr key={b.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>{b.placas}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{b.descripcion}</div>
                  </td>
                  <td style={td}>{b.destino || <em style={{ color: '#6b7280' }}>General</em>}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                    {fmt2(b.rendimiento_esperado_lt_km)} lt/km
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>±{fmt2(b.rendimiento_desviacion)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{b.muestras}</td>
                  <td style={{ ...td, fontSize: 12, color: '#6b7280' }}>
                    {new Date(b.recalculado_en).toLocaleString('es-MX')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function TabComercial({ insights, onRefresh, cargando }) {
  if (!insights) return <div>Cargando insights comerciales...</div>;
  const { briefing, cobranza, riesgo, cotizaciones, precios } = insights;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>🧠 Asistente Comercial IA</h3>
        <button onClick={onRefresh} disabled={cargando} style={btnSecondary}>
          {cargando ? 'Cargando...' : '↻ Refrescar'}
        </button>
      </div>

      {briefing && (
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#fff', padding: 22, borderRadius: 14, marginBottom: 20,
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 13, lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
        }}>
          {briefing.texto}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        {/* Cobranza vencida */}
        <InsightCard
          title="💳 Cobranza vencida"
          color="#dc2626"
          count={cobranza?.count || 0}
          subtitle={cobranza?.count
            ? `$${(cobranza.total_vencido || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })} en riesgo`
            : 'Al corriente'}
          emptyMsg="Sin facturas vencidas. Cobranza al día ✓"
        >
          {(cobranza?.items || []).slice(0, 5).map(i => (
            <div key={i.id} style={rowInsight}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{i.cliente || 'Sin cliente'}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  Vencido {i.dias_vencido}d · {i.telefono || 'sin teléfono'}
                </div>
              </div>
              <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 13 }}>
                ${parseFloat(i.total || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </InsightCard>

        {/* Clientes en riesgo */}
        <InsightCard
          title="⚠️ Clientes en riesgo"
          color="#d97706"
          count={riesgo?.count || 0}
          subtitle={riesgo?.count ? `Sin actividad > 60 días` : 'Todos los clientes activos'}
          emptyMsg="Ningún cliente en riesgo de pérdida ✓"
        >
          {(riesgo?.items || []).slice(0, 5).map(i => (
            <div key={i.id} style={rowInsight}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{i.nombre}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {i.dias_sin_actividad ? `${i.dias_sin_actividad}d sin actividad` : 'Nunca contactado'}
                  {i.tipo && ` · ${i.tipo}`}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', textAlign: 'right' }}>
                ${parseFloat(i.valor_historico || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}
                <div style={{ fontSize: 10 }}>histórico</div>
              </div>
            </div>
          ))}
        </InsightCard>

        {/* Cotizaciones pendientes */}
        <InsightCard
          title="📄 Cotizaciones sin convertir"
          color="#2563eb"
          count={cotizaciones?.count || 0}
          subtitle={cotizaciones?.count
            ? `Potencial $${(cotizaciones.total_potencial || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
            : 'Sin cotizaciones pendientes'}
          emptyMsg="No hay cotizaciones esperando conversión"
        >
          {(cotizaciones?.items || []).slice(0, 5).map(i => (
            <div key={i.id} style={rowInsight}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{i.folio || `#${i.id}`} · {i.cliente || 'Sin cliente'}</div>
                <div style={{ fontSize: 11, color: i.vencida ? '#dc2626' : '#6b7280' }}>
                  {i.dias_desde_emision}d desde emisión {i.vencida && '· VENCIDA'}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#2563eb' }}>
                ${parseFloat(i.total || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </InsightCard>

        {/* Precios por ruta */}
        <InsightCard
          title="🗺️ Precios sugeridos por ruta"
          color="#16a34a"
          count={precios?.count || 0}
          subtitle={precios?.count ? `Histórico últimos 180 días` : 'Sin datos suficientes'}
          emptyMsg="Necesitas al menos 2 viajes por ruta para sugerencias"
        >
          {(precios?.items || []).slice(0, 5).map((i, idx) => (
            <div key={idx} style={rowInsight}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {i.origen || '?'} → {i.destino}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  {i.viajes} viajes · {i.km_promedio ? `${i.km_promedio} km` : 'sin km'}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#16a34a', textAlign: 'right' }}>
                {i.precio_promedio
                  ? `$${i.precio_promedio.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
                  : <span style={{ color: '#9ca3af', fontWeight: 400, fontSize: 11 }}>diesel ${i.diesel_promedio}</span>}
              </div>
            </div>
          ))}
        </InsightCard>
      </div>
    </div>
  );
}

function InsightCard({ title, color, count, subtitle, emptyMsg, children }) {
  const hasContent = React.Children.count(children) > 0;
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderTop: `3px solid ${color}`,
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1 }}>{count}</div>
      </div>
      {hasContent
        ? <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>{children}</div>
        : <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>{emptyMsg}</div>}
    </div>
  );
}

const rowInsight = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 0', borderBottom: '1px solid #f9fafb',
};

// ══════════════════════════════════════════════════════════════════
function TabAutomatizaciones() {
  const [estado, setEstado] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [disparando, setDisparando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [e, h] = await Promise.all([
        api.cronEstado(),
        api.cronHistorial(50).catch(() => []),
      ]);
      setEstado(e); setHistorial(h);
    } catch (err) { console.error(err); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const disparar = async (nombre) => {
    setDisparando(nombre);
    try {
      const r = await api.cronDisparar(nombre);
      alert(`✓ ${nombre} ejecutado en ${r.duracion_ms}ms\n\n${JSON.stringify(r.resultado, null, 2)}`);
      await cargar();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally { setDisparando(null); }
  };

  const SCHEDULES_HUMANOS = {
    '*/5 * * * *': 'Cada 5 minutos',
    '0 6 * * *': 'Diario 6:00 AM (MX)',
    '0 8 * * *': 'Diario 8:00 AM (MX)',
    '0 3 * * 1': 'Lunes 3:00 AM (MX)',
  };

  if (cargando) return <div>Cargando...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0 }}>⚙️ Automatizaciones</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            El sistema corre estos jobs solo. Puedes dispararlos manualmente para probarlos.
          </p>
        </div>
        <button onClick={cargar} style={btnSecondary}>↻ Refrescar</button>
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
        {(estado || []).map(j => (
          <div key={j.nombre} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1, minWidth: 250 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {j.activo && <span style={{ color: '#16a34a' }}>● </span>}
                {j.nombre.replace(/_/g, ' ').toUpperCase()}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {SCHEDULES_HUMANOS[j.schedule] || j.schedule} · {j.descripcion}
              </div>
            </div>
            <button
              onClick={() => disparar(j.nombre)}
              disabled={disparando === j.nombre}
              style={btnPrimary}
            >
              {disparando === j.nombre ? 'Ejecutando...' : '▶ Ejecutar ahora'}
            </button>
          </div>
        ))}
      </div>

      <h3 style={{ margin: '0 0 12px' }}>📜 Historial reciente</h3>
      {historial.length === 0 ? (
        <div style={{ padding: 20, background: '#f9fafb', borderRadius: 10, color: '#6b7280', fontSize: 13 }}>
          Sin ejecuciones aún. Los jobs empezarán a aparecer aquí conforme se ejecuten.
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                <th style={th}>Cuándo</th>
                <th style={th}>Job</th>
                <th style={th}>Fuente</th>
                <th style={th}>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {historial.map(h => {
                const ok = h.detalle?.resultado && !h.detalle?.error;
                return (
                  <tr key={h.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={td}>{new Date(h.created_at).toLocaleString('es-MX')}</td>
                    <td style={td}>
                      <span style={{ fontWeight: 600 }}>{h.accion.replace('cron_', '').replace('_manual', '')}</span>
                      {h.accion.endsWith('_manual') && (
                        <span style={{ marginLeft: 6, fontSize: 11, background: '#dbeafe', color: '#1e3a8a', padding: '1px 6px', borderRadius: 4 }}>manual</span>
                      )}
                    </td>
                    <td style={td}>{h.ip || '—'}</td>
                    <td style={td}>
                      {ok
                        ? <span style={{ color: '#16a34a' }}>✓ OK {h.detalle?.resultado?.duracion_ms ? `(${h.detalle.resultado.duracion_ms}ms)` : ''}</span>
                        : <span style={{ color: '#dc2626' }}>✗ {h.detalle?.error || 'Sin datos'}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
function ActivarChatIA({ onActivado }) {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';
  const [apiKey, setApiKey] = useState('');
  const [activando, setActivando] = useState(false);
  const [mensaje, setMensaje] = useState(null);

  const activar = async () => {
    if (!apiKey.trim()) return;
    setActivando(true);
    setMensaje(null);
    try {
      await api.caiApiKeyGuardar('anthropic_api_key', apiKey.trim());
      setMensaje({ tipo: 'ok', txt: '✅ API key activada. El chat IA ya está listo.' });
      setApiKey('');
      setTimeout(() => onActivado(), 1500);
    } catch (e) {
      setMensaje({ tipo: 'error', txt: e.message });
    } finally {
      setActivando(false);
    }
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
      border: '1px solid #d97706', borderRadius: 14, padding: 24,
    }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ fontSize: 36 }}>🤖</div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 6px', color: '#78350f' }}>Activa el Supervisor IA conversacional</h3>
          <p style={{ margin: 0, color: '#78350f', fontSize: 14, lineHeight: 1.5 }}>
            Chat con Claude Sonnet 4.6 que consulta tu BD en vivo. Costo aproximado <strong>$0.01 USD por pregunta</strong> (~500 preguntas con $5 USD).
          </p>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#374151' }}>📝 Cómo obtener tu API key (2 minutos):</div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#374151', lineHeight: 1.7 }}>
          <li>Abre <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#1B3A6B', fontWeight: 600 }}>console.anthropic.com</a> y regístrate (gratis)</li>
          <li>En el dashboard agrega saldo: mínimo <strong>$5 USD</strong> (botón "Buy credits")</li>
          <li>Ve a <strong>Settings → API Keys → Create Key</strong></li>
          <li>Copia el key que empieza con <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>sk-ant-api03-...</code></li>
          <li>Pégalo aquí abajo</li>
        </ol>
      </div>

      {esDirector ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 16 }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>
            🔑 Tu API key de Anthropic
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            disabled={activando}
            style={{
              width: '100%', padding: '10px 14px', fontSize: 14,
              borderRadius: 8, border: '1px solid #d1d5db', outline: 'none',
              fontFamily: 'ui-monospace, "SF Mono", monospace',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={activar} disabled={activando || !apiKey.trim()} style={btnPrimary}>
              {activando ? 'Validando con Anthropic...' : '⚡ Activar Supervisor IA'}
            </button>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              Valido la key con Anthropic antes de guardar — si está mal, te aviso.
            </span>
          </div>
          {mensaje && (
            <div style={{
              marginTop: 12, padding: 10, borderRadius: 8, fontSize: 13,
              background: mensaje.tipo === 'ok' ? '#dcfce7' : '#fee2e2',
              color: mensaje.tipo === 'ok' ? '#166534' : '#991b1b',
            }}>{mensaje.txt}</div>
          )}
          <div style={{ marginTop: 14, fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>
            🔒 La key se guarda en tu base de datos privada (Railway Postgres). Solo el rol Director puede agregarla/cambiarla.
            Se valida en vivo contra Anthropic antes de guardar — keys inválidas no se persisten.
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 10, padding: 16, fontSize: 13, color: '#78350f' }}>
          ⚠️ Solo el rol <strong>Director</strong> puede configurar la API key. Pídele al director que la agregue.
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function CommandAI() {
  const [tab,        setTab]        = useState('dashboard');
  const [data,       setData]       = useState(null);
  const [alertas,    setAlertas]    = useState([]);
  const [resumen,    setResumen]    = useState(null);
  const [scoring,    setScoring]    = useState(null);
  const [baselines,  setBaselines]  = useState(null);
  const [insights,   setInsights]   = useState(null);
  const [insightsCargando, setInsightsCargando] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [evaluando,   setEvaluando]   = useState(false);
  const [snapping,    setSnapping]    = useState(false);
  const [recomputando, setRecomputando] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const cargarTodo = useCallback(async () => {
    setError(null);
    try {
      const [d, a, r, s, b, i] = await Promise.all([
        api.caiDashboard(),
        api.caiAlertas('?estado=pendiente&limit=50').catch(() => []),
        api.caiSupervisor().catch(() => null),
        api.caiScoring(30).catch(() => ({ dias: 30, operadores: [] })),
        api.caiDieselBaselines().catch(() => []),
        api.caiInsightsAll().catch(() => null),
      ]);
      setData(d); setAlertas(a); setResumen(r); setScoring(s); setBaselines(b); setInsights(i);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Error al cargar datos');
    }
  }, []);

  const recargarInsights = async () => {
    setInsightsCargando(true);
    try { setInsights(await api.caiInsightsAll()); }
    catch (e) { alert('Error: ' + e.message); }
    finally { setInsightsCargando(false); }
  };

  useEffect(() => { cargarTodo(); }, [cargarTodo]);

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (autoRefresh) {
      intervalRef.current = setInterval(cargarTodo, 30000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, cargarTodo]);

  const evaluar = async () => {
    setEvaluando(true);
    try {
      const r = await api.caiEvaluarAlertas();
      alert(`Evaluadas: ${r.evaluadas}\nNuevas: ${r.creadas}`);
      await cargarTodo();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally { setEvaluando(false); }
  };

  const atender = async (id) => {
    try { await api.caiAtenderAlerta(id); await cargarTodo(); }
    catch (e) { alert('Error: ' + e.message); }
  };
  const resolver = async (id) => {
    const notas = prompt('Notas de resolución (opcional):');
    if (notas === null) return;
    try { await api.caiResolverAlerta(id, notas); await cargarTodo(); }
    catch (e) { alert('Error: ' + e.message); }
  };
  const descartar = async (id) => {
    const notas = prompt('Motivo (opcional):');
    if (notas === null) return;
    try { await api.caiDescartarAlerta(id, notas); await cargarTodo(); }
    catch (e) { alert('Error: ' + e.message); }
  };

  const snapshot = async () => {
    setSnapping(true);
    try {
      const r = await api.caiScoringSnapshot(30);
      alert(`Snapshot guardado para ${r.operadores} operadores.`);
      await cargarTodo();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSnapping(false); }
  };

  const recomputarBaselines = async () => {
    setRecomputando(true);
    try {
      const r = await api.caiDieselRecomputar();
      alert(`Baselines: ${r.generales} generales, ${r.por_destino} por destino.`);
      await cargarTodo();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setRecomputando(false); }
  };

  const totalAlertasCriticas = alertas.filter(a => a.nivel === 'critico').length;

  const tabs = [
    { id: 'dashboard',     label: 'Dashboard',       icon: '📊' },
    { id: 'alertas',       label: `Alertas${totalAlertasCriticas ? ` (${totalAlertasCriticas})` : ''}`, icon: '🚨' },
    { id: 'comercial',     label: 'Comercial IA',    icon: '🧠' },
    { id: 'supervisor',    label: 'Supervisor IA',   icon: '🤖' },
    { id: 'scoring',       label: 'Scoring',         icon: '⭐' },
    { id: 'diesel',        label: 'Diesel forense',  icon: '⛽' },
    { id: 'automatizaciones', label: 'Automatizaciones', icon: '⚙️' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🚀 Andreu Logistics — Command AI</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Centro de control inteligente · alertas en vivo · supervisor IA · scoring · diesel forense
          </p>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #dc2626', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={tabs} />

      {tab === 'dashboard'  && <TabDashboard data={data} onRefresh={cargarTodo} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} />}
      {tab === 'alertas'    && <TabAlertas alertas={alertas} onEvaluar={evaluar} onAtender={atender} onResolver={resolver} onDescartar={descartar} evaluando={evaluando} />}
      {tab === 'comercial'  && <TabComercial insights={insights} onRefresh={recargarInsights} cargando={insightsCargando} />}
      {tab === 'supervisor' && <TabSupervisor resumen={resumen} onRefresh={cargarTodo} />}
      {tab === 'scoring'    && <TabScoring scoring={scoring} onSnapshot={snapshot} snapping={snapping} />}
      {tab === 'diesel'     && <TabDiesel baselines={baselines} onRecomputar={recomputarBaselines} recomputando={recomputando} />}
      {tab === 'automatizaciones' && <TabAutomatizaciones />}
    </div>
  );
}

// ── Estilos inline reutilizables ─────────────────────────────────
const th = { padding: '12px 14px', fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const td = { padding: '12px 14px' };
const btnPrimary = {
  padding: '8px 16px', background: '#1A1A1A', color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600,
};
const btnSecondary = {
  padding: '8px 14px', background: '#fff', color: '#1A1A1A',
  border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 13,
};
const btnSmall = {
  padding: '5px 12px', background: '#fff', color: '#1A1A1A',
  border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  whiteSpace: 'nowrap',
};
