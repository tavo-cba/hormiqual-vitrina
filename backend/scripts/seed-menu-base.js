/**
 * [VITRINA] seed-menu-base.js — siembra el ÁRBOL BASE de menús de la vertical Calidad.
 *
 * El navbar es BD-driven (GET /api/menus/user lee la tabla Menu). En produccion ese
 * arbol se cargo a mano por la UI de admin de menus; no hay seed versionado. Este script
 * crea el arbol minimo de la vitrina, derivado del menuConifg.js YA RECORTADO del frontend,
 * incluyendo SOLO items cuya ruta existe en routesConfig.js (cruce de verificacion).
 *
 * Para un usuario is_admin, getMenusByUser devuelve el arbol completo SIN depender de
 * PermisoMenu, por lo que NO se siembra PermisoMenu.
 *
 * Items OMITIDOS por apuntar a rutas recortadas (fuera de alcance):
 *   - Configuracion > "Cuentas de usuario"      (/admin/usuarios — AdminUsers excluido)
 *   - Configuracion > "Categorias de archivos"  (/configuracion/categorias-archivos — excluido)
 *   - Calidad > Analisis estadistico > "Eficiencia del Cemento"
 *                                                (/calidad/estadisticas/eficiencia-cemento —
 *                                                 componente en reports/, excluido)
 *
 * Idempotente: busca por (nombre, idMenuPadre) antes de insertar; re-correr no duplica.
 * Requiere el esquema creado (init-schema) y la conexion del tenant.
 *
 * Uso:  cd backend && node scripts/seed-menu-base.js
 */
require('dotenv').config();
const { createDbConnection } = require('../src/models');

const TENANT = process.env.DEV_TENANT || 'vitrina';

