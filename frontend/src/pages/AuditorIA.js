import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

const COLORES_SEVERIDAD = {
  critico: { bg: '#fee2e2', color: '#991b1b', emoji: '🚨', label: 'CRÍTICO' },
  alto:    { bg: '#fed7aa', color: '#9a3412', emoji: '⚠️', label: 'ALTO' },
  medio:   { bg: '#fef3c7', color: '#92400e', emoji: '🟡', label: 'MEDIO' },
  bajo:    { bg: '#e0e7ff', color: '#3730a3', emoji: '🔵', label: 'BAJO' },
};

const COLORES_TIPO = {
  error:       { bg: '#fee2e2', color: '#991b1b', emoji: '🔴', label: 'Error' },
  oportunidad: { bg: '#dcfce7', color: '#166534', emoji: '🟢', label: 'Oportunidad' },
};

const COLORES_STATUS = {
  pendiente:   { bg: '#dbeafe', color: '#1e3a8a', emoji: '⏳', label: 'Pendiente' },
  en_progreso: { bg: '#fef3c7', color: '#92400e', emoji: '⚙️', label: 'En progreso' },
  aplicada:    { bg: '#dcfce7', color: '#166534', emoji: '✅', label: 'Aplicada' },
  descartada:  { bg: '#f3f4f6', color: '#6b7280', emoji: '❌', label: 'Descartada' },
  expirada:    { bg: '#f3f4f6', color: '#9ca3af', emoji: '⏰', label: 'Expirada' },
};

const ICONOS_CATEGORIA = {
  ingresos:      '💰', operadores: '👤', clientes: '👥',
  rutas:         '🛣️', broker:     '🤝', cashflow: '💸',
  gastos:        '⛽', mantenimiento: '🔧', leads: '🎯',
  documentos:    '📄', otro: '📌',
};

