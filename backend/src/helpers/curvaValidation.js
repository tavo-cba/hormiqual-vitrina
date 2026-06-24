'use strict';

/* ═══════════════════════════════════════════════════════════
   Sanitización y Validación para Curvas Granulométricas
   ═══════════════════════════════════════════════════════════ */

const SPEC_MODES = ['RANGO', 'MAX_ONLY', 'MIN_ONLY', 'OBJETIVO'];

const USO_MAP = {
  'fino':   'FINO',
  'grueso': 'GRUESO',
  'total':  'TOTAL',
  'FINO':   'FINO',
  'GRUESO': 'GRUESO',
  'TOTAL':  'TOTAL',
};

/**
 * Convierte un valor numérico que puede venir como string con "%" o coma decimal.
 * Retorna Number o null.
 *   "50 %"  → 50
 *   "0,6"   → 0.6
 *   ""      → null
 *   null    → null
 *   42      → 42
 */
function sanitizeNumber(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    let s = val.trim();
    if (s === '') return null;
    // Strip trailing "%" and surrounding whitespace
    s = s.replace(/%/g, '').trim();
    if (s === '') return null;
    // Replace comma decimal separator with dot
    s = s.replace(',', '.');
    const n = Number(s);
    return isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Normaliza el enum "uso" aceptando variantes de casing.
 */
function normalizeUso(val) {
  if (!val) return null;
  const key = typeof val === 'string' ? val.trim() : String(val);
  return USO_MAP[key] || USO_MAP[key.toUpperCase()] || null;
}

/**
 * Normaliza specMode aceptando variantes comunes del frontend.
 */
function normalizeSpecMode(val) {
  if (!val) return 'RANGO';
  const map = {
    'RANGO':       'RANGO',
    'rango':       'RANGO',
    'MAX_ONLY':    'MAX_ONLY',
    'max_only':    'MAX_ONLY',
    'Solo máximo': 'MAX_ONLY',
    'Solo maximo': 'MAX_ONLY',
    'solo máximo': 'MAX_ONLY',
    'solo maximo': 'MAX_ONLY',
    'MIN_ONLY':    'MIN_ONLY',
    'min_only':    'MIN_ONLY',
    'Solo mínimo': 'MIN_ONLY',
    'Solo minimo': 'MIN_ONLY',
    'solo mínimo': 'MIN_ONLY',
    'solo minimo': 'MIN_ONLY',
    'OBJETIVO':    'OBJETIVO',
    'objetivo':    'OBJETIVO',
    'Objetivo':    'OBJETIVO',
  };
  return map[val] || val.toUpperCase();
}

/**
 * Sanitiza todo el payload de creación/actualización de curva.
 * Muta y retorna el mismo objeto.
 */
function sanitizeCurvaPayload(data) {
  // specMode
  data.specMode = normalizeSpecMode(data.specMode);

  // uso
  if (data.uso !== undefined) {
    data.uso = normalizeUso(data.uso);
  }

  // tmnMm
  if (data.tmnMm !== undefined) {
    data.tmnMm = sanitizeNumber(data.tmnMm);
  }

  // puntos
  if (Array.isArray(data.puntos)) {
    data.puntos = data.puntos.map((p) => ({
      ...p,
      aberturaMm: sanitizeNumber(p.aberturaMm),
      pasaPct:    sanitizeNumber(p.pasaPct),
      limInfPct:  sanitizeNumber(p.limInfPct),
      limSupPct:  sanitizeNumber(p.limSupPct),
      targetPct:  sanitizeNumber(p.targetPct),
      isNA:       p.isNA === true || p.isNA === 'true',
    }));
  }

  return data;
}

/**
 * Clase de error de validación con status 422.
 */
class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
    this.details = details;
  }
}

/**
 * Valida los puntos de una curva según su specMode.
 * Lanza ValidationError si no cumple.
 *
 * Reglas:
 *   MAX_ONLY  → al menos 2 filas con limSupPct no-null (no exige limInfPct)
 *   MIN_ONLY  → al menos 2 filas con limInfPct no-null (no exige limSupPct)
 *   OBJETIVO  → al menos 2 filas con targetPct no-null
 *   RANGO     → al menos 2 filas con limInfPct y limSupPct (salvo isNA)
 */
function validatePuntosBySpecMode(specMode, puntos) {
  if (!Array.isArray(puntos) || puntos.length === 0) {
    throw new ValidationError('Se requieren al menos 2 puntos para la curva', [
      { row: null, field: 'puntos', reason: 'Array de puntos vacío o ausente' },
    ]);
  }

  const details = [];

  switch (specMode) {
    case 'MAX_ONLY': {
      const validRows = puntos.filter((p, i) => {
        if (p.isNA) return false;
        if (p.limSupPct === null || p.limSupPct === undefined) {
          details.push({ row: i, field: 'limSupPct', reason: 'limSupPct requerido para MAX_ONLY' });
          return false;
        }
        return true;
      });
      // Only require that at least 2 rows have limSupPct; individual nulls are warnings, not errors
      // Keep only the error if we don't have enough valid rows
      if (validRows.length < 2) {
        throw new ValidationError('MAX_ONLY requiere al menos 2 puntos con limSupPct', details);
      }
      // Clear individual row details if we have enough valid rows (those are optional warnings)
      break;
    }
    case 'MIN_ONLY': {
      const validRows = puntos.filter((p, i) => {
        if (p.isNA) return false;
        if (p.limInfPct === null || p.limInfPct === undefined) {
          details.push({ row: i, field: 'limInfPct', reason: 'limInfPct requerido para MIN_ONLY' });
          return false;
        }
        return true;
      });
      if (validRows.length < 2) {
        throw new ValidationError('MIN_ONLY requiere al menos 2 puntos con limInfPct', details);
      }
      break;
    }
    case 'OBJETIVO': {
      const validRows = puntos.filter((p, i) => {
        if (p.isNA) return false;
        if (p.targetPct === null || p.targetPct === undefined) {
          details.push({ row: i, field: 'targetPct', reason: 'targetPct requerido para OBJETIVO' });
          return false;
        }
        return true;
      });
      if (validRows.length < 2) {
        throw new ValidationError('OBJETIVO requiere al menos 2 puntos con targetPct', details);
      }
      break;
    }
    case 'RANGO':
    default: {
      const nonNA = puntos.filter(p => !p.isNA);
      nonNA.forEach((p, i) => {
        const originalIdx = puntos.indexOf(p);
        if (p.limInfPct === null || p.limInfPct === undefined) {
          details.push({ row: originalIdx, field: 'limInfPct', reason: 'limInfPct requerido para RANGO (fila no N/A)' });
        }
        if (p.limSupPct === null || p.limSupPct === undefined) {
          details.push({ row: originalIdx, field: 'limSupPct', reason: 'limSupPct requerido para RANGO (fila no N/A)' });
        }
      });
      const fullyValid = nonNA.filter(p =>
        p.limInfPct !== null && p.limInfPct !== undefined &&
        p.limSupPct !== null && p.limSupPct !== undefined
      );
      if (fullyValid.length < 2) {
        throw new ValidationError('RANGO requiere al menos 2 puntos con limInfPct y limSupPct', details);
      }
      break;
    }
  }
}

module.exports = {
  sanitizeNumber,
  normalizeUso,
  normalizeSpecMode,
  sanitizeCurvaPayload,
  validatePuntosBySpecMode,
  ValidationError,
  SPEC_MODES,
};
