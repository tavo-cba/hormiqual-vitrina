const {
  formatProbetaCodigo,
  parseProbetaIdFromCodigo,
  extractProbetaRefFromScan,
  PROBETA_CODIGO_RE,
} = require('../probetaCodigo');

describe('probetaCodigo — formatProbetaCodigo', () => {
  test('Arma PRB-AAAA-NNNNNN con padding a 6 dígitos', () => {
    expect(formatProbetaCodigo(457, '2026-05-12')).toBe('PRB-2026-000457');
    expect(formatProbetaCodigo(1234567, '2026-01-01')).toBe('PRB-2026-1234567'); // no trunca
  });

  test('Toma el año de la fecha sin corrimiento de zona horaria', () => {
    // new Date('2026-01-01') sería 31/12/2025 en UTC-3; el string debe ganar.
    expect(formatProbetaCodigo(1, '2026-01-01')).toBe('PRB-2026-000001');
  });

  test('Acepta Date como fecha', () => {
    expect(formatProbetaCodigo(5, new Date(2024, 0, 15))).toBe('PRB-2024-000005');
  });

  test('Id inválido → null', () => {
    expect(formatProbetaCodigo(0, '2026-05-12')).toBeNull();
    expect(formatProbetaCodigo(-3, '2026-05-12')).toBeNull();
    expect(formatProbetaCodigo(null, '2026-05-12')).toBeNull();
  });
});

describe('probetaCodigo — parseProbetaIdFromCodigo', () => {
  test('Extrae el id del código PRB (descarta ceros a la izquierda)', () => {
    expect(parseProbetaIdFromCodigo('PRB-2026-000457')).toBe(457);
    expect(parseProbetaIdFromCodigo('prb-2026-000001')).toBe(1); // case-insensitive
  });

  test('Acepta id numérico pelado (back-compat con QR viejos)', () => {
    expect(parseProbetaIdFromCodigo('457')).toBe(457);
    expect(parseProbetaIdFromCodigo(457)).toBe(457);
  });

  test('Valores no parseables → null', () => {
    expect(parseProbetaIdFromCodigo('PRB-2026-')).toBeNull();
    expect(parseProbetaIdFromCodigo('abc')).toBeNull();
    expect(parseProbetaIdFromCodigo(null)).toBeNull();
  });

  test('Round-trip format → parse', () => {
    const codigo = formatProbetaCodigo(98765, '2026-05-12');
    expect(parseProbetaIdFromCodigo(codigo)).toBe(98765);
  });

  test('Regex pública matchea el formato canónico', () => {
    expect(PROBETA_CODIGO_RE.test('PRB-2026-000457')).toBe(true);
    expect(PROBETA_CODIGO_RE.test('PRB-26-457')).toBe(false);
  });
});

describe('probetaCodigo — extractProbetaRefFromScan', () => {
  test('Extrae el segmento /p/ de una URL completa (código PRB)', () => {
    expect(extractProbetaRefFromScan('https://app.hormiqual.com/p/PRB-2026-000457'))
      .toBe('PRB-2026-000457');
  });

  test('Extrae el id numérico de una URL (QR viejo)', () => {
    expect(extractProbetaRefFromScan('https://empresa.hormiqual.com/p/457')).toBe('457');
  });

  test('Ignora query/hash tras el segmento', () => {
    expect(extractProbetaRefFromScan('https://x.com/p/PRB-2026-000457?utm=1#x'))
      .toBe('PRB-2026-000457');
  });

  test('Acepta código/id pelado (sin URL)', () => {
    expect(extractProbetaRefFromScan('PRB-2026-000457')).toBe('PRB-2026-000457');
    expect(extractProbetaRefFromScan('457')).toBe('457');
  });

  test('QR ajeno (no resoluble) → null', () => {
    expect(extractProbetaRefFromScan('https://google.com')).toBeNull();
    expect(extractProbetaRefFromScan('texto cualquiera')).toBeNull();
    expect(extractProbetaRefFromScan('')).toBeNull();
    expect(extractProbetaRefFromScan(null)).toBeNull();
  });
});
