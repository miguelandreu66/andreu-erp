import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');
const fmtN = n => (parseFloat(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });

const ROL_LABEL = {
  director: 'Director',
  admin: 'Administrador General',
  logistica: 'Coordinador Operativo',
  monitoreo: 'Monitoreo',
  caja: 'Auxiliar Administrativo',
};

export default function Dashboard() {
  const { usuario } = useAuth();
  const [dash, setDash] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [insights, setInsights] = useState(null);
  const [kpisFlota, setKpisFlota] = useState(null);
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [d, b, i, k, s] = await Promise.all([
        api.caiDashboard().catch(() => null),
        api.caiBriefing().catch(() => null),
        api.caiInsightsAll().catch(() => null),
        api.logisticaKpis('?periodo=mes').catch(() => null),
        api.caiSetupStatus().catch(() => null),
      ]);
      setDash(d); setBriefing(b); setInsights(i); setKpisFlota(k); setSetup(s);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Error al cargar dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, [cargar]);

  if (loading) return <div className="empty">Cargando panel operativo...</div>;

  const resumen = dash?.resumen || {};
  const posiciones = dash?.posiciones || [];
  const reportandoVivo = posiciones.filter(p => p.minutos_desde_ultimo != null && p.minutos_desde_ultimo <= 15).length;
  const enRuta = posiciones.filter(p => p.estado_visual === 'en_ruta').length;
  const sinSenal = posiciones.filter(p => p.estado_visual === 'sin_senal').length;

  const hoyTxt = new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>🚛 Andreu Logistics</h2>
        <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
          {hoyTxt} · {usuario?.nombre} · {ROL_LABEL[usuario?.rol] || usuario?.rol}
        </p>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #dc2626', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          ⚠️ {error}
        </div>
      )}

      {setup && !setup.onboarding_completo && (
        <OnboardingWizard setup={setup} />
      )}

      {briefing && briefing.texto && (
        <div style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          color: '#fff', padding: 22, borderRadius: 14, marginBottom: 20,
          fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 13, lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
        }}>
          {briefing.texto}
        </div>
      )}

      <div className="metric-grid" style={{ marginBottom: 20 }}>
        <KpiCard label="Viajes en ruta" value={enRuta} color="#16a34a" sub={`${reportandoVivo} unidad(es) reportando`} />
        <KpiCard label="Unidades sin señal" value={sinSenal} color={sinSenal > 0 ? '#dc2626' : '#9ca3af'} sub={sinSenal > 0 ? 'Atención inmediata' : 'Todas conectadas'} />
        <KpiCard label="Alertas críticas" value={resumen.alertas_criticas || 0} color={resumen.alertas_criticas > 0 ? '#dc2626' : '#16a34a'} sub={`${resumen.alertas_totales || 0} totales`} />
        <KpiCard label="Diesel últimos 7d" value={fmt$(resumen.diesel_7d || 0)} color="#d97706" sub={`${fmtN(resumen.litros_7d || 0)} L`} />
        <KpiCard label="Ingresos 30d" value={fmt$(briefing?.metricas?.ingresos_30d || 0)} color="#1B3A6B" sub={`${briefing?.metricas?.viajes_7d || 0} viajes últimos 7d`} />
        <KpiCard label="Clientes activos" value={briefing?.metricas?.clientes_activos || 0} color="#1B3A6B" sub="En cartera" />
      </div>

      {kpisFlota && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">📡 KPIs de flota — mes actual</div>
          <div className="metric-grid" style={{ marginTop: 8 }}>
            <Mini label="Viajes completados" value={kpisFlota.viajes_completados || 0} />
            <Mini label="KM totales" value={fmtN(kpisFlota.total_km || 0)} />
            <Mini label="Toneladas movidas" value={fmtN(kpisFlota.total_toneladas || 0)} />
            <Mini label="Rendimiento flota" value={(parseFloat(kpisFlota.rendimiento_flota || 0)).toFixed(2) + ' lt/km'} />
            <Mini label="Costo / tonelada" value={fmt$(kpisFlota.costo_por_tonelada || 0)} />
            <Mini label="Disponibilidad" value={(kpisFlota.pct_disponibilidad ?? 0) + '%'} />
          </div>
        </div>
      )}

      {insights && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
          <QuickAlert icon="💳" color="#dc2626" label="Cobranza vencida"
            value={insights.cobranza?.count || 0}
            amount={insights.cobranza?.total_vencido ? fmt$(insights.cobranza.total_vencido) : null}
            href="/cxc" />
          <QuickAlert icon="⚠️" color="#d97706" label="Clientes en riesgo"
            value={insights.riesgo?.count || 0}
            amount=">60 días sin actividad"
            href="/command-ai" />
          <QuickAlert icon="📄" color="#2563eb" label="Cotizaciones sin convertir"
            value={insights.cotizaciones?.count || 0}
            amount={insights.cotizaciones?.total_potencial ? fmt$(insights.cotizaciones.total_potencial) + ' potencial' : null}
            href="/cotizaciones" />
          <QuickAlert icon="🤖" color="#16a34a" label="Centro de control"
            value="Abrir" amount="Command AI en vivo" href="/command-ai" />
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">🗺️ Flota en vivo — última posición</div>
        {posiciones.length === 0 ? (
          <div style={{ padding: 20, color: '#6b7280', fontSize: 14 }}>
            Sin unidades registradas todavía. Da de alta tu flota en el módulo <strong>Unidades</strong> para verla aquí.
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Unidad</th>
                  <th>Operador</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'right' }}>Velocidad</th>
                  <th>Última señal</th>
                  <th>Destino</th>
                </tr>
              </thead>
              <tbody>
                {posiciones.map(p => (
                  <tr key={p.unidad_id}>
                    <td style={{ fontWeight: 600 }}>{p.placas}</td>
                    <td>{p.operador || <span style={{ color: '#9ca3af' }}>Sin asignar</span>}</td>
                    <td><EstadoBadge estado={p.estado_visual} /></td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {p.velocidad_kmh != null ? `${parseFloat(p.velocidad_kmh).toFixed(0)} km/h` : '—'}
                    </td>
                    <td>
                      {p.minutos_desde_ultimo != null
                        ? <span style={{ color: p.minutos_desde_ultimo > 15 ? '#dc2626' : '#16a34a', fontSize: 13 }}>
                            hace {Math.round(p.minutos_desde_ultimo)} min
                          </span>
                        : <span style={{ color: '#9ca3af', fontSize: 13 }}>Sin GPS</span>}
                    </td>
                    <td>{p.destino || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {kpisFlota && kpisFlota.viajes_completados > 0 && <TopOperadoresChart />}
    </div>
  );
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div style={{ background: '#f9fafb', padding: 12, borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function QuickAlert({ icon, color, label, value, amount, href }) {
  return (
    <a href={href} style={{
      display: 'block', background: '#fff', border: `1px solid ${color}30`, borderLeft: `4px solid ${color}`,
      borderRadius: 10, padding: 14, textDecoration: 'none', color: 'inherit',
      transition: 'transform .1s', cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontSize: 22 }}>{icon}</div>
        <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>{label}</div>
      {amount && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{amount}</div>}
    </a>
  );
}

function EstadoBadge({ estado }) {
  const map = {
    en_ruta:   { bg: '#16a34a', txt: 'En ruta' },
    activa:    { bg: '#22c55e', txt: 'Activa' },
    detenido:  { bg: '#6b7280', txt: 'Detenida' },
    alerta:    { bg: '#dc2626', txt: 'Alerta' },
    sin_senal: { bg: '#7c2d12', txt: 'Sin señal' },
    sin_datos: { bg: '#9ca3af', txt: 'Sin GPS' },
  };
  const e = map[estado] || map.sin_datos;
  return (
    <span style={{
      background: e.bg, color: '#fff', padding: '3px 10px',
      borderRadius: 999, fontSize: 11, fontWeight: 600,
    }}>{e.txt}</span>
  );
}

function OnboardingWizard({ setup }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #E87722 0%, #d97706 100%)',
      color: '#fff', padding: 24, borderRadius: 14, marginBottom: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, letterSpacing: 1, textTransform: 'uppercase' }}>
            ⚙️ Configuración inicial — Andreu Logistics
          </div>
          <h2 style={{ margin: '6px 0 4px', fontSize: 22 }}>
            {setup.completion_pct}% completado · {setup.completos} de {setup.total} pasos
          </h2>
          <p style={{ margin: 0, opacity: 0.92, fontSize: 14 }}>
            Termina estos pasos para que tu sistema cobre vida con datos reales.
          </p>
        </div>
        <div style={{
          fontSize: 48, fontWeight: 900, textAlign: 'center', lineHeight: 1,
          background: 'rgba(255,255,255,.15)', padding: '12px 20px', borderRadius: 12,
        }}>
          {setup.completion_pct}%
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,.2)', height: 8, borderRadius: 4, marginBottom: 18, overflow: 'hidden' }}>
        <div style={{
          background: '#fff', height: '100%', width: setup.completion_pct + '%',
          transition: 'width .5s ease',
        }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {setup.pasos.map((p, idx) => (
          <Link
            key={p.id}
            to={p.ruta}
            style={{
              background: p.completo ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.15)',
              border: '1px solid rgba(255,255,255,.3)',
              borderRadius: 10, padding: 14, color: '#fff', textDecoration: 'none',
              display: 'block', transition: 'transform .15s, background .15s',
              cursor: 'pointer',
              opacity: p.completo ? 0.8 : 1,
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontSize: 24 }}>{p.icono}</span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: p.completo ? '#16a34a' : 'rgba(0,0,0,.3)',
                padding: '3px 8px', borderRadius: 999,
              }}>
                {p.completo ? '✓ Listo' : `Paso ${idx + 1}`}
              </span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{p.titulo}</div>
            <div style={{ fontSize: 12, opacity: 0.92, lineHeight: 1.4 }}>{p.descripcion}</div>
            {!p.completo && p.meta > 1 && (
              <div style={{ fontSize: 11, marginTop: 8, opacity: 0.9 }}>
                Progreso: {p.progreso}/{p.meta}
              </div>
            )}
          </Link>
        ))}
      </div>

      {setup.completion_pct === 80 && (
        <div style={{ marginTop: 16, padding: 12, background: 'rgba(255,255,255,.2)', borderRadius: 8, fontSize: 13 }}>
          🔥 ¡Casi listo! Un paso más y tu sistema queda configurado.
        </div>
      )}
    </div>
  );
}

function TopOperadoresChart() {
  const [data, setData] = useState([]);
  useEffect(() => {
    api.logisticaPorOperador('?periodo=mes').then(rows => {
      setData((rows || []).filter(r => r.viajes > 0).slice(0, 5).map(r => ({
        operador: r.operador?.split(' ')[0] || r.operador,
        viajes: parseInt(r.viajes),
      })));
    }).catch(() => {});
  }, []);
  if (!data.length) return null;
  return (
    <div className="card">
      <div className="card-title">🏆 Top operadores — mes actual</div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 60, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis dataKey="operador" type="category" tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="viajes" fill="#E87722" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
