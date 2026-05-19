# Módulo COMMAND AI — Andreu Logistics

Capa de inteligencia operativa en tiempo real sobre el ERP existente.

## Qué agrega

**Backend** (rutas bajo `/api/command-ai`):
- `/dashboard` — estado consolidado de la flota en vivo
- `/gps/ping` `/gps/batch` `/gps/latest` `/gps/unidad/:id` — ingesta y consulta GPS
- `/alertas` `/alertas/evaluar` `/alertas/:id/{atender,resolver,descartar}` — alertas persistentes con ciclo de vida
- `/supervisor` — resumen IA determinístico (Fase 1, LLM en Fase 2)
- `/scoring` `/scoring/snapshot` `/scoring/historico/:id` — scoring de operadores
- `/diesel/baselines` `/diesel/recomputar` `/diesel/forense/:id` — diesel inteligente
- `/config` — umbrales operativos visibles

**Frontend**: nueva ruta `/command-ai` con tabs Dashboard / Alertas / Supervisor IA / Scoring / Diesel.
Visible para roles: `director`, `admin`, `logistica`, `monitoreo`.

**BD**: 5 tablas nuevas (`gps_pings`, `alertas`, `scoring_snapshots`, `diesel_baselines`, `audit_log`) + vista `unidades_ultima_posicion`.

## Cómo activarlo (1 vez, ~5 minutos)

### 1) Aplica la migración en Railway

Abre Railway → tu base de datos → **Query Runner**. Copia el contenido de `migration_fase5_command_ai.sql` y ejecútalo. Debe terminar con un SELECT mostrando 5 tablas con `count = 0`.

### 2) (Opcional) Seed demo

Para que el dashboard muestre algo de inmediato sin esperar GPS real, ejecuta también `seed_command_ai.sql` en el Query Runner. Es **idempotente** (no duplica si lo corres dos veces).

### 3) Despliega

El backend ya tiene la ruta registrada en `backend/src/index.js`. Cuando hagas `git push`, Railway redespliega automáticamente.

### 4) Verifica

- Abre el ERP, ve a **Command AI** en el menú lateral
- Tab Dashboard: deberías ver tu flota
- Tab Alertas: pulsa "⚡ Evaluar reglas ahora" para correr el motor
- Tab Scoring: pulsa "📸 Guardar snapshot" para crear el primer histórico
- Tab Diesel: pulsa "🧮 Recalcular baselines" (necesitas ≥ 3 viajes completados por unidad)

## Configuración (variables de entorno)

No requiere variables nuevas en Fase 1. Usa el `DATABASE_URL` y `JWT_SECRET` que el ERP ya tiene.

Para Fase 2 (supervisor IA con LLM):
```
ANTHROPIC_API_KEY=sk-ant-...
```

## Roadmap del módulo

- **Fase 1 (este sprint):** ✅ tablas, motor de reglas determinístico, frontend completo, GPS via webhook/manual
- **Fase 2:** integración Claude API en `/supervisor` con tool-use, mapa real (Mapbox), WhatsApp Business para escalado
- **Fase 3:** ingesta GPS automatizada (proveedor real), geofencing PostGIS, reportes PDF, app móvil del operador

## Cómo recibir pings GPS reales

Tu proveedor GPS o app móvil debe hacer POST a `/api/command-ai/gps/ping` con header `Authorization: Bearer <token>`:

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

Para ingesta masiva (recomendado para proveedor GPS):

```
POST /api/command-ai/gps/batch
{ "pings": [ {...}, {...} ] }
```

## Cron jobs recomendados (Fase 2)

- Cada 5 min: `POST /api/command-ai/alertas/evaluar` para generar alertas automáticamente
- Diario 6am: `POST /api/command-ai/scoring/snapshot` para histórico de scores
- Semanal: `POST /api/command-ai/diesel/recomputar` para refinar baselines

En Railway se pueden configurar como cron tasks o desde una instancia separada con `node-cron`.
