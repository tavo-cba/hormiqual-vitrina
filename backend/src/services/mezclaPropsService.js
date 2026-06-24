'use strict';

/**
 * mezclaPropsService.js
 *
 * Acceso a DB para el engine `domain/mezclaPropsEngine`. Este service
 * resuelve los lookups Sequelize y entrega objetos planos a las funciones
 * puras del engine.
 *
 * Migrado desde `domain/mezclaPropsEngine.js` en la auditoría 01-calidad
 * Fase C R3 (sesión 2026-05-07): el engine queda con cálculos puros
 * (`extractProperties`, `weightedAverage`, `evaluarPropiedadesCombinadas`,
 * `_evaluarTotal`, etc.) y este service centraliza el acceso a DB.
 *
 * Para preservar back-compat con los callers existentes
 * (`mezclaController.js`, `mezclaService.js`, `dosificacionDisenoService.js`)
 * el engine sigue exportando `calcularPropiedadesCombinadas` y
 * `fetchEnsayoResults` vía re-export desde este module.
 */

const { extractProperties, weightedAverage } = require('../domain/mezclaPropsEngine');
const { getCanonicalCodigo } = require('../domain/ensayoResultRegistry');

/**
 * Fetch latest ensayo results for an aggregate, organized by canonical code.
 * @param {object} db - Sequelize database instance
 * @param {number} idAgregado - Legacy aggregate ID
 * @returns {Map<string, object>} Map of canonicalCode → resultado
 */
async function fetchEnsayoResults(db, idAgregado) {
    const ensayos = await db.AgregadoEnsayo.findAll({
        where: { legacyAgregadoId: idAgregado, isActive: true },
        include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
        order: [['fechaEnsayo', 'DESC']],
    });

    // Keep only the latest per tipo
    const byTipo = new Map();
    for (const e of ensayos) {
        const cod = e.tipo?.codigo;
        if (!cod) continue;
        const canonical = getCanonicalCodigo(cod);
        if (!byTipo.has(canonical)) {
            let r = e.resultado;
            if (typeof r === 'string') try { r = JSON.parse(r); } catch { r = null; }
            if (r) byTipo.set(canonical, r);
        }
    }
    return byTipo;
}

/**
 * Calculate combined properties for a blend.
 * @param {object} db - Sequelize database instance
 * @param {Array<{idAgregado: number, porcentaje: number}>} items - Blend components
 * @returns {object} Combined properties + per-component breakdown
 */
async function calcularPropiedadesCombinadas(db, items) {
    if (!items || items.length === 0) return { combinadas: {}, componentes: [], errores: [] };

    const componentes = [];
    const errores = [];

    // Fetch properties for each component
    for (const item of items) {
        try {
            const resultsByCode = await fetchEnsayoResults(db, item.idAgregado);
            const props = extractProperties(resultsByCode);

            // Determine tipoAgregado from item or DB lookup
            let tipoAg = item.tipoAgregado || null;
            if (!tipoAg && db.AgregadoFino && db.AgregadoGrueso) {
                const [fino, grueso] = await Promise.all([
                    db.AgregadoFino.findByPk(item.idAgregado, { attributes: ['idAgregado'] }),
                    db.AgregadoGrueso.findByPk(item.idAgregado, { attributes: ['idAgregado'] }),
                ]);
                tipoAg = fino ? 'Fino' : grueso ? 'Grueso' : null;
            }

            componentes.push({
                idAgregado: item.idAgregado,
                nombre: item.nombre || null,
                porcentaje: item.porcentaje,
                peso: item.porcentaje / 100,
                propiedades: props,
                ensayosDisponibles: resultsByCode.size,
                tipoAgregado: tipoAg,
            });
        } catch (err) {
            errores.push({ idAgregado: item.idAgregado, error: err.message });
            componentes.push({
                idAgregado: item.idAgregado,
                nombre: item.nombre || null,
                porcentaje: item.porcentaje,
                peso: item.porcentaje / 100,
                propiedades: {},
                ensayosDisponibles: 0,
                tipoAgregado: item.tipoAgregado || null,
            });
        }
    }

    // Calculate weighted averages for each numeric property
    const numericProps = [
        'densidadRelativaReal', 'densidadRelativaAparenteSeca', 'densidadRelativaAparenteSSS',
        'absorcionPct', 'pasa200Pct', 'terronesPct', 'sulfatosPct', 'salesSolublesPct',
        'clorurosPct', 'materiasCarbonosaPct', 'puc', 'pus', 'equivalenteArenaPct',
        'durabilidadPct', 'desgasteLAPct', 'lajosidadPct', 'elongacionPct',
    ];

    const combinadas = {};
    for (const prop of numericProps) {
        const items2 = componentes.map(c => ({ peso: c.peso, valor: c.propiedades[prop] ?? null }));
        combinadas[prop] = weightedAverage(items2);
    }

    // Preserve operador flags — if any component has non-exact operator, the combined inherits it
    // (conservative: 'menor_que' wins over null, 'mayor_que' wins over null)
    const combineOp = (prop) => {
      const ops = componentes.map(c => c.propiedades[prop]).filter(Boolean);
      if (ops.includes('menor_que')) return 'menor_que';
      if (ops.includes('mayor_que')) return 'mayor_que';
      return null;
    };
    combinadas.clorurosOperador = combineOp('clorurosOperador');
    combinadas.sulfatosOperador = combineOp('sulfatosOperador');
    combinadas.salesOperador = combineOp('salesOperador');
    combinadas.terronesOperador = combineOp('terronesOperador');
    combinadas.materiasCarbonosasOperador = combineOp('materiasCarbonosasOperador');

    // Materia orgánica — qualitative: worst-case (if any component is >= 500, combined is >= 500)
    const moValues = componentes.map(c => c.propiedades.materiaOrganicaResultado).filter(Boolean);
    if (moValues.length > 0) {
        combinadas.materiaOrganicaResultado = moValues.includes('igual_o_mayor_500') ? 'igual_o_mayor_500' : 'menor_500';
    }

    return { combinadas, componentes, errores };
}

module.exports = {
    fetchEnsayoResults,
    calcularPropiedadesCombinadas,
};
