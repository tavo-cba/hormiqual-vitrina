'use strict';

/**
 * Motor puro de evaluación normativa de ensayos de hormigón fresco
 * (Bloque 5 auditoría 08 — fix C-NORM-03).
 *
 * Hormigón fresco abarca:
 *  - Asentamiento (cono de Abrams) — IRAM 1536:2020.
 *  - Temperatura del hormigón fresco — CIRSOC 200-2024 §5.1.2 / §5.2.2.1 / §6.7.5.
 *  - Contenido de aire incorporado — IRAM 1602-2:1988 (mod. 2020) método
 *    presiométrico, y CIRSOC 200-2024 Tabla 4.3 (límites por TMN + clase
 *    exposición C1/C2 — la implementación actual es legacy F1/F2/F3 y se
 *    migrará en R3 post-revisor-civil).
 *
 * Este engine NO toca DB ni HTTP. Es testeable en aislamiento. Los services
 * lo invocan al guardar una `Muestra` y persisten el resultado como warnings
 * (no bloqueantes en esta primera ola — el laboratorista decide).
 *
 * VERIFICADO 2026-05-08 contra CIRSOC 200-2024 (T.2.2, T.4.2, T.4.3, T.5.1,
 * §5.1.2, §5.2.2.1) e IRAM 1666:2020 §5.1.2/§5.1.3 (revisor-civil, Bloque 16
 * auditoría 08). Los 5 bloques de valores numéricos auditados están alineados
 * con las normas.
 *
 * Pendientes documentados (mejoras menores, no bloquean producción):
 *  (a) excepción §4.1.2.4 (reducción 1,0% para H ≥ H-35) — implementada como
 *      parámetro opcional `ctx.reduccionH35Pct` en `evaluarAire`.
 *  (b) predicado §4.1.2.3 ajustado a TMN ≥ 53 mm (antes > 37,5).
 *  (c) mapeo legacy F2→C2 flagueado como criterio conservador HormiQual
 *      (no existe tabla de equivalencias oficial publicada por CIRSOC para
 *      la transición 201:2005 → 200-2024).
 */

// CIRSOC 200-2024 §5.1.2 (tiempo frío, Tabla 5.1) + §5.2.2.1 (tiempo
// cálido) + §6.7.5 (conformidad fresco) — temperatura del hormigón
// fresco al colocar.
//
// R5b (revisor-civil 2026-05-08): la temperatura mínima depende de la
// DIMENSIÓN TRANSVERSAL del elemento, no es un valor único. La máxima
// también admite excepción para elementos chicos.
//
// Tabla 5.1 (mín tiempo frío):                     §5.2.2.1 (máx tiempo cálido):
//   Sección < 30 cm:           13 °C                 General:                  32 °C
//   Sección 30 a 90 cm:        10 °C                 Si dim ≤ 30 cm:           35 °C
//   Sección 90 a 180 cm:        7 °C
//   Sección > 180 cm:           5 °C
//
// §5.1.6.4 admite 5 °C con protección y sensores embebidos (caso especial
// no implementado: el caller pasaría `tempProteccionEspecial: true`).
const TEMP_HORMIGON_TABLA_DIM = Object.freeze([
  { dimMaxCm:  30, minC: 13, maxC: 35 },
  { dimMaxCm:  90, minC: 10, maxC: 32 },
  { dimMaxCm: 180, minC:  7, maxC: 32 },
  { dimMaxCm: Infinity, minC: 5, maxC: 32 },
]);

// Default conservador cuando no se conoce la dimensión: usa el rango más
// estricto (mín 13 °C / máx 32 °C). El revisor-civil lo recomienda como
// safety: si el sistema no sabe la dimensión, no puede aceptar 5 °C ni 35 °C.
const TEMP_HORMIGON_MIN_C = 13;
const TEMP_HORMIGON_MAX_C = 32;

/**
 * Devuelve el rango de temperatura del fresco según la dimensión transversal
 * del elemento estructural (CIRSOC 200-2024 Tabla 5.1 + §5.2.2.1).
 *
 * @param {number|null} dimMinElementoCm  Dimensión mínima transversal en cm.
 *                                        Si null, devuelve el rango más
 *                                        estricto (default conservador).
 * @returns {{ minC, maxC, fila: object }}
 */
