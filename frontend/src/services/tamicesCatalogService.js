/**
 * tamicesCatalogService.js
 *
 * Servicio frontend para consumir el catálogo centralizado de tamices.
 * Hace fetch del endpoint /api/tamices/catalogo UNA sola vez y lo cachea
 * en memoria y sessionStorage.
 *
 * Para consumo en componentes React, usar el hook useTamicesCatalog().
 * Para consumo fuera de React (módulo), usar getTamicesCatalogSync().
 */

import { config } from "../config/config";

/* ═══════════════════════════════════════════════════════════
   Fallback estático (se usa SOLO hasta que se resuelve el fetch).
   Generado a partir del catálogo backend — NO editar manualmente.
   ═══════════════════════════════════════════════════════════ */
const FALLBACK = {
  IRAM: {
    superset: [
      { tamiz: "75 mm", aberturaMm: 75 }, { tamiz: "63 mm", aberturaMm: 63 },
      { tamiz: "53 mm", aberturaMm: 53 }, { tamiz: "50 mm", aberturaMm: 50 },
      { tamiz: "37.5 mm", aberturaMm: 37.5 }, { tamiz: "26.5 mm", aberturaMm: 26.5 },
      { tamiz: "25 mm", aberturaMm: 25 }, { tamiz: "19 mm", aberturaMm: 19 },
      { tamiz: "13.2 mm", aberturaMm: 13.2 }, { tamiz: "12.5 mm", aberturaMm: 12.5 },
      { tamiz: "9.5 mm", aberturaMm: 9.5 }, { tamiz: "4.75 mm", aberturaMm: 4.75 },
      { tamiz: "2.36 mm", aberturaMm: 2.36 }, { tamiz: "1.18 mm", aberturaMm: 1.18 },
      { tamiz: "600 µm", aberturaMm: 0.6 }, { tamiz: "300 µm", aberturaMm: 0.3 },
      { tamiz: "150 µm", aberturaMm: 0.15 }, { tamiz: "75 µm", aberturaMm: 0.075 },
    ],
    standard: [
      { tamiz: "63 mm", aberturaMm: 63 }, { tamiz: "53 mm", aberturaMm: 53 },
      { tamiz: "37.5 mm", aberturaMm: 37.5 }, { tamiz: "26.5 mm", aberturaMm: 26.5 },
      { tamiz: "19 mm", aberturaMm: 19 }, { tamiz: "13.2 mm", aberturaMm: 13.2 },
      { tamiz: "9.5 mm", aberturaMm: 9.5 }, { tamiz: "4.75 mm", aberturaMm: 4.75 },
      { tamiz: "2.36 mm", aberturaMm: 2.36 }, { tamiz: "1.18 mm", aberturaMm: 1.18 },
      { tamiz: "600 µm", aberturaMm: 0.6 }, { tamiz: "300 µm", aberturaMm: 0.3 },
      { tamiz: "150 µm", aberturaMm: 0.15 },
    ],
    alt: [
      { tamiz: "63 mm", aberturaMm: 63 }, { tamiz: "50 mm", aberturaMm: 50 },
      { tamiz: "37.5 mm", aberturaMm: 37.5 }, { tamiz: "25 mm", aberturaMm: 25 },
      { tamiz: "19 mm", aberturaMm: 19 }, { tamiz: "12.5 mm", aberturaMm: 12.5 },
      { tamiz: "9.5 mm", aberturaMm: 9.5 }, { tamiz: "4.75 mm", aberturaMm: 4.75 },
      { tamiz: "2.36 mm", aberturaMm: 2.36 }, { tamiz: "1.18 mm", aberturaMm: 1.18 },
      { tamiz: "600 µm", aberturaMm: 0.6 }, { tamiz: "300 µm", aberturaMm: 0.3 },
      { tamiz: "150 µm", aberturaMm: 0.15 },
    ],
    variantRemap: {
      STD_TO_ALT: { 53: 50, 26.5: 25, 13.2: 12.5 },
      ALT_TO_STD: { 50: 53, 25: 26.5, 12.5: 13.2, 4.8: 4.75, 2.4: 2.36, 13: 13.2, 0.6: 0.6, 0.3: 0.3, 0.15: 0.15 },
    },
    aberturasFino: [9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15],
    aberturasGrueso: [75, 63, 53, 50, 37.5, 26.5, 25, 19, 13.2, 12.5, 9.5, 4.75, 2.36, 1.18],
  },
  ASTM: {
    superset: [
      { tamiz: '4"', aberturaMm: 100 }, { tamiz: '3½"', aberturaMm: 90 },
      { tamiz: '3"', aberturaMm: 75 }, { tamiz: '2½"', aberturaMm: 63 },
      { tamiz: '2"', aberturaMm: 50 }, { tamiz: '1½"', aberturaMm: 37.5 },
      { tamiz: '1"', aberturaMm: 25 }, { tamiz: '¾"', aberturaMm: 19 },
      { tamiz: '½"', aberturaMm: 12.5 }, { tamiz: '⅜"', aberturaMm: 9.5 },
      { tamiz: "N° 4", aberturaMm: 4.75 }, { tamiz: "N° 8", aberturaMm: 2.36 },
      { tamiz: "N° 16", aberturaMm: 1.18 }, { tamiz: "N° 30", aberturaMm: 0.6 },
      { tamiz: "N° 50", aberturaMm: 0.3 }, { tamiz: "N° 100", aberturaMm: 0.15 },
      { tamiz: "N° 200", aberturaMm: 0.075 },
    ],
  },
  TBS_DNV: {
    // Pliego DNV Edición 2017 — 13 tamices. Incluye 5 exclusivos de DNV
    // (31.5, 16, 6.3, 3.35 mm, 425 µm) no presentes en la serie IRAM.
    superset: [
      { tamiz: "37.5 mm", aberturaMm: 37.5 }, { tamiz: "31.5 mm", aberturaMm: 31.5 },
      { tamiz: "25 mm", aberturaMm: 25 }, { tamiz: "19 mm", aberturaMm: 19 },
      { tamiz: "16 mm", aberturaMm: 16 }, { tamiz: "13.2 mm", aberturaMm: 13.2 },
      { tamiz: "12.5 mm", aberturaMm: 12.5 }, { tamiz: "9.5 mm", aberturaMm: 9.5 },
      { tamiz: "6.3 mm", aberturaMm: 6.3 }, { tamiz: "4.75 mm", aberturaMm: 4.75 },
      { tamiz: "3.35 mm", aberturaMm: 3.35 }, { tamiz: "425 µm", aberturaMm: 0.425 },
      { tamiz: "150 µm", aberturaMm: 0.15 },
    ],
    aberturasExclusivas: [31.5, 16, 6.3, 3.35, 0.425],
  },
  helpers: {
    mfAberturas: [75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15],
    monotonicityTolerance: 0.5,
    minTamicesRevisado: 5,
  },
};

