import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtFecha = ts => ts ? new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '—';

const ESTADOS_CONV = {
  activa:              { label: 'Activa',           bg: '#dbeafe', color: '#1e3a8a', emoji: '💬' },
  pausada:             { label: 'Pausada',          bg: '#fef3c7', color: '#92400e', emoji: '⏸️' },
  intervenida_humano:  { label: 'Requiere humano',  bg: '#fed7aa', color: '#9a3412', emoji: '🙋' },
  cerrada_ganada:      { label: 'Ganada',           bg: '#dcfce7', color: '#166534', emoji: '🎉' },
  cerrada_perdida:     { label: 'Perdida',          bg: '#f3f4f6', color: '#6b7280', emoji: '😢' },
};

const CANALES = {
  whatsapp: { label: 'WhatsApp', emoji: '💚', color: '#25D366' },
  email:    { label: 'Email',    emoji: '📧', color: '#3b82f6' },
  sms:      { label: 'SMS',      emoji: '📱', color: '#6b7280' },
};

export default function VendedorIA() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';

  const [data, setData] = useState(null);
  const [conversaciones, setConversaciones] = useState([]);
  const [convSeleccionada, setConvSeleccionada] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('funnel');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [configurando, setConfigurando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, c] = await Promise.all([
        api.vendedorDashboard(),
        api.vendedorConversaciones(filtroEstado === 'todos' ? '' : `?estado=${filtroEstado}`),
      ]);
      setData(d);
      setConversaciones(c || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading && !data) return <div className="empty">Cargando Vendedor IA...</div>;
  if (error && !data) return <div className="alert red"><div className="alert-dot"/><div>{error}</div></div>;

  const funnel = data?.funnel || {};
  const activo = data?.activo;
  const canalesOk = data?.canales || {};
  const config = data?.config || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🤖 Vendedor IA 24/7</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Captura, contacta y cierra leads automáticamente vía WhatsApp + Email.
            Cuando alguien cotiza en /cotizar, Claude le contesta en menos de 30 segundos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <BadgeActivo activo={activo} />
          {esDirector && (
            <button onClick={() => setConfigurando(true)} className="btn btn-primary">⚙️ Configurar</button>
          )}
        </div>
      </div>

      {/* Status canales */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusCanal canal="WhatsApp (Twilio)" emoji="💚" ok={canalesOk.whatsapp} />
        <StatusCanal canal="Email (SendGrid)"  emoji="📧" ok={canalesOk.email} />
        <StatusCanal canal="Claude (Anthropic)" emoji="🧠" ok={config.vendedor_ia_modelo ? true : false} />
      </div>

      {/* Funnel KPIs */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="📥 Leads (30d)"             value={funnel.leads_total || 0} color="#1B3A6B" />
        <Stat label="📤 Contactados auto"
              value={`${funnel.leads_contactados || 0} (${(funnel.pct_contactados || 0).toFixed(0)}%)`}
              color="#3b82f6" />
        <Stat label="💬 Respondieron"
              value={`${funnel.leads_respondieron || 0} (${(funnel.pct_respuesta || 0).toFixed(0)}%)`}
              color="#E87722" />
        <Stat label="🎯 Cerrados por IA"
              value={`${funnel.leads_ganados_ia || 0} (${(funnel.pct_cierre_ia || 0).toFixed(0)}%)`}
              color="#16a34a" />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'funnel', l: '📊 Funnel' },
          { id: 'conversaciones', l: `💬 Conversaciones (${conversaciones.length})` },
          { id: 'drip', l: '🌧️ Drip campaigns' },
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

      {tab === 'funnel' && <FunnelView data={data} />}

      {tab === 'conversaciones' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <FiltroBtn label="Todas" activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            {Object.entries(ESTADOS_CONV).map(([k, v]) => (
              <FiltroBtn key={k} label={`${v.emoji} ${v.label}`} activo={filtroEstado === k} onClick={() => setFiltroEstado(k)} />
            ))}
          </div>
          {conversaciones.length === 0 ? (
            <EmptyState icono="💬" titulo="Sin conversaciones todavía"
              texto="Cuando alguien cotice en /cotizar, el Vendedor IA inicia conversación automáticamente y aparece aquí." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 14, height: '70vh' }}>
              <div style={{ overflow: 'auto', background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                {conversaciones.map(c => (
                  <ConvListItem key={c.id} c={c}
                    seleccionada={convSeleccionada?.id === c.id}
                    onClick={() => setConvSeleccionada(c)} />
                ))}
              </div>
              <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {convSeleccionada ? (
                  <ChatView convId={convSeleccionada.id} esDirector={esDirector} onActualizar={cargar} />
                ) : (
                  <EmptyState icono="👈" titulo="Selecciona una conversación"
                    texto="Escoge una conversación de la izquierda para ver el chat completo y poder intervenir." />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'drip' && <DripView dripStats={data?.drip} esDirector={esDirector} onActualizar={cargar} />}

      {configurando && (
        <ModalConfig actual={config} canalesOk={canalesOk}
          onClose={() => setConfigurando(false)}
          onGuardado={() => { setConfigurando(false); cargar(); }} />
      )}
    </div>
  );
}

function BadgeActivo({ activo }) {
  return (
    <span style={{
      background: activo ? '#dcfce7' : '#fee2e2',
      color: activo ? '#166534' : '#991b1b',
      padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
    }}>
      {activo ? '✅ ACTIVO' : '⛔ INACTIVO'}
    </span>
  );
}

function StatusCanal({ canal, emoji, ok }) {
  return (
    <div style={{
      background: ok ? '#f0fdf4' : '#fef2f2',
      border: '1px solid ' + (ok ? '#bbf7d0' : '#fecaca'),
      padding: '8px 12px', borderRadius: 8, fontSize: 12,
      display: 'flex', gap: 6, alignItems: 'center',
    }}>
      <span style={{ fontSize: 16 }}>{emoji}</span>
      <span style={{ color: ok ? '#166534' : '#991b1b' }}>
        <strong>{canal}</strong>: {ok ? 'configurado' : 'falta config'}
      </span>
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

function FunnelView({ data }) {
  const f = data?.funnel || {};
  const drip = data?.drip || {};
  const stats = data?.stats || {};
  const steps = [
    { label: '📥 Leads totales',         valor: f.leads_total,        pct: 100 },
    { label: '📤 Contactados por IA',    valor: f.leads_contactados,  pct: f.pct_contactados },
    { label: '💬 Respondieron',          valor: f.leads_respondieron, pct: f.pct_respuesta },
    { label: '🎯 Cerrados por IA',       valor: f.leads_ganados_ia,   pct: f.pct_cierre_ia },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 12px' }}>📊 Funnel de conversión (30 días)</h4>
        {steps.map((s, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13 }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {s.valor || 0} {s.pct != null && `(${(s.pct || 0).toFixed(0)}%)`}
              </span>
            </div>
            <div style={{ width: '100%', height: 8, background: '#f3f4f6', borderRadius: 4 }}>
              <div style={{
                width: `${Math.min(100, s.pct || 0)}%`, height: '100%',
                background: i === 0 ? '#1B3A6B' : i === 1 ? '#3b82f6' : i === 2 ? '#E87722' : '#16a34a',
                borderRadius: 4,
              }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 12px' }}>💬 Conversaciones (30d)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Mini label="Activas"     valor={stats.conversaciones_activas || 0} color="#1B3A6B" />
          <Mini label="Con respuesta" valor={stats.con_respuesta_cliente || 0} color="#E87722" />
          <Mini label="Cerradas ganadas" valor={stats.cerradas_ganadas || 0} color="#16a34a" />
          <Mini label="Requieren humano" valor={stats.pendientes_humano || 0} color="#dc2626" />
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 12px' }}>🌧️ Drip campaigns (30d)</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <Mini label="Pendientes" valor={drip.drip_pendientes || 0} color="#3b82f6" />
          <Mini label="Enviados"  valor={drip.drip_enviados || 0}  color="#16a34a" />
          <Mini label="Cancelados" valor={drip.drip_cancelados || 0} color="#6b7280" />
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
          Los drips se cancelan automáticamente cuando el cliente responde.
        </div>
      </div>
    </div>
  );
}

function Mini({ label, valor, color }) {
  return (
    <div style={{ background: '#f9fafb', borderRadius: 8, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 2 }}>{valor}</div>
    </div>
  );
}

function ConvListItem({ c, seleccionada, onClick }) {
  const e = ESTADOS_CONV[c.estado] || ESTADOS_CONV.activa;
  const canal = CANALES[c.canal] || {};
  return (
    <div onClick={onClick} style={{
      padding: 12, cursor: 'pointer',
      borderBottom: '1px solid #f3f4f6',
      background: seleccionada ? '#eff6ff' : 'transparent',
      borderLeft: seleccionada ? '3px solid #1B3A6B' : '3px solid transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: 13 }}>{c.contacto_nombre}</strong>
        <span style={{ background: e.bg, color: e.color, padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600 }}>
          {e.emoji} {e.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>
        {canal.emoji} {c.folio} · {c.origen} → {c.destino}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
        {c.total_mensajes} mensaje(s) · {fmtFecha(c.ultimo_mensaje_at)}
      </div>
    </div>
  );
}

function ChatView({ convId, esDirector, onActualizar }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { const r = await api.vendedorConversacion(convId); setData(r); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [convId]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data]);

  const enviar = async () => {
    if (!mensaje.trim()) return;
    setEnviando(true); setError(null);
    try {
      await api.vendedorEnviarMensaje(convId, mensaje.trim());
      setMensaje('');
      await cargar();
      onActualizar();
    } catch (e) { setError(e.message); } finally { setEnviando(false); }
  };

  const cambiarEstado = async (estado) => {
    if (!window.confirm(`¿Cambiar estado a "${ESTADOS_CONV[estado]?.label || estado}"?`)) return;
    try { await api.vendedorCambiarEstadoConv(convId, estado); await cargar(); onActualizar(); }
    catch (e) { alert(e.message); }
  };

  if (loading) return <div className="empty">Cargando chat...</div>;
  if (error) return <div className="alert red">{error}</div>;
  if (!data) return null;

  const conv = data.conversacion;
  const e = ESTADOS_CONV[conv.estado] || ESTADOS_CONV.activa;
  const canal = CANALES[conv.canal] || {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb' }}>
      {/* Header */}
      <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>{conv.contacto_nombre}</strong>
            <span style={{ background: e.bg, color: e.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
              {e.emoji} {e.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
            {canal.emoji} {conv.identificador} · Folio <strong>{conv.folio}</strong> · {fmt$(conv.precio_final)}
          </div>
        </div>
        {esDirector && (
          <div style={{ display: 'flex', gap: 4 }}>
            {conv.estado !== 'pausada' && conv.estado === 'activa' && (
              <button onClick={() => cambiarEstado('pausada')} className="btn btn-ghost btn-sm">⏸️ Pausar IA</button>
            )}
            {conv.estado === 'pausada' && (
              <button onClick={() => cambiarEstado('activa')} className="btn btn-ghost btn-sm">▶️ Reactivar IA</button>
            )}
            {!['cerrada_ganada','cerrada_perdida'].includes(conv.estado) && (
              <>
                <button onClick={() => cambiarEstado('cerrada_ganada')} className="btn btn-sm" style={{ background: '#16a34a', color: '#fff' }}>🎉 Ganada</button>
                <button onClick={() => cambiarEstado('cerrada_perdida')} className="btn btn-sm" style={{ background: '#6b7280', color: '#fff' }}>😢 Perdida</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#f3f4f6' }}>
        {data.mensajes.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#6b7280', padding: 20, fontSize: 13 }}>Sin mensajes.</div>
        ) : data.mensajes.map(m => <Burbuja key={m.id} m={m} />)}
      </div>

      {/* Input */}
      {esDirector && conv.estado !== 'cerrada_ganada' && conv.estado !== 'cerrada_perdida' && (
        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', background: '#fff' }}>
          {error && <div style={{ fontSize: 12, color: '#991b1b', marginBottom: 6 }}>⚠️ {error}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea value={mensaje} onChange={e => setMensaje(e.target.value)}
              placeholder={conv.estado === 'pausada' || conv.estado === 'intervenida_humano'
                ? 'IA pausada — escribe respuesta manual al cliente'
                : 'Mensaje manual (la IA dejará de responder en esta conversación)'}
              rows={2}
              style={{ flex: 1, padding: 8, border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
            <button onClick={enviar} disabled={enviando || !mensaje.trim()} className="btn btn-primary">
              {enviando ? '...' : 'Enviar'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
            ⚠️ Al enviar manualmente, la IA se pausa para esta conversación.
          </div>
        </div>
      )}
    </div>
  );
}

function Burbuja({ m }) {
  const esCliente = m.direccion === 'entrante';
  const colores = {
    ia:     { bg: '#dbeafe', label: '🤖 IA' },
    humano: { bg: '#fed7aa', label: '👤 Humano' },
    cliente: { bg: '#fff', label: '👋 Cliente' },
    sistema: { bg: '#f3f4f6', label: '⚙️ Sistema' },
  };
  const c = colores[m.remitente] || colores.sistema;
  return (
    <div style={{ display: 'flex', justifyContent: esCliente ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
      <div style={{ maxWidth: '75%' }}>
        <div style={{
          background: c.bg, padding: '8px 12px', borderRadius: 12,
          borderTopLeftRadius: esCliente ? 4 : 12,
          borderTopRightRadius: esCliente ? 12 : 4,
          fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap',
        }}>{m.contenido}</div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, textAlign: esCliente ? 'left' : 'right' }}>
          {c.label} · {fmtFecha(m.created_at)} · {m.estado_envio}
        </div>
      </div>
    </div>
  );
}

function DripView({ dripStats, esDirector, onActualizar }) {
  const [procesando, setProcesando] = useState(false);
  const procesar = async () => {
    setProcesando(true);
    try {
      const r = await api.vendedorProcesarDrip();
      alert(`Procesado: ${r.enviados || 0} enviados, ${r.cancelados || 0} cancelados (cliente respondió), ${r.fallidos || 0} fallidos.`);
      onActualizar();
    } catch (e) { alert(e.message); } finally { setProcesando(false); }
  };

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
      <h3 style={{ margin: '0 0 14px' }}>🌧️ Drip campaigns</h3>
      <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
        Cuando un lead llega y no responde a la cotización inicial, el Vendedor IA le manda mensajes de seguimiento automáticos:
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 16, marginBottom: 20 }}>
        <DripStage day="Día 1" desc="Recordatorio amable" canal="WhatsApp" />
        <DripStage day="Día 3" desc="¿Algo te detiene?" canal="WhatsApp" />
        <DripStage day="Día 7" desc="Descuento -5%" canal="WhatsApp + Email" />
        <DripStage day="Día 14" desc="Última oportunidad" canal="WhatsApp + Email" />
      </div>
      <div style={{ background: '#fef3c7', padding: 12, borderRadius: 8, fontSize: 13, color: '#92400e', marginBottom: 16 }}>
        💡 <strong>Importante:</strong> el cron procesa drips cada 30 minutos automáticamente. Si un cliente responde, sus drips pendientes se cancelan solos.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Mini label="Pendientes"  valor={dripStats?.drip_pendientes || 0} color="#3b82f6" />
        <Mini label="Enviados"   valor={dripStats?.drip_enviados || 0}  color="#16a34a" />
        <Mini label="Cancelados" valor={dripStats?.drip_cancelados || 0} color="#6b7280" />
      </div>
      {esDirector && (
        <div style={{ marginTop: 16 }}>
          <button onClick={procesar} disabled={procesando} className="btn btn-ghost">
            {procesando ? 'Procesando...' : '⚡ Procesar drips pendientes ahora'}
          </button>
        </div>
      )}
    </div>
  );
}

function DripStage({ day, desc, canal }) {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' }}>{day}</div>
      <div style={{ fontSize: 14, marginTop: 4, fontWeight: 600 }}>{desc}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>📤 {canal}</div>
    </div>
  );
}

function ModalConfig({ actual, canalesOk, onClose, onGuardado }) {
  const [form, setForm] = useState({
    vendedor_ia_activo:            actual.vendedor_ia_activo === 'true',
    vendedor_ia_horario_inicio:    actual.vendedor_ia_horario_inicio || '08:00',
    vendedor_ia_horario_fin:       actual.vendedor_ia_horario_fin    || '21:00',
    vendedor_ia_descuento_max_pct: parseFloat(actual.vendedor_ia_descuento_max_pct || 7),
    vendedor_ia_modelo:            actual.vendedor_ia_modelo || 'claude-sonnet-4-6',
    vendedor_ia_canales_default:   actual.vendedor_ia_canales_default || 'whatsapp,email',
    vendedor_ia_envio_inmediato:   actual.vendedor_ia_envio_inmediato === 'true',
    vendedor_ia_drip_d1:           actual.vendedor_ia_drip_d1 === 'true',
    vendedor_ia_drip_d3:           actual.vendedor_ia_drip_d3 === 'true',
    vendedor_ia_drip_d7:           actual.vendedor_ia_drip_d7 === 'true',
    vendedor_ia_drip_d14:          actual.vendedor_ia_drip_d14 === 'true',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.vendedorGuardarConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  const puedeActivar = canalesOk.whatsapp || canalesOk.email;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 640, width: '100%', padding: 24,
        maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Configurar Vendedor IA</h2>

        {!puedeActivar && (
          <div style={{ background: '#fee2e2', padding: 12, borderRadius: 8, fontSize: 13, color: '#991b1b', marginBottom: 14 }}>
            ⚠️ <strong>Falta configurar canales</strong>. Ve a <strong>Configuración → API Keys</strong> y agrega al menos WhatsApp (Twilio) o Email (SendGrid).
          </div>
        )}

        <div className="form-group">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.vendedor_ia_activo} disabled={!puedeActivar}
              onChange={e => setForm({ ...form, vendedor_ia_activo: e.target.checked })} />
            <strong>Vendedor IA activo</strong> — responde automáticamente a leads nuevos
          </label>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Horario inicio</label>
            <input type="time" value={form.vendedor_ia_horario_inicio}
              onChange={e => setForm({ ...form, vendedor_ia_horario_inicio: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Horario fin</label>
            <input type="time" value={form.vendedor_ia_horario_fin}
              onChange={e => setForm({ ...form, vendedor_ia_horario_fin: e.target.value })} />
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: -8, marginBottom: 12 }}>
          Fuera de este horario, los drips se posponen al día siguiente.
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Descuento máximo (%)</label>
            <input type="number" step="0.5" min="0" max="30" value={form.vendedor_ia_descuento_max_pct}
              onChange={e => setForm({ ...form, vendedor_ia_descuento_max_pct: parseFloat(e.target.value) })} />
            <small style={{ color: '#6b7280', fontSize: 11 }}>
              Si el cliente pide más, la IA escala a humano (tú).
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Modelo Claude</label>
            <select value={form.vendedor_ia_modelo} onChange={e => setForm({ ...form, vendedor_ia_modelo: e.target.value })}>
              <option value="claude-sonnet-4-6">Sonnet 4.6 (recomendado, $3/$15 por 1M)</option>
              <option value="claude-haiku-4-5">Haiku 4.5 (más barato $1/$5)</option>
              <option value="claude-opus-4-7">Opus 4.7 (premium $5/$25)</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Drip campaigns activos</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { k: 'vendedor_ia_drip_d1',  l: 'Día 1 — recordatorio amable' },
              { k: 'vendedor_ia_drip_d3',  l: 'Día 3 — "¿algo te detiene?"' },
              { k: 'vendedor_ia_drip_d7',  l: 'Día 7 — descuento -5%' },
              { k: 'vendedor_ia_drip_d14', l: 'Día 14 — última oportunidad' },
            ].map(d => (
              <label key={d.k} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={form[d.k]}
                  onChange={e => setForm({ ...form, [d.k]: e.target.checked })} />
                {d.l}
              </label>
            ))}
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
