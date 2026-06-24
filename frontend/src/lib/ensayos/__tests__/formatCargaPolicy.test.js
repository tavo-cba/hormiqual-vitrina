/**
 * P-V-03 (auditoría 08, Bloque 21) — tests del helper formatCargaPolicy.
 */

const { formatCargaPolicy, KN_POR_TONF } = require('../ensayoResistenciaCalc');

describe('formatCargaPolicy — P-V-03', () => {
  describe('Política ORIGINAL (default)', () => {
    test('Prensa en kN → muestra kN', () => {
      expect(formatCargaPolicy(125, 'kN', 'ORIGINAL')).toBe('125,00 kN');
    });
    test('Prensa en tonf → muestra tonf', () => {
      expect(formatCargaPolicy(12.75, 'tonf', 'ORIGINAL')).toBe('12,75 tonf');
    });
    test('Sin política explícita → default ORIGINAL', () => {
      expect(formatCargaPolicy(100, 'kN')).toBe('100,00 kN');
    });
  });

  describe('Política SI_KN', () => {
    test('Prensa en kN → mantiene kN', () => {
      expect(formatCargaPolicy(125, 'kN', 'SI_KN')).toBe('125,00 kN');
    });
    test('Prensa en tonf → convierte a kN (1 tonf ≈ 9,80665 kN)', () => {
      const out = formatCargaPolicy(10, 'tonf', 'SI_KN');
      expect(out).toMatch(/kN$/);
      // 10 tonf × 9.80665 = 98.0665 → "98,07 kN"
      expect(out).toBe('98,07 kN');
    });
    test('Variantes "Tn" / "tonf" / "tonelada" se detectan como tonf', () => {
      expect(formatCargaPolicy(10, 'Tn', 'SI_KN')).toBe('98,07 kN');
      expect(formatCargaPolicy(10, 'tonelada', 'SI_KN')).toBe('98,07 kN');
    });
  });

  describe('Política AMBAS', () => {
    test('Prensa en kN → muestra kN + tonf calculado', () => {
      // 125 kN / 9.80665 = 12,747... → "125,00 kN (12,75 tonf)"
      expect(formatCargaPolicy(125, 'kN', 'AMBAS')).toBe('125,00 kN (12,75 tonf)');
    });
    test('Prensa en tonf → muestra kN calculado + tonf nativo', () => {
      // 10 tonf × 9.80665 = 98,0665 → "98,07 kN (10,00 tonf)"
      expect(formatCargaPolicy(10, 'tonf', 'AMBAS')).toBe('98,07 kN (10,00 tonf)');
    });
  });

  describe('Edge cases', () => {
    test('Carga null → "-"', () => {
      expect(formatCargaPolicy(null, 'kN', 'ORIGINAL')).toBe('-');
    });
    test('Carga NaN → "-"', () => {
      expect(formatCargaPolicy('abc', 'kN', 'ORIGINAL')).toBe('-');
    });
    test('Política desconocida → fallback a ORIGINAL', () => {
      expect(formatCargaPolicy(100, 'kN', 'PEPE')).toBe('100,00 kN');
    });
    test('Constante KN_POR_TONF es 9.80665 (gravedad estándar)', () => {
      expect(KN_POR_TONF).toBe(9.80665);
    });
    test('Precision custom', () => {
      expect(formatCargaPolicy(125.123, 'kN', 'ORIGINAL', { precision: 1 })).toBe('125,1 kN');
    });
  });
});
