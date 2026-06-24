import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { Fade } from "react-awesome-reveal";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import { Checkbox } from "primereact/checkbox";
import { Message } from "primereact/message";
import { TabView, TabPanel } from "primereact/tabview";
import { Slider } from "primereact/slider";
import { Tooltip } from "primereact/tooltip";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import { useUserContext } from "../../../context/UserContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import WizardMezclasAgregados from "./WizardMezclasAgregados";
import "./MezclasPage.css";
import "chart.js/auto";
import { Chart as PrimeChart } from "primereact/chart";
import {
  buildUnifiedGrid,
  calcularMezcla,
  evaluarContraBanda,
  evaluarContraTeorica,
} from "./mezclaCalcEngine";
import MezclaTraceDrawer from "./MezclaTraceDrawer";
import { generarInformeMezclaPdf, chartToBase64 } from "./mezclaInformePdf";
import PdfExportDialog from "./PdfExportDialog";
import AjustePostOptimizacion from "./AjustePostOptimizacion";
import { CATEGORIA_COLORS, VEREDICTO } from "../../../lib/compliance";

/* ════════════════════════════════════════════════════════
   Constants
   ════════════════════════════════════════════════════════ */

const TIPO_OPTIONS = [
  { label: "Finos", value: "FINO" },
  { label: "Gruesos", value: "GRUESO" },
  { label: "Total", value: "TOTAL" },
];

const MODO_OPTIONS = [
  { label: "Manual", value: "MANUAL" },
  { label: "Automática", value: "AUTO" },
];

const OBJETIVO_MODO_OPTIONS = [
  { label: "Banda normativa", value: "BANDA" },
  { label: "Curva teórica", value: "CURVA" },
  { label: "Banda + Curva", value: "COMBINADO" },
];

const PRIORIDAD_OPTIONS = [
  { label: "Banda primero", value: "BANDA" },
  { label: "Curva primero", value: "CURVA" },
];

const FAMILIA_TEORICA_OPTIONS = [
  { label: "Fuller / Talbot", value: "FULLER" },
  { label: "MAA (Funk & Dinger)", value: "MAA" },
  { label: "Andreasen", value: "ANDREASEN" },
];

const TMN_TEORICA_OPTIONS = [
  { label: "9,5 mm", value: 9.5 },
  { label: "13,2 mm", value: 13.2 },
  { label: "19 mm", value: 19 },
  { label: "25 mm", value: 25 },
  { label: "37,5 mm", value: 37.5 },
  { label: "50 mm", value: 50 },
];

const FAMILIA_DEFAULTS = {
  FULLER: { paramKey: "n", paramDefault: 0.5, paramMin: 0.3, paramMax: 0.8, paramStep: 0.01 },
  MAA: { paramKey: "q", paramDefault: 0.37, paramMin: 0.2, paramMax: 0.6, paramStep: 0.01 },
  ANDREASEN: { paramKey: "q", paramDefault: 0.37, paramMin: 0.2, paramMax: 0.6, paramStep: 0.01 },
};

const CHART_SCALE_OPTIONS = [
  { label: "Logarítmica", value: "log" },
  { label: "Uniforme", value: "uniform" },
];

/* ════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════ */

function parseDecimal(val) {
  if (val === "" || val === null || val === undefined) return NaN;
  return parseFloat(String(val).replace(",", "."));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ── High-contrast alert boxes ── */

const ALERT_STYLES = {
  warn: {
    background: '#92400e',
    color: '#fef3c7',
    border: 'none',
    borderLeft: '5px solid #f59e0b',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: '0.95rem',
    lineHeight: 1.4,
  },
  error: {
    background: '#7f1d1d',
    color: '#fecaca',
    border: 'none',
    borderLeft: '5px solid #ef4444',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: '0.95rem',
    lineHeight: 1.4,
  },
  info: {
    background: '#1e3a5f',
    color: '#bfdbfe',
    border: 'none',
    borderLeft: '5px solid #3b82f6',
    borderRadius: 8,
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: '0.95rem',
    lineHeight: 1.4,
  },
};

const ALERT_ICONS = {
  warn: 'fa-solid fa-triangle-exclamation',
  error: 'fa-solid fa-circle-xmark',
  info: 'fa-solid fa-circle-info',
};

const ALERT_ICON_COLOR = {
  warn: '#fbbf24',
  error: '#f87171',
  info: '#60a5fa',
};

function AlertBox({ severity = 'warn', children, className = '' }) {
  return (
    <div style={ALERT_STYLES[severity] || ALERT_STYLES.warn} className={className}>
      <i className={ALERT_ICONS[severity] || ALERT_ICONS.warn}
         style={{ color: ALERT_ICON_COLOR[severity] || ALERT_ICON_COLOR.warn, fontSize: '1.2rem', flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

/* ── Chart builders ── */

function buildMixChartData(curvaMix) {
  if (!curvaMix?.length) return null;
  const points = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => a.aberturaMm - b.aberturaMm);
  if (points.length < 2) return null;
  return {
    datasets: [
      {
        label: "Mezcla",
        data: points.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
        borderColor: "#3B82F6",
        backgroundColor: "rgba(59,130,246,0.1)",
        fill: true,
        tension: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#3B82F6",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        borderWidth: 2.5,
      },
    ],
  };
}

function buildBandaChartData(curvaMix, evalBanda) {
  if (!curvaMix?.length || !evalBanda) return null;
  const datasets = [];
  const { bandaMin = [], bandaMax = [] } = evalBanda.series || {};

  if (bandaMax.length) {
    datasets.push({
      label: "Límite superior",
      data: bandaMax.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "rgba(239,68,68,0.75)",
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [5, 3],
      pointRadius: 2,
      pointBackgroundColor: "rgba(239,68,68,0.75)",
      fill: false,
      tension: 0,
      order: 2,
    });
  }
  if (bandaMin.length) {
    datasets.push({
      label: "Límite inferior",
      data: bandaMin.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "rgba(34,197,94,0.75)",
      backgroundColor: "rgba(200,200,200,0.08)",
      borderWidth: 1.5,
      borderDash: [5, 3],
      pointRadius: 2,
      pointBackgroundColor: "rgba(34,197,94,0.75)",
      fill: "-1",
      tension: 0,
      order: 2,
    });
  }

  const points = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => a.aberturaMm - b.aberturaMm);
  if (points.length >= 2) {
    datasets.push({
      label: "Mezcla",
      data: points.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "#3B82F6",
      backgroundColor: "rgba(59,130,246,0.15)",
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: "#3B82F6",
      pointBorderColor: "#fff",
      pointBorderWidth: 1.5,
      fill: false,
      tension: 0,
      order: 1,
    });
  }
  return datasets.length > 0 ? { datasets } : null;
}

function buildTeoricaChartData(curvaMix, evalTeorica) {
  if (!curvaMix?.length || !evalTeorica) return null;
  const datasets = [];
  const curvaRef = evalTeorica.series?.curvaRef || [];
  if (curvaRef.length) {
    datasets.push({
      label: "Curva teórica",
      data: curvaRef.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "rgba(245,158,11,0.8)",
      backgroundColor: "transparent",
      borderWidth: 2,
      borderDash: [6, 3],
      pointRadius: 3,
      pointBackgroundColor: "rgba(245,158,11,0.8)",
      fill: false,
      tension: 0,
      order: 2,
    });
  }
  const points = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => a.aberturaMm - b.aberturaMm);
  if (points.length >= 2) {
    datasets.push({
      label: "Mezcla",
      data: points.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "#3B82F6",
      backgroundColor: "rgba(59,130,246,0.15)",
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: "#3B82F6",
      pointBorderColor: "#fff",
      pointBorderWidth: 1.5,
      fill: false,
      tension: 0,
      order: 1,
    });
  }
  return datasets.length > 0 ? { datasets } : null;
}

function buildCombinedChartData(curvaMix, evalBanda, evalTeorica) {
  if (!curvaMix?.length) return null;
  const datasets = [];

  // Band shading (from evalBanda)
  if (evalBanda) {
    const { bandaMin = [], bandaMax = [] } = evalBanda.series || {};
    if (bandaMax.length) {
      datasets.push({
        label: "Límite superior",
        data: bandaMax.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
        borderColor: "rgba(239,68,68,0.55)",
        backgroundColor: "transparent",
        borderWidth: 1.2,
        borderDash: [5, 3],
        pointRadius: 1,
        fill: false,
        tension: 0,
        order: 3,
      });
    }
    if (bandaMin.length) {
      datasets.push({
        label: "Límite inferior",
        data: bandaMin.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
        borderColor: "rgba(34,197,94,0.55)",
        backgroundColor: "rgba(200,200,200,0.06)",
        borderWidth: 1.2,
        borderDash: [5, 3],
        pointRadius: 1,
        fill: "-1",
        tension: 0,
        order: 3,
      });
    }
  }

  // Theoretical curve line (from evalTeorica)
  if (evalTeorica) {
    const curvaRef = evalTeorica.series?.curvaRef || [];
    if (curvaRef.length) {
      datasets.push({
        label: "Curva teórica",
        data: curvaRef.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
        borderColor: "rgba(245,158,11,0.85)",
        backgroundColor: "transparent",
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 2,
        pointBackgroundColor: "rgba(245,158,11,0.85)",
        fill: false,
        tension: 0,
        order: 2,
      });
    }
  }

  // Mix curve
  const points = curvaMix
    .filter((p) => p.pasaPct !== null)
    .sort((a, b) => a.aberturaMm - b.aberturaMm);
  if (points.length >= 2) {
    datasets.push({
      label: "Mezcla",
      data: points.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
      borderColor: "#3B82F6",
      backgroundColor: "rgba(59,130,246,0.15)",
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: "#3B82F6",
      pointBorderColor: "#fff",
      pointBorderWidth: 1.5,
      fill: false,
      tension: 0,
      order: 1,
    });
  }
  return datasets.length > 0 ? { datasets } : null;
}

/**
 * Build chart options. scaleMode: 'log' (default) or 'uniform'.
 * For 'uniform', maps sieve apertures to evenly-spaced integer positions.
 */
function makeChartOptions(isFineScale, chartData, scaleMode = 'log') {
  const sieveLabels = isFineScale
    ? [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5]
    : [0.075, 0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 12.5, 19, 25, 37.5, 50, 75];

  if (scaleMode === 'uniform') {
    // Collect all unique x values from datasets, sorted ascending
    const allX = new Set();
    if (chartData?.datasets) {
      for (const ds of chartData.datasets) {
        for (const pt of ds.data || []) if (pt.x > 0) allX.add(pt.x);
      }
    }
    const sortedX = [...allX].sort((a, b) => a - b);
    if (sortedX.length === 0) return makeChartOptions(isFineScale, chartData, 'log');
    const xToIdx = new Map(sortedX.map((v, i) => [v, i]));

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      scales: {
        x: {
          type: "linear",
          title: { display: true, text: "Abertura (mm) — uniforme", font: { size: 11, weight: "bold" } },
          min: -0.5,
          max: sortedX.length - 0.5,
          afterBuildTicks: (axis) => {
            axis.ticks = sortedX.map((_, i) => ({ value: i }));
          },
          ticks: {
            callback: (val) => {
              const idx = Math.round(val);
              return idx >= 0 && idx < sortedX.length ? sortedX[idx] : "";
            },
            autoSkip: false,
            maxRotation: 45,
            font: { size: 9 },
          },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y: {
          title: { display: true, text: "% Pasa", font: { size: 11, weight: "bold" } },
          min: 0,
          max: 100,
          ticks: { stepSize: 10, font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
      },
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.85)",
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 8,
          cornerRadius: 6,
          callbacks: {
            title: (items) => {
              const idx = Math.round(items[0]?.parsed?.x ?? 0);
              return idx >= 0 && idx < sortedX.length ? `${sortedX[idx]} mm` : "";
            },
          },
        },
      },
      // Store mapping for data transform
      _uniformMap: xToIdx,
    };
  }

  // ── Logarithmic (default) ──
  let dataMin = Infinity,
    dataMax = -Infinity;
  if (chartData?.datasets) {
    for (const ds of chartData.datasets) {
      for (const pt of ds.data || []) {
        if (pt.x > 0) {
          if (pt.x < dataMin) dataMin = pt.x;
          if (pt.x > dataMax) dataMax = pt.x;
        }
      }
    }
  }
  if (!isFinite(dataMin)) {
    dataMin = isFineScale ? 0.1 : 0.05;
    dataMax = isFineScale ? 12 : 100;
  }

  const xMin = Math.max(0.01, dataMin / 2);
  const xMax = dataMax * 1.5;

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "nearest", intersect: false },
    scales: {
      x: {
        type: "logarithmic",
        title: { display: true, text: "Abertura (mm)", font: { size: 11, weight: "bold" } },
        min: xMin,
        max: xMax,
        afterBuildTicks: (axis) => {
          axis.ticks = sieveLabels
            .filter((v) => v >= xMin && v <= xMax)
            .map((v) => ({ value: v }));
        },
        ticks: {
          callback: (val) => val,
          autoSkip: false,
          maxRotation: 45,
          font: { size: 9 },
        },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
      y: {
        title: { display: true, text: "% Pasa", font: { size: 11, weight: "bold" } },
        min: 0,
        max: 100,
        ticks: { stepSize: 10, font: { size: 10 } },
        grid: { color: "rgba(0,0,0,0.06)" },
      },
    },
    plugins: {
      legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.85)",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 8,
        cornerRadius: 6,
      },
    },
  };
}

/**
 * Transform chart data for uniform scale: replace x (aberturaMm) with index position.
 */
function applyUniformScale(chartData, uniformMap) {
  if (!chartData?.datasets || !uniformMap) return chartData;
  return {
    ...chartData,
    datasets: chartData.datasets.map((ds) => ({
      ...ds,
      data: (ds.data || []).map((pt) => ({
        ...pt,
        x: uniformMap.has(pt.x) ? uniformMap.get(pt.x) : pt.x,
      })),
    })),
  };
}

/* ════════════════════════════════════════════════════════
   Main Component
   ════════════════════════════════════════════════════════ */

