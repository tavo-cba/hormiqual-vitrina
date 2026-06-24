'use strict';

/**
 * hrdcCalcEngine — Motor de dosificación para HRDC (Hormigón de Resistencia y
 * Densidad Controlada).
 *
 * HRDC es hormigón celular liviano no estructural: cemento + arena + agua +
 * aditivo espumígeno (obligatorio). Resistencia típica < 5 MPa, densidad
 * fresca típica 600–1600 kg/m³. Identificación por contenido de cemento por m³
 * (HRDC-100, HRDC-150, HRDC-180, ...).
 *
 * Modelo RDC Fase 3 (Segerer 2017 / AAHE N°16 "Experiencias Concretas",
 * en docs/normativa/fuentes/). RDC fuera de CIRSOC/IRAM → modelo de
 * ingeniería HormiQual, NO normativo.
 *
 * Gobierno del cálculo (validado con dosificaciones reales del usuario):
 *   - El CUC (cemento, INPUT directo) gobierna la resistencia esperada
 *     (bandas Segerer Tipo 1–6 / AAHE N°16 Tabla 7, orientativas).
 *   - La CONSISTENCIA objetivo (asentamiento o extendido de cono, en cm)
 *     gobierna el agua: agua = base(consistencia) × factor de calibración
 *     por planta (único multiplicador, mismo criterio que el factor de
 *     ajuste de las curvas de cemento). a/c = consecuencia informativa.
 *   - El f'c es OPCIONAL: si se carga, sólo verificación orientativa contra
 *     la resistencia esperada del CUC. A veces el RDC es sólo relleno sin
 *     requisito de resistencia → no se exige.
 *   - La densidad (PUV) gobierna arena (cierre de masa) y aire (cierre de
 *     volumen). PUV objetivo = input explícito o reducción % sobre el
 *     mortero base (Config por planta, Fase 2).
 *   - El espumígeno es la palanca física del aire; se verifica que la dosis
 *     cargada pueda entregar el aire requerido (Segerer: 20–35%).
 *   - El plastificante NO reduce el agua de diseño (Opción A): habilita la
 *     fluidez autocompactante.
 *   - Verificación CIRSOC 200 NO aplica.
 *
 * Pureza: este engine es puro (no DB, no HTTP, no Sequelize). Todos los
 * datos externos (curvas del ábaco, propiedades del cemento, aditivos)
 * llegan como argumentos.
 *
 * @see CLAUDE.md — Reglas de pureza en src/domain/
 */

const { consolidarPorProducto } = require('./consolidarAditivos');

// Identidad UNIFICADA del motor de dosificación HormiQual (sesión 2026-05-18).
// Antes 'HRDC-1.0' parecía un producto distinto: la marca/motor es HormiQual;
// RDC/HRDC es el MODELO de cálculo (descriptor aparte, no normativo). v2.0 =
// corte de unificación de identidad; el cálculo NO cambió respecto de
// HRDC-1.0. Forward-only. Política de versionado: ver hormiqualCalcEngine y
// docs/decisiones_arquitectura.md.
const MOTOR_VERSION = 'HormiQual v2.0';
const MODELO_CALCULO_LABEL = 'HRDC — Hormigón de Resistencia y Densidad Controlada (modelo no normativo)';

// Densidad de cemento por defecto si el material no la trae (Portland típico)
const DENSIDAD_CEMENTO_DEFAULT_GCM3 = 3.10;
// Densidad de aditivo por defecto si no viene
const DENSIDAD_ADITIVO_DEFAULT_GCM3 = 1.05;
// Densidad de agua
const DENSIDAD_AGUA_KGM3 = 1000;
// TMN típico HRDC. Por encima → warning blando.
const TMN_TIPICO_HRDC_MM = 9.5;
// Cap rangos de cemento permitidos (input usuario).
const CEMENTO_MIN_KGM3 = 50;
const CEMENTO_MAX_KGM3 = 400;

/* ── Parámetros del modelo RDC (Fase 1 — constantes citadas) ──────────────────
   Fuentes en docs/normativa/fuentes/:
     · Segerer 2017 — "RDC: Especificación y Control" (Hormigonar 43, AAHE).
     · AAHE/Becker 2013 — "RDC: Economía y Productividad".
   RDC está fuera de CIRSOC/IRAM: este es un modelo de ingeniería HormiQual,
   NO normativo. En Fase 2 estos valores pasan a parámetro Config por planta. */
// Modo de resolución de la densidad objetivo cuando no hay PUV explícito.
const RDC_REDUCCION_PCT_DEFAULT = 22;        // % de reducción respecto del mortero base sin aire (≈ PUV 1650 típico).
const RDC_PUV_OBJETIVO_DEFAULT_KGM3 = 1650;  // Segerer 2017: PUV habitual 1550–1800 kg/m³ (valor central).
const RDC_PUV_TOLERANCIA_KGM3 = 80;          // Segerer 2017: control PUV ±80 kg/m³ vs teórico.
const RDC_AIRE_MIN_PCT = 20;                 // Segerer 2017: aire (Washington) habitual 20–35%.
const RDC_AIRE_MAX_PCT = 35;

/* ── Agua por consistencia (Fase 3) ──────────────────────────────────────────
   En RDC el agua la gobierna la consistencia objetivo, NO el f'c (Segerer 2017;
   AAHE N°16 "Experiencias Concretas": el método de diseño fija el agua "la
   suficiente para alcanzar el extendido objetivo"). No existe ecuación
   normativa agua↔consistencia; estas anclas son una ESTIMACIÓN BASE del agua
   del mortero RDC para la consistencia objetivo, calibrable por planta con un
   ÚNICO factor multiplicativo (igual criterio que el factor de ajuste de las
   curvas de cemento). Ancladas en AAHE N°16 Tabla 6 + dosificaciones reales
   (≈190 L para autocompactante a/c~1,0) + rangos Segerer. Marcado NO normativo.
   Fuera del rango de anclas se extrapola al extremo (clamp) con warning. */
const RDC_AGUA_ANCLAS = {
  // Asentamiento (cono de Abrams, cm) → agua base L/m³.
  ASENTAMIENTO: [
    { x: 12, agua: 168 }, { x: 18, agua: 182 }, { x: 22, agua: 192 },
    { x: 25, agua: 203 }, { x: 27, agua: 212 },
  ],
  // Extendido del cono (escurrimiento, cm) → agua base L/m³.
  EXTENDIDO_CONO: [
    { x: 35, agua: 175 }, { x: 44, agua: 188 }, { x: 50, agua: 200 },
    { x: 55, agua: 212 }, { x: 60, agua: 224 },
  ],
};
const RDC_CONSISTENCIA_METODOS = Object.keys(RDC_AGUA_ANCLAS);

/* Resistencia ESPERADA por contenido de cemento (CUC) — referencia
   orientativa, NO requisito. Bandas de Segerer 2017 (Tipo 1–6, kg/cm² @28d)
   contrastadas con AAHE N°16 Tabla 7 (r28 cilindro por CUC). MPa = kg/cm² ×
   0,0981. Se usa sólo si el usuario carga un f'c objetivo opcional. */
