const { Op } = require('sequelize');
const {
    evalAgainstSpec,
    calcularModuloFinura,
    calcularTMN,
    normalizeMedidos,
    autoEvaluarGranulometriaFinoIRAM1627,
    resolverCumpleGrueso,
} = require('./granulometriaEvalService');
const {
    validateAndNormalizeResultado,
    getCanonicalCodigo,
    isAliasCodigo,
    getAliasCodesFor,
} = require('../domain/ensayoResultRegistry');
const { getVigenciaRecomendadaMeses, getVigenciaEfectivaMeses } = require('../domain/vigenciaEnsayos');
const { evaluarCurvaContraHuso } = require('./husoEvalService');

// ─── Constantes de códigos de tipos derivados ───────────────
const CODIGO_GRANULOMETRIA = 'IRAM1505_GRANULOMETRIA';
const CODIGO_GRANULOMETRIA_LEGACY = 'IRAM1627_GRANULOMETRIA_ESPECIFICA';

// ─── Helpers ────────────────────────────────────────────────

/**
 * Defensive: some DB rows have double-encoded JSON resultado (stored as string).
 * Returns the parsed resultado object, or {} if null/unparseable.
 */
const safeParseResultado = (e) => {
    let r = e.resultado;
    if (typeof r === 'string') {
        try { r = JSON.parse(r); } catch { r = null; }
    }
    return r || {};
};

/**
 * Si el resultado contiene datos de granulometría con idCurvaObjetivo,
 * carga la curva, evalúa y setea evaluación + cumple.
 * Nunca falla: si algo sale mal, loguea y continúa.
 *
 * @returns {{ resultado, cumple }} – resultado enriquecido y cumple calculado (o null)
 */
const evaluarGranulometriaEnResultado = async (db, resultado, cumpleExplicito) => {
    if (!resultado?.granulometria?.idCurvaObjetivo) {
        return { resultado, cumple: null };
    }

    try {
        const curvaService = require('./curvaGranulometricaService');
        const idCurva = resultado.granulometria.idCurvaObjetivo;
        const curva = await curvaService.getCurva(db, idCurva);
        if (!curva) {
            console.warn(`[evaluarGranulometria] Curva ${idCurva} no encontrada. Omitiendo evaluación.`);
            return { resultado, cumple: null };
        }

        const specPuntos = curva.tipo === 'TEORICA'
            ? (curva.puntosCalculados || [])
            : (curva.puntos || []);

        const medidos = resultado.granulometria.puntos || [];
        const serieTamices = resultado.granulometria.serieTamices || curva.serieTamices;

        const evalResult = evalAgainstSpec({
            medidos,
            spec: { specMode: curva.specMode, puntos: specPuntos },
            serieTamices,
            // tipoAgregado needed for calcularModuloFinura to handle coarse aggregates correctly
            tipoAgregado: resultado.granulometria.tipoAgregado || null,
        });

        // Enrich resultado with new structure
        resultado.granulometria.evaluacion = {
            cumple: evalResult.cumple,
            estado: evalResult.estado,
            fueraDeBanda: evalResult.fueraDeBanda,
            faltantes: evalResult.faltantes,
            stats: evalResult.stats,
            series: evalResult.series,
            calculos: evalResult.calculos,
        };
        resultado.granulometria.objetivo = {
            idCurvaObjetivo: curva.idCurva,
            nombre: curva.nombre,
            normaRef: curva.normaRef,
            specMode: curva.specMode,
            serieTamices: curva.serieTamices,
            uso: curva.uso,
            tmnMm: curva.tmnMm,
            curveLetter: curva.curveLetter,
        };

        // Determine cumple: if explicit from user, respect it; otherwise use eval
        let cumple;
        if (evalResult.estado === 'INCOMPLETO') {
            cumple = cumpleExplicito && cumpleExplicito !== 'NO_EVAL' ? null : 'PENDIENTE';
        } else {
            cumple = cumpleExplicito && cumpleExplicito !== 'NO_EVAL'
                ? null  // user set it explicitly, don't override
                : (evalResult.cumple ? 'CUMPLE' : 'NO_CUMPLE');
        }

        return { resultado, cumple };
    } catch (err) {
        console.error('[evaluarGranulometria] Error no crítico:', err.message);
        return { resultado, cumple: null };
    }
};

/* ═══════════════════════════════════════════════════════════
   Auto-evaluación granulometría de finos
   ───────────────────────────────────────────────────────────
   v2 audit P0.9: la implementación canónica vive en
   `granulometriaEvalService.autoEvaluarGranulometriaFinoIRAM1627`.
   Acá solo delegamos para mantener el call-site público estable.
   ═══════════════════════════════════════════════════════════ */
const autoEvaluarGranulometriaFino = (resultado) => autoEvaluarGranulometriaFinoIRAM1627(resultado);

/**
 * Resuelve el contextoAplicacion efectivo de un ensayo:
 *   1. Si el caller pasa contextoAplicacion explícito, se respeta.
 *   2. Si no, se deriva de agregado.aptitudes:
 *      - solo 'HORMIGON' en aptitudes → 'HORMIGON'
 *      - solo TBS_* en aptitudes → 'TBS'
 *      - HORMIGON + TBS_* en aptitudes → 'AMBOS'
 *      - default/unknown → 'HORMIGON' (preserva histórico)
 *
 * Valores permitidos: 'HORMIGON' | 'TBS' | 'AMBOS'.
 */
const resolverContextoAplicacion = async (db, { idAgregado, contextoExplicito } = {}) => {
    if (contextoExplicito && ['HORMIGON', 'TBS', 'AMBOS'].includes(contextoExplicito)) {
        return contextoExplicito;
    }
    if (!idAgregado) return 'HORMIGON';
    try {
        const agregado = await db.Agregado.findByPk(idAgregado, { attributes: ['aptitudes'] });
        if (!agregado) return 'HORMIGON';
        let apt = agregado.aptitudes;
        if (typeof apt === 'string') {
            try { apt = JSON.parse(apt); } catch { apt = []; }
        }
        if (!Array.isArray(apt) || apt.length === 0) return 'HORMIGON';
        const tieneHormigon = apt.includes('HORMIGON');
        const tieneTbs = apt.some((a) => typeof a === 'string' && a.startsWith('TBS'));
        if (tieneHormigon && tieneTbs) return 'AMBOS';
        if (tieneTbs) return 'TBS';
        return 'HORMIGON';
    } catch {
        return 'HORMIGON';
    }
};

/**
 * Determina si un contexto gatilla la evaluación contra normas de hormigón.
 * HORMIGON y AMBOS → sí. TBS → no (se evalúa contra huso DNV en Dotación).
 */
const contextoGatillaEvalHormigon = (contexto) => contexto === 'HORMIGON' || contexto === 'AMBOS';

const MSG_SKIP_TBS = 'Ensayo cargado con contextoAplicacion=TBS. No se evalúa contra IRAM 1627/CIRSOC. La evaluación aplicable se realiza al armar la Dotación de Obra contra el huso DNV exigido por la ObraTBS.';

/**
 * Evalúa la curva granulométrica de un ensayo TBS contra un huso DNV
 * declarado como referencia por el usuario (idHusoDnvReferencia).
 *
 * Carga el huso con sus puntos + tamices, invoca el evaluador compartido
 * y enriquece `resultado._evaluacionHuso` con el reporte. Devuelve el
 * cumple calculado ('CUMPLE' | 'NO_CUMPLE') o null si no aplica / falla.
 */
const evaluarContraHusoReferencia = async (db, { resultado, idHusoDnvReferencia }) => {
    if (!idHusoDnvReferencia) return null;
    const tamices = resultado?.granulometria?.tamices;
    if (!Array.isArray(tamices) || tamices.length === 0) return null;
    try {
        const huso = await db.HusoDNV.findByPk(idHusoDnvReferencia, {
            include: [{ model: db.HusoDNVPunto, as: 'puntos', include: [{ model: db.Tamiz, as: 'tamiz' }] }],
        });
        if (!huso) return null;
        const curvaEnsayo = tamices
            .filter((t) => t.pasaPct != null)
            .map((t) => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct) }));
        const husoPuntos = (huso.puntos || []).map((p) => ({
            aberturaMm: Number(p.tamiz?.aberturaMm),
            designacion: p.tamiz?.designacion,
            pasaPctMin: Number(p.pasaPctMin),
            pasaPctMax: Number(p.pasaPctMax),
        }));
        const evalOut = evaluarCurvaContraHuso(curvaEnsayo, husoPuntos);
        resultado._evaluacionHuso = {
            idHusoDNV: huso.idHusoDNV,
            codigo: huso.codigo,
            tipoTBS: huso.tipoTBS,
            capa: huso.capa,
            tmnMm: Number(huso.tmnMm),
            cumple: evalOut.cumple,
            filas: evalOut.filas,
            violaciones: evalOut.violaciones,
        };
        return evalOut.cumple ? 'CUMPLE' : 'NO_CUMPLE';
    } catch (err) {
        console.error('[evaluarContraHusoReferencia] Error no crítico:', err.message);
        return null;
    }
};

/* ═══════════════════════════════════════════════════════════
   Auto-evaluación granulometría de gruesos (Tabla 3.5 CIRSOC)
   ═══════════════════════════════════════════════════════════ */

// Tabla 3.5 CIRSOC 200-2024 — Granulometrías del agregado grueso
// Each row: { tmnNominal, tamices: [aberturaMm, limInf, limSup] }
const TABLA_3_5_GRUESO = [
    { tmnNominal: '53,0 a 4,75', tmnMin: 50, tmnMax: 55,
      bandas: [[53, 95, 100], [26.5, 35, 70], [13.2, 15, 30], [4.75, 0, 5]] },
    { tmnNominal: '37,5 a 4,75', tmnMin: 35, tmnMax: 40,
      bandas: [[53, 100, 100], [37.5, 95, 100], [19, 35, 70], [9.5, 10, 30], [4.75, 0, 5]] },
    { tmnNominal: '26,5 a 4,75', tmnMin: 25, tmnMax: 28,
      bandas: [[37.5, 100, 100], [26.5, 95, 100], [13.2, 25, 60], [4.75, 0, 10], [2.36, 0, 5]] },
    { tmnNominal: '19,0 a 4,75', tmnMin: 18, tmnMax: 20,
      bandas: [[26.5, 100, 100], [19, 90, 100], [9.5, 20, 55], [4.75, 0, 10], [2.36, 0, 5]] },
    { tmnNominal: '13,2 a 4,75', tmnMin: 12, tmnMax: 14,
      bandas: [[19, 100, 100], [13.2, 90, 100], [9.5, 40, 70], [4.75, 0, 15], [2.36, 0, 5]] },
    { tmnNominal: '53,0 a 26,5', tmnMin: 50, tmnMax: 55,
      bandas: [[53, 100, 100], [53, 90, 100], [37.5, 35, 70], [26.5, 0, 15], [13.2, 0, 5]] },
    { tmnNominal: '37,5 a 19,0', tmnMin: 35, tmnMax: 40,
      bandas: [[53, 100, 100], [37.5, 90, 100], [26.5, 20, 55], [19, 0, 15], [9.5, 0, 5]] },
];

/**
 * Parsea el tamiz inferior "d" del rótulo "D a d" (ej. "37,5 a 4,75" → 4.75).
 * Acepta coma o punto decimal. Devuelve null si no se puede parsear.
 */
function _parseTamizInferior(tmnNominal) {
    if (typeof tmnNominal !== 'string') return null;
    const parts = tmnNominal.split(' a ');
    if (parts.length !== 2) return null;
    const dRaw = parts[1].trim().replace(',', '.');
    const d = Number(dRaw);
    return Number.isFinite(d) ? d : null;
}

/**
 * Encuentra la banda de Tabla 3.5 CIRSOC 200-2024 más adecuada para el
 * material según TMN y, si está disponible, el % pasante en el tamiz
 * inferior `d` de cada banda candidata.
 *
 * Pre-X10 (auditoría 2026-05-08): la heurística priorizaba ciegamente
 * la banda continua "D a 4,75" sobre la fraccionada "D a d". Para un
 * ripio fraccionado (ej. 19-28 mm con TMN=37,5 mm y casi 0% pasante en
 * 19 mm), eso elegía "37,5 a 4,75" cuyo límite en 19 mm es 35-70% pasante
 * → falso NO CUMPLE de la auto-evaluación. El usuario que asignaba
 * curva objetivo "37,5 a 19,0" recibía un mensaje "Atención" engañoso
 * que sugería revisar su elección manual cuando en realidad la heurística
 * automática era la equivocada.
 *
 * Lógica nueva:
 *   1. Filtra candidatas por TMN nominal (rango ±tolerancia de la tabla).
 *   2. Si hay una sola candidata, la devuelve.
 *   3. Si hay múltiples y disponemos de `medidosMap` (abertura → pasaPct),
 *      elige aquella cuyo tamiz inferior `d` tenga pasante ≤ 15% (típico
 *      de banda fraccionada legítima); cuando ninguna candidata cumple
 *      el criterio relajado, prefiere la de menor pasante en `d`.
 *   4. Sin `medidosMap`, mantiene el comportamiento legacy (preferir
 *      continua) para no romper callers que aún no propagan el mapa.
 *
 * @param {number|string} tmnMm
 * @param {Map<number, number>} [medidosMap] - abertura (mm) → pasa (%)
 * @returns {object|null}
 */
function _findBandaGrueso(tmnMm, medidosMap = null) {
    if (!tmnMm) return null;
    // Common TMN values: 19, 13.2, 26.5, 37.5, 53
    const tmn = Number(tmnMm);
    const candidatas = TABLA_3_5_GRUESO.filter(
        b => tmn >= b.tmnMin && tmn <= b.tmnMax,
    );
    if (candidatas.length === 0) return null;
    if (candidatas.length === 1) return candidatas[0];

    // X10: discriminar contando cuántos tamices del material caen DENTRO
    // de los límites de cada banda candidata. La banda con mayor cantidad
    // de matches gana; en empate, la de menor cantidad de "fuera de banda"
    // gana. Este criterio es más robusto que mirar solo el tamiz `d`,
    // porque captura material fraccionado donde varios tamices intermedios
    // están vacíos (típico ripio 19-28 con 0% pasante en 9.5 y 4.75).
    if (medidosMap instanceof Map && medidosMap.size > 0) {
        let mejor = null;
        let mejorMatches = -1;
        let mejorFuera = Infinity;
        for (const b of candidatas) {
            let matches = 0;
            let fuera = 0;
            for (const [ab, limInf, limSup] of b.bandas) {
                const pasa = medidosMap.get(ab);
                if (pasa == null) continue;
                if (pasa >= limInf && pasa <= limSup) matches++;
                else fuera++;
            }
            // Solo considerar candidatas que tienen al menos un tamiz medido
            // dentro de su rango (sino la decisión es arbitraria).
            if (matches === 0 && fuera === 0) continue;
            // Mejor banda = más matches; en empate, menos fuera.
            if (matches > mejorMatches || (matches === mejorMatches && fuera < mejorFuera)) {
                mejorMatches = matches;
                mejorFuera = fuera;
                mejor = b;
            }
        }
        if (mejor) return mejor;
    }

    // Fallback legacy (sin medidosMap o sin datos en `d`): preferir
    // gradación continua (a 4,75) sobre fraccionada.
    const continuos = candidatas.filter(b => b.tmnNominal.includes('4,75'));
    if (continuos.length > 0) return continuos[0];
    return candidatas[0];
}

const ALT_TO_STD_MAP = { 50: 53, 25: 26.5, 12.5: 13.2, 4.8: 4.75, 2.4: 2.36 };

