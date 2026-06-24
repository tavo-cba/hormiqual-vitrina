// src/services/muestraService.js
const { combineLocal } = require("../utils/date");
const { Op } = require('sequelize');
const { getCacheForDb } = require('./cacheHelpers');
const { ESTADO_PROBETA } = require('../domain/normRef/estadoProbeta');

/** TTL para catalogos de muestra: 1 hora */
const CATALOGOS_TTL = 3600;

/** Invalida la caché del listado de probetas. Usar en cualquier mutación que
 *  cree, modifique o elimine probetas (createMuestra, updateMuestra,
 *  confirmarMuestra, deleteMuestra). */
const invalidateProbetasCache = (db) => {
  try {
    getCacheForDb(db).del('probetas');
  } catch {
    /* noop */
  }
};
exports.invalidateProbetasCache = invalidateProbetasCache;

/* ───────── helpers de include ─────────
 * La Muestra tiene snapshot propio de Cliente/Planta/TipoHormigon/Dosificacion/Obra.
 * Despacho se mantiene como include opcional (LEFT JOIN) para datos exclusivos
 * del despacho (hora, remito, volumen).
 */
const includeAll = (db) => [
  {
    model: db.Despacho,
    as: "despacho",
    required: false,
    attributes: ["fecha", "hora", "remito", "volumenDepacho", "idDespacho"],
  },
  { model: db.Cliente, as: "cliente", attributes: ["idCliente", "nombre", "razonSocial", "tipoPersona"] },
  { model: db.Planta, as: "planta", attributes: ["idPlanta", "nombre"] },
  { model: db.TipoHormigon, as: "tipoHormigon" },
  {
    model: db.Dosificacion,
    as: "dosificacion",
    required: false,
    include: [
      { model: db.TipoHormigon, as: "tipoHormigon" },
      // FIX-4 (auditoría 2026-05-09): asentamiento de consigna para verificar
      // tolerancia Tabla 4.2 CIRSOC 200-2024 §4.1.1 desde el reporte de muestras
      // frescas. Antes solo `getFichaMuestra` lo traía.
      { model: db.AsentamientoDisenio, as: "asentamientoDisenio", attributes: ["asentamiento"], required: false },
      // Sesión 2026-05-10 (FRE-02): TMN del agregado grueso + clase de
      // exposición para verificar aire incorporado contra Tabla 4.3 CIRSOC
      // 200-2024 §4.1.2 desde report-fresh. La matriz Tabla 4.3 está
      // discretizada por TMN × clase de durabilidad.
      { model: db.TamanioMaximoNominal, as: "tamanioMaximoNominal", attributes: ["idTamanioMaximoNominal", "tamanio"], required: false },
      { model: db.DurabilidadExposicion, as: "durabilidadExposicion", attributes: ["id", "codigo", "grupo", "requiereAireTabla43"], required: false },
    ],
  },
  // Dosificación del Diseñador (despachos con origen DISENADOR). El snapshot de
  // la Muestra guarda idDosificacionDisenada cuando el despacho no usa la
  // dosificación legacy; sin este include el form/listado no podría mostrarla.
  ...(db.DosificacionDisenada ? [{
    model: db.DosificacionDisenada,
    as: "dosificacionDisenada",
    required: false,
    attributes: ["id", "nombre", "idTipoHormigon"],
    include: [{ model: db.TipoHormigon, as: "tipoHormigon", required: false }],
  }] : []),
  { model: db.Obra, as: "obra", required: false, attributes: ["idObra", "nombre"] },
  { model: db.Probeta, as: "probetas" },
  { model: db.TipoProbeta, as: "tipoprobeta" },
  { model: db.ModalidadMuestra, as: "modalidad" },
];

/* ───────── helpers de fecha base ─────────
 * Toda muestra (con o sin despacho) tiene fecha propia. La hora exacta del
 * moldeo no es crítica para el cálculo de fechaRotura — siempre se fija a las
 * 12:00 hora local. Esto unifica el cálculo entre muestras propias (con o sin
 * despacho) y muestras de terceros.
 */
