/**
 * cacheMiddleware.js - Middleware Express para cachear respuestas GET completas.
 *
 * Se aplica a endpoints de lectura que no cambian frecuentemente.
 * Almacena el JSON de respuesta en el TenantCache del tenant actual.
 *
 * Uso:
 *   const { cacheResponse } = require('../cache/cacheMiddleware');
 *   router.get('/', verifyJwt, cacheResponse('dosificaciones', 600), ctrl.getDosificaciones);
 *
 * El namespace se usa para invalidacion. Cuando el modelo cambia,
 * el hook de invalidation.js limpia ese namespace y la proxima request
 * genera datos frescos.
 */
const cacheManager = require('./CacheManager');
const { extractTenantFromRequest } = require('../middlewares/extractTenant');

/**
 * Crea un middleware de cache para un endpoint GET.
 *
 * @param {string} namespace     Namespace del cache (debe coincidir con invalidation.js)
 * @param {number} ttlSeconds    TTL en segundos
 * @param {object} [opts]
 * @param {function} [opts.keyFn] Funcion personalizada para generar la cache key.
 *                                 Recibe (req) y devuelve string.
 *                                 Por defecto usa req.originalUrl.
 * @param {boolean} [opts.perUser] Si true, la key incluye el userId (para datos filtrados por usuario)
 */
function cacheResponse(namespace, ttlSeconds, opts = {}) {
  return (req, res, next) => {
    // Solo cachear GET
    if (req.method !== 'GET') return next();

    try {
      const tenantId = extractTenantFromRequest(req);
      const tc = cacheManager.forTenant(tenantId);

      // Generar cache key
      let cacheKey;
      if (opts.keyFn) {
        cacheKey = opts.keyFn(req);
      } else {
        cacheKey = req.originalUrl;
        if (opts.perUser && req.user) {
          cacheKey = `u:${req.user.id}:${cacheKey}`;
        }
      }

      // Intentar servir desde cache
      const cached = tc.get(namespace, cacheKey);
      if (cached !== undefined) {
        return res.status(200).json(cached);
      }

      // Interceptar res.json para capturar la respuesta y cachearla
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Solo cachear respuestas exitosas
        if (res.statusCode >= 200 && res.statusCode < 300) {
          tc.set(namespace, cacheKey, body, ttlSeconds);
        }
        return originalJson(body);
      };

      next();
    } catch (e) {
      // Si falla la logica de cache, continuar sin cache
      next();
    }
  };
}

module.exports = { cacheResponse };
