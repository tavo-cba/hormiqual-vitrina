import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import "chart.js/auto";
import { Chart as PrimeChart } from "primereact/chart";
import { SelectButton } from "primereact/selectbutton";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import MezclaTraceDrawer from "../diseno/MezclaTraceDrawer";
import { generarInformeMezclaPdf, chartToBase64 } from "../diseno/mezclaInformePdf";
import PdfSectionSelector from "../common/PdfSectionSelector";
import {
  CATEGORIA_COLORS,
  VEREDICTO,
  getCategoriaVeredicto,
  fromLegacyEval,
} from "../../../lib/compliance";

/* ─────────────── Helpers de mapeo a categorías visuales (Prompt 3 C4) ─────────────── */

/**
 * Decide la categoría visual canónica para un row de las tablas de
 * "Cumplimiento normativo combinado" (fino/grueso/general/single).
 *
 * Orden de preferencia:
 *   1. `row.compliance` canónico anidado (cuando el backend ya lo expone).
 *   2. Mapeo desde el shape legacy del row (`row.cumple` + `row.informativo`).
 *
 * Si la fila legacy es:
 *   - cumple='CUMPLE' + informativo → INFORMATIVO
 *   - cumple='CUMPLE' → APTO
 *   - cumple='NO_CUMPLE' → NO APTO
 *   - sin cumple → EVALUACIÓN INCOMPLETA
 *
 * Hybrid Option B activo: si el backend persiste `compliance.status`
 * canónico en el row (caso Las Quebradas con pasante en zona condicional,
 * petrográfico reactivo, etc.), la categoría se deriva de ese — preserva
 * passWithObservations y conditionalPass que el legacy aplastaría.
 */
function resolveCategoriaRow(row) {
  if (!row) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (row.compliance?.status) return getCategoriaVeredicto(row.compliance);
  if (row.informativo === true && (row.cumple === 'CUMPLE' || row.estado === 'CUMPLE')) {
    return VEREDICTO.INFORMATIVO;
  }
  if (row.cumple === 'CUMPLE' || row.estado === 'CUMPLE') return VEREDICTO.APTO;
  if (row.cumple === 'NO_CUMPLE' || row.estado === 'NO_CUMPLE') return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

/**
 * Decide la categoría visual para las cards de banda A-B / A-C.
 *
 * Si `evalBanda.compliance` (expuesto por C3.5 del backend) trae status
 * canónico, lo usamos. Sino, mapeamos desde el boolean local de la
 * re-evaluación interna del componente.
 *
 * Crítico: una mezcla que cumple A-C pero no A-B trae compliance
 * conditionalPass con condition `requires_technical_evidence` — el card
 * de A-B (que localmente dice "no cumple") debe respetar ese matiz si
 * el endpoint canónico está disponible. Pero las cards a nivel de
 * banda individual son sub-aspectos: usamos el boolean local
 * (similar al patrón de C3 con sub-aspectos).
 */
function resolveCategoriaBanda(boolCumple) {
  return boolCumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
}

/**
 * Decide la categoría visual para el resumen general de la mezcla
 * (Tag "CUMPLE/NO CUMPLE" del bloque "Resultados").
 *
 * Si el endpoint expone `evalBanda.compliance` (post-C3.5), preferimos
 * ese — captura conditionalPass cuando cumple A-C pero no A-B, lo cual
 * es semánticamente "APTITUD CONDICIONADA" en el modelo canónico.
 * Sino fallback al boolean `resumen.cumple`.
 */
function resolveCategoriaResumen(resumen, evalBanda) {
  if (evalBanda?.compliance?.status) return getCategoriaVeredicto(evalBanda.compliance);
  if (resumen?.cumple === true) return VEREDICTO.APTO;
  if (resumen?.cumple === false) return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

const TIPO_COLORS = { FINO: "info", GRUESO: "warning", TOTAL: "success" };
const MODO_LABELS = { BANDA: "Banda", CURVA: "Curva teórica", COMBINADO: "Combinado" };
const PRIO_LABELS = { BANDA: "Banda", CURVA: "Curva teórica" };

/* ═══════════════════════════════════════════
   Chart builders (ported from MezclasPage)
   ═══════════════════════════════════════════ */
// Map alternative sieve aberturas to IRAM principal series
const ALT_TO_IRAM = { 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 12.5: 13.2, 25: 26.5, 50: 53, 13: 13.2 };
function normAb(ab) { return ALT_TO_IRAM[ab] ?? ab; }

function buildMixChartData(curvaMix, isFino) {
  if (!Array.isArray(curvaMix) || !curvaMix.length) return null;
  const points = curvaMix.filter(p => p.pasaPct !== null).map(p => ({ ...p, aberturaMm: normAb(p.aberturaMm) })).sort((a, b) => a.aberturaMm - b.aberturaMm);
  if (points.length < 2) return null;

  const datasets = [{
    label: "Mezcla",
    data: points.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.1)",
    fill: false, tension: 0, pointRadius: 5, pointHoverRadius: 7,
    pointBackgroundColor: "#3B82F6", pointBorderColor: "#fff", pointBorderWidth: 2, borderWidth: 2.5,
    order: 1,
  }];

  // For fino blends, overlay IRAM 1627 bands A, B, C
  if (isFino) {
    const tamices = [0.150, 0.300, 0.600, 1.18, 2.36, 4.75, 9.5];
    const curvaA = [2, 10, 25, 50, 80, 95, 100];
    const curvaB = [10, 30, 60, 85, 100, 100, 100];
    const curvaC = [10, 50, 95, 100, 100, 100, 100];
    const mkPts = (arr) => tamices.map((t, i) => ({ x: t, y: arr[i] }));
    datasets.push({
      label: "Curva A (lim. inf.)", data: mkPts(curvaA),
      borderColor: "rgba(34,197,94,0.7)", borderWidth: 1.5, borderDash: [5, 3],
      pointRadius: 2, fill: false, tension: 0, order: 3,
    });
    datasets.push({
      label: "Curva B (lim. sup. A-B)", data: mkPts(curvaB),
      borderColor: "rgba(239,68,68,0.7)", borderWidth: 1.5, borderDash: [5, 3],
      pointRadius: 2, fill: false, tension: 0, order: 3,
    });
    datasets.push({
      label: "Curva C (lim. sup. A-C)", data: mkPts(curvaC),
      borderColor: "rgba(234,179,8,0.5)", borderWidth: 1.5, borderDash: [3, 3],
      pointRadius: 2, fill: false, tension: 0, order: 3,
    });
  }

  return { datasets };
}

function buildBandaChartData(curvaMix, evalBanda) {
  if (!Array.isArray(curvaMix) || !curvaMix.length || !evalBanda) return null;
  const datasets = [];
  const { bandaMin = [], bandaMax = [] } = evalBanda.series || {};
  if (bandaMax.length) datasets.push({
    label: "Lím. sup.", data: bandaMax.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "rgba(239,68,68,0.75)", backgroundColor: "transparent",
    borderWidth: 1.5, borderDash: [5, 3], pointRadius: 2, fill: false, tension: 0, order: 2,
  });
  if (bandaMin.length) datasets.push({
    label: "Lím. inf.", data: bandaMin.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "rgba(34,197,94,0.75)", backgroundColor: "rgba(34,197,94,0.15)",
    borderWidth: 1.5, borderDash: [5, 3], pointRadius: 2, fill: "-1", tension: 0, order: 2,
  });
  const points = curvaMix.filter(p => p.pasaPct !== null).sort((a, b) => normAb(a.aberturaMm) - normAb(b.aberturaMm));
  if (points.length >= 2) datasets.push({
    label: "Mezcla", data: points.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.15)",
    borderWidth: 3, pointRadius: 5, pointBackgroundColor: "#3B82F6",
    pointBorderColor: "#fff", pointBorderWidth: 2, fill: false, tension: 0, order: 1,
  });
  return datasets.length > 0 ? { datasets } : null;
}

function buildTeoricaChartData(curvaMix, evalTeorica) {
  if (!Array.isArray(curvaMix) || !curvaMix.length || !evalTeorica) return null;
  const datasets = [];
  const curvaRef = evalTeorica.series?.curvaRef || [];
  if (curvaRef.length) datasets.push({
    label: "Curva te\u00f3rica", data: curvaRef.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "rgba(245,158,11,0.8)", backgroundColor: "transparent",
    borderWidth: 2, borderDash: [6, 3], pointRadius: 3, fill: false, tension: 0, order: 2,
  });
  const points = curvaMix.filter(p => p.pasaPct !== null).sort((a, b) => normAb(a.aberturaMm) - normAb(b.aberturaMm));
  if (points.length >= 2) datasets.push({
    label: "Mezcla", data: points.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.15)",
    borderWidth: 3, pointRadius: 5, pointBackgroundColor: "#3B82F6",
    pointBorderColor: "#fff", pointBorderWidth: 2, fill: false, tension: 0, order: 1,
  });
  return datasets.length > 0 ? { datasets } : null;
}

