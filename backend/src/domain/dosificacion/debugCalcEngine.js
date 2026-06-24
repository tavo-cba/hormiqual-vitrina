'use strict';

/* [DEBUG-DOSIF] ─────────────────────────────────────────────────────────────
 * debugCalcEngine — Motor de "dosificación de depuración".
 *
 * NO ES UN MOTOR DE CÁLCULO. Es una herramienta TEMPORAL para la puesta a punto
 * de la integración con la planta Betonmatic en producción: permite construir
 * una dosificación arbitraria (p. ej. 50 L de agua por m³ y nada más) que pueda
 * publicarse y despacharse a la planta sin pasar por las validaciones del motor
 * normativo (cemento + mezcla obligatorios, cierre volumétrico, aptitud, etc.).
 *
 * El motor NO calcula: ECHA los materiales que el usuario tipea al shape
 * canónico de `resultadoJson` que consumen el PDF y, sobre todo,
 * `betonmaticPublicacionService._materialesRealesDesdeDisenada`:
 *   - agua  → `result.aguaLtsM3`            (slot singleton __AGUA__)
 *   - cemento → `result.cementoKgM3` + col. `idCemento`
 *   - adiciones → `result.adicion{1,2}KgM3` + col. `idAdicion{1,2}`
 *   - aditivos → `result.aditivos[]` con `label:'aditivoN'` + `kgM3` + col. `idAditivoN`
 *   - agregados → `result.agregados[]` con `idAgregado` + `kgM3`
 *   - fibras → cols. `dosisMacrofibraKgM3` / `dosisMicrofibraKgM3` (el motor no las toca)
 *
 * Fuera de CIRSOC / IRAM por completo: no emite ningún veredicto ni verificación.
 * Gateado por la env var `ALLOW_DEBUG_DOSIFICACION` + rol admin en las capas
 * superiores (service / controller). Removible: `grep -r "[DEBUG-DOSIF]"`.
 *
 * Pureza: engine puro (no DB, no HTTP, no Sequelize). Todos los datos llegan
 * como argumentos. @see hormiqual-backend/CLAUDE.md — reglas de pureza.
 * ───────────────────────────────────────────────────────────────────────── */

const MOTOR_VERSION = 'HormiQual v2.0';
const MODELO_CALCULO_LABEL = 'DEBUG — Dosificación de depuración (NO normativa, sólo para pruebas de integración)';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Construye una dosificación de depuración a partir de materiales libres.
 *
 * @param {Object} params
 * @param {number} params.aguaLtsM3        - OBLIGATORIO (> 0). Litros de agua por m³.
 * @param {number} [params.cementoKgM3]    - Cemento por m³ (kg). Requiere `idCemento` en el registro para publicarse.
 * @param {number} [params.adicion1KgM3]   - Adición 1 por m³ (kg).
 * @param {number} [params.adicion2KgM3]   - Adición 2 por m³ (kg).
 * @param {Array<Object>} [params.aditivos] - [{ slot:1|2|3, kgM3, dosisPct?, nombre? }]
 * @param {Array<Object>} [params.agregados] - [{ idAgregado, nombre?, kgM3 }]
 * @param {number} [params.macrofibraKgM3] - Informativo (las fibras viajan por columnas del registro).
 * @param {number} [params.microfibraKgM3] - Informativo.
 * @param {Object} [params.context]        - Etiquetas para trazabilidad: { cementoNombre, nombre }.
 *
 * @returns {Object} { resultado, warnings, fuentesCalculo, trazabilidad, abortado }
 */
