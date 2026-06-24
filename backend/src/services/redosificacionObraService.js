'use strict';

/**
 * Service de acciones de agregado de materiales (ex-redosificaciones).
 *
 * Maneja el CRUD de acciones trazables aplicadas sobre un pastón o despacho:
 *   ADITIVO — dosis extra de aditivo
 *   AGUA    — agua agregada (afecta a/c)
 *   FIBRA   — fibra incorporada en obra
 *   AIRE    — ajuste de aire incorporado
 *   OTRO    — cualquier otro material
 *
 * Cada acción se vincula opcionalmente a mediciones antes/después para
 * registrar el efecto medido (delta slump, delta aire, etc.).
 */

const ALLOWED_TIPOS = ['ADITIVO', 'AGUA', 'FIBRA', 'AIRE', 'OTRO'];
const ALLOWED_UNIDADES_LEGACY = ['PCT_CEMENTO', 'CC_M3', 'G_M3', 'KG_M3'];
const ALLOWED_MODOS = [
  'AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO',
  'RETARDANTE', 'ACELERANTE_FRAGUE', 'ACELERANTE_ENDURECIMIENTO',
  'INCORPORADOR_AIRE', 'ANTICONGELANTE', 'REDUCTOR_RETRACCION',
  'EXPANSIVO', 'INHIBIDOR_CORROSION', 'VISCOSANTE',
  'IMPERMEABILIZANTE', 'FIBRAS', 'OTRO',
];
const ALLOWED_ETAPAS = ['PLANTA', 'TRANSPORTE', 'OBRA'];

function validatePayload(data, { requireAll = true } = {}) {
  const errors = [];
  const tipo = data.tipoAccion || 'ADITIVO';

  if (requireAll) {
    if (!data.motivo || String(data.motivo).trim().length < 3) {
      errors.push('motivo requerido (mínimo 3 caracteres)');
    }
    // Cantidad requerida siempre
    const cant = data.cantidad != null ? data.cantidad : data.dosis;
    if (cant == null || isNaN(Number(cant)) || Number(cant) <= 0) {
      errors.push('cantidad debe ser un número > 0');
    }
    // Para ADITIVO, idAditivo requerido
    if (tipo === 'ADITIVO' && !data.idAditivo) {
      errors.push('idAditivo requerido para tipo ADITIVO');
    }
    if (tipo === 'FIBRA' && !data.idFibra && !data.nombreMaterial) {
      errors.push('idFibra o nombreMaterial requerido para tipo FIBRA');
    }
  } else {
    if (data.motivo != null && String(data.motivo).trim().length < 3) {
      errors.push('motivo requerido (mínimo 3 caracteres)');
    }
    const cant = data.cantidad != null ? data.cantidad : data.dosis;
    if (cant != null && (isNaN(Number(cant)) || Number(cant) <= 0)) {
      errors.push('cantidad debe ser un número > 0');
    }
  }

  if (data.tipoAccion != null && !ALLOWED_TIPOS.includes(data.tipoAccion)) {
    errors.push(`tipoAccion debe ser una de: ${ALLOWED_TIPOS.join(', ')}`);
  }
  if (data.modoEfecto != null && !ALLOWED_MODOS.includes(data.modoEfecto)) {
    errors.push(`modoEfecto debe ser uno de: ${ALLOWED_MODOS.join(', ')}`);
  }
  if (data.etapa != null && !ALLOWED_ETAPAS.includes(data.etapa)) {
    errors.push(`etapa debe ser una de: ${ALLOWED_ETAPAS.join(', ')}`);
  }
  if (data.unidadDosis != null && !ALLOWED_UNIDADES_LEGACY.includes(data.unidadDosis)) {
    errors.push(`unidadDosis (legacy) debe ser una de: ${ALLOWED_UNIDADES_LEGACY.join(', ')}`);
  }
  if (errors.length > 0) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 422 });
  }
}

async function ensureDosificacion(db, idDosificacionDisenada) {
  const dosif = await db.DosificacionDisenada.findByPk(idDosificacionDisenada);
  if (!dosif) {
    throw Object.assign(new Error('Dosificación no encontrada'), { statusCode: 404 });
  }
  return dosif;
}

