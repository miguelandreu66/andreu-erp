import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

// ── Utilidades ────────────────────────────────────────────────────
const fmt$  = n => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
const fmt2  = n => (parseFloat(n) || 0).toFixed(1);
const fmtDate = d => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const COLORS = ['#1B3A6B','#C17D12','#0F6E56','#A32D2D','#534AB7','#E87722','#64748b'];
const mesActual = () => {
  const d = new Date();
  return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
};
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ── Selector de mes/año ───────────────────────────────────────────
function SelectorMes({ anio, mes, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select value={mes} onChange={e => onChange(anio, parseInt(e.target.value))}
        style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
        {MESES.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
      </select>
      <select value={anio} onChange={e => onChange(parseInt(e.target.value), mes)}
        style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
        {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}

// ── Fila del estado de resultados ─────────────────────────────────
function FilaER({ label, valor, sub = false, total = false, positivo = true, indent = 0 }) {
  const color = total
    ? (positivo ? (parseFloat(valor) >= 0 ? '#16a34a' : '#dc2626') : '#dc2626')
    : sub ? '#555' : '#222';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: `${total ? 10 : 6}px ${indent * 16}px`,
      fontWeight: total ? 700 : sub ? 400 : 500,
      fontSize: total ? 16 : sub ? 13 : 14,
      borderTop: total ? '2px solid #e5e7eb' : 'none',
      color,
    }}>
      <span>{label}</span>
      <span style={{ color }}>{fmt$(valor)}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function Reportes() {
  const [tab, setTab] = useState('mensual');

  // Estado de resultados
  const [{ anio, mes }, setPeriodo] = useState(mesActual);
  const [er,       setEr]       = useState(null);
  const [loadEr,   setLoadEr]   = useState(false);

  // Por producto
  const [productos, setProductos] = useState(null);
  const [loadProd,  setLoadProd]  = useState(false);

  // Top clientes
  const [topCli,    setTopCli]    = useState(null);
  const [diasCli,   setDiasCli]   = useState(90);
  const [loadCli,   setLoadCli]   = useState(false);

  // Rentabilidad flota
  const [flota,     setFlota]     = useState(null);
  const [loadFlota, setLoadFlota] = useState(false);

  // Reporte semanal (heredado)
  const [dash,      setDash]      = useState(null);
  const [reporte,   setReporte]   = useState('');
  const [copiado,   setCopiado]   = useState(false);

  const params = useCallback(
    () => `?anio=${anio}&mes=${mes}`, [anio, mes]
  );

  // Cargar según tab activo
  useEffect(() => {
    if (tab === 'mensual' && !er) {
      setLoadEr(true);
      api.reporteMensual(params()).then(setEr).catch(console.error).finally(() => setLoadEr(false));
    }
    if (tab === 'productos' && !productos) {
      setLoadProd(true);
      api.reportePorProducto(params()).then(setProductos).catch(console.error).finally(() => setLoadProd(false));
    }
    if (tab === 'clientes' && !topCli) {
      setLoadCli(true);
      api.reporteTopClientes(`?dias=${diasCli}`).then(setTopCli).catch(console.error).finally(() => setLoadCli(false));
    }
    if (tab === 'flota' && !flota) {
      setLoadFlota(true);
      api.reporteRentabilidadFlota(params()).then(setFlota).catch(console.error).finally(() => setLoadFlota(false));
    }
    if (tab === 'semanal' && !dash) {
      api.dashboard().then(setDash).catch(console.error);
    }
  // eslint-disable-next-line
  }, [tab]);

  const recargarMes = () => {
    setEr(null); setProductos(null); setFlota(null);
    const p = params();
    setLoadEr(true);
    api.reporteMensual(p).then(setEr).finally(() => setLoadEr(false));
    if (tab === 'productos') {
      setLoadProd(true);
      api.reportePorProducto(p).then(setProductos).finally(() => setLoadProd(false));
    }
    if (tab === 'flota') {
      setLoadFlota(true);
      api.reporteRentabilidadFlota(p).then(setFlota).finally(() => setLoadFlota(false));
    }
  };

  const recargarClientes = () => {
    setTopCli(null); setLoadCli(true);
    api.reporteTopClientes(`?dias=${diasCli}`).then(setTopCli).finally(() => setLoadCli(false));
  };

  const generarWhatsApp = async () => {
    const r = await api.reporteDia();
    setReporte(r.texto);
  };

  const copiar = () => {
    navigator.clipboard.writeText(reporte);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:8 }}>
        <div>
          <h2>Reportes Ejecutivos</h2>
          <p>Estado de resultados · Margen · Clientes · Flota</p>
        </div>
        {['mensual','productos','flota'].includes(tab) && (
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <SelectorMes anio={anio} mes={mes} onChange={(a,m) => { setPeriodo({anio:a,mes:m}); setEr(null); setProductos(null); setFlota(null); }} />
            <button className="btn btn-primary btn-sm" onClick={recargarMes}>Aplicar</button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[
          { id:'mensual',  label:'Estado de Resultados' },
          { id:'productos',label:'Por Producto' },
          { id:'clientes', label:'Top Clientes' },
          { id:'flota',    label:'Rentabilidad Flota' },
          { id:'semanal',  label:'Semana / WhatsApp' },
        ].map(t => (
          <button key={t.id} className={`tab ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          TAB: ESTADO DE RESULTADOS
      ══════════════════════════════════════════════════════════ */}
      {tab === 'mensual' && (
        <div>
          {loadEr ? <div className="empty">Calculando...</div> : !er ? null : (
            <>
              {/* Tarjetas resumen */}
              <div className="metric-grid">
                <div className="metric">
                  <div className="metric-label">Ingresos {MESES[mes]}</div>
                  <div className="metric-value" style={{ color:'#16a34a' }}>{fmt$(er.ingresos.ventas_total)}</div>
                  <div style={{ fontSize:11, color:'#888' }}>{er.ingresos.num_ventas} ventas</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Total gastos</div>
                  <div className="metric-value red">{fmt$(er.gastos.total)}</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Utilidad estimada</div>
                  <div className="metric-value" style={{ color: er.resultado.utilidad >= 0 ? '#1B3A6B' : '#dc2626' }}>
                    {fmt$(er.resultado.utilidad)}
                  </div>
                </div>
                <div className="metric">
                  <div className="metric-label">Margen</div>
                  <div className="metric-value" style={{
                    color: er.resultado.margen_pct >= 20 ? '#16a34a' :
                           er.resultado.margen_pct >= 10 ? '#d97706' : '#dc2626'
                  }}>{fmt2(er.resultado.margen_pct)}%</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Cobrado real</div>
                  <div className="metric-value navy">{fmt$(er.ingresos.cobrado_real)}</div>
                  <div style={{ fontSize:11, color:'#888' }}>Contado + abonos</div>
                </div>
                <div className="metric">
                  <div className="metric-label">Crédito otorgado</div>
                  <div className="metric-value" style={{ color:'#d97706' }}>{fmt$(er.ingresos.ventas_credito)}</div>
                </div>
              </div>

              {/* Estado de resultados detallado */}
              <div className="card">
                <div className="card-title">
                  Estado de Resultados — {MESES[mes]} {anio}
                </div>
                <div style={{ maxWidth: 520 }}>
                  <div style={{ background:'#f0fdf4', borderRadius:8, padding:'8px 16px', marginBottom:8 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#166534', marginBottom:4 }}>INGRESOS</div>
                    <FilaER label="Ventas contado"  valor={er.ingresos.ventas_contado} sub indent={1} />
                    <FilaER label="Ventas crédito"  valor={er.ingresos.ventas_credito} sub indent={1} />
                    <FilaER label="TOTAL INGRESOS"  valor={er.ingresos.ventas_total} total positivo />
                  </div>

                  <div style={{ background:'#fef2f2', borderRadius:8, padding:'8px 16px', marginBottom:8 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:'#991b1b', marginBottom:4 }}>GASTOS OPERATIVOS</div>
                    <FilaER label={`Nómina (${er.gastos.nomina > 0 ? 'pagada' : 'sin registros'})`} valor={er.gastos.nomina} sub indent={1} />
                    <FilaER label={`Diésel (${er.gastos.diesel_litros.toFixed(0)} lts)`} valor={er.gastos.diesel} sub indent={1} />
                    <FilaER label="Gastos aprobados" valor={er.gastos.operativos} sub indent={1} />
                    <FilaER label="Mantenimiento"    valor={er.gastos.mantenimiento} sub indent={1} />
                    <FilaER label="Compras a proveedores" valor={er.gastos.compras} sub indent={1} />
                    <FilaER label="TOTAL GASTOS"     valor={er.gastos.total} total positivo={false} />
                  </div>

                  <div style={{ background: er.resultado.utilidad >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius:8, padding:'8px 16px' }}>
                    <FilaER
                      label={er.resultado.utilidad >= 0 ? '✅ UTILIDAD ESTIMADA' : '🔴 PÉRDIDA ESTIMADA'}
                      valor={er.resultado.utilidad}
                      total
                      positivo={er.resultado.utilidad >= 0}
                    />
                    <div style={{ textAlign:'right', fontSize:13, color:'#555', padding:'4px 0' }}>
                      Margen: <strong>{fmt2(er.resultado.margen_pct)}%</strong>
                    </div>
                  </div>

                  <p style={{ fontSize:11, color:'#9ca3af', marginTop:12, lineHeight:1.5 }}>
                    * Utilidad estimada = Ingresos facturados − Gastos registrados en el sistema.<br/>
                    Para utilidad real confirma con tu contador los ajustes contables.
                  </p>
                </div>
              </div>

              {/* Gráfica de composición de gastos */}
              {er.gastos.total > 0 && (
                <div className="card">
                  <div className="card-title">Composición de gastos</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={[
                          { name:'Nómina',       value: er.gastos.nomina },
                          { name:'Diésel',        value: er.gastos.diesel },
                          { name:'Op. generales', value: er.gastos.operativos },
                          { name:'Mantenimiento', value: er.gastos.mantenimiento },
                          { name:'Compras',       value: er.gastos.compras },
                        ].filter(d => d.value > 0)}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                      >
                        {COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                      </Pie>
                      <Tooltip formatter={v => fmt$(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: POR PRODUCTO
      ══════════════════════════════════════════════════════════ */}
      {tab === 'productos' && (
        <div className="card">
          <div className="card-title">Ingresos por Producto — {MESES[mes]} {anio}</div>
          {loadProd ? <div className="empty">Calculando...</div> :
            !productos || productos.productos?.length === 0
              ? <div className="empty">Sin ventas en este período</div>
              : (
                <>
                  {/* Gráfica de barras */}
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={productos.productos.slice(0, 8).map(p => ({ name: p.producto.slice(0,14), ingreso: p.ingreso_total }))}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$'+(v/1000).toFixed(0)+'k'} />
                      <Tooltip formatter={v => fmt$(v)} />
                      <Bar dataKey="ingreso" fill="#1B3A6B" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="table-wrap" style={{ marginTop: 16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th className="text-right">Ventas</th>
                          <th className="text-right">Cantidad</th>
                          <th className="text-right">Precio venta prom.</th>
                          <th className="text-right">Costo compra prom.</th>
                          <th className="text-right">Margen %</th>
                          <th className="text-right">Ingreso total</th>
                          <th className="text-right">% del total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productos.productos.map(p => (
                          <tr key={p.producto}>
                            <td style={{ fontWeight: 500 }}>{p.producto}</td>
                            <td className="text-right">{p.num_ventas}</td>
                            <td className="text-right">{p.cantidad_vendida?.toLocaleString('es-MX')}</td>
                            <td className="text-right">{fmt$(p.precio_venta_prom)}</td>
                            <td className="text-right" style={{ color:'#888' }}>
                              {p.costo_compra_prom ? fmt$(p.costo_compra_prom) : <span style={{ color:'#ccc' }}>Sin OC</span>}
                            </td>
                            <td className="text-right">
                              {p.margen_pct !== null
                                ? <span style={{ fontWeight:600, color: p.margen_pct >= 20 ? '#16a34a' : p.margen_pct >= 10 ? '#d97706' : '#dc2626' }}>
                                    {p.margen_pct}%
                                  </span>
                                : <span style={{ color:'#ccc', fontSize:12 }}>Sin datos</span>
                              }
                            </td>
                            <td className="text-right fw-500" style={{ color:'#1B3A6B' }}>{fmt$(p.ingreso_total)}</td>
                            <td className="text-right">
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <div style={{ flex:1, background:'#f3f4f6', borderRadius:3, height:6, minWidth:50 }}>
                                  <div style={{ width: p.pct_del_total+'%', background:'#1B3A6B', height:6, borderRadius:3 }} />
                                </div>
                                <span style={{ fontSize:12, minWidth:32 }}>{p.pct_del_total}%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="6" style={{ fontWeight:700, paddingTop:10 }}>TOTAL</td>
                          <td className="text-right" style={{ fontWeight:800, color:'#1B3A6B', paddingTop:10, fontSize:15 }}>
                            {fmt$(productos.total_ingresos)}
                          </td>
                          <td className="text-right" style={{ paddingTop:10 }}>100%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p style={{ fontSize:11, color:'#9ca3af', marginTop:8 }}>
                    * Margen calculado con precio promedio de Órdenes de Compra recibidas. Sin OC registradas, la columna muestra "Sin datos".
                  </p>
                </>
              )
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: TOP CLIENTES
      ══════════════════════════════════════════════════════════ */}
      {tab === 'clientes' && (
        <div className="card">
          <div className="card-title" style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
            <span>Top 10 Clientes</span>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <select value={diasCli} onChange={e => setDiasCli(parseInt(e.target.value))}
                style={{ fontSize:13, padding:'4px 8px', borderRadius:6, border:'1px solid #d1d5db' }}>
                <option value={30}>Últimos 30 días</option>
                <option value={90}>Últimos 90 días</option>
                <option value={180}>Últimos 6 meses</option>
                <option value={365}>Último año</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={recargarClientes}>Buscar</button>
            </div>
          </div>
          {loadCli ? <div className="empty">Calculando...</div> :
            !topCli || topCli.clientes?.length === 0
              ? <div className="empty">Sin clientes con compras en este período</div>
              : (
                <>
                  {/* Gráfica */}
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={topCli.clientes.slice(0,8).map(c => ({ name: c.nombre.split(' ')[0], total: parseFloat(c.total_comprado) }))}>
                      <XAxis dataKey="name" tick={{ fontSize:10 }} />
                      <YAxis tick={{ fontSize:10 }} tickFormatter={v => '$'+(v/1000).toFixed(0)+'k'} />
                      <Tooltip formatter={v => fmt$(v)} />
                      <Bar dataKey="total" fill="#C17D12" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="table-wrap" style={{ marginTop:16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Cliente</th>
                          <th>Tipo</th>
                          <th className="text-right">Compras</th>
                          <th className="text-right">Total comprado</th>
                          <th className="text-right">Ticket prom.</th>
                          <th>Última compra</th>
                          <th className="text-right">Saldo pendiente</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topCli.clientes.map((c, i) => (
                          <tr key={c.id}>
                            <td style={{ fontWeight:700, color:'#C17D12', fontSize:16 }}>#{i+1}</td>
                            <td>
                              <div style={{ fontWeight:500 }}>{c.nombre}</div>
                              {c.telefono && <div style={{ fontSize:11, color:'#888' }}>{c.telefono}</div>}
                            </td>
                            <td><span className="badge badge-gray">{c.tipo?.replace('_',' ')}</span></td>
                            <td className="text-right">{c.num_compras}</td>
                            <td className="text-right fw-500" style={{ color:'#1B3A6B', fontSize:15 }}>{fmt$(c.total_comprado)}</td>
                            <td className="text-right">{fmt$(c.ticket_promedio)}</td>
                            <td>{fmtDate(c.ultima_compra)}</td>
                            <td className="text-right">
                              {parseFloat(c.saldo_pendiente) > 0
                                ? <span style={{ color:'#dc2626', fontWeight:600 }}>{fmt$(c.saldo_pendiente)}</span>
                                : <span style={{ color:'#16a34a' }}>—</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: RENTABILIDAD FLOTA
      ══════════════════════════════════════════════════════════ */}
      {tab === 'flota' && (
        <div className="card">
          <div className="card-title">Rentabilidad por Unidad — {MESES[mes]} {anio}</div>
          {loadFlota ? <div className="empty">Calculando...</div> :
            !flota || flota.unidades?.length === 0
              ? <div className="empty">Sin datos de flota en este período</div>
              : (
                <>
                  {/* Gráfica de costo total por unidad */}
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={flota.unidades.filter(u => u.costo_total > 0).map(u => ({
                      name: u.placas,
                      diesel: parseFloat(u.costo_diesel),
                      mant: parseFloat(u.costo_mantenimiento),
                    }))}>
                      <XAxis dataKey="name" tick={{ fontSize:11 }} />
                      <YAxis tick={{ fontSize:11 }} tickFormatter={v => '$'+(v/1000).toFixed(0)+'k'} />
                      <Tooltip formatter={v => fmt$(v)} />
                      <Legend />
                      <Bar dataKey="diesel" name="Diésel"        fill="#1B3A6B" stackId="a" radius={[0,0,0,0]} />
                      <Bar dataKey="mant"   name="Mantenimiento" fill="#C17D12" stackId="a" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  <div className="table-wrap" style={{ marginTop:16 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Unidad</th>
                          <th className="text-right">Viajes</th>
                          <th className="text-right">Km</th>
                          <th className="text-right">Toneladas</th>
                          <th className="text-right">Costo diésel</th>
                          <th className="text-right">Mantenimiento</th>
                          <th className="text-right">Costo total</th>
                          <th className="text-right">$/km</th>
                          <th className="text-right">$/ton</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flota.unidades.map(u => (
                          <tr key={u.id}>
                            <td>
                              <div style={{ fontWeight:600 }}>{u.placas}</div>
                              <div style={{ fontSize:11, color:'#888' }}>{u.vehiculo?.trim() || u.descripcion}</div>
                            </td>
                            <td className="text-right">{u.viajes}</td>
                            <td className="text-right">{parseFloat(u.km_total).toLocaleString('es-MX')}</td>
                            <td className="text-right">{parseFloat(u.toneladas).toLocaleString('es-MX')}</td>
                            <td className="text-right" style={{ color:'#1B3A6B' }}>{fmt$(u.costo_diesel)}</td>
                            <td className="text-right" style={{ color:'#C17D12' }}>{fmt$(u.costo_mantenimiento)}</td>
                            <td className="text-right fw-500" style={{ color:'#dc2626', fontSize:15 }}>{fmt$(u.costo_total)}</td>
                            <td className="text-right">{u.costo_por_km ? fmt$(u.costo_por_km) : '—'}</td>
                            <td className="text-right">{u.costo_por_ton ? fmt$(u.costo_por_ton) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="4" style={{ fontWeight:700, paddingTop:10 }}>TOTAL FLOTA</td>
                          <td className="text-right fw-500" style={{ paddingTop:10, color:'#1B3A6B' }}>
                            {fmt$(flota.unidades.reduce((s,u) => s + parseFloat(u.costo_diesel), 0))}
                          </td>
                          <td className="text-right fw-500" style={{ paddingTop:10, color:'#C17D12' }}>
                            {fmt$(flota.unidades.reduce((s,u) => s + parseFloat(u.costo_mantenimiento), 0))}
                          </td>
                          <td className="text-right" style={{ fontWeight:800, color:'#dc2626', paddingTop:10, fontSize:15 }}>
                            {fmt$(flota.unidades.reduce((s,u) => s + parseFloat(u.costo_total), 0))}
                          </td>
                          <td colSpan="2" />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )
          }
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          TAB: SEMANAL / WHATSAPP (heredado)
      ══════════════════════════════════════════════════════════ */}
      {tab === 'semanal' && (
        <div>
          {dash && (
            <div className="metric-grid">
              <div className="metric"><div className="metric-label">Ingresos semana</div><div className="metric-value" style={{ color:'#16a34a' }}>{fmt$(dash.ventas_semana)}</div></div>
              <div className="metric"><div className="metric-label">Egresos semana</div><div className="metric-value red">{fmt$(dash.gastos_semana)}</div></div>
              <div className="metric"><div className="metric-label">Utilidad</div><div className="metric-value navy">{fmt$(dash.ventas_semana - dash.gastos_semana)}</div></div>
              <div className="metric"><div className="metric-label">Margen %</div><div className="metric-value">{dash.margen_semana}%</div></div>
              <div className="metric"><div className="metric-label">Viajes semana</div><div className="metric-value orange">{dash.viajes_semana} / 25</div></div>
              <div className="metric"><div className="metric-label">Nómina</div><div className="metric-value navy">{fmt$(dash.nomina_semana)}</div></div>
            </div>
          )}
          <div className="card">
            <div className="card-title">Alertas activas</div>
            {dash?.alertas?.map((a, i) => (
              <div key={i} className={`alert ${a.tipo}`}><div className="alert-dot"/><div>{a.msg}</div></div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">Reporte del día para WhatsApp</div>
            <p className="text-muted" style={{ marginBottom:12 }}>Genera el resumen diario en texto listo para compartir</p>
            <button className="btn btn-orange" onClick={generarWhatsApp}>Generar reporte de hoy</button>
            {reporte && (
              <div style={{ marginTop:12 }}>
                <pre style={{ background:'#F4F4F2', borderRadius:8, padding:14, fontSize:13, lineHeight:1.6, whiteSpace:'pre-wrap', fontFamily:'inherit' }}>{reporte}</pre>
                <button className="btn btn-ghost btn-sm" style={{ marginTop:8 }} onClick={copiar}>
                  {copiado ? '✓ Copiado' : 'Copiar texto'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
