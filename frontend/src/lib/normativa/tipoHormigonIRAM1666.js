/**
 * Mirror del engine puro del backend en `domain/normRef/tipoHormigonIRAM1666.js`.
 * Mantener sincronizado — fuente canónica: backend.
 *
 * Refactor 2026-05-20 (segunda pasada): escala completa con IRAM 1666:2020 +
 * CIRSOC 200:2024 + clases legacy CIRSOC 201:1982 / IRAM 1666:1986
 * (H-8, H-13, H-17, H-21) que se siguen usando en solicitudes y pliegos.
 */

const NOTA_LEGACY = 'CIRSOC 201:1982 / IRAM 1666:1986';
const NOTA_HRDC = 'Hormigón de Resistencia y Densidad Controlada (fuera de IRAM/CIRSOC; AAHE N°16 / Segerer 2017)';

export const ESCALA = Object.freeze([
    Object.freeze({ nombre: 'H-5',   fcMpa: 5,   enIram1666: true,  enCirsoc200: false, notaLegacy: null }),
    Object.freeze({ nombre: 'H-8',   fcMpa: 8,   enIram1666: false, enCirsoc200: false, notaLegacy: NOTA_LEGACY }),
    Object.freeze({ nombre: 'H-10',  fcMpa: 10,  enIram1666: true,  enCirsoc200: false, notaLegacy: null }),
    Object.freeze({ nombre: 'H-13',  fcMpa: 13,  enIram1666: false, enCirsoc200: false, notaLegacy: NOTA_LEGACY }),
    Object.freeze({ nombre: 'H-15',  fcMpa: 15,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-17',  fcMpa: 17,  enIram1666: false, enCirsoc200: false, notaLegacy: NOTA_LEGACY }),
    Object.freeze({ nombre: 'H-20',  fcMpa: 20,  enIram1666: true,  enCirsoc200: true,  notaLegacy: null }),
    Object.freeze({ nombre: 'H-21',  fcMpa: 21,  enIram1666: false, enCirsoc200: false, notaLegacy: NOTA_LEGACY }),
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

export const FC_MIN = ESCALA[0].fcMpa;
export const FC_MAX = ESCALA[ESCALA.length - 1].fcMpa;
// Aliases retro-compat para consumers viejos.
export const ESCALA_IRAM_1666 = ESCALA;
export const FC_MIN_NORMATIVO = FC_MIN;
export const FC_MAX_NORMATIVO = FC_MAX;

export const MODOS_FCE = Object.freeze({
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
    notaLegacy: NOTA_HRDC, adHoc: false,
    motivo: 'hrdc',
});

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
 * Espejo de `derivarTipoHormigon` del backend. Función pura.
 */
export function derivarTipoHormigon(input) {
    const { fce, tipologiaCodigo, modoFce } = input || {};

    if (typeof tipologiaCodigo === 'string' && tipologiaCodigo.toLowerCase() === 'hrdc') {
        return DESC_HRDC;
    }

    const fceNum = Number(fce);
    if (!Number.isFinite(fceNum) || fceNum <= 0) return SIN_DERIVACION;

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
        for (const cls of ESCALA) {
            if (cls.fcMpa >= fceNum) return descriptorDeClase(cls, 'iram_cirsoc_especificado');
        }
        return descriptorDeClase(ESCALA[ESCALA.length - 1], 'iram_cirsoc_especificado');
    }

    // OBJETIVO: más cercana, empate → preferir superior.
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
