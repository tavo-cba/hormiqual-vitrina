const { getCacheForDb } = require('./cacheHelpers');

/** TTL para plantas: 1 hora (invalidado por hooks) */
const PLANTAS_TTL = 3600;

const createPlanta = async (db, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        // 1. Crear Entidad
        const newEntidad = await db.Entidad.create(
            {
                tipoEntidad: 'Planta',
            },
            { transaction }
        );

        // 2. Crear la Planta
        const newPlanta = await db.Planta.create(
            {
                nombre: data.nombre,
                marca: data.marca || null,
                modelo: data.modelo || null,
                anio: data.anio,                      // Se asume que es Date
                capacidad: data.capacidad || null,
                cantidadTolvas: data.cantidadTolvas ?? null,
                fechaUltimaCalibracion: data.fechaUltimaCalibracion || null, // Date
                certificadoVigente: !!data.certificadoVigente,
                descripcion: data.descripcion || null,
                latitud: data.latitud || null,
                longitud: data.longitud || null,
                idEntidad: newEntidad.idEntidad,
                betonmaticUrl: data.betonmaticUrl || null,
                betonmaticModo: data.betonmaticModo || null,
                betonmaticActivo: !!data.betonmaticActivo,
                betonmaticCfClientId: data.betonmaticCfClientId || null,
                betonmaticCfClientSecret: data.betonmaticCfClientSecret || null,
                m3PorBatch: data.m3PorBatch ?? null,
                capacidadBalanzaCementoKg: data.capacidadBalanzaCementoKg ?? null,
                capacidadBalanzaAridosKg: data.capacidadBalanzaAridosKg ?? null,
                origenDosificaciones: data.origenDosificaciones || 'ESTATICA',
                googleMapsPlaceUrl: data.googleMapsPlaceUrl || null,
                radioVerificacionUbicacionMetros: data.radioVerificacionUbicacionMetros ?? 200,
                umbralEtaCercaMin: data.umbralEtaCercaMin ?? 15,
                umbralSinSenalMin: data.umbralSinSenalMin ?? 30,
                // RDC/HRDC (Fase 2) — null usa los defaults citados del motor.
                rdcModoDensidad: data.rdcModoDensidad || 'REDUCCION_PCT',
                rdcPuvObjetivoKgM3: data.rdcPuvObjetivoKgM3 || null,
                rdcReduccionPct: data.rdcReduccionPct ?? null,
                rdcPuvToleranciaKgM3: data.rdcPuvToleranciaKgM3 || null,
                rdcFactorAguaConsistencia: data.rdcFactorAguaConsistencia ?? null,
            },
            { transaction }
        );

        // 3. Crear Domicilio (si existe)
        if (data.domicilio) {
            await db.Domicilio.create(
                {
                    ...data.domicilio,
                    codigoPostal: data.domicilio.codigoPostal ?? null,
                    localidad: data.domicilio.localidad?.id || data.domicilio.localidad,
                    idPlanta: newPlanta.idPlanta,      // opcional
                    idEntidad: newEntidad.idEntidad,   // fundamental para la relación
                },
                { transaction }
            );
        }

        if (data.email && Array.isArray(data.email)) {
            await db.Email.bulkCreate(
                data.email.map((mail) => ({
                    ...mail,
                    idPlanta: newPlanta.idPlanta,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }


        // 4. Crear Teléfonos (contacto) si existen
        if (data.contacto && Array.isArray(data.contacto)) {
            await db.Telefono.bulkCreate(
                data.contacto.map((tel) => ({
                    ...tel,
                    idPlanta: newPlanta.idPlanta,    // opcional
                    idEntidad: newEntidad.idEntidad, // relación principal
                })),
                { transaction }
            );
        }

        await transaction.commit();
        return newPlanta;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

const getPlantas = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('plantas', 'all');
    if (cached) return cached;

    try {
        const result = await db.Planta.findAll({
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
                        },
                    ],
                },
            ],
        });
        const plain = result.map(r => r.get({ plain: true }));
        tc.set('plantas', 'all', plain, PLANTAS_TTL);
        return plain;
    } catch (error) {
        console.error('Error en getPlantas:', error);
        throw error;
    }
};

const getPlanta = async (db, idPlanta) => {
    try {
        return await db.Planta.findByPk(idPlanta, {
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
                        },
                    ],
                },
            ],
        });
    } catch (error) {
        console.error('Error en getPlanta:', error);
        throw error;
    }
};

