/**
 * invalidationBus.js — Propaga la invalidacion de cache a TODOS los workers de
 * PM2 (cluster mode) usando el message bus nativo de PM2 (sin infra externa).
 *
 * ── Por que existe ───────────────────────────────────────────────────────
 * El cache (CacheManager/TenantCache) vive en memoria, por proceso. En cluster,
 * cada worker tiene su propio cache. Si el worker A escribe e invalida solo su
 * cache, el worker B sigue sirviendo datos viejos hasta que vence el TTL.
 * Este bus hace que la invalidacion cruce a todos los workers en milisegundos.
 *
 * ── Diseno fail-safe ─────────────────────────────────────────────────────
 * Si el bus no puede inicializarse, o un mensaje se pierde, el sistema degrada
 * a "cache con TTL normal" (invalidacion local + expiracion). NUNCA crashea ni
 * cuelga la app. El peor desenlace posible es comportarse como un cache TTL
 * comun: una entrada puede quedar stale en un worker, como mucho, hasta su TTL.
 *
 * ── Dev (sin PM2, p.ej. nodemon) ─────────────────────────────────────────
 * No hay bus: publishInvalidation solo invalida local, identico al
 * comportamiento de una sola instancia.
 */
const cacheManager = require('./CacheManager');

const PM_ID = process.env.pm_id;          // definido solo bajo PM2
const UNDER_PM2 = PM_ID !== undefined;
const MSG_KIND = 'cache:op';

/**
 * Aplica una operacion de cache en el proceso actual.
 * @param {'invalidateMany'|'clear'|'clearAll'} op
 * @param {string} [tenant]
 * @param {string[]} [namespaces]
 */
function applyLocal(op, tenant, namespaces) {
  switch (op) {
    case 'invalidateMany':
      if (tenant && Array.isArray(namespaces) && namespaces.length) {
        cacheManager.forTenant(tenant).invalidateMany(namespaces);
      }
      break;
    case 'clear':
      if (tenant) cacheManager.forTenant(tenant).clear();
      break;
    case 'clearAll':
      cacheManager.clearAll();
      break;
    default:
      // op desconocida -> no-op (defensivo)
      break;
  }
}

/**
 * Inicializa el listener del bus. Idempotente y fail-safe.
 * Solo hace algo bajo PM2 cluster.
 */
function initInvalidationBus() {
  if (!UNDER_PM2) {
    console.log('[cache-bus] Sin PM2: invalidacion local unicamente (TTL como red de seguridad).');
    return;
  }
  let pm2;
  try {
    pm2 = require('pm2');
  } catch (err) {
    console.warn('[cache-bus] No se pudo cargar pm2; degradando a invalidacion local + TTL:', err.message);
    return;
  }
  pm2.launchBus((err, bus) => {
    if (err) {
      console.warn('[cache-bus] launchBus fallo; degradando a invalidacion local + TTL:', err.message);
      return;
    }
    bus.on('process:msg', (packet) => {
      try {
        const data = packet && packet.data;
        if (!data || data.kind !== MSG_KIND) return;
        // Ignorar el eco del propio mensaje: el originador ya invalido local.
        if (String(data.origin) === String(PM_ID)) return;
        applyLocal(data.op, data.tenant, data.namespaces);
      } catch (e) {
        // Un mensaje malformado nunca debe tumbar el listener.
        console.warn('[cache-bus] Error procesando mensaje de invalidacion:', e.message);
      }
    });
    console.log(`[cache-bus] Bus de invalidacion activo (pm_id=${PM_ID}).`);
  });
}

/**
 * Publica una operacion: la aplica local YA y la propaga a los demas workers.
 * @param {'invalidateMany'|'clear'|'clearAll'} op
 * @param {{tenant?: string, namespaces?: string[]}} payload
 */
function publish(op, payload = {}) {
  // 1. El worker actual queda coherente al instante (sin ventana de staleness).
  applyLocal(op, payload.tenant, payload.namespaces);

  // 2. Propagar a los hermanos (solo bajo PM2).
  if (UNDER_PM2 && typeof process.send === 'function') {
    try {
      process.send({
        type: 'process:msg',
        data: { kind: MSG_KIND, op, origin: PM_ID, ...payload },
      });
    } catch (err) {
      // Fail-safe: los hermanos se auto-curan por TTL.
      console.warn('[cache-bus] No se pudo propagar; se confia en TTL:', err.message);
    }
  }
}

/** Invalida namespaces (lo que disparan los hooks de Sequelize). */
function publishInvalidation(tenant, namespaces) {
  publish('invalidateMany', { tenant, namespaces });
}

/** Limpia todo el cache de un tenant en todos los workers. */
function publishClear(tenant) {
  publish('clear', { tenant });
}

/** Limpia el cache de todos los tenants en todos los workers. */
function publishClearAll() {
  publish('clearAll', {});
}

module.exports = {
  initInvalidationBus,
  publishInvalidation,
  publishClear,
  publishClearAll,
};
