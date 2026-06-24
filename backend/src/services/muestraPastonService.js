'use strict';

const { Op } = require('sequelize');
const { invalidateProbetasCache } = require('./muestraService');

/**
 * Servicio de MuestraPaston — paralelo a muestraService y muestraTercerosService.
 *
 * Autonumeración de probetas (sesión 2026-06-12):
 *   `T{loteNumero}-{O|P}-P{n}`
 *      T          → "Trial" (pastón de prueba)
 *      loteNumero → próximo número por (fecha, planta, dosificación)
 *      O / P      → origen (Obra / Planta)
 *      Pn         → probeta n
 *
 * Las muestras de pastón se crean automáticamente desde el flujo del pastón
 * (ver `crearMuestraDesdePaston`). El service también expone CRUD para
 * la pantalla dedicada `MuestrasPastonesPage`.
 */

const includeAll = (db) => [
    {
        model: db.Probeta, as: 'probetas', separate: true, order: [['idProbeta', 'ASC']],
        include: [
            ...(db.TipoProbeta ? [{ model: db.TipoProbeta, as: 'tipoProbeta', required: false, attributes: ['idTipoProbeta', 'tipo'] }] : []),
            { model: db.EstadoProbeta, as: 'estadoProbeta', required: false, attributes: ['idEstadoProbeta', 'estado'] },
        ],
    },
    // B3: trae la condición de mezcla (medición del timeline) para que el PDF
    // y la UI muestren a qué momento corresponde el moldeo de la muestra.
    ...(db.MedicionPaston ? [{
        model: db.MedicionPaston, as: 'medicionPaston', required: false,
        attributes: ['id', 'ordenSecuencia', 'etapa', 'etiqueta', 'fechaHora'],
    }] : []),
    ...(db.PastonPrueba ? [{ model: db.PastonPrueba, as: 'pastonPrueba', required: false }] : []),
    // Refactor 2026-05-20: la dosificación de diseño ahora tiene `idTipoHormigon`
    // directo (derivado de f'ce + tipología). Incluimos el tipo asociado para
    // que la UI pueda hacer fallback cuando `MuestraPaston.idTipoHormigon`
    // esté NULL (muestras viejas pre-refactor). Mantenemos también la cadena
    // legacy via `dosificacionCatalogo` para diseños sin tipo derivado todavía.
    ...(db.DosificacionDisenada ? [{
        model: db.DosificacionDisenada, as: 'dosificacion', required: false,
        attributes: ['id', 'nombre', 'idDosificacionCatalogo', 'idTipoHormigon'],
        include: [
            ...(db.TipoHormigon ? [{
                model: db.TipoHormigon, as: 'tipoHormigon', required: false,
                attributes: ['idTipoHormigon', 'tipoHormigon'],
            }] : []),
            ...(db.Dosificacion ? [{
                model: db.Dosificacion, as: 'dosificacionCatalogo', required: false,
                attributes: ['idDosificacion', 'idTipoHormigon'],
                include: db.TipoHormigon ? [{
                    model: db.TipoHormigon, as: 'tipoHormigon', required: false,
                    attributes: ['idTipoHormigon', 'tipoHormigon'],
                }] : [],
            }] : []),
        ],
    }] : []),
    { model: db.Cliente, as: 'cliente', required: false },
    { model: db.Obra, as: 'obra', required: false },
    { model: db.Planta, as: 'planta', required: false },
    { model: db.TipoHormigon, as: 'tipoHormigon', required: false },
    { model: db.Empleado, as: 'operador', required: false },
];

/**
 * Calcula el próximo `loteNumero` de muestra de pastón para una combinación
 * (fecha, planta, dosificación). Busca el primer "hueco" en la secuencia 1..N
 * para reutilizar números liberados si alguno se borró.
 */
async function calcularSiguienteLote(db, { fecha, idPlanta, idDosificacion } = {}, transaction = null) {
    const where = { fecha, idPlanta };
    if (idDosificacion) where.idDosificacion = idDosificacion;
    const existentes = await db.MuestraPaston.findAll({
        where,
        attributes: ['loteNumero'],
        order: [['loteNumero', 'ASC']],
        transaction,
    });
    const usados = existentes.map((r) => Number(r.loteNumero)).filter((n) => Number.isFinite(n));
    let next = 1;
    for (const n of usados) {
        if (n !== next) break;
        next++;
    }
    return next;
}

