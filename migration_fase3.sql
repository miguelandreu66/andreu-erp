-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 3
-- Compras a Proveedores + Cuentas por Pagar
-- =============================================
-- Ejecutar en Railway → tu DB → Query Runner
-- =============================================

-- 1. Catálogo de proveedores
CREATE TABLE IF NOT EXISTS proveedores (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  contacto    VARCHAR(100),
  telefono    VARCHAR(20),
  email       VARCHAR(100),
  direccion   TEXT,
  rfc         VARCHAR(20),
  productos   TEXT,          -- qué vende (referencia rápida)
  notas       TEXT,
  activo      BOOLEAN   DEFAULT true,
  creado_por  INTEGER   REFERENCES usuarios(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. Órdenes de compra (cabecera)
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id                     SERIAL PRIMARY KEY,
  folio                  VARCHAR(20) UNIQUE,
  proveedor_id           INTEGER NOT NULL REFERENCES proveedores(id),
  fecha                  DATE    NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega_esperada DATE,
  estado                 VARCHAR(30) DEFAULT 'borrador'
    CHECK (estado IN ('borrador','autorizada','recibida_parcial','recibida','cancelada')),
  subtotal               DECIMAL(12,2) DEFAULT 0,
  descuento              DECIMAL(12,2) DEFAULT 0,
  total                  DECIMAL(12,2) DEFAULT 0,
  notas                  TEXT,
  solicitado_por         INTEGER REFERENCES usuarios(id),
  autorizado_por         INTEGER REFERENCES usuarios(id),
  fecha_autorizacion     TIMESTAMP,
  created_at             TIMESTAMP DEFAULT NOW()
);

-- 3. Detalle de órdenes de compra
CREATE TABLE IF NOT EXISTS ordenes_compra_detalle (
  id                 SERIAL PRIMARY KEY,
  orden_id           INTEGER       NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  inventario_id      INTEGER       REFERENCES inventario(id),
  descripcion        VARCHAR(100)  NOT NULL,
  cantidad_pedida    DECIMAL(10,2) NOT NULL,
  precio_unitario    DECIMAL(12,2) NOT NULL,
  subtotal           DECIMAL(12,2) NOT NULL,
  cantidad_recibida  DECIMAL(10,2) DEFAULT 0,
  created_at         TIMESTAMP DEFAULT NOW()
);

-- 4. Recepciones de mercancía
CREATE TABLE IF NOT EXISTS recepciones (
  id             SERIAL PRIMARY KEY,
  orden_id       INTEGER NOT NULL REFERENCES ordenes_compra(id),
  fecha          DATE    NOT NULL DEFAULT CURRENT_DATE,
  notas          TEXT,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recepciones_detalle (
  id               SERIAL PRIMARY KEY,
  recepcion_id     INTEGER       NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  orden_detalle_id INTEGER       NOT NULL REFERENCES ordenes_compra_detalle(id),
  descripcion      VARCHAR(100)  NOT NULL,
  cantidad         DECIMAL(10,2) NOT NULL,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 5. Cuentas por pagar
CREATE TABLE IF NOT EXISTS cuentas_pagar (
  id                SERIAL PRIMARY KEY,
  proveedor_id      INTEGER       NOT NULL REFERENCES proveedores(id),
  orden_id          INTEGER       REFERENCES ordenes_compra(id),
  concepto          VARCHAR(200)  NOT NULL,
  monto_total       DECIMAL(12,2) NOT NULL,
  monto_pagado      DECIMAL(12,2) DEFAULT 0,
  fecha_emision     DATE          NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  estado            VARCHAR(20)   DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','parcial','pagado','cancelado')),
  notas             TEXT,
  registrado_por    INTEGER REFERENCES usuarios(id),
  created_at        TIMESTAMP DEFAULT NOW()
);

-- 6. Pagos a proveedores
CREATE TABLE IF NOT EXISTS pagos_proveedor (
  id              SERIAL PRIMARY KEY,
  cuenta_pagar_id INTEGER       NOT NULL REFERENCES cuentas_pagar(id),
  fecha           DATE          NOT NULL DEFAULT CURRENT_DATE,
  monto           DECIMAL(12,2) NOT NULL,
  tipo_pago       VARCHAR(20)   DEFAULT 'Transferencia',
  referencia      VARCHAR(100),
  notas           TEXT,
  registrado_por  INTEGER REFERENCES usuarios(id),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Verificación
SELECT 'proveedores'          AS tabla, COUNT(*) AS registros FROM proveedores
UNION ALL SELECT 'ordenes_compra',            COUNT(*) FROM ordenes_compra
UNION ALL SELECT 'ordenes_compra_detalle',    COUNT(*) FROM ordenes_compra_detalle
UNION ALL SELECT 'cuentas_pagar',             COUNT(*) FROM cuentas_pagar
UNION ALL SELECT 'pagos_proveedor',           COUNT(*) FROM pagos_proveedor;
