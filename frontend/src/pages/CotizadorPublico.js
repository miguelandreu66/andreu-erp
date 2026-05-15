import React, { useState } from 'react';
import { api } from '../api';

const fmt$ = n => '$' + Math.round(parseFloat(n) || 0).toLocaleString('es-MX');

const TIPOS_CARGA = [
  { v: 'general',      l: 'General (block, cemento, materiales)' },
  { v: 'peligrosa',    l: '⚠️ Peligrosa (químicos, combustibles)' },
  { v: 'refrigerada',  l: '❄️ Refrigerada' },
  { v: 'fragil',       l: '🔶 Frágil' },
  { v: 'liquidos',     l: '💧 Líquidos' },
  { v: 'otro',         l: 'Otro' },
];

const RECURRENCIAS = [
  { v: 'unico',      l: 'Una sola vez' },
  { v: 'redondo',    l: 'Viaje redondo con carga de regreso (5% desc.)' },
  { v: 'mensual_2',  l: '2 viajes/mes' },
  { v: 'mensual_4',  l: '≥ 4 viajes/mes (10% desc.)' },
  { v: 'anual',      l: 'Contrato anual ≥ 50 viajes (15% desc.)' },
];

export default function CotizadorPublico() {
  const [form, setForm] = useState({
    contacto_nombre: '', empresa: '', email: '', telefono: '',
    origen: '', destino: '',
    toneladas: '', tipo_carga: 'general',
    fecha_solicitada: '', hora_salida: '',
    recurrencia: 'unico',
    servicios_extras: [],
    comentarios: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);

  const toggleExtra = (e) => {
    setForm(f => ({
      ...f,
      servicios_extras: f.servicios_extras.includes(e)
        ? f.servicios_extras.filter(x => x !== e)
        : [...f.servicios_extras, e],
    }));
  };

  const cotizar = async (e) => {
    e.preventDefault();
    if (!form.contacto_nombre || !form.origen || !form.destino) {
      setError('Nombre, origen y destino son obligatorios');
      return;
    }
    if (!form.email && !form.telefono) {
      setError('Déjanos un email o teléfono para contactarte');
      return;
    }
    setEnviando(true); setError(null);
    try {
      const body = {
        ...form,
        toneladas: form.toneladas ? parseFloat(form.toneladas) : null,
        fecha_solicitada: form.fecha_solicitada || null,
      };
      const r = await api.leadCotizarPublico(body);
      setResultado(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const nuevo = () => { setResultado(null); setError(null); };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #1B3A6B 0%, #0f1f3a 100%)',
      padding: '20px 16px',
      fontFamily: 'Arial, sans-serif',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Header con marca */}
        <div style={{ textAlign: 'center', color: '#fff', marginBottom: 24 }}>
          <div style={{ fontSize: 38, marginBottom: 4 }}>🚛</div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Andreu Logistics</h1>
          <p style={{ margin: '6px 0', opacity: 0.85, fontSize: 14 }}>Tu carga, en las manos correctas.</p>
          <div style={{ display: 'inline-block', background: 'rgba(255,255,255,.15)', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, marginTop: 8 }}>
            🤖 Cotización inteligente en 30 segundos
          </div>
        </div>

        {!resultado ? (
          <form onSubmit={cotizar} style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 8px 40px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#1B3A6B' }}>Cotiza tu flete</h2>
            <p style={{ margin: '0 0 18px', color: '#6b7280', fontSize: 13 }}>
              Llena los datos y obtén tu precio al instante. Sin esperas, sin promotor.
            </p>

            {error && <Alert tipo="red" txt={error} />}

            <Section titulo="📦 Datos del viaje">
              <Grid>
                <Field label="Origen *">
                  <input type="text" placeholder="Cuernavaca, Morelos" value={form.origen}
                    onChange={e => setForm({ ...form, origen: e.target.value })} required />
                </Field>
                <Field label="Destino *">
                  <input type="text" placeholder="Iguala, Guerrero" value={form.destino}
                    onChange={e => setForm({ ...form, destino: e.target.value })} required />
                </Field>
              </Grid>
              <Grid>
                <Field label="Toneladas">
                  <input type="number" step="0.1" min="0" placeholder="25" value={form.toneladas}
                    onChange={e => setForm({ ...form, toneladas: e.target.value })} />
                </Field>
                <Field label="Tipo de carga">
                  <select value={form.tipo_carga} onChange={e => setForm({ ...form, tipo_carga: e.target.value })}>
                    {TIPOS_CARGA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </Field>
              </Grid>
              <Grid>
                <Field label="Fecha solicitada">
                  <input type="date" value={form.fecha_solicitada}
                    onChange={e => setForm({ ...form, fecha_solicitada: e.target.value })} />
                </Field>
                <Field label="Hora de salida">
                  <input type="time" value={form.hora_salida}
                    onChange={e => setForm({ ...form, hora_salida: e.target.value })} />
                </Field>
              </Grid>
              <Field label="Frecuencia">
                <select value={form.recurrencia} onChange={e => setForm({ ...form, recurrencia: e.target.value })}>
                  {RECURRENCIAS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </Field>
            </Section>

            <Section titulo="➕ Servicios extras">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Extra label="🛡️ Custodia armada" value="custodia_armada" form={form} toggle={toggleExtra} />
                <Extra label="🏗️ Maniobras de carga/descarga" value="maniobras" form={form} toggle={toggleExtra} />
                <Extra label="⏱️ Estadía (espera prolongada)" value="estadia" form={form} toggle={toggleExtra} />
              </div>
            </Section>

            <Section titulo="👤 Tus datos de contacto">
              <Grid>
                <Field label="Tu nombre *">
                  <input type="text" placeholder="Juan Pérez" value={form.contacto_nombre}
                    onChange={e => setForm({ ...form, contacto_nombre: e.target.value })} required />
                </Field>
                <Field label="Empresa">
                  <input type="text" placeholder="Constructora ABC" value={form.empresa}
                    onChange={e => setForm({ ...form, empresa: e.target.value })} />
                </Field>
              </Grid>
              <Grid>
                <Field label="Email">
                  <input type="email" placeholder="juan@empresa.com" value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })} />
                </Field>
                <Field label="Teléfono / WhatsApp">
                  <input type="tel" placeholder="55 1234 5678" value={form.telefono}
                    onChange={e => setForm({ ...form, telefono: e.target.value })} />
                </Field>
              </Grid>
              <Field label="Comentarios (opcional)">
                <textarea rows={2} placeholder="Algo importante que debamos saber..."
                  value={form.comentarios}
                  onChange={e => setForm({ ...form, comentarios: e.target.value })} />
              </Field>
            </Section>

            <button type="submit" disabled={enviando} style={{
              width: '100%', padding: '14px 16px', background: '#E87722', color: '#fff',
              border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: 'pointer',
              marginTop: 8, boxShadow: '0 4px 12px rgba(232,119,34,.3)',
            }}>
              {enviando ? '🤖 Calculando...' : '✨ Generar cotización con IA'}
            </button>

            <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 14 }}>
              🔒 Tus datos no se comparten. Solo Andreu Logistics los usa para contactarte.
            </div>
          </form>
        ) : (
          <Resultado data={resultado} onNuevo={nuevo} />
        )}

        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,.6)', fontSize: 11, marginTop: 20 }}>
          Andreu Logistics · Cuernavaca, Morelos · Autotransporte federal de carga
        </div>
      </div>
    </div>
  );
}

