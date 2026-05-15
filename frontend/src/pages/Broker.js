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

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'red',      l: '🚚 Red de transportistas', count: transportistas.length },
          { id: 'cartera',  l: '💼 Cartera broker',         count: leadsBroker.length },
          { id: 'finanzas', l: '💸 Finanzas & Riesgos',     count: null },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#1A1A1A' : 'transparent',
              color: tab === t.id ? '#fff' : '#1A1A1A',
              fontWeight: tab === t.id ? 700 : 500,
              borderRadius: '8px 8px 0 0',
            }}>{t.l}{t.count != null ? ` (${t.count})` : ''}</button>
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

      {tab === 'finanzas' && (
        <FinanzasBroker esDirector={esDirector} transportistas={transportistas} leadsBroker={leadsBroker} />
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

// ════════════════════════════════════════════════════════════════
// FINANZAS & RIESGOS BROKER (Fase 14)
// ════════════════════════════════════════════════════════════════
function FinanzasBroker({ esDirector, transportistas, leadsBroker }) {
  const [data, setData] = useState(null);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState('resumen');
  const [creandoPago, setCreandoPago] = useState(false);
  const [cobroLead, setCobroLead] = useState(null);
  const [configurando, setConfigurando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([
        api.brokerDashboard(),
        api.brokerPagos('?limit=200'),
      ]);
      setData(d);
      setPagos(p || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  if (loading) return <div className="empty">Cargando finanzas...</div>;
  if (error) return <div className="alert red">⚠️ {error}</div>;
  if (!data) return null;

  const exp = data.exposicion || {};
  const totalAlertas = data.alertas?.length || 0;
  const criticas = data.alertas?.filter(a => a.severidad === 'critica').length || 0;

  return (
    <div>
      {/* Alertas críticas arriba */}
      {totalAlertas > 0 && (
        <div style={{ marginBottom: 16 }}>
          {data.alertas.map((a, i) => (
            <div key={i} style={{
              background: a.severidad === 'critica' ? '#fee2e2' : '#fef3c7',
              borderLeft: `4px solid ${a.severidad === 'critica' ? '#991b1b' : '#d97706'}`,
              padding: '10px 14px', borderRadius: 6, marginBottom: 8, fontSize: 13,
              color: a.severidad === 'critica' ? '#991b1b' : '#7c2d12',
            }}>
              <strong>{a.severidad === 'critica' ? '🚨 CRÍTICO' : '⚠️ ALERTA'}</strong> · {a.mensaje}
            </div>
          ))}
        </div>
      )}

      {/* Cards de exposición */}
      <div className="metric-grid" style={{ marginBottom: 18 }}>
        <Stat label="💰 Te falta cobrar (clientes)"
              value={fmt$(exp.pendiente_cobrar_cliente)}
              color="#16a34a" />
        <Stat label="📤 Debes pagar (transportistas)"
              value={fmt$(exp.pendiente_pagar_transportista)}
              color="#E87722" />
        <Stat label={exp.exposicion_neta > 0 ? "⚠️ Exposición neta (riesgo)" : "✅ Cashflow positivo"}
              value={fmt$(Math.abs(exp.exposicion_neta || 0))}
              color={exp.exposicion_neta > 0 ? '#991b1b' : '#16a34a'} />
        <Stat label="🚨 Alertas activas"
              value={`${criticas} críticas / ${totalAlertas}`}
              color={criticas > 0 ? '#991b1b' : '#6b7280'} />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { id: 'resumen',       l: '📊 Resumen' },
          { id: 'pagos',         l: `📤 Pagos (${pagos.length})` },
          { id: 'cobros',        l: '💰 Cobros pendientes' },
          { id: 'concentracion', l: '⚖️ Concentración' },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            style={{
              padding: '6px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
              background: subTab === t.id ? '#1B3A6B' : '#fff',
              color: subTab === t.id ? '#fff' : '#1B3A6B',
              border: '1px solid #1B3A6B', fontWeight: subTab === t.id ? 700 : 500,
            }}>{t.l}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {esDirector && <button onClick={() => setConfigurando(true)} className="btn btn-ghost btn-sm">⚙️ Política</button>}
          {esDirector && <button onClick={() => setCreandoPago(true)} className="btn btn-primary btn-sm">➕ Programar pago</button>}
        </div>
      </div>

      {subTab === 'resumen' && (
        <ResumenFinanzas data={data} />
      )}
      {subTab === 'pagos' && (
        <TablaPagos pagos={pagos} esDirector={esDirector} onActualizar={cargar} />
      )}
      {subTab === 'cobros' && (
        <TablaCobros leadsBroker={leadsBroker} esDirector={esDirector}
          onRegistrar={setCobroLead} />
      )}
      {subTab === 'concentracion' && (
        <ConcentracionView data={data} />
      )}

      {creandoPago && (
        <ModalProgramarPago
          transportistas={transportistas.filter(t => t.estado_verificacion === 'verificado')}
          leadsBroker={leadsBroker}
          onClose={() => setCreandoPago(false)}
          onCreado={() => { setCreandoPago(false); cargar(); }}
        />
      )}
      {cobroLead && (
        <ModalRegistrarCobro
          lead={cobroLead}
          onClose={() => setCobroLead(null)}
          onRegistrado={() => { setCobroLead(null); cargar(); }}
        />
      )}
      {configurando && (
        <ModalConfigBroker
          actual={{ politica_pago: data.politica_pago, ...data.umbrales }}
          onClose={() => setConfigurando(false)}
          onGuardado={() => { setConfigurando(false); cargar(); }}
        />
      )}
    </div>
  );
}

function ResumenFinanzas({ data }) {
  const exp = data.exposicion || {};
  const politicaLabel = {
    esperar_cobro_cliente: 'Esperar cobro del cliente antes de pagar',
    adelantar_con_factura: 'Adelantar pago si transportista facturó',
    adelantar_libre:       'Adelantar pago libremente',
  }[data.politica_pago] || data.politica_pago;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 10px' }}>💼 Operaciones activas</h4>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#1B3A6B' }}>{exp.operaciones_activas || 0}</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>
          Total a facturar: <strong>{fmt$(exp.total_facturar_cliente)}</strong><br/>
          Ya cobrado: <strong style={{ color: '#16a34a' }}>{fmt$(exp.total_cobrado_cliente)}</strong><br/>
          Pendiente: <strong style={{ color: '#d97706' }}>{fmt$(exp.pendiente_cobrar_cliente)}</strong>
        </div>
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 10px' }}>🚚 Pagos a transportistas</h4>
        <div style={{ fontSize: 13, color: '#6b7280' }}>
          Total acordado: <strong>{fmt$(exp.total_pagar_transportista)}</strong><br/>
          Ya pagado: <strong style={{ color: '#16a34a' }}>{fmt$(exp.total_pagado_transportista)}</strong><br/>
          Pendiente: <strong style={{ color: '#E87722' }}>{fmt$(exp.pendiente_pagar_transportista)}</strong>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280', borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
          Política actual: <strong>{politicaLabel}</strong>
        </div>
      </div>
      <div style={{ background: exp.exposicion_neta > 0 ? '#fee2e2' : '#dcfce7',
                    borderRadius: 10, padding: 16,
                    border: '1px solid ' + (exp.exposicion_neta > 0 ? '#fecaca' : '#bbf7d0') }}>
        <h4 style={{ margin: '0 0 10px', color: exp.exposicion_neta > 0 ? '#991b1b' : '#166534' }}>
          {exp.exposicion_neta > 0 ? '⚠️ Exposición de cashflow' : '✅ Cashflow saludable'}
        </h4>
        <div style={{ fontSize: 28, fontWeight: 800, color: exp.exposicion_neta > 0 ? '#991b1b' : '#166534' }}>
          {fmt$(Math.abs(exp.exposicion_neta || 0))}
        </div>
        <div style={{ fontSize: 12, color: exp.exposicion_neta > 0 ? '#7c2d12' : '#15803d', marginTop: 6 }}>
          {exp.exposicion_neta > 0
            ? 'Lo que debes pagar > lo que te falta cobrar. Riesgo de quedarte sin caja.'
            : 'Lo que vas a cobrar cubre lo que debes pagar a transportistas. Estás bien.'}
        </div>
      </div>
    </div>
  );
}

function TablaPagos({ pagos, esDirector, onActualizar }) {
  if (pagos.length === 0) {
    return <EmptyState icono="📤" titulo="Sin pagos programados todavía"
      texto="Cuando asignes un transportista a un lead broker, programa aquí cuándo le vas a pagar y por cuánto. El sistema te avisa si está vencido o si pagas antes de que el cliente te pague." />;
  }

  const marcarPagado = async (p) => {
    const ref = prompt('Referencia / folio de transferencia (opcional):');
    if (ref === null) return; // canceló
    try {
      const r = await api.marcarBrokerPagoPagado(p.id, { referencia: ref || null });
      if (r.warning) alert(r.warning);
      onActualizar();
    } catch (e) { alert(e.message); }
  };

  const cancelar = async (p) => {
    const motivo = prompt(`Motivo para cancelar pago a "${p.transportista}":`);
    if (!motivo) return;
    try { await api.cancelarBrokerPago(p.id, motivo); onActualizar(); }
    catch (e) { alert(e.message); }
  };

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>Estado</th>
            <th style={th}>Transportista</th>
            <th style={th}>Lead</th>
            <th style={th}>Concepto</th>
            <th style={{ ...th, textAlign: 'right' }}>Monto</th>
            <th style={th}>Programado</th>
            <th style={th}>Cliente pagó</th>
            <th style={th}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {pagos.map(p => {
            const colores = {
              pagado:     { bg: '#dcfce7', color: '#166534', icono: '✅' },
              vencido:    { bg: '#fee2e2', color: '#991b1b', icono: '⛔' },
              proximo:    { bg: '#fef3c7', color: '#92400e', icono: '⏰' },
              programado: { bg: '#dbeafe', color: '#1e3a8a', icono: '📅' },
              cancelado:  { bg: '#f3f4f6', color: '#6b7280', icono: '✖️' },
            }[p.estado_visual] || { bg: '#f3f4f6', color: '#6b7280', icono: '·' };

            const pctCobrado = p.cliente_total > 0
              ? Math.min(100, (parseFloat(p.cliente_ya_pago || 0) / parseFloat(p.cliente_total)) * 100)
              : null;

            return (
              <tr key={p.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}>
                  <span style={{ background: colores.bg, color: colores.color, padding: '3px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
                    {colores.icono} {p.estado_visual}
                  </span>
                </td>
                <td style={td}><strong>{p.transportista}</strong></td>
                <td style={td}>{p.lead_folio || <span style={{ color: '#9ca3af' }}>—</span>}</td>
                <td style={td}>{p.concepto}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(p.monto)}</td>
                <td style={td}>
                  {p.fecha_programada?.split('T')[0]}
                  {p.dias_restantes != null && p.estado_visual !== 'pagado' && (
                    <div style={{ fontSize: 11, color: p.dias_restantes < 0 ? '#991b1b' : '#6b7280' }}>
                      {p.dias_restantes < 0 ? `${Math.abs(p.dias_restantes)}d vencido` : `${p.dias_restantes}d`}
                    </div>
                  )}
                </td>
                <td style={td}>
                  {pctCobrado != null ? (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: pctCobrado >= 100 ? '#16a34a' : '#d97706' }}>
                        {pctCobrado.toFixed(0)}%
                      </div>
                      <div style={{ width: 60, height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pctCobrado}%`, height: '100%',
                          background: pctCobrado >= 100 ? '#16a34a' : '#d97706' }} />
                      </div>
                    </div>
                  ) : <span style={{ color: '#9ca3af' }}>—</span>}
                </td>
                <td style={td}>
                  {esDirector && p.estado_visual !== 'pagado' && p.estado_visual !== 'cancelado' && (
                    <>
                      <button onClick={() => marcarPagado(p)} className="btn btn-ghost btn-sm" title="Marcar pagado">✅</button>
                      <button onClick={() => cancelar(p)}    className="btn btn-ghost btn-sm" title="Cancelar">✖️</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TablaCobros({ leadsBroker, esDirector, onRegistrar }) {
  const pendientes = leadsBroker.filter(l =>
    l.estado === 'ganado' &&
    (parseFloat(l.monto_cobrado_cliente || 0) < parseFloat(l.precio_final || 0))
  );

  if (pendientes.length === 0) {
    return <EmptyState icono="💰" titulo="Sin cobros pendientes"
      texto="Cuando un lead broker pase a 'ganado' y aún no hayas cobrado completo del cliente, aparecerá aquí." />;
  }

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb' }}>
            <th style={th}>Folio</th>
            <th style={th}>Cliente</th>
            <th style={th}>Ruta</th>
            <th style={{ ...th, textAlign: 'right' }}>Total</th>
            <th style={{ ...th, textAlign: 'right' }}>Cobrado</th>
            <th style={{ ...th, textAlign: 'right' }}>Pendiente</th>
            <th style={th}>%</th>
            <th style={th}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {pendientes.map(l => {
            const cobrado  = parseFloat(l.monto_cobrado_cliente || 0);
            const total    = parseFloat(l.precio_final || 0);
            const pct      = total > 0 ? (cobrado / total) * 100 : 0;
            const pend     = total - cobrado;
            return (
              <tr key={l.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}><strong>{l.folio}</strong></td>
                <td style={td}>
                  <div>{l.contacto_nombre}</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{l.empresa}</div>
                </td>
                <td style={td}>{l.origen} → {l.destino}</td>
                <td style={{ ...td, textAlign: 'right' }}>{fmt$(total)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmt$(cobrado)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#E87722', fontWeight: 700 }}>{fmt$(pend)}</td>
                <td style={td}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{pct.toFixed(0)}%</div>
                  <div style={{ width: 60, height: 4, background: '#e5e7eb', borderRadius: 2 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#16a34a' : '#d97706' }} />
                  </div>
                </td>
                <td style={td}>
                  {esDirector && (
                    <button onClick={() => onRegistrar(l)} className="btn btn-primary btn-sm">
                      💰 Registrar cobro
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConcentracionView({ data }) {
  const cl  = data.concentracion?.clientes || [];
  const tr  = data.concentracion?.transportistas || [];
  const uC  = data.umbrales?.cliente_pct || 25;
  const uT  = data.umbrales?.transportista_pct || 30;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 4px' }}>👥 Top clientes broker (90d)</h4>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>Alerta sobre {uC}% del volumen</div>
        {cl.length === 0 ? <div className="empty" style={{ padding: 12, fontSize: 12 }}>Sin datos</div> : cl.map((c, i) => (
          <BarraConcentracion key={i} label={c.empresa || c.cliente}
            pct={c.pct_volumen} monto={c.volumen_trimestre} ops={c.operaciones} umbral={uC} />
        ))}
      </div>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
        <h4 style={{ margin: '0 0 4px' }}>🚚 Top transportistas broker (90d)</h4>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>Alerta sobre {uT}% del volumen</div>
        {tr.length === 0 ? <div className="empty" style={{ padding: 12, fontSize: 12 }}>Sin datos</div> : tr.map((t, i) => (
          <BarraConcentracion key={i} label={t.transportista}
            pct={t.pct_volumen} monto={t.volumen_trimestre} ops={t.operaciones} umbral={uT} />
        ))}
      </div>
    </div>
  );
}

function BarraConcentracion({ label, pct, monto, ops, umbral }) {
  const enAlerta = pct >= umbral;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: enAlerta ? '#991b1b' : '#1A1A1A' }}>
          {enAlerta && '⚠️ '}{label}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: enAlerta ? '#991b1b' : '#374151' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ width: '100%', height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`, height: '100%',
          background: enAlerta ? '#dc2626' : '#1B3A6B',
        }} />
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
        {fmt$(monto)} · {ops} operación(es)
      </div>
    </div>
  );
}

function ModalProgramarPago({ transportistas, leadsBroker, onClose, onCreado }) {
  const [form, setForm] = useState({
    transportista_externo_id: '',
    lead_id: '',
    concepto: '',
    monto: '',
    fecha_programada: '',
    metodo: 'transferencia',
    notas: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // Cuando elige un lead, autocompleta transportista y monto
  useEffect(() => {
    if (form.lead_id) {
      const l = leadsBroker.find(x => x.id === parseInt(form.lead_id));
      if (l && l.transportista_externo_id && !form.transportista_externo_id) {
        setForm(f => ({
          ...f,
          transportista_externo_id: l.transportista_externo_id,
          monto: l.precio_transportista || '',
          concepto: `Servicio ${l.folio} ${l.origen} → ${l.destino}`,
        }));
      }
    }
  // eslint-disable-next-line
  }, [form.lead_id]);

  const guardar = async () => {
    if (!form.transportista_externo_id || !form.concepto || !form.monto || !form.fecha_programada) {
      setError('Transportista, concepto, monto y fecha son requeridos'); return;
    }
    setGuardando(true); setError(null);
    try {
      await api.crearBrokerPago({
        ...form,
        transportista_externo_id: parseInt(form.transportista_externo_id),
        lead_id: form.lead_id ? parseInt(form.lead_id) : null,
        monto: parseFloat(form.monto),
      });
      onCreado();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', padding: 24,
        maxHeight: '90vh', overflow: 'auto',
      }}>
        <h2 style={{ margin: '0 0 14px' }}>📤 Programar pago a transportista</h2>

        <div className="form-group">
          <label className="form-label">Lead broker (opcional, autocompleta)</label>
          <select value={form.lead_id} onChange={e => setForm({ ...form, lead_id: e.target.value })}>
            <option value="">— Sin vincular —</option>
            {leadsBroker.filter(l => l.transportista_externo_id).map(l => (
              <option key={l.id} value={l.id}>
                {l.folio} · {l.empresa || l.contacto_nombre} · {l.origen}→{l.destino}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Transportista *</label>
          <select value={form.transportista_externo_id}
            onChange={e => setForm({ ...form, transportista_externo_id: e.target.value })}>
            <option value="">— Selecciona —</option>
            {transportistas.map(t => (
              <option key={t.id} value={t.id}>✅ {t.razon_social}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Concepto *</label>
          <input type="text" value={form.concepto}
            onChange={e => setForm({ ...form, concepto: e.target.value })}
            placeholder="Servicio CUERNAVACA → CDMX 12 toneladas" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Monto $MXN *</label>
            <input type="number" step="0.01" value={form.monto}
              onChange={e => setForm({ ...form, monto: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha programada *</label>
            <input type="date" value={form.fecha_programada}
              onChange={e => setForm({ ...form, fecha_programada: e.target.value })} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Método</label>
            <select value={form.metodo} onChange={e => setForm({ ...form, metodo: e.target.value })}>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="efectivo">Efectivo</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Notas</label>
            <input type="text" value={form.notas}
              onChange={e => setForm({ ...form, notas: e.target.value })} />
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Programar pago'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalRegistrarCobro({ lead, onClose, onRegistrado }) {
  const cobrado    = parseFloat(lead.monto_cobrado_cliente || 0);
  const total      = parseFloat(lead.precio_final || 0);
  const pendiente  = total - cobrado;

  const [monto, setMonto] = useState(pendiente > 0 ? pendiente.toFixed(2) : '');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    if (!monto || parseFloat(monto) <= 0) { setError('Monto inválido'); return; }
    setGuardando(true); setError(null);
    try {
      await api.registrarCobroLead(lead.id, { monto: parseFloat(monto), fecha });
      onRegistrado();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', padding: 24,
      }}>
        <h2 style={{ margin: '0 0 4px' }}>💰 Registrar cobro de cliente</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
          {lead.folio} · {lead.empresa || lead.contacto_nombre}
        </p>

        <div style={{ background: '#f0f9ff', padding: 12, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
          Total: <strong>{fmt$(total)}</strong> ·
          Cobrado: <strong style={{ color: '#16a34a' }}>{fmt$(cobrado)}</strong> ·
          Pendiente: <strong style={{ color: '#E87722' }}>{fmt$(pendiente)}</strong>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Monto recibido $MXN *</label>
            <input type="number" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Registrar cobro'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function ModalConfigBroker({ actual, onClose, onGuardado }) {
  const [form, setForm] = useState({
    politica_pago: actual.politica_pago || 'esperar_cobro_cliente',
    alerta_concentracion_cliente_pct: actual.cliente_pct || 25,
    alerta_concentracion_transportista_pct: actual.transportista_pct || 30,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const guardar = async () => {
    setGuardando(true); setError(null);
    try { await api.brokerConfig(form); onGuardado(); }
    catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 500, width: '100%', padding: 24,
      }}>
        <h2 style={{ margin: '0 0 14px' }}>⚙️ Política de finanzas broker</h2>

        <div className="form-group">
          <label className="form-label">Política de pago a transportistas</label>
          <select value={form.politica_pago} onChange={e => setForm({ ...form, politica_pago: e.target.value })}>
            <option value="esperar_cobro_cliente">Esperar cobro del cliente (más seguro)</option>
            <option value="adelantar_con_factura">Adelantar si transportista facturó</option>
            <option value="adelantar_libre">Adelantar libremente (riesgoso)</option>
          </select>
          <small style={{ color: '#6b7280', fontSize: 12 }}>
            Si eliges "esperar cobro", el sistema te avisa cuando intentes pagar antes de que el cliente te haya pagado completo.
          </small>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Alerta concentración cliente (%)</label>
            <input type="number" step="1" value={form.alerta_concentracion_cliente_pct}
              onChange={e => setForm({ ...form, alerta_concentracion_cliente_pct: parseFloat(e.target.value) })} />
            <small style={{ color: '#6b7280', fontSize: 12 }}>
              Si un cliente supera este % del volumen de 90 días, alerta.
            </small>
          </div>
          <div className="form-group">
            <label className="form-label">Alerta concentración transportista (%)</label>
            <input type="number" step="1" value={form.alerta_concentracion_transportista_pct}
              onChange={e => setForm({ ...form, alerta_concentracion_transportista_pct: parseFloat(e.target.value) })} />
          </div>
        </div>

        {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>⚠️ {error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={guardar} disabled={guardando} className="btn btn-primary">
            {guardando ? 'Guardando...' : 'Guardar política'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
