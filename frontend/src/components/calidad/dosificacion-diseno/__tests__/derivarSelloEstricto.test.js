/**
 * Sello de verificación estricta (modo PRESCRIPTIVO) — derivarSelloEstricto.
 *
 * El sello NO recalcula criterios normativos: reexpresa el `assessment` que
 * el backend ya consolidó (estadoGlobalConsolidator.buildAssessment) como un
 * veredicto binario APTA / NO APTA con incumplimientos enumerados. Estos
 * tests fijan ese contrato de presentación.
 *
 * Regla (validada con revisor-civil; ninguna regla normativa nueva):
 *   - APTA  ⇔ conformidadNormativa === CONFORME y sin bloqueantes/riesgos/desvíos.
 *   - NO APTA si hay cualquier incumplimiento duro (bloqueante/riesgo/desvío).
 *   - NO APTA si la verificación es no concluyente (faltan ensayos/datos
 *     exigidos): ausencia de evidencia ≠ cumplimiento.
 *   - assessment ausente → null (no se fabrica veredicto desde el frontend).
 */

import { derivarSelloEstricto } from '../dosificacionInformePdf';

describe('derivarSelloEstricto', () => {
  test('assessment ausente → null (no fabrica veredicto)', () => {
    expect(derivarSelloEstricto(null)).toBeNull();
    expect(derivarSelloEstricto(undefined)).toBeNull();
  });

  test('CONFORME sin hallazgos duros → APTA', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'CONFORME',
      bloqueantes: [], riesgos: [], desvios: [],
      condicionantes: [], observaciones: [],
    });
    expect(r.apta).toBe(true);
    expect(r.titulo).toMatch(/APTA/);
    expect(r.titulo).not.toMatch(/NO APTA/);
    expect(r.incumplimientos).toEqual([]);
  });

  test('CONFORME con observaciones pero sin hallazgos duros → APTA (las observaciones no degradan)', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'CONFORME',
      bloqueantes: [], riesgos: [], desvios: [],
      condicionantes: [], observaciones: ['Ensayo de durabilidad informativo pendiente'],
    });
    expect(r.apta).toBe(true);
  });

  test('CONFORME con condicionantes → APTA, pero los condicionantes se listan como contexto', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'CONFORME',
      bloqueantes: [], riesgos: [], desvios: [],
      condicionantes: ['Pastón de prueba obligatorio antes de liberar'],
      observaciones: [],
    });
    expect(r.apta).toBe(true);
    expect(r.titulo).toMatch(/APTA/);
    expect(r.titulo).not.toMatch(/NO APTA/);
    expect(r.motivo).toMatch(/Condiciones de liberación/i);
    expect(r.incumplimientos).toEqual(['Pastón de prueba obligatorio antes de liberar']);
  });

  test('bloqueante presente → NO APTA y lo enumera', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'NO_CONFORME',
      bloqueantes: ['a/c efectiva 0,55 supera el máximo 0,50 (CIRSOC 200:2024 T.2.5)'],
      riesgos: [], desvios: [], condicionantes: [], observaciones: [],
    });
    expect(r.apta).toBe(false);
    expect(r.titulo).toMatch(/NO APTA/);
    expect(r.incumplimientos).toHaveLength(1);
    expect(r.incumplimientos[0]).toMatch(/a\/c/);
  });

  test('riesgos + desvíos se enumeran todos en orden bloqueante→riesgo→desvío', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'CON_DESVIOS',
      bloqueantes: ['B1'],
      riesgos: ['R1', 'R2'],
      desvios: ['D1'],
      condicionantes: ['no debe contar'],
      observaciones: ['tampoco'],
    });
    expect(r.apta).toBe(false);
    expect(r.incumplimientos).toEqual(['B1', 'R1', 'R2', 'D1']);
  });

  test('solo desvíos (CON_DESVIOS) → NO APTA', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'CON_DESVIOS',
      bloqueantes: [], riesgos: [],
      desvios: ['Agregado fino fuera de banda IRAM 1627'],
      condicionantes: [], observaciones: [],
    });
    expect(r.apta).toBe(false);
    expect(r.incumplimientos).toEqual(['Agregado fino fuera de banda IRAM 1627']);
  });

  test('no concluyente (sin hallazgos duros, conformidad ≠ CONFORME) → NO APTA por falta de evidencia', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'NO_CONCLUYENTE',
      bloqueantes: [], riesgos: [], desvios: [],
      condicionantes: ['Falta ensayo de reactividad álcali-sílice (IRAM 1674)'],
      observaciones: ['Curva granulométrica por fallback'],
    });
    expect(r.apta).toBe(false);
    expect(r.titulo).toMatch(/NO APTA/);
    expect(r.motivo).toMatch(/no concluyente/i);
    expect(r.incumplimientos).toEqual([
      'Falta ensayo de reactividad álcali-sílice (IRAM 1674)',
      'Curva granulométrica por fallback',
    ]);
  });

  test('no concluyente sin condicionantes ni observaciones → mensaje genérico de falta de evidencia', () => {
    const r = derivarSelloEstricto({
      conformidadNormativa: 'NO_CONCLUYENTE',
      bloqueantes: [], riesgos: [], desvios: [],
      condicionantes: [], observaciones: [],
    });
    expect(r.apta).toBe(false);
    expect(r.incumplimientos).toHaveLength(1);
    expect(r.incumplimientos[0]).toMatch(/evidencia/i);
  });

  test('campos faltantes/no-array no rompen (defensivo)', () => {
    const r = derivarSelloEstricto({ conformidadNormativa: 'CONFORME' });
    expect(r.apta).toBe(true);
    const r2 = derivarSelloEstricto({
      conformidadNormativa: 'NO_CONFORME',
      bloqueantes: 'no-es-array',
    });
    expect(r2.apta).toBe(false);
  });
});
