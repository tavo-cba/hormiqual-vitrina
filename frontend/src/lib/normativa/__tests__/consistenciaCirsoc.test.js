/**
 * consistenciaCirsoc.test.js — Verifica Tablas 4.1 y 4.2 CIRSOC 200-2024 §4.1.1.
 * Validado contra fuente por subagente revisor-civil (sesión 2026-05-09).
 */

import {
  CONSISTENCIA_RANGOS_MM,
  TOLERANCIAS_ASENTAMIENTO_MM,
  AIRE_INCORPORADO_TABLA_43,
  clasificarConsistencia,
  evaluarConsistencia,
  evaluarAire,
} from '../consistenciaCirsoc';

describe('Tabla 4.1 — clasificarConsistencia', () => {
  test('0 mm → Seca', () => {
    expect(clasificarConsistencia(0)).toEqual({ codigo: 'SECA', label: 'Seca' });
  });
  test('20 mm → Seca (en el rango)', () => {
    expect(clasificarConsistencia(20)).toEqual({ codigo: 'SECA', label: 'Seca' });
  });
  test('25 mm → Plástica (borde superior de Seca → empieza Plástica)', () => {
    expect(clasificarConsistencia(25)).toEqual({ codigo: 'PLASTICA', label: 'Plástica' });
  });
  test('80 mm → Muy plástica (borde Plástica/MP)', () => {
    expect(clasificarConsistencia(80)).toEqual({ codigo: 'MUY_PLASTICA', label: 'Muy plástica' });
  });
  test('150 mm → Fluida', () => {
    expect(clasificarConsistencia(150)).toEqual({ codigo: 'FLUIDA', label: 'Fluida' });
  });
  test('220 mm → Muy fluida', () => {
    expect(clasificarConsistencia(220)).toEqual({ codigo: 'MUY_FLUIDA', label: 'Muy fluida' });
  });
  test('null/inválido → null', () => {
    expect(clasificarConsistencia(null)).toBeNull();
    expect(clasificarConsistencia(NaN)).toBeNull();
    expect(clasificarConsistencia(undefined)).toBeNull();
  });
});

describe('Tabla 4.2 — TOLERANCIAS_ASENTAMIENTO_MM', () => {
  test('Tolerancias por consistencia (mm)', () => {
    expect(TOLERANCIAS_ASENTAMIENTO_MM.SECA).toBe(10);
    expect(TOLERANCIAS_ASENTAMIENTO_MM.PLASTICA).toBe(20);
    expect(TOLERANCIAS_ASENTAMIENTO_MM.MUY_PLASTICA).toBe(20);
    expect(TOLERANCIAS_ASENTAMIENTO_MM.FLUIDA).toBe(30);
    expect(TOLERANCIAS_ASENTAMIENTO_MM.MUY_FLUIDA).toBe(20);
  });
});

describe('evaluarConsistencia (Tabla 4.2 §6.7.3.3)', () => {
  describe('Consigna Plástica (50 mm) → tolerancia ±20 mm → rango [30, 70]', () => {
    test('50 mm en el centro → cumple', () => {
      const r = evaluarConsistencia(50, 50);
      expect(r.evaluable).toBe(true);
      expect(r.cumple).toBe(true);
      expect(r.consistencia).toEqual({ codigo: 'PLASTICA', label: 'Plástica' });
      expect(r.toleranciaMm).toBe(20);
      expect(r.minMm).toBe(30);
      expect(r.maxMm).toBe(70);
    });
    test('30 mm exactos en límite inferior → cumple', () => {
      expect(evaluarConsistencia(30, 50).cumple).toBe(true);
    });
    test('70 mm exactos en límite superior → cumple', () => {
      expect(evaluarConsistencia(70, 50).cumple).toBe(true);
    });
    test('29 mm → no cumple', () => {
      expect(evaluarConsistencia(29, 50).cumple).toBe(false);
    });
    test('71 mm → no cumple', () => {
      expect(evaluarConsistencia(71, 50).cumple).toBe(false);
    });
  });

  describe('Consigna Seca (15 mm) → tolerancia ±10 mm', () => {
    test('15 mm centro → cumple', () => {
      expect(evaluarConsistencia(15, 15).cumple).toBe(true);
    });
    test('5 mm en límite → cumple', () => {
      expect(evaluarConsistencia(5, 15).cumple).toBe(true);
    });
    test('26 mm → no cumple', () => {
      expect(evaluarConsistencia(26, 15).cumple).toBe(false);
    });
  });

  describe('Consigna Fluida (180 mm) → tolerancia ±30 mm', () => {
    test('210 mm en límite → cumple', () => {
      expect(evaluarConsistencia(210, 180).cumple).toBe(true);
    });
    test('150 mm en límite → cumple', () => {
      expect(evaluarConsistencia(150, 180).cumple).toBe(true);
    });
    test('149 mm → no cumple', () => {
      expect(evaluarConsistencia(149, 180).cumple).toBe(false);
    });
  });

  describe('Inputs inválidos → no evaluable', () => {
    test('Sin medido → no evaluable', () => {
      expect(evaluarConsistencia(null, 50).evaluable).toBe(false);
    });
    test('Sin consigna → no evaluable', () => {
      expect(evaluarConsistencia(50, null).evaluable).toBe(false);
    });
    test('Consigna fuera de cualquier rango (negativa) → no evaluable', () => {
      expect(evaluarConsistencia(50, -10).evaluable).toBe(false);
    });
  });

  test('Cita normativa exacta presente', () => {
    const r = evaluarConsistencia(50, 50);
    expect(r.cita).toMatch(/CIRSOC 200-2024 §4\.1\.1 Tabla 4\.2/);
  });
});

