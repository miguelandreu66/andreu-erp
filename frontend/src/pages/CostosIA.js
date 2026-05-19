import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';

// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Costos IA
// Muestra cuánto gastan los 7 agentes Claude (Director, Operaciones,
// CFO, Abogado, Contador, RRHH, Comercial)
// ════════════════════════════════════════════════════════════════

const PERIODOS = [
  { label: '7 días',  dias: 7 },
  { label: '30 días', dias: 30 },
  { label: '90 días', dias: 90 },
];

const COLORES_MODELO = {
  'claude-opus-4-7':   { bg: '#f3e8ff', border: '#7c3aed', label: 'Opus 4.7'   },
  'claude-opus-4-6':   { bg: '#f3e8ff', border: '#7c3aed', label: 'Opus 4.6'   },
  'claude-sonnet-4-6': { bg: '#dbeafe', border: '#3b82f6', label: 'Sonnet 4.6' },
  'claude-sonnet-4-5': { bg: '#dbeafe', border: '#3b82f6', label: 'Sonnet 4.5' },
  'claude-haiku-4-5':  { bg: '#dcfce7', border: '#16a34a', label: 'Haiku 4.5'  },
};

export default function CostosIA() {
  const toast = useToast();
  const [dias, setDias] = useState(30);
  const [costos, setCostos] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    cargar(dias);
  }, [dias]);

  async function cargar(d) {
    try {
      setLoading(true);
      const [c, h] = await Promise.all([
        api.agentesCostos(d).catch(() => ({ por_agente: [], totales: {} })),
        api.agentesHistorial(`?limite=25`).catch(() => ({ invocaciones: [] })),
      ]);
      setCostos(c);
      setHistorial(h.invocaciones || h || []);
    } catch (e) {
      toast?.error?.('No se pudieron cargar los costos: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const totales = useMemo(() => {
    if (!costos) return null;
    const t = costos.totales || {};
    return {
      total_usd:     Number(t.total_usd ?? 0),
      total_mxn:     Number(t.total_usd ?? 0) * 17.5,
      invocaciones:  Number(t.invocaciones ?? 0),
      tokens_input:  Number(t.tokens_input ?? 0),
      tokens_output: Number(t.tokens_output ?? 0),
      cache_read:    Number(t.cache_read ?? 0),
      cache_write:   Number(t.cache_write ?? 0),
    };
  }, [costos]);

  const porAgente = costos?.por_agente || [];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>💸 Costos IA</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Cuánto gastan los 7 agentes IA de Andreu Logistics en los últimos {dias} días
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

      {loading && <div style={{ color: '#6b7280', padding: 20 }}>Cargando costos...</div>}

      {!loading && totales && (
        <>
          {/* Tarjetas resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <ResumenCard titulo="Total USD"      valor={`$${totales.total_usd.toFixed(2)}`}   acento="#1B3A6B" />
            <ResumenCard titulo="Total MXN (≈)"  valor={`$${totales.total_mxn.toFixed(0)}`}    acento="#0f766e" />
            <ResumenCard titulo="Invocaciones"   valor={totales.invocaciones.toLocaleString()} acento="#3b82f6" />
            <ResumenCard titulo="Tokens input"   valor={formatNum(totales.tokens_input)}       acento="#16a34a" />
            <ResumenCard titulo="Tokens output"  valor={formatNum(totales.tokens_output)}      acento="#16a34a" />
            <ResumenCard titulo="Cache hits"     valor={formatNum(totales.cache_read)}         acento="#9333ea"
              tooltip="Tokens leídos de cache (90% más baratos)" />
          </div>

          {/* Tabla por agente */}
          <Card titulo="Gasto por agente IA">
            {porAgente.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>
                Aún no hay invocaciones registradas en este periodo. Habla con cualquier agente desde Agentes IA para empezar a generar histórico.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <Th>Agente</Th>
                      <Th>Modelo</Th>
                      <Th>Invocaciones</Th>
                      <Th>Tokens input</Th>
                      <Th>Tokens output</Th>
                      <Th>Costo USD</Th>
                      <Th>% del total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {porAgente.map((a, i) => {
                      const pct = totales.total_usd > 0 ? (Number(a.total_usd || 0) / totales.total_usd) * 100 : 0;
                      const color = COLORES_MODELO[a.modelo] || { bg: '#f3f4f6', border: '#6b7280', label: a.modelo };
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <Td><strong>{a.agente}</strong></Td>
                          <Td>
                            <span style={{
                              background: color.bg,
                              border: `1px solid ${color.border}`,
                              borderRadius: 6,
                              padding: '2px 8px',
                              fontSize: 11,
                              color: color.border,
                              fontWeight: 600,
                            }}>{color.label}</span>
                          </Td>
                          <Td>{Number(a.invocaciones || 0).toLocaleString()}</Td>
                          <Td>{formatNum(a.tokens_input || 0)}</Td>
                          <Td>{formatNum(a.tokens_output || 0)}</Td>
                          <Td><strong style={{ color: '#1B3A6B' }}>${Number(a.total_usd || 0).toFixed(4)}</strong></Td>
                          <Td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <div style={{ width: 60, height: 6, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                  width: `${pct}%`, height: '100%',
                                  background: '#1B3A6B',
                                }} />
                              </div>
                              <span style={{ fontSize: 11, color: '#6b7280' }}>{pct.toFixed(1)}%</span>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Últimas invocaciones */}
          <Card titulo="Últimas 25 invocaciones">
            {historial.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>Sin invocaciones recientes.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <Th>Fecha</Th>
                      <Th>Agente</Th>
                      <Th>Modelo</Th>
                      <Th>Tokens</Th>
                      <Th>Costo</Th>
                      <Th>Latencia</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((h, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <Td>{h.creado_en ? new Date(h.creado_en).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</Td>
                        <Td>{h.agente_nombre || h.agente || '—'}</Td>
                        <Td><small style={{ color: '#6b7280' }}>{h.modelo || '—'}</small></Td>
                        <Td>{formatNum(h.tokens_input || 0)} → {formatNum(h.tokens_output || 0)}</Td>
                        <Td style={{ color: '#1B3A6B', fontWeight: 600 }}>${Number(h.costo_usd || 0).toFixed(4)}</Td>
                        <Td>{h.latencia_ms ? `${h.latencia_ms}ms` : '—'}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Tips */}
          <div style={{
            background: '#fefce8',
            border: '1px solid #fde68a',
            borderRadius: 8,
            padding: 16,
            marginTop: 20,
            fontSize: 13,
            color: '#713f12',
          }}>
            <strong>💡 Tips para bajar costos en Andreu</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 22, lineHeight: 1.7 }}>
              <li><strong>CFO IA</strong> y <strong>Director IA</strong> usan Opus 4.7 — son los más caros. Úsalos solo para decisiones estratégicas.</li>
              <li><strong>Operaciones IA</strong> y <strong>RRHH IA</strong> (Sonnet 4.6) cuestan ~5x menos. Para preguntas operativas, prefiérelos.</li>
              <li>El <strong>supervisor IA del Autopilot</strong> (comando AI legacy) cachea contexto — sus invocaciones repetidas son muy baratas.</li>
              <li>Si el gasto pasa de USD 30/mes, plantéate bajar Abogado/Contador a Sonnet en su configuración.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function ResumenCard({ titulo, valor, acento, tooltip }) {
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

function formatNum(n) {
  const num = Number(n || 0);
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'k';
  return num.toString();
}
