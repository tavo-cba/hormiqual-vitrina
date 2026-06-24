'use strict';

/**
 * durabilidadCirsoc25Engine.js — refactor C18 (auditoría 01-calidad, sesión 2026-05-07)
 *
 * Engine puro que verifica los criterios CIRSOC 200:2024 Tabla 2.5 que están
 * presentes en el catálogo BD `DurabilidadExposicion`:
 *   - a/c máxima por tipo estructural (SIMPLE / ARMADO / PRETENSADO)
 *   - f'c mínimo por tipo estructural
 *
 * El catálogo es la SSoT de los valores normativos; el caller (service) lo
 * carga desde `req.db` y pasa la fila correspondiente como `durRow`. El engine
 * NO toca DB ni asume tabla hardcoded.
 *
 * NOTA HISTÓRICA (C18 / B.1): una versión anterior tenía `TABLA_2_5` hardcoded
 * con valores divergentes del catálogo, y verificaba además succión capilar
 * §2.2.15, cementicio mínimo Q4 (§2.2.10), espesor de sacrificio Pomeroy-
 * Parkhurst y aire mínimo §4.3. Esas verificaciones nunca estuvieron
 * conectadas en runtime y los datos no están en el catálogo BD; quedaron
 * pendientes de implementar como follow-up de la auditoría (requieren extender
 * el catálogo `DurabilidadExposicion` con columnas adicionales).
 *
 * R4 (auditoría 01-calidad sesión 2026-05-07): este engine ahora también
 * expone `verificarAirePorTMN(...)` para Tabla 4.3 CIRSOC 200:2024 §4.3.
 * `hormiqualCalcEngine` Step 6 sigue con su lógica inline (no se rompe), pero
 * cualquier otro consumer (sugerencia, evaluación dual, tests) puede llamar
 * al engine puro y obtener la misma verificación sin depender del cálculo
 * completo de dosificación.
 *
 * Función PURA: no toca DB, recibe parámetros y la fila del catálogo.
 */

/**
 * Verifica los criterios de durabilidad por clase de exposición que están
 * en el catálogo BD `DurabilidadExposicion`.
 *
 * @param {Object} params
 * @param {string} params.claseExposicion - Código CIRSOC ('A1'..'Q4'). Requerido.
 * @param {string} [params.tipoEstructural='ARMADO'] - 'SIMPLE' | 'ARMADO' | 'PRETENSADO'.
 *   Tipos desconocidos hacen fallback a 'ARMADO'.
 * @param {number} [params.ac] - Relación a/c efectiva. Si null/undefined emite advertencia.
 * @param {number} [params.fc] - f'c (MPa). Si null/undefined emite advertencia.
 * @param {Object} [params.durRow] - Fila del catálogo `DurabilidadExposicion`. Requerida.
 *   Forma: { acMaxSimple, acMaxArmado, acMaxPretensado, fcminSimple, fcminArmado, fcminPretensado, ... }.
 *   Campos null indican "sin requisito normativo" para esa combinación clase × tipo.
 * @returns {{
 *   valido: boolean,
 *   claseExposicion: string,
 *   tipoEstructural: string,
 *   acMax: number|null,
 *   fcMin: number|null,
 *   verificaciones: { ac: object, fc: object },
 *   incumplimientos: string[],
 *   advertencias: string[],
 *   fuente: string
 * }}
 */
