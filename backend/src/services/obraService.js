const { getCacheForDb } = require('./cacheHelpers');

/** TTL para lista de obras: 30 min (invalidado por hooks) */
const OBRAS_TTL = 1800;

const createObra = async (db, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        // 1️⃣ Crear la entidad asociada a la Obra
        const newEntidad = await db.Entidad.create(
            {
                tipoEntidad: 'Obra',
            },
            { transaction }
        );

        // 2️⃣ Crear la Obra
        const newObra = await db.Obra.create(
            {
                nombre: data.nombre,
                infoAdicional: data.infoAdicional || null,
                latitud: data.latitud || null,
                longitud: data.longitud || null,
                idEntidad: newEntidad.idEntidad,
                // Campos de obra propia (Fase ①)
                obraPropia: data.obraPropia ?? false,
                idGestor: data.idGestor || null,
                fechaInicio: data.fechaInicio || null,
                fechaFinPrevista: data.fechaFinPrevista || null,
                presupuesto: data.presupuesto ?? null,
                estadoObra: data.estadoObra || 'planificada',
                // Si manejas 'deleted_at' para soft delete, no lo seteas aquí
            },
            { transaction }
        );

        // 3️⃣ Crear Domicilio si existe
        if (data.domicilio) {
            await db.Domicilio.create(
                {
                    ...data.domicilio,
                    codigoPostal: data.domicilio.codigoPostal ?? null,
                    localidad: data.domicilio.localidad?.id || data.domicilio.localidad,
                    idObra: newObra.idObra,       // si guardas la referencia
                    idEntidad: newEntidad.idEntidad
                },
                { transaction }
            );
        }

        if (data.email && Array.isArray(data.email)) {
            await db.Email.bulkCreate(
                data.email.map(mail => ({
                    ...mail,
                    idObra: newObra.idObra,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }


        // 4️⃣ Crear Teléfonos si existen
        if (data.contacto && Array.isArray(data.contacto)) {
            await db.Telefono.bulkCreate(
                data.contacto.map(tel => ({
                    ...tel,
                    idObra: newObra.idObra,      // opcional
                    idEntidad: newEntidad.idEntidad
                })),
                { transaction }
            );
        }

        await transaction.commit();
        return newObra;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const getObras = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('obras', 'all');
    if (cached) return cached;

    try {
        const result = await db.Obra.findAll({
            where: { activo: true },
            include: [
                {
                    model: db.Entidad,
                    as: 'entidad',
                    include: [
                        {
                            model: db.Domicilio,
                            as: 'domicilio',
                        },
                        {
                            model: db.Telefono,
                            as: 'telefono',
                        },
                        {
                            model: db.Email,
                            as: 'email',
                        }
                    ]
                }
            ]
        });
        const plain = result.map(r => r.get({ plain: true }));
        tc.set('obras', 'all', plain, OBRAS_TTL);
        return plain;
    } catch (error) {
        console.error("Error en getObras:", error);
        throw error;
    }
};

const getObra = async (db, idObra) => {
    try {
        return await db.Obra.findByPk(idObra, {
            include: [
                {
                    model: db.Entidad,
                    as: 'entidad',
                    include: [
                        {
                            model: db.Domicilio,
                            as: 'domicilio',
                        },
                        {
                            model: db.Telefono,
                            as: 'telefono',
                        },
                        {
                            model: db.Email,
                            as: 'email',
                        }
                    ]
                },
                {
                    model: db.Empleado,
                    as: 'gestor',
                    attributes: ['idEmpleado', 'nombre', 'apellido'],
                    required: false,
                },
                {
                    model: db.ObraEmpleado,
                    as: 'empleadosObra',
                    required: false,
                    include: [{
                        model: db.Empleado,
                        as: 'empleado',
                        attributes: ['idEmpleado', 'nombre', 'apellido'],
                    }],
                },
                {
                    model: db.ObraCentroCosto,
                    as: 'centrosCosto',
                    required: false,
                    include: [{
                        model: db.CentroCosto,
                        as: 'centroCosto',
                        attributes: ['idCentroCosto', 'nombre'],
                    }],
                },
            ]
        });
    } catch (error) {
        console.error("Error en getObra:", error);
        throw error;
    }
};

/**
 * Lista las obras propias activas (para la pestaña "Propias" del admin).
 * No usa el caché de getObras porque devuelve un conjunto distinto.
 */
const getObrasPropias = async (db) => {
    try {
        const result = await db.Obra.findAll({
            where: { activo: true, obraPropia: true },
            include: [
                {
                    model: db.Empleado,
                    as: 'gestor',
                    attributes: ['idEmpleado', 'nombre', 'apellido'],
                    required: false,
                },
                {
                    model: db.ObraCentroCosto,
                    as: 'centrosCosto',
                    required: false,
                    attributes: ['idObraCentroCosto', 'idCentroCosto'],
                },
            ],
            order: [['nombre', 'ASC']],
        });
        return result.map(r => r.get({ plain: true }));
    } catch (error) {
        console.error("Error en getObrasPropias:", error);
        throw error;
    }
};

const updateObra = async (db, idObra, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        const obra = await db.Obra.findByPk(idObra, { transaction });
        if (!obra) {
            throw new Error("Obra no encontrada");
        }

        // Actualizar los campos de la obra
        const camposObra = {
            nombre: data.nombre,
            infoAdicional: data.infoAdicional,
            latitud: data.latitud,
            longitud: data.longitud,
        };
        // Campos de obra propia (Fase ①) — solo si vienen en el payload
        if (data.obraPropia !== undefined) camposObra.obraPropia = data.obraPropia;
        if (data.idGestor !== undefined) camposObra.idGestor = data.idGestor || null;
        if (data.fechaInicio !== undefined) camposObra.fechaInicio = data.fechaInicio || null;
        if (data.fechaFinPrevista !== undefined) camposObra.fechaFinPrevista = data.fechaFinPrevista || null;
        if (data.presupuesto !== undefined) camposObra.presupuesto = data.presupuesto ?? null;
        if (data.estadoObra !== undefined) camposObra.estadoObra = data.estadoObra || 'planificada';
        await obra.update(camposObra, { transaction });

        // Actualizar teléfonos (eliminar todos y volver a crear)
        if (data.contacto && Array.isArray(data.contacto)) {
            await db.Telefono.destroy({
                where: { idEntidad: obra.idEntidad },
                transaction
            });
            if (data.contacto.length > 0) {
                await db.Telefono.bulkCreate(
                    data.contacto.map(tel => ({
                        ...tel,
                        idObra: obra.idObra,  // opcional
                        idEntidad: obra.idEntidad
                    })),
                    { transaction }
                );
            }
        }
        if (data.email && Array.isArray(data.email)) {
            await db.Email.destroy({
                where: { idEntidad: obra.idEntidad },
                transaction
            });
            if (data.email.length > 0) {
                await db.Email.bulkCreate(
                    data.email.map(mail => ({
                        ...mail,
                        idObra: obra.idObra,
                        idEntidad: obra.idEntidad,
                    })),
                    { transaction }
                );
            }
        }
        // Actualizar domicilio (si viene en data)
                if (data.domicilio) {
            const domicilioExistente = await db.Domicilio.findOne({
                where: { idEntidad: obra.idEntidad },
                transaction
            });

            const domicilioData = {
                ...data.domicilio,
                codigoPostal: data.domicilio.codigoPostal ?? null,
                localidad: data.domicilio.localidad?.id || data.domicilio.localidad,
                idObra: obra.idObra,       // opcional
                idEntidad: obra.idEntidad
            };

            if (domicilioExistente) {
                await domicilioExistente.update(domicilioData, { transaction });
            } else {
                await db.Domicilio.create(domicilioData, { transaction });
            }
        }

        await transaction.commit();
        return obra;
    } catch (error) {
        await transaction.rollback();
        console.error("Error al actualizar la obra:", error);
        throw error;
    }
};

const deleteObra = async (db, idObra) => {
    const transaction = await db.sequelize.transaction();
    try {
        const obra = await db.Obra.findByPk(idObra, { transaction });
        if (!obra) {
            throw new Error("Obra no encontrada");
        }

        // Liberar los centros de costo y las asignaciones de empleados de la obra.
        // Esto permite reutilizar esos centros de costo en una obra nueva (el índice
        // único en ObraCentroCosto.idCentroCosto se libera al borrar las filas).
        if (db.ObraCentroCosto) {
            await db.ObraCentroCosto.destroy({ where: { idObra }, transaction });
        }
        if (db.ObraEmpleado) {
            await db.ObraEmpleado.destroy({ where: { idObra }, transaction });
        }

        // Borrado lógico de la obra
        await obra.update({ activo: false }, { transaction });

        await transaction.commit();
        return { success: true, message: "Obra eliminada con éxito" };
    } catch (error) {
        await transaction.rollback();
        console.error("Error al eliminar la obra:", error);
        throw error;
    }
};

module.exports = {
    createObra,
    getObras,
    getObra,
    getObrasPropias,
    updateObra,
    deleteObra
};
