/**
 * Mirror del engine de timeline de pastón del backend.
 * Fuente de verdad: `hormiqual-backend/src/domain/dosificacion/pastonTimelineEngine.js`.
 * Mantener sincronizado.
 *
 * Se usa en el frontend para calcular en runtime las columnas derivadas del
 * timeline (tipo de evento, acumulados de agua y aditivos, remanente vigente,
 * a/c efectivo) sin viajar al backend en cada render.
 */

export const ORDEN_ETAPA = Object.freeze({
    PLANTA: 1,
    TRANSPORTE: 2,
    OBRA: 3,
});

export const ETAPAS_VALIDAS = Object.keys(ORDEN_ETAPA);

export function clasificarEvento(evento) {
    if (!evento) return 'DESCONOCIDO';
    const tieneMedicion = evento.asentamientoMm != null
        || evento.temperaturaHormigonC != null
        || evento.temperaturaAmbienteC != null
        || evento.aireMedidoPct != null;
    const tieneAccion = (Number(evento.aguaAgregadaLts) || 0) > 0
        || (Number(evento.aditivoAgregadoCantidad) || 0) > 0
        || (Array.isArray(evento.aditivosAgregadosJson) && evento.aditivosAgregadosJson.some((a) => Number(a.cantidad) > 0));
    if (tieneMedicion && tieneAccion) return 'MIXTO';
    if (tieneAccion) return 'ACCION';
    if (tieneMedicion) return 'MEDICION';
    if (evento.volumenRemanenteM3 != null) return 'REMANENTE';
    return 'OBSERVACION';
}

export function ordenar(eventos) {
    if (!Array.isArray(eventos)) return [];
    return [...eventos].sort((a, b) => {
        const ea = ORDEN_ETAPA[a.etapa] ?? 99;
        const eb = ORDEN_ETAPA[b.etapa] ?? 99;
        if (ea !== eb) return ea - eb;
        const ta = a.fechaHora ? new Date(a.fechaHora).getTime() : 0;
        const tb = b.fechaHora ? new Date(b.fechaHora).getTime() : 0;
        if (ta !== tb) return ta - tb;
        return (Number(a.ordenSecuencia) || 0) - (Number(b.ordenSecuencia) || 0);
    });
}

export function validarEvento(eventosExistentes, nuevoEvento) {
    if (!nuevoEvento || typeof nuevoEvento !== 'object') {
        return { campo: 'evento', mensaje: 'Evento inválido.' };
    }
    if (!ETAPAS_VALIDAS.includes(nuevoEvento.etapa)) {
        return { campo: 'etapa', mensaje: `Etapa "${nuevoEvento.etapa}" inválida.` };
    }

    const ts = nuevoEvento.fechaHora ? new Date(nuevoEvento.fechaHora).getTime() : null;
    const ordenEtapaNueva = ORDEN_ETAPA[nuevoEvento.etapa];

    if (Array.isArray(eventosExistentes) && eventosExistentes.length > 0 && ts != null) {
        for (const e of eventosExistentes) {
            if (!e || !e.fechaHora) continue;
            const tsExist = new Date(e.fechaHora).getTime();
            const ordenExist = ORDEN_ETAPA[e.etapa] ?? 99;
            if (ordenEtapaNueva < ordenExist && ts > tsExist) {
                return { campo: 'etapa', mensaje: `No se puede registrar un evento de "${nuevoEvento.etapa}" con timestamp posterior a un evento de "${e.etapa}".` };
            }
            if (ordenEtapaNueva > ordenExist && ts < tsExist) {
                return { campo: 'etapa', mensaje: `No se puede registrar un evento de "${nuevoEvento.etapa}" con timestamp anterior a un evento de "${e.etapa}".` };
            }
        }
    }

    if (nuevoEvento.volumenRemanenteM3 != null) {
        const remanenteNuevo = Number(nuevoEvento.volumenRemanenteM3);
        if (!Number.isFinite(remanenteNuevo) || remanenteNuevo < 0) {
            return { campo: 'volumenRemanenteM3', mensaje: 'Remanente inválido (debe ser un número ≥ 0).' };
        }
        const ordenados = ordenar(eventosExistentes);
        for (let i = ordenados.length - 1; i >= 0; i--) {
            const prev = ordenados[i];
            const ordenPrev = ORDEN_ETAPA[prev.etapa] ?? 99;
            const tsPrev = prev.fechaHora ? new Date(prev.fechaHora).getTime() : 0;
            const esAnterior = ordenPrev < ordenEtapaNueva || (ordenPrev === ordenEtapaNueva && tsPrev <= (ts || 0));
            if (esAnterior && prev.volumenRemanenteM3 != null) {
                const prevRemanente = Number(prev.volumenRemanenteM3);
                if (remanenteNuevo > prevRemanente + 0.001) {
                    return { campo: 'volumenRemanenteM3', mensaje: `El remanente declarado (${remanenteNuevo.toFixed(3)} m³) es mayor al anterior (${prevRemanente.toFixed(3)} m³). El remanente solo puede mantenerse o disminuir.` };
                }
                break;
            }
        }
    }
    return null;
}

