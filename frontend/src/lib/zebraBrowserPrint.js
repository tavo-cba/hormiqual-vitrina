/**
 * Puente con **Zebra Browser Print** para impresión directa de ZPL desde el
 * navegador a una impresora Zebra (USB / red / Bluetooth).
 *
 * Un navegador no puede hablarle a una impresora de etiquetas por seguridad.
 * Zebra Browser Print es un servicio local (se instala una vez por PC) que
 * escucha en `localhost` y reenvía el ZPL crudo a la impresora. Acá hablamos
 * directamente con sus endpoints HTTP (el SDK oficial `BrowserPrint.js` hace
 * exactamente lo mismo por debajo, así que evitamos shippear ese archivo
 * versionado de Zebra).
 *
 * Puertos (el servicio usa RAW printing en ambos):
 *   - http://localhost:9100   ← cuando la página se sirve por http
 *   - https://localhost:9101  ← cuando la página se sirve por https
 *
 * El navegador bloquea "mixed content" (https → http://localhost) de forma
 * inconsistente entre versiones, por eso seguimos el mismo criterio que el
 * SDK: elegir el protocolo según el origen de la página.
 *
 * Notas de despliegue (ver docs/etiquetado-probetas.md):
 *   - La PRIMERA vez que un dominio (ej. app.hormiqual.com) accede, Browser
 *     Print muestra un prompt nativo en la PC ("… wants to access your Zebra
 *     Devices" → Yes). Hasta que el operario acepte, el fetch falla.
 *   - En versiones < 1.2.1, además hay que aceptar el certificado autofirmado
 *     visitando una vez `https://localhost:9101`.
 *   - Si algo de esto falla, el llamador cae al fallback de descargar el .zpl.
 */

const baseUrl = () =>
  (typeof window !== 'undefined' && window.location?.protocol === 'https:')
    ? 'https://localhost:9101'
    : 'http://localhost:9100';

/**
 * fetch contra Browser Print con timeout corto: si el servicio no está
 * instalado/corriendo, queremos fallar rápido y caer al fallback de archivo,
 * no dejar al operario esperando.
 */
async function bpFetch(path, options = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl()}${path}`, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * ¿Está corriendo Browser Print y accesible desde este dominio?
 * No lanza: devuelve boolean (cualquier error = no disponible).
 */
export async function browserPrintDisponible() {
  try {
    const res = await bpFetch('/available', {}, 2500);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Impresora por defecto configurada en Browser Print, o `null` si no hay.
 *
 * `/default?type=printer` devuelve el objeto device DIRECTO (sin envoltura).
 * Cuando NO hay default configurado, responde con cuerpo **vacío** (no 404,
 * no JSON), por eso lo leemos como texto y devolvemos null si está vacío.
 */
async function getDefaultDevice() {
  const res = await bpFetch('/default?type=printer');
  if (!res.ok) return null;
  const txt = (await res.text()).trim();
  if (!txt) return null;
  try {
    const device = JSON.parse(txt);
    return device && device.uid ? device : null;
  } catch {
    return null;
  }
}

/**
 * Primera impresora disponible (cuando no hay default).
 *
 * `/available` devuelve un objeto agrupado por tipo: `{ printer: [...],
 * scale: [...] }`. Filtramos del lado del cliente por `printer`.
 */
async function getFirstPrinter() {
  const res = await bpFetch('/available');
  if (!res.ok) return null;
  const txt = (await res.text()).trim();
  if (!txt) return null;
  let data;
  try { data = JSON.parse(txt); } catch { return null; }
  // Preferimos la clave 'printer'; si no, el primer array de devices que
  // tenga deviceType 'printer'.
  const printers = Array.isArray(data?.printer)
    ? data.printer
    : Object.values(data || {})
        .filter(Array.isArray)
        .flat()
        .filter((d) => d && (d.deviceType === 'printer' || d.uid));
  return printers.find((d) => d && d.uid) || null;
}

/**
 * Resuelve una impresora: default → primera disponible.
 * @throws Error accionable si no hay ninguna.
 */
export async function getPrinterDevice() {
  const device = (await getDefaultDevice()) || (await getFirstPrinter());
  if (!device || !device.uid) {
    throw new Error('Zebra Browser Print está corriendo pero no detecta ninguna impresora. Verificá que la Zebra esté encendida y conectada.');
  }
  return device;
}

/**
 * Envía un string ZPL a la impresora vía Browser Print.
 *
 * IMPORTANTE: NO seteamos `Content-Type: application/json`. Eso dispararía un
 * preflight CORS (OPTIONS) que el servicio local NO maneja y la request
 * fallaría. El SDK oficial manda el body como string sin header, lo que el
 * navegador trata como `text/plain` → "simple request", sin preflight. Acá
 * replicamos ese comportamiento (fetch con body string y sin Content-Type).
 *
 * @param {string} zpl  Uno o varios bloques ^XA…^XZ concatenados.
 * @returns {Promise<object>} el `device` usado.
 * @throws Error con mensaje accionable si no se pudo imprimir.
 */
export async function enviarZpl(zpl) {
  const device = await getPrinterDevice();
  const res = await bpFetch('/write', {
    method: 'POST',
    body: JSON.stringify({ device, data: zpl }),
  });
  if (!res.ok) {
    throw new Error(`Error al enviar a la impresora (HTTP ${res.status}).`);
  }
  return device;
}
