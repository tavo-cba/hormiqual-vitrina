const { Op } = require('sequelize');
const { combineLocal } = require('../utils/date');
const { invalidateProbetasCache } = require('./muestraService');

const includeAll = (db) => [
  { model: db.Probeta, as: 'probetas' },
  { model: db.TipoProbeta, as: 'tipoProbeta' },
  { model: db.Empleado, as: 'operador' },
  { model: db.Cliente, as: 'cliente' },
  { model: db.Obra, as: 'obra' },
  { model: db.Planta, as: 'planta' },
  { model: db.TipoHormigon, as: 'tipoHormigon' },
  ...(db.ModalidadMuestra ? [{ model: db.ModalidadMuestra, as: 'modalidad', required: false }] : []),
  ...(db.Dosificacion ? [{ model: db.Dosificacion, as: 'dosificacion', required: false, attributes: ['idDosificacion', 'nombre', 'codigoEnPlanta'] }] : []),
];

// Acepta sólo una de las dos opciones de dosificación. Si llegan ambas, prioriza
// el FK (idDosificacion) y descarta el texto libre. Esto coincide con el patrón
// de la UI: el dropdown deshabilita el texto libre cuando hay opción elegida.
function _normalizarDosificacion(payload) {
  const out = { ...payload };
  if (out.idDosificacion) {
    out.dosificacionTextoLibre = null;
  } else if (out.dosificacionTextoLibre && String(out.dosificacionTextoLibre).trim() === '') {
    out.dosificacionTextoLibre = null;
  }
  return out;
}

/* ─────────── Lectura ─────────── */
exports.getMuestrasTerceros = (db) =>
  db.MuestraTerceros.findAll({
    include: includeAll(db),
    order: [['fecha', 'DESC']],
  });

exports.getMuestraTerceros = (db, id) =>
  db.MuestraTerceros.findByPk(id, { include: includeAll(db) });

