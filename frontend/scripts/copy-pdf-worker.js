/**
 * Copia el worker de pdf.js a public/ para que se sirva como archivo estático
 * fijo (/pdf.worker.min.js). Se ejecuta antes de `npm start` y `npm run build`
 * (hooks prestart / prebuild) para mantenerlo sincronizado con la versión
 * instalada de pdfjs-dist.
 *
 * Se usa el archivo de public/ en vez del asset hasheado de webpack porque
 * algunos hostings sirven mal los workers hasheados / .mjs (MIME text/html).
 *
 * 2026-05-20 — pdfjs-dist v5.x dropped CommonJS builds: ya no existe
 * `pdf.worker.min.js`, solo `pdf.worker.min.mjs` (ES module). Como la
 * decisión arquitectónica es seguir sirviéndolo con extensión `.js` (por
 * MIME en hostings), el script ahora intenta primero `.min.mjs` y cae en
 * `.min.js` para versiones viejas. El contenido se sirve igual; pdf.js
 * carga el worker como blob, no le importa la extensión.
 */
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const DEST = path.join(__dirname, '..', 'public', 'pdf.worker.min.js');

// Probar primero `.mjs` (pdfjs-dist v5+), después `.js` (versiones viejas).
const CANDIDATES = ['pdf.worker.min.mjs', 'pdf.worker.min.js'];

const src = CANDIDATES.map((f) => path.join(BUILD_DIR, f)).find((p) => fs.existsSync(p));

if (!src) {
    console.error(
        '[copy-pdf-worker] No se encontró ningún worker. Esperaba alguno de:\n' +
        CANDIDATES.map((f) => `  - ${path.join(BUILD_DIR, f)}`).join('\n')
    );
    process.exitCode = 1;
} else {
    try {
        fs.copyFileSync(src, DEST);
        console.log(`[copy-pdf-worker] ${path.basename(src)} → public/pdf.worker.min.js`);
    } catch (err) {
        console.error('[copy-pdf-worker] No se pudo copiar el worker de pdf.js:', err.message);
        process.exitCode = 1;
    }
}
