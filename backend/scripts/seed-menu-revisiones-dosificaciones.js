#!/usr/bin/env node
'use strict';

/**
 * Seed idempotente del ítem de menú "Por revisar (dosificaciones)" para uno o
 * todos los tenants.
 *
 * Contexto: cuando una dosificación pasa a PENDIENTE_REVISION el revisor
 * asignado tiene que poder encontrarla. Hasta esta sesión (2026-05-27) no
 * había forma de hacerlo desde el menú — la única señal era pasiva en el
 * historial. Esta pantalla (`/calidad/revisiones-dosificaciones`) lista las
 * dosificaciones donde el usuario logueado es el revisor asignado y siguen en
 * PENDIENTE_REVISION. El backend filtra por usuario, así que el listado se
 * vacía cuando el revisor aprueba (→ A_PRUEBA) o rechaza (→ BORRADOR).
 *
 * Qué hace, por tenant:
 *   1. Busca el nodo padre "Diseño" (módulo calidad).
 *   2. Inserta el ítem hijo "Por revisar" → /calidad/revisiones-dosificaciones
 *      si no existe (idempotente por `ruta`).
 *   3. Para que lo vean los usuarios NO admin (los admin ven todo el árbol),
 *      copia el permiso `puedeVer` del hermano "Diseñador de dosificaciones"
 *      (idMenu de /calidad/dosificacion-diseno) a cada usuario que ya puede
 *      verlo. Cualquier usuario que pueda diseñar puede ser revisor, así que
 *      el permiso queda alineado. También idempotente.
 *
 * Caché: el backend cachea los menús en proceso (TTL 30 min). Tras correr
 * este seed, REINICIAR el backend (o esperar el TTL) para que el ítem
 * aparezca; cualquier mutación de menú desde la app también invalida el caché.
 *
 * Uso:
 *   node scripts/seed-menu-revisiones-dosificaciones.js                # todos los tenants
 *   node scripts/seed-menu-revisiones-dosificaciones.js <database>     # solo ese tenant
 *
 * Mismo patrón que seed-menu-muestras-paston.js / seed-menu-laboratorio.js.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const NUEVO = {
  nombre: 'Por revisar',
  ruta: '/calidad/revisiones-dosificaciones',
  iconoFallback: 'fa-solid fa-file-signature',
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
    // 1. Padre "Diseño" (módulo calidad).
    const [padreRows] = await conn.query(
      "SELECT idMenu FROM `Menu` WHERE nombre = 'Diseño' AND idMenuPadre IS NOT NULL AND activo = 1 LIMIT 1"
    );
    if (padreRows.length === 0) {
      console.log(`  ⚠ ${dbName}: padre "Diseño" no encontrado — skip.`);
      return { dbName, status: 'skip-no-parent' };
    }
    const idPadre = padreRows[0].idMenu;

    // 2. Hermano "Diseñador de dosificaciones" (heredar icono no aplica acá —
    //    queremos el icono propio fa-file-signature — pero sí usamos sus
    //    permisos `puedeVer` como base para el nuevo ítem).
    const [hermanoRows] = await conn.query(
      "SELECT idMenu FROM `Menu` WHERE idMenuPadre = :idPadre AND " +
      "ruta = '/calidad/dosificacion-diseno' ORDER BY orden ASC LIMIT 1",
      { replacements: { idPadre } }
    );
    const idHermano = hermanoRows.length ? hermanoRows[0].idMenu : null;

    // 3. Ítem "Por revisar" (idempotente por ruta).
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
        { replacements: { idPadre, nombre: NUEVO.nombre, ruta: NUEVO.ruta, icono: NUEVO.iconoFallback, orden: nextOrden } }
      );
      idNuevo = ins;
      creado = true;
    }

    // 4. Permisos: copiar `puedeVer` del hermano "Diseñador de dosificaciones".
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
      `${idHermano ? '' : ' — sin hermano "Diseñador de dosificaciones", solo admins lo verán'}.`
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

  console.log(`\n→ Seed menú "Por revisar (dosificaciones)" sobre ${tenantDbs.length} tenant(s):\n`);
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
  console.log(`  Skip:  ${skip}  (sin padre "Diseño")`);
  console.log(`  Error: ${err}`);
  console.log(`──────────────────────────`);
  console.log('Recordá REINICIAR el backend (o esperar ~30 min de TTL) para que el caché de menús tome el cambio.\n');
  if (err > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
