'use strict';

/**
 * aptitudPolicyHelper.js
 *
 * Post-procesamiento de la verificación de aptitud para aplicar la política
 * del catálogo de ensayos del tenant (PR1 multi-contexto:
 * `nivelCaracterizacion[Hormigón|TBS]` + `obligatorio[Hormigón|TBS]`).
 *
 * El motor `aptitudMaterialesService.verificarAptitudA[FG]` evalúa todas las
 * sustancias de Tabla 3.4 / 3.6 contra los límites CIRSOC. Esta capa
 * post-procesa los items según la decisión del tecnólogo del tenant:
 *
 *   1. `nivelCaracterizacion[contexto] = 'NINGUNA'` y el item NO tiene
 *      resultado real (`estado = 'sin_dato'`):
 *      → se filtra del resultado (el tecnólogo no requiere caracterizar
 *        ese parámetro y el laboratorio no lo cargó).
 *
 *   2. `nivelCaracterizacion[contexto] = 'NINGUNA'` PERO el item TIENE
 *      resultado real (cumple / no_cumple / etc.):
 *      → se PRESERVA (no se oculta). El ensayo cargado sigue visible.
 *        Si además `obligatorio[contexto] = false`, se baja a 'informativo'
 *        (regla 3); si no, mantiene su estado tal cual lo evaluó el motor.
 *      Razón normativa: un ensayo realizado y cargado no puede desaparecer
 *      del informe por cambiar un flag de catálogo. La trazabilidad de la
 *      medición prevalece sobre la política administrativa.
 *
 *   3. `obligatorio[contexto] = false` y el item resultó `'no_cumple'`:
 *      → se baja a `'informativo'` con flag `_wasFailNonMandatory`. Sigue
 *        visible en la ficha pero NO bloquea el veredicto global.
 *
 *   4. Si tras aplicar la política `itemsAjustados.length === 0`:
 *      → `resultadoGlobal = 'aptitud_no_determinada'`. El sistema NO
 *        afirma "cumple" — declara explícitamente que no se evaluó aptitud
 *        bajo esta política. Estado neutro, ni aprueba ni bloquea.
 *
 * `resultadoGlobal`, `conditions` y `compliance` global se recalculan
 * desde los items ajustados, reusando los helpers exportados por el
 * propio `aptitudMaterialesService`.
 *
 * Pureza: este módulo es puro (sin DB, sin HTTP, sin Sequelize). El caller
 * (service) carga la política desde el catálogo y se la pasa.
 *
 * Pendientes documentados para iteraciones futuras (no en este PR):
 *   - Vista normativa completa CIRSOC: panel adicional que expone qué
 *     ensayos requeridos por la norma faltan o están fuera, independiente
 *     de la política del catálogo del tenant. Para auditoría / supervisión.
 *   - Whitelist de "ensayos funcionales" (densidad, granulometría, absorción)
 *     en el motor de cálculo de dosificación: estos son inputs matemáticos
 *     y su ausencia debe bloquear el cálculo, no solo la aptitud.
 *   - Trazabilidad activa: alerta tipo 'RESCATE_POR_POLITICA' cuando un
 *     `no_cumple` se baja a informativo por `obligatorio=false`, para que
 *     aparezca en el panel del jefe técnico.
 */

const aptitudSvc = require('./aptitudMaterialesService');

/**
 * Aplica la política del catálogo a una verificación previamente generada por
 * `verificarAptitudAF/AG`.
 *
 * @param {object} verificacion - output de verificarAptitudAF/AG
 * @param {object} politica - mapa { ensayoCodigo: { nivel, obligatorio } }
 *   - `nivel`: 'NINGUNA' | 'BASICA' | 'AVANZADA' (del contexto resuelto)
 *   - `obligatorio`: boolean (del contexto resuelto)
 *   Si un ensayoCodigo no está en la política, el item se conserva sin cambios
 *   (política "permisiva por defecto" — útil para ensayos no presentes en el
 *   catálogo del tenant).
 * @param {object} ctx - mismo ctx pasado al engine, necesario para reconstruir
 *   compliance per-item (usageContext + materialContext).
 * @returns {object} verificación nueva con items ajustados, resultadoGlobal /
 *   conditions / compliance recalculados.
 */
