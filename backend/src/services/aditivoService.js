// backend/services/aditivoService.js
/*  Todos los métodos reciben `db` (req.db) para acceder a los modelos. */
const { getCacheForDb } = require('./cacheHelpers');

/** TTL para catálogos de materiales: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

const getAditivos = async (db, { includeArchived = false, idPlanta = null } = {}) => {
    const tc = getCacheForDb(db);
    const cacheKey = idPlanta == null ? 'aditivos' : `aditivos_p${idPlanta}_${includeArchived ? 'all' : 'active'}`;
    if (!includeArchived) {
      const cached = tc.get('catalogos', cacheKey);
      if (cached) return cached;
    }

    const where = includeArchived ? {} : { activo: true };

    if (idPlanta != null) {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'aditivo', idPlanta: Number(idPlanta), activo: true },
        attributes: ['materialSourceId'],
        raw: true,
      });
      const ids = mps.map(m => m.materialSourceId);
      if (ids.length === 0) {
        if (!includeArchived) tc.set('catalogos', cacheKey, [], CATALOGO_TTL);
        return [];
      }
      where.idAditivo = ids;
    }

    const result = await db.Aditivo.findAll({
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

  const getAditivo = async (db, id) => {
    const aditivo = await db.Aditivo.findByPk(id, {
      include: [{ model: db.UnidadMedida, as: "unidadMedida" }],
    });
    if (!aditivo) return null;
    const plain = aditivo.get({ plain: true });

    // Plantas asignadas
    try {
      const mps = await db.MaterialPlanta.findAll({
        where: { materialSource: 'aditivo', materialSourceId: Number(id) },
        include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
        order: [['idPlanta', 'ASC']],
      });
      plain.plantas = mps.map(m => m.get({ plain: true }));

      const idsPlanta = plain.plantas.map(p => p.idPlanta);
      if (idsPlanta.length > 0) {
        const { getPrecioVigenteBulkPorPlantas } = require('./materialPrecioService');
        const preciosMap = await getPrecioVigenteBulkPorPlantas(db, 'aditivo', Number(id), idsPlanta);
        for (const p of plain.plantas) {
          p.precioVigente = preciosMap[p.idPlanta] || null;
        }
      }
    } catch (e) {
      console.warn('[getAditivo] plantas/precios skipped:', e.message);
    }

    return plain;
  };
  
  const _syncPlantas = async (db, materialSourceId, plantasConfig) => {
    if (!Array.isArray(plantasConfig)) return;
    const matSvc = require('./materialPlantaService');
    await matSvc.sincronizarPlantas(db, 'aditivo', materialSourceId, plantasConfig);
  };

  const createAditivo = async (db, data) => {
    /* Verificamos que la unidad exista */
    const unidad = await db.UnidadMedida.findByPk(data.idUnidadMedida);
    if (!unidad) throw new Error("Unidad de medida no encontrada");

    const aditivo = await db.Aditivo.create({
      marca:         data.marca,
      fabrica:       data.fabrica,
      funcion:       data.funcion || null,
      idUnidadMedida:data.idUnidadMedida,
      tipoFuncional: data.tipoFuncional || null,
      subtipo:       data.subtipo || null,
      baseQuimica:   data.baseQuimica || null,
      densidad:      data.densidad || null,
      solidosPct:    data.solidosPct ?? null,
      unidadDosificacion: data.unidadDosificacion || null,
      dosisMinima:   data.dosisMinima ?? null,
      dosisHabitual: data.dosisHabitual ?? null,
      dosisMaxima:   data.dosisMaxima ?? null,
      reduccionAguaPctEsperada:       data.reduccionAguaPctEsperada ?? null,
      incrementoAsentamientoEsperado: data.incrementoAsentamientoEsperado ?? null,
      retencionTrabajabilidadMin:     data.retencionTrabajabilidadMin ?? null,
      retardoEsperadoMin:             data.retardoEsperadoMin ?? null,
      aireIncorporadoPctEsperado:     data.aireIncorporadoPctEsperado ?? null,
      modoEfectoSugerido:             data.modoEfectoSugerido || null,
      observaciones: data.observaciones || null,
    });
    await _syncPlantas(db, aditivo.idAditivo, data.plantasConfig);
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'aditivos');
    return aditivo;
  };

  const updateAditivo = async (db, id, data) => {
    const aditivo = await db.Aditivo.findByPk(id);
    if (!aditivo) throw new Error("Aditivo no encontrado");
  
    if (data.idUnidadMedida) {
      const unidad = await db.UnidadMedida.findByPk(data.idUnidadMedida);
      if (!unidad) throw new Error("Unidad de medida no encontrada");
    }
  
    await aditivo.update({
      marca:         data.marca,
      fabrica:       data.fabrica,
      funcion:       data.funcion,
      idUnidadMedida:data.idUnidadMedida,
      tipoFuncional: data.tipoFuncional || null,
      subtipo:       data.subtipo || null,
      baseQuimica:   data.baseQuimica || null,
      densidad:      data.densidad,
      solidosPct:    data.solidosPct ?? null,
      unidadDosificacion: data.unidadDosificacion || null,
      dosisMinima:   data.dosisMinima,
      dosisHabitual: data.dosisHabitual ?? null,
      dosisMaxima:   data.dosisMaxima,
      reduccionAguaPctEsperada:       data.reduccionAguaPctEsperada ?? null,
      incrementoAsentamientoEsperado: data.incrementoAsentamientoEsperado ?? null,
      retencionTrabajabilidadMin:     data.retencionTrabajabilidadMin ?? null,
      retardoEsperadoMin:             data.retardoEsperadoMin ?? null,
      aireIncorporadoPctEsperado:     data.aireIncorporadoPctEsperado ?? null,
      modoEfectoSugerido:             data.modoEfectoSugerido || null,
      observaciones: data.observaciones || null,
    });

    if (data.plantasConfig !== undefined) {
      await _syncPlantas(db, aditivo.idAditivo, data.plantasConfig);
    }
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'aditivos');
    return aditivo;
  };
  
