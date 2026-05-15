import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY_UNIDAD = 'andreu_movil_unidad_id';
const INTERVALO_GPS_MS = 30000; // 30 segundos entre pings cuando auto-track está activo

export default function Movil() {
  const { usuario, logout } = useAuth();

  const [unidades, setUnidades] = useState([]);
  const [unidadId, setUnidadId] = useState(() => localStorage.getItem(STORAGE_KEY_UNIDAD) || '');
  const [viajes, setViajes] = useState([]);
  const [cargando, setCargando] = useState(true);

  // GPS state
  const [gpsAuto, setGpsAuto] = useState(false);
  const [ultimoPing, setUltimoPing] = useState(null);
  const [pingsEnviados, setPingsEnviados] = useState(0);
  const [errorGps, setErrorGps] = useState(null);
  const watchIdRef = useRef(null);
  const ultimoEnviadoRef = useRef(0);

  // OCR state
  const [procesandoTicket, setProcesandoTicket] = useState(false);
  const [resultadoOCR, setResultadoOCR] = useState(null);
  const [errorOCR, setErrorOCR] = useState(null);

  const [msg, setMsg] = useState(null);

  // ── Cargar datos ──
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [u, v] = await Promise.all([
        api.unidades(),
        api.viajes('').catch(() => []),
      ]);
      setUnidades(u || []);
      // Filtrar viajes recientes (últimos 7 días)
      const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const recientes = (v || []).filter(viaje => viaje.fecha >= hace7);
      setViajes(recientes);
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Guardar selección de unidad en localStorage (persiste entre sesiones)
  useEffect(() => {
    if (unidadId) localStorage.setItem(STORAGE_KEY_UNIDAD, unidadId);
  }, [unidadId]);

  // ── GPS: enviar un ping ──
  const enviarPing = async (pos) => {
    if (!unidadId) {
      setErrorGps('Selecciona una unidad primero');
      return;
    }
    const ahora = Date.now();
    if (ahora - ultimoEnviadoRef.current < 10000) return; // rate limit: max 1 cada 10s
    ultimoEnviadoRef.current = ahora;

    try {
      const speed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
      await api.caiGpsPing({
        unidad_id: parseInt(unidadId),
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        velocidad_kmh: speed,
        rumbo: pos.coords.heading || null,
        fuente: 'mobile',
      });
      setUltimoPing({
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        velocidad: speed,
        accuracy: Math.round(pos.coords.accuracy),
        timestamp: new Date(),
      });
      setPingsEnviados(p => p + 1);
      setErrorGps(null);
    } catch (e) {
      setErrorGps(e.message);
    }
  };

  // Compartir GPS UNA VEZ (botón)
  const compartirAhora = () => {
    setErrorGps(null);
    if (!navigator.geolocation) {
      setErrorGps('Tu navegador no soporta GPS');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      enviarPing,
      err => setErrorGps(`Error GPS: ${err.message}. Activa los permisos de ubicación.`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Auto-tracking GPS (toggle)
  useEffect(() => {
    if (!gpsAuto || !unidadId) {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) {
      setErrorGps('Tu navegador no soporta GPS');
      setGpsAuto(false);
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      enviarPing,
      err => setErrorGps(`Auto-GPS error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: INTERVALO_GPS_MS - 5000 }
    );
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsAuto, unidadId]);

  // ── OCR ticket ──
  const subirTicket = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    if (archivo.size > 8 * 1024 * 1024) {
      setErrorOCR('Imagen demasiado grande (máx 8 MB)');
      return;
    }
    setProcesandoTicket(true);
    setErrorOCR(null);
    setResultadoOCR(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await api.caiDieselOcr(fd);
      setResultadoOCR(r.datos);
    } catch (e) {
      setErrorOCR(e.message);
    } finally {
      setProcesandoTicket(false);
      e.target.value = ''; // reset para que pueda subir otra
    }
  };

  // ── Render ──
  const unidadSeleccionada = unidades.find(u => u.id === parseInt(unidadId));
  const viajesEnRuta = viajes.filter(v => v.estado === 'En ruta');

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F4F4F2',
      padding: '12px 14px',
      maxWidth: 600,
      margin: '0 auto',
      paddingBottom: 40,
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1B3A6B 0%, #0f1f3a 100%)',
        color: '#fff', padding: 18, borderRadius: 14, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, opacity: 0.8, letterSpacing: 1, fontWeight: 700 }}>🚛 ANDREU LOGISTICS</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{usuario?.nombre}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Modo móvil</div>
          </div>
          <button onClick={logout} style={{
            background: 'rgba(255,255,255,.15)', color: '#fff', border: '1px solid rgba(255,255,255,.3)',
            padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}>Salir</button>
        </div>
      </div>

      {msg && (
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 14,
          background: msg.tipo === 'red' ? '#fee2e2' : '#dcfce7',
          color: msg.tipo === 'red' ? '#991b1b' : '#166534',
        }}>{msg.txt}</div>
      )}

      {/* Selector unidad */}
      <Card titulo="🚛 Unidad asignada">
        {cargando ? <div>Cargando...</div> : (
          <select
            value={unidadId}
            onChange={e => setUnidadId(e.target.value)}
            style={{
              width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 8,
              border: '1px solid #d1d5db', background: '#fff',
            }}
          >
            <option value="">— Selecciona tu unidad —</option>
            {unidades.map(u => (
              <option key={u.id} value={u.id}>{u.placas} {u.descripcion ? `· ${u.descripcion}` : ''}</option>
            ))}
          </select>
        )}
        {unidadSeleccionada && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
            {unidadSeleccionada.marca || ''} {unidadSeleccionada.modelo || ''} {unidadSeleccionada.anio ? `· ${unidadSeleccionada.anio}` : ''}
          </div>
        )}
      </Card>

      {/* GPS */}
      <Card titulo="📍 Compartir ubicación GPS">
        <button
          onClick={compartirAhora}
          disabled={!unidadId}
          style={btnGrande('#16a34a')}
        >
          📍 Enviar mi ubicación ahora
        </button>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 12,
          padding: 12, background: gpsAuto ? '#dcfce7' : '#f9fafb',
          borderRadius: 8, cursor: 'pointer', border: '1px solid #e5e7eb',
        }}>
          <input
            type="checkbox"
            checked={gpsAuto}
            onChange={e => setGpsAuto(e.target.checked)}
            disabled={!unidadId}
            style={{ width: 20, height: 20 }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {gpsAuto ? '🟢 Auto-GPS activo' : 'Auto-GPS cada 30 seg'}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {gpsAuto
                ? 'Tu ubicación se envía automáticamente mientras la app está abierta.'
                : 'Activa para que se envíe sin que aprietes nada.'}
            </div>
          </div>
        </label>

        {errorGps && (
          <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
            ⚠️ {errorGps}
          </div>
        )}

        {ultimoPing && (
          <div style={{ marginTop: 10, padding: 10, background: '#dcfce7', color: '#166534', borderRadius: 6, fontSize: 12 }}>
            ✅ Último ping: {ultimoPing.timestamp.toLocaleTimeString('es-MX')}
            <br />
            📍 {ultimoPing.lat}, {ultimoPing.lng} · {ultimoPing.velocidad} km/h · precisión ±{ultimoPing.accuracy}m
            <br />
            <strong>{pingsEnviados}</strong> ping(s) enviados en esta sesión
          </div>
        )}
      </Card>

      {/* Foto ticket */}
      <Card titulo="📸 Capturar ticket de diesel">
        <label style={{ ...btnGrande('#E87722'), display: 'block', textAlign: 'center', cursor: 'pointer' }}>
          {procesandoTicket ? '🤖 Leyendo ticket...' : '📷 Tomar foto del ticket'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={subirTicket}
            disabled={procesandoTicket}
            style={{ display: 'none' }}
          />
        </label>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, textAlign: 'center' }}>
          La IA extrae litros, precio y total automáticamente
        </div>

        {errorOCR && (
          <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
            ⚠️ {errorOCR}
          </div>
        )}

        {resultadoOCR && (
          <div style={{ marginTop: 12, padding: 12, background: '#fff', border: '2px solid #16a34a', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: '#166534', fontWeight: 700, marginBottom: 8 }}>
              ✅ DATOS EXTRAÍDOS (confianza: {resultadoOCR.confianza})
            </div>
            <Linea k="Fecha" v={resultadoOCR.fecha} />
            <Linea k="Combustible" v={resultadoOCR.tipo_combustible} />
            <Linea k="Litros" v={resultadoOCR.litros != null ? `${resultadoOCR.litros} L` : null} />
            <Linea k="Precio/L" v={resultadoOCR.precio_por_litro != null ? `$${resultadoOCR.precio_por_litro}` : null} />
            <Linea k="Total" v={resultadoOCR.total != null ? `$${resultadoOCR.total.toLocaleString('es-MX')}` : null} bold />
            <Linea k="Gasolinera" v={resultadoOCR.gasolinera_marca} />
            {resultadoOCR.observaciones && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                💬 {resultadoOCR.observaciones}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Viajes del día */}
      <Card titulo="🚛 Viajes recientes">
        {viajes.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: 12, textAlign: 'center' }}>
            Sin viajes registrados en los últimos 7 días
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {viajes.slice(0, 5).map(v => (
              <div key={v.id} style={{
                background: v.estado === 'En ruta' ? '#dbeafe' : '#f9fafb',
                borderLeft: '3px solid ' + (v.estado === 'En ruta' ? '#2563eb' : '#9ca3af'),
                padding: 10, borderRadius: 6,
              }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {v.origen || '?'} → {v.destino}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {v.fecha} · {v.carga || 'Sin carga especificada'} · {v.estado}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 16 }}>
        🚛 Andreu Logistics · Modo móvil PWA
        <br />
        Toca el menú del navegador → "Agregar a pantalla de inicio" para instalar como app
      </div>
    </div>
  );
}

// ── Subcomponentes ──
function Card({ titulo, children }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Linea({ k, v, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: '#6b7280' }}>{k}</span>
      <span style={{ fontWeight: bold ? 800 : 500, color: v ? (bold ? '#1B3A6B' : '#111') : '#9ca3af' }}>
        {v || '—'}
      </span>
    </div>
  );
}

function btnGrande(color) {
  return {
    width: '100%', padding: '14px 16px', fontSize: 15, fontWeight: 700,
    background: color, color: '#fff', border: 'none', borderRadius: 10,
    cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,.1)',
  };
}
