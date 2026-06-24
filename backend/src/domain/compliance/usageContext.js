'use strict';

/**
 * UsageContext — contexto de uso del hormigón a los efectos de evaluación.
 *
 * Define el ambiente y destino del hormigón para que el motor de aptitud y el
 * dispatcher de alertas puedan decidir:
 *   - exigibilidad de cada ensayo (pending vs notApplicable)
 *   - severidad de un fail (bloqueante vs no_bloqueante)
 *   - aplicación de límites contextuales (ej: pasante #200 strict vs standard
 *     según expuestoDesgaste)
 *
 * Diseño:
 *   - 10 campos. Cada uno refleja una columna o referencia ya modelada en
 *     HormiQual.
 *   - Inmutable (Object.freeze).
 *   - Defaults documentados con su justificación (frecuencia esperada vs
 *     conservadurismo estricto). Ver REGLA DE DEFAULTS abajo.
 *
 * REGLA DE DEFAULTS — campo null:
 *   exposureClass: null      → "no se sabe; ensayos cuya exigibilidad depende
 *                              de exposición caen a `pending` por la regla
 *                              conservadora del Commit 2 (no `notApplicable`)"
 *   fceMpa: null             → fce alto (≥30) — aplican límites más estrictos
 *   tipologiaCodigo: null    → 'convencional' (frecuencia esperada, NO
 *                              conservador — lo estricto sería suponer alta
 *                              resistencia o autocompactante)
 *   tipoArmadura: undefined  → 'armado' (frecuencia esperada, NO conservador —
 *                              lo estricto sería 'pretensado' que tiene
 *                              límites de cloruros más severos)
 *   tipoHormigonParticular: null  → sin condición particular
 *   claseHormigonParticular: null → sin clase particular
 *   espesorElementoMm: null  → sin restricción por espesor (no se asume
 *                              hormigón masivo automáticamente)
 *
 * Las dos excepciones a "estricto por defecto" (tipologiaCodigo y
 * tipoArmadura) son decisiones explícitas basadas en frecuencia esperada del
 * caso de uso real en HormiQual. Documentadas también en JSDoc de
 * createUsageContext.
 */

/* ───────── Catálogos ───────── */

/**
 * Códigos CIRSOC 200:2024 para clase de exposición.
 * Espejo del catálogo `DurabilidadExposicion` (BD).
 */
const EXPOSURE_CLASSES = Object.freeze([
  'A1', 'A2', 'A3',           // carbonatación
  'CL1', 'CL2',               // cloruros no marinos
  'M1', 'M2', 'M3',           // marino
  'C1', 'C2',                 // congelación-deshielo
  'Q1', 'Q2', 'Q3', 'Q4',     // ataque químico
]);

/**
 * Códigos de tipología del catálogo `TipologiaHormigon` (BD).
 * El catálogo es extensible: códigos custom no documentados aquí se
 * aceptan sin error, solo se valida que sean string.
 */
const TIPOLOGIAS_CONOCIDAS = Object.freeze([
  'convencional', 'bombeable', 'autocompactante', 'masivo',
  'pavimento_rigido', 'proyectado', 'alta_resistencia',
  'arquitectonico', 'rcc', 'personalizado',
]);

const TIPOS_ARMADURA = Object.freeze(['simple', 'armado', 'pretensado']);

const TIPOS_HORMIGON_PARTICULAR = Object.freeze(['BAJO_AGUA', 'IMPERMEABILIDAD', 'ABRASION']);

const CLASES_HORMIGON_PARTICULAR = Object.freeze(['I', 'II', 'III', 'IV']);

/* ───────── Constructor explícito ───────── */

/**
 * Construye un UsageContext canónico con defaults aplicados.
 *
 * @param {Object} [input]
 * @param {string|null} [input.exposureClass]
 * @param {number|null} [input.fceMpa]
 * @param {string} [input.tipoArmadura='armado']
 * @param {string|null} [input.tipologiaCodigo]
 * @param {boolean} [input.expuestoDesgaste=false]
 * @param {boolean} [input.aspectoSuperficialImportante=false]
 * @param {boolean} [input.ambienteHumedo=false]
 * @param {string|null} [input.tipoHormigonParticular]
 * @param {string|null} [input.claseHormigonParticular]
 * @param {number|null} [input.espesorElementoMm]
 * @returns {Readonly<UsageContext>}
 */
