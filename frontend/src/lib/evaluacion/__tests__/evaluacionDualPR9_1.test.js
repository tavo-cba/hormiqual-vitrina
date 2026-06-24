/**
 * PR9.1 — Tests del espejo frontend del modelo de evaluación dual.
 *
 * Misma cobertura conceptual que `hormiqual-backend/__tests__/evaluacionDualPR9_1.test.js`.
 * Si los tests del espejo divergen del backend, hay que actualizar el mirror.
 */

import {
  evaluarMaterial,
  evaluarDual,
  evaluarPrestacional,
  evaluarPrescriptivo,
  MODO_PRESCRIPTIVO,
  MODO_PRESTACIONAL,
  VEREDICTO,
  SEVERIDAD_DESVIO,
  normalizarModo,
  emptyEvaluacionResult,
} from '../index';

const tipoGranulometria = {
  codigo: 'IRAM1505_GRANULOMETRIA',
  nombre: 'Granulometría',
  normaRef: 'IRAM 1505',
  aplicaAHormigon: true,
  obligatorioHormigon: true,
};

const tipoCloruros = {
  codigo: 'IRAM1882_CLORUROS_SOLUBLES',
  nombre: 'Cloruros solubles',
  normaRef: 'IRAM 1882',
  aplicaAHormigon: true,
  obligatorioHormigon: true,
};

const tipoPetrograficoNoOblig = {
  codigo: 'IRAM1649_EXAMEN_PETROGRAFICO',
  nombre: 'Examen petrográfico',
  normaRef: 'IRAM 1649',
  aplicaAHormigon: true,
  obligatorioHormigon: false,  // tenant decidió que NO es obligatorio
};

const itemOk = (tipo) => ({
  tipo,
  ultimoEnsayo: { resultado: { x: 1 } },
  compliance: { status: 'pass' },
});

const itemFail = (tipo, severity = SEVERIDAD_DESVIO.BLOQUEANTE) => ({
  tipo,
  ultimoEnsayo: { resultado: { x: 99 } },
  compliance: { status: 'fail', severity, reason: 'excede límite' },
});

const itemPendiente = (tipo) => ({
  tipo,
  ultimoEnsayo: null,
  compliance: { status: 'pending' },
});

describe('PR9.1 frontend mirror — contrato', () => {
  // Decisión 2026-05-28: nombres canónicos renombrados a DESCRIPTIVO / NORMATIVO.
  // `normalizarModo` mapea aliases viejos PRESTACIONAL→DESCRIPTIVO,
  // PRESCRIPTIVO→NORMATIVO. El default ahora es DESCRIPTIVO.
  test('normalizarModo defaultea a DESCRIPTIVO y mapea aliases viejos', () => {
    const { MODO_DESCRIPTIVO, MODO_NORMATIVO } = require('../index');
    expect(normalizarModo(null)).toBe(MODO_DESCRIPTIVO);
    expect(normalizarModo('descriptivo')).toBe(MODO_DESCRIPTIVO);
    expect(normalizarModo('normativo')).toBe(MODO_NORMATIVO);
    // Aliases viejos siguen aceptados como entrada (back-compat).
    expect(normalizarModo('prescriptivo')).toBe(MODO_NORMATIVO);
    expect(normalizarModo('PRESTACIONAL')).toBe(MODO_DESCRIPTIVO);
  });

  test('emptyEvaluacionResult tiene shape contractual', () => {
    const r = emptyEvaluacionResult(MODO_PRESTACIONAL);
    expect(r.veredicto).toBe(VEREDICTO.INCOMPLETO);
    expect(r.itemsVisibles).toEqual([]);
    expect(r.ensayosFaltantes).toEqual([]);
  });
});

