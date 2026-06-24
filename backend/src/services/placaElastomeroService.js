'use strict';

/**
 * placaElastomeroService.js — IRAM 1709
 *
 * Estados: EN_STOCK → EN_USO → AGOTADO
 *                   ↘ DESCARTADO ↗
 *
 * Stock es por PLANTA. La placa se asigna a 1..N prensas al activarse.
 * Todas las prensas asignadas deben pertenecer al mismo laboratorio
 * (validado vía EquipoLaboratorio.idLaboratorio). El conteo de reúsos
 * se incrementa cuando se ensaya en cualquiera de las prensas asignadas.
 *
 * Solo 1 juego EN_USO por (prensa, diámetro): no puede haber dos placas
 * activas que compartan una misma prensa con el mismo diámetro.
 */

// IRAM 1709:2008 Tabla 1 — Requisitos para el uso de placas de policloropreno (neopreno).
// Auditoría 01-calidad §6.9 (sesión 2026-05-07): valores corregidos contra norma literal.
// Antes filas 2 y 3 estaban en 20-50 / 30-50; los valores correctos son 17-50 / 28-50.
const TABLA_REUSOS = [
  { resistenciaMin: 10, resistenciaMax: 40, durezaShoreA: 50, reusosMax: 100 },
  { resistenciaMin: 17, resistenciaMax: 50, durezaShoreA: 60, reusosMax: 100 },
  { resistenciaMin: 28, resistenciaMax: 50, durezaShoreA: 70, reusosMax: 100 },
  { resistenciaMin: 50, resistenciaMax: 85, durezaShoreA: 70, reusosMax: 50 },
];
const EXTENSION_MAX_PCT = 50;
const TOLERANCIA_DIAMETRO_MM = 5;
const ERROR_DIAMETRO_MM = 10;

function getReusosMaxNorma(durezaShoreA) {
  const row = TABLA_REUSOS.find(r => Math.abs(r.durezaShoreA - durezaShoreA) <= 5);
  return row ? row.reusosMax : 100;
}

// ── Helpers internos ──

/**
 * Normaliza un payload de control de recepción para persistirlo.
 * Deriva `controlAspectoOk` desde `aspectoEstado` (SSoT) para back-compat
 * con el booleano original. Acepta valores medidos opcionales.
 */
function _buildControlPayload(data) {
  const aspectoEstado = data.aspectoEstado || null;
  const controlAspectoOk = aspectoEstado
    ? aspectoEstado === 'CONFORME'
    : !!data.controlAspectoOk;

  const parseDecimal = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const parseInteger = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  return {
    controlDiametroOk: !!data.controlDiametroOk,
    controlEspesorOk: !!data.controlEspesorOk,
    controlDurezaOk: !!data.controlDurezaOk,
    controlAspectoOk,
    diametroMedidoMm: parseDecimal(data.diametroMedidoMm),
    espesorMedidoMm: parseDecimal(data.espesorMedidoMm),
    durezaMedidaShoreA: parseInteger(data.durezaMedidaShoreA),
    aspectoEstado,
    aspectoDetalle: data.aspectoDetalle || null,
    observacionesRecepcion: data.observacionesRecepcion || null,
    controladoPor: data.controladoPor || null,
    fechaControl: data.fechaControl || new Date(),
  };
}

/**
 * Devuelve la siguiente identificación PG-NNNN / PC-NNNN para un diámetro dado.
 * Usa `SELECT … FOR UPDATE` sobre la fila del prefijo para evitar colisiones
 * bajo concurrencia. Debe correr dentro de una transacción.
 *
 * - 150 mm → PG-NNNN
 * - 100 mm → PC-NNNN
 * - Otros diámetros → null (no hay convención de identificación autogenerada).
 */
