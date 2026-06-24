'use strict';

/**
 * Helpers de presentación para el timeline de Dosificación (Fase 4).
 *
 * Engine puro: NO toca DB, NO importa Sequelize, NO accede a `req`.
 * Recibe registros crudos de `DisenoHistorial` (planos) y los enriquece
 * para que el frontend pueda renderizar el timeline sin tener que conocer
 * el shape interno de cada `tipoEvento`.
 *
 * Filosofía Fase 4: el timeline es la herramienta de control central. El
 * sistema permite todo el flujo (incluida concentración de responsabilidad)
 * y deja registro destacado para que el auditor humano lo evalúe.
 */

const {
  TIPO_EVENTO,
  CATEGORIA,
  categorizar,
  esEventoDestacable,
} = require('./historialEventos');

/**
 * Etiqueta humana por tipo de evento. Estable — el frontend depende del
 * texto literal para mostrar el feed. Si querés cambiar el copy, hacelo
 * acá; si querés agregar un tipo nuevo, agregá también la entrada.
 */
const ETIQUETA_TIPO = Object.freeze({
  [TIPO_EVENTO.CREACION]:           'Creación',
  [TIPO_EVENTO.MODIFICACION]:       'Modificación',
  [TIPO_EVENTO.CALCULO]:            'Cálculo',
  [TIPO_EVENTO.CAMBIO_ESTADO]:      'Cambio de estado',
  [TIPO_EVENTO.APROBACION]:         'Aprobación',
  [TIPO_EVENTO.RECHAZO]:            'Rechazo',
  [TIPO_EVENTO.SUSPENSION]:         'Suspensión',
  [TIPO_EVENTO.REACTIVACION]:       'Reactivación',
  [TIPO_EVENTO.ARCHIVADO]:          'Archivado',
  [TIPO_EVENTO.NUEVA_VERSION]:      'Nueva versión',
  [TIPO_EVENTO.NUEVA_RONDA_PRUEBA]: 'Nueva ronda de prueba',
  [TIPO_EVENTO.CORRECCION_APLICADA]: 'Corrección aplicada',
  [TIPO_EVENTO.REDOSIFICACION_OBRA]: 'Redosificación en obra',
  [TIPO_EVENTO.ALERTA_RESUELTA]:     'Alerta resuelta',
  [TIPO_EVENTO.OVERRIDE_PASTON]:     'Override de pastón',
});

/**
 * Configuración visual sugerida (icono Font Awesome + color hex). El
 * frontend puede usar esto directamente o mapearlo a su propio sistema
 * de design tokens. Mantener en domain para que tests y reportes PDF
 * puedan reusar la misma fuente de verdad.
 */
const CONFIG_VISUAL = Object.freeze({
  [TIPO_EVENTO.CREACION]:           { icon: 'fa-solid fa-plus',           color: '#2196F3' },
  [TIPO_EVENTO.MODIFICACION]:       { icon: 'fa-solid fa-pen',            color: '#FF9800' },
  [TIPO_EVENTO.CALCULO]:            { icon: 'fa-solid fa-calculator',     color: '#9C27B0' },
  [TIPO_EVENTO.CAMBIO_ESTADO]:      { icon: 'fa-solid fa-arrows-rotate',  color: '#607D8B' },
  [TIPO_EVENTO.APROBACION]:         { icon: 'fa-solid fa-check-circle',   color: '#4CAF50' },
  [TIPO_EVENTO.RECHAZO]:            { icon: 'fa-solid fa-times-circle',   color: '#F44336' },
  [TIPO_EVENTO.SUSPENSION]:         { icon: 'fa-solid fa-pause-circle',   color: '#F44336' },
  [TIPO_EVENTO.REACTIVACION]:       { icon: 'fa-solid fa-play-circle',    color: '#4CAF50' },
  [TIPO_EVENTO.ARCHIVADO]:          { icon: 'fa-solid fa-archive',        color: '#9E9E9E' },
  [TIPO_EVENTO.NUEVA_VERSION]:      { icon: 'fa-solid fa-code-branch',    color: '#00BCD4' },
  [TIPO_EVENTO.NUEVA_RONDA_PRUEBA]: { icon: 'fa-solid fa-rotate-right',   color: '#3F51B5' },
  [TIPO_EVENTO.CORRECCION_APLICADA]: { icon: 'fa-solid fa-screwdriver-wrench', color: '#FF7043' },
  [TIPO_EVENTO.REDOSIFICACION_OBRA]: { icon: 'fa-solid fa-truck-droplet',     color: '#795548' },
  [TIPO_EVENTO.ALERTA_RESUELTA]:     { icon: 'fa-solid fa-bell-slash',         color: '#9E9E9E' },
  [TIPO_EVENTO.OVERRIDE_PASTON]:     { icon: 'fa-solid fa-shield-halved',      color: '#E91E63' },
});

