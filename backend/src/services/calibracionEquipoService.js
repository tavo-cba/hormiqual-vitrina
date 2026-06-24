const { getCacheForDb } = require('./cacheHelpers');

/**
 * Service de CalibracionEquipo.
 *
 * Histórico de calibraciones por equipo. Al crear o anular una
 * calibración se actualizan los campos denormalizados de
 * `EquipoLaboratorio` (fechaUltimaCalibracion, certificadoVigente,
 * coeficienteUno/Dos/Tres) para que los listados no requieran joins.
 */

const invalidate = (db) => {
    const tc = getCacheForDb(db);
    tc.invalidate('equipos');
    tc.invalidate('calibraciones');
};

const validate = (data) => {
    if (!data.idEquipo) {
        const e = new Error('idEquipo es obligatorio');
        e.status = 400;
        throw e;
    }
    if (!data.fechaCalibracion) {
        const e = new Error('fechaCalibracion es obligatoria');
        e.status = 400;
        throw e;
    }
    if (!data.fechaVencimiento) {
        const e = new Error('fechaVencimiento es obligatoria');
        e.status = 400;
        throw e;
    }
    if (new Date(data.fechaVencimiento) < new Date(data.fechaCalibracion)) {
        const e = new Error('fechaVencimiento debe ser posterior a fechaCalibracion');
        e.status = 400;
        throw e;
    }
};

/**
 * Recomputa los campos denormalizados de EquipoLaboratorio en base a la
 * última calibración activa. Se llama tras crear / actualizar / anular.
 *
 * También sincroniza con `Prensa` cuando el equipo es de tipo PRENSA y
 * comparte ID (transición Fase B). Esto permite que la UI vieja de
 * Prensa siga mostrando los datos correctos hasta que se la deprique.
 */
const refreshEquipoDenormalized = async (db, idEquipo, transaction) => {
    const equipo = await db.EquipoLaboratorio.findByPk(idEquipo, { transaction });
    if (!equipo) return;

    const last = await db.CalibracionEquipo.findOne({
        where: { idEquipo, activo: true },
        order: [['fechaCalibracion', 'DESC']],
        transaction,
    });

    if (last) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const venc = new Date(last.fechaVencimiento);
        venc.setHours(0, 0, 0, 0);
        equipo.fechaUltimaCalibracion = last.fechaCalibracion;
        equipo.certificadoVigente = venc >= today;
        const coefs = last.coeficientes || {};
        if (coefs.uno != null) equipo.coeficienteUno = Number(coefs.uno);
        if (coefs.dos != null) equipo.coeficienteDos = Number(coefs.dos);
        if (coefs.tres != null) equipo.coeficienteTres = Number(coefs.tres);
    } else {
        equipo.fechaUltimaCalibracion = null;
        equipo.certificadoVigente = false;
    }
    await equipo.save({ transaction });

    // Sync con Prensa si comparten id (Fase B transición).
    if (equipo.tipo === 'PRENSA') {
        const prensa = await db.Prensa.findByPk(idEquipo, { transaction });
        if (prensa) {
            prensa.fechaUltimaCalibracion = equipo.fechaUltimaCalibracion;
            prensa.certificadoVigente = equipo.certificadoVigente;
            prensa.coeficienteUno = equipo.coeficienteUno;
            prensa.coeficienteDos = equipo.coeficienteDos;
            prensa.coeficienteTres = equipo.coeficienteTres;
            await prensa.save({ transaction });
        }
    }
};

const getCalibraciones = async (db, { idEquipo, soloActivas = true } = {}) => {
    const where = {};
    if (soloActivas) where.activo = true;
    if (idEquipo) where.idEquipo = idEquipo;
    const rows = await db.CalibracionEquipo.findAll({
        where,
        include: [
            { model: db.EquipoLaboratorio, as: 'equipo', attributes: ['idEquipo', 'tipo', 'nombre'] },
            { model: db.Archivo, as: 'certificadoArchivo', required: false },
        ],
        order: [['fechaCalibracion', 'DESC']],
    });
    return rows.map((r) => r.get({ plain: true }));
};

