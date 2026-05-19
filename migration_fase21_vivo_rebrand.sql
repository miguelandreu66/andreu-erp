-- =============================================
-- VIVO — Migración Fase 21
-- Rebrand "Andreu Logistics" → "VIVO" + tiers de urgencia
-- =============================================
-- Cambios clave:
--   1. Rebrand de configuración empresa
--   2. Sistema de TIERS (Critical/Express/Urgent)
--   3. Multiplicadores automáticos
--   4. Servicios anexos (seguro, custodia, tracking VIP)
--   5. SLA tracking por viaje
-- =============================================

-- ── REBRAND: actualizar configuración fiscal/comercial ──
UPDATE configuracion_empresa SET valor = 'VIVO'
  WHERE clave = 'fiscal_nombre_comercial';

INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('vivo_eslogan',          'Tu carga, VIVO.',
   'Eslogan oficial de VIVO'),
  ('vivo_color_primario',   '#FF6B35',
   'Naranja eléctrico VIVO (urgencia)'),
  ('vivo_color_secundario', '#0A0A0A',
   'Negro profundo VIVO'),
  ('vivo_color_acento',     '#FFB627',
   'Amarillo dorado VIVO (premium)'),
  ('vivo_tagline_corto',    'BROKERAGE DE URGENCIAS LOGÍSTICAS',
   'Tagline secundario para landings'),
  ('vivo_promesa',          'Cotización en 5 minutos. Asignación en 15. Garantizado.',
   'Promesa al cliente'),
  ('vivo_url_publica',      'vivocargo.com',
   'URL pública oficial de VIVO'),
  ('vivo_whatsapp_publico', '',
   'WhatsApp Business público (configurar al momento)'),
  ('vivo_modo_operacion',   'urgencia',
   'Modo de operación: urgencia | normal | broker_general')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── TIERS DE SERVICIO ──
