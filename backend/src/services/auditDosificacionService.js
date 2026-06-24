'use strict';

/**
 * Helper centralizado para escribir eventos de auditoría sobre Dosificación
 * en la tabla `DisenoHistorial`.
 *
 * Justificación: las llamadas inline a `db.DisenoHistorial.create({...})`
 * estaban repartidas en `dosificacionDisenoService.js` (líneas 1647, 2208,
 * 2304, 3171) y faltaban completamente en otros paths críticos
 * (`aplicarCorrecciones`, `redosificacionObraService.crear`,
 * `alertasMaterialService.resolverAlerta`). Centralizar acá:
 *   - Garantiza shape consistente de los registros.
 *   - Hace fácil agregar campos transversales (timezone, metadata.flags).
 *   - Previene typos en `tipoEvento` (validación contra el catálogo).
 *   - Evita que un fallo de auditoría rompa la transacción de negocio.
 *
 * Multi-tenant: este helper recibe `db` por parámetro. NO importa la conexión
 * global. Si `db.DisenoHistorial` no existe (tenant viejo sin la tabla
 * migrada), no falla — registra una advertencia y devuelve `null`.
 */

const {
  TIPO_EVENTO,
  esTipoEventoConocido,
} = require('../domain/dosificacion/historialEventos');
const { calcularHashCadena } = require('../domain/dosificacion/hashCadenaEventos');

/**
 * Escribe un evento de auditoría sobre una dosificación.
 *
 * @param {Object} db - Instancia de Sequelize del tenant (`req.db`).
 * @param {Object} payload
 * @param {number} payload.entidadId - ID de la dosificación afectada.
 * @param {string} payload.tipoEvento - Uno de los valores de `TIPO_EVENTO`.
 * @param {string} [payload.estadoAnterior] - Estado previo (si aplica).
 * @param {string} [payload.estadoNuevo] - Estado posterior (si aplica).
 * @param {string} [payload.usuario] - Username/displayName del autor. Si falta, 'sistema'.
 * @param {string} [payload.motivo] - Motivo declarado por el usuario.
 * @param {string} [payload.observaciones] - Notas libres.
 * @param {string} [payload.hashAlMomento] - SHA-256 del contenido al momento del evento.
 * @param {Object} [payload.metadata] - JSON estructurado adicional. Puede contener
 *                                       `flags`, `autoAprobacion`, `bypassRevision`,
 *                                       `cambios`, `versionAnterior`, etc.
 * @returns {Promise<Object|null>} El registro creado, o `null` si no pudo escribirse.
 */
async function logEventoDosificacion(db, payload = {}) {
  if (!db || !db.DisenoHistorial) {
    console.warn('[auditDosificacion] db.DisenoHistorial no disponible — evento descartado.');
    return null;
  }

  const {
    entidadId,
    tipoEvento,
    estadoAnterior = null,
    estadoNuevo = null,
    usuario,
    motivo = null,
    observaciones = null,
    hashAlMomento = null,
    metadata = null,
  } = payload;

  if (!entidadId || !Number.isFinite(Number(entidadId))) {
    console.warn('[auditDosificacion] entidadId inválido — evento descartado:', entidadId);
    return null;
  }
  if (!tipoEvento) {
    console.warn('[auditDosificacion] tipoEvento requerido — evento descartado.');
    return null;
  }
  if (!esTipoEventoConocido(tipoEvento)) {
    // Permitido pero advertido: tenants legacy pueden escribir tipos ad-hoc.
    // No abortamos para no romper backward-compat de scripts existentes.
    console.warn(`[auditDosificacion] tipoEvento "${tipoEvento}" no está en el catálogo canónico.`);
  }

  try {
    // Fase 4.4 — calcular hashCadena encadenando con el último evento de
    // la misma entidad. Si la lookup del previo falla, persistimos sin
    // hashCadena (fail-soft) y queda como evento legacy en la cadena.
    let hashCadena = null;
    try {
      const ultimoConCadena = await db.DisenoHistorial.findOne({
        where: { entidadTipo: 'dosificacion', entidadId: Number(entidadId) },
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        attributes: ['hashCadena'],
      });
      const hashCadenaPrevio = ultimoConCadena?.hashCadena || null;
      const evtParaHash = {
        entidadTipo: 'dosificacion',
        entidadId: Number(entidadId),
        tipoEvento,
        estadoAnterior,
        estadoNuevo,
        usuario: usuario || 'sistema',
        motivo,
        observaciones,
        hashAlMomento,
        metadata,
      };
      hashCadena = calcularHashCadena(evtParaHash, hashCadenaPrevio);
    } catch (e) {
      console.warn('[auditDosificacion] No se pudo calcular hashCadena:', e.message);
    }

    const row = await db.DisenoHistorial.create({
      entidadTipo: 'dosificacion',
      entidadId: Number(entidadId),
      tipoEvento,
      estadoAnterior,
      estadoNuevo,
      usuario: usuario || 'sistema',
      motivo,
      observaciones,
      hashAlMomento,
      metadata,
      hashCadena,
    });
    return row;
  } catch (err) {
    // No propagamos: la auditoría no debe romper la operación de negocio.
    // El caller decide si vale la pena reintentar.
    console.error('[auditDosificacion] Error registrando evento:', err.message);
    return null;
  }
}

/**
 * Atajo: registra una transición de estado. Mapea `nuevoEstado` a un
 * `tipoEvento` específico cuando aplica (aprobacion, suspension, archivado),
 * o cae a `cambio_estado` genérico.
 *
 * Replica el `tipoEventoMap` que estaba inline en `dosificacionDisenoService`
 * para que las migraciones del Fase 4 no cambien la semántica de los logs
 * históricos.
 */
function tipoEventoParaEstadoNuevo(nuevoEstado) {
  switch (nuevoEstado) {
    case 'EN_PRODUCCION':
    case 'APROBADO': // legacy
      return TIPO_EVENTO.APROBACION;
    case 'SUSPENDIDO':
      return TIPO_EVENTO.SUSPENSION;
    case 'ARCHIVADO':
      return TIPO_EVENTO.ARCHIVADO;
    default:
      return TIPO_EVENTO.CAMBIO_ESTADO;
  }
}

async function logTransicion(db, {
  entidadId,
  estadoAnterior,
  estadoNuevo,
  usuario,
  motivo,
  observaciones,
  hashAlMomento,
  metadata,
} = {}) {
  return logEventoDosificacion(db, {
    entidadId,
    tipoEvento: tipoEventoParaEstadoNuevo(estadoNuevo),
    estadoAnterior,
    estadoNuevo,
    usuario,
    motivo,
    observaciones,
    hashAlMomento,
    metadata,
  });
}

module.exports = {
  logEventoDosificacion,
  logTransicion,
  tipoEventoParaEstadoNuevo,
};
