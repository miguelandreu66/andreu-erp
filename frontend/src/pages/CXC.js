import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const fmt     = n  => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
const fmtDate = d  => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };
const hoy     = () => new Date().toISOString().split('T')[0];

function BadgeDias({ dias }) {
  const d = parseInt(dias) || 0;
  if (d <= 0)  return <span className="badge badge-green">Al corriente</span>;
  if (d <= 30) return <span className="badge badge-amber">{d} días</span>;
  if (d <= 60) return <span className="badge badge-red">{d} días</span>;
  return <span className="badge badge-red" style={{ background: '#7f1d1d', color: '#fff' }}>{d} días</span>;
}

// ── Modal de abono ────────────────────────────────────────────────
function ModalAbono({ cuenta, onCerrar, onGuardado }) {
  const [form, setForm] = useState({ monto: '', tipo_pago: 'Efectivo', fecha: hoy(), notas: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const guardar = async (e) => {
    e.preventDefault();
    if (parseFloat(form.monto) <= 0) { setMsg('Ingresa un monto válido'); return; }
    setLoading(true);
    try {
      await api.registrarAbono(cuenta.id, { ...form, monto: parseFloat(form.monto) });
      onGuardado();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const saldo = parseFloat(cuenta.saldo_pendiente) || 0;

  return (
    <div style={styles.overlay} onClick={onCerrar}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#1B3A6B' }}>Registrar abono</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
        </div>

        {/* Info de la cuenta */}
        <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13 }}>
          <div><strong>Cliente:</strong> {cuenta.cliente_nombre || 'Público general'}</div>
          <div><strong>Fecha venta:</strong> {fmtDate(cuenta.fecha)}</div>
          <div><strong>Total venta:</strong> {fmt(cuenta.total)}</div>
          <div><strong>Ya abonado:</strong> {fmt(cuenta.total_abonado)}</div>
          <div style={{ marginTop: 6, fontWeight: 700, color: '#991b1b', fontSize: 15 }}>
            Saldo pendiente: {fmt(saldo)}
          </div>
        </div>

        {msg && <div className="alert red" style={{ marginBottom: 12 }}><div className="alert-dot"/><div>{msg}</div></div>}

        <form onSubmit={guardar}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Monto del abono</label>
              <input type="number" min="0.01" step="0.01" max={saldo}
                placeholder={`Máx ${fmt(saldo)}`}
                value={form.monto}
                onChange={e => setForm({ ...form, monto: e.target.value })}
                required autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Fecha</label>
              <input type="date" value={form.fecha}
                onChange={e => setForm({ ...form, fecha: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Forma de pago</label>
            <select value={form.tipo_pago} onChange={e => setForm({ ...form, tipo_pago: e.target.value })}>
              {['Efectivo','Transferencia','Cheque'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Notas (opcional)</label>
            <textarea placeholder="Referencia, observaciones..." value={form.notas}
              onChange={e => setForm({ ...form, notas: e.target.value })} rows={2}/>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={loading}>
              {loading ? 'Guardando...' : 'Registrar abono'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal de historial de abonos ──────────────────────────────────
function ModalHistorial({ cuenta, onCerrar }) {
  const [abonos, setAbonos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.cxcAbonos(cuenta.id)
      .then(setAbonos)
      .finally(() => setLoading(false));
  }, [cuenta.id]);

  return (
    <div style={styles.overlay} onClick={onCerrar}>
      <div style={{ ...styles.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#1B3A6B' }}>Historial de abonos</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCerrar}>✕</button>
        </div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
          {cuenta.cliente_nombre || 'Público general'} — Venta {fmtDate(cuenta.fecha)} — Total {fmt(cuenta.total)}
        </div>
        {loading ? <div className="empty">Cargando...</div> : abonos.length === 0
          ? <div className="empty">Sin abonos registrados</div>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Pago</th><th>Registró</th><th className="text-right">Monto</th></tr>
                </thead>
                <tbody>
                  {abonos.map(a => (
                    <tr key={a.id}>
                      <td>{fmtDate(a.fecha)}</td>
                      <td><span className="badge badge-blue">{a.tipo_pago}</span></td>
                      <td className="text-muted">{a.registrado_nombre}</td>
                      <td className="text-right fw-500" style={{ color: '#065f46' }}>{fmt(a.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3" style={{ fontWeight: 600, paddingTop: 10 }}>Total abonado</td>
                    <td className="text-right" style={{ fontWeight: 700, color: '#065f46', paddingTop: 10 }}>
                      {fmt(abonos.reduce((s, a) => s + parseFloat(a.monto), 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function CXC() {
  const [tab,        setTab]        = useState('cuentas');
  const [cuentas,    setCuentas]    = useState([]);
  const [resumen,    setResumen]    = useState(null);
  const [antiguedad, setAntiguedad] = useState([]);
  const [loading,    setLoading]    = useState(true);

  const [modalAbono,       setModalAbono]       = useState(null);
  const [modalHistorial,   setModalHistorial]   = useState(null);
  const [filtroCliente,    setFiltroCliente]    = useState('');
  const [soloVencidas,     setSoloVencidas]     = useState(false);
  const [enviandoWA,       setEnviandoWA]       = useState(false);
  const [resultadoWA,      setResultadoWA]      = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (soloVencidas) params.append('vencidas', 'true');
      const [c, r, a] = await Promise.all([
        api.cxcLista(params.toString() ? '?' + params : ''),
        api.cxcResumen(),
        api.cxcAntiguedad()
      ]);
      setCuentas(c);
      setResumen(r);
      setAntiguedad(a);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [soloVencidas]);

  useEffect(() => { cargar(); }, [cargar]);

  const cuentasFiltradas = cuentas.filter(c =>
    !filtroCliente ||
    (c.cliente_nombre || '').toLowerCase().includes(filtroCliente.toLowerCase())
  );

  const handleAbonoGuardado = () => {
    setModalAbono(null);
    cargar();
  };

  const enviarRecordatorios = async () => {
    if (!window.confirm('¿Enviar recordatorio por WhatsApp a todos los clientes con saldo vencido (+30 días)?')) return;
    setEnviandoWA(true);
    setResultadoWA(null);
    try {
      const r = await api.recordatoriosCXC();
      setResultadoWA(r);
    } catch (e) {
      setResultadoWA({ ok: false, error: e.message });
    } finally {
      setEnviandoWA(false);
    }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2>Cuentas por Cobrar (CXC)</h2>
          <p>Control de créditos, antigüedad de saldos y abonos</p>
        </div>
        <button
          className="btn btn-orange"
          onClick={enviarRecordatorios}
          disabled={enviandoWA}
          title="Enviar WhatsApp a clientes con saldo vencido +30 días"
        >
          {enviandoWA ? 'Enviando...' : '📱 Recordatorios WhatsApp'}
        </button>
      </div>

      {resultadoWA && (
        <div className={`alert ${resultadoWA.ok ? 'green' : 'red'}`} style={{ marginBottom: 12 }}>
          <div className="alert-dot" />
          <div>
            {resultadoWA.ok
              ? `✅ ${resultadoWA.enviados} mensaje(s) enviado(s) de ${resultadoWA.total_clientes} cliente(s) con saldo vencido.` +
                (resultadoWA.sin_telefono > 0 ? ` ${resultadoWA.sin_telefono} cuenta(s) sin teléfono registrado.` : '') +
                (resultadoWA.sin_twilio ? ' (Twilio no configurado — mensajes simulados en log)' : '')
              : `Error: ${resultadoWA.error}`
            }
          </div>
        </div>
      )}

      {/* Tarjetas de resumen */}
      {resumen && (
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">Total por cobrar</div>
            <div className="metric-value navy">{fmt(resumen.total_por_cobrar)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Vencido (+30 días)</div>
            <div className="metric-value" style={{ color: '#991b1b' }}>{fmt(resumen.vencido)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Al corriente</div>
            <div className="metric-value" style={{ color: '#065f46' }}>{fmt(resumen.por_vencer)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Cuentas abiertas</div>
            <div className="metric-value">{resumen.cuentas}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Clientes con saldo</div>
            <div className="metric-value">{resumen.clientes_con_saldo}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {['cuentas','antiguedad'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'cuentas' ? 'Cuentas pendientes' : 'Antigüedad de saldos'}
          </button>
        ))}
      </div>

      {/* ── CUENTAS PENDIENTES ── */}
      {tab === 'cuentas' && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Cuentas por cobrar</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={soloVencidas}
                  onChange={e => setSoloVencidas(e.target.checked)} />
                Solo vencidas (+30 días)
              </label>
              <input type="text" placeholder="Buscar cliente..."
                value={filtroCliente}
                onChange={e => setFiltroCliente(e.target.value)}
                style={{ width: 180 }} />
            </div>
          </div>

          {loading ? <div className="empty">Cargando...</div> :
            cuentasFiltradas.length === 0 ? (
              <div className="empty" style={{ color: '#065f46' }}>
                No hay cuentas pendientes
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Fecha venta</th>
                      <th>Vence / Días</th>
                      <th className="text-right">Total venta</th>
                      <th className="text-right">Abonado</th>
                      <th className="text-right">Saldo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuentasFiltradas.map(c => (
                      <tr key={c.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{c.cliente_nombre || 'Público gral.'}</div>
                          {c.cliente_telefono && <div style={{ fontSize: 11, color: '#666' }}>{c.cliente_telefono}</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.fecha)}</td>
                        <td>
                          <div style={{ whiteSpace: 'nowrap', fontSize: 12, color: '#666', marginBottom: 2 }}>
                            {c.fecha_vencimiento ? fmtDate(c.fecha_vencimiento) : '—'}
                          </div>
                          <BadgeDias dias={c.dias_transcurridos} />
                        </td>
                        <td className="text-right">{fmt(c.total)}</td>
                        <td className="text-right" style={{ color: '#065f46' }}>{fmt(c.total_abonado)}</td>
                        <td className="text-right fw-500" style={{ color: '#991b1b', fontSize: 15 }}>
                          {fmt(c.saldo_pendiente)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                            <button className="btn btn-primary btn-sm"
                              onClick={() => setModalAbono(c)}
                              title="Registrar abono">
                              + Abono
                            </button>
                            <button className="btn btn-ghost btn-sm"
                              onClick={() => setModalHistorial(c)}
                              title="Ver historial de abonos">
                              Historial
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="5" style={{ fontWeight: 600, paddingTop: 12 }}>Total pendiente</td>
                      <td className="text-right" style={{ fontWeight: 700, color: '#991b1b', paddingTop: 12, fontSize: 16 }}>
                        {fmt(cuentasFiltradas.reduce((s, c) => s + parseFloat(c.saldo_pendiente), 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── ANTIGÜEDAD DE SALDOS ── */}
      {tab === 'antiguedad' && (
        <div className="card">
          <div className="card-title">Antigüedad de saldos por cliente</div>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
            Días calculados desde la fecha de vencimiento (o fecha de venta si no tiene vencimiento).
          </p>
          {antiguedad.length === 0
            ? <div className="empty" style={{ color: '#065f46' }}>No hay saldos pendientes</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th className="text-right" style={{ color: '#065f46' }}>0-30 días</th>
                      <th className="text-right" style={{ color: '#b45309' }}>31-60 días</th>
                      <th className="text-right" style={{ color: '#c2410c' }}>61-90 días</th>
                      <th className="text-right" style={{ color: '#991b1b' }}>+90 días</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {antiguedad.map(a => (
                      <tr key={a.cliente_id || a.cliente_nombre}>
                        <td style={{ fontWeight: 500 }}>{a.cliente_nombre || 'Público general'}</td>
                        <td className="text-right" style={{ color: parseFloat(a.d_0_30)  > 0 ? '#065f46' : '#ccc' }}>{fmt(a.d_0_30)}</td>
                        <td className="text-right" style={{ color: parseFloat(a.d_31_60) > 0 ? '#b45309' : '#ccc' }}>{fmt(a.d_31_60)}</td>
                        <td className="text-right" style={{ color: parseFloat(a.d_61_90) > 0 ? '#c2410c' : '#ccc' }}>{fmt(a.d_61_90)}</td>
                        <td className="text-right" style={{ color: parseFloat(a.d_mas_90)> 0 ? '#991b1b' : '#ccc' }}>{fmt(a.d_mas_90)}</td>
                        <td className="text-right fw-500" style={{ color: '#1B3A6B' }}>{fmt(a.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #1B3A6B' }}>
                      <td style={{ fontWeight: 700, paddingTop: 10 }}>TOTAL</td>
                      {['d_0_30','d_31_60','d_61_90','d_mas_90','total'].map(k => (
                        <td key={k} className="text-right fw-500" style={{ paddingTop: 10, color: '#1B3A6B' }}>
                          {fmt(antiguedad.reduce((s, a) => s + parseFloat(a[k] || 0), 0))}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </div>
      )}

      {/* Modales */}
      {modalAbono     && <ModalAbono     cuenta={modalAbono}     onCerrar={() => setModalAbono(null)}     onGuardado={handleAbonoGuardado} />}
      {modalHistorial && <ModalHistorial cuenta={modalHistorial} onCerrar={() => setModalHistorial(null)} />}
    </div>
  );
}

// ── Estilos de modales ────────────────────────────────────────────
const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16
  },
  modal: {
    background: 'white',
    borderRadius: 12,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  }
};
