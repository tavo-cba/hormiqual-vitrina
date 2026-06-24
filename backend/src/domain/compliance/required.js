'use strict';

/**
 * required.js — Tabla declarativa de exigibilidad por ensayo.
 *
 * Responde: dado un código de ensayo + UsageContext + MaterialContext,
 * ¿el ensayo es exigible (`required`), no exigido (`not_applicable`), o
 * indeterminable por información faltante (`unknown`)?
 *
 * Diseño:
 *   - Tabla declarativa pura datos (`EXIGIBILITY_TABLE`).
 *   - Función `isRequired(codigo, usageCtx, materialCtx, options)` que la consume.
 *   - Sin lógica imperativa dentro de las entradas: cada regla es un objeto
 *     declarativo con predicados estructurados, lo que la hace inspectable
 *     y testeable por entrada.
 *
 * Forma de cada entrada:
 *   {
 *     defaultRequired: boolean,
 *     requiredWhen?:    Array<Predicado>,  // OR — si alguno matchea → required
 *     notApplicableWhen?: Array<Predicado>, // OR — si alguno matchea → not_applicable
 *     obligatorioHintBehavior:
 *         'overrides_default_to_required'  // si options.obligatorio=true → required
 *       | 'aligns_with_default'             // hint coincide con defaultRequired
 *       | 'ignored',                        // hint no influye
 *     norm: string,
 *     notes: string,
 *   }
 *
 * Forma de un Predicado:
 *   { usage?: {...}, agregado?: {...}, cemento?: {...} }
 *
 *   Cada sección es un objeto donde la clave es un campo del contexto y el
 *   valor es:
 *     - un valor exacto (string|boolean|number)  → match si igual
 *     - un array de valores                       → match si está en el array
 *
 *   Reglas de evaluación de un Predicado:
 *     - AND entre todas las claves del predicado.
 *     - Si una clave evalúa a `actual == null` (campo no declarado en el
 *       contexto), esa clave es 'unknown'.
 *     - Si TODAS las claves conocidas matchean Y hay al menos una unknown,
 *       el predicado retorna 'unknown'.
 *     - Si ALGUNA clave conocida NO matchea, el predicado retorna `false`
 *       (sin importar si hay unknowns).
 *     - Si todas las claves matchean (sin unknowns), retorna `true`.
 *
 * Reglas de evaluación de `isRequired`:
 *   1. Si no hay entrada en la tabla → 'required' (regla conservadora: código
 *      desconocido se asume exigible).
 *   2. Iterar `requiredWhen`:
 *      - Si algún predicado retorna `true` → 'required'.
 *      - Si alguno retorna 'unknown', recordarlo.
 *   3. Iterar `notApplicableWhen`:
 *      - Si algún predicado retorna `true` → 'not_applicable'.
 *      - 'unknown' acá NO se propaga (caemos a default).
 *   4. Si `options.obligatorio === true` Y `obligatorioHintBehavior` es
 *      'overrides_default_to_required' → 'required'.
 *   5. Si hubo 'unknown' en requiredWhen → 'unknown'.
 *   6. Default: 'required' si entry.defaultRequired, else 'not_applicable'.
 *
 * El caller decide cómo tratar 'unknown'. Por convención (regla conservadora)
 * se mapea a 'required' en los call sites de alertas — falso positivo es
 * preferible a falso negativo cuando la información es incompleta.
 *
 * NOTA sobre tipologiaCodigo: las reglas de exigibilidad NO sustituyen
 * automáticamente null por 'convencional'. Si una regla quiere ese
 * comportamiento, debe declararlo explícitamente vía un predicado o el
 * default. Esto separa responsabilidad: el builder valida tipos, las reglas
 * deciden semántica. (Decisión documentada en C1.)
 */

/* ───────── Resultados ───────── */

const REQUIRED        = 'required';
const NOT_APPLICABLE  = 'not_applicable';
const UNKNOWN         = 'unknown';

/* ───────── Tabla declarativa ───────── */

