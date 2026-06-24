'use strict';

/**
 * NormRef — referencia normativa estructurada (P0.15 / P1.13 / v4 audit).
 *
 * Reemplaza strings sueltos como "CIRSOC 200-2024 §3.2.3.3 Tabla 3.4" o
 * "Normativa CIRSOC/IRAM" (vago, mal atribuido) por un objeto con:
 *   - standard:     constante del catálogo (IRAM_1627, CIRSOC_200_2024, ...)
 *   - clause:       numeral exacto dentro de la norma
 *   - version:      año de la versión vigente citada
 *   - bindingness:  'mandatory' | 'recommended' | 'informative'
 *
 * El campo `bindingness` es clave porque las normas IRAM y CIRSOC suelen
 * regular el mismo punto con criterios ligeramente distintos. En obra
 * estructural argentina, CIRSOC prevalece (es un reglamento nacional);
 * IRAM es referencia complementaria. El renderer presenta "mandatory"
 * con jerarquía visual destacada.
 *
 * Origen del fix: la cita "Solo H ≤ 20" venía marcada como "Normativa
 * CIRSOC/IRAM" sin precisar y sin la condición adicional de
 * §3.2.3.2 f) CIRSOC (estudio de laboratorio o antecedentes de obra).
 */

/**
 * Catálogo de normas que el sistema cita.
 * Agregar acá antes que en cualquier NormRef ad-hoc.
 */
const STANDARD = Object.freeze({
  IRAM_1505: 'IRAM 1505',
  IRAM_1512: 'IRAM 1512',
  IRAM_1525: 'IRAM 1525',
  IRAM_1531: 'IRAM 1531',
  IRAM_1532: 'IRAM 1532',
  IRAM_1540: 'IRAM 1540',
  IRAM_1601: 'IRAM 1601',
  IRAM_1627: 'IRAM 1627',
  IRAM_1647: 'IRAM 1647',
  IRAM_1674: 'IRAM 1674',
  IRAM_1682: 'IRAM 1682',
  IRAM_1687: 'IRAM 1687',
  IRAM_1882: 'IRAM 1882',
  CIRSOC_200_2024: 'CIRSOC 200:2024',
});

/**
 * Niveles de obligatoriedad para presentación y lógica:
 *   mandatory:    reglamento vinculante para obra estructural (CIRSOC)
 *   recommended:  norma IRAM que complementa el reglamento
 *   informative:  guía o referencia bibliográfica sin fuerza normativa
 */
const BINDINGNESS = Object.freeze({
  MANDATORY: 'mandatory',
  RECOMMENDED: 'recommended',
  INFORMATIVE: 'informative',
});

/**
 * Construye una NormRef. Hace defensive freeze para evitar mutación.
 *
 * @param {Object} params
 * @param {string} params.standard - usar STANDARD.* para evitar typos
 * @param {string} params.clause - numeral, ej "§3.2.3.2 f)" o "Tabla 3.4"
 * @param {number} [params.version] - año de la versión citada
 * @param {string} [params.bindingness=MANDATORY] - default mandatory
 * @param {string} [params.text] - resumen breve del texto normativo
 */
function ref({ standard, clause, version, bindingness = BINDINGNESS.MANDATORY, text } = {}) {
  if (!standard) throw new Error('NormRef.ref: standard requerido');
  if (!clause) throw new Error('NormRef.ref: clause requerido');
  return Object.freeze({ standard, clause, version: version || null, bindingness, text: text || null });
}

/* ════════════════════════════════════════════════════════════════════════
   NormRefs precanonizadas para las reglas citadas con frecuencia.
   Centralizar acá evita inconsistencias entre módulos.
   ════════════════════════════════════════════════════════════════════════ */

