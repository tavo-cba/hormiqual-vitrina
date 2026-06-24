/**
 * Tests para `findGranulometriaEnsayo` y `isGranulometria` —
 * helpers internos de `agregadoFichaTecnicaPdf.js`.
 *
 * Bug objetivo (test23.pdf): el backend agrupa los códigos
 * `IRAM1505_GRANULOMETRIA_HORMIGON` y `_TBS` bajo un único canónico
 * (`IRAM1505_GRANULOMETRIA`) en `getResumen`. Si el ensayo TBS es más
 * reciente, el item agrupado puede mostrar `tipo.codigo` HORMIGON pero
 * `ultimoEnsayo` proveniente del ensayo TBS. La ficha técnica del agregado
 * para hormigón terminaba renderizando los 3 puntos del huso DNV.
 *
 * El fix introduce filtrado defensivo por `ultimoEnsayo.contextoAplicacion`.
 */

import { __test__ } from '../agregadoFichaTecnicaPdf';

const { isGranulometria, findGranulometriaEnsayo } = __test__;

describe('isGranulometria — whitelist HORMIGON / blacklist TBS', () => {
  test('código IRAM1505_GRANULOMETRIA_HORMIGON → true', () => {
    expect(isGranulometria({ tipo: { codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON' } })).toBe(true);
  });

  test('código IRAM1505_GRANULOMETRIA (legacy) → true', () => {
    expect(isGranulometria({ tipo: { codigo: 'IRAM1505_GRANULOMETRIA' } })).toBe(true);
  });

  test('código IRAM1505_GRANULOMETRIA_TBS → false', () => {
    expect(isGranulometria({ tipo: { codigo: 'IRAM1505_GRANULOMETRIA_TBS' } })).toBe(false);
  });

  test('nombre "Granulometría (TBS)" sin código → false (fallback excluye tbs)', () => {
    expect(isGranulometria({ tipo: { nombre: 'Granulometría (TBS)' } })).toBe(false);
  });

  test('nombre "Granulometría" sin código → true', () => {
    expect(isGranulometria({ tipo: { nombre: 'Granulometría' } })).toBe(true);
  });
});

describe('findGranulometriaEnsayo — filtro por contextoAplicacion (bug test23)', () => {
  // Helper para construir items del resumen.
  const itemConGranulometria = ({ codigo, contexto, fecha, tamices }) => ({
    tipo: { codigo, nombre: `Granulometría (${codigo})` },
    ultimoEnsayo: {
      id: Math.random(),
      fechaEnsayo: fecha,
      contextoAplicacion: contexto,
      resultado: { granulometria: { tamices } },
    },
  });

  const tamicesHormigon = [
    { abertura: 26.5, pasa: 100 },
    { abertura: 19, pasa: 95 },
    { abertura: 12.5, pasa: 80 },
    { abertura: 9.5, pasa: 60 },
    { abertura: 4.75, pasa: 30 },
    { abertura: 2.36, pasa: 15 },
    { abertura: 1.18, pasa: 7 },
  ];

  const tamicesTBS = [
    { abertura: 26.5, pasa: 97.5 },
    { abertura: 19, pasa: 50 },
    { abertura: 4.75, pasa: 0.5 },
  ];

  test('Resumen con HORMIGON viejo + TBS reciente → elige HORMIGON (no se cuela TBS)', () => {
    const items = [
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON',
        contexto: 'HORMIGON',
        fecha: '2026-01-15',
        tamices: tamicesHormigon,
      }),
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA_TBS',
        contexto: 'TBS',
        fecha: '2026-04-20',
        tamices: tamicesTBS,
      }),
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo).not.toBeNull();
    expect(granEnsayo.contextoAplicacion).toBe('HORMIGON');
    expect(granEnsayo.resultado.granulometria.tamices).toHaveLength(7);
  });

  test('Item agrupado con código display HORMIGON pero ultimoEnsayo es TBS → descarta', () => {
    // Caso concreto del bug test23: el alias map del backend colapsa
    // _HORMIGON y _TBS bajo _GRANULOMETRIA, y el resumen elige el más
    // reciente (TBS) a pesar del display HORMIGON.
    const items = [
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA',
        contexto: 'TBS',                       // ← contexto del ensayo concreto
        fecha: '2026-04-20',
        tamices: tamicesTBS,
      }),
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo).toBeNull();
  });

  test('Solo TBS cargado → devuelve null (no usa TBS como fallback)', () => {
    const items = [
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA_TBS',
        contexto: 'TBS',
        fecha: '2026-04-20',
        tamices: tamicesTBS,
      }),
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo).toBeNull();
  });

  test('Solo HORMIGON cargado → devuelve HORMIGON', () => {
    const items = [
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON',
        contexto: 'HORMIGON',
        fecha: '2026-01-15',
        tamices: tamicesHormigon,
      }),
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo.contextoAplicacion).toBe('HORMIGON');
  });

  test('contextoAplicacion AMBOS → se acepta como granulometría hormigón', () => {
    const items = [
      itemConGranulometria({
        codigo: 'IRAM1505_GRANULOMETRIA',
        contexto: 'AMBOS',
        fecha: '2026-04-20',
        tamices: tamicesHormigon,
      }),
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo).not.toBeNull();
    expect(granEnsayo.contextoAplicacion).toBe('AMBOS');
  });

  test('Sin contextoAplicacion declarado (back-compat) → se acepta', () => {
    // Datos viejos pre-PR9-fix: contextoAplicacion = null/undefined.
    const items = [
      {
        tipo: { codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON', nombre: 'Granulometría' },
        ultimoEnsayo: {
          id: 1,
          fechaEnsayo: '2026-01-15',
          // sin contextoAplicacion
          resultado: { granulometria: { tamices: tamicesHormigon } },
        },
      },
    ];
    const granEnsayo = findGranulometriaEnsayo(null, { items });
    expect(granEnsayo).not.toBeNull();
  });

  test('Plain ensayos list (sin resumen): TBS se descarta', () => {
    const ensayos = [
      {
        tipo: { codigo: 'IRAM1505_GRANULOMETRIA_TBS', nombre: 'Granulometría TBS' },
        contextoAplicacion: 'TBS',
        fechaEnsayo: '2026-04-20',
        resultado: { granulometria: { tamices: tamicesTBS } },
      },
    ];
    const granEnsayo = findGranulometriaEnsayo(ensayos, null);
    expect(granEnsayo).toBeNull();
  });
});
