const { getCacheForDb } = require('./cacheHelpers');

/** TTL para cementos: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

const invalidateCementosCache = (db) => {
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'cementos');
};

/**
 * Lista cementos. Si se pasa idPlanta, filtra a los cementos habilitados (CementoPlanta.activo) en esa planta.
 */
const getCementos = async (db, { includeArchived = false, idPlanta = null } = {}) => {
    const tc = getCacheForDb(db);
    const cacheKey = idPlanta == null ? 'cementos' : `cementos_p${idPlanta}_${includeArchived ? 'all' : 'active'}`;
    if (!includeArchived) {
        const cached = tc.get('catalogos', cacheKey);
        if (cached) return cached;
    }

    try {
        const where = includeArchived ? {} : { activo: true };
        let cpsByCemento = null;

        if (idPlanta != null) {
            // Subconsulta: solo cementos con CementoPlanta(activo=1) en la planta dada
            const cps = await db.CementoPlanta.findAll({
                where: { idPlanta: Number(idPlanta), activo: true },
                raw: true,
            });
            const ids = cps.map(c => c.idCemento);
            if (ids.length === 0) {
                if (!includeArchived) tc.set('catalogos', cacheKey, [], CATALOGO_TTL);
                return [];
            }
            where.idCemento = ids;
            cpsByCemento = Object.fromEntries(cps.map(c => [c.idCemento, c]));
        }

        const result = await db.Cemento.findAll({ where });
        const plain = result.map(r => {
            const obj = r.get({ plain: true });
            if (cpsByCemento) {
                const cp = cpsByCemento[obj.idCemento];
                if (cp) {
                    obj.cementoPlantaConfig = {
                        idCementoPlanta: cp.idCementoPlanta,
                        modoCurva: cp.modoCurva,
                        factorAjuste: cp.factorAjuste != null ? Number(cp.factorAjuste) : 1.0,
                        idCurvaPropia: cp.idCurvaPropia || null,
                        activo: cp.activo,
                    };
                }
            }
            return obj;
        });
        if (!includeArchived) tc.set('catalogos', cacheKey, plain, CATALOGO_TTL);
        return plain;
    } catch (error) {
        console.error("Error en getCementos:", error);
        throw error;
    }
};

/**
 * Trae cemento + configuracionPorPlanta[] (CementoPlanta) y precios vigentes por planta.
 */
const getCemento = async (db, id) => {
    try {
        const cemento = await db.Cemento.findByPk(id);
        if (!cemento) return null;
        const plain = cemento.get({ plain: true });

        // Configuración por planta
        const configs = await db.CementoPlanta.findAll({
            where: { idCemento: id },
            include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
            order: [['idPlanta', 'ASC']],
        });
        plain.configuracionPorPlanta = configs.map(c => c.get({ plain: true }));

        // Adjuntar nombre de la curva propia cuando aplique
        const idsCurvaPropia = plain.configuracionPorPlanta
            .map(c => c.idCurvaPropia)
            .filter((v) => v != null);
        if (idsCurvaPropia.length > 0 && db.CurvaCemento) {
            const curvas = await db.CurvaCemento.findAll({
                where: { id: idsCurvaPropia },
                attributes: ['id', 'nombre', 'origenCurva'],
            });
            const curvaMap = Object.fromEntries(curvas.map(c => [c.id, c.get({ plain: true })]));
            for (const c of plain.configuracionPorPlanta) {
                c.curvaPropia = c.idCurvaPropia ? curvaMap[c.idCurvaPropia] || null : null;
            }
        }

        // Precios vigentes por planta
        try {
            const { getPrecioVigenteBulkPorPlantas } = require('./materialPrecioService');
            if (getPrecioVigenteBulkPorPlantas) {
                const idsPlanta = plain.configuracionPorPlanta.map(c => c.idPlanta);
                const preciosMap = await getPrecioVigenteBulkPorPlantas(db, 'cemento', id, idsPlanta);
                for (const c of plain.configuracionPorPlanta) {
                    c.precioVigente = preciosMap[c.idPlanta] || null;
                }
            }
        } catch (e) {
            console.warn('[getCemento] precio vigente skipped:', e.message);
        }

        return plain;
    } catch (error) {
        console.error("Error en getCemento:", error);
        throw error;
    }
};

/**
 * Crea cemento + (opcional) plantasConfig[] que siembra CementoPlanta para cada planta.
 * plantasConfig: [{ idPlanta, modoCurva, factorAjuste, idCurvaPropia?, observaciones? }]
 */
const createCemento = async (db, data) => {
    const t = await db.sequelize.transaction();
    try {
        let propiedadesStr = data.propiedades;
        if (Array.isArray(data.propiedades)) {
            propiedadesStr = data.propiedades.join(",");
        }

        const nuevoCemento = await db.Cemento.create({
            nombreComercial: data.nombreComercial,
            fabricante: data.fabricante,
            origenFabrica: data.origenFabrica || null,
            composicion: data.composicion || null,
            resistencia: data.resistencia || null,
            propiedades: propiedadesStr || "",
            familiaCemento: data.familiaCemento || null,
            tipoNormativo: data.tipoNormativo || null,
            desarrolloResistencia: data.desarrolloResistencia || null,
            densidadRelativa: data.densidadRelativa ?? null,
            edadReferenciaDefault: data.edadReferenciaDefault ?? null,
            observaciones: data.observaciones || null,
        }, { transaction: t });

        const plantasConfig = Array.isArray(data.plantasConfig) ? data.plantasConfig : [];
        for (const cfg of plantasConfig) {
            if (!cfg.idPlanta) continue;
            await db.CementoPlanta.create({
                idCemento: nuevoCemento.idCemento,
                idPlanta: Number(cfg.idPlanta),
                modoCurva: cfg.modoCurva || 'ICPA',
                factorAjuste: cfg.factorAjuste != null ? Number(cfg.factorAjuste) : 1.000,
                idCurvaPropia: cfg.idCurvaPropia || null,
                observaciones: cfg.observaciones || null,
                activo: cfg.activo !== false,
            }, { transaction: t });
        }

        await t.commit();
        invalidateCementosCache(db);
        return nuevoCemento;
    } catch (error) {
        await t.rollback();
        console.error("Error en createCemento:", error);
        throw error;
    }
};

