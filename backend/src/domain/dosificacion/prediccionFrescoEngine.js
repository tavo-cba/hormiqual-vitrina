'use strict';

/**
 * prediccionFrescoEngine.js
 *
 * V1 heurística del módulo "Predicción de comportamiento fresco del hormigón".
 *
 * Objetivo: anticipar el comportamiento esperado del hormigón fresco ANTES del
 * pastón de prueba, a partir de la dosificación calculada y la caracterización
 * de materiales disponibles. NO sustituye validación experimental.
 *
 * Filosofía de V1:
 * - Reglas heurísticas explícitas y trazables (no IA, no ML).
 * - Cada índice produce un valor numérico [0..1] y una clase ordinal.
 * - Las clases y los umbrales son los del documento funcional.
 * - El nivel de confianza se deriva de completitud de datos de entrada.
 * - Todas las afirmaciones del texto interpretativo van en modo condicional.
 *
 * Consumo: `calcularPrediccionFresco(input)` devuelve un objeto listo para
 * persistir y para consumir desde frontend/PDF.
 */

const MODEL_VERSION = 'pred-fresco-v1.0.0';

/* ════════════════════════════════════════════════════════════════════════════
   Tablas de clases ordinales
   ════════════════════════════════════════════════════════════════════════════ */

const CLASES_FLUIDEZ       = ['MUY_SECA', 'SECA', 'PLASTICA', 'MUY_PLASTICA', 'FLUIDA', 'MUY_FLUIDA'];
const CLASES_COHESION      = ['BAJA', 'MEDIA_BAJA', 'MEDIA', 'MEDIA_ALTA', 'ALTA'];
const CLASES_ESTABILIDAD   = ['INESTABLE', 'SENSIBLE', 'MODERADAMENTE_ESTABLE', 'ESTABLE'];
const CLASES_EXUDACION     = ['BAJO', 'MEDIO', 'ALTO'];
const CLASES_BOMBEABILIDAD = ['NO_RECOMENDABLE', 'CONDICIONADA', 'RAZONABLE', 'BUENA', 'MUY_BUENA'];
const CLASES_TERMINAB      = ['ASPERA', 'ACEPTABLE', 'BUENA', 'MUY_BUENA'];
const CLASES_ROBUSTEZ      = ['MUY_SENSIBLE', 'SENSIBLE', 'MEDIANAMENTE_ROBUSTA', 'ROBUSTA'];
const CLASES_CONFIANZA     = ['BAJO', 'MEDIO', 'ALTO'];

/**
 * Mapea un valor numérico [0..1] a una clase ordinal de `clases` (array en
 * orden ascendente del criterio). Usa cortes equiespaciados.
 *
 * Fix1: si v es null/NaN devuelve 'SIN_DATOS' (antes devolvía la clase del
 * medio, lo que ocultaba la falta de datos detrás de un veredicto neutral).
 */
function mapToClase(v, clases) {
  if (v == null || isNaN(v)) return 'SIN_DATOS';
  const n = clases.length;
  const clipped = Math.max(0, Math.min(1, v));
  const idx = Math.min(n - 1, Math.floor(clipped * n));
  return clases[idx];
}

