-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 9
-- Rol "operador" con acceso restringido al modo móvil
-- =============================================
-- Agrega rol 'operador' a la enum de usuarios.rol
-- Vincula opcionalmente usuarios.operador_id → operadores.id
-- (un usuario operador apunta al perfil operativo en operadores)
-- =============================================

-- Buscar y eliminar el CHECK constraint actual de usuarios.rol
DO $$
DECLARE
  constraint_nombre TEXT;
BEGIN
  SELECT con.conname INTO constraint_nombre
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'usuarios'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%rol%';

  IF constraint_nombre IS NOT NULL THEN
    EXECUTE format('ALTER TABLE usuarios DROP CONSTRAINT %I', constraint_nombre);
    RAISE NOTICE 'Constraint % eliminada', constraint_nombre;
  END IF;
END $$;

-- Recrear con rol 'operador' incluido
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('director','admin','caja','logistica','monitoreo','operador'));

-- FK opcional: usuario operador → operador
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS operador_id INTEGER REFERENCES operadores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_operador
  ON usuarios(operador_id) WHERE operador_id IS NOT NULL;

-- Audit
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL,
  'migracion_fase9',
  'sistema',
  jsonb_build_object(
    'fase', 'rol_operador',
    'cambios', jsonb_build_array(
      'rol operador agregado a usuarios.rol CHECK',
      'columna usuarios.operador_id FK a operadores agregada',
      'permisos: operador solo accede a /movil y endpoints filtrados a sus datos'
    )
  ),
  'migration_script'
);

-- Verificación
SELECT
  'roles_disponibles' AS info,
  string_agg(unnest, ', ') AS valor
FROM unnest(ARRAY['director','admin','caja','logistica','monitoreo','operador']);
