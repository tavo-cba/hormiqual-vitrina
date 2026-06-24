'use strict';

/**
 * ensayoTipoSuggestions.js — Deterministic suggestions for new ensayo types
 * based on norma code + material.
 *
 * Source of truth: maps a normalized norma code to a complete suggestion
 * including schemaKey, aplicaA, categoria, perfil defaults, periodicidad, etc.
 *
 * Usage:
 *   const { getSuggestionForNorma } = require('./ensayoTipoSuggestions');
 *   const s = getSuggestionForNorma({ material: 'AGREGADOS', normaCodigo: 'IRAM 1505' });
 *   // => { schemaKey: 'GRANULOMETRIA_1505', aplicaA: ['FINO','GRUESO'], ... }
 */

// ─── Suggestion Table ───────────────────────────────────────
// Key: normalized norma code (uppercase, spaces stripped)
// e.g. "IRAM1505", "IRAM1687-1"

const AGREGADOS_SUGGESTIONS = {
    // ── IRAM 1505 — Granulometría ──
    'IRAM1505': {
        schemaKey: 'GRANULOMETRIA_1505',
        aplicaA: ['FINO', 'GRUESO'],
        categoria: 'fisica',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 6,
        warningDaysDefault: 30,
        codigoSugerido: 'IRAM1505_GRANULOMETRIA',
        nombreSugerido: 'Granulometría',
    },

    // ── IRAM 1520 — Densidad y absorción (fino) ──
    'IRAM1520': {
        schemaKey: 'DENSIDAD_ABSORCION',
        aplicaA: ['FINO'],
        categoria: 'fisica',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 45,
        codigoSugerido: 'IRAM1520_DENSIDAD_ABSORCION',
        nombreSugerido: 'Densidad y absorción (fino)',
    },

    // ── IRAM 1533 — Densidad y absorción (grueso) ──
    'IRAM1533': {
        schemaKey: 'DENSIDAD_ABSORCION',
        aplicaA: ['GRUESO'],
        categoria: 'fisica',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 45,
        codigoSugerido: 'IRAM1533_DENSIDAD_ABSORCION',
        nombreSugerido: 'Densidad y absorción (grueso)',
    },

    // ── IRAM 1532 — Desgaste Los Ángeles ──
    'IRAM1532': {
        schemaKey: 'LOS_ANGELES',
        aplicaA: ['GRUESO'],
        categoria: 'mecanica',
        perfilDefault: 'CORE',
        obligatorioDefault: false,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 45,
        codigoSugerido: 'IRAM1532_LOS_ANGELES',
        nombreSugerido: 'Desgaste Los Ángeles',
    },

    // ── IRAM 1687-1 — Lajosidad ──
    'IRAM1687-1': {
        schemaKey: 'LAJOSIDAD',
        aplicaA: ['GRUESO'],
        categoria: 'forma',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 6,
        warningDaysDefault: 30,
        codigoSugerido: 'IRAM1687_1_LAJOSIDAD',
        nombreSugerido: 'Índice de lajosidad',
    },

    // ── IRAM 1687-2 — Elongación ──
    'IRAM1687-2': {
        schemaKey: 'ELONGACION',
        aplicaA: ['GRUESO'],
        categoria: 'forma',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 6,
        warningDaysDefault: 30,
        codigoSugerido: 'IRAM1687_2_ELONGACION',
        nombreSugerido: 'Índice de elongación',
    },

    // ── IRAM 1540 — Pasa tamiz 200 ──
    'IRAM1540': {
        schemaKey: 'PASA_200',
        aplicaA: ['FINO', 'GRUESO'],
        categoria: 'limpieza',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 6,
        warningDaysDefault: 30,
        codigoSugerido: 'IRAM1674_MATERIAL_FINO_200',
        nombreSugerido: 'Material fino que pasa por tamiz IRAM 75 µm (N.º 200)',
    },

    // ── IRAM 1647 — Norma paraguas con múltiples ensayos ──
    'IRAM1647': {
        schemaKey: 'MATERIAS_CARBONOSAS',
        aplicaA: ['FINO', 'GRUESO'],
        categoria: 'limpieza',
        perfilDefault: 'CORE',
        obligatorioDefault: true,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 60,
        codigoSugerido: 'IRAM1647_MATERIAS_CARBONOSAS',
        nombreSugerido: 'Materias carbonosas',
    },

    // ── IRAM 1682 — Equivalente de arena ──
    'IRAM1682': {
        schemaKey: 'EQ_ARENA',
        aplicaA: ['FINO'],
        categoria: 'limpieza',
        perfilDefault: 'AVANZADO',
        obligatorioDefault: false,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 45,
        codigoSugerido: 'IRAM1682_EQ_ARENA',
        nombreSugerido: 'Equivalente de arena',
    },

    // ── IRAM 1594 — Azul de metileno ──
    'IRAM1594': {
        schemaKey: 'AZUL_METILENO',
        aplicaA: ['FINO'],
        categoria: 'limpieza',
        perfilDefault: 'AVANZADO',
        obligatorioDefault: false,
        periodicidadMesesDefault: 12,
        warningDaysDefault: 45,
        codigoSugerido: 'IRAM1594_AZUL_METILENO',
        nombreSugerido: 'Azul de metileno',
    },
};

