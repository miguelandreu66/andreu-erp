-- =============================================
-- GRUPO ANDREU ERP — Schema completo v2
-- =============================================

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('director','admin','caja','logistica','monitoreo')),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(20),
  direccion TEXT,
  tipo VARCHAR(30) DEFAULT 'publico_general' CHECK (tipo IN ('constructora','ferreteria','publico_general','municipio','otro')),
  notas TEXT,
  activo BOOLEAN DEFAULT true,
  creado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ventas (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  producto VARCHAR(50) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  tipo_pago VARCHAR(20) NOT NULL DEFAULT 'Efectivo',
  cliente_id INTEGER REFERENCES clientes(id),
  notas TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE operadores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  telefono VARCHAR(20),
  licencia VARCHAR(50),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE unidades (
  id SERIAL PRIMARY KEY,
  placas VARCHAR(20) NOT NULL,
  descripcion VARCHAR(100),
  marca VARCHAR(50),
  modelo VARCHAR(50),
  anio INTEGER,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE viajes (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  operador_id INTEGER REFERENCES operadores(id),
  unidad_id INTEGER REFERENCES unidades(id),
  destino VARCHAR(100) NOT NULL,
  carga VARCHAR(50) NOT NULL,
  diesel_litros DECIMAL(8,2) DEFAULT 0,
  diesel_costo DECIMAL(10,2) DEFAULT 0,
  estado VARCHAR(20) DEFAULT 'Completado' CHECK (estado IN ('Completado','En ruta','Cancelado')),
  notas TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE gastos (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  categoria VARCHAR(50) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  comprobante BOOLEAN DEFAULT false,
  descripcion TEXT,
  estado_aprobacion VARCHAR(20) DEFAULT 'pendiente' CHECK (estado_aprobacion IN ('pendiente','aprobado','rechazado')),
  aprobado_por INTEGER REFERENCES usuarios(id),
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE inventario (
  id SERIAL PRIMARY KEY,
  producto VARCHAR(100) NOT NULL UNIQUE,
  existencia DECIMAL(10,2) DEFAULT 0,
  unidad VARCHAR(20) NOT NULL,
  punto_reorden DECIMAL(10,2) DEFAULT 0,
  actualizado_por INTEGER REFERENCES usuarios(id),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE empleados (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  puesto VARCHAR(100) NOT NULL,
  area VARCHAR(50) NOT NULL CHECK (area IN ('Materiales','Logistica','Administracion','Central')),
  sueldo_semanal DECIMAL(10,2) NOT NULL,
  telefono VARCHAR(20),
  fecha_ingreso DATE,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE nomina_pagos (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER REFERENCES empleados(id),
  semana_inicio DATE NOT NULL,
  sueldo_base DECIMAL(10,2) NOT NULL,
  bonos DECIMAL(10,2) DEFAULT 0,
  deducciones DECIMAL(10,2) DEFAULT 0,
  anticipos_aplicados DECIMAL(10,2) DEFAULT 0,
  total_pago DECIMAL(10,2) NOT NULL,
  pagado BOOLEAN DEFAULT false,
  fecha_pago DATE,
  notas TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE anticipos (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER REFERENCES empleados(id),
  monto DECIMAL(10,2) NOT NULL,
  fecha DATE NOT NULL,
  motivo TEXT,
  aplicado BOOLEAN DEFAULT false,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mantenimientos (
  id SERIAL PRIMARY KEY,
  unidad_id INTEGER REFERENCES unidades(id),
  operador_id INTEGER REFERENCES operadores(id),
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('preventivo','correctivo','aceite','llantas','frenos','electrico','otro')),
  descripcion TEXT NOT NULL,
  costo DECIMAL(10,2) DEFAULT 0,
  fecha DATE NOT NULL,
  kilometraje INTEGER DEFAULT 0,
  proximo_km INTEGER,
  proximo_fecha DATE,
  estado VARCHAR(20) DEFAULT 'completado' CHECK (estado IN ('completado','pendiente','en_proceso')),
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notificaciones_log (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50) NOT NULL,
  mensaje TEXT NOT NULL,
  enviado_a VARCHAR(20),
  ok BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- DATOS INICIALES
-- Contrasena inicial: andreu2024 — CAMBIA ESTO EN CONFIGURACION
INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES
('Director Andreu', 'director@grupoandreu.mx', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p39X0BE4GDz6E5bCfL5eWi', 'director');

INSERT INTO operadores (nombre) VALUES ('Operador 1'), ('Operador 2'), ('Operador 3');

INSERT INTO inventario (producto, existencia, unidad, punto_reorden) VALUES
('Block', 0, 'piezas', 1000),
('Cemento', 0, 'bultos', 50),
('Varilla', 0, 'toneladas', 5),
('Arena', 0, 'metros³', 10),
('Grava', 0, 'metros³', 5);

INSERT INTO clientes (nombre, tipo) VALUES
('Publico general', 'publico_general'),
('Sin asignar', 'otro');