/* ═══════════════════════════════════════════════════════════
   Module-level cache
   ═══════════════════════════════════════════════════════════ */
let _catalog = null;
let _fetchPromise = null;

// v2: incluye serie TBS_DNV. Bump de versión invalida caches de navegadores
// que tenían el payload sin TBS_DNV.
const STORAGE_KEY = "tamices-catalog-v2";

/** Intenta recuperar del sessionStorage */
function _loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

/** Guarda en sessionStorage */
function _saveToStorage(data) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore (quota, etc.) */ }
}

/**
 * Fetch del catálogo desde el backend (una sola vez).
 * @returns {Promise<Object>} catálogo con { IRAM, ASTM, helpers }
 */
export async function fetchTamicesCatalog() {
  // Ya en cache
  if (_catalog) return _catalog;

  // SessionStorage
  const stored = _loadFromStorage();
  if (stored) {
    _catalog = stored;
    return _catalog;
  }

  // Deduplicar requests concurrentes
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = (async () => {
    try {
      const resp = await fetch(`${config.backendUrl}/api/tamices/catalogo`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _catalog = data;
      _saveToStorage(data);
      return data;
    } catch (err) {
      console.warn("[tamicesCatalog] Fetch falló, usando fallback:", err.message);
      _catalog = FALLBACK;
      return FALLBACK;
    } finally {
      _fetchPromise = null;
    }
  })();

  return _fetchPromise;
}

/**
 * Acceso sincrónico al catálogo.
 * Retorna el cache si ya se fetcheó, o el FALLBACK si no.
 * Ideal para código que no puede ser async (lookups de constantes).
 */
export function getTamicesCatalogSync() {
  return _catalog || _loadFromStorage() || FALLBACK;
}

/* ═══════════════════════════════════════════════════════════
   Helpers derivados (funciones puras que toman el catálogo)
   ═══════════════════════════════════════════════════════════ */

/** Devuelve la serie IRAM según variante */
export function getIRAMTemplate(cat, variant) {
  return variant === "ALTERNATIVO" ? cat.IRAM.alt : cat.IRAM.standard;
}

/** Filtra tamices de una serie según uso del material */
export function getTamizFilterForUso(cat, uso, serie) {
  if (!uso) return null;
  const pool = uso === "FINO" ? cat.IRAM.aberturasFino
    : uso === "GRUESO" ? cat.IRAM.aberturasGrueso
    : null;
  if (!pool) return null; // TOTAL → sin filtro
  return serie.filter(t => pool.some(a => Math.abs(a - t.aberturaMm) < 0.01)).map(t => t.tamiz);
}

/** Construye lookup tamiz→abertura desde el catálogo */
export function buildTamizAbertura(cat) {
  const map = {};
  const series = [
    ...(cat.IRAM?.superset ?? []),
    ...(cat.ASTM?.superset ?? []),
    ...(cat.TBS_DNV?.superset ?? []),
  ];
  for (const t of series) {
    map[t.tamiz.toLowerCase().trim()] = t.aberturaMm;
  }
  return map;
}
