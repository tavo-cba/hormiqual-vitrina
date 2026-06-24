/**
 * cacheHelpers.js - Utilidades compartidas para cacheo en servicios.
 *
 * Los servicios reciben `db` (el objeto de Sequelize del tenant),
 * pero necesitan saber el tenantId para acceder al cache correcto.
 * Esta funcion extrae el nombre de la base de datos de la instancia
 * de Sequelize, que corresponde al tenant.
 */
const cacheManager = require('../cache/CacheManager');

/**
 * Extraer el tenantId del objeto db.
 * El objeto db tiene db.sequelize que es la instancia de Sequelize,
 * y su config contiene el nombre de la base de datos.
 *
 * Usamos el database name como fallback, pero primero buscamos
 * en el dbCache del models/index.js via un campo _tenantId que inyectamos.
 */
function extractTenantFromDb(db) {
  // Campo inyectado por models/index.js
  if (db._tenantId) return db._tenantId;

  // Fallback: buscar por el prototype chain (Object.create)
  const proto = Object.getPrototypeOf(db);
  if (proto && proto._tenantId) return proto._tenantId;

  // Ultimo recurso: nombre de la base de datos
  const dbName = db.sequelize?.config?.database || 'unknown';
  return dbName;
}

/**
 * Obtener el TenantCache para un objeto db de servicio.
 * Atajo para no repetir extractTenantFromDb + cacheManager.forTenant en cada servicio.
 */
function getCacheForDb(db) {
  return cacheManager.forTenant(extractTenantFromDb(db));
}

module.exports = { extractTenantFromDb, getCacheForDb };
