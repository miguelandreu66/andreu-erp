-- ══════════════════════════════════════════════════════════════════════
--  Grupo Andreu ERP — Migración: Cotizaciones / Presupuestos
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cotizaciones (
  id                   SERIAL PRIMARY KEY,
  folio                VARCHAR(20) UNIQUE,
  fecha                DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento    DATE,                             -- validez de la cotización
  cliente_id           INTEGER REFERENCES clientes(id),
  cliente_nombre_libre VARCHAR(200),                     -- si no está en catálogo
  subtotal             DECIMAL(12,2) DEFAULT 0,
  descuento            DECIMAL(12,2) DEFAULT 0,
  total                DECIMAL(12,2) DEFAULT 0,
  estado               VARCHAR(30) DEFAULT 'borrador',   -- borrador/enviada/aceptada/rechazada/convertida
  notas                TEXT,
  condiciones          TEXT,                             -- condiciones de pago / entrega
  creado_por           INTEGER REFERENCES usuarios(id),
  venta_id             INTEGER REFERENCES ventas(id),    -- se llena al convertir
  created_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cotizaciones_detalle (
  id                SERIAL PRIMARY KEY,
  cotizacion_id     INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  inventario_id     INTEGER REFERENCES inventario(id),   -- opcional (link a inventario)
  descripcion       VARCHAR(300) NOT NULL,
  cantidad          DECIMAL(10,3) NOT NULL DEFAULT 1,
  precio_unitario   DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal          DECIMAL(12,2) NOT NULL DEFAULT 0
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado        ON cotizaciones(estado);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_cliente       ON cotizaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_detalle_cotid ON cotizaciones_detalle(cotizacion_id);
