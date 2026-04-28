import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const fmtDate = d => { if (!d) return ''; const p = d.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; };

export default function Dashboard() {
  const { usuario } = useAuth();
  const [data, setData] = useState(null);
  const [ventasSemana, setVentasSemana] = useState([]);
  const [rendimiento, setRendimiento] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reporte, setReporte] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    cargar();
    const interval = setInterval(cargar, 60000);
    return () => clearInterval(interval);
  }, []);

  const cargar = async () => {
    try {
      const [dash, vs, rend] = await Promise.all([
        api.dashboard(),
        api.resumenSemana(),
        api.rendimientoSemana(),
      ]);
      setData(dash);
      setVentasSemana(vs.por_dia?.map(d => ({ dia: fmtDate(d.fecha), ventas: parseFloat(d.total) })) || []);
      setRendimiento(rend.operadores?.map(o => ({ operador: o.operador?.split(' ')[0] || o.operador, viajes: parseInt(o.completados), meta: 5 })) || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const generarReporte = async () => {
    const r = await api.reporteDia();
    setReporte(r.texto);
  };

  const copiar = () => {
    navigator.clipboard.writeText(reporte);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  if (loading) return <div className="empty">Cargando dashboard...</div>;
  if (!data) return <div className="empty">Error al cargar datos</div>;

  const pctViajes = Math.min(100, Math.round((data.viajes_semana / data.meta_viajes) * 100));
  const pctNomina = Math.min(100, Math.round((data.nomina_semana / data.min_nomina) * 100));

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Bienvenido, {usuario?.nombre} · {fmtDate(data.hoy)}</p>
      </div>

      {/* Alertas */}
      <div style={{ marginBottom: 16 }}>
        {data.alertas?.map((a, i) => (
          <div key={i} className={`alert ${a.tipo}`}>
            <div className="alert-dot" />
            <div>{a.msg}</div>
          </div>
        ))}
      </div>

      {/* Métricas principales */}
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-label">Ventas hoy</div>
          <div className="metric-value navy">{fmt(data.ventas_hoy)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Ventas semana</div>
          <div className="metric-value navy">{fmt(data.ventas_semana)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Gastos hoy</div>
          <div className="metric-value red">{fmt(data.gastos_hoy)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Utilidad semana</div>
          <div className={`metric-value ${data.utilidad_semana >= 0 ? 'green' : 'red'}`}>{fmt(data.utilidad_semana)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Margen %</div>
          <div className={`metric-value ${data.margen_semana >= 15 ? 'green' : data.margen_semana >= 10 ? 'orange' : 'red'}`}>{data.margen_semana}%</div>
        </div>
        <div className="metric">
          <div className="metric-label">Viajes hoy</div>
          <div className="metric-value orange">{data.viajes_hoy}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Viajes semana</div>
          <div className="metric-value orange">{data.viajes_semana} / {data.meta_viajes}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Nómina semana</div>
          <div className={`metric-value ${pctNomina >= 100 ? 'green' : 'orange'}`}>{fmt(data.nomina_semana)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Por cobrar (CXC)</div>
          <div className="metric-value" style={{ color: data.cxc_cuentas_vencidas > 0 ? '#dc2626' : '#1B3A6B' }}>
            {fmt(data.cxc_total_por_cobrar)}
          </div>
          {data.cxc_cuentas_vencidas > 0 && (
            <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>
              {data.cxc_cuentas_vencidas} vencida(s)
            </div>
          )}
        </div>
        <div className="metric">
          <div className="metric-label">Por pagar (CxP)</div>
          <div className="metric-value" style={{ color: data.cxp_proximas_a_vencer > 0 ? '#d97706' : '#1B3A6B' }}>
            {fmt(data.cxp_total_por_pagar)}
          </div>
          {data.cxp_proximas_a_vencer > 0 && (
            <div style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>
              {data.cxp_proximas_a_vencer} vence(n) esta semana
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Meta flota */}
        <div className="card">
          <div className="card-title">Meta flota semanal</div>
          <div className="flex-between" style={{ marginBottom: 6, fontSize: 13 }}>
            <span>Viajes completados</span>
            <span style={{ fontWeight: 600 }}>{data.viajes_semana} / {data.meta_viajes}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: pctViajes + '%', background: pctViajes >= 80 ? '#639922' : pctViajes >= 50 ? '#E87722' : '#1B3A6B' }} />
          </div>
          <div className="text-muted mt-8">{pctViajes}% de la meta</div>
        </div>

        {/* Nómina */}
        <div className="card">
          <div className="card-title">Nómina mínima semanal</div>
          <div className="flex-between" style={{ marginBottom: 6, fontSize: 13 }}>
            <span>Cubierto</span>
            <span style={{ fontWeight: 600 }}>{fmt(data.nomina_semana)} / $30,000</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: pctNomina + '%', background: pctNomina >= 100 ? '#639922' : '#E87722' }} />
          </div>
          <div className="text-muted mt-8">{pctNomina}% cubierto</div>
        </div>
      </div>

      {/* Ventas por día */}
      {ventasSemana.length > 0 && (
        <div className="card">
          <div className="card-title">Ventas por día — semana actual</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={ventasSemana} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
              <Tooltip formatter={v => fmt(v)} />
              <Bar dataKey="ventas" fill="#1B3A6B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Rendimiento operadores */}
      {rendimiento.length > 0 && (
        <div className="card">
          <div className="card-title">Viajes por operador — semana</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={rendimiento} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
              <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 11 }} />
              <YAxis dataKey="operador" type="category" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="viajes" fill="#E87722" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Inventario */}
      <div className="card">
        <div className="card-title">Estado de inventario</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Material</th><th>Existencia</th><th>Punto reorden</th><th>Estado</th></tr></thead>
            <tbody>
              {data.inventario?.map(inv => (
                <tr key={inv.id}>
                  <td style={{ fontWeight: 500 }}>{inv.producto}</td>
                  <td>{inv.existencia} {inv.unidad}</td>
                  <td>{inv.punto_reorden} {inv.unidad}</td>
                  <td><span className={`badge ${parseFloat(inv.existencia) <= parseFloat(inv.punto_reorden) ? 'badge-red' : 'badge-green'}`}>{parseFloat(inv.existencia) <= parseFloat(inv.punto_reorden) ? 'Pedir' : 'OK'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reporte del día */}
      <div className="card">
        <div className="card-title">Reporte del día</div>
        <p className="text-muted" style={{ marginBottom: 12 }}>Genera el resumen listo para enviar por WhatsApp</p>
        <button className="btn btn-orange" onClick={generarReporte}>Generar reporte</button>
        {reporte && (
          <div style={{ marginTop: 12 }}>
            <pre style={{ background: '#F4F4F2', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{reporte}</pre>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
