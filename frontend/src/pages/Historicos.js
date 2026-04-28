import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts';

const fmt = n => '$' + Math.round(n || 0).toLocaleString('es-MX');
const delta = n => { const v = parseFloat(n); return { valor: Math.abs(v).toFixed(1), positivo: v >= 0 }; };

export default function Historicos() {
  const [tab, setTab] = useState('semanas');
  const [comp, setComp] = useState(null);
  const [mensual, setMensual] = useState([]);
  const [porProducto, setPorProducto] = useState([]);
  const [viajesSem, setViajesSem] = useState([]);
  const [margenSem, setMargenSem] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setLoading(true);
    try {
      const [c, m, pp, vs, ms] = await Promise.all([
        api.comparativoSemanas(),
        api.tendenciaMensual(),
        api.ventasPorProducto(),
        api.viajesSemanas(),
        api.margenSemanas(),
      ]);
      setComp(c);
      setMensual(m);
      setPorProducto(pp);
      setViajesSem(vs);
      setMargenSem(ms);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (loading) return <div className="empty">Cargando históricos...</div>;

  const DeltaBadge = ({ val, invert = false }) => {
    const { valor, positivo } = delta(val);
    const bueno = invert ? !positivo : positivo;
    return (
      <span className={`badge ${bueno ? 'badge-green' : 'badge-red'}`} style={{ marginLeft: 8 }}>
        {positivo ? '▲' : '▼'} {valor}%
      </span>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h2>Históricos y Tendencias</h2>
        <p>Comparativos semana a semana, mes a mes</p>
      </div>

      <div className="tabs">
        {['semanas','mensual','productos','flota','margen'].map(t => (
          <button key={t} className={`tab ${tab===t?'active':''}`} onClick={() => setTab(t)}>
            {t === 'semanas' ? 'Semana vs semana' : t === 'mensual' ? '6 meses' : t === 'productos' ? 'Por producto' : t === 'flota' ? 'Flota' : 'Margen'}
          </button>
        ))}
      </div>

      {tab === 'semanas' && comp && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Ventas', key: 'ventas', fmt: true },
              { label: 'Gastos', key: 'gastos', fmt: true, invert: true },
              { label: 'Viajes', key: 'viajes', fmt: false },
            ].map(({ label, key, fmt: f, invert }) => (
              <div key={key} className="card" style={{ marginBottom: 0 }}>
                <div className="card-title">{label}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Esta semana</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#1B3A6B' }}>
                      {f ? fmt(comp.actual[key]) : comp.actual[key]}
                      <DeltaBadge val={comp.deltas[key]} invert={invert} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="text-muted" style={{ fontSize: 12 }}>Semana anterior</div>
                    <div style={{ fontSize: 16, color: '#888' }}>{f ? fmt(comp.anterior[key]) : comp.anterior[key]}</div>
                  </div>
                </div>
              </div>
            ))}
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-title">Utilidad semana actual</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: parseFloat(comp.actual.ventas) - parseFloat(comp.actual.gastos) >= 0 ? '#0F6E56' : '#A32D2D' }}>
                {fmt(parseFloat(comp.actual.ventas) - parseFloat(comp.actual.gastos))}
              </div>
              <div className="text-muted">vs {fmt(parseFloat(comp.anterior.ventas) - parseFloat(comp.anterior.gastos))} semana anterior</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'mensual' && (
        <div>
          <div className="card">
            <div className="card-title">Ventas vs Gastos — últimos 6 meses</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mensual}>
                <XAxis dataKey="mes_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
                <Tooltip formatter={v => fmt(v)} />
                <Legend />
                <Bar dataKey="ventas" name="Ventas" fill="#1B3A6B" radius={[4,4,0,0]} />
                <Bar dataKey="gastos" name="Gastos" fill="#E87722" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="card-title">Utilidad mensual</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={mensual}>
                <XAxis dataKey="mes_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
                <Tooltip formatter={v => fmt(v)} />
                <ReferenceLine y={0} stroke="#E24B4A" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="utilidad" name="Utilidad" stroke="#0F6E56" strokeWidth={2} dot={{ fill: '#0F6E56' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="card-title">Resumen por mes</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Mes</th><th>Ventas</th><th>Gastos</th><th>Utilidad</th><th>Margen %</th></tr></thead>
                <tbody>
                  {mensual.map((m, i) => {
                    const margen = m.ventas > 0 ? ((m.utilidad / m.ventas) * 100).toFixed(1) : 0;
                    return (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{m.mes_label}</td>
                        <td style={{ color: '#1B3A6B' }}>{fmt(m.ventas)}</td>
                        <td style={{ color: '#A32D2D' }}>{fmt(m.gastos)}</td>
                        <td style={{ fontWeight: 600, color: m.utilidad >= 0 ? '#0F6E56' : '#A32D2D' }}>{fmt(m.utilidad)}</td>
                        <td><span className={`badge ${parseFloat(margen) >= 15 ? 'badge-green' : parseFloat(margen) >= 10 ? 'badge-amber' : 'badge-red'}`}>{margen}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'productos' && (
        <div className="card">
          <div className="card-title">Ventas por producto — últimos 30 días</div>
          {porProducto.length === 0 ? <div className="empty">Sin datos</div> : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={porProducto} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
                  <YAxis dataKey="producto" type="category" tick={{ fontSize: 12 }} width={80} />
                  <Tooltip formatter={v => fmt(v)} />
                  <Bar dataKey="total" name="Total" fill="#1B3A6B" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Producto</th><th>Ventas</th><th>Operaciones</th><th>Ticket promedio</th></tr></thead>
                  <tbody>
                    {porProducto.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 500 }}>{p.producto}</td>
                        <td style={{ color: '#1B3A6B', fontWeight: 600 }}>{fmt(p.total)}</td>
                        <td>{p.operaciones}</td>
                        <td>{fmt(p.ticket_promedio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'flota' && (
        <div className="card">
          <div className="card-title">Viajes por semana — últimas 8 semanas</div>
          {viajesSem.length === 0 ? <div className="empty">Sin datos</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={viajesSem}>
                <XAxis dataKey="semana_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine y={25} stroke="#E87722" strokeDasharray="4 4" label={{ value: 'Meta 25', fontSize: 11, fill: '#E87722' }} />
                <Bar dataKey="completados" name="Viajes completados" fill="#1B3A6B" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {tab === 'margen' && (
        <div className="card">
          <div className="card-title">Margen de utilidad — últimas 8 semanas</div>
          {margenSem.length === 0 ? <div className="empty">Sin datos</div> : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={margenSem}>
                <XAxis dataKey="semana_label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v + '%'} domain={[0, 'auto']} />
                <Tooltip formatter={v => v + '%'} />
                <ReferenceLine y={15} stroke="#E87722" strokeDasharray="4 4" label={{ value: 'Meta 15%', fontSize: 11, fill: '#E87722' }} />
                <Line type="monotone" dataKey="margen" name="Margen %" stroke="#1B3A6B" strokeWidth={2} dot={{ fill: '#1B3A6B' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}
