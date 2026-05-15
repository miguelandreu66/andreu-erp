// ════════════════════════════════════════════════════════════════
// CFDI BUILDER — construye el payload JSON para Facturama
// ════════════════════════════════════════════════════════════════
// CFDI 4.0 con complemento Carta Porte 3.0 para transporte federal.
// Catálogos SAT relevantes:
//   c_RegimenFiscal: 601 (Personas Morales), 612 (PFAE)
//   c_UsoCFDI: G03 (Gastos en general), S01 (Sin efectos fiscales)
//   c_FormaPago: 99 (Por definir), 03 (Transferencia), 01 (Efectivo)
//   c_MetodoPago: PUE (Pago en una exhibición), PPD (Pago en parcialidades)
//   c_TipoComprobante: I (Ingreso)
//   c_ClaveProdServ: 78101800 (Servicios de transporte de carga por carretera)
//   c_ClaveUnidad: E48 (Unidad de servicio), KGM (Kilogramo), KMT (Kilómetro)
//   c_TipoTransporte: 01 (Autotransporte Federal)
//   c_TipoPermiso: TPAF01 (Autotransporte federal de carga general)
// ════════════════════════════════════════════════════════════════

const db = require('../../db');

async function leerConfigFiscal() {
  const { rows } = await db.query(`
    SELECT clave, valor FROM configuracion_empresa
    WHERE clave LIKE 'fiscal_%' OR clave LIKE 'cartaporte_%' OR clave LIKE 'cfdi_%'
  `);
  return Object.fromEntries(rows.map(r => [r.clave, r.valor]));
}

function redondear(num, dec = 2) {
  return Math.round((parseFloat(num) || 0) * Math.pow(10, dec)) / Math.pow(10, dec);
}

/**
 * Construye el payload de CFDI 4.0 + Carta Porte 3.0 para Facturama.
 *
 * @param {Object} opciones
 * @param {Object} opciones.viaje  — registro de la tabla viajes
 * @param {Object} opciones.cliente — registro de la tabla clientes
 * @param {Object} [opciones.unidad] — placa, datos de la unidad
 * @param {Object} [opciones.operador] — datos del operador (figura transporte)
 * @param {Array}  [opciones.servicios] — líneas adicionales (opcional)
 * @returns {Object} payload listo para POST a Facturama
 */
