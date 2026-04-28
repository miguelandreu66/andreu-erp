# GUIA DE INSTALACION — SISTEMA ERP GRUPO ANDREU v2
# Tiempo: 45-60 minutos · Dificultad: Lo puedes hacer tu mismo

## LO QUE NECESITAS ANTES DE EMPEZAR
- Una computadora con internet
- Correo electronico
- Tarjeta debito/credito (para Railway, ~$5 USD/mes = ~$100 MXN)
- 1 hora sin interrupciones

---

## PASO 1 — INSTALAR NODE.JS

1. Ve a: https://nodejs.org
2. Descarga la version que dice "LTS"
3. Ejecuta el instalador, haz clic en Next en todo hasta Finish
4. Verificar que funciono:
   - Windows: presiona Windows+R, escribe cmd, presiona Enter
   - Mac: abre Terminal (Cmd+Space, escribe Terminal)
   - Escribe: node --version
   - Si ves un numero como v20.x.x = LISTO ✅

---

## PASO 2 — CREAR CUENTA EN GITHUB

1. Ve a: https://github.com
2. Clic en "Sign up"
3. Pon tu correo y crea contraseña
4. Verifica tu correo
5. Listo ✅

---

## PASO 3 — INSTALAR GIT

WINDOWS:
1. Ve a: https://git-scm.com/download/win
2. Se descarga automaticamente
3. Ejecuta, clic en Next en todo

MAC:
- Abre Terminal y escribe: git --version
- Si te pregunta si quieres instalar, acepta

Verificar: escribe "git --version" en terminal. Si ves un numero = LISTO ✅

---

## PASO 4 — SUBIR EL CODIGO A GITHUB

4.1 DESCOMPRIMIR
- Busca el archivo andreu-erp-sistema.zip
- Extrae (clic derecho → Extraer aqui en Windows, doble clic en Mac)
- Se crea la carpeta andreu-erp

4.2 ABRIR TERMINAL EN LA CARPETA
- Windows: abre la carpeta andreu-erp en explorador de archivos, haz clic en la barra de direcciones, escribe cmd y Enter
- Mac: abre Terminal, escribe "cd " (con espacio), arrastra la carpeta andreu-erp al Terminal, Enter

4.3 CREAR REPOSITORIO EN GITHUB
- Ve a github.com → clic en "+" arriba → "New repository"
- Nombre: andreu-erp
- Clic en "Create repository"
- COPIA la URL que aparece: https://github.com/TU_USUARIO/andreu-erp.git

4.4 SUBIR EL CODIGO (escribe estos comandos uno por uno en la terminal)

git init
git add .
git commit -m "Sistema ERP Grupo Andreu v2"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/andreu-erp.git

(cambia TU_USUARIO por tu usuario real de GitHub)

git push -u origin main

- Espera 1-2 minutos
- Si te pide usuario/contraseña de GitHub, ponlos
- Listo ✅

---

## PASO 5 — CREAR CUENTA EN RAILWAY

1. Ve a: https://railway.app
2. Clic en "Login" → "Login with GitHub"
3. Autoriza Railway
4. Verifica tu numero de telefono
5. Elige el plan "Hobby" ($5 USD/mes)
6. Ingresa tu tarjeta
7. Listo ✅

---

## PASO 6 — CREAR LA BASE DE DATOS

1. En Railway, clic en "New Project"
2. Clic en "+ New" → "Database" → "Add PostgreSQL"
3. Espera 1-2 minutos
4. Clic en la base de datos que aparecio (dice "Postgres")
5. Clic en la pestana "Variables"
6. Copia el valor de "DATABASE_URL" y guardalo en un bloc de notas

---

## PASO 7 — CREAR LAS TABLAS

1. En Railway, clic en la base de datos PostgreSQL
2. Clic en pestana "Query" o "Data"
3. Abre el archivo backend/schema.sql con Bloc de notas
4. Selecciona TODO el contenido (Ctrl+A) y copialo (Ctrl+C)
5. Pegalo en el area de Query de Railway
6. Clic en "Run"
7. Listo ✅

---

## PASO 8 — CONFIGURAR EL BACKEND

