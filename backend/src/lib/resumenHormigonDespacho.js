'use strict';

/**
 * Resumen del hormigón de un despacho para reportes/PDFs/mensajes.
 *
 * Lee de cualquiera de las dos fuentes:
 *   - `Dosificacion` legacy (origen ESTATICA en la planta)
 *   - `DosificacionDisenada` (Diseñador / HRDC / motor de Calidad)
 *
 * Prioriza la del Diseñador si está poblada — es la fuente canónica para
 * despachos nuevos, incluyendo HRDC. Para casos donde el despacho viejo
 * solo tiene legacy, cae a esa.
 *
 * El consumidor debe haber cargado el despacho con los includes apropiados:
 *
 *   include: [
 *     { model: db.Dosificacion, as: 'dosificacion',
 *       include: [{ model: db.TipoHormigon, as: 'tipoHormigon' }] },
 *     { model: db.DosificacionDisenada, as: 'dosificacionDisenada',
 *       required: false,
 *       include: [
 *         { model: db.TipoHormigon, as: 'tipoHormigon', required: false },
 *         { model: db.Cemento,      as: 'cemento',      required: false },
 *       ] },
 *   ]
 *
 * Devuelve campos formateados como strings ('-' cuando vacío) para que el
 * caller los renderice directamente.
 */
function resumirHormigonDelDespacho(d) {
    if (!d) {
        return {
            tipoH: '',
            tmnMm: null,
            tmnLabel: '-',
            asentamientoCm: null,
            asentamientoLabel: '-',
            cementoNombre: '-',
            origen: null,
        };
    }

    const dd = d.dosificacionDisenada;
    const dl = d.dosificacion;

    let tipoH = '';
    let tmnMm = null;
    let asentamientoCm = null;
    let cementoNombre = '';
    let origen = null;

    if (dd) {
        origen = 'DISENADOR';
        // Prioridad: nombre comercial (lo que el cliente pidió, ej. "H-25 F",
        // "HRDC-180") → clase IRAM 1666 base (ej. "H-25") → código autogenerado
        // (ej. "DOS-DSJLUQ.v1"). El nombre es lo que tiene que aparecer en el
        // remito, WhatsApp y costeo porque refleja lo acordado comercialmente
        // (incluye sufijos como "F" para "fácil", "P" para pisos, etc. que la
        // clase IRAM no captura). HRDC y Alivianado tampoco tienen TipoHormigon
        // ligado y suelen llamarse igual que su código (ej. "HRDC-180").
        tipoH = dd.nombre || dd.tipoHormigon?.tipoHormigon || dd.codigo || '';
        const params = typeof dd.parametrosObjetivoJson === 'string'
            ? (() => { try { return JSON.parse(dd.parametrosObjetivoJson); } catch { return null; } })()
            : dd.parametrosObjetivoJson;
        const result = typeof dd.resultadoJson === 'string'
            ? (() => { try { return JSON.parse(dd.resultadoJson); } catch { return null; } })()
            : dd.resultadoJson;
        tmnMm = params?.tmnMm ?? result?.tmnMm ?? null;
        // Asentamiento: el storage del Diseñador guarda en orden de prioridad:
        //   - `asentamientoCm` (legacy)
        //   - `asentamientoMm` (storage actual del wizard, en milímetros)
        //   - `consistenciaValor` (cm — HRDC y Alivianado usan esto)
        //   - `resultadoJson.asentamientoNominalCm` (calculado por el motor)
        if (params?.asentamientoCm != null) {
            asentamientoCm = Number(params.asentamientoCm);
        } else if (params?.asentamientoMm != null) {
            asentamientoCm = Number(params.asentamientoMm) / 10;
        } else if (params?.consistenciaValor != null) {
            asentamientoCm = Number(params.consistenciaValor);
        } else if (result?.asentamientoNominalCm != null) {
            asentamientoCm = Number(result.asentamientoNominalCm);
        }
        cementoNombre = dd.cemento?.nombreComercial || '';
    } else if (dl) {
        origen = 'ESTATICA';
        // Misma prioridad que DD: nombre comercial → clase IRAM como fallback.
        tipoH = dl.nombre || dl.tipoHormigon?.tipoHormigon || '';
        tmnMm = dl.tmnMm ?? dl.tmn ?? dl.tipoHormigon?.tmnMm ?? null;
        asentamientoCm = dl.asentamientoCm ?? dl.asentamiento ?? null;
        cementoNombre = dl.nombreCemento || '';
    }

    // El asentamiento del despacho (declarado por el chofer en obra) tiene
    // prioridad sobre el de la dosificación si está cargado. Es el valor
    // real medido, no el objetivo.
    if (Number.isFinite(Number(d.asentamiento)) && Number(d.asentamiento) > 0) {
        asentamientoCm = Number(d.asentamiento);
    }

    return {
        tipoH: String(tipoH || ''),
        tmnMm,
        tmnLabel: tmnMm != null ? `${tmnMm} mm` : '-',
        asentamientoCm,
        asentamientoLabel: asentamientoCm != null ? `${Number(asentamientoCm)} cm` : '-',
        cementoNombre: cementoNombre || '-',
        origen,
    };
}

/**
 * Devuelve el nombre/descripción de la dosificación para listados.
 * Útil cuando solo querés el "qué hormigón es" sin desglose de campos.
 */
function nombreDosificacionDelDespacho(d) {
    if (!d) return '';
    const dd = d.dosificacionDisenada;
    if (dd) return dd.nombre || dd.codigo || '';
    return d.dosificacion?.nombre || '';
}

/**
 * Includes Sequelize para que un Despacho tenga ambas dosificaciones cargadas
 * con sus relaciones necesarias para `resumirHormigonDelDespacho`. Para evitar
 * repetir esto en cada consumer.
 */
function getDosificacionIncludes(db) {
    const inc = [
        {
            model: db.Dosificacion,
            as: 'dosificacion',
            required: false,
            include: [{ model: db.TipoHormigon, as: 'tipoHormigon', required: false }],
        },
    ];
    if (db.DosificacionDisenada) {
        inc.push({
            model: db.DosificacionDisenada,
            as: 'dosificacionDisenada',
            required: false,
            include: [
                { model: db.TipoHormigon, as: 'tipoHormigon', required: false },
                { model: db.Cemento,      as: 'cemento',      required: false },
            ],
        });
    }
    return inc;
}

module.exports = {
    resumirHormigonDelDespacho,
    nombreDosificacionDelDespacho,
    getDosificacionIncludes,
};
