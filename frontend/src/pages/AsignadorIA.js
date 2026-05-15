import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
const fmtFecha = ts => ts ? new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const ESTADOS = {
  sugerida:  { bg: '#dbeafe', color: '#1e3a8a', emoji: '💡', label: 'Sugerida' },
  aprobada:  { bg: '#fef3c7', color: '#92400e', emoji: '⏳', label: 'Aprobada' },
  aplicada:  { bg: '#dcfce7', color: '#166534', emoji: '✅', label: 'Aplicada' },
  rechazada: { bg: '#fee2e2', color: '#991b1b', emoji: '❌', label: 'Rechazada' },
  expirada:  { bg: '#f3f4f6', color: '#6b7280', emoji: '⏰', label: 'Expirada' },
};

const CONFIANZA = {
  alta:  { color: '#16a34a', emoji: '🟢' },
  media: { color: '#d97706', emoji: '🟡' },
  baja:  { color: '#dc2626', emoji: '🔴' },
};

export default function AsignadorIA() {
  const { usuario } = useAuth();
  const esAdmin = ['director','admin'].includes(usuario?.rol);
  const esDirector = usuario?.rol === 'director';

  const [data, setData] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [tab, setTab] = useState('pendientes');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sugiriendo, setSugiriendo] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [sugerencia, setSugerencia] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, h] = await Promise.all([
        api.asignadorDashboard(),
        api.asignadorHistorial(filtroEstado === 'todos' ? '?limit=50' : `?estado=${filtroEstado}&limit=50`),
      ]);
      setData(d);
      setHistorial(h || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const sugerirParaViaje = async (viaje) => {
    setSugiriendo(viaje.id);
    setError(null);
    try {
      const r = await api.asignadorSugerir(viaje.id);
      setSugerencia({ ...r, viaje });
    } catch (e) { setError(e.message); }
    finally { setSugiriendo(null); }
  };

  const aplicarSugerencia = async (id) => {
    try {
      const r = await api.asignadorAplicar(id);
      let msg = '✅ Asignación aplicada';
      if (r.notificacion?.ok) msg += `\n📱 Notificación enviada a ${r.notificacion.destinatario}`;
      else if (r.notificacion?.motivo) msg += `\n⚠️ Sin notificación (${r.notificacion.motivo})`;
      alert(msg);
      setSugerencia(null);
      cargar();
    } catch (e) { alert(e.message); }
  };

  const rechazarSugerencia = async (id) => {
    const motivo = prompt('Motivo de rechazo:');
    if (!motivo) return;
    try {
      await api.asignadorRechazar(id, motivo);
      setSugerencia(null);
      cargar();
    } catch (e) { alert(e.message); }
  };

  if (loading && !data) return <div className="empty">Cargando Asignador IA...</div>;

  const resumen = data?.resumen || {};
  const pendientes = data?.viajes_sin_asignar || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🎯 Asignador Inteligente</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            IA decide automáticamente quién opera cada viaje: operador+unidad propios o transportista broker verificado. Tú apruebas o dejas que se ejecute solo.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <BadgeActivo activo={data?.activo} autoApr={data?.auto_aprobar} />
          {esDirector && <button onClick={() => setConfigurando(true)} className="btn btn-primary">⚙️ Configurar</button>}
        </div>
      </div>

      {error && <div className="alert red" style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{error}</div></div>}

      {/* KPIs */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="📊 Total 30d"      value={resumen.total_30d || 0}     color="#1B3A6B" />
        <Stat label="🚛 Flota propia"    value={resumen.propios_30d || 0}   color="#16a34a" />
        <Stat label="🤝 Broker"          value={resumen.broker_30d || 0}    color="#E87722" />
        <Stat label="⚡ Auto-aplicadas"   value={resumen.auto_30d || 0}      color="#3b82f6" />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'pendientes', l: `📋 Viajes sin asignar (${pendientes.length})` },
          { id: 'historial', l: `📜 Historial (${historial.length})` },
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

      {tab === 'pendientes' && (
        <div>
          {pendientes.length === 0 ? (
            <EmptyState icono="🎯" titulo="Todo asignado"
              texto="Cuando un viaje se cree sin operador, unidad o transportista, aparecerá aquí para que la IA te sugiera el match óptimo." />
          ) : (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th}>Fecha</th>
                    <th style={th}>Cliente</th>
                    <th style={th}>Ruta</th>
                    <th style={th}>Carga</th>
                    <th style={{ ...th, textAlign: 'right' }}>Tons</th>
                    <th style={th}>Estado actual</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map(v => (
                    <tr key={v.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                      <td style={td}>{v.fecha ? new Date(v.fecha).toLocaleDateString('es-MX') : '—'}</td>
                      <td style={td}>{v.cliente_nombre || '—'}</td>
                      <td style={td}>{v.origen} → {v.destino}</td>
                      <td style={td}>{v.tipo_carga || '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{v.toneladas || '—'}</td>
                      <td style={td}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fef3c7', color: '#92400e' }}>
                          Sin asignar
                        </span>
                      </td>
                      <td style={td}>
                        <button onClick={() => sugerirParaViaje(v)} disabled={sugiriendo === v.id}
                          className="btn btn-primary btn-sm">
                          {sugiriendo === v.id ? '🤖 Analizando...' : '🎯 Sugerir IA'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'historial' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <FiltroBtn label="Todos" activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            {Object.entries(ESTADOS).map(([k, v]) => (
              <FiltroBtn key={k} label={`${v.emoji} ${v.label}`} activo={filtroEstado === k} onClick={() => setFiltroEstado(k)} />
            ))}
          </div>
          {historial.length === 0 ? (
            <EmptyState icono="📜" titulo="Sin historial" texto="Cuando uses el asignador IA aparecerán aquí todas las decisiones con su razonamiento." />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {historial.map(h => <AsignacionCard key={h.id} h={h} esAdmin={esAdmin}
                onAbrir={() => setDetalle(h.id)} onActualizar={cargar} />)}
            </div>
          )}
        </div>
      )}

      {sugerencia && (
        <ModalSugerencia s={sugerencia} esAdmin={esAdmin}
          onClose={() => setSugerencia(null)}
          onAplicar={() => aplicarSugerencia(sugerencia.asignacion.id)}
          onRechazar={() => rechazarSugerencia(sugerencia.asignacion.id)} />
      )}

      {detalle && (
        <ModalDetalle id={detalle} esAdmin={esAdmin}
          onClose={() => setDetalle(null)} onActualizar={cargar} />
      )}

      {configurando && (
        <ModalConfig onClose={() => setConfigurando(false)} onGuardado={() => { setConfigurando(false); cargar(); }} />
      )}
    </div>
  );
}

function BadgeActivo({ activo, autoApr }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ background: activo ? '#dcfce7' : '#fee2e2',
        color: activo ? '#166534' : '#991b1b',
        padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
        {activo ? '✅ Activo' : '⛔ Inactivo'}
      </span>
      {activo && (
        <span style={{ background: autoApr ? '#fef3c7' : '#dbeafe',
          color: autoApr ? '#92400e' : '#1e3a8a',
          padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
          {autoApr ? '⚡ Auto-aplica' : '👤 Manual'}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function FiltroBtn({ label, activo, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
      background: activo ? '#1A1A1A' : '#fff',
      color: activo ? '#fff' : '#374151',
      border: '1px solid ' + (activo ? '#1A1A1A' : '#d1d5db'),
      fontWeight: activo ? 600 : 400,
    }}>{label}</button>
  );
}

function EmptyState({ icono, titulo, texto }) {
  return (
    <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>{icono}</div>
      <h3 style={{ margin: '0 0 6px', color: '#374151' }}>{titulo}</h3>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>{texto}</p>
    </div>
  );
}

function AsignacionCard({ h, esAdmin, onAbrir, onActualizar }) {
  const e = ESTADOS[h.estado] || ESTADOS.sugerida;
  const c = CONFIANZA[h.confianza] || {};
  return (
    <div onClick={onAbrir} style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${e.color}`,
      borderRadius: 10, padding: 14, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ background: e.bg, color: e.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {e.emoji} {e.label}
            </span>
            <span style={{ background: h.tipo_operacion === 'propio' ? '#dcfce7' : '#fed7aa',
              color: h.tipo_operacion === 'propio' ? '#166534' : '#9a3412',
              padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {h.tipo_operacion === 'propio' ? '🚛 Propio' : '🤝 Broker'}
            </span>
            <span style={{ color: c.color, fontSize: 11, fontWeight: 600 }}>
              {c.emoji} Conf. {h.confianza}
            </span>
            {h.fue_auto && <span style={{ background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: 999, fontSize: 10 }}>⚡ Auto</span>}
          </div>
          <h4 style={{ margin: '4px 0 6px' }}>{h.origen} → {h.destino}</h4>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {h.viaje_fecha && <>📅 {new Date(h.viaje_fecha).toLocaleDateString('es-MX')} · </>}
            {h.tipo_carga || 'general'}
            {h.tipo_operacion === 'propio'
              ? <> · 👤 <strong>{h.operador_nombre || '—'}</strong> · 🚛 <strong>{h.unidad_placa || '—'}</strong></>
              : <> · 🤝 <strong>{h.transportista_razon_social || '—'}</strong></>}
          </div>
          {h.decision_motivo && (
            <p style={{ fontSize: 12, color: '#4b5563', margin: '8px 0 0', fontStyle: 'italic', maxWidth: 700 }}>
              💭 {h.decision_motivo}
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          {h.tipo_operacion === 'broker' && h.comision_estimada && (
            <div>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Comisión</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>{fmt$(h.comision_estimada)}</div>
            </div>
          )}
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{fmtFecha(h.created_at)}</div>
        </div>
      </div>
    </div>
  );
}

function ModalSugerencia({ s, esAdmin, onClose, onAplicar, onRechazar }) {
  const d = s.decision;
  const c = CONFIANZA[d.confianza] || {};
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', padding: 24,
        maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 4px' }}>🤖 Recomendación del Asignador</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
          Viaje {s.viaje.origen} → {s.viaje.destino} · {s.viaje.tipo_carga || 'general'}
        </p>

        {/* Decisión principal */}
        <div style={{
          background: 'linear-gradient(135deg, #1B3A6B 0%, #2c5390 100%)',
          color: '#fff', borderRadius: 12, padding: 18, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.85, textTransform: 'uppercase' }}>Decisión</div>
            <div style={{ color: c.color, background: '#fff', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {c.emoji} Confianza {d.confianza}
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
            {d.tipo_operacion === 'propio' ? '🚛 Operar con flota propia' : '🤝 Asignar a transportista broker'}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, opacity: 0.95 }}>
            {s.explicacion || 'Sin explicación adicional.'}
          </p>
        </div>

        {/* Detalles según tipo */}
        {d.tipo_operacion === 'propio' && (
          <>
            <Recomendado label="👤 Operador asignado" data={d.operador} extra={d.operador ? `Score ${d.operador.score} · ${d.operador.detalles?.viajes_mes || 0} viajes este mes` : null} />
            <Recomendado label="🚛 Unidad asignada" data={d.unidad ? { ...d.unidad, nombre: d.unidad.placa } : null} extra={d.unidad ? `Score ${d.unidad.score} · ${d.unidad.capacidad_ton}t capacidad` : null} />
          </>
        )}
        {d.tipo_operacion === 'broker' && d.transportista && (
          <div style={{ background: '#fff8f0', border: '1px solid #fde68a', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase', fontWeight: 700 }}>🤝 Transportista recomendado</div>
                <h3 style={{ margin: '4px 0 6px' }}>{d.transportista.razon_social}</h3>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  ★ {d.transportista.calificacion}/5 · Score {d.transportista.score} · {d.transportista.pct_concentracion}% del volumen 90d
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#6b7280' }}>Precio sugerido al transportista</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B' }}>{fmt$(d.precio_broker_sugerido)}</div>
                <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                  Comisión Andreu: {fmt$(d.comision_estimada)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alertas */}
        {s.alertas?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            {s.alertas.map((a, i) => (
              <div key={i} style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 4 }}>
                ⚠️ {a.mensaje}
              </div>
            ))}
          </div>
        )}

        {/* Acciones */}
        {esAdmin && s.asignacion.estado === 'sugerida' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
            <button onClick={onRechazar} className="btn" style={{ background: '#f3f4f6', color: '#6b7280' }}>
              ❌ Rechazar
            </button>
            <button onClick={onAplicar} className="btn btn-primary" style={{ background: '#16a34a' }}>
              ✅ Aplicar asignación
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Recomendado({ label, data, extra }) {
  if (!data) {
    return (
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#991b1b', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
        <div style={{ marginTop: 4, color: '#991b1b' }}>⚠️ Ninguno disponible</div>
      </div>
    );
  }
  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#166534', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 4 }}>{data.nombre || data.placa || data.razon_social}</div>
      {extra && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{extra}</div>}
    </div>
  );
}

function ModalDetalle({ id, esAdmin, onClose, onActualizar }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setData(await api.asignadorDetalle(id)); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const reNotificar = async () => {
    try { const r = await api.asignadorReNotificar(id); alert(r.ok ? `✅ Re-notificado a ${r.destinatario}` : `⚠️ ${r.motivo || r.error}`); }
    catch (e) { alert(e.message); }
  };

  if (loading || !data) return null;
  const a = data;
  const e = ESTADOS[a.estado] || ESTADOS.sugerida;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={ev => ev.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', padding: 24, maxHeight: '90vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <span style={{ background: e.bg, color: e.color, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                {e.emoji} {e.label}
              </span>
              {a.fue_auto && <span style={{ background: '#dbeafe', color: '#1e3a8a', padding: '3px 10px', borderRadius: 999, fontSize: 11 }}>⚡ Auto-aplicada</span>}
            </div>
            <h2 style={{ margin: 0 }}>{a.origen} → {a.destino}</h2>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
              {a.cliente_nombre || '—'} · {a.tipo_carga || 'general'} · {fmtFecha(a.created_at)}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        {a.decision_motivo && (
          <div style={{ background: '#f0f9ff', borderLeft: '4px solid #1B3A6B', padding: 12, borderRadius: 6, marginBottom: 14 }}>
            <strong style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>💭 Razonamiento</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.6 }}>{a.decision_motivo}</p>
          </div>
        )}

        {a.tipo_operacion === 'propio' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Campo label="Operador" valor={a.operador_nombre} sub={`Score ${a.operador_score || 0}`} />
            <Campo label="Unidad" valor={a.unidad_placa} sub={`${a.unidad_capacidad || '?'}t · Score ${a.unidad_score || 0}`} />
            <Campo label="Teléfono operador" valor={a.operador_telefono || '—'} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
            <Campo label="Transportista" valor={a.transportista_razon_social} sub={`★ ${a.transportista_calificacion || 0}/5 · Score ${a.transportista_score || 0}`} />
            <Campo label="Contacto" valor={a.transportista_contacto || '—'} sub={a.transportista_telefono} />
            <Campo label="Precio a transportista" valor={fmt$(a.precio_broker_sugerido)} />
            <Campo label="Comisión Andreu" valor={fmt$(a.comision_estimada)} sub={a.precio_final ? `${((a.comision_estimada / a.precio_final) * 100).toFixed(0)}% del precio cliente` : null} />
          </div>
        )}

        {a.alertas?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <strong style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase' }}>⚠️ Alertas</strong>
            <div style={{ marginTop: 6 }}>
              {a.alertas.map((al, i) => (
                <div key={i} style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 4, marginBottom: 4, fontSize: 12 }}>
                  {al.mensaje}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
          {esAdmin && a.estado === 'aplicada' && (
            <button onClick={reNotificar} className="btn btn-ghost">📱 Re-notificar</button>
          )}
        </div>

        {a.notificado_at && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280', textAlign: 'right' }}>
            📱 Notificado {fmtFecha(a.notificado_at)}
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({ label, valor, sub }) {
  return (
    <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{valor || '—'}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ModalConfig({ onClose, onGuardado }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.asignadorConfig().then(c => {
      setCfg(c);
      const init = {};
      for (const [k, v] of Object.entries(c)) init[k] = v.valor;
      setForm(init);
    });
  }, []);

  if (!cfg) return null;

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.asignadorGuardarConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 600, width: '100%', padding: 24,
        maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Configuración del Asignador IA</h2>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.asignador_activo === 'true'}
              onChange={e => setForm({ ...form, asignador_activo: e.target.checked ? 'true' : 'false' })} />
            <strong>Asignador IA activo</strong> — sugiere asignaciones cuando hay viajes sin asignar
          </label>
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.asignador_auto_aprobar === 'true'}
              onChange={e => setForm({ ...form, asignador_auto_aprobar: e.target.checked ? 'true' : 'false' })} />
            <strong>Auto-aplicar</strong> sin tu aprobación cuando confianza sea alta
          </label>
          <small style={{ color: '#6b7280', fontSize: 11 }}>
            ⚠️ Si activas esto, el sistema asigna SOLO los viajes a operadores/transportistas sin que tú apruebes. Recomendado solo cuando hayas validado la lógica.
          </small>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Notificar operador asignado</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.asignador_notificar_operador === 'true'}
                onChange={e => setForm({ ...form, asignador_notificar_operador: e.target.checked ? 'true' : 'false' })} />
              <span>WhatsApp al operador</span>
            </label>
          </div>
          <div className="form-group">
            <label className="form-label">Notificar transportista</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.asignador_notificar_transportista === 'true'}
                onChange={e => setForm({ ...form, asignador_notificar_transportista: e.target.checked ? 'true' : 'false' })} />
              <span>WhatsApp al transportista</span>
            </label>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <strong style={{ fontSize: 12, color: '#6b7280' }}>⚖️ PESOS DEL SCORING (deben sumar ≈100)</strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginTop: 8 }}>
            <PesoInput label="Disponibilidad" value={form.asignador_peso_disponibilidad} onChange={v => setForm({ ...form, asignador_peso_disponibilidad: v })} />
            <PesoInput label="Calificación" value={form.asignador_peso_calificacion} onChange={v => setForm({ ...form, asignador_peso_calificacion: v })} />
            <PesoInput label="Rotación equitativa" value={form.asignador_peso_rotacion} onChange={v => setForm({ ...form, asignador_peso_rotacion: v })} />
            <PesoInput label="Capacidad técnica" value={form.asignador_peso_capacidad} onChange={v => setForm({ ...form, asignador_peso_capacidad: v })} />
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginTop: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function PesoInput({ label, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: '#374151' }}>{label}</label>
      <input type="number" min="0" max="100" value={value || ''}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
    </div>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
