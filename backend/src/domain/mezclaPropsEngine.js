'use strict';

/**
 * mezclaPropsEngine.js
 *
 * Calculates combined physical/chemical properties for aggregate blends.
 * Properties are weighted averages of component aggregates' latest ensayo results.
 * Then evaluates the combined result against CIRSOC/IRAM normative limits.
 */

const { evaluarEnsayo, calcularSumaSustanciasNocivasAF, calcularSumaSustanciasNocivasAG, operadorPrefix, getOperador } = require('./ensayoEvalEngine');
const { getCanonicalCodigo } = require('./ensayoResultRegistry');

/**
 * Map of ensayo codes to the property fields they provide.
 * Each entry: { codes: [...], extract: (resultado) => { key: value, ... } }
 */
const PROPERTY_EXTRACTORS = [
    {
        name: 'Densidad y absorción (AF)',
        codes: ['IRAM1520_DENSIDAD_ABSORCION_FINO'],
        extract: (r) => ({
            densidadRelativaReal: r.densidadRelativaReal ?? null,
            densidadRelativaAparenteSeca: r.densidadRelativaAparenteSeca ?? null,
            densidadRelativaAparenteSSS: r.densidadRelativaAparenteSSS ?? null,
            absorcionPct: r.absorcionPct ?? null,
        }),
    },
    {
        name: 'Densidad y absorción (AG)',
        codes: ['IRAM1533_DENSIDAD_GRUESO'],
        extract: (r) => ({
            densidadRelativaReal: r.densidadRelativaReal ?? null,
            densidadRelativaAparenteSeca: r.densidadRelativaAparenteSeca ?? null,
            densidadRelativaAparenteSSS: r.densidadRelativaAparenteSSS ?? null,
            absorcionPct: r.absorcionPct ?? null,
        }),
    },
    {
        name: 'Pasante #200',
        codes: ['IRAM1674_MATERIAL_FINO_200'],
        extract: (r) => ({ pasa200Pct: r.pasa200Pct ?? r.valor ?? null }),
    },
    {
        name: 'Terrones de arcilla',
        codes: ['IRAM1647_TERRONES_ARCILLA'],
        extract: (r) => ({ terronesPct: r.valor ?? null, terronesOperador: getOperador(r) }),
    },
    {
        name: 'Sulfatos SO3',
        codes: ['IRAM1647_SULFATOS_SO3'],
        extract: (r) => ({ sulfatosPct: r.valor ?? null, sulfatosOperador: getOperador(r) }),
    },
    {
        name: 'Sales solubles',
        codes: ['IRAM1647_SALES_SOLUBLES'],
        extract: (r) => ({ salesSolublesPct: r.valor ?? null, salesOperador: getOperador(r) }),
    },
    {
        name: 'Cloruros solubles',
        codes: ['IRAM1882_CLORUROS_SOLUBLES'],
        extract: (r) => ({ clorurosPct: r.valor ?? null, clorurosOperador: getOperador(r) }),
    },
    {
        name: 'Materia orgánica',
        codes: ['IRAM1647_MATERIA_ORGANICA'],
        extract: (r) => ({ materiaOrganicaResultado: r.resultadoColorimetrico ?? null }),
    },
    {
        name: 'Materias carbonosas',
        codes: ['IRAM1647_MATERIAS_CARBONOSAS'],
        extract: (r) => ({ materiasCarbonosaPct: r.valor ?? null, materiasCarbonosasOperador: getOperador(r) }),
    },
    {
        name: 'Peso unitario',
        codes: ['IRAM1531_PESO_UNITARIO', 'IRAM1548_PESO_UNITARIO'],
        extract: (r) => ({ puc: r.puc ?? null, pus: r.pus ?? null }),
    },
    {
        name: 'Equivalente arena',
        codes: ['IRAM1882_VALOR_EQUIVALENTE_ARENA', 'IRAM1682_EQUIVALENTE_ARENA'],
        extract: (r) => ({ equivalenteArenaPct: r.equivalenteArenaPct ?? r.ea_promedio ?? r.valor ?? null }),
    },
    {
        name: 'Durabilidad Na2SO4',
        codes: ['IRAM1525_DURABILIDAD_SULFATO'],
        extract: (r) => ({ durabilidadPct: r.perdidaPct ?? r.valor ?? null }),
    },
    {
        name: 'Desgaste Los Ángeles',
        codes: ['IRAM1532_DESGASTE_LA', 'IRAM1532_LOS_ANGELES'],
        extract: (r) => ({ desgasteLAPct: r.losAngelesPct ?? r.perdidaPct ?? r.valor ?? null }),
    },
    {
        name: 'Lajosidad',
        codes: ['IRAM1687_1_LAJOSIDAD'],
        extract: (r) => ({ lajosidadPct: r.lajosidadPct ?? r.valor ?? null }),
    },
    {
        name: 'Elongación',
        codes: ['IRAM1687_2_ELONGACION'],
        extract: (r) => ({ elongacionPct: r.elongacionPct ?? r.valor ?? null }),
    },
];

