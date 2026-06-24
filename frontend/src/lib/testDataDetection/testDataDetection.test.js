/**
 * Tests Bloque D (P2.14) — heurística de detección de datos de prueba.
 * Política: warning + watermark, sin bloqueo.
 */

import { detectarDatosDePrueba, watermarkText, watermarkColor } from './index';

describe('detectarDatosDePrueba — caso real "Arena prueba 1"', () => {
  test('Material con nombre "Arena prueba 1" + cantera "Arideros x" + IDs random → detectado', () => {
    const r = detectarDatosDePrueba(
      { nombre: 'Arena prueba 1', cantera: 'Arideros x', productor: 'Pepe' },
      [
        { tipo: { codigo: 'IRAM1505_GRANULOMETRIA' }, ultimoEnsayo: { nroInforme: '1234a5sd', laboratorio: 'asd1f23' } },
      ],
    );
    expect(r.esProbablementePrueba).toBe(true);
    expect(r.tag).toBe('POSIBLE_PRUEBA');
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.motivos.some((m) => m.motivo.match(/palabra clave/i))).toBe(true);
  });

  test('Material limpio "Arena Las Quebradas" + IDs serios → NO detectado', () => {
    const r = detectarDatosDePrueba(
      { nombre: 'Arena Las Quebradas', cantera: 'Las Quebradas SA', productor: 'Arideros S.R.L' },
      [
        { tipo: { codigo: 'IRAM1505_GRANULOMETRIA' }, ultimoEnsayo: { nroInforme: 'INF-2026-0042', laboratorio: 'INTI Construcciones' } },
      ],
    );
    expect(r.esProbablementePrueba).toBe(false);
    expect(r.tag).toBe('PRODUCCIÓN');
    expect(r.score).toBeLessThan(3);
  });
});

describe('Patrones individuales', () => {
  test('Palabra "test" en nombre → score ≥3', () => {
    const r = detectarDatosDePrueba({ nombre: 'Material test 42' });
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.esProbablementePrueba).toBe(true);
  });

  test('Secuencia trivial 123456 en nroInforme', () => {
    const r = detectarDatosDePrueba({}, [
      { ultimoEnsayo: { nroInforme: '123456' } },
    ]);
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  test('"asdf" en cualquier campo dispara', () => {
    const r = detectarDatosDePrueba({ cantera: 'asdfgh' });
    expect(r.score).toBeGreaterThanOrEqual(3);
  });

  test('ID alfanumérico random (asd1f23)', () => {
    const r = detectarDatosDePrueba({}, [
      { tipo: { codigo: 'IRAM1505' }, ultimoEnsayo: { nroInforme: 'asd1f23' } },
    ]);
    // patrón "letras+digito+letras" matchea
    expect(r.motivos.some((m) => m.motivo.match(/random/i))).toBe(true);
  });
});

describe('isTestData explícito', () => {
  test('material.isTestData=true → siempre detectado, tag PRUEBA_CONFIRMADA', () => {
    const r = detectarDatosDePrueba({ nombre: 'Cualquier nombre serio', isTestData: true });
    expect(r.esProbablementePrueba).toBe(true);
    expect(r.isTestDataExplicito).toBe(true);
    expect(r.tag).toBe('PRUEBA_CONFIRMADA');
  });
});

describe('Helpers de watermark', () => {
  test('watermarkText devuelve texto distinto según tag', () => {
    const explicito = detectarDatosDePrueba({ nombre: 'X', isTestData: true });
    const heuristico = detectarDatosDePrueba({ nombre: 'test test test' });
    const limpio = detectarDatosDePrueba({ nombre: 'Material A' });
    expect(watermarkText(explicito)).toMatch(/DATOS DE PRUEBA — NO USAR/i);
    expect(watermarkText(heuristico)).toMatch(/POSIBLES DATOS DE PRUEBA/i);
    expect(watermarkText(limpio)).toBeNull();
  });

  test('watermarkColor: rojo para confirmado, naranja para heurístico', () => {
    const explicito = detectarDatosDePrueba({ nombre: 'X', isTestData: true });
    const heuristico = detectarDatosDePrueba({ nombre: 'test test test' });
    expect(watermarkColor(explicito)[0]).toBe(220); // rojo
    expect(watermarkColor(heuristico)[1]).toBe(119); // naranja (R=217, G=119, B=6)
  });
});

describe('Falsos positivos esperados — tolerancia', () => {
  test('Cantera con nombre legítimo "Las Quebradas" no dispara', () => {
    const r = detectarDatosDePrueba({ cantera: 'Las Quebradas' });
    expect(r.esProbablementePrueba).toBe(false);
  });

  test('Productor "Arideros S.R.L" no dispara', () => {
    const r = detectarDatosDePrueba({ productor: 'Arideros S.R.L' });
    expect(r.esProbablementePrueba).toBe(false);
  });
});