const deleteAditivo = async (db, id) => {
  const aditivo = await db.Aditivo.findByPk(id);
  if (!aditivo) throw new Error("Aditivo no encontrado");

  const refs = await Promise.all([
    db.DosificacionAditivos   ? db.DosificacionAditivos.count({ where: { idAditivo: id } })   : 0,
    db.DespachoAditivosExtra  ? db.DespachoAditivosExtra.count({ where: { idAditivo: id } })  : 0,
  ]);
  const totalRefs = refs.reduce((a, b) => a + b, 0);

  const tc = getCacheForDb(db);
  if (totalRefs === 0) {
    await aditivo.destroy();
    tc.del('catalogos', 'aditivos');
    return { action: 'deleted', message: 'Material eliminado' };
  }

  await aditivo.update({ activo: false });
  tc.del('catalogos', 'aditivos');
  return { action: 'archived', message: 'Material archivado porque tiene referencias históricas' };
};

  
  /* ─────────  Catálogo de unidades  ───────── */
  const getUnidadesMedida = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'unidadesMedida');
    if (cached) return cached;

    const result = await db.UnidadMedida.findAll({ order: [["unidad", "ASC"]] });
    const plain = result.map(r => r.get({ plain: true }));
    tc.set('catalogos', 'unidadesMedida', plain, CATALOGO_TTL);
    return plain;
  };
  
  const restoreAditivo = async (db, id) => {
    const aditivo = await db.Aditivo.findByPk(id);
    if (!aditivo) throw new Error('Aditivo no encontrado');
    await aditivo.update({ activo: true });
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'aditivos');
    return { action: 'restored', message: 'Material restaurado' };
  };

  module.exports = {
    getAditivos,
    getAditivo,
    createAditivo,
    updateAditivo,
    deleteAditivo,
    restoreAditivo,
    getUnidadesMedida,
  };
  