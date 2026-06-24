'use strict';

const { calcularDosificacion } = require('../domain/dosificacion/dosificacionCalcEngine'); // legacy fallback
const { calcularDosificacionHQ } = require('../domain/dosificacion/hormiqualCalcEngine');
const { calcularDosificacionHRDC } = require('../domain/dosificacion/hrdcCalcEngine');
const {
  calcularDosificacionAlivianado,
  esTipologiaAlivianado,
} = require('../domain/dosificacion/alivianadoCalcEngine');
const { calcularDosificacionDebug } = require('../domain/dosificacion/debugCalcEngine'); // [DEBUG-DOSIF]
const { verificarAptitudAF, verificarAptitudAG } = require('../domain/dosificacion/aptitudMaterialesService');
const { aplicarPoliticaCaracterizacion, construirPoliticaParaContexto } = require('../domain/dosificacion/aptitudPolicyHelper');
const { clasificarTransicion, metadataDeClasificacion } = require('../domain/dosificacion/politicaRevision');
const { derivarTipoHormigon, MODOS_FCE } = require('../domain/normRef/tipoHormigonIRAM1666');

const esTipologiaHRDC = (codigo) => String(codigo || '').toLowerCase() === 'hrdc';

/* [DEBUG-DOSIF] ──────────────────────────────────────────────────────────────
 * Dosificación de depuración: tipología `debug` que permite construir una
 * mezcla arbitraria (p. ej. sólo agua) para probar la integración con planta
 * Betonmatic en producción sin pasar por el motor normativo. Herramienta
 * TEMPORAL: gateada por la env var ALLOW_DEBUG_DOSIFICACION + rol admin (en el
 * controller). Removible con `grep -r "[DEBUG-DOSIF]"`.
 * El flag se lee en cada llamada (no se cachea) para que prenderlo/apagarlo no
 * requiera reiniciar en tests; en producción se fija por ambiente. */
const esTipologiaDebug = (codigo) => String(codigo || '').toLowerCase() === 'debug';
const debugDosificacionHabilitado = () =>
  String(process.env.ALLOW_DEBUG_DOSIFICACION || '').toLowerCase() === 'true';
const esRegistroDebug = (row) =>
  esTipologiaDebug(row?.tipologiaCodigo)
  || (typeof row?.trazabilidadJson === 'object' && row?.trazabilidadJson?.esDebug === true);

/**
 * Refactor 2026-05-20 — Resuelve el `idTipoHormigon` para una DosificacionDisenada
 * a partir del descriptor que devuelve `derivarTipoHormigon`. Si el TipoHormigon
 * no existe en el catálogo (caso fuera de escala IRAM 1666, ej. H-95), lo crea
 * con `fueraIram1666 = true` para que las consultas de estadística puedan
 * filtrarlo. Para el caso `nombre = null` (sin f'ce) devuelve null.
 *
 * @returns {Promise<number|null>}
 */
async function resolverIdTipoHormigon(db, descriptor) {
    if (!descriptor || !descriptor.nombre || !db?.TipoHormigon) return null;
    const existente = await db.TipoHormigon.findOne({
        where: { tipoHormigon: descriptor.nombre },
    });
    if (existente) return existente.idTipoHormigon;
    // No existe: lo creamos. Caso típico: f'ce fuera del catálogo y se generó
    // un nombre ad-hoc tipo "H-95". Persistimos los flags del descriptor
    // tal cual para que las consultas estadísticas puedan distinguir clases
    // vigentes, legacy y ad-hoc.
    const creado = await db.TipoHormigon.create({
        tipoHormigon: descriptor.nombre,
        fcMpa: descriptor.fcMpa,
        enIram1666: !!descriptor.enIram1666,
        enCirsoc200: !!descriptor.enCirsoc200,
        notaLegacy: descriptor.notaLegacy || null,
        adHoc: !!descriptor.adHoc,
    });
    return creado.idTipoHormigon;
}

/**
 * Normaliza cualquier representación de hora a "HH:mm:ss" 24h aceptable por
 * la columna MySQL TIME, o null. Defensa de borde, no confianza en el
 * cliente: bundles viejos del frontend serializan con
 * `toLocaleTimeString("es-AR")` y mandan "07:20 a. m." (12h + sufijo AM/PM
 * con espacio fino), que MySQL rechaza con "Incorrect time value". La
 * columna se blinda en el backend para que el formato del cliente nunca
 * tumbe el guardado. Entrada inválida → null (no se tira: el resto del
 * pastón se guarda igual).
 */