describe('PR9.1 frontend mirror — PRESTACIONAL (catálogo soberano)', () => {
  test('Petrográfico no obligatorio cargado con FAIL no se menciona', () => {
    const r = evaluarPrestacional({
      items: [
        itemOk(tipoGranulometria),
        itemOk(tipoCloruros),
        itemFail(tipoPetrograficoNoOblig),
      ],
      contextoAgregado: 'HORMIGON',
    });
    expect(r.itemsVisibles).toHaveLength(2);
    expect(r.desviosNormativos).toHaveLength(0);
    expect(r.veredicto).toBe(VEREDICTO.APTO);
  });

  test('Petrográfico no obligatorio + pendiente NO aparece como faltante (caso del usuario)', () => {
    const r = evaluarPrestacional({
      items: [
        itemOk(tipoGranulometria),
        itemPendiente(tipoPetrograficoNoOblig),
      ],
      contextoAgregado: 'HORMIGON',
    });
    expect(r.ensayosFaltantes).toHaveLength(0);
    expect(r.veredicto).toBe(VEREDICTO.APTO);
  });

  test('Item obligatorio cargado con FAIL bloqueante → veredicto NO_APTO', () => {
    const r = evaluarPrestacional({
      items: [
        itemOk(tipoGranulometria),
        itemFail(tipoCloruros, SEVERIDAD_DESVIO.BLOQUEANTE),
      ],
      contextoAgregado: 'HORMIGON',
    });
    expect(r.veredicto).toBe(VEREDICTO.NO_APTO);
  });

  test('Faltante obligatorio (cloruros pendiente) → veredicto INCOMPLETO', () => {
    const r = evaluarPrestacional({
      items: [
        itemOk(tipoGranulometria),
        itemPendiente(tipoCloruros),
      ],
      contextoAgregado: 'HORMIGON',
    });
    expect(r.veredicto).toBe(VEREDICTO.INCOMPLETO);
  });

  test('Tipo legacy sin flags → NO obligatorio (default seguro PR9.0)', () => {
    const tipoLegacy = { codigo: 'X', nombre: 'X', normaRef: 'XXX' };
    const r = evaluarPrestacional({
      items: [itemPendiente(tipoLegacy)],
      contextoAgregado: 'HORMIGON',
    });
    expect(r.ensayosFaltantes).toHaveLength(0);
  });
});

describe('PR9.1 frontend mirror — PRESCRIPTIVO (norma soberana)', () => {
  test('codigosNormativosAdicionales suma a los exigibles por la matriz (PR9.3)', () => {
    // Con PR9.3, el mirror del prescriptivo usa la matriz consolidada del
    // frontend. Sin contexto declarado, toda la matriz se trata como unknown→
    // required (regla conservadora). Verificamos que los códigos extra estén
    // incluidos junto con los de la matriz.
    const r = evaluarPrescriptivo({
      items: [],
      codigosNormativosAdicionales: ['CODIGO_CUSTOM_XYZ'],
    });
    const codigos = r.ensayosFaltantes.map((f) => f.codigo);
    expect(codigos).toContain('CODIGO_CUSTOM_XYZ');
    expect(codigos).toContain('IRAM1505_GRANULOMETRIA'); // matriz
    expect(r.veredicto).toBe(VEREDICTO.INCOMPLETO);
  });

  test('FAIL en item presente produce desvío con severidad bloqueante por default', () => {
    const r = evaluarPrescriptivo({
      items: [itemFail(tipoCloruros)],
    });
    const desv = r.desviosNormativos.find((d) => d.codigo === 'IRAM1882_CLORUROS_SOLUBLES');
    expect(desv).toBeDefined();
    expect(desv.severidad).toBe(SEVERIDAD_DESVIO.BLOQUEANTE);
    expect(r.veredicto).toBe(VEREDICTO.NO_APTO);
  });
});

describe('PR9.1 frontend mirror — entry point + dual', () => {
  test('evaluarMaterial delega correctamente al modo solicitado (canónico nuevo)', () => {
    const { MODO_DESCRIPTIVO, MODO_NORMATIVO } = require('../index');
    const data = { items: [itemOk(tipoGranulometria)], contextoAgregado: 'HORMIGON' };
    expect(evaluarMaterial(data, { modo: MODO_NORMATIVO }).modo).toBe(MODO_NORMATIVO);
    expect(evaluarMaterial(data, { modo: MODO_DESCRIPTIVO }).modo).toBe(MODO_DESCRIPTIVO);
    expect(evaluarMaterial(data).modo).toBe(MODO_DESCRIPTIVO);  // default
    // Back-compat: aliases viejos siguen siendo aceptados como entrada.
    expect(evaluarMaterial(data, { modo: MODO_PRESCRIPTIVO }).modo).toBe(MODO_NORMATIVO);
    expect(evaluarMaterial(data, { modo: MODO_PRESTACIONAL }).modo).toBe(MODO_DESCRIPTIVO);
  });

  test('evaluarDual devuelve ambos resultados', () => {
    const r = evaluarDual({
      items: [itemOk(tipoGranulometria), itemOk(tipoCloruros)],
      contextoAgregado: 'HORMIGON',
      codigosNormativosAdicionales: ['NORMA_EXTRA_FALTANTE'],
    });
    expect(r.prestacional.veredicto).toBe(VEREDICTO.APTO);
    expect(r.prescriptivo.veredicto).toBe(VEREDICTO.INCOMPLETO);
  });
});
