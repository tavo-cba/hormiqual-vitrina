const { Op } = require('sequelize');

const parseBoolean = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
    }
    return undefined;
};

// RES-17: filtrar por RANGO de coverage del reporte, no por igualdad estricta.
// `fechaDesde` y `fechaHasta` son atributos del propio reporte (la ventana de
// fechas que ese reporte cubre). El usuario filtra desde el listado pidiendo
// "reportes que empiezan a partir de X y terminan antes de Y".
const buildWhere = (params = {}) => {
    const where = {};
    if (params.idEmpleado) where.idEmpleado = params.idEmpleado;
    const oficial = parseBoolean(params.oficial);
    if (oficial !== undefined) where.oficial = oficial;
    if (params.fechaDesde) {
        where.fechaDesde = { [Op.gte]: params.fechaDesde };
    }
    if (params.fechaHasta) {
        where.fechaHasta = { [Op.lte]: params.fechaHasta };
    }
    return where;
};

const getReportes = async (db, params = {}) => {
    return db.ReporteResistencia.findAll({
        where: buildWhere(params),
        include: [
            {
                model: db.Empleado,
                as: 'empleado',
            },
            {
                model: db.Probeta,
                as: 'probetas',
                through: { attributes: [] },
                include: [
                    {
                        model: db.Muestra,
                        as: 'muestra',
                        attributes: ['idDespacho'],
                        include: [
                            {
                                model: db.Despacho,
                                as: 'despacho',
                                attributes: ['idCliente', 'fecha'],
                                include: [
                                    {
                                        model: db.Cliente,
                                        as: 'cliente',
                                        attributes: ['tipoPersona', 'nombre', 'apellido', 'razonSocial']
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        model: db.MuestraTerceros,
                        as: 'muestraTerceros',
                        attributes: ['idCliente', 'fecha'],
                        include: [
                            {
                                model: db.Cliente,
                                as: 'cliente',
                                attributes: ['tipoPersona', 'nombre', 'apellido', 'razonSocial']
                            }
                        ]
                    }
                ],
            },
        ],
        order: [['createdAt', 'DESC']],
    });
};


const getReporte = async (db, id) => {
    const reporte = await db.ReporteResistencia.findByPk(id, {
        include: [
            { model: db.Empleado, as: 'empleado' },
            {
                model: db.Probeta,
                as: 'probetas',
                through: { attributes: [] },
            },
        ],
    });
    if (!reporte) throw new Error('ReporteResistencia no encontrado');
    return reporte;
};

const createReporte = async (db, data, idEmpleado) => {
    const empleadoId = data.idEmpleado ?? idEmpleado;
    if (!empleadoId) {
        throw new Error('idEmpleado es requerido');
    }

    const transaction = await db.sequelize.transaction();
    try {
        const reporte = await db.ReporteResistencia.create({
            link: data.link,
            fechaDesde: data.fechaDesde ?? null,
            fechaHasta: data.fechaHasta ?? null,
            oficial: data.oficial ?? false,
            idEmpleado: empleadoId,
        }, { transaction });

        const idProbetas = Array.isArray(data.idProbetas)
            ? data.idProbetas
            : [];

        if (reporte.oficial && idProbetas.length) {
            await db.ReporteResistenciaProbeta.bulkCreate(
                idProbetas.map((idProbeta) => ({
                    idReporteResistencia: reporte.idReporteResistencia,
                    idProbeta,
                })),
                { transaction },
            );
        }

        await transaction.commit();
        return getReporte(db, reporte.idReporteResistencia);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const updateReporte = async (db, id, data) => {
    const reporte = await db.ReporteResistencia.findByPk(id);
    if (!reporte) throw new Error('ReporteResistencia no encontrado');

    const transaction = await db.sequelize.transaction();
    try {
        await reporte.update({
            link: data.link !== undefined ? data.link : reporte.link,
            fechaDesde: data.fechaDesde !== undefined ? data.fechaDesde : reporte.fechaDesde,
            fechaHasta: data.fechaHasta !== undefined ? data.fechaHasta : reporte.fechaHasta,
            oficial: data.oficial !== undefined ? data.oficial : reporte.oficial,
            idEmpleado: data.idEmpleado !== undefined ? data.idEmpleado : reporte.idEmpleado,
        }, { transaction });

        if (Array.isArray(data.idProbetas) || data.oficial === false) {
            await db.ReporteResistenciaProbeta.destroy({
                where: { idReporteResistencia: reporte.idReporteResistencia },
                transaction,
            });
        }

        if ((data.oficial ?? reporte.oficial) && Array.isArray(data.idProbetas)) {
            const idProbetas = data.idProbetas;
            if (idProbetas.length) {
                await db.ReporteResistenciaProbeta.bulkCreate(
                    idProbetas.map((idProbeta) => ({
                        idReporteResistencia: reporte.idReporteResistencia,
                        idProbeta,
                    })),
                    { transaction },
                );
            }
        }

        await transaction.commit();
        return getReporte(db, reporte.idReporteResistencia);
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const deleteReporte = async (db, id) => {
    const reporte = await db.ReporteResistencia.findByPk(id);
    if (!reporte) throw new Error('ReporteResistencia no encontrado');

    const transaction = await db.sequelize.transaction();
    try {
        await db.ReporteResistenciaProbeta.destroy({
            where: { idReporteResistencia: reporte.idReporteResistencia },
            transaction,
        });
        await reporte.destroy({ transaction });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    return { message: 'ReporteResistencia eliminado correctamente' };
};

module.exports = {
    getReportes,
    getReporte,
    createReporte,
    updateReporte,
    deleteReporte,
};