const autoEvaluarGranulometriaGrueso = (resultado) => {
    const g = resultado?.granulometria;
    if (!g?.tamices?.length) return resultado;

    // Build abertura→pasaPct map, mapping alt tamices to standard
    const medidosMap = new Map();
    for (const t of g.tamices) {
        if (t.pasaPct != null && t.habilitado !== false) {
            const stdAb = ALT_TO_STD_MAP[t.aberturaMm] ?? t.aberturaMm;
            medidosMap.set(stdAb, Number(t.pasaPct));
        }
    }
    if (medidosMap.size < 3) return resultado;

    // Determine TMN from evaluacion or calculated
    let tmnMm = g.evaluacion?.calculos?.tmn?.valor ?? null;
    if (tmnMm == null) {
        // Fallback: find smallest sieve with >= 95% passing
        const sorted = [...medidosMap.entries()].sort((a, b) => a[0] - b[0]);
        for (const [ab, pasa] of sorted) {
            if (pasa >= 95) { tmnMm = ab; break; }
        }
    }

    // X10: pasamos `medidosMap` para que la heurística pueda elegir la
    // banda fraccionada cuando el material lo es (pasante ≤15% en `d`).
    const banda = _findBandaGrueso(tmnMm, medidosMap);
    if (!banda) {
        resultado.granulometria.evaluacionAutoGrueso = {
            tipo: 'granulometria_grueso',
            tmnMm,
            error: `No se encontro banda en Tabla 3.5 para TMN ${tmnMm} mm`,
        };
        return resultado;
    }

    // Evaluate against band
    const detalle = [];
    let fuera = 0, peorDesvio = 0;
    for (const [ab, limInf, limSup] of banda.bandas) {
        const pasa = medidosMap.get(ab) ?? null;
        if (pasa == null) continue;
        const dentro = pasa >= limInf && pasa <= limSup;
        const desvio = !dentro ? (pasa < limInf ? limInf - pasa : pasa - limSup) : 0;
        if (!dentro) fuera++;
        if (desvio > peorDesvio) peorDesvio = desvio;
        detalle.push({ aberturaMm: ab, pasa, limInf, limSup, estado: dentro ? 'OK' : 'FUERA', desvio });
    }

    const cumple = fuera === 0;
    const imp = [];
    if (cumple) {
        imp.push(`Granulometria dentro de los limites de Tabla 3.5 para TMN ${banda.tmnNominal} mm.`);
    } else {
        imp.push(`${fuera} tamiz(ces) fuera de banda Tabla 3.5 (TMN ${banda.tmnNominal} mm). Peor desvio: ${peorDesvio} pp.`);
    }

    resultado.granulometria.evaluacionAutoGrueso = {
        tipo: 'granulometria_grueso',
        tmnMm,
        bandaNominal: banda.tmnNominal,
        cumple,
        fueraDeBanda: fuera,
        peorDesvio,
        tamicesEvaluados: detalle.length,
        detalle,
        implicancias: imp.join('\n'),
    };

    return resultado;
};

/**
 * Si fechaVencimiento no viene pero el tipo tiene periodicidadMeses,
 * autocalcula fechaVencimiento = fechaEnsayo + periodicidadMeses.
 */
const calcularFechaVencimiento = (fechaEnsayo, periodicidadMeses, fechaVencimientoExplicita) => {
    if (fechaVencimientoExplicita) return fechaVencimientoExplicita;
    if (!periodicidadMeses || !fechaEnsayo) return null;
    const d = new Date(fechaEnsayo);
    d.setMonth(d.getMonth() + periodicidadMeses);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
};

/**
 * Sincroniza ensayos derivados (MF, TMN) a partir de un ensayo de granulometría guardado.
 *
 * Busca todos los AgregadoEnsayoTipo con esDerivado=true y derivadoDeCodigo igual
 * al código del tipo del ensayo fuente. Para cada uno, crea o actualiza un
 * AgregadoEnsayo derivado con trazabilidad (fuenteEnsayoId, esAutoCalculado=true).
 *
 * @param {object} db - Conexión tenant
 * @param {object} ensayoFuente - El ensayo de granulometría recién guardado (con tipo incluido)
 */
const syncEnsayosDerivadosDesdeGranulometria = async (db, ensayoFuente) => {
    try {
        // Obtener el tipo del ensayo fuente
        const tipoFuente = ensayoFuente.tipo
            || await db.AgregadoEnsayoTipo.findByPk(ensayoFuente.idAgregadoEnsayoTipo);
        if (!tipoFuente) return;

        // Solo sincronizar si es un ensayo de granulometría
        const codigoFuente = tipoFuente.codigo;

        // Buscar tipos derivados que apuntan a este código fuente
        // Also check for legacy IRAM1505 source (alias) - derivados may point to either
        const derivadoSourceCodes = [codigoFuente];
        if (codigoFuente === CODIGO_GRANULOMETRIA) {
            derivadoSourceCodes.push(CODIGO_GRANULOMETRIA_LEGACY);
        } else if (codigoFuente === CODIGO_GRANULOMETRIA_LEGACY) {
            derivadoSourceCodes.push(CODIGO_GRANULOMETRIA);
        }

        const tiposDerivados = await db.AgregadoEnsayoTipo.findAll({
            where: {
                esDerivado: true,
                derivadoDeCodigo: { [Op.in]: derivadoSourceCodes },
                isActive: true,
            },
        });
        if (!tiposDerivados.length) return;

        // Extraer calculos de la evaluación
        const evaluacion = ensayoFuente.resultado?.granulometria?.evaluacion;
        const calculos = evaluacion?.calculos || {};

        for (const tipoDerivado of tiposDerivados) {
            const clave = tipoDerivado.derivadoClave; // 'moduloFinura' | 'tmn'
            const calculoData = calculos[clave];

            // Determinar valor del resultado
            let resultadoDerivado = null;
            let cumpleDerivado = 'NO_EVAL';

            if (calculoData && calculoData.valor != null) {
                resultadoDerivado = {
                    valor: calculoData.valor,
                    detalle: calculoData,
                    fuenteEnsayoId: ensayoFuente.idAgregadoEnsayo,
                };
                cumpleDerivado = 'NO_EVAL'; // MF y TMN no tienen criterio cumple/no_cumple propio
            }

            // Calcular fechaVencimiento — vigencia efectiva por tipo (P1.8)
            const fechaVencimiento = calcularFechaVencimiento(
                ensayoFuente.fechaEnsayo,
                getVigenciaEfectivaMeses(tipoDerivado),
                null,
            );

            // Buscar si ya existe un ensayo derivado de esta fuente + tipo
            const existente = await db.AgregadoEnsayo.findOne({
                where: {
                    fuenteEnsayoId: ensayoFuente.idAgregadoEnsayo,
                    idAgregadoEnsayoTipo: tipoDerivado.idAgregadoEnsayoTipo,
                    esAutoCalculado: true,
                    isActive: true,
                },
            });

            if (existente) {
                // Actualizar
                await existente.update({
                    resultado: resultadoDerivado,
                    cumple: cumpleDerivado,
                    fechaEnsayo: ensayoFuente.fechaEnsayo,
                    fechaMuestreo: ensayoFuente.fechaMuestreo,
                    fechaVencimiento,
                });
            } else {
                // Crear
                await db.AgregadoEnsayo.create({
                    legacyAgregadoId: ensayoFuente.legacyAgregadoId,
                    idPlanta: ensayoFuente.idPlanta,
                    idAgregadoEnsayoTipo: tipoDerivado.idAgregadoEnsayoTipo,
                    fechaMuestreo: ensayoFuente.fechaMuestreo,
                    fechaEnsayo: ensayoFuente.fechaEnsayo,
                    laboratorio: ensayoFuente.laboratorio,
                    nroInforme: ensayoFuente.nroInforme,
                    resultado: resultadoDerivado,
                    cumple: cumpleDerivado,
                    observaciones: `Auto-calculado desde granulometría #${ensayoFuente.idAgregadoEnsayo}`,
                    fechaVencimiento,
                    fuenteEnsayoId: ensayoFuente.idAgregadoEnsayo,
                    esAutoCalculado: true,
                });
            }
        }
    } catch (err) {
        console.error('[syncEnsayosDerivados] Error no crítico:', err.message);
    }
};

// ─── AgregadoEnsayoTipo (catálogo) ──────────────────────────

const getTipos = async (db, params = {}) => {
    const where = { isActive: true };

    // Filtro por categoría
    if (params.categoria) {
        where.categoria = params.categoria;
    }

    // Filtro por material (e.g. AGREGADOS, HORMIGON)
    if (params.material) {
        where.material = params.material.toUpperCase();
    }

    // Filtro por perfil (CORE, AVANZADO, ALL)
    if (params.perfil && params.perfil !== 'ALL') {
        where.perfil = params.perfil.toUpperCase();
    }

    // Filtro includeHidden — by default exclude visibleEnUI=false
    if (params.includeHidden !== 'true' && params.includeHidden !== true) {
        // Don't force visibleEnUI filter unless explicitly excluding hidden
        // (we leave it to the caller to decide; keep backward compat)
    }

    // Filtro por aplicaA: selecciona tipos cuyo JSON array contiene el valor
    // Ejemplo: ?aplicaA=FINO → devuelve tipos donde aplicaA contiene "FINO"
    const rows = await db.AgregadoEnsayoTipo.findAll({
        where,
        order: [['orden', 'ASC'], ['nombre', 'ASC']],
    });

    if (params.aplicaA) {
        const filtro = params.aplicaA.toUpperCase();
        return rows.filter((r) => {
            let arr = r.aplicaA;
            if (!arr) return true; // NULL = aplica a todos
            if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (_) { return true; } }
            return Array.isArray(arr) && arr.includes(filtro);
        });
    }

    return rows;
};

const createTipo = async (db, data) => {
    if (!data.codigo || !data.nombre) {
        throw new Error('codigo y nombre son requeridos');
    }

    // Validate unique codigo
    const existing = await db.AgregadoEnsayoTipo.findOne({ where: { codigo: data.codigo } });
    if (existing) {
        throw new Error(`Ya existe un tipo con código '${data.codigo}'`);
    }

    // schemaKey obligatorio (excepto derivados)
    const esDerivado = !!data.esDerivado;
    if (!esDerivado && !data.schemaKey) {
        throw new Error('schemaKey es requerido para tipos no derivados');
    }

    // perfil obligatorio
    const perfil = data.perfil || 'AVANZADO';
    if (!['CORE', 'AVANZADO'].includes(perfil)) {
        throw new Error('perfil debe ser CORE o AVANZADO');
    }

    // derivado constraints
    const visibleEnCards = esDerivado ? false : (data.visibleEnCards !== undefined ? data.visibleEnCards : true);
    const finalPerfil = esDerivado ? 'AVANZADO' : perfil;

    return db.AgregadoEnsayoTipo.create({
        codigo: data.codigo,
        nombre: data.nombre,
        normaRef: data.normaRef ?? null,
        normaId: data.normaId ?? null,
        aplicaA: data.aplicaA ?? ['FINO', 'GRUESO'],
        unidad: data.unidad ?? null,
        periodicidadMeses: data.periodicidadMeses ?? null,
        obligatorio: data.obligatorio ?? false,
        warningDays: data.warningDays ?? null,
        orden: data.orden ?? 0,
        categoria: data.categoria ?? null,
        resultadoSchema: data.resultadoSchema ?? null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        material: data.material || 'AGREGADOS',
        visibleEnUI: data.visibleEnUI !== undefined ? data.visibleEnUI : true,
        visibleEnCards,
        visibleEnDosificacion: data.visibleEnDosificacion !== undefined ? data.visibleEnDosificacion : false,
        schemaKey: esDerivado ? 'DERIVADO' : data.schemaKey,
        perfil: finalPerfil,
        esDerivado,
        derivadoDeCodigo: data.derivadoDeCodigo ?? null,
        derivadoClave: data.derivadoClave ?? null,
    });
};

/** Protected (immutable) fields — set at creation only. */
const PROTECTED_FIELDS = ['codigo', 'schemaKey', 'material', 'esDerivado', 'derivadoDeCodigo', 'derivadoClave', 'normaRef', 'aplicaA', 'categoria'];

const updateTipo = async (db, id, data) => {
    const tipo = await db.AgregadoEnsayoTipo.findByPk(id);
    if (!tipo) throw new Error('AgregadoEnsayoTipo no encontrado');

    // ── Reject protected fields explicitly ──
    const attempted = PROTECTED_FIELDS.filter(f => data[f] !== undefined && data[f] !== tipo[f]);
    if (attempted.length) {
        throw new Error(`No se puede modificar campos protegidos: ${attempted.join(', ')}. Estos valores se definen al crear el tipo.`);
    }
    // Strip them just in case (same value or undefined)
    PROTECTED_FIELDS.forEach(f => delete data[f]);

    // Validate perfil if provided
    if (data.perfil && !['CORE', 'AVANZADO'].includes(data.perfil)) {
        throw new Error('perfil debe ser CORE o AVANZADO');
    }

    // ── aplicaA guard: warn if ensayos exist, require forceAplicaA to proceed ──
    if (data.aplicaA !== undefined) {
        const normalize = (v) => {
            if (Array.isArray(v)) return JSON.stringify([...v].sort());
            if (typeof v === 'string') {
                try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return JSON.stringify([...parsed].sort()); } catch (_) { /* ignore */ }
                return JSON.stringify([v]);
            }
            return 'null';
        };
        if (normalize(data.aplicaA) !== normalize(tipo.aplicaA)) {
            const ensayoCount = await db.AgregadoEnsayo.count({
                where: { idAgregadoEnsayoTipo: id, isActive: true },
            });
            if (ensayoCount > 0 && !data.forceAplicaA) {
                const err = new Error(
                    `Existen ${ensayoCount} ensayo(s) cargados con este tipo. ¿Confirma que desea cambiar 'aplicaA'?`
                );
                err.code = 'APLICA_A_CONFIRM';
                err.ensayoCount = ensayoCount;
                throw err;
            }
        }
        delete data.forceAplicaA;
    }

    // derivado constraints
    if (tipo.esDerivado) {
        data.visibleEnCards = false;
        data.perfil = 'AVANZADO';
    }

    const oldPeriodicidad = tipo.periodicidadMeses;
    const updated = await tipo.update(data);

    // ── Resync fechaVencimiento en ensayos cargados cuando cambia la
    //    vigencia del catálogo. Sin esto, el cambio queda invisible:
    //    `fechaVencimiento` es columna persistida y se calcula solo en
    //    create/updateEnsayo, así que el semáforo (AgregadoEnsayosPage), el
    //    filtro `vigentes=1`, el resumen por agregado y las alertas siguen
    //    leyendo la vigencia anterior. Comparamos contra el viejo valor para
    //    no resincronizar al pedo cuando el usuario solo tocó otro campo.
    if (
        data.periodicidadMeses !== undefined
        && Number(updated.periodicidadMeses ?? -1) !== Number(oldPeriodicidad ?? -1)
    ) {
        const vigenciaEfectiva = getVigenciaEfectivaMeses(updated);
        if (Number.isFinite(vigenciaEfectiva) && vigenciaEfectiva > 0) {
            try {
                await db.sequelize.query(
                    `UPDATE \`AgregadoEnsayo\`
                        SET \`fechaVencimiento\` = DATE_ADD(\`fechaEnsayo\`, INTERVAL :meses MONTH)
                      WHERE \`idAgregadoEnsayoTipo\` = :idTipo
                        AND \`isActive\` = 1
                        AND \`fechaEnsayo\` IS NOT NULL`,
                    { replacements: { meses: vigenciaEfectiva, idTipo: id } },
                );
            } catch (err) {
                console.error('[updateTipo] resync fechaVencimiento falló:', err.message);
            }
        }
    }

    return updated;
};

/**
 * Soft-delete a tipo (isActive=false). If ensayos exist, requires force=true
 * and optionally reassigns them to a different tipo.
 */
const deleteTipo = async (db, id, { force = false, reassignToId = null } = {}) => {
    const tipo = await db.AgregadoEnsayoTipo.findByPk(id);
    if (!tipo) throw new Error('AgregadoEnsayoTipo no encontrado');

    const ensayoCount = await db.AgregadoEnsayo.count({
        where: { idAgregadoEnsayoTipo: id, isActive: true },
    });

    if (ensayoCount > 0 && !force) {
        const err = new Error(
            `Existen ${ensayoCount} ensayo(s) activos con este tipo. Confirme para continuar.`
        );
        err.code = 'DELETE_TIPO_CONFIRM';
        err.ensayoCount = ensayoCount;
        throw err;
    }

    if (ensayoCount > 0 && reassignToId) {
        const target = await db.AgregadoEnsayoTipo.findByPk(reassignToId);
        if (!target || !target.isActive) throw new Error('Tipo destino no encontrado o inactivo');
        await db.AgregadoEnsayo.update(
            { idAgregadoEnsayoTipo: reassignToId },
            { where: { idAgregadoEnsayoTipo: id } },
        );
    }

    await tipo.update({ isActive: false, visibleEnUI: false, visibleEnCards: false });
    return { deleted: true, codigo: tipo.codigo, ensayosReasignados: ensayoCount > 0 && reassignToId ? ensayoCount : 0 };
};

