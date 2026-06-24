'use strict';

/**
 * Lectura contextual para CIRSOC 200-2024 Tabla 9.3 (hormigones con
 * características particulares). Read-only: la tabla es normativa y se
 * mantiene por seed; no se exponen create/update/delete a la UI.
 */

const TIPOS = ['BAJO_AGUA', 'IMPERMEABILIDAD', 'ABRASION'];
const CLASES = ['I', 'II', 'III', 'IV'];
const AIRE_MODO = ['OPCIONAL', 'NO', 'REQUERIDO'];

async function listar(db, { tipoHormigon } = {}) {
  const where = {};
  if (tipoHormigon) where.tipoHormigon = tipoHormigon;
  return db.HormigonParticular.findAll({
    where,
    order: [['tipoHormigon', 'ASC'], ['clase', 'ASC'], ['espesorMmMax', 'ASC']],
  });
}

/**
 * Resuelve la fila aplicable dado (tipoHormigon, clase, espesorElementoMm).
 * Para tipos con sub-condición por espesor, elige la fila cuyo rango contiene
 * al espesor dado. Si no hay espesor provisto y existen dos filas, devuelve
 * todas para que el motor alerte al usuario.
 */
async function resolver(db, { tipoHormigon, clase, espesorMm }) {
  const rows = await db.HormigonParticular.findAll({
    where: { tipoHormigon, clase },
    raw: true,
  });
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];
  if (espesorMm == null) return { ambiguo: true, opciones: rows };
  const match = rows.find(r =>
    (r.espesorMmMin == null || espesorMm >= r.espesorMmMin) &&
    (r.espesorMmMax == null || espesorMm <= r.espesorMmMax)
  );
  return match || rows[0];
}

module.exports = { listar, resolver, TIPOS, CLASES, AIRE_MODO };
