-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 15
-- Auditor IA: análisis profundo semanal con Claude Opus 4.7
-- =============================================
-- Cada lunes 7 AM (y on-demand), Claude analiza TODOS los datos del negocio
-- y emite un reporte con:
--   - Errores detectados (cosas mal AHORA)
--   - Oportunidades de crecimiento (cosas para capturar)
-- Cada hallazgo tiene severidad, impacto $$, acción recomendada, status workflow.
-- Lo que el director marca como aplicado/descartado se usa como aprendizaje
-- para que la siguiente auditoría no repita lo mismo.
-- =============================================

-- ── Ejecuciones del auditor (cada corrida es un snapshot) ──
CREATE TABLE IF NOT EXISTS auditoria_ia_ejecuciones (
  id                BIGSERIAL PRIMARY KEY,
  tipo              VARCHAR(20) NOT NULL DEFAULT 'programada'
                      CHECK (tipo IN ('programada','manual','catchup')),
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente','en_curso','completada','fallida')),
  modelo            VARCHAR(60),
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  thinking_tokens   INTEGER DEFAULT 0,
  costo_usd         DECIMAL(8,4) DEFAULT 0,
  duracion_ms       INTEGER,
  resumen_ejecutivo TEXT,                     -- TL;DR generado por Claude
  contexto_snapshot JSONB,                    -- el JSON que se le mandó a Claude (para auditar y reproducir)
  raw_response      JSONB,                    -- response cruda de Claude (para debug)
  error_mensaje     TEXT,
  iniciada_por      INTEGER REFERENCES usuarios(id),
  iniciada_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completada_at     TIMESTAMPTZ,
  semana_iso        VARCHAR(10),              -- "2026-W21"
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_ej_fecha   ON auditoria_ia_ejecuciones (iniciada_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ej_estado  ON auditoria_ia_ejecuciones (estado);
CREATE INDEX IF NOT EXISTS idx_audit_ej_semana  ON auditoria_ia_ejecuciones (semana_iso);

-- ── Hallazgos (errores + oportunidades) ──
CREATE TABLE IF NOT EXISTS auditoria_ia_hallazgos (
  id                BIGSERIAL PRIMARY KEY,
  ejecucion_id      BIGINT NOT NULL REFERENCES auditoria_ia_ejecuciones(id) ON DELETE CASCADE,
  tipo              VARCHAR(20) NOT NULL CHECK (tipo IN ('error','oportunidad')),
  categoria         VARCHAR(40) NOT NULL,    -- ingresos, operadores, clientes, rutas, broker, cashflow, gastos, mantenimiento, otro
  severidad         VARCHAR(20) NOT NULL CHECK (severidad IN ('critico','alto','medio','bajo')),
  titulo            VARCHAR(200) NOT NULL,
  descripcion       TEXT NOT NULL,
  evidencia         JSONB,                   -- datos numéricos que sustentan el hallazgo
  accion_recomendada TEXT NOT NULL,
  impacto_mxn       DECIMAL(12,2),           -- estimación de impacto positivo o negativo en $MXN
  ventana_dias      INTEGER,                 -- en cuántos días caduca esta oportunidad/se agrava
  confianza         VARCHAR(20) DEFAULT 'media' CHECK (confianza IN ('baja','media','alta')),
  -- entidades referenciadas
  entidad_tipo      VARCHAR(40),             -- 'operador','cliente','unidad','transportista','ruta','viaje'
  entidad_ids       INTEGER[],
  -- workflow
  status            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                      CHECK (status IN ('pendiente','en_progreso','aplicada','descartada','expirada')),
  notas_director    TEXT,
  decidida_por      INTEGER REFERENCES usuarios(id),
  decidida_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_hal_ej        ON auditoria_ia_hallazgos (ejecucion_id);
CREATE INDEX IF NOT EXISTS idx_audit_hal_status    ON auditoria_ia_hallazgos (status);
CREATE INDEX IF NOT EXISTS idx_audit_hal_tipo      ON auditoria_ia_hallazgos (tipo);
CREATE INDEX IF NOT EXISTS idx_audit_hal_severidad ON auditoria_ia_hallazgos (severidad);
CREATE INDEX IF NOT EXISTS idx_audit_hal_categoria ON auditoria_ia_hallazgos (categoria);

-- ── Vista resumen de ejecuciones ──
CREATE OR REPLACE VIEW auditoria_ia_resumen AS
SELECT
  e.id, e.tipo, e.estado, e.iniciada_at, e.completada_at, e.duracion_ms,
  e.semana_iso, e.modelo, e.costo_usd, e.resumen_ejecutivo,
  COALESCE(h.total, 0)::int        AS total_hallazgos,
  COALESCE(h.errores, 0)::int      AS errores,
  COALESCE(h.oportunidades, 0)::int AS oportunidades,
  COALESCE(h.criticos, 0)::int     AS criticos,
  COALESCE(h.aplicados, 0)::int    AS aplicados,
  COALESCE(h.descartados, 0)::int  AS descartados,
  COALESCE(h.pendientes, 0)::int   AS pendientes,
  COALESCE(h.impacto_total, 0)::float AS impacto_total_mxn
FROM auditoria_ia_ejecuciones e
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE tipo = 'error')         AS errores,
    COUNT(*) FILTER (WHERE tipo = 'oportunidad')   AS oportunidades,
    COUNT(*) FILTER (WHERE severidad = 'critico')  AS criticos,
    COUNT(*) FILTER (WHERE status = 'aplicada')    AS aplicados,
    COUNT(*) FILTER (WHERE status = 'descartada')  AS descartados,
    COUNT(*) FILTER (WHERE status = 'pendiente')   AS pendientes,
    SUM(ABS(COALESCE(impacto_mxn, 0))) AS impacto_total
  FROM auditoria_ia_hallazgos
  WHERE ejecucion_id = e.id
) h ON true;

-- ── Vista de aprendizaje: hallazgos pasados con su decisión ──
-- Se le pasa a Claude en la siguiente auditoría para que no repita los descartados
-- y para que sepa qué tipo de hallazgos te están sirviendo.
CREATE OR REPLACE VIEW auditoria_ia_aprendizaje AS
SELECT
  h.tipo, h.categoria, h.severidad,
  h.titulo, h.status, h.notas_director,
  h.created_at, h.decidida_at
FROM auditoria_ia_hallazgos h
JOIN auditoria_ia_ejecuciones e ON e.id = h.ejecucion_id
WHERE h.status IN ('aplicada','descartada')
  AND e.iniciada_at >= NOW() - INTERVAL '60 days'
ORDER BY h.decidida_at DESC;

-- ── Configuración ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('auditor_ia_modelo', 'claude-opus-4-7',
   'Modelo de Claude usado por el auditor IA semanal'),
  ('auditor_ia_max_costo_usd', '5.00',
   'Tope de costo por ejecución en USD (corta el análisis si se acerca al límite)'),
  ('auditor_ia_schedule_cron', '0 7 * * 1',
   'Cron schedule del auditor IA semanal (default: lunes 7 AM)'),
  ('auditor_ia_activo', 'true',
   'Si el cron semanal del auditor IA está activo')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase15', 'sistema',
  jsonb_build_object(
    'fase', 'auditor_ia',
    'cambios', jsonb_build_array(
      'tabla auditoria_ia_ejecuciones (cada corrida del auditor)',
      'tabla auditoria_ia_hallazgos (errores + oportunidades con workflow)',
      'vista auditoria_ia_resumen (KPIs por ejecucion)',
      'vista auditoria_ia_aprendizaje (decisiones pasadas como contexto)',
      'configs: modelo, max_costo, schedule, activo'
    )
  ),
  'migration_script'
);

SELECT
  'auditoria_ia_ejecuciones' AS tabla, COUNT(*)::int FROM auditoria_ia_ejecuciones
UNION ALL SELECT 'auditoria_ia_hallazgos', COUNT(*)::int FROM auditoria_ia_hallazgos
UNION ALL SELECT 'config auditor_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'auditor_%';
