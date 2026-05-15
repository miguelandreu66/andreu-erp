-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 11
-- Cotizador AI público + CRM de leads
-- =============================================
-- Tabla leads para captura desde cotizador público.
-- Params de pricing en configuracion_empresa (ajustables sin redeploy).
-- =============================================

-- Parámetros del cotizador (configurables)
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('cotizador_activo',                'true',  'Activa el cotizador público en /cotizar'),
  ('cotizador_tarifa_km_base',        '42',    'Tarifa MXN por km — base plataforma 48 carga general'),
  ('cotizador_precio_minimo_viaje',   '12000', 'Precio mínimo MXN por viaje (no importa la distancia)'),
  ('cotizador_precio_diesel_litro',   '28',    'Precio actual del diesel en MXN/L'),
  ('cotizador_rendimiento_flota',     '0.5',   'Rendimiento promedio flota en lt/km'),
  ('cotizador_factor_casetas_km',     '3.5',   'Costo estimado de casetas en MXN/km'),
  ('cotizador_costo_operador_hora',   '80',    'Costo operador en MXN/hora'),
  ('cotizador_costo_mantenimiento_km','2',     'Mantenimiento prorrateado MXN/km'),
  ('cotizador_margen_objetivo_pct',   '35',    'Margen objetivo % (alerta si baja)'),
  ('cotizador_recargo_toneladas_extra','15',   'Recargo % si carga > 30 toneladas'),
  ('cotizador_recargo_peligrosa_pct', '25',    'Recargo % si carga peligrosa'),
  ('cotizador_recargo_refrigerada_pct','20',   'Recargo % si carga refrigerada/frágil'),
  ('cotizador_recargo_nocturno_pct',  '15',    'Recargo % si salida nocturna (>8pm)'),
  ('cotizador_descuento_redondo_pct', '5',     'Descuento % por viaje redondo con carga de regreso'),
  ('cotizador_descuento_4viajes_pct', '10',    'Descuento % por recurrencia mensual ≥ 4 viajes'),
  ('cotizador_descuento_anual_pct',   '15',    'Descuento % por contrato anual ≥ 50 viajes'),
  ('cotizador_custodia_armada_km',    '8',     'Adicional MXN/km por custodia armada'),
  ('cotizador_maniobras',             '2000',  'Costo por evento de maniobras'),
  ('cotizador_estadia_hora',          '300',   'Costo MXN/hora de estadía después de 4h libres')
ON CONFLICT (clave) DO UPDATE SET
  valor = EXCLUDED.valor,
  descripcion = EXCLUDED.descripcion,
  updated_at = NOW();

-- Tabla leads
CREATE TABLE IF NOT EXISTS leads (
  id                  BIGSERIAL PRIMARY KEY,
  folio               VARCHAR(20) UNIQUE NOT NULL,

  -- Datos del contacto
  contacto_nombre     VARCHAR(150) NOT NULL,
  empresa             VARCHAR(200),
  rfc                 VARCHAR(20),
  email               VARCHAR(150),
  telefono            VARCHAR(30),

  -- Datos del viaje solicitado
  origen              VARCHAR(200) NOT NULL,
  destino             VARCHAR(200) NOT NULL,
  origen_lat          DECIMAL(9,6),
  origen_lng          DECIMAL(9,6),
  destino_lat         DECIMAL(9,6),
  destino_lng         DECIMAL(9,6),
  toneladas           DECIMAL(8,2),
  tipo_carga          VARCHAR(50) DEFAULT 'general'
                      CHECK (tipo_carga IN ('general','peligrosa','refrigerada','fragil','liquidos','otro')),
  fecha_solicitada    DATE,
  recurrencia         VARCHAR(30) DEFAULT 'unico'
                      CHECK (recurrencia IN ('unico','redondo','mensual_2','mensual_4','anual')),
  servicios_extras    JSONB DEFAULT '[]'::jsonb, -- ['maniobras','custodia_armada','estadia']
  comentarios         TEXT,

  -- Cotización generada
  distancia_km        DECIMAL(8,2),
  duracion_horas      DECIMAL(6,2),
  precio_base         DECIMAL(12,2),
  precio_recargos     DECIMAL(12,2),
  precio_descuentos   DECIMAL(12,2),
  precio_extras       DECIMAL(12,2),
  precio_final        DECIMAL(12,2) NOT NULL,
  costo_estimado      DECIMAL(12,2),
  margen_pct          DECIMAL(5,2),
  desglose            JSONB,            -- detalle completo para auditoría
  modelo_usado        VARCHAR(40),       -- 'mapbox_directions' | 'haversine_estimate'

  -- Pipeline
  estado              VARCHAR(20) DEFAULT 'nuevo'
                      CHECK (estado IN ('nuevo','contactado','propuesta_enviada','negociando','ganado','perdido','spam')),

  -- Trazabilidad
  cliente_id          INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  viaje_id            INTEGER REFERENCES viajes(id)   ON DELETE SET NULL,
  generado_por_ip     VARCHAR(45),
  generado_por_ua     TEXT,
  generado_por_origen VARCHAR(50) DEFAULT 'web_publico', -- web_publico | whatsapp | manual

  -- Seguimiento
  contactado_at       TIMESTAMPTZ,
  contactado_por      INTEGER REFERENCES usuarios(id),
  notas_internas      TEXT,
  motivo_perdido      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_fecha ON leads (created_at DESC);

-- Secuencia para folios COT-2026-00001
CREATE SEQUENCE IF NOT EXISTS leads_folio_seq START 1;

CREATE OR REPLACE FUNCTION generar_folio_lead() RETURNS TEXT AS $$
DECLARE
  n INT;
BEGIN
  n := nextval('leads_folio_seq');
  RETURN 'COT-' || to_char(NOW(), 'YYYY') || '-' || lpad(n::text, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- Audit
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase11', 'sistema',
  jsonb_build_object(
    'fase', 'cotizador_leads',
    'cambios', jsonb_build_array(
      '19 parámetros de pricing agregados a configuracion_empresa',
      'tabla leads creada con pipeline y trazabilidad',
      'secuencia leads_folio_seq + funcion generar_folio_lead',
      'cotizador público sin login en /cotizar (próximo paso)'
    )
  ),
  'migration_script'
);

SELECT 'leads' AS tabla, COUNT(*)::int FROM leads
UNION ALL SELECT 'configuracion_empresa (cotizador)', COUNT(*)::int FROM configuracion_empresa WHERE clave LIKE 'cotizador_%';
