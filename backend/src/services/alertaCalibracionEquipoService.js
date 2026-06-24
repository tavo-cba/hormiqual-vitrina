'use strict';

const { Op } = require('sequelize');

/**
 * Recursos MVP — Fase C.
 *
 * Genera y mantiene alertas de calibración para equipos de laboratorio:
 *   - CALIBRACION_POR_VENCER (nivel ALTO, ≤ 30 días para vencer).
 *   - CALIBRACION_VENCIDA    (nivel CRITICO, fechaVencimiento < hoy).
 *
 * Patron alineado con `alertaCalidadService.verificarVencimientosEnsayos`
 * que ya corre en el cron diario (cronService.js a las 7:00 AM):
 *   - Idempotente: si ya existe una alerta PENDIENTE del mismo tipo para
 *     ese equipo, NO se crea otra.
 *   - Reactivo: también se invoca tras crear / anular calibraciones
 *     desde el service `calibracionEquipoService`.
 *
 * Justificación normativa: ISO/IEC 17025 §6.4.7 exige trazabilidad activa
 * de la calibración. Un ensayo hecho con un equipo cuya calibración venció
 * tiene trazabilidad débil y puede ser cuestionado en pericia.
 */

const DIAS_AVISO = 30;

const dateOnly = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
};

/**
 * Recorre todos los equipos activos del tenant y emite/actualiza alertas
 * de calibración según corresponda. Si un equipo no tiene NINGUNA
 * calibración activa, no se emite alerta (es responsabilidad del usuario
 * registrar la primera; el UI ya muestra "Sin calibrar").
 *
 * Retorna las alertas nuevas creadas (no las que ya existían).
 */
async function verificarVencimientosCalibracion(db) {
    if (!db?.EquipoLaboratorio || !db?.CalibracionEquipo || !db?.AlertaCalidad) {
        return [];
    }

    const hoy = dateOnly(new Date());
    const limite = new Date(hoy);
    limite.setDate(limite.getDate() + DIAS_AVISO);

    // Sub-query no muy linda con findAll + agrupado en JS: pocas filas, OK.
    const equipos = await db.EquipoLaboratorio.findAll({
        where: { activo: true },
        raw: true,
    });
    if (!equipos.length) return [];

    const calibraciones = await db.CalibracionEquipo.findAll({
        where: { idEquipo: { [Op.in]: equipos.map((e) => e.idEquipo) }, activo: true },
        order: [['fechaCalibracion', 'DESC']],
        raw: true,
    });
    const lastByEquipo = new Map();
    for (const c of calibraciones) {
        if (!lastByEquipo.has(c.idEquipo)) lastByEquipo.set(c.idEquipo, c);
    }

    const creadas = [];
    for (const eq of equipos) {
        const last = lastByEquipo.get(eq.idEquipo);
        if (!last) continue; // Sin calibrar: no emitimos alerta (UI ya lo refleja).
        const venc = dateOnly(last.fechaVencimiento);
        let tipo = null;
        let nivel = null;
        let mensaje = null;
        if (venc < hoy) {
            tipo = 'CALIBRACION_VENCIDA';
            nivel = 'CRITICO';
            const dias = Math.round((hoy - venc) / 86400000);
            mensaje =
                `Calibración VENCIDA del equipo "${eq.nombre}" (${eq.tipo}) hace ${dias} día(s). ` +
                `Los ensayos hechos con este equipo desde el vencimiento tienen trazabilidad débil ` +
                `(ISO 17025 §6.4.7). Registrar nueva calibración o dar el equipo de baja.`;
        } else if (venc <= limite) {
            tipo = 'CALIBRACION_POR_VENCER';
            nivel = 'ALTO';
            const dias = Math.round((venc - hoy) / 86400000);
            mensaje =
                `La calibración del equipo "${eq.nombre}" (${eq.tipo}) vence en ${dias} día(s). ` +
                `Gestionar la nueva calibración antes del vencimiento para mantener trazabilidad ISO 17025 §6.4.7.`;
        } else {
            continue; // Calibración vigente fuera de la ventana de aviso.
        }

        // Idempotencia: si ya hay una alerta PENDIENTE del mismo tipo para
        // este equipo, no creamos otra.
        const existente = await db.AlertaCalidad.findOne({
            where: {
                tipo,
                estado: 'PENDIENTE',
                idMaterial: eq.idEquipo, // reusamos el campo para el id del equipo.
            },
        });
        if (existente) continue;

        // Si transicionó de POR_VENCER → VENCIDA, autocompletar la
        // alerta vieja de POR_VENCER como RESUELTA para evitar ruido.
        if (tipo === 'CALIBRACION_VENCIDA') {
            await db.AlertaCalidad.update(
                {
                    estado: 'RESUELTA',
                    fechaResolucion: new Date(),
                    resueltaPor: 'sistema',
                    notasResolucion: `Auto-resuelta: la calibración pasó a estado VENCIDA.`,
                },
                {
                    where: {
                        tipo: 'CALIBRACION_POR_VENCER',
                        estado: 'PENDIENTE',
                        idMaterial: eq.idEquipo,
                    },
                },
            );
        }

        const nueva = await db.AlertaCalidad.create({
            tipo,
            nivel,
            estado: 'PENDIENTE',
            mensaje,
            detalle: {
                idEquipo: eq.idEquipo,
                tipoEquipo: eq.tipo,
                idCalibracion: last.idCalibracion,
                fechaCalibracion: last.fechaCalibracion,
                fechaVencimiento: last.fechaVencimiento,
                enteCalibrador: last.enteCalibrador || null,
                numeroCertificado: last.numeroCertificado || null,
            },
            idPlanta: eq.idPlanta || null,
            idMaterial: eq.idEquipo,
            nombreMaterial: eq.nombre,
        });
        creadas.push(nueva.get({ plain: true }));
    }

    return creadas;
}