function Resultado({ data, onNuevo }) {
  const c = data.cotizacion;
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: 22, boxShadow: '0 8px 40px rgba(0,0,0,.2)' }}>
      <div style={{ background: '#dcfce7', color: '#166534', padding: 14, borderRadius: 10, marginBottom: 18, textAlign: 'center' }}>
        ✅ <strong>{data.mensaje}</strong>
        <div style={{ fontSize: 12, marginTop: 4 }}>Folio: <strong>{data.folio}</strong></div>
        <a
          href={`/api/leads/pdf/${data.folio}`}
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-block', marginTop: 10, padding: '8px 16px',
            background: '#1B3A6B', color: '#fff', borderRadius: 8,
            textDecoration: 'none', fontWeight: 600, fontSize: 13,
          }}
        >📄 Descargar PDF de la cotización</a>
      </div>

      {c.analisis_broker && (
        <div style={{ background: '#dbeafe', color: '#1e3a8a', padding: 12, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
          🤝 <strong>Tu carga la opera nuestra red de transportistas confiables.</strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>{c.analisis_broker.sugerencia}</div>
        </div>
      )}

      {/* Precio principal grande */}
      <div style={{ textAlign: 'center', padding: '20px 0', borderBottom: '2px solid #f3f4f6', marginBottom: 18 }}>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
          Precio total con IVA
        </div>
        <div style={{ fontSize: 48, fontWeight: 900, color: '#1B3A6B', lineHeight: 1, marginTop: 8 }}>
          {fmt$(c.precio.total_con_iva)}
        </div>
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
          {c.ruta.origen} → {c.ruta.destino}
          <br />
          {c.ruta.distancia_km} km · ~{c.ruta.duracion_horas} hrs
        </div>
      </div>

      {/* Desglose */}
      <h3 style={{ margin: '0 0 10px', fontSize: 14, color: '#1B3A6B' }}>Desglose</h3>
      <div style={{ background: '#f9fafb', padding: 14, borderRadius: 10, fontSize: 13 }}>
        <Row k="Precio base" v={fmt$(c.precio.base)} />
        {c.precio.recargos.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e7eb' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Recargos:</div>
            {c.precio.recargos.map((r, i) => (
              <Row key={i} k={`  ${r.concepto}`} v={`+${fmt$(r.monto)} (${r.pct}%)`} small />
            ))}
          </div>
        )}
        {c.precio.descuentos.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e7eb' }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#166534' }}>Descuentos:</div>
            {c.precio.descuentos.map((d, i) => (
              <Row key={i} k={`  ${d.concepto}`} v={`-${fmt$(d.monto)} (${d.pct}%)`} small color="#166534" />
            ))}
          </div>
        )}
        {c.precio.extras.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e7eb' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Servicios extras:</div>
            {c.precio.extras.map((e, i) => (
              <Row key={i} k={`  ${e.concepto}`} v={`+${fmt$(e.monto)}`} small />
            ))}
          </div>
        )}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '2px solid #e5e7eb' }}>
          <Row k="Subtotal" v={fmt$(c.precio.subtotal)} />
          <Row k="IVA (16%)" v={fmt$(c.precio.iva)} small />
          <Row k="TOTAL" v={fmt$(c.precio.total_con_iva)} bold />
        </div>
      </div>

      {/* CTA principal */}
      <div style={{ marginTop: 18, padding: 16, background: '#1B3A6B', color: '#fff', borderRadius: 10, textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
          🤝 Para confirmar este viaje
        </div>
        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12 }}>
          Te contactaremos en menos de 24 horas para coordinar fechas y confirmar.
        </div>
        <div style={{ background: '#E87722', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
          📞 También puedes hablarnos directamente — tu folio: <strong>{data.folio}</strong>
        </div>
      </div>

      <button onClick={onNuevo} style={{
        width: '100%', padding: '12px', background: 'transparent', color: '#1B3A6B',
        border: '1px solid #1B3A6B', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
        marginTop: 14,
      }}>
        ↺ Cotizar otro viaje
      </button>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 14 }}>
        Cotización válida 7 días · Sujeta a disponibilidad de flota
      </div>
    </div>
  );
}