function buildCombinedChartData(curvaMix, evalBanda, evalTeorica) {
  if (!Array.isArray(curvaMix) || !curvaMix.length) return null;
  const datasets = [];
  if (evalBanda) {
    const { bandaMin = [], bandaMax = [] } = evalBanda.series || {};
    if (bandaMax.length) datasets.push({
      label: "L\u00edm. sup.", data: bandaMax.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
      borderColor: "rgba(239,68,68,0.55)", backgroundColor: "transparent",
      borderWidth: 1.2, borderDash: [5, 3], pointRadius: 1, fill: false, tension: 0, order: 3,
    });
    if (bandaMin.length) datasets.push({
      label: "L\u00edm. inf.", data: bandaMin.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
      borderColor: "rgba(34,197,94,0.55)", backgroundColor: "rgba(34,197,94,0.06)",
      borderWidth: 1.2, borderDash: [5, 3], pointRadius: 1, fill: "-1", tension: 0, order: 3,
    });
  }
  if (evalTeorica) {
    const curvaRef = evalTeorica.series?.curvaRef || [];
    if (curvaRef.length) datasets.push({
      label: "Curva te\u00f3rica", data: curvaRef.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
      borderColor: "rgba(245,158,11,0.85)", backgroundColor: "transparent",
      borderWidth: 2, borderDash: [6, 3], pointRadius: 2, fill: false, tension: 0, order: 2,
    });
  }
  const points = curvaMix.filter(p => p.pasaPct !== null).sort((a, b) => normAb(a.aberturaMm) - normAb(b.aberturaMm));
  if (points.length >= 2) datasets.push({
    label: "Mezcla", data: points.map(p => ({ x: normAb(p.aberturaMm), y: p.pasaPct })),
    borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.15)",
    borderWidth: 3, pointRadius: 5, pointBackgroundColor: "#3B82F6",
    pointBorderColor: "#fff", pointBorderWidth: 2, fill: false, tension: 0, order: 1,
  });
  return datasets.length > 0 ? { datasets } : null;
}

const CHART_SCALE_OPTIONS = [
  { label: "Logarítmica", value: "log" },
  { label: "Uniforme", value: "uniform" },
];

function makeChartOptions(isFineScale, chartData, scaleMode = 'log') {
  // Always use IRAM principal sieves (not ASTM alternatives)
  const sieveLabels = isFineScale
    ? [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5]
    : [0.075, 0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 13.2, 19, 26.5, 37.5, 53, 75];

  if (scaleMode === 'uniform') {
    const allX = new Set();
    if (chartData?.datasets) {
      for (const ds of chartData.datasets) for (const pt of ds.data || []) if (pt.x > 0) allX.add(pt.x);
    }
    const sorted = [...allX].sort((a, b) => a - b);
    const xToIdx = new Map();
    sorted.forEach((v, i) => xToIdx.set(v, i));
    return {
      responsive: true, maintainAspectRatio: false, devicePixelRatio: 3,
      interaction: { mode: "nearest", intersect: false },
      _uniformMap: xToIdx,
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Abertura (mm)", font: { size: 14, weight: "bold" } },
          min: -0.5, max: sorted.length - 0.5,
          afterBuildTicks: (axis) => { axis.ticks = sorted.map((_, i) => ({ value: i })); },
          ticks: {
            callback: (val) => { const idx = Math.round(val); return idx >= 0 && idx < sorted.length ? sorted[idx] : ''; },
            autoSkip: false, maxRotation: 45, font: { size: 12 },
          },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y: {
          title: { display: true, text: "% Pasa", font: { size: 14, weight: "bold" } },
          min: 0, max: 100,
          ticks: { stepSize: 10, font: { size: 12 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
      },
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 16, font: { size: 13 }, padding: 18 } },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.85)", titleColor: "#fff", bodyColor: "#fff", padding: 8, cornerRadius: 6,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const idx = Math.round(items[0].parsed.x);
              return idx >= 0 && idx < sorted.length ? `${sorted[idx]} mm` : '';
            },
          },
        },
      },
    };
  }

  // Logarithmic mode
  let dataMin = Infinity, dataMax = -Infinity;
  if (chartData?.datasets) {
    for (const ds of chartData.datasets) {
      for (const pt of ds.data || []) {
        if (pt.x > 0) { if (pt.x < dataMin) dataMin = pt.x; if (pt.x > dataMax) dataMax = pt.x; }
      }
    }
  }
  if (!isFinite(dataMin)) { dataMin = isFineScale ? 0.1 : 0.05; dataMax = isFineScale ? 12 : 100; }
  const xMin = Math.max(0.01, dataMin / 2);
  const xMax = dataMax * 1.5;
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    scales: {
      x: {
        type: "logarithmic",
        title: { display: true, text: "Abertura (mm)", font: { size: 14, weight: "bold" } },
        min: xMin, max: xMax,
        afterBuildTicks: (axis) => {
          axis.ticks = sieveLabels
            .filter((v) => v >= xMin && v <= xMax)
            .map((v) => ({ value: v }));
        },
        ticks: {
          callback: (val) => val,
          autoSkip: false, maxRotation: 45, font: { size: 12 },
        },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y: {
        title: { display: true, text: "% Pasa", font: { size: 14, weight: "bold" } },
        min: 0, max: 100,
        ticks: { stepSize: 10, font: { size: 12 } },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
    },
    plugins: {
      legend: { display: true, position: "bottom", labels: { boxWidth: 16, font: { size: 13 }, padding: 18 } },
      tooltip: { backgroundColor: "rgba(0,0,0,0.85)", titleColor: "#fff", bodyColor: "#fff", padding: 8, cornerRadius: 6 },
    },
  };
}

function applyUniformScale(chartData, uniformMap) {
  if (!chartData?.datasets || !uniformMap) return chartData;
  return {
    ...chartData,
    datasets: chartData.datasets.map(ds => ({
      ...ds,
      data: (ds.data || []).map(pt => {
        const idx = uniformMap.get(pt.x);
        return idx !== undefined ? { ...pt, x: idx } : pt;
      }),
    })),
  };
}

/* ═══════════════════════════════════════════
   Detail page component
   ═══════════════════════════════════════════ */
