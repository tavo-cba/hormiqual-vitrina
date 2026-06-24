/**
 * Tests del espejo frontend `lib/compliance/requisitosEnsayos.js`.
 *
 * Source of truth: backend (`hormiqual-backend/src/domain/requisitosEnsayos.js`).
 * Si el espejo diverge, los chips de RequisitosBaseChecklist y los textos
 * de los PDFs van a contradecirse — este test verifica el contrato del
 * espejo frontend (mismo enum CODE, misma forma de DISPLAY_NAME, mismo
 * fallback).
 */

import {
  CODE,
  ALIAS_MAP,
  DISPLAY_NAME,
  getEnsayosRequeridos,
  getEnsayosFaltantes,
  getDisplayName,
  getCanonicalCodigo,
} from '../requisitosEnsayos';

describe('lib/compliance/requisitosEnsayos — espejo frontend', () => {
  test('CODE expone todas las claves esperadas', () => {
    const expectedKeys = [
      'GRANULOMETRIA', 'PASA_200', 'DENSIDAD_FINO', 'DENSIDAD_GRUESO',
      'TERRONES', 'SALES_SOLUBLES', 'SULFATOS', 'CARBONOSAS', 'CLORUROS',
      'EQUIVALENTE_ARENA', 'LOS_ANGELES', 'DURABILIDAD_SULFATO', 'PETROGRAFICO',
    ];
    expectedKeys.forEach((key) => {
      expect(CODE[key]).toBeDefined();
      expect(typeof CODE[key]).toBe('string');
      expect(CODE[key]).toMatch(/^IRAM\d+_/);
    });
  });

  test('getEnsayosRequeridos sin tipo válido devuelve array vacío', () => {
    expect(getEnsayosRequeridos({})).toEqual([]);
    expect(getEnsayosRequeridos({ tipoAgregado: 'CEMENTO' })).toEqual([]);
  });

  test('getEnsayosRequeridos con FINO incluye base universal', () => {
    const r = getEnsayosRequeridos({ tipoAgregado: 'FINO' });
    const codes = r.map((x) => x.codigo);
    expect(codes).toContain(CODE.GRANULOMETRIA);
    expect(codes).toContain(CODE.PASA_200);
    expect(codes).toContain(CODE.DENSIDAD_FINO);
    expect(codes).toContain(CODE.EQUIVALENTE_ARENA);
    expect(codes).not.toContain(CODE.DENSIDAD_GRUESO);
  });

  test('getEnsayosFaltantes detecta huecos por code', () => {
    const ctx = { tipoAgregado: 'FINO' };
    const presentCodes = [CODE.GRANULOMETRIA, CODE.PASA_200];
    const faltantes = getEnsayosFaltantes(ctx, presentCodes);
    const faltantesCodes = faltantes.map((f) => f.codigo);
    expect(faltantesCodes).toContain(CODE.DENSIDAD_FINO);
    expect(faltantesCodes).not.toContain(CODE.GRANULOMETRIA);
  });
});

