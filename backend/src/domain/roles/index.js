'use strict';

/**
 * Definición canónica de los roles de HormiQual.
 *
 * Refactor 2026-05-20 — single-read: los roles se resuelven por fuente directa
 * en el modelo `Users`, no más por canónicos en EmpleadoRol:
 *
 *   ADMIN                → Users.isAdmin                (boolean)
 *   OPERADOR / RC / DT   → Users.rolCalidad              (ENUM)
 *
 * El concepto "Cliente externo" se introdujo y revirtió en la misma sesión
 * 2026-05-20: por ahora HormiQual no maneja un portal cliente real (carpeta
 * `src/components/cliente/` vacía). Si se retoma, se reanaliza con el caso
 * de uso concreto (cliente aceptando dosificación, etc.).
 *
 * La autoridad jerárquica dentro de cada módulo (Calidad / Flota / Mantenimiento)
 * se administra en `/admin/roles → pestaña del módulo` con sus propios sub-roles.
 * Esos sub-roles viven en columnas separadas (User.rolCalidad / rolFlota /
 * rolMantenimiento) y son ortogonales al árbol de menús (PermisoMenu).
 *
 * Diseño:
 *   - Sin jerarquía heredada: cada rol tiene sus capacidades explícitas.
 *     Un usuario solo puede tener UN rolCalidad a la vez (ENUM exclusivo).
 *   - El rol del Operador es el "default" — sin rol asignado se asume
 *     OPERADOR para usuarios con login válido en lo que toca a permisos
 *     del módulo Calidad.
 *   - ADMIN es bandera excluyente con el resto a nivel de UI.
 */

const ROLES = Object.freeze({
  OPERADOR:          'OPERADOR',
  RESPONSABLE:       'RESPONSABLE_CALIDAD',
  DIRECTOR_TECNICO:  'DIRECTOR_TECNICO',
  ADMIN:             'ADMIN',
  // Producción (sesión 2026-06-03)
  COORDINADOR:       'COORDINADOR',
  PLANTISTA:         'PLANTISTA',
});

const ROLES_LIST = Object.values(ROLES);

/**
 * Devuelve true si el `user` tiene cualquiera de los roles indicados.
 *
 * Refactor 2026-05-20 — single-read. Cada rol se resuelve por su fuente
 * directa en el modelo `Users`:
 *
 *   ADMIN                → user.isAdmin === true
 *   OPERADOR             → user.rolCalidad === 'OPERADOR'
 *   RESPONSABLE_CALIDAD  → user.rolCalidad === 'RESPONSABLE_CALIDAD'
 *   DIRECTOR_TECNICO     → user.rolCalidad === 'DIRECTOR_TECNICO'
 *
 * No hay jerarquía implícita: un DIRECTOR_TECNICO NO satisface
 * `hasRole(user, RESPONSABLE_CALIDAD)` (match exacto). Si hace falta jerarquía,
 * usar `tieneRolMinimo` de `calidadGates.js`.
 *
 * @param {Object} user - típicamente `req.user`
 * @param {...string} requiredRoles - uno o varios `ROLES.*`
 * @returns {boolean}
 */
function hasRole(user, ...requiredRoles) {
  if (!user || !requiredRoles.length) return false;
  if (user.isAdmin === true && requiredRoles.includes(ROLES.ADMIN)) return true;
  if (user.rolCalidad && requiredRoles.includes(user.rolCalidad)) return true;
  if (user.rolProduccion && requiredRoles.includes(user.rolProduccion)) return true;
  return false;
}

/**
 * Variante "tener TODOS los roles indicados". Caso raro: como rolCalidad es
 * exclusivo, pedir dos roles distintos de Calidad degenera en imposible
 * salvo ADMIN bypass.
 */
function hasAllRoles(user, ...requiredRoles) {
  if (!user || !requiredRoles.length) return false;
  if (user.isAdmin === true) return true;
  const efectivos = new Set();
  if (user.rolCalidad) efectivos.add(user.rolCalidad);
  if (user.rolProduccion) efectivos.add(user.rolProduccion);
  return requiredRoles.every((r) => efectivos.has(r));
}

/**
 * Dado un user, devuelve los roles canónicos que tiene.
 */
function getRolesDeUsuario(user) {
  if (!user) return [];
  if (user.isAdmin === true) return [ROLES.ADMIN];
  const out = [];
  if (user.rolCalidad && ROLES_LIST.includes(user.rolCalidad)) out.push(user.rolCalidad);
  if (user.rolProduccion && ROLES_LIST.includes(user.rolProduccion)) out.push(user.rolProduccion);
  return out;
}

/**
 * Etiqueta legible para mostrar en UI/PDF.
 */
const ROL_LABEL = Object.freeze({
  [ROLES.OPERADOR]:         'Operador',
  [ROLES.RESPONSABLE]:      'Responsable de Calidad',
  [ROLES.DIRECTOR_TECNICO]: 'Director Técnico',
  [ROLES.ADMIN]:            'Administrador',
  [ROLES.COORDINADOR]:      'Coordinador',
  [ROLES.PLANTISTA]:        'Plantista',
});

module.exports = {
  ROLES,
  ROLES_LIST,
  ROL_LABEL,
  hasRole,
  hasAllRoles,
  getRolesDeUsuario,
};