function createUsageContext(input = {}) {
  const ctx = {
    exposureClass:                _validateExposureClass(input.exposureClass),
    fceMpa:                       _validateFceMpa(input.fceMpa),
    tipoArmadura:                 _validateTipoArmadura(input.tipoArmadura) || 'armado',
    tipologiaCodigo:              _validateTipologia(input.tipologiaCodigo),
    expuestoDesgaste:             input.expuestoDesgaste === true,
    aspectoSuperficialImportante: input.aspectoSuperficialImportante === true,
    ambienteHumedo:               input.ambienteHumedo === true,
    tipoHormigonParticular:       _validateTipoHormigonParticular(input.tipoHormigonParticular),
    claseHormigonParticular:      _validateClaseHormigonParticular(input.claseHormigonParticular),
    espesorElementoMm:            _validateEspesor(input.espesorElementoMm),
  };
  return Object.freeze(ctx);
}

/**
 * Construye un UsageContext desde un row de DosificacionDisenada (Sequelize
 * o plain) y su `parametrosObjetivoJson`.
 *
 * Mapeo:
 *   - exposureClass    ← parametros.exposicion || parametros.claseExposicion
 *   - fceMpa           ← parametros.fce || parametros.resistenciaMpa
 *   - tipoArmadura     ← row.tipoArmadura
 *   - tipologiaCodigo  ← row.tipologiaCodigo
 *   - expuestoDesgaste ← row.expuestoDesgaste
 *   - ... (resto desde columnas explícitas)
 *
 * @param {Object} row - Row de DosificacionDisenada.
 * @param {Object|string|null} [parametrosObjetivoJson] - Si row.parametrosObjetivoJson
 *   ya está poblado, este parámetro es opcional.
 */
function usageContextFromDosificacion(row, parametrosObjetivoJson) {
  const params = _parseJson(parametrosObjetivoJson ?? row?.parametrosObjetivoJson);
  return createUsageContext({
    exposureClass:                params.exposicion ?? params.claseExposicion ?? null,
    fceMpa:                       _toNumber(params.fce ?? params.resistenciaMpa),
    tipoArmadura:                 row?.tipoArmadura,
    tipologiaCodigo:              row?.tipologiaCodigo,
    expuestoDesgaste:             row?.expuestoDesgaste,
    aspectoSuperficialImportante: row?.aspectoSuperficialImportante,
    ambienteHumedo:               row?.ambienteHumedo,
    tipoHormigonParticular:       row?.tipoHormigonParticular,
    claseHormigonParticular:      row?.claseHormigonParticular,
    espesorElementoMm:            row?.espesorElementoMm,
  });
}

/**
 * Construye un UsageContext desde el body del endpoint /calcular del
 * dosificacionDisenoController. El shape difiere de DosificacionDisenada
 * principalmente porque los campos llegan en root nivel (no anidados en
 * parametrosObjetivoJson).
 *
 * Acepta tanto `tipoArmadura` como `tipoHormigonEstructural` (alias
 * histórico del calcular). Idem para `tipoHormigonParticular` /
 * `hormigonParticular`.
 */
function usageContextFromCalcularBody(body = {}) {
  return createUsageContext({
    exposureClass:                body.exposicion ?? body.claseExposicion ?? null,
    fceMpa:                       _toNumber(body.fce ?? body.resistenciaMpa),
    tipoArmadura:                 body.tipoArmadura ?? body.tipoHormigonEstructural,
    tipologiaCodigo:              body.tipologiaCodigo,
    expuestoDesgaste:             body.expuestoDesgaste,
    aspectoSuperficialImportante: body.aspectoSuperficialImportante,
    ambienteHumedo:               body.ambienteHumedo,
    tipoHormigonParticular:       body.tipoHormigonParticular ?? body.hormigonParticular,
    claseHormigonParticular:      body.claseHormigonParticular,
    espesorElementoMm:            body.espesorElementoMm,
  });
}

/* ───────── Helpers semánticos (sobre UsageContext) ───────── */

