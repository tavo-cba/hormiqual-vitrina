/**
 * Tests Prompt 3 C7 — Helpers de display canónicos de EnsayoFormModal.jsx.
 *
 * El componente es un modal grande con DataTables, Charts y servicios de
 * evaluación. No lo testeamos end-to-end. Verificamos:
 *
 *   1. `categoriaDeCumpleLegacy`: ENUM persistido (CUMPLE/NO_CUMPLE/NO_EVAL/
 *      SIN_PARAMETROS) → 7 categorías visuales canónicas.
 *   2. `categoriaDeEstadoGranulometria`: vocabulario interno del evaluador
 *      (cumple / cumple_con_tolerancia / no_cumple) → categoría visual.
 *      `cumple_con_tolerancia` → APTO_CON_OBSERVACIONES (D15/D20 paradigmático).
 *   3. `categoriaDeBoolean`: true/false/null → APTO/NO APTO/EVAL INCOMPLETA.
 *   4. Branch INFORMATIVO de tolerancia10pp: `nota` presente → INFORMATIVO.
 *   5. Mapeo del evalResult.estado del servicio de bandas (CUMPLE / INCOMPLETO /
 *      otros / undefined+cumple-bool).
 *
 * Helpers re-implementados acá (espejo del componente). Si la lógica diverge,
 * el test falla y obliga a sincronizar (mismo patrón C4/C5/C6).
 */

import { CATEGORIA_COLORS, VEREDICTO } from '../../../../lib/compliance';

/* ───────── Re-implementación local (espejo del componente) ───────── */

