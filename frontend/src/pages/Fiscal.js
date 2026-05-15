import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + parseFloat(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
const fmtFecha = ts => ts ? new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

const ESTADOS = {
  borrador:               { bg: '#f3f4f6', color: '#6b7280', label: 'Borrador',   emoji: '📝' },
  emitiendo:              { bg: '#fef3c7', color: '#92400e', label: 'Emitiendo',  emoji: '⏳' },
  emitido:                { bg: '#dcfce7', color: '#166534', label: 'Emitido',    emoji: '✅' },
  enviado:                { bg: '#dbeafe', color: '#1e3a8a', label: 'Enviado',    emoji: '📤' },
  cancelado:              { bg: '#fee2e2', color: '#991b1b', label: 'Cancelado',  emoji: '⛔' },
  fallido:                { bg: '#fee2e2', color: '#991b1b', label: 'Fallido',    emoji: '⚠️' },
  cancelacion_pendiente:  { bg: '#fef3c7', color: '#92400e', label: 'Cancel. Pendiente', emoji: '⏰' },
};

export default function Fiscal() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';
  const esAdmin    = ['director','admin'].includes(usuario?.rol);

  const [dash, setDash] = useState(null);
  const [cfdis, setCfdis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('lista');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [seleccionado, setSeleccionado] = useState(null);
  const [configurando, setConfigurando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, l] = await Promise.all([
        api.cfdiDashboard(),
        api.cfdiList(filtroEstado === 'todos' ? '' : `?estado=${filtroEstado}`),
      ]);
      setDash(d);
      setCfdis(l || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading && !dash) return <div className="empty">Cargando módulo fiscal...</div>;

  const auto = dash?.auto || {};
  const stats = dash?.stats_mes || {};
  const pacConfig = dash?.pac?.configurado;
  const fiscalCompleto = dash?.fiscal_completo;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>📄 Facturación SAT (CFDI 4.0 + Carta Porte)</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Cierre operativo automático. Al completar un viaje, el sistema emite CFDI 4.0 con
            complemento Carta Porte 3.0 y lo envía al cliente por email y WhatsApp.
          </p>
        </div>
        {esAdmin && <button onClick={() => setConfigurando(true)} className="btn btn-primary">⚙️ Configurar SAT</button>}
      </div>

      {error && <div className="alert red" style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{error}</div></div>}

      {/* Status setup */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatusBadge ok={fiscalCompleto} label="Datos fiscales emisor" detalle={fiscalCompleto ? `RFC configurado` : 'Falta RFC, razón social o régimen'} />
        <StatusBadge ok={pacConfig} label={`PAC Facturama (${dash?.pac?.modo || 'sandbox'})`} detalle={pacConfig ? 'Listo para emitir' : 'Falta usuario/contraseña Facturama'} />
        <StatusBadge ok={auto.emitir}        label="Auto-emisión al completar viaje" detalle={auto.emitir ? 'Activa' : 'Manual'} />
        <StatusBadge ok={auto.enviar_cliente} label={`Auto-envío al cliente (${auto.canales || 'email'})`} detalle={auto.enviar_cliente ? 'Activo' : 'Manual'} />
      </div>

      {/* KPIs del mes */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="📤 Emitidos este mes"  value={stats.emitidos_mes || 0}      color="#16a34a" />
        <Stat label="💰 Monto facturado"     value={fmt$(stats.monto_emitido_mes)} color="#1B3A6B" />
        <Stat label="📝 Borradores"          value={stats.borradores_mes || 0}    color="#6b7280" />
        <Stat label="⚠️ Fallidos / Cancelados" value={`${stats.fallidos_mes || 0} / ${stats.cancelados_mes || 0}`} color="#991b1b" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {[{ id: 'lista', l: '📋 Lista de CFDIs' }, { id: 'historico', l: '📊 Histórico mensual' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
              background: tab === t.id ? '#1B3A6B' : '#fff',
              color: tab === t.id ? '#fff' : '#1B3A6B',
              border: '1px solid #1B3A6B', fontWeight: tab === t.id ? 700 : 500,
            }}>{t.l}</button>
        ))}
      </div>

      {tab === 'lista' && (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <FiltroBtn label="Todos" activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            {Object.entries(ESTADOS).map(([k, v]) => (
              <FiltroBtn key={k} label={`${v.emoji} ${v.label}`} activo={filtroEstado === k} onClick={() => setFiltroEstado(k)} />
            ))}
          </div>
          {cfdis.length === 0 ? (
            <EmptyState icono="📄" titulo="Sin CFDIs todavía"
              texto="Cuando completes un viaje con cliente que tenga RFC, el sistema te genera CFDI automáticamente. Ve a un viaje completado y dale click a 'Emitir CFDI' para hacerlo manual." />
          ) : (
            <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={th}>Estado</th>
                    <th style={th}>Folio</th>
                    <th style={th}>UUID</th>
                    <th style={th}>Cliente</th>
                    <th style={th}>Ruta</th>
                    <th style={{ ...th, textAlign: 'right' }}>Total</th>
                    <th style={th}>Carta Porte</th>
                    <th style={th}>Enviado</th>
                    <th style={th}>Emitido</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {cfdis.map(c => {
                    const e = ESTADOS[c.estado] || ESTADOS.borrador;
                    return (
                      <tr key={c.id} style={{ borderTop: '1px solid #f3f4f6', cursor: 'pointer' }}
                        onClick={() => setSeleccionado(c.id)}>
                        <td style={td}>
                          <span style={{ background: e.bg, color: e.color, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                            {e.emoji} {e.label}
                          </span>
                        </td>
                        <td style={td}><strong>{c.serie}{c.folio}</strong></td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{c.uuid_fiscal ? c.uuid_fiscal.slice(0, 8) + '...' : '—'}</td>
                        <td style={td}>
                          <div>{c.cliente_nombre || c.receptor_razon_social || '—'}</div>
                          <div style={{ fontSize: 10, color: '#6b7280' }}>{c.receptor_rfc}</div>
                        </td>
                        <td style={td}>{c.origen ? `${c.origen} → ${c.destino}` : '—'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(c.total)}</td>
                        <td style={td}>{c.tiene_carta_porte ? '✅' : '—'}</td>
                        <td style={td}>{c.enviado_cliente ? `✅ ${fmtFecha(c.enviado_cliente_at).split(',')[0]}` : '—'}</td>
                        <td style={{ ...td, fontSize: 12 }}>{fmtFecha(c.fecha_emision || c.created_at)}</td>
                        <td style={td}><button className="btn btn-ghost btn-sm">👁️</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'historico' && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={th}>Periodo</th>
                <th style={th}>Emitidos</th>
                <th style={th}>Cancelados</th>
                <th style={th}>Fallidos</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto emitido</th>
              </tr>
            </thead>
            <tbody>
              {(dash?.historico || []).map(h => (
                <tr key={h.periodo} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={td}><strong>{h.periodo}</strong></td>
                  <td style={td}>{h.emitidos}</td>
                  <td style={td}>{h.cancelados}</td>
                  <td style={td}>{h.fallidos}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(h.monto_emitido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {seleccionado && (
        <ModalDetalle id={seleccionado} esAdmin={esAdmin} esDirector={esDirector}
          onClose={() => setSeleccionado(null)} onActualizar={cargar} />
      )}

      {configurando && (
        <ModalConfigFiscal onClose={() => setConfigurando(false)} onGuardado={() => { setConfigurando(false); cargar(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value" style={{ color, marginTop: 4 }}>{value}</div></div>;
}

function StatusBadge({ ok, label, detalle }) {
  return (
    <div style={{
      background: ok ? '#f0fdf4' : '#fef2f2',
      border: '1px solid ' + (ok ? '#bbf7d0' : '#fecaca'),
      padding: '8px 12px', borderRadius: 8, fontSize: 12, minWidth: 180,
    }}>
      <div style={{ color: ok ? '#166534' : '#991b1b', fontWeight: 700 }}>
        {ok ? '✅' : '⚠️'} {label}
      </div>
      <div style={{ color: '#6b7280', marginTop: 2, fontSize: 11 }}>{detalle}</div>
    </div>
  );
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
      <h3 style={{ margin: '0 0 6px', color: '#374151' }}>{titulo}</h3>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>{texto}</p>
    </div>
  );
}

function ModalDetalle({ id, esAdmin, esDirector, onClose, onActualizar }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accion, setAccion] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setData(await api.cfdiDetalle(id)); }
    catch (e) { alert(e.message); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const reenviar = async () => {
    setAccion(true);
    try { const r = await api.cfdiEnviarCliente(id); alert(r.ok ? '✅ Enviado al cliente' : '⚠️ ' + JSON.stringify(r.resultados)); await cargar(); onActualizar(); }
    catch (e) { alert(e.message); } finally { setAccion(false); }
  };

  const cancelar = async () => {
    const motivo = prompt('Motivo de cancelación SAT:\n01 = Error con relación\n02 = Error sin relación (más común)\n03 = No se llevó a cabo la operación\n04 = Op. nominativa relacionada en factura global', '02');
    if (!motivo) return;
    if (!window.confirm(`¿Cancelar CFDI ${data.cfdi.serie}${data.cfdi.folio} con motivo ${motivo}? Esta acción no se puede deshacer.`)) return;
    setAccion(true);
    try { await api.cfdiCancelar(id, { motivo }); alert('✅ Cancelado'); await cargar(); onActualizar(); }
    catch (e) { alert(e.message); } finally { setAccion(false); }
  };

  const reintentar = async () => {
    setAccion(true);
    try { await api.cfdiReintentar(id); alert('✅ Reintentando — revisa el estado'); await cargar(); onActualizar(); onClose(); }
    catch (e) { alert(e.message); } finally { setAccion(false); }
  };

  if (loading || !data) return null;
  const c = data.cfdi;
  const e = ESTADOS[c.estado] || ESTADOS.borrador;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={ev => ev.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 760, width: '100%', padding: 24,
        maxHeight: '92vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ background: e.bg, color: e.color, padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
                {e.emoji} {e.label}
              </span>
              <h2 style={{ margin: 0 }}>CFDI {c.serie}{c.folio}</h2>
            </div>
            {c.uuid_fiscal && <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace', marginTop: 4 }}>UUID: {c.uuid_fiscal}</div>}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <CampoCard label="Cliente" valor={c.cliente_nombre || c.receptor_razon_social} sub={c.receptor_rfc} />
          <CampoCard label="Total" valor={fmt$(c.total)} sub={`Subtotal ${fmt$(c.subtotal)} + IVA ${fmt$(c.total_iva)}`} />
          <CampoCard label="Tipo / Moneda" valor={`${c.tipo_comprobante} / ${c.moneda}`} sub={`Forma pago: ${c.forma_pago || '—'}, Método: ${c.metodo_pago || '—'}`} />
          <CampoCard label="Carta Porte" valor={c.tiene_carta_porte ? '✅ Sí' : '—'} sub={c.tiene_carta_porte ? `${c.origen_cp} → ${c.destino_cp} · ${c.distancia_km}km · ${c.peso_bruto_kg}kg` : 'Sin complemento'} />
          <CampoCard label="Modo PAC" valor={c.pac_modo} sub={`Emitido ${fmtFecha(c.fecha_emision || c.created_at)}`} />
          <CampoCard label="Enviado cliente" valor={c.enviado_cliente ? `✅ ${fmtFecha(c.enviado_cliente_at).split(',')[0]}` : '—'} sub={c.enviado_canales?.join(', ') || ''} />
        </div>

        {c.error_mensaje && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
            <strong>⚠️ Error del PAC:</strong>
            <pre style={{ margin: '6px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{c.error_mensaje}</pre>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {c.uuid_fiscal && <a href={api.cfdiPdfUrl(c.id)} target="_blank" rel="noopener noreferrer" className="btn btn-primary">📄 Ver PDF</a>}
          {c.uuid_fiscal && <a href={api.cfdiXmlUrl(c.id)} className="btn btn-ghost">📋 Descargar XML</a>}
          {esAdmin && ['emitido','enviado'].includes(c.estado) && (
            <button onClick={reenviar} disabled={accion} className="btn btn-ghost">📤 Reenviar al cliente</button>
          )}
          {esAdmin && c.estado === 'fallido' && (
            <button onClick={reintentar} disabled={accion} className="btn" style={{ background: '#fbbf24', color: '#7c2d12' }}>🔄 Reintentar</button>
          )}
          {esDirector && ['emitido','enviado'].includes(c.estado) && (
            <button onClick={cancelar} disabled={accion} className="btn" style={{ background: '#fee2e2', color: '#991b1b' }}>⛔ Cancelar</button>
          )}
        </div>

        {/* Conceptos */}
        {data.conceptos?.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#6b7280', textTransform: 'uppercase' }}>Conceptos</h4>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', background: '#f9fafb', borderRadius: 6, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={th}>Descripción</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cant</th>
                  <th style={{ ...th, textAlign: 'right' }}>P. Unit.</th>
                  <th style={{ ...th, textAlign: 'right' }}>Importe</th>
                  <th style={{ ...th, textAlign: 'right' }}>IVA</th>
                </tr>
              </thead>
              <tbody>
                {data.conceptos.map(con => (
                  <tr key={con.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={td}>{con.descripcion}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{con.cantidad}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt$(con.valor_unitario)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt$(con.importe)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt$(con.importe_iva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Eventos */}
        {data.eventos?.length > 0 && (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>📜 Timeline ({data.eventos.length} eventos)</summary>
            <div style={{ marginTop: 8 }}>
              {data.eventos.map(ev => (
                <div key={ev.id} style={{ padding: '6px 10px', borderLeft: '2px solid #d1d5db', fontSize: 12, marginBottom: 4 }}>
                  <strong>{ev.evento}</strong> · <span style={{ color: '#6b7280' }}>{fmtFecha(ev.created_at)}</span>
                  {ev.detalle && <pre style={{ margin: '2px 0 0', fontSize: 10, color: '#374151', whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'auto' }}>{JSON.stringify(ev.detalle, null, 1)}</pre>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function CampoCard({ label, valor, sub }) {
  return (
    <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{valor || '—'}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ModalConfigFiscal({ onClose, onGuardado }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [tab, setTab] = useState('emisor');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.cfdiConfigEmpresa().then(c => {
      setCfg(c);
      const init = {};
      for (const [k, v] of Object.entries(c)) init[k] = v.valor;
      setForm(init);
    });
  }, []);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.cfdiGuardarConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  if (!cfg) return null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%', padding: 24,
        maxHeight: '92vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 6px' }}>⚙️ Configuración Fiscal SAT</h2>
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
          Datos necesarios para emitir CFDI 4.0 + Carta Porte 3.0. Pide a tu contador si no los tienes a la mano.
        </p>

        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {[
            { id: 'emisor', l: '🏢 Datos del emisor' },
            { id: 'cartaporte', l: '🚛 Carta Porte' },
            { id: 'auto', l: '🤖 Automatización' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                background: tab === t.id ? '#1B3A6B' : '#fff',
                color: tab === t.id ? '#fff' : '#1B3A6B',
                border: '1px solid #1B3A6B',
              }}>{t.l}</button>
          ))}
        </div>

        {tab === 'emisor' && (
          <div>
            <Campo label="RFC del emisor (Andreu)" value={form.fiscal_rfc} onChange={v => setForm({ ...form, fiscal_rfc: v.toUpperCase() })} placeholder="AND123456ABC" />
            <Campo label="Razón social completa" value={form.fiscal_razon_social} onChange={v => setForm({ ...form, fiscal_razon_social: v })} placeholder="ANDREU LOGISTICS S DE RL DE CV" />
            <Campo label="Nombre comercial" value={form.fiscal_nombre_comercial} onChange={v => setForm({ ...form, fiscal_nombre_comercial: v })} />
            <div className="form-row">
              <CampoSelect label="Régimen fiscal SAT" value={form.fiscal_regimen_fiscal} onChange={v => setForm({ ...form, fiscal_regimen_fiscal: v })}
                opciones={[
                  { v: '601', l: '601 — General de Ley Personas Morales' },
                  { v: '612', l: '612 — PFAE Personas Físicas con Actividades Empresariales' },
                  { v: '603', l: '603 — Personas Morales con Fines no Lucrativos' },
                  { v: '626', l: '626 — RESICO Personas Morales' },
                  { v: '621', l: '621 — Incorporación Fiscal' },
                ]} />
              <Campo label="CP del lugar de expedición" value={form.fiscal_codigo_postal} onChange={v => setForm({ ...form, fiscal_codigo_postal: v })} placeholder="62000" />
            </div>
            <div className="form-row">
              <Campo label="Serie CFDI" value={form.fiscal_serie_cfdi} onChange={v => setForm({ ...form, fiscal_serie_cfdi: v.toUpperCase() })} placeholder="A" />
              <CampoSelect label="Modo PAC" value={form.fiscal_pac_modo} onChange={v => setForm({ ...form, fiscal_pac_modo: v })}
                opciones={[
                  { v: 'sandbox',    l: 'Sandbox (pruebas, no genera CFDI real)' },
                  { v: 'produccion', l: 'Producción (factura real ante SAT)' },
                ]} />
            </div>
            <div style={{ background: '#fef3c7', padding: 10, borderRadius: 6, fontSize: 12, color: '#92400e', marginTop: 8 }}>
              💡 Empieza en <strong>sandbox</strong>. Cuando todo funcione bien, cambias a producción y subes tus sellos digitales en el portal de Facturama.
            </div>
          </div>
        )}

        {tab === 'cartaporte' && (
          <div>
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
              Información del permiso SCT y seguros requeridos por SAT para Carta Porte 3.0 (obligatorio para transporte federal desde 2024).
            </p>
            <div className="form-row">
              <CampoSelect label="Tipo de transporte" value={form.cartaporte_tipo_transporte} onChange={v => setForm({ ...form, cartaporte_tipo_transporte: v })}
                opciones={[
                  { v: '01', l: '01 — Autotransporte Federal' },
                  { v: '02', l: '02 — Transporte Marítimo' },
                  { v: '03', l: '03 — Transporte Aéreo' },
                  { v: '04', l: '04 — Transporte Ferroviario' },
                ]} />
              <Campo label="Permiso SCT (clave)" value={form.cartaporte_permiso_sct} onChange={v => setForm({ ...form, cartaporte_permiso_sct: v })} placeholder="TPAF01" />
            </div>
            <Campo label="Número de permiso SCT" value={form.cartaporte_num_permiso_sct} onChange={v => setForm({ ...form, cartaporte_num_permiso_sct: v })} placeholder="(ej. 0123456)" />
            <div className="form-row">
              <Campo label="Aseguradora Resp. Civil" value={form.cartaporte_seguro_resp_civil_aseguradora} onChange={v => setForm({ ...form, cartaporte_seguro_resp_civil_aseguradora: v })} />
              <Campo label="Póliza Resp. Civil" value={form.cartaporte_seguro_resp_civil_poliza} onChange={v => setForm({ ...form, cartaporte_seguro_resp_civil_poliza: v })} />
            </div>
          </div>
        )}

        {tab === 'auto' && (
          <div>
            <div className="form-group">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={form.cfdi_auto_emitir === 'true'}
                  onChange={e => setForm({ ...form, cfdi_auto_emitir: e.target.checked ? 'true' : 'false' })} />
                <strong>Auto-emitir CFDI</strong> cuando un viaje pase a estado "Completado"
              </label>
              <small style={{ color: '#6b7280', fontSize: 11 }}>
                Si está activo y el cliente tiene RFC + razón social, el sistema emite CFDI automáticamente.
              </small>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" checked={form.cfdi_auto_enviar_cliente === 'true'}
                  onChange={e => setForm({ ...form, cfdi_auto_enviar_cliente: e.target.checked ? 'true' : 'false' })} />
                <strong>Auto-enviar al cliente</strong> al emitir
              </label>
              <small style={{ color: '#6b7280', fontSize: 11 }}>
                Envía email + WhatsApp con XML + PDF apenas se certifica.
              </small>
            </div>
            <CampoSelect label="Canales de envío al cliente" value={form.cfdi_canales_envio} onChange={v => setForm({ ...form, cfdi_canales_envio: v })}
              opciones={[
                { v: 'email',           l: 'Solo Email (más universal)' },
                { v: 'whatsapp',        l: 'Solo WhatsApp' },
                { v: 'email,whatsapp',  l: 'Email + WhatsApp (ambos)' },
              ]} />
            <div className="form-row">
              <CampoSelect label="Forma de pago default" value={form.fiscal_forma_pago_default} onChange={v => setForm({ ...form, fiscal_forma_pago_default: v })}
                opciones={[
                  { v: '99', l: '99 — Por definir' },
                  { v: '01', l: '01 — Efectivo' },
                  { v: '03', l: '03 — Transferencia electrónica' },
                  { v: '04', l: '04 — Tarjeta de crédito' },
                  { v: '02', l: '02 — Cheque nominativo' },
                ]} />
              <CampoSelect label="Método de pago default" value={form.fiscal_metodo_pago_default} onChange={v => setForm({ ...form, fiscal_metodo_pago_default: v })}
                opciones={[
                  { v: 'PUE', l: 'PUE — Pago en una sola exhibición' },
                  { v: 'PPD', l: 'PPD — Pago en parcialidades / diferido' },
                ]} />
            </div>
          </div>
        )}

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginTop: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function Campo({ label, value, onChange, placeholder }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function CampoSelect({ label, value, onChange, opciones }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— Selecciona —</option>
        {opciones.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
