'use strict';

/**
 * parametroTrabajabilidadService.js
 *
 * Servicio CRUD del catálogo `ParametroTrabajabilidad` (overrides por tenant
 * de los parámetros del engine de trabajabilidad: factores SE, rangos FdA,
 * offsets TMN). El engine puro vive en
 * `src/domain/dosificacion/trabajabilidadEngine.js` y consume estos params
 * vía `dbParams` (cargados en `dosificacionDisenoService`, no acá).
 *
 * Creado en la auditoría 01-calidad Fase D / C9 (sesión 2026-05-07): el
 * controller `parametroTrabajabilidadController.js` antes hacía 4 accesos
 * directos a `req.db.ParametroTrabajabilidad` violando la regla
 * controllers→services. Ahora delega en este service.
 */

const NotFoundError = (msg) => Object.assign(new Error(msg), { statusCode: 404 });

/**
 * Lista todos los parámetros activos agrupados por `tipo` (FACTOR_SE,
 * RANGO_FDA, OFFSET_TMN) y ordenados por `orden`.
 * @param {object} db - Sequelize db (multi-tenant: req.db).
 * @returns {Promise<Record<string, object[]>>}
 */
async function listAgrupados(db) {
  const rows = await db.ParametroTrabajabilidad.findAll({
    where: { activo: true },
    order: [['tipo', 'ASC'], ['orden', 'ASC']],
  });
  const grouped = {};
  for (const r of rows) {
    const t = r.tipo;
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(r);
  }
  return grouped;
}

/**
 * Crea un nuevo parámetro de trabajabilidad.
 * @param {object} db
 * @param {object} payload - body del request (Sequelize valida el shape).
 */
async function crear(db, payload) {
  return db.ParametroTrabajabilidad.create(payload);
}

/**
 * Actualiza un parámetro existente.
 * @param {object} db
 * @param {number} id
 * @param {object} payload
 * @throws {Error} con statusCode=404 si no existe.
 */
async function actualizar(db, id, payload) {
  const row = await db.ParametroTrabajabilidad.findByPk(id);
  if (!row) throw NotFoundError('Parametro no encontrado');
  await row.update(payload);
  return row;
}

/**
 * Elimina (hard delete) un parámetro.
 * @param {object} db
 * @param {number} id
 * @throws {Error} con statusCode=404 si no existe.
 */
async function eliminar(db, id) {
  const row = await db.ParametroTrabajabilidad.findByPk(id);
  if (!row) throw NotFoundError('Parametro no encontrado');
  await row.destroy();
  return { ok: true };
}

module.exports = {
  listAgrupados,
  crear,
  actualizar,
  eliminar,
};
