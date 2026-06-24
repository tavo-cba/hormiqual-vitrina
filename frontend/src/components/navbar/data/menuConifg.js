import { PERMISOS } from '../../../context/UserContext';

// [VITRINA] administrarElements removido — módulos Administrar/RRHH/Comercial fuera de alcance.

// [VITRINA] produccionElements removido — módulo Producción fuera de alcance.

// Sesión 2026-05-11: grupo top-level "Reportes" consolidado dentro de
// Calidad → Reportes con sub-grupos Producción / Resistencias (migración
// 20260511b-unify-reportes-en-calidad). Las URLs `/reportes/*` se mantienen
// estables — sólo cambia la jerarquía del menú. El grupo top-level quedó
// soft-deleted (activo=false) en la tabla Menu para rollback opcional.

// Sesión 2026-05-09: removidos "Set Estadístico" (4 ítems) y "Análisis
// Avanzado" (2 ítems). Las rutas /estadisticas/* y /analisis/* nunca
// existieron en routesConfig — las entradas del menú llevaban a 404.
// Reactivar cuando se implementen las páginas (probablemente bajo
// /calidad/estadisticas/* y /calidad/analisis/* para alinear con el
// resto de Calidad).
// [VITRINA] impuestosElements removido — módulo Impuestos fuera de alcance.

// Sesión 2026-05-11 — Configuración consolida sistema + gestión de roles
// por módulo (segundo gate ortogonal al árbol del menú).
//   • General           — preferencias de sistema (/configuracion)
//   • Cuentas de usuario — gestión de usuarios (movido desde Administrar)
//   • Roles (sub-grupo) — un item por módulo, agrupados para no inflar
//     la raíz de Configuración con 7 entradas paralelas. Migración
//     20260511i-agrupar-roles-en-configuracion. Los 4 placeholders (RRHH,
//     Comercial, Producción, Tesorería) apuntan a <EnConstruccion> hasta
//     que cada módulo implemente su pantalla.
const configElements = [
  { title: 'General',                icon: 'fa-solid fa-gear',         path: '/configuracion',                    perm: 'ADMIN' },
  { title: 'Cuentas de usuario',     icon: 'fa-solid fa-user',         path: '/admin/usuarios',                   perm: 'ADMIN' },
  // Sesión 2026-05-11 — Categorías de archivos movido desde Administrar
  // y ruta alineada con su nueva ubicación. URL vieja /admin/categorias/archivos
  // redirige. Migración 20260511t-mover-categorias-archivos-a-configuracion.
  { title: 'Categorías de archivos', icon: 'fa-solid fa-folder-tree',  path: '/configuracion/categorias-archivos', perm: 'ADMIN' },
  // Sesión 2026-05-11: labels aliviados — el padre da contexto "Roles",
  // los children sólo dicen el módulo. tabLabel en routesConfig.js se
  // mantiene como "Roles de *" para que la barra de tabs no se confunda
  // con la tab del módulo homónimo. Migración 20260511k-renombrar-submenu-roles.
  {
    title: 'Administración de Roles',
    icon: 'fa-solid fa-user-shield',
    perm: 'ADMIN',
    subElements: [
      { title: 'Calidad',       icon: 'fa-solid fa-user-shield',        path: '/calidad/roles' },
      // [VITRINA] roles de otros módulos (Flota, Mantenimiento, RRHH, Comercial,
      // Producción, Tesorería) removidos — fuera de alcance.
    ],
  },
];

