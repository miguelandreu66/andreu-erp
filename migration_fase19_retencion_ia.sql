-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 19
-- Retención Autopilot — recupera clientes inactivos automáticamente
-- =============================================
-- Cron diario 6 AM clasifica TODOS los clientes en:
--   - nuevo:        primer viaje en últimos 30d
--   - en_crecimiento: +30% vs período anterior
--   - recurrente:   5+ viajes en 90d
--   - en_riesgo:    bajó >50% vs período anterior
--   - inactivo:     0 viajes en últimos 60d (pero tenía historial)
--   - perdido:      0 viajes en últimos 120d
--   - estable:      sin cambios significativos
-- Y ejecuta acción correspondiente: WhatsApp con descuento, contrato anual, NPS, etc.
-- Respeta cooldown: máximo 1 mensaje cada 14 días por cliente.
-- =============================================

-- ── Scoring de retención por cliente (snapshot histórico) ──
CREATE TABLE IF NOT EXISTS cliente_scoring_retencion (
  id                  BIGSERIAL PRIMARY KEY,
  cliente_id          INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fecha_snapshot      DATE NOT NULL DEFAULT CURRENT_DATE,
  clasificacion       VARCHAR(20) NOT NULL
                        CHECK (clasificacion IN ('nuevo','en_crecimiento','recurrente','estable','en_riesgo','inactivo','perdido')),

  -- Métricas calculadas
  viajes_30d          INTEGER DEFAULT 0,
  viajes_60d_prev     INTEGER DEFAULT 0,    -- viajes entre día 30-60
  viajes_90d          INTEGER DEFAULT 0,
  viajes_180d         INTEGER DEFAULT 0,
  ingresos_30d        DECIMAL(14,2) DEFAULT 0,
  ingresos_60d_prev   DECIMAL(14,2) DEFAULT 0,
  ingresos_total      DECIMAL(14,2) DEFAULT 0,

  -- Cambios
  cambio_viajes_pct   DECIMAL(6,2),         -- % cambio últimos 30d vs 30-60d
  cambio_ingresos_pct DECIMAL(6,2),
  dias_sin_actividad  INTEGER,

  -- LTV (lifetime value)
  ltv                 DECIMAL(14,2),
  promedio_ticket     DECIMAL(14,2),

  -- Score 0-100 (qué tan valioso es retener este cliente)
  score_retencion     DECIMAL(5,2),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_ret_cliente ON cliente_scoring_retencion (cliente_id, fecha_snapshot DESC);
CREATE INDEX IF NOT EXISTS idx_score_ret_clas    ON cliente_scoring_retencion (clasificacion, fecha_snapshot DESC);

-- ── Acciones ejecutadas / programadas ──
CREATE TABLE IF NOT EXISTS cliente_acciones_retencion (
  id              BIGSERIAL PRIMARY KEY,
  cliente_id      INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  scoring_id      BIGINT REFERENCES cliente_scoring_retencion(id) ON DELETE SET NULL,

  tipo_accion     VARCHAR(40) NOT NULL CHECK (tipo_accion IN (
                     'bienvenida_nuevo',
                     'agradecimiento_crecimiento',
                     'oferta_contrato_anual',
                     'preventivo_en_riesgo',
                     'reactivacion_inactivo',
                     'ultimo_intento_perdido',
                     'nps_survey',
                     'descuento_personalizado',
                     'manual'
                   )),
  clasificacion   VARCHAR(20),

  -- Mensaje
  canal           VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp','email','sms','telefonica_manual')),
  asunto          VARCHAR(200),
  mensaje         TEXT NOT NULL,
  descuento_ofrecido_pct DECIMAL(5,2) DEFAULT 0,

  -- Envío
  estado          VARCHAR(20) NOT NULL DEFAULT 'programada'
                    CHECK (estado IN ('programada','enviada','fallida','cancelada','respondida')),
  enviado_at      TIMESTAMPTZ,
  id_externo      VARCHAR(100),     -- SID Twilio o SendGrid message id

  -- Respuesta cliente (si la hay)
  cliente_respondio   BOOLEAN DEFAULT false,
  cliente_recupero    BOOLEAN DEFAULT false,  -- volvió a cotizar/viajar tras la acción
  fecha_recuperacion  DATE,

  -- Auditoría
  ejecutado_por_ia    BOOLEAN DEFAULT true,
  ejecutado_por       INTEGER REFERENCES usuarios(id),
  error_mensaje       TEXT,
  notas               TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_acc_ret_cliente ON cliente_acciones_retencion (cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_acc_ret_estado  ON cliente_acciones_retencion (estado);
CREATE INDEX IF NOT EXISTS idx_acc_ret_tipo    ON cliente_acciones_retencion (tipo_accion);

-- ── Vista de últimos scorings (1 por cliente, el más reciente) ──
CREATE OR REPLACE VIEW cliente_scoring_actual AS
SELECT DISTINCT ON (cliente_id) *
FROM cliente_scoring_retencion
ORDER BY cliente_id, fecha_snapshot DESC;

-- ── Vista de funnel de retención ──
CREATE OR REPLACE VIEW retencion_funnel AS
SELECT
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'nuevo')::int            AS nuevos,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'en_crecimiento')::int   AS en_crecimiento,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'recurrente')::int       AS recurrentes,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'estable')::int          AS estables,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'en_riesgo')::int        AS en_riesgo,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'inactivo')::int         AS inactivos,
  COUNT(DISTINCT cliente_id) FILTER (WHERE clasificacion = 'perdido')::int          AS perdidos,
  COUNT(DISTINCT cliente_id)::int                                                    AS total
