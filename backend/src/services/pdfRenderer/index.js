'use strict';

/**
 * Renderizador HTML → PDF basado en Puppeteer + EJS.
 *
 * Reemplaza progresivamente los generadores cliente-side basados en
 * jsPDF + jspdf-autotable, que tienen limitaciones serias de diseño
 * (posicionamiento manual, sin grid, fuentes built-in con encoding
 * roto en la capa de texto, no soporta CSS).
 *
 * Patrón de uso:
 *   const { renderTemplate } = require('./services/pdfRenderer');
 *   const pdfBuffer = await renderTemplate('aceptacionLote', datos, opts);
 *   res.contentType('application/pdf').send(pdfBuffer);
 *
 * Diseño:
 *   - Una sola instancia de browser Puppeteer compartida (singleton)
 *     para evitar el overhead de spawn en cada request (~1-2 s).
 *   - El browser se cierra al apagar el proceso (graceful shutdown).
 *   - Cada template vive en `templates/<name>.ejs` y puede incluir
 *     CSS inline o un `<link>` al CSS común `_base.css`.
 *   - El template recibe `data` (el payload del informe) + helpers
 *     comunes (formatDate, formatNumber, etc.) en `helpers`.
 */

const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
let _browser = null;
let _browserPromise = null;

async function getBrowser() {
  if (_browser && _browser.connected !== false) return _browser;
  if (_browserPromise) return _browserPromise;
  _browserPromise = puppeteer
    .launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
    })
    .then((b) => {
      _browser = b;
      _browserPromise = null;
      // Cuando el browser se desconecta (crash, manual close), liberar la ref
      // para que el siguiente render lo relance.
      b.on('disconnected', () => { _browser = null; });
      return b;
    })
    .catch((err) => {
      _browserPromise = null;
      throw err;
    });
  return _browserPromise;
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
  }
}

// Graceful shutdown.
process.on('SIGINT',  () => closeBrowser().finally(() => process.exit(0)));
process.on('SIGTERM', () => closeBrowser().finally(() => process.exit(0)));

/* ─────────── Helpers compartidos por templates ─────────── */

const HELPERS = {
  /**
   * Formatea un número con coma decimal y separador de miles.
   * @param {number|string|null} v
   * @param {object} [opts] { precision=2, forceDecimals=true }
   */
  formatNumber(v, opts = {}) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const precision = opts.precision ?? 2;
    return n.toLocaleString('es-AR', {
      minimumFractionDigits: opts.forceDecimals === false ? 0 : precision,
      maximumFractionDigits: precision,
    });
  },
  formatDate(d) {
    if (!d) return '—';
    if (typeof d === 'string') {
      const ymd = d.slice(0, 10).split('-');
      if (ymd.length === 3) return `${ymd[2]}/${ymd[1]}/${ymd[0]}`;
    }
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  },
  /**
   * Escapa HTML para evitar inyección de tags desde campos libres
   * (observaciones, motivos, etc).
   */
  escape(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  /**
   * Identidad cuando no se necesita escape (HTML pre-formateado).
   * Usar con cuidado: solo con strings que NO vienen de input del usuario.
   */
  raw(s) { return s ?? ''; },
};

/* ─────────── Carga de CSS común con fuentes inlineadas ───────────
 *
 * Inter se sirve embebida en base64 dentro del CSS para garantizar que
 * Puppeteer la use sin depender de internet ni de fuentes del sistema.
 * Esto fixea el bug del primer smoke (σ y ≥ desaparecían porque Chromium
 * caía a una fuente sin cobertura Greek/Math).
 */

const FONTS_DIR = path.join(TEMPLATES_DIR, 'fonts');
function loadFontDataUrl(filename) {
  try {
    const buf = fs.readFileSync(path.join(FONTS_DIR, filename));
    return `data:font/truetype;base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

let _baseCssCache = null;
function getBaseCss() {
  if (_baseCssCache !== null) return _baseCssCache;
  const cssPath = path.join(TEMPLATES_DIR, '_base.css');
  try {
    let css = fs.readFileSync(cssPath, 'utf8');
    css = css
      .replace('__INTER_REGULAR__',  loadFontDataUrl('Inter-Regular.ttf'))
      .replace('__INTER_SEMIBOLD__', loadFontDataUrl('Inter-SemiBold.ttf'))
      .replace('__INTER_BOLD__',     loadFontDataUrl('Inter-Bold.ttf'));
    _baseCssCache = css;
  } catch {
    _baseCssCache = '';
  }
  return _baseCssCache;
}

/* ─────────── Renderizado ─────────── */

/**
 * Renderiza un template EJS a HTML y luego a PDF.
 *
 * @param {string} templateName  Nombre del template (sin extensión).
 * @param {object} data          Datos para el template.
 * @param {object} [opts]
 * @param {string} [opts.format='A4']
 * @param {string} [opts.headerHtml]   HTML del header recurrente.
 * @param {string} [opts.footerHtml]   HTML del footer recurrente.
 * @param {object} [opts.margin]       { top, right, bottom, left } en mm.
 * @returns {Promise<Buffer>}
 */
async function renderTemplate(templateName, data, opts = {}) {
  const tmplPath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
  if (!fs.existsSync(tmplPath)) {
    throw new Error(`Template no encontrado: ${templateName}.ejs`);
  }
  const html = await ejs.renderFile(tmplPath, {
    data,
    helpers: HELPERS,
    baseCss: getBaseCss(),
  }, { async: true, cache: process.env.NODE_ENV === 'production' });
  return await renderHtmlToPdf(html, opts);
}

async function renderHtmlToPdf(html, opts = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });
    // Asegurar que las fuentes web custom estén cargadas antes del PDF.
    await page.evaluateHandle('document.fonts.ready');
    // Esperar a que TODAS las imágenes (incluidas data URLs) terminen
    // de decodificarse. setContent con waitUntil:'load' debería garantizarlo
    // pero en la práctica algunas data URLs grandes (logo del tenant) se
    // disparan después del load event y el PDF sale sin imagen.
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
      ));
    });
    const pdf = await page.pdf({
      format: opts.format || 'A4',
      printBackground: true,
      displayHeaderFooter: !!(opts.headerHtml || opts.footerHtml),
      headerTemplate: opts.headerHtml || '<div></div>',
      footerTemplate: opts.footerHtml || '<div></div>',
      margin: {
        top:    opts.margin?.top    ?? '18mm',
        right:  opts.margin?.right  ?? '14mm',
        bottom: opts.margin?.bottom ?? '18mm',
        left:   opts.margin?.left   ?? '14mm',
      },
      preferCSSPageSize: true,
    });
    return Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

module.exports = {
  renderTemplate,
  renderHtmlToPdf,
  closeBrowser,        // export para tests
  _getHelpers: () => HELPERS, // export para tests
};