const RDC_RESISTENCIA_POR_CUC = [
  { tipo: 1, cucMin: 50,  cucMax: 90,  rMin: 0.4, rMax: 0.8 },
  { tipo: 2, cucMin: 75,  cucMax: 115, rMin: 0.9, rMax: 1.3 },
  { tipo: 3, cucMin: 110, cucMax: 170, rMin: 1.4, rMax: 2.0 },
  { tipo: 4, cucMin: 150, cucMax: 210, rMin: 2.1, rMax: 2.9 },
  { tipo: 5, cucMin: 180, cucMax: 240, rMin: 3.0, rMax: 4.0 },
  { tipo: 6, cucMin: 240, cucMax: 400, rMin: 4.0, rMax: 8.0 },
];

/** Agua base del mortero RDC para una consistencia objetivo (interpolación
 *  lineal sobre las anclas, clamp fuera de rango). Pura. */
function aguaBaseDesdeConsistencia(metodo, valorCm) {
  const anclas = RDC_AGUA_ANCLAS[metodo];
  if (!anclas || valorCm == null || !Number.isFinite(Number(valorCm))) return null;
  const v = Number(valorCm);
  if (v <= anclas[0].x) return { agua: anclas[0].agua, clamp: v < anclas[0].x ? 'min' : null };
  const last = anclas[anclas.length - 1];
  if (v >= last.x) return { agua: last.agua, clamp: v > last.x ? 'max' : null };
  for (let i = 0; i < anclas.length - 1; i++) {
    const a = anclas[i], b = anclas[i + 1];
    if (v >= a.x && v <= b.x) {
      return { agua: Math.round(lerp(v, a.x, a.agua, b.x, b.agua) * 10) / 10, clamp: null };
    }
  }
  return null;
}

/** Banda de resistencia esperada (MPa) para un CUC dado. Pura. */
function resistenciaEsperadaPorCUC(cementoKgM3) {
  const c = Number(cementoKgM3);
  if (!Number.isFinite(c) || c <= 0) return null;
  // Banda más estrecha cuyo rango de cemento contiene el CUC; si cae en varias
  // (los rangos Segerer se solapan), se toma la de tipo más alto que aplica.
  const matches = RDC_RESISTENCIA_POR_CUC.filter(b => c >= b.cucMin && c <= b.cucMax);
  const band = matches.length ? matches[matches.length - 1]
    : (c < RDC_RESISTENCIA_POR_CUC[0].cucMin ? RDC_RESISTENCIA_POR_CUC[0]
      : RDC_RESISTENCIA_POR_CUC[RDC_RESISTENCIA_POR_CUC.length - 1]);
  return { tipo: band.tipo, rMin: band.rMin, rMax: band.rMax };
}

/**
 * Interpolación lineal helper.
 */
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Estima resistencia (MPa) a partir de relación a/c y curva del cemento.
 * Inversa de `estimarACdesdeCurvaCemento`. La curva tiene dos posibles fuentes:
 *
 *   - `puntos[]`: tabla {edadDias, resistenciaMpa, relacionAc} → interpolar a/c → f'c.
 *   - `abrams[]`: parámetros Ley de Abrams f'c = A / B^(a/c).
 *
 * Si la a/c queda fuera del rango cubierto por la tabla, se usa el punto
 * más cercano y se devuelve `extrapolacion: true` con un warning. La
 * función es pura: no toca DB ni HTTP.
 *
 * @param {Object} curvaCemento  - { puntos[], abrams[], nombre }
 * @param {number} ac            - relación a/c objetivo
 * @param {number} edadDias      - 28 típico
 * @returns {{ resistenciaMpa, metodo, curvaNombre, warning?, extrapolacion? } | null}
 */
function estimarResistenciaDesdeAC(curvaCemento, ac, edadDias) {
  if (!curvaCemento || ac == null || !Number.isFinite(Number(ac)) || Number(ac) <= 0) return null;

  const acNum = Number(ac);
  const curvaNombre = curvaCemento.nombre;

  // Prioridad 1: tabla puntos
  const puntos = (curvaCemento.puntos || [])
    .filter(p => Number(p.edadDias) === edadDias)
    .sort((a, b) => Number(a.relacionAc) - Number(b.relacionAc));

  if (puntos.length >= 2) {
    const exact = puntos.find(p => Math.abs(Number(p.relacionAc) - acNum) < 0.005);
    if (exact) {
      return {
        resistenciaMpa: Math.round(Number(exact.resistenciaMpa) * 10) / 10,
        metodo: 'TABLA_DIRECTO',
        curvaNombre,
      };
    }

    for (let i = 0; i < puntos.length - 1; i++) {
      const ac1 = Number(puntos[i].relacionAc);
      const ac2 = Number(puntos[i + 1].relacionAc);
      if ((ac1 <= acNum && acNum <= ac2) || (ac2 <= acNum && acNum <= ac1)) {
        const fc = lerp(acNum, ac1, Number(puntos[i].resistenciaMpa), ac2, Number(puntos[i + 1].resistenciaMpa));
        return {
          resistenciaMpa: Math.round(fc * 10) / 10,
          metodo: 'TABLA_INTERPOLACION',
          curvaNombre,
        };
      }
    }

    // Fuera del rango → punto más cercano
    const nearest = puntos.reduce((best, p) =>
      Math.abs(Number(p.relacionAc) - acNum) < Math.abs(Number(best.relacionAc) - acNum) ? p : best
    );
    return {
      resistenciaMpa: Math.round(Number(nearest.resistenciaMpa) * 10) / 10,
      metodo: 'TABLA_EXTRAPOLACION',
      curvaNombre,
      extrapolacion: true,
      warning: `a/c ${acNum.toFixed(3)} fuera del rango de la curva del cemento; se usó el punto más cercano (a/c ${Number(nearest.relacionAc).toFixed(3)} → ${Number(nearest.resistenciaMpa)} MPa).`,
    };
  }

  // Prioridad 2: parámetros Abrams
  const abramsRows = (curvaCemento.abrams || []).filter(r => Number(r.edadDias) === edadDias);
  if (abramsRows.length > 0) {
    const a = Number(abramsRows[0].parametroA);
    const b = Number(abramsRows[0].parametroB);
    if (a > 0 && b > 1) {
      // f'c = A / B^(a/c)
      const fc = a / Math.pow(b, acNum);
      if (Number.isFinite(fc) && fc > 0) {
        return {
          resistenciaMpa: Math.round(fc * 10) / 10,
          metodo: 'ABRAMS_FALLBACK',
          curvaNombre,
          warning: 'No hay tabla a/c-resistencia para esta edad; se usaron parámetros Abrams A/B.',
        };
      }
    }
  }

  return null;
}