// ── Calidad ─────────────────────────────────────────────────────
const calidadElements = [
  { title: 'Tablero',       icon: 'fa-solid fa-gauge-high',        path: '/calidad/tablero' },
  // Sesión 2026-05-11: Catálogos (11 items planos) subagrupado en 3 secciones
  // temáticas para reducir densidad visual (migración 20260511d-subagrupar-
  // catalogos-calidad). URLs sin cambios.
  {
    title: 'Catálogos',
    icon: 'fa-solid fa-book',
    subElements: [
      {
        title: 'Materiales y mezclas',
        icon: 'fa-solid fa-cubes-stacked',
        subElements: [
          { title: 'Materiales',             icon: 'fa-solid fa-cubes',         path: '/calidad/catalogos/materiales' },
          { title: 'Curvas granulométricas', icon: 'fa-solid fa-bezier-curve',  path: '/calidad/catalogos/curvas' },
          { title: 'Curvas de cemento',      icon: 'fa-solid fa-industry',      path: '/calidad/catalogos/curvas-cemento' },
          { title: 'Mezclas',                icon: 'fa-solid fa-blender',       path: '/calidad/catalogos/mezclas' },
        ],
      },
      {
        title: 'Dosificación',
        icon: 'fa-solid fa-flask',
        subElements: [
          // Sesión 2026-05-11: "Dosificaciones" → "Catálogo de dosificaciones"
          // para diferenciar del diseñador (Diseño → Diseñador de dosificaciones)
          // y de Admin → "Dosificaciones (legacy)". Migración 20260511f.
          { title: 'Catálogo de dosificaciones', icon: 'fa-solid fa-calculator',  path: '/calidad/catalogos/dosificaciones' },
          { title: 'Parámetros de dosificación', icon: 'fa-solid fa-sliders',     path: '/calidad/catalogos/parametros-motor' },
          { title: 'Factor de ajuste de curva',  icon: 'fa-solid fa-chart-line',  path: '/calidad/catalogos/factor-ajuste-curva' },
        ],
      },
      {
        title: 'Normativos',
        icon: 'fa-solid fa-book-open',
        subElements: [
          { title: 'Normas',                 icon: 'fa-solid fa-book-open',   path: '/calidad/catalogos/normas' },
          { title: 'Ensayos',                icon: 'fa-solid fa-flask-vial',  path: '/calidad/catalogos/ensayos' },
          { title: 'Tipologías de hormigón', icon: 'fa-solid fa-shapes',      path: '/calidad/catalogos/tipologias' },
          { title: 'Evidencias técnicas',    icon: 'fa-solid fa-folder-open', path: '/calidad/catalogos/evidencias-tecnicas' },
        ],
      },
    ],
  },
  {
    title: 'Diseño',
    icon: 'fa-solid fa-compass-drafting',
    subElements: [
      { title: 'Mezclas de agregados', icon: 'fa-solid fa-blender', path: '/calidad/diseno' },
      // Sesión 2026-05-11: "Dosificación" → "Diseñador de dosificaciones"
      // para diferenciar de los otros dos labels homónimos en el menú.
      // Migración 20260511f-renombrar-dosificaciones-menu.
      { title: 'Diseñador de dosificaciones', icon: 'fa-solid fa-calculator',     path: '/calidad/dosificacion-diseno' },
      // Sesión 2026-05-09: agregada al menú (era orphan).
      { title: 'Comparar dosificaciones',     icon: 'fa-solid fa-scale-balanced', path: '/calidad/dosificaciones-comparar' },
      // Sesión 2026-05-27: dosificaciones pendientes de revisión asignadas
      // al usuario logueado. El listado filtra por revisorAsignado en el
      // backend; cualquier usuario puede acceder y verá solo las suyas.
      { title: 'Por revisar',                 icon: 'fa-solid fa-file-signature', path: '/calidad/revisiones-dosificaciones' },
    ],
  },
  {
    title: 'Ensayos',
    icon: 'fa-solid fa-flask-vial',
    subElements: [
      { title: 'Muestras',              icon: 'fa-solid fa-flask',              path: '/calidad/ensayos/muestras' },
      { title: 'Probetas',              icon: 'fa-solid fa-vial-circle-check',  path: '/calidad/ensayos/probetas' },
      // Sesión 2026-05-09: agregadas al submenú Ensayos. Antes existían
      // sólo como rutas (`/calidad/revisiones-ensayos`,
      // `/calidad/placas-elastomero`) sin entrada de menú — accesibles
      // únicamente por URL directa o links internos.
      { title: 'Revisiones de ensayos', icon: 'fa-solid fa-clipboard-check',    path: '/calidad/revisiones-ensayos' },
      // [VITRINA] "Placas de elastómero" removido — fuera de alcance.
    ],
  },
  // Sesión 2026-05-11: "Control" (Carta de Control SPC) y "Set Estadístico"
  // fundidos en un único sub-grupo "Análisis estadístico" (migración
  // 20260511c-fundir-control-en-analisis-estadistico). La URL /calidad/control
  // se mantiene.
  {
    title: 'Análisis estadístico',
    icon: 'fa-solid fa-chart-line',
    subElements: [
      { title: 'Carta de Control',       icon: 'fa-solid fa-clipboard-check', path: '/calidad/control' },
      { title: 'CUSUM',                  icon: 'fa-solid fa-wave-square',     path: '/calidad/estadisticas/cusum' },
      { title: 'Eficiencia del Cemento', icon: 'fa-solid fa-chart-line',      path: '/calidad/estadisticas/eficiencia-cemento' },
    ],
  },
  // Sesión 2026-05-11: Reportes ahora consolida los reportes de producción
  // (antes en grupo top-level) y los de resistencias / endurecido.
  // Migración 20260511b-unify-reportes-en-calidad.
  {
    title: 'Reportes',
    icon: 'fa-solid fa-chart-simple',
    subElements: [
      // [VITRINA] sub-grupos "Producción" y "Resistencias" removidos — sus pantallas
      // (reports/*) están fuera de alcance. Se conserva la Aceptación de obra/lote.
      // Informe consolidado de aceptación de obra/lote (CIRSOC §6.2.3/§6.2.4 + IRAM 1666 §A.7.10).
      { title: 'Aceptación de obra', icon: 'fa-solid fa-stamp', path: '/reportes/aceptacion-lote' },
    ],
  },
  // Sesión 2026-05-11 — sub-grupo "Laboratorio" inspirado en patrón "Lab
  // Management" de LIMS maduros (LabWare, LabVantage, Quadrel). Absorbe
  // Recursos / Piletas / Herramientas que estaban sueltos al final.
  // Migración 20260511s-sub-grupo-laboratorio-en-calidad.
  {
    title: 'Laboratorio',
    icon: 'fa-solid fa-flask',
    subElements: [
      // [VITRINA] "Laboratorios", "Equipos" (recursos de lab) y "Piletas" removidos — fuera de alcance.
      { title: 'Herramientas', icon: 'fa-solid fa-screwdriver', path: '/calidad/herramientas' },
    ],
  },
  { title: 'Aprobaciones', icon: 'fa-solid fa-stamp', path: '/calidad/aprobaciones' },
  // [VITRINA] "Alertas" removido — fuera de alcance.
];

// ── Flota ──────────────────────────────────────────────────────────
// Sesión 2026-05-11 — estructura reorganizada en 3 sub-grupos
// (Inventario / Operación / Mantenimiento) inspirada en sistemas maduros
// de fleet management (Samsara, Fleetio, Geotab). Los children no repiten
// el nombre del padre. Migración 20260511r-reorganizar-menu-flota.
// Geolocker es un sistema de rastreo propio de HormiQual integrado al
// producto; convive con "Rastreo satelital" (RSV, third-party).
// [VITRINA] flotaElements removido — módulo Flota fuera de alcance.

// Grupos del acordeón principal
// [VITRINA] menú recortado al módulo Calidad (TFG). Grupos fuera de alcance
// (Administrar, Producción, Flota, Impuestos) removidos. Sus arrays quedan
// definidos arriba pero sin referenciar.
export const menuGroups = [
  {
    id: 7,
    title: 'Calidad',
    icon: 'fa-solid fa-microscope',
    elements: calidadElements,
    perm: ['ADMIN', 'PROD_WRITE']
  },
  { id: 6, title: 'Configuración', elements: configElements, icon: 'fa-solid fa-gear', perm: ['ADMIN'] },
];
