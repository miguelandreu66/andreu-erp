-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 20 (ÚLTIMA del Autopilot)
-- Atracción Autónoma — marketing automatizado con IA
-- =============================================
-- Cron semanal lunes 10 AM:
--   1) Genera 1 post de LinkedIn profesional sobre transporte
--   2) Genera 1 blog post SEO con keywords
--   3) Mensualmente: boletín con tendencias + casos de éxito
-- Tracking de TODA visita al cotizador con UTMs.
-- Dashboard de ROI por canal.
-- =============================================

-- ── Extender leads con tracking UTM ──
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS utm_source        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS utm_medium        VARCHAR(80),
  ADD COLUMN IF NOT EXISTS utm_campaign      VARCHAR(120),
  ADD COLUMN IF NOT EXISTS utm_content       VARCHAR(120),
  ADD COLUMN IF NOT EXISTS utm_term          VARCHAR(120),
  ADD COLUMN IF NOT EXISTS referrer          TEXT,
  ADD COLUMN IF NOT EXISTS landing_path      VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_leads_utm_source ON leads (utm_source);
CREATE INDEX IF NOT EXISTS idx_leads_utm_camp   ON leads (utm_campaign);

-- ── Visitas anónimas al cotizador (antes de convertir en lead) ──
CREATE TABLE IF NOT EXISTS marketing_visitas (
  id              BIGSERIAL PRIMARY KEY,
  session_id      VARCHAR(60),                    -- cookie/local storage id
  ip              VARCHAR(50),
  user_agent      TEXT,
  pais            VARCHAR(60),
  ciudad          VARCHAR(120),

  -- UTM tracking
  utm_source      VARCHAR(80),
  utm_medium      VARCHAR(80),
  utm_campaign    VARCHAR(120),
  utm_content     VARCHAR(120),
  utm_term        VARCHAR(120),
  referrer        TEXT,
  landing_path    VARCHAR(200),

  -- Evento
  evento          VARCHAR(40) NOT NULL DEFAULT 'view'
                    CHECK (evento IN ('view','start_cotizar','submit_cotizar','rebote','click_cta')),

  -- Si convirtió
  convertido      BOOLEAN DEFAULT false,
  lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visitas_fecha   ON marketing_visitas (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitas_source  ON marketing_visitas (utm_source, utm_medium);
CREATE INDEX IF NOT EXISTS idx_visitas_session ON marketing_visitas (session_id);

-- ── Campañas activas ──
CREATE TABLE IF NOT EXISTS marketing_campanas (
  id              BIGSERIAL PRIMARY KEY,
  nombre          VARCHAR(150) NOT NULL,
  canal           VARCHAR(40) NOT NULL,            -- google_ads, meta_ads, linkedin, organico, referido, email
  utm_source      VARCHAR(80),
  utm_medium      VARCHAR(80),
  utm_campaign    VARCHAR(120),
  fecha_inicio    DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin       DATE,
  presupuesto_mxn DECIMAL(12,2) DEFAULT 0,
  gasto_real_mxn  DECIMAL(12,2) DEFAULT 0,
  meta_leads      INTEGER DEFAULT 0,
  meta_ingresos   DECIMAL(12,2) DEFAULT 0,
  activa          BOOLEAN DEFAULT true,
  notas           TEXT,
  creada_por      INTEGER REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_camp_activa ON marketing_campanas (activa, fecha_inicio DESC);

-- ── Contenido generado por IA ──
CREATE TABLE IF NOT EXISTS contenido_generado (
  id              BIGSERIAL PRIMARY KEY,
  tipo            VARCHAR(30) NOT NULL CHECK (tipo IN (
                     'linkedin_post',
                     'blog_post',
                     'caso_exito',
                     'boletin_email',
                     'tweet',
                     'instagram_caption'
                  )),
  titulo          VARCHAR(300),
  contenido       TEXT NOT NULL,
  resumen_corto   TEXT,                            -- meta description / TL;DR
  keywords        TEXT[],                          -- para SEO
  tema            VARCHAR(120),                    -- ej: "Carta Porte 3.0", "logística broker"
  call_to_action  TEXT,

  -- Generación
  modelo_usado    VARCHAR(60),
  prompt_usado    TEXT,
  tokens_input    INTEGER,
  tokens_output   INTEGER,
  costo_usd       DECIMAL(8,4),

  -- Workflow
  estado          VARCHAR(20) NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','aprobado','publicado','rechazado','archivado')),
  aprobado_por    INTEGER REFERENCES usuarios(id),
  aprobado_at     TIMESTAMPTZ,
  publicado_at    TIMESTAMPTZ,
  url_publicado   TEXT,                            -- URL del post publicado (LinkedIn, blog)
  motivo_rechazo  TEXT,

  -- Métricas (manual por ahora; futura integración con APIs)
  vistas          INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  leads_atribuidos INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cont_estado ON contenido_generado (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cont_tipo   ON contenido_generado (tipo);

-- ── Vista de funnel completo desde visita → lead → cliente ──
CREATE OR REPLACE VIEW marketing_funnel_canal AS
WITH visitas_canal AS (
  SELECT
    COALESCE(NULLIF(utm_source, ''), 'directo') AS canal,
    COUNT(*)::int AS visitas_30d,
    COUNT(*) FILTER (WHERE evento = 'submit_cotizar')::int AS submits_30d
  FROM marketing_visitas
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY 1
),
leads_canal AS (
  SELECT
    COALESCE(NULLIF(utm_source, ''), 'directo') AS canal,
    COUNT(*)::int AS leads_30d,
    COUNT(*) FILTER (WHERE estado = 'ganado')::int AS ganados_30d,
    COALESCE(SUM(precio_final) FILTER (WHERE estado = 'ganado'), 0)::float AS ingresos_30d
  FROM leads
  WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY 1
),
todos_canales AS (
  SELECT canal FROM visitas_canal UNION SELECT canal FROM leads_canal
)
SELECT
  tc.canal,
  COALESCE(v.visitas_30d, 0)   AS visitas_30d,
  COALESCE(v.submits_30d, 0)   AS submits_30d,
  COALESCE(l.leads_30d, 0)     AS leads_30d,
  COALESCE(l.ganados_30d, 0)   AS ganados_30d,
  COALESCE(l.ingresos_30d, 0)  AS ingresos_30d,
  CASE WHEN COALESCE(v.visitas_30d, 0) > 0
    THEN ROUND(100.0 * COALESCE(l.leads_30d, 0) / v.visitas_30d, 1)
    ELSE 0 END::float           AS pct_visita_a_lead,
  CASE WHEN COALESCE(l.leads_30d, 0) > 0
    THEN ROUND(100.0 * COALESCE(l.ganados_30d, 0) / l.leads_30d, 1)
    ELSE 0 END::float           AS pct_lead_a_ganado
FROM todos_canales tc
LEFT JOIN visitas_canal v ON v.canal = tc.canal
LEFT JOIN leads_canal   l ON l.canal = tc.canal
ORDER BY COALESCE(l.ingresos_30d, 0) DESC, COALESCE(v.visitas_30d, 0) DESC;

-- ── Configuración ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('atraccion_ia_activa', 'false',
   'Si el generador de contenido IA opera en modo automático'),
  ('atraccion_ia_modelo', 'claude-sonnet-4-6',
   'Modelo Claude para generación de contenido (Sonnet por balance calidad/costo)'),
  ('atraccion_ia_auto_publicar', 'false',
   'Si publica directo sin aprobación del director (NO recomendado)'),
  ('atraccion_ia_temas',
   'logística broker,Carta Porte 3.0,transporte B2B,plataforma 48 pies,refrigerados,cumplimiento SAT,reducción costos diesel,eficiencia ruta',
   'Temas sobre los que Claude puede escribir (CSV)'),
  ('atraccion_ia_tono_marca',
   'profesional pero cálido, mexicano, con datos concretos y casos reales',
   'Tono de voz que Claude usa al escribir'),
  ('atraccion_ia_freq_linkedin', 'semanal',
   'Frecuencia generación LinkedIn (semanal|quincenal|mensual)'),
  ('atraccion_ia_freq_blog', 'quincenal',
   'Frecuencia generación blog post'),
  ('atraccion_ia_freq_boletin', 'mensual',
   'Frecuencia generación boletín email')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase20', 'sistema',
  jsonb_build_object(
    'fase', 'atraccion_autonoma',
    'cambios', jsonb_build_array(
      'leads extendido con UTMs (source, medium, campaign, content, term, referrer)',
      'tabla marketing_visitas (tracking anonimo visitas al cotizador)',
      'tabla marketing_campanas (presupuesto, meta leads, meta ingresos)',
      'tabla contenido_generado (LinkedIn, blog, boletin, casos exito, etc.)',
      'vista marketing_funnel_canal con ROI por canal',
      '8 configs (activa, modelo, auto_publicar, temas, tono, frecuencias)'
    )
  ),
  'migration_script'
);

SELECT
  'marketing_visitas' AS tabla, COUNT(*)::int FROM marketing_visitas
UNION ALL SELECT 'marketing_campanas', COUNT(*)::int FROM marketing_campanas
UNION ALL SELECT 'contenido_generado', COUNT(*)::int FROM contenido_generado
UNION ALL SELECT 'config atraccion_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'atraccion_%';
