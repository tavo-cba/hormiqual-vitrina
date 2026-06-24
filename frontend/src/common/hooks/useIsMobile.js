import { useState, useEffect } from 'react';

const DEFAULT_MOBILE_QUERY = '(max-width: 768px)';

/**
 * Devuelve true si el viewport está dentro del breakpoint mobile.
 *
 * Reactivo: actualiza al rotar tablet, redimensionar ventana o abrir DevTools.
 * Reemplaza la constante `isOnPhone` (IIFE evaluado una sola vez al cargar el
 * bundle, no reactivo) de `common/functions.js`. SSR-safe (devuelve false si
 * no hay `window` o `matchMedia`).
 *
 * @param {string} query - media query CSS, por defecto '(max-width: 768px)'.
 * @returns {boolean}
 */
export function useIsMobile(query = DEFAULT_MOBILE_QUERY) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const handler = (e) => setIsMobile(e.matches);
    // matchMedia: addEventListener en navegadores modernos, addListener en Safari viejos
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return isMobile;
}

export default useIsMobile;
