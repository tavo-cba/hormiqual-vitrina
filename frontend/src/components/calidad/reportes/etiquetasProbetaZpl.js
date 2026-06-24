import { formatDate } from '../../../lib/format';
import { formatProbetaCodigo } from '../../../lib/probetaCodigo';

/**
 * N-01 (sesión 2026-06-02) — Salida ZPL nativa para las etiquetas QR de
 * probetas, complementaria al PDF (`etiquetasProbetaQrPdf.js`).
 *
 * A diferencia del PDF (donde el QR se embebe como imagen rasterizada), acá
 * el QR lo dibuja la propia impresora Zebra con el comando `^BQ`, lo que da
 * un código más nítido y un archivo mucho más liviano.
 *
 * El layout (coordenadas, fuentes y magnificación del QR) está CONGELADO:
 * fue validado físicamente contra la impresora de producción. NO modificar
 * los `^FO` / `^A0` / `^BQ` sin re-validar en la impresora real.
 *
 *   ^PW400 ^LL200  →  400×200 dots. A 203 dpi (8 dots/mm) = 50×25 mm.
 *
 * Mapeo de campos (ver `probetaToPdfItem` en lib/etiquetasProbeta.js):
 *   - Texto grande   → código `PRB-AAAA-NNNNNN` (ver `probetaCodigo.js`).
 *   - QR             → `{baseUrl}{codigo}` (mismo destino que el PDF; el
 *                      smart-redirect `/p/:id` resuelve código o id numérico).
 *   - Id             → `nombre` de la probeta (M1P1 / L2P4 / T42-P-P3…).
 *   - Clase          → `tipoHormigon` (ej. H-25).
 *   - Edad           → `diasRotura` (+ "d").
 *   - Cliente        → `cliente` (vertical, truncado a 12 chars).
 *   - Fecha          → `fechaConfeccion` (fecha de la muestra), dd/mm/aa (vert.).
 */

// Máximo de caracteres del nombre de cliente en la etiqueta. La fuente y el
// alto del label (50×25 mm @203dpi) no dan para más sin desbordar la banda
// vertical. Si se reimprime y desborda/queda chico, ajustar este número junto
// con el ancho de fuente del campo cliente (`^A0R,28,16`).
const CLIENTE_MAX_CHARS = 16;

/**
 * Sanitiza un valor para usarlo dentro de un campo `^FD ... ^FS`.
 *
 * En ZPL los caracteres `^` (default format command prefix) y `~` (default
 * control command prefix) cortan el campo de datos y son reinterpretados
 * como comandos. Un remito o nombre que los contenga rompería la etiqueta.
 * Los reemplazamos por un guion. `^CI28` (UTF-8) ya cubre tildes y ñ.
 */
const zplField = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\^~]/g, '-').trim();
};

// Fecha corta dd/mm/aa como en la plantilla validada ("12/05/26").
//
// La fecha de moldeo llega como DATEONLY ('YYYY-MM-DD'). Parsearla con
// `new Date('2026-05-12')` la interpreta en UTC y, en zonas al oeste de
// Greenwich (AR = UTC-3), retrocede un día calendario. Por eso extraemos
// los componentes directamente del string ISO sin pasar por Date.
const fechaCorta = (value) => {
  if (value == null || value === '') return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1].slice(2)}`;
  // Fallback para Date u otros formatos: usar el formateador es-AR.
  const f = formatDate(value, { fallback: '' });
  const m = /^(\d{2})\/(\d{2})\/(\d{2})(\d{2})$/.exec(f);
  return m ? `${m[1]}/${m[2]}/${m[4]}` : f;
};

/**
 * Construye el bloque ZPL de UNA etiqueta. Las coordenadas replican la
 * plantilla validada con la impresora.
 */
function buildEtiquetaZpl(probeta, codigo, qrUrl) {
  // Texto grande = código PRB-AAAA-NNNNNN; cae a nombre/id si no se pudo armar.
  const titulo = zplField(codigo || probeta.nombre || probeta.codigo || `#${probeta.idProbeta}`);
  const id = zplField(probeta.nombre || probeta.codigo || `#${probeta.idProbeta}`);
  const clase = zplField(probeta.tipoHormigon) || '-';
  const edad = probeta.diasRotura != null ? `${probeta.diasRotura}d` : '-';
  const fecha = fechaCorta(probeta.fechaConfeccion) || '-';
  // Cliente vertical: truncado para no desbordar la banda. Sanitizamos ANTES
  // de cortar para que el reemplazo de ^/~ no descuadre el largo.
  const cliente = zplField(probeta.cliente).slice(0, CLIENTE_MAX_CHARS);

  return [
    '^XA',
    '^CI28',
    '^PW400',
    '^LL200',
    '^LH0,0',
    `^FO75,12^A0N,40,30^FD${titulo}^FS`,
    `^FO10,58^BQN,2,4^FDMA,${zplField(qrUrl)}^FS`,
    `^FO152,64^A0N,35,23^FDId: ${id}^FS`,
    `^FO152,108^A0N,35,23^FDClase: ${clase}^FS`,
    `^FO152,152^A0N,35,23^FDEdad: ${edad}^FS`,
    // Columna vertical derecha: cliente (reemplaza "Moldeo") + fecha de moldeo.
    `^FO355,20^A0R,32,23^FD${cliente}^FS`,
    `^FO312,60^A0R,35,25^FD${fecha}^FS`,
    '^XZ',
  ].join('\n');
}

/**
 * Genera el texto ZPL completo para un set de probetas (un bloque
 * `^XA … ^XZ` por etiqueta; la impresora corta entre cada uno).
 *
 * @param {Array<object>} probetas  Shape de `probetaToPdfItem`.
 * @param {object} opts
 * @param {string} [opts.baseUrl]   Base del QR. Default = origen + `/p/`.
 * @returns {string} ZPL listo para enviar a la Zebra.
 */
export function generarEtiquetasProbetaZpl(probetas, opts = {}) {
  const defaultOrigin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://app.hormiqual.com';
  const baseUrl = opts.baseUrl ?? `${defaultOrigin}/p/`;

  return (probetas || [])
    .map((p) => {
      const codigo = formatProbetaCodigo(p.idProbeta, p.fechaConfeccion);
      return buildEtiquetaZpl(p, codigo, `${baseUrl}${codigo || p.idProbeta}`);
    })
    .join('\n');
}

/**
 * Genera el ZPL y dispara la descarga de un archivo `.zpl` que el operario
 * envía a la impresora (Zebra Setup Utilities / cola de impresión / red).
 */
export function downloadEtiquetasProbetaZpl(probetas, opts = {}, filename = 'etiquetas-probetas.zpl') {
  const zpl = generarEtiquetasProbetaZpl(probetas, opts);
  const blob = new Blob([zpl], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
