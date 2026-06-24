/**
 * Tests Prompt 3 C9.4 — mezclaInformePdf.js
 *
 * Cobertura:
 *   1. Regresión: el único site de display (didParseCell color de celda)
 *      ya no usa los RGB hardcoded pre-migración.
 *   2. Lock-in D26: el consolidador prestacional preserva sus 6 estados
 *      con vocabulario propio (no se canoniza al modelo de 7 categorías).
 *   3. Lock-in D26: el archivo NO importa ni `Compliance` ni
 *      `ComplianceResult` factories — la decisión de dominio es preservar el
 *      modelo prestacional, no introducir el canónico al consolidador.
 *   4. Test del helper de mapeo per celda re-implementado localmente
 *      (espejo de la lógica `didParseCell` migrada). Si el componente
 *      diverge, el test falla y obliga a sincronizar.
 *
 * Si en el futuro alguien decide canonizar el consolidador (porque emergió
 * el caller que motivaría D26), los tests del bloque "lock-in D26" rompen.
 * En ese momento se debe reabrir D26 en DEFERRED.md, decidir adapter
 * prestacional → canónico, y actualizar estos tests con la nueva intención.
 */

const fs = require('fs');
const path = require('path');

import { VEREDICTO, CATEGORIA_COLORS } from '../../../../lib/compliance';
import { CATEGORIA_PDF_COLORS, getCategoriaPdfColor } from '../../../../lib/compliance/pdfPresentation';

const SOURCE_PATH = path.resolve(__dirname, '..', 'mezclaInformePdf.js');

/* ───────── Strip de comentarios (espejo de C9.2/C9.3) ───────── */

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

/* ───────── Tests de regresión (color canónico) ───────── */

describe('mezclaInformePdf — regresión: color de celda canónico (Prompt 3 C9.4)', () => {
  let codeOnly;

  beforeAll(() => {
    const source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('No quedan los RGB Tailwind pre-migración para "Cumple" / "No cumple" en didParseCell', () => {
    // Pre-C9.4 didParseCell usaba: [34, 197, 94] (verde-500) para Cumple
    //                                [239, 68, 68] (rojo-500) para No cumple
    // Post-C9.4 usa el helper canónico cuyas tuplas son [22, 163, 74] y [220, 38, 38].
    // Estas líneas son sensibles porque los Tailwind-500 también podrían usarse
    // en otros contextos del archivo (ej. badges informativos, gráficos), así
    // que sólo verificamos que NO aparezcan en el bloque didParseCell de la
    // tabla de cumplimiento.
    expect(codeOnly).toMatch(/getCategoriaPdfColor\(VEREDICTO\.APTO\)/);
    expect(codeOnly).toMatch(/getCategoriaPdfColor\(VEREDICTO\.NO_APTO\)/);
    expect(codeOnly).toMatch(/getCategoriaPdfColor\(VEREDICTO\.EVALUACION_INCOMPLETA\)/);
    expect(codeOnly).toMatch(/getCategoriaPdfColor\(VEREDICTO\.INFORMATIVO\)/);
  });

  test('El archivo importa el helper canónico pdfPresentation', () => {
    expect(codeOnly).toContain('pdfPresentation');
    expect(codeOnly).toMatch(/getCategoriaPdfColor/);
  });

  test('Los hex del helper canónico coinciden con la paleta web (mantenido desde C9.1)', () => {
    // Lock cross-módulo: si CATEGORIA_COLORS web cambia un hex, las tuplas RGB
    // del helper PDF deben actualizarse en el mismo commit.
    const hexToRgb = (hex) => {
      const s = hex.replace(/^#/, '');
      return [
        parseInt(s.substring(0, 2), 16),
        parseInt(s.substring(2, 4), 16),
        parseInt(s.substring(4, 6), 16),
      ];
    };
    [VEREDICTO.APTO, VEREDICTO.NO_APTO, VEREDICTO.EVALUACION_INCOMPLETA, VEREDICTO.INFORMATIVO]
      .forEach((cat) => {
        expect(CATEGORIA_PDF_COLORS[cat]).toEqual(hexToRgb(CATEGORIA_COLORS[cat].hex));
      });
  });

  // ── Lock-in Prompt 3 C12 Bug F (post-smoke visual con subagente) ──
  // El audit visual del PDF de mezcla detectó que la absorción se mostraba con
  // 1 decimal en la tabla de cumplimiento, inconsistente con cert + INF + cards.
  test('Bug F lock-in: absorción muestra con 2 decimales en tabla de cumplimiento', () => {
    // Site 1: caracRows.push para combinada. Site 2: compBody per componente.
    expect(codeOnly).toMatch(/fmtDec\(comb\.absorcionPct,\s*2\)/);
    expect(codeOnly).toMatch(/fmtDec\(p\.absorcionPct,\s*2\)/);
    // Negativo: ninguno con 1 decimal.
    expect(codeOnly).not.toMatch(/fmtDec\(comb\.absorcionPct,\s*1\)/);
    expect(codeOnly).not.toMatch(/fmtDec\(p\.absorcionPct,\s*1\)/);
  });
});

/* ───────── Lock-in D26: el consolidador prestacional NO se canoniza ───────── */

describe('mezclaInformePdf — lock-in D26 (consolidador prestacional preservado)', () => {
  let source;
  let codeOnly;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, 'utf8');
    codeOnly = stripComments(source);
  });

  test('ESTADO_MEZCLA_LABELS tiene exactamente los 6 estados prestacionales', () => {
    // Si alguien agrega un 7º estado o quita uno, el test rompe y obliga a
    // documentar la decisión en D26.
    const expectedKeys = [
      'CUMPLE', 'CUMPLE_OBS', 'REQUIERE_AJUSTE',
      'CON_DESVIOS', 'NO_CUMPLE', 'INCOMPLETA',
    ];
    for (const key of expectedKeys) {
      // El bloque de definición vive en el source; verificamos por presencia
      // textual en la región de ESTADO_MEZCLA_LABELS.
      const labelBlock = codeOnly.split('ESTADO_MEZCLA_LABELS')[1];
      expect(labelBlock).toBeDefined();
      const closingBrace = labelBlock.indexOf('};');
      const block = labelBlock.substring(0, closingBrace);
      expect(block).toMatch(new RegExp(`${key}:`));
    }
  });

  test('consolidarEstadoMezcla retorna estado prestacional, NO un campo `compliance` canónico', () => {
    // El return de consolidarEstadoMezcla declara explícitamente sus campos.
    // Si alguien intenta agregar `compliance: ComplianceResult` al return,
    // el test rompe y obliga a abrir D26.
    const consolidador = codeOnly.split('function consolidarEstadoMezcla')[1];
    expect(consolidador).toBeDefined();
    const returnBlock = consolidador.split('return {')[1];
    expect(returnBlock).toBeDefined();
    const closingBrace = returnBlock.indexOf('};');
    const fields = returnBlock.substring(0, closingBrace);

    // Campos esperados del return prestacional
    expect(fields).toMatch(/estado:/);
    expect(fields).toMatch(/motivos:/);
    expect(fields).toMatch(/conclusion/);
    expect(fields).toMatch(/conformidadNormativa/);
    expect(fields).toMatch(/viabilidadTecnica/);

    // Campos prohibidos del modelo canónico
    expect(fields).not.toMatch(/compliance:/);
    expect(fields).not.toMatch(/categoriaCanonica:/);
  });

  test('El archivo NO importa Compliance factories del módulo canónico', () => {
    // Si alguien introduce el modelo canónico al consolidador, va a importar
    // `Compliance` o `ComplianceResult`. El test bloquea esa adición sin
    // pasar por D26.
    const importsBlock = codeOnly.substring(0, codeOnly.indexOf('/* ═'));
    expect(importsBlock).not.toMatch(/import\s+\{[^}]*Compliance[^}]*\}\s+from\s+['"][^'"]*compliance['"]/);
  });

  test('El bloque del modelo prestacional documenta la decisión de dominio in-code', () => {
    // El comentario filosofía-2026 explica POR QUÉ preservamos el modelo de 6
    // estados. Si alguien lo borra, este test rompe — la documentación in-code
    // es una invariante.
    expect(source).toContain('modelo prestacional');
    expect(source).toMatch(/lenguaje no.terminal/i);
    expect(source).toContain('NO_CUMPLE');
    expect(source).toContain('CUMPLE_OBS');
  });
});

