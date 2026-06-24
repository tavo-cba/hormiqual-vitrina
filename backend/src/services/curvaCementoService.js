'use strict';

const { getCacheForDb } = require('./cacheHelpers');

const CURVAS_CEMENTO_TTL = 600; // 10 min

const invalidateCache = (db) => {
  const tc = getCacheForDb(db);
  tc.invalidate('curvasCemento');
};

/**
 * Obtiene curvas activas con sus relaciones.
 * Filtros opcionales: includeArchived, idPlanta (NULL→solo globales; valor→globales + de esa planta).
 */
const getCurvasCemento = async (db, { includeArchived = false, idPlanta = null } = {}) => {
  const tc = getCacheForDb(db);
  const cacheKey = `${includeArchived ? 'all' : 'active'}_${idPlanta == null ? 'todas' : `p${idPlanta}`}`;
  const cached = tc.get('curvasCemento', cacheKey);
  if (cached) return cached;

  const where = includeArchived ? {} : { activo: true };
  if (idPlanta != null) {
    // Curvas globales (idPlanta NULL) + de la planta indicada
    where[require('sequelize').Op.or] = [
      { idPlanta: null },
      { idPlanta: Number(idPlanta) },
    ];
  }
  const rows = await db.CurvaCemento.findAll({
    where,
    include: [
      { model: db.Cemento, as: 'cemento', attributes: ['idCemento', 'nombreComercial', 'fabricante', 'familiaCemento'], required: false },
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'], required: false },
      { model: db.CurvaCementoPunto, as: 'puntos', required: false, order: [['edadDias', 'ASC'], ['orden', 'ASC']] },
      { model: db.CurvaCementoAbrams, as: 'abrams', required: false, order: [['edadDias', 'ASC']] },
    ],
    order: [['id', 'DESC']],
  });

  const result = rows.map(r => r.get({ plain: true }));
  tc.set('curvasCemento', cacheKey, result, CURVAS_CEMENTO_TTL);
  return result;
};

/**
 * Obtiene una curva por ID con todos sus datos.
 */
const getCurvaCemento = async (db, id) => {
  const row = await db.CurvaCemento.findByPk(id, {
    include: [
      { model: db.Cemento, as: 'cemento', attributes: ['idCemento', 'nombreComercial', 'fabricante', 'familiaCemento'], required: false },
      { model: db.CurvaCementoPunto, as: 'puntos', required: false },
      { model: db.CurvaCementoAbrams, as: 'abrams', required: false },
    ],
  });
  if (!row) throw Object.assign(new Error('Curva de cemento no encontrada.'), { statusCode: 404 });
  return row.get({ plain: true });
};

/**
 * Busca la curva activa más apropiada para un cemento dado.
 *
 * Prioridad:
 *   1. Curva activa específica del cementoId
 *   2. Curva activa de la familiaCemento del cemento
 *   3. null (sin curva → fallback a CurvaACResistencia)
 *
 * @param {object} db
 * @param {object} cemento - Registro del cemento (idCemento, familiaCemento)
 * @returns {{ curva, origen }} donde origen es 'ESPECIFICA' | 'FAMILIA' | null
 */
/**
 * Resuelve la curva a/c-resistencia para una dosificación, usando la configuración
 * por planta (CementoPlanta) como única fuente de verdad.
 *
 * Si el cemento NO está habilitado en la planta → arroja error 422.
 *
 * Los 3 modos comparten un mismo path: leer una CurvaCemento. La diferencia es
 * sólo qué tipo de curva se busca:
 *   ICPA       → curva genérica del Ábaco 2 ICPA por familia (origenCurva='ICPA')
 *   FABRICANTE → curva publicada por el fabricante del cemento (origenCurva='FABRICANTE')
 *   PROPIA     → curva calibrada por el usuario, identificada por cp.idCurvaPropia
 *
 * @param {object} [opts]
 * @param {string} [opts.modoOverride] Override del modo del pivote (ej: el body de
 *   /calcular trae modoCurvaAC para forzar otra curva en runtime).
 * @returns {{ curva, origen, factorAjuste, modo, cementoPlanta }}
 */
