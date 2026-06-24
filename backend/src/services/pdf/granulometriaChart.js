// src/services/pdf/granulometriaChart.js
/**
 * Helper compartido para renderizar el gráfico granulométrico de una curva
 * vs huso DNV o bandas IRAM como PNG Buffer embebible en PDFs.
 *
 * Diseño alineado con `hormiqual-frontend/src/components/calidad/materiales/GranulometriaChart.jsx`:
 *   - Eje X logarítmico numérico (abertura en mm), creciente de izq a der.
 *   - Data como pares {x, y}, no como arrays alineados a labels categóricos.
 *   - Ticks callback que muestra solo aberturas conocidas y formatea µm/mm.
 *   - Curva medida azul `#3B82F6`, banda roja dashed.
 *
 * Consumido por dotacionObraPdfService, loteObraActaPdfService y ensayoPdfService.
 */

'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Canvas a 2× resolución: ChartJS renderiza a tamaño físico y luego escala,
// el resultado embebido en el PDF se ve nítido al zoom.
const chartRenderer = new ChartJSNodeCanvas({
    width: 900,
    height: 480,
    backgroundColour: 'white',
    chartCallback: (ChartJS) => {
        ChartJS.defaults.font.family = 'Helvetica, Arial, sans-serif';
    },
});

const COLOR_CURVA = '#3B82F6';
const COLOR_CURVA_FILL = 'rgba(59,130,246,0.10)';
const COLOR_BANDA = 'rgba(239,68,68,0.75)';
const COLOR_BANDA_FILL = 'rgba(239,68,68,0.08)';

// Aberturas "conocidas" — se usan como grid/ticks (siempre hay línea vertical)
// pero sólo un subconjunto recibe label de texto para evitar solape visual.
const ABERTURAS_TICK_LABELS = [
    0.075, 0.15, 0.3, 0.425, 0.6, 1.18, 2.36, 3.35, 4.75, 6.3,
    9.5, 12.5, 13.2, 16, 19, 25, 26.5, 31.5, 37.5, 50, 53, 63, 75, 100,
];

// Separación mínima en log10(mm) entre dos labels consecutivos. A 900 px de
// ancho y ~3 décadas visibles, 0.045 ≈ 13 px → mínimo para que no se pisen.
const SEP_MIN_LOG_FALLBACK = 0.045;

function formatearAbertura(val) {
    if (val < 1) return `${Math.round(val * 1000)} µm`;
    return `${val} mm`;
}

/**
 * Dada la lista completa de ticks en el dominio visible, elige cuáles reciben
 * label de texto.
 *   - Si se proveen `husoAberturas`, se usan SÓLO esas (el foco del gráfico
 *     es el huso apuntado; los demás ticks quedan como gridlines sin label).
 *   - Si no, se recorre la lista ordenada y se descarta todo tick que esté a
 *     menos de SEP_MIN_LOG_FALLBACK del último labeleado.
 */
function computarEtiquetasVisibles(dominioTicks, husoAberturas) {
    if (Array.isArray(husoAberturas) && husoAberturas.length > 0) {
        const set = new Set(husoAberturas
            .filter((a) => a != null && !isNaN(Number(a)))
            .map((a) => Number(a).toFixed(3)));
        return dominioTicks.filter((a) => set.has(Number(a).toFixed(3)));
    }
    const ordenados = [...dominioTicks].sort((a, b) => a - b);
    const visibles = [];
    let ultimoLog = -Infinity;
    for (const a of ordenados) {
        const l = Math.log10(a);
        if (l - ultimoLog >= SEP_MIN_LOG_FALLBACK) {
            visibles.push(a);
            ultimoLog = l;
        }
    }
    return visibles;
}

/**
 * Renderiza un gráfico de granulometría.
 *
 * @param {Object} params
 * @param {Array<{aberturaMm, designacion?}>} params.tamicesReferencia
 *     Tamices usados para derivar dominio del eje X y (opcionalmente) puntos de la banda.
 * @param {Array<{aberturaMm, pasaPct}>} params.curva - curva medida/combinada
 * @param {Array<{aberturaMm, pasaPctMin, pasaPctMax}>} [params.banda] - banda opcional
 * @param {Array<number>} [params.husoAberturas] - aberturas del huso apuntado;
 *     si se proveen, el eje X muestra labels SÓLO en esas (las demás quedan
 *     como gridlines sin texto). Pensado para gráficos "vs Huso DNV" donde
 *     importan los puntos del Pliego, no toda la serie medida.
 * @param {string} [params.etiquetaCurva='Curva medida']
 * @param {string} [params.etiquetaBanda='Huso DNV']
 * @returns {Promise<Buffer>} PNG
 */
