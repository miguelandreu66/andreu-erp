import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

// ── Utilidades ──────────────────────────────────────────────────
const fmt    = n  => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
const hoy    = () => new Date().toISOString().split('T')[0];
const fmtDate = d => { if (!d) return ''; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const FOLIO  = () => `GA-${Date.now().toString().slice(-6)}`;

const ITEM_VACIO = { inventario_id: '', descripcion: '', cantidad: '', precio_unitario: '', subtotal: 0 };

// ── Logo SVG ─────────────────────────────────────────────────────
const LogoSVG = ({ size = 1 }) => (
  <svg width={180 * size} height={55 * size} viewBox="0 0 180 55">
    <rect x="4"  y="6"  width="18" height="18" fill="#1B3A6B" rx="3"/>
    <rect x="24" y="6"  width="18" height="18" fill="#C17D12" rx="3"/>
    <rect x="4"  y="26" width="18" height="18" fill="#C17D12" rx="3"/>
    <rect x="24" y="26" width="18" height="18" fill="#1B3A6B" rx="3"/>
    <text x="50" y="26" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="16" fill="#1B3A6B">GRUPO</text>
    <text x="50" y="45" fontFamily="Arial Black, Arial" fontWeight="900" fontSize="16" fill="#C17D12">ANDREU</text>
  </svg>
);

// ── Ticket HTML (abre en ventana nueva para imprimir) ─────────────
function abrirTicket(venta, cliente, folio) {
  const items = venta.items || [];
  const lineas = items.map(it => `
    <tr>
      <td>${it.descripcion}</td>
      <td style="text-align:center">${parseFloat(it.cantidad).toLocaleString('es-MX')}</td>
      <td style="text-align:right">$${parseFloat(it.precio_unitario).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
      <td style="text-align:right">$${parseFloat(it.subtotal).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Nota ${folio}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 20px; max-width: 400px; margin: auto; }
    .logo-wrap { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .empresa h1 { font-size: 18px; font-weight: 900; color: #1B3A6B; line-height: 1; }
    .empresa h2 { font-size: 10px; color: #C17D12; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
    .empresa p  { font-size: 9px; color: #666; }
    hr { border: none; border-top: 2px solid #1B3A6B; margin: 8px 0; }
    hr.thin { border-top: 1px dashed #ccc; }
    .folio { font-size: 14px; font-weight: 700; color: #1B3A6B; text-align: right; }
    .info-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 8px 0; }
    .info-grid span:nth-child(odd) { font-weight: 600; color: #555; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    thead th { background: #1B3A6B; color: white; padding: 4px 6px; text-align: left; font-size: 11px; }
    tbody td { padding: 4px 6px; border-bottom: 1px solid #eee; font-size: 11px; vertical-align: top; }
    .totales { margin-top: 8px; text-align: right; }
    .totales p { margin: 2px 0; }
    .totales .grand { font-size: 16px; font-weight: 900; color: #1B3A6B; }
    .badge { display:inline-block; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }
    .badge-contado { background: #d1fae5; color: #065f46; }
    .badge-credito  { background: #fee2e2; color: #991b1b; }
    .pie { text-align: center; font-size: 10px; color: #999; margin-top: 14px; }
    @media print {
      body { padding: 0; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="logo-wrap">
    <svg width="44" height="44" viewBox="0 0 44 44">
      <rect x="2" y="2" width="18" height="18" fill="#1B3A6B" rx="3"/>
      <rect x="24" y="2" width="18" height="18" fill="#C17D12" rx="3"/>
      <rect x="2" y="24" width="18" height="18" fill="#C17D12" rx="3"/>
      <rect x="24" y="24" width="18" height="18" fill="#1B3A6B" rx="3"/>
    </svg>
    <div class="empresa">
      <h1>GRUPO ANDREU</h1>
      <h2>Materiales · Transporte</h2>
      <p>Chilapa, Guerrero</p>
    </div>
    <div style="flex:1; text-align:right">
      <div class="folio">${folio}</div>
      <div style="font-size:10px;color:#666">Nota de remisión</div>
    </div>
  </div>
  <hr/>
  <div class="info-grid">
    <span>Fecha:</span>     <span>${fmtDate(venta.fecha)}</span>
    <span>Cliente:</span>   <span>${cliente || 'Público general'}</span>
    <span>Pago:</span>      <span>${venta.tipo_pago}</span>
    <span>Crédito:</span>   <span class="badge ${venta.tipo_venta === 'credito' ? 'badge-credito' : 'badge-contado'}">
                              ${venta.tipo_venta === 'credito' ? 'Crédito' : 'Contado'}
                            </span>
    ${venta.tipo_venta === 'credito' && venta.fecha_vencimiento
      ? `<span>Vence:</span><span>${fmtDate(venta.fecha_vencimiento)}</span>` : ''}
    ${venta.notas ? `<span>Notas:</span><span>${venta.notas}</span>` : ''}
  </div>
  <hr class="thin"/>
  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">Precio</th>
        <th style="text-align:right">Importe</th>
      </tr>
    </thead>
    <tbody>${lineas}</tbody>
  </table>
  <hr class="thin"/>
  <div class="totales">
    <p>Subtotal: $${parseFloat(venta.subtotal||venta.monto).toLocaleString('es-MX',{minimumFractionDigits:2})}</p>
    ${parseFloat(venta.descuento) > 0
      ? `<p>Descuento: -$${parseFloat(venta.descuento).toLocaleString('es-MX',{minimumFractionDigits:2})}</p>` : ''}
    <p class="grand">TOTAL: $${parseFloat(venta.total||venta.monto).toLocaleString('es-MX',{minimumFractionDigits:2})}</p>
  </div>
  <hr/>
  <div class="pie">Gracias por su preferencia — grupoandreu.mx</div>
  <br/>
  <button onclick="window.print()" style="width:100%;padding:10px;background:#1B3A6B;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
    Imprimir / Guardar PDF
  </button>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=480,height=700');
  win.document.write(html);
  win.document.close();
}

// ══════════════════════════════════════════════════════════════════
export default function Caja() {
  const [tab,       setTab]       = useState('registrar');
  const [productos, setProductos] = useState([]);
  const [clientes,  setClientes]  = useState([]);
  const [ventas,    setVentas]    = useState([]);
  const [resumen,   setResumen]   = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [msg,       setMsg]       = useState({ texto: '', tipo: '' });

  // Formulario cabecera
  const [form, setForm] = useState({
    fecha: hoy(), cliente_id: '', tipo_pago: 'Efectivo',
    tipo_venta: 'contado', descuento: '', notas: '', fecha_vencimiento: ''
  });
  // Líneas de producto
  const [items, setItems] = useState([{ ...ITEM_VACIO }]);

  // Filtros historial
  const [filtros, setFiltros] = useState({ fecha_inicio: '', fecha_fin: '', estado_pago: '' });

  const cargar = useCallback(async () => {
    const [inv, cli, v, r] = await Promise.all([
      api.inventario(),
      api.clientes(),
      api.ventas(),
      api.resumenDia(hoy())
    ]);
    setProductos(inv);
    setClientes(cli);
    setVentas(v);
    setResumen(r);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const mostrarMsg = (texto, tipo = 'ok') => {
    setMsg({ texto, tipo });
    setTimeout(() => setMsg({ texto: '', tipo: '' }), 4000);
  };

  // ── Manejo de líneas ──
  const agregarItem = () => setItems(prev => [...prev, { ...ITEM_VACIO }]);

  const quitarItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const actualizarItem = (idx, campo, valor) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const upd = { ...it, [campo]: valor };
      if (campo === 'inventario_id') {
        const prod = productos.find(p => String(p.id) === String(valor));
        if (prod) {
          upd.descripcion     = prod.producto;
          upd.precio_unitario = prod.precio_unitario || '';
        }
      }
      upd.subtotal = (parseFloat(upd.cantidad) || 0) * (parseFloat(upd.precio_unitario) || 0);
      return upd;
    }));
  };

  const subtotalGeneral = items.reduce((s, it) => s + (it.subtotal || 0), 0);
  const descuento        = parseFloat(form.descuento) || 0;
  const totalGeneral     = subtotalGeneral - descuento;

  // ── Guardar venta ──
  const guardar = async (e) => {
    e.preventDefault();
    const itemsValidos = items.filter(it => it.descripcion && parseFloat(it.cantidad) > 0 && parseFloat(it.precio_unitario) >= 0);
    if (itemsValidos.length === 0) { mostrarMsg('Agrega al menos un producto con cantidad y precio', 'error'); return; }
    if (totalGeneral <= 0)         { mostrarMsg('El total debe ser mayor a $0', 'error'); return; }

    setLoading(true);
    try {
      const payload = {
        ...form,
        cliente_id:  form.cliente_id || null,
        descuento:   descuento,
        items: itemsValidos.map(it => ({
          inventario_id:  it.inventario_id || null,
          descripcion:    it.descripcion,
          cantidad:       parseFloat(it.cantidad),
          precio_unitario: parseFloat(it.precio_unitario)
        }))
      };
      const venta = await api.crearVenta(payload);
      const cli   = clientes.find(c => String(c.id) === String(form.cliente_id));

      // Abrir ticket en nueva ventana
      abrirTicket(venta, cli?.nombre, FOLIO());

      // Reset formulario
      setForm({ fecha: hoy(), cliente_id: '', tipo_pago: 'Efectivo', tipo_venta: 'contado', descuento: '', notas: '', fecha_vencimiento: '' });
      setItems([{ ...ITEM_VACIO }]);
      mostrarMsg('Venta registrada correctamente');
      cargar();
    } catch (err) {
      mostrarMsg(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ── Eliminar venta ──
  const eliminar = async (id) => {
    if (!window.confirm('¿Eliminar esta venta? Se restaurará el inventario.')) return;
    try {
      await api.eliminarVenta(id);
      mostrarMsg('Venta eliminada');
      cargar();
    } catch (err) {
      mostrarMsg(err.message, 'error');
    }
  };

  // ── Cargar historial con filtros ──
  const buscarHistorial = async () => {
    const p = new URLSearchParams();
    if (filtros.fecha_inicio) p.append('fecha_inicio', filtros.fecha_inicio);
    if (filtros.fecha_fin)    p.append('fecha_fin',    filtros.fecha_fin);
    if (filtros.estado_pago)  p.append('estado_pago',  filtros.estado_pago);
    const v = await api.ventas(p.toString() ? '?' + p : '');
    setVentas(v);
  };

  const reimprimir = async (id) => {
    try {
      const venta = await api.detalleVenta(id);
      const cli   = clientes.find(c => c.id === venta.cliente_id);
      abrirTicket(venta, cli?.nombre || venta.cliente_nombre, FOLIO());
    } catch (err) {
      mostrarMsg('No se pudo cargar el ticket', 'error');
    }
  };

  const totalHoy = parseFloat(resumen?.totales?.total) || 0;

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <LogoSVG size={0.7} />
          <div>
            <h2 style={{ margin: 0 }}>Caja y Ventas</h2>
            <p style={{ margin: 0 }}>Registro de ventas — Chilapa</p>
          </div>
        </div>
      </div>

      {/* Métricas del día */}
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">Total hoy</div>
          <div className="metric-value navy">{fmt(totalHoy)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Operaciones</div>
          <div className="metric-value">{resumen?.totales?.ops || 0}</div>
        </div>
        {resumen?.por_producto?.slice(0, 4).map(p => (
          <div key={p.producto} className="metric">
            <div className="metric-label">{p.producto}</div>
            <div className="metric-value navy" style={{ fontSize: 18 }}>{fmt(p.total)}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {['registrar','historial'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'registrar' ? 'Nueva venta' : 'Historial'}
          </button>
        ))}
      </div>

      {/* ── FORMULARIO DE VENTA ── */}
      {tab === 'registrar' && (
        <form onSubmit={guardar}>
          {msg.texto && (
            <div className={`alert ${msg.tipo === 'error' ? 'red' : 'green'}`} style={{ marginBottom: 12 }}>
              <div className="alert-dot"/><div>{msg.texto}</div>
            </div>
          )}

          {/* Cabecera */}
          <div className="card">
            <div className="card-title">Datos de la venta</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fecha</label>
                <input type="date" value={form.fecha}
                  onChange={e => setForm({ ...form, fecha: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Cliente</label>
                <select value={form.cliente_id}
                  onChange={e => setForm({ ...form, cliente_id: e.target.value })}>
                  <option value="">— Público general —</option>
                  {clientes.filter(c => c.activo).map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Forma de pago</label>
                <select value={form.tipo_pago}
                  onChange={e => setForm({ ...form, tipo_pago: e.target.value })}>
                  {['Efectivo','Transferencia','Cheque'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tipo de venta</label>
                <select value={form.tipo_venta}
                  onChange={e => setForm({ ...form, tipo_venta: e.target.value })}>
                  <option value="contado">Contado</option>
                  <option value="credito">Crédito</option>
                </select>
              </div>
            </div>
            {form.tipo_venta === 'credito' && (
              <div className="form-group">
                <label className="form-label">Fecha de vencimiento del crédito</label>
                <input type="date" value={form.fecha_vencimiento}
                  onChange={e => setForm({ ...form, fecha_vencimiento: e.target.value })} />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Notas (opcional)</label>
              <textarea placeholder="Observaciones, destino, referencia..." value={form.notas}
                onChange={e => setForm({ ...form, notas: e.target.value })} />
            </div>
          </div>

          {/* Líneas de productos */}
          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Productos</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={agregarItem}>+ Agregar línea</button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '35%' }}>Producto</th>
                    <th style={{ width: '18%' }}>Cantidad</th>
                    <th style={{ width: '20%' }}>Precio unit.</th>
                    <th className="text-right" style={{ width: '20%' }}>Importe</th>
                    <th style={{ width: '7%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      {/* Selector de producto del catálogo o texto libre */}
                      <td>
                        <select
                          value={it.inventario_id}
                          onChange={e => actualizarItem(idx, 'inventario_id', e.target.value)}
                          style={{ marginBottom: 4, width: '100%' }}
                        >
                          <option value="">— Otro (escribe abajo) —</option>
                          {productos.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.producto} ({p.existencia} {p.unidad} disp.)
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Descripción del producto"
                          value={it.descripcion}
                          onChange={e => actualizarItem(idx, 'descripcion', e.target.value)}
                          style={{ width: '100%' }}
                          required
                        />
                      </td>
                      <td>
                        <input type="number" min="0.01" step="0.01" placeholder="0"
                          value={it.cantidad}
                          onChange={e => actualizarItem(idx, 'cantidad', e.target.value)}
                          required />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" placeholder="0.00"
                          value={it.precio_unitario}
                          onChange={e => actualizarItem(idx, 'precio_unitario', e.target.value)}
                          required />
                      </td>
                      <td className="text-right fw-500" style={{ color: '#1B3A6B', whiteSpace: 'nowrap' }}>
                        {fmt(it.subtotal)}
                      </td>
                      <td>
                        {items.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => quitarItem(idx)} title="Eliminar línea">✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totales */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, marginTop: 12 }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <span className="text-muted">Subtotal:</span>
                <span style={{ fontWeight: 600, minWidth: 100, textAlign: 'right' }}>{fmt(subtotalGeneral)}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <label className="text-muted">Descuento ($):</label>
                <input type="number" min="0" step="0.01" placeholder="0.00"
                  value={form.descuento}
                  onChange={e => setForm({ ...form, descuento: e.target.value })}
                  style={{ width: 100, textAlign: 'right' }} />
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', borderTop: '2px solid #1B3A6B', paddingTop: 6 }}>
                <span style={{ fontWeight: 700 }}>TOTAL:</span>
                <span style={{ fontWeight: 800, fontSize: 22, color: '#1B3A6B', minWidth: 100, textAlign: 'right' }}>{fmt(totalGeneral)}</span>
              </div>
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginBottom: 24 }}>
            {loading ? 'Registrando...' : 'Registrar venta e imprimir ticket'}
          </button>
        </form>
      )}

      {/* ── HISTORIAL ── */}
      {tab === 'historial' && (
        <div className="card">
          <div className="card-title">Historial de ventas</div>

          {/* Filtros */}
          <div className="form-row" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label className="form-label">Desde</label>
              <input type="date" value={filtros.fecha_inicio}
                onChange={e => setFiltros({ ...filtros, fecha_inicio: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Hasta</label>
              <input type="date" value={filtros.fecha_fin}
                onChange={e => setFiltros({ ...filtros, fecha_fin: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Estado</label>
              <select value={filtros.estado_pago}
                onChange={e => setFiltros({ ...filtros, estado_pago: e.target.value })}>
                <option value="">Todos</option>
                <option value="pagado">Pagado</option>
                <option value="parcial">Parcial</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
            <div className="form-group" style={{ justifyContent: 'flex-end', display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary" onClick={buscarHistorial}>Buscar</button>
            </div>
          </div>

          {ventas.length === 0
            ? <div className="empty">Sin ventas registradas</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Productos</th>
                      <th>Pago</th>
                      <th>Estado</th>
                      <th className="text-right">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ventas.map(v => (
                      <tr key={v.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(v.fecha)}</td>
                        <td>{v.cliente_nombre || <span className="text-muted">Público gral.</span>}</td>
                        <td style={{ fontSize: 12, color: '#555' }}>
                          {(v.items || []).map(i => `${i.descripcion} ×${parseFloat(i.cantidad)}`).join(', ') || v.producto}
                        </td>
                        <td><span className="badge badge-blue">{v.tipo_pago}</span></td>
                        <td>
                          <span className={`badge ${
                            v.estado_pago === 'pagado'   ? 'badge-green' :
                            v.estado_pago === 'parcial'  ? 'badge-amber' : 'badge-red'
                          }`}>
                            {v.estado_pago || 'pagado'}
                          </span>
                        </td>
                        <td className="text-right fw-500" style={{ color: '#1B3A6B', whiteSpace: 'nowrap' }}>
                          {fmt(v.total_calc || v.monto)}
                        </td>
                        <td style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => reimprimir(v.id)} title="Reimprimir ticket">🖨</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => eliminar(v.id)} title="Eliminar">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5" style={{ fontWeight: 600, paddingTop: 12 }}>Total mostrado</td>
                      <td className="text-right" style={{ fontWeight: 700, color: '#1B3A6B', paddingTop: 12 }}>
                        {fmt(ventas.reduce((s, v) => s + parseFloat(v.total_calc || v.monto || 0), 0))}
                      </td>
                      <td></td>
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
