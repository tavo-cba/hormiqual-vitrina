'use strict';

const { Op } = require('sequelize');

/**
 * Service de Laboratorio (Fase 1).
 *
 * Un Laboratorio agrupa equipos y piletas y se asigna a 1+ plantas.
 * `Laboratorio.idPrensaPorDefecto` apunta a EquipoLaboratorio.idEquipo;
 * el service valida que ese equipo:
 *   1. exista y esté activo;
 *   2. tenga tipo='PRENSA';
 *   3. pertenezca a este laboratorio (idLaboratorio = self).
 */

const _validateNombre = (nombre) => {
    if (!nombre || !String(nombre).trim()) {
        const e = new Error('El nombre del laboratorio es obligatorio.');
        e.status = 400;
        throw e;
    }
};

const _validatePrensaPorDefecto = async (db, idLaboratorio, idPrensaPorDefecto) => {
    if (idPrensaPorDefecto == null) return null;
    const equipo = await db.EquipoLaboratorio.findByPk(idPrensaPorDefecto);
    if (!equipo) {
        const e = new Error('La prensa por defecto no existe.');
        e.status = 400;
        throw e;
    }
    if (equipo.tipo !== 'PRENSA') {
        const e = new Error('El equipo seleccionado como prensa por defecto no es de tipo PRENSA.');
        e.status = 400;
        throw e;
    }
    return equipo;
};

/**
 * Si la prensa elegida como default no pertenece a este laboratorio (porque
 * estaba sin asignar o en otro lab), la reasigna acá. Es la acción "intencional"
 * del admin al elegirla como default desde el form de laboratorio. La fila gemela
 * en `Prensa` se mantiene sincronizada por `equipoLaboratorioService.updateEquipo`
 * vía hook (si se usa allí); acá tocamos directo el Equipo.
 */
const _autoAsignarPrensaAlLab = async (db, idLaboratorio, idPrensaPorDefecto) => {
    if (idPrensaPorDefecto == null || idLaboratorio == null) return;
    const equipo = await db.EquipoLaboratorio.findByPk(idPrensaPorDefecto);
    if (!equipo || equipo.tipo !== 'PRENSA') return;
    if (Number(equipo.idLaboratorio) === Number(idLaboratorio)) return; // ya está
    await equipo.update({ idLaboratorio: Number(idLaboratorio) });
};

const _syncPlantas = async (db, idLaboratorio, plantasConfig) => {
    if (!Array.isArray(plantasConfig) || !db.LaboratorioPlanta) return;
    const t = await db.sequelize.transaction();
    try {
        const existentes = await db.LaboratorioPlanta.findAll({
            where: { idLaboratorio: Number(idLaboratorio) },
            transaction: t,
        });
        const byPlanta = new Map(existentes.map(e => [e.idPlanta, e]));
        const incluidas = new Set();
        for (const cfg of plantasConfig) {
            if (!cfg.idPlanta) continue;
            const idPlanta = Number(cfg.idPlanta);
            incluidas.add(idPlanta);
            const existing = byPlanta.get(idPlanta);
            if (existing) {
                await existing.update({
                    observaciones: cfg.observaciones !== undefined ? cfg.observaciones : existing.observaciones,
                    activo: cfg.activo !== false,
                }, { transaction: t });
            } else {
                await db.LaboratorioPlanta.create({
                    idLaboratorio: Number(idLaboratorio),
                    idPlanta,
                    observaciones: cfg.observaciones || null,
                    activo: cfg.activo !== false,
                }, { transaction: t });
            }
        }
        for (const e of existentes) {
            if (!incluidas.has(e.idPlanta) && e.activo) {
                await e.update({ activo: false }, { transaction: t });
            }
        }
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }
};

const _listarPlantas = async (db, idLaboratorio) => {
    if (!db.LaboratorioPlanta) return [];
    const rows = await db.LaboratorioPlanta.findAll({
        where: { idLaboratorio: Number(idLaboratorio) },
        include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
        order: [['idPlanta', 'ASC']],
    });
    return rows.map(r => r.get({ plain: true }));
};