async function siguienteIdentificacion(db, diametroMm, transaction) {
  if (!db.SecuenciaIdentificacionPlaca) return null;
  let prefijo;
  if (diametroMm === 150) prefijo = 'PG';
  else if (diametroMm === 100) prefijo = 'PC';
  else return null;

  // SELECT FOR UPDATE bloquea la fila del prefijo hasta el commit de la txn,
  // serializando los crear concurrentes dentro del mismo tenant.
  const [rows] = await db.sequelize.query(
    'SELECT ultimoNumero FROM SecuenciaIdentificacionPlaca WHERE prefijo = ? FOR UPDATE',
    { replacements: [prefijo], transaction }
  );
  let proximo;
  if (rows.length === 0) {
    proximo = 1;
    await db.sequelize.query(
      'INSERT INTO SecuenciaIdentificacionPlaca (prefijo, ultimoNumero, updatedAt) VALUES (?, ?, NOW())',
      { replacements: [prefijo, proximo], transaction }
    );
  } else {
    proximo = Number(rows[0].ultimoNumero) + 1;
    await db.sequelize.query(
      'UPDATE SecuenciaIdentificacionPlaca SET ultimoNumero = ?, updatedAt = NOW() WHERE prefijo = ?',
      { replacements: [proximo, prefijo], transaction }
    );
  }
  return `${prefijo}-${String(proximo).padStart(4, '0')}`;
}

/**
 * Devuelve `idLaboratorio` para una prensa identificada por `nombre`.
 * Si no encuentra el equipo o no tiene laboratorio asignado devuelve null.
 * El service decide qué hacer con null según el contexto (en `activarEnPrensa`
 * con multi-prensa, null bloquea; en queries de lectura no).
 */
async function getIdLaboratorioDePrensa(db, nombrePrensa) {
  if (!db.EquipoLaboratorio || !nombrePrensa) return null;
  const eq = await db.EquipoLaboratorio.findOne({
    where: { nombre: nombrePrensa, tipo: 'PRENSA' },
    attributes: ['idEquipo', 'idLaboratorio'],
  });
  return eq ? (eq.idLaboratorio || null) : null;
}

/**
 * Devuelve los nombres de prensa asignados a una placa según la tabla intermedia.
 * Incluye fallback al campo legacy `placa.idPrensa` para placas activadas antes
 * de la migración multi-prensa (caso defensivo — la migración hace backfill).
 */
async function getPrensasAsignadas(db, idPlacaElastomero, placaCache = null) {
  if (!db.PlacaElastomeroPrensa) {
    if (!placaCache) {
      const p = await db.PlacaElastomero.findByPk(idPlacaElastomero, { attributes: ['idPrensa'] });
      placaCache = p ? p.get({ plain: true }) : null;
    }
    return placaCache?.idPrensa ? [placaCache.idPrensa] : [];
  }
  const rows = await db.PlacaElastomeroPrensa.findAll({
    where: { idPlacaElastomero },
    attributes: ['idPrensa'],
  });
  if (rows.length > 0) return rows.map(r => r.idPrensa);
  if (!placaCache) {
    const p = await db.PlacaElastomero.findByPk(idPlacaElastomero, { attributes: ['idPrensa'] });
    placaCache = p ? p.get({ plain: true }) : null;
  }
  return placaCache?.idPrensa ? [placaCache.idPrensa] : [];
}

/**
 * Devuelve las placas EN_USO asignadas a una prensa dada (cruzando la
 * tabla intermedia). Si no hay tabla intermedia, cae a query legacy por
 * `PlacaElastomero.idPrensa`.
 */