const normalizeHora = (v) => {
  if (v == null || v === '') return null;
  const p2 = (n) => String(n).padStart(2, '0');
  if (v instanceof Date) {
    return Number.isNaN(v.getTime())
      ? null
      : `${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`;
  }
  const s = String(v).trim();
  const t = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!t) return null;
  let h = parseInt(t[1], 10);
  const min = parseInt(t[2], 10);
  const sec = t[3] != null ? parseInt(t[3], 10) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59 || sec > 59) return null;
  // Marcador AM/PM tolerante: "a. m.", "a.m.", "am", "p m", nbsp incluido.
  const ampm = (s.match(/([ap])\s*\.?\s*m\.?/i) || [])[1];
  if (ampm) {
    const isPM = ampm.toLowerCase() === 'p';
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${p2(h)}:${p2(min)}:${p2(sec)}`;
};

/**
 * C9.2 — Wiring del dispatcher de alertas desde el motor de aptitud.
 *
 * Itera los items de una `verificacion` (output de verificarAptitudAF/AG) y
 * dispatchea alertas para cada item.compliance disparable, con anti-duplicado:
 * si ya existe una alerta PENDIENTE con el mismo material + codigoEnsayo +
 * complianceStatus, no crea otra (mismo patrón que verificarVencimientosEnsayos).
 *
 * Cierra D14 completo: el motor de aptitud ahora produce alertas vía dispatcher
 * en producción, no solo en smoke o tests. Sin esta función, post-C7 los
 * disparadores quedaban latentes — la verificación se calculaba y devolvía,
 * pero ningún call site llamaba al dispatcher.
 *
 * @param {Object} db
 * @param {Object} verificacion - output de verificarAptitudAF/AG enriquecido con agregadoId/agregadoNombre
 * @param {Object} [options] - { exigible: boolean } — pasa a alertarResultadoFueraDeEspec
 * @returns {Promise<Array>} alertas creadas
 */
async function _dispatchAptitudAlertsForVerificacion(db, verificacion, options = {}) {
  if (!db?.AlertaCalidad || !verificacion?.items?.length) return [];
  const { alertarResultadoFueraDeEspec, alertarRescatePorPolitica } = require('./alertaCalidadService');
  const { ALL_STATUSES } = require('../domain/compliance');
  const created = [];

  // Estados disparables: fail (siempre), conditionalPass (siempre),
  // inconclusive/expired/pending solo si exigible:true. Filtramos acá para
  // evitar pegarle a la BD en consultas obvias (pass / informative / etc.).
  const disparableStatuses = new Set(['fail', 'conditionalPass']);
  if (options.exigible === true) {
    disparableStatuses.add('inconclusive').add('expired').add('pending');
  }

  const ag = await db.Agregado.findByPk(verificacion.agregadoId, { raw: true });
  if (!ag) return [];

  for (const item of verificacion.items) {
    const compliance = item.compliance;
    if (!compliance || !ALL_STATUSES.includes(compliance.status)) continue;

    // PR4: trazabilidad activa de rescates por política. El item viene con
    // `_wasFailNonMandatory=true` cuando aptitudPolicyHelper bajó un fail real
    // a `informative` por declaración `obligatorio=false` en el catálogo.
    // Emitimos una alerta advisory con el `_originalCompliance` (el fail real)
    // para que el jefe técnico tenga visibilidad activa de la decisión.
    if (item._wasFailNonMandatory && item._originalCompliance) {
      const codigo = item.ensayoCodigo || item.key;
      // Raw query justificada: filtrar por valor dentro de un campo JSON (`detalle.codigoEnsayo`)
      // requiere `JSON_EXTRACT`, que no está expuesto idiomáticamente por Sequelize.
      // Ver gotcha de comparación más abajo (líneas 82-89).
      const [existing] = await db.sequelize.query(
        `SELECT idAlertaCalidad FROM AlertaCalidad
         WHERE idMaterial = :idMat
           AND estado = 'PENDIENTE'
           AND tipo = 'RESCATE_POR_POLITICA'
           AND JSON_EXTRACT(detalle, '$.codigoEnsayo') = :codigo
         LIMIT 1`,
        { replacements: { idMat: ag.idAgregado, codigo } }
      );
      if (!existing || existing.length === 0) {
        const alerta = await alertarRescatePorPolitica(
          db,
          { idAgregadoEnsayo: 0, tipo: { codigo, nombre: item.parametro || codigo } },
          item._originalCompliance,
          ag
        );
        if (alerta) created.push(alerta);
      }
      continue;  // el item rescatado ya no dispara la alerta normal de informative
    }

    if (!disparableStatuses.has(compliance.status)) continue;

    // Anti-duplicado: skip si ya hay PENDIENTE con mismo material + codigo + status.
    //
    // ⚠ GOTCHA — JSON_EXTRACT y comparaciones (descubierto en smoke C9.3):
    // JSON_EXTRACT(json_col, '$.field') devuelve el valor con comillas
    // embebidas (ej: '"IRAM1674..."', no 'IRAM1674...'). Por eso:
    //   - `JSON_EXTRACT(...) = :bind` ✅ funciona (Sequelize coerce el bind)
    //   - `JSON_EXTRACT(...) IN ('literal')` ✗ NO matchea
    //   - `JSON_UNQUOTE(JSON_EXTRACT(...)) IN ('literal')` ✅ alternativa
    // Si agregás otra query similar, usá uno de los patrones que funcionan.
    const codigo = item.ensayoCodigo || item.key;
    const [existing] = await db.sequelize.query(
      `SELECT idAlertaCalidad FROM AlertaCalidad
       WHERE idMaterial = :idMat
         AND estado = 'PENDIENTE'
         AND JSON_EXTRACT(detalle, '$.codigoEnsayo') = :codigo
         AND JSON_EXTRACT(detalle, '$.complianceStatus') = :status
       LIMIT 1`,
      { replacements: { idMat: ag.idAgregado, codigo, status: compliance.status } }
    );
    if (existing && existing.length > 0) continue;

    const alerta = await alertarResultadoFueraDeEspec(
      db,
      { idAgregadoEnsayo: 0, tipo: { codigo, nombre: item.parametro || codigo } },
      { compliance, estado: item.estado, mensaje: item.detalle },
      ag,
      options
    );
    if (alerta) created.push(alerta);
  }
  return created;
}
const { calcularIdaPonderado } = require('../domain/dosificacion/idaCalc');
const { deriveFormaFromItems } = require('../domain/dosificacion/mezclaDerivedMeta');
const { getAggregateFormaMetaMap } = require('./agregadoMetaLookup');
const { getCaracterizacion } = require('./agregadoEnsayoService');
const { normalizeMedidos, interpolarLogLineal, evalAgainstSpec } = require('./granulometriaEvalService');
const { getCurvaCementoParaDosificacion } = require('./curvaCementoService');
const { calcularCorreccionHumedad } = require('../domain/dosificacion/correccionHumedad');
const { validateTransition, isDeletable, isImmutable, availableActions, getTransitionRequirements } = require('../domain/dosificacion/estadoMachine');
const { calcularHash, buildDatosDosificacion, verificarIntegridad, HASH_SCHEMA_VERSION_ACTUAL } = require('../domain/dosificacion/hashIntegridad');
const crypto = require('crypto');

/**
 * Generate a short human-readable code: PREFIX-XXXXXX
 * Uses 6 alphanumeric chars from a random hash.
 */
function generarCodigo(prefix = 'DOS') {
  const rand = crypto.randomBytes(4).toString('base64url').substring(0, 6).toUpperCase();
  return `${prefix}-${rand}`;
}

function parseJsonField(rawValue, fieldName, { required = false } = {}) {
  if (rawValue == null || rawValue === '') {
    if (required) {
      throw Object.assign(new Error(`No se pudo guardar el diseño: falta ${fieldName}.`), {
        statusCode: 422,
        details: [{ campo: fieldName, msg: `El campo ${fieldName} es obligatorio para guardar el diseño.` }],
      });
    }
    return null;
  }

  if (typeof rawValue === 'object') return rawValue;

  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch (_) {
      throw Object.assign(new Error(`No se pudo guardar el diseño: ${fieldName} inválido.`), {
        statusCode: 422,
        details: [{ campo: fieldName, msg: `El campo ${fieldName} debe ser un JSON válido.` }],
      });
    }
  }

  throw Object.assign(new Error(`No se pudo guardar el diseño: ${fieldName} inválido.`), {
    statusCode: 422,
    details: [{ campo: fieldName, msg: `El campo ${fieldName} tiene un tipo no soportado.` }],
  });
}

function validateSavePayload(data, parsed) {
  const details = [];

  if (!data?.nombre || !String(data.nombre).trim()) {
    details.push({ campo: 'nombre', msg: 'Ingrese un nombre para guardar el diseño.' });
  }
  if (!data?.idPlanta) {
    details.push({ campo: 'idPlanta', msg: 'Debe seleccionar una planta.' });
  }
  // [DEBUG-DOSIF] La dosificación de depuración admite cualquier combinación de
  // materiales (incluso sólo agua): no exige mezcla ni cemento. La planta sigue
  // siendo obligatoria (el destino del despacho a Betonmatic).
  const _esDebugSave = esTipologiaDebug(data?.tipologiaCodigo)
    || parsed?.trazabilidadJson?.metodoCalculo === 'DEBUG'
    || parsed?.trazabilidadJson?.esDebug === true;
  if (!_esDebugSave) {
    if (!data?.idMezcla) {
      details.push({ campo: 'idMezcla', msg: 'Debe seleccionar una mezcla granulométrica.' });
    }
    if (!data?.idCemento) {
      details.push({ campo: 'idCemento', msg: 'Debe seleccionar un cemento.' });
    }
  }
  // RDC/HRDC es sólo arena (sin agregado grueso): no tiene TMN ni "forma del
  // agregado grueso". Alivianado (sesión 2026-05-29) tampoco exige TMN ni
  // forma porque está fuera de CIRSOC y la banda IRAM 1627 no aplica. El
  // path de cálculo exime a ambos; el de guardado debe hacer lo mismo.
  const _tipCodigoSave = String(data?.tipologiaCodigo || parsed?.parametrosObjetivoJson?.tipologiaCodigo || '').toLowerCase();
  const _esHRDCsave = esTipologiaHRDC(data?.tipologiaCodigo)
    || esTipologiaHRDC(parsed?.parametrosObjetivoJson?.tipologiaCodigo)
    || parsed?.trazabilidadJson?.metodoCalculo === 'HRDC'
    || String(parsed?.trazabilidadJson?.motorVersion || '').toUpperCase().startsWith('HRDC');
  const _esAlivianadoSave = _tipCodigoSave === 'alivianado'
    || parsed?.trazabilidadJson?.metodoCalculo === 'ALIVIANADO';
  // [DEBUG-DOSIF] Debug no tiene TMN ni forma de agregado (puede no tener agregados).
  if (!_esHRDCsave && !_esAlivianadoSave && !_esDebugSave) {
    if (!parsed.parametrosObjetivoJson?.tmnMm) {
      details.push({ campo: 'parametrosObjetivoJson.tmnMm', msg: 'Falta TMN derivado de la mezcla.' });
    }
    if (!parsed.parametrosObjetivoJson?.formaAgregado || parsed.parametrosObjetivoJson.formaAgregado === 'NO_DEFINIDO') {
      details.push({ campo: 'parametrosObjetivoJson.formaAgregado', msg: 'Falta forma del agregado o no pudo derivarse.' });
    }
  }
  if (!parsed.resultadoJson?.aguaLtsM3) {
    details.push({ campo: 'resultadoJson', msg: 'resultadoJson inválido o incompleto.' });
  }
  if (!parsed.trazabilidadJson?.inputs) {
    details.push({ campo: 'trazabilidadJson', msg: 'trazabilidadJson incompleta.' });
  }

  if (details.length > 0) {
    throw Object.assign(new Error(`No se pudo guardar el diseño: ${details[0].msg}`), {
      statusCode: 422,
      details,
    });
  }
}

/* ═══════════════════════════════════════════
   Curvas de diseño — CRUD
   ═══════════════════════════════════════════ */

const getCurvasAguaAsentamiento = async (db) => {
  const rows = await db.CurvaAguaAsentamiento.findAll({ where: { activo: true }, order: [['tmnMm', 'ASC'], ['asentamientoMinMm', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const createCurvaAguaAsentamiento = async (db, data) => {
  const moduloFinura = data.moduloFinura != null ? data.moduloFinura : null;
  const metodo = data.metodo || 'HORMIQUAL';
  return db.CurvaAguaAsentamiento.create({
    nombre: data.nombre,
    tmnMm: data.tmnMm,
    asentamientoMinMm: data.asentamientoMinMm,
    asentamientoMaxMm: data.asentamientoMaxMm,
    aguaLtsM3: data.aguaLtsM3,
    formaAgregado: data.formaAgregado || 'TRITURADO',
    moduloFinura,
    metodo,
    notas: data.notas || null,
  });
};

const updateCurvaAguaAsentamiento = async (db, id, data) => {
  const row = await db.CurvaAguaAsentamiento.findByPk(id);
  if (!row) throw new Error('Curva no encontrada');
  return row.update(data);
};

const deleteCurvaAguaAsentamiento = async (db, id) => {
  const row = await db.CurvaAguaAsentamiento.findByPk(id);
  if (!row) throw new Error('Curva no encontrada');
  await row.update({ activo: false });
  return { action: 'archived' };
};

const getCurvasACResistencia = async (db) => {
  const rows = await db.CurvaACResistencia.findAll({ where: { activo: true }, order: [['edadDias', 'ASC'], ['resistenciaMpa', 'DESC']] });
  return rows.map(r => r.get({ plain: true }));
};

const createCurvaACResistencia = async (db, data) => {
  return db.CurvaACResistencia.create({
    nombre: data.nombre,
    familiaCemento: data.familiaCemento || null,
    edadDias: data.edadDias,
    resistenciaMpa: data.resistenciaMpa,
    acEstimado: data.acEstimado,
    notas: data.notas || null,
  });
};

const updateCurvaACResistencia = async (db, id, data) => {
  const row = await db.CurvaACResistencia.findByPk(id);
  if (!row) throw new Error('Curva no encontrada');
  return row.update(data);
};

const deleteCurvaACResistencia = async (db, id) => {
  const row = await db.CurvaACResistencia.findByPk(id);
  if (!row) throw new Error('Curva no encontrada');
  await row.update({ activo: false });
  return { action: 'archived' };
};

/**
 * Update the factorAjuste for an entire family (all rows with the same familiaCemento).
 */
const updateFactorAjusteFamilia = async (db, familiaCemento, factorAjuste) => {
  if (!familiaCemento) throw new Error('familiaCemento requerido');
  const factor = Number(factorAjuste);
  if (isNaN(factor) || factor < 0.5 || factor > 2.0) throw new Error('factorAjuste debe estar entre 0.50 y 2.00');
  const [count] = await db.CurvaACResistencia.update(
    { factorAjuste: factor },
    { where: { familiaCemento, activo: true } }
  );
  return { familiaCemento, factorAjuste: factor, filasActualizadas: count };
};

/**
 * Get factor de ajuste by family (reads from first active row).
 */
const getFactorAjusteFamilia = async (db, familiaCemento) => {
  if (!familiaCemento) return 1.0;
  const row = await db.CurvaACResistencia.findOne({
    where: { familiaCemento, activo: true },
    attributes: ['factorAjuste'],
  });
  return row ? (Number(row.factorAjuste) || 1.0) : 1.0;
};

const getAireEsperado = async (db) => {
  const rows = await db.AireEsperado.findAll({ where: { activo: true }, order: [['tmnMm', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const getDurabilidadExposicion = async (db) => {
  const rows = await db.DurabilidadExposicion.findAll({ where: { vigente: true }, order: [['orden', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const getAireDurabilidad = async (db) => {
  if (!db.AireDurabilidad) return [];
  const rows = await db.AireDurabilidad.findAll({ order: [['tmnMm', 'ASC'], ['claseExposicion', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const getPulverulentoMinimo = async (db) => {
  if (!db.PulverulentoMinimo) return [];
  const rows = await db.PulverulentoMinimo.findAll({ order: [['tmnMm', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const getConsistencia = async (db) => {
  if (!db.Consistencia) return [];
  const rows = await db.Consistencia.findAll({ order: [['orden', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

const getCorrectoresICPA = async (db) => {
  if (!db.CorrectoresICPA) return [];
  const rows = await db.CorrectoresICPA.findAll({ where: { activo: true }, order: [['tipo', 'ASC'], ['tmnMm', 'ASC']] });
  return rows.map(r => r.get({ plain: true }));
};

/* ─── Ábaco 1 ICPA (agua base = f(asentamiento, MF)) ─── */

const getAbacoCurvaICPA = async (db) => {
  if (!db.AbacoCurvaICPA) return [];
  const rows = await db.AbacoCurvaICPA.findAll({
    where: { activo: true },
    order: [['asentamientoCm', 'ASC'], ['moduloFinura', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

const createAbacoCurvaICPA = async (db, data) => {
  const as = Number(data.asentamientoCm);
  const mf = Number(data.moduloFinura);
  if (as < 4 || as > 20) throw Object.assign(new Error('Asentamiento fuera del dominio válido (4–20 cm).'), { statusCode: 422 });
  if (mf < 3.0 || mf > 6.5) throw Object.assign(new Error('Módulo de finura fuera del dominio válido (3.0–6.5).'), { statusCode: 422 });
  const formaValida = ['CANTO_RODADO', 'TRITURADO', 'MIXTO'];
  const forma = data.formaAgregado && formaValida.includes(data.formaAgregado) ? data.formaAgregado : 'CANTO_RODADO';
  return db.AbacoCurvaICPA.create({
    asentamientoCm: as,
    formaAgregado: forma,
    moduloFinura: mf,
    aguaBaseLM3: Math.round(Number(data.aguaBaseLM3)),
    notas: data.notas || null,
  });
};

const updateAbacoCurvaICPA = async (db, id, data) => {
  const row = await db.AbacoCurvaICPA.findByPk(id);
  if (!row) throw new Error('Punto del Ábaco ICPA no encontrado');
  const updates = {};
  if (data.aguaBaseLM3 != null) updates.aguaBaseLM3 = Math.round(Number(data.aguaBaseLM3));
  if (data.notas !== undefined) updates.notas = data.notas;
  if (data.asentamientoCm != null) {
    const as = Number(data.asentamientoCm);
    if (as < 4 || as > 20) throw Object.assign(new Error('Asentamiento fuera del dominio válido (4–20 cm).'), { statusCode: 422 });
    updates.asentamientoCm = as;
  }
  if (data.moduloFinura != null) {
    const mf = Number(data.moduloFinura);
    if (mf < 3.0 || mf > 6.5) throw Object.assign(new Error('Módulo de finura fuera del dominio válido (3.0–6.5).'), { statusCode: 422 });
    updates.moduloFinura = mf;
  }
  return row.update(updates);
};

const deleteAbacoCurvaICPA = async (db, id) => {
  const row = await db.AbacoCurvaICPA.findByPk(id);
  if (!row) throw new Error('Punto del Ábaco ICPA no encontrado');
  await row.update({ activo: false });
  return { action: 'archived' };
};

/**
 * Restaura los valores ICPA originales del Ábaco 1 — borra todos los puntos
 * y reinserta los 408 (17 asentamientos × 8 MF × 3 formas) desde el módulo
 * de defaults.
 *
 * Cualquier valor customizado por el usuario se pierde — se asume confirmación
 * previa en la UI. Idempotente: correrla dos veces produce el mismo estado.
 */
const restoreAbacoCurvaICPADefaults = async (db) => {
  if (!db.AbacoCurvaICPA) throw Object.assign(new Error('Modelo AbacoCurvaICPA no disponible.'), { statusCode: 500 });
  const { generarFilasDefault } = require('../domain/dosificacion/abacoIcpaDefaults');
  const now = new Date();
  const filas = generarFilasDefault().map(r => ({
    asentamientoCm: r.asentamientoCm,
    formaAgregado: r.formaAgregado,
    moduloFinura: r.moduloFinura,
    aguaBaseLM3: r.aguaBaseLM3,
    notas: r.notas,
    activo: true,
    createdAt: now,
    updatedAt: now,
  }));
  await db.sequelize.transaction(async (t) => {
    await db.AbacoCurvaICPA.destroy({ where: {}, truncate: false, transaction: t });
    await db.AbacoCurvaICPA.bulkCreate(filas, { transaction: t });
  });
  return { restored: filas.length };
};

// CorrectoresICPA: feature deprecada (pestaña UI eliminada). El motor de
// dosificación NO la consume (ver `domain/dosificacion/hormiqualCalcEngine.js`).
// `getCorrectoresICPA` se mantiene únicamente para el endpoint de lectura
// `GET /curvas/correctores-icpa` (controller `getCorrectores`) — útil sólo
// para diagnóstico interno. Si en el futuro se reactiva como tipo AIRE, hay
// que volver a fetcharla en `calcular()` y plumbear al motor.

/* ═══════════════════════════════════════════
   Cálculo de dosificación
   ═══════════════════════════════════════════ */

/**
 * Ejecuta el motor de cálculo a partir de IDs y parámetros del frontend.
 */
const calcular = async (db, body) => {
  const {
    resistenciaMpa, edadDias, asentamientoMm, tmnMm, airePct,
    aireAtrapado, aireIncorporado, aireIntencional,
    formaAgregado,
    cementoId, adicion1, adicion2, aditivo1, aditivo2, aditivo3,
    mezclaId,
    idPlanta,
    // ICPA-specific
    fce, desvioS, exposicion, moduloFinura: manualMF,
    tipoHormigonEstructural,
    factorPrudencialCurva,
    modoCurvaAC,
    acMaxPliego, amcMaxPliego, cementoMinPliego, acModo,
    // Consistencia CIRSOC 200:2024
    consistenciaClase, consistenciaMetodo, consistenciaValor,
    // Corrección por humedad
    humedadAgregados,
    // Método de colocación (R4 — relevante para excepción §4.1.3 pulverulento)
    metodoColocacion,
  } = body;

  // [DEBUG-DOSIF] Dosificación de depuración: motor "echo", sin validaciones
  // normativas, sin fetch de entidades, sin cierre volumétrico. Salimos por acá
  // ANTES de exigir cemento/mezcla. Sólo se activa con el flag de ambiente.
  if (esTipologiaDebug(body.tipologiaCodigo)) {
    if (!debugDosificacionHabilitado()) {
      throw Object.assign(
        new Error('El modo de dosificación de depuración no está habilitado en este entorno.'),
        { statusCode: 403, code: 'DEBUG_DOSIF_DESHABILITADO' },
      );
    }
    return _calcularDebug(body);
  }

  // ── Early validations ──
  const _esHRDC = esTipologiaHRDC(body.tipologiaCodigo);
  // Sesión 2026-05-29: Hormigón Alivianado (telgopor en perlas). Modelo
  // análogo a HRDC: fuera de CIRSOC, motor propio en `alivianadoCalcEngine`.
  // Estructuralmente PARTE de un hormigón normal (ICPA) y sustituye volumen
  // del AG por el agregado liviano elegido + dosis declarada en L/m³.
  const _esAlivianado = esTipologiaAlivianado(body.tipologiaCodigo);
  if (!cementoId) throw Object.assign(new Error('Debe seleccionar un cemento.'), { statusCode: 422 });
  if (!idPlanta) throw Object.assign(new Error('Debe seleccionar una planta.'), { statusCode: 422 });
  if (_esAlivianado) {
    // Alivianado (telgopor en perlas u otro liviano manufacturado): modelo
    // NO normativo, fuera de CIRSOC 200. Cemento (CUC) directo + agua desde
    // consistencia (anclas HRDC). f'c es OPCIONAL — el objetivo no es
    // resistencia sino aislación térmica / aligeramiento.
    if (body.cementoKgM3 == null || Number(body.cementoKgM3) <= 0) {
      throw Object.assign(
        new Error('Alivianado: debe indicar el contenido de cemento por m³ (kg/m³).'),
        { statusCode: 422, code: 'ALIVIANADO_FALTA_CEMENTO' },
      );
    }
    if (!asentamientoMm && asentamientoMm !== 0 && !consistenciaValor) {
      throw Object.assign(
        new Error('Alivianado: debe indicar el asentamiento o valor de consistencia objetivo.'),
        { statusCode: 422 },
      );
    }
    if (!body.idMaterialLiviano) {
      throw Object.assign(
        new Error('Hormigón alivianado: debe seleccionar el material liviano del catálogo (telgopor, perlita, etc.).'),
        { statusCode: 422, code: 'ALIVIANADO_FALTA_MATERIAL_LIVIANO' },
      );
    }
    if (body.dosisPerlasLM3 == null || Number(body.dosisPerlasLM3) <= 0) {
      throw Object.assign(
        new Error('Hormigón alivianado: debe indicar la dosis de perlas en L/m³ (típico ~240).'),
        { statusCode: 422, code: 'ALIVIANADO_FALTA_DOSIS' },
      );
    }
  } else if (!_esHRDC) {
    // Estructural CIRSOC: f'ce y asentamiento son obligatorios
    if (!asentamientoMm && asentamientoMm !== 0 && !consistenciaValor) throw Object.assign(new Error('Debe indicar el asentamiento o valor de consistencia objetivo.'), { statusCode: 422 });
    if (!fce && !resistenciaMpa) throw Object.assign(new Error("Debe indicar f'ce (resistencia especificada)."), { statusCode: 422 });
  } else {
    // HRDC/RDC (modelo Fase 3, Segerer 2017 / AAHE N°16): cemento (CUC) input
    // directo + consistencia objetivo (gobierna el agua). f'c es OPCIONAL
    // (a veces el RDC es sólo relleno sin requisito de resistencia).
    if (body.cementoKgM3 == null || Number(body.cementoKgM3) <= 0) {
      throw Object.assign(new Error('HRDC: debe indicar el contenido de cemento por m³ (kg/m³).'), { statusCode: 422 });
    }
    if (!asentamientoMm && asentamientoMm !== 0 && !consistenciaValor) {
      throw Object.assign(new Error('HRDC: debe indicar la consistencia objetivo (asentamiento o extendido de cono): de ella se deriva el agua del RDC.'), { statusCode: 422 });
    }
  }

  // ── Fetch referenced entities ──
  // Include Agregado (with AgregadoGrueso) in mezcla items to get names, densities, and coarse/fine classification
  const mezclaInclude = [
    {
      model: db.MezclaAgregadosItem, as: 'items',
      include: db.Agregado ? [{
        model: db.Agregado, as: 'agregado',
        attributes: ['idAgregado', 'nombre', 'densidad', 'absorcion', 'ida', 'idaModo'],
        include: [
          ...(db.AgregadoGrueso ? [{ model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false }] : []),
          ...(db.AgregadoFino ? [{ model: db.AgregadoFino, as: 'agregadoFino', required: false }] : []),
        ],
      }] : [],
    },
  ];
  const fetchPromises = [
    cementoId ? db.Cemento.findByPk(cementoId).then(r => r?.get({ plain: true })) : null,
    mezclaId ? db.MezclaAgregados.findByPk(mezclaId, {
      include: mezclaInclude,
    }).then(r => r?.get({ plain: true })) : null,
    getCurvasAguaAsentamiento(db),
    getCurvasACResistencia(db),
    getAireEsperado(db),
    getDurabilidadExposicion(db),
    // CorrectoresICPA: tabla vacía tras migración 20260315 (TMN/FORMA legacy
    // desactivados; reservada para futuras correcciones AIRE). El motor no la
    // consume — ver `domain/dosificacion/hormiqualCalcEngine.js:881-888`. No se
    // fetcha aquí para evitar un roundtrip por cálculo.
    getAbacoCurvaICPA(db),
    getAireDurabilidad(db),
    getPulverulentoMinimo(db),
    getConsistencia(db),
  ];

  const results = await Promise.all(fetchPromises);
  const [cemento, mezcla, curvasAgua, curvasAC, aireEsperado, durabilidadExposicion, abacoCurvasReferencia, aireDurabilidad, pulverulentoMinimo, consistenciaClases] = results;

  if (!cemento) throw Object.assign(new Error('Cemento no encontrado.'), { statusCode: 422 });

  // ── Enrich mezcla items with granulometry metadata (date, test ID, full curve) ──
  if (mezcla?.items?.length) {
    const { getUltimaGranulometria } = require('./mezclaService');
    await Promise.all(mezcla.items.map(async (item) => {
      const idAg = item.idAgregado || item.legacyAgregadoId || item.agregado?.idAgregado;
      if (!idAg) return;
      try {
        const grano = await getUltimaGranulometria(db, idAg);
        if (grano) {
          item._granulometriaFecha = grano.fechaEnsayo;
          item._granulometriaEnsayoId = grano.idAgregadoEnsayo;
          item._granulometriaCodigo = grano.codigo;
          // Full curve for the new "Granulometrias individuales" annex
          item._granulometriaPuntos = (grano.puntos || []).map(p => ({
            aberturaMm: p.aberturaMm,
            tamiz: p.tamiz || null,
            pasaPct: p.pasaPct,
          }));
          // Extract key sieve values for traceability (pasante 300µm, 75µm)
          const p300 = grano.puntos?.find(p => Math.abs(p.aberturaMm - 0.3) < 0.02);
          const p075 = grano.puntos?.find(p => Math.abs(p.aberturaMm - 0.075) < 0.01);
          item._pasante300um = p300?.pasaPct ?? null;
          item._pasante75um = p075?.pasaPct ?? null;
        }
      } catch { /* non-blocking */ }
    }));
  }

  // ROUND-X: Derive estadoTecnico from the saved mezcla metadata so the PDF
  // can detect non-conformant base mixtures and block "APTO" state.
  // estadoTecnico: CUMPLE | CUMPLE_OBS | REQUIERE_AJUSTE | NO_CUMPLE
  if (mezcla && !mezcla.estadoTecnico) {
    try {
      let meta = mezcla.metadataResultadoJson;
      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
      const evalB = meta?.evaluacionBanda || meta?.evaluacion;
      if (evalB) {
        const cumpleB = evalB.cumple === true || evalB.estado === 'CUMPLE';
        const nFuera = (evalB.fueraDeBanda || []).length;
        const maxDesv = (evalB.fueraDeBanda || []).reduce((m, t) => Math.max(m, Math.abs(t.desvio || 0)), 0);
        if (cumpleB) {
          mezcla.estadoTecnico = 'CUMPLE';
        } else if (nFuera <= 2 && maxDesv <= 3) {
          mezcla.estadoTecnico = 'CUMPLE_OBS';
        } else if (nFuera > 0 && nFuera <= 4) {
          mezcla.estadoTecnico = 'REQUIERE_AJUSTE';
        } else {
          mezcla.estadoTecnico = 'NO_CUMPLE';
        }
      }
    } catch { /* non-blocking */ }
  }

  // ── Load age factors β(t) for non-28d designs ──
  const cementoTipo = cemento.composicion || 'CPN';
  const factoresEdadMap = await getFactoresEdadParaCemento(db, cementoTipo);
  const edadDiasNum = Number(edadDias);
  const factorEdad = (edadDiasNum !== 28 && factoresEdadMap[edadDiasNum] != null)
    ? factoresEdadMap[edadDiasNum]
    : null;

  // Resolver curva y factor de ajuste según configuración del cemento en la planta (CementoPlanta).
  // Si el body trae modoCurvaAC, override puntual al pivote (ej: comparar dos modos en runtime).
  const { curva: curvaCemento, origen: curvaCementoOrigen, factorAjuste: factorAjustePlanta, modo: modoCurvaCP, cementoPlanta: cementoPlantaCfg } =
    await getCurvaCementoParaDosificacion(db, cemento, idPlanta, { modoOverride: modoCurvaAC });
  // Compatibilidad con motor: la variable factorAjusteICPA se mantiene como nombre interno
  const factorAjusteICPA = factorAjustePlanta;
  if (!cemento.densidadRelativa) throw Object.assign(new Error('El cemento seleccionado no tiene densidad real cargada. Complete la ficha técnica del cemento antes de calcular.'), { statusCode: 422 });

  // PR3 — Validar que cada material referenciado esté habilitado en la planta
  // seleccionada. Antes el motor levantaba materiales por ID sin chequear el
  // pivot MaterialPlanta, lo que permitía mezclar en el cálculo materiales
  // que la planta no tenía dados de alta. La validación de cemento ya vive en
  // getCurvaCementoParaDosificacion (vía CementoPlanta); acá cubrimos aditivos,
  // adiciones y fibras (vía MaterialPlanta).
  const { requireHabilitado: _requireHabilitadoEnPlanta } = require('./materialPlantaService');

  // Fetch adiciones if provided
  let adicion1Data = null, adicion2Data = null;
  if (adicion1?.id) {
    await _requireHabilitadoEnPlanta(db, 'adicion', adicion1.id, idPlanta);
    const mat = await db.Material.findByPk(adicion1.id);
    if (mat) adicion1Data = { ...mat.get({ plain: true }), reemplazoPct: adicion1.reemplazoPct || 0 };
  }
  if (adicion2?.id) {
    await _requireHabilitadoEnPlanta(db, 'adicion', adicion2.id, idPlanta);
    const mat = await db.Material.findByPk(adicion2.id);
    if (mat) adicion2Data = { ...mat.get({ plain: true }), reemplazoPct: adicion2.reemplazoPct || 0 };
  }

  // Fetch aditivos if provided
  let aditivo1Data = null, aditivo2Data = null, aditivo3Data = null;
  const fetchAditivo = async (adit) => {
    if (!adit?.id) return null;
    await _requireHabilitadoEnPlanta(db, 'aditivo', adit.id, idPlanta);
    const row = await db.Aditivo.findByPk(adit.id);
    if (!row) return null;
    const plain = row.get({ plain: true });
    return {
      ...plain,
      dosis: adit.dosis,
      modoEfecto: adit.modoEfecto,
      etapa: adit.etapa === 'OBRA' ? 'OBRA' : 'PLANTA',
      esCorreccion: adit.esCorreccion === true,
      unidadDosificacion: plain.unidadDosificacion || 'PORC_SOBRE_CEMENTO',
    };
  };
  [aditivo1Data, aditivo2Data, aditivo3Data] = await Promise.all([
    fetchAditivo(aditivo1),
    fetchAditivo(aditivo2),
    fetchAditivo(aditivo3),
  ]);

  // Validate aditivos have minimum required technical data.
  // Checks: tipo funcional, densidad, at least one effect, and effect-specific data for chosen modoEfecto.
  const validateAditivo = (data, label) => {
    if (!data) return;
    if (!data.densidad) throw Object.assign(new Error(`${label} no tiene densidad cargada. Complete la ficha técnica.`), { statusCode: 422 });
    // Informational effects only require density (for volume calc) — skip further technical validation
    const _efectosConCalculo = new Set(['AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO']);
    if (data.modoEfecto && !_efectosConCalculo.has(data.modoEfecto)) return;
    // Calculation effects require full technical data
    if (!data.tipoFuncional) throw Object.assign(new Error(`${label} no tiene tipo funcional definido. Complete la ficha técnica.`), { statusCode: 422 });
    const hasEffect = data.reduccionAguaPctEsperada || data.incrementoAsentamientoEsperado || data.aireIncorporadoPctEsperado || data.retardoEsperadoMin;
    if (!hasEffect) throw Object.assign(new Error(`${label} no tiene ningún efecto técnico definido (reducción de agua, incremento de asentamiento, aire incorporado o retardo). Complete la ficha técnica.`), { statusCode: 422 });
    if (data.modoEfecto === 'AHORRO_AGUA' && !data.reduccionAguaPctEsperada) {
      throw Object.assign(new Error(
        `${label} está configurado con efecto "Ahorro de agua" pero no tiene reducción de agua esperada (%) cargada en su ficha técnica. Actualice la ficha técnica del aditivo o cambie el modo de efecto.`
      ), { statusCode: 422 });
    }
    if (data.modoEfecto === 'AUMENTO_ASENTAMIENTO' && !data.incrementoAsentamientoEsperado) {
      throw Object.assign(new Error(
        `${label} está configurado con efecto "Aumento de asentamiento" pero no tiene incremento de asentamiento esperado (mm) cargado en su ficha técnica. Actualice la ficha técnica del aditivo o cambie el modo de efecto.`
      ), { statusCode: 422 });
    }
  };
  validateAditivo(aditivo1Data, 'Aditivo 1');
  validateAditivo(aditivo2Data, 'Aditivo 2');
  validateAditivo(aditivo3Data, 'Aditivo 3');

  // Enrich mezcla items with aggregado data (names, densities, coarse/fine)
  let mezclaData = null;
  let derivedForma = formaAgregado || null;
  if (mezcla) {
    // PR4 — Validar que cada agregado de la mezcla esté habilitado en la planta
    // seleccionada. Es el equivalente del check que ya hacemos para
    // aditivo/adicion/fibra: el catálogo del tenant es soberano por planta.
    const idsAgMezcla = (mezcla.items || []).map(it => it.idAgregado).filter(Boolean);
    for (const idAg of idsAgMezcla) {
      try {
        await _requireHabilitadoEnPlanta(db, 'agregado', idAg, idPlanta);
      } catch (e) {
        // Si el code es MATERIAL_NO_HABILITADO_EN_PLANTA, propagamos con el
        // nombre del agregado para que el mensaje de error sea claro.
        if (e?.code === 'MATERIAL_NO_HABILITADO_EN_PLANTA') {
          const item = mezcla.items.find(it => it.idAgregado === idAg);
          const nombre = item?.agregado?.nombre || `Agregado ${idAg}`;
          throw Object.assign(
            new Error(`El agregado "${nombre}" no está habilitado en la planta indicada.`),
            { statusCode: 422, code: 'AGREGADO_NO_HABILITADO_EN_PLANTA' }
          );
        }
        throw e;
      }
    }

    const items = (mezcla.items || []).map(it => {
      const ag = it.agregado || {};
      const _esGrueso = !!ag.agregadoGrueso;
      const _esFino = !!ag.agregadoFino;
      // PR — Pred-fresco bug "Sin datos: Proporción FINO/GRUESO": el motor de
      // predicción busca `tipo` o `tipoAgregado` en cada item para sumar finos
      // y calcular proporción. Antes solo pasábamos `esGrueso`/`esFino` y
      // quedaba null. Derivamos `tipo` aquí para que llegue al engine.
      const _tipo = _esFino ? 'FINO' : (_esGrueso ? 'GRUESO' : null);
      return {
        nombre: ag.nombre || `Agregado ${it.idAgregado}`,
        porcentaje: it.porcentajeFinal ?? it.porcentaje,
        densidad: ag.densidad ? Number(ag.densidad) : null,
        absorcionFicha: ag.absorcion != null ? Number(ag.absorcion) : null,
        idAgregado: it.idAgregado,
        esGrueso: _esGrueso,
        esFino: _esFino,
        tipo: _tipo,
        tipoAgregado: _tipo,
        ida: ag.ida != null ? Number(ag.ida) : 1.000,
        idaModo: ag.idaModo || 'auto',
      };
    });

    // PR5: validar ensayos funcionales del motor de cálculo de hormigón antes
    // de invocar el motor (densidad, granulometría hormigón, pasa #200). Sin
    // estos datos el cálculo arroja NaN o resultados inválidos. NO aplica a
    // HRDC ni a Alivianado — sus inputs funcionales son distintos (cemento
    // como input directo + agua desde consistencia).
    if (!_esHRDC && !_esAlivianado) {
      const { validarEnsayosFuncionalesParaDosificacion, buildEnsayosFuncionalesError } =
        require('../domain/dosificacion/ensayosFuncionalesGuard');

      // PR9-fix: NO canonicalizar el código antes del guard. El guard del motor
      // distingue variantes (HORMIGON vs TBS) que la canonicalización colapsa
      // al mismo target. La canonicalización es para schemas/form, no para
      // verificación de presencia. El guard internamente acepta lista de
      // códigos equivalentes (`codigosAceptados`) para cubrir back-compat.
      const idsAg = items.map((it) => it.idAgregado).filter(Boolean);
      const codigosPorAgregado = new Map();
      if (idsAg.length > 0) {
        const ensayosCargados = await db.AgregadoEnsayo.findAll({
          where: {
            legacyAgregadoId: { [db.Sequelize.Op.in]: idsAg },
            isActive: true,
          },
          attributes: ['legacyAgregadoId'],
          include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo', attributes: ['codigo'] }],
        });
        for (const e of ensayosCargados) {
          const idAg = e.legacyAgregadoId;
          const codigoLiteral = e.tipo?.codigo || '';
          if (!codigoLiteral) continue;
          if (!codigosPorAgregado.has(idAg)) codigosPorAgregado.set(idAg, new Set());
          codigosPorAgregado.get(idAg).add(codigoLiteral);
        }
      }

      const agregadosParaValidar = items.map((it) => ({
        id: it.idAgregado,
        nombre: it.nombre,
        esFino: it.esFino,
        codigosCargados: Array.from(codigosPorAgregado.get(it.idAgregado) || []),
      }));
      const { ok, faltantes } = validarEnsayosFuncionalesParaDosificacion(agregadosParaValidar);
      if (!ok) {
        throw buildEnsayosFuncionalesError(faltantes);
      }
    }

    // Enrich aggregate items with density and absorption from ensayo characterization.
    // Density priority: A. Agregado.densidad (ficha técnica / ensayo consolidation)
    //                   B. Ensayo characterization: densidadRelativaAparenteSSS → Seca → Real
    // Absorcion priority: A. Ensayo IRAM 1520/1533 absorcionPct (fetched when calling getCaracterizacion)
    //                     B. Agregado.absorcion (ficha técnica)
    for (const it of items) {
      const hasFichaDensidad = !!it.densidad;
      const hasFichaAbsorcion = it.absorcionFicha != null;

      if (hasFichaDensidad) {
        it.densidadOrigen = 'MATERIAL_AGREGADO';
        if (hasFichaAbsorcion) {
          it.absorcion = it.absorcionFicha;
          it.absorcionOrigen = 'MATERIAL_AGREGADO';
          // Don't skip — still need to fetch p300 for pulverulento calculation
        }
        // Density from ficha but no absorption — fall through to fetch absorption from ensayos
      }

      try {
        const caract = await getCaracterizacion(db, it.idAgregado);

        // Density from ensayo (only if ficha didn't provide it)
        if (!hasFichaDensidad) {
          const densSSS  = caract?.densidadRelativaAparenteSSS?.valor;
          const densSeca = caract?.densidadRelativaAparenteSeca?.valor;
          const densReal = caract?.densidadRelativaReal?.valor;
          const densValor = densSSS ?? densSeca ?? densReal ?? null;
          if (densValor != null) {
            it.densidad = Number(densValor);
            it.densidadOrigen = 'ENSAYO_AGREGADO';
            it.densidadEnsayoId = caract?.densidadRelativaAparenteSSS?.idAgregadoEnsayo
              ?? caract?.densidadRelativaAparenteSeca?.idAgregadoEnsayo
              ?? caract?.densidadRelativaReal?.idAgregadoEnsayo
              ?? null;
          }
        }

        // Absorcion from ensayo (IRAM 1520/1533)
        const absValor = caract?.absorcionPct?.valor;
        if (absValor != null) {
          it.absorcion = Number(absValor);
          it.absorcionOrigen = 'ENSAYO_AGREGADO';
          it.absorcionEnsayoId = caract?.absorcionPct?.idAgregadoEnsayo ?? null;
        } else if (hasFichaAbsorcion) {
          it.absorcion = it.absorcionFicha;
          it.absorcionOrigen = 'MATERIAL_AGREGADO';
        }

        // p300: % passing 300 μm (tamiz N° 50) for pulverulento calculation
        const granuData = caract?.granulometria?.valor;
        if (granuData?.tamices?.length > 0) {
          try {
            const medidos = normalizeMedidos(granuData.tamices);
            if (medidos.length > 0) {
              const pasa300 = interpolarLogLineal(medidos, 0.30);
              if (pasa300 != null) {
                it.p300 = Number(pasa300);
              }
            }
          } catch (_p300Err) {
            /* non-blocking */
          }
        }
      } catch (_) {
        /* non-blocking: if ensayo service unavailable, proceed without density/absorcion */
        if (hasFichaAbsorcion) {
          it.absorcion = it.absorcionFicha;
          it.absorcionOrigen = 'MATERIAL_AGREGADO';
        }
      }
    }

    mezclaData = { idMezcla: mezcla.idMezcla, nombre: mezcla.nombre, tmnCalculadoMm: mezcla.tmnCalculadoMm, moduloFinura: mezcla.moduloFinura || null, curvaMezclaJson: mezcla.curvaMezclaJson || null, items };

    if (!formaAgregado || formaAgregado === 'AUTO' || mezclaId) {
      const aggregateIds = items.map((it) => it.idAgregado).filter(Boolean);
      const metaMap = await getAggregateFormaMetaMap(db, aggregateIds);
      derivedForma = deriveFormaFromItems(items, metaMap);
    }
  }

  // Resolve effective TMN: prefer mezcla's calculated TMN, then manual
  const effectiveTmn = (mezclaData && mezclaData.tmnCalculadoMm) ? Number(mezclaData.tmnCalculadoMm) : (tmnMm ? Number(tmnMm) : null);
  if (!effectiveTmn && !_esHRDC && !_esAlivianado) throw Object.assign(new Error('No se pudo determinar el TMN. Seleccione una mezcla con TMN calculado o indique el TMN manualmente.'), { statusCode: 422 });

  // En HRDC la mezcla puede ser sólo arena (sin AG): la forma derivada cae en
  // 'NO_DEFINIDO' y eso es admisible. El motor HRDC usa por defecto TRITURADO
  // para consultar el Ábaco 1 (ver hrdcCalcEngine.formaAgregado default).
  const effectiveForma = mezclaData ? (derivedForma || 'NO_DEFINIDO') : (derivedForma || 'NO_DEFINIDO');
  if (effectiveForma === 'NO_DEFINIDO' && !_esHRDC && !_esAlivianado) {
    throw Object.assign(new Error('No se pudo determinar la forma del agregado grueso a partir de la mezcla seleccionada.'), {
      statusCode: 422,
      details: [{ campo: 'formaAgregado', msg: 'Revise la clasificación de los agregados gruesos o sus nombres en la mezcla.' }],
    });
  }

  // Metadata about derived values — included in response for frontend display
  const tmnSource = (mezclaData && mezclaData.tmnCalculadoMm) ? 'MEZCLA' : 'MANUAL';
  // Forma always derives from the mezcla's aggregate classification when a mezcla is present
  const formaSource = mezclaData ? 'MEZCLA' : 'MANUAL';
  const derivedMeta = { effectiveTmn, effectiveForma, tmnSource, formaSource };

  // ── Branch Alivianado ───────────────────────────────────────────────────
  // Sesión 2026-05-29: Hormigón Alivianado (telgopor en perlas u otro
  // liviano manufacturado) tiene su propio motor independiente, análogo a
  // HRDC. Fuera de CIRSOC 200, sin verificaciones IRAM/CIRSOC. Cemento
  // input directo, agua desde consistencia (anclas Segerer), f'c opcional.
  if (_esAlivianado) {
    let plantaAlivianadoCfg = null;
    try {
      const pl = await db.Planta.findByPk(idPlanta, {
        attributes: ['idPlanta', 'rdcFactorAguaConsistencia'],
      });
      if (pl) plantaAlivianadoCfg = {
        factorAguaConsistencia: pl.rdcFactorAguaConsistencia != null
          ? Number(pl.rdcFactorAguaConsistencia)
          : 1.0,
      };
    } catch { /* migración pendiente → factor 1.0 */ }
    // Preservar el slot index del aditivo para que la trazabilidad emita
    // `aditivo: "Aditivo N"` con el N correcto incluso si hay huecos.
    const aditivosConSlot = [aditivo1Data, aditivo2Data, aditivo3Data]
      .map((a, idx) => (a ? { ...a, slotIdx: idx } : null))
      .filter(Boolean);
    return await _calcularAlivianado({
      db,
      body, cemento, mezclaData,
      aditivosCargados: aditivosConSlot,
      derivedMeta, effectiveTmn, effectiveForma,
      plantaAlivianadoCfg,
    });
  }
  // ────────────────────────────────────────────────────────────────────────

  // ── Branch HRDC ─────────────────────────────────────────────────────────
  // HRDC tiene un flujo de cálculo separado (cemento input directo, agua del
  // Ábaco 1 con asentamiento fijo 20 cm, sin curva de a/c, sin verificación
  // CIRSOC). Si la tipología es HRDC, salimos por acá con el shape
  // compatible al endpoint y omitimos toda la lógica ICPA estándar y las
  // verificaciones (IRAM 1627, aptitud CIRSOC, etc.).
  if (_esHRDC) {
    // Fase 2: parámetros RDC por planta. Si la migración 20260518 aún no
    // corrió, el SELECT de columnas inexistentes lanza → fallback silencioso
    // a los defaults citados del motor (no rompe el cálculo).
    let plantaRdcCfg = null;
    try {
      const pl = await db.Planta.findByPk(idPlanta, {
        attributes: ['idPlanta', 'rdcModoDensidad', 'rdcPuvObjetivoKgM3', 'rdcReduccionPct', 'rdcPuvToleranciaKgM3', 'rdcFactorAguaConsistencia'],
      });
      if (pl) plantaRdcCfg = {
        rdcModoDensidad: pl.rdcModoDensidad,
        rdcPuvObjetivoKgM3: pl.rdcPuvObjetivoKgM3 != null ? Number(pl.rdcPuvObjetivoKgM3) : null,
        rdcReduccionPct: pl.rdcReduccionPct != null ? Number(pl.rdcReduccionPct) : null,
        rdcPuvToleranciaKgM3: pl.rdcPuvToleranciaKgM3 != null ? Number(pl.rdcPuvToleranciaKgM3) : null,
        rdcFactorAguaConsistencia: pl.rdcFactorAguaConsistencia != null ? Number(pl.rdcFactorAguaConsistencia) : null,
      };
    } catch { /* migración pendiente → defaults del motor */ }
    return await _calcularHRDC({
      body, cemento, mezclaData, abacoCurvasReferencia,
      aditivosCargados: [aditivo1Data, aditivo2Data, aditivo3Data].filter(Boolean),
      derivedMeta, effectiveTmn, effectiveForma,
      curvaCemento, // para estimar resistencia probable
      plantaRdcCfg,
    });
  }
  // ────────────────────────────────────────────────────────────────────────

  // Helper: build additive display name avoiding duplicated substrings
  const buildAditivoNombre = (ad) => {
    if (!ad) return null;
    const marca = (ad.marca || '').trim();
    const funcion = (ad.funcion || '').trim();
    if (!marca && !funcion) return null;
    if (!funcion) return marca;
    if (!marca) return funcion;
    // Detect overlap: if marca ends with a substring that funcion starts with, skip funcion
    const lower = s => s.toLowerCase();
    if (lower(marca).includes(lower(funcion)) || lower(funcion).includes(lower(marca))) {
      return marca.length >= funcion.length ? marca : funcion;
    }
    return `${marca} ${funcion}`;
  };

  // Context labels for fuentesCalculo (display names for materials/mezcla)
  const engineContext = {
    cementoNombre: cemento.nombreComercial
      ? `${cemento.nombreComercial}${cemento.fabricante ? ` — ${cemento.fabricante}` : ''}`.trim()
      : null,
    mezclaNombre: mezclaData?.nombre || null,
    adicion1Nombre: adicion1Data?.nombre || null,
    adicion2Nombre: adicion2Data?.nombre || null,
    aditivo1Nombre: buildAditivoNombre(aditivo1Data),
    aditivo2Nombre: buildAditivoNombre(aditivo2Data),
    aditivo3Nombre: buildAditivoNombre(aditivo3Data),
    tmnSource,
    formaSource,
    expuestoDesgaste: !!body.expuestoDesgaste,
    aspectoSuperficialImportante: !!body.aspectoSuperficialImportante,
    tipologiaCodigo: body.tipologiaCodigo || null,
    tipologiaNombre: null, // enriched below if tipología exists
  };

  // ── Compute IDA ponderado from mezcla aggregates ──
  let idaPonderadoResult = { idaPonderado: 1.000, detalles: [] };
  if (mezclaData && mezclaData.items?.length) {
    const idaComponentes = mezclaData.items.map(it => ({
      nombre: it.nombre,
      volumenLts: it.porcentaje || 0,  // porcentaje ≈ volume proportion for weighted avg
      ida: it.ida || 1.000,
    }));
    idaPonderadoResult = calcularIdaPonderado(idaComponentes);
  }

  // ── Consistency resolution ──
  // If new consistency system is used, derive asentamientoMm equivalent for the engine
  let effectiveAsentamientoMm = asentamientoMm != null ? Number(asentamientoMm) : null;
  let consistenciaInfo = null;

  if (consistenciaClase && consistenciaValor != null) {
    const claseRow = consistenciaClases.find(c => c.codigo === consistenciaClase);
    const metodo = consistenciaMetodo || (claseRow ? claseRow.metodoDefecto : 'asentamiento');
    const valor = Number(consistenciaValor);

    // Derive tolerancia from the class
    let tolerancia = null;
    if (claseRow) {
      if (metodo === 'remoldeo') tolerancia = claseRow.remoldeoTolerancia != null ? Number(claseRow.remoldeoTolerancia) : null;
      else if (metodo === 'extendido') tolerancia = claseRow.extendidoTolerancia != null ? Number(claseRow.extendidoTolerancia) : null;
      else tolerancia = claseRow.asentamientoTolerancia != null ? Number(claseRow.asentamientoTolerancia) : null;
    }

    consistenciaInfo = {
      clase: consistenciaClase,
      nombre: claseRow?.nombre || consistenciaClase,
      metodo,
      valor,
      unidad: metodo === 'remoldeo' ? 's' : 'cm',
      tolerancia,
      rangoMin: tolerancia != null ? valor - tolerancia : null,
      rangoMax: tolerancia != null ? valor + tolerancia : null,
      equivalenciaAproximada: false,
    };

    if (metodo === 'asentamiento') {
      // Direct: valor is in cm, convert to mm
      effectiveAsentamientoMm = Math.round(valor * 10);
    } else if (metodo === 'extendido') {
      // Approximate equivalence: extendido cm → asentamiento cm
      const EXTENDIDO_EQUIV = [
        [50, 12], [55, 15], [60, 17], [65, 18],
      ];
      let asentEquivCm = 15; // default
      if (valor <= EXTENDIDO_EQUIV[0][0]) {
        asentEquivCm = EXTENDIDO_EQUIV[0][1];
      } else if (valor >= EXTENDIDO_EQUIV[EXTENDIDO_EQUIV.length - 1][0]) {
        asentEquivCm = EXTENDIDO_EQUIV[EXTENDIDO_EQUIV.length - 1][1];
      } else {
        for (let i = 0; i < EXTENDIDO_EQUIV.length - 1; i++) {
          const [x0, y0] = EXTENDIDO_EQUIV[i];
          const [x1, y1] = EXTENDIDO_EQUIV[i + 1];
          if (valor >= x0 && valor <= x1) {
            asentEquivCm = y0 + (y1 - y0) * (valor - x0) / (x1 - x0);
            break;
          }
        }
      }
      effectiveAsentamientoMm = Math.round(asentEquivCm * 10);
      consistenciaInfo.equivalenciaAproximada = true;
      consistenciaInfo.asentamientoEquivCm = Math.round(asentEquivCm * 10) / 10;
    } else if (metodo === 'remoldeo') {
      // Approximate equivalence: remoldeo s → asentamiento cm
      const REMOLDEO_EQUIV = [
        [30, 0], [20, 1], [10, 3], [8, 4], [5, 5], [3, 6],
      ];
      let asentEquivCm = 4; // default (lower bound of water table)
      if (valor >= REMOLDEO_EQUIV[0][0]) {
        asentEquivCm = REMOLDEO_EQUIV[0][1];
      } else if (valor <= REMOLDEO_EQUIV[REMOLDEO_EQUIV.length - 1][0]) {
        asentEquivCm = REMOLDEO_EQUIV[REMOLDEO_EQUIV.length - 1][1];
      } else {
        // Note: remoldeo is inverse — higher seconds = drier = lower asentamiento
        for (let i = 0; i < REMOLDEO_EQUIV.length - 1; i++) {
          const [x0, y0] = REMOLDEO_EQUIV[i];
          const [x1, y1] = REMOLDEO_EQUIV[i + 1];
          if (valor <= x0 && valor >= x1) {
            asentEquivCm = y0 + (y1 - y0) * (valor - x0) / (x1 - x0);
            break;
          }
        }
      }
      effectiveAsentamientoMm = Math.round(asentEquivCm * 10);
      consistenciaInfo.equivalenciaAproximada = true;
      consistenciaInfo.asentamientoEquivCm = Math.round(asentEquivCm * 10) / 10;
    }
  }

  // ── Resolver requisitos CIRSOC 200-2024 Tabla 9.3 (hormigones particulares) ──
  let hormigonParticular = null;
  if (body.tipoHormigonParticular && body.claseHormigonParticular) {
    try {
      const hpSvc = require('./hormigonParticularService');
      hormigonParticular = await hpSvc.resolver(db, {
        tipoHormigon: body.tipoHormigonParticular,
        clase: body.claseHormigonParticular,
        espesorMm: body.espesorElementoMm != null ? Number(body.espesorElementoMm) : null,
      });
    } catch (e) {
      console.warn('[calcular] resolver hormigonParticular:', e.message);
    }
  }

  // ── Run unified HormiQual engine ──
  // Determine MF: manual override → mezcla → fallback
  const moduloFinura = manualMF || (mezclaData && mezclaData.moduloFinura) || null;

  const engineResult = calcularDosificacionHQ({
    fce: Number(fce || resistenciaMpa),
    desvioS: desvioS != null ? Number(desvioS) : null,
    // Interpretación del f'ce ingresado (refactor 2026-05-27): ESPECIFICADO
    // (default) = f'ce contractual, el motor suma 1.65·S internamente; OBJETIVO
    // = f'ce es la f'cm objetivo, el sobrediseño ya viene aplicado afuera.
    // El parámetro viaja desde el form del diseñador (form.tipoHormigonModoFce)
    // y se persiste en DosificacionDisenada.tipoHormigonModoFce.
    modoFce: body.tipoHormigonModoFce === 'OBJETIVO' ? 'OBJETIVO' : 'ESPECIFICADO',
    edadDias: Number(edadDias),
    asentamientoMm: effectiveAsentamientoMm != null ? effectiveAsentamientoMm : Number(asentamientoMm),
    consistenciaInfo,
    tmnMm: effectiveTmn,
    airePct: airePct != null ? Number(airePct) : null,
    aireAtrapado: aireAtrapado != null ? Number(aireAtrapado) : null,
    aireIncorporado: aireIncorporado != null ? Number(aireIncorporado) : null,
    aireIntencional: aireIntencional === true,
    formaAgregado: effectiveForma,
    moduloFinura: moduloFinura ? Number(moduloFinura) : null,
    exposicion: exposicion || null,
    tipoHormigonEstructural: tipoHormigonEstructural || 'ARMADO',
    // Modo de curva: la fuente de verdad es CementoPlanta. El parámetro modoCurvaAC del body queda como
    // override opcional sólo para forzar comparaciones (ej: simulación), pero por defecto manda la pivote.
    modoCurvaAC: modoCurvaAC || modoCurvaCP || 'ICPA',
    factorPrudencialCurva: factorPrudencialCurva != null ? Number(factorPrudencialCurva) : 1.00,
    acMaxPliego:     acMaxPliego     != null ? Number(acMaxPliego)     : null,
    amcMaxPliego:    amcMaxPliego    != null ? Number(amcMaxPliego)    : null,
    cementoMinPliego:cementoMinPliego!= null ? Number(cementoMinPliego): null,
    acModo:          acModo          || 'LIMITE',
    cemento,
    adicion1: adicion1Data,
    adicion2: adicion2Data,
    aditivo1: aditivo1Data,
    aditivo2: aditivo2Data,
    aditivo3: aditivo3Data,
    mezcla: mezclaData,
    curvasAgua,
    curvasAC,
    aireEsperado,
    durabilidadExposicion: durabilidadExposicion || [],
    aireDurabilidad: aireDurabilidad || [],
    pulverulentoMinimo: pulverulentoMinimo || [],
    metodoColocacion: metodoColocacion || 'CONVENCIONAL',
    hormigonParticular,
    espesorElementoMm: body.espesorElementoMm != null ? Number(body.espesorElementoMm) : null,
    fibras: await (async () => {
      const out = { macrofibra: null, microfibra: null };
      const lookup = async (id) => {
        if (!id || !db.Fibra) return null;
        // PR3 — Validar que la fibra esté habilitada en la planta antes de leerla.
        await _requireHabilitadoEnPlanta(db, 'fibra', id, idPlanta);
        try {
          const f = await db.Fibra.findByPk(id);
          return f ? f.get({ plain: true }) : null;
        } catch { return null; }
      };
      if ((body.nombreMacrofibra || body.idMacrofibra) && body.dosisMacrofibraKgM3 != null) {
        const f = await lookup(body.idMacrofibra);
        out.macrofibra = {
          idMaterial: body.idMacrofibra || null,
          nombre: body.nombreMacrofibra || f?.marca || null,
          dosisKgM3: Number(body.dosisMacrofibraKgM3),
          densidad: f?.densidad != null ? Number(f.densidad) : null,
          tipo: f?.tipo || 'MACRO',
        };
      }
      if ((body.nombreMicrofibra || body.idMicrofibra) && body.dosisMicrofibraKgM3 != null) {
        const f = await lookup(body.idMicrofibra);
        out.microfibra = {
          idMaterial: body.idMicrofibra || null,
          nombre: body.nombreMicrofibra || f?.marca || null,
          dosisKgM3: Number(body.dosisMicrofibraKgM3),
          densidad: f?.densidad != null ? Number(f.densidad) : null,
          tipo: f?.tipo || 'MICRO',
        };
      }
      return out;
    })(),
    abacoCurvasReferencia: abacoCurvasReferencia || [],
    curvaCemento,
    curvaCementoOrigen,
    factorAjusteICPA: factorAjusteICPA || 1.0,
    idaPonderado: idaPonderadoResult.idaPonderado,
    idaDetalles: idaPonderadoResult.detalles,
    factorEdad,
    factoresEdadMap,
    context: { ...engineContext, db, mfSource: manualMF ? 'MANUAL' : (mezclaData?.moduloFinura ? 'MEZCLA' : 'DEFAULT'),
      trabajabilidadParams: await (async () => {
        try {
          if (db.ParametroTrabajabilidad) {
            const rows = await db.ParametroTrabajabilidad.findAll({ where: { activo: true }, raw: true });
            if (rows && rows.length > 0) {
              const grouped = {};
              for (const r of rows) {
                if (!grouped[r.tipo]) grouped[r.tipo] = [];
                grouped[r.tipo].push(r);
              }
              return grouped;
            }
          }
          return null;
        } catch { return null; }
      })(),
    },
  });

  // Nota: Alivianado se ramifica antes de calcularDosificacionHQ (vía
  // _calcularAlivianado). Acá ya no hay post-procesado para esa tipología.

  // ── Tipología validation warnings ──
  if (body.tipologiaCodigo && engineResult.resultado) {
    try {
      const tipSvc = require('./tipologiaHormigonService');
      const tipConfig = await tipSvc.obtenerPorCodigo(db, body.tipologiaCodigo);
      if (tipConfig) {
        const rd = tipConfig.restriccionesDosificacion || (tipConfig.dataValues ? tipConfig.dataValues.restriccionesDosificacion : null) || {};
        const rg = tipConfig.restriccionesGranulometricas || (tipConfig.dataValues ? tipConfig.dataValues.restriccionesGranulometricas : null) || {};
        const res = engineResult.resultado;
        const tipWarnings = [];
        const tipNombre = tipConfig.nombre || body.tipologiaCodigo;

        // Asentamiento range check
        if (rd.asentamiento_min != null && asentamientoMm < rd.asentamiento_min) {
          tipWarnings.push({ campo: 'tipologia', msg: `Tipología "${tipNombre}": asentamiento ${asentamientoMm} mm está por debajo del mínimo recomendado (${rd.asentamiento_min} mm)`, tipo: 'advertencia' });
        }
        if (rd.asentamiento_max != null && asentamientoMm > rd.asentamiento_max) {
          tipWarnings.push({ campo: 'tipologia', msg: `Tipología "${tipNombre}": asentamiento ${asentamientoMm} mm excede el máximo recomendado (${rd.asentamiento_max} mm)`, tipo: 'advertencia' });
        }
        // Cement content check
        if (rd.cemento_max_kg != null && res.cementoKgM3 > rd.cemento_max_kg) {
          tipWarnings.push({ campo: 'tipologia', msg: `Tipología "${tipNombre}": cemento ${res.cementoKgM3?.toFixed(0)} kg/m³ excede el máximo (${rd.cemento_max_kg} kg/m³)`, tipo: 'advertencia' });
        }
        // TMN restrictions
        const effectiveTmnVal = res.tmnMm || tmnMm;
        if (rg.tmn_max != null && effectiveTmnVal > rg.tmn_max) {
          tipWarnings.push({ campo: 'tipologia', msg: `Tipología "${tipNombre}": TMN ${effectiveTmnVal} mm excede el máximo recomendado (${rg.tmn_max} mm)`, tipo: 'advertencia' });
        }
        if (rg.tmn_min != null && effectiveTmnVal < rg.tmn_min) {
          tipWarnings.push({ campo: 'tipologia', msg: `Tipología "${tipNombre}": TMN ${effectiveTmnVal} mm está por debajo del mínimo (${rg.tmn_min} mm)`, tipo: 'advertencia' });
        }

        if (tipWarnings.length > 0) {
          engineResult.warnings = [...(engineResult.warnings || []), ...tipWarnings];
        }
        // Attach tipología info to result
        engineResult.tipologia = {
          codigo: tipConfig.codigo || body.tipologiaCodigo,
          nombre: tipNombre,
          curvaFamilia: tipConfig.curvaFamilia,
          curvaExponente: tipConfig.curvaExponente,
        };
      }
    } catch (e) {
      // tipología validation is non-blocking
      console.warn('[dosificacion] tipología validation skipped:', e.message);
    }
  }

  // ── Verificación IRAM 1627: banda granulométrica de mezcla total ──
  // Lógica dual: primero compara con banda A-B (más restrictiva).
  // Si no cumple A-B, compara con A-C (más permisiva).
  // Resultado: CUMPLE (A-B) | CUMPLE A-C (no A-B) | NO CUMPLE (ni A-C)
  try {
    const curvaMezclaRaw = mezclaData?.curvaMezclaJson || mezclaData?.curvaMezcla;
    let curvaMezcla = curvaMezclaRaw;
    if (typeof curvaMezcla === 'string') {
      try { curvaMezcla = JSON.parse(curvaMezcla); } catch { curvaMezcla = null; }
      if (typeof curvaMezcla === 'string') { try { curvaMezcla = JSON.parse(curvaMezcla); } catch { curvaMezcla = null; } }
    }
    if (Array.isArray(curvaMezcla) && curvaMezcla.length > 0 && effectiveTmn) {

      // Helper: build band puntos from seed curvas A + ref
      const buildBandaPuntos = (curvaA, curvaRef) => {
        return curvaA.map(pA => {
          const pRef = curvaRef.find(p => Math.abs(p.aberturaMm - pA.aberturaMm) < pA.aberturaMm * 0.05 + 0.01);
          return pRef ? { aberturaMm: pA.aberturaMm, tamiz: `${pA.aberturaMm} mm`, limInfPct: pA.target, limSupPct: pRef.target, isNA: false } : null;
        }).filter(Boolean);
      };

      // Helper: evaluate mix against a band and build rows
      const evalBand = (specPuntos, tamicesMix) => {
        const result = evalAgainstSpec({ medidos: tamicesMix, spec: { specMode: 'RANGO', puntos: specPuntos } });
        const specAsc = [...specPuntos].sort((a, b) => a.aberturaMm - b.aberturaMm);
        const fueraSet = new Set((result.fueraDeBanda || []).map(f => f.aberturaMm));
        const rows = [];
        for (const sp of specAsc) {
          if (sp.limInfPct == null && sp.limSupPct == null) continue;
          const medPt = (result.series?.medida || []).find(m => Math.abs(m.aberturaMm - sp.aberturaMm) < 0.05);
          const pasaMix = medPt ? medPt.pasaPct : null;
          const esFuera = fueraSet.has(sp.aberturaMm);
          let desvio = null;
          if (esFuera && pasaMix != null) {
            if (sp.limInfPct != null && pasaMix < sp.limInfPct) desvio = Math.round((pasaMix - sp.limInfPct) * 10) / 10;
            else if (sp.limSupPct != null && pasaMix > sp.limSupPct) desvio = Math.round((pasaMix - sp.limSupPct) * 10) / 10;
          }
          rows.push({
            tamiz: sp.tamiz || `${sp.aberturaMm} mm`, aberturaMm: sp.aberturaMm,
            pasaMix: pasaMix != null ? Math.round(pasaMix * 10) / 10 : null,
            limInf: sp.limInfPct, limSup: sp.limSupPct,
            estado: pasaMix == null ? 'SIN_DATO' : esFuera ? 'FUERA' : 'DENTRO', desvio,
          });
        }
        const nFuera = rows.filter(r => r.estado === 'FUERA').length;
        const maxDesvioAbs = rows.reduce((m, r) => r.desvio != null ? Math.max(m, Math.abs(r.desvio)) : m, 0);
        return { rows, nFuera, maxDesvioAbs, series: result.series, cumple: nFuera === 0 };
      };

      // Load IRAM 1627 normative data
      let tabla = null;
      try {
        const { loadSeedData } = require('./importIRAM1627Service');
        const seed = loadSeedData();
        tabla = seed.totales?.tablas?.[String(effectiveTmn)];
        if (!tabla) {
          const keys = Object.keys(seed.totales?.tablas || {}).map(Number).sort((a, b) => Math.abs(a - effectiveTmn) - Math.abs(b - effectiveTmn));
          if (keys.length > 0 && Math.abs(keys[0] - effectiveTmn) <= 5) tabla = seed.totales.tablas[String(keys[0])];
        }
      } catch (e) { console.warn('[dosificacion] IRAM 1627 seed load failed:', e.message); }

      if (tabla?.curvas?.A && tabla.curvas.B) {
        const tamicesMix = curvaMezcla
          .filter(p => (p.pasaPct ?? p.pasa) != null)
          .map(p => ({ aberturaMm: p.aberturaMm ?? p.abertura, pasaPct: p.pasaPct ?? p.pasa, tamiz: p.tamiz || `${p.aberturaMm} mm` }));

        const tmnTabla = tabla.tmnMm || effectiveTmn;
        const tablaRef = tabla.referenciaTabla || '';

        // Step 1: Evaluate against A-B (more restrictive)
        const bandaAB = buildBandaPuntos(tabla.curvas.A, tabla.curvas.B);
        const evalAB = evalBand(bandaAB, tamicesMix);

        let estadoGlobal, mensajeGlobal, bandaNombre, rowsFinal, seriesFinal, evalAC = null;

        if (evalAB.cumple) {
          // Cumple A-B → best case
          estadoGlobal = 'CUMPLE';
          mensajeGlobal = `Mezcla dentro de banda A-B IRAM 1627 (${tablaRef}).`;
          bandaNombre = `IRAM 1627 — Total — TMN ${tmnTabla} — Banda A-B (${tablaRef})`;
          rowsFinal = evalAB.rows;
          seriesFinal = evalAB.series;
        } else {
          // Step 2: Evaluate against A-C (more permissive)
          if (tabla.curvas.C) {
            const bandaAC = buildBandaPuntos(tabla.curvas.A, tabla.curvas.C);
            evalAC = evalBand(bandaAC, tamicesMix);
          }

          if (evalAC?.cumple) {
            estadoGlobal = 'CUMPLE_AC';
            mensajeGlobal = `Cumple banda A-C pero no A-B (${evalAB.nFuera} tamiz(es) fuera de A-B, desvío máx. ${evalAB.maxDesvioAbs.toFixed(1)} pp). ${tablaRef}.`;
            bandaNombre = `IRAM 1627 — Total — TMN ${tmnTabla} — Banda A-C (${tablaRef})`;
            // Show A-C rows as primary, but include A-B info
            rowsFinal = evalAC.rows;
            seriesFinal = evalAC.series;
          } else {
            // No cumple ni A-C
            const ref = evalAC || evalAB;
            estadoGlobal = 'NO_CUMPLE';
            mensajeGlobal = `No cumple banda A-C: ${ref.nFuera} tamiz(es) fuera (desvío máx. ${ref.maxDesvioAbs.toFixed(1)} pp). Revisar proporciones. ${tablaRef}.`;
            bandaNombre = `IRAM 1627 — Total — TMN ${tmnTabla} — Banda A-C (${tablaRef})`;
            rowsFinal = (evalAC || evalAB).rows;
            seriesFinal = (evalAC || evalAB).series;
          }
        }

        if (engineResult.resultado) {
          engineResult.resultado.verificacionIRAM = {
            tipo: 'granulometria_iram',
            estado: estadoGlobal,
            cumple: estadoGlobal !== 'NO_CUMPLE',
            mensaje: mensajeGlobal,
            tmnMm: effectiveTmn,
            bandaNombre,
            rows: rowsFinal,
            nFuera: rowsFinal.filter(r => r.estado === 'FUERA').length,
            maxDesvioAbs: rowsFinal.reduce((m, r) => r.desvio != null ? Math.max(m, Math.abs(r.desvio)) : m, 0),
            series: seriesFinal || null,
            // Include both evaluations for detailed display
            evalAB: { cumple: evalAB.cumple, nFuera: evalAB.nFuera, maxDesvio: evalAB.maxDesvioAbs, rows: evalAB.rows, series: evalAB.series },
            evalAC: evalAC ? { cumple: evalAC.cumple, nFuera: evalAC.nFuera, maxDesvio: evalAC.maxDesvioAbs, rows: evalAC.rows, series: evalAC.series } : null,
            tablaRef,
          };
        }
      }
    }
  } catch (e) {
    console.warn('[dosificacion] Verificación IRAM 1627 skipped:', e.message);
  }

  // ── Consistency validation (Art. 4.1.1.2) ──
  if (consistenciaInfo && engineResult.resultado) {
    // Store consistency info in trazabilidad
    if (engineResult.trazabilidad) {
      engineResult.trazabilidad.consistencia = consistenciaInfo;
    }

    // Superplastificante check for fluida / muy_fluida
    const claseRow = consistenciaClases.find(c => c.codigo === consistenciaClase);
    if (claseRow?.requiereSuperplastificante) {
      const tieneSuperplast = [aditivo1Data, aditivo2Data, aditivo3Data].some(a =>
        a && (a.tipoQuimico === 'superplastificante' || a.tipoFuncional === 'SUPERPLASTIFICANTE'
          || a.modoEfecto === 'AHORRO_AGUA' || a.modoEfecto === 'AUMENTO_ASENTAMIENTO')
      );

      // Exception: H-15 simple, asentamiento ≤ 18 cm, cemento ≥ 300 kg/m³
      const esExcepcion = Number(fce || resistenciaMpa) <= 15
        && (tipoHormigonEstructural || 'ARMADO') === 'SIMPLE'
        && (effectiveAsentamientoMm / 10) <= 18
        && (engineResult.resultado.cementoTotalKgM3 || 0) >= 300;

      if (!tieneSuperplast && !esExcepcion) {
        engineResult.warnings = [...(engineResult.warnings || []), {
          campo: 'consistencia',
          msg: `La consistencia "${consistenciaInfo.nombre}" requiere aditivo superplastificante (CIRSOC 200:2024, Art. 4.1.1.2.a). No se ha seleccionado uno en la dosificación.`,
          tipo: 'advertencia',
        }];
      }
    }

    // C 4.1.1.1 recommendation for classes with recomiendaFluidificante (e.g. muy_plastica)
    if (claseRow?.recomiendaFluidificante && !claseRow?.requiereSuperplastificante) {
      const tieneFluidificante = [aditivo1Data, aditivo2Data, aditivo3Data].some(a =>
        a && (a.tipoQuimico === 'superplastificante' || a.tipoFuncional === 'SUPERPLASTIFICANTE'
          || a.tipoQuimico === 'fluidificante' || a.tipoFuncional === 'FLUIDIFICANTE'
          || a.modoEfecto === 'AHORRO_AGUA' || a.modoEfecto === 'AUMENTO_ASENTAMIENTO')
      );
      if (!tieneFluidificante) {
        engineResult.warnings = [...(engineResult.warnings || []), {
          campo: 'consistencia',
          msg: `Para consistencia "${consistenciaInfo.nombre}" se recomienda el uso de aditivos fluidificantes y/o superfluidificantes (CIRSOC 200:2024, Comentario C 4.1.1.1). Considerar agregar un aditivo con efecto "Ahorro de agua" o "Aumento de asentamiento".`,
          tipo: 'info',
        }];
      }
    }

    // Equivalence approximation warning
    if (consistenciaInfo.equivalenciaAproximada) {
      engineResult.warnings = [...(engineResult.warnings || []), {
        campo: 'consistencia',
        msg: `El agua se estimó a partir de un asentamiento equivalente de ~${consistenciaInfo.asentamientoEquivCm} cm (correspondiente a ${consistenciaInfo.metodo === 'extendido' ? 'un extendido' : 'un remoldeo VeBe'} de ${consistenciaInfo.valor} ${consistenciaInfo.unidad}). Esta equivalencia es aproximada. Se recomienda ajustar con datos del pastón de pruebas.`,
        tipo: 'info',
      }];
    }
  }

  // ── Corrección por humedad (post-procesamiento) ──
  let correccionHumedad = null;
  if (humedadAgregados?.length && engineResult.resultado) {
    correccionHumedad = calcularCorreccionHumedad(engineResult.resultado, humedadAgregados);
  }

  // ── Sugerencia TMN óptimo (informativa, nunca automática) ──
  // Si la planta dispone de agregado grueso con TMN mayor al usado en el diseño,
  // emitir una nota informativa. El usuario decide si aplica.
  try {
    const plantaId = mezclaData?.idPlanta;
    if (plantaId && effectiveTmn && db.Agregado && db.AgregadoGrueso && db.TamanioMaximoNominal) {
      const gruesos = await db.Agregado.findAll({
        where: { idPlanta: plantaId, activo: true },
        attributes: ['idAgregado', 'nombre'],
        include: [{
          model: db.AgregadoGrueso, as: 'agregadoGrueso', required: true,
          attributes: ['idTamanioMaximoNominal'],
          include: [{
            model: db.TamanioMaximoNominal, as: 'tamanioMaximoNominal',
            attributes: ['tamanio', 'descripcion'],
          }],
        }],
        raw: false,
      });

      let maxTmn = 0;
      let maxTmnAgregado = null;
      for (const ag of gruesos) {
        const tmn = ag.agregadoGrueso?.tamanioMaximoNominal?.tamanio;
        if (tmn != null && tmn > maxTmn) {
          maxTmn = tmn;
          maxTmnAgregado = ag;
        }
      }

      if (maxTmn > effectiveTmn) {
        const agNombre = maxTmnAgregado?.nombre || 'agregado grueso';
        engineResult.warnings = [...(engineResult.warnings || []), {
          campo: 'tmn_sugerencia',
          msg: `La planta dispone de agregado grueso con TMN hasta ${maxTmn} mm (${agNombre}). ` +
            `El diseño actual usa TMN ${effectiveTmn} mm. Un TMN mayor puede reducir la demanda de agua y cemento. ` +
            `Verificar que las condiciones constructivas lo permitan ` +
            `(recubrimiento >= 1,5 x TMN, separación entre barras >= 1,33 x TMN, dimensión mínima del elemento >= 3 x TMN).`,
          tipo: 'info',
        }];
      }
    }
  } catch (e) {
    // Non-blocking: TMN suggestion is purely informational
    console.warn('[dosificacion] TMN suggestion skipped:', e.message);
  }

  // ── Re-evaluate mezcla properties with desgaste context (BUG 1 fix) ──
  // The mezcla is normally evaluated standalone at creation time, so "suma sustancias
  // nocivas" shows both limits. When the mezcla is used inside a dosificación we DO know
  // whether the destination has wear exposure, so re-evaluate to get a definitive verdict.
  let evaluacionPropiedadesContextual = null;
  if (mezclaId && engineResult.resultado) {
    try {
      // Auditoría 01-calidad Fase C R3: `calcularPropiedadesCombinadas` (DB-aware)
      // se movió a service; `evaluarPropiedadesCombinadas` sigue en domain.
      const { calcularPropiedadesCombinadas } = require('./mezclaPropsService');
      const { evaluarPropiedadesCombinadas } = require('../domain/mezclaPropsEngine');
      const items = (mezcla?.items || []).map((it) => ({
        idAgregado: it.idAgregado || it.legacyAgregadoId || it.agregado?.idAgregado,
        nombre: it.nombre || it.agregado?.nombre || null,
        porcentaje: Number(it.porcentaje ?? it.porcentajeFinal ?? 0),
        tipoAgregado: it.tipoAgregado || null,
      })).filter((it) => it.idAgregado && it.porcentaje > 0);
      if (items.length > 0) {
        const propsResult = await calcularPropiedadesCombinadas(db, items);
        evaluacionPropiedadesContextual = evaluarPropiedadesCombinadas(
          propsResult.combinadas,
          'TOTAL',
          propsResult.componentes,
          { expuestoDesgaste: !!body.expuestoDesgaste }
        );
      }
    } catch (e) {
      console.warn('[dosificacion] Contextual props re-evaluation skipped:', e.message);
    }
  }

  // ── Re-build assessment con aptitud real y mezcla base enriquecida ──
  // El engine produce un `resultado.assessment` inicial con lo que tiene a mano
  // (mezcla base vacía + aptitudMateriales vacía). Acá lo enriquecemos con:
  //   (1) el estado de liberación de la mezcla base (estado + estadoTecnico)
  //   (2) la verificación de aptitud de materiales real del contexto declarado
  // así cualquier consumidor del backend (alertas, dashboards, frontend) lee un
  // `resultado.assessment` completo desde una única fuente de verdad.
  try {
    if (engineResult?.resultado && mezclaId) {
      const { buildAssessment } = require('../domain/dosificacion/estadoGlobalConsolidator');

      // (1) Mezcla base — estado + derivación de estadoTecnico
      let mezclaBaseInfo = null;
      if (mezcla) {
        let estadoTecnico = null;
        try {
          let meta = mezcla.metadataResultadoJson;
          if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { meta = null; } }
          const evalB = meta?.evaluacionBanda || meta?.evaluacion;
          if (evalB) {
            const cumpleB = evalB.cumple === true || evalB.estado === 'CUMPLE';
            const nFuera = (evalB.fueraDeBanda || []).length;
            const maxDesv = (evalB.fueraDeBanda || []).reduce((mx, t) => Math.max(mx, Math.abs(t.desvio || 0)), 0);
            if (cumpleB) estadoTecnico = 'CUMPLE';
            else if (nFuera <= 2 && maxDesv <= 3) estadoTecnico = 'CUMPLE_OBS';
            else if (nFuera > 0 && nFuera <= 4) estadoTecnico = 'REQUIERE_AJUSTE';
            else estadoTecnico = 'NO_CUMPLE';
          }
        } catch { /* non-blocking */ }
        mezclaBaseInfo = {
          estado: mezcla.estado || null,
          estadoTecnico: mezcla.estadoTecnico || estadoTecnico,
        };
      }

      // (2) Aptitud real por contexto — reutiliza la evaluación "by params"
      // (no requiere dosificación guardada).
      let aptitudEnriquecida = [];
      try {
        const aptitudResult = await verificarAptitudMaterialesByParams(db, {
          mezclaId,
          expuestoDesgaste: !!body.expuestoDesgaste,
          // X2 (2026-05-08): tipologiaCodigo permite que el helper
          // `resolveExpuestoDesgaste` promueva el flag cuando la tipología
          // implica desgaste superficial (pavimento, piso industrial).
          tipologiaCodigo: body.tipologiaCodigo || body.tipologia?.codigo || null,
          aspectoSuperficialImportante: !!body.aspectoSuperficialImportante,
          tipoArmadura: body.tipoHormigonEstructural || body.tipoArmadura || 'armado',
          claseExposicion: body.exposicion || null,
          fc: body.fce || body.resistenciaMpa || null,
        });
        aptitudEnriquecida = aptitudResult?.verificaciones || [];
      } catch (eApt) {
        console.warn('[calcular] aptitud para assessment no disponible:', eApt.message);
      }

      // (3) Cloruros globales worst-case
      let clorurosGlobalResult = null;
      try {
        const { computeClorurosGlobal } = require('../domain/dosificacion/estadoGlobalConsolidator');
        clorurosGlobalResult = computeClorurosGlobal({
          aptitudVerificaciones: aptitudEnriquecida,
          agregadosDosif: engineResult.resultado.agregados || [],
          cementoKgM3: engineResult.resultado.cementoTotalKgM3 || engineResult.resultado.cementoKgM3 || 0,
          aguaKgM3: engineResult.resultado.aguaLtsM3 || 0,
          tipoArmadura: body.tipoHormigonEstructural || body.tipoArmadura || 'armado',
        });
      } catch (eCl) {
        console.warn('[calcular] cloruros para assessment no disponible:', eCl.message);
      }

      // Re-llamada al builder con datos completos.
      const trabInfo = engineResult.resultado.trabajabilidad
        ? { coherencia: engineResult.resultado.trabajabilidad.coherencia }
        : null;
      const pulvData = engineResult.trazabilidad?.verificacionPulverulento;
      const cirsocPayload = {
        pulverulento: pulvData ? { cumple: pulvData.cumple, total: pulvData.totalPulverulento, minimo: pulvData.minimoKgM3 } : null,
      };
      const esCurvaFallback = (engineResult.warnings || []).some(w => {
        const m = (w.msg || w.mensaje || '');
        return m.includes('fallback') || m.includes('ICPA') || m.includes('baco');
      });

      engineResult.resultado.assessment = buildAssessment({
        mezclaBase: mezclaBaseInfo,
        aptitudMateriales: aptitudEnriquecida,
        expuestoDesgaste: !!body.expuestoDesgaste,
        // X2 (2026-05-08): pasar `tipologiaCodigo` para que el helper
        // `resolveExpuestoDesgaste` promueva el flag a `true` cuando la
        // tipología implica desgaste (ej. pavimento). Antes el consolidador
        // solo veía el flag explícito y emitía mensajes incoherentes con la
        // sección L del PDF.
        tipologiaCodigo: body.tipologiaCodigo || body.tipologia?.codigo || null,
        clorurosGlobal: clorurosGlobalResult,
        verificacionesCIRSOC: cirsocPayload,
        curvaFallback: esCurvaFallback,
        trabajabilidad: trabInfo,
        validacionExperimentalPendiente: true,
        tieneVerifReal: false,
        reportMode: body.reportMode || 'PRESTACIONAL',
      });
    }
  } catch (e) {
    console.warn('[calcular] Error enriqueciendo assessment:', e.message);
  }

  // ── Predicción de comportamiento fresco (V1 heurística) ─────────────────
  // Se corre sobre el resultado del engine para anticipar tendencias del
  // hormigón fresco. No sustituye pastón de prueba. Se adjunta al resultado
  // como `resultado.prediccionFresco` para que frontend/PDF lo consuman.
  let prediccionFresca = null;
  try {
    if (engineResult?.resultado) {
      const { calcular: calcPred } = require('./prediccionFrescoService');
      // PR — Pred-fresco bugs "Sin datos":
      // (a) `aireTotalPct`: el motor expone el aire bajo otros nombres
      //     (`airePct`, `aireIncorporadoPct`, `airePctTotal`); además trazabilidad
      //     guarda `aireBase`. Probar varias rutas.
      // (b) `reduccionAguaAditivoPct`: antes leíamos `engineContext._reduccionAguaAditivoPct`
      //     que nunca se asignaba. Derivamos del array de aditivos: tomamos el
      //     mayor `reduccionAguaPctEsperada` entre los que tienen modoEfecto
      //     'AHORRO_AGUA' o reducción declarada.
      // (c) `moduloFinura`: el motor lo usa internamente pero no lo expone en el
      //     `resultado` final. Lo inyectamos desde la variable `moduloFinura`
      //     resuelta arriba (manualMF || mezclaData.moduloFinura).
      if (engineResult.resultado.moduloFinura == null && moduloFinura != null) {
        engineResult.resultado.moduloFinura = Number(moduloFinura);
      }
      const _aireParaPred = (
        engineResult.resultado.aireTotalPct
        ?? engineResult.resultado.airePctTotal
        ?? engineResult.resultado.airePct
        ?? engineResult.resultado.aireIncorporadoPct
        ?? engineResult.trazabilidad?.aireBase?.airePct
        ?? airePct
      );
      const _aditivosCargados = [aditivo1Data, aditivo2Data, aditivo3Data].filter(Boolean);
      const _reduccionMax = _aditivosCargados.reduce((max, ad) => {
        const r = Number(ad.reduccionAguaPctEsperada);
        if (!Number.isFinite(r) || r <= 0) return max;
        // Si declara modoEfecto, ese tiene que estar acorde; si no declara, lo aceptamos.
        if (ad.modoEfecto && ad.modoEfecto !== 'AHORRO_AGUA') return max;
        return r > max ? r : max;
      }, 0);

      prediccionFresca = calcPred({
        resultado: engineResult.resultado,
        trazabilidad: engineResult.trazabilidad,
        mezcla: mezcla,
        aptitudMateriales: null, // el service layer enriquece después si se persiste
        contexto: {
          asentamientoMm: asentamientoMm != null ? Number(asentamientoMm) : null,
          tipologiaCodigo: body.tipologiaCodigo || null,
          bombeable: String(body.tipologiaCodigo || '').toLowerCase() === 'bombeable',
          aireTotalPct: _aireParaPred,
          reduccionAguaAditivoPct: _reduccionMax > 0 ? _reduccionMax : null,
          formaAgregado: effectiveForma || null,
          tmnMm: effectiveTmn,
        },
      });
      engineResult.resultado.prediccionFresco = prediccionFresca;
    }
  } catch (e) {
    console.warn('[calcular] prediccion fresca skipped:', e.message);
  }

  // Issue 3 (sesión 2026-05-27): adjuntamos la RECOMENDACIÓN del motor de
  // selección de aditivos al response. NO se aplica al cálculo (los aditivos
  // que ya usó el motor son los que el usuario eligió en el form); es solo
  // metadata para que el frontend muestre la divergencia en un banner no
  // bloqueante con botón "Aplicar recomendación". El cálculo en sí siempre
  // respeta la elección manual del operador.
  let aditivosRecomendadosMotor = null;
  try {
    const { seleccionarAditivos } = require('../domain/dosificacion/seleccionAditivosEngine');
    const aditivosDisponibles = await db.Aditivo.findAll({ where: { activo: true }, raw: true });
    const parametrosRec = {
      fce: Number(body.fce || body.resistenciaMpa) || null,
      claseExposicion: body.exposicion || null,
      asentamientoMm: effectiveAsentamientoMm != null ? effectiveAsentamientoMm : Number(asentamientoMm),
      tipologia: body.tipologiaCodigo || null,
      bombeable: String(body.tipologiaCodigo || '').toLowerCase() === 'bombeable'
        || String(body.metodoColocacion || '').toUpperCase() === 'BOMBEADO',
      tiempoViaje: body.tiempoViaje != null ? Number(body.tiempoViaje) : 30,
      tiempoDescarga: body.tiempoDescarga != null ? Number(body.tiempoDescarga) : 30,
      tiempoEspera: body.tiempoEspera != null ? Number(body.tiempoEspera) : 0,
      temperatura: body.temperaturaAmbiente != null ? Number(body.temperaturaAmbiente) : 20,
      tieneRetardante: false,
    };
    aditivosRecomendadosMotor = seleccionarAditivos(aditivosDisponibles, parametrosRec);
  } catch (e) {
    console.warn('[calcular] aditivosRecomendadosMotor skipped:', e.message);
  }

  // Attach derived metadata and humidity correction to engine result
  return {
    ...engineResult,
    derivedMeta,
    correccionHumedad,
    evaluacionPropiedadesContextual,
    aditivosRecomendadosMotor,
    cementoPlantaConfig: cementoPlantaCfg ? {
      idCementoPlanta: cementoPlantaCfg.idCementoPlanta,
      idPlanta: cementoPlantaCfg.idPlanta,
      idCemento: cementoPlantaCfg.idCemento,
      modoCurva: cementoPlantaCfg.modoCurva,
      factorAjuste: Number(cementoPlantaCfg.factorAjuste),
      idCurvaPropia: cementoPlantaCfg.idCurvaPropia,
      curvaCementoOrigen,
    } : null,
  };
};

/* ═══════════════════════════════════════════
   Persistencia
   ═══════════════════════════════════════════ */

/**
 * Helper P0.16 / K.2 — valida que el diseño respete las conditions de
 * aplicabilidad declaradas por la mezcla en su `metadataResultadoJson.compliance`.
 *
 * Se llama desde guardar(), aplicarCorrecciones() y transicionarEstado().
 * Antes solo corría en transicionarEstado, lo que dejaba un hueco: una arena
 * CUMPLE_AC podía guardarse en un H-30 sin protesta y solo fallaba al
 * intentar pasar a EN_PRODUCCION (caso "Las Quebradas en H-30 OPS Pisos"
 * detectado en la auditoría v2).
 *
 * K.2: carga evidencias técnicas (TechnicalEvidence) asociadas a los
 * agregados de la mezcla y las pasa como `context.evidenciasDisponibles`
 * al validador. Si el único defecto es la falta de evidencia técnica, el
 * validador emite Inconclusive (no Fail) para que el flujo del frontend
 * pueda ofrecer el override de responsable técnico (K.3). Si hay
 * violaciones duras (fce excede H20, destino expuesto a desgaste), sigue
 * bloqueando duro.
 *
 * @param {Object} db - conexión Sequelize multi-tenant
 * @param {Object} mezcla - row de MezclaAgregados con metadataResultadoJson
 * @param {Object} dosificacionRow - shape con parametrosObjetivoJson, fce,
 *   exposicion, tipoArmadura, expuestoDesgaste
 * @param {string} [tag] - prefijo para logs ("[guardar]", "[transicionarEstado]")
 */
async function assertMezclaConditionsCompatible(db, mezcla, dosificacionRow, tag = '[validation]') {
  if (!mezcla?.metadataResultadoJson) return;
  let meta;
  try {
    meta = typeof mezcla.metadataResultadoJson === 'string'
      ? JSON.parse(mezcla.metadataResultadoJson) : mezcla.metadataResultadoJson;
  } catch (err) {
    console.warn(`${tag} metadata de mezcla mal formada, no se puede validar:`, err.message);
    return;
  }
  const compliance = meta?.compliance;
  if (!compliance || compliance.status !== 'conditionalPass') return;

  const { validateConditionsAgainstContext } = require('../domain/compliance');
  let params;
  try {
    params = typeof dosificacionRow.parametrosObjetivoJson === 'string'
      ? JSON.parse(dosificacionRow.parametrosObjetivoJson) : dosificacionRow.parametrosObjetivoJson;
  } catch { params = {}; }

  const fce = Number(dosificacionRow.fce ?? params?.fce ?? params?.resistenciaMpa);

  const ctx = {
    fce,
    claseExposicion: dosificacionRow.exposicion || params?.exposicion || params?.claseExposicion,
    tipoArmadura: dosificacionRow.tipoArmadura || params?.tipoArmadura,
    expuestoDesgaste: dosificacionRow.expuestoDesgaste === true || params?.expuestoDesgaste === true,
    evidenciasDisponibles: [],
    overrideAprobado: false,
  };

  // K.2 — si hay condición requires_technical_evidence, cargar evidencias
  // asociadas a los agregados de la mezcla (y filtradas por fce). Si el
  // modelo/servicio no existe (tenant legacy), se deja el array vacío → el
  // validador emitirá Inconclusive, que es el comportamiento seguro.
  const needsEvidence = (compliance.conditions || []).some((c) => c.key === 'requires_technical_evidence');
  if (needsEvidence && db) {
    try {
      const items = await db.MezclaAgregadosItem.findAll({
        where: { idMezcla: mezcla.idMezcla },
        attributes: ['idAgregado'],
        raw: true,
      });
      const materialIds = [...new Set(items.map((i) => Number(i.idAgregado)).filter(Number.isFinite))];
      if (db.TechnicalEvidence && materialIds.length > 0) {
        const technicalEvidenceService = require('./technicalEvidenceService');
        const evidenciasPorMaterial = await Promise.all(
          materialIds.map((mid) => technicalEvidenceService.buscarEvidenciaParaMaterial(db, {
            materialId: mid,
            fceMpa: Number.isFinite(fce) ? fce : null,
          }).catch(() => []))
        );
        const seen = new Set();
        for (const lista of evidenciasPorMaterial) {
          for (const ev of lista) {
            if (!seen.has(ev.id)) {
              seen.add(ev.id);
              ctx.evidenciasDisponibles.push(ev);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`${tag} no se pudo cargar TechnicalEvidence:`, err.message);
    }

    // K.3 hook — si existe OverrideRequest aprobado para este diseño y
    // mezcla, inyectarlo. Mientras el modelo no exista, queda inerte.
    try {
      if (db.OverrideRequest && dosificacionRow.id) {
        const override = await db.OverrideRequest.findOne({
          where: {
            idDosificacionDisenada: dosificacionRow.id,
            idMezcla: mezcla.idMezcla,
            estado: 'APROBADO',
            activo: true,
          },
        });
        if (override) ctx.overrideAprobado = true;
      }
    } catch (err) {
      console.warn(`${tag} no se pudo verificar OverrideRequest:`, err.message);
    }
  }

  const result = validateConditionsAgainstContext(compliance, ctx);
  if (result.status === 'fail') {
    throw Object.assign(
      new Error(
        `La mezcla "${mezcla.nombre}" tiene condiciones de aplicabilidad que el diseño no cumple: ` +
        (result.reasons || []).join(' / ')
      ),
      { status: 422 }
    );
  }
  if (result.status === 'inconclusive') {
    throw Object.assign(
      new Error(
        `La mezcla "${mezcla.nombre}" requiere evidencia técnica respaldatoria (CIRSOC §3.2.3.2 f) o liberación bajo override del responsable técnico. ` +
        'Detalle: ' + (result.details || [result.reason]).join(' / ')
      ),
      {
        status: 422,
        code: 'REQUIRES_TECHNICAL_EVIDENCE',
        overridable: true,
        mezclaId: mezcla.idMezcla,
        mezclaNombre: mezcla.nombre,
      }
    );
  }
}

const guardar = async (db, data, usuario) => {
  const parsed = {
    parametrosObjetivoJson: parseJsonField(data.parametrosObjetivoJson, 'parametrosObjetivoJson', { required: true }),
    resultadoJson: parseJsonField(data.resultadoJson, 'resultadoJson', { required: true }),
    trazabilidadJson: parseJsonField(data.trazabilidadJson, 'trazabilidadJson', { required: true }),
  };

  validateSavePayload(data, parsed);

  // Refactor 2026-05-20 — derivar el "Tipo de hormigón" (clase IRAM 1666 o
  // HRDC) desde f'ce + tipología antes de persistir, para permitir agrupar
  // dosificaciones por familia y hacer estadísticas por clase. El modo
  // (ESPECIFICADO/OBJETIVO) viene del frontend; default ESPECIFICADO.
  const _modoFce = data.tipoHormigonModoFce === MODOS_FCE.OBJETIVO
    ? MODOS_FCE.OBJETIVO
    : MODOS_FCE.ESPECIFICADO;
  const _descriptorTipoH = derivarTipoHormigon({
    fce: data.fce ?? parsed.parametrosObjetivoJson?.fce,
    tipologiaCodigo: data.tipologiaCodigo,
    modoFce: _modoFce,
  });
  const _idTipoHormigonDerivado = await resolverIdTipoHormigon(db, _descriptorTipoH);
  // Para HRDC el modo no aplica (no hay f'ce); lo dejamos NULL para no
  // confundir consultas estadísticas que filtren por modo.
  const _modoPersistido = _descriptorTipoH.nombre && _descriptorTipoH.motivo !== 'hrdc'
    ? _modoFce
    : null;

  // P0.16 — validar conditions de la mezcla ANTES de persistir el diseño.
  // Antes solo se validaba al transicionar a EN_PRODUCCION, lo que dejaba
  // un hueco: una arena CUMPLE_AC se podía guardar en un H-30 sin protesta.
  if (data.idMezcla) {
    const mezcla = await db.MezclaAgregados.findByPk(data.idMezcla);
    if (mezcla) {
      await assertMezclaConditionsCompatible(
        db,
        mezcla,
        {
          parametrosObjetivoJson: parsed.parametrosObjetivoJson,
          fce: data.fce,
          exposicion: data.exposicion,
          tipoArmadura: data.tipoArmadura,
          expuestoDesgaste: data.expuestoDesgaste,
        },
        '[guardar]',
      );
    }
  }

  const row = await db.DosificacionDisenada.create({
    nombre: data.nombre ? String(data.nombre).trim() : null,
    descripcion: data.descripcion || null,
    idPlanta: data.idPlanta,
    estado: 'BORRADOR',
    metodo: 'HORMIQUAL',
    tipologiaCodigo: data.tipologiaCodigo || 'convencional',
    // Refactor 2026-05-20 — clase IRAM 1666 derivada de f'ce + tipología.
    idTipoHormigon: _idTipoHormigonDerivado,
    tipoHormigonModoFce: _modoPersistido,
    expuestoDesgaste: data.expuestoDesgaste ?? false,
    aspectoSuperficialImportante: data.aspectoSuperficialImportante ?? false,
    tipoArmadura: data.tipoArmadura || 'armado',
    tipoHormigonParticular: data.tipoHormigonParticular || null,
    claseHormigonParticular: data.claseHormigonParticular || null,
    espesorElementoMm: data.espesorElementoMm != null ? Number(data.espesorElementoMm) : null,
    idMacrofibra: data.idMacrofibra || null,
    nombreMacrofibra: data.nombreMacrofibra || null,
    dosisMacrofibraKgM3: data.dosisMacrofibraKgM3 != null ? Number(data.dosisMacrofibraKgM3) : null,
    idMicrofibra: data.idMicrofibra || null,
    nombreMicrofibra: data.nombreMicrofibra || null,
    dosisMicrofibraKgM3: data.dosisMicrofibraKgM3 != null ? Number(data.dosisMicrofibraKgM3) : null,
    idMezcla: data.idMezcla || null,
    idCemento: data.idCemento || null,
    idAdicion1: data.idAdicion1 || null,
    pctReemplazoAdicion1: data.pctReemplazoAdicion1 || null,
    idAdicion2: data.idAdicion2 || null,
    pctReemplazoAdicion2: data.pctReemplazoAdicion2 || null,
    idAditivo1: data.idAditivo1 || null,
    dosisAditivo1: data.dosisAditivo1 || null,
    modoEfectoAditivo1: data.modoEfectoAditivo1 || null,
    idAditivo2: data.idAditivo2 || null,
    dosisAditivo2: data.dosisAditivo2 || null,
    modoEfectoAditivo2: data.modoEfectoAditivo2 || null,
    idAditivo3: data.idAditivo3 || null,
    dosisAditivo3: data.dosisAditivo3 || null,
    modoEfectoAditivo3: data.modoEfectoAditivo3 || null,
    etapaAditivo1: data.etapaAditivo1 === 'OBRA' ? 'OBRA' : 'PLANTA',
    etapaAditivo2: data.etapaAditivo2 === 'OBRA' ? 'OBRA' : 'PLANTA',
    etapaAditivo3: data.etapaAditivo3 === 'OBRA' ? 'OBRA' : 'PLANTA',
    esCorreccionAditivo1: data.esCorreccionAditivo1 === true,
    esCorreccionAditivo2: data.esCorreccionAditivo2 === true,
    esCorreccionAditivo3: data.esCorreccionAditivo3 === true,
    // Fase 2A — flujo post-prueba
    numeroRondaPrueba: data.numeroRondaPrueba != null ? Number(data.numeroRondaPrueba) : 1,
    cementoKgM3Adoptado: data.cementoKgM3Adoptado != null ? Number(data.cementoKgM3Adoptado) : null,
    proporcionesAgregadosAdoptadasJson: data.proporcionesAgregadosAdoptadasJson || null,
    idDosificacionCatalogo: data.idDosificacionCatalogo || null,
    parametrosObjetivoJson: parsed.parametrosObjetivoJson,
    resultadoJson: parsed.resultadoJson,
    trazabilidadJson: parsed.trazabilidadJson,
    // R4 — método de colocación previsto (afecta excepción §4.1.3 pulverulento)
    metodoColocacion: data.metodoColocacion === 'BOMBEADO' ? 'BOMBEADO' : 'CONVENCIONAL',
    // P0.5 — Al guardar un nuevo cálculo el resultado deja de estar obsoleto
    resultadoStale: false,
  });

  // Log creation event in audit trail (Fase 4.4: vía helper para encadenar hash)
  try {
    const { logEventoDosificacion } = require('./auditDosificacionService');
    const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
    await logEventoDosificacion(db, {
      entidadId: row.id,
      tipoEvento: TIPO_EVENTO.CREACION,
      estadoNuevo: 'BORRADOR',
      usuario: usuario || 'desconocido',
      observaciones: data.notasCambio || null,
    });
  } catch (e) {
    console.error('[guardar] Error logging creation event:', e.message);
  }

  // Si el diseño tiene ajuste manual de cemento embebido en `resultadoJson.ajusteCemento`,
  // loggear un evento separado en el historial con la trazabilidad del ajuste
  // (motivo, delta, a/c efectivo). El motor backend (ajusteCementoEngine) ya
  // valida que el ajuste sea coherente antes de que el frontend lo persista,
  // así que acá solo loggeamos para auditoría.
  const ajusteCemento = parsed.resultadoJson?.ajusteCemento;
  if (ajusteCemento && ajusteCemento.aplicado === true) {
    try {
      const { logEventoDosificacion } = require('./auditDosificacionService');
      const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
      const motivoTexto = ajusteCemento.motivo === 'OTRO'
        ? `Otro: ${ajusteCemento.motivoOtro || ''}`
        : ajusteCemento.motivoLabel || ajusteCemento.motivo;
      // Usamos TIPO_EVENTO.MODIFICACION (categoría AUDITORIA) con metadata
      // distintiva `tipoAjuste: 'CEMENTO'`. El catálogo canónico de eventos
      // se mantiene cerrado; el detalle del ajuste vive en metadata.
      await logEventoDosificacion(db, {
        entidadId: row.id,
        tipoEvento: TIPO_EVENTO.MODIFICACION,
        usuario: usuario || ajusteCemento.usuario || 'desconocido',
        observaciones: `Ajuste manual de cemento: ${ajusteCemento.cementoCalculadoKgM3} → ${ajusteCemento.cementoAdoptadoKgM3} kg/m³ (Δ ${ajusteCemento.deltaKg >= 0 ? '+' : ''}${ajusteCemento.deltaKg} kg, ${ajusteCemento.deltaPct >= 0 ? '+' : ''}${ajusteCemento.deltaPct}%). Motivo: ${motivoTexto}.`,
        metadata: {
          tipoAjuste: 'CEMENTO',
          cementoCalculadoKgM3: ajusteCemento.cementoCalculadoKgM3,
          cementoAdoptadoKgM3: ajusteCemento.cementoAdoptadoKgM3,
          deltaKg: ajusteCemento.deltaKg,
          deltaPct: ajusteCemento.deltaPct,
          motivo: ajusteCemento.motivo,
          motivoOtro: ajusteCemento.motivoOtro,
          acOriginal: ajusteCemento.acOriginal,
          acEfectivo: ajusteCemento.acEfectivo,
        },
      });
    } catch (e) {
      console.error('[guardar] Error logging ajuste cemento event:', e.message);
    }
  }

  return row;
};

const listar = async (db, { plantaId } = {}) => {
  const where = { activo: true };
  if (plantaId) where.idPlanta = Number(plantaId);
  const rows = await db.DosificacionDisenada.findAll({
    where,
    include: [
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false },
      { model: db.Cemento, as: 'cemento', attributes: ['idCemento', 'nombreComercial', 'composicion'], required: false },
      { model: db.MezclaAgregados, as: 'mezcla', attributes: ['idMezcla', 'nombre', 'tmnCalculadoMm'], required: false },
      { model: db.Material, as: 'adicion1', attributes: ['idMaterial', 'nombre'], required: false },
      { model: db.Material, as: 'adicion2', attributes: ['idMaterial', 'nombre'], required: false },
      { model: db.Aditivo, as: 'aditivo1', attributes: ['idAditivo', 'marca', 'funcion'], required: false },
      { model: db.Aditivo, as: 'aditivo2', attributes: ['idAditivo', 'marca', 'funcion'], required: false },
      { model: db.Aditivo, as: 'aditivo3', attributes: ['idAditivo', 'marca', 'funcion'], required: false },
    ],
    order: [['updatedAt', 'DESC']],
  });

  const plainList = rows.map(r => r.get({ plain: true }));

  // Count recetas referencing each dosificación (for "en uso" indicator)
  if (db.RecetaObra) {
    const dosifIds = plainList.map(d => d.id).filter(Boolean);
    if (dosifIds.length > 0) {
      const counts = await db.RecetaObra.findAll({
        where: { dosificacionDisenadaId: dosifIds },
        attributes: [
          'dosificacionDisenadaId',
          [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'cnt'],
        ],
        group: ['dosificacionDisenadaId'],
        raw: true,
      });
      const countMap = {};
      for (const row of counts) countMap[row.dosificacionDisenadaId] = Number(row.cnt);
      for (const d of plainList) {
        d.recetaCount = countMap[d.id] || 0;
      }
    }
  }

  return plainList;
};

/**
 * Lista las dosificaciones en estado PENDIENTE_REVISION cuyo `revisorAsignado`
 * coincide con alguno de los identificadores del usuario que consulta. Usado
 * por el home (badge "Por revisar") y por la pantalla
 * `/calidad/revisiones-dosificaciones`.
 *
 * Match flexible (decisión 2026-05-27): el campo `revisorAsignado` se persiste
 * con lo que el frontend mande al asignar revisor — puede ser `username` o
 * `${name} ${lastname}` (displayName), porque `obtenerRolesFirmante` y
 * `transicionarEstado` admiten ambos formatos. Para que el listado del revisor
 * no se rompa por cuál de los dos se eligió, hacemos match contra ambos.
 *
 * Las dosificaciones aparecen en el listado solo mientras `estado` siga siendo
 * PENDIENTE_REVISION: al aprobar (→ A_PRUEBA) o rechazar (→ BORRADOR) el cambio
 * se hace efectivo vía `transicionarEstado` y el listado se vacía sin que el
 * frontend tenga que limpiar nada.
 *
 * @param {object} db
 * @param {string|string[]} identificadores  Username y/o displayName del usuario.
 * @param {number[]|null} plantaIds  Si es array, filtra por idPlanta IN (ids);
 *                                   si es null, devuelve todas las plantas (admin).
 * @returns {Promise<object[]>}
 */
const listarPendientesRevisionParaUsuario = async (db, identificadores, plantaIds = null) => {
  const idents = (Array.isArray(identificadores) ? identificadores : [identificadores])
    .map((s) => (s != null ? String(s).trim() : ''))
    .filter((s) => s.length > 0);
  if (idents.length === 0) return [];
  const where = {
    activo: true,
    estado: 'PENDIENTE_REVISION',
    revisorAsignado: { [db.Sequelize.Op.in]: idents },
  };
  if (Array.isArray(plantaIds)) {
    if (plantaIds.length === 0) return [];
    where.idPlanta = { [db.Sequelize.Op.in]: plantaIds.map(Number) };
  }
  const rows = await db.DosificacionDisenada.findAll({
    where,
    attributes: [
      'id', 'codigo', 'nombre', 'version', 'estado',
      'idPlanta', 'idTipoHormigon',
      'revisorAsignado', 'enviadoRevisionPor', 'fechaEnvioRevision',
      'createdAt', 'updatedAt',
    ],
    include: [
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false },
      ...(db.TipoHormigon ? [{
        model: db.TipoHormigon, as: 'tipoHormigon',
        attributes: ['idTipoHormigon', 'tipoHormigon', 'fcMpa'],
        required: false,
      }] : []),
    ],
    order: [['fechaEnvioRevision', 'DESC'], ['updatedAt', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
};

const obtener = async (db, id) => {
  const row = await db.DosificacionDisenada.findByPk(id, {
    include: [
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false },
      { model: db.Cemento, as: 'cemento', required: false },
      { model: db.MezclaAgregados, as: 'mezcla', include: [{ model: db.MezclaAgregadosItem, as: 'items', required: false }], required: false },
      { model: db.Material, as: 'adicion1', attributes: ['idMaterial', 'nombre', 'densidadRelativa', 'tipoAdicion'], required: false },
      { model: db.Material, as: 'adicion2', attributes: ['idMaterial', 'nombre', 'densidadRelativa', 'tipoAdicion'], required: false },
      { model: db.Aditivo, as: 'aditivo1', attributes: ['idAditivo', 'marca', 'funcion', 'tipoFuncional', 'densidad', 'unidadDosificacion', 'dosisMinima', 'dosisMaxima', 'modoEfectoSugerido'], required: false },
      { model: db.Aditivo, as: 'aditivo2', attributes: ['idAditivo', 'marca', 'funcion', 'tipoFuncional', 'densidad', 'unidadDosificacion', 'dosisMinima', 'dosisMaxima', 'modoEfectoSugerido'], required: false },
      { model: db.Aditivo, as: 'aditivo3', attributes: ['idAditivo', 'marca', 'funcion', 'tipoFuncional', 'densidad', 'unidadDosificacion', 'dosisMinima', 'dosisMaxima', 'modoEfectoSugerido'], required: false },
      { model: db.Dosificacion, as: 'dosificacionCatalogo', attributes: ['idDosificacion', 'nombre'], required: false },
    ],
  });
  if (!row) return null;

  // ── Divergence check: mezcla actual vs snapshot ──
  const plain = row.get({ plain: true });
  if (plain.mezclaSnapshotJson && plain.estado !== 'BORRADOR' && plain.mezcla) {
    const snap = typeof plain.mezclaSnapshotJson === 'string'
      ? JSON.parse(plain.mezclaSnapshotJson) : plain.mezclaSnapshotJson;
    const mezclaActual = plain.mezcla;
    const divergencias = [];
    if (snap.version != null && mezclaActual.version != null && snap.version !== mezclaActual.version) {
      divergencias.push(`Versión cambió de ${snap.version} a ${mezclaActual.version}`);
    }
    if (snap.hashIntegridad && mezclaActual.hashIntegridad && snap.hashIntegridad !== mezclaActual.hashIntegridad) {
      divergencias.push('Hash de integridad difiere');
    }
    if (snap.tmnCalculadoMm != null && mezclaActual.tmnCalculadoMm != null
      && Number(snap.tmnCalculadoMm) !== Number(mezclaActual.tmnCalculadoMm)) {
      divergencias.push(`TMN cambió de ${snap.tmnCalculadoMm} a ${mezclaActual.tmnCalculadoMm} mm`);
    }
    if (snap.moduloFinura != null && mezclaActual.moduloFinura != null
      && Math.abs(Number(snap.moduloFinura) - Number(mezclaActual.moduloFinura)) > 0.01) {
      divergencias.push(`MF cambió de ${snap.moduloFinura} a ${mezclaActual.moduloFinura}`);
    }
    plain._mezclaDivergencia = divergencias.length > 0 ? divergencias : null;
  }

  // K.4 — Estampar override CIRSOC §3.2.3.2 f) en la respuesta. Los PDFs
  // leen este campo para pintar el banner de liberación y el bloque firmas.
  if (db.OverrideRequest && plain.idMezcla) {
    try {
      const override = await db.OverrideRequest.findOne({
        where: {
          idDosificacionDisenada: plain.id,
          idMezcla: plain.idMezcla,
          estado: 'APROBADO',
          activo: true,
        },
      });
      plain.overrideActivo = override ? override.get({ plain: true }) : null;
    } catch (err) {
      console.warn('[obtener] no se pudo cargar OverrideRequest activo:', err.message);
      plain.overrideActivo = null;
    }
  }

  return plain;
};

const eliminar = async (db, id, usuario) => {
  const row = await db.DosificacionDisenada.findByPk(id);
  if (!row) throw new Error('Dosificación no encontrada');

  // 1) Solo BORRADOR se puede eliminar
  if (!isDeletable(row.estado)) {
    throw Object.assign(
      new Error(`No se puede eliminar una dosificación en estado ${row.estado}. Solo se pueden eliminar borradores. Si ya no se utiliza, cambie el estado a ARCHIVADO.`),
      { statusCode: 422 }
    );
  }

  // 2) Verificar que no tenga recetas de obra vinculadas
  if (db.RecetaObra) {
    const recetaCount = await db.RecetaObra.count({ where: { dosificacionDisenadaId: id } });
    if (recetaCount > 0) {
      throw Object.assign(
        new Error(`No se puede eliminar: tiene ${recetaCount} receta(s) de obra vinculada(s). Archive la dosificación en su lugar.`),
        { statusCode: 422 }
      );
    }
  }

  // 3) Verificar que no haya tenido estados anteriores distintos de BORRADOR
  const histEstados = await db.DisenoHistorial.findAll({
    where: { entidadTipo: 'dosificacion', entidadId: id },
    attributes: ['estadoNuevo'],
  });
  const tuvoOtroEstado = histEstados.some(h => h.estadoNuevo && h.estadoNuevo !== 'BORRADOR');
  if (tuvoOtroEstado) {
    throw Object.assign(
      new Error('No se puede eliminar: esta dosificación tuvo estados anteriores. Archive en su lugar para mantener el registro histórico.'),
      { statusCode: 422 }
    );
  }

  // Soft delete
  await row.update({ activo: false, deletedAt: new Date(), deletedBy: usuario || null });
  return { action: 'archived' };
};

/* ═══════════════════════════════════════════
   Estado transitions
   ═══════════════════════════════════════════ */

/**
 * Transition a dosificación to a new state.
 * @param {Object} db - Sequelize models
 * @param {number} id - DosificacionDisenada id
 * @param {string} nuevoEstado - Target state
 * @param {Object} opts - { usuario, motivo, reemplazadaPorId }
 */
const transicionarEstado = async (db, id, nuevoEstado, { usuario, motivo, observaciones, metadata } = {}) => {
  const row = await db.DosificacionDisenada.findByPk(id);
  if (!row) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });

  const estadoAnterior = row.estado;
  validateTransition(estadoAnterior, nuevoEstado);

  const reqs = getTransitionRequirements(nuevoEstado);
  const updates = { estado: nuevoEstado };

  // ── Reviewer-only transitions (PENDIENTE_REVISION → A_PRUEBA / BORRADOR) ──
  // PR7 — Solo el revisor asignado o un usuario con rol ADMIN puede aprobar
  // o rechazar una revisión. Sin esta validación cualquier usuario podía
  // pulsar "Aprobar para prueba" y saltarse la decisión del revisor real.
  // Se valida ANTES de los demás requirements (calculo, mezcla, etc.) para
  // que el actor no autorizado vea el error de permiso primero, no errores
  // sobre el contenido del diseño.
  if (estadoAnterior === 'PENDIENTE_REVISION'
      && (nuevoEstado === 'A_PRUEBA' || nuevoEstado === 'BORRADOR')) {
    const usernameActual = String(usuario || '').trim();
    const revisorAsignado = String(row.revisorAsignado || '').trim();
    const rolesActor = Array.isArray(metadata?._rolesActor) ? metadata._rolesActor : [];
    const esAdmin = rolesActor.includes('ADMIN');
    const esElRevisor = revisorAsignado && usernameActual && usernameActual === revisorAsignado;
    if (!esAdmin && !esElRevisor) {
      throw Object.assign(
        new Error(`Solo el revisor asignado (${revisorAsignado || 'no asignado'}) o un Admin puede aprobar o rechazar esta revisión.`),
        { status: 403, code: 'REVISION_NO_AUTORIZADA' }
      );
    }
  }

  // ── Pre-transition validations ──

  if (reqs.requiresCalculo) {
    const resultado = typeof row.resultadoJson === 'string'
      ? JSON.parse(row.resultadoJson) : row.resultadoJson;
    if (!resultado || !resultado.aguaLtsM3) {
      throw Object.assign(
        new Error('El diseño debe tener un cálculo exitoso antes de enviar a revisión.'),
        { status: 422 }
      );
    }
  }

  if (reqs.requiresMezclaAprobada && row.idMezcla) {
    const mezcla = await db.MezclaAgregados.findByPk(row.idMezcla);
    if (mezcla && mezcla.estado !== 'APROBADO') {
      throw Object.assign(
        new Error(`La mezcla "${mezcla.nombre}" (v${mezcla.version}) está en estado ${mezcla.estado}. Solo se pueden enviar a revisión dosificaciones que referencien una mezcla aprobada.`),
        { status: 422 }
      );
    }

    // P1.4 / P0.16 — Validar conditions de la mezcla contra el contexto del diseño.
    // Helper extraído para reuso desde guardar() y aplicarCorrecciones().
    await assertMezclaConditionsCompatible(db, mezcla, row, '[transicionarEstado]');
  }

  if (reqs.requiresMotivo && !motivo) {
    throw Object.assign(
      new Error('Se requiere un motivo para esta transición.'),
      { status: 422 }
    );
  }

  // ── Reviewer assignment (BORRADOR → PENDIENTE_REVISION) ──
  // PR7 — Antes el revisor era una STRING libre (frontend lo tipeaba a mano),
  // sin garantía de que fuera un usuario real ni de que tuviera rol suficiente
  // para revisar. Ahora se valida que `metadata.revisorAsignado` corresponda
  // a un username real con rol RESPONSABLE_CALIDAD / DIRECTOR_TECNICO / ADMIN.
  if (reqs.requiresRevisor && nuevoEstado === 'PENDIENTE_REVISION') {
    if (!metadata?.revisorAsignado) {
      throw Object.assign(
        new Error('Debe asignar un revisor para enviar a revisión.'),
        { status: 422 }
      );
    }
    const usernameRevisor = String(metadata.revisorAsignado).trim();
    if (!usernameRevisor) {
      throw Object.assign(
        new Error('El revisor asignado no puede estar vacío.'),
        { status: 422 }
      );
    }
    // Validar que el username corresponda a un usuario real con rol suficiente.
    // Reusa el mismo helper que `firmantes-override` (los roles autorizados
    // para revisar coinciden con los de override).
    const candidatos = await listarFirmantesOverride(db);
    const candidato = candidatos.find((c) => c.username === usernameRevisor);
    if (!candidato) {
      throw Object.assign(
        new Error(`El revisor "${usernameRevisor}" no es un usuario válido del sistema o no tiene rol suficiente (Responsable de Calidad, Director Técnico o Admin).`),
        { status: 422, code: 'REVISOR_NO_AUTORIZADO' }
      );
    }
    // Sesión 2026-05-29: el creador SÍ puede asignarse como su propio
    // revisor. La política declarada en `domain/dosificacion/politicaRevision.js`
    // es "marcar, no bloquear" — el sistema permite el flujo para empresas
    // chicas donde una sola persona cubre todo el ciclo, y registra la
    // auto-aprobación como flag de auditoría (`AUTO_APROBACION_REVISION`)
    // en el historial. El bloqueo previo introducido en PR7 contradecía
    // esa filosofía.
  }

  // ── Pastón aprobado check (A_PRUEBA → EN_PRODUCCION) ──
  // Fase 3: si no hay pastón APROBADO, se permite el override siempre que el
  // caller declare un firmante autorizado y un motivo ≥50 caracteres. La
  // intención es no trabar a empresas chicas donde una persona cubre todo el
  // ciclo, manteniendo trazabilidad explícita. Si el firmante coincide con el
  // aprobador (caso planta de 1 sola persona técnica), se permite igual y se
  // marca `firmaConcentrada=true` para que el timeline lo destaque.
  let overrideAplicado = null; // populated when an override is signed
  // [DEBUG-DOSIF] Fast-track: la dosificación de depuración se promueve sin
  // pastón aprobado ni aptitud de materiales (no representa un diseño real).
  // Sólo mientras el flag de ambiente siga activo; si se apaga, vuelve a exigir
  // los gates normales (queda congelada), que es el default seguro.
  const _esDebugTransicion = esRegistroDebug(row) && debugDosificacionHabilitado();
  if (_esDebugTransicion && nuevoEstado === 'EN_PRODUCCION') {
    // El fast-track de depuración (saltea pastón/aptitud) es exclusivo de admin.
    const rolesActor = Array.isArray(metadata?._rolesActor) ? metadata._rolesActor : [];
    if (!rolesActor.includes('ADMIN')) {
      throw Object.assign(
        new Error('La dosificación de depuración sólo puede promoverla a producción un administrador.'),
        { status: 403, code: 'DEBUG_DOSIF_SOLO_ADMIN' },
      );
    }
  }
  if (reqs.requiresPastonAprobado && nuevoEstado === 'EN_PRODUCCION' && !_esDebugTransicion) {
    const pastones = await db.PastonPrueba.findAll({
      where: { idDosificacionDisenada: id, veredicto: 'APROBADO' },
      raw: true,
    });
    if (pastones.length === 0) {
      const ovr = metadata?.overridePaston;
      if (ovr && ovr.firmadoPor && ovr.motivo) {
        const motivo = String(ovr.motivo).trim();
        if (motivo.length < 50) {
          throw Object.assign(
            new Error('La justificación del override debe tener al menos 50 caracteres.'),
            { status: 422, code: 'OVERRIDE_MOTIVO_INSUFICIENTE' }
          );
        }
        // Validar que el firmante tenga rol autorizado (lo trae el controller
        // desde req.user en metadata.overridePaston._rolesFirmante).
        const rolesFirmante = Array.isArray(ovr._rolesFirmante) ? ovr._rolesFirmante : [];
        const rolesAutorizados = ['RESPONSABLE_CALIDAD', 'DIRECTOR_TECNICO', 'ADMIN'];
        const tieneRolAutorizado = rolesFirmante.some((r) => rolesAutorizados.includes(r));
        if (!tieneRolAutorizado) {
          throw Object.assign(
            new Error('El firmante del override debe tener rol Responsable de Calidad, Director Técnico o Admin.'),
            { status: 403, code: 'OVERRIDE_FIRMANTE_NO_AUTORIZADO' }
          );
        }
        const firmaConcentrada = ovr.firmadoPor && usuario && String(ovr.firmadoPor).trim().toLowerCase() === String(usuario).trim().toLowerCase();
        updates.overridePastonAprobado = true;
        updates.overridePastonMotivo = motivo;
        updates.overridePastonFirmadoPor = String(ovr.firmadoPor).trim();
        updates.fechaOverridePaston = new Date();
        overrideAplicado = {
          firmadoPor: updates.overridePastonFirmadoPor,
          motivo,
          firmaConcentrada,
        };
      } else {
        // Sin override: error con flag overridable=true para que el frontend
        // abra el modal de firma. El response incluye `code: PASTON_REQUERIDO`.
        throw Object.assign(
          new Error('Se requiere al menos un pastón de prueba con veredicto APROBADO para pasar a producción.'),
          { status: 422, code: 'PASTON_REQUERIDO', overridable: true }
        );
      }
    }
  }

  // ── Aptitud de materiales check (before EN_PRODUCCION or APROBADO) ──
  // [DEBUG-DOSIF] La dosificación de depuración no verifica aptitud de materiales.
  if (reqs.requiresAptitudMateriales && (nuevoEstado === 'EN_PRODUCCION' || nuevoEstado === 'APROBADO') && !_esDebugTransicion) {
    try {
      const resultado = typeof row.resultadoJson === 'string' ? JSON.parse(row.resultadoJson) : row.resultadoJson;
      const aptitud = await verificarAptitudMateriales(db, row, resultado);
      if (aptitud && aptitud.resultadoGlobal === 'no_cumple') {
        const faltantes = (aptitud.verificaciones || []).filter(v =>
          v.items?.some(it => it.estado === 'NO_CUMPLE' || it.estado === 'SIN_DATO')
        );
        const detalles = faltantes.map(v => {
          const problemas = v.items?.filter(it => it.estado === 'NO_CUMPLE' || it.estado === 'SIN_DATO')
            .map(it => `${it.parametro}: ${it.estado === 'SIN_DATO' ? 'sin ensayo' : 'no cumple'}`)
            .join(', ');
          return `${v.nombre}: ${problemas}`;
        }).join('; ');

        // If justificacion provided in metadata, allow with warning
        if (metadata?.justificacionAptitud) {
          updates.aptitudJustificacion = metadata.justificacionAptitud;
          // Log warning but allow
          console.warn(`[transicionar] APROBADO con salvedades: ${detalles}. Justificaci\u00f3n: ${metadata.justificacionAptitud}`);
        } else {
          throw Object.assign(
            new Error(`No se puede aprobar: materiales con requisitos incumplidos o sin ensayos. ${detalles}. Para aprobar con salvedades, proporcione una justificaci\u00f3n.`),
            { status: 422, aptitudDetalle: aptitud }
          );
        }
      }
    } catch (err) {
      if (err.status === 422) throw err;
      console.warn('[transicionar] Error checking aptitud:', err.message);
    }
  }

  // ── Mezcla snapshot: capturar datos al salir de BORRADOR ──
  if (estadoAnterior === 'BORRADOR' && row.idMezcla) {
    try {
      const mezcla = await db.MezclaAgregados.findByPk(row.idMezcla, { raw: true });
      if (mezcla) {
        updates.mezclaSnapshotJson = {
          idMezcla: mezcla.idMezcla,
          nombre: mezcla.nombre,
          tipoMezcla: mezcla.tipoMezcla,
          version: mezcla.version,
          hashIntegridad: mezcla.hashIntegridad || null,
          tmnCalculadoMm: mezcla.tmnCalculadoMm != null ? Number(mezcla.tmnCalculadoMm) : null,
          moduloFinura: mezcla.moduloFinura != null ? Number(mezcla.moduloFinura) : null,
          curvaMezclaJson: mezcla.curvaMezclaJson,
          metadataResultadoJson: mezcla.metadataResultadoJson,
          fechaSnapshot: new Date().toISOString(),
        };
        updates.mezclaVersion = mezcla.version;
        updates.mezclaHash = mezcla.hashIntegridad || null;
      }
    } catch (err) {
      console.warn('[transicionarEstado] Error capturing mezcla snapshot:', err.message);
    }
  }

  // ── State-specific updates ──

  if (nuevoEstado === 'PENDIENTE_REVISION') {
    updates.enviadoRevisionPor = usuario || null;
    updates.fechaEnvioRevision = new Date();
    updates.revisorAsignado = metadata?.revisorAsignado || null;
    updates.fechaAsignacionRevisor = metadata?.revisorAsignado ? new Date() : null;

    // Build valoresAdoptados from pastones and current design values
    if (db.PastonPrueba) {
      try {
        const pastones = await db.PastonPrueba.findAll({
          where: { idDosificacionDisenada: id },
          order: [['fecha', 'ASC'], ['idPastonPrueba', 'ASC']],
          raw: true,
        });
        if (pastones.length > 0) {
          const resultado = typeof row.resultadoJson === 'string'
            ? JSON.parse(row.resultadoJson) : row.resultadoJson;
          const ultimo = pastones[pastones.length - 1];

          // Determine paston de referencia (from metadata or last one)
          const pastonRefId = metadata?.pastonReferenciaId || ultimo.idPastonPrueba;
          const pastonRef = pastones.find(p => p.idPastonPrueba === pastonRefId) || ultimo;
          updates.pastonReferenciaId = pastonRef.idPastonPrueba;

          // Build adopted values
          const parametros = {};

          // Asentamiento
          if (resultado?.asentamientoNominalCm != null || pastonRef.asentamientoMedido != null) {
            const teorico = resultado?.asentamientoNominalCm;
            const medido = pastonRef.asentamientoMedido != null ? Number(pastonRef.asentamientoMedido) : null;
            parametros.asentamiento_real = {
              teorico: teorico != null ? Number(teorico) : null,
              medido,
              dentro_tolerancia: medido != null && teorico != null ? Math.abs(medido - teorico) <= 2.0 : null,
            };
          }

          // PUV
          if (resultado?.puvKgM3 != null || pastonRef.puvMedido != null) {
            parametros.puv_real = {
              teorico: resultado?.puvKgM3 != null ? Number(resultado.puvKgM3) : null,
              medido: pastonRef.puvMedido != null ? Number(pastonRef.puvMedido) : null,
            };
          }

          // Aire
          if (resultado?.airePct != null || pastonRef.aireMedido != null) {
            parametros.aire_real = {
              teorico: resultado?.airePct != null ? Number(resultado.airePct) : null,
              medido: pastonRef.aireMedido != null ? Number(pastonRef.aireMedido) : null,
            };
          }

          // Aspecto
          if (pastonRef.aspecto) {
            parametros.aspecto = pastonRef.aspecto;
          }

          // Dosis de aditivos (compare current vs original from resultadoJson)
          const aditivoFields = [
            { field: 'dosisAditivo1', idx: 0 },
            { field: 'dosisAditivo2', idx: 1 },
          ];
          for (const af of aditivoFields) {
            const currentDosis = row[af.field] != null ? Number(row[af.field]) : null;
            const originalDosis = resultado?.aditivos?.[af.idx]?.dosisOriginal ?? resultado?.aditivos?.[af.idx]?.dosisPctPc;
            if (currentDosis != null && originalDosis != null && currentDosis !== Number(originalDosis)) {
              parametros[`dosis_aditivo_${af.idx + 1}`] = {
                teorico: Number(originalDosis),
                adoptado: currentDosis,
              };
            }
          }

          // Build correcciones from historial of design changes
          const correcciones = [];
          // Track corrections between pastones by comparing paston params
          for (let i = 0; i < pastones.length - 1; i++) {
            const p = pastones[i];
            if (p.observaciones) {
              correcciones.push({
                tras_paston: i + 1,
                fecha: p.fecha,
                observaciones: p.observaciones,
              });
            }
          }

          updates.valoresAdoptados = {
            fuente: `paston_${pastones.indexOf(pastonRef) + 1}`,
            paston_referencia_id: pastonRef.idPastonPrueba,
            fecha_adopcion: new Date().toISOString().slice(0, 10),
            pastones_realizados: pastones.length,
            parametros,
            correcciones_aplicadas: correcciones,
            observaciones_generales: metadata?.observacionesRevision || observaciones || null,
          };
        }
      } catch (err) {
        console.warn('[transicionarEstado] Error building valoresAdoptados:', err.message);
      }
    }
  } else if (nuevoEstado === 'APROBADO') {
    updates.aprobadoPor = usuario || null;
    updates.fechaAprobacion = new Date();
    updates.observacionesAprobacion = observaciones || null;
    updates.motivoSuspension = null;

    // Calculate and store integrity hash
    let mezclaHash = null;
    if (row.idMezcla) {
      const mezcla = await db.MezclaAgregados.findByPk(row.idMezcla);
      if (mezcla) {
        mezclaHash = mezcla.hashIntegridad || null;
        updates.mezclaVersion = mezcla.version;
        updates.mezclaHash = mezclaHash;
      }
    }

    const datos = buildDatosDosificacion(row.get({ plain: true }), { mezclaHash, schemaVersion: HASH_SCHEMA_VERSION_ACTUAL });
    const { hashCompleto, datosJson } = calcularHash(datos);
    updates.hashIntegridad = hashCompleto;
    updates.hashDatosJson = datosJson;
    updates.hashSchemaVersion = HASH_SCHEMA_VERSION_ACTUAL;

    // Generate codigo if not set
    if (!row.codigoBase) {
      const codigoBase = generarCodigo('DOS');
      updates.codigoBase = codigoBase;
      updates.codigo = `${codigoBase}.v${row.version}`;
    } else if (!row.codigo) {
      updates.codigo = `${row.codigoBase}.v${row.version}`;
    }
  } else if (nuevoEstado === 'EN_PRODUCCION') {
    // Final production approval — hash + codigo + adopted values
    updates.puestoEnProduccionPor = usuario || null;
    updates.fechaProduccion = new Date();
    updates.observacionesAprobacion = observaciones || null;
    updates.motivoSuspension = null;

    // Build valoresAdoptados from pastones
    try {
      const pastones = await db.PastonPrueba.findAll({
        where: { idDosificacionDisenada: id },
        order: [['fecha', 'ASC'], ['idPastonPrueba', 'ASC']],
        raw: true,
      });
      if (pastones.length > 0) {
        const resultado = typeof row.resultadoJson === 'string' ? JSON.parse(row.resultadoJson) : row.resultadoJson;
        const pastonAprobado = pastones.find(p => p.veredicto === 'APROBADO') || pastones[pastones.length - 1];
        updates.pastonReferenciaId = pastonAprobado.idPastonPrueba;
        updates.valoresAdoptados = {
          fuente: `paston_aprobado_${pastonAprobado.idPastonPrueba}`,
          paston_referencia_id: pastonAprobado.idPastonPrueba,
          fecha_adopcion: new Date().toISOString().slice(0, 10),
          pastones_realizados: pastones.length,
          parametros: {
            asentamiento_real: pastonAprobado.asentamientoMedido != null ? { teorico: resultado?.asentamientoNominalCm, medido: Number(pastonAprobado.asentamientoMedido) } : null,
            puv_real: pastonAprobado.puvMedido != null ? { teorico: resultado?.puvKgM3, medido: Number(pastonAprobado.puvMedido) } : null,
            aire_real: pastonAprobado.aireMedido != null ? { teorico: resultado?.airePct, medido: Number(pastonAprobado.aireMedido) } : null,
            aspecto: pastonAprobado.aspecto || null,
            temperatura_hormigon: pastonAprobado.temperaturaHormigon != null ? Number(pastonAprobado.temperaturaHormigon) : null,
            correcciones: pastonAprobado.correccionesJson || null,
          },
          observaciones_generales: pastonAprobado.observacionesGenerales || observaciones || null,
          veredicto: pastonAprobado.veredicto,
        };
      }
    } catch (err) { console.warn('[transicionar] Error building valoresAdoptados:', err.message); }

    // Calculate integrity hash
    let mezclaHash = null;
    if (row.idMezcla) {
      const mezcla = await db.MezclaAgregados.findByPk(row.idMezcla);
      if (mezcla) { mezclaHash = mezcla.hashIntegridad || null; updates.mezclaVersion = mezcla.version; updates.mezclaHash = mezclaHash; }
    }
    const datos = buildDatosDosificacion(row.get({ plain: true }), { mezclaHash, schemaVersion: HASH_SCHEMA_VERSION_ACTUAL });
    const { hashCompleto, datosJson } = calcularHash(datos);
    updates.hashIntegridad = hashCompleto;
    updates.hashDatosJson = datosJson;
    updates.hashSchemaVersion = HASH_SCHEMA_VERSION_ACTUAL;

    // Generate codigo
    if (!row.codigoBase) {
      const codigoBase = generarCodigo('DOS');
      updates.codigoBase = codigoBase;
      updates.codigo = `${codigoBase}.v${row.version}`;
    } else if (!row.codigo) {
      updates.codigo = `${row.codigoBase}.v${row.version}`;
    }
  } else if (nuevoEstado === 'DESCARTADO') {
    updates.descartadoPor = usuario || null;
    updates.fechaDescarte = new Date();
    updates.motivoDescarte = motivo || observaciones || null;
  } else if (nuevoEstado === 'SUSPENDIDO') {
    updates.motivoSuspension = motivo || null;
    updates.suspendidoPor = usuario || null;
    updates.fechaSuspension = new Date();
  } else if (nuevoEstado === 'ARCHIVADO') {
    updates.archivadoPor = usuario || null;
    updates.fechaArchivo = new Date();
    if (metadata?.reemplazadaPorId) {
      updates.reemplazadaPorId = metadata.reemplazadaPorId;
    }
  } else if (nuevoEstado === 'BORRADOR') {
    // Revert to draft: clear all workflow fields
    updates.aprobadoPor = null;
    updates.fechaAprobacion = null;
    updates.observacionesAprobacion = observaciones || motivo || null; // keep rejection/correction reason
    updates.enviadoRevisionPor = null;
    updates.fechaEnvioRevision = null;
    updates.revisorAsignado = null;
    updates.fechaAsignacionRevisor = null;
    updates.motivoSuspension = null;
    updates.suspendidoPor = null;
    updates.fechaSuspension = null;
    updates.puestoEnProduccionPor = null;
    updates.fechaProduccion = null;
    updates.hashIntegridad = null;
    updates.hashDatosJson = null;
    // Limpiar snapshot de mezcla para que se regenere si se cambia la mezcla y se re-envía
    updates.mezclaSnapshotJson = null;
    updates.mezclaVersion = null;
    updates.mezclaHash = null;
  } else if (nuevoEstado === 'A_PRUEBA') {
    // Going to trial: record who approved for testing (if from PENDIENTE_REVISION)
    if (estadoAnterior === 'PENDIENTE_REVISION') {
      updates.aprobadoPor = usuario || null;
      updates.fechaAprobacion = new Date();
      updates.observacionesAprobacion = observaciones || null;
    }
    // Clear review assignment
    updates.revisorAsignado = null;
    updates.fechaAsignacionRevisor = null;
  }

  // ── Fase 2: snapshot pre-update para clasificación de concentración ──
  // Capturamos los firmantes ANTES de aplicar `updates`, porque la transición
  // a BORRADOR limpia `enviadoRevisionPor` y eso ocultaría la auto-revisión.
  const snapshotPreUpdate = {
    enviadoRevisionPor: row.enviadoRevisionPor,
    aprobadoPor: row.aprobadoPor,
    puestoEnProduccionPor: row.puestoEnProduccionPor,
  };

  await row.update(updates);

  // Engine puro: detecta auto-aprobaciones y devuelve flags. No bloquea.
  // Las flags se mergean a `metadata.flags` para que el timeline (Fase 4)
  // las muestre destacadas y la auditoría humana las pueda evaluar.
  const clasificacion = clasificarTransicion({
    row: snapshotPreUpdate,
    estadoAnterior,
    estadoNuevo: nuevoEstado,
    usuario: usuario || null,
  });
  const metadataClasif = metadataDeClasificacion(clasificacion);

  // Mergear con metadata recibido del caller (sin pisar claves explícitas).
  // PR7 — `_rolesActor` y `_rolesFirmante` son campos internos inyectados por
  // el controller para validaciones; no deben persistirse en historial (no
  // aportan info auditable y contaminan el output con metadata vacío).
  const metadataLimpio = metadata ? Object.fromEntries(
    Object.entries(metadata).filter(([k]) => !k.startsWith('_'))
  ) : null;
  const tieneMetadataReal = metadataLimpio && Object.keys(metadataLimpio).length > 0;
  const metadataFinal = (tieneMetadataReal || metadataClasif)
    ? { ...(metadataLimpio || {}), ...(metadataClasif || {}) }
    : null;

  // Record in both historial tables (legacy + unified)
  const historialData = {
    estadoAnterior,
    estadoNuevo: nuevoEstado,
    usuario: usuario || 'sistema',
    motivo: motivo || null,
    metadata: metadataFinal,
  };

  await db.DosificacionDisenadaHistorial.create({
    dosificacionDisenadaId: id,
    ...historialData,
  });

  // Fase 4.4: vía helper logTransicion para encadenar hashCadena.
  // El helper mapea automáticamente nuevoEstado → tipoEvento (aprobacion,
  // suspension, archivado, cambio_estado).
  {
    const { logTransicion } = require('./auditDosificacionService');
    await logTransicion(db, {
      entidadId: id,
      estadoAnterior,
      estadoNuevo: nuevoEstado,
      usuario: historialData.usuario,
      motivo: historialData.motivo,
      observaciones: observaciones || null,
      hashAlMomento: updates.hashIntegridad || row.hashIntegridad || null,
      metadata: historialData.metadata,
    });
  }

  // Fase 3 — evento dedicado override_paston cuando se firmó override.
  // Va junto al evento de aprobación para que el timeline muestre las dos
  // cosas: la transición y el motivo por el cual no había pastón aprobado.
  // Fail-soft: si la auditoría falla, no rompe la operación de negocio.
  if (overrideAplicado) {
    try {
      const { logEventoDosificacion } = require('./auditDosificacionService');
      const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
      // Si la transición vino directo de BORRADOR, se salteó TODA la fase de
      // prueba (no sólo el pastón). Se marca explícito para que el timeline y
      // las auditorías lo distingan de un override desde A_PRUEBA.
      const salteoPruebaCompleto = estadoAnterior === 'BORRADOR';
      await logEventoDosificacion(db, {
        entidadId: id,
        tipoEvento: TIPO_EVENTO.OVERRIDE_PASTON,
        estadoAnterior,
        estadoNuevo: nuevoEstado,
        usuario: usuario || 'sistema',
        motivo: overrideAplicado.motivo,
        observaciones: salteoPruebaCompleto
          ? `Pase directo a producción SIN fase de prueba (BORRADOR → EN_PRODUCCION) firmado por ${overrideAplicado.firmadoPor}${overrideAplicado.firmaConcentrada ? ' (firmante = aprobador)' : ''}.`
          : `Override de pastón firmado por ${overrideAplicado.firmadoPor}${overrideAplicado.firmaConcentrada ? ' (firmante = aprobador)' : ''}.`,
        hashAlMomento: updates.hashIntegridad || null,
        metadata: {
          firmadoPor: overrideAplicado.firmadoPor,
          firmaConcentrada: overrideAplicado.firmaConcentrada,
          salteoPruebaCompleto,
          contextoNormativa: salteoPruebaCompleto
            ? 'CIRSOC 200-2024 §3.3 — fase de prueba completa obviada por firmante autorizado (dosificación de uso previo al sistema u otra causa justificada)'
            : 'CIRSOC 200-2024 §3.3 — verificación experimental obviada por firmante autorizado',
        },
      });
    } catch (e) {
      console.warn('[transicionarEstado] Error logging override_paston event:', e.message);
    }
  }

  // Devolvemos la clasificación junto con el row recargado para que el
  // controller pueda exponerla al frontend (toast informativo).
  const reloaded = await row.reload();
  reloaded.dataValues.__clasificacion = clasificacion;
  if (overrideAplicado) {
    reloaded.dataValues.__overrideAplicado = overrideAplicado;
  }

  // Fase 2B Betonmatic — side effect best-effort. Si falla NO aborta la
  // transición; el usuario puede reintentar manualmente con el botón.
  try {
    const betonmaticSE = await _aplicarSideEffectBetonmatic(db, reloaded, estadoAnterior, nuevoEstado);
    if (betonmaticSE) reloaded.dataValues.__betonmatic = betonmaticSE;
  } catch (e) {
    console.warn('[transicionarEstado] Side-effect Betonmatic falló (no aborta):', e.message);
    reloaded.dataValues.__betonmatic = { ok: false, mensaje: e.message };
  }

  // Sesión 2026-05-29 (Bug 2 ciclo de vida): side effect de alerta de
  // revisión asignada. Si la dosificación entró a PENDIENTE_REVISION con
  // un revisor asignado, le crea una alerta personal en el panel; si
  // salió de PENDIENTE_REVISION (aprobada, rechazada, etc.), cierra las
  // alertas previas como RESUELTA. Fail-soft.
  try {
    await _aplicarSideEffectAlertaRevision(db, reloaded, estadoAnterior, nuevoEstado, usuario);
  } catch (e) {
    console.warn('[transicionarEstado] Side-effect AlertaRevision falló (no aborta):', e.message);
  }

  return reloaded;
};

/**
 * Fase 2B — Publica/borra automáticamente la fórmula en Betonmatic según la
 * transición. Trigger C: A_PRUEBA y EN_PRODUCCION publican; BORRADOR /
 * DESCARTADO / SUSPENDIDO / ARCHIVADO borran. Idempotente: si ya hay una
 * publicación activa con el mismo `codigo`, no se vuelve a llamar.
 */
async function _aplicarSideEffectBetonmatic(db, row, from, to) {
  // [VITRINA] Integración Betonmatic excluida del repo de vitrina (feature-flag OFF).
  // El bloque original publicaba/borraba la fórmula en la planta vía
  // require('./betonmaticPublicacionService'). Se devuelve null para no acoplar.
  return null;
  // eslint-disable-next-line no-unreachable
  const planta = await db.Planta.findByPk(row.idPlanta, {
    attributes: ['idPlanta', 'betonmaticActivo', 'betonmaticUrl'],
  });
  if (!planta?.betonmaticActivo || !planta?.betonmaticUrl) return null;

  // [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
  // const pubService = require('./betonmaticPublicacionService'); // (inalcanzable: return null arriba)
  const pubService = null;

  const debePublicar = to === 'A_PRUEBA' || to === 'EN_PRODUCCION' || to === 'APROBADO';
  const debeBorrar = to === 'BORRADOR' || to === 'DESCARTADO' || to === 'SUSPENDIDO' || to === 'ARCHIVADO';

  if (debePublicar) {
    const existing = await db.BetonmaticDosificacionPublicacion.findOne({
      where: { idDosificacionDisenada: row.id, estado: 'publicada' },
    });
    if (existing && existing.codigoDeHormigon === row.codigo) {
      return { ok: true, accion: 'no-op', razon: 'ya publicada con el mismo código' };
    }
    const result = await pubService.publicarDosificacionDisenada(db, row.id, {});
    return { ok: true, accion: 'publicada', codigoDeHormigon: result.publicacion?.codigoDeHormigon };
  }

  if (debeBorrar) {
    const existing = await db.BetonmaticDosificacionPublicacion.findOne({
      where: { idDosificacionDisenada: row.id, estado: 'publicada' },
    });
    if (!existing) return { ok: true, accion: 'no-op', razon: 'no había publicación activa' };
    await pubService.borrarPublicacion(db, row.id);
    return { ok: true, accion: 'borrada' };
  }

  return null;
}

/**
 * Sesión 2026-05-29 — Side effect de alerta de revisión asignada.
 *
 * Al entrar a PENDIENTE_REVISION con `revisorAsignado` poblado, crea una
 * alerta tipo `DOSIFICACION_PENDIENTE_REVISION` con `asignadaA = revisor`
 * para que el revisor la vea en su panel principal. Al salir del estado
 * (cualquier transición desde PENDIENTE_REVISION), cierra las alertas
 * previamente abiertas como RESUELTA.
 *
 * No bloquea la transición — el flujo de negocio prevalece. Si el modelo
 * AlertaCalidad no está registrado en el tenant (back-compat), no hace
 * nada.
 */
async function _aplicarSideEffectAlertaRevision(db, row, estadoAnterior, nuevoEstado, usuario) {
  if (!db.AlertaCalidad) return null;

  // Caso 1 — Entrada a PENDIENTE_REVISION: crear alerta personal al revisor.
  if (nuevoEstado === 'PENDIENTE_REVISION' && row.revisorAsignado) {
    const dosifNombre = row.nombre || row.codigo || `Dosificación #${row.id}`;
    const mensaje = `Tenés una dosificación pendiente de revisión: ${dosifNombre}.`;
    await db.AlertaCalidad.create({
      tipo: 'DOSIFICACION_PENDIENTE_REVISION',
      nivel: 'MEDIO',
      estado: 'PENDIENTE',
      mensaje,
      detalle: {
        idDosificacionDisenada: row.id,
        dosifNombre,
        enviadoPor: usuario || null,
        fechaEnvio: new Date().toISOString(),
      },
      idPlanta: row.idPlanta || null,
      idDosificacionDisenada: row.id,
      asignadaA: row.revisorAsignado,
    });
    return { accion: 'creada', asignadaA: row.revisorAsignado };
  }

  // Caso 2 — Salida de PENDIENTE_REVISION: resolver alertas pendientes.
  if (estadoAnterior === 'PENDIENTE_REVISION' && nuevoEstado !== 'PENDIENTE_REVISION') {
    const [affected] = await db.AlertaCalidad.update(
      {
        estado: 'RESUELTA',
        resueltaPor: usuario || 'sistema',
        fechaResolucion: new Date(),
        notasResolucion: `Resuelta automáticamente: dosificación transicionó a ${nuevoEstado}.`,
      },
      {
        where: {
          tipo: 'DOSIFICACION_PENDIENTE_REVISION',
          idDosificacionDisenada: row.id,
          estado: 'PENDIENTE',
        },
      },
    );
    return { accion: 'resuelta', cantidad: affected || 0 };
  }

  return null;
}