// `fetchEnsayoResults` (acceso a Sequelize) vive en
// `services/mezclaPropsService.js` desde la auditoría 01-calidad Fase C R3
// (sesión 2026-05-07). El engine es puro y opera sobre el Map ya cargado
// por el service.

/**
 * Extract properties from ensayo results for a single aggregate.
 */
function extractProperties(resultsByCode) {
    const props = {};
    for (const ext of PROPERTY_EXTRACTORS) {
        for (const code of ext.codes) {
            const canonical = getCanonicalCodigo(code);
            const r = resultsByCode.get(canonical) || resultsByCode.get(code);
            if (r) {
                Object.assign(props, ext.extract(r));
                break;
            }
        }
    }
    return props;
}

/**
 * Calculate weighted average of a property across blend components.
 * @param {Array<{peso: number, valor: number|null}>} items
 * @returns {number|null}
 */
function weightedAverage(items) {
    let totalPeso = 0;
    let totalVal = 0;
    let allNull = true;
    for (const { peso, valor } of items) {
        if (valor == null) continue;
        allNull = false;
        totalPeso += peso;
        totalVal += peso * valor;
    }
    if (allNull || totalPeso === 0) return null;
    return Math.round((totalVal / totalPeso) * 1000) / 1000;
}

// `calcularPropiedadesCombinadas` (acceso a Sequelize via fetchEnsayoResults
// + db.AgregadoFino/Grueso.findByPk) vive en `services/mezclaPropsService.js`
// desde la auditoría 01-calidad Fase C R3 (sesión 2026-05-07).
// Los callers existentes (mezclaController, mezclaService,
// dosificacionDisenoService) ahora importan la función desde el service.

/**
 * Evaluate combined blend properties against CIRSOC/IRAM limits.
 * @param {object} combinadas - Combined property values
 * @param {string} tipoMezcla - 'FINO' | 'GRUESO' | 'TOTAL'
 * @param {Array} [componentes] - Per-component breakdown (required for TOTAL mixes)
 * @returns {Array|{fino: Array, grueso: Array, general: Array}} For FINO/GRUESO returns flat array; for TOTAL returns grouped object
 */
function evaluarPropiedadesCombinadas(combinadas, tipoMezcla, componentes, opciones = {}) {
    if (tipoMezcla === 'TOTAL' && componentes && componentes.length > 0) {
        return _evaluarTotal(combinadas, componentes, opciones);
    }

    // Original behavior for FINO / GRUESO
    return _evaluarSingleFraction(combinadas, tipoMezcla === 'FINO', componentes || [], opciones);
}

/**
 * Evaluate a single fraction (FINO or GRUESO) — original logic.
 */