/** Default unit per action type */
function defaultUnidad(tipo) {
  switch (tipo) {
    case 'AGUA': return 'L';
    case 'ADITIVO': return 'cc';
    case 'FIBRA': return 'kg';
    case 'AIRE': return '%';
    default: return 'kg';
  }
}

/**
 * Mapea la `unidad` de display al ENUM legacy `unidadDosis`.
 *
 * El campo `unidadDosis` (ENUM PCT_CEMENTO/CC_M3/G_M3/KG_M3) es legacy: la
 * tabla original tenía la columna NOT NULL y nunca se hizo migration para
 * relajarlo. El frontend nuevo solo manda `unidad` como string libre, pero
 * Sequelize.create rechaza si `unidadDosis` queda null. Este helper deriva
 * el valor legacy desde la unidad de display para evitar el 500.
 */
function deriveUnidadDosisLegacy(unidad, tipoAccion) {
  const u = String(unidad || '').toLowerCase().trim();
  if (u === '%' || u === 'pct' || u.includes('porc') || u.includes('cement')) return 'PCT_CEMENTO';
  if (u === 'cc' || u === 'ml' || u.includes('cc') || u.includes('ml')) return 'CC_M3';
  if (u === 'g' || u === 'gr' || u.includes('gramo')) return 'G_M3';
  if (u === 'kg' || u === 'kgs' || u.includes('kilo')) return 'KG_M3';
  if (u === 'l' || u === 'lt' || u.includes('litro')) return 'KG_M3'; // agua: usar KG_M3 como aproximación
  // Fallback por tipo de acción
  if (tipoAccion === 'ADITIVO') return 'PCT_CEMENTO';
  return 'KG_M3';
}

/** Default efecto per action type */
function defaultModoEfecto(tipo) {
  switch (tipo) {
    case 'AGUA': return 'AUMENTO_ASENTAMIENTO';
    case 'ADITIVO': return 'AUMENTO_ASENTAMIENTO';
    case 'FIBRA': return 'FIBRAS';
    case 'AIRE': return 'INCORPORADOR_AIRE';
    default: return 'OTRO';
  }
}

/**
 * Lista todas las acciones de una dosificación.
 */
async function listar(db, idDosificacionDisenada) {
  await ensureDosificacion(db, idDosificacionDisenada);
  const includes = [];
  if (db.Aditivo) {
    includes.push({ model: db.Aditivo, as: 'aditivo', attributes: ['idAditivo', 'marca', 'tipoFuncional'] });
  }
  if (db.Fibra) {
    includes.push({ model: db.Fibra, as: 'fibra', attributes: ['idFibra', 'marca', 'tipo'], required: false });
  }
  if (db.MedicionPaston) {
    includes.push(
      { model: db.MedicionPaston, as: 'medicionAntes', attributes: ['id', 'asentamientoMm', 'aireMedidoPct', 'fechaHora', 'etapa'], required: false },
      { model: db.MedicionPaston, as: 'medicionDespues', attributes: ['id', 'asentamientoMm', 'aireMedidoPct', 'fechaHora', 'etapa'], required: false },
    );
  }
  const rows = await db.RedosificacionObra.findAll({
    where: { idDosificacionDisenada },
    include: includes,
    order: [['fecha', 'ASC'], ['id', 'ASC']],
  });
  return rows.map(r => r.get({ plain: true }));
}

/**
 * Crea una nueva acción para una dosificación.
 */
