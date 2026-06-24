'use strict';

/**
 * Configuración de un cemento en una planta: modo de curva, factor de ajuste,
 * curva propia opcional. Es la fuente de verdad para el motor de dosificación.
 */

const listarPorCemento = async (db, idCemento) => {
  const rows = await db.CementoPlanta.findAll({
    where: { idCemento: Number(idCemento) },
    include: [
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
      { model: db.CurvaCemento, as: 'curvaPropia', attributes: ['id', 'nombre', 'tipoCurva', 'origenCurva'], required: false },
    ],
    order: [['idPlanta', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

const listarPorPlanta = async (db, idPlanta, { includeInactivos = false } = {}) => {
  const where = { idPlanta: Number(idPlanta) };
  if (!includeInactivos) where.activo = true;
  const rows = await db.CementoPlanta.findAll({
    where,
    include: [
      { model: db.Cemento, as: 'cemento' },
      { model: db.CurvaCemento, as: 'curvaPropia', attributes: ['id', 'nombre', 'tipoCurva', 'origenCurva'], required: false },
    ],
    order: [['idCemento', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
};

const upsert = async (db, idCemento, idPlanta, data = {}) => {
  if (!idCemento || !idPlanta) {
    throw Object.assign(new Error('Faltan idCemento o idPlanta.'), { statusCode: 400 });
  }
  const [row, created] = await db.CementoPlanta.findOrCreate({
    where: { idCemento: Number(idCemento), idPlanta: Number(idPlanta) },
    defaults: {
      modoCurva: data.modoCurva || 'ICPA',
      factorAjuste: data.factorAjuste != null ? Number(data.factorAjuste) : 1.000,
      idCurvaPropia: data.idCurvaPropia || null,
      observaciones: data.observaciones || null,
      activo: data.activo !== false,
    },
  });
  if (!created) {
    await row.update({
      modoCurva: data.modoCurva || row.modoCurva,
      factorAjuste: data.factorAjuste != null ? Number(data.factorAjuste) : row.factorAjuste,
      idCurvaPropia: data.idCurvaPropia !== undefined ? data.idCurvaPropia : row.idCurvaPropia,
      observaciones: data.observaciones !== undefined ? data.observaciones : row.observaciones,
      activo: data.activo !== false,
    });
  }
  return row.get({ plain: true });
};

const actualizarPorId = async (db, idCementoPlanta, data = {}) => {
  const row = await db.CementoPlanta.findByPk(idCementoPlanta);
  if (!row) throw Object.assign(new Error('CementoPlanta no encontrado.'), { statusCode: 404 });
  await row.update({
    modoCurva: data.modoCurva || row.modoCurva,
    factorAjuste: data.factorAjuste != null ? Number(data.factorAjuste) : row.factorAjuste,
    idCurvaPropia: data.idCurvaPropia !== undefined ? data.idCurvaPropia : row.idCurvaPropia,
    observaciones: data.observaciones !== undefined ? data.observaciones : row.observaciones,
    activo: data.activo !== false,
  });
  return row.get({ plain: true });
};

const desasignar = async (db, idCemento, idPlanta) => {
  const row = await db.CementoPlanta.findOne({
    where: { idCemento: Number(idCemento), idPlanta: Number(idPlanta) },
  });
  if (!row) return { action: 'noop' };
  await row.update({ activo: false });
  return { action: 'deactivated', idCementoPlanta: row.idCementoPlanta };
};

module.exports = {
  listarPorCemento,
  listarPorPlanta,
  upsert,
  actualizarPorId,
  desasignar,
};