function _evaluarSingleFraction(combinadas, esFino, componentes, opciones = {}) {
    const ctx = { tipoAgregado: esFino ? 'FINO' : 'GRUESO' };
    const expuestoDesgaste = opciones.expuestoDesgaste || false;
    const resultados = [];

    const add = (propiedad, unidad, codigo, resultado, especificacion, extra) => {
        const eval_ = evaluarEnsayo(codigo, resultado, ctx);
        const numVal = Object.values(resultado).find(v => v != null && typeof v === 'number') ?? null;
        const op = getOperador(resultado);
        resultados.push({
            propiedad,
            unidad,
            valor: numVal,
            operador: op,
            valorDisplay: null, // filled by _setValorDisplay
            estado: eval_.estado,
            cumple: eval_.cumple,
            mensaje: eval_.mensaje,
            especificacion,
            informativo: eval_.informativo || false,
            ...(extra || {}),
        });
    };

    // Pasante #200
    if (combinadas.pasa200Pct != null) {
        add('Pasante tamiz #200', '%', 'IRAM1674_MATERIAL_FINO_200',
            { pasa200Pct: combinadas.pasa200Pct, valor: combinadas.pasa200Pct },
            esFino ? '<= 3,0 / <= 5,0' : '<= 1,0 / <= 1,5');
    }

    // Terrones
    if (combinadas.terronesPct != null) {
        add('Terrones de arcilla', '%', 'IRAM1647_TERRONES_ARCILLA',
            { valor: combinadas.terronesPct, operador: combinadas.terronesOperador },
            esFino ? '<= 3,0' : '<= 2,0');
    }

    // Sulfatos
    if (combinadas.sulfatosPct != null) {
        add('Sulfatos (SO3)', '%', 'IRAM1647_SULFATOS_SO3',
            { valor: combinadas.sulfatosPct, operador: combinadas.sulfatosOperador },
            esFino ? '<= 0,1' : '<= 0,075');
    }

    // Sales solubles
    if (combinadas.salesSolublesPct != null) {
        add('Sales solubles', '%', 'IRAM1647_SALES_SOLUBLES',
            { valor: combinadas.salesSolublesPct, operador: combinadas.salesOperador },
            '<= 1,5');
    }

    // Cloruros
    if (combinadas.clorurosPct != null) {
        add('Cloruros solubles', '%', 'IRAM1882_CLORUROS_SOLUBLES',
            { valor: combinadas.clorurosPct, operador: combinadas.clorurosOperador },
            esFino ? '<= 0,04' : '<= 0,003');
    }

    // Materias carbonosas
    if (combinadas.materiasCarbonosaPct != null) {
        add('Materias carbonosas', '%', 'IRAM1647_MATERIAS_CARBONOSAS',
            { valor: combinadas.materiasCarbonosaPct, operador: combinadas.materiasCarbonosasOperador },
            '<= 0,5 / <= 1,0');
    }

    // Equivalente arena (solo fino)
    if (esFino && combinadas.equivalenteArenaPct != null) {
        add('Equivalente de arena', '%', 'IRAM1882_VALOR_EQUIVALENTE_ARENA',
            { equivalenteArenaPct: combinadas.equivalenteArenaPct },
            '>= 75');
    }

    // Materia orgánica (solo fino) — qualitative
    if (esFino && combinadas.materiaOrganicaResultado != null) {
        const moResultado = combinadas.materiaOrganicaResultado;
        const allMenor = !componentes.length || componentes.every(c =>
            !c.propiedades.materiaOrganicaResultado || c.propiedades.materiaOrganicaResultado === 'menor_500'
        );
        const cumple = allMenor || moResultado === 'menor_500';
        resultados.push({
            propiedad: 'Materia organica',
            unidad: 'mg/kg',
            valor: cumple ? '< 500 ppm' : '>= 500 ppm',
            valorDisplay: cumple ? '< 500 ppm' : '>= 500 ppm',
            estado: cumple ? 'CUMPLE' : 'NO_CUMPLE',
            cumple: cumple ? 'CUMPLE' : 'NO_CUMPLE',
            mensaje: cumple ? 'Materia organica < 500 ppm — CUMPLE.' : 'Materia organica >= 500 ppm',
            especificacion: '< 500',
            informativo: false,
        });
    }

    // Durabilidad
    if (combinadas.durabilidadPct != null) {
        add('Durabilidad Na2SO4', '%', 'IRAM1525_DURABILIDAD_SULFATO',
            { perdidaPct: combinadas.durabilidadPct, valor: combinadas.durabilidadPct },
            esFino ? '< 10 (C1/C2)' : '<= 12 (C1/C2)');
    }

    // Desgaste LA (solo grueso)
    if (!esFino && combinadas.desgasteLAPct != null) {
        add('Desgaste Los Angeles', '%', 'IRAM1532_DESGASTE_LA',
            { losAngelesPct: combinadas.desgasteLAPct, valor: combinadas.desgasteLAPct },
            '<= 50 / <= 30');
    }

    // Lajosidad (solo grueso)
    if (!esFino && combinadas.lajosidadPct != null) {
        add('Lajosidad', '%', 'IRAM1687_1_LAJOSIDAD',
            { lajosidadPct: combinadas.lajosidadPct },
            '<= 30 / <= 25 (H>=50)');
    }

    // Elongación (solo grueso)
    if (!esFino && combinadas.elongacionPct != null) {
        add('Elongacion', '%', 'IRAM1687_2_ELONGACION',
            { elongacionPct: combinadas.elongacionPct },
            '<= 45 / <= 40 (H>=50)');
    }

    // Densidades (informativo)
    if (combinadas.densidadRelativaAparenteSSS != null) {
        resultados.push({
            propiedad: 'Densidad SSS (d3)', unidad: 'g/cm3',
            valor: combinadas.densidadRelativaAparenteSSS,
            estado: 'CUMPLE', cumple: 'CUMPLE',
            mensaje: 'Informativo', especificacion: 'Sin req.',
            informativo: true,
        });
    }

    if (combinadas.absorcionPct != null) {
        resultados.push({
            propiedad: 'Absorcion', unidad: '%',
            valor: combinadas.absorcionPct,
            estado: 'CUMPLE', cumple: 'CUMPLE',
            mensaje: 'Informativo', especificacion: 'Sin req.',
            informativo: true,
        });
    }

    // Suma sustancias nocivas
    if (esFino) {
        const ensayosMap = {
            'IRAM1647_TERRONES_ARCILLA': { valor: combinadas.terronesPct },
            'IRAM1674_MATERIAL_FINO_200': { pasa200Pct: combinadas.pasa200Pct },
            'IRAM1647_MATERIAS_CARBONOSAS': { valor: combinadas.materiasCarbonosaPct },
            'IRAM1647_SULFATOS_SO3': { valor: combinadas.sulfatosPct },
            'IRAM1647_SALES_SOLUBLES': { valor: combinadas.salesSolublesPct },
            'IRAM1882_CLORUROS_SOLUBLES': { valor: combinadas.clorurosPct },
        };
        const suma = calcularSumaSustanciasNocivasAF(ensayosMap);
        if (suma.suma > 0) {
            // INC-1: When desgaste context is explicit (from dosificación), use only that limit.
            // When unknown (mezcla emitted standalone), show BOTH scenarios so the reader
            // can verify compliance against either limit depending on the future destination.
            const desgasteKnown = opciones && Object.prototype.hasOwnProperty.call(opciones, 'expuestoDesgaste');
            if (desgasteKnown) {
                const cumple = expuestoDesgaste ? suma.cumpleConDesgaste : suma.cumpleSinDesgaste;
                const limiteAplicado = expuestoDesgaste ? suma.limiteConDesgaste : suma.limiteSinDesgaste;
                const contexto = expuestoDesgaste ? 'con desgaste' : 'sin desgaste';
                resultados.push({
                    propiedad: 'Suma sustancias nocivas', unidad: '%',
                    valor: suma.suma,
                    estado: cumple ? 'CUMPLE' : 'NO_CUMPLE',
                    cumple: cumple ? 'CUMPLE' : 'NO_CUMPLE',
                    mensaje: `Suma: ${suma.suma}% (limite aplicado: ${limiteAplicado}% ${contexto})`,
                    especificacion: `<= ${limiteAplicado}% (${contexto})`,
                    informativo: false,
                    desglose: suma.detalle || null,
                });
            } else {
                // Standalone mezcla evaluation: report both limits.
                // B2/I1 fix: criteria alignment with the dosificación module.
                //   - CUMPLE: value meets the strict limit (con desgaste). Apt for any destination.
                //   - NO_CUMPLE: value exceeds the strict limit. This is a verified non-compliance
                //     for at least one possible destination (with wear exposure), so it cannot be
                //     reported as "cumple". If the lax limit is still met, flag "only for non-wear".
                //   - NO_CUMPLE: value exceeds even the lax limit. Apt for no destination.
                //   - NO_CONCLUYENTE is reserved for missing data / measurement uncertainty,
                //     NOT for dual-limit ambiguity.
                const sinDesgOk = suma.cumpleSinDesgaste;
                const conDesgOk = suma.cumpleConDesgaste;
                let estado, mensaje;
                if (conDesgOk) {
                    estado = 'CUMPLE';
                    mensaje = `Suma: ${suma.suma}% — Cumple ambos limites (${suma.limiteConDesgaste}% con desgaste / ${suma.limiteSinDesgaste}% sin desgaste). Apta para cualquier destino.`;
                } else if (sinDesgOk) {
                    estado = 'NO_CUMPLE';
                    mensaje = `Suma: ${suma.suma}% — NO cumple el limite de ${suma.limiteConDesgaste}% (con desgaste). Cumple solo para destinos SIN desgaste superficial (limite ${suma.limiteSinDesgaste}%). No apta para pavimentos u otros destinos con desgaste.`;
                } else {
                    estado = 'NO_CUMPLE';
                    mensaje = `Suma: ${suma.suma}% — NO cumple ningun limite (${suma.limiteConDesgaste}% / ${suma.limiteSinDesgaste}%). No apta para ningun destino.`;
                }
                resultados.push({
                    propiedad: 'Suma sustancias nocivas', unidad: '%',
                    valor: suma.suma,
                    estado,
                    cumple: estado,
                    mensaje,
                    especificacion: `<= ${suma.limiteConDesgaste}% (con desgaste) / <= ${suma.limiteSinDesgaste}% (sin desgaste)`,
                    informativo: false,
                    // M2: Breakdown of components for transparent traceability
                    desglose: suma.detalle || null,
                });
            }
        }
    } else {
        const ensayosMap = {
            'IRAM1647_TERRONES_ARCILLA': { valor: combinadas.terronesPct },
            'IRAM1674_MATERIAL_FINO_200': { pasa200Pct: combinadas.pasa200Pct },
            'IRAM1647_MATERIAS_CARBONOSAS': { valor: combinadas.materiasCarbonosaPct },
            'IRAM1647_SULFATOS_SO3': { valor: combinadas.sulfatosPct },
            'IRAM1647_SALES_SOLUBLES': { valor: combinadas.salesSolublesPct },
            'IRAM1882_CLORUROS_SOLUBLES': { valor: combinadas.clorurosPct },
        };
        const suma = calcularSumaSustanciasNocivasAG(ensayosMap);
        if (suma.suma > 0) {
            resultados.push({
                propiedad: 'Suma sustancias nocivas', unidad: '%',
                valor: suma.suma,
                estado: suma.cumple ? 'CUMPLE' : 'NO_CUMPLE',
                cumple: suma.cumple ? 'CUMPLE' : 'NO_CUMPLE',
                mensaje: `Suma: ${suma.suma}% (lim. ${suma.limite}%)`,
                especificacion: '<= 5,0',
                informativo: false,
            });
        }
    }

    // Set valorDisplay
    _setValorDisplay(resultados);

    return resultados;
}

