/**
 * Mapeo de tenant del backend principal → tenant del Portal de Empleados.
 *
 * Por convención los slugs del backend y del portal son iguales (ej: 'arideros',
 * 'hdi', 'hormiwhite'). Sólo agregar entradas acá cuando un cliente histórico
 * tenga slugs distintos en backend y portal.
 *
 * Si un tenant del backend no está en este mapa, se usa el mismo nombre como fallback.
 */
const backendToPortalTenant = {
  // Ejemplo si en algún caso difieren:
  // backendSlug: 'portalSlug',
};

/**
 * Convierte un tenant name del backend principal al tenant slug del Portal.
 * @param {string} backendTenant - Nombre del tenant en el backend principal
 * @returns {string} Slug del tenant en el Portal de Empleados
 */
function getPortalTenant(backendTenant) {
  return backendToPortalTenant[backendTenant] || backendTenant;
}

/**
 * Mapeo inverso: dado un slug del Portal devuelve el slug del backend principal.
 * Si el slug del portal no está mapeado explícitamente, retorna el mismo slug.
 * @param {string} portalTenant - Slug del tenant en el Portal
 * @returns {string} Slug del tenant en el backend principal
 */
function getBackendTenant(portalTenant) {
  const entry = Object.entries(backendToPortalTenant).find(([, p]) => p === portalTenant);
  return entry ? entry[0] : portalTenant;
}

module.exports = { getPortalTenant, getBackendTenant, backendToPortalTenant };