async function construirPayload({ viaje, cliente, unidad = null, operador = null, servicios = [] }) {
  const cfg = await leerConfigFiscal();

  // Validar datos del emisor mínimos
  if (!cfg.fiscal_rfc)          throw new Error('Falta configurar fiscal_rfc del emisor');
  if (!cfg.fiscal_razon_social) throw new Error('Falta configurar fiscal_razon_social del emisor');

  // Validar datos del receptor
  if (!cliente.rfc_fiscal)           throw new Error(`Cliente "${cliente.nombre}" no tiene RFC fiscal`);
  if (!cliente.razon_social)         throw new Error(`Cliente "${cliente.nombre}" no tiene razón social`);
  if (!cliente.regimen_fiscal)       throw new Error(`Cliente "${cliente.nombre}" no tiene régimen fiscal`);
  if (!cliente.codigo_postal_fiscal) throw new Error(`Cliente "${cliente.nombre}" no tiene CP fiscal`);

  // Validar datos del viaje
  if (!viaje.monto_cobrado_cliente || parseFloat(viaje.monto_cobrado_cliente) <= 0) {
    throw new Error('Viaje sin monto cobrado configurado');
  }

  // ── Conceptos ──
  const conceptos = [];
  const subtotalServicio = parseFloat(viaje.monto_cobrado_cliente);
  // SAT requiere quitar IVA del precio (asumimos que monto_cobrado_cliente YA incluye IVA)
  // CFDI 4.0 maneja: ValorUnitario sin IVA, luego se calcula IVA del 16%
  const valorUnitarioSinIva = redondear(subtotalServicio / 1.16, 2);
  const importeIva = redondear(valorUnitarioSinIva * 0.16, 2);

  const claveProdServ = viaje.clave_producto_servicio_sat || '78101800';
  const claveUnidad   = 'E48'; // Unidad de servicio
  const descripcionServ = `Servicio de transporte de carga ${viaje.origen} → ${viaje.destino}${viaje.descripcion_mercancia ? ` — ${viaje.descripcion_mercancia}` : ''}`;

  conceptos.push({
    ProductCode: claveProdServ,           // ClaveProdServ
    IdentificationNumber: viaje.id?.toString() || '',
    Description: descripcionServ.slice(0, 1000),
    Unit: 'Servicio',
    UnitCode: claveUnidad,
    UnitPrice: valorUnitarioSinIva,
    Quantity: 1,
    Subtotal: valorUnitarioSinIva,
    Discount: 0,
    Total: valorUnitarioSinIva + importeIva,
    TaxObject: '02',  // 02 = Sí objeto de impuesto
    Taxes: [{
      Total: importeIva,
      Name: 'IVA',
      Base: valorUnitarioSinIva,
      Rate: 0.16,
      IsRetention: false,
    }],
  });

  // ── Servicios adicionales (estadía, maniobras, etc.) ──
  for (const s of servicios) {
    const subtotalS = parseFloat(s.subtotal || 0);
    const valorS = redondear(subtotalS / 1.16, 2);
    const ivaS = redondear(valorS * 0.16, 2);
    conceptos.push({
      ProductCode: s.clave_prod_serv || '78101802',
      Description: (s.descripcion || 'Servicio adicional').slice(0, 1000),
      Unit: s.unidad_label || 'Servicio',
      UnitCode: s.clave_unidad || 'E48',
      UnitPrice: valorS,
      Quantity: parseFloat(s.cantidad || 1),
      Subtotal: valorS,
      Total: valorS + ivaS,
      TaxObject: '02',
      Taxes: [{ Total: ivaS, Name: 'IVA', Base: valorS, Rate: 0.16, IsRetention: false }],
    });
  }

  // ── Payload base CFDI 4.0 ──
  const payload = {
    Serie: cfg.fiscal_serie_cfdi || 'A',
    CfdiType: 'I',
    PaymentForm: cfg.fiscal_forma_pago_default || '99',
    PaymentMethod: cfg.fiscal_metodo_pago_default || 'PPD',
    Currency: cfg.fiscal_moneda_default || 'MXN',
    ExpeditionPlace: cfg.fiscal_codigo_postal || '62000',

    Issuer: {
      Rfc: cfg.fiscal_rfc,
      Name: cfg.fiscal_razon_social,
      FiscalRegime: cfg.fiscal_regimen_fiscal || '601',
    },

    Receiver: {
      Rfc: cliente.rfc_fiscal,
      Name: cliente.razon_social,
      CfdiUse: cliente.uso_cfdi || cfg.fiscal_uso_cfdi_default || 'G03',
      FiscalRegime: cliente.regimen_fiscal,
      TaxZipCode: cliente.codigo_postal_fiscal,
    },

    Items: conceptos,
  };

  // ── Complemento Carta Porte 3.0 ──
  // Solo si el viaje tiene origen+destino+kms+peso
  if (viaje.origen_codigo_postal && viaje.destino_codigo_postal &&
      viaje.distancia_km && viaje.peso_bruto_total_kg) {

    const cartaPorte = {
      Version: '3.0',
      TranspInternac: 'No',
      TotalDistRec: redondear(viaje.distancia_km, 3),

      Ubicaciones: [
        {
          TipoUbicacion: 'Origen',
          IDUbicacion: 'OR000001',
          RFCRemitenteDestinatario: cfg.fiscal_rfc,
          NombreRemitenteDestinatario: cfg.fiscal_razon_social,
          FechaHoraSalidaLlegada: (viaje.fecha_salida || viaje.fecha || new Date()).toISOString().slice(0,19),
          Domicilio: { CodigoPostal: viaje.origen_codigo_postal },
        },
        {
          TipoUbicacion: 'Destino',
          IDUbicacion: 'DE000001',
          RFCRemitenteDestinatario: cliente.rfc_fiscal,
          NombreRemitenteDestinatario: cliente.razon_social,
          FechaHoraSalidaLlegada: (viaje.fecha_llegada || viaje.fecha || new Date()).toISOString().slice(0,19),
          DistanciaRecorrida: redondear(viaje.distancia_km, 3),
          Domicilio: { CodigoPostal: viaje.destino_codigo_postal },
        },
      ],

      Mercancias: {
        PesoBrutoTotal: redondear(viaje.peso_bruto_total_kg, 3),
        UnidadPeso: viaje.clave_unidad_peso_sat || 'KGM',
        NumTotalMercancias: 1,
        Mercancia: [{
          BienesTransp: claveProdServ,
          Descripcion: (viaje.descripcion_mercancia || 'Mercancía general').slice(0, 1000),
          Cantidad: 1,
          ClaveUnidad: 'XBX', // Caja
          PesoEnKg: redondear(viaje.peso_bruto_total_kg, 3),
          MaterialPeligroso: viaje.material_peligroso ? 'Sí' : 'No',
          ...(viaje.material_peligroso && viaje.cve_material_peligroso
              ? { CveMaterialPeligroso: viaje.cve_material_peligroso }
              : {}),
        }],
        Autotransporte: {
          PermSCT: cfg.cartaporte_permiso_sct || 'TPAF01',
          NumPermisoSCT: cfg.cartaporte_num_permiso_sct || '',
          IdentificacionVehicular: {
            ConfigVehicular: 'C2',  // C2 = Camión Unitario 2 llantas en eje motriz
            PesoBrutoVehicular: 12, // toneladas — TODO: leer de la unidad
            PlacaVM: unidad?.placa || '',
            AnioModeloVM: unidad?.anio_modelo || new Date().getFullYear() - 2,
          },
          Seguros: {
            AseguraRespCivil: cfg.cartaporte_seguro_resp_civil_aseguradora || 'Por definir',
            PolizaRespCivil: cfg.cartaporte_seguro_resp_civil_poliza || 'POR-DEFINIR',
            ...(viaje.material_peligroso ? {
              AseguraMedAmbiente: cfg.cartaporte_seguro_medio_ambiente_aseg || '',
              PolizaMedAmbiente:  cfg.cartaporte_seguro_medio_ambiente_poliza || '',
            } : {}),
          },
        },
      },

      FiguraTransporte: operador ? [{
        TipoFigura: '01', // Operador
        RFCFigura: operador.rfc || cfg.fiscal_rfc,
        NumLicencia: operador.licencia_federal || 'XX0000000',
        NombreFigura: operador.nombre,
      }] : [{
        TipoFigura: '01',
        RFCFigura: cfg.fiscal_rfc,
        NumLicencia: 'XX0000000',
        NombreFigura: 'Operador por designar',
      }],
    };

    payload.Complemento = { CartaPorte: cartaPorte };
  }

  return { payload, valorUnitarioSinIva, importeIva, subtotalServicio };
}

module.exports = { construirPayload, leerConfigFiscal };
