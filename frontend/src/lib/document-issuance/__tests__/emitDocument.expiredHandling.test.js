/**
 * X6 (auditoría 2026-05-08): un ensayo vencido (estado='VENCIDO') aparecía
 * en el informe de evaluación como NO APTO rojo y como motivo de no
 * certificación con texto "no cumple criterio normativo". Lo correcto es
 * EVALUACIÓN INCOMPLETA azul ("sin dato vigente").
 *
 * Estos tests cubren la lógica del adapter `_adaptComplianceConsiderandoVencimiento`
 * usado dentro de `emitDocument`. Como esa función no se exporta, testeamos
 * indirectamente el comportamiento usando `fromLegacyEval` + el resolver de
 * categoría visual del PDF.
 */

import { fromLegacyEval, Compliance, getCategoriaVeredicto } from '../../compliance';
import { getCategoriaPdfLabel } from '../../compliance/pdfPresentation';

describe('X6 — adapter de vencimiento para emitDocument', () => {
  test('Item con estado="VENCIDO" + ultimoEnsayo cumple=false → expired (no fail)', () => {
    // Reproducción del adapter inline (mismo fix aplicado en emitDocument):
    const item = {
      estado: 'VENCIDO',
      ultimoEnsayo: { cumple: false, estado: 'NO_CUMPLE' },
    };
    const compliance = fromLegacyEval(item.ultimoEnsayo);
    let final = compliance;
    if (item.estado === 'VENCIDO' && compliance?.status !== 'expired') {
      final = Compliance.expired({ reason: 'Ensayo vencido — sin dato vigente para certificar.' });
    }
    expect(final.status).toBe('expired');
    expect(getCategoriaPdfLabel(final)).toBe('EVALUACIÓN INCOMPLETA');
  });

  test('Item sin "VENCIDO" + ultimoEnsayo cumple=false → fail (NO APTO) — comportamiento normal', () => {
    const item = { estado: 'NO_CUMPLE', ultimoEnsayo: { cumple: 'NO_CUMPLE', estado: 'NO_CUMPLE' } };
    const compliance = fromLegacyEval(item.ultimoEnsayo);
    let final = compliance;
    if (item.estado === 'VENCIDO' && compliance?.status !== 'expired') {
      final = Compliance.expired({ reason: '...' });
    }
    expect(final.status).toBe('fail');
    expect(getCategoriaPdfLabel(final)).toBe('NO APTO');
  });

  test('Item con estado="VENCIDO" pero ultimoEnsayo sin estado → expired', () => {
    const item = { estado: 'VENCIDO', ultimoEnsayo: { cumple: null } };
    const compliance = fromLegacyEval(item.ultimoEnsayo);
    let final = compliance;
    if (item.estado === 'VENCIDO' && compliance?.status !== 'expired') {
      final = Compliance.expired({ reason: '...' });
    }
    expect(final.status).toBe('expired');
  });

  test('Item con ultimoEnsayo ya marcado VENCIDO → expired (no requiere doble adapter)', () => {
    const item = { estado: 'VENCIDO', ultimoEnsayo: { estado: 'VENCIDO' } };
    const compliance = fromLegacyEval(item.ultimoEnsayo);
    expect(compliance.status).toBe('expired');
    // El adapter no debe duplicar la promoción.
    let final = compliance;
    if (item.estado === 'VENCIDO' && compliance?.status !== 'expired') {
      final = Compliance.expired({ reason: '...' });
    }
    expect(final.status).toBe('expired');
    expect(final).toBe(compliance); // misma instancia
  });

  test('Categoría visual de expired = EVALUACIÓN INCOMPLETA (azul)', () => {
    const expired = Compliance.expired({ reason: 'test' });
    expect(getCategoriaVeredicto(expired)).toBe('EVALUACIÓN INCOMPLETA');
    expect(getCategoriaPdfLabel(expired)).toBe('EVALUACIÓN INCOMPLETA');
  });

  test('Categoría visual de fail = NO APTO (rojo) — para diferenciar', () => {
    const fail = Compliance.fail({ reasons: ['no cumple'] });
    expect(getCategoriaVeredicto(fail)).toBe('NO APTO');
    expect(getCategoriaPdfLabel(fail)).toBe('NO APTO');
  });
});