// Árbol espejo del menuConifg.js recortado (solo pantallas vivas).
// Cada nodo: { nombre, icono, ruta?, children? }. ruta null = grupo/sub-grupo.
const TREE = [
  {
    nombre: 'Calidad', icono: 'fa-solid fa-microscope', ruta: null, modulo: 'calidad',
    children: [
      { nombre: 'Tablero', icono: 'fa-solid fa-gauge-high', ruta: '/calidad/tablero' },
      {
        nombre: 'Catálogos', icono: 'fa-solid fa-book', ruta: null,
        children: [
          {
            nombre: 'Materiales y mezclas', icono: 'fa-solid fa-cubes-stacked', ruta: null,
            children: [
              { nombre: 'Materiales',             icono: 'fa-solid fa-cubes',        ruta: '/calidad/catalogos/materiales' },
              { nombre: 'Curvas granulométricas', icono: 'fa-solid fa-bezier-curve', ruta: '/calidad/catalogos/curvas' },
              { nombre: 'Curvas de cemento',      icono: 'fa-solid fa-industry',     ruta: '/calidad/catalogos/curvas-cemento' },
              { nombre: 'Mezclas',                icono: 'fa-solid fa-blender',      ruta: '/calidad/catalogos/mezclas' },
            ],
          },
          {
            nombre: 'Dosificación', icono: 'fa-solid fa-flask', ruta: null,
            children: [
              { nombre: 'Catálogo de dosificaciones', icono: 'fa-solid fa-calculator', ruta: '/calidad/catalogos/dosificaciones' },
              { nombre: 'Parámetros de dosificación', icono: 'fa-solid fa-sliders',    ruta: '/calidad/catalogos/parametros-motor' },
              { nombre: 'Factor de ajuste de curva',  icono: 'fa-solid fa-chart-line', ruta: '/calidad/catalogos/factor-ajuste-curva' },
            ],
          },
          {
            nombre: 'Normativos', icono: 'fa-solid fa-book-open', ruta: null,
            children: [
              { nombre: 'Normas',                 icono: 'fa-solid fa-book-open',   ruta: '/calidad/catalogos/normas' },
              { nombre: 'Ensayos',                icono: 'fa-solid fa-flask-vial',  ruta: '/calidad/catalogos/ensayos' },
              { nombre: 'Tipologías de hormigón', icono: 'fa-solid fa-shapes',      ruta: '/calidad/catalogos/tipologias' },
              { nombre: 'Evidencias técnicas',    icono: 'fa-solid fa-folder-open', ruta: '/calidad/catalogos/evidencias-tecnicas' },
            ],
          },
        ],
      },
      {
        nombre: 'Diseño', icono: 'fa-solid fa-compass-drafting', ruta: null,
        children: [
          { nombre: 'Mezclas de agregados',       icono: 'fa-solid fa-blender',        ruta: '/calidad/diseno' },
          { nombre: 'Diseñador de dosificaciones', icono: 'fa-solid fa-calculator',     ruta: '/calidad/dosificacion-diseno' },
          { nombre: 'Comparar dosificaciones',     icono: 'fa-solid fa-scale-balanced', ruta: '/calidad/dosificaciones-comparar' },
          { nombre: 'Por revisar',                 icono: 'fa-solid fa-file-signature', ruta: '/calidad/revisiones-dosificaciones' },
        ],
      },
      {
        nombre: 'Ensayos', icono: 'fa-solid fa-flask-vial', ruta: null,
        children: [
          { nombre: 'Muestras',              icono: 'fa-solid fa-flask',             ruta: '/calidad/ensayos/muestras' },
          { nombre: 'Probetas',              icono: 'fa-solid fa-vial-circle-check', ruta: '/calidad/ensayos/probetas' },
          { nombre: 'Revisiones de ensayos', icono: 'fa-solid fa-clipboard-check',   ruta: '/calidad/revisiones-ensayos' },
          { nombre: 'Placas de elastómero',  icono: 'fa-solid fa-square',            ruta: '/calidad/placas-elastomero' },
        ],
      },
      {
        nombre: 'Análisis estadístico', icono: 'fa-solid fa-chart-line', ruta: null,
        children: [
          { nombre: 'Carta de Control', icono: 'fa-solid fa-clipboard-check', ruta: '/calidad/control' },
          { nombre: 'CUSUM',            icono: 'fa-solid fa-wave-square',     ruta: '/calidad/estadisticas/cusum' },
          // "Eficiencia del Cemento" OMITIDO (ruta recortada — componente en reports/).
        ],
      },
      {
        nombre: 'Reportes', icono: 'fa-solid fa-chart-simple', ruta: null,
        children: [
          {
            nombre: 'Producción', icono: 'fa-solid fa-industry', ruta: null,
            children: [
              { nombre: 'Asentamientos',    icono: 'fa-solid fa-arrow-down-wide-short', ruta: '/reportes/asentamientos' },
              { nombre: 'Aire Incorporado', icono: 'fa-solid fa-wind',                  ruta: '/reportes/aire' },
              { nombre: 'Temperatura',      icono: 'fa-solid fa-temperature-high',      ruta: '/reportes/temperatura' },
              { nombre: 'Muestras frescas', icono: 'fa-solid fa-droplet',               ruta: '/reportes/muestras-frescas' },
            ],
          },
          {
            nombre: 'Resistencias', icono: 'fa-solid fa-shield', ruta: null,
            children: [
              { nombre: 'Reportes de resistencia', icono: 'fa-solid fa-file-lines', ruta: '/reportes/resistencias/reportes' },
              { nombre: 'Por edad de diseño',      icono: 'fa-solid fa-shield',     ruta: '/reportes/resistencias/edad-diseno' },
              { nombre: 'Listado de probetas',     icono: 'fa-solid fa-list',       ruta: '/reportes/probetas' },
            ],
          },
          { nombre: 'Aceptación de obra', icono: 'fa-solid fa-stamp', ruta: '/reportes/aceptacion-lote' },
          // CU8 — Informe técnico configurable + preview PDF.
          { nombre: 'Informes', icono: 'fa-solid fa-file-pdf', ruta: '/calidad/informes' },
        ],
      },
      {
        nombre: 'Laboratorio', icono: 'fa-solid fa-flask', ruta: null,
        children: [
          { nombre: 'Herramientas', icono: 'fa-solid fa-screwdriver', ruta: '/calidad/herramientas' },
        ],
      },
      { nombre: 'Aprobaciones', icono: 'fa-solid fa-stamp', ruta: '/calidad/aprobaciones' },
    ],
  },
  {
    nombre: 'Configuración', icono: 'fa-solid fa-gear', ruta: null, modulo: 'configuracion',
    children: [
      { nombre: 'General', icono: 'fa-solid fa-gear', ruta: '/configuracion' },
      { nombre: 'Preferencias', icono: 'fa-solid fa-sliders', ruta: '/configuracion/preferencias' },
      { nombre: 'Cuentas de usuario', icono: 'fa-solid fa-users', ruta: '/admin/usuarios' },
      // "Cuentas de usuario" y "Categorías de archivos" OMITIDOS (rutas recortadas).
      {
        nombre: 'Administración de Roles', icono: 'fa-solid fa-user-shield', ruta: null,
        children: [
          { nombre: 'Calidad', icono: 'fa-solid fa-user-shield', ruta: '/calidad/roles' },
        ],
      },
    ],
  },
];

let created = 0;
let existed = 0;

async function insertNode(db, node, parentId, orden, moduloHeredado) {
  const modulo = node.modulo || moduloHeredado || null;
  let row = await db.Menu.findOne({ where: { nombre: node.nombre, idMenuPadre: parentId } });
  if (!row) {
    row = await db.Menu.create({
      nombre: node.nombre,
      ruta: node.ruta || null,
      icono: node.icono || null,
      idMenuPadre: parentId,
      orden,
      activo: true,
      modulo,
    });
    created++;
    console.log(`  + ${'  '.repeat((node.__depth || 0))}${node.nombre}${node.ruta ? ' → ' + node.ruta : ''} (idMenu=${row.idMenu})`);
  } else {
    existed++;
  }
  if (Array.isArray(node.children)) {
    let i = 0;
    for (const child of node.children) {
      child.__depth = (node.__depth || 0) + 1;
      await insertNode(db, child, row.idMenu, i++, modulo);
    }
  }
}

(async () => {
  const db = await createDbConnection(TENANT);
  console.log(`[seed-menu-base] tenant="${TENANT}" — sembrando árbol de menús de la vertical...`);
  let i = 0;
  for (const grupo of TREE) {
    grupo.__depth = 0;
    await insertNode(db, grupo, null, i++, grupo.modulo || null);
  }
  console.log(`[seed-menu-base] Listo. Menús creados: ${created} | ya existían: ${existed}.`);
  console.log('[seed-menu-base] (No se sembró PermisoMenu: el admin ve todo el árbol vía getMenusByUser.)');
  process.exit(0);
})().catch((e) => {
  console.error('[seed-menu-base] ERROR:', e);
  process.exit(1);
});
