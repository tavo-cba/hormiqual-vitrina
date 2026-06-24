/* ═══════════════════════════════════════════════════════════════
   Hormiqual – Service Worker
   App Shell caching + Remito offline sync + Background sync
   ═══════════════════════════════════════════════════════════════ */

var CACHE_VERSION = 'v3';
var APP_SHELL_CACHE  = 'app-shell-' + CACHE_VERSION;
var STATIC_CACHE     = 'static-assets-' + CACHE_VERSION;
var REMITO_CACHE     = 'remito-offline-' + CACHE_VERSION;

var EXPECTED_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, REMITO_CACHE];

var lastSyncAttempt = 0;
var SYNC_THROTTLE_MS = 30000;

/* Files to pre-cache during install (unhashed, always present) */
var PRE_CACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/tenant-config.json',
  '/logo192.png',
  '/logo512.png'
];

/* ───────── Install: pre-cache app shell ───────── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(function(cache) {
        return cache.addAll(PRE_CACHE_URLS);
      })
      .then(function() {
        return self.skipWaiting();
      })
  );
});

/* ───────── Activate: clean old caches + claim clients ───────── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames.map(function(name) {
            if (EXPECTED_CACHES.indexOf(name) === -1) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(function() {
        return self.clients.claim();
      })
      .then(function() {
        return syncPendingRemitos();
      })
  );
});

/* ───────── Fetch: routing strategies ───────── */
/*
 * IMPORTANT: The backend API lives on a different origin (api.hormiqual.com)
 * while the frontend lives on {tenant}.hormiqual.com.
 * ALL /api/ calls are cross-origin. The SW must NEVER interfere with
 * authenticated API calls — only cache same-origin app shell files and
 * the specific cross-origin public remito API.
 */
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // Only intercept GET requests
  if (request.method !== 'GET') {
    attemptOpportunisticSync(event);
    return;
  }

  // ─── Same-origin requests ({tenant}.hormiqual.com) ───

  if (url.origin === self.location.origin) {

    // 1) Navigation → network-first, offline fallback to cached /index.html
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then(function(response) {
            var clone = response.clone();
            caches.open(APP_SHELL_CACHE).then(function(cache) {
              cache.put('/index.html', clone);
            });
            return response;
          })
          .catch(function() {
            return caches.match('/index.html');
          })
      );
      attemptOpportunisticSync(event);
      return;
    }

    // 2) Hashed static assets (/static/*) → cache-first (immutable by content hash)
    if (url.pathname.startsWith('/static/')) {
      event.respondWith(
        caches.match(request)
          .then(function(cached) {
            if (cached) return cached;
            return fetch(request).then(function(response) {
              if (response.ok) {
                var clone = response.clone();
                caches.open(STATIC_CACHE).then(function(cache) {
                  cache.put(request, clone);
                });
              }
              return response;
            });
          })
      );
      return;
    }

    // 3) Other same-origin non-API files (manifest, tenant-config, favicon, logos)
    //    → network-first with cache fallback
    if (!url.pathname.startsWith('/api/')) {
      event.respondWith(
        fetch(request)
          .then(function(response) {
            if (response.ok) {
              var clone = response.clone();
              caches.open(APP_SHELL_CACHE).then(function(cache) {
                cache.put(request, clone);
              });
            }
            return response;
          })
          .catch(function() {
            return caches.match(request);
          })
      );
      return;
    }

    // Same-origin /api/* (shouldn't exist since API is cross-origin, but just in case)
    return;
  }

  // ─── Cross-origin requests (api.hormiqual.com, CDNs, etc.) ───

  // 4) Public remito API (api.hormiqual.com/api/public/remito/*)
  //    → network-first with cache fallback for offline use
  if (url.pathname.startsWith('/api/public/remito/')) {
    event.respondWith(
      fetch(request)
        .then(function(response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(REMITO_CACHE).then(function(cache) {
              cache.put(request, clone);
            });
          }
          return response;
        })
        .catch(function() {
          return caches.match(request);
        })
    );
    attemptOpportunisticSync(event);
    return;
  }

  // 5) ALL other cross-origin requests → pass through, NO interference
  //    This includes authenticated API calls (api.hormiqual.com/api/*),
  //    CDN resources (FontAwesome), analytics, etc.
});

function attemptOpportunisticSync(event) {
  var now = Date.now();
  if (now - lastSyncAttempt > SYNC_THROTTLE_MS) {
    lastSyncAttempt = now;
    event.waitUntil(syncPendingRemitos());
  }
}

/* ───────── Message: cache same-origin resources sent from the page ───────── */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CACHE_APP_SHELL') {
    var urls = event.data.urls || [];
    event.waitUntil(
      Promise.all(
        urls.map(function(urlStr) {
          try {
            var parsed = new URL(urlStr, self.location.origin);

            // Only cache same-origin resources (skip cross-origin CDN/API)
            if (parsed.origin !== self.location.origin) return Promise.resolve();

            var cacheName = parsed.pathname.startsWith('/static/')
              ? STATIC_CACHE
              : APP_SHELL_CACHE;

            return caches.open(cacheName).then(function(cache) {
              return cache.match(urlStr).then(function(existing) {
                if (existing) return;
                return cache.add(urlStr).catch(function() { /* non-critical */ });
              });
            });
          } catch (e) {
            return Promise.resolve();
          }
        })
      )
    );
  }
});

/* ───────── Background Sync ───────── */
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-remito') {
    event.waitUntil(syncPendingRemitos());
  }
});

/* ───────── Sync pending remitos from IndexedDB queue ───────── */
async function syncPendingRemitos() {
  var db;
  try {
    db = await openIndexedDB();
    var items = await getAllFromStore(db, 'syncQueue');
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var baseUrl = item.apiBase || '';
        var endpoint = baseUrl + '/api/public/remito/' + item.tenant + '/' + item.token + '/sync';
        var response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });
        if (response.ok || response.status === 400) {
          // 400 = already completed (idempotent), remove from queue
          await deleteFromStore(db, 'syncQueue', item.id);
        }
        // Other errors (500) → leave in queue for next attempt
      } catch (e) {
        // Network error — will retry on next opportunity
        break; // No point trying other items if network is down
      }
    }
  } catch (e) {
    // IndexedDB not available or empty
  } finally {
    if (db) db.close();
  }
}

/* ───────── IndexedDB helpers ───────── */
function openIndexedDB() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('HormiqualRemito', 1);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('remitos')) db.createObjectStore('remitos', { keyPath: 'token' });
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function getAllFromStore(db, storeName) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(storeName, 'readonly');
    var req = tx.objectStore(storeName).getAll();
    req.onsuccess = function() { resolve(req.result || []); };
    req.onerror = function() { reject(req.error); };
  });
}

function deleteFromStore(db, storeName, key) {
  return new Promise(function(resolve, reject) {
    var tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}