async function crear(db, idDosificacionDisenada, data, { usuario } = {}) {
  const dosif = await ensureDosificacion(db, idDosificacionDisenada);
  validatePayload(data);

  const tipo = data.tipoAccion || 'ADITIVO';

  // Validar que el material referenciado existe
  if (tipo === 'ADITIVO' && data.idAditivo && db.Aditivo) {
    const ad = await db.Aditivo.findByPk(data.idAditivo);
    if (!ad) throw Object.assign(new Error(`Aditivo ${data.idAditivo} no encontrado`), { statusCode: 422 });
  }
  if (tipo === 'FIBRA' && data.idFibra && db.Fibra) {
    const fb = await db.Fibra.findByPk(data.idFibra);
    if (!fb) throw Object.assign(new Error(`Fibra ${data.idFibra} no encontrada`), { statusCode: 422 });
  }

  const cant = data.cantidad != null ? Number(data.cantidad) : (data.dosis != null ? Number(data.dosis) : 0);

  const nueva = await db.RedosificacionObra.create({
    idDosificacionDisenada,
    tipoAccion: tipo,
    idAditivo: tipo === 'ADITIVO' ? data.idAditivo : null,
    idFibra: tipo === 'FIBRA' ? (data.idFibra || null) : null,
    nombreMaterial: data.nombreMaterial || null,
    cantidad: cant,
    unidad: data.unidad || defaultUnidad(tipo),
    // Legacy compat — la columna `unidadDosis` es legacy (ENUM) y la tabla
    // viene con NOT NULL desde el origen. Si el frontend no la manda,
    // derivamos desde la `unidad` de display para no romper el INSERT.
    dosis: data.dosis != null ? Number(data.dosis) : cant,
    unidadDosis: data.unidadDosis || deriveUnidadDosisLegacy(data.unidad, tipo),
    modoEfecto: data.modoEfecto || defaultModoEfecto(tipo),
    motivo: String(data.motivo).trim(),
    etapa: data.etapa || 'OBRA',
    // Mediciones vinculadas
    medicionAntesId: data.medicionAntesId || null,
    medicionDespuesId: data.medicionDespuesId || null,
    asentamientoAntes: data.asentamientoAntes != null ? Number(data.asentamientoAntes) : null,
    asentamientoDespues: data.asentamientoDespues != null ? Number(data.asentamientoDespues) : null,
    aireMedidoAntes: data.aireMedidoAntes != null ? Number(data.aireMedidoAntes) : null,
    aireMedidoDespues: data.aireMedidoDespues != null ? Number(data.aireMedidoDespues) : null,
    reduccionAguaPct: data.reduccionAguaPct != null ? Number(data.reduccionAguaPct) : null,
    observaciones: data.observaciones ? String(data.observaciones) : null,
    fecha: data.fecha || new Date(),
    volumenHormigonM3: data.volumenHormigonM3 != null ? Number(data.volumenHormigonM3) : null,
    pastonRefId: data.pastonRefId || null,
    despachoRefId: data.despachoRefId || null,
    usuario: usuario || data.usuario || null,
  });

  // Fase 4.1 — registrar en el historial unificado para que el timeline de
  // la dosificación muestre la acción de obra. Fail-soft.
  try {
    const { logEventoDosificacion } = require('./auditDosificacionService');
    const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
    await logEventoDosificacion(db, {
      entidadId: idDosificacionDisenada,
      tipoEvento: TIPO_EVENTO.REDOSIFICACION_OBRA,
      estadoAnterior: dosif.estado,
      estadoNuevo: dosif.estado,
      usuario: usuario || data.usuario || 'sistema',
      motivo: nueva.motivo || null,
      observaciones: `${tipo} ${nueva.cantidad ?? '-'} ${nueva.unidad || ''} en ${nueva.etapa}`.trim(),
      hashAlMomento: dosif.hashIntegridad || null,
      metadata: {
        idRedosificacion: nueva.id,
        tipoAccion: tipo,
        cantidad: Number(nueva.cantidad),
        unidad: nueva.unidad,
        etapa: nueva.etapa,
        idAditivo: nueva.idAditivo,
        idFibra: nueva.idFibra,
        nombreMaterial: nueva.nombreMaterial,
        pastonRefId: nueva.pastonRefId,
        despachoRefId: nueva.despachoRefId,
      },
    });
  } catch (e) {
    console.warn('[redosificacionObraService.crear] Error logging audit event:', e.message);
  }

  return nueva.get({ plain: true });
}

/**
 * Actualiza una acción existente.
 */
