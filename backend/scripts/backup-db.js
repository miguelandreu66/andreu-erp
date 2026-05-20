#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Backup automático Postgres a JSON.gz
//
// Sin pg_dump — usa node-postgres puro (funciona en Railway sin extras).
// Idéntico patrón que VIVO. Conserva los últimos 14 días.
//
// Uso:
//   node scripts/backup-db.js
//   node scripts/backup-db.js --out=/path
//   node scripts/backup-db.js --solo=ventas
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Pool } = require('pg');

const DEFAULT_OUT = path.join(__dirname, '..', '..', 'backups');
const RETENCION_DIAS = 14;

const args = process.argv.slice(2);
const arg = (name, defecto) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : defecto;
};
const OUT_DIR = arg('out', DEFAULT_OUT);
const SOLO_TABLA = arg('solo', null);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL no definida.');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const needsSsl = /rlwy\.net|amazonaws|herokuapp|render|supabase/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 5,
  });

  const inicio = Date.now();
  try {
    const { rows: tablas } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const objetivo = SOLO_TABLA ? tablas.filter(t => t.table_name === SOLO_TABLA) : tablas;
    if (!objetivo.length) {
      console.error(`❌ Sin tablas para respaldar.`);
      await pool.end();
      process.exit(1);
    }

    const backup = {
      app: 'Andreu Logistics',
      generado_en: new Date().toISOString(),
      database_host: extractHost(process.env.DATABASE_URL),
      total_tablas: objetivo.length,
      tablas: {},
    };

    let totalRows = 0;
    for (const { table_name: t } of objetivo) {
      try {
        // Skip tablas binarias muy pesadas en el backup principal (BYTEA puede explotar el JSON)
        // Para esas usa --solo=viajes_evidencia explícitamente.
        if (!SOLO_TABLA && ['viajes_evidencia', 'unidad_documentos', 'operador_documentos', 'transportista_documentos'].includes(t)) {
          backup.tablas[t] = { skipped: 'BYTEA — usa --solo para respaldar' };
          process.stdout.write(`○ ${t} (skipped, BYTEA)\n`);
          continue;
        }
        const { rows } = await pool.query(`SELECT * FROM "${t}"`);
        backup.tablas[t] = { row_count: rows.length, datos: rows };
        totalRows += rows.length;
        process.stdout.write(`✓ ${t} (${rows.length} rows)\n`);
      } catch (e) {
        backup.tablas[t] = { error: e.message };
        console.warn(`✗ ${t}: ${e.message}`);
      }
    }
    backup.total_rows = totalRows;
    backup.duracion_ms = Date.now() - inicio;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `andreu-${timestamp}.json.gz`;
    const filepath = path.join(OUT_DIR, filename);
    const compressed = zlib.gzipSync(JSON.stringify(backup, null, 2));
    fs.writeFileSync(filepath, compressed);

    const sizeMb = (compressed.length / 1024 / 1024).toFixed(2);
    console.log(`\n💾 Backup guardado: ${filename} (${sizeMb} MB · ${totalRows} rows · ${backup.duracion_ms}ms)`);

    rotarBackups(OUT_DIR);
  } catch (e) {
    console.error('💥 Backup falló:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function rotarBackups(dir) {
  const lim = Date.now() - RETENCION_DIAS * 24 * 60 * 60 * 1000;
  const archivos = fs.readdirSync(dir)
    .filter(f => f.startsWith('andreu-') && f.endsWith('.json.gz'))
    .map(f => ({ f, ts: fs.statSync(path.join(dir, f)).mtimeMs }));
  let borrados = 0;
  archivos.forEach(({ f, ts }) => {
    if (ts < lim) {
      fs.unlinkSync(path.join(dir, f));
      borrados++;
    }
  });
  if (borrados > 0) console.log(`🗑️  Eliminados ${borrados} backup(s) >${RETENCION_DIAS} días.`);
  console.log(`📦 Backups activos: ${archivos.length - borrados}`);
}

function extractHost(url) {
  try { return new URL(url).hostname; } catch { return 'unknown'; }
}

main();
