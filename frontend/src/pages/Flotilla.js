import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtN = n => (parseFloat(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 });

export default function Flotilla() {
  const { usuario } = useAuth();
  const puedeEditar = ['director','admin'].includes(usuario?.rol);

  const [tab, setTab] = useState('combustible');
  const [resumen, setResumen] = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [tarjetas, setTarjetas] = useState([]);
  const [tags, setTags] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  // Modales
  const [creandoTarjeta, setCreandoTarjeta] = useState(false);
  const [creandoTag, setCreandoTag] = useState(false);
  const [tarjetaAbierta, setTarjetaAbierta] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p, t, tg, u, op] = await Promise.all([
        api.flotillaResumen(),
        api.flotillaProveedores(),
        api.tarjetas(),
        api.tags(),
        api.unidades(),
        api.operadores(),
      ]);
      setResumen(r); setProveedores(p); setTarjetas(t); setTags(tg); setUnidades(u); setOperadores(op);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const provCombustible = proveedores.filter(p => p.tipo === 'combustible');
  const provCaseta = proveedores.filter(p => p.tipo === 'caseta');

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>💳 Flotilla — Tarjetas y TAGs</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Control de combustible (Edenred, Pemex, etc.) y casetas (IAVE, PASE, TeleVía)
          </p>
        </div>
      </div>

      {msg && <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}><div className="alert-dot"/><div>{msg.txt}</div></div>}

      {/* Resumen global */}
      {resumen && (
        <div className="metric-grid" style={{ marginBottom: 20 }}>
          <Metric label="Tarjetas combustible" value={resumen.tarjetas_activas} sub="Activas" color="#1B3A6B" />
          <Metric label="TAGs casetas" value={resumen.tags_activos} sub="Activos" color="#1B3A6B" />
          <Metric label="Combustible mes" value={fmt$(resumen.gasto_combustible_mes)} color="#E87722" />
          <Metric label="Casetas mes" value={fmt$(resumen.gasto_casetas_mes)} color="#E87722" />
          <Metric label="Saldo tarjetas" value={fmt$(resumen.saldo_total_tarjetas)} color="#16a34a" />
          <Metric label="Saldo TAGs" value={fmt$(resumen.saldo_total_tags)} color="#16a34a" />
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        {[
          { id: 'combustible', label: '⛽ Tarjetas combustible' },
          { id: 'casetas',     label: '🛣️ TAGs casetas' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer',
              background: tab === t.id ? '#1A1A1A' : 'transparent',
              color: tab === t.id ? '#fff' : '#1A1A1A',
              fontWeight: tab === t.id ? 700 : 500,
              borderRadius: '8px 8px 0 0',
            }}>{t.label}</button>
        ))}
      </div>

      {tab === 'combustible' && (
        <div>
          {puedeEditar && (
            <button onClick={() => setCreandoTarjeta(true)} className="btn btn-primary" style={{ marginBottom: 12 }}>
              ➕ Agregar tarjeta de combustible
            </button>
          )}
          {loading ? <div className="empty">Cargando...</div> : tarjetas.length === 0 ? (
            <EmptyState
              icono="💳"
              titulo="Aún no tienes tarjetas de combustible"
              texto="Empieza dando de alta tu primera tarjeta. Recomendado: Edenred Combustible (acepta toda la red Pemex/BP/Shell)."
            />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {tarjetas.map(t => (
                <TarjetaCard key={t.id} tarjeta={t} onAbrir={() => setTarjetaAbierta(t)} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'casetas' && (
        <div>
          {puedeEditar && (
            <button onClick={() => setCreandoTag(true)} className="btn btn-primary" style={{ marginBottom: 12 }}>
              ➕ Agregar TAG de caseta
            </button>
          )}
          {loading ? <div className="empty">Cargando...</div> : tags.length === 0 ? (
            <EmptyState
              icono="🛣️"
              titulo="Aún no tienes TAGs de casetas"
              texto="IAVE (CAPUFE) es el más común para autopistas federales. Sin TAG pagas 10% más en cada caseta."
            />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {tags.map(t => <TagCard key={t.id} tag={t} />)}
            </div>
          )}
        </div>
      )}

      {creandoTarjeta && (
        <ModalNuevaTarjeta
          proveedores={provCombustible} unidades={unidades} operadores={operadores}
          onClose={() => setCreandoTarjeta(false)}
          onCreada={() => { setCreandoTarjeta(false); cargar(); }}
        />
      )}

      {creandoTag && (
        <ModalNuevoTag
          proveedores={provCaseta} unidades={unidades}
          onClose={() => setCreandoTag(false)}
          onCreada={() => { setCreandoTag(false); cargar(); }}
        />
      )}

      {tarjetaAbierta && (
        <ModalDetalleTarjeta
          tarjeta={tarjetaAbierta} puedeEditar={puedeEditar}
          onClose={() => { setTarjetaAbierta(null); cargar(); }}
        />
      )}
    </div>
  );
}

// ── Subcomponentes ──
function Metric({ label, value, sub, color }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function EmptyState({ icono, titulo, texto }) {
  return (
    <div style={{ background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12, padding: 30, textAlign: 'center' }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>{icono}</div>
      <h3 style={{ margin: '0 0 6px', color: '#374151' }}>{titulo}</h3>
      <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>{texto}</p>
    </div>
  );
}

function TarjetaCard({ tarjeta, onAbrir }) {
  const saldoBajo = parseFloat(tarjeta.saldo_actual) < (parseFloat(tarjeta.limite_diario) || 1000);
  return (
    <div onClick={onAbrir} style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${tarjeta.activa ? '#16a34a' : '#9ca3af'}`,
      borderRadius: 10, padding: 14, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{tarjeta.alias || tarjeta.numero}</strong>
            <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
              {tarjeta.proveedor_nombre}
            </span>
            {!tarjeta.activa && <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>Inactiva</span>}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            #{tarjeta.numero}
            {tarjeta.unidad_placas && <> · 🚛 {tarjeta.unidad_placas}</>}
            {tarjeta.operador_nombre && <> · 👤 {tarjeta.operador_nombre}</>}
          </div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
            <strong>{tarjeta.total_movimientos}</strong> movimiento(s) · Gasto mes: <strong>{fmt$(tarjeta.gasto_mes)}</strong>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>SALDO ACTUAL</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: saldoBajo ? '#dc2626' : '#16a34a' }}>
            {fmt$(tarjeta.saldo_actual)}
          </div>
          {tarjeta.limite_diario && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              Límite diario: {fmt$(tarjeta.limite_diario)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TagCard({ tag }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${tag.activa ? '#16a34a' : '#9ca3af'}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 15 }}>{tag.alias || tag.numero}</strong>
            <span style={{ fontSize: 11, background: '#dbeafe', color: '#1e3a8a', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
              {tag.proveedor_nombre}
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
            #{tag.numero}
            {tag.unidad_placas && <> · 🚛 {tag.unidad_placas}</>}
          </div>
          <div style={{ fontSize: 12, color: '#374151', marginTop: 6 }}>
            <strong>{tag.total_cruces}</strong> cruce(s) · Gasto mes: <strong>{fmt$(tag.gasto_mes)}</strong>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          <div style={{ fontSize: 11, color: '#6b7280' }}>SALDO TAG</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#16a34a' }}>{fmt$(tag.saldo_actual)}</div>
        </div>
      </div>
    </div>
  );
}

function ModalNuevaTarjeta({ proveedores, unidades, operadores, onClose, onCreada }) {
  const [form, setForm] = useState({
    proveedor_id: proveedores[0]?.id || '', numero: '', alias: '',
    unidad_id: '', operador_id: '', saldo_actual: 0, limite_diario: '', limite_semanal: '', notas: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    if (!form.proveedor_id || !form.numero.trim()) { setError('Proveedor y número son obligatorios'); return; }
    setGuardando(true); setError(null);
    try {
      await api.crearTarjeta({
        proveedor_id: parseInt(form.proveedor_id),
        numero: form.numero.trim(),
        alias: form.alias.trim() || null,
        unidad_id: form.unidad_id ? parseInt(form.unidad_id) : null,
        operador_id: form.operador_id ? parseInt(form.operador_id) : null,
        saldo_actual: parseFloat(form.saldo_actual) || 0,
        limite_diario: form.limite_diario ? parseFloat(form.limite_diario) : null,
        limite_semanal: form.limite_semanal ? parseFloat(form.limite_semanal) : null,
        notas: form.notas.trim() || null,
      });
      onCreada();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return <Modal titulo="➕ Nueva tarjeta de combustible" onClose={onClose}>
    <div className="form-group">
      <label className="form-label">Proveedor *</label>
      <select value={form.proveedor_id} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
        {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Número de tarjeta *</label>
        <input type="text" placeholder="****1234" value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Alias</label>
        <input type="text" placeholder="Edenred TR-01" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} />
      </div>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Unidad asignada</label>
        <select value={form.unidad_id} onChange={e => setForm({ ...form, unidad_id: e.target.value })}>
          <option value="">— Sin asignar —</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.placas}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Operador asignado</label>
        <select value={form.operador_id} onChange={e => setForm({ ...form, operador_id: e.target.value })}>
          <option value="">— Sin asignar —</option>
          {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </div>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Saldo actual ($)</label>
        <input type="number" value={form.saldo_actual} onChange={e => setForm({ ...form, saldo_actual: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Límite diario</label>
        <input type="number" placeholder="5000" value={form.limite_diario} onChange={e => setForm({ ...form, limite_diario: e.target.value })} />
      </div>
    </div>
    {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</div>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={crear} disabled={guardando} className="btn btn-primary">{guardando ? 'Creando...' : 'Crear tarjeta'}</button>
      <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
    </div>
  </Modal>;
}

function ModalNuevoTag({ proveedores, unidades, onClose, onCreada }) {
  const [form, setForm] = useState({
    proveedor_id: proveedores[0]?.id || '', numero: '', alias: '',
    unidad_id: '', saldo_actual: 0, notas: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const crear = async () => {
    if (!form.proveedor_id || !form.numero.trim()) { setError('Proveedor y número son obligatorios'); return; }
    setGuardando(true); setError(null);
    try {
      await api.crearTag({
        proveedor_id: parseInt(form.proveedor_id),
        numero: form.numero.trim(),
        alias: form.alias.trim() || null,
        unidad_id: form.unidad_id ? parseInt(form.unidad_id) : null,
        saldo_actual: parseFloat(form.saldo_actual) || 0,
        notas: form.notas.trim() || null,
      });
      onCreada();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };

  return <Modal titulo="➕ Nuevo TAG de caseta" onClose={onClose}>
    <div className="form-group">
      <label className="form-label">Proveedor *</label>
      <select value={form.proveedor_id} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
        {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Número de TAG *</label>
        <input type="text" placeholder="IAVE-12345" value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Alias</label>
        <input type="text" placeholder="IAVE TR-01" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} />
      </div>
    </div>
    <div className="form-row">
      <div className="form-group">
        <label className="form-label">Unidad asignada</label>
        <select value={form.unidad_id} onChange={e => setForm({ ...form, unidad_id: e.target.value })}>
          <option value="">— Sin asignar —</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.placas}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Saldo actual ($)</label>
        <input type="number" value={form.saldo_actual} onChange={e => setForm({ ...form, saldo_actual: e.target.value })} />
      </div>
    </div>
    {error && <div style={{ background: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 10 }}>⚠️ {error}</div>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={crear} disabled={guardando} className="btn btn-primary">{guardando ? 'Creando...' : 'Crear TAG'}</button>
      <button onClick={onClose} className="btn btn-ghost">Cancelar</button>
    </div>
  </Modal>;
}

function ModalDetalleTarjeta({ tarjeta, puedeEditar, onClose }) {
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [subiendoCsv, setSubiendoCsv] = useState(false);
  const [resultadoCsv, setResultadoCsv] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const m = await api.movimientosTarjeta(tarjeta.id, 200);
      setMovimientos(m);
    } catch (_) {} finally { setCargando(false); }
  }, [tarjeta.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const subirCsv = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setSubiendoCsv(true);
    setResultadoCsv(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await api.uploadCsvMovimientos(tarjeta.id, fd);
      setResultadoCsv(r);
      cargar();
    } catch (err) {
      setResultadoCsv({ error: err.message });
    } finally { setSubiendoCsv(false); e.target.value = ''; }
  };

  return <Modal titulo={`💳 ${tarjeta.alias || tarjeta.numero}`} onClose={onClose} ancho={900}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
      <Mini label="Proveedor" value={tarjeta.proveedor_nombre} />
      <Mini label="Saldo" value={fmt$(tarjeta.saldo_actual)} color="#16a34a" />
      <Mini label="Gasto mes" value={fmt$(tarjeta.gasto_mes)} color="#E87722" />
      <Mini label="Movimientos" value={tarjeta.total_movimientos} />
    </div>

    {puedeEditar && (
      <div style={{ background: '#f0f9ff', border: '1px solid #1B3A6B', borderRadius: 10, padding: 14, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>📥 Importar estado de cuenta CSV</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
          Sube el CSV que descargues del portal de {tarjeta.proveedor_nombre}.
          El sistema detecta automáticamente columnas comunes (fecha, monto, estación, litros).
        </div>
        <label className="btn btn-primary btn-sm" style={{ display: 'inline-block', cursor: 'pointer' }}>
          {subiendoCsv ? 'Procesando...' : '📥 Subir CSV'}
          <input type="file" accept=".csv,text/csv" onChange={subirCsv} disabled={subiendoCsv} style={{ display: 'none' }} />
        </label>
        {resultadoCsv && (
          <div style={{
            marginTop: 10, padding: 10, borderRadius: 6, fontSize: 13,
            background: resultadoCsv.error ? '#fee2e2' : '#dcfce7',
            color: resultadoCsv.error ? '#991b1b' : '#166534',
          }}>
            {resultadoCsv.error
              ? `⚠️ ${resultadoCsv.error}`
              : `✓ Importados: ${resultadoCsv.importados} · Duplicados: ${resultadoCsv.duplicados} · Errores: ${resultadoCsv.errores}`}
          </div>
        )}
      </div>
    )}

    <h4 style={{ margin: '16px 0 8px' }}>Movimientos recientes</h4>
    {cargando ? <div>Cargando...</div> : movimientos.length === 0 ? (
      <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
        Sin movimientos aún. Importa un CSV o agrega manualmente.
      </div>
    ) : (
      <div style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
            <tr><th style={th}>Fecha</th><th style={th}>Estación</th><th style={th}>Combustible</th><th style={th}>L</th><th style={th}>$/L</th><th style={{ ...th, textAlign: 'right' }}>Monto</th><th style={th}>Fuente</th></tr>
          </thead>
          <tbody>
            {movimientos.map(m => (
              <tr key={m.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                <td style={td}>{new Date(m.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td style={td}>{m.estacion || '—'}</td>
                <td style={td}>{m.tipo_combustible || '—'}</td>
                <td style={td}>{m.litros ? fmtN(m.litros) : '—'}</td>
                <td style={td}>{m.precio_litro ? `$${m.precio_litro}` : '—'}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(m.monto)}</td>
                <td style={td}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: m.fuente === 'api' ? '#dcfce7' : m.fuente === 'csv' ? '#dbeafe' : '#f3f4f6',
                    color: m.fuente === 'api' ? '#166534' : m.fuente === 'csv' ? '#1e3a8a' : '#374151',
                  }}>{m.fuente}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </Modal>;
}

function Modal({ titulo, children, onClose, ancho = 580 }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: ancho, width: '100%',
        maxHeight: '90vh', overflow: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{titulo}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Mini({ label, value, color }) {
  return (
    <div style={{ background: '#f9fafb', padding: 10, borderRadius: 8 }}>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || '#111', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const th = { padding: '8px 10px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', textAlign: 'left' };
const td = { padding: '6px 10px' };
