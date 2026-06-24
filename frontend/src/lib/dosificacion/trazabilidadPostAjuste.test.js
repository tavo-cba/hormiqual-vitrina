/**
 * Lock-in del bug DOS-6UCPY6-K72: el ajuste manual de cemento debe propagarse
 * a TODAS las secciones del informe (G.1, I, N, Anexo), no sólo a la Sección G.
 *
 * Fixture inspirado en el informe real DOS-6UCPY6-K72 v1:
 *   - Cemento calculado 335 → adoptado 330 kg/m³ (motivo: experiencia).
 *   - densidadCemento 3,14 g/cm³ → ΔV_cemento = (335−330)/3,14 = −1,59 L/m³.
 *   - V_agregados 709,7 → 711,3 L/m³.
 *   - Densidades implícitas: LQ 2,580 (14%), A6 2,610 (23%), R 2,600 (63%).
 */

import { deriveTrazabilidadConsistente } from './trazabilidadPostAjuste';

// resultado PRE-ajuste (lo que devolvió el motor con 335 kg/m³)
function resultadoPre() {
  return {
    cementoKgM3: 335,
    cementoTotalKgM3: 335,
    densidadCementoUsada: 3.14,
    volumenAgregados: 0.7097, // m³
    agregados: [
      { nombre: 'Arena Común "Las Quebradas"', kgM3: 256, volAbsolutoM3: 0.09936, densidad: 2.580, p300Pct: 22 },
      { nombre: 'Arena lavada "Arideros 6"', kgM3: 426, volAbsolutoM3: 0.16322, densidad: 2.610, p300Pct: 55 },
      { nombre: 'Ripio lavado 6-19 mm "Arideros 6"', kgM3: 1162, volAbsolutoM3: 0.44712, densidad: 2.600 },
    ],
  };
}

// resultado POST-ajuste a 330 kg/m³ (lo que produce aplicarAjusteCemento)
function resultadoPost() {
  return {
    cementoKgM3: 330,
    cementoTotalKgM3: 330,
    densidadCementoUsada: 3.14,
    volumenAgregados: 0.7113, // m³  (709,7 + 1,6)
    agregados: [
      { nombre: 'Arena Común "Las Quebradas"', kgM3: 257, volAbsolutoM3: 0.09959, densidad: 2.580, p300Pct: 22 },
      { nombre: 'Arena lavada "Arideros 6"', kgM3: 427, volAbsolutoM3: 0.16359, densidad: 2.610, p300Pct: 55 },
      { nombre: 'Ripio lavado 6-19 mm "Arideros 6"', kgM3: 1165, volAbsolutoM3: 0.44814, densidad: 2.600 },
    ],
    ajusteCemento: {
      aplicado: true,
      cementoCalculadoKgM3: 335,
      cementoAdoptadoKgM3: 330,
      deltaKg: -5,
      motivo: 'EXPERIENCIA_TECNOLOGO',
      volAgregadosOriginalM3: 0.7097,
      volAgregadosAjustadoM3: 0.7113,
    },
  };
}

// trazabilidad que vino del backend con el cemento 335 (PRE-ajuste)
function trazPre() {
  return {
    agregadosDistribucion: {
      metodo: 'VOLUMEN_ABSOLUTO',
      volAgregadosTotal: 0.7097,
      items: resultadoPre().agregados,
    },
    balanceVolumenes: {
      vAgua: 161,
      vCemento: 106.7,      // 335 / 3,14
      vAire: 20,
      vAdiciones: 0,
      vAditivos: 2.6,
      vFibras: 0,
      vPasta: 290.3,
      vAgregados: 709.7,
      totalLM3: 1000,
    },
    verificacionPulverulento: {
      tmnMm: 19,
      minimoKgM3: 440,
      cementoPulv: 335,
      adicionesPulv: 0,
      finosAgregadoPulv: Math.round(256 * 0.22 + 426 * 0.55),
      finosDetalle: [
        { nombre: 'Arena Común "Las Quebradas"', kgM3: 256, p300Pct: 22, aporteKg: Math.round(256 * 0.22) },
        { nombre: 'Arena lavada "Arideros 6"', kgM3: 426, p300Pct: 55, aporteKg: Math.round(426 * 0.55) },
      ],
      totalPulverulento: Math.round(335 + 256 * 0.22 + 426 * 0.55),
      cumple: true,
      excepcionH20: false,
      metodoColocacion: 'CONVENCIONAL',
    },
  };
}

