/**
 * Tests Prompt 3 C8 — CumplimientoBadge (componente compartido).
 *
 * Verifica el helper de resolución `resolveCategoria` (espina dorsal del badge):
 *
 *   1. Precedencia: compliance directo > _evaluacion.compliance persistido > legacy.
 *   2. Patrón Hybrid Option B: ensayo con legacy NO_CUMPLE + canónico
 *      passWithObservations resuelve a APTO_CON_OBSERVACIONES (no NO APTO).
 *   3. Robustez: resultado como string JSON (BD MySQL JSON column), JSON
 *      inválido, ensayo null/undefined.
 *
 * No testeamos el render visual del Tag (PrimeReact) — sólo la lógica de
 * resolución, que es lo que cambia el comportamiento observable. El render
 * del Tag con CATEGORIA_COLORS está cubierto en compliance.test.js.
 */

import { Compliance, VEREDICTO } from '../../../../lib/compliance';
import { resolveCategoria } from '../CumplimientoBadge';

describe('CumplimientoBadge — resolveCategoria (precedencia)', () => {
  test('compliance directo gana sobre ensayo (caller ya resolvió)', () => {
    // Caso: AgregadoEnsayosPage pasa `item.compliance` desde resumen del
    // backend (C6.5). Ese compliance gana incluso si el ensayo legacy dice otra cosa.
    const ensayo = { cumple: 'CUMPLE' };
    const compliance = Compliance.fail({ reasons: ['x'], severity: 'bloqueante' });
    expect(resolveCategoria({ ensayo, compliance })).toBe(VEREDICTO.NO_APTO);
  });

  test('_evaluacion.compliance persistido gana sobre legacy cumple (Hybrid B)', () => {
    // Patrón D15/D20: el ensayo se persistió con legacy NO_CUMPLE pero el
    // motor canónico devolvió passWithObservations. El badge debe mostrar
    // APTO_CON_OBSERVACIONES, no NO APTO.
    const ensayo = {
      cumple: 'NO_CUMPLE',
      resultado: {
        valor: 4.5,
        _evaluacion: {
          compliance: Compliance.passWithObservations({ observation: 'banda nivel 1' }),
        },
      },
    };
    expect(resolveCategoria({ ensayo })).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('Sin compliance → fallback a fromLegacyEval por cumple ENUM', () => {
    expect(resolveCategoria({ ensayo: { cumple: 'CUMPLE' } })).toBe(VEREDICTO.APTO);
    expect(resolveCategoria({ ensayo: { cumple: 'NO_CUMPLE' } })).toBe(VEREDICTO.NO_APTO);
    expect(resolveCategoria({ ensayo: { cumple: 'NO_EVAL' } })).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('compliance.conditionalPass → APTITUD CONDICIONADA (caso paradigmático Petrográfico reactivo)', () => {
    const ensayo = {
      cumple: 'NO_CUMPLE',
      resultado: {
        _evaluacion: {
          compliance: Compliance.conditionalPass({
            conditions: [{ kind: 'requires_mitigation', key: 'ras', description: 'Cemento bajo álcali' }],
          }),
        },
      },
    };
    expect(resolveCategoria({ ensayo })).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });
});

describe('CumplimientoBadge — resolveCategoria (robustez)', () => {
  test('resultado como string JSON (MySQL JSON column) se parsea', () => {
    const ensayo = {
      cumple: 'NO_CUMPLE',
      resultado: JSON.stringify({
        valor: 0.7,
        _evaluacion: {
          compliance: { status: 'passWithObservations', observation: 'zona dual' },
        },
      }),
    };
    expect(resolveCategoria({ ensayo })).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('resultado JSON inválido (string roto) → fallback al legacy', () => {
    const ensayo = {
      cumple: 'CUMPLE',
      resultado: '{not valid json',
    };
    expect(resolveCategoria({ ensayo })).toBe(VEREDICTO.APTO);
  });

  test('ensayo null/undefined sin compliance → EVALUACIÓN INCOMPLETA', () => {
    expect(resolveCategoria({ ensayo: null })).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolveCategoria({ ensayo: undefined })).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolveCategoria({})).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('compliance sin status (mal formado) → cae al ensayo', () => {
    const ensayo = { cumple: 'CUMPLE' };
    expect(resolveCategoria({ ensayo, compliance: {} })).toBe(VEREDICTO.APTO);
  });

  test('compliance con status fail blanco (sólo APTO/NO_APTO) sin ensayo', () => {
    expect(resolveCategoria({ compliance: Compliance.pass() })).toBe(VEREDICTO.APTO);
    expect(resolveCategoria({ compliance: Compliance.fail({ reasons: ['x'], severity: 'bloqueante' }) })).toBe(VEREDICTO.NO_APTO);
  });

  test('compliance.notApplicable → NO APLICA', () => {
    expect(resolveCategoria({ compliance: Compliance.notApplicable({ reason: 'no medible' }) })).toBe(VEREDICTO.NO_APLICA);
  });

  test('compliance.informative → INFORMATIVO', () => {
    expect(resolveCategoria({ compliance: Compliance.informative({ note: 'sólo dato' }) })).toBe(VEREDICTO.INFORMATIVO);
  });
});

describe('CumplimientoBadge — cambio observable C8', () => {
  test('REGRESIÓN — Hybrid Option B no debe contaminar como NO APTO', () => {
    // Antes de C8: un ensayo con legacy NO_CUMPLE se renderizaba como "No cumple"
    // (rojo) sin importar el compliance canónico. Después de C8: el canónico
    // gana y se ve como APTO CON OBSERVACIONES (verde con info).
    const ensayoHybridB = {
      cumple: 'NO_CUMPLE',
      resultado: {
        _evaluacion: { compliance: Compliance.passWithObservations({ observation: 'cerca límite' }) },
      },
    };
    expect(resolveCategoria({ ensayo: ensayoHybridB })).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
    // Y NO debe ser NO APTO bajo ninguna interpretación.
    expect(resolveCategoria({ ensayo: ensayoHybridB })).not.toBe(VEREDICTO.NO_APTO);
  });
});