function rangoTempPorDimension(dimMinElementoCm) {
  if (dimMinElementoCm == null || !Number.isFinite(Number(dimMinElementoCm))) {
    return {
      minC: TEMP_HORMIGON_MIN_C,
      maxC: TEMP_HORMIGON_MAX_C,
      fila: { dimMaxCm: 30, minC: 13, maxC: 32 },
      defaultUsado: true,
    };
  }
  const dim = Number(dimMinElementoCm);
  for (const fila of TEMP_HORMIGON_TABLA_DIM) {
    if (dim <= fila.dimMaxCm) {
      return { minC: fila.minC, maxC: fila.maxC, fila, defaultUsado: false };
    }
  }
  // Nunca debería caer (Infinity captura todo), pero por seguridad:
  const ultimo = TEMP_HORMIGON_TABLA_DIM[TEMP_HORMIGON_TABLA_DIM.length - 1];
  return { minC: ultimo.minC, maxC: ultimo.maxC, fila: ultimo, defaultUsado: false };
}

// CIRSOC 200-2024 Tabla 4.2 — Clases de consistencia y tolerancias.
//
// R6 (revisor-civil 2026-05-08): la versión anterior usaba un umbral binario
// en 80 mm (±20/±30 mm) que NO figura en la norma. La tabla real define
// clase de consistencia por rango de asentamiento (en cm) + tolerancia
// específica por clase. Implementación en mm para alinear con
// `MedicionPaston.asentamientoMm` y `Muestra.asentamientoMm`.
//
// Ranges en mm: Seca (20-50), Plástica (50-100), Muy plástica (100-150),
// Fluida (150-180). Asentamiento > 180 mm sale del método del cono Abrams
// y debe medirse por extendido (IRAM 1690) o V-funnel.
const CLASES_CONSISTENCIA_CIRSOC = Object.freeze([
  {
    clase: 'SECA',           rangoMinMm: 20,  rangoMaxMm: 50,  tolMm: 10,
    label: 'Seca',           descripcion: '2,0 < A ≤ 5,0 cm',
  },
  {
    clase: 'PLASTICA',       rangoMinMm: 50,  rangoMaxMm: 100, tolMm: 20,
    label: 'Plástica',       descripcion: '5,0 < A ≤ 10,0 cm',
  },
  {
    clase: 'MUY_PLASTICA',   rangoMinMm: 100, rangoMaxMm: 150, tolMm: 20,
    label: 'Muy plástica',   descripcion: '10,0 < A ≤ 15,0 cm',
  },
  {
    clase: 'FLUIDA',         rangoMinMm: 150, rangoMaxMm: 180, tolMm: 30,
    label: 'Fluida',         descripcion: '15,0 < A ≤ 18,0 cm',
  },
  // Muy fluida (E > 60 cm) y Remoldeo (V) usan métodos distintos al cono
  // Abrams; no se evalúan acá.
]);

// Constantes legacy para back-compat con callers que aún esperaban estas
// exportaciones. Pendiente: eliminar cuando se confirme que ningún caller
// las usa.
const TOL_ASENTAMIENTO_BAJO_MM = 20;
const TOL_ASENTAMIENTO_ALTO_MM = 30;
const UMBRAL_ASENTAMIENTO_TOL_MM = 80;

/**
 * Clasifica la consistencia de un asentamiento objetivo según CIRSOC Tabla 4.2.
 * Devuelve la clase aplicable y la tolerancia en mm. Si el asentamiento está
 * fuera del rango (típicamente <20 mm o >180 mm), devuelve null y el caller
 * decide qué hacer.
 */
function clasificarConsistencia(asentamientoObjetivoMm) {
  if (asentamientoObjetivoMm == null) return null;
  const v = Number(asentamientoObjetivoMm);
  if (!Number.isFinite(v)) return null;
  for (const c of CLASES_CONSISTENCIA_CIRSOC) {
    // Inclusivo en rangoMin (excepto la primera para evitar overlap), exclusivo en rangoMax.
    if (v > c.rangoMinMm && v <= c.rangoMaxMm) {
      return { clase: c.clase, tolMm: c.tolMm, label: c.label, descripcion: c.descripcion };
    }
  }
  // Caso especial: asentamiento exacto en el límite inferior de la primera
  // clase (20 mm). Lo aceptamos en SECA por convención.
  if (v === 20) {
    const c = CLASES_CONSISTENCIA_CIRSOC[0];
    return { clase: c.clase, tolMm: c.tolMm, label: c.label, descripcion: c.descripcion };
  }
  return null; // Fuera del cono Abrams (usar otro método de medición).
}

