const { getCacheForDb } = require('./cacheHelpers');

/** TTL para prensas: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

const createPrensa = async (db, data) => {
    const transaction = await db.sequelize.transaction();
    try {

        // 1) Crear Prensa
        const newPrensa = await db.Prensa.create(
            {
                nombre: data.nombre,
                marca: data.marca || null,
                modelo: data.modelo || null,
                anio: data.anio || null,
                capacidad: data.capacidad || null,
                fechaUltimaCalibracion: data.fechaUltimaCalibracion || null,
                certificadoVigente: !!data.certificadoVigente,
                descripcion: data.descripcion || null,
                idUnidadMedidaPrensa: data.idUnidadMedidaPrensa || null,
                tipoOperacion: data.tipoOperacion || 'MANUAL',
                coeficienteUno: data.coeficienteUno || null,
                coeficienteDos: data.coeficienteDos || null,
                coeficienteTres: data.coeficienteTres || null,
                idPlanta: data.idPlanta || null,
            },
            { transaction }
        );

        await transaction.commit();
        return newPrensa;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const getPrensas = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'prensas');
    if (cached) return cached;

    try {
        const result = await db.Prensa.findAll({
            where: {activo: true},
            include: [
                { model: db.UnidadMedidaPrensa, as: "unidadMedida" },
                { model: db.Planta, as: "planta", attributes: ['idPlanta', 'nombre'] },
            ],
        });
        const plain = result.map(r => r.get({ plain: true }));
        tc.set('catalogos', 'prensas', plain, CATALOGO_TTL);
        return plain;
    } catch (error) {
        console.error("Error en getPrensas:", error);
        throw error;
    }
};

const getPrensa = async (db, idPrensa) => {
    try {
        return await db.Prensa.findByPk(idPrensa, {
            include: [
                { model: db.UnidadMedidaPrensa, as: "unidadMedida" },
                { model: db.Planta, as: "planta", attributes: ['idPlanta', 'nombre'] },
            ],
        });
    } catch (error) {
        console.error("Error en getPrensa:", error);
        throw error;
    }
};

const updatePrensa = async (db, idPrensa, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        const prensa = await db.Prensa.findByPk(idPrensa, { transaction });
        if (!prensa) {
            throw new Error("Prensa no encontrada");
        }

        // 1) Actualizar datos de la prensa
        const patch = {
            nombre: data.nombre,
            marca: data.marca,
            modelo: data.modelo,
            anio: data.anio,
            capacidad: data.capacidad,
            fechaUltimaCalibracion: data.fechaUltimaCalibracion,
            certificadoVigente: !!data.certificadoVigente,
            descripcion: data.descripcion,
            idUnidadMedidaPrensa: data.idUnidadMedidaPrensa,
            coeficienteUno: data.coeficienteUno,
            coeficienteDos: data.coeficienteDos,
            coeficienteTres: data.coeficienteTres,
            idPlanta: data.idPlanta ?? null,
        };
        if (data.tipoOperacion) patch.tipoOperacion = data.tipoOperacion;
        await prensa.update(patch, { transaction });

        await transaction.commit();
        return prensa;
    } catch (error) {
        await transaction.rollback();
        console.error("Error al actualizar la prensa:", error);
        throw error;
    }
};

const deletePrensa = async (db, idPrensa) => {
    try {
        const prensa = await db.Prensa.findByPk(idPrensa);
        if (!prensa) {
            throw new Error("Prensa no encontrada");
        }

        // 1) Eliminar la prensa
        await prensa.update({ activo: false });

        return { success: true, message: "Prensa eliminada con éxito" };
    } catch (error) {
        console.error("Error al eliminar la prensa:", error);
        throw error;
    }
};

const getUnidadesMedidaPrensa = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'unidadesMedidaPrensa');
    if (cached) return cached;

    const result = await db.UnidadMedidaPrensa.findAll({ order: [["unidad", "ASC"]] });
    const plain = result.map(r => r.get({ plain: true }));
    tc.set('catalogos', 'unidadesMedidaPrensa', plain, CATALOGO_TTL);
    return plain;
};


module.exports = {
    createPrensa,
    getPrensas,
    getPrensa,
    updatePrensa,
    deletePrensa,
    getUnidadesMedidaPrensa
};