/* ════════════════════════════════════════════════════════════════════════════
   Helpers numéricos
   ════════════════════════════════════════════════════════════════════════════ */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function num(v, def = null) {
  if (v == null) return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/**
 * Mapea un valor numérico a [0..1] según rango lineal por tramos.
 * cortes: [{ x, y }] ordenados por x ascendente. Interpola entre cortes.
 */
function lineMap(x, cortes) {
  if (x == null || isNaN(x)) return 0.5;
  if (x <= cortes[0].x) return cortes[0].y;
  if (x >= cortes[cortes.length - 1].x) return cortes[cortes.length - 1].y;
  for (let i = 0; i < cortes.length - 1; i++) {
    const a = cortes[i], b = cortes[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return 0.5;
}

/* ════════════════════════════════════════════════════════════════════════════
   Cálculo de índices
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Índice de fluidez esperada.
 * Depende de: asentamiento objetivo, a/c, volumen de pasta, efecto del aditivo.
 * Escala: 0 = muy seca ... 1 = muy fluida.
 */
function calcFluidez({ asentamientoMm, ac, volPastaPct, aguaLts, reduccionAguaAditivoPct, coherenciaFdA }) {
  const srcs = [];
  // Dominante: asentamiento declarado como objetivo
  if (asentamientoMm != null) {
    srcs.push({ w: 0.55, v: lineMap(asentamientoMm, [
      { x: 0,    y: 0.05 },  // <10 mm: muy seco
      { x: 50,   y: 0.25 },  // seco
      { x: 100,  y: 0.45 },  // plástico
      { x: 150,  y: 0.65 },  // muy plástico
      { x: 200,  y: 0.82 },  // fluido
      { x: 250,  y: 0.95 },  // muy fluido
    ]) });
  }
  // a/c alta → mayor fluidez
  if (ac != null) {
    srcs.push({ w: 0.15, v: lineMap(ac, [
      { x: 0.30, y: 0.10 },
      { x: 0.45, y: 0.40 },
      { x: 0.55, y: 0.60 },
      { x: 0.70, y: 0.85 },
    ]) });
  }
  // Volumen de pasta alto → mezcla más fluida (a igualdad de agua)
  if (volPastaPct != null) {
    srcs.push({ w: 0.15, v: lineMap(volPastaPct, [
      { x: 20, y: 0.20 },
      { x: 28, y: 0.50 },
      { x: 34, y: 0.75 },
      { x: 42, y: 0.90 },
    ]) });
  }
  // Aditivo con reducción de agua importante suele ir con mezclas fluidas/autocompactantes
  if (reduccionAguaAditivoPct != null && reduccionAguaAditivoPct > 0) {
    srcs.push({ w: 0.15, v: lineMap(reduccionAguaAditivoPct, [
      { x: 0,  y: 0.30 },
      { x: 10, y: 0.55 },
      { x: 20, y: 0.75 },
      { x: 30, y: 0.90 },
    ]) });
  }
  // Ancla clásica: si el FdA (Ken Day) indica que el asentamiento real tenderá
  // a ser mayor que el objetivo ("fda_alto"), el pastón saldrá más fluido de
  // lo dosificado. Sumamos señal hacia arriba. Si indica menor ("fda_bajo"),
  // empujamos hacia abajo. Mantiene consistencia con la sección J clásica.
  if (coherenciaFdA === 'fda_alto') {
    srcs.push({ w: 0.15, v: 0.75 });
  } else if (coherenciaFdA === 'fda_bajo') {
    srcs.push({ w: 0.15, v: 0.35 });
  }
  return weightedMean(srcs, 0.50);
}

/**
 * Índice de cohesión esperada.
 * Depende de: volumen de pasta vs superficie específica, continuidad granulom.,
 * finos útiles (pasa 0,075), proporción de finos.
 */
function calcCohesion({ volPastaPct, superficieEspecifica, pasa075Pond, proporcionFinos, fdt, fdg, zonaShilstone }) {
  const srcs = [];
  if (volPastaPct != null) {
    srcs.push({ w: 0.25, v: lineMap(volPastaPct, [
      { x: 18, y: 0.15 },
      { x: 26, y: 0.50 },
      { x: 32, y: 0.75 },
      { x: 38, y: 0.85 },
    ]) });
  }
  // Relación pasta / superficie específica (pasta por unidad de SE)
  if (volPastaPct != null && superficieEspecifica != null && superficieEspecifica > 0) {
    const pastaPorSE = volPastaPct / superficieEspecifica;
    srcs.push({ w: 0.20, v: lineMap(pastaPorSE, [
      { x: 0.6, y: 0.20 },
      { x: 1.0, y: 0.55 },
      { x: 1.4, y: 0.80 },
      { x: 2.0, y: 0.85 },
    ]) });
  }
  if (pasa075Pond != null) {
    srcs.push({ w: 0.15, v: lineMap(pasa075Pond, [
      { x: 0,  y: 0.25 },
      { x: 3,  y: 0.60 },
      { x: 6,  y: 0.75 },
      { x: 10, y: 0.60 }, // demasiado fino vuelve a empeorar
      { x: 15, y: 0.40 },
    ]) });
  }
  if (proporcionFinos != null) {
    srcs.push({ w: 0.15, v: lineMap(proporcionFinos, [
      { x: 20, y: 0.20 },
      { x: 35, y: 0.70 },
      { x: 45, y: 0.80 },
      { x: 55, y: 0.60 },
    ]) });
  }
  if (fdt != null) {
    srcs.push({ w: 0.15, v: lineMap(fdt, [
      { x: 25, y: 0.30 },
      { x: 33, y: 0.80 },
      { x: 38, y: 0.70 },
      { x: 45, y: 0.45 },
    ]) });
  }
  if (fdg != null) {
    // FdG muy alto (mezcla con mucho grueso) → menos cohesión
    srcs.push({ w: 0.10, v: lineMap(fdg, [
      { x: 25, y: 0.80 },
      { x: 50, y: 0.70 },
      { x: 70, y: 0.50 },
      { x: 85, y: 0.30 },
    ]) });
  }
  // Ancla Shilstone: la zona clasifica directamente el esqueleto árido.
  // Si Shilstone dice "II Deseable", el esqueleto está bien graduado;
  // otras zonas tienen compromisos conocidos. Esto evita contradicciones
  // groseras entre el predictor y el análisis clásico (ver sección J).
  if (zonaShilstone) {
    const z = String(zonaShilstone).toUpperCase();
    if (z === 'II')      srcs.push({ w: 0.15, v: 0.80 });
    else if (z === 'III') srcs.push({ w: 0.15, v: 0.70 });
    else if (z === 'I')  srcs.push({ w: 0.15, v: 0.30 });
    else if (z === 'IV') srcs.push({ w: 0.15, v: 0.45 });
    else if (z === 'V')  srcs.push({ w: 0.15, v: 0.35 });
  }
  return weightedMean(srcs, 0.55);
}

/**
 * Índice de estabilidad (inverso de riesgo de segregación).
 * Alto = estable; bajo = inestable.
 */
function calcEstabilidad({ cohesion, volPastaPct, proporcionFinos, fdg, aguaLibre, tmn }) {
  const srcs = [];
  // La cohesión es la variable dominante de la estabilidad
  if (cohesion != null) srcs.push({ w: 0.45, v: cohesion });
  if (volPastaPct != null) {
    srcs.push({ w: 0.15, v: lineMap(volPastaPct, [
      { x: 18, y: 0.25 },
      { x: 28, y: 0.70 },
      { x: 36, y: 0.75 },
    ]) });
  }
  // TMN alto con pasta baja es combo segregador
  if (tmn != null) {
    srcs.push({ w: 0.10, v: lineMap(tmn, [
      { x: 10, y: 0.85 },
      { x: 19, y: 0.75 },
      { x: 26.5, y: 0.60 },
      { x: 40, y: 0.45 },
    ]) });
  }
  if (fdg != null) {
    srcs.push({ w: 0.15, v: lineMap(fdg, [
      { x: 20, y: 0.85 },
      { x: 50, y: 0.75 },
      { x: 75, y: 0.45 },
      { x: 90, y: 0.25 },
    ]) });
  }
  // Agua libre en exceso castiga estabilidad
  if (aguaLibre != null) {
    srcs.push({ w: 0.15, v: lineMap(aguaLibre, [
      { x: 150, y: 0.85 },
      { x: 180, y: 0.70 },
      { x: 210, y: 0.45 },
      { x: 240, y: 0.25 },
    ]) });
  }
  if (proporcionFinos != null) {
    srcs.push({ w: 0.10, v: lineMap(proporcionFinos, [
      { x: 18, y: 0.30 },
      { x: 32, y: 0.70 },
      { x: 48, y: 0.75 },
      { x: 60, y: 0.55 },
    ]) });
  }
  return weightedMean(srcs, 0.60);
}

/**
 * Índice de riesgo de exudación. Alto valor = alto riesgo (no invertido).
 * 0 = bajo riesgo, 1 = alto riesgo.
 */
function calcRiesgoExudacion({ aguaLts, ac, pasa075Pond, volPastaPct, aireTotalPct, cohesion }) {
  const srcs = [];
  if (aguaLts != null) {
    srcs.push({ w: 0.30, v: lineMap(aguaLts, [
      { x: 140, y: 0.10 },
      { x: 170, y: 0.35 },
      { x: 200, y: 0.65 },
      { x: 230, y: 0.90 },
    ]) });
  }
  if (ac != null) {
    srcs.push({ w: 0.20, v: lineMap(ac, [
      { x: 0.35, y: 0.10 },
      { x: 0.50, y: 0.40 },
      { x: 0.65, y: 0.75 },
      { x: 0.80, y: 0.90 },
    ]) });
  }
  if (pasa075Pond != null) {
    // Más finos útiles → menos exudación
    srcs.push({ w: 0.20, v: lineMap(pasa075Pond, [
      { x: 0,  y: 0.80 },
      { x: 3,  y: 0.55 },
      { x: 6,  y: 0.30 },
      { x: 10, y: 0.15 },
    ]) });
  }
  if (volPastaPct != null) {
    // Pasta abundante reduce la exudación solo si no hay exceso de agua
    srcs.push({ w: 0.10, v: lineMap(volPastaPct, [
      { x: 20, y: 0.65 },
      { x: 30, y: 0.40 },
      { x: 40, y: 0.30 },
    ]) });
  }
  if (aireTotalPct != null) {
    // Aire incorporado (no atrapado) reduce riesgo
    srcs.push({ w: 0.10, v: lineMap(aireTotalPct, [
      { x: 0,  y: 0.70 },
      { x: 3,  y: 0.50 },
      { x: 6,  y: 0.30 },
    ]) });
  }
  if (cohesion != null) {
    // Cohesión alta reduce exudación
    srcs.push({ w: 0.10, v: 1.0 - cohesion });
  }
  return weightedMean(srcs, 0.50);
}

/**
 * Índice de bombeabilidad estimada.
 */
function calcBombeabilidad({ volPastaPct, cohesion, estabilidad, tmn, pasa03Pond, asentamientoMm, tipologiaBombeable }) {
  const srcs = [];
  if (volPastaPct != null) {
    srcs.push({ w: 0.20, v: lineMap(volPastaPct, [
      { x: 20, y: 0.25 },
      { x: 28, y: 0.60 },
      { x: 34, y: 0.80 },
      { x: 42, y: 0.90 },
    ]) });
  }
  if (cohesion != null) srcs.push({ w: 0.20, v: cohesion });
  if (estabilidad != null) srcs.push({ w: 0.15, v: estabilidad });
  if (tmn != null) {
    srcs.push({ w: 0.10, v: lineMap(tmn, [
      { x: 9.5,  y: 0.85 },
      { x: 19,   y: 0.80 },
      { x: 26.5, y: 0.60 },
      { x: 37.5, y: 0.35 },
    ]) });
  }
  // Pasa 0,30 mm >= 15% es la regla operativa ACI para bombeabilidad
  if (pasa03Pond != null) {
    srcs.push({ w: 0.15, v: lineMap(pasa03Pond, [
      { x: 8,  y: 0.25 },
      { x: 15, y: 0.65 },
      { x: 22, y: 0.85 },
      { x: 30, y: 0.80 },
    ]) });
  }
  if (asentamientoMm != null) {
    srcs.push({ w: 0.10, v: lineMap(asentamientoMm, [
      { x: 40,  y: 0.30 },
      { x: 100, y: 0.75 },
      { x: 150, y: 0.85 },
      { x: 220, y: 0.80 },
    ]) });
  }
  if (tipologiaBombeable) {
    srcs.push({ w: 0.10, v: 0.80 });
  }
  return weightedMean(srcs, 0.50);
}

/**
 * Índice de terminabilidad esperada.
 */
function calcTerminabilidad({ cohesion, pasa075Pond, pasa03Pond, proporcionFinos, exudacion }) {
  const srcs = [];
  if (cohesion != null) srcs.push({ w: 0.30, v: cohesion });
  if (pasa075Pond != null) {
    srcs.push({ w: 0.20, v: lineMap(pasa075Pond, [
      { x: 0,  y: 0.30 },
      { x: 3,  y: 0.60 },
      { x: 6,  y: 0.80 },
      { x: 10, y: 0.70 },
    ]) });
  }
  if (pasa03Pond != null) {
    srcs.push({ w: 0.20, v: lineMap(pasa03Pond, [
      { x: 8,  y: 0.30 },
      { x: 15, y: 0.70 },
      { x: 25, y: 0.85 },
    ]) });
  }
  if (proporcionFinos != null) {
    srcs.push({ w: 0.15, v: lineMap(proporcionFinos, [
      { x: 20, y: 0.25 },
      { x: 35, y: 0.75 },
      { x: 45, y: 0.85 },
      { x: 55, y: 0.75 },
    ]) });
  }
  if (exudacion != null) {
    // Exudación alta daña el acabado
    srcs.push({ w: 0.15, v: 1.0 - exudacion });
  }
  return weightedMean(srcs, 0.55);
}

/**
 * Índice de robustez operativa (sensibilidad a pequeñas variaciones).
 */
function calcRobustez({ volPastaPct, ac, cohesion, pasa075Pond, aguaLts, reduccionAguaAditivoPct }) {
  const srcs = [];
  if (volPastaPct != null) {
    // Volumen de pasta alto aporta robustez hasta cierto punto
    srcs.push({ w: 0.20, v: lineMap(volPastaPct, [
      { x: 18, y: 0.30 },
      { x: 28, y: 0.70 },
      { x: 34, y: 0.80 },
      { x: 42, y: 0.65 },  // pasta excesiva = sensible al agua
    ]) });
  }
  if (ac != null) {
    // a/c moderado es más robusto
    srcs.push({ w: 0.15, v: lineMap(ac, [
      { x: 0.30, y: 0.55 },
      { x: 0.45, y: 0.80 },
      { x: 0.55, y: 0.75 },
      { x: 0.70, y: 0.45 },
    ]) });
  }
  if (cohesion != null) srcs.push({ w: 0.25, v: cohesion });
  if (pasa075Pond != null) {
    srcs.push({ w: 0.15, v: lineMap(pasa075Pond, [
      { x: 0,  y: 0.35 },
      { x: 4,  y: 0.75 },
      { x: 8,  y: 0.70 },
      { x: 14, y: 0.45 },
    ]) });
  }
  if (aguaLts != null) {
    // Agua próxima a los extremos baja la robustez
    srcs.push({ w: 0.10, v: lineMap(aguaLts, [
      { x: 140, y: 0.60 },
      { x: 170, y: 0.80 },
      { x: 200, y: 0.65 },
      { x: 240, y: 0.35 },
    ]) });
  }
  if (reduccionAguaAditivoPct != null) {
    // Superplastificantes potentes bajan robustez (más sensible a sobredosis)
    srcs.push({ w: 0.15, v: lineMap(reduccionAguaAditivoPct, [
      { x: 0,  y: 0.85 },
      { x: 10, y: 0.75 },
      { x: 20, y: 0.60 },
      { x: 30, y: 0.45 },
    ]) });
  }
  return weightedMean(srcs, 0.55);
}

/**
 * Promedio ponderado de fuentes [{ w, v }].
 *
 * Fix1-prediccion-fresco: cuando NO hay fuentes (todos los inputs faltaron),
 * antes devolvía silenciosamente `defaultVal` (0.50/0.55/0.60), lo que
 * generaba scores con apariencia de veredicto real ("evaluación media") cuando
 * en realidad era "sin datos". Ahora devuelve `null` cuando no hay fuentes,
 * y los call sites lo traducen a `clase: 'SIN_DATOS'`. Si hay >=1 fuente
 * pero la cobertura es baja, se mantiene el promedio (con ese peso parcial).
 */
function weightedMean(srcs, defaultVal = 0.50) {
  if (!srcs || srcs.length === 0) return null;
  const totalW = srcs.reduce((a, s) => a + (s.w || 0), 0);
  if (totalW <= 0) return null;
  const sum = srcs.reduce((a, s) => a + (s.w || 0) * clamp01(s.v), 0);
  return clamp01(sum / totalW);
}

/* ════════════════════════════════════════════════════════════════════════════
   Nivel de confianza
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * La confianza del modelo depende de cuántos datos de entrada relevantes
 * estuvieron disponibles. Se expresa también como valor [0..1] para trazabilidad.
 */
function calcularConfianza(availableFlags) {
  const pesos = {
    granulometria:   1.5,
    tmn:             1.0,
    mf:              0.8,
    pasa075:         1.2,
    pasa030:         1.0,
    proporcionFinos: 1.0,
    fdg:             0.8,
    fdt:             0.8,
    fda:             0.6,
    superficie:      0.8,
    agua:            1.2,
    ac:              1.0,
    cemento:         0.8,
    volPasta:        1.2,
    aire:            0.5,
    forma:           0.5,
    aditivo:         0.4,
    asentamiento:    1.0,
    tipologia:       0.4,
  };
  let tot = 0, cubierto = 0;
  for (const k of Object.keys(pesos)) {
    tot += pesos[k];
    if (availableFlags[k]) cubierto += pesos[k];
  }
  const score = tot > 0 ? cubierto / tot : 0;
  let clase = 'BAJO';
  if (score >= 0.75) clase = 'ALTO';
  else if (score >= 0.50) clase = 'MEDIO';
  return { score: Math.round(score * 1000) / 1000, clase };
}

/* ════════════════════════════════════════════════════════════════════════════
   Riesgos y recomendaciones
   ════════════════════════════════════════════════════════════════════════════ */

const RIESGO_LABELS = {
  SEGREGACION:       'Riesgo de segregación',
  MEZCLA_ASPERA:     'Mezcla con tendencia áspera',
  EXCESO_FINOS:      'Exceso de finos / mezcla pegajosa',
  EXUDACION:         'Riesgo de exudación',
  BOMBEABILIDAD:     'Bombeabilidad condicionada',
  PERDIDA_TRABAJAB:  'Posible pérdida rápida de trabajabilidad',
  SENSIB_HUMEDAD:    'Sensibilidad alta a humedad de la arena',
  TERMINACION:       'Terminación pobre esperada',
};

function derivarRiesgos(indices, ctx) {
  const riesgos = [];
  const push = (codigo, mensaje) => riesgos.push({ codigo, titulo: RIESGO_LABELS[codigo] || codigo, mensaje });
  const pctStr = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

  // Los riesgos se derivan de la CLASE (no de un umbral numérico independiente)
  // para evitar que un score en zona frontera arroje una clase "Media" y un
  // riesgo "baja" al mismo tiempo. La alerta sólo se emite cuando la clase
  // cae en el extremo negativo del ordinal.
  if (['INESTABLE', 'SENSIBLE'].includes(indices.estabilidad.clase)) {
    push('SEGREGACION',
      `Estabilidad ${l(indices.estabilidad.clase)} (${pctStr(indices.estabilidad.score)}). La mezcla puede tender a segregar en transporte o descarga.`);
  }
  if (['BAJA', 'MEDIA_BAJA'].includes(indices.cohesion.clase)) {
    push('MEZCLA_ASPERA',
      `Cohesión ${l(indices.cohesion.clase)} (${pctStr(indices.cohesion.score)}). La mezcla puede comportarse áspera y exigir más esfuerzo de colocación.`);
  }
  if (ctx.pasa075Pond != null && ctx.pasa075Pond > 10) {
    push('EXCESO_FINOS',
      `Contenido de finos ponderado ${ctx.pasa075Pond.toFixed(1)}% es elevado. Puede producir mezcla pegajosa, alta demanda de agua y mayor retracción.`);
  }
  if (indices.exudacion.clase === 'ALTO') {
    push('EXUDACION',
      `Riesgo de exudación ${l(indices.exudacion.clase)} (${pctStr(indices.exudacion.score)}). Controlar ascenso de agua libre tras colado.`);
  }
  if (ctx.tipologiaBombeable && ['NO_RECOMENDABLE', 'CONDICIONADA'].includes(indices.bombeabilidad.clase)) {
    push('BOMBEABILIDAD',
      `Bombeabilidad ${l(indices.bombeabilidad.clase)} (${pctStr(indices.bombeabilidad.score)}) para una tipología bombeable. Revisar pasta y finos antes de decidir.`);
  }
  if (ctx.reduccionAguaAditivoPct != null && ctx.reduccionAguaAditivoPct > 20) {
    push('PERDIDA_TRABAJAB',
      `Aditivo con reducción de agua alta (${ctx.reduccionAguaAditivoPct.toFixed(0)}%). Controlar slump loss a 30 minutos.`);
  }
  if (['MUY_SENSIBLE', 'SENSIBLE'].includes(indices.robustez.clase)) {
    push('SENSIB_HUMEDAD',
      `Robustez operativa ${l(indices.robustez.clase)} (${pctStr(indices.robustez.score)}). La mezcla puede ser sensible a variaciones de humedad, finos o dosis de aditivo.`);
  }
  if (indices.terminabilidad && indices.terminabilidad.clase === 'ASPERA') {
    push('TERMINACION',
      `Terminabilidad ${l(indices.terminabilidad.clase)} (${pctStr(indices.terminabilidad.score)}). Evaluar ajustes de finos o dosis de aditivo si el destino exige buena terminación.`);
  }
  return riesgos;
}

function derivarRecomendaciones(indices, riesgos, ctx) {
  const recs = [];
  // Siempre primero
  recs.push('Validar con pastón de prueba antes de liberar para producción.');
  if (riesgos.some(r => r.codigo === 'SEGREGACION')) {
    recs.push('Revisar vibrado y alturas de descarga; observar segregación en el sitio de colado.');
  }
  if (riesgos.some(r => r.codigo === 'EXUDACION')) {
    recs.push('Controlar tiempo de exudación y ajustar llamado a terminación en consecuencia.');
  }
  if (riesgos.some(r => r.codigo === 'EXCESO_FINOS')) {
    recs.push('Considerar reducir pasta o aumentar la fracción intermedia para bajar la pegajosidad.');
  }
  if (riesgos.some(r => r.codigo === 'MEZCLA_ASPERA')) {
    recs.push('Evaluar incremento de finos útiles o pasta; verificar continuidad granulométrica.');
  }
  if (riesgos.some(r => r.codigo === 'BOMBEABILIDAD')) {
    recs.push('Verificar pasante 0,30 mm ≥ 15% (regla ACI) antes de comprometer bombeo.');
  }
  if (riesgos.some(r => r.codigo === 'PERDIDA_TRABAJAB')) {
    recs.push('Medir asentamiento inicial y a 30/45 minutos para caracterizar retención.');
  }
  if (riesgos.some(r => r.codigo === 'SENSIB_HUMEDAD')) {
    recs.push('Controlar humedad real de arena antes de cada bachada; evitar agregar agua en obra.');
  }
  if (ctx.requiereValidacion && !recs.some(r => r.includes('aditivo'))) {
    recs.push('Si hay cambios de marca/partida de cemento o aditivo, repetir pastón.');
  }
  return recs;
}

/* ════════════════════════════════════════════════════════════════════════════
   Texto interpretativo
   ════════════════════════════════════════════════════════════════════════════ */

const LABELS = {
  MUY_SECA: 'muy seca', SECA: 'seca', PLASTICA: 'plástica',
  MUY_PLASTICA: 'muy plástica', FLUIDA: 'fluida', MUY_FLUIDA: 'muy fluida',
  BAJA: 'baja', MEDIA_BAJA: 'media-baja', MEDIA: 'media',
  MEDIA_ALTA: 'media-alta', ALTA: 'alta',
  INESTABLE: 'inestable', SENSIBLE: 'sensible',
  MODERADAMENTE_ESTABLE: 'moderadamente estable', ESTABLE: 'estable',
  BAJO: 'bajo', MEDIO: 'medio', ALTO: 'alto',
  NO_RECOMENDABLE: 'no recomendable', CONDICIONADA: 'condicionada',
  RAZONABLE: 'razonable', BUENA: 'buena', MUY_BUENA: 'muy buena',
  ASPERA: 'áspera', ACEPTABLE: 'aceptable',
  MUY_SENSIBLE: 'muy sensible',
  MEDIANAMENTE_ROBUSTA: 'medianamente robusta', ROBUSTA: 'robusta',
  SIN_DATOS: 'sin datos suficientes',
};

function l(cl) { return LABELS[cl] || String(cl || '').toLowerCase(); }

function generarPerfilTexto(indices, confianza, ctx) {
  const parts = [];
  parts.push(
    `La dosificación presenta una trabajabilidad estimada ${l(indices.fluidez.clase)} ` +
    `con cohesión ${l(indices.cohesion.clase)} y estabilidad ${l(indices.estabilidad.clase)}.`
  );
  if (ctx.tipologiaBombeable) {
    parts.push(`Para el destino bombeable declarado, la bombeabilidad esperada es ${l(indices.bombeabilidad.clase)}.`);
  } else if (indices.bombeabilidad.score >= 0.70) {
    parts.push(`La bombeabilidad estimada es ${l(indices.bombeabilidad.clase)} aun cuando no se declaró destino bombeable.`);
  }
  if (indices.exudacion.clase === 'ALTO') {
    parts.push(`Se observa riesgo de exudación ${l(indices.exudacion.clase)}.`);
  }
  if (['MUY_SENSIBLE', 'SENSIBLE'].includes(indices.robustez.clase)) {
    parts.push(`La robustez operativa es ${l(indices.robustez.clase)}; pequeñas variaciones (humedad, finos, aditivo) pueden alterar el comportamiento.`);
  } else {
    parts.push(`La robustez operativa esperada es ${l(indices.robustez.clase)}.`);
  }

  // Puente con el análisis clásico (Shilstone/Ken Day): si la predicción
  // heurística diverge de la lectura clásica, se explicita. Evita que el
  // lector perciba "dos motores discutiendo".
  if (ctx.zonaShilstone) {
    const zonaTxt = ctx.zonaNombre ? `${ctx.zonaShilstone} — ${ctx.zonaNombre}` : `${ctx.zonaShilstone}`;
    const esDeseable = ctx.zonaShilstone === 'II' || ctx.zonaShilstone === 'III';
    const cohesionBaja = ['BAJA', 'MEDIA_BAJA'].includes(indices.cohesion.clase);
    if (esDeseable && cohesionBaja) {
      parts.push(
        `Observación de consistencia: el análisis Shilstone ubica el esqueleto árido en Zona ${zonaTxt}, ` +
        `mientras la estimación heurística sugiere cohesión ${l(indices.cohesion.clase)}. ` +
        `La diferencia suele explicarse por factores fuera del esqueleto (pasta, finos útiles, aditivo) y debe confirmarse en pastón.`
      );
    } else if (!esDeseable && !cohesionBaja) {
      parts.push(
        `Observación de consistencia: el análisis Shilstone ubica el esqueleto árido en Zona ${zonaTxt}, ` +
        `lo que suele asociarse a compromisos reológicos; sin embargo la estimación heurística arroja cohesión ${l(indices.cohesion.clase)}. ` +
        `Confirmar en pastón antes de dar por cerrado el diseño.`
      );
    } else {
      parts.push(`Consistente con el análisis clásico: Shilstone Zona ${zonaTxt}.`);
    }
  }
  if (ctx.coherenciaFdA === 'fda_alto') {
    parts.push(`Ken Day (FdA) anticipa que el asentamiento real tenderá a superar el objetivo: controlar el resultado en pastón antes de ajustar agua.`);
  } else if (ctx.coherenciaFdA === 'fda_bajo') {
    parts.push(`Ken Day (FdA) anticipa que el asentamiento real tenderá a quedar por debajo del objetivo: puede requerirse ajuste de pasta o aditivo.`);
  }

  parts.push(
    `Nivel de confianza del modelo: ${l(confianza.clase)}. ` +
    `Esta es una predicción técnica heurística; no reemplaza el pastón de prueba ni los ensayos de planta.`
  );
  return parts.join(' ');
}

/* ════════════════════════════════════════════════════════════════════════════
   API principal
   ════════════════════════════════════════════════════════════════════════════ */

/**
 * Calcula la predicción de comportamiento fresco para una dosificación.
 *
 * @param {object} input
 *   - resultado: resultado del engine de dosificación (cementoTotalKgM3, aguaLtsM3, ac, etc.)
 *   - trazabilidad: trazabilidad del engine (trabajabilidad, agregadosDistribucion, etc.)
 *   - mezcla: mezcla base (curva combinada opcional)
 *   - contexto: { asentamientoMm, tipologiaCodigo, aireTotalPct, reduccionAguaAditivoPct, ... }
 *   - aptitudMateriales: aptitud para computar pasa 0,075 ponderado
 * @returns {object} predicción completa, lista para persistir/renderizar.
 */
function calcularPrediccionFresco({ resultado, trazabilidad, mezcla, contexto = {}, aptitudMateriales, fechaCalculo } = {}) {
  const available = {};
  const take = (v, flag) => {
    if (v != null) { available[flag] = true; return num(v); }
    return null;
  };

  // ── Extracción de variables ──
  const asentamientoMm = take(contexto.asentamientoMm ?? resultado?.asentamientoMm, 'asentamiento');
  const ac             = take(resultado?.ac,           'ac');
  const aguaLts        = take(resultado?.aguaLtsM3,    'agua');
  const cementoTotal   = take(resultado?.cementoTotalKgM3 ?? resultado?.cementoKgM3, 'cemento');
  const volPastaPct    = take(resultado?.volPastaPct ?? trazabilidad?.volPastaPct, 'volPasta');
  const aireTotalPct   = take(resultado?.aireTotalPct ?? contexto.aireTotalPct, 'aire');

  // Indicadores de trabajabilidad — el shape real (viene de evaluarTrabajabilidad) es:
  //   { shilstone: { factorGrosor, factorTrabajabilidad, zona: { zona, nombre } },
  //     kenDay:    { superficieEspecifica, factorAptitud, coherencia: { estado, mensaje } },
  //     tmnMm, offsetTmn, notaDiscrepancia, ... }
  // Intentamos ambos shapes por compatibilidad con llamadas directas.
  const trab = resultado?.trabajabilidad || trazabilidad?.trabajabilidad || {};
  const fdg = take(trab.shilstone?.factorGrosor ?? trab.fdg ?? trab.factorGrosor, 'fdg');
  const fdt = take(trab.shilstone?.factorTrabajabilidad ?? trab.fdt ?? trab.factorTrabajabilidad, 'fdt');
  const fda = take(trab.kenDay?.factorAptitud ?? trab.fda ?? trab.factorAptitud, 'fda');
  const superficieEspecifica = take(trab.kenDay?.superficieEspecifica ?? trab.superficieEspecifica ?? trab.se, 'superficie');
  const tmn = take(resultado?.tmnMm ?? trab.tmnMm ?? contexto.tmnMm, 'tmn');
  const mf  = take(resultado?.moduloFinura ?? trazabilidad?.moduloFinura, 'mf');

  // Señales cualitativas del análisis clásico: zona Shilstone y coherencia FdA.
  // Las usamos como "ancla" heurística para evitar que el predictor prestacional
  // diverja groseramente del análisis Shilstone/Ken Day ya computado.
  const zonaShilstone = trab.shilstone?.zona?.zona || null;
  const zonaNombre    = trab.shilstone?.zona?.nombre || null;
  const coherenciaFdA = trab.kenDay?.coherencia?.estado || trab.coherencia?.estado || null;
  const notaDiscrepanciaClasica = trab.notaDiscrepancia || null;
  if (zonaShilstone) available.shilstone = true;
  if (coherenciaFdA) available.coherenciaFda = true;

  // Distribución de agregados — proporción de finos
  // Solo es calculable si los items declaran su tipo (FINO/GRUESO). Sin tipo,
  // devolver 0% sería engañoso (falsa señal de "ningún fino"); preferimos null
  // y que el indicador caiga a SIN_DATOS.
  const agDist = trazabilidad?.agregadosDistribucion?.items || resultado?.agregados || [];
  let proporcionFinos = null;
  if (agDist.length > 0) {
    const itemsConTipo = agDist.filter((it) => it.tipo || it.tipoAgregado);
    if (itemsConTipo.length > 0) {
      const totalKg = itemsConTipo.reduce((a, it) => a + num(it.kgM3, 0), 0);
      const finosKg = itemsConTipo
        .filter((it) => String(it.tipo || it.tipoAgregado || '').toUpperCase() === 'FINO')
        .reduce((a, it) => a + num(it.kgM3, 0), 0);
      if (totalKg > 0) proporcionFinos = (finosKg / totalKg) * 100;
    }
    available.proporcionFinos = proporcionFinos != null;
  }

  // Finos ponderados (pasa 0,075 y 0,30) desde aptitud o curva combinada.
  // Fix3-prediccion-fresco: la curva puede venir como string JSON (single o
  // double-encoded) si fue serializada en BD. Antes el parsing se rendía y
  // pasa075Pond / pasa03Pond quedaban null aunque la curva existiera.
  let pasa075Pond = null;
  let pasa03Pond = null;
  try {
    let curva = mezcla?.curvaMezclaJson || mezcla?.curvaMezcla || trazabilidad?.granulometriaCombinada;
    // Parsear hasta 2 niveles si viene como string (double-encoded en BD)
    for (let i = 0; i < 2 && typeof curva === 'string'; i++) {
      try { curva = JSON.parse(curva); } catch { curva = null; break; }
    }
    const arr = Array.isArray(curva) ? curva : (curva?.puntos || null);
    if (arr && arr.length) {
      const p075 = arr.find(p => Math.abs(num(p.aberturaMm, 0) - 0.075) < 0.01);
      const p03  = arr.find(p => Math.abs(num(p.aberturaMm, 0) - 0.30) < 0.05);
      if (p075) pasa075Pond = num(p075.pasaPct);
      if (p03)  pasa03Pond  = num(p03.pasaPct);
    }
  } catch { /* non-blocking */ }
  if (pasa075Pond != null) available.pasa075 = true;
  if (pasa03Pond != null) available.pasa030 = true;

  const reduccionAguaAditivoPct = take(contexto.reduccionAguaAditivoPct, 'aditivo');
  available.granulometria = agDist.length > 0;
  available.tipologia = !!contexto.tipologiaCodigo;
  available.forma = !!contexto.formaAgregado;

  const tipologia = String(contexto.tipologiaCodigo || '').toLowerCase();
  const tipologiaBombeable = tipologia === 'bombeable' || !!contexto.bombeable;

  // ── Cálculo secuencial (algunos dependen de otros) ──
  const iFluidez = calcFluidez({ asentamientoMm, ac, volPastaPct, aguaLts, reduccionAguaAditivoPct, coherenciaFdA });
  const iCohesion = calcCohesion({ volPastaPct, superficieEspecifica, pasa075Pond, proporcionFinos, fdt, fdg, zonaShilstone });
  const iEstabilidad = calcEstabilidad({
    cohesion: iCohesion, volPastaPct, proporcionFinos, fdg,
    aguaLibre: aguaLts, tmn,
  });
  const iExudacion = calcRiesgoExudacion({
    aguaLts, ac, pasa075Pond, volPastaPct, aireTotalPct, cohesion: iCohesion,
  });
  const iBombeabilidad = calcBombeabilidad({
    volPastaPct, cohesion: iCohesion, estabilidad: iEstabilidad, tmn,
    pasa03Pond, asentamientoMm, tipologiaBombeable,
  });
  const iTerminabilidad = calcTerminabilidad({
    cohesion: iCohesion, pasa075Pond, pasa03Pond, proporcionFinos, exudacion: iExudacion,
  });
  const iRobustez = calcRobustez({
    volPastaPct, ac, cohesion: iCohesion, pasa075Pond, aguaLts, reduccionAguaAditivoPct,
  });

  const indices = {
    fluidez:         { score: round3(iFluidez),        clase: mapToClase(iFluidez, CLASES_FLUIDEZ) },
    cohesion:        { score: round3(iCohesion),       clase: mapToClase(iCohesion, CLASES_COHESION) },
    estabilidad:     { score: round3(iEstabilidad),    clase: mapToClase(iEstabilidad, CLASES_ESTABILIDAD) },
    exudacion:       { score: round3(iExudacion),      clase: mapToClase(iExudacion, CLASES_EXUDACION) },
    bombeabilidad:   { score: round3(iBombeabilidad),  clase: mapToClase(iBombeabilidad, CLASES_BOMBEABILIDAD) },
    terminabilidad:  { score: round3(iTerminabilidad), clase: mapToClase(iTerminabilidad, CLASES_TERMINAB) },
    robustez:        { score: round3(iRobustez),       clase: mapToClase(iRobustez, CLASES_ROBUSTEZ) },
  };

  const confianza = calcularConfianza(available);
  const ctxForRules = {
    pasa075Pond, pasa03Pond, tipologiaBombeable, reduccionAguaAditivoPct,
    zonaShilstone, zonaNombre, coherenciaFdA, notaDiscrepanciaClasica,
    requiereValidacion: true,
  };
  const riesgos = derivarRiesgos(indices, ctxForRules);
  const recomendaciones = derivarRecomendaciones(indices, riesgos, ctxForRules);
  const perfilTexto = generarPerfilTexto(indices, confianza, ctxForRules);

  // ── Snapshot de entradas: para trazabilidad aunque los materiales cambien ──
  const datosEntradaSnapshot = {
    asentamientoMm, ac, aguaLts, cementoTotal, volPastaPct, aireTotalPct,
    fdg, fdt, fda, superficieEspecifica, tmn, mf,
    zonaShilstone, zonaNombre, coherenciaFdA,
    proporcionFinos, pasa075Pond, pasa03Pond,
    reduccionAguaAditivoPct, tipologiaCodigo: contexto.tipologiaCodigo || null,
    formaAgregado: contexto.formaAgregado || null,
  };

  // M1 (auditoría 01-calidad): permitir inyectar fechaCalculo para preservar
  // determinismo en tests/snapshots y reproducir cálculos pasados (con fecha
  // congelada). Si no se pasa, se toma la hora actual (comportamiento histórico).
  const fechaCalculoOut = fechaCalculo ?? new Date().toISOString();

  return {
    versionModelo: MODEL_VERSION,
    fechaCalculo: fechaCalculoOut,
    indices,
    nivelConfianza: confianza,
    riesgos,
    recomendaciones,
    perfilTexto,
    datosEntradaSnapshot,
    disponibilidadDatos: available,
  };
}

function round3(v) { return v == null ? null : Math.round(v * 1000) / 1000; }

module.exports = {
  MODEL_VERSION,
  calcularPrediccionFresco,
  // helpers expuestos para tests
  _internals: {
    mapToClase, lineMap, weightedMean, calcCohesion, calcFluidez,
    calcEstabilidad, calcRiesgoExudacion, calcBombeabilidad, calcTerminabilidad,
    calcRobustez, calcularConfianza, derivarRiesgos, derivarRecomendaciones,
    generarPerfilTexto,
  },
  CLASES: {
    FLUIDEZ: CLASES_FLUIDEZ,
    COHESION: CLASES_COHESION,
    ESTABILIDAD: CLASES_ESTABILIDAD,
    EXUDACION: CLASES_EXUDACION,
    BOMBEABILIDAD: CLASES_BOMBEABILIDAD,
    TERMINAB: CLASES_TERMINAB,
    ROBUSTEZ: CLASES_ROBUSTEZ,
    CONFIANZA: CLASES_CONFIANZA,
  },
  LABELS_CLASES: LABELS,
  RIESGO_LABELS,
};
