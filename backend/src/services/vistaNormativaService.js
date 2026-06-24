'use strict';

/**
 * vistaNormativaService.js  (PR4)
 *
 * Construye una "Vista normativa CIRSOC" del agregado: ejecuta el motor de
 * aptitud (`verificarAptitudA[FG]`) **sin aplicar la política del catálogo
 * del tenant**. Su objetivo es exponer al usuario qué exige la norma
 * completa, independiente de los flags `obligatorio[contexto]` /
 * `nivelCaracterizacion[contexto]` que el tecnólogo haya configurado.
 *
 * Caso de uso: panel adicional en la ficha técnica del agregado, para
 * auditoría / supervisión / comparación. NO se usa para decidir aptitud
 * operativa — esa decisión sigue corriendo por `getResumen` (que sí aplica
 * política).
 *
 * El contexto por defecto se elige como "exigente" (clase C2, alta
 * resistencia, expuesto a desgaste, aspecto importante) para activar todos
 * los límites estrictos que CIRSOC contempla. El caller puede sobreescribir
 * cada flag en `opts` si quiere ver cómo cambiaría el veredicto bajo otro
 * contexto.
 */

const { verificarAptitudAF, verificarAptitudAG } = require('../domain/dosificacion/aptitudMaterialesService');

const FINO_SUBTIPOS = new Set(['ARENA_NATURAL', 'ARENA_TRITURACION', 'MEZCLA']);

// Códigos canónicos que el motor de aptitud entiende, mapeados al key del
// ensayoMap. Espejo de CODE_MAP* en dosificacionDisenoService.js — la
// duplicación queda documentada para extraer a un helper común en PR5.
const CODE_MAP_AF = {
    'IRAM1647_TERRONES_ARCILLA':   'terronesArcilla',
    'IRAM1674_MATERIAL_FINO_200':  'pasante200',
    'IRAM1540_PASA200':            'pasante200',
    'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
    'IRAM1647_SULFATOS_SO3':       'sulfatos',
    'IRAM1647_SALES_SOLUBLES':     'salesSolubles',
    'IRAM1882_CLORUROS_SOLUBLES':  'cloruros',
    'IRAM1647_MATERIA_ORGANICA':   'materiaOrganica',
};
const CODE_MAP_AG = {
    'IRAM1647_TERRONES_ARCILLA':   'terronesArcilla',
    'IRAM1674_MATERIAL_FINO_200':  'pasante200',
    'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
    'IRAM1647_SULFATOS_SO3':       'sulfatos',
    'IRAM1647_SALES_SOLUBLES':     'salesSolubles',
    'IRAM1882_CLORUROS_SOLUBLES':  'cloruros',
    'IRAM1687_1_LAJOSIDAD':        'lajosidad',
    'IRAM1687_2_ELONGACION':       'elongacion',
    'IRAM1532_DESGASTE_LA':        'desgasteLA',
    'IRAM1532_LOS_ANGELES':        'desgasteLA',
    'IRAM1525_DURABILIDAD_SULFATO': 'durabilidad',
    'IRAM1533_DENSIDAD_GRUESO':    'absorcion',
};

function _safeParse(r) {
    if (typeof r === 'string') {
        try { return JSON.parse(r) || {}; } catch { return {}; }
    }
    return r || {};
}

/**
 * @param {object} db - Sequelize db (multi-tenant)
 * @param {number} legacyAgregadoId
 * @param {object} [opts] - overrides del contexto. Defaults: contexto exigente.
 *   - expuestoDesgaste (default: true)
 *   - aspectoSuperficialImportante (default: true)
 *   - tipoArmadura (default: 'armado')
 *   - claseExposicion (default: 'C2')
 *   - fc (default: 50)
 *   - subtipoOverride: forzar 'FINO' o 'GRUESO' si AgregadoMeta no resuelve
 * @returns {object} { legacyAgregadoId, tipoAgregado, contexto, verificacion, nota }
 */