/**
 * Construye el nombre canónico de una probeta de pastón.
 * Formato: `T{lote}-{O|P}-P{numeroProbeta}`.
 */
function nombreProbetaPaston({ loteNumero, origen, numeroProbeta }) {
    const letraOrigen = origen === 'OBRA' ? 'O' : 'P';
    return `T${loteNumero}-${letraOrigen}-P${numeroProbeta}`;
}

exports.nombreProbetaPaston = nombreProbetaPaston;

// Estados de probeta (catálogo EstadoProbeta, fijo): 3=Ensayada.
// Una probeta está "bloqueada" (no se puede borrar/modificar al editar las
// probetas de un pastón) si ya tiene ensayo de rotura cargado.
const ESTADO_ENSAYADA = 3;
function probetaBloqueada(p) {
    return p.idEnsayoResistencia != null || Number(p.idEstadoProbeta) === ESTADO_ENSAYADA;
}

/**
 * Mapea la clave de planificación del pastón (PROBETA_TYPES del frontend) al
 * `idTipoProbeta` del catálogo `TipoProbeta` (10x20 / 15x30 / Otra). Sólo las
 * cilíndricas estándar tienen entrada propia; el resto cae en "Otra".
 * Acepta también un `idTipoProbeta` numérico explícito (lo devuelve tal cual).
 */
async function resolveIdTipoProbeta(db, valor, cache) {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number' || /^\d+$/.test(String(valor))) return Number(valor);
    if (!db.TipoProbeta) return null;
    const key = String(valor).toLowerCase();
    const label = key.includes('15x30') ? '15x30'
        : key.includes('10x20') ? '10x20'
        : 'Otra';
    if (cache && cache.has(label)) return cache.get(label);
    const row = await db.TipoProbeta.findOne({ where: { tipo: label }, attributes: ['idTipoProbeta'] });
    let id = row ? row.idTipoProbeta : null;
    if (id == null) {
        // Fallback: si no existe la fila exacta, intentar "Otra".
        const otra = label === 'Otra' ? null
            : await db.TipoProbeta.findOne({ where: { tipo: 'Otra' }, attributes: ['idTipoProbeta'] });
        id = otra ? otra.idTipoProbeta : null;
    }
    if (cache) cache.set(label, id);
    return id;
}

exports.resolveIdTipoProbeta = resolveIdTipoProbeta;

/**
 * Busca la última MedicionPaston del timeline para una etapa específica.
 * Se usa como default al crear MuestraPaston: PLANTA → última medición PLANTA,
 * OBRA → última OBRA. Si la muestra es de OBRA pero no hay medición OBRA,
 * cae a TRANSPORTE; si tampoco hay, queda null (el operador decide).
 *
 * "Última" se resuelve por `ordenSecuencia` DESC y desempata por `fechaHora`.
 */
async function ultimaMedicionPorEtapa(db, idPastonPrueba, etapasPreferidas, transaction = null) {
    if (!db.MedicionPaston || !idPastonPrueba) return null;
    for (const etapa of etapasPreferidas) {
        const row = await db.MedicionPaston.findOne({
            where: { idPastonPrueba: Number(idPastonPrueba), etapa },
            attributes: ['id'],
            order: [['ordenSecuencia', 'DESC'], ['fechaHora', 'DESC'], ['id', 'DESC']],
            transaction,
        });
        if (row) return Number(row.id);
    }
    return null;
}

exports.ultimaMedicionPorEtapa = ultimaMedicionPorEtapa;

/* ─────────── Lectura ─────────── */

exports.getMuestrasPastones = (db, filtros = {}) => {
    const where = {};
    if (filtros.fechaDesde && filtros.fechaHasta) {
        where.fecha = { [Op.between]: [filtros.fechaDesde, filtros.fechaHasta] };
    }
    if (filtros.idPlanta) where.idPlanta = Number(filtros.idPlanta);
    if (filtros.idDosificacion) where.idDosificacion = Number(filtros.idDosificacion);
    if (filtros.idPastonPrueba) where.idPastonPrueba = Number(filtros.idPastonPrueba);
    if (filtros.origen) where.origen = filtros.origen;
    return db.MuestraPaston.findAll({
        where,
        include: includeAll(db),
        order: [['fecha', 'DESC'], ['loteNumero', 'DESC']],
    });
};

