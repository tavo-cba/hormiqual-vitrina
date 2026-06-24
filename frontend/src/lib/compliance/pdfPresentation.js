/**
 * lib/compliance/pdfPresentation — Espejo del módulo de presentación visual
 * canónico (`CATEGORIA_COLORS` en `lib/compliance/index.js`), adaptado a las
 * convenciones de los PDFs HormiQual.
 *
 * RAZÓN:
 * Los PDFs no usan PrimeReact ni Tailwind — usan jsPDF + jspdf-autotable, donde
 * los colores son tuplas `[r, g, b]` y los íconos son caracteres Unicode (no
 * existen `<i className="pi pi-...">` en un PDF). Pero la decisión sobre qué
 * categoría visual le corresponde a un compliance debe ser ÚNICA: si los chips
 * web muestran "APTO CON OBSERVACIONES" verde con info-circle, el PDF debe
 * mostrar el mismo texto y un código de color verde análogo.
 *
 * Este módulo expone los 3 helpers que los PDFs consumen para evitar que cada
 * uno traiga su propio diccionario `categoria → color hex / texto / símbolo`.
 *
 * Diseño: acepta como input cualquiera de los siguientes, mismo orden de
 * preferencia que `CumplimientoBadge` (precedencia documentada acá una sola
 * vez para no duplicar el contexto en cada PDF):
 *
 *   1. `ComplianceResult` canónico (`{ status: 'pass' | 'fail' | ... }`)
 *      → leído directo, máxima fidelidad. Ejercitado por los tests, NO
 *      consumido por ningún PDF en producción todavía: los servicios backend
 *      aún emiten `tipo.cumple` como boolean. El path está incluido para que
 *      cuando el backend evolucione (ej. emitir `passWithObservations` por
 *      un lote con CV alto), el PDF migre con cero código.
 *      ⚠ NO REMOVER aunque parezca código muerto — está locked por
 *      tests pero diseñado para uso futuro.
 *   2. `boolean` (true / false / null)
 *      → mapeo `categoriaDeBoolean`: true → APTO, false → NO APTO,
 *      null/undefined → EVALUACIÓN INCOMPLETA. Soporta el flag legacy
 *      `tipo.cumple` que los servicios viejos siguen emitiendo.
 *   3. `string` con categoría VEREDICTO directa (ej. 'APTO', 'NO APTO')
 *      → pass-through.
 *   4. cualquier otra cosa / null / undefined → EVALUACIÓN INCOMPLETA.
 *
 * El boolean es importante porque hay PDFs (informeResistenciaPdf,
 * agregadoFichaTecnicaPdf) que reciben `tipo.cumple` como boolean del backend
 * sin haber sido migrados al ComplianceResult; el helper acepta ambos para no
 * forzar un cambio de contrato que dispararía ediciones a más servicios.
 *
 * ───────── Nota sobre la categorización display vs vocabulario interno ─────────
 *
 * Cuando un PDF se migra con este helper, NO todos los hits de "cumple"/"CUMPLE"
 * se cambian. Hay 3 categorías de sites en cada PDF:
 *
 *   A) Sites de DISPLAY del veredicto al usuario.
 *      → Estos SÍ migran al helper. Son los que el ingeniero civil que firma
 *      el documento lee directamente. Si dice "CUMPLE / NO CUMPLE" en lugar
 *      de "APTO / NO APTO / APTO CON OBSERVACIONES / etc", el matiz canónico
 *      no se transmite.
 *
 *   B) VOCABULARIO INTERNO de evaluadores que el PDF consume como dato.
 *      → Estos NO migran. Son strings como `rg.bandaAB === 'cumple_con_tolerancia'`
 *      donde 'cumple_con_tolerancia' es la salida del motor granulométrico
 *      (CIRSOC §3.2.4). El motor backend ya está canonificado desde Prompt 2;
 *      este vocabulario es una tag específica del cálculo, no un veredicto.
 *      El PDF lo lee como dato y lo traduce a categoría visual donde
 *      corresponda; el string crudo no es lo que ve el usuario.
 *
 *   C) REGLAS NORMATIVAS escritas como texto fijo.
 *      → Estos NO migran. Son cosas como "Cumplimiento: f'ck ≥ f'c especificada"
 *      (CIRSOC 201) o "Limpieza requerida según IRAM 1512". Es la regla del
 *      pliego, no un veredicto sobre un material específico.
 *
 * Cada PDF migrado debería incluir un comentario al inicio listando qué sites
 * cayeron en cada categoría, así futuros mantenedores entienden por qué
 * algunos hits quedaron intactos.
 */

import { VEREDICTO, getCategoriaVeredicto } from './index';

