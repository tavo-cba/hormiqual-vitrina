'use strict';

/**
 * labels.js — Fuente única de verdad para presentación de ComplianceResult.
 *
 * Para cada uno de los 10 estados canónicos define:
 *   - long      Etiqueta larga, en prosa, para PDFs y mensajes formales.
 *   - short     Etiqueta corta, para badges, tablas y celdas.
 *   - severity  Severity token de PrimeReact:
 *                 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'contrast'
 *   - icon      Clase FontAwesome (convención del proyecto, usada en
 *                 EnsayoFormModal, CumplimientoNormativoTable, etc.).
 *   - color     RGB tuple [r, g, b] para uso en PDFs (jsPDF.setTextColor).
 *
 * Todos los renderers (PDFs, componentes UI, generadores de reportes) deben
 * consumir este módulo en lugar de definir sus propios diccionarios. Eso
 * garantiza coherencia visual y un solo lugar para ajustar etiquetas.
 *
 * Notas de diseño:
 *   - passWithObservations usa severity='success' (verde, como pass) porque
 *     el material CUMPLE — la observación es una nota técnica, no una
 *     advertencia. Si lo pintáramos warning, se leería como problema cuando
 *     no lo es.
 *   - conditionalPass usa severity='warning' porque sí hay una restricción
 *     real de uso — el caller necesita validar contexto antes de aceptar.
 *   - notApplicable y notEvaluated ambos usan severity='secondary' (gris):
 *     son "sin información" desde la perspectiva de cumplimiento, no
 *     merecen color. La diferencia entre ellos vive en la etiqueta
 *     (N/A vs Sin evaluar) y en el árbol de veredictos.
 *   - informative tiene short='Sin requisito' (no 'Informativo') a propósito.
 *     Si por error alguien construye un Informative pasándole un `limit`
 *     pensando que va a evaluarse (la canónica ignora `limit` en este
 *     estado), la etiqueta lo deja en evidencia en el render.
 */

const { STATUS, ALL_STATUSES } = require('./ComplianceResult');

const LABELS = Object.freeze({
  [STATUS.PASS]: Object.freeze({
    long:     'Cumple',
    short:    'Cumple',
    severity: 'success',
    icon:     'fa-solid fa-circle-check',
    color:    Object.freeze([22, 163, 74]),
  }),
  [STATUS.PASS_WITH_OBSERVATIONS]: Object.freeze({
    long:     'Cumple con observaciones',
    short:    'Con observación',
    severity: 'success',
    icon:     'fa-solid fa-circle-check',
    color:    Object.freeze([101, 163, 13]),
  }),
  [STATUS.CONDITIONAL_PASS]: Object.freeze({
    long:     'Cumple condicionalmente',
    short:    'Condicional',
    severity: 'warning',
    icon:     'fa-solid fa-triangle-exclamation',
    color:    Object.freeze([217, 119, 6]),
  }),
  [STATUS.FAIL]: Object.freeze({
    long:     'No cumple',
    short:    'No cumple',
    severity: 'danger',
    icon:     'fa-solid fa-circle-xmark',
    color:    Object.freeze([220, 38, 38]),
  }),
  [STATUS.INFORMATIVE]: Object.freeze({
    long:     'Sin requisito normativo',
    short:    'Sin requisito',
    severity: 'info',
    icon:     'fa-solid fa-circle-info',
    color:    Object.freeze([37, 99, 235]),
  }),
  [STATUS.EXPIRED]: Object.freeze({
    long:     'Ensayo vencido',
    short:    'Vencido',
    severity: 'warning',
    icon:     'fa-solid fa-clock',
    color:    Object.freeze([161, 98, 7]),
  }),
  [STATUS.PENDING]: Object.freeze({
    long:     'Ensayo pendiente',
    short:    'Pendiente',
    severity: 'warning',
    icon:     'fa-solid fa-hourglass-half',
    color:    Object.freeze([202, 138, 4]),
  }),
  [STATUS.NOT_APPLICABLE]: Object.freeze({
    long:     'No aplica',
    short:    'N/A',
    severity: 'secondary',
    icon:     'fa-solid fa-minus',
    color:    Object.freeze([156, 163, 175]),
  }),
  [STATUS.INCONCLUSIVE]: Object.freeze({
    long:     'Resultado no concluyente',
    short:    'No concluyente',
    severity: 'warning',
    icon:     'fa-solid fa-circle-question',
    color:    Object.freeze([107, 114, 128]),
  }),
  [STATUS.NOT_EVALUATED]: Object.freeze({
    long:     'No evaluado',
    short:    'Sin evaluar',
    severity: 'secondary',
    icon:     'fa-solid fa-circle-dot',
    color:    Object.freeze([107, 114, 128]),
  }),
});

/* ───────── Helpers ───────── */

function _resolve(r) {
  if (!r || typeof r !== 'object' || !r.status) {
    throw new Error('labels: el resultado no tiene status');
  }
  const entry = LABELS[r.status];
  if (!entry) {
    throw new Error(`labels: status desconocido "${r.status}"`);
  }
  return entry;
}

/** Etiqueta larga en español, para PDFs y prosa. */
const getLongLabel  = (r) => _resolve(r).long;

/** Etiqueta corta para badges y tablas. */
const getShortLabel = (r) => _resolve(r).short;

/** Severity token PrimeReact. */
const getSeverity   = (r) => _resolve(r).severity;

/** Clase FontAwesome para íconos. */
const getIcon       = (r) => _resolve(r).icon;

/** RGB tuple [r, g, b] para PDFs. */
const getColor      = (r) => _resolve(r).color;

/**
 * Devuelve todas las propiedades de presentación de un resultado.
 * Útil para componentes UI que necesitan ícono + label + severity en una sola
 * llamada (ej: badges con tag PrimeReact + ícono + texto).
 *
 * @returns {{long: string, short: string, severity: string, icon: string, color: number[]}}
 */
const getLabels = (r) => _resolve(r);

module.exports = {
  LABELS,
  getLongLabel,
  getShortLabel,
  getSeverity,
  getIcon,
  getColor,
  getLabels,
  // Re-export para conveniencia de consumidores
  ALL_STATUSES,
};