function aplicarPoliticaCaracterizacion(verificacion, politica = {}, ctx = {}) {
    if (!verificacion || !Array.isArray(verificacion.items)) return verificacion;

    const usageContext = aptitudSvc.ctxToUsageContext(ctx);
    const materialContext = ctx.materialContext || {};

    // 1. Filtrar SOLO items con nivel='NINGUNA' que NO tienen resultado real
    //    (estado='sin_dato'). Items cargados por el laboratorio NUNCA desaparecen
    //    de la verificación — su trazabilidad prevalece sobre la política.
    // 2. Para items que se preservan: si obligatorio=false y estado='no_cumple',
    //    se baja a 'informativo'.
    const itemsAjustados = verificacion.items
        .filter(item => {
            const pol = politica[item.ensayoCodigo];
            if (!pol) return true;                       // sin política → conservar
            if (pol.nivel !== 'NINGUNA') return true;    // nivel BASICA/AVANZADA → conservar
            // pol.nivel === 'NINGUNA': solo filtrar si el laboratorio NO cargó nada.
            return item.estado !== 'sin_dato';
        })
        .map(item => {
            const pol = politica[item.ensayoCodigo];
            if (pol && pol.obligatorio === false && item.estado === 'no_cumple') {
                const detallePrev = item.detalle ? ` ${item.detalle}` : '';
                const ajustado = {
                    ...item,
                    estado: 'informativo',
                    _wasFailNonMandatory: true,
                    _originalEstado: 'no_cumple',
                    detalle: `[Informativo - ensayo no obligatorio en este contexto]${detallePrev}`,
                };
                ajustado.compliance = aptitudSvc.buildItemCompliance(ajustado, usageContext, materialContext);
                return ajustado;
            }
            return item;
        });

    // 3. Recalcular resultadoGlobal a partir de los estados sobrevivientes.
    const estados = itemsAjustados.map(i => i.estado);
    let resultadoGlobal;
    if (estados.length === 0) {
        // Política filtró TODO. El sistema NO afirma "cumple" — declara aptitud
        // no determinada. Estado neutro: ni aprueba ni bloquea. La decisión de
        // operar queda en el tecnólogo, que tiene visibilidad de qué pasó.
        resultadoGlobal = 'aptitud_no_determinada';
    } else if (estados.some(e => e === 'no_cumple')) {
        resultadoGlobal = 'no_cumple';
    } else if (estados.some(e => e === 'sin_dato')) {
        resultadoGlobal = 'incompleto';
    } else if (estados.some(e => e === 'cumple_condicional')) {
        resultadoGlobal = 'cumple_condicional';
    } else if (estados.some(e => e === 'atencion' || e === 'cumple_con_atencion')) {
        resultadoGlobal = 'cumple_con_atencion';
    } else {
        resultadoGlobal = 'cumple';
    }

    // 4. Recolectar conditions de items sobrevivientes.
    const allConditions = itemsAjustados
        .filter(i => i.conditions && i.conditions.length > 0)
        .flatMap(i => i.conditions);

    // 5. Reconstruir compliance global con el helper canónico del engine.
    //    El helper no conoce 'aptitud_no_determinada'; lo mapeamos a notEvaluated
    //    con un mensaje específico que el frontend puede detectar y rotular.
    let compliance;
    if (resultadoGlobal === 'aptitud_no_determinada') {
        const { Compliance } = require('../compliance');
        compliance = Compliance.notEvaluated({
            reason: 'Aptitud no determinada — la política del catálogo no requiere evaluar parámetros para este contexto.',
            norm: verificacion.normaRef,
        });
    } else {
        compliance = aptitudSvc.buildAptitudGlobalCompliance(
            resultadoGlobal,
            itemsAjustados,
            allConditions,
            verificacion.normaRef,
            verificacion.notas || []
        );
    }

    return {
        ...verificacion,
        items: itemsAjustados,
        resultadoGlobal,
        conditions: allConditions,
        compliance,
    };
}

/**
 * Construye la política de catálogo para el contexto del agregado a partir de
 * los tipos del catálogo. Helper de conveniencia para callers que ya tienen
 * los tipos cargados (no consulta DB).
 *
 * @param {Array} tipos - lista de AgregadoEnsayoTipo (POJOs o instances)
 *   Debe traer al menos: codigo, nivelCaracterizacionHormigon, nivelCaracterizacionTBS,
 *   obligatorioHormigon, obligatorioTBS, aplicaAHormigon, aplicaATBS.
 * @param {string} contextoAgregado - 'HORMIGON' | 'TBS' | 'AMBOS'
 * @returns {object} politica { ensayoCodigo: { nivel, obligatorio } }
 *
 * Para 'AMBOS': se toma el contexto MÁS exigente por ensayo (máximo nivel,
 * OR de obligatoriedad). Esto refleja que un agregado declarado para los dos
 * usos debe satisfacer las exigencias combinadas.
 */