// Rangos físicos razonables (para detectar valores claramente fuera de
// dominio: typo, error de carga). No confundir con tolerancias normativas.
const ASENTAMIENTO_MIN_VALIDO_MM = 0;
const ASENTAMIENTO_MAX_VALIDO_MM = 250;

// CIRSOC 200-2024 Tabla 4.3 — Contenido medio total de aire incorporado.
//
// R3 (revisor-civil 2026-05-08): la tabla real usa clases C1/C2
// (heladicidad) — NO F1/F2/F3 (esas eran nomenclatura del CIRSOC 201:2005).
// Cuatro TMNs (13,2 / 19,0 / 26,5 / 37,5 mm) y valores expresados como
// MEDIANO ± 1,5 % (según IRAM 1666:2020 §5.1.2 — tolerancia de medición).
//
// Estructura: [tmnMmMax, { C1: medio %, C2: medio % }]. El TMN se busca
// por upper-bound (≤13,2 → primer rango). Para C0 (sin clase F) el caller
// debe saltear la evaluación.
//
// Reglas adicionales:
//   §4.1.2.4 — Para H ≥ H-35, los valores pueden REDUCIRSE hasta 1,0 %
//   si el proyecto lo autoriza (override a través de ctx.toleranciaMin).
//   §4.1.2.3 — Para TMN ≥ 53 mm, medir el aire sobre la fracción que
//   pase 37,5 mm (no implementado: warning informativo).
const AIRE_INCORPORADO_TABLA = Object.freeze([
  [13.2, { C1: 5.5, C2: 7.0 }],
  [19.0, { C1: 5.0, C2: 6.0 }],
  [26.5, { C1: 4.5, C2: 6.0 }],
  [37.5, { C1: 4.5, C2: 5.5 }],
]);

// Tolerancia de medición ± IRAM 1666:2020 §5.1.2 / CIRSOC 200-2024 Tabla 4.3
// (la notación "medio ± 1,5" está integrada en cada celda de Tabla 4.3).
const AIRE_TOLERANCIA_PCT = 1.5;

// CIRSOC 200-2024 §4.1.2.4: para hormigones de clase ≥ H-35 los valores
// medios de Tabla 4.3 pueden reducirse hasta 1,0 punto porcentual si los
// Documentos de Proyecto lo autorizan.
const AIRE_REDUCCION_MAX_H35_PCT = 1.0;

// CIRSOC 200-2024 §4.1.2.3: para TMN ≥ 53 mm el aire se mide sobre la
// fracción que pasa el tamiz 37,5 mm (los valores de Tabla 4.3 se aplican
// a esa fracción). Antes el código disparaba el disclaimer con > 37,5 mm,
// lo cual no es estrictamente fiel al texto de la norma.
const TMN_FRACCION_37_5_MM = 53;

// Mapeo legacy F1/F2/F3 → C1/C2. Si un caller envía nomenclatura vieja,
// la engine emite warning y mapea conservadoramente.
const MAPEO_CLASES_LEGACY = Object.freeze({
  F0: null,  // sin requisito (igual que C0)
  F1: 'C1',  // F1 era heladicidad moderada → C1
  F2: 'C2',  // F2 era heladicidad alta → C2
  F3: 'C2',  // F3 era heladicidad severa → C2 (no hay C3 en CIRSOC 200-2024)
});

const SEVERIDADES = Object.freeze({
  OK:       'ok',
  WARNING:  'warning',
  CRITICAL: 'critical',
});

/* ─────────── Helpers ─────────── */

function veredicto(cumple, severity, motivo, cita, extra = {}) {
  return Object.assign({ cumple, severity, motivo, cita }, extra);
}

/* ─────────── Asentamiento ─────────── */

/**
 * Evalúa asentamiento del cono de Abrams contra el objetivo declarado
 * en dosificación + tolerancia CIRSOC §4.1.
 *
 * @param {number} asentamientoMm Valor medido en mm.
 * @param {object} ctx
 * @param {number} [ctx.objetivoMm]       Asentamiento objetivo de la dosificación.
 * @param {number} [ctx.toleranciaMm]     Override de tolerancia (default según escalón).
 * @returns {object} { cumple, severity, motivo, cita, valor, objetivo, tolerancia, ...}
 */
