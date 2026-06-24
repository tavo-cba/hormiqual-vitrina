const { getCacheForDb } = require('./cacheHelpers');

/** TTL para aguas: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

const _listarPlantasDeAgua = async (db, idAgua) => {
    if (!db.MaterialPlanta) return [];
    const matSvc = require('./materialPlantaService');
    return matSvc.listarPlantasDeMaterial(db, 'agua', idAgua);
};

const _syncPlantasAgua = async (db, idAgua, plantasConfig, opts = {}) => {
    if (!Array.isArray(plantasConfig)) return;
    const matSvc = require('./materialPlantaService');
    await matSvc.sincronizarPlantas(db, 'agua', idAgua, plantasConfig);
    const primeraActiva = plantasConfig.find((p) => p && p.idPlanta && p.activo !== false);
    const idPlantaCache = primeraActiva ? Number(primeraActiva.idPlanta) : null;
    const agua = await db.Agua.findByPk(idAgua, opts.transaction ? { transaction: opts.transaction } : undefined);
    if (agua && agua.idPlanta !== idPlantaCache) {
        await agua.update({ idPlanta: idPlantaCache }, opts.transaction ? { transaction: opts.transaction } : undefined);
    }
};

const getAguas = async (db, { includeArchived = false } = {}) => {
    const tc = getCacheForDb(db);
    if (!includeArchived) {
      const cached = tc.get('catalogos', 'aguas');
      if (cached) return cached;
    }

    try {
        const where = includeArchived ? {} : { activo: true };
        const result = await db.Agua.findAll({
            where,
            include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false }],
        });
        const plain = result.map(r => r.get({ plain: true }));

        if (db.MaterialPlanta && plain.length > 0) {
            const ids = plain.map(p => p.idAgua);
            const mps = await db.MaterialPlanta.findAll({
                where: { materialSource: 'agua', materialSourceId: ids },
                include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
                order: [['idPlanta', 'ASC']],
            });
            const byAgua = new Map();
            for (const mp of mps) {
                const r = mp.get({ plain: true });
                if (!byAgua.has(r.materialSourceId)) byAgua.set(r.materialSourceId, []);
                byAgua.get(r.materialSourceId).push(r);
            }
            for (const p of plain) {
                p.plantas = byAgua.get(p.idAgua) || [];
            }
        }

        if (!includeArchived) tc.set('catalogos', 'aguas', plain, CATALOGO_TTL);
        return plain;
    } catch (error) {
        console.error("Error en getAguas:", error);
        throw error;
    }
};

const getAgua = async (db, id) => {
    try {
        const agua = await db.Agua.findByPk(id, {
            include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false }],
        });
        if (!agua) return null;
        const plain = agua.get({ plain: true });
        plain.plantas = await _listarPlantasDeAgua(db, Number(id));
        return plain;
    } catch (error) {
        console.error("Error en getAgua:", error);
        throw error;
    }
};

/**
 * Normaliza la entrada de plantas. Acepta `plantasConfig` (array nuevo) o el
 * `idPlanta` legacy (un solo valor) y devuelve el array unificado, o null si
 * el caller no quiere tocar la asignación.
 */
const _resolverPlantasConfig = (data) => {
    if (Array.isArray(data.plantasConfig)) return data.plantasConfig;
    if (data.idPlanta !== undefined) {
        return data.idPlanta ? [{ idPlanta: Number(data.idPlanta), activo: true }] : [];
    }
    return null;
};

const createAgua = async (db, data) => {
    try {
        const plantasConfigInput = _resolverPlantasConfig(data) || [];
        const idPlantaCache = plantasConfigInput.find((p) => p?.activo !== false)?.idPlanta || null;

        const nuevaAgua = await db.Agua.create({
            nombre: data.nombre,
            fuenteOrigen: data.fuenteOrigen || null,
            idPlanta: idPlantaCache,
            laboratorio: data.laboratorio || null,
            observaciones: data.observaciones || null,
        });

        if (plantasConfigInput.length > 0 && db.MaterialPlanta) {
            try {
                await _syncPlantasAgua(db, nuevaAgua.idAgua, plantasConfigInput);
            } catch (e) {
                console.warn('[createAgua] sync plantas falló (non-blocking):', e.message);
            }
        }

        const tc = getCacheForDb(db);
        tc.del('catalogos', 'aguas');
        return nuevaAgua;
    } catch (error) {
        console.error("Error en createAgua:", error);
        throw error;
    }
};

const updateAgua = async (db, id, data) => {
    try {
        const agua = await db.Agua.findByPk(id);
        if (!agua) {
            throw new Error("Agua no encontrada");
        }

        const updateFields = {
            nombre: data.nombre,
            fuenteOrigen: data.fuenteOrigen || null,
            laboratorio: data.laboratorio || null,
            observaciones: data.observaciones || null,
        };
        // `idPlanta` ya no se setea desde el body — es caché que recalcula
        // _syncPlantasAgua a partir de plantasConfig.
        await agua.update(updateFields);

        const plantasConfigInput = _resolverPlantasConfig(data);
        if (plantasConfigInput !== null && db.MaterialPlanta) {
            try {
                await _syncPlantasAgua(db, agua.idAgua, plantasConfigInput);
            } catch (e) {
                console.warn('[updateAgua] sync plantas falló (non-blocking):', e.message);
            }
        }

        const tc = getCacheForDb(db);
        tc.del('catalogos', 'aguas');
        return agua;
    } catch (error) {
        console.error("Error en updateAgua:", error);
        throw error;
    }
};

const deleteAgua = async (db, id) => {
    try {
        const agua = await db.Agua.findByPk(id);
        if (!agua) throw new Error("Agua no encontrada");

        await agua.update({ activo: false });
        const tc = getCacheForDb(db);
        tc.del('catalogos', 'aguas');
        return { action: 'archived', message: 'Material archivado' };
    } catch (error) {
        console.error("Error en deleteAgua:", error);
        throw error;
    }
};

const restoreAgua = async (db, id) => {
    const agua = await db.Agua.findByPk(id);
    if (!agua) throw new Error('Agua no encontrada');
    await agua.update({ activo: true });
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'aguas');
    return { action: 'restored', message: 'Material restaurado' };
};

module.exports = {
    getAguas,
    getAgua,
    createAgua,
    updateAgua,
    deleteAgua,
    restoreAgua
};
