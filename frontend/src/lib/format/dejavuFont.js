/**
 * Carga y registro de la fuente DejaVu Sans para jsPDF (P2.1).
 *
 * Razón: la fuente Helvetica embebida por default en jsPDF solo cubre
 * Latin-1 (U+0000–U+00FF). Glifos como ≤, ≥, ³, µ, °, ², ₃ se reemplazan
 * con basura (`SO ƒ` en lugar de `SO₃`, `Modulo de finura` en lugar de
 * `Módulo de finura`). DejaVu Sans tiene cobertura Unicode amplia y
 * resuelve el problema de raíz.
 *
 * Estrategia: carga lazy desde `public/fonts/DejaVuSans.ttf`.
 *   - Si el archivo existe: se registra y los PDFs lo usan.
 *   - Si NO existe: fallback transparente a Helvetica + sanitizer.
 *
 * Para activarlo en una instalación:
 *   1. Descargar DejaVuSans.ttf y DejaVuSans-Bold.ttf de
 *      https://dejavu-fonts.github.io/Download.html
 *   2. Copiar a `hormiqual-frontend/public/fonts/`
 *   3. Recargar el navegador. Los siguientes PDFs usarán DejaVu.
 *
 * Bundle size: 0 (los archivos viven en public/, se sirven estáticos).
 */

const FONT_PATHS = {
  normal: '/fonts/DejaVuSans.ttf',
  bold: '/fonts/DejaVuSans-Bold.ttf',
};

const FONT_NAME = 'DejaVuSans';

let _state = {
  loaded: false,
  hasFont: false,
  base64Normal: null,
  base64Bold: null,
  loadPromise: null,
};

/**
 * Convierte ArrayBuffer a base64 sin desbordar el stack.
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Valida que el buffer empiece con una signature TTF/OTF reconocida.
 * Evita que un 200 con HTML (SPA fallback del dev server cuando el archivo
 * no existe) se registre como fuente y haga crashear jsPDF al pedir widths.
 *
 * Signatures válidas para archivos de fuente:
 *   0x00 0x01 0x00 0x00  → TrueType
 *   0x74 0x72 0x75 0x65  → "true"
 *   0x4F 0x54 0x54 0x4F  → "OTTO" (OpenType CFF)
 *   0x74 0x74 0x63 0x66  → "ttcf" (TrueType Collection)
 */
function esBufferTtfValido(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const bytes = new Uint8Array(buffer, 0, 4);
  const [b0, b1, b2, b3] = bytes;
  if (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return true;
  if (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65) return true;
  if (b0 === 0x4F && b1 === 0x54 && b2 === 0x54 && b3 === 0x4F) return true;
  if (b0 === 0x74 && b1 === 0x74 && b2 === 0x63 && b3 === 0x66) return true;
  return false;
}

async function fetchTtfAsBase64(url) {
  try {
    const resp = await fetch(url, { cache: 'force-cache' });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    // Sin esta validación, un SPA fallback (200 con index.html) pasaría como
    // TTF válido y jsPDF crashea con "Cannot read properties of undefined
    // (reading 'widths')" al intentar medir anchos de caracteres.
    if (!esBufferTtfValido(buf)) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.info(`[dejavuFont] ${url} respondió pero no es un TTF válido. Fallback a Helvetica. Copiá el .ttf a public/fonts/ para soporte Unicode extendido.`);
      }
      return null;
    }
    return arrayBufferToBase64(buf);
  } catch {
    return null;
  }
}

/**
 * Pre-carga la fuente. Llamar una vez al startup de la app.
 * Idempotente: corre el fetch una sola vez, después devuelve el resultado cacheado.
 */
export async function preloadDejavu() {
  if (_state.loaded) return _state.hasFont;
  if (_state.loadPromise) return _state.loadPromise;

  _state.loadPromise = (async () => {
    const [normal, bold] = await Promise.all([
      fetchTtfAsBase64(FONT_PATHS.normal),
      fetchTtfAsBase64(FONT_PATHS.bold),
    ]);
    _state.base64Normal = normal;
    _state.base64Bold = bold;
    _state.hasFont = !!normal; // bold es opcional, normal alcanza
    _state.loaded = true;
    return _state.hasFont;
  })();

  return _state.loadPromise;
}

/**
 * Sync check — ¿la fuente está cargada y disponible?
 * Llama a `preloadDejavu()` primero.
 */
export function hasDejavuLoaded() {
  return _state.loaded && _state.hasFont;
}

/**
 * Registra la fuente DejaVu en una instancia de jsPDF.
 * Llamar inmediatamente después de `new jsPDF(...)`.
 *
 * Si la fuente no fue precargada, no hace nada (el doc usa Helvetica).
 *
 * @param {jsPDF} doc
 * @returns {boolean} true si se registró DejaVu en el doc
 */
export function registerDejavuOnDoc(doc) {
  if (!_state.loaded || !_state.base64Normal) return false;
  try {
    doc.addFileToVFS('DejaVuSans.ttf', _state.base64Normal);
    doc.addFont('DejaVuSans.ttf', FONT_NAME, 'normal');
    if (_state.base64Bold) {
      doc.addFileToVFS('DejaVuSans-Bold.ttf', _state.base64Bold);
      doc.addFont('DejaVuSans-Bold.ttf', FONT_NAME, 'bold');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper que aplica DejaVu si está disponible, sino Helvetica.
 * Reemplazo drop-in de `doc.setFont('Helvetica', weight)`.
 *
 * @param {jsPDF} doc
 * @param {'normal'|'bold'|'italic'|'bolditalic'} [weight='normal']
 */
export function setFontSafe(doc, weight = 'normal') {
  // jsPDF no soporta italic en DejaVu sin TTF italic; cae a normal.
  const w = weight === 'italic' ? 'normal' : weight === 'bolditalic' ? 'bold' : weight;
  if (hasDejavuLoaded() && _state.base64Normal) {
    // Verificar que el doc tenga el font registrado (defensa por si registerDejavuOnDoc no fue llamado)
    const fonts = typeof doc.getFontList === 'function' ? doc.getFontList() : null;
    if (fonts && fonts[FONT_NAME]) {
      doc.setFont(FONT_NAME, w === 'bold' && _state.base64Bold ? 'bold' : 'normal');
      return;
    }
  }
  doc.setFont('Helvetica', weight);
}

/**
 * Para tests: reset interno del estado del módulo.
 * @private
 */
export function _resetState() {
  _state = {
    loaded: false,
    hasFont: false,
    base64Normal: null,
    base64Bold: null,
    loadPromise: null,
  };
}