/* ═══════════════════════════════════════════
   Versioning
   ═══════════════════════════════════════════ */

/**
 * Create a new version (deep copy) of a dosificación as BORRADOR.
 * The original remains unchanged.
 * Allowed from: APROBADO, SUSPENDIDO.
 */
const crearNuevaVersion = async (db, idOriginal, { usuario, motivo } = {}) => {
  const original = await db.DosificacionDisenada.findByPk(idOriginal);
  if (!original) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });

  const allowedStates = ['EN_PRODUCCION', 'APROBADO', 'SUSPENDIDO'];
  if (!allowedStates.includes(original.estado)) {
    throw Object.assign(
      new Error(`Solo se puede crear una nueva versión desde estados: ${allowedStates.join(', ')} (actual: ${original.estado}).`),
      { status: 422 }
    );
  }

  const baseId = original.dosificacionBaseId || original.id;
  const codigoBase = original.codigoBase || generarCodigo('DOS');

  // Find the highest version in the chain
  const maxVersion = await db.DosificacionDisenada.max('version', {
    where: { dosificacionBaseId: baseId, activo: true },
  });

  const newVersion = (maxVersion || original.version) + 1;

  const copy = await db.DosificacionDisenada.create({
    nombre: original.nombre,
    descripcion: original.descripcion,
    idPlanta: original.idPlanta,
    estado: 'BORRADOR',
    version: newVersion,
    versionPadreId: original.id,
    dosificacionBaseId: baseId,
    codigoBase,
    codigo: `${codigoBase}.v${newVersion}`,
    metodo: original.metodo,
    idMezcla: original.idMezcla,
    idCemento: original.idCemento,
    idAdicion1: original.idAdicion1,
    pctReemplazoAdicion1: original.pctReemplazoAdicion1,
    idAdicion2: original.idAdicion2,
    pctReemplazoAdicion2: original.pctReemplazoAdicion2,
    idAditivo1: original.idAditivo1,
    dosisAditivo1: original.dosisAditivo1,
    modoEfectoAditivo1: original.modoEfectoAditivo1,
    idAditivo2: original.idAditivo2,
    dosisAditivo2: original.dosisAditivo2,
    modoEfectoAditivo2: original.modoEfectoAditivo2,
    idAditivo3: original.idAditivo3,
    dosisAditivo3: original.dosisAditivo3,
    modoEfectoAditivo3: original.modoEfectoAditivo3,
    // Nueva versión: arranca en ronda 1 y sin valores adoptados de la anterior.
    numeroRondaPrueba: 1,
    cementoKgM3Adoptado: null,
    proporcionesAgregadosAdoptadasJson: null,
    idDosificacionCatalogo: original.idDosificacionCatalogo,
    parametrosObjetivoJson: original.parametrosObjetivoJson,
    resultadoJson: original.resultadoJson,
    trazabilidadJson: original.trazabilidadJson,
    metodoColocacion: original.metodoColocacion || 'CONVENCIONAL',
    activo: true,
  });

  const motivoText = motivo
    ? `Nueva versión (v${newVersion}) creada a partir de v${original.version}: ${motivo}`
    : `Nueva versión (v${newVersion}) creada a partir de v${original.version}`;

  // Record in both historial tables
  const historialMeta = { versionPadreId: original.id, versionAnterior: original.version };

  await db.DosificacionDisenadaHistorial.create({
    dosificacionDisenadaId: copy.id,
    estadoAnterior: null,
    estadoNuevo: 'BORRADOR',
    usuario: usuario || 'sistema',
    motivo: motivoText,
    metadata: historialMeta,
  });

  // Fase 4.4: vía helper para encadenar hashCadena
  {
    const { logEventoDosificacion } = require('./auditDosificacionService');
    const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
    await logEventoDosificacion(db, {
      entidadId: copy.id,
      tipoEvento: TIPO_EVENTO.NUEVA_VERSION,
      estadoAnterior: null,
      estadoNuevo: 'BORRADOR',
      usuario: usuario || 'sistema',
      motivo: motivoText,
      metadata: historialMeta,
    });
  }

  // Also update codigoBase on original if it didn't have one
  if (!original.codigoBase) {
    await original.update({ codigoBase, codigo: `${codigoBase}.v${original.version}` });
  }

  return copy;
};