function evaluarAsentamiento(asentamientoMm, ctx = {}) {
  if (asentamientoMm == null) {
    return veredicto(null, SEVERIDADES.WARNING, 'Sin medición de asentamiento.',
      'IRAM 1536:2020 — recomendable medir en cada muestra.');
  }
  const valor = Number(asentamientoMm);
  if (!Number.isFinite(valor)) {
    return veredicto(false, SEVERIDADES.CRITICAL,
      `Valor de asentamiento inválido: ${asentamientoMm}`,
      'IRAM 1536:2020');
  }
  // Validación de dominio (typo, valor en cm cargado por error).
  if (valor < ASENTAMIENTO_MIN_VALIDO_MM || valor > ASENTAMIENTO_MAX_VALIDO_MM) {
    return veredicto(false, SEVERIDADES.CRITICAL,
      `Asentamiento ${valor} mm fuera de rango físico razonable [${ASENTAMIENTO_MIN_VALIDO_MM}, ${ASENTAMIENTO_MAX_VALIDO_MM}] mm. ¿Está cargado en cm por error?`,
      'IRAM 1536:2020',
      { valor });
  }

  const objetivoMm = ctx.objetivoMm != null ? Number(ctx.objetivoMm) : null;
  if (objetivoMm == null) {
    return veredicto(true, SEVERIDADES.OK,
      'Asentamiento medido. Sin objetivo declarado en la dosificación: no se evalúa tolerancia.',
      'IRAM 1536:2020',
      { valor });
  }

  // R6 (revisor-civil 2026-05-08): tolerancia por CLASE DE CONSISTENCIA
  // según CIRSOC Tabla 4.2, no por umbral binario 80 mm.
  let tolMm;
  let claseInfo = null;
  if (ctx.toleranciaMm != null) {
    // Override explícito del caller (raro; documentado).
    tolMm = Number(ctx.toleranciaMm);
  } else {
    claseInfo = clasificarConsistencia(objetivoMm);
    if (!claseInfo) {
      return veredicto(null, SEVERIDADES.WARNING,
        `Asentamiento objetivo ${objetivoMm} mm fuera del rango del cono Abrams (20-180 mm). Para muy fluidas usar IRAM 1690 (extendido); para muy secas IRAM 1767 (V-funnel).`,
        'IRAM 1536:2020 §1.4 — método válido para 2 ≤ A ≤ 21 cm aprox.',
        { valor, objetivo: objetivoMm });
    }
    tolMm = claseInfo.tolMm;
  }

  const min = objetivoMm - tolMm;
  const max = objetivoMm + tolMm;
  if (valor < min || valor > max) {
    const claseLabel = claseInfo ? `clase ${claseInfo.label} (${claseInfo.descripcion})` : `tolerancia override ±${tolMm} mm`;
    return veredicto(false, SEVERIDADES.WARNING,
      `Asentamiento ${valor} mm fuera de tolerancia [${min}, ${max}] mm respecto al objetivo ${objetivoMm} mm (${claseLabel}).`,
      `CIRSOC 200-2024 Tabla 4.2 — ${claseLabel}, tolerancia ±${tolMm} mm.`,
      { valor, objetivo: objetivoMm, tolerancia: tolMm, clase: claseInfo?.clase ?? null });
  }

  return veredicto(true, SEVERIDADES.OK,
    `Asentamiento ${valor} mm dentro de tolerancia [${min}, ${max}] mm.`,
    `CIRSOC 200-2024 Tabla 4.2 — ${claseInfo ? claseInfo.label : 'tolerancia explícita'}, ±${tolMm} mm.`,
    { valor, objetivo: objetivoMm, tolerancia: tolMm, clase: claseInfo?.clase ?? null });
}

/* ─────────── Temperatura del hormigón fresco ─────────── */