function construirPoliticaParaContexto(tipos, contextoAgregado) {
    const politica = {};
    // Ranking por VINCULATORIEDAD (no por "profundidad de caracterización"):
    //   - BASICA  fuerza obligatorio = true en el modelo (más vinculante)
    //   - AVANZADA permite obligatorio configurable (menos vinculante)
    //   - NINGUNA  no aparece en la ficha (0)
    // La regla "más exigente" para AMBOS toma el valor MÁS vinculante entre
    // Hormigón y TBS. Es lo que queremos: si Hormigón=BASICA y TBS=AVANZADA,
    // el agregado declarado AMBOS debe satisfacer la exigencia más fuerte.
    // Naming: "BASICA" no significa "menos exigente" — significa "caracterización
    // mínima requerida" (debe estar siempre).
    const NIVEL_RANK = { NINGUNA: 0, AVANZADA: 1, BASICA: 2 };
    const usaHormigon = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
    const usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';

    for (const t of tipos) {
        if (!t || !t.codigo) continue;

        let nivel = 'NINGUNA';
        let obligatorio = false;

        if (usaHormigon && t.aplicaAHormigon) {
            nivel = t.nivelCaracterizacionHormigon || 'NINGUNA';
            obligatorio = !!t.obligatorioHormigon;
        }
        if (usaTBS && t.aplicaATBS) {
            const nivelTBS = t.nivelCaracterizacionTBS || 'NINGUNA';
            const oblTBS = !!t.obligatorioTBS;
            // Para 'AMBOS': tomar el más exigente.
            if ((NIVEL_RANK[nivelTBS] || 0) > (NIVEL_RANK[nivel] || 0)) nivel = nivelTBS;
            obligatorio = obligatorio || oblTBS;
        }

        politica[t.codigo] = { nivel, obligatorio };
    }
    return politica;
}

/**
 * Variante para items con `compliance` canónico (shape de `getResumen`),
 * donde cada item tiene `{ key, parametro, compliance: ComplianceResult, ... }`.
 *
 * Aplica la misma política que `aplicarPoliticaCaracterizacion`, pero opera
 * sobre la representación canónica usada en la ficha técnica del agregado.
 * NO recalcula `compliance` global — el caller llama después a
 * `calcularVeredictoGlobal` con los items ajustados.
 *
 * Reglas (espejo de la otra variante):
 *
 *   1. `nivel = 'NINGUNA'` y compliance.status NO refleja resultado real
 *      (`pending`, `notEvaluated`, `notApplicable`):
 *      → se filtra del resultado.
 *
 *   2. `nivel = 'NINGUNA'` PERO compliance.status SÍ refleja resultado real
 *      (`pass`, `fail`, `passWithObservations`, `conditionalPass`, `inconclusive`,
 *      `informative`, `expired`):
 *      → se PRESERVA. Si además `obligatorio = false` y status='fail', se baja
 *        a `informative` (regla 3).
 *
 *   3. `obligatorio = false` y compliance.status = 'fail':
 *      → se baja a `informative` con flag `_wasFailNonMandatory` y
 *        `_originalCompliance` para trazabilidad.
 *
 * @param {Array} items - items con `{ key, parametro, compliance, ... }`
 * @param {object} politica - mapa { codigo: { nivel, obligatorio } }
 * @returns {{ items: Array, aptitudNoDeterminada: boolean }}
 *   - items: lista filtrada/ajustada
 *   - aptitudNoDeterminada: true si tras aplicar política no quedó ningún
 *     item visible (todos filtrados o degradados a informative). El caller
 *     debe materializar esto en el veredicto global como notEvaluated con
 *     reason específico.
 */
function aplicarPoliticaAItemsCompliance(items, politica = {}) {
    if (!Array.isArray(items)) return { items: items, aptitudNoDeterminada: false };

    // Estados que reflejan "no hay dato real cargado" — pueden filtrarse si
    // la política dice que no interesa.
    const ESTADOS_SIN_DATO = new Set(['pending', 'notEvaluated', 'notApplicable']);
    // Estados que cuentan como "visibles" para `calcularVeredictoGlobal`.
    // (Mismo criterio que el filtro `visible` en veredicto.js:88-90: descarta
    // informative y notApplicable.)
    const ESTADOS_INVISIBLES = new Set(['informative', 'notApplicable']);

    const ajustados = items
        .filter(item => {
            const pol = politica[item.key];
            if (!pol) return true;
            if (pol.nivel !== 'NINGUNA') return true;
            const status = item.compliance?.status;
            if (!status) return true;
            // NINGUNA + sin dato → filtrar. NINGUNA + con dato → preservar.
            return !ESTADOS_SIN_DATO.has(status);
        })
        .map(item => {
            const pol = politica[item.key];
            const status = item.compliance?.status;
            if (pol && pol.obligatorio === false && status === 'fail') {
                const { Compliance } = require('../compliance');
                const norm = item.compliance?.norm || null;
                return {
                    ...item,
                    _wasFailNonMandatory: true,
                    _originalCompliance: item.compliance,
                    compliance: Compliance.informative({
                        message: '[Informativo - ensayo no obligatorio en este contexto]',
                        norm,
                    }),
                };
            }
            return item;
        });

    // Detectar "aptitud no determinada": ningún item visible quedó.
    const visibles = ajustados.filter(it => {
        const s = it.compliance?.status;
        return s && !ESTADOS_INVISIBLES.has(s);
    });
    const aptitudNoDeterminada = visibles.length === 0;

    return { items: ajustados, aptitudNoDeterminada };
}

module.exports = {
    aplicarPoliticaCaracterizacion,
    aplicarPoliticaAItemsCompliance,
    construirPoliticaParaContexto,
};
