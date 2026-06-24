'use strict';

/**
 * seleccionAditivosEngine.js
 *
 * Motor de selección automática de aditivos para dosificación.
 * Dado los parámetros de diseño y los aditivos disponibles en planta,
 * recomienda qué aditivos usar y a qué dosis.
 */

// ── Defaults por tipo funcional ──
//
// Valores empíricos HormiQual usados como fallback cuando el aditivo del
// catálogo no tiene `metadataTecnicaJson` con datos publicados por el
// fabricante. NO son límites IRAM 1663 ni rangos prescriptivos: son
// estimaciones razonables para hormigones convencionales que permiten que
// el motor de sugerencia opere aunque el catálogo esté incompleto.
//
// IRAM 1663:2002 ("Aditivos químicos para hormigón de cemento portland")
// define las CATEGORÍAS funcionales pero NO obliga valores numéricos
// específicos por categoría — los rangos de reducción de agua, retención,
// aire colateral, etc. son responsabilidad del fabricante de cada aditivo
// y deben venir en su ficha técnica.
//
// Recomendación operacional: si el catálogo tiene la ficha del fabricante
// cargada (`metadataTecnicaJson`), el motor la usa con prioridad sobre estos
// defaults. Estos valores sólo se aplican cuando el catálogo está vacío.
const DEFAULTS_POR_TIPO = {
  PLASTIFICANTE:                { reduccionAgua: 8,  retencionMin: 60,  tipoRetencion: 'BAJA',  aireColateral: 0.5 },
  REDUCTOR_AGUA_RANGO_MEDIO:   { reduccionAgua: 12, retencionMin: 60,  tipoRetencion: 'MEDIA', aireColateral: 0.5 },
  SUPERPLASTIFICANTE:           { reduccionAgua: 18, retencionMin: 45,  tipoRetencion: 'MEDIA', aireColateral: 0.8 },
  FLUIDIFICANTE:                { reduccionAgua: 22, retencionMin: 90,  tipoRetencion: 'ALTA',  aireColateral: 1.0 },
  RETARDADOR:                   { reduccionAgua: 3,  retencionMin: 120, tipoRetencion: 'ALTA',  aireColateral: 0 },
  CONTROLADOR_HIDRATACION:      { reduccionAgua: 0,  retencionMin: 180, tipoRetencion: 'ALTA',  aireColateral: 0 },
  INCORPORADOR_AIRE:            { reduccionAgua: 0,  retencionMin: 0,   tipoRetencion: null,    aireColateral: 0 },
  // Espumígenos: aporte de aire 15–35% para HRDC. NO usar como aditivo CIRSOC
  // estándar — el motor ICPA los excluye de su cálculo (ver hormiqualCalcEngine).
  ESPUMIGENO:                   { reduccionAgua: 0,  retencionMin: 0,   tipoRetencion: null,    aireColateral: 0 },
};

const TIPOS_PLASTIFICANTE = ['PLASTIFICANTE', 'REDUCTOR_AGUA_RANGO_MEDIO', 'SUPERPLASTIFICANTE', 'FLUIDIFICANTE'];
const TIPOS_RETARDANTE = ['RETARDADOR', 'CONTROLADOR_HIDRATACION'];

/**
 * Obtiene los datos de efecto del aditivo (con fallback a defaults)
 */
function getEfectos(aditivo) {
  const tipo = aditivo.tipoFuncional || 'PLASTIFICANTE';
  const def = DEFAULTS_POR_TIPO[tipo] || DEFAULTS_POR_TIPO.PLASTIFICANTE;
  const meta = typeof aditivo.metadataTecnicaJson === 'string'
    ? JSON.parse(aditivo.metadataTecnicaJson || '{}')
    : (aditivo.metadataTecnicaJson || {});

  return {
    reduccionAgua: Number(aditivo.reduccionAguaPctEsperada) || meta.reduccionAgua || def.reduccionAgua,
    retencionMin: Number(aditivo.retencionTrabajabilidadMin) || meta.retencionMin || def.retencionMin,
    aireColateral: Number(aditivo.aireIncorporadoPctEsperado) || meta.aireColateral || def.aireColateral,
    retardoMin: Number(aditivo.retardoEsperadoMin) || meta.retardoMin || 0,
    tipoRetencion: meta.tipoRetencion || def.tipoRetencion,
    factorReduccionPerdida: meta.factorReduccionPerdida || (TIPOS_RETARDANTE.includes(tipo) ? 0.75 : 1),
    tasaPerdidaBase: meta.tasaPerdidaBase || null,
  };
}

/**
 * Calcula score de idoneidad de un plastificante
 */
/**
 * Score a plasticizer for use as the BASE plant additive.
 *
 * Priority: AHORRO_AGUA (water reducer) >> AUMENTO_ASENTAMIENTO (slump modifier).
 * Slump-type additives are for on-site correction, not base dosification.
 */
