#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// Andreu Logistics — Migration Runner
// Corre archivos *.sql en orden. Bootstrap-safe: si detecta que ya
// hay tablas (Andreu YA está en producción), marca todas como
// aplicadas sin re-correrlas.
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const REPO_ROOT = path.join(__dirname, '..', '..');
// Andreu tiene migrations en raíz (migration_*.sql) y opcionalmente en /migrations/
const DIRS = [
  { dir: REPO_ROOT,                          pattern: /^migration.*\.sql$/i },
  { dir: path.join(REPO_ROOT, 'migrations'), pattern: /\.sql$/i },
];

// Para ordenar fase1, fase2, ..., fase10 numéricamente (no lexicográficamente)
function ordenarMigrations(archivos) {
  return archivos.sort((a, b) => {
    // Si ambos tienen 'fase{N}', ordena por N
    const numA = a.match(/fase(\d+)/i);
    const numB = b.match(/fase(\d+)/i);
    if (numA && numB) return parseInt(numA[1], 10) - parseInt(numB[1], 10);
    if (numA && !numB) return -1;
    if (!numA && numB) return 1;
    // Si ambos tienen prefijo numérico (001_xxx.sql), por número
    const lnumA = a.match(/^(\d+)/);
    const lnumB = b.match(/^(\d+)/);
    if (lnumA && lnumB) return parseInt(lnumA[1], 10) - parseInt(lnumB[1], 10);
    // Fallback lexicográfico
    return a.localeCompare(b);
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL no definida. Aborto.');
    process.exit(1);
  }

  const needsSsl = /rlwy\.net|amazonaws|herokuapp|render|supabase/.test(process.env.DATABASE_URL);
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
  });

  try {
    // ── 1) Tabla de control ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        nombre   VARCHAR(255) PRIMARY KEY,
        aplicada TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── 2) Inventariar todas las migrations del repo ──
    const todas = [];
    for (const { dir, pattern } of DIRS) {
      if (!fs.existsSync(dir)) continue;
      const items = fs.readdirSync(dir)
        .filter(f => pattern.test(f) && fs.statSync(path.join(dir, f)).isFile());
      for (const f of items) {
        todas.push({ nombre: f, ruta: path.join(dir, f) });
      }
    }
    todas.sort((a, b) => {
      const arr = ordenarMigrations([a.nombre, b.nombre]);
      return arr[0] === a.nombre ? -1 : 1;
    });

    if (!todas.length) {
      console.log('ℹ️  Sin migrations *.sql encontradas. Nada que correr.');
      await pool.end();
      return;
    }
    console.log(`📋 ${todas.length} migrations descubiertas.`);

    // ── 3) Aplicadas ya ──
    const { rows } = await pool.query('SELECT nombre FROM schema_migrations');
    const aplicadas = new Set(rows.map(r => r.nombre));

    // ── 4) BOOTSTRAP-SAFETY: si tabla 'usuarios' ya existe y schema_migrations
    //         está vacía, asumimos que es un deploy heredado (Andreu en prod).
    //         Marcamos todas las existentes como aplicadas sin correrlas.
    if (aplicadas.size === 0) {
      const { rows: existe } = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'usuarios'
        ) AS yes
      `);
      if (existe[0].yes) {
        console.log(`\n🛡️  Bootstrap: detectada DB existente (tabla 'usuarios' presente).`);
        console.log(`   Marcando las ${todas.length} migrations como aplicadas sin re-ejecutar.`);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const m of todas) {
            await client.query(
              `INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT DO NOTHING`,
              [m.nombre]
            );
          }
          await client.query('COMMIT');
          console.log(`✅ Bootstrap completo. Próximos deploys solo aplicarán nuevas.`);
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
        await pool.end();
        return;
      }
    }

    // ── 5) Aplicar nuevas ──
    let nuevas = 0;
    for (const m of todas) {
      if (aplicadas.has(m.nombre)) {
        console.log(`✓ ${m.nombre} (ya aplicada)`);
        continue;
      }
      const sql = fs.readFileSync(m.ruta, 'utf8');
      console.log(`⏳ Aplicando ${m.nombre}...`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nombre) VALUES ($1)', [m.nombre]);
        await client.query('COMMIT');
        console.log(`✅ ${m.nombre} aplicada`);
        nuevas++;
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`❌ Error en ${m.nombre}: ${e.message}`);
        throw e;
      } finally {
        client.release();
      }
    }

    if (nuevas === 0) {
      console.log(`\n🎉 Schema al día. 0 nuevas, ${todas.length} en total.`);
    } else {
      console.log(`\n🎉 ${nuevas} migration(s) nueva(s) aplicada(s). ${todas.length} en total.`);
    }
  } catch (e) {
    console.error('💥 Migration runner falló:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
