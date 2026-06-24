const { Op } = require('sequelize');

// ---- CRUD ----

const _includePileta = (db) => {
    const inc = [
        { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
        { model: db.PiletaEstado, as: 'estado' },
    ];
    if (db.Laboratorio) {
        inc.push({ model: db.Laboratorio, as: 'laboratorio', attributes: ['idLaboratorio', 'nombre'], required: false });
    }
    return inc;
};

const getPiletas = async (db) => {
    const result = await db.Pileta.findAll({
        where: { deleted_at: null },
        attributes: {
            include: [
                [
                    db.sequelize.literal(`(
                        SELECT COUNT(*) FROM Probeta
                        WHERE Probeta.idPileta = Pileta.idPileta
                        AND Probeta.idEstadoProbeta = 1
                    )`),
                    'probetasCurando',
                ],
            ],
        },
        include: _includePileta(db),
        order: [['nombre', 'ASC']],
    });
    return result.map(r => r.get({ plain: true }));
};

const getPileta = async (db, idPileta) => {
    const pileta = await db.Pileta.findByPk(idPileta, {
        include: _includePileta(db),
    });
    return pileta ? pileta.get({ plain: true }) : null;
};

const getPiletasByPlanta = async (db, idPlanta) => {
    // Dual-source: una pileta aparece si tiene `idPlanta = X` legacy, O si
    // pertenece a un Laboratorio cuya LaboratorioPlanta incluye esa planta.
    // Durante el rollout coexisten; cuando todas las piletas tengan
    // `idLaboratorio` asignado y el campo legacy quede vacío, el path legacy
    // deja de aportar datos naturalmente.
    const idsSet = new Set();
    const piletasLegacy = await db.Pileta.findAll({
        where: { idPlanta: Number(idPlanta), deleted_at: null },
        attributes: ['idPileta', 'nombre'],
        raw: true,
    });
    for (const p of piletasLegacy) idsSet.add(p.idPileta);

    if (db.LaboratorioPlanta) {
        const labRows = await db.LaboratorioPlanta.findAll({
            where: { idPlanta: Number(idPlanta), activo: true },
            attributes: ['idLaboratorio'],
            raw: true,
        });
        const idLabs = labRows.map((r) => r.idLaboratorio);
        if (idLabs.length > 0) {
            const { Op } = require('sequelize');
            const piletasLab = await db.Pileta.findAll({
                where: { idLaboratorio: { [Op.in]: idLabs }, deleted_at: null },
                attributes: ['idPileta'],
                raw: true,
            });
            for (const p of piletasLab) idsSet.add(p.idPileta);
        }
    }

    if (idsSet.size === 0) return [];

    const { Op } = require('sequelize');
    const result = await db.Pileta.findAll({
        where: { idPileta: { [Op.in]: [...idsSet] }, deleted_at: null },
        attributes: ['idPileta', 'nombre'],
        order: [['nombre', 'ASC']],
    });
    return result.map(r => r.get({ plain: true }));
};

/**
 * Asignación masiva de un laboratorio a un conjunto de piletas.
 */
const bulkAssignLab = async (db, { idLaboratorio, idsPileta }) => {
    if (idLaboratorio == null) {
        const e = new Error('idLaboratorio es obligatorio.');
        e.status = 400;
        throw e;
    }
    if (!Array.isArray(idsPileta) || idsPileta.length === 0) {
        const e = new Error('idsPileta debe ser un array no vacío.');
        e.status = 400;
        throw e;
    }
    const lab = await db.Laboratorio.findByPk(idLaboratorio);
    if (!lab) {
        const e = new Error('Laboratorio no encontrado.');
        e.status = 404;
        throw e;
    }
    const { Op } = require('sequelize');
    const piletas = await db.Pileta.findAll({
        where: { idPileta: { [Op.in]: idsPileta.map(Number) }, deleted_at: null },
    });
    const found = new Set(piletas.map((p) => p.idPileta));
    const skipped = idsPileta.filter((id) => !found.has(Number(id)));
    for (const pileta of piletas) {
        pileta.idLaboratorio = Number(idLaboratorio);
        await pileta.save();
    }
    return {
        updated: piletas.length,
        skippedNotFound: skipped,
        idLaboratorio: Number(idLaboratorio),
    };
};

const createPileta = async (db, data) => {
    return db.Pileta.create({
        nombre: data.nombre,
        hashId: data.hashId,
        idPlanta: data.idPlanta || null,
        idLaboratorio: data.idLaboratorio || null,
        umbralAlerta: data.umbralAlerta ?? 3.0,
        wattsResistencias: data.wattsResistencias ?? null,
        wattsBombas: data.wattsBombas ?? null,
        precioKwh: data.precioKwh ?? null,
    });
};

const updatePileta = async (db, idPileta, data) => {
    const pileta = await db.Pileta.findByPk(idPileta);
    if (!pileta) throw new Error('Pileta no encontrada');
    const patch = {
        nombre: data.nombre,
        idPlanta: data.idPlanta,
        umbralAlerta: data.umbralAlerta,
        wattsResistencias: data.wattsResistencias ?? null,
        wattsBombas: data.wattsBombas ?? null,
        precioKwh: data.precioKwh ?? null,
    };
    if (Object.prototype.hasOwnProperty.call(data, 'idLaboratorio')) {
        patch.idLaboratorio = data.idLaboratorio || null;
    }
    return pileta.update(patch);
};

const deletePileta = async (db, idPileta) => {
    const pileta = await db.Pileta.findByPk(idPileta);
    if (!pileta) throw new Error('Pileta no encontrada');
    return pileta.update({ deleted_at: new Date() });
};

// ---- Reporte del Laboratorio ----

const procesarReporteLaboratorio = async (db, payload) => {
    const results = [];
    const soloHistorico = payload.soloHistorico === true;
    // Sensor de ambiente y su lectura son globales del lab, no de una pileta específica.
    // Los persistimos en cada PiletaEstado para que el panel de cada pileta pueda mostrarlos.
    const temperaturaAmbiente = payload.temperaturaAmbiente ?? null;

    for (const item of payload.piletas) {
        const pileta = await db.Pileta.findOne({ where: { hashId: item.hashId, deleted_at: null } });
        if (!pileta) {
            results.push({ hashId: item.hashId, status: 'not_found' });
            continue;
        }

        const ahora = new Date();

        if (soloHistorico) {
            if (item.temperatura != null) {
                await db.PiletaRegistroTemperatura.create({
                    idPileta: pileta.idPileta,
                    temperatura: item.temperatura,
                    // Sala de curado y rango entre sensores: pueden venir nulos si el lab no
                    // tiene sensor ambiente configurado o si la pileta tiene un solo sensor.
                    temperaturaAmbiente: item.temperaturaAmbiente ?? temperaturaAmbiente,
                    rangoTemp: item.rangoTemp ?? null,
                    timestamp: item.timestamp ? new Date(item.timestamp) : ahora,
                });
            }
            results.push({ hashId: item.hashId, status: 'ok-historico' });
            continue;
        }

        // Leer estado previo antes de actualizar
        const estadoPrevio = await db.PiletaEstado.findOne({ where: { idPileta: pileta.idPileta } });
        const prevBombas = estadoPrevio?.bombasEncendidas ?? false;
        const prevResistencias = estadoPrevio?.resistenciasEncendidas ?? false;
        const newBombas = item.bombasEncendidas ?? false;
        const newResistencias = item.resistenciasEncendidas ?? false;

        // Upsert PiletaEstado
        const [estado, created] = await db.PiletaEstado.findOrCreate({
            where: { idPileta: pileta.idPileta },
            defaults: {
                bombasEncendidas: newBombas,
                resistenciasEncendidas: newResistencias,
                temperaturaActual: item.temperatura,
                temperaturaObjetivo: item.temperaturaObjetivo,
                rangoTemp: item.rangoTemp ?? null,
                temperaturaAmbiente,
                ultimaActualizacion: ahora,
                labInfo: item.labInfo || null,
            },
        });

        if (!created) {
            await estado.update({
                bombasEncendidas: newBombas,
                resistenciasEncendidas: newResistencias,
                temperaturaActual: item.temperatura,
                temperaturaObjetivo: item.temperaturaObjetivo,
                rangoTemp: item.rangoTemp ?? null,
                temperaturaAmbiente,
                ultimaActualizacion: ahora,
                labInfo: item.labInfo || estado.labInfo,
            });
        }

        // Registrar temperatura solo si el reporte lo indica
        if (payload.registrarTemperatura && item.temperatura != null) {
            await db.PiletaRegistroTemperatura.create({
                idPileta: pileta.idPileta,
                temperatura: item.temperatura,
                temperaturaAmbiente: item.temperaturaAmbiente ?? temperaturaAmbiente,
                rangoTemp: item.rangoTemp ?? null,
                timestamp: item.timestamp ? new Date(item.timestamp) : ahora,
            });
        }

        // Trackear transiciones de consumo
        await _trackearConsumo(db, pileta.idPileta, 'bombas', prevBombas, newBombas, ahora, created);
        await _trackearConsumo(db, pileta.idPileta, 'resistencias', prevResistencias, newResistencias, ahora, created);

        results.push({ hashId: item.hashId, status: 'ok' });
    }

    return results;
};

const _trackearConsumo = async (db, idPileta, tipo, prevState, newState, ahora, isFirstReport) => {
    if (isFirstReport) {
        // Primer reporte: si está encendido, abrir un registro
        if (newState) {
            await db.PiletaRegistroConsumo.create({ idPileta, tipo, inicio: ahora, fin: null });
        }
        return;
    }

    if (!prevState && newState) {
        // Encendió: abrir nuevo registro
        await db.PiletaRegistroConsumo.create({ idPileta, tipo, inicio: ahora, fin: null });
    } else if (prevState && !newState) {
        // Apagó: cerrar último registro abierto
        const ultimo = await db.PiletaRegistroConsumo.findOne({
            where: { idPileta, tipo, fin: null },
            order: [['inicio', 'DESC']],
        });
        if (ultimo) await ultimo.update({ fin: ahora });
    }
};

// ---- Alertas ----

const getAlertas = async (db) => {
    const piletas = await db.Pileta.findAll({
        where: { deleted_at: null },
        include: [
            { model: db.PiletaEstado, as: 'estado' },
            { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
        ],
    });

    const alertas = [];
    for (const row of piletas) {
        const p = row.get({ plain: true });
        if (!p.estado) continue;

        if (p.estado.temperaturaActual != null && p.estado.temperaturaObjetivo != null) {
            const diff = Math.abs(Number(p.estado.temperaturaActual) - Number(p.estado.temperaturaObjetivo));
            if (diff > Number(p.umbralAlerta)) {
                alertas.push({
                    idPileta: p.idPileta,
                    nombre: p.nombre,
                    planta: p.planta?.nombre,
                    temperaturaActual: Number(p.estado.temperaturaActual),
                    temperaturaObjetivo: Number(p.estado.temperaturaObjetivo),
                    umbralAlerta: Number(p.umbralAlerta),
                    diferencia: parseFloat(diff.toFixed(1)),
                });
            }
        }

        if (p.estado.ultimaActualizacion) {
            const msSinceUpdate = Date.now() - new Date(p.estado.ultimaActualizacion).getTime();
            if (msSinceUpdate > 5 * 60 * 1000) {
                alertas.push({
                    idPileta: p.idPileta,
                    nombre: p.nombre,
                    planta: p.planta?.nombre,
                    tipo: 'sin_conexion',
                    ultimaActualizacion: p.estado.ultimaActualizacion,
                    minutosDesconectada: Math.floor(msSinceUpdate / 60000),
                });
            }
        }
    }

    return alertas;
};

// ---- Historial de temperaturas ----

const getTemperatureHistory = async (db, idPileta, desde, hasta) => {
    const where = { idPileta };
    if (desde || hasta) {
        where.timestamp = {};
        if (desde) where.timestamp[Op.gte] = new Date(desde);
        if (hasta) where.timestamp[Op.lte] = new Date(hasta);
    }
    return db.PiletaRegistroTemperatura.findAll({
        where,
        order: [['timestamp', 'ASC']],
        limit: 2000,
    });
};

// ---- Correlación temperatura ambiente ↔ ciclos de resistencias ----

// Atribución ponderada por tiempo REAL.
//
// Para cada par de lecturas de ambiente consecutivas se forma un "tramo" [t_i, t_i+1] con
// duración real y temperatura de sala conocida (promedio de los extremos). Se mide cuántos
// minutos exactos estuvieron las resistencias prendidas en ese tramo (intersección con
// PiletaRegistroConsumo) y se atribuye duración + minutos-ON al bucket de esa temperatura.
//
// Ventajas vs el enfoque anterior (ventana fija por lectura):
//   - No inventa tiempo: minutosTotal por bucket = suma de tramos reales medidos.
//   - Una lectura aislada NO forma tramo → no produce porcentajes espurios (ej. "33% con 1 lectura").
//   - Tramos con hueco anormal (sensor caído) se descartan, no se atribuyen a ningún bucket.
//   - Cada minuto del período medido se cuenta una sola vez (sin solapes ni huecos artificiales).
const getCorrelacionAmbiente = async (db, idPileta, desde, hasta) => {
    const desdeDate = desde ? new Date(desde) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const hastaDate = hasta ? new Date(hasta) : new Date();

    const lecturas = await db.PiletaRegistroTemperatura.findAll({
        where: {
            idPileta,
            timestamp: { [Op.gte]: desdeDate, [Op.lte]: hastaDate },
        },
        order: [['timestamp', 'ASC']],
        limit: 5000,
    });

    // Solo lecturas con temperatura de sala válida, ordenadas
    const puntos = lecturas
        .map(l => ({
            t: new Date(l.timestamp).getTime(),
            amb: l.temperaturaAmbiente == null ? null : Number(l.temperaturaAmbiente),
        }))
        .filter(p => p.amb != null && Number.isFinite(p.amb) && Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t);

    const meta = {
        buckets: [],
        totalLecturas: lecturas.length,
        lecturasConAmbiente: puntos.length,
        periodoMinutos: Math.round((hastaDate.getTime() - desdeDate.getTime()) / 60000),
    };

    // Hacen falta al menos 2 puntos para formar un tramo medible
    if (puntos.length < 2) {
        return meta;
    }

    const registrosConsumo = await db.PiletaRegistroConsumo.findAll({
        where: {
            idPileta,
            tipo: 'resistencias',
            inicio: { [Op.lte]: hastaDate },
            [Op.or]: [
                { fin: null },
                { fin: { [Op.gte]: desdeDate } },
            ],
        },
    });

    // ¿Cuántos minutos del rango [aMs, bMs] estuvieron las resistencias prendidas?
    const minutosOnEnRango = (aMs, bMs) => {
        let on = 0;
        for (const r of registrosConsumo) {
            const ini = new Date(r.inicio).getTime();
            const fin = r.fin ? new Date(r.fin).getTime() : Date.now();
            on += Math.max(0, Math.min(bMs, fin) - Math.max(aMs, ini));
        }
        return on / 60000;
    };

    // Intervalo típico entre lecturas (mediana de diferencias). Sirve para detectar huecos.
    const diffs = [];
    for (let i = 1; i < puntos.length; i++) {
        const d = (puntos[i].t - puntos[i - 1].t) / 60000;
        if (d > 0) diffs.push(d);
    }
    diffs.sort((a, b) => a - b);
    const intervaloMedianaMin = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 30;
    // Un tramo más largo que esto se considera hueco de datos (sensor caído / lab offline)
    // y NO se atribuye a ningún bucket: no sabemos la temperatura real durante ese tiempo.
    const maxTramoMin = Math.max(intervaloMedianaMin * 3, 90);

    const STEP = 3; // buckets de 3°C
    const buckets = new Map();

    for (let i = 0; i < puntos.length - 1; i++) {
        const p = puntos[i];
        const next = puntos[i + 1];
        const durMin = (next.t - p.t) / 60000;
        if (durMin <= 0) continue;
        if (durMin > maxTramoMin) continue; // hueco de datos: descartar tramo

        const onMin = minutosOnEnRango(p.t, next.t);
        const ambProm = (p.amb + next.amb) / 2; // temperatura representativa del tramo
        const bInicio = Math.floor(ambProm / STEP) * STEP;

        if (!buckets.has(bInicio)) {
            buckets.set(bInicio, { desde: bInicio, hasta: bInicio + STEP, muestras: 0, minutosOn: 0, minutosTotal: 0 });
        }
        const bk = buckets.get(bInicio);
        bk.muestras++;
        bk.minutosOn += onMin;
        bk.minutosTotal += durMin;
    }

    const bucketsOut = Array.from(buckets.values())
        .filter(b => b.minutosTotal > 0)
        .map(b => ({
            desde: b.desde,
            hasta: b.hasta,
            // "muestras" = cantidad de tramos reales atribuidos a este bucket
            muestras: b.muestras,
            minutosOn: Math.round(b.minutosOn),
            minutosTotal: Math.round(b.minutosTotal),
            porcentajeOn: parseFloat(((b.minutosOn / b.minutosTotal) * 100).toFixed(1)),
        }))
        .sort((a, b) => a.desde - b.desde);

    return {
        ...meta,
        buckets: bucketsOut,
        intervaloMedianaMin: parseFloat(intervaloMedianaMin.toFixed(1)),
        maxTramoMin: Math.round(maxTramoMin),
    };
};

// Devuelve los rangos en que las resistencias estuvieron prendidas en el período.
// Lo usa el frontend para sombrear el gráfico de temperatura histórica.
const getResistenciasOnRanges = async (db, idPileta, desde, hasta) => {
    const desdeDate = desde ? new Date(desde) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const hastaDate = hasta ? new Date(hasta) : new Date();

    const registros = await db.PiletaRegistroConsumo.findAll({
        where: {
            idPileta,
            tipo: 'resistencias',
            inicio: { [Op.lte]: hastaDate },
            [Op.or]: [
                { fin: null },
                { fin: { [Op.gte]: desdeDate } },
            ],
        },
        order: [['inicio', 'ASC']],
        limit: 2000,
    });

    return registros.map(r => ({
        inicio: r.inicio,
        fin: r.fin || null,
    }));
};

// ---- Consumo eléctrico ----

const getConsumo = async (db, idPileta, desde, hasta) => {
    const pileta = await db.Pileta.findByPk(idPileta);
    if (!pileta) throw new Error('Pileta no encontrada');

    const p = pileta.get({ plain: true });
    const ahora = new Date();
    const desdeDate = desde ? new Date(desde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const hastaDate = hasta ? new Date(hasta) : ahora;

    const registros = await db.PiletaRegistroConsumo.findAll({
        where: {
            idPileta,
            inicio: { [Op.lte]: hastaDate },
            [Op.or]: [
                { fin: null },
                { fin: { [Op.gte]: desdeDate } },
            ],
        },
    });

    const calcular = (tipo) => {
        const regs = registros.filter(r => r.tipo === tipo);
        let totalMs = 0;
        for (const r of regs) {
            const start = Math.max(new Date(r.inicio).getTime(), desdeDate.getTime());
            const end = Math.min(r.fin ? new Date(r.fin).getTime() : ahora.getTime(), hastaDate.getTime());
            if (end > start) totalMs += end - start;
        }
        const horas = totalMs / 3600000;
        const watts = tipo === 'bombas' ? Number(p.wattsBombas || 0) : Number(p.wattsResistencias || 0);
        const kwh = horas * watts / 1000;
        const costo = kwh * Number(p.precioKwh || 0);
        return {
            segundos: Math.round(totalMs / 1000),
            horas: parseFloat(horas.toFixed(4)),
            kwh: parseFloat(kwh.toFixed(4)),
            costo: parseFloat(costo.toFixed(2)),
        };
    };

    const bombas = calcular('bombas');
    const resistencias = calcular('resistencias');

    return {
        desde: desdeDate,
        hasta: hastaDate,
        wattsResistencias: Number(p.wattsResistencias || 0),
        wattsBombas: Number(p.wattsBombas || 0),
        precioKwh: Number(p.precioKwh || 0),
        resistencias,
        bombas,
        total: {
            kwh: parseFloat((bombas.kwh + resistencias.kwh).toFixed(4)),
            costo: parseFloat((bombas.costo + resistencias.costo).toFixed(2)),
        },
    };
};

// ---- Cola de comandos ----

const crearComando = async (db, idPileta, tipo, payload) => {
    return db.PiletaComando.create({ idPileta, tipo, payload: payload || null, estado: 'pendiente' });
};

const getComandosRecientes = async (db, idPileta, limit = 20) => {
    return db.PiletaComando.findAll({
        where: { idPileta },
        order: [['createdAt', 'DESC']],
        limit,
    });
};

// Usado por el laboratorio para obtener sus comandos pendientes (por hashId)
const getComandosPendientesPorHashIds = async (db, hashIds) => {
    // Buscar las piletas que coinciden con esos hashIds
    const piletas = await db.Pileta.findAll({
        where: { hashId: { [Op.in]: hashIds }, deleted_at: null },
        attributes: ['idPileta', 'hashId'],
    });

    if (!piletas.length) return [];

    const piletaMap = {};
    for (const p of piletas) piletaMap[p.idPileta] = p.hashId;
    const idPiletas = piletas.map(p => p.idPileta);

    const comandos = await db.PiletaComando.findAll({
        where: { idPileta: { [Op.in]: idPiletas }, estado: 'pendiente' },
        order: [['createdAt', 'ASC']],
    });

    if (!comandos.length) return [];

    // Marcar como entregado
    const ids = comandos.map(c => c.idComando);
    await db.PiletaComando.update({ estado: 'entregado' }, { where: { idComando: { [Op.in]: ids } } });

    return comandos.map(c => ({
        idComando: c.idComando,
        hashId: piletaMap[c.idPileta],
        tipo: c.tipo,
        payload: c.payload,
    }));
};

module.exports = {
    getPiletas, getPileta, getPiletasByPlanta,
    createPileta, updatePileta, deletePileta,
    bulkAssignLab,
    procesarReporteLaboratorio, getAlertas, getTemperatureHistory,
    getConsumo,
    getCorrelacionAmbiente, getResistenciasOnRanges,
    crearComando, getComandosRecientes, getComandosPendientesPorHashIds,
};
