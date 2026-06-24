'use strict';

/**
 * tamicesCatalog.js — ÚNICO origen canónico de tamices para todo el sistema.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGLA DE ORO: Si necesitás agregar, quitar o modificar un tamiz, hacelo
 *               ACÁ y sólo acá.  TODOS los servicios, importadores,
 *               controladores y el frontend consumen este catálogo.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/* ──────────────────────────────────────────────────────
   1. SUPERSET IRAM — todos los tamices posibles (18)
      75 mm → 75 µm   (incluye estándar y alternativos)
   ────────────────────────────────────────────────────── */
const TAMICES_IRAM = Object.freeze([
  { tamiz: '75 mm',   aberturaMm: 75 },
  { tamiz: '63 mm',   aberturaMm: 63 },
  { tamiz: '53 mm',   aberturaMm: 53 },     // estándar
  { tamiz: '50 mm',   aberturaMm: 50 },     // alternativo
  { tamiz: '37.5 mm', aberturaMm: 37.5 },
  { tamiz: '26.5 mm', aberturaMm: 26.5 },   // estándar
  { tamiz: '25 mm',   aberturaMm: 25 },     // alternativo
  { tamiz: '19 mm',   aberturaMm: 19 },
  { tamiz: '13.2 mm', aberturaMm: 13.2 },   // estándar
  { tamiz: '12.5 mm', aberturaMm: 12.5 },   // alternativo
  { tamiz: '9.5 mm',  aberturaMm: 9.5 },
  { tamiz: '4.75 mm', aberturaMm: 4.75 },
  { tamiz: '2.36 mm', aberturaMm: 2.36 },
  { tamiz: '1.18 mm', aberturaMm: 1.18 },
  { tamiz: '600 µm',  aberturaMm: 0.6 },
  { tamiz: '300 µm',  aberturaMm: 0.3 },
  { tamiz: '150 µm',  aberturaMm: 0.15 },
  { tamiz: '75 µm',   aberturaMm: 0.075 },
]);

/* ──────────────────────────────────────────────────────
   2. IRAM Estándar / Alternativos — derivados de IRAM superset
   ────────────────────────────────────────────────────── */

/**
 * Reemplazos entre la serie estándar y la alternativa.
 * Cada entrada: { std, alt } donde std.aberturaMm es la estándar
 * y alt.aberturaMm es la alternativa IRAM.
 */
const IRAM_ALT_REPLACEMENTS = Object.freeze([
  { std: { tamiz: '53 mm',   aberturaMm: 53 },   alt: { tamiz: '50 mm',   aberturaMm: 50 } },
  { std: { tamiz: '26.5 mm', aberturaMm: 26.5 },  alt: { tamiz: '25 mm',   aberturaMm: 25 } },
  { std: { tamiz: '13.2 mm', aberturaMm: 13.2 },  alt: { tamiz: '12.5 mm', aberturaMm: 12.5 } },
]);

/** Remapeo rápido de aberturas STD→ALT y ALT→STD */
const VARIANT_REMAP = Object.freeze({
  STD_TO_ALT: Object.freeze({ 53: 50, 26.5: 25, 13.2: 12.5 }),
  ALT_TO_STD: Object.freeze({ 50: 53, 25: 26.5, 12.5: 13.2 }),
});

/** Aberturas exclusivas de la serie alternativa (excluidas en la estándar) */
const _ALT_ONLY = new Set([50, 25, 12.5]);
/** Aberturas exclusivas de la serie estándar (excluidas en la alternativa) */
const _STD_ONLY = new Set([53, 26.5, 13.2]);

/**
 * IRAM Estándar — 13 tamices, Tabla 9 IRAM 1627:1997
 * Excluye: 75 mm, 50 mm, 25 mm, 12.5 mm, 75 µm
 */
const IRAM_STANDARD_GRID = Object.freeze(
  TAMICES_IRAM.filter(t => ![75, 0.075].includes(t.aberturaMm) && !_ALT_ONLY.has(t.aberturaMm))
);

/**
 * IRAM Alternativos — 13 tamices, Tabla 9 IRAM 1627:1997
 * Excluye: 75 mm, 53 mm, 26.5 mm, 13.2 mm, 75 µm
 */
const IRAM_ALT_GRID = Object.freeze(
  TAMICES_IRAM.filter(t => ![75, 0.075].includes(t.aberturaMm) && !_STD_ONLY.has(t.aberturaMm))
);

/**
 * IRAM Grueso — 10 tamices (los gruesos de la serie estándar)
 * Usado por importIRAM1627 para la Tabla 2.
 */
