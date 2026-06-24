'use strict';

/**
 * Suma de sustancias nocivas del agregado (IRAM 1512 §5.2.2 / IRAM 1531 §5.1.2.2).
 *
 * Esta es una propiedad DERIVADA del agregado: se calcula sumando 6 ensayos
 * químicos. Antes vivía en `ensayoEvalEngine.js`, lo cual era práctico pero
 * implicaba que el motor de dosificación replicaba el cálculo si lo necesitaba
 * (P1.6 — lógica derivada duplicable).
 *
 * Ahora es un módulo único con dos responsabilidades:
 *   1. Calcular la suma a partir del map de ensayos (función pura)
 *   2. Devolver un ComplianceResult contextualizado por destino:
 *      - Si el destino tiene desgaste superficial → límite 5,0%
 *      - Si NO tiene desgaste → límite 7,0%
 *
 * NOTA sobre valores censurados:
 *   Cuando un ensayo viene con qualifier '<' (ej: cloruros "< 0,01%"), se
 *   trata el componente como 0 para la suma. Es la convención conservadora:
 *   asumimos lo MENOR posible. Esto es coherente con el patrón
 *   `asConservativeEstimate()` de MeasuredValue.
 *
 *   Si en el futuro se quiere usar el límite de detección como cota superior,
 *   pasar la opción { censorMode: 'detectionLimit' } a las funciones.
 */

const { Compliance } = require('../compliance');
const { adapt, asConservativeEstimate } = require('../measurement');

/**
 * Códigos de los 6 ensayos que conforman la suma.
 */
const COMPONENTES = [
  { code: 'IRAM1647_TERRONES_ARCILLA',     field: 'valor',       label: 'Terrones de arcilla' },
  { code: 'IRAM1674_MATERIAL_FINO_200',    field: 'pasa200Pct',  label: 'Material fino #200' },
  { code: 'IRAM1647_MATERIAS_CARBONOSAS',  field: 'valor',       label: 'Materias carbonosas' },
  { code: 'IRAM1647_SULFATOS_SO3',         field: 'valor',       label: 'Sulfatos (SO3)' },
  { code: 'IRAM1647_SALES_SOLUBLES',       field: 'valor',       label: 'Sales solubles' },
  { code: 'IRAM1882_CLORUROS_SOLUBLES',    field: 'valor',       label: 'Cloruros solubles' },
];

const LIMITES = Object.freeze({
  AF_CON_DESGASTE: 5.0,    // IRAM 1512 destino con desgaste
  AF_SIN_DESGASTE: 7.0,    // IRAM 1512 destino sin desgaste
  AG: 5.0,                 // IRAM 1531 (límite único)
});

/**
 * Lee un componente del map respetando convención conservadora para censurados.
 * @param {Object} ensayosMap
 * @param {Object} comp - { code, field }
 * @param {string} censorMode - 'zero' | 'detectionLimit'
 * @returns {{ value: number, isCensored: boolean, isMissing: boolean }}
 */
function readComponente(ensayosMap, comp, censorMode = 'zero') {
  const raw = ensayosMap?.[comp.code];
  if (!raw) return { value: 0, isCensored: false, isMissing: true };

  // Adaptar al modelo MeasuredValue (entiende formato legacy)
  // Si el field específico existe, usarlo; sino caer a `valor`.
  const valorRaw = raw[comp.field] ?? raw.valor;
  const mv = adapt({ ...raw, valor: valorRaw }, { defaultUnit: '%' });

  if (mv.value == null) return { value: 0, isCensored: false, isMissing: true };

  if (mv.isCensored) {
    if (censorMode === 'detectionLimit') {
      const est = asConservativeEstimate(mv);
      return { value: est.value || 0, isCensored: true, isMissing: false };
    }
    // censorMode === 'zero' (default conservador)
    return { value: 0, isCensored: true, isMissing: false };
  }

  return { value: Number(mv.value) || 0, isCensored: false, isMissing: false };
}

