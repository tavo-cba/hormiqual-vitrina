const { Op } = require('sequelize');
const { getCacheForDb } = require('./cacheHelpers');

/**
 * Service de EquipoLaboratorio.
 *
 * Recursos MVP (Fase B). Equipos sujetos a calibración trazable según
 * ISO/IEC 17025 §6.4 e IRAM 1546 §6.4. Generaliza Prensa.
 *
 * Coexiste con `Prensa` durante la transición — los equipos `tipo='PRENSA'`
 * comparten `idEquipo` con `idPrensa` (seed-preserve en migración 20260510c).
 *
 * Multi-planta (2026-05-12): un equipo puede estar habilitado en N plantas
 * vía la tabla pivote `EquipoPlanta`. `EquipoLaboratorio.idPlanta` queda
 * como caché de la primera planta activa para compatibilidad con queries
 * legacy que hacen include `as: 'planta'`.
 */

const CACHE_TTL = 600; // 10 min — invalidado por mutaciones

const invalidate = (db) => {
    const tc = getCacheForDb(db);
    tc.invalidate('equipos');
};

const includeDefault = (db) => {
    const inc = [
        { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
        { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
    ];
    if (db.Laboratorio) {
        inc.push({ model: db.Laboratorio, as: 'laboratorio', attributes: ['idLaboratorio', 'nombre'], required: false });
    }
    return inc;
};

const _listarPlantasDeEquipo = async (db, idEquipo) => {
    if (!db.EquipoPlanta) return [];
    const eqpSvc = require('./equipoPlantaService');
    return eqpSvc.listarPlantasDeEquipo(db, idEquipo);
};

/**
 * Sincroniza pivote + actualiza `EquipoLaboratorio.idPlanta` como caché
 * de la primera planta activa (back-compat).
 */
const _syncPlantasEquipo = async (db, idEquipo, plantasConfig) => {
    if (!Array.isArray(plantasConfig)) return;
    if (!db.EquipoPlanta) return;
    const eqpSvc = require('./equipoPlantaService');
    await eqpSvc.sincronizarPlantas(db, idEquipo, plantasConfig);
    const primeraActiva = plantasConfig.find((p) => p && p.idPlanta && p.activo !== false);
    const idPlantaCache = primeraActiva ? Number(primeraActiva.idPlanta) : null;
    const equipo = await db.EquipoLaboratorio.findByPk(idEquipo);
    if (equipo && equipo.idPlanta !== idPlantaCache) {
        await equipo.update({ idPlanta: idPlantaCache });
    }
};

/**
 * Normaliza la entrada. Acepta `plantasConfig` (array nuevo) o el `idPlanta`
 * legacy (un solo valor) y devuelve el array unificado, o null si el caller
 * no quiere tocar la asignación.
 */
const _resolverPlantasConfig = (data) => {
    if (Array.isArray(data.plantasConfig)) return data.plantasConfig;
    if (Object.prototype.hasOwnProperty.call(data, 'idPlanta')) {
        return data.idPlanta ? [{ idPlanta: Number(data.idPlanta), activo: true }] : [];
    }
    return null;
};

/**
 * Anota cada equipo con la última calibración (si existe) y un
 * `estadoCalibracion` derivado: 'sin_calibrar' | 'vencida' | 'por_vencer' |
 * 'vigente'.
 *
 * Por defecto considera "por vencer" cuando faltan ≤ 30 días.
 */
const STATUS_PROXIMO_DIAS = 30;
const annotateCalibracionStatus = async (db, equipos) => {
    if (!equipos.length) return equipos;
    const ids = equipos.map((e) => e.idEquipo);
    const calibraciones = await db.CalibracionEquipo.findAll({
        where: { idEquipo: { [Op.in]: ids }, activo: true },
        order: [['fechaCalibracion', 'DESC']],
        raw: true,
    });
    const lastByEquipo = new Map();
    for (const c of calibraciones) {
        if (!lastByEquipo.has(c.idEquipo)) lastByEquipo.set(c.idEquipo, c);
    }
    // Recursos MVP Fase C: anotar si el equipo tiene una alerta de
    // calibración pendiente. El listado puede mostrar un badge.
    const alertasMap = new Map();
    if (db.AlertaCalidad) {
        const alertas = await db.AlertaCalidad.findAll({
            where: {
                tipo: { [Op.in]: ['CALIBRACION_POR_VENCER', 'CALIBRACION_VENCIDA'] },
                estado: 'PENDIENTE',
                idMaterial: { [Op.in]: ids },
            },
            attributes: ['idAlertaCalidad', 'tipo', 'nivel', 'idMaterial'],
            raw: true,
        });
        const nivelPriority = { CRITICO: 4, ALTO: 3, MEDIO: 2, BAJO: 1, INFO: 0 };
        for (const a of alertas) {
            const cur = alertasMap.get(a.idMaterial);
            const aPri = nivelPriority[a.nivel] ?? 0;
            const curPri = cur ? nivelPriority[cur.nivel] ?? 0 : -1;
            if (aPri > curPri) alertasMap.set(a.idMaterial, a);
        }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return equipos.map((e) => {
        const last = lastByEquipo.get(e.idEquipo);
        let estadoCalibracion = 'sin_calibrar';
        let diasParaVencer = null;
        if (last && last.fechaVencimiento) {
            const venc = new Date(last.fechaVencimiento);
            venc.setHours(0, 0, 0, 0);
            diasParaVencer = Math.round((venc - today) / 86400000);
            if (diasParaVencer < 0) estadoCalibracion = 'vencida';
            else if (diasParaVencer <= STATUS_PROXIMO_DIAS) estadoCalibracion = 'por_vencer';
            else estadoCalibracion = 'vigente';
        }
        const alerta = alertasMap.get(e.idEquipo) || null;
        return {
            ...e,
            ultimaCalibracion: last || null,
            estadoCalibracion,
            diasParaVencer,
            alertaPendiente: alerta
                ? { idAlertaCalidad: alerta.idAlertaCalidad, tipo: alerta.tipo, nivel: alerta.nivel }
                : null,
        };
    });
};

const _enriquecerConPlantas = async (db, equipos) => {
    if (!db.EquipoPlanta || equipos.length === 0) return equipos;
    const ids = equipos.map((e) => e.idEquipo);
    const rows = await db.EquipoPlanta.findAll({
        where: { idEquipo: { [Op.in]: ids } },
        include: [{ model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] }],
        order: [['idPlanta', 'ASC']],
    });
    const byEquipo = new Map();
    for (const r of rows) {
        const plain = r.get({ plain: true });
        if (!byEquipo.has(plain.idEquipo)) byEquipo.set(plain.idEquipo, []);
        byEquipo.get(plain.idEquipo).push(plain);
    }
    for (const e of equipos) {
        e.plantas = byEquipo.get(e.idEquipo) || [];
    }
    return equipos;
};

const getEquipos = async (db, { tipo, idPlanta, idLaboratorio, soloActivos = true } = {}) => {
    const cacheKey = `list:${tipo || 'all'}:${idPlanta || 'all'}:${idLaboratorio || 'all'}:${soloActivos ? 'act' : 'all'}`;
    const tc = getCacheForDb(db);
    const cached = tc.get('equipos', cacheKey);
    if (cached) return cached;

    const where = {};
    if (soloActivos) where.activo = true;
    if (tipo) where.tipo = tipo;
    if (idLaboratorio) where.idLaboratorio = Number(idLaboratorio);

    // Filtro por planta: dual-source. Un equipo aparece si:
    //   (a) está en `EquipoPlanta` con esa planta y activo, O
    //   (b) pertenece a un Laboratorio cuya `LaboratorioPlanta` incluye esa planta.
    // Durante el rollout coexisten ambos caminos. Cuando los equipos tengan
    // todos `idLaboratorio` asignado y el pivote EquipoPlanta esté vacío
    // (Fase 4 completa), el camino (a) deja de devolver datos naturalmente.
    if (idPlanta) {
        const idsSet = new Set();
        if (db.EquipoPlanta) {
            const asignaciones = await db.EquipoPlanta.findAll({
                where: { idPlanta: Number(idPlanta), activo: true },
                attributes: ['idEquipo'],
                raw: true,
            });
            for (const a of asignaciones) idsSet.add(Number(a.idEquipo));
        }
        if (db.LaboratorioPlanta) {
            const labRows = await db.LaboratorioPlanta.findAll({
                where: { idPlanta: Number(idPlanta), activo: true },
                attributes: ['idLaboratorio'],
                raw: true,
            });
            const idLabs = labRows.map((r) => r.idLaboratorio);
            if (idLabs.length > 0) {
                const equiposLab = await db.EquipoLaboratorio.findAll({
                    where: { idLaboratorio: { [Op.in]: idLabs }, activo: true },
                    attributes: ['idEquipo'],
                    raw: true,
                });
                for (const e of equiposLab) idsSet.add(Number(e.idEquipo));
            }
        }
        if (idsSet.size === 0) {
            // Sin EquipoPlanta ni LaboratorioPlanta tabla → caer al campo legacy.
            if (!db.EquipoPlanta && !db.LaboratorioPlanta) {
                where.idPlanta = idPlanta;
            } else {
                tc.set('equipos', cacheKey, [], CACHE_TTL);
                return [];
            }
        } else {
            where.idEquipo = { [Op.in]: [...idsSet] };
        }
    }

    const rows = await db.EquipoLaboratorio.findAll({
        where,
        include: includeDefault(db),
        order: [['tipo', 'ASC'], ['nombre', 'ASC']],
    });
    const plain = rows.map((r) => r.get({ plain: true }));
    const enriched = await _enriquecerConPlantas(db, plain);
    const annotated = await annotateCalibracionStatus(db, enriched);

    tc.set('equipos', cacheKey, annotated, CACHE_TTL);
    return annotated;
};

const getEquipo = async (db, idEquipo) => {
    const row = await db.EquipoLaboratorio.findByPk(idEquipo, {
        include: [
            ...includeDefault(db),
            {
                model: db.CalibracionEquipo,
                as: 'calibraciones',
                where: { activo: true },
                required: false,
                separate: true,
                order: [['fechaCalibracion', 'DESC']],
            },
        ],
    });
    if (!row) {
        const err = new Error('Equipo no encontrado');
        err.status = 404;
        throw err;
    }
    const plain = row.get({ plain: true });
    plain.plantas = await _listarPlantasDeEquipo(db, Number(idEquipo));
    const [annotated] = await annotateCalibracionStatus(db, [plain]);
    return annotated;
};

const TIPOS_VALIDOS = new Set([
    'PRENSA', 'BALANZA', 'HORNO', 'ESTUFA', 'AGITADOR', 'VIBRADOR',
    'MESA_FLUIDEZ', 'CONO_ABRAMS', 'CONO_SLUMP', 'PICNOMETRO',
    'VASO_VOLUMETRICO', 'TERMOMETRO', 'HIGROMETRO', 'CRONOMETRO',
    'MEDIDOR_AIRE', 'OTRO',
]);

const validate = (data) => {
    if (!data.nombre || !String(data.nombre).trim()) {
        const e = new Error('El nombre del equipo es obligatorio');
        e.status = 400;
        throw e;
    }
    if (!data.tipo || !TIPOS_VALIDOS.has(data.tipo)) {
        const e = new Error(`Tipo de equipo inválido. Permitidos: ${[...TIPOS_VALIDOS].join(', ')}`);
        e.status = 400;
        throw e;
    }
};

const createEquipo = async (db, data) => {
    validate(data);
    const plantasConfigInput = _resolverPlantasConfig(data) || [];
    const idPlantaCache = plantasConfigInput.find((p) => p?.activo !== false)?.idPlanta || null;

    // ── Sync inverso Equipo → Prensa (cuando tipo=PRENSA) ──
    // Si el equipo es de tipo PRENSA, primero creamos la fila en la tabla
    // legacy `Prensa` (autoincrement asigna idPrensa). El hook `PrensaHooks`
    // ya existente sincroniza Prensa → EquipoLaboratorio, así que el Equipo
    // queda creado automáticamente con `idEquipo = idPrensa`. Luego sólo
    // completamos los campos Equipo-only (numeroSerie, ubicacion,
    // idLaboratorio, observaciones) que el hook no setea porque no existen
    // en Prensa.
    //
    // Esto garantiza que toda prensa creada desde la pantalla nueva
    // también esté visible en `/api/prensas` (legacy) y que la FK
    // `EnsayoResistencia.idPrensa` siga siendo válida.
    if (data.tipo === 'PRENSA' && db.Prensa) {
        const prensa = await db.Prensa.create({
            nombre: data.nombre.trim(),
            marca: data.marca || null,
            modelo: data.modelo || null,
            anio: data.anio || null,
            capacidad: data.capacidad || null,
            descripcion: data.descripcion || null,
            idUnidadMedidaPrensa: data.idUnidadMedidaPrensa || null,
            tipoOperacion: data.tipoOperacion || 'MANUAL',
            coeficienteUno: data.coeficienteUno ?? null,
            coeficienteDos: data.coeficienteDos ?? null,
            coeficienteTres: data.coeficienteTres ?? null,
            idPlanta: idPlantaCache,
            activo: data.activo !== false,
        });
        // PrensaHooks.afterCreate ya creó el Equipo con idEquipo=idPrensa.
        // Re-fetcheamos y completamos los campos Equipo-only.
        const equipo = await db.EquipoLaboratorio.findByPk(prensa.idPrensa);
        if (!equipo) {
            const err = new Error('Sync Prensa → EquipoLaboratorio falló (hook no se ejecutó).');
            err.status = 500;
            throw err;
        }
        await equipo.update({
            numeroSerie: data.numeroSerie || null,
            ubicacion: data.ubicacion || null,
            observaciones: data.observaciones || null,
            idLaboratorio: data.idLaboratorio || null,
        });

        if (plantasConfigInput.length > 0 && db.EquipoPlanta) {
            try {
                await _syncPlantasEquipo(db, equipo.idEquipo, plantasConfigInput);
            } catch (e) {
                console.warn('[createEquipo] sync plantas falló (non-blocking):', e.message);
            }
        }

        invalidate(db);
        return equipo.get({ plain: true });
    }

    // ── Caso default: equipos no-PRENSA (balanza, horno, etc.) ──
    const equipo = await db.EquipoLaboratorio.create({
        tipo: data.tipo,
        nombre: data.nombre.trim(),
        marca: data.marca || null,
        modelo: data.modelo || null,
        numeroSerie: data.numeroSerie || null,
        anio: data.anio || null,
        capacidad: data.capacidad || null,
        ubicacion: data.ubicacion || null,
        idPlanta: idPlantaCache,
        idLaboratorio: data.idLaboratorio || null,
        idUnidadMedidaPrensa: data.idUnidadMedidaPrensa || null,
        tipoOperacion: data.tipoOperacion || 'MANUAL',
        coeficienteUno: data.coeficienteUno ?? null,
        coeficienteDos: data.coeficienteDos ?? null,
        coeficienteTres: data.coeficienteTres ?? null,
        descripcion: data.descripcion || null,
        observaciones: data.observaciones || null,
        activo: data.activo !== false,
    });

    if (plantasConfigInput.length > 0 && db.EquipoPlanta) {
        try {
            await _syncPlantasEquipo(db, equipo.idEquipo, plantasConfigInput);
        } catch (e) {
            console.warn('[createEquipo] sync plantas falló (non-blocking):', e.message);
        }
    }

    invalidate(db);
    return equipo.get({ plain: true });
};

const updateEquipo = async (db, idEquipo, data) => {
    const equipo = await db.EquipoLaboratorio.findByPk(idEquipo);
    if (!equipo) {
        const err = new Error('Equipo no encontrado');
        err.status = 404;
        throw err;
    }
    if (data.tipo && !TIPOS_VALIDOS.has(data.tipo)) {
        const e = new Error(`Tipo de equipo inválido`);
        e.status = 400;
        throw e;
    }
    const updatable = [
        'tipo', 'nombre', 'marca', 'modelo', 'numeroSerie', 'anio', 'capacidad',
        'ubicacion', 'idLaboratorio', 'idUnidadMedidaPrensa', 'tipoOperacion',
        'coeficienteUno', 'coeficienteDos', 'coeficienteTres',
        'descripcion', 'observaciones', 'activo',
    ];
    // `idPlanta` legacy ya NO se setea desde el body — es caché que recalcula
    // _syncPlantasEquipo a partir de plantasConfig. Si el caller manda solo
    // `idPlanta` (back-compat), _resolverPlantasConfig lo traduce.
    for (const k of updatable) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
            equipo[k] = data[k];
        }
    }
    await equipo.save();

    const plantasConfigInput = _resolverPlantasConfig(data);
    if (plantasConfigInput !== null && db.EquipoPlanta) {
        try {
            await _syncPlantasEquipo(db, equipo.idEquipo, plantasConfigInput);
        } catch (e) {
            console.warn('[updateEquipo] sync plantas falló (non-blocking):', e.message);
        }
    }

    // ── Sync inverso Equipo → Prensa (cuando tipo=PRENSA) ──
    // Mantenemos la fila gemela en `Prensa` actualizada con los campos
    // compartidos. El `/api/prensas` legacy (consumido por ensayoForm) la
    // verá actualizada. Sin esto, la prensa quedaría con datos viejos en la
    // tabla legacy aunque se actualice por la UI nueva.
    if (equipo.tipo === 'PRENSA' && db.Prensa) {
        try {
            const prensa = await db.Prensa.findByPk(equipo.idEquipo);
            if (prensa) {
                const prensaPatch = {};
                const camposCompartidos = [
                    'nombre', 'marca', 'modelo', 'anio', 'capacidad',
                    'descripcion', 'idUnidadMedidaPrensa', 'tipoOperacion',
                    'coeficienteUno', 'coeficienteDos', 'coeficienteTres',
                    'activo',
                ];
                for (const k of camposCompartidos) {
                    if (Object.prototype.hasOwnProperty.call(data, k)) {
                        prensaPatch[k] = data[k];
                    }
                }
                // `idPlanta` también se mantiene en sync (Prensa.idPlanta es caché).
                if (equipo.idPlanta != null) prensaPatch.idPlanta = equipo.idPlanta;
                if (Object.keys(prensaPatch).length > 0) {
                    await prensa.update(prensaPatch);
                }
            }
        } catch (e) {
            console.warn('[updateEquipo] sync inverso Equipo → Prensa falló (non-blocking):', e.message);
        }
    }

    invalidate(db);
    return equipo.get({ plain: true });
};