const getCalibracion = async (db, idCalibracion) => {
    const row = await db.CalibracionEquipo.findByPk(idCalibracion, {
        include: [
            { model: db.EquipoLaboratorio, as: 'equipo' },
            { model: db.Archivo, as: 'certificadoArchivo', required: false },
        ],
    });
    if (!row) {
        const err = new Error('Calibración no encontrada');
        err.status = 404;
        throw err;
    }
    return row.get({ plain: true });
};

const createCalibracion = async (db, data) => {
    validate(data);
    const tx = await db.sequelize.transaction();
    try {
        const equipo = await db.EquipoLaboratorio.findByPk(data.idEquipo, { transaction: tx });
        if (!equipo) {
            const err = new Error('Equipo no encontrado');
            err.status = 404;
            throw err;
        }
        const created = await db.CalibracionEquipo.create({
            idEquipo: data.idEquipo,
            fechaCalibracion: data.fechaCalibracion,
            fechaVencimiento: data.fechaVencimiento,
            enteCalibrador: data.enteCalibrador || null,
            numeroCertificado: data.numeroCertificado || null,
            idArchivoCertificado: data.idArchivoCertificado || null,
            coeficientes: data.coeficientes || null,
            incertidumbre: data.incertidumbre ?? null,
            unidadIncertidumbre: data.unidadIncertidumbre || null,
            observaciones: data.observaciones || null,
            activo: true,
        }, { transaction: tx });

        await refreshEquipoDenormalized(db, data.idEquipo, tx);
        await tx.commit();
        invalidate(db);

        // Recursos MVP Fase C: la nueva calibración puede resolver
        // alertas pendientes (POR_VENCER → vigente, VENCIDA → vigente).
        // Lo hacemos fuera de la transacción porque las alertas son
        // independientes y un fallo acá no debe revertir el alta.
        try {
            const { autoResolverAlertasCalibracion } = require('./alertaCalibracionEquipoService');
            await autoResolverAlertasCalibracion(db, data.idEquipo);
        } catch (alertErr) {
            console.warn('[calibracion] autoResolver post-create falló:', alertErr.message);
        }

        return created.get({ plain: true });
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

const updateCalibracion = async (db, idCalibracion, data) => {
    const tx = await db.sequelize.transaction();
    try {
        const cal = await db.CalibracionEquipo.findByPk(idCalibracion, { transaction: tx });
        if (!cal) {
            const err = new Error('Calibración no encontrada');
            err.status = 404;
            throw err;
        }
        const updatable = [
            'fechaCalibracion', 'fechaVencimiento', 'enteCalibrador',
            'numeroCertificado', 'idArchivoCertificado', 'coeficientes',
            'incertidumbre', 'unidadIncertidumbre', 'observaciones', 'activo',
        ];
        for (const k of updatable) {
            if (Object.prototype.hasOwnProperty.call(data, k)) cal[k] = data[k];
        }
        if (cal.fechaVencimiento && cal.fechaCalibracion && new Date(cal.fechaVencimiento) < new Date(cal.fechaCalibracion)) {
            const e = new Error('fechaVencimiento debe ser posterior a fechaCalibracion');
            e.status = 400;
            throw e;
        }
        await cal.save({ transaction: tx });
        await refreshEquipoDenormalized(db, cal.idEquipo, tx);
        await tx.commit();
        invalidate(db);
        return cal.get({ plain: true });
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

const deleteCalibracion = async (db, idCalibracion) => {
    // Borrado lógico (anular). ISO 17025 §6.4.7 exige preservar el
    // histórico — nunca borramos físicamente.
    const tx = await db.sequelize.transaction();
    try {
        const cal = await db.CalibracionEquipo.findByPk(idCalibracion, { transaction: tx });
        if (!cal) {
            const err = new Error('Calibración no encontrada');
            err.status = 404;
            throw err;
        }
        cal.activo = false;
        cal.deleted_at = new Date();
        await cal.save({ transaction: tx });
        await refreshEquipoDenormalized(db, cal.idEquipo, tx);
        await tx.commit();
        invalidate(db);
    } catch (err) {
        await tx.rollback();
        throw err;
    }
};

module.exports = {
    getCalibraciones,
    getCalibracion,
    createCalibracion,
    updateCalibracion,
    deleteCalibracion,
    refreshEquipoDenormalized,
};