/**
 * Calcula la suma de sustancias nocivas y devuelve detalle por componente.
 *
 * @param {Object} ensayosMap - map por código de ensayo, con shape { [code]: resultadoLegacy }
 * @param {Object} [options]
 * @param {string} [options.censorMode='zero'] - cómo tratar valores censurados
 * @returns {{
 *   suma: number,
 *   detalle: Array<{ label, value, isCensored, isMissing }>,
 *   tieneCensurados: boolean,
 *   tieneFaltantes: boolean,
 *   componentesFaltantes: string[]
 * }}
 */
function calcularSuma(ensayosMap, options = {}) {
  const { censorMode = 'zero' } = options;
  const detalle = COMPONENTES.map((comp) => ({
    label: comp.label,
    code: comp.code,
    ...readComponente(ensayosMap, comp, censorMode),
  }));
  const suma = detalle.reduce((s, d) => s + d.value, 0);
  const tieneCensurados = detalle.some((d) => d.isCensored);
  const tieneFaltantes = detalle.some((d) => d.isMissing);
  const componentesFaltantes = detalle.filter((d) => d.isMissing).map((d) => d.label);
  return {
    suma: Math.round(suma * 100) / 100,
    detalle,
    tieneCensurados,
    tieneFaltantes,
    componentesFaltantes,
  };
}

/**
 * Evalúa la suma del AF contra el límite normativo aplicable según destino.
 *
 * @param {Object} ensayosMap
 * @param {Object} [context]
 * @param {boolean} [context.expuestoDesgaste=false]
 * @returns {{ resultado, compliance, limiteAplicado, sumaCalc }}
 */
function evaluarAF(ensayosMap, context = {}) {
  const sumaCalc = calcularSuma(ensayosMap);
  const expuesto = !!context.expuestoDesgaste;
  const limite = expuesto ? LIMITES.AF_CON_DESGASTE : LIMITES.AF_SIN_DESGASTE;
  const cumple = sumaCalc.suma <= limite;

  let compliance;
  if (sumaCalc.tieneFaltantes) {
    compliance = Compliance.notEvaluated({
      reason: `Faltan ensayos para calcular la suma: ${sumaCalc.componentesFaltantes.join(', ')}`,
    });
  } else if (cumple) {
    // M12 (auditoría 01-calidad): si hay componentes censurados (qualifier '<'),
    // recalcular con cota superior (límite de detección como upper bound). Si esa
    // cota cruza el límite normativo, no podemos afirmar pass — devolver
    // `inconclusive`. Antes el evaluador respondía pass aun cuando el valor real
    // del agregado podía estar por encima del límite.
    if (sumaCalc.tieneCensurados) {
      const sumaUB = calcularSuma(ensayosMap, { censorMode: 'detectionLimit' });
      if (sumaUB.suma > limite) {
        compliance = Compliance.inconclusive({
          reason: `Suma con censurados como 0 = ${sumaCalc.suma}% (≤ ${limite}%), pero usando los límites de detección como cota superior llega a ${sumaUB.suma}% (supera ${limite}%). No es posible afirmar cumplimiento sin medir los componentes censurados con mayor precisión.`,
          measured: sumaCalc.suma,
          limit: limite,
          norm: 'IRAM 1512 §5.2.2',
        });
      } else {
        compliance = Compliance.pass({
          message: `Suma ${sumaCalc.suma}% ≤ ${limite}% (${expuesto ? 'criterio estricto IRAM 1512 con desgaste' : 'criterio estándar IRAM 1512 sin desgaste'}). Algunos componentes están censurados (qualifier <); aún tomando los límites de detección como cota superior la suma queda en ${sumaUB.suma}% ≤ ${limite}%.`,
        });
      }
    } else {
      compliance = Compliance.pass({
        message: `Suma ${sumaCalc.suma}% ≤ ${limite}% (${expuesto ? 'criterio estricto IRAM 1512 con desgaste' : 'criterio estándar IRAM 1512 sin desgaste'})`,
      });
    }
  } else {
    compliance = Compliance.fail({
      reasons: [
        `Suma de sustancias nocivas ${sumaCalc.suma}% supera el límite IRAM 1512 de ${limite}% (${expuesto ? 'destino con desgaste' : 'destino sin desgaste'})`,
      ],
      expected: `≤ ${limite}%`,
      actual: `${sumaCalc.suma}%`,
    });
  }

  return {
    sumaCalc,
    limiteAplicado: limite,
    expuestoDesgaste: expuesto,
    compliance,
    // Backward-compat: campos del shape viejo
    suma: sumaCalc.suma,
    limiteConDesgaste: LIMITES.AF_CON_DESGASTE,
    limiteSinDesgaste: LIMITES.AF_SIN_DESGASTE,
    cumpleConDesgaste: sumaCalc.suma <= LIMITES.AF_CON_DESGASTE,
    cumpleSinDesgaste: sumaCalc.suma <= LIMITES.AF_SIN_DESGASTE,
    detalle: Object.fromEntries(sumaCalc.detalle.map((d) => [
      d.code === 'IRAM1647_TERRONES_ARCILLA' ? 'terrones'
        : d.code === 'IRAM1674_MATERIAL_FINO_200' ? 'pasante200'
        : d.code === 'IRAM1647_MATERIAS_CARBONOSAS' ? 'carbonosas'
        : d.code === 'IRAM1647_SULFATOS_SO3' ? 'sulfatos'
        : d.code === 'IRAM1647_SALES_SOLUBLES' ? 'sales'
        : 'cloruros',
      d.value,
    ])),
  };
}