/**
 * Get all versions in a dosificación chain.
 */
const obtenerVersiones = async (db, id) => {
  const row = await db.DosificacionDisenada.findByPk(id);
  if (!row) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });

  const baseId = row.dosificacionBaseId || row.id;

  return db.DosificacionDisenada.findAll({
    where: { dosificacionBaseId: baseId, activo: true },
    attributes: [
      'id', 'nombre', 'estado', 'version', 'versionPadreId',
      'codigo', 'codigoBase', 'hashIntegridad',
      'aprobadoPor', 'fechaAprobacion', 'observacionesAprobacion',
      'enviadoRevisionPor', 'fechaEnvioRevision',
      'suspendidoPor', 'fechaSuspension', 'motivoSuspension',
      'archivadoPor', 'fechaArchivo',
      'reemplazadaPorId', 'createdAt', 'updatedAt',
    ],
    order: [['version', 'DESC']],
  });
};

/**
 * Get the historial (audit log) for a dosificación.
 * Uses the unified DisenoHistorial table for richer event data.
 */
const obtenerHistorial = async (db, id) => {
  // Prefer unified DisenoHistorial (has tipoEvento, observaciones, hashAlMomento)
  if (db.DisenoHistorial) {
    return db.DisenoHistorial.findAll({
      where: { entidadTipo: 'dosificacion', entidadId: id },
      order: [['createdAt', 'ASC']],
    });
  }
  // Fallback to legacy table
  return db.DosificacionDisenadaHistorial.findAll({
    where: { dosificacionDisenadaId: id },
    order: [['createdAt', 'ASC']],
  });
};

