/**
 * Espejo del registro backend `domain/roles`.
 * Mantener sincronizado. Fuente canónica: backend.
 *
 * Refactor 2026-05-20: el rol CLIENTE se eliminó (no hay portal cliente
 * activo). Quedan los 4 roles internos. Si se retoma el concepto de acceso
 * externo, se reanaliza con su caso de uso concreto.
 */

export const ROLES = Object.freeze({
  OPERADOR:          'OPERADOR',
  RESPONSABLE:       'RESPONSABLE_CALIDAD',
  DIRECTOR_TECNICO:  'DIRECTOR_TECNICO',
  ADMIN:             'ADMIN',
});

export const ROL_LABEL = Object.freeze({
  [ROLES.OPERADOR]:         'Operador',
  [ROLES.RESPONSABLE]:      'Responsable de Calidad',
  [ROLES.DIRECTOR_TECNICO]: 'Director Técnico',
  [ROLES.ADMIN]:            'Administrador',
});

/**
 * Color sugerido para el pill de rol en la UI (PrimeReact severity).
 */
export const ROL_SEVERITY = Object.freeze({
  [ROLES.OPERADOR]:         'info',
  [ROLES.RESPONSABLE]:      'success',
  [ROLES.DIRECTOR_TECNICO]: 'warning',
  [ROLES.ADMIN]:            'danger',
});

/**
 * Devuelve true si el user tiene CUALQUIERA de los roles indicados.
 *
 * Refactor 2026-05-20 — single-read. Cada rol se resuelve por su fuente
 * directa en el modelo Users:
 *   ADMIN                → user.isAdmin === true (o user.permissions?.esAdmin)
 *   OPERADOR / RC / DT   → user.rolCalidad === 'X' (match exacto, no jerárquico)
 *
 * Si necesitás jerarquía dentro de Calidad (DT cuenta como RC), usá
 * `tieneRolMinimo` del backend o el helper de calidadGates.
 */
export function hasRole(user, ...requiredRoles) {
  if (!user || !requiredRoles.length) return false;
  if ((user.isAdmin === true || user.permissions?.esAdmin === true) && requiredRoles.includes(ROLES.ADMIN)) return true;
  if (user.rolCalidad && requiredRoles.includes(user.rolCalidad)) return true;
  return false;
}

/**
 * Devuelve el rol "más prominente" del usuario (para mostrar en el header /
 * badge). Orden: ADMIN > DIRECTOR_TECNICO > RESPONSABLE > OPERADOR.
 */
export function getRolPrincipal(user) {
  if (!user) return null;
  if (user.isAdmin === true || user.permissions?.esAdmin === true) return ROLES.ADMIN;
  if (user.rolCalidad === ROLES.DIRECTOR_TECNICO) return ROLES.DIRECTOR_TECNICO;
  if (user.rolCalidad === ROLES.RESPONSABLE) return ROLES.RESPONSABLE;
  if (user.rolCalidad === ROLES.OPERADOR) return ROLES.OPERADOR;
  return null;
}

/**
 * Roles del usuario en formato canónico (single-read).
 */
export function getRolesCanonicos(user) {
  if (!user) return [];
  if (user.isAdmin === true) return [ROLES.ADMIN];
  if (user.rolCalidad && Object.values(ROLES).includes(user.rolCalidad)) return [user.rolCalidad];
  return [];
}
