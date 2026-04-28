import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';

const fmt2 = n => (parseFloat(n) || 0).toFixed(2);
const fmt$ = n => '$' + (parseFloat(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0 });
const fmtN = n => (parseFloat(n) || 0).toLocaleString('es-MX');

// ── Semáforo de rendimiento (lt/km) ──────────────────────────────
// Meta: 1.8–2.0 lt/km. Arriba de 2.0 = alerta roja.
function SemaforoRend({ valor, mini = false }) {
  const v = parseFloat(valor) || 0;
  if (v === 0) return <span style={{ color: '#9ca3af', fontSize: mini ? 12 : 14 }}>Sin datos</span>;
  const color = v > 2.0 ? '#dc2626' : v >= 1.8 ? '#16a34a' : '#d97706';
  const label = v > 2.0 ? '▲ Alto consumo' : v >= 1.8 ? '✓ En rango' : '▼ Bajo consumo';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mini ? 'flex-end' : 'center' }}>
      <span style={{ fontWeight: 700, color, fontSize: mini ? 14 : 20 }}>{fmt2(v)} lt/km</span>
      {!mini && <span style={{ fontSize: 11, color, marginTop: 2 }}>{label}</span>}
    </div>
  );
}

// ── Barra de rendimiento ──────────────────────────────────────────
function BarraRend({ valor }) {
  const v = parseFloat(valor) || 0;
  if (v === 0) return <span style={{ color: '#9ca3af', fontSize: 12 }}>Sin km</span>;
  // 0 = verde, 2.0 = límite, 3.0+ = rojo máximo
  const pct = Math.min(100, (v / 3.0) * 100);
  const color = v > 2.0 ? '#dc2626' : v >= 1.8 ? '#16a34a' : '#d97706';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 8, minWidth: 80 }}>
        <div style={{ width: pct + '%', background: color, height: 8, borderRadius: 4, transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 52 }}>{fmt2(v)} l/km</span>
    </div>
  );
}

// ── Selector de período ───────────────────────────────────────────
function SelectorPeriodo({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
      <option value="semana">Esta semana</option>
      <option value="mes">Este mes</option>
      <option value="30d">Últimos 30 días</option>
    </select>
  );
}

