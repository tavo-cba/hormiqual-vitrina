'use strict';

/**
 * prediccionFrescoService.js
 *
 * Service layer para predicciones de comportamiento fresco. Envuelve el motor
 * heurístico (prediccionFrescoEngine) y gestiona su persistencia.
 *
 * V1: una predicción activa por dosificación (se sobrescribe en cada recálculo).
 * Futuro: historial con versionado explícito.
 */

const { calcularPrediccionFresco } = require('../domain/dosificacion/prediccionFrescoEngine');

/**
 * Calcula una predicción a partir de los insumos del motor de dosificación.
 * No persiste — solo devuelve el objeto listo para UI/PDF o para guardar.
 */
function calcular(input) {
  return calcularPrediccionFresco(input);
}

/**
 * Persiste (o actualiza) la predicción asociada a una dosificación.
 * Estrategia V1: upsert — si ya existe para esa dosif, se reemplaza.
 */
async function guardar(db, idDosificacionDisenada, prediccion) {
  if (!db.PrediccionComportamientoFresco) return null;
  if (!idDosificacionDisenada) return null;

  const payload = {
    idDosificacionDisenada,
    versionModelo: prediccion.versionModelo,
    indiceFluidez: prediccion.indices?.fluidez?.score ?? null,
    claseFluidez:  prediccion.indices?.fluidez?.clase ?? null,
    indiceCohesion: prediccion.indices?.cohesion?.score ?? null,
    claseCohesion:  prediccion.indices?.cohesion?.clase ?? null,
    indiceEstabilidad: prediccion.indices?.estabilidad?.score ?? null,
    claseEstabilidad:  prediccion.indices?.estabilidad?.clase ?? null,
    indiceExudacion: prediccion.indices?.exudacion?.score ?? null,
    claseExudacion:  prediccion.indices?.exudacion?.clase ?? null,
    indiceBombeabilidad: prediccion.indices?.bombeabilidad?.score ?? null,
    claseBombeabilidad:  prediccion.indices?.bombeabilidad?.clase ?? null,
    indiceTerminabilidad: prediccion.indices?.terminabilidad?.score ?? null,
    claseTerminabilidad:  prediccion.indices?.terminabilidad?.clase ?? null,
    indiceRobustez: prediccion.indices?.robustez?.score ?? null,
    claseRobustez:  prediccion.indices?.robustez?.clase ?? null,
    nivelConfianzaScore: prediccion.nivelConfianza?.score ?? null,
    nivelConfianzaClase: prediccion.nivelConfianza?.clase ?? null,
    perfilTexto: prediccion.perfilTexto || null,
    riesgosJson: prediccion.riesgos || null,
    recomendacionesJson: prediccion.recomendaciones || null,
    datosEntradaSnapshot: prediccion.datosEntradaSnapshot || null,
    disponibilidadDatos: prediccion.disponibilidadDatos || null,
    fechaCalculo: prediccion.fechaCalculo || new Date(),
  };

  const existing = await db.PrediccionComportamientoFresco.findOne({
    where: { idDosificacionDisenada },
  });
  if (existing) {
    await existing.update(payload);
    return existing.get({ plain: true });
  }
  const nueva = await db.PrediccionComportamientoFresco.create(payload);
  return nueva.get({ plain: true });
}

/**
 * Lee la predicción persistida más reciente de una dosificación, si existe.
 * Devuelve el mismo shape que retorna el engine (reconstruido desde columnas),
 * para que el frontend no tenga que distinguir entre "recién calculada" y
 * "persistida".
 */
async function obtener(db, idDosificacionDisenada) {
  if (!db.PrediccionComportamientoFresco) return null;
  const row = await db.PrediccionComportamientoFresco.findOne({
    where: { idDosificacionDisenada },
    order: [['fechaCalculo', 'DESC']],
  });
  if (!row) return null;
  const r = row.get({ plain: true });
  return {
    versionModelo: r.versionModelo,
    fechaCalculo: r.fechaCalculo,
    indices: {
      fluidez:        { score: num(r.indiceFluidez),        clase: r.claseFluidez },
      cohesion:       { score: num(r.indiceCohesion),       clase: r.claseCohesion },
      estabilidad:    { score: num(r.indiceEstabilidad),    clase: r.claseEstabilidad },
      exudacion:      { score: num(r.indiceExudacion),      clase: r.claseExudacion },
      bombeabilidad:  { score: num(r.indiceBombeabilidad),  clase: r.claseBombeabilidad },
      terminabilidad: { score: num(r.indiceTerminabilidad), clase: r.claseTerminabilidad },
      robustez:       { score: num(r.indiceRobustez),       clase: r.claseRobustez },
    },
    nivelConfianza: { score: num(r.nivelConfianzaScore), clase: r.nivelConfianzaClase },
    riesgos: r.riesgosJson || [],
    recomendaciones: r.recomendacionesJson || [],
    perfilTexto: r.perfilTexto,
    datosEntradaSnapshot: r.datosEntradaSnapshot || {},
    disponibilidadDatos: r.disponibilidadDatos || {},
    _persistedId: r.id,
  };
}

function num(v) { return v == null ? null : Number(v); }

module.exports = { calcular, guardar, obtener };
