import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtFecha = ts => ts ? new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

const TIPOS_CONT = {
  linkedin_post:      { emoji: '💼', label: 'LinkedIn Post',     color: '#0a66c2' },
  blog_post:          { emoji: '📝', label: 'Blog Post',         color: '#1B3A6B' },
  caso_exito:         { emoji: '🏆', label: 'Caso de Éxito',     color: '#16a34a' },
  boletin_email:      { emoji: '📧', label: 'Boletín Email',     color: '#E87722' },
  tweet:              { emoji: '🐦', label: 'Tweet',              color: '#1DA1F2' },
  instagram_caption:  { emoji: '📷', label: 'Instagram',          color: '#E1306C' },
};

const ESTADOS_CONT = {
  borrador:  { bg: '#f3f4f6', color: '#6b7280', label: 'Borrador',  emoji: '📝' },
  aprobado:  { bg: '#dcfce7', color: '#166534', label: 'Aprobado',  emoji: '✅' },
  publicado: { bg: '#dbeafe', color: '#1e3a8a', label: 'Publicado', emoji: '🌐' },
  rechazado: { bg: '#fee2e2', color: '#991b1b', label: 'Rechazado', emoji: '❌' },
  archivado: { bg: '#f3f4f6', color: '#9ca3af', label: 'Archivado', emoji: '📦' },
};

