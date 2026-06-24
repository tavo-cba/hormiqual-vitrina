/**
 * Tests Prompt 3 C9.1 (canary) — `lib/compliance/pdfPresentation`.
 *
 * Helper centralizado para presentación visual de compliance en PDFs.
 * Establece el patrón que los 5 PDFs (informeResistenciaPdf,
 * certificadoCumplimientoPdf, agregadoFichaTecnicaPdf, mezclaInformePdf,
 * dosificacionInformePdf) van a consumir uniformemente.
 *
 * Cobertura:
 *   1. `resolvePdfCategoria`: acepta los 4 shapes (ComplianceResult, boolean,
 *      string, null) y resuelve a una de las 7 categorías VEREDICTO.
 *   2. `getCategoriaPdfColor`: retorna tuplas RGB válidas (3 enteros 0-255).
 *   3. `getCategoriaPdfLabel`: coincide con VEREDICTO.* (UPPERCASE).
 *   4. `getCategoriaPdfPresentation`: agrupa categoría + color + label.
 *   5. Coherencia visual con CATEGORIA_COLORS.hex del módulo web (los hex
 *      del web y las tuplas RGB del PDF deben representar el mismo color
 *      por categoría).
 */

import { VEREDICTO, Compliance, CATEGORIA_COLORS } from '../index';
import {
  CATEGORIA_PDF_COLORS,
  resolvePdfCategoria,
  getCategoriaPdfColor,
  getCategoriaPdfLabel,
  getCategoriaPdfPresentation,
} from '../pdfPresentation';

/* ───────── resolvePdfCategoria ───────── */