const NORM_REFS = Object.freeze({
  // ── IRAM 1627 — bandas granulométricas finos ──
  IRAM_1627_3_2_1: ref({
    standard: STANDARD.IRAM_1627, clause: '§3.2.1', version: 1997,
    bindingness: BINDINGNESS.RECOMMENDED,
    text: 'Granulometría continua dentro de los límites A y B (banda A-B).',
  }),
  IRAM_1627_3_2_2: ref({
    standard: STANDARD.IRAM_1627, clause: '§3.2.2', version: 1997,
    bindingness: BINDINGNESS.RECOMMENDED,
    text: 'El agregado fino puede obtenerse por mezcla de dos o más arenas.',
  }),
  IRAM_1627_3_2_3: ref({
    standard: STANDARD.IRAM_1627, clause: '§3.2.3', version: 1997,
    bindingness: BINDINGNESS.RECOMMENDED,
    text: 'Reducción de límites A en tamices 300 y 150 µm cuando se cumplen condiciones de aire/cemento/aditivo mineral.',
  }),
  IRAM_1627_3_2_4: ref({
    standard: STANDARD.IRAM_1627, clause: '§3.2.4', version: 1997,
    bindingness: BINDINGNESS.RECOMMENDED,
    text: 'Tolerancia ≤10 pp absoluto sobre curva B en tamices 1,18 / 0,600 / 0,300 mm (suma).',
  }),
  IRAM_1627_3_2_5: ref({
    standard: STANDARD.IRAM_1627, clause: '§3.2.5', version: 1997,
    bindingness: BINDINGNESS.RECOMMENDED,
    text: 'Obras de tipo corriente con control en obra: arenas naturales que excedan banda B sin superar banda C.',
  }),

  // ── CIRSOC 200:2024 — agregado fino ──
  // §3.2.3.2 f) es la regla VINCULANTE para usar arenas en banda A-C.
  // Más estricta que IRAM 1627 §3.2.5: exige H ≤ 20 Y evidencia técnica
  // (estudios de laboratorio o antecedentes de obras similares).
  CIRSOC_3_2_3_2_F: ref({
    standard: STANDARD.CIRSOC_200_2024, clause: '§3.2.3.2 f)', version: 2024,
    bindingness: BINDINGNESS.MANDATORY,
    text: 'Hormigones de resistencia ≤ H-20 pueden emplear arenas naturales con granulometría entre A y C, siempre que existan estudios de laboratorio que demuestren cumplimiento del proyecto, o antecedentes de obras similares con comportamiento satisfactorio.',
  }),
  CIRSOC_3_2_3_3_TABLA_3_4: ref({
    standard: STANDARD.CIRSOC_200_2024, clause: '§3.2.3.3 Tabla 3.4', version: 2024,
    bindingness: BINDINGNESS.MANDATORY,
    text: 'Sustancias nocivas en agregado fino — límites por destino.',
  }),
  CIRSOC_3_2_3_4: ref({
    standard: STANDARD.CIRSOC_200_2024, clause: '§3.2.3.4', version: 2024,
    bindingness: BINDINGNESS.MANDATORY,
    text: 'Materia orgánica en agregado fino.',
  }),
  CIRSOC_3_2_3_5: ref({
    standard: STANDARD.CIRSOC_200_2024, clause: '§3.2.3.5', version: 2024,
    bindingness: BINDINGNESS.MANDATORY,
    text: 'Durabilidad del agregado fino (sulfato de sodio).',
  }),
});

/**
 * Devuelve un string legible para mostrar en UI/PDF.
 * Ej: ref({IRAM_1627, '§3.2.4'}) → "IRAM 1627 §3.2.4"
 */
function formatNormRef(r) {
  if (!r || !r.standard || !r.clause) return '';
  return `${r.standard} ${r.clause}`;
}

/**
 * Devuelve un sufijo según bindingness para destacarlo visualmente.
 *   mandatory   → "" (la cita ya es destacada por default)
 *   recommended → " (referencia)"
 *   informative → " (guía)"
 */
function bindingnessSuffix(r) {
  if (!r || !r.bindingness) return '';
  if (r.bindingness === BINDINGNESS.RECOMMENDED) return ' (referencia)';
  if (r.bindingness === BINDINGNESS.INFORMATIVE) return ' (guía)';
  return '';
}

/**
 * Cuando un mismo punto tiene cita IRAM + CIRSOC, devolver string consolidado
 * con CIRSOC primero (vinculante) e IRAM como complementaria.
 *
 * @param {Array<NormRef>} refs
 */
function formatRefList(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return '';
  // Ordenar: mandatory primero, luego recommended, luego informative
  const ord = { mandatory: 0, recommended: 1, informative: 2 };
  const sorted = [...refs].sort((a, b) => (ord[a.bindingness] ?? 3) - (ord[b.bindingness] ?? 3));
  return sorted.map((r) => `${formatNormRef(r)}${bindingnessSuffix(r)}`).join(' · ');
}

module.exports = {
  STANDARD,
  BINDINGNESS,
  NORM_REFS,
  ref,
  formatNormRef,
  formatRefList,
  bindingnessSuffix,
};
