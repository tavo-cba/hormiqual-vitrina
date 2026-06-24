'use strict';

/**
 * pastonTimelineEngine — engine puro para el timeline de eventos de un pastón.
 *
 * Cada evento (registro en `MedicionPaston`) representa un momento del ciclo
 * de vida del pastón: medición (asentamiento/T°/aire), acción (agua/aditivo
 * agregado), o ambos. La etapa indica DÓNDE ocurrió el evento (PLANTA,
 * TRANSPORTE, OBRA) y el remanente cuánto hormigón quedaba en ese momento.
 *
 * Este engine encapsula las reglas que se discutieron en sesión 2026-06-12:
 *
 * 1) **Orden cronológico**: los eventos deben respetar el tiempo + la etapa.
 *    No se puede registrar un evento de OBRA con timestamp anterior a uno
 *    de PLANTA, porque el hormigón pasa primero por planta y después por
 *    transporte y obra. El orden de etapas es PLANTA → TRANSPORTE → OBRA.
 *
 * 2) **Remanente monotónicamente decreciente**: el volumen remanente en
 *    el camión nunca puede ser mayor al anterior. Si un evento no declara
 *    remanente explícitamente, hereda el último valor conocido.
 *
 * 3) **Acumulados**: para cada evento se acumula agua y aditivos agregados
 *    a lo largo del timeline, calculando el a/c efectivo en cada paso
 *    considerando el remanente real del camión en ese momento.
 *
 * No toca BD, no usa req/res. Recibe datos planos y devuelve resultados.
 */

const ORDEN_ETAPA = Object.freeze({
    PLANTA: 1,
    TRANSPORTE: 2,
    OBRA: 3,
});

const ETAPAS_VALIDAS = Object.keys(ORDEN_ETAPA);

/**
 * Clasifica un evento según los datos que aporta. No es campo persistido —
 * se deriva en runtime para mostrar en la UI.
 */
