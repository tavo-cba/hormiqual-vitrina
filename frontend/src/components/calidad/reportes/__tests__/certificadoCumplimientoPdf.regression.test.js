/**
 * Tests Prompt 3 C9.2 — Regresión D1 para certificadoCumplimientoPdf.
 *
 * D1 (Prompt 1) registró que el PDF tenía strings legacy UPPERCASE hardcoded
 * como veredictos:
 *   - 'CUMPLE'
 *   - 'NO CUMPLE'
 *   - 'CUMPLE CONDICIONAL'
 *   - 'NO EVALUADO'
 *
 * Estos strings producían dos problemas:
 *   1. Comparaciones contra strings literales (frágil ante refactor del enum).
 *   2. Vocabulario INCONSISTENTE con el resto del sistema canónico (que usa
 *      VEREDICTO.APTO / NO_APTO / APTO_CON_OBSERVACIONES / etc).
 *
 * C9.2 cerró D1 para este archivo migrando al helper `pdfPresentation`.
 * Este test LOCK la invariante: si alguien re-introduce uno de los strings
 * legacy en el código (no en comentarios), el test rompe inmediatamente.
 *
 * Implementación: lee el archivo fuente, descarta líneas que son comentario
 * (// ... o líneas dentro de bloques /* ... *\/), y verifica que ninguna
 * de las cadenas D1 aparezca en código vivo.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(
  __dirname,
  '..',
  'certificadoCumplimientoPdf.js',
);

/**
 * Strip de comentarios línea por línea. No es un parser JS completo, pero
 * es suficiente para descartar:
 *   - Líneas que empiezan con `//` (después de whitespace)
 *   - Líneas dentro de un bloque /* ... *\/
 *   - El sufijo `// comentario` al final de una línea de código
 *
 * NO descarta:
 *   - Strings que contienen `//` (ej. 'http://...') — pero las cadenas D1
 *     son palabras simples sin URL, así que no hay riesgo de falso positivo.
 */
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
    // Ahora puede haber bloques /* ... */ inline o un /* sin cerrar.
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
    // Strip de // hasta fin de línea (best effort — no maneja // dentro de strings)
    const slash = line.indexOf('//');
    if (slash >= 0) {
      line = line.substring(0, slash);
    }
    out.push(line);
  }
  return out.join('\n');
}

describe('certificadoCumplimientoPdf — regresión D1 (sin strings legacy en código)', () => {
  let codeOnly;

  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test.each([
    ['CUMPLE'],
    ['NO CUMPLE'],
    ['CUMPLE CONDICIONAL'],
    ['NO EVALUADO'],
  ])('No hay string literal "%s" en código vivo (D1)', (legacyStr) => {
    // Buscar el string entre comillas simples o dobles, como literal de código.
    const single = `'${legacyStr}'`;
    const double = `"${legacyStr}"`;
    expect(codeOnly).not.toContain(single);
    expect(codeOnly).not.toContain(double);
  });

  test('El archivo sí importa el helper canónico pdfPresentation', () => {
    // Sanity check: si alguien revierte la migración borrando el import,
    // este test lo cacha antes que los regex de strings.
    expect(codeOnly).toContain('pdfPresentation');
    expect(codeOnly).toMatch(/getCategoriaPdfLabel|getCategoriaPdfColor|getCategoriaPdfPresentation/);
  });

  test('El helper de strip-comments funciona — sanity check del propio test', () => {
    // Garantiza que NO estamos dando falso negativo por un strip mal hecho.
    // Construímos una source sintética con strings D1 dentro y fuera de comentarios.
    const synthetic = `
      const x = 'CUMPLE'; // string en código real
      // const y = 'NO CUMPLE'; // string en comentario línea
      /* const z = 'CUMPLE CONDICIONAL'; */ // string en bloque
    `;
    const stripped = stripComments(synthetic);
    expect(stripped).toContain("'CUMPLE'");          // detecta el código real
    expect(stripped).not.toContain("'NO CUMPLE'");    // descarta el comentario línea
    expect(stripped).not.toContain("'CUMPLE CONDICIONAL'"); // descarta el bloque
  });
});

/* ───────── PR9.4 — Modelo dual en certificado ─────────
   El certificado acepta `modoEvaluacion` con default PRESTACIONAL (decisión
   arquitectónica: el catálogo del tenant es soberano por default). Estampa
   un banner indicador del modo activo, claramente diferenciado para que el
   lector externo (auditoría / cliente) entienda el alcance del documento. */

describe('PR3 / 2026-05-28 — certificado en modo NORMATIVO siempre', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  // Decisión 2026-05-28: el certificado de cumplimiento normativo pasa a
  // NORMATIVO siempre. Un certificado descriptivo es contradictio in
  // terminis. El argumento modoEvaluacion queda solo por compat de la
  // firma; cualquier valor que apunte a DESCRIPTIVO/PRESTACIONAL se
  // ignora con warning.
  test('Default modoEvaluacion del certificado es NORMATIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]NORMATIVO['"]/);
  });

  test('Si caller pasa DESCRIPTIVO o PRESTACIONAL, se emite warning', () => {
    expect(codeOnly).toMatch(/DESCRIPTIVO['"]\s*\|\|\s*_modoUpperCert\s*===\s*['"]PRESTACIONAL/);
    expect(codeOnly).toMatch(/console\.warn/);
  });

  test('_modoCert fija a MODO_PRESCRIPTIVO siempre (no condicional)', () => {
    expect(codeOnly).toMatch(/const\s+_modoCert\s*=\s*MODO_PRESCRIPTIVO\s*;/);
  });

  test('Banner del certificado tiene título "CERTIFICADO DE CUMPLIMIENTO NORMATIVO"', () => {
    expect(codeOnly).toMatch(/CERTIFICADO DE CUMPLIMIENTO NORMATIVO/);
  });

  test('Banner no contiene jerga prohibida ("tenant", "catálogo de obligatoriedad")', () => {
    expect(codeOnly).not.toMatch(/catálogo del tenant/i);
    expect(codeOnly).not.toMatch(/catálogo de obligatoriedad/);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
    expect(rawSource).toMatch(/NORMATIVO siempre|siempre.*NORMATIVO/);
  });
});