function calcularDosificacionDebug(params = {}) {
  const {
    aguaLtsM3,
    cementoKgM3,
    adicion1KgM3,
    adicion2KgM3,
    aditivos = [],
    agregados = [],
    macrofibraKgM3,
    microfibraKgM3,
    context = {},
  } = params;

  const warnings = [];
  const fuentesCalculo = [];

  // Marca permanente: este resultado NUNCA debe confundirse con un cálculo real.
  warnings.push({
    campo: 'modo', tipo: 'advertencia',
    msg: 'DOSIFICACIÓN DE DEPURACIÓN: valores ingresados manualmente, sin cálculo ni verificación normativa. Sólo para pruebas de integración con planta. No usar en producción.',
  });

  const agua = num(aguaLtsM3);
  if (!(agua > 0)) {
    warnings.push({ campo: 'aguaLtsM3', tipo: 'error', msg: 'La dosificación de depuración requiere agua (L/m³) > 0.' });
    return _abortar(params, warnings, fuentesCalculo, context);
  }

  const cemento = num(cementoKgM3);
  const adic1 = num(adicion1KgM3);
  const adic2 = num(adicion2KgM3);

  // Aditivos → shape canónico con `label: 'aditivoN'` (lo que matchea
  // _materialesRealesDesdeDisenada para resolver el slot).
  const aditivosCalc = (Array.isArray(aditivos) ? aditivos : [])
    .map((ad) => {
      const slot = Number(ad?.slot) || null;
      const kg = num(ad?.kgM3);
      if (!slot || kg <= 0) return null;
      const nombre = ad?.nombre || `Aditivo ${slot}`;
      const dosisPct = ad?.dosisPct != null ? r2(num(ad.dosisPct)) : null;
      return {
        label: `aditivo${slot}`,
        descripcion: nombre,
        nombre,
        kgM3: r2(kg),
        pesoKgM3: r2(kg),
        dosis: dosisPct,
        dosisPct,
        unidad: dosisPct != null ? 'PORC_SOBRE_CEMENTO' : 'KG_M3',
        unidadLabel: dosisPct != null ? '% sobre cemento' : 'kg/m³',
      };
    })
    .filter(Boolean);

  // Agregados → preservan idAgregado para que el publicador los mapee directo.
  const agregadosCalc = (Array.isArray(agregados) ? agregados : [])
    .map((ag) => {
      const id = ag?.idAgregado ?? ag?.id ?? null;
      const kg = num(ag?.kgM3);
      if (!id || kg <= 0) return null;
      const nombre = ag?.nombre || `Agregado #${id}`;
      return {
        idAgregado: id,
        nombre,
        tipo: ag?.tipo || 'AG',
        kgM3: r2(kg),
      };
    })
    .filter(Boolean);

  const macro = num(macrofibraKgM3);
  const micro = num(microfibraKgM3);

  fuentesCalculo.push({
    parametro: 'Tipología',
    valor: 'DEBUG',
    origenTipo: 'INPUT_USUARIO',
    regla: 'Dosificación de depuración: todos los materiales son ingresados manualmente, sin cálculo. Fuera de CIRSOC/IRAM.',
  });

  const resultado = {
    // Agua (singleton). 1 L ≈ 1 kg.
    aguaLtsM3: r2(agua),
    // Cemento (sólo informa si > 0; el registro debe llevar idCemento para publicarse).
    cementoKgM3: cemento > 0 ? r2(cemento) : 0,
    cementoTotalKgM3: cemento > 0 ? r2(cemento) : 0,
    // Adiciones.
    adicion1KgM3: adic1 > 0 ? r2(adic1) : 0,
    adicion2KgM3: adic2 > 0 ? r2(adic2) : 0,
    // Aditivos / agregados.
    aditivos: aditivosCalc,
    agregados: agregadosCalc,
    // Fibras (informativas en el resultado; las dosis reales viven en columnas del registro).
    dosisMacrofibraKgM3: macro > 0 ? r2(macro) : 0,
    dosisMicrofibraKgM3: micro > 0 ? r2(micro) : 0,
    // Sin cálculo: a/c y aire no aplican.
    ac: null,
    airePct: 0,
    aireTotalPct: 0,
    aireAtrapado: 0,
    aireIncorporado: 0,
    esDebug: true,
  };

  const trazabilidad = {
    metodoCalculo: 'DEBUG',
    motorVersion: MOTOR_VERSION,
    modeloCalculoLabel: MODELO_CALCULO_LABEL,
    esDebug: true,
    inputs: { ...params, context: undefined },
    fuentesCalculo,
    aguaFinal: r2(agua),
  };

  return {
    resultado,
    warnings,
    fuentesCalculo,
    trazabilidad,
    abortado: false,
  };
}

function _abortar(params, warnings, fuentesCalculo, context) {
  return {
    resultado: null,
    warnings,
    fuentesCalculo,
    trazabilidad: {
      metodoCalculo: 'DEBUG',
      motorVersion: MOTOR_VERSION,
      modeloCalculoLabel: MODELO_CALCULO_LABEL,
      esDebug: true,
      inputs: { ...params, context: undefined },
      fuentesCalculo,
    },
    abortado: true,
  };
}

module.exports = {
  calcularDosificacionDebug,
  MOTOR_VERSION,
  MODELO_CALCULO_LABEL,
};