/**
 * Verify hash integrity of an approved dosificación.
 */
const verificarIntegridadDosificacion = async (db, id) => {
  const dosif = await db.DosificacionDisenada.findByPk(id);
  if (!dosif) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });

  if (!isImmutable(dosif.estado)) {
    return { ok: false, reason: `Estado ${dosif.estado} no tiene hash de integridad` };
  }

  // Get mezcla hash if referenced
  let mezclaHash = dosif.mezclaHash || null;

  const result = verificarIntegridad(dosif, buildDatosDosificacion, { mezclaHash });
  return {
    ...result,
    id: dosif.id,
    nombre: dosif.nombre,
    estado: dosif.estado,
    codigo: dosif.codigo,
    fechaAprobacion: dosif.fechaAprobacion,
  };
};

/* ═══════════════════════════════════════════
   Resultados de producción (FUNC-05)
   ═══════════════════════════════════════════ */

/**
 * Get production results for a dosificación diseñada, querying through:
 * DosificacionDisenada → (idDosificacionCatalogo) → Dosificacion → Despacho → Muestra → Probeta → EnsayoResistencia
 *
 * Returns KPIs: f'cm (media), f'ck (característica), desvío estándar, CV, cumplimiento.
 * Also returns per-ensayo detail and comparison table (design vs real).
 */