const MezclaDetallePage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const cfg = useConfig();
  const { user } = useUserContext();
  const mixChartRef = useRef(null);
  const bandaChartRef = useRef(null);
  const teoricaChartRef = useRef(null);
  const combinedChartRef = useRef(null);
  const [mezcla, setMezcla] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chartScale, setChartScale] = useState(() => {
    try { return localStorage.getItem('hq_chartScale') || 'log'; } catch { return 'log'; }
  });
  const [showTrace, setShowTrace] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [propsCombinadas, setPropsCombinadas] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${config.backendUrl}/api/mezclas/${id}`, { headers: config.headers });
        setMezcla(data);

        // Fetch combined properties
        if (data.items?.length > 0) {
          try {
            const propsResp = await axios.post(`${config.backendUrl}/api/mezclas/propiedades-combinadas`, {
              items: data.items.map(it => ({ idAgregado: it.idAgregado, porcentaje: Number(it.porcentajeFinal) })),
              tipoMezcla: data.tipoMezcla || 'FINO',
            }, { headers: config.headers });
            setPropsCombinadas(propsResp.data);
          } catch (e) { console.warn('Could not load combined properties:', e); }
        }
      } catch (err) {
        console.error(err);
        setError("No se pudo cargar la mezcla");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Auto-open PDF dialog if navigated with state.openPdf
  useEffect(() => {
    if (location?.state?.openPdf && mezcla && !loading) {
      setShowPdfDialog(true);
      // Clear the state so it doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [location?.state?.openPdf, mezcla, loading]);

  /* ── Derived data ── */
  const parseJson = (v) => { if (!v) return null; if (typeof v === "string") try { return JSON.parse(v); } catch { return null; } return v; };
  const curvaMixRaw = parseJson(mezcla?.curvaMezclaJson);
  const curvaMix = Array.isArray(curvaMixRaw) ? curvaMixRaw : [];
  const meta = parseJson(mezcla?.metadataResultadoJson) || {};
  const evalBandaSaved = meta.evaluacionBanda || meta.evaluacion;
  const evalTeorica = meta.evaluacionTeorica;
  const isFineScale = mezcla?.tipoMezcla === "FINO";

  // For TOTAL mezclas: load authoritative IRAM 1627 band from endpoint + bandaCompuestaJson
  const [bandaNormativa, setBandaNormativa] = useState(null);
  useEffect(() => {
    const tipo = mezcla?.tipoMezcla;
    if (!tipo) return;
    // For TOTAL and GRUESO, TMN is required; for FINO it's not
    if ((tipo === 'TOTAL' || tipo === 'GRUESO') && !mezcla?.tmnCalculadoMm) return;
    const params = { tipo };
    if (tipo !== 'FINO') params.tmnMm = mezcla.tmnCalculadoMm;
    axios.get(`${config.backendUrl}/api/mezclas/banda-iram1627`, {
      headers: config.headers,
      params,
    }).then(res => {
      if (res.data?.found) {
        setBandaNormativa(res.data);
      } else {
        console.warn('[MezclaDetalle] Banda normativa no encontrada para', tipo, mezcla?.tmnCalculadoMm);
      }
    }).catch(err => {
      console.warn('[MezclaDetalle] Error cargando banda normativa:', err.message);
    });
  }, [mezcla?.tipoMezcla, mezcla?.tmnCalculadoMm]);

  // Helper: build evalBanda from band puntos array [{aberturaMm, limInf/limInfPct, limSup/limSupPct}]
  // Computes desvio per sieve and tracks max deviation (BUG-1 fix)
  const buildEvalFromBanda = useCallback((bandaPuntos) => {
    if (!bandaPuntos?.length || !curvaMix.length) return null;
    const bandaMin = bandaPuntos.map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.limInf ?? p.limInfPct })).filter(p => p.pasaPct != null);
    const bandaMax = bandaPuntos.map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.limSup ?? p.limSupPct })).filter(p => p.pasaPct != null);
    const medida = curvaMix.filter(p => p.pasaPct != null).map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct }));
    let nFuera = 0;
    let peorDesvio = 0;
    const fueraDeBanda = [];
    for (const bp of bandaPuntos) {
      const inf = bp.limInf ?? bp.limInfPct;
      const sup = bp.limSup ?? bp.limSupPct;
      if (inf == null || sup == null) continue;
      const mixPt = curvaMix.find(p => Math.abs(p.aberturaMm - bp.aberturaMm) < bp.aberturaMm * 0.05 + 0.01);
      if (!mixPt || mixPt.pasaPct == null) continue;
      const pasa = mixPt.pasaPct;
      if (pasa < inf || pasa > sup) {
        nFuera++;
        // Compute signed desvio: negative if below lower limit, positive if above upper limit
        let desvio = 0;
        if (pasa < inf) desvio = pasa - inf; // negative
        else if (pasa > sup) desvio = pasa - sup; // positive
        const desvioAbs = Math.abs(desvio);
        if (desvioAbs > peorDesvio) peorDesvio = desvioAbs;
        fueraDeBanda.push({
          aberturaMm: bp.aberturaMm,
          tamiz: bp.tamiz || `${bp.aberturaMm} mm`,
          medido: Math.round(pasa * 100) / 100,
          min: inf,
          max: sup,
          desvio: Math.round(desvio * 100) / 100,
        });
      }
    }
    return {
      cumple: nFuera === 0,
      fueraDeBanda,
      series: { medida, bandaMin, bandaMax },
      stats: { nFuera, peorDesvioPct: Math.round(peorDesvio * 100) / 100 },
    };
  }, [curvaMix]);

  // Re-build evalBanda: prefer normative endpoint data, then bandaCompuestaJson, then saved metadata
  // Implements dual A-B / A-C evaluation aligned with backend logic (BUG-2 fix)
  const evalBanda = useMemo(() => {
    // Source 1: normative endpoint (most authoritative, async-loaded)
    if (bandaNormativa && curvaMix.length) {
      const evalAB = buildEvalFromBanda(bandaNormativa.bandaAB);
      if (evalAB?.cumple) {
        return { ...evalAB, estado: 'CUMPLE', bandaEvaluada: 'A-B' };
      }
      const evalAC = buildEvalFromBanda(bandaNormativa.bandaAC);
      if (evalAC?.cumple) {
        // Cumple A-C pero no A-B → CUMPLE_AC (observation, not blocking)
        return {
          ...evalAC,
          estado: 'CUMPLE_AC',
          bandaEvaluada: 'A-C',
          fueraDeBanda: evalAB?.fueraDeBanda || [],
          stats: { ...evalAC.stats, nFueraAB: evalAB?.stats?.nFuera || 0, maxDesvioAB: evalAB?.stats?.peorDesvioPct || 0 },
        };
      }
      // No cumple ni A-C
      const ref = evalAC || evalAB;
      return { ...ref, estado: 'NO_CUMPLE', bandaEvaluada: evalAC ? 'A-C' : 'A-B' };
    }
    // Source 2: mezcla.banda.puntos (for FINO/GRUESO only — TOTAL bands in DB may be incorrect)
    if (mezcla?.tipoMezcla !== 'TOTAL') {
      const bandaPuntos = mezcla?.banda?.puntos;
      if (bandaPuntos?.length && curvaMix.length) {
        const ptsWithLimits = bandaPuntos.filter(p => p.limInfPct != null || p.limSupPct != null);
        if (ptsWithLimits.length >= 3) return buildEvalFromBanda(ptsWithLimits);
      }
    }
    // Source 3: saved evaluation metadata (legacy fallback — only if no better source available)
    return evalBandaSaved;
  }, [bandaNormativa, curvaMix, mezcla?.banda, mezcla?.tipoMezcla, evalBandaSaved, buildEvalFromBanda]);

  // Recalculate TMN from curvaMix (in case saved value is stale)
  const tmnRecalc = useMemo(() => {
    if (!curvaMix.length) return null;
    const sorted = [...curvaMix].filter(p => p.pasaPct != null).sort((a, b) => b.aberturaMm - a.aberturaMm);
    let tmn = null;
    for (const pt of sorted) {
      if (pt.pasaPct >= 95) tmn = pt.aberturaMm;
      else break;
    }
    return tmn;
  }, [curvaMix]);

  /* ── Auto-evaluación bandas A-B / A-C para mezclas de finos ── */
  const BANDA_FINO = useMemo(() => ({
    tamices: [9.5, 4.75, 2.36, 1.18, 0.600, 0.300, 0.150],
    curvaA:  [100,   95,   80,   50,    25,    10,     2],
    curvaB:  [100,  100,  100,   85,    60,    30,    10],
    curvaC:  [100,  100,  100,  100,    95,    50,    10],
  }), []);

  const evalAutoFino = useMemo(() => {
    if (!isFineScale || !curvaMix.length) return null;
    // Build lookup: abertura → pasaPct
    const lookup = {};
    for (const p of curvaMix) {
      if (p.pasaPct != null) lookup[p.aberturaMm] = p.pasaPct;
    }
    // Evaluate against A-B and A-C
    const evaluate = (limInf, limSup, nombre) => {
      const detalle = [];
      let fuera = 0, peorDesvio = 0;
      for (let i = 0; i < BANDA_FINO.tamices.length; i++) {
        const ab = BANDA_FINO.tamices[i];
        const pasa = lookup[ab] ?? lookup[String(ab)];
        if (pasa == null) continue;
        const dentro = pasa >= limInf[i] && pasa <= limSup[i];
        const desvio = !dentro ? (pasa < limInf[i] ? limInf[i] - pasa : pasa - limSup[i]) : 0;
        if (!dentro) fuera++;
        if (desvio > peorDesvio) peorDesvio = desvio;
        detalle.push({ abertura: ab, pasa, limInf: limInf[i], limSup: limSup[i], dentro, desvio });
      }
      return { nombre, cumple: fuera === 0, fuera, peorDesvio: Math.round(peorDesvio), detalle };
    };
    const ab = evaluate(BANDA_FINO.curvaA, BANDA_FINO.curvaB, 'A-B');
    const ac = evaluate(BANDA_FINO.curvaA, BANDA_FINO.curvaC, 'A-C');
    // MF check
    const mf = mezcla?.moduloFinura;
    const mfOk = mf != null ? (mf >= 2.3 && mf <= 3.1) : null;
    return { bandaAB: ab, bandaAC: ac, mf, mfOk };
  }, [isFineScale, curvaMix, BANDA_FINO, mezcla?.moduloFinura]);

  /* ── Reference labels for PDF and chart legends ── */
  const bandaRef = useMemo(() => {
    if (!mezcla) return null;
    // If normative data loaded, label reflects which band is actually used
    if (bandaNormativa) {
      const evalAB = buildEvalFromBanda(bandaNormativa.bandaAB);
      const usedBand = evalAB?.cumple ? 'A-B' : 'A-C';
      const tipoLabel = bandaNormativa.tipo === 'FINO' ? 'Fino' : bandaNormativa.tipo === 'GRUESO' ? 'Grueso' : 'Total';
      const tmnPart = bandaNormativa.tmnMm ? ` — TMN ${bandaNormativa.tmnMm}` : '';
      return `IRAM 1627 — ${tipoLabel}${tmnPart} — Banda ${usedBand} (${bandaNormativa.tablaRef || ''})`;
    }
    const bc = parseJson(mezcla.bandaCompuestaJson);
    if (bc?.label) return bc.label;
    if (meta._refs?.bandaLabel) return meta._refs.bandaLabel;
    if (mezcla.banda?.nombre) return mezcla.banda.nombre;
    return null;
  }, [mezcla, meta, bandaNormativa, buildEvalFromBanda]);

  const teoricaRef = useMemo(() => {
    if (!mezcla) return null;
    if (meta._refs?.teoricaLabel) return meta._refs.teoricaLabel;
    if (!mezcla.curvaTeorica) return null;
    const c = mezcla.curvaTeorica;
    return `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ''}`;
  }, [mezcla, meta]);

  const bandaTmn = useMemo(() => {
    if (!mezcla) return null;
    const bc = parseJson(mezcla.bandaCompuestaJson);
    if (bc?.tmnMm != null) return Number(bc.tmnMm);
    if (mezcla.banda?.tmnMm != null) return Number(mezcla.banda.tmnMm);
    return null;
  }, [mezcla]);

  /* ── Chart data (memoized) ── */
  const mixChartData = useMemo(() => buildMixChartData(curvaMix, isFineScale), [curvaMix, isFineScale]);
  const mixChartOpts = useMemo(() => makeChartOptions(isFineScale, mixChartData, chartScale), [isFineScale, mixChartData, chartScale]);

  const bandaChartData = useMemo(() => {
    const data = buildBandaChartData(curvaMix, evalBanda);
    if (!data || !bandaRef) return data;
    const shortRef = bandaRef.split(' — ').pop();
    return {
      ...data,
      datasets: data.datasets.map((ds) => {
        if (ds.label === 'Límite superior') return { ...ds, label: `${shortRef} — Lím. sup.` };
        if (ds.label === 'Límite inferior') return { ...ds, label: `${shortRef} — Lím. inf.` };
        return ds;
      }),
    };
  }, [curvaMix, evalBanda, bandaRef]);
  const bandaChartOpts = useMemo(() => makeChartOptions(isFineScale, bandaChartData, chartScale), [isFineScale, bandaChartData, chartScale]);

  const teoricaChartData = useMemo(() => {
    const data = buildTeoricaChartData(curvaMix, evalTeorica);
    if (!data || !teoricaRef) return data;
    const shortRef = teoricaRef.split(' — ')[0];
    return {
      ...data,
      datasets: data.datasets.map((ds) =>
        ds.label === 'Curva teórica' ? { ...ds, label: shortRef } : ds
      ),
    };
  }, [curvaMix, evalTeorica, teoricaRef]);
  const teoricaChartOpts = useMemo(() => makeChartOptions(isFineScale, teoricaChartData, chartScale), [isFineScale, teoricaChartData, chartScale]);

  const combinedChartData = useMemo(() => {
    const data = buildCombinedChartData(curvaMix, evalBanda, evalTeorica);
    if (!data) return data;
    const shortBanda = bandaRef ? bandaRef.split(' — ').pop() : null;
    const shortTeorica = teoricaRef ? teoricaRef.split(' — ')[0] : null;
    return {
      ...data,
      datasets: data.datasets.map((ds) => {
        if (ds.label === 'Límite superior' && shortBanda) return { ...ds, label: `${shortBanda} — Lím. sup.` };
        if (ds.label === 'Límite inferior' && shortBanda) return { ...ds, label: `${shortBanda} — Lím. inf.` };
        if (ds.label === 'Curva teórica' && shortTeorica) return { ...ds, label: shortTeorica };
        return ds;
      }),
    };
  }, [curvaMix, evalBanda, evalTeorica, bandaRef, teoricaRef]);
  const combinedChartOpts = useMemo(() => makeChartOptions(isFineScale, combinedChartData, chartScale), [isFineScale, combinedChartData, chartScale]);

  /* ── Absorción ponderada de la mezcla (a partir de Agregado.absorcion) ── */
  const absorcionMezcla = useMemo(() => {
    const items = mezcla?.items || [];
    if (items.length === 0) return null;
    const totalPct = items.reduce((s, it) => s + Number(it.porcentajeFinal || 0), 0);
    if (totalPct === 0) return null;
    const sinAbsorcion = items
      .filter(it => it.agregado?.absorcion == null)
      .map(it => it.agregado?.nombre || `ID ${it.idAgregado}`);
    if (sinAbsorcion.length > 0) {
      return {
        absorcionPonderada: null,
        cobertura: items.some(it => it.agregado?.absorcion != null) ? 'PARCIAL' : 'NINGUNA',
        sinAbsorcion,
      };
    }
    const absorcionPonderada = items.reduce((sum, it) => {
      const pctNorm = Number(it.porcentajeFinal) / totalPct;
      return sum + pctNorm * Number(it.agregado.absorcion);
    }, 0);
    return {
      absorcionPonderada: Math.round(absorcionPonderada * 100) / 100,
      cobertura: 'COMPLETA',
      sinAbsorcion: [],
    };
  }, [mezcla]);

  /* ── Uniform-scale transformed chart data ── */
  const mixChartFinal = useMemo(() => mixChartOpts?._uniformMap ? applyUniformScale(mixChartData, mixChartOpts._uniformMap) : mixChartData, [mixChartData, mixChartOpts]);
  const bandaChartFinal = useMemo(() => bandaChartOpts?._uniformMap ? applyUniformScale(bandaChartData, bandaChartOpts._uniformMap) : bandaChartData, [bandaChartData, bandaChartOpts]);
  const teoricaChartFinal = useMemo(() => teoricaChartOpts?._uniformMap ? applyUniformScale(teoricaChartData, teoricaChartOpts._uniformMap) : teoricaChartData, [teoricaChartData, teoricaChartOpts]);
  const combinedChartFinal = useMemo(() => combinedChartOpts?._uniformMap ? applyUniformScale(combinedChartData, combinedChartOpts._uniformMap) : combinedChartData, [combinedChartData, combinedChartOpts]);

  /* ── Duplicar ── */
  const handleDuplicar = async () => {
    try {
      const { data } = await axios.post(
        `${config.backendUrl}/api/mezclas/${id}/duplicar`, {},
        { headers: config.headers }
      );
      toast.current?.show({ severity: "success", summary: "Duplicada", detail: `Se creó "${data.nombre}"` });
      navigate(`/calidad/catalogos/mezclas/${data.idMezcla}`);
    } catch (err) {
      console.error(err);
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudo duplicar la mezcla" });
    }
  };

  const handleDuplicarYEditar = async () => {
    try {
      const { data } = await axios.post(
        `${config.backendUrl}/api/mezclas/${id}/duplicar`, {},
        { headers: config.headers }
      );
      toast.current?.show({ severity: "success", summary: "Duplicada", detail: `Se creó "${data.nombre}". Abriendo editor…` });
      navigate('/calidad/diseno', { state: { editMezcla: data } });
    } catch (err) {
      console.error(err);
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudo duplicar la mezcla" });
    }
  };

  const handleExportPdf = useCallback(async (pdfOpts = {}) => {
    setShowPdfDialog(false);
    try {
      const chartImages = {
        mix: chartToBase64(mixChartRef),
        banda: chartToBase64(bandaChartRef),
        teorica: chartToBase64(teoricaChartRef),
        combinada: chartToBase64(combinedChartRef),
      };

      await generarInformeMezclaPdf({
        isDraft: false,
        nombre: pdfOpts.titulo || mezcla.nombre,
        empresa: cfg?.nombreEmpresa,
        planta: mezcla.planta?.nombre,
        usuario: user ? `${user.name || ''} ${user.lastname || ''}`.trim() : null,
        tipoMezcla: mezcla.tipoMezcla,
        modo: mezcla.objetivoModo === 'BANDA' || mezcla.objetivoModo === 'CURVA' || mezcla.objetivoModo === 'COMBINADO' ? 'AUTO' : 'MANUAL',
        objetivoModo: mezcla.objetivoModo,
        prioridad1: mezcla.prioridad1,
        prioridad2: mezcla.prioridad2,
        tmn: (tmnRecalc ?? mezcla.tmnCalculadoMm),
        mf: mezcla.moduloFinura,
        componentes: (mezcla.items || []).map(it => ({
          id: it.idAgregado,
          nombre: it.agregado?.nombre,
          tipo: it.agregado
            ? (it.agregado.agregadoFino ? 'Fino' : it.agregado.agregadoGrueso ? 'Grueso' : 'Desconocido')
            : null,
          origen: it.agregado?.origen,
          porcentaje: it.porcentajeFinal,
        })),
        curvaMix,
        evalBanda,
        evalTeorica,
        optimizacion: meta.optimizacion,
        resumen: meta.resumen,
        trazabilidad: meta.trazabilidad,
        logoUrl: cfg?.thumbnail,
        chartImages,
        descripcion: mezcla.descripcion,
        includeAnexo: pdfOpts.secciones?.anexoTrazabilidad ?? pdfOpts.includeAnexo ?? false,
        includeGlosario: pdfOpts.secciones?.glosario ?? pdfOpts.includeGlosario ?? true,
        secciones: pdfOpts.secciones || null,
        ordenAgregados: pdfOpts.ordenAgregados ?? 'actual',
        bandaRef,
        teoricaRef,
        bandaTmn,
        propsCombinadas: propsCombinadas || null,
        evaluacionProps: propsCombinadas?.evaluacion || null,
        bandaNormativa: bandaNormativa || null,
        estado: mezcla.estado,
        ajusteMetadata: (() => {
          // Build ajusteMetadata from mezcla fields if available
          let propOptimas = mezcla.proporcionesOptimasJson;
          if (typeof propOptimas === 'string') try { propOptimas = JSON.parse(propOptimas); } catch { propOptimas = null; }
          if (!propOptimas && !mezcla.motivoAjuste) return null;
          // propOptimas is { "nombreAgregado": porcentaje } — convert to { id: porcentaje } for PDF
          const optMap = {};
          if (propOptimas && typeof propOptimas === 'object' && !Array.isArray(propOptimas)) {
            // Map by name → need to match with component names
            const items = mezcla.items || [];
            for (const [nombre, pct] of Object.entries(propOptimas)) {
              const item = items.find(it => it.agregado?.nombre === nombre);
              if (item) optMap[item.idAgregado] = pct;
              else optMap[nombre] = pct; // fallback: keep name as key
            }
          }
          let mOpt = mezcla.metricasOptimoJson;
          if (typeof mOpt === 'string') try { mOpt = JSON.parse(mOpt); } catch { mOpt = null; }
          let mAdopt = mezcla.metricasAdoptadoJson;
          if (typeof mAdopt === 'string') try { mAdopt = JSON.parse(mAdopt); } catch { mAdopt = null; }
          return {
            proporciones_optimas: optMap,
            calidad_ajuste: mezcla.calidadAjuste || null,
            motivo_ajuste: mezcla.motivoAjuste || null,
            metricas: { optimo: mOpt, adoptado: mAdopt },
          };
        })(),
      });

      toast.current?.show({ severity: 'success', summary: 'PDF generado', detail: 'Se descargó el informe correctamente' });
    } catch (err) {
      console.error('Error generando PDF:', err);
      toast.current?.show({ severity: 'error', summary: 'Error', detail: 'No se pudo generar el PDF' });
    }
  }, [mezcla, curvaMix, evalBanda, evalTeorica, meta, cfg, user, toast, bandaRef, teoricaRef, bandaTmn]);

  if (loading) return <LoadSpinner />;
  if (error || !mezcla) return (
    <div className="p-4 text-center">
      <h2>{error || "Mezcla no encontrada"}</h2>
      <Button label="Volver al catálogo" icon="fa-solid fa-arrow-left" className="mt-3" onClick={() => window.history.back()} />
    </div>
  );

  const formatDate = (d) => d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const resumen = meta.resumen || {};
  const optInfo = meta.optimizacion || {};

  return (
    <div className="w-full flex flex-column xl:p-6 xl:pl-0 xl:pt-0">
      <PageHeader title={mezcla.nombre} icon="fa-solid fa-blender" />

      {/* ── Action bar ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Button label="Duplicar" icon="fa-solid fa-copy" className="p-button-outlined p-button-secondary" onClick={handleDuplicar} />
        <Button label="Duplicar y editar" icon="fa-solid fa-pen-to-square" className="p-button-outlined" onClick={handleDuplicarYEditar} />
        <Button label="Exportar informe PDF" icon="fa-solid fa-file-pdf" className="p-button-outlined p-button-secondary" onClick={() => setShowPdfDialog(true)} />
      </div>

      {/* ── Info cards ── */}
      <div className="grid mb-4">
        <div className="col-12 md:col-6 lg:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Planta</small>
            <div className="font-bold mt-1">{mezcla.planta?.nombre || "—"}</div>
          </div>
        </div>
        <div className="col-12 md:col-6 lg:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Tipo de mezcla</small>
            <div className="mt-1"><Tag value={mezcla.tipoMezcla} severity={TIPO_COLORS[mezcla.tipoMezcla] || "secondary"} /></div>
          </div>
        </div>
        <div className="col-12 md:col-6 lg:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Modo de optimización</small>
            <div className="font-bold mt-1">{mezcla.objetivoModo ? MODO_LABELS[mezcla.objetivoModo] || mezcla.objetivoModo : "—"}</div>
          </div>
        </div>
        <div className="col-12 md:col-6 lg:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Fecha de creación</small>
            <div className="font-bold mt-1">{formatDate(mezcla.createdAt)}</div>
          </div>
        </div>
      </div>

      {/* ── TMN / MF / Absorción / Prioridades row ── */}
      <div className="grid mb-4">
        <div className="col-6 md:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">TMN</small>
            <div className="font-bold mt-1 text-xl">{(tmnRecalc ?? mezcla.tmnCalculadoMm) != null ? `${(tmnRecalc ?? mezcla.tmnCalculadoMm)} mm` : "—"}</div>
          </div>
        </div>
        <div className="col-6 md:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Módulo de finura</small>
            <div className="font-bold mt-1 text-xl">{mezcla.moduloFinura != null ? Number(mezcla.moduloFinura).toFixed(2) : "—"}</div>
          </div>
        </div>
        <div className="col-6 md:col-3">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Absorción ponderada</small>
            {absorcionMezcla?.cobertura === 'COMPLETA' ? (
              <div className="font-bold mt-1 text-xl">{absorcionMezcla.absorcionPonderada} %</div>
            ) : propsCombinadas?.combinadas?.absorcionPct != null ? (
              <div className="font-bold mt-1 text-xl">{propsCombinadas.combinadas.absorcionPct.toFixed(1)} %</div>
            ) : absorcionMezcla?.cobertura === 'PARCIAL' ? (
              <div className="mt-1 text-sm text-orange-600">Parcial — faltan: {absorcionMezcla.sinAbsorcion.join(", ")}</div>
            ) : (
              <div className="mt-1 text-sm text-color-secondary">Sin datos de absorción</div>
            )}
          </div>
        </div>
        {mezcla.objetivoModo === "COMBINADO" && (
          <>
            <div className="col-6 md:col-3">
              <div className="surface-card shadow-1 border-round p-3">
                <small className="text-color-secondary">Prioridad 1</small>
                <div className="font-bold mt-1">{PRIO_LABELS[mezcla.prioridad1] || "—"}</div>
              </div>
            </div>
            <div className="col-6 md:col-3">
              <div className="surface-card shadow-1 border-round p-3">
                <small className="text-color-secondary">Prioridad 2</small>
                <div className="font-bold mt-1">{PRIO_LABELS[mezcla.prioridad2] || "—"}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Agregados table ── */}
      <h3 className="mt-0 mb-2"><i className="fa-solid fa-layer-group mr-2" />Agregados ({mezcla.items?.length || 0})</h3>
      {(() => {
        // Parse proporciones optimas for comparison
        let propOptimas = mezcla.proporcionesOptimasJson;
        if (typeof propOptimas === 'string') try { propOptimas = JSON.parse(propOptimas); } catch { propOptimas = null; }
        const hasPropOptimas = propOptimas && typeof propOptimas === 'object' && Object.keys(propOptimas).length > 0;
        const hasAjuste = mezcla.motivoAjuste || (mezcla.calidadAjuste && mezcla.calidadAjuste !== '--');
        // propOptimas is an object { "nombreAgregado": porcentaje, ... }
        const getOptimo = (row) => {
          if (!hasPropOptimas) return null;
          const nombre = row.agregado?.nombre;
          if (nombre && propOptimas[nombre] != null) return propOptimas[nombre];
          // Try partial match (handles quotes differences)
          for (const [key, val] of Object.entries(propOptimas)) {
            if (nombre && (key.includes(nombre) || nombre.includes(key))) return val;
          }
          // Try stripping quotes for matching
          if (nombre) {
            const stripped = nombre.replace(/['"]/g, '');
            for (const [key, val] of Object.entries(propOptimas)) {
              if (key.replace(/['"]/g, '') === stripped) return val;
            }
          }
          return null;
        };

        // Build rows with optimo data pre-calculated to avoid conditional Column issues
        const tableItems = (mezcla.items || []).map(it => {
          const opt = getOptimo(it);
          const adopted = Number(it.porcentajeFinal);
          const dif = (opt != null) ? adopted - opt : null;
          return { ...it, _optimo: opt, _adopted: adopted, _dif: dif };
        });

        return (
          <>
            <DataTable responsiveLayout="scroll" value={tableItems} size="small" stripedRows className="mb-3" emptyMessage="Sin agregados">
              <Column header="#" body={(_, opts) => opts.rowIndex + 1} style={{ width: "50px" }} />
              <Column header="Agregado" body={(row) => row.agregado?.nombre || `ID ${row.idAgregado}`} sortable />
              <Column header="Origen" body={(row) => row.agregado?.origen || "—"} />
              <Column header={hasPropOptimas ? "% Optimo" : ""} style={{ width: hasPropOptimas ? "100px" : "0px", display: hasPropOptimas ? undefined : 'none' }} className="text-center"
                body={(row) => hasPropOptimas ? (row._optimo != null ? `${Number(row._optimo).toFixed(1)} %` : '—') : null}
              />
              <Column header="% Adoptado" style={{ width: "100px" }} className="text-center font-bold"
                body={(row) => `${row._adopted.toFixed(1)} %`}
              />
              <Column header={hasPropOptimas ? "Dif." : ""} style={{ width: hasPropOptimas ? "80px" : "0px", display: hasPropOptimas ? undefined : 'none' }} className="text-center"
                body={(row) => {
                  if (!hasPropOptimas || row._dif == null) return null;
                  if (Math.abs(row._dif) < 0.05) return <span className="text-color-secondary">—</span>;
                  return <span style={{ color: row._dif > 0 ? '#f59e0b' : '#3b82f6' }}>{row._dif > 0 ? '+' : ''}{row._dif.toFixed(1)} %</span>;
                }}
              />
              <Column
                header="Absorción"
                style={{ width: "100px" }}
                body={(row) => {
                  const fromModel = row.agregado?.absorcion;
                  if (fromModel != null) return `${Number(fromModel).toFixed(1)} %`;
                  const comp = propsCombinadas?.componentes?.find(c => c.idAgregado === row.idAgregado);
                  const fromEnsayo = comp?.propiedades?.absorcionPct;
                  if (fromEnsayo != null) return `${Number(fromEnsayo).toFixed(1)} %`;
                  return <span className="text-color-secondary text-xs">Sin dato</span>;
                }}
              />
            </DataTable>
            {hasAjuste && (
              <div className="surface-ground border-round p-3 mb-3">
                <div className="flex align-items-center gap-2 mb-1">
                  <i className="fa-solid fa-sliders text-primary" />
                  <strong className="text-sm">Ajuste manual post-optimización</strong>
                </div>
                {mezcla.motivoAjuste && (
                  <small className="text-color-secondary">Motivo: {mezcla.motivoAjuste}</small>
                )}
              </div>
            )}
          </>
        );
      })()}

      <Divider />

      {/* ── Chart scale toggle ── */}
      <div className="flex align-items-center gap-2 mb-3">
        <SelectButton
          value={chartScale}
          options={CHART_SCALE_OPTIONS}
          onChange={(e) => {
            if (e.value) {
              setChartScale(e.value);
              try { localStorage.setItem('hq_chartScale', e.value); } catch {}
            }
          }}
          className="p-selectbutton-sm"
          allowEmpty={false}
        />
        {meta.trazabilidad && (
          <Button
            label="Ver trazabilidad"
            icon="fa-solid fa-magnifying-glass-chart"
            className="p-button-outlined p-button-sm"
            onClick={() => setShowTrace(true)}
          />
        )}
      </div>

      {/* ── Gráfico de mezcla ── */}
      {mixChartFinal && (
        <div className="mb-4">
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-chart-line mr-2" />Curva granulométrica de la mezcla</h3>
          <div className="surface-card shadow-1 border-round p-3" style={{ height: "clamp(240px, 50vh, 370px)" }}>
            <PrimeChart ref={mixChartRef} type="line" data={mixChartFinal} options={mixChartOpts} style={{ height: "100%" }} />
          </div>
        </div>
      )}

      {/* ── Comparación con banda ── */}
      {(mezcla.objetivoModo === "BANDA" || mezcla.objetivoModo === "COMBINADO") && bandaChartFinal && (
        <div className="mb-4">
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-chart-area mr-2" />Comparación con banda</h3>
          <div className="surface-card shadow-1 border-round p-3" style={{ height: "clamp(240px, 50vh, 370px)" }}>
            <PrimeChart ref={bandaChartRef} type="line" data={bandaChartFinal} options={bandaChartOpts} style={{ height: "100%" }} />
          </div>
          {evalBanda && <BandaMetrics eval={evalBanda} />}
        </div>
      )}

      {/* ── Comparación con curva teórica ── */}
      {(mezcla.objetivoModo === "CURVA" || mezcla.objetivoModo === "COMBINADO") && teoricaChartFinal && (
        <div className="mb-4">
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-bezier-curve mr-2" />Comparación con curva teórica</h3>
          <div className="surface-card shadow-1 border-round p-3" style={{ height: "clamp(240px, 50vh, 370px)" }}>
            <PrimeChart ref={teoricaChartRef} type="line" data={teoricaChartFinal} options={teoricaChartOpts} style={{ height: "100%" }} />
          </div>
          {evalTeorica && <TeoricaMetrics eval={evalTeorica} />}
        </div>
      )}

      {/* ── Combinado ── */}
      {mezcla.objetivoModo === "COMBINADO" && combinedChartFinal && (
        <div className="mb-4">
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-layer-group mr-2" />Vista combinada</h3>
          <div className="surface-card shadow-1 border-round p-3" style={{ height: "clamp(240px, 50vh, 370px)" }}>
            <PrimeChart ref={combinedChartRef} type="line" data={combinedChartFinal} options={combinedChartOpts} style={{ height: "100%" }} />
          </div>
        </div>
      )}

      {/* ── Evaluación granulométrica A-B / A-C (solo finos) ── */}
      {isFineScale && evalAutoFino && (
        <>
          <Divider />
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-shield-check mr-2" />Evaluación granulométrica — CIRSOC 200-2024 §3.2.3.2</h3>
          <div className="grid mb-3">
            {/* Banda A-B */}
            <div className="col-12 md:col-6">
              <div className={`surface-card border-round p-3 border-left-3 ${evalAutoFino.bandaAB.cumple ? 'border-green-500' : 'border-red-500'}`}>
                <div className="flex align-items-center gap-2 mb-2">
                  {(() => {
                    const cat = resolveCategoriaBanda(evalAutoFino.bandaAB.cumple);
                    const cfg = CATEGORIA_COLORS[cat];
                    return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  <strong>Banda A-B</strong>
                  {!evalAutoFino.bandaAB.cumple && <small className="text-color-secondary">({evalAutoFino.bandaAB.fuera} fuera, desvio {evalAutoFino.bandaAB.peorDesvio} pp)</small>}
                </div>
                <DataTable responsiveLayout="scroll" value={evalAutoFino.bandaAB.detalle} size="small" stripedRows>
                  <Column header="Tamiz" body={r => `${r.abertura < 1 ? r.abertura.toFixed(3) : r.abertura} mm`} style={{width:'80px'}} />
                  <Column header="% Pasa" body={r => r.pasa?.toFixed(1)} className="text-center" style={{width:'60px'}} />
                  <Column header="Inf." body={r => r.limInf} className="text-center" style={{width:'40px'}} />
                  <Column header="Sup." body={r => r.limSup} className="text-center" style={{width:'40px'}} />
                  <Column header="" body={r => r.dentro
                    ? <i className="fa-solid fa-check text-green-500" />
                    : <span className="text-red-500 font-bold">FUERA ({Number(r.desvio) > 0 ? '+' : Number(r.desvio) < 0 ? '−' : ''}{Math.abs(Number(r.desvio)).toFixed(1)})</span>
                  } style={{width:'80px'}} className="text-center" />
                </DataTable>
              </div>
            </div>
            {/* Banda A-C */}
            <div className="col-12 md:col-6">
              <div className={`surface-card border-round p-3 border-left-3 ${evalAutoFino.bandaAC.cumple ? 'border-green-500' : 'border-red-500'}`}>
                <div className="flex align-items-center gap-2 mb-2">
                  {(() => {
                    const cat = resolveCategoriaBanda(evalAutoFino.bandaAC.cumple);
                    const cfg = CATEGORIA_COLORS[cat];
                    return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  <strong>Banda A-C</strong>
                  {evalAutoFino.bandaAC.cumple && <small className="text-color-secondary">(CIRSOC §3.2.3.2 f) — H ≤ 20 + estudio o antecedentes)</small>}
                  {!evalAutoFino.bandaAC.cumple && <small className="text-color-secondary">({evalAutoFino.bandaAC.fuera} fuera)</small>}
                </div>
                <DataTable responsiveLayout="scroll" value={evalAutoFino.bandaAC.detalle} size="small" stripedRows>
                  <Column header="Tamiz" body={r => `${r.abertura < 1 ? r.abertura.toFixed(3) : r.abertura} mm`} style={{width:'80px'}} />
                  <Column header="% Pasa" body={r => r.pasa?.toFixed(1)} className="text-center" style={{width:'60px'}} />
                  <Column header="Inf." body={r => r.limInf} className="text-center" style={{width:'40px'}} />
                  <Column header="Sup." body={r => r.limSup} className="text-center" style={{width:'40px'}} />
                  <Column header="" body={r => r.dentro
                    ? <i className="fa-solid fa-check text-green-500" />
                    : <span className="text-red-500 font-bold">FUERA ({Number(r.desvio) > 0 ? '+' : Number(r.desvio) < 0 ? '−' : ''}{Math.abs(Number(r.desvio)).toFixed(1)})</span>
                  } style={{width:'80px'}} className="text-center" />
                </DataTable>
              </div>
            </div>
          </div>
          {/* MF y resumen */}
          <div className="flex align-items-center gap-3 mb-3">
            {evalAutoFino.mf != null && (
              <div className="flex align-items-center gap-2">
                <i className={`fa-solid fa-circle ${evalAutoFino.mfOk ? 'text-green-500' : 'text-red-500'}`} style={{fontSize:'0.6rem'}} />
                <span><strong>Módulo de finura:</strong> {evalAutoFino.mf.toFixed(2)} {evalAutoFino.mfOk ? '(req. 2,3 a 3,1)' : <span className="text-red-400">(fuera del rango 2,3–3,1)</span>}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Resumen de resultados ── */}
      {(resumen.cumple !== undefined || optInfo.metodo || optInfo.ok === false) && (
        <>
          <Divider />
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-clipboard-check mr-2" />Resultados</h3>
          {optInfo.ok === false && (
            <div style={{
              background: '#7f1d1d', color: '#fecaca', border: 'none',
              borderLeft: '5px solid #ef4444', borderRadius: 8,
              padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10,
              fontSize: '0.95rem', lineHeight: 1.4, marginBottom: 12,
            }}>
              <i className="fa-solid fa-circle-xmark" style={{ color: '#f87171', fontSize: '1.2rem', flexShrink: 0 }} />
              <span>{optInfo.mensaje || 'La optimización no pudo completarse correctamente.'}</span>
            </div>
          )}
          <div className="grid mb-4">
            {resumen.cumple !== undefined && (() => {
              // C4: el resumen prefiere el compliance canónico de evalBanda
              // (post-C3.5 backend). Caso paradigmático: una mezcla que cumple
              // A-C pero no A-B → conditionalPass canónico → APTITUD CONDICIONADA,
              // en lugar de "NO CUMPLE" rojo que ocultaría el matiz.
              const evalBandaFromMezcla = mezcla?.evalBanda;
              const cat = resolveCategoriaResumen(resumen, evalBandaFromMezcla);
              const cfg = CATEGORIA_COLORS[cat];
              return (
                <div className="col-12 sm:col-6 lg:col-3">
                  <div className="surface-card shadow-1 border-round p-3 text-center">
                    <Tag value={cat} severity={cfg.severity} icon={cfg.icon} className="text-lg px-3 py-1" />
                  </div>
                </div>
              );
            })()}
            {resumen.rmse != null && (
              <div className="col-6 md:col-3">
                <div className="surface-card shadow-1 border-round p-3">
                  <small className="text-color-secondary">RMSE</small>
                  <div className="font-bold mt-1">{Number(resumen.rmse).toFixed(2)}</div>
                </div>
              </div>
            )}
            {resumen.mae != null && (
              <div className="col-6 md:col-3">
                <div className="surface-card shadow-1 border-round p-3">
                  <small className="text-color-secondary">MAE</small>
                  <div className="font-bold mt-1">{Number(resumen.mae).toFixed(2)}
                    <span className="text-sm font-normal ml-2" style={{color: resumen.mae < 3 ? '#22c55e' : resumen.mae < 5 ? '#3b82f6' : resumen.mae < 8 ? '#f59e0b' : '#ef4444'}}>
                      {resumen.mae < 3 ? 'Excelente' : resumen.mae < 5 ? 'Bueno' : resumen.mae < 8 ? 'Regular' : 'Deficiente'}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {resumen.maxDesvio != null && (
              <div className="col-6 md:col-3">
                <div className="surface-card shadow-1 border-round p-3">
                  <small className="text-color-secondary">Máx. desvío</small>
                  <div className="font-bold mt-1">{Number(resumen.maxDesvio).toFixed(2)} %</div>
                </div>
              </div>
            )}
          </div>
          {resumen.tamicesFuera?.length > 0 && (
            <div className="surface-card shadow-1 border-round p-3 mb-4">
              <small className="text-color-secondary font-bold">Tamices fuera de banda:</small>
              <div className="mt-1 flex gap-2 flex-wrap">
                {resumen.tamicesFuera.map((t, i) => (
                  <Tag key={i} value={`${t.aberturaMm} mm (${Number(t.desvio).toFixed(1)}%)`} severity="warning" />
                ))}
              </div>
            </div>
          )}
          {resumen.warnings?.length > 0 && (
            <div style={{
              background: '#92400e', color: '#fef3c7', border: 'none',
              borderLeft: '5px solid #f59e0b', borderRadius: 8,
              padding: '12px 16px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: '#fbbf24', fontSize: '1.1rem' }} />
                <strong>Advertencias</strong>
              </div>
              <ul className="mt-1 mb-0 pl-4">
                {resumen.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {/* ── Caracterización combinada ── */}
      {propsCombinadas?.combinadas && (
        <>
          <Divider />
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-flask mr-2" />Caracterización combinada</h3>
          <p className="text-color-secondary text-sm mt-0 mb-3">Valores promediados por peso de los componentes de la mezcla.</p>
          <div className="grid mb-3">
            {[
              { label: 'MF', val: mezcla?.moduloFinura, dec: 2 },
              { label: 'TMN', val: mezcla?.tmnCalculadoMm, dec: 1, unit: 'mm' },
              { label: 'Dens. SSS', val: propsCombinadas.combinadas.densidadRelativaAparenteSSS, dec: 3 },
              { label: 'Dens. seca', val: propsCombinadas.combinadas.densidadRelativaAparenteSeca, dec: 3 },
              { label: 'Dens. real', val: propsCombinadas.combinadas.densidadRelativaReal, dec: 3 },
              { label: 'Absorción', val: propsCombinadas.combinadas.absorcionPct, dec: 1, unit: '%' },
              { label: 'Pasa #200', val: propsCombinadas.combinadas.pasa200Pct, dec: 1, unit: '%' },
              { label: 'PUC', val: propsCombinadas.combinadas.puc, dec: 0, unit: 'kg/m³' },
              { label: 'PUS', val: propsCombinadas.combinadas.pus, dec: 0, unit: 'kg/m³' },
              ...(mezcla?.tipoMezcla !== 'FINO' ? [
                { label: 'Lajosidad', val: propsCombinadas.combinadas.lajosidadPct, dec: 0, unit: '%' },
                { label: 'Elongación', val: propsCombinadas.combinadas.elongacionPct, dec: 0, unit: '%' },
                { label: 'Desgaste LA', val: propsCombinadas.combinadas.desgasteLAPct, dec: 1, unit: '%' },
              ] : [
                { label: 'Eq. arena', val: propsCombinadas.combinadas.equivalenteArenaPct, dec: 0, unit: '%' },
              ]),
            ].filter(c => c.val != null).map((c, i) => (
              <div key={i} className="col-6 sm:col-4 md:col-3 lg:col-2">
                <div className="surface-card border-round p-2 text-center h-full">
                  <small className="text-color-secondary block">{c.label}</small>
                  <div className="text-lg font-bold text-primary mt-1">
                    {Number(c.val).toFixed(c.dec)}{c.unit ? ` ${c.unit}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Per-component breakdown */}
          {propsCombinadas.componentes?.length > 1 && (
            <div className="surface-ground border-round p-3 mb-3">
              <small className="font-bold text-color-secondary">Desglose por componente</small>
              <DataTable responsiveLayout="scroll" value={propsCombinadas.componentes} size="small" className="mt-2" stripedRows>
                <Column header="Agregado" body={(row) => {
                  const item = mezcla?.items?.find(it => it.idAgregado === row.idAgregado);
                  return item?.agregado?.nombre || `ID ${row.idAgregado}`;
                }} />
                <Column header="%" body={(row) => `${row.porcentaje}%`} style={{width:'60px'}} />
                <Column header="Pasa #200" body={(row) => row.propiedades.pasa200Pct != null ? `${row.propiedades.pasa200Pct}%` : '—'} />
                <Column header="Terrones" body={(row) => row.propiedades.terronesPct != null ? `${row.propiedades.terronesPct}%` : '—'} />
                <Column header="d3 SSS" body={(row) => row.propiedades.densidadRelativaAparenteSSS != null ? row.propiedades.densidadRelativaAparenteSSS.toFixed(3) : '—'} />
                <Column header="Absorción" body={(row) => row.propiedades.absorcionPct != null ? `${Number(row.propiedades.absorcionPct).toFixed(1)}%` : '—'} />
              </DataTable>
            </div>
          )}
        </>
      )}

      {/* ── Cumplimiento normativo combinado ── */}
      {(propsCombinadas?.evaluacion?.fino || propsCombinadas?.evaluacion?.grueso || propsCombinadas?.evaluacion?.length > 0) && (
        <>
          <Divider />
          <h3 className="mt-0 mb-2"><i className="fa-solid fa-shield-check mr-2" />Cumplimiento normativo — CIRSOC 200-2024</h3>
          <p className="text-color-secondary text-sm mt-0 mb-3">Evaluación de las propiedades combinadas de la mezcla contra los requisitos normativos.</p>

          {/* For TOTAL mixes: show tables by fraction */}
          {propsCombinadas?.evaluacion?.fino?.length > 0 && (
            <>
              <h4 className="mt-0 mb-2">Fracción fina (IRAM 1512 / CIRSOC 200 Tablas 3.3-3.4)</h4>
              <CumplimientoCombinadoTable
                rows={propsCombinadas.evaluacion.fino}
                showPorComponente
              />
            </>
          )}

          {propsCombinadas?.evaluacion?.grueso?.length > 0 && (
            <>
              <h4 className="mt-0 mb-2">Fracción gruesa (IRAM 1531 / CIRSOC 200 Tablas 3.5-3.7)</h4>
              <CumplimientoCombinadoTable
                rows={propsCombinadas.evaluacion.grueso}
                showPorComponente
              />
            </>
          )}

          {propsCombinadas?.evaluacion?.general?.length > 0 && (
            // La tabla "general" históricamente forzaba opacity-70 a TODA la fila
            // (para indicar que es informativa). Mantenemos ese matiz, pero las
            // categorías canónicas mandan en el badge.
            <CumplimientoCombinadoTable
              rows={propsCombinadas.evaluacion.general}
              forceOpacity
            />
          )}

          {/* For non-TOTAL mixes: show single table as before */}
          {Array.isArray(propsCombinadas?.evaluacion) && propsCombinadas.evaluacion.length > 0 && (
            <CumplimientoCombinadoTable rows={propsCombinadas.evaluacion} />
          )}
        </>
      )}

      {/* ── Trazabilidad ── */}
      <Divider />
      <h3 className="mt-0 mb-2"><i className="fa-solid fa-clock-rotate-left mr-2" />Trazabilidad</h3>
      <div className="grid mb-4">
        <div className="col-12 sm:col-6 lg:col-4">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Creada</small>
            <div className="font-bold mt-1">{formatDate(mezcla.createdAt)}</div>
          </div>
        </div>
        <div className="col-12 sm:col-6 lg:col-4">
          <div className="surface-card shadow-1 border-round p-3">
            <small className="text-color-secondary">Última modificación</small>
            <div className="font-bold mt-1">{formatDate(mezcla.updatedAt)}</div>
          </div>
        </div>
        {mezcla.descripcion && (
          <div className="col-12">
            <div className="surface-card shadow-1 border-round p-3">
              <small className="text-color-secondary">Descripción</small>
              <div className="mt-1">{mezcla.descripcion}</div>
            </div>
          </div>
        )}
      </div>
      <PdfSectionSelector
        tipo="MEZCLA"
        visible={showPdfDialog}
        onHide={() => setShowPdfDialog(false)}
        onConfirm={handleExportPdf}
        defaultTitulo={mezcla.nombre || ''}
      />
      <MezclaTraceDrawer
        visible={showTrace}
        onHide={() => setShowTrace(false)}
        trazabilidad={meta.trazabilidad}
        metricas={meta.resumen}
      />
    </div>
  );
};

