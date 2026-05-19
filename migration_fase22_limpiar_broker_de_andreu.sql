-- =============================================
-- Andreu Logistics — Migración Fase 22
-- LIMPIEZA: quitar todo lo de broker (se separó al sistema VIVO)
-- =============================================
-- Andreu Logistics ahora es 100% operación propia (3 plataformas 48').
-- Todo lo de broker (transportistas externos, cashflow, vendedor IA,
-- asignador IA, retención IA, atracción IA, tiers VIVO, etc.) se movió
-- al sistema independiente VIVO con su propia DB.
-- =============================================

-- ── Borrar tablas exclusivas de broker ──
DROP TABLE IF EXISTS asignaciones_ia CASCADE;
DROP TABLE IF EXISTS cliente_acciones_retencion CASCADE;
DROP TABLE IF EXISTS cliente_scoring_retencion CASCADE;
DROP TABLE IF EXISTS contenido_generado CASCADE;
DROP TABLE IF EXISTS marketing_visitas CASCADE;
DROP TABLE IF EXISTS marketing_campanas CASCADE;
DROP TABLE IF EXISTS marketing_canales CASCADE;
DROP TABLE IF EXISTS lead_drip_envios CASCADE;
DROP TABLE IF EXISTS lead_mensajes CASCADE;
DROP TABLE IF EXISTS lead_conversaciones CASCADE;
DROP TABLE IF EXISTS canales_webhooks_log CASCADE;
DROP TABLE IF EXISTS broker_pagos_transportista CASCADE;
DROP TABLE IF EXISTS transportista_documentos CASCADE;
DROP TABLE IF EXISTS transportistas_externos CASCADE;
DROP TABLE IF EXISTS vivo_servicios_anexos CASCADE;
DROP TABLE IF EXISTS vivo_tiers_servicio CASCADE;
DROP TABLE IF EXISTS leads CASCADE;

-- ── Borrar vistas relacionadas ──
DROP VIEW IF EXISTS vendedor_ia_funnel CASCADE;
DROP VIEW IF EXISTS broker_cashflow_operaciones CASCADE;
DROP VIEW IF EXISTS broker_cashflow_exposicion CASCADE;
DROP VIEW IF EXISTS broker_concentracion_clientes CASCADE;
DROP VIEW IF EXISTS broker_concentracion_transportistas CASCADE;
DROP VIEW IF EXISTS broker_pagos_alertas CASCADE;
DROP VIEW IF EXISTS transportistas_checklist CASCADE;
DROP VIEW IF EXISTS transportista_documentos_alertas CASCADE;
DROP VIEW IF EXISTS retencion_funnel CASCADE;
DROP VIEW IF EXISTS cliente_scoring_actual CASCADE;
DROP VIEW IF EXISTS asignador_resumen CASCADE;
DROP VIEW IF EXISTS atraccion_resumen CASCADE;
DROP VIEW IF EXISTS atraccion_kpis_canal CASCADE;
DROP VIEW IF EXISTS vivo_sla_cumplimiento CASCADE;

-- ── Borrar funciones broker ──
DROP FUNCTION IF EXISTS broker_marcar_vencidos() CASCADE;
DROP FUNCTION IF EXISTS recalcular_score_transportista(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS generar_folio_lead() CASCADE;

-- ── Quitar columnas de broker de viajes (mantenemos lo de operación propia) ──
ALTER TABLE viajes
  DROP COLUMN IF EXISTS tipo_operacion CASCADE,
  DROP COLUMN IF EXISTS transportista_externo_id CASCADE,
  DROP COLUMN IF EXISTS monto_pagado_transportista CASCADE,
  DROP COLUMN IF EXISTS comision_andreu CASCADE,
  DROP COLUMN IF EXISTS tier_urgencia CASCADE,
  DROP COLUMN IF EXISTS sla_recoger_compromiso CASCADE,
  DROP COLUMN IF EXISTS sla_entregar_compromiso CASCADE,
  DROP COLUMN IF EXISTS sla_recoger_real CASCADE,
  DROP COLUMN IF EXISTS sla_entregar_real CASCADE,
  DROP COLUMN IF EXISTS sla_cumplido CASCADE,
  DROP COLUMN IF EXISTS servicios_anexos_aplicados CASCADE;

-- ── Borrar configs de broker ──
DELETE FROM configuracion_empresa
WHERE clave LIKE 'vendedor_ia_%'
   OR clave LIKE 'asignador_%'
   OR clave LIKE 'retencion_%'
   OR clave LIKE 'atraccion_%'
   OR clave LIKE 'broker_%'
   OR clave LIKE 'vivo_%'
   OR clave LIKE 'twilio_%'
   OR clave LIKE 'cartaporte_andreu_capacidades%'
   OR clave IN (
     'andreu_capacidades_carga',
     'andreu_capacidades_zonas'
   );

-- ── Audit log ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase22', 'sistema',
  jsonb_build_object(
    'fase', 'limpiar_broker_de_andreu',
    'razon', 'Separación arquitectónica — el módulo broker se movió al sistema VIVO independiente',
    'borrado', jsonb_build_array(
      'tabla transportistas_externos + transportista_documentos',
      'tabla leads + lead_conversaciones + lead_mensajes + lead_drip_envios',
      'tabla broker_pagos_transportista',
      'tabla asignaciones_ia',
      'tabla cliente_acciones_retencion + cliente_scoring_retencion',
      'tabla contenido_generado + marketing_*',
      'tabla canales_webhooks_log',
      'tabla vivo_tiers_servicio + vivo_servicios_anexos',
      'columnas broker en viajes (tipo_operacion, transportista_externo_id, etc.)',
      'configs vendedor_/asignador_/retencion_/atraccion_/broker_/vivo_/twilio_'
    )
  ),
  'migration_script'
);

-- Confirmación final
SELECT
  'Limpieza completada' AS resultado,
  (SELECT COUNT(*)::int FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('transportistas_externos','leads','broker_pagos_transportista','asignaciones_ia')) AS tablas_broker_restantes,
  (SELECT COUNT(*)::int FROM configuracion_empresa
   WHERE clave LIKE 'vendedor_ia_%' OR clave LIKE 'broker_%' OR clave LIKE 'vivo_%') AS configs_broker_restantes;
