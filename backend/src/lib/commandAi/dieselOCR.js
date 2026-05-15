// OCR de tickets de combustible usando Claude Sonnet 4.6 con Vision + structured outputs.
// Diseñado para tickets mexicanos de Pemex, BP, Mobil, Shell, etc.

const Anthropic = require('@anthropic-ai/sdk').default;
const apiKeys = require('./apiKeysStore');

const MODELO = 'claude-sonnet-4-6';

const SCHEMA_TICKET = {
  type: 'object',
  properties: {
    es_ticket_combustible: {
      type: 'boolean',
      description: 'true si la imagen ES un ticket de gasolinera/combustible. false si es otra cosa (recibo de comida, factura distinta, etc).',
    },
    fecha: {
      type: 'string',
      description: 'Fecha del ticket en formato YYYY-MM-DD. Si solo hay día/mes y no año, asume año actual. null si no se puede leer.',
    },
    hora: {
      type: 'string',
      description: 'Hora en formato HH:MM si está visible. null si no.',
    },
    tipo_combustible: {
      type: 'string',
      enum: ['diesel', 'magna', 'premium', 'gasolina_indeterminada', 'otro', 'desconocido'],
      description: 'Tipo de combustible. "diesel" para diésel; "magna" para verde 87 octanos; "premium" para rojo 91+; "gasolina_indeterminada" si dice gasolina sin especificar; "otro" para gas LP/GNV/etc; "desconocido" si no se ve.',
    },
    litros: {
      type: 'number',
      description: 'Cantidad de litros cargados (número con decimales). null si no se puede determinar.',
    },
    precio_por_litro: {
      type: 'number',
      description: 'Precio por litro en pesos mexicanos (número con decimales). null si no.',
    },
    total: {
      type: 'number',
      description: 'Total pagado en pesos mexicanos (incluye impuestos). null si no se ve.',
    },
    gasolinera_marca: {
      type: 'string',
      description: 'Marca: Pemex, BP, Mobil, Shell, G500, Petro7, Total, Hidrosina, etc. null si no se identifica.',
    },
    gasolinera_nombre: {
      type: 'string',
      description: 'Nombre completo de la estación o razón social si está visible. null si no.',
    },
    gasolinera_direccion: {
      type: 'string',
      description: 'Dirección, colonia o ciudad. null si no se ve.',
    },
    rfc_emisor: {
      type: 'string',
      description: 'RFC del emisor si está visible (12-13 caracteres). null si no.',
    },
    folio_ticket: {
      type: 'string',
      description: 'Folio/número de ticket si está visible. null si no.',
    },
    metodo_pago: {
      type: 'string',
      description: 'Efectivo, tarjeta, transferencia, etc. null si no se ve.',
    },
    confianza: {
      type: 'string',
      enum: ['alta', 'media', 'baja'],
      description: 'Qué tan seguro estás de los datos extraídos. "alta": ticket nítido, todos los campos claros. "media": legible pero hay campos dudosos. "baja": imagen borrosa, poca luz, parcialmente cortada.',
    },
    observaciones: {
      type: 'string',
      description: 'Notas relevantes para el humano: si algo no se ve, si hay inconsistencias (litros × precio ≠ total), si parece adulterado, etc. null si todo está bien.',
    },
  },
  required: ['es_ticket_combustible', 'confianza'],
  additionalProperties: false,
};

const PROMPT_EXTRACCION = `Eres un experto en lectura de tickets de gasolineras mexicanas. Examina la imagen y extrae los datos relevantes.

INSTRUCCIONES:
- Si la imagen NO es un ticket de combustible, marca es_ticket_combustible=false y deja los demás campos en null/desconocido.
- Para campos que NO puedes leer con claridad, devuelve null. NO inventes valores.
- Para fechas en formato dd/mm/yyyy o dd-mm-yyyy, conviértelas a YYYY-MM-DD.
- Para montos, devuelve números (ej: 1234.50, no "$1,234.50").
- Si el ticket está borroso, mal iluminado o parcial, usa confianza="baja" y explica en observaciones.
- Si los números no cuadran (litros × precio ≠ total ±5%), márcalo en observaciones — puede ser ticket alterado.
- Si ves "DIESEL" o "DIÉSEL", el combustible es "diesel".
- Magna es la verde; premium es la roja.

Devuelve solo el JSON estructurado.`;

async function extraerDeImagen(imageBuffer, mimeType) {
  const apiKey = await apiKeys.leer('anthropic_api_key');
  if (!apiKey) {
    throw new Error('Supervisor IA no configurado. Activa la API key en Command AI → Supervisor IA antes de usar OCR.');
  }

  const client = new Anthropic({ apiKey });
  const base64 = imageBuffer.toString('base64');

  // Normalizar mime type
  let mediaType = mimeType;
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
    mediaType = 'image/jpeg'; // fallback
  }

  const t0 = Date.now();

  const response = await client.messages.create({
    model: MODELO,
    max_tokens: 1024,
    output_config: {
      format: { type: 'json_schema', schema: SCHEMA_TICKET },
    },
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        { type: 'text', text: PROMPT_EXTRACCION },
      ],
    }],
  });

  const duracion_ms = Date.now() - t0;

  // Parse el JSON de la respuesta
  let datos = null;
  for (const block of response.content) {
    if (block.type === 'text') {
      try {
        datos = JSON.parse(block.text);
        break;
      } catch (e) {
        console.warn('OCR JSON parse error:', e.message);
      }
    }
  }

  if (!datos) {
    throw new Error('La IA no pudo extraer datos estructurados del ticket. Intenta con una foto más nítida.');
  }

  // Validación de consistencia
  let alerta_consistencia = null;
  if (datos.litros && datos.precio_por_litro && datos.total) {
    const esperado = datos.litros * datos.precio_por_litro;
    const diff_pct = Math.abs(esperado - datos.total) / datos.total;
    if (diff_pct > 0.05) {
      alerta_consistencia = `Los números no cuadran: ${datos.litros} L × $${datos.precio_por_litro}/L = $${esperado.toFixed(2)}, pero el ticket muestra total $${datos.total}. Posible ticket adulterado o tecleado mal.`;
    }
  }

  return {
    datos,
    alerta_consistencia,
    duracion_ms,
    modelo: MODELO,
    usage: response.usage,
  };
}

module.exports = { extraerDeImagen };
