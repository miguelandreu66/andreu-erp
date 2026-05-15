import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

const TIPOS_CARGA = ['general','refrigerada','peligrosa','fragil','liquidos','otro'];
const TIPOS_UNIDAD = ['plataforma_48','caja_seca','thermo','pipa','tolva','cama_baja','doble_caja'];
const ZONAS = ['morelos','cdmx','edomex','guerrero','puebla','oaxaca','jalisco','nuevo_leon','baja_california','nacional','frontera_norte','frontera_sur'];

export default function Broker() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';

  const [tab, setTab] = useState('red');
  const [transportistas, setTransportistas] = useState([]);
  const [leadsBroker, setLeadsBroker] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [t, l, r] = await Promise.all([
        api.transportistasExternos(),
        api.leads('?limit=200').catch(() => ({ leads: [] })),
        api.brokerResumen().catch(() => null),
      ]);
      setTransportistas(t || []);
      setLeadsBroker((l.leads || []).filter(x => x.tipo_operacion === 'broker'));
      setResumen(r);
    } catch (e) {
      setMsg({ tipo: 'red', txt: e.message });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🤝 Broker — Red de transportistas</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Conecta clientes con transportistas externos cuando tu flota no puede operar. Andreu se queda con comisión.
          </p>
        </div>
      </div>

      {msg && <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{msg.txt}</div></div>}

      {resumen?.stats && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          <Stat label="Leads broker total" value={resumen.stats.leads_broker_total} color="#1B3A6B" />
          <Stat label="Leads broker ganados" value={resumen.stats.leads_broker_ganados} color="#16a34a" />
          <Stat label="Comisiones acumuladas" value={fmt$(resumen.stats.comisiones_total)} color="#E87722" />
          <Stat label="Comisión del mes" value={fmt$(resumen.stats.comisiones_mes)} color="#16a34a" />
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        {[
          { id: 'red', l: '🚚 Red de transportistas', count: transportistas.length },
          { id: 'cartera', l: '💼 Cartera broker', count: leadsBroker.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#1A1A1A' : 'transparent',
              color: tab === t.id ? '#fff' : '#1A1A1A',
              fontWeight: tab === t.id ? 700 : 500,
              borderRadius: '8px 8px 0 0',
            }}>{t.l} ({t.count})</button>
        ))}
      </div>

      {tab === 'red' && (
        <div>
          {esDirector && (
            <button onClick={() => setCreando(true)} className="btn btn-primary" style={{ marginBottom: 12 }}>
              ➕ Agregar transportista a la red
            </button>
          )}
          {loading ? <div className="empty">Cargando...</div> : transportistas.length === 0 ? (
            <EmptyState
              icono="🤝"
              titulo="Aún no tienes transportistas en tu red"
              texto="Da de alta empresas de transporte que mueven carga que tú no operas (refrigeración, peligrosos, doble remolque). Cuando llegue un lead para esos tipos, conectas al cliente y ganas comisión."
            />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {transportistas.map(t => <TranspCard key={t.id} t={t} onEditar={() => setEditando(t)} />)}
            </div>
          )}
        </div>
      )}

      {tab === 'cartera' && (
        <CarteraBroker leads={leadsBroker} transportistas={transportistas}
          onActualizar={cargar} esDirector={esDirector} />
      )}

      {(creando || editando) && (
        <ModalTransportista
          transportista={editando}
          onClose={() => { setCreando(false); setEditando(null); }}
          onGuardado={() => { setCreando(false); setEditando(null); cargar(); }}
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

function EmptyState({ icono, titulo, texto }) {
  return (
    <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>{icono}</div>
      <h3 style={{ margin: '0 0 6px', color: '#374151' }}>{titulo}</h3>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}>{texto}</p>
    </div>
  );
}

function TranspCard({ t, onEditar }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${t.activo ? '#16a34a' : '#9ca3af'}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{t.razon_social}</strong>
            {t.nombre_comercial && <span style={{ fontSize: 12, color: '#6b7280' }}>({t.nombre_comercial})</span>}
            <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>
              {'★'.repeat(Math.round(t.calificacion))}{'☆'.repeat(5 - Math.round(t.calificacion))}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {t.contacto_nombre && <>👤 {t.contacto_nombre}</>}
            {t.telefono && <> · 📞 {t.telefono}</>}
            {t.email && <> · ✉️ {t.email}</>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(t.tipos_carga || []).map(tc => (
              <span key={tc} style={{ background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>
                {tc}
              </span>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 130 }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>COMISIÓN ANDREU</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#E87722' }}>{t.comision_pct_acordada}%</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            {t.viajes_mes || 0} viaje(s) mes · {fmt$(t.comision_mes || 0)}
          </div>
          <button onClick={onEditar} className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>Editar</button>
        </div>
      </div>
    </div>
  );
}

function CarteraBroker({ leads, transportistas, onActualizar, esDirector }) {
  const [asignando, setAsignando] = useState(null);

  if (leads.length === 0) {
    return (
      <EmptyState
        icono="💼"
        titulo="Sin leads broker todavía"
        texto={`Cuando un cliente pida un servicio que Andreu no opera (refrigeración, peligrosos, etc.) en /cotizar, el sistema lo marcará automáticamente como broker y aparecerá aquí para que asignes transportista.`}
      />
    );
  }

  return (
    <div>
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th style={th}>Folio</th>
              <th style={th}>Cliente</th>
              <th style={th}>Ruta</th>
              <th style={th}>Carga</th>
              <th style={{ ...th, textAlign: 'right' }}>Cobra a cliente</th>
              <th style={{ ...th, textAlign: 'right' }}>Paga a transportista</th>
              <th style={{ ...th, textAlign: 'right' }}>Comisión</th>
              <th style={th}>Transportista</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(l => (
              <tr key={l.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}><strong>{l.folio}</strong></td>
                <td style={td}>
                  <div>{l.contacto_nombre}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{l.empresa}</div>
                </td>
                <td style={td}>{l.origen} → {l.destino}</td>
                <td style={td}>{l.tipo_carga}{l.toneladas ? ` · ${l.toneladas}t` : ''}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(l.precio_final)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {l.precio_transportista ? fmt$(l.precio_transportista) : <span style={{ color: '#9ca3af' }}>Pendiente</span>}
                </td>
                <td style={{ ...td, textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                  {l.comision_andreu != null ? fmt$(l.comision_andreu) : '—'}
                </td>
                <td style={td}>
                  {l.transportista_externo_id
                    ? transportistas.find(t => t.id === l.transportista_externo_id)?.razon_social || '—'
                    : esDirector
                      ? <button onClick={() => setAsignando(l)} className="btn btn-ghost btn-sm">Asignar</button>
                      : <span style={{ color: '#9ca3af' }}>Sin asignar</span>}
                </td>
                <td style={td}>{l.estado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {asignando && (
        <ModalAsignarTransportista
          lead={asignando}
          transportistas={transportistas}
          onClose={() => setAsignando(null)}
          onAsignado={() => { setAsignando(null); onActualizar(); }}
        />
      )}
    </div>
  );
}

function ModalAsignarTransportista({ lead, transportistas, onClose, onAsignado }) {
  const [sugerencias, setSugerencias] = useState(null);
  const [seleccionado, setSeleccionado] = useState('');
  const [precioTransp, setPrecioTransp] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.sugerirTransportistas(lead.id).then(setSugerencias).catch(() => {});
  }, [lead.id]);

  const asignar = async () => {
    if (!seleccionado || !precioTransp) { setError('Selecciona transportista y captura precio'); return; }
    setGuardando(true); setError(null);
    try {
      const r = await api.asignarTransportistaLead(lead.id, {
        transportista_externo_id: parseInt(seleccionado),
        precio_transportista: parseFloat(precioTransp),
      });
      alert(`✅ Asignado. Comisión Andreu: ${fmt$(r.analisis.comision_andreu)} (${r.analisis.margen_broker_pct}%)`);
      onAsignado();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  const comisionPreview = seleccionado && precioTransp
    ? parseFloat(lead.precio_final) - parseFloat(precioTransp) : null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 600, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <h2 style={{ margin: '0 0 4px' }}>🤝 Asignar transportista</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          {lead.folio} · {lead.origen} → {lead.destino} · {lead.tipo_carga}
        </p>

        <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          <strong>Precio cliente:</strong> {fmt$(lead.precio_final)} <span style={{ color: '#6b7280' }}>(esto cobras tú)</span>
        </div>

        {sugerencias && sugerencias.sugerencias.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 600 }}>🤖 Sugerencias IA (mejor scoring):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sugerencias.sugerencias.map(s => (
                <button key={s.id} onClick={() => setSeleccionado(s.id)}
                  style={{
                    padding: '6px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                    background: parseInt(seleccionado) === s.id ? '#1A1A1A' : '#fff',
                    color: parseInt(seleccionado) === s.id ? '#fff' : '#374151',
                    border: '1px solid #d1d5db',
                  }}>
                  {s.razon_social} ★{Math.round(s.calificacion)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Transportista</label>
          <select value={seleccionado} onChange={e => setSeleccionado(e.target.value)}>
            <option value="">— Selecciona —</option>
            {transportistas.filter(t => t.activo).map(t => (
              <option key={t.id} value={t.id}>{t.razon_social} ({t.tipos_carga?.join(', ') || 'sin tipos'})</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Precio acordado con transportista ($MXN)</label>
          <input type="number" value={precioTransp} onChange={e => setPrecioTransp(e.target.value)}
            placeholder={`Menor a ${fmt$(lead.precio_final)} para ganar comisión`} />
        </div>

        {comisionPreview != null && (
          <div style={{
            padding: 14, borderRadius: 8, marginBottom: 12,
            background: comisionPreview > 0 ? '#dcfce7' : '#fee2e2',
            color: comisionPreview > 0 ? '#166534' : '#991b1b',
          }}>
            <strong>Comisión Andreu: {fmt$(comisionPreview)}</strong>
            {comisionPreview > 0
              ? ` (${((comisionPreview / parseFloat(lead.precio_final)) * 100).toFixed(1)}% del precio cliente)`
              : ' ⚠️ Estás pagando más al transportista que lo que cobras al cliente'}
          </div>
        )}

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={asignar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Asignar'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalTransportista({ transportista, onClose, onGuardado }) {
  const [form, setForm] = useState(transportista || {
    razon_social: '', nombre_comercial: '', rfc: '',
    contacto_nombre: '', telefono: '', email: '',
    tipos_carga: [], tipos_unidad: [], zonas_cobertura: [],
    comision_pct_acordada: 15, condiciones_pago: '', notas: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const toggle = (campo, valor) => {
    setForm(f => ({
      ...f,
      [campo]: f[campo]?.includes(valor) ? f[campo].filter(x => x !== valor) : [...(f[campo] || []), valor],
    }));
  };

  const guardar = async () => {
    if (!form.razon_social?.trim()) { setError('Razón social obligatoria'); return; }
    setGuardando(true); setError(null);
    try {
      if (transportista?.id) {
        await api.actualizarTransportista(transportista.id, form);
      } else {
        await api.crearTransportista(form);
      }
      onGuardado();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 700, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <h2 style={{ margin: '0 0 14px' }}>{transportista ? 'Editar transportista' : '➕ Nuevo transportista'}</h2>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Razón social *</label>
            <input type="text" value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Nombre comercial</label>
            <input type="text" value={form.nombre_comercial} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">RFC</label>
            <input type="text" value={form.rfc} onChange={e => setForm({ ...form, rfc: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Contacto principal</label>
            <input type="text" value={form.contacto_nombre} onChange={e => setForm({ ...form, contacto_nombre: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Teléfono</label>
            <input type="tel" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Tipos de carga que mueve</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TIPOS_CARGA.map(t => (
              <Chip key={t} label={t} activo={form.tipos_carga?.includes(t)} onClick={() => toggle('tipos_carga', t)} />
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Tipos de unidad disponibles</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {TIPOS_UNIDAD.map(t => (
              <Chip key={t} label={t} activo={form.tipos_unidad?.includes(t)} onClick={() => toggle('tipos_unidad', t)} />
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Zonas de cobertura</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ZONAS.map(z => (
              <Chip key={z} label={z} activo={form.zonas_cobertura?.includes(z)} onClick={() => toggle('zonas_cobertura', z)} />
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">% Comisión Andreu (markup)</label>
            <input type="number" step="0.5" value={form.comision_pct_acordada}
              onChange={e => setForm({ ...form, comision_pct_acordada: parseFloat(e.target.value) })} />
          </div>
          <div className="form-group">
            <label className="form-label">Condiciones de pago</label>
            <input type="text" placeholder="contra entrega / 15 días" value={form.condiciones_pago || ''}
              onChange={e => setForm({ ...form, condiciones_pago: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Notas</label>
          <textarea rows={2} value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} />
        </div>

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

function Chip({ label, activo, onClick }) {
  return (
    <button onClick={onClick} type="button" style={{
      padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
      background: activo ? '#1B3A6B' : '#fff',
      color: activo ? '#fff' : '#374151',
      border: '1px solid ' + (activo ? '#1B3A6B' : '#d1d5db'),
      fontWeight: activo ? 600 : 400,
    }}>{label}</button>
  );
}

const th = { padding: '10px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left', fontWeight: 700 };
const td = { padding: '10px 12px' };