describe('pdfPresentation — resolvePdfCategoria (4 shapes de input)', () => {
  test('ComplianceResult canónico → getCategoriaVeredicto', () => {
    expect(resolvePdfCategoria(Compliance.pass())).toBe(VEREDICTO.APTO);
    expect(resolvePdfCategoria(Compliance.passWithObservations({ observation: 'x' })))
      .toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
    expect(resolvePdfCategoria(Compliance.conditionalPass({
      conditions: [{ kind: 'requires_mitigation', key: 'k', description: 'd' }],
    }))).toBe(VEREDICTO.APTITUD_CONDICIONADA);
    expect(resolvePdfCategoria(Compliance.fail({ reasons: ['x'], severity: 'bloqueante' })))
      .toBe(VEREDICTO.NO_APTO);
    expect(resolvePdfCategoria(Compliance.notEvaluated({ reason: 'x' })))
      .toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolvePdfCategoria(Compliance.informative({ note: 'x' })))
      .toBe(VEREDICTO.INFORMATIVO);
    expect(resolvePdfCategoria(Compliance.notApplicable({ reason: 'x' })))
      .toBe(VEREDICTO.NO_APLICA);
  });

  test('boolean legacy (tipo.cumple del backend) → APTO / NO APTO', () => {
    expect(resolvePdfCategoria(true)).toBe(VEREDICTO.APTO);
    expect(resolvePdfCategoria(false)).toBe(VEREDICTO.NO_APTO);
  });

  test('string con categoría VEREDICTO directa → pass-through', () => {
    expect(resolvePdfCategoria('APTO')).toBe(VEREDICTO.APTO);
    expect(resolvePdfCategoria('NO APTO')).toBe(VEREDICTO.NO_APTO);
    expect(resolvePdfCategoria('APTO CON OBSERVACIONES')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
  });

  test('string con status raw (pass/fail) → mapea vía getCategoriaVeredicto', () => {
    expect(resolvePdfCategoria('pass')).toBe(VEREDICTO.APTO);
    expect(resolvePdfCategoria('fail')).toBe(VEREDICTO.NO_APTO);
    expect(resolvePdfCategoria('conditionalPass')).toBe(VEREDICTO.APTITUD_CONDICIONADA);
  });

  test('null/undefined/objeto sin status → EVALUACIÓN INCOMPLETA (default seguro)', () => {
    expect(resolvePdfCategoria(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolvePdfCategoria(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolvePdfCategoria({})).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(resolvePdfCategoria({ foo: 'bar' })).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

/* ───────── Color, label, icon ───────── */

describe('pdfPresentation — getCategoriaPdfColor', () => {
  test('Cada categoría retorna una tupla RGB válida (3 enteros 0-255)', () => {
    Object.values(VEREDICTO).forEach((cat) => {
      const color = CATEGORIA_PDF_COLORS[cat];
      expect(Array.isArray(color)).toBe(true);
      expect(color.length).toBe(3);
      color.forEach((c) => {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      });
    });
  });

  test('Color para Compliance.pass coincide con verde APTO', () => {
    const c = getCategoriaPdfColor(Compliance.pass());
    expect(c).toEqual([22, 163, 74]);
  });

  test('Color para boolean false coincide con rojo NO APTO', () => {
    expect(getCategoriaPdfColor(false)).toEqual([220, 38, 38]);
  });

  test('Color para null cae al azul EVAL INCOMPLETA', () => {
    expect(getCategoriaPdfColor(null)).toEqual([29, 78, 216]);
  });
});

describe('pdfPresentation — getCategoriaPdfLabel', () => {
  test('Labels son los valores UPPERCASE de VEREDICTO', () => {
    expect(getCategoriaPdfLabel(Compliance.pass())).toBe('APTO');
    expect(getCategoriaPdfLabel(Compliance.fail({ reasons: ['x'], severity: 'bloqueante' }))).toBe('NO APTO');
    expect(getCategoriaPdfLabel(Compliance.passWithObservations({ observation: 'x' })))
      .toBe('APTO CON OBSERVACIONES');
    expect(getCategoriaPdfLabel(Compliance.conditionalPass({
      conditions: [{ kind: 'requires_mitigation', key: 'k', description: 'd' }],
    }))).toBe('APTITUD CONDICIONADA');
  });

  test('Boolean legacy true/false', () => {
    expect(getCategoriaPdfLabel(true)).toBe('APTO');
    expect(getCategoriaPdfLabel(false)).toBe('NO APTO');
  });
});

describe('pdfPresentation — getCategoriaPdfPresentation (paquete completo)', () => {
  test('Retorna { categoria, color, label } con valores coherentes', () => {
    const pres = getCategoriaPdfPresentation(Compliance.passWithObservations({ observation: 'x' }));
    expect(pres.categoria).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
    expect(pres.label).toBe('APTO CON OBSERVACIONES');
    expect(pres.color).toEqual([21, 128, 61]);
    expect(pres.icon).toBeUndefined();
  });

  test('Boolean legacy con paquete completo', () => {
    const pres = getCategoriaPdfPresentation(false);
    expect(pres.categoria).toBe(VEREDICTO.NO_APTO);
    expect(pres.label).toBe('NO APTO');
    expect(pres.color).toEqual([220, 38, 38]);
  });
});

/* ───────── Coherencia con módulo web ───────── */

describe('pdfPresentation — coherencia con CATEGORIA_COLORS web', () => {
  test('Cada hex de CATEGORIA_COLORS web tiene su tupla RGB equivalente en PDF', () => {
    // Conversión hex → RGB para validar coherencia visual entre web y PDF.
    const hexToRgb = (hex) => {
      const s = hex.replace(/^#/, '');
      return [
        parseInt(s.substring(0, 2), 16),
        parseInt(s.substring(2, 4), 16),
        parseInt(s.substring(4, 6), 16),
      ];
    };

    Object.values(VEREDICTO).forEach((cat) => {
      const webHex = CATEGORIA_COLORS[cat]?.hex;
      const pdfRgb = CATEGORIA_PDF_COLORS[cat];
      expect(webHex).toBeDefined();
      expect(pdfRgb).toBeDefined();
      expect(hexToRgb(webHex)).toEqual(pdfRgb);
    });
  });
});
