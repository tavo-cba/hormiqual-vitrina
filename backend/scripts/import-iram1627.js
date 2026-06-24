#!/usr/bin/env node
/**
 * Importador IRAM 1627:1997 — Curvas granulométricas completas
 *
 * Lee seed-data/iram/iram1627_1997_curvas.json y crea/actualiza:
 *   - FINOS  (Tabla 1): 3 curvas (A MAX_ONLY, B RANGO, C RANGO)
 *   - GRUESOS (Tabla 2): 7 curvas por rango (RANGO con N/A)
 *   - TOTALES (Tablas 3–8): 6 TMN × 3 curvas A/B/C = 18 curvas + 6 sets
 *
 * Uso:
 *   npm run seed:iram1627
 *   node scripts/import-iram1627.js [--tenant=nombre] [--reset]
 *
 * El tenant por defecto es "hormiqual". Para multi-tenant, pasar --tenant=XXX.
 * --reset: borra todo lo importado de esta norma antes de importar.
 * Re-ejecutar es idempotente (upsert por nombre único).
 */

require('dotenv').config();
process.env.DISABLE_CRON = '1';
const { createDbConnection } = require('../src/models');
const { importIRAM1627 } = require('../src/services/importIRAM1627Service');

// ─── Colores consola ────────────────────────────────────
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

// ─── Parse CLI args ────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  // [VITRINA] default al tenant del .env (DEV_TENANT) en vez de 'hormiqual'.
  const opts = { tenant: process.env.DEV_TENANT || 'vitrina', reset: false };
  for (const arg of args) {
    if (arg.startsWith('--tenant=')) opts.tenant = arg.split('=')[1];
    if (arg === '--reset') opts.reset = true;
  }
  return opts;
}

// ═══════════════════════════════════════════════════════
async function main() {
  const opts = parseArgs();

  log.step(`Importador IRAM 1627:1997 — Tenant: ${opts.tenant}`);

  let db;
  try {
    db = await createDbConnection(opts.tenant);
    log.ok(`Conexión DB establecida (${opts.tenant})`);
  } catch (err) {
    log.error(`No se pudo conectar a DB: ${err.message}`);
    process.exit(1);
  }

  try {
    const stats = await importIRAM1627(db, {
      reset: opts.reset,
      onLog: (level, msg) => {
        if (log[level]) log[level](msg);
        else console.log(msg);
      },
    });

    // ─── Summary ───────────────────────────────
    log.step('Resumen');
    console.log(`
  Curvas creadas:      ${c.green}${stats.curvasCreated}${c.reset}
  Curvas actualizadas: ${c.yellow}${stats.curvasUpdated}${c.reset}
  Sets creados:        ${c.green}${stats.setsCreated}${c.reset}
  Sets actualizados:   ${c.yellow}${stats.setsUpdated}${c.reset}
  Puntos totales:      ${stats.pointsCreated}
  Errores:             ${stats.errors.length === 0 ? `${c.green}0${c.reset}` : `${c.red}${stats.errors.length}${c.reset}`}
`);

    log.ok('Importación completada exitosamente.');
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
