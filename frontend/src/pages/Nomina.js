import React, { useState, useEffect } from 'react';
import { api } from '../api';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const hoy = () => new Date().toISOString().split('T')[0];
const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const semanaActual = () => {
  const d = new Date(); const day = d.getDay();
  const diff = d.getDate() - day + (day===0?-6:1);
  return new Date(new Date().setDate(diff)).toISOString().split('T')[0];
};
const AREAS = ['Materiales','Logística','Administración','Central'];

export default function Nomina() {
  const [tab, setTab] = useState('resumen');
  const [empleados, setEmpleados] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [anticipos, setAnticipos] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [semana, setSemana] = useState(semanaActual());

  // Forms
  const [formPago, setFormPago] = useState({ empleado_id: '', semana_inicio: semanaActual(), sueldo_base: '', bonos: '0', deducciones: '0', anticipos_aplicados: '0', notas: '' });
  const [formEmp, setFormEmp] = useState({ nombre: '', puesto: '', area: 'Materiales', sueldo_semanal: '', telefono: '', fecha_ingreso: '' });
  const [formAnticipo, setFormAnticipo] = useState({ empleado_id: '', monto: '', fecha: hoy(), motivo: '' });
  const [anticPendiente, setAnticPendiente] = useState(0);

  useEffect(() => { cargar(); }, [semana]);

  const cargar = async () => {
    const [e, p, a, r] = await Promise.all([
      api.empleados(),
      api.pagosNomina(`?semana_inicio=${semana}`),
      api.anticipos('?aplicado=false'),
      api.resumenNomina(semana)
    ]);
    setEmpleados(e);
    setPagos(p);
    setAnticipos(a);
    setResumen(r);
    if (e.length && !formPago.empleado_id) {
      setFormPago(f => ({ ...f, empleado_id: e[0]?.id || '', sueldo_base: e[0]?.sueldo_semanal || '' }));
    }
  };

  const onEmpChange = async (id) => {
    const emp = empleados.find(e => e.id === parseInt(id));
    setFormPago(f => ({ ...f, empleado_id: id, sueldo_base: emp?.sueldo_semanal || '' }));
    if (id) {
      const ap = await api.anticiposPendientes(id);
      setAnticPendiente(parseFloat(ap.total || 0));
      setFormPago(f => ({ ...f, anticipos_aplicados: ap.total || '0' }));
    }
  };

  const guardarPago = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearPago(formPago);
      setMsg('✓ Pago registrado en nómina');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const pagarNomina = async (id) => {
    await api.pagarNomina(id);
    cargar();
  };

  const guardarEmpleado = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearEmpleado(formEmp);
      setFormEmp({ nombre: '', puesto: '', area: 'Materiales', sueldo_semanal: '', telefono: '', fecha_ingreso: '' });
      setMsg('✓ Empleado registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const guardarAnticipo = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearAnticipo(formAnticipo);
      setFormAnticipo({ empleado_id: '', monto: '', fecha: hoy(), motivo: '' });
      setMsg('✓ Anticipo registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const totalCalc = () => {
    const base = parseFloat(formPago.sueldo_base||0);
    const bonos = parseFloat(formPago.bonos||0);
    const ded = parseFloat(formPago.deducciones||0);
    const ant = parseFloat(formPago.anticipos_aplicados||0);
    return base + bonos - ded - ant;
  };

  return (
    <div>
      <div className="page-header">
        <h2>Nómina Interna</h2>
        <p>Control de pagos, anticipos y empleados</p>
      </div>

      {/* Métricas */}
      {resumen && (
        <div className="metric-grid">
          <div className="metric"><div className="metric-label">Total nómina semana</div><div className="metric-value navy">{fmt(resumen.total_nomina)}</div></div>
          <div className="metric"><div className="metric-label">Pagado</div><div className="metric-value green">{fmt(resumen.pagado)}</div></div>
          <div className="metric"><div className="metric-label">Pendiente de pago</div><div className="metric-value orange">{fmt(resumen.pendiente)}</div></div>
          <div className="metric"><div className="metric-label">Empleados en nómina</div><div className="metric-value">{resumen.empleados_en_nomina || 0}</div></div>
        </div>
      )}

      {/* Selector de semana */}
      <div className="card" style={{ padding: '12px 20px' }}>
        <div className="flex-between">
          <span className="text-muted">Semana de inicio:</span>
          <input type="date" value={semana} onChange={e => setSemana(e.target.value)} style={{ width: 'auto', padding: '6px 10px' }} />
        </div>
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      <div className="tabs">
        {['resumen','pago','empleados','anticipos'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'resumen' ? 'Resumen' : t === 'pago' ? 'Registrar pago' : t === 'empleados' ? 'Empleados' : 'Anticipos'}
          </button>
        ))}
      </div>

      {/* RESUMEN */}
      {tab === 'resumen' && (
        <div className="card">
          <div className="card-title">Nómina — semana del {fmtDate(semana)}</div>
          {pagos.length === 0 ? <div className="empty">Sin pagos registrados esta semana</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Empleado</th><th>Área</th><th>Base</th><th>Bonos</th><th>Deduc.</th><th>Total</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                  {pagos.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.empleado_nombre}</td>
                      <td>{p.area}</td>
                      <td>{fmt(p.sueldo_base)}</td>
                      <td style={{ color: '#0F6E56' }}>{parseFloat(p.bonos) > 0 ? '+' + fmt(p.bonos) : '—'}</td>
                      <td style={{ color: '#A32D2D' }}>{parseFloat(p.deducciones) > 0 ? '-' + fmt(p.deducciones) : '—'}</td>
                      <td style={{ fontWeight: 600, color: '#1B3A6B' }}>{fmt(p.total_pago)}</td>
                      <td><span className={`badge ${p.pagado ? 'badge-green' : 'badge-amber'}`}>{p.pagado ? 'Pagado' : 'Pendiente'}</span></td>
                      <td>{!p.pagado && <button className="btn btn-sm btn-orange" onClick={() => pagarNomina(p.id)}>Pagar</button>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="5" style={{ fontWeight: 600, paddingTop: 12 }}>Total semana</td>
                    <td style={{ fontWeight: 700, color: '#1B3A6B', paddingTop: 12 }}>{fmt(pagos.reduce((a, p) => a + parseFloat(p.total_pago), 0))}</td>
                    <td colSpan="2"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* REGISTRAR PAGO */}
      {tab === 'pago' && (
        <div className="card">
          <div className="card-title">Registrar pago de nómina</div>
          <form onSubmit={guardarPago}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Empleado</label>
                <select value={formPago.empleado_id} onChange={e => onEmpChange(e.target.value)} required>
                  <option value="">Seleccionar...</option>
                  {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} — {e.puesto}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Semana inicio</label>
                <input type="date" value={formPago.semana_inicio} onChange={e => setFormPago({...formPago, semana_inicio: e.target.value})} required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Sueldo base ($)</label>
                <input type="number" placeholder="0" min="0" value={formPago.sueldo_base} onChange={e => setFormPago({...formPago, sueldo_base: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Bonos / Extras ($)</label>
                <input type="number" placeholder="0" min="0" value={formPago.bonos} onChange={e => setFormPago({...formPago, bonos: e.target.value})} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Deducciones ($)</label>
                <input type="number" placeholder="0" min="0" value={formPago.deducciones} onChange={e => setFormPago({...formPago, deducciones: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Anticipos a descontar ($) {anticPendiente > 0 && <span className="badge badge-amber" style={{ marginLeft: 4 }}>Pendiente: {fmt(anticPendiente)}</span>}</label>
                <input type="number" placeholder="0" min="0" value={formPago.anticipos_aplicados} onChange={e => setFormPago({...formPago, anticipos_aplicados: e.target.value})} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notas</label>
              <textarea placeholder="Observaciones del pago..." value={formPago.notas} onChange={e => setFormPago({...formPago, notas: e.target.value})} />
            </div>
            {/* Preview del pago */}
            <div style={{ background: '#F4F4F2', borderRadius: 8, padding: 14, marginBottom: 14, fontSize: 13 }}>
              <div className="flex-between" style={{ marginBottom: 4 }}><span>Sueldo base</span><span>{fmt(formPago.sueldo_base)}</span></div>
              <div className="flex-between" style={{ marginBottom: 4, color: '#0F6E56' }}><span>+ Bonos</span><span>+{fmt(formPago.bonos)}</span></div>
              <div className="flex-between" style={{ marginBottom: 4, color: '#A32D2D' }}><span>— Deducciones</span><span>-{fmt(formPago.deducciones)}</span></div>
              <div className="flex-between" style={{ marginBottom: 4, color: '#A32D2D' }}><span>— Anticipos</span><span>-{fmt(formPago.anticipos_aplicados)}</span></div>
              <hr className="divider" style={{ margin: '8px 0' }} />
              <div className="flex-between" style={{ fontWeight: 700, fontSize: 15 }}><span>Total a pagar</span><span style={{ color: '#1B3A6B' }}>{fmt(totalCalc())}</span></div>
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Registrando...' : 'Registrar en nómina'}
            </button>
          </form>
        </div>
      )}

      {/* EMPLEADOS */}
      {tab === 'empleados' && (
        <div>
          <div className="card">
            <div className="card-title">Empleados activos</div>
            {empleados.length === 0 ? <div className="empty">Sin empleados registrados</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nombre</th><th>Puesto</th><th>Área</th><th>Sueldo semanal</th><th>Teléfono</th></tr></thead>
                  <tbody>
                    {empleados.map(e => (
                      <tr key={e.id}>
                        <td style={{ fontWeight: 500 }}>{e.nombre}</td>
                        <td>{e.puesto}</td>
                        <td><span className="badge badge-blue">{e.area}</span></td>
                        <td style={{ fontWeight: 500, color: '#1B3A6B' }}>{fmt(e.sueldo_semanal)}</td>
                        <td>{e.telefono || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Agregar empleado</div>
            <form onSubmit={guardarEmpleado}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Nombre completo</label>
                  <input type="text" placeholder="Nombre" value={formEmp.nombre} onChange={e => setFormEmp({...formEmp, nombre: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Puesto</label>
                  <input type="text" placeholder="Ej. Vendedora, Operador..." value={formEmp.puesto} onChange={e => setFormEmp({...formEmp, puesto: e.target.value})} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Área</label>
                  <select value={formEmp.area} onChange={e => setFormEmp({...formEmp, area: e.target.value})}>
                    {AREAS.map(a => <option key={a}>{a}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Sueldo semanal ($)</label>
                  <input type="number" placeholder="0" min="0" value={formEmp.sueldo_semanal} onChange={e => setFormEmp({...formEmp, sueldo_semanal: e.target.value})} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input type="text" placeholder="777 000 0000" value={formEmp.telefono} onChange={e => setFormEmp({...formEmp, telefono: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de ingreso</label>
                  <input type="date" value={formEmp.fecha_ingreso} onChange={e => setFormEmp({...formEmp, fecha_ingreso: e.target.value})} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Agregar empleado</button>
            </form>
          </div>
        </div>
      )}

      {/* ANTICIPOS */}
      {tab === 'anticipos' && (
        <div>
          <div className="card">
            <div className="card-title">Anticipos pendientes</div>
            {anticipos.length === 0 ? <div className="empty">Sin anticipos pendientes</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Empleado</th><th>Fecha</th><th>Motivo</th><th className="text-right">Monto</th></tr></thead>
                  <tbody>
                    {anticipos.map(a => (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 500 }}>{a.empleado_nombre}</td>
                        <td>{fmtDate(a.fecha)}</td>
                        <td className="text-muted">{a.motivo || '—'}</td>
                        <td className="text-right fw-500" style={{ color: '#A32D2D' }}>{fmt(a.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Registrar anticipo</div>
            <form onSubmit={guardarAnticipo}>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Empleado</label>
                  <select value={formAnticipo.empleado_id} onChange={e => setFormAnticipo({...formAnticipo, empleado_id: e.target.value})} required>
                    <option value="">Seleccionar...</option>
                    {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha</label>
                  <input type="date" value={formAnticipo.fecha} onChange={e => setFormAnticipo({...formAnticipo, fecha: e.target.value})} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Monto ($)</label>
                <input type="number" placeholder="0" min="0" value={formAnticipo.monto} onChange={e => setFormAnticipo({...formAnticipo, monto: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Motivo</label>
                <textarea placeholder="Razón del anticipo..." value={formAnticipo.motivo} onChange={e => setFormAnticipo({...formAnticipo, motivo: e.target.value})} />
              </div>
              <button type="submit" className="btn btn-orange btn-block" disabled={loading}>Registrar anticipo</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