describe('Constantes públicas estables (regresión)', () => {
  test('CONSISTENCIA_RANGOS_MM tiene 5 clases en orden', () => {
    expect(CONSISTENCIA_RANGOS_MM.map(r => r.codigo)).toEqual([
      'SECA', 'PLASTICA', 'MUY_PLASTICA', 'FLUIDA', 'MUY_FLUIDA',
    ]);
  });
  test('Rangos contiguos (max de uno = min del siguiente)', () => {
    for (let i = 0; i < CONSISTENCIA_RANGOS_MM.length - 1; i++) {
      expect(CONSISTENCIA_RANGOS_MM[i].max).toBe(CONSISTENCIA_RANGOS_MM[i + 1].min);
    }
  });
});

describe('Tabla 4.3 — AIRE_INCORPORADO_TABLA_43 (estructura)', () => {
  test('TMNs disponibles: 13.2 / 19.0 / 26.5 / 37.5', () => {
    expect(Object.keys(AIRE_INCORPORADO_TABLA_43).sort())
      .toEqual(['13.2', '19', '26.5', '37.5']);
  });
  test('Cada celda tiene C1 y C2 con centro + tolerancia', () => {
    for (const cell of Object.values(AIRE_INCORPORADO_TABLA_43)) {
      expect(cell.c1).toEqual({ centro: expect.any(Number), tolerancia: 1.5 });
      expect(cell.c2).toEqual({ centro: expect.any(Number), tolerancia: 1.5 });
    }
  });
  test('C2 ≥ C1 en todas las celdas (durabilidad más exigente)', () => {
    for (const cell of Object.values(AIRE_INCORPORADO_TABLA_43)) {
      expect(cell.c2.centro).toBeGreaterThanOrEqual(cell.c1.centro);
    }
  });
  test('Valores específicos validados por revisor-civil (sesión 2026-05-09)', () => {
    expect(AIRE_INCORPORADO_TABLA_43[13.2].c1.centro).toBe(5.5);
    expect(AIRE_INCORPORADO_TABLA_43[13.2].c2.centro).toBe(7.0);
    expect(AIRE_INCORPORADO_TABLA_43[19.0].c1.centro).toBe(5.0);
    expect(AIRE_INCORPORADO_TABLA_43[26.5].c2.centro).toBe(6.0);
    expect(AIRE_INCORPORADO_TABLA_43[37.5].c1.centro).toBe(4.5);
    expect(AIRE_INCORPORADO_TABLA_43[37.5].c2.centro).toBe(5.5);
  });
});