/**
 * Evalúa temperatura del hormigón al colocar.
 *
 * R5b (revisor-civil 2026-05-08): el rango ahora depende de la dimensión
 * mínima transversal del elemento estructural (CIRSOC §5.1.2 Tabla 5.1
 * para tiempo frío + §5.2.2.1 para tiempo cálido). Si el caller no pasa
 * `dimMinElementoCm`, se usa el rango más estricto [13, 32] °C como
 * default conservador.
 *
 * @param {number} tempC
 * @param {object} ctx
 * @param {number} [ctx.dimMinElementoCm]  Dimensión mínima transversal en cm.
 * @param {number} [ctx.minC]              Override explícito del mínimo.
 * @param {number} [ctx.maxC]              Override explícito del máximo.
 * @returns {object}
 */
function evaluarTemperaturaHormigon(tempC, ctx = {}) {
  if (tempC == null) {
    return veredicto(null, SEVERIDADES.WARNING, 'Sin medición de temperatura del hormigón.',
      'CIRSOC 200-2024 §5.1.2 / §5.2.2.1 / §6.7.5 — recomendable registrar en obra.');
  }
  const valor = Number(tempC);
  if (!Number.isFinite(valor)) {
    return veredicto(false, SEVERIDADES.CRITICAL,
      `Valor de temperatura inválido: ${tempC}`, 'CIRSOC 200-2024 §5.1.2 / §5.2.2.1 / §6.7.5');
  }

  // R5b: derivar rango de la dimensión, salvo override explícito.
  const rango = (ctx.minC != null || ctx.maxC != null)
    ? { minC: ctx.minC != null ? Number(ctx.minC) : TEMP_HORMIGON_MIN_C,
        maxC: ctx.maxC != null ? Number(ctx.maxC) : TEMP_HORMIGON_MAX_C,
        defaultUsado: false }
    : rangoTempPorDimension(ctx.dimMinElementoCm);

  const sufijoDim = rango.defaultUsado
    ? ' [Sin dimensión declarada del elemento: rango conservador 13-32 °C aplicado.]'
    : (ctx.dimMinElementoCm != null
        ? ` [Dimensión mín del elemento: ${ctx.dimMinElementoCm} cm → rango Tabla 5.1.]`
        : '');

  if (valor < rango.minC || valor > rango.maxC) {
    return veredicto(false, SEVERIDADES.WARNING,
      `Temperatura del hormigón ${valor} °C fuera del rango operativo [${rango.minC}, ${rango.maxC}] °C.${sufijoDim}`,
      'CIRSOC 200-2024 §5.1.2 (Tabla 5.1) / §5.2.2.1',
      { valor, minC: rango.minC, maxC: rango.maxC, defaultUsado: rango.defaultUsado });
  }
  return veredicto(true, SEVERIDADES.OK,
    `Temperatura ${valor} °C dentro del rango [${rango.minC}, ${rango.maxC}] °C.${sufijoDim}`,
    'CIRSOC 200-2024 §5.1.2 (Tabla 5.1) / §5.2.2.1',
    { valor, minC: rango.minC, maxC: rango.maxC, defaultUsado: rango.defaultUsado });
}

/* ─────────── Aire incorporado ─────────── */

/**
 * Normaliza la clase de exposición: si es legacy (F1/F2/F3), mapea a
 * C1/C2 con flag `legacy: true`. Si es C0/C1/C2 directa, devuelve tal cual.
 */
function normalizarClaseExposicion(clase) {
  if (!clase) return { clase: null, legacy: false };
  const c = String(clase).toUpperCase();
  if (c === 'C0' || c === 'F0') return { clase: 'C0', legacy: c === 'F0' };
  if (c === 'C1' || c === 'C2') return { clase: c, legacy: false };
  if (c in MAPEO_CLASES_LEGACY) {
    return { clase: MAPEO_CLASES_LEGACY[c], legacy: true };
  }
  return { clase: null, legacy: false };
}

/**
 * Devuelve el valor mediano de aire según TMN y clase (CIRSOC Tabla 4.3).
 */
function lookupValorAire(tmnMm, claseNormalizada) {
  if (tmnMm == null || !claseNormalizada || claseNormalizada === 'C0') return null;
  const tmn = Number(tmnMm);
  if (!Number.isFinite(tmn)) return null;
  for (const [tmnMax, valores] of AIRE_INCORPORADO_TABLA) {
    if (tmn <= tmnMax) {
      return valores[claseNormalizada] ?? null;
    }
  }
  // TMN > 37,5 (ej. 53 mm): aplicar §4.1.2.3 — medir sobre fracción que
  // pase 37,5 mm. Devolvemos último valor con disclaimer.
  const ultimo = AIRE_INCORPORADO_TABLA[AIRE_INCORPORADO_TABLA.length - 1][1];
  return ultimo[claseNormalizada] ?? null;
}

