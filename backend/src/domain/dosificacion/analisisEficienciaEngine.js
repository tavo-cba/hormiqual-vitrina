'use strict';

/**
 * analisisEficienciaEngine.js
 *
 * Calcula métricas de eficiencia a partir de las acciones de agregado y
 * mediciones seriadas de un pastón. Responde a: "¿qué tan bien funcionó
 * cada material agregado?"
 *
 * Métricas principales:
 *   - Rendimiento de aditivo: cm slump / cc (o por kg)
 *   - Impacto del agua en a/c
 *   - Tasa de slump loss (mm/min entre mediciones)
 *   - Impacto de fibra en trabajabilidad
 *   - Retención de aire
 */

/**
 * @param {Object} params
 * @param {Array} params.mediciones  — MedicionPaston[] ordenadas cronológicamente
 * @param {Array} params.acciones   — RedosificacionObra[] del pastón
 * @param {Object} params.paston    — PastonPrueba (volumenM3, componentes, etc.)
 * @param {Object} params.resultado — resultadoJson de la dosificación (aguaLtsM3, cementoKgM3, ac, etc.)
 * @returns {Object} análisis con métricas calculadas
 */
function calcularEficiencia({ mediciones = [], acciones = [], paston = {}, resultado = {} }) {
  const analisis = {
    slumpLoss: [],
    accionesEficiencia: [],
    balanceAgua: null,
    resumen: {},
  };

  // ── 1. Slump loss temporal (entre mediciones consecutivas) ──
  const medsSorted = [...mediciones]
    .filter(m => m.asentamientoMm != null && m.fechaHora)
    .sort((a, b) => new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime());

  for (let i = 1; i < medsSorted.length; i++) {
    const prev = medsSorted[i - 1];
    const curr = medsSorted[i];
    const dtMin = (new Date(curr.fechaHora).getTime() - new Date(prev.fechaHora).getTime()) / 60000;
    const dSlump = Number(curr.asentamientoMm) - Number(prev.asentamientoMm); // negativo = pérdida
    const tasaMmMin = dtMin > 0 ? dSlump / dtMin : null;

    analisis.slumpLoss.push({
      desde: { id: prev.id, hora: prev.fechaHora, slumpMm: Number(prev.asentamientoMm), etapa: prev.etapa },
      hasta: { id: curr.id, hora: curr.fechaHora, slumpMm: Number(curr.asentamientoMm), etapa: curr.etapa },
      deltaSlumpMm: round(dSlump, 1),
      deltaTiempoMin: round(dtMin, 1),
      tasaMmPorMin: tasaMmMin != null ? round(tasaMmMin, 2) : null,
      tempHormigon: curr.temperaturaHormigonC != null ? Number(curr.temperaturaHormigonC) : null,
    });
  }

  // ── Métricas de slump loss ──
  // Dos métricas DISTINTAS, ambas útiles para análisis:
  //
  // 1) "Velocidad de pérdida activa": promedio aritmético de las tasas de los
  //    tramos donde efectivamente hubo pérdida. Útil para decidir cuándo
  //    redosear: indica con qué velocidad cae el slump cuando está cayendo.
  //    Ignora tramos donde el slump se recuperó (post-redosing).
  //
  // 2) "Decaimiento neto promedio": (slump_final - slump_inicial) / tiempo_total.
  //    Útil para evaluar la durabilidad del aditivo en el pastón completo:
  //    cuánto degradó la trabajabilidad de punta a punta.
  //
  // En el PDF auditado, con serie 160→90→150→110→130→100 mm en 177 min:
  //   - Velocidad de pérdida activa: ~-7,2 cm/h (tramos descendentes)
  //   - Decaimiento neto promedio:   ~-2,03 cm/h (160→100 en 177 min)
  // Ambas son correctas pero responden a preguntas distintas. Antes el sistema
  // mezclaba la primera bajo el nombre "Tasa de pérdida promedio" — ambiguo.
  // Ahora se reportan las dos por separado con nombres explícitos.

  // Métrica 1: velocidad de pérdida activa
  const tramosPerdida = analisis.slumpLoss.filter(t => t.deltaSlumpMm < 0 && t.deltaTiempoMin > 0);
  if (tramosPerdida.length > 0) {
    const promMmMin = tramosPerdida.reduce((s, t) => s + t.tasaMmPorMin, 0) / tramosPerdida.length;
    analisis.resumen.velocidadPerdidaActivaMmMin = round(promMmMin, 2); // mm/min (negativo)
    analisis.resumen.velocidadPerdidaActivaCmHora = round(promMmMin * 60 / 10, 1); // cm/hora
    // Backward-compat: dejamos los nombres antiguos durante 1-2 sprints para
    // no romper el frontend mientras se migra. Marcar @deprecated en código.
    analisis.resumen.tasaSlumpLossPromedio = analisis.resumen.velocidadPerdidaActivaMmMin;
    analisis.resumen.tasaSlumpLossCmHora = analisis.resumen.velocidadPerdidaActivaCmHora;
  }

  // Métrica 2: decaimiento neto promedio (de punta a punta del pastón)
  if (medsSorted.length >= 2) {
    const primerSlump = Number(medsSorted[0].asentamientoMm);
    const ultimoSlump = Number(medsSorted[medsSorted.length - 1].asentamientoMm);
    const tiempoTotalMin = (new Date(medsSorted[medsSorted.length - 1].fechaHora).getTime()
                          - new Date(medsSorted[0].fechaHora).getTime()) / 60000;
    if (tiempoTotalMin > 0) {
      const decaimientoMmMin = (ultimoSlump - primerSlump) / tiempoTotalMin;
      analisis.resumen.decaimientoNetoPromedioMmMin = round(decaimientoMmMin, 2);
      analisis.resumen.decaimientoNetoPromedioCmHora = round(decaimientoMmMin * 60 / 10, 1);
    }
  }

  // ── 2. Eficiencia de cada acción ──
  for (const acc of acciones) {
    const tipo = acc.tipoAccion || 'ADITIVO';
    const cant = acc.cantidad != null ? Number(acc.cantidad) : (acc.dosis != null ? Number(acc.dosis) : 0);
    if (cant <= 0) continue;

    const entry = {
      id: acc.id,
      tipo,
      material: getMaterialName(acc),
      cantidad: cant,
      unidad: acc.unidad || 'cc',
      etapa: acc.etapa || 'OBRA',
      fecha: acc.fecha,
    };

    // Delta slump
    const slumpAntes = acc.asentamientoAntes != null ? Number(acc.asentamientoAntes) : null;
    const slumpDespues = acc.asentamientoDespues != null ? Number(acc.asentamientoDespues) : null;
    if (slumpAntes != null && slumpDespues != null) {
      entry.slumpAntesMm = slumpAntes;
      entry.slumpDespuesMm = slumpDespues;
      entry.deltaSlumpMm = round(slumpDespues - slumpAntes, 1);
      entry.deltaSlumpCm = round((slumpDespues - slumpAntes) / 10, 1);

      // Rendimiento: cm de slump por unidad de material
      if (cant > 0) {
        entry.rendimiento = round(entry.deltaSlumpCm / cant, 3);
        entry.rendimientoLabel = `${entry.rendimiento} cm/${entry.unidad}`;
      }
    }

    // Delta aire
    const aireAntes = acc.aireMedidoAntes != null ? Number(acc.aireMedidoAntes) : null;
    const aireDespues = acc.aireMedidoDespues != null ? Number(acc.aireMedidoDespues) : null;
    if (aireAntes != null && aireDespues != null) {
      entry.aireAntesPct = aireAntes;
      entry.aireDespuesPct = aireDespues;
      entry.deltaAirePct = round(aireDespues - aireAntes, 2);
    }

    // Temperatura al momento (desde medición vinculada o próxima)
    if (acc.medicionAntesId) {
      const med = mediciones.find(m => m.id === acc.medicionAntesId);
      if (med?.temperaturaHormigonC != null) entry.tempHormigon = Number(med.temperaturaHormigonC);
      if (med?.temperaturaAmbienteC != null) entry.tempAmbiente = Number(med.temperaturaAmbienteC);
    }

    analisis.accionesEficiencia.push(entry);
  }

  // ── 3. Balance de agua y verificación a/c ──
  const volM3 = Number(paston.volumenM3) || Number(paston.volumenEfectivoM3) || 0;
  if (volM3 > 0 && resultado.aguaLtsM3 && resultado.cementoKgM3) {
    let comps = paston.componentes;
    if (typeof comps === 'string') { try { comps = JSON.parse(comps); } catch { comps = []; } }
    if (!Array.isArray(comps)) comps = [];

    const aguaComp = comps.find(c => c.tipo === 'AGUA');
    const cementoComp = comps.find(c => c.tipo === 'CEMENTO');

    if (aguaComp && cementoComp) {
      const aguaDosificada = Number(aguaComp.cantidadScaled || 0);
      const aguaRetenida = Number(aguaComp.retenido || 0);
      const aguaCargada = aguaDosificada - aguaRetenida;

      // Agua total agregada desde acciones tipo AGUA
      const aguaAgregada = acciones
        .filter(a => (a.tipoAccion || 'ADITIVO') === 'AGUA')
        .reduce((s, a) => s + (Number(a.cantidad) || Number(a.dosis) || 0), 0);

      const aguaReal = aguaCargada + aguaAgregada;
      const cementoReal = Number(cementoComp.cantidadScaled || 0) - Number(cementoComp.retenido || 0);

      const acDosificada = cementoReal > 0 ? aguaDosificada / cementoReal : null;
      const acReal = cementoReal > 0 ? aguaReal / cementoReal : null;

      analisis.balanceAgua = {
        aguaDosificada: round(aguaDosificada, 1),
        aguaRetenida: round(aguaRetenida, 1),
        aguaCargada: round(aguaCargada, 1),
        aguaAgregada: round(aguaAgregada, 1),
        aguaReal: round(aguaReal, 1),
        unidad: aguaComp.unidad || 'L',
        acDosificada: acDosificada != null ? round(acDosificada, 3) : null,
        acReal: acReal != null ? round(acReal, 3) : null,
        deltaAc: acDosificada != null && acReal != null ? round(acReal - acDosificada, 3) : null,
        acOk: acDosificada != null && acReal != null ? Math.abs(acReal - acDosificada) <= 0.02 : null,
      };
    }
  }

  // ── 4. Resumen ejecutivo ──
  if (medsSorted.length >= 2) {
    const primerSlump = Number(medsSorted[0].asentamientoMm);
    const ultimoSlump = Number(medsSorted[medsSorted.length - 1].asentamientoMm);
    const tiempoTotalMin = (new Date(medsSorted[medsSorted.length - 1].fechaHora).getTime() - new Date(medsSorted[0].fechaHora).getTime()) / 60000;
    analisis.resumen.slumpInicial = round(primerSlump / 10, 1); // cm
    analisis.resumen.slumpFinal = round(ultimoSlump / 10, 1); // cm
    analisis.resumen.deltaSlumpTotal = round((ultimoSlump - primerSlump) / 10, 1); // cm
    analisis.resumen.tiempoTotalMin = round(tiempoTotalMin, 0);
    analisis.resumen.cantMediciones = medsSorted.length;
  }

  analisis.resumen.cantAcciones = acciones.length;
  analisis.resumen.cantAccionesPorTipo = {};
  for (const a of acciones) {
    const t = a.tipoAccion || 'ADITIVO';
    analisis.resumen.cantAccionesPorTipo[t] = (analisis.resumen.cantAccionesPorTipo[t] || 0) + 1;
  }

  // Rendimiento promedio por material (aditivos con delta slump)
  const conRendimiento = analisis.accionesEficiencia.filter(e => e.rendimiento != null && e.tipo === 'ADITIVO');
  if (conRendimiento.length > 0) {
    const porMaterial = {};
    for (const e of conRendimiento) {
      if (!porMaterial[e.material]) porMaterial[e.material] = { sum: 0, count: 0, unidad: e.unidad };
      porMaterial[e.material].sum += e.rendimiento;
      porMaterial[e.material].count++;
    }
    analisis.resumen.rendimientoPromedioPorMaterial = {};
    for (const [mat, data] of Object.entries(porMaterial)) {
      analisis.resumen.rendimientoPromedioPorMaterial[mat] = {
        promedio: round(data.sum / data.count, 3),
        unidad: `cm/${data.unidad}`,
        observaciones: data.count,
      };
    }
  }

  return analisis;
}

function getMaterialName(accion) {
  if (accion.tipoAccion === 'AGUA') return 'Agua';
  if (accion.tipoAccion === 'AIRE') return 'Aire incorporado';
  return accion.aditivo?.marca || accion.fibra?.marca || accion.nombreMaterial || 'Material';
}

function round(v, d = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

module.exports = { calcularEficiencia };
