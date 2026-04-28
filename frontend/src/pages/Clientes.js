import React, { useState, useEffect } from 'react';
import { api } from '../api';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtDate = d => { if (!d) return '—'; const p = d.split('T')[0].split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };
const TIPOS = { constructora: 'Constructora', ferreteria: 'Ferretería', publico_general: 'Público general', municipio: 'Municipio', otro: 'Otro' };
const TIPO_BADGE = { constructora: 'badge-red', ferreteria: 'badge-amber', publico_general: 'badge-blue', municipio: 'badge-green', otro: 'badge-gray' };

export default function Clientes() {
  const [tab, setTab] = useState('lista');
  const [clientes, setClientes] = useState([]);
  const [top, setTop] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [buscar, setBuscar] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ nombre: '', telefono: '', direccion: '', tipo: 'publico_general', notas: '' });

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    const [c, t] = await Promise.all([api.clientes(), api.topClientes()]);
    setClientes(c);
    setTop(t);
  };

  const verDetalle = async (id) => {
    const d = await api.detalleCliente(id);
    setSeleccionado(d);
    setTab('detalle');
  };

  const guardar = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.crearCliente(form);
      setForm({ nombre: '', telefono: '', direccion: '', tipo: 'publico_general', notas: '' });
      setMsg('✓ Cliente registrado');
      cargar();
      setTimeout(() => setMsg(''), 3000);
      setTab('lista');
    } catch (err) { setMsg('Error: ' + err.message); }
    finally { setLoading(false); }
  };

  const filtrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(buscar.toLowerCase()) ||
    (c.telefono || '').includes(buscar)
  );

  return (
    <div>
      <div className="page-header">
        <h2>Clientes</h2>
        <p>Registro y seguimiento de clientes de Grupo Andreu</p>
      </div>

      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Clientes registrados</div><div className="metric-value navy">{clientes.length}</div></div>
        <div className="metric"><div className="metric-label">Top cliente (30 días)</div><div className="metric-value navy" style={{ fontSize: 16 }}>{top[0]?.nombre?.split(' ').slice(0,2).join(' ') || '—'}</div></div>
        <div className="metric"><div className="metric-label">Venta top cliente</div><div className="metric-value green">{fmt(top[0]?.total || 0)}</div></div>
        <div className="metric"><div className="metric-label">Constructoras</div><div className="metric-value orange">{clientes.filter(c => c.tipo === 'constructora').length}</div></div>
      </div>

      <div className="tabs">
        {['lista', 'top', 'agregar', ...(seleccionado ? ['detalle'] : [])].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'lista' ? 'Todos' : t === 'top' ? 'Top clientes' : t === 'agregar' ? 'Agregar' : seleccionado?.nombre?.split(' ')[0]}
          </button>
        ))}
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓')?'green':'red'}`} style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      {tab === 'lista' && (
        <div className="card">
          <div className="card-header">
            <div className="card-title" style={{ margin: 0 }}>Directorio de clientes</div>
            <input type="text" placeholder="Buscar..." value={buscar} onChange={e => setBuscar(e.target.value)} style={{ width: 200, padding: '6px 10px' }} />
          </div>
          {filtrados.length === 0 ? <div className="empty">Sin clientes registrados</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Nombre</th><th>Tipo</th><th>Teléfono</th><th>Compras</th><th>Total comprado</th><th>Última compra</th><th></th></tr></thead>
                <tbody>
                  {filtrados.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 500 }}>{c.nombre}</td>
                      <td><span className={`badge ${TIPO_BADGE[c.tipo]}`}>{TIPOS[c.tipo]}</span></td>
                      <td className="text-muted">{c.telefono || '—'}</td>
                      <td>{c.num_compras}</td>
                      <td style={{ fontWeight: 500, color: '#1B3A6B' }}>{fmt(c.total_compras)}</td>
                      <td className="text-muted">{fmtDate(c.ultima_compra)}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => verDetalle(c.id)}>Ver</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'top' && (
        <div className="card">
          <div className="card-title">Top 10 clientes — últimos 30 días</div>
          {top.length === 0 ? <div className="empty">Sin datos de compras</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Cliente</th><th>Tipo</th><th>Compras</th><th>Total</th><th>Última visita</th></tr></thead>
                <tbody>
                  {top.map((c, i) => (
                    <tr key={i}>
                      <td><span style={{ fontWeight: 700, color: i === 0 ? '#E87722' : i === 1 ? '#888' : '#1B3A6B' }}>#{i+1}</span></td>
                      <td style={{ fontWeight: 500 }}>{c.nombre}</td>
                      <td><span className={`badge ${TIPO_BADGE[c.tipo]}`}>{TIPOS[c.tipo]}</span></td>
                      <td>{c.compras}</td>
                      <td style={{ fontWeight: 700, color: '#0F6E56' }}>{fmt(c.total)}</td>
                      <td className="text-muted">{fmtDate(c.ultima)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'agregar' && (
        <div className="card">
          <div className="card-title">Nuevo cliente</div>
          <form onSubmit={guardar}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nombre / Razón social</label>
                <input type="text" placeholder="Nombre del cliente" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} required />
              </div>
              <div className="form-group">
                <label className="form-label">Tipo</label>
                <select value={form.tipo} onChange={e => setForm({...form, tipo: e.target.value})}>
                  {Object.entries(TIPOS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Teléfono</label>
                <input type="text" placeholder="747 000 0000" value={form.telefono} onChange={e => setForm({...form, telefono: e.target.value})} />
              </div>
              <div className="form-group">
                <label className="form-label">Dirección / Comunidad</label>
                <input type="text" placeholder="Ej. Col. Centro, Chilapa" value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notas</label>
              <textarea placeholder="Condiciones especiales, crédito, referencias..." value={form.notas} onChange={e => setForm({...form, notas: e.target.value})} />
            </div>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>Registrar cliente</button>
          </form>
        </div>
      )}

      {tab === 'detalle' && seleccionado && (
        <div>
          <div className="card">
            <div className="card-header">
              <div>
                <div style={{ fontWeight: 600, fontSize: 18, color: '#1B3A6B' }}>{seleccionado.nombre}</div>
                <span className={`badge ${TIPO_BADGE[seleccionado.tipo]}`} style={{ marginTop: 4 }}>{TIPOS[seleccionado.tipo]}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 13, color: '#888' }}>
                {seleccionado.telefono && <div>📞 {seleccionado.telefono}</div>}
                {seleccionado.direccion && <div>📍 {seleccionado.direccion}</div>}
              </div>
            </div>
            <div className="metric-grid" style={{ marginTop: 12 }}>
              <div className="metric"><div className="metric-label">Total comprado</div><div className="metric-value green">{fmt(seleccionado.stats?.total_compras)}</div></div>
              <div className="metric"><div className="metric-label">Núm. compras</div><div className="metric-value navy">{seleccionado.stats?.num_compras}</div></div>
              <div className="metric"><div className="metric-label">Ticket promedio</div><div className="metric-value orange">{fmt(seleccionado.stats?.ticket_promedio)}</div></div>
              <div className="metric"><div className="metric-label">Primera compra</div><div className="metric-value" style={{ fontSize: 16 }}>{fmtDate(seleccionado.stats?.primera_compra)}</div></div>
            </div>
          </div>
          <div className="card">
            <div className="card-title">Historial de compras</div>
            {seleccionado.historial?.length === 0 ? <div className="empty">Sin compras registradas</div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Fecha</th><th>Producto</th><th>Pago</th><th className="text-right">Monto</th></tr></thead>
                  <tbody>
                    {seleccionado.historial?.map(v => (
                      <tr key={v.id}>
                        <td>{fmtDate(v.fecha)}</td>
                        <td>{v.producto}</td>
                        <td><span className="badge badge-blue">{v.tipo_pago}</span></td>
                        <td className="text-right fw-500" style={{ color: '#1B3A6B' }}>{fmt(v.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