// ─── Templates (plantillas hardcode) ────────────────────────

/**
 * ENSAYOS_AGREGADOS — catálogo completo de ensayos para agregados.
 *
 * Defaults: CORE, 12m periodicidad, 60 días warning, obligatorio,
 *           visibleEnUI, visibleEnCards.
 * Cada usuario puede luego personalizar perfil/obligatorio/periodicidad desde la UI.
 */
const ENSAYOS_AGREGADOS = [
    // ── Física ──
    { codigo: 'IRAM1520_DENSIDAD_ABSORCION_FINO',     nombre: 'Densidad relativa y absorción — Agregado fino',                      schemaKey: 'DENSIDAD_ABSORCION',  normaRef: 'IRAM 1520',   aplicaA: ['FINO'],           categoria: 'fisica',      orden: 1,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'densidadRelativaReal', label: 'Dens. relativa real', labelCorto: 'Dens. relativa real', unidad: '' }, { key: 'densidadRelativaAparenteSeca', label: 'Dens. rel. ap. (seca)', labelCorto: 'Dens. rel. ap. (seca)', unidad: '' }, { key: 'densidadRelativaAparenteSSS', label: 'Dens. rel. ap. (SSS)', labelCorto: 'Dens. rel. ap. (SSS)', unidad: '' }, { key: 'absorcionPct', label: 'Absorción', labelCorto: 'Absorción', unidad: '%' }] },
    { codigo: 'IRAM1533_DENSIDAD_GRUESO',             nombre: 'Densidad, densidad relativa y absorción de agua — Agregado grueso',  schemaKey: 'DENSIDAD_ABSORCION',  normaRef: 'IRAM 1533',   aplicaA: ['GRUESO'],         categoria: 'fisica',      orden: 2,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'densidadRelativaReal', label: 'Dens. relativa real', labelCorto: 'Dens. relativa real', unidad: '' }, { key: 'densidadRelativaAparenteSeca', label: 'Dens. rel. ap. (seca)', labelCorto: 'Dens. rel. ap. (seca)', unidad: '' }, { key: 'densidadRelativaAparenteSSS', label: 'Dens. rel. ap. (SSS)', labelCorto: 'Dens. rel. ap. (SSS)', unidad: '' }, { key: 'absorcionPct', label: 'Absorción', labelCorto: 'Absorción', unidad: '%' }] },
    { codigo: 'IRAM1674_MATERIAL_FINO_200',           nombre: 'Material fino que pasa por tamiz IRAM 75 µm (N.º 200)',              schemaKey: 'PASA_200',            normaRef: 'IRAM 1540',   aplicaA: ['FINO','GRUESO'],  categoria: 'limpieza',    orden: 3,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'pasa200Pct', label: 'Pasa tamiz N.° 200', labelCorto: 'Pasa #200', unidad: '%' }] },
    { codigo: 'IRAM1505_GRANULOMETRIA',               nombre: 'Granulometría',                                                      schemaKey: 'GRANULOMETRIA_1505',  normaRef: 'IRAM 1505',   aplicaA: ['FINO','GRUESO'],  categoria: 'fisica',      orden: 4,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'moduloFinura', label: 'Módulo de finura', labelCorto: 'MF', unidad: '' }, { key: 'tmnMm', label: 'TMN', labelCorto: 'TMN', unidad: 'mm' }] },
    // ── Forma ──
    { codigo: 'IRAM1687_1_LAJOSIDAD',                 nombre: 'Índice de lajosidad',                                                schemaKey: 'LAJOSIDAD',           normaRef: 'IRAM 1687-1', aplicaA: ['GRUESO'],         categoria: 'forma',       orden: 5,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'lajosidadPct', label: 'Índice de lajosidad', labelCorto: 'Lajosidad', unidad: '%' }] },
    { codigo: 'IRAM1687_2_ELONGACION',                nombre: 'Índice de elongación',                                               schemaKey: 'ELONGACION',          normaRef: 'IRAM 1687-2', aplicaA: ['GRUESO'],         categoria: 'forma',       orden: 6,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'elongacionPct', label: 'Índice de elongación', labelCorto: 'Elongación', unidad: '%' }] },
    // ── Mecánica ──
    { codigo: 'IRAM1532_LOS_ANGELES',                 nombre: 'Desgaste Los Ángeles',                                               schemaKey: 'LOS_ANGELES',         normaRef: 'IRAM 1532',   aplicaA: ['GRUESO'],         categoria: 'mecanica',    orden: 7,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'losAngelesPct', label: 'Desgaste Los Ángeles', labelCorto: 'Desgaste LA', unidad: '%' }] },
    // ── Limpieza y química (IRAM 1647 + IRAM 1882) ──
    { codigo: 'IRAM1647_TERRONES_ARCILLA',            nombre: 'Terrones de arcilla y partículas friables',                           schemaKey: 'TERRONES_ARCILLA',    normaRef: 'IRAM 1647',   aplicaA: ['FINO','GRUESO'],  categoria: 'limpieza',    orden: 8,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Terrones de arcilla', labelCorto: 'Terrones', unidad: '%' }] },
    { codigo: 'IRAM1647_SALES_SOLUBLES',              nombre: 'Sales solubles totales',                                              schemaKey: 'SALES_SOLUBLES',      normaRef: 'IRAM 1647',   aplicaA: ['FINO','GRUESO'],  categoria: 'quimica',     orden: 9,  visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Sales solubles totales', labelCorto: 'Sales sol.', unidad: '%' }] },
    { codigo: 'IRAM1647_SULFATOS_SO3',                nombre: 'Sulfatos (expresados como SO₃)',                                      schemaKey: 'SULFATOS_SO3',        normaRef: 'IRAM 1647',   aplicaA: ['FINO','GRUESO'],  categoria: 'quimica',     orden: 10, visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Sulfatos (SO3)', labelCorto: 'Sulfatos', unidad: '%' }] },
    { codigo: 'IRAM1882_CLORUROS_SOLUBLES',           nombre: 'Cloruros solubles',                                                   schemaKey: 'CLORUROS_SOLUBLES',   normaRef: 'IRAM 1882',   aplicaA: ['FINO','GRUESO'],  categoria: 'quimica',     orden: 11, visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Cloruros solubles', labelCorto: 'Cloruros', unidad: '%' }] },
    { codigo: 'IRAM1647_MATERIA_ORGANICA',            nombre: 'Materia orgánica',                                                    schemaKey: 'MATERIA_ORGANICA',    normaRef: 'IRAM 1647',   aplicaA: ['FINO'],           categoria: 'limpieza',    orden: 12, visibleEnCaracterizacion: true,  caractFields: [{ key: 'resultadoColorimetrico', label: 'Materia orgánica', labelCorto: 'Mat. orgánica', unidad: 'ppm' }] },
    { codigo: 'IRAM1647_MATERIAS_CARBONOSAS',         nombre: 'Materias carbonosas',                                                 schemaKey: 'MATERIAS_CARBONOSAS', normaRef: 'IRAM 1647',   aplicaA: ['FINO','GRUESO'],  categoria: 'limpieza',    orden: 13, visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Materias carbonosas', labelCorto: 'Carbonosas', unidad: '%' }] },
    // ── Durabilidad ──
    { codigo: 'IRAM1525_DURABILIDAD_SULFATO',         nombre: 'Durabilidad por ataque con sulfato de sodio',                         schemaKey: 'DURABILIDAD_SULFATO', normaRef: 'IRAM 1525',   aplicaA: ['FINO','GRUESO'],  categoria: 'durabilidad', orden: 14, visibleEnCaracterizacion: true,  caractFields: [{ key: 'perdidaPct', label: 'Pérdida sulfato Na', labelCorto: 'Durabilidad', unidad: '%' }] },
    // ── Física (peso unitario, equivalente arena) ──
    { codigo: 'IRAM1548_PESO_UNITARIO',               nombre: 'Peso unitario suelto y compactado',                                   schemaKey: 'PESO_UNITARIO',       normaRef: 'IRAM 1548',   aplicaA: ['FINO','GRUESO'],  categoria: 'fisica',      orden: 15, visibleEnCaracterizacion: true,  caractFields: [{ key: 'puc', label: 'PUC', labelCorto: 'PUC', unidad: 'kg/m³' }, { key: 'pus', label: 'PUS', labelCorto: 'PUS', unidad: 'kg/m³' }] },
    { codigo: 'IRAM1682_EQUIVALENTE_ARENA',            nombre: 'Equivalente de arena',                                                schemaKey: 'EQ_ARENA',            normaRef: 'IRAM 1682',   aplicaA: ['FINO'],           categoria: 'limpieza',    orden: 16, visibleEnCaracterizacion: true,  caractFields: [{ key: 'equivalenteArenaPct', label: 'Equivalente de arena', labelCorto: 'Eq. arena', unidad: '%' }] },
    // ── Limpieza complementaria (solo grueso) ──
    { codigo: 'IRAM1883_POLVO_ADHERIDO',              nombre: 'Polvo adherido',                                                      schemaKey: 'POLVO_ADHERIDO',      normaRef: 'IRAM 1883',   aplicaA: ['GRUESO'],         categoria: 'limpieza',    orden: 17, visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Polvo adherido', labelCorto: 'Polvo adh.', unidad: '%' }] },
    { codigo: 'IRAM1644_PARTICULAS_BLANDAS',           nombre: 'Partículas blandas',                                                  schemaKey: 'PARTICULAS_BLANDAS',  normaRef: 'IRAM 1644',   aplicaA: ['GRUESO'],         categoria: 'limpieza',    orden: 18, visibleEnCaracterizacion: true,  caractFields: [{ key: 'valor', label: 'Partículas blandas', labelCorto: 'Part. blandas', unidad: '%' }] },
    {
        codigo: 'IRAM1519_ESTABILIDAD_BASALTICAS',
        nombre: 'Estabilidad de rocas basálticas (etilenglicol)',
        schemaKey: 'ESTABILIDAD_BASALTICAS',
        normaRef: 'IRAM 1519',
        aplicaA: ['FINO', 'GRUESO'],
        categoria: 'durabilidad',
        obligatorio: true,
        periodicidadMeses: 12,
        warningDias: 60,
        visibleEnCards: true,
        visibleEnUI: true,
        perfil: 'CORE',
        orden: 19,
    },
    {
        codigo: 'IRAM1649_EXAMEN_PETROGRAFICO',
        nombre: 'Examen petrográfico',
        schemaKey: 'EXAMEN_PETROGRAFICO',
        normaRef: 'IRAM 1649',
        aplicaA: ['FINO', 'GRUESO'],
        categoria: 'quimica',
        perfil: 'AVANZADO',
        obligatorio: false,
        periodicidadMeses: 24,
        warningDias: 60,
        visibleEnCards: true,
        visibleEnUI: true,
        orden: 20,
    },
    // IRAM 1674 (RAS acelerado) removido — es ensayo de mortero (agregado + cemento), no del agregado individual.
    // Se implementará en el módulo de dosificaciones.
];

/** Default values applied to every ensayo created by the template. */
const ENSAYO_DEFAULTS = {
    perfil: 'CORE',
    obligatorio: true,
    periodicidadMeses: 12,
    warningDays: 60,
    visibleEnUI: true,
    visibleEnCards: true,
    visibleEnDosificacion: false,
    isActive: true,
};

/* ═══════════════════════════════════════════════════════════
   Ensayos de AGUA — IRAM 1601:2012
   ═══════════════════════════════════════════════════════════ */
const ENSAYOS_AGUA = [
    { codigo: 'IRAM1601_ANALISIS_QUIMICO',  nombre: 'Análisis químico',                  schemaKey: 'AGUA_ANALISIS_QUIMICO',  normaRef: 'IRAM 1601', categoria: 'quimica', orden: 1 },
];

const TEMPLATES = {
    CORE_AGREGADOS: { material: 'AGREGADOS', items: ENSAYOS_AGREGADOS },
    CORE_AGUA:      { material: 'AGUA',      items: ENSAYOS_AGUA },
};

/**
 * Crear ensayos.
 *
 * Solo CREA los que faltan (por codigo). NO modifica los que ya existen,
 * para respetar la configuración personalizada del usuario.
 *
 * Returns: { created, skipped }
 */
const applyTemplate = async (db, { material, template }) => {
    const tpl = TEMPLATES[template];
    if (!tpl) throw new Error(`Plantilla "${template}" no encontrada`);
    if (tpl.material !== material) throw new Error(`Plantilla "${template}" no es para material "${material}"`);

    const items = tpl.items;
    let created = 0, skipped = 0;
    const createdCodes = [];

    for (const entry of items) {
        const existing = await db.AgregadoEnsayoTipo.findOne({ where: { codigo: entry.codigo } });
        if (existing && existing.isActive) {
            // Normalizar defaults si están desalineados (nombre, aplicaA, categoria, orden, schemaKey)
            const fieldsToSync = { nombre: entry.nombre, aplicaA: entry.aplicaA, categoria: entry.categoria, orden: entry.orden, normaRef: entry.normaRef, schemaKey: entry.schemaKey, visibleEnCaracterizacion: entry.visibleEnCaracterizacion ?? false, caractFields: entry.caractFields ?? null };
            const changes = {};
            for (const [k, v] of Object.entries(fieldsToSync)) {
                if (v !== undefined && JSON.stringify(existing[k]) !== JSON.stringify(v)) {
                    changes[k] = v;
                }
            }
            if (Object.keys(changes).length > 0) {
                await existing.update(changes);
            }
            skipped++;
        } else if (existing && !existing.isActive) {
            // Reactivar ensayo que fue eliminado (soft-delete)
            // P1.8: defaults primero, entry overrides; vigencia desde registry si entry no la define
            await existing.update({
                ...ENSAYO_DEFAULTS,
                periodicidadMeses: getVigenciaRecomendadaMeses(entry.codigo, ENSAYO_DEFAULTS.periodicidadMeses),
                ...entry,
                material,
            });
            created++;
            createdCodes.push(entry.codigo);
        } else {
            // P1.8: defaults primero, entry overrides (antes era al revés y entry no podía
            // sobreescribir periodicidadMeses, perfil, obligatorio, etc.)
            await db.AgregadoEnsayoTipo.create({
                ...ENSAYO_DEFAULTS,
                periodicidadMeses: getVigenciaRecomendadaMeses(entry.codigo, ENSAYO_DEFAULTS.periodicidadMeses),
                ...entry,
                material,
            });
            created++;
            createdCodes.push(entry.codigo);
        }
    }

    return { created, skipped, createdCodes, total: items.length };
};

// ─── AgregadoEnsayo ─────────────────────────────────────────

// ─── Ensayo counts per tipo ─────────────────────────────────

/**
 * Returns a map { idAgregadoEnsayoTipo → { total, activos } } with ensayo counts.
 */
const getEnsayoCountsByTipo = async (db) => {
    const rows = await db.AgregadoEnsayo.findAll({
        attributes: [
            'idAgregadoEnsayoTipo',
            [db.sequelize.fn('COUNT', db.sequelize.col('idAgregadoEnsayo')), 'total'],
            [db.sequelize.fn('SUM', db.sequelize.literal('CASE WHEN isActive = 1 THEN 1 ELSE 0 END')), 'activos'],
        ],
        group: ['idAgregadoEnsayoTipo'],
        raw: true,
    });
    const map = {};
    for (const r of rows) {
        map[r.idAgregadoEnsayoTipo] = {
            total: Number(r.total) || 0,
            activos: Number(r.activos) || 0,
        };
    }
    return map;
};

/**
 * Returns ensayos for a specific tipo. Useful for browsing / understanding
 * which ensayos block editing.
 */
const getEnsayosByTipo = async (db, idTipo, { includeInactive = false } = {}) => {
    const where = { idAgregadoEnsayoTipo: idTipo };
    if (!includeInactive) {
        where.isActive = true;
    }
    return db.AgregadoEnsayo.findAll({
        where,
        attributes: [
            'idAgregadoEnsayo', 'legacyAgregadoId', 'idPlanta',
            'fechaMuestreo', 'fechaEnsayo', 'laboratorio', 'nroInforme',
            'cumple', 'fechaVencimiento', 'esAutoCalculado', 'isActive',
        ],
        order: [['fechaEnsayo', 'DESC']],
        limit: 200,
    });
};

// ─── Query helpers ──────────────────────────────────────────

const buildWhere = (params = {}) => {
    const where = { isActive: true };

    if (params.legacyAgregadoId) {
        where.legacyAgregadoId = params.legacyAgregadoId;
    }
    if (params.idPlanta) {
        where.idPlanta = params.idPlanta;
    }
    if (params.idAgregadoEnsayoTipo) {
        where.idAgregadoEnsayoTipo = params.idAgregadoEnsayoTipo;
    }
    if (params.cumple) {
        where.cumple = params.cumple;
    }

    // vigentes=1 → sólo ensayos no vencidos (fechaVencimiento NULL o >= hoy)
    if (params.vigentes === '1' || params.vigentes === 1 || params.vigentes === true) {
        const hoy = new Date().toISOString().slice(0, 10);
        where[Op.or] = [
            { fechaVencimiento: null },
            { fechaVencimiento: { [Op.gte]: hoy } },
        ];
    }

    return where;
};

const getEnsayos = async (db, params = {}) => {
    return db.AgregadoEnsayo.findAll({
        where: buildWhere(params),
        include: [
            { model: db.AgregadoEnsayoTipo, as: 'tipo' },
            { model: db.AgregadoEnsayoArchivo, as: 'archivos' },
        ],
        order: [['fechaEnsayo', 'DESC']],
    });
};

/**
 * Devuelve un Map<legacyAgregadoId, { ensayosVencidos, ensayosProximos, proximoVencimiento, peorEstado }>
 * para una lista de agregados, basándose en `fechaVencimiento` de sus ensayos activos.
 *
 * Estados (de mejor a peor): 'ok' > 'proximo' (≤30d) > 'critico' (≤7d) > 'vencido'.
 * Útil para mostrar un badge resumen en listados de agregados (P1.8 plumbing).
 */
const getVigenciaResumenPorAgregado = async (db, agregadoIds = []) => {
    const ids = (agregadoIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    const resumen = new Map();
    for (const id of ids) {
        resumen.set(id, {
            ensayosVencidos: 0,
            ensayosProximos: 0,
            proximoVencimiento: null,
            peorEstado: 'ok',
        });
    }
    if (ids.length === 0) return resumen;

    const ensayos = await db.AgregadoEnsayo.findAll({
        where: {
            legacyAgregadoId: { [Op.in]: ids },
            isActive: true,
            fechaVencimiento: { [Op.ne]: null },
        },
        attributes: ['legacyAgregadoId', 'fechaVencimiento'],
        raw: true,
    });

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const peor = (a, b) => {
        // Orden: vencido > critico > proximo > ok
        const rank = { ok: 0, proximo: 1, critico: 2, vencido: 3 };
        return rank[b] > rank[a] ? b : a;
    };

    for (const ens of ensayos) {
        const id = ens.legacyAgregadoId;
        const r = resumen.get(id);
        if (!r) continue;
        const fv = new Date(ens.fechaVencimiento);
        if (isNaN(fv.getTime())) continue;
        const dias = Math.round((fv - hoy) / 86400000);
        let estadoEns = 'ok';
        if (dias < 0)        { estadoEns = 'vencido';  r.ensayosVencidos++; }
        else if (dias <= 7)  { estadoEns = 'critico';  r.ensayosProximos++; }
        else if (dias <= 30) { estadoEns = 'proximo';  r.ensayosProximos++; }
        r.peorEstado = peor(r.peorEstado, estadoEns);
        if (r.proximoVencimiento == null || fv < new Date(r.proximoVencimiento)) {
            r.proximoVencimiento = ens.fechaVencimiento;
        }
    }
    return resumen;
};

const getEnsayo = async (db, id) => {
    const ensayo = await db.AgregadoEnsayo.findByPk(id, {
        include: [
            { model: db.AgregadoEnsayoTipo, as: 'tipo' },
            { model: db.AgregadoEnsayoArchivo, as: 'archivos' },
        ],
    });
    if (!ensayo) throw new Error('AgregadoEnsayo no encontrado');

    // Auto-evaluate granulometry if missing evaluacionAuto (for ensayos saved before auto-eval existed)
    // Also re-check cumple consistency for granulometry ensayos
    let r = ensayo.resultado;
    if (typeof r === 'string') { try { r = JSON.parse(r); ensayo.resultado = r; } catch {} }
    const ctxGet = ensayo.contextoAplicacion || await resolverContextoAplicacion(db, { idAgregado: ensayo.legacyAgregadoId });
    const ejecutarEvalHormigonGet = contextoGatillaEvalHormigon(ctxGet);
    if (r?.granulometria?.tamices?.length && ejecutarEvalHormigonGet) {
        const tipoAg = r.granulometria.tipoAgregado || ensayo.tipo?.aplicaA?.[0] || null;
        let needsSave = false;
        if (tipoAg?.toUpperCase() === 'FINO' && !r.granulometria.evaluacionAuto) {
            try {
                autoEvaluarGranulometriaFino(r);
                if (r.granulometria.evaluacionAuto) needsSave = true;
            } catch (e) { /* ignore */ }
        }
        if (tipoAg?.toUpperCase() === 'GRUESO' && !r.granulometria.evaluacionAutoGrueso) {
            try {
                autoEvaluarGranulometriaGrueso(r);
                if (r.granulometria.evaluacionAutoGrueso) needsSave = true;
            } catch (e) { /* ignore */ }
        }

        // Re-evaluate cumple using latest evaluator logic (catches fixes to evaluator)
        try {
            const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
            // C6 (auditoría 01-calidad sesión 2026-05-07): pasar `subtipoMaterial`
            // al evaluador para que IRAM 1674 AG resuelva 1,0% (grava) vs 1,5%
            // (piedra partida) por subtipo en vez de heurística IP.
            let subtipoMaterial = null;
            if (ensayo.legacyAgregadoId && db.AgregadoMeta) {
                try {
                    const meta = await db.AgregadoMeta.findOne({
                        where: { legacyAgregadoId: ensayo.legacyAgregadoId },
                        attributes: ['subtipoMaterial'], raw: true,
                    });
                    subtipoMaterial = meta?.subtipoMaterial || null;
                } catch { /* non-blocking */ }
            }
            const evalResult = evaluarEnsayo(ensayo.tipo?.codigo, r, { tipoAgregado: tipoAg, subtipoMaterial });
            if (evalResult?.cumple && evalResult.cumple !== ensayo.cumple) {
                ensayo.cumple = evalResult.cumple;
                // C6: persistir compliance canónico junto al shape legacy.
                r._evaluacion = {
                    estado: evalResult.estado,
                    mensaje: evalResult.mensaje,
                    informativo: evalResult.informativo,
                    alerta: evalResult.alerta,
                    compliance: evalResult.compliance || null,
                };
                needsSave = true;
            }
        } catch { /* ignore */ }

        if (needsSave) {
            ensayo.resultado = r;
            try { await ensayo.update({ resultado: r, cumple: ensayo.cumple }); } catch {}
        }
    }

    return ensayo;
};

/**
 * Devuelve el último ensayo vigente por cada tipo para un agregado dado.
 * Útil para panel de estado de un agregado.
 */
const getUltimoPorTipo = async (db, legacyAgregadoId) => {
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: { legacyAgregadoId, isActive: true },
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
        order: [['fechaEnsayo', 'DESC']],
    });

    // Agrupar: quedarnos solo con el más reciente por idAgregadoEnsayoTipo
    const map = {};
    for (const e of ensayos) {
        if (!map[e.idAgregadoEnsayoTipo]) {
            map[e.idAgregadoEnsayoTipo] = e;
        }
    }
    return Object.values(map);
};

const createEnsayo = async (db, data) => {
    // Validaciones
    if (!data.legacyAgregadoId || !Number.isInteger(Number(data.legacyAgregadoId)) || Number(data.legacyAgregadoId) <= 0) {
        throw new Error('legacyAgregadoId debe ser un entero > 0');
    }
    if (!data.idAgregadoEnsayoTipo) {
        throw new Error('idAgregadoEnsayoTipo es requerido');
    }
    if (!data.fechaEnsayo) {
        throw new Error('fechaEnsayo es requerida');
    }

    // Buscar tipo para calcular fechaVencimiento
    const tipo = await db.AgregadoEnsayoTipo.findByPk(data.idAgregadoEnsayoTipo);
    if (!tipo) throw new Error('AgregadoEnsayoTipo no encontrado');

    // Bloquear creación manual de ensayos derivados
    if (tipo.esDerivado) {
        throw new Error('No se puede crear manualmente un ensayo de tipo derivado. Se genera automáticamente desde la granulometría fuente.');
    }

    // P1.8: vigencia efectiva por tipo (registry como fallback si tipo no la define)
    const fechaVencimiento = calcularFechaVencimiento(
        data.fechaEnsayo,
        getVigenciaEfectivaMeses(tipo),
        data.fechaVencimiento,
    );

    // ── Validar y normalizar resultado via registry ──
    let resultado = data.resultado ?? null;
    let cumpleValue = data.cumple ?? 'NO_EVAL';

    if (resultado != null) {
        const validation = validateAndNormalizeResultado(tipo.codigo, resultado);
        if (!validation.ok) {
            throw new Error(`Resultado inválido: ${validation.errors.join('; ')}`);
        }
        resultado = validation.normalized;
        // Store validation warnings
        if (validation.warnings.length > 0) {
            resultado._warnings = [
                ...(resultado._warnings || []),
                ...validation.warnings,
            ];
        }
    }

    // Evaluar granulometría si corresponde
    if (resultado?.granulometria?.idCurvaObjetivo) {
        const evalOut = await evaluarGranulometriaEnResultado(db, resultado, data.cumple);
        resultado = evalOut.resultado;
        if (evalOut.cumple) cumpleValue = evalOut.cumple;
    }

    // ── Auto-evaluación granulometría fino (dual A-B / A-C) ──
    // Gate por contextoAplicacion: HORMIGON/AMBOS corren eval hormigón; TBS skipea.
    const ctxCreate = await resolverContextoAplicacion(db, {
        idAgregado: data.legacyAgregadoId,
        contextoExplicito: data.contextoAplicacion,
    });
    const ejecutarEvalHormigonCreate = contextoGatillaEvalHormigon(ctxCreate);
    if (resultado?.granulometria?.tamices?.length > 0 && ejecutarEvalHormigonCreate) {
        const tipoAg = resultado.granulometria.tipoAgregado || data.tipoAgregado || null;
        if (!tipoAg || tipoAg.toUpperCase() === 'FINO') {
            autoEvaluarGranulometriaFino(resultado);
            // Set cumple from dual eval: NO_CUMPLE if both bands fail
            const ea = resultado.granulometria.evaluacionAuto;
            if (ea) {
                const rg = ea.resultadoGlobal;
                if (rg.bandaAB === 'cumple' && rg.mf === 'cumple' && rg.fraccion === 'cumple') {
                    cumpleValue = 'CUMPLE';
                } else if (rg.bandaAB !== 'cumple' && rg.bandaAC !== 'cumple') {
                    cumpleValue = 'NO_CUMPLE';
                } else {
                    cumpleValue = 'NO_CUMPLE'; // partial compliance
                }
            }
        }
        if (tipoAg && tipoAg.toUpperCase() === 'GRUESO') {
            autoEvaluarGranulometriaGrueso(resultado);
            const resolved = resolverCumpleGrueso(resultado);
            if (resolved) cumpleValue = resolved;
        }
        // C10: invocar evaluador IRAM1505_GRANULOMETRIA para extraer su
        // `compliance` canónico (passWithObservations cuando banda fuera) y
        // persistirlo en _evaluacion. Antes el evaluador estaba bypassed
        // porque cumpleValue se decidía aquí y el auto-eval block más abajo
        // solo corre si cumpleValue === 'NO_EVAL'. Ahora granulometría tiene
        // su compliance canónico igual que el resto de los ensayos. El cambio
        // observable: el dispatcher lee compliance.status === 'passWithObservations'
        // y NO emite ENSAYO_NO_CUMPLE para banda fails (Nivel 1 informativo).
        try {
            const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
            const evalResult = evaluarEnsayo(tipo.codigo, resultado, { tipoAgregado: tipoAg || data.tipoAgregado || null });
            if (evalResult?.compliance) {
                resultado._evaluacion = {
                    estado: evalResult.estado,
                    mensaje: evalResult.mensaje,
                    informativo: evalResult.informativo,
                    alerta: evalResult.alerta,
                    compliance: evalResult.compliance,
                };
            }
        } catch (e) { console.warn('[createEnsayo:granulometria] eval canónico falló:', e.message); }
    } else if (resultado?.granulometria?.tamices?.length > 0 && ctxCreate === 'TBS') {
        // Contexto TBS: no se evalúa contra normas de hormigón.
        resultado._evaluacionContexto = { contexto: 'TBS', mensaje: MSG_SKIP_TBS };
        cumpleValue = 'NO_EVAL';
    }

    // ── Evaluación TBS contra huso DNV de referencia (opcional) ──
    if (resultado?.granulometria?.tamices?.length > 0
        && (ctxCreate === 'TBS' || ctxCreate === 'AMBOS')
        && data.idHusoDnvReferencia) {
        const cumpleHuso = await evaluarContraHusoReferencia(db, {
            resultado,
            idHusoDnvReferencia: data.idHusoDnvReferencia,
        });
        if (cumpleHuso) {
            // TBS pisa el NO_EVAL; AMBOS solo lo pisa si hormigón aún no tomó decisión.
            if (ctxCreate === 'TBS' || cumpleValue === 'NO_EVAL') {
                cumpleValue = cumpleHuso;
            }
        }
    }

    // ── Auto-evaluación contra parámetros normativos ──
    if (resultado && cumpleValue === 'NO_EVAL' && ejecutarEvalHormigonCreate) {
        const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
        // C11: cierre D18 — cuando tipo.aplicaA es ambiguo (['FINO','GRUESO']),
        // resolvemos tipoAg desde AgregadoMeta.subtipoMaterial. Antes el
        // motor defaulteaba al path AG y producía fail falsos para AF
        // (ej: pasante200=2% en arena → "supera 1.5%" cuando el límite real
        // FINO es 3.0/5.0%). Closes D18.
        let tipoAg = null;
        // C6 (auditoría 01-calidad sesión 2026-05-07): además de resolver
        // tipoAg, capturamos `subtipoMaterial` para pasarlo al evaluador
        // (IRAM 1674 AG necesita el subtipo para distinguir 1,0% grava vs 1,5%
        // piedra partida).
        let subtipoMaterial = null;
        if (tipo.aplicaA) {
            const arr = typeof tipo.aplicaA === 'string' ? JSON.parse(tipo.aplicaA) : tipo.aplicaA;
            if (arr.length === 1) tipoAg = arr[0];
        }
        if (data.legacyAgregadoId && db.AgregadoMeta) {
            try {
                const meta = await db.AgregadoMeta.findOne({
                    where: { legacyAgregadoId: data.legacyAgregadoId },
                    attributes: ['subtipoMaterial'], raw: true,
                });
                subtipoMaterial = meta?.subtipoMaterial || null;
                if (!tipoAg && subtipoMaterial) {
                    const subtipo = subtipoMaterial.toUpperCase();
                    const FINO_SUBTIPOS = new Set(['ARENA_NATURAL', 'ARENA_TRITURACION', 'MEZCLA']);
                    if (FINO_SUBTIPOS.has(subtipo)) tipoAg = 'FINO';
                    else tipoAg = 'GRUESO';
                }
            } catch { /* non-blocking */ }
        }
        console.log(`[createEnsayo] auto-eval: codigo=${tipo.codigo} tipoAg=${tipoAg} resultado keys=${Object.keys(resultado).filter(k=>!k.startsWith('_')).join(',')}`);
        const evalResult = evaluarEnsayo(tipo.codigo, resultado, { tipoAgregado: tipoAg || data.tipoAgregado || null, subtipoMaterial });
        console.log(`[createEnsayo] auto-eval result: cumple=${evalResult.cumple} estado=${evalResult.estado} msg=${evalResult.mensaje}`);
        if (evalResult.cumple && evalResult.cumple !== 'NO_EVAL') {
            cumpleValue = evalResult.cumple;
        }
        // C6: persistir compliance canónico (status + severity + conditions[]
        // + detection_limit + measured/limit/norm) junto al shape legacy. El
        // dispatcher de alertas (alertarResultadoFueraDeEspec) prefiere el
        // canónico sobre la derivación desde `estado`, lo que activa los
        // disparadores APTITUD_CONDICIONADA y ENSAYO_INCONCLUYENTE para los
        // evaluadores refactoreados en C4. Cierra D14 del lado del motor de
        // ensayos (queda C7 para cerrar el lado del motor de aptitud).
        resultado._evaluacion = {
            estado: evalResult.estado,
            mensaje: evalResult.mensaje,
            informativo: evalResult.informativo,
            alerta: evalResult.alerta,
            compliance: evalResult.compliance || null,
        };
    }

    const ensayo = await db.AgregadoEnsayo.create({
        legacyAgregadoId: data.legacyAgregadoId,
        idPlanta: data.idPlanta ?? null,
        idAgregadoEnsayoTipo: data.idAgregadoEnsayoTipo,
        fechaMuestreo: data.fechaMuestreo ?? null,
        fechaEnsayo: data.fechaEnsayo,
        laboratorio: data.laboratorio ?? null,
        nroInforme: data.nroInforme ?? null,
        resultado,
        cumple: cumpleValue,
        observaciones: data.observaciones ?? null,
        fechaVencimiento,
        contextoAplicacion: ctxCreate,
        idHusoDnvReferencia: data.idHusoDnvReferencia ?? null,
    });

    // Sync derived ensayos (MF, TMN) si es granulometría
    const savedEnsayo = await getEnsayo(db, ensayo.idAgregadoEnsayo);
    await syncEnsayosDerivadosDesdeGranulometria(db, savedEnsayo);

    // ── Verificación de clasificación IRAM 1569 ──
    try {
        await _verificarClasificacionIRAM1569(db, ensayo, tipo);
    } catch (e) { /* non-critical */ }

    // ── Generate alerts for dosifications and mezclas using this material ──
    try {
        const { generarAlertasPorCambioMaterial, generarAlertasMezclaPorCambioMaterial } = require('./alertasMaterialService');
        const agName = savedEnsayo.tipo?.nombre || tipo?.nombre || '';
        // Get aggregate name
        let matName = '';
        try {
          const ag = await db.Agregado.findByPk(data.legacyAgregadoId, { raw: true });
          matName = ag?.nombre || '';
        } catch {}
        await generarAlertasPorCambioMaterial(db, data.legacyAgregadoId, tipo.codigo, agName, matName);
        await generarAlertasMezclaPorCambioMaterial(db, data.legacyAgregadoId, tipo.codigo, matName);
    } catch (e) { /* non-critical */ }

    // ── Generate quality alert from compliance result (Prompt 1, Commit 6) ──
    // El dispatcher decide qué tipo y nivel de alerta corresponde según el
    // ComplianceResult canónico. Estados que no requieren alerta (pass,
    // passWithObservations, informative, notApplicable, notEvaluated) son
    // no-ops adentro del dispatcher.
    //
    // NOTA: el filtro `cumpleValue === 'NO_CUMPLE'` original se eliminó
    // a propósito — ahora el dispatcher es responsable de decidir cuándo
    // emitir alerta. Si el motor devuelve `condicional + condiciones[]` o
    // `NO_CONCLUYENTE`, el dispatcher dispara los nuevos tipos de alerta
    // (APTITUD_CONDICIONADA, ENSAYO_INCONCLUYENTE) que antes no se generaban.
    try {
        if (db.AlertaCalidad) {
            const { alertarResultadoFueraDeEspec } = require('./alertaCalidadService');
            const ag = await db.Agregado.findByPk(data.legacyAgregadoId, { raw: true });
            await alertarResultadoFueraDeEspec(
                db,
                { ...savedEnsayo.get({ plain: true }), tipo },
                resultado._evaluacion || {},
                ag,
                // exigibilidad explícita queda en undefined hasta Prompt 2.
                // Mientras tanto, los disparadores de inconclusive, expired y
                // pending quedan dormidos por default — política conservadora.
                {}
            );
        }
    } catch { /* non-blocking */ }

    // PR — Sincronizar AgregadoMeta.evaluacionRas si el ensayo cargado es
    // de tipo RAS (petrográfico, mortero acelerado, prismas hormigón).
    try {
        const { recomputarRasParaAgregado, esCodigoRas } = require('./rasMetaSyncService');
        if (esCodigoRas(tipo?.codigo) && data.legacyAgregadoId) {
            await recomputarRasParaAgregado(db, data.legacyAgregadoId);
        }
    } catch (e) {
        console.warn('[createEnsayo] sync RAS falló (non-blocking):', e.message);
    }

    return savedEnsayo;
};

const updateEnsayo = async (db, id, data) => {
    const ensayo = await db.AgregadoEnsayo.findByPk(id);
    if (!ensayo) throw new Error('AgregadoEnsayo no encontrado');

    // Bloquear edición manual de ensayos auto-calculados
    if (ensayo.esAutoCalculado) {
        throw new Error('No se puede editar manualmente un ensayo auto-calculado. Se actualiza automáticamente desde la granulometría fuente.');
    }

    // Si cambia fechaEnsayo o tipo, recalcular vencimiento (si no viene explícito)
    let fechaVencimiento = data.fechaVencimiento;
    const tipoId = data.idAgregadoEnsayoTipo || ensayo.idAgregadoEnsayoTipo;
    const tipo = await db.AgregadoEnsayoTipo.findByPk(tipoId);
    if (fechaVencimiento === undefined) {
        const fechaEnsayo = data.fechaEnsayo || ensayo.fechaEnsayo;
        // P1.8: vigencia efectiva por tipo
        fechaVencimiento = calcularFechaVencimiento(fechaEnsayo, getVigenciaEfectivaMeses(tipo), null);
    }

    // ── Validar y normalizar resultado via registry ──
    let resultado = data.resultado !== undefined ? data.resultado : ensayo.resultado;
    let cumpleValue = data.cumple !== undefined ? data.cumple : ensayo.cumple;

    if (resultado != null && data.resultado !== undefined && tipo) {
        const validation = validateAndNormalizeResultado(tipo.codigo, resultado);
        if (!validation.ok) {
            throw new Error(`Resultado inválido: ${validation.errors.join('; ')}`);
        }
        resultado = validation.normalized;
        if (validation.warnings.length > 0) {
            resultado._warnings = [
                ...(resultado._warnings || []),
                ...validation.warnings,
            ];
        }
    }

    // Evaluar granulometría si corresponde
    if (resultado?.granulometria?.idCurvaObjetivo) {
        const evalOut = await evaluarGranulometriaEnResultado(db, resultado, data.cumple);
        resultado = evalOut.resultado;
        if (evalOut.cumple) cumpleValue = evalOut.cumple;
    }

    // ── Auto-evaluación granulometría fino (dual A-B / A-C) ──
    // Gate por contextoAplicacion: HORMIGON/AMBOS corren eval hormigón; TBS skipea.
    const ctxUpdate = await resolverContextoAplicacion(db, {
        idAgregado: data.legacyAgregadoId ?? ensayo.legacyAgregadoId,
        contextoExplicito: data.contextoAplicacion ?? ensayo.contextoAplicacion,
    });
    const ejecutarEvalHormigonUpdate = contextoGatillaEvalHormigon(ctxUpdate);
    if (resultado?.granulometria?.tamices?.length > 0 && ejecutarEvalHormigonUpdate) {
        const tipoAg = resultado.granulometria.tipoAgregado || data.tipoAgregado || null;
        if (!tipoAg || tipoAg.toUpperCase() === 'FINO') {
            autoEvaluarGranulometriaFino(resultado);
            const ea = resultado.granulometria.evaluacionAuto;
            if (ea) {
                const rg = ea.resultadoGlobal;
                if (rg.bandaAB === 'cumple' && rg.mf === 'cumple' && rg.fraccion === 'cumple') {
                    cumpleValue = 'CUMPLE';
                } else {
                    cumpleValue = 'NO_CUMPLE';
                }
            }
        }
        if (tipoAg && tipoAg.toUpperCase() === 'GRUESO') {
            autoEvaluarGranulometriaGrueso(resultado);
            const resolved = resolverCumpleGrueso(resultado);
            if (resolved) cumpleValue = resolved;
        }
    } else if (resultado?.granulometria?.tamices?.length > 0 && ctxUpdate === 'TBS') {
        resultado._evaluacionContexto = { contexto: 'TBS', mensaje: MSG_SKIP_TBS };
        cumpleValue = 'NO_EVAL';
    }

    // ── Evaluación TBS contra huso DNV de referencia (opcional) ──
    const idHusoRefUpdate = data.idHusoDnvReferencia !== undefined
        ? data.idHusoDnvReferencia
        : ensayo.idHusoDnvReferencia;
    if (resultado?.granulometria?.tamices?.length > 0
        && (ctxUpdate === 'TBS' || ctxUpdate === 'AMBOS')
        && idHusoRefUpdate) {
        const cumpleHuso = await evaluarContraHusoReferencia(db, {
            resultado,
            idHusoDnvReferencia: idHusoRefUpdate,
        });
        if (cumpleHuso) {
            if (ctxUpdate === 'TBS' || cumpleValue === 'NO_EVAL') {
                cumpleValue = cumpleHuso;
            }
        }
    } else if (resultado?._evaluacionHuso && !idHusoRefUpdate) {
        // Se desasoció el huso de referencia: limpiar evaluación previa.
        delete resultado._evaluacionHuso;
    }

    // ── Auto-evaluación contra parámetros normativos ──
    // Skip for granulometria — already evaluated by granulometriaEvalService above
    // Skip para contexto TBS — no aplican los límites de hormigón.
    const isGranulometria = (tipo.codigo || '').includes('GRANULOMETRIA') || (tipo.codigo || '').includes('1505');
    if (resultado && tipo && !isGranulometria && ejecutarEvalHormigonUpdate && (cumpleValue === 'NO_EVAL' || data.resultado !== undefined)) {
        const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
        let tipoAg = null;
        if (tipo.aplicaA) {
            const arr = typeof tipo.aplicaA === 'string' ? JSON.parse(tipo.aplicaA) : tipo.aplicaA;
            if (arr.length === 1) tipoAg = arr[0];
        }
        // C6 (auditoría 01-calidad sesión 2026-05-07): pasar `subtipoMaterial`
        // al evaluador (IRAM 1674 AG lo usa para resolver 1,0% vs 1,5%).
        let subtipoMaterial = null;
        const legacyId = data.legacyAgregadoId || ensayo?.legacyAgregadoId;
        if (legacyId && db.AgregadoMeta) {
            try {
                const meta = await db.AgregadoMeta.findOne({
                    where: { legacyAgregadoId: legacyId },
                    attributes: ['subtipoMaterial'], raw: true,
                });
                subtipoMaterial = meta?.subtipoMaterial || null;
            } catch { /* non-blocking */ }
        }
        const evalResult = evaluarEnsayo(tipo.codigo, resultado, { tipoAgregado: tipoAg || data.tipoAgregado || null, subtipoMaterial });
        if (evalResult.cumple && evalResult.cumple !== 'NO_EVAL') {
            cumpleValue = evalResult.cumple;
        }
        // C6: persistir compliance canónico junto al shape legacy (mismo
        // criterio que createEnsayo).
        resultado._evaluacion = {
            estado: evalResult.estado,
            mensaje: evalResult.mensaje,
            informativo: evalResult.informativo,
            alerta: evalResult.alerta,
            compliance: evalResult.compliance || null,
        };
    }

    await ensayo.update({
        legacyAgregadoId: data.legacyAgregadoId !== undefined ? data.legacyAgregadoId : ensayo.legacyAgregadoId,
        idPlanta: data.idPlanta !== undefined ? data.idPlanta : ensayo.idPlanta,
        idAgregadoEnsayoTipo: data.idAgregadoEnsayoTipo !== undefined ? data.idAgregadoEnsayoTipo : ensayo.idAgregadoEnsayoTipo,
        fechaMuestreo: data.fechaMuestreo !== undefined ? data.fechaMuestreo : ensayo.fechaMuestreo,
        fechaEnsayo: data.fechaEnsayo !== undefined ? data.fechaEnsayo : ensayo.fechaEnsayo,
        laboratorio: data.laboratorio !== undefined ? data.laboratorio : ensayo.laboratorio,
        nroInforme: data.nroInforme !== undefined ? data.nroInforme : ensayo.nroInforme,
        resultado,
        cumple: cumpleValue,
        observaciones: data.observaciones !== undefined ? data.observaciones : ensayo.observaciones,
        fechaVencimiento,
        contextoAplicacion: ctxUpdate,
        idHusoDnvReferencia: idHusoRefUpdate ?? null,
    });

    // Sync derived ensayos (MF, TMN) si es granulometría
    const updatedEnsayo = await getEnsayo(db, id);
    await syncEnsayosDerivadosDesdeGranulometria(db, updatedEnsayo);

    // ── Verificación de clasificación IRAM 1569 ──
    try {
        await _verificarClasificacionIRAM1569(db, updatedEnsayo, tipo);
    } catch (e) { /* non-critical */ }

    // ── Generate alerts for dosifications using this material ──
    try {
        const { generarAlertasPorCambioMaterial } = require('./alertasMaterialService');
        const agName = updatedEnsayo.tipo?.nombre || tipo?.nombre || '';
        const agId = data.legacyAgregadoId || ensayo.legacyAgregadoId;
        // Get aggregate name
        let matName = '';
        try {
          const ag = await db.Agregado.findByPk(agId, { raw: true });
          matName = ag?.nombre || '';
        } catch {}
        await generarAlertasPorCambioMaterial(db, agId, tipo.codigo, agName, matName);
    } catch (e) { /* non-critical */ }

    // PR — Sincronizar AgregadoMeta.evaluacionRas si el ensayo editado es
    // de tipo RAS.
    try {
        const { recomputarRasParaAgregado, esCodigoRas } = require('./rasMetaSyncService');
        const agId = data.legacyAgregadoId || ensayo.legacyAgregadoId;
        if (esCodigoRas(tipo?.codigo) && agId) {
            await recomputarRasParaAgregado(db, agId);
        }
    } catch (e) {
        console.warn('[updateEnsayo] sync RAS falló (non-blocking):', e.message);
    }

    return updatedEnsayo;
};

const deleteEnsayo = async (db, id) => {
    const ensayo = await db.AgregadoEnsayo.findByPk(id);
    if (!ensayo) throw new Error('AgregadoEnsayo no encontrado');

    // Capturamos datos para hooks post-soft-delete (porque después de
    // update isActive=false el modelo sigue en memoria pero los listados
    // no lo cuentan).
    const idAg = ensayo.legacyAgregadoId;
    let codigo = null;
    try {
        const tipo = await db.AgregadoEnsayoTipo.findByPk(ensayo.idAgregadoEnsayoTipo, { attributes: ['codigo'] });
        codigo = tipo?.codigo || null;
    } catch { /* non-blocking */ }

    // Soft delete
    await ensayo.update({ isActive: false });

    // PR — recomputar evaluación RAS si el ensayo borrado era de tipo RAS.
    try {
        const { recomputarRasParaAgregado, esCodigoRas } = require('./rasMetaSyncService');
        if (esCodigoRas(codigo) && idAg) {
            await recomputarRasParaAgregado(db, idAg);
        }
    } catch (e) {
        console.warn('[deleteEnsayo] sync RAS falló (non-blocking):', e.message);
    }

    return { message: 'AgregadoEnsayo desactivado correctamente' };
};

// ─── Resumen (set típico de ensayos) ────────────────────────

/**
 * Devuelve el resumen completo del set de ensayos para un agregado.
 *
 * @param {object} db        – conexión tenant
 * @param {number} legacyAgregadoId
 * @param {object} opts
 * @param {string} [opts.uso]  – "FINO" | "GRUESO" | "TOTAL" | undefined
 * @returns {{ legacyAgregadoId, uso, asOf, totals, items }}
 */
const getResumen = async (db, legacyAgregadoId, opts = {}) => {
    const uso = opts.uso ? opts.uso.toUpperCase() : null;
    // Modo de evaluación (decisión 2026-05-28):
    //   DESCRIPTIVO (default): no calcula compliance ni veredicto. Devuelve
    //     items con datos crudos (resultado + estado de vencimiento). El PDF
    //     descriptivo consume esto sin emitir juicio.
    //   NORMATIVO: corre el evaluador legacy para cada item + invoca
    //     `evaluarPrescriptivo` con la matriz completa para producir
    //     veredictoGlobal y lista de faltantes según norma (NO filtrada por
    //     el catálogo del tenant).
    //
    // Acepta los strings viejos PRESTACIONAL/PRESCRIPTIVO vía `normalizarModo`
    // del engine dual; el resultado se devuelve siempre con el nombre nuevo.
    const { normalizarModo, MODO_NORMATIVO, MODO_DESCRIPTIVO } =
        require('../domain/evaluacion/evaluacionEngine');
    const modoEvaluacion = normalizarModo(opts.modo);
    const esNormativo = modoEvaluacion === MODO_NORMATIVO;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const hoyStr = hoy.toISOString().slice(0, 10);

    // PR9-fix test23/test24 — Resolver el contexto de aplicación del agregado
    // (HORMIGON / TBS / AMBOS) UNA vez al inicio. Es ortogonal al `uso` (FINO /
    // GRUESO): el primero indica para qué se usa el agregado en obra, el
    // segundo es el tipo granulométrico. Antes se confundieron los dos
    // conceptos y filtraban *todo*.
    const ctxAgregado = await resolverContextoAplicacion(db, { idAgregado: legacyAgregadoId });

    // 1. Todos los tipos activos del material, ordenados por (orden, nombre)
    const materialFilter = opts.material ? opts.material.toUpperCase() : 'AGREGADOS';
    const tipos = await db.AgregadoEnsayoTipo.findAll({
        where: { isActive: true, material: materialFilter },
        order: [['orden', 'ASC'], ['nombre', 'ASC']],
    });

    // 2. Último ensayo activo por tipo para este agregado
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: { legacyAgregadoId, isActive: true },
        order: [['fechaEnsayo', 'DESC']],
    });
    const ultimoMap = {};
    for (const e of ensayos) {
        if (!ultimoMap[e.idAgregadoEnsayoTipo]) {
            ultimoMap[e.idAgregadoEnsayoTipo] = e;
        }
    }

    // 3. Calcular estado por cada tipo, agrupando alias bajo código canónico
    const totals = { vigentes: 0, porVencer: 0, vencidos: 0, sinDatos: 0, noAplica: 0, noCumple: 0 };
    const items = [];
    const processedCanonical = new Set(); // track canonical codes already emitted

    // Deprecated types hidden from UI (historical data preserved but not shown in cards)
    const DEPRECATED_CODES = new Set([]);

    for (const tipo of tipos) {
        // ── Skip tipos that should not appear as cards (derivados, hidden) ──
        if (tipo.visibleEnCards === false || tipo.esDerivado) {
            continue;
        }

        // ── Alias grouping: skip if this code's canonical was already processed ──
        const canonical = getCanonicalCodigo(tipo.codigo);
        if (processedCanonical.has(canonical)) continue; // already emitted under canonical

        // Skip deprecated types
        if (DEPRECATED_CODES.has(canonical)) {
            processedCanonical.add(canonical);
            continue;
        }

        // Mark canonical as processed
        processedCanonical.add(canonical);

        // If this tipo IS an alias, find the canonical tipo to use for display
        let displayTipo = tipo;
        if (isAliasCodigo(tipo.codigo)) {
            const canonTipo = tipos.find(t => t.codigo === canonical);
            if (canonTipo) displayTipo = canonTipo;
        }

        // Collect all tipo IDs that belong to this canonical group
        const groupTipoIds = new Set();
        groupTipoIds.add(displayTipo.idAgregadoEnsayoTipo);
        // Add alias tipo ids
        for (const t of tipos) {
            if (getCanonicalCodigo(t.codigo) === canonical) {
                groupTipoIds.add(t.idAgregadoEnsayoTipo);
            }
        }

        const tipoData = {
            id: displayTipo.idAgregadoEnsayoTipo,
            nombre: displayTipo.nombre,
            codigo: displayTipo.codigo,
            normaRef: displayTipo.normaRef,
            categoria: displayTipo.categoria,
            obligatorio: displayTipo.obligatorio,
            warningDays: displayTipo.warningDays,
            aplicaA: displayTipo.aplicaA,
            orden: displayTipo.orden,
            perfil: displayTipo.perfil || 'CORE',
            esDerivado: displayTipo.esDerivado || false,
            visibleEnDosificacion: displayTipo.visibleEnDosificacion || false,
            visibleEnCards: displayTipo.visibleEnCards !== false,
            normaId: displayTipo.normaId || null,
            material: displayTipo.material || 'AGREGADOS',
            schemaKey: displayTipo.schemaKey || null,
            // PR6: propagar matriz multi-contexto al frontend para que el PDF
            // y la ficha técnica lean los flags por contexto del agregado.
            aplicaAHormigon: displayTipo.aplicaAHormigon !== false,  // default true (legacy seguro)
            aplicaATBS: !!displayTipo.aplicaATBS,
            obligatorioHormigon: !!displayTipo.obligatorioHormigon,
            obligatorioTBS: !!displayTipo.obligatorioTBS,
            nivelCaracterizacionHormigon: displayTipo.nivelCaracterizacionHormigon || 'NINGUNA',
            nivelCaracterizacionTBS: displayTipo.nivelCaracterizacionTBS || 'NINGUNA',
        };

        // ── Verificar si aplica según "uso" ──
        const aplica = _tipoAplicaA(displayTipo, uso);
        if (!aplica) {
            totals.noAplica++;
            items.push({
                tipo: tipoData,
                ultimoEnsayo: null,
                estado: 'NO_APLICA',
                diasParaVencer: null,
                needsAttention: false,
                motivo: 'no_aplica',
            });
            continue;
        }

        // ── Buscar último ensayo (among all tipo IDs in canonical group) ──
        //
        // PR9-fix test23 — Cuando el alias map colapsa códigos de distinto
        // contextoAplicacion bajo un único canónico (típico:
        // `IRAM1505_GRANULOMETRIA_HORMIGON` y `_TBS` colapsan a `_GRANULOMETRIA`),
        // antes se elegía sólo por fechaEnsayo. Eso permitía que un ensayo
        // TBS más reciente desplazara al de HORMIGON dentro del item agrupado,
        // y la ficha técnica del agregado para hormigón terminaba renderizando
        // los 3 puntos del huso DNV en la sección Granulometría.
        //
        // Estrategia: si el agregado tiene contexto único (HORMIGON o TBS),
        // preferir ensayos compatibles con ese contexto y descartar los del
        // contexto opuesto. Si el agregado es AMBOS, no filtrar (todos sirven).
        // Fallback: el más reciente de todos (back-compat para ensayos
        // legacy sin contextoAplicacion declarado).
        //
        // OJO: este filtro NO debe usar `uso` (que es FINO/GRUESO, distinto a
        // HORMIGON/TBS). Los conceptos son ortogonales; mezclarlos rechaza
        // todos los ensayos válidos.
        const ctxCompatible = (e) => {
            if (ctxAgregado === 'AMBOS') return true;
            const ctx = e.contextoAplicacion || 'HORMIGON';
            if (ctx === 'AMBOS') return true;
            return ctx === ctxAgregado;
        };
        const candidatosCompat = [];
        const candidatosFallback = [];
        for (const tid of groupTipoIds) {
            const candidate = ultimoMap[tid];
            if (!candidate) continue;
            if (ctxCompatible(candidate)) candidatosCompat.push(candidate);
            else candidatosFallback.push(candidate);
        }
        const ganador = (lista) => lista.reduce(
            (best, c) => (!best || c.fechaEnsayo > best.fechaEnsayo) ? c : best,
            null,
        );
        // Si hay compatibles, ganan ellos. Si no hay ninguno compatible pero
        // sí hay incompatibles (caso patológico: agregado HORMIGON con
        // ensayos solo cargados como TBS), preferimos NO devolver nada del
        // contexto contrario — la sección Granulometría debe decir "sin
        // datos de hormigón" en vez de mostrar la curva TBS.
        const ult = ganador(candidatosCompat) || null;

        if (!ult) {
            totals.sinDatos++;
            items.push({
                tipo: tipoData,
                ultimoEnsayo: null,
                estado: 'SIN_DATOS',
                diasParaVencer: null,
                needsAttention: !!tipo.obligatorio,
                motivo: 'sin_datos',
            });
            continue;
        }

        // ── Calcular vencimiento ──
        // P1.8: vigencia efectiva por tipo (usa registry si tipo no la define)
        let vencStr = ult.fechaVencimiento || null;
        if (!vencStr && ult.fechaEnsayo) {
            const vigencia = getVigenciaEfectivaMeses(tipo);
            if (vigencia > 0) vencStr = calcularFechaVencimiento(ult.fechaEnsayo, vigencia, null);
        }

        let estado;
        let diasParaVencer = null;
        let motivo = null;

        if (vencStr) {
            const vencDate = new Date(vencStr);
            vencDate.setHours(0, 0, 0, 0);
            diasParaVencer = Math.ceil((vencDate - hoy) / (1000 * 60 * 60 * 24));

            if (diasParaVencer < 0) {
                estado = 'VENCIDO';
                motivo = 'vencido';
            } else if (diasParaVencer <= (tipo.warningDays ?? 30)) {
                estado = 'POR_VENCER';
                motivo = `vence_en_${diasParaVencer}_dias`;
            } else {
                estado = 'VIGENTE';
                motivo = null;
            }
        } else {
            // Sin vencimiento calculable → considerar vigente por vencimiento
            estado = 'VIGENTE';
            diasParaVencer = null;
            motivo = null;
        }

        // ── Auto-evaluate if NO_EVAL but has resultado ──
        let cumpleVal = ult.cumple;
        if (cumpleVal === 'NO_EVAL' && ult.resultado) {
            try {
                const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
                const parsedRes = safeParseResultado(ult);
                if (parsedRes && Object.keys(parsedRes).length > 0) {
                    // C6 (auditoría 01-calidad sesión 2026-05-07): pasar `subtipoMaterial`
                    // al evaluador (IRAM 1674 AG lo usa para resolver 1,0% vs 1,5%).
                    let subtipoMaterial = null;
                    if (ult.legacyAgregadoId && db.AgregadoMeta) {
                        try {
                            const meta = await db.AgregadoMeta.findOne({
                                where: { legacyAgregadoId: ult.legacyAgregadoId },
                                attributes: ['subtipoMaterial'], raw: true,
                            });
                            subtipoMaterial = meta?.subtipoMaterial || null;
                        } catch { /* non-blocking */ }
                    }
                    const evalResult = evaluarEnsayo(displayTipo.codigo, parsedRes, { tipoAgregado: uso || null, subtipoMaterial });
                    if (evalResult.cumple && evalResult.cumple !== 'NO_EVAL') {
                        cumpleVal = evalResult.cumple;
                        // Persist the evaluation (fire and forget)
                        ult.update({ cumple: cumpleVal }).catch(() => {});
                    }
                }
            } catch (_) { /* ignore eval errors */ }
        }

        // ── needsAttention / motivo: sólo date-based en este punto ──
        // Tras C8.6, la decisión "este ensayo requiere atención por NO APTO" se aplica
        // POST-loop usando compliance canónico — no el legacy `cumple === 'NO_CUMPLE'`,
        // que contaminaba bajo Hybrid Option B (legacy NO_CUMPLE + canónico
        // passWithObservations / conditionalPass marcaba como atención cuando el
        // veredicto canónico no lo es).
        const needsAttention = estado !== 'VIGENTE'; // VENCIDO o POR_VENCER → alerta date-based

        // ── Contadores ──
        if (estado === 'VIGENTE') totals.vigentes++;
        else if (estado === 'POR_VENCER') totals.porVencer++;
        else if (estado === 'VENCIDO') totals.vencidos++;

        items.push({
            tipo: tipoData,
            ultimoEnsayo: {
                id: ult.idAgregadoEnsayo,
                fechaEnsayo: ult.fechaEnsayo,
                fechaVencimiento: vencStr,
                laboratorio: ult.laboratorio,
                nroInforme: ult.nroInforme,
                cumple: cumpleVal,
                // safeParseResultado handles double-encoded JSON (some legacy DB rows)
                resultado: safeParseResultado(ult),
                createdAt: ult.createdAt,
                // PR9-fix test23 — exponer contextoAplicacion del ensayo concreto
                // (no del tipo display) para que el frontend pueda descartar
                // ensayos TBS que se cuelan al colapsar el alias map.
                contextoAplicacion: ult.contextoAplicacion || null,
                idAgregadoEnsayoTipo: ult.idAgregadoEnsayoTipo,
            },
            estado,
            diasParaVencer,
            needsAttention,
            motivo,
        });
    }

    // ── Veredicto global del material (Prompt 2 C10.4) ──
    // Construye un ComplianceResult agregado. Resolución del compliance per
    // item con preferencia descendente:
    //   1. `_evaluacion.compliance` persistido (post-C6/C10 — el más reciente).
    //      Garantía: este campo se ESCRIBE en createEnsayo / updateEnsayo /
    //      reevaluarEnsayosAntiguos / getEnsayoEnriquecido (4 writers
    //      sincronizados al mismo shape). NO se invalida automáticamente
    //      cuando cambian las reglas del motor — si se refactora un
    //      evaluador o cambia un límite, los ensayos viejos persistidos
    //      conservan el compliance computado contra las reglas previas.
    //   2. Re-invocación del evaluador `evaluarEnsayo(codigo, resultado, ctx)`
    //      con el resultado raw — esto SÍ refleja las reglas vigentes del
    //      motor en cada llamada a `getResumen`. Es lo que rescata datos
    //      persistidos pre-C6/C10 que no tienen compliance escrito.
    //   3. Mapeo desde `cumple` legacy (último recurso).
    //
    // ⚠ STALENESS DEL `veredictoGlobal` (importante para Prompt 3):
    //
    // El veredicto se RECALCULA en cada llamada a `getResumen` — no se
    // persiste. Por lo tanto:
    //   - Es "fresh" respecto a la última lectura, pero no notifica a
    //     observers cuando cambia.
    //   - Los items con compliance persistido (path 1) pueden estar STALE
    //     si las reglas del motor cambiaron entre la creación del ensayo y
    //     la lectura del veredicto. La asimetría se nota: dos materiales
    //     con datos idénticos pueden dar veredictos distintos si uno fue
    //     evaluado pre-cambio y el otro post-cambio.
    //   - Para forzar refresh, llamar `reevaluarEnsayosAntiguos(db, { forzar: true })`.
    //
    // ⚠ Para los renderers en Prompt 3:
    //   - El `veredictoGlobal` que llega via API ya está computado al momento
    //     de la response. NO confiar en que un re-render sin re-fetch
    //     refleje cambios.
    //   - El filtro path 1 vs path 2 se decide POR ITEM, no globalmente —
    //     un mismo veredicto puede combinar ensayos viejos con compliance
    //     persistido y ensayos nuevos con re-eval.
    //   - Documentado en DEFERRED.md sección "veredictoGlobal staleness".
    //
    // NO_APLICA → invisible (filtrado).
    //
    // Cierre parcial de D18: la inferencia de `tipoAgregado` para el evaluador
    // se hace consultando AgregadoMeta.subtipoMaterial cuando `tipo.aplicaA`
    // es ambiguo (típico para IRAM1674_MATERIAL_FINO_200). El cierre completo
    // (en createEnsayo) se aplicó en C11.2.
    //
    // DECISIÓN 2026-05-28 (modelo dual descriptivo/normativo): toda la
    // computación de compliance per-item, política del catálogo y veredicto
    // global vive bajo `if (esNormativo)`. En DESCRIPTIVO el response no
    // tiene veredicto ni compliance — la ficha técnica descriptiva no juzga.
    let veredictoGlobal = null;
    let ensayosFaltantesPorNorma = [];

    if (esNormativo) {
    const { calcularVeredictoGlobal, Compliance, getCategoriaVeredicto } = require('../domain/compliance');
    const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');
    let tipoAgInferidoMeta = null;
    try {
        if (db.AgregadoMeta) {
            const meta = await db.AgregadoMeta.findOne({
                where: { legacyAgregadoId: Number(legacyAgregadoId) },
                attributes: ['subtipoMaterial'],
                raw: true,
            });
            const subtipo = (meta?.subtipoMaterial || '').toUpperCase();
            const FINO_SUBTIPOS = new Set(['ARENA_NATURAL', 'ARENA_TRITURACION', 'MEZCLA']);
            if (FINO_SUBTIPOS.has(subtipo)) tipoAgInferidoMeta = 'FINO';
            else if (subtipo) tipoAgInferidoMeta = 'GRUESO';
        }
        // Fix auditor-pdf 2026-05-28 (test100 — bug 2 follow-up): si
        // `AgregadoMeta.subtipoMaterial` no está cargado (tenant pre-PR2),
        // inferir FINO/GRUESO desde la existencia de la fila en las tablas
        // hijas `AgregadoFino` / `AgregadoGrueso` (modelo legacy: el tipo
        // del agregado se materializa por presencia de registro en una u
        // otra tabla, NO con un campo `tipo` directo en `Agregado`). Sin
        // este fallback, evaluadores context-sensitive (IRAM 1674 Pasante
        // #200) reciben tipoAg=null y caen a su rama AG default, marcando
        // 1,7% como NO_CUMPLE contra 1%/1,5% (límites de AG) cuando el
        // agregado es claramente FINO con límite 3%/5%.
        if (!tipoAgInferidoMeta) {
            const idAg = Number(legacyAgregadoId);
            if (db.AgregadoFino) {
                const fino = await db.AgregadoFino.findOne({
                    where: { idAgregado: idAg },
                    attributes: ['idAgregado'],
                    raw: true,
                });
                if (fino) tipoAgInferidoMeta = 'FINO';
            }
            if (!tipoAgInferidoMeta && db.AgregadoGrueso) {
                const grueso = await db.AgregadoGrueso.findOne({
                    where: { idAgregado: idAg },
                    attributes: ['idAgregado'],
                    raw: true,
                });
                if (grueso) tipoAgInferidoMeta = 'GRUESO';
            }
        }
    } catch { /* non-blocking */ }

    // Filtro extra para veredicto: además de NO_APLICA, excluir items cuyo
    // tipo.aplicaA NO matchea el subtipo del agregado (sino, todos los ensayos
    // GRUESO aparecen como SIN_DATOS en un agregado FINO y contaminan el
    // veredicto a EVALUACIÓN_INCOMPLETA falsa). El listado con uso='TOTAL'
    // muestra todos los tipos activos, lo cual es UI-friendly pero no es la
    // base correcta para el veredicto.
    const _itemAplicaAlAgregado = (i) => {
        if (!tipoAgInferidoMeta) return true; // sin meta no podemos filtrar
        const aplicaA = i.tipo?.aplicaA;
        if (!aplicaA) return true; // ensayo universal
        let arr = aplicaA;
        if (typeof arr === 'string') {
            try { arr = JSON.parse(arr); } catch { return true; }
        }
        if (!Array.isArray(arr) || arr.length === 0) return true;
        return arr.some(a => (a || '').toUpperCase() === tipoAgInferidoMeta);
    };

    // Contexto del agregado para la matriz prescriptiva (la matriz puede
    // diferenciar HORMIGON / TBS / AMBOS en sus predicados).
    const contextoAgregado = await resolverContextoAplicacion(db, { idAgregado: legacyAgregadoId });

    const veredictoItemsRaw = items
        .filter(i => i.estado !== 'NO_APLICA')
        .filter(_itemAplicaAlAgregado)
        .map(i => {
            const item = {
                parametro: i.tipo?.nombre || i.tipo?.codigo,
                key: i.tipo?.codigo,
                compliance: null,
            };

            // (1) compliance canónico persistido
            const ev = i.ultimoEnsayo?.resultado?._evaluacion;
            // Fix auditor-pdf 2026-05-28 (test92, bug 2): el evaluador de
            // IRAM 1674 (Pasante #200) tiene ramas distintas AF/AG con
            // límites muy distintos (AF: 3%/5%; AG: 1%/1.5%). Los ensayos
            // creados antes del fix de `tipoAg` fallback (PR1) tienen
            // persisted compliance computado con tipoAg=null → cae a AG.
            // Para esos casos, FORZAMOS re-evaluación desde el raw para
            // que el fix de `tipoAg = tipoAgInferidoMeta || uso || null`
            // alcance ensayos viejos sin requerir `reevaluarEnsayosAntiguos`.
            const codigoActual = i.tipo?.codigo || '';
            const _esContextoSensible = /IRAM1674_MATERIAL_FINO_200|IRAM1540|PASA_200/i.test(codigoActual);
            const _forzarReEval = _esContextoSensible && ev?.compliance?.status === 'fail';
            if (!_forzarReEval && ev?.compliance && typeof ev.compliance === 'object' && ev.compliance.status) {
                // Refinamiento C11: si el ensayo existe físicamente pero el
                // motor no tiene evaluador (resultado del Prompt 1 default
                // seguro: notEvaluated con reason "Sin parámetros..."),
                // tratarlo como notApplicable para el veredicto. El ensayo
                // forma parte del catálogo pero no contribuye decisión a la
                // aptitud HORMIGON. Distinguimos esto de "falta cargar el
                // ensayo" (que sí debe contribuir como pending).
                const isUnknownByEngine = ev.compliance.status === 'notEvaluated'
                    && /sin par[áa]metros de evaluaci[óo]n configurados/i.test(ev.compliance.reason || '');
                if (isUnknownByEngine) {
                    item.compliance = Compliance.notApplicable({
                        reason: 'Ensayo cargado pero el motor no tiene parámetros normativos configurados (no contribuye al veredicto HORMIGON)',
                    });
                    return item;
                }
                item.compliance = ev.compliance;
                return item;
            }

            // (2) Re-invocar evaluador para obtener compliance fresco desde
            // el resultado raw (sirve para ensayos persistidos pre-C10).
            const r = i.ultimoEnsayo?.resultado;
            if (r && i.tipo?.codigo) {
                try {
                    const tipoAg = (() => {
                        // Priorizar inferencia única desde tipo.aplicaA cuando es definitivo.
                        if (i.tipo?.aplicaA) {
                            const arr = typeof i.tipo.aplicaA === 'string' ? JSON.parse(i.tipo.aplicaA) : i.tipo.aplicaA;
                            if (Array.isArray(arr) && arr.length === 1) return arr[0];
                        }
                        // Caso ambiguo (aplicaA = ['FINO','GRUESO']): usar AgregadoMeta.
                        // Fallback B.3 (decisión 2026-05-28): cuando no hay
                        // subtipo cargado en AgregadoMeta, caemos al `uso`
                        // que viene del frontend (FINO/GRUESO directo desde
                        // la card del agregado). Sin este fallback, el
                        // evaluador IRAM1674_MATERIAL_FINO_200 va a la rama
                        // GRUESO por default y marca como NO_CUMPLE valores
                        // que serían CUMPLE en AF (ej. 1,7% < 3,0% AF).
                        return tipoAgInferidoMeta || uso || null;
                    })();
                    const evalResult = evaluarEnsayo(i.tipo.codigo, r, { tipoAgregado: tipoAg });
                    if (evalResult?.compliance) {
                        // Mismo refinamiento C11 que en (1).
                        const isUnknownByEngine = evalResult.compliance.status === 'notEvaluated'
                            && /sin par[áa]metros de evaluaci[óo]n configurados/i.test(evalResult.compliance.reason || '');
                        if (isUnknownByEngine) {
                            item.compliance = Compliance.notApplicable({
                                reason: 'Ensayo cargado pero el motor no tiene parámetros normativos configurados',
                            });
                        } else {
                            item.compliance = evalResult.compliance;
                        }
                        return item;
                    }
                } catch { /* fallback below */ }
            }

            // (3) Fallback: mapeo desde `cumple` legacy + estado del resumen.
            if (i.estado === 'SIN_DATOS') {
                item.compliance = i.tipo?.obligatorio
                    ? Compliance.pending({ reason: `Falta ensayo obligatorio: ${i.tipo?.nombre}` })
                    : Compliance.notApplicable({ reason: 'Ensayo no obligatorio sin datos' });
            } else if (i.estado === 'VENCIDO') {
                item.compliance = Compliance.expired({ reason: `Ensayo vencido: ${i.tipo?.nombre}` });
            } else if (i.ultimoEnsayo?.cumple === 'NO_CUMPLE') {
                item.compliance = Compliance.fail({ reasons: [`No cumple: ${i.tipo?.nombre}`] });
            } else if (i.ultimoEnsayo?.cumple === 'CUMPLE') {
                item.compliance = Compliance.pass({});
            } else {
                item.compliance = Compliance.notEvaluated({ reason: 'Sin evaluación' });
            }
            return item;
        });

    // DECISIÓN 2026-05-28: en modo NORMATIVO, el filtro por catálogo
    // (`aplicarPoliticaAItemsCompliance`) NO se aplica. La norma es soberana,
    // no se rebajan fails a "informativo" por flags del tenant. La política
    // del catálogo queda únicamente para alertas reactivas internas (PR4,
    // hooks Sequelize) y para qué exige la UI de carga.
    const veredictoItems = veredictoItemsRaw;
    veredictoGlobal = calcularVeredictoGlobal(veredictoItems);

    // Prompt 3 C6.5: propagar el `compliance` computado por veredictoItems a
    // cada item del response, alineado por código de tipo. El frontend
    // (MaterialDetailPage Section 3) lee `items[i].compliance` directo en
    // lugar de penetrar `ultimoEnsayo.resultado._evaluacion.compliance` —
    // y como `veredictoItems` ya re-evaluó los ensayos legacy contra el motor
    // actual, esto activa el patrón Hybrid Option B (D15+D20) en el render:
    // Petrográfico reactivo / RAS reactivo / granulometría individual fuera
    // de banda se ven con su categoría canónica en vez de NO APTO.
    // PR4: propagar también los flags de "rescate por política" al item de respuesta
    // para que el frontend pueda renderizar tooltip explicativo en items rescatados.
    const veredictoItemByCodigo = new Map(veredictoItems.map(vi => [vi.key, vi]));
    for (const i of items) {
        const codigo = i.tipo?.codigo;
        const vi = codigo ? veredictoItemByCodigo.get(codigo) : null;
        if (vi) {
            i.compliance = vi.compliance;
            // Fix auditor-pdf 2026-05-28 (test98 — bug 2 follow-up):
            // propagar también a `ultimoEnsayo.compliance` para que el
            // adapter `fromLegacyEval` del frontend (path del certificado y
            // de comparación) lea el compliance re-evaluado desde ahí, en
            // lugar del legacy `ultimoEnsayo.cumple = NO_CUMPLE` persistido
            // pre-fix. Sin esta línea, el certificado seguía marcando
            // NO APTO al Pasante #200 (1,7%) aunque la sección E del PDF
            // normativo (que lee `item.compliance` directo) ya mostraba
            // "Cumple" — produciendo contradicción intra-PDF.
            if (i.ultimoEnsayo) {
                i.ultimoEnsayo.compliance = vi.compliance;
            }
            if (vi._wasFailNonMandatory) {
                i._wasFailNonMandatory = true;
                i._originalCompliance = vi._originalCompliance || null;
            }
        }
    }

    // Prompt 3 C8.5 + C8.6: derivar `totals.noCumple`, `item.needsAttention` y
    // `item.motivo` desde la categoría canónica del compliance per item, en lugar
    // del legacy `cumpleVal === 'NO_CUMPLE'` (que contamina bajo Hybrid Option B:
    // un ensayo con legacy NO_CUMPLE pero canónico passWithObservations /
    // conditionalPass se trataba como atención requerida y se sumaba al counter
    // cuando conceptualmente es APTO_CON_OBSERVACIONES o APTITUD_CONDICIONADA).
    //
    // Cambios observables:
    //   - C8.5: el chip "X No cumple" en AgregadoEnsayosPage refleja sólo
    //     ensayos canónicamente NO APTO.
    //   - C8.6: el flag `needsAttention` y el `motivo` (consumidos por la UI
    //     para mostrar mensajes de "atención requerida") quedan coherentes con
    //     el counter — antes `getResumen` exponía contradicciones internas.
    //
    // Las alertas date-based (VENCIDO / POR_VENCER) ya están reflejadas en
    // `needsAttention` y `motivo` desde el loop principal; acá sólo agregamos
    // la dimensión compliance.
    totals.noCumple = 0;
    for (const i of items) {
        if (!i.compliance?.status) continue;
        const isCanonNoApto = getCategoriaVeredicto(i.compliance) === 'NO APTO';
        if (isCanonNoApto) {
            totals.noCumple++;
            i.needsAttention = true;
            i.motivo = i.motivo ? `${i.motivo}|no_cumple` : 'no_cumple';
        }
    }

    // ── NORMATIVO: lista de ensayos exigibles por la matriz que NO están
    //    cargados (independiente del catálogo del tenant). El PDF normativo
    //    los muestra en la Sección E como "Sin dato — exigido por norma".
    try {
        const { evaluarPrescriptivo } =
            require('../domain/evaluacion/prescriptivoEngine');
        const itemsParaEngine = veredictoItemsRaw.map(vi => ({
            tipo: { codigo: vi.key, nombre: vi.parametro },
            compliance: vi.compliance,
            ultimoEnsayo: { resultado: true }, // marca de "ensayo presente"
        }));
        const resPresc = evaluarPrescriptivo({
            items: itemsParaEngine,
            tipoAgregado: tipoAgInferidoMeta || uso || null,
        });
        ensayosFaltantesPorNorma = resPresc?.ensayosFaltantes || [];
    } catch (err) {
        if (isDev) console.warn('[getResumen] evaluarPrescriptivo falló:', err.message);
    }

    } // ── fin if (esNormativo) ──

    return {
        legacyAgregadoId: Number(legacyAgregadoId),
        uso: uso || null,
        asOf: hoyStr,
        modoEvaluacion,
        totals,
        items,
        veredictoGlobal,
        ensayosFaltantesPorNorma,
    };
};

/** Helper: ¿el tipo aplica al uso solicitado? */
const _tipoAplicaA = (tipo, uso) => {
    // uso=TOTAL o uso=null → siempre aplica
    if (!uso || uso.toUpperCase() === 'TOTAL') return true;
    // tipo.aplicaA NULL → aplica a todos
    if (!tipo.aplicaA) return true;
    let arr = tipo.aplicaA;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch (_) { return true; }
    }
    // Case-insensitive comparison
    const usoUp = uso.toUpperCase();
    if (Array.isArray(arr)) return arr.some(a => (a || '').toUpperCase() === usoUp);
    return true;
};


/* ════════════════════════════════════════════════════════════
   Caracterización del agregado (computed from ensayos)
   ════════════════════════════════════════════════════════════ */

/**
 * Build aggregate characterization by reading the latest ensayos for:
 *  - Granulometría (TMN, MF)
 *  - Densidad/Absorción
 *  - Desgaste Los Ángeles
 *  - Lajosidad / Elongación / Pasa N°200
 *
 * Returns computed values + source metadata (fecha, lab, nroInforme, ensayoId, estado).
 * Does NOT filter by vencimiento — always returns the most recent known value.
 */
const getCaracterizacion = async (db, legacyAgregadoId, uso = null) => {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    // PR2: contexto del agregado para decidir qué ensayos forman parte de
    // la caracterización formal según la nueva matriz nivelCaracterizacion[contexto].
    // Diferencia con getResumen (línea ~1722): allá los ensayos cargados con
    // nivel=NINGUNA se PRESERVAN en la lista (trazabilidad). Acá NO aparecen
    // en la "caracterización" porque el tecnólogo declaró que ese parámetro
    // no forma parte de la ficha técnica del agregado en este contexto.
    const contextoAgregadoCaract = await resolverContextoAplicacion(db, { idAgregado: legacyAgregadoId });
    const _nivelCaracEffective = (tipo) => {
        const usaH = (contextoAgregadoCaract === 'HORMIGON' || contextoAgregadoCaract === 'AMBOS')
            && tipo.aplicaAHormigon;
        const usaT = (contextoAgregadoCaract === 'TBS' || contextoAgregadoCaract === 'AMBOS')
            && tipo.aplicaATBS;
        const nH = usaH ? (tipo.nivelCaracterizacionHormigon || 'NINGUNA') : 'NINGUNA';
        const nT = usaT ? (tipo.nivelCaracterizacionTBS || 'NINGUNA') : 'NINGUNA';
        // Si cualquier contexto activo lo declara BASICA/AVANZADA, aparece.
        return nH !== 'NINGUNA' || nT !== 'NINGUNA';
    };

    // Fetch all active ensayos for this aggregate, most recent first
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: { legacyAgregadoId, isActive: true },
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
        order: [['fechaEnsayo', 'DESC'], ['createdAt', 'DESC']],
    });

    const _debug = { totalEnsayos: ensayos.length, picked: {} };
    console.log(`[getCaracterizacion] agregado=${legacyAgregadoId} uso=${uso} ensayos=${ensayos.length}`);

    const safeResultado = safeParseResultado;
    const aplicaAlUso = (e) => _tipoAplicaA(e.tipo || {}, uso);

    const src = (e, valor) => {
        if (valor == null) return null;
        let estado = 'VIGENTE';
        if (e.fechaVencimiento) {
            const venc = new Date(e.fechaVencimiento);
            venc.setHours(0, 0, 0, 0);
            if (venc < hoy) estado = 'VENCIDO';
        }
        return { valor, fechaEnsayo: e.fechaEnsayo, laboratorio: e.laboratorio, nroInforme: e.nroInforme, idAgregadoEnsayo: e.idAgregadoEnsayo, estado };
    };

    // === CONFIG-DRIVEN CHARACTERIZATION ===
    // Find all tipos with visibleEnCaracterizacion=true, extract values per caractFields
    const result = {};

    // Group ensayos by tipo (first = most recent per tipo)
    const latestByTipo = new Map();
    for (const e of ensayos) {
        if (!e.tipo) continue;
        const cod = e.tipo.codigo;
        if (!latestByTipo.has(cod) && aplicaAlUso(e)) {
            latestByTipo.set(cod, e);
        }
    }

    // Process each tipo that has nivelCaracterizacion != NINGUNA en el
    // contexto del agregado (PR2). El campo legacy `visibleEnCaracterizacion`
    // queda como fallback temporal mientras los flags multi-contexto se
    // estabilizan en todos los tenants.
    for (const [cod, e] of latestByTipo) {
        const tipo = e.tipo;
        if (!_nivelCaracEffective(tipo) && !tipo.visibleEnCaracterizacion) continue;
        let caractFields = tipo.caractFields;
        if (typeof caractFields === 'string') try { caractFields = JSON.parse(caractFields); } catch { caractFields = null; }
        if (!Array.isArray(caractFields) || caractFields.length === 0) continue;

        const raw = safeResultado(e);
        const r = raw.densidadAbsorcion || raw; // legacy support

        for (const field of caractFields) {
            const key = field.key;
            let valor = r[key] ?? raw[key] ?? null;

            // Special handling for granulometría: compute MF and TMN from tamices
            if (key === 'moduloFinura' || key === 'tmnMm') {
                const g = r.granulometria || raw.granulometria;
                console.log(`[getCaracterizacion] special field=${key} g=${!!g} g.evaluacion=${!!g?.evaluacion} g.tamices=${g?.tamices?.length || 0}`);
                if (g) {
                    const calc = g.evaluacion?.calculos;
                    if (key === 'tmnMm') {
                        valor = calc?.tmn?.valor ?? g.reportado?.tmnMm ?? null;
                        if (valor == null && g.tamices?.length > 0) {
                            try {
                                const medidos = normalizeMedidos(g.tamices);
                                const tmnCalc = calcularTMN(medidos);
                                valor = tmnCalc?.valor ?? null;
                            } catch {}
                        }
                    }
                    if (key === 'moduloFinura') {
                        // Try multiple sources for MF value
                        // 1. From evaluacionAuto (computed during auto-eval)
                        valor = g.evaluacionAuto?.moduloFinura?.valor ?? null;
                        // 2. From evaluacion calculos
                        if (valor == null) valor = calc?.moduloFinura?.valor ?? null;
                        // 3. Recompute from tamices
                        if (valor == null && g.tamices?.length > 0) {
                            const aplicaA = tipo.aplicaA;
                            let arrAplicaA = aplicaA;
                            if (typeof arrAplicaA === 'string') try { arrAplicaA = JSON.parse(arrAplicaA); } catch { arrAplicaA = null; }
                            const tipoInferido = g.tipoAgregado
                                || (Array.isArray(arrAplicaA) && arrAplicaA.includes('GRUESO') && !arrAplicaA.includes('FINO') ? 'GRUESO' : null)
                                || (Array.isArray(arrAplicaA) && arrAplicaA.includes('FINO') && !arrAplicaA.includes('GRUESO') ? 'FINO' : null)
                                || (uso ? uso.toUpperCase() : null);
                            if (tipoInferido) {
                                try {
                                    const medidos = normalizeMedidos(g.tamices);
                                    const mfCalc = calcularModuloFinura(medidos, tipoInferido);
                                    valor = mfCalc?.valor ?? null;
                                } catch {}
                            }
                        }
                        // 4. From reportado
                        if (valor == null) valor = g.reportado?.moduloFinura ?? null;
                        console.log(`[getCaracterizacion] MF resolved: ${valor} (from: autoEval=${!!g.evaluacionAuto?.moduloFinura?.valor}, calc=${!!calc?.moduloFinura?.valor})`);
                    }
                }
            }

            result[key] = src(e, valor);
            _debug.picked[key] = { id: e.idAgregadoEnsayo, codigo: cod, valor };
        }

        // Special: attach granulometria tamices for PDF graph
        if (cod === CODIGO_GRANULOMETRIA || getCanonicalCodigo(cod) === CODIGO_GRANULOMETRIA) {
            const g = (safeResultado(e)).granulometria || (raw).granulometria;
            if (g?.tamices?.length > 0) {
                result.granulometria = src(e, { tamices: g.tamices, tipoAgregado: g.tipoAgregado || null });
            }
        }
    }

    // ── Fallback to legacy Agregado table when no data found ──
    const hasAnyData = Object.entries(result)
        .filter(([k]) => k !== '_debug' && k !== 'granulometria')
        .some(([, v]) => v != null);

    if (!hasAnyData) {
        try {
            const includes = [{ model: db.AgregadoFino, as: 'agregadoFino', required: false }];
            if (db.AgregadoGrueso) {
                includes.push({ model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false,
                    include: db.TamanioMaximoNominal ? [{ model: db.TamanioMaximoNominal, as: 'tamanioMaximoNominal', required: false }] : [],
                });
            }
            const agregado = await db.Agregado.findByPk(legacyAgregadoId, { include: includes });
            if (agregado) {
                const srcLegacy = (valor) => valor != null ? { valor: Number(valor), fechaEnsayo: null, laboratorio: null, nroInforme: null, idAgregadoEnsayo: null, estado: 'LEGACY', fuenteLegacy: true } : null;
                if (agregado.densidad != null) result.densidadRelativaAparenteSSS = result.densidadRelativaAparenteSSS || srcLegacy(agregado.densidad);
                if (agregado.absorcion != null) result.absorcionPct = result.absorcionPct || srcLegacy(agregado.absorcion);
                if (agregado.moduloFinura != null) result.moduloFinura = result.moduloFinura || srcLegacy(agregado.moduloFinura);
                const fino = agregado.agregadoFino;
                if (fino?.pasaTamiz200 != null) result.pasa200Pct = result.pasa200Pct || srcLegacy(fino.pasaTamiz200);
                const grueso = agregado.agregadoGrueso;
                if (grueso?.tamanioMaximoNominal?.tamanio != null) result.tmnMm = result.tmnMm || srcLegacy(grueso.tamanioMaximoNominal.tamanio);
                _debug.legacyFallback = true;
            }
        } catch (err) {
            if (isDev) console.warn('[getCaracterizacion] Legacy fallback error:', err.message);
        }
    }

    {
        console.log(`[getCaracterizacion] agregado=${legacyAgregadoId} result keys:`, Object.keys(result).filter(k => result[k] != null));
        result._debug = _debug;
    }

    return result;
};

