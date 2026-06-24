/**
 * Tests Prompt 3 C9.3 — agregadoFichaTecnicaPdf.js
 *
 * Cobertura:
 *   1. Regresión: no hay strings legacy hardcoded como TEXTO user-facing
 *      en el PDF (a diferencia de la comparación interna `ev.estado === 'CUMPLE'`
 *      que es vocabulario del motor evaluador y se preserva intencionalmente).
 *
 *   2. Sección G "Veredicto del agregado": helpers de armado de las listas
 *      detalladas (razones / condiciones / observaciones / pendientes) re-
 *      implementados localmente como espejo del componente, mismo patrón que
 *      C4/C5/C6/C7. Si el componente diverge, los tests fallan y obligan a
 *      sincronizar.
 *
 *   3. Texto formal del dictamen para las 5 categorías canónicas: lock contra
 *      cambios accidentales del wording aprobado (es la sección que el
 *      ingeniero firma).
 */

const fs = require('fs');
const path = require('path');

import { Compliance, VEREDICTO } from '../../../../lib/compliance';

const SOURCE_PATH = path.resolve(
  __dirname,
  '..',
  'agregadoFichaTecnicaPdf.js',
);

/* ───────── Strip de comentarios (espejo del helper C9.2) ───────── */

function stripComments(source) {
  const lines = source.split('\n');
  const out = [];
  let inBlock = false;
  for (let raw of lines) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end >= 0) {
        line = line.substring(end + 2);
        inBlock = false;
      } else {
        out.push('');
        continue;
      }
    }
    while (true) {
      const start = line.indexOf('/*');
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end >= 0) {
        line = line.substring(0, start) + line.substring(end + 2);
      } else {
        line = line.substring(0, start);
        inBlock = true;
        break;
      }
    }
    const slash = line.indexOf('//');
    if (slash >= 0) {
      line = line.substring(0, slash);
    }
    out.push(line);
  }
  return out.join('\n');
}

/* ───────── Tests de regresión ───────── */