const IRAM_GRUESO_GRID = Object.freeze([
  { tamiz: '63 mm',   aberturaMm: 63 },
  { tamiz: '53 mm',   aberturaMm: 53 },
  { tamiz: '37.5 mm', aberturaMm: 37.5 },
  { tamiz: '26.5 mm', aberturaMm: 26.5 },
  { tamiz: '19 mm',   aberturaMm: 19 },
  { tamiz: '13.2 mm', aberturaMm: 13.2 },
  { tamiz: '9.5 mm',  aberturaMm: 9.5 },
  { tamiz: '4.75 mm', aberturaMm: 4.75 },
  { tamiz: '2.36 mm', aberturaMm: 2.36 },
  { tamiz: '1.18 mm', aberturaMm: 1.18 },
]);

/**
 * Construye la grilla IRAM con reemplazos alternativos aplicados.
 * @param {Array} baseGrid — grilla base (IRAM_STANDARD_GRID o IRAM_GRUESO_GRID)
 * @returns {Array} grilla con 53→50, 26.5→25, 13.2→12.5
 */
function buildAltGrid(baseGrid) {
  return baseGrid.map(t => {
    const rep = IRAM_ALT_REPLACEMENTS.find(r => r.std.aberturaMm === t.aberturaMm);
    return rep ? { ...rep.alt } : { ...t };
  });
}

/**
 * Obtiene la grilla IRAM correcta según uso y serie.
 * @param {'FINO'|'GRUESO'|'TOTAL'} uso
 * @param {'IRAM'|'IRAM_ALT'|'ESTANDAR'|'ALTERNATIVO'} serieTamices
 * @returns {Array<{tamiz,aberturaMm}>}
 */
function getGrid(uso, serieTamices) {
  const isAlt = serieTamices === 'IRAM_ALT' || serieTamices === 'ALTERNATIVO';
  if (uso === 'GRUESO') {
    return isAlt ? buildAltGrid(IRAM_GRUESO_GRID) : IRAM_GRUESO_GRID;
  }
  // FINO y TOTAL usan la grilla estándar (13 tamices)
  return isAlt ? IRAM_ALT_GRID : IRAM_STANDARD_GRID;
}

/**
 * Devuelve la serie completa según variante ('ESTANDAR' o 'ALTERNATIVO').
 * Equivale al viejo getIRAMTemplate() del frontend.
 */
function getIRAMTemplate(variant) {
  return variant === 'ALTERNATIVO' ? IRAM_ALT_GRID : IRAM_STANDARD_GRID;
}

/* ──────────────────────────────────────────────────────
   3. SERIE ASTM  — C33/C33M-08
   ────────────────────────────────────────────────────── */

/** ASTM superset — 17 tamices (4" → N° 200) */
const TAMICES_ASTM = Object.freeze([
  { tamiz: '4"',     aberturaMm: 100 },
  { tamiz: '3½"',    aberturaMm: 90 },
  { tamiz: '3"',     aberturaMm: 75 },
  { tamiz: '2½"',    aberturaMm: 63 },
  { tamiz: '2"',     aberturaMm: 50 },
  { tamiz: '1½"',    aberturaMm: 37.5 },
  { tamiz: '1"',     aberturaMm: 25 },
  { tamiz: '¾"',     aberturaMm: 19 },
  { tamiz: '½"',     aberturaMm: 12.5 },
  { tamiz: '⅜"',     aberturaMm: 9.5 },
  { tamiz: 'N° 4',   aberturaMm: 4.75 },
  { tamiz: 'N° 8',   aberturaMm: 2.36 },
  { tamiz: 'N° 16',  aberturaMm: 1.18 },
  { tamiz: 'N° 30',  aberturaMm: 0.6 },
  { tamiz: 'N° 50',  aberturaMm: 0.3 },
  { tamiz: 'N° 100', aberturaMm: 0.15 },
  { tamiz: 'N° 200', aberturaMm: 0.075 },
]);

/** ASTM Fine aggregate grid — 7 tamices (Section 6.1) */
const ASTM_FINE_GRID = Object.freeze([
  { tamiz: '⅜"',     aberturaMm: 9.5 },
  { tamiz: 'N° 4',   aberturaMm: 4.75 },
  { tamiz: 'N° 8',   aberturaMm: 2.36 },
  { tamiz: 'N° 16',  aberturaMm: 1.18 },
  { tamiz: 'N° 30',  aberturaMm: 0.6 },
  { tamiz: 'N° 50',  aberturaMm: 0.3 },
  { tamiz: 'N° 100', aberturaMm: 0.15 },
]);

