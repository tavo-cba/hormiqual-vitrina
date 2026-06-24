/**
 * Smoke test del lib/compliance — confirma que la infra Jest funciona y
 * que los 10 estados canónicos están sincronizados con el backend.
 *
 * Prompt 3 C1: marcador inicial.
 * Prompt 3 C2: actualizado para verificar los 10 estados.
 */

import { STATUS, ALL_STATUSES, Compliance } from '../index';

describe('lib/compliance — smoke test', () => {
  test('STATUS está exportado y congelado', () => {
    expect(STATUS).toBeDefined();
    expect(Object.isFrozen(STATUS)).toBe(true);
  });

  test('Compliance.pass() produce ComplianceResult válido', () => {
    const r = Compliance.pass({ message: 'OK' });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.message).toBe('OK');
  });

  test('Compliance.fail() lanza si no hay reasons', () => {
    expect(() => Compliance.fail({ reasons: [] })).toThrow();
  });

  test('Post-C2: el lib del frontend tiene 10 estados sincronizados con backend', () => {
    // Los 10 estados canónicos del backend están todos exportados.
    const statusValues = Object.values(STATUS);
    expect(statusValues).toHaveLength(10);

    // Los 5 originales del Prompt 1
    expect(statusValues).toContain('pass');
    expect(statusValues).toContain('fail');
    expect(statusValues).toContain('conditionalPass');
    expect(statusValues).toContain('inconclusive');
    expect(statusValues).toContain('notEvaluated');

    // Los 5 agregados en C2 (Prompt 3)
    expect(statusValues).toContain('passWithObservations');
    expect(statusValues).toContain('informative');
    expect(statusValues).toContain('expired');
    expect(statusValues).toContain('pending');
    expect(statusValues).toContain('notApplicable');
  });

  test('ALL_STATUSES exportado y consistente con STATUS', () => {
    expect(ALL_STATUSES).toHaveLength(10);
    expect(ALL_STATUSES).toEqual(expect.arrayContaining(Object.values(STATUS)));
  });
});
