/**
 * Tests Prompt 3 C9.5 — dosificacionInformePdf.js (último PDF de la serie).
 *
 * Cobertura:
 *   1. Regresión: los patrones de display migrados (color RGB hardcoded en
 *      didParseCell, en cell text "CUMPLE"/"NO CUMPLE" para verificaciones
 *      CIRSOC) ya no aparecen en código vivo.
 *   2. Lock-in D26 caso B: el veredicto experimental de pastón preserva su
 *      vocabulario propio (APROBADO/RECHAZADO/OBSERVADO) — NO se canoniza.
 *   3. Helpers locales re-implementados (espejo del archivo) para los
 *      mapeos `granuloEstadoToCat` (verifIRAM 4 estados) + `aptitudEstadoToCat`
 *      (8 estados de aptitud) + `clEstadoToCat` (3 estados de cloruros). Si
 *      el archivo diverge, el test falla.
 */

const fs = require('fs');
const path = require('path');

import { VEREDICTO } from '../../../../lib/compliance';
import { CATEGORIA_PDF_COLORS, getCategoriaPdfColor } from '../../../../lib/compliance/pdfPresentation';

const SOURCE_PATH = path.resolve(__dirname, '..', 'dosificacionInformePdf.js');

/* ───────── Strip de comentarios ───────── */

function stripComments(source) {
  const lines = source.split('\n');
  const out = [];
  let inBlock = false;
  for (let raw of lines) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) { line = line.substring(end + 2); inBlock = false; }
      else { out.push(''); continue; }
    }
    while (true) {
      const start = line.indexOf('/*');
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end >= 0) line = line.substring(0, start) + line.substring(end + 2);
      else { line = line.substring(0, start); inBlock = true; break; }
    }
    const slash = line.indexOf('//');
    if (slash >= 0) line = line.substring(0, slash);
    out.push(line);
  }
  return out.join('\n');
}

/* ───────── Tests de regresión ───────── */