/**
 * Actualiza ficha del cemento. Si viene plantasConfig[], sincroniza CementoPlanta:
 * - Items con idCementoPlanta → update
 * - Items sin idCementoPlanta → create
 * - Items existentes no incluidos → desactivan (activo=false), no se borran (preservar histórico)
 */
const updateCemento = async (db, id, data) => {
    const t = await db.sequelize.transaction();
    try {
        const cemento = await db.Cemento.findByPk(id);
        if (!cemento) throw new Error("Cemento no encontrado");

        let propiedadesStr = data.propiedades;
        if (Array.isArray(data.propiedades)) {
            propiedadesStr = data.propiedades.join(",");
        }

        await cemento.update({
            nombreComercial: data.nombreComercial,
            fabricante: data.fabricante,
            origenFabrica: data.origenFabrica || null,
            composicion: data.composicion,
            resistencia: data.resistencia,
            propiedades: propiedadesStr || "",
            familiaCemento: data.familiaCemento || null,
            tipoNormativo: data.tipoNormativo || null,
            desarrolloResistencia: data.desarrolloResistencia || null,
            densidadRelativa: data.densidadRelativa ?? null,
            edadReferenciaDefault: data.edadReferenciaDefault ?? null,
            observaciones: data.observaciones || null,
        }, { transaction: t });

        if (Array.isArray(data.plantasConfig)) {
            const existentes = await db.CementoPlanta.findAll({ where: { idCemento: id }, transaction: t });
            const existentesById = new Map(existentes.map(e => [e.idCementoPlanta, e]));
            const existentesByPlanta = new Map(existentes.map(e => [e.idPlanta, e]));
            const plantasIncluidas = new Set();

            for (const cfg of data.plantasConfig) {
                if (!cfg.idPlanta) continue;
                plantasIncluidas.add(Number(cfg.idPlanta));

                const matchById = cfg.idCementoPlanta ? existentesById.get(cfg.idCementoPlanta) : null;
                const matchByPlanta = !matchById ? existentesByPlanta.get(Number(cfg.idPlanta)) : null;
                const existing = matchById || matchByPlanta;

                if (existing) {
                    await existing.update({
                        modoCurva: cfg.modoCurva || existing.modoCurva,
                        factorAjuste: cfg.factorAjuste != null ? Number(cfg.factorAjuste) : existing.factorAjuste,
                        idCurvaPropia: cfg.idCurvaPropia !== undefined ? cfg.idCurvaPropia : existing.idCurvaPropia,
                        observaciones: cfg.observaciones !== undefined ? cfg.observaciones : existing.observaciones,
                        activo: cfg.activo !== false,
                    }, { transaction: t });
                } else {
                    await db.CementoPlanta.create({
                        idCemento: id,
                        idPlanta: Number(cfg.idPlanta),
                        modoCurva: cfg.modoCurva || 'ICPA',
                        factorAjuste: cfg.factorAjuste != null ? Number(cfg.factorAjuste) : 1.000,
                        idCurvaPropia: cfg.idCurvaPropia || null,
                        observaciones: cfg.observaciones || null,
                        activo: cfg.activo !== false,
                    }, { transaction: t });
                }
            }

            // Desactivar las plantas no incluidas (preserva histórico, no borra)
            for (const e of existentes) {
                if (!plantasIncluidas.has(e.idPlanta) && e.activo) {
                    await e.update({ activo: false }, { transaction: t });
                }
            }
        }

        await t.commit();
        invalidateCementosCache(db);
        return cemento;
    } catch (error) {
        await t.rollback();
        console.error("Error en updateCemento:", error);
        throw error;
    }
};

const deleteCemento = async (db, id) => {
    try {
        const cemento = await db.Cemento.findByPk(id);
        if (!cemento) throw new Error("Cemento no encontrado");

        const refs = await Promise.all([
            db.DosificacionCemento    ? db.DosificacionCemento.count({ where: { idCemento: id } })    : 0,
            db.DespachoCementosExtra  ? db.DespachoCementosExtra.count({ where: { idCemento: id } })  : 0,
        ]);
        const totalRefs = refs.reduce((a, b) => a + b, 0);

        if (totalRefs === 0) {
            await cemento.destroy();
            invalidateCementosCache(db);
            return { action: 'deleted', message: 'Material eliminado' };
        }

        await cemento.update({ activo: false });
        invalidateCementosCache(db);
        return { action: 'archived', message: 'Material archivado porque tiene referencias históricas' };
    } catch (error) {
        console.error("Error en deleteCemento:", error);
        throw error;
    }
};

const restoreCemento = async (db, id) => {
    const cemento = await db.Cemento.findByPk(id);
    if (!cemento) throw new Error('Cemento no encontrado');
    await cemento.update({ activo: true });
    invalidateCementosCache(db);
    return { action: 'restored', message: 'Material restaurado' };
};

module.exports = {
    getCementos,
    getCemento,
    createCemento,
    updateCemento,
    deleteCemento,
    restoreCemento,
};
