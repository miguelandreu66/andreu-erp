import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const fmt     = n  => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
const hoy     = () => new Date().toISOString().split('T')[0];
const fmtDate = d  => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const ITEM_OC = { inventario_id: '', descripcion: '', cantidad_pedida: '', precio_unitario: '', subtotal: 0 };

// ── Badge de estado OC ────────────────────────────────────────────
function BadgeOC({ estado }) {
  const map = {
    borrador:          'badge-gray',
    autorizada:        'badge-blue',
    recibida_parcial:  'badge-amber',
    recibida:          'badge-green',
    cancelada:         'badge-red',
  };
  const labels = {
    borrador: 'Borrador', autorizada: 'Autorizada',
    recibida_parcial: 'Parcial', recibida: 'Recibida', cancelada: 'Cancelada',
  };
  return <span className={`badge ${map[estado] || 'badge-gray'}`}>{labels[estado] || estado}</span>;
}

// ── Modal genérico ────────────────────────────────────────────────
const Overlay = ({ children, onClose }) => (
  <div style={ST.overlay} onClick={onClose}>
    <div style={ST.modal} onClick={e => e.stopPropagation()}>{children}</div>
  </div>
);

// ── Modal: Nueva Orden de Compra ──────────────────────────────────
function ModalNuevaOC({ proveedores, inventario, onCerrar, onGuardado }) {
  const [form, setForm]   = useState({ proveedor_id: '', fecha: hoy(), fecha_entrega_esperada: '', descuento: '', notas: '' });
  const [items, setItems] = useState([{ ...ITEM_OC }]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]     = useState('');

  const actualizarItem = (idx, campo, valor) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const upd = { ...it, [campo]: valor };
      if (campo === 'inventario_id') {
        const p = inventario.find(x => String(x.id) === String(valor));
        if (p) { upd.descripcion = p.producto; upd.precio_unitario = p.precio_unitario || ''; }
      }
      upd.subtotal = (parseFloat(upd.cantidad_pedida) || 0) * (parseFloat(upd.precio_unitario) || 0);
      return upd;
    }));
  };

  const subtotal = items.reduce((s, i) => s + (i.subtotal || 0), 0);
  const total    = subtotal - (parseFloat(form.descuento) || 0);

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.proveedor_id) { setMsg('Selecciona un proveedor'); return; }
    const validos = items.filter(i => i.descripcion && parseFloat(i.cantidad_pedida) > 0);
    if (!validos.length) { setMsg('Agrega al menos un producto'); return; }
    setLoading(true);
    try {
      await api.crearOrden({ ...form, items: validos.map(i => ({
        inventario_id: i.inventario_id || null,
        descripcion: i.descripcion,
        cantidad_pedida: parseFloat(i.cantidad_pedida),
        precio_unitario: parseFloat(i.precio_unitario) || 0,
      })) });
      onGuardado();
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Overlay onClose={onCerrar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#1B3A6B' }}>Nueva Orden de Compra</h3>
        <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
      </div>
      {msg && <div className="alert red" style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}
      <form onSubmit={guardar}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Proveedor *</label>
            <select value={form.proveedor_id} onChange={e => setForm({ ...form, proveedor_id: e.target.value })} required>
              <option value="">— Selecciona —</option>
              {proveedores.filter(p => p.activo).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Fecha OC</label>
            <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Entrega esperada</label>
            <input type="date" value={form.fecha_entrega_esperada} onChange={e => setForm({ ...form, fecha_entrega_esperada: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label">Descuento ($)</label>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={form.descuento} onChange={e => setForm({ ...form, descuento: e.target.value })} />
          </div>
        </div>

        {/* Líneas */}
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Productos</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItems(p => [...p, { ...ITEM_OC }])}>+ Línea</button>
          </div>
          {items.map((it, idx) => (
            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 6, marginBottom: 6, alignItems: 'start' }}>
              <div>
                <select value={it.inventario_id} onChange={e => actualizarItem(idx, 'inventario_id', e.target.value)} style={{ width: '100%', marginBottom: 3 }}>
                  <option value="">— Del catálogo (opc.) —</option>
                  {inventario.map(p => <option key={p.id} value={p.id}>{p.producto}</option>)}
                </select>
                <input type="text" placeholder="Descripción *" value={it.descripcion} onChange={e => actualizarItem(idx, 'descripcion', e.target.value)} style={{ width: '100%' }} required />
              </div>
              <input type="number" min="0.01" step="0.01" placeholder="Cant." value={it.cantidad_pedida} onChange={e => actualizarItem(idx, 'cantidad_pedida', e.target.value)} required />
              <input type="number" min="0" step="0.01" placeholder="Precio" value={it.precio_unitario} onChange={e => actualizarItem(idx, 'precio_unitario', e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setItems(p => p.filter((_,i) => i !== idx))} disabled={items.length === 1}>✕</button>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'right', borderTop: '2px solid #1B3A6B', paddingTop: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#666' }}>Subtotal: {fmt(subtotal)}</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#1B3A6B' }}>TOTAL: {fmt(total)}</div>
        </div>

        <div className="form-group">
          <label className="form-label">Notas</label>
          <textarea placeholder="Condiciones, referencias..." value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} rows={2}/>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
            {loading ? 'Guardando...' : 'Crear Orden de Compra'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// ── Modal: Recepción de mercancía ─────────────────────────────────
function ModalRecepcion({ orden, onCerrar, onGuardado }) {
  const [fecha,   setFecha]   = useState(hoy());
  const [notas,   setNotas]   = useState('');
  const [cantidades, setCants] = useState(
    orden.items.map(it => ({
      orden_detalle_id: it.id,
      descripcion: it.descripcion,
      pendiente: parseFloat(it.cantidad_pedida) - parseFloat(it.cantidad_recibida || 0),
      cantidad: String(parseFloat(it.cantidad_pedida) - parseFloat(it.cantidad_recibida || 0)),
    }))
  );
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const guardar = async (e) => {
    e.preventDefault();
    const items = cantidades.filter(c => parseFloat(c.cantidad) > 0).map(c => ({
      orden_detalle_id: c.orden_detalle_id,
      cantidad: parseFloat(c.cantidad),
    }));
    if (!items.length) { setMsg('Ingresa al menos una cantidad mayor a 0'); return; }
    setLoading(true);
    try {
      await api.recibirOrden(orden.id, { fecha, notas, items });
      onGuardado();
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Overlay onClose={onCerrar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: '#1B3A6B' }}>Recepción — {orden.folio}</h3>
        <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
      </div>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>{orden.proveedor_nombre}</div>
      {msg && <div className="alert red" style={{ marginBottom: 10 }}><div className="alert-dot"/><div>{msg}</div></div>}
      <form onSubmit={guardar}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Fecha de recepción</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Cantidades recibidas</div>
          {cantidades.map((c, idx) => (
            <div key={c.orden_detalle_id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{c.descripcion}</div>
                <div style={{ fontSize: 11, color: '#888' }}>Pendiente: {c.pendiente}</div>
              </div>
              <input type="number" min="0" step="0.01" max={c.pendiente}
                value={c.cantidad}
                onChange={e => setCants(prev => prev.map((x, i) => i === idx ? { ...x, cantidad: e.target.value } : x))} />
            </div>
          ))}
        </div>
        <div className="form-group">
          <label className="form-label">Notas (opcional)</label>
          <textarea placeholder="Observaciones de la recepción..." value={notas} onChange={e => setNotas(e.target.value)} rows={2}/>
        </div>
        <div style={{ background: '#fef3c7', borderRadius: 6, padding: 10, fontSize: 12, color: '#92400e', marginBottom: 12 }}>
          ⚡ Al confirmar: se sumará al inventario y se generará una Cuenta por Pagar.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
            {loading ? 'Procesando...' : 'Confirmar recepción'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// ── Modal: Pago a proveedor ───────────────────────────────────────
function ModalPago({ cuenta, onCerrar, onGuardado }) {
  const [form, setForm] = useState({ monto: '', tipo_pago: 'Transferencia', fecha: hoy(), referencia: '', notas: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const saldo = parseFloat(cuenta.saldo_pendiente) || parseFloat(cuenta.monto_total) - parseFloat(cuenta.monto_pagado);

  const guardar = async (e) => {
    e.preventDefault();
    if (parseFloat(form.monto) <= 0) { setMsg('Ingresa un monto válido'); return; }
    setLoading(true);
    try {
      await api.pagarProveedor(cuenta.id, { ...form, monto: parseFloat(form.monto) });
      onGuardado();
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Overlay onClose={onCerrar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#1B3A6B' }}>Registrar pago</h3>
        <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
      </div>
      <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 13 }}>
        <div><strong>Proveedor:</strong> {cuenta.proveedor_nombre}</div>
        <div><strong>Concepto:</strong> {cuenta.concepto}</div>
        <div><strong>Vence:</strong> {fmtDate(cuenta.fecha_vencimiento)}</div>
        <div style={{ fontWeight: 700, color: '#991b1b', marginTop: 6, fontSize: 15 }}>Saldo: {fmt(saldo)}</div>
      </div>
      {msg && <div className="alert red" style={{ marginBottom: 10 }}><div className="alert-dot"/><div>{msg}</div></div>}
      <form onSubmit={guardar}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Monto</label>
            <input type="number" min="0.01" step="0.01" max={saldo} placeholder={`Máx ${fmt(saldo)}`}
              value={form.monto} onChange={e => setForm({ ...form, monto: e.target.value })} required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Fecha</label>
            <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Forma de pago</label>
            <select value={form.tipo_pago} onChange={e => setForm({ ...form, tipo_pago: e.target.value })}>
              {['Transferencia','Efectivo','Cheque'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Referencia / Folio</label>
            <input type="text" placeholder="Núm. transferencia..." value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
            {loading ? 'Guardando...' : 'Registrar pago'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// ── Modal: Formulario de proveedor ────────────────────────────────
function ModalProveedor({ proveedor, onCerrar, onGuardado }) {
  const vacio = { nombre: '', contacto: '', telefono: '', email: '', rfc: '', productos: '', direccion: '', notas: '' };
  const [form, setForm] = useState(proveedor ? { ...vacio, ...proveedor } : vacio);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const campo = (k, label, tipo = 'text', ph = '') => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type={tipo} placeholder={ph} value={form[k] || ''} onChange={e => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );
  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre) { setMsg('El nombre es obligatorio'); return; }
    setLoading(true);
    try {
      proveedor ? await api.actualizarProveedor(proveedor.id, form) : await api.crearProveedor(form);
      onGuardado();
    } catch (err) { setMsg(err.message); }
    finally { setLoading(false); }
  };

  return (
    <Overlay onClose={onCerrar}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#1B3A6B' }}>{proveedor ? 'Editar' : 'Nuevo'} proveedor</h3>
        <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
      </div>
      {msg && <div className="alert red" style={{ marginBottom: 10 }}><div className="alert-dot"/><div>{msg}</div></div>}
      <form onSubmit={guardar}>
        {campo('nombre',    'Nombre / Razón social *', 'text', 'Cementos López SA...')}
        <div className="form-row">
          {campo('contacto', 'Nombre del contacto')}
          {campo('telefono', 'Teléfono', 'tel')}
        </div>
        <div className="form-row">
          {campo('rfc',   'RFC')}
          {campo('email', 'Email', 'email')}
        </div>
        {campo('productos', 'Productos que vende', 'text', 'Cemento, arena, varilla...')}
        {campo('direccion', 'Dirección')}
        <div className="form-group">
          <label className="form-label">Notas</label>
          <textarea value={form.notas || ''} onChange={e => setForm({ ...form, notas: e.target.value })} rows={2} placeholder="Condiciones de crédito, notas..." />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar proveedor'}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function Compras() {
  const [tab,         setTab]         = useState('ordenes');
  const [ordenes,     setOrdenes]     = useState([]);
  const [cxp,         setCxp]         = useState([]);
  const [resumenCxP,  setResumenCxP]  = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [inventario,  setInventario]  = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [msg,         setMsg]         = useState('');

  // Modales
  const [modalOC,    setModalOC]    = useState(false);
  const [modalRec,   setModalRec]   = useState(null);  // orden a recibir
  const [modalPago,  setModalPago]  = useState(null);  // cuenta a pagar
  const [modalProv,  setModalProv]  = useState(null);  // null=cerrado, {}=nuevo, {id,...}=editar

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState('');

  const mostrarMsg = (texto) => { setMsg(texto); setTimeout(() => setMsg(''), 4000); };

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = filtroEstado ? `?estado=${filtroEstado}` : '';
      const [o, c, r, p, inv] = await Promise.all([
        api.ordenesCompra(params),
        api.cuentasPagar(),
        api.resumenCxP(),
        api.proveedores(),
        api.inventario(),
      ]);
      setOrdenes(o); setCxp(c); setResumenCxP(r);
      setProveedores(p); setInventario(inv);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const autorizar = async (id) => {
    if (!window.confirm('¿Autorizar esta orden de compra?')) return;
    try { await api.autorizarOrden(id); mostrarMsg('Orden autorizada'); cargar(); }
    catch (e) { mostrarMsg(e.message); }
  };

  const cancelar = async (id) => {
    if (!window.confirm('¿Cancelar esta orden?')) return;
    try { await api.cancelarOrden(id); mostrarMsg('Orden cancelada'); cargar(); }
    catch (e) { mostrarMsg(e.message); }
  };

  const toggleProv = async (id) => {
    try { await api.toggleProveedor(id); cargar(); }
    catch (e) { mostrarMsg(e.message); }
  };

  const onGuardado = () => {
    setModalOC(false); setModalRec(null); setModalPago(null); setModalProv(null);
    mostrarMsg('Guardado correctamente');
    cargar();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Compras a Proveedores</h2>
        <p>Órdenes de compra, recepción de mercancía y cuentas por pagar</p>
      </div>

      {msg && <div className="alert green" style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      {/* Tarjetas CxP */}
      {resumenCxP && (
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">Total por pagar</div>
            <div className="metric-value navy">{fmt(resumenCxP.total_por_pagar)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Vencido</div>
            <div className="metric-value" style={{ color: '#991b1b' }}>{fmt(resumenCxP.vencido)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Por vencer</div>
            <div className="metric-value" style={{ color: '#065f46' }}>{fmt(resumenCxP.por_vencer)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">OC pendientes</div>
            <div className="metric-value">{ordenes.filter(o => !['recibida','cancelada'].includes(o.estado)).length}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {['ordenes','cuentas-pagar','proveedores'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'ordenes' ? 'Órdenes de Compra' : t === 'cuentas-pagar' ? 'Cuentas por Pagar' : 'Proveedores'}
          </button>
        ))}
      </div>

      {/* ── ÓRDENES DE COMPRA ── */}
      {tab === 'ordenes' && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Órdenes de Compra</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={{ width: 150 }}>
                <option value="">Todos los estados</option>
                <option value="borrador">Borrador</option>
                <option value="autorizada">Autorizada</option>
                <option value="recibida_parcial">Parcial</option>
                <option value="recibida">Recibida</option>
                <option value="cancelada">Cancelada</option>
              </select>
              <button className="btn btn-primary" onClick={() => setModalOC(true)}>+ Nueva OC</button>
            </div>
          </div>

          {loading ? <div className="empty">Cargando...</div> : ordenes.length === 0
            ? <div className="empty">Sin órdenes de compra</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Folio</th>
                      <th>Proveedor</th>
                      <th>Fecha</th>
                      <th>Entrega esp.</th>
                      <th>Estado</th>
                      <th className="text-right">Total</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenes.map(o => (
                      <tr key={o.id}>
                        <td style={{ fontWeight: 700, color: '#1B3A6B', whiteSpace: 'nowrap' }}>{o.folio}</td>
                        <td>
                          <div style={{ fontWeight: 500 }}>{o.proveedor_nombre}</div>
                          {(o.items || []).length > 0 && (
                            <div style={{ fontSize: 11, color: '#888' }}>
                              {o.items.map(i => i.descripcion).join(', ').slice(0, 50)}
                            </div>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.fecha)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.fecha_entrega_esperada)}</td>
                        <td><BadgeOC estado={o.estado} /></td>
                        <td className="text-right fw-500" style={{ color: '#1B3A6B' }}>{fmt(o.total)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {o.estado === 'borrador' && (
                              <button className="btn btn-primary btn-sm" onClick={() => autorizar(o.id)}>Autorizar</button>
                            )}
                            {['autorizada','recibida_parcial'].includes(o.estado) && (
                              <button className="btn btn-ghost btn-sm" onClick={() => setModalRec(o)}>Recibir</button>
                            )}
                            {!['recibida','cancelada'].includes(o.estado) && (
                              <button className="btn btn-ghost btn-sm" style={{ color: '#991b1b' }} onClick={() => cancelar(o.id)}>Cancelar</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── CUENTAS POR PAGAR ── */}
      {tab === 'cuentas-pagar' && (
        <div className="card">
          <div className="card-title">Cuentas por Pagar a Proveedores</div>
          {loading ? <div className="empty">Cargando...</div> : cxp.length === 0
            ? <div className="empty" style={{ color: '#065f46' }}>Sin cuentas pendientes</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Proveedor</th>
                      <th>Concepto</th>
                      <th>Emisión</th>
                      <th>Vencimiento</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Pagado</th>
                      <th className="text-right">Saldo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cxp.map(c => {
                      const saldo = parseFloat(c.monto_total) - parseFloat(c.monto_pagado);
                      const dias  = parseInt(c.dias_vencido) || 0;
                      const vencida = c.fecha_vencimiento && new Date(c.fecha_vencimiento) < new Date();
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 500 }}>{c.proveedor_nombre}</td>
                          <td style={{ fontSize: 12, color: '#555' }}>
                            {c.concepto}
                            {c.orden_folio && <div style={{ fontSize: 11, color: '#1B3A6B' }}>{c.orden_folio}</div>}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.fecha_emision)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div>{fmtDate(c.fecha_vencimiento)}</div>
                            {vencida && <span className="badge badge-red" style={{ fontSize: 10 }}>{dias} días venc.</span>}
                          </td>
                          <td className="text-right">{fmt(c.monto_total)}</td>
                          <td className="text-right" style={{ color: '#065f46' }}>{fmt(c.monto_pagado)}</td>
                          <td className="text-right fw-500" style={{ color: '#991b1b', fontSize: 15 }}>{fmt(saldo)}</td>
                          <td>
                            <button className="btn btn-primary btn-sm" onClick={() => setModalPago(c)}>
                              Pagar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="6" style={{ fontWeight: 600, paddingTop: 12 }}>Total pendiente</td>
                      <td className="text-right" style={{ fontWeight: 700, color: '#991b1b', paddingTop: 12, fontSize: 16 }}>
                        {fmt(cxp.reduce((s, c) => s + parseFloat(c.monto_total) - parseFloat(c.monto_pagado), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── PROVEEDORES ── */}
      {tab === 'proveedores' && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Catálogo de Proveedores</span>
            <button className="btn btn-primary" onClick={() => setModalProv({})}>+ Nuevo proveedor</button>
          </div>
          {loading ? <div className="empty">Cargando...</div> : proveedores.length === 0
            ? <div className="empty">Sin proveedores registrados</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th><th>Productos</th><th>Estado</th><th></th></tr>
                  </thead>
                  <tbody>
                    {proveedores.map(p => (
                      <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.5 }}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{p.nombre}</div>
                          {p.rfc && <div style={{ fontSize: 11, color: '#888' }}>RFC: {p.rfc}</div>}
                        </td>
                        <td>{p.contacto || '—'}</td>
                        <td>{p.telefono || '—'}</td>
                        <td style={{ fontSize: 12, color: '#555' }}>{p.productos || '—'}</td>
                        <td><span className={`badge ${p.activo ? 'badge-green' : 'badge-gray'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => setModalProv(p)}>Editar</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => toggleProv(p.id)}>
                              {p.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* Modales */}
      {modalOC   && <ModalNuevaOC   proveedores={proveedores} inventario={inventario} onCerrar={() => setModalOC(false)}   onGuardado={onGuardado} />}
      {modalRec  && <ModalRecepcion orden={modalRec}                                  onCerrar={() => setModalRec(null)}   onGuardado={onGuardado} />}
      {modalPago && <ModalPago      cuenta={modalPago}                                onCerrar={() => setModalPago(null)}  onGuardado={onGuardado} />}
      {modalProv !== null && <ModalProveedor proveedor={Object.keys(modalProv).length ? modalProv : null} onCerrar={() => setModalProv(null)} onGuardado={onGuardado} />}
    </div>
  );
}

const ST = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 },
  modal:   { background:'white', borderRadius:12, padding:24, width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' },
};
