/**
 * Código humano/escaneable de una probeta: **`PRB-AAAA-NNNNNN`**.
 *
 *   PRB-2026-000457
 *   └┬┘ └┬─┘ └─┬──┘
 *    │   │     └── idProbeta (autoincrement) con padding a 6 dígitos
 *    │   └──────── año de moldeo (fecha de la muestra)
 *    └──────────── prefijo fijo
 *
 * Es **derivado, no persistido**: se calcula a partir de `idProbeta` (que ya
 * identifica unívocamente la probeta y ya se exponía en la URL `/p/{id}`) más
 * el año de moldeo. Esto evita una migración, un contador con problemas de
 * concurrencia multi-tenant, y un backfill de probetas viejas. A cambio, la
 * numeración puede tener "huecos" (no arranca de 1 cada año) — algo normal en
 * control de calidad, donde el conteo humano lo da `Probeta.nombre`.
 *
 * El número NO es un contador secuencial por año: si se necesita eso, hay que
 * agregar columna + secuencia + backfill (cambio mayor). Avisar antes.
 *
 * Resolución inversa: `parseProbetaIdFromCodigo` extrae el `idProbeta` para
 * que el redirect `/p/:id` acepte tanto el código nuevo como el id numérico
 * de las etiquetas ya impresas (back-compat).
 */

export const PROBETA_CODIGO_RE = /^PRB-(\d{4})-(\d+)$/i;

const yearFromFecha = (fecha) => {
  if (fecha != null) {
    // DATEONLY 'YYYY-MM-DD' → tomar el año del string para no sufrir el
    // corrimiento de zona horaria de `new Date('YYYY-MM-DD')` (UTC).
    const iso = /^(\d{4})-\d{2}-\d{2}/.exec(String(fecha));
    if (iso) return iso[1];
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }
  // Sin fecha de moldeo (no debería pasar: la muestra siempre tiene fecha).
  return String(new Date().getFullYear());
};

/**
 * Construye el código `PRB-AAAA-NNNNNN`.
 * @param {number} idProbeta
 * @param {string|Date|null} [fecha]  Fecha de moldeo (muestra). Da el año.
 * @returns {string|null} null si el id no es válido.
 */
export function formatProbetaCodigo(idProbeta, fecha) {
  const id = Number(idProbeta);
  if (!Number.isInteger(id) || id <= 0) return null;
  return `PRB-${yearFromFecha(fecha)}-${String(id).padStart(6, '0')}`;
}

/**
 * Extrae el `idProbeta` de un código `PRB-AAAA-NNNNNN` o de un id numérico
 * pelado (back-compat con QR ya impresos que codificaban solo el id).
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseProbetaIdFromCodigo(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const m = PROBETA_CODIGO_RE.exec(s);
  if (m) return Number(m[2]);          // NNNNNN → id (parseInt descarta ceros)
  if (/^\d+$/.test(s)) return Number(s); // id numérico pelado
  return null;
}

/**
 * Extrae la referencia de probeta (código PRB o id) de lo que devuelve el
 * scanner de QR. El QR codifica una URL `…/p/PRB-AAAA-NNNNNN` (o `…/p/123`),
 * pero también toleramos que venga el código/id pelado.
 *
 * Devuelve el segmento crudo (sin resolver); el caller navega a `/p/{ref}` y
 * `ProbetaQrRedirect` lo resuelve con `parseProbetaIdFromCodigo`.
 *
 * @param {string} text  Texto decodificado del QR.
 * @returns {string|null}
 */
export function extractProbetaRefFromScan(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (!s) return null;
  // Segmento después de `/p/` si vino una URL completa.
  const m = /\/p\/([^/?#\s]+)/i.exec(s);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }
  // Código/id pelado (validamos que sea resoluble).
  return parseProbetaIdFromCodigo(s) != null ? s : null;
}
