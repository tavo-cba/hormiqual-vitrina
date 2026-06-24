/**
 * [VITRINA] init-schema.js — crea el esquema de la base del tenant de vitrina.
 *
 * Bloqueante 1: el repo de vitrina NO trae las 394 migraciones de producción,
 * y el arranque normal (createDbConnection) NO ejecuta sequelize.sync(). Este
 * script arma una conexión PROPIA (sin pasar por createDbConnection, que correría
 * runPendingMigrations y fallaría sobre una base vacía) y corre sync() UNA vez
 * para crear todas las tablas a partir de las definiciones de modelos.
 *
 * sync() sin { force } ni { alter }: solo crea las tablas que faltan; es seguro
 * de re-correr (no borra ni altera datos existentes).
 *
 * Uso:  cd backend && node scripts/init-schema.js
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes } = require('sequelize');

const TENANT = process.env.DEV_TENANT || 'vitrina';

// Misma resolución case-insensitive del sufijo que usa createDbConnection.
function envCi(prefix, t) {
  const up = process.env[`${prefix}${t.toUpperCase()}`];
  if (up !== undefined) return up;
  const lo = process.env[`${prefix}${t.toLowerCase()}`];
  if (lo !== undefined) return lo;
  const target = `${prefix}${t}`.toLowerCase();
  for (const k of Object.keys(process.env)) {
    if (k.toLowerCase() === target) return process.env[k];
  }
  return undefined;
}

(async () => {
  const database = envCi('DATABASE_', TENANT);
  const username = envCi('DB_USERNAME_', TENANT);
  const password = envCi('DB_PASSWORD_', TENANT);
  const host = envCi('DB_HOST_', TENANT) || '127.0.0.1';

  if (!database) {
    console.error(`[init-schema] No hay DATABASE_ definido para tenant="${TENANT}". Revisá el .env.`);
    process.exit(1);
  }

  const sequelize = new Sequelize(database, username, password, {
    host,
    dialect: 'mysql',
    logging: false,
  });

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`[init-schema] No se pudo conectar a MySQL (${host}/${database}): ${e.message}`);
    process.exit(1);
  }

  // Cargar TODOS los modelos del directorio (igual que index.js, pero standalone).
  const modelsDir = path.join(__dirname, '..', 'src', 'models');
  const db = {};
  for (const file of fs.readdirSync(modelsDir)) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const full = path.join(modelsDir, file);
    if (!fs.statSync(full).isFile()) continue; // ignora subcarpeta hooks/
    const factory = require(full);
    if (typeof factory !== 'function') continue;
    const model = factory(sequelize, DataTypes);
    db[model.name] = model;
  }

  // Asociaciones (necesario para que sync cree las FKs correctas).
  Object.values(db).forEach((m) => {
    if (typeof m.associate === 'function') m.associate(db);
  });

  const [antesRows] = await sequelize.query('SHOW TABLES');
  const antes = antesRows.length;

  await sequelize.sync(); // sin force ni alter

  const [despuesRows] = await sequelize.query('SHOW TABLES');
  const despues = despuesRows.length;

  console.log(
    `[init-schema] tenant="${TENANT}" db="${database}" | modelos cargados=${Object.keys(db).length} | tablas: antes=${antes} -> despues=${despues} (creadas=${despues - antes})`
  );

  await sequelize.close();
  process.exit(0);
})().catch((e) => {
  console.error('[init-schema] ERROR:', e);
  process.exit(1);
});
