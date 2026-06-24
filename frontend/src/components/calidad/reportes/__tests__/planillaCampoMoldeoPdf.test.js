/**
 * Smoke render del N-02 (Bloque 18 auditoría 08): genera el PDF y verifica
 * que jsPDF no tira excepción + el output tiene una página A4.
 */

const { generarPlanillaCampoMoldeoPdf } = require('../planillaCampoMoldeoPdf');

describe('N-02 — planillaCampoMoldeoPdf', () => {
  test('Genera PDF sin opciones (default)', () => {
    const doc = generarPlanillaCampoMoldeoPdf();
    expect(doc).toBeDefined();
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
    // No debería haber agregado más de 1 página (la planilla cabe en 1 A4).
    expect(doc.internal.pages.length).toBe(2); // index 0 es el "0" placeholder de jsPDF, índice 1 es la primera página
  });

  test('Acepta tenantNombre + plantaNombre sin error', () => {
    const doc = generarPlanillaCampoMoldeoPdf({
      tenantNombre: 'HormiTest S.A.',
      plantaNombre: 'Planta La Plata',
    });
    expect(doc).toBeDefined();
  });

  test('Caracteres con tildes / ñ se sanitizan vía sanitizePdfText', () => {
    // Esto solo verifica que no tira excepción; el output visual se valida
    // con smoke-pdf-visual cuando haga falta.
    expect(() => generarPlanillaCampoMoldeoPdf({
      tenantNombre: 'Construcción & Cía. — Año 2026',
      plantaNombre: 'Planta Niño Jesús',
    })).not.toThrow();
  });
});
