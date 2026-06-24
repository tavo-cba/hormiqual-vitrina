'use strict';

/**
 * medicionPastonService.js (Fase 2B)
 *
 * CRUD de mediciones seriadas dentro de un pastón. Un pastón de prueba tiene
 * múltiples muestras tomadas en distintos momentos (planta / transporte /
 * obra) con sus valores de slump, temperatura y observaciones. Esta tabla
 * modela esa serie temporal.
 *
 * No confundir con ajustes: los ajustes de dosis (p.ej. +6 kg de W351R
 * pre-salida) se cargan en `RedosificacionObra`, que ahora acepta
 * etapa = PLANTA | TRANSPORTE | OBRA.
 */

const ETAPAS = ['PLANTA', 'TRANSPORTE', 'OBRA'];

function validarPayload(data, { requireAll = true } = {}) {
  const errors = [];
  if (requireAll && !data.idPastonPrueba) {
    errors.push('idPastonPrueba requerido');
  }
  if (data.etapa != null && !ETAPAS.includes(data.etapa)) {
    errors.push(`etapa debe ser una de: ${ETAPAS.join(', ')}`);
  }
  if (data.asentamientoMm != null) {
    const v = Number(data.asentamientoMm);
    if (!Number.isFinite(v) || v < 0 || v > 350) {
      errors.push('asentamientoMm fuera de rango razonable (0-350 mm)');
    }
  }
  if (data.temperaturaHormigonC != null) {
    const v = Number(data.temperaturaHormigonC);
    if (!Number.isFinite(v) || v < -5 || v > 80) {
      errors.push('temperaturaHormigonC fuera de rango razonable');
    }
  }
  if (data.temperaturaAmbienteC != null) {
    const v = Number(data.temperaturaAmbienteC);
    if (!Number.isFinite(v) || v < -30 || v > 60) {
      errors.push('temperaturaAmbienteC fuera de rango razonable');
    }
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 422 });
  }
}

async function ensurePaston(db, idPastonPrueba) {
  const p = await db.PastonPrueba.findByPk(idPastonPrueba);
  if (!p) throw Object.assign(new Error('Pastón no encontrado'), { statusCode: 404 });
  return p;
}

/**
 * Espeja la Medición #1 (ordenSecuencia === 1) sobre los campos legacy de
 * PastonPrueba. Lo hacemos después de cada create/update/delete que afecte
 * a la primera medición para que PDFs, dashboards y la fila resumen de
 * "Pastones registrados" (que leen los campos legacy de PastonPrueba) sigan
 * mostrando los mismos valores que el timeline. El comentario en el modelo
 * `PastonPrueba.js:60-74` lo describe explícitamente como back-compat:
 * los campos legacy "quedan poblados como mirror de la primera medición".
 *
 * Convenciones de unidades:
 *   MedicionPaston.asentamientoMm (mm) → PastonPrueba.asentamientoMedido (cm)
 *   MedicionPaston.temperaturaHormigonC → PastonPrueba.temperaturaHormigon
 *   MedicionPaston.temperaturaAmbienteC → PastonPrueba.temperaturaAmbiente
 *   MedicionPaston.aireMedidoPct        → PastonPrueba.aireMedido
 *   MedicionPaston.aspecto              → PastonPrueba.aspecto
 *
 * Si la Medición #1 ya no existe (porque se borró), limpia los campos legacy.
 */
async function _mirrorBaseAPaston(db, idPastonPrueba) {
  const base = await db.MedicionPaston.findOne({
    where: { idPastonPrueba, ordenSecuencia: 1 },
    order: [['fechaHora', 'ASC'], ['id', 'ASC']],
  });
  const updates = {
    asentamientoMedido: base?.asentamientoMm != null ? Number(base.asentamientoMm) / 10 : null,
    temperaturaHormigon: base?.temperaturaHormigonC != null ? Number(base.temperaturaHormigonC) : null,
    temperaturaAmbiente: base?.temperaturaAmbienteC != null ? Number(base.temperaturaAmbienteC) : null,
    aireMedido: base?.aireMedidoPct != null ? Number(base.aireMedidoPct) : null,
    aspecto: base?.aspecto || null,
  };
  await db.PastonPrueba.update(updates, { where: { idPastonPrueba } });
}