export default function AuditorIA() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';

  const [dashboard, setDashboard] = useState(null);
  const [ejecuciones, setEjecuciones] = useState([]);
  const [hallazgos, setHallazgos] = useState([]);
  const [ejSeleccionada, setEjSeleccionada] = useState(null); // null = todos
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ejecutando, setEjecutando] = useState(false);
  const [config, setConfig] = useState(null);
  const [configurando, setConfigurando] = useState(false);
  const [filtros, setFiltros] = useState({ tipo: 'todos', severidad: 'todos', status: 'pendiente' });
  const [detalleHallazgo, setDetalleHallazgo] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, e] = await Promise.all([
        api.auditorDashboard(),
        api.auditorEjecuciones(),
      ]);
      setDashboard(d);
      setEjecuciones(e || []);

      // Cargar hallazgos según selección
      const qs = new URLSearchParams();
      if (filtros.status !== 'todos') qs.set('status', filtros.status);
      if (filtros.tipo !== 'todos')   qs.set('tipo', filtros.tipo);
      if (filtros.severidad !== 'todos') qs.set('severidad', filtros.severidad);

      const h = ejSeleccionada
        ? await api.auditorEjecucion(ejSeleccionada).then(r => r.hallazgos)
        : await api.auditorHallazgos(qs.toString() ? `?${qs.toString()}` : '');
      setHallazgos(h || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [ejSeleccionada, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const ejecutarAhora = async () => {
    if (!window.confirm('Esto llamará a Claude Opus 4.7 para analizar tu negocio (~$2-5 USD). El análisis tarda 30-90 segundos. ¿Continuar?')) return;
    setEjecutando(true);
    setError(null);
    try {
      const r = await api.auditorEjecutar();
      alert(`✅ Auditoría completada. ${r.hallazgos_insertados} hallazgos. Costo: $${r.costo_usd.toFixed(2)} USD.\n\n${r.resumen}`);
      await cargar();
    } catch (e) {
      setError(`Error: ${e.message}`);
    } finally { setEjecutando(false); }
  };

  const abrirConfig = async () => {
    try {
      const c = await api.auditorConfig();
      setConfig(c);
      setConfigurando(true);
    } catch (e) { setError(e.message); }
  };

  const cambiarStatus = async (id, status) => {
    const necesitaNota = ['descartada','aplicada'].includes(status);
    const nota = necesitaNota ? prompt(`Nota opcional (para que el auditor IA aprenda de tu decisión):`) : null;
    if (necesitaNota && nota === null) return; // canceló
    try {
      await api.auditorCambiarStatus(id, status, nota || null);
      setDetalleHallazgo(null);
      await cargar();
    } catch (e) { alert(e.message); }
  };

  if (loading && !dashboard) return <div className="empty">Cargando Auditor IA...</div>;

  const stats = dashboard?.stats || {};
  const ultima = dashboard?.ultima_ejecucion;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🤖 Auditor IA</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Claude Opus 4.7 analiza tu negocio cada lunes 7 AM y emite hallazgos: errores que arreglar + oportunidades de crecimiento. Tú decides qué aplicar.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {esDirector && (
            <button onClick={abrirConfig} className="btn btn-ghost">⚙️ Config</button>
          )}
          {esDirector && (
            <button onClick={ejecutarAhora} disabled={ejecutando} className="btn btn-primary">
              {ejecutando ? '🤖 Analizando...' : '🚀 Auditar mi negocio ahora'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="alert red" style={{ marginBottom: 16 }}>
          <div className="alert-dot"/><div>{error}</div>
        </div>
      )}

      {/* Última auditoría — resumen ejecutivo */}
      {ultima ? (
        <div style={{
          background: 'linear-gradient(135deg, #1B3A6B 0%, #2c5390 100%)',
          color: '#fff', borderRadius: 12, padding: 18, marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Última auditoría · {ultima.semana_iso}
              </div>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                {new Date(ultima.iniciada_at).toLocaleString('es-MX')} ·
                {ultima.modelo} ·
                ${parseFloat(ultima.costo_usd || 0).toFixed(2)} USD ·
                {(ultima.duracion_ms / 1000).toFixed(0)}s
              </div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              {ultima.total_hallazgos} hallazgos · {ultima.errores}🔴 / {ultima.oportunidades}🟢
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
            {ultima.resumen_ejecutivo || 'Sin resumen ejecutivo.'}
          </p>
        </div>
      ) : (
        <div style={{
          background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12,
          padding: 32, textAlign: 'center', marginBottom: 20,
        }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🤖</div>
          <h3 style={{ margin: '0 0 8px' }}>Aún no has corrido el Auditor IA</h3>
          <p style={{ color: '#6b7280', maxWidth: 540, margin: '0 auto 16px' }}>
            El auditor IA toma snapshot de TODOS tus datos (ingresos, operadores, clientes, rutas, broker, cashflow, gastos, mantenimiento, leads, documentos)
            y te entrega un reporte con errores que arreglar + oportunidades para crecer.
          </p>
          {esDirector && (
            <button onClick={ejecutarAhora} disabled={ejecutando} className="btn btn-primary">
              {ejecutando ? 'Analizando...' : '🚀 Correr primera auditoría'}
            </button>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <Stat label="🚨 Críticos abiertos" value={stats.criticos_abiertos || 0} color="#991b1b" />
        <Stat label="📋 Total abiertos"    value={stats.abiertos || 0}          color="#1B3A6B" />
        <Stat label="✅ Aplicadas"          value={stats.aplicadas_total || 0}   color="#16a34a" />
        <Stat label="💰 Oportunidad MXN"    value={fmt$(stats.oportunidad_mxn_abierta || 0)} color="#E87722" />
      </div>

      {/* Selector de ejecución + filtros */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 12, color: '#6b7280' }}>EJECUCIÓN:</strong>
          <select value={ejSeleccionada || ''} onChange={e => setEjSeleccionada(e.target.value ? parseInt(e.target.value) : null)}
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">Todas las semanas (filtros activos)</option>
            {ejecuciones.map(e => (
              <option key={e.id} value={e.id}>
                {e.semana_iso} · {new Date(e.iniciada_at).toLocaleDateString('es-MX')} ·
                {e.total_hallazgos}h ({e.aplicados}✅/{e.descartados}❌/{e.pendientes}⏳)
              </option>
            ))}
          </select>

          {!ejSeleccionada && (
            <>
              <strong style={{ fontSize: 12, color: '#6b7280' }}>FILTROS:</strong>
              <FiltroBtn label="🔴 Errores" activo={filtros.tipo === 'error'}
                onClick={() => setFiltros({ ...filtros, tipo: filtros.tipo === 'error' ? 'todos' : 'error' })} />
              <FiltroBtn label="🟢 Oportunidades" activo={filtros.tipo === 'oportunidad'}
                onClick={() => setFiltros({ ...filtros, tipo: filtros.tipo === 'oportunidad' ? 'todos' : 'oportunidad' })} />
              <FiltroBtn label="🚨 Críticos" activo={filtros.severidad === 'critico'}
                onClick={() => setFiltros({ ...filtros, severidad: filtros.severidad === 'critico' ? 'todos' : 'critico' })} />
              <select value={filtros.status} onChange={e => setFiltros({ ...filtros, status: e.target.value })}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}>
                <option value="pendiente">⏳ Pendientes</option>
                <option value="en_progreso">⚙️ En progreso</option>
                <option value="aplicada">✅ Aplicadas</option>
                <option value="descartada">❌ Descartadas</option>
                <option value="todos">Todos los status</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Lista de hallazgos */}
      {hallazgos.length === 0 ? (
        <div className="empty" style={{ textAlign: 'center', padding: 30, color: '#6b7280' }}>
          {ejSeleccionada ? 'Esta ejecución no tiene hallazgos.' : 'No hay hallazgos con los filtros actuales.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {hallazgos.map(h => (
            <HallazgoCard key={h.id} h={h}
              esDirector={esDirector}
              onAbrir={() => setDetalleHallazgo(h)}
              onCambiarStatus={cambiarStatus} />
          ))}
        </div>
      )}

      {detalleHallazgo && (
        <ModalDetalleHallazgo h={detalleHallazgo} esDirector={esDirector}
          onClose={() => setDetalleHallazgo(null)}
          onCambiarStatus={cambiarStatus} />
      )}

      {configurando && config && (
        <ModalConfigAuditor config={config}
          onClose={() => setConfigurando(false)}
          onGuardado={() => { setConfigurando(false); cargar(); }} />
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

function HallazgoCard({ h, esDirector, onAbrir, onCambiarStatus }) {
  const sev = COLORES_SEVERIDAD[h.severidad] || COLORES_SEVERIDAD.medio;
  const tipo = COLORES_TIPO[h.tipo] || {};
  const status = COLORES_STATUS[h.status] || {};
  const cat = ICONOS_CATEGORIA[h.categoria] || '📌';

  const bloqueado = ['aplicada','descartada','expirada'].includes(h.status);

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${sev.color}`,
      borderRadius: 10, padding: 14,
      opacity: bloqueado ? 0.7 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 280, cursor: 'pointer' }} onClick={onAbrir}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>{cat}</span>
            <Badge bg={sev.bg} color={sev.color}>{sev.emoji} {sev.label}</Badge>
            <Badge bg={tipo.bg} color={tipo.color}>{tipo.emoji} {tipo.label}</Badge>
            <Badge bg="#f3f4f6" color="#6b7280">{h.categoria}</Badge>
            <Badge bg={status.bg} color={status.color}>{status.emoji} {status.label}</Badge>
            {h.confianza && h.confianza !== 'media' && (
              <Badge bg="#f3f4f6" color="#6b7280">conf: {h.confianza}</Badge>
            )}
          </div>
          <h4 style={{ margin: '4px 0 6px', fontSize: 15 }}>{h.titulo}</h4>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
            {h.descripcion}
          </p>
          <div style={{ background: '#f9fafb', borderLeft: '3px solid #E87722', padding: '8px 12px', borderRadius: 4 }}>
            <strong style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase' }}>👉 Acción recomendada</strong>
            <div style={{ fontSize: 13, marginTop: 2 }}>{h.accion_recomendada}</div>
          </div>
        </div>

        <div style={{ textAlign: 'right', minWidth: 160, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {h.impacto_mxn != null && (
            <div>
              <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>IMPACTO MXN</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: h.tipo === 'error' ? '#991b1b' : '#16a34a' }}>
                {h.tipo === 'error' ? '-' : '+'}{fmt$(Math.abs(h.impacto_mxn))}
              </div>
            </div>
          )}
          {h.ventana_dias && (
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              ⏰ {h.ventana_dias}d para actuar
            </div>
          )}
          {esDirector && !bloqueado && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={() => onCambiarStatus(h.id, 'aplicada')} className="btn btn-sm"
                style={{ background: '#16a34a', color: '#fff', fontSize: 11 }}>✅ Apliqué</button>
              <button onClick={() => onCambiarStatus(h.id, 'descartada')} className="btn btn-sm"
                style={{ background: '#f3f4f6', color: '#6b7280', fontSize: 11 }}>❌ Descartar</button>
            </div>
          )}
          {esDirector && !bloqueado && h.status === 'pendiente' && (
            <button onClick={() => onCambiarStatus(h.id, 'en_progreso')} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
              ⚙️ Marcar en progreso
            </button>
          )}
          {h.notas_director && (
            <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginTop: 6, textAlign: 'right', maxWidth: 200 }}>
              "{h.notas_director}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ bg, color, children }) {
  return (
    <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function ModalDetalleHallazgo({ h, esDirector, onClose, onCambiarStatus }) {
  const sev = COLORES_SEVERIDAD[h.severidad] || COLORES_SEVERIDAD.medio;
  const tipo = COLORES_TIPO[h.tipo] || {};

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 760, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <Badge bg={sev.bg} color={sev.color}>{sev.emoji} {sev.label}</Badge>
              <Badge bg={tipo.bg} color={tipo.color}>{tipo.emoji} {tipo.label}</Badge>
              <Badge bg="#f3f4f6" color="#6b7280">{ICONOS_CATEGORIA[h.categoria] || '📌'} {h.categoria}</Badge>
            </div>
            <h2 style={{ margin: 0 }}>{h.titulo}</h2>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', textTransform: 'uppercase' }}>Descripción</h4>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{h.descripcion}</p>
        </div>

        <div style={{ background: '#fef3c7', borderLeft: '4px solid #E87722', padding: 14, borderRadius: 6, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#92400e', textTransform: 'uppercase' }}>👉 Acción recomendada</h4>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>{h.accion_recomendada}</p>
        </div>

        {h.evidencia && Object.keys(h.evidencia).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', textTransform: 'uppercase' }}>📊 Evidencia</h4>
            <pre style={{
              background: '#f9fafb', padding: 12, borderRadius: 6, fontSize: 12,
              overflow: 'auto', margin: 0, border: '1px solid #e5e7eb', maxHeight: 240,
            }}>{JSON.stringify(h.evidencia, null, 2)}</pre>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          {h.impacto_mxn != null && (
            <Card label="Impacto" valor={`${h.tipo === 'error' ? '-' : '+'}${fmt$(Math.abs(h.impacto_mxn))}`} />
          )}
          {h.ventana_dias && <Card label="Ventana" valor={`${h.ventana_dias} días`} />}
          {h.confianza && <Card label="Confianza" valor={h.confianza} />}
          {h.semana_iso && <Card label="Semana" valor={h.semana_iso} />}
        </div>

        {h.notas_director && (
          <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <strong style={{ fontSize: 12 }}>📝 Nota del director:</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, fontStyle: 'italic' }}>"{h.notas_director}"</p>
            {h.decidida_por_nombre && (
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                — {h.decidida_por_nombre}, {new Date(h.decidida_at).toLocaleString('es-MX')}
              </div>
            )}
          </div>
        )}

        {esDirector && !['aplicada','descartada','expirada'].includes(h.status) && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
            <button onClick={() => onCambiarStatus(h.id, 'descartada')}
              className="btn" style={{ background: '#f3f4f6', color: '#6b7280' }}>
              ❌ Descartar
            </button>
            <button onClick={() => onCambiarStatus(h.id, 'en_progreso')}
              className="btn" style={{ background: '#fef3c7', color: '#92400e' }}>
              ⚙️ En progreso
            </button>
            <button onClick={() => onCambiarStatus(h.id, 'aplicada')}
              className="btn btn-primary" style={{ background: '#16a34a' }}>
              ✅ Lo apliqué
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, valor }) {
  return (
    <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{valor}</div>
    </div>
  );
}

function ModalConfigAuditor({ config, onClose, onGuardado }) {
  const [form, setForm] = useState({
    modelo: config.auditor_ia_modelo?.valor || 'claude-opus-4-7',
    max_costo_usd: parseFloat(config.auditor_ia_max_costo_usd?.valor || 5),
    schedule_cron: config.auditor_ia_schedule_cron?.valor || '0 7 * * 1',
    activo: config.auditor_ia_activo?.valor === 'true',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.auditorGuardarConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 520, width: '100%', padding: 24,
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Configuración del Auditor IA</h2>

        <div className="form-group">
          <label className="form-label">Activo (cron semanal)</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
            <span>Ejecutar automáticamente cada lunes 7 AM</span>
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Modelo de Claude</label>
          <select value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })}>
            <option value="claude-opus-4-7">Claude Opus 4.7 (recomendado, máxima profundidad)</option>
            <option value="claude-opus-4-6">Claude Opus 4.6 (ahorra ~$1 por análisis)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (más rápido y barato, menos profundo)</option>
          </select>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tope de costo USD</label>
            <input type="number" step="0.5" min="1" value={form.max_costo_usd}
              onChange={e => setForm({ ...form, max_costo_usd: parseFloat(e.target.value) })} />
            <small style={{ color: '#6b7280', fontSize: 11 }}>
              Si el análisis pasa este tope, queda registrado pero no se interrumpe.
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Schedule (cron)</label>
            <input type="text" value={form.schedule_cron}
              onChange={e => setForm({ ...form, schedule_cron: e.target.value })} />
            <small style={{ color: '#6b7280', fontSize: 11 }}>
              Default: <code>0 7 * * 1</code> (lunes 7 AM). Cambia requiere reinicio de servidor.
            </small>
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar config'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
