'use strict';

/* ── Tamices — importados del catálogo centralizado ── */
const {
  IRAM_STANDARD_GRID: TAMICES_TOTAL_IRAM,
  IRAM_1627_TOTAL_TMN,
} = require('../catalog/tamicesCatalog');

const getCurvaSets = async (db, { materialUso, estado, isActive } = {}) => {
  const where = {};
  if (materialUso) where.materialUso = materialUso;
  if (estado) where.estado = estado;
  if (isActive !== undefined) where.isActive = isActive;

  return db.CurvaSet.findAll({
    where,
    include: [{
      model: db.CurvaGranulometrica,
      as: 'curvas',
      where: { isActive: true },
      required: false,
      include: [{ model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] }],
    }],
    order: [['materialUso', 'ASC'], ['tmnMm', 'ASC'], ['nombre', 'ASC']],
  });
};

const getCurvaSet = async (db, id) => {
  return db.CurvaSet.findByPk(id, {
    include: [{
      model: db.CurvaGranulometrica,
      as: 'curvas',
      where: { isActive: true },
      required: false,
      include: [{ model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] }],
    }],
  });
};

const createCurvaSet = async (db, data) => {
  const t = await db.sequelize.transaction();
  try {
    const set = await db.CurvaSet.create({
      nombre: data.nombre,
      serieTamices: data.serieTamices || 'IRAM',
      materialUso: data.materialUso || null,
      tmnMm: data.tmnMm || null,
      normaRef: data.normaRef || null,
      descripcion: data.descripcion || null,
      estado: data.estado || 'PENDIENTE',
      isDefault: data.isDefault || false,
      isActive: data.isActive !== false,
    }, { transaction: t });

    // Opcionalmente crear curvas dentro del set
    if (data.curvas && data.curvas.length > 0) {
      for (const curvaData of data.curvas) {
        const curva = await db.CurvaGranulometrica.create({
          nombre: curvaData.nombre,
          tipo: curvaData.tipo || 'BANDA',
          specMode: curvaData.specMode || 'RANGO',
          serieTamices: curvaData.serieTamices || data.serieTamices || 'IRAM',
          uso: curvaData.uso || data.materialUso || null,
          tmnMm: curvaData.tmnMm || data.tmnMm || null,
          curveLetter: curvaData.curveLetter || null,
          normaRef: curvaData.normaRef || data.normaRef || null,
          origenDatos: curvaData.origenDatos || null,
          estadoDatos: curvaData.estadoDatos || 'PENDIENTE',
          parametros: curvaData.parametros || null,
          metadata: curvaData.metadata || null,
          isDefault: false,
          isActive: true,
          version: '1.0',
          idCurvaSet: set.idCurvaSet,
        }, { transaction: t });

        if (curvaData.puntos && curvaData.puntos.length > 0) {
          const puntos = curvaData.puntos.map((p, i) => ({
            idCurva: curva.idCurva,
            tamiz: p.tamiz,
            aberturaMm: p.aberturaMm ?? null,
            pasaPct: p.pasaPct ?? null,
            limInfPct: p.limInfPct ?? null,
            limSupPct: p.limSupPct ?? null,
            targetPct: p.targetPct ?? null,
            isNA: p.isNA === true,
            orden: p.orden ?? i,
          }));
          await db.CurvaPunto.bulkCreate(puntos, { transaction: t });
        }
      }
    }

    await t.commit();
    return getCurvaSet(db, set.idCurvaSet);
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

const updateCurvaSet = async (db, id, data) => {
  const set = await db.CurvaSet.findByPk(id);
  if (!set) throw new Error('Set no encontrado');

  await set.update({
    nombre: data.nombre ?? set.nombre,
    serieTamices: data.serieTamices ?? set.serieTamices,
    materialUso: data.materialUso ?? set.materialUso,
    tmnMm: data.tmnMm ?? set.tmnMm,
    normaRef: data.normaRef ?? set.normaRef,
    descripcion: data.descripcion ?? set.descripcion,
    estado: data.estado ?? set.estado,
    isDefault: data.isDefault ?? set.isDefault,
    isActive: data.isActive ?? set.isActive,
  });

  return getCurvaSet(db, id);
};

const deleteCurvaSet = async (db, id) => {
  const set = await db.CurvaSet.findByPk(id);
  if (!set) throw new Error('Set no encontrado');
  await set.update({ isActive: false });
  return { message: 'Set desactivado' };
};

/**
 * Crea un CurvaSet IRAM 1627 Total con curvas A/B/C (o una sola curva).
 * @param {Object} db - Sequelize models
 * @param {Object} params
 * @param {number} params.tmnMm - TMN en mm
 * @param {boolean} [params.createABC=false] - true → crea las 3 curvas (A, B, C)
 * @param {string} [params.curveLetter] - 'A'|'B'|'C' para crear una sola
 * @returns {{ curvaSetId, curvas }}
 */
const createIRAM1627Total = async (db, { tmnMm, createABC, curveLetter }) => {
  if (!tmnMm) throw new Error('tmnMm es requerido');

  const tmnInfo = IRAM_1627_TOTAL_TMN.find(t => t.tmn === Number(tmnMm));
  const tablaRef = tmnInfo ? tmnInfo.tabla : '';

  const letters = createABC ? ['A', 'B', 'C'] : (curveLetter ? [curveLetter] : ['A']);

  // Build puntos template (all targetPct = null)
  const puntosTemplate = TAMICES_TOTAL_IRAM.map((t, i) => ({
    tamiz: t.tamiz,
    aberturaMm: t.aberturaMm,
    pasaPct: null,
    limInfPct: null,
    limSupPct: null,
    targetPct: null,
    isNA: false,
    orden: i,
  }));

  // Build curva definitions
  const curvasData = letters.map(letter => ({
    nombre: `IRAM 1627:1997 — Total — TMN ${tmnMm} — Curva ${letter}`,
    tipo: 'BANDA',
    specMode: 'OBJETIVO',
    serieTamices: 'IRAM',
    uso: 'TOTAL',
    tmnMm: Number(tmnMm),
    curveLetter: letter,
    normaRef: 'IRAM 1627:1997',
    origenDatos: tablaRef,
    estadoDatos: 'PENDIENTE',
    puntos: puntosTemplate,
  }));

  // Create the set (reuse createCurvaSet)
  const setData = {
    nombre: `IRAM 1627:1997 — Total — TMN ${tmnMm}`,
    serieTamices: 'IRAM',
    materialUso: 'TOTAL',
    tmnMm: Number(tmnMm),
    normaRef: 'IRAM 1627:1997',
    descripcion: `Set de curvas IRAM 1627 para agregados totales, TMN ${tmnMm} mm. ${tablaRef}`,
    estado: 'PENDIENTE',
    isDefault: false,
    isActive: true,
    curvas: curvasData,
  };

  const set = await createCurvaSet(db, setData);

  // Format response
  const curvasRes = (set.curvas || []).map(c => ({
    id: c.idCurva,
    nombre: c.nombre,
    curveLetter: c.curveLetter,
    tmnMm: c.tmnMm,
  }));

  return {
    curvaSetId: set.idCurvaSet,
    curvas: curvasRes,
  };
};

module.exports = {
  getCurvaSets,
  getCurvaSet,
  createCurvaSet,
  updateCurvaSet,
  deleteCurvaSet,
  createIRAM1627Total,
  TAMICES_TOTAL_IRAM,
  IRAM_1627_TOTAL_TMN,
};