const getCurvaCementoParaDosificacion = async (db, cemento, idPlanta, opts = {}) => {
  if (!cemento) return { curva: null, origen: null, factorAjuste: 1.0, modo: 'ICPA', cementoPlanta: null };
  if (!idPlanta) {
    throw Object.assign(new Error('Falta idPlanta para resolver la configuración del cemento.'), { statusCode: 400 });
  }

  const cp = await db.CementoPlanta.findOne({
    where: { idCemento: cemento.idCemento, idPlanta: Number(idPlanta), activo: true },
  });
  if (!cp) {
    throw Object.assign(
      new Error(`El cemento "${cemento.nombreComercial || cemento.idCemento}" no está habilitado en la planta indicada. Configurelo en el catálogo de cementos antes de calcular.`),
      { statusCode: 422, code: 'CEMENTO_NO_HABILITADO_EN_PLANTA' }
    );
  }

  const modo = (opts.modoOverride || cp.modoCurva || 'ICPA').toUpperCase();
  const factor = Number(cp.factorAjuste) || 1.0;
  const include = [
    { model: db.CurvaCementoPunto, as: 'puntos', required: false },
    { model: db.CurvaCementoAbrams, as: 'abrams', required: false },
  ];

  if (modo === 'PROPIA') {
    if (!cp.idCurvaPropia) {
      throw Object.assign(
        new Error(`El cemento está configurado en modo PROPIA en la planta pero no tiene curva propia asignada.`),
        { statusCode: 422, code: 'CURVA_PROPIA_FALTANTE' }
      );
    }
    const curva = await db.CurvaCemento.findOne({
      where: { id: cp.idCurvaPropia, activo: true },
      include,
    });
    if (!curva) {
      throw Object.assign(
        new Error(`La curva propia configurada (id=${cp.idCurvaPropia}) no existe o está archivada.`),
        { statusCode: 422, code: 'CURVA_PROPIA_NO_VALIDA' }
      );
    }
    if (curva.idPlanta != null && Number(curva.idPlanta) !== Number(idPlanta)) {
      throw Object.assign(
        new Error(`La curva propia configurada pertenece a otra planta.`),
        { statusCode: 422, code: 'CURVA_PROPIA_PLANTA_MISMATCH' }
      );
    }
    return { curva: curva.get({ plain: true }), origen: 'PROPIA', factorAjuste: factor, modo, cementoPlanta: cp.get({ plain: true }) };
  }

  if (modo === 'FABRICANTE') {
    // Curva específica del cemento (idPlanta=NULL, origen=FABRICANTE), con fallback a curva de familia
    if (cemento.idCemento) {
      const especifica = await db.CurvaCemento.findOne({
        where: { cementoId: cemento.idCemento, idPlanta: null, origenCurva: 'FABRICANTE', activo: true },
        include,
        order: [['id', 'DESC']],
      });
      if (especifica) return { curva: especifica.get({ plain: true }), origen: 'FABRICANTE_ESPECIFICA', factorAjuste: factor, modo, cementoPlanta: cp.get({ plain: true }) };
    }
    if (cemento.familiaCemento) {
      const familia = await db.CurvaCemento.findOne({
        where: { familiaCemento: cemento.familiaCemento, cementoId: null, idPlanta: null, origenCurva: 'FABRICANTE', activo: true },
        include,
        order: [['id', 'DESC']],
      });
      if (familia) return { curva: familia.get({ plain: true }), origen: 'FABRICANTE_FAMILIA', factorAjuste: factor, modo, cementoPlanta: cp.get({ plain: true }) };
    }
    // No hay curva del fabricante cargada → motor cae a fallback legacy con el factor configurado
    return { curva: null, origen: 'FABRICANTE_NO_DISPONIBLE', factorAjuste: factor, modo, cementoPlanta: cp.get({ plain: true }) };
  }

  // Modo ICPA: curva genérica del Ábaco 2 por familia (origen='ICPA', sin cemento, sin planta)
  if (cemento.familiaCemento) {
    const icpaCurva = await db.CurvaCemento.findOne({
      where: { familiaCemento: cemento.familiaCemento, cementoId: null, idPlanta: null, origenCurva: 'ICPA', activo: true },
      include,
      order: [['id', 'DESC']],
    });
    if (icpaCurva) return { curva: icpaCurva.get({ plain: true }), origen: 'ICPA', factorAjuste: factor, modo: 'ICPA', cementoPlanta: cp.get({ plain: true }) };
  }
  // Sin curva ICPA cargada en CurvaCemento → motor cae al fallback legacy (CurvaACResistencia)
  return { curva: null, origen: 'ICPA_LEGACY', factorAjuste: factor, modo: 'ICPA', cementoPlanta: cp.get({ plain: true }) };
};

/**
 * Crea una nueva curva de cemento con sus puntos y parámetros Abrams.
 */
const createCurvaCemento = async (db, data) => {
  const { puntos = [], abrams = [], ...headerData } = data;

  const curva = await db.CurvaCemento.create(headerData);

  if (puntos.length > 0) {
    await db.CurvaCementoPunto.bulkCreate(
      puntos.map((p, i) => ({ ...p, curvaCementoId: curva.id, orden: p.orden ?? i }))
    );
  }
  if (abrams.length > 0) {
    await db.CurvaCementoAbrams.bulkCreate(
      abrams.map(a => ({ ...a, curvaCementoId: curva.id }))
    );
  }

  invalidateCache(db);
  return getCurvaCemento(db, curva.id);
};

/**
 * Actualiza el header de la curva.
 * Para puntos/abrams: reemplaza completamente si se proveen arrays.
 */
const updateCurvaCemento = async (db, id, data) => {
  const curva = await db.CurvaCemento.findByPk(id);
  if (!curva) throw Object.assign(new Error('Curva de cemento no encontrada.'), { statusCode: 404 });

  const { puntos, abrams, ...headerData } = data;
  await curva.update(headerData);

  if (Array.isArray(puntos)) {
    await db.CurvaCementoPunto.destroy({ where: { curvaCementoId: id } });
    if (puntos.length > 0) {
      await db.CurvaCementoPunto.bulkCreate(
        puntos.map((p, i) => ({ ...p, curvaCementoId: id, orden: p.orden ?? i }))
      );
    }
  }
  if (Array.isArray(abrams)) {
    await db.CurvaCementoAbrams.destroy({ where: { curvaCementoId: id } });
    if (abrams.length > 0) {
      await db.CurvaCementoAbrams.bulkCreate(
        abrams.map(a => ({ ...a, curvaCementoId: id }))
      );
    }
  }

  invalidateCache(db);
  return getCurvaCemento(db, id);
};

/**
 * Archiva (soft-delete) una curva.
 */
const deleteCurvaCemento = async (db, id) => {
  const curva = await db.CurvaCemento.findByPk(id);
  if (!curva) throw Object.assign(new Error('Curva de cemento no encontrada.'), { statusCode: 404 });
  await curva.update({ activo: false });
  invalidateCache(db);
  return { message: 'Curva archivada.' };
};

module.exports = {
  getCurvasCemento,
  getCurvaCemento,
  getCurvaCementoParaDosificacion,
  createCurvaCemento,
  updateCurvaCemento,
  deleteCurvaCemento,
};