async function findActivasPorPrensaInternal(db, idPrensa, diametroMm = null) {
  if (!db.PlacaElastomeroPrensa) {
    const where = { idPrensa, estado: 'EN_USO' };
    if (diametroMm) where.diametroMm = diametroMm;
    return db.PlacaElastomero.findAll({ where, order: [['diametroMm', 'ASC'], ['fechaActivacion', 'DESC']] });
  }
  const links = await db.PlacaElastomeroPrensa.findAll({
    where: { idPrensa },
    attributes: ['idPlacaElastomero'],
  });
  const ids = links.map(l => l.idPlacaElastomero);
  if (ids.length === 0) {
    // Defensivo: placas activadas antes del backfill
    const where = { idPrensa, estado: 'EN_USO' };
    if (diametroMm) where.diametroMm = diametroMm;
    return db.PlacaElastomero.findAll({ where, order: [['diametroMm', 'ASC'], ['fechaActivacion', 'DESC']] });
  }
  const where = { idPlacaElastomero: ids, estado: 'EN_USO' };
  if (diametroMm) where.diametroMm = diametroMm;
  return db.PlacaElastomero.findAll({ where, order: [['diametroMm', 'ASC'], ['fechaActivacion', 'DESC']] });
}

// ── Queries ──

const _hydrate = async (db, rows) => {
  // Pre-cargar controles de recepción en una sola query (evita N+1 en el listado).
  let controlesPorPlaca = new Map();
  if (db.ControlRecepcionPlaca && rows.length > 0) {
    const ids = rows.map(r => r.idPlacaElastomero || r.get?.('idPlacaElastomero')).filter(Boolean);
    if (ids.length > 0) {
      const controles = await db.ControlRecepcionPlaca.findAll({
        where: { idPlacaElastomero: ids },
      });
      controlesPorPlaca = new Map(controles.map(c => [c.idPlacaElastomero, c.get({ plain: true })]));
    }
  }
  return Promise.all(rows.map(async (r) => {
    const plain = r.get({ plain: true });
    plain.prensasAsignadas = await getPrensasAsignadas(db, plain.idPlacaElastomero, plain);
    plain.controlRecepcion = controlesPorPlaca.get(plain.idPlacaElastomero) || null;
    return plain;
  }));
};

const listarTodas = async (db) => {
  const rows = await db.PlacaElastomero.findAll({ order: [['estado', 'ASC'], ['idPrensa', 'ASC'], ['fechaAlta', 'DESC']] });
  return _hydrate(db, rows);
};

const listarPorLaboratorio = async (db, idLaboratorio) => {
  const rows = await db.PlacaElastomero.findAll({
    where: idLaboratorio ? { idLaboratorio: Number(idLaboratorio) } : {},
    order: [['estado', 'ASC'], ['idPrensa', 'ASC'], ['fechaAlta', 'DESC']],
  });
  return _hydrate(db, rows);
};

// Back-compat: algunos consumidores externos podrían seguir filtrando por planta.
// Se mantiene como query por el campo cache `idPlanta`.
const listarPorPlanta = async (db, idPlanta) => {
  const where = idPlanta ? { idPlanta } : {};
  const rows = await db.PlacaElastomero.findAll({ where, order: [['estado', 'ASC'], ['idPrensa', 'ASC'], ['fechaAlta', 'DESC']] });
  return _hydrate(db, rows);
};

const getStock = async (db, idPlanta) => {
  return db.PlacaElastomero.findAll({ where: { idPlanta, estado: 'EN_STOCK' }, order: [['fechaAlta', 'DESC']] });
};

const getStockPorLaboratorio = async (db, idLaboratorio) => {
  return db.PlacaElastomero.findAll({ where: { idLaboratorio: Number(idLaboratorio), estado: 'EN_STOCK' }, order: [['fechaAlta', 'DESC']] });
};

const getEnUsoPorPrensa = async (db, idPrensa, diametroMm) => {
  const activas = await findActivasPorPrensaInternal(db, idPrensa, diametroMm);
  return activas.length > 0 ? activas[0] : null;
};

const getActivasPorPrensa = async (db, idPrensa) => {
  return findActivasPorPrensaInternal(db, idPrensa, null);
};

// ── Crear (va a stock) ──

/**
 * Resuelve la planta principal de un laboratorio. Tomamos la primera
 * planta activa asignada al laboratorio vía LaboratorioPlanta. Sirve para
 * popular el campo legacy `idPlanta` (que sigue siendo cache para listados).
 */