/**
 * Auto-resuelve alertas de calibración que quedaron pendientes pero ya
 * dejaron de aplicar (se registró una nueva calibración vigente). Se
 * llama desde el cron y también desde `calibracionEquipoService.createCalibracion`.
 */
async function autoResolverAlertasCalibracion(db, idEquipo = null) {
    if (!db?.AlertaCalidad) return 0;
    const hoy = dateOnly(new Date());
    const where = {
        tipo: { [Op.in]: ['CALIBRACION_POR_VENCER', 'CALIBRACION_VENCIDA'] },
        estado: 'PENDIENTE',
    };
    if (idEquipo) where.idMaterial = idEquipo;

    const pendientes = await db.AlertaCalidad.findAll({ where });
    let resueltas = 0;
    for (const alerta of pendientes) {
        const idEq = alerta.idMaterial;
        const last = await db.CalibracionEquipo.findOne({
            where: { idEquipo: idEq, activo: true },
            order: [['fechaCalibracion', 'DESC']],
        });
        if (!last) continue;
        const venc = dateOnly(last.fechaVencimiento);
        const sigueAplicando =
            (alerta.tipo === 'CALIBRACION_VENCIDA' && venc < hoy) ||
            (alerta.tipo === 'CALIBRACION_POR_VENCER' &&
                venc >= hoy &&
                (venc - hoy) / 86400000 <= DIAS_AVISO);
        if (!sigueAplicando) {
            alerta.estado = 'RESUELTA';
            alerta.fechaResolucion = new Date();
            alerta.resueltaPor = 'sistema';
            alerta.notasResolucion = `Auto-resuelta: la calibración ya no está en ese estado.`;
            await alerta.save();
            resueltas++;
        }
    }
    return resueltas;
}

module.exports = {
    DIAS_AVISO,
    verificarVencimientosCalibracion,
    autoResolverAlertasCalibracion,
};