/**
 * ASTM Coarse aggregate grid — 14 tamices (Table 2).
 * 4" → N° 50, sin N° 30 (no se usa en Table 2).
 */
const ASTM_COARSE_GRID = Object.freeze([
  { tamiz: '4"',     aberturaMm: 100 },
  { tamiz: '3½"',    aberturaMm: 90 },
  { tamiz: '3"',     aberturaMm: 75 },
  { tamiz: '2½"',    aberturaMm: 63 },
  { tamiz: '2"',     aberturaMm: 50 },
  { tamiz: '1½"',    aberturaMm: 37.5 },
  { tamiz: '1"',     aberturaMm: 25 },
  { tamiz: '¾"',     aberturaMm: 19 },
  { tamiz: '½"',     aberturaMm: 12.5 },
  { tamiz: '⅜"',     aberturaMm: 9.5 },
  { tamiz: 'N° 4',   aberturaMm: 4.75 },
  { tamiz: 'N° 8',   aberturaMm: 2.36 },
  { tamiz: 'N° 16',  aberturaMm: 1.18 },
  { tamiz: 'N° 50',  aberturaMm: 0.3 },
]);

/* ──────────────────────────────────────────────────────
   3b. SERIE TBS-DNV — Pliego DNV Edición 2017
       Serie de 13 tamices que cubre todos los husos
       granulométricos del Pliego (Tablas 9, 10 y 11).
       Incluye 5 tamices exclusivos de DNV (31.5, 16, 6.3,
       3.35 mm, 425 µm) además de los IRAM estándar
       relevantes.
   ────────────────────────────────────────────────────── */

/** TBS-DNV superset — 13 tamices (37.5 mm → 150 µm) */
const TAMICES_TBS_DNV = Object.freeze([
  { tamiz: '37.5 mm', aberturaMm: 37.5 },
  { tamiz: '31.5 mm', aberturaMm: 31.5 },   // DNV — no IRAM
  { tamiz: '25 mm',   aberturaMm: 25 },
  { tamiz: '19 mm',   aberturaMm: 19 },
  { tamiz: '16 mm',   aberturaMm: 16 },     // DNV — no IRAM
  { tamiz: '13.2 mm', aberturaMm: 13.2 },
  { tamiz: '12.5 mm', aberturaMm: 12.5 },
  { tamiz: '9.5 mm',  aberturaMm: 9.5 },
  { tamiz: '6.3 mm',  aberturaMm: 6.3 },    // DNV — no IRAM
  { tamiz: '4.75 mm', aberturaMm: 4.75 },
  { tamiz: '3.35 mm', aberturaMm: 3.35 },   // DNV — no IRAM
  { tamiz: '425 µm',  aberturaMm: 0.425 },  // DNV — no IRAM para agregados
  { tamiz: '150 µm',  aberturaMm: 0.15 },
]);

/**
 * Aberturas exclusivas de la serie TBS-DNV (las 5 que no están en IRAM/ASTM
 * para los contextos típicos de agregados).
 */
const ABERTURAS_TBS_DNV_EXCLUSIVAS = Object.freeze([31.5, 16, 6.3, 3.35, 0.425]);

/* ──────────────────────────────────────────────────────
   4. HELPERS COMPARTIDOS
   ────────────────────────────────────────────────────── */

/**
 * Aberturas para cálculo de Módulo de Finura (MF) — serie ICPA de 10 tamices.
 * Serie normal con relación de abertura = 2, tomando como base el tamiz
 * #100 (150 µm): #100, #50, #30, #16, #8, #4, ⅜", ¾", 1½", 3".
 * En mm: 0.15, 0.30, 0.60, 1.18, 2.36, 4.75, 9.5, 19, 37.5, 75.
 * Nota: 150 mm (6") NO se incluye — el ICPA define 10 tamices con máximo 75 mm (3").
 */
const MF_ABERTURAS = Object.freeze([75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15]);

/** Aberturas válidas para agregado fino (IRAM 1627) */
const ABERTURAS_FINO = Object.freeze([9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15]);

/** Aberturas válidas para agregado grueso — incluye estándar + alternativo */
const ABERTURAS_GRUESO = Object.freeze([75, 63, 53, 50, 37.5, 26.5, 25, 19, 13.2, 12.5, 9.5, 4.75, 2.36, 1.18]);

/**
 * Lookup de tamiz → aberturaMm  (ambas series, case-insensitive).
 * Cargado perezosamente en el primer acceso.
 */
