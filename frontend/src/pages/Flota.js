import React, { useState, useEffect } from 'react';
import { api } from '../api';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const hoy = () => new Date().toISOString().split('T')[0];
const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

export default function Flota() {
  const [tab, setTab] = useState('registrar');
  const [viajes, setViajes] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [rendimiento, setRendimiento] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ fecha: hoy(), operador_id: '', origen: '', destino: '', carga: 'Block', diesel_litros: '', diesel_costo: '', km_recorridos: '', toneladas: '', estado: 'Completado', notas: '' });

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    const [v, o, r] = await Promise.all([api.viajes(), api.operadores(), api.rendimientoSemana()]);
    setViajes(v);
    setOperadores(o);
    setRendimiento(r.operadores || []);
    if (o.length && !form.operador_id) setForm(f => ({ ...f, operador_id: o[0]?.id || '' }));
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.operador_id) { setMsg('Selecciona un operador'); return; }
    if (!form.destino) { setMsg('Ingresa el destino'); return; }
    setLoading(true);
    try {
      await api.crearViaje(form);
      setForm({ fecha: hoy(), operador_id: operadores[0]?.id || '', origen: '', destino: '', carga: 'Block', diesel_litros: '', diesel_costo: '', km_recorridos: '', toneladas: '', estado: 'Completado', notas: '' });
      setMsg('✓ Viaje registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setMsg('Error: ' + e.message); }
    finally { setLoading(false); }
  };

  const estadoBadge = e => ({ Completado: 'badge-green', 'En ruta': 'badge-amber', Cancelado: 'badge-red' }[e] || 'badge-gray');

  const totalViajes = viajes.filter(v => v.estado === 'Completado').length;
  const totalDiesel = viajes.reduce((a, v) => a + parseFloat(v.diesel_costo || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h2>Control de Flota</h2>
        <p>Viajes, operadores y diésel — Andreu Logistics</p>
      </div>

      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Viajes totales</div><div className="metric-value orange">{totalViajes}</div></div>
        <div className="metric"><div className="metric-label">Gasto diésel total</div><div className="metric-value red">{fmt(totalDiesel)}</div></div>
        <div className="metric"><div className="metric-label">Operadores activos</div><div className="metric-value navy">{operadores.length}</div></div>
        <div className="metric"><div className="metric-label">Viajes esta semana</div><div className="metric-value orange">{rendimiento.reduce((a,o) => a + parseInt(o.completados||0), 0)}</div></div>
      </div>

      {/* Rendimiento semana */}
      {rendimiento.length > 0 && (
        <div className="card">
          <div className="card-title">Rendimiento esta semana</div>
          {rendimiento.map(o => {
            const pct = Math.min(100, Math.round((parseInt(o.completados||0) / 5) * 100));
            const color = pct >= 80 ? '#639922' : pct >= 60 ? '#E87722' : '#E24B4A';
            return (
              <div key={o.operador} style={{ marginBottom: 14 }}>
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{o.operador}</span>
                  <span>{o.completados}/5 viajes · Diésel: {fmt(o.diesel_costo)}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: pct + '%', background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="tabs">
        {['registrar','historial','operadores'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'registrar' ? 'Registrar viaje' : t === 'historial' ? 'Historial' : 'Operadores'}
          </button>
        ))}
      </div>

      {tab === 'registrar' && (
        <div className="card">
          <div className="card-title">Nuevo viaje</div>
          {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}
          <form onSubmit={guardar}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Operador</label>
                <select value={form.operador_id} onChange={e => setForm({...form, operador_id: e.target.value})} required>
                  <option value="">Seleccionar...</option>
                  {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Origen</label>
                <input type="text" placeholder="Ej. Patio Chilapa" value={form.origen} onChange={e => setForm({...form, origen: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Destino *</label>
                <input type="text" placeholder="Ej. Tixtla, Chilapa centro" value={form.destino} onChange={e => setForm({...form, destino: e.target.value})} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Carga</label>
                <select value={form.carga} onChange={e => setForm({...form, carga: e.target.value})}>
                  {['Block','Cemento','Varilla','Materiales mixtos','Otro'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Toneladas cargadas</label>
                <input type="number" placeholder="0.0" min="0" step="0.1" value={form.toneladas} onChange={e => setForm({...form, toneladas: e.target.value})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Diésel (litros)</label>
                <input type="number" placeholder="0" min="0" step="0.1" value={form.diesel_litros} onChange={e => setForm({...form, diesel_litros: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Costo diésel ($)</label>
                <input type="number" placeholder="0" min="0" value={form.diesel_costo} onChange={e => setForm({...form, diesel_costo: e.target.value})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Km recorridos <span style={{fontSize:11,color:'#888'}}>(para calcular rendimiento)</span></label>
                <input type="number" placeholder="0" min="0" step="0.1" value={form.km_recorridos} onChange={e => setForm({...form, km_recorridos: e.target.value})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Estado</label>
                <select value={form.estado} onChange={e => setForm({...form, estado: e.target.value})}>
                  {['Completado','En ruta','Cancelado'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notas (opcional)</label>
              <textarea placeholder="Observaciones del viaje..." value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Registrando...' : 'Registrar viaje'}
            </button>
          </form>
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">Historial de viajes</div>
          {viajes.length === 0 ? <div className="empty">Sin viajes registrados</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Operador</th><th>Destino</th><th>Carga</th><th>Diésel</th><th>Estado</th></tr></thead>
                <tbody>
                  {viajes.map(v => (
                    <tr key={v.id}>
                      <td>{fmtDate(v.fecha)}</td>
                      <td style={{ fontWeight: 500 }}>{v.operador_nombre}</td>
                      <td>{v.destino}</td>
                      <td>{v.carga}</td>
                      <td>{v.diesel_litros} lts · {fmt(v.diesel_costo)}</td>
                      <td><span className={`badge ${estadoBadge(v.estado)}`}>{v.estado}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'operadores' && (
        <div className="card">
          <div className="card-title">Operadores activos</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nombre</th><th>Teléfono</th><th>Licencia</th></tr></thead>
              <tbody>
                {operadores.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500 }}>{o.nombre}</td>
                    <td>{o.telefono || '—'}</td>
                    <td>{o.licencia || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