async function renderizarGraficoGranulometria({
    tamicesReferencia,
    curva,
    banda = null,
    husoAberturas = null,
    etiquetaCurva = 'Curva medida',
    etiquetaBanda = 'Huso DNV',
} = {}) {
    if (!Array.isArray(tamicesReferencia) || tamicesReferencia.length === 0) {
        throw new Error('tamicesReferencia vacío');
    }

    // Datos numéricos ordenados ascendente por abertura
    const curvaData = (curva || [])
        .filter((p) => p.aberturaMm != null && p.pasaPct != null)
        .map((p) => ({ x: Number(p.aberturaMm), y: Number(p.pasaPct) }))
        .sort((a, b) => a.x - b.x);

    const datasets = [];

    if (banda && banda.length > 0) {
        const minPoints = banda
            .filter((b) => b.aberturaMm != null && b.pasaPctMin != null)
            .map((b) => ({ x: Number(b.aberturaMm), y: Number(b.pasaPctMin) }))
            .sort((a, b) => a.x - b.x);
        const maxPoints = banda
            .filter((b) => b.aberturaMm != null && b.pasaPctMax != null)
            .map((b) => ({ x: Number(b.aberturaMm), y: Number(b.pasaPctMax) }))
            .sort((a, b) => a.x - b.x);

        if (maxPoints.length > 0) {
            datasets.push({
                label: `${etiquetaBanda} — máx`,
                data: maxPoints,
                borderColor: COLOR_BANDA,
                backgroundColor: 'transparent',
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                fill: false,
                tension: 0,
                order: 3,
            });
        }
        if (minPoints.length > 0) {
            datasets.push({
                label: `${etiquetaBanda} — mín`,
                data: minPoints,
                borderColor: COLOR_BANDA,
                backgroundColor: COLOR_BANDA_FILL,
                borderWidth: 1.5,
                borderDash: [6, 4],
                pointRadius: 0,
                // Fill hacia el dataset anterior (la banda máx) para colorear la franja.
                fill: maxPoints.length > 0 ? '-1' : false,
                tension: 0,
                order: 2,
            });
        }
    }

    datasets.push({
        label: etiquetaCurva,
        data: curvaData,
        borderColor: COLOR_CURVA,
        backgroundColor: COLOR_CURVA_FILL,
        borderWidth: 2.5,
        pointRadius: 5,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1.5,
        pointBackgroundColor: COLOR_CURVA,
        fill: false,
        tension: 0,
        order: 1,
    });

    // Bounds de X dinámicos: min/2 y max*1.5 (igual que frontend)
    const todasAberturas = [
        ...curvaData.map((p) => p.x),
        ...(tamicesReferencia || []).map((t) => Number(t.aberturaMm)).filter((n) => !isNaN(n)),
    ].filter((n) => n > 0);
    const xMin = todasAberturas.length ? Math.max(0.01, Math.min(...todasAberturas) / 2) : 0.05;
    const xMax = todasAberturas.length ? Math.max(...todasAberturas) * 1.5 : 100;

    // Labels visibles del eje X: si hay huso apuntado, sólo sus aberturas.
    // Si no, filtramos por separación mínima en log para que no se pisen.
    const dominioTicks = ABERTURAS_TICK_LABELS.filter((a) => a >= xMin && a <= xMax);
    const labelsVisiblesArr = computarEtiquetasVisibles(dominioTicks, husoAberturas);
    const labelsVisiblesSet = new Set(labelsVisiblesArr.map((a) => Number(a).toFixed(3)));

    const config = {
        type: 'line',
        data: { datasets },
        options: {
            responsive: false,
            devicePixelRatio: 2,
            interaction: { mode: 'nearest', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 11 }, padding: 12 },
                },
                title: { display: false },
            },
            scales: {
                x: {
                    type: 'logarithmic',
                    min: xMin,
                    max: xMax,
                    title: {
                        display: true,
                        text: 'Abertura (mm)',
                        font: { size: 12, weight: 'bold' },
                        padding: { top: 6 },
                    },
                    // Forzamos los ticks a las aberturas conocidas que caen en el dominio
                    // visible. Sin esto, Chart.js en log-scale decide 2-3 potencias de 10
                    // y el callback original solo puede filtrar, no agregar.
                    afterBuildTicks: (axis) => {
                        axis.ticks = ABERTURAS_TICK_LABELS
                            .filter((a) => a >= xMin && a <= xMax)
                            .map((a) => ({ value: a }));
                    },
                    ticks: {
                        callback: (val) => {
                            if (!labelsVisiblesSet.has(Number(val).toFixed(3))) return '';
                            return formatearAbertura(val);
                        },
                        autoSkip: false,
                        maxRotation: 45,
                        minRotation: 30,
                        font: { size: 9 },
                    },
                    grid: { color: 'rgba(0,0,0,0.08)' },
                },
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: '% que pasa',
                        font: { size: 12, weight: 'bold' },
                        padding: { bottom: 6 },
                    },
                    ticks: { stepSize: 10, font: { size: 11 } },
                    grid: { color: 'rgba(0,0,0,0.08)' },
                },
            },
        },
    };

    return chartRenderer.renderToBuffer(config);
}

module.exports = {
    renderizarGraficoGranulometria,
    // Exportado para tests / reuso
    ABERTURAS_TICK_LABELS,
};
