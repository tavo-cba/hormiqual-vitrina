/**
 * Mirror del engine puro de ajuste manual de cemento del backend.
 * Fuente de verdad: `hormiqual-backend/src/domain/dosificacion/ajusteCementoEngine.js`.
 *
 * Por qué tener un espejo: el formulario muestra preview en vivo (mientras el
 * usuario tipea el valor adoptado y elige el motivo) sin viajar al backend
 * en cada keystroke. Al guardar el diseño, el frontend persiste el resultado
 * ajustado + el objeto `ajusteCemento` que el backend valida al loggear el
 * evento en el historial. Si los dos se desincronizaran, los tests del
 * backend lo notarían — el contrato de salida es el mismo.
 *
 * Mantener sincronizado con el backend cuando se modifique la lógica.
 */

import { MOTIVOS_AJUSTE_CEMENTO, validarMotivo } from './motivosAjusteCemento';

export const DELTA_PCT_WARNING = 3;

export function aplicarAjusteCemento(resultado, ajuste = {}) {
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

    const errMotivo = validarMotivo({ motivo: ajuste.motivo, motivoOtro: ajuste.motivoOtro });
    if (errMotivo) {
        errores.push(errMotivo);
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

    const deltaKg = cementoAdoptadoKgM3 - cementoCalculadoKgM3;
    const deltaPct = (deltaKg / cementoCalculadoKgM3) * 100;
    if (Math.abs(deltaPct) > 20) {
        errores.push({
            campo: 'cementoAdoptadoKgM3',
            mensaje: `El ajuste de ${deltaPct.toFixed(1)}% excede el límite operativo del ±20% sobre el valor calculado. Revise el valor o recalcule la dosificación con parámetros distintos.`,
        });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

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

    const volAgregadosTotalAjustado = volAgregadosTotalOriginal - deltaVolCementoM3;
    if (volAgregadosTotalAjustado <= 0) {
        errores.push({
            campo: 'cementoAdoptadoKgM3',
            mensaje: 'El cemento adoptado deja a los agregados sin volumen disponible. Reduzca el valor del cemento.',
        });
        return { resultadoAjustado: null, warnings, ajusteJson: null, errores };
    }

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
        };
    });

    // El motor expone el agua como `aguaLtsM3` (icpaCalcEngine). Leer
    // `resultado.aguaLts` (inexistente) daba a/c = 0,000 en la UI. Fallback
    // a aguaLts/agua por robustez. Mantener sincronizado con el SSoT backend.
    const aguaLts = Number(
      resultado.aguaLtsM3 ?? resultado.aguaLts ?? resultado.agua ?? 0,
    );
    const acEfectivo = cementoAdoptadoKgM3 > 0 ? aguaLts / cementoAdoptadoKgM3 : null;
    const acOriginal = cementoCalculadoKgM3 > 0 ? aguaLts / cementoCalculadoKgM3 : null;

    if (Math.abs(deltaPct) >= DELTA_PCT_WARNING) {
        warnings.push({
            tipo: 'AJUSTE_CEMENTO_MAYOR',
            severidad: 'warning',
            mensaje: `Ajuste de ${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% sobre el cemento calculado. Verifique consistencia con el a/c efectivo (${acEfectivo?.toFixed(3)} vs original ${acOriginal?.toFixed(3)}) y la dosis de aditivos por kg de cemento.`,
        });
    }

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
        volAgregadosOriginalM3: Math.round(volAgregadosTotalOriginal * 10000) / 10000,
        volAgregadosAjustadoM3: Math.round(volAgregadosTotalAjustado * 10000) / 10000,
        warnings,
    };

    const resultadoAjustado = {
        ...resultado,
        cementoKgM3: Math.round(cementoAdoptadoKgM3 * 100) / 100,
        cementoTotalKgM3: resultado.cementoTotalKgM3 != null
            ? Math.round((Number(resultado.cementoTotalKgM3) + deltaKg) * 100) / 100
            : resultado.cementoTotalKgM3,
        agregados: agregadosAjustados,
        volumenAgregados: Math.round(volAgregadosTotalAjustado * 1000) / 1000,
        ajusteCemento: ajusteJson,
    };

    return { resultadoAjustado, warnings, ajusteJson, errores: [] };
}
