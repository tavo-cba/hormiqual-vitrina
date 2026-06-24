#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Audit menu vs routes — sesión 2026-05-09.
 *
 * Detecta inconsistencias entre el menú lateral (menuConifg.js) y las
 * rutas declaradas (routesConfig.js):
 *
 *   1. BROKEN_LINKS — items del menú con paths que no existen en routes.
 *      El click en el menú lleva a un 404 (o a la ruta catch-all si la hay).
 *
 *   2. SECTION_MISMATCH — paths del menú que no respetan el prefijo de
 *      la sección que los contiene. Ej: item bajo "Calidad" con path
 *      `/produccion/...` (lo que pasaba con probetas/muestras).
 *
 *   3. ORPHAN_ROUTES — rutas en routesConfig sin entrada en el menú.
 *      Algunas son válidas (forms, detalles, redirects). Se reportan a
 *      título informativo, ranking ALTO si parecen pantallas top-level
 *      (sin params, sin "editar/", sin sub-paths).
 *
 * Uso:
 *   node scripts/audit-menu-routes.js          → reporte humano legible
 *   node scripts/audit-menu-routes.js --json   → JSON para CI / parsing
 *
 * Exit code: 0 si no hay BROKEN_LINKS ni SECTION_MISMATCH; 1 si hay alguno.
 * (ORPHAN_ROUTES es informativo y no afecta exit code.)
 *
 * Implementación: parsing por regex, sin ejecutar el código fuente. Esto
 * evita levantar React + el ecosistema de imports del frontend desde un
 * script standalone.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MENU_FILE = path.join(ROOT, 'src/components/navbar/data/menuConifg.js');
const ROUTES_FILE = path.join(ROOT, 'src/components/cover/routesConfig.js');

/* ───────── Mapeo scope → prefijo esperado del path. ─────────
 * Cada array top-level del menú se asocia a un prefijo de URL que sus
 * paths deberían respetar. Si un item bajo `calidadElements` apunta a
 * `/produccion/...` es mismatch (el usuario lo ve "donde no toca"). */
const SCOPE_TO_PREFIX = Object.freeze({
  administrarElements: '/admin',
  produccionElements: '/produccion',
  calidadElements: '/calidad',
  reportesElements: '/reportes',
  estadisticasElements: '/estadisticas',
  analisisElements: '/analisis',
  impuestosElements: '/impuestos',
  configElements: '/configuracion',
});

/* ───────── Excepciones legítimas al SECTION_MISMATCH ─────────
 * Algunos sub-grupos del menú apuntan deliberadamente a paths bajo otra
 * sección. Caso típico: `Calidad → Reportes → ...` donde los reportes
 * son globales bajo `/reportes/*`. Lo declaramos acá para que el audit
 * no los flaguee como mismatch.
 *
 * Cada entrada: el item está dentro de `breadcrumb` Y su path empieza
 * con alguno de `allowedPrefixes` → se acepta. */
const ALLOWED_CROSS_SECTION = [
  // Calidad → Reportes: los reportes son globales bajo /reportes/*.
  { scope: 'calidadElements', breadcrumb: ['Reportes'],          allowedPrefixes: ['/reportes'] },
  { scope: 'calidadElements', breadcrumb: ['Reportes', 'Resistencias'], allowedPrefixes: ['/reportes'] },
];

function isAllowedCrossSection(item) {
  return ALLOWED_CROSS_SECTION.some((rule) => {
    if (rule.scope !== item.scope) return false;
    if (rule.breadcrumb.length !== item.breadcrumb.length) return false;
    if (!rule.breadcrumb.every((b, i) => b === item.breadcrumb[i])) return false;
    return rule.allowedPrefixes.some((p) => item.path.startsWith(p));
  });
}

/* ───────── Parser del menú (regex line-by-line) ─────────
 * Trackeamos:
 *   - currentScope: en qué `const xxxElements = [` estamos.
 *   - breadcrumb: stack de títulos de sub-grupos padre. Ej: un item
 *     dentro de Calidad → Reportes → Resistencias tiene
 *     breadcrumb = ['Reportes', 'Resistencias'].
 *   - lastTitle: el último `title:` visto, que se asocia al próximo
 *     `path:` o `subElements:` del mismo objeto. */
