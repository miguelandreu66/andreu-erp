import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtFecha = d => d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const ESTADO_COLOR = {
  nuevo:              { bg: '#dbeafe', txt: '#1e3a8a', label: '🆕 Nuevo' },
  contactado:         { bg: '#fef3c7', txt: '#92400e', label: '📞 Contactado' },
  propuesta_enviada:  { bg: '#e0e7ff', txt: '#3730a3', label: '📄 Propuesta enviada' },
  negociando:         { bg: '#fde68a', txt: '#92400e', label: '💬 Negociando' },
  ganado:             { bg: '#dcfce7', txt: '#166534', label: '✅ Ganado' },
  perdido:            { bg: '#fee2e2', txt: '#991b1b', label: '❌ Perdido' },
  spam:               { bg: '#f3f4f6', txt: '#6b7280', label: '🗑️ Spam' },
};

export default function Leads() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';

  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [loading, setLoading] = useState(true);
  const [leadAbierto, setLeadAbierto] = useState(null);
  const [msg, setMsg] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.leads(filtroEstado ? `?estado=${filtroEstado}` : '');
      setLeads(r.leads || []); setStats(r.stats || null);
    } catch (e) {
      setMsg({ tipo: 'red', txt: e.message });
    } finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEstado = async (id, estado) => {
    try {
      await api.actualizarEstadoLead(id, { estado });
      cargar();
      if (leadAbierto?.id === id) {
        const r = await api.detalleLead(id);
        setLeadAbierto(r);
      }
    } catch (e) { alert('Error: ' + e.message); }
  };

  const convertirCliente = async (id) => {
    if (!window.confirm('¿Convertir este lead a cliente y marcarlo como ganado?')) return;
    try {
      const r = await api.convertirLeadCliente(id, { tipo: 'constructora' });
      setMsg({ tipo: 'green', txt: `✓ Cliente "${r.cliente.nombre}" creado y lead ${r.lead_folio} marcado como ganado.` });
      cargar();
      setLeadAbierto(null);
    } catch (e) { alert('Error: ' + e.message); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🎯 Leads — Cotizaciones públicas</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Cotizaciones generadas por la IA desde <a href="/cotizar" target="_blank" rel="noopener noreferrer">/cotizar</a>
          </p>
        </div>
      </div>

      {msg && <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{msg.txt}</div></div>}

      {/* Stats */}
      {stats && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          <Stat label="🆕 Nuevos" value={stats.nuevos} color="#2563eb" />
          <Stat label="📞 Contactados" value={stats.contactados} color="#d97706" />
          <Stat label="📄 Propuesta" value={stats.propuesta} color="#3730a3" />
          <Stat label="💬 Negociando" value={stats.negociando} color="#d97706" />
          <Stat label="✅ Ganados" value={stats.ganados} color="#16a34a" />
          <Stat label="❌ Perdidos" value={stats.perdidos} color="#dc2626" />
          <Stat label="💰 Pipeline" value={fmt$(stats.pipeline_value)} color="#1B3A6B" />
          <Stat label="🎯 Ganado mes" value={fmt$(stats.ganado_mes)} color="#16a34a" />
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Filtrar:</span>
        {[
          { v: '', l: 'Todos' }, { v: 'nuevo', l: 'Nuevos' }, { v: 'contactado', l: 'Contactados' },
          { v: 'propuesta_enviada', l: 'Propuesta' }, { v: 'negociando', l: 'Negociando' },
          { v: 'ganado', l: 'Ganados' }, { v: 'perdido', l: 'Perdidos' },
        ].map(o => (
          <button key={o.v} onClick={() => setFiltroEstado(o.v)} style={{
            padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
            background: filtroEstado === o.v ? '#1A1A1A' : '#fff',
            color: filtroEstado === o.v ? '#fff' : '#374151',
            border: '1px solid #d1d5db', fontWeight: filtroEstado === o.v ? 700 : 400,
          }}>{o.l}</button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="empty">Cargando leads...</div>
      ) : leads.length === 0 ? (
        <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 10 }}>🎯</div>
          <h3 style={{ margin: '0 0 6px' }}>Sin leads todavía</h3>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            Comparte el link <a href="/cotizar" target="_blank" rel="noopener noreferrer">/cotizar</a> en tus redes y WhatsApp.
            Cada cotización pública aparecerá aquí.
          </p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>Folio</th>
                <th style={th}>Contacto</th>
                <th style={th}>Ruta</th>
                <th style={th}>Carga</th>
                <th style={{ ...th, textAlign: 'right' }}>Precio</th>
                <th style={{ ...th, textAlign: 'right' }}>Margen</th>
                <th style={th}>Estado</th>
                <th style={th}>Recibido</th>
              </tr>
            </thead>
            <tbody>
              {leads.map(l => {
                const estado = ESTADO_COLOR[l.estado] || ESTADO_COLOR.nuevo;
                return (
                  <tr key={l.id} onClick={() => setLeadAbierto(l)} style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer' }}>
                    <td style={td}><strong>{l.folio}</strong></td>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{l.contacto_nombre}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>
                        {l.empresa || ''}{l.empresa && (l.email || l.telefono) ? ' · ' : ''}
                        {l.email || l.telefono || ''}
                      </div>
                    </td>
                    <td style={td}>
                      <div>{l.origen} → {l.destino}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{l.distancia_km ? `${l.distancia_km} km` : ''}</div>
                    </td>
                    <td style={td}>
                      <div>{l.toneladas ? `${l.toneladas}t` : '—'}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{l.tipo_carga}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#1B3A6B' }}>{fmt$(l.precio_final)}</td>
                    <td style={{ ...td, textAlign: 'right', fontSize: 12 }}>
                      <span style={{ color: l.margen_pct >= 35 ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                        {l.margen_pct ? `${l.margen_pct}%` : '—'}
                      </span>
                    </td>
                    <td style={td}>
                      <span style={{
                        background: estado.bg, color: estado.txt, padding: '2px 8px',
                        borderRadius: 999, fontSize: 11, fontWeight: 600,
                      }}>{estado.label}</span>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#6b7280' }}>{fmtFecha(l.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {leadAbierto && (
        <ModalLead
          lead={leadAbierto} esDirector={esDirector}
          onClose={() => setLeadAbierto(null)}
          onCambiarEstado={cambiarEstado}
          onConvertirCliente={convertirCliente}
        />
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

function ModalLead({ lead, esDirector, onClose, onCambiarEstado, onConvertirCliente }) {
  const c = lead.desglose; // JSON con la cotización completa
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 700, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{lead.folio}</div>
            <h2 style={{ margin: '4px 0 4px' }}>{lead.contacto_nombre}</h2>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              {lead.empresa || '—'} · {lead.email || '—'} · {lead.telefono || '—'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        {/* Ruta */}
        <div style={{ background: '#f9fafb', padding: 14, borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>📍 {lead.origen} → {lead.destino}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>
            {lead.distancia_km} km · {lead.toneladas ? `${lead.toneladas}t` : 'sin peso'} · {lead.tipo_carga} · {lead.recurrencia}
            {lead.fecha_solicitada && <> · Fecha: {lead.fecha_solicitada}</>}
          </div>
        </div>

        {/* Precio breakdown */}
        {c && c.precio && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', padding: 14, borderRadius: 10, marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 13 }}>💰 Cotización generada</h4>
            <Row k="Precio base" v={fmt$(c.precio.base)} />
            {c.precio.recargos?.map((r, i) => <Row key={i} k={`Recargo: ${r.concepto}`} v={`+${fmt$(r.monto)} (${r.pct}%)`} small />)}
            {c.precio.descuentos?.map((d, i) => <Row key={i} k={`Descuento: ${d.concepto}`} v={`-${fmt$(d.monto)} (${d.pct}%)`} small color="#166534" />)}
            {c.precio.extras?.map((e, i) => <Row key={i} k={`Extra: ${e.concepto}`} v={`+${fmt$(e.monto)}`} small />)}
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 6, marginTop: 6 }}>
              <Row k="Subtotal" v={fmt$(c.precio.subtotal)} />
              <Row k="IVA" v={fmt$(c.precio.iva)} small />
              <Row k="TOTAL" v={fmt$(c.precio.total_con_iva)} bold />
            </div>
            <div style={{ marginTop: 10, padding: 8, background: c.analisis.alerta_margen_bajo ? '#fee2e2' : '#dcfce7', borderRadius: 6, fontSize: 12 }}>
              {c.analisis.mensaje_analisis}
            </div>
          </div>
        )}

        {/* Comentarios del cliente */}
        {lead.comentarios && (
          <div style={{ background: '#f0f9ff', padding: 10, borderRadius: 8, marginBottom: 14, fontSize: 13, fontStyle: 'italic' }}>
            💬 Cliente dice: "{lead.comentarios}"
          </div>
        )}

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {lead.estado !== 'contactado' && lead.estado !== 'ganado' && (
            <button onClick={() => onCambiarEstado(lead.id, 'contactado')} className="btn btn-ghost btn-sm">📞 Marcar contactado</button>
          )}
          {!['ganado','perdido'].includes(lead.estado) && (
            <button onClick={() => onCambiarEstado(lead.id, 'propuesta_enviada')} className="btn btn-ghost btn-sm">📄 Propuesta enviada</button>
          )}
          {esDirector && lead.estado !== 'ganado' && !lead.cliente_id && (
            <button onClick={() => onConvertirCliente(lead.id)} className="btn btn-primary btn-sm">✅ Convertir en cliente</button>
          )}
          {!['perdido','spam'].includes(lead.estado) && (
            <button onClick={() => {
              const motivo = window.prompt('Motivo (opcional):');
              if (motivo !== null) onCambiarEstado(lead.id, 'perdido', motivo);
            }} className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }}>❌ Marcar perdido</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold, small, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: small ? 12 : 14 }}>
      <span style={{ color: color || (bold ? '#1B3A6B' : '#374151'), fontWeight: bold ? 800 : (small ? 400 : 500) }}>{k}</span>
      <span style={{ color: color || (bold ? '#1B3A6B' : '#111'), fontWeight: bold ? 800 : 600 }}>{v}</span>
    </div>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