FROM cliente_scoring_actual;

-- ── Configuración ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('retencion_activa', 'false',
   'Si la Retención IA ejecuta acciones automáticamente'),
  ('retencion_canal_default', 'whatsapp',
   'Canal preferente para acciones de retención (whatsapp|email)'),
  ('retencion_cooldown_dias', '14',
   'Días mínimos entre mensajes al mismo cliente'),
  ('retencion_horario_inicio', '09:00',
   'Hora desde la que envía mensajes de retención (MX)'),
  ('retencion_horario_fin', '20:00',
   'Hora hasta la que envía mensajes de retención (MX)'),
  ('retencion_descuento_max_pct', '15',
   'Descuento máximo (%) que puede ofrecer la retención sin aprobación'),
  ('retencion_usar_claude', 'true',
   'Si usa Claude Haiku para personalizar el mensaje según historial del cliente'),
  ('retencion_modelo_claude', 'claude-haiku-4-5',
   'Modelo Claude para personalización (Haiku más barato y rápido)'),
  -- Umbrales de clasificación
  ('retencion_dias_nuevo', '30',           'Días desde primer viaje para considerar "nuevo"'),
  ('retencion_dias_inactivo', '60',        'Días sin actividad para marcar "inactivo"'),
  ('retencion_dias_perdido', '120',        'Días sin actividad para marcar "perdido"'),
  ('retencion_umbral_crecimiento_pct', '30', '% mínimo de crecimiento para "en_crecimiento"'),
  ('retencion_umbral_riesgo_pct', '50',    '% mínimo de caída para "en_riesgo"'),
  ('retencion_viajes_recurrente', '5',     'Viajes mínimos en 90d para considerar "recurrente"')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase19', 'sistema',
  jsonb_build_object(
    'fase', 'retencion_ia',
    'cambios', jsonb_build_array(
      'tabla cliente_scoring_retencion (snapshot por cliente)',
      'tabla cliente_acciones_retencion (cada accion con tracking)',
      'vista cliente_scoring_actual (1 por cliente, latest)',
      'vista retencion_funnel (KPIs por clasificacion)',
      '14 configs (activa, canal, cooldown, horarios, descuento, umbrales)'
    )
  ),
  'migration_script'
);

SELECT
  'cliente_scoring_retencion' AS tabla, COUNT(*)::int FROM cliente_scoring_retencion
UNION ALL SELECT 'cliente_acciones_retencion', COUNT(*)::int FROM cliente_acciones_retencion
UNION ALL SELECT 'config retencion_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'retencion_%';
