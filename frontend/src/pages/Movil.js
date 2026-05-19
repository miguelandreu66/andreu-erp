import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const STORAGE_KEY_UNIDAD = 'andreu_movil_unidad_id';
const INTERVALO_GPS_MS = 30000; // 30 segundos entre pings cuando auto-track está activo

export default function Movil() {
  const { usuario, logout } = useAuth();
  const esOperador = usuario?.rol === 'operador';

  const [unidades, setUnidades] = useState([]);
  const [unidadId, setUnidadId] = useState(() => localStorage.getItem(STORAGE_KEY_UNIDAD) || '');
  const [viajes, setViajes] = useState([]);
  const [perfilOp, setPerfilOp] = useState(null);
  const [cargando, setCargando] = useState(true);

  // GPS state
  const [gpsAuto, setGpsAuto] = useState(false);
  const [ultimoPing, setUltimoPing] = useState(null);
  const [pingsEnviados, setPingsEnviados] = useState(0);
  const [errorGps, setErrorGps] = useState(null);
  const watchIdRef = useRef(null);
  const ultimoEnviadoRef = useRef(0);

  const [msg, setMsg] = useState(null);

  // ── Cargar datos ──
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const u = await api.unidades();
      setUnidades(u || []);

      if (esOperador) {
        // Operadores: solo sus propios datos (servidor filtra por operador_id en JWT)
        const [perfil, misViajes] = await Promise.all([
          api.opMiPerfil().catch(() => null),
          api.opMisViajes(7).catch(() => []),
        ]);
        setPerfilOp(perfil);
        setViajes(misViajes || []);
      } else {
        // Otros roles (logistica/admin/director): ven todos los viajes recientes
        const v = await api.viajes('').catch(() => []);
        const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        setViajes((v || []).filter(viaje => viaje.fecha >= hace7));
      }
    } catch (e) {
      setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
    } finally { setCargando(false); }
  }, [esOperador]);

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
  }, [gpsAuto, unidadId]);

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
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {esOperador ? '👤 Operador' : 'Modo móvil'}
              {perfilOp?.licencia && esOperador && <> · Lic. {perfilOp.licencia}</>}
            </div>
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

      {/* Captura de tickets removida — Andreu usa tarjetas de flotilla (Edenred/IAVE).
          Los movimientos de diesel y casetas llegan al sistema vía CSV/API,
          no por captura manual del operador. */}

      {/* Viajes del día — con botones grandes */}
      <Card titulo="🚛 Tus viajes activos">
        {viajes.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 13, padding: 12, textAlign: 'center' }}>
            Sin viajes registrados en los últimos 7 días
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {viajes.slice(0, 8).map(v => (
              <ViajeCard
                key={v.id}
                viaje={v}
                ultimoPing={ultimoPing}
                onEntregado={async (extras) => {
                  try {
                    await api.opMarcarEntregado(v.id, extras);
                    setMsg({ tipo: 'green', txt: `✅ Viaje ${v.id} marcado como entregado` });
                    cargar();
                  } catch (e) {
                    setMsg({ tipo: 'red', txt: 'Error: ' + e.message });
                  }
                }}
              />
            ))}
          </div>
        )}
      </Card>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#9ca3af', marginTop: 16, marginBottom: 100 }}>
        🚛 Andreu Logistics · Modo móvil PWA
        <br />
        Toca el menú del navegador → "Agregar a pantalla de inicio" para instalar como app
      </div>

      {/* Indicador online/offline + Botón SOS flotante */}
      <StatusBar />
      <SosFlotante unidadId={unidadId} ultimoPing={ultimoPing}
        onEnviado={(id) => setMsg({ tipo: 'green', txt: `🆘 SOS #${id} enviado al supervisor` })} />

      {/* Banner PWA install */}
      <PWAInstallBanner />
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