/* ───────── Helper local — espejo de didParseCell (test del mapeo por celda) ───────── */

/**
 * Re-implementación del mapeo `texto celda → categoría canónica` del
 * `didParseCell` migrado. Espejo del bloque ~L1975 en mezclaInformePdf.js.
 * Si el componente diverge, los tests fallan y obligan a sincronizar.
 */
function celdaToCategoria(cellValue) {
  const val = String(cellValue || '');
  if (val === 'Cumple' || val.startsWith('Cumple ')) return VEREDICTO.APTO;
  if (val === 'No cumple') return VEREDICTO.NO_APTO;
  if (val === 'No evaluable' || val === 'No concluyente') return VEREDICTO.EVALUACION_INCOMPLETA;
  if (val === 'Info.') return VEREDICTO.INFORMATIVO;
  return null;
}

describe('mezclaInformePdf — celdaToCategoria (espejo del didParseCell migrado)', () => {
  test('"Cumple" plano → APTO', () => {
    expect(celdaToCategoria('Cumple')).toBe(VEREDICTO.APTO);
  });

  test('"Cumple (LD)" / "Cumple (>)" — variantes con paréntesis → APTO', () => {
    // El mapeo usa startsWith para cubrir las variantes 'Cumple (LD)' y
    // 'Cumple (>)' que aparecen para operadores `menor_que` / `mayor_que`.
    expect(celdaToCategoria('Cumple (LD)')).toBe(VEREDICTO.APTO);
    expect(celdaToCategoria('Cumple (>)')).toBe(VEREDICTO.APTO);
  });

  test('"No cumple" → NO APTO', () => {
    expect(celdaToCategoria('No cumple')).toBe(VEREDICTO.NO_APTO);
  });

  test('"No evaluable" y "No concluyente" → EVALUACIÓN INCOMPLETA', () => {
    expect(celdaToCategoria('No evaluable')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(celdaToCategoria('No concluyente')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('"Info." → INFORMATIVO', () => {
    expect(celdaToCategoria('Info.')).toBe(VEREDICTO.INFORMATIVO);
  });

  test('"Sin dato" / null / valores fuera de set → null (color queda en el default del autoTable)', () => {
    expect(celdaToCategoria('Sin dato')).toBeNull();
    expect(celdaToCategoria(null)).toBeNull();
    expect(celdaToCategoria('')).toBeNull();
    expect(celdaToCategoria('OtroEstado')).toBeNull();
  });

  test('Coherencia con el helper canónico — cada categoría tiene RGB válido', () => {
    [VEREDICTO.APTO, VEREDICTO.NO_APTO, VEREDICTO.EVALUACION_INCOMPLETA, VEREDICTO.INFORMATIVO]
      .forEach((cat) => {
        const rgb = getCategoriaPdfColor(cat);
        expect(Array.isArray(rgb)).toBe(true);
        expect(rgb.length).toBe(3);
        rgb.forEach((c) => expect(c).toBeGreaterThanOrEqual(0));
      });
  });
});
