const _tenant = window.location.hostname.split('.')[0];
const DB_NAME = `HormiqualRemito_${_tenant}`;
const DB_VERSION = 1;
const STORE_REMITOS = 'remitos';
const STORE_SYNC_QUEUE = 'syncQueue';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_REMITOS)) {
                db.createObjectStore(STORE_REMITOS, { keyPath: 'token' });
            }
            if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
                db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveRemitoOffline(token, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_REMITOS, 'readwrite');
        tx.objectStore(STORE_REMITOS).put({ token, data, savedAt: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

export async function getRemitoOffline(token) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_REMITOS, 'readonly');
        const req = tx.objectStore(STORE_REMITOS).get(token);
        req.onsuccess = () => { db.close(); resolve(req.result?.data || null); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

export async function removeRemitoOffline(token) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_REMITOS, 'readwrite');
        tx.objectStore(STORE_REMITOS).delete(token);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

export async function addToSyncQueue(token, tenant, payload, apiBase) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
        tx.objectStore(STORE_SYNC_QUEUE).add({
            token,
            tenant,
            payload,
            apiBase: apiBase || '',
            createdAt: Date.now(),
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });

    // Request background sync so the SW sends it when online
    await requestBackgroundSync();
}

export async function getSyncQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_QUEUE, 'readonly');
        const req = tx.objectStore(STORE_SYNC_QUEUE).getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

export async function removeSyncItem(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
        tx.objectStore(STORE_SYNC_QUEUE).delete(id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

export async function clearSyncQueue() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
        tx.objectStore(STORE_SYNC_QUEUE).clear();
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

// ── Sync queue flush (works from any page) ──

export async function trySyncQueue() {
    if (!navigator.onLine) return;
    try {
        const queue = await getSyncQueue();
        if (!queue.length) return;
        for (const item of queue) {
            try {
                const base = item.apiBase || '';
                const url = `${base}/api/public/remito/${item.tenant}/${item.token}/sync`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(item.payload),
                });
                if (resp.ok || resp.status === 400) {
                    await removeSyncItem(item.id);
                }
            } catch {
                break; // network down, stop trying
            }
        }
    } catch {
        // IndexedDB not available
    }
}

// ── Background Sync helpers ──

export async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // If SW already controls this page, cache app shell resources
        if (navigator.serviceWorker.controller) {
            setTimeout(cacheAppShell, 2000);
        }

        // On first install (or SW update), cache after the new SW claims us
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            setTimeout(cacheAppShell, 1000);
        });

        return reg;
    } catch (err) {
        console.error('SW registration failed:', err);
        return null;
    }
}

/**
 * Sends the list of all loaded resources to the Service Worker so it can
 * cache them. Solves the "first visit" problem where the SW registers AFTER
 * the page has already fetched its JS/CSS bundles.
 */
function cacheAppShell() {
    if (!navigator.serviceWorker?.controller) return;
    try {
        const entries = performance.getEntriesByType('resource');
        const urls = [...new Set(
            entries
                .filter(e =>
                    e.initiatorType === 'script' ||
                    e.initiatorType === 'link' ||
                    e.initiatorType === 'css' ||
                    e.initiatorType === 'img' ||
                    e.initiatorType === 'font'
                )
                .map(e => e.name)
        )];

        if (urls.length > 0) {
            navigator.serviceWorker.controller.postMessage({
                type: 'CACHE_APP_SHELL',
                urls,
            });
        }
    } catch {
        // non-critical
    }
}

async function requestBackgroundSync() {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
    try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-remito');
    } catch (err) {
        console.warn('Background sync registration failed:', err);
    }
}
