-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 16
-- Vendedor IA 24/7 — Autopilot de leads
-- =============================================
-- Cuando un visitante cotiza en /cotizar:
--   1) Vendedor IA le manda cotización por WhatsApp + email en <30 segundos
--   2) Si responde, Claude conversa con él respondiendo dudas con contexto
--   3) Si no responde, drip campaign (día 1, 3, 7, 14)
--   4) Si negocia, Claude puede ofrecer descuentos hasta cierto %
--   5) Cuando acepta, link de pago + confirmación
-- =============================================

-- ── Conversaciones con leads (WhatsApp + Email) ──
CREATE TABLE IF NOT EXISTS lead_conversaciones (
  id              BIGSERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  canal           VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp','email','sms')),
  identificador   VARCHAR(100) NOT NULL,    -- número WhatsApp o email del lead
  estado          VARCHAR(20) NOT NULL DEFAULT 'activa'
                    CHECK (estado IN ('activa','pausada','cerrada_ganada','cerrada_perdida','intervenida_humano')),
  ultimo_mensaje_at TIMESTAMPTZ,
  total_mensajes  INTEGER DEFAULT 0,
  cliente_respondio BOOLEAN DEFAULT false,
  descuento_ofrecido_pct DECIMAL(5,2) DEFAULT 0,
  intervenido_por INTEGER REFERENCES usuarios(id),
  intervenido_at  TIMESTAMPTZ,
  notas_director  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_lead   ON lead_conversaciones (lead_id);
CREATE INDEX IF NOT EXISTS idx_conv_canal  ON lead_conversaciones (canal, identificador);
CREATE INDEX IF NOT EXISTS idx_conv_estado ON lead_conversaciones (estado);

-- ── Mensajes individuales ──
CREATE TABLE IF NOT EXISTS lead_mensajes (
  id              BIGSERIAL PRIMARY KEY,
  conversacion_id BIGINT NOT NULL REFERENCES lead_conversaciones(id) ON DELETE CASCADE,
  direccion       VARCHAR(10) NOT NULL CHECK (direccion IN ('saliente','entrante')),
  remitente       VARCHAR(20) NOT NULL CHECK (remitente IN ('ia','humano','cliente','sistema')),
  contenido       TEXT NOT NULL,
  contenido_tipo  VARCHAR(20) DEFAULT 'texto' CHECK (contenido_tipo IN ('texto','plantilla','imagen','pdf','interactivo')),
  metadata        JSONB,                    -- adjuntos, IDs externos, etc.
  id_externo      VARCHAR(100),             -- SID Twilio, message ID SendGrid
  estado_envio    VARCHAR(20) DEFAULT 'pendiente'
                    CHECK (estado_envio IN ('pendiente','enviado','entregado','leido','fallido','recibido')),
  error_mensaje   TEXT,
  enviado_por     INTEGER REFERENCES usuarios(id),   -- NULL si IA
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_msg_conv     ON lead_mensajes (conversacion_id);
CREATE INDEX IF NOT EXISTS idx_msg_estado   ON lead_mensajes (estado_envio);
CREATE INDEX IF NOT EXISTS idx_msg_externo  ON lead_mensajes (id_externo);

-- ── Drip campaigns programadas ──
CREATE TABLE IF NOT EXISTS lead_drip_envios (
  id              BIGSERIAL PRIMARY KEY,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  etapa           VARCHAR(40) NOT NULL,     -- 'cotizacion_inicial','seguimiento_2h','seguimiento_d1','seguimiento_d3','seguimiento_d7','seguimiento_d14','re_engagement'
  canal           VARCHAR(20) NOT NULL CHECK (canal IN ('whatsapp','email','sms')),
  fecha_programada TIMESTAMPTZ NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'programado'
                    CHECK (estado IN ('programado','enviado','fallido','cancelado','saltado')),
  mensaje_id      BIGINT REFERENCES lead_mensajes(id) ON DELETE SET NULL,
  motivo_cancelado TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_drip_estado ON lead_drip_envios (estado, fecha_programada);
CREATE INDEX IF NOT EXISTS idx_drip_lead   ON lead_drip_envios (lead_id);

-- ── Webhooks log (incoming Twilio/SendGrid) ──
CREATE TABLE IF NOT EXISTS canales_webhooks_log (
  id              BIGSERIAL PRIMARY KEY,
  proveedor       VARCHAR(30) NOT NULL,     -- 'twilio','sendgrid','meta_whatsapp'
  evento          VARCHAR(50),
  payload         JSONB,
  procesado       BOOLEAN DEFAULT false,
  error_mensaje   TEXT,
  ip_origen       INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_proveedor ON canales_webhooks_log (proveedor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wh_procesado ON canales_webhooks_log (procesado, created_at);

-- ── Funnel KPIs ──
CREATE OR REPLACE VIEW vendedor_ia_funnel AS
SELECT
  COUNT(DISTINCT l.id)::int                                                AS leads_total,
  COUNT(DISTINCT l.id) FILTER (WHERE c.id IS NOT NULL)::int                AS leads_contactados,
  COUNT(DISTINCT l.id) FILTER (WHERE c.cliente_respondio = true)::int      AS leads_respondieron,
  COUNT(DISTINCT l.id) FILTER (WHERE c.estado = 'cerrada_ganada')::int     AS leads_ganados_ia,
  COUNT(DISTINCT l.id) FILTER (WHERE l.estado = 'ganado')::int             AS leads_ganados_total,
  COUNT(DISTINCT l.id) FILTER (WHERE c.estado = 'intervenida_humano')::int AS leads_intervenidos,
  -- Métricas calculadas
  CASE WHEN COUNT(DISTINCT l.id) > 0
    THEN ROUND(100.0 * COUNT(DISTINCT l.id) FILTER (WHERE c.id IS NOT NULL) / COUNT(DISTINCT l.id), 1)
    ELSE 0 END::float                                                       AS pct_contactados,
  CASE WHEN COUNT(DISTINCT l.id) FILTER (WHERE c.id IS NOT NULL) > 0
    THEN ROUND(100.0 * COUNT(DISTINCT l.id) FILTER (WHERE c.cliente_respondio = true) / NULLIF(COUNT(DISTINCT l.id) FILTER (WHERE c.id IS NOT NULL), 0), 1)
    ELSE 0 END::float                                                       AS pct_respuesta,
  CASE WHEN COUNT(DISTINCT l.id) FILTER (WHERE c.cliente_respondio = true) > 0
    THEN ROUND(100.0 * COUNT(DISTINCT l.id) FILTER (WHERE c.estado = 'cerrada_ganada') / NULLIF(COUNT(DISTINCT l.id) FILTER (WHERE c.cliente_respondio = true), 0), 1)
    ELSE 0 END::float                                                       AS pct_cierre_ia
FROM leads l
LEFT JOIN lead_conversaciones c ON c.lead_id = l.id
WHERE l.created_at >= CURRENT_DATE - INTERVAL '30 days';

-- ── Configuración ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('vendedor_ia_activo', 'false',
   'Si el Vendedor IA contesta automáticamente cuando llega un lead nuevo'),
  ('vendedor_ia_horario_inicio', '08:00',
   'Hora desde la que el Vendedor IA envía mensajes (24h MX)'),
  ('vendedor_ia_horario_fin', '21:00',
   'Hora hasta la que el Vendedor IA envía mensajes'),
  ('vendedor_ia_descuento_max_pct', '7',
   'Descuento máximo (%) que la IA puede ofrecer sin consultar al director'),
  ('vendedor_ia_modelo', 'claude-sonnet-4-6',
   'Modelo Claude para conversaciones (Sonnet por costo, Opus si calidad crítica)'),
  ('vendedor_ia_canales_default', 'whatsapp,email',
   'Canales por default cuando un lead deja teléfono y email'),
  ('vendedor_ia_envio_inmediato', 'true',
   'Si envía cotización inmediatamente al cotizar (vs solo al confirmar)'),
  ('vendedor_ia_drip_d1', 'true',  'Activa seguimiento día 1'),
  ('vendedor_ia_drip_d3', 'true',  'Activa seguimiento día 3'),
  ('vendedor_ia_drip_d7', 'true',  'Activa seguimiento día 7 (con descuento)'),
  ('vendedor_ia_drip_d14', 'true', 'Activa seguimiento día 14 (re-engagement)')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase16', 'sistema',
  jsonb_build_object(
    'fase', 'vendedor_ia',
    'cambios', jsonb_build_array(
      'tabla lead_conversaciones (chat por canal con cada lead)',
      'tabla lead_mensajes (cada mensaje IA/cliente/humano)',
      'tabla lead_drip_envios (campañas de seguimiento programadas)',
      'tabla canales_webhooks_log (Twilio/SendGrid incoming)',
      'vista vendedor_ia_funnel (KPIs de conversión)',
      'configs: activo, horarios, descuento max, modelo, canales, drip days'
    )
  ),
  'migration_script'
);

SELECT
  'lead_conversaciones' AS tabla, COUNT(*)::int FROM lead_conversaciones
UNION ALL SELECT 'lead_mensajes', COUNT(*)::int FROM lead_mensajes
UNION ALL SELECT 'lead_drip_envios', COUNT(*)::int FROM lead_drip_envios
UNION ALL SELECT 'config vendedor_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'vendedor_%';