const deleteEquipo = async (db, idEquipo) => {
    const equipo = await db.EquipoLaboratorio.findByPk(idEquipo);
    if (!equipo) {
        const err = new Error('Equipo no encontrado');
        err.status = 404;
        throw err;
    }
    // Borrado lógico (no se borra físico para preservar trazabilidad
    // ISO 17025 — los ensayos viejos siguen referenciando el equipo
    // via Prensa.idPrensa y eventualmente EnsayoResistencia.idEquipo).
    equipo.activo = false;
    equipo.deleted_at = new Date();
    await equipo.save();
    invalidate(db);
};

/**
 * Asignación masiva de un laboratorio a un conjunto de equipos.
 * Devuelve { updated, skippedNotFound, idLaboratorio }.
 */
const bulkAssignLab = async (db, { idLaboratorio, idsEquipo }) => {
    if (idLaboratorio == null) {
        const e = new Error('idLaboratorio es obligatorio.');
        e.status = 400;
        throw e;
    }
    if (!Array.isArray(idsEquipo) || idsEquipo.length === 0) {
        const e = new Error('idsEquipo debe ser un array no vacío.');
        e.status = 400;
        throw e;
    }
    const lab = await db.Laboratorio.findByPk(idLaboratorio);
    if (!lab) {
        const e = new Error('Laboratorio no encontrado.');
        e.status = 404;
        throw e;
    }
    const equipos = await db.EquipoLaboratorio.findAll({
        where: { idEquipo: { [Op.in]: idsEquipo.map(Number) } },
    });
    const found = new Set(equipos.map((e) => e.idEquipo));
    const skipped = idsEquipo.filter((id) => !found.has(Number(id)));
    for (const equipo of equipos) {
        equipo.idLaboratorio = Number(idLaboratorio);
        await equipo.save();
    }
    invalidate(db);
    return {
        updated: equipos.length,
        skippedNotFound: skipped,
        idLaboratorio: Number(idLaboratorio),
    };
};

module.exports = {
    getEquipos,
    getEquipo,
    createEquipo,
    updateEquipo,
    deleteEquipo,
    bulkAssignLab,
    annotateCalibracionStatus, // exportado para tests
    STATUS_PROXIMO_DIAS,
    TIPOS_VALIDOS,
};