const MezclasPage = () => {
  const showToast = useToast();
  const location = useLocation();
  const cfg = useConfig();
  const { user } = useUserContext();

  /* ── Wizard de configuración asistida (modelo Liquidaciones) ── */
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("mezcla_wizard_paused") === "1"
  );

  useEffect(() => {
    const sync = () => setSetupWizardPaused(localStorage.getItem("mezcla_wizard_paused") === "1");
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [setupWizardVisible]);

  const descartarSetupWizard = () => {
    localStorage.removeItem("mezcla_wizard_step");
    localStorage.removeItem("mezcla_wizard_paused");
    setSetupWizardPaused(false);
  };

  /* ── chart refs for PDF export ── */
  const mixChartRef = useRef(null);
  const bandaChartRef = useRef(null);
  const teoricaChartRef = useRef(null);
  const combinedChartRef = useRef(null);

  /* ── state: editing a saved copy ── */
  const [editingMezcla, setEditingMezcla] = useState(null);     // mezcla object being edited
  const [pendingPreload, setPendingPreload] = useState(null);    // deferred preload until aggregates load

  /* ── state: selectors ── */
  const [plantas, setPlantas] = useState([]);
  const [plantaId, setPlantaId] = useState(null);
  const [tipoMezcla, setTipoMezcla] = useState("FINO");
  const [modo, setModo] = useState("MANUAL");

  /* ── state: aggregates ── */
  const [agregados, setAgregados] = useState([]);
  const [loadingAgg, setLoadingAgg] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [agregadoOrder, setAgregadoOrder] = useState([]); // user-defined order of selected IDs

  /* ── state: percentages (string for input, number for slider) ── */
  const [pctInputs, setPctInputs] = useState({}); // {id: "35.5"}
  const [lockedId, setLockedId] = useState(null); // Lock-1 strategy

  /* ── state: TOTAL hierarchical mix ── */
  const [finosGlobalPct, setFinosGlobalPct] = useState(50); // % finos in total mix
  const [finosInternos, setFinosInternos] = useState({}); // {id: "50"}
  const [gruposInternos, setGruposInternos] = useState({}); // {id: "50"} (for gruesos)
  const [lockedFinoId, setLockedFinoId] = useState(null);
  const [lockedGruesoId, setLockedGruesoId] = useState(null);

  /* ── state: objectives (curvas) ── */
  const [curvas, setCurvas] = useState([]);

  /* ── state: banda comparison ── */
  const [selectedBandaId, setSelectedBandaId] = useState(null);

  /* ── state: curva teórica comparison ── */
  const [selectedTeoricaId, setSelectedTeoricaId] = useState(null);

  /* ── state: dynamic theoretical curve ── */
  const [familiaTeor, setFamiliaTeor] = useState(null);          // FULLER | MAA | ANDREASEN
  const [tmnTeor, setTmnTeor] = useState(null);                  // 9.5 | 13.2 | 19 | 25 | ...
  const [paramTeor, setParamTeor] = useState(null);              // n (Fuller) or q (MAA/Andreasen)
  const [previewPuntos, setPreviewPuntos] = useState([]);        // puntos from preview API
  const [useDynamicCurve, setUseDynamicCurve] = useState(true);  // true=dynamic, false=catalog

  /* ── state: chart scale ── */
  const [chartScale, setChartScale] = useState(() => {
    try { return localStorage.getItem('hq_chartScale') || 'log'; } catch { return 'log'; }
  });

  /* ── state: traceability drawer ── */
  const [showTrace, setShowTrace] = useState(false);

  /* ── state: PDF export dialog ── */
  const [showPdfDialog, setShowPdfDialog] = useState(false);

  /* ── state: comparison tab ── */
  const [compTabIdx, setCompTabIdx] = useState(0);

  /* ── state: optimization ── */
  const [computing, setComputing] = useState(false);
  const [optResult, setOptResult] = useState(null);
  const [showAjuste, setShowAjuste] = useState(false);
  const [ajusteMetadata, setAjusteMetadata] = useState(null);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [restriccionesVisible, setRestriccionesVisible] = useState(false);
  const [restriccionesMat, setRestriccionesMat] = useState({}); // {id: {min, max}}

  /* ── state: combined optimization mode ── */
  const [objetivoModo, setObjetivoModo] = useState("BANDA");
  const [prioridad1, setPrioridad1] = useState("BANDA");

  /* ── state: save mix dialog ── */
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  /* ────────────────────────
     Fetch plantas
     ──────────────────────── */
  useEffect(() => {
    axios
      .get(`${config.backendUrl}/api/plantas`, { headers: config.headers })
      .then((res) =>
        setPlantas((res.data || []).map((p) => ({ label: p.nombre, value: p.idPlanta })))
      )
      .catch(() => {});
  }, []);

  /* ────────────────────────
     Fetch aggregates (includes puntos now)
     ──────────────────────── */
  useEffect(() => {
    if (!plantaId) {
      setAgregados([]);
      return;
    }
    setLoadingAgg(true);
    setSelectedIds(new Set());
    setPctInputs({});
    setLockedId(null);
    setOptResult(null);

    axios
      .get(`${config.backendUrl}/api/mezclas/agregados`, {
        headers: config.headers,
        params: { plantaId, tipo: tipoMezcla },
      })
      .then((res) => setAgregados(res.data || []))
      .catch(() => {
        showToast("error", "Error al cargar agregados");
        setAgregados([]);
      })
      .finally(() => setLoadingAgg(false));
  }, [plantaId, tipoMezcla]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ────────────────────────
     Fetch curves (full objects with puntos)
     ──────────────────────── */
  useEffect(() => {
    axios
      .get(`${config.backendUrl}/api/curvas-granulometricas`, { headers: config.headers })
      .then((res) => setCurvas(res.data || []))
      .catch(() => setCurvas([]));
  }, []);

  /* ────────────────────────
     Preload from "Duplicar y editar"
     ──────────────────────── */

  // Step 1: read mezcla from navigation state and trigger planta/tipo load
  useEffect(() => {
    const m = location.state?.editMezcla;
    if (!m) return;
    // Clear the navigation state so a refresh doesn't re-trigger
    window.history.replaceState({}, '');
    setEditingMezcla(m);
    setPendingPreload(m);
    setPlantaId(m.idPlanta);
    setTipoMezcla(m.tipoMezcla || 'FINO');
    setModo('AUTO');
    setObjetivoModo(m.objetivoModo || 'BANDA');
    if (m.prioridad1) setPrioridad1(m.prioridad1);
    if (m.idCurvaTeorica) setSelectedTeoricaId(m.idCurvaTeorica);
    setSaveName(m.nombre || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 2: once aggregates are loaded and there's a pending preload, apply IDs and percentages
  useEffect(() => {
    if (!pendingPreload || loadingAgg || !agregados.length) return;
    const m = pendingPreload;
    setPendingPreload(null);

    // Select aggregates that exist in the loaded list
    const itemIds = (m.items || []).map(it => it.idAgregado);
    const validIds = itemIds.filter(id => agregados.some(a => a.id === id));
    setSelectedIds(new Set(validIds));

    // Set percentages
    const pcts = {};
    for (const it of (m.items || [])) {
      pcts[it.idAgregado] = String(it.porcentajeFinal);
    }
    setPctInputs(pcts);

    // Banda selection: reconstruct composite key
    if (m.bandaCompuestaJson) {
      const bc = typeof m.bandaCompuestaJson === 'string' ? JSON.parse(m.bandaCompuestaJson) : m.bandaCompuestaJson;
      if (bc.idCurvaMin && bc.idCurvaMax) {
        if (bc.idCurvaMiddle) {
          setSelectedBandaId(`${bc.idCurvaMin}|${bc.idCurvaMiddle}|${bc.idCurvaMax}`);
        } else {
          setSelectedBandaId(`${bc.idCurvaMin}|${bc.idCurvaMax}`);
        }
      }
    } else if (m.idBanda) {
      setSelectedBandaId(`single|${m.idBanda}`);
    }

    showToast('info', `Editando copia: "${m.nombre}"`);
  }, [agregados, loadingAgg, pendingPreload]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ════════════════════════════════════════════
     Derived: selected aggregates
     ════════════════════════════════════════════ */

  const selectable = useMemo(
    () => agregados.filter((a) => a.tieneGranulometria),
    [agregados]
  );

  const selectedAgregados = useMemo(() => {
    const byId = new Map(agregados.map(a => [a.id, a]));
    // Use user order, falling back to natural order for any IDs not in agregadoOrder
    const ordered = agregadoOrder.filter(id => selectedIds.has(id) && byId.has(id));
    const orderedSet = new Set(ordered);
    // Append any selected IDs missing from order array (safety net)
    for (const id of selectedIds) {
      if (!orderedSet.has(id) && byId.has(id)) ordered.push(id);
    }
    return ordered.map(id => byId.get(id));
  }, [agregados, selectedIds, agregadoOrder]);

  /* ── TOTAL: group selected aggregates by type ── */
  const selectedFinos = useMemo(
    () => selectedAgregados.filter((a) => a.tipoAgregado === 'Fino'),
    [selectedAgregados]
  );
  const selectedGruesos = useMemo(
    () => selectedAgregados.filter((a) => a.tipoAgregado === 'Grueso'),
    [selectedAgregados]
  );
  const isTotalMode = tipoMezcla === 'TOTAL';
  const gruesosGlobalPct = round2(100 - finosGlobalPct);

  /* ════════════════════════════════════════════
     Header checkbox logic
     ════════════════════════════════════════════ */

  const headerChecked =
    selectable.length > 0 && selectable.every((a) => selectedIds.has(a.id));
  const headerIndeterminate =
    !headerChecked && selectable.some((a) => selectedIds.has(a.id));

  const toggleHeaderCheckbox = () => {
    if (headerChecked) {
      setSelectedIds(new Set());
      setAgregadoOrder([]);
    } else {
      const ids = selectable.map((a) => a.id);
      setSelectedIds(new Set(ids));
      setAgregadoOrder(ids);
    }
    setOptResult(null);
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setAgregadoOrder(ord => ord.filter(x => x !== id));
      } else {
        next.add(id);
        setAgregadoOrder(ord => [...ord, id]);
      }
      return next;
    });
    setOptResult(null);
  };

  /* ════════════════════════════════════════════
     Lock-1 percentage strategy
     ════════════════════════════════════════════ */

  // Ensure locked id is valid
  useEffect(() => {
    if (selectedAgregados.length < 2) {
      setLockedId(null);
      return;
    }
    if (!lockedId || !selectedIds.has(lockedId)) {
      setLockedId(selectedAgregados[selectedAgregados.length - 1]?.id ?? null);
    }
  }, [selectedAgregados, selectedIds, lockedId]);

  // Initialize equal percentages when selection changes
  const prevSelRef = useRef(null);
  useEffect(() => {
    const key = [...selectedIds].sort().join(",");
    if (key === prevSelRef.current) return;
    prevSelRef.current = key;
    if (selectedAgregados.length < 2) return;
    const eq = round2(100 / selectedAgregados.length);
    const next = {};
    selectedAgregados.forEach((a, i) => {
      next[a.id] =
        i === selectedAgregados.length - 1
          ? String(round2(100 - eq * (selectedAgregados.length - 1)))
          : String(eq);
    });
    setPctInputs(next);
  }, [selectedAgregados, selectedIds]);

  /** Change a percentage, recalculating the locked aggregate. */
  const handlePctChange = useCallback(
    (id, rawVal) => {
      const val = parseDecimal(rawVal);
      setPctInputs((prev) => {
        const next = {
          ...prev,
          [id]: typeof rawVal === "string" ? rawVal : String(rawVal),
        };

        // Recalculate locked — only if we have a locked id and changed id isn't locked
        if (lockedId && id !== lockedId && !isNaN(val)) {
          const othersSum = selectedAgregados
            .filter((a) => a.id !== lockedId && a.id !== id)
            .reduce((s, a) => s + (parseDecimal(next[a.id]) || 0), 0);
          const lockedVal = round2(100 - val - othersSum);
          next[lockedId] = String(Math.max(0, Math.min(100, lockedVal)));
        }
        return next;
      });
    },
    [lockedId, selectedAgregados]
  );

  /** Handle slider change — same logic, but with number. */
  const handleSliderChange = useCallback(
    (id, numVal) => {
      handlePctChange(id, round2(numVal));
    },
    [handlePctChange]
  );

  /** Move an aggregate up or down in the user order. */
  const moveAgregado = useCallback((id, direction) => {
    setAgregadoOrder(prev => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const totalPct = useMemo(() => {
    return selectedAgregados.reduce((sum, a) => {
      const v = parseDecimal(pctInputs[a.id]);
      return sum + (isNaN(v) ? 0 : v);
    }, 0);
  }, [selectedAgregados, pctInputs]);

  /* ════════════════════════════════════════════
     TOTAL Hierarchical Mix Logic
     ════════════════════════════════════════════ */

  // Initialize equal internals when TOTAL selection changes
  const prevTotalSelRef = useRef(null);
  useEffect(() => {
    if (!isTotalMode) return;
    const key = [...selectedIds].sort().join(",") + ':TOTAL';
    if (key === prevTotalSelRef.current) return;
    prevTotalSelRef.current = key;

    // Init finos internals
    if (selectedFinos.length > 0) {
      const eq = round2(100 / selectedFinos.length);
      const next = {};
      selectedFinos.forEach((a, i) => {
        next[a.id] = i === selectedFinos.length - 1
          ? String(round2(100 - eq * (selectedFinos.length - 1)))
          : String(eq);
      });
      setFinosInternos(next);
      setLockedFinoId(selectedFinos[selectedFinos.length - 1]?.id ?? null);
    } else {
      setFinosInternos({});
      setLockedFinoId(null);
    }

    // Init gruesos internals
    if (selectedGruesos.length > 0) {
      const eq = round2(100 / selectedGruesos.length);
      const next = {};
      selectedGruesos.forEach((a, i) => {
        next[a.id] = i === selectedGruesos.length - 1
          ? String(round2(100 - eq * (selectedGruesos.length - 1)))
          : String(eq);
      });
      setGruposInternos(next);
      setLockedGruesoId(selectedGruesos[selectedGruesos.length - 1]?.id ?? null);
    } else {
      setGruposInternos({});
      setLockedGruesoId(null);
    }
  }, [isTotalMode, selectedIds, selectedFinos, selectedGruesos]);

  /** Change an internal fino %, recalculating the locked fino aggregate. */
  const handleFinoInternoChange = useCallback(
    (id, rawVal) => {
      const val = parseDecimal(rawVal);
      setFinosInternos((prev) => {
        const next = { ...prev, [id]: typeof rawVal === "string" ? rawVal : String(rawVal) };
        if (lockedFinoId && id !== lockedFinoId && !isNaN(val)) {
          const othersSum = selectedFinos
            .filter((a) => a.id !== lockedFinoId && a.id !== id)
            .reduce((s, a) => s + (parseDecimal(next[a.id]) || 0), 0);
          next[lockedFinoId] = String(Math.max(0, Math.min(100, round2(100 - val - othersSum))));
        }
        return next;
      });
    },
    [lockedFinoId, selectedFinos]
  );

  /** Change an internal grueso %, recalculating the locked grueso aggregate. */
  const handleGruesoInternoChange = useCallback(
    (id, rawVal) => {
      const val = parseDecimal(rawVal);
      setGruposInternos((prev) => {
        const next = { ...prev, [id]: typeof rawVal === "string" ? rawVal : String(rawVal) };
        if (lockedGruesoId && id !== lockedGruesoId && !isNaN(val)) {
          const othersSum = selectedGruesos
            .filter((a) => a.id !== lockedGruesoId && a.id !== id)
            .reduce((s, a) => s + (parseDecimal(next[a.id]) || 0), 0);
          next[lockedGruesoId] = String(Math.max(0, Math.min(100, round2(100 - val - othersSum))));
        }
        return next;
      });
    },
    [lockedGruesoId, selectedGruesos]
  );

  /** Derive real percentages from hierarchical inputs (TOTAL mode). */
  const totalRealPcts = useMemo(() => {
    if (!isTotalMode) return null;
    const result = {};
    for (const a of selectedFinos) {
      const interno = parseDecimal(finosInternos[a.id]) || 0;
      result[a.id] = round2(finosGlobalPct * interno / 100);
    }
    for (const a of selectedGruesos) {
      const interno = parseDecimal(gruposInternos[a.id]) || 0;
      result[a.id] = round2(gruesosGlobalPct * interno / 100);
    }
    return result;
  }, [isTotalMode, selectedFinos, selectedGruesos, finosGlobalPct, gruesosGlobalPct, finosInternos, gruposInternos]);

  /** Sync totalRealPcts → pctInputs so mix calculation uses the hierarchical values. */
  useEffect(() => {
    if (!isTotalMode || !totalRealPcts) return;
    const next = {};
    for (const [id, pct] of Object.entries(totalRealPcts)) {
      next[id] = String(pct);
    }
    setPctInputs(next);
  }, [isTotalMode, totalRealPcts]);

  /* ════════════════════════════════════════════
     Frontend-only mix recalculation
     ════════════════════════════════════════════ */

  const mixResult = useMemo(() => {
    if (selectedAgregados.length < 2) return null;

    const withPuntos = selectedAgregados
      .filter((a) => a.granulometria?.puntos?.length)
      .map((a) => {
        let puntos = a.granulometria.puntos;
        if (typeof puntos === 'string') { try { puntos = JSON.parse(puntos); } catch { puntos = []; } }
        if (!Array.isArray(puntos)) puntos = [];
        const pct = parseDecimal(pctInputs[a.id]) || 0;
        return { id: a.id, nombre: a.nombre, porcentaje: pct, peso: pct / 100, puntos };
      });

    if (withPuntos.length < 2) return null;

    const totalWeight = withPuntos.reduce((s, a) => s + a.peso, 0);
    if (totalWeight < 0.01) return null;

    const grid = buildUnifiedGrid(withPuntos.map((a) => a.puntos));
    return calcularMezcla(withPuntos, grid);
  }, [selectedAgregados, pctInputs]);

  /* ════════════════════════════════════════════
     Banda options: build A-B, A-C, A-B-C combos
     ════════════════════════════════════════════ */

  const bandaOptions = useMemo(() => {
    const bandas = curvas.filter(
      (c) =>
        c.tipo === "BANDA" &&
        ["RANGO", "MAX_ONLY", "MIN_ONLY", "OBJETIVO"].includes(c.specMode) &&
        c.curveLetter
    );

    // Strict filter: only bands whose uso matches the selected fraction
    const usable = bandas.filter((c) => {
      if (Array.isArray(c.aplicaA) && c.aplicaA.length) {
        return c.aplicaA.includes(tipoMezcla);
      }
      return c.uso === tipoMezcla;
    });

    // Group by normaRef+uso+tmnMm
    const groups = {};
    for (const c of usable) {
      const key = `${c.normaRef || ""}|${c.uso || ""}|${c.tmnMm || ""}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }

    const options = [];
    for (const curves of Object.values(groups)) {
      if (curves.length < 2) continue;
      const sorted = [...curves].sort((a, b) =>
        (a.curveLetter || "").localeCompare(b.curveLetter || "")
      );
      const prefix = sorted[0].normaRef ? `${sorted[0].normaRef} — ` : "";
      const usoLabel = sorted[0].uso ? `${sorted[0].uso} — ` : "";
      const tmnLabel = sorted[0].tmnMm ? `TMN ${sorted[0].tmnMm} — ` : "";

      const first = sorted[0];
      for (let j = 1; j < sorted.length; j++) {
        const max = sorted[j];
        options.push({
          label: `${prefix}${usoLabel}${tmnLabel}Banda ${first.curveLetter}-${max.curveLetter}`,
          value: `${first.idCurva}|${max.idCurva}`,
          idCurvaMin: first.idCurva,
          idCurvaMax: max.idCurva,
        });
      }

      if (sorted.length >= 3) {
        const last = sorted[sorted.length - 1];
        const middle = sorted[1];
        const allLetters = sorted.map((c) => c.curveLetter).join("-");
        options.push({
          label: `${prefix}${usoLabel}${tmnLabel}Banda ${allLetters}`,
          value: `${first.idCurva}|${middle.idCurva}|${last.idCurva}`,
          idCurvaMin: first.idCurva,
          idCurvaMax: last.idCurva,
          idCurvaMiddle: middle.idCurva,
        });
      }
    }
    return options;
  }, [curvas, tipoMezcla]);

  /** Also include single-band curves (individual curves without curveLetter) */
  const bandaSingleOptions = useMemo(() => {
    const singles = curvas.filter(
      (c) =>
        c.tipo === "BANDA" &&
        ["RANGO", "MAX_ONLY", "MIN_ONLY", "OBJETIVO"].includes(c.specMode) &&
        !c.curveLetter
    );
    const usable = singles.filter((c) => {
      if (Array.isArray(c.aplicaA) && c.aplicaA.length) {
        return c.aplicaA.includes(tipoMezcla);
      }
      return c.uso === tipoMezcla;
    });
    return usable.map((c) => ({
      label: c.nombre,
      value: `single|${c.idCurva}`,
      idCurva: c.idCurva,
    }));
  }, [curvas, tipoMezcla]);

  const allBandaOptions = useMemo(
    () => [...bandaOptions, ...bandaSingleOptions],
    [bandaOptions, bandaSingleOptions]
  );

  /* ════════════════════════════════════════════
     Reset banda/teórica when fraction changes
     ════════════════════════════════════════════ */

  useEffect(() => {
    // If the selected banda no longer exists in the filtered options, clear it
    // Skip during preload to avoid race condition with async loads
    // Also skip when options are empty — they may still be loading (curvas async fetch)
    if (pendingPreload) return;
    if (allBandaOptions.length === 0) return;
    if (selectedBandaId && !allBandaOptions.some((o) => o.value === selectedBandaId)) {
      setSelectedBandaId(null);
    }
  }, [allBandaOptions, selectedBandaId, pendingPreload]);

  /* ════════════════════════════════════════════
     Curva teórica options
     ════════════════════════════════════════════ */

  const teoricaOptions = useMemo(() => {
    const teoricas = curvas.filter(
      (c) => c.tipo === "TEORICA" || c.tipo === "TABULADA"
    );
    const usable = teoricas.filter((c) => {
      if (Array.isArray(c.aplicaA) && c.aplicaA.length) {
        return c.aplicaA.includes(tipoMezcla);
      }
      return c.uso === tipoMezcla;
    });
    return usable.map((c) => ({
      label: `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ""}`,
      value: c.idCurva,
    }));
  }, [curvas, tipoMezcla]);

  useEffect(() => {
    if (pendingPreload) return;
    if (selectedTeoricaId && teoricaOptions.length > 0 && !teoricaOptions.some((o) => o.value === selectedTeoricaId)) {
      setSelectedTeoricaId(null);
    }
  }, [teoricaOptions, selectedTeoricaId, pendingPreload]);

  /* ════════════════════════════════════════════
     Dynamic theoretical curve — label + preview
     ════════════════════════════════════════════ */

  // Set default param when family changes
  useEffect(() => {
    if (familiaTeor && FAMILIA_DEFAULTS[familiaTeor]) {
      setParamTeor(FAMILIA_DEFAULTS[familiaTeor].paramDefault);
    } else {
      setParamTeor(null);
    }
  }, [familiaTeor]);

  // Suggest TMN from calculated mix TMN
  useEffect(() => {
    if (tmnTeor) return; // user already chose
    const tmnVal = mixResult?.tmn?.valor;
    if (!tmnVal) return;
    // Find closest TMN option
    const closest = TMN_TEORICA_OPTIONS.reduce((best, o) =>
      Math.abs(o.value - tmnVal) < Math.abs(best.value - tmnVal) ? o : best
    );
    if (closest) setTmnTeor(closest.value);
  }, [mixResult?.tmn?.valor]); // eslint-disable-line react-hooks/exhaustive-deps

  const dynamicCurveLabel = useMemo(() => {
    if (!familiaTeor || !tmnTeor) return null;
    const fam = FAMILIA_TEORICA_OPTIONS.find((o) => o.value === familiaTeor)?.label || familiaTeor;
    const pk = FAMILIA_DEFAULTS[familiaTeor]?.paramKey || "n";
    const pv = paramTeor != null ? paramTeor : "def";
    return `${fam} ${pk}=${pv} — Total (TMN ${tmnTeor})`;
  }, [familiaTeor, tmnTeor, paramTeor]);

  const curvaGeneradaPayload = useMemo(() => {
    if (!familiaTeor || !tmnTeor) return null;
    return {
      familia: familiaTeor,
      tmnObjetivoMm: tmnTeor,
      parametroPrincipal: paramTeor,
      nombre: dynamicCurveLabel,
    };
  }, [familiaTeor, tmnTeor, paramTeor, dynamicCurveLabel]);

  // Fetch preview points when dynamic curve params change
  useEffect(() => {
    if (!curvaGeneradaPayload) { setPreviewPuntos([]); return; }
    let cancelled = false;
    axios.post(`${config.backendUrl}/api/mezclas/curva-teorica/preview`, curvaGeneradaPayload, { headers: config.headers })
      .then((res) => { if (!cancelled) setPreviewPuntos(res.data?.puntos || []); })
      .catch(() => { if (!cancelled) setPreviewPuntos([]); });
    return () => { cancelled = true; };
  }, [curvaGeneradaPayload]);

  /* ════════════════════════════════════════════
     Evaluation (frontend-only, real-time)
     ════════════════════════════════════════════ */

  /** Banda evaluation */
  const evalBanda = useMemo(() => {
    if (!mixResult?.curvaMix || !selectedBandaId) return null;

    const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
    if (!opt) return null;

    let bandaPuntos;
    if (opt.idCurva) {
      // Single band
      const curva = curvas.find((c) => c.idCurva === opt.idCurva);
      bandaPuntos = (curva?.puntos || []).filter((p) => !p.isNA);
    } else {
      // Composite: merge min+max curves
      const curvaMin = curvas.find((c) => c.idCurva === opt.idCurvaMin);
      const curvaMax = curvas.find((c) => c.idCurva === opt.idCurvaMax);
      if (!curvaMin || !curvaMax) return null;

      const pMin = (curvaMin.puntos || []).filter((p) => !p.isNA);
      const pMax = (curvaMax.puntos || []).filter((p) => !p.isNA);

      // Build merged band puntos
      const allAbs = new Set();
      for (const p of pMin) allAbs.add(Number(p.aberturaMm));
      for (const p of pMax) allAbs.add(Number(p.aberturaMm));

      bandaPuntos = [...allAbs]
        .sort((a, b) => a - b)
        .map((ab) => {
          const pm = pMin.find(
            (p) => Math.abs(Number(p.aberturaMm) - ab) < 0.01
          );
          const px = pMax.find(
            (p) => Math.abs(Number(p.aberturaMm) - ab) < 0.01
          );
          return {
            aberturaMm: ab,
            tamiz: pm?.tamiz || px?.tamiz || `${ab} mm`,
            limInfPct:
              pm?.limSupPct ?? pm?.pasaPct ?? pm?.targetPct ?? null,
            limSupPct:
              px?.limSupPct ?? px?.pasaPct ?? px?.targetPct ?? null,
            isNA: false,
          };
        });
    }

    if (!bandaPuntos?.length) return null;
    return evaluarContraBanda(mixResult.curvaMix, bandaPuntos);
  }, [mixResult, selectedBandaId, allBandaOptions, curvas]);

  /** Resolved banda points (for AjustePostOptimizacion) */
  const bandaPuntosResolved = useMemo(() => {
    if (!selectedBandaId) return null;
    const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
    if (!opt) return null;
    if (opt.idCurva) {
      const curva = curvas.find((c) => c.idCurva === opt.idCurva);
      return (curva?.puntos || []).filter((p) => !p.isNA);
    }
    const curvaMin = curvas.find((c) => c.idCurva === opt.idCurvaMin);
    const curvaMax = curvas.find((c) => c.idCurva === opt.idCurvaMax);
    if (!curvaMin || !curvaMax) return null;
    const pMin = (curvaMin.puntos || []).filter((p) => !p.isNA);
    const pMax = (curvaMax.puntos || []).filter((p) => !p.isNA);
    const allAbs = new Set();
    for (const p of pMin) allAbs.add(Number(p.aberturaMm));
    for (const p of pMax) allAbs.add(Number(p.aberturaMm));
    return [...allAbs].sort((a, b) => a - b).map((ab) => {
      const pm = pMin.find((p) => Math.abs(Number(p.aberturaMm) - ab) < 0.01);
      const px = pMax.find((p) => Math.abs(Number(p.aberturaMm) - ab) < 0.01);
      return {
        aberturaMm: ab, tamiz: pm?.tamiz || px?.tamiz || `${ab} mm`,
        limInfPct: pm?.limSupPct ?? pm?.pasaPct ?? pm?.targetPct ?? null,
        limSupPct: px?.limSupPct ?? px?.pasaPct ?? px?.targetPct ?? null,
        isNA: false,
      };
    });
  }, [selectedBandaId, allBandaOptions, curvas]);

  /** Resolved teorica points (for AjustePostOptimizacion) */
  const teoricaPuntosResolved = useMemo(() => {
    if (useDynamicCurve && previewPuntos.length > 0) return previewPuntos;
    if (!selectedTeoricaId) return null;
    const curva = curvas.find((c) => c.idCurva === selectedTeoricaId);
    if (!curva) return null;
    return curva.puntosCalculados || curva.puntos || [];
  }, [selectedTeoricaId, curvas, useDynamicCurve, previewPuntos]);

  /* ── Reference labels (for PDF and chart legends) ── */

  /** Full display label of the selected banda normativa (e.g. "IRAM 1627:1997 — Total — TMN 26.5 — Banda A-C") */
  const bandaRef = useMemo(() => {
    if (!selectedBandaId) return null;
    const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
    return opt?.label || null;
  }, [selectedBandaId, allBandaOptions]);

  /** TMN (mm) of the selected banda — used to detect TMN mismatches in the PDF */
  const bandaTmn = useMemo(() => {
    if (!selectedBandaId) return null;
    const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
    if (!opt) return null;
    const refId = opt.idCurvaMin || opt.idCurvaMax;
    if (!refId) return null;
    const curva = curvas.find((c) => c.idCurva === refId);
    return curva?.tmnMm != null ? Number(curva.tmnMm) : null;
  }, [selectedBandaId, allBandaOptions, curvas]);

  /** Full display label of the selected curva teórica (catalog or dynamic) */
  const teoricaRef = useMemo(() => {
    if (useDynamicCurve && dynamicCurveLabel) return dynamicCurveLabel;
    if (!selectedTeoricaId) return null;
    const opt = teoricaOptions.find((o) => o.value === selectedTeoricaId);
    return opt?.label || null;
  }, [useDynamicCurve, dynamicCurveLabel, selectedTeoricaId, teoricaOptions]);

  /** Teórica evaluation */
  const evalTeorica = useMemo(() => {
    if (!mixResult?.curvaMix) return null;

    // Dynamic curve: use preview points
    if (useDynamicCurve && previewPuntos.length > 0) {
      return evaluarContraTeorica(mixResult.curvaMix, previewPuntos);
    }

    // Catalog curve
    if (!selectedTeoricaId) return null;
    const curva = curvas.find((c) => c.idCurva === selectedTeoricaId);
    if (!curva) return null;

    const refPuntos = curva.puntosCalculados || curva.puntos || [];
    if (!refPuntos.length) return null;

    return evaluarContraTeorica(mixResult.curvaMix, refPuntos);
  }, [mixResult, selectedTeoricaId, curvas, useDynamicCurve, previewPuntos]);

  /* ════════════════════════════════════════════
     Chart data (memoized)
     ════════════════════════════════════════════ */

  const isFineScale = tipoMezcla === "FINO";

  const mixChartData = useMemo(
    () => buildMixChartData(mixResult?.curvaMix),
    [mixResult]
  );
  const mixChartOpts = useMemo(
    () => makeChartOptions(isFineScale, mixChartData, chartScale),
    [isFineScale, mixChartData, chartScale]
  );
  const mixChartFinal = useMemo(
    () => mixChartOpts?._uniformMap ? applyUniformScale(mixChartData, mixChartOpts._uniformMap) : mixChartData,
    [mixChartData, mixChartOpts]
  );

  const bandaChartData = useMemo(() => {
    const data = buildBandaChartData(mixResult?.curvaMix, evalBanda);
    if (!data || !bandaRef) return data;
    const shortRef = bandaRef.split(' — ').pop(); // e.g. "Banda A-C"
    return {
      ...data,
      datasets: data.datasets.map((ds) => {
        if (ds.label === 'Límite superior') return { ...ds, label: `${shortRef} — Lím. sup.` };
        if (ds.label === 'Límite inferior') return { ...ds, label: `${shortRef} — Lím. inf.` };
        return ds;
      }),
    };
  }, [mixResult, evalBanda, bandaRef]);
  const bandaChartOpts = useMemo(
    () => makeChartOptions(isFineScale, bandaChartData, chartScale),
    [isFineScale, bandaChartData, chartScale]
  );
  const bandaChartFinal = useMemo(
    () => bandaChartOpts?._uniformMap ? applyUniformScale(bandaChartData, bandaChartOpts._uniformMap) : bandaChartData,
    [bandaChartData, bandaChartOpts]
  );

  const teoricaChartData = useMemo(() => {
    const data = buildTeoricaChartData(mixResult?.curvaMix, evalTeorica);
    if (!data || !teoricaRef) return data;
    const shortRef = teoricaRef.split(' — ')[0]; // e.g. "MAA (Funk & Dinger) q=0.45"
    return {
      ...data,
      datasets: data.datasets.map((ds) =>
        ds.label === 'Curva teórica' ? { ...ds, label: shortRef } : ds
      ),
    };
  }, [mixResult, evalTeorica, teoricaRef]);
  const teoricaChartOpts = useMemo(
    () => makeChartOptions(isFineScale, teoricaChartData, chartScale),
    [isFineScale, teoricaChartData, chartScale]
  );
  const teoricaChartFinal = useMemo(
    () => teoricaChartOpts?._uniformMap ? applyUniformScale(teoricaChartData, teoricaChartOpts._uniformMap) : teoricaChartData,
    [teoricaChartData, teoricaChartOpts]
  );

  const combinedChartData = useMemo(() => {
    const data = buildCombinedChartData(mixResult?.curvaMix, evalBanda, evalTeorica);
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
  }, [mixResult, evalBanda, evalTeorica, bandaRef, teoricaRef]);
  const combinedChartOpts = useMemo(
    () => makeChartOptions(isFineScale, combinedChartData, chartScale),
    [isFineScale, combinedChartData, chartScale]
  );
  const combinedChartFinal = useMemo(
    () => combinedChartOpts?._uniformMap ? applyUniformScale(combinedChartData, combinedChartOpts._uniformMap) : combinedChartData,
    [combinedChartData, combinedChartOpts]
  );

  /* ════════════════════════════════════════════
     Suggest proportions (manual mode — backend call)
     ════════════════════════════════════════════ */

  const sugerirProporciones = useCallback(async () => {
    if (selectedAgregados.length < 2) {
      showToast("warn", "Seleccioná al menos 2 agregados");
      return;
    }
    setSugiriendo(true);
    try {
      const materiales = selectedAgregados.map(a => {
        let gran = {};
        const puntos = a.granulometria?.puntos;
        if (Array.isArray(puntos)) {
          for (const p of puntos) {
            if (p.aberturaMm != null && p.pasaPct != null) gran[p.aberturaMm] = p.pasaPct;
          }
        }
        return {
          id: a.id,
          nombre: a.nombre,
          tipo: a.tipoAgregado === "Fino" ? "FINO" : "GRUESO",
          tmn: a.tmn || a.tmnMm || null,
          densidadSSS: a.densidadSSS || a.densidad || null,
          granulometria: gran,
        };
      });
      // Build per-material constraints from UI
      const matMin = {}, matMax = {};
      for (const [id, r] of Object.entries(restriccionesMat)) {
        if (r.min != null && r.min > 0) matMin[id] = r.min;
        if (r.max != null && r.max < 100) matMax[id] = r.max;
      }
      const restricciones = {};
      if (Object.keys(matMin).length) restricciones.materialesMin = matMin;
      if (Object.keys(matMax).length) restricciones.materialesMax = matMax;

      const { data } = await axios.post(
        `${config.backendUrl}/api/mezclas/sugerir-proporciones`,
        { materiales, parametros: { restricciones } },
        { headers: config.headers }
      );
      if (data.ok && data.proporciones) {
        const next = {};
        data.componentes.forEach(c => { next[c.id] = String(c.porcentaje); });
        setPctInputs(next);

        // If TOTAL mode, decompose flat percentages into hierarchical structure
        if (isTotalMode) {
          const finoComps = data.componentes.filter(c => (c.tipo || '').toUpperCase() === 'FINO');
          const gruesoComps = data.componentes.filter(c => (c.tipo || '').toUpperCase() !== 'FINO');
          const finoSum = finoComps.reduce((s, c) => s + c.porcentaje, 0);
          setFinosGlobalPct(Math.round(finoSum * 10) / 10);
          if (finoSum > 0) {
            const fi = {};
            finoComps.forEach(c => { fi[c.id] = String(Math.round((c.porcentaje / finoSum) * 1000) / 10); });
            setFinosInternos(fi);
          }
          const gruesoSum = gruesoComps.reduce((s, c) => s + c.porcentaje, 0);
          if (gruesoSum > 0) {
            const gi = {};
            gruesoComps.forEach(c => { gi[c.id] = String(Math.round((c.porcentaje / gruesoSum) * 1000) / 10); });
            setGruposInternos(gi);
          }
        }

        const ind = data.indicadores || {};
        showToast("success", `Proporciones sugeridas — Zona ${ind.zona?.zona || '?'}, MF ${ind.mf?.toFixed(2) || '?'}, FdA ${ind.fda?.toFixed(1) || '?'}`);
      } else {
        showToast("warn", data.mensaje || "No se encontró una combinación factible.");
      }
    } catch (err) {
      console.error("[sugerirProporciones]", err);
      showToast("error", err.response?.data?.error || "Error al sugerir proporciones");
    } finally {
      setSugiriendo(false);
    }
  }, [selectedAgregados, showToast]);

  /* ════════════════════════════════════════════
     Optimize (backend call)
     ════════════════════════════════════════════ */

  const optimizar = useCallback(async () => {
    if (selectedAgregados.length < 2) {
      showToast("warn", "Seleccioná al menos 2 agregados");
      return;
    }

    // Determine objectives based on objetivoModo
    let objetivoId = null;
    let bandaCompuesta = null;
    let bandaId = null;
    let curvaTeoricaId = null;

    // Resolve banda objective
    if ((objetivoModo === "BANDA" || objetivoModo === "COMBINADO") && selectedBandaId) {
      const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
      if (opt?.idCurvaMin && opt?.idCurvaMax) {
        bandaCompuesta = {
          idCurvaMin: opt.idCurvaMin,
          idCurvaMax: opt.idCurvaMax,
          idCurvaMiddle: opt.idCurvaMiddle || null,
        };
        bandaId = opt.idCurvaMax;
      } else {
        bandaId = opt?.idCurvaMax || opt?.idCurva;
      }
    }

    // Resolve theoretical curve objective
    let curvaGenerada = null;
    if ((objetivoModo === "CURVA" || objetivoModo === "COMBINADO")) {
      if (useDynamicCurve && curvaGeneradaPayload) {
        curvaGenerada = curvaGeneradaPayload;
      } else if (selectedTeoricaId) {
        curvaTeoricaId = selectedTeoricaId;
      }
    }

    // Backward compat: set objetivoId for single-objective modes
    if (objetivoModo === "BANDA") {
      objetivoId = bandaId;
    } else if (objetivoModo === "CURVA") {
      objetivoId = curvaTeoricaId;
    }

    // Validate selection
    if (objetivoModo === "COMBINADO") {
      if (!bandaId && !bandaCompuesta) {
        showToast("warn", "Seleccioná una banda para modo combinado");
        return;
      }
      if (!curvaTeoricaId && !curvaGenerada) {
        showToast("warn", "Seleccioná una curva teórica para modo combinado");
        return;
      }
    } else if (objetivoModo === "CURVA") {
      if (!curvaTeoricaId && !curvaGenerada) {
        showToast("warn", "Seleccioná un objetivo para optimizar");
        return;
      }
    } else if (!objetivoId && !bandaCompuesta) {
      showToast("warn", "Seleccioná un objetivo para optimizar");
      return;
    }

    setComputing(true);
    try {
      const { data } = await axios.post(
        `${config.backendUrl}/api/mezclas/optimizar`,
        {
          plantaId,
          tipoMezcla,
          agregadosIds: selectedAgregados.map((a) => a.id),
          objetivoId,
          bandaCompuesta,
          objetivoModo,
          bandaId,
          curvaTeoricaId,
          curvaGenerada: curvaGenerada || undefined,
          prioridad1: objetivoModo === "COMBINADO" ? prioridad1 : undefined,
          prioridad2: objetivoModo === "COMBINADO" ? (prioridad1 === "BANDA" ? "CURVA" : "BANDA") : undefined,
        },
        { headers: config.headers }
      );
      setOptResult(data);
      setShowAjuste(false);
      setAjusteMetadata(null);
      const next = {};
      for (const a of data.agregados || []) {
        next[a.id] = String(a.porcentaje);
      }
      setPctInputs(next);

      // If TOTAL mode, back-compute hierarchical values from flat weights
      if (isTotalMode && data.agregados?.length) {
        const finos = data.agregados.filter(a => {
          const agg = agregados.find(ag => ag.id === a.id);
          return agg?.tipoAgregado === 'Fino';
        });
        const gruesos = data.agregados.filter(a => {
          const agg = agregados.find(ag => ag.id === a.id);
          return agg?.tipoAgregado === 'Grueso';
        });
        const finosSum = finos.reduce((s, a) => s + a.porcentaje, 0);
        const gruSort = gruesos.reduce((s, a) => s + a.porcentaje, 0);
        setFinosGlobalPct(round2(finosSum));

        const finoInt = {};
        for (const a of finos) {
          finoInt[a.id] = String(finosSum > 0 ? round2(a.porcentaje / finosSum * 100) : 0);
        }
        setFinosInternos(finoInt);

        const gruInt = {};
        for (const a of gruesos) {
          gruInt[a.id] = String(gruSort > 0 ? round2(a.porcentaje / gruSort * 100) : 0);
        }
        setGruposInternos(gruInt);
      }

      if (data.optimizacion?.ok === false && data.optimizacion?.reason !== 'INSUFFICIENT_COMPARABLE_SIEVES') {
        showToast("warn", "No hay solución factible. Se aplica la combinación con menor desvío.");
      } else {
        showToast("success", "Optimización completada");
      }
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.error || "Error al optimizar mezcla"
      );
    } finally {
      setComputing(false);
    }
  }, [
    selectedAgregados,
    plantaId,
    tipoMezcla,
    isTotalMode,
    agregados,
    objetivoModo,
    prioridad1,
    selectedBandaId,
    selectedTeoricaId,
    useDynamicCurve,
    curvaGeneradaPayload,
    allBandaOptions,
    showToast,
  ]);

  /* ════════════════════════════════════════════
     Save mix to catalog
     ════════════════════════════════════════════ */

  const guardarMezclaFn = useCallback(async () => {
    if (savingRef.current) return;
    if (!saveName.trim()) {
      showToast("warn", "Ingresá un nombre para la mezcla");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      // Build items, expanding saved mixes into their individual components.
      const rawItems = [];
      let orden = 0;
      for (const a of selectedAgregados) {
        const realPct = parseDecimal(pctInputs[a.id]) || 0;
        if (a.esMezclaGuardada && a.mezclaItems?.length) {
          // Expand: each component gets its proportional final %
          for (const it of a.mezclaItems) {
            rawItems.push({
              idAgregado: it.idAgregado,
              porcentajeFinal: Math.round((realPct * (it.porcentajeFinal || 0) / 100) * 100) / 100,
              orden: orden++,
            });
          }
        } else {
          rawItems.push({ idAgregado: a.id, porcentajeFinal: realPct, orden: orden++ });
        }
      }
      const items = rawItems;

      // Resolve banda ID for storage
      let saveBandaId = null;
      let saveBandaCompuesta = null;
      if (selectedBandaId) {
        const opt = allBandaOptions.find((o) => o.value === selectedBandaId);
        if (opt?.idCurvaMin && opt?.idCurvaMax) {
          saveBandaCompuesta = {
            idCurvaMin: opt.idCurvaMin,
            idCurvaMax: opt.idCurvaMax,
            idCurvaMiddle: opt.idCurvaMiddle || null,
            label: opt.label || null,
          };
          saveBandaId = opt.idCurvaMax;
        } else {
          saveBandaId = opt?.idCurvaMax || opt?.idCurva;
        }
      }

      const payload = {
          nombre: saveName.trim(),
          descripcion: saveDesc.trim() || null,
          idPlanta: plantaId,
          tipoMezcla,
          objetivoModo: optResult?.objetivoModo || objetivoModo || null,
          idBanda: saveBandaId || null,
          idCurvaTeorica: selectedTeoricaId || null,
          bandaCompuestaJson: saveBandaCompuesta || null,
          prioridad1: optResult?.prioridad1 || null,
          prioridad2: optResult?.prioridad2 || null,
          tmnCalculadoMm: (mixResult?.tmn?.valor || optResult?.tmn?.valor) ?? null,
          moduloFinura: (mixResult?.moduloFinura?.valor || optResult?.moduloFinura?.valor) ?? null,
          curvaMezclaJson: optResult?.curvaMix || mixResult?.curvaMix || null,
          metadataResultadoJson: optResult ? {
            evaluacion: optResult.evaluacion,
            evaluacionBanda: optResult.evaluacionBanda,
            evaluacionTeorica: optResult.evaluacionTeorica,
            resumen: optResult.resumen,
            optimizacion: optResult.optimizacion,
            trazabilidad: optResult.trazabilidad,
            _refs: { bandaLabel: bandaRef || null, teoricaLabel: teoricaRef || null },
          } : (mixResult ? {
            trazabilidad: { mixBreakdown: mixResult.mixBreakdown },
            _refs: { bandaLabel: bandaRef || null, teoricaLabel: teoricaRef || null },
          } : null),
          items,
        };

      // Post-optimization adjustment fields
      if (ajusteMetadata) {
        payload.tipoOptimizacion = ajusteMetadata.tipo_optimizacion || 'AJUSTADO';
        payload.proporcionesOptimasJson = ajusteMetadata.proporciones_optimas || null;
        payload.rangosFactiblesJson = ajusteMetadata.rangos || null;
        payload.metricasOptimoJson = ajusteMetadata.metricas?.optimo || null;
        payload.metricasAdoptadoJson = ajusteMetadata.metricas?.adoptado || null;
        payload.calidadAjuste = ajusteMetadata.calidad_ajuste || null;
        payload.motivoAjuste = ajusteMetadata.motivo_ajuste || null;
      }

      if (editingMezcla?.idMezcla) {
        await axios.put(
          `${config.backendUrl}/api/mezclas/${editingMezcla.idMezcla}`,
          payload,
          { headers: config.headers }
        );
      } else {
        await axios.post(
          `${config.backendUrl}/api/mezclas`,
          payload,
          { headers: config.headers }
        );
      }
      showToast("success", editingMezcla ? "Mezcla actualizada correctamente" : "Mezcla guardada correctamente");
      setShowSaveDialog(false);
      setSaveName("");
      setSaveDesc("");
      setEditingMezcla(null);
    } catch (err) {
      showToast(
        "error",
        err.response?.data?.error || "Error al guardar mezcla"
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    saveName,
    saveDesc,
    selectedAgregados,
    pctInputs,
    plantaId,
    tipoMezcla,
    objetivoModo,
    optResult,
    mixResult,
    selectedBandaId,
    selectedTeoricaId,
    allBandaOptions,
    editingMezcla,
    showToast,
    bandaRef,
    teoricaRef,
    ajusteMetadata,
  ]);

  /* ════════════════════════════════════════════
     Export PDF
     ════════════════════════════════════════════ */
  const handleExportPdf = useCallback(async (pdfOpts = {}) => {
    setShowPdfDialog(false);
    try {
      const chartImages = {
        mix: chartToBase64(mixChartRef),
        banda: chartToBase64(bandaChartRef),
        teorica: chartToBase64(teoricaChartRef),
        combinada: chartToBase64(combinedChartRef),
      };

      const data = optResult || mixResult;
      const plantaNombre = plantas.find(p => p.value === plantaId)?.label;

      // Fetch IRAM 1627 band data for the SVG chart (curvas A, B, C)
      let bandaNormativaPdf = null;
      const tmnVal = data?.tmn?.valor || data?.tmn;
      if (tmnVal && tipoMezcla === 'TOTAL') {
        try {
          const bandaResp = await axios.get(`${config.backendUrl}/api/mezclas/banda-iram1627`, { headers: config.headers, params: { tmnMm: tmnVal } });
          if (bandaResp.data?.found) bandaNormativaPdf = bandaResp.data;
        } catch { /* non-critical */ }
      }

      await generarInformeMezclaPdf({
        isDraft: true,
        nombre: pdfOpts.titulo || saveName || editingMezcla?.nombre || null,
        empresa: cfg?.nombreEmpresa,
        planta: plantaNombre,
        usuario: user ? `${user.name || ''} ${user.lastname || ''}`.trim() : null,
        tipoMezcla,
        modo,
        objetivoModo,
        prioridad1,
        prioridad2: prioridad1 === 'BANDA' ? 'CURVA' : 'BANDA',
        tmn: data?.tmn?.valor,
        mf: data?.moduloFinura?.valor,
        componentes: selectedAgregados.map(a => ({
          id: a.id,
          nombre: a.nombre,
          tipo: a.tipoAgregado,
          origen: a.origen,
          porcentaje: parseDecimal(pctInputs[a.id]),
        })),
        curvaMix: data?.curvaMix || [],
        evalBanda,
        evalTeorica,
        optimizacion: optResult?.optimizacion,
        resumen: optResult?.resumen,
        trazabilidad: optResult?.trazabilidad || (mixResult ? { mixBreakdown: mixResult.mixBreakdown } : null),
        logoUrl: cfg?.thumbnail,
        chartImages,
        descripcion: saveDesc || null,
        includeAnexo: pdfOpts.includeAnexo ?? false,
        includeGlosario: pdfOpts.includeGlosario ?? true,
        ordenAgregados: pdfOpts.ordenAgregados ?? 'actual',
        bandaRef,
        teoricaRef,
        bandaTmn,
        ajusteMetadata: ajusteMetadata || null,
        bandaNormativa: bandaNormativaPdf,
      });

      showToast('success', 'PDF generado correctamente');
    } catch (err) {
      console.error('Error generando PDF:', err);
      showToast('error', 'Error al generar PDF');
    }
  }, [
    mixResult, optResult, selectedAgregados, pctInputs, plantas, plantaId,
    tipoMezcla, modo, objetivoModo, prioridad1, evalBanda, evalTeorica,
    saveName, saveDesc, editingMezcla, cfg, user, showToast,
    bandaRef, teoricaRef, bandaTmn, ajusteMetadata,
  ]);

  /* ════════════════════════════════════════════
     Render
     ════════════════════════════════════════════ */
  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        {/* Banner de wizard pausado */}
        {setupWizardPaused && !setupWizardVisible && (
          <div className="mant-wizard-resume-banner">
            <div className="mant-wizard-resume-banner-text">
              <i className="fa-solid fa-wand-magic-sparkles" />
              <div>
                <strong>Configuración del módulo en pausa</strong>
                <small>Continuá donde dejaste el asistente para terminar de dejar todo listo.</small>
              </div>
            </div>
            <div className="mant-wizard-resume-banner-actions">
              <Button
                label="Descartar"
                size="small"
                text
                severity="secondary"
                onClick={descartarSetupWizard}
              />
              <Button
                label="Continuar configuración"
                icon="fa-solid fa-arrow-right"
                iconPos="right"
                size="small"
                severity="success"
                onClick={() => setSetupWizardVisible(true)}
              />
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <PageHeader
            icon="fa-solid fa-compass-drafting"
            title="Mezclas de agregados"
            subtitle="Diseño de curvas granulométricas de mezcla"
          />
          <Button
            label="Configurar"
            icon="fa-solid fa-wand-magic-sparkles"
            size="small"
            outlined
            severity="success"
            className="mant-wizard-btn"
            onClick={() => setSetupWizardVisible(true)}
            tooltip="Asistente paso a paso para entender la pantalla de mezclas"
            tooltipOptions={{ position: "left" }}
          />
        </div>

        <WizardMezclasAgregados
          visible={setupWizardVisible}
          onClose={() => setSetupWizardVisible(false)}
          onFinish={() => setSetupWizardVisible(false)}
        />

        {editingMezcla && (
          <AlertBox severity="info">
            <div className="flex align-items-center gap-2 flex-wrap">
              <span>Editando copia:</span>
              <InputText
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Nombre de la mezcla"
                maxLength={150}
                className="p-inputtext-sm"
                style={{ minWidth: 220, maxWidth: 400 }}
              />
              <Button
                label="Cancelar edición"
                icon="fa-solid fa-xmark"
                className="p-button-sm p-button-text"
                style={{ color: '#93c5fd' }}
                onClick={() => { setEditingMezcla(null); setSaveName(''); }}
              />
            </div>
          </AlertBox>
        )}

        <div className="w-full flex flex-column gap-3">
          {/* ──── Selectors ──── */}
          <div className="form-card br-15 p-4">
            <div className="flex flex-wrap gap-3 align-items-end">
              <div className="flex flex-column">
                <small className="font-bold mb-1">
                  <small className="color-danger">* </small>Planta
                </small>
                <Dropdown
                  value={plantaId}
                  options={plantas}
                  onChange={(e) => {
                    setPlantaId(e.value);
                    setOptResult(null);
                  }}
                  placeholder="Seleccionar planta"
                  className="w-15rem"
                  filter
                />
              </div>
              <div className="flex flex-column">
                <small className="font-bold mb-1">
                  <small className="color-danger">* </small>Tipo de mezcla
                </small>
                <SelectButton
                  value={tipoMezcla}
                  options={TIPO_OPTIONS}
                  onChange={(e) => {
                    if (e.value) {
                      setTipoMezcla(e.value);
                      setOptResult(null);
                    }
                  }}
                  allowEmpty={false}
                />
              </div>
              <div className="flex flex-column">
                <small className="font-bold mb-1">Modo</small>
                <SelectButton
                  value={modo}
                  options={MODO_OPTIONS}
                  onChange={(e) => {
                    if (e.value) setModo(e.value);
                  }}
                  allowEmpty={false}
                />
              </div>
            </div>
          </div>

          {/* ──── Aggregates table ──── */}
          {plantaId && (
            <div className="form-card br-15 p-4">
              <div className="flex align-items-center justify-content-between mb-3">
                <h3 className="m-0 text-lg">
                  <i className="fa-solid fa-hill-rockslide mr-2" />
                  Agregados disponibles
                </h3>
                {selectedIds.size > 0 && (
                  <Button
                    label="Limpiar selección"
                    icon="fa-solid fa-xmark"
                    size="small"
                    text
                    severity="secondary"
                    onClick={() => {
                      setSelectedIds(new Set());
                      setOptResult(null);
                    }}
                  />
                )}
              </div>

              {loadingAgg ? (
                <div className="flex justify-content-center p-4">
                  <ProgressSpinner style={{ width: 40, height: 40 }} />
                </div>
              ) : agregados.length === 0 ? (
                <Message
                  severity="info"
                  text="No hay agregados asignados a esta planta para el tipo seleccionado."
                  className="w-full"
                />
              ) : (
                <DataTable responsiveLayout="scroll"
                  value={agregados}
                  size="small"
                  stripedRows
                  className="w-full"
                >
                  <Column
                    header={
                      <Checkbox
                        checked={headerChecked}
                        onChange={toggleHeaderCheckbox}
                        className={headerIndeterminate ? "p-indeterminate" : ""}
                        tooltip="Seleccionar/deseleccionar todos con granulometría"
                        tooltipOptions={{ position: "top" }}
                      />
                    }
                    style={{ width: "3rem" }}
                    body={(a) => (
                      <Checkbox
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        disabled={!a.tieneGranulometria}
                      />
                    )}
                  />
                  <Column
                    field="nombre"
                    header="Nombre"
                    sortable
                    body={(a) => (
                      <span className="flex align-items-center gap-2">
                        {a.esMezclaGuardada && (
                          <i className="fa-solid fa-layer-group text-purple-500" title="Mezcla guardada" />
                        )}
                        {a.nombre}
                      </span>
                    )}
                  />
                  <Column
                    field="tipoAgregado"
                    header="Tipo"
                    body={(a) => (
                      <div className="flex flex-column gap-1">
                        <Tag
                          value={a.tipoAgregado}
                          severity={a.tipoAgregado === "Fino" ? "info" : "warning"}
                        />
                        {a.esMezclaGuardada && (
                          <Tag value="Mezcla" severity="secondary" className="text-xs" />
                        )}
                      </div>
                    )}
                  />
                  <Column
                    field="origen"
                    header="Origen / Curva"
                    body={(a) =>
                      a.esMezclaGuardada
                        ? <span className="text-purple-400 text-sm"><i className="fa-solid fa-layer-group mr-1" />{a.mezclaItems?.length || 0} componentes</span>
                        : a.origen
                    }
                  />
                  <Column
                    header="Granulometría"
                    body={(a) =>
                      a.tieneGranulometria ? (
                        <span className={a.esMezclaGuardada ? "text-purple-400" : "text-green-600"}>
                          <i className={`fa-solid ${a.esMezclaGuardada ? "fa-layer-group" : "fa-check"} mr-1`} />
                          {a.esMezclaGuardada ? `${a.granulometria?.nPuntos} pts` : `${a.granulometria?.fecha || "Disponible"} (${a.granulometria?.nPuntos} pts)`}
                        </span>
                      ) : (
                        <span className="text-red-400">
                          <i className="fa-solid fa-xmark mr-1" />
                          Sin datos
                        </span>
                      )
                    }
                  />
                  <Column
                    header="Vigencia ensayos"
                    body={(a) => {
                      const v = a.vigenciaResumen;
                      if (!v || v.peorEstado === 'ok') {
                        return <span className="text-color-secondary text-xs"><i className="fa-solid fa-check mr-1" />Vigente</span>;
                      }
                      const cfg = {
                        vencido: { color: '#dc2626', icon: 'fa-circle-exclamation', label: `${v.ensayosVencidos} vencido(s)` },
                        critico: { color: '#dc2626', icon: 'fa-clock',              label: 'Vence ≤ 7d' },
                        proximo: { color: '#d97706', icon: 'fa-clock',              label: 'Vence ≤ 30d' },
                      }[v.peorEstado] || null;
                      if (!cfg) return null;
                      const titulo = v.proximoVencimiento
                        ? `Próximo vencimiento: ${new Date(v.proximoVencimiento).toLocaleDateString('es-AR')}`
                        : '';
                      return (
                        <span className="font-medium text-xs" style={{ color: cfg.color }} title={titulo}>
                          <i className={`fa-solid ${cfg.icon} mr-1`} />
                          {cfg.label}
                        </span>
                      );
                    }}
                  />
                </DataTable>
              )}
            </div>
          )}

          {/* ──── Proportions / Dynamic sliders (modo Manual) ──── */}
          {modo === "MANUAL" && selectedAgregados.length >= 2 && !isTotalMode && (
            <div className="form-card br-15 p-4">
              <div className="flex align-items-center justify-content-between mb-3">
                <h3 className="m-0 text-lg">
                  <i className="fa-solid fa-sliders mr-2" />
                  Proporciones
                </h3>
                <div className="flex align-items-center gap-2">
                  <Button
                    label="Sugerir"
                    icon="fa-solid fa-wand-magic-sparkles"
                    size="small"
                    severity="info"
                    text
                    loading={sugiriendo}
                    onClick={sugerirProporciones}
                    disabled={selectedAgregados.length < 2}
                    tooltip="Calcular proporciones óptimas automáticamente"
                    tooltipOptions={{ position: "top" }}
                  />
                  <Button
                    icon={restriccionesVisible ? "fa-solid fa-filter-circle-xmark" : "fa-solid fa-filter"}
                    size="small"
                    severity="secondary"
                    text
                    onClick={() => setRestriccionesVisible(v => !v)}
                    tooltip={restriccionesVisible ? "Ocultar restricciones" : "Restricciones por material"}
                    tooltipOptions={{ position: "top" }}
                  />
                  <span className="font-bold text-sm">
                    Total:{" "}
                    <span
                      className={
                        Math.abs(totalPct - 100) < 0.5
                          ? "text-green-600"
                          : "text-red-500"
                      }
                    >
                      {totalPct.toFixed(1)}%
                    </span>
                  </span>
                </div>
              </div>

              {restriccionesVisible && (
                <div className="p-3 border-1 border-round surface-ground mb-3" style={{ borderColor: 'var(--surface-border)' }}>
                  <div className="text-sm text-color-secondary mb-2">
                    <i className="fa-solid fa-filter mr-1" />
                    Restricciones para la sugerencia automática (mín/máx % por material)
                  </div>
                  <div className="flex flex-column gap-2">
                    {selectedAgregados.map(a => {
                      const r = restriccionesMat[a.id] || {};
                      return (
                        <div key={a.id} className="flex align-items-center gap-2">
                          <span className="text-sm w-10rem white-space-nowrap overflow-hidden text-overflow-ellipsis">{a.nombre}</span>
                          <InputNumber
                            value={r.min ?? null}
                            onValueChange={e => setRestriccionesMat(prev => ({ ...prev, [a.id]: { ...prev[a.id], min: e.value } }))}
                            placeholder="Mín"
                            suffix="%"
                            min={0} max={95}
                            size={4}
                            inputClassName="text-sm p-1"
                            style={{ width: '5rem' }}
                          />
                          <span className="text-xs text-color-secondary">—</span>
                          <InputNumber
                            value={r.max ?? null}
                            onValueChange={e => setRestriccionesMat(prev => ({ ...prev, [a.id]: { ...prev[a.id], max: e.value } }))}
                            placeholder="Máx"
                            suffix="%"
                            min={5} max={100}
                            size={4}
                            inputClassName="text-sm p-1"
                            style={{ width: '5rem' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-column gap-3">
                {selectedAgregados.map((a, idx) => {
                  const rawVal = pctInputs[a.id] || "";
                  const numVal = parseDecimal(rawVal);
                  const sliderVal = isNaN(numVal)
                    ? 0
                    : Math.max(0, Math.min(100, numVal));
                  const isLocked = a.id === lockedId;
                  const agg = agregados.find((ag) => ag.id === a.id);

                  return (
                    <div key={a.id} className="flex align-items-center gap-3">
                      {/* Reorder buttons */}
                      <div className="flex flex-column" style={{ gap: 1 }}>
                        <Button
                          icon="fa-solid fa-chevron-up"
                          size="small" text rounded
                          className="p-0" style={{ width: 20, height: 16 }}
                          disabled={idx === 0}
                          onClick={() => moveAgregado(a.id, -1)}
                          tooltip="Subir" tooltipOptions={{ position: "top" }}
                        />
                        <Button
                          icon="fa-solid fa-chevron-down"
                          size="small" text rounded
                          className="p-0" style={{ width: 20, height: 16 }}
                          disabled={idx === selectedAgregados.length - 1}
                          onClick={() => moveAgregado(a.id, 1)}
                          tooltip="Bajar" tooltipOptions={{ position: "top" }}
                        />
                      </div>
                      <div
                        className="flex align-items-center gap-2"
                        style={{ minWidth: 180 }}
                      >
                        <Button
                          icon={
                            isLocked
                              ? "fa-solid fa-lock"
                              : "fa-solid fa-lock-open"
                          }
                          size="small"
                          text
                          rounded
                          severity={isLocked ? "warning" : "secondary"}
                          tooltip={
                            isLocked
                              ? "Bloqueado: se ajusta automáticamente"
                              : "Clic para bloquear"
                          }
                          tooltipOptions={{ position: "top" }}
                          onClick={() =>
                            setLockedId(isLocked ? null : a.id)
                          }
                          className="p-0"
                          style={{ width: 28, height: 28 }}
                        />
                        <span
                          className="font-bold text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis"
                          style={{ maxWidth: 140 }}
                        >
                          {agg?.nombre || `ID ${a.id}`}
                        </span>
                      </div>

                      <div className="flex-grow-1">
                        <Slider
                          value={sliderVal}
                          onChange={(e) =>
                            handleSliderChange(a.id, e.value)
                          }
                          min={0}
                          max={100}
                          step={0.5}
                          disabled={isLocked}
                          className="w-full"
                        />
                      </div>

                      <InputText
                        value={rawVal}
                        onChange={(e) =>
                          handlePctChange(a.id, e.target.value)
                        }
                        className="text-center"
                        style={{ width: 70 }}
                        disabled={isLocked}
                        keyfilter={/[\d.,]/}
                      />
                      <span className="text-500 text-sm">%</span>
                    </div>
                  );
                })}

                {/* Locked value warning */}
                {lockedId &&
                  (() => {
                    const lockedVal = parseDecimal(pctInputs[lockedId]);
                    if (
                      !isNaN(lockedVal) &&
                      (lockedVal < 0 || lockedVal > 100)
                    ) {
                      return (
                        <Message
                          severity="warn"
                          text={`El agregado bloqueado tiene un valor fuera de rango (${lockedVal.toFixed(
                            1
                          )}%). Ajustá los demás valores.`}
                          className="w-full"
                        />
                      );
                    }
                    return null;
                  })()}
              </div>
            </div>
          )}

          {/* ──── TOTAL Hierarchical Proportions (modo Manual) ──── */}
          {modo === "MANUAL" && isTotalMode && selectedAgregados.length >= 2 && (
            <div className="form-card br-15 p-4">
              <div className="flex align-items-center justify-content-between mb-3">
                <h3 className="m-0 text-lg">
                  <i className="fa-solid fa-sliders mr-2" />
                  Proporciones — Mezcla Total
                </h3>
                <Button
                  label="Sugerir"
                  icon="fa-solid fa-wand-magic-sparkles"
                  size="small"
                  severity="info"
                  text
                  loading={sugiriendo}
                  onClick={sugerirProporciones}
                  disabled={selectedAgregados.length < 2}
                  tooltip="Calcular proporciones óptimas automáticamente"
                  tooltipOptions={{ position: "top" }}
                />
              </div>

              {/* Level 1: Global Finos / Gruesos split */}
              <div className="mb-4 p-3 surface-50 border-round">
                <h4 className="m-0 mb-2 text-base">
                  <i className="fa-solid fa-arrows-left-right mr-2" />
                  Proporción global
                </h4>
                <div className="flex align-items-center gap-3">
                  <span className="font-bold text-sm" style={{ minWidth: 100 }}>
                    Finos: <span className="text-blue-600">{finosGlobalPct.toFixed(1)}%</span>
                  </span>
                  <div className="flex-grow-1">
                    <Slider
                      value={finosGlobalPct}
                      onChange={(e) => setFinosGlobalPct(round2(e.value))}
                      min={0}
                      max={100}
                      step={0.5}
                      className="w-full"
                    />
                  </div>
                  <span className="font-bold text-sm" style={{ minWidth: 110 }}>
                    Gruesos: <span className="text-orange-600">{gruesosGlobalPct.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="flex align-items-center gap-2 mt-2">
                  <InputText
                    value={String(finosGlobalPct)}
                    onChange={(e) => {
                      const v = parseDecimal(e.target.value);
                      if (!isNaN(v)) setFinosGlobalPct(Math.max(0, Math.min(100, round2(v))));
                    }}
                    className="text-center"
                    style={{ width: 70 }}
                    keyfilter={/[\d.,]/}
                  />
                  <span className="text-500 text-sm">% Finos</span>
                  <span className="text-500 mx-2">|</span>
                  <span className="text-500 text-sm font-bold">{gruesosGlobalPct.toFixed(1)}% Gruesos</span>
                </div>
              </div>

              {/* Level 2: Internal distribution of Finos */}
              {selectedFinos.length > 0 && (
                <div className="mb-4 p-3 border-round" style={{ border: '1px solid #93c5fd', background: 'rgba(59,130,246,0.04)' }}>
                  <h4 className="m-0 mb-2 text-base text-blue-700">
                    <i className="fa-solid fa-layer-group mr-2" />
                    Distribución de finos
                    <span className="text-sm text-500 ml-2">(dentro del {finosGlobalPct.toFixed(1)}% de finos)</span>
                  </h4>
                  <div className="flex flex-column gap-2">
                    {selectedFinos.map((a) => {
                      const rawVal = finosInternos[a.id] || "";
                      const numVal = parseDecimal(rawVal);
                      const sliderVal = isNaN(numVal) ? 0 : Math.max(0, Math.min(100, numVal));
                      const isLocked = a.id === lockedFinoId;
                      const agg = agregados.find((ag) => ag.id === a.id);
                      const realPct = totalRealPcts?.[a.id] ?? 0;

                      return (
                        <div key={a.id} className="flex align-items-center gap-3">
                          <div className="flex align-items-center gap-2" style={{ minWidth: 180 }}>
                            <Button
                              icon={isLocked ? "fa-solid fa-lock" : "fa-solid fa-lock-open"}
                              size="small" text rounded
                              severity={isLocked ? "warning" : "secondary"}
                              tooltip={isLocked ? "Bloqueado: se ajusta automáticamente" : "Clic para bloquear"}
                              tooltipOptions={{ position: "top" }}
                              onClick={() => setLockedFinoId(isLocked ? null : a.id)}
                              className="p-0" style={{ width: 28, height: 28 }}
                            />
                            <span className="font-bold text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis" style={{ maxWidth: 140 }}>
                              {agg?.esMezclaGuardada && <i className="fa-solid fa-layer-group mr-1 text-purple-500 text-xs" />}
                              {agg?.nombre || `ID ${a.id}`}
                            </span>
                          </div>
                          <div className="flex-grow-1">
                            <Slider
                              value={sliderVal}
                              onChange={(e) => handleFinoInternoChange(a.id, round2(e.value))}
                              min={0} max={100} step={0.5}
                              disabled={isLocked}
                              className="w-full"
                            />
                          </div>
                          <InputText
                            value={rawVal}
                            onChange={(e) => handleFinoInternoChange(a.id, e.target.value)}
                            className="text-center" style={{ width: 60 }}
                            disabled={isLocked}
                            keyfilter={/[\d.,]/}
                          />
                          <span className="text-500 text-xs">%</span>
                          <span className="text-blue-600 font-bold text-sm" style={{ minWidth: 55 }}>
                            → {realPct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Level 2: Internal distribution of Gruesos */}
              {selectedGruesos.length > 0 && (
                <div className="mb-4 p-3 border-round" style={{ border: '1px solid #fdba74', background: 'rgba(245,158,11,0.04)' }}>
                  <h4 className="m-0 mb-2 text-base text-orange-700">
                    <i className="fa-solid fa-layer-group mr-2" />
                    Distribución de gruesos
                    <span className="text-sm text-500 ml-2">(dentro del {gruesosGlobalPct.toFixed(1)}% de gruesos)</span>
                  </h4>
                  <div className="flex flex-column gap-2">
                    {selectedGruesos.map((a) => {
                      const rawVal = gruposInternos[a.id] || "";
                      const numVal = parseDecimal(rawVal);
                      const sliderVal = isNaN(numVal) ? 0 : Math.max(0, Math.min(100, numVal));
                      const isLocked = a.id === lockedGruesoId;
                      const agg = agregados.find((ag) => ag.id === a.id);
                      const realPct = totalRealPcts?.[a.id] ?? 0;

                      return (
                        <div key={a.id} className="flex align-items-center gap-3">
                          <div className="flex align-items-center gap-2" style={{ minWidth: 180 }}>
                            <Button
                              icon={isLocked ? "fa-solid fa-lock" : "fa-solid fa-lock-open"}
                              size="small" text rounded
                              severity={isLocked ? "warning" : "secondary"}
                              tooltip={isLocked ? "Bloqueado: se ajusta automáticamente" : "Clic para bloquear"}
                              tooltipOptions={{ position: "top" }}
                              onClick={() => setLockedGruesoId(isLocked ? null : a.id)}
                              className="p-0" style={{ width: 28, height: 28 }}
                            />
                            <span className="font-bold text-sm white-space-nowrap overflow-hidden text-overflow-ellipsis" style={{ maxWidth: 140 }}>
                              {agg?.esMezclaGuardada && <i className="fa-solid fa-layer-group mr-1 text-purple-500 text-xs" />}
                              {agg?.nombre || `ID ${a.id}`}
                            </span>
                          </div>
                          <div className="flex-grow-1">
                            <Slider
                              value={sliderVal}
                              onChange={(e) => handleGruesoInternoChange(a.id, round2(e.value))}
                              min={0} max={100} step={0.5}
                              disabled={isLocked}
                              className="w-full"
                            />
                          </div>
                          <InputText
                            value={rawVal}
                            onChange={(e) => handleGruesoInternoChange(a.id, e.target.value)}
                            className="text-center" style={{ width: 60 }}
                            disabled={isLocked}
                            keyfilter={/[\d.,]/}
                          />
                          <span className="text-500 text-xs">%</span>
                          <span className="text-orange-600 font-bold text-sm" style={{ minWidth: 55 }}>
                            → {realPct.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Summary table: real percentages */}
              {totalRealPcts && (
                <div className="p-3 surface-50 border-round">
                  <h4 className="m-0 mb-2 text-base">
                    <i className="fa-solid fa-table mr-2" />
                    Porcentajes reales sobre mezcla total
                  </h4>
                  <DataTable
                    value={selectedAgregados.flatMap((a) => {
                      const realPct = totalRealPcts[a.id] || 0;
                      const internoStr = a.tipoAgregado === 'Fino'
                        ? `${parseDecimal(finosInternos[a.id] || '0').toFixed(1)}%`
                        : `${parseDecimal(gruposInternos[a.id] || '0').toFixed(1)}%`;
                      const row = {
                        key: String(a.id),
                        nombre: a.nombre,
                        tipo: a.tipoAgregado,
                        interno: internoStr,
                        real: `${realPct.toFixed(1)}%`,
                        isMezcla: !!a.esMezclaGuardada,
                        isSubItem: false,
                      };
                      const rows = [row];
                      // Expand saved mix: show each component with its proportional % real
                      if (a.esMezclaGuardada && a.mezclaItems?.length) {
                        for (const it of a.mezclaItems) {
                          rows.push({
                            key: `${a.id}-${it.idAgregado}`,
                            nombre: it.nombre,
                            tipo: a.tipoAgregado,
                            interno: `${(it.porcentajeFinal || 0).toFixed(1)}% (en mezcla)`,
                            real: `${(realPct * (it.porcentajeFinal || 0) / 100).toFixed(1)}%`,
                            isMezcla: false,
                            isSubItem: true,
                          });
                        }
                      }
                      return rows;
                    })}
                    size="small"
                    stripedRows
                    className="w-full"
                  >
                    <Column
                      field="nombre"
                      header="Agregado"
                      body={(row) => (
                        <span className={row.isSubItem ? "pl-4 text-500 text-sm" : row.isMezcla ? "font-semibold" : ""}>
                          {row.isSubItem && <i className="fa-solid fa-arrow-turn-down-right mr-2 text-xs" />}
                          {row.isMezcla && <i className="fa-solid fa-layer-group mr-2 text-purple-500 text-xs" />}
                          {row.nombre}
                        </span>
                      )}
                    />
                    <Column
                      field="tipo"
                      header="Tipo"
                      body={(row) => row.isSubItem ? null : (
                        <Tag
                          value={row.tipo}
                          severity={row.tipo === 'Fino' ? 'info' : 'warning'}
                        />
                      )}
                    />
                    <Column field="interno" header="% Interno" body={(row) => <span className={row.isSubItem ? "text-500 text-xs" : ""}>{row.interno}</span>} />
                    <Column
                      field="real"
                      header="% Real"
                      body={(row) => <span className={row.isSubItem ? "text-500 text-xs" : "font-bold"}>{row.real}</span>}
                    />
                  </DataTable>
                  <div className="flex gap-3 mt-2">
                    <span className="text-sm">
                      <b>Finos total:</b>{" "}
                      <span className="text-blue-600">{finosGlobalPct.toFixed(1)}%</span>
                    </span>
                    <span className="text-sm">
                      <b>Gruesos total:</b>{" "}
                      <span className="text-orange-600">{gruesosGlobalPct.toFixed(1)}%</span>
                    </span>
                    <span className="text-sm">
                      <b>Suma:</b>{" "}
                      <span className={Math.abs(totalPct - 100) < 0.5 ? "text-green-600" : "text-red-500"}>
                        {totalPct.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ──── Mix curve preview ──── */}
          {mixResult && mixChartData && (
            <div className="form-card br-15 p-4">
              <div className="flex align-items-center justify-content-between mb-3">
                <h3 className="m-0 text-lg">
                  <i className="fa-solid fa-chart-line mr-2" />
                  Curva de mezcla
                </h3>
                <div className="flex flex-wrap gap-3">
                  {mixResult.tmn && (
                    <span className="surface-100 border-round px-3 py-1 text-sm">
                      <b>TMN:</b> {mixResult.tmn.valor} mm
                    </span>
                  )}
                  {mixResult.moduloFinura && (
                    <span className="surface-100 border-round px-3 py-1 text-sm">
                      <b>MF:</b> {mixResult.moduloFinura.valor}
                    </span>
                  )}
                </div>
              </div>

              {/* Proportions badges */}
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedAgregados.map((a) => {
                  const agg = agregados.find((ag) => ag.id === a.id);
                  return (
                    <Tag
                      key={a.id}
                      value={`${agg?.nombre || `ID ${a.id}`}: ${
                        pctInputs[a.id] || 0
                      }%`}
                      className="px-3"
                    />
                  );
                })}
              </div>

              <div className="flex align-items-center gap-2 mb-2">
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
                {optResult?.trazabilidad && (
                  <Button
                    label="Ver trazabilidad"
                    icon="fa-solid fa-magnifying-glass-chart"
                    className="p-button-outlined p-button-sm"
                    onClick={() => setShowTrace(true)}
                  />
                )}
                <Button
                  label="Exportar PDF"
                  icon="fa-solid fa-file-pdf"
                  className="p-button-outlined p-button-sm p-button-secondary ml-auto"
                  onClick={() => setShowPdfDialog(true)}
                />
              </div>

              <div style={{ height: 350 }}>
                <PrimeChart
                  ref={mixChartRef}
                  type="line"
                  data={mixChartFinal}
                  options={mixChartOpts}
                  style={{ height: "100%" }}
                />
              </div>
            </div>
          )}

          {/* ──── Comparison with objective ──── */}
          {mixResult && selectedAgregados.length >= 2 && (
            <div className="form-card br-15 p-4">
              <div className="flex align-items-center justify-content-between mb-3">
                <h3 className="m-0 text-lg">
                  <i className="fa-solid fa-scale-balanced mr-2" />
                  Comparación con objetivo
                </h3>
                {modo === "AUTO" && (
                  <div className="flex align-items-center gap-2">
                    <small className="font-bold">Modo de optimización:</small>
                    <SelectButton
                      value={objetivoModo}
                      options={OBJETIVO_MODO_OPTIONS}
                      onChange={(e) => { if (e.value) setObjetivoModo(e.value); }}
                      allowEmpty={false}
                      className="p-buttonset-sm"
                    />
                  </div>
                )}
              </div>

              {/* Combined mode: priority selector */}
              {modo === "AUTO" && objetivoModo === "COMBINADO" && (
                <div className="flex align-items-center gap-3 mb-3 p-3 surface-50 border-round">
                  <small className="font-bold">Prioridad:</small>
                  <SelectButton
                    value={prioridad1}
                    options={PRIORIDAD_OPTIONS}
                    onChange={(e) => { if (e.value) setPrioridad1(e.value); }}
                    allowEmpty={false}
                  />
                  <span className="text-sm text-500">
                    {prioridad1 === "BANDA"
                      ? "Primero cumplir banda, luego acercarse a curva teórica"
                      : "Primero acercarse a curva teórica, luego cumplir banda"}
                  </span>
                </div>
              )}

              {/* ══════ AUTO mode: flat layout (no tabs) ══════ */}
              {modo === "AUTO" ? (
                <>
                  {/* ── Banda selector (BANDA or COMBINADO) ── */}
                  {(objetivoModo === "BANDA" || objetivoModo === "COMBINADO") && (
                    <div className="mb-4">
                      <div className="flex flex-wrap gap-3 align-items-end mb-3">
                        <div className="flex flex-column flex-grow-1">
                          <small className="font-bold mb-1">Banda de comparación</small>
                          <Dropdown
                            value={selectedBandaId}
                            options={allBandaOptions}
                            onChange={(e) => setSelectedBandaId(e.value)}
                            placeholder="Seleccionar banda (A-B, A-C, A-B-C…)"
                            className="w-full"
                            filter
                            showClear
                          />
                        </div>
                      </div>

                      {evalBanda && (
                        <div>
                          <div className="mb-3">
                            {(() => {
                              // evalBanda.cumple es output binario de evaluarContraBanda (mezclaCalcEngine).
                              // Display canónico: APTO / NO APTO. El algoritmo se mantiene boolean (D21).
                              const cat = evalBanda.cumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
                              const cfg = CATEGORIA_COLORS[cat];
                              return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} className="text-lg px-4 py-2" />;
                            })()}
                          </div>
                          {evalBanda.fueraDeBanda?.length > 0 && (
                            <div className="mb-3">
                              <small className="font-bold text-red-500">Tamices fuera de banda:</small>
                              <ul className="mt-1 mb-0 pl-4">
                                {evalBanda.fueraDeBanda.map((f, i) => (
                                  <li key={i} className="text-sm">
                                    {f.tamiz} — mezcla: {f.medido?.toFixed(1)}% (banda: {f.min?.toFixed(1)}–{f.max?.toFixed(1)}%), desvío: {f.desvio?.toFixed(1)}%
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {objetivoModo === "BANDA" && bandaChartData && (
                            <div style={{ height: 380 }}>
                              <PrimeChart ref={bandaChartRef} type="line" data={bandaChartFinal} options={bandaChartOpts} style={{ height: "100%" }} />
                            </div>
                          )}
                        </div>
                      )}
                      {selectedBandaId && !evalBanda && (
                        <AlertBox severity="info" className="w-full">No se pudo evaluar con la banda seleccionada.</AlertBox>
                      )}
                    </div>
                  )}

                  {/* ── Curva teórica selector (CURVA or COMBINADO) ── */}
                  {(objetivoModo === "CURVA" || objetivoModo === "COMBINADO") && (
                    <div className="mb-4">
                      <div className="flex align-items-center gap-2 mb-3">
                        <small className="font-bold">Curva teórica de referencia</small>
                        <span className="text-400 text-sm mx-2">|</span>
                        <button
                          type="button"
                          className={`p-link text-sm ${useDynamicCurve ? "font-bold text-primary" : "text-500"}`}
                          onClick={() => setUseDynamicCurve(true)}
                        >
                          Generar por fórmula
                        </button>
                        <span className="text-400">/</span>
                        <button
                          type="button"
                          className={`p-link text-sm ${!useDynamicCurve ? "font-bold text-primary" : "text-500"}`}
                          onClick={() => setUseDynamicCurve(false)}
                        >
                          Del catálogo
                        </button>
                      </div>

                      {useDynamicCurve ? (
                        <div className="flex flex-wrap gap-3 align-items-end mb-3">
                          <div className="flex flex-column" style={{ minWidth: 180 }}>
                            <small className="font-bold mb-1">Familia</small>
                            <Dropdown
                              value={familiaTeor}
                              options={FAMILIA_TEORICA_OPTIONS}
                              onChange={(e) => setFamiliaTeor(e.value)}
                              placeholder="Familia"
                              className="w-full"
                            />
                          </div>
                          <div className="flex flex-column" style={{ minWidth: 120 }}>
                            <small className="font-bold mb-1">TMN objetivo</small>
                            <Dropdown
                              value={tmnTeor}
                              options={TMN_TEORICA_OPTIONS}
                              onChange={(e) => setTmnTeor(e.value)}
                              placeholder="TMN"
                              className="w-full"
                            />
                          </div>
                          {familiaTeor && FAMILIA_DEFAULTS[familiaTeor] && (
                            <div className="flex flex-column" style={{ minWidth: 100 }}>
                              <small className="font-bold mb-1">
                                {FAMILIA_DEFAULTS[familiaTeor].paramKey}
                              </small>
                              <InputNumber
                                value={paramTeor}
                                onValueChange={(e) => setParamTeor(e.value)}
                                mode="decimal"
                                minFractionDigits={2}
                                maxFractionDigits={2}
                                min={FAMILIA_DEFAULTS[familiaTeor].paramMin}
                                max={FAMILIA_DEFAULTS[familiaTeor].paramMax}
                                step={FAMILIA_DEFAULTS[familiaTeor].paramStep}
                                className="w-full"
                              />
                            </div>
                          )}
                          {dynamicCurveLabel && (
                            <div className="flex align-items-end">
                              <span className="text-sm font-italic text-600">
                                {dynamicCurveLabel}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-3 align-items-end mb-3">
                          <div className="flex flex-column flex-grow-1">
                            <Dropdown
                              value={selectedTeoricaId}
                              options={teoricaOptions}
                              onChange={(e) => setSelectedTeoricaId(e.value)}
                              placeholder="Seleccionar curva teórica (Fuller, etc.)"
                              className="w-full"
                              filter
                              showClear
                            />
                          </div>
                        </div>
                      )}

                      {evalTeorica && (
                        <div>
                          <div className="flex flex-wrap gap-3 mb-3">
                            {evalTeorica.rmse != null && (
                              <div className="flex flex-column align-items-center surface-100 border-round p-3">
                                <small className="text-500 font-bold">RMSE</small>
                                <span className="text-xl font-bold">{evalTeorica.rmse}</span>
                              </div>
                            )}
                            {evalTeorica.mae != null && (
                              <div className="flex flex-column align-items-center surface-100 border-round p-3">
                                <small className="text-500 font-bold">MAE</small>
                                <span className="text-xl font-bold">{evalTeorica.mae}</span>
                              </div>
                            )}
                            {evalTeorica.r2 != null && (
                              <div className="flex flex-column align-items-center surface-100 border-round p-3">
                                <small className="text-500 font-bold">R²</small>
                                <span className="text-xl font-bold">{evalTeorica.r2}</span>
                              </div>
                            )}
                            {evalTeorica.maxDesvio != null && (
                              <div className="flex flex-column align-items-center surface-100 border-round p-3">
                                <small className="text-500 font-bold">Max desvío</small>
                                <span className="text-xl font-bold">{evalTeorica.maxDesvio}</span>
                              </div>
                            )}
                          </div>
                          {objetivoModo === "CURVA" && teoricaChartData && (
                            <div style={{ height: 380 }}>
                              <PrimeChart ref={teoricaChartRef} type="line" data={teoricaChartFinal} options={teoricaChartOpts} style={{ height: "100%" }} />
                            </div>
                          )}
                        </div>
                      )}
                      {(selectedTeoricaId || (useDynamicCurve && curvaGeneradaPayload)) && !evalTeorica && (
                        <AlertBox severity="info" className="w-full">No se pudo comparar con la curva teórica seleccionada.</AlertBox>
                      )}
                    </div>
                  )}

                  {/* ── Combined chart (COMBINADO) ── */}
                  {objetivoModo === "COMBINADO" && combinedChartData && (
                    <div style={{ height: 380 }} className="mb-3">
                      <PrimeChart ref={combinedChartRef} type="line" data={combinedChartFinal} options={combinedChartOpts} style={{ height: "100%" }} />
                    </div>
                  )}

                  {/* ── Optimize button ── */}
                  <div className="flex justify-content-center mt-2 mb-2">
                    <Button
                      label="Optimizar"
                      icon="fa-solid fa-wand-magic-sparkles"
                      severity="success"
                      rounded
                      loading={computing}
                      onClick={optimizar}
                      disabled={
                        (objetivoModo === "BANDA" && !selectedBandaId) ||
                        (objetivoModo === "CURVA" && !selectedTeoricaId && !curvaGeneradaPayload) ||
                        (objetivoModo === "COMBINADO" && (!selectedBandaId || (!selectedTeoricaId && !curvaGeneradaPayload)))
                      }
                    />
                  </div>

                  {/* ── Optimization failure warning ── */}
                  {optResult && optResult.optimizacion?.ok === false && (
                    <div className="mt-3">
                      <AlertBox
                        severity={optResult.optimizacion.reason === "INSUFFICIENT_COMPARABLE_SIEVES" ? "error" : "warn"}
                        className="w-full"
                      >
                        {optResult.optimizacion.reason === "INSUFFICIENT_COMPARABLE_SIEVES"
                          ? (optResult.optimizacion.mensaje || "No se pudo optimizar.")
                          : "No hay solución factible. Se muestra la combinación con menor desvío posible."}
                      </AlertBox>
                    </div>
                  )}

                  {/* ── Combined result summary ── */}
                  {optResult && optResult.objetivoModo === "COMBINADO" && optResult.resumen && optResult.optimizacion?.ok !== false && (
                    <div className="mt-3 p-3 surface-50 border-round border-1 border-300">
                      <h4 className="m-0 mb-2 text-base">
                        <i className="fa-solid fa-chart-column mr-2" />
                        Resultado combinado
                        <span className="ml-2 text-sm font-normal text-500">
                          (prioridad: {optResult.prioridad1 === "BANDA" ? "Banda primero" : "Curva primero"})
                        </span>
                      </h4>
                      <div className="flex flex-wrap gap-3">
                        <div className={`flex flex-column align-items-center border-round p-3 ${optResult.resumen.bandaCumple ? "bg-green-50" : "bg-red-50"}`}>
                          <small className="text-500 font-bold">Banda</small>
                          {(() => {
                            // Resumen del optimizador. Preservamos el conteo "X fuera" para no perder
                            // información operativa cuando no cumple.
                            const cat = optResult.resumen.bandaCumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
                            const cfg = CATEGORIA_COLORS[cat];
                            const value = optResult.resumen.bandaCumple ? cat : `${cat} (${optResult.resumen.fueraDeBanda} fuera)`;
                            return <Tag value={value} severity={cfg.severity} icon={cfg.icon} />;
                          })()}
                        </div>
                        {optResult.resumen.errorTeorico && optResult.resumen.errorTeorico.mae != null && (
                          <>
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">MAE teór.</small>
                              <span className="text-xl font-bold">{optResult.resumen.errorTeorico.mae?.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">RMSE teór.</small>
                              <span className="text-xl font-bold">{optResult.resumen.errorTeorico.rmse?.toFixed(2)}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">Max desvío</small>
                              <span className="text-xl font-bold">{optResult.resumen.errorTeorico.maxDesvio?.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                      </div>
                      {optResult.warnings?.length > 0 && (
                        <div className="mt-2 flex flex-column gap-2">
                          {optResult.warnings.map((w, i) => (
                            <AlertBox key={i} severity="warn" className="w-full">{w.message}</AlertBox>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                /* ══════ MANUAL mode: tabs ══════ */
                <TabView
                  activeIndex={compTabIdx}
                  onTabChange={(e) => setCompTabIdx(e.index)}
                >
                  <TabPanel header="Banda (cumple / no cumple)">
                    <div className="flex flex-wrap gap-3 align-items-end mb-3 mt-2">
                      <div className="flex flex-column flex-grow-1">
                        <small className="font-bold mb-1">Banda de comparación</small>
                        <Dropdown
                          value={selectedBandaId}
                          options={allBandaOptions}
                          onChange={(e) => setSelectedBandaId(e.value)}
                          placeholder="Seleccionar banda (A-B, A-C, A-B-C…)"
                          className="w-full"
                          filter
                          showClear
                        />
                      </div>
                    </div>

                    {evalBanda && (
                      <div>
                        <div className="mb-3">
                          {(() => {
                            const cat = evalBanda.cumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
                            const cfg = CATEGORIA_COLORS[cat];
                            return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} className="text-lg px-4 py-2" />;
                          })()}
                        </div>
                        {evalBanda.fueraDeBanda?.length > 0 && (
                          <div className="mb-3">
                            <small className="font-bold text-red-500">Tamices fuera de banda:</small>
                            <ul className="mt-1 mb-0 pl-4">
                              {evalBanda.fueraDeBanda.map((f, i) => (
                                <li key={i} className="text-sm">
                                  {f.tamiz} — mezcla: {f.medido?.toFixed(1)}% (banda: {f.min?.toFixed(1)}–{f.max?.toFixed(1)}%), desvío: {f.desvio?.toFixed(1)}%
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {bandaChartData && (
                          <div style={{ height: 380 }}>
                            <PrimeChart ref={bandaChartRef} type="line" data={bandaChartFinal} options={bandaChartOpts} style={{ height: "100%" }} />
                          </div>
                        )}
                      </div>
                    )}
                    {selectedBandaId && !evalBanda && (
                      <AlertBox severity="info" className="w-full">No se pudo evaluar con la banda seleccionada.</AlertBox>
                    )}
                  </TabPanel>

                  <TabPanel header="Curva teórica (similitud)">
                    <div className="flex align-items-center gap-2 mb-3 mt-2">
                      <small className="font-bold">Curva teórica de referencia</small>
                      <span className="text-400 text-sm mx-2">|</span>
                      <button
                        type="button"
                        className={`p-link text-sm ${useDynamicCurve ? "font-bold text-primary" : "text-500"}`}
                        onClick={() => setUseDynamicCurve(true)}
                      >
                        Generar por fórmula
                      </button>
                      <span className="text-400">/</span>
                      <button
                        type="button"
                        className={`p-link text-sm ${!useDynamicCurve ? "font-bold text-primary" : "text-500"}`}
                        onClick={() => setUseDynamicCurve(false)}
                      >
                        Del catálogo
                      </button>
                    </div>

                    {useDynamicCurve ? (
                      <div className="flex flex-wrap gap-3 align-items-end mb-3">
                        <div className="flex flex-column" style={{ minWidth: 180 }}>
                          <small className="font-bold mb-1">Familia</small>
                          <Dropdown
                            value={familiaTeor}
                            options={FAMILIA_TEORICA_OPTIONS}
                            onChange={(e) => setFamiliaTeor(e.value)}
                            placeholder="Familia"
                            className="w-full"
                          />
                        </div>
                        <div className="flex flex-column" style={{ minWidth: 120 }}>
                          <small className="font-bold mb-1">TMN objetivo</small>
                          <Dropdown
                            value={tmnTeor}
                            options={TMN_TEORICA_OPTIONS}
                            onChange={(e) => setTmnTeor(e.value)}
                            placeholder="TMN"
                            className="w-full"
                          />
                        </div>
                        {familiaTeor && FAMILIA_DEFAULTS[familiaTeor] && (
                          <div className="flex flex-column" style={{ minWidth: 100 }}>
                            <small className="font-bold mb-1">
                              {FAMILIA_DEFAULTS[familiaTeor].paramKey}
                            </small>
                            <InputNumber
                              value={paramTeor}
                              onValueChange={(e) => setParamTeor(e.value)}
                              mode="decimal"
                              minFractionDigits={2}
                              maxFractionDigits={2}
                              min={FAMILIA_DEFAULTS[familiaTeor].paramMin}
                              max={FAMILIA_DEFAULTS[familiaTeor].paramMax}
                              step={FAMILIA_DEFAULTS[familiaTeor].paramStep}
                              className="w-full"
                            />
                          </div>
                        )}
                        {dynamicCurveLabel && (
                          <div className="flex align-items-end">
                            <span className="text-sm font-italic text-600">
                              {dynamicCurveLabel}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-3 align-items-end mb-3">
                        <div className="flex flex-column flex-grow-1">
                          <Dropdown
                            value={selectedTeoricaId}
                            options={teoricaOptions}
                            onChange={(e) => setSelectedTeoricaId(e.value)}
                            placeholder="Seleccionar curva teórica (Fuller, etc.)"
                            className="w-full"
                            filter
                            showClear
                          />
                        </div>
                      </div>
                    )}

                    {evalTeorica && (
                      <div>
                        <div className="flex flex-wrap gap-3 mb-3">
                          {evalTeorica.rmse != null && (
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">RMSE</small>
                              <span className="text-xl font-bold">{evalTeorica.rmse}</span>
                            </div>
                          )}
                          {evalTeorica.mae != null && (
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">MAE</small>
                              <span className="text-xl font-bold">{evalTeorica.mae}</span>
                            </div>
                          )}
                          {evalTeorica.r2 != null && (
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">R²</small>
                              <span className="text-xl font-bold">{evalTeorica.r2}</span>
                            </div>
                          )}
                          {evalTeorica.maxDesvio != null && (
                            <div className="flex flex-column align-items-center surface-100 border-round p-3">
                              <small className="text-500 font-bold">Max desvío</small>
                              <span className="text-xl font-bold">{evalTeorica.maxDesvio}</span>
                            </div>
                          )}
                        </div>
                        {teoricaChartData && (
                          <div style={{ height: 380 }}>
                            <PrimeChart ref={teoricaChartRef} type="line" data={teoricaChartFinal} options={teoricaChartOpts} style={{ height: "100%" }} />
                          </div>
                        )}
                      </div>
                    )}
                    {(selectedTeoricaId || (useDynamicCurve && curvaGeneradaPayload)) && !evalTeorica && (
                      <AlertBox severity="info" className="w-full">No se pudo comparar con la curva teórica seleccionada.</AlertBox>
                    )}
                  </TabPanel>
                </TabView>
              )}

              {/* ──── Save button ──── */}
              {(optResult || mixResult) && (
                <div className="flex justify-content-end mt-3">
                  <Button
                    label={editingMezcla ? "Guardar cambios" : "Guardar mezcla"}
                    icon="fa-solid fa-floppy-disk"
                    severity="help"
                    rounded
                    onClick={() => {
                      if (editingMezcla && !saveName.trim()) {
                        setSaveName(editingMezcla.nombre || "");
                      }
                      setShowSaveDialog(true);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ──── Save dialog ──── */}
          <Dialog
            header={editingMezcla ? "Guardar cambios en mezcla" : "Guardar mezcla en catálogo"}
            visible={showSaveDialog}
            onHide={() => setShowSaveDialog(false)}
            style={{ width: "90vw", maxWidth: "32rem" }}
            modal
            footer={
              <div className="flex justify-content-end gap-2">
                <Button
                  label="Cancelar"
                  icon="fa-solid fa-xmark"
                  severity="secondary"
                  text
                  onClick={() => setShowSaveDialog(false)}
                />
                <Button
                  label="Guardar"
                  icon="fa-solid fa-check"
                  severity="success"
                  loading={saving}
                  onClick={guardarMezclaFn}
                  disabled={!saveName.trim() || saving}
                />
              </div>
            }
          >
            <div className="flex flex-column gap-3">
              <div className="flex flex-column gap-1">
                <label className="font-bold text-sm">Nombre *</label>
                <InputText
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="Nombre de la mezcla"
                  maxLength={150}
                />
              </div>
              <div className="flex flex-column gap-1">
                <label className="font-bold text-sm">Descripción</label>
                <InputTextarea
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder="Notas adicionales (opcional)"
                  rows={3}
                  maxLength={500}
                />
              </div>
            </div>
          </Dialog>

          {/* ──── Data table ──── */}
          {mixResult && (
            <div className="form-card br-15 p-4">
              <h3 className="m-0 mb-3 text-lg">
                <i className="fa-solid fa-table mr-2" />
                Datos de la curva de mezcla
              </h3>
              <DataTable responsiveLayout="scroll"
                value={mixResult.curvaMix?.filter(
                  (p) => p.pasaPct !== null
                )}
                size="small"
                stripedRows
              >
                <Column field="tamiz" header="Tamiz" />
                <Column
                  field="aberturaMm"
                  header="Abertura (mm)"
                  sortable
                />
                <Column
                  field="pasaPct"
                  header="% Pasa"
                  body={(p) => p.pasaPct?.toFixed(2)}
                  sortable
                />
                <Column
                  header="Métodos"
                  body={(p) => (
                    <span className="text-xs text-500">
                      {(p.metodos || []).join(", ")}
                    </span>
                  )}
                />
                <Column
                  header=""
                  body={(p) =>
                    !p.completo ? (
                      <i
                        className="fa-solid fa-triangle-exclamation text-orange-400"
                        title="Dato incompleto (no todos los agregados tenían valor en este tamiz)"
                      />
                    ) : null
                  }
                />
              </DataTable>
            </div>
          )}

          {/* ──── Optimization result ──── */}
          {optResult?.optimizacion && (
            <div className="form-card br-15 p-4">
              <h3 className="m-0 mb-2 text-lg">
                <i className="fa-solid fa-wand-magic-sparkles mr-2" />
                Resultado de optimización
              </h3>

              {/* Insufficient data — error only, no result to show */}
              {optResult.optimizacion.ok === false && optResult.optimizacion.reason === "INSUFFICIENT_COMPARABLE_SIEVES" ? (
                <>
                  <AlertBox severity="error" className="w-full mb-2">
                    {optResult.optimizacion.mensaje || "No se pudo optimizar contra la curva teórica seleccionada."}
                  </AlertBox>
                  <small style={{ color: '#94a3b8' }}>
                    Tamices comparables: {optResult.optimizacion.comparableSievesCount || 0}.
                    Se requieren al menos 4 para intentar optimizar.
                  </small>
                </>
              ) : (
                <>
                  {/* Warning when no feasible solution — best approximation is shown */}
                  {optResult.optimizacion.ok === false && (
                    <AlertBox severity="warn" className="w-full mb-3">
                      {optResult.optimizacion.mensaje || "No existe solución factible. Se muestra la combinación con menor desvío posible."}
                    </AlertBox>
                  )}

                  <div className="flex flex-wrap gap-3 mb-3">
                    {optResult.optimizacion.metodo && (
                      <div className="flex flex-column align-items-center surface-100 border-round p-3">
                        <small className="text-500 font-bold">Método</small>
                        <span className="text-sm">{optResult.optimizacion.metodo}</span>
                      </div>
                    )}
                    {optResult.optimizacion.ok !== false && optResult.optimizacion.mensaje && (
                      <div className="flex flex-column align-items-center surface-100 border-round p-3">
                        <small className="text-500 font-bold">Resultado</small>
                        <span className="text-sm">{optResult.optimizacion.mensaje}</span>
                      </div>
                    )}
                    {optResult.optimizacion.feasible !== undefined && (
                      <div className="flex flex-column align-items-center surface-100 border-round p-3">
                        <small className="text-500 font-bold">Factibilidad</small>
                        <Tag
                          value={optResult.optimizacion.feasible ? "FACTIBLE" : "NO FACTIBLE"}
                          severity={optResult.optimizacion.feasible ? "success" : "warning"}
                          className="text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {/* ── Feasible ranges per aggregate ── */}
                  {optResult.optimizacion.rangos?.length > 0 && (
                    <>
                      <h4 className="m-0 mb-2 text-base">
                        <i className="fa-solid fa-arrows-left-right mr-2" />
                        Rangos de porcentaje por agregado
                      </h4>
                      <DataTable responsiveLayout="scroll"
                        value={optResult.optimizacion.rangos.map((r) => {
                          const agg = agregados.find((a) => Number(a.id) === Number(r.id));
                          return { ...r, nombre: agg?.nombre || `ID ${r.id}` };
                        })}
                        size="small"
                        className="mb-2"
                        stripedRows
                      >
                        <Column field="nombre" header="Agregado" />
                        <Column
                          header="Óptimo %"
                          body={(r) => {
                            const opt = optResult.agregados?.find((a) => a.id === r.id);
                            return opt ? `${opt.porcentaje}%` : (r.optimalPct != null ? `${r.optimalPct}%` : "–");
                          }}
                        />
                        <Column
                          header="Mín %"
                          body={(r) => `${r.minPct}%`}
                        />
                        <Column
                          header="Máx %"
                          body={(r) => `${r.maxPct}%`}
                        />
                        <Column
                          header="Estado"
                          body={(r) => {
                            if (r.fixed) return <Tag value="FIJO" severity="info" className="text-xs" />;
                            if (r.feasible === true) return <Tag value="FACTIBLE" severity="success" className="text-xs" />;
                            if (r.feasible === false) return <Tag value="APROXIMADO" severity="warning" className="text-xs" />;
                            if (r.bestMae != null) return <span className="text-xs text-500">MAE: {r.bestMae}%</span>;
                            return "–";
                          }}
                        />
                      </DataTable>

                      {/* ── Adjust button ── */}
                      {!showAjuste && (
                        <Button
                          label="Ajustar proporciones"
                          icon="fa-solid fa-sliders"
                          className="p-button-sm p-button-outlined mt-1"
                          onClick={() => setShowAjuste(true)}
                        />
                      )}
                    </>
                  )}

                  {/* ── Post-optimization adjustment panel ── */}
                  {showAjuste && optResult?.optimizacion?.rangos?.length > 0 && (
                    <AjustePostOptimizacion
                      agregados={selectedAgregados.map((a) => ({
                        id: a.id,
                        nombre: a.nombre,
                        porcentaje: parseDecimal(pctInputs[a.id]) || 0,
                        puntos: a.puntos || [],
                      }))}
                      optResult={optResult}
                      bandaPuntos={bandaPuntosResolved}
                      teoricaPuntos={teoricaPuntosResolved}
                      onApply={(newPctInputs, metadata) => {
                        // Update pctInputs with adjusted values
                        const updated = { ...pctInputs };
                        for (const [id, pct] of Object.entries(newPctInputs)) {
                          updated[id] = String(pct);
                        }
                        setPctInputs(updated);
                        setAjusteMetadata(metadata);
                        setShowAjuste(false);
                      }}
                      onCancel={() => setShowAjuste(false)}
                    />
                  )}
                </>
              )}

              {/* Debug info */}
              {optResult.optimizacion._debug && (
                <details style={{ marginTop: '0.5rem', color: '#94a3b8', fontSize: '0.75rem' }}>
                  <summary style={{ cursor: 'pointer' }}>Debug info</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1', background: '#1e293b', padding: '0.5rem', borderRadius: '4px', marginTop: '0.25rem' }}>
                    {JSON.stringify(optResult.optimizacion._debug, null, 2)}
                  </pre>
                  {optResult.optimizacion.comparableSieves?.length > 0 && (
                    <pre style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1', background: '#1e293b', padding: '0.5rem', borderRadius: '4px', marginTop: '0.25rem' }}>
                      comparableSieves: {JSON.stringify(optResult.optimizacion.comparableSieves, null, 2)}
                    </pre>
                  )}
                </details>
              )}
            </div>
          )}
        </div>
      </div>
      <PdfExportDialog
        visible={showPdfDialog}
        onHide={() => setShowPdfDialog(false)}
        onConfirm={handleExportPdf}
        defaultTitulo={saveName || editingMezcla?.nombre || ''}
        hasTrazabilidad={!!optResult?.trazabilidad}
      />
      <MezclaTraceDrawer
        visible={showTrace}
        onHide={() => setShowTrace(false)}
        trazabilidad={optResult?.trazabilidad}
        metricas={optResult?.resumen}
      />
    </Fade>
  );
};

export default MezclasPage;
