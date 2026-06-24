#!/usr/bin/env node
'use strict';

/**
 * Seed idempotente del ítem de menú "Muestras de pastón" para uno o todos los
 * tenants.
 *
 * Contexto: las muestras/probetas de pastón viven en la tabla `MuestraPaston`
 * y se crean bien al guardar el pastón, pero la pantalla dedicada
 * (`/calidad/ensayos/muestras-pastones`, componente AdminMuestraPaston) NO
 * tenía ítem de menú, así que no había forma de llegar a ella.
 *
 * Qué hace, por tenant:
 *   1. Busca el nodo padre "Ensayos" (módulo calidad).
 *   2. Inserta el ítem hijo "Muestras de pastón" → /calidad/ensayos/muestras-pastones
 *      si no existe (idempotente por `ruta`). Hereda icono del hermano
 *      "Muestras" si está disponible.
 *   3. Para que lo vean los usuarios NO admin (los admin ven todo el árbol),
 *      copia el permiso `puedeVer` del hermano "Muestras" (idMenu de
 *      /produccion/muestras o /calidad/ensayos/muestras): a cada usuario que
 *      ya puede ver "Muestras" y no tiene permiso del nuevo ítem, le crea la
 *      fila en `PermisoMenu`. También idempotente.
 *
 * Caché: el backend cachea los menús en proceso (TTL 30 min). Tras correr
 * este seed, REINICIAR el backend (o esperar el TTL) para que el ítem
 * aparezca; cualquier mutación de menú desde la app también invalida el caché.
 *
 * Uso:
 *   node scripts/seed-menu-muestras-paston.js                # todos los tenants
 *   node scripts/seed-menu-muestras-paston.js <database>     # solo ese tenant
 *
 * No depende del bootstrap. Pensado para correrse a mano en dev/prod tras el
 * deploy (igual que seed-menu-laboratorio.js).
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const NUEVO = {
  nombre: 'Muestras de pastón',
  ruta: '/calidad/ensayos/muestras-pastones',
  iconoFallback: 'fa-solid fa-vials',
};

async function listTenantDbs(rootConn) {
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
    // 1. Padre "Ensayos" (módulo calidad). Mismo criterio que seed-menu-laboratorio.
    const [padreRows] = await conn.query(
      "SELECT idMenu FROM `Menu` WHERE nombre = 'Ensayos' AND idMenuPadre IS NOT NULL AND activo = 1 LIMIT 1"
    );
    if (padreRows.length === 0) {
      console.log(`  ⚠ ${dbName}: padre "Ensayos" no encontrado — skip.`);
      return { dbName, status: 'skip-no-parent' };
    }
    const idPadre = padreRows[0].idMenu;

    // 2. Hermano "Muestras" (para heredar icono y copiar permisos).
    const [hermanoRows] = await conn.query(
      "SELECT idMenu, icono FROM `Menu` WHERE idMenuPadre = :idPadre AND " +
      "(ruta = '/produccion/muestras' OR ruta = '/calidad/ensayos/muestras' OR nombre = 'Muestras') " +
      "ORDER BY orden ASC LIMIT 1",
      { replacements: { idPadre } }
    );
    const idHermano = hermanoRows.length ? hermanoRows[0].idMenu : null;
    const icono = (hermanoRows.length && hermanoRows[0].icono) ? hermanoRows[0].icono : NUEVO.iconoFallback;

    // 3. Ítem "Muestras de pastón" (idempotente por ruta).
    const [exist] = await conn.query(
      "SELECT idMenu FROM `Menu` WHERE ruta = :ruta LIMIT 1",
      { replacements: { ruta: NUEVO.ruta } }
    );
    let idNuevo;
    let creado = false;
    if (exist.length > 0) {
      idNuevo = exist[0].idMenu;
    } else {
      const [maxOrden] = await conn.query(
        "SELECT COALESCE(MAX(orden), 0) AS m FROM `Menu` WHERE idMenuPadre = :idPadre",
        { replacements: { idPadre } }
      );
      const nextOrden = Number(maxOrden[0].m || 0) + 1;
      const [ins] = await conn.query(
        "INSERT INTO `Menu` (idMenuPadre, nombre, ruta, icono, orden, activo, modulo, createdAt, updatedAt) " +
        "VALUES (:idPadre, :nombre, :ruta, :icono, :orden, 1, 'calidad', NOW(), NOW())",
        { replacements: { idPadre, nombre: NUEVO.nombre, ruta: NUEVO.ruta, icono, orden: nextOrden } }
      );
      idNuevo = ins; // insertId
      creado = true;
    }

    // 4. Permisos: copiar `puedeVer` del hermano "Muestras" a los usuarios que
    //    ya pueden verlo y no tienen permiso del nuevo ítem (idempotente).
    let antes = 0, despues = 0;
    if (idHermano) {
      const [a] = await conn.query(
        "SELECT COUNT(*) AS c FROM `PermisoMenu` WHERE idMenu = :idNuevo",
        { replacements: { idNuevo } }
      );
      antes = Number(a[0].c || 0);
      await conn.query(
        "INSERT INTO `PermisoMenu` (idMenu, idUser, puedeVer, puedeAgregar, puedeEditar, puedeBorrar) " +
        "SELECT :idNuevo, ph.idUser, ph.puedeVer, ph.puedeAgregar, ph.puedeEditar, ph.puedeBorrar " +
        "FROM `PermisoMenu` ph " +
        "WHERE ph.idMenu = :idHermano AND ph.puedeVer = 1 " +
        "AND NOT EXISTS (SELECT 1 FROM `PermisoMenu` pn WHERE pn.idMenu = :idNuevo AND pn.idUser = ph.idUser)",
        { replacements: { idNuevo, idHermano } }
      );
      const [d] = await conn.query(
        "SELECT COUNT(*) AS c FROM `PermisoMenu` WHERE idMenu = :idNuevo",
        { replacements: { idNuevo } }
      );
      despues = Number(d[0].c || 0);
    }
    const permisosCreados = Math.max(0, despues - antes);

    console.log(
      `  ✔ ${dbName}: padre=${idPadre}, item=${idNuevo} ${creado ? '(creado)' : '(ya existía)'}, ` +
      `permisos: +${permisosCreados} nuevos (${despues} usuarios con acceso)` +
      `${idHermano ? '' : ' — sin hermano "Muestras", solo admins lo verán'}.`
    );
    return { dbName, status: 'ok', creado, permisosCreados, usuariosConAcceso: despues, idNuevo };
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

  const rootConn = new Sequelize('', user, password, {
    host, port: Number(port), dialect: 'mysql', logging: false,
  });
  let tenantDbs;
  try {
    tenantDbs = onlyTenant ? [onlyTenant] : await listTenantDbs(rootConn);
  } finally {
    await rootConn.close();
  }

  if (tenantDbs.length === 0) {
    console.log('No se encontraron tenants con tabla `Menu`.');
    process.exit(0);
  }

  console.log(`\n→ Seed menú "Muestras de pastón" sobre ${tenantDbs.length} tenant(s):\n`);
  const results = [];
  for (const db of tenantDbs) {
    results.push(await seedTenant(db, host, port, user, password));
  }

  const ok = results.filter(r => r.status === 'ok').length;
  const skip = results.filter(r => r.status === 'skip-no-parent').length;
  const err = results.filter(r => r.status === 'error').length;
  const totalCreados = results.reduce((a, r) => a + (r.creado ? 1 : 0), 0);
  const totalPerm = results.reduce((a, r) => a + (r.permisosCreados || 0), 0);
  console.log(`\n──────────────────────────`);
  console.log(`Tenants procesados: ${results.length}`);
  console.log(`  OK:    ${ok}  (items creados: ${totalCreados}, permisos copiados: ${totalPerm})`);
  console.log(`  Skip:  ${skip}  (sin padre "Ensayos")`);
  console.log(`  Error: ${err}`);
  console.log(`──────────────────────────`);
  console.log('Recordá REINICIAR el backend (o esperar ~30 min de TTL) para que el caché de menús tome el cambio.\n');
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
