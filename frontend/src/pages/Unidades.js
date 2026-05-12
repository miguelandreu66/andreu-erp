import React, { useState, useEffect, useCallback } from 'react';
import { api, fileUrl } from '../api';
import { useAuth } from '../context/AuthContext';

const TIPOS_DOC = {
  tarjeta_circulacion:    { label: 'Tarjeta de circulación',      icon: '🪪' },
  poliza_seguro:          { label: 'Póliza de seguro',            icon: '🛡️' },
  permiso_sct:            { label: 'Permiso SCT',                 icon: '🚛' },
  verificacion_vehicular: { label: 'Verificación vehicular',      icon: '✅' },
  comprobante_propiedad:  { label: 'Comprobante de propiedad',    icon: '📜' },
  tarjeta_caja_remolque:  { label: 'Tarjeta caja/remolque',       icon: '📋' },
  factura_unidad:         { label: 'Factura de unidad',           icon: '🧾' },
  tenencia:               { label: 'Tenencia',                    icon: '💸' },
  foto_unidad:            { label: 'Foto de unidad',              icon: '📸' },
  otro:                   { label: 'Otro',                        icon: '📄' },
};

const COLOR_VIGENCIA = {
  vigente:      { bg: '#dcfce7', txt: '#166534', label: '✓ Vigente' },
  por_vencer:   { bg: '#fef3c7', txt: '#92400e', label: '⚠️ Por vencer' },
  vencido:      { bg: '#fee2e2', txt: '#991b1b', label: '❌ VENCIDO' },
  sin_vigencia: { bg: '#f3f4f6', txt: '#6b7280', label: 'Sin vigencia' },
};