const EXIGIBILITY_TABLE = Object.freeze({
  /* ─── Caracterización física básica del agregado ─── */

  'IRAM1520_DENSIDAD_ABSORCION_FINO': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1520',
    notes: 'Densidad y absorción AF: caracterización básica, siempre exigible para diseño de mezclas.',
  }),

  'IRAM1533_DENSIDAD_GRUESO': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1533',
    notes: 'Densidad y absorción AG: caracterización básica.',
  }),

  'IRAM1531_PESO_UNITARIO': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } }, // PUS aplica al AG
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1548 / 1531 Tabla 4',
    notes: 'PUS exigido para AG (>= 1120 kg/m³). Para AF es informativo, queda not_applicable como criterio de cumplimiento.',
  }),

  'IRAM1505_GRANULOMETRIA': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1505',
    notes: 'Granulometría: caracterización siempre exigible para diseño. Las verificaciones de banda IRAM 1627 viven en Nivel 2 (verificación granulométrica de la mezcla, no del agregado individual).',
  }),

  /* ─── Sustancias nocivas ─── */

  'IRAM1674_MATERIAL_FINO_200': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1540 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Pasante #200: siempre exigible. Límite contextual (3% strict / 5% standard) según expuestoDesgaste; eso es decisión del evaluador, no de la exigibilidad.',
  }),

  'IRAM1647_TERRONES_ARCILLA': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Terrones de arcilla: siempre exigible.',
  }),

  'IRAM1647_SULFATOS_SO3': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1647 / IRAM 1512 §5.2.2',
    notes: 'Sulfatos como SO3: siempre exigible.',
  }),

  'IRAM1647_SALES_SOLUBLES': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1647',
    notes: 'Sales solubles totales: siempre exigible.',
  }),

  'IRAM1882_CLORUROS_SOLUBLES': Object.freeze({
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1882 / CIRSOC 200 art. 2.2.8',
    notes: 'Cloruros: siempre exigibles. El límite cambia según tipoArmadura (pretensado: 0.003%, armado: 0.04%) — decisión del evaluador, no de la exigibilidad.',
  }),

  'IRAM1647_MATERIA_ORGANICA': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'GRUESO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.4',
    notes: 'Materia orgánica: aplica a AF. Para AG queda not_applicable.',
  }),

  'IRAM1647_MATERIAS_CARBONOSAS': Object.freeze({
    // Materias carbonosas son exigibles SIEMPRE según CIRSOC 200 (Tabla 3.4).
    // El campo aspectoSuperficialImportante solo cambia el LÍMITE numérico
    // (0.5% si importa, 1.0% si no), no la exigibilidad.
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
    notes: 'Siempre exigible. aspectoSuperficialImportante cambia solo el límite numérico.',
  }),

  /* ─── Forma del AG (no aplican a AF) ─── */

  'IRAM1687_1_LAJOSIDAD': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1687-1 / IRAM 1531',
    notes: 'Lajosidad: aplica a AG (forma de partícula). Para AF queda not_applicable.',
  }),

  'IRAM1687_2_ELONGACION': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1687-2 / IRAM 1531',
    notes: 'Elongación: aplica a AG. Para AF queda not_applicable.',
  }),

  /* ─── Mecánicas ─── */

  'IRAM1532_DESGASTE_LA': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1532 / IRAM 1531',
    notes: 'Desgaste Los Ángeles: aplica a AG. Para AF queda not_applicable.',
  }),

  'IRAM1644_PARTICULAS_BLANDAS': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1644 / IRAM 1531',
    notes: 'Partículas blandas: aplica a AG.',
  }),

  /* ─── Equivalente de arena — informativo (NO exigible) ─── */
  // Auditoría 01-calidad C21 (sesión 2026-05-07): IRAM 1682:1992 es método
  // para mezclas bituminosas y bases de pavimentos; ni CIRSOC 200:2024 ni
  // IRAM 1512:2006 lo exigen para AF en hormigón. Se declara `defaultRequired:
  // false` explícito para que `isRequired` retorne `not_applicable` y no caiga
  // al default conservador que aplica a códigos desconocidos. Si un tenant
  // quiere exigirlo, lo hace desde el catálogo (`obligatorio: true` →
  // promoción a REQUIRED via `obligatorioHintBehavior`).

  'IRAM1882_VALOR_EQUIVALENTE_ARENA': Object.freeze({
    defaultRequired: false,
    obligatorioHintBehavior: 'overrides_default_to_required',
    norm: 'IRAM 1682',
    notes: 'Equivalente de arena: ensayo informativo. IRAM 1682:1992 no establece límite para hormigón (la norma es para mezclas bituminosas y bases de pavimentos); CIRSOC 200:2024 no lo cita. Ver auditoría 01-calidad C21.',
  }),

  /* ─── Polvo adherido (solo AG) ─── */

  'IRAM1883_POLVO_ADHERIDO': Object.freeze({
    defaultRequired: true,
    notApplicableWhen: [
      { agregado: { tipo: 'FINO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1883',
    notes: 'Polvo adherido: aplica a AG.',
  }),

  /* ─── Durabilidad (contextual) ─── */

  'IRAM1525_DURABILIDAD_SULFATO': Object.freeze({
    defaultRequired: false,
    requiredWhen: [
      { usage: { exposureClass: ['C1', 'C2'] } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1525 / CIRSOC 200 Tabla 2.5',
    notes: 'Durabilidad por sulfato de sodio: exigible solo cuando exposureClass es C1 o C2 (congelación-deshielo). Si exposureClass es null, cae a unknown (regla conservadora del caller lo trata como required).',
  }),

  'IRAM1519_ESTABILIDAD_BASALTICAS': Object.freeze({
    defaultRequired: false,
    requiredWhen: [
      { agregado: { tipoRoca: 'BASALTICA' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1519 / IRAM 1874-2',
    notes: 'Estabilidad por etilenglicol: exigible solo si el agregado es basáltico. Si MaterialContext no tiene tipoRoca poblado (db sin AgregadoMeta), cae a unknown.',
  }),

  /* ─── RAS / Petrográfico ─── */

  'IRAM1649_EXAMEN_PETROGRAFICO': Object.freeze({
    // Decisión declarativa: siempre exigible para agregados nuevos. Si el
    // agregado tiene historial documentado de RAS conocido (NO_REACTIVO),
    // las reglas de uso pueden eximirlo, pero ese juicio es de la regla de
    // bloqueo (C3), no de la exigibilidad (C2).
    defaultRequired: true,
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1649 / CIRSOC 200 §3.2.3.6',
    notes: 'Examen petrográfico: siempre exigible para caracterización del agregado nuevo. Su vencimiento NO bloquea (deuda C3).',
  }),

  'IRAM1674_RAS_ACELERADO': Object.freeze({
    defaultRequired: false,
    requiredWhen: [
      { usage: { exposureClass: ['Q3', 'Q4'] } },
      { agregado: { evaluacionRas: 'POTENCIALMENTE_REACTIVO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1674 / IRAM 1512 §5.6.5',
    notes: 'RAS acelerado: exigible si exposición es Q3/Q4 (ataque químico severo) O si el examen petrográfico indica reactividad potencial. Si ambos campos son desconocidos, cae a unknown.',
  }),

  /* PR8.6 — IRAM 1700 prismas hormigón (código catálogo IRAM1874_1_RAP_PRISMA) */
  'IRAM1874_1_RAP_PRISMA': Object.freeze({
    defaultRequired: false,
    requiredWhen: [
      { usage: { exposureClass: ['Q3', 'Q4'] } },
      { agregado: { evaluacionRas: 'POTENCIALMENTE_REACTIVO' } },
    ],
    obligatorioHintBehavior: 'aligns_with_default',
    norm: 'IRAM 1700 / CIRSOC 200:2024 §2.2.16.9',
    notes: 'Prismas de hormigón (IRAM 1700:2013). Misma exigibilidad que IRAM 1674 (Q3/Q4 o RAS potencial), pero con PRELACIÓN sobre el método de barra de mortero cuando ambos están disponibles (CIRSOC §2.2.16.9.b).',
  }),
});

/* ─── Aliases (mismo evaluador, mismo código de exigibilidad) ─── */

const CODE_ALIASES = Object.freeze({
  'IRAM1682_EQUIVALENTE_ARENA': 'IRAM1882_VALOR_EQUIVALENTE_ARENA',
  'IRAM1532_LOS_ANGELES':       'IRAM1532_DESGASTE_LA',
  'IRAM1548_PESO_UNITARIO':     'IRAM1531_PESO_UNITARIO',
});

/* ───────── Evaluación de predicados ───────── */

/**
 * Evalúa un predicado contra el par (usageCtx, materialCtx).
 *
 * @returns {true | false | 'unknown'}
 *   true     — todas las claves matchean (no hay unknowns)
 *   false    — alguna clave conocida no matchea
 *   'unknown' — todas las claves conocidas matchean PERO hay al menos una
 *               clave faltante en los contextos
 */
function evalPredicate(pred, usageCtx, materialCtx) {
  const sections = [
    ['usage',    usageCtx],
    ['agregado', materialCtx?.agregado],
    ['cemento',  materialCtx?.cemento],
  ];

  let hasUnknown = false;

  for (const [section, source] of sections) {
    const fields = pred[section];
    if (!fields) continue;
    for (const [key, expected] of Object.entries(fields)) {
      const actual = source?.[key];
      if (actual == null) {
        // Caso especial: para booleanos, null cuenta como "no declarado"
        // → unknown solo si el predicado pide true. Si pide false, null se
        // trata como false (defaults de la BD).
        // En la práctica, los UsageContext booleanos siempre tienen valor
        // (default false) por construcción del builder, así que esto solo
        // afecta a campos del MaterialContext que pueden venir nulos.
        if (typeof expected === 'boolean' && expected === false) {
          // null se acepta como false implícito
          continue;
        }
        hasUnknown = true;
        continue;
      }
      const matches = Array.isArray(expected)
        ? expected.includes(actual)
        : actual === expected;
      if (!matches) return false;  // condición conocida no matchea → predicado falso
    }
  }

  if (hasUnknown) return 'unknown';
  return true;
}

/* ───────── API pública ───────── */

/**
 * Determina si un ensayo es exigible en el contexto dado.
 *
 * @param {string} codigo - Código del ensayo (acepta aliases).
 * @param {Object} usageCtx - UsageContext canónico (ver usageContext.js).
 * @param {Object} materialCtx - MaterialContext canónico (ver materialContext.js).
 * @param {Object} [options]
 * @param {boolean} [options.obligatorio] - Hint del catálogo
 *   AgregadoEnsayoTipo.obligatorio. Su efecto depende de
 *   `entry.obligatorioHintBehavior`.
 * @returns {'required' | 'not_applicable' | 'unknown'}
 */
function isRequired(codigo, usageCtx, materialCtx, options = {}) {
  if (!codigo) return REQUIRED; // sin código → conservador

  const canonical = CODE_ALIASES[codigo] || codigo;
  const entry = EXIGIBILITY_TABLE[canonical];

  if (!entry) {
    // Código no conocido en la tabla → regla conservadora: required.
    // Esto también cubre el caso de evaluadores nuevos que se agreguen al
    // motor sin actualizar esta tabla — el sistema los exige por default
    // hasta que un humano declare lo contrario.
    return REQUIRED;
  }

  // 1. Match positivo en requiredWhen
  let requiredHasUnknown = false;
  for (const pred of entry.requiredWhen || []) {
    const result = evalPredicate(pred, usageCtx, materialCtx);
    if (result === true) return REQUIRED;
    if (result === UNKNOWN) requiredHasUnknown = true;
  }

  // 2. Match positivo en notApplicableWhen
  for (const pred of entry.notApplicableWhen || []) {
    const result = evalPredicate(pred, usageCtx, materialCtx);
    if (result === true) return NOT_APPLICABLE;
    // unknown en notApplicableWhen NO se propaga: si no podemos confirmar
    // que es no exigible, no podemos rebajar — caemos al default.
  }

  // 3. Hint del catálogo
  if (options.obligatorio === true &&
      entry.obligatorioHintBehavior === 'overrides_default_to_required') {
    return REQUIRED;
  }

  // 4. Si requiredWhen tuvo unknowns sin matches positivos → unknown
  if (requiredHasUnknown) return UNKNOWN;

  // 5. Default
  return entry.defaultRequired ? REQUIRED : NOT_APPLICABLE;
}

/**
 * Helper para callers de alertas: aplica la regla conservadora "unknown →
 * required". Útil para el dispatcher de alertas (Prompt 1 Commit 6) que ya
 * hoy aplica esta convención.
 */
function isRequiredConservative(codigo, usageCtx, materialCtx, options) {
  const r = isRequired(codigo, usageCtx, materialCtx, options);
  return r === UNKNOWN ? REQUIRED : r;
}

/**
 * Devuelve la entrada cruda de la tabla para inspección/tests.
 * Devuelve undefined si el código no está.
 */
function getExigibilityEntry(codigo) {
  if (!codigo) return undefined;
  const canonical = CODE_ALIASES[codigo] || codigo;
  return EXIGIBILITY_TABLE[canonical];
}

module.exports = {
  REQUIRED,
  NOT_APPLICABLE,
  UNKNOWN,
  EXIGIBILITY_TABLE,
  CODE_ALIASES,
  evalPredicate,
  isRequired,
  isRequiredConservative,
  getExigibilityEntry,
};
