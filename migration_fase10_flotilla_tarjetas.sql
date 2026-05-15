-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 10
-- Tarjetas de flotilla (combustible) + TAGs de casetas
-- =============================================
-- Modela las tarjetas Edenred/Pemex/Sí Vale y los TAGs IAVE/PASE/TeleVía
-- con sus movimientos. Arquitectura preparada para webhooks API (fase futura).
-- =============================================

-- Catálogo de proveedores soportados (seed)
CREATE TABLE IF NOT EXISTS flotilla_proveedores (
  id          SERIAL PRIMARY KEY,
  tipo        VARCHAR(20) NOT NULL CHECK (tipo IN ('combustible','caseta','peaje','otro')),
  nombre      VARCHAR(80) NOT NULL UNIQUE,
  descripcion TEXT,
  api_disponible BOOLEAN DEFAULT false,
  api_documentacion_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed catalog
INSERT INTO flotilla_proveedores (tipo, nombre, descripcion, api_disponible, api_documentacion_url) VALUES
  ('combustible', 'Edenred Combustible', 'Tarjeta de combustible más usada en MX. Acepta Pemex, BP, Shell, Mobil, G500, Petro7, Total, Hidrosina.', true, 'https://www.edenred.mx/combustible'),
  ('combustible', 'Pemex Servicio Empresarial', 'Tarjeta directa de Pemex para flotas.', false, NULL),
  ('combustible', 'Sí Vale Combustible', 'Alternativa a Edenred con red similar.', true, 'https://www.sivale.mx'),
  ('combustible', 'Carnet Combustible', 'Tarjeta del grupo Sodexo.', false, NULL),
  ('combustible', 'Otro proveedor combustible', 'Captura genérica para proveedor no listado.', false, NULL),
  ('caseta', 'IAVE (CAPUFE)', 'TAG oficial para autopistas federales operadas por CAPUFE. El más común en MX.', false, 'https://www.iave.com.mx'),
  ('caseta', 'PASE', 'TAG privado para autopistas concesionadas.', false, 'https://www.pase.com.mx'),
  ('caseta', 'TeleVía', 'TAG de CDMX y zona metropolitana.', false, NULL),
  ('caseta', 'Otro proveedor caseta', 'Captura genérica para TAG no listado.', false, NULL)
ON CONFLICT (nombre) DO NOTHING;

-- ── TARJETAS DE COMBUSTIBLE ────────────────────────────
CREATE TABLE IF NOT EXISTS tarjetas_flotilla (
  id              SERIAL PRIMARY KEY,
  proveedor_id    INTEGER NOT NULL REFERENCES flotilla_proveedores(id),
  numero          VARCHAR(30) NOT NULL,         -- ej: "Edenred Combustible #****1234"
  alias           VARCHAR(60),                  -- nombre amigable (ej: "Tarjeta TR-01")
  unidad_id       INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  operador_id     INTEGER REFERENCES operadores(id) ON DELETE SET NULL,
  saldo_actual    DECIMAL(12, 2) DEFAULT 0,
  limite_diario   DECIMAL(10, 2),
  limite_semanal  DECIMAL(10, 2),
  pin_configurado BOOLEAN DEFAULT false,
  activa          BOOLEAN NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proveedor_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_tarjetas_activa ON tarjetas_flotilla (activa);
CREATE INDEX IF NOT EXISTS idx_tarjetas_unidad ON tarjetas_flotilla (unidad_id);
CREATE INDEX IF NOT EXISTS idx_tarjetas_operador ON tarjetas_flotilla (operador_id);

CREATE TABLE IF NOT EXISTS movimientos_tarjeta (
  id               BIGSERIAL PRIMARY KEY,
  tarjeta_id       INTEGER NOT NULL REFERENCES tarjetas_flotilla(id) ON DELETE CASCADE,
  fecha            TIMESTAMPTZ NOT NULL,
  estacion         VARCHAR(150),
  estacion_lat     DECIMAL(9,6),
  estacion_lng     DECIMAL(9,6),
  tipo_combustible VARCHAR(20),
  litros           DECIMAL(8,2),
  precio_litro     DECIMAL(8,3),
  monto            DECIMAL(10,2) NOT NULL,
  saldo_post       DECIMAL(12,2),
  folio_externo    VARCHAR(50),          -- folio del proveedor (Edenred, etc.)
  fuente           VARCHAR(20) NOT NULL DEFAULT 'manual', -- manual | csv | api
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tarjeta_id, folio_externo, fecha)   -- evita duplicar al re-importar
);
CREATE INDEX IF NOT EXISTS idx_movtarj_tarjeta_fecha ON movimientos_tarjeta (tarjeta_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_movtarj_fecha ON movimientos_tarjeta (fecha DESC);

-- ── TAGS DE CASETAS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags_caseta (
  id              SERIAL PRIMARY KEY,
  proveedor_id    INTEGER NOT NULL REFERENCES flotilla_proveedores(id),
  numero          VARCHAR(30) NOT NULL,
  alias           VARCHAR(60),
  unidad_id       INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  saldo_actual    DECIMAL(12,2) DEFAULT 0,
  activa          BOOLEAN NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proveedor_id, numero)
);
CREATE INDEX IF NOT EXISTS idx_tags_activa ON tags_caseta (activa);
CREATE INDEX IF NOT EXISTS idx_tags_unidad ON tags_caseta (unidad_id);

CREATE TABLE IF NOT EXISTS cruces_tag (
  id              BIGSERIAL PRIMARY KEY,
  tag_id          INTEGER NOT NULL REFERENCES tags_caseta(id) ON DELETE CASCADE,
  fecha           TIMESTAMPTZ NOT NULL,
  caseta          VARCHAR(150),
  caseta_carril   VARCHAR(20),
  caseta_lat      DECIMAL(9,6),
  caseta_lng      DECIMAL(9,6),
  monto           DECIMAL(10,2) NOT NULL,
  saldo_post      DECIMAL(12,2),
  folio_externo   VARCHAR(50),
  fuente          VARCHAR(20) NOT NULL DEFAULT 'manual',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tag_id, folio_externo, fecha)
);
CREATE INDEX IF NOT EXISTS idx_cruces_tag_fecha ON cruces_tag (tag_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cruces_fecha ON cruces_tag (fecha DESC);

-- Audit
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL,
  'migracion_fase10',
  'sistema',
  jsonb_build_object(
    'fase', 'flotilla_tarjetas_tags',
    'cambios', jsonb_build_array(
      'tabla flotilla_proveedores (catalog de Edenred/Pemex/IAVE/etc) sembrada',
      'tabla tarjetas_flotilla creada',
      'tabla movimientos_tarjeta creada (con UNIQUE para evitar duplicados al re-importar)',
      'tabla tags_caseta creada',
      'tabla cruces_tag creada',
      'arquitectura preparada para webhooks de API (fuente=api en futuro)'
    )
  ),
  'migration_script'
);

SELECT
  'flotilla_proveedores' AS tabla, COUNT(*)::int AS filas FROM flotilla_proveedores
UNION ALL SELECT 'tarjetas_flotilla', COUNT(*)::int FROM tarjetas_flotilla
UNION ALL SELECT 'movimientos_tarjeta', COUNT(*)::int FROM movimientos_tarjeta
UNION ALL SELECT 'tags_caseta', COUNT(*)::int FROM tags_caseta
UNION ALL SELECT 'cruces_tag', COUNT(*)::int FROM cruces_tag
ORDER BY tabla;
