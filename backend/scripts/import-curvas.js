#!/usr/bin/env node
/**
 * Importar curvas granulométricas desde JSON
 *
 * Uso:
 *   node scripts/import-curvas.js <archivo.json> [--tenant=nombre] [--reset] [--norma-ref="ASTM C33"]
 *
 * --reset: borra curvas existentes con la misma normaRef antes de importar.
 * --norma-ref: normaRef para filtrar el reset (si no se indica, se toma del JSON).
 */

require('dotenv').config();
process.env.DISABLE_CRON = '1';
const fs = require('fs');
const { createDbConnection } = require('../src/models');
const { importCurvasFromJson } = require('../src/services/curvaExportImportService');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
  dim: '\x1b[2m',
};
const log = {
  info:  (msg) => console.log(`${c.blue}[INFO]${c.reset}  ${msg}`),
  ok:    (msg) => console.log(`${c.green}[OK]${c.reset}    ${msg}`),
  warn:  (msg) => console.log(`${c.yellow}[WARN]${c.reset}  ${msg}`),
  error: (msg) => console.log(`${c.red}[ERROR]${c.reset} ${msg}`),
  step:  (msg) => console.log(`\n${c.cyan}${c.bold}── ${msg} ──${c.reset}`),
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { tenant: 'hormiqual', reset: false, normaRef: null, file: null };
  for (const arg of args) {
    if (arg.startsWith('--tenant=')) opts.tenant = arg.split('=')[1];
    else if (arg === '--reset') opts.reset = true;
    else if (arg.startsWith('--norma-ref=')) opts.normaRef = arg.split('=')[1];
    else if (!arg.startsWith('--')) opts.file = arg;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  if (!opts.file) {
    log.error('Se requiere un archivo JSON como argumento.');
    console.log(`\nUso: node scripts/import-curvas.js <archivo.json> [--tenant=nombre] [--reset] [--norma-ref="ASTM C33"]`);
    process.exit(1);
  }

  log.step(`Importar curvas desde JSON — Tenant: ${opts.tenant}`);

  // Leer archivo
  let payload;
  try {
    const raw = fs.readFileSync(opts.file, 'utf8');
    payload = JSON.parse(raw);
    log.info(`Archivo: ${opts.file} (${payload.curvas?.length || 0} curvas)`);
  } catch (err) {
    log.error(`No se pudo leer "${opts.file}": ${err.message}`);
    process.exit(1);
  }

  let db;
  try {
    db = await createDbConnection(opts.tenant);
    log.ok(`Conexión DB establecida (${opts.tenant})`);
  } catch (err) {
    log.error(`No se pudo conectar a DB: ${err.message}`);
    process.exit(1);
  }

  try {
    // Determinar normaRef para reset
    const normaRef = opts.normaRef || (payload.curvas?.[0]?.normaRef) || null;

    const stats = await importCurvasFromJson(db, payload, {
      reset: opts.reset,
      normaRef,
      onLog: (level, msg) => {
        if (log[level]) log[level](msg);
        else console.log(msg);
      },
    });

    log.step('Resumen');
    console.log(`
  Curvas creadas:      ${c.green}${stats.curvasCreated}${c.reset}
  Curvas actualizadas: ${c.yellow}${stats.curvasUpdated}${c.reset}
  Puntos totales:      ${stats.pointsCreated}
  Errores:             ${stats.errors.length === 0 ? `${c.green}0${c.reset}` : `${c.red}${stats.errors.length}${c.reset}`}
`);

    if (stats.errors.length > 0) {
      log.warn('Errores:');
      for (const e of stats.errors) log.error(`  ${e}`);
    }

    log.ok('Importación completada.');
    return stats;

  } catch (err) {
    log.error(`Error fatal: ${err.message}`);
    log.error(err.stack);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
}

main()
  .then((stats) => process.exit((stats?.errors?.length || 0) > 0 ? 1 : 0))
  .catch((err) => {
    console.error('Unhandled:', err);
    process.exit(1);
  });