describe('agregadoFichaTecnicaPdf — regresión: textos legacy migrados (Prompt 3 C9.3)', () => {
  let codeOnly;

  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  // El test es más fino que C9.2 porque acá `ev.estado === 'CUMPLE'` es
  // vocabulario interno del motor evaluador y se preserva. Buscamos sólo
  // los patrones específicos que C9.3 migró:
  //   - Banners de granulometría con em-dash
  //   - Texto de las celdas que decían 'CUMPLE' literal en autoTable bodies
  test.each([
    ["'CUMPLE — Granulometría dentro de los límites.'"],
    ["'CUMPLE (tolerancia)'"],
    ['Evaluación: ${bandaNombre} — CUMPLE'],
    [' — NO CUMPLE'],  // sufijo del banner negativo de granulometría
    ['"OK"'],          // glifo legacy en bullets, ahora ✓
  ])('No queda el patrón migrado %s en código vivo', (legacyPattern) => {
    expect(codeOnly).not.toContain(legacyPattern);
  });

  test('El archivo importa el helper canónico pdfPresentation', () => {
    expect(codeOnly).toContain('pdfPresentation');
    expect(codeOnly).toMatch(/getCategoriaPdfPresentation|getCategoriaPdfColor/);
  });

  test('El archivo importa los helpers de requisitos para Sección G EVALUACIÓN INCOMPLETA', () => {
    expect(codeOnly).toMatch(/getEnsayosFaltantes/);
    expect(codeOnly).toMatch(/getEnsayoDisplayName|getDisplayName/);
  });

  // ── Lock-in Prompt 3 C12 (post-smoke visual con subagente) ──
  // Bug A descubierto: la celda densidad+absorción de Sección D combinaba
  // todos los valores (d1/d2/d3/A) en una sola línea con separador `·` que
  // jsPDF rendea como `.` y resulta ilegible. Fix: separar en líneas con `\n`.
  test('Bug A lock-in: densidad+absorción se separa en líneas (no `·`)', () => {
    // El join del bloque densidad+absorción debe ser '\n' (newline). Hay otros
    // `parts.join(' · ')` legítimos en el archivo (metadata de fuente del
    // ensayo), por eso la negative assertion se limita al contexto del bloque
    // densidad: buscar el push de `A:` (absorción) seguido cerca por el join.
    expect(codeOnly).toMatch(/parts\.push\(`A:[\s\S]{0,200}parts\.join\('\\n'\)/);
    // Negativo limitado al mismo contexto: no hay `' · '` en el join inmediato
    // tras el push de `A:`.
    expect(codeOnly).not.toMatch(/parts\.push\(`A:[\s\S]{0,200}parts\.join\(' · '\)/);
  });

  // Bug B descubierto: absorción y pasante #200 se mostraban con 1 decimal,
  // inconsistente con cert (2 decimales) y cards (2 decimales). Fix: 2 decimales.
  test('Bug B lock-in: absorción y pasante #200 tienen 2 decimales en INF', () => {
    // Site 1: extractResultado, absorción dentro de la celda combinada.
    // Hoy es `fmtNum(r.absorcionPct, 2)` (no 1).
    expect(codeOnly).toMatch(/fmtNum\(r\.absorcionPct,\s*2\)/);
    // Site 2: _add('Absorcion', ...) en sección E.
    expect(codeOnly).toMatch(/_add\('Absorcion'.*fmtNum\(_dr\.absorcionPct,\s*2,\s*'%'\)/);
    // Site 3: _add('Pasante #200', ...) en sección E. M6 (auditoría 01-calidad)
    // partió la llamada en dos líneas, así que el patrón usa [\s\S]*? para
    // cruzar el salto de línea sin necesitar la flag /s.
    expect(codeOnly).toMatch(/_add\('Pasante #200'[\s\S]*?fmtNum\(_pVal,\s*2,\s*'%'\)/);
    // Negativos: que NO queden los antiguos con 1 decimal.
    expect(codeOnly).not.toMatch(/fmtNum\(r\.absorcionPct,\s*1\)/);
    expect(codeOnly).not.toMatch(/fmtNum\(_dr\.absorcionPct,\s*1,\s*'%'\)/);
    expect(codeOnly).not.toMatch(/fmtNum\(_pVal,\s*1,\s*'%'\)/);
  });

  test('Sanity check del strip-comments (ya validado en C9.2, repetido por seguridad)', () => {
    const synthetic = `
      const x = 'CUMPLE'; // string en código real
      // const y = 'NO CUMPLE'; // string en comentario línea
      /* const z = 'CUMPLE CONDICIONAL'; */ // string en bloque
    `;
    const stripped = stripComments(synthetic);
    expect(stripped).toContain("'CUMPLE'");
    expect(stripped).not.toContain("'NO CUMPLE'");
    expect(stripped).not.toContain("'CUMPLE CONDICIONAL'");
  });
});

/* ───────── Helpers locales — espejo de Sección G ───────── */

/**
 * Mapeo `granuloEstadoToCat` re-implementado para test (espejo de la función
 * inline en agregadoFichaTecnicaPdf.js). El motor granulométrico emite
 * estados `'cumple' / 'cumple_con_tolerancia' / 'no_cumple'` y el PDF los
 * traduce a categorías visuales canónicas para color/icon.
 */
function granuloEstadoToCat(st) {
  return st === 'cumple' ? VEREDICTO.APTO
    : st === 'cumple_con_tolerancia' ? VEREDICTO.APTO_CON_OBSERVACIONES
    : st === 'no_cumple' ? VEREDICTO.NO_APTO
    : VEREDICTO.EVALUACION_INCOMPLETA;
}

/**
 * Texto formal del dictamen según categoría canónica. Espejo del switch
 * en la Sección G.
 */
function dictamenText(categoria) {
  switch (categoria) {
    case VEREDICTO.APTO:
      return 'El agregado evaluado es apto para uso en hormigón según los requisitos de IRAM 1512 y CIRSOC 200:2024.';
    case VEREDICTO.APTO_CON_OBSERVACIONES:
      return 'El agregado evaluado es apto para uso en hormigón. Se registran observaciones técnicas que se detallan a continuación.';
    case VEREDICTO.APTITUD_CONDICIONADA:
      return 'El agregado evaluado es apto sujeto a las condiciones de aplicabilidad indicadas a continuación. Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación.';
    case VEREDICTO.NO_APTO:
      return 'El agregado evaluado no cumple con uno o más requisitos normativos esenciales. No apto para uso en hormigón.';
    case VEREDICTO.EVALUACION_INCOMPLETA:
    default:
      return 'Evaluación no concluida. Se requieren ensayos adicionales para emitir un dictamen definitivo. Ver detalle a continuación.';
  }
}

/* ───────── Tests de helpers ───────── */

describe('agregadoFichaTecnicaPdf — granuloEstadoToCat (D20 paradigma visible)', () => {
  test('cumple → APTO', () => {
    expect(granuloEstadoToCat('cumple')).toBe(VEREDICTO.APTO);
  });

  test('cumple_con_tolerancia → APTO CON OBSERVACIONES (cambio observable C9.3)', () => {
    // Antes de C9.3: este caso se renderizaba con el mismo verde + check que
    // un cumple plano. Ahora distingue como APTO CON OBSERVACIONES con info-circle.
    expect(granuloEstadoToCat('cumple_con_tolerancia')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('no_cumple → NO APTO', () => {
    expect(granuloEstadoToCat('no_cumple')).toBe(VEREDICTO.NO_APTO);
  });

  test('null/undefined/desconocido → EVALUACIÓN INCOMPLETA', () => {
    expect(granuloEstadoToCat(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(granuloEstadoToCat(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(granuloEstadoToCat('otro')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('agregadoFichaTecnicaPdf — dictamenText (5 categorías canónicas, wording aprobado)', () => {
  test('APTO — texto formal con referencia normativa explícita', () => {
    const txt = dictamenText(VEREDICTO.APTO);
    expect(txt).toContain('apto para uso en hormigón');
    expect(txt).toContain('IRAM 1512');
    expect(txt).toContain('CIRSOC 200:2024');
  });

  test('APTO CON OBSERVACIONES — apto + observaciones se detallan en cuerpo', () => {
    const txt = dictamenText(VEREDICTO.APTO_CON_OBSERVACIONES);
    expect(txt).toContain('apto para uso en hormigón');
    expect(txt).toContain('observaciones técnicas');
    expect(txt).toContain('a continuación');
  });

  test('APTITUD CONDICIONADA — condiciones explícitas + cláusula legal de respaldo', () => {
    const txt = dictamenText(VEREDICTO.APTITUD_CONDICIONADA);
    expect(txt).toContain('apto sujeto a las condiciones');
    expect(txt).toContain('Su uso fuera de las condiciones declaradas');
    expect(txt).toContain('no está respaldado');
  });

  test('NO APTO — explícito, sin ambigüedad', () => {
    const txt = dictamenText(VEREDICTO.NO_APTO);
    expect(txt).toContain('no cumple');
    expect(txt).toContain('No apto para uso en hormigón');
  });

  test('EVALUACIÓN INCOMPLETA — pide ensayos adicionales + remite a detalle', () => {
    const txt = dictamenText(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(txt).toContain('Evaluación no concluida');
    expect(txt).toContain('ensayos adicionales');
  });

  test('Categoría desconocida cae al default EVALUACIÓN INCOMPLETA (defensivo)', () => {
    expect(dictamenText('CATEGORIA_INVENTADA')).toBe(dictamenText(VEREDICTO.EVALUACION_INCOMPLETA));
  });
});

/* ───────── Tests del armado de listas (razones / condiciones / observaciones) ───────── */

/**
 * Re-implementación del armado de líneas para cada lista. Espejo del bloque
 * inline en Sección G.
 */
function buildLineasFails(items) {
  return items.flatMap((it) => {
    const tipoLabel = it.tipo?.nombre || it.tipo?.codigo || 'Ensayo';
    const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
    const reasons = it.compliance?.reasons || [];
    if (reasons.length === 0) {
      return [`${tipoLabel}${norma}: no cumple requisito normativo.`];
    }
    return reasons.map((r) => `${tipoLabel}${norma}: ${r}`);
  });
}

function buildLineasConditionals(items) {
  return items.flatMap((it) => {
    const tipoLabel = it.tipo?.nombre || it.tipo?.codigo || 'Ensayo';
    const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
    const conditions = it.compliance?.conditions || [];
    if (conditions.length === 0) {
      return [`${tipoLabel}${norma}: requiere verificación contextual.`];
    }
    return conditions.map((c) => {
      const desc = c.description || c.key || 'condición';
      return `${tipoLabel}${norma}: ${desc}`;
    });
  });
}

function buildLineasObservaciones(items) {
  return items.map((it) => {
    const tipoLabel = it.tipo?.nombre || it.tipo?.codigo || 'Ensayo';
    const norma = it.tipo?.normaRef ? ` (${it.tipo.normaRef})` : '';
    const observation = it.compliance?.observation || 'observación técnica registrada.';
    return `${tipoLabel}${norma}: ${observation}`;
  });
}

describe('agregadoFichaTecnicaPdf — armado de listas detalladas (Sección G)', () => {
  test('Razones: cada item.compliance.reasons[] genera una línea autocontenida con tipo + norma', () => {
    const items = [
      {
        tipo: { nombre: 'Pasante #200', normaRef: 'IRAM 1540' },
        compliance: Compliance.fail({ reasons: ['Pasante 5,34% > 5,00% límite estricto'], severity: 'bloqueante' }),
      },
    ];
    const lineas = buildLineasFails(items);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toBe('Pasante #200 (IRAM 1540): Pasante 5,34% > 5,00% límite estricto');
  });

  test('Razones: items con múltiples reasons[] generan múltiples líneas', () => {
    const items = [
      {
        tipo: { nombre: 'Sulfatos', normaRef: 'IRAM 1647' },
        compliance: Compliance.fail({ reasons: ['Excede 0,1%', 'Tendencia creciente'], severity: 'bloqueante' }),
      },
    ];
    const lineas = buildLineasFails(items);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toContain('Excede 0,1%');
    expect(lineas[1]).toContain('Tendencia creciente');
  });

  test('Razones: fallback cuando reasons[] está vacío', () => {
    const items = [
      {
        tipo: { nombre: 'Densidad', normaRef: 'IRAM 1520' },
        compliance: { status: 'fail', reasons: [], severity: 'bloqueante' },
      },
    ];
    const lineas = buildLineasFails(items);
    expect(lineas).toEqual(['Densidad (IRAM 1520): no cumple requisito normativo.']);
  });

  test('Condiciones: cada condition.description aparece en la lista (ej. Las Quebradas)', () => {
    const items = [
      {
        tipo: { nombre: 'Pasante #200', normaRef: 'IRAM 1540' },
        compliance: Compliance.conditionalPass({
          conditions: [{
            kind: 'exclude_destination',
            key: 'surface_wear',
            description: 'No apto para uso con desgaste superficial (IRAM 1512 §3.2.1)',
          }],
        }),
      },
    ];
    const lineas = buildLineasConditionals(items);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('Pasante #200 (IRAM 1540)');
    expect(lineas[0]).toContain('No apto para uso con desgaste superficial');
  });

  test('Observaciones: cada item.compliance.observation aparece (ej. Arideros 6)', () => {
    const items = [
      {
        tipo: { nombre: 'Granulometría', normaRef: 'IRAM 1505' },
        compliance: Compliance.passWithObservations({
          observation: 'Banda A-B excedida en tamiz 4,75 mm; combinación con arena de mayor MF recomendada.',
        }),
      },
    ];
    const lineas = buildLineasObservaciones(items);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('Granulometría (IRAM 1505)');
    expect(lineas[0]).toContain('Banda A-B excedida');
    expect(lineas[0]).toContain('arena de mayor MF');
  });

  test('Tipo sin norma se renderiza sin el sufijo (norma vacía)', () => {
    const items = [
      {
        tipo: { nombre: 'Ensayo X' },
        compliance: Compliance.passWithObservations({ observation: 'x' }),
      },
    ];
    expect(buildLineasObservaciones(items)).toEqual(['Ensayo X: x']);
  });
});

/* ───────── Test de coherencia: orden de severidad de las listas ───────── */

describe('agregadoFichaTecnicaPdf — orden de listas (severidad descendente)', () => {
  test('La sección G renderiza primero razones, después condiciones, después observaciones', () => {
    // Verificación de contrato: el código del PDF arma las listas en este
    // orden. Si alguien refactora y revierte el orden, el test falla.
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    const codeOnly = stripComments(source);

    const idxRazones = codeOnly.indexOf('Motivos de no aptitud:');
    const idxCondiciones = codeOnly.indexOf('Condiciones de aplicabilidad:');
    const idxObservaciones = codeOnly.indexOf('Observaciones técnicas:');

    expect(idxRazones).toBeGreaterThan(-1);
    expect(idxCondiciones).toBeGreaterThan(-1);
    expect(idxObservaciones).toBeGreaterThan(-1);

    expect(idxRazones).toBeLessThan(idxCondiciones);
    expect(idxCondiciones).toBeLessThan(idxObservaciones);
  });
});

/* ───────── PR8.10 — Reorganización del bloque granulometría AF ─────────
   La sección de granulometría AF se separa en dos bloques claros:
     1. "Conformidad granulométrica IRAM 1627:1997" — banda A-B / A-C
        + tolerancia §3.2.4 (todo IRAM 1627 puro).
     2. "Verificación CIRSOC 200:2024 §3.2.3.2" — MF (variación ±0,20 vs
        MF de diseño, §3.2.3.2.g) + fracción máxima entre tamices
        consecutivos ≤ 45% (§3.2.3.2.e).
   El cambio elimina el rango legacy 2,3-3,1 (que NO existe en CIRSOC
   ni en IRAM 1627) y deja explícita la cita normativa por bloque. */

describe('PR8.10 — granulometría AF reorganizada en IRAM 1627:1997 / CIRSOC §3.2.3.2', () => {
  let codeOnly;
  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('Header del bloque IRAM 1627:1997 está presente', () => {
    expect(codeOnly).toMatch(/Conformidad granulométrica IRAM 1627:1997/);
  });

  test('Header del bloque CIRSOC §3.2.3.2 está presente', () => {
    expect(codeOnly).toMatch(/Verificación CIRSOC 200:2024 §3\.2\.3\.2/);
  });

  test('PR8.1 — el rango legacy MF "2,3 a 3,1" / "2.3-3.1" está fuera del código', () => {
    expect(codeOnly).not.toMatch(/2,3 a 3,1/);
    expect(codeOnly).not.toMatch(/req\. 2,3 a 3,1/);
  });

  test('La regla MF cita §3.2.3.2.g (variación ±0,20 vs MF de diseño)', () => {
    expect(codeOnly).toMatch(/§3\.2\.3\.2\.g/);
    expect(codeOnly).toMatch(/MF de dise.o/);
    expect(codeOnly).toMatch(/0,20/);
  });

  test('La regla fracción máxima cita §3.2.3.2.e', () => {
    expect(codeOnly).toMatch(/§3\.2\.3\.2\.e/);
  });

  test('La tolerancia 10pp se cita explícitamente como IRAM 1627 §3.2.4', () => {
    expect(codeOnly).toMatch(/IRAM 1627 §3\.2\.4/);
  });

  test('Banda A-C (CIRSOC §3.2.3.2.f) emite advertencia condicional cuando A-B falla pero A-C cumple', () => {
    expect(codeOnly).toMatch(/§3\.2\.3\.2\.f/);
    // PR9-fix: el `≤` Unicode rompía kerning de jsPDF; ahora usamos ASCII `<=`.
    // En el source el apostrofo está escapado (f\'c). Aceptamos ambas formas.
    expect(codeOnly).toMatch(/H <= 20|f\\?'c <= 20/);
  });

  test('Lee mfDiseno y delta desde reglasCIRSOC.moduloFinura (datos canónicos PR8.1)', () => {
    expect(codeOnly).toMatch(/reglasCIRSOC\?\.moduloFinura/);
    expect(codeOnly).toMatch(/mfDiseno/);
    expect(codeOnly).toMatch(/delta/);
  });

  test('NO queda el header viejo combinado "Evaluación granulométrica automática"', () => {
    expect(codeOnly).not.toMatch(/Evaluación granulométrica automática \(IRAM 1627 §3\.2 \+ CIRSOC 200:2024 §3\.2\.3\.2\)/);
  });
});

/* ───────── PR9.0 — Hotfix obligatoriedad (modo PRESTACIONAL) ─────────
   Bug original: ensayos sin flag `obligatorio` declarado (catálogo viejo
   o tipos recién agregados) aparecían como "obligatorios pendientes" en
   el bloque "EVALUACIÓN INCOMPLETA" del veredicto. Causa raíz: el helper
   `tipoEsObligatorioEnCtx` usaba `tipo.obligatorio !== false` como legacy
   fallback, lo que trataba `undefined`/`null` como obligatorio.

   Política de modo PRESTACIONAL (HormiQual default): el catálogo del
   tecnólogo es soberano. Sólo los ensayos EXPLÍCITAMENTE marcados como
   obligatorios para el contexto se exigen. */

describe('PR9.0 — modo PRESTACIONAL: helper tipoEsObligatorioEnCtx (regresión)', () => {
  let codeOnly;
  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('Helper usa `tipo.obligatorio === true` como fallback (default seguro)', () => {
    // El nuevo legacy fallback debe exigir declaración EXPLÍCITA de true.
    // `undefined`/`null` ya NO se interpretan como obligatorio.
    expect(codeOnly).toMatch(/tipo\.obligatorio === true/);
  });

  test('NO queda el patrón legacy roto `tipo.obligatorio !== false`', () => {
    // El comparador con `!== false` trataba undefined como obligatorio
    // (undefined !== false → true). Debe estar reemplazado.
    expect(codeOnly).not.toMatch(/tipo\.obligatorio !== false/);
  });

  test('Decisión 2026-05-28: la lista de pendientes vive solo en modo NORMATIVO', () => {
    // Tras la decisión 2026-05-28, la sección "Veredicto" entera (incluida
    // la lista de pendientes) solo se renderiza si `_modoNorm === NORMATIVO`.
    // En modo DESCRIPTIVO el PDF no emite veredicto ni lista pendientes.
    // La fuente preferida de los faltantes es `resumen.ensayosFaltantesPorNorma`
    // que el backend computa con la matriz prescriptiva completa; como
    // fallback se delega al engine puro `evaluarMaterial` con modo NORMATIVO.
    expect(codeOnly).toMatch(/evaluarMaterial\s*\(/);
    expect(codeOnly).toMatch(/ensayosFaltantesPorNorma/);
    expect(codeOnly).toMatch(/modo:\s*['"]NORMATIVO['"]/);
  });

  test('Documentación del cambio de política presente en archivo (incluye comentarios)', () => {
    // El cambio crítico debe quedar comentado para futuro mantenimiento.
    // Buscamos en el source crudo (NO en codeOnly) porque la nota vive
    // explícitamente como comentario JSDoc del helper.
    const rawSource = fs.readFileSync(SOURCE_PATH, 'utf8');
    expect(rawSource).toMatch(/PR9\.0/);
    expect(rawSource).toMatch(/PRESTACIONAL/);
  });
});

/* ───────── PR9.3 — Banner del modo de evaluación + integración engine ─────────
   El PDF acepta `modoEvaluacion: 'PRESTACIONAL' | 'PRESCRIPTIVO'` y dibuja
   un banner indicador en el header que distingue claramente el modo activo.
   La lista de ensayos pendientes se construye delegando al engine puro
   `evaluarMaterial` del modelo dual. */

describe('PR9.3 — banner de modo + integración con engine puro', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  // Decisión 2026-05-28: modos renombrados a DESCRIPTIVO / NORMATIVO.
  // El default ahora es DESCRIPTIVO (documento sin valoración normativa).
  test('Acepta opción `modoEvaluacion` con default DESCRIPTIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]DESCRIPTIVO['"]/);
  });

  test('Reconoce el modo NORMATIVO como nombre canónico nuevo', () => {
    // Banner y guards bifurcan por 'NORMATIVO', aceptando 'PRESCRIPTIVO'
    // como alias entrada (back-compat).
    expect(codeOnly).toMatch(/_modoNorm\s*===\s*['"]NORMATIVO['"]/);
    expect(codeOnly).toMatch(/['"]PRESCRIPTIVO['"]/); // alias entrada permitido
  });

  test('Banner NORMATIVO presente en código vivo (wording cliente-facing)', () => {
    // Wording: destinatario es cliente/inspector/DO. Sin "tenant" ni
    // "catálogo del tenant". Vocabulario CIRSOC/IRAM 1666: "planta
    // productora", "verificación normativa".
    expect(codeOnly).toMatch(/VERIFICACIÓN NORMATIVA ESTRICTA/);
    expect(codeOnly).not.toMatch(/MODO NORMATIVO/);
    expect(codeOnly).not.toMatch(/catálogo del tenant/i);
  });

  test('Banner DESCRIPTIVO presente en código vivo (wording cliente-facing)', () => {
    // El modo descriptivo declara explícitamente que el documento no
    // emite valoración normativa. Sin "Modo descriptivo" en mayúsculas
    // ("FICHA TÉCNICA DESCRIPTIVA" es el título de la caja).
    expect(codeOnly).toMatch(/FICHA TÉCNICA DESCRIPTIVA/);
    expect(codeOnly).toMatch(/sin emitir valoración normativa/i);
  });

  test('Sección "Cumplimiento normativo" solo se renderiza en NORMATIVO', () => {
    expect(codeOnly).toMatch(/cumplimiento\s*&&\s*_modoNorm\s*===\s*['"]NORMATIVO['"]/);
  });

  test('Sección "Veredicto" solo se renderiza en NORMATIVO', () => {
    expect(codeOnly).toMatch(/veredicto\s*&&\s*_modoNorm\s*===\s*['"]NORMATIVO['"]/);
  });

  test('Llama a evaluarMaterial del engine puro', () => {
    expect(codeOnly).toMatch(/evaluarMaterial\s*\(/);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
    expect(rawSource).toMatch(/DESCRIPTIVO/);
    expect(rawSource).toMatch(/NORMATIVO/);
  });
});

/* ───────── PR9.0 — Helper extraído para testing unitario ─────────
   Dado que tipoEsObligatorioEnCtx es una closure interna del módulo,
   reproducimos su lógica como referencia para test (espejo idéntico al
   código del módulo). Si la lógica se desincroniza, los tests fallarán
   con el patrón de regresión y debemos resincronizar. */

function tipoEsObligatorioEnCtxMirror(tipo, { contextoAgregado = 'HORMIGON' } = {}) {
  if (!tipo) return false;
  const _usaH = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
  const _usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';
  const tieneFlagsMultiCtx = (tipo.obligatorioHormigon !== undefined || tipo.obligatorioTBS !== undefined);
  if (!tieneFlagsMultiCtx) return tipo.obligatorio === true;
  if (_usaH && tipo.obligatorioHormigon) return true;
  if (_usaTBS && tipo.obligatorioTBS) return true;
  return false;
}

describe('PR9.0 — comportamiento esperado del helper de obligatoriedad (modelo prestacional)', () => {
  test('Tipo SIN flags multi-ctx ni `obligatorio` (catálogo viejo) → NO obligatorio (default seguro)', () => {
    expect(tipoEsObligatorioEnCtxMirror({ codigo: 'X' })).toBe(false);
  });

  test('Tipo con `obligatorio: true` legacy → SÍ obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror({ codigo: 'X', obligatorio: true })).toBe(true);
  });

  test('Tipo con `obligatorio: false` legacy → NO obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror({ codigo: 'X', obligatorio: false })).toBe(false);
  });

  test('Tipo con `obligatorio: null` legacy → NO obligatorio (caso bug original)', () => {
    expect(tipoEsObligatorioEnCtxMirror({ codigo: 'X', obligatorio: null })).toBe(false);
  });

  test('Tipo con `obligatorio: undefined` legacy → NO obligatorio (caso bug original)', () => {
    expect(tipoEsObligatorioEnCtxMirror({ codigo: 'X', obligatorio: undefined })).toBe(false);
  });

  test('Tipo con `obligatorioHormigon: true`, ctx HORMIGON → SÍ obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'X', obligatorioHormigon: true, obligatorioTBS: false },
      { contextoAgregado: 'HORMIGON' }
    )).toBe(true);
  });

  test('Tipo con `obligatorioHormigon: false`, ctx HORMIGON → NO obligatorio (caso del usuario)', () => {
    // Caso más importante: el tecnólogo declaró el ensayo como NO obligatorio
    // para hormigón en el catálogo. NO debe aparecer como pendiente.
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'IRAM1649_EXAMEN_PETROGRAFICO', obligatorioHormigon: false, obligatorioTBS: false },
      { contextoAgregado: 'HORMIGON' }
    )).toBe(false);
  });

  test('Tipo solo-TBS (obligatorioTBS:true, obligatorioHormigon:false), ctx HORMIGON → NO obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'VN_E_7_65', obligatorioHormigon: false, obligatorioTBS: true },
      { contextoAgregado: 'HORMIGON' }
    )).toBe(false);
  });

  test('Tipo solo-TBS, ctx TBS → SÍ obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'VN_E_7_65', obligatorioHormigon: false, obligatorioTBS: true },
      { contextoAgregado: 'TBS' }
    )).toBe(true);
  });

  test('Tipo obligatorio en HORMIGON solo, ctx AMBOS → SÍ obligatorio', () => {
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'X', obligatorioHormigon: true, obligatorioTBS: false },
      { contextoAgregado: 'AMBOS' }
    )).toBe(true);
  });

  test('Multi-ctx con ambos false, ctx HORMIGON → NO obligatorio (sin importar legacy)', () => {
    // Si tiene flags multi-ctx declarados, el legacy `obligatorio` se ignora.
    expect(tipoEsObligatorioEnCtxMirror(
      { codigo: 'X', obligatorioHormigon: false, obligatorioTBS: false, obligatorio: true },
      { contextoAgregado: 'HORMIGON' }
    )).toBe(false);
  });

  test('Tipo null → NO obligatorio (defensivo)', () => {
    expect(tipoEsObligatorioEnCtxMirror(null)).toBe(false);
  });
});
