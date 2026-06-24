/**
 * Cache module - punto de entrada.
 *
 * Re-exporta todo lo necesario para que los servicios y middlewares
 * puedan importar desde un solo lugar:
 *
 *   const { cacheManager, cacheResponse } = require('../cache');
 */
const cacheManager = require('./CacheManager');
const { cacheResponse } = require('./cacheMiddleware');
const { registerInvalidationHooks } = require('./invalidation');

module.exports = {
  cacheManager,
  cacheResponse,
  registerInvalidationHooks,
};