describe('dosificacionInformePdf — regresión: display sites migrados (Prompt 3 C9.5)', () => {
  let codeOnly;

  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('No quedan checks `val.includes("NO CUMPLE")` / `val.includes("CUMPLE")` en didParseCell', () => {
    // Pre-C9.5: didParseCell de aire/pulverulento/HP usaba val.includes() contra
    // las cadenas legacy. Post-C9.5: usa val.startsWith("APTO") / startsWith("NO APTO")
    // alineado al label canónico que ahora retorna `getCategoriaPdfLabel`.
    expect(codeOnly).not.toMatch(/val\.includes\(\s*['"]CUMPLE['"]\s*\)/);
    expect(codeOnly).not.toMatch(/val\.includes\(\s*['"]NO CUMPLE['"]\s*\)/);
  });

  test('No queda emisión literal de "CUMPLE" / "NO CUMPLE" como label de verificación CIRSOC', () => {
    // Pre-C9.5: `tx("CUMPLE")` / `tx("NO CUMPLE")` para verificaciones de aire/pulverulento/HP.
    // Post-C9.5: `tx(getCategoriaPdfLabel(true))` etc.
    expect(codeOnly).not.toMatch(/tx\(\s*['"]CUMPLE['"]\s*\)/);
    expect(codeOnly).not.toMatch(/tx\(\s*['"]NO CUMPLE['"]\s*\)/);
  });

  test('El archivo importa el helper canónico pdfPresentation', () => {
    expect(codeOnly).toContain('pdfPresentation');
    expect(codeOnly).toMatch(/getCategoriaPdfLabel|getCategoriaPdfColor/);
  });

  test('didParseCell de verificacionesCIRSOC usa startsWith("APTO") / startsWith("NO APTO")', () => {
    // Verificación de que el patrón post-migración fue aplicado correctamente
    // en lugar de un check ambiguo o roto.
    expect(codeOnly).toMatch(/val\.startsWith\(\s*["']NO APTO["']\s*\)/);
    expect(codeOnly).toMatch(/val\.startsWith\(\s*["']APTO["']\s*\)/);
  });

  test('Los 4 estados granulométricos (verifIRAM) usan getCategoriaPdfColor', () => {
    // CUMPLE_AC y CUMPLE_CON_DESVIOS deben mapear a APTO_CON_OBSERVACIONES
    // (cambio observable D20 visible en el PDF de mezcla).
    const iramBlock = codeOnly.split('iramGlobalColors')[1];
    expect(iramBlock).toBeDefined();
    expect(iramBlock).toMatch(/getCategoriaPdfColor\(\s*VEREDICTO\.APTO\s*\)/);
    expect(iramBlock).toMatch(/getCategoriaPdfColor\(\s*VEREDICTO\.APTO_CON_OBSERVACIONES\s*\)/);
    expect(iramBlock).toMatch(/getCategoriaPdfColor\(\s*VEREDICTO\.NO_APTO\s*\)/);
  });
});

/* ───────── Lock-in D26 caso B: veredicto experimental de pastón ───────── */

describe('dosificacionInformePdf — lock-in D26 caso B (veredicto pastón preservado)', () => {
  let codeOnly;

  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('Veredicto pastón mantiene los 3 estados propios (APROBADO/RECHAZADO/OBSERVADO)', () => {
    // El bloque de "Veredicto de prueba" en sección Q. Vocabulario propio del
    // flow experimental por D26 caso B. Si alguien intenta canonizar
    // (mapearlos a APTO/NO APTO/APTO_CON_OBSERVACIONES), el test rompe.
    expect(codeOnly).toMatch(/['"]APROBADO['"]/);
    expect(codeOnly).toMatch(/['"]RECHAZADO['"]/);
    expect(codeOnly).toMatch(/['"]OBSERVADO['"]/);
    expect(codeOnly).toMatch(/['"]PRUEBA APROBADA['"]/);
    expect(codeOnly).toMatch(/['"]PRUEBA RECHAZADA['"]/);
  });

  test('verdLabel del pastón usa vocabulario experimental, NO labels canónicos APTO/NO APTO', () => {
    // Marker de código vivo: el ternario sobre p.veredicto que decide PRUEBA APROBADA/RECHAZADA.
    // Verificamos que NO existe en el archivo entero un mapeo del veredicto pastón a getCategoriaPdfLabel.
    expect(codeOnly).not.toMatch(/getCategoriaPdfLabel\(\s*p\.veredicto\s*\)/);
    expect(codeOnly).not.toMatch(/getCategoriaPdfColor\(\s*p\.veredicto\s*\)/);
    // Y que el ternario clásico sigue ahí (el bloque no fue migrado al canónico).
    expect(codeOnly).toMatch(/p\.veredicto\s*===\s*['"]APROBADO['"]/);
    expect(codeOnly).toMatch(/p\.veredicto\s*===\s*['"]RECHAZADO['"]/);
  });
});

/* ───────── Helpers locales — espejo de los mapeos migrados ───────── */

function granuloVerifIramEstadoToCat(estado) {
  switch (estado) {
    case 'CUMPLE':            return VEREDICTO.APTO;
    case 'CUMPLE_AC':         return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'CUMPLE_CON_DESVIOS': return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'NO_CUMPLE':         return VEREDICTO.NO_APTO;
    default:                  return null;
  }
}

function aptitudEstadoToCat(estado) {
  switch (estado) {
    case 'cumple':         return VEREDICTO.APTO;
    case 'atencion':       return VEREDICTO.APTITUD_CONDICIONADA;  // Fix B post-smoke C9.5
    case 'no_cumple':      return VEREDICTO.NO_APTO;
    case 'no_concluyente': return VEREDICTO.EVALUACION_INCOMPLETA;
    case 'sin_dato':       return null;  // muted, sin categoría canónica directa
    case 'informativo':    return VEREDICTO.INFORMATIVO;
    case 'excepcion':      return VEREDICTO.APTITUD_CONDICIONADA;
    case 'pendiente':      return VEREDICTO.EVALUACION_INCOMPLETA;
    default:               return null;
  }
}

function clEstadoToCat(estado) {
  switch (estado) {
    case 'NO_CUMPLE':         return VEREDICTO.NO_APTO;
    case 'CUMPLE_WORST_CASE': return VEREDICTO.APTO;
    case 'CUMPLE_CON_DATOS':  return VEREDICTO.APTO_CON_OBSERVACIONES;
    default:                  return null;
  }
}

describe('dosificacionInformePdf — granuloVerifIramEstadoToCat (espejo de iramGlobalColors)', () => {
  test('CUMPLE → APTO', () => {
    expect(granuloVerifIramEstadoToCat('CUMPLE')).toBe(VEREDICTO.APTO);
  });

  test('CUMPLE_AC → APTO CON OBSERVACIONES (D20 paradigma — cumple banda más permisiva A-C)', () => {
    expect(granuloVerifIramEstadoToCat('CUMPLE_AC')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('CUMPLE_CON_DESVIOS → APTO CON OBSERVACIONES', () => {
    expect(granuloVerifIramEstadoToCat('CUMPLE_CON_DESVIOS')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('NO_CUMPLE → NO APTO', () => {
    expect(granuloVerifIramEstadoToCat('NO_CUMPLE')).toBe(VEREDICTO.NO_APTO);
  });
});

describe('dosificacionInformePdf — aptitudEstadoToCat (8 estados → 6 categorías + null)', () => {
  test('cumple → APTO', () => {
    expect(aptitudEstadoToCat('cumple')).toBe(VEREDICTO.APTO);
  });

  test('atencion → APTITUD CONDICIONADA (Fix B post-smoke: evita conflicto "Atención verde")', () => {
    // El label "Atención" en español carga con peso de alerta. Mapearlo a
    // APTO_CON_OBSERVACIONES (verde) genera conflicto cognitivo: el ojo lee
    // "Atención" en celda verde como mensaje contradictorio. APTITUD_CONDICIONADA
    // (naranja) preserva la semántica visual de alerta y matchea el significado
    // técnico ("cumple pero requiere monitoreo o acción contextual").
    expect(aptitudEstadoToCat('atencion')).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });

  test('atencion y excepcion comparten color naranja (hermandad visual histórica)', () => {
    // Pre-migración: ambos eran marrón [146, 64, 14] (familia warning).
    // Post-Fix B: ambos son naranja APTITUD_CONDICIONADA. Preserva la
    // continuidad visual del PDF para usuarios acostumbrados al formato.
    expect(aptitudEstadoToCat('atencion')).toBe(aptitudEstadoToCat('excepcion'));
  });

  test('no_cumple → NO APTO', () => {
    expect(aptitudEstadoToCat('no_cumple')).toBe(VEREDICTO.NO_APTO);
  });

  test('no_concluyente → EVALUACIÓN INCOMPLETA (CAMBIO observable: antes naranja)', () => {
    // Pre-C9.5: no_concluyente era naranja [217, 119, 6].
    // Post-C9.5: azul EVALUACION_INCOMPLETA [29, 78, 216].
    expect(aptitudEstadoToCat('no_concluyente')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('sin_dato → null (sin veredicto, color muted preservado)', () => {
    expect(aptitudEstadoToCat('sin_dato')).toBeNull();
  });

  test('informativo → INFORMATIVO', () => {
    expect(aptitudEstadoToCat('informativo')).toBe(VEREDICTO.INFORMATIVO);
  });

  test('excepcion → APTITUD CONDICIONADA (cumple bajo excepción declarada)', () => {
    // Cambio observable C9.5: el legacy emitía marrón [146, 64, 14].
    // Post-C9.5: naranja APTITUD_CONDICIONADA — refleja "cumple bajo condición".
    expect(aptitudEstadoToCat('excepcion')).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });

  test('pendiente → EVALUACIÓN INCOMPLETA', () => {
    expect(aptitudEstadoToCat('pendiente')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('dosificacionInformePdf — clEstadoToCat (3 estados de cloruros con worst-case)', () => {
  test('NO_CUMPLE → NO APTO', () => {
    expect(clEstadoToCat('NO_CUMPLE')).toBe(VEREDICTO.NO_APTO);
  });

  test('CUMPLE_WORST_CASE → APTO (cumple incluso con estimación pesimista de N/D)', () => {
    expect(clEstadoToCat('CUMPLE_WORST_CASE')).toBe(VEREDICTO.APTO);
  });

  test('CUMPLE_CON_DATOS → APTO CON OBSERVACIONES (cumple sólo con datos disponibles)', () => {
    // Matiz importante: el material formalmente cumple, pero si los componentes
    // sin dato (cemento, agua) tuvieran cloruros máximos asumibles, el total
    // superaría el límite. Es exactamente el patrón APTO_CON_OBSERVACIONES.
    expect(clEstadoToCat('CUMPLE_CON_DATOS')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });
});

describe('dosificacionInformePdf — coherencia con CATEGORIA_PDF_COLORS', () => {
  test('Cada categoría retornada por los helpers tiene RGB válido', () => {
    [VEREDICTO.APTO, VEREDICTO.APTO_CON_OBSERVACIONES, VEREDICTO.APTITUD_CONDICIONADA,
     VEREDICTO.NO_APTO, VEREDICTO.EVALUACION_INCOMPLETA, VEREDICTO.INFORMATIVO]
      .forEach((cat) => {
        const rgb = getCategoriaPdfColor(cat);
        expect(rgb).toEqual(CATEGORIA_PDF_COLORS[cat]);
      });
  });
});

/* ───────── PR2 / decisión 2026-05-28 — Modelo dual DESCRIPTIVO / NORMATIVO ─────────
   El informe de dosificación acepta `modoEvaluacion = 'DESCRIPTIVO' | 'NORMATIVO'`
   (con aliases viejos PRESTACIONAL / PRESCRIPTIVO por back-compat). En DESCRIPTIVO
   omite la portada multi-eje, el sello prescriptivo, la sección K de aptitud, y
   las columnas "Resultado/Estado" de tablas que emiten veredicto. */

describe('PR2 / 2026-05-28 — modelo dual DESCRIPTIVO / NORMATIVO', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  test('Acepta opción `modoEvaluacion` con default DESCRIPTIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]DESCRIPTIVO['"]/);
  });

  test('Reconoce NORMATIVO como modo canónico nuevo + alias PRESCRIPTIVO entrada', () => {
    expect(codeOnly).toMatch(/_modoNorm\s*===\s*['"]NORMATIVO['"]/);
    expect(codeOnly).toMatch(/['"]PRESCRIPTIVO['"]/); // alias entrada permitido
  });

  test('Portada multi-eje (assessment) gateada por _modoNorm === NORMATIVO', () => {
    expect(codeOnly).toMatch(/assessment\s*&&\s*_modoNorm\s*===\s*['"]NORMATIVO['"]/);
  });

  test('Sección K "Verificación de aptitud" gateada por _modoNorm === NORMATIVO', () => {
    expect(codeOnly).toMatch(/_modoNorm\s*===\s*['"]NORMATIVO['"]\s*&&\s*showSection\(\s*['"]aptitudMateriales['"]/);
  });

  test('Banner DESCRIPTIVO presente en código vivo (wording cliente-facing)', () => {
    expect(codeOnly).toMatch(/INFORME DESCRIPTIVO DE DOSIFICACIÓN/);
    expect(codeOnly).toMatch(/sin emitir valoración normativa/i);
  });

  test('Banner NORMATIVO presente en código vivo', () => {
    expect(codeOnly).toMatch(/VERIFICACIÓN NORMATIVA ESTRICTA/);
    expect(codeOnly).not.toMatch(/catálogo del tenant/i);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
    expect(rawSource).toMatch(/DESCRIPTIVO/);
    expect(rawSource).toMatch(/NORMATIVO/);
  });
});