export default function AtraccionIA() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';
  const esAdmin = ['director','admin'].includes(usuario?.rol);

  const [data, setData] = useState(null);
  const [contenido, setContenido] = useState([]);
  const [campanas, setCampanas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('canales');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [generando, setGenerando] = useState(null);
  const [detalleId, setDetalleId] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [creandoCampana, setCreandoCampana] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c, ca] = await Promise.all([
        api.atraccionDashboard(),
        api.atraccionContenidoList(filtroEstado === 'todos' ? '' : `?estado=${filtroEstado}`),
        api.atraccionCampanas(),
      ]);
      setData(d);
      setContenido(c || []);
      setCampanas(ca || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const generar = async (tipo) => {
    if (!window.confirm(`¿Generar nuevo ${TIPOS_CONT[tipo]?.label}? Costará ~$0.05-0.20 USD en Claude.`)) return;
    setGenerando(tipo);
    setError(null);
    try {
      const r = await api.atraccionGenerar(tipo);
      alert(`✅ Generado "${r.titulo}" (${(r.duracion_ms/1000).toFixed(1)}s · $${r.costo_usd.toFixed(3)})`);
      setDetalleId(r.contenido_id);
      cargar();
    } catch (e) { setError(e.message); }
    finally { setGenerando(null); }
  };

  if (loading && !data) return <div className="empty">Cargando Atracción IA...</div>;
  const resumen = data?.resumen || {};
  const funnel = data?.funnel_canal || [];
  const contStats = data?.contenido_stats || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🚀 Atracción Autónoma</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Marketing automatizado: tracking de canales, generador de contenido IA (LinkedIn, blog, boletín),
            gestión de campañas. Última pieza del Andreu Autopilot. 🏁
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{
            background: data?.activa ? '#dcfce7' : '#fee2e2',
            color: data?.activa ? '#166534' : '#991b1b',
            padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
          }}>{data?.activa ? '✅ ACTIVA' : '⛔ INACTIVA'}</span>
          {esDirector && <button onClick={() => setConfigurando(true)} className="btn btn-ghost">⚙️</button>}
        </div>
      </div>

      {error && <div className="alert red" style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{error}</div></div>}

      {/* KPIs */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="🌐 Visitas (30d)"      value={resumen.visitas_30d || 0}      color="#1B3A6B" />
        <Stat label="👥 Sesiones únicas"    value={resumen.sesiones_unicas_30d || 0} color="#3b82f6" />
        <Stat label="🎯 Conversiones"        value={resumen.conversiones_30d || 0}  color="#16a34a" />
        <Stat label="📰 Contenido (30d)"    value={contStats.generados_30d || 0}   color="#E87722" />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'canales',   l: '📊 ROI por canal' },
          { id: 'contenido', l: `📰 Contenido (${contenido.length})` },
          { id: 'campanas',  l: `🎯 Campañas (${campanas.length})` },
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

      {tab === 'canales' && <ROICanal funnel={funnel} />}

      {tab === 'contenido' && (
        <div>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <strong style={{ fontSize: 13 }}>🎨 Generar contenido nuevo con Claude</strong>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {Object.entries(TIPOS_CONT).slice(0, 4).map(([k, v]) => (
                <button key={k} onClick={() => generar(k)} disabled={generando === k}
                  className="btn btn-sm" style={{ background: v.color, color: '#fff' }}>
                  {generando === k ? '🤖 Generando...' : `${v.emoji} ${v.label}`}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <FiltroBtn label="Todos" activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            {Object.entries(ESTADOS_CONT).map(([k, v]) => (
              <FiltroBtn key={k} label={`${v.emoji} ${v.label}`} activo={filtroEstado === k} onClick={() => setFiltroEstado(k)} />
            ))}
          </div>

          {contenido.length === 0 ? (
            <EmptyState icono="📰" titulo="Sin contenido generado todavía"
              texto='Dale click a "💼 LinkedIn Post" o "📝 Blog Post" arriba para que Claude genere tu primer contenido.' />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {contenido.map(c => <ContenidoCard key={c.id} c={c} onAbrir={() => setDetalleId(c.id)} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'campanas' && (
        <div>
          {esAdmin && (
            <button onClick={() => setCreandoCampana(true)} className="btn btn-primary" style={{ marginBottom: 12 }}>
              ➕ Nueva campaña
            </button>
          )}
          {campanas.length === 0 ? (
            <EmptyState icono="🎯" titulo="Sin campañas activas"
              texto="Crea campañas con UTMs específicas (Google Ads, Meta, LinkedIn, etc.) para trackear ROI por canal." />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {campanas.map(c => <CampanaCard key={c.id} c={c} />)}
            </div>
          )}
        </div>
      )}

      {detalleId && (
        <ModalContenidoDetalle id={detalleId} esAdmin={esAdmin}
          onClose={() => setDetalleId(null)} onActualizar={cargar} />
      )}

      {configurando && (
        <ModalConfig onClose={() => setConfigurando(false)} onGuardado={() => { setConfigurando(false); cargar(); }} />
      )}

      {creandoCampana && (
        <ModalNuevaCampana onClose={() => setCreandoCampana(false)}
          onGuardado={() => { setCreandoCampana(false); cargar(); }} />
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

function ROICanal({ funnel }) {
  if (funnel.length === 0) {
    return <EmptyState icono="📊" titulo="Sin tráfico todavía"
      texto="Cuando los visitantes lleguen a /cotizar con UTMs (Google Ads, Meta Ads, LinkedIn, etc.), aparecerán aquí desglosados por canal con su tasa de conversión y ROI." />;
  }
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>Canal</th>
            <th style={{ ...th, textAlign: 'right' }}>Visitas 30d</th>
            <th style={{ ...th, textAlign: 'right' }}>Leads</th>
            <th style={{ ...th, textAlign: 'right' }}>% Conv</th>
            <th style={{ ...th, textAlign: 'right' }}>Ganados</th>
            <th style={{ ...th, textAlign: 'right' }}>% Cierre</th>
            <th style={{ ...th, textAlign: 'right' }}>Ingresos</th>
          </tr>
        </thead>
        <tbody>
          {funnel.map((f, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
              <td style={td}><strong>{f.canal}</strong></td>
              <td style={{ ...td, textAlign: 'right' }}>{f.visitas_30d}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{f.leads_30d}</td>
              <td style={{ ...td, textAlign: 'right', color: f.pct_visita_a_lead >= 2 ? '#16a34a' : '#6b7280' }}>
                {f.pct_visita_a_lead.toFixed(1)}%
              </td>
              <td style={{ ...td, textAlign: 'right' }}>{f.ganados_30d}</td>
              <td style={{ ...td, textAlign: 'right', color: f.pct_lead_a_ganado >= 30 ? '#16a34a' : '#6b7280' }}>
                {f.pct_lead_a_ganado.toFixed(1)}%
              </td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                {fmt$(f.ingresos_30d)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContenidoCard({ c, onAbrir }) {
  const tipo = TIPOS_CONT[c.tipo] || {};
  const e = ESTADOS_CONT[c.estado] || ESTADOS_CONT.borrador;
  return (
    <div onClick={onAbrir} style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${tipo.color}`,
      borderRadius: 10, padding: 14, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ background: e.bg, color: e.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              {e.emoji} {e.label}
            </span>
            <span style={{ fontSize: 12, color: tipo.color, fontWeight: 600 }}>{tipo.emoji} {tipo.label}</span>
            {c.tema && <span style={{ fontSize: 11, color: '#6b7280' }}>· {c.tema}</span>}
          </div>
          <h4 style={{ margin: '4px 0 6px' }}>{c.titulo}</h4>
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
            {c.resumen_corto?.slice(0, 200)}
          </p>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(c.keywords || []).slice(0, 5).map((k, i) => (
              <span key={i} style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4, fontSize: 10, color: '#6b7280' }}>
                #{k}
              </span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>Costo</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>${parseFloat(c.costo_usd || 0).toFixed(3)}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{fmtFecha(c.created_at)}</div>
        </div>
      </div>
    </div>
  );
}

function CampanaCard({ c }) {
  const fmt$ = n => '$' + parseFloat(n || 0).toLocaleString('es-MX');
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <strong>{c.nombre}</strong>
            <span style={{ background: c.activa ? '#dcfce7' : '#f3f4f6', color: c.activa ? '#166534' : '#6b7280',
              padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700 }}>
              {c.activa ? 'ACTIVA' : 'INACTIVA'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            Canal: <strong>{c.canal}</strong>
            {c.utm_source && <> · UTM: {c.utm_source}/{c.utm_medium}/{c.utm_campaign}</>}
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
            {c.fecha_inicio?.split('T')[0]} → {c.fecha_fin?.split('T')[0] || 'sin fin'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Presupuesto / Gasto</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{fmt$(c.gasto_real_mxn)} / {fmt$(c.presupuesto_mxn)}</div>
          {c.meta_leads > 0 && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>Meta: {c.meta_leads} leads</div>}
        </div>
      </div>
    </div>
  );
}

function ModalContenidoDetalle({ id, esAdmin, onClose, onActualizar }) {
  const [c, setC] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    api.atraccionContenidoDetalle(id).then(r => { setC(r); setForm({ titulo: r.titulo, contenido: r.contenido, resumen_corto: r.resumen_corto, call_to_action: r.call_to_action }); });
  }, [id]);

  if (!c) return null;
  const tipo = TIPOS_CONT[c.tipo] || {};

  const aprobar = async () => {
    try { await api.atraccionAprobar(id); alert('✅ Aprobado'); onActualizar(); onClose(); }
    catch (e) { alert(e.message); }
  };
  const rechazar = async () => {
    const motivo = prompt('Motivo de rechazo:');
    if (!motivo) return;
    try { await api.atraccionRechazar(id, motivo); alert('Rechazado'); onActualizar(); onClose(); }
    catch (e) { alert(e.message); }
  };
  const publicar = async () => {
    const url = prompt('URL donde se publicó (opcional, para tracking):');
    try { await api.atraccionPublicar(id, url); alert('🌐 Marcado como publicado'); onActualizar(); onClose(); }
    catch (e) { alert(e.message); }
  };
  const guardarEdicion = async () => {
    try { await api.atraccionEditar(id, form); alert('✅ Guardado'); setEditando(false); const r = await api.atraccionContenidoDetalle(id); setC(r); }
    catch (e) { alert(e.message); }
  };
  const copiar = () => {
    navigator.clipboard.writeText(c.contenido);
    alert('✅ Copiado al portapapeles');
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 820, width: '100%', padding: 24, maxHeight: '92vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ background: tipo.color, color: '#fff', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                {tipo.emoji} {tipo.label}
              </span>
              <span style={{ background: ESTADOS_CONT[c.estado]?.bg, color: ESTADOS_CONT[c.estado]?.color,
                padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                {ESTADOS_CONT[c.estado]?.emoji} {ESTADOS_CONT[c.estado]?.label}
              </span>
            </div>
            {editando
              ? <input type="text" value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })}
                  style={{ width: '100%', fontSize: 18, fontWeight: 700, border: '1px solid #d1d5db', borderRadius: 4, padding: 6 }} />
              : <h2 style={{ margin: 0, wordWrap: 'break-word' }}>{c.titulo}</h2>}
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Tema: {c.tema} · {c.modelo_usado} · ${parseFloat(c.costo_usd || 0).toFixed(3)}
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div style={{ background: '#f9fafb', padding: 14, borderRadius: 8, marginBottom: 14, maxHeight: 400, overflow: 'auto' }}>
          {editando ? (
            <textarea value={form.contenido} onChange={e => setForm({ ...form, contenido: e.target.value })}
              rows={20} style={{ width: '100%', fontFamily: 'inherit', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, padding: 8 }} />
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}>{c.contenido}</pre>
          )}
        </div>

        {c.keywords?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 11, color: '#6b7280' }}>KEYWORDS:</strong>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {c.keywords.map((k, i) => (
                <span key={i} style={{ background: '#dbeafe', color: '#1e3a8a', padding: '3px 8px', borderRadius: 4, fontSize: 11 }}>
                  #{k}
                </span>
              ))}
            </div>
          </div>
        )}

        {c.call_to_action && (
          <div style={{ background: '#fef3c7', borderLeft: '4px solid #E87722', padding: 10, borderRadius: 6, marginBottom: 14 }}>
            <strong style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase' }}>📣 CTA</strong>
            <div style={{ fontSize: 13, marginTop: 2 }}>{c.call_to_action}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={copiar} className="btn btn-ghost">📋 Copiar texto</button>
          {esAdmin && editando && (
            <>
              <button onClick={guardarEdicion} className="btn btn-primary">💾 Guardar cambios</button>
              <button onClick={() => setEditando(false)} className="btn btn-ghost">Cancelar</button>
            </>
          )}
          {esAdmin && !editando && (
            <>
              <button onClick={() => setEditando(true)} className="btn btn-ghost">✏️ Editar</button>
              {c.estado === 'borrador' && (
                <>
                  <button onClick={aprobar} className="btn" style={{ background: '#16a34a', color: '#fff' }}>✅ Aprobar</button>
                  <button onClick={rechazar} className="btn" style={{ background: '#fee2e2', color: '#991b1b' }}>❌ Rechazar</button>
                </>
              )}
              {c.estado === 'aprobado' && (
                <button onClick={publicar} className="btn btn-primary">🌐 Marcar publicado</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalConfig({ onClose, onGuardado }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.atraccionConfig().then(c => {
      setCfg(c);
      const init = {};
      for (const [k, v] of Object.entries(c)) init[k] = v.valor;
      setForm(init);
    });
  }, []);

  if (!cfg) return null;

  const guardar = async () => {
    setGuardando(true);
    try { await api.atraccionGuardarConfig(form); onGuardado(); }
    catch (e) { alert(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 620, width: '100%', padding: 24, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Configurar Atracción IA</h2>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.atraccion_ia_activa === 'true'}
              onChange={e => setForm({ ...form, atraccion_ia_activa: e.target.checked ? 'true' : 'false' })} />
            <strong>Atracción IA activa</strong> — genera contenido automático cada lunes
          </label>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Frecuencia LinkedIn</label>
            <select value={form.atraccion_ia_freq_linkedin} onChange={e => setForm({ ...form, atraccion_ia_freq_linkedin: e.target.value })}>
              <option value="semanal">Semanal</option>
              <option value="quincenal">Quincenal</option>
              <option value="mensual">Mensual</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Frecuencia Blog</label>
            <select value={form.atraccion_ia_freq_blog} onChange={e => setForm({ ...form, atraccion_ia_freq_blog: e.target.value })}>
              <option value="semanal">Semanal</option>
              <option value="quincenal">Quincenal</option>
              <option value="mensual">Mensual</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Frecuencia Boletín Email</label>
          <select value={form.atraccion_ia_freq_boletin} onChange={e => setForm({ ...form, atraccion_ia_freq_boletin: e.target.value })}>
            <option value="mensual">Mensual</option>
            <option value="quincenal">Quincenal</option>
            <option value="trimestral">Trimestral</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Modelo Claude</label>
          <select value={form.atraccion_ia_modelo} onChange={e => setForm({ ...form, atraccion_ia_modelo: e.target.value })}>
            <option value="claude-sonnet-4-6">Sonnet 4.6 (recomendado, balance calidad/costo)</option>
            <option value="claude-haiku-4-5">Haiku 4.5 (más barato, contenido más simple)</option>
            <option value="claude-opus-4-7">Opus 4.7 (premium, calidad máxima, más caro)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Temas (separados por coma)</label>
          <textarea rows={2} value={form.atraccion_ia_temas}
            onChange={e => setForm({ ...form, atraccion_ia_temas: e.target.value })} />
          <small style={{ color: '#6b7280', fontSize: 11 }}>Claude rota entre estos temas automáticamente.</small>
        </div>

        <div className="form-group">
          <label className="form-label">Tono de marca</label>
          <textarea rows={2} value={form.atraccion_ia_tono_marca}
            onChange={e => setForm({ ...form, atraccion_ia_tono_marca: e.target.value })} />
        </div>

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.atraccion_ia_auto_publicar === 'true'}
              onChange={e => setForm({ ...form, atraccion_ia_auto_publicar: e.target.checked ? 'true' : 'false' })} />
            <strong>Auto-aprobar contenido</strong> sin revisión (no recomendado)
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalNuevaCampana({ onClose, onGuardado }) {
  const [form, setForm] = useState({
    nombre: '', canal: 'google_ads',
    utm_source: '', utm_medium: '', utm_campaign: '',
    fecha_inicio: new Date().toISOString().split('T')[0], fecha_fin: '',
    presupuesto_mxn: 0, meta_leads: 0, meta_ingresos: 0, notas: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    if (!form.nombre || !form.canal) { setError('Nombre y canal requeridos'); return; }
    setGuardando(true); setError(null);
    try { await api.atraccionCrearCampana(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', padding: 24, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>🎯 Nueva campaña de marketing</h2>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Nombre *</label>
            <input type="text" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Campaña Q1 Google Ads CDMX" />
          </div>
          <div className="form-group">
            <label className="form-label">Canal *</label>
            <select value={form.canal} onChange={e => setForm({ ...form, canal: e.target.value })}>
              <option value="google_ads">Google Ads</option>
              <option value="meta_ads">Meta Ads (FB/IG)</option>
              <option value="linkedin">LinkedIn</option>
              <option value="organico">Orgánico/SEO</option>
              <option value="referido">Referidos</option>
              <option value="email">Email Marketing</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">UTM Source</label>
            <input type="text" value={form.utm_source} onChange={e => setForm({ ...form, utm_source: e.target.value })} placeholder="google" />
          </div>
          <div className="form-group">
            <label className="form-label">UTM Medium</label>
            <input type="text" value={form.utm_medium} onChange={e => setForm({ ...form, utm_medium: e.target.value })} placeholder="cpc" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">UTM Campaign</label>
          <input type="text" value={form.utm_campaign} onChange={e => setForm({ ...form, utm_campaign: e.target.value })} placeholder="andreu_q1_2026" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fecha inicio</label>
            <input type="date" value={form.fecha_inicio} onChange={e => setForm({ ...form, fecha_inicio: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha fin (opcional)</label>
            <input type="date" value={form.fecha_fin} onChange={e => setForm({ ...form, fecha_fin: e.target.value })} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Presupuesto MXN</label>
            <input type="number" value={form.presupuesto_mxn} onChange={e => setForm({ ...form, presupuesto_mxn: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Meta leads</label>
            <input type="number" value={form.meta_leads} onChange={e => setForm({ ...form, meta_leads: e.target.value })} />
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Crear campaña'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