const SUGGESTIONS_BY_MATERIAL = {
    AGREGADOS: AGREGADOS_SUGGESTIONS,
    // Future: HORMIGON, CEMENTO, AGUA, etc.
};

// ─── Normalization ──────────────────────────────────────────

/**
 * Normalize a norma code for lookup.
 * "IRAM 1505" → "IRAM1505"
 * "IRAM 1687-1" → "IRAM1687-1"
 * "iram  1520" → "IRAM1520"
 */
const normalizeNormaCodigo = (raw) => {
    if (!raw) return '';
    return raw
        .toUpperCase()
        .replace(/\s+/g, '')      // strip all whitespace
        .replace(/^IRAM(\d)/, 'IRAM$1');  // ensure no space after IRAM
};

// ─── Public API ─────────────────────────────────────────────

/**
 * Get deterministic suggestion for a norma + material combination.
 *
 * @param {{ material: string, normaCodigo: string }} opts
 * @returns {object|null} suggestion or null if no match
 */
const getSuggestionForNorma = ({ material, normaCodigo }) => {
    if (!material || !normaCodigo) return null;
    const table = SUGGESTIONS_BY_MATERIAL[material.toUpperCase()];
    if (!table) return null;

    const key = normalizeNormaCodigo(normaCodigo);
    const suggestion = table[key] || null;
    return suggestion;
};

/**
 * Get all suggestions for a material (used for validation/listing).
 * @param {string} material
 * @returns {object} map of normalizedCode → suggestion
 */
const getAllSuggestionsForMaterial = (material) => {
    return SUGGESTIONS_BY_MATERIAL[(material || '').toUpperCase()] || {};
};

// ─── aplicaA Consistency Warnings ───────────────────────────

/**
 * Check if a norma + aplicaA combination is potentially inconsistent.
 * Returns an array of warning strings (empty = OK).
 *
 * @param {{ normaCodigo: string, material: string, aplicaA: string[] }} opts
 * @returns {string[]} warnings
 */
const getConsistencyWarnings = ({ normaCodigo, material, aplicaA }) => {
    const suggestion = getSuggestionForNorma({ material, normaCodigo });
    if (!suggestion) return [];

    const warnings = [];
    const suggestedSet = new Set(suggestion.aplicaA);
    const actualSet = new Set(aplicaA || []);

    // Check: user has values not in the suggestion
    for (const v of actualSet) {
        if (!suggestedSet.has(v)) {
            warnings.push(
                `"${normaCodigo}" normalmente aplica a ${suggestion.aplicaA.join('+')} pero se incluyó ${v}.`
            );
        }
    }

    // Check: user is missing values from the suggestion
    for (const v of suggestedSet) {
        if (!actualSet.has(v)) {
            warnings.push(
                `"${normaCodigo}" normalmente aplica a ${suggestion.aplicaA.join('+')} pero falta ${v}.`
            );
        }
    }

    return warnings;
};

module.exports = {
    getSuggestionForNorma,
    getAllSuggestionsForMaterial,
    getConsistencyWarnings,
    normalizeNormaCodigo,
    AGREGADOS_SUGGESTIONS,
};
