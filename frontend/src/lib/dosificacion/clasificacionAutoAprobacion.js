/**
 * Detector de auto-aprobación para UX (Fase 2).
 *
 * Espejo del engine `politicaRevision.js` del backend, pero con propósito
 * distinto: aquí solo se usa para mostrar un confirm informativo ANTES de
 * disparar la transición. La fuente de verdad y la persistencia de las flags
 * en `DisenoHistorial.metadata` SIEMPRE las hace el backend.
 *
 * Si este detector da falso negativo, el backend igual marcará el evento
 * como concentración en el timeline. Si da falso positivo, el confirm
 * aparece de más — el usuario puede continuar sin problema.
 *
 * Mantener sincronizado con `hormiqual-backend/src/domain/dosificacion/politicaRevision.js`.
 */

const FLAG = Object.freeze({
  AUTO_APROBACION_REVISION: 'AUTO_APROBACION_REVISION',
  AUTO_APROBACION_PRODUCCION: 'AUTO_APROBACION_PRODUCCION',
  AUTO_RECHAZO_REVISION: 'AUTO_RECHAZO_REVISION',
});

const ETIQUETA = {
  [FLAG.AUTO_APROBACION_REVISION]: {
    titulo: 'Auto-aprobación de revisión',
    descripcion: 'Estás aprobando la transición a "A prueba" de una dosificación que vos mismo enviaste a revisión. La acción quedará registrada en la auditoría como concentración de responsabilidad. ¿Querés continuar?',
  },
  [FLAG.AUTO_APROBACION_PRODUCCION]: {
    titulo: 'Auto-aprobación a producción',
    descripcion: 'Estás aprobando la puesta en producción de una dosificación en cuyo flujo previo participaste como autor o aprobador. La acción quedará registrada en la auditoría como concentración de responsabilidad. ¿Querés continuar?',
  },
  [FLAG.AUTO_RECHAZO_REVISION]: {
    titulo: 'Rechazo de tu propio envío',
    descripcion: 'Estás devolviendo a borrador una dosificación que vos mismo enviaste a revisión. La acción quedará registrada en la auditoría. ¿Querés continuar?',
  },
};

/**
 * Normaliza un identificador de usuario para comparación tolerante a
 * espacios y diferencia de mayúsculas. Espejo de `mismoUsuario` del backend.
 */
function normalizar(s) {
  if (!s) return '';
  return String(s).trim().toLowerCase();
}

function mismoUsuario(a, b) {
  if (!a || !b) return false;
  return normalizar(a) === normalizar(b);
}

/**
 * Devuelve el nombre que el backend usa como `usuario` en transiciones.
 * Se construye como `${name} ${lastname}` (verifyToken.js), con fallback
 * a `username`. Mantener el cálculo idéntico al backend para que la
 * detección frontend coincida con la clasificación backend.
 */
function obtenerNombreUsuario(user) {
  if (!user) return '';
  if (user.nombre) return user.nombre;
  const compuesto = `${user.name || ''} ${user.lastname || ''}`.trim();
  if (compuesto) return compuesto;
  return user.username || '';
}

/**
 * Detecta si la transición que el usuario está por ejecutar configura una
 * auto-aprobación. Devuelve `null` si no hay concentración, o un objeto
 * `{ flag, titulo, descripcion }` si la hay.
 *
 * @param {Object} loadedDosif - row de DosificacionDisenada cargado en el page
 * @param {Object} user - user actual (de UserContext)
 * @param {string} nuevoEstado - estado destino de la transición
 * @returns {{ flag: string, titulo: string, descripcion: string } | null}
 */
export function detectarAutoAprobacion(loadedDosif, user, nuevoEstado) {
  if (!loadedDosif || !user || !nuevoEstado) return null;

  const userName = obtenerNombreUsuario(user);
  if (!userName) return null;

  const estadoActual = loadedDosif.estado;
  const enviadoRevisionPor = loadedDosif.enviadoRevisionPor;
  const aprobadoPor = loadedDosif.aprobadoPor;

  // PENDIENTE_REVISION → A_PRUEBA: revisor = autor del envío
  if (estadoActual === 'PENDIENTE_REVISION' && nuevoEstado === 'A_PRUEBA') {
    if (mismoUsuario(enviadoRevisionPor, userName)) {
      return { flag: FLAG.AUTO_APROBACION_REVISION, ...ETIQUETA[FLAG.AUTO_APROBACION_REVISION] };
    }
  }

  // PENDIENTE_REVISION → BORRADOR: autor rechaza su propio envío
  if (estadoActual === 'PENDIENTE_REVISION' && nuevoEstado === 'BORRADOR') {
    if (mismoUsuario(enviadoRevisionPor, userName)) {
      return { flag: FLAG.AUTO_RECHAZO_REVISION, ...ETIQUETA[FLAG.AUTO_RECHAZO_REVISION] };
    }
  }

  // A_PRUEBA → EN_PRODUCCION: aprobador participó antes
  if (estadoActual === 'A_PRUEBA' && (nuevoEstado === 'EN_PRODUCCION' || nuevoEstado === 'APROBADO')) {
    if (mismoUsuario(enviadoRevisionPor, userName) || mismoUsuario(aprobadoPor, userName)) {
      return { flag: FLAG.AUTO_APROBACION_PRODUCCION, ...ETIQUETA[FLAG.AUTO_APROBACION_PRODUCCION] };
    }
  }

  return null;
}

export { FLAG, mismoUsuario, obtenerNombreUsuario };
