import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Legend, Cell,
} from 'recharts';
import { api } from '../api';
import { useToast } from '../context/ToastContext';

// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Página /operativo
// KPIs de flota propia: ingresos, gastos, margen, viajes,
// CXC, top operadores, gastos por categoría
// ════════════════════════════════════════════════════════════════

const PERIODOS = [
  { label: '7 días',  dias: 7 },
  { label: '30 días', dias: 30 },
  { label: '90 días', dias: 90 },
];

const COLORES_BARRAS = ['#1B3A6B', '#3b82f6', '#0f766e', '#9333ea', '#FF6B35', '#FFB627', '#16a34a', '#dc2626'];

export default function Operativo() {
  const toast = useToast();
  const [dias, setDias] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargar(dias);
  }, [dias]);

  async function cargar(d) {
    try {
      setLoading(true);
      const result = await api.dashboardOperativo(d);
      setData(result);
    } catch (e) {
      toast?.error?.('No se pudo cargar el operativo: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const kpis = data?.kpis;
  const margenPct = useMemo(() => {
    if (!kpis || !kpis.ingresos) return 0;
    return (kpis.margen_bruto / kpis.ingresos) * 100;
  }, [kpis]);

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>📊 Operativo Andreu</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Estado de tu flota propia en los últimos {dias} días
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {PERIODOS.map(p => (
            <button key={p.dias} onClick={() => setDias(p.dias)}
              style={{
                padding: '8px 14px',
                background: dias === p.dias ? '#1B3A6B' : '#fff',
                color: dias === p.dias ? '#fff' : '#1B3A6B',
                border: `1px solid #1B3A6B`,
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: 13,
              }}>{p.label}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ color: '#6b7280', padding: 20 }}>Cargando operativo...</div>}

      {!loading && data && (
        <>
          {/* ─── KPIs principales ─── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <KpiCard titulo="Ingresos"        valor={`$${formatMoney(kpis?.ingresos)}`}      acento="#16a34a" sub={`${kpis?.facturas_emitidas || 0} ventas`} />
            <KpiCard titulo="Gastos"          valor={`$${formatMoney(kpis?.gastos_total)}`}  acento="#dc2626" />
            <KpiCard titulo="Margen bruto"    valor={`$${formatMoney(kpis?.margen_bruto)}`}  acento={kpis?.margen_bruto >= 0 ? '#0f766e' : '#dc2626'}
              sub={`${margenPct.toFixed(1)}% del ingreso`} />
            <KpiCard titulo="Viajes"          valor={`${kpis?.viajes_completados || 0}/${kpis?.viajes_total || 0}`} acento="#3b82f6"
              sub="completados / total" />
            <KpiCard titulo="Ticket promedio" valor={`$${formatMoney(kpis?.ticket_promedio)}`} acento="#9333ea" />
            <KpiCard titulo="Por cobrar"      valor={`$${formatMoney(kpis?.por_cobrar)}`}    acento="#FF6B35" sub="CXC abierta" />
          </div>

          {/* ─── Serie diaria ingresos vs gastos ─── */}
          <Card titulo="📈 Ingresos vs. gastos diarios">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.serie_diaria}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="fecha" stroke="#6b7280" fontSize={11}
                  tickFormatter={(v) => v ? v.slice(5) : ''} />
                <YAxis stroke="#6b7280" fontSize={11}
                  tickFormatter={(v) => '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}
                  labelStyle={{ color: '#1B3A6B', fontWeight: 700 }}
                  formatter={(value, name) => [`$${formatMoney(value)}`, name]} />
                <Legend />
                <Line type="monotone" dataKey="ingresos" stroke="#16a34a" strokeWidth={2} dot={false} name="Ingresos" />
                <Line type="monotone" dataKey="gastos"   stroke="#dc2626" strokeWidth={2} dot={false} name="Gastos" />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          {/* Grid de 2 columnas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginBottom: 16 }}>

            {/* ─── Viajes completados por día ─── */}
            <Card titulo="🚛 Viajes completados por día">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.serie_diaria}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="fecha" stroke="#6b7280" fontSize={11}
                    tickFormatter={(v) => v ? v.slice(5) : ''} />
                  <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }} />
                  <Bar dataKey="viajes" fill="#1B3A6B" />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* ─── Gastos por categoría ─── */}
            <Card titulo="💸 Gastos por categoría">
              {data.gastos_categorias.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: 13 }}>Sin gastos en este periodo.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.gastos_categorias} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" stroke="#6b7280" fontSize={11}
                      tickFormatter={(v) => '$' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)} />
                    <YAxis dataKey="categoria" type="category" stroke="#6b7280" fontSize={11} width={80} />
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}
                      formatter={(v) => `$${formatMoney(v)}`} />
                    <Bar dataKey="total">
                      {data.gastos_categorias.map((_, i) => (
                        <Cell key={i} fill={COLORES_BARRAS[i % COLORES_BARRAS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ─── Top operadores ─── */}
          <Card titulo="👷 Top 5 operadores del periodo">
            {data.top_operadores.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>
                Aún no hay viajes asignados a operadores en este periodo.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <Th>#</Th>
                      <Th>Operador</Th>
                      <Th>Viajes totales</Th>
                      <Th>Completados</Th>
                      <Th>Tasa completitud</Th>
                      <Th>Km promedio</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_operadores.map((o, i) => {
                      const tasa = o.viajes_total > 0 ? (o.viajes_completados / o.viajes_total) * 100 : 0;
                      return (
                        <tr key={o.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <Td><strong style={{ color: '#1B3A6B' }}>{i + 1}</strong></Td>
                          <Td><strong>{o.nombre}</strong></Td>
                          <Td>{o.viajes_total}</Td>
                          <Td>{o.viajes_completados}</Td>
                          <Td>
                            <span style={{ color: tasa >= 90 ? '#16a34a' : tasa >= 70 ? '#FFB627' : '#dc2626', fontWeight: 600 }}>
                              {tasa.toFixed(0)}%
                            </span>
                          </Td>
                          <Td>{Math.round(o.km_promedio).toLocaleString()} km</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ─── Tip box ─── */}
          <div style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: 16,
            marginTop: 20,
            fontSize: 13,
            color: '#1e3a8a',
          }}>
            <strong>💡 Cómo interpretar esta página</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 22, lineHeight: 1.7 }}>
              <li><strong>Margen &lt; 25%</strong> = revisa gastos diesel + casetas. Algo está subiendo más de lo esperado.</li>
              <li><strong>Tasa completitud &lt; 90%</strong> en un operador = revisa incidencias o capacitación.</li>
              <li><strong>CXC arriba del 60% de los ingresos del mes</strong> = problema de cobranza. Activa Retención IA.</li>
              <li><strong>Picos de gasto un día específico</strong> = mantenimiento mayor o reparación, no panic.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ── Subcomponentes ──────────────────────────────────────────

function KpiCard({ titulo, valor, acento, sub, tooltip }) {
  return (
    <div title={tooltip} style={{
      background: '#fff',
      border: `1px solid #e5e7eb`,
      borderRadius: 8,
      padding: 14,
      borderLeft: `4px solid ${acento}`,
    }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: '#1A1A1A' }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Card({ titulo, children }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#1B3A6B' }}>{titulo}</h3>
      {children}
    </div>
  );
}

const Th = ({ children }) => <th style={{ padding: '8px 6px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{children}</th>;
const Td = ({ children, style }) => <td style={{ padding: '10px 6px', verticalAlign: 'middle', ...style }}>{children}</td>;

function formatMoney(n) {
  const num = Number(n || 0);
  return Math.round(num).toLocaleString('es-MX');
}
