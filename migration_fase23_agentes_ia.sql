-- =============================================
-- Andreu Logistics — Migración Fase 23
-- 7 Agentes IA: Director, Operaciones, CFO, Abogado, Contador, RRHH, Comercial
-- =============================================
-- Tabla agentes_invocaciones: log de cada conversación con un agente IA
-- (mismo schema que VIVO para mantener consistencia).
-- =============================================

CREATE TABLE IF NOT EXISTS agentes_invocaciones (
  id BIGSERIAL PRIMARY KEY,
  nombre_agente VARCHAR(40) NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  mensaje TEXT,
  respuesta TEXT,
  iteraciones INTEGER DEFAULT 1,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cache_read INTEGER DEFAULT 0,
  cache_creation INTEGER DEFAULT 0,
  costo_usd DECIMAL(10,6) DEFAULT 0,
  duracion_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agentes_inv_nombre ON agentes_invocaciones (nombre_agente, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agentes_inv_usuario ON agentes_invocaciones (usuario_id, created_at DESC);

INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase23', 'sistema',
  jsonb_build_object(
    'fase', 'agentes_ia_andreu',
    'cambios', jsonb_build_array(
      'tabla agentes_invocaciones (log de conversaciones con 7 agentes IA)',
      '7 agentes registrados: director, operaciones, cfo, abogado, contador, rrhh, comercial'
    )
  ),
  'migration_script'
);

SELECT '7 agentes IA listos en Andreu Logistics' AS resultado,
  (SELECT COUNT(*)::int FROM information_schema.tables
   WHERE table_schema='public' AND table_name='agentes_invocaciones') AS tabla_lista;