let _tamizAbertura = null;

function getTamizAbertura() {
  if (_tamizAbertura) return _tamizAbertura;
  _tamizAbertura = {};
  for (const t of [...TAMICES_IRAM, ...TAMICES_ASTM]) {
    _tamizAbertura[t.tamiz.toLowerCase().trim()] = t.aberturaMm;
  }
  // Aliases adicionales para import robusto
  const aliases = {
    '4 in': 100, '4in': 100, '100mm': 100, '100 mm': 100,
    '3 1/2"': 90, '3-1/2"': 90, '3 ½"': 90, '3.5"': 90, '3.5 in': 90, '3.5in': 90, '90mm': 90, '90 mm': 90,
    '3 in': 75, '3in': 75, '75mm': 75, '75 mm': 75,
    '2.5 in': 63, '2.5in': 63, '63mm': 63, '63 mm': 63,
    '2 in': 50, '2in': 50, '50mm': 50, '50 mm': 50,
    '1.5 in': 37.5, '1.5in': 37.5, '37.5mm': 37.5, '37.5 mm': 37.5,
    '1 in': 25, '1in': 25, '25mm': 25, '25 mm': 25,
  };
  for (const [alias, mm] of Object.entries(aliases)) {
    if (!_tamizAbertura[alias]) _tamizAbertura[alias] = mm;
  }
  return _tamizAbertura;
}

/**
 * Filtra tamices de una serie según el uso del material.
 * @param {'FINO'|'GRUESO'|'TOTAL'|null} uso
 * @param {Array} serie — array de {tamiz, aberturaMm}
 * @returns {string[]|null} — array de nombres de tamiz filtrados, o null (sin filtro)
 */
function getTamizFilterForUso(uso, serie) {
  if (!uso) return null;
  const pool = uso === 'FINO' ? ABERTURAS_FINO : uso === 'GRUESO' ? ABERTURAS_GRUESO : null;
  if (!pool) return null; // TOTAL → sin filtro
  return serie.filter(t => pool.some(a => Math.abs(a - t.aberturaMm) < 0.01)).map(t => t.tamiz);
}

/**
 * Pares de tamices equivalentes (estándar ↔ alternativo).
 * Cuando ambos existen en un set, sólo se conserva uno.
 */
const EQUIVALENT_SIEVES = Object.freeze([
  [53, 50],       // 53 mm IRAM ↔ 50 mm ASTM (2")
  [26.5, 25],     // 26.5 mm IRAM ↔ 25 mm ASTM (1")
  [13.2, 12.5],   // 13.2 mm IRAM ↔ 12.5 mm ASTM (1/2")
  [13.2, 13],     // 13.2 mm IRAM ↔ 13 mm (reporte CDH)
  [4.75, 4.8],    // 4.75 mm IRAM ↔ 4.8 mm ASTM (#4)
  [2.36, 2.4],    // 2.36 mm IRAM ↔ 2.4 mm ASTM (#8)
  [1.18, 1.2],    // 1.18 mm IRAM ↔ 1.2 mm ASTM (#16)
  [0.600, 0.6],   // 600 um IRAM ↔ 0.6 mm
  [0.300, 0.3],   // 300 um IRAM ↔ 0.3 mm
  [0.150, 0.15],  // 150 um IRAM ↔ 0.15 mm
]);

/**
 * Construye un set final de tamices para graficar/evaluar, eliminando
 * duplicados equivalentes (12.5 vs 13.2, 25 vs 26.5, 50 vs 53).
 *
 * @param {Array<{tamiz,aberturaMm,pasaPct?}>} tamicesConDato - tamices con dato medido
 * @param {Array<{tamiz,aberturaMm}>} tamicesReferencia - tamices de la curva/banda
 * @param {string} [preferSerie='IRAM'] - serie de preferencia para desempatar
 * @returns {Array<{tamiz,aberturaMm,hasData,isRef}>} set unificado, ordenado ascendente
 */