/**
 * Verifica si la densidad del material cumple la condición de clasificación IRAM 1569.
 * AG: densidad aparente relativa >= 2.0
 * AF: PUC >= 1125 kg/m³ (from IRAM 1548)
 * Stores alert in AgregadoMeta.alertaClasificacion (JSON field).
 */
async function _verificarClasificacionIRAM1569(db, ensayo, tipo) {
    if (!tipo || !ensayo.legacyAgregadoId) return;
    const codigo = tipo.codigo || '';

    // Only check for density ensayos
    const isDensidadAG = codigo.includes('1533_DENSIDAD') || codigo.includes('DENSIDAD_GRUESO');
    const isPesoUnitario = codigo.includes('PESO_UNITARIO') || codigo.includes('1548');
    if (!isDensidadAG && !isPesoUnitario) return;

    let r = ensayo.resultado;
    if (typeof r === 'string') try { r = JSON.parse(r); } catch { return; }
    if (!r) return;

    // Get the material's AgregadoMeta
    if (!db.AgregadoMeta) return;
    let meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId: ensayo.legacyAgregadoId } });
    if (!meta) return;

    const tipoAgregado = meta.tipoAgregado || '';
    let alerta = null;

    if (isDensidadAG && tipoAgregado.toUpperCase() === 'GRUESO') {
        // Check densidad aparente relativa (d1) >= 2.0
        const d1 = r.densidadRelativaReal ?? r.densidadRelativaAparenteSSS ?? null;
        if (d1 != null && d1 < 2.0) {
            alerta = {
                tipo: 'clasificacion_liviano',
                mensaje: `Densidad aparente relativa (${d1}) < 2,0. Segun IRAM 1569, este material podria no calificar como agregado grueso convencional. Verificar si corresponde clasificar como agregado liviano (IRAM 1567).`,
                valor: d1,
                umbral: 2.0,
                fecha: new Date().toISOString().slice(0, 10),
            };
        }
    }

    if (isPesoUnitario && tipoAgregado.toUpperCase() === 'FINO') {
        const puc = r.puc ?? null;
        if (puc != null && puc < 1125) {
            alerta = {
                tipo: 'clasificacion_liviano',
                mensaje: `PUC (${puc} kg/m3) < 1.125 kg/m3. Segun IRAM 1569, este material podria clasificar como agregado liviano fino (IRAM 1567).`,
                valor: puc,
                umbral: 1125,
                fecha: new Date().toISOString().slice(0, 10),
            };
        }
    }

    // Update meta — set or clear the alert
    await meta.update({ alertaClasificacion: alerta });
}

