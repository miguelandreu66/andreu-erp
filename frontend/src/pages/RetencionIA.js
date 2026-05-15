import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtFecha = ts => ts ? new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

const CLASIFICACIONES = {
  nuevo:           { emoji: '🆕', label: 'Nuevo',           color: '#3b82f6', bg: '#dbeafe', desc: 'Primer viaje recién' },
  en_crecimiento:  { emoji: '📈', label: 'En crecimiento',  color: '#16a34a', bg: '#dcfce7', desc: '+30% vs mes anterior' },
  recurrente:      { emoji: '🤝', label: 'Recurrente',      color: '#7c3aed', bg: '#ede9fe', desc: '5+ viajes en 90d' },
  estable:         { emoji: '⚖️', label: 'Estable',         color: '#6b7280', bg: '#f3f4f6', desc: 'Sin cambios significativos' },
  en_riesgo:       { emoji: '⚠️', label: 'En riesgo',       color: '#d97706', bg: '#fef3c7', desc: 'Cayó >50% último mes' },
  inactivo:        { emoji: '💤', label: 'Inactivo',        color: '#dc2626', bg: '#fee2e2', desc: 'Sin actividad 60+ días' },
  perdido:         { emoji: '❌', label: 'Perdido',         color: '#991b1b', bg: '#fef2f2', desc: 'Sin actividad 120+ días' },
};

const TIPOS_ACCION = {
  bienvenida_nuevo:           { emoji: '👋', label: 'Bienvenida nuevo' },
  agradecimiento_crecimiento: { emoji: '🚀', label: 'Agradecimiento crecimiento' },
  oferta_contrato_anual:      { emoji: '📜', label: 'Oferta contrato anual' },
  preventivo_en_riesgo:       { emoji: '⚠️', label: 'Preventivo en riesgo' },
  reactivacion_inactivo:      { emoji: '💤', label: 'Reactivación inactivo' },
  ultimo_intento_perdido:     { emoji: '🙏', label: 'Último intento' },
  nps_survey:                 { emoji: '⭐', label: 'NPS Survey' },
  descuento_personalizado:    { emoji: '💰', label: 'Descuento personalizado' },
  manual:                     { emoji: '✋', label: 'Manual' },
};