function verificarDurabilidad(params = {}) {
  const out = {
    valido: false,
    claseExposicion: null,
    tipoEstructural: null,
    acMax: null,
    fcMin: null,
    verificaciones: {},
    incumplimientos: [],
    advertencias: [],
    fuente: 'CIRSOC 200:2024 §2.2.4 Tabla 2.5',
  };

  const clase = String(params.claseExposicion || '').toUpperCase();
  if (!clase) {
    out.incumplimientos.push('Clase de exposición no provista.');
    return out;
  }
  out.claseExposicion = clase;

  const tipoNorm = String(params.tipoEstructural || 'ARMADO').toUpperCase();
  const tipoEstructural = ['SIMPLE', 'ARMADO', 'PRETENSADO'].includes(tipoNorm) ? tipoNorm : 'ARMADO';
  out.tipoEstructural = tipoEstructural;

  const durRow = params.durRow;
  if (!durRow) {
    out.advertencias.push(`Fila del catálogo DurabilidadExposicion no provista para clase ${clase} — no se puede verificar Tabla 2.5.`);
    return out;
  }

  // Resolución de límites por tipo estructural
  const acMax = tipoEstructural === 'SIMPLE'     ? (durRow.acMaxSimple     != null ? Number(durRow.acMaxSimple)     : null)
              : tipoEstructural === 'PRETENSADO' ? (durRow.acMaxPretensado != null ? Number(durRow.acMaxPretensado) : null)
              :                                    (durRow.acMaxArmado    != null ? Number(durRow.acMaxArmado)    : null);

  const fcMin = tipoEstructural === 'SIMPLE'     ? (durRow.fcminSimple     != null ? Number(durRow.fcminSimple)     : null)
              : tipoEstructural === 'PRETENSADO' ? (durRow.fcminPretensado != null ? Number(durRow.fcminPretensado) : null)
              :                                    (durRow.fcminArmado    != null ? Number(durRow.fcminArmado)    : null);

  out.acMax = acMax;
  out.fcMin = fcMin;

  // ── 1. a/c ──
  if (acMax === null) {
    // El catálogo no define a/c máxima para esta combinación clase × tipo estructural.
    out.verificaciones.ac = { valor: params.ac ?? null, max: null, ok: true, noAplica: true };
  } else if (params.ac == null || !Number.isFinite(Number(params.ac))) {
    out.advertencias.push(`Relación a/c no provista — clase ${clase} (${tipoEstructural}) exige a/c ≤ ${acMax}.`);
    out.verificaciones.ac = { valor: null, max: acMax, ok: null };
  } else {
    const ac = Number(params.ac);
    const okAc = ac <= acMax;
    out.verificaciones.ac = { valor: ac, max: acMax, ok: okAc };
    if (!okAc) out.incumplimientos.push(`a/c=${ac} excede límite ${acMax} para clase ${clase} (${tipoEstructural}).`);
  }

  // ── 2. f'c ──
  if (fcMin === null) {
    out.verificaciones.fc = { valor: params.fc ?? null, min: null, ok: true, noAplica: true };
  } else if (params.fc == null || !Number.isFinite(Number(params.fc))) {
    out.advertencias.push(`f'c no provisto — clase ${clase} (${tipoEstructural}) exige f'c ≥ ${fcMin} MPa.`);
    out.verificaciones.fc = { valor: null, min: fcMin, ok: null };
  } else {
    const fc = Number(params.fc);
    const okFc = fc >= fcMin;
    out.verificaciones.fc = { valor: fc, min: fcMin, ok: okFc };
    if (!okFc) out.incumplimientos.push(`f'c=${fc} MPa por debajo del mínimo ${fcMin} MPa para clase ${clase} (${tipoEstructural}).`);
  }

  out.valido = out.incumplimientos.length === 0;
  return out;
}

