'use strict';

/**
 * retencionAsentamientoEngine.js — Estimación de pérdida de asentamiento.
 *
 * ⚠ MODELO HORMIQUAL NO NORMATIVO ⚠
 *
 * Calcula el asentamiento de despacho necesario para garantizar el
 * asentamiento objetivo en obra, considerando transporte y descarga.
 *
 * Las constantes (tasas base por tipo de aditivo, factores de retardante,
 * dependencia con temperatura y a/c) son **empíricas**. No provienen de
 * CIRSOC, IRAM ni de un método publicado: se calibraron contra observación
 * de obras y consenso técnico interno HormiQual. Pueden requerir ajuste
 * por planta y se exponen en este archivo para que el override sea trivial.
 *
 * Implicancias:
 *   - El output (`asentamientoDisenoMm`) NO debe usarse como veredicto
 *     normativo de cumplimiento — sólo como guía de despacho.
 *   - Cada cálculo emite trazabilidad con la nota "Modelo HormiQual interno"
 *     para que quede registrado en el informe.
 *   - Si en el futuro se publica un método estandarizado (e.g. ASTM C403
 *     extendido), este motor debería deprecarse o portar al método publicado.
 */

// ── Tasas base de pérdida por tipo de aditivo (cm/hora a dosis recomendada,
//    20°C, a/c 0,50) — calibración HormiQual basada en observación de obra ──
const TASAS_BASE = {
  policarboxilato: 2.5,
  naftaleno: 4.0,
  lignosulfonato: 3.0,
  sin_aditivo: 5.0,
};

// ── Factores de retardante (multiplicador sobre la tasa base) — empírico HormiQual ──
const FACTORES_RETARDANTE = {
  retardante: 0.75,         // reduce pérdida 25%
  estabilizador: 0.50,      // reduce pérdida 50%
  sin_retardante: 1.00,
};

/**
 * Obtiene la tasa base de pérdida del aditivo.
 * Si el aditivo tiene datos específicos de retención, los usa.
 * Si no, usa defaults por tipo.
 */
function obtenerTasaPerdida(aditivo, dosisRelativa) {
  if (!aditivo) return TASAS_BASE.sin_aditivo;

  // Si el aditivo tiene tasa declarada
  if (aditivo.tasaPerdidaBase) {
    let tasa = aditivo.tasaPerdidaBase;
    // Ajustar por dosis: menor dosis = mayor pérdida
    if (dosisRelativa != null && dosisRelativa < 1) {
      tasa *= (1 + (1 - dosisRelativa) * 0.5); // 50% de dosis → +25% de pérdida
    }
    return tasa;
  }

  // Clasificar por tipo de aditivo
  const desc = (aditivo.descripcion || aditivo.tipo || '').toLowerCase();
  if (desc.includes('policarboxilato') || desc.includes('hiperplastificante') || desc.includes('pcx')) {
    return TASAS_BASE.policarboxilato;
  }
  if (desc.includes('naftaleno') || desc.includes('superplastificante')) {
    return TASAS_BASE.naftaleno;
  }
  if (desc.includes('lignosulfonato') || desc.includes('plastificante')) {
    return TASAS_BASE.lignosulfonato;
  }
  return TASAS_BASE.sin_aditivo;
}

/**
 * Obtiene el factor de reducción del retardante
 */
function obtenerFactorRetardante(retardante, dosisRelativa) {
  if (!retardante) return 1.0;

  if (retardante.factorReduccionPerdida) {
    return retardante.factorReduccionPerdida;
  }

  const desc = (retardante.descripcion || retardante.tipo || '').toLowerCase();
  if (desc.includes('estabilizador')) return FACTORES_RETARDANTE.estabilizador;
  if (desc.includes('retardante') || desc.includes('retardar')) return FACTORES_RETARDANTE.retardante;
  return 1.0;
}

/**
 * Estima la pérdida de asentamiento a un tiempo dado.
 * @param {object} params
 * @returns {{ perdidaCm, tasaResultante, factores }}
 */
