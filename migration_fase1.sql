-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 1
-- Ventas multi-producto + base CXC
-- =============================================
-- INSTRUCCIONES: Ejecutar en Railway → tu DB → Query Runner
-- Puedes ejecutar todo junto, el orden importa.
-- =============================================

-- 1. Agregar precio_unitario al catálogo de inventario
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS precio_unitario DECIMAL(12,2) DEFAULT 0;

-- 2. Nuevas columnas en ventas (compatibles con datos existentes)
ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS subtotal          DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS descuento         DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total             DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS tipo_venta        VARCHAR(20)   DEFAULT 'contado',
  ADD COLUMN IF NOT EXISTS estado_pago       VARCHAR(20)   DEFAULT 'pagado',
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

-- Rellenar total/subtotal con monto para registros históricos
UPDATE ventas SET subtotal = monto, total = monto WHERE total IS NULL;

-- Agregar restricciones después de poblar
ALTER TABLE ventas
  DROP CONSTRAINT IF EXISTS ventas_tipo_venta_check,
  DROP CONSTRAINT IF EXISTS ventas_estado_pago_check;

ALTER TABLE ventas
  ADD CONSTRAINT ventas_tipo_venta_check
    CHECK (tipo_venta IN ('contado','credito')),
  ADD CONSTRAINT ventas_estado_pago_check
    CHECK (estado_pago IN ('pagado','parcial','pendiente'));

-- 3. Tabla de líneas de venta (detalle multi-producto)
CREATE TABLE IF NOT EXISTS ventas_detalle (
  id              SERIAL PRIMARY KEY,
  venta_id        INTEGER       NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  inventario_id   INTEGER       REFERENCES inventario(id),
  descripcion     VARCHAR(100)  NOT NULL,
  cantidad        DECIMAL(10,2) NOT NULL,
  precio_unitario DECIMAL(12,2) NOT NULL,
  subtotal        DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMP     DEFAULT NOW()
);

-- 4. Migrar ventas históricas: 1 línea por venta (sin duplicar si ya existe)
INSERT INTO ventas_detalle (venta_id, descripcion, cantidad, precio_unitario, subtotal)
SELECT v.id, v.producto, 1, v.monto, v.monto
FROM ventas v
WHERE v.id NOT IN (SELECT DISTINCT venta_id FROM ventas_detalle);

-- 5. Tabla de abonos (base para Módulo CXC — Fase 2)
CREATE TABLE IF NOT EXISTS abonos (
  id             SERIAL PRIMARY KEY,
  venta_id       INTEGER       NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  fecha          DATE          NOT NULL DEFAULT CURRENT_DATE,
  monto          DECIMAL(12,2) NOT NULL,
  tipo_pago      VARCHAR(20)   NOT NULL DEFAULT 'Efectivo',
  notas          TEXT,
  registrado_por INTEGER       REFERENCES usuarios(id),
  created_at     TIMESTAMP     DEFAULT NOW()
);

-- Verificación final
SELECT
  'ventas'          AS tabla, COUNT(*) AS registros FROM ventas
UNION ALL SELECT
  'ventas_detalle',           COUNT(*)              FROM ventas_detalle
UNION ALL SELECT
  'abonos',                   COUNT(*)              FROM abonos;