export default function RetencionIA() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';
  const esAdmin = ['director','admin'].includes(usuario?.rol);

  const [data, setData] = useState(null);
  const [acciones, setAcciones] = useState([]);
  const [segmento, setSegmento] = useState(null);
  const [segmentoData, setSegmentoData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('segmentos');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [corriendoCiclo, setCorriendoCiclo] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const [accionDetalle, setAccionDetalle] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        api.retencionDashboard(),
        api.retencionAcciones(filtroEstado === 'todos' ? '?limit=100' : `?estado=${filtroEstado}&limit=100`),
      ]);
      setData(d);
      setAcciones(a || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const cargarSegmento = async (clasif) => {
    setSegmento(clasif);
    try { setSegmentoData(await api.retencionSegmento(clasif)); }
    catch (e) { setError(e.message); }
  };

  const correrCiclo = async (soloScoring = false) => {
    const conf = soloScoring
      ? '¿Calcular scoring de TODOS los clientes? Esto NO envía mensajes, solo actualiza la clasificación.'
      : '¿Correr ciclo completo? Esto actualiza scoring Y envía mensajes a clientes según su clasificación. ¿Estás seguro?';
    if (!window.confirm(conf)) return;
    setCorriendoCiclo(true);
    try {
      const r = await api.retencionCorrerCiclo(soloScoring);
      alert(`✅ Ciclo terminado en ${(r.duracion_ms/1000).toFixed(1)}s\n\nClientes scoreados: ${r.scoreados}\nAcciones intentadas: ${r.acciones_intentadas}\nExitosas: ${r.acciones_exitosas}\nFallidas: ${r.acciones_fallidas}\nOmitidos cooldown: ${r.omitidos_cooldown}\nRecuperados detectados: ${r.recuperados_detectados}`);
      await cargar();
    } catch (e) { alert(e.message); }
    finally { setCorriendoCiclo(false); }
  };

  if (loading && !data) return <div className="empty">Cargando Retención IA...</div>;

  const funnel = data?.funnel || {};
  const stats = data?.stats || {};
  const activa = data?.activa;
  const totalClientes = funnel.total || 0;
  const tasaRetencion = totalClientes > 0
    ? Math.round((1 - ((funnel.inactivos || 0) + (funnel.perdidos || 0)) / totalClientes) * 100)
    : 100;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🔄 Retención Autopilot</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Detecta clientes inactivos, en riesgo o en crecimiento. Manda mensajes automáticos con descuentos
            personalizados para recuperarlos. Trackea si volvieron a operar después del contacto.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            background: activa ? '#dcfce7' : '#fee2e2',
            color: activa ? '#166534' : '#991b1b',
            padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
          }}>{activa ? '✅ ACTIVA' : '⛔ INACTIVA'}</span>
          {esDirector && (
            <>
              <button onClick={() => correrCiclo(true)} disabled={corriendoCiclo} className="btn btn-ghost">
                📊 Solo Scoring
              </button>
              <button onClick={() => correrCiclo(false)} disabled={corriendoCiclo} className="btn btn-primary">
                {corriendoCiclo ? 'Corriendo...' : '⚡ Correr ciclo ahora'}
              </button>
              <button onClick={() => setConfigurando(true)} className="btn btn-ghost">⚙️</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="alert red" style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{error}</div></div>}

      {/* KPIs principales */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="👥 Clientes total"      value={totalClientes} color="#1B3A6B" />
        <Stat label="📊 Tasa retención"      value={`${tasaRetencion}%`} color={tasaRetencion >= 75 ? '#16a34a' : tasaRetencion >= 50 ? '#d97706' : '#991b1b'} />
        <Stat label="📤 Enviadas (30d)"      value={stats.enviadas_30d || 0} color="#3b82f6" />
        <Stat label="🎉 Recuperados (30d)"   value={stats.recuperados_30d || 0} color="#16a34a" />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'segmentos', l: '🎯 Segmentación' },
          { id: 'acciones',  l: `📤 Acciones (${acciones.length})` },
          { id: 'tipos',     l: '📊 Performance por tipo' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
              background: tab === t.id ? '#1B3A6B' : '#fff',
              color: tab === t.id ? '#fff' : '#1B3A6B',
              border: '1px solid #1B3A6B', fontWeight: tab === t.id ? 700 : 500,
            }}>{t.l}</button>
        ))}
      </div>

      {tab === 'segmentos' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 16 }}>
            {Object.entries(CLASIFICACIONES).map(([k, v]) => {
              const cantidad = funnel[k === 'en_crecimiento' ? 'en_crecimiento' : k === 'en_riesgo' ? 'en_riesgo' : k + 's'] || 0;
              return (
                <SegmentoCard key={k} clasif={k} info={v} cantidad={cantidad}
                  total={totalClientes}
                  onClick={() => cargarSegmento(k)} activo={segmento === k} />
              );
            })}
          </div>
          {segmento && (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', padding: 16 }}>
              <h3 style={{ margin: '0 0 12px' }}>
                {CLASIFICACIONES[segmento]?.emoji} Clientes "{CLASIFICACIONES[segmento]?.label}" ({segmentoData.length})
              </h3>
              {segmentoData.length === 0 ? (
                <p style={{ color: '#6b7280' }}>Sin clientes en este segmento.</p>
              ) : (
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      <th style={th}>Cliente</th>
                      <th style={th}>Tipo</th>
                      <th style={{ ...th, textAlign: 'right' }}>Viajes 30d</th>
                      <th style={{ ...th, textAlign: 'right' }}>Cambio %</th>
                      <th style={{ ...th, textAlign: 'right' }}>LTV</th>
                      <th style={{ ...th, textAlign: 'right' }}>Score</th>
                      <th style={th}>Días inactivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segmentoData.map(s => (
                      <tr key={s.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                        <td style={td}><strong>{s.nombre}</strong></td>
                        <td style={td}>{s.tipo || '—'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{s.viajes_30d}</td>
                        <td style={{ ...td, textAlign: 'right', color: s.cambio_ingresos_pct >= 0 ? '#16a34a' : '#991b1b', fontWeight: 600 }}>
                          {s.cambio_ingresos_pct >= 0 ? '+' : ''}{(s.cambio_ingresos_pct || 0).toFixed(0)}%
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt$(s.ltv)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{s.score_retencion}</td>
                        <td style={td}>{s.dias_sin_actividad}d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'acciones' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <FiltroBtn label="Todas" activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            <FiltroBtn label="📤 Enviadas" activo={filtroEstado === 'enviada'} onClick={() => setFiltroEstado('enviada')} />
            <FiltroBtn label="⚠️ Fallidas" activo={filtroEstado === 'fallida'} onClick={() => setFiltroEstado('fallida')} />
            <FiltroBtn label="📅 Programadas" activo={filtroEstado === 'programada'} onClick={() => setFiltroEstado('programada')} />
          </div>
          {acciones.length === 0 ? (
            <EmptyState icono="📤" titulo="Sin acciones todavía"
              texto="Cuando corras el ciclo de retención (manual o auto), aparecerán aquí los mensajes enviados con su resultado." />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {acciones.map(a => <AccionCard key={a.id} a={a} onAbrir={() => setAccionDetalle(a.id)} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'tipos' && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>Tipo de acción</th>
                <th style={{ ...th, textAlign: 'right' }}>Total 90d</th>
                <th style={{ ...th, textAlign: 'right' }}>Enviadas</th>
                <th style={{ ...th, textAlign: 'right' }}>Recuperados</th>
                <th style={{ ...th, textAlign: 'right' }}>Tasa éxito</th>
              </tr>
            </thead>
            <tbody>
              {(data?.por_tipo_accion || []).map(t => {
                const tasa = t.enviadas > 0 ? (t.recuperados / t.enviadas) * 100 : 0;
                const tipoInfo = TIPOS_ACCION[t.tipo_accion] || {};
                return (
                  <tr key={t.tipo_accion} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={td}>{tipoInfo.emoji} {tipoInfo.label || t.tipo_accion}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{t.n}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{t.enviadas}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{t.recuperados}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                      color: tasa >= 25 ? '#16a34a' : tasa >= 10 ? '#d97706' : '#6b7280' }}>
                      {tasa.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {accionDetalle && (
        <ModalDetalleAccion id={accionDetalle} onClose={() => setAccionDetalle(null)} />
      )}

      {configurando && (
        <ModalConfig onClose={() => setConfigurando(false)} onGuardado={() => { setConfigurando(false); cargar(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value" style={{ color, marginTop: 4 }}>{value}</div></div>;
}

function FiltroBtn({ label, activo, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
      background: activo ? '#1A1A1A' : '#fff', color: activo ? '#fff' : '#374151',
      border: '1px solid ' + (activo ? '#1A1A1A' : '#d1d5db'), fontWeight: activo ? 600 : 400,
    }}>{label}</button>
  );
}

function EmptyState({ icono, titulo, texto }) {
  return (
    <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>{icono}</div>
      <h3 style={{ margin: '0 0 6px' }}>{titulo}</h3>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>{texto}</p>
    </div>
  );
}

function SegmentoCard({ clasif, info, cantidad, total, onClick, activo }) {
  const pct = total > 0 ? (cantidad / total) * 100 : 0;
  return (
    <button onClick={onClick} style={{
      background: '#fff', border: '1px solid ' + (activo ? info.color : '#e5e7eb'),
      borderLeft: `4px solid ${info.color}`,
      borderRadius: 10, padding: 14, cursor: 'pointer', textAlign: 'left',
      boxShadow: activo ? '0 0 0 2px ' + info.bg : 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 22 }}>{info.emoji}</span>
        <span style={{ fontSize: 24, fontWeight: 800, color: info.color }}>{cantidad}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{info.label}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{info.desc}</div>
      <div style={{ marginTop: 8, height: 4, background: '#f3f4f6', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: info.color, borderRadius: 2 }} />
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>{pct.toFixed(0)}% del total</div>
    </button>
  );
}

function AccionCard({ a, onAbrir }) {
  const tipo = TIPOS_ACCION[a.tipo_accion] || {};
  const estadoBg = a.estado === 'enviada' ? '#dcfce7'
    : a.estado === 'fallida' ? '#fee2e2'
    : a.estado === 'respondida' ? '#dbeafe'
    : '#f3f4f6';
  const estadoColor = a.estado === 'enviada' ? '#166534'
    : a.estado === 'fallida' ? '#991b1b'
    : a.estado === 'respondida' ? '#1e3a8a'
    : '#6b7280';

  return (
    <div onClick={onAbrir} style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, cursor: 'pointer',
      borderLeft: a.cliente_recupero ? '4px solid #16a34a' : '4px solid #e5e7eb',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ background: estadoBg, color: estadoColor, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {a.estado}
            </span>
            <span style={{ fontSize: 12 }}>{tipo.emoji} {tipo.label || a.tipo_accion}</span>
            <span style={{ fontSize: 11, color: '#6b7280' }}>via {a.canal}</span>
            {a.cliente_recupero && <span style={{ background: '#16a34a', color: '#fff', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>🎉 RECUPERADO</span>}
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.cliente_nombre}</div>
          <div style={{ fontSize: 12, color: '#374151', fontStyle: 'italic', maxWidth: 700,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            "{a.mensaje}"
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 100 }}>
          {a.descuento_ofrecido_pct > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Descuento</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#E87722' }}>-{a.descuento_ofrecido_pct}%</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{fmtFecha(a.enviado_at || a.created_at)}</div>
        </div>
      </div>
    </div>
  );
}

function ModalDetalleAccion({ id, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.retencionAccionDetalle(id).then(setData).catch(() => {}); }, [id]);
  if (!data) return null;
  const tipo = TIPOS_ACCION[data.tipo_accion] || {};

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 660, width: '100%', padding: 24, maxHeight: '90vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>{tipo.emoji} {tipo.label}</div>
            <h2 style={{ margin: 0 }}>{data.cliente_nombre}</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{data.cliente_tipo || '—'} · {data.canal}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div style={{ background: '#f0f9ff', borderLeft: '4px solid #1B3A6B', padding: 14, borderRadius: 6, marginBottom: 14 }}>
          <strong style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>📝 Mensaje enviado</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{data.mensaje}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
          <Campo label="Estado" valor={data.estado} />
          <Campo label="Descuento" valor={data.descuento_ofrecido_pct ? `${data.descuento_ofrecido_pct}%` : '—'} />
          <Campo label="Cooldown" valor={data.cliente_recupero ? '🎉 RECUPERADO' : data.cliente_respondio ? '💬 Respondió' : '⏳ Esperando'} />
          <Campo label="Enviado" valor={fmtFecha(data.enviado_at)} />
        </div>

        <div style={{ background: '#f9fafb', padding: 12, borderRadius: 8, fontSize: 12 }}>
          <strong style={{ color: '#6b7280', textTransform: 'uppercase' }}>📊 Contexto del cliente</strong>
          <div style={{ marginTop: 6, lineHeight: 1.7 }}>
            • {data.viajes_total || 0} viajes totales · {data.viajes_30d || 0} en últimos 30d · {data.viajes_90d || 0} en 90d<br/>
            • LTV: <strong>{fmt$(data.ltv || 0)}</strong><br/>
            • Cambio últimos 30d: <strong style={{ color: data.cambio_ingresos_pct >= 0 ? '#16a34a' : '#991b1b' }}>
              {data.cambio_ingresos_pct >= 0 ? '+' : ''}{(data.cambio_ingresos_pct || 0).toFixed(0)}%
            </strong><br/>
            • Días sin actividad: <strong>{data.dias_sin_actividad || 0}</strong>
          </div>
        </div>

        {data.error_mensaje && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginTop: 10, fontSize: 12 }}>
            ⚠️ Error: {data.error_mensaje}
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ label, valor }) {
  return (
    <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{valor || '—'}</div>
    </div>
  );
}

function ModalConfig({ onClose, onGuardado }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.retencionConfig().then(c => {
      setCfg(c);
      const init = {};
      for (const [k, v] of Object.entries(c)) init[k] = v.valor;
      setForm(init);
    });
  }, []);

  if (!cfg) return null;

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.retencionGuardarConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 620, width: '100%', padding: 24, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Configuración de Retención IA</h2>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.retencion_activa === 'true'}
              onChange={e => setForm({ ...form, retencion_activa: e.target.checked ? 'true' : 'false' })} />
            <strong>Retención IA activa</strong> — envía mensajes automáticos cada día 9 AM
          </label>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Canal preferente</label>
            <select value={form.retencion_canal_default} onChange={e => setForm({ ...form, retencion_canal_default: e.target.value })}>
              <option value="whatsapp">WhatsApp (recomendado)</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Cooldown (días entre mensajes)</label>
            <input type="number" min="3" max="60" value={form.retencion_cooldown_dias}
              onChange={e => setForm({ ...form, retencion_cooldown_dias: e.target.value })} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Horario inicio</label>
            <input type="time" value={form.retencion_horario_inicio}
              onChange={e => setForm({ ...form, retencion_horario_inicio: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Horario fin</label>
            <input type="time" value={form.retencion_horario_fin}
              onChange={e => setForm({ ...form, retencion_horario_fin: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Descuento máximo permitido (%)</label>
          <input type="number" step="0.5" min="0" max="30" value={form.retencion_descuento_max_pct}
            onChange={e => setForm({ ...form, retencion_descuento_max_pct: e.target.value })} />
          <small style={{ color: '#6b7280', fontSize: 11 }}>
            Tope del descuento que la IA puede ofrecer sin tu aprobación.
          </small>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.retencion_usar_claude === 'true'}
              onChange={e => setForm({ ...form, retencion_usar_claude: e.target.checked ? 'true' : 'false' })} />
            <strong>Personalizar mensajes con Claude</strong>
          </label>
          <small style={{ color: '#6b7280', fontSize: 11 }}>
            Si activo, Claude Haiku redacta cada mensaje personalizado con el historial del cliente (~$0.001 por mensaje). Si no, usa templates.
          </small>
        </div>

        <details style={{ marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>
            🔧 Umbrales de clasificación (avanzado)
          </summary>
          <div style={{ marginTop: 10 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Días para "nuevo"</label>
                <input type="number" value={form.retencion_dias_nuevo} onChange={e => setForm({ ...form, retencion_dias_nuevo: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Días para "inactivo"</label>
                <input type="number" value={form.retencion_dias_inactivo} onChange={e => setForm({ ...form, retencion_dias_inactivo: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Días para "perdido"</label>
                <input type="number" value={form.retencion_dias_perdido} onChange={e => setForm({ ...form, retencion_dias_perdido: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Viajes para "recurrente" (90d)</label>
                <input type="number" value={form.retencion_viajes_recurrente} onChange={e => setForm({ ...form, retencion_viajes_recurrente: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">% caída para "en_riesgo"</label>
                <input type="number" value={form.retencion_umbral_riesgo_pct} onChange={e => setForm({ ...form, retencion_umbral_riesgo_pct: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">% crecimiento para "en_crecimiento"</label>
                <input type="number" value={form.retencion_umbral_crecimiento_pct} onChange={e => setForm({ ...form, retencion_umbral_crecimiento_pct: e.target.value })} />
              </div>
            </div>
          </div>
        </details>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
