'use strict';

/**
 * materialContextService.js
 *
 * Constructor lazy de `MaterialContext` con acceso a Sequelize. Hace JOIN
 * con `Agregado`, `AgregadoMeta` y (opcionalmente) `Cemento`.
 *
 * Migrado desde `domain/compliance/materialContext.js` en la auditoría
 * 01-calidad Fase C R3 (sesión 2026-05-07): el domain queda con las funciones
 * puras (`createMaterialContext` + validators + helpers) y este service
 * centraliza el acceso a DB.
 *
 * Para el shape eager (sin DB), seguir importando `createMaterialContext`
 * directamente desde `domain/compliance/materialContext`.
 */

const { createMaterialContext } = require('../domain/compliance/materialContext');

/**
 * Construye un MaterialContext desde Sequelize, haciendo JOIN con
 * AgregadoMeta y (opcionalmente) Cemento.
 *
 * @param {Object} db - Sequelize db (opcional). Si null/undefined, se
 *   retorna un MaterialContext vacío (agregado=null, cemento=null).
 * @param {number|null} idAgregado
 * @param {number|null} [idCemento]
 * @param {Object} [options]
 * @param {'FINO'|'GRUESO'|null} [options.tipoAgregadoExplicito] - Si el
 *   caller ya sabe el tipo (por contexto), pasarlo evita un lookup
 *   adicional en AgregadoFino/AgregadoGrueso. Si no se pasa, queda null
 *   (la inferencia se delega al caller).
 */
async function materialContextFromDb(db, idAgregado, idCemento = null, options = {}) {
  if (!db || !idAgregado) {
    return createMaterialContext({});
  }

  let agregado = null;
  if (db.Agregado) {
    try {
      const ag = await db.Agregado.findByPk(idAgregado, { raw: true });
      if (ag) {
        let meta = null;
        if (db.AgregadoMeta) {
          try {
            meta = await db.AgregadoMeta.findOne({
              where: { idAgregado: ag.idAgregado },
              raw: true,
            });
          } catch { /* meta opcional — RAS queda 'NO_EVALUADO' */ }
        }
        agregado = {
          id:            ag.idAgregado,
          nombre:        ag.nombre || null,
          tipo:          options.tipoAgregadoExplicito || null,
          subtipo:       null, // legacy: subtipo no vive en Agregado raíz
          tipoRoca:      meta?.tipoRoca || null,
          evaluacionRas: meta?.evaluacionRas || 'NO_EVALUADO',
        };
      }
    } catch { /* lookup falla → agregado queda null, builder retorna context vacío */ }
  }

  let cemento = null;
  if (idCemento && db.Cemento) {
    try {
      const cem = await db.Cemento.findByPk(idCemento, { raw: true });
      if (cem) {
        cemento = {
          id:              cem.idCemento,
          composicion:     cem.composicion || null,
          claseResistente: cem.claseResistente || null,
          familia:         cem.familiaCemento || null,
        };
      }
    } catch { /* idem */ }
  }

  return createMaterialContext({ agregado, cemento });
}

module.exports = {
  materialContextFromDb,
};
