'use strict';

/**
 * Engine puro: derivación de "Tipo de hormigón" desde la resistencia
 * especificada f'ce, considerando IRAM 1666:2020 + CIRSOC 200:2024 + las
 * clases legacy todavía en uso (CIRSOC 201:1982 / IRAM 1666:1986).
 *
 * Diseño:
 *  - Función pura (sin DB, sin HTTP). Recibe inputs y devuelve descriptor.
 *  - El caller (service) resuelve el `idTipoHormigon` contra la tabla
 *    TipoHormigon a partir del descriptor.
 *
 * Escala completa (validada con el usuario el 2026-05-20 contra tablas
 * oficiales de IRAM 1666:2020, CIRSOC 200:2024, CIRSOC 201:1982/2005,
 * IRAM 1666:1986):
 *
 *   Vigentes IRAM 1666:2020 únicamente:        H-5, H-10, H-55
 *   Vigentes CIRSOC 200:2024 únicamente:       H-70, H-90, H-110
 *   Vigentes en AMBAS normas (IRAM + CIRSOC):  H-15, H-20, H-25, H-30, H-35,
 *                                              H-40, H-45, H-50, H-60, H-80, H-100
 *   Legacy (no vigentes, "usos y costumbres"): H-8, H-13, H-17, H-21
 *      Origen: CIRSOC 201:1982 / IRAM 1666:1986. Aparecen en solicitudes
 *      de clientes y pliegos. Se incluyen para que el motor pueda mapear
 *      f'ce=21 → H-21 cuando ese es el pedido literal.
 *
 * Modo de interpretación de f'ce:
 *  - 'ESPECIFICADO': f'ce viene del pliego. Mapea a la clase inmediata
 *    SUPERIOR (f'ck ≥ f'ce). Garantiza que la clase comercial cumple o
 *    supera el f'ce solicitado.
 *  - 'OBJETIVO': f'ce ya incluye el sobrediseño (k·σ). Mapea a la clase
 *    MÁS CERCANA en distancia absoluta. Empate → preferir superior.
 *
 * Caso HRDC: descriptor `{ nombre: 'HRDC', fcMpa: null }`.
 *
 * Caso fuera de catálogo (f'ce <5 o >110 MPa, o un decimal que no matchea):
 *  - Modo ESPECIFICADO: usa la inmediata superior si está dentro del
 *    catálogo. Si f'ce supera el máximo (110), genera ad-hoc.
 *  - Modo OBJETIVO: usa la más cercana del catálogo. Si está fuera del
 *    rango total [5..110], genera ad-hoc.
 *  - Ad-hoc: nombre `H-{round(f'ce)}`, `adHoc: true`.
 */

/**
 * Catálogo normativo. Mantener sincronizado con la migración seed
 * `20260621b-reseed-tipohormigon-completo.js` y con el mirror del frontend
 * `lib/normativa/tipoHormigonIRAM1666.js`.
 *
 * Orden: ascendente por fcMpa. Crítico para la búsqueda "inmediata superior".
 */
