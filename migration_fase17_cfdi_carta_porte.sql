-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 17
-- CFDI 4.0 + Carta Porte 3.0 — Autopilot facturación
-- =============================================
-- Cuando un viaje pasa a estado "completado":
--   1) Se genera CFDI 4.0 + complemento Carta Porte 3.0 en estado borrador
--   2) Si auto-emisión está activa → se manda al PAC (Facturama)
--   3) PAC certifica y devuelve UUID + XML + PDF
--   4) Sistema envía XML + PDF al cliente por email
--   5) Viaje queda marcado como facturado
-- =============================================

-- ── Datos fiscales de Andreu Logistics (emisor) ──
INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('fiscal_rfc',                  '', 'RFC del emisor (Andreu Logistics)'),
  ('fiscal_razon_social',         '', 'Razón social del emisor'),
  ('fiscal_nombre_comercial',     'Andreu Logistics', 'Nombre comercial mostrado al cliente'),
  ('fiscal_regimen_fiscal',       '601', 'Régimen fiscal SAT (601=General Ley PM, 612=PFAE)'),
  ('fiscal_codigo_postal',        '62000', 'Código postal del lugar de expedición'),
  ('fiscal_lugar_expedicion',     'Cuernavaca, Morelos', 'Lugar de expedición (texto)'),
  ('fiscal_serie_cfdi',           'A',   'Serie de los CFDI (ej. A, F, etc.)'),
  ('fiscal_folio_inicio',         '1',   'Folio inicial del consecutivo (auto-incrementa)'),
  ('fiscal_uso_cfdi_default',     'G03', 'Uso CFDI default del receptor (G03=Gastos en general)'),
  ('fiscal_metodo_pago_default',  'PPD', 'Método pago (PPD=Pago en parcialidades, PUE=Pago en una exhibición)'),
  ('fiscal_forma_pago_default',   '99',  'Forma pago (99=Por definir, 03=Transferencia, 01=Efectivo)'),
  ('fiscal_moneda_default',       'MXN', 'Moneda default'),
  ('fiscal_pac_proveedor',        'facturama', 'PAC actual: facturama | sf | edicom'),
  ('fiscal_pac_modo',             'sandbox', 'Modo PAC: sandbox (pruebas) | produccion'),
  -- Carta Porte
  ('cartaporte_tipo_transporte',  '01', 'Tipo transporte SAT (01=Autotransporte Federal)'),
  ('cartaporte_permiso_sct',      '', 'Permiso SCT (ej. TPAF01)'),
  ('cartaporte_num_permiso_sct',  '', 'Número de permiso SCT'),
  ('cartaporte_seguro_resp_civil_aseguradora', '', 'Aseguradora de responsabilidad civil'),
  ('cartaporte_seguro_resp_civil_poliza',      '', 'Número de póliza R.C.'),
  ('cartaporte_seguro_medio_ambiente_aseg',    '', 'Aseguradora medio ambiente (si carga peligrosa)'),
  ('cartaporte_seguro_medio_ambiente_poliza',  '', 'Póliza medio ambiente'),
  -- Auto
  ('cfdi_auto_emitir',            'false', 'Si emite CFDI automáticamente al completar un viaje'),
  ('cfdi_auto_enviar_cliente',    'true',  'Si envía email automático al cliente al emitir'),
  ('cfdi_canales_envio',          'email', 'Canales para enviar: email | whatsapp | email,whatsapp')
ON CONFLICT (clave) DO UPDATE SET descripcion = EXCLUDED.descripcion, updated_at = NOW();

-- ── Extender clientes con datos fiscales ──
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS rfc_fiscal           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS razon_social         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS regimen_fiscal       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS codigo_postal_fiscal VARCHAR(10),
  ADD COLUMN IF NOT EXISTS uso_cfdi             VARCHAR(10) DEFAULT 'G03',
  ADD COLUMN IF NOT EXISTS email_facturacion    VARCHAR(200);

-- ── Extender viajes con datos para Carta Porte ──
ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS origen_codigo_postal   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS destino_codigo_postal  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS clave_producto_servicio_sat VARCHAR(20) DEFAULT '78101800',  -- 78101800 = Servicios de transporte de carga por carretera
  ADD COLUMN IF NOT EXISTS clave_unidad_peso_sat  VARCHAR(10) DEFAULT 'KGM',
  ADD COLUMN IF NOT EXISTS peso_bruto_total_kg    DECIMAL(12,3),
  ADD COLUMN IF NOT EXISTS descripcion_mercancia  TEXT,
  ADD COLUMN IF NOT EXISTS material_peligroso     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cve_material_peligroso VARCHAR(20),
  ADD COLUMN IF NOT EXISTS facturado              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cfdi_id                BIGINT;  -- referencia, FK se agrega después