/**
 * R4 (auditoría 01-calidad): verificación de aire total por TMN y clase de
 * exposición, según CIRSOC 200:2024 Tabla 4.3 §4.3.
 *
 * La tabla SOLO aplica a clases C1 (incluye "hormigón a colocar bajo agua")
 * y C2. Para otras clases la función devuelve `{ aplica: false }` sin
 * incumplimiento. La fila del catálogo aporta el aire requerido y la
 * tolerancia (por defecto ±1,5%).
 *
 * Excepción H-35 (CIRSOC 200:2024 §4.3, comentario): cuando f'ce ≥ 35 MPa
 * se admite reducir el aire requerido en 1 punto porcentual. La excepción
 * se aplica solo si `params.fceMpa` se provee.
 *
 * @param {Object} params
 * @param {number} params.tmnMm                         — TMN del agregado grueso (mm). Requerido.
 * @param {string} params.claseExposicion               — Código CIRSOC. Solo C1/C2 disparan verificación.
 * @param {Array}  params.aireDurabilidad               — Filas del catálogo `AireDurabilidad`. Requerido.
 * @param {number} [params.airePct]                     — Aire total medido/diseñado (%). Si ausente → advertencia.
 * @param {number} [params.fceMpa]                      — f'ce (MPa). Si ≥ 35 aplica reducción 1 pp.
 * @returns {{
 *   aplica: boolean,
 *   claseExposicion: string|null,
 *   tmnMm: number|null,
 *   aireRequerido: number|null,
 *   aireRequeridoEfectivo: number|null,
 *   tolerancia: number|null,
 *   aireMin: number|null,
 *   aireMax: number|null,
 *   excepcionH35: boolean,
 *   verificacion: { valor: number|null, ok: boolean|null },
 *   incumplimientos: string[],
 *   advertencias: string[],
 *   fuente: string,
 * }}
 */
function verificarAirePorTMN(params = {}) {
  const out = {
    aplica: false,
    claseExposicion: null,
    tmnMm: null,
    aireRequerido: null,
    aireRequeridoEfectivo: null,
    tolerancia: null,
    aireMin: null,
    aireMax: null,
    excepcionH35: false,
    verificacion: { valor: null, ok: null },
    incumplimientos: [],
    advertencias: [],
    fuente: 'CIRSOC 200:2024 §4.3 Tabla 4.3',
  };

  const clase = String(params.claseExposicion || '').toUpperCase();
  out.claseExposicion = clase || null;

  if (clase !== 'C1' && clase !== 'C2') {
    return out; // Tabla 4.3 solo aplica a C1 y C2.
  }

  const tmn = Number(params.tmnMm);
  if (!Number.isFinite(tmn)) {
    out.advertencias.push('TMN no provisto — no se puede verificar Tabla 4.3.');
    return out;
  }
  out.tmnMm = tmn;

  const tabla = Array.isArray(params.aireDurabilidad) ? params.aireDurabilidad : [];
  if (tabla.length === 0) {
    out.advertencias.push('Catálogo AireDurabilidad vacío — no se puede verificar Tabla 4.3.');
    return out;
  }

  // Match exacto (tolerancia 0.1 mm por DECIMAL/Number drift).
  const fila = tabla.find((r) =>
    Math.abs(Number(r.tmnMm) - tmn) < 0.1 &&
    String(r.claseExposicion).toUpperCase() === clase
  );
  if (!fila) {
    out.advertencias.push(`Tabla 4.3 no tiene fila para TMN ${tmn} mm × clase ${clase}. Los TMN normados son 13,2 / 19,0 / 26,5 / 37,5.`);
    return out;
  }

  out.aplica = true;
  const aireReq = Number(fila.aireTotalPct);
  const tol = Number(fila.toleranciaPct ?? 1.5);
  out.aireRequerido = aireReq;
  out.tolerancia = tol;

  // Excepción H-35 (§4.3): f'ce ≥ 35 MPa permite reducir 1 pp.
  const fceVal = params.fceMpa != null ? Number(params.fceMpa) : null;
  out.excepcionH35 = Number.isFinite(fceVal) && fceVal >= 35;
  out.aireRequeridoEfectivo = out.excepcionH35 ? aireReq - 1.0 : aireReq;
  out.aireMin = out.aireRequeridoEfectivo - tol;
  out.aireMax = out.aireRequeridoEfectivo + tol; // tope superior se mantiene en req+tol

  // Verificación contra valor de diseño/medido.
  if (params.airePct == null) {
    out.advertencias.push(`Clase ${clase} TMN ${tmn} mm exige aire ${aireReq.toFixed(1)} ± ${tol.toFixed(1)}%${out.excepcionH35 ? ' (con reducción H-35: efectivo ' + out.aireRequeridoEfectivo.toFixed(1) + '%)' : ''} — no se especificó aire en el diseño.`);
    return out;
  }
  const airePctNum = Number(params.airePct);
  if (!Number.isFinite(airePctNum)) {
    out.advertencias.push(`airePct=${params.airePct} no numérico — no se verifica Tabla 4.3.`);
    return out;
  }
  out.verificacion.valor = airePctNum;
  const ok = airePctNum >= out.aireMin && airePctNum <= out.aireMax;
  out.verificacion.ok = ok;
  if (!ok) {
    out.incumplimientos.push(
      `Aire total ${airePctNum.toFixed(1)}% fuera del rango ${out.aireMin.toFixed(1)}–${out.aireMax.toFixed(1)}% para clase ${clase}, TMN ${tmn} mm (Tabla 4.3${out.excepcionH35 ? ', con reducción H-35' : ''}).`
    );
  }

  return out;
}

