'use strict';

/**
 * Tabla normativa IRAM 1666:2020 §A.7.10.1.1 + Tabla A.3.
 *
 * Mej-03 (auditoría 08, Bloque 15): antes esta tabla vivía inline en
 * `services/probetaService.js`. La movimos acá porque:
 *   1. Es un dato normativo puro (no depende de DB ni de tenant).
 *   2. Reutilizable desde otros engines / reportes / tests sin levantar
 *      el service entero (que arrastra muchas dependencias).
 *   3. Permite cubrirla con tests focalizados.
 *
 * Coeficiente `k` para corrección de desviación estándar muestral cuando
 * 15 ≤ n < 30, conforme IRAM 1666:2020 Tabla A.3. Para n ≥ 30 el
 * coeficiente es 1,000 (no requiere corrección por tamaño de muestra);
 * para n < 15 la norma considera que la σ tiene escaso valor estadístico
 * y exige tratarla como referencial (ver flag `desviacionReferencial` en
 * el motor PR8.3).
 *
 * Uso:
 *   const { tStudentK, getKIram1666 } = require('../domain/normRef/iram1666');
 *   const k = getKIram1666(n);   // n entero
 *   const sigmaCorregida = sigmaSample * k;
 */

const tStudentK = Object.freeze({
  15: 1.160,
  16: 1.144,
  17: 1.128,
  18: 1.112,
  19: 1.096,
  20: 1.080,
  21: 1.070,
  22: 1.060,
  23: 1.050,
  24: 1.040,
  25: 1.030,
  26: 1.024,
  27: 1.018,
  28: 1.012,
  29: 1.006,
});

/**
 * Devuelve el factor `k` aplicable al tamaño muestral `n`.
 *  - n < 15 → null (la σ es referencial; el caller decide si la usa).
 *  - 15 ≤ n < 30 → k de la Tabla A.3.
 *  - n ≥ 30 → 1,000 (no requiere corrección).
 */
function getKIram1666(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  if (n < 15) return null;
  if (n >= 30) return 1.000;
  // Cualquier valor 15..29 (entero o no): redondear hacia abajo para no inflar.
  const idx = Math.floor(n);
  return tStudentK[idx] ?? null;
}

/* ═══════════════════════════════════════════════════════════════════
   IRAM 1666:2020 Tabla 7 (pág. 25) — Tolerancias para la dosificación de
   los materiales componentes del hormigón, respecto a la masa total de
   cada material. Aplican a CADA pastón individualmente.

   Tolerancia = diferencia entre el valor nominal de la dosificación y el
   valor medido. Depende de:
     - material (cemento / adiciones / agregados / agua / aditivos / fibras / pigmentos),
     - modo de medida: 'acumulada' (varios materiales en una balanza) o 'individual',
     - uso de la capacidad total del dispositivo de medida (> 30% o ≤ 30%)
       — sólo para cemento / adiciones / agregados.

   `signo`: 'doble' = ± (banda simétrica); 'positiva' = sólo límite superior (+).
   ═══════════════════════════════════════════════════════════════════ */

const CITA_TABLA7 = 'IRAM 1666:2020 Tabla 7';

// Mapea la familia (de Betonmatic/HormiQual) a la categoría de la Tabla 7.
// Cemento y adiciones minerales comparten tolerancia → ambos 'cemento'.
function categoriaMaterialIram1666(familia) {
  const f = String(familia || '').toUpperCase();
  if (f.startsWith('ARID') || f === 'AR') return 'agregado';
  if (f.startsWith('CEMENT') || f.startsWith('ADICION') || f === 'CE') return 'cemento';
  if (f.startsWith('AGU') || f === 'AG') return 'agua';
  if (f.startsWith('ADITIV') || f === 'AD') return 'aditivo';
  if (f.startsWith('FIBRA')) return 'fibra';
  if (f.startsWith('PIGMENT')) return 'pigmento';
  return null;
}

// Modo de pesada por defecto según IRAM 1666 §7.5.4/§7.5.5 + realidad de planta:
// - cemento y adiciones se pesan en forma ACUMULATIVA en su tolva balanza (§7.5.4);
// - los áridos se acumulan en una única tolva de recepción (§7.5.5 + práctica);
// - agua (cuentaimpulsos) y aditivos (celdas de carga) se miden INDIVIDUAL.
function modoPesadaPorDefecto(categoria) {
  return (categoria === 'agregado' || categoria === 'cemento') ? 'acumulada' : 'individual';
}

/**
 * Tolerancia de dosificación de la Tabla 7 para una categoría.
 * @param {string} categoria - agregado|cemento|agua|aditivo|fibra|pigmento
 * @param {object} [opts]
 * @param {'acumulada'|'individual'} [opts.modo]
 * @param {number} [opts.usoCapacidadPct] - % de uso de la capacidad de la balanza
 *   (si no se pasa, se asume > 30%, el caso estándar).
 * @returns {{tolPct:number, signo:'doble'|'positiva', cita:string, nota?:string}|null}
 */
function toleranciaDosificacionIram1666(categoria, opts = {}) {
  const modo = opts.modo === 'individual' ? 'individual' : 'acumulada';
  const usoMayor30 = opts.usoCapacidadPct == null ? true : Number(opts.usoCapacidadPct) > 30;
  const doble = (tolPct, nota) => ({ tolPct, signo: 'doble', cita: CITA_TABLA7, ...(nota ? { nota } : {}) });

  switch (categoria) {
    case 'cemento': // cemento y adiciones minerales
      if (usoMayor30) return modo === 'individual' ? doble(2.0) : doble(1.0);
      return { tolPct: 4.0, signo: 'positiva', cita: CITA_TABLA7, nota: 'capacidad ≤30%, medida individual' };
    case 'agregado':
      if (usoMayor30) return doble(2.0);
      return modo === 'individual'
        ? doble(3.0)
        : doble(2.0, 'o ±0,3% de la capacidad de balanza, lo que resulte menor');
    case 'agua':
      return modo === 'individual' ? doble(2.0) : doble(1.0);
    case 'aditivo':
    case 'fibra':
    case 'pigmento':
      return doble(3.0);
    default:
      return null;
  }
}

/**
 * Evalúa un desvío de dosificación contra la Tabla 7.
 * @param {string} familia
 * @param {number} desvioPct - (medido - nominal) / nominal * 100
 * @param {object} [opts] - { modo, usoCapacidadPct }
 * @returns {{categoria, tolPct, signo, cita, dentro:boolean, nota?}|null}
 */
function evaluarDesvioDosificacionIram1666(familia, desvioPct, opts = {}) {
  const categoria = categoriaMaterialIram1666(familia);
  if (!categoria) return null;
  const modo = opts.modo || modoPesadaPorDefecto(categoria);
  const tol = toleranciaDosificacionIram1666(categoria, { ...opts, modo });
  if (!tol) return null;
  const d = Number(desvioPct);
  if (!Number.isFinite(d)) return { categoria, ...tol, modo, dentro: null };
  const dentro = tol.signo === 'positiva' ? (d <= tol.tolPct) : (Math.abs(d) <= tol.tolPct);
  return { categoria, modo, ...tol, dentro };
}

module.exports = {
  tStudentK,
  getKIram1666,
  // Tabla 7 — tolerancias de dosificación
  categoriaMaterialIram1666,
  modoPesadaPorDefecto,
  toleranciaDosificacionIram1666,
  evaluarDesvioDosificacionIram1666,
};