/**
 * For TOTAL mixes: separate components into fino/grueso fractions,
 * calculate weighted averages per fraction, evaluate each against its own limits.
 */
function _evaluarTotal(combinadas, componentes, opciones = {}) {
    const finos = componentes.filter(c => c.tipoAgregado && c.tipoAgregado.toUpperCase() === 'FINO');
    const gruesos = componentes.filter(c => c.tipoAgregado && c.tipoAgregado.toUpperCase() === 'GRUESO');

    // Properties that are non-extrapolable (worst-case per component, not averaged)
    const GRUESO_POR_COMPONENTE = ['lajosidadPct', 'elongacionPct', 'desgasteLAPct', 'puc', 'pus', 'durabilidadPct'];
    const FINO_POR_COMPONENTE = ['equivalenteArenaPct'];

    // Calculate weighted averages for each fraction
    const numericProps = [
        'densidadRelativaReal', 'densidadRelativaAparenteSeca', 'densidadRelativaAparenteSSS',
        'absorcionPct', 'pasa200Pct', 'terronesPct', 'sulfatosPct', 'salesSolublesPct',
        'clorurosPct', 'materiasCarbonosaPct', 'puc', 'pus', 'equivalenteArenaPct',
        'durabilidadPct', 'desgasteLAPct', 'lajosidadPct', 'elongacionPct',
    ];

    const calcFraction = (comps) => {
        const result = {};
        for (const prop of numericProps) {
            const items = comps.map(c => ({ peso: c.peso, valor: c.propiedades[prop] ?? null }));
            result[prop] = weightedAverage(items);
        }
        result.clorurosEsMenorQue = comps.some(c => c.propiedades.clorurosEsMenorQue);
        result.sulfatosEsMenorQue = comps.some(c => c.propiedades.sulfatosEsMenorQue);
        result.salesEsMenorQue = comps.some(c => c.propiedades.salesEsMenorQue);
        result.terronesEsMenorQue = comps.some(c => c.propiedades.terronesEsMenorQue);
        // Materia orgánica
        const moValues = comps.map(c => c.propiedades.materiaOrganicaResultado).filter(Boolean);
        if (moValues.length > 0) {
            result.materiaOrganicaResultado = moValues.includes('igual_o_mayor_500') ? 'igual_o_mayor_500' : 'menor_500';
        }
        return result;
    };

    const combinadasFino = finos.length > 0 ? calcFraction(finos) : null;
    const combinadasGrueso = gruesos.length > 0 ? calcFraction(gruesos) : null;

    // Properties to move from fraction results to general (informativo)
    const GENERAL_PROPS = ['Densidad SSS (d3)', 'Absorcion'];

    // Build fino results
    const fino = [];
    if (combinadasFino) {
        const finoResults = _evaluarSingleFraction(combinadasFino, true, finos, opciones);
        // Mark non-extrapolable fino properties with worst-case info
        for (const r of finoResults) {
            for (const propKey of FINO_POR_COMPONENTE) {
                const propName = _propKeyToName(propKey);
                if (r.propiedad === propName) {
                    const worstCase = _worstCase(finos, propKey, true);
                    if (worstCase) {
                        r.porComponente = true;
                        const base = (r.mensaje || '').replace(/\.+$/, '');
                        r.mensaje = `${base}. Peor caso: ${worstCase.nombre || ('Componente fino #' + worstCase.idAgregado)} (${worstCase.valor}%)`;
                        r.componentesDetalle = _componenteValues(finos, propKey);
                    }
                }
            }
        }
        // Filter out general properties (densidad, absorcion) — they go to general
        fino.push(...finoResults.filter(r => !GENERAL_PROPS.includes(r.propiedad)));
    }

    // Build grueso results
    const grueso = [];
    if (combinadasGrueso) {
        const gruesoResults = _evaluarSingleFraction(combinadasGrueso, false, gruesos, opciones);
        // Mark non-extrapolable grueso properties with worst-case info
        for (const r of gruesoResults) {
            for (const propKey of GRUESO_POR_COMPONENTE) {
                const propName = _propKeyToName(propKey);
                if (r.propiedad === propName) {
                    const isLowerBetter = propKey === 'puc' || propKey === 'pus'; // informativo, skip worst-case
                    if (isLowerBetter) continue;
                    const worstCase = _worstCase(gruesos, propKey, false);
                    if (worstCase) {
                        r.porComponente = true;
                        const base = (r.mensaje || '').replace(/\.+$/, '');
                        r.mensaje = `${base}. Peor caso: ${worstCase.nombre || ('Componente grueso #' + worstCase.idAgregado)} (${worstCase.valor}%)`;
                        r.componentesDetalle = _componenteValues(gruesos, propKey);
                    }
                }
            }
        }
        // Filter out general properties (densidad, absorcion) — they go to general
        grueso.push(...gruesoResults.filter(r => !GENERAL_PROPS.includes(r.propiedad)));
    }

    // General: densidades and absorción from the overall combinadas (all components)
    const general = [];
    if (combinadas.densidadRelativaAparenteSSS != null) {
        general.push({
            propiedad: 'Densidad SSS (d3)', unidad: 'g/cm3',
            valor: combinadas.densidadRelativaAparenteSSS,
            estado: 'CUMPLE', cumple: 'CUMPLE',
            mensaje: 'Informativo — promedio ponderado total', especificacion: 'Sin req.',
            informativo: true,
        });
    }
    if (combinadas.absorcionPct != null) {
        general.push({
            propiedad: 'Absorcion', unidad: '%',
            valor: combinadas.absorcionPct,
            estado: 'CUMPLE', cumple: 'CUMPLE',
            mensaje: 'Informativo — promedio ponderado total', especificacion: 'Sin req.',
            informativo: true,
        });
    }
    _setValorDisplay(general);

    return { fino, grueso, general };
}

