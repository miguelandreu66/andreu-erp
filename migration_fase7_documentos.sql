-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 7
-- Gestión documental de unidades (Andreu Logistics)
-- =============================================
-- Tipos predefinidos según necesidad del transporte federal en México.
-- Cada documento tiene vigencia opcional y alertas configurables.
-- Almacenamiento real en Cloudinary; aquí guardamos metadata + URL pública.
-- =============================================

CREATE TABLE IF NOT EXISTS unidad_documentos (
  id                   BIGSERIAL PRIMARY KEY,
  unidad_id            INTEGER NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  tipo                 VARCHAR(40) NOT NULL CHECK (tipo IN (
                         'tarjeta_circulacion',
                         'poliza_seguro',
                         'permiso_sct',
                         'verificacion_vehicular',
                         'comprobante_propiedad',
                         'tarjeta_caja_remolque',
                         'foto_unidad',
                         'factura_unidad',
                         'tenencia',
                         'otro'
                       )),
  nombre               VARCHAR(150) NOT NULL,
  archivo_url          TEXT NOT NULL,
  archivo_public_id    TEXT,                  -- Cloudinary public_id, para poder borrar
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

CREATE INDEX IF NOT EXISTS idx_unidad_docs_unidad ON unidad_documentos (unidad_id);
CREATE INDEX IF NOT EXISTS idx_unidad_docs_vigencia ON unidad_documentos (vigencia_fin)
  WHERE vigencia_fin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_unidad_docs_tipo ON unidad_documentos (unidad_id, tipo);

-- Vista helper: documentos próximos a vencer o vencidos
CREATE OR REPLACE VIEW documentos_alertas_vigencia AS
SELECT
  d.id, d.unidad_id, u.placas, u.descripcion AS unidad_descripcion,
  d.tipo, d.nombre, d.vigencia_fin, d.alertar_dias_antes,
  (d.vigencia_fin - CURRENT_DATE)::int AS dias_restantes,
  CASE
    WHEN d.vigencia_fin < CURRENT_DATE THEN 'vencido'
    WHEN d.vigencia_fin <= CURRENT_DATE + (d.alertar_dias_antes || ' days')::interval THEN 'por_vencer'
    ELSE 'vigente'
  END AS estado_vigencia
FROM unidad_documentos d
JOIN unidades u ON u.id = d.unidad_id
WHERE d.vigencia_fin IS NOT NULL;

-- Marcado de migración en audit_log
INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
VALUES (
  NULL,
  'migracion_fase7',
  'sistema',
  NULL,
  jsonb_build_object(
    'fase', 'documentos_unidades',
    'cambios', jsonb_build_array(
      'tabla unidad_documentos creada',
      'vista documentos_alertas_vigencia creada',
      '10 tipos de documento predefinidos',
      'integracion con Cloudinary para storage'
    ),
    'fecha', NOW()
  ),
  'migration_script'
);

-- Verificación
SELECT
  'unidad_documentos' AS tabla,
  COUNT(*)::int AS filas,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'unidad_documentos')::int AS columnas
FROM unidad_documentos;