// ── Tarjeta de viaje con botón "Entregado" + foto evidencia ─────────
function ViajeCard({ viaje, onEntregado, ultimoPing }) {
  const [abrir, setAbrir] = useState(false);
  const [foto, setFoto] = useState(null);
  const [notas, setNotas] = useState('');
  const [km, setKm] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef(null);
  const enRuta = viaje.estado === 'En ruta';

  const handleFoto = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      alert('La foto pesa más de 5MB. Toma una nueva con menos calidad.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFoto(reader.result);
    reader.readAsDataURL(f);
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      await onEntregado({
        foto_base64: foto,
        notas: notas || null,
        lat: ultimoPing?.lat ? parseFloat(ultimoPing.lat) : null,
        lng: ultimoPing?.lng ? parseFloat(ultimoPing.lng) : null,
        kilometros_final: km ? parseInt(km) : null,
      });
      setAbrir(false);
      setFoto(null);
      setNotas('');
      setKm('');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{
      background: enRuta ? '#dbeafe' : (viaje.estado === 'Completado' ? '#dcfce7' : '#f9fafb'),
      borderLeft: '4px solid ' + (enRuta ? '#2563eb' : viaje.estado === 'Completado' ? '#16a34a' : '#9ca3af'),
      padding: 12, borderRadius: 8,
    }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>
        {viaje.origen || '?'} → {viaje.destino}
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
        {viaje.fecha} · {viaje.carga || 'Sin carga'} · <strong>{viaje.estado}</strong>
      </div>

      {enRuta && !abrir && (
        <button onClick={() => setAbrir(true)} style={{
          marginTop: 10, width: '100%', padding: '12px',
          background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8,
          fontWeight: 700, fontSize: 14, cursor: 'pointer',
        }}>
          ✓ Marcar como entregado
        </button>
      )}

      {abrir && (
        <div style={{ marginTop: 10, padding: 10, background: '#fff', borderRadius: 8 }}>
          <button onClick={() => fileRef.current?.click()} style={{
            width: '100%', padding: '12px', background: '#1B3A6B', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer',
            marginBottom: 8,
          }}>
            📷 {foto ? 'Cambiar foto' : 'Tomar foto evidencia'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            onChange={handleFoto} style={{ display: 'none' }} />

          {foto && (
            <div style={{ textAlign: 'center', marginBottom: 8 }}>
              <img src={foto} alt="evidencia" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6 }} />
            </div>
          )}

          <input type="number" placeholder="Km final (opcional)" value={km}
            onChange={e => setKm(e.target.value)}
            style={inputMovil} />

          <textarea placeholder="Notas (opcional): recibí firma de Juan, mercancía en buen estado, etc."
            value={notas} onChange={e => setNotas(e.target.value)}
            style={{ ...inputMovil, minHeight: 60, resize: 'vertical' }} />

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => { setAbrir(false); setFoto(null); }}
              style={{ flex: 1, padding: 12, background: '#fff', color: '#374151',
                border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button onClick={enviar} disabled={enviando}
              style={{ flex: 2, padding: 12, background: '#16a34a', color: '#fff',
                border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                opacity: enviando ? 0.5 : 1 }}>
              {enviando ? 'Enviando...' : '✓ Confirmar entregado'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Botón flotante SOS (siempre visible, esquina inferior) ────────────
function SosFlotante({ unidadId, ultimoPing, onEnviado }) {
  const [confirmando, setConfirmando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);

  const disparar = async () => {
    setEnviando(true);
    try {
      const r = await api.opSos({
        mensaje: mensaje || 'SOS desde app móvil',
        unidad_id: unidadId ? parseInt(unidadId) : null,
        lat: ultimoPing?.lat ? parseFloat(ultimoPing.lat) : null,
        lng: ultimoPing?.lng ? parseFloat(ultimoPing.lng) : null,
      });
      onEnviado(r.sos_id);
      setConfirmando(false);
      setMensaje('');
    } catch (e) {
      alert('No se pudo enviar SOS: ' + e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {!confirmando && (
        <button onClick={() => setConfirmando(true)}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
            color: '#fff', border: 'none', fontSize: 24, fontWeight: 900,
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(220,38,38,0.4)',
          }}>🆘</button>
      )}

      {confirmando && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1001,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }} onClick={() => !enviando && setConfirmando(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#fff', borderRadius: 16, padding: 24, maxWidth: 360, width: '100%',
            border: '3px solid #dc2626',
          }}>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 8 }}>🆘</div>
            <h3 style={{ margin: '0 0 8px', color: '#dc2626', textAlign: 'center', fontSize: 20 }}>
              Enviar SOS al supervisor
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280', textAlign: 'center' }}>
              Se enviará tu ubicación, unidad y mensaje al equipo de logística inmediatamente.
            </p>
            <textarea placeholder="¿Qué pasó? (ej: descompostura, accidente, asalto en proceso, sin combustible...)"
              value={mensaje} onChange={e => setMensaje(e.target.value)}
              style={{ ...inputMovil, minHeight: 80 }}
              autoFocus />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => setConfirmando(false)} disabled={enviando}
                style={{ flex: 1, padding: 14, background: '#fff', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={disparar} disabled={enviando}
                style={{ flex: 2, padding: 14, background: '#dc2626', color: '#fff',
                  border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer',
                  opacity: enviando ? 0.5 : 1 }}>
                {enviando ? 'Enviando...' : '🆘 ENVIAR SOS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Indicador online/offline ───────────────────────────────────────
function StatusBar() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (online) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
      background: '#fbbf24', color: '#78350f', padding: '6px 12px',
      fontSize: 12, fontWeight: 700, textAlign: 'center',
    }}>
      ⚠️ Sin conexión — los pings GPS se reanudarán cuando vuelvas a tener internet
    </div>
  );
}

// ── Banner para instalar PWA en Android/Chrome ──────────────────────
function PWAInstallBanner() {
  const [prompt, setPrompt] = useState(null);
  const [oculto, setOculto] = useState(localStorage.getItem('pwa_banner_dismissed') === '1');

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (oculto || !prompt) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 100, left: 12, right: 12, zIndex: 998,
      background: '#1B3A6B', color: '#fff', padding: 14, borderRadius: 12,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ fontSize: 28 }}>📱</div>
      <div style={{ flex: 1, fontSize: 13 }}>
        <strong>Instala Andreu Móvil</strong>
        <div style={{ opacity: 0.85, fontSize: 11, marginTop: 2 }}>
          Acceso desde tu home screen sin abrir navegador.
        </div>
      </div>
      <button onClick={async () => {
        prompt.prompt();
        await prompt.userChoice;
        setPrompt(null);
      }} style={{
        padding: '10px 14px', background: '#FFB627', color: '#0f1f3a',
        border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
      }}>Instalar</button>
      <button onClick={() => { setOculto(true); localStorage.setItem('pwa_banner_dismissed', '1'); }}
        style={{
          background: 'transparent', color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 20, padding: 4, opacity: 0.6,
        }}>×</button>
    </div>
  );
}

const inputMovil = {
  width: '100%', padding: '10px 12px', fontSize: 14, borderRadius: 8,
  border: '1px solid #d1d5db', background: '#fff', boxSizing: 'border-box',
  marginBottom: 6,
};

function btnGrande(color) {
  return {
    width: '100%', padding: '14px 16px', fontSize: 15, fontWeight: 700,
    background: color, color: '#fff', border: 'none', borderRadius: 10,
    cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,.1)',
  };
}