async function getPlantaPrincipalDeLaboratorio(db, idLaboratorio) {
  if (!db.LaboratorioPlanta || !idLaboratorio) return null;
  const link = await db.LaboratorioPlanta.findOne({
    where: { idLaboratorio, activo: true },
    order: [['idPlanta', 'ASC']],
    attributes: ['idPlanta'],
  });
  return link ? link.idPlanta : null;
}

const crearJuego = async (db, data) => {
  const { idLaboratorio, idPlanta, durezaShoreA, diametroMm, fechaAlta, marca, observaciones, creadoPor, control } = data;
  if (!durezaShoreA) throw Object.assign(new Error('durezaShoreA requerido'), { status: 422 });
  if (!diametroMm) throw Object.assign(new Error('diametroMm requerido'), { status: 422 });

  // SSoT: idLaboratorio. Si llega sólo idPlanta (back-compat), derivamos el
  // primer laboratorio activo que atienda esa planta.
  let labId = idLaboratorio ? Number(idLaboratorio) : null;
  if (!labId && idPlanta && db.LaboratorioPlanta && db.Laboratorio) {
    const link = await db.LaboratorioPlanta.findOne({
      where: { idPlanta: Number(idPlanta), activo: true },
      include: [{ model: db.Laboratorio, as: 'laboratorio', where: { activo: true }, required: true, attributes: [] }],
      order: [['idLaboratorio', 'ASC']],
      attributes: ['idLaboratorio'],
    });
    if (link) labId = link.idLaboratorio;
  }
  if (!labId) {
    throw Object.assign(new Error('idLaboratorio requerido (o una planta con laboratorio asignado).'), { status: 422 });
  }

  // Planta principal — cache derivado del lab para listados legacy.
  const plantaCache = idPlanta ? Number(idPlanta) : await getPlantaPrincipalDeLaboratorio(db, labId);

  const reusosMaxNorma = getReusosMaxNorma(durezaShoreA);
  const tablaRow = TABLA_REUSOS.find(r => Math.abs(r.durezaShoreA - durezaShoreA) <= 5);

  const t = await db.sequelize.transaction();
  try {
    const identificacion = await siguienteIdentificacion(db, diametroMm, t);

    const placa = await db.PlacaElastomero.create({
      idLaboratorio: labId,
      idPlanta: plantaCache,
      idPrensa: null,
      fechaAlta: fechaAlta || new Date(),
      durezaShoreA,
      diametroMm,
      nivelResistenciaMin: tablaRow?.resistenciaMin || null,
      nivelResistenciaMax: tablaRow?.resistenciaMax || null,
      reusosMaxNorma,
      reusosActuales: 0,
      reusosExtendidos: 0,
      estado: 'EN_STOCK',
      marca: marca || null,
      identificacion,
      observaciones: observaciones || null,
      creadoPor: creadoPor || null,
    }, { transaction: t });

    if (control && db.ControlRecepcionPlaca) {
      const payload = _buildControlPayload({ ...control, controladoPor: control.controladoPor || creadoPor });
      await db.ControlRecepcionPlaca.create({
        idPlacaElastomero: placa.idPlacaElastomero,
        ...payload,
      }, { transaction: t });
    }

    await t.commit();
    return placa;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Crea varios juegos de una sola vez, distribuidos entre laboratorios.
 *
 * `distribucion`: array de filas `{ idLaboratorio, cantidadPG, cantidadPC }`.
 * Para cada fila se crean `cantidadPG` placas Ø150 mm y `cantidadPC` placas
 * Ø100 mm en el laboratorio indicado. Los datos comunes (marca, fecha de alta,
 * dureza Shore, observaciones) se aplican a todas. Las identificaciones se
 * asignan secuencialmente dentro de la misma transacción.
 */
const crearLoteMultiple = async (db, data) => {
  const { durezaShoreA, fechaAlta, marca, observaciones, creadoPor, distribucion } = data;
  if (!durezaShoreA) throw Object.assign(new Error('durezaShoreA requerido'), { status: 422 });
  if (!Array.isArray(distribucion) || distribucion.length === 0) {
    throw Object.assign(new Error('distribucion requerida (al menos un laboratorio).'), { status: 422 });
  }

  const reusosMaxNorma = getReusosMaxNorma(durezaShoreA);
  const tablaRow = TABLA_REUSOS.find(r => Math.abs(r.durezaShoreA - durezaShoreA) <= 5);

  // Validar y normalizar la distribución antes de abrir la transacción.
  const filas = [];
  for (const raw of distribucion) {
    const idLab = Number(raw.idLaboratorio);
    if (!idLab) throw Object.assign(new Error('idLaboratorio requerido en cada fila.'), { status: 422 });
    const cantidadPG = Math.max(0, Number(raw.cantidadPG) || 0);
    const cantidadPC = Math.max(0, Number(raw.cantidadPC) || 0);
    if (cantidadPG === 0 && cantidadPC === 0) continue;
    filas.push({ idLaboratorio: idLab, cantidadPG, cantidadPC });
  }
  if (filas.length === 0) {
    throw Object.assign(new Error('La distribución no contiene cantidades para asignar.'), { status: 422 });
  }

  const t = await db.sequelize.transaction();
  try {
    const creadas = [];
    for (const fila of filas) {
      const plantaCache = await getPlantaPrincipalDeLaboratorio(db, fila.idLaboratorio);
      const fechaAltaResolved = fechaAlta || new Date();

      for (const [diametroMm, cantidad] of [[150, fila.cantidadPG], [100, fila.cantidadPC]]) {
        for (let i = 0; i < cantidad; i++) {
          const identificacion = await siguienteIdentificacion(db, diametroMm, t);
          const placa = await db.PlacaElastomero.create({
            idLaboratorio: fila.idLaboratorio,
            idPlanta: plantaCache,
            idPrensa: null,
            fechaAlta: fechaAltaResolved,
            durezaShoreA,
            diametroMm,
            nivelResistenciaMin: tablaRow?.resistenciaMin || null,
            nivelResistenciaMax: tablaRow?.resistenciaMax || null,
            reusosMaxNorma,
            reusosActuales: 0,
            reusosExtendidos: 0,
            estado: 'EN_STOCK',
            marca: marca || null,
            identificacion,
            observaciones: observaciones || null,
            creadoPor: creadoPor || null,
          }, { transaction: t });
          creadas.push(placa.get({ plain: true }));
        }
      }
    }

    await t.commit();
    return creadas;
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * Crea o actualiza el control de recepción de una placa (1:1).
 */
const setControlRecepcion = async (db, idPlacaElastomero, data) => {
  if (!db.ControlRecepcionPlaca) {
    throw Object.assign(new Error('Modelo ControlRecepcionPlaca no disponible.'), { status: 500 });
  }
  const placa = await db.PlacaElastomero.findByPk(idPlacaElastomero);
  if (!placa) throw Object.assign(new Error('Placa no encontrada.'), { status: 404 });

  const payload = { idPlacaElastomero, ..._buildControlPayload(data) };

  const existente = await db.ControlRecepcionPlaca.findOne({ where: { idPlacaElastomero } });
  if (existente) {
    await existente.update(payload);
    return existente.get({ plain: true });
  }
  const creado = await db.ControlRecepcionPlaca.create(payload);
  return creado.get({ plain: true });
};

// ── Activar (stock → en uso, asignar a 1..N prensas del mismo laboratorio) ──

/**
 * Activa una placa asignándola a una o más prensas. Todas deben pertenecer al
 * mismo laboratorio (vía EquipoLaboratorio.idLaboratorio) y ninguna puede
 * tener otro juego EN_USO del mismo diámetro.
 *
 * Acepta `idPrensa` (string, back-compat single) o `idPrensas` (string[]).
 */
const activarEnPrensa = async (db, idPlacaElastomero, idPrensaOrArray) => {
  const placa = await db.PlacaElastomero.findByPk(idPlacaElastomero);
  if (!placa) throw Object.assign(new Error('Placa no encontrada.'), { status: 404 });
  if (placa.estado !== 'EN_STOCK') {
    throw Object.assign(new Error(`Solo se pueden activar placas EN_STOCK (actual: ${placa.estado}).`), { status: 422 });
  }

  const raw = Array.isArray(idPrensaOrArray) ? idPrensaOrArray : (idPrensaOrArray ? [idPrensaOrArray] : []);
  const idPrensas = [...new Set(raw.map(x => (x == null ? '' : String(x).trim())).filter(Boolean))];
  if (idPrensas.length === 0) {
    throw Object.assign(new Error('Debe indicar al menos una prensa.'), { status: 422 });
  }

  // Validar coherencia de laboratorio. Todas las prensas deben pertenecer al
  // mismo laboratorio entre sí Y al laboratorio de la placa (si lo tiene).
  // Si EquipoLaboratorio no está cargado (entorno legacy), aceptamos sólo
  // una prensa para no introducir riesgo de mezclar labs sin verificación.
  if (db.EquipoLaboratorio) {
    const labs = [];
    for (const nombre of idPrensas) {
      const idLab = await getIdLaboratorioDePrensa(db, nombre);
      if (!idLab) {
        throw Object.assign(
          new Error(`La prensa "${nombre}" no tiene laboratorio asignado. Asigne primero la prensa a un laboratorio.`),
          { status: 422 }
        );
      }
      labs.push(idLab);
    }
    if (new Set(labs).size > 1) {
      throw Object.assign(
        new Error('Todas las prensas deben pertenecer al mismo laboratorio.'),
        { status: 422 }
      );
    }
    if (placa.idLaboratorio && labs[0] !== placa.idLaboratorio) {
      throw Object.assign(
        new Error('Las prensas elegidas pertenecen a un laboratorio distinto del de la placa.'),
        { status: 422 }
      );
    }
  } else if (idPrensas.length > 1) {
    throw Object.assign(
      new Error('Asignación multi-prensa requiere el modelo EquipoLaboratorio.'),
      { status: 500 }
    );
  }

  // Validar que ninguna prensa tenga otro juego EN_USO con el mismo diámetro
  for (const nombre of idPrensas) {
    const existente = await getEnUsoPorPrensa(db, nombre, placa.diametroMm);
    if (existente && existente.idPlacaElastomero !== placa.idPlacaElastomero) {
      throw Object.assign(
        new Error(`Ya hay un juego Ø${placa.diametroMm} mm activo en "${nombre}" (${existente.reusosActuales}/${existente.reusosMaxNorma} usos). Dé de baja el actual antes de activar otro.`),
        { status: 422 }
      );
    }
  }

  const t = await db.sequelize.transaction();
  try {
    await placa.update(
      { estado: 'EN_USO', idPrensa: idPrensas[0], fechaActivacion: new Date() },
      { transaction: t }
    );

    if (db.PlacaElastomeroPrensa) {
      await db.PlacaElastomeroPrensa.destroy({ where: { idPlacaElastomero }, transaction: t });
      await db.PlacaElastomeroPrensa.bulkCreate(
        idPrensas.map(idPrensa => ({ idPlacaElastomero, idPrensa })),
        { transaction: t }
      );
    }

    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  const plain = placa.get({ plain: true });
  plain.prensasAsignadas = idPrensas;
  return plain;
};

// ── Registrar uso (desde ensayo de rotura) ──

const matchPlacaPorProbeta = async (db, idPrensa, diametroProbetaMm) => {
  const activas = await getActivasPorPrensa(db, idPrensa);
  if (activas.length === 0) return { placa: null, diferenciaMm: null, error: 'No hay placas activas en esta prensa.' };

  let mejor = null, mejorDiff = Infinity;
  for (const p of activas) {
    const diff = Math.abs(p.diametroMm - diametroProbetaMm);
    if (diff < mejorDiff) { mejorDiff = diff; mejor = p; }
  }

  const result = { placa: mejor, diferenciaMm: mejorDiff, alerta: null };
  if (mejorDiff > ERROR_DIAMETRO_MM) {
    result.alerta = 'error';
    result.error = `Diferencia de diámetro ${mejorDiff.toFixed(1)} mm excede ${ERROR_DIAMETRO_MM} mm. Verificar.`;
  } else if (mejorDiff > TOLERANCIA_DIAMETRO_MM) {
    result.alerta = `Diferencia de diámetro ${mejorDiff.toFixed(1)} mm superior a ${TOLERANCIA_DIAMETRO_MM} mm.`;
  }
  return result;
};

const registrarUso = async (db, idPrensa, diametroProbetaMm) => {
  const match = await matchPlacaPorProbeta(db, idPrensa, diametroProbetaMm);
  if (!match.placa) return { placa: null, estado: 'sin_placa', mensaje: match.error || 'Sin placas activas.', alerta: 'info' };
  if (match.alerta === 'error') return { placa: match.placa.get({ plain: true }), estado: 'error_diametro', mensaje: match.error, alerta: 'error' };

  const placa = match.placa;
  const limiteNorma = placa.reusosMaxNorma;
  const maxExt = Math.floor(limiteNorma * EXTENSION_MAX_PCT / 100);
  const limiteTotal = limiteNorma + placa.reusosExtendidos;

  if (placa.reusosActuales >= limiteNorma + maxExt) {
    await placa.update({ estado: 'AGOTADO', fechaBaja: new Date(), motivoBaja: 'LIMITE_ALCANZADO' });
    return { placa: placa.get({ plain: true }), estado: 'bloqueado', mensaje: `Placas Ø${placa.diametroMm} mm agotadas (${placa.reusosActuales}/${limiteNorma + maxExt}). Reemplazo obligatorio.`, alerta: 'error' };
  }

  if (placa.reusosActuales >= limiteTotal && placa.reusosExtendidos < maxExt) {
    return { placa: placa.get({ plain: true }), estado: 'necesita_extension', mensaje: `Alcanzó ${placa.reusosActuales}/${limiteTotal} usos. Extienda o reemplace.`, alerta: 'warning' };
  }

  await placa.increment('reusosActuales');
  await placa.reload();

  let estado = 'ok', mensaje = `Uso ${placa.reusosActuales}/${limiteNorma} (Ø${placa.diametroMm} mm).`, alerta = null;
  if (placa.reusosActuales >= limiteNorma && placa.reusosExtendidos === 0) {
    estado = 'alerta_limite'; alerta = 'warning';
    mensaje = `Alcanzó ${limiteNorma} usos (límite IRAM 1709). Extienda o reemplace.`;
  } else if (placa.reusosActuales > limiteNorma) {
    estado = 'extendido';
    const rest = limiteTotal - placa.reusosActuales;
    mensaje = `Uso ${placa.reusosActuales}/${limiteTotal} (extendido, ${Math.max(0, rest)} restantes).`;
    if (rest <= 5) alerta = 'warning';
  } else if (placa.reusosActuales >= limiteNorma * 0.9) {
    alerta = 'info'; mensaje += ` Próximo al límite (${limiteNorma - placa.reusosActuales} rest.).`;
  }

  const result = { placa: placa.get({ plain: true }), estado, mensaje, alerta };
  if (match.alerta && typeof match.alerta === 'string') result.alertaDiametro = match.alerta;
  return result;
};

// ── Extender uso ──

const extenderUso = async (db, idPlacaElastomero) => {
  const placa = await db.PlacaElastomero.findByPk(idPlacaElastomero);
  if (!placa) throw Object.assign(new Error('Placa no encontrada.'), { status: 404 });
  if (placa.estado !== 'EN_USO') throw Object.assign(new Error('Solo se pueden extender placas EN_USO.'), { status: 422 });

  const maxExt = Math.floor(placa.reusosMaxNorma * EXTENSION_MAX_PCT / 100);
  if (placa.reusosExtendidos >= maxExt) throw Object.assign(new Error(`Máximo de extensiones alcanzado (${maxExt}).`), { status: 422 });
  if (placa.reusosActuales < placa.reusosMaxNorma) throw Object.assign(new Error('Aún no alcanzó el límite normativo.'), { status: 422 });

  await placa.increment('reusosExtendidos');
  await placa.reload();
  return { placa: placa.get({ plain: true }), mensaje: `Extensión ${placa.reusosExtendidos}/${maxExt}. Nuevo límite: ${placa.reusosMaxNorma + placa.reusosExtendidos}.` };
};

// ── Descartar ──

const descartar = async (db, idPlacaElastomero, { motivo, observaciones } = {}) => {
  const placa = await db.PlacaElastomero.findByPk(idPlacaElastomero);
  if (!placa) throw Object.assign(new Error('Placa no encontrada.'), { status: 404 });
  if (placa.estado === 'AGOTADO' || placa.estado === 'DESCARTADO') throw Object.assign(new Error('Ya está fuera de servicio.'), { status: 422 });

  await placa.update({
    estado: 'DESCARTADO',
    fechaBaja: new Date(),
    motivoBaja: motivo || 'OTRO',
    observacionesBaja: observaciones || null,
  });
  return placa.get({ plain: true });
};

// ── Estado para formulario de ensayo ──

const getEstadoParaEnsayo = async (db, idPrensa, diametroProbetaMm) => {
  if (!idPrensa || !diametroProbetaMm) return null;
  const match = await matchPlacaPorProbeta(db, idPrensa, diametroProbetaMm);
  if (!match.placa) return { sinPlaca: true, mensaje: 'Sin placas activas para esta prensa.' };

  const p = match.placa.get ? match.placa.get({ plain: true }) : match.placa;
  const limiteNorma = p.reusosMaxNorma;
  const limiteTotal = limiteNorma + p.reusosExtendidos;
  const maxExt = Math.floor(limiteNorma * EXTENSION_MAX_PCT / 100);
  const restantes = Math.max(0, limiteTotal - p.reusosActuales);
  const pctUso = limiteNorma > 0 ? Math.round((p.reusosActuales / limiteNorma) * 100) : 0;

  let estado = 'ok';
  if (p.reusosActuales >= limiteNorma + maxExt) estado = 'bloqueado';
  else if (p.reusosActuales >= limiteTotal && p.reusosExtendidos < maxExt) estado = 'necesita_extension';
  else if (p.reusosActuales >= limiteNorma) estado = 'extendido';
  else if (pctUso >= 90) estado = 'proximo';

  return {
    placa: p, estado, pctUso, restantes, limiteNorma, limiteTotal, maxExtensiones: maxExt,
    extensionesOtorgadas: p.reusosExtendidos,
    puedeExtender: p.reusosExtendidos < maxExt && p.reusosActuales >= limiteNorma,
    debeReemplazar: estado === 'bloqueado',
    diferenciaDiametro: match.diferenciaMm,
    alertaDiametro: match.alerta || null,
  };
};

module.exports = {
  TABLA_REUSOS, EXTENSION_MAX_PCT,
  getReusosMaxNorma,
  listarTodas, listarPorLaboratorio, listarPorPlanta,
  getStock, getStockPorLaboratorio,
  getEnUsoPorPrensa, getActivasPorPrensa,
  crearJuego, crearLoteMultiple, setControlRecepcion,
  activarEnPrensa, matchPlacaPorProbeta, registrarUso, extenderUso, descartar, getEstadoParaEnsayo,
  // helpers exportados para tests
  getPrensasAsignadas, getIdLaboratorioDePrensa, getPlantaPrincipalDeLaboratorio,
  siguienteIdentificacion,
};