describe('DOS-6UCPY6-K72 — propagación del ajuste manual a todas las secciones', () => {
  it('todas las secciones del informe consumen el diseño POST-ajuste', () => {
    const traz = deriveTrazabilidadConsistente(resultadoPost(), trazPre());

    // Distribución de agregados (Sección N / Anexo) → POST
    const items = traz.agregadosDistribucion.items;
    expect(items.map(a => a.kgM3)).toEqual([257, 427, 1165]);
    expect(traz.agregadosDistribucion.volAgregadosTotal).toBeCloseTo(0.7113, 4);

    // Balance volumétrico (Sección G.1 / Anexo) → POST
    expect(traz.balanceVolumenes.vCemento).toBeCloseTo(105.1, 1); // 330/3,14
    expect(traz.balanceVolumenes.vAgregados).toBeCloseTo(711.3, 1);
    // Suma del balance cierra a ~1000
    const bv = traz.balanceVolumenes;
    expect(bv.vAgua + bv.vCemento + bv.vAire + bv.vAdiciones + bv.vAditivos + bv.vFibras + bv.vAgregados)
      .toBeCloseTo(1000, 0);

    // Pulverulento (Sección I) → cemento POST + finos re-balanceados
    const vp = traz.verificacionPulverulento;
    expect(vp.cementoPulv).toBe(330); // no 335
    // finos: 257×22% + 427×55% = 56,54 + 234,85 = 291,39 → 291
    const finosEsperado = Math.round(257 * 0.22 + 427 * 0.55);
    expect(vp.finosAgregadoPulv).toBe(finosEsperado);
    expect(vp.totalPulverulento).toBe(Math.round(330 + 0 + (257 * 0.22 + 427 * 0.55)));
    // 330 + 291 = 621 > 440 → sigue CUMPLE (verdict re-evaluado, no congelado)
    expect(vp.cumple).toBe(true);
  });

  it('sin ajuste manual, la trazabilidad pasa sin cambios (passthrough)', () => {
    const pre = resultadoPre();
    const traz = trazPre();
    const out = deriveTrazabilidadConsistente(pre, traz);
    expect(out).toBe(traz); // misma referencia, intacta
  });

  it('invariante: una sola fuente de verdad — el cemento de pulverulento sigue al resultado', () => {
    const out = deriveTrazabilidadConsistente(resultadoPost(), trazPre());
    // El cemento del veredicto Tabla 4.4 == cemento del resultado liberado.
    expect(out.verificacionPulverulento.cementoPulv).toBe(resultadoPost().cementoKgM3);
    // Y NO el cemento PRE del backend.
    expect(out.verificacionPulverulento.cementoPulv).not.toBe(trazPre().verificacionPulverulento.cementoPulv);
  });

  it('el veredicto de pulverulento se RE-CALCULA (puede invertir CUMPLE/NO CUMPLE)', () => {
    // Caso límite: bajar cemento drásticamente puede tirar el total bajo el mínimo.
    const post = resultadoPost();
    post.cementoKgM3 = 120; // ajuste extremo hipotético
    post.ajusteCemento.cementoAdoptadoKgM3 = 120;
    const traz = trazPre();
    traz.verificacionPulverulento.excepcionH20 = false;
    const out = deriveTrazabilidadConsistente(post, traz);
    // 120 + (257×22% + 427×55%) ≈ 120 + 291 = 411 < 440 → NO CUMPLE
    expect(out.verificacionPulverulento.totalPulverulento).toBeLessThan(440);
    expect(out.verificacionPulverulento.cumple).toBe(false);
  });

  it('excepcionH20 es invariante al ajuste (depende de f\'c/exposición, no del cemento)', () => {
    const post = resultadoPost();
    post.cementoKgM3 = 100;
    const traz = trazPre();
    traz.verificacionPulverulento.excepcionH20 = true; // exceptuado por norma
    const out = deriveTrazabilidadConsistente(post, traz);
    // aunque el total caiga, si la excepción aplica → cumple sigue true
    expect(out.verificacionPulverulento.cumple).toBe(true);
  });

  it('fuentesCalculo (Anexo Técnico) se re-emiten POST-ajuste', () => {
    const traz = trazPre();
    // El Anexo renderiza estos strings verbatim; el motor los embebe con
    // valores PRE. Audit test53: eran BLOCKER (V_cem 102,5 / estimado 448).
    traz.fuentesCalculo = [
      {
        parametro: 'Balance de volúmenes',
        valor: '1000 L/m³',
        regla: 'V_agua(161) + V_cem(106.7) + V_aire(20) + V_adic(0) + V_adit(2.6) + V_agr(709.7) = 1000 L/m³',
      },
      {
        parametro: 'Material pulverulento mínimo (Tabla 4.4)',
        valor: '440 kg/m³ (TMN 19 mm)',
        regla: 'Mínimo 440 kg/m³ pasante 300 µm; estimado 626 kg/m³',
      },
      { parametro: 'Otro parámetro', valor: 'x', regla: 'no debe tocarse' },
    ];
    const out = deriveTrazabilidadConsistente(resultadoPost(), traz);

    const fBal = out.fuentesCalculo.find(f => f.parametro === 'Balance de volúmenes');
    expect(fBal.regla).toContain('V_cem(105.1)'); // 330/3,14 POST, no 106.7
    expect(fBal.regla).toContain('V_agr(711.3)');
    expect(fBal.regla).not.toContain('106.7');

    const fPulv = out.fuentesCalculo.find(f => f.parametro === 'Material pulverulento mínimo (Tabla 4.4)');
    // estimado POST = 330 + round(257×22% + 427×55%) = 330 + 291 = 621
    const estimadoPost = 330 + Math.round(257 * 0.22 + 427 * 0.55);
    expect(fPulv.regla).toContain(`estimado ${estimadoPost} kg/m³`);
    expect(fPulv.regla).not.toContain('626');

    // Entradas ajenas intactas.
    const fOtro = out.fuentesCalculo.find(f => f.parametro === 'Otro parámetro');
    expect(fOtro.regla).toBe('no debe tocarse');
  });

  it('robusto ante trazabilidad/resultado nulos', () => {
    expect(deriveTrazabilidadConsistente(null, trazPre())).toEqual(trazPre());
    expect(deriveTrazabilidadConsistente(resultadoPost(), null)).toBeNull();
  });
});