const _includeBasico = (db) => {
    const include = [];
    if (db.EquipoLaboratorio) {
        include.push({
            model: db.EquipoLaboratorio,
            as: 'prensaPorDefecto',
            attributes: ['idEquipo', 'tipo', 'nombre'],
            required: false,
        });
    }
    return include;
};

const getLaboratorios = async (db, { idPlanta, soloActivos = true } = {}) => {
    const where = {};
    if (soloActivos) where.activo = true;
    let idLabsFiltro = null;
    if (idPlanta && db.LaboratorioPlanta) {
        const asignaciones = await db.LaboratorioPlanta.findAll({
            where: { idPlanta: Number(idPlanta), activo: true },
            attributes: ['idLaboratorio'],
            raw: true,
        });
        idLabsFiltro = asignaciones.map(a => a.idLaboratorio);
        if (idLabsFiltro.length === 0) return [];
        where.idLaboratorio = { [Op.in]: idLabsFiltro };
    }

    const rows = await db.Laboratorio.findAll({
        where,
        include: _includeBasico(db),
        order: [['nombre', 'ASC']],
    });
    const plain = rows.map(r => r.get({ plain: true }));

    // Enriquecer con plantas + conteos rápidos.
    if (db.LaboratorioPlanta && plain.length > 0) {
        const ids = plain.map(l => l.idLaboratorio);
        const labPlantas = await db.LaboratorioPlanta.findAll({
            where: { idLaboratorio: { [Op.in]: ids } },
            include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
            order: [['idPlanta', 'ASC']],
        });
        const byLab = new Map();
        for (const lp of labPlantas) {
            const r = lp.get({ plain: true });
            if (!byLab.has(r.idLaboratorio)) byLab.set(r.idLaboratorio, []);
            byLab.get(r.idLaboratorio).push(r);
        }
        for (const l of plain) l.plantas = byLab.get(l.idLaboratorio) || [];
    }

    if (db.EquipoLaboratorio && plain.length > 0) {
        const ids = plain.map(l => l.idLaboratorio);
        const equipos = await db.EquipoLaboratorio.findAll({
            where: { idLaboratorio: { [Op.in]: ids }, activo: true },
            attributes: ['idEquipo', 'idLaboratorio', 'tipo'],
            raw: true,
        });
        const cntByLab = new Map();
        for (const e of equipos) {
            cntByLab.set(e.idLaboratorio, (cntByLab.get(e.idLaboratorio) || 0) + 1);
        }
        for (const l of plain) l.cantidadEquipos = cntByLab.get(l.idLaboratorio) || 0;
    }

    if (db.Pileta && plain.length > 0) {
        const ids = plain.map(l => l.idLaboratorio);
        const piletas = await db.Pileta.findAll({
            where: { idLaboratorio: { [Op.in]: ids }, deleted_at: null },
            attributes: ['idPileta', 'idLaboratorio'],
            raw: true,
        });
        const cntByLab = new Map();
        for (const p of piletas) {
            cntByLab.set(p.idLaboratorio, (cntByLab.get(p.idLaboratorio) || 0) + 1);
        }
        for (const l of plain) l.cantidadPiletas = cntByLab.get(l.idLaboratorio) || 0;
    }

    return plain;
};

const getLaboratorio = async (db, idLaboratorio) => {
    const row = await db.Laboratorio.findByPk(idLaboratorio, {
        include: _includeBasico(db),
    });
    if (!row) {
        const e = new Error('Laboratorio no encontrado.');
        e.status = 404;
        throw e;
    }
    const plain = row.get({ plain: true });
    plain.plantas = await _listarPlantas(db, idLaboratorio);

    if (db.EquipoLaboratorio) {
        const equipos = await db.EquipoLaboratorio.findAll({
            where: { idLaboratorio: Number(idLaboratorio), activo: true },
            order: [['tipo', 'ASC'], ['nombre', 'ASC']],
        });
        plain.equipos = equipos.map(e => e.get({ plain: true }));
    }
    if (db.Pileta) {
        const piletas = await db.Pileta.findAll({
            where: { idLaboratorio: Number(idLaboratorio), deleted_at: null },
            order: [['nombre', 'ASC']],
        });
        plain.piletas = piletas.map(p => p.get({ plain: true }));
    }
    return plain;
};