/**
 * Inversa de `estimarResistenciaDesdeAC`: dada una resistencia objetivo (MPa)
 * y la curva de cemento de la planta (con su factor de ajuste ya aplicado),
 * devuelve la relación a/c necesaria. Es el corazón del modelo RDC: el agua
 * sale de `a/c × cemento`, y la a/c sale de la resistencia objetivo contra la
 * curva real de la planta (no de un Ábaco de asentamiento).
 *
 * Prioridad: tabla `puntos[]` (interpolación sobre f'c) → parámetros `abrams[]`
 * (a/c = ln(A/f'c)/ln(B)). Fuera del rango de la tabla: punto más cercano +
 * warning (mismo criterio que la función directa). Pura: sin DB/HTTP.
 *
 * @param {Object} curvaCemento - { puntos[], abrams[], nombre }
 * @param {number} fcMpa        - resistencia objetivo en MPa
 * @param {number} edadDias     - edad de la curva (28 típico)
 * @returns {{ ac, metodo, curvaNombre, extrapolacion?, warning? } | null}
 */
function estimarACDesdeResistencia(curvaCemento, fcMpa, edadDias) {
  if (!curvaCemento || fcMpa == null || !Number.isFinite(Number(fcMpa)) || Number(fcMpa) <= 0) return null;
  const fc = Number(fcMpa);
  const curvaNombre = curvaCemento.nombre;

  // Prioridad 1: tabla de puntos {edadDias, resistenciaMpa, relacionAc}.
  const puntos = (curvaCemento.puntos || [])
    .filter(p => Number(p.edadDias) === edadDias && Number(p.relacionAc) > 0 && Number(p.resistenciaMpa) > 0)
    .sort((a, b) => Number(a.relacionAc) - Number(b.relacionAc));

  if (puntos.length >= 2) {
    const exact = puntos.find(p => Math.abs(Number(p.resistenciaMpa) - fc) < 0.05);
    if (exact) {
      return {
        ac: Math.round(Number(exact.relacionAc) * 1000) / 1000,
        metodo: 'TABLA_DIRECTO', curvaNombre,
      };
    }
    // f'c decrece monótonamente al crecer a/c: buscamos el par que encuadra fc.
    for (let i = 0; i < puntos.length - 1; i++) {
      const r1 = Number(puntos[i].resistenciaMpa);
      const r2 = Number(puntos[i + 1].resistenciaMpa);
      if ((r1 >= fc && fc >= r2) || (r2 >= fc && fc >= r1)) {
        const ac = lerp(fc, r1, Number(puntos[i].relacionAc), r2, Number(puntos[i + 1].relacionAc));
        return {
          ac: Math.round(ac * 1000) / 1000,
          metodo: 'TABLA_INTERPOLACION', curvaNombre,
        };
      }
    }
    // Fuera del rango de resistencias de la curva → punto más cercano.
    const nearest = puntos.reduce((best, p) =>
      Math.abs(Number(p.resistenciaMpa) - fc) < Math.abs(Number(best.resistenciaMpa) - fc) ? p : best
    );
    return {
      ac: Math.round(Number(nearest.relacionAc) * 1000) / 1000,
      metodo: 'TABLA_EXTRAPOLACION', curvaNombre, extrapolacion: true,
      warning: `f'c objetivo ${fc} MPa fuera del rango de la curva del cemento; se usó el punto más cercano (f'c ${Number(nearest.resistenciaMpa)} MPa → a/c ${Number(nearest.relacionAc).toFixed(3)}).`,
    };
  }

  // Prioridad 2: parámetros Abrams f'c = A / B^(a/c) → a/c = ln(A/f'c)/ln(B).
  const abramsRows = (curvaCemento.abrams || []).filter(r => Number(r.edadDias) === edadDias);
  if (abramsRows.length > 0) {
    const a = Number(abramsRows[0].parametroA);
    const b = Number(abramsRows[0].parametroB);
    if (a > 0 && b > 1 && fc > 0 && a / fc > 0) {
      const ac = Math.log(a / fc) / Math.log(b);
      if (Number.isFinite(ac) && ac > 0) {
        return {
          ac: Math.round(ac * 1000) / 1000,
          metodo: 'ABRAMS_FALLBACK', curvaNombre,
          warning: 'No hay tabla resistencia-a/c para esta edad; se usaron parámetros Abrams A/B.',
        };
      }
    }
  }

  return null;
}

/**
 * Replica del modelo de factor de dosis del ICPA. Mantenida acá local para
 * no atar este engine al export interno del hormiqualCalcEngine. El comportamiento
 * es exactamente el mismo: 0% bajo min → 30% en min → 100% en rec → 140% en
 * max → cap 140%.
 */
function calcularFactorDosis(dosisUsada, dosisMin, dosisRec, dosisMax) {
  if (!dosisMin || !dosisRec || !dosisMax || dosisRec <= 0) {
    return { factor: 1.0, advertencia: null };
  }
  if (dosisUsada < dosisMin) {
    return {
      factor: 0,
      advertencia: { nivel: 'critica', mensaje: `Dosis ${dosisUsada}% inferior a mínima (${dosisMin}%). Sin efecto.` },
    };
  }
  if (dosisUsada <= dosisRec) {
    const t = (dosisUsada - dosisMin) / (dosisRec - dosisMin);
    return { factor: 0.30 + t * 0.70, advertencia: null };
  }
  if (dosisUsada <= dosisMax) {
    const t = (dosisUsada - dosisRec) / (dosisMax - dosisRec);
    return { factor: 1.00 + t * 0.40, advertencia: null };
  }
  return {
    factor: 1.40,
    advertencia: { nivel: 'advertencia', mensaje: `Dosis ${dosisUsada}% supera la máxima (${dosisMax}%). Efecto limitado a 140%.` },
  };
}

/**
 * Identifica el aditivo espumígeno entre un set de aditivos cargados.
 * Acepta tanto `tipoFuncional='ESPUMIGENO'` como `modoEfecto='ESPUMIGENO'`
 * (datos legacy pueden venir con uno u otro).
 */
function esEspumigeno(ad) {
  if (!ad) return false;
  return ad.tipoFuncional === 'ESPUMIGENO' || ad.modoEfecto === 'ESPUMIGENO';
}

/**
 * Etiqueta HRDC-{cemento} a partir del contenido de cemento.
 * Redondea a la decena más cercana para identificación humana
 * (ej: 152 → HRDC-150, 178 → HRDC-180).
 */
function etiquetaHRDC(cementoKgM3) {
  if (!cementoKgM3 || cementoKgM3 <= 0) return null;
  const redondeado = Math.round(cementoKgM3 / 10) * 10;
  return `HRDC-${redondeado}`;
}

