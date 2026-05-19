# 🏢 Andreu Logistics

**Sistema ERP + Autopilot para transporte de carga pesada.** Operación propia de 3 plataformas 48' en Cuernavaca, Morelos. B2B exclusivo.

> El módulo de brokerage (intermediación con transportistas terceros) se separó en mayo 2026 al sistema independiente **[VIVO](https://github.com/miguelandreu66/vivo-broker)**. Andreu Logistics se enfoca **exclusivamente en la flota propia**.

---

## 🎯 Qué es Andreu Logistics

ERP para operación de flota propia:

- **Ventas + CFDI 4.0 + Carta Porte 3.0** — facturación SAT lista
- **Flotilla** — unidades, mantenimiento, tarjetas, TAGs
- **Operadores** — nómina, scoring, documentos
- **Logística** — viajes, cotizaciones, GPS en vivo (Autopilot)
- **Finanzas** — gastos, CXC, cobranza
- **Inventario** — refacciones, llantas, insumos
- **7 Agentes IA** (Director, Operaciones, CFO, Abogado, Contador, RRHH, Comercial)
- **Autopilot** (antes "Command AI") — supervisión inteligente automática

---

## 🏗️ Arquitectura

```
andreu-erp/
├── backend/          Node.js + Express + Postgres (Railway)
│   ├── src/
│   │   ├── routes/   24 rutas API
│   │   ├── lib/
│   │   │   ├── agents/        7 agentes IA (orchestrator + registry)
│   │   │   ├── commandAi/     Autopilot (GPS, alertas, scoring, diesel)
│   │   │   ├── cronJobs.js    Tareas automatizadas
│   │   │   ├── seguridad.js   Helmet + rate limit + CORS
│   │   │   └── healthcheck.js Monitoreo /health/full
│   │   └── scripts/run-migrations.js
│   └── railway.json
├── frontend/         React (CRA) — UI estilo claro #1B3A6B
│   ├── src/pages/    24 páginas
│   └── railway.json
├── migration_*.sql   24 migrations legacy en raíz
└── DEPLOY-RAILWAY.md Guía de deploy
```

---

## 🚀 Quickstart

```bash
# Backend
cd backend
cp .env.example .env             # Llena DATABASE_URL + JWT_SECRET
npm install
npm run migrate                  # Idempotente, bootstrap-safe
npm run dev                      # http://localhost:4000

# Frontend (otra terminal)
cd frontend
cp .env.example .env             # REACT_APP_API_URL=http://localhost:4000/api
npm install
npm start                        # http://localhost:3000
```

Login default: **miguel@grupoandreu.com** / _(la que configuraste en migrations)_

---

## 🤖 7 Agentes IA

| Agente | Modelo | Rol |
|---|---|---|
| 🎩 **Director IA** | Opus 4.7 | Estratega — decisiones de largo plazo |
| ⚙️ **Operaciones IA** | Sonnet 4.6 | Asignación, rutas, mantenimiento |
| 💼 **CFO IA** | Opus 4.7 | Cashflow, margen, proyecciones |
| ⚖️ **Abogado IA** | Opus 4.7 | Carta Porte SAT, contratos, multas SCT |
| 📊 **Contador IA** | Opus 4.7 | CFDI, ISR, IVA, DIOT |
| 👥 **RRHH IA** | Sonnet 4.6 | Operadores, bonos, LFT |
| 💵 **Comercial IA** | Sonnet 4.6 | Cotizador, retención clientes |

BYOK: la Anthropic key se configura desde `/configuracion` (encriptada en DB).

---

## 🤖 Autopilot

Capa de supervisión sobre la operación cotidiana. Lo que automatiza:

- **GPS en vivo** — pings de unidades cada 1-2 seg (proveedor + app móvil operador)
- **Alertas** — motor de reglas (velocidad excesiva, desvíos, retraso)
- **Scoring de operadores** — viajes + incidentes + rendimiento diesel
- **Diesel forense** — baselines por unidad, OCR de tickets, anomalías
- **Briefing IA diario** — el Director recibe resumen ejecutivo cada mañana

Ver `AUTOPILOT_README.md`.

---

## 📊 Páginas clave

| Ruta | Rol | Qué muestra |
|---|---|---|
| `/` | Todos | Dashboard ejecutivo |
| `/autopilot` | director/admin/log/mon | GPS en vivo + alertas + supervisor IA |
| `/operativo` | director/admin/caja/log | KPIs flota: ingresos, gastos, margen, top operadores |
| `/agentes` | director/admin/caja/log | Hub para conversar con los 7 agentes IA |
| `/auditor` | director | Auditoría IA semanal |
| `/costos-ia` | director/admin | Gasto Claude por agente |
| `/fiscal` | director/admin/caja | CFDI + Carta Porte 3.0 |
| `/cotizaciones` | director/admin/caja | Cotizador interno |
| `/clientes`, `/cxc`, `/ventas` | director/admin/caja | Cartera + cobranza |
| `/flotilla`, `/unidades`, `/operadores`, `/mantenimiento` | director/admin/log | Flota |
| `/movil` | operadores | App PWA para operadores |

---

## 🛡️ Seguridad

- Helmet (headers + CSP)
- CORS whitelist (`FRONTEND_URL` env, separado por coma)
- Rate limits: login (5/15min), agentes IA (30/min), GPS (600/min), API general (200/min)
- JWT con secret ≥ 64 chars
- BYOK: API keys en DB cifradas (Anthropic, Cloudinary, Twilio)
- ErrorBoundary frontend
- Audit log en `audit_log` (cada acción crítica registrada)

---

## 🚂 Deploy

Andreu **ya está en producción en Railway**. Para redeploy o staging ver **`DEPLOY-RAILWAY.md`** (incluye bootstrap-safety: el migrate runner detecta DB heredada y marca migrations como aplicadas sin re-correr).

```bash
git push origin main   # Railway redeploya automático
```

---

## 📜 Licencia

Propietario · Miguel Cantoran Andreu · 2026

> El sistema interno de operación de **Grupo Andreu** — 3 plataformas 48' en Cuernavaca.