/**
 * Evalúa contenido de aire incorporado contra CIRSOC 200-2024 Tabla 4.3.
 *
 * R3 (revisor-civil 2026-05-08): clases C1/C2 (no F1/F2/F3 legacy);
 * 4 TMNs reales (13,2/19/26,5/37,5); valores mediano ± 1,5 %.
 * Bloque 16 auditoría 08 (revisor-civil 2026-05-08, segunda pasada):
 *   - Predicado §4.1.2.3 ajustado a TMN ≥ 53 mm (antes > 37,5).
 *   - Excepción §4.1.2.4 implementada vía `ctx.reduccionH35Pct` (hasta 1,0 %
 *     para hormigones ≥ H-35 si los Documentos de Proyecto lo autorizan).
 *
 * @param {number} porcAire    Aire medido en %.
 * @param {object} ctx
 * @param {number} [ctx.tmnMm]            Tamaño máximo nominal del agregado.
 * @param {string} [ctx.claseExposicion]  'C0'/'C1'/'C2' (o legacy 'F0'/'F1'/'F2'/'F3').
 * @param {number} [ctx.reduccionH35Pct]  Reducción §4.1.2.4 en puntos % (0..1,0).
 *                                        Aplicable sólo si claseHormigon ≥ H-35
 *                                        y Documentos de Proyecto lo autorizan.
 * @returns {object}
 */
function evaluarAire(porcAire, ctx = {}) {
  if (porcAire == null) {
    return veredicto(null, SEVERIDADES.WARNING, 'Sin medición de aire incorporado.',
      'IRAM 1602-2:1988 (mod. 2020) — método presiométrico.');
  }
  const valor = Number(porcAire);
  if (!Number.isFinite(valor)) {
    return veredicto(false, SEVERIDADES.CRITICAL,
      `Valor de aire inválido: ${porcAire}`, 'IRAM 1602-2:1988');
  }
  const { clase, legacy } = normalizarClaseExposicion(ctx.claseExposicion);
  if (!clase || clase === 'C0') {
    return veredicto(true, SEVERIDADES.OK,
      `Aire ${valor} % medido. Sin clase de exposición C: no se evalúa contra Tabla 4.3 CIRSOC.`,
      'IRAM 1602-2:1988',
      { valor });
  }
  let valorMedio = lookupValorAire(ctx.tmnMm, clase);
  if (valorMedio == null) {
    return veredicto(null, SEVERIDADES.WARNING,
      `No se encontró rango en Tabla 4.3 para TMN=${ctx.tmnMm} mm + clase ${clase}.`,
      'CIRSOC 200-2024 §4.3 Tabla 4.3',
      { valor });
  }

  // §4.1.2.4: reducción opcional hasta 1,0 puntos % para H ≥ H-35.
  let reduccionAplicada = 0;
  if (ctx.reduccionH35Pct != null) {
    const r = Number(ctx.reduccionH35Pct);
    if (Number.isFinite(r) && r > 0) {
      reduccionAplicada = Math.min(Math.abs(r), AIRE_REDUCCION_MAX_H35_PCT);
      valorMedio = valorMedio - reduccionAplicada;
    }
  }

  // Rango aceptable: mediano ± 1,5 %.
  const min = valorMedio - AIRE_TOLERANCIA_PCT;
  const max = valorMedio + AIRE_TOLERANCIA_PCT;
  const sufijoLegacy = legacy
    ? ` [Nota: clase '${ctx.claseExposicion}' es nomenclatura legacy de CIRSOC 201:2005; se mapeó a '${clase}' de CIRSOC 200-2024 (criterio conservador HormiQual; no hay tabla de equivalencias oficial publicada).]`
    : '';
  // §4.1.2.3 — TMN ≥ 53 mm: medir sobre fracción que pase 37,5 mm.
  const sufijoTmnGrande = (Number(ctx.tmnMm) >= TMN_FRACCION_37_5_MM)
    ? ` [§4.1.2.3 — TMN ≥ ${TMN_FRACCION_37_5_MM} mm: medir aire sobre la fracción que pasa el tamiz 37,5 mm.]`
    : '';
  const sufijoH35 = (reduccionAplicada > 0)
    ? ` [§4.1.2.4 — Reducción ${reduccionAplicada.toFixed(1)} % aplicada por hormigón ≥ H-35 con autorización de proyecto.]`
    : '';

  if (valor < min || valor > max) {
    return veredicto(false, SEVERIDADES.WARNING,
      `Aire ${valor} % fuera del rango [${min}, ${max}] % (mediano ${valorMedio} ± ${AIRE_TOLERANCIA_PCT}) para TMN=${ctx.tmnMm} mm + clase ${clase}.${sufijoLegacy}${sufijoTmnGrande}${sufijoH35}`,
      'CIRSOC 200-2024 §4.3 Tabla 4.3',
      { valor, valorMedio, tolerancia: AIRE_TOLERANCIA_PCT, clase, legacy, reduccionAplicada });
  }
  return veredicto(true, SEVERIDADES.OK,
    `Aire ${valor} % dentro del rango [${min}, ${max}] % (mediano ${valorMedio} ± ${AIRE_TOLERANCIA_PCT}) para TMN=${ctx.tmnMm} mm + clase ${clase}.${sufijoLegacy}${sufijoTmnGrande}${sufijoH35}`,
    'CIRSOC 200-2024 §4.3 Tabla 4.3',
    { valor, valorMedio, tolerancia: AIRE_TOLERANCIA_PCT, clase, legacy, reduccionAplicada });
}

