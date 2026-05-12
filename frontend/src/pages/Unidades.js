import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const fmtN = n => (parseFloat(n) || 0).toLocaleString('es-MX');

export default function Unidades() {
  const { usuario } = useAuth();
  const puedeCrear = ['director', 'admin'].includes(usuario?.rol);

  const [unidades, setUnidades] = useState([]);
  const [posiciones, setPosiciones] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [editandoId, setEditandoId] = useState(null);
  const [form, setForm] = useState({
    placas: '', descripcion: '', marca: '', modelo: '', anio: ''
  });
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [u, dash] = await Promise.all([
        api.unidades(),
        api.caiDashboard().catch(() => null),
      ]);
      setUnidades(u || []);
      const pos = {};
      (dash?.posiciones || []).forEach(p => { pos[p.unidad_id] = p; });
      setPosiciones(pos);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error al cargar: ' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const limpiarForm = () => {
    setForm({ placas: '', descripcion: '', marca: '', modelo: '', anio: '' });
    setEditandoId(null);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.placas.trim()) {
      setMsg({ tipo: 'red', txt: 'Las placas son obligatorias' });
      return;
    }
    setGuardando(true);
    try {
      await api.crearUnidad({
        placas: form.placas.trim().toUpperCase(),
        descripcion: form.descripcion.trim() || null,
        marca: form.marca.trim() || null,
        modelo: form.modelo.trim() || null,
        anio: form.anio ? parseInt(form.anio) : null,
      });
      setMsg({ tipo: 'green', txt: `✓ Unidad ${form.placas.toUpperCase()} registrada` });
      limpiarForm();
      await cargar();
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ margin: 0 }}>🚛 Unidades — Flota Andreu Logistics</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 14 }}>
            Da de alta tus plataformas, tortons y demás unidades operativas
          </p>
        </div>
        <div style={{ fontSize: 14, color: '#6b7280' }}>
          <strong style={{ fontSize: 22, color: '#1B3A6B' }}>{unidades.length}</strong> unidad(es) en flota
        </div>
      </div>

      {msg && (
        <div className={`alert ${msg.tipo}`} style={{ marginBottom: 16 }}>
          <div className="alert-dot" />
          <div>{msg.txt}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20, alignItems: 'start' }}>

        {/* ── Lista de unidades ───────────────────────── */}
        <div>
          {loading ? (
            <div className="empty">Cargando unidades...</div>
          ) : unidades.length === 0 ? (
            <div style={{
              background: '#fff', border: '2px dashed #d1d5db', borderRadius: 12,
              padding: 40, textAlign: 'center',
            }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🚛</div>
              <h3 style={{ margin: '0 0 8px', color: '#374151' }}>Aún no tienes unidades</h3>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
                Empieza dando de alta tu primera plataforma con el formulario de la derecha.
              </p>
              <p style={{ color: '#9ca3af', fontSize: 12 }}>
                Necesitarás: placas, descripción opcional, marca, modelo y año.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {unidades.map(u => {
                const pos = posiciones[u.id];
                const estadoBg =
                  !pos || pos.minutos_desde_ultimo == null ? '#9ca3af' :
                  pos.estado_visual === 'en_ruta' ? '#16a34a' :
                  pos.estado_visual === 'sin_senal' ? '#dc2626' :
                  pos.estado_visual === 'alerta' ? '#dc2626' :
                  pos.estado_visual === 'detenido' ? '#6b7280' :
                  '#22c55e';
                return (
                  <div key={u.id} style={{
                    background: '#fff', border: '1px solid #e5e7eb', borderLeft: `4px solid ${estadoBg}`,
                    borderRadius: 10, padding: 16,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 22, fontWeight: 800, color: '#1B3A6B', letterSpacing: 1 }}>{u.placas}</span>
                          {u.activo === false && (
                            <span style={{ background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                              Inactiva
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 14, color: '#374151', marginTop: 4 }}>
                          {u.descripcion || <em style={{ color: '#9ca3af' }}>Sin descripción</em>}
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
                          {u.marca || '?'} {u.modelo || ''} {u.anio ? `· ${u.anio}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 140 }}>
                        {pos ? (
                          <>
                            <div style={{
                              display: 'inline-block', background: estadoBg, color: '#fff',
                              padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                              textTransform: 'uppercase', letterSpacing: 0.5,
                            }}>
                              {pos.estado_visual === 'en_ruta' ? 'En ruta' :
                               pos.estado_visual === 'sin_senal' ? 'Sin señal' :
                               pos.estado_visual === 'alerta' ? 'Alerta' :
                               pos.estado_visual === 'detenido' ? 'Detenida' : 'Sin datos'}
                            </div>
                            {pos.velocidad_kmh != null && pos.velocidad_kmh > 0 && (
                              <div style={{ fontSize: 12, color: '#374151', marginTop: 6, fontWeight: 600 }}>
                                {parseFloat(pos.velocidad_kmh).toFixed(0)} km/h
                              </div>
                            )}
                            {pos.minutos_desde_ultimo != null && (
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                hace {Math.round(pos.minutos_desde_ultimo)} min
                              </div>
                            )}
                          </>
                        ) : (
                          <div style={{
                            display: 'inline-block', background: '#f3f4f6', color: '#9ca3af',
                            padding: '4px 12px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                          }}>
                            Sin GPS aún
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Formulario crear ────────────────────────── */}
        <div>
          {puedeCrear ? (
            <div style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12,
              padding: 18, position: 'sticky', top: 16,
            }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>
                {editandoId ? '✏️ Editar unidad' : '➕ Nueva unidad'}
              </h3>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: '#6b7280' }}>
                Solo Director y Administrador pueden crear unidades
              </p>

              <form onSubmit={guardar}>
                <div className="form-group">
                  <label className="form-label">Placas *</label>
                  <input
                    type="text"
                    placeholder="GRO-123-A"
                    value={form.placas}
                    onChange={e => setForm({ ...form, placas: e.target.value })}
                    required
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Descripción</label>
                  <input
                    type="text"
                    placeholder="Plataforma 48' azul"
                    value={form.descripcion}
                    onChange={e => setForm({ ...form, descripcion: e.target.value })}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Marca</label>
                    <input
                      type="text"
                      placeholder="Kenworth"
                      value={form.marca}
                      onChange={e => setForm({ ...form, marca: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Modelo</label>
                    <input
                      type="text"
                      placeholder="T800"
                      value={form.modelo}
                      onChange={e => setForm({ ...form, modelo: e.target.value })}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Año</label>
                  <input
                    type="number"
                    placeholder="2018"
                    min="1980"
                    max="2030"
                    value={form.anio}
                    onChange={e => setForm({ ...form, anio: e.target.value })}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={guardando}
                  style={{ marginTop: 6 }}
                >
                  {guardando ? 'Guardando...' : (editandoId ? 'Guardar cambios' : '➕ Registrar unidad')}
                </button>

                {editandoId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-block"
                    onClick={limpiarForm}
                    style={{ marginTop: 8 }}
                  >
                    Cancelar edición
                  </button>
                )}
              </form>

              <div style={{
                marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 8,
                fontSize: 12, color: '#075985', lineHeight: 1.5,
              }}>
                💡 <strong>Tip:</strong> Después de registrar, esta unidad aparecerá automáticamente en el
                Dashboard, Command AI y se podrá asignar a viajes en <strong>Registrar Viaje</strong>.
              </div>
            </div>
          ) : (
            <div style={{
              background: '#fef3c7', border: '1px solid #d97706', borderRadius: 10,
              padding: 16, fontSize: 13, color: '#78350f',
            }}>
              ⚠️ Solo Director y Administrador General pueden crear unidades.
              Si necesitas agregar una unidad, contacta al admin.
            </div>
          )}

          {/* Resumen rápido */}
          {unidades.length > 0 && (
            <div style={{
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
              padding: 14, marginTop: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Resumen de flota
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>Total registradas</span>
                <strong>{unidades.length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>Activas</span>
                <strong style={{ color: '#16a34a' }}>{unidades.filter(u => u.activo !== false).length}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                <span>Con GPS reportando</span>
                <strong style={{ color: '#1B3A6B' }}>
                  {Object.values(posiciones).filter(p => p.minutos_desde_ultimo != null && p.minutos_desde_ultimo <= 15).length}
                </strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