function clasificarEvento(evento) {
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

/**
 * Devuelve la lista de eventos ordenada cronológicamente por (etapa, fechaHora,
 * ordenSecuencia). No muta el array original.
 */
function ordenar(eventos) {
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

/**
 * Valida un nuevo evento contra el conjunto existente. Devuelve `null` si OK
 * o un objeto `{ campo, mensaje }` con el primer error encontrado.
 *
 * Reglas:
 *   - Etapa válida.
 *   - No registrar un evento de etapa N con timestamp < último evento de
 *     etapa > N (rompe la cronología física del transporte).
 *   - Si declara remanente, no debe ser mayor al último remanente conocido
 *     (regla monotónicamente decreciente).
 */
function validarEvento(eventosExistentes, nuevoEvento) {
    if (!nuevoEvento || typeof nuevoEvento !== 'object') {
        return { campo: 'evento', mensaje: 'Evento inválido.' };
    }
    if (!ETAPAS_VALIDAS.includes(nuevoEvento.etapa)) {
        return { campo: 'etapa', mensaje: `Etapa "${nuevoEvento.etapa}" inválida. Valores aceptados: ${ETAPAS_VALIDAS.join(', ')}.` };
    }

    const ts = nuevoEvento.fechaHora ? new Date(nuevoEvento.fechaHora).getTime() : null;
    const ordenEtapaNueva = ORDEN_ETAPA[nuevoEvento.etapa];

    // 1) Orden cronológico: no puede ir antes (en tiempo) de un evento de etapa posterior.
    if (Array.isArray(eventosExistentes) && eventosExistentes.length > 0 && ts != null) {
        for (const e of eventosExistentes) {
            if (!e || !e.fechaHora) continue;
            const tsExist = new Date(e.fechaHora).getTime();
            const ordenExist = ORDEN_ETAPA[e.etapa] ?? 99;
            if (ordenEtapaNueva < ordenExist && ts > tsExist) {
                return {
                    campo: 'etapa',
                    mensaje: `No se puede registrar un evento de "${nuevoEvento.etapa}" con timestamp posterior a un evento de "${e.etapa}". El orden físico es PLANTA → TRANSPORTE → OBRA.`,
                };
            }
            if (ordenEtapaNueva > ordenExist && ts < tsExist) {
                return {
                    campo: 'etapa',
                    mensaje: `No se puede registrar un evento de "${nuevoEvento.etapa}" con timestamp anterior a un evento de "${e.etapa}". El orden físico es PLANTA → TRANSPORTE → OBRA.`,
                };
            }
        }
    }

    // 2) Remanente monotónicamente decreciente.
    if (nuevoEvento.volumenRemanenteM3 != null) {
        const remanenteNuevo = Number(nuevoEvento.volumenRemanenteM3);
        if (!Number.isFinite(remanenteNuevo) || remanenteNuevo < 0) {
            return { campo: 'volumenRemanenteM3', mensaje: 'Remanente inválido (debe ser un número ≥ 0).' };
        }
        const ordenados = ordenar(eventosExistentes);
        // Último evento ANTES (en orden cronológico-etapa) del nuevo.
        for (let i = ordenados.length - 1; i >= 0; i--) {
            const prev = ordenados[i];
            const ordenPrev = ORDEN_ETAPA[prev.etapa] ?? 99;
            const tsPrev = prev.fechaHora ? new Date(prev.fechaHora).getTime() : 0;
            const esAnterior = ordenPrev < ordenEtapaNueva
                || (ordenPrev === ordenEtapaNueva && tsPrev <= (ts || 0));
            if (esAnterior && prev.volumenRemanenteM3 != null) {
                const prevRemanente = Number(prev.volumenRemanenteM3);
                if (remanenteNuevo > prevRemanente + 0.001) {
                    return {
                        campo: 'volumenRemanenteM3',
                        mensaje: `El remanente declarado (${remanenteNuevo.toFixed(3)} m³) es mayor al anterior (${prevRemanente.toFixed(3)} m³). El remanente solo puede mantenerse o disminuir.`,
                    };
                }
                break;
            }
        }
    }
    return null;
}

/**
 * Devuelve el remanente vigente en el momento de `evento`. Si el evento
 * declara remanente, devuelve ese. Si no, hereda del último evento anterior
 * que sí lo haya declarado. Si ninguno, devuelve `volumenInicialM3`.
 */
function obtenerRemanenteEnEvento(eventosOrdenados, evento, volumenInicialM3) {
    if (evento && evento.volumenRemanenteM3 != null) {
        return Number(evento.volumenRemanenteM3);
    }
    const idx = eventosOrdenados.findIndex((e) => e === evento || (e.id && e.id === evento?.id));
    const slice = idx >= 0 ? eventosOrdenados.slice(0, idx) : eventosOrdenados;
    for (let i = slice.length - 1; i >= 0; i--) {
        if (slice[i].volumenRemanenteM3 != null) return Number(slice[i].volumenRemanenteM3);
    }
    return volumenInicialM3 != null ? Number(volumenInicialM3) : null;
}

/**
 * Para una serie de eventos + base del pastón, calcula:
 *   - `aguaAcumuladaLts`: suma de agua agregada hasta ese evento (inclusive).
 *   - `aditivosAcumuladosKg`: suma de aditivos agregados (normalizando unidad
 *     a kg cuando es posible — para detalle por aditivo, expandir vía
 *     `aditivosAgregadosJson` en la UI).
 *   - `remanenteVigenteM3`: remanente del camión en ese punto.
 *   - `acEfectivo`: relación agua/cemento considerando el agua acumulada y
 *     el cemento PROPORCIONAL al remanente vigente.
 *
 * @param {Array} eventos
 * @param {object} base — { cementoKgM3, aguaInicialLts, volumenTotalM3 } del pastón.
 * @returns {Array<object>} array paralelo a eventos con campos calculados.
 */
function calcularAcumulados(eventos, base = {}) {
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
        // Sumar agua de este evento.
        const aguaEvento = Number(evento.aguaAgregadaLts) || 0;
        aguaAcumulada += aguaEvento;

        // Sumar aditivos de este evento.
        let aditivosEventoKg = 0;
        if (Array.isArray(evento.aditivosAgregadosJson)) {
            for (const ad of evento.aditivosAgregadosJson) {
                const cant = Number(ad.cantidad) || 0;
                const unidad = String(ad.unidad || 'kg').toLowerCase();
                // Normalización mínima a kg: g → kg, L → kg (asumir densidad 1).
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

        // a/c efectivo: agua total (inicial + acumulada agregada) / cemento equivalente
        // en el remanente vigente. El cemento que QUEDA en el camión es proporcional
        // al volumen remanente: cementoRestante = cementoKgM3 * remanenteVigente.
        // El agua total efectiva incluye la agua inicial proporcional al remanente
        // (porque al sacar parte del hormigón, también se va parte del agua) más
        // toda la agua agregada después (que está distribuida en el remanente).
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

module.exports = {
    ORDEN_ETAPA,
    ETAPAS_VALIDAS,
    clasificarEvento,
    ordenar,
    validarEvento,
    obtenerRemanenteEnEvento,
    calcularAcumulados,
};