/**
 * Cálculo principal de dosificación HRDC.
 *
 * @param {Object} params
 * @param {number} params.cementoKgM3 - Contenido de cemento por m³ (input directo, 50–400).
 * @param {Object} params.cemento - { densidadRelativa, nombreComercial?, ... }
 * @param {number} params.moduloFinura - MF de la mezcla (dominio Ábaco 1: 3.0–6.5).
 * @param {string} [params.formaAgregado] - 'CANTO_RODADO' | 'TRITURADO' | 'MIXTO'. Default 'TRITURADO'.
 * @param {number} params.densidadAgregadoSSSKgM3 - Densidad SSS ponderada de la mezcla (kg/m³). Típico arena ≈ 2600.
 * @param {Array<Object>} [params.composicionMezcla] - [{ tipo: 'AF'|'AG', pctEnMezcla, densidadSSSKgM3, descripcion? }]
 * @param {Array<Object>} params.abacoCurvasReferencia - Filas del Ábaco 1 (CANTO_RODADO/TRITURADO/MIXTO).
 * @param {Object} params.aditivoEspumigeno - OBLIGATORIO. { id, dosis, dosisMinima, dosisHabitual, dosisMaxima, aireIncorporadoPctEsperado, densidad?, descripcion? }
 * @param {Array<Object>} [params.aditivosAux] - Plastificantes, reductores. Cada uno: { id, dosis, densidad?, descripcion? }
 * @param {number} [params.tmnMm] - Para warning blando si > TMN_TIPICO_HRDC_MM.
 * @param {number} [params.densidadObjetivoKgM3] - Opcional. Si presente, compara contra densidad calculada.
 * @param {number} [params.fceInformativoMPa] - Opcional. No se valida.
 * @param {Object} [params.context] - Etiquetas para trazabilidad: { cementoNombre, mezclaNombre, espumigenoNombre }
 *
 * @returns {Object} {
 *   etiqueta, cementoKgM3, aguaKgM3, agregadosKgM3, agregadosDetalle, aditivos,
 *   aireIncorporadoPct, ac, densidadFrescaCalc, volumenes, warnings,
 *   fuentesCalculo, trazabilidad
 * }
 */