/**
 * Find the worst-case component for a property.
 * @param {Array} comps - Components
 * @param {string} propKey - Property key
 * @param {boolean} lowerIsWorse - If true, lowest value is worst (e.g., equivalenteArenaPct)
 */
function _worstCase(comps, propKey, lowerIsWorse) {
    let worst = null;
    for (const c of comps) {
        const val = c.propiedades[propKey];
        if (val == null) continue;
        if (!worst || (lowerIsWorse ? val < worst.valor : val > worst.valor)) {
            worst = { idAgregado: c.idAgregado, nombre: c.nombre, valor: Math.round(val * 10) / 10 };
        }
    }
    return worst;
}

/**
 * Get all component values for a property (for detail display).
 */
function _componenteValues(comps, propKey) {
    return comps
        .filter(c => c.propiedades[propKey] != null)
        .map(c => ({
            idAgregado: c.idAgregado,
            nombre: c.nombre,
            valor: Math.round(c.propiedades[propKey] * 10) / 10,
        }));
}

/**
 * Map property keys to display names used in the evaluation results.
 */
function _propKeyToName(propKey) {
    const map = {
        lajosidadPct: 'Lajosidad',
        elongacionPct: 'Elongacion',
        desgasteLAPct: 'Desgaste Los Angeles',
        puc: 'PUC',
        pus: 'PUS',
        durabilidadPct: 'Durabilidad Na2SO4',
        equivalenteArenaPct: 'Equivalente de arena',
    };
    return map[propKey] || propKey;
}

/**
 * Set valorDisplay on result rows.
 */
function _setValorDisplay(resultados) {
    for (const r of resultados) {
        if (r.valor != null && r.valorDisplay == null) {
            const numStr = typeof r.valor === 'number' ? (r.valor < 1 ? r.valor.toFixed(3) : r.valor.toFixed(1)) : String(r.valor);
            const prefix = operadorPrefix(r.operador);
            const suffix = r.unidad && r.unidad !== '-' ? ` ${r.unidad}` : '';
            r.valorDisplay = `${prefix}${numStr}${suffix}`;
        }
    }
}

module.exports = { evaluarPropiedadesCombinadas, extractProperties, weightedAverage };