// ── Subcomponentes UI ──
function Section({ titulo, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A6B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Grid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
      {React.Children.map(children, child =>
        React.cloneElement(child, {
          style: {
            width: '100%', padding: '10px 12px', fontSize: 14,
            borderRadius: 8, border: '1px solid #d1d5db', outline: 'none',
            boxSizing: 'border-box',
            ...(child.props.style || {}),
          },
        })
      )}
    </div>
  );
}

function Extra({ label, value, form, toggle }) {
  const active = form.servicios_extras.includes(value);
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: 10,
      border: `2px solid ${active ? '#1B3A6B' : '#e5e7eb'}`,
      borderRadius: 8, cursor: 'pointer',
      background: active ? '#f0f4ff' : '#fff',
    }}>
      <input type="checkbox" checked={active} onChange={() => toggle(value)} />
      <span style={{ fontSize: 14, fontWeight: active ? 600 : 400 }}>{label}</span>
    </label>
  );
}

function Row({ k, v, bold, small, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: small ? 12 : 14 }}>
      <span style={{ color: color || (bold ? '#1B3A6B' : '#374151'), fontWeight: bold ? 800 : (small ? 400 : 500) }}>{k}</span>
      <span style={{ color: color || (bold ? '#1B3A6B' : '#111'), fontWeight: bold ? 800 : 600 }}>{v}</span>
    </div>
  );
}

function Alert({ tipo, txt }) {
  return (
    <div style={{
      background: tipo === 'red' ? '#fee2e2' : '#dcfce7',
      color: tipo === 'red' ? '#991b1b' : '#166534',
      padding: 10, borderRadius: 6, marginBottom: 14, fontSize: 13,
    }}>⚠️ {txt}</div>
  );
}
