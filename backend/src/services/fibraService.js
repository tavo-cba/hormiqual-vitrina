const { getCacheForDb } = require('./cacheHelpers');

/** TTL para fibras: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

const _syncPlantasFibra = async (db, materialSourceId, plantasConfig) => {
    if (!Array.isArray(plantasConfig)) return;
    const matSvc = require('./materialPlantaService');
    await matSvc.sincronizarPlantas(db, 'fibra', materialSourceId, plantasConfig);
  };

  const getFibras = async (db, { includeArchived = false, idPlanta = null } = {}) => {
    const tc = getCacheForDb(db);
    const cacheKey = idPlanta == null ? 'fibras' : `fibras_p${idPlanta}_${includeArchived ? 'all' : 'active'}`;
    if (!includeArchived) {
      const cached = tc.get('catalogos', cacheKey);
      if (cached) return cached;
    }

    const where = includeArchived ? {} : { activo: true };

    if (idPlanta != null) {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'fibra', idPlanta: Number(idPlanta), activo: true },
        attributes: ['materialSourceId'],
        raw: true,
      });
      const ids = mps.map(m => m.materialSourceId);
      if (ids.length === 0) {
        if (!includeArchived) tc.set('catalogos', cacheKey, [], CATALOGO_TTL);
        return [];
      }
      where.idFibra = ids;
    }

    const result = await db.Fibra.findAll({
      where,
      include: [
        { model: db.UnidadMedida, as: "unidadMedida", attributes: ["idUnidadMedida", "unidad", "descripcion"] },
      ],
      order: [["marca", "ASC"]],
    });
    const plain = result.map(r => r.get({ plain: true }));
    if (!includeArchived) tc.set('catalogos', cacheKey, plain, CATALOGO_TTL);
    return plain;
  };

  const getFibra = async (db, id) => {
    const fibra = await db.Fibra.findByPk(id, {
      include: [{ model: db.UnidadMedida, as: "unidadMedida" }],
    });
    if (!fibra) return null;
    const plain = fibra.get({ plain: true });
    try {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'fibra', materialSourceId: Number(id) },
        include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
        order: [['idPlanta', 'ASC']],
      });
      plain.plantas = mps.map(m => m.get({ plain: true }));
      const idsPlanta = plain.plantas.map(p => p.idPlanta);
      if (idsPlanta.length > 0) {
        const { getPrecioVigenteBulkPorPlantas } = require('./materialPrecioService');
        const preciosMap = await getPrecioVigenteBulkPorPlantas(db, 'fibra', Number(id), idsPlanta);
        for (const p of plain.plantas) p.precioVigente = preciosMap[p.idPlanta] || null;
      }
    } catch (e) { console.warn('[getFibra] plantas/precios skipped:', e.message); }
    return plain;
  };

  const createFibra = async (db, data) => {
    /* Verificamos que la unidad exista */
    const unidad = await db.UnidadMedida.findByPk(data.idUnidadMedida);
    if (!unidad) throw new Error("Unidad de medida no encontrada");

    const fibra = await db.Fibra.create({
      marca:         data.marca,
      fabrica:       data.fabrica,
      funcion:       data.funcion || null,
      tipo:          ['MACRO','MICRO','OTRO'].includes(data.tipo) ? data.tipo : 'OTRO',
      idUnidadMedida:data.idUnidadMedida,
      dosisMinima:   data.dosisMinima || null,
      dosisMaxima:   data.dosisMaxima || null,
      densidad:      data.densidad   || null,
    });
    await _syncPlantasFibra(db, fibra.idFibra, data.plantasConfig);
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'fibras');
    return fibra;
  };

  const updateFibra = async (db, id, data) => {
    const fibra = await db.Fibra.findByPk(id);
    if (!fibra) throw new Error("Fibra no encontrada");

    if (data.idUnidadMedida) {
      const unidad = await db.UnidadMedida.findByPk(data.idUnidadMedida);
      if (!unidad) throw new Error("Unidad de medida no encontrada");
    }

    await fibra.update({
      marca:         data.marca,
      fabrica:       data.fabrica,
      funcion:       data.funcion,
      ...(data.tipo !== undefined ? { tipo: ['MACRO','MICRO','OTRO'].includes(data.tipo) ? data.tipo : 'OTRO' } : {}),
      idUnidadMedida:data.idUnidadMedida,
      dosisMinima:   data.dosisMinima,
      dosisMaxima:   data.dosisMaxima,
      densidad:      data.densidad,
    });

    if (data.plantasConfig !== undefined) {
      await _syncPlantasFibra(db, fibra.idFibra, data.plantasConfig);
    }
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'fibras');
    return fibra;
  };
  
  const deleteFibra = async (db, id) => {
    const fibra = await db.Fibra.findByPk(id);
    if (!fibra) throw new Error("Fibra no encontrada");

    const refs = await Promise.all([
      db.DosificacionFibras    ? db.DosificacionFibras.count({ where: { idFibra: id } })    : 0,
      db.DespachoFibrasExtra   ? db.DespachoFibrasExtra.count({ where: { idFibra: id } })   : 0,
    ]);
    const totalRefs = refs.reduce((a, b) => a + b, 0);

    const tc = getCacheForDb(db);
    if (totalRefs === 0) {
      await fibra.destroy();
      tc.del('catalogos', 'fibras');
      return { action: 'deleted', message: 'Material eliminado' };
    }

    await fibra.update({ activo: false });
    tc.del('catalogos', 'fibras');
    return { action: 'archived', message: 'Material archivado porque tiene referencias históricas' };
  };
  
  
  const restoreFibra = async (db, id) => {
    const fibra = await db.Fibra.findByPk(id);
    if (!fibra) throw new Error('Fibra no encontrada');
    await fibra.update({ activo: true });
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'fibras');
    return { action: 'restored', message: 'Material restaurado' };
  };

  module.exports = {
    getFibras,
    getFibra,
    createFibra,
    updateFibra,
    deleteFibra,
    restoreFibra,
  };
  