const baseDateFromMuestra = (muestra) => {
  const fecha = muestra.fecha || muestra.get?.('fecha');
  if (!fecha) return null;
  const base = combineLocal(fecha, '12:00');
  base.setHours(12, 0, 0, 0);
  return base;
};

const MS_DIA = 86_400_000;

/* ───────── helpers de denormalización ─────────
 * Cuando la muestra se crea desde un Despacho, los campos contextuales se
 * snapshotean a la Muestra. Cambios futuros en el Despacho no impactan a la
 * Muestra.
 */
const snapshotFromDespacho = async (db, idDespacho, transaction) => {
  // El despacho puede apuntar a una Dosificacion legacy (idDosificacion) o a
  // una DosificacionDisenada (idDosificacionDisenada, despachos del Diseñador).
  // Incluimos ambas para snapshotear el tipo de hormigón y la dosificación
  // correctos sea cual sea el origen.
  const include = [{ model: db.Dosificacion, as: 'dosificacion' }];
  if (db.DosificacionDisenada) {
    include.push({ model: db.DosificacionDisenada, as: 'dosificacionDisenada' });
  }
  const despacho = await db.Despacho.findByPk(idDespacho, { include, transaction });
  if (!despacho) {
    throw new Error(`Despacho ${idDespacho} no encontrado`);
  }
  return {
    idDespacho:             despacho.idDespacho,
    fecha:                  despacho.fecha,
    idCliente:              despacho.idCliente,
    idObra:                 despacho.idObra,
    idPlanta:               despacho.idPlanta,
    idDosificacion:         despacho.idDosificacion ?? null,
    idDosificacionDisenada: despacho.idDosificacionDisenada ?? null,
    idTipoHormigon:
      despacho.dosificacion?.idTipoHormigon
      ?? despacho.dosificacionDisenada?.idTipoHormigon
      ?? null,
  };
};

// Exportado para que el flujo de creación de Muestra desde DespachoForm
// (despachoService.createMuestras) reutilice el mismo snapshot y los campos
// directos de la Muestra queden poblados de forma consistente.
exports.snapshotFromDespacho = snapshotFromDespacho;

/**
 * Registra/actualiza la muestra de hormigón FRESCO de un despacho desde el
 * Panel Plantista (Fase B). Datos del fresco medidos en el camión: asentamiento,
 * temperaturas y aire incorporado. No crea probetas (eso lo completa el lab).
 *
 * - `datos.lleva === false` → sólo desmarca `tieneMuestra` (no borra una muestra
 *   ya creada por el laboratorio).
 * - Si ya hay muestra ligada → actualiza los datos del fresco.
 * - Si no → crea una nueva con el snapshot del despacho + el operador (plantista).
 */
const registrarMuestraFrescaDesdeDespacho = async (db, idDespacho, datos = {}, idOperador = null) => {
    const t = await db.sequelize.transaction();
    try {
        const despacho = await db.Despacho.findByPk(idDespacho, { transaction: t });
        if (!despacho) throw new Error('Despacho no encontrado');

        if (!datos.lleva) {
            await despacho.update({ tieneMuestra: false }, { transaction: t });
            await t.commit();
            return { ok: true, tieneMuestra: false };
        }

        const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
        const fresco = {
            asentamientoMm: num(datos.asentamientoMm),
            temperaturaHormigon: num(datos.temperaturaHormigon),
            temperaturaAmbiente: num(datos.temperaturaAmbiente),
            aireincorporado: num(datos.aireincorporado),
        };

        let muestra = despacho.idMuestra
            ? await db.Muestra.findByPk(despacho.idMuestra, { transaction: t })
            : null;
        if (muestra) {
            await muestra.update(fresco, { transaction: t });
        } else {
            if (!idOperador) throw new Error('No se pudo determinar el operador (usuario sin empleado asociado).');
            const snap = await snapshotFromDespacho(db, idDespacho, t);
            muestra = await db.Muestra.create({
                ...snap, ...fresco,
                idOperador, cantidadProbetas: 0, estado: false,
            }, { transaction: t });
            await despacho.update({ idMuestra: muestra.idMuestra }, { transaction: t });
        }
        if (!despacho.tieneMuestra) await despacho.update({ tieneMuestra: true }, { transaction: t });
        await t.commit();
        return { ok: true, tieneMuestra: true, idMuestra: muestra.idMuestra };
    } catch (e) {
        await t.rollback();
        throw e;
    }
};
exports.registrarMuestraFrescaDesdeDespacho = registrarMuestraFrescaDesdeDespacho;

