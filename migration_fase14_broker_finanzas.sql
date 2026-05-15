-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 14
-- Cashflow Watchdog + Alertas de Concentración (Broker)
-- =============================================
-- Dos riesgos críticos del broker:
--   1) Pagas al transportista antes de que el cliente te pague → quiebra
--   2) Un cliente o transportista se vuelve >X% del volumen → vulnerable
-- Este modulo da visibilidad y alertas automáticas.
-- =============================================

-- ── Extender leads para tracking de cobros del cliente broker ──
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS monto_cobrado_cliente   DECIMAL(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fecha_primer_cobro      DATE,
  ADD COLUMN IF NOT EXISTS fecha_ultimo_cobro      DATE;

CREATE INDEX IF NOT EXISTS idx_leads_broker_cobros ON leads (transportista_externo_id, monto_cobrado_cliente)
  WHERE tipo_operacion = 'broker';

-- ── Config: umbrales de alerta ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('broker_politica_pago', 'esperar_cobro_cliente',
   'Política de pago a transportistas: esperar_cobro_cliente | adelantar_con_factura | adelantar_libre'),
  ('broker_alerta_concentracion_cliente_pct', '25',
   '% sobre volumen del trimestre que dispara alerta de cliente concentrado'),
  ('broker_alerta_concentracion_transportista_pct', '30',
   '% sobre volumen del trimestre que dispara alerta de transportista concentrado'),
  ('broker_dias_credito_transportista_default', '15',
   'Días de crédito que Andreu pide al transportista por default (paga a N días)')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Pagos programados a transportistas externos ──
CREATE TABLE IF NOT EXISTS broker_pagos_transportista (
  id                      BIGSERIAL PRIMARY KEY,
  transportista_externo_id INTEGER NOT NULL REFERENCES transportistas_externos(id) ON DELETE RESTRICT,
  lead_id                 INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  viaje_id                INTEGER REFERENCES viajes(id) ON DELETE SET NULL,
  concepto                VARCHAR(200) NOT NULL,
  monto                   DECIMAL(12,2) NOT NULL CHECK (monto > 0),
  fecha_programada        DATE NOT NULL,
  fecha_pagada            DATE,
  estado                  VARCHAR(20) NOT NULL DEFAULT 'programado'
                            CHECK (estado IN ('programado','pagado','vencido','cancelado')),
  metodo                  VARCHAR(30),         -- transferencia, cheque, efectivo
  referencia              VARCHAR(80),         -- folio transferencia
  notas                   TEXT,
  creado_por              INTEGER REFERENCES usuarios(id),
  pagado_por              INTEGER REFERENCES usuarios(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brk_pagos_transp     ON broker_pagos_transportista (transportista_externo_id);
CREATE INDEX IF NOT EXISTS idx_brk_pagos_estado     ON broker_pagos_transportista (estado);
CREATE INDEX IF NOT EXISTS idx_brk_pagos_fecha      ON broker_pagos_transportista (fecha_programada);
CREATE INDEX IF NOT EXISTS idx_brk_pagos_lead       ON broker_pagos_transportista (lead_id);
CREATE INDEX IF NOT EXISTS idx_brk_pagos_viaje      ON broker_pagos_transportista (viaje_id);

-- ── Vista cashflow por operación broker ──
-- Para cada lead/viaje broker: cuánto cobré del cliente, cuánto debo al transportista
CREATE OR REPLACE VIEW broker_cashflow_operaciones AS
SELECT
  l.id              AS lead_id,
  l.folio,
  l.contacto_nombre,
  l.empresa,
  l.estado          AS estado_lead,
  l.precio_final    AS monto_cliente,
  l.precio_transportista AS monto_transportista_acordado,
  l.comision_andreu AS comision_esperada,
  l.transportista_externo_id,
  t.razon_social    AS transportista,

  -- Cobros del cliente (tracking directo en leads — captura manual)
  COALESCE(l.monto_cobrado_cliente, 0)::float AS cobrado_cliente,
  l.fecha_primer_cobro,
  l.fecha_ultimo_cobro,

  -- Pagos al transportista
  COALESCE((
    SELECT SUM(monto)::float FROM broker_pagos_transportista
    WHERE lead_id = l.id AND estado = 'pagado'
  ), 0) AS pagado_transportista,
  COALESCE((
    SELECT SUM(monto)::float FROM broker_pagos_transportista
    WHERE lead_id = l.id AND estado = 'programado'
  ), 0) AS pendiente_pagar_transportista,

  l.created_at,
  l.updated_at
FROM leads l
LEFT JOIN transportistas_externos t ON t.id = l.transportista_externo_id
WHERE l.tipo_operacion = 'broker'
  AND l.transportista_externo_id IS NOT NULL;

-- ── Vista exposición total de cashflow broker ──
-- Te dice cuánto debes pagar a transportistas vs cuánto te falta cobrar
CREATE OR REPLACE VIEW broker_cashflow_exposicion AS
SELECT
  COUNT(*) FILTER (WHERE estado_lead = 'ganado')::int                                    AS operaciones_activas,
  COALESCE(SUM(monto_cliente) FILTER (WHERE estado_lead = 'ganado'), 0)::float           AS total_facturar_cliente,
  COALESCE(SUM(cobrado_cliente) FILTER (WHERE estado_lead = 'ganado'), 0)::float         AS total_cobrado_cliente,
  COALESCE(SUM(monto_cliente - cobrado_cliente) FILTER (WHERE estado_lead = 'ganado'), 0)::float
                                                                                          AS pendiente_cobrar_cliente,
  COALESCE(SUM(monto_transportista_acordado) FILTER (WHERE estado_lead = 'ganado'), 0)::float
                                                                                          AS total_pagar_transportista,
  COALESCE(SUM(pagado_transportista) FILTER (WHERE estado_lead = 'ganado'), 0)::float    AS total_pagado_transportista,
  COALESCE(SUM(pendiente_pagar_transportista) FILTER (WHERE estado_lead = 'ganado'), 0)::float
                                                                                          AS pendiente_pagar_transportista,
  -- Exposición neta = lo que debes pagar - lo que vas a cobrar (positivo = riesgo)
  COALESCE(SUM(pendiente_pagar_transportista) FILTER (WHERE estado_lead = 'ganado'), 0)::float -
  COALESCE(SUM(monto_cliente - cobrado_cliente) FILTER (WHERE estado_lead = 'ganado'), 0)::float
                                                                                          AS exposicion_neta
FROM broker_cashflow_operaciones;

-- ── Vista concentración por cliente (top + flag de riesgo) ──
CREATE OR REPLACE VIEW broker_concentracion_clientes AS
WITH ventana AS (
  SELECT
    contacto_nombre AS cliente,
    COALESCE(empresa, contacto_nombre) AS empresa,
    SUM(precio_final)::float           AS volumen_trimestre,
    COUNT(*)::int                       AS operaciones
  FROM leads
  WHERE tipo_operacion = 'broker'
    AND estado = 'ganado'
    AND created_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY contacto_nombre, empresa
), total AS (
  SELECT SUM(volumen_trimestre) AS total_vol FROM ventana
)
SELECT
  v.empresa,
  v.cliente,
  v.volumen_trimestre,
  v.operaciones,
  CASE WHEN t.total_vol > 0
       THEN (v.volumen_trimestre / t.total_vol * 100)::float
       ELSE 0 END AS pct_volumen
FROM ventana v, total t
ORDER BY v.volumen_trimestre DESC;

-- ── Vista concentración por transportista ──
CREATE OR REPLACE VIEW broker_concentracion_transportistas AS
WITH ventana AS (
  SELECT
    l.transportista_externo_id  AS transportista_id,
    t.razon_social              AS transportista,
    SUM(l.precio_transportista)::float AS volumen_trimestre,
    COUNT(*)::int                AS operaciones
  FROM leads l
  JOIN transportistas_externos t ON t.id = l.transportista_externo_id
  WHERE l.tipo_operacion = 'broker'
    AND l.estado = 'ganado'
    AND l.created_at >= CURRENT_DATE - INTERVAL '90 days'
  GROUP BY l.transportista_externo_id, t.razon_social
), total AS (
  SELECT SUM(volumen_trimestre) AS total_vol FROM ventana
)
SELECT
  v.transportista_id,
  v.transportista,
  v.volumen_trimestre,
  v.operaciones,
  CASE WHEN t.total_vol > 0
       THEN (v.volumen_trimestre / t.total_vol * 100)::float
       ELSE 0 END AS pct_volumen
FROM ventana v, total t
ORDER BY v.volumen_trimestre DESC;

-- ── Vista pagos programados con días restantes ──
CREATE OR REPLACE VIEW broker_pagos_alertas AS
SELECT
  p.id, p.transportista_externo_id, t.razon_social AS transportista,
  p.lead_id,
  (SELECT folio FROM leads WHERE id = p.lead_id) AS lead_folio,
  p.concepto, p.monto, p.fecha_programada, p.fecha_pagada, p.estado,
  (p.fecha_programada - CURRENT_DATE)::int AS dias_restantes,
  CASE
    WHEN p.estado = 'pagado' THEN 'pagado'
    WHEN p.estado = 'cancelado' THEN 'cancelado'
    WHEN p.fecha_programada < CURRENT_DATE THEN 'vencido'
    WHEN p.fecha_programada <= CURRENT_DATE + 7 THEN 'proximo'
    ELSE 'programado'
  END AS estado_visual,
  -- Si hay lead vinculado: cuánto se ha cobrado del cliente
  (SELECT cobrado_cliente FROM broker_cashflow_operaciones WHERE lead_id = p.lead_id) AS cliente_ya_pago,
  (SELECT monto_cliente FROM broker_cashflow_operaciones WHERE lead_id = p.lead_id)   AS cliente_total
FROM broker_pagos_transportista p
JOIN transportistas_externos t ON t.id = p.transportista_externo_id;

-- ── Trigger: marcar vencido automáticamente al consultar ──
-- (Lo hace el cron diario también pero esto cubre lecturas inmediatas)
CREATE OR REPLACE FUNCTION broker_marcar_vencidos() RETURNS INTEGER AS $$
DECLARE n INTEGER;
BEGIN
  UPDATE broker_pagos_transportista
  SET estado = 'vencido', updated_at = NOW()
  WHERE estado = 'programado'
    AND fecha_programada < CURRENT_DATE;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase14', 'sistema',
  jsonb_build_object(
    'fase', 'broker_finanzas',
    'cambios', jsonb_build_array(
      'tabla broker_pagos_transportista creada',
      'vista broker_cashflow_operaciones (por lead/viaje broker)',
      'vista broker_cashflow_exposicion (resumen global)',
      'vista broker_concentracion_clientes (90 dias)',
      'vista broker_concentracion_transportistas (90 dias)',
      'vista broker_pagos_alertas (próximos, vencidos, pagados)',
      'funcion broker_marcar_vencidos',
      'config broker_politica_pago, umbrales concentracion, dias credito'
    )
  ),
  'migration_script'
);

SELECT
  'broker_pagos_transportista' AS tabla, COUNT(*)::int FROM broker_pagos_transportista
UNION ALL SELECT 'broker_cashflow_operaciones', COUNT(*)::int FROM broker_cashflow_operaciones
UNION ALL SELECT 'broker_concentracion_clientes', COUNT(*)::int FROM broker_concentracion_clientes
UNION ALL SELECT 'broker_concentracion_transportistas', COUNT(*)::int FROM broker_concentracion_transportistas
UNION ALL SELECT 'config broker_*', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'broker_%';
