import React, { useState, useEffect } from 'react';
import { api } from '../api';

// ── Página optimizada para celular — Registro rápido de viaje ─────
// Diseñada para que el operador o el despachador la use desde el teléfono.
// Campos grandes, flujo de una sola pantalla, confirmación clara.

const hoy = () => new Date().toISOString().split('T')[0];

const CARGAS = [
  'Arena', 'Grava', 'Piedra', 'Block', 'Cemento', 'Tabique',
  'Varilla', 'Madera', 'Tierra', 'Escombro', 'Material mixto', 'Otro',
];

const btnStyle = {
  display: 'block', width: '100%', padding: '16px',
  fontSize: 18, fontWeight: 700, borderRadius: 12,
  border: 'none', cursor: 'pointer',
};

export default function RegistroMovil() {
  const [operadores,  setOperadores]  = useState([]);
  const [unidades,    setUnidades]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [guardando,   setGuardando]   = useState(false);
  const [exito,       setExito]       = useState(null);
  const [error,       setError]       = useState('');

  const [form, setForm] = useState({
    fecha:          hoy(),
    operador_id:    '',
    unidad_id:      '',
    origen:         '',
    destino:        '',
    carga:          '',
    carga_libre:    '',
    km_recorridos:  '',
    toneladas:      '',
    diesel_litros:  '',
    diesel_costo:   '',
    estado:         'Completado',
    notas:          '',
  });

  useEffect(() => {
    Promise.all([api.operadores?.() || Promise.resolve([]), api.unidades()])
      .then(([ops, uni]) => { setOperadores(ops || []); setUnidades(uni || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.operador_id)    { setError('Selecciona el operador'); return; }
    if (!form.destino.trim()) { setError('Indica el destino'); return; }

    setGuardando(true);
    try {
      const cargaFinal = form.carga === 'Otro' ? form.carga_libre : form.carga;
      const r = await api.crearViaje({
        fecha:         form.fecha,
        operador_id:   parseInt(form.operador_id),
        unidad_id:     form.unidad_id ? parseInt(form.unidad_id) : null,
        origen:        form.origen.trim() || null,
        destino:       form.destino.trim(),
        carga:         cargaFinal || null,
        km_recorridos: parseFloat(form.km_recorridos) || 0,
        toneladas:     parseFloat(form.toneladas) || 0,
        diesel_litros: parseFloat(form.diesel_litros) || 0,
        diesel_costo:  parseFloat(form.diesel_costo) || 0,
        estado:        form.estado,
        notas:         form.notas.trim() || null,
      });
      setExito(r);
    } catch (err) {
      setError(err.message || 'Error al registrar viaje');
    } finally {
      setGuardando(false);
    }
  };

  const registrarOtro = () => {
    setExito(null);
    setForm({ fecha: hoy(), operador_id: '', unidad_id: '', origen: '', destino: '',
              carga: '', carga_libre: '', km_recorridos: '', toneladas: '',
              diesel_litros: '', diesel_costo: '', estado: 'Completado', notas: '' });
    setError('');
  };

  const inputStyle = {
    width: '100%', fontSize: 18, padding: '14px 12px', borderRadius: 10,
    border: '2px solid #d1d5db', outline: 'none', boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 6, display: 'block' };
  const grupoStyle = { marginBottom: 20 };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#666', fontSize: 18 }}>
        Cargando...
      </div>
    );
  }

  // ── Pantalla de éxito ───────────────────────────────────────────
  if (exito) {
    return (
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <div style={{
          background: '#f0fdf4', border: '2px solid #16a34a', borderRadius: 16,
          padding: 28, textAlign: 'center', marginBottom: 24,
        }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#15803d' }}>
            ¡Viaje registrado!
          </div>
          <div style={{ marginTop: 16, fontSize: 15, color: '#166534', lineHeight: 1.6 }}>
            <div><strong>Operador:</strong> {operadores.find(o => String(o.id) === String(exito.operador_id))?.nombre || exito.operador_id}</div>
            <div><strong>Destino:</strong> {exito.destino}</div>
            {exito.km_recorridos > 0 && <div><strong>Km:</strong> {exito.km_recorridos} km</div>}
            {exito.toneladas > 0 && <div><strong>Toneladas:</strong> {exito.toneladas} ton</div>}
            <div><strong>Estado:</strong> {exito.estado}</div>
          </div>
        </div>
        <button style={{ ...btnStyle, background: '#1B3A6B', color: 'white' }} onClick={registrarOtro}>
          + Registrar otro viaje
        </button>
      </div>
    );
  }

  // ── Formulario ──────────────────────────────────────────────────
  return (
    <div style={{ padding: '16px 16px 40px', maxWidth: 520, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: '#1B3A6B', borderRadius: 14, padding: '18px 20px',
        marginBottom: 24, color: 'white',
      }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>🚛 Registro de Viaje</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Grupo Andreu · Registro rápido</div>
      </div>

      {error && (
        <div style={{
          background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '14px 16px', marginBottom: 20, color: '#991b1b', fontWeight: 600, fontSize: 15,
        }}>
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={guardar}>
        {/* Fecha */}
        <div style={grupoStyle}>
          <label style={labelStyle}>📅 Fecha</label>
          <input type="date" style={inputStyle} value={form.fecha}
            onChange={e => set('fecha', e.target.value)} required />
        </div>

        {/* Operador */}
        <div style={grupoStyle}>
          <label style={labelStyle}>👤 Operador *</label>
          <select style={{ ...inputStyle, background: 'white' }}
            value={form.operador_id} onChange={e => set('operador_id', e.target.value)} required>
            <option value="">— Seleccionar operador —</option>
            {operadores.filter(o => o.activo !== false).map(o => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
        </div>

        {/* Unidad */}
        <div style={grupoStyle}>
          <label style={labelStyle}>🚛 Unidad (opcional)</label>
          <select style={{ ...inputStyle, background: 'white' }}
            value={form.unidad_id} onChange={e => set('unidad_id', e.target.value)}>
            <option value="">— Sin asignar —</option>
            {unidades.map(u => (
              <option key={u.id} value={u.id}>{u.placas} — {u.descripcion}</option>
            ))}
          </select>
        </div>

        {/* Origen / Destino */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>📍 Origen</label>
            <input type="text" style={inputStyle} placeholder="Ej: Bodega central"
              value={form.origen} onChange={e => set('origen', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>🏁 Destino *</label>
            <input type="text" style={inputStyle} placeholder="Ej: Chilapa"
              value={form.destino} onChange={e => set('destino', e.target.value)} required />
          </div>
        </div>

        {/* Tipo de carga */}
        <div style={grupoStyle}>
          <label style={labelStyle}>📦 Tipo de carga</label>
          <select style={{ ...inputStyle, background: 'white' }}
            value={form.carga} onChange={e => set('carga', e.target.value)}>
            <option value="">— Sin especificar —</option>
            {CARGAS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {form.carga === 'Otro' && (
            <input type="text" style={{ ...inputStyle, marginTop: 8 }}
              placeholder="Describe la carga..."
              value={form.carga_libre} onChange={e => set('carga_libre', e.target.value)} />
          )}
        </div>

        {/* Km y toneladas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>📏 Km recorridos</label>
            <input type="number" style={inputStyle} placeholder="0" min="0" step="0.1"
              value={form.km_recorridos} onChange={e => set('km_recorridos', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>⚖️ Toneladas</label>
            <input type="number" style={inputStyle} placeholder="0" min="0" step="0.01"
              value={form.toneladas} onChange={e => set('toneladas', e.target.value)} />
          </div>
        </div>

        {/* Diesel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label style={labelStyle}>⛽ Litros diésel</label>
            <input type="number" style={inputStyle} placeholder="0" min="0" step="0.1"
              value={form.diesel_litros} onChange={e => set('diesel_litros', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>💵 Costo diésel ($)</label>
            <input type="number" style={inputStyle} placeholder="$0.00" min="0" step="0.01"
              value={form.diesel_costo} onChange={e => set('diesel_costo', e.target.value)} />
          </div>
        </div>

        {/* Estado */}
        <div style={grupoStyle}>
          <label style={labelStyle}>Estado del viaje</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {['Completado','En tránsito','Pendiente'].map(est => (
              <button key={est} type="button"
                style={{
                  padding: '14px 10px', borderRadius: 10, fontSize: 15, fontWeight: 600,
                  border: '2px solid',
                  borderColor: form.estado === est ? '#1B3A6B' : '#d1d5db',
                  background:  form.estado === est ? '#1B3A6B' : 'white',
                  color:       form.estado === est ? 'white' : '#374151',
                  cursor: 'pointer',
                }}
                onClick={() => set('estado', est)}>
                {est === 'Completado' ? '✅' : est === 'En tránsito' ? '🚛' : '⏳'} {est}
              </button>
            ))}
          </div>
        </div>

        {/* Notas */}
        <div style={grupoStyle}>
          <label style={labelStyle}>📝 Notas (opcional)</label>
          <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
            placeholder="Observaciones del viaje..."
            value={form.notas} onChange={e => set('notas', e.target.value)} />
        </div>

        {/* Botón guardar */}
        <button type="submit"
          style={{ ...btnStyle, background: guardando ? '#94a3b8' : '#1B3A6B', color: 'white' }}
          disabled={guardando}>
          {guardando ? '⏳ Registrando...' : '✅ Registrar viaje'}
        </button>
      </form>
    </div>
  );
}
