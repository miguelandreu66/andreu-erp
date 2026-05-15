-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 13
-- Filtro de transportistas: documentos + verificación + score
-- =============================================
-- No entra cualquiera a la red broker. Antes de asignar un lead a un
-- transportista externo, Andreu debe verificarlo con docs vigentes.
-- =============================================

-- ── Extender transportistas_externos con estado de verificación ──
ALTER TABLE transportistas_externos
  ADD COLUMN IF NOT EXISTS estado_verificacion VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (estado_verificacion IN ('pendiente','en_revision','verificado','rechazado','suspendido')),
  ADD COLUMN IF NOT EXISTS verificado_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verificado_por        INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS motivo_rechazo        TEXT,
  ADD COLUMN IF NOT EXISTS fecha_proxima_revision DATE,
  ADD COLUMN IF NOT EXISTS total_viajes_completados INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_incidentes         INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_automatico         DECIMAL(5,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_transp_estado_verif ON transportistas_externos (estado_verificacion);

-- ── Documentos del transportista ──────────────────
CREATE TABLE IF NOT EXISTS transportista_documentos (
  id                   BIGSERIAL PRIMARY KEY,
  transportista_id     INTEGER NOT NULL REFERENCES transportistas_externos(id) ON DELETE CASCADE,
  tipo                 VARCHAR(40) NOT NULL CHECK (tipo IN (
                         'constancia_fiscal',       -- Constancia de situación fiscal SAT (CRÍTICO)
                         'permiso_sct',             -- Permiso de SCT/SICT para transporte (CRÍTICO)
                         'poliza_seguro',           -- Póliza de seguro de la carga (CRÍTICO)
                         'poliza_seguro_unidad',    -- Seguro de las unidades
                         'acta_constitutiva',       -- Acta constitutiva (si persona moral)
                         'ine_representante',       -- INE del representante legal o contacto
                         'comprobante_domicilio',   -- Comprobante de domicilio fiscal
                         'opinion_cumplimiento',    -- Opinión de cumplimiento del SAT 32-D
                         'referencias_comerciales', -- Referencias de otros clientes
                         'contrato_servicios',      -- Contrato firmado con Andreu
                         'otro'
                       )),
  nombre               VARCHAR(150) NOT NULL,
  archivo_bytes        BYTEA,
  archivo_url          TEXT,
  mime_type            VARCHAR(80),
  tamano_bytes         BIGINT,
  vigencia_inicio      DATE,
  vigencia_fin         DATE,
  alertar_dias_antes   INTEGER DEFAULT 30,
  notas                TEXT,
  subido_por           INTEGER REFERENCES usuarios(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transp_docs_transp    ON transportista_documentos (transportista_id);
CREATE INDEX IF NOT EXISTS idx_transp_docs_vigencia  ON transportista_documentos (vigencia_fin) WHERE vigencia_fin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transp_docs_tipo      ON transportista_documentos (transportista_id, tipo);

-- ── Vista de alertas de vigencia (mismo patrón que operador/unidad) ──
CREATE OR REPLACE VIEW transportista_documentos_alertas AS
SELECT
  d.id, d.transportista_id, t.razon_social AS transportista,
  d.tipo, d.nombre, d.vigencia_fin, d.alertar_dias_antes,
  (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
  CASE
    WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido'
    WHEN d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval THEN 'por_vencer'
    ELSE 'vigente'
  END AS estado_vigencia
FROM transportista_documentos d
JOIN transportistas_externos t ON t.id = d.transportista_id
WHERE d.vigencia_fin IS NOT NULL;

-- ── Vista checklist: qué tiene cada transportista vs lo requerido ──
-- Documentos CRÍTICOS para verificación: constancia_fiscal, permiso_sct, poliza_seguro
CREATE OR REPLACE VIEW transportistas_checklist AS
WITH docs_resumen AS (
  SELECT
    t.id AS transportista_id,
    t.razon_social,
    t.estado_verificacion,

    -- Constancia fiscal
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id AND d.tipo = 'constancia_fiscal'
    ) AS tiene_constancia_fiscal,

    -- Permiso SCT vigente
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id AND d.tipo = 'permiso_sct'
        AND (d.vigencia_fin IS NULL OR d.vigencia_fin >= CURRENT_DATE)
    ) AS permiso_sct_vigente,

    -- Póliza seguro vigente
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id AND d.tipo = 'poliza_seguro'
        AND (d.vigencia_fin IS NULL OR d.vigencia_fin >= CURRENT_DATE)
    ) AS poliza_seguro_vigente,

    -- INE del representante
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id AND d.tipo = 'ine_representante'
    ) AS tiene_ine_representante,

    -- Contrato firmado
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id AND d.tipo = 'contrato_servicios'
    ) AS tiene_contrato,

    -- Documentos vencidos críticos
    EXISTS (
      SELECT 1 FROM transportista_documentos d
      WHERE d.transportista_id = t.id
        AND d.tipo IN ('permiso_sct','poliza_seguro')
        AND d.vigencia_fin IS NOT NULL
        AND d.vigencia_fin < CURRENT_DATE
    ) AS tiene_docs_vencidos_criticos
  FROM transportistas_externos t
)
SELECT
  *,
  -- Cumple para verificación si tiene los 3 críticos + INE + contrato
  (tiene_constancia_fiscal AND permiso_sct_vigente AND poliza_seguro_vigente
   AND tiene_ine_representante AND tiene_contrato
   AND NOT tiene_docs_vencidos_criticos) AS cumple_para_verificacion
FROM docs_resumen;

-- ── Función de score automático ──
-- Score = (calificacion manual * 10) + (viajes_completados * 2) - (incidentes * 15)
-- Cap en 100 puntos, mínimo 0
CREATE OR REPLACE FUNCTION recalcular_score_transportista(p_transportista_id INTEGER)
RETURNS DECIMAL AS $$
DECLARE
  v_score DECIMAL(5,2);
BEGIN
  UPDATE transportistas_externos
  SET score_automatico = LEAST(100, GREATEST(0,
        (calificacion * 10) +
        (total_viajes_completados * 2) -
        (total_incidentes * 15)
      )),
      updated_at = NOW()
  WHERE id = p_transportista_id
  RETURNING score_automatico INTO v_score;
  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase13', 'sistema',
  jsonb_build_object(
    'fase', 'filtro_transportistas',
    'cambios', jsonb_build_array(
      'transportistas_externos extendido con estado_verificacion + score automatico',
      'tabla transportista_documentos creada (mismo patron que operador_documentos)',
      'vista transportista_documentos_alertas para vigencias',
      'vista transportistas_checklist con cumple_para_verificacion',
      'funcion recalcular_score_transportista',
      'docs criticos requeridos: constancia_fiscal, permiso_sct, poliza_seguro, ine_representante, contrato_servicios'
    )
  ),
  'migration_script'
);

SELECT
  'transportistas_externos' AS tabla, COUNT(*)::int FROM transportistas_externos
UNION ALL SELECT 'transportista_documentos', COUNT(*)::int FROM transportista_documentos
UNION ALL SELECT 'transportistas con cumple_para_verificacion=true',
  COUNT(*)::int FROM transportistas_checklist WHERE cumple_para_verificacion = true;