// ══════════════════════════════════════════════════════════════════
export default function Logistica() {
  const [tab,       setTab]       = useState('resumen');
  const [periodo,   setPeriodo]   = useState('mes');
  const [kpis,      setKpis]      = useState(null);
  const [operadores,setOperadores]= useState([]);
  const [unidades,  setUnidades]  = useState([]);
  const [destinos,  setDestinos]  = useState([]);
  const [alertas,   setAlertas]   = useState(null);
  const [loading,   setLoading]   = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    const p = `?periodo=${periodo}`;
    try {
      const [k, o, u, d, a] = await Promise.all([
        api.logisticaKpis(p),
        api.logisticaPorOperador(p),
        api.logisticaPorUnidad(p),
        api.logisticaDestinos(p),
        api.logisticaAlertas(),
      ]);
      setKpis(k); setOperadores(o); setUnidades(u); setDestinos(d); setAlertas(a);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [periodo]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalAlertas = alertas
    ? (alertas.operadores_alerta?.length || 0) +
      (alertas.unidades_alerta?.length || 0) +
      (alertas.mantenimientos_vencidos?.length || 0)
    : 0;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2>Logística Avanzada — KPIs</h2>
          <p>Rendimiento lt/km · Costo por tonelada · Disponibilidad de flota</p>
        </div>
        <SelectorPeriodo value={periodo} onChange={setPeriodo} />
      </div>

      {/* ── Tarjetas KPI ── */}
      {kpis && (
        <div className="metric-grid">
          <div className="metric">
            <div className="metric-label">Viajes completados</div>
            <div className="metric-value orange">{kpis.viajes_completados}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Km totales</div>
            <div className="metric-value navy">{fmtN(kpis.total_km)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Litros consumidos</div>
            <div className="metric-value">{fmtN(kpis.total_litros)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Gasto en diésel</div>
            <div className="metric-value red">{fmt$(kpis.total_costo_diesel)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Toneladas movidas</div>
            <div className="metric-value">{fmtN(kpis.total_toneladas)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Costo / tonelada</div>
            <div className="metric-value navy">{fmt$(kpis.costo_por_tonelada)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Rendimiento flota</div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <SemaforoRend valor={kpis.rendimiento_flota} />
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">Disponibilidad flota</div>
            <div className="metric-value" style={{ color: kpis.pct_disponibilidad >= 80 ? '#16a34a' : '#dc2626' }}>
              {kpis.pct_disponibilidad}%
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              {kpis.disponibles}/{kpis.total_activas} unidades
              {kpis.en_mantenimiento > 0 && ` · ${kpis.en_mantenimiento} en mant.`}
            </div>
          </div>
        </div>
      )}

      {/* Referencia de meta */}
      {kpis && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, fontSize: 12 }}>
          <span style={{ color: '#16a34a', fontWeight: 600 }}>● 1.8–2.0 lt/km = rango óptimo</span>
          <span style={{ color: '#d97706', fontWeight: 600 }}>● &lt;1.8 lt/km = bajo consumo</span>
          <span style={{ color: '#dc2626', fontWeight: 600 }}>● &gt;2.0 lt/km = alto consumo (alerta)</span>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {['resumen','operadores','unidades','destinos','alertas'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'resumen'    ? 'Resumen'       :
             t === 'operadores' ? 'Por Operador'  :
             t === 'unidades'   ? 'Por Unidad'    :
             t === 'destinos'   ? 'Destinos'      :
             `Alertas${totalAlertas > 0 ? ` (${totalAlertas})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── RESUMEN ── */}
      {tab === 'resumen' && (
        <div className="card">
          <div className="card-title">Comparativo de operadores — {periodo === 'semana' ? 'esta semana' : periodo === 'mes' ? 'este mes' : 'últimos 30 días'}</div>
          {loading ? <div className="empty">Calculando...</div> :
            operadores.filter(o => parseInt(o.viajes) > 0).length === 0
              ? <div className="empty">Sin viajes con km registrados en este período</div>
              : operadores.filter(o => parseInt(o.viajes) > 0).map(o => (
                  <div key={o.operador_id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{o.operador}</span>
                      <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#555', flexWrap: 'wrap' }}>
                        <span>{o.viajes} viajes</span>
                        <span>{fmtN(o.km_total)} km</span>
                        <span>{fmtN(o.litros_total)} lts</span>
                        <span style={{ color: '#dc2626', fontWeight: 500 }}>{fmt$(o.costo_total)}</span>
                        {parseFloat(o.toneladas_total) > 0 && <span>{fmtN(o.toneladas_total)} ton</span>}
                      </div>
                    </div>
                    <BarraRend valor={o.rendimiento_lt_km} />
                  </div>
                ))
          }
        </div>
      )}

      {/* ── POR OPERADOR ── */}
      {tab === 'operadores' && (
        <div className="card">
          <div className="card-title">Rendimiento por Operador</div>
          {loading ? <div className="empty">Calculando...</div> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th className="text-right">Viajes</th>
                    <th className="text-right">Km</th>
                    <th className="text-right">Litros</th>
                    <th className="text-right">Costo diésel</th>
                    <th className="text-right">Toneladas</th>
                    <th className="text-right">$/ton</th>
                    <th>Rendimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {operadores.map(o => (
                    <tr key={o.operador_id}>
                      <td style={{ fontWeight: 500 }}>{o.operador}</td>
                      <td className="text-right">{o.viajes}</td>
                      <td className="text-right">{fmtN(o.km_total)}</td>
                      <td className="text-right">{fmtN(o.litros_total)}</td>
                      <td className="text-right" style={{ color: '#dc2626' }}>{fmt$(o.costo_total)}</td>
                      <td className="text-right">{fmtN(o.toneladas_total)}</td>
                      <td className="text-right">{parseFloat(o.costo_por_ton) > 0 ? fmt$(o.costo_por_ton) : '—'}</td>
                      <td style={{ minWidth: 160 }}><BarraRend valor={o.rendimiento_lt_km} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── POR UNIDAD ── */}
      {tab === 'unidades' && (
        <div className="card">
          <div className="card-title">Rendimiento por Unidad</div>
          {loading ? <div className="empty">Calculando...</div> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unidad</th>
                    <th className="text-right">Viajes</th>
                    <th className="text-right">Km</th>
                    <th className="text-right">Litros</th>
                    <th className="text-right">Costo diésel</th>
                    <th className="text-right">Toneladas</th>
                    <th className="text-right">$/ton</th>
                    <th>Rendimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {unidades.map(u => (
                    <tr key={u.unidad_id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.placas}</div>
                        <div style={{ fontSize: 11, color: '#888' }}>{[u.marca, u.modelo].filter(Boolean).join(' ') || u.descripcion}</div>
                      </td>
                      <td className="text-right">{u.viajes}</td>
                      <td className="text-right">{fmtN(u.km_total)}</td>
                      <td className="text-right">{fmtN(u.litros_total)}</td>
                      <td className="text-right" style={{ color: '#dc2626' }}>{fmt$(u.costo_total)}</td>
                      <td className="text-right">{fmtN(u.toneladas_total)}</td>
                      <td className="text-right">{parseFloat(u.costo_por_ton) > 0 ? fmt$(u.costo_por_ton) : '—'}</td>
                      <td style={{ minWidth: 160 }}><BarraRend valor={u.rendimiento_lt_km} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DESTINOS ── */}
      {tab === 'destinos' && (
        <div className="card">
          <div className="card-title">Top destinos más frecuentes</div>
          {loading ? <div className="empty">Calculando...</div> : destinos.length === 0
            ? <div className="empty">Sin datos de destinos</div>
            : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Destino</th>
                      <th className="text-right">Viajes</th>
                      <th className="text-right">Km prom.</th>
                      <th className="text-right">Costo prom.</th>
                      <th className="text-right">Toneladas</th>
                      <th className="text-right">Costo total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {destinos.map((d, i) => {
                      const maxViajes = destinos[0]?.viajes || 1;
                      const pct = Math.round((d.viajes / maxViajes) * 100);
                      return (
                        <tr key={d.destino}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 500 }}>{d.destino}</span>
                            </div>
                            <div style={{ background: '#f3f4f6', borderRadius: 3, height: 5, marginTop: 4 }}>
                              <div style={{ width: pct + '%', background: '#1B3A6B', height: 5, borderRadius: 3 }} />
                            </div>
                          </td>
                          <td className="text-right fw-500">{d.viajes}</td>
                          <td className="text-right">{parseFloat(d.km_promedio) > 0 ? `${fmt2(d.km_promedio)} km` : '—'}</td>
                          <td className="text-right">{fmt$(d.costo_promedio)}</td>
                          <td className="text-right">{fmtN(d.toneladas_total)}</td>
                          <td className="text-right" style={{ color: '#dc2626' }}>{fmt$(d.costo_total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── ALERTAS ── */}
      {tab === 'alertas' && (
        <div>
          {!alertas ? <div className="empty">Cargando alertas...</div> : (
            <>
              {/* Operadores con alto consumo */}
              <div className="card">
                <div className="card-title" style={{ color: alertas.operadores_alerta?.length ? '#dc2626' : undefined }}>
                  🔴 Operadores con alto consumo (&gt;{alertas.meta_lt_km_max} lt/km)
                </div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>{alertas.periodo}</div>
                {alertas.operadores_alerta?.length === 0
                  ? <div className="empty" style={{ color: '#16a34a' }}>✓ Todos los operadores dentro del rango óptimo</div>
                  : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Operador</th><th className="text-right">Viajes</th><th className="text-right">Costo diésel</th><th>Rendimiento</th></tr></thead>
                        <tbody>
                          {alertas.operadores_alerta.map(o => (
                            <tr key={o.operador} style={{ background: '#fff5f5' }}>
                              <td style={{ fontWeight: 600 }}>{o.operador}</td>
                              <td className="text-right">{o.viajes}</td>
                              <td className="text-right" style={{ color: '#dc2626' }}>{fmt$(o.costo_diesel)}</td>
                              <td><SemaforoRend valor={o.rendimiento_lt_km} mini /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              {/* Unidades con alto consumo */}
              <div className="card">
                <div className="card-title" style={{ color: alertas.unidades_alerta?.length ? '#dc2626' : undefined }}>
                  🔴 Unidades con alto consumo (&gt;{alertas.meta_lt_km_max} lt/km)
                </div>
                {alertas.unidades_alerta?.length === 0
                  ? <div className="empty" style={{ color: '#16a34a' }}>✓ Todas las unidades dentro del rango óptimo</div>
                  : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Unidad</th><th className="text-right">Viajes</th><th className="text-right">Costo diésel</th><th>Rendimiento</th></tr></thead>
                        <tbody>
                          {alertas.unidades_alerta.map(u => (
                            <tr key={u.placas} style={{ background: '#fff5f5' }}>
                              <td><span style={{ fontWeight: 600 }}>{u.placas}</span> <span style={{ color: '#888', fontSize: 12 }}>{u.descripcion}</span></td>
                              <td className="text-right">{u.viajes}</td>
                              <td className="text-right" style={{ color: '#dc2626' }}>{fmt$(u.costo_diesel)}</td>
                              <td><SemaforoRend valor={u.rendimiento_lt_km} mini /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>

              {/* Mantenimientos vencidos */}
              <div className="card">
                <div className="card-title" style={{ color: alertas.mantenimientos_vencidos?.length ? '#d97706' : undefined }}>
                  🟡 Mantenimientos vencidos
                </div>
                {alertas.mantenimientos_vencidos?.length === 0
                  ? <div className="empty" style={{ color: '#16a34a' }}>✓ Sin mantenimientos vencidos</div>
                  : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Unidad</th><th>Tipo</th><th>Debió hacerse</th><th>Días vencido</th></tr></thead>
                        <tbody>
                          {alertas.mantenimientos_vencidos.map((m, i) => (
                            <tr key={i} style={{ background: '#fffbeb' }}>
                              <td><span style={{ fontWeight: 600 }}>{m.placas}</span> <span style={{ color: '#888', fontSize: 12 }}>{m.descripcion}</span></td>
                              <td><span className="badge badge-amber">{m.tipo}</span></td>
                              <td>{m.proximo_fecha ? new Date(m.proximo_fecha).toLocaleDateString('es-MX') : '—'}</td>
                              <td style={{ color: '#d97706', fontWeight: 700 }}>{m.dias_vencido} días</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