function estimarPerdidaAsentamiento(params) {
  const {
    tiempoTotal,        // minutos
    aditivoPrincipal,   // objeto aditivo o null
    dosisRelativa,      // dosis_aplicada / dosis_recomendada (0-1+)
    retardante,         // objeto retardante o null
    dosisRetardanteRel, // dosis relativa del retardante
    temperatura = 20,   // °C
    cementoKg = 300,    // kg/m³
    ac = 0.50,          // relación a/c
  } = params;

  // Tasa base
  let tasaBase = obtenerTasaPerdida(aditivoPrincipal, dosisRelativa);

  // Factor retardante
  const fRetardante = obtenerFactorRetardante(retardante, dosisRetardanteRel);
  tasaBase *= fRetardante;

  // Factor temperatura (referencia 20°C, +4% por cada °C arriba)
  const fTemperatura = Math.pow(1.04, temperatura - 20);
  tasaBase *= fTemperatura;

  // Factor cemento (referencia 300 kg/m³, +0.2% por cada kg arriba)
  const fCemento = Math.max(0.8, 1 + (cementoKg - 300) * 0.002);
  tasaBase *= fCemento;

  // Factor a/c (referencia 0.50, a/c baja = más pérdida)
  const fAC = Math.max(0.9, 1 + (0.50 - ac) * 1.6);
  tasaBase *= fAC;

  // Calcular pérdida (modelo no lineal)
  const horas = tiempoTotal / 60;
  let perdidaCm;
  if (horas <= 0.5) {
    perdidaCm = tasaBase * horas * 0.7;
  } else if (horas <= 1.5) {
    perdidaCm = tasaBase * 0.5 * 0.7 + tasaBase * (horas - 0.5) * 1.0;
  } else {
    perdidaCm = tasaBase * 0.5 * 0.7 + tasaBase * 1.0 * 1.0 + tasaBase * (horas - 1.5) * 1.3;
  }

  return {
    perdidaCm: Math.round(perdidaCm * 10) / 10,
    tasaResultante: Math.round(tasaBase * 10) / 10,
    factores: {
      tasaBaseAditivo: obtenerTasaPerdida(aditivoPrincipal, dosisRelativa) / (fRetardante * fTemperatura * fCemento * fAC) || TASAS_BASE.sin_aditivo,
      fRetardante: Math.round(fRetardante * 100) / 100,
      fTemperatura: Math.round(fTemperatura * 100) / 100,
      fCemento: Math.round(fCemento * 100) / 100,
      fAC: Math.round(fAC * 100) / 100,
    },
  };
}

/**
 * Genera la curva de pérdida de asentamiento en el tiempo.
 */
function generarCurvaPerdida(asentamientoInicial, perdidaParams) {
  const puntos = [];
  for (let t = 0; t <= 120; t += 15) {
    const p = estimarPerdidaAsentamiento({ ...perdidaParams, tiempoTotal: t });
    puntos.push({
      minutos: t,
      asentamientoCm: Math.round(Math.max(0, asentamientoInicial - p.perdidaCm) * 10) / 10,
    });
  }
  return puntos;
}

/**
 * Calcula la ventana de colocación (tiempo hasta que cae por debajo del mínimo).
 */
function calcularVentanaColocacion(asentamientoPlanta, asentamientoMinimo, perdidaParams) {
  const minimo = asentamientoMinimo - 2; // tolerancia 2 cm
  for (let t = 0; t <= 180; t += 5) {
    const p = estimarPerdidaAsentamiento({ ...perdidaParams, tiempoTotal: t });
    if (asentamientoPlanta - p.perdidaCm < minimo) {
      return { minutosMaximos: t, mensaje: `Colocar antes de ${t} min desde cargado para mantener asentamiento >= ${minimo} cm.` };
    }
  }
  return { minutosMaximos: 180, mensaje: 'Retención superior a 180 minutos.' };
}

/**
 * Evalúa si se necesita redosificación en obra.
 */
function evaluarRedosificacion(tiempoTotal, asentamientoPlanta, asentamientoObra, perdidaParams, aditivo) {
  const p = estimarPerdidaAsentamiento({ ...perdidaParams, tiempoTotal });
  const asentamientoFinal = asentamientoPlanta - p.perdidaCm;

  if (asentamientoFinal >= asentamientoObra) {
    return { necesaria: false, mensaje: 'No se requiere redosificación.' };
  }

  const permitida = aditivo?.redosificacionPermitida !== false;
  const maxPct = aditivo?.maxRedosisPct || 50;

  return {
    necesaria: true,
    permitida,
    maxPorcentaje: maxPct,
    tiempoMaxRedosis: 90,
    mensaje: permitida
      ? `Se recomienda redosificar el plastificante en obra (máx. ${maxPct}% de la dosis inicial). No redosificar después de 120 min.`
      : 'Redosificación no recomendada para este aditivo. Considerar aditivo estabilizador.',
  };
}

/**
 * Genera alertas de logística.
 */
