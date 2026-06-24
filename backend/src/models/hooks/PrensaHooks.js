'use strict';

/**
 * Recursos MVP Fase D — sincronización bidireccional Prensa ↔
 * EquipoLaboratorio.
 *
 * Contexto: la migración 20260510c sembró las Prensas existentes como
 * EquipoLaboratorio con `idEquipo = idPrensa`. Mientras la UI vieja de
 * /admin/prensas siga viva, una prensa nueva creada por ese path NO
 * estaría reflejada en EquipoLaboratorio — el hook cierra ese hueco.
 *
 * También sincroniza updates (nombre, marca, modelo, etc.) para que
 * los datos en /calidad/laboratorio/equipos/:id queden coherentes con
 * cualquier edición legacy hasta que /admin/prensas se elimine en
 * una versión posterior.
 *
 * Sentido inverso (EquipoLaboratorio → Prensa) ya está en
 * `calibracionEquipoService.refreshEquipoDenormalized` (sync de
 * fechaUltimaCalibracion / coeficientes / certificadoVigente).
 *
 * 2026-05-12: si está disponible `EquipoPlanta` (pivote multi-planta),
 * también upserteamos una fila ahí para que la legacy Prensa (single-plant)
 * quede reflejada como asignación al nuevo modelo N:M.
 */

module.exports = (Prensa, EquipoLaboratorio, EquipoPlanta) => {
    if (!EquipoLaboratorio) return; // BD pre-MVP — nada que sincronizar.

    const upsertEquipoPlanta = async (idEquipo, idPlanta, transaction) => {
        if (!EquipoPlanta || !idEquipo || !idPlanta) return;
        try {
            const existing = await EquipoPlanta.findOne({
                where: { idEquipo, idPlanta },
                transaction,
            });
            if (existing) {
                if (!existing.activo) {
                    await existing.update({ activo: true }, { transaction });
                }
            } else {
                await EquipoPlanta.create(
                    { idEquipo, idPlanta, activo: true },
                    { transaction }
                );
            }
        } catch (err) {
            console.warn('[PrensaHooks] sync EquipoPlanta falló:', err.message);
        }
    };

    Prensa.afterCreate(async (prensa, options) => {
        try {
            const data = prensa.get({ plain: true });
            await EquipoLaboratorio.upsert(
                {
                    idEquipo: data.idPrensa,
                    tipo: 'PRENSA',
                    nombre: data.nombre,
                    marca: data.marca || null,
                    modelo: data.modelo || null,
                    anio: data.anio || null,
                    capacidad: data.capacidad || null,
                    idPlanta: data.idPlanta || null,
                    idUnidadMedidaPrensa: data.idUnidadMedidaPrensa || null,
                    tipoOperacion: data.tipoOperacion || 'MANUAL',
                    coeficienteUno: data.coeficienteUno ?? null,
                    coeficienteDos: data.coeficienteDos ?? null,
                    coeficienteTres: data.coeficienteTres ?? null,
                    descripcion: data.descripcion || null,
                    fechaUltimaCalibracion: data.fechaUltimaCalibracion || null,
                    certificadoVigente: !!data.certificadoVigente,
                    activo: data.activo !== false,
                },
                { transaction: options?.transaction },
            );
            await upsertEquipoPlanta(data.idPrensa, data.idPlanta, options?.transaction);
        } catch (err) {
            console.warn('[PrensaHooks.afterCreate] sync Equipo falló:', err.message);
        }
    });

    Prensa.afterUpdate(async (prensa, options) => {
        try {
            const data = prensa.get({ plain: true });
            const equipo = await EquipoLaboratorio.findByPk(data.idPrensa, {
                transaction: options?.transaction,
            });
            if (!equipo) {
                // Llegó un update de una Prensa sin contraparte —
                // posiblemente cuenta sin el seed. Hacer un upsert.
                await EquipoLaboratorio.upsert(
                    {
                        idEquipo: data.idPrensa,
                        tipo: 'PRENSA',
                        nombre: data.nombre,
                        marca: data.marca || null,
                        modelo: data.modelo || null,
                        anio: data.anio || null,
                        capacidad: data.capacidad || null,
                        idPlanta: data.idPlanta || null,
                        idUnidadMedidaPrensa: data.idUnidadMedidaPrensa || null,
                        tipoOperacion: data.tipoOperacion || 'MANUAL',
                        coeficienteUno: data.coeficienteUno ?? null,
                        coeficienteDos: data.coeficienteDos ?? null,
                        coeficienteTres: data.coeficienteTres ?? null,
                        descripcion: data.descripcion || null,
                        fechaUltimaCalibracion: data.fechaUltimaCalibracion || null,
                        certificadoVigente: !!data.certificadoVigente,
                        activo: data.activo !== false,
                    },
                    { transaction: options?.transaction },
                );
                await upsertEquipoPlanta(data.idPrensa, data.idPlanta, options?.transaction);
                return;
            }
            // Update solo los campos genéricos. fechaUltimaCalibracion /
            // certificadoVigente / coeficientes se manejan desde el flujo
            // de CalibracionEquipo y no deben pisarse desde Prensa.
            equipo.nombre = data.nombre;
            equipo.marca = data.marca || null;
            equipo.modelo = data.modelo || null;
            equipo.anio = data.anio || null;
            equipo.capacidad = data.capacidad || null;
            equipo.idPlanta = data.idPlanta || null;
            equipo.idUnidadMedidaPrensa = data.idUnidadMedidaPrensa || null;
            if (data.tipoOperacion) equipo.tipoOperacion = data.tipoOperacion;
            equipo.descripcion = data.descripcion || null;
            equipo.activo = data.activo !== false;
            await equipo.save({ transaction: options?.transaction });
            await upsertEquipoPlanta(data.idPrensa, data.idPlanta, options?.transaction);
        } catch (err) {
            console.warn('[PrensaHooks.afterUpdate] sync Equipo falló:', err.message);
        }
    });
};