/* ───────── Paleta RGB canónica ───────── */

/**
 * Colores `[r, g, b]` por categoría. Alineados con `CATEGORIA_COLORS.hex` del
 * módulo web pero expresados como tuplas para `doc.setTextColor(...)` /
 * `doc.setFillColor(...)` / `doc.setDrawColor(...)`.
 *
 * Los hex referenciados son los del helper web — si esos cambian, actualizar
 * acá también (frontend tests + backend smoke detectarían el desalineamiento
 * cuando se compare un PDF con su contraparte web).
 */
export const CATEGORIA_PDF_COLORS = Object.freeze({
  [VEREDICTO.APTO]:                   [22,  163, 74],   // #16a34a — verde "pass"
  [VEREDICTO.APTO_CON_OBSERVACIONES]: [21,  128, 61],   // #15803d — mismo verde, distinto matiz
  [VEREDICTO.APTITUD_CONDICIONADA]:   [217, 119,  6],   // #d97706 — naranja "condicional"
  [VEREDICTO.NO_APTO]:                [220,  38, 38],   // #dc2626 — rojo "fail"
  [VEREDICTO.EVALUACION_INCOMPLETA]:  [29,  78, 216],   // #1d4ed8 — azul "info pendiente"
  [VEREDICTO.APTITUD_NO_DETERMINADA]: [100, 116, 139],  // #64748b — slate (PR2)
  [VEREDICTO.INFORMATIVO]:            [107, 114, 128],  // #6b7280 — gris neutro
  [VEREDICTO.NO_APLICA]:              [156, 163, 175],  // #9ca3af — gris claro
});

/* ───────── Resolver: input ambiguo → categoría canónica ───────── */

/**
 * Acepta los 4 shapes documentados en el module-level JSDoc y retorna una
 * de las 7 categorías VEREDICTO.
 *
 * @param {ComplianceResult|boolean|string|null|undefined} input
 * @returns {string} Una de VEREDICTO.*
 */
export function resolvePdfCategoria(input) {
  // (4) — null/undefined explícito
  if (input == null) return VEREDICTO.EVALUACION_INCOMPLETA;

  // (2) — boolean legacy (tipo.cumple del backend pre-migración)
  if (typeof input === 'boolean') {
    return input ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
  }

  // (3) — string con categoría VEREDICTO directa
  if (typeof input === 'string') {
    if (Object.values(VEREDICTO).includes(input)) return input;
    // Strings de status raw también funcionan (ej. 'pass', 'fail') — los
    // delega a getCategoriaVeredicto.
    return getCategoriaVeredicto(input);
  }

  // (1) — ComplianceResult canónico (objeto con .status)
  if (typeof input === 'object' && input.status) {
    return getCategoriaVeredicto(input);
  }

  return VEREDICTO.EVALUACION_INCOMPLETA;
}

/* ───────── Helpers públicos para los PDFs ───────── */

/**
 * Color RGB `[r, g, b]` para `doc.setTextColor(...c)` / `setFillColor(...c)`.
 *
 * @param {ComplianceResult|boolean|string|null} input
 * @returns {number[]} Tupla [r, g, b]
 */
export function getCategoriaPdfColor(input) {
  const cat = resolvePdfCategoria(input);
  return CATEGORIA_PDF_COLORS[cat] || CATEGORIA_PDF_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
}

/**
 * Etiqueta canónica UPPERCASE para PDFs. Coincide con `VEREDICTO.*`
 * (los valores ya son UPPERCASE en el módulo web). Convención de PDFs
 * formales: las verdictos en mayúsculas para legibilidad y peso visual.
 *
 * @param {ComplianceResult|boolean|string|null} input
 * @returns {string}
 */
export function getCategoriaPdfLabel(input) {
  return resolvePdfCategoria(input);
}

/**
 * Conveniencia: paquete completo `{ categoria, color, label }` para PDFs que
 * necesitan los 3 a la vez (la mayoría).
 *
 * Nota: NO se expone un ícono Unicode. jsPDF + Helvetica no tiene los glifos
 * (✓/⚠/✗/○/ℹ) y los rompe (mojibake); los consumidores que quieran un prefijo
 * visual usan su propio mapa ASCII (ej. `ASCII_PREFIX` en agregadoFichaTecnicaPdf).
 *
 * @param {ComplianceResult|boolean|string|null} input
 * @returns {{ categoria: string, color: number[], label: string }}
 */
export function getCategoriaPdfPresentation(input) {
  const categoria = resolvePdfCategoria(input);
  return {
    categoria,
    color: CATEGORIA_PDF_COLORS[categoria],
    label: categoria,
  };
}