function generarAlertasLogistica(params) {
  const alertas = [];
  const { tiempoTotal, asentamientoPlanta, temperatura, retardante, perdidaEstimada, ventana } = params;

  if (tiempoTotal > 90 && !retardante) {
    alertas.push({ nivel: 'alto', mensaje: `Tiempo total ${tiempoTotal} min sin retardante. Se recomienda agregar aditivo retardante.` });
  }
  if (tiempoTotal > 120) {
    alertas.push({ nivel: 'critico', mensaje: `Tiempo total ${tiempoTotal} min excede el máximo recomendado. Alto riesgo de pérdida excesiva.` });
  }
  if (asentamientoPlanta > 18) {
    alertas.push({ nivel: 'alto', mensaje: `Asentamiento de despacho ${asentamientoPlanta} cm — riesgo de segregación. Verificar estabilidad.` });
  }
  if (asentamientoPlanta > 22) {
    alertas.push({ nivel: 'critico', mensaje: `Asentamiento de despacho ${asentamientoPlanta} cm excesivo. La mezcla no será estable.` });
  }
  if (temperatura > 30) {
    alertas.push({ nivel: 'advertencia', mensaje: `Temperatura ${temperatura}°C — la pérdida se acelera. Considerar protección térmica.` });
  }
  if (temperatura > 35) {
    alertas.push({ nivel: 'alto', mensaje: `Temperatura extrema (${temperatura}°C). Considerar hormigonado nocturno o protección activa.` });
  }
  if (perdidaEstimada > 6) {
    alertas.push({ nivel: 'alto', mensaje: `Pérdida estimada ${perdidaEstimada} cm — muy elevada. Verificar capacidad de retención del aditivo.` });
  }
  if (ventana && ventana.minutosMaximos < tiempoTotal + 15) {
    alertas.push({ nivel: 'advertencia', mensaje: 'Ventana de colocación muy ajustada. Coordinar logística para evitar demoras.' });
  }

  return alertas;
}

/**
 * Función principal: calcula el asentamiento de despacho y toda la info de retención.
 * @param {object} params
 * @returns {{ asentamientoPlanta, asentamientoObra, perdida, curva, ventana, redosis, alertas }}
 */
function calcularRetencionAsentamiento(params) {
  const {
    modoAsentamiento = 'EN_PLANTA',  // 'EN_OBRA' o 'EN_PLANTA'
    asentamientoObra,     // cm (modo EN_OBRA)
    asentamientoPlanta,   // cm (modo EN_PLANTA)
    tiempoViaje = 30,     // min
    tiempoDescarga = 30,  // min
    tiempoEspera = 0,     // min
    temperatura = 20,     // °C
    aditivoPrincipal,
    dosisRelativa,
    retardante,
    dosisRetardanteRel,
    cementoKg = 300,
    ac = 0.50,
  } = params;

  const tiempoTotal = tiempoViaje + tiempoDescarga + tiempoEspera;

  const perdidaParams = {
    tiempoTotal,
    aditivoPrincipal,
    dosisRelativa,
    retardante,
    dosisRetardanteRel,
    temperatura,
    cementoKg,
    ac,
  };

  const perdida = estimarPerdidaAsentamiento(perdidaParams);

  let asentPlanta, asentObra;

  if (modoAsentamiento === 'EN_OBRA') {
    asentObra = asentamientoObra;
    asentPlanta = Math.ceil((asentObra + perdida.perdidaCm) * 2) / 2; // redondeo 0,5 arriba
  } else {
    asentPlanta = asentamientoPlanta;
    asentObra = Math.round(Math.max(0, asentPlanta - perdida.perdidaCm) * 10) / 10;
  }

  const curva = generarCurvaPerdida(asentPlanta, perdidaParams);
  const ventana = calcularVentanaColocacion(asentPlanta, asentObra, perdidaParams);
  const redosis = evaluarRedosificacion(tiempoTotal, asentPlanta, asentObra, perdidaParams, aditivoPrincipal);
  const alertas = generarAlertasLogistica({
    tiempoTotal,
    asentamientoPlanta: asentPlanta,
    temperatura,
    retardante,
    perdidaEstimada: perdida.perdidaCm,
    ventana,
  });

  return {
    modoAsentamiento,
    asentamientoPlanta: asentPlanta,
    asentamientoObra: asentObra,
    tiempoViaje,
    tiempoDescarga,
    tiempoEspera,
    tiempoTotal,
    temperatura,
    perdida,
    curva,
    ventana,
    redosificacion: redosis,
    alertas,
  };
}

module.exports = {
  calcularRetencionAsentamiento,
  estimarPerdidaAsentamiento,
  generarCurvaPerdida,
  calcularVentanaColocacion,
  evaluarRedosificacion,
  generarAlertasLogistica,
  TASAS_BASE,
  FACTORES_RETARDANTE,
};