describe('evaluarAire (Tabla 4.3 §6.7.4.3)', () => {
  describe('TMN 19 mm × C1 → centro 5,0 % ± 1,5 → rango [3,5; 6,5]', () => {
    test('5,0 % en centro → cumple', () => {
      const r = evaluarAire(5.0, 19.0, 'C1');
      expect(r.evaluable).toBe(true);
      expect(r.cumple).toBe(true);
      expect(r.centro).toBe(5.0);
      expect(r.tolerancia).toBe(1.5);
      expect(r.minPct).toBe(3.5);
      expect(r.maxPct).toBe(6.5);
    });
    test('3,5 % en límite inferior → cumple', () => {
      expect(evaluarAire(3.5, 19.0, 'C1').cumple).toBe(true);
    });
    test('6,5 % en límite superior → cumple', () => {
      expect(evaluarAire(6.5, 19.0, 'C1').cumple).toBe(true);
    });
    test('3,4 % → no cumple', () => {
      expect(evaluarAire(3.4, 19.0, 'C1').cumple).toBe(false);
    });
    test('6,6 % → no cumple', () => {
      expect(evaluarAire(6.6, 19.0, 'C1').cumple).toBe(false);
    });
  });

  describe('TMN 13,2 mm × C2 → centro 7,0 % ± 1,5 → rango [5,5; 8,5]', () => {
    test('7,0 % cumple, 5,4 % no cumple', () => {
      expect(evaluarAire(7.0, 13.2, 'C2').cumple).toBe(true);
      expect(evaluarAire(5.4, 13.2, 'C2').cumple).toBe(false);
    });
  });

  describe('Inputs incompletos → no evaluable con motivo (no asume)', () => {
    test('Sin clase de exposición → DATOS_INCOMPLETOS', () => {
      const r = evaluarAire(5.0, 19.0, null);
      expect(r.evaluable).toBe(false);
      expect(r.motivo).toBe('DATOS_INCOMPLETOS');
    });
    test('Sin TMN → DATOS_INCOMPLETOS', () => {
      expect(evaluarAire(5.0, null, 'C1').motivo).toBe('DATOS_INCOMPLETOS');
    });
    test('Sin medición → DATOS_INCOMPLETOS', () => {
      expect(evaluarAire(null, 19.0, 'C1').motivo).toBe('DATOS_INCOMPLETOS');
    });
    test('Clase de exposición distinta de C1/C2 → CLASE_EXPOSICION_INVALIDA', () => {
      expect(evaluarAire(5.0, 19.0, 'A1').motivo).toBe('CLASE_EXPOSICION_INVALIDA');
      expect(evaluarAire(5.0, 19.0, 'M1').motivo).toBe('CLASE_EXPOSICION_INVALIDA');
    });
  });

  describe('TMN no tabulado → no se redondea, se rechaza con motivo', () => {
    // Hallazgo revisor-civil 2026-05-10: redondeo silencioso es
    // riesgo de auditoría. La función ahora exige match exacto
    // (±0,1 mm) contra los 4 TMN tabulados.
    test('TMN 25 mm → TMN_NO_TABULADO (NO redondea a 26,5)', () => {
      const r = evaluarAire(5.0, 25, 'C1');
      expect(r.evaluable).toBe(false);
      expect(r.motivo).toBe('TMN_NO_TABULADO');
    });
    test('TMN 50 mm → TMN_NO_TABULADO (entre 37,5 y 53)', () => {
      const r = evaluarAire(5.0, 50, 'C1');
      expect(r.evaluable).toBe(false);
      expect(r.motivo).toBe('TMN_NO_TABULADO');
    });
    test('TMN exacto + tolerancia ±0,1 mm: 19 vs 19.0 vs 19.05 funcionan igual', () => {
      expect(evaluarAire(5.0, 19, 'C1').evaluable).toBe(true);
      expect(evaluarAire(5.0, 19.0, 'C1').evaluable).toBe(true);
      expect(evaluarAire(5.0, 19.05, 'C1').evaluable).toBe(true);
      expect(evaluarAire(5.0, 19.2, 'C1').evaluable).toBe(false); // > tolerancia
    });
  });

  describe('TMN ≥ 53 mm → §4.1.2.3 requiere tamizado previo', () => {
    test('TMN 53 sin tamizado declarado → REQUIERE_TAMIZADO_37_5_PREVIO', () => {
      const r = evaluarAire(5.0, 53, 'C1');
      expect(r.evaluable).toBe(false);
      expect(r.motivo).toBe('REQUIERE_TAMIZADO_37_5_PREVIO');
    });
    test('TMN 53 con tamizadoPrevio=true → evaluable contra fila 37,5', () => {
      const r = evaluarAire(5.0, 53, 'C1', { tamizadoPrevio: true });
      expect(r.evaluable).toBe(true);
      expect(r.tmnTabla).toBe(37.5);
    });
    test('TMN 75 con tamizadoPrevio=true → fila 37,5 (mismo procedimiento)', () => {
      expect(evaluarAire(5.0, 75, 'C1', { tamizadoPrevio: true }).tmnTabla).toBe(37.5);
    });
  });

  test('Cita normativa exacta presente con página', () => {
    const r = evaluarAire(5.0, 19.0, 'C1');
    expect(r.cita).toMatch(/CIRSOC 200-2024 §4\.1\.2 Tabla 4\.3/);
    expect(r.cita).toMatch(/p[áa]g\. 4-101/);
  });

  test('Acepta strings tipo "C1" o "c1"', () => {
    expect(evaluarAire(5.0, 19.0, 'C1').evaluable).toBe(true);
    expect(evaluarAire(5.0, 19.0, 'c1').evaluable).toBe(true);
    expect(evaluarAire(5.0, 19.0, 'c2').evaluable).toBe(true);
  });
});
