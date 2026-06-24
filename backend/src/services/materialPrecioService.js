'use strict';

const { Op } = require('sequelize');

/**
 * Trae historial de precios de un material en una planta.
 * Si idPlanta es null/undefined, devuelve todos los precios de todas las plantas.
 */
const getPrecios = async (db, materialSource, materialSourceId, idPlanta = null) => {
  const where = { materialSource, materialSourceId };
  if (idPlanta != null) where.idPlanta = Number(idPlanta);
  const rows = await db.MaterialPrecio.findAll({
    where,
    order: [['fechaVigencia', 'DESC'], ['id', 'DESC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

/**
 * Precio vigente para (materialSource, materialSourceId, idPlanta).
 * Vigente = fechaVigencia <= hoy AND (fechaVencimiento IS NULL OR fechaVencimiento >= hoy)
 */
const getPrecioVigente = async (db, materialSource, materialSourceId, idPlanta) => {
  const hoy = new Date().toISOString().slice(0, 10);
  const where = {
    materialSource,
    materialSourceId,
    fechaVigencia: { [Op.lte]: hoy },
    [Op.or]: [
      { fechaVencimiento: null },
      { fechaVencimiento: { [Op.gte]: hoy } },
    ],
  };
  if (idPlanta != null) where.idPlanta = Number(idPlanta);
  const row = await db.MaterialPrecio.findOne({
    where,
    order: [['fechaVigencia', 'DESC'], ['id', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
};

/**
 * Bulk: precios vigentes para varios materiales en distintas plantas.
 * Input: array de { materialSource, materialSourceId, idPlanta }
 * Returns: object keyed by `${source}_${sourceId}_${idPlanta}` → price record
 */
const getPreciosVigentesBulk = async (db, materiales) => {
  if (!materiales || materiales.length === 0) return {};

  const hoy = new Date().toISOString().slice(0, 10);
  const orConditions = materiales.map(m => ({
    materialSource: m.materialSource,
    materialSourceId: m.materialSourceId,
    ...(m.idPlanta != null ? { idPlanta: Number(m.idPlanta) } : {}),
  }));

  const rows = await db.MaterialPrecio.findAll({
    where: {
      [Op.or]: orConditions,
      fechaVigencia: { [Op.lte]: hoy },
      [Op.or]: [
        { fechaVencimiento: null },
        { fechaVencimiento: { [Op.gte]: hoy } },
      ],
    },
    order: [['fechaVigencia', 'DESC'], ['id', 'DESC']],
  });

  const result = {};
  for (const row of rows) {
    const plain = row.get({ plain: true });
    const key = `${plain.materialSource}_${plain.materialSourceId}_${plain.idPlanta}`;
    if (!result[key]) result[key] = plain;
  }
  return result;
};

/**
 * Helper: precios vigentes de un material en N plantas. Devuelve {idPlanta: precio}.
 */
const getPrecioVigenteBulkPorPlantas = async (db, materialSource, materialSourceId, idsPlanta) => {
  if (!Array.isArray(idsPlanta) || idsPlanta.length === 0) return {};
  const hoy = new Date().toISOString().slice(0, 10);
  const rows = await db.MaterialPrecio.findAll({
    where: {
      materialSource,
      materialSourceId,
      idPlanta: idsPlanta.map(Number),
      fechaVigencia: { [Op.lte]: hoy },
      [Op.or]: [
        { fechaVencimiento: null },
        { fechaVencimiento: { [Op.gte]: hoy } },
      ],
    },
    order: [['fechaVigencia', 'DESC'], ['id', 'DESC']],
  });
  const result = {};
  for (const row of rows) {
    const plain = row.get({ plain: true });
    if (!result[plain.idPlanta]) result[plain.idPlanta] = plain;
  }
  return result;
};

/**
 * Crea un precio. Si autoVencer (default true), cierra el anterior vigente
 * de la misma combinación (materialSource, materialSourceId, idPlanta).
 */
const createPrecio = async (db, data) => {
  if (!data.idPlanta) {
    throw Object.assign(new Error('Falta idPlanta en el payload de precio.'), { statusCode: 400 });
  }
  const t = await db.sequelize.transaction();
  try {
    if (data.autoVencer !== false) {
      const hoy = new Date().toISOString().slice(0, 10);
      await db.MaterialPrecio.update(
        { fechaVencimiento: data.fechaVigencia || hoy },
        {
          where: {
            materialSource: data.materialSource,
            materialSourceId: data.materialSourceId,
            idPlanta: Number(data.idPlanta),
            fechaVencimiento: null,
          },
          transaction: t,
        }
      );
    }

    const record = await db.MaterialPrecio.create({
      materialSource: data.materialSource,
      materialSourceId: data.materialSourceId,
      idPlanta: Number(data.idPlanta),
      precioUnitario: data.precioUnitario,
      unidad: data.unidad || 'kg',
      moneda: data.moneda || 'ARS',
      fechaVigencia: data.fechaVigencia,
      fechaVencimiento: data.fechaVencimiento || null,
      proveedor: data.proveedor || null,
      incluyeFlete: data.incluyeFlete || false,
      costoFlete: data.costoFlete || null,
      observaciones: data.observaciones || null,
    }, { transaction: t });

    await t.commit();
    return record.get({ plain: true });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

const updatePrecio = async (db, id, data) => {
  const record = await db.MaterialPrecio.findByPk(id);
  if (!record) throw new Error('Precio no encontrado');

  await record.update({
    precioUnitario: data.precioUnitario ?? record.precioUnitario,
    unidad: data.unidad ?? record.unidad,
    moneda: data.moneda ?? record.moneda,
    fechaVigencia: data.fechaVigencia ?? record.fechaVigencia,
    fechaVencimiento: data.fechaVencimiento !== undefined ? data.fechaVencimiento : record.fechaVencimiento,
    proveedor: data.proveedor !== undefined ? data.proveedor : record.proveedor,
    incluyeFlete: data.incluyeFlete !== undefined ? data.incluyeFlete : record.incluyeFlete,
    costoFlete: data.costoFlete !== undefined ? data.costoFlete : record.costoFlete,
    observaciones: data.observaciones !== undefined ? data.observaciones : record.observaciones,
    idPlanta: data.idPlanta != null ? Number(data.idPlanta) : record.idPlanta,
  });

  return record.get({ plain: true });
};

const deletePrecio = async (db, id) => {
  const record = await db.MaterialPrecio.findByPk(id);
  if (!record) throw new Error('Precio no encontrado');
  await record.destroy();
  return { deleted: true };
};

/**
 * Importación bulk. Cada item requiere idPlanta. Por cada (source,id,planta) cierra el vigente.
 */
const importarPrecios = async (db, items) => {
  const t = await db.sequelize.transaction();
  try {
    const results = [];
    for (const item of items) {
      if (!item.idPlanta) {
        throw new Error(`Item de precio sin idPlanta: ${JSON.stringify(item)}`);
      }
      await db.MaterialPrecio.update(
        { fechaVencimiento: item.fechaVigencia },
        {
          where: {
            materialSource: item.materialSource,
            materialSourceId: item.materialSourceId,
            idPlanta: Number(item.idPlanta),
            fechaVencimiento: null,
          },
          transaction: t,
        }
      );

      const record = await db.MaterialPrecio.create({
        materialSource: item.materialSource,
        materialSourceId: item.materialSourceId,
        idPlanta: Number(item.idPlanta),
        precioUnitario: item.precioUnitario,
        unidad: item.unidad || 'kg',
        moneda: item.moneda || 'ARS',
        fechaVigencia: item.fechaVigencia,
        fechaVencimiento: null,
        proveedor: item.proveedor || null,
        incluyeFlete: item.incluyeFlete || false,
        costoFlete: item.costoFlete || null,
        observaciones: item.observaciones || null,
      }, { transaction: t });

      results.push(record.get({ plain: true }));
    }

    await t.commit();
    return { imported: results.length, items: results };
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

module.exports = {
  getPrecios,
  getPrecioVigente,
  getPreciosVigentesBulk,
  getPrecioVigenteBulkPorPlantas,
  createPrecio,
  updatePrecio,
  deletePrecio,
  importarPrecios,
};
