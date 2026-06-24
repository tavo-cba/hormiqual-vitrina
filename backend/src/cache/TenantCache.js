/**
 * TenantCache - Store de cache en memoria para un tenant individual.
 *
 * Soporta:
 *  - Namespaces (agrupan claves relacionadas para invalidacion selectiva)
 *  - TTL por entrada (en segundos)
 *  - Estadisticas de hits/misses
 *  - Limpieza periodica de entradas expiradas
 *  - Limite maximo de entradas por namespace para evitar memory leaks
 */
class TenantCache {
  /**
   * @param {string} tenantId
   * @param {object} opts
   * @param {number} [opts.maxEntriesPerNs=500]  Maximo de entradas por namespace
   * @param {number} [opts.sweepIntervalMs=60000] Intervalo de limpieza automatica (ms)
   */
  constructor(tenantId, opts = {}) {
    this.tenantId = tenantId;
    this.maxEntriesPerNs = opts.maxEntriesPerNs || 500;
    /** @type {Map<string, Map<string, {value: any, expiresAt: number}>>} */
    this._stores = new Map();
    this._stats = { hits: 0, misses: 0, sets: 0, invalidations: 0 };

    // Sweep periodico
    this._sweepInterval = setInterval(
      () => this._sweep(),
      opts.sweepIntervalMs || 60_000
    );
    // No bloquear el proceso si es lo unico que queda
    if (this._sweepInterval.unref) this._sweepInterval.unref();
  }

  /* ─────────── API publica ─────────── */

  /**
   * Obtener un valor del cache.
   * @param {string} namespace
   * @param {string} key
   * @returns {any|undefined}
   */
  get(namespace, key) {
    const ns = this._stores.get(namespace);
    if (!ns) { this._stats.misses++; return undefined; }

    const entry = ns.get(key);
    if (!entry) { this._stats.misses++; return undefined; }

    if (Date.now() > entry.expiresAt) {
      ns.delete(key);
      this._stats.misses++;
      return undefined;
    }

    this._stats.hits++;
    return entry.value;
  }

  /**
   * Guardar un valor en el cache.
   * @param {string} namespace
   * @param {string} key
   * @param {any}    value
   * @param {number} ttlSeconds  Tiempo de vida en segundos
   */
  set(namespace, key, value, ttlSeconds) {
    let ns = this._stores.get(namespace);
    if (!ns) {
      ns = new Map();
      this._stores.set(namespace, ns);
    }

    // Eviction: si el namespace esta lleno, borrar la entrada mas vieja
    if (ns.size >= this.maxEntriesPerNs && !ns.has(key)) {
      const oldestKey = ns.keys().next().value;
      ns.delete(oldestKey);
    }

    ns.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    this._stats.sets++;
  }

  /**
   * Verificar si una clave existe y no esta expirada.
   */
  has(namespace, key) {
    return this.get(namespace, key) !== undefined;
  }

  /**
   * Eliminar una clave especifica.
   */
  del(namespace, key) {
    const ns = this._stores.get(namespace);
    if (ns) ns.delete(key);
  }

  /**
   * Invalidar un namespace completo (todas sus claves).
   * Esto es lo que se llama cuando un modelo cambia.
   */
  invalidate(namespace) {
    if (this._stores.has(namespace)) {
      this._stores.get(namespace).clear();
      this._stats.invalidations++;
    }
  }

  /**
   * Invalidar multiples namespaces de una vez.
   * @param {string[]} namespaces
   */
  invalidateMany(namespaces) {
    for (const ns of namespaces) {
      this.invalidate(ns);
    }
  }

  /**
   * Limpiar todo el cache del tenant.
   */
  clear() {
    for (const ns of this._stores.values()) {
      ns.clear();
    }
    this._stores.clear();
  }

  /**
   * Obtener estadisticas del cache.
   */
  getStats() {
    let totalEntries = 0;
    const namespaces = {};
    for (const [name, ns] of this._stores) {
      namespaces[name] = ns.size;
      totalEntries += ns.size;
    }
    return {
      tenantId: this.tenantId,
      totalEntries,
      namespaces,
      ...this._stats,
      hitRate: this._stats.hits + this._stats.misses > 0
        ? ((this._stats.hits / (this._stats.hits + this._stats.misses)) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Destruir el cache y liberar el timer.
   */
  destroy() {
    clearInterval(this._sweepInterval);
    this.clear();
  }

  /* ─────────── Interno ─────────── */

  _sweep() {
    const now = Date.now();
    for (const [, ns] of this._stores) {
      for (const [key, entry] of ns) {
        if (now > entry.expiresAt) ns.delete(key);
      }
    }
  }
}

module.exports = TenantCache;
