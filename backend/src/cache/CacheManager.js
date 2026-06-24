/**
 * CacheManager - Singleton que gestiona un TenantCache por cada tenant.
 *
 * Uso tipico:
 *   const cache = require('./cache/CacheManager');
 *   cache.forTenant('hormiqual').get('auth', `user:${id}`);
 *   cache.forTenant('hormiqual').set('catalogos', 'tiposHormigon', data, 3600);
 *   cache.forTenant('hormiqual').invalidate('catalogos');
 */
const TenantCache = require('./TenantCache');

class CacheManager {
  constructor() {
    /** @type {Map<string, TenantCache>} */
    this._tenants = new Map();
    this._defaultOpts = {
      maxEntriesPerNs: 500,
      sweepIntervalMs: 60_000,
    };
  }

  /**
   * Obtener (o crear) el cache de un tenant.
   * @param {string} tenantId
   * @returns {TenantCache}
   */
  forTenant(tenantId) {
    if (!this._tenants.has(tenantId)) {
      this._tenants.set(tenantId, new TenantCache(tenantId, this._defaultOpts));
    }
    return this._tenants.get(tenantId);
  }

  /**
   * Invalidar un namespace en TODOS los tenants.
   * Util para cambios globales.
   */
  invalidateAll(namespace) {
    for (const tc of this._tenants.values()) {
      tc.invalidate(namespace);
    }
  }

  /**
   * Obtener estadisticas de todos los tenants.
   */
  getAllStats() {
    const stats = {};
    for (const [id, tc] of this._tenants) {
      stats[id] = tc.getStats();
    }
    return stats;
  }

  /**
   * Limpiar todo (tests, shutdown).
   */
  clearAll() {
    for (const tc of this._tenants.values()) {
      tc.destroy();
    }
    this._tenants.clear();
  }
}

// Singleton
module.exports = new CacheManager();