exports.getMuestraPastonPorId = (db, id) =>
    db.MuestraPaston.findByPk(id, { include: includeAll(db) });

/**
 * Datos para la ficha PDF de una muestra de pastón. Devuelve el mismo shape
 * `{ muestra, fresco, fresco_inputs, esPaston }` que `muestraService.getFicha
 * Muestra` para reutilizar el generador `fichaMuestraPdf` (no duplicar PDF).
 *
 * La muestra de pastón se adapta a la forma "muestra": `idMuestra` ←
 * `idMuestraPaston`; sin despacho/modalidad; con extras `esPaston`, `origen`
 * y `loteNumero` que el generador usa para la sección de Identificación.
 */
exports.getFichaMuestraPaston = async (db, idMuestraPaston, plantaIdsUsuario = null) => {
    const { evaluarMuestraFresco } = require('../domain/ensayoFrescoEvalEngine');

    const mp = await db.MuestraPaston.findByPk(idMuestraPaston, {
        include: [
            { model: db.Cliente, as: 'cliente', attributes: ['idCliente', 'nombre', 'razonSocial', 'tipoPersona'], required: false },
            { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false },
            { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'], required: false },
            { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'], required: false },
            { model: db.Empleado, as: 'operador', attributes: ['idEmpleado', 'nombre', 'apellido'], required: false },
            ...(db.DosificacionDisenada
                ? [{ model: db.DosificacionDisenada, as: 'dosificacion', attributes: ['id', 'nombre'], required: false }]
                : []),
            // Single source of truth para fresco: la medición del timeline del
            // pastón vinculada al moldeo. Si está set, gana sobre los campos
            // legacy del MuestraPaston (decisión 2026-05-27).
            ...(db.MedicionPaston ? [{
                model: db.MedicionPaston, as: 'medicionPaston', required: false,
                attributes: ['id', 'ordenSecuencia', 'etapa', 'etiqueta', 'fechaHora',
                    'asentamientoMm', 'temperaturaHormigonC', 'temperaturaAmbienteC', 'aireMedidoPct'],
            }] : []),
            {
                model: db.Probeta, as: 'probetas',
                include: [
                    { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['idEstadoProbeta', 'estado'] },
                    {
                        model: db.EnsayoResistencia, as: 'ensayo', required: false,
                        include: [
                            { model: db.Empleado, as: 'operarioEnsayo', attributes: ['nombre', 'apellido'], required: false },
                            { model: db.Prensa, as: 'prensa', attributes: ['nombre'], required: false },
                        ],
                    },
                    { model: db.Archivo, as: 'archivos', required: false },
                ],
            },
        ],
    });

    if (!mp) return null;
    if (Array.isArray(plantaIdsUsuario)) {
        if (mp.idPlanta == null || !plantaIdsUsuario.map(Number).includes(Number(mp.idPlanta))) {
            return null;
        }
    }

    const plain = mp.get({ plain: true });

    // Decisión 2026-05-27: si la muestra tiene una medición del timeline
    // vinculada (idMedicionPaston), esa medición es la fuente de verdad para
    // los datos del fresco. Los campos propios del MuestraPaston quedan como
    // legacy / fallback (muestras sin timeline). El asentamiento del
    // MuestraPaston está en cm; el de MedicionPaston en mm.
    //
    // Fallback para muestras legacy (idMedicionPaston NULL) que se crearon
    // antes de que existieran mediciones en el timeline: buscamos la última
    // medición del pastón con etapa coincidente y la usamos como contexto. NO
    // se persiste — solo provee datos al PDF/UI sin obligar al operador a
    // setear el FK en cada muestra histórica.
    let med = plain.medicionPaston || null;
    if (!med && plain.idPastonPrueba && db.MedicionPaston) {
        const etapasPref = plain.origen === 'OBRA' ? ['OBRA', 'TRANSPORTE'] : ['PLANTA'];
        for (const etapa of etapasPref) {
            const fallback = await db.MedicionPaston.findOne({
                where: { idPastonPrueba: Number(plain.idPastonPrueba), etapa },
                attributes: ['id', 'ordenSecuencia', 'etapa', 'etiqueta', 'fechaHora',
                    'asentamientoMm', 'temperaturaHormigonC', 'temperaturaAmbienteC', 'aireMedidoPct'],
                order: [['ordenSecuencia', 'DESC'], ['fechaHora', 'DESC'], ['id', 'DESC']],
            });
            if (fallback) {
                med = fallback.get({ plain: true });
                med._derivado = true; // marca para que el PDF pueda distinguir
                break;
            }
        }
    }
    const asentMmMedicion = med && med.asentamientoMm != null ? Number(med.asentamientoMm) : null;
    const tempHMedicion = med && med.temperaturaHormigonC != null ? Number(med.temperaturaHormigonC) : null;
    const tempAMedicion = med && med.temperaturaAmbienteC != null ? Number(med.temperaturaAmbienteC) : null;
    const aireMedicion = med && med.aireMedidoPct != null ? Number(med.aireMedidoPct) : null;

    const asentMmPropio = plain.asentamiento != null ? Number(plain.asentamiento) * 10 : null;
    const tempHPropio = plain.temperaturaHormigon != null ? Number(plain.temperaturaHormigon) : null;
    const tempAPropio = plain.temperaturaAmbiente != null ? Number(plain.temperaturaAmbiente) : null;
    const airePropio = plain.aireincorporado != null ? Number(plain.aireincorporado) : null;

    const asentMm = asentMmMedicion != null ? asentMmMedicion : asentMmPropio;
    const tempH = tempHMedicion != null ? tempHMedicion : tempHPropio;
    const tempA = tempAMedicion != null ? tempAMedicion : tempAPropio;
    const aire = aireMedicion != null ? aireMedicion : airePropio;

    const fresco = evaluarMuestraFresco({
        temperaturaHormigon: tempH,
        asentamientoMm: asentMm,
        aireincorporado: aire,
    }, { dosificacion: {}, claseExposicion: null });

    if (Array.isArray(plain.probetas)) {
        plain.probetas.sort((a, b) => (a.diasRotura ?? 0) - (b.diasRotura ?? 0));
    }

    return {
        muestra: {
            ...plain,
            idMuestra: plain.idMuestraPaston,        // el generador titula con idMuestra
            esPaston: true,
            origen: plain.origen,                    // 'PLANTA' | 'OBRA'
            loteNumero: plain.loteNumero,
            idPastonPrueba: plain.idPastonPrueba,
        },
        fresco,
        fresco_inputs: {
            asentamientoMmMedido: asentMm,
            temperaturaHormigon: tempH,
            temperaturaAmbiente: tempA,
            aireincorporado: aire,
            // Trazabilidad: indicar de dónde viene cada valor para el PDF.
            // `_fuente` distingue entre vínculo explícito, derivado del timeline
            // (cuando idMedicionPaston era NULL pero hay mediciones), y campos
            // propios del MuestraPaston (último recurso, sólo si no hay timeline).
            _fuente: med ? (med._derivado ? 'medicion_derivada' : 'medicion') : 'propio',
            medicion: med ? {
                id: med.id,
                ordenSecuencia: med.ordenSecuencia,
                etapa: med.etapa,
                etiqueta: med.etiqueta,
                fechaHora: med.fechaHora,
                derivado: !!med._derivado,
            } : null,
        },
        esPaston: true,
    };
};

/* ─────────── Escritura ─────────── */

/**
 * Crea una MuestraPaston desde un pastón, generando sus probetas con
 * autonumeración. Si el pastón aporta `probetasPlanificadas`, las crea con
 * los días de rotura sugeridos por la config del tenant.
 *
 * @param {object} db
 * @param {object} input
 *   - idPastonPrueba (number, requerido)
 *   - origen ('PLANTA' | 'OBRA', requerido)
 *   - idDosificacion (number, opcional)
 *   - idPlanta (number, requerido)
 *   - fecha (Date|string, default = hoy)
 *   - probetas: Array de { tipo, codigo?, observaciones?, diasRotura, idEstadoProbeta? }
 *   - resto de campos del modelo (temperaturas, asentamiento, etc.) opcionales
 * @returns {Promise<MuestraPaston>}
 */
exports.crearMuestraDesdePaston = async (db, input = {}) => {
    if (!input.idPastonPrueba) {
        throw Object.assign(new Error('idPastonPrueba requerido'), { status: 422 });
    }
    if (input.origen !== 'PLANTA' && input.origen !== 'OBRA') {
        throw Object.assign(new Error('origen debe ser PLANTA u OBRA'), { status: 422 });
    }
    if (!input.idPlanta) {
        throw Object.assign(new Error('idPlanta requerido'), { status: 422 });
    }

    const fecha = input.fecha
        ? (typeof input.fecha === 'string' ? input.fecha.slice(0, 10) : new Date(input.fecha).toISOString().slice(0, 10))
        : new Date().toISOString().slice(0, 10);

    // Fix 2026-05-20: si no llega `idTipoHormigon` pero sí hay
    // `idDosificacion`, lo derivamos en cascada:
    //   1) DosificacionDisenada.idTipoHormigon (derivado de f'ce+tipología,
    //      post-refactor tipoHormigonIRAM1666).
    //   2) DosificacionDisenada → dosificacionCatalogo.idTipoHormigon (legacy,
    //      para diseños sin tipo derivado).
    // Esto evita que la columna "Tipo H°" quede vacía en la grilla.
    let idTipoHormigonEfectivo = input.idTipoHormigon ? Number(input.idTipoHormigon) : null;
    if (!idTipoHormigonEfectivo && input.idDosificacion && db.DosificacionDisenada) {
        try {
            const dis = await db.DosificacionDisenada.findByPk(Number(input.idDosificacion), {
                attributes: ['id', 'idTipoHormigon', 'idDosificacionCatalogo'],
            });
            if (dis?.idTipoHormigon) {
                idTipoHormigonEfectivo = Number(dis.idTipoHormigon);
            } else if (dis?.idDosificacionCatalogo && db.Dosificacion) {
                const cat = await db.Dosificacion.findByPk(dis.idDosificacionCatalogo, {
                    attributes: ['idDosificacion', 'idTipoHormigon'],
                });
                if (cat?.idTipoHormigon) idTipoHormigonEfectivo = Number(cat.idTipoHormigon);
            }
        } catch (e) {
            // Defensivo: si la cadena falla por algún motivo, seguimos con null.
            console.warn('[crearMuestraDesdePaston] No se pudo derivar idTipoHormigon:', e.message);
        }
    }

    const t = await db.sequelize.transaction();
    try {
        const loteNumero = await calcularSiguienteLote(db, {
            fecha,
            idPlanta: Number(input.idPlanta),
            idDosificacion: input.idDosificacion ? Number(input.idDosificacion) : null,
        }, t);

        // Default de idMedicionPaston (decisión 2026-05-27): PLANTA → última
        // PLANTA del timeline, OBRA → última OBRA (con fallback a TRANSPORTE).
        // Si el caller la proveyó explícitamente, se respeta. Si no hay
        // mediciones todavía, queda null y el operador la setea más adelante.
        let idMedicionPastonEfectivo = input.idMedicionPaston ? Number(input.idMedicionPaston) : null;
        if (idMedicionPastonEfectivo == null) {
            const etapasPref = input.origen === 'OBRA' ? ['OBRA', 'TRANSPORTE'] : ['PLANTA'];
            idMedicionPastonEfectivo = await ultimaMedicionPorEtapa(
                db, Number(input.idPastonPrueba), etapasPref, t,
            );
        }

        const muestra = await db.MuestraPaston.create({
            idPastonPrueba: Number(input.idPastonPrueba),
            idDosificacion: input.idDosificacion ? Number(input.idDosificacion) : null,
            idPlanta: Number(input.idPlanta),
            idObra: input.idObra ? Number(input.idObra) : null,
            idCliente: input.idCliente ? Number(input.idCliente) : null,
            idTipoHormigon: idTipoHormigonEfectivo,
            idOperador: input.idOperador ? Number(input.idOperador) : null,
            // B3: condición de mezcla (medición del timeline) al moldear.
            idMedicionPaston: idMedicionPastonEfectivo,
            origen: input.origen,
            fecha,
            loteNumero,
            temperaturaAmbiente: input.temperaturaAmbiente ?? null,
            temperaturaHormigon: input.temperaturaHormigon ?? null,
            asentamiento: input.asentamiento ?? null,
            aireincorporado: input.aireincorporado ?? null,
            remito: input.remito || null,
            observaciones: input.observaciones || null,
            estado: true,
        }, { transaction: t });

        // Crear probetas asociadas con nombres autonumerados.
        const probetas = Array.isArray(input.probetas) ? input.probetas : [];
        if (probetas.length > 0) {
            const MS_DIA = 86400000;
            const baseDate = new Date(`${fecha}T12:00:00`);
            const ahora = new Date();
            const tipoCache = new Map();
            const tiposResueltos = await Promise.all(
                probetas.map((p) => resolveIdTipoProbeta(db, p.idTipoProbeta ?? p.tipo, tipoCache))
            );
            const regs = probetas.map((p, i) => {
                const diasRotura = Number(p.diasRotura) || 28;
                const fechaRotura = new Date(baseDate.getTime() + diasRotura * MS_DIA);
                fechaRotura.setHours(12, 0, 0, 0);
                let estado = p.idEstadoProbeta ?? 1;
                if (estado === 2 && fechaRotura > ahora) estado = 1;
                else if (estado === 1 && fechaRotura < ahora) estado = 2;
                return {
                    idMuestraPaston: muestra.idMuestraPaston,
                    idPastonPrueba: Number(input.idPastonPrueba),
                    idEstadoProbeta: estado,
                    idTipoProbeta: tiposResueltos[i],
                    nombre: nombreProbetaPaston({ loteNumero, origen: input.origen, numeroProbeta: i + 1 }),
                    codigo: p.codigo || null,
                    observaciones: p.observaciones || null,
                    diasRotura,
                    fechaRotura,
                };
            });
            await db.Probeta.bulkCreate(regs, { transaction: t });
        }

        await t.commit();
        try { invalidateProbetasCache(db); } catch { /* cache helper opcional */ }
        return db.MuestraPaston.findByPk(muestra.idMuestraPaston, { include: includeAll(db) });
    } catch (err) {
        await t.rollback();
        throw err;
    }
};

exports.updateMuestraPaston = async (db, id, payload = {}) => {
    const muestra = await db.MuestraPaston.findByPk(id);
    if (!muestra) throw Object.assign(new Error('Muestra de pastón no encontrada'), { status: 404 });
    const { probetas: _ignored, idMuestraPaston: __ignored, ...campos } = payload;
    await muestra.update(campos);
    return db.MuestraPaston.findByPk(id, { include: includeAll(db) });
};

/**
 * Sincroniza las probetas de una MuestraPaston contra una lista deseada.
 * Permite corregir cantidad / tipo / edad de rotura / código / observaciones
 * cuando el operador se equivocó al guardar el pastón.
 *
 * Regla de integridad (decisión 2026-05-18): las probetas ya ENSAYADAS
 * (`idEnsayoResistencia != null` o estado "Ensayada") están BLOQUEADAS: no se
 * borran ni se modifican, se conservan tal cual y se reportan. El resto
 * (Curando / Pendiente / Descartada / Perdida) se puede agregar, quitar o
 * editar libremente.
 *
 * Numeración: las probetas existentes conservan su nombre `T{lote}-{O|P}-P{n}`
 * (no se renumeran, para no romper referencias de probetas ya ensayadas). Las
 * nuevas continúan la secuencia desde el mayor `n` existente.
 *
 * @param {object} db
 * @param {number} idMuestraPaston
 * @param {Array} deseadas  - [{ idProbeta?, idTipoProbeta?|tipo, diasRotura,
 *                              codigo?, observaciones?, idEstadoProbeta? }]
 * @returns {Promise<{ muestra, creadas, actualizadas, eliminadas, bloqueadas }>}
 */
exports.sincronizarProbetas = async (db, idMuestraPaston, deseadas = []) => {
    const muestra = await db.MuestraPaston.findByPk(idMuestraPaston);
    if (!muestra) throw Object.assign(new Error('Muestra de pastón no encontrada'), { status: 404 });
    if (!Array.isArray(deseadas)) {
        throw Object.assign(new Error('probetas debe ser un arreglo'), { status: 422 });
    }

    const existentes = await db.Probeta.findAll({ where: { idMuestraPaston } });
    const existentesPorId = new Map(existentes.map((p) => [Number(p.idProbeta), p]));
    const bloqueadas = existentes.filter(probetaBloqueada);
    const idsBloqueadas = new Set(bloqueadas.map((p) => Number(p.idProbeta)));

    // Mayor número de probeta usado (incluye bloqueadas) para no reciclar
    // nombres y evitar colisiones del índice de nombre.
    let maxNum = 0;
    for (const p of existentes) {
        const m = /-P(\d+)$/.exec(String(p.nombre || ''));
        if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }

    const fechaStr = typeof muestra.fecha === 'string'
        ? muestra.fecha.slice(0, 10)
        : new Date(muestra.fecha).toISOString().slice(0, 10);
    const MS_DIA = 86400000;
    const baseDate = new Date(`${fechaStr}T12:00:00`);
    const ahora = new Date();
    const tipoCache = new Map();

    const calcFechaRotura = (dias) => {
        const f = new Date(baseDate.getTime() + Number(dias) * MS_DIA);
        f.setHours(12, 0, 0, 0);
        return f;
    };
    // Estado coherente con la fecha de rotura, respetando Descartada/Perdida.
    const estadoCoherente = (estadoActual, fechaRotura) => {
        const e = Number(estadoActual) || 1;
        if (e === 4 || e === 5 || e === ESTADO_ENSAYADA) return e;
        return fechaRotura > ahora ? 1 : 2;
    };

    const t = await db.sequelize.transaction();
    try {
        let creadas = 0, actualizadas = 0, eliminadas = 0;
        const idsDeseadasConservadas = new Set();

        for (const d of deseadas) {
            const dias = Number(d.diasRotura) || 28;
            const fechaRotura = calcFechaRotura(dias);
            const idTipo = await resolveIdTipoProbeta(db, d.idTipoProbeta ?? d.tipo, tipoCache);

            if (d.idProbeta && existentesPorId.has(Number(d.idProbeta))) {
                const idp = Number(d.idProbeta);
                idsDeseadasConservadas.add(idp);
                if (idsBloqueadas.has(idp)) continue; // bloqueada → intacta
                const prob = existentesPorId.get(idp);
                await prob.update({
                    diasRotura: dias,
                    fechaRotura,
                    idTipoProbeta: idTipo,
                    codigo: d.codigo || null,
                    observaciones: d.observaciones || null,
                    idEstadoProbeta: estadoCoherente(d.idEstadoProbeta ?? prob.idEstadoProbeta, fechaRotura),
                }, { transaction: t });
                actualizadas++;
            } else {
                maxNum += 1;
                await db.Probeta.create({
                    idMuestraPaston,
                    idPastonPrueba: muestra.idPastonPrueba,
                    idTipoProbeta: idTipo,
                    idEstadoProbeta: estadoCoherente(d.idEstadoProbeta ?? 1, fechaRotura),
                    nombre: nombreProbetaPaston({
                        loteNumero: muestra.loteNumero, origen: muestra.origen, numeroProbeta: maxNum,
                    }),
                    codigo: d.codigo || null,
                    observaciones: d.observaciones || null,
                    diasRotura: dias,
                    fechaRotura,
                }, { transaction: t });
                creadas++;
            }
        }

        // Borrar las editables que ya no están en la lista deseada. Las
        // bloqueadas nunca entran acá.
        const aEliminar = existentes
            .filter((p) => !idsBloqueadas.has(Number(p.idProbeta)))
            .filter((p) => !idsDeseadasConservadas.has(Number(p.idProbeta)))
            .map((p) => Number(p.idProbeta));
        if (aEliminar.length > 0) {
            eliminadas = await db.Probeta.destroy({
                where: { idProbeta: aEliminar, idMuestraPaston },
                transaction: t,
            });
        }

        await t.commit();
        try { invalidateProbetasCache(db); } catch { /* cache helper opcional */ }
        const fresh = await db.MuestraPaston.findByPk(idMuestraPaston, { include: includeAll(db) });
        return {
            muestra: fresh,
            creadas,
            actualizadas,
            eliminadas,
            bloqueadas: bloqueadas.length,
        };
    } catch (err) {
        await t.rollback();
        throw err;
    }
};

exports.deleteMuestraPaston = async (db, id) => {
    const t = await db.sequelize.transaction();
    try {
        await db.Probeta.destroy({ where: { idMuestraPaston: id }, transaction: t });
        await db.MuestraPaston.destroy({ where: { idMuestraPaston: id }, transaction: t });
        await t.commit();
        try { invalidateProbetasCache(db); } catch { /* ignore */ }
    } catch (err) {
        await t.rollback();
        throw err;
    }
};
