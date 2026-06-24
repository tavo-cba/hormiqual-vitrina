'use strict';

/**
 * ajusteCementoEngine — Ajuste manual de la cantidad de cemento sobre un
 * resultado de dosificación ya calculado.
 *
 * Decisión de producto (sesión 2026-06-11):
 *   - El motor `hormiqualCalcEngine` calcula el cemento determinísticamente.
 *   - El tecnólogo puede adoptar un valor distinto (por redondeo, decisión
 *     del cliente, etc.) y el sistema debe redistribuir el volumen.
 *   - Agua y aditivos NO se tocan automáticamente. Solo se redistribuye el
 *     delta de volumen entre los AGREGADOS manteniendo sus proporciones.
 *   - Si |Δ%| ≥ 3% se emite un warning informativo (no bloqueante) para
 *     que el tecnólogo verifique consistencia (a/c efectivo, dosis de
 *     aditivos por kg cemento, etc.) — pero no exigimos modificaciones.
 *
 * Engine PURO: no toca BD, no hace fetch, no usa req/res. Recibe el
 * `resultado` del motor + parámetros del ajuste y devuelve un nuevo
 * resultado modificado + warnings + un objeto de trazabilidad.
 *
 * Uso típico desde el frontend:
 *   const { resultadoAjustado, warnings, ajusteJson } = aplicarAjusteCemento(
 *     resultadoMotor,
 *     { cementoAdoptadoKgM3: 325, motivo: 'REDONDEO', usuario: '...' }
 *   );
 */

const { validarMotivo, MOTIVOS_AJUSTE_CEMENTO } = require('./motivosAjusteCemento');

// Umbral para warning no bloqueante (sesión 2026-06-11).
const DELTA_PCT_WARNING = 3;

/**
 * Aplica el ajuste manual de cemento sobre un resultado del motor.
 *
 * @param {object} resultado - Salida de `calcularDosificacionHormiqual`. Debe
 *   contener al menos:
 *     - cementoKgM3 (number)
 *     - densidadCementoUsada (number, g/cm³)
 *     - agregados (array con { volAbsolutoM3, kgM3, densidad, ... })
 * @param {object} ajuste
 *   - cementoAdoptadoKgM3 (number, requerido)
 *   - motivo (string, código de MOTIVOS_AJUSTE_CEMENTO)
 *   - motivoOtro (string, requerido si motivo === 'OTRO')
 *   - usuario (string, opcional — para traza)
 *   - fecha (Date|string, opcional — default = now)
 * @returns {object} `{ resultadoAjustado, warnings, ajusteJson, errores }`
 *   - `errores` es array; si tiene elementos NO se aplicó el ajuste.
 */
