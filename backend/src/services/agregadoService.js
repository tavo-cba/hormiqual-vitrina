// agregadoService.js
/* eslint-disable camelcase */
const { getCacheForDb } = require('./cacheHelpers');

/** TTL para catálogos de agregados: 1 hora (invalidado por hooks) */
const CATALOGO_TTL = 3600;

/**
 * PR4 — Sincroniza la asignación de un agregado a 1+ plantas vía MaterialPlanta.
 * Mantiene `Agregado.idPlanta` como caché de la primera planta activa, para
 * que los includes legacy (`as: 'planta'`) sigan funcionando.
 *
 * @param {object} db
 * @param {number} idAgregado
 * @param {Array<{idPlanta:number, activo?:boolean, observaciones?:string}>} plantasConfig
 * @param {object} [opts]
 * @param {object} [opts.transaction]
 */
const _syncPlantasAgregado = async (db, idAgregado, plantasConfig, opts = {}) => {
    if (!Array.isArray(plantasConfig)) return;
    const matSvc = require('./materialPlantaService');
    await matSvc.sincronizarPlantas(db, 'agregado', idAgregado, plantasConfig);
    // Caché legacy: Agregado.idPlanta = primera planta activa (o null).
    const primeraActiva = plantasConfig.find((p) => p && p.idPlanta && p.activo !== false);
    const idPlantaCache = primeraActiva ? Number(primeraActiva.idPlanta) : null;
    const ag = await db.Agregado.findByPk(idAgregado, opts.transaction ? { transaction: opts.transaction } : undefined);
    if (ag && ag.idPlanta !== idPlantaCache) {
        await ag.update({ idPlanta: idPlantaCache }, opts.transaction ? { transaction: opts.transaction } : undefined);
    }
};

/**
 * Devuelve las plantas asignadas a un agregado (incluye inactivas).
 * Shape: [{ idMaterialPlanta, idPlanta, activo, observaciones, planta:{idPlanta,nombre} }]
 */
const _listarPlantasDeAgregado = async (db, idAgregado) => {
    if (!db.MaterialPlanta) return [];
    const matSvc = require('./materialPlantaService');
    return matSvc.listarPlantasDeMaterial(db, 'agregado', idAgregado);
};

