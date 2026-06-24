'use strict';

/**
 * Motor de diseño HormiQual 1.0
 *
 * Motor unificado de dosificación de hormigón. Combina las mejores prácticas
 * de diseño racional de mezclas con tablas de referencia de diversas fuentes:
 *
 * - Agua base: tabla bidimensional asentamiento × MF × forma (Ábaco 1, fuente ICPA)
 * - Resistencia media: f'cm = f'ce + 1,65 × S (k=1,65 — aproximación conservadora
 *   histórica argentina que envuelve los dos criterios literales de CIRSOC
 *   200:2024 §6.2.3 — ver Step 1 para detalle y deuda técnica).
 * - Relación a/c: curvas de cemento por clase resistente (CP30/CP40/CP50)
 * - Verificación por durabilidad: clase exposición → a/c max, cemento min (CIRSOC 200:2024)
 * - Distribución de agregados: método de volúmenes absolutos
 *
 * Función pura: (inputs) => { resultado, trazabilidad, warnings }
 * trazabilidad incluye fuentesCalculo (matriz de fuentes del cálculo).
 *
 * Nota importante (CIRSOC 200:2024 §6.2.3 / IRAM 1666:2020 §A.7.10):
 * el "resultado de ensayo" sobre el que se aplican los criterios de aceptación
 * NO es cada probeta individual sino el PROMEDIO de las probetas hermanas
 * ensayadas a una misma edad. El f'cm que calcula este motor es el objetivo
 * de ese promedio. Los criterios de aceptación viven en la cadena de control
 * de calidad (no en el diseño de la mezcla).
 *
 * Referencias bibliográficas:
 * - ICPA: Diseño racional de mezclas de hormigón (tablas de agua base)
 * - ACI Committee 211.1-91: Standard Practice for Selecting Proportions (correcciones por TMN)
 * - CIRSOC 200:2024 §6.2.3: aceptación de la resistencia + cálculo de f'cm
 * - IRAM 1666:2020 §A.7.10: definición de "resultado de ensayo" = promedio de hermanas
 * - IRAM 1627: Agregados — Granulometría (bandas granulométricas)
 */

const { estimarAC, estimarACdesdeCurvaCemento } = require('./dosificacionCalcEngine');
const { pushFuente, ORIGEN_TIPO, CRITICIDAD } = require('./fuentesHelper');
const { consolidarPorProducto, detectarDuplicados } = require('./consolidarAditivos');

/**
 * Identidad UNIFICADA del motor de dosificación HormiQual (sesión 2026-05-18).
 * Una sola marca/versión user-facing para toda la suite (antes había
 * "HormiQual-1.0.0", "HRDC-1.0", "ACI211-v1.2.0" — diluía la identidad).
 * El MODELO de cálculo (CIRSOC / RDC-HRDC / ACI-legacy) es un descriptor
 * aparte (`modeloCalculoLabel`), nunca el nombre del motor.
 *
 * v2.0 = corte de unificación de identidad. El CÁLCULO de v2.0 es idéntico
 * al de HormiQual-1.0.0: el bump es de esquema de identidad, NO de
 * metodología. Forward-only: snapshots viejos conservan su versión original
 * (trazabilidad de auditoría / hashIntegridad).
 *
 * Política de versionado: bump si con los MISMOS inputs el motor produciría
 * números distintos, o si cambia la base normativa/metodológica
 * (MAYOR: nueva norma/modelo; MENOR: fórmula/coef./tabla que altera salidas;
 * PATCH: fix que corrige salidas o nuevos campos informativos). NO se
 * versiona por PDF/branding/UI. Ver docs/decisiones_arquitectura.md.
 */
const MOTOR_VERSION = 'HormiQual v2.0';
const MODELO_CALCULO_LABEL = 'CIRSOC 200:2024 (prescriptivo)';

/** Format a number with comma as decimal separator (Argentine locale) for user-facing strings. */
const fmtDec = (v, dec = 2) =>
  v != null ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—';

/** Umbrales de absorción atípica (configurables). */
const ABSORCION_UMBRAL_FINO   = 2.5; // % — por encima se advierte
const ABSORCION_UMBRAL_GRUESO = 2.0; // %

/** Labels legibles para unidades de dosificación de aditivos. */
const UNIDAD_DOSIS_LABELS = {
  PORC_SOBRE_CEMENTO:  '% sobre cemento',
  ML_POR_100KG_CEMENTO: 'mL/100 kg cemento',
  KG_M3:               'kg/m³',
};

const FORMA_LABELS = { TRITURADO: 'Triturado', CANTO_RODADO: 'Canto rodado', MIXTO: 'Mixto', NO_DEFINIDO: 'No definido' };
const formaLabel = (f) => FORMA_LABELS[f] || f;

const MODO_EFECTO_LABELS = {
  AHORRO_AGUA: 'Ahorro de agua', AUMENTO_ASENTAMIENTO: 'Aumento de asentamiento',
  RETARDANTE: 'Retardante de fraguado', ACELERANTE_FRAGUE: 'Acelerante de fraguado',
  ACELERANTE_ENDURECIMIENTO: 'Acelerante de endurecimiento', INCORPORADOR_AIRE: 'Incorporador de aire',
  ESPUMIGENO: 'Espumígeno',
  ANTICONGELANTE: 'Anticongelante', REDUCTOR_RETRACCION: 'Reductor de retracción',
  EXPANSIVO: 'Expansivo / Compensador de retracción', INHIBIDOR_CORROSION: 'Inhibidor de corrosión',
  VISCOSANTE: 'Modificador de viscosidad (VMA)', IMPERMEABILIZANTE: 'Impermeabilizante',
  FIBRAS: 'Refuerzo con fibras', OTRO: 'Otro',
};
const modoEfectoLabel = (m) => MODO_EFECTO_LABELS[m] || m || '—';
const EFECTOS_CON_CALCULO = new Set(['AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO']);

const UNIDAD_DOSIS_LABELS_BE = {
  PORC_SOBRE_CEMENTO:  '% sobre cemento',
  ML_POR_100KG_CEMENTO: 'mL/100 kg cemento',
  KG_M3:               'kg/m³',
};
const unidadDosisLabel = (u) => UNIDAD_DOSIS_LABELS_BE[u] || u || '';

/** Build additive display name avoiding duplicated substrings between marca and funcion. */
const buildAditivoNombre = (ad) => {
  if (!ad) return null;
  const marca = (ad.marca || '').trim();
  const funcion = (ad.funcion || '').trim();
  if (!marca && !funcion) return null;
  if (!funcion) return marca;
  if (!marca) return funcion;
  const lm = marca.toLowerCase(), lf = funcion.toLowerCase();
  if (lm.includes(lf) || lf.includes(lm)) return marca.length >= funcion.length ? marca : funcion;
  return `${marca} ${funcion}`;
};

// Labels del método de interpolación sobre la tabla de agua base.
// Los códigos ICPA_BASE_* describen el método de cálculo, no la fuente de los
// valores: la tabla puede tener valores ICPA originales, ajustados, o propios
// del usuario. La fuente, cuando aplica, se reporta por separado.
const AGUA_METODO_LABELS = {
  ICPA_BASE_DIRECTO:                    'Lectura directa de la tabla',
  ICPA_BASE_INTERPOLACION_MF:           'Interpolación por módulo de finura',
  ICPA_BASE_INTERPOLACION_ASENTAMIENTO: 'Interpolación por asentamiento',
  ICPA_BASE_INTERPOLACION_BILINEAL:     'Interpolación bilineal (MF + asentamiento)',
};
const aguaMetodoLabel = (m) => AGUA_METODO_LABELS[m] || m;

const AC_METODO_LABELS = {
  ICPA_BASE_DIRECTO:            'Lectura directa',
  ICPA_BASE_INTERPOLACION_MF:   'Interpolación por MF',
  ICPA_BASE_INTERPOLACION_ASENTAMIENTO: 'Interpolación por asentamiento',
  ICPA_BASE_INTERPOLACION_BILINEAL: 'Interpolación bilineal (MF + asentamiento)',
  TABLA_DIRECTO:                'Lectura directa de tabla',
  TABLA_INTERPOLACION:          'Interpolación de tabla',
  TABLA_EXTRAPOLACION:          'Extrapolación de tabla',
  INTERPOLACION:                'Interpolación',
  DIRECTO:                      'Lectura directa',
};
const acMetodoLabel = (m) => AC_METODO_LABELS[m] || m;

/* ════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════ */

function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Calculates a dose-based factor for admixture effects.
 * Model: 0% below min → 30% at min → 100% at recommended → 140% at max → 140% cap.
 *
 * @param {number} dosisUsada - Actual dose used
 * @param {number} dosisMin - Minimum dose from catalog
 * @param {number} dosisRec - Recommended (habitual) dose from catalog
 * @param {number} dosisMax - Maximum dose from catalog
 * @returns {{ factor: number, advertencia: object|null }}
 */
function calcularFactorDosis(dosisUsada, dosisMin, dosisRec, dosisMax) {
  if (!dosisMin || !dosisRec || !dosisMax || dosisRec <= 0) {
    return { factor: 1.0, advertencia: null }; // no dose data → assume 100%
  }

  if (dosisUsada < dosisMin) {
    return {
      factor: 0,
      advertencia: {
        nivel: 'critica',
        mensaje: `La dosis ${dosisUsada}% es inferior a la mínima (${dosisMin}%). Sin efecto.`,
      },
    };
  }

  if (dosisUsada <= dosisRec) {
    const t = (dosisUsada - dosisMin) / (dosisRec - dosisMin);
    const factor = 0.30 + t * (1.00 - 0.30);
    const advertencia = dosisUsada < dosisRec ? {
      nivel: 'informativo',
      mensaje: `Dosis ${dosisUsada}% inferior a la recomendada (${dosisRec}%). Efecto al ${Math.round(factor * 100)}%.`,
    } : null;
    return { factor, advertencia };
  }

  if (dosisUsada <= dosisMax) {
    const t = (dosisUsada - dosisRec) / (dosisMax - dosisRec);
    const factor = 1.00 + t * (1.40 - 1.00);
    return { factor, advertencia: null };
  }

  // Above max → cap at 140%
  return {
    factor: 1.40,
    advertencia: {
      nivel: 'advertencia',
      mensaje: `La dosis ${dosisUsada}% supera la máxima (${dosisMax}%). Efecto limitado al 140%.`,
    },
  };
}

/**
 * Estima agua base desde el Ábaco 1 ICPA.
 * Cada forma del agregado tiene su propia tabla ancla completa:
 *   - CANTO_RODADO: valores base del Ábaco 1.
 *   - TRITURADO:    base × 1.10 (redondeado a entero).
 *   - MIXTO:        base × 1.05 (redondeado a entero).
 * La corrección por TMN se aplica separadamente (CorrectoresICPA).
 *
 * Dominio válido: asentamiento 4–20 cm, MF 3.0–6.5.
 * Interpolación: bilineal en (asentamiento, MF) para valores intermedios.
 *
 * @param {Array}  abacoCurvas    - Filas de AbacoCurvaICPA (activas, todas las formas)
 * @param {number} asentamientoCm - Asentamiento objetivo en cm
 * @param {number} moduloFinura   - Módulo de finura total de la arena
 * @param {string} formaAgregado  - 'CANTO_RODADO' | 'TRITURADO' | 'MIXTO'
 * @returns {{ aguaLtsM3, metodo, asentamientoCm, moduloFinura, formaAgregado, error? }}
 */
function estimarAguaBaseReferencia(abacoCurvas, asentamientoCm, moduloFinura, formaAgregado) {
  const asCm = Number(asentamientoCm);
  const mf   = Number(moduloFinura);
  const forma = formaAgregado || 'CANTO_RODADO';

  // ── Validate domain ──────────────────────────────────────────────────────────
  if (asCm < 4 || asCm > 20) {
    return {
      aguaLtsM3: null,
      metodo: 'FUERA_DOMINIO',
      error: `Asentamiento ${asCm} cm fuera del dominio válido del Ábaco 1 (4–20 cm). No se extrapola.`,
    };
  }
  if (mf < 3.0 || mf > 6.5) {
    return {
      aguaLtsM3: null,
      metodo: 'FUERA_DOMINIO',
      error: `Módulo de finura ${mf} fuera del dominio válido del Ábaco 1 (3.0–6.5). No se extrapola.`,
    };
  }

  if (!abacoCurvas || abacoCurvas.length === 0) {
    return {
      aguaLtsM3: null,
      metodo: 'SIN_DATOS',
      error: 'No hay datos del Ábaco 1 cargados en la base. Ejecute la migración 20260312.',
    };
  }

  // ── Filter by formaAgregado ───────────────────────────────────────────────────
  const curvasFiltradas = abacoCurvas.filter(c => c.formaAgregado === forma);
  if (curvasFiltradas.length === 0) {
    return {
      aguaLtsM3: null,
      metodo: 'SIN_DATOS_FORMA',
      error: `No hay datos del Ábaco 1 para forma "${forma}". Ejecute la migración 20260313.`,
    };
  }

  // ── Find bounding anchors ────────────────────────────────────────────────────
  const asLow  = Math.floor(asCm);   // integer asentamiento ≤ asCm
  const asHigh = Math.ceil(asCm);    // integer asentamiento ≥ asCm

  const allMFs = [...new Set(curvasFiltradas.map(c => Number(c.moduloFinura)))].sort((a, b) => a - b);
  let mfLow = null, mfHigh = null;
  for (const m of allMFs) {
    if (m <= mf + 1e-9) mfLow = m;
    if (m >= mf - 1e-9 && mfHigh === null) mfHigh = m;
  }

  if (mfLow === null || mfHigh === null) {
    return {
      aguaLtsM3: null,
      metodo: 'SIN_ANCLA_MF',
      error: `No se encontraron anclas de MF que encuadren el valor ${mf} en la tabla cargada.`,
    };
  }

  // ── Lookup helper (searches only within the filtered forma) ──────────────────
  const getWater = (asInt, mfAnchor) => {
    const row = curvasFiltradas.find(c =>
      Number(c.asentamientoCm) === asInt &&
      Math.abs(Number(c.moduloFinura) - mfAnchor) < 0.01
    );
    return row ? Number(row.aguaBaseLM3) : null;
  };

  // ── Bilinear interpolation ───────────────────────────────────────────────────
  // Step 1: interpolate in MF at each integer asentamiento bound
  const w_asLow_mfLow  = getWater(asLow,  mfLow);
  const w_asLow_mfHigh = getWater(asLow,  mfHigh);
  const w_asHigh_mfLow = getWater(asHigh, mfLow);
  const w_asHigh_mfHigh= getWater(asHigh, mfHigh);

  if (w_asLow_mfLow === null || w_asLow_mfHigh === null ||
      w_asHigh_mfLow === null || w_asHigh_mfHigh === null) {
    return {
      aguaLtsM3: null,
      metodo: 'DATOS_INCOMPLETOS',
      error: `Faltan puntos ancla en la tabla para encuadrar (asentamiento=${asCm}cm, MF=${mf}). ` +
             `Esperados: as=${asLow}/${asHigh} cm, MF=${mfLow}/${mfHigh}.`,
    };
  }

  // Interpolate in MF at asLow and asHigh
  const wAtAsLow  = lerp(mf, mfLow, w_asLow_mfLow,  mfHigh, w_asLow_mfHigh);
  const wAtAsHigh = lerp(mf, mfLow, w_asHigh_mfLow, mfHigh, w_asHigh_mfHigh);

  // Interpolate in asentamiento
  const agua = lerp(asCm, asLow, wAtAsLow, asHigh, wAtAsHigh);
  const aguaRounded = Math.round(agua * 10) / 10;

  // Determine interpolation type for traceability
  const exactAs = (asLow === asHigh);
  const exactMF = Math.abs(mfLow - mfHigh) < 0.01;
  const metodo = exactAs && exactMF ? 'ICPA_BASE_DIRECTO'
    : exactAs                       ? 'ICPA_BASE_INTERPOLACION_MF'
    : exactMF                       ? 'ICPA_BASE_INTERPOLACION_ASENTAMIENTO'
    :                                 'ICPA_BASE_INTERPOLACION_BILINEAL';

  return {
    aguaLtsM3: aguaRounded,
    metodo,
    asentamientoCm: asCm,
    moduloFinura: mf,
    formaAgregado: forma,
    anclas: { asLow, asHigh, mfLow, mfHigh },
  };
}

/* ════════════════════════════════════════════
   Main ICPA calculation
   ════════════════════════════════════════════ */

/**
 * @param {object} params
 * @param {object} [params.context] - Display labels for fuentes:
 *   { cementoNombre, mezclaNombre, adicion1Nombre, adicion2Nombre,
 *     aditivo1Nombre, aditivo2Nombre, tmnSource, formaSource, mfSource }
 */
