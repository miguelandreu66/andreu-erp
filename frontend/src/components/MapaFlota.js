import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

const CENTRO_DEFAULT = [-99.2345, 18.9186]; // Cuernavaca, Morelos
const ZOOM_DEFAULT = 11;
const REFRESH_MS = 30000;
const TRAIL_HORAS = 4;

const ESTADO_COLOR = {
  en_ruta:   '#16a34a',
  activa:    '#22c55e',
  detenido:  '#6b7280',
  alerta:    '#dc2626',
  sin_senal: '#7c2d12',
  sin_datos: '#9ca3af',
};

const ESTADO_LABEL = {
  en_ruta: 'En ruta',
  activa: 'Activa',
  detenido: 'Detenida',
  alerta: 'Alerta',
  sin_senal: 'Sin señal',
  sin_datos: 'Sin GPS',
};

export default function MapaFlota() {
  const { usuario } = useAuth();
  const esDirector = usuario?.rol === 'director';

  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markersRef = useRef({}); // unidad_id → marker
  const trailsRef = useRef({});  // unidad_id → source id

  const [token, setToken] = useState(null);
  const [errorToken, setErrorToken] = useState(null);
  const [posiciones, setPosiciones] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [mostrarTrails, setMostrarTrails] = useState(true);
  const [estilo, setEstilo] = useState('mapbox://styles/mapbox/streets-v12');

  const [pegandoToken, setPegandoToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [guardandoToken, setGuardandoToken] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState(null);

  // ── 1. Cargar el token Mapbox del backend ──
  useEffect(() => {
    api.caiApiKeyValor('mapbox_public_token')
      .then(r => { setToken(r.valor); mapboxgl.accessToken = r.valor; })
      .catch(e => setErrorToken(e.message));
  }, []);

  // ── 2. Inicializar el mapa cuando hay token ──
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: estilo,
      center: CENTRO_DEFAULT,
      zoom: ZOOM_DEFAULT,
      pitch: 0,
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      // Trigger initial data load
      cargarPosiciones();
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      trailsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── 3. Cambiar estilo ──
  useEffect(() => {
    if (mapRef.current && token) {
      mapRef.current.setStyle(estilo);
      mapRef.current.once('style.load', () => {
        // re-render markers y trails después del cambio de estilo
        renderMarcadoresYTrails(posiciones);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estilo]);

  // ── 4. Cargar posiciones ──
  const cargarPosiciones = useCallback(async () => {
    try {
      const r = await api.caiDashboard();
      const pos = (r.posiciones || []).filter(p => p.lat != null && p.lng != null);
      setPosiciones(pos);
      renderMarcadoresYTrails(pos);
    } catch (e) { console.error('mapa posiciones:', e.message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 5. Renderizar marcadores ──
  const renderMarcadoresYTrails = useCallback(async (pos) => {
    const map = mapRef.current;
    if (!map || !map.loaded()) return;

    // Limpiar marcadores antiguos
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoints = false;

    for (const p of pos) {
      hasPoints = true;
      bounds.extend([parseFloat(p.lng), parseFloat(p.lat)]);

      const el = document.createElement('div');
      const color = ESTADO_COLOR[p.estado_visual] || ESTADO_COLOR.sin_datos;
      el.style.cssText = `
        background: ${color}; color: white; padding: 4px 10px; border-radius: 6px;
        font-weight: 700; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,.3);
        border: 2px solid white; cursor: pointer; white-space: nowrap;
      `;
      el.innerHTML = `🚛 ${p.placas}`;

      const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
        <div style="font-family: Arial, sans-serif; min-width: 200px;">
          <div style="font-weight: 800; font-size: 16px; color: #1B3A6B; margin-bottom: 4px;">
            ${p.placas}
          </div>
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
            ${p.descripcion || ''}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
            <span style="background:${color}; color:white; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600;">
              ${ESTADO_LABEL[p.estado_visual] || p.estado_visual}
            </span>
            ${p.velocidad_kmh != null && p.velocidad_kmh > 0 ? `<span style="font-size:11px; color:#374151;">${Math.round(p.velocidad_kmh)} km/h</span>` : ''}
          </div>
          ${p.operador ? `<div style="font-size:12px;"><b>👤</b> ${p.operador}</div>` : ''}
          ${p.destino ? `<div style="font-size:12px;"><b>📍</b> → ${p.destino}</div>` : ''}
          ${p.minutos_desde_ultimo != null ? `<div style="font-size:11px; color:#6b7280; margin-top:6px;">Última señal: hace ${Math.round(p.minutos_desde_ultimo)} min</div>` : ''}
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([parseFloat(p.lng), parseFloat(p.lat)])
        .setPopup(popup)
        .addTo(map);

      markersRef.current[p.unidad_id] = marker;

      // Trail
      if (mostrarTrails) {
        try {
          const pings = await api.caiGpsUnidad(p.unidad_id, `?horas=${TRAIL_HORAS}&max=200`);
          if (pings && pings.length > 1) {
            const coords = pings.map(pp => [parseFloat(pp.lng), parseFloat(pp.lat)]);
            const sourceId = `trail-${p.unidad_id}`;
            const layerId = `trail-layer-${p.unidad_id}`;
            // Remove existing
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
            map.addSource(sourceId, {
              type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
            });
            map.addLayer({
              id: layerId,
              type: 'line',
              source: sourceId,
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: {
                'line-color': color,
                'line-width': 3,
                'line-opacity': 0.6,
              },
            });
            trailsRef.current[p.unidad_id] = { sourceId, layerId };
          }
        } catch (_) {}
      }
    }

    if (hasPoints && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 800 });
    }
  }, [mostrarTrails]);

  // ── 6. Auto-refresh ──
  useEffect(() => {
    if (!autoRefresh || !token) return;
    const id = setInterval(cargarPosiciones, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, token, cargarPosiciones]);

  // ── 7. Guardar token (BYOK) ──
  const guardarToken = async () => {
    setGuardandoToken(true);
    setErrorGuardar(null);
    try {
      await api.caiApiKeyGuardar('mapbox_public_token', tokenInput.trim());
      setToken(tokenInput.trim());
      mapboxgl.accessToken = tokenInput.trim();
      setPegandoToken(false);
      setTokenInput('');
    } catch (e) {
      setErrorGuardar(e.message);
    } finally { setGuardandoToken(false); }
  };

  // ── Renderizado ──
  if (errorToken && !token) {
    return (
      <div style={{
        background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
        border: '1px solid #d97706', borderRadius: 14, padding: 24, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 36 }}>🗺️</div>
          <div>
            <h3 style={{ margin: '0 0 4px', color: '#78350f' }}>Activa el mapa en vivo</h3>
            <p style={{ margin: 0, color: '#78350f', fontSize: 14 }}>
              Mapbox es <strong>gratis</strong> hasta 50,000 usuarios/mes. Para Andreu nunca pagas.
            </p>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 13 }}>
          <strong>Cómo obtener tu token (2 min):</strong>
          <ol style={{ margin: '8px 0', paddingLeft: 18, color: '#374151', lineHeight: 1.7 }}>
            <li>Regístrate en <a href="https://account.mapbox.com/auth/signup/" target="_blank" rel="noopener noreferrer" style={{ color: '#1B3A6B', fontWeight: 600 }}>account.mapbox.com</a> (gratis)</li>
            <li>En el dashboard hay un token público por default: <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>pk.eyJ...</code></li>
            <li>Copia ese token (botón "Copy")</li>
            <li>Pégalo aquí abajo</li>
          </ol>
        </div>

        {esDirector ? (
          !pegandoToken ? (
            <button onClick={() => setPegandoToken(true)} className="btn btn-primary">
              🔑 Pegar mi token Mapbox
            </button>
          ) : (
            <div style={{ background: '#fff', borderRadius: 10, padding: 14 }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                Token público Mapbox (empieza con pk.)
              </label>
              <input
                type="text" value={tokenInput} onChange={e => setTokenInput(e.target.value)}
                placeholder="pk.eyJ1Ijo..." disabled={guardandoToken}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 13,
                  borderRadius: 8, border: '1px solid #d1d5db',
                  fontFamily: 'ui-monospace, "SF Mono", monospace',
                }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={guardarToken} disabled={guardandoToken || !tokenInput.trim()} className="btn btn-primary">
                  {guardandoToken ? 'Validando...' : '⚡ Activar mapa'}
                </button>
                <button onClick={() => setPegandoToken(false)} className="btn btn-ghost">Cancelar</button>
              </div>
              {errorGuardar && (
                <div style={{ marginTop: 10, padding: 10, background: '#fee2e2', color: '#991b1b', borderRadius: 6, fontSize: 13 }}>
                  ⚠️ {errorGuardar}
                </div>
              )}
            </div>
          )
        ) : (
          <div style={{ background: '#fff', borderRadius: 10, padding: 14, fontSize: 13, color: '#78350f' }}>
            ⚠️ Solo el <strong>Director</strong> puede configurar el token. Pídeselo.
          </div>
        )}
      </div>
    );
  }

  if (!token) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>Cargando mapa...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>🗺️ Flota en vivo</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
            Auto-refresh 30s
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarTrails} onChange={e => setMostrarTrails(e.target.checked)} />
            Trails 4h
          </label>
          <select value={estilo} onChange={e => setEstilo(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="mapbox://styles/mapbox/streets-v12">📍 Calles</option>
            <option value="mapbox://styles/mapbox/satellite-streets-v12">🛰️ Satélite</option>
            <option value="mapbox://styles/mapbox/outdoors-v12">⛰️ Carretera</option>
            <option value="mapbox://styles/mapbox/dark-v11">🌙 Oscuro</option>
          </select>
          <button onClick={cargarPosiciones} className="btn btn-ghost btn-sm">↻</button>
        </div>
      </div>

      <div ref={containerRef} style={{
        width: '100%', height: '600px', borderRadius: 12, overflow: 'hidden',
        border: '1px solid #e5e7eb',
      }} />

      {posiciones.length === 0 && (
        <div style={{
          marginTop: 12, padding: 14, background: '#fef3c7', color: '#78350f',
          borderRadius: 8, fontSize: 13, textAlign: 'center',
        }}>
          📍 Sin posiciones GPS registradas todavía. Cuando los operadores activen Auto-GPS en <code>/movil</code>, sus unidades aparecerán aquí.
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', fontSize: 12 }}>
        {Object.entries(ESTADO_LABEL).map(([k, l]) => (
          <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ width: 12, height: 12, background: ESTADO_COLOR[k], borderRadius: 3 }} />
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}