/**
 * HER-24 — Verificación de material pulverulento mínimo (CIRSOC 200:2024
 * Tabla 4.4 y §4.1.3). Engine puro extraído de la lógica embebida en
 * `hormiqualCalcEngine.js` (Step 8/Step 9) para que la calculadora del
 * laboratorio (Herramientas → Tabla 4.4) y eventualmente el motor de
 * sugerencia puedan reutilizar la misma verificación sin recalcular
 * la dosificación completa.
 *
 * Material pasante #50 (300 µm) = cemento + adiciones + finos pasantes
 * 300 µm de los agregados (suma proporcional a su participación en
 * masa). La fila del catálogo `PulverulentoMinimo` aporta el mínimo
 * exigido por TMN.
 *
 * Excepción §4.1.3 — la exigencia NO aplica si se cumplen las TRES
 * condiciones simultáneamente:
 *   1) f'c ≤ 20 MPa.
 *   2) Hormigón NO bombeado (`metodoColocacion === 'CONVENCIONAL'`).
 *   3) Sin clase de exposición agresiva (CL/M/Q/C1/C2).
 *
 * @param {Object} params
 * @param {number} params.tmnMm                  - TMN del agregado grueso (mm). Requerido.
 * @param {number} [params.cementoKg]            - Cemento (kg/m³). Asumido 100% pasante 300 µm.
 * @param {number} [params.adicionesKg]          - Suma de adiciones (kg/m³). Asumido 100% pasante 300 µm.
 * @param {number} [params.finosAgregadoKg]      - Finos pasantes 300 µm provenientes de los agregados (kg/m³).
 * @param {Array}  [params.agregados]            - Alternativa: array { kgM3, p300Pct }. Si se provee,
 *                                                 se calcula `finosAgregadoKg` como suma de kgM3 × p300%/100.
 * @param {number} [params.fcMpa]                - f'c de diseño (MPa). Usado para evaluar la excepción §4.1.3.
 * @param {string} [params.metodoColocacion]     - 'CONVENCIONAL' | 'BOMBEADO'. Default 'CONVENCIONAL'.
 * @param {string} [params.claseExposicion]      - Código CIRSOC. Si es CL/M/Q/C1/C2 la excepción no aplica.
 * @param {Array}  params.pulverulentoMinimo     - Filas del catálogo `PulverulentoMinimo`. Requerido.
 * @returns {{
 *   aplica: boolean,
 *   tmnMm: number|null,
 *   minimoKgM3: number|null,
 *   cementoKg: number,
 *   adicionesKg: number,
 *   finosAgregadoKg: number,
 *   totalPulverulento: number,
 *   excepcionH20: boolean,
 *   metodoColocacion: string,
 *   verificacion: { ok: boolean|null },
 *   incumplimientos: string[],
 *   advertencias: string[],
 *   fuente: string,
 * }}
 */