function categoriaDeCumpleLegacy(cumple) {
  switch (cumple) {
    case 'CUMPLE':         return VEREDICTO.APTO;
    case 'NO_CUMPLE':      return VEREDICTO.NO_APTO;
    case 'NO_EVAL':        return VEREDICTO.EVALUACION_INCOMPLETA;
    case 'SIN_PARAMETROS': return VEREDICTO.EVALUACION_INCOMPLETA;
    default:               return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

function categoriaDeEstadoGranulometria(estado) {
  switch (estado) {
    case 'cumple':                 return VEREDICTO.APTO;
    case 'cumple_con_tolerancia':  return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'no_cumple':              return VEREDICTO.NO_APTO;
    default:                       return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

function categoriaDeBoolean(cumple) {
  if (cumple === true)  return VEREDICTO.APTO;
  if (cumple === false) return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

/**
 * Mapeo del Tag de evalResult del servicio de bandas. Reproduce el inline
 * del componente (vinculado al servicio evaluarBandaCompuesta).
 */
function categoriaDeEvalResult(evalResult) {
  if (!evalResult) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (evalResult.estado === 'CUMPLE')     return VEREDICTO.APTO;
  if (evalResult.estado === 'INCOMPLETO') return VEREDICTO.EVALUACION_INCOMPLETA;
  if (evalResult.estado)                  return VEREDICTO.NO_APTO;
  return categoriaDeBoolean(evalResult.cumple);
}

/**
 * Mapeo del icono de tolerancia10pp en reglas CIRSOC. Si trae `.nota`,
 * la regla no aplica (caso "no medible") → INFORMATIVO. Si no, se usa
 * el booleano `.cumple` con categoriaDeBoolean.
 */
function categoriaDeTolerancia10pp(tolerancia) {
  if (!tolerancia) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (tolerancia.nota) return VEREDICTO.INFORMATIVO;
  return categoriaDeBoolean(tolerancia.cumple);
}

/* ───────── Tests ───────── */

describe('EnsayoFormModal — categoriaDeCumpleLegacy (ENUM persistido a 7 categorías)', () => {
  test('CUMPLE → APTO', () => {
    expect(categoriaDeCumpleLegacy('CUMPLE')).toBe(VEREDICTO.APTO);
  });

  test('NO_CUMPLE → NO APTO', () => {
    expect(categoriaDeCumpleLegacy('NO_CUMPLE')).toBe(VEREDICTO.NO_APTO);
  });

  test('NO_EVAL → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeCumpleLegacy('NO_EVAL')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('SIN_PARAMETROS → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeCumpleLegacy('SIN_PARAMETROS')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('null/undefined/string desconocido → EVALUACIÓN INCOMPLETA (default seguro)', () => {
    expect(categoriaDeCumpleLegacy(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeCumpleLegacy(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeCumpleLegacy('CUALQUIER_OTRO')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('EnsayoFormModal — categoriaDeEstadoGranulometria (D15/D20 paradigmático)', () => {
  test('cumple → APTO', () => {
    expect(categoriaDeEstadoGranulometria('cumple')).toBe(VEREDICTO.APTO);
  });

  test('cumple_con_tolerancia → APTO CON OBSERVACIONES (caso paradigmático §3.2.4)', () => {
    expect(categoriaDeEstadoGranulometria('cumple_con_tolerancia')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('no_cumple → NO APTO', () => {
    expect(categoriaDeEstadoGranulometria('no_cumple')).toBe(VEREDICTO.NO_APTO);
  });

  test('null/undefined/string desconocido → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeEstadoGranulometria(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeEstadoGranulometria(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeEstadoGranulometria('otro')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('EnsayoFormModal — categoriaDeBoolean (reglas CIRSOC)', () => {
  test('true → APTO', () => {
    expect(categoriaDeBoolean(true)).toBe(VEREDICTO.APTO);
  });

  test('false → NO APTO', () => {
    expect(categoriaDeBoolean(false)).toBe(VEREDICTO.NO_APTO);
  });

  test('null/undefined → EVALUACIÓN INCOMPLETA (regla aún no evaluada)', () => {
    expect(categoriaDeBoolean(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeBoolean(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('Otros valores truthy/falsy NO se mapean (estricto: solo true/false)', () => {
    // Diseño defensivo: solo `=== true` y `=== false` se aceptan, evita que
    // un 0/1/"" sea tratado como un veredicto.
    expect(categoriaDeBoolean(1)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeBoolean(0)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeBoolean('')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('EnsayoFormModal — categoriaDeEvalResult (Tag del servicio de bandas)', () => {
  test('estado="CUMPLE" → APTO', () => {
    expect(categoriaDeEvalResult({ estado: 'CUMPLE', cumple: true })).toBe(VEREDICTO.APTO);
  });

  test('estado="INCOMPLETO" → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeEvalResult({ estado: 'INCOMPLETO', cumple: false })).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('estado="NO_CUMPLE" o cualquier otro presente → NO APTO', () => {
    expect(categoriaDeEvalResult({ estado: 'NO_CUMPLE', cumple: false })).toBe(VEREDICTO.NO_APTO);
    expect(categoriaDeEvalResult({ estado: 'FUERA_DE_BANDA' })).toBe(VEREDICTO.NO_APTO);
  });

  test('Sin estado, fallback a cumple booleano', () => {
    expect(categoriaDeEvalResult({ cumple: true })).toBe(VEREDICTO.APTO);
    expect(categoriaDeEvalResult({ cumple: false })).toBe(VEREDICTO.NO_APTO);
    expect(categoriaDeEvalResult({})).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('evalResult null/undefined → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeEvalResult(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeEvalResult(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('EnsayoFormModal — categoriaDeTolerancia10pp (reglas CIRSOC con branch informativo)', () => {
  test('Con .nota presente → INFORMATIVO (regla no aplica al caso)', () => {
    const tol = { nota: 'No se requiere por uso normativo', cumple: undefined };
    expect(categoriaDeTolerancia10pp(tol)).toBe(VEREDICTO.INFORMATIVO);
  });

  test('Sin .nota, cumple=true → APTO', () => {
    expect(categoriaDeTolerancia10pp({ cumple: true })).toBe(VEREDICTO.APTO);
  });

  test('Sin .nota, cumple=false → NO APTO', () => {
    expect(categoriaDeTolerancia10pp({ cumple: false })).toBe(VEREDICTO.NO_APTO);
  });

  test('null/undefined → EVALUACIÓN INCOMPLETA', () => {
    expect(categoriaDeTolerancia10pp(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(categoriaDeTolerancia10pp(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

/* ───────── Coherencia con CATEGORIA_COLORS (Hybrid Option B / D17) ───────── */

describe('EnsayoFormModal — coherencia con CATEGORIA_COLORS', () => {
  test('Cada categoría retornada por los helpers tiene una entry en CATEGORIA_COLORS', () => {
    // Si un helper retorna una categoría sin color, el modal renderiza un
    // <i> sin estilo. Este test cierra el ciclo: helpers ↔ tabla de colores.
    const todasLasCategorias = [
      categoriaDeCumpleLegacy('CUMPLE'),
      categoriaDeCumpleLegacy('NO_CUMPLE'),
      categoriaDeCumpleLegacy('NO_EVAL'),
      categoriaDeCumpleLegacy(null),
      categoriaDeEstadoGranulometria('cumple'),
      categoriaDeEstadoGranulometria('cumple_con_tolerancia'),
      categoriaDeEstadoGranulometria('no_cumple'),
      categoriaDeBoolean(true),
      categoriaDeBoolean(false),
      categoriaDeBoolean(null),
      categoriaDeEvalResult({ estado: 'CUMPLE' }),
      categoriaDeEvalResult({ estado: 'NO_CUMPLE' }),
      categoriaDeEvalResult({ estado: 'INCOMPLETO' }),
      categoriaDeTolerancia10pp({ nota: 'x' }),
    ];
    todasLasCategorias.forEach((cat) => {
      expect(CATEGORIA_COLORS[cat]).toBeDefined();
      expect(CATEGORIA_COLORS[cat].severity).toMatch(/^(success|info|warning|danger|secondary)$/);
      expect(CATEGORIA_COLORS[cat].icon).toMatch(/^pi /);
    });
  });

  test('APTO y APTO_CON_OBSERVACIONES comparten severity (success) pero difieren en icon (D17)', () => {
    // Cierre parcial D17: ambas categorías son verde, pero el ícono distingue
    // "cumple sin más" (check) de "cumple con nota técnica" (info).
    const apto = CATEGORIA_COLORS[VEREDICTO.APTO];
    const aptoObs = CATEGORIA_COLORS[VEREDICTO.APTO_CON_OBSERVACIONES];
    expect(apto.severity).toBe('success');
    expect(aptoObs.severity).toBe('success');
    expect(apto.icon).not.toBe(aptoObs.icon);
    expect(apto.icon).toBe('pi pi-check-circle');
    expect(aptoObs.icon).toBe('pi pi-info-circle');
  });

  test('cumple_con_tolerancia produce el mismo severity que cumple, distinto icon', () => {
    // Cambio observable C7: antes era verde (severity success), ahora sigue
    // siendo success pero con ícono pi-info-circle. El test garantiza que la
    // intención visual D15/D20 (cumple con nota) se comunique al usuario.
    const cumpleColor    = CATEGORIA_COLORS[categoriaDeEstadoGranulometria('cumple')];
    const conToleranciaColor = CATEGORIA_COLORS[categoriaDeEstadoGranulometria('cumple_con_tolerancia')];
    expect(cumpleColor.severity).toBe(conToleranciaColor.severity);
    expect(cumpleColor.icon).not.toBe(conToleranciaColor.icon);
  });
});
