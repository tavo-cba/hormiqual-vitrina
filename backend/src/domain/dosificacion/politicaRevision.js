'use strict';

/**
 * Política de revisión y clasificación de transiciones (Fase 2).
 *
 * Engine puro: NO toca DB, NO importa Sequelize, NO accede a `req`. Recibe
 * un snapshot plano del row más los datos de la transición y devuelve flags
 * de auditoría. No bloquea — el sistema permite todo el flujo y registra
 * concentraciones de responsabilidad para que la auditoría humana las pueda
 * evaluar según el contexto del tenant.
 *
 * Filosofía (decisión 2026-05-01):
 *   - Empresas grandes con separación formal de roles: el sistema marca
 *     concentraciones para que el auditor las pueda exigir corregir.
 *   - Empresas chicas donde una persona cubre todo el ciclo (diseña,
 *     prueba, controla y aprueba): el sistema permite el flujo, deja
 *     trazabilidad explícita de la concentración. Sin esto, el sistema
 *     sería inaplicable en plantas de 1-2 personas técnicas.
 *
 * Las flags se persisten en `DisenoHistorial.metadata.flags` y la UI las
 * muestra como badges destacados en el timeline (Fase 4).
 */

/**
 * Códigos canónicos de flags. Estables — el frontend y los reportes los
 * referencian. Si se agrega uno, sumar etiqueta en `ETIQUETAS`.
 */
const FLAG = Object.freeze({
  /** El usuario que aprueba la salida de PENDIENTE_REVISION es el mismo que envió a revisión. */
  AUTO_APROBACION_REVISION: 'AUTO_APROBACION_REVISION',
  /** El usuario que aprueba la entrada a EN_PRODUCCION coincide con quien envió/aprobó antes. */
  AUTO_APROBACION_PRODUCCION: 'AUTO_APROBACION_PRODUCCION',
  /** El usuario que rechaza una revisión es el mismo que la había enviado (corrige su propio diseño). */
  AUTO_RECHAZO_REVISION: 'AUTO_RECHAZO_REVISION',
});

const ETIQUETAS = Object.freeze({
  [FLAG.AUTO_APROBACION_REVISION]: {
    codigo: FLAG.AUTO_APROBACION_REVISION,
    titulo: 'Auto-aprobación de revisión',
    descripcion: 'El revisor que aprobó la transición a A_PRUEBA es el mismo usuario que había enviado la dosificación a revisión.',
    severidad: 'info',
  },
  [FLAG.AUTO_APROBACION_PRODUCCION]: {
    codigo: FLAG.AUTO_APROBACION_PRODUCCION,
    titulo: 'Auto-aprobación a producción',
    descripcion: 'El usuario que aprobó la entrada a producción participó previamente como autor del envío a revisión o como aprobador de la prueba.',
    severidad: 'info',
  },
  [FLAG.AUTO_RECHAZO_REVISION]: {
    codigo: FLAG.AUTO_RECHAZO_REVISION,
    titulo: 'Auto-rechazo de revisión',
    descripcion: 'El usuario que devolvió la dosificación a borrador es el mismo que la había enviado a revisión.',
    severidad: 'info',
  },
});

/**
 * Compara dos identificadores de usuario. Acepta strings con/sin espacios y
 * mayúsculas mixtas (verifyToken arma `usuario` como `${name} ${lastname}`,
 * que puede entrar al row con/sin trim según el path de escritura).
 *
 * Devuelve true solo si ambos son no vacíos y coinciden tras normalizar.
 */
function mismoUsuario(a, b) {
  if (!a || !b) return false;
  const norm = (s) => String(s).trim().toLowerCase();
  return norm(a) === norm(b);
}