/* ─────────── Escritura ─────────── */
exports.createMuestraTerceros = async (db, payload) => {
  const t = await db.sequelize.transaction();
  try {
    const { probetas, ...base } = _normalizarDosificacion(payload);
    const muestra = await db.MuestraTerceros.create(base, { transaction: t });
    if (probetas && probetas.length) {
      const MS_DIA = 86400000;
      const baseDate = combineLocal(muestra.fecha, '13:00');
      baseDate.setHours(12, 0, 0, 0);
      const ahora = new Date();
      const regs = probetas.map((p) => {
        const fechaRotura = new Date(baseDate.getTime() + p.diasRotura * MS_DIA);
        fechaRotura.setHours(12, 0, 0, 0);
        let estado = p.idEstadoProbeta;
        if (estado === 2 && fechaRotura > ahora) estado = 1;
        else if (estado === 1 && fechaRotura < ahora) estado = 2;
        return {
          idMuestraTerceros: muestra.idMuestraTerceros,
          idEstadoProbeta: estado,
          nombre: p.nombre,
          codigo: p.codigo,
          observaciones: p.observaciones,
          diasRotura: p.diasRotura,
          fechaRotura,
          idPileta: p.idPileta || null,
        };
      });
      await db.Probeta.bulkCreate(regs, { transaction: t });
    }

    await t.commit();
    invalidateProbetasCache(db);
    return muestra;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

exports.updateMuestraTerceros = async (db, id, payload) => {
  const t = await db.sequelize.transaction();
  try {
    const { probetas, ...base } = _normalizarDosificacion(payload);
    const muestra = await db.MuestraTerceros.findByPk(id, { transaction: t });
    if (!muestra) throw new Error('Muestra no encontrada');
    await muestra.update(base, { transaction: t });

    const existing = await db.Probeta.findAll({ where: { idMuestraTerceros: id }, transaction: t });
    const existingMap = new Map(existing.map((p) => [p.idProbeta, p]));
    const keepIds = new Set();

    if (Array.isArray(probetas)) {
      const MS_DIA = 86400000;
      const baseDate = combineLocal(muestra.fecha, '13:00');
      baseDate.setHours(12, 0, 0, 0);
      const ahora = new Date();
      const nuevos = [];
      for (const p of probetas) {
        const fechaRotura = new Date(baseDate.getTime() + p.diasRotura * MS_DIA);
        fechaRotura.setHours(12, 0, 0, 0);
        let estado = p.idEstadoProbeta;
        if (estado === 2 && fechaRotura > ahora) estado = 1;
        else if (estado === 1 && fechaRotura < ahora) estado = 2;

        const fields = {
          idEstadoProbeta: estado,
          nombre: p.nombre,
          codigo: p.codigo,
          observaciones: p.observaciones,
          diasRotura: p.diasRotura,
          fechaRotura,
        };

        if (p.idProbeta && existingMap.has(p.idProbeta)) {
          keepIds.add(p.idProbeta);
          await existingMap.get(p.idProbeta).update(fields, { transaction: t });
        } else {
          nuevos.push({ ...fields, idMuestraTerceros: muestra.idMuestraTerceros });
        }
      }

      if (nuevos.length) {
        await db.Probeta.bulkCreate(nuevos, { transaction: t });
      }
    }

    if (Array.isArray(probetas)) {
      const toDelete = existing
        .filter((p) => !keepIds.has(p.idProbeta))
        .map((p) => p.idProbeta);
      if (toDelete.length) {
        await db.Probeta.destroy({ where: { idProbeta: toDelete }, transaction: t });
      }
    }

    await t.commit();
    invalidateProbetasCache(db);
    return muestra;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

exports.confirmarMuestraTerceros = async (db, id, loteNumero, idPileta) => {
  const t = await db.sequelize.transaction();
  try {
    const muestra = await db.MuestraTerceros.findByPk(id, {
      include: [{ model: db.Probeta, as: 'probetas' }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!muestra) throw new Error('Muestra no encontrada');

    const fecha = muestra.fecha;
    const idPlanta = muestra.idPlanta;

    const existente = await db.MuestraTerceros.findOne({
      where: {
        [Op.and]: [
          { idMuestraTerceros: { [Op.ne]: id } },
          { estado: 1 },
          { fecha },
          { idPlanta },
        ],
      },
      include: [{
        model: db.Probeta,
        as: 'probetas',
        where: { nombre: { [Op.like]: `L${loteNumero}P%` } },
      }],
      transaction: t,
    });

    if (existente) {
      throw new Error('Ya existe una muestra con ese número de lote en la misma fecha y planta');
    }

    for (let i = 0; i < muestra.probetas.length; i++) {
      const p = muestra.probetas[i];
      const updateData = { nombre: `M${loteNumero}P${i + 1}` };
      if (idPileta) updateData.idPileta = idPileta;
      await p.update(updateData, { transaction: t });
    }

    await muestra.update({ estado: true }, { transaction: t });

    const completa = await db.MuestraTerceros.findByPk(id, {
      include: includeAll(db),
      transaction: t,
    });

    await t.commit();
    invalidateProbetasCache(db);
    return completa;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Payload consolidado para emitir el PDF de ficha de una muestra de terceros.
 * Devuelve la misma estructura que `muestraService.getFichaMuestra` para poder
 * reutilizar el helper `generarFichaMuestraPdf` del frontend. Los campos que
 * no aplican a terceros (despacho, dosificación, modalidad) quedan en null.
 *
 * @param {object} db
 * @param {number} idMuestraTerceros
 * @param {Array<number>|null} plantaIdsUsuario  null = admin, ve todo.
 * @returns {object|null}
 */
exports.getFichaMuestraTerceros = async (db, idMuestraTerceros, plantaIdsUsuario = null) => {
  const { evaluarMuestraFresco } = require('../domain/ensayoFrescoEvalEngine');

  const muestra = await db.MuestraTerceros.findByPk(idMuestraTerceros, {
    include: [
      { model: db.Cliente, as: 'cliente', attributes: ['idCliente', 'nombre', 'razonSocial', 'tipoPersona'] },
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
      { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'], required: false },
      { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'] },
      { model: db.TipoProbeta, as: 'tipoProbeta', attributes: ['idTipoProbeta', 'tipo'] },
      { model: db.Empleado, as: 'operador', attributes: ['idEmpleado', 'nombre', 'apellido'], required: false },
      ...(db.ModalidadMuestra ? [{ model: db.ModalidadMuestra, as: 'modalidad', required: false }] : []),
      ...(db.Dosificacion ? [{ model: db.Dosificacion, as: 'dosificacion', required: false, attributes: ['idDosificacion', 'nombre', 'codigoEnPlanta'] }] : []),
      {
        model: db.Probeta, as: 'probetas',
        include: [
          { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['idEstadoProbeta', 'estado'] },
          {
            model: db.EnsayoResistencia, as: 'ensayo', required: false,
            include: [
              { model: db.Empleado, as: 'operarioEnsayo', attributes: ['nombre', 'apellido'], required: false },
              { model: db.Prensa, as: 'prensa', attributes: ['nombre'], required: false },
            ],
          },
          { model: db.Archivo, as: 'archivos', required: false },
        ],
      },
    ],
  });

  if (!muestra) return null;

  if (Array.isArray(plantaIdsUsuario)) {
    const idPlanta = muestra.idPlanta ?? null;
    if (idPlanta == null || !plantaIdsUsuario.map(Number).includes(Number(idPlanta))) {
      return null;
    }
  }

  const plain = muestra.get({ plain: true });

  const asentMm = plain.asentamiento != null ? Number(plain.asentamiento) * 10 : null;
  const fresco = evaluarMuestraFresco({
    temperaturaHormigon: plain.temperaturaHormigon != null ? Number(plain.temperaturaHormigon) : null,
    asentamientoMm: asentMm,
    aireincorporado: plain.aireincorporado != null ? Number(plain.aireincorporado) : null,
  }, {
    dosificacion: { asentamientoObjetivoMm: null, tmnMm: null },
    claseExposicion: null,
  });

  if (Array.isArray(plain.probetas)) {
    plain.probetas.sort((a, b) => (a.diasRotura ?? 0) - (b.diasRotura ?? 0));
  }

  // Mapeo a shape compatible con el helper `generarFichaMuestraPdf` (muestras
  // propias). `modalidad` y `dosificacion` vienen ya populadas en `...plain`
  // desde el include — NO sobrescribir con null. Solo `despacho` queda en null
  // porque las muestras de terceros no tienen el modelo Despacho asociado.
  const muestraPayload = {
    ...plain,
    idMuestra: plain.idMuestraTerceros, // alias usado por el helper de PDF
    despacho: null,
    asentamientoMm: asentMm,
    _origen: 'terceros',
  };

  return {
    muestra: muestraPayload,
    fresco,
    fresco_inputs: {
      asentamientoMmMedido: asentMm,
      temperaturaHormigon: plain.temperaturaHormigon,
      temperaturaAmbiente: plain.temperaturaAmbiente,
      aireincorporado: plain.aireincorporado,
    },
  };
};

/**
 * Variante de getFichaMuestraTerceros con verificación de ownership por
 * razonSocial + cuit del cliente. Usada por el endpoint interno del Portal.
 */
exports.getFichaMuestraTercerosWeb = async (db, idMuestraTerceros, { razonSocial, cuit }) => {
  if (!razonSocial || !cuit) return 'forbidden';
  const cliente = await db.Cliente.findOne({ where: { razonSocial, cuil_cuit: cuit } });
  if (!cliente) return 'forbidden';

  const muestra = await db.MuestraTerceros.findByPk(idMuestraTerceros, { attributes: ['idMuestraTerceros', 'idCliente'] });
  if (!muestra) return null;
  if (muestra.idCliente !== cliente.idCliente) return 'forbidden';

  return exports.getFichaMuestraTerceros(db, idMuestraTerceros, null);
};

exports.deleteMuestraTerceros = async (db, id) => {
  const t = await db.sequelize.transaction();
  try {
    await db.Probeta.destroy({ where: { idMuestraTerceros: id }, transaction: t });
    await db.MuestraTerceros.destroy({ where: { idMuestraTerceros: id }, transaction: t });
    await t.commit();
    invalidateProbetasCache(db);
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