function normalizeSieveSet(tamicesConDato = [], tamicesReferencia = [], preferSerie = 'IRAM') {
  const map = new Map(); // aberturaMm → { tamiz, aberturaMm, hasData, isRef }

  for (const t of tamicesConDato) {
    const ab = Number(t.aberturaMm);
    map.set(ab, { tamiz: t.tamiz, aberturaMm: ab, hasData: true, isRef: false });
  }
  for (const t of tamicesReferencia) {
    const ab = Number(t.aberturaMm);
    if (map.has(ab)) {
      map.get(ab).isRef = true;
    } else {
      map.set(ab, { tamiz: t.tamiz, aberturaMm: ab, hasData: false, isRef: true });
    }
  }

  // Colapsar equivalentes
  for (const [stdAb, altAb] of EQUIVALENT_SIEVES) {
    const hasStd = map.has(stdAb);
    const hasAlt = map.has(altAb);
    if (!hasStd || !hasAlt) continue;

    const std = map.get(stdAb);
    const alt = map.get(altAb);

    if (std.hasData && !alt.hasData) {
      map.delete(altAb);
    } else if (!std.hasData && alt.hasData) {
      map.delete(stdAb);
    } else if (!std.hasData && !alt.hasData) {
      // Ninguno tiene dato — preferir según serie de referencia
      const preferAlt = preferSerie === 'IRAM_ALT' || preferSerie === 'ALTERNATIVO';
      map.delete(preferAlt ? stdAb : altAb);
    }
    // Si ambos tienen dato, se conservan ambos (caso atípico)
  }

  return [...map.values()].sort((a, b) => a.aberturaMm - b.aberturaMm);
}

/** Constantes de validación */
const MONOTONICITY_TOLERANCE = 0.5;
const MIN_TAMICES_REVISADO = 5;

/* ──────────────────────────────────────────────────────
   5. TMN IRAM 1627 Total
   ────────────────────────────────────────────────────── */
const IRAM_1627_TOTAL_TMN = Object.freeze([
  { tmn: 53,   tabla: 'Tabla 3' },
  { tmn: 37.5, tabla: 'Tabla 4' },
  { tmn: 26.5, tabla: 'Tabla 5' },
  { tmn: 19,   tabla: 'Tabla 6' },
  { tmn: 13.2, tabla: 'Tabla 7' },
  { tmn: 9.5,  tabla: 'Tabla 8' },
]);

/* ──────────────────────────────────────────────────────
   6. PAYLOAD para endpoint /api/tamices/catalogo
      (serializable, para consumir desde el frontend)
   ────────────────────────────────────────────────────── */
function buildCatalogoPayload() {
  return {
    IRAM: {
      superset: TAMICES_IRAM,
      standard: IRAM_STANDARD_GRID,
      alt: IRAM_ALT_GRID,
      grueso: IRAM_GRUESO_GRID,
      altReplacements: IRAM_ALT_REPLACEMENTS.map(r => ({
        stdAbertura: r.std.aberturaMm, stdTamiz: r.std.tamiz,
        altAbertura: r.alt.aberturaMm, altTamiz: r.alt.tamiz,
      })),
      variantRemap: VARIANT_REMAP,
      aberturasFino: ABERTURAS_FINO,
      aberturasGrueso: ABERTURAS_GRUESO,
      totalTmn: IRAM_1627_TOTAL_TMN,
    },
    ASTM: {
      superset: TAMICES_ASTM,
      fineGrid: ASTM_FINE_GRID,
      coarseGrid: ASTM_COARSE_GRID,
    },
    TBS_DNV: {
      superset: TAMICES_TBS_DNV,
      aberturasExclusivas: ABERTURAS_TBS_DNV_EXCLUSIVAS,
    },
    helpers: {
      mfAberturas: MF_ABERTURAS,
      monotonicityTolerance: MONOTONICITY_TOLERANCE,
      minTamicesRevisado: MIN_TAMICES_REVISADO,
    },
  };
}

/* ══════════════════════════════════════════════════════
   module.exports
   ══════════════════════════════════════════════════════ */
module.exports = {
  // IRAM
  TAMICES_IRAM,
  IRAM_STANDARD_GRID,
  IRAM_ALT_GRID,
  IRAM_GRUESO_GRID,
  IRAM_ALT_REPLACEMENTS,
  VARIANT_REMAP,
  IRAM_1627_TOTAL_TMN,

  // ASTM
  TAMICES_ASTM,
  ASTM_FINE_GRID,
  ASTM_COARSE_GRID,

  // TBS-DNV (Pliego 2017)
  TAMICES_TBS_DNV,
  ABERTURAS_TBS_DNV_EXCLUSIVAS,

  // Helpers
  MF_ABERTURAS,
  ABERTURAS_FINO,
  ABERTURAS_GRUESO,
  MONOTONICITY_TOLERANCE,
  MIN_TAMICES_REVISADO,

  // Functions
  buildAltGrid,
  getGrid,
  getIRAMTemplate,
  getTamizAbertura,
  getTamizFilterForUso,
  buildCatalogoPayload,
  normalizeSieveSet,
  EQUIVALENT_SIEVES,
};