/**
 * Clasifica una transición y devuelve las flags aplicables. No bloquea,
 * no rechaza — solo describe la concentración de responsabilidades.
 *
 * @param {Object} params
 * @param {Object} params.row - Snapshot plano de `DosificacionDisenada`. Solo
 *   se leen los campos `enviadoRevisionPor`, `aprobadoPor`,
 *   `puestoEnProduccionPor`. Pasar `row.get({ plain: true })` desde el service.
 * @param {string} params.estadoAnterior
 * @param {string} params.estadoNuevo
 * @param {string} params.usuario - Identificador del usuario que ejecuta la transición.
 * @returns {{ flags: string[], etiquetas: Array<Object>, concentracion: boolean }}
 */
function clasificarTransicion({ row = {}, estadoAnterior, estadoNuevo, usuario } = {}) {
  const flags = [];

  // PENDIENTE_REVISION → A_PRUEBA: revisor aprueba lo que él mismo envió
  if (estadoAnterior === 'PENDIENTE_REVISION' && estadoNuevo === 'A_PRUEBA') {
    if (mismoUsuario(row.enviadoRevisionPor, usuario)) {
      flags.push(FLAG.AUTO_APROBACION_REVISION);
    }
  }

  // PENDIENTE_REVISION → BORRADOR: el mismo autor rechaza/corrige su envío
  if (estadoAnterior === 'PENDIENTE_REVISION' && estadoNuevo === 'BORRADOR') {
    if (mismoUsuario(row.enviadoRevisionPor, usuario)) {
      flags.push(FLAG.AUTO_RECHAZO_REVISION);
    }
  }

  // A_PRUEBA → EN_PRODUCCION (o legacy APROBADO): concentración cuando el
  // que aprueba a producción ya participó como autor del diseño, envío a
  // revisión o aprobador de la transición previa. Cubre el camino "empresa
  // chica" donde una sola persona crea, prueba y aprueba sin revisión externa
  // (en ese caso `enviadoRevisionPor` y `aprobadoPor` quedan vacíos pero el
  // creador del diseño coincide con quien aprueba a producción).
  if (estadoAnterior === 'A_PRUEBA' && (estadoNuevo === 'EN_PRODUCCION' || estadoNuevo === 'APROBADO')) {
    const yaParticipo =
      mismoUsuario(row.creadoPor, usuario) ||
      mismoUsuario(row.usuarioCreador, usuario) ||
      mismoUsuario(row.enviadoRevisionPor, usuario) ||
      mismoUsuario(row.aprobadoPor, usuario);
    if (yaParticipo) {
      flags.push(FLAG.AUTO_APROBACION_PRODUCCION);
    }
  }

  // BORRADOR → directo a A_PRUEBA (sin pasar por revisión externa). No es
  // auto-aprobación — fue un envío directo legítimo decidido por el rol.
  // Lo registramos como flag separada cuando se justifique en Fase 4; por
  // ahora no marcamos.

  const etiquetas = flags.map((f) => ETIQUETAS[f]).filter(Boolean);
  return {
    flags,
    etiquetas,
    concentracion: flags.length > 0,
  };
}

/**
 * Construye el bloque que se mergea a `DisenoHistorial.metadata` cuando
 * la clasificación detecta concentración. Mantiene el shape que la UI del
 * timeline (Fase 4) consume:
 *   - `flags`: array de códigos.
 *   - `autoAprobacion`: boolean (cualquier flag de auto-aprobación).
 *   - `etiquetas`: descripciones legibles.
 */
function metadataDeClasificacion(clasificacion) {
  if (!clasificacion || !clasificacion.concentracion) return null;
  const autoAprobacion =
    clasificacion.flags.includes(FLAG.AUTO_APROBACION_REVISION) ||
    clasificacion.flags.includes(FLAG.AUTO_APROBACION_PRODUCCION);
  return {
    flags: clasificacion.flags,
    autoAprobacion,
    etiquetas: clasificacion.etiquetas,
  };
}

module.exports = {
  FLAG,
  ETIQUETAS,
  clasificarTransicion,
  metadataDeClasificacion,
  // Exportado para reutilizar desde tests y desde el frontend (vía endpoint)
  mismoUsuario,
};
