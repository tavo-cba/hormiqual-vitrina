/**
 * PR3 / decisión 2026-05-28 — Modelo dual DESCRIPTIVO / NORMATIVO en los
 * PDFs restantes: comparación, receta de obra, pastón de prueba.
 *
 * El certificado de cumplimiento normativo se cubre por separado en su
 * suite (pasa a NORMATIVO siempre; sin toggle).
 */

const fs = require('fs');
const path = require('path');

const COMPARACION_PATH = path.resolve(__dirname, '..', 'comparacionInformePdf.js');
const RECETA_PATH = path.resolve(__dirname, '..', 'recetaObraPdf.js');
const PASTON_PATH = path.resolve(__dirname, '..', 'pastonPruebaPdf.js');

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

/* ───────── comparacionInformePdf ───────── */

describe('PR3 — comparacionInformePdf en modelo dual', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(COMPARACION_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  test('Default modoEvaluacion es DESCRIPTIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]DESCRIPTIVO['"]/);
  });

  test('Mapea NORMATIVO + alias viejo PRESCRIPTIVO al canónico nuevo', () => {
    expect(codeOnly).toMatch(/_modoNorm\s*=.*['"]NORMATIVO['"]/);
    expect(codeOnly).toMatch(/['"]PRESCRIPTIVO['"]/); // alias entrada permitido
  });

  test('Banner NORMATIVO presente con wording cliente-facing', () => {
    expect(codeOnly).toMatch(/VERIFICACION NORMATIVA ESTRICTA/);
    expect(codeOnly).not.toMatch(/catálogo del tenant/i);
  });

  test('Banner DESCRIPTIVO presente con wording explícito', () => {
    expect(codeOnly).toMatch(/INFORME COMPARATIVO DESCRIPTIVO/);
    expect(codeOnly).toMatch(/sin emitir valoracion normativa/i);
  });

  test('Banner usa splitTextToSize + altura dinámica (lección PR1)', () => {
    expect(codeOnly).toMatch(/splitTextToSize/);
    expect(codeOnly).toMatch(/bannerH\s*=.*lineH/);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
  });
});

/* ───────── recetaObraPdf ───────── */

describe('PR3 — recetaObraPdf en modelo dual', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(RECETA_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  test('Default modoEvaluacion es DESCRIPTIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]DESCRIPTIVO['"]/);
  });

  test('Mapea NORMATIVO + alias viejo PRESCRIPTIVO al canónico nuevo', () => {
    expect(codeOnly).toMatch(/_modoNorm\s*=.*['"]NORMATIVO['"]/);
    expect(codeOnly).toMatch(/['"]PRESCRIPTIVO['"]/);
  });

  test('Banner NORMATIVO presente', () => {
    expect(codeOnly).toMatch(/RECETA DERIVADA - MODO NORMATIVO/);
  });

  test('Banner DESCRIPTIVO presente', () => {
    expect(codeOnly).toMatch(/RECETA DE OBRA - DATOS PARA PRODUCCION/);
    expect(codeOnly).toMatch(/descriptiva/i);
  });

  test('Banner usa splitTextToSize + altura dinámica', () => {
    expect(codeOnly).toMatch(/splitTextToSize/);
    expect(codeOnly).toMatch(/bannerH\s*=.*lineH/);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
  });
});

/* ───────── pastonPruebaPdf ───────── */

describe('PR3 — pastonPruebaPdf en modelo dual', () => {
  let codeOnly;
  let rawSource;
  beforeAll(() => {
    rawSource = fs.readFileSync(PASTON_PATH, 'utf8');
    codeOnly = stripComments(rawSource);
  });

  test('Default modoEvaluacion es DESCRIPTIVO', () => {
    expect(codeOnly).toMatch(/modoEvaluacion\s*=\s*['"]DESCRIPTIVO['"]/);
  });

  test('Mapea NORMATIVO + alias viejo PRESCRIPTIVO al canónico nuevo', () => {
    expect(codeOnly).toMatch(/_modoNorm\s*=.*['"]NORMATIVO['"]/);
    expect(codeOnly).toMatch(/['"]PRESCRIPTIVO['"]/);
  });

  test('Banner NORMATIVO presente', () => {
    expect(codeOnly).toMatch(/PASTON DE PRUEBA - MODO NORMATIVO/);
  });

  test('Banner DESCRIPTIVO presente', () => {
    expect(codeOnly).toMatch(/PASTON DE PRUEBA - REGISTRO DESCRIPTIVO/);
    expect(codeOnly).toMatch(/sin emitir valoración normativa/i);
  });

  test('Banner usa splitTextToSize + altura dinámica', () => {
    expect(codeOnly).toMatch(/splitTextToSize/);
    expect(codeOnly).toMatch(/bannerH\s*=.*lineH/);
  });

  test('Lock-in D26: vocabulario propio del pastón preservado (APROBADO / RECHAZADO / OBSERVADO)', () => {
    // Decisión D26 caso B: el veredicto experimental del pastón NO migra
    // al canónico APTO/NO APTO. Se preserva independientemente del modo
    // dual del documento.
    expect(codeOnly).toMatch(/['"]APROBADO['"]/);
    expect(codeOnly).toMatch(/['"]RECHAZADO['"]/);
    expect(codeOnly).toMatch(/['"]OBSERVADO['"]/);
  });

  test('Documentación de la decisión 2026-05-28 en source', () => {
    expect(rawSource).toMatch(/2026-05-28/);
  });
});
