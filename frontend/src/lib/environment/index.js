/**
 * Detección del ambiente de ejecución para mostrar/ocultar elementos
 * en documentos oficiales.
 *
 * Reglas:
 *   - `process.env.NODE_ENV !== 'production'` → development
 *   - hostname contiene "localhost", "127.0.0.1", "dev.", "staging.", "test." → no-prod
 *   - el resto se asume producción
 *
 * Política: si detecta ambiente no productivo, estampa watermark visible
 * en los PDFs para evitar que un documento de testing se imprima y use.
 */

export function getEnvironmentTag() {
  const nodeEnv = (typeof process !== 'undefined' && process.env?.NODE_ENV) || 'production';
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) || '';

  if (nodeEnv !== 'production') return 'DESARROLLO';

  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.')) return 'DESARROLLO';
  if (h.includes('dev.') || h.startsWith('dev-') || h.startsWith('dev.')) return 'DESARROLLO';
  if (h.includes('staging.') || h.includes('stage.') || h.startsWith('staging-')) return 'STAGING';
  if (h.includes('test.') || h.startsWith('test-')) return 'STAGING';

  return null; // producción — sin watermark
}

/**
 * Texto del watermark estampado diagonalmente en PDFs no-productivos.
 *
 * Prompt 4 C8 (D25 fix): se acortó el texto para que entre completo en A4
 * a -20° con fontSize 32 sin recorte por ancho diagonal. El texto previo
 * (`'ENTORNO DE DESARROLLO — NO USAR EN OBRA'`, 37 chars) se renderizaba
 * truncado como `'RNO DE DESARROLLO — NO USAR EN OB'` en algunos PDFs.
 * Versión nueva: 21 chars (DESARROLLO) y 18 chars (PRUEBAS) — preserva la
 * señal explícita ("NO USAR") sin depender de fontSize/ángulo de cada PDF.
 */
export function environmentWatermarkText(tag) {
  if (!tag) return null;
  if (tag === 'DESARROLLO') return 'DESARROLLO — NO USAR';
  if (tag === 'STAGING') return 'PRUEBAS — NO USAR';
  return null;
}
