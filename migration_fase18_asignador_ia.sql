-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 18
-- Asignador Inteligente — IA asigna operador/unidad o transportista broker
-- =============================================
-- Cuando un lead se cierra o aparece un viaje sin asignar:
--   1) Analiza el viaje (tipo_carga, ruta, fecha, peso)
--   2) Decide propio vs broker según capacidades de Andreu
--   3) Si propio → encuentra mejor combo operador+unidad disponible
--   4) Si broker → match con transportista verificado óptimo
--   5) Persiste la decisión con razonamiento + ejecuta asignación
--   6) Notifica al operador/transportista por WhatsApp
-- =============================================

-- ── Historial de decisiones del asignador ──
CREATE TABLE IF NOT EXISTS asignaciones_ia (
  id                  BIGSERIAL PRIMARY KEY,
  viaje_id            INTEGER REFERENCES viajes(id) ON DELETE CASCADE,
  lead_id             INTEGER REFERENCES leads(id) ON DELETE SET NULL,

  -- Decisión
  tipo_operacion      VARCHAR(20) NOT NULL CHECK (tipo_operacion IN ('propio','broker')),
  decision_motivo     TEXT,                   -- razonamiento ejecutivo (lenguaje natural)
  confianza           VARCHAR(20) DEFAULT 'media' CHECK (confianza IN ('baja','media','alta')),

  -- Si propio
  operador_id         INTEGER REFERENCES operadores(id) ON DELETE SET NULL,
  unidad_id           INTEGER REFERENCES unidades(id) ON DELETE SET NULL,
  operador_score      DECIMAL(6,2),
  unidad_score        DECIMAL(6,2),

  -- Si broker
  transportista_externo_id INTEGER REFERENCES transportistas_externos(id) ON DELETE SET NULL,
  transportista_score DECIMAL(6,2),
  precio_broker_sugerido DECIMAL(12,2),
  comision_estimada   DECIMAL(12,2),

  -- Análisis completo (JSON con candidatos descartados, razones, etc.)
  candidatos          JSONB,                  -- top 5 candidatos considerados
  alertas             JSONB,                  -- problemas detectados (sin capacidad, doc venciendo, etc.)

  -- Workflow
  estado              VARCHAR(20) NOT NULL DEFAULT 'sugerida'
                        CHECK (estado IN ('sugerida','aprobada','rechazada','aplicada','expirada')),
  aprobada_por        INTEGER REFERENCES usuarios(id),
  aprobada_at         TIMESTAMPTZ,
  motivo_rechazo      TEXT,

  -- Notificaciones
  notificado_operador     BOOLEAN DEFAULT false,
  notificado_transportista BOOLEAN DEFAULT false,
  notificado_at           TIMESTAMPTZ,

  -- Auto
  fue_auto            BOOLEAN DEFAULT false,  -- ¿se aplicó automáticamente sin aprobación humana?
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asig_viaje    ON asignaciones_ia (viaje_id);
CREATE INDEX IF NOT EXISTS idx_asig_lead     ON asignaciones_ia (lead_id);
CREATE INDEX IF NOT EXISTS idx_asig_estado   ON asignaciones_ia (estado);
CREATE INDEX IF NOT EXISTS idx_asig_tipo     ON asignaciones_ia (tipo_operacion);

-- ── Vista de KPIs del asignador ──
CREATE OR REPLACE VIEW asignador_resumen AS
SELECT
  COUNT(*)::int                                                       AS total_30d,
  COUNT(*) FILTER (WHERE tipo_operacion = 'propio')::int              AS propios_30d,
  COUNT(*) FILTER (WHERE tipo_operacion = 'broker')::int              AS broker_30d,
  COUNT(*) FILTER (WHERE estado = 'aplicada')::int                    AS aplicadas_30d,
  COUNT(*) FILTER (WHERE fue_auto = true)::int                        AS auto_30d,
  COUNT(*) FILTER (WHERE estado = 'rechazada')::int                   AS rechazadas_30d,
  COALESCE(AVG(operador_score) FILTER (WHERE tipo_operacion = 'propio'), 0)::float AS score_promedio_operador,
  COALESCE(AVG(transportista_score) FILTER (WHERE tipo_operacion = 'broker'), 0)::float AS score_promedio_transportista,
  COALESCE(SUM(comision_estimada) FILTER (WHERE estado = 'aplicada'), 0)::float AS comisiones_acumuladas
FROM asignaciones_ia
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days';

-- ── Configuración ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('asignador_activo',           'true',
   'Si el asignador IA opera. Si false, solo sugiere sin aplicar'),
  ('asignador_auto_aprobar',     'false',
   'Si aplica asignación SIN aprobación del director cuando confianza es alta'),
  ('asignador_umbral_confianza_auto', 'alta',
   'Confianza mínima para auto-aprobar (baja|media|alta)'),
  ('asignador_modelo_explicacion',    'claude-haiku-4-5',
   'Modelo Claude para generar razonamiento ejecutivo (Haiku es barato y suficiente)'),
  ('asignador_usar_claude_explicacion', 'true',
   'Si usa Claude para explicar decisiones en lenguaje natural'),
  ('asignador_notificar_operador',     'true',
   'Si manda WhatsApp al operador asignado con detalles del viaje'),
  ('asignador_notificar_transportista', 'true',
   'Si manda WhatsApp al transportista broker asignado'),
  -- Pesos del scoring (suma debe dar 100)
  ('asignador_peso_calificacion',  '30',  'Peso del scoring de calificación (0-100)'),
  ('asignador_peso_disponibilidad','40',  'Peso de disponibilidad (no estar ocupado)'),
  ('asignador_peso_rotacion',      '15',  'Peso de rotación equitativa (no siempre el mismo)'),
  ('asignador_peso_capacidad',     '15',  'Peso de capacidad técnica (tipos de carga match)')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase18', 'sistema',
  jsonb_build_object(
    'fase', 'asignador_ia',
    'cambios', jsonb_build_array(
      'tabla asignaciones_ia con workflow sugerida/aprobada/aplicada',
      'vista asignador_resumen con KPIs',
      '11 configs (activo, auto_aprobar, umbral, modelo, notificaciones, pesos)'
    )
  ),
  'migration_script'
);

SELECT
  'asignaciones_ia' AS tabla, COUNT(*)::int FROM asignaciones_ia
UNION ALL SELECT 'config asignador_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'asignador_%';
