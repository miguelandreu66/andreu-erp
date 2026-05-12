import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';

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
  if (!resumen) return <div>Cargando...</div>;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>🤖 Supervisor IA</h3>
        <button onClick={onRefresh} style={btnSecondary}>↻ Regenerar</button>
      </div>
      <div style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        color: '#fff', padding: 24, borderRadius: 14,
        fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 14, lineHeight: 1.8,
        whiteSpace: 'pre-wrap',
      }}>
        {resumen.texto}
      </div>
      <div style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
        Fase 1: resumen determinístico generado desde reglas y queries del ERP.
        Fase 2 (siguiente sprint): conexión a Claude API con tool-use para razonamiento profundo.
      </div>
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
export default function CommandAI() {
  const [tab,        setTab]        = useState('dashboard');
  const [data,       setData]       = useState(null);
  const [alertas,    setAlertas]    = useState([]);
  const [resumen,    setResumen]    = useState(null);
  const [scoring,    setScoring]    = useState(null);
  const [baselines,  setBaselines]  = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [evaluando,   setEvaluando]   = useState(false);
  const [snapping,    setSnapping]    = useState(false);
  const [recomputando, setRecomputando] = useState(false);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  const cargarTodo = useCallback(async () => {
    setError(null);
    try {
      const [d, a, r, s, b] = await Promise.all([
        api.caiDashboard(),
        api.caiAlertas('?estado=pendiente&limit=50').catch(() => []),
        api.caiSupervisor().catch(() => null),
        api.caiScoring(30).catch(() => ({ dias: 30, operadores: [] })),
        api.caiDieselBaselines().catch(() => []),
      ]);
      setData(d); setAlertas(a); setResumen(r); setScoring(s); setBaselines(b);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Error al cargar datos');
    }
  }, []);

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
    { id: 'dashboard',  label: 'Dashboard',     icon: '📊' },
    { id: 'alertas',    label: `Alertas${totalAlertasCriticas ? ` (${totalAlertasCriticas})` : ''}`, icon: '🚨' },
    { id: 'supervisor', label: 'Supervisor IA', icon: '🤖' },
    { id: 'scoring',    label: 'Scoring',       icon: '⭐' },
    { id: 'diesel',     label: 'Diesel forense', icon: '⛽' },
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
      {tab === 'supervisor' && <TabSupervisor resumen={resumen} onRefresh={cargarTodo} />}
      {tab === 'scoring'    && <TabScoring scoring={scoring} onSnapshot={snapshot} snapping={snapping} />}
      {tab === 'diesel'     && <TabDiesel baselines={baselines} onRecomputar={recomputarBaselines} recomputando={recomputando} />}
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