export function calcularAcumulados(eventos, base = {}) {
    const ordenados = ordenar(eventos);
    const cementoKgM3 = Number(base.cementoKgM3) || 0;
    const aguaInicialLts = Number(base.aguaInicialLts) || 0;
    const volumenTotalM3 = Number(base.volumenTotalM3) || 1;

    let aguaAcumulada = 0;
    let aditivosAcumuladosKg = 0;
    let remanenteVigente = volumenTotalM3;

    return ordenados.map((evento) => {
        if (evento.volumenRemanenteM3 != null) {
            remanenteVigente = Number(evento.volumenRemanenteM3);
        }
        const aguaEvento = Number(evento.aguaAgregadaLts) || 0;
        aguaAcumulada += aguaEvento;

        let aditivosEventoKg = 0;
        if (Array.isArray(evento.aditivosAgregadosJson)) {
            for (const ad of evento.aditivosAgregadosJson) {
                const cant = Number(ad.cantidad) || 0;
                const unidad = String(ad.unidad || 'kg').toLowerCase();
                if (unidad === 'g')      aditivosEventoKg += cant / 1000;
                else if (unidad === 'cc' || unidad === 'ml') aditivosEventoKg += cant / 1000;
                else                     aditivosEventoKg += cant;
            }
        } else if (evento.aditivoAgregadoCantidad != null) {
            const cant = Number(evento.aditivoAgregadoCantidad) || 0;
            const unidad = String(evento.aditivoAgregadoUnidad || 'kg').toLowerCase();
            if (unidad === 'g' || unidad === 'cc' || unidad === 'ml') aditivosEventoKg += cant / 1000;
            else aditivosEventoKg += cant;
        }
        aditivosAcumuladosKg += aditivosEventoKg;

        const cementoRestanteKg = cementoKgM3 * remanenteVigente;
        const aguaInicialProporcional = aguaInicialLts * (remanenteVigente / volumenTotalM3);
        const aguaTotalEfectiva = aguaInicialProporcional + aguaAcumulada;
        const acEfectivo = cementoRestanteKg > 0 ? aguaTotalEfectiva / cementoRestanteKg : null;

        return {
            ...evento,
            _calc: {
                tipo: clasificarEvento(evento),
                aguaAcumuladaLts: Math.round(aguaAcumulada * 100) / 100,
                aditivosAcumuladosKg: Math.round(aditivosAcumuladosKg * 1000) / 1000,
                remanenteVigenteM3: Math.round(remanenteVigente * 1000) / 1000,
                cementoRestanteKg: Math.round(cementoRestanteKg * 100) / 100,
                aguaTotalEfectivaLts: Math.round(aguaTotalEfectiva * 100) / 100,
                acEfectivo: acEfectivo != null ? Math.round(acEfectivo * 1000) / 1000 : null,
            },
        };
    });
}