const updatePlanta = async (db, idPlanta, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        const planta = await db.Planta.findByPk(idPlanta, { transaction });
        if (!planta) {
            throw new Error("Planta no encontrada");
        }

        // 1. Actualizar datos de la planta
        await planta.update(
            {
                nombre: data.nombre,
                marca: data.marca,
                modelo: data.modelo,
                anio: data.anio,
                capacidad: data.capacidad,
                cantidadTolvas: data.cantidadTolvas !== undefined ? (data.cantidadTolvas ?? null) : planta.cantidadTolvas,
                fechaUltimaCalibracion: data.fechaUltimaCalibracion,
                certificadoVigente: !!data.certificadoVigente,
                descripcion: data.descripcion,
                latitud: data.latitud,
                longitud: data.longitud,
                betonmaticUrl: data.betonmaticUrl || null,
                betonmaticModo: data.betonmaticModo || null,
                betonmaticActivo: data.betonmaticActivo !== undefined ? !!data.betonmaticActivo : planta.betonmaticActivo,
                betonmaticCfClientId: data.betonmaticCfClientId !== undefined ? (data.betonmaticCfClientId || null) : planta.betonmaticCfClientId,
                betonmaticCfClientSecret: data.betonmaticCfClientSecret !== undefined ? (data.betonmaticCfClientSecret || null) : planta.betonmaticCfClientSecret,
                m3PorBatch: data.m3PorBatch !== undefined ? (data.m3PorBatch ?? null) : planta.m3PorBatch,
                capacidadBalanzaCementoKg: data.capacidadBalanzaCementoKg !== undefined ? (data.capacidadBalanzaCementoKg ?? null) : planta.capacidadBalanzaCementoKg,
                capacidadBalanzaAridosKg: data.capacidadBalanzaAridosKg !== undefined ? (data.capacidadBalanzaAridosKg ?? null) : planta.capacidadBalanzaAridosKg,
                origenDosificaciones: data.origenDosificaciones !== undefined ? (data.origenDosificaciones || 'ESTATICA') : planta.origenDosificaciones,
                googleMapsPlaceUrl: data.googleMapsPlaceUrl !== undefined ? (data.googleMapsPlaceUrl || null) : planta.googleMapsPlaceUrl,
                radioVerificacionUbicacionMetros: data.radioVerificacionUbicacionMetros !== undefined ? (data.radioVerificacionUbicacionMetros ?? 200) : planta.radioVerificacionUbicacionMetros,
                umbralEtaCercaMin: data.umbralEtaCercaMin !== undefined ? (data.umbralEtaCercaMin ?? 15) : planta.umbralEtaCercaMin,
                umbralSinSenalMin: data.umbralSinSenalMin !== undefined ? (data.umbralSinSenalMin ?? 30) : planta.umbralSinSenalMin,
                // RDC/HRDC (Fase 2) — parámetros del modelo de densidad por planta.
                rdcModoDensidad: data.rdcModoDensidad !== undefined ? (data.rdcModoDensidad || 'REDUCCION_PCT') : planta.rdcModoDensidad,
                rdcPuvObjetivoKgM3: data.rdcPuvObjetivoKgM3 !== undefined ? (data.rdcPuvObjetivoKgM3 || null) : planta.rdcPuvObjetivoKgM3,
                rdcReduccionPct: data.rdcReduccionPct !== undefined ? (data.rdcReduccionPct ?? null) : planta.rdcReduccionPct,
                rdcPuvToleranciaKgM3: data.rdcPuvToleranciaKgM3 !== undefined ? (data.rdcPuvToleranciaKgM3 || null) : planta.rdcPuvToleranciaKgM3,
                rdcFactorAguaConsistencia: data.rdcFactorAguaConsistencia !== undefined ? (data.rdcFactorAguaConsistencia ?? null) : planta.rdcFactorAguaConsistencia,
            },
            { transaction }
        );

        // 2. Eliminar y volver a crear teléfonos
        if (data.contacto && Array.isArray(data.contacto)) {
            await db.Telefono.destroy({
                where: { idEntidad: planta.idEntidad },
                transaction,
            });
            if (data.contacto.length > 0) {
                await db.Telefono.bulkCreate(
                    data.contacto.map((tel) => ({
                        ...tel,
                        idPlanta: planta.idPlanta,    // opcional
                        idEntidad: planta.idEntidad,  // fundamental
                    })),
                    { transaction }
                );
            }
        }

        if (data.email && Array.isArray(data.email)) {
            await db.Email.destroy({
                where: { idEntidad: planta.idEntidad },
                transaction,
            });
            if (data.email.length > 0) {
                await db.Email.bulkCreate(
                    data.email.map((mail) => ({
                        ...mail,
                        idPlanta: planta.idPlanta,
                        idEntidad: planta.idEntidad,
                    })),
                    { transaction }
                );
            }
        }

        // 3. Actualizar domicilio
        if (data.domicilio) {
            const domicilioExistente = await db.Domicilio.findOne({
                where: { idEntidad: planta.idEntidad },
                transaction,
            });

            const domicilioData = {
                ...data.domicilio,
                codigoPostal: data.domicilio.codigoPostal ?? null,
                localidad: data.domicilio.localidad?.id || data.domicilio.localidad,
                idPlanta: planta.idPlanta,    // opcional
                idEntidad: planta.idEntidad,
            };

            if (domicilioExistente) {
                await domicilioExistente.update(domicilioData, { transaction });
            } else {
                await db.Domicilio.create(domicilioData, { transaction });
            }
        }

        await transaction.commit();
        return planta;
    } catch (error) {
        await transaction.rollback();
        console.error('Error actualizando planta:', error);
        throw error;
    }
};

