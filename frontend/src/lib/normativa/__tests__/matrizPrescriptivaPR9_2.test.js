/**
 * PR9.2 — Tests del mirror frontend de la matriz prescriptiva.
 *
 * Cobertura mínima: contrato + casos críticos + sincronía con backend.
 * La cobertura exhaustiva por celda vive en backend
 * (`__tests__/matrizPrescriptivaPR9_2.test.js`). Acá nos aseguramos de que
 * el mirror sigue la misma lógica.
 */

import {
  MATRIZ_PRESCRIPTIVA,
  esExigible,
  obtenerEnsayosExigibles,
  metadataExigibilidad,
} from '../matrizPrescriptiva';

describe('PR9.2 mirror — shape de la matriz', () => {
  test('Tiene las 19 entradas esperadas (sincronía con backend)', () => {
    const codigos = Object.keys(MATRIZ_PRESCRIPTIVA);
    expect(codigos.length).toBeGreaterThanOrEqual(19);
    // Anclas mínimas — si alguno de estos códigos cambia, el mirror está desincronizado.
    expect(codigos).toContain('IRAM1505_GRANULOMETRIA');
    expect(codigos).toContain('IRAM1525_DURABILIDAD_SULFATO');
    expect(codigos).toContain('IRAM1649_EXAMEN_PETROGRAFICO');
    expect(codigos).toContain('IRAM1700_PRISMA_HORMIGON_RAA');
  });

  test('Cada entrada tiene shape contractual', () => {
    for (const [cod, e] of Object.entries(MATRIZ_PRESCRIPTIVA)) {
      expect(e.codigo).toBe(cod);
      expect(e.nombre).toBeTruthy();
      expect(e.normaRef).toBeTruthy();
      expect(e.cita).toMatch(/IRAM|CIRSOC/);
      expect(Array.isArray(e.aplicaA)).toBe(true);
      expect(typeof e.bloqueante).toBe('boolean');
    }
  });
});

describe('PR9.2 mirror — esExigible', () => {
  test('Granulometría siempre exigible para FINO y GRUESO', () => {
    expect(esExigible('IRAM1505_GRANULOMETRIA', { tipoAgregado: 'FINO' })).toBe('required');
    expect(esExigible('IRAM1505_GRANULOMETRIA', { tipoAgregado: 'GRUESO' })).toBe('required');
  });

  test('Densidad fino solo aplica a FINO', () => {
    expect(esExigible('IRAM1520_DENSIDAD_ABSORCION_FINO', { tipoAgregado: 'GRUESO' })).toBe('not_applicable');
  });

  test('Durabilidad sulfato exigible en C2, no en A1', () => {
    expect(esExigible('IRAM1525_DURABILIDAD_SULFATO', { tipoAgregado: 'GRUESO', claseExposicion: 'C2' })).toBe('required');
    expect(esExigible('IRAM1525_DURABILIDAD_SULFATO', { tipoAgregado: 'GRUESO', claseExposicion: 'A1' })).toBe('not_applicable');
  });

  test('Petrográfico exigible para H≥35 (regla por f\'c)', () => {
    expect(esExigible('IRAM1649_EXAMEN_PETROGRAFICO', { tipoAgregado: 'FINO', fceMpa: 35, claseExposicion: 'A1' })).toBe('required');
    expect(esExigible('IRAM1649_EXAMEN_PETROGRAFICO', { tipoAgregado: 'FINO', fceMpa: 25, claseExposicion: 'A1' })).toBe('not_applicable');
  });

  test('Estabilidad basálticas solo si tipoRoca=BASALTICA', () => {
    expect(esExigible('IRAM1519_ESTABILIDAD_BASALTICAS', { tipoAgregado: 'GRUESO', tipoRoca: 'BASALTICA' })).toBe('required');
    expect(esExigible('IRAM1519_ESTABILIDAD_BASALTICAS', { tipoAgregado: 'GRUESO', tipoRoca: 'GRANITICA' })).toBe('not_applicable');
  });

  test('Datos contextuales faltantes → unknown (regla conservadora)', () => {
    expect(esExigible('IRAM1525_DURABILIDAD_SULFATO', { tipoAgregado: 'GRUESO' })).toBe('unknown');
  });
});

describe('PR9.2 mirror — obtenerEnsayosExigibles', () => {
  test('AG en H-40 C2 contexto completo → durabilidad + petrográfico, sin RAS', () => {
    const r = obtenerEnsayosExigibles({
      tipoAgregado: 'GRUESO', claseExposicion: 'C2', fceMpa: 40,
      evaluacionRas: 'NO_REACTIVO', tipoRoca: 'GRANITICA',
    });
    const codigos = r.map((e) => e.codigo);
    expect(codigos).toContain('IRAM1525_DURABILIDAD_SULFATO');
    expect(codigos).toContain('IRAM1649_EXAMEN_PETROGRAFICO');
    expect(codigos).not.toContain('IRAM1674_RAS_ACELERADO');
    expect(codigos).not.toContain('IRAM1519_ESTABILIDAD_BASALTICAS');
  });

  test('Q4 cloacal contexto completo → todos los RAS', () => {
    const r = obtenerEnsayosExigibles({
      tipoAgregado: 'GRUESO', claseExposicion: 'Q4', fceMpa: 40,
      evaluacionRas: 'POTENCIALMENTE_REACTIVO', tipoRoca: 'GRANITICA',
    });
    const codigos = r.map((e) => e.codigo);
    expect(codigos).toContain('IRAM1674_RAS_ACELERADO');
    expect(codigos).toContain('IRAM1700_PRISMA_HORMIGON_RAA');
  });

  test('unknownComoRequired=false filtra los inciertos', () => {
    const conIncertos = obtenerEnsayosExigibles({}, { unknownComoRequired: true });
    const sinIncertos = obtenerEnsayosExigibles({}, { unknownComoRequired: false });
    expect(sinIncertos.length).toBeLessThan(conIncertos.length);
  });
});

describe('PR9.2 mirror — metadataExigibilidad', () => {
  test('Devuelve metadata cuando exigible', () => {
    const m = metadataExigibilidad('IRAM1525_DURABILIDAD_SULFATO',
      { tipoAgregado: 'GRUESO', claseExposicion: 'C2' });
    expect(m).toBeTruthy();
    expect(m.bloqueante).toBe(true);
    expect(m.cita).toMatch(/CIRSOC/);
  });
  test('Devuelve null cuando no aplica', () => {
    const m = metadataExigibilidad('IRAM1525_DURABILIDAD_SULFATO',
      { tipoAgregado: 'GRUESO', claseExposicion: 'A1' });
    expect(m).toBeNull();
  });
});
