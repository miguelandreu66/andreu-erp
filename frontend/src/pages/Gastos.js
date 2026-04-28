import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const hoy = () => new Date().toISOString().split('T')[0];
const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const CATS = ['Diésel','Nómina','Mantenimiento','Compra de material','Viáticos','Renta / servicios','Herramientas','Otros'];

export default function Gastos() {
  const { puede } = useAuth();
  const [tab, setTab] = useState('registrar');
  const [gastos, setGastos] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ fecha: hoy(), categoria: 'Diésel', monto: '', comprobante: false, descripcion: '' });

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    const [g, r] = await Promise.all([api.gastos(), api.resumenGastosSemana()]);
    setGastos(g);
    setResumen(r);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.monto || parseFloat(form.monto) <= 0) { setMsg('Ingresa un monto válido'); return; }
    setLoading(true);
    try {
      await api.crearGasto(form);
      setForm({ fecha: hoy(), categoria: 'Diésel', monto: '', comprobante: false, descripcion: '' });
      setMsg('✓ Gasto registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (e) { setMsg('Error: ' + e.message); }
    finally { setLoading(false); }
  };

  const aprobar = async (id, accion) => {
    await api.aprobarGasto(id, accion);
    cargar();
  };

  const estadoBadge = e => ({ aprobado: 'badge-green', pendiente: 'badge-amber', rechazado: 'badge-red' }[e] || 'badge-gray');
  const totalSemana = resumen?.total || 0;

  return (
    <div>
      <div className="page-header">
        <h2>Gastos y Egresos</h2>
        <p>Control de gastos operativos con aprobación</p>
      </div>

      {/* Resumen semana */}
      {resumen?.por_categoria && (
        <div className="card">
          <div className="card-title">Gastos por categoría — semana actual</div>
          {resumen.por_categoria.map(c => {
            const pct = totalSemana > 0 ? Math.round((parseFloat(c.total) / totalSemana) * 100) : 0;
            return (
              <div key={c.categoria} style={{ marginBottom: 12 }}>
                <div className="flex-between" style={{ fontSize: 13, marginBottom: 3 }}>
                  <span>{c.categoria} {parseInt(c.sin_comprobante) > 0 && <span className="badge badge-red" style={{ marginLeft: 6 }}>sin comprobante</span>}</span>
                  <span style={{ fontWeight: 500 }}>{fmt(c.total)} ({pct}%)</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: pct + '%', background: '#1B3A6B' }} />
                </div>
              </div>
            );
          })}
          <hr className="divider" />
          <div className="flex-between" style={{ fontWeight: 600 }}>
            <span>Total semana</span>
            <span style={{ color: '#A32D2D' }}>{fmt(totalSemana)}</span>
          </div>
        </div>
      )}

      <div className="tabs">
        {['registrar','historial'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'registrar' ? 'Registrar gasto' : 'Historial'}
          </button>
        ))}
      </div>

      {tab === 'registrar' && (
        <div className="card">
          <div className="card-title">Nuevo gasto</div>
          {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}
          <form onSubmit={guardar}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Categoría</label>
                <select value={form.categoria} onChange={e => setForm({...form, categoria: e.target.value})}>
                  {CATS.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Monto ($)</label>
                <input type="number" placeholder="0.00" min="0" step="0.01" value={form.monto} onChange={e => setForm({...form, monto: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">¿Tiene comprobante?</label>
                <select value={form.comprobante ? 'si' : 'no'} onChange={e => setForm({...form, comprobante: e.target.value === 'si'})}>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Descripción</label>
              <textarea placeholder="Detalle del gasto..." value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Registrando...' : 'Registrar gasto'}
            </button>
          </form>
        </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">Historial de gastos</div>
          {gastos.length === 0 ? <div className="empty">Sin gastos registrados</div> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Categoría</th><th>Comp.</th><th>Estado</th><th className="text-right">Monto</th>{puede('director','admin') && <th>Acción</th>}</tr>
                </thead>
                <tbody>
                  {gastos.map(g => (
                    <tr key={g.id}>
                      <td>{fmtDate(g.fecha)}</td>
                      <td style={{ fontWeight: 500 }}>{g.categoria}</td>
                      <td><span className={`badge ${g.comprobante ? 'badge-green' : 'badge-red'}`}>{g.comprobante ? 'Sí' : 'No'}</span></td>
                      <td><span className={`badge ${estadoBadge(g.estado_aprobacion)}`}>{g.estado_aprobacion}</span></td>
                      <td className="text-right fw-500" style={{ color: '#A32D2D' }}>{fmt(g.monto)}</td>
                      {puede('director','admin') && (
                        <td>
                          {g.estado_aprobacion === 'pendiente' && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn btn-sm" style={{ background: '#EAF3DE', color: '#27500A', border: 'none' }} onClick={() => aprobar(g.id,'aprobado')}>✓</button>
                              <button className="btn btn-sm" style={{ background: '#FCEBEB', color: '#791F1F', border: 'none' }} onClick={() => aprobar(g.id,'rechazado')}>✕</button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={puede('director','admin') ? 4 : 3} style={{ fontWeight: 600, paddingTop: 12 }}>Total</td>
                    <td className="text-right" style={{ fontWeight: 700, color: '#A32D2D', paddingTop: 12 }}>{fmt(gastos.filter(g => g.estado_aprobacion !== 'rechazado').reduce((a,g) => a + parseFloat(g.monto), 0))}</td>
                    {puede('director','admin') && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