const deletePlanta = async (db, idPlanta) => {
    try {
        // 1. Buscar la planta
        const planta = await db.Planta.findByPk(idPlanta);
        if (!planta) {
            throw new Error("Planta no encontrada");
        }

        await planta.update({ activo: false });

        return { success: true, message: "Planta eliminada con éxito" };
    } catch (error) {
        console.error('Error al eliminar la planta:', error);
        throw error;
    }
};

/**
 * Patch dedicado: solo los 5 campos de calibración HRDC por planta.
 *
 * Existe por separado de `updatePlanta` (full PUT) porque la UI canónica de
 * estos parámetros vive en Calidad → Catálogos → Parámetros del motor →
 * "Calibración HRDC por planta" (no en Administrar → Plantas). Sending solo
 * estos 5 campos evita arrastrar los ~22 campos generales de la planta a
 * través de la red.
 */
const updateCalibracionHRDC = async (db, idPlanta, data = {}) => {
    const planta = await db.Planta.findByPk(idPlanta);
    if (!planta) {
        throw Object.assign(new Error('Planta no encontrada'), { status: 404 });
    }
    await planta.update({
        rdcModoDensidad: data.rdcModoDensidad !== undefined ? (data.rdcModoDensidad || 'REDUCCION_PCT') : planta.rdcModoDensidad,
        rdcPuvObjetivoKgM3: data.rdcPuvObjetivoKgM3 !== undefined ? (data.rdcPuvObjetivoKgM3 || null) : planta.rdcPuvObjetivoKgM3,
        rdcReduccionPct: data.rdcReduccionPct !== undefined ? (data.rdcReduccionPct ?? null) : planta.rdcReduccionPct,
        rdcPuvToleranciaKgM3: data.rdcPuvToleranciaKgM3 !== undefined ? (data.rdcPuvToleranciaKgM3 || null) : planta.rdcPuvToleranciaKgM3,
        rdcFactorAguaConsistencia: data.rdcFactorAguaConsistencia !== undefined ? (data.rdcFactorAguaConsistencia ?? null) : planta.rdcFactorAguaConsistencia,
    });
    return planta;
};

/**
 * Devuelve las dosificaciones disponibles para crear un Despacho en la planta
 * indicada. Lee del catálogo correspondiente según `Planta.origenDosificaciones`
 * (ESTATICA → `Dosificacion` legacy; DISENADOR → `DosificacionDisenada`).
 *
 * Cada item incluye `publicableBetonmatic` (true/false) y, si false, una
 * `razonNoPublicable` legible. Si la planta no tiene Betonmatic activo, ambos
 * van null (no aplica el chequeo).
 */
const getDosificacionesParaDespacho = async (db, idPlanta) => {
    const planta = await db.Planta.findByPk(idPlanta);
    if (!planta) throw new Error('Planta no encontrada');

    const tieneBetonmatic = !!planta.betonmaticActivo;
    const origen = planta.origenDosificaciones || 'ESTATICA';

    if (origen === 'ESTATICA') {
        const filas = await db.Dosificacion.findAll({
            where: { idPlanta, activo: true },
            attributes: ['idDosificacion', 'nombre', 'codigoEnPlanta', 'codigoHormigonEnPlanta'],
            order: [['nombre', 'ASC']],
        });
        return filas.map(d => {
            let publicable = null, razon = null;
            if (tieneBetonmatic) {
                publicable = !!(d.codigoEnPlanta && d.codigoHormigonEnPlanta);
                if (!publicable) razon = 'Falta cargar los códigos de Betonmatic en la dosificación.';
            }
            return {
                id: d.idDosificacion,
                tipo: 'legacy',
                nombre: d.nombre,
                publicableBetonmatic: publicable,
                razonNoPublicable: razon,
            };
        });
    }

    // origen === 'DISENADOR'
    const ESTADOS_VALIDOS = ['A_PRUEBA', 'EN_PRODUCCION', 'APROBADO'];
    const filas = await db.DosificacionDisenada.findAll({
        where: { idPlanta, estado: ESTADOS_VALIDOS },
        attributes: ['id', 'nombre', 'codigo', 'estado'],
        order: [['nombre', 'ASC']],
    });
    if (filas.length === 0) return [];

    // Para cada dosificación, ver si tiene publicación activa.
    const ids = filas.map(d => d.id);
    const pubs = await db.BetonmaticDosificacionPublicacion.findAll({
        where: { idDosificacionDisenada: ids, estado: 'publicada' },
        attributes: ['idDosificacionDisenada'],
    });
    const publicadasSet = new Set(pubs.map(p => p.idDosificacionDisenada));

    return filas.map(d => {
        let publicable = null, razon = null;
        if (tieneBetonmatic) {
            publicable = publicadasSet.has(d.id);
            if (!publicable) razon = 'Dosificación no publicada en Betonmatic.';
        }
        return {
            id: d.id,
            tipo: 'disenador',
            nombre: d.nombre || d.codigo,
            estado: d.estado,
            publicableBetonmatic: publicable,
            razonNoPublicable: razon,
        };
    });
};

module.exports = {
    createPlanta,
    getPlantas,
    getPlanta,
    updatePlanta,
    updateCalibracionHRDC,
    deletePlanta,
    getDosificacionesParaDespacho,
};
