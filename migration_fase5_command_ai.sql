-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 5
-- Módulo COMMAND AI / Andreu Logistics
-- Capa de inteligencia operativa en tiempo real
-- =============================================
-- Ejecutar en Railway -> Query Runner
-- Idempotente: usa IF NOT EXISTS / ON CONFLICT
-- =============================================

-- ----------------------------------------------
-- 1) GPS PINGS — posiciones en tiempo real
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS gps_pings (
  id              BIGSERIAL PRIMARY KEY,
  unidad_id       INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  viaje_id        INTEGER REFERENCES viajes(id) ON DELETE SET NULL,
  lat             DECIMAL(9,6) NOT NULL,
  lng             DECIMAL(9,6) NOT NULL,
  velocidad_kmh   DECIMAL(5,2) DEFAULT 0,
  rumbo           DECIMAL(5,2),
  odometro_km     DECIMAL(10,2),
  fuente          VARCHAR(20) NOT NULL DEFAULT 'simulado',
  registrado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_pings_unidad_ts
  ON gps_pings (unidad_id, registrado_en DESC);
CREATE INDEX IF NOT EXISTS idx_gps_pings_viaje
  ON gps_pings (viaje_id) WHERE viaje_id IS NOT NULL;

-- Vista helper: última posición por unidad activa
CREATE OR REPLACE VIEW unidades_ultima_posicion AS
SELECT DISTINCT ON (p.unidad_id)
  p.unidad_id,
  p.viaje_id,
  p.lat,
  p.lng,
  p.velocidad_kmh,
  p.rumbo,
  p.odometro_km,
  p.fuente,
  p.registrado_en,
  EXTRACT(EPOCH FROM (NOW() - p.registrado_en)) / 60.0 AS minutos_desde_ultimo
FROM gps_pings p
ORDER BY p.unidad_id, p.registrado_en DESC;

-- ----------------------------------------------
-- 2) ALERTAS PERSISTENTES (con ciclo de vida)
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS alertas (
  id              BIGSERIAL PRIMARY KEY,
  tipo            VARCHAR(50) NOT NULL,
  nivel           VARCHAR(10) NOT NULL CHECK (nivel IN ('bajo','medio','alto','critico')),
  unidad_id       INTEGER REFERENCES unidades(id)   ON DELETE SET NULL,
  operador_id     INTEGER REFERENCES operadores(id) ON DELETE SET NULL,
  viaje_id        INTEGER REFERENCES viajes(id)     ON DELETE SET NULL,
  descripcion     TEXT    NOT NULL,
  recomendacion   TEXT,
  estado          VARCHAR(15) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','atendida','resuelta','descartada')),
  dedupe_key      VARCHAR(150) UNIQUE,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atendida_at     TIMESTAMPTZ,
  atendida_por    INTEGER REFERENCES usuarios(id),
  resuelta_at     TIMESTAMPTZ,
  resuelta_por    INTEGER REFERENCES usuarios(id),
  notas           TEXT
);
CREATE INDEX IF NOT EXISTS idx_alertas_estado_nivel ON alertas (estado, nivel);
CREATE INDEX IF NOT EXISTS idx_alertas_unidad       ON alertas (unidad_id);
CREATE INDEX IF NOT EXISTS idx_alertas_operador     ON alertas (operador_id);
CREATE INDEX IF NOT EXISTS idx_alertas_created      ON alertas (created_at DESC);

-- ----------------------------------------------
-- 3) SCORING SNAPSHOTS (histórico de scores)
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS scoring_snapshots (
  id                  BIGSERIAL PRIMARY KEY,
  operador_id         INTEGER NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
  periodo_inicio      DATE NOT NULL,
  periodo_fin         DATE NOT NULL,
  score               INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  viajes_totales      INTEGER NOT NULL DEFAULT 0,
  rendimiento_lt_km   DECIMAL(6,3),
  incidentes          INTEGER NOT NULL DEFAULT 0,
  puntualidad_pct     INTEGER NOT NULL DEFAULT 100,
  detalle             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operador_id, periodo_inicio, periodo_fin)
);
CREATE INDEX IF NOT EXISTS idx_scoring_operador
  ON scoring_snapshots (operador_id, periodo_fin DESC);

-- ----------------------------------------------
-- 4) DIESEL BASELINES (rendimiento esperado por unidad/destino)
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS diesel_baselines (
  id                          BIGSERIAL PRIMARY KEY,
  unidad_id                   INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  destino                     VARCHAR(100),
  rendimiento_esperado_lt_km  DECIMAL(6,3) NOT NULL,
  rendimiento_desviacion      DECIMAL(6,3) NOT NULL DEFAULT 0.15,
  muestras                    INTEGER NOT NULL DEFAULT 0,
  recalculado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- destino NULL = baseline general de la unidad
CREATE UNIQUE INDEX IF NOT EXISTS uq_diesel_baseline_general
  ON diesel_baselines (unidad_id) WHERE destino IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_diesel_baseline_destino
  ON diesel_baselines (unidad_id, destino) WHERE destino IS NOT NULL;

-- ----------------------------------------------
-- 5) AUDIT LOG (acciones del sistema y usuarios)
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  accion      VARCHAR(60) NOT NULL,
  entidad     VARCHAR(50),
  entidad_id  BIGINT,
  detalle     JSONB,
  ip          VARCHAR(45),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log (usuario_id, created_at DESC);

-- ----------------------------------------------
-- Verificación
-- ----------------------------------------------
SELECT 'gps_pings'         AS tabla, COUNT(*) FROM gps_pings
UNION ALL SELECT 'alertas', COUNT(*) FROM alertas
UNION ALL SELECT 'scoring_snapshots', COUNT(*) FROM scoring_snapshots
UNION ALL SELECT 'diesel_baselines',  COUNT(*) FROM diesel_baselines
UNION ALL SELECT 'audit_log',         COUNT(*) FROM audit_log;
