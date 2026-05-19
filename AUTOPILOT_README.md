# Módulo AUTOPILOT — Andreu Logistics

> **Nota de naming**: antes se llamaba "Command AI" (cuando Andreu hacía ERP + brokerage).
> Después del split en mayo 2026 (brokerage se fue a VIVO), el módulo se rebautizó como
> **Autopilot**. El path frontend ahora es `/autopilot` (`/command-ai` sigue como alias
> para no romper bookmarks). El backend mantiene los endpoints `/api/command-ai/*` y los
> métodos `api.cai*` del frontend — son nombres internos estables.

Capa de inteligencia operativa en tiempo real sobre el ERP de Andreu Logistics
(3 plataformas 48' en Cuernavaca, Morelos).

## Qué agrega

**Backend** (rutas bajo `/api/command-ai`, alias del Autopilot):
- `/dashboard` — estado consolidado de la flota en vivo
- `/gps/ping` `/gps/batch` `/gps/latest` `/gps/unidad/:id` — ingesta y consulta GPS
- `/alertas` `/alertas/evaluar` `/alertas/:id/{atender,resolver,descartar}` — alertas persistentes con ciclo de vida
- `/supervisor` — supervisor IA conversacional (Claude vía BYOK)
- `/scoring` `/scoring/snapshot` `/scoring/historico/:id` — scoring de operadores
- `/diesel/baselines` `/diesel/recomputar` `/diesel/forense/:id` — diesel inteligente
- `/diesel/ocr` — OCR de tickets de diesel (Claude Vision)
- `/insights/briefing` `/insights/all` — briefing comercial diario
- `/cron/estado` `/cron/historial` `/cron/disparar/:nombre` — control de cron jobs
- `/config` — umbrales operativos visibles

**Frontend**: ruta `/autopilot` con tabs Dashboard / Alertas / Supervisor IA / Scoring / Diesel.
Visible para roles: `director`, `admin`, `logistica`, `monitoreo`.

**BD**: tablas operativas — `gps_pings`, `alertas`, `scoring_snapshots`, `diesel_baselines`,
`audit_log` + vista `unidades_ultima_posicion`.

## Cómo activarlo

### 1) Migraciones (ya aplicadas en Railway prod)

`migration_fase5_command_ai.sql` y siguientes están corridas. Si levantas un entorno nuevo,
aplica todas las migrations en orden numérico.

### 2) (Opcional) Seed demo

`seed_command_ai.sql` es idempotente — pone datos de muestra en el dashboard para que se
vea con vida antes de que llegue el primer ping GPS real.

### 3) Despliega

Backend monta la ruta automáticamente desde `backend/src/index.js`. Frontend usa los
helpers `api.cai*` del cliente. Cuando hagas `git push`, Railway redespliega.

### 4) Verifica en VIVO

- Abre el ERP → menú lateral **Autopilot**
- Tab **Dashboard**: estado de tu flota en vivo
- Tab **Alertas**: pulsa "⚡ Evaluar reglas ahora" para correr el motor
- Tab **Supervisor IA**: pregúntale lo que sea sobre la operación del día
- Tab **Scoring**: pulsa "📸 Guardar snapshot" para histórico de scores
- Tab **Diesel**: "🧮 Recalcular baselines" (necesitas ≥ 3 viajes completados por unidad)

## Configuración (variables de entorno)

Requeridas:
```
DATABASE_URL=postgresql://...     # ya configurado
JWT_SECRET=...                    # ya configurado
```

Opcionales (BYOK por usuario — los puedes meter desde la UI en Configuración → API Keys):
```
ANTHROPIC_API_KEY=sk-ant-...      # supervisor IA + briefing + OCR de diesel
MAPBOX_API_KEY=pk....              # mapa de unidades en vivo
TWILIO_*                            # WhatsApp Business para escalado de alertas
```

## Recibir pings GPS reales

Tu proveedor GPS o app móvil debe hacer POST a `/api/command-ai/gps/ping` con header
`Authorization: Bearer <token>`:

```json
{
  "unidad_id": 12,
  "viaje_id": 345,
  "lat": 18.9186,
  "lng": -99.2345,
  "velocidad_kmh": 78,
  "rumbo": 180,
  "odometro_km": 241300,
  "fuente": "gps_provider"
}
```

Para ingesta masiva:
```
POST /api/command-ai/gps/batch
{ "pings": [ {...}, {...} ] }
```

## Cron jobs

Andreu corre `lib/cronJobs.js` con `node-cron` en el proceso principal:

- Cada 5 min: `evaluar-alertas` — el motor de reglas escanea unidades y dispara alertas
- Diario 6am: `scoring-snapshot` — guarda histórico de scoring de operadores
- Semanal lunes 3am: `diesel-recomputar` — refina baselines de rendimiento por unidad
- Diario 7am: `briefing-comercial` — genera el briefing IA del día

Disparables manualmente desde `/autopilot` → tab **Cron** (solo director/admin).

## Por qué se llama Autopilot ahora

Cuando Andreu hacía ERP + brokerage, este módulo se llamaba "Command AI" porque era el
centro de comando de TODO. Después del split (mayo 2026) el brokerage se fue a VIVO con
sus propios 12 agentes IA, y este módulo quedó enfocado **solo en la flota propia**:
GPS, alertas operativas, scoring de operadores, diesel forense, briefing comercial.
"Autopilot" describe mejor lo que hace hoy — automatiza la supervisión de los 3 camiones
sin que el coordinador tenga que estar pegado a la pantalla.

El nombre cambió en la UI; los endpoints internos siguen igual para no romper integraciones
existentes (proveedor GPS, app móvil, scripts externos).