const DEFAULT_VISUAL = { icon: 'fa-solid fa-circle', color: '#607D8B' };

/**
 * Devuelve la etiqueta legible de un tipoEvento. Si no está catalogado
 * (legacy o tipo nuevo no agregado al diccionario), cae al texto crudo
 * del tipoEvento como mejor esfuerzo.
 */
function etiquetarTipo(tipoEvento) {
  return ETIQUETA_TIPO[tipoEvento] || (tipoEvento ? String(tipoEvento) : 'Evento');
}

function visualPara(tipoEvento) {
  return CONFIG_VISUAL[tipoEvento] || DEFAULT_VISUAL;
}

/**
 * Enriquece un registro plano de `DisenoHistorial` para el timeline.
 *
 * - Calcula categoría visual (estado/tecnico/obra/auditoria).
 * - Etiqueta humana por tipo.
 * - Marca `destacado` cuando hay flags de auto-aprobación, override de
 *   pastón, bypass o cualquier metadata.flags no vacía.
 * - Trunca el hashAlMomento a 16 caracteres en `hashAlMomentoCorto` para
 *   mostrar en UI sin exponer todo el SHA-256.
 *
 * @param {Object} row - registro de DisenoHistorial (plain object).
 * @returns {Object} TimelineEvento.
 */
function enriquecerEvento(row) {
  if (!row) return null;
  const tipoEvento = row.tipoEvento || TIPO_EVENTO.CAMBIO_ESTADO;
  const categoria = categorizar(tipoEvento);
  const visual = visualPara(tipoEvento);
  const destacado = esEventoDestacable(tipoEvento, row.metadata);
  const hash = row.hashAlMomento || null;

  return {
    id: row.id,
    timestamp: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : (row.createdAt || null),
    tipoEvento,
    categoria,
    label: etiquetarTipo(tipoEvento),
    icon: visual.icon,
    color: visual.color,
    estadoAnterior: row.estadoAnterior || null,
    estadoNuevo: row.estadoNuevo || null,
    usuario: row.usuario || null,
    motivo: row.motivo || null,
    observaciones: row.observaciones || null,
    hashAlMomento: hash,
    hashAlMomentoCorto: hash ? hash.substring(0, 16) : null,
    metadata: row.metadata || null,
    destacado,
  };
}

/**
 * Enriquece una lista completa de eventos. Mantiene el orden de entrada
 * (la query del service ya ordena por createdAt ASC).
 */
function enriquecerLista(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(enriquecerEvento).filter(Boolean);
}

/**
 * Resumen agregado para mostrar arriba del timeline: contadores por
 * categoría y por flags destacables. Útil para badges en el header del
 * panel y para que el auditor pueda detectar concentraciones de un
 * vistazo sin scrollear todos los eventos.
 */
function resumirEventos(eventos) {
  const lista = Array.isArray(eventos) ? eventos : [];
  const porCategoria = { estado: 0, tecnico: 0, obra: 0, auditoria: 0 };
  let destacados = 0;
  let autoAprobaciones = 0;
  let overrides = 0;

  for (const e of lista) {
    if (e.categoria && porCategoria[e.categoria] != null) porCategoria[e.categoria] += 1;
    if (e.destacado) destacados += 1;
    if (e.metadata?.autoAprobacion === true) autoAprobaciones += 1;
    if (e.tipoEvento === TIPO_EVENTO.OVERRIDE_PASTON) overrides += 1;
  }

  return {
    total: lista.length,
    porCategoria,
    destacados,
    autoAprobaciones,
    overrides,
  };
}

module.exports = {
  ETIQUETA_TIPO,
  CONFIG_VISUAL,
  CATEGORIA,
  etiquetarTipo,
  visualPara,
  enriquecerEvento,
  enriquecerLista,
  resumirEventos,
};