/**
 * Re-evaluate all ensayos that don't have an evaluation yet (pre-engine ensayos).
 * Updates cumple and resultado._evaluacion for each.
 * @returns {{ total, evaluated, skipped, errors }}
 */
const reevaluarEnsayosAntiguos = async (db, options = {}) => {
    const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');

    // Find ensayos to re-evaluate
    // Default: only NO_EVAL/null. With forzar=true: ALL active ensayos.
    const whereClause = { isActive: true };
    if (!options?.forzar) {
      whereClause[db.Sequelize.Op.or] = [
        { cumple: 'NO_EVAL' },
        { cumple: null },
      ];
    }
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: whereClause,
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
    });

    let evaluated = 0, skipped = 0, errors = 0;
    const details = [];

    for (const ensayo of ensayos) {
        try {
            const tipo = ensayo.tipo;
            if (!tipo?.codigo) { skipped++; continue; }

            let resultado = ensayo.resultado;
            if (typeof resultado === 'string') {
                try { resultado = JSON.parse(resultado); } catch { skipped++; continue; }
            }
            if (!resultado || typeof resultado !== 'object') { skipped++; continue; }

            // Determine tipoAgregado
            let tipoAg = null;
            if (tipo.aplicaA) {
                const arr = typeof tipo.aplicaA === 'string' ? JSON.parse(tipo.aplicaA) : tipo.aplicaA;
                if (Array.isArray(arr) && arr.length === 1) tipoAg = arr[0];
            }

            const evalResult = evaluarEnsayo(tipo.codigo, resultado, { tipoAgregado: tipoAg });
            if (evalResult.cumple && evalResult.cumple !== 'NO_EVAL') {
                // C6: persistir compliance canónico junto al shape legacy
                // (mismo criterio que createEnsayo / updateEnsayo).
                resultado._evaluacion = {
                    estado: evalResult.estado,
                    mensaje: evalResult.mensaje,
                    informativo: evalResult.informativo,
                    alerta: evalResult.alerta,
                    compliance: evalResult.compliance || null,
                };
                await ensayo.update({
                    cumple: evalResult.cumple,
                    resultado: typeof ensayo.resultado === 'string' ? JSON.stringify(resultado) : resultado,
                });
                evaluated++;
                details.push({ id: ensayo.id, codigo: tipo.codigo, cumple: evalResult.cumple });
            } else {
                skipped++;
            }
        } catch (e) {
            errors++;
            details.push({ id: ensayo.id, error: e.message });
        }
    }

    return { total: ensayos.length, evaluated, skipped, errors, details: details.slice(0, 50) };
};

