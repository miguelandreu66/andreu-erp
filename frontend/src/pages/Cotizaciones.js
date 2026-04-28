import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

// ── Utilidades ────────────────────────────────────────────────────
const fmt     = n  => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
const hoy     = () => new Date().toISOString().split('T')[0];
const en30    = () => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]; };
const fmtDate = d  => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

const ITEM_VACIO = { inventario_id: '', descripcion: '', cantidad: '1', precio_unitario: '', subtotal: 0 };

const ESTADOS = {
  borrador:   { label: 'Borrador',   cls: 'badge-gray'  },
  enviada:    { label: 'Enviada',    cls: 'badge-blue'  },
  aceptada:   { label: 'Aceptada',  cls: 'badge-green' },
  rechazada:  { label: 'Rechazada', cls: 'badge-red'   },
  convertida: { label: 'Convertida',cls: 'badge'       },
};

// ── PDF de Cotización (ventana nueva) ─────────────────────────────
function abrirPDF(cot) {
  const fmtN = n => '$' + (parseFloat(n)||0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
  const items = cot.items || [];
  const lineas = items.map(it => `
    <tr>
      <td>${it.descripcion}</td>
      <td style="text-align:center">${parseFloat(it.cantidad).toLocaleString('es-MX')}</td>
      <td style="text-align:right">${fmtN(it.precio_unitario)}</td>
      <td style="text-align:right">${fmtN(it.subtotal)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cotización ${cot.folio}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 28px; max-width: 720px; margin: auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .logo-empresa { display: flex; gap: 14px; align-items: center; }
    .empresa h1 { font-size: 20px; font-weight: 900; color: #1B3A6B; line-height: 1; }
    .empresa h2 { font-size: 10px; color: #C17D12; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-top: 2px; }
    .empresa p  { font-size: 10px; color: #666; margin-top: 2px; }
    .doc-info { text-align: right; }
    .doc-info .titulo { font-size: 22px; font-weight: 900; color: #1B3A6B; }
    .doc-info .folio  { font-size: 14px; font-weight: 700; color: #C17D12; margin-top: 2px; }
    .doc-info p { font-size: 10px; color: #666; margin-top: 2px; }
    hr { border: none; border-top: 3px solid #1B3A6B; margin: 12px 0 16px; }
    hr.thin { border-top: 1px solid #e5e7eb; margin: 10px 0; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .info-box { background: #f8f9fa; border-radius: 6px; padding: 12px; }
    .info-box h3 { font-size: 10px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .info-box p  { font-size: 12px; margin: 2px 0; }
    .info-box strong { color: #1B3A6B; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    thead th { background: #1B3A6B; color: white; padding: 7px 10px; text-align: left; font-size: 11px; }
    tbody td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; font-size: 11px; vertical-align: top; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .totales { margin-top: 12px; display: flex; justify-content: flex-end; }
    .totales-box { width: 260px; }
    .totales-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
    .totales-row.grand { border-top: 2px solid #1B3A6B; margin-top: 6px; padding-top: 8px; font-size: 16px; font-weight: 900; color: #1B3A6B; }
    .notas-box { margin-top: 16px; padding: 12px; background: #fffbeb; border-left: 4px solid #C17D12; border-radius: 0 6px 6px 0; }
    .notas-box h3 { font-size: 10px; font-weight: 700; color: #C17D12; text-transform: uppercase; margin-bottom: 4px; }
    .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; }
    .firma-linea { border-top: 1px solid #666; padding-top: 6px; text-align: center; font-size: 11px; color: #666; }
    .pie { text-align: center; font-size: 10px; color: #aaa; margin-top: 24px; }
    .badge-estado { display:inline-block; padding:3px 10px; border-radius:20px; font-size:10px; font-weight:700;
      background:${cot.estado==='aceptada'?'#d1fae5':cot.estado==='rechazada'?'#fee2e2':'#e0e7ff'};
      color:${cot.estado==='aceptada'?'#065f46':cot.estado==='rechazada'?'#991b1b':'#3730a3'}; }
    @media print { body { padding: 16px; } button { display: none !important; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-empresa">
      <svg width="52" height="52" viewBox="0 0 44 44">
        <rect x="2"  y="2"  width="18" height="18" fill="#1B3A6B" rx="3"/>
        <rect x="24" y="2"  width="18" height="18" fill="#C17D12" rx="3"/>
        <rect x="2"  y="24" width="18" height="18" fill="#C17D12" rx="3"/>
        <rect x="24" y="24" width="18" height="18" fill="#1B3A6B" rx="3"/>
      </svg>
      <div class="empresa">
        <h1>GRUPO ANDREU</h1>
        <h2>Materiales · Transporte</h2>
        <p>Chilapa, Guerrero</p>
        <p>grupoandreu.mx</p>
      </div>
    </div>
    <div class="doc-info">
      <div class="titulo">COTIZACIÓN</div>
      <div class="folio">${cot.folio}</div>
      <p>Fecha: ${fmtDate(cot.fecha)}</p>
      <p>Válida hasta: <strong>${fmtDate(cot.fecha_vencimiento)}</strong></p>
      <p style="margin-top:6px"><span class="badge-estado">${ESTADOS[cot.estado]?.label || cot.estado}</span></p>
    </div>
  </div>
  <hr/>

  <div class="two-col">
    <div class="info-box">
      <h3>Cliente</h3>
      <p><strong>${cot.cliente_nombre || 'Público general'}</strong></p>
      ${cot.cliente_telefono ? `<p>Tel: ${cot.cliente_telefono}</p>` : ''}
    </div>
    <div class="info-box">
      <h3>Vendedor</h3>
      <p>${cot.creado_nombre || '—'}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:50%">Descripción</th>
        <th style="text-align:center;width:12%">Cant.</th>
        <th style="text-align:right;width:19%">Precio unit.</th>
        <th style="text-align:right;width:19%">Importe</th>
      </tr>
    </thead>
    <tbody>${lineas}</tbody>
  </table>

  <hr class="thin"/>
  <div class="totales">
    <div class="totales-box">
      <div class="totales-row"><span>Subtotal</span><span>${fmtN(cot.subtotal)}</span></div>
      ${parseFloat(cot.descuento) > 0
        ? `<div class="totales-row" style="color:#dc2626"><span>Descuento</span><span>-${fmtN(cot.descuento)}</span></div>` : ''}
      <div class="totales-row grand"><span>TOTAL</span><span>${fmtN(cot.total)}</span></div>
    </div>
  </div>

  ${cot.condiciones ? `
  <div class="notas-box">
    <h3>Condiciones de pago / entrega</h3>
    <p style="font-size:11px;color:#555">${cot.condiciones}</p>
  </div>` : ''}

  ${cot.notas ? `
  <div class="notas-box" style="background:#f0f9ff;border-color:#1B3A6B;margin-top:8px">
    <h3 style="color:#1B3A6B">Notas adicionales</h3>
    <p style="font-size:11px;color:#555">${cot.notas}</p>
  </div>` : ''}

  <div class="firmas">
    <div class="firma-linea">Autorizado por<br/><strong>Grupo Andreu</strong></div>
    <div class="firma-linea">Aceptado por<br/><strong>${cot.cliente_nombre || 'Cliente'}</strong></div>
  </div>

  <div class="pie">
    Esta cotización es válida hasta ${fmtDate(cot.fecha_vencimiento)} · Grupo Andreu · Chilapa, Guerrero
  </div>

  <br/>
  <button onclick="window.print()"
    style="width:100%;padding:10px;background:#1B3A6B;color:white;border:none;border-radius:6px;font-size:14px;cursor:pointer;">
    🖨 Imprimir / Guardar PDF
  </button>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=700');
  win.document.write(html);
  win.document.close();
}

// ── Modal: Convertir a venta ──────────────────────────────────────
function ModalConvertir({ cot, onCerrar, onConvertido }) {
  const [form, setForm]   = useState({ tipo_pago: 'Efectivo', tipo_venta: 'contado', fecha_vencimiento_venta: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]     = useState('');

  const guardar = async (e) => {
    e.preventDefault();
    if (form.tipo_venta === 'credito' && !form.fecha_vencimiento_venta) {
      setMsg('Indica la fecha de vencimiento del crédito'); return;
    }
    setLoading(true);
    try {
      const r = await api.convertirCotizacion(cot.id, form);
      onConvertido(r.venta_id);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={estilos.overlay} onClick={onCerrar}>
      <div style={estilos.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16 }}>
          <h3 style={{ margin:0, color:'#1B3A6B' }}>Convertir a venta</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
        </div>
        <div style={{ background:'#f0fdf4', borderRadius:8, padding:12, marginBottom:16, fontSize:13 }}>
          <div><strong>{cot.folio}</strong> — {cot.cliente_nombre}</div>
          <div style={{ fontSize:15, fontWeight:700, color:'#1B3A6B', marginTop:4 }}>
            Total: {fmt(cot.total)}
          </div>
        </div>
        {msg && <div className="alert red" style={{ marginBottom:12 }}><div className="alert-dot"/><div>{msg}</div></div>}
        <form onSubmit={guardar}>
          <div className="form-group">
            <label className="form-label">Tipo de venta</label>
            <select value={form.tipo_venta} onChange={e => setForm({ ...form, tipo_venta: e.target.value })}>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Forma de pago</label>
            <select value={form.tipo_pago} onChange={e => setForm({ ...form, tipo_pago: e.target.value })}>
              {['Efectivo','Transferencia','Cheque','Tarjeta'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          {form.tipo_venta === 'credito' && (
            <div className="form-group">
              <label className="form-label">Fecha de vencimiento del crédito</label>
              <input type="date" value={form.fecha_vencimiento_venta}
                onChange={e => setForm({ ...form, fecha_vencimiento_venta: e.target.value })} required />
            </div>
          )}
          <div style={{ display:'flex', gap:8, marginTop:16 }}>
            <button type="button" className="btn btn-ghost" style={{ flex:1 }} onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" style={{ flex:2 }} disabled={loading}>
              {loading ? 'Convirtiendo...' : '✅ Confirmar — crear venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Formulario nueva cotización ───────────────────────────────────
function FormCotizacion({ inventario, clientes, onGuardado, onCancelar }) {
  const [items, setItems]       = useState([{ ...ITEM_VACIO }]);
  const [clienteId, setClienteId]   = useState('');
  const [clienteLibre, setClienteLibre] = useState('');
  const [descuento, setDescuento]   = useState('');
  const [vencimiento, setVencimiento] = useState(en30());
  const [notas, setNotas]           = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [loading, setLoading]       = useState(false);
  const [msg, setMsg]               = useState('');

  const setItem = (i, field, val) => {
    const copia = [...items];
    copia[i] = { ...copia[i], [field]: val };
    if (field === 'cantidad' || field === 'precio_unitario') {
      const qty = parseFloat(field === 'cantidad' ? val : copia[i].cantidad) || 0;
      const pu  = parseFloat(field === 'precio_unitario' ? val : copia[i].precio_unitario) || 0;
      copia[i].subtotal = qty * pu;
    }
    if (field === 'inventario_id' && val) {
      const inv = inventario.find(p => String(p.id) === String(val));
      if (inv) {
        copia[i].descripcion      = inv.producto;
        copia[i].precio_unitario  = inv.precio_unitario || '';
        const qty = parseFloat(copia[i].cantidad) || 1;
        copia[i].subtotal = qty * (parseFloat(inv.precio_unitario) || 0);
      }
    }
    setItems(copia);
  };

  const subtotal = items.reduce((s, it) => s + (it.subtotal || 0), 0);
  const desc     = parseFloat(descuento) || 0;
  const total    = subtotal - desc;

  const guardar = async (e) => {
    e.preventDefault();
    const itemsValidos = items.filter(it => it.descripcion && parseFloat(it.cantidad) > 0 && parseFloat(it.precio_unitario) >= 0);
    if (itemsValidos.length === 0) { setMsg('Agrega al menos un producto con descripción y cantidad'); return; }
    setLoading(true);
    try {
      const r = await api.crearCotizacion({
        cliente_id: clienteId || null,
        cliente_nombre_libre: !clienteId ? clienteLibre : null,
        items: itemsValidos,
        fecha_vencimiento: vencimiento,
        descuento: desc,
        notas, condiciones,
      });
      onGuardado(r);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={guardar}>
      {msg && <div className="alert red" style={{ marginBottom:12 }}><div className="alert-dot"/><div>{msg}</div></div>}

      {/* Cliente */}
      <div className="card">
        <div className="card-title">Datos del cliente</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cliente (catálogo)</label>
            <select value={clienteId} onChange={e => { setClienteId(e.target.value); if (e.target.value) setClienteLibre(''); }}>
              <option value="">— Sin cliente / escribir abajo —</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          {!clienteId && (
            <div className="form-group">
              <label className="form-label">Nombre del cliente (libre)</label>
              <input type="text" placeholder="Nombre del cliente o empresa"
                value={clienteLibre} onChange={e => setClienteLibre(e.target.value)} />
            </div>
          )}
          <div className="form-group">
            <label className="form-label">Cotización válida hasta</label>
            <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="card">
        <div className="card-title" style={{ display:'flex', justifyContent:'space-between' }}>
          <span>Productos / Servicios</span>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setItems([...items, { ...ITEM_VACIO }])}>
            + Agregar línea
          </button>
        </div>

        {items.map((it, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 2fr 1fr 1fr auto', gap:8, marginBottom:8, alignItems:'flex-end' }}>
            <div className="form-group" style={{ marginBottom:0 }}>
              {i === 0 && <label className="form-label">Producto / Descripción</label>}
              <select value={it.inventario_id}
                onChange={e => setItem(i, 'inventario_id', e.target.value)}>
                <option value="">— Descripción libre —</option>
                {inventario.map(p => <option key={p.id} value={p.id}>{p.producto}</option>)}
              </select>
              {(!it.inventario_id || it.inventario_id === '') && (
                <input type="text" placeholder="Descripción del producto o servicio"
                  value={it.descripcion}
                  onChange={e => setItem(i, 'descripcion', e.target.value)}
                  style={{ marginTop:4 }} required />
              )}
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              {i === 0 && <label className="form-label">Descripción</label>}
              {it.inventario_id ? (
                <input type="text" value={it.descripcion}
                  onChange={e => setItem(i, 'descripcion', e.target.value)} />
              ) : <div style={{ height:36 }} />}
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              {i === 0 && <label className="form-label">Cantidad</label>}
              <input type="number" min="0.001" step="any" placeholder="0"
                value={it.cantidad} onChange={e => setItem(i, 'cantidad', e.target.value)} required />
            </div>
            <div className="form-group" style={{ marginBottom:0 }}>
              {i === 0 && <label className="form-label">Precio unit.</label>}
              <input type="number" min="0" step="0.01" placeholder="$0.00"
                value={it.precio_unitario} onChange={e => setItem(i, 'precio_unitario', e.target.value)} required />
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
              {i === 0 && <label className="form-label">Importe</label>}
              <div style={{ fontWeight:600, fontSize:14, color:'#1B3A6B', marginBottom:items.length > 1 ? 0 : 4 }}>
                {fmt(it.subtotal)}
              </div>
              {items.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm"
                  style={{ color:'#dc2626', padding:'2px 6px', marginTop:2 }}
                  onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          </div>
        ))}

        <div style={{ borderTop:'1px solid #e5e7eb', paddingTop:12, marginTop:8 }}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Descuento (pesos)</label>
              <input type="number" min="0" step="0.01" placeholder="$0.00"
                value={descuento} onChange={e => setDescuento(e.target.value)} />
            </div>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, paddingTop:24 }}>
              <span style={{ fontSize:13, color:'#666' }}>Subtotal: {fmt(subtotal)}</span>
              {desc > 0 && <span style={{ fontSize:13, color:'#dc2626' }}>Descuento: -{fmt(desc)}</span>}
              <span style={{ fontSize:18, fontWeight:800, color:'#1B3A6B' }}>TOTAL: {fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notas y condiciones */}
      <div className="card">
        <div className="card-title">Notas y condiciones</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Condiciones de pago / entrega</label>
            <textarea placeholder="Ej: Pago al 50% contra pedido. Entrega en 5 días hábiles."
              value={condiciones} onChange={e => setCondiciones(e.target.value)} rows={2} />
          </div>
          <div className="form-group">
            <label className="form-label">Notas adicionales</label>
            <textarea placeholder="Observaciones para el cliente..."
              value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
          </div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <button type="button" className="btn btn-ghost" style={{ flex:1 }} onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-primary" style={{ flex:2 }} disabled={loading}>
          {loading ? 'Guardando...' : '💾 Crear cotización'}
        </button>
      </div>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function Cotizaciones() {
  const [tab,          setTab]          = useState('lista');
  const [lista,        setLista]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [inventario,   setInventario]   = useState([]);
  const [clientes,     setClientes]     = useState([]);
  const [filtroEstado, setFiltroEstado] = useState('todas');
  const [busqueda,     setBusqueda]     = useState('');
  const [modalConv,    setModalConv]    = useState(null);
  const [alertaOk,     setAlertaOk]     = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtroEstado !== 'todas') params.append('estado', filtroEstado);
      if (busqueda) params.append('q', busqueda);
      const [l, inv, cli] = await Promise.all([
        api.cotizaciones(params.toString() ? '?' + params : ''),
        api.inventario(),
        api.clientes(),
      ]);
      setLista(l);
      setInventario(inv);
      setClientes(cli);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filtroEstado, busqueda]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEstado = async (id, estado) => {
    try {
      await api.actualizarEstadoCotizacion(id, estado);
      cargar();
    } catch (e) {
      alert(e.message);
    }
  };

  const verPDF = async (id) => {
    try {
      const cot = await api.detalleCotizacion(id);
      abrirPDF(cot);
    } catch (e) {
      alert('Error al cargar la cotización');
    }
  };

  const handleConvertido = (venta_id) => {
    setModalConv(null);
    setAlertaOk(`✅ Convertida a venta exitosamente. ID de venta: #${venta_id}`);
    cargar();
    setTimeout(() => setAlertaOk(''), 5000);
  };

  const handleGuardado = (cot) => {
    setTab('lista');
    setAlertaOk(`✅ Cotización ${cot.folio} creada correctamente.`);
    cargar();
    setTimeout(() => setAlertaOk(''), 4000);
  };

  const pendientes = lista.filter(c => ['borrador','enviada','aceptada'].includes(c.estado)).length;

  return (
    <div>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
        <div>
          <h2>Cotizaciones</h2>
          <p>Presupuestos para clientes · Conversión directa a venta</p>
        </div>
        <button className="btn btn-primary" onClick={() => setTab('nueva')}>
          + Nueva cotización
        </button>
      </div>

      {alertaOk && (
        <div className="alert green" style={{ marginBottom:12 }}>
          <div className="alert-dot"/><div>{alertaOk}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${tab==='lista'?'active':''}`} onClick={() => setTab('lista')}>
          Lista {pendientes > 0 && <span className="badge badge-blue" style={{ marginLeft:6, fontSize:11 }}>{pendientes}</span>}
        </button>
        <button className={`tab ${tab==='nueva'?'active':''}`} onClick={() => setTab('nueva')}>
          + Nueva cotización
        </button>
      </div>

      {/* ══ LISTA ══ */}
      {tab === 'lista' && (
        <div className="card">
          <div className="card-title" style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <span>Cotizaciones</span>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                style={{ fontSize:13, padding:'4px 8px', borderRadius:6, border:'1px solid #d1d5db' }}>
                <option value="todas">Todos los estados</option>
                {Object.entries(ESTADOS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input type="text" placeholder="Buscar folio o cliente..."
                value={busqueda} onChange={e => setBusqueda(e.target.value)}
                style={{ width:200 }} />
            </div>
          </div>

          {loading ? <div className="empty">Cargando...</div> :
            lista.length === 0 ? <div className="empty">Sin cotizaciones</div> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Fecha</th>
                    <th>Válida hasta</th>
                    <th>Cliente</th>
                    <th className="text-right">Total</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(c => {
                    const vencida = c.fecha_vencimiento && c.fecha_vencimiento < hoy() && c.estado !== 'convertida';
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight:700, color:'#1B3A6B' }}>{c.folio}</td>
                        <td>{fmtDate(c.fecha)}</td>
                        <td style={{ color: vencida ? '#dc2626' : undefined }}>
                          {fmtDate(c.fecha_vencimiento)}
                          {vencida && <div style={{ fontSize:10, color:'#dc2626', fontWeight:600 }}>Vencida</div>}
                        </td>
                        <td style={{ fontWeight:500 }}>{c.cliente_nombre}</td>
                        <td className="text-right fw-500" style={{ color:'#1B3A6B' }}>{fmt(c.total)}</td>
                        <td>
                          {c.estado !== 'convertida' ? (
                            <select
                              value={c.estado}
                              onChange={e => cambiarEstado(c.id, e.target.value)}
                              style={{ fontSize:12, padding:'3px 6px', borderRadius:4, border:'1px solid #d1d5db' }}>
                              {['borrador','enviada','aceptada','rechazada'].map(s => (
                                <option key={s} value={s}>{ESTADOS[s].label}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="badge" style={{ background:'#1B3A6B', color:'white' }}>Convertida</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display:'flex', gap:4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => verPDF(c.id)}
                              title="Ver e imprimir PDF">🖨 PDF</button>
                            {c.estado === 'aceptada' && !c.venta_id && (
                              <button className="btn btn-primary btn-sm" onClick={() => setModalConv(c)}
                                title="Convertir a venta">💰 Venta</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ NUEVA ══ */}
      {tab === 'nueva' && (
        <FormCotizacion
          inventario={inventario}
          clientes={clientes}
          onGuardado={handleGuardado}
          onCancelar={() => setTab('lista')}
        />
      )}

      {/* Modal convertir */}
      {modalConv && (
        <ModalConvertir
          cot={modalConv}
          onCerrar={() => setModalConv(null)}
          onConvertido={handleConvertido}
        />
      )}
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────
const estilos = {
  overlay: {
    position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
    display:'flex', alignItems:'center', justifyContent:'center',
    zIndex:1000, padding:16
  },
  modal: {
    background:'white', borderRadius:12, padding:24,
    width:'100%', maxWidth:420, maxHeight:'90vh', overflowY:'auto',
    boxShadow:'0 20px 60px rgba(0,0,0,0.3)'
  }
};