/* ─────────── Entry point: muestra completa ─────────── */

/**
 * Evalúa todos los datos de fresco de una muestra contra norma.
 *
 * @param {object} muestra { temperaturaHormigon, asentamientoMm, aireincorporado, ... }
 * @param {object} ctx     { dosificacion: { asentamientoObjetivoMm, tmnMm, claseExposicion } }
 * @returns {object}       { temperatura, asentamiento, aire, summary: { cumpleTodo, warnings } }
 */
function evaluarMuestraFresco(muestra, ctx = {}) {
  if (!muestra) return null;
  const dosif = ctx.dosificacion ?? {};
  const temperatura = evaluarTemperaturaHormigon(muestra.temperaturaHormigon, {
    minC: dosif.tempMinC,
    maxC: dosif.tempMaxC,
  });
  const asentamiento = evaluarAsentamiento(muestra.asentamientoMm ?? null, {
    objetivoMm: dosif.asentamientoObjetivoMm,
    toleranciaMm: dosif.asentamientoToleranciaMm,
  });
  const aire = evaluarAire(muestra.aireincorporado, {
    tmnMm: dosif.tmnMm,
    claseExposicion: ctx.claseExposicion ?? dosif.claseExposicion ?? null,
  });
  const summary = {
    cumpleTodo: [temperatura, asentamiento, aire].every((v) => v.cumple !== false),
    warnings: [temperatura, asentamiento, aire].filter((v) => v.severity === SEVERIDADES.WARNING || v.severity === SEVERIDADES.CRITICAL),
  };
  return { temperatura, asentamiento, aire, summary };
}

module.exports = {
  TEMP_HORMIGON_MIN_C,
  TEMP_HORMIGON_MAX_C,
  TEMP_HORMIGON_TABLA_DIM,
  rangoTempPorDimension,
  TOL_ASENTAMIENTO_BAJO_MM,
  TOL_ASENTAMIENTO_ALTO_MM,
  UMBRAL_ASENTAMIENTO_TOL_MM,
  ASENTAMIENTO_MIN_VALIDO_MM,
  ASENTAMIENTO_MAX_VALIDO_MM,
  AIRE_INCORPORADO_TABLA,
  AIRE_TOLERANCIA_PCT,
  AIRE_REDUCCION_MAX_H35_PCT,
  TMN_FRACCION_37_5_MM,
  MAPEO_CLASES_LEGACY,
  CLASES_CONSISTENCIA_CIRSOC,
  SEVERIDADES,
  clasificarConsistencia,
  normalizarClaseExposicion,
  evaluarTemperaturaHormigon,
  evaluarAsentamiento,
  evaluarAire,
  evaluarMuestraFresco,
};