const createLaboratorio = async (db, data) => {
    _validateNombre(data.nombre);
    if (data.idPrensaPorDefecto != null) {
        await _validatePrensaPorDefecto(db, null, data.idPrensaPorDefecto);
    }
    const lab = await db.Laboratorio.create({
        nombre: data.nombre.trim(),
        direccion: data.direccion || null,
        observaciones: data.observaciones || null,
        idPrensaPorDefecto: data.idPrensaPorDefecto || null,
        activo: data.activo !== false,
    });
    if (Array.isArray(data.plantasConfig) && data.plantasConfig.length > 0) {
        try {
            await _syncPlantas(db, lab.idLaboratorio, data.plantasConfig);
        } catch (e) {
            console.warn('[createLaboratorio] sync plantas falló (non-blocking):', e.message);
        }
    }
    // Auto-asignar la prensa default al lab recién creado (claim).
    if (data.idPrensaPorDefecto != null) {
        try {
            await _autoAsignarPrensaAlLab(db, lab.idLaboratorio, data.idPrensaPorDefecto);
        } catch (e) {
            console.warn('[createLaboratorio] auto-asignar prensa falló (non-blocking):', e.message);
        }
    }
    return lab.get({ plain: true });
};

const updateLaboratorio = async (db, idLaboratorio, data) => {
    const lab = await db.Laboratorio.findByPk(idLaboratorio);
    if (!lab) {
        const e = new Error('Laboratorio no encontrado.');
        e.status = 404;
        throw e;
    }
    if (data.nombre !== undefined) _validateNombre(data.nombre);
    if (Object.prototype.hasOwnProperty.call(data, 'idPrensaPorDefecto')) {
        await _validatePrensaPorDefecto(db, idLaboratorio, data.idPrensaPorDefecto);
    }
    const updatable = ['nombre', 'direccion', 'observaciones', 'idPrensaPorDefecto', 'activo'];
    for (const k of updatable) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
            lab[k] = data[k];
        }
    }
    if (data.nombre !== undefined && typeof lab.nombre === 'string') lab.nombre = lab.nombre.trim();
    await lab.save();

    if (Array.isArray(data.plantasConfig)) {
        try {
            await _syncPlantas(db, idLaboratorio, data.plantasConfig);
        } catch (e) {
            console.warn('[updateLaboratorio] sync plantas falló (non-blocking):', e.message);
        }
    }

    // Auto-asignar la prensa default al lab si la elegida no estaba en él.
    if (Object.prototype.hasOwnProperty.call(data, 'idPrensaPorDefecto') && data.idPrensaPorDefecto != null) {
        try {
            await _autoAsignarPrensaAlLab(db, idLaboratorio, data.idPrensaPorDefecto);
        } catch (e) {
            console.warn('[updateLaboratorio] auto-asignar prensa falló (non-blocking):', e.message);
        }
    }
    return lab.get({ plain: true });
};

const deleteLaboratorio = async (db, idLaboratorio) => {
    const lab = await db.Laboratorio.findByPk(idLaboratorio);
    if (!lab) {
        const e = new Error('Laboratorio no encontrado.');
        e.status = 404;
        throw e;
    }
    // Borrado lógico — no se borra para preservar trazabilidad de equipos/piletas
    // que aún lo referencien.
    lab.activo = false;
    await lab.save();
};

module.exports = {
    getLaboratorios,
    getLaboratorio,
    createLaboratorio,
    updateLaboratorio,
    deleteLaboratorio,
};