async function listar(db, idPastonPrueba) {
  await ensurePaston(db, idPastonPrueba);
  const rows = await db.MedicionPaston.findAll({
    where: { idPastonPrueba },
    order: [['ordenSecuencia', 'ASC'], ['fechaHora', 'ASC'], ['id', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
}

async function crear(db, idPastonPrueba, data, { usuario } = {}) {
  await ensurePaston(db, idPastonPrueba);
  validarPayload({ ...data, idPastonPrueba });

  // Validación del timeline (sesión 2026-06-12): orden cronológico inter-etapa
  // y remanente monotónicamente decreciente. El engine es puro y vive en
  // `domain/dosificacion/pastonTimelineEngine`.
  const { validarEvento } = require('../domain/dosificacion/pastonTimelineEngine');
  const eventosExistentes = await db.MedicionPaston.findAll({
    where: { idPastonPrueba },
    attributes: ['id', 'etapa', 'fechaHora', 'volumenRemanenteM3', 'ordenSecuencia'],
    raw: true,
  });
  const errTimeline = validarEvento(eventosExistentes, {
    etapa: data.etapa || 'PLANTA',
    fechaHora: data.fechaHora || new Date(),
    volumenRemanenteM3: data.volumenRemanenteM3 ?? null,
  });
  if (errTimeline) {
    throw Object.assign(new Error(errTimeline.mensaje), { statusCode: 422, campo: errTimeline.campo });
  }

  // Si no viene ordenSecuencia, lo calculamos como último + 1
  let orden = data.ordenSecuencia;
  if (orden == null) {
    const ultima = await db.MedicionPaston.findOne({
      where: { idPastonPrueba },
      order: [['ordenSecuencia', 'DESC']],
    });
    orden = (ultima?.ordenSecuencia || 0) + 1;
  }

  const nueva = await db.MedicionPaston.create({
    idPastonPrueba,
    ordenSecuencia: Number(orden),
    etiqueta: data.etiqueta ? String(data.etiqueta).trim() : null,
    etapa: data.etapa || 'PLANTA',
    fechaHora: data.fechaHora || new Date(),
    asentamientoMm: data.asentamientoMm != null ? Number(data.asentamientoMm) : null,
    temperaturaHormigonC: data.temperaturaHormigonC != null ? Number(data.temperaturaHormigonC) : null,
    temperaturaAmbienteC: data.temperaturaAmbienteC != null ? Number(data.temperaturaAmbienteC) : null,
    aireMedidoPct: data.aireMedidoPct != null ? Number(data.aireMedidoPct) : null,
    probetasMoldeadas: data.probetasMoldeadas != null ? Number(data.probetasMoldeadas) : null,
    aspecto: data.aspecto ? String(data.aspecto).trim() : null,
    aguaAgregadaLts: data.aguaAgregadaLts != null ? Number(data.aguaAgregadaLts) : null,
    aditivoAgregadoNombre: data.aditivoAgregadoNombre ? String(data.aditivoAgregadoNombre).trim() : null,
    aditivoAgregadoCantidad: data.aditivoAgregadoCantidad != null ? Number(data.aditivoAgregadoCantidad) : null,
    aditivoAgregadoUnidad: data.aditivoAgregadoUnidad ? String(data.aditivoAgregadoUnidad).trim() : null,
    aditivosAgregadosJson: Array.isArray(data.aditivosAgregadosJson) ? data.aditivosAgregadosJson : null,
    volumenRemanenteM3: data.volumenRemanenteM3 != null ? Number(data.volumenRemanenteM3) : null,
    aguaRetenidaLts: data.aguaRetenidaLts != null ? Number(data.aguaRetenidaLts) : null,
    aditivoRetenidoNombre: data.aditivoRetenidoNombre ? String(data.aditivoRetenidoNombre).trim() : null,
    aditivoRetenidoCantidad: data.aditivoRetenidoCantidad != null ? Number(data.aditivoRetenidoCantidad) : null,
    aditivoRetenidoUnidad: data.aditivoRetenidoUnidad ? String(data.aditivoRetenidoUnidad).trim() : null,
    aditivosRetenidosJson: Array.isArray(data.aditivosRetenidosJson) ? data.aditivosRetenidosJson : null,
    fibrasRetenidasJson: Array.isArray(data.fibrasRetenidasJson) ? data.fibrasRetenidasJson : null,
    observacion: data.observacion ? String(data.observacion) : null,
    usuario: usuario || data.usuario || null,
  });
  if (Number(orden) === 1) {
    await _mirrorBaseAPaston(db, idPastonPrueba);
  }
  return nueva.get({ plain: true });
}

async function actualizar(db, id, data) {
  const row = await db.MedicionPaston.findByPk(id);
  if (!row) throw Object.assign(new Error('Medición no encontrada'), { statusCode: 404 });
  validarPayload(data, { requireAll: false });

  const updates = {};
  const fields = [
    'ordenSecuencia', 'etiqueta', 'etapa', 'fechaHora',
    'asentamientoMm', 'temperaturaHormigonC', 'temperaturaAmbienteC',
    'aireMedidoPct', 'probetasMoldeadas', 'aspecto',
    'aguaAgregadaLts', 'aditivoAgregadoNombre', 'aditivoAgregadoCantidad', 'aditivoAgregadoUnidad', 'aditivosAgregadosJson',
    'volumenRemanenteM3',
    'aguaRetenidaLts', 'aditivoRetenidoNombre', 'aditivoRetenidoCantidad', 'aditivoRetenidoUnidad',
    'aditivosRetenidosJson', 'fibrasRetenidasJson',
    'observacion',
  ];
  for (const f of fields) {
    if (data[f] !== undefined) updates[f] = data[f];
  }
  if (updates.etiqueta != null) updates.etiqueta = String(updates.etiqueta).trim();

  const ordenPrev = Number(row.ordenSecuencia);
  await row.update(updates);
  const ordenPost = Number(row.ordenSecuencia);
  if (ordenPrev === 1 || ordenPost === 1) {
    await _mirrorBaseAPaston(db, row.idPastonPrueba);
  }
  return row.get({ plain: true });
}

async function eliminar(db, id) {
  const row = await db.MedicionPaston.findByPk(id);
  if (!row) throw Object.assign(new Error('Medición no encontrada'), { statusCode: 404 });
  const idPastonPrueba = row.idPastonPrueba;
  const eraBase = Number(row.ordenSecuencia) === 1;
  await row.destroy();
  if (eraBase) {
    await _mirrorBaseAPaston(db, idPastonPrueba);
  }
  return { ok: true, id };
}

/**
 * Devuelve los eventos del timeline ordenados + enriquecidos con acumulados
 * y a/c efectivo calculados por `pastonTimelineEngine`. Requiere los datos
 * base del pastón (cementoKgM3, aguaInicialLts, volumenTotalM3) que se
 * derivan de la dosificación + volumen adoptado.
 */
async function listarTimeline(db, idPastonPrueba, baseDatos = {}) {
  const eventos = await listar(db, idPastonPrueba);
  const { calcularAcumulados } = require('../domain/dosificacion/pastonTimelineEngine');
  return calcularAcumulados(eventos, baseDatos);
}

module.exports = {
  listar,
  listarTimeline,
  crear,
  actualizar,
  eliminar,
  ETAPAS,
};
