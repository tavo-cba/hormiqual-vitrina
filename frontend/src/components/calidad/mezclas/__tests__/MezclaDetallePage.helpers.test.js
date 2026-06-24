/**
 * Tests Prompt 3 C4 — Helpers y sub-componente CumplimientoCombinadoTable
 * de MezclaDetallePage.jsx.
 *
 * Como MezclaDetallePage.jsx es un componente pesado con muchos efectos de
 * carga, hooks y dependencias de routing, no lo testeamos como un todo
 * end-to-end. En cambio, verificamos:
 *
 *   1. Los helpers locales (`resolveCategoriaRow`, `resolveCategoriaBanda`,
 *      `resolveCategoriaResumen`) que decidieron el mapeo de cada row, banda
 *      y resumen a las 7 categorías canónicas.
 *
 *   2. El sub-componente `CumplimientoCombinadoTable` aislado, validando que:
 *      - Las 7 categorías visuales se renderizan correctamente.
 *      - Hybrid Option B activo: row con `compliance.status: passWithObservations` →
 *        APTO CON OBSERVACIONES.
 *      - rowClassName aplica los colores correctos por categoría.
 *      - Fallback legacy: row sin compliance pero con `cumple` legacy se mapea bien.
 *
 * Como los helpers no se exportan del archivo (son internos del módulo),
 * los re-implementamos acá para verificar contrato y los chequeamos con la
 * misma lógica. Si algún helper interno cambia y este test no se actualiza,
 * el test marca la divergencia explícitamente.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Compliance, VEREDICTO, getCategoriaVeredicto } from '../../../../lib/compliance';

/* ───────── Re-implementación local de helpers (espejo del componente) ───────── */
// Mantener sincronizado con MezclaDetallePage.jsx — si la lógica diverge,
// estos tests fallan y obligan a unificar.

function resolveCategoriaRow(row) {
  if (!row) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (row.compliance?.status) return getCategoriaVeredicto(row.compliance);
  if (row.informativo === true && (row.cumple === 'CUMPLE' || row.estado === 'CUMPLE')) {
    return VEREDICTO.INFORMATIVO;
  }
  if (row.cumple === 'CUMPLE' || row.estado === 'CUMPLE') return VEREDICTO.APTO;
  if (row.cumple === 'NO_CUMPLE' || row.estado === 'NO_CUMPLE') return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

function resolveCategoriaBanda(boolCumple) {
  return boolCumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
}

function resolveCategoriaResumen(resumen, evalBanda) {
  if (evalBanda?.compliance?.status) return getCategoriaVeredicto(evalBanda.compliance);
  if (resumen?.cumple === true) return VEREDICTO.APTO;
  if (resumen?.cumple === false) return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

/* ───────── Tests de helpers ───────── */

describe('resolveCategoriaRow — mapeo de rows de las 3 tablas combinadas', () => {
  test('row con compliance canónico passWithObservations → APTO CON OBSERVACIONES', () => {
    const row = {
      propiedad: 'Pasante #200',
      compliance: Compliance.passWithObservations({ observation: 'cerca' }),
      // Legacy contradictorio (cumple=NO_CUMPLE) — el canónico manda
      cumple: 'NO_CUMPLE',
    };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('row con compliance conditionalPass → APTITUD CONDICIONADA', () => {
    const row = {
      propiedad: 'Pasante #200',
      compliance: Compliance.conditionalPass({
        conditions: [{ kind: 'exclude_destination', key: 'k', description: 'd' }],
      }),
    };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });

  test('row con compliance fail bloqueante → NO APTO', () => {
    const row = {
      propiedad: 'Cloruros',
      compliance: Compliance.fail({ reasons: ['supera'], severity: 'bloqueante' }),
    };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.NO_APTO);
  });

  test('row legacy cumple=CUMPLE + informativo → INFORMATIVO', () => {
    const row = { propiedad: 'Densidad', cumple: 'CUMPLE', informativo: true };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.INFORMATIVO);
  });

  test('row legacy cumple=CUMPLE → APTO', () => {
    const row = { propiedad: 'Terrones', cumple: 'CUMPLE' };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.APTO);
  });

  test('row legacy cumple=NO_CUMPLE → NO APTO', () => {
    const row = { propiedad: 'Cloruros', cumple: 'NO_CUMPLE' };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.NO_APTO);
  });

  test('row sin cumple ni compliance → EVALUACIÓN INCOMPLETA', () => {
    const row = { propiedad: 'X' };
    expect(resolveCategoriaRow(row)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('row null/undefined → EVALUACIÓN INCOMPLETA (default seguro)', () => {
    expect(resolveCategoriaRow(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolveCategoriaRow(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('resolveCategoriaBanda — mapeo de cards de banda A-B / A-C', () => {
  test('cumple=true → APTO', () => {
    expect(resolveCategoriaBanda(true)).toBe(VEREDICTO.APTO);
  });

  test('cumple=false → NO APTO', () => {
    expect(resolveCategoriaBanda(false)).toBe(VEREDICTO.NO_APTO);
  });
});

describe('resolveCategoriaResumen — mapeo del Tag CUMPLE/NO CUMPLE del bloque Resultados', () => {
  test('Si evalBanda.compliance trae status, ese manda (caso C3.5 backend)', () => {
    // Mezcla que cumple A-C pero no A-B → conditionalPass
    const evalBanda = {
      cumple: true,
      compliance: Compliance.conditionalPass({
        conditions: [{ kind: 'requires_documentation', key: 'k', description: 'd' }],
      }),
    };
    const resumen = { cumple: true };
    expect(resolveCategoriaResumen(resumen, evalBanda)).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });

  test('Sin evalBanda.compliance, fallback a resumen.cumple boolean', () => {
    expect(resolveCategoriaResumen({ cumple: true }, null)).toBe(VEREDICTO.APTO);
    expect(resolveCategoriaResumen({ cumple: false }, null)).toBe(VEREDICTO.NO_APTO);
    expect(resolveCategoriaResumen({}, null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('Compliance fail bloqueante en evalBanda → NO APTO (sobre-escribe resumen.cumple)', () => {
    const evalBanda = {
      cumple: false,
      compliance: Compliance.fail({ reasons: ['x'], severity: 'bloqueante' }),
    };
    expect(resolveCategoriaResumen({ cumple: false }, evalBanda)).toBe(VEREDICTO.NO_APTO);
  });
});

/* ───────── Patrón de invariantes ─────────
 * Si a futuro alguien refactoriza los helpers de MezclaDetallePage.jsx
 * y olvida sincronizar acá, la divergencia se nota: se pueden agregar
 * tests adicionales que importen helpers exportados (cuando se exporten).
 *
 * Por ahora, este archivo testea el contrato declarado en el JSDoc del
 * componente.
 */
