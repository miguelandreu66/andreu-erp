-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 12
-- Módulo Broker: red de transportistas externos
-- =============================================
-- Permite a Andreu actuar como broker cuando un cliente necesita servicio
-- que Andreu no puede atender directamente (refrigerado, peligrosos, etc.).
-- =============================================

-- Configuración: qué TIPOS de carga puede operar Andreu con flota propia
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('andreu_capacidades_carga',  'general,fragil,otro',
   'Tipos de carga que Andreu mueve con flota propia (CSV). Otros tipos van a broker automáticamente.'),
  ('andreu_capacidades_zonas',  'morelos,cdmx,edomex,guerrero,puebla,oaxaca',
   'Zonas/estados que Andreu cubre con flota propia (CSV). Fuera de aquí va a broker.'),
  ('broker_markup_default_pct', '15',
   'Markup % que Andreu aplica sobre el precio del transportista externo (su ganancia bruta)')
ON CONFLICT (clave) DO UPDATE SET
  valor = EXCLUDED.valor,
  descripcion = EXCLUDED.descripcion,
  updated_at = NOW();

-- ── Transportistas externos ──────────────────────
CREATE TABLE IF NOT EXISTS transportistas_externos (
  id                  SERIAL PRIMARY KEY,
  razon_social        VARCHAR(200) NOT NULL,
  nombre_comercial    VARCHAR(150),
  rfc                 VARCHAR(20),
  contacto_nombre     VARCHAR(150),
  telefono            VARCHAR(30),
  email               VARCHAR(150),
  direccion           TEXT,

  -- Capacidades operativas
  tipos_carga         TEXT[],   -- {'general','refrigerada','peligrosa','liquidos','fragil','otro'}
  tipos_unidad        TEXT[],   -- {'plataforma_48','caja_seca','thermo','pipa','tolva','cama_baja','doble_caja'}
  zonas_cobertura     TEXT[],   -- {'morelos','cdmx','nacional','frontera_norte'}

  -- Términos comerciales
  comision_pct_acordada  DECIMAL(5,2) DEFAULT 15.00, -- Markup que Andreu aplica
  condiciones_pago       VARCHAR(50),  -- "contra entrega", "15 días", "30 días"

  -- Performance
  calificacion        DECIMAL(3,2) DEFAULT 3.00 CHECK (calificacion BETWEEN 0 AND 5),
  total_viajes        INTEGER DEFAULT 0,
  total_facturado     DECIMAL(14,2) DEFAULT 0,

  activo              BOOLEAN NOT NULL DEFAULT true,
  notas               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transp_activo ON transportistas_externos (activo);
CREATE INDEX IF NOT EXISTS idx_transp_tipos_carga ON transportistas_externos USING GIN (tipos_carga);
CREATE INDEX IF NOT EXISTS idx_transp_zonas ON transportistas_externos USING GIN (zonas_cobertura);

-- ── Extender leads ─────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tipo_operacion VARCHAR(20) DEFAULT 'pendiente_decidir'
    CHECK (tipo_operacion IN ('propio','broker','pendiente_decidir')),
  ADD COLUMN IF NOT EXISTS transportista_externo_id INTEGER REFERENCES transportistas_externos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS precio_transportista DECIMAL(12,2),     -- Lo que paga Andreu al transportista
  ADD COLUMN IF NOT EXISTS comision_andreu DECIMAL(12,2),          -- precio_final - precio_transportista
  ADD COLUMN IF NOT EXISTS sugerencias_broker JSONB DEFAULT '[]'::jsonb;  -- IDs de top transportistas sugeridos por IA

CREATE INDEX IF NOT EXISTS idx_leads_tipo_op ON leads (tipo_operacion);
CREATE INDEX IF NOT EXISTS idx_leads_transportista ON leads (transportista_externo_id);

-- ── Extender viajes para identificar broker ──────
ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS tipo_operacion VARCHAR(20) DEFAULT 'propio'
    CHECK (tipo_operacion IN ('propio','broker')),
  ADD COLUMN IF NOT EXISTS transportista_externo_id INTEGER REFERENCES transportistas_externos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monto_cobrado_cliente DECIMAL(12,2),     -- Lo que Andreu factura al cliente
  ADD COLUMN IF NOT EXISTS monto_pagado_transportista DECIMAL(12,2),-- Lo que Andreu paga al transportista
  ADD COLUMN IF NOT EXISTS comision_andreu DECIMAL(12,2);           -- Calculado: cobrado - pagado

CREATE INDEX IF NOT EXISTS idx_viajes_tipo_op ON viajes (tipo_operacion);

-- Audit
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase12', 'sistema',
  jsonb_build_object(
    'fase', 'broker_module',
    'cambios', jsonb_build_array(
      'tabla transportistas_externos creada con capacidades y rating',
      'leads extendido con tipo_operacion + transportista + comision',
      'viajes extendido para diferenciar propio vs broker',
      'configuracion andreu_capacidades_carga + zonas + markup default',
      'IA detecta automáticamente cuando una cotizacion es broker candidate'
    )
  ),
  'migration_script'
);

SELECT
  'transportistas_externos' AS tabla, COUNT(*)::int FROM transportistas_externos
UNION ALL SELECT 'leads (con tipo_op)', COUNT(*)::int FROM leads
UNION ALL SELECT 'viajes (con tipo_op)', COUNT(*)::int FROM viajes
UNION ALL SELECT 'config (broker)', COUNT(*)::int FROM configuracion_empresa
  WHERE clave LIKE 'andreu_capacidades%' OR clave LIKE 'broker_%';
