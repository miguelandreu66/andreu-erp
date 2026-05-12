-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 7B
-- Documentos: storage nativo en Postgres (BYTEA)
-- =============================================
-- Elimina dependencia de Cloudinary. Los archivos viven en la BD,
-- se sirven con auth desde el backend. Más simple, sin servicios externos.
-- =============================================

-- Agregar columna BYTEA para guardar el archivo binario
ALTER TABLE unidad_documentos
  ADD COLUMN IF NOT EXISTS archivo_bytes BYTEA;

-- archivo_url ya no es obligatorio (los archivos viven en BD ahora)
ALTER TABLE unidad_documentos
  ALTER COLUMN archivo_url DROP NOT NULL;

-- Marcado en audit_log
INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
VALUES (
  NULL,
  'migracion_fase7b',
  'sistema',
  NULL,
  jsonb_build_object(
    'fase', 'docs_storage_native',
    'cambios', jsonb_build_array(
      'columna archivo_bytes BYTEA agregada',
      'archivo_url ahora nullable (storage local)',
      'eliminada dependencia de Cloudinary'
    ),
    'fecha', NOW()
  ),
  'migration_script'
);

-- Verificación
SELECT
  column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'unidad_documentos'
ORDER BY ordinal_position;
