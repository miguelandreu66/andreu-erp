import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const AGENTES = [
  { n: 'director',   e: '🎩', l: 'Director IA',     rol: 'Estratega',   color: '#1B3A6B', desc: 'Dashboard ejecutivo + decisiones estratégicas + OKRs' },
  { n: 'operaciones',e: '⚙️', l: 'Operaciones IA',  rol: 'Logística',   color: '#3B82F6', desc: 'Asignación operador/unidad + rutas + mantenimiento predictivo' },
  { n: 'cfo',        e: '💼', l: 'CFO IA',          rol: 'Finanzas',    color: '#16A34A', desc: 'Cashflow + margen por viaje + proyecciones' },
  { n: 'abogado',    e: '⚖️', l: 'Abogado IA',      rol: 'Legal',       color: '#0EA5E9', desc: 'Contratos + Carta Porte + reclamaciones + multas SCT/SAT' },
  { n: 'contador',   e: '📊', l: 'Contador IA',     rol: 'Fiscal',      color: '#8B5CF6', desc: 'CFDI + ISR + IVA + DIOT + declaraciones' },
  { n: 'rrhh',       e: '👥', l: 'RRHH IA',         rol: 'Talento',     color: '#EC4899', desc: 'Scoring operadores + bonos + retención + onboarding' },
  { n: 'comercial',  e: '💵', l: 'Comercial IA',    rol: 'Ventas',      color: '#E87722', desc: 'Cotizador + clientes recurrentes + upsell + contratos' },
];

export default function AgentesIA() {
  const { nombre } = useParams();
  const navigate = useNavigate();
  const [seleccionado, setSeleccionado] = useState(nombre || null);

  useEffect(() => { if (nombre) setSeleccionado(nombre); }, [nombre]);

  if (seleccionado) return <ConversacionAgente nombre={seleccionado} onVolver={() => navigate('/agentes')} />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>🤖 Agentes IA de Andreu Logistics</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            7 agentes especializados con Claude. Tu equipo virtual completo para operar la flota.
          </p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {AGENTES.map(a => (
          <button key={a.n} onClick={() => navigate(`/agentes/${a.n}`)} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${a.color}`,
            borderRadius: 12, padding: 18, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
            transition: 'all 0.15s',
          }} onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; }}
            onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 36 }}>{a.e}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{a.l}</div>
                <div style={{ fontSize: 11, color: a.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{a.rol}</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{a.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversacionAgente({ nombre, onVolver }) {
  const agente = AGENTES.find(a => a.n === nombre);
  const [mensajes, setMensajes] = useState([]);
  const [input, setInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [costoTotal, setCostoTotal] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  const enviar = useCallback(async () => {
    if (!input.trim() || enviando) return;
    const mensaje = input.trim();
    setInput('');
    setMensajes(m => [...m, { role: 'user', content: mensaje }]);
    setEnviando(true); setError(null);
    try {
      const historial = mensajes.filter(m => typeof m.content === 'string').map(m => ({ role: m.role, content: m.content }));
      const r = await api.agentesConversar(nombre, mensaje, historial);
      setMensajes(m => [...m, { role: 'assistant', content: r.respuesta, usage: r.usage, costo: r.costo_usd, duracion_ms: r.duracion_ms, modelo: r.modelo }]);
      setCostoTotal(c => c + (r.costo_usd || 0));
    } catch (e) { setError(e.message); }
    finally { setEnviando(false); }
  }, [input, enviando, mensajes, nombre]);

  if (!agente) return <div className="empty">Agente "{nombre}" no encontrado.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${agente.color}`, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button onClick={onVolver} className="btn btn-ghost btn-sm">← Volver</button>
        <div style={{ fontSize: 42 }}>{agente.e}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{agente.l}</h3>
          <div style={{ fontSize: 12, color: agente.color, fontWeight: 700, textTransform: 'uppercase' }}>{agente.rol}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{agente.desc}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, color: '#6b7280' }}>
          <div>Costo sesión:</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>${costoTotal.toFixed(4)} USD</div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', background: '#f9fafb', borderRadius: 12, padding: 16, border: '1px solid #e5e7eb', marginBottom: 14 }}>
        {mensajes.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>{agente.e}</div>
            <div style={{ fontSize: 14 }}>Hola, soy <strong>{agente.l}</strong>.<br/>{agente.desc}</div>
            <div style={{ marginTop: 16, fontSize: 12 }}>Pregúntame lo que necesites sobre tu rol como <strong>{agente.rol.toLowerCase()}</strong>.</div>
          </div>
        )}
        {mensajes.map((m, i) => <Burbuja key={i} m={m} agente={agente} />)}
        {enviando && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
            <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 12, fontSize: 13, color: '#6b7280' }}>{agente.e} pensando...</div>
          </div>
        )}
      </div>

      {error && <div className="alert red" style={{ marginBottom: 10 }}><div className="alert-dot"/><div>{error}</div></div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          rows={2} placeholder={`Escribe a ${agente.l}...`}
          style={{ flex: 1, resize: 'none' }} />
        <button onClick={enviar} disabled={enviando || !input.trim()} className="btn btn-primary">Enviar</button>
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center', marginTop: 6 }}>
        Enter para enviar · Shift+Enter para salto de línea
      </div>
    </div>
  );
}

function Burbuja({ m, agente }) {
  const esCliente = m.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: esCliente ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
      <div style={{ maxWidth: '80%' }}>
        <div style={{
          background: esCliente ? agente.color : '#fff',
          color: esCliente ? '#fff' : '#1a1a1a',
          padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        }}>{m.content}</div>
        {!esCliente && m.costo != null && (
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
            🧠 {m.modelo} · {(m.duracion_ms / 1000).toFixed(1)}s · ${m.costo?.toFixed(4)} USD · {(m.usage?.input_tokens || 0) + (m.usage?.output_tokens || 0)} tokens
          </div>
        )}
      </div>
    </div>
  );
}