/* ══════════════════════════════════════
   Lectura
   ══════════════════════════════════════ */
exports.getMuestras = (db, params = {}) => {
  const {
    idCliente,
    idObra,
    idPlanta,
    idDosificacion,
    tipoHormigon,
    fechaDesde,
    fechaHasta,
    idTipoHormigon,
    desde,
    hasta,
    cliente,
    obra,
    planta,
    dosificacion,
  } = params;

  const idCli = idCliente || cliente;
  const idObraSel = idObra || obra;
  const idPlantaSel = idPlanta || planta;
  const idDosifSel = idDosificacion || dosificacion;
  const idTH = tipoHormigon || idTipoHormigon;
  const fechaD = fechaDesde || desde;
  const fechaH = fechaHasta || hasta;

  // Filtros operan sobre los campos propios de la Muestra (snapshot),
  // no sobre el Despacho. Esto permite filtrar muestras sin despacho.
  const where = {};
  if (idCli)       where.idCliente      = +idCli;
  if (idObraSel)   where.idObra         = +idObraSel;
  if (idPlantaSel) where.idPlanta       = +idPlantaSel;
  if (idDosifSel)  where.idDosificacion = +idDosifSel;
  if (idTH)        where.idTipoHormigon = +idTH;
  if (fechaD || fechaH) {
    where.fecha = {
      ...(fechaD && { [Op.gte]: fechaD }),
      ...(fechaH && { [Op.lte]: fechaH }),
    };
  }

  return db.Muestra.findAll({
    where,
    include: includeAll(db),
    // Mej-08 (auditoría 08, Bloque 8): orden por fecha de moldeo (DATEONLY)
    // en vez de createdAt (timestamp DB). Para muestras cargadas con retraso
    // el orden cronológico real es por fecha de moldeo, no de inserción.
    // `idMuestra DESC` como tie-breaker estable cuando hay varias muestras
    // del mismo día.
    order: [["fecha", "DESC"], ["idMuestra", "DESC"]],
    distinct: true,
    col: 'idMuestra',
  });
};

exports.getMuestra = (db, id) =>
  db.Muestra.findByPk(id, {
    include: [
      ...includeAll(db).filter((inc) => inc.as !== 'probetas'),
      {
        model: db.Probeta,
        as: 'probetas',
        include: [
          { model: db.EstadoProbeta, as: 'estadoProbeta' },
          {
            model: db.EnsayoResistencia,
            as: 'ensayo',
            include: [
              { model: db.Empleado, as: 'operarioEnsayo', attributes: ['nombre', 'apellido'] },
            ],
          },
        ],
        order: [['diasRotura', 'ASC']],
      },
    ],
  });

/* ══════════════════════════════════════
   Escritura
   ══════════════════════════════════════ */

const requiredContextoMuestra = (data) => {
  const faltantes = [];
  if (!data.idCliente)      faltantes.push('idCliente');
  if (!data.idTipoHormigon) faltantes.push('idTipoHormigon');
  if (!data.fecha)          faltantes.push('fecha');
  if (!data.idPlanta)       faltantes.push('idPlanta');
  // M-LOG-12 fix (auditoría 08, Bloque 13): `idOperador` es NOT NULL en BD;
  // antes la falta caía en un error genérico de Sequelize. Ahora se rechaza
  // con un mensaje específico y status 400.
  if (!data.idOperador)     faltantes.push('idOperador');
  if (faltantes.length) {
    const err = new Error(
      `Faltan campos obligatorios para crear la muestra sin despacho: ${faltantes.join(', ')}`
    );
    err.status = 400;
    throw err;
  }
};

