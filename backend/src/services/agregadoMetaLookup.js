'use strict';

const { QueryTypes } = require('sequelize');

const META_COLUMN_CANDIDATES = ['subtipoMaterial', 'tipoGruesoOrigen', 'tipoAgregadoGrueso'];
const metaColumnCache = new WeakMap();

async function resolveMetaFormaColumn(db) {
  const sequelize = db?.sequelize;
  if (!sequelize || typeof sequelize.getQueryInterface !== 'function') {
    return 'subtipoMaterial';
  }

  if (metaColumnCache.has(sequelize)) {
    return metaColumnCache.get(sequelize);
  }

  try {
    const columns = await sequelize.getQueryInterface().describeTable('AgregadoMeta');
    const resolved = META_COLUMN_CANDIDATES.find((column) => columns?.[column]) || null;
    metaColumnCache.set(sequelize, resolved);
    return resolved;
  } catch (_) {
    metaColumnCache.set(sequelize, null);
    return null;
  }
}

async function getAggregateFormaMetaMap(db, aggregateIds = []) {
  const uniqueIds = [...new Set((aggregateIds || []).filter(Boolean))];
  if (uniqueIds.length === 0 || !db?.AgregadoMeta) {
    return {};
  }

  const column = await resolveMetaFormaColumn(db);
  if (!column) {
    return {};
  }

  const sequelize = db?.sequelize;
  if (sequelize && typeof sequelize.query === 'function') {
    try {
      const rows = await sequelize.query(
        `SELECT legacyAgregadoId, \`${column}\` AS formaMeta FROM \`AgregadoMeta\` WHERE legacyAgregadoId IN (:aggregateIds)`,
        {
          replacements: { aggregateIds: uniqueIds },
          type: QueryTypes.SELECT,
        },
      );

      return rows.reduce((acc, row) => {
        if (row?.formaMeta) acc[row.legacyAgregadoId] = row.formaMeta;
        return acc;
      }, {});
    } catch (_) {
      return {};
    }
  }

  if (column !== 'subtipoMaterial' || typeof db.AgregadoMeta.findAll !== 'function') {
    return {};
  }

  try {
    const rows = await db.AgregadoMeta.findAll({
      where: { legacyAgregadoId: uniqueIds },
      attributes: ['legacyAgregadoId', 'subtipoMaterial'],
      raw: true,
    });

    return rows.reduce((acc, row) => {
      if (row?.subtipoMaterial) acc[row.legacyAgregadoId] = row.subtipoMaterial;
      return acc;
    }, {});
  } catch (_) {
    return {};
  }
}

module.exports = {
  getAggregateFormaMetaMap,
  resolveMetaFormaColumn,
};