const getVistaNormativaCirsoc = async (db, legacyAgregadoId, opts = {}) => {
    if (!legacyAgregadoId) {
        throw Object.assign(new Error('legacyAgregadoId es requerido'), { statusCode: 400 });
    }

    // 1. Determinar tipo de agregado (FINO / GRUESO) desde AgregadoMeta.
    let subtipoMaterial = null;
    if (db.AgregadoMeta) {
        try {
            const meta = await db.AgregadoMeta.findOne({
                where: { legacyAgregadoId: Number(legacyAgregadoId) },
                attributes: ['subtipoMaterial'],
                raw: true,
            });
            subtipoMaterial = meta?.subtipoMaterial || null;
        } catch { /* no-op */ }
    }
    const subtipoEffective = (opts.subtipoOverride || subtipoMaterial || '').toUpperCase();
    const esFino = subtipoOverrideToBool(subtipoEffective);

    // 2. Cargar ensayos activos del agregado.
    const { getCanonicalCodigo } = require('../domain/ensayoResultRegistry');
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: { legacyAgregadoId, isActive: true },
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
        order: [['fechaEnsayo', 'DESC']],
    });

    // 3. Armar ensayoMap canónico — último ensayo cargado por mapKey.
    const CODE_MAP = esFino ? CODE_MAP_AF : CODE_MAP_AG;
    const ensayoMap = {};
    for (const e of ensayos) {
        const codigo = getCanonicalCodigo(e.tipo?.codigo || '');
        const mapKey = CODE_MAP[codigo];
        if (mapKey && !ensayoMap[mapKey]) {
            const r = _safeParse(e.resultado);
            ensayoMap[mapKey] = {
                valor: r.valor
                    ?? r.terronesPct ?? r.pasa200Pct ?? r.materiasCarbonosaPct
                    ?? r.salesSolublesPct ?? r.sulfatosSO3Pct
                    ?? r.lajosidadPct ?? r.elongacionPct
                    ?? r.losAngelesPct ?? r.perdidaPct ?? r.absorcionPct
                    ?? null,
                fecha: e.fechaEnsayo,
                informe: e.nroInforme,
                operador: r.operador || (r.esMenorQue ? 'menor_que' : null),
                resultadoColorimetrico: r.resultadoColorimetrico || null,
                excepcionValida: r.excepcionValida || false,
                excepcionPct: r.excepcionPct || null,
            };
        }
    }

    // 4. Contexto exigente por default: expone todos los límites estrictos.
    const ctx = {
        expuestoDesgaste:               opts.expuestoDesgaste !== undefined ? !!opts.expuestoDesgaste : true,
        aspectoSuperficialImportante:   opts.aspectoSuperficialImportante !== undefined ? !!opts.aspectoSuperficialImportante : true,
        tipoArmadura:                   opts.tipoArmadura || 'armado',
        subtipoMaterial:                subtipoEffective || null,
        claseExposicion:                opts.claseExposicion || 'C2',
        fc:                             opts.fc !== undefined ? Number(opts.fc) : 50,
    };

    // 5. Ejecutar motor SIN aplicar política. La verificación devuelta
    //    refleja exactamente lo que CIRSOC exige al agregado.
    const verificacion = esFino
        ? verificarAptitudAF(ctx, ensayoMap)
        : verificarAptitudAG(ctx, ensayoMap);

    return {
        legacyAgregadoId: Number(legacyAgregadoId),
        tipoAgregado: esFino ? 'FINO' : 'GRUESO',
        contexto: ctx,
        verificacion,
        nota: 'Vista normativa CIRSOC: refleja la exigencia completa de la norma, ' +
              'independiente de la política del catálogo del tenant (obligatorio/nivel). ' +
              'Útil para auditoría y supervisión externa.',
    };
};

function subtipoOverrideToBool(subtipo) {
    return FINO_SUBTIPOS.has(subtipo);
}

module.exports = {
    getVistaNormativaCirsoc,
};