function scorePlastificante(aditivo, parametros) {
  const ef = getEfectos(aditivo);
  let score = 0;
  const tiempoTotal = (parametros.tiempoViaje || 0) + (parametros.tiempoDescarga || 0) + (parametros.tiempoEspera || 0);
  const base = (aditivo.baseQuimica || '').toLowerCase();
  const modo = (aditivo.modoEfectoSugerido || '').toUpperCase();

  // ── Primary criterion: function type ──
  // Water reducers are the base plant additive; slump modifiers are for field correction
  if (modo === 'AHORRO_AGUA') score += 50;
  else if (modo === 'AUMENTO_ASENTAMIENTO') score -= 20; // penalize as base additive
  else score += 10; // unspecified mode — neutral

  // ── Secondary: water reduction capacity ──
  score += ef.reduccionAgua * 1.5;

  // ── Tipo funcional bonus (superplast/fluidificante have better performance) ──
  if (aditivo.tipoFuncional === 'SUPERPLASTIFICANTE') score += 10;
  else if (aditivo.tipoFuncional === 'FLUIDIFICANTE') score += 5;
  else if (aditivo.tipoFuncional === 'REDUCTOR_AGUA_RANGO_MEDIO') score += 8;

  // ── Policarboxilato bonus for long transport ──
  if (tiempoTotal > 60 && (base.includes('policarbox') || base.includes('acril'))) score += 15;
  if (tiempoTotal > 60 && base.includes('naftaleno')) score -= 10;

  // ── Retention bonus for transport ──
  if (tiempoTotal > 30) {
    if (ef.tipoRetencion === 'ALTA') score += 10;
    else if (ef.tipoRetencion === 'MEDIA') score += 5;
  }

  // ── Bombeable: prefer high retention ──
  if (parametros.bombeable && ef.tipoRetencion === 'ALTA') score += 8;

  return score;
}

/**
 * Calcula la dosis óptima del plastificante
 */
function calcularDosisPrincipal(aditivo, parametros) {
  const dosisMin = Number(aditivo.dosisMinima) || 0.3;
  const dosisMax = Number(aditivo.dosisMaxima) || 2.0;
  const dosisRec = Number(aditivo.dosisHabitual) || (dosisMin + dosisMax) / 2;
  const ef = getEfectos(aditivo);
  const tiempoTotal = (parametros.tiempoViaje || 0) + (parametros.tiempoDescarga || 0) + (parametros.tiempoEspera || 0);

  let dosis = dosisRec;

  // Ajuste por transporte largo sin retardante
  if (tiempoTotal > 60 && !parametros.tieneRetardante) {
    dosis = Math.min(dosis * 1.1, dosisMax);
  }

  // Ajuste por temperatura
  if ((parametros.temperatura || 20) > 30) {
    dosis = Math.min(dosis * 1.05, dosisMax);
  }

  dosis = Math.round(dosis * 100) / 100;

  // Calcular efecto real (proporcional a dosis/dosisRec)
  const ratio = dosisRec > 0 ? dosis / dosisRec : 1;
  const factorEfecto = Math.min(ratio * 100, 115); // rendimiento decreciente
  const reduccionReal = ef.reduccionAgua * factorEfecto / 100;
  const aireCol = ef.aireColateral * ratio;

  return {
    dosis,
    dosisMinima: dosisMin,
    dosisMaxima: dosisMax,
    dosisRecomendada: dosisRec,
    reduccionAguaPct: Math.round(reduccionReal * 10) / 10,
    factorEfecto: Math.round(factorEfecto),
    aireColateral: Math.round(aireCol * 100) / 100,
    motivo: `Dosis ${dosis}% s/cem — reduccion agua ${reduccionReal.toFixed(1)}% (${Math.round(factorEfecto)}% del efecto declarado)`,
  };
}

/**
 * Evalúa si se necesita retardante
 */
function evaluarNecesidadRetardante(parametros) {
  const tiempoTotal = (parametros.tiempoViaje || 0) + (parametros.tiempoDescarga || 0) + (parametros.tiempoEspera || 0);
  const temp = parametros.temperatura || 20;

  if (tiempoTotal > 60) return { necesita: true, prioridad: tiempoTotal > 90 ? 'ALTA' : 'MEDIA', motivo: `Tiempo total ${tiempoTotal} min` };
  if (temp > 30) return { necesita: true, prioridad: temp > 35 ? 'ALTA' : 'MEDIA', motivo: `Temperatura ${temp} C` };
  if ((parametros.tipologia || '').toLowerCase() === 'masivo') return { necesita: true, prioridad: 'ALTA', motivo: 'Hormigon masivo' };
  return { necesita: false };
}

/**
 * Calcula dosis del retardante
 */
