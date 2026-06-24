'use strict';

const crypto = require('crypto');

/**
 * Round a number to fixed precision for deterministic serialization.
 */
function redondear(value, decimales) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const factor = Math.pow(10, decimales);
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Recursively sort object keys for deterministic JSON serialization.
 */
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Compute SHA-256 hash from a data object.
 * Returns { hashCompleto, hashCorto }.
 */
function calcularHash(datos) {
  const sorted = sortKeys(datos);
  const json = JSON.stringify(sorted);
  const hashCompleto = crypto
    .createHash('sha256')
    .update(json, 'utf8')
    .digest('hex');
  return {
    hashCompleto,
    hashCorto: hashCompleto.substring(0, 12),
    datosJson: json,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Build data objects for hashing
// ═══════════════════════════════════════════════════════════════════════════════

// Versión actual del schema del payload usado para nuevos hashes.
// Subir SOLO cuando cambie la forma del payload de manera no compatible.
const HASH_SCHEMA_VERSION_ACTUAL = 2;

/**
 * Build the deterministic data object for a dosificación hash.
 *
 * @param {object} dosif - DosificacionDisenada instance (raw values)
 * @param {object} opts - { mezclaHash?: string, schemaVersion?: number }
 *
 * Schema versions:
 *   v1 — payload legado (incluye `factorPrudencialCurva`).
 *   v2 — payload limpio (sin `factorPrudencialCurva`, ya no consumido por el
 *        motor; ver `hormiqualCalcEngine.js:344`).
 *
 * Si `opts.schemaVersion` no se pasa, se infiere desde
 * `dosif.hashSchemaVersion` (default 1 — preserva semántica histórica).
 * Para nuevos cálculos, los call sites pasan explícitamente
 * `{ schemaVersion: HASH_SCHEMA_VERSION_ACTUAL }`.
 */
function buildDatosDosificacion(dosif, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? dosif.hashSchemaVersion ?? 1;

  const params = typeof dosif.parametrosObjetivoJson === 'string'
    ? JSON.parse(dosif.parametrosObjetivoJson)
    : (dosif.parametrosObjetivoJson || {});

  const resultado = typeof dosif.resultadoJson === 'string'
    ? JSON.parse(dosif.resultadoJson)
    : (dosif.resultadoJson || {});

  // Build adiciones array (sorted by slot)
  const adiciones = [];
  if (dosif.idAdicion1) {
    adiciones.push({
      slot: 1,
      idAdicion: dosif.idAdicion1,
      porcentaje: redondear(dosif.pctReemplazoAdicion1, 4),
    });
  }
  if (dosif.idAdicion2) {
    adiciones.push({
      slot: 2,
      idAdicion: dosif.idAdicion2,
      porcentaje: redondear(dosif.pctReemplazoAdicion2, 4),
    });
  }

  // Build aditivos array (sorted by slot)
  const aditivos = [];
  if (dosif.idAditivo1) {
    aditivos.push({
      slot: 1,
      idAditivo: dosif.idAditivo1,
      dosis: redondear(dosif.dosisAditivo1, 4),
      modoEfecto: dosif.modoEfectoAditivo1,
    });
  }
  if (dosif.idAditivo2) {
    aditivos.push({
      slot: 2,
      idAditivo: dosif.idAditivo2,
      dosis: redondear(dosif.dosisAditivo2, 4),
      modoEfecto: dosif.modoEfectoAditivo2,
    });
  }

  // Build agregados from resultado (sorted by nombre)
  const agregados = (resultado.agregados || [])
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    .map(a => ({
      nombre: a.nombre,
      porcentaje: redondear(a.porcentaje, 4),
      proporcionNormalizada: redondear(a.proporcionNormalizada, 4),
    }));

  const base = {
    // Parámetros objetivo
    metodo: dosif.metodo,
    resistenciaMpa: redondear(params.resistenciaMpa, 2),
    fce: redondear(params.fce, 2),
    desvioS: redondear(params.desvioS, 2),
    edadDias: params.edadDias || null,
    asentamientoMm: redondear(params.asentamientoMm, 1),
    tmnMm: redondear(params.tmnMm, 1),
    formaAgregado: params.formaAgregado || null,
    airePct: redondear(params.airePct, 2),
    exposicion: params.exposicion || null,
    tipoHormigonEstructural: params.tipoHormigonEstructural || null,
    // Restricciones
    acMaxPliego: redondear(params.acMaxPliego, 4),
    amcMaxPliego: redondear(params.amcMaxPliego, 4),
    cementoMinPliego: redondear(params.cementoMinPliego, 2),
    // Materiales
    idCemento: dosif.idCemento,
    idMezcla: dosif.idMezcla,
    mezclaHash: opts.mezclaHash || null,
    adiciones,
    aditivos,
    // Resultados del cálculo
    aguaLtsM3: redondear(resultado.aguaLtsM3, 2),
    ac: redondear(resultado.ac, 4),
    cementoKgM3: redondear(resultado.cementoKgM3, 2),
    cementoTotalKgM3: redondear(resultado.cementoTotalKgM3, 2),
    agregados,
    puvTeorico: redondear(resultado.puvTeorico, 2),
    // Metadata
    version: dosif.version,
  };

  // factorPrudencialCurva (legado): incluido SOLO en payload v1 para que las
  // dosificaciones aprobadas antes de la migración M5 sigan verificando
  // integridad. v2 lo omite (el motor ya no consume el campo desde el cálculo
  // — ver `hormiqualCalcEngine.js:344`). El campo permanece en `parametrosObjetivoJson`
  // de los rows v1, así que la reconstrucción es estable.
  if (schemaVersion === 1) {
    base.factorPrudencialCurva = redondear(params.factorPrudencialCurva, 4);
  }

  // Override de pastón (Fase 3) — incluido en el hash SOLO cuando está activo.
  // Razón: si lo agregáramos siempre (incluso false/null), cambiaríamos el
  // hash de todas las dosificaciones EN_PRODUCCION existentes y romperíamos
  // verificarIntegridad. Al condicionar la inclusión, los registros sin
  // override conservan su hash original; los que activan override añaden
  // los campos al payload, así una escritura directa en DB que ponga
  // overridePastonAprobado=true sin recalcular el hash queda detectable.
  if (dosif.overridePastonAprobado === true) {
    base.overridePastonAprobado = true;
    base.overridePastonFirmadoPor = dosif.overridePastonFirmadoPor || null;
  }

  return base;
}

/**
 * Build the deterministic data object for a mezcla hash.
 *
 * @param {object} mezcla - MezclaAgregados instance (raw values)
 * @param {Array} items - MezclaAgregadosItem[] (sorted by orden)
 */
function buildDatosMezcla(mezcla, items = []) {
  const componentes = (items || [])
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map(c => ({
      idAgregado: c.idAgregado,
      porcentajeFinal: redondear(c.porcentajeFinal, 4),
      orden: c.orden,
    }));

  const curvaMezcla = typeof mezcla.curvaMezclaJson === 'string'
    ? JSON.parse(mezcla.curvaMezclaJson)
    : (mezcla.curvaMezclaJson || null);

  const metadataResultado = typeof mezcla.metadataResultadoJson === 'string'
    ? JSON.parse(mezcla.metadataResultadoJson)
    : (mezcla.metadataResultadoJson || null);

  // Extract only stable fields from metadata (exclude UI state)
  const resultadoEstable = metadataResultado ? {
    bandaCumple: metadataResultado.bandaCumple ?? null,
    errorTeorico: redondear(metadataResultado.errorTeorico, 6),
    errorBanda: redondear(metadataResultado.errorBanda, 6),
  } : null;

  return {
    // Componentes
    componentes,
    // Parámetros de la mezcla
    tipoMezcla: mezcla.tipoMezcla,
    objetivoModo: mezcla.objetivoModo || null,
    idBanda: mezcla.idBanda || null,
    idCurvaTeorica: mezcla.idCurvaTeorica || null,
    // Resultados
    tmnCalculadoMm: redondear(mezcla.tmnCalculadoMm, 2),
    moduloFinura: redondear(mezcla.moduloFinura, 4),
    curvaMezcla: curvaMezcla ? curvaMezcla.map(p => ({
      tamiz: redondear(p.tamiz, 3),
      pasante: redondear(p.pasante ?? p.pctPasante, 2),
    })) : null,
    resultadoEstable,
    // Metadata
    version: mezcla.version,
  };
}

/**
 * Verify integrity of a dosificación or mezcla.
 * Returns { ok: boolean, hashAlmacenado, hashRecalculado, datosJson? }.
 */
function verificarIntegridad(entity, buildFn, ...buildArgs) {
  const hashAlmacenado = entity.hashIntegridad;
  if (!hashAlmacenado) {
    return { ok: false, reason: 'No hay hash almacenado', hashAlmacenado: null, hashRecalculado: null };
  }

  const datos = buildFn(entity, ...buildArgs);
  const { hashCompleto } = calcularHash(datos);

  return {
    ok: hashCompleto === hashAlmacenado,
    hashAlmacenado,
    hashRecalculado: hashCompleto,
    hashCortoAlmacenado: hashAlmacenado.substring(0, 12),
    hashCortoRecalculado: hashCompleto.substring(0, 12),
  };
}

module.exports = {
  HASH_SCHEMA_VERSION_ACTUAL,
  calcularHash,
  buildDatosDosificacion,
  buildDatosMezcla,
  verificarIntegridad,
  redondear,
  sortKeys,
};
