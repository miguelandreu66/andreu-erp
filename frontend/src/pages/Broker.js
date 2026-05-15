import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

const TIPOS_CARGA = ['general','refrigerada','peligrosa','fragil','liquidos','otro'];
const TIPOS_UNIDAD = ['plataforma_48','caja_seca','thermo','pipa','tolva','cama_baja','doble_caja'];
const ZONAS = ['morelos','cdmx','edomex','guerrero','puebla','oaxaca','jalisco','nuevo_leon','baja_california','nacional','frontera_norte','frontera_sur'];

const TIPOS_DOC = [
  { clave: 'constancia_fiscal',     label: 'Constancia de situación fiscal',  critico: true },
  { clave: 'permiso_sct',           label: 'Permiso SCT/SICT',                critico: true },
  { clave: 'poliza_seguro',         label: 'Póliza de seguro de carga',       critico: true },
  { clave: 'poliza_seguro_unidad',  label: 'Seguro de unidades',              critico: false },
  { clave: 'ine_representante',     label: 'INE del representante legal',     critico: true },
  { clave: 'contrato_servicios',    label: 'Contrato de servicios firmado',   critico: true },
  { clave: 'acta_constitutiva',     label: 'Acta constitutiva',               critico: false },
  { clave: 'comprobante_domicilio', label: 'Comprobante de domicilio fiscal', critico: false },
  { clave: 'opinion_cumplimiento',  label: 'Opinión de cumplimiento SAT 32-D', critico: false },
  { clave: 'referencias_comerciales', label: 'Referencias comerciales',       critico: false },
  { clave: 'otro',                  label: 'Otro',                            critico: false },
];

