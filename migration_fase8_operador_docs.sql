-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 8
-- Documentos de operadores (Andreu Logistics)
-- =============================================
-- Mismo patrón que unidad_documentos: storage en Postgres (BYTEA),
-- vigencias con alertas, auditoría.
-- =============================================

CREATE TABLE IF NOT EXISTS operador_documentos (
  id                   BIGSERIAL PRIMARY KEY,
  operador_id          INTEGER NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
  tipo                 VARCHAR(40) NOT NULL CHECK (tipo IN (
                         'licencia_federal',
                         'examen_medico',
                         'ine',
                         'curp',
                         'rfc',
                         'comprobante_domicilio',
                         'antecedentes_no_penales',
                         'contrato_laboral',
                         'foto_perfil',
                         'capacitacion',
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

CREATE INDEX IF NOT EXISTS idx_op_docs_operador     ON operador_documentos (operador_id);
CREATE INDEX IF NOT EXISTS idx_op_docs_vigencia     ON operador_documentos (vigencia_fin) WHERE vigencia_fin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_op_docs_tipo         ON operador_documentos (operador_id, tipo);

-- Vista helper: documentos próximos a vencer o vencidos
CREATE OR REPLACE VIEW operador_documentos_alertas AS
SELECT
  d.id, d.operador_id, op.nombre AS operador,
  d.tipo, d.nombre, d.vigencia_fin, d.alertar_dias_antes,
  (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
  CASE
    WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido'
    WHEN d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval THEN 'por_vencer'
    ELSE 'vigente'
  END AS estado_vigencia
FROM operador_documentos d
JOIN operadores op ON op.id = d.operador_id
WHERE d.vigencia_fin IS NOT NULL;

INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
VALUES (
  NULL,
  'migracion_fase8',
  'sistema',
  NULL,
  jsonb_build_object(
    'fase', 'operador_documentos',
    'cambios', jsonb_build_array(
      'tabla operador_documentos creada',
      'vista operador_documentos_alertas creada',
      '11 tipos de documento predefinidos (licencia_federal, examen_medico, ine, etc.)'
    ),
    'fecha', NOW()
  ),
  'migration_script'
);

SELECT
  'operador_documentos' AS tabla,
  COUNT(*)::int AS filas,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'operador_documentos')::int AS columnas
FROM operador_documentos;