/* ── Sub-components for metrics ── */
const BandaMetrics = ({ eval: ev }) => {
  if (!ev) return null;
  const m = ev.metrics || ev;
  return (
    <div className="grid mt-2">
      {m.cumple !== undefined && (() => {
        const cat = resolveCategoriaBanda(m.cumple);
        const cfg = CATEGORIA_COLORS[cat];
        return (
          <div className="col-6 md:col-3">
            <Tag value={cat === VEREDICTO.APTO ? 'Cumple banda' : 'No cumple banda'} severity={cfg.severity} icon={cfg.icon} />
          </div>
        );
      })()}
      {m.tamicesFuera?.length > 0 && (
        <div className="col-12">
          <small className="text-color-secondary">Tamices fuera: </small>
          {m.tamicesFuera.map((t, i) => (
            <Tag key={i} value={`${t.aberturaMm || t.tamiz} mm`} severity="warning" className="mr-1" />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Tabla de cumplimiento normativo combinado de la mezcla (Prompt 3 C4).
 * Las 3 fracciones (fino/grueso/general) y el caso single-table se renderizan
 * por este componente con la misma lógica canónica.
 *
 * - rowClassName por categoría visual: NO_APTO → bg-red-50, APTITUD_CONDICIONADA → bg-orange-50,
 *   INFORMATIVO/NO_APLICA → opacity-70.
 * - Estado: badge con severity + icon de la categoría canónica.
 *
 * `forceOpacity`: usado por la tabla "general" que históricamente forzaba
 * opacity-70 a TODAS las filas (informativas por construcción).
 * `showPorComponente`: cuando es true, el `Requisito` muestra el ícono de
 * "evaluado por componente" cuando aplica (solo fino/grueso).
 */
const CumplimientoCombinadoTable = ({ rows, forceOpacity = false, showPorComponente = false }) => {
  const rowClassName = (row) => {
    if (forceOpacity) return 'opacity-70';
    const cat = resolveCategoriaRow(row);
    if (cat === VEREDICTO.NO_APTO) return 'bg-red-50';
    if (cat === VEREDICTO.APTITUD_CONDICIONADA) return 'bg-orange-50';
    if (cat === VEREDICTO.INFORMATIVO || cat === VEREDICTO.NO_APLICA) return 'opacity-70';
    return '';
  };

  const requisitoBody = (row) => {
    if (!showPorComponente) return row.propiedad;
    return (
      <span>
        {row.propiedad}
        {row.porComponente ? <i className="fa-solid fa-users ml-1 text-xs text-orange-400" title="Evaluado por componente" /> : null}
      </span>
    );
  };

  const estadoBody = (row) => {
    const cat = resolveCategoriaRow(row);
    const cfg = CATEGORIA_COLORS[cat];
    return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />;
  };

  return (
    <DataTable responsiveLayout="scroll" value={rows} size="small" stripedRows className="mb-3" rowClassName={rowClassName}>
      <Column header="Requisito" field="propiedad" style={{ minWidth: '140px' }} body={requisitoBody} />
      <Column header="Unidad" field="unidad" style={{ width: '60px' }} className="text-center" />
      <Column header="Especificación" field="especificacion" style={{ width: '100px' }} className="text-center" />
      <Column header="Resultado" style={{ width: '80px' }} className="text-center font-bold"
        body={(row) => row.valorDisplay || (row.valor != null ? String(row.valor) : '—')} />
      <Column header="Estado" style={{ width: '140px' }} className="text-center" body={estadoBody} />
      <Column header="Observaciones" body={(row) => <small className="text-color-secondary">{row.mensaje}</small>} />
    </DataTable>
  );
};

const TeoricaMetrics = ({ eval: ev }) => {
  if (!ev) return null;
  const m = ev.metrics || ev;
  return (
    <div className="grid mt-2">
      {m.rmse != null && (
        <div className="col-4 md:col-2">
          <small className="text-color-secondary">RMSE</small>
          <div className="font-bold">{Number(m.rmse).toFixed(2)}</div>
        </div>
      )}
      {m.mae != null && (
        <div className="col-4 md:col-2">
          <small className="text-color-secondary">MAE</small>
          <div className="font-bold">{Number(m.mae).toFixed(2)}</div>
        </div>
      )}
      {m.maxDesvio != null && (
        <div className="col-4 md:col-2">
          <small className="text-color-secondary">Máx desvío</small>
          <div className="font-bold">{Number(m.maxDesvio).toFixed(2)}%</div>
        </div>
      )}
    </div>
  );
};

export default MezclaDetallePage;