/**
 * Evalúa la suma del AG (límite único 5,0%, sin condición de desgaste).
 */
function evaluarAG(ensayosMap) {
  const sumaCalc = calcularSuma(ensayosMap);
  const cumple = sumaCalc.suma <= LIMITES.AG;

  let compliance;
  if (sumaCalc.tieneFaltantes) {
    compliance = Compliance.notEvaluated({
      reason: `Faltan ensayos para calcular la suma: ${sumaCalc.componentesFaltantes.join(', ')}`,
    });
  } else if (cumple) {
    // M12 (auditoría 01-calidad): mismo tratamiento que AF (ver evaluarAF).
    if (sumaCalc.tieneCensurados) {
      const sumaUB = calcularSuma(ensayosMap, { censorMode: 'detectionLimit' });
      if (sumaUB.suma > LIMITES.AG) {
        compliance = Compliance.inconclusive({
          reason: `Suma con censurados como 0 = ${sumaCalc.suma}% (≤ ${LIMITES.AG}%), pero usando los límites de detección como cota superior llega a ${sumaUB.suma}% (supera ${LIMITES.AG}%). No es posible afirmar cumplimiento sin medir los componentes censurados con mayor precisión.`,
          measured: sumaCalc.suma,
          limit: LIMITES.AG,
          norm: 'IRAM 1531 §5.1.2.2',
        });
      } else {
        compliance = Compliance.pass({
          message: `Suma ${sumaCalc.suma}% ≤ ${LIMITES.AG}% (IRAM 1531). Aún con los límites de detección como cota superior la suma queda en ${sumaUB.suma}% ≤ ${LIMITES.AG}%.`,
        });
      }
    } else {
      compliance = Compliance.pass({
        message: `Suma ${sumaCalc.suma}% ≤ ${LIMITES.AG}% (IRAM 1531)`,
      });
    }
  } else {
    compliance = Compliance.fail({
      reasons: [`Suma de sustancias nocivas ${sumaCalc.suma}% supera el límite IRAM 1531 de ${LIMITES.AG}%`],
      expected: `≤ ${LIMITES.AG}%`,
      actual: `${sumaCalc.suma}%`,
    });
  }

  return {
    sumaCalc,
    limiteAplicado: LIMITES.AG,
    compliance,
    // Backward-compat
    suma: sumaCalc.suma,
    limite: LIMITES.AG,
    cumple,
    detalle: Object.fromEntries(sumaCalc.detalle.map((d) => [
      d.code === 'IRAM1647_TERRONES_ARCILLA' ? 'terrones'
        : d.code === 'IRAM1674_MATERIAL_FINO_200' ? 'pasante200'
        : d.code === 'IRAM1647_MATERIAS_CARBONOSAS' ? 'carbonosas'
        : d.code === 'IRAM1647_SULFATOS_SO3' ? 'sulfatos'
        : d.code === 'IRAM1647_SALES_SOLUBLES' ? 'sales'
        : 'cloruros',
      d.value,
    ])),
  };
}

module.exports = {
  COMPONENTES,
  LIMITES,
  calcularSuma,
  evaluarAF,
  evaluarAG,
};