const getAgregados = async (db, { includeArchived = false } = {}) => {
    const tc = getCacheForDb(db);
    if (!includeArchived) {
      const cached = tc.get('catalogos', 'agregados');
      if (cached) return cached;
    }

    try {
      const where = includeArchived ? {} : { activo: true };
      const rows = await db.Agregado.findAll({
        where,
        include: [
          {
            model: db.UnidadMedida,
            as: "unidadMedida",
            attributes: ["idUnidadMedida", "unidad", "descripcion"],
          },
          {
            model: db.Planta,
            as: "planta",
            attributes: ["idPlanta", "nombre"],
            required: false,
          },
          {
            model: db.AgregadoFino,
            attributes: ["pasaTamiz200"],
            required: false,
            as: 'agregadoFino'
          },
          {
            model: db.AgregadoGrueso,
            attributes: ["idTamanioMaximoNominal"],
            required: false,
            as: 'agregadoGrueso'
          },
          ...(db.AgregadoMeta ? [{
            model: db.AgregadoMeta,
            attributes: ["productor", "cantera", "subtipoMaterial"],
            required: false,
            as: 'agregadoMeta'
          }] : []),
        ],
        order: [["nombre", "ASC"]],
      });

      const result = rows.map((row) => {
        const plain = row.get({ plain: true });
        const { agregadoFino, agregadoGrueso, agregadoMeta, unidadMedida, planta, ...base } = plain;

        const metaFields = agregadoMeta
          ? { productor: agregadoMeta.productor || null, cantera: agregadoMeta.cantera || null, subtipoMaterial: agregadoMeta.subtipoMaterial || null }
          : {};

        if (agregadoFino) {
          return {
            ...base,
            ...agregadoFino,
            ...metaFields,
            unidadMedida,
            planta,
            tipoAgregado: "Fino",
            id: base.idAgregado,
          };
        }
        if (agregadoGrueso) {
          return {
            ...base,
            ...agregadoGrueso,
            ...metaFields,
            unidadMedida,
            planta,
            tipoAgregado: "Grueso",
            id: base.idAgregado,
          };
        }
        return { ...base, ...metaFields, unidadMedida, planta, tipoAgregado: "Desconocido", id: base.idAgregado };
      });
      if (!includeArchived) tc.set('catalogos', 'agregados', result, CATALOGO_TTL);
      return result;
    } catch (err) {
      console.error("Error en getAgregados:", err);
      throw err;
    }
  };
  
  const getAgregado = async (db, tipoAgregado, idAgregado) => {
    try {
      const row = await db.Agregado.findByPk(idAgregado, {
        where: { activo: true },
        include: [
          { model: db.UnidadMedida, as: "unidadMedida", attributes: ["idUnidadMedida", "unidad", "descripcion"] },
          { model: db.Planta, as: "planta", attributes: ["idPlanta", "nombre"], required: false },
          { model: db.AgregadoFino, as: 'agregadoFino', attributes: ["pasaTamiz200"], required: false },
          { model: db.AgregadoGrueso, as: 'agregadoGrueso', attributes: ["idTamanioMaximoNominal"], required: false },
          { model: db.AgregadoMeta, as: 'agregadoMeta', required: false },
        ],
      });
      if (!row) return null;
  
      const plain = row.get({ plain: true });
      const { agregadoFino, agregadoGrueso, unidadMedida, planta, agregadoMeta, ...base } = plain;

      const metaFields = agregadoMeta ? {
        productor: agregadoMeta.productor || '',
        cantera: agregadoMeta.cantera || '',
        subtipoMaterial: agregadoMeta.subtipoMaterial || '',
        nroExpediente: agregadoMeta.nroExpediente || '',
        alertaClasificacion: agregadoMeta.alertaClasificacion || null,
      } : {};

      // PR4 — multi-planta: además de `planta` legacy, exponer `plantas` (1+).
      const plantas = await _listarPlantasDeAgregado(db, idAgregado);

      if (tipoAgregado === "Fino" && agregadoFino) {
        return {
          ...base,
          ...agregadoFino,
          ...metaFields,
          unidadMedida,
          planta,
          plantas,
          tipoAgregado: "Fino",
          id: idAgregado,
        };
      }
      if (tipoAgregado === "Grueso" && agregadoGrueso) {
        return {
          ...base,
          ...agregadoGrueso,
          ...metaFields,
          unidadMedida,
          planta,
          plantas,
          tipoAgregado: "Grueso",
          id: idAgregado,
        };
      }
      return null;
    } catch (err) {
      console.error("Error en getAgregado:", err);
      throw err;
    }
  };
  
  const createAgregado = async (db, data) => {
    const transaction = await db.sequelize.transaction();
    try {
      const { tipoAgregado } = data;
      if (!tipoAgregado) throw new Error("Falta tipoAgregado en payload");

      // Unidad de medida es opcional ahora
      if (data.idUnidadMedida) {
        const unidad = await db.UnidadMedida.findByPk(data.idUnidadMedida);
        if (!unidad) throw new Error("Unidad de medida inválida");
      }
  
      // PR4 — Multi-planta: aceptar `plantasConfig` (array). Back-compat: si
      // sólo viene `idPlanta` legacy, lo envolvemos en un array de uno.
      const plantasConfigInput = Array.isArray(data.plantasConfig) && data.plantasConfig.length > 0
        ? data.plantasConfig
        : (data.idPlanta ? [{ idPlanta: Number(data.idPlanta), activo: true }] : []);
      const idPlantaCacheLegacy = plantasConfigInput.find((p) => p?.activo !== false)?.idPlanta || null;

      // 1) Insertamos la fila base (densidad/absorcion/mf/pesoAparente opcionales)
      const base = await db.Agregado.create(
        {
          nombre: data.nombre,
          origen: data.origen,
          densidad: data.densidad || null,
          pesoAparente: data.pesoAparente || null,
          absorcion: data.absorcion || null,
          moduloFinura: data.moduloFinura || null,
          idUnidadMedida: data.idUnidadMedida || null,
          idPlanta: idPlantaCacheLegacy,  // caché de la primera planta activa
        },
        { transaction }
      );

      // 2) Hija
      if (tipoAgregado === "Fino") {
        await db.AgregadoFino.create(
          {
            idAgregado: base.idAgregado,
            pasaTamiz200: data.pasaTamiz200 || null,
          },
          { transaction }
        );
      } else if (tipoAgregado === "Grueso") {
        await db.AgregadoGrueso.create(
          {
            idAgregado: base.idAgregado,
            idTamanioMaximoNominal: data.idTamanioMaximoNominal || null,
          },
          { transaction }
        );
      } else {
        throw new Error(`Tipo de agregado no soportado: ${tipoAgregado}`);
      }

      await transaction.commit();

      // 3) Sincronizar pivote multi-planta (fuera de la transacción para que
      // sincronizarPlantas pueda manejar la suya propia).
      if (plantasConfigInput.length > 0 && db.MaterialPlanta) {
        try {
          await _syncPlantasAgregado(db, base.idAgregado, plantasConfigInput);
        } catch (e) {
          console.warn('[createAgregado] sync plantas falló (non-blocking):', e.message);
        }
      }

      const plain = base.get({ plain: true });
      return {
        ...plain,
        id: plain.idAgregado,
        tipoAgregado,
        idUnidadMedida: data.idUnidadMedida || null,
      };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  };
  
  const updateAgregado = async (db, idAgregado, data) => {
    const transaction = await db.sequelize.transaction();
    try {
      const { tipoAgregado } = data;
      if (!tipoAgregado) throw new Error("Falta tipoAgregado");
  
      if (data.idUnidadMedida) {
        const unidadExists = await db.UnidadMedida.findByPk(data.idUnidadMedida);
        if (!unidadExists) throw new Error("Unidad de medida inválida");
      }
  
      // 1) Base — only update provided fields
      const base = await db.Agregado.findByPk(idAgregado, { transaction });
      if (!base) throw new Error("Agregado base no encontrado");

      const updateFields = {};
      if (data.nombre !== undefined) updateFields.nombre = data.nombre;
      if (data.origen !== undefined) updateFields.origen = data.origen;
      if (data.densidad !== undefined) updateFields.densidad = data.densidad;
      if (data.pesoAparente !== undefined) updateFields.pesoAparente = data.pesoAparente;
      if (data.absorcion !== undefined) updateFields.absorcion = data.absorcion;
      if (data.moduloFinura !== undefined) updateFields.moduloFinura = data.moduloFinura;
      if (data.idUnidadMedida !== undefined) updateFields.idUnidadMedida = data.idUnidadMedida;
      // PR4 — `idPlanta` legacy ya NO se setea desde el body acá. Es caché y se
      // recalcula desde plantasConfig por _syncPlantasAgregado más abajo. Si el
      // caller sigue mandando `idPlanta` (back-compat) lo tratamos como
      // plantasConfig de un solo elemento.

      if (Object.keys(updateFields).length > 0) {
        await base.update(updateFields, { transaction });
      }

      // 2) Hija
      if (tipoAgregado === "Fino") {
        const fino = await db.AgregadoFino.findByPk(idAgregado, { transaction });
        if (!fino) throw new Error("AgregadoFino no encontrado");
        await fino.update({ pasaTamiz200: data.pasaTamiz200 }, { transaction });
      } else if (tipoAgregado === "Grueso") {
        const grueso = await db.AgregadoGrueso.findByPk(idAgregado, { transaction });
        if (!grueso) throw new Error("AgregadoGrueso no encontrado");
        await grueso.update(
          { idTamanioMaximoNominal: data.idTamanioMaximoNominal },
          { transaction }
        );
      }

      await transaction.commit();

      // 3) Sincronizar pivote multi-planta (fuera de la transacción).
      const plantasConfigInput = Array.isArray(data.plantasConfig)
        ? data.plantasConfig
        : (data.idPlanta !== undefined
            ? (data.idPlanta ? [{ idPlanta: Number(data.idPlanta), activo: true }] : [])
            : null);
      if (plantasConfigInput !== null && db.MaterialPlanta) {
        try {
          await _syncPlantasAgregado(db, idAgregado, plantasConfigInput);
        } catch (e) {
          console.warn('[updateAgregado] sync plantas falló (non-blocking):', e.message);
        }
      }

      // Recalculate IDA sugerido if relevant properties changed
      const idaRelevantFields = ['absorcion', 'moduloFinura', 'pasaTamiz200'];
      const changedIdaField = idaRelevantFields.some(f => data[f] !== undefined);
      if (changedIdaField) {
        try { await recalcularIdaSugerido(db, idAgregado); } catch (_) { /* non-blocking */ }
      }

      return { success: true, message: "Agregado actualizado" };
    } catch (err) {
      await transaction.rollback();
      console.error("Error en updateAgregado:", err);
      throw err;
    }
  };
  
  const deleteAgregado = async (db, tipoAgregado, idAgregado) => {
    try {
      const base = await db.Agregado.findByPk(idAgregado);
      if (!base) throw new Error("Agregado base no encontrado");

      // Check references
      const refs = await Promise.all([
        db.DosificacionAgregados ? db.DosificacionAgregados.count({ where: { idAgregado } }) : 0,
        db.MezclaAgregadosItem   ? db.MezclaAgregadosItem.count({ where: { idAgregado } })   : 0,
        db.DespachoAgregadosExtra? db.DespachoAgregadosExtra.count({ where: { idAgregado } }) : 0,
      ]);
      const totalRefs = refs.reduce((a, b) => a + b, 0);

      const tc = getCacheForDb(db);
      if (totalRefs === 0) {
        // No references → hard delete children then base
        if (db.AgregadoFino)   await db.AgregadoFino.destroy({ where: { idAgregado } });
        if (db.AgregadoGrueso) await db.AgregadoGrueso.destroy({ where: { idAgregado } });
        await base.destroy();
        tc.del('catalogos', 'agregados');
        return { success: true, action: 'deleted', message: 'Material eliminado' };
      }

      // Has references → archive
      await base.update({ activo: false });
      tc.del('catalogos', 'agregados');
      return { success: true, action: 'archived', message: 'Material archivado porque tiene referencias históricas' };
    } catch (err) {
      console.error("Error en deleteAgregado:", err);
      throw err;
    }
  };
  
  // ────────────────────────────
  // Tamaños máximos nominales
  // ────────────────────────────
  const getTamaniosMaximos = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'tamaniosMaximos');
    if (cached) return cached;

    try {
      const result = await db.TamanioMaximoNominal.findAll({
        order: [["tamanio", "ASC"]],
      });
      const plain = result.map(r => r.get({ plain: true }));
      tc.set('catalogos', 'tamaniosMaximos', plain, CATALOGO_TTL);
      return plain;
    } catch (err) {
      console.error("Error en getTamaniosMaximos:", err);
      throw err;
    }
  };
  
  const restoreAgregado = async (db, idAgregado) => {
    const base = await db.Agregado.findByPk(idAgregado);
    if (!base) throw new Error('Agregado no encontrado');
    await base.update({ activo: true });
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'agregados');
    return { action: 'restored', message: 'Material restaurado' };
  };

  // ────────────────────────────
  // IDA (Índice de Demanda de Agua)
  // ────────────────────────────
  const { calcularIdaSugeridoFino, calcularIdaSugeridoGrueso } = require('../domain/dosificacion/idaCalc');

  /**
   * Recalcula el IDA sugerido para un agregado basándose en sus propiedades/ensayos.
   * Si idaModo es 'auto', actualiza también el ida efectivo.
   * @returns {{ ida, idaSugerido, idaModo }}
   */
  const recalcularIdaSugerido = async (db, idAgregado) => {
    const base = await db.Agregado.findByPk(idAgregado, {
      include: [
        { model: db.AgregadoFino, as: 'agregadoFino', required: false },
        { model: db.AgregadoGrueso, as: 'agregadoGrueso', required: false },
      ],
    });
    if (!base) throw Object.assign(new Error('Agregado no encontrado'), { statusCode: 404 });

    const plain = base.get({ plain: true });
    let idaSugerido = 1.000;

    // Fetch subtipo from AgregadoMeta if available
    let subtipo = null;
    if (db.AgregadoMeta) {
      const meta = await db.AgregadoMeta.findOne({ where: { legacyAgregadoId: idAgregado } });
      if (meta) subtipo = meta.subtipoMaterial;
    }

    if (plain.agregadoFino) {
      idaSugerido = calcularIdaSugeridoFino({
        pasaTamiz200: plain.agregadoFino.pasaTamiz200,
        absorcion: plain.absorcion,
        moduloFinura: plain.moduloFinura,
        subtipo,
      });
    } else if (plain.agregadoGrueso) {
      idaSugerido = calcularIdaSugeridoGrueso({
        absorcion: plain.absorcion,
        indiceLajas: null, // TODO: add indiceLajas when available in model
      });
    }

    const updates = { idaSugerido };
    // If auto mode, also update the effective IDA
    if (plain.idaModo === 'auto') {
      updates.ida = idaSugerido;
    }

    await base.update(updates);

    // Invalidate cache
    const tc = getCacheForDb(db);
    tc.del('catalogos', 'agregados');

    return {
      ida: updates.ida ?? plain.ida,
      idaSugerido,
      idaModo: plain.idaModo,
    };
  };

  /**
   * Update IDA settings for an aggregate (manual override or switch back to auto).
   * @param {object} data - { ida?, idaModo?, idaNotas? }
   */
  const updateIda = async (db, idAgregado, data) => {
    const base = await db.Agregado.findByPk(idAgregado);
    if (!base) throw Object.assign(new Error('Agregado no encontrado'), { statusCode: 404 });

    const updates = {};

    if (data.idaModo !== undefined) {
      updates.idaModo = data.idaModo;
    }

    if (data.idaNotas !== undefined) {
      updates.idaNotas = data.idaNotas;
    }

    const modo = data.idaModo || base.idaModo;
    if (modo === 'manual' && data.ida != null) {
      updates.ida = Number(data.ida);
    } else if (modo === 'auto') {
      // Switching to auto: use the current suggested value
      updates.ida = base.idaSugerido != null ? Number(base.idaSugerido) : 1.000;
    }

    await base.update(updates);

    const tc = getCacheForDb(db);
    tc.del('catalogos', 'agregados');

    return {
      ida: updates.ida ?? Number(base.ida),
      idaModo: updates.idaModo ?? base.idaModo,
      idaSugerido: base.idaSugerido != null ? Number(base.idaSugerido) : null,
      idaNotas: updates.idaNotas ?? base.idaNotas,
    };
  };

  /**
   * Get dosificaciones that use a specific aggregate (via mezcla items).
   */
  const getDosificacionesVinculadas = async (db, idAgregado) => {
    try {
      const [rows] = await db.sequelize.query(`
        SELECT DISTINCT d.id, d.nombre, d.codigo, d.estado, d.version, d.createdAt,
               m.nombre AS mezclaNombre
        FROM DosificacionDisenada d
        JOIN MezclaAgregados m ON d.idMezcla = m.idMezcla
        JOIN MezclaAgregadosItem mi ON m.idMezcla = mi.idMezcla
        WHERE mi.idAgregado = ?
        ORDER BY d.createdAt DESC
        LIMIT 20
      `, { replacements: [idAgregado] });
      return rows;
    } catch (e) {
      console.warn('[getDosificacionesVinculadas]', e.message);
      return [];
    }
  };

  module.exports = {
    getAgregados,
    getAgregado,
    createAgregado,
    updateAgregado,
    deleteAgregado,
    restoreAgregado,
    getTamaniosMaximos,
    recalcularIdaSugerido,
    updateIda,
    getDosificacionesVinculadas,
  };
  