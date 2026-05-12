#!/usr/bin/env node
// Aplica una migración SQL a la BD apuntada por DATABASE_URL.
// Uso: node scripts/apply_migration.js <archivo.sql>
// Lee credenciales desde el ambiente (DATABASE_URL).

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node scripts/apply_migration.js <archivo.sql>');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL en el ambiente.');
    process.exit(2);
  }

  const sqlPath = path.resolve(file);
  if (!fs.existsSync(sqlPath)) {
    console.error('Archivo no encontrado:', sqlPath);
    process.exit(2);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`→ Conectando a Postgres...`);
  await client.connect();
  console.log(`→ Aplicando ${path.basename(sqlPath)} (${sql.length} bytes)...`);

  try {
    const result = await client.query(sql);
    // pg devuelve array si hubo múltiples statements
    const arr = Array.isArray(result) ? result : [result];
    const lastRows = arr[arr.length - 1].rows;
    console.log('✅ Migración aplicada.');
    if (lastRows && lastRows.length) {
      console.log('Verificación final:');
      console.table(lastRows);
    }
    process.exit(0);
  } catch (e) {
    console.error('❌ ERROR ejecutando SQL:');
    console.error(e.message);
    if (e.position) console.error('Posición:', e.position);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