function parseMenuItems(source) {
  const items = [];
  let currentScope = null;
  const breadcrumb = []; // títulos de sub-grupos padre
  let lastTitle = null;

  const lines = source.split(/\r?\n/);
  const arrayStartRe = /^\s*const\s+(\w+Elements)\s*=\s*\[/;
  const titleRe = /title:\s*['"]([^'"]+)['"]/;
  const pathRe = /path:\s*['"]([^'"]+)['"]/;
  const subElementsOpenRe = /subElements:\s*\[/;
  const arrayCloseRe = /^\s*\]\s*,?\s*$/;

  lines.forEach((line, idx) => {
    const startMatch = line.match(arrayStartRe);
    if (startMatch) {
      currentScope = startMatch[1];
      breadcrumb.length = 0;
      lastTitle = null;
      return;
    }
    if (currentScope == null) return;

    const titleMatch = line.match(titleRe);
    if (titleMatch) lastTitle = titleMatch[1];

    if (subElementsOpenRe.test(line)) {
      // Entramos a un nuevo subgrupo. El `lastTitle` capturado en líneas
      // previas (mismo objeto) es el título del padre.
      breadcrumb.push(lastTitle || '(sin título)');
      lastTitle = null;
      return;
    }

    if (arrayCloseRe.test(line)) {
      if (breadcrumb.length > 0) {
        breadcrumb.pop();
      } else {
        currentScope = null;
      }
      return;
    }

    const pathMatch = line.match(pathRe);
    if (pathMatch) {
      items.push({
        scope: currentScope,
        breadcrumb: [...breadcrumb],
        title: lastTitle || '(sin título)',
        path: pathMatch[1],
        line: idx + 1,
      });
      lastTitle = null;
    }
  });

  return items;
}

/* ───────── Parser de rutas ─────────
 * Solo nos interesa el set de paths declarados. */
function parseRoutePaths(source) {
  const re = /path:\s*['"]([^'"]+)['"]/g;
  const set = new Set();
  let m;
  while ((m = re.exec(source)) !== null) {
    set.add(m[1]);
  }
  return set;
}

/* ───────── Match de path con patrones (`:param`, `:param?`) ───────── */
function pathMatchesAny(menuPath, routePaths) {
  if (routePaths.has(menuPath)) return true;
  // Match con patterns: `/foo/:id` debería absorber `/foo/123` solo si
  // estamos chequeando lo contrario (path concreto del menú vs pattern de
  // route). Acá lo común es que el menú tenga paths concretos y las
  // routes tengan patterns. Hacemos match amplio: el path del menú
  // matchea una route si:
  //   - igual literal, o
  //   - es un prefijo de una route con sufijo /:param.
  for (const r of routePaths) {
    if (r === menuPath) return true;
    // Reemplazar /:param y /:param? por wildcard regex
    const regexBody = r
      .replace(/\//g, '\\/')
      .replace(/:[a-zA-Z_]+\?/g, '[^\\/]*')
      .replace(/:[a-zA-Z_]+/g, '[^\\/]+');
    const re = new RegExp(`^${regexBody}$`);
    if (re.test(menuPath)) return true;
  }
  return false;
}

/* ───────── Heurística para flagear orphans relevantes ─────────
 * Las rutas con `:` (params) o que terminan en `editar/`, `nuevo/`,
 * `revisar/` casi siempre son páginas de detalle/edición y no merecen
 * estar en el menú. Las que parecen top-level (sin params, sin sub-segmentos
 * triviales) son las interesantes. */
function isLikelyTopLevel(routePath) {
  if (routePath.includes(':')) return false;
  if (/\/(editar|nuevo|nueva|crear|detalle|revisar|new|edit)\b/i.test(routePath)) return false;
  // Rutas muy específicas de sub-acción raramente son menús.
  return true;
}

/* ───────── Auditoría principal ───────── */
function audit() {
  const menuSrc = fs.readFileSync(MENU_FILE, 'utf8');
  const routesSrc = fs.readFileSync(ROUTES_FILE, 'utf8');
  const menuItems = parseMenuItems(menuSrc);
  const routePaths = parseRoutePaths(routesSrc);

  const broken = [];
  const sectionMismatch = [];
  for (const item of menuItems) {
    if (!pathMatchesAny(item.path, routePaths)) {
      broken.push(item);
    }
    const expected = SCOPE_TO_PREFIX[item.scope];
    if (expected && !item.path.startsWith(expected) && !isAllowedCrossSection(item)) {
      sectionMismatch.push({ ...item, expected });
    }
  }

  // Orphans: rutas que no son referenciadas por ningún path de menú (con
  // resolución de patterns inversa).
  const menuPathSet = new Set(menuItems.map((i) => i.path));
  const orphans = [];
  for (const r of routePaths) {
    // Si alguna entrada del menú apunta exactamente a esta ruta, no es huérfana.
    if (menuPathSet.has(r)) continue;
    // Si la ruta es un pattern (/foo/:id) y hay un item del menú que
    // matchea (`/foo/123`), tampoco huérfana — pero esto es raro: el menú
    // suele apuntar al listado, no al detalle.
    let referenced = false;
    for (const mp of menuPathSet) {
      if (pathMatchesAny(mp, new Set([r]))) { referenced = true; break; }
    }
    if (!referenced) {
      orphans.push({ path: r, likelyTopLevel: isLikelyTopLevel(r) });
    }
  }

  return { menuItems, routePaths: [...routePaths], broken, sectionMismatch, orphans };
}

/* ───────── Output ───────── */
function reportText(result) {
  const out = [];
  out.push('═══ Audit menu ↔ routes (HormiQual) ═══');
  out.push('');

  out.push(`📋 Menú: ${result.menuItems.length} items con path`);
  out.push(`🛣  Routes: ${result.routePaths.length} paths declarados`);
  out.push('');

  out.push(`🔴 BROKEN_LINKS — paths del menú que no existen en routes (${result.broken.length}):`);
  if (result.broken.length === 0) {
    out.push('   (ninguno)');
  } else {
    for (const it of result.broken) {
      out.push(`   ✗ [${it.scope}] "${it.title}" → ${it.path}  (menuConifg.js:${it.line})`);
    }
  }
  out.push('');

  out.push(`🟠 SECTION_MISMATCH — items con path fuera del prefijo esperado (${result.sectionMismatch.length}):`);
  if (result.sectionMismatch.length === 0) {
    out.push('   (ninguno)');
  } else {
    for (const it of result.sectionMismatch) {
      out.push(`   ✗ [${it.scope}] "${it.title}" → ${it.path}  (esperaba prefijo "${it.expected}")  (menuConifg.js:${it.line})`);
    }
  }
  out.push('');

  const topLevelOrphans = result.orphans.filter((o) => o.likelyTopLevel);
  out.push(`🟡 ORPHAN_ROUTES (top-level) — rutas sin entrada en el menú (${topLevelOrphans.length}):`);
  if (topLevelOrphans.length === 0) {
    out.push('   (ninguno)');
  } else {
    for (const o of topLevelOrphans) {
      out.push(`   ? ${o.path}`);
    }
  }
  out.push(`   (omitidas ${result.orphans.length - topLevelOrphans.length} rutas con :param o sub-acciones esperables)`);
  out.push('');

  const blocking = result.broken.length + result.sectionMismatch.length;
  if (blocking === 0) {
    out.push('✅ Sin issues bloqueantes.');
  } else {
    out.push(`❌ ${blocking} issue(s) bloqueante(s) — revisar BROKEN_LINKS y SECTION_MISMATCH.`);
  }
  return out.join('\n');
}

/* ───────── Main ───────── */
function main() {
  const result = audit();
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(reportText(result));
  }
  const blocking = result.broken.length + result.sectionMismatch.length;
  process.exit(blocking > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { audit, parseMenuItems, parseRoutePaths, pathMatchesAny };