8.1 CREAR SERVICIO BACKEND
1. En Railway, clic en "+ New" → "GitHub Repo"
2. Selecciona tu repositorio andreu-erp
3. Clic en el servicio que aparecio → Settings
4. Root Directory: backend
5. Start Command: node src/index.js
6. Clic en Save/Deploy

8.2 AGREGAR VARIABLES (pestana "Variables" del servicio backend)

DATABASE_URL = (el que copiaste en paso 6)
JWT_SECRET = AndreuERP2024ClaveSecretaGuerrero
NODE_ENV = production
DIRECTOR_WHATSAPP = +527771234567 (tu numero con codigo de pais)

8.3 OBTENER URL DEL BACKEND
- Settings → Domains → Generate Domain
- Copia esa URL: andreu-erp-backend.up.railway.app

---

## PASO 9 — CONFIGURAR EL FRONTEND

9.1 CREAR ARCHIVO .env
- En tu computadora, abre la carpeta andreu-erp/frontend
- Crea un archivo nuevo llamado: .env
- Abrelo con Bloc de notas y escribe:
  REACT_APP_API_URL=https://TU-URL-BACKEND.up.railway.app/api
  (cambia por la URL real de tu backend del paso 8.3)
- Guarda

9.2 SUBIR EL CAMBIO
- En la terminal escribe:
git add .
git commit -m "Config produccion"
git push

9.3 CREAR SERVICIO FRONTEND
1. Railway → "+ New" → "GitHub Repo" → selecciona andreu-erp
2. Clic en el nuevo servicio → Settings
3. Root Directory: frontend
4. Build Command: npm run build
5. Start Command: npx serve -s build -l 3000
6. Deploy

9.4 OBTENER URL FRONTEND
- Settings → Domains → Generate Domain
- Copia: andreu-erp-web.up.railway.app

9.5 ACTUALIZAR BACKEND
- Servicio backend → Variables → agregar:
  FRONTEND_URL = https://andreu-erp-web.up.railway.app

---

## PASO 10 — PRIMER ACCESO

1. Abre tu URL del frontend en el navegador
2. Email: director@grupoandreu.mx
3. Contrasena: andreu2024
4. IMPORTANTE: Entra a Configuracion → Mi contrasena y cambiala YA
5. Crea usuarios para tu equipo:
   - Natalia: admin / natalia@grupoandreu.mx
   - Yesi: caja / yesi@grupoandreu.mx
   - Walter: logistica / walter@grupoandreu.mx
   - Monitoreo: monitoreo / monitoreo@grupoandreu.mx

---

## SOLUCION DE PROBLEMAS

PROBLEMA: Pantalla en blanco o "Cannot connect"
SOLUCION: Railway → servicio backend → Logs → busca el error en rojo
El mas comun es DATABASE_URL mal copiada. Borrala y copia de nuevo.

PROBLEMA: No puedo iniciar sesion
SOLUCION: En Railway → PostgreSQL → Query, pega esto y ejecuta:
UPDATE usuarios SET password_hash='$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p39X0BE4GDz6E5bCfL5eWi' WHERE email='director@grupoandreu.mx';
Contrasena nueva: andreu2024

PROBLEMA: git push pide contrasena en loop
SOLUCION: Ve a GitHub → Settings → Developer settings → Personal access tokens
→ Generate new token → selecciona "repo" → Generate
→ Usa ESE TOKEN como contrasena en git (no tu contrasena de GitHub)

PROBLEMA: Railway dice "Build failed"
SOLUCION: Verifica en Settings que:
- Backend: Root Directory = backend
- Frontend: Root Directory = frontend

---

## ACCESOS POR ROL

director (tu): Ve y hace TODO
admin (Natalia): Todo excepto eliminar usuarios
caja (Yesi): Dashboard, Caja, Clientes, Gastos
logistica (Walter): Dashboard, Flota, Mantenimiento, Inventario
monitoreo: Solo lectura — Dashboard, Flota, Inventario, Tendencias

---

## COSTO MENSUAL

Railway Hobby: ~$5-10 USD/mes (~$100-200 MXN)
Twilio WhatsApp: ~$1-2 USD/mes (opcional)
TOTAL: ~$120-250 MXN/mes

El sistema es TUYO para siempre. Sin licencias, sin renovaciones.