exports.createMuestra = async (db, payload) => {
  const t = await db.sequelize.transaction();
  try {
    const { probetas, ...base } = payload;

    // 1. Resolver contexto: si viene idDespacho hacemos snapshot del despacho;
    //    si no, los campos de contexto deben venir en el payload.
    if (base.idDespacho) {
      const snap = await snapshotFromDespacho(db, base.idDespacho, t);
      // El payload puede sobrescribir el snapshot (ej. tipoHormigon explícito),
      // pero por defecto manda el despacho.
      Object.assign(base, snap, base);
    } else {
      requiredContextoMuestra(base);
    }

    // `cantidadProbetas` es NOT NULL en el modelo. El frontend manda `null`
    // cuando la muestra es fresca (solo temperatura/asentamiento/aire, sin
    // probetas), lo que rompía la creación con un notNull Violation. Si no
    // viene, la derivamos del array (0 para muestra fresca sin probetas).
    if (base.cantidadProbetas == null) {
      base.cantidadProbetas = Array.isArray(probetas) ? probetas.length : 0;
    }

    // M-LOG-13 fix (auditoría 08, Bloque 13): `cantidadProbetas` (counter del
    // header) debe coincidir con la longitud del array de probetas. Antes una
    // muestra podía declarar 6 probetas y traer solo 4: el header quedaba
    // mintiendo en los reportes y la diferencia no se detectaba hasta que
    // alguien intentaba cuadrar.
    if (Array.isArray(probetas)
        && base.cantidadProbetas != null
        && Number(base.cantidadProbetas) !== probetas.length) {
      const err = new Error(
        `cantidadProbetas (${base.cantidadProbetas}) no coincide con probetas.length (${probetas.length}).`
      );
      err.status = 400;
      throw err;
    }

    // 2. Crear Muestra con contexto completo
    const muestra = await db.Muestra.create(base, { transaction: t });

    // 3. Crear probetas con fechaRotura calculada desde la muestra
    if (probetas && probetas.length) {
      const baseDate = baseDateFromMuestra(muestra);
      const ahora = new Date();
      const regs = probetas.map((p) => {
        const fechaRotura = new Date(baseDate.getTime() + p.diasRotura * MS_DIA);
        fechaRotura.setHours(12, 0, 0, 0);

        // Mej-05 (auditoría 08, Bloque 6): magic numbers reemplazados.
        let nuevoEstado = p.idEstadoProbeta;
        if (p.idEstadoProbeta === ESTADO_PROBETA.PENDIENTE && fechaRotura > ahora) {
          nuevoEstado = ESTADO_PROBETA.CURANDO;
        } else if (p.idEstadoProbeta === ESTADO_PROBETA.CURANDO && fechaRotura < ahora) {
          nuevoEstado = ESTADO_PROBETA.PENDIENTE;
        }

        return {
          idMuestra: muestra.idMuestra,
          idEstadoProbeta: nuevoEstado,
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
    // N-01 etiqueta QR (sesión 2026-05-09): retornamos también las probetas
    // recién creadas para que el frontend pueda ofrecer "imprimir etiquetas
    // QR" inmediatamente sin un round-trip adicional.
    const muestraConProbetas = await db.Muestra.findByPk(muestra.idMuestra, {
      include: [{ model: db.Probeta, as: 'probetas', attributes: [
        'idProbeta', 'nombre', 'codigo', 'diasRotura', 'fechaRotura', 'idEstadoProbeta',
      ] }],
    });
    return muestraConProbetas || muestra;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

exports.getTipoProbeta = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('catalogos', 'tipoProbeta');
  if (cached) return cached;

  const tipos = await db.TipoProbeta.findAll();
  const plain = tipos.map(r => r.get({ plain: true }));
  tc.set('catalogos', 'tipoProbeta', plain, CATALOGOS_TTL);
  return plain;
};

exports.getTipoHormigon = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('catalogos', 'tipoHormigon');
  if (cached) return cached;

  const tipos = await db.TipoHormigon.findAll();
  const plain = tipos.map(r => r.get({ plain: true }));
  tc.set('catalogos', 'tipoHormigon', plain, CATALOGOS_TTL);
  return plain;
};

exports.getModalidades = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('catalogos', 'modalidades');
  if (cached) return cached;

  const modalidades = await db.ModalidadMuestra.findAll();
  const plain = modalidades.map(r => r.get({ plain: true }));
  tc.set('catalogos', 'modalidades', plain, CATALOGOS_TTL);
  return plain;
};

exports.updateMuestra = async (db, id, payload, options = {}) => {
  // `options.transaction`: permite que un caller (ej. despachoService) reutilice
  // su propia transacción para hacer el upsert de la muestra de forma atómica
  // con el resto de su operación. Si no se pasa, abrimos y cerramos la nuestra.
  const externalT = options.transaction;
  const t = externalT || await db.sequelize.transaction();
  try {
    const { probetas, ...base } = payload;

    // `cantidadProbetas` es NOT NULL en el modelo. Es derivada del array de
    // probetas (autoritativo): la muestra fresca sin probetas vale 0, no null.
    // En updates parciales que no tocan probetas no pisamos el valor persistido.
    if (Array.isArray(probetas)) {
      base.cantidadProbetas = probetas.length;
    } else if (base.cantidadProbetas == null) {
      delete base.cantidadProbetas;
    }

    const muestra = await db.Muestra.findByPk(id, { transaction: t });
    if (!muestra) throw new Error("Muestra no encontrada");

    // M-LOG-01 fix (auditoría 08, Bloque 13): si cambia la fecha de la muestra
    // hay que propagar la nueva fechaRotura a todas las probetas que no fueron
    // ensayadas todavía. Antes el cambio de `muestra.fecha` quedaba inconsistente
    // con `Probeta.fechaRotura` salvo que el caller mandara también el array
    // `probetas` completo, lo que rara vez pasaba en updates de metadata.
    const fechaAnterior = muestra.fecha;
    const fechaNueva = base.fecha ?? fechaAnterior;
    const cambioFecha = fechaNueva && String(fechaAnterior) !== String(fechaNueva);

    // No re-snapshoteamos desde el Despacho en update: el snapshot original
    // queda congelado al crearse. Solo aceptamos cambios explícitos en los
    // campos contextuales.
    await muestra.update(base, { transaction: t });

    if (cambioFecha && !Array.isArray(probetas)) {
      const baseDate = baseDateFromMuestra(muestra);
      const ahora = new Date();
      const probetasExistentes = await db.Probeta.findAll({
        where: { idMuestra: id },
        transaction: t,
      });
      for (const p of probetasExistentes) {
        // Solo recalculamos en probetas que no llegaron a Ensayada/Descartada/Perdida.
        if (p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA
            || p.idEstadoProbeta === ESTADO_PROBETA.DESCARTADA
            || p.idEstadoProbeta === ESTADO_PROBETA.PERDIDA) {
          continue;
        }
        const fechaRotura = new Date(baseDate.getTime() + p.diasRotura * MS_DIA);
        fechaRotura.setHours(12, 0, 0, 0);
        let estado = p.idEstadoProbeta;
        if (estado === ESTADO_PROBETA.PENDIENTE && fechaRotura > ahora) {
          estado = ESTADO_PROBETA.CURANDO;
        } else if (estado === ESTADO_PROBETA.CURANDO && fechaRotura < ahora) {
          estado = ESTADO_PROBETA.PENDIENTE;
        }
        await p.update({ fechaRotura, idEstadoProbeta: estado }, { transaction: t });
      }
    }

    const existing = await db.Probeta.findAll({ where: { idMuestra: id }, transaction: t });
    const existingMap = new Map(existing.map((p) => [p.idProbeta, p]));
    const keepIds = new Set();

    if (Array.isArray(probetas)) {
      const baseDate = baseDateFromMuestra(muestra);
      const ahora = new Date();
      const nuevos = [];

      for (const p of probetas) {
        const fechaRotura = new Date(baseDate.getTime() + p.diasRotura * MS_DIA);
        fechaRotura.setHours(12, 0, 0, 0);

        let estado = p.idEstadoProbeta;
        if (estado === ESTADO_PROBETA.PENDIENTE && fechaRotura > ahora) {
          estado = ESTADO_PROBETA.CURANDO;
        } else if (estado === ESTADO_PROBETA.CURANDO && fechaRotura < ahora) {
          estado = ESTADO_PROBETA.PENDIENTE;
        }

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
          // M-LOG-04 fix (auditoría 08, Bloque 9): NO permitir revertir el
          // estado de una probeta ya ensayada. Antes el update aceptaba
          // estado=2 (Pendiente) sobre una probeta en estado=3 (Ensayada),
          // borrando silenciosamente la decisión previa de QA.
          const probetaExistente = existingMap.get(p.idProbeta);
          if (probetaExistente.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA
              && estado !== ESTADO_PROBETA.ENSAYADA
              && estado !== ESTADO_PROBETA.DESCARTADA) {
            const err = new Error(
              `No se puede cambiar el estado de la probeta ${probetaExistente.idProbeta} de Ensayada a otro estado distinto de Descartada. La rotura ya fue registrada.`
            );
            err.status = 422;
            throw err;
          }
          await probetaExistente.update(fields, { transaction: t });
        } else {
          nuevos.push({ ...fields, idMuestra: muestra.idMuestra });
        }
      }

      if (nuevos.length) {
        await db.Probeta.bulkCreate(nuevos, { transaction: t });
      }

      const toDelete = existing
        .filter((p) => !keepIds.has(p.idProbeta))
        .map((p) => p.idProbeta);
      if (toDelete.length) {
        await db.Probeta.destroy({ where: { idProbeta: toDelete }, transaction: t });
      }
    }

    if (!externalT) {
      await t.commit();
      invalidateProbetasCache(db);
    }
    return muestra;
  } catch (err) {
    if (!externalT) await t.rollback();
    throw err;
  }
};

exports.confirmarMuestra = async (db, id, loteNumero, idPileta) => {
  // M-LOG-02 fix (auditoría 08, Bloque 9): antes esta función aceptaba
  // `loteNumero=undefined` y generaba probetas con nombres "LundefinedP1",
  // "LundefinedP2", etc. Ahora rechaza valores inválidos antes de iniciar
  // la transacción.
  const loteNum = Number(loteNumero);
  if (!Number.isInteger(loteNum) || loteNum < 1) {
    const err = new Error(
      `Número de lote inválido: ${loteNumero}. Debe ser un entero positivo.`
    );
    err.status = 400;
    throw err;
  }

  const t = await db.sequelize.transaction();
  try {
    const muestra = await db.Muestra.findByPk(id, {
      include: [
        {
          model: db.Probeta, as: "probetas",
          // M-LOG-03 (auditoría 08, Bloque 13): traemos también el ensayo para
          // poder saltar el rename de probetas que ya tienen ensayo aprobado;
          // si las renombráramos, el reporte histórico mostraría un nombre
          // distinto al que firmó el Responsable de Calidad.
          include: [{ model: db.EnsayoResistencia, as: 'ensayo', required: false }],
        },
        { model: db.Despacho, as: "despacho" },
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!muestra) throw new Error("Muestra no encontrada");

    // Fallback al despacho asociado por si la muestra quedó con los campos
    // directos en NULL (data legacy entre la migración inicial y el fix de
    // despachoService.createMuestras).
    const fecha = muestra.fecha ?? muestra.despacho?.fecha ?? null;
    const idPlanta = muestra.idPlanta ?? muestra.despacho?.idPlanta ?? null;

    if (!fecha || !idPlanta) {
      throw new Error(
        "La muestra no tiene fecha o planta cargada. Editala antes de confirmar."
      );
    }

    // Validar duplicado de lote en la misma fecha+planta. Buscamos por los
    // campos directos de la Muestra (snapshot). Las muestras candidatas con
    // campos NULL no aparecen — para limpiarlas hay que correr la migración
    // 20260505i-muestra-rebackfill-from-despacho.
    const existente = await db.Muestra.findOne({
      where: {
        idMuestra: { [Op.ne]: id },
        estado: true,
        fecha,
        idPlanta,
      },
      include: [{
        model: db.Probeta,
        as: "probetas",
        where: { nombre: { [Op.like]: `L${loteNum}P%` } },
        required: true,
      }],
      transaction: t,
    });

    if (existente) {
      throw new Error(
        `Ya existe una muestra con el lote ${loteNum} en la misma fecha y planta (muestra #${existente.idMuestra})`
      );
    }

    for (let i = 0; i < muestra.probetas.length; i++) {
      const p = muestra.probetas[i];
      // M-LOG-03 fix (auditoría 08, Bloque 13): no renombrar probetas que ya
      // tienen un ensayo aprobado: la auditoría firmada referencia ese nombre
      // y un rename silencioso rompería la trazabilidad.
      const tieneEnsayoAprobado =
        p.ensayo && p.ensayo.pendienteRevision === false && p.ensayo.idAprobadoPor != null;
      const updateData = {};
      if (!tieneEnsayoAprobado) {
        updateData.nombre = `L${loteNum}P${i + 1}`;
      }
      if (idPileta) updateData.idPileta = idPileta;
      if (Object.keys(updateData).length > 0) {
        await p.update(updateData, { transaction: t });
      }
    }

    await muestra.update({ estado: true }, { transaction: t });

    const completa = await db.Muestra.findByPk(id, {
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
 * N-06 (auditoría 08, Bloque 7) — Ficha de muestra: payload consolidado
 * de un día de moldeo para entregar en PDF al cliente.
 *
 * Devuelve:
 *  - Muestra con sus snapshots (cliente, obra, planta, dosificación, etc.).
 *  - Despacho asociado (si existe).
 *  - Veredicto del hormigón fresco (asentamiento, temperatura, aire) usando
 *    `ensayoFrescoEvalEngine` del Bloque 5.
 *  - Probetas con su estado actual + ensayo (si está cargado).
 *  - Archivos asociados a la muestra y a sus probetas.
 *
 * Filtro de planta: si `plantaIdsUsuario` es array, solo devuelve la muestra
 * si pertenece a una planta del usuario. Admin (null) ve todas.
 *
 * @param {object} db
 * @param {number} idMuestra
 * @param {Array<number>|null} plantaIdsUsuario
 * @returns {object|null}  null si no existe o el usuario no tiene acceso.
 */
exports.getFichaMuestra = async (db, idMuestra, plantaIdsUsuario = null) => {
  const { evaluarMuestraFresco } = require('../domain/ensayoFrescoEvalEngine');

  const muestra = await db.Muestra.findByPk(idMuestra, {
    include: [
      {
        model: db.Despacho, as: 'despacho', required: false,
        attributes: ['idDespacho', 'fecha', 'hora', 'remito', 'volumenDepacho'],
      },
      { model: db.Cliente, as: 'cliente', attributes: ['idCliente', 'nombre', 'razonSocial', 'tipoPersona'] },
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
      { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'], required: false },
      { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'] },
      { model: db.TipoProbeta, as: 'tipoprobeta', attributes: ['idTipoProbeta', 'tipo'] },
      { model: db.ModalidadMuestra, as: 'modalidad', required: false },
      { model: db.Empleado, as: 'operador', attributes: ['idEmpleado', 'nombre', 'apellido'], required: false },
      {
        model: db.Dosificacion, as: 'dosificacion', required: false,
        attributes: ['idDosificacion', 'nombre', 'idTipoHormigon', 'idAsentamientoDisenio', 'idTamanioMaximoNominal'],
        include: [
          { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
          { model: db.AsentamientoDisenio, as: 'asentamientoDisenio', attributes: ['asentamiento'], required: false },
          { model: db.TamanioMaximoNominal, as: 'tamanioMaximoNominal', attributes: ['tamanio'], required: false },
        ],
      },
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

  // Filtro de planta del usuario (admin pasa null).
  if (Array.isArray(plantaIdsUsuario)) {
    const idPlanta = muestra.idPlanta ?? muestra.despacho?.idPlanta ?? null;
    if (idPlanta == null || !plantaIdsUsuario.map(Number).includes(Number(idPlanta))) {
      return null;
    }
  }

  const plain = muestra.get({ plain: true });

  // Evaluación de hormigón fresco (Bloque 5).
  const asentMm = plain.asentamientoMm != null
    ? Number(plain.asentamientoMm)
    : (plain.asentamiento != null ? Number(plain.asentamiento) * 10 : null);
  const fresco = evaluarMuestraFresco({
    temperaturaHormigon: plain.temperaturaHormigon != null ? Number(plain.temperaturaHormigon) : null,
    asentamientoMm: asentMm,
    aireincorporado: plain.aireincorporado != null ? Number(plain.aireincorporado) : null,
  }, {
    dosificacion: {
      asentamientoObjetivoMm: plain.dosificacion?.asentamientoDisenio?.asentamiento != null
        ? Number(plain.dosificacion.asentamientoDisenio.asentamiento) * 10
        : null,
      tmnMm: plain.dosificacion?.tamanioMaximoNominal?.tamanio != null
        ? Number(plain.dosificacion.tamanioMaximoNominal.tamanio)
        : null,
    },
    claseExposicion: null, // Aceptamos override desde el caller en versión futura.
  });

  // Ordenar probetas por edad de rotura ascendente para presentación coherente.
  if (Array.isArray(plain.probetas)) {
    plain.probetas.sort((a, b) => (a.diasRotura ?? 0) - (b.diasRotura ?? 0));
  }

  return {
    muestra: plain,
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
 * Variante de getFichaMuestra con verificación de ownership por razonSocial
 * + cuit del cliente. Pensado para el endpoint interno del Portal de Clientes.
 *
 * Retorna:
 *   - 'forbidden' si no hay cliente o la muestra no le pertenece
 *   - null si la muestra no existe
 *   - el objeto normal cuando todo OK
 */
exports.getFichaMuestraWeb = async (db, idMuestra, { razonSocial, cuit }) => {
  if (!razonSocial || !cuit) return 'forbidden';
  const cliente = await db.Cliente.findOne({ where: { razonSocial, cuil_cuit: cuit } });
  if (!cliente) return 'forbidden';

  const muestra = await db.Muestra.findByPk(idMuestra, { attributes: ['idMuestra', 'idCliente'] });
  if (!muestra) return null;
  if (muestra.idCliente !== cliente.idCliente) return 'forbidden';

  // Reutilizar la lógica existente sin filtro de planta (cliente ve toda su
  // data, independientemente de las plantas que ven sus empleados internos).
  return exports.getFichaMuestra(db, idMuestra, null);
};

exports.deleteMuestra = async (db, id) => {
  const t = await db.sequelize.transaction();
  try {
    await db.Probeta.destroy({ where: { idMuestra: id }, transaction: t });
    await db.Muestra.destroy({ where: { idMuestra: id }, transaction: t });
    await t.commit();
    invalidateProbetasCache(db);
  } catch (err) {
    await t.rollback();
    throw err;
  }
};