CREATE TABLE IF NOT EXISTS vivo_tiers_servicio (
  id                  SERIAL PRIMARY KEY,
  codigo              VARCHAR(20) NOT NULL UNIQUE,
  nombre              VARCHAR(60) NOT NULL,
  emoji               VARCHAR(8),
  descripcion         TEXT,
  multiplicador       DECIMAL(4,2) NOT NULL,
  sla_recoger_horas   DECIMAL(4,2),
  sla_entregar_horas  DECIMAL(5,2),
  garantia_descripcion TEXT,
  garantia_reembolso_pct DECIMAL(5,2),
  color_hex           VARCHAR(10),
  activo              BOOLEAN DEFAULT true,
  orden               INTEGER DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO vivo_tiers_servicio
  (codigo, nombre, emoji, descripcion, multiplicador, sla_recoger_horas, sla_entregar_horas, garantia_descripcion, garantia_reembolso_pct, color_hex, orden)
VALUES
  ('CRITICAL', 'Critical', '🚨',
   'Máxima urgencia. Recogemos en 1h, entregamos en 4-6h.',
   3.00, 1.00, 6.00,
   'Si no cumplimos la hora, te reembolsamos 100%.', 100.00,
   '#DC2626', 1),
  ('EXPRESS', 'Express', '⚡',
   'Mismo día garantizado. Recogemos en 2h.',
   2.00, 2.00, 12.00,
   'Si no cumplimos el día, te reembolsamos 50%.', 50.00,
   '#F59E0B', 2),
  ('URGENT', 'Urgent', '🔥',
   'Next day antes de 8am. Recogemos en 4h.',
   1.50, 4.00, 24.00,
   'Si no llegamos al día siguiente, descuento del 20% en próximo viaje.', 20.00,
   '#3B82F6', 3),
  ('NORMAL', 'Normal', '🚚',
   'Servicio regular sin urgencia (no es el core de VIVO).',
   1.00, 24.00, 72.00,
   'Sin garantía de tiempo. Para urgencias usa otros tiers.', 0.00,
   '#6B7280', 4)
ON CONFLICT (codigo) DO UPDATE SET
  multiplicador = EXCLUDED.multiplicador,
  sla_recoger_horas = EXCLUDED.sla_recoger_horas,
  sla_entregar_horas = EXCLUDED.sla_entregar_horas,
  garantia_descripcion = EXCLUDED.garantia_descripcion,
  garantia_reembolso_pct = EXCLUDED.garantia_reembolso_pct;

-- ── SERVICIOS ANEXOS (upsell) ──
CREATE TABLE IF NOT EXISTS vivo_servicios_anexos (
  id                  SERIAL PRIMARY KEY,
  codigo              VARCHAR(40) NOT NULL UNIQUE,
  nombre              VARCHAR(120) NOT NULL,
  emoji               VARCHAR(8),
  descripcion         TEXT,
  precio_min          DECIMAL(10,2),
  precio_max          DECIMAL(10,2),
  precio_default      DECIMAL(10,2),
  margen_pct          DECIMAL(5,2),
  recomendar_para_tier TEXT[], -- ['CRITICAL', 'EXPRESS']
  activo              BOOLEAN DEFAULT true,
  orden               INTEGER DEFAULT 1
);

INSERT INTO vivo_servicios_anexos
  (codigo, nombre, emoji, descripcion, precio_min, precio_max, precio_default, margen_pct, recomendar_para_tier, orden)
VALUES
  ('seguro_carga_premium', 'Seguro de carga premium $1M', '🛡️',
   'Cobertura adicional de $1,000,000 MXN para tu mercancía.',
   2500, 5000, 3500, 75.00,
   ARRAY['CRITICAL','EXPRESS','URGENT'], 1),
  ('custodia_armada', 'Custodia armada hasta destino', '👮',
   'Acompañamiento de seguridad privada armada durante toda la ruta.',
   5000, 15000, 8000, 30.00,
   ARRAY['CRITICAL'], 2),
  ('tracking_vip', 'Tracking VIP con cámara en vivo', '📹',
   'Cámara en cabina + GPS premium + dashboard de seguimiento exclusivo.',
   1500, 3000, 2000, 80.00,
   ARRAY['CRITICAL','EXPRESS'], 3),
  ('embalaje_reforzado', 'Embalaje industrial reforzado', '📦',
   'Embalaje especializado para mercancía frágil o de alto valor.',
   1500, 3000, 2000, 60.00,
   ARRAY['CRITICAL','EXPRESS','URGENT'], 4),
  ('reporte_ejecutivo', 'Reporte ejecutivo post-entrega', '📊',
   'Reporte completo con timeline, fotos, firmas y métricas para tu compliance.',
   1000, 2000, 1500, 90.00,
   ARRAY['CRITICAL','EXPRESS','URGENT'], 5),
  ('confirmacion_destinatario', 'Llamada de confirmación destinatario', '📞',
   'Llamada previa al destinatario para confirmar disponibilidad y datos.',
   500, 1000, 700, 85.00,
   ARRAY['CRITICAL','EXPRESS','URGENT'], 6)
ON CONFLICT (codigo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  precio_default = EXCLUDED.precio_default;

-- ── Extender leads con tier + anexos ──
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tier_urgencia       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS multiplicador_aplicado DECIMAL(4,2),
  ADD COLUMN IF NOT EXISTS sla_entrega_compromiso TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS servicios_anexos    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS precio_anexos       DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS garantia_aplicada   TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_tier ON leads (tier_urgencia);

-- ── Extender viajes con tier + SLA tracking ──
ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS tier_urgencia            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sla_recoger_compromiso   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_entregar_compromiso  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_recoger_real         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_entregar_real        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_cumplido             BOOLEAN,
  ADD COLUMN IF NOT EXISTS servicios_anexos_aplicados JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_viajes_tier ON viajes (tier_urgencia);
CREATE INDEX IF NOT EXISTS idx_viajes_sla ON viajes (sla_cumplido) WHERE sla_cumplido IS NOT NULL;

-- ── Vista de cumplimiento SLA por tier ──
CREATE OR REPLACE VIEW vivo_sla_cumplimiento AS
SELECT
  tier_urgencia,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE sla_cumplido = true)::int AS cumplidos,
  COUNT(*) FILTER (WHERE sla_cumplido = false)::int AS fallidos,
  CASE WHEN COUNT(*) FILTER (WHERE sla_cumplido IS NOT NULL) > 0
    THEN ROUND(100.0 * COUNT(*) FILTER (WHERE sla_cumplido = true) /
               NULLIF(COUNT(*) FILTER (WHERE sla_cumplido IS NOT NULL), 0), 1)
    ELSE 0 END::float AS pct_cumplimiento
FROM viajes
WHERE tier_urgencia IS NOT NULL
  AND fecha >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY tier_urgencia;

-- ── Audit log ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase21', 'sistema',
  jsonb_build_object(
    'fase', 'vivo_rebrand',
    'cambios', jsonb_build_array(
      'fiscal_nombre_comercial actualizado a VIVO',
      '9 configs nuevas: eslogan, colores, tagline, promesa, URL, etc.',
      'tabla vivo_tiers_servicio con 4 tiers (CRITICAL/EXPRESS/URGENT/NORMAL)',
      'tabla vivo_servicios_anexos con 6 upsells',
      'leads extendido con tier_urgencia + multiplicador + anexos',
      'viajes extendido con SLA tracking completo',
      'vista vivo_sla_cumplimiento por tier'
    )
  ),
  'migration_script'
);

SELECT
  'vivo_tiers_servicio' AS tabla, COUNT(*)::int FROM vivo_tiers_servicio
UNION ALL SELECT 'vivo_servicios_anexos', COUNT(*)::int FROM vivo_servicios_anexos
UNION ALL SELECT 'config vivo_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'vivo_%';