-- ── Tabla principal: CFDIs emitidos ──
CREATE TABLE IF NOT EXISTS cfdi_emitidos (
  id                  BIGSERIAL PRIMARY KEY,
  viaje_id            INTEGER REFERENCES viajes(id) ON DELETE SET NULL,
  cliente_id          INTEGER REFERENCES clientes(id) ON DELETE SET NULL,

  -- Identificación CFDI
  serie               VARCHAR(10) NOT NULL,
  folio               INTEGER NOT NULL,
  uuid_fiscal         VARCHAR(40),                 -- UUID que devuelve el SAT/PAC
  fecha_emision       TIMESTAMPTZ,                 -- Fecha que estampa el SAT

  -- Tipo y subtipo
  tipo_comprobante    VARCHAR(2) NOT NULL DEFAULT 'I',   -- I=Ingreso, T=Traslado, N=Nómina, etc.
  forma_pago          VARCHAR(5),
  metodo_pago         VARCHAR(5),
  uso_cfdi            VARCHAR(10),
  moneda              VARCHAR(5) DEFAULT 'MXN',
  tipo_cambio         DECIMAL(10,4) DEFAULT 1,

  -- Montos
  subtotal            DECIMAL(14,2) NOT NULL,
  descuento           DECIMAL(14,2) DEFAULT 0,
  total_iva           DECIMAL(14,2) DEFAULT 0,
  total_retenciones   DECIMAL(14,2) DEFAULT 0,
  total               DECIMAL(14,2) NOT NULL,

  -- Receptor (snapshot al momento de emisión)
  receptor_rfc        VARCHAR(20),
  receptor_razon_social VARCHAR(200),
  receptor_regimen    VARCHAR(10),
  receptor_cp         VARCHAR(10),
  receptor_email      VARCHAR(200),

  -- Carta Porte (si aplica)
  tiene_carta_porte   BOOLEAN DEFAULT false,
  origen_cp           VARCHAR(10),
  destino_cp          VARCHAR(10),
  distancia_km        DECIMAL(10,3),
  peso_bruto_kg       DECIMAL(12,3),

  -- Estado del workflow
  estado              VARCHAR(20) NOT NULL DEFAULT 'borrador'
                        CHECK (estado IN ('borrador','emitiendo','emitido','enviado','cancelado','fallido','cancelacion_pendiente')),
  pac_proveedor       VARCHAR(20),
  pac_modo            VARCHAR(20),
  pac_respuesta       JSONB,
  error_mensaje       TEXT,

  -- Archivos
  xml_url             TEXT,         -- URL del XML (Cloudinary o local)
  xml_bytes           BYTEA,        -- contenido del XML (preferimos bytes)
  pdf_url             TEXT,
  pdf_bytes           BYTEA,

  -- Cancelación
  motivo_cancelacion  VARCHAR(10),
  acuse_cancelacion   JSONB,
  cancelado_at        TIMESTAMPTZ,
  cancelado_por       INTEGER REFERENCES usuarios(id),

  -- Envío al cliente
  enviado_cliente     BOOLEAN DEFAULT false,
  enviado_cliente_at  TIMESTAMPTZ,
  enviado_canales     TEXT[],       -- {'email','whatsapp'}

  -- Audit
  emitido_por         INTEGER REFERENCES usuarios(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cfdi_estado    ON cfdi_emitidos (estado);
CREATE INDEX IF NOT EXISTS idx_cfdi_viaje     ON cfdi_emitidos (viaje_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_cliente   ON cfdi_emitidos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_uuid      ON cfdi_emitidos (uuid_fiscal) WHERE uuid_fiscal IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cfdi_fecha     ON cfdi_emitidos (fecha_emision DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cfdi_serie_folio ON cfdi_emitidos (serie, folio);

-- Ahora sí: agregar FK desde viajes hacia cfdi_emitidos
ALTER TABLE viajes
  DROP CONSTRAINT IF EXISTS fk_viajes_cfdi,
  ADD CONSTRAINT fk_viajes_cfdi FOREIGN KEY (cfdi_id) REFERENCES cfdi_emitidos(id) ON DELETE SET NULL;

-- ── Conceptos de la factura (líneas) ──
CREATE TABLE IF NOT EXISTS cfdi_conceptos (
  id                BIGSERIAL PRIMARY KEY,
  cfdi_id           BIGINT NOT NULL REFERENCES cfdi_emitidos(id) ON DELETE CASCADE,
  clave_prod_serv   VARCHAR(20) NOT NULL,
  clave_unidad      VARCHAR(10) NOT NULL,
  descripcion       TEXT NOT NULL,
  cantidad          DECIMAL(12,4) NOT NULL DEFAULT 1,
  valor_unitario    DECIMAL(14,2) NOT NULL,
  importe           DECIMAL(14,2) NOT NULL,
  descuento         DECIMAL(14,2) DEFAULT 0,
  -- Impuestos
  base_iva          DECIMAL(14,2),
  tasa_iva          DECIMAL(8,6) DEFAULT 0.16,
  importe_iva       DECIMAL(14,2),
  -- Si es traslado de Carta Porte
  es_carta_porte    BOOLEAN DEFAULT false,
  orden_idx         INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cfdi_conc_cfdi ON cfdi_conceptos (cfdi_id);

-- ── Eventos del CFDI (timeline para debug) ──
CREATE TABLE IF NOT EXISTS cfdi_eventos (
  id              BIGSERIAL PRIMARY KEY,
  cfdi_id         BIGINT NOT NULL REFERENCES cfdi_emitidos(id) ON DELETE CASCADE,
  evento          VARCHAR(40) NOT NULL,    -- creado, enviado_pac, certificado, error_pac, enviado_cliente, cancelado, etc.
  detalle         JSONB,
  usuario_id      INTEGER REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cfdi_ev_cfdi ON cfdi_eventos (cfdi_id, created_at DESC);

-- ── Vista resumen para dashboard ──
CREATE OR REPLACE VIEW cfdi_resumen_mes AS
SELECT
  to_char(fecha_emision, 'YYYY-MM') AS periodo,
  COUNT(*) FILTER (WHERE estado = 'emitido')::int    AS emitidos,
  COUNT(*) FILTER (WHERE estado = 'cancelado')::int  AS cancelados,
  COUNT(*) FILTER (WHERE estado = 'fallido')::int    AS fallidos,
  COUNT(*) FILTER (WHERE estado = 'borrador')::int   AS borradores,
  COALESCE(SUM(total) FILTER (WHERE estado IN ('emitido','enviado')), 0)::float AS monto_emitido,
  COALESCE(SUM(total) FILTER (WHERE estado = 'cancelado'), 0)::float AS monto_cancelado
FROM cfdi_emitidos
GROUP BY 1
ORDER BY 1 DESC;

-- ── Función: siguiente folio ──
CREATE OR REPLACE FUNCTION siguiente_folio_cfdi(p_serie VARCHAR) RETURNS INTEGER AS $$
DECLARE
  v_folio INTEGER;
BEGIN
  SELECT COALESCE(MAX(folio), 0) + 1
    INTO v_folio
    FROM cfdi_emitidos
    WHERE serie = p_serie;
  RETURN v_folio;
END;
$$ LANGUAGE plpgsql;

-- ── Audit ──
INSERT INTO audit_log (usuario_id, accion, entidad, detalle, ip)
VALUES (
  NULL, 'migracion_fase17', 'sistema',
  jsonb_build_object(
    'fase', 'cfdi_carta_porte',
    'cambios', jsonb_build_array(
      'tabla cfdi_emitidos (CFDI 4.0 + Carta Porte 3.0)',
      'tabla cfdi_conceptos (líneas)',
      'tabla cfdi_eventos (timeline para debug)',
      'vista cfdi_resumen_mes',
      'función siguiente_folio_cfdi',
      'clientes extendido con datos fiscales (RFC, razón social, régimen, CP, uso CFDI)',
      'viajes extendido con datos Carta Porte (CPs, peso, mercancía, material peligroso)',
      '24 configs fiscales (RFC emisor, régimen, serie, PAC, Carta Porte, auto-emisión)'
    )
  ),
  'migration_script'
);

SELECT
  'cfdi_emitidos' AS tabla, COUNT(*)::int FROM cfdi_emitidos
UNION ALL SELECT 'cfdi_conceptos', COUNT(*)::int FROM cfdi_conceptos
UNION ALL SELECT 'config fiscal_*+cartaporte_*+cfdi_*', COUNT(*)::int FROM configuracion_empresa
  WHERE clave LIKE 'fiscal_%' OR clave LIKE 'cartaporte_%' OR clave LIKE 'cfdi_%';