function calcularDosificacionHRDC(params) {
  const warnings = [];
  const fuentesCalculo = [];
  const trazabilidad = {
    metodoCalculo: 'HRDC',
    motorVersion: MOTOR_VERSION,
    modeloCalculoLabel: MODELO_CALCULO_LABEL,
    inputs: { ...params, abacoCurvasReferencia: undefined },
  };
  trazabilidad.fuentesCalculo = fuentesCalculo;

  const {
    cementoKgM3,
    cemento = {},
    moduloFinura,
    formaAgregado = 'TRITURADO',
    densidadAgregadoSSSKgM3,
    composicionMezcla = null,
    abacoCurvasReferencia = [],
    aditivoEspumigeno,
    aditivosAux = [],
    tmnMm,
    densidadObjetivoKgM3,
    fceObjetivoMPa,
    fceInformativoMPa,
    curvaCemento = null,
    edadResistenciaDias = 28,
    reduccionPctRDC = RDC_REDUCCION_PCT_DEFAULT,
    puvToleranciaKgM3,
    // Fase 3 — el agua la gobierna la consistencia objetivo (NO el f'c).
    consistenciaMetodoRDC,          // 'ASENTAMIENTO' | 'EXTENDIDO_CONO'
    consistenciaValorRDC,           // cm
    factorAguaConsistenciaRDC,      // calibración por planta (único factor, default 1)
    context = {},
  } = params;

  const factorAgua = (factorAguaConsistenciaRDC != null && Number(factorAguaConsistenciaRDC) > 0)
    ? Number(factorAguaConsistenciaRDC)
    : 1;
  const metodoConsist = RDC_CONSISTENCIA_METODOS.includes(String(consistenciaMetodoRDC))
    ? String(consistenciaMetodoRDC)
    : null;

  // Tolerancia de control del PUV: parámetro por planta (Fase 2) con fallback
  // a la constante citada (Segerer 2017: ±80 kg/m³).
  const puvToleranciaEff = (puvToleranciaKgM3 != null && Number(puvToleranciaKgM3) > 0)
    ? Number(puvToleranciaKgM3)
    : RDC_PUV_TOLERANCIA_KGM3;

  // f'c objetivo: en RDC es OPCIONAL (Fase 3). El cálculo NO depende de él
  // (lo gobierna el CUC + consistencia). Si el usuario lo carga, se usa sólo
  // para una verificación orientativa contra la resistencia esperada del CUC.
  const fcObjetivo = (fceObjetivoMPa != null && Number(fceObjetivoMPa) > 0)
    ? Number(fceObjetivoMPa)
    : (fceInformativoMPa != null && Number(fceInformativoMPa) > 0 ? Number(fceInformativoMPa) : null);

  /* ── 1. Validaciones bloqueantes ───────────────────────────────────────── */
  if (!cementoKgM3 || cementoKgM3 <= 0) {
    warnings.push({ campo: 'cementoKgM3', tipo: 'error', msg: 'Cemento por m³ requerido para HRDC.' });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  if (cementoKgM3 < CEMENTO_MIN_KGM3 || cementoKgM3 > CEMENTO_MAX_KGM3) {
    warnings.push({
      campo: 'cementoKgM3', tipo: 'error',
      msg: `Cemento ${cementoKgM3} kg/m³ fuera del rango HRDC permitido (${CEMENTO_MIN_KGM3}–${CEMENTO_MAX_KGM3}).`,
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  if (!aditivoEspumigeno || !esEspumigeno(aditivoEspumigeno)) {
    warnings.push({
      campo: 'aditivoEspumigeno', tipo: 'error',
      msg: 'HRDC requiere aditivo espumígeno (tipoFuncional=ESPUMIGENO). No se cargó ninguno.',
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const dosisEspum = Number(aditivoEspumigeno.dosis) || 0;
  if (dosisEspum <= 0) {
    warnings.push({
      campo: 'aditivoEspumigeno', tipo: 'error',
      msg: 'El espumígeno cargado no tiene dosis > 0.',
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const aireRefEspum = Number(aditivoEspumigeno.aireIncorporadoPctEsperado) || 0;
  if (aireRefEspum <= 0) {
    warnings.push({
      campo: 'aditivoEspumigeno', tipo: 'error',
      msg: 'El espumígeno cargado no declara aire incorporado esperado (%) > 0.',
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  // Modelo RDC Fase 3: el CUC (cemento, input) gobierna la resistencia y el
  // agua la gobierna la CONSISTENCIA objetivo. Por eso la consistencia es
  // REQUERIDA y el f'c es OPCIONAL (a veces el RDC es sólo relleno sin
  // requisito de resistencia). La curva de cemento ya no es necesaria.
  if (!metodoConsist || consistenciaValorRDC == null || !(Number(consistenciaValorRDC) > 0)) {
    warnings.push({
      campo: 'consistencia', tipo: 'error',
      msg: 'HRDC requiere la consistencia objetivo (asentamiento o extendido de cono, en cm): de ella se deriva el agua del RDC.',
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  // MF ya NO gobierna el agua en RDC (antes alimentaba el Ábaco). Se acepta
  // como dato informativo; si falta no se aborta.
  const moduloFinuraEfectivo = (moduloFinura != null && Number(moduloFinura) > 0) ? Number(moduloFinura) : null;
  if (!densidadAgregadoSSSKgM3 || densidadAgregadoSSSKgM3 <= 0) {
    warnings.push({
      campo: 'densidadAgregadoSSSKgM3', tipo: 'error',
      msg: 'Densidad SSS ponderada de la mezcla requerida.',
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Tipología', valor: 'HRDC', origenTipo: 'INPUT_USUARIO',
    regla: 'Hormigón celular de Resistencia y Densidad Controlada (tipología HRDC).',
  });

  /* ── 2. Validaciones blandas ──────────────────────────────────────────── */
  if (tmnMm != null && Number(tmnMm) > TMN_TIPICO_HRDC_MM) {
    warnings.push({
      campo: 'tmn', tipo: 'advertencia',
      msg: `TMN ${tmnMm} mm superior al típico HRDC (${TMN_TIPICO_HRDC_MM} mm). HRDC suele dosificarse con arena fina sin agregado grueso o con TMN ≤ 9.5 mm.`,
    });
  }
  if (composicionMezcla && Array.isArray(composicionMezcla)) {
    const tieneAG = composicionMezcla.some(c => c.tipo === 'AG' && Number(c.pctEnMezcla) > 0);
    if (tieneAG) {
      warnings.push({
        campo: 'mezcla', tipo: 'info',
        msg: 'La mezcla declara agregado grueso. HRDC se confecciona habitualmente sin AG; el cálculo lo respeta pero verificar que es deliberado.',
      });
    }
  }

  /* ── 3. Cemento — input directo ────────────────────────────────────────── */
  const densidadCementoGcm3 = Number(cemento.densidadRelativa) || DENSIDAD_CEMENTO_DEFAULT_GCM3;
  const cementoKg = cementoKgM3;
  const volCementoLM3 = cementoKg / densidadCementoGcm3; // L/m³

  pushFuente(fuentesCalculo, {
    parametro: 'Cemento (input directo)',
    valor: `${cementoKg} kg/m³`,
    origenTipo: 'INPUT_USUARIO',
    origenRef: context.cementoNombre || null,
    regla: "En HRDC el contenido de cemento es un dato de entrada del usuario (se refleja en la etiqueta HRDC-{cemento}). No se deriva de f'c.",
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Densidad del cemento',
    valor: `${densidadCementoGcm3} g/cm³`,
    origenTipo: cemento.densidadRelativa ? 'MATERIAL' : 'DEFAULT',
    regla: cemento.densidadRelativa
      ? 'Densidad relativa cargada en la ficha del cemento.'
      : `Sin dato en la ficha; se asumió default ${DENSIDAD_CEMENTO_DEFAULT_GCM3} g/cm³.`,
    criticidad: cemento.densidadRelativa ? 'INFO' : 'WARNING',
  });

  /* ── 4. Agua = f(consistencia objetivo) × factor de planta (Fase 3) ──────
     Modelo RDC (Segerer 2017 / AAHE N°16): el agua la gobierna la consistencia
     objetivo, NO el f'c. Anclas internas (estimación base, NO normativa) +
     único factor multiplicativo calibrable por planta (mismo criterio que el
     factor de ajuste de las curvas de cemento). a/c = consecuencia. */
  const aguaResp = aguaBaseDesdeConsistencia(metodoConsist, consistenciaValorRDC);
  if (!aguaResp || aguaResp.agua == null) {
    warnings.push({
      campo: 'agua', tipo: 'error',
      msg: `No se pudo estimar el agua para la consistencia objetivo (${metodoConsist} ${consistenciaValorRDC} cm).`,
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const aguaBaseConsist = aguaResp.agua;
  const aguaKgM3 = Math.round(aguaBaseConsist * factorAgua * 10) / 10;
  const aguaBase = aguaKgM3;            // Opción A: el plastificante no reduce el agua de diseño
  const volAguaLM3 = aguaKgM3;          // 1 kg agua = 1 L
  const ac = Math.round((aguaKgM3 / cementoKg) * 1000) / 1000;
  const metodoAgua = `CONSISTENCIA:${metodoConsist}`;
  const correccionesAgua = [];

  if (aguaResp.clamp) {
    warnings.push({
      campo: 'consistencia', tipo: 'advertencia',
      msg: `Consistencia objetivo (${consistenciaValorRDC} cm) fuera del rango de anclas RDC para ${metodoConsist}; el agua se estimó en el extremo (${aguaResp.clamp}). Verificar con pastón de prueba.`,
    });
  }
  pushFuente(fuentesCalculo, {
    parametro: 'Agua de diseño (por consistencia)',
    valor: `${aguaKgM3} L/m³`,
    origenTipo: 'CALCULADO',
    origenRef: 'Anclas RDC — calibrable por planta',
    regla: `agua = base(${metodoConsist} ${consistenciaValorRDC} cm)=${aguaBaseConsist} × factor planta ${factorAgua} = ${aguaKgM3} L/m³. RDC fuera de CIRSOC; modelo no normativo. Criterio adoptado: el plastificante no reduce el agua de diseño.`,
  });
  // a/c a 2 decimales con redondeo half-up robusto (toFixed(2) sobre 0.985
  // baja a "0.98" por el artefacto IEEE754; el cuerpo del informe muestra
  // 0,99). El +1e-6 cruza el límite .5 sin alterar el valor informativo.
  const acDisp = (Math.round((aguaKgM3 / cementoKg) * 100 + 1e-6) / 100).toFixed(2);
  pushFuente(fuentesCalculo, {
    parametro: 'Relación a/c (consecuencia, informativa)',
    valor: acDisp,
    origenTipo: 'CALCULADO',
    regla: `a/c = agua / cemento = ${aguaKgM3} / ${cementoKg} = ${ac.toFixed(3)} (≈ ${acDisp} a 2 decimales). En RDC la a/c es resultado, no driver (no se valida contra norma).`,
  });

  /* ── 4b. f'c — verificación orientativa OPCIONAL contra el CUC ───────────
     Si el usuario cargó un f'c objetivo, se compara con la resistencia
     ESPERADA del contenido de cemento (bandas Segerer Tipo / AAHE N°16
     Tabla 7). No condiciona el cálculo; sólo orienta. Si no se cargó f'c,
     RDC es sólo relleno: no se evalúa resistencia. */
  let resistenciaEstimada = null;
  const bandaR = resistenciaEsperadaPorCUC(cementoKg);
  if (bandaR) {
    resistenciaEstimada = {
      tipoRDC: bandaR.tipo,
      rMinMpa: bandaR.rMin,
      rMaxMpa: bandaR.rMax,
      edadDias: 28,
      objetivoMpa: fcObjetivo,
      fuente: 'Tabla de referencia RDC (interna, Tipo 1-6)',
    };
    pushFuente(fuentesCalculo, {
      parametro: `Resistencia esperada por CUC (orientativa, 28 d)`,
      valor: `${bandaR.rMin}–${bandaR.rMax} MPa (RDC Tipo ${bandaR.tipo})`,
      origenTipo: 'TABLA_REFERENCIA',
      origenRef: 'Tabla de referencia RDC (interna)',
      regla: `Con ${cementoKg} kg/m³ de cemento corresponde a RDC Tipo ${bandaR.tipo}: resistencia esperada ${bandaR.rMin}-${bandaR.rMax} MPa a 28 d. Orientativo (sin ensayos de la planta); no condiciona el cálculo.`,
    });
    if (fcObjetivo != null && fcObjetivo > bandaR.rMax) {
      warnings.push({
        campo: 'resistencia', tipo: 'advertencia',
        msg: `f'c objetivo ${fcObjetivo} MPa por encima de la resistencia esperada para ${cementoKg} kg/m³ de cemento (RDC Tipo ${bandaR.tipo}: ${bandaR.rMin}–${bandaR.rMax} MPa). Aumentar el contenido de cemento o validar con pastón de prueba.`,
      });
    }
  }

  /* ── 5. Aditivos: espumígeno + auxiliares ─────────────────────────────── */
  const aditivosCalc = [];

  // Consolidar para evitar duplicación si el mismo producto está en dos slots
  const aditivosTodos = [aditivoEspumigeno, ...(aditivosAux || [])].filter(Boolean);
  const consolidados = consolidarPorProducto(
    aditivosTodos.map(a => ({ id: a.id ?? a.idAditivo, dosis: Number(a.dosis) || 0, ...a }))
  );

  let pesoAditivosKgM3 = 0;
  let volAditivosLM3 = 0;
  let aireCapacidadEspumPct = 0;   // aire que ENTREGA la dosis de espumígeno cargada
  let espumigenoEntry = null;

  for (const ad of consolidados) {
    const dosisPct = Number(ad.dosisTotal) || Number(ad.dosis) || 0;
    if (dosisPct <= 0) continue;
    const densAd = Number(ad.densidad) || DENSIDAD_ADITIVO_DEFAULT_GCM3;
    const pesoKgM3 = (cementoKg * dosisPct) / 100;
    const volLM3 = pesoKgM3 / densAd;
    pesoAditivosKgM3 += pesoKgM3;
    volAditivosLM3 += volLM3;

    const tipoFlag = esEspumigeno(ad) ? 'ESPUMIGENO' : (ad.tipoFuncional || 'AUXILIAR');
    const nombre = ad.descripcion || ad.nombre || ad.marca || `Aditivo ${ad.id}`;
    const dosisPctR = Math.round(dosisPct * 100) / 100;
    const pesoKgM3R = Math.round(pesoKgM3 * 100) / 100;
    const entry = {
      id: ad.id ?? ad.idAditivo,
      tipoFuncional: tipoFlag,
      descripcion: nombre,
      dosisPct: dosisPctR,
      pesoKgM3: pesoKgM3R,
      volumenLM3: Math.round(volLM3 * 100) / 100,
      // Shape canónico compartido con hormiqualCalcEngine.aditivos: lo consumen la
      // tabla de resultado del diseño y los PDFs. Sin estos alias el HRDC
      // mostraba "Aditivo (undefined)" y cantidad vacía. La dosis HRDC es
      // siempre % sobre cemento.
      label: nombre,
      dosis: dosisPctR,
      kgM3: pesoKgM3R,
      unidad: 'PORC_SOBRE_CEMENTO',
      unidadLabel: '% sobre cemento',
    };
    aditivosCalc.push(entry);

    if (tipoFlag === 'ESPUMIGENO') {
      const dosisMin = Number(ad.dosisMinima) || 0;
      const dosisRec = Number(ad.dosisHabitual) || Number(ad.dosisMaxima) || dosisPct;
      const dosisMax = Number(ad.dosisMaxima) || dosisRec;
      const { factor, advertencia } = calcularFactorDosis(dosisPct, dosisMin, dosisRec, dosisMax);
      const aireRef = Number(ad.aireIncorporadoPctEsperado) || 0;
      aireCapacidadEspumPct = Math.round(aireRef * factor * 100) / 100;
      entry.aireIncorporadoPct = aireCapacidadEspumPct;   // capacidad de la dosis cargada
      entry.factorDosis = Math.round(factor * 100) / 100;
      espumigenoEntry = entry;

      pushFuente(fuentesCalculo, {
        parametro: 'Aire — capacidad del espumígeno (dosis cargada)',
        valor: `${aireCapacidadEspumPct} %`,
        origenTipo: 'CALCULADO',
        origenRef: context.espumigenoNombre || entry.descripcion,
        regla: `Capacidad = aireRef × factor(dosis) = ${aireRef}% × ${factor.toFixed(2)} = ${aireCapacidadEspumPct}% (dosis ${dosisPct}%, rec. ${dosisRec}%). El aire de diseño se fija por la densidad objetivo y se verifica contra esta capacidad.`,
      });
      if (advertencia) {
        warnings.push({ campo: 'aditivoEspumigeno', tipo: advertencia.nivel === 'critica' ? 'error' : 'advertencia', msg: advertencia.mensaje });
      }
    }
  }

  if (!espumigenoEntry) {
    // Defensa: ya validamos arriba que hay espumígeno con dosis > 0, pero por
    // si la consolidación lo perdió.
    warnings.push({ campo: 'aditivoEspumigeno', tipo: 'error', msg: 'Espumígeno no calculado tras consolidación.' });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }

  /* ── 6. Densidad objetivo gobierna: resolver arena (cierre de masa) y
     aire (cierre de volumen) ─────────────────────────────────────────────
     Modelo RDC: la densidad (PUV) es la especificación primaria. Con C, agua
     (a/c) y aditivos ya fijos, la arena se obtiene por cierre de masa para
     llegar al PUV objetivo y el aire por cierre de volumen. La palanca física
     real es la espuma; se verifica que la dosis de espumígeno pueda entregar
     el aire requerido. Fuente: Segerer 2017 / AAHE-Becker 2013. */
  const densArenaKgL = densidadAgregadoSSSKgM3 / 1000; // kg/L

  // (a) Mortero base SIN aire intencional → densidad de referencia.
  const volArenaBaseLM3 = 1000 - volCementoLM3 - volAguaLM3 - volAditivosLM3;
  if (volArenaBaseLM3 <= 0) {
    warnings.push({
      campo: 'volumetria', tipo: 'error',
      msg: `Sin aire, el cemento+agua+aditivos ya ocupan ${Math.round(1000 - volArenaBaseLM3)} L/m³ (≥1000). Revisar cemento/a/c.`,
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const masaArenaBaseKgM3 = volArenaBaseLM3 * densArenaKgL;
  const densidadMorteroBaseKgM3 = Math.round(cementoKg + aguaKgM3 + masaArenaBaseKgM3 + pesoAditivosKgM3);

  // (b) PUV objetivo: input explícito (modo PUV_OBJETIVO) o, por defecto,
  //     reducción % sobre el mortero base (modo REDUCCION_PCT).
  let puvObjetivoKgM3, modoPuv;
  if (densidadObjetivoKgM3 != null && densidadObjetivoKgM3 > 0) {
    puvObjetivoKgM3 = Math.round(densidadObjetivoKgM3);
    modoPuv = 'PUV objetivo (ingresado por el usuario)';
  } else {
    const red = Number(reduccionPctRDC) > 0 ? Number(reduccionPctRDC) : RDC_REDUCCION_PCT_DEFAULT;
    puvObjetivoKgM3 = Math.round(densidadMorteroBaseKgM3 * (1 - red / 100));
    modoPuv = `Reducción ${red}% sobre mortero base ${densidadMorteroBaseKgM3} kg/m³`;
  }
  pushFuente(fuentesCalculo, {
    parametro: 'PUV objetivo (densidad fresca)',
    valor: `${puvObjetivoKgM3} kg/m³`,
    origenTipo: densidadObjetivoKgM3 ? 'INPUT_USUARIO' : 'PARAMETRO_MODELO',
    regla: `Modo ${modoPuv}. Rango habitual: 1550–1800 kg/m³ (default ${RDC_PUV_OBJETIVO_DEFAULT_KGM3}).`,
  });

  // (c) Arena por cierre de MASA para alcanzar el PUV objetivo.
  const masaAgregadosKgM3 = Math.round((puvObjetivoKgM3 - cementoKg - aguaKgM3 - pesoAditivosKgM3) * 100) / 100;
  if (masaAgregadosKgM3 <= 0) {
    warnings.push({
      campo: 'densidad', tipo: 'error',
      msg: `PUV objetivo ${puvObjetivoKgM3} kg/m³ demasiado bajo: cemento+agua+aditivos ya pesan ${Math.round(cementoKg + aguaKgM3 + pesoAditivosKgM3)} kg/m³. Aumentar el PUV objetivo o reducir el cemento.`,
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const volArenaLM3 = (masaAgregadosKgM3 / densArenaKgL);

  // (d) Aire por cierre de VOLUMEN.
  const volAireLM3 = 1000 - volCementoLM3 - volAguaLM3 - volArenaLM3 - volAditivosLM3;
  if (volAireLM3 < 0) {
    warnings.push({
      campo: 'densidad', tipo: 'error',
      msg: `PUV objetivo ${puvObjetivoKgM3} kg/m³ demasiado alto para esta arena/cemento: no queda volumen para aire (faltan ${Math.abs(Math.round(volAireLM3))} L/m³). Reducir el PUV objetivo o cambiar la arena.`,
    });
    return _abortar(trazabilidad, warnings, fuentesCalculo);
  }
  const aireIncorporadoPct = Math.round((volAireLM3 / 1000) * 100 * 100) / 100;
  const volAgregadosLM3 = volArenaLM3;

  pushFuente(fuentesCalculo, {
    parametro: 'Arena (cierre de masa) y aire (cierre de volumen)',
    valor: `arena ${masaAgregadosKgM3} kg/m³ · aire ${aireIncorporadoPct} %`,
    origenTipo: 'CALCULADO',
    regla: `arena = PUV - cemento - agua - aditivos = ${puvObjetivoKgM3} - ${cementoKg} - ${aguaKgM3} - ${Math.round(pesoAditivosKgM3 * 100) / 100}. aire = (1000 - volumen de sólidos) = ${aireIncorporadoPct}%.`,
  });

  // (e) Verificaciones del aire vs Segerer 2017 (20–35%) y vs la capacidad
  //     real de la dosis de espumígeno cargada.
  if (aireIncorporadoPct < RDC_AIRE_MIN_PCT || aireIncorporadoPct > RDC_AIRE_MAX_PCT) {
    warnings.push({
      campo: 'aire', tipo: 'advertencia',
      msg: `Aire requerido ${aireIncorporadoPct}% fuera del rango habitual RDC ${RDC_AIRE_MIN_PCT}–${RDC_AIRE_MAX_PCT}%. Revisar PUV objetivo / cemento / a/c.`,
    });
  }
  const gapAire = Math.round((aireIncorporadoPct - aireCapacidadEspumPct) * 100) / 100;
  if (Math.abs(gapAire) > 2) {
    warnings.push({
      campo: 'aditivoEspumigeno', tipo: 'advertencia',
      // Tono neutro (no voseo) — el texto va a informes cliente-facing y
      // potenciales auditorías externas.
      msg: gapAire > 0
        ? `El aire requerido (${aireIncorporadoPct}%) supera lo que entrega la dosis de espumígeno cargada (${aireCapacidadEspumPct}%). Aumentar la dosis del espumígeno para alcanzar el PUV objetivo.`
        : `La dosis de espumígeno cargada entrega más aire (${aireCapacidadEspumPct}%) que el requerido (${aireIncorporadoPct}%). Reducir la dosis o la densidad real será menor al PUV objetivo.`,
    });
  }

  /* ── 7. Distribución por componente de la mezcla (opcional) ───────────── */
  const agregadosDetalle = [];
  if (composicionMezcla && Array.isArray(composicionMezcla) && composicionMezcla.length > 0) {
    const sumaPct = composicionMezcla.reduce((s, c) => s + (Number(c.pctEnMezcla) || 0), 0);
    if (sumaPct > 0) {
      for (const comp of composicionMezcla) {
        const pct = (Number(comp.pctEnMezcla) || 0) / sumaPct;
        const masa = Math.round(masaAgregadosKgM3 * pct * 100) / 100;
        const dens = Number(comp.densidadSSSKgM3) || densidadAgregadoSSSKgM3;
        agregadosDetalle.push({
          tipo: comp.tipo || 'AF',
          descripcion: comp.descripcion || comp.tipo || 'Agregado',
          pctEnMezcla: Number(comp.pctEnMezcla) || 0,
          masaKgM3: masa,
          volumenLM3: Math.round(((masa / dens) * 1000) * 100) / 100,
          densidadSSSKgM3: dens,
        });
      }
    }
  }
  if (agregadosDetalle.length === 0) {
    // Default: todo el agregado es arena
    agregadosDetalle.push({
      tipo: 'AF', descripcion: context.mezclaNombre || 'Arena',
      pctEnMezcla: 100, masaKgM3: masaAgregadosKgM3,
      volumenLM3: Math.round(volAgregadosLM3 * 100) / 100,
      densidadSSSKgM3: densidadAgregadoSSSKgM3,
    });
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Balance volumétrico',
    valor: `arena ${Math.round(volAgregadosLM3)} L/m³ · aire ${Math.round(volAireLM3)} L/m³`,
    origenTipo: 'CALCULADO',
    regla: `1000 = ${Math.round(volCementoLM3)} (cem.) + ${Math.round(volAguaLM3)} (agua) + ${Math.round(volAgregadosLM3)} (arena) + ${Math.round(volAireLM3)} (aire) + ${Math.round(volAditivosLM3)} (adit.)`,
  });

  /* ── 8. Densidad fresca calculada y control vs PUV objetivo ──────────── */
  const densidadFrescaCalc = Math.round(cementoKg + aguaKgM3 + masaAgregadosKgM3 + pesoAditivosKgM3);

  pushFuente(fuentesCalculo, {
    parametro: 'Densidad fresca calculada',
    valor: `${densidadFrescaCalc} kg/m³`,
    origenTipo: 'CALCULADO',
    regla: `Suma de masas = ${cementoKg} + ${aguaKgM3} + ${masaAgregadosKgM3} + ${Math.round(pesoAditivosKgM3 * 100) / 100} = ${densidadFrescaCalc} kg/m³ (objetivo ${puvObjetivoKgM3}).`,
  });

  // Control de tolerancia: Segerer 2017 → PUV no debe variar más de ±80 kg/m³
  // respecto del teórico. Por construcción densidadFrescaCalc ≈ PUV objetivo;
  // un desvío > tolerancia indica redondeos o datos inconsistentes.
  const desvioPuv = Math.abs(densidadFrescaCalc - puvObjetivoKgM3);
  if (desvioPuv > puvToleranciaEff) {
    warnings.push({
      campo: 'densidad', tipo: 'advertencia',
      msg: `Densidad calculada (${densidadFrescaCalc} kg/m³) difiere ${desvioPuv} kg/m³ del PUV objetivo (${puvObjetivoKgM3} kg/m³), supera la tolerancia de ±${puvToleranciaEff} kg/m³. Verificar datos de la mezcla.`,
    });
  }

  /* ── 9. f'c objetivo (opcional, NO gobierna en RDC Fase 3) ───────────── */
  if (fcObjetivo != null) {
    pushFuente(fuentesCalculo, {
      parametro: "f'c objetivo (opcional)",
      valor: `${fcObjetivo} MPa a ${edadResistenciaDias} d`,
      origenTipo: 'INPUT_USUARIO',
      regla: 'En RDC el f\'c es opcional y NO gobierna el cálculo. Sólo se contrasta con la resistencia esperada del contenido de cemento (orientativo).',
    });
  }

  /* ── 10. Output ───────────────────────────────────────────────────────── */
  const etiqueta = etiquetaHRDC(cementoKg);
  trazabilidad.etiqueta = etiqueta;
  trazabilidad.aireIncorporadoPct = aireIncorporadoPct;
  // En RDC/HRDC el aire es aire celular del espumígeno: por definición es
  // INTENCIONALMENTE incorporado (no aire "naturalmente atrapado"). Lo
  // declaramos explícito en la trazabilidad para que el PDF y la UI lo
  // rotulen correctamente (SSoT del tipo de aire). Fuente: Segerer 2017 /
  // AAHE N°16 — el espumígeno es la palanca física del aire por cierre de
  // volumen. No hay split atrapado/incorporado: el total ES el incorporado.
  trazabilidad.tipoAire = 'INTENCIONAL';
  trazabilidad.airePct = aireIncorporadoPct;
  trazabilidad.aireIntencionalPct = aireIncorporadoPct;
  trazabilidad.densidadFrescaCalc = densidadFrescaCalc;
  trazabilidad.ac = ac;

  // ── Shapes esperados por el PDF (sección Trazabilidad del agua, Balance volumétrico) ──
  // El motor ICPA produce trazabilidad.aguaBase como objeto. Para que el PDF
  // renderice esa sección con HRDC mantenemos el mismo shape, ahora con
  // semántica RDC Fase 3: el agua sale de la consistencia objetivo (no de un
  // Ábaco de asentamiento ni de a/c=f(f'c)).
  trazabilidad.aguaBase = {
    aguaLtsM3: aguaBase,
    metodo: metodoAgua,
    asentamientoCm: metodoConsist === 'ASENTAMIENTO' ? Number(consistenciaValorRDC) : null,
    moduloFinura: moduloFinuraEfectivo,
    moduloFinuraOriginal: null,
    formaAgregado,
    ac,
    consistenciaMetodo: metodoConsist,
    consistenciaValorCm: Number(consistenciaValorRDC),
    factorAguaPlanta: factorAgua,
    fcObjetivoMpa: fcObjetivo,
  };
  trazabilidad.aguaFinal = aguaKgM3;
  trazabilidad.correccionesAgua = correccionesAgua;
  trazabilidad.puvObjetivoKgM3 = puvObjetivoKgM3;
  trazabilidad.densidadMorteroBaseKgM3 = densidadMorteroBaseKgM3;
  trazabilidad.modoPuv = modoPuv;
  trazabilidad.correccionAditivo = (correccionesAgua || []).map(c => ({
    aditivo: c.aditivo,
    modo: 'AHORRO_AGUA',
    reduccionDeclarada: c.reduccionDeclarada,
    reduccionPct: c.reduccionPct,
    factorDosis: c.factorDosis,
    aguaAntes: c.aguaAntes,
    aguaDespues: c.aguaDespues,
  }));

  // Balance volumétrico para que el PDF lo muestre en la "Sección F — Dosificación final".
  // En HRDC el aire incorporado por espumígeno es la principal contribución al volumen.
  trazabilidad.balanceVolumenes = {
    vAgua: Math.round(volAguaLM3 * 10) / 10,
    vCemento: Math.round(volCementoLM3 * 10) / 10,
    vAire: Math.round(volAireLM3 * 10) / 10,
    vAdiciones: 0,
    vAditivos: Math.round(volAditivosLM3 * 10) / 10,
    vAgregados: Math.round(volAgregadosLM3 * 10) / 10,
    vFibras: 0,
    totalLM3: 1000,
  };

  return {
    etiqueta,
    cementoKgM3: cementoKg,
    aguaKgM3,
    agregadosKgM3: masaAgregadosKgM3,
    agregadosDetalle,
    aditivos: aditivosCalc,
    aireIncorporadoPct,
    // Aire celular del espumígeno = intencionalmente incorporado (no atrapado).
    tipoAire: 'INTENCIONAL',
    airePct: aireIncorporadoPct,
    ac,
    densidadFrescaCalc,
    densidadObjetivoKgM3: densidadObjetivoKgM3 ?? null,
    puvObjetivoKgM3,
    densidadMorteroBaseKgM3,
    modoPuv,
    consistenciaMetodoRDC: metodoConsist,
    consistenciaValorRDC: Number(consistenciaValorRDC),
    factorAguaConsistenciaRDC: factorAgua,
    fceObjetivoMPa: fcObjetivo,
    fceInformativoMPa: fceInformativoMPa ?? null,
    resistenciaEstimada,
    volumenes: {
      cementoLM3: Math.round(volCementoLM3 * 100) / 100,
      aguaLM3: volAguaLM3,
      agregadosLM3: Math.round(volAgregadosLM3 * 100) / 100,
      aireLM3: Math.round(volAireLM3 * 100) / 100,
      aditivosLM3: Math.round(volAditivosLM3 * 100) / 100,
      totalLM3: 1000,
    },
    warnings,
    fuentesCalculo,
    trazabilidad,
  };
}

function _abortar(trazabilidad, warnings, fuentesCalculo) {
  return {
    etiqueta: null,
    cementoKgM3: null,
    aguaKgM3: null,
    agregadosKgM3: null,
    agregadosDetalle: [],
    aditivos: [],
    aireIncorporadoPct: null,
    ac: null,
    densidadFrescaCalc: null,
    volumenes: null,
    warnings,
    fuentesCalculo,
    trazabilidad,
    abortado: true,
  };
}

function pushFuente(arr, item) {
  arr.push({ ...item });
}

module.exports = {
  calcularDosificacionHRDC,
  esEspumigeno,
  etiquetaHRDC,
  calcularFactorDosis,
  estimarResistenciaDesdeAC,
  estimarACDesdeResistencia,
  aguaBaseDesdeConsistencia,
  resistenciaEsperadaPorCUC,
  MOTOR_VERSION,
  TMN_TIPICO_HRDC_MM,
  CEMENTO_MIN_KGM3,
  CEMENTO_MAX_KGM3,
  RDC_REDUCCION_PCT_DEFAULT,
  RDC_PUV_OBJETIVO_DEFAULT_KGM3,
  RDC_PUV_TOLERANCIA_KGM3,
  RDC_AIRE_MIN_PCT,
  RDC_AIRE_MAX_PCT,
  RDC_CONSISTENCIA_METODOS,
};
