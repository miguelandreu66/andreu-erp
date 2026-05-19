# 🚂 Deploy Andreu Logistics en Railway

Andreu **ya está en producción** en Railway. Este documento es para:
- Re-deployar tras un fork / wipe del proyecto.
- Levantar un entorno staging.
- Onboarding de un nuevo desarrollador.

Para la guía paso-a-paso del **usuario final** (constitución cuenta GitHub, Railway, etc.)
ver `INSTALACION.md`.

---

## 🆕 Qué cambió en mayo 2026

Andreu ahora tiene la misma plantilla de deploy que VIVO:

| Pieza | Para qué |
|---|---|
| `backend/railway.json` | Railway lee config sin tocar el panel |
| `backend/scripts/run-migrations.js` | Runner idempotente + **bootstrap-safe** (si ya hay tablas en la DB, marca todas las migrations como aplicadas sin re-correrlas) |
| `backend/package.json` script `migrate` | `npm run migrate` aplica nuevas migrations |
| `backend/.env.example` | Plantilla de variables |
| `frontend/railway.json` | Build + sirve estático con `serve` |
| `frontend/package.json` + `serve` | Sirve `build/` en producción |
| `frontend/.env.example` | Plantilla |

**Importante**: el `startCommand` del backend ahora es `npm run migrate && npm start`.
En el siguiente deploy a producción, el runner detectará que ya hay tablas (la
**bootstrap-safety**) y marcará las 24 migrations existentes como aplicadas sin
re-ejecutarlas. **Cero downtime, cero data loss.**

---

## 🔌 Variables de entorno (Railway)

### Backend service
```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<64 chars hex random>
NODE_ENV=production
PORT=4000
FRONTEND_URL=https://andreu-frontend.up.railway.app
BACKEND_URL=https://andreu-backend.up.railway.app
ENABLE_CRON=true
CRON_TZ=America/Mexico_City

# Opcionales (Autopilot escalado vía WhatsApp)
TWILIO_SID=AC...
TWILIO_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
DIRECTOR_WHATSAPP=whatsapp:+52777XXXXXXX
```

### Frontend service
```bash
REACT_APP_API_URL=https://andreu-backend.up.railway.app/api
```

---

## 📦 Estructura monorepo en Railway

Andreu es un monorepo (backend + frontend en un solo repo). En Railway debes crear
**2 servicios** apuntando al mismo repo con distintos `Root Directory`:

| Servicio | Root Directory | Railway config |
|---|---|---|
| `andreu-backend` | `backend` | `backend/railway.json` |
| `andreu-frontend` | `frontend` | `frontend/railway.json` |
| `andreu-db` | (Postgres add-on) | — |

---

## 🚀 Re-deploy desde cero

```
1. railway.com/new → Deploy from GitHub repo → miguelandreu66/andreu-erp
2. + Create → Database → PostgreSQL
3. + Create → GitHub Repo → andreu-erp
   - Settings → Root Directory: backend
   - Variables: pega el bloque "Backend service" de arriba
   - Generate Domain
4. + Create → GitHub Repo → andreu-erp
   - Settings → Root Directory: frontend
   - Variables: REACT_APP_API_URL con la URL del backend
   - Generate Domain
5. Vuelve al backend → actualiza FRONTEND_URL con la URL real del frontend
6. Deploys → ambos servicios redeploy
```

---

## 🛡️ Bootstrap-safety: cómo funciona

En el primer arranque tras este cambio:

1. Backend ejecuta `npm run migrate`
2. El runner crea la tabla `schema_migrations` si no existe
3. **Verifica si la tabla `usuarios` ya existe** (señal de "DB heredada")
4. Si sí → marca las 24 `migration_*.sql` como aplicadas sin correrlas. Listo.
5. Si no (fresh deploy) → corre las 24 en orden numérico (fase1 → fase23).
6. Backend arranca normal con `npm start`.

A partir de ahora, cualquier nueva migration que añadas (ej. `migrations/024_xxx.sql`)
se aplicará automáticamente en el siguiente deploy.

---

## ✅ Verificación

- `GET /health` → `{ status: "ok", app: "Andreu Logistics" }`
- Login con credenciales del director → entra al dashboard
- Sidebar muestra **Autopilot** (antes "Command AI") con datos en vivo
- `/agentes` → conversa con cualquiera de los 7 agentes IA (requiere Anthropic key en `/configuracion`)

---

## 🆘 Si algo truena tras el cambio

El startCommand original era solo `npm start`. Si necesitas volver atrás temporalmente:

1. En Railway → backend service → Settings → Deploy → **Custom Start Command**
2. Sobrescribe con: `npm start` (sin el `npm run migrate &&`)
3. Redeploy

Esto deshabilita el migrate runner sin tocar el código.
