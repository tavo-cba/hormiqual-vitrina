'use strict';

/**
 * Espejo backend del sanitizador de texto para PDF.
 * Usado solo para tests property-based. La fuente canónica del frontend
 * vive en `hormiqual-frontend/src/lib/format/index.js` (export
 * `sanitizePdfText`). Mantener sincronizado — si cambia la regla en
 * frontend, actualizar este mirror.
 */

const PLACEHOLDER = '\u2014'; // em-dash "—"

function sanitizePdfText(str, options = {}) {
  if (str == null) return '';
  if (typeof str === 'number' && !Number.isFinite(str)) return PLACEHOLDER;
  const s = String(str);
  if (s === 'NaN' || s === 'undefined' || s === 'null' || s === 'Infinity' || s === '-Infinity' || s === '[object Object]') {
    return PLACEHOLDER;
  }
  if (options.preserveUnicode) return s;
  return s
    .replace(/\bNaN\b/g, PLACEHOLDER)
    .replace(/\bundefined\b/g, PLACEHOLDER)
    .replace(/\bInfinity\b/g, PLACEHOLDER)
    .replace(/\[object Object\]/g, PLACEHOLDER)
    .replace(/\u00B3/g, '3')
    .replace(/\u00B2/g, '2')
    .replace(/\u2248/g, '~')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u25C4/g, '<<')
    .replace(/\u25BA/g, '>>')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, ' - ')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u00D7/g, 'x')
    .replace(/\u00F7/g, '/')
    .replace(/\u2022/g, '-')
    .replace(/\u2023/g, '>')
    .replace(/\u0394/g, 'D')
    .replace(/\u03B4/g, 'd')
    .replace(/\u03A3/g, 'S')
    .replace(/\u2206/g, 'D')
    .replace(/\u221A/g, 'V')
    .replace(/\u00B7/g, '.')
    .replace(/\u2019/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u0100-\uFFFF]/g, '')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.');
}

module.exports = { sanitizePdfText, PLACEHOLDER };
