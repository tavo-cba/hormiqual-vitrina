#!/usr/bin/env node
'use strict';

/**
 * Seed idempotente de los items del menú "Laboratorio" para uno o todos los tenants.
 *
 * Inserta `Laboratorios` y `Equipos` como hijos del nodo "Laboratorio" del menú,
 * apuntando a las rutas nuevas (`/calidad/laboratorio/...`). Si los items ya
 * existen (por `ruta`), no hace nada. Si el padre "Laboratorio" no existe en
 * un tenant, lo reporta y sigue con los demás.
 *
 * Uso:
 *   node scripts/seed-menu-laboratorio.js                # todos los tenants
 *   node scripts/seed-menu-laboratorio.js <database>     # solo ese tenant
 *
 * No depende del bootstrap. Diseñado para correrse a mano en dev/prod después
 * del deploy.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const MENU_ITEMS = [
  { nombre: 'Laboratorios', ruta: '/calidad/laboratorio/laboratorios', icono: 'fa-solid fa-flask-vial' },
  { nombre: 'Equipos',      ruta: '/calidad/laboratorio/equipos',      icono: 'fa-solid fa-toolbox' },
];

async function listTenantDbs(rootConn) {
  // Convención del proyecto: bases de datos de tenants comparten un prefijo o
  // se listan en una tabla global. Como fallback, listamos todas las BDs que
  // tengan una tabla `Menu`.
  const [rows] = await rootConn.query(`
    SELECT TABLE_SCHEMA AS db
    FROM information_schema.TABLES
    WHERE TABLE_NAME = 'Menu'
      AND TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')
    ORDER BY TABLE_SCHEMA ASC
  `);
  return rows.map(r => r.db);
}

async function seedTenant(dbName, host, port, user, password) {
  const conn = new Sequelize(dbName, user, password, {
    host, port: Number(port), dialect: 'mysql', logging: false,
  });
  try {
    const [labRows] = await conn.query(
      "SELECT idMenu FROM `Menu` WHERE nombre = 'Laboratorio' AND idMenuPadre IS NOT NULL AND activo = 1 LIMIT 1"
    );
    if (labRows.length === 0) {
      console.log(`  ⚠ ${dbName}: padre "Laboratorio" no encontrado — skip.`);
      return { dbName, status: 'skip-no-parent' };
    }
    const idLab = labRows[0].idMenu;
    let creados = 0, yaExistian = 0;
    for (const it of MENU_ITEMS) {
      const [exist] = await conn.query(
        "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
        { replacements: { ruta: it.ruta } }
      );
      if (exist.length > 0) { yaExistian++; continue; }
      const [maxOrden] = await conn.query(
        "SELECT COALESCE(MAX(orden), 0) AS m FROM `Menu` WHERE idMenuPadre = :idLab",
        { replacements: { idLab } }
      );
      const nextOrden = Number(maxOrden[0].m || 0) + 1;
      await conn.query(
        "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
        "VALUES (:idLab, :nombre, :ruta, :icono, :orden, 1, 'calidad', NOW(), NOW())",
        { replacements: { idLab, nombre: it.nombre, ruta: it.ruta, icono: it.icono, orden: nextOrden } }
      );
      creados++;
    }
    console.log(`  ✔ ${dbName}: padre idMenu=${idLab}, creados=${creados}, yaExistian=${yaExistian}.`);
    return { dbName, status: 'ok', creados, yaExistian, idLab };
  } catch (err) {
    console.error(`  ✗ ${dbName}: ${err.message}`);
    return { dbName, status: 'error', error: err.message };
  } finally {
    await conn.close();
  }
}

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 3306;
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';

  const onlyTenant = process.argv[2];

  // Conexión sin DB específica para listar tenants.
  const rootConn = new Sequelize('', user, password, {
    host, port: Number(port), dialect: 'mysql', logging: false,
  });

  let tenantDbs;
  try {
    if (onlyTenant) {
      tenantDbs = [onlyTenant];
    } else {
      tenantDbs = await listTenantDbs(rootConn);
    }
  } finally {
    await rootConn.close();
  }

  if (tenantDbs.length === 0) {
    console.log('No se encontraron tenants con tabla `Menu`.');
    process.exit(0);
  }

  console.log(`\n→ Seed menú Laboratorio sobre ${tenantDbs.length} tenant(s):\n`);
  const results = [];
  for (const db of tenantDbs) {
    results.push(await seedTenant(db, host, port, user, password));
  }

  // Resumen
  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip-no-parent').length;
  const err = results.filter(r => r.status === 'error').length;
  const totalCreados = results.reduce((acc, r) => acc + (r.creados || 0), 0);
  console.log(`\n──────────────────────────`);
  console.log(`Tenants procesados: ${results.length}`);
  console.log(`  OK:    ${ok}  (items creados: ${totalCreados})`);
  console.log(`  Skip:  ${skip}  (sin padre "Laboratorio")`);
  console.log(`  Error: ${err}`);
  console.log(`──────────────────────────\n`);
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