function verificarPulverulentoMinimo(params = {}) {
  const out = {
    aplica: false,
    tmnMm: null,
    minimoKgM3: null,
    cementoKg: 0,
    adicionesKg: 0,
    finosAgregadoKg: 0,
    totalPulverulento: 0,
    excepcionH20: false,
    metodoColocacion: 'CONVENCIONAL',
    verificacion: { ok: null },
    incumplimientos: [],
    advertencias: [],
    fuente: 'CIRSOC 200:2024 §4.1.3 Tabla 4.4',
  };

  const tmn = Number(params.tmnMm);
  if (!Number.isFinite(tmn)) {
    out.advertencias.push('TMN no provisto — no se puede verificar Tabla 4.4.');
    return out;
  }
  out.tmnMm = tmn;

  const tabla = Array.isArray(params.pulverulentoMinimo) ? params.pulverulentoMinimo : [];
  if (tabla.length === 0) {
    out.advertencias.push('Catálogo PulverulentoMinimo vacío — no se puede verificar Tabla 4.4.');
    return out;
  }

  const fila = tabla.find((r) => Math.abs(Number(r.tmnMm) - tmn) < 0.1);
  if (!fila) {
    out.advertencias.push(
      `Tabla 4.4 no tiene fila para TMN ${tmn} mm. Los TMN normados son 13,2 / 19,0 / 26,5 / 37,5 / 53,0.`
    );
    return out;
  }
  out.minimoKgM3 = Number(fila.minimoKgM3);

  out.cementoKg = Number(params.cementoKg) > 0 ? Number(params.cementoKg) : 0;
  out.adicionesKg = Number(params.adicionesKg) > 0 ? Number(params.adicionesKg) : 0;

  // finosAgregadoKg explícito, o calculado a partir de agregados.
  if (Number(params.finosAgregadoKg) >= 0 && Number.isFinite(Number(params.finosAgregadoKg))) {
    out.finosAgregadoKg = Number(params.finosAgregadoKg);
  } else if (Array.isArray(params.agregados) && params.agregados.length > 0) {
    out.finosAgregadoKg = params.agregados.reduce((sum, ag) => {
      const kg = Number(ag.kgM3);
      const p300 = Number(ag.p300Pct);
      if (Number.isFinite(kg) && kg > 0 && Number.isFinite(p300) && p300 >= 0) {
        return sum + (kg * p300) / 100;
      }
      return sum;
    }, 0);
  }

  out.totalPulverulento = Math.round(out.cementoKg + out.adicionesKg + out.finosAgregadoKg);

  // Excepción §4.1.3: f'c ≤ 20 MPa + NO bombeado + sin exposición agresiva (CL/M/Q/C1/C2).
  const metodo = String(params.metodoColocacion || 'CONVENCIONAL').toUpperCase();
  out.metodoColocacion = metodo === 'BOMBEADO' ? 'BOMBEADO' : 'CONVENCIONAL';
  if (params.metodoColocacion == null || params.metodoColocacion === '') {
    out.advertencias.push(
      "metodoColocacion no provisto — se asume CONVENCIONAL para evaluar excepción §4.1.3."
    );
  }

  const claseExp = String(params.claseExposicion || '').toUpperCase();
  const exposicionAgresiva = ['CL1', 'CL2', 'M1', 'M2', 'M3', 'C1', 'C2', 'Q1', 'Q2', 'Q3', 'Q4']
    .includes(claseExp);

  const fcVal = Number(params.fcMpa);
  out.excepcionH20 = Number.isFinite(fcVal) && fcVal <= 20
    && out.metodoColocacion === 'CONVENCIONAL'
    && !exposicionAgresiva;

  out.aplica = !out.excepcionH20;

  const ok = out.totalPulverulento >= out.minimoKgM3 || out.excepcionH20;
  out.verificacion.ok = ok;

  if (!ok) {
    out.incumplimientos.push(
      `Material pulverulento estimado (${out.totalPulverulento} kg/m³) inferior al mínimo `
      + `${out.minimoKgM3} kg/m³ exigido para TMN ${tmn} mm (Tabla 4.4 CIRSOC 200:2024).`
    );
  }

  return out;
}

module.exports = {
  verificarDurabilidad,
  verificarAirePorTMN,
  verificarPulverulentoMinimo,
};
