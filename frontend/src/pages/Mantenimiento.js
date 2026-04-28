import React, { useState, useEffect } from 'react';
import { api } from '../api';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtDate = d => { if (!d) return '—'; const p = d.split('T')[0].split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const hoy = () => new Date().toISOString().split('T')[0];
const TIPOS = ['preventivo','correctivo','aceite','llantas','frenos','electrico','otro'];
const TIPO_LABEL = { preventivo:'Preventivo', correctivo:'Correctivo', aceite:'Aceite', llantas:'Llantas', frenos:'Frenos', electrico:'Eléctrico', otro:'Otro' };
const TIPO_BADGE = { preventivo:'badge-blue', correctivo:'badge-red', aceite:'badge-green', llantas:'badge-amber', frenos:'badge-red', electrico:'badge-amber', otro:'badge-gray' };

export default function Mantenimiento() {
  const [tab, setTab] = useState('proximos');
  const [mantenimientos, setMantenimientos] = useState([]);
  const [proximos, setProximos] = useState([]);
  const [costos, setCostos] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [operadores, setOperadores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ unidad_id: '', operador_id: '', tipo: 'preventivo', descripcion: '', costo: '', fecha: hoy(), kilometraje: '', proximo_km: '', proximo_fecha: '', estado: 'completado' });
  const [formUnidad, setFormUnidad] = useState({ placas: '', descripcion: '', marca: '', modelo: '', anio: '' });

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    const [m, p, c, u, o] = await Promise.all([
      api.mantenimientos(),
      api.proximosMantenimientos(),
      api.costosUnidad(),
      api.unidades(),
      api.operadores(),
    ]);
    setMantenimientos(m);
    setProximos(p);
    setCostos(c);
    setUnidades(u);
    setOperadores(o);
  };

  const guardar = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearMantenimiento(form);
      setForm({ unidad_id: '', operador_id: '', tipo: 'preventivo', descripcion: '', costo: '', fecha: hoy(), kilometraje: '', proximo_km: '', proximo_fecha: '', estado: 'completado' });
      setMsg('✓ Mantenimiento registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
      setTab('historial');
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const guardarUnidad = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearUnidad(formUnidad);
      setFormUnidad({ placas: '', descripcion: '', marca: '', modelo: '', anio: '' });
      setMsg('✓ Unidad registrada');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const diasParaProximo = (fecha) => {
    if (!fecha) return null;
    const hoyDate = new Date();
    const proxDate = new Date(fecha);
    const diff = Math.ceil((proxDate - hoyDate) / (1000*60*60*24));
    return diff;
  };

  const totalCostos = costos.reduce((a, c) => a + parseFloat(c.costo_total || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h2>Mantenimiento de Flota</h2>
        <p>Control de servicios y mantenimientos por unidad</p>
      </div>

      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Unidades registradas</div><div className="metric-value navy">{unidades.length}</div></div>
        <div className="metric"><div className="metric-label">Próximos mantenimientos</div><div className={`metric-value ${proximos.length > 0 ? 'orange' : 'green'}`}>{proximos.length}</div></div>
        <div className="metric"><div className="metric-label">Costo total mantenimiento</div><div className="metric-value red">{fmt(totalCostos)}</div></div>
        <div className="metric"><div className="metric-label">Registros totales</div><div className="metric-value">{mantenimientos.length}</div></div>
      </div>

      {proximos.length > 0 && (
        <div className="card" style={{ borderLeft: '3px solid #E87722' }}>
          <div className="card-title">⚠️ Próximos mantenimientos (30 días)</div>
          {proximos.map(p => {
            const dias = diasParaProximo(p.proximo_fecha);
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '.5px solid #f0f0f0' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.placas || 'Sin unidad'} — <span className={`badge ${TIPO_BADGE[p.tipo]}`}>{TIPO_LABEL[p.tipo]}</span></div>
                  <div className="text-muted">{p.descripcion}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, color: dias <= 7 ? '#A32D2D' : '#E87722' }}>{dias <= 0 ? 'VENCIDO' : `En ${dias} días`}</div>
                  <div className="text-muted">{fmtDate(p.proximo_fecha)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="tabs">
        {['proximos','registrar','historial','costos','unidades'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'proximos' ? 'Próximos' : t === 'registrar' ? 'Registrar' : t === 'historial' ? 'Historial' : t === 'costos' ? 'Costos' : 'Unidades'}
          </button>
        ))}
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      {tab === 'registrar' && (
        <div className="card">
          <div className="card-title">Registrar mantenimiento</div>
          <form onSubmit={guardar}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Unidad</label>
                <select value={form.unidad_id} onChange={e => setForm({...form, unidad_id: e.target.value})}>
                  <option value="">Sin especificar</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.placas} — {u.descripcion || ''}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Operador</label>
                <select value={form.operador_id} onChange={e => setForm({...form, operador_id: e.target.value})}>
                  <option value="">Sin especificar</option>
                  {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Tipo</label>
                <select value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value})}>
                  {TIPOS.map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Descripción del trabajo</label>
              <textarea placeholder="Qué se hizo, qué se reparó, qué se cambió..." value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Costo ($)</label>
                <input type="number" placeholder="0" min="0" value={form.costo} onChange={e => setForm({...form, costo: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Kilometraje actual</label>
                <input type="number" placeholder="0" min="0" value={form.kilometraje} onChange={e => setForm({...form, kilometraje: e.target.value})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Próximo mantenimiento (fecha)</label>
                <input type="date" value={form.proximo_fecha} onChange={e => setForm({...form, proximo_fecha: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Próximo (km)</label>
                <input type="number" placeholder="Km para próximo servicio" min="0" value={form.proximo_km} onChange={e => setForm({...form, proximo_km: e.target.value})} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Registrar mantenimiento</button>
          </form>
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">Historial de mantenimientos</div>
          {mantenimientos.length === 0 ? <div className="empty">Sin registros</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fecha</th><th>Unidad</th><th>Tipo</th><th>Descripción</th><th>Costo</th><th>Próximo</th></tr></thead>
                <tbody>
                  {mantenimientos.map(m => (
                    <tr key={m.id}>
                      <td>{fmtDate(m.fecha)}</td>
                      <td style={{ fontWeight: 500 }}>{m.placas || '—'}</td>
                      <td><span className={`badge ${TIPO_BADGE[m.tipo]}`}>{TIPO_LABEL[m.tipo]}</span></td>
                      <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.descripcion}</td>
                      <td style={{ color: '#A32D2D' }}>{fmt(m.costo)}</td>
                      <td className="text-muted">{fmtDate(m.proximo_fecha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'costos' && (
        <div className="card">
          <div className="card-title">Costo de mantenimiento por unidad — 6 meses</div>
          {costos.length === 0 ? <div className="empty">Sin datos</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Unidad</th><th>Servicios</th><th>Último servicio</th><th>Costo total</th></tr></thead>
                <tbody>
                  {costos.map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{c.placas || '—'} {c.descripcion && <span className="text-muted">— {c.descripcion}</span>}</td>
                      <td>{c.num_mantenimientos}</td>
                      <td className="text-muted">{fmtDate(c.ultimo_mantenimiento)}</td>
                      <td style={{ fontWeight: 700, color: '#A32D2D' }}>{fmt(c.costo_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan="3" style={{ fontWeight: 600, paddingTop: 12 }}>Total</td><td style={{ fontWeight: 700, color: '#A32D2D', paddingTop: 12 }}>{fmt(totalCostos)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'unidades' && (
        <div>
          <div className="card">
            <div className="card-title">Unidades registradas</div>
            {unidades.length === 0 ? <div className="empty">Sin unidades</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Placas</th><th>Descripción</th><th>Marca / Modelo</th><th>Año</th></tr></thead>
                  <tbody>
                    {unidades.map(u => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600, color: '#1B3A6B' }}>{u.placas}</td>
                        <td>{u.descripcion || '—'}</td>
                        <td>{u.marca ? `${u.marca} ${u.modelo || ''}` : '—'}</td>
                        <td>{u.anio || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Registrar unidad / tráiler</div>
            <form onSubmit={guardarUnidad}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Placas</label>
                  <input type="text" placeholder="ABC-123-X" value={formUnidad.placas} onChange={e => setFormUnidad({...formUnidad, placas: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Descripción</label>
                  <input type="text" placeholder="Ej. Tráiler 1, Pipa..." value={formUnidad.descripcion} onChange={e => setFormUnidad({...formUnidad, descripcion: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Marca</label>
                  <input type="text" placeholder="Ej. International, Kenworth" value={formUnidad.marca} onChange={e => setFormUnidad({...formUnidad, marca: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Modelo / Año</label>
                  <input type="number" placeholder="2018" min="1990" max="2030" value={formUnidad.anio} onChange={e => setFormUnidad({...formUnidad, anio: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Registrar unidad</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