const ESTADOS_VERIF = {
  pendiente:    { label: 'Pendiente',    color: '#9ca3af', bg: '#f3f4f6', emoji: '⏳' },
  en_revision:  { label: 'En revisión',  color: '#d97706', bg: '#fef3c7', emoji: '🔎' },
  verificado:   { label: 'Verificado',   color: '#16a34a', bg: '#dcfce7', emoji: '✅' },
  rechazado:    { label: 'Rechazado',    color: '#991b1b', bg: '#fee2e2', emoji: '❌' },
  suspendido:   { label: 'Suspendido',   color: '#6b7280', bg: '#e5e7eb', emoji: '⏸️' },
};

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
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [docsDe, setDocsDe] = useState(null);   // transportista cuyo modal de docs está abierto

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [t, l, r] = await Promise.all([
        api.transportistasExternos('?incluir_inactivos=true'),
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

  // Conteos por estado
  const conteos = transportistas.reduce((acc, t) => {
    acc[t.estado_verificacion || 'pendiente'] = (acc[t.estado_verificacion || 'pendiente'] || 0) + 1;
    return acc;
  }, {});
  const transportistasFiltrados = filtroEstado === 'todos'
    ? transportistas
    : transportistas.filter(t => t.estado_verificacion === filtroEstado);

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🤝 Broker — Red de transportistas</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Conecta clientes con transportistas externos cuando tu flota no puede operar. Andreu se queda con comisión.
            <strong style={{ color: '#1B3A6B' }}> Solo verificados pueden recibir leads.</strong>
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
          {/* Filtros por estado */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>FILTRAR:</span>
            <FiltroChip label={`Todos (${transportistas.length})`} activo={filtroEstado === 'todos'} onClick={() => setFiltroEstado('todos')} />
            {Object.entries(ESTADOS_VERIF).map(([k, e]) => (
              <FiltroChip
                key={k}
                label={`${e.emoji} ${e.label} (${conteos[k] || 0})`}
                activo={filtroEstado === k}
                onClick={() => setFiltroEstado(k)}
                color={e.color}
              />
            ))}
            <div style={{ marginLeft: 'auto' }}>
              {esDirector && (
                <button onClick={() => setCreando(true)} className="btn btn-primary">
                  ➕ Agregar transportista
                </button>
              )}
            </div>
          </div>

          {loading ? <div className="empty">Cargando...</div> : transportistasFiltrados.length === 0 ? (
            filtroEstado === 'todos' ? (
              <EmptyState
                icono="🤝"
                titulo="Aún no tienes transportistas en tu red"
                texto="Da de alta empresas de transporte que mueven carga que tú no operas (refrigeración, peligrosos, doble remolque). Antes de poder asignarles leads tendrás que verificar sus documentos (RFC, Permiso SCT, Póliza de seguro, INE del representante, Contrato)."
              />
            ) : (
              <EmptyState icono="🔎" titulo={`Sin transportistas en estado "${ESTADOS_VERIF[filtroEstado]?.label || filtroEstado}"`} texto="Prueba otro filtro o agrega uno nuevo." />
            )
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {transportistasFiltrados.map(t => (
                <TranspCard
                  key={t.id}
                  t={t}
                  esDirector={esDirector}
                  onEditar={() => setEditando(t)}
                  onAbrirDocs={() => setDocsDe(t)}
                  onActualizar={cargar}
                />
              ))}
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
          onGuardado={(creado) => {
            setCreando(false);
            setEditando(null);
            cargar();
            // Si era nuevo, abrir directo el modal de docs para que suba archivos
            if (creado && !editando) setDocsDe(creado);
          }}
        />
      )}

      {docsDe && (
        <ModalDocumentos
          transportista={docsDe}
          esDirector={esDirector}
          onClose={() => setDocsDe(null)}
          onActualizar={cargar}
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

function FiltroChip({ label, activo, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
      background: activo ? (color || '#1A1A1A') : '#fff',
      color: activo ? '#fff' : '#374151',
      border: '1px solid ' + (activo ? (color || '#1A1A1A') : '#d1d5db'),
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

function BadgeVerificacion({ estado }) {
  const e = ESTADOS_VERIF[estado] || ESTADOS_VERIF.pendiente;
  return (
    <span style={{
      background: e.bg, color: e.color, padding: '3px 10px',
      borderRadius: 999, fontSize: 11, fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      {e.emoji} {e.label}
    </span>
  );
}

function TranspCard({ t, esDirector, onEditar, onAbrirDocs, onActualizar }) {
  const verificado = t.estado_verificacion === 'verificado';
  const bordeColor = verificado ? '#16a34a'
    : t.estado_verificacion === 'en_revision' ? '#d97706'
    : t.estado_verificacion === 'rechazado' ? '#991b1b'
    : t.estado_verificacion === 'suspendido' ? '#6b7280'
    : '#9ca3af';

  const cumple = t.cumple_para_verificacion;
  const docsVencidos = t.tiene_docs_vencidos_criticos;

  const verificar = async () => {
    try {
      await api.verificarTransportista(t.id);
      alert(`✅ ${t.razon_social} verificado. Ahora puede recibir leads.`);
      onActualizar();
    } catch (e) { alert(`⚠️ ${e.message}`); }
  };

  const rechazar = async () => {
    const motivo = prompt(`¿Por qué rechazas a "${t.razon_social}"?`);
    if (!motivo || motivo.trim().length < 5) return;
    try {
      await api.rechazarTransportista(t.id, motivo.trim());
      onActualizar();
    } catch (e) { alert(e.message); }
  };

  const suspender = async () => {
    const motivo = prompt(`Motivo de suspensión de "${t.razon_social}"`, 'Pausa temporal');
    if (motivo === null) return;
    try {
      await api.suspenderTransportista(t.id, motivo);
      onActualizar();
    } catch (e) { alert(e.message); }
  };

  const reactivar = async () => {
    if (!window.confirm(`¿Reactivar a "${t.razon_social}"? Pasará a "en revisión".`)) return;
    try {
      await api.reactivarTransportista(t.id);
      onActualizar();
    } catch (e) { alert(e.message); }
  };

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${bordeColor}`,
      borderRadius: 10, padding: 14,
      opacity: t.activo === false ? 0.65 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{t.razon_social}</strong>
            {t.nombre_comercial && <span style={{ fontSize: 12, color: '#6b7280' }}>({t.nombre_comercial})</span>}
            <BadgeVerificacion estado={t.estado_verificacion || 'pendiente'} />
            <span style={{ fontSize: 12, color: '#d97706', fontWeight: 600 }}>
              {'★'.repeat(Math.round(t.calificacion))}{'☆'.repeat(5 - Math.round(t.calificacion))}
            </span>
            {t.score_automatico > 0 && (
              <span style={{ fontSize: 11, color: '#6b7280' }}>
                score IA: <strong>{Math.round(t.score_automatico)}</strong>
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {t.contacto_nombre && <>👤 {t.contacto_nombre}</>}
            {t.telefono && <> · 📞 {t.telefono}</>}
            {t.email && <> · ✉️ {t.email}</>}
            {t.rfc && <> · RFC {t.rfc}</>}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(t.tipos_carga || []).map(tc => (
              <span key={tc} style={{ background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: 999, fontSize: 11 }}>
                {tc}
              </span>
            ))}
          </div>

          {/* Checklist mini */}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
            <CheckMini ok={t.tiene_constancia_fiscal}  label="Constancia fiscal" />
            <CheckMini ok={t.permiso_sct_vigente}      label="Permiso SCT" critico />
            <CheckMini ok={t.poliza_seguro_vigente}    label="Póliza seguro" critico />
            <CheckMini ok={t.tiene_ine_representante}  label="INE rep." />
            <CheckMini ok={t.tiene_contrato}           label="Contrato" />
          </div>

          {docsVencidos && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#991b1b', background: '#fee2e2', padding: '6px 10px', borderRadius: 6 }}>
              ⚠️ Tiene documentos críticos vencidos — no se puede asignar leads
            </div>
          )}
          {t.motivo_rechazo && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b', fontStyle: 'italic' }}>
              Motivo: {t.motivo_rechazo}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right', minWidth: 150 }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>COMISIÓN ANDREU</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#E87722' }}>{t.comision_pct_acordada}%</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            {t.viajes_mes || 0} viaje(s) mes · {fmt$(t.comision_mes || 0)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            <button onClick={onAbrirDocs} className="btn btn-ghost btn-sm">📎 Documentos</button>
            <button onClick={onEditar} className="btn btn-ghost btn-sm">Editar</button>

            {esDirector && t.estado_verificacion !== 'verificado' && cumple && !docsVencidos && (
              <button onClick={verificar} className="btn btn-sm" style={{ background: '#16a34a', color: '#fff' }}>
                ✅ Verificar
              </button>
            )}
            {esDirector && t.estado_verificacion !== 'verificado' && (!cumple || docsVencidos) && (
              <button disabled className="btn btn-sm" title="Sube documentos críticos primero"
                style={{ background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' }}>
                ✅ Verificar (faltan docs)
              </button>
            )}
            {esDirector && t.estado_verificacion === 'verificado' && (
              <button onClick={suspender} className="btn btn-sm" style={{ background: '#fbbf24', color: '#7c2d12' }}>
                ⏸️ Suspender
              </button>
            )}
            {esDirector && ['pendiente','en_revision'].includes(t.estado_verificacion) && (
              <button onClick={rechazar} className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }}>
                ❌ Rechazar
              </button>
            )}
            {esDirector && ['rechazado','suspendido'].includes(t.estado_verificacion) && (
              <button onClick={reactivar} className="btn btn-sm" style={{ background: '#dbeafe', color: '#1e3a8a' }}>
                🔄 Reactivar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckMini({ ok, label, critico }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      color: ok ? '#16a34a' : (critico ? '#991b1b' : '#9ca3af'),
      fontWeight: ok ? 600 : 400,
    }}>
      {ok ? '✓' : (critico ? '✗' : '○')} {label}
    </span>
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

  // SOLO permite seleccionar verificados
  const elegibles = transportistas.filter(t => t.activo && t.estado_verificacion === 'verificado' && !t.tiene_docs_vencidos_criticos);
  const noVerificados = transportistas.filter(t => t.activo && t.estado_verificacion !== 'verificado').length;

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

        {elegibles.length === 0 && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: 12, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            <strong>⚠️ Sin transportistas verificados.</strong> {noVerificados > 0
              ? `Hay ${noVerificados} pendiente(s) de verificación. Sube documentos y verifica antes de poder asignar.`
              : 'Da de alta y verifica al menos un transportista antes de poder asignar leads.'}
          </div>
        )}

        {sugerencias && sugerencias.sugerencias.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 600 }}>🤖 Sugerencias IA (sólo verificados):</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sugerencias.sugerencias.map(s => (
                <button key={s.id} onClick={() => setSeleccionado(s.id)}
                  style={{
                    padding: '6px 12px', fontSize: 12, borderRadius: 999, cursor: 'pointer',
                    background: parseInt(seleccionado) === s.id ? '#1A1A1A' : '#fff',
                    color: parseInt(seleccionado) === s.id ? '#fff' : '#374151',
                    border: '1px solid #d1d5db',
                  }}>
                  ✅ {s.razon_social} ★{Math.round(s.calificacion)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Transportista (solo verificados)</label>
          <select value={seleccionado} onChange={e => setSeleccionado(e.target.value)} disabled={elegibles.length === 0}>
            <option value="">— Selecciona —</option>
            {elegibles.map(t => (
              <option key={t.id} value={t.id}>
                ✅ {t.razon_social} ({t.tipos_carga?.join(', ') || 'sin tipos'})
              </option>
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
          <button onClick={asignar} disabled={guardando || elegibles.length === 0} className="btn btn-primary">
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
      let creado;
      if (transportista?.id) {
        creado = await api.actualizarTransportista(transportista.id, form);
      } else {
        creado = await api.crearTransportista(form);
      }
      onGuardado(creado);
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
        <h2 style={{ margin: '0 0 4px' }}>{transportista ? 'Editar transportista' : '➕ Nuevo transportista'}</h2>
        {!transportista && (
          <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13 }}>
            Después de crearlo tendrás que subir documentos (RFC, Permiso SCT, Póliza, INE, Contrato) y verificarlo antes de poder asignarle leads.
          </p>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Razón social *</label>
            <input type="text" value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Nombre comercial</label>
            <input type="text" value={form.nombre_comercial || ''} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">RFC</label>
            <input type="text" value={form.rfc || ''} onChange={e => setForm({ ...form, rfc: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Contacto principal</label>
            <input type="text" value={form.contacto_nombre || ''} onChange={e => setForm({ ...form, contacto_nombre: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Teléfono</label>
            <input type="tel" value={form.telefono || ''} onChange={e => setForm({ ...form, telefono: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input type="email" value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} />
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
            {guardando ? 'Guardando...' : (transportista ? 'Guardar cambios' : 'Guardar y subir documentos')}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalDocumentos({ transportista, esDirector, onClose, onActualizar }) {
  const [docs, setDocs] = useState([]);
  const [checklist, setChecklist] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [tipoSel, setTipoSel] = useState('constancia_fiscal');
  const [vigenciaFin, setVigenciaFin] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [d, c] = await Promise.all([
        api.transportistaDocs(transportista.id),
        api.checklistTransportista(transportista.id),
      ]);
      setDocs(d || []);
      setChecklist(c);
    } catch (e) { setError(e.message); }
    finally { setCargando(false); }
  }, [transportista.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const subir = async () => {
    if (!archivo) { setError('Selecciona un archivo'); return; }
    setSubiendo(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('tipo', tipoSel);
      fd.append('nombre', archivo.name);
      if (vigenciaFin) fd.append('vigencia_fin', vigenciaFin);
      await api.subirTransportistaDoc(transportista.id, fd);
      setArchivo(null);
      setVigenciaFin('');
      await cargar();
      onActualizar();
    } catch (e) { setError(e.message); } finally { setSubiendo(false); }
  };

  const eliminar = async (id) => {
    if (!window.confirm('¿Eliminar este documento?')) return;
    try {
      await api.eliminarTransportistaDoc(id);
      await cargar();
      onActualizar();
    } catch (e) { alert(e.message); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 800, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>📎 Documentos — {transportista.razon_social}</h2>
            <div style={{ marginTop: 4 }}>
              <BadgeVerificacion estado={transportista.estado_verificacion || 'pendiente'} />
            </div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        {/* Checklist */}
        {checklist && (
          <div style={{
            background: checklist.cumple_para_verificacion ? '#dcfce7' : '#fef3c7',
            padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13,
          }}>
            <strong>Checklist de verificación:</strong>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 }}>
              {checklist.requisitos.map(r => (
                <div key={r.clave} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: r.cumple ? '#16a34a' : '#991b1b', fontWeight: 700 }}>
                    {r.cumple ? '✓' : '✗'}
                  </span>
                  <span style={{ color: r.cumple ? '#166534' : '#7c2d12' }}>{r.label}</span>
                </div>
              ))}
            </div>
            {checklist.tiene_docs_vencidos_criticos && (
              <div style={{ marginTop: 8, color: '#991b1b' }}>
                ⚠️ Tiene docs críticos vencidos. Renueva para poder verificar.
              </div>
            )}
            {checklist.cumple_para_verificacion && transportista.estado_verificacion !== 'verificado' && esDirector && (
              <button onClick={async () => {
                try { await api.verificarTransportista(transportista.id); alert('✅ Verificado'); onActualizar(); onClose(); }
                catch (e) { alert(e.message); }
              }} style={{ marginTop: 10, background: '#16a34a', color: '#fff' }} className="btn btn-sm">
                ✅ Verificar ahora
              </button>
            )}
          </div>
        )}

        {/* Form subir */}
        {esDirector && (
          <div style={{ background: '#f9fafb', padding: 14, borderRadius: 8, marginBottom: 14 }}>
            <strong style={{ fontSize: 13 }}>Subir documento</strong>
            <div className="form-row" style={{ marginTop: 8 }}>
              <div className="form-group">
                <label className="form-label">Tipo</label>
                <select value={tipoSel} onChange={e => setTipoSel(e.target.value)}>
                  {TIPOS_DOC.map(t => (
                    <option key={t.clave} value={t.clave}>
                      {t.critico ? '★ ' : ''}{t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Vigencia hasta (opcional)</label>
                <input type="date" value={vigenciaFin} onChange={e => setVigenciaFin(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Archivo (PDF, imagen, máx 10 MB)</label>
              <input type="file" accept=".pdf,image/*" onChange={e => setArchivo(e.target.files?.[0] || null)} />
            </div>
            <button onClick={subir} disabled={subiendo || !archivo} className="btn btn-primary btn-sm">
              {subiendo ? 'Subiendo...' : '⬆️ Subir'}
            </button>
          </div>
        )}

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        {/* Listado */}
        {cargando ? <div className="empty">Cargando documentos...</div> : docs.length === 0 ? (
          <div className="empty" style={{ textAlign: 'center', padding: 20, color: '#6b7280' }}>
            Sin documentos todavía. Sube los críticos (constancia fiscal, permiso SCT, póliza, INE, contrato) para poder verificar.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {docs.map(d => {
              const cfg = TIPOS_DOC.find(x => x.clave === d.tipo);
              const estilo = d.estado_vigencia === 'vencido'
                ? { color: '#991b1b', bg: '#fee2e2', icono: '⛔' }
                : d.estado_vigencia === 'por_vencer'
                ? { color: '#d97706', bg: '#fef3c7', icono: '⚠️' }
                : d.estado_vigencia === 'vigente'
                ? { color: '#16a34a', bg: '#dcfce7', icono: '✓' }
                : { color: '#6b7280', bg: '#f3f4f6', icono: '·' };
              return (
                <div key={d.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 10,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {cfg?.critico && <span style={{ color: '#E87722' }}>★ </span>}
                      {cfg?.label || d.tipo}
                    </div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {d.nombre} · {(d.tamano_bytes / 1024).toFixed(0)} KB
                      {d.vigencia_fin && <> · vence {d.vigencia_fin.split('T')[0]} ({d.dias_restantes}d)</>}
                    </div>
                  </div>
                  <span style={{ background: estilo.bg, color: estilo.color, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    {estilo.icono} {d.estado_vigencia.replace('_', ' ')}
                  </span>
                  <a href={api.transportistaDocArchivoUrl(d.id)} target="_blank" rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm">👁️</a>
                  {esDirector && (
                    <button onClick={() => eliminar(d.id)} className="btn btn-ghost btn-sm" style={{ color: '#991b1b' }}>🗑️</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
