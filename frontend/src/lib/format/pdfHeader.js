/**
 * Helper centralizado para dibujar el header de un PDF (logo + nombre de
 * empresa + dirección + fecha de emisión + línea divisoria).
 *
 * Antes cada generador de PDF tenía su propio header (o no tenía logo en
 * absoluto). Auditoría visual reportó que fichaMuestra, informeAceptacion,
 * certificadoIndividual y informeResistencia NO mostraban el logo del
 * tenant. Este helper unifica todos.
 *
 * Uso típico:
 *   const y = await drawPdfHeader(doc, { configEmpresa, margin: 16 });
 *   // y = posición vertical donde el caller puede continuar dibujando.
 *
 * Cuando se pasa `headerBg`, las medidas del header siguen el canon HormiQual
 * adoptado de ordenPagoPdf (sesión 2026-06-11): banda 28mm de alto, logo
 * máximo 56×18mm centrado verticalmente con aspect-ratio preservado.
 */

import axios from 'axios';
import { sanitizePdfText, formatDate } from './index';
import { config as appConfig } from '../../config/config';

const tx = (s) => sanitizePdfText(s);

// Devuelve las dimensiones naturales (ancho/alto en px) de un logo dataURL
// para poder escalarlo manteniendo aspect-ratio. Si no se puede leer,
// resolvemos null y el caller usa la caja máxima directa (puede estirar).
const getImageDimensions = (dataUrl) =>
  new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string') return resolve(null);
    if (typeof Image === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

/**
 * Descarga el logo del tenant desde el endpoint propio `/api/config/logo`
 * (mismo origen — evita CORS) y lo devuelve como dataURL para embeberlo
 * en un PDF. Devuelve null si no hay logo configurado o si la descarga falla.
 *
 * Cache en memoria por sesión: el logo no cambia entre PDFs.
 */
let _logoCache = undefined; // undefined = no intentado, null = sin logo, string = dataURL

export async function fetchTenantLogoAsDataUrl() {
  if (_logoCache !== undefined) return _logoCache;
  try {
    const res = await axios.get(`${appConfig.backendUrl}/api/config/logo`, {
      responseType: 'blob',
      headers: appConfig.headers,
      timeout: 10000,
    });
    const blob = res.data;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    _logoCache = dataUrl;
    return dataUrl;
  } catch (err) {
    // 404 = sin logo configurado en el tenant. 502 = falla en el upstream
    // (S3 caído, URL rota). En ambos casos: render sin logo, sin romper el PDF.
    _logoCache = null;
    return null;
  }
}

export function _resetLogoCacheForTests() { _logoCache = undefined; }

// Canon HormiQual del header (banda) — adoptado de ordenPagoPdf en mm.
const BAND_H_MM = 28;          // alto de la banda full-width
const LOGO_MAX_W_BAND = 56;    // ancho máximo del logo en modo banda
const LOGO_MAX_H_BAND = 18;    // alto máximo del logo en modo banda

// Tamaños legacy (modo sin banda) — para no romper consumers que no opt-in.
const LOGO_W_LEGACY = 30;
const LOGO_H_LEGACY = 18;

/**
 * @param {jsPDF} doc
 * @param {object} opts
 * @param {object} opts.configEmpresa
 *   - nombreEmpresa (string; pasar '' para suprimir el bloque empresa)
 *   - direccion (string opcional)
 *   - logoLink (URL opcional al logo del tenant)
 *   - logoBase64 (alternativa: base64 PNG/JPG)
 * @param {number} [opts.margin=16]
 * @param {string} [opts.fechaEmision] — opcional, default = hoy
 * @param {number[]} [opts.headerBg] — opcional, RGB [r,g,b]. Si presente,
 *   dibuja una banda de fondo a todo el ancho (canon HormiQual: 28mm alto,
 *   logo máx 56×18mm centrado verticalmente con aspect-ratio preservado) y
 *   renderiza el texto en blanco. Sin este parámetro, comportamiento legacy
 *   (logo 30×18mm anclado al top, texto negro, línea gris separadora).
 * @returns {Promise<number>} Posición Y donde el caller puede continuar.
 */
export async function drawPdfHeader(doc, opts = {}) {
  const { configEmpresa = {}, margin = 16, fechaEmision, headerBg } = opts;
  const pageW = doc.internal.pageSize.getWidth();
  const usaBanda = Array.isArray(headerBg) && headerBg.length === 3;

  // 1) Logo: intentamos en orden:
  //    (a) configEmpresa.logoBase64 (ya cargado por el caller).
  //    (b) endpoint propio /api/config/logo (mismo origen, sin CORS).
  //    (c) configEmpresa.logoLink directo (legacy — puede fallar por CORS).
  const logoBase64 = configEmpresa.logoBase64
    || (await fetchTenantLogoAsDataUrl())
    || (await tryFetchLogoAsDataUrl(configEmpresa.logoLink));

  // 2) Banda de fondo opt-in (canon HormiQual).
  if (usaBanda) {
    doc.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
    doc.rect(0, 0, pageW, BAND_H_MM, 'F');
  }

  // 3) Dimensionar y posicionar el logo.
  //    - Modo banda: máx 56×18mm, escalado proporcional, centrado verticalmente.
  //    - Modo legacy: 30×18mm fijo, anclado al top (y = margin).
  const maxLogoW = usaBanda ? LOGO_MAX_W_BAND : LOGO_W_LEGACY;
  const maxLogoH = usaBanda ? LOGO_MAX_H_BAND : LOGO_H_LEGACY;
  let logoW = maxLogoW;
  let logoH = maxLogoH;
  if (logoBase64) {
    const dims = await getImageDimensions(logoBase64);
    if (dims && dims.width > 0 && dims.height > 0) {
      const ratio = dims.width / dims.height;
      // Escala para entrar en la caja max manteniendo aspect-ratio.
      if (ratio > maxLogoW / maxLogoH) {
        logoW = maxLogoW;
        logoH = maxLogoW / ratio;
      } else {
        logoH = maxLogoH;
        logoW = maxLogoH * ratio;
      }
    }
  }
  const logoY = usaBanda ? (BAND_H_MM - logoH) / 2 : margin;

  if (logoBase64) {
    const fmt = /^data:image\/(jpe?g|jpg)/i.test(logoBase64) ? 'JPEG' : 'PNG';
    try {
      doc.addImage(logoBase64, fmt, margin, logoY, logoW, logoH, undefined, 'FAST');
    } catch (err) {
      const alt = fmt === 'PNG' ? 'JPEG' : 'PNG';
      try { doc.addImage(logoBase64, alt, margin, logoY, logoW, logoH, undefined, 'FAST'); }
      catch { /* logo inválido — render sin logo */ }
    }
  }

  // 4) Bloque de empresa (a la derecha del logo) y fecha (esquina derecha).
  //    En modo banda el texto se centra verticalmente con la banda; en modo
  //    legacy se ancla al top como antes.
  if (usaBanda) doc.setTextColor(255, 255, 255);
  const xText = logoBase64 ? margin + logoW + 4 : margin;
  const yTextBase = usaBanda ? (BAND_H_MM / 2 - 1) : (margin + 5);
  const yFecha = usaBanda ? (BAND_H_MM / 2 - 1) : (margin + 5);

  // Si el caller pasa explícitamente `nombreEmpresa: ''` (string vacío),
  // suprimimos el bloque de empresa entero — útil cuando el título del
  // documento ya identifica la empresa y la repetición sería visualmente
  // ruidosa (smoke-pdf-visual test47).
  const mostrarEmpresa = configEmpresa.nombreEmpresa !== '';
  if (mostrarEmpresa) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(tx(configEmpresa.nombreEmpresa || 'HormiQual'), xText, yTextBase);

    if (configEmpresa.direccion) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(tx(configEmpresa.direccion), xText, yTextBase + 4);
    }
  }

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Emitido: ${formatDate(fechaEmision ?? new Date())}`,
    pageW - margin, yFecha, { align: 'right' });

  // Restablecer color de texto a negro para que el caller no herede blanco.
  if (usaBanda) doc.setTextColor(0, 0, 0);

  // 5) Línea separadora bajo el header (solo en modo legacy sin banda).
  if (!usaBanda) {
    const yLinea = margin + LOGO_H_LEGACY + 1;
    doc.setDrawColor(180);
    doc.setLineWidth(0.3);
    doc.line(margin, yLinea, pageW - margin, yLinea);
    return yLinea + 4;
  }

  // En modo banda, devolvemos la Y justo debajo de la banda + un colchón.
  return BAND_H_MM + 4;
}

/**
 * Intenta descargar el logo del tenant como dataURL para embedearlo en el PDF.
 * Devuelve null si falla (no rompe el PDF — simplemente no se dibuja logo).
 */
async function tryFetchLogoAsDataUrl(logoLink) {
  if (!logoLink || typeof logoLink !== 'string') return null;
  if (logoLink.startsWith('data:')) return logoLink;
  try {
    const res = await fetch(logoLink, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