const obtenerResultadosProduccion = async (db, id, { edadDias } = {}) => {
  const dosif = await db.DosificacionDisenada.findByPk(id, {
    include: [
      { model: db.Dosificacion, as: 'dosificacionCatalogo', required: false,
        include: [
          { model: db.TipoHormigon, as: 'tipoHormigon', required: false },
          { model: db.EdadDisenio, as: 'edadDisenio', required: false },
        ],
      },
    ],
  });
  if (!dosif) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });

  if (!dosif.idDosificacionCatalogo) {
    return {
      vinculada: false,
      mensaje: 'Este diseño no está vinculado a una dosificación del catálogo de producción. Vincúlelo para ver resultados.',
      kpis: null,
      ensayos: [],
      comparacion: null,
    };
  }

  // Query all ensayos through the chain
  const targetEdad = edadDias ? Number(edadDias) : null;

  const despachos = await db.Despacho.findAll({
    where: { idDosificacion: dosif.idDosificacionCatalogo },
    attributes: ['idDespacho', 'fecha', 'volumenDepacho'],
    include: [{
      model: db.Muestra, as: 'muestras',
      required: true,
      include: [{
        model: db.Probeta, as: 'probetas',
        required: true,
        include: [{
          model: db.EnsayoResistencia, as: 'ensayo',
          required: true,
          where: targetEdad ? { edadEnsayo: targetEdad } : undefined,
        }],
      }],
    }],
    order: [['fecha', 'ASC']],
  });

  // Flatten ensayos
  const ensayos = [];
  for (const d of despachos) {
    const muestra = d.muestras; // hasOne, so single object or array — handle both
    const muestras = Array.isArray(muestra) ? muestra : (muestra ? [muestra] : []);
    for (const m of muestras) {
      for (const p of (m.probetas || [])) {
        if (!p.ensayo) continue;
        const resistencia = p.ensayo.resistencia != null ? Number(p.ensayo.resistencia) : null;
        if (resistencia == null) continue;
        ensayos.push({
          idEnsayo: p.ensayo.idEnsayoResistencia,
          idProbeta: p.idProbeta,
          idMuestra: m.idMuestra,
          idDespacho: d.idDespacho,
          fechaDespacho: d.fecha,
          edadEnsayo: p.ensayo.edadEnsayo,
          diasRotura: p.diasRotura,
          fechaEnsayo: p.ensayo.fechaEnsayo,
          resistencia,
          pendienteRevision: p.ensayo.pendienteRevision,
        });
      }
    }
  }

  if (ensayos.length === 0) {
    return {
      vinculada: true,
      idDosificacionCatalogo: dosif.idDosificacionCatalogo,
      nombreCatalogo: dosif.dosificacionCatalogo?.nombre || null,
      kpis: null,
      ensayos: [],
      comparacion: null,
      mensaje: 'No se encontraron ensayos de resistencia para esta dosificación.',
    };
  }

  // Group by edadEnsayo for multi-age analysis
  const byEdad = {};
  for (const e of ensayos) {
    const key = e.edadEnsayo || e.diasRotura || 0;
    if (!byEdad[key]) byEdad[key] = [];
    byEdad[key].push(e);
  }

  const calcKpis = (values) => {
    const n = values.length;
    if (n === 0) return null;
    const media = values.reduce((s, v) => s + v, 0) / n;
    const varianza = values.reduce((s, v) => s + (v - media) ** 2, 0) / (n > 1 ? n - 1 : 1);
    const desvio = Math.sqrt(varianza);
    const cv = media > 0 ? (desvio / media) * 100 : 0;
    // f'ck = f'cm - 1.28 * s  (fractil 10% según CIRSOC 200:2024)
    const fck = media - 1.28 * desvio;
    return {
      n,
      fcm: Math.round(media * 100) / 100,
      fck: Math.round(fck * 100) / 100,
      desvio: Math.round(desvio * 100) / 100,
      cv: Math.round(cv * 10) / 10,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  };

  // KPIs per age
  const kpisPorEdad = {};
  for (const [edad, group] of Object.entries(byEdad)) {
    kpisPorEdad[edad] = calcKpis(group.map(e => e.resistencia));
  }

  // Global KPIs (all ages combined)
  const allResistencias = ensayos.map(e => e.resistencia);
  const kpisGlobal = calcKpis(allResistencias);

  // Design values from DosificacionDisenada for comparison
  const params = dosif.parametrosObjetivoJson || {};
  const resultado = dosif.resultadoJson || {};
  const resistenciaDiseno = params.resistenciaMpa || params.fce || null;
  const edadDiseno = params.edadDias || null;
  const acDiseno = resultado.acEfectivo || resultado.acCalculado || null;

  // Legacy catalog design values
  const tipoH = dosif.dosificacionCatalogo?.tipoHormigon?.tipoHormigon || null;
  const resistenciaCatalogo = tipoH ? parseInt(tipoH.replace(/\D/g, ''), 10) || null : null;
  const edadCatalogo = dosif.dosificacionCatalogo?.edadDisenio?.dias || null;

  const comparacion = {
    resistenciaDiseno: resistenciaDiseno || resistenciaCatalogo,
    edadDiseno: edadDiseno || edadCatalogo,
    acDiseno,
    tipoHormigon: tipoH,
    fcmReal: kpisGlobal?.fcm,
    fckReal: kpisGlobal?.fck,
    desvioReal: kpisGlobal?.desvio,
    cvReal: kpisGlobal?.cv,
    nEnsayos: kpisGlobal?.n,
    cumple: kpisGlobal && resistenciaDiseno ? kpisGlobal.fck >= Number(resistenciaDiseno) : null,
    alertaCv: kpisGlobal ? kpisGlobal.cv > 15 : false,
  };

  return {
    vinculada: true,
    idDosificacionCatalogo: dosif.idDosificacionCatalogo,
    nombreCatalogo: dosif.dosificacionCatalogo?.nombre || null,
    kpis: kpisGlobal,
    kpisPorEdad,
    ensayos,
    comparacion,
  };
};

/**
 * Link a DosificacionDisenada to a legacy Dosificacion in the catalog.
 */
const vincularCatalogo = async (db, id, idDosificacionCatalogo) => {
  const row = await db.DosificacionDisenada.findByPk(id);
  if (!row) throw Object.assign(new Error('Dosificación no encontrada'), { status: 404 });
  await row.update({ idDosificacionCatalogo: idDosificacionCatalogo || null });
  return row.reload();
};

// ═══════════════════════════════════════
// Age factors (FactorEdadCemento)
// ═══════════════════════════════════════