/** ¿La exposición declarada implica ciclos de hielo/deshielo? */
const isFreezeThaw = (ctx) =>
  ctx?.exposureClass === 'C1' || ctx?.exposureClass === 'C2';

/** ¿Exposición marina? */
const isMarine = (ctx) =>
  ['M1', 'M2', 'M3'].includes(ctx?.exposureClass);

/** ¿Exposición a ataque químico? */
const isChemicalAttack = (ctx) =>
  ['Q1', 'Q2', 'Q3', 'Q4'].includes(ctx?.exposureClass);

/** ¿Exposición a cloruros (marina o no)? */
const isChlorideExposure = (ctx) =>
  isMarine(ctx) || ['CL1', 'CL2'].includes(ctx?.exposureClass);

/** ¿Tipología de hormigón masivo? */
const isMassConcrete = (ctx) =>
  ctx?.tipologiaCodigo === 'masivo';

/** ¿Hormigón pretensado? Cloruros más estrictos (CIRSOC art. 2.2.8). */
const isPretensado = (ctx) =>
  ctx?.tipoArmadura === 'pretensado';

/** ¿Hay información suficiente para evaluar exigibilidad por exposición? */
const hasExposureClass = (ctx) =>
  ctx?.exposureClass != null;

/* ───────── Validators privados ───────── */

function _validateExposureClass(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') {
    throw new Error(`UsageContext.exposureClass debe ser string o null. Recibido: ${typeof v}`);
  }
  if (!EXPOSURE_CLASSES.includes(v)) {
    throw new Error(
      `UsageContext.exposureClass "${v}" no es válida. Válidos: ${EXPOSURE_CLASSES.join(', ')}`
    );
  }
  return v;
}

function _validateFceMpa(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`UsageContext.fceMpa debe ser número positivo o null. Recibido: ${JSON.stringify(v)}`);
  }
  return n;
}

function _validateTipoArmadura(v) {
  if (v == null || v === '') return null;
  // Aceptar uppercase legacy ('ARMADO', 'PRETENSADO') normalizando a lowercase
  const normalized = String(v).toLowerCase();
  if (TIPOS_ARMADURA.includes(normalized)) return normalized;
  throw new Error(
    `UsageContext.tipoArmadura "${v}" no es válido. Válidos: ${TIPOS_ARMADURA.join(', ')}`
  );
}

function _validateTipologia(v) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') {
    throw new Error(`UsageContext.tipologiaCodigo debe ser string o null. Recibido: ${typeof v}`);
  }
  // El catálogo TipologiaHormigon es extensible: aceptamos cualquier string,
  // solo loggeamos si no es de los conocidos para detectar typos.
  return v;
}

function _validateTipoHormigonParticular(v) {
  if (v == null || v === '') return null;
  if (TIPOS_HORMIGON_PARTICULAR.includes(v)) return v;
  throw new Error(
    `UsageContext.tipoHormigonParticular "${v}" no es válido. Válidos: ${TIPOS_HORMIGON_PARTICULAR.join(', ')}`
  );
}

function _validateClaseHormigonParticular(v) {
  if (v == null || v === '') return null;
  if (CLASES_HORMIGON_PARTICULAR.includes(v)) return v;
  throw new Error(
    `UsageContext.claseHormigonParticular "${v}" no es válido. Válidos: ${CLASES_HORMIGON_PARTICULAR.join(', ')}`
  );
}

function _validateEspesor(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`UsageContext.espesorElementoMm debe ser número >= 0 o null. Recibido: ${v}`);
  }
  return n;
}

function _parseJson(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function _toNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  // Catálogos
  EXPOSURE_CLASSES,
  TIPOLOGIAS_CONOCIDAS,
  TIPOS_ARMADURA,
  TIPOS_HORMIGON_PARTICULAR,
  CLASES_HORMIGON_PARTICULAR,
  // Constructores
  createUsageContext,
  usageContextFromDosificacion,
  usageContextFromCalcularBody,
  // Helpers semánticos
  isFreezeThaw,
  isMarine,
  isChemicalAttack,
  isChlorideExposure,
  isMassConcrete,
  isPretensado,
  hasExposureClass,
};
