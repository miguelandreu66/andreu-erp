-- =============================================
-- GRUPO ANDREU ERP — Migración Fase 6
-- Especialización Andreu Logistics
-- Catálogo de servicios de transporte de carga
-- =============================================
-- Ejecutar en Railway -> Query Runner
-- Idempotente: usa IF NOT EXISTS / ON CONFLICT
-- =============================================

-- ----------------------------------------------
-- 1) Catálogo de servicios de transporte
-- ----------------------------------------------
-- Reemplaza el catálogo de productos de ferretería (FerreExpress) por
-- servicios facturables de transporte (Andreu Logistics). Cada servicio
-- tiene su clave SAT para emisión correcta de CFDI 4.0 + Carta Porte 3.1.

CREATE TABLE IF NOT EXISTS servicios_transporte (
  id              SERIAL PRIMARY KEY,
  codigo          VARCHAR(30)  NOT NULL UNIQUE,
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT,
  clave_sat       VARCHAR(20),                -- ProdServ SAT
  unidad_sat      VARCHAR(10) DEFAULT 'E48',  -- Unidad de servicio
  precio_base     DECIMAL(12,2),              -- Precio referencia (puede sobrescribirse en cotización)
  precio_por_km   DECIMAL(8,2),               -- Opcional: precio por kilómetro
  iva_pct         DECIMAL(5,2) DEFAULT 16.00,
  retencion_pct   DECIMAL(5,2) DEFAULT 4.00,  -- Retención IVA estándar autotransporte
  activo          BOOLEAN NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_servicios_activo ON servicios_transporte (activo);

-- Seed: los 5 servicios oficiales del manual de Andreu Logistics
INSERT INTO servicios_transporte (codigo, nombre, descripcion, clave_sat, unidad_sat, precio_base, precio_por_km, notas) VALUES
  ('FLT-PLAT-48',  'Flete plataforma 48'' por viaje',
   'Servicio de transporte en plataforma de 48 pies, tarifa por viaje completo.',
   '78101802', 'E48', 25000.00, NULL,
   'Cuota plana — independiente de km.'),
  ('FLT-PLAT-KM',  'Flete plataforma por kilómetro',
   'Servicio de transporte en plataforma, cobrado por kilómetro recorrido.',
   '78101802', 'KMT', NULL, 38.00,
   'Tarifa flexible para rutas variables.'),
  ('SRV-ESTADIA',  'Estadía',
   'Cargo por tiempo de espera en carga/descarga más allá del tiempo libre acordado.',
   '78101802', 'HUR', 850.00, NULL,
   'Por hora después de las 4 hrs libres incluidas.'),
  ('SRV-MANIOBRAS','Maniobras',
   'Servicio adicional de maniobras de carga/descarga cuando el cliente no aporta personal.',
   '78101802', 'E48', 1800.00, NULL,
   'Por evento. Incluye 2 personas hasta 4 hrs.'),
  ('SRV-CUSTODIA', 'Custodia armada',
   'Servicio de seguridad armada para viajes de alto valor o zonas de riesgo.',
   '78101802', 'KMT', NULL, 22.00,
   'Subcontratada con socio certificado. Cotización por ruta.')
ON CONFLICT (codigo) DO UPDATE SET
  nombre        = EXCLUDED.nombre,
  descripcion   = EXCLUDED.descripcion,
  clave_sat     = EXCLUDED.clave_sat,
  unidad_sat    = EXCLUDED.unidad_sat,
  precio_base   = EXCLUDED.precio_base,
  precio_por_km = EXCLUDED.precio_por_km,
  notas         = EXCLUDED.notas,
  updated_at    = NOW();

-- ----------------------------------------------
-- 2) Tabla de configuración corporativa
-- ----------------------------------------------
-- Sirve para que el sistema sepa los datos de Andreu Logistics
-- (razón social, RFC, eslogan, etc) sin hardcodearlos en código.

CREATE TABLE IF NOT EXISTS configuracion_empresa (
  clave     VARCHAR(50) PRIMARY KEY,
  valor     TEXT NOT NULL,
  descripcion TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion_empresa (clave, valor, descripcion) VALUES
  ('razon_social',      'ANDREU LOGISTICS',                            'Razón social legal'),
  ('nombre_comercial',  'Andreu Logistics',                            'Marca comercial visible'),
  ('eslogan',           'Tu carga, en las manos correctas.',           'Tagline corporativo'),
  ('domicilio_fiscal',  'Cuernavaca, Morelos, México',                 'Domicilio fiscal'),
  ('giro',              'Autotransporte federal de carga pesada',      'Giro económico'),
  ('regimen_fiscal',    '601',                                          'Régimen general personas morales'),
  ('moneda',            'MXN',                                          'Moneda operativa'),
  ('iva_default',       '16.00',                                        'Tasa IVA por defecto'),
  ('serie_facturacion', 'A',                                            'Serie de facturación activa (Andreu)'),
  ('folio_inicial',     '0001',                                         'Folio inicial de Andreu (NO continúa FerreExpress)'),
  ('cobranza_dias',     '30',                                           'Condiciones de pago estándar'),
  ('version_command_ai','1.1.0',                                        'Versión del módulo Command AI')
ON CONFLICT (clave) DO UPDATE SET
  valor        = EXCLUDED.valor,
  descripcion  = EXCLUDED.descripcion,
  updated_at   = NOW();

-- ----------------------------------------------
-- 3) Marcado de migración FerreExpress (auditable)
-- ----------------------------------------------
-- Registramos en audit_log que esta fase fue aplicada.

INSERT INTO audit_log (usuario_id, accion, entidad, entidad_id, detalle, ip)
VALUES (
  NULL,
  'migracion_fase6',
  'sistema',
  NULL,
  jsonb_build_object(
    'fase', 'andreu_logistics_specialization',
    'cambios', jsonb_build_array(
      'tabla servicios_transporte creada',
      '5 servicios oficiales sembrados',
      'tabla configuracion_empresa creada',
      'datos corporativos de Andreu Logistics establecidos',
      'menu lateral reorganizado',
      'Caja e Inventario restringidos a Director (legacy FerreExpress)',
      'modulo Comercial IA agregado a Command AI'
    ),
    'fecha', NOW()
  ),
  'migration_script'
);

-- ----------------------------------------------
-- Verificación
-- ----------------------------------------------
SELECT 'servicios_transporte' AS tabla, COUNT(*)::int AS filas FROM servicios_transporte
UNION ALL
SELECT 'configuracion_empresa', COUNT(*)::int FROM configuracion_empresa
ORDER BY tabla;
