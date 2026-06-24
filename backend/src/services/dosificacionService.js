const { getCacheForDb } = require('./cacheHelpers');

/** TTLs en segundos */
const CATALOGOS_TTL = 3600;       // 1 hora (tablas de referencia)
const DOSIFICACIONES_TTL = 1800;  // 30 min (invalidado por hooks al cambiar)

/*  Helpers  */
const includeCatalogos = (db) => [
    { model: db.TipoHormigon,          as: "tipoHormigon" },
    { model: db.EdadDisenio,           as: "edadDisenio" },
    { model: db.AsentamientoDisenio,   as: "asentamientoDisenio" },
    { model: db.TamanioMaximoNominal,  as: "tamanioMaximoNominal" },
    { model: db.TipoDescarga,          as: "tipoDescarga" },
    { model: db.Planta,                as: "planta" },
    /* Materiales asociados */
    {
      model: db.DosificacionCemento,
      as: "cementos",
      include: [{ model: db.Cemento, as: "cemento" }],
    },
    {
      model: db.DosificacionAditivos,
      as: "aditivos",
      include: [{ model: db.Aditivo, as: "aditivo" }],
    },
    {
      model: db.DosificacionAgregados,
      as: "agregados",
      include: [{ model: db.Agregado, as: "agregado" }],
    },
    {
      model: db.DosificacionFibras,
      as: "fibras",
      include: [{ model: db.Fibra, as: "fibra" }],
    },
  ];

  /* ───────────────  LISTAR  ─────────────── */
  const getDosificaciones = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('dosificaciones', 'all');
    if (cached) return cached;

    const result = await db.Dosificacion.findAll({
      where: {activo: true},
      include: includeCatalogos(db),
      order: [["nombre", "ASC"]],
    });

    const plain = result.map(r => r.get({ plain: true }));
    tc.set('dosificaciones', 'all', plain, DOSIFICACIONES_TTL);
    return plain;
  };

  /* ───────────────  DETALLE  ─────────────── */
  const getDosificacion = async (db, id) => {
    const tc = getCacheForDb(db);
    const cacheKey = `detail:${id}`;
    const cached = tc.get('dosificaciones', cacheKey);
    if (cached) return cached;

    const result = await db.Dosificacion.findByPk(id, {
      include: includeCatalogos(db),
    });

    if (result) {
      const plain = result.get({ plain: true });
      tc.set('dosificaciones', cacheKey, plain, DOSIFICACIONES_TTL);
      return plain;
    }
    return null;
  };

  /* ───────────────  CREAR  ─────────────── */
  const createDosificacion = async (db, data) => {
    const t = await db.sequelize.transaction();
    try {
      /* 1. Dosificación base */
      const base = await db.Dosificacion.create(
        {
          nombre:                     data.nombre,
          idTipoHormigon:             data.idTipoHormigon,
          idEdadDisenio:              data.idEdadDisenio,
          idAsentamientoDisenio:      data.idAsentamientoDisenio,
          agua:                       data.agua,
          idTamanioMaximoNominal:     data.idTamanioMaximoNominal,
          idTipoDescarga:             data.idTipoDescarga,
          idPlanta:                   data.idPlanta,
          codigoEnPlanta:             data.codigoEnPlanta || null,
          descripcion:                data.descripcion   || null,
        },
        { transaction: t }
      );

      /* 2. Cementos (máx 2) */
      if (Array.isArray(data.cementos)) {
        const registros = data.cementos.slice(0, 2).map((c) => ({
          idDosificacion: base.idDosificacion,
          idCemento:      c.idCemento,
          cantidadCemento:     c.cantidadCemento,
        }));
        await db.DosificacionCemento.bulkCreate(registros, { transaction: t });
      }

      /* 3. Aditivos */
      if (Array.isArray(data.aditivos)) {
        const registros = data.aditivos.map((a) => ({
          idDosificacion: base.idDosificacion,
          idAditivo:      a.idAditivo,
          cantidad:          a.cantidad,
        }));
        await db.DosificacionAditivos.bulkCreate(registros, { transaction: t });
      }

      /* 4. Agregados */
      if (Array.isArray(data.agregados)) {
        const registros = data.agregados.map((ag) => ({
          idDosificacion: base.idDosificacion,
          idAgregado:     ag.idAgregado,
          cantidadAgregado:     ag.cantidadAgregado,
        }));
        await db.DosificacionAgregados.bulkCreate(registros, { transaction: t });
      }

      /* 5. Fibras */
      if (Array.isArray(data.fibras)) {
        const registros = data.fibras.map((a) => ({
          idDosificacion: base.idDosificacion,
          idFibra:      a.idFibra,
          cantidadFibra:          a.cantidadFibra,
        }));
        await db.DosificacionFibras.bulkCreate(registros, { transaction: t });
      }

      await t.commit();
      // Los hooks afterBulkCreate de DosificacionCemento/Aditivos/etc
      // invalidan el namespace 'dosificaciones' automaticamente
      return base;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  };

  /* ───────────────  ACTUALIZAR  ─────────────── */
  const updateDosificacion = async (db, id, data) => {
    const t = await db.sequelize.transaction();
    try {
      const dos = await db.Dosificacion.findByPk(id, { transaction: t });
      if (!dos) throw new Error("Dosificación no encontrada");

      await dos.update(
        {
          nombre:                     data.nombre,
          idTipoHormigon:             data.idTipoHormigon,
          idEdadDisenio:              data.idEdadDisenio,
          idAsentamientoDisenio:      data.idAsentamientoDisenio,
          agua:                       data.agua,
          idTamanioMaximoNominal:     data.idTamanioMaximoNominal,
          idTipoDescarga:             data.idTipoDescarga,
          idPlanta:                   data.idPlanta,
          codigoEnPlanta:             data.codigoEnPlanta,
          descripcion:                data.descripcion,
        },
        { transaction: t }
      );

      /* 1. Cementos */
      await db.DosificacionCemento.destroy({ where: { idDosificacion: id }, transaction: t });
      if (Array.isArray(data.cementos)) {
        const regs = data.cementos.slice(0, 2).map((c) => ({
          idDosificacion: id,
          idCemento:      c.idCemento,
          cantidadCemento:     c.cantidadCemento,
        }));
        await db.DosificacionCemento.bulkCreate(regs, { transaction: t });
      }

      /* 2. Aditivos */
      await db.DosificacionAditivos.destroy({ where: { idDosificacion: id }, transaction: t });
      if (Array.isArray(data.aditivos)) {
        const regs = data.aditivos.map((a) => ({
          idDosificacion: id,
          idAditivo:      a.idAditivo,
          cantidad:          a.cantidad,
        }));
        await db.DosificacionAditivos.bulkCreate(regs, { transaction: t });
      }

      /* 3. Agregados */
      await db.DosificacionAgregados.destroy({ where: { idDosificacion: id }, transaction: t });
      if (Array.isArray(data.agregados)) {
        const regs = data.agregados.map((ag) => ({
          idDosificacion: id,
          idAgregado:     ag.idAgregado,
          cantidadAgregado:     ag.cantidadAgregado,
        }));
        await db.DosificacionAgregados.bulkCreate(regs, { transaction: t });
      }

      /* 4. Fibras */
      await db.DosificacionFibras.destroy({ where: { idDosificacion: id }, transaction: t });
      if (Array.isArray(data.fibras)) {
        const regs = data.fibras.map((a) => ({
          idDosificacion: id,
          idFibra:      a.idFibra,
          cantidadFibra:          a.cantidadFibra,
        }));
        await db.DosificacionFibras.bulkCreate(regs, { transaction: t });
      }

      await t.commit();
      return dos;
    } catch (err) {
      await t.rollback();
      throw err;
    }
  };

  /* ───────────────  ELIMINAR  ─────────────── */
  const deleteDosificacion = async (db, id) => {
    try {
      const dosificacion = await db.Dosificacion.findByPk(id);
      if (!dosificacion) throw new Error("Dosificación no encontrada");

      await dosificacion.update({activo: false});

      return { message: "Dosificación eliminada" };
    } catch (err) {
      throw err;
    }
  };

  /* ───────────────  CATÁLOGOS  ─────────────── */
  const getCatalogosBasicos = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'dosif_basicos');
    if (cached) return cached;

    const [tiposH, edades, asentamientos, tamanios, tiposDesc, plantas] =
      await Promise.all([
        db.TipoHormigon.findAll({ order: [["tipoHormigon", "ASC"]] }),
        db.EdadDisenio.findAll({ order: [["dias", "ASC"]] }),
        db.AsentamientoDisenio.findAll({ order: [["asentamiento", "ASC"]] }),
        db.TamanioMaximoNominal.findAll({ order: [["tamanio", "ASC"]] }),
        db.TipoDescarga.findAll({ order: [["tipo", "ASC"]] }),
        db.Planta.findAll({ order: [["nombre", "ASC"]] }),
      ]);

    const result = {
      tiposHormigon:        tiposH.map(r => r.get({ plain: true })),
      edadesDisenio:        edades.map(r => r.get({ plain: true })),
      asentamientosDisenio: asentamientos.map(r => r.get({ plain: true })),
      tamaniosMaximos:      tamanios.map(r => r.get({ plain: true })),
      tiposDescarga:        tiposDesc.map(r => r.get({ plain: true })),
      plantas:              plantas.map(r => r.get({ plain: true })),
    };

    tc.set('catalogos', 'dosif_basicos', result, CATALOGOS_TTL);
    return result;
  };

  /* ═══════════════════════════════════════════════════════════════
     IMPORTAR dosificaciones desde Excel (sync por planta)
     ═══════════════════════════════════════════════════════════════ */
  const importarDosificaciones = async (db, idPlanta, rows) => {
    /* 1. Cargar catálogos para resolver nombres → IDs */
    const [cementos, aditivos, agregados, fibras, tiposH, edades, asentamientos, tamanios, tiposDesc] =
      await Promise.all([
        db.Cemento.findAll({ where: { activo: true } }),
        db.Aditivo.findAll({ where: { activo: true } }),
        db.Agregado.findAll({ where: { activo: true } }),
        db.Fibra.findAll({ where: { activo: true } }),
        db.TipoHormigon.findAll(),
        db.EdadDisenio.findAll(),
        db.AsentamientoDisenio.findAll(),
        db.TamanioMaximoNominal.findAll(),
        db.TipoDescarga.findAll(),
      ]);

    const findCemento = (nombre) => cementos.find((c) => c.nombreComercial?.trim().toLowerCase() === nombre?.toLowerCase());
    const findAditivo = (nombre) => aditivos.find((a) => a.marca?.trim().toLowerCase() === nombre?.toLowerCase());
    const findAgregado = (nombre) => agregados.find((a) => a.nombre?.trim().toLowerCase() === nombre?.toLowerCase());
    const findFibra = (nombre) => fibras.find((f) => f.marca?.trim().toLowerCase() === nombre?.toLowerCase());
    const findTipoH = (val) => tiposH.find((t) => t.tipoHormigon?.trim().toLowerCase() === val?.toLowerCase());
    const findEdad = (dias) => edades.find((e) => Number(e.dias) === Number(dias));
    const findAsentamiento = (val) => asentamientos.find((a) => Number(a.asentamiento) === Number(val));
    const findTMN = (val) => tamanios.find((t) => Number(t.tamanio) === Number(val));
    const findTipoDesc = (val) => tiposDesc.find((t) => t.tipo?.trim().toLowerCase() === val?.toLowerCase());

    /* 2. Cargar dosificaciones existentes de la planta */
    const existentes = await db.Dosificacion.findAll({
      where: { idPlanta, activo: true },
      include: includeCatalogos(db),
    });
    const existentesByNombre = {};
    existentes.forEach((d) => {
      existentesByNombre[d.nombre.trim().toLowerCase()] = d.get({ plain: true });
    });

    /* 3. Resolver cada fila del Excel */
    const errores = [];
    const resolvedRows = [];
    rows.forEach((row, idx) => {
      const lineNum = idx + 2; // fila en Excel (1=header)
      if (!row.nombre) { errores.push(`Fila ${lineNum}: nombre vacío`); return; }

      const tipoH = findTipoH(row.tipoHormigon);
      if (!tipoH && row.tipoHormigon) errores.push(`Fila ${lineNum}: tipo hormigón "${row.tipoHormigon}" no encontrado`);

      const edad = findEdad(row.edadDisenio);
      if (!edad && row.edadDisenio) errores.push(`Fila ${lineNum}: edad diseño "${row.edadDisenio}" no encontrada`);

      const asen = findAsentamiento(row.asentamiento);
      if (!asen && row.asentamiento) errores.push(`Fila ${lineNum}: asentamiento "${row.asentamiento}" no encontrado`);

      const tmn = findTMN(row.tmn);
      if (!tmn && row.tmn) errores.push(`Fila ${lineNum}: TMN "${row.tmn}" no encontrado`);

      const tipoD = findTipoDesc(row.tipoDescarga);
      if (!tipoD && row.tipoDescarga) errores.push(`Fila ${lineNum}: tipo descarga "${row.tipoDescarga}" no encontrado`);

      // Resolver materiales
      const resCementos = [];
      (row.cementos || []).forEach((c) => {
        const found = findCemento(c.nombre);
        if (!found) { errores.push(`Fila ${lineNum}: cemento "${c.nombre}" no encontrado`); return; }
        resCementos.push({ idCemento: found.idCemento, cantidadCemento: c.cantidad });
      });

      const resAditivos = [];
      (row.aditivos || []).forEach((a) => {
        const found = findAditivo(a.nombre);
        if (!found) { errores.push(`Fila ${lineNum}: aditivo "${a.nombre}" no encontrado`); return; }
        resAditivos.push({ idAditivo: found.idAditivo, cantidad: a.cantidad });
      });

      const resAgregados = [];
      (row.agregados || []).forEach((a) => {
        const found = findAgregado(a.nombre);
        if (!found) { errores.push(`Fila ${lineNum}: agregado "${a.nombre}" no encontrado`); return; }
        resAgregados.push({ idAgregado: found.idAgregado, cantidadAgregado: a.cantidad });
      });

      const resFibras = [];
      (row.fibras || []).forEach((f) => {
        const found = findFibra(f.nombre);
        if (!found) { errores.push(`Fila ${lineNum}: fibra "${f.nombre}" no encontrada`); return; }
        resFibras.push({ idFibra: found.idFibra, cantidadFibra: f.cantidad });
      });

      resolvedRows.push({
        nombre: row.nombre.trim(),
        codigoEnPlanta: row.codigoEnPlanta || null,
        idTipoHormigon: tipoH?.idTipoHormigon || null,
        idEdadDisenio: edad?.idEdadDisenio || null,
        idAsentamientoDisenio: asen?.idAsentamientoDisenio || null,
        idTamanioMaximoNominal: tmn?.idTamanioMaximoNominal || null,
        idTipoDescarga: tipoD?.idTipoDescarga || null,
        agua: row.agua,
        descripcion: row.descripcion || null,
        cementos: resCementos,
        aditivos: resAditivos,
        agregados: resAgregados,
        fibras: resFibras,
      });
    });

    // Si hay errores de catálogo, abortar
    if (errores.length > 0) {
      return { creadas: 0, actualizadas: 0, eliminadas: 0, sinCambios: 0, errores };
    }

    /* 4. Diff y aplicar cambios en transacción */
    const t = await db.sequelize.transaction();
    let creadas = 0, actualizadas = 0, eliminadas = 0, sinCambios = 0;

    try {
      const nombresEnExcel = new Set(resolvedRows.map((r) => r.nombre.toLowerCase()));

      // 4a. Eliminar las que ya no están en el Excel
      for (const ex of existentes) {
        if (!nombresEnExcel.has(ex.nombre.trim().toLowerCase())) {
          await ex.update({ activo: false }, { transaction: t });
          eliminadas++;
        }
      }

      // 4b. Crear o actualizar
      for (const row of resolvedRows) {
        const key = row.nombre.toLowerCase();
        const existing = existentesByNombre[key];

        if (!existing) {
          // CREAR
          const base = await db.Dosificacion.create(
            { ...row, idPlanta },
            { transaction: t }
          );
          await bulkCreateMaterials(db, base.idDosificacion, row, t);
          creadas++;
        } else {
          // Comparar si cambió algo
          const changed = hasDosificacionChanged(existing, row);
          if (changed) {
            await db.Dosificacion.update(
              { ...row, idPlanta },
              { where: { idDosificacion: existing.idDosificacion }, transaction: t }
            );
            // Recrear materiales
            await replaceMaterials(db, existing.idDosificacion, row, t);
            actualizadas++;
          } else {
            sinCambios++;
          }
        }
      }

      await t.commit();

      // Invalidar cache
      const tc = getCacheForDb(db);
      tc.invalidate('dosificaciones');

      return { creadas, actualizadas, eliminadas, sinCambios, errores: [] };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  };

  /* ── Helpers de importación ── */
  const bulkCreateMaterials = async (db, idDosificacion, row, t) => {
    if (row.cementos.length) {
      await db.DosificacionCemento.bulkCreate(
        row.cementos.slice(0, 2).map((c) => ({ idDosificacion, ...c })),
        { transaction: t }
      );
    }
    if (row.aditivos.length) {
      await db.DosificacionAditivos.bulkCreate(
        row.aditivos.map((a) => ({ idDosificacion, ...a })),
        { transaction: t }
      );
    }
    if (row.agregados.length) {
      await db.DosificacionAgregados.bulkCreate(
        row.agregados.map((a) => ({ idDosificacion, ...a })),
        { transaction: t }
      );
    }
    if (row.fibras.length) {
      await db.DosificacionFibras.bulkCreate(
        row.fibras.map((f) => ({ idDosificacion, ...f })),
        { transaction: t }
      );
    }
  };

  const replaceMaterials = async (db, idDosificacion, row, t) => {
    await Promise.all([
      db.DosificacionCemento.destroy({ where: { idDosificacion }, transaction: t }),
      db.DosificacionAditivos.destroy({ where: { idDosificacion }, transaction: t }),
      db.DosificacionAgregados.destroy({ where: { idDosificacion }, transaction: t }),
      db.DosificacionFibras.destroy({ where: { idDosificacion }, transaction: t }),
    ]);
    await bulkCreateMaterials(db, idDosificacion, row, t);
  };

  const hasDosificacionChanged = (existing, incoming) => {
    // Comparar campos base
    if (existing.idTipoHormigon !== incoming.idTipoHormigon) return true;
    if (existing.idEdadDisenio !== incoming.idEdadDisenio) return true;
    if (existing.idAsentamientoDisenio !== incoming.idAsentamientoDisenio) return true;
    if (existing.idTamanioMaximoNominal !== incoming.idTamanioMaximoNominal) return true;
    if (existing.idTipoDescarga !== incoming.idTipoDescarga) return true;
    if (Number(existing.agua) !== Number(incoming.agua)) return true;
    if ((existing.codigoEnPlanta || '') !== (incoming.codigoEnPlanta || '')) return true;
    if ((existing.descripcion || '') !== (incoming.descripcion || '')) return true;

    // Comparar materiales
    const cementosChanged = materialsChanged(
      (existing.cementos || []).map((c) => ({ id: c.idCemento, cant: Number(c.cantidadCemento) })),
      incoming.cementos.map((c) => ({ id: c.idCemento, cant: Number(c.cantidadCemento) }))
    );
    if (cementosChanged) return true;

    const aditivosChanged = materialsChanged(
      (existing.aditivos || []).map((a) => ({ id: a.idAditivo, cant: Number(a.cantidad) })),
      incoming.aditivos.map((a) => ({ id: a.idAditivo, cant: Number(a.cantidad) }))
    );
    if (aditivosChanged) return true;

    const agregadosChanged = materialsChanged(
      (existing.agregados || []).map((a) => ({ id: a.idAgregado, cant: Number(a.cantidadAgregado) })),
      incoming.agregados.map((a) => ({ id: a.idAgregado, cant: Number(a.cantidadAgregado) }))
    );
    if (agregadosChanged) return true;

    const fibrasChanged = materialsChanged(
      (existing.fibras || []).map((f) => ({ id: f.idFibra, cant: Number(f.cantidadFibra) })),
      incoming.fibras.map((f) => ({ id: f.idFibra, cant: Number(f.cantidadFibra) }))
    );
    if (fibrasChanged) return true;

    return false;
  };

  const materialsChanged = (existArr, incomingArr) => {
    if (existArr.length !== incomingArr.length) return true;
    const sortedEx = [...existArr].sort((a, b) => a.id - b.id);
    const sortedIn = [...incomingArr].sort((a, b) => a.id - b.id);
    return sortedEx.some((e, i) => e.id !== sortedIn[i].id || e.cant !== sortedIn[i].cant);
  };

  module.exports = {
    getDosificaciones,
    getDosificacion,
    createDosificacion,
    updateDosificacion,
    deleteDosificacion,
    getCatalogosBasicos,
    importarDosificaciones,
  };