const getFactoresEdad = async (db) => {
  if (!db.FactorEdadCemento) return [];
  const rows = await db.FactorEdadCemento.findAll({
    order: [['cementoTipo', 'ASC'], ['edadDias', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

const createFactorEdad = async (db, data) => {
  if (!db.FactorEdadCemento) throw new Error('Tabla FactorEdadCemento no disponible');
  return db.FactorEdadCemento.create({
    cementoTipo: data.cementoTipo,
    edadDias: Number(data.edadDias),
    factor: Number(data.factor),
    fuente: data.fuente || null,
  });
};

const updateFactorEdad = async (db, id, data) => {
  const row = await db.FactorEdadCemento.findByPk(id);
  if (!row) throw Object.assign(new Error('Factor no encontrado'), { statusCode: 404 });
  const updates = {};
  if (data.factor != null) updates.factor = Number(data.factor);
  if (data.fuente !== undefined) updates.fuente = data.fuente;
  if (Object.keys(updates).length) await row.update(updates);
  return row.reload();
};

const deleteFactorEdad = async (db, id) => {
  const row = await db.FactorEdadCemento.findByPk(id);
  if (!row) throw Object.assign(new Error('Factor no encontrado'), { statusCode: 404 });
  await row.destroy();
  return { success: true };
};

/**
 * Get age factors for a specific cement type (used by engine).
 * Returns a map: { edadDias: factor }
 */
const getFactoresEdadParaCemento = async (db, cementoTipo) => {
  if (!db.FactorEdadCemento || !cementoTipo) return {};
  const rows = await db.FactorEdadCemento.findAll({
    where: { cementoTipo },
    order: [['edadDias', 'ASC']],
    raw: true,
  });
  const map = {};
  for (const r of rows) map[r.edadDias] = Number(r.factor);
  return map;
};

// ═══════════════════════════════════════
// Pastón de pruebas
// ═══════════════════════════════════════

const listarPastones = async (db, idDosificacionDisenada) => {
  if (!db.PastonPrueba) return [];
  const rows = await db.PastonPrueba.findAll({
    where: { idDosificacionDisenada },
    order: [['createdAt', 'DESC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

const obtenerPaston = async (db, id) => {
  if (!db.PastonPrueba) throw new Error('Tabla PastonPrueba no disponible');
  const row = await db.PastonPrueba.findByPk(id);
  if (!row) throw Object.assign(new Error('Pastón no encontrado'), { statusCode: 404 });
  return row.get({ plain: true });
};

const crearPaston = async (db, data, userName) => {
  if (!db.PastonPrueba) throw new Error('Tabla PastonPrueba no disponible');
  const vol = Number(data.volumenM3);
  const factor = Number(data.factorExcedente || 1.10);

  // PR8 — Validar escala. Default LABORATORIO si no se declara explícito.
  const escala = (data.escala === 'PRODUCCION') ? 'PRODUCCION' : 'LABORATORIO';
  // Para PRODUCCION recomendamos ≥ 2.5 m³ (≥ 2 batches de planta, ~1.5 m³/c).
  // Si el operador pasa un volumen menor, devolvemos error explícito a menos
  // que declare `acceptVolumenBajo: true` (override consciente).
  if (escala === 'PRODUCCION' && vol < 2.5 && !data.acceptVolumenBajo) {
    throw Object.assign(
      new Error(
        `Pastón PRODUCCION con volumen ${vol} m³ es menor al mínimo recomendado de 2.5 m³. La planta produce típicamente batches de 1.5 m³, así que con menos de 2.5 m³ no se puede corregir el primer batch antes del despacho. Si querés continuar igual, agregá "acceptVolumenBajo: true" al payload.`
      ),
      { statusCode: 422, code: 'PASTON_PRODUCCION_VOLUMEN_BAJO' }
    );
  }

  // Tomar numeroRondaPrueba actual del diseño y bloquear segundo pastón en la misma ronda.
  let numeroRondaPrueba = 1;
  if (data.idDosificacionDisenada && db.DosificacionDisenada) {
    const dosif = await db.DosificacionDisenada.findByPk(data.idDosificacionDisenada, {
      attributes: ['id', 'numeroRondaPrueba'],
    });
    if (dosif) numeroRondaPrueba = Number(dosif.numeroRondaPrueba) || 1;
    const existente = await db.PastonPrueba.findOne({
      where: { idDosificacionDisenada: data.idDosificacionDisenada, numeroRondaPrueba },
    });
    if (existente) {
      throw Object.assign(
        new Error(`Ya existe un pastón para la ronda de prueba #${numeroRondaPrueba}. Enviá la dosificación a una nueva ronda para registrar otro.`),
        { statusCode: 409 }
      );
    }
  }

  // PR10 — Detectar si el caller envía datos legacy de medición. Si los
  // manda, se persisten en PastonPrueba (back-compat) y además se crea
  // automáticamente la primera MedicionPaston (etapa=PLANTA, secuencia=1).
  // Esto es el bridge entre el flujo viejo (form que pedía slump/temp/aire al
  // crear el pastón) y el flujo nuevo (form solo de metadata + carga de
  // mediciones aparte).
  const tieneDatosLegacy = (
    data.asentamientoMedido != null
    || data.temperaturaHormigon != null
    || data.temperaturaAmbiente != null
    || data.aireMedido != null
    || data.puvMedido != null
    || data.probetasMoldeadas != null
    || (data.aspecto && String(data.aspecto).trim())
  );

  const paston = await db.PastonPrueba.create({
    idDosificacionDisenada: data.idDosificacionDisenada,
    numeroRondaPrueba,
    escala,
    volumenM3: vol,
    factorExcedente: factor,
    volumenEfectivoM3: Math.round(vol * factor * 10000) / 10000,
    correccionHumedad: !!data.correccionHumedad,
    // PR9 — Humedad superficial medida por agregado al momento del pastón.
    // Si el caller la manda, se persiste para trazabilidad y para que el
    // motor de cálculo aplique corrección reproducible.
    humedadAgregadosJson: Array.isArray(data.humedadAgregadosJson) && data.humedadAgregadosJson.length > 0
      ? data.humedadAgregadosJson
      : null,
    componentes: data.componentes || [],
    fecha: data.fecha || null,
    hora: normalizeHora(data.hora),
    operador: data.operador || null,
    // Campos legacy persistidos solo para back-compat con consumers viejos.
    // PR10: el flujo nuevo SOLO usa MedicionPaston como fuente de verdad.
    asentamientoMedido: data.asentamientoMedido ?? null,
    temperaturaHormigon: data.temperaturaHormigon ?? null,
    temperaturaAmbiente: data.temperaturaAmbiente ?? null,
    puvMedido: data.puvMedido ?? null,
    aireMedido: data.aireMedido ?? null,
    aspecto: data.aspecto || null,
    probetasMoldeadas: data.probetasMoldeadas ?? null,
    tipoProbeta: data.tipoProbeta || null,
    identificacionProbetas: data.identificacionProbetas || null,
    observaciones: data.observaciones || null,
    createdBy: userName || null,
  });

  // Bridge PR10: si vinieron datos legacy de medición, crear automáticamente
  // la primera MedicionPaston con esos valores (etapa PLANTA). Idempotente
  // dentro del mismo crearPaston (es fila nueva por definición).
  if (tieneDatosLegacy && db.MedicionPaston) {
    try {
      await db.MedicionPaston.create({
        idPastonPrueba: paston.idPastonPrueba,
        ordenSecuencia: 1,
        etiqueta: 'Muestreo inicial',
        etapa: 'PLANTA',
        fechaHora: data.fecha ? new Date(data.fecha) : new Date(),
        asentamientoMm: data.asentamientoMedido ?? null,
        temperaturaHormigonC: data.temperaturaHormigon ?? null,
        temperaturaAmbienteC: data.temperaturaAmbiente ?? null,
        aireMedidoPct: data.aireMedido ?? null,
        probetasMoldeadas: data.probetasMoldeadas ?? null,
        aspecto: data.aspecto || null,
        observacion: 'Medición creada automáticamente desde los campos legacy del pastón al crearlo (PR10).',
        usuario: userName || data.operador || null,
      });
    } catch (e) {
      console.warn('[crearPaston] No se pudo crear MedicionPaston inicial:', e.message);
    }
  }

  return paston;
};

const actualizarPaston = async (db, id, data) => {
  const row = await db.PastonPrueba.findByPk(id);
  if (!row) throw Object.assign(new Error('Pastón no encontrado'), { statusCode: 404 });
  const allowed = [
    'fecha', 'hora', 'operador', 'asentamientoMedido', 'temperaturaHormigon',
    'temperaturaAmbiente', 'puvMedido', 'aireMedido', 'aspecto',
    'probetasMoldeadas', 'tipoProbeta', 'identificacionProbetas', 'observaciones',
    'componentes',
    // PR8 — escala (LABORATORIO|PRODUCCION).
    'escala',
    // PR9 — humedad de los agregados.
    'humedadAgregadosJson', 'correccionHumedad',
    // Veredicto + evaluación
    'veredicto', 'evaluadoPor', 'veredictoEmitidoPor', 'fechaVeredicto', 'observacionesGenerales',
  ];

  // PR10 — Si el pastón ya tiene mediciones cargadas, los campos legacy de
  // medición no se pueden editar acá: las mediciones son la fuente de verdad.
  // El caller debe usar el endpoint de MedicionPaston para esos cambios.
  //
  // PUV NO está en esta lista: aunque viva en el pastón legacy, su edición se
  // canaliza desde el dialog del pastón (es un dato único del pastón completo,
  // no por medición — ver comentario en PastonPruebaSection.jsx).
  //
  // probetasMoldeadas se mantiene defensivamente: el frontend actual edita
  // probetas vía PUT /muestras-pastones/:id/probetas (endpoint dedicado), pero
  // un cliente viejo podría mandarlo en este payload — rebotamos.
  //
  // Fix 2026-05-20: solo rebotamos si el VALOR CAMBIA respecto del row actual.
  // Antes rebotaba con solo "estar presente en el payload" — eso rompía el
  // flujo normal del dialog que envía todos los campos por convención de
  // formulario, aunque el user no haya tocado el campo legacy.
  const CAMPOS_LEGACY_MEDICION = new Set([
    'asentamientoMedido', 'temperaturaHormigon', 'temperaturaAmbiente',
    'aireMedido', 'aspecto', 'probetasMoldeadas',
  ]);
  const sonIguales = (a, b) => {
    if (a === b) return true;
    if (a == null && b == null) return true;
    // Tolerancia para numéricos guardados como string en DB (DECIMAL).
    if (a != null && b != null && !isNaN(Number(a)) && !isNaN(Number(b))) {
      return Number(a) === Number(b);
    }
    return false;
  };
  const intentaEditarLegacy = Object.keys(data || {}).some((k) => {
    if (!CAMPOS_LEGACY_MEDICION.has(k)) return false;
    if (data[k] === undefined) return false;
    return !sonIguales(data[k], row[k]);
  });
  if (intentaEditarLegacy && db.MedicionPaston) {
    const tieneMediciones = await db.MedicionPaston.count({ where: { idPastonPrueba: id } });
    if (tieneMediciones > 0) {
      throw Object.assign(
        new Error('Este pastón ya tiene mediciones cargadas. Para modificar asentamiento, temperaturas, aire, aspecto o probetas, editá la medición correspondiente desde el panel de mediciones.'),
        { statusCode: 422, code: 'PASTON_LEGACY_BLOQUEADO_POR_MEDICIONES' }
      );
    }
  }

  const updates = {};
  for (const k of allowed) {
    if (data[k] !== undefined) updates[k] = data[k];
  }
  // Blindaje de la columna TIME: normalizar la hora venga como venga del
  // cliente (incluye "07:20 a. m." de bundles viejos).
  if ('hora' in updates) updates.hora = normalizeHora(updates.hora);

  // Sesión 2026-06-14 — Si se emite un veredicto (no null/vacío) y antes no
  // había firmantes, el update debe traer al menos UNO. Un firmante con rol
  // suficiente es prueba de trazabilidad mínima; sin él el veredicto queda
  // sin responsable. La validación corre sobre el ESTADO RESULTANTE (mezcla
  // del row actual + updates), no sólo sobre los nuevos campos.
  const veredictoFinal = updates.veredicto !== undefined ? updates.veredicto : row.veredicto;
  if (veredictoFinal && veredictoFinal !== '' && veredictoFinal !== null) {
    const evaluadorFinal = updates.evaluadoPor !== undefined ? updates.evaluadoPor : row.evaluadoPor;
    const emisorFinal = updates.veredictoEmitidoPor !== undefined ? updates.veredictoEmitidoPor : row.veredictoEmitidoPor;
    const tieneFirmante = (evaluadorFinal && String(evaluadorFinal).trim())
      || (emisorFinal && String(emisorFinal).trim());
    if (!tieneFirmante) {
      throw Object.assign(
        new Error('El veredicto requiere al menos un firmante (Evaluado por o Emitido por).'),
        { statusCode: 422, code: 'VEREDICTO_SIN_FIRMANTE' }
      );
    }
  }

  if (Object.keys(updates).length) await row.update(updates);
  return row.reload();
};

const eliminarPaston = async (db, id) => {
  const row = await db.PastonPrueba.findByPk(id);
  if (!row) throw Object.assign(new Error('Pastón no encontrado'), { statusCode: 404 });
  await row.destroy();
  return { success: true };
};

// ── Verificación de aptitud de materiales (CIRSOC 200-2024 §3.2.3.3) ──

const verificarAptitudMateriales = async (db, dosificacionId) => {
  const dosif = await db.DosificacionDisenada.findByPk(dosificacionId);
  if (!dosif) throw Object.assign(new Error('Dosificación no encontrada'), { statusCode: 404 });

  // Get mezcla to find the AF
  const mezclaId = dosif.idMezcla;
  if (!mezclaId) return { items: [], resultadoGlobal: 'sin_mezcla', notas: ['No hay mezcla asociada'] };

  const mezcla = await db.MezclaAgregados.findByPk(mezclaId);
  if (!mezcla) return { items: [], resultadoGlobal: 'sin_mezcla', notas: ['Mezcla no encontrada'] };

  const mezclaItems = await db.MezclaAgregadosItem.findAll({
    where: { idMezcla: mezclaId },
    include: [{ model: db.Agregado, as: 'agregado' }],
  });

  // Determine tipo for each aggregate from AgregadoMeta.subtipoMaterial
  const FINO_SUBTIPOS = ['ARENA_NATURAL', 'ARENA_TRITURACION', 'MEZCLA'];
  const itemsWithTipo = [];
  for (const it of mezclaItems) {
    const ag = it.agregado || it;
    const agId = ag.idAgregado || ag.id;
    let subtipo = null;
    if (db.AgregadoMeta) {
      const meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId: agId } });
      if (meta) subtipo = meta.subtipoMaterial;
    }
    const esFino = FINO_SUBTIPOS.includes((subtipo || '').toUpperCase());
    itemsWithTipo.push({ item: it, ag, agId, subtipo, esFino });
  }

  const finoEntries = itemsWithTipo.filter(e => e.esFino);
  const gruesoEntries = itemsWithTipo.filter(e => !e.esFino);

  const results = [];
  const { getCanonicalCodigo } = require('../domain/ensayoResultRegistry');
  const { resolverContextoAplicacion } = require('./agregadoEnsayoService');

  // PR2: Catálogo de tipos cargado una vez para construir política por agregado.
  // Tomamos solo las columnas necesarias para evitar sobrecarga.
  const tiposCatalogo = await db.AgregadoEnsayoTipo.findAll({
    where: { isActive: true, material: 'AGREGADOS' },
    attributes: ['codigo', 'aplicaAHormigon', 'aplicaATBS',
                 'nivelCaracterizacionHormigon', 'nivelCaracterizacionTBS',
                 'obligatorioHormigon', 'obligatorioTBS'],
  });

  for (const entry of finoEntries) {
    const { ag, agId, subtipo } = entry;
    const agNombre = ag.nombre || 'AF';

    // Build context
    const ctx = {
      expuestoDesgaste: dosif.expuestoDesgaste || false,
      aspectoSuperficialImportante: dosif.aspectoSuperficialImportante || false,
      tipoArmadura: dosif.tipoArmadura || 'armado',
      subtipoMaterial: subtipo || null,
    };

    // Get latest ensayos for this aggregate
    const ensayos = await db.AgregadoEnsayo.findAll({
      where: { legacyAgregadoId: agId, isActive: true },
      include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
      order: [['fechaEnsayo', 'DESC']],
    });

    // Build ensayo map: key → latest result
    const ensayoMap = {};
    const CODE_MAP = {
      'IRAM1647_TERRONES_ARCILLA': 'terronesArcilla',
      'IRAM1674_MATERIAL_FINO_200': 'pasante200',
      'IRAM1540_PASA200': 'pasante200',
      'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
      'IRAM1647_SULFATOS_SO3': 'sulfatos',
      'IRAM1647_SALES_SOLUBLES': 'salesSolubles',
      'IRAM1882_CLORUROS_SOLUBLES': 'cloruros',
      'IRAM1647_MATERIA_ORGANICA': 'materiaOrganica',
    };

    for (const e of ensayos) {
      const codigo = getCanonicalCodigo(e.tipo?.codigo || '');
      const mapKey = CODE_MAP[codigo];
      if (mapKey && !ensayoMap[mapKey]) {
        let resultado = e.resultado;
        if (typeof resultado === 'string') try { resultado = JSON.parse(resultado); } catch { resultado = {}; }
        resultado = resultado || {};

        ensayoMap[mapKey] = {
          valor: resultado.valor ?? resultado.terronesPct ?? resultado.pasa200Pct ?? resultado.materiasCarbonosaPct ?? resultado.salesSolublesPct ?? resultado.sulfatosSO3Pct ?? null,
          fecha: e.fechaEnsayo,
          informe: e.nroInforme,
          operador: resultado.operador || (resultado.esMenorQue ? 'menor_que' : null),
          resultadoColorimetrico: resultado.resultadoColorimetrico || null,
          excepcionValida: resultado.excepcionValida || false,
          excepcionPct: resultado.excepcionPct || null,
        };
      }
    }

    let verificacion = verificarAptitudAF(ctx, ensayoMap);
    // PR2: aplicar política del catálogo (filtrar nivel=NINGUNA, bajar no_cumple
    // de ensayos no obligatorios a informativo).
    const contextoAg = await resolverContextoAplicacion(db, { idAgregado: agId });
    const politica = construirPoliticaParaContexto(tiposCatalogo, contextoAg);
    verificacion = aplicarPoliticaCaracterizacion(verificacion, politica, ctx);
    verificacion.agregadoId = agId;
    verificacion.agregadoNombre = agNombre;
    verificacion.tipoAgregado = 'FINO';
    verificacion.contextoAgregado = contextoAg;
    results.push(verificacion);
    // C9.2: dispatcher con anti-duplicado. La aptitud se considera exigible
    // (la dosif declara su contexto de uso) → habilitamos los disparadores
    // de inconclusive/pending para los items que lo requieran.
    try {
      await _dispatchAptitudAlertsForVerificacion(db, verificacion, { exigible: true });
    } catch (e) { console.warn('[verificarAptitudMateriales:AF] dispatcher error:', e.message); }
  }

  // ── Grueso aggregates (AG) — Tabla 3.6 ──
  for (const entry of gruesoEntries) {
    const { ag, agId, subtipo } = entry;
    const agNombre = ag.nombre || 'AG';

    const ctx = {
      expuestoDesgaste: dosif.expuestoDesgaste || false,
      tipoArmadura: dosif.tipoArmadura || 'armado',
      subtipoMaterial: subtipo || null,
      claseExposicion: dosif.exposicion || null,
      fc: dosif.resistencia || dosif.fce || null,
    };

    const ensayos = await db.AgregadoEnsayo.findAll({
      where: { legacyAgregadoId: agId, isActive: true },
      include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
      order: [['fechaEnsayo', 'DESC']],
    });

    const ensayoMap = {};
    const CODE_MAP_AG = {
      'IRAM1647_TERRONES_ARCILLA': 'terronesArcilla',
      'IRAM1674_MATERIAL_FINO_200': 'pasante200',
      'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
      'IRAM1647_SULFATOS_SO3': 'sulfatos',
      'IRAM1647_SALES_SOLUBLES': 'salesSolubles',
      'IRAM1882_CLORUROS_SOLUBLES': 'cloruros',
      'IRAM1687_1_LAJOSIDAD': 'lajosidad',
      'IRAM1687_2_ELONGACION': 'elongacion',
      'IRAM1532_DESGASTE_LA': 'desgasteLA',
      'IRAM1532_LOS_ANGELES': 'desgasteLA',
      'IRAM1525_DURABILIDAD_SULFATO': 'durabilidad',
      'IRAM1533_DENSIDAD_GRUESO': 'absorcion',
    };

    for (const e of ensayos) {
      const codigo = getCanonicalCodigo(e.tipo?.codigo || '');
      const mapKey = CODE_MAP_AG[codigo];
      if (mapKey && !ensayoMap[mapKey]) {
        let resultado = e.resultado;
        if (typeof resultado === 'string') try { resultado = JSON.parse(resultado); } catch { resultado = {}; }
        resultado = resultado || {};
        ensayoMap[mapKey] = {
          valor: resultado.valor ?? resultado.losAngelesPct ?? resultado.lajosidadPct ?? resultado.elongacionPct ?? resultado.perdidaPct ?? resultado.absorcionPct ?? null,
          fecha: e.fechaEnsayo,
          informe: e.nroInforme,
          operador: resultado.operador || (resultado.esMenorQue ? 'menor_que' : null),
        };
      }
    }

    let verificacion = verificarAptitudAG(ctx, ensayoMap);
    // PR2: aplicar política del catálogo.
    const contextoAg = await resolverContextoAplicacion(db, { idAgregado: agId });
    const politica = construirPoliticaParaContexto(tiposCatalogo, contextoAg);
    verificacion = aplicarPoliticaCaracterizacion(verificacion, politica, ctx);
    verificacion.agregadoId = agId;
    verificacion.agregadoNombre = agNombre;
    verificacion.tipoAgregado = 'GRUESO';
    verificacion.contextoAgregado = contextoAg;
    results.push(verificacion);
    // C9.2: dispatcher con anti-duplicado (mismo patrón que AF arriba).
    try {
      await _dispatchAptitudAlertsForVerificacion(db, verificacion, { exigible: true });
    } catch (e) { console.warn('[verificarAptitudMateriales:AG] dispatcher error:', e.message); }
  }

  // Global result across all aggregates.
  // PR2: 'aptitud_no_determinada' propaga si algún agregado no fue evaluado
  // bajo la política (estado neutro: ni aprueba ni bloquea, pero el sistema
  // no afirma "cumple" sin evaluación).
  const globalEstados = results.map(r => r.resultadoGlobal);
  let resultadoGlobal = 'cumple';
  if (globalEstados.some(e => e === 'no_cumple')) resultadoGlobal = 'no_cumple';
  else if (globalEstados.some(e => e === 'incompleto')) resultadoGlobal = 'incompleto';
  else if (globalEstados.some(e => e === 'aptitud_no_determinada')) resultadoGlobal = 'aptitud_no_determinada';
  else if (globalEstados.some(e => e === 'cumple_con_atencion')) resultadoGlobal = 'cumple_con_atencion';

  return {
    verificaciones: results,
    resultadoGlobal,
    contexto: {
      expuestoDesgaste: dosif.expuestoDesgaste || false,
      aspectoSuperficialImportante: dosif.aspectoSuperficialImportante || false,
      tipoArmadura: dosif.tipoArmadura || 'armado',
    },
  };
};

/**
 * Verificar aptitud sin necesitar una dosificación guardada.
 * Recibe mezclaId + contexto de diseño directamente.
 */
const verificarAptitudMaterialesByParams = async (db, { mezclaId, expuestoDesgaste, tipologiaCodigo, aspectoSuperficialImportante, tipoArmadura, claseExposicion, fc }) => {
  if (!mezclaId) return { verificaciones: [], resultadoGlobal: 'sin_mezcla', contexto: {} };

  const mezcla = await db.MezclaAgregados.findByPk(mezclaId);
  if (!mezcla) return { verificaciones: [], resultadoGlobal: 'sin_mezcla', contexto: {} };

  const mezclaItems = await db.MezclaAgregadosItem.findAll({
    where: { idMezcla: mezclaId },
    include: [{ model: db.Agregado, as: 'agregado' }],
  });

  const { getCanonicalCodigo } = require('../domain/ensayoResultRegistry');
  const { resolverContextoAplicacion } = require('./agregadoEnsayoService');
  const results = [];

  // PR2: catálogo de tipos cargado una vez (mismo patrón que verificarAptitudMateriales).
  const tiposCatalogo = await db.AgregadoEnsayoTipo.findAll({
    where: { isActive: true, material: 'AGREGADOS' },
    attributes: ['codigo', 'aplicaAHormigon', 'aplicaATBS',
                 'nivelCaracterizacionHormigon', 'nivelCaracterizacionTBS',
                 'obligatorioHormigon', 'obligatorioTBS'],
  });

  // Process each aggregate
  for (const item of mezclaItems) {
    const ag = item.agregado || item;
    const agId = ag.idAgregado || ag.id;
    const agNombre = ag.nombre || 'Agregado';

    // Determine tipo from AgregadoMeta.subtipoMaterial
    let subtipoMaterial = null;
    if (db.AgregadoMeta) {
      const meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId: agId } });
      if (meta) subtipoMaterial = meta.subtipoMaterial;
    }
    const FINO_SUBTIPOS = ['ARENA_NATURAL', 'ARENA_TRITURACION', 'MEZCLA'];
    const esFino = FINO_SUBTIPOS.includes((subtipoMaterial || '').toUpperCase());

    const ctx = {
      expuestoDesgaste: expuestoDesgaste || false,
      // X2 (2026-05-08): conservar tipologiaCodigo en el ctx para que
      // `resolveExpuestoDesgaste` (consumido por aptitudMaterialesService y
      // estadoGlobalConsolidator) pueda promover el flag cuando la tipología
      // implica desgaste superficial.
      tipologiaCodigo: tipologiaCodigo || null,
      aspectoSuperficialImportante: aspectoSuperficialImportante || false,
      tipoArmadura: tipoArmadura || 'armado',
      subtipoMaterial,
      claseExposicion: claseExposicion || null,
      fc: fc || null,
    };

    const ensayos = await db.AgregadoEnsayo.findAll({
      where: { legacyAgregadoId: agId, isActive: true },
      include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo' }],
      order: [['fechaEnsayo', 'DESC']],
    });

    const ensayoMap = {};
    const CODE_MAP_ALL = {
      'IRAM1647_TERRONES_ARCILLA': 'terronesArcilla',
      'IRAM1674_MATERIAL_FINO_200': 'pasante200',
      'IRAM1540_PASA200': 'pasante200',
      'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
      'IRAM1647_SULFATOS_SO3': 'sulfatos',
      'IRAM1647_SALES_SOLUBLES': 'salesSolubles',
      'IRAM1882_CLORUROS_SOLUBLES': 'cloruros',
      'IRAM1647_MATERIA_ORGANICA': 'materiaOrganica',
      'IRAM1687_1_LAJOSIDAD': 'lajosidad',
      'IRAM1687_2_ELONGACION': 'elongacion',
      'IRAM1532_DESGASTE_LA': 'desgasteLA',
      'IRAM1532_LOS_ANGELES': 'desgasteLA',
      'IRAM1525_DURABILIDAD_SULFATO': 'durabilidad',
      'IRAM1533_DENSIDAD_GRUESO': 'absorcion',
    };

    for (const e of ensayos) {
      const codigo = getCanonicalCodigo(e.tipo?.codigo || '');
      const mapKey = CODE_MAP_ALL[codigo];
      if (mapKey && !ensayoMap[mapKey]) {
        let resultado = e.resultado;
        if (typeof resultado === 'string') try { resultado = JSON.parse(resultado); } catch { resultado = {}; }
        resultado = resultado || {};
        ensayoMap[mapKey] = {
          valor: resultado.valor ?? resultado.losAngelesPct ?? resultado.lajosidadPct ?? resultado.elongacionPct ?? resultado.perdidaPct ?? resultado.absorcionPct ?? resultado.terronesPct ?? resultado.pasa200Pct ?? resultado.materiasCarbonosaPct ?? resultado.salesSolublesPct ?? resultado.sulfatosSO3Pct ?? null,
          fecha: e.fechaEnsayo,
          informe: e.nroInforme,
          operador: resultado.operador || (resultado.esMenorQue ? 'menor_que' : null),
          resultadoColorimetrico: resultado.resultadoColorimetrico || null,
          excepcionValida: resultado.excepcionValida || false,
        };
      }
    }

    let verificacion = esFino ? verificarAptitudAF(ctx, ensayoMap) : verificarAptitudAG(ctx, ensayoMap);
    // PR2: aplicar política del catálogo.
    const contextoAg = await resolverContextoAplicacion(db, { idAgregado: agId });
    const politica = construirPoliticaParaContexto(tiposCatalogo, contextoAg);
    verificacion = aplicarPoliticaCaracterizacion(verificacion, politica, ctx);
    verificacion.agregadoId = agId;
    verificacion.agregadoNombre = agNombre;
    verificacion.tipoAgregado = esFino ? 'FINO' : 'GRUESO';
    verificacion.contextoAgregado = contextoAg;
    results.push(verificacion);
    // C9.2: dispatcher con anti-duplicado.
    try {
      await _dispatchAptitudAlertsForVerificacion(db, verificacion, { exigible: true });
    } catch (e) { console.warn('[verificarAptitudMaterialesByParams] dispatcher error:', e.message); }
  }

  // PR2: idéntico patrón que en verificarAptitudMateriales — propagar
  // 'aptitud_no_determinada' al global cross-agregados (Hallazgo 6 revisor civil).
  const globalEstados = results.map(r => r.resultadoGlobal);
  let resultadoGlobal = 'cumple';
  if (globalEstados.some(e => e === 'no_cumple')) resultadoGlobal = 'no_cumple';
  else if (globalEstados.some(e => e === 'incompleto')) resultadoGlobal = 'incompleto';
  else if (globalEstados.some(e => e === 'aptitud_no_determinada')) resultadoGlobal = 'aptitud_no_determinada';
  else if (globalEstados.some(e => e === 'cumple_con_atencion')) resultadoGlobal = 'cumple_con_atencion';

  return {
    verificaciones: results,
    resultadoGlobal,
    contexto: { expuestoDesgaste, aspectoSuperficialImportante, tipoArmadura },
  };
};

// ── PastonCorreccion CRUD ──

const listarCorrecciones = async (db, dosificacionId) => {
  if (!db.PastonCorreccion) return [];
  return db.PastonCorreccion.findAll({
    where: { dosificacionId },
    order: [['createdAt', 'ASC']],
    raw: true,
  });
};

const crearCorreccion = async (db, data, userName) => {
  if (!db.PastonCorreccion) throw Object.assign(new Error('Modelo PastonCorreccion no disponible'), { statusCode: 500 });
  return db.PastonCorreccion.create({
    ...data,
    usuario: userName || 'sistema',
  });
};

const aplicarCorrecciones = async (db, dosificacionId, correcciones, userName) => {
  // Apply corrections to the dosificación and record them
  const dosif = await db.DosificacionDisenada.findByPk(dosificacionId);
  if (!dosif) throw Object.assign(new Error('Dosificación no encontrada'), { statusCode: 404 });

  const { isEditable } = require('../domain/dosificacion/estadoMachine');
  if (!isEditable(dosif.estado)) {
    throw Object.assign(new Error(`No se pueden aplicar correcciones en estado ${dosif.estado}`), { statusCode: 422 });
  }

  const updates = {};
  const savedCorrecciones = [];

  for (const corr of correcciones) {
    const { campo, valorNuevo, valorAnterior, campoLabel, unidad, motivo, pastonId } = corr;

    // Apply the field change
    if (dosif[campo] !== undefined) {
      updates[campo] = valorNuevo;
    }

    // Record the correction
    if (db.PastonCorreccion) {
      const saved = await db.PastonCorreccion.create({
        dosificacionId,
        pastonId: pastonId || 0,
        campo,
        campoLabel: campoLabel || campo,
        valorAnterior: String(valorAnterior),
        valorNuevo: String(valorNuevo),
        unidad: unidad || null,
        motivo: motivo || '',
        usuario: userName || 'sistema',
        recalculoEjecutado: false,
      });
      savedCorrecciones.push(saved.get({ plain: true }));
    }
  }

  // P0.5 — Marcar resultado como obsoleto: cualquier corrección invalida el
  // resultadoJson/trazabilidadJson cacheados. El frontend debe gatillar un
  // recálculo antes de exportar PDF o cambiar de estado.
  if (savedCorrecciones.length > 0) {
    updates.resultadoStale = true;
  }

  // P0.16 — si las correcciones tocaron fce, exposicion, tipoArmadura o
  // expuestoDesgaste, re-validar conditions de la mezcla contra el nuevo
  // contexto antes de persistir. Ej: bajar fce de 30 a 18 ahora habilita un
  // CUMPLE_AC, subir de 18 a 30 lo bloquea.
  const camposContextuales = ['fce', 'exposicion', 'tipoArmadura', 'expuestoDesgaste'];
  const tocaContexto = camposContextuales.some((c) => Object.prototype.hasOwnProperty.call(updates, c));
  if (tocaContexto && dosif.idMezcla) {
    const mezcla = await db.MezclaAgregados.findByPk(dosif.idMezcla);
    if (mezcla) {
      const dosifPostUpdate = { ...dosif.get({ plain: true }), ...updates };
      await assertMezclaConditionsCompatible(db, mezcla, dosifPostUpdate, '[aplicarCorrecciones]');
    }
  }

  if (Object.keys(updates).length > 0) {
    await dosif.update(updates);
  }

  // Fase 4.1 — registrar evento de auditoría para que el timeline muestre
  // que se aplicaron correcciones (qué campos, por quién, en qué pastón).
  // Fail-soft: si la auditoría falla, no rompe la operación.
  if (savedCorrecciones.length > 0) {
    try {
      const { logEventoDosificacion } = require('./auditDosificacionService');
      const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
      await logEventoDosificacion(db, {
        entidadId: dosificacionId,
        tipoEvento: TIPO_EVENTO.CORRECCION_APLICADA,
        estadoAnterior: dosif.estado,
        estadoNuevo: dosif.estado,
        usuario: userName || 'sistema',
        observaciones: `${savedCorrecciones.length} corrección(es) aplicada(s); resultado marcado como obsoleto.`,
        metadata: {
          cantidadCorrecciones: savedCorrecciones.length,
          resultadoStale: true,
          correcciones: savedCorrecciones.map(c => ({
            campo: c.campo,
            campoLabel: c.campoLabel,
            valorAnterior: c.valorAnterior,
            valorNuevo: c.valorNuevo,
            unidad: c.unidad,
            motivo: c.motivo,
            pastonId: c.pastonId,
          })),
        },
      });
    } catch (e) {
      console.warn('[aplicarCorrecciones] Error logging audit event:', e.message);
    }
  }

  return { dosificacion: dosif.get({ plain: true }), correcciones: savedCorrecciones };
};

// Consistencia (Tablas 4.1/4.2) es read-only: valor normativo CIRSOC 200:2024
// sembrado por migración. Sólo expone `getConsistencia` (definida arriba).

// AireDurabilidad (Tabla 4.3) y PulverulentoMinimo (Tabla 4.4) son read-only:
// valores normativos CIRSOC 200:2024 sembrados por migración. Sólo expone
// `getAireDurabilidad` y `getPulverulentoMinimo` (definidos arriba).

/**
 * Fase 2A — Acción "Enviar a nueva ronda de prueba".
 * Sólo válida en estado A_PRUEBA. Incrementa el contador `numeroRondaPrueba`
 * y registra un evento en `DisenoHistorial`. No cambia el estado (sigue en
 * A_PRUEBA); el pastón nuevo se cargará por el flujo habitual y reemplazará
 * al previo como referencia para la transición a EN_PRODUCCION.
 */
const enviarNuevaRondaPrueba = async (db, id, { usuario, motivo } = {}) => {
  const dosif = await db.DosificacionDisenada.findByPk(id);
  if (!dosif) throw Object.assign(new Error('Dosificación no encontrada'), { statusCode: 404 });
  if (dosif.estado !== 'A_PRUEBA') {
    throw Object.assign(
      new Error(`La dosificación debe estar en estado A_PRUEBA para iniciar una nueva ronda (estado actual: ${dosif.estado}).`),
      { statusCode: 422 }
    );
  }
  const rondaAnterior = dosif.numeroRondaPrueba || 1;
  const rondaNueva = rondaAnterior + 1;

  await dosif.update({ numeroRondaPrueba: rondaNueva });

  // Fase 4.4: vía helper para encadenar hashCadena
  try {
    const { logEventoDosificacion } = require('./auditDosificacionService');
    const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
    await logEventoDosificacion(db, {
      entidadId: id,
      tipoEvento: TIPO_EVENTO.NUEVA_RONDA_PRUEBA,
      estadoAnterior: 'A_PRUEBA',
      estadoNuevo: 'A_PRUEBA',
      usuario: usuario || 'desconocido',
      motivo: motivo || null,
      observaciones: `Ronda ${rondaAnterior} → ${rondaNueva}`,
      metadata: { rondaAnterior, rondaNueva },
    });
  } catch (e) {
    console.warn('[enviarNuevaRondaPrueba] Error logging event:', e.message);
  }

  return {
    id,
    numeroRondaPrueba: rondaNueva,
    rondaAnterior,
    motivo: motivo || null,
  };
};

/**
 * Lista DosificacionDisenada que usan un material específico.
 * El parámetro `source` discrimina por qué FK consultar.
 *
 * @param {object} db
 * @param {'cemento'|'aditivo'|'fibra'|'adicion'|'agregado'} source
 * @param {number} sourceId
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @returns {Promise<Array<{id, nombre, codigo, estado, version, createdAt, mezclaNombre}>>}
 */
const listarDosificacionesVinculadas = async (db, source, sourceId, { limit = 20 } = {}) => {
  if (!sourceId) return [];
  const id = Number(sourceId);
  if (Number.isNaN(id)) return [];
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));

  const baseSelect = `SELECT DISTINCT d.id, d.nombre, d.codigo, d.estado, d.version, d.createdAt,
                              m.nombre AS mezclaNombre
                       FROM \`DosificacionDisenada\` d
                       LEFT JOIN \`MezclaAgregados\` m ON d.idMezcla = m.idMezcla`;
  let whereClause;
  switch (source) {
    case 'cemento':
      whereClause = 'WHERE d.idCemento = :id';
      break;
    case 'aditivo':
      whereClause = 'WHERE d.idAditivo1 = :id OR d.idAditivo2 = :id OR d.idAditivo3 = :id';
      break;
    case 'fibra':
      whereClause = 'WHERE d.idMacrofibra = :id OR d.idMicrofibra = :id';
      break;
    case 'adicion':
      whereClause = 'WHERE d.idAdicion1 = :id OR d.idAdicion2 = :id';
      break;
    case 'agregado':
      // Reutilizo la consulta del agregadoService: vincula vía MezclaAgregadosItem.
      // Raw query justificada: `SELECT DISTINCT` con `INNER JOIN` a 2 tablas
      // intermedias y `LIMIT` no se modela bien con `findAll` + `include`
      // (Sequelize emite subqueries con `DISTINCT` que rompen el LIMIT y
      // duplican filas según las asociaciones). El raw mantiene el plan
      // simple y el resultado en una sola fila por dosificación.
      try {
        const [rows] = await db.sequelize.query(`
          SELECT DISTINCT d.id, d.nombre, d.codigo, d.estado, d.version, d.createdAt,
                 m.nombre AS mezclaNombre
          FROM \`DosificacionDisenada\` d
          JOIN \`MezclaAgregados\` m ON d.idMezcla = m.idMezcla
          JOIN \`MezclaAgregadosItem\` mi ON m.idMezcla = mi.idMezcla
          WHERE mi.idAgregado = :id
          ORDER BY d.createdAt DESC
          LIMIT ${lim}
        `, { replacements: { id } });
        return rows;
      } catch (e) {
        console.warn('[listarDosificacionesVinculadas] agregado:', e.message);
        return [];
      }
    default:
      return [];
  }

  // Raw query justificada: `baseSelect` define un JOIN izquierdo a `MezclaAgregados`
  // que `findAll` + `include: { model: ..., required: false }` también ejecutaría,
  // pero la flexibilidad del WHERE dinámico (5 ramas con FKs distintas, algunas con
  // OR sobre 3 columnas) se expresa más claro con SQL plano que componiendo
  // operadores de Sequelize.
  try {
    const [rows] = await db.sequelize.query(
      `${baseSelect} ${whereClause} ORDER BY d.createdAt DESC LIMIT ${lim}`,
      { replacements: { id } }
    );
    return rows;
  } catch (e) {
    console.warn(`[listarDosificacionesVinculadas] ${source}:`, e.message);
    return [];
  }
};

/* ════════════════════════════════════════════
   Helper: cálculo HRDC
   ════════════════════════════════════════════
   Branch dedicado para tipologíaCodigo='hrdc'. Construye los inputs del
   motor `hrdcCalcEngine` desde los recursos ya cargados por `calcular()`,
   invoca el motor y devuelve el shape `{ resultado, warnings, fuentesCalculo,
   trazabilidad, derivedMeta, ... }` que espera el endpoint.

   IMPORTANT: el motor HRDC es separado del ICPA. Las verificaciones CIRSOC
   200 (clase exposición, Tabla 4.3, 9.3, aptitud, IRAM 1627, predicción
   fresco) NO se aplican a HRDC; se omiten deliberadamente.
   */
/* ═══════════════════════════════════════════
   Branch Alivianado — motor independiente (sesión 2026-05-29)
   ═══════════════════════════════════════════
   Análogo a _calcularHRDC. Saltea ICPA por completo: el motor
   calcula directamente desde cemento (CUC), consistencia objetivo,
   mezcla y material liviano. No hay verificaciones CIRSOC. */
async function _calcularAlivianado({
  db,
  body, cemento, mezclaData,
  aditivosCargados, derivedMeta, effectiveTmn, effectiveForma,
  plantaAlivianadoCfg = null,
}) {
  // 1) Cargar y validar el material liviano del catálogo.
  const materialLivianoSvc = require('./materialLivianoService');
  const materialLivianoData = await materialLivianoSvc.obtener(db, body.idMaterialLiviano);
  if (!materialLivianoData) {
    throw Object.assign(
      new Error(`Material liviano #${body.idMaterialLiviano} no encontrado en el catálogo.`),
      { statusCode: 422, code: 'ALIVIANADO_MATERIAL_LIVIANO_NO_ENCONTRADO' },
    );
  }
  if (!materialLivianoData.activo) {
    throw Object.assign(
      new Error(`El material liviano "${materialLivianoData.nombre}" está archivado. Elegí otro o reactivalo.`),
      { statusCode: 422, code: 'ALIVIANADO_MATERIAL_LIVIANO_ARCHIVADO' },
    );
  }
  if (!materialLivianoData.densidad || Number(materialLivianoData.densidad) <= 0) {
    throw Object.assign(
      new Error(`El material liviano "${materialLivianoData.nombre}" no tiene densidad declarada — cargá la densidad (kg/m³) en el catálogo.`),
      { statusCode: 422, code: 'ALIVIANADO_MATERIAL_LIVIANO_SIN_DENSIDAD' },
    );
  }

  // 2) Mapear consistencia del body al input del motor.
  const _cMet = String(body.consistenciaMetodo || '').toLowerCase();
  let metodo = 'ASENTAMIENTO';
  let valorCm = null;
  if (body.consistenciaValor != null && Number(body.consistenciaValor) > 0) {
    valorCm = Number(body.consistenciaValor);
    metodo = _cMet === 'extendido' ? 'EXTENDIDO_CONO' : 'ASENTAMIENTO';
  } else if (body.asentamientoMm != null && Number(body.asentamientoMm) > 0) {
    valorCm = Number(body.asentamientoMm) / 10;
    metodo = 'ASENTAMIENTO';
  }

  // 3) Mapear mezcla a items con densidad (la `mezclaData.items` ya viene
  //    enriquecida con densidad del flow principal, líneas 855+).
  const mezclaItems = (mezclaData?.items || []).map((it) => ({
    nombre: it.nombre,
    porcentaje: Number(it.porcentaje) || 0,
    densidad: it.densidad != null ? Number(it.densidad) : null, // g/cm³ (motor maneja ambos)
    tipo: it.esGrueso ? 'GRUESO' : (it.esFino ? 'FINO' : null),
    idAgregado: it.idAgregado,
  }));

  // 4) Mapear aditivos. Importante: `dosis` ya viene normalizada por
  //    `fetchAditivo` desde el body (% sobre cemento). Pasamos además
  //    `modoEfecto`, `etapa` y campos de ficha técnica para que el motor
  //    pueda aplicar `AHORRO_AGUA` (reducción real de agua) y respetar la
  //    semántica de etapa OBRA (sin descuento).
  const aditivosForEngine = (aditivosCargados || []).map((a, idx) => ({
    nombre: a.marca || a.descripcion || `Aditivo ${a.idAditivo}`,
    slotIdx: Number.isFinite(Number(a.slotIdx)) ? Number(a.slotIdx) : idx,
    slotLabel: `Aditivo ${(Number.isFinite(Number(a.slotIdx)) ? Number(a.slotIdx) : idx) + 1}`,
    dosis: Number(a.dosis) || 0,
    densidad: a.densidad != null ? Number(a.densidad) : 1.05,
    modoEfecto: a.modoEfecto || null,
    etapa: a.etapa || 'PLANTA',
    reduccionAguaPctEsperada: a.reduccionAguaPctEsperada != null
      ? Number(a.reduccionAguaPctEsperada) : 0,
    dosisMinima: a.dosisMinima != null ? Number(a.dosisMinima) : null,
    dosisHabitual: a.dosisHabitual != null ? Number(a.dosisHabitual) : null,
    dosisMaxima: a.dosisMaxima != null ? Number(a.dosisMaxima) : null,
  }));

  // 5) Llamar al motor independiente.
  const out = calcularDosificacionAlivianado({
    cementoKgM3: Number(body.cementoKgM3),
    consistencia: { metodo, valorCm },
    airePct: body.airePct != null ? Number(body.airePct) : undefined,
    mezcla: { items: mezclaItems },
    materialLiviano: {
      id: materialLivianoData.id,
      nombre: materialLivianoData.nombre,
      densidad: Number(materialLivianoData.densidad),
    },
    dosisPerlasLM3: Number(body.dosisPerlasLM3),
    cemento: {
      densidadRelativa: cemento?.densidadRelativa != null ? Number(cemento.densidadRelativa) : null,
      nombre: cemento?.nombreComercial || null,
    },
    aditivos: aditivosForEngine,
    factorAguaConsistencia: plantaAlivianadoCfg?.factorAguaConsistencia,
    fce: body.fce != null ? Number(body.fce) : (body.resistenciaMpa != null ? Number(body.resistenciaMpa) : null),
  });

  // 6) Enriquecer trazabilidad con mezcla base (para que el PDF muestre
  //    granulometría / componentes — mismo patrón que HRDC).
  const trazabilidad = out.trazabilidad || {};
  if (mezclaData) {
    trazabilidad.mezclaBase = {
      idMezcla: mezclaData.idMezcla,
      nombre: mezclaData.nombre,
      tmnCalculadoMm: mezclaData.tmnCalculadoMm,
      moduloFinura: mezclaData.moduloFinura,
      curvaMezclaJson: mezclaData.curvaMezclaJson,
      items: mezclaItems,
    };
  }
  trazabilidad.materialLiviano = {
    id: materialLivianoData.id,
    nombre: materialLivianoData.nombre,
    densidadKgM3: Number(materialLivianoData.densidad),
  };
  // Sección G del PDF (Trazabilidad del agua) lee `traz.aguaBase.aguaLtsM3`.
  // Lo poblamos desde el motor para no mostrar "—" en la fila base.
  if (trazabilidad.aguaBaseAntesFactor != null && !trazabilidad.aguaBase) {
    trazabilidad.aguaBase = {
      aguaLtsM3: Number(trazabilidad.aguaBaseAntesFactor),
      metodo: `ANCLAS_SEGERER_${String(metodo)}`,
      consistenciaCm: valorCm,
      factorPlanta: plantaAlivianadoCfg?.factorAguaConsistencia ?? 1.0,
    };
  }

  return {
    resultado: out.resultado,
    warnings: out.warnings || [],
    fuentesCalculo: [],
    trazabilidad,
    tipologia: { codigo: 'alivianado', nombre: 'Hormigón alivianado — agregado liviano (modelo no normativo)' },
    derivedMeta,
    abortado: !out.resultado,
    metodoCalculo: 'ALIVIANADO',
  };
}

/* [DEBUG-DOSIF] Adaptador del motor de depuración al envelope canónico del
 * endpoint. No hace fetch de entidades: lee las dosis libres del body (en
 * `body.debug` o, por compat, en el top-level) y delega en el engine puro.
 * Las FK (idCemento, idAditivoN, idMezcla, idMacrofibra...) las persiste
 * `guardar` desde el body tal cual; acá sólo construimos resultado/trazabilidad. */
function _calcularDebug(body) {
  const d = (body && typeof body.debug === 'object' && body.debug) ? body.debug : body;
  const engineResult = calcularDosificacionDebug({
    aguaLtsM3: d.aguaLtsM3,
    cementoKgM3: d.cementoKgM3,
    adicion1KgM3: d.adicion1KgM3,
    adicion2KgM3: d.adicion2KgM3,
    aditivos: Array.isArray(d.aditivos) ? d.aditivos : [],
    agregados: Array.isArray(d.agregados) ? d.agregados : [],
    macrofibraKgM3: d.macrofibraKgM3,
    microfibraKgM3: d.microfibraKgM3,
    context: { nombre: body?.nombre || null },
  });
  if (engineResult.abortado || !engineResult.resultado) {
    const err = (engineResult.warnings || []).find(w => w.tipo === 'error');
    throw Object.assign(
      new Error(err?.msg || 'La dosificación de depuración requiere agua (L/m³) > 0.'),
      { statusCode: 422, code: 'DEBUG_DOSIF_INVALIDA' },
    );
  }
  return {
    resultado: engineResult.resultado,
    warnings: engineResult.warnings || [],
    fuentesCalculo: engineResult.fuentesCalculo || [],
    trazabilidad: engineResult.trazabilidad || {},
    tipologia: { codigo: 'debug', nombre: 'DEBUG — Dosificación de depuración' },
    derivedMeta: { effectiveTmn: null, effectiveForma: null, tmnSource: 'DEBUG', formaSource: 'DEBUG' },
    abortado: false,
    metodoCalculo: 'DEBUG',
  };
}

async function _calcularHRDC({
  body, cemento, mezclaData, abacoCurvasReferencia,
  aditivosCargados, derivedMeta, effectiveTmn, effectiveForma,
  curvaCemento = null,
  plantaRdcCfg = null,
}) {
  const cementoKgM3 = Number(body.cementoKgM3);
  // PUV objetivo — precedencia: (1) input explícito del diseño;
  // (2) config de planta modo PUV_OBJETIVO; (3) modo REDUCCION_PCT (el motor
  // resuelve desde el mortero base con `reduccionPctRDC`).
  let densidadObjetivoKgM3 = body.densidadObjetivoKgM3 != null ? Number(body.densidadObjetivoKgM3) : null;
  if (densidadObjetivoKgM3 == null
      && plantaRdcCfg?.rdcModoDensidad === 'PUV_OBJETIVO'
      && plantaRdcCfg.rdcPuvObjetivoKgM3 != null) {
    densidadObjetivoKgM3 = Number(plantaRdcCfg.rdcPuvObjetivoKgM3);
  }
  const reduccionPctRDC = plantaRdcCfg?.rdcReduccionPct != null ? Number(plantaRdcCfg.rdcReduccionPct) : undefined;
  const puvToleranciaKgM3 = plantaRdcCfg?.rdcPuvToleranciaKgM3 != null ? Number(plantaRdcCfg.rdcPuvToleranciaKgM3) : undefined;
  const factorAguaConsistenciaRDC = plantaRdcCfg?.rdcFactorAguaConsistencia != null
    ? Number(plantaRdcCfg.rdcFactorAguaConsistencia) : undefined;
  const fceInformativoMPa = (body.fce != null) ? Number(body.fce)
    : (body.resistenciaMpa != null ? Number(body.resistenciaMpa) : null);

  // Fase 3 — consistencia objetivo gobierna el agua. Mapeo desde el sistema
  // de consistencia existente: método 'extendido' → EXTENDIDO_CONO; el resto
  // (o asentamiento directo) → ASENTAMIENTO. Valor en cm.
  let consistenciaMetodoRDC = null;
  let consistenciaValorRDC = null;
  const _cMet = String(body.consistenciaMetodo || '').toLowerCase();
  if (body.consistenciaValor != null && Number(body.consistenciaValor) > 0) {
    consistenciaValorRDC = Number(body.consistenciaValor);
    consistenciaMetodoRDC = _cMet === 'extendido' ? 'EXTENDIDO_CONO' : 'ASENTAMIENTO';
  } else if (body.asentamientoMm != null && Number(body.asentamientoMm) > 0) {
    consistenciaValorRDC = Number(body.asentamientoMm) / 10; // mm → cm
    consistenciaMetodoRDC = 'ASENTAMIENTO';
  }

  // Identificar el aditivo espumígeno entre los slots cargados.
  const espumigeno = aditivosCargados.find(a =>
    a && (a.tipoFuncional === 'ESPUMIGENO' || a.modoEfecto === 'ESPUMIGENO')
  ) || null;
  const aditivosAux = aditivosCargados.filter(a => a && a !== espumigeno);

  // Construir composición de la mezcla a partir de items (porcentaje + densidad SSS).
  const composicionMezcla = (mezclaData?.items || []).map(it => ({
    tipo: it.esGrueso ? 'AG' : 'AF',
    descripcion: it.nombre,
    pctEnMezcla: Number(it.porcentaje) || 0,
    densidadSSSKgM3: it.densidad ? Number(it.densidad) * 1000 : null, // ficha viene en g/cm³
  })).filter(c => c.densidadSSSKgM3);

  // Densidad SSS ponderada (kg/m³): promedio por porcentaje.
  let densidadAgregadoSSSKgM3 = null;
  if (composicionMezcla.length > 0) {
    const totalPct = composicionMezcla.reduce((s, c) => s + c.pctEnMezcla, 0);
    if (totalPct > 0) {
      densidadAgregadoSSSKgM3 = composicionMezcla.reduce(
        (s, c) => s + c.densidadSSSKgM3 * (c.pctEnMezcla / totalPct), 0
      );
    }
  }

  const moduloFinura = body.moduloFinura != null ? Number(body.moduloFinura)
    : (mezclaData?.moduloFinura ? Number(mezclaData.moduloFinura) : null);

  const formaForAbaco = (effectiveForma && effectiveForma !== 'NO_DEFINIDO')
    ? effectiveForma
    : 'TRITURADO';

  const engineCtx = {
    cementoNombre: cemento.nombreComercial
      ? `${cemento.nombreComercial}${cemento.fabricante ? ` — ${cemento.fabricante}` : ''}`.trim()
      : null,
    mezclaNombre: mezclaData?.nombre || null,
    espumigenoNombre: espumigeno
      ? (espumigeno.marca || espumigeno.descripcion || `Aditivo ${espumigeno.idAditivo}`)
      : null,
  };

  const engineResult = calcularDosificacionHRDC({
    cementoKgM3,
    cemento,
    moduloFinura,
    formaAgregado: formaForAbaco,
    densidadAgregadoSSSKgM3,
    composicionMezcla: composicionMezcla.length > 0 ? composicionMezcla : null,
    abacoCurvasReferencia: abacoCurvasReferencia || [],
    aditivoEspumigeno: espumigeno,
    aditivosAux,
    tmnMm: effectiveTmn,
    densidadObjetivoKgM3,
    reduccionPctRDC,
    puvToleranciaKgM3,
    // Fase 3 — la consistencia gobierna el agua; el f'c es opcional/orientativo.
    consistenciaMetodoRDC,
    consistenciaValorRDC,
    factorAguaConsistenciaRDC,
    fceObjetivoMPa: fceInformativoMPa,   // opcional → verificación orientativa por CUC
    fceInformativoMPa,
    curvaCemento,
    edadResistenciaDias: 28,
    context: engineCtx,
  });

  // Adapt to canonical shape consumed by the endpoint.
  // `resultado` lleva campos legacy-compatibles (cementoKgM3, aguaLtsM3,
  // aireTotalPct, agregados[]) + campos HRDC propios (etiqueta, densidad
  // fresca, ac informativa, aditivos detallados, volumetría).
  const r = engineResult;
  const resultado = r.abortado ? null : {
    // Compatibilidad con consumidores existentes (PDF, frontend)
    cementoKgM3: r.cementoKgM3,
    cementoTotalKgM3: r.cementoKgM3,
    aguaLtsM3: r.aguaKgM3,
    // Aire: la UI lee `airePct` (atrapado + incorporado). En HRDC todo el aire
    // proviene del espumígeno (incorporado). Mapeamos a las tres claves para
    // compatibilidad con consumidores legacy y nuevos.
    airePct: r.aireIncorporadoPct,
    aireTotalPct: r.aireIncorporadoPct,
    aireAtrapado: 0,
    aireIncorporado: r.aireIncorporadoPct,
    ac: r.ac,
    agregados: (r.agregadosDetalle || []).map(a => {
      // Absorción por agregado: el motor HRDC no la usa en el cálculo (la
      // mezcla cierra por masa), pero el Anexo la informa. La traemos de
      // `mezclaData.items` (ya enriquecida con ensayo/ficha) matcheando por
      // nombre. Antes quedaba en "—".
      const mItem = (mezclaData?.items || []).find(it => it.nombre === a.descripcion);
      const absPct = mItem && mItem.absorcion != null ? Number(mItem.absorcion) : null;
      return {
        nombre: a.descripcion,
        tipo: a.tipo,
        pctEnMezcla: a.pctEnMezcla,
        // Alias para el shape que consume el PDF/Anexo (stageAgregados lee
        // `porcentaje`/`proporcionNormalizada`/`absorcionPct`). En HRDC el
        // % en mezcla ES la proporción (cierre de masa, sin normalización
        // granulométrica separada). Antes quedaban en "—".
        porcentaje: a.pctEnMezcla,
        proporcionNormalizada: a.pctEnMezcla,
        absorcionPct: absPct,
        kgM3: a.masaKgM3,
        volumenLM3: a.volumenLM3,
      };
    }),
    // Específicos HRDC
    etiqueta: r.etiqueta,
    aireIncorporadoPct: r.aireIncorporadoPct,
    densidadFrescaCalc: r.densidadFrescaCalc,
    densidadObjetivoKgM3: r.densidadObjetivoKgM3,
    puvObjetivoKgM3: r.puvObjetivoKgM3,
    densidadMorteroBaseKgM3: r.densidadMorteroBaseKgM3,
    modoPuv: r.modoPuv,
    fceObjetivoMPa: r.fceObjetivoMPa,
    fceInformativoMPa: r.fceInformativoMPa,
    resistenciaEstimada: r.resistenciaEstimada,
    aditivos: r.aditivos,
    volumenes: r.volumenes,
  };

  // Enriquecer la trazabilidad con la mezcla base para que el PDF pueda
  // mostrar la granulometría y los componentes (la sección "Trazabilidad
  // del agua", la "Forma del agregado" y el bloque granulométrico HRDC
  // dependen de esta info).
  const trazabilidad = r.trazabilidad || {};
  if (mezclaData) {
    trazabilidad.mezclaBase = {
      idMezcla: mezclaData.idMezcla,
      nombre: mezclaData.nombre,
      tmnCalculadoMm: mezclaData.tmnCalculadoMm,
      moduloFinura: mezclaData.moduloFinura,
      curvaMezclaJson: mezclaData.curvaMezclaJson,
      items: (mezclaData.items || []).map(it => ({
        idAgregado: it.idAgregado,
        nombre: it.nombre,
        porcentaje: it.porcentaje,
        densidad: it.densidad,
        esGrueso: !!it.esGrueso,
        esFino: !!it.esFino,
      })),
    };
  }

  return {
    resultado,
    warnings: r.warnings || [],
    fuentesCalculo: r.fuentesCalculo || [],
    trazabilidad,
    tipologia: { codigo: 'hrdc', nombre: 'HRDC — Hormigón de Resistencia y Densidad Controlada' },
    derivedMeta,
    abortado: r.abortado === true,
    metodoCalculo: 'HRDC',
  };
}

/* ═══════════════════════════════════════════
   Fase 3 — Override de pastón: helpers de firmantes
   ═══════════════════════════════════════════ */

/**
 * Devuelve los roles canónicos del usuario identificado por el username
 * o nombre completo recibido del frontend (el campo `firmadoPor` del
 * override). Se usa en `transicionarEstado` para validar dura que el
 * firmante tenga rol RESPONSABLE_CALIDAD, DIRECTOR_TECNICO o ADMIN.
 *
 * Acepta tanto `username` (login) como `${name} ${lastname}` (display)
 * para tolerar las dos formas en las que el frontend puede mandar el
 * identificador.
 */
async function obtenerRolesFirmante(db, identifier) {
  if (!db?.User || !identifier) return [];
  const ident = String(identifier).trim();
  if (!ident) return [];

  // Buscamos por username, o por concatenación name+lastname (display)
  const where = {
    [db.Sequelize.Op.or]: [
      { username: ident },
      db.Sequelize.where(
        db.Sequelize.fn('CONCAT', db.Sequelize.col('name'), ' ', db.Sequelize.col('lastname')),
        ident
      ),
    ],
  };

  const user = await db.User.findOne({
    where,
    include: db.Empleado ? [{
      model: db.Empleado,
      as: 'empleado',
      required: false,
      include: db.Rol ? [{
        model: db.Rol,
        as: 'roles',
        through: { attributes: [] },
        attributes: ['nombreRol'],
      }] : [],
    }] : [],
  });
  if (!user) return [];

  const roles = (user.empleado?.roles || []).map((r) => r.nombreRol).filter(Boolean);
  // Backward-compat: legacy isAdmin cuenta como ADMIN canónico.
  if (user.isAdmin === true && !roles.includes('ADMIN')) roles.push('ADMIN');
  return roles;
}

/**
 * Lista los usuarios del tenant que pueden firmar un override de pastón.
 * Filtra a quienes tienen rol RESPONSABLE_CALIDAD, DIRECTOR_TECNICO o ADMIN.
 * Se exponen solo campos básicos para no leakear PII innecesaria.
 *
 * Refactor 2026-05-20 — single-read: los roles se derivan directo de
 * `User.isAdmin` y `User.rolCalidad` (los canónicos en EmpleadoRol fueron
 * eliminados en la migración 20260617).
 */
async function listarFirmantesOverride(db) {
  if (!db?.User) return [];

  const users = await db.User.findAll({
    where: { hidden: false },
    attributes: ['id', 'username', 'name', 'lastname', 'isAdmin', 'rolCalidad'],
    order: [['name', 'ASC'], ['lastname', 'ASC']],
  });

  return users
    .map((u) => {
      // Reconstrucción del array `roles` desde fuentes directas. La forma
      // (`['RESPONSABLE_CALIDAD', ...]`) se mantiene por compatibilidad con
      // consumers que ya esperan ese shape (frontend OverridePastonDialog
      // + chequeo en transicionarEstado para revisores).
      //
      // Sesión 2026-05-29: la comparación de `isAdmin` afloja de `=== true`
      // a coerce booleano (`!!`). En algunos tenants el driver MySQL devuelve
      // `1` (TINYINT) en lugar del boolean `true`, y la comparación estricta
      // dejaba al admin afuera del listado.
      const roles = [];
      if (u.isAdmin) roles.push('ADMIN');
      if (u.rolCalidad === 'RESPONSABLE_CALIDAD' || u.rolCalidad === 'DIRECTOR_TECNICO') {
        roles.push(u.rolCalidad);
      }
      return {
        id: u.id,
        username: u.username,
        name: u.name,
        lastname: u.lastname,
        displayName: `${u.name || ''} ${u.lastname || ''}`.trim(),
        roles,
      };
    })
    .filter((u) => u.roles.length > 0);
}

module.exports = {
  normalizeHora,
  getCurvasAguaAsentamiento,
  createCurvaAguaAsentamiento,
  updateCurvaAguaAsentamiento,
  deleteCurvaAguaAsentamiento,
  getCurvasACResistencia,
  createCurvaACResistencia,
  updateCurvaACResistencia,
  deleteCurvaACResistencia,
  updateFactorAjusteFamilia,
  getFactorAjusteFamilia,
  getAireEsperado,
  getDurabilidadExposicion,
  getCorrectoresICPA,
  getAbacoCurvaICPA,
  createAbacoCurvaICPA,
  updateAbacoCurvaICPA,
  deleteAbacoCurvaICPA,
  restoreAbacoCurvaICPADefaults,
  calcular,
  guardar,
  listar,
  listarPendientesRevisionParaUsuario,
  obtener,
  eliminar,
  transicionarEstado,
  obtenerRolesFirmante,
  listarFirmantesOverride,
  enviarNuevaRondaPrueba,
  crearNuevaVersion,
  obtenerVersiones,
  obtenerHistorial,
  verificarIntegridadDosificacion,
  obtenerResultadosProduccion,
  vincularCatalogo,
  // ── HRDC (testing helpers exported) ──
  _calcularHRDC,
  esTipologiaHRDC,
  // [DEBUG-DOSIF] Dosificación de depuración (herramienta temporal y removible)
  _calcularDebug,
  esTipologiaDebug,
  debugDosificacionHabilitado,
  // ── Age factors ──
  getFactoresEdad,
  createFactorEdad,
  updateFactorEdad,
  deleteFactorEdad,
  getFactoresEdadParaCemento,
  // ── Consistencia (Tablas 4.1/4.2) — read-only ──
  getConsistencia,
  // ── Aire durabilidad (Tabla 4.3) — read-only ──
  getAireDurabilidad,
  // ── Pulverulento mínimo (Tabla 4.4) — read-only ──
  getPulverulentoMinimo,
  // ── Pastón de pruebas ──
  listarPastones,
  obtenerPaston,
  crearPaston,
  actualizarPaston,
  eliminarPaston,
  // ── Correcciones post-pastón ──
  listarCorrecciones,
  crearCorreccion,
  aplicarCorrecciones,
  // ── Aptitud de materiales ──
  verificarAptitudMateriales,
  verificarAptitudMaterialesByParams,
  // ── Vinculadas por material ──
  listarDosificacionesVinculadas,
};