/**
 * Registra un archivo PDF asociado a un ensayo. El caller (controller) ya
 * resolvió el filesystem (write a disco) y pasa la URL relativa donde se
 * puede acceder. Este service sólo persiste la fila.
 *
 * @param {object} db
 * @param {object} data — { idAgregadoEnsayo, nombreArchivo, url, mime }
 */
const crearArchivoEnsayo = async (db, { idAgregadoEnsayo, nombreArchivo, url, mime }) => {
    return db.AgregadoEnsayoArchivo.create({ idAgregadoEnsayo, nombreArchivo, url, mime });
};

/**
 * Devuelve el `AgregadoMeta` (subtipoMaterial, cantera, productor,
 * nroExpediente) de un agregado legacy, enriquecido con sus `aptitudes`
 * (campo del modelo Agregado). Si no hay meta cargada, devuelve un payload
 * de defaults vacíos. Auditoría 02-dosificación R17.
 *
 * @param {object} db
 * @param {number|string} legacyAgregadoId
 * @returns {Promise<object>}
 */
const getAgregadoMetaConAptitudes = async (db, legacyAgregadoId) => {
    let payload;
    const meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId } });
    if (!meta) {
        payload = {
            legacyAgregadoId: Number(legacyAgregadoId),
            subtipoMaterial: null,
            cantera: null,
            productor: null,
            nroExpediente: null,
        };
    } else {
        payload = meta.toJSON ? meta.toJSON() : meta;
    }

    // Enriquecer con aptitudes del Agregado legacy (PR6 multi-contexto).
    if (db.Agregado) {
        try {
            const ag = await db.Agregado.findByPk(legacyAgregadoId, { attributes: ['aptitudes'] });
            let apt = ag?.aptitudes ?? null;
            if (typeof apt === 'string') {
                try { apt = JSON.parse(apt); } catch { /* mantener string */ }
            }
            payload.aptitudes = apt;
        } catch { /* non-blocking */ }
    }
    return payload;
};

module.exports = {
    // Tipos
    getTipos,
    createTipo,
    updateTipo,
    deleteTipo,
    applyTemplate,
    // Ensayos
    getEnsayos,
    getEnsayo,
    getUltimoPorTipo,
    getVigenciaResumenPorAgregado,
    createEnsayo,
    updateEnsayo,
    deleteEnsayo,
    // Ensayo counts / browse by tipo
    getEnsayoCountsByTipo,
    getEnsayosByTipo,
    // Resumen
    getResumen,
    // Caracterización
    getCaracterizacion,
    // Sync derivados
    syncEnsayosDerivadosDesdeGranulometria,
    // Re-evaluación masiva
    reevaluarEnsayosAntiguos,
    // Helpers de contexto (PR2 multi-contexto)
    resolverContextoAplicacion,
    // Archivos adjuntos
    crearArchivoEnsayo,
    // Meta + aptitudes (R17)
    getAgregadoMetaConAptitudes,
    // Helpers internos expuestos solo para tests (X10 — auditoría 2026-05-08).
    // No usar desde código de producción; usar `autoEvaluarGranulometriaGrueso`.
    _findBandaGrueso,
    _parseTamizInferior,
    autoEvaluarGranulometriaGrueso,
};