function calcularDosificacionHormiqual(params) {
  const warnings = [];
  const fuentesCalculo = [];
  const trazabilidad = {
    metodoCalculo: 'HORMIQUAL',
    motorVersion: MOTOR_VERSION,
    modeloCalculoLabel: MODELO_CALCULO_LABEL,
    inputs: { ...params, curvasAgua: undefined, curvasAC: undefined, aireEsperado: undefined, durabilidadExposicion: undefined, aireDurabilidad: undefined, pulverulentoMinimo: undefined },
  };
  trazabilidad.fuentesCalculo = fuentesCalculo;

  const {
    fce, desvioS, edadDias = 28, asentamientoMm, tmnMm,
    // Interpretación del f'ce ingresado para calcular f'cm:
    //   'ESPECIFICADO' (default) → f'ce = f'c contractual del pliego.
    //                              f'cm = f'ce + 1.65·S (CIRSOC 200:2024 §6.2.3).
    //   'OBJETIVO'                → f'ce = f'cm objetivo (sobrediseño ya aplicado
    //                              externamente por el calculista). f'cm = f'ce
    //                              y NO se le suma 1.65·S — el motor lo tomaría
    //                              dos veces y subdimensionaría el a/c.
    // Refactor 2026-05-27: antes el motor ignoraba este modo, lo que hacía que
    // OBJETIVO sobrediseñara dos veces. Validado con revisor-civil.
    modoFce = 'ESPECIFICADO',
    formaAgregado = 'TRITURADO',
    moduloFinura,
    exposicion,
    tipoHormigonEstructural = 'ARMADO',
    cemento, adicion1, adicion2,
    aditivo1, aditivo2, aditivo3,
    mezcla, curvasAgua, curvasAC, aireEsperado, durabilidadExposicion,

    abacoCurvasReferencia = [],
    curvaCemento = null,
    curvaCementoOrigen = null,
    context: ctx = {},

    // ── IDA (Índice de Demanda de Agua) ────────────────────────────────────────
    idaPonderado   = 1.000,       // Promedio ponderado de IDA de los agregados
    idaDetalles    = [],          // Detalle por componente: { nombre, volumenLts, ida, aporte }

    // ── Factor de edad β(t) para diseños a edades ≠ 28 días ────────────────────
    factorEdad     = null,        // β(t) factor: f'c(t) = f'c(28) × β(t). If null, age curve lookup is direct.
    factoresEdadMap = null,       // Full map { edadDias: factor } for verification ages

    // ── CIRSOC 200:2024 Tabla 4.3 y 4.4 ─────────────────────────────────────────
    aireDurabilidad   = [],       // Array from AireDurabilidad table (Tabla 4.3)
    pulverulentoMinimo = [],      // Array from PulverulentoMinimo table (Tabla 4.4)

    // ── Restricciones opcionales del pliego / cliente ──────────────────────────
    modoCurvaAC = 'ICPA', // 'ICPA' = Ábaco 2 genérica, 'FABRICANTE' = curva específica del cemento
    // factorPrudencialCurva ELIMINADO — la desviación estándar S cubre el margen estadístico
    acMaxPliego    = null,        // a/c máxima exigida por pliego o cliente
    amcMaxPliego   = null,        // a/(mat. cem.) máxima exigida por pliego o cliente
    cementoMinPliego = null,      // Cemento mínimo (kg/m³) exigido por pliego o cliente
    acModo         = 'LIMITE',    // 'LIMITE' (cap) | 'FIJO' (fuerza valor exacto)

    // ── Logística de colocación ──────────────────────────────────────────────
    modoAsentamiento = 'EN_PLANTA', // 'EN_PLANTA' | 'EN_OBRA'
    metodoColocacion = 'CONVENCIONAL', // 'CONVENCIONAL' | 'BOMBEADO' — afecta excepción §4.1.3 (R4)
    tiempoViaje      = 30,
    tiempoDescarga   = 30,
    tiempoEspera     = 0,
    temperaturaAmbiente = 20,

    // ── CIRSOC 200:2024 Tabla 9.3 (hormigones con características particulares) ──
    hormigonParticular = null,
    espesorElementoMm = null,

    // ── Fibras (macro estructural / micro polimérica) ──
    fibras = null,
  } = params;

  // CIRSOC 200:2024 Sección 2.1: toda estructura con armadura debe declarar clase de exposición
  if ((tipoHormigonEstructural === 'ARMADO' || tipoHormigonEstructural === 'PRETENSADO') && !exposicion) {
    warnings.push({ campo: 'exposicion', msg: 'Clase de exposición no declarada para hormigón armado. CIRSOC 200:2024 requiere al menos clase A1. Las verificaciones de durabilidad no se aplicaron.', tipo: 'error' });
  }

  let airePct = params.airePct;
  const inputAireAtrapado = params.aireAtrapado;       // null = auto from TMN
  const inputAireIncorporado = params.aireIncorporado;  // extra entrained air

  // ── Fuentes: entradas del usuario ──────────────────────────────────────────
  pushFuente(fuentesCalculo, {
    parametro: 'M\u00e9todo de c\u00e1lculo',
    valor: 'Motor HormiQual v2.0',
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: 'Basado en el m\u00e9todo ICPA con adaptaciones propias (curvas de cemento, trabajabilidad Shilstone/Ken Day)',
    observacion: 'Los \u00e1bacos y par\u00e1metros se adaptan a los materiales y condiciones de cada usuario.',
  });
  pushFuente(fuentesCalculo, {
    parametro: "f'ce (resistencia especificada)",
    valor: fce != null ? `${fce} MPa` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresada por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Desvío estándar S',
    valor: desvioS != null ? `${desvioS} MPa` : '0 MPa (sin margen)',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresado por el usuario',
    observacion: desvioS == null ? 'S no definido; se usará S = 0 (sin margen estadístico)' : null,
    criticidad: desvioS == null ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Edad de ensayo',
    valor: edadDias != null ? `${edadDias} días` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresada por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Asentamiento objetivo',
    valor: asentamientoMm != null ? `${asentamientoMm} mm` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresado por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'TMN',
    valor: tmnMm != null ? `${tmnMm} mm` : '—',
    origenTipo: ctx.tmnSource === 'MEZCLA' ? ORIGEN_TIPO.MEZCLA : ORIGEN_TIPO.INPUT_USUARIO,
    origenRef: ctx.tmnSource === 'MEZCLA' ? (ctx.mezclaNombre || null) : null,
    regla: ctx.tmnSource === 'MEZCLA'
      ? 'Derivado automáticamente desde la mezcla seleccionada'
      : 'Ingresado manualmente por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Forma del agregado',
    valor: formaAgregado,
    origenTipo: ctx.formaSource === 'MEZCLA' ? ORIGEN_TIPO.MEZCLA : ORIGEN_TIPO.INPUT_USUARIO,
    origenRef: ctx.formaSource === 'MEZCLA' ? (ctx.mezclaNombre || null) : null,
    regla: ctx.formaSource === 'MEZCLA'
      ? 'Derivada de la clasificación de los agregados gruesos (ensayos granulométricos)'
      : 'Ingresada manualmente por el usuario',
  });
  if (exposicion && exposicion !== 'NO_APLICA') {
    pushFuente(fuentesCalculo, {
      parametro: 'Clase de exposición',
      valor: exposicion,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Ingresada por el usuario; determina requisitos de durabilidad',
    });
  }

  // ── Fuentes: condiciones de destino (checkboxes) ─────────────────────────────
  // Estos parámetros determinan los límites de aptitud de materiales.
  // Se registran explícitamente para trazabilidad y reconstrucción futura.
  const _tipoHE = (tipoHormigonEstructural || 'ARMADO').toUpperCase();
  pushFuente(fuentesCalculo, {
    parametro: 'Tipo de armadura',
    valor: _tipoHE === 'PRETENSADO' ? 'Pretensado' : _tipoHE === 'SIMPLE' ? 'Simple' : 'Armado',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresado por el usuario; determina límites de cloruros y requisitos de cemento mínimo',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Expuesto a desgaste superficial',
    valor: ctx.expuestoDesgaste ? 'Sí' : 'No',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: ctx.expuestoDesgaste
      ? 'Marcado por el usuario (o auto-configurado por tipología). Activa criterio estricto IRAM 1512 de suma nocivas <= 5,0%'
      : 'No marcado. Se aplica criterio estándar IRAM 1512 de suma nocivas <= 7,0%',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Aspecto superficial importante',
    valor: ctx.aspectoSuperficialImportante ? 'Sí' : 'No',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: ctx.aspectoSuperficialImportante
      ? 'Marcado por el usuario (o auto-configurado por tipología). Activa límite de carbonosas <= 0,5%'
      : 'No marcado. Se aplica límite estándar de carbonosas <= 1,0%',
  });
  if (ctx.tipologiaCodigo) {
    pushFuente(fuentesCalculo, {
      parametro: 'Tipología de hormigón',
      valor: ctx.tipologiaNombre || ctx.tipologiaCodigo,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Seleccionada por el usuario; puede pre-configurar condiciones de destino (desgaste, aspecto)',
    });
  }

  // ── Fuentes: materiales ─────────────────────────────────────────────────────
  if (mezcla) {
    pushFuente(fuentesCalculo, {
      parametro: 'Mezcla granulométrica',
      valor: mezcla.nombre || `Mezcla #${mezcla.idMezcla}`,
      origenTipo: ORIGEN_TIPO.MEZCLA,
      origenRef: mezcla.nombre || null,
      regla: 'Mezcla seleccionada como base para la distribución de agregados',
    });
  }

  const mfSource = ctx.mfSource || (moduloFinura ? 'MEZCLA' : null);
  const mfFallback = !moduloFinura;
  pushFuente(fuentesCalculo, {
    parametro: 'Módulo de finura (MF)',
    valor: moduloFinura != null ? moduloFinura : '2.80 (default)',
    origenTipo: mfFallback ? ORIGEN_TIPO.DEFAULT : (mfSource === 'MANUAL' ? ORIGEN_TIPO.INPUT_USUARIO : ORIGEN_TIPO.MEZCLA),
    origenRef: !mfFallback && mfSource !== 'MANUAL' ? (ctx.mezclaNombre || null) : null,
    regla: mfFallback
      ? null
      : mfSource === 'MANUAL'
        ? 'Ingresado manualmente por el usuario'
        : 'Tomado del cálculo granulométrico de la mezcla seleccionada',
    observacion: mfFallback ? 'MF no disponible; se usará valor por defecto 2.80' : null,
    criticidad: mfFallback ? CRITICIDAD.FALLBACK : CRITICIDAD.INFO,
  });

  const _cementoNombre = ctx.cementoNombre || cemento?.nombreComercial || (cemento ? `Cemento #${cemento.idCemento}` : null);
  if (cemento) {
    pushFuente(fuentesCalculo, {
      parametro: 'Cemento',
      valor: _cementoNombre,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _cementoNombre,
      regla: 'Cemento seleccionado por el usuario',
    });
    const _dens = cemento.densidadRelativa ? Number(cemento.densidadRelativa) : null;
    pushFuente(fuentesCalculo, {
      parametro: 'Densidad relativa del cemento',
      valor: _dens ?? 3.15,
      origenTipo: _dens ? ORIGEN_TIPO.MATERIAL_CEMENTO : ORIGEN_TIPO.DEFAULT,
      origenRef: _dens ? _cementoNombre : null,
      regla: _dens ? 'Tomada de la ficha técnica del cemento' : null,
      observacion: !_dens ? 'Se usó valor por defecto 3.15 (ficha técnica no disponible)' : null,
      criticidad: !_dens ? CRITICIDAD.FALLBACK : CRITICIDAD.INFO,
    });
  }

  if (adicion1?.reemplazoPct > 0) {
    const _n = ctx.adicion1Nombre || adicion1.nombre || 'Adición 1';
    pushFuente(fuentesCalculo, {
      parametro: 'Adición 1',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _n,
      regla: `Reemplazo parcial del cemento al ${adicion1.reemplazoPct} %`,
    });
  }
  if (adicion2?.reemplazoPct > 0) {
    const _n = ctx.adicion2Nombre || adicion2.nombre || 'Adición 2';
    pushFuente(fuentesCalculo, {
      parametro: 'Adición 2',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _n,
      regla: `Reemplazo parcial del cemento al ${adicion2.reemplazoPct} %`,
    });
  }
  if (aditivo1?.dosis) {
    const _n = ctx.aditivo1Nombre || buildAditivoNombre(aditivo1) || 'Aditivo 1';
    pushFuente(fuentesCalculo, {
      parametro: 'Aditivo 1',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
      origenRef: _n,
      regla: `Dosis: ${aditivo1.dosis} ${unidadDosisLabel(aditivo1.unidadDosificacion)} · Efecto: ${modoEfectoLabel(aditivo1.modoEfecto)}`,
    });
  }
  if (aditivo2?.dosis) {
    const _n = ctx.aditivo2Nombre || buildAditivoNombre(aditivo2) || 'Aditivo 2';
    pushFuente(fuentesCalculo, {
      parametro: 'Aditivo 2',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
      origenRef: _n,
      regla: `Dosis: ${aditivo2.dosis} ${unidadDosisLabel(aditivo2.unidadDosificacion)} · Efecto: ${modoEfectoLabel(aditivo2.modoEfecto)}`,
    });
  }

  // ── Validations ──────────────────────────────────────────────────────────────
  if (!fce || fce <= 0) warnings.push({ campo: 'fce', msg: "Resistencia especificada (f'ce) no definida", tipo: 'error' });
  if (!desvioS && desvioS !== 0) warnings.push({ campo: 'desvioS', msg: 'Desvío estándar S no definido; se usará S=0 (sin margen)', tipo: 'advertencia' });
  if (!asentamientoMm || asentamientoMm <= 0) warnings.push({ campo: 'asentamientoMm', msg: 'Asentamiento objetivo no definido', tipo: 'error' });
  if (!tmnMm || tmnMm <= 0) warnings.push({ campo: 'tmnMm', msg: 'TMN no definido', tipo: 'error' });
  if (!cemento) warnings.push({ campo: 'cemento', msg: 'Cemento no seleccionado', tipo: 'error' });
  if (!moduloFinura) warnings.push({ campo: 'moduloFinura', msg: 'Módulo de finura no disponible; se necesita para el método ACI 211.1 (Ábaco 1)', tipo: 'advertencia' });

  if (warnings.some(w => w.tipo === 'error')) {
    return { resultado: null, trazabilidad, warnings };
  }

  // ── Step 1: f'cm según modoFce ────────────────────────────────────────────
  //
  // CIRSOC 200:2024 §6.2.3 define el f'c como el VALOR CARACTERÍSTICO de la
  // resistencia (fractil del 10% inferior de la distribución de resultados de
  // ensayo). Para que el control de calidad cumpla con ese f'c, el productor
  // debe diseñar la mezcla apuntando a una f'cm mayor: f'cm cubre dos
  // criterios literales y simultáneos de aceptación (§6.2.3 inciso a y b):
  //   (a) promedio móvil de 3 resultados consecutivos ≥ f'c
  //   (b) ningún resultado individual menor a (f'c − 3,5) MPa  [si f'c ≤ 35]
  //                                          o 0,90·f'c       [si f'c > 35]
  // Resolviendo simultáneamente, los factores literales que aparecen son
  // 1,34 y 2,33 (sobre σ histórico con ≥ 30 ensayos consecutivos).
  //
  // HormiQual usa k = 1,65 como APROXIMACIÓN CONSERVADORA HISTÓRICA ARGENTINA
  // (heredada de CIRSOC 201:1982 / IRAM 1666:1986 y de la práctica habitual
  // pre-2005). 1,65 envuelve razonablemente ambos criterios para σ típicos
  // (3-5 MPa) y f'c ≤ 35 MPa. Para f'c altos o σ chicos el valor literal
  // (CIRSOC 200:2024 §6.2.3) podría exigir un poco más; queda como deuda
  // técnica permitir elegir entre {1,65 histórico, criterio literal §6.2.3,
  // margen tabulado para < 15 ensayos según ACI 318 tabla 6.3.1}.
  //
  // modoFce gobierna si HormiQual aplica el sobrediseño o asume que el
  // calculista lo aportó externamente:
  //   ESPECIFICADO  → f'cm = f'ce + 1,65·S  (f'ce = f'c del pliego)
  //   OBJETIVO      → f'cm = f'ce            (f'ce YA es la f'cm objetivo)
  // Sumarlo en OBJETIVO duplicaría el margen y subdimensionaría a/c.
  const S = desvioS != null ? Number(desvioS) : 0;
  const _modoFceNorm = modoFce === 'OBJETIVO' ? 'OBJETIVO' : 'ESPECIFICADO';
  const fcm = _modoFceNorm === 'OBJETIVO'
    ? Number(fce)
    : Number(fce) + 1.65 * S;
  trazabilidad.resistenciaMedia = {
    fce: Number(fce),
    desvioS: S,
    fcm: Math.round(fcm * 10) / 10,
    modoFce: _modoFceNorm,
    formula: _modoFceNorm === 'OBJETIVO'
      ? "f'cm = f'ce (modo OBJETIVO: sobrediseño ya aplicado por el calculista)"
      : "f'cm = f'ce + 1,65 × S (k=1,65 aproximación histórica argentina; CIRSOC 200:2024 §6.2.3)",
  };
  pushFuente(fuentesCalculo, {
    parametro: "f'cm (resistencia media requerida)",
    valor: `${Math.round(fcm * 10) / 10} MPa`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    origenRef: _modoFceNorm === 'OBJETIVO'
      ? 'OBJETIVO — f\'ce ingresado ya es f\'cm (CIRSOC 200:2024 §6.2.3 — la norma exige f\'cm pero no prescribe quién hace el cálculo)'
      : 'CIRSOC 200:2024 §6.2.3 — sobrediseño estadístico (k=1,65 aproximación conservadora histórica argentina, envuelve criterios literales §6.2.3 a y b para σ típicos)',
    regla: _modoFceNorm === 'OBJETIVO'
      ? `f'cm = f'ce = ${Math.round(fcm * 10) / 10} MPa (modo OBJETIVO — sobrediseño NO se aplica; el calculista lo aportó externamente)`
      : `f'cm = f'ce + 1,65 × S = ${fce} + 1,65 × ${S} = ${Math.round(fcm * 10) / 10} MPa`,
  });

  // ── Step 1b: Factor de edad β(t) — diseño a edades ≠ 28 días ──────────────
  // When designing at age t ≠ 28d with a known β(t), we compute the 28d-equivalent
  // f'cm so the a/c lookup uses 28d curves (always available).
  // f'cm_28_equiv = f'cm(t) / β(t)
  const beta = (factorEdad != null && Number(factorEdad) > 0 && edadDias !== 28)
    ? Number(factorEdad)
    : null;
  const fcm28Equiv = beta ? Math.round((fcm / beta) * 10) / 10 : fcm;
  const edadParaCurva = beta ? 28 : edadDias;

  if (beta) {
    trazabilidad.factorEdad = {
      edadDiseno: edadDias,
      beta,
      fcmEdadDiseno: Math.round(fcm * 10) / 10,
      fcm28Equiv,
      formula: `f'cm(28d equiv.) = f'cm(${edadDias}d) / β(${edadDias}) = ${Math.round(fcm * 10) / 10} / ${beta} = ${fcm28Equiv} MPa`,
    };
    pushFuente(fuentesCalculo, {
      parametro: `f'cm equivalente a 28 días`,
      valor: `${fcm28Equiv} MPa`,
      origenTipo: ORIGEN_TIPO.CALCULADO,
      origenRef: `Factor de edad β(${edadDias}d) = ${beta}`,
      regla: `f'cm(${edadDias}d) = ${Math.round(fcm * 10) / 10} MPa → f'cm(28d equiv.) = ${Math.round(fcm * 10) / 10} / ${beta} = ${fcm28Equiv} MPa`,
    });
  }

  // Build verification ages (expected resistances at other ages)
  if (factoresEdadMap && typeof factoresEdadMap === 'object') {
    const edadesVerificacion = [];
    for (const [edad, factor] of Object.entries(factoresEdadMap)) {
      const edadNum = Number(edad);
      if (edadNum > 0 && factor > 0) {
        const fcm28Base = beta ? fcm28Equiv : fcm;
        const resistenciaEsperada = Math.round(fcm28Base * Number(factor) * 10) / 10;
        edadesVerificacion.push({
          edadDias: edadNum,
          factor: Number(factor),
          resistenciaEsperada,
          esEdadDiseno: edadNum === edadDias,
        });
      }
    }
    edadesVerificacion.sort((a, b) => a.edadDias - b.edadDias);
    trazabilidad.edadesVerificacion = edadesVerificacion;
  }

  // ── Step 2: Aire base (atrapado) ──────────────────────────────────────────────
  let aireAtrapado;
  if (inputAireAtrapado != null && inputAireAtrapado !== '') {
    // User provided explicit trapped air value
    aireAtrapado = Number(inputAireAtrapado);
    trazabilidad.aireBase = { fuente: 'usuario', airePct: aireAtrapado };
    pushFuente(fuentesCalculo, {
      parametro: 'Aire atrapado',
      valor: `${aireAtrapado} %`,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Ingresado manualmente por el usuario',
    });
  } else if (airePct != null && airePct !== '') {
    // Legacy: total airePct provided (backward compat)
    aireAtrapado = Number(airePct);
    trazabilidad.aireBase = { fuente: 'usuario', airePct: aireAtrapado };
    pushFuente(fuentesCalculo, {
      parametro: 'Aire atrapado',
      valor: `${aireAtrapado} %`,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Ingresado manualmente por el usuario (valor total)',
    });
  } else {
    // Auto from TMN table
    const aireRow = (aireEsperado || []).find(a => Math.abs(Number(a.tmnMm) - tmnMm) < 1);
    if (aireRow) {
      aireAtrapado = Number(aireRow.aireBasePct);
      trazabilidad.aireBase = { fuente: 'tabla', tmnMm, airePct: aireAtrapado, fila: aireRow };
      pushFuente(fuentesCalculo, {
        parametro: 'Aire atrapado',
        valor: `${aireAtrapado} %`,
        origenTipo: ORIGEN_TIPO.TABLA,
        origenRef: 'Tabla aire esperado por TMN',
        regla: `Selección directa por TMN ${tmnMm} mm`,
      });
    } else {
      aireAtrapado = 2.0;
      trazabilidad.aireBase = { fuente: 'default', airePct: 2.0 };
      pushFuente(fuentesCalculo, {
        parametro: 'Aire atrapado',
        valor: '2.0 %',
        origenTipo: ORIGEN_TIPO.DEFAULT,
        regla: `No se encontró fila de tabla para TMN ${tmnMm} mm`,
        observacion: 'Se usó valor por defecto 2.0 % (sin datos de tabla)',
        criticidad: CRITICIDAD.FALLBACK,
      });
      warnings.push({ campo: 'aire', msg: `No se encontró tabla de aire para TMN ${tmnMm}mm; se usó ${aireAtrapado}%`, tipo: 'advertencia' });
    }
  }

  // ── Aire incorporado (entrained) ──────────────────────────────────────────────
  const aireIntencional = params.aireIntencional === true;
  const aireIncorporado = aireIntencional && inputAireIncorporado ? Number(inputAireIncorporado) : 0;
  airePct = aireAtrapado + aireIncorporado;

  const tipoAire = aireIntencional ? 'INTENCIONAL' : 'NATURAL';
  trazabilidad.tipoAire = tipoAire;
  trazabilidad.aireAtrapado = aireAtrapado;
  trazabilidad.aireIncorporado = aireIncorporado;

  if (!aireIntencional) {
    pushFuente(fuentesCalculo, {
      parametro: 'Tipo de aire',
      valor: 'Naturalmente atrapado',
      origenTipo: ORIGEN_TIPO.REGLA,
      regla: 'No se indicó aire intencionalmente incorporado; se asume naturalmente atrapado.',
    });
  } else {
    pushFuente(fuentesCalculo, {
      parametro: 'Tipo de aire',
      valor: `Intencionalmente incorporado (+${aireIncorporado}%)`,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: `Aire atrapado ${aireAtrapado}% + incorporado ${aireIncorporado}% = total ${airePct}%. Correcciones por aire incorporado aplican.`,
      criticidad: CRITICIDAD.WARNING,
    });
    warnings.push({
      campo: 'aire',
      msg: `Aire intencionalmente incorporado: ${aireAtrapado}% atrapado + ${aireIncorporado}% incorporado = ${airePct}% total.`,
      tipo: 'advertencia',
    });
  }

  // ── Aire colateral de aditivos ──────────────────────────────────────────────
  // Superplastificantes y otros aditivos pueden incorporar aire como efecto
  // colateral. Se interpola proporcionalmente a la dosis usada vs dosis de
  // referencia (dosisHabitual o dosisMaxima).
  //
  // P1.2 — el aire colateral es una propiedad del PRODUCTO físico, no del
  // slot. Si el mismo producto está cargado en dos slots (ej: planta + obra),
  // el aporte se calcula UNA sola vez sobre la dosis total, no dos veces.
  let aireColateral = 0;
  const aireColateralDetalle = [];
  const aditivosConsolidados = consolidarPorProducto([aditivo1, aditivo2, aditivo3]);
  const duplicadosDetectados = detectarDuplicados([aditivo1, aditivo2, aditivo3]);
  for (const ad of aditivosConsolidados) {
    if (!ad.aireIncorporadoPctEsperado) continue;
    // Skip if this is an INCORPORADOR_AIRE handled via intentional air
    if (ad.modoEfecto === 'INCORPORADOR_AIRE') continue;
    // Skip espumígenos: el motor ICPA estándar no está calibrado para hormigones
    // livianos (HRDC). Un aireRef de 15–35% rompería el ajuste de a/c. El
    // tratamiento de espumígenos se hace en el motor HRDC dedicado.
    if (ad.modoEfecto === 'ESPUMIGENO' || ad.tipoFuncional === 'ESPUMIGENO') continue;

    const aireRef = Number(ad.aireIncorporadoPctEsperado);
    if (!aireRef || aireRef <= 0) continue;

    const dosisActual = Number(ad.dosisTotal) || 0;
    const dosisMin = Number(ad.dosisMinima) || 0;
    const dosisRec = Number(ad.dosisHabitual) || Number(ad.dosisMaxima) || dosisActual;
    const dosisMax = Number(ad.dosisMaxima) || dosisRec;
    if (dosisActual <= 0) continue;

    const { factor: factorDosisAire } = calcularFactorDosis(dosisActual, dosisMin, dosisRec, dosisMax);
    const aireColAd = Math.round(aireRef * factorDosisAire * 100) / 100;
    aireColateral += aireColAd;
    const nombre = buildAditivoNombre(ad) || 'Aditivo';
    aireColateralDetalle.push({
      nombre,
      aireRef,
      dosisActual,
      dosisRec,
      factorDosis: factorDosisAire,
      aireColateral: aireColAd,
      slotsContribuyentes: ad.slotsContribuyentes,
      consolidado: ad.esDuplicado,
    });
  }

  if (duplicadosDetectados.length > 0) {
    trazabilidad.aditivosDuplicados = duplicadosDetectados;
    duplicadosDetectados.forEach((d) => {
      // P1.2: la duplicación es admisible (ej: dosis dividida planta+obra),
      // pero queremos dejar traza explícita de que el motor consolidó las
      // dosis para el cálculo del aire colateral.
      warnings.push({
        campo: 'aditivo',
        tipo: 'info',
        msg: `${d.nombre} aparece en los slots ${d.slots.join(' y ')}. Para el cálculo de aire colateral se consolidó la dosis total (${d.dosisTotal}) una sola vez.`,
      });
    });
  }

  if (aireColateral > 0) {
    airePct += aireColateral;
    trazabilidad.aireColateral = aireColateral;
    trazabilidad.aireColateralDetalle = aireColateralDetalle;
    pushFuente(fuentesCalculo, {
      parametro: 'Aire colateral (aditivos)',
      valor: `+${aireColateral.toFixed(2)} %`,
      origenTipo: ORIGEN_TIPO.CALCULADO,
      regla: aireColateralDetalle.map(d =>
        `${d.nombre}: ${d.aireRef}% × factor ${Math.round(d.factorDosis * 100)}% (dosis ${d.dosisActual}%, rec. ${d.dosisRec}%) = ${d.aireColateral}%`
      ).join('; '),
    });
    warnings.push({
      campo: 'aire',
      msg: `Aire colateral de aditivos: +${aireColateral.toFixed(2)}% (${aireColateralDetalle.map(d => d.nombre).join(', ')}). Aire total ajustado a ${airePct.toFixed(2)}%.`,
      tipo: 'info',
    });
  } else {
    trazabilidad.aireColateral = 0;
    trazabilidad.aireColateralDetalle = [];
  }

  // ── Step 2b: Retención de asentamiento (back-calculation si modo EN_OBRA) ──
  let asentamientoDisenoMm = asentamientoMm;
  let logisticaCalc = null;

  if (modoAsentamiento === 'EN_OBRA' && asentamientoMm > 0) {
    try {
      // Nota: `asentamientoDisenoMm` que sale de acá proviene del modelo
      // empírico HormiQual de retención de asentamiento (NO normativo, ver
      // header de `retencionAsentamientoEngine.js`). Se usa como guía
      // operativa de despacho; no es veredicto de cumplimiento normativo.
      const { calcularRetencionAsentamiento } = require('./retencionAsentamientoEngine');
      // Extraer info del aditivo principal para estimar retención
      const aditivoInfo = aditivo1 ? { descripcion: aditivo1.descripcion || aditivo1.nombre || '' } : null;
      const retardanteInfo = aditivo2?.modoEfecto === 'retardante' ? { descripcion: aditivo2.descripcion || aditivo2.nombre || '' } : null;
      const dosisRel = aditivo1?.dosis && aditivo1?.dosisRecomendada ? aditivo1.dosis / aditivo1.dosisRecomendada : 1.0;

      logisticaCalc = calcularRetencionAsentamiento({
        modoAsentamiento: 'EN_OBRA',
        asentamientoObra: asentamientoMm / 10,  // cm
        tiempoViaje,
        tiempoDescarga,
        tiempoEspera,
        temperatura: temperaturaAmbiente,
        aditivoPrincipal: aditivoInfo,
        dosisRelativa: dosisRel,
        retardante: retardanteInfo,
        dosisRetardanteRel: 1.0,
        cementoKg: 320, // estimación inicial, se refina después
        ac: 0.45,       // estimación inicial
      });

      // Usar el asentamiento de despacho (planta) para el cálculo de agua
      asentamientoDisenoMm = logisticaCalc.asentamientoPlanta * 10;

      trazabilidad.logistica = logisticaCalc;
      pushFuente(fuentesCalculo, {
        parametro: 'Asentamiento de despacho',
        valor: `${logisticaCalc.asentamientoPlanta} cm (obra: ${logisticaCalc.asentamientoObra} cm)`,
        origenTipo: ORIGEN_TIPO.CALCULADO,
        origenRef: 'Motor de retención HormiQual',
        regla: `Pérdida estimada: ${logisticaCalc.perdida.perdidaCm} cm en ${logisticaCalc.tiempoTotal} min`,
      });

      warnings.push({
        campo: 'logistica',
        msg: `Modo "Asentamiento en obra": objetivo ${asentamientoMm / 10} cm en obra. Despacho calculado: ${logisticaCalc.asentamientoPlanta} cm (pérdida ${logisticaCalc.perdida.perdidaCm} cm en ${logisticaCalc.tiempoTotal} min).`,
        tipo: 'info',
      });

      // Agregar alertas de logística
      for (const al of logisticaCalc.alertas || []) {
        warnings.push({ campo: 'logistica', msg: al.mensaje, tipo: al.nivel === 'critico' ? 'error' : al.nivel === 'alto' ? 'warn' : 'info' });
      }
    } catch (e) {
      warnings.push({ campo: 'logistica', msg: `Error calculando retención: ${e.message}`, tipo: 'warn' });
    }
  }

  // ── Step 3: Agua base (Ábaco 1 ICPA — f(asentamiento, MF, forma)) ────────────
  // Cada forma tiene su tabla ancla completa:
  //   CANTO_RODADO = base · TRITURADO = base×1.10 · MIXTO = base×1.05
  // La corrección por TMN se aplica adicionalmente desde CorrectoresICPA.
  const mf = moduloFinura ? Number(moduloFinura) : 2.80;
  const asentamientoCm = asentamientoDisenoMm / 10;
  const aguaBaseResult = estimarAguaBaseReferencia(abacoCurvasReferencia, asentamientoCm, mf, formaAgregado);
  trazabilidad.aguaBase = aguaBaseResult;

  if (!aguaBaseResult.aguaLtsM3) {
    warnings.push({ campo: 'agua', msg: aguaBaseResult.error || 'No se pudo estimar agua base ICPA', tipo: 'error' });
    return { resultado: null, trazabilidad, warnings };
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Agua base (Ábaco 1)',
    valor: `${aguaBaseResult.aguaLtsM3} L/m³`,
    origenTipo: ORIGEN_TIPO.CURVA,
    origenRef: `Ábaco 1 v2 — ${formaLabel(formaAgregado)}`,
    regla: `${aguaMetodoLabel(aguaBaseResult.metodo)} · MF ${mf} · Asentamiento ${asentamientoCm} cm · Forma: ${formaLabel(formaAgregado)}`,
  });

  let aguaFinal = aguaBaseResult.aguaLtsM3;

  // ── Correctores ICPA ─────────────────────────────────────────────────────────
  // Forma y TMN ya NO se corrigen aquí:
  //   · Forma: integrada en AbacoCurvaICPA (tres tablas: CANTO_RODADO / MIXTO / TRITURADO).
  //   · TMN:   los deltas TMN seeded en 20260311 eran estimaciones puntuales sin base
  //             metodológica generalizable; desactivados por migración 20260315.
  // El catálogo queda reservado para correcciones de aire incorporado (tipo AIRE)
  // cuando se implementen.
  trazabilidad.correctoresICPA = { aplicados: [] };
  trazabilidad.aguaBaseConCorrectores = aguaFinal;

  // ── Step 4: Corrección por aditivos (hasta 3) ────────────────────────────────
  // Efectos con cálculo: AHORRO_AGUA (reduce agua base) | AUMENTO_ASENTAMIENTO (trazado).
  // Efectos informativos: se trazan pero no modifican agua/asentamiento.
  trazabilidad.correccionAditivo = [];

  const aplicarEfectoAditivo = (aditivo, label, nombreCtx) => {
    if (!aditivo || !aditivo.dosis) return;

    // Informational effects: trace only, no water/asentamiento modification
    if (aditivo.modoEfecto && !EFECTOS_CON_CALCULO.has(aditivo.modoEfecto)) {
      const efLabel = modoEfectoLabel(aditivo.modoEfecto);
      trazabilidad.correccionAditivo.push({
        aditivo: label,
        modo: aditivo.modoEfecto,
        informativo: true,
        nota: `${efLabel} — efecto informativo, sin incidencia en el cálculo de agua`,
      });
      pushFuente(fuentesCalculo, {
        parametro: `Función — ${label}`,
        valor: efLabel,
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: nombreCtx || label,
        regla: 'Efecto informativo: no modifica agua ni asentamiento. Incluido en volumen y peso de la dosificación.',
      });
      return;
    }

    if (aditivo.modoEfecto === 'AHORRO_AGUA') {
      // Sólo se descuenta agua si el aditivo se incorpora en PLANTA.
      // Aditivos agregados en OBRA no pueden reclamar efecto reductor de agua.
      if (aditivo.etapa === 'OBRA') {
        warnings.push({
          campo: 'aditivo', tipo: 'advertencia',
          msg: `${label}: efecto AHORRO_AGUA no aplica para aditivos incorporados en obra. Cambiá la etapa a PLANTA o elegí otro efecto.`,
        });
        trazabilidad.correccionAditivo.push({ aditivo: label, modo: 'AHORRO_AGUA', etapa: 'OBRA', nota: 'No se aplicó reducción — aditivo en obra' });
        return;
      }
      if (!aditivo.reduccionAguaPctEsperada) {
        warnings.push({
          campo: 'aditivo',
          msg: `${label}: efecto AHORRO_AGUA seleccionado pero el aditivo no tiene reducción de agua esperada en su ficha técnica. No se aplicó corrección.`,
          tipo: 'advertencia',
        });
        trazabilidad.correccionAditivo.push({ aditivo: label, modo: 'AHORRO_AGUA', nota: 'Sin dato de reducción — sin efecto aplicado' });
        return;
      }
      const reduccionDeclarada = Number(aditivo.reduccionAguaPctEsperada);
      const dosisUsada = Number(aditivo.dosis) || 0;
      const dosisMin = Number(aditivo.dosisMinima) || 0;
      const dosisRec = Number(aditivo.dosisHabitual) || Number(aditivo.dosisMaxima) || dosisUsada;
      const dosisMax = Number(aditivo.dosisMaxima) || dosisRec;

      const { factor: factorDosis, advertencia: advDosis } = calcularFactorDosis(dosisUsada, dosisMin, dosisRec, dosisMax);
      const reduccionReal = Math.round(reduccionDeclarada * factorDosis * 100) / 100;

      if (advDosis) {
        const severidad = advDosis.nivel === 'critica' ? 'advertencia' : 'info';
        warnings.push({ campo: 'aditivo', msg: `${label}: ${advDosis.mensaje}`, tipo: severidad });
      }

      const aguaAntes = aguaFinal;
      if (factorDosis > 0) {
        aguaFinal = aguaFinal * (1 - reduccionReal / 100);
      }
      const aguaDespues = Math.round(aguaFinal * 10) / 10;

      // Redondeo del factor — usar el MISMO valor en la trazabilidad y en el texto
      // de la regla para evitar inconsistencias de redondeo (82% vs 83%) entre secciones.
      const factorDosisRounded = Math.round(factorDosis * 1000) / 1000;
      const factorPctInt = Math.round(factorDosisRounded * 100);
      trazabilidad.correccionAditivo.push({
        aditivo: label,
        modo: 'AHORRO_AGUA',
        reduccionDeclarada,
        reduccionPct: reduccionReal,
        factorDosis: factorDosisRounded,
        dosisUsada, dosisMin, dosisRec, dosisMax,
        aguaAntes, aguaDespues,
      });
      pushFuente(fuentesCalculo, {
        parametro: `Corrección agua — ${label}`,
        valor: `${aguaAntes} → ${aguaDespues} L/m³`,
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: nombreCtx || label,
        regla: factorDosisRounded === 1.0
          ? `Reducción del ${reduccionReal}% por efecto de ahorro de agua (dosis recomendada)`
          : `Reducción declarada ${reduccionDeclarada}% × factor dosis ${factorPctInt}% = ${reduccionReal}% (dosis ${dosisUsada}%, rec. ${dosisRec}%)`,
      });

    } else if (aditivo.modoEfecto === 'AUMENTO_ASENTAMIENTO') {
      const incremento = aditivo.incrementoAsentamientoEsperado;
      if (!incremento) {
        warnings.push({
          campo: 'aditivo',
          msg: `${label}: efecto AUMENTO_ASENTAMIENTO seleccionado pero el aditivo no tiene incremento de asentamiento esperado en su ficha técnica. Se trazó como efecto reológico informativo.`,
          tipo: 'info',
        });
      }
      const notaInc = incremento ? ` (${Number(incremento)} mm estimado)` : '';
      trazabilidad.correccionAditivo.push({
        aditivo: label,
        modo: 'AUMENTO_ASENTAMIENTO',
        nota: `Agua sin cambio; el aditivo mejora trabajabilidad${notaInc}`,
        incrementoAsentamientoMm: incremento ? Number(incremento) : null,
      });
      pushFuente(fuentesCalculo, {
        parametro: `Efecto reológico — ${label}`,
        valor: incremento ? `+${Number(incremento)} mm asentamiento estimado` : 'Mejora de trabajabilidad (sin dato de incremento)',
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: nombreCtx || label,
        regla: 'Efecto de aumento de asentamiento: el agua no se reduce; efecto reológico informativo',
      });
    }
  };

  aplicarEfectoAditivo(aditivo1, 'Aditivo 1', ctx.aditivo1Nombre);
  aplicarEfectoAditivo(aditivo2, 'Aditivo 2', ctx.aditivo2Nombre);
  aplicarEfectoAditivo(aditivo3, 'Aditivo 3', ctx.aditivo3Nombre);

  // ── Corrección por IDA ponderado ──────────────────────────────────────────
  const idaEfectivo = Number(idaPonderado) || 1.000;
  const aguaAntesIDA = Math.round(aguaFinal * 10) / 10;
  if (Math.abs(idaEfectivo - 1.000) > 0.0005) {
    aguaFinal = aguaFinal * idaEfectivo;
  }
  trazabilidad.ida = {
    idaPonderado: idaEfectivo,
    detalles: idaDetalles,
    aguaAntesIDA,
    aguaDespuesIDA: Math.round(aguaFinal * 10) / 10,
    aplicado: Math.abs(idaEfectivo - 1.000) > 0.0005,
  };
  if (Math.abs(idaEfectivo - 1.000) > 0.0005) {
    pushFuente(fuentesCalculo, {
      parametro: 'IDA ponderado',
      valor: `${idaEfectivo.toFixed(3)} → agua ${aguaAntesIDA} × ${idaEfectivo.toFixed(3)} = ${Math.round(aguaFinal * 10) / 10} L/m³`,
      origenTipo: ORIGEN_TIPO.CALCULADO,
      origenRef: 'Índice de Demanda de Agua (promedio ponderado por volumen)',
      regla: 'Multiplica el agua pre-IDA por el IDA ponderado de los agregados de la mezcla',
    });
  }

  aguaFinal = Math.round(aguaFinal * 10) / 10;
  trazabilidad.aguaFinal = aguaFinal;
  pushFuente(fuentesCalculo, {
    parametro: 'Agua final',
    valor: `${aguaFinal} L/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: trazabilidad.correccionAditivo.length > 0 && trazabilidad.ida.aplicado
      ? 'Agua base corregida por efecto de aditivos e índice de demanda de agua ponderado'
      : trazabilidad.correccionAditivo.length > 0
      ? 'Agua base corregida por efecto de aditivos'
      : trazabilidad.ida.aplicado
      ? 'Agua base corregida por índice de demanda de agua ponderado'
      : 'Igual al agua base (sin correcciones)',
  });

  // ── Step 5: Relación a/c (by f'cm) ───────────────────────────────────────────
  // Factor prudencial ELIMINADO del motor — la desviación estándar S
  // ya incorpora el margen estadístico necesario (f'cm = f'ce + k*S).
  // Se mantiene fcmParaCurva = fcm28Equiv sin multiplicar por ningún factor.
  const fcmParaCurva = Math.round(fcm28Equiv * 10) / 10;

  let acResult = null;
  let acOrigenTipo = ORIGEN_TIPO.CURVA;
  let acOrigenRef = null;
  let acOrigenObs = null;
  // Declared in outer scope so it's available when building trazabilidad.relacionAC below
  let fcmAjustado;

  // ── Correcciones ICPA Ábaco 2 para curvas genéricas ──
  //
  // Las curvas a/c-resistencia del Ábaco 2 ICPA están calibradas para
  // CANTO RODADO sin aire incorporado. Para usar el mismo ábaco con otros
  // agregados o con aire, se "regresa" el f'cm objetivo a un f'cm
  // equivalente canto rodado, dividiendo por el factor correspondiente:
  //
  //   - Piedra partida / triturado:  f'cm / 1,20  (resistencias +20% vs canto rodado).
  //   - Mixto:                       f'cm / 1,10  (resistencias +10% vs canto rodado).
  //   - Aire incorporado A% > 1:     f'cm / (1 - 0,05 · (A% - 1))  (-5% por
  //                                  cada punto porcentual sobre 1%).
  //
  // Fuente: Manual ICPA "Diseño racional de mezclas de hormigón" (Instituto
  // del Cemento Portland Argentino) — sección "Corrección por forma del
  // agregado y por aire incorporado" del Ábaco 2. NO es CIRSOC ni IRAM: es
  // convención metodológica del diseño racional argentino, ampliamente
  // usada en práctica pero no obligatoria. El usuario puede sobrescribirla
  // vía `params.factorAjusteICPA`.
  let fcmParaCurvaCorregido = fcmParaCurva;
  let correccionesICPA = [];
  // Correcciones ICPA siempre se aplican (curvas ICPA son para canto rodado sin aire)
  {
    // Corrección por forma del agregado (piedra partida +20%)
    if (formaAgregado === 'TRITURADO' || formaAgregado === 'PIEDRA_PARTIDA') {
      fcmParaCurvaCorregido = Math.round(fcmParaCurvaCorregido / 1.20 * 10) / 10;
      correccionesICPA.push(`Piedra partida: fcm corregido / 1,20 (resistencias +20%)`);
    } else if (formaAgregado === 'MIXTO') {
      fcmParaCurvaCorregido = Math.round(fcmParaCurvaCorregido / 1.10 * 10) / 10;
      correccionesICPA.push(`Agregado mixto: fcm corregido / 1,10 (resistencias +10%)`);
    }

    // Corrección por aire incorporado (-5% por cada (A%-1))
    const aireInc = Number(aireIncorporado) || 0;
    if (aireInc > 1) {
      const factorAire = 1 - 0.05 * (aireInc - 1);
      if (factorAire > 0 && factorAire < 1) {
        fcmParaCurvaCorregido = Math.round(fcmParaCurvaCorregido / factorAire * 10) / 10;
        correccionesICPA.push(`Aire incorporado ${aireInc}%: fcm corregido / ${factorAire.toFixed(2)} (-5% por cada % sobre 1%)`);
      }
    }
  }

  // ── Determinación de a/c según modoCurvaAC ──
  // Los 3 modos comparten un único path: leer una CurvaCemento (puntos a/c vs resistencia)
  // y aplicar el factor de ajuste del pivote CementoPlanta.
  //   "ICPA"       = Curva genérica ICPA Ábaco 2 por familia (CP30/CP40/CP50).
  //   "FABRICANTE" = Curva publicada por el fabricante del cemento.
  //   "PROPIA"     = Curva calibrada por el usuario (ensayos / experiencia propia).
  // El factor (CementoPlanta.factorAjuste) divide al f'cm antes de buscar a/c en la curva,
  // y aplica a los 3 modos por igual (default 1.000 = sin efecto).
  const familiaCemento = cemento?.familiaCemento || cemento?.claseResistente || cemento?.composicion || null;
  const factorEfectivo = Number(params.factorAjusteICPA) || 1.0;

  fcmAjustado = fcmParaCurvaCorregido;
  if (factorEfectivo !== 1.0 && factorEfectivo > 0) {
    fcmAjustado = Math.round(fcmParaCurvaCorregido / factorEfectivo * 10) / 10;
    correccionesICPA.push(`Factor ajuste planta: ${factorEfectivo.toFixed(3)} (fcm corregido: ${fcmParaCurvaCorregido} → ${fcmAjustado} MPa)`);
  }

  if (curvaCemento) {
    acResult = estimarACdesdeCurvaCemento(curvaCemento, fcmAjustado, edadParaCurva);
    acOrigenTipo = ORIGEN_TIPO.CURVA_CEMENTO;
    const origenCurva = curvaCemento.origenCurva
      || (modoCurvaAC === 'PROPIA' ? 'PROPIA' : modoCurvaAC === 'FABRICANTE' ? 'FABRICANTE' : 'ICPA');
    if (origenCurva === 'ICPA') {
      // origenCurva === 'ICPA' es el token interno legacy de la curva genérica de
      // referencia; el texto visible usa "Referencia general" (la marca no se expone).
      acOrigenRef = familiaCemento
        ? `Referencia general - ${familiaCemento}`
        : `Referencia general (${curvaCemento.nombre})`;
      acOrigenObs = `Curva de referencia general (${curvaCemento.nombre}). Válida para canto rodado.`;
    } else if (origenCurva === 'PROPIA') {
      acOrigenRef = `Curva propia: ${curvaCemento.nombre}`;
      acOrigenObs = `Curva propia (${curvaCemento.nombre}). Calibrada con ensayos del usuario.`;
    } else {
      acOrigenRef = `Curva del fabricante: ${curvaCemento.nombre}`;
      acOrigenObs = `Curva del fabricante (${curvaCemento.nombre}). Considerar que pueden ser optimistas frente a condiciones reales de planta.`;
    }
    if (correccionesICPA.length > 0) {
      acOrigenObs += ` Correcciones: ${correccionesICPA.join('; ')}.`;
    }
    trazabilidad.curvaCementoUsada = {
      id: curvaCemento.id, nombre: curvaCemento.nombre,
      origen: curvaCementoOrigen, origenCurva,
      nota: acOrigenObs,
    };
  } else {
    // Fallback legacy: tenants sin la migración a CurvaCemento aplicada todavía.
    acResult = estimarAC(curvasAC, fcmAjustado, edadParaCurva, familiaCemento);
    acOrigenTipo = ORIGEN_TIPO.CURVA;
    acOrigenRef = familiaCemento
      ? `ICPA Ábaco 2 - ${familiaCemento} (legacy)`
      : 'ICPA Ábaco 2 (curva genérica, legacy)';

    if (!familiaCemento) {
      acOrigenObs = 'El cemento no tiene familia asignada (CP30/CP40/CP50). Se usó la curva genérica.';
    } else {
      acOrigenObs = `Curva ICPA \u00c1baco 2 para familia ${familiaCemento}. V\u00e1lido para canto rodado.`;
      if (correccionesICPA.length > 0) {
        acOrigenObs += ` Correcciones: ${correccionesICPA.join('; ')}.`;
      }
    }

  }

  trazabilidad.relacionAC = {
    ...acResult,
    fcmObjetivo: Math.round(fcm * 10) / 10,
    fcmParaCurva,
    fcmParaCurvaCorregido: correccionesICPA.length > 0 ? fcmParaCurvaCorregido : undefined,
    // fcmConFactorAjuste: value after applying familia/cemento factor (this is what's actually used for the curve lookup)
    fcmConFactorAjuste: (typeof fcmAjustado !== 'undefined' && fcmAjustado !== fcmParaCurvaCorregido) ? fcmAjustado : undefined,
    correccionesICPA: correccionesICPA.length > 0 ? correccionesICPA : undefined,
    factorAjusteAplicado: (typeof factorEfectivo !== 'undefined' && factorEfectivo !== 1.0) ? factorEfectivo : undefined,
  };

  if (!acResult.acEstimado) {
    warnings.push({ campo: 'ac', msg: acResult.error || 'No se pudo estimar a/c', tipo: 'error' });
    return { resultado: null, trazabilidad, warnings };
  }
  if (acResult.warning) {
    warnings.push({ campo: 'ac', msg: acResult.warning, tipo: 'advertencia' });
  }
  if (acOrigenObs && acOrigenTipo !== ORIGEN_TIPO.CURVA_CEMENTO) {
    warnings.push({ campo: 'curvaCemento', msg: acOrigenObs, tipo: 'info' });
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Curva de cemento (a/c)',
    valor: trazabilidad.curvaCementoUsada
      ? `${trazabilidad.curvaCementoUsada.nombre} — ${edadDias} días`
      : 'Tabla genérica a/c-resistencia',
    origenTipo: acOrigenTipo,
    origenRef: acOrigenRef,
    regla: trazabilidad.curvaCementoUsada
      ? trazabilidad.curvaCementoUsada.origenLabel
      : 'Fallback: sin curva de cemento cargada para el cemento seleccionado',
    observacion: acOrigenObs,
    criticidad: acOrigenObs ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
  });
  pushFuente(fuentesCalculo, {
    parametro: "a/c por resistencia (curva del cemento)",
    valor: acResult.acEstimado,
    origenTipo: acOrigenTipo,
    origenRef: acOrigenRef,
    // ROUND-FINAL 2: use the value actually fed into the curve (post ICPA factor correction),
    // not the raw fcmParaCurva, so trazabilidad resumida and detailed explanation agree.
    regla: (() => {
      const fcmEntrada = (typeof fcmAjustado !== 'undefined' && fcmAjustado !== fcmParaCurvaCorregido)
        ? fcmAjustado
        : (fcmParaCurvaCorregido !== fcmParaCurva ? fcmParaCurvaCorregido : fcmParaCurva);
      const factorNota = (typeof factorEfectivo !== 'undefined' && factorEfectivo !== 1.0)
        ? ` (f'cm requerido ${fcmParaCurva} MPa / factor ajuste planta-cemento ${factorEfectivo.toFixed(3)} = ${fcmEntrada} MPa)`
        : '';
      return `${acMetodoLabel(acResult.metodo)} - f'cm de entrada a la curva: ${fcmEntrada} MPa - edad ${edadDias} dias${factorNota}`;
    })(),
    observacion: acResult.warning || null,
    criticidad: acResult.warning ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
  });

  let acFinal = acResult.acEstimado;
  let acGobernante = 'RESISTENCIA'; // tracks which source governed the final a/c

  // ── Step 6: Verificación por durabilidad (CIRSOC 200:2024 Tabla 2.5) ───────────
  // Lookup por `codigo` normativo (A1, A2, CL1, M3, …).
  // tipoHormigonEstructural selecciona la columna de a/c y f'c: SIMPLE | ARMADO | PRETENSADO.
  const tipoEstructural = tipoHormigonEstructural || 'ARMADO';

  trazabilidad.durabilidad = null;
  if (exposicion && durabilidadExposicion && durabilidadExposicion.length > 0) {
    const durRow = durabilidadExposicion.find(d => d.codigo === exposicion);
    if (durRow) {
      // C18/B.1 — Verificación de Tabla 2.5 (a/c y f'c) delegada al engine puro.
      // El engine consume la fila del catálogo y resuelve por tipoEstructural.
      const { verificarDurabilidad } = require('../durabilidadCirsoc25Engine');
      const verifTabla25 = verificarDurabilidad({
        claseExposicion: exposicion,
        tipoEstructural,
        ac: acFinal,
        fc: fce,
        durRow,
      });
      const acMaxDur = verifTabla25.acMax;
      const fcminDur = verifTabla25.fcMin;

      trazabilidad.durabilidad = {
        codigo: exposicion,
        grupo: durRow.grupo,
        descripcionCorta: durRow.descripcionCorta,
        tipoHormigonEstructural: tipoEstructural,
        acMax: acMaxDur,
        fcmin: fcminDur,
        requiereAireTabla43: !!durRow.requiereAireTabla43,
        requiereProteccionSuperficial: !!durRow.requiereProteccionSuperficial,
        acAntesDurabilidad: acFinal,
      };

      const durRef = `CIRSOC 200:2024 Tabla 2.5 · ${exposicion} (${durRow.grupo}) · ${tipoEstructural}`;

      if (acMaxDur !== null) {
        pushFuente(fuentesCalculo, {
          parametro: 'Durabilidad — a/c máxima',
          valor: acMaxDur,
          origenTipo: ORIGEN_TIPO.DURABILIDAD,
          origenRef: durRef,
          regla: `a/c máxima para clase ${exposicion} — ${tipoEstructural} (CIRSOC 200:2024 Tabla 2.5)`,
        });

        if (verifTabla25.verificaciones.ac.ok === false) {
          warnings.push({
            campo: 'durabilidad',
            msg: `a/c reducida de ${fmtDec(acFinal)} a ${fmtDec(acMaxDur)} por durabilidad — clase ${exposicion} (${tipoEstructural})`,
            tipo: 'advertencia',
          });
          pushFuente(fuentesCalculo, {
            parametro: 'a/c adoptada (controlada por durabilidad)',
            valor: acMaxDur,
            origenTipo: ORIGEN_TIPO.DURABILIDAD,
            origenRef: durRef,
            regla: `a/c por resistencia (${acFinal}) > límite (${acMaxDur}); se adopta el límite normativo`,
            criticidad: CRITICIDAD.WARNING,
          });
          acFinal = acMaxDur;
          acGobernante = 'EXPOSICION';
        } else {
          pushFuente(fuentesCalculo, {
            parametro: 'a/c adoptada',
            valor: acFinal,
            origenTipo: ORIGEN_TIPO.CALCULADO,
            regla: `a/c por resistencia (${acFinal}) ≤ máxima por durabilidad (${acMaxDur}); no se ajusta`,
          });
        }
      } else {
        pushFuente(fuentesCalculo, {
          parametro: 'a/c adoptada',
          valor: acFinal,
          origenTipo: ORIGEN_TIPO.CALCULADO,
          regla: `Clase ${exposicion} no impone a/c máxima para ${tipoEstructural} (CIRSOC 200:2024)`,
        });
      }

      trazabilidad.durabilidad.acFinal = acFinal;

      // f'c mínimo: warn if fce < normative minimum
      if (verifTabla25.verificaciones.fc.ok === false) {
        warnings.push({
          campo: 'durabilidad',
          msg: `f'ce ${fce} MPa inferior al mínimo normativo ${fcminDur} MPa para clase ${exposicion} (${tipoEstructural}, CIRSOC 200:2024)`,
          tipo: 'advertencia',
        });
        pushFuente(fuentesCalculo, {
          parametro: "Advertencia — f'c por debajo del mínimo normativo",
          valor: `${fce} MPa < ${fcminDur} MPa`,
          origenTipo: ORIGEN_TIPO.DURABILIDAD,
          origenRef: durRef,
          regla: `f'c mínimo para clase ${exposicion} — ${tipoEstructural} (CIRSOC 200:2024 Tabla 2.5)`,
          criticidad: CRITICIDAD.WARNING,
        });
      } else if (fcminDur !== null) {
        pushFuente(fuentesCalculo, {
          parametro: "f'c mínimo por durabilidad",
          valor: `${fcminDur} MPa`,
          origenTipo: ORIGEN_TIPO.DURABILIDAD,
          origenRef: durRef,
          regla: `f'ce ${fce} MPa ≥ mínimo ${fcminDur} MPa para clase ${exposicion} — ${tipoEstructural}`,
        });
      }

      // ── Aire incorporado — Tabla 4.3 CIRSOC 200:2024 ──────────────────────────
      trazabilidad.verificacionAire = null;
      if (durRow.requiereAireTabla43 && aireDurabilidad && aireDurabilidad.length > 0) {
        const tmnNum = Number(tmnMm);
        const aireRow = aireDurabilidad.find(r =>
          Math.abs(Number(r.tmnMm) - tmnNum) < 0.1 && r.claseExposicion === exposicion
        );
        if (aireRow) {
          const aireRequerido = Number(aireRow.aireTotalPct);
          const tolerancia = Number(aireRow.toleranciaPct || 1.5);
          const aireMin = aireRequerido - tolerancia;
          const aireMax = aireRequerido + tolerancia;
          const aireActual = airePct != null ? Number(airePct) : null;

          // Excepción CIRSOC 200:2024 §4.3 (nota al pie de Tabla 4.3): para
          // f'ce ≥ 35 MPa se permite reducir 1 punto porcentual el aire total
          // requerido, manteniendo la tolerancia ± original. Cubierta también
          // por `verificarAirePorTMN()` en `domain/durabilidadCirsoc25Engine.js`,
          // que es la SSoT canónica para Tabla 4.3.
          const esH35 = Number(fce) >= 35;
          const aireRequeridoEfectivo = esH35 ? aireRequerido - 1.0 : aireRequerido;
          const aireMinEfectivo = aireRequeridoEfectivo - tolerancia;

          const verificacion = {
            clase: exposicion,
            tmnMm: tmnNum,
            aireRequerido,
            aireRequeridoEfectivo,
            tolerancia,
            aireMin: aireMinEfectivo,
            aireMax,
            aireActual,
            excepcionH35: esH35,
            cumple: null,
          };

          if (aireActual != null) {
            verificacion.cumple = aireActual >= aireMinEfectivo && aireActual <= aireMax;
            if (!verificacion.cumple) {
              warnings.push({
                campo: 'durabilidad',
                msg: `Aire total ${fmtDec(aireActual, 1)}% fuera del rango requerido (${fmtDec(aireMinEfectivo, 1)}% – ${fmtDec(aireMax, 1)}%) para clase ${exposicion}, TMN ${tmnNum} mm (Tabla 4.3)${esH35 ? ' — con reducción H-35' : ''}`,
                tipo: 'advertencia',
              });
            }
          } else {
            warnings.push({
              campo: 'durabilidad',
              msg: `Clase ${exposicion} requiere aire total ${fmtDec(aireRequeridoEfectivo, 1)}% ± ${fmtDec(tolerancia, 1)}% para TMN ${tmnNum} mm (Tabla 4.3 CIRSOC 200:2024)${esH35 ? ' — reducción H-35 aplicada' : ''}. No se especificó aire en el diseño.`,
              tipo: 'advertencia',
            });
          }

          // Check for air-entraining admixture
          const tieneIncorporador = [aditivo1, aditivo2, aditivo3].some(a =>
            a && (a.modoEfecto === 'INCORPORADOR_AIRE' || a.tipoFuncional === 'INCORPORADOR_AIRE')
          );
          if (!tieneIncorporador) {
            warnings.push({
              campo: 'durabilidad',
              msg: `Clase ${exposicion} requiere aire incorporado pero no se detectó aditivo incorporador de aire en la dosificación.`,
              tipo: 'advertencia',
            });
          }

          trazabilidad.verificacionAire = verificacion;
          pushFuente(fuentesCalculo, {
            parametro: 'Aire requerido (Tabla 4.3)',
            valor: `${fmtDec(aireRequeridoEfectivo, 1)}% ± ${fmtDec(tolerancia, 1)}%`,
            origenTipo: ORIGEN_TIPO.DURABILIDAD,
            origenRef: `CIRSOC 200:2024 Tabla 4.3 · ${exposicion} · TMN ${tmnNum} mm`,
            regla: `Aire total requerido para clase ${exposicion} con TMN ${tmnNum} mm${esH35 ? ' (reducción H-35 aplicada)' : ''}`,
          });
        } else {
          warnings.push({
            campo: 'durabilidad',
            msg: `Clase ${exposicion} requiere aire incorporado (Tabla 4.3) pero no se encontró registro para TMN ${tmnNum} mm. Verifique la tabla de parámetros.`,
            tipo: 'advertencia',
          });
        }
      } else if (durRow.requiereAireTabla43) {
        warnings.push({
          campo: 'durabilidad',
          msg: `Clase ${exposicion} requiere aire incorporado según Tabla 4.3 CIRSOC 200:2024 pero la tabla no está disponible.`,
          tipo: 'advertencia',
        });
      }

      // Protección superficial
      if (durRow.requiereProteccionSuperficial) {
        warnings.push({
          campo: 'durabilidad',
          msg: `Clase ${exposicion} requiere protección superficial adicional (CIRSOC 200:2024).`,
          tipo: 'advertencia',
        });
      }
    } else {
      warnings.push({
        campo: 'durabilidad',
        msg: `Clase de exposición "${exposicion}" no encontrada en el catálogo CIRSOC 200:2024. Verifique el código.`,
        tipo: 'advertencia',
      });
      pushFuente(fuentesCalculo, {
        parametro: 'a/c adoptada',
        valor: acFinal,
        origenTipo: ORIGEN_TIPO.CALCULADO,
        regla: `Clase "${exposicion}" no encontrada en catálogo; sin ajuste por durabilidad`,
        criticidad: CRITICIDAD.WARNING,
      });
    }
  } else {
    pushFuente(fuentesCalculo, {
      parametro: 'a/c adoptada',
      valor: acFinal,
      origenTipo: ORIGEN_TIPO.CALCULADO,
      regla: !exposicion
        ? 'Sin clase de exposición seleccionada; sin restricción por durabilidad'
        : `Sin tabla de durabilidad disponible`,
    });
  }

  // ── Step 6b: Restricción de pliego / cliente (a/c) ───────────────────────────
  trazabilidad.pliego = { acMaxPliego, amcMaxPliego, cementoMinPliego, acModo };

  if (acMaxPliego != null) {
    const acMaxP = Number(acMaxPliego);
    pushFuente(fuentesCalculo, {
      parametro: 'Pliego — a/c máxima',
      valor: acMaxP,
      origenTipo: ORIGEN_TIPO.PLIEGO,
      origenRef: 'Restricción de pliego / cliente',
      regla: `a/c máxima exigida por pliego o cliente: ${acMaxP}`,
    });

    if (acModo === 'FIJO') {
      // Fuerza la a/c al valor del pliego; emite advertencia si resulta > a/c por resistencia
      if (acMaxP > acFinal) {
        warnings.push({
          campo: 'pliego',
          msg: `a/c pliego FIJA (${fmtDec(acMaxP)}) es mayor que la requerida por resistencia (${fmtDec(acFinal)}). La mezcla puede resultar más débil de lo proyectado.`,
          tipo: 'advertencia',
        });
      }
      pushFuente(fuentesCalculo, {
        parametro: 'a/c adoptada (pliego FIJO)',
        valor: acMaxP,
        origenTipo: ORIGEN_TIPO.PLIEGO,
        origenRef: 'Restricción de pliego / cliente',
        regla: `Modo FIJO: a/c forzada al valor de pliego (${acMaxP}) independientemente del resultado por resistencia`,
        criticidad: acMaxP > acFinal ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
      });
      acFinal = acMaxP;
      acGobernante = 'PLIEGO';
    } else {
      // Modo LIMITE (cap)
      if (acFinal > acMaxP) {
        warnings.push({
          campo: 'pliego',
          msg: `a/c reducida de ${fmtDec(acFinal)} a ${fmtDec(acMaxP)} por restricción de pliego/cliente`,
          tipo: 'advertencia',
        });
        pushFuente(fuentesCalculo, {
          parametro: 'a/c adoptada (controlada por pliego)',
          valor: acMaxP,
          origenTipo: ORIGEN_TIPO.PLIEGO,
          origenRef: 'Restricción de pliego / cliente',
          regla: `a/c calculada (${acFinal}) > límite pliego (${acMaxP}); se adopta el límite`,
          criticidad: CRITICIDAD.WARNING,
        });
        acFinal = acMaxP;
        acGobernante = 'PLIEGO';
      } else {
        pushFuente(fuentesCalculo, {
          parametro: 'a/c adoptada',
          valor: acFinal,
          origenTipo: ORIGEN_TIPO.CALCULADO,
          regla: `a/c calculada (${acFinal}) ≤ máxima por pliego (${acMaxP}); no se ajusta`,
        });
      }
    }
    trazabilidad.pliego.acFinalTrasPliiego = acFinal;
  }

  // ── Step 7: Cemento total ─────────────────────────────────────────────────────
  const cementoTotal = Math.round(aguaFinal / acFinal);
  trazabilidad.cementoCalculado = { aguaFinal, ac: acFinal, cementoTotal, formula: 'cemento = agua / (a/c)' };
  pushFuente(fuentesCalculo, {
    parametro: 'Cemento calculado',
    valor: `${cementoTotal} kg/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: `cemento = agua / (a/c) = ${aguaFinal} / ${acFinal} ≈ ${cementoTotal} kg/m³`,
  });

  if (cementoTotal < 200) warnings.push({ campo: 'cemento', msg: `Cemento ${cementoTotal} kg/m³ es muy bajo`, tipo: 'advertencia' });
  if (cementoTotal > 550) warnings.push({ campo: 'cemento', msg: `Cemento ${cementoTotal} kg/m³ es muy alto`, tipo: 'advertencia' });

  // ── Step 7a: Cemento mínimo por CIRSOC 200:2024 §4.1.5.2 ──────────────────────
  // Norm-mandated minimum cement content depending on structural type:
  //   - Simple (unreinforced): 250 kg/m³
  //   - Armado (reinforced):   280 kg/m³
  //   - Pretensado:            300 kg/m³
  // Stored in trazabilidad for the report and in a warning if the calculated
  // cement falls below it (will be escalated by Step 7b).
  const CEMENTO_MIN_POR_TIPO = { simple: 250, armado: 280, pretensado: 300 };
  // The engine receives tipoHormigonEstructural in uppercase ('ARMADO'/'SIMPLE'/'PRETENSADO')
  // from the service layer. Normalize to lowercase for the lookup.
  const tipoArmNorm = (tipoHormigonEstructural || 'ARMADO').toLowerCase();
  const cementoMinCirsoc = CEMENTO_MIN_POR_TIPO[tipoArmNorm] ?? 280;
  trazabilidad.cementoMinCirsoc = {
    limite: cementoMinCirsoc,
    tipoArmadura: tipoArmNorm,
    norma: 'CIRSOC 200:2024 §4.1.5.2',
    cumpleCalculado: cementoTotal >= cementoMinCirsoc,
  };
  pushFuente(fuentesCalculo, {
    parametro: 'Cemento mínimo CIRSOC §4.1.5.2',
    valor: `${cementoMinCirsoc} kg/m³`,
    origenTipo: ORIGEN_TIPO.DURABILIDAD,
    origenRef: 'CIRSOC 200:2024 §4.1.5.2',
    regla: `Mínimo de material cementicio para hormigón ${tipoArmNorm}: ${cementoMinCirsoc} kg/m³`,
  });
  if (cementoTotal < cementoMinCirsoc) {
    warnings.push({
      campo: 'cemento',
      msg: `Cemento calculado ${cementoTotal} kg/m³ < mínimo CIRSOC §4.1.5.2 (${cementoMinCirsoc} kg/m³) para hormigón ${tipoArmNorm}. Se ajustará al mínimo normativo.`,
      tipo: 'advertencia',
    });
  }

  // ── Step 7b: Mínimos de cemento por pliego (cemento directo y a/mc) ───────────
  // El cemento final adoptado es el máximo entre: calculado, mínimo de pliego,
  // y el mínimo derivado de la relación a/(material cementicio) máxima del pliego.
  let cementoTotalFinal = cementoTotal;
  let cementoGobernante = 'CALCULO'; // tracks which source governed the final cemento

  if (cementoMinPliego != null) {
    const cMinP = Number(cementoMinPliego);
    pushFuente(fuentesCalculo, {
      parametro: 'Pliego — cemento mínimo',
      valor: `${cMinP} kg/m³`,
      origenTipo: ORIGEN_TIPO.PLIEGO,
      origenRef: 'Restricción de pliego / cliente',
      regla: `Cemento mínimo exigido por pliego o cliente: ${cMinP} kg/m³`,
    });
    if (cementoTotalFinal < cMinP) {
      warnings.push({
        campo: 'pliego',
        msg: `Cemento aumentado de ${cementoTotalFinal} a ${cMinP} kg/m³ por mínimo de pliego`,
        tipo: 'advertencia',
      });
      pushFuente(fuentesCalculo, {
        parametro: 'Cemento adoptado (mínimo pliego)',
        valor: `${cMinP} kg/m³`,
        origenTipo: ORIGEN_TIPO.PLIEGO,
        origenRef: 'Restricción de pliego / cliente',
        regla: `Cemento calculado (${cementoTotalFinal} kg/m³) < mínimo pliego (${cMinP} kg/m³); se adopta el mínimo`,
        criticidad: CRITICIDAD.WARNING,
      });
      cementoTotalFinal = cMinP;
      cementoGobernante = 'PLIEGO';
    }
  }

  if (amcMaxPliego != null) {
    const amcMax = Number(amcMaxPliego);
    // a/mc máxima ⟹ cemento mínimo = ceil(agua / amcMax) siendo 'agua' el agua final ya ajustada
    const cementoMinFromAmc = Math.ceil(aguaFinal / amcMax);
    pushFuente(fuentesCalculo, {
      parametro: 'Pliego — a/(mat. cem.) máxima',
      valor: amcMax,
      origenTipo: ORIGEN_TIPO.PLIEGO,
      origenRef: 'Restricción de pliego / cliente',
      regla: `a/mc máxima del pliego: ${amcMax} → cemento mínimo implícito = ⌈${aguaFinal} / ${amcMax}⌉ = ${cementoMinFromAmc} kg/m³`,
    });
    if (cementoTotalFinal < cementoMinFromAmc) {
      warnings.push({
        campo: 'pliego',
        msg: `Cemento aumentado de ${cementoTotalFinal} a ${cementoMinFromAmc} kg/m³ por restricción a/mc ≤ ${amcMax} de pliego`,
        tipo: 'advertencia',
      });
      pushFuente(fuentesCalculo, {
        parametro: 'Cemento adoptado (mínimo por a/mc pliego)',
        valor: `${cementoMinFromAmc} kg/m³`,
        origenTipo: ORIGEN_TIPO.PLIEGO,
        origenRef: 'Restricción de pliego / cliente',
        regla: `Cemento actual (${cementoTotalFinal} kg/m³) < mínimo por a/mc (${cementoMinFromAmc} kg/m³); se adopta el mínimo`,
        criticidad: CRITICIDAD.WARNING,
      });
      cementoTotalFinal = cementoMinFromAmc;
      cementoGobernante = 'AMC_PLIEGO';
    }
    trazabilidad.pliego.cementoMinFromAmc = cementoMinFromAmc;
    trazabilidad.pliego.amcResultante = Math.round((aguaFinal / cementoTotalFinal) * 1000) / 1000;
  }

  // ── Step 7c: CIRSOC §4.1.5.2 absolute floor (applied last, always) ─────────────
  // Even if pliego restrictions are less strict, the code-mandated minimum wins.
  if (cementoTotalFinal < cementoMinCirsoc) {
    const cPrev = cementoTotalFinal;
    cementoTotalFinal = cementoMinCirsoc;
    cementoGobernante = 'CIRSOC';
    pushFuente(fuentesCalculo, {
      parametro: 'Cemento adoptado (mínimo CIRSOC §4.1.5.2)',
      valor: `${cementoMinCirsoc} kg/m³`,
      origenTipo: ORIGEN_TIPO.DURABILIDAD,
      origenRef: 'CIRSOC 200:2024 §4.1.5.2',
      regla: `Cemento previo (${cPrev} kg/m³) < mínimo normativo (${cementoMinCirsoc} kg/m³) para hormigón ${tipoArmNorm}; se adopta el mínimo`,
      criticidad: CRITICIDAD.WARNING,
    });
    trazabilidad.cementoMinCirsoc.aplicado = true;
    trazabilidad.cementoMinCirsoc.cementoAjustadoDesde = cPrev;
  } else {
    trazabilidad.cementoMinCirsoc.aplicado = false;
  }

  if (cementoTotalFinal !== cementoTotal) {
    trazabilidad.cementoCalculado.cementoTotalFinal = cementoTotalFinal;
    trazabilidad.cementoCalculado.ajusteMinimo = cementoTotalFinal - cementoTotal;
  }

  // ── Step 8: Adiciones (reemplazo) ────────────────────────────────────────────
  let cementoKg = cementoTotalFinal;
  let adicion1Kg = 0;
  let adicion2Kg = 0;
  trazabilidad.adiciones = [];

  if (adicion1 && adicion1.reemplazoPct > 0) {
    adicion1Kg = Math.round(cementoTotalFinal * adicion1.reemplazoPct / 100);
    cementoKg = cementoTotalFinal - adicion1Kg;
    trazabilidad.adiciones.push({ adicion: 'adicion1', reemplazoPct: adicion1.reemplazoPct, kgM3: adicion1Kg, cementoRestante: cementoKg });
  }
  if (adicion2 && adicion2.reemplazoPct > 0) {
    adicion2Kg = Math.round(cementoTotalFinal * adicion2.reemplazoPct / 100);
    cementoKg = cementoKg - adicion2Kg;
    trazabilidad.adiciones.push({ adicion: 'adicion2', reemplazoPct: adicion2.reemplazoPct, kgM3: adicion2Kg, cementoRestante: cementoKg });
  }

  // ── Step 9: Aditivos ──────────────────────────────────────────────────────────
  const aditivosRes = [];
  trazabilidad.aditivos = [];
  const calcDosis = (adit, label) => {
    if (!adit || !adit.dosis) return;
    const dosis = Number(adit.dosis);
    let kgM3 = null;
    const unidad = adit.unidadDosificacion || 'PORC_SOBRE_CEMENTO';
    const unidadLabel = UNIDAD_DOSIS_LABELS[unidad] || unidad;
    if (unidad === 'PORC_SOBRE_CEMENTO') {
      kgM3 = Math.round((cementoTotalFinal * dosis / 100) * 100) / 100;
    } else if (unidad === 'ML_POR_100KG_CEMENTO') {
      kgM3 = Math.round((cementoTotalFinal * dosis / 100000) * 100) / 100;
    } else if (unidad === 'KG_M3') {
      kgM3 = dosis;
    }
    aditivosRes.push({ label, dosis, unidad, unidadLabel, kgM3 });
    trazabilidad.aditivos.push({ label, dosis, unidad, unidadLabel, kgM3 });
  };
  calcDosis(aditivo1, 'aditivo1');
  calcDosis(aditivo2, 'aditivo2');
  calcDosis(aditivo3, 'aditivo3');

  // ── Step 10: Volumen absoluto method for aggregates ───────────────────────────
  const densidadCemento = cemento.densidadRelativa ? Number(cemento.densidadRelativa) : 3.15;
  const volAgua = aguaFinal / 1000;
  const volAire = airePct / 100;
  const volCemento = cementoKg / (densidadCemento * 1000);

  let volAdiciones = 0;
  if (adicion1Kg > 0 && adicion1?.densidadRelativa) volAdiciones += adicion1Kg / (Number(adicion1.densidadRelativa) * 1000);
  if (adicion2Kg > 0 && adicion2?.densidadRelativa) volAdiciones += adicion2Kg / (Number(adicion2.densidadRelativa) * 1000);

  // Volumen de aditivos (densidad en kg/L del modelo Aditivo).
  // NOTA: los aditivos marcados como "dosis de corrección" (esCorreccion=true)
  // NO se incluyen en el cálculo volumétrico porque su uso es variable:
  // pueden no aplicarse, o aplicarse en dosis distintas según necesidad en obra.
  // Son dosis bajas que no afectan la estabilidad volumétrica.
  const DENSIDAD_ADITIVO_DEFAULT = 1.08; // kg/L, típico aditivos líquidos
  let volAditivos = 0;
  let aditivoDensidadEstimada = false;
  const aditivosList = [aditivo1, aditivo2, aditivo3];
  aditivosRes.forEach((adRes, idx) => {
    if (adRes.kgM3 && adRes.kgM3 > 0) {
      const adit = aditivosList[idx];
      const esCorreccion = adit?.esCorreccion === true;
      adRes.esCorreccion = esCorreccion;
      if (esCorreccion) {
        // Marcado como corrección: excluir del volumen
        return;
      }
      const densidad = adit?.densidad ? Number(adit.densidad) : DENSIDAD_ADITIVO_DEFAULT;
      if (!adit?.densidad) aditivoDensidadEstimada = true;
      volAditivos += (adRes.kgM3 / densidad) / 1000; // kgM3 / (kg/L) = L → /1000 = m³
    }
  });

  // ── Volumen ocupado por fibras (macrofibra + microfibra) ──
  // densidades típicas: acero 7850, sintética estructural 910, PP microfibra 910
  const DENSIDAD_FIBRA_DEFAULT = 910; // kg/m³ (sintética/PP)
  let volFibras = 0;
  let fibraDensidadEstimada = false;
  const fibraVolDetalle = {};
  if (fibras?.macrofibra?.dosisKgM3) {
    const dens = Number(fibras.macrofibra.densidad) > 0 ? Number(fibras.macrofibra.densidad) : DENSIDAD_FIBRA_DEFAULT;
    if (!(Number(fibras.macrofibra.densidad) > 0)) fibraDensidadEstimada = true;
    const v = Number(fibras.macrofibra.dosisKgM3) / dens;   // m³ por m³ de hormigón
    volFibras += v;
    fibraVolDetalle.macrofibra = { kgM3: Number(fibras.macrofibra.dosisKgM3), densidad: dens, volM3: v };
  }
  if (fibras?.microfibra?.dosisKgM3) {
    const dens = Number(fibras.microfibra.densidad) > 0 ? Number(fibras.microfibra.densidad) : DENSIDAD_FIBRA_DEFAULT;
    if (!(Number(fibras.microfibra.densidad) > 0)) fibraDensidadEstimada = true;
    const v = Number(fibras.microfibra.dosisKgM3) / dens;
    volFibras += v;
    fibraVolDetalle.microfibra = { kgM3: Number(fibras.microfibra.dosisKgM3), densidad: dens, volM3: v };
  }

  const volPasta = volAgua + volAire + volCemento + volAdiciones + volAditivos;
  const volAgregadosTotal = 1.0 - volPasta - volFibras;

  trazabilidad.volumenesAbsolutos = {
    volAgua: Math.round(volAgua * 10000) / 10000,
    volAire: Math.round(volAire * 10000) / 10000,
    volCemento: Math.round(volCemento * 10000) / 10000,
    volAdiciones: Math.round(volAdiciones * 10000) / 10000,
    volAditivos: Math.round(volAditivos * 10000) / 10000,
    volFibras: Math.round(volFibras * 10000) / 10000,
    volFibraDetalle: fibraVolDetalle,
    volPasta: Math.round(volPasta * 10000) / 10000,
    volAgregados: Math.round(volAgregadosTotal * 10000) / 10000,
    aditivoDensidadEstimada,
    fibraDensidadEstimada,
    formula: 'V_agregados = 1 - V_pasta - V_fibras   (donde V_pasta = V_agua + V_aire + V_cemento + V_adiciones + V_aditivos)',
  };
  if (fibraDensidadEstimada) {
    warnings.push({ campo: 'fibras', tipo: 'advertencia',
      msg: `Densidad de fibra no definida en el catálogo; se usó ${DENSIDAD_FIBRA_DEFAULT} kg/m³ por defecto (sintética/PP). Cargá la densidad real para precisión volumétrica.` });
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Volumen de pasta',
    valor: `${(Math.round(volPasta * 10000) / 10000 * 1000).toFixed(0)} L/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: 'V_pasta = V_agua + V_aire + V_cemento + V_adiciones + V_aditivos (método de volúmenes absolutos)',
  });

  const agregados = [];
  // ROUND-X: Expose mezcla release state ("estado") and technical state ("estadoTecnico") so the
  // PDF layer can detect blocking conditions and downgrade the design state / show a banner.
  trazabilidad.mezclaBase = mezcla
    ? {
        idMezcla: mezcla.idMezcla,
        nombre: mezcla.nombre,
        codigo: mezcla.codigo || null,
        tmnCalculadoMm: mezcla.tmnCalculadoMm,
        estado: mezcla.estado || null,               // release state: BORRADOR|A_PRUEBA|APROBADO|SUSPENDIDO|ARCHIVADO|PENDIENTE_REVISION
        estadoTecnico: mezcla.estadoTecnico || null, // technical state: CUMPLE|CUMPLE_OBS|REQUIERE_AJUSTE|NO_CUMPLE
      }
    : null;

  if (mezcla && mezcla.items && mezcla.items.length > 0) {
    const totalPct = mezcla.items.reduce((s, it) => s + Number(it.porcentaje || 0), 0);
    let densidadesDisponibles = true;
    mezcla.items.forEach(it => { if (!it.densidad) densidadesDisponibles = false; });

    if (densidadesDisponibles && volAgregadosTotal > 0) {
      mezcla.items.forEach(it => {
        const pctNorm = totalPct > 0 ? Number(it.porcentaje) / totalPct : 0;
        const volItem = volAgregadosTotal * pctNorm;
        let densItem = Number(it.densidad);
        // Normalize: if density > 100 it's in kg/m³ (e.g. 2631), convert to relative (2.631)
        if (densItem > 100) densItem = densItem / 1000;
        const kgM3 = Math.round(volItem * densItem * 1000);
        const densidadOrigen = it.densidadOrigen || 'MATERIAL_AGREGADO';
        const absorcionPct = it.absorcion != null ? Number(it.absorcion) : null;
        agregados.push({
          nombre: it.nombre,
          // Fix3-prediccion-fresco: tipo (FINO/GRUESO) requerido para calcular
          // proporcionFinos en el motor de predicción. Antes faltaba este campo
          // y la señal "proporción de finos" quedaba siempre null.
          tipo: it.tipo || it.tipoAgregado || null,
          tipoAgregado: it.tipoAgregado || it.tipo || null,
          porcentaje: Number(it.porcentaje),
          proporcionNormalizada: Math.round(pctNorm * 10000) / 100,
          volAbsolutoM3: Math.round(volItem * 10000) / 10000,
          kgM3,
          densidad: densItem,
          densidadOrigen,
          densidadEnsayoId: it.densidadEnsayoId || null,
          absorcionPct,
          absorcionOrigen: it.absorcionOrigen || null,
          absorcionEnsayoId: it.absorcionEnsayoId || null,
          // Granulometry source metadata (MEJ-5)
          granulometriaFecha: it._granulometriaFecha || null,
          granulometriaEnsayoId: it._granulometriaEnsayoId || null,
          granulometriaCodigo: it._granulometriaCodigo || null,
          granulometriaPuntos: it._granulometriaPuntos || null,
          pasante300um: it._pasante300um ?? null,
          pasante75um: it._pasante75um ?? null,
        });
      });

      // ── Absorción ponderada de la mezcla (informativo — NO modifica agua final) ──
      const agregsConAbs = agregados.filter(ag => ag.absorcionPct != null);
      const agregssinAbs = agregados.filter(ag => ag.absorcionPct == null);
      if (agregssinAbs.length > 0) {
        agregssinAbs.forEach(ag => {
          warnings.push({
            campo: 'absorcion',
            msg: `Absorción no disponible para "${ag.nombre}" — complete la ficha técnica o registre un ensayo IRAM 1520/1533`,
            tipo: 'advertencia',
          });
        });
      }
      let absorcionPonderada = null;
      let aguaAbsorbibleTeoricaLM3 = null;
      const coberturaAbs = agregssinAbs.length === 0 ? 'COMPLETA' : agregsConAbs.length > 0 ? 'PARCIAL' : 'NINGUNA';
      if (agregsConAbs.length === agregados.length && agregados.length > 0) {
        absorcionPonderada = Math.round(
          agregados.reduce((sum, ag) => sum + (ag.proporcionNormalizada / 100) * ag.absorcionPct, 0) * 100
        ) / 100;
        aguaAbsorbibleTeoricaLM3 = Math.round(
          agregados.reduce((sum, ag) => sum + ag.kgM3 * ag.absorcionPct / 100, 0) * 10
        ) / 10;
      }
      trazabilidad.absorcionMezcla = {
        absorcionPonderada,
        aguaAbsorbibleTeoricaLM3,
        cobertura: coberturaAbs,
        nota: agregssinAbs.length > 0
          ? `Absorción parcial — faltan datos de: ${agregssinAbs.map(a => a.nombre).join(', ')}`
          : null,
      };

      // Absorption threshold alerts are generated by the frontend PDF renderer
      // (dosificacionInformePdf.js Section H) to avoid duplicates.

      trazabilidad.agregadosDistribucion = {
        metodo: 'VOLUMEN_ABSOLUTO',
        volAgregadosTotal: Math.round(volAgregadosTotal * 10000) / 10000,
        items: agregados,
        absorcionPonderada,
        aguaAbsorbibleTeoricaLM3,
        coberturaAbsorcion: coberturaAbs,
      };
      // Record density source per aggregate
      const densidadesPorOrigen = agregados.reduce((acc, ag) => {
        acc[ag.densidadOrigen] = (acc[ag.densidadOrigen] || 0) + 1;
        return acc;
      }, {});
      const origenDesc = Object.entries(densidadesPorOrigen)
        .map(([o, n]) => `${n} de ${o === 'ENSAYO_AGREGADO' ? 'ensayo' : 'ficha material'}`)
        .join(', ');
      pushFuente(fuentesCalculo, {
        parametro: 'Distribución de agregados',
        valor: 'Volumen absoluto',
        origenTipo: ORIGEN_TIPO.CALCULADO,
        origenRef: mezcla.nombre || null,
        regla: 'Método de volúmenes absolutos: kg/m³ = V_agregado × densidad · proporcional según mezcla',
        observacion: origenDesc ? `Densidades: ${origenDesc}` : null,
      });
    } else {
      mezcla.items.forEach(it => {
        const pct = totalPct > 0 ? Number(it.porcentaje) / totalPct : 0;
        agregados.push({ nombre: it.nombre, porcentaje: Number(it.porcentaje), proporcionNormalizada: Math.round(pct * 10000) / 100 });
      });
      const sinDensidad = mezcla.items.filter(it => !it.densidad).map(it => it.nombre).join(', ');
      trazabilidad.agregadosDistribucion = {
        metodo: 'PROPORCIONAL',
        nota: sinDensidad
          ? `Sin densidad: ${sinDensidad}. Se usó distribución proporcional.`
          : 'Faltan densidades de agregados para método de volumen absoluto',
        items: agregados,
      };
      pushFuente(fuentesCalculo, {
        parametro: 'Distribución de agregados',
        valor: 'Proporcional (sin densidades)',
        origenTipo: ORIGEN_TIPO.MEZCLA,
        origenRef: mezcla.nombre || null,
        regla: 'Distribución proporcional — fallback por falta de densidades de agregados',
        observacion: sinDensidad ? `Sin densidad en: ${sinDensidad}` : null,
        criticidad: CRITICIDAD.FALLBACK,
      });
      if (!densidadesDisponibles) {
        const msgDetalle = sinDensidad ? ` (${sinDensidad})` : '';
        warnings.push({ campo: 'mezcla', msg: `Faltan densidades de agregados${msgDetalle}; se usó distribución proporcional en vez de volumen absoluto`, tipo: 'advertencia' });
      }
    }
  } else {
    warnings.push({ campo: 'mezcla', msg: 'No hay mezcla granulométrica seleccionada', tipo: 'advertencia' });
  }

  // ── Verificación material pulverulento — Tabla 4.4 CIRSOC 200:2024 ──────────
  // Material pasante 300 µm = cemento + adiciones + finos del agregado.
  //
  // CIRSOC 200:2024 §4.1.3 — la exigencia del mínimo NO aplica si se cumplen
  // las TRES condiciones simultáneamente:
  //   1) f'c ≤ 20 MPa.
  //   2) Hormigón NO bombeado.
  //   3) Sin clase de exposición agresiva (C/M/Q/CL).
  //
  // R4 cerrada (auditoría 02-dosi, 2026-05-07): el motor recibe ahora
  // `metodoColocacion` ('CONVENCIONAL'|'BOMBEADO') desde `DosificacionDisenada`
  // y evalúa las tres condiciones del predicado. Default 'CONVENCIONAL' para
  // dosificaciones sin metodoColocacion declarado (compatible con la columna
  // legada que tiene default 'CONVENCIONAL' en la migración).
  trazabilidad.verificacionPulverulento = null;
  if (pulverulentoMinimo && pulverulentoMinimo.length > 0) {
    const tmnNumPulv = Number(tmnMm);
    const pulvRow = pulverulentoMinimo.find(r => Math.abs(Number(r.tmnMm) - tmnNumPulv) < 0.1);
    if (pulvRow) {
      const minimoKgM3 = Number(pulvRow.minimoKgM3);

      // Cement (neto, sin adiciones) + additions are 100% pasante 300 µm
      // cementoKg is the net cement after deducting additions (see Step 8)
      const cementoPulv = cementoKg || 0;
      const adicionesPulv = (adicion1Kg || 0) + (adicion2Kg || 0);

      // Fines from aggregates: use p300 percentage if available
      let finosAgregadoPulv = 0;
      const finosDetalle = []; // per-aggregate breakdown for PDF display
      if (mezcla && mezcla.items && agregados.length > 0) {
        for (const item of mezcla.items) {
          const ag = item.agregado || item;
          const p300 = item.p300 || ag.p300 || ag.agregadoFino?.p300 || null;
          if (p300 != null) {
            // Use the EXACT kgM3 from resultado.agregados (same as Sección F)
            // to avoid rounding discrepancies between sections
            const agId = ag.idAgregado || ag.id || item.idAgregado;
            const agName = (ag.nombre || item.nombre || '').toLowerCase();
            const matchedAg = agregados.find(a =>
              (agId && (a.id === agId || a.idAgregado === agId || a.legacyAgregadoId === agId)) ||
              (agName && (a.nombre || '').toLowerCase().includes(agName))
            );
            const kgAgregado = matchedAg?.kgM3 || (agregados.reduce((s, a) => s + (a.kgM3 || 0), 0) * Number(item.porcentaje || 0) / 100);
            const aporte = kgAgregado * Number(p300) / 100;
            finosAgregadoPulv += aporte;
            finosDetalle.push({
              nombre: ag.nombre || item.nombre || 'Agregado',
              kgM3: Math.round(kgAgregado),
              p300Pct: Number(p300),
              aporteKg: Math.round(aporte),
              // Granulometry source traceability (MEJ-8)
              granulometriaFecha: item._granulometriaFecha || null,
              granulometriaEnsayoId: item._granulometriaEnsayoId || null,
            });
          }
        }
      }

      const totalPulverulento = Math.round(cementoPulv + adicionesPulv + finosAgregadoPulv);

      // Excepción CIRSOC §4.1.3 — predicado completo (R4 cerrada 2026-05-07):
      //   1) f'c ≤ 20 MPa
      //   2) NO bombeado (`metodoColocacion === 'CONVENCIONAL'`)
      //   3) sin clase de exposición agresiva (C/M/Q/CL)
      const esConvencional = String(metodoColocacion || 'CONVENCIONAL').toUpperCase() !== 'BOMBEADO';
      const esExcepcion = Number(fce) <= 20
        && esConvencional
        && !['CL1','CL2','M1','M2','M3','C1','C2','Q1','Q2','Q3','Q4'].includes(exposicion);

      const cumple = totalPulverulento >= minimoKgM3 || esExcepcion;

      trazabilidad.verificacionPulverulento = {
        tmnMm: tmnNumPulv,
        minimoKgM3,
        cementoPulv: Math.round(cementoPulv),
        adicionesPulv: Math.round(adicionesPulv),
        finosAgregadoPulv: Math.round(finosAgregadoPulv),
        finosDetalle,
        totalPulverulento,
        cumple,
        excepcionH20: esExcepcion,
        metodoColocacion: esConvencional ? 'CONVENCIONAL' : 'BOMBEADO',
      };

      pushFuente(fuentesCalculo, {
        parametro: 'Material pulverulento mínimo (Tabla 4.4)',
        valor: `${minimoKgM3} kg/m³ (TMN ${tmnNumPulv} mm)`,
        origenTipo: ORIGEN_TIPO.DURABILIDAD,
        origenRef: `CIRSOC 200:2024 Tabla 4.4 · TMN ${tmnNumPulv} mm`,
        regla: `Mínimo ${minimoKgM3} kg/m³ pasante 300 µm; estimado ${totalPulverulento} kg/m³${esExcepcion ? ' (excepción ≤ H-20)' : ''}`,
      });

      if (!cumple) {
        warnings.push({
          campo: 'pulverulento',
          msg: `Material pulverulento estimado (${totalPulverulento} kg/m³) inferior al mínimo ${minimoKgM3} kg/m³ para TMN ${tmnNumPulv} mm (Tabla 4.4 CIRSOC 200:2024). Considere aumentar finos o adiciones.`,
          tipo: 'advertencia',
        });
      }
    }
  }

  // ── Balance de volúmenes (verificación de cierre a 1000 L/m³) ──────────────
  const balanceVol = {
    vAgua:      Math.round(volAgua * 1000 * 10) / 10,
    vCemento:   Math.round(volCemento * 1000 * 10) / 10,
    vAire:      Math.round(volAire * 1000 * 10) / 10,
    vAdiciones: Math.round(volAdiciones * 1000 * 10) / 10,
    vAditivos:  Math.round(volAditivos * 1000 * 10) / 10,
    vFibras:    Math.round(volFibras * 1000 * 10) / 10,
    vFibraDetalle: fibraVolDetalle,
    vPasta:     Math.round(volPasta * 1000 * 10) / 10,
    vAgregados: Math.round(volAgregadosTotal * 1000 * 10) / 10,
    totalLM3:   Math.round((volPasta + volFibras + volAgregadosTotal) * 1000 * 10) / 10,
    aditivoDensidadEstimada,
    fibraDensidadEstimada,
    formula: 'V_agua + V_cemento + V_aire + V_adiciones + V_aditivos + V_fibras + V_agregados = 1000 L/m³',
  };
  trazabilidad.balanceVolumenes = balanceVol;

  pushFuente(fuentesCalculo, {
    parametro: 'Balance de volúmenes',
    valor: `${balanceVol.totalLM3} L/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: `V_agua(${balanceVol.vAgua}) + V_cem(${balanceVol.vCemento}) + V_aire(${balanceVol.vAire}) + V_adic(${balanceVol.vAdiciones}) + V_adit(${balanceVol.vAditivos}) + V_agr(${balanceVol.vAgregados}) = ${balanceVol.totalLM3} L/m³`,
  });

  // ── PUV teórico (peso unitario volumétrico — suma de pesos SSS) ────────────
  const pesoAgregados = agregados.reduce((s, ag) => s + (ag.kgM3 || 0), 0);
  const pesoAditivos = aditivosRes.reduce((s, ad) => s + (ad.kgM3 || 0), 0);
  const puvTeorico = Math.round(aguaFinal + cementoTotalFinal + adicion1Kg + adicion2Kg + pesoAditivos + pesoAgregados);
  trazabilidad.puvTeorico = { valor: puvTeorico, unidad: 'kg/m³', nota: 'Suma de pesos SSS — dato de referencia para pastón de prueba (ICPA Paso 2-c.9 y 2-d)' };

  pushFuente(fuentesCalculo, {
    parametro: 'PUV teórico',
    valor: `${puvTeorico} kg/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: 'Suma de pesos SSS de todos los componentes (referencia para pastón de prueba)',
  });

  // ── Validación cruzada mezcla ↔ dosificación ──────────────────────────────
  trazabilidad.validacionCruzada = [];

  if (mezcla && mezcla.items) {
    // Verificar suma de % = 100
    const totalPctMezcla = mezcla.items.reduce((s, it) => s + Number(it.porcentaje || 0), 0);
    if (Math.abs(totalPctMezcla - 100) > 0.5) {
      const msg = `La suma de porcentajes de la mezcla es ${totalPctMezcla.toFixed(1)}% (se espera 100%)`;
      warnings.push({ campo: 'mezcla', msg, tipo: 'advertencia' });
      trazabilidad.validacionCruzada.push({ check: 'SUMA_PCT', resultado: 'FALLA', detalle: msg });
    } else {
      trazabilidad.validacionCruzada.push({ check: 'SUMA_PCT', resultado: 'OK', detalle: `Suma de porcentajes: ${totalPctMezcla.toFixed(1)}%` });
    }

    // Verificar coherencia MF mezcla vs MF usado para agua
    if (moduloFinura && mezcla.mfCalculado != null) {
      const diffMF = Math.abs(Number(moduloFinura) - Number(mezcla.mfCalculado));
      if (diffMF > 0.15) {
        const msg = `MF usado para agua (${moduloFinura}) difiere del MF calculado de la mezcla (${mezcla.mfCalculado}) en ${diffMF.toFixed(2)}`;
        warnings.push({ campo: 'moduloFinura', msg, tipo: 'advertencia' });
        trazabilidad.validacionCruzada.push({ check: 'MF_COHERENCIA', resultado: 'ADVERTENCIA', detalle: msg });
      } else {
        trazabilidad.validacionCruzada.push({ check: 'MF_COHERENCIA', resultado: 'OK', detalle: `MF mezcla ${mezcla.mfCalculado} ≈ MF usado ${moduloFinura}` });
      }
    }
  }

  // ── Build resumenDecisiones ───────────────────────────────────────────────────
  // Human-readable governing restriction for a/c and cemento.
  const expLabel = trazabilidad.durabilidad
    ? `${trazabilidad.durabilidad.codigo}${trazabilidad.durabilidad.grupo ? ` (${trazabilidad.durabilidad.grupo})` : ''}`
    : (exposicion || '—');

  const acGobernanteTextos = {
    RESISTENCIA: `La relaci\u00f3n a/c final qued\u00f3 gobernada por resistencia - f'cm ${fcmParaCurva} MPa`,
    EXPOSICION:  `La relación a/c final quedó gobernada por durabilidad — clase ${expLabel}`,
    PLIEGO:      `La relación a/c final quedó gobernada por restricción de pliego/cliente (${acModo === 'FIJO' ? 'valor fijo' : 'límite'}: ${acFinal})`,
  };
  const cementoGobernanteTextos = {
    CALCULO:    `El cemento final quedó determinado por el cálculo (${aguaFinal} L/m³ ÷ ${acFinal} = ${cementoTotal} kg/m³)`,
    PLIEGO:     `El cemento final quedó gobernado por el mínimo contractual del pliego (${cementoMinPliego} kg/m³)`,
    AMC_PLIEGO: `El cemento final quedó gobernado por la relación a/mc máxima del pliego (${amcMaxPliego}) → mínimo ${cementoTotalFinal} kg/m³`,
  };

  trazabilidad.resumenDecisiones = {
    acGobernante,
    cementoGobernante,
    acFinal,
    cementoFinal: cementoTotalFinal,
    aguaFinal,
    acGobernanteTexto: acGobernanteTextos[acGobernante],
    cementoGobernanteTexto: cementoGobernanteTextos[cementoGobernante],
  };

  // ── Build resultado ───────────────────────────────────────────────────────────
  const resultado = {
    metodo: 'HORMIQUAL',
    motorVersion: MOTOR_VERSION,
    fcm: Math.round(fcm * 10) / 10,
    tmnMm, // TMN de la mezcla — necesario para trabajabilidad (offsets TMN)
    asentamientoMm: (asentamientoMm || (asentamientoCm ? asentamientoCm * 10 : null)),
    asentamientoCm,
    aguaLtsM3: aguaFinal,
    idaPonderado: idaEfectivo,
    ac: acFinal,
    airePct,
    aireAtrapado,
    aireIncorporado,
    tipoAire,
    cementoTotalKgM3: cementoTotalFinal,
    cementoKgM3: cementoKg,
    adicion1KgM3: adicion1Kg || null,
    adicion2KgM3: adicion2Kg || null,
    aditivos: aditivosRes,
    agregados,
    densidadCementoUsada: densidadCemento,
    volumenPasta: Math.round(volPasta * 1000) / 1000,
    // Fix3-prediccion-fresco: el motor de predicción busca volumen de pasta
    // como PORCENTAJE del m³ (volPastaPct), no en m³. Se calcula sobre 1000 L.
    // Ej: pasta 0.275 m³ → 27.5 % de pasta.
    volPastaPct: Math.round(volPasta * 100 * 10) / 10,
    volumenAgregados: Math.round(volAgregadosTotal * 1000) / 1000,
    balanceVolumenes: balanceVol,
    puvTeorico,
    fibras: fibras && (fibras.macrofibra || fibras.microfibra) ? {
      macrofibra: fibras.macrofibra || null,
      microfibra: fibras.microfibra || null,
    } : null,
  };

  // ── Evaluación de trabajabilidad (Shilstone + Ken Day) ──
  try {
    // Debug logs removed
    const { evaluarTrabajabilidad } = require('./trabajabilidadEngine');
    const curvaMezclaData = mezcla?.curvaMezcla || mezcla?.curvaMezclaJson;
    let curvaParsed = curvaMezclaData;
    // Handle string (single or double-encoded JSON)
    if (typeof curvaParsed === 'string') {
      try { curvaParsed = JSON.parse(curvaParsed); } catch { curvaParsed = null; }
      // Double-encoded: parse again if still a string
      if (typeof curvaParsed === 'string') {
        try { curvaParsed = JSON.parse(curvaParsed); } catch { curvaParsed = null; }
      }
    }

    if (Array.isArray(curvaParsed) && curvaParsed.length > 0) {
      // Use cached trabajabilidad params if available (loaded asynchronously elsewhere)
      const dbParams = ctx?.trabajabilidadParams || null;
      const cementanteTotal = resultado.cementoKgM3 + (resultado.adicion1KgM3 || 0) + (resultado.adicion2KgM3 || 0);
      const trabajabilidad = evaluarTrabajabilidad({
        curvaMezcla: curvaParsed,
        cementanteKgM3: cementanteTotal,
        airePct: resultado.airePct,
        asentamientoObjetivoMm: resultado.asentamientoMm || (resultado.asentamientoCm ? resultado.asentamientoCm * 10 : null),
        tmnMm: resultado.tmnMm,
        dbParams,
      });
      trazabilidad.trabajabilidad = trabajabilidad;
      // P0/Fix3-prediccion-fresco: además del shape plano legacy (fdg/fdt/se/fda)
      // exponer los sub-objetos `shilstone` y `kenDay` para que el motor de
      // predicción de comportamiento fresco lea las claves anidadas que espera
      // (zona Shilstone completa, coherencia Ken Day, etc).
      resultado.trabajabilidad = {
        // Plano (compat con renderers existentes)
        fdg: trabajabilidad.shilstone.factorGrosor,
        fdt: trabajabilidad.shilstone.factorTrabajabilidad,
        zonaShilstone: trabajabilidad.shilstone.zona?.zona,
        zonaShilstoneNombre: trabajabilidad.shilstone.zona?.nombre,
        se: trabajabilidad.kenDay.superficieEspecifica,
        fda: trabajabilidad.kenDay.factorAptitud,
        fdaInterpretacion: trabajabilidad.kenDay.interpretacion?.uso,
        fdaConoEstimado: trabajabilidad.kenDay.interpretacion?.cono,
        coherencia: trabajabilidad.kenDay.coherencia?.estado,
        // Anidado (lo que prediccionFrescoEngine busca)
        shilstone: {
          factorGrosor: trabajabilidad.shilstone.factorGrosor,
          factorTrabajabilidad: trabajabilidad.shilstone.factorTrabajabilidad,
          zona: trabajabilidad.shilstone.zona || null,
        },
        kenDay: {
          superficieEspecifica: trabajabilidad.kenDay.superficieEspecifica,
          factorAptitud: trabajabilidad.kenDay.factorAptitud,
          interpretacion: trabajabilidad.kenDay.interpretacion || null,
          coherencia: trabajabilidad.kenDay.coherencia || null,
        },
        tmnMm: resultado.tmnMm,
      };
      if (trabajabilidad.kenDay.coherencia?.estado === 'fda_bajo') {
        warnings.push({ campo: 'trabajabilidad', msg: trabajabilidad.kenDay.coherencia.mensaje, tipo: 'advertencia' });
      } else if (trabajabilidad.kenDay.coherencia?.estado === 'fda_alto') {
        warnings.push({ campo: 'trabajabilidad', msg: trabajabilidad.kenDay.coherencia.mensaje, tipo: 'info' });
      }
      if (trabajabilidad.notaTmn) {
        warnings.push({ campo: 'trabajabilidad', msg: trabajabilidad.notaTmn, tipo: 'info' });
      }
    }
  } catch (e) {
    // Non-critical — don't break dosification calculation. Capturado en
    // warnings[] en lugar de console.warn (auditoría 01-calidad Fase C R1).
    warnings.push({
      campo: 'trabajabilidad',
      msg: `Sub-cálculo "trabajabilidad" no disponible: ${e.message}`,
      tipo: 'info',
    });
  }

  // ── Optimizador granulométrico (cuando hay problemas de zona) ──
  try {
    const zonaActual = resultado.trabajabilidad?.zonaShilstone;
    const { debeOptimizar, optimizarGranulometria } = require('./optimizadorGranulometrico');
    if (zonaActual && debeOptimizar(zonaActual) && mezcla?.items?.length > 0) {
      // Build materiales from mezcla items with their granulometria
      const materialesOpt = (mezcla.items || []).map(it => {
        const ag = it.agregado || it;
        const gran = {};
        // Extract granulometry from the mix curve data if available
        if (ag.granulometria && typeof ag.granulometria === 'object') {
          for (const [k, v] of Object.entries(ag.granulometria)) {
            if (v != null) gran[Number(k)] = Number(v);
          }
        }
        return {
          id: ag.idAgregado || ag.id || it.idAgregado,
          nombre: ag.nombre || it.nombre || 'Agregado',
          tipo: it.tipoAgregado || ag.tipoAgregado || (ag.moduloFinura < 4 ? 'FINO' : 'GRUESO'),
          granulometria: gran,
          tmn: ag.tmn || ag.tmnMm || null,
        };
      }).filter(m => Object.keys(m.granulometria).length > 3);

      if (materialesOpt.length >= 2) {
        const maxTolvas = ctx?.maxTolvas || 4;
        const sugerencias = optimizarGranulometria({
          materiales: materialesOpt,
          maxTolvas,
          cementoKg: resultado.cementoTotalKgM3 || resultado.cementoKgM3 || 300,
          tmnMezcla: resultado.tmnMm,
          maxResultados: 2,
        });
        if (sugerencias.length > 0) {
          resultado.sugerenciaGranulometrica = sugerencias;
          trazabilidad.sugerenciaGranulometrica = sugerencias;
          warnings.push({
            campo: 'granulometria',
            msg: `Zona ${zonaActual} detectada. El optimizador sugiere ${sugerencias.length} alternativa(s) granulom\u00e9trica(s) que podr\u00edan mejorar la trabajabilidad.`,
            tipo: 'info',
          });
        }
      }
    }
  } catch (e) {
    warnings.push({
      campo: 'optimizadorGranulometrico',
      msg: `Sub-cálculo "optimizador granulométrico" no disponible: ${e.message}`,
      tipo: 'info',
    });
  }

  // ── Verificación IRAM 1627: banda granulométrica ──
  // Evaluación real ejecutada en el service layer (dosificacionDisenoService.js)
  // con acceso a la base de datos de bandas IRAM. El resultado se almacena en
  // resultado.verificacionIRAM por el service layer.

  // ── Alerta de optimización de aditivo ──
  try {
    const aditivoPrincipal = aditivo1 || null;
    const reduccionAguaPct1 = Number(aditivo1?.reduccionAguaPctEsperada) || 0;
    const modoEfecto1 = aditivo1?.modoEfecto;
    const esReologicoSinReduccion = modoEfecto1 === 'AUMENTO_ASENTAMIENTO' || (!reduccionAguaPct1 && modoEfecto1 !== 'AHORRO_AGUA');
    if (aditivoPrincipal && esReologicoSinReduccion && cementoTotalFinal > 0 && fce > 0) {
      let cementoThreshold;
      if (fce <= 25) cementoThreshold = 350;
      else if (fce <= 35) cementoThreshold = 380;
      else if (fce <= 45) cementoThreshold = 420;
      else cementoThreshold = 460;
      if (cementoTotalFinal > cementoThreshold) {
        warnings.push({
          tipo: 'optimizacion',
          campo: 'aditivo',
          msg: `Cemento resultante (${Math.round(cementoTotalFinal)} kg/m³) es elevado para f'c=${fce} MPa. El aditivo seleccionado no reduce agua. Considerar un aditivo con efecto reductor de agua para optimizar el contenido de cemento.`,
          nivel: 'advertencia',
        });
      }
    }
  } catch (e) {
    // Non-critical — captured en warnings[] en lugar de console.warn.
    warnings.push({
      campo: 'optimizacionAditivo',
      msg: `Sub-cálculo "optimización de aditivo" no disponible: ${e.message}`,
      tipo: 'info',
    });
  }

  // ── Advertencias automáticas adicionales ──
  const numAditivos = [aditivo1, aditivo2, aditivo3].filter(a => a && a.id).length;
  if (numAditivos >= 2) {
    warnings.push({ campo: 'aditivos', msg: `Se utilizan ${numAditivos} aditivos. Verificar compatibilidad entre aditivos antes de la producci\u00f3n.`, tipo: 'advertencia' });
  }
  // Check for retardant
  const tieneRetardante = [aditivo1, aditivo2, aditivo3].some(a => a && (a.modoEfecto === 'RETARDANTE' || a.efecto === 'retardante'));
  if (tieneRetardante) {
    const retNombre = [aditivo1, aditivo2, aditivo3].find(a => a && (a.modoEfecto === 'RETARDANTE' || a.efecto === 'retardante'));
    warnings.push({ campo: retNombre?.nombre || 'aditivo', msg: `El aditivo retardante puede afectar los tiempos de desencofrado y curado. Verificar compatibilidad con el programa de obra.`, tipo: 'info' });
  }

  // ── Sugerencia de TMN óptimo (cuando no hay restricciones que lo limiten) ──
  try {
    const tmnActual = resultado.tmnMm || tmnMezcla;
    if (tmnActual && curvasAgua?.length > 0) {
      // Find TMNs with water data that are larger than current
      const tmnsDisponibles = [...new Set(curvasAgua.map(r => Number(r.tmnMm)).filter(t => t > 0 && t > tmnActual))].sort((a, b) => a - b);
      if (tmnsDisponibles.length > 0) {
        // Calculate water savings for each alternative TMN using Ábaco 1
        const aguaActual = resultado.aguaLtsM3;
        const acActual = resultado.ac;
        const mejorAlt = tmnsDisponibles.map(tmnAlt => {
          // Interpolate water for alternative TMN (simplified: find closest row)
          const rows = curvasAgua.filter(r => Math.abs(Number(r.tmnMm) - tmnAlt) < 0.5);
          if (rows.length === 0) return null;
          // Use the same MF and asentamiento to estimate agua
          const mfActual = resultado.mf || resultado.moduloFinura || 5;
          // Simplified: water decreases ~15 L/m3 per TMN step increase
          const aguaRow = rows[0];
          const aguaAlt = aguaRow.aguaBase || aguaRow.agua || null;
          if (!aguaAlt) return null;
          const deltaAgua = aguaActual - Number(aguaAlt);
          const cementoAlt = acActual ? Math.round(Number(aguaAlt) / acActual) : null;
          const deltaCemento = cementoAlt ? Math.round(resultado.cementoTotalKgM3 - cementoAlt) : null;
          return { tmn: tmnAlt, aguaAlt: Number(aguaAlt), deltaAgua: Math.round(deltaAgua), cementoAlt, deltaCemento };
        }).filter(Boolean).filter(a => a.deltaAgua > 5); // Only suggest if saves > 5 L/m3

        if (mejorAlt.length > 0) {
          const mejor = mejorAlt[mejorAlt.length - 1]; // largest TMN with savings
          resultado.sugerenciaTMN = mejor;
          warnings.push({
            campo: 'optimizacion',
            tipo: 'info',
            msg: `TMN actual: ${tmnActual} mm. Si las condiciones constructivas lo permiten (recubrimiento, separaci\u00f3n de armaduras, secci\u00f3n m\u00ednima >= 4\u00d7TMN), un TMN de ${mejor.tmn} mm reducir\u00eda el agua estimada en ~${mejor.deltaAgua} L/m\u00b3${mejor.deltaCemento ? ` y el cemento en ~${mejor.deltaCemento} kg/m\u00b3` : ''}. Verificar CIRSOC 200:2024 antes de adoptar.`,
          });
        }
      }
    }
  } catch (e) {
    warnings.push({
      campo: 'sugerenciaTMN',
      msg: `Sub-cálculo "sugerencia de TMN óptimo" no disponible: ${e.message}`,
      tipo: 'info',
    });
  }

  // ── CIRSOC 200-2024 Tabla 9.3: verificación de requisitos particulares ──
  if (hormigonParticular && !hormigonParticular.ambiguo && resultado) {
    const hp = hormigonParticular;
    const checks = [];
    const acCalc = Number(resultado.ac || resultado.relacionAguaCemento || 0);
    if (acCalc > 0 && hp.acMax != null && acCalc > Number(hp.acMax) + 0.001) {
      checks.push({ campo: 'acMax', tipo: 'error',
        msg: `Tabla 9.3: a/c calculada (${acCalc.toFixed(3)}) supera máximo ${Number(hp.acMax).toFixed(3)} para ${hp.tipoHormigon} Clase ${hp.clase}${hp.espesorMmMax ? ` (esp. ≤ ${hp.espesorMmMax} mm)` : ''}.` });
    }
    if (hp.claseMinima) {
      const mFc = String(hp.claseMinima).match(/(\d+)/);
      const fcMin = mFc ? Number(mFc[1]) : null;
      if (fcMin != null && fce != null && Number(fce) < fcMin) {
        checks.push({ campo: 'fce', tipo: 'error',
          msg: `Tabla 9.3: f'c (${fce} MPa) < clase mínima ${hp.claseMinima} para ${hp.tipoHormigon} Clase ${hp.clase}.` });
      }
    }
    if (hp.aireIncorporado === 'NO') {
      const aireIncorp = Number(params.aireIncorporado || 0);
      if (aireIncorp > 0) checks.push({ campo: 'aire', tipo: 'error',
        msg: `Tabla 9.3: ${hp.tipoHormigon} Clase ${hp.clase} no admite aire incorporado (${aireIncorp}%).` });
    }
    const limitesTMN = [];
    if (hp.tmnMaxMm != null) limitesTMN.push(Number(hp.tmnMaxMm));
    if (hp.tmnMaxFraccionEspesor != null && espesorElementoMm != null) {
      limitesTMN.push(Number(hp.tmnMaxFraccionEspesor) * Number(espesorElementoMm));
    }
    if (limitesTMN.length > 0 && tmnMm != null) {
      const tmnLimite = Math.min(...limitesTMN);
      if (Number(tmnMm) > tmnLimite + 0.01) checks.push({ campo: 'tmnMm', tipo: 'error',
        msg: `Tabla 9.3: TMN ${tmnMm} mm excede máximo ${tmnLimite.toFixed(1)} mm para ${hp.tipoHormigon} Clase ${hp.clase}.` });
    }
    let cp = hp.consistenciaPermitida;
    if (typeof cp === 'string') { try { cp = JSON.parse(cp); } catch { cp = null; } }
    if (Array.isArray(cp) && cp.length > 0 && params.consistenciaInfo?.codigo) {
      if (!cp.includes(params.consistenciaInfo.codigo)) checks.push({ campo: 'consistencia', tipo: 'advertencia',
        msg: `Tabla 9.3: consistencia "${params.consistenciaInfo.codigo}" no admitida (permitidas: ${cp.join(', ')}).` });
    }
    for (const w of checks) warnings.push(w);
    trazabilidad.hormigonParticular = {
      tipoHormigon: hp.tipoHormigon, clase: hp.clase, espesorEvaluadoMm: espesorElementoMm,
      requisitos: {
        acMax: hp.acMax, claseMinima: hp.claseMinima, aireIncorporado: hp.aireIncorporado,
        tmnMaxMm: hp.tmnMaxMm, tmnMaxFraccionEspesor: hp.tmnMaxFraccionEspesor,
        desgasteLAMaxPct: hp.desgasteLAMaxPct, consistenciaPermitida: cp,
        penetracionAguaMaxMm: hp.penetracionAguaMaxMm,
      },
      checks, cumple: checks.filter(c => c.tipo === 'error').length === 0,
    };
  } else if (hormigonParticular?.ambiguo) {
    warnings.push({ campo: 'espesorElementoMm', tipo: 'advertencia',
      msg: `Tabla 9.3: hay múltiples filas para ${hormigonParticular.opciones?.[0]?.tipoHormigon} Clase ${hormigonParticular.opciones?.[0]?.clase}. Indicá el espesor del elemento.` });
  }

  // Deduplicar warnings por mensaje (mantener el más específico)
  const seen = new Set();
  const dedupWarnings = [];
  for (const w of warnings) {
    if (!seen.has(w.msg)) {
      seen.add(w.msg);
      dedupWarnings.push(w);
    }
  }

  // ── Estado global consolidado (legacy + multi-eje prestacional) ──
  try {
    const { consolidarEstadoGlobal, buildAssessment } = require('./estadoGlobalConsolidator');
    // Read pulverulento directly from trazabilidad (the real source)
    const pulvData = trazabilidad.verificacionPulverulento;
    const esCurvaFallback = dedupWarnings.some(w => {
      const m = (w.msg || w.mensaje || '');
      return m.includes('fallback') || m.includes('ICPA') || m.includes('baco');
    });
    // Collect non-conformities from warnings
    const noCumpleWarnings = dedupWarnings.filter(w => w.tipo === 'error' || (w.msg || '').includes('NO CUMPLE'));

    const cirsocPayload = {
      pulverulento: pulvData ? { cumple: pulvData.cumple, total: pulvData.totalPulverulento, minimo: pulvData.minimoKgM3 } : null,
    };

    // Legacy estadoGlobal (consumidores antiguos)
    resultado.estadoGlobal = consolidarEstadoGlobal({
      aptitudMateriales: [], // populated by service layer with real aptitud data
      clorurosGlobal: null,  // populated by service layer
      trabajabilidad: resultado.trabajabilidad ? { coherencia: resultado.trabajabilidad.coherencia, zona: resultado.trabajabilidad.zonaShilstone } : null,
      verificacionesCIRSOC: cirsocPayload,
      curvaFallback: esCurvaFallback,
      origenS: ctx?.origenS || null,
      validacionExperimentalPendiente: true,
      warningsNoCumple: noCumpleWarnings,
    });

    // Modelo prestacional multi-eje (filosofía 2026)
    // Mismo input crudo, pero clasificado por severidad técnica real.
    // El service layer puede poblar mezclaBase/aptitudMateriales/clorurosGlobal
    // y volver a llamar buildAssessment con datos completos.
    resultado.assessment = buildAssessment({
      mezclaBase: ctx?.mezclaBase || null,
      aptitudMateriales: [], // service layer enriches with real aptitud
      expuestoDesgaste: !!ctx?.expuestoDesgaste,
      // X2 (2026-05-08): propagar tipologiaCodigo para que el helper
      // `resolveExpuestoDesgaste` lo evalúe junto al flag explícito.
      tipologiaCodigo: ctx?.tipologiaCodigo || ctx?.tipologia?.codigo || null,
      clorurosGlobal: null,
      verificacionesCIRSOC: cirsocPayload,
      curvaFallback: esCurvaFallback,
      trabajabilidad: resultado.trabajabilidad ? { coherencia: resultado.trabajabilidad.coherencia } : null,
      validacionExperimentalPendiente: true,
      tieneVerifReal: false,
      reportMode: ctx?.reportMode || 'PRESTACIONAL',
    });
  } catch (e) {
    // Pushear directamente a `dedupWarnings` porque ya pasó el dedup arriba.
    dedupWarnings.push({
      campo: 'estadoGlobal',
      msg: `Sub-cálculo "estado global consolidado" no disponible: ${e.message}`,
      tipo: 'info',
    });
  }

  return { resultado, trazabilidad, warnings: dedupWarnings };
}

module.exports = {
  calcularDosificacionHormiqual,
  calcularDosificacionHQ: calcularDosificacionHormiqual, // Alias unificado
  estimarAguaBaseReferencia,
  MOTOR_VERSION,
  ABSORCION_UMBRAL_FINO,
  ABSORCION_UMBRAL_GRUESO,
  UNIDAD_DOSIS_LABELS,
};