export default function Unidades() {
  const { usuario } = useAuth();
  const puedeEditar = ['director', 'admin', 'logistica'].includes(usuario?.rol);

  const [unidades, setUnidades] = useState([]);
  const [posiciones, setPosiciones] = useState({});
  const [docCounts, setDocCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ placas: '', descripcion: '', marca: '', modelo: '', anio: '' });
  const [guardando, setGuardando] = useState(false);
  const [unidadAbierta, setUnidadAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [u, dash] = await Promise.all([
        api.unidades(),
        api.caiDashboard().catch(() => null),
      ]);
      setUnidades(u || []);
      const pos = {};
      (dash?.posiciones || []).forEach(p => { pos[p.unidad_id] = p; });
      setPosiciones(pos);

      // Cargar conteos de docs en paralelo (no bloquea UI)
      const counts = {};
      await Promise.all((u || []).map(async un => {
        try {
          const docs = await api.docsListar(un.id);
          counts[un.id] = {
            total: docs.length,
            vencidos: docs.filter(d => d.estado_vigencia === 'vencido').length,
            por_vencer: docs.filter(d => d.estado_vigencia === 'por_vencer').length,
          };
        } catch (_) { counts[un.id] = { total: 0, vencidos: 0, por_vencer: 0 }; }
      }));
      setDocCounts(counts);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error al cargar: ' + e.message });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarUnidad = async (e) => {
    e.preventDefault();
    if (!form.placas.trim()) { setMsg({ tipo: 'red', txt: 'Placas son obligatorias' }); return; }
    setGuardando(true);
    try {
      await api.crearUnidad({
        placas: form.placas.trim().toUpperCase(),
        descripcion: form.descripcion.trim() || null,
        marca: form.marca.trim() || null,
        modelo: form.modelo.trim() || null,
        anio: form.anio ? parseInt(form.anio) : null,
      });
      setMsg({ tipo: 'green', txt: `✓ Unidad ${form.placas.toUpperCase()} registrada` });
      setForm({ placas: '', descripcion: '', marca: '', modelo: '', anio: '' });
      await cargar();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setGuardando(false); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🚛 Unidades — Flota Andreu Logistics</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Da de alta tus plataformas y gestiona documentos por unidad
          </p>
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', textAlign: 'right' }}>
          <strong style={{ fontSize: 22, color: '#1B3A6B' }}>{unidades.length}</strong> unidad(es)
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}>
          <div className="alert-dot" />
          <div>{msg.txt}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20, alignItems: 'start' }}>

        <div>
          {loading ? (
            <div className="empty">Cargando unidades...</div>
          ) : unidades.length === 0 ? (
            <div style={{
              background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12,
              padding: 40, textAlign: 'center',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🚛</div>
              <h3 style={{ margin: '0 0 8px', color: '#374151' }}>Aún no tienes unidades</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
                Empieza dando de alta tu primera plataforma con el formulario de la derecha.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {unidades.map(u => (
                <UnidadCard
                  key={u.id}
                  unidad={u}
                  posicion={posiciones[u.id]}
                  docCount={docCounts[u.id] || { total: 0, vencidos: 0, por_vencer: 0 }}
                  onOpenDocs={() => setUnidadAbierta(u)}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          {puedeEditar ? (
            <FormularioNuevaUnidad
              form={form}
              setForm={setForm}
              onSubmit={guardarUnidad}
              guardando={guardando}
            />
          ) : (
            <div style={{ background: '#fef3c7', border: '1px solid #d97706', borderRadius: 10, padding: 16, fontSize: 13, color: '#78350f' }}>
              ⚠️ Tu rol no permite crear unidades.
            </div>
          )}

          {unidades.length > 0 && (
            <ResumenFlota unidades={unidades} posiciones={posiciones} docCounts={docCounts} />
          )}
        </div>
      </div>

      {unidadAbierta && (
        <ModalDocumentos
          unidad={unidadAbierta}
          puedeEditar={puedeEditar}
          onClose={() => { setUnidadAbierta(null); cargar(); }}
        />
      )}
    </div>
  );
}

// ── Card de unidad ──────────────────────────────────────
function UnidadCard({ unidad, posicion, docCount, onOpenDocs }) {
  const estadoBg = !posicion || posicion.minutos_desde_ultimo == null ? '#9ca3af' :
    posicion.estado_visual === 'en_ruta' ? '#16a34a' :
    posicion.estado_visual === 'sin_senal' ? '#dc2626' :
    posicion.estado_visual === 'alerta' ? '#dc2626' :
    posicion.estado_visual === 'detenido' ? '#6b7280' : '#22c55e';

  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${estadoBg}`,
      borderRadius: 10, padding: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', letterSpacing: 1 }}>{unidad.placas}</span>
            {unidad.activo === false && (
              <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                Inactiva
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, color: '#374151', marginTop: 4 }}>
            {unidad.descripcion || <em style={{ color: '#9ca3af' }}>Sin descripción</em>}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            {unidad.marca || '?'} {unidad.modelo || ''} {unidad.anio ? `· ${unidad.anio}` : ''}
          </div>

          <button
            onClick={onOpenDocs}
            style={{
              marginTop: 10, padding: '6px 12px',
              background: docCount.vencidos > 0 ? '#fee2e2' : docCount.por_vencer > 0 ? '#fef3c7' : '#f3f4f6',
              color: docCount.vencidos > 0 ? '#991b1b' : docCount.por_vencer > 0 ? '#92400e' : '#374151',
              border: '1px solid', borderColor: docCount.vencidos > 0 ? '#dc2626' : docCount.por_vencer > 0 ? '#d97706' : '#d1d5db',
              borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}
          >
            📋 Documentos ({docCount.total})
            {docCount.vencidos > 0 && <span> · {docCount.vencidos} vencido(s)</span>}
            {docCount.por_vencer > 0 && docCount.vencidos === 0 && <span> · {docCount.por_vencer} por vencer</span>}
          </button>
        </div>
        <div style={{ textAlign: 'right', minWidth: 140 }}>
          {posicion ? (
            <>
              <div style={{
                display: 'inline-block', background: estadoBg, color: '#fff',
                padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: 0.5,
              }}>
                {posicion.estado_visual === 'en_ruta' ? 'En ruta' :
                 posicion.estado_visual === 'sin_senal' ? 'Sin señal' :
                 posicion.estado_visual === 'alerta' ? 'Alerta' :
                 posicion.estado_visual === 'detenido' ? 'Detenida' : 'Sin datos'}
              </div>
              {posicion.velocidad_kmh != null && posicion.velocidad_kmh > 0 && (
                <div style={{ fontSize: 12, color: '#374151', marginTop: 6, fontWeight: 600 }}>
                  {parseFloat(posicion.velocidad_kmh).toFixed(0)} km/h
                </div>
              )}
              {posicion.minutos_desde_ultimo != null && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  hace {Math.round(posicion.minutos_desde_ultimo)} min
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'inline-block', background: '#f3f4f6', color: '#9ca3af', padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>
              Sin GPS aún
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Formulario crear unidad ────────────────────────────
function FormularioNuevaUnidad({ form, setForm, onSubmit, guardando }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, position: 'sticky', top: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>➕ Nueva unidad</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>Director/Admin</p>

      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label className="form-label">Placas *</label>
          <input type="text" placeholder="GRO-123-A" value={form.placas}
            onChange={e => setForm({ ...form, placas: e.target.value })} required
            style={{ textTransform: 'uppercase' }} />
        </div>
        <div className="form-group">
          <label className="form-label">Descripción</label>
          <input type="text" placeholder="Plataforma 48' azul" value={form.descripcion}
            onChange={e => setForm({ ...form, descripcion: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Marca</label>
            <input type="text" placeholder="Kenworth" value={form.marca}
              onChange={e => setForm({ ...form, marca: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Modelo</label>
            <input type="text" placeholder="T800" value={form.modelo}
              onChange={e => setForm({ ...form, modelo: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Año</label>
          <input type="number" placeholder="2018" min="1980" max="2030" value={form.anio}
            onChange={e => setForm({ ...form, anio: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={guardando}>
          {guardando ? 'Guardando...' : '➕ Registrar unidad'}
        </button>
      </form>

      <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8, fontSize: 12, color: '#075985', lineHeight: 1.5 }}>
        💡 <strong>Tip:</strong> Después de crear la unidad, click en <strong>📋 Documentos</strong> para subir tarjeta de circulación, póliza, permiso SCT, etc. La IA te avisará cuando un documento esté por vencer.
      </div>
    </div>
  );
}

// ── Resumen de flota ──────────────────────────────────
function ResumenFlota({ unidades, posiciones, docCounts }) {
  const reportando = Object.values(posiciones).filter(p => p.minutos_desde_ultimo != null && p.minutos_desde_ultimo <= 15).length;
  const totalDocs = Object.values(docCounts).reduce((s, c) => s + c.total, 0);
  const docsVencidos = Object.values(docCounts).reduce((s, c) => s + c.vencidos, 0);
  const docsPorVencer = Object.values(docCounts).reduce((s, c) => s + c.por_vencer, 0);

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Resumen de flota
      </div>
      <Row label="Total registradas" value={unidades.length} />
      <Row label="Activas" value={unidades.filter(u => u.activo !== false).length} color="#16a34a" />
      <Row label="Con GPS reportando" value={reportando} color="#1B3A6B" />
      <Row label="Documentos en sistema" value={totalDocs} />
      {docsVencidos > 0 && <Row label="🚨 Documentos vencidos" value={docsVencidos} color="#dc2626" />}
      {docsPorVencer > 0 && <Row label="⚠️ Por vencer (30d)" value={docsPorVencer} color="#d97706" />}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span>{label}</span>
      <strong style={{ color: color || '#111' }}>{value}</strong>
    </div>
  );
}

// ── Modal: documentos de una unidad ──────────────────
function ModalDocumentos({ unidad, puedeEditar, onClose }) {
  const [docs, setDocs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [config, setConfig] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const [d, c] = await Promise.all([
        api.docsListar(unidad.id),
        api.docsConfig().catch(() => null),
      ]);
      setDocs(d || []); setConfig(c);
    } catch (e) {
      setError(e.message);
    } finally { setCargando(false); }
  }, [unidad.id]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 800, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: 20, borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>📋 Documentos · {unidad.placas}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
              {unidad.descripcion} · {unidad.marca || ''} {unidad.modelo || ''} {unidad.anio || ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {error && (
            <div style={{ background: '#fee2e2', border: '1px solid #dc2626', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12 }}>
              ⚠️ {error}
            </div>
          )}

          {puedeEditar && !mostrarForm && (
            <button onClick={() => setMostrarForm(true)} className="btn btn-primary" style={{ marginBottom: 16 }}>
              ➕ Agregar documento
            </button>
          )}

          {mostrarForm && (
            <FormularioSubirDoc
              unidadId={unidad.id}
              onClose={() => setMostrarForm(false)}
              onSaved={() => { setMostrarForm(false); cargar(); }}
            />
          )}

          {cargando ? (
            <div className="empty">Cargando...</div>
          ) : docs.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#6b7280' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
              <p>Aún no hay documentos para {unidad.placas}.</p>
              {puedeEditar && <p style={{ fontSize: 13 }}>Click en "Agregar documento" para subir el primero.</p>}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {docs.map(d => (
                <DocItem key={d.id} doc={d} puedeEditar={puedeEditar} onDeleted={cargar} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocItem({ doc, puedeEditar, onDeleted }) {
  const tipo = TIPOS_DOC[doc.tipo] || TIPOS_DOC.otro;
  const vig = COLOR_VIGENCIA[doc.estado_vigencia] || COLOR_VIGENCIA.sin_vigencia;

  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar "${doc.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.docsEliminar(doc.id);
      onDeleted();
    } catch (e) { alert('Error: ' + e.message); }
  };

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18 }}>{tipo.icon}</span>
            <strong style={{ fontSize: 14 }}>{doc.nombre}</strong>
            <span style={{
              background: vig.bg, color: vig.txt, padding: '2px 8px', borderRadius: 999,
              fontSize: 11, fontWeight: 700,
            }}>{vig.label}</span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {tipo.label}
            {doc.vigencia_fin && (
              <span>
                {' · '}Vence: {doc.vigencia_fin}
                {doc.dias_restantes != null && (
                  <span style={{ color: doc.dias_restantes < 0 ? '#dc2626' : doc.dias_restantes < 30 ? '#d97706' : '#16a34a', fontWeight: 600 }}>
                    {' '}({doc.dias_restantes < 0 ? `vencido hace ${Math.abs(doc.dias_restantes)}d` : `${doc.dias_restantes}d restantes`})
                  </span>
                )}
              </span>
            )}
          </div>
          {doc.notas && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>"{doc.notas}"</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <a
            href={doc.archivo_url || fileUrl(`/unidades/documentos/${doc.id}/archivo`)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
          >Ver</a>
          {puedeEditar && (
            <button onClick={eliminar} className="btn btn-ghost btn-sm" style={{ color: '#dc2626' }}>Eliminar</button>
          )}
        </div>
      </div>
    </div>
  );
}

function FormularioSubirDoc({ unidadId, onClose, onSaved }) {
  const [tipo, setTipo] = useState('tarjeta_circulacion');
  const [nombre, setNombre] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [vigenciaInicio, setVigenciaInicio] = useState('');
  const [vigenciaFin, setVigenciaFin] = useState('');
  const [alertarDiasAntes, setAlertarDiasAntes] = useState(30);
  const [notas, setNotas] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!archivo) { setError('Selecciona un archivo'); return; }
    if (archivo.size > 10 * 1024 * 1024) { setError('Archivo demasiado grande (máx 10MB)'); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      fd.append('tipo', tipo);
      fd.append('nombre', nombre || archivo.name);
      if (vigenciaInicio) fd.append('vigencia_inicio', vigenciaInicio);
      if (vigenciaFin) fd.append('vigencia_fin', vigenciaFin);
      fd.append('alertar_dias_antes', alertarDiasAntes);
      if (notas) fd.append('notas', notas);
      await api.docsSubir(unidadId, fd);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally { setSubiendo(false); }
  };

  return (
    <div style={{ background: '#fff', border: '2px solid #1B3A6B', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 12px' }}>➕ Subir nuevo documento</h4>
      {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>{error}</div>}
      <form onSubmit={submit}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tipo *</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} required>
              {Object.entries(TIPOS_DOC).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {v.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Nombre</label>
            <input type="text" placeholder="(usa el nombre del archivo)" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Archivo * (PDF, JPG, PNG · máx 10MB)</label>
          <input type="file" accept="image/*,application/pdf" onChange={e => setArchivo(e.target.files[0])} required />
          {archivo && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{archivo.name} · {(archivo.size / 1024).toFixed(0)} KB</div>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Vigencia inicio</label>
            <input type="date" value={vigenciaInicio} onChange={e => setVigenciaInicio(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Vigencia fin (para alertas)</label>
            <input type="date" value={vigenciaFin} onChange={e => setVigenciaFin(e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Avisar X días antes</label>
            <input type="number" value={alertarDiasAntes} onChange={e => setAlertarDiasAntes(e.target.value)} min="1" max="365" />
          </div>
          <div className="form-group">
            <label className="form-label">Notas</label>
            <input type="text" placeholder="Opcional" value={notas} onChange={e => setNotas(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={subiendo}>
            {subiendo ? 'Subiendo...' : '⬆️ Subir documento'}
          </button>
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button>
        </div>
      </form>
    </div>
  );
}
