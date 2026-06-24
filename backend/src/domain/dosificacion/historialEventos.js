'use strict';

/**
 * Catálogo canónico de tipos de evento que se persisten en `DisenoHistorial`
 * para entidades del ciclo de vida de Dosificación.
 *
 * Este módulo es **engine puro**: no importa Sequelize, no toca DB, no accede
 * a `req`. Solo declara constantes y helpers de clasificación que pueden ser
 * usados desde services/controllers y testeados aisladamente.
 *
 * Filosofía (decisión 2026-05-01): el sistema NO bloquea concentraciones de
 * responsabilidad ni auto-aprobaciones. Las registra como eventos destacados
 * para que la auditoría humana pueda evaluarlas según el contexto del tenant
 * (planta chica con 1 persona vs. organización formal con separación dura).
 */

const TIPO_EVENTO = Object.freeze({
  // Ciclo de vida del diseño
  CREACION:           'creacion',
  MODIFICACION:       'modificacion',
  CALCULO:            'calculo',
  CAMBIO_ESTADO:      'cambio_estado',
  APROBACION:         'aprobacion',
  RECHAZO:            'rechazo',
  SUSPENSION:         'suspension',
  REACTIVACION:       'reactivacion',
  ARCHIVADO:          'archivado',
  NUEVA_VERSION:      'nueva_version',
  NUEVA_RONDA_PRUEBA: 'nueva_ronda_prueba',

  // Acciones técnicas con impacto en producción (Fase 4)
  CORRECCION_APLICADA:  'correccion_aplicada',
  REDOSIFICACION_OBRA:  'redosificacion_obra',
  ALERTA_RESUELTA:      'alerta_resuelta',
  OVERRIDE_PASTON:      'override_paston',
  // Ajuste manual de cemento en el diseño (sesión 2026-06-11). El tecnólogo
  // adopta un valor distinto al calculado por el motor; queda trazado con
  // motivo + delta + nuevo a/c.
  AJUSTE_CEMENTO_MANUAL: 'ajuste_cemento_manual',
});

const TIPOS_EVENTO_LIST = Object.values(TIPO_EVENTO);

/**
 * Categoría visual para el timeline. Permite filtrar/colorear el feed sin
 * tener que enumerar todos los `tipoEvento` en el frontend.
 */
const CATEGORIA = Object.freeze({
  ESTADO:    'estado',     // transiciones de estado del workflow
  TECNICO:   'tecnico',    // acciones que cambian datos técnicos (corrección, override)
  OBRA:      'obra',       // eventos generados desde campo (redosificación)
  AUDITORIA: 'auditoria',  // eventos puramente informativos (alertas, modif. metadata)
});

const TIPO_A_CATEGORIA = Object.freeze({
  [TIPO_EVENTO.CREACION]:           CATEGORIA.ESTADO,
  [TIPO_EVENTO.MODIFICACION]:       CATEGORIA.AUDITORIA,
  [TIPO_EVENTO.CALCULO]:            CATEGORIA.AUDITORIA,
  [TIPO_EVENTO.CAMBIO_ESTADO]:      CATEGORIA.ESTADO,
  [TIPO_EVENTO.APROBACION]:         CATEGORIA.ESTADO,
  [TIPO_EVENTO.RECHAZO]:            CATEGORIA.ESTADO,
  [TIPO_EVENTO.SUSPENSION]:         CATEGORIA.ESTADO,
  [TIPO_EVENTO.REACTIVACION]:       CATEGORIA.ESTADO,
  [TIPO_EVENTO.ARCHIVADO]:          CATEGORIA.ESTADO,
  [TIPO_EVENTO.NUEVA_VERSION]:      CATEGORIA.ESTADO,
  [TIPO_EVENTO.NUEVA_RONDA_PRUEBA]: CATEGORIA.ESTADO,
  [TIPO_EVENTO.CORRECCION_APLICADA]: CATEGORIA.TECNICO,
  [TIPO_EVENTO.REDOSIFICACION_OBRA]: CATEGORIA.OBRA,
  [TIPO_EVENTO.ALERTA_RESUELTA]:     CATEGORIA.AUDITORIA,
  [TIPO_EVENTO.OVERRIDE_PASTON]:     CATEGORIA.TECNICO,
  [TIPO_EVENTO.AJUSTE_CEMENTO_MANUAL]: CATEGORIA.TECNICO,
});

/**
 * Devuelve la categoría visual de un `tipoEvento`. Si el tipo no está
 * catalogado (datos legacy), devuelve `auditoria` como fallback seguro.
 */
function categorizar(tipoEvento) {
  return TIPO_A_CATEGORIA[tipoEvento] || CATEGORIA.AUDITORIA;
}

/**
 * Verifica si un valor es un tipo de evento conocido. Útil para validar
 * payloads de logs externos o migraciones de datos.
 */
function esTipoEventoConocido(tipoEvento) {
  return TIPOS_EVENTO_LIST.includes(tipoEvento);
}

/**
 * Eventos que por su naturaleza deben resaltarse en la UI de auditoría
 * (override de pastón, auto-aprobación, bypass) — el frontend usa este
 * helper junto con `metadata.flags` para colorear el timeline.
 */
function esEventoDestacable(tipoEvento, metadata) {
  if (tipoEvento === TIPO_EVENTO.OVERRIDE_PASTON) return true;
  if (metadata && typeof metadata === 'object') {
    if (metadata.autoAprobacion === true) return true;
    if (metadata.bypassRevision === true) return true;
    if (Array.isArray(metadata.flags) && metadata.flags.length > 0) return true;
  }
  return false;
}

module.exports = {
  TIPO_EVENTO,
  TIPOS_EVENTO_LIST,
  CATEGORIA,
  categorizar,
  esTipoEventoConocido,
  esEventoDestacable,
};