describe('lib/compliance/requisitosEnsayos — getDisplayName', () => {
  test('Cada código del enum CODE tiene un nombre legible mapeado', () => {
    Object.values(CODE).forEach((codigo) => {
      expect(DISPLAY_NAME[codigo]).toBeDefined();
      expect(typeof DISPLAY_NAME[codigo]).toBe('string');
      expect(DISPLAY_NAME[codigo].length).toBeGreaterThan(0);
      expect(DISPLAY_NAME[codigo]).not.toMatch(/^IRAM\d+_/);
      expect(DISPLAY_NAME[codigo]).not.toMatch(/_/);
    });
  });

  test('Casos paradigmáticos coinciden con el backend', () => {
    expect(getDisplayName(CODE.GRANULOMETRIA)).toBe('Granulometría');
    expect(getDisplayName(CODE.PASA_200)).toBe('Material fino #200');
    expect(getDisplayName(CODE.DENSIDAD_FINO)).toBe('Densidad y absorción (fino)');
    expect(getDisplayName(CODE.DENSIDAD_GRUESO)).toBe('Densidad y absorción (grueso)');
    expect(getDisplayName(CODE.SULFATOS)).toBe('Sulfatos (SO₃)');
    expect(getDisplayName(CODE.LOS_ANGELES)).toBe('Los Ángeles');
    expect(getDisplayName(CODE.PETROGRAFICO)).toBe('Examen petrográfico');
  });

  test('Código no mapeado → fallback defensivo', () => {
    expect(getDisplayName('IRAM9999_NUEVO_ENSAYO_X')).toBe('Nuevo ensayo x');
    expect(getDisplayName('CODIGO_SIN_IRAM')).toBe('Codigo sin iram');
  });

  test('Inputs inválidos → string vacío', () => {
    expect(getDisplayName(null)).toBe('');
    expect(getDisplayName(undefined)).toBe('');
    expect(getDisplayName('')).toBe('');
    expect(getDisplayName(123)).toBe('');
  });

  // X4 (auditoría 2026-05-08): granulometría APTO en tabla pero "faltante"
  // en motivos. Causa: presentCodes traía el código post-split
  // `IRAM1505_GRANULOMETRIA_HORMIGON` y `getEnsayosFaltantes` comparaba
  // contra el canónico `IRAM1505_GRANULOMETRIA` exacto.
  describe('X4 — alias map y normalización en getEnsayosFaltantes', () => {
    test('ALIAS_MAP normaliza variantes _HORMIGON / _TBS al canónico', () => {
      expect(ALIAS_MAP.IRAM1505_GRANULOMETRIA_HORMIGON).toBe(CODE.GRANULOMETRIA);
      expect(ALIAS_MAP.IRAM1505_GRANULOMETRIA_TBS).toBe(CODE.GRANULOMETRIA);
    });

    test('ALIAS_MAP normaliza variantes legacy de Los Ángeles', () => {
      expect(ALIAS_MAP.IRAM1532_DESGASTE_LA).toBe(CODE.LOS_ANGELES);
      expect(ALIAS_MAP.IRAM1512_DESGASTE_LA).toBe(CODE.LOS_ANGELES);
    });

    test('getCanonicalCodigo devuelve canónico para variantes', () => {
      expect(getCanonicalCodigo('IRAM1505_GRANULOMETRIA_HORMIGON')).toBe(CODE.GRANULOMETRIA);
      expect(getCanonicalCodigo('IRAM1505_GRANULOMETRIA')).toBe(CODE.GRANULOMETRIA);
      expect(getCanonicalCodigo('IRAM1532_DESGASTE_LA')).toBe(CODE.LOS_ANGELES);
    });

    test('getCanonicalCodigo passthrough para códigos sin alias', () => {
      expect(getCanonicalCodigo('IRAM1647_TERRONES_ARCILLA')).toBe('IRAM1647_TERRONES_ARCILLA');
      expect(getCanonicalCodigo(null)).toBe(null);
      expect(getCanonicalCodigo(undefined)).toBe(undefined);
    });

    test('granulometría con variante _HORMIGON NO se reporta como faltante', () => {
      const ctx = { tipoAgregado: 'GRUESO' };
      const presentCodes = [
        'IRAM1505_GRANULOMETRIA_HORMIGON',     // ← variante post-split
        'IRAM1674_MATERIAL_FINO_200',
        'IRAM1533_DENSIDAD_GRUESO',
        'IRAM1647_TERRONES_ARCILLA',
        'IRAM1647_SALES_SOLUBLES',
        'IRAM1647_SULFATOS_SO3',
        'IRAM1647_MATERIAS_CARBONOSAS',
        'IRAM1882_CLORUROS_SOLUBLES',
      ];
      const faltantes = getEnsayosFaltantes(ctx, presentCodes);
      // Granulometría no debe estar en faltantes — está presente como
      // variante _HORMIGON y debe normalizarse al canónico.
      expect(faltantes.find((f) => f.codigo === CODE.GRANULOMETRIA)).toBeUndefined();
    });

    test('Los Ángeles con variante DESGASTE_LA NO se reporta como faltante (con desgaste)', () => {
      const ctx = { tipoAgregado: 'GRUESO', expuestoDesgaste: true };
      const presentCodes = [
        'IRAM1505_GRANULOMETRIA',
        'IRAM1674_MATERIAL_FINO_200',
        'IRAM1533_DENSIDAD_GRUESO',
        'IRAM1647_TERRONES_ARCILLA',
        'IRAM1647_SALES_SOLUBLES',
        'IRAM1647_SULFATOS_SO3',
        'IRAM1647_MATERIAS_CARBONOSAS',
        'IRAM1882_CLORUROS_SOLUBLES',
        'IRAM1532_DESGASTE_LA',  // ← alias del backend
      ];
      const faltantes = getEnsayosFaltantes(ctx, presentCodes);
      expect(faltantes.find((f) => f.codigo === CODE.LOS_ANGELES)).toBeUndefined();
    });

    test('granulometría realmente faltante sí se reporta', () => {
      const ctx = { tipoAgregado: 'GRUESO' };
      const presentCodes = [
        'IRAM1674_MATERIAL_FINO_200',
        'IRAM1533_DENSIDAD_GRUESO',
        // sin granulometría en ninguna variante
      ];
      const faltantes = getEnsayosFaltantes(ctx, presentCodes);
      expect(faltantes.find((f) => f.codigo === CODE.GRANULOMETRIA)).toBeDefined();
    });
  });
});
