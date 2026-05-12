const cloudinary = require('cloudinary').v2;

const isConfigured = () =>
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

if (isConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Sube un buffer a Cloudinary. Carpeta organizada por unidad.
// Devuelve { url, public_id, bytes, format, resource_type }.
async function subirBuffer(buffer, { unidadId, tipo, nombre }) {
  if (!isConfigured()) {
    throw new Error('Cloudinary no configurado. Pide al admin agregar las variables CLOUDINARY_* en Railway.');
  }
  const folder = `andreu-erp/unidades/u-${unidadId}/${tipo}`;
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'auto',
        use_filename: true,
        unique_filename: true,
        public_id: nombre ? nombre.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) : undefined,
        overwrite: false,
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          bytes: result.bytes,
          format: result.format,
          resource_type: result.resource_type,
        });
      }
    );
    stream.end(buffer);
  });
}

async function eliminar(publicId, resourceType = 'image') {
  if (!isConfigured() || !publicId) return { ok: false, skipped: true };
  try {
    const r = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    return { ok: r.result === 'ok' || r.result === 'not found', result: r.result };
  } catch (e) {
    console.warn('Cloudinary destroy error:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { subirBuffer, eliminar, isConfigured };