function aplicarAjusteCemento(resultado, ajuste = {}) {
    const errores = [];
    const warnings = [];

    if (!resultado || typeof resultado !== 'object') {
        errores.push({ campo: 'resultado', mensaje: 'El resultado del motor es requerido.' });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    const cementoCalculadoKgM3 = Number(resultado.cementoKgM3);
    if (!Number.isFinite(cementoCalculadoKgM3) || cementoCalculadoKgM3 <= 0) {
        errores.push({ campo: 'resultado.cementoKgM3', mensaje: 'El resultado no tiene un valor válido de cemento.' });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    const densidadCementoGcm3 = Number(resultado.densidadCementoUsada);
    if (!Number.isFinite(densidadCementoGcm3) || densidadCementoGcm3 <= 0) {
        errores.push({ campo: 'resultado.densidadCementoUsada', mensaje: 'El resultado no tiene densidad de cemento.' });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    const cementoAdoptadoKgM3 = Number(ajuste.cementoAdoptadoKgM3);
    if (!Number.isFinite(cementoAdoptadoKgM3) || cementoAdoptadoKgM3 <= 0) {
        errores.push({ campo: 'cementoAdoptadoKgM3', mensaje: 'El cemento adoptado debe ser un número positivo.' });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    // Validar motivo y motivoOtro.
    const errMotivo = validarMotivo({ motivo: ajuste.motivo, motivoOtro: ajuste.motivoOtro });
    if (errMotivo) {
        errores.push(errMotivo);
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    // Limite duro: ±20% del valor calculado. Más allá es probablemente un
    // error de tipeo o un cambio de dosificación completo, no un "ajuste".
    const deltaKg = cementoAdoptadoKgM3 - cementoCalculadoKgM3;
    const deltaPct = (deltaKg / cementoCalculadoKgM3) * 100;
    if (Math.abs(deltaPct) > 20) {
        errores.push({
            campo: 'cementoAdoptadoKgM3',
            mensaje: `El ajuste de ${deltaPct.toFixed(1)}% excede el límite operativo del ±20% sobre el valor calculado. Revise el valor o recalcule la dosificación con parámetros distintos.`,
        });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    // Re-balance volumétrico: el delta de volumen del cemento se descuenta
    // (o suma) al volumen total de agregados, repartido proporcionalmente.
    const densidadCementoKgM3 = densidadCementoGcm3 * 1000;
    const deltaVolCementoM3 = deltaKg / densidadCementoKgM3;

    const agregados = Array.isArray(resultado.agregados) ? resultado.agregados : [];
    const volAgregadosTotalOriginal = agregados.reduce(
        (sum, ag) => sum + Number(ag.volAbsolutoM3 || 0), 0,
    );

    if (volAgregadosTotalOriginal <= 0) {
        errores.push({
            campo: 'resultado.agregados',
            mensaje: 'El resultado no tiene agregados con volumen positivo para redistribuir el ajuste.',
        });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    // Si cemento sube, agregados bajan (delta vol > 0 → restar a agregados).
    const volAgregadosTotalAjustado = volAgregadosTotalOriginal - deltaVolCementoM3;
    if (volAgregadosTotalAjustado <= 0) {
        errores.push({
            campo: 'cementoAdoptadoKgM3',
            mensaje: 'El cemento adoptado deja a los agregados sin volumen disponible. Reduzca el valor del cemento.',
        });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    // Redistribuir manteniendo proporciones originales.
    const agregadosAjustados = agregados.map((ag) => {
        const volOriginal = Number(ag.volAbsolutoM3 || 0);
        const proporcion = volOriginal / volAgregadosTotalOriginal;
        const volNuevoM3 = proporcion * volAgregadosTotalAjustado;
        const densidad = Number(ag.densidad || 0);
        const kgM3Nuevo = Math.round(volNuevoM3 * densidad * 1000);
        return {
            ...ag,
            volAbsolutoM3: Math.round(volNuevoM3 * 10000) / 10000,
            kgM3: kgM3Nuevo,
            // Conservamos `proporcionNormalizada` (es la proporción de la mezcla
            // dentro de los agregados, no cambia con el ajuste de cemento).
        };
    });

    // a/c efectivo: con el cemento adoptado y agua sin tocar.
    // El motor expone el agua como `aguaLtsM3` (ver hormiqualCalcEngine:2121). El
    // `aguaLts` original no existe en el resultado → daba a/c = 0,000 en la
    // UI. Se mantiene fallback a `aguaLts`/`agua` por robustez.
    const aguaLts = Number(
      resultado.aguaLtsM3 ?? resultado.aguaLts ?? resultado.agua ?? 0,
    );
    const acEfectivo = cementoAdoptadoKgM3 > 0 ? aguaLts / cementoAdoptadoKgM3 : null;
    const acOriginal = cementoCalculadoKgM3 > 0 ? aguaLts / cementoCalculadoKgM3 : null;

    // Warning principal: |Δ%| ≥ 3% sin modificación correspondiente de aditivos/agua.
    if (Math.abs(deltaPct) >= DELTA_PCT_WARNING) {
        warnings.push({
            tipo: 'AJUSTE_CEMENTO_MAYOR',
            severidad: 'warning',
            mensaje: `Ajuste de ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% sobre el cemento calculado. Verifique consistencia con el a/c efectivo (${acEfectivo?.toFixed(3)} vs original ${acOriginal?.toFixed(3)}) y la dosis de aditivos por kg de cemento.`,
        });
    }

    // Trazabilidad — todo lo necesario para reconstruir la decisión.
    const motivoMeta = MOTIVOS_AJUSTE_CEMENTO[ajuste.motivo];
    const fecha = ajuste.fecha
        ? (ajuste.fecha instanceof Date ? ajuste.fecha.toISOString() : String(ajuste.fecha))
        : new Date().toISOString();
    const ajusteJson = {
        aplicado: true,
        cementoCalculadoKgM3: Math.round(cementoCalculadoKgM3 * 100) / 100,
        cementoAdoptadoKgM3: Math.round(cementoAdoptadoKgM3 * 100) / 100,
        deltaKg: Math.round(deltaKg * 100) / 100,
        deltaPct: Math.round(deltaPct * 100) / 100,
        motivo: ajuste.motivo,
        motivoLabel: motivoMeta?.label || ajuste.motivo,
        motivoOtro: ajuste.motivo === 'OTRO' ? String(ajuste.motivoOtro || '').trim() : null,
        usuario: ajuste.usuario || null,
        fecha,
        acOriginal: acOriginal != null ? Math.round(acOriginal * 1000) / 1000 : null,
        acEfectivo: acEfectivo != null ? Math.round(acEfectivo * 1000) / 1000 : null,
        // Snapshot de agregados antes/después (informativo, ayuda a auditar).
        volAgregadosOriginalM3: Math.round(volAgregadosTotalOriginal * 10000) / 10000,
        volAgregadosAjustadoM3: Math.round(volAgregadosTotalAjustado * 10000) / 10000,
        warnings,
    };

    const resultadoAjustado = {
        ...resultado,
        cementoKgM3: Math.round(cementoAdoptadoKgM3 * 100) / 100,
        // El cementoTotalKgM3 (antes de adiciones) se incrementa en el mismo
        // delta — preservamos el efecto de las adiciones sobre el cemento total.
        cementoTotalKgM3: resultado.cementoTotalKgM3 != null
            ? Math.round((Number(resultado.cementoTotalKgM3) + deltaKg) * 100) / 100
            : resultado.cementoTotalKgM3,
        agregados: agregadosAjustados,
        volumenAgregados: Math.round(volAgregadosTotalAjustado * 1000) / 1000,
        ajusteCemento: ajusteJson,
    };

    return { resultadoAjustado, warnings, ajusteJson, errores: [] };
}

module.exports = {
    aplicarAjusteCemento,
    DELTA_PCT_WARNING,
};
