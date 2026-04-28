// ============ INVENTARIO ============
import React, { useState, useEffect } from 'react';
import { api } from '../api';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

export function Inventario() {
  const [inventario, setInventario] = useState([]);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ producto: '', existencia: '', unidad: 'piezas', punto_reorden: '' });
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('lista');

  useEffect(() => { cargar(); }, []);
  const cargar = async () => setInventario(await api.inventario());

  const guardar = async (e) => {
    e.preventDefault();
    try {
      if (editando) {
        await api.actualizarInventario(editando, { existencia: form.existencia, punto_reorden: form.punto_reorden });
      } else {
        await api.crearInventario(form);
      }
      setForm({ producto: '', existencia: '', unidad: 'piezas', punto_reorden: '' });
      setEditando(null);
      setMsg('✓ Inventario actualizado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setMsg('Error: ' + err.message); }
  };

  const editar = (inv) => {
    setEditando(inv.id);
    setForm({ producto: inv.producto, existencia: inv.existencia, unidad: inv.unidad, punto_reorden: inv.punto_reorden });
    setTab('actualizar');
  };

  return (
    <div>
      <div className="page-header"><h2>Inventario</h2><p>Control de materiales en Chilapa</p></div>

      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Materiales</div><div className="metric-value navy">{inventario.length}</div></div>
        <div className="metric"><div className="metric-label">Con alerta baja</div><div className="metric-value red">{inventario.filter(i => parseFloat(i.existencia) <= parseFloat(i.punto_reorden)).length}</div></div>
      </div>

      <div className="tabs">
        {['lista','actualizar'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => { setTab(t); if(t==='lista'){setEditando(null);setForm({producto:'',existencia:'',unidad:'piezas',punto_reorden:''});} }}>
            {t === 'lista' ? 'Estado actual' : editando ? 'Actualizar' : 'Agregar material'}
          </button>
        ))}
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      {tab === 'lista' && (
        <div className="card">
          <div className="card-title">Inventario actual</div>
          {inventario.length === 0 ? <div className="empty">Sin inventario registrado</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Material</th><th>Existencia</th><th>Punto reorden</th><th>Actualizado</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {inventario.map(inv => {
                    const bajo = parseFloat(inv.existencia) <= parseFloat(inv.punto_reorden);
                    return (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 500 }}>{inv.producto}</td>
                        <td style={{ fontWeight: 600, color: bajo ? '#A32D2D' : '#0F6E56' }}>{inv.existencia} {inv.unidad}</td>
                        <td className="text-muted">{inv.punto_reorden} {inv.unidad}</td>
                        <td className="text-muted">{fmtDate(inv.updated_at?.split('T')[0])}</td>
                        <td><span className={`badge ${bajo?'badge-red':'badge-green'}`}>{bajo?'Pedir':'OK'}</span></td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => editar(inv)}>Editar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'actualizar' && (
        <div className="card">
          <div className="card-title">{editando ? 'Actualizar existencia' : 'Agregar material'}</div>
          <form onSubmit={guardar}>
            {!editando && (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Material</label>
                  <input type="text" placeholder="Ej. Block, Cemento..." value={form.producto} onChange={e => setForm({...form, producto: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Unidad</label>
                  <select value={form.unidad} onChange={e => setForm({...form, unidad: e.target.value})}>
                    {['piezas','bultos','toneladas','metros³','litros'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            )}
            {editando && <p style={{ fontWeight: 500, marginBottom: 12, color: '#1B3A6B' }}>{form.producto}</p>}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Existencia actual</label>
                <input type="number" placeholder="0" min="0" value={form.existencia} onChange={e => setForm({...form, existencia: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Punto de reorden</label>
                <input type="number" placeholder="0" min="0" value={form.punto_reorden} onChange={e => setForm({...form, punto_reorden: e.target.value})} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block">
              {editando ? 'Actualizar inventario' : 'Agregar material'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default Inventario;