async function actualizar(db, id, data, { usuario } = {}) {
  const row = await db.RedosificacionObra.findByPk(id);
  if (!row) throw Object.assign(new Error('Acción no encontrada'), { statusCode: 404 });
  validatePayload(data, { requireAll: false });

  // Snapshot pre-update para diff de auditoría
  const previo = row.get({ plain: true });

  const updates = {};
  const fields = [
    'tipoAccion', 'idAditivo', 'idFibra', 'nombreMaterial',
    'cantidad', 'unidad', 'dosis', 'unidadDosis',
    'modoEfecto', 'motivo', 'etapa',
    'medicionAntesId', 'medicionDespuesId',
    'asentamientoAntes', 'asentamientoDespues',
    'aireMedidoAntes', 'aireMedidoDespues',
    'reduccionAguaPct',
    'observaciones', 'fecha', 'volumenHormigonM3',
    'pastonRefId', 'despachoRefId',
  ];
  for (const f of fields) {
    if (data[f] !== undefined) updates[f] = data[f];
  }
  if (updates.motivo != null) updates.motivo = String(updates.motivo).trim();
  if (updates.cantidad != null) updates.cantidad = Number(updates.cantidad);
  if (updates.dosis != null) updates.dosis = Number(updates.dosis);

  await row.update(updates);

  // Fase 4.1 — auditar la edición en el timeline (con diff de campos cambiados).
  try {
    const cambios = {};
    for (const k of Object.keys(updates)) {
      if (previo[k] !== updates[k]) cambios[k] = { antes: previo[k], despues: updates[k] };
    }
    if (Object.keys(cambios).length > 0) {
      const { logEventoDosificacion } = require('./auditDosificacionService');
      const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
      await logEventoDosificacion(db, {
        entidadId: row.idDosificacionDisenada,
        tipoEvento: TIPO_EVENTO.REDOSIFICACION_OBRA,
        usuario: usuario || data.usuario || 'sistema',
        observaciones: `Edición de redosificación #${row.id}`,
        metadata: {
          idRedosificacion: row.id,
          accion: 'editar',
          cambios,
        },
      });
    }
  } catch (e) {
    console.warn('[redosificacionObraService.actualizar] Error logging audit event:', e.message);
  }

  return row.get({ plain: true });
}

/**
 * Elimina una acción.
 */
async function eliminar(db, id, { usuario } = {}) {
  const row = await db.RedosificacionObra.findByPk(id);
  if (!row) throw Object.assign(new Error('Acción no encontrada'), { statusCode: 404 });

  // Snapshot antes de destroy para que la auditoría preserve qué se borró.
  const previo = row.get({ plain: true });
  const idDosif = row.idDosificacionDisenada;

  await row.destroy();

  // Fase 4.1 — registrar la eliminación en el timeline.
  try {
    const { logEventoDosificacion } = require('./auditDosificacionService');
    const { TIPO_EVENTO } = require('../domain/dosificacion/historialEventos');
    await logEventoDosificacion(db, {
      entidadId: idDosif,
      tipoEvento: TIPO_EVENTO.REDOSIFICACION_OBRA,
      usuario: usuario || 'sistema',
      observaciones: `Eliminación de redosificación #${id} (${previo.tipoAccion} ${previo.cantidad ?? '-'} ${previo.unidad || ''})`.trim(),
      metadata: {
        idRedosificacion: id,
        accion: 'eliminar',
        accionEliminada: {
          tipoAccion: previo.tipoAccion,
          cantidad: previo.cantidad,
          unidad: previo.unidad,
          etapa: previo.etapa,
          motivo: previo.motivo,
          idAditivo: previo.idAditivo,
          idFibra: previo.idFibra,
        },
      },
    });
  } catch (e) {
    console.warn('[redosificacionObraService.eliminar] Error logging audit event:', e.message);
  }

  return { ok: true, id };
}

module.exports = {
  listar,
  crear,
  actualizar,
  eliminar,
  ALLOWED_TIPOS,
  ALLOWED_MODOS,
  ALLOWED_ETAPAS,
};