function calcularDosisRetardante(retardante, parametros) {
  const dosisMin = Number(retardante.dosisMinima) || 0.1;
  const dosisMax = Number(retardante.dosisMaxima) || 1.0;
  const dosisRec = Number(retardante.dosisHabitual) || (dosisMin + dosisMax) / 2;
  const tiempoTotal = (parametros.tiempoViaje || 0) + (parametros.tiempoDescarga || 0) + (parametros.tiempoEspera || 0);
  const temp = parametros.temperatura || 20;

  let dosis;
  if (tiempoTotal <= 60) dosis = dosisMin;
  else if (tiempoTotal <= 90) dosis = dosisRec * 0.7;
  else if (tiempoTotal <= 120) dosis = dosisRec;
  else dosis = Math.min(dosisRec * 1.2, dosisMax);

  if (temp > 30) dosis = Math.min(dosis * 1.15, dosisMax);
  if (temp > 35) dosis = Math.min(dosis * 1.3, dosisMax);

  dosis = Math.round(dosis * 100) / 100;
  const ef = getEfectos(retardante);

  return {
    dosis,
    dosisMinima: dosisMin,
    dosisMaxima: dosisMax,
    dosisRecomendada: dosisRec,
    factorReduccionPerdida: ef.factorReduccionPerdida,
    motivo: `Dosis ${dosis}% s/cem — reduce perdida asentamiento ${Math.round((1 - ef.factorReduccionPerdida) * 100)}%`,
  };
}

/**
 * Evalúa si se requiere aire incorporado.
 *
 * Clases CIRSOC 200:2024 §4.3 (Tabla 4.3) que exigen aire intencional:
 * únicamente C1 y C2 — ciclos de congelación-deshielo. La tabla sólo
 * tiene dos columnas (C1+bajo-agua y C2); ninguna clase M o Q dispara
 * aire intencional por sí sola.
 *
 * F1/F2/F3 son clases ACI 318, no existen en la nomenclatura argentina
 * y se eliminaron (la alerta nunca disparaba para una clase real).
 */
function requiereAireIncorporado(parametros) {
  const clasesConAire = ['C1', 'C2'];
  return clasesConAire.includes(parametros.claseExposicion);
}

/**
 * Función principal: selecciona aditivos recomendados
 * @param {Array} aditivosDisponibles - aditivos activos de la planta
 * @param {Object} parametros - parámetros de diseño
 * @returns {{ principal, dosisPrincipal, retardante, dosisRetardante, otros, alertas }}
 */
function seleccionarAditivos(aditivosDisponibles, parametros) {
  const alertas = [];

  // ── 1. Seleccionar plastificante principal ──
  const plastificantes = aditivosDisponibles.filter(a =>
    TIPOS_PLASTIFICANTE.includes(a.tipoFuncional) && a.activo !== false
  );

  if (plastificantes.length === 0) {
    return {
      principal: null, dosisPrincipal: null,
      retardante: null, dosisRetardante: null,
      otros: [], alertas: [{ nivel: 'alto', mensaje: 'No hay aditivos plastificantes disponibles en esta planta.' }],
    };
  }

  const ranked = plastificantes
    .map(p => ({ aditivo: p, score: scorePlastificante(p, parametros) }))
    .sort((a, b) => b.score - a.score);

  const principal = ranked[0].aditivo;
  const dosisPrincipal = calcularDosisPrincipal(principal, parametros);

  // ── 2. Retardante ──
  let retardante = null;
  let dosisRetardante = null;
  const necRet = evaluarNecesidadRetardante(parametros);

  if (necRet.necesita) {
    const retardantes = aditivosDisponibles.filter(a =>
      TIPOS_RETARDANTE.includes(a.tipoFuncional) && a.activo !== false
    );
    if (retardantes.length > 0) {
      retardante = retardantes[0];
      dosisRetardante = calcularDosisRetardante(retardante, { ...parametros, tieneRetardante: true });
    } else {
      alertas.push({ nivel: 'advertencia', mensaje: `${necRet.motivo} — se recomienda retardante pero no hay disponible en planta.` });
    }
  }

  // ── 3. Aire incorporado ──
  const otros = [];
  if (requiereAireIncorporado(parametros)) {
    const incorporadores = aditivosDisponibles.filter(a =>
      a.tipoFuncional === 'INCORPORADOR_AIRE' && a.activo !== false
    );
    if (incorporadores.length > 0) {
      otros.push({
        aditivo: incorporadores[0],
        dosis: Number(incorporadores[0].dosisHabitual) || 0.05,
        motivo: `Aire incorporado requerido por exposicion ${parametros.claseExposicion}`,
      });
    } else {
      alertas.push({ nivel: 'alto', mensaje: `Exposicion ${parametros.claseExposicion} requiere aire incorporado — no hay incorporador disponible.` });
    }
  }

  return {
    principal,
    dosisPrincipal,
    alternativas: ranked.slice(1, 3).map(r => r.aditivo),
    retardante,
    dosisRetardante,
    necesitaRetardante: necRet,
    otros,
    alertas,
  };
}

module.exports = {
  seleccionarAditivos,
  scorePlastificante,
  calcularDosisPrincipal,
  evaluarNecesidadRetardante,
  calcularDosisRetardante,
  requiereAireIncorporado,
  getEfectos,
  TIPOS_PLASTIFICANTE,
  TIPOS_RETARDANTE,
};