const ESCALA = Object.freeze([
    Object.freeze({ nombre: 'H-5',   fcMpa: 5,   enIram1666: true,  enCirsoc200: false, notaLegacy: null }),
    Object.freeze({ nombre: 'H-8',   fcMpa: 8,   enIram1666: false, enCirsoc200: false, notaLegacy: 'CIRSOC 201:1982 / IRAM 1666:1986' }),
    Object.freeze({ nombre: 'H-10',  fcMpa: 10,  enIram1666: true,  enCirsoc200: false, notaLegacy: null }),
    Object.freeze({ nombre: 'H-13',  fcMpa: 13,  enIram1666: false, enCirsoc200: false, notaLegacy: 'CIRSOC 201:1982 / IRAM 1666:1986' }),
    Object.freeze({ nombre: 'H-15',  fcMpa: 15,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-17',  fcMpa: 17,  enIram1666: false, enCirsoc200: false, notaLegacy: 'CIRSOC 201:1982 / IRAM 1666:1986' }),
    Object.freeze({ nombre: 'H-20',  fcMpa: 20,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-21',  fcMpa: 21,  enIram1666: false, enCirsoc200: false, notaLegacy: 'CIRSOC 201:1982 / IRAM 1666:1986' }),
    Object.freeze({ nombre: 'H-25',  fcMpa: 25,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-30',  fcMpa: 30,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-35',  fcMpa: 35,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-40',  fcMpa: 40,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-45',  fcMpa: 45,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-50',  fcMpa: 50,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-55',  fcMpa: 55,  enIram1666: true,  enCirsoc200: false, notaLegacy: null }),
    Object.freeze({ nombre: 'H-60',  fcMpa: 60,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-70',  fcMpa: 70,  enIram1666: false, enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-80',  fcMpa: 80,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-90',  fcMpa: 90,  enIram1666: false, enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-100', fcMpa: 100, enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-110', fcMpa: 110, enIram1666: false, enCirsoc200: true,  notaLegacy: null }),
]);

const FC_MIN = ESCALA[0].fcMpa;
const FC_MAX = ESCALA[ESCALA.length - 1].fcMpa;

const MODOS_FCE = Object.freeze({
    ESPECIFICADO: 'ESPECIFICADO',
    OBJETIVO: 'OBJETIVO',
});

const SIN_DERIVACION = Object.freeze({
    nombre: null, fcMpa: null,
    enIram1666: false, enCirsoc200: false, notaLegacy: null, adHoc: false,
    motivo: 'sin_fce',
});

const DESC_HRDC = Object.freeze({
    nombre: 'HRDC', fcMpa: null,
    enIram1666: false, enCirsoc200: false,
    notaLegacy: 'Hormigón de Resistencia y Densidad Controlada (fuera de IRAM/CIRSOC; AAHE N°16 / Segerer 2017)',
    adHoc: false,
    motivo: 'hrdc',
});

/** Descriptor a partir de una clase de la escala. */
function descriptorDeClase(cls, motivo) {
    return Object.freeze({
        nombre: cls.nombre,
        fcMpa: cls.fcMpa,
        enIram1666: cls.enIram1666,
        enCirsoc200: cls.enCirsoc200,
        notaLegacy: cls.notaLegacy,
        adHoc: false,
        motivo,
    });
}

/**
 * @param {Object} input
 * @param {number|null} input.fce
 * @param {string|null} input.tipologiaCodigo  'hrdc' fuerza HRDC.
 * @param {'ESPECIFICADO'|'OBJETIVO'} [input.modoFce='ESPECIFICADO']
 * @returns {{
 *   nombre: string|null,
 *   fcMpa: number|null,
 *   enIram1666: boolean,
 *   enCirsoc200: boolean,
 *   notaLegacy: string|null,
 *   adHoc: boolean,
 *   motivo: string,
 * }}
 */
function derivarTipoHormigon(input) {
    const { fce, tipologiaCodigo, modoFce } = input || {};

    if (typeof tipologiaCodigo === 'string' && tipologiaCodigo.toLowerCase() === 'hrdc') {
        return DESC_HRDC;
    }

    const fceNum = Number(fce);
    if (!Number.isFinite(fceNum) || fceNum <= 0) return SIN_DERIVACION;

    // Fuera de rango total → ad-hoc.
    if (fceNum < FC_MIN || fceNum > FC_MAX) {
        const fcRedondeado = Math.round(fceNum);
        return Object.freeze({
            nombre: `H-${fcRedondeado}`,
            fcMpa: fcRedondeado,
            enIram1666: false,
            enCirsoc200: false,
            notaLegacy: null,
            adHoc: true,
            motivo: fceNum < FC_MIN ? 'ad_hoc_bajo' : 'ad_hoc_alto',
        });
    }

    const modo = modoFce === MODOS_FCE.OBJETIVO ? MODOS_FCE.OBJETIVO : MODOS_FCE.ESPECIFICADO;

    if (modo === MODOS_FCE.ESPECIFICADO) {
        // Clase inmediata SUPERIOR: primer fcMpa >= fce en la escala ordenada.
        for (const cls of ESCALA) {
            if (cls.fcMpa >= fceNum) {
                return descriptorDeClase(cls, 'iram_cirsoc_especificado');
            }
        }
        // No debería pasar (filtramos > FC_MAX arriba).
        return descriptorDeClase(ESCALA[ESCALA.length - 1], 'iram_cirsoc_especificado');
    }

    // modo OBJETIVO: clase más cercana, empate → preferir superior.
    let mejor = ESCALA[0];
    let mejorDistancia = Math.abs(mejor.fcMpa - fceNum);
    for (let i = 1; i < ESCALA.length; i++) {
        const cls = ESCALA[i];
        const d = Math.abs(cls.fcMpa - fceNum);
        if (d < mejorDistancia || (d === mejorDistancia && cls.fcMpa > mejor.fcMpa)) {
            mejor = cls;
            mejorDistancia = d;
        }
    }
    return descriptorDeClase(mejor, 'iram_cirsoc_objetivo');
}

module.exports = {
    ESCALA,
    // Aliases retro-compat (algunos consumers usan el nombre viejo).
    ESCALA_IRAM_1666: ESCALA,
    FC_MIN_NORMATIVO: FC_MIN,
    FC_MAX_NORMATIVO: FC_MAX,
    MODOS_FCE,
    derivarTipoHormigon,
};
