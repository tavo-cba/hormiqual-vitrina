import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Divider } from "primereact/divider";
import { Tag } from "primereact/tag";
import { Dialog } from "primereact/dialog";
import { useToast } from "../../../context/ToastContext";
import CurvaChart from "./CurvaChart";
import {
  getTamicesCatalogSync,
  fetchTamicesCatalog,
  getIRAMTemplate as _getIRAMTemplate,
  getTamizFilterForUso as _getTamizFilterForUso,
  buildTamizAbertura,
} from "../../../services/tamicesCatalogService";

/* ══════════════════════════════════════════════════════
   Tamices — consumidos del catálogo centralizado
   ══════════════════════════════════════════════════════ */
const _cat = getTamicesCatalogSync();
const ALL_TAMICES_IRAM = _cat.IRAM.superset;
const TAMICES_IRAM_STD = _cat.IRAM.standard;
const TAMICES_IRAM_ALT = _cat.IRAM.alt;
const TAMICES_ASTM = _cat.ASTM.superset;
const ABERTURAS_FINO = _cat.IRAM.aberturasFino;
const ABERTURAS_GRUESO = _cat.IRAM.aberturasGrueso;
const VARIANT_REMAP = _cat.IRAM.variantRemap;
const TAMIZ_TO_ABERTURA = buildTamizAbertura(_cat);

function getIRAMTemplate(variant) {
  return _getIRAMTemplate(_cat, variant);
}

function getTamizFilterForUso(usoVal, serie) {
  return _getTamizFilterForUso(_cat, usoVal, serie);
}

const TIPO_OPTIONS = [
  { label: "Teórica (fórmula)", value: "TEORICA" },
  { label: "Banda (envolvente)", value: "BANDA" },
  { label: "Tabulada (% pasa)", value: "TABULADA" },
];

const SERIE_OPTIONS = [
  { label: "IRAM", value: "IRAM" },
  // ASTM option hidden from UI (internal mapping retained)
];

const TAMIZ_VARIANT_OPTIONS = [
  { label: "Estándar", value: "ESTANDAR" },
  { label: "Alternativos", value: "ALTERNATIVO" },
];

const USO_OPTIONS = [
  { label: "Fino", value: "FINO" },
  { label: "Grueso", value: "GRUESO" },
  { label: "Total", value: "TOTAL" },
];

const SPEC_MODE_OPTIONS = [
  { label: "Rango (mín + máx)", value: "RANGO" },
  { label: "Solo máximo", value: "MAX_ONLY" },
  { label: "Solo mínimo", value: "MIN_ONLY" },
  { label: "Objetivo (%)", value: "OBJETIVO" },
];

/* Plantillas IRAM 1627 */
const IRAM_1627_TEMPLATES = [
  {
    label: "IRAM 1627 — Fino (Banda A: máximos)",
    uso: "FINO", specMode: "MAX_ONLY", tipo: "BANDA",
    normaRef: "IRAM 1627",
    tamices: ["9.5 mm", "4.75 mm", "2.36 mm", "1.18 mm", "600 µm", "300 µm", "150 µm"],
  },
  {
    label: "IRAM 1627 — Fino (Banda B: rango)",
    uso: "FINO", specMode: "RANGO", tipo: "BANDA",
    normaRef: "IRAM 1627",
    tamices: ["9.5 mm", "4.75 mm", "2.36 mm", "1.18 mm", "600 µm", "300 µm", "150 µm"],
  },
];

/* Plantillas IRAM 1627 — Gruesos (Tabla 2) por rango de tamaño.
   Cada rango define límites; la grilla usa la serie IRAM completa
   y marca isNA las filas fuera del rango. */
const IRAM_1627_GRUESO_RANGES = [
  { label: "53 a 4.75",   abMax: 63,   abMin: 4.75 },
  { label: "37.5 a 4.75", abMax: 53,   abMin: 4.75 },
  { label: "26.5 a 4.75", abMax: 37.5, abMin: 2.36 },
  { label: "19 a 4.75",   abMax: 26.5, abMin: 2.36 },
  { label: "13.2 a 4.75", abMax: 19,   abMin: 2.36 },
  { label: "53 a 26.5",   abMax: 63,   abMin: 13.2 },
  { label: "37.5 a 19",   abMax: 53,   abMin: 9.5 },
  { label: "9.5 a 2.36",  abMax: 13.2, abMin: 1.18 },
];

function buildGruesoTemplate(range, variant) {
  const serie = getIRAMTemplate(variant || "ESTANDAR");
  const tamices = serie.map(t => t.tamiz);
  return {
    label: `IRAM 1627:1997 — Grueso — ${range.label}`,
    uso: "GRUESO",
    specMode: "RANGO",
    tipo: "BANDA",
    normaRef: "IRAM 1627:1997",
    referenciaTabla: "Tabla 2",
    tamices,
    // Rango para marcar isNA fuera de límites
    naRange: { abMax: range.abMax, abMin: range.abMin },
  };
}

/* ── IRAM 1627 — Totales: Tablas 3 a 8 ─────────── */
const IRAM_1627_TOTAL_TMN = [
  { tmn: 53,   tabla: "Tabla 3" },
  { tmn: 37.5, tabla: "Tabla 4" },
  { tmn: 26.5, tabla: "Tabla 5" },
  { tmn: 19,   tabla: "Tabla 6" },
  { tmn: 13.2, tabla: "Tabla 7" },
  { tmn: 9.5,  tabla: "Tabla 8" },
];
const IRAM_1627_TOTAL_CURVAS = ["A", "B", "C"];

/* Tamices serie larga para totales IRAM */
const TAMICES_TOTAL_IRAM = [
  "63 mm", "53 mm", "37.5 mm", "26.5 mm", "19 mm", "13.2 mm",
  "9.5 mm", "4.75 mm", "2.36 mm", "1.18 mm", "600 µm", "300 µm", "150 µm",
];

/* Helper: build a Total template on the fly */
function buildTotalTemplate(tmn, curva, tabla) {
  return {
    label: `IRAM 1627:1997 — Total — TMN ${tmn} — Curva ${curva}`,
    uso: "TOTAL",
    specMode: "OBJETIVO",
    tipo: "BANDA",
    normaRef: "IRAM 1627:1997",
    referenciaTabla: tabla,
    tmnMm: tmn,
    tamices: TAMICES_TOTAL_IRAM,
  };
}

/* ═════════════════════════════════════════════════════════
   ASTM C33 — Plantillas de estructura (Fine & Coarse)
   Tamices según ASTM E11. Valores NO precargados.
   ═════════════════════════════════════════════════════════ */
const ASTM_C33_FINE_TAMICES = [
  '⅜"', 'N° 4', 'N° 8', 'N° 16', 'N° 30', 'N° 50', 'N° 100', 'N° 200',
];

const ASTM_C33_FINE_TEMPLATE = {
  label: "ASTM C33 — Fino (Fine Aggregate)",
  uso: "FINO",
  specMode: "RANGO",
  tipo: "BANDA",
  serieTamices: "ASTM",
  normaRef: "ASTM C33/C33M",
  tamices: ASTM_C33_FINE_TAMICES,
  parametros: { standard: 'ASTM C33', kind: 'FINE' },
};

/* Tamices ASTM completos para grilla de gruesos (4" a N° 50, sin N° 30) — 14 tamices */
const ASTM_COARSE_GRID = TAMICES_ASTM
  .filter((t) => t.aberturaMm >= 0.3 && t.aberturaMm !== 0.6)
  .map((t) => t.tamiz);

/**
 * Backfill: asegurar que una curva ASTM tenga todos los tamices de la serie.
 * Los que falten se agregan como isNA=true (sin alterar puntos existentes).
 */
function ensureASTMGrid(puntos) {
  const existing = new Set(puntos.map((p) => p.aberturaMm));
  let changed = false;
  for (const t of TAMICES_ASTM) {
    if (!existing.has(t.aberturaMm)) {
      puntos.push({
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        pasaPct: null,
        limInfPct: null,
        limSupPct: null,
        targetPct: null,
        isNA: true,
        orden: 999,
      });
      changed = true;
    }
  }
  if (changed) {
    puntos.sort((a, b) => b.aberturaMm - a.aberturaMm);
    puntos.forEach((p, i) => { p.orden = i; });
  }
  return puntos;
}

const ASTM_C33_COARSE_SIZES = [
  {
    sizeNo: '57', label: 'Size No. 57 — 1" to N°4',
    naRange: { abMax: 37.5, abMin: 2.36 },
    tmnMm: 25,
  },
  {
    sizeNo: '67', label: 'Size No. 67 — ¾" to N°4',
    naRange: { abMax: 25, abMin: 2.36 },
    tmnMm: 19,
  },
  {
    sizeNo: '7', label: 'Size No. 7 — ½" to N°4',
    naRange: { abMax: 19, abMin: 1.18 },
    tmnMm: 12.5,
  },
  {
    sizeNo: '8', label: 'Size No. 8 — ⅜" to N°8',
    naRange: { abMax: 12.5, abMin: 1.18 },
    tmnMm: 9.5,
  },
  {
    sizeNo: '89', label: 'Size No. 89 — ⅜" to N°16',
    naRange: { abMax: 12.5, abMin: 0.3 },
    tmnMm: 9.5,
  },
];

function buildASTMCoarseTemplate(size) {
  return {
    label: `ASTM C33 — Grueso — ${size.label}`,
    uso: "GRUESO",
    specMode: "RANGO",
    tipo: "BANDA",
    serieTamices: "ASTM",
    normaRef: "ASTM C33/C33M",
    tmnMm: size.tmnMm,
    tamices: ASTM_COARSE_GRID,
    naRange: size.naRange,
    parametros: { standard: 'ASTM C33', kind: 'COARSE', sizeNo: size.sizeNo },
  };
}

const FORMULA_OPTIONS = [
  { label: "Fuller / Talbot", value: "FULLER_TALBOT" },
  { label: "Andreasen & Andersen", value: "ANDREASEN" },
  { label: "Funk & Dinger (mod. Andreasen)", value: "ANDREASEN_MOD" },
  { label: "Rosin-Rammler", value: "ROSIN_RAMMLER" },
  // Legacy (compat)
  { label: "Fuller (legacy)", value: "fuller", className: "hidden" },
  { label: "Andreasen (legacy)", value: "andreasen", className: "hidden" },
  { label: "Modified A&A (legacy)", value: "modified_aa", className: "hidden" },
];
const FORMULA_OPTIONS_VISIBLE = FORMULA_OPTIONS.filter(o => !o.className);

/* Parámetros default por fórmula */
const FORMULA_DEFAULTS = {
  FULLER_TALBOT: { formula: "FULLER_TALBOT", dmax: 25, n: 0.5 },
  ANDREASEN: { formula: "ANDREASEN", dmax: 25, dmin: 0.075, q: 0.37 },
  ANDREASEN_MOD: { formula: "ANDREASEN_MOD", dmax: 25, dmin: 0.075, q: 0.37 },
  ROSIN_RAMMLER: { formula: "ROSIN_RAMMLER", dmax: 25, x: 12.5, k: 2.0 },
  // Legacy
  fuller: { formula: "fuller", dmax: 25, n: 0.5 },
  andreasen: { formula: "andreasen", dmax: 25, q: 0.37 },
  modified_aa: { formula: "modified_aa", dmax: 25, dmin: 0.075, q: 0.37 },
};

/* ══════════════════════════════════════════════════════
   Presets: configuraciones típicas listas para usar
   ══════════════════════════════════════════════════════ */
const D_OPTIONS_IRAM = [9.5, 13.2, 19, 26.5, 37.5, 53];

const THEORETICAL_PRESETS = [
  // Fuller / Talbot n=0.50
  ...D_OPTIONS_IRAM.map(D => ({
    label: `Fuller n=0.50 D=${D}`,
    group: "Fuller / Talbot",
    formula: "FULLER_TALBOT",
    params: { dmax: D, n: 0.5 },
    icon: "fa-solid fa-chart-line",
    color: "info",
  })),
  // Andreasen & Andersen q=0.37
  ...D_OPTIONS_IRAM.map(D => ({
    label: `Andreasen q=0.37 D=${D}`,
    group: "Andreasen & Andersen",
    formula: "ANDREASEN",
    params: { dmax: D, dmin: 0.075, q: 0.37 },
    icon: "fa-solid fa-wave-square",
    color: "success",
  })),
  // Funk & Dinger q=0.37
  ...D_OPTIONS_IRAM.map(D => ({
    label: `Funk & Dinger q=0.37 D=${D}`,
    group: "Funk & Dinger",
    formula: "ANDREASEN_MOD",
    params: { dmax: D, dmin: 0.15, q: 0.37 },
    icon: "fa-solid fa-wave-square",
    color: "help",
  })),
  // Rosin-Rammler k=2.0
  ...D_OPTIONS_IRAM.map(D => ({
    label: `Rosin-Rammler k=2 D=${D}`,
    group: "Rosin-Rammler",
    formula: "ROSIN_RAMMLER",
    params: { dmax: D, x: D / 2, k: 2.0 },
    icon: "fa-solid fa-chart-area",
    color: "warning",
  })),
];

/* ══════════════════════════════════════════════════════
   Cálculo client-side de puntos teóricos (preview)
   ══════════════════════════════════════════════════════ */
function calcularPuntosTeorica(params, serieTamices, tamizVariant, tmnMm) {
  // Para TEORICA, usar la serie completa (backend usa TAMICES_IRAM completa)
  const serie = serieTamices === "ASTM" ? TAMICES_ASTM : ALL_TAMICES_IRAM;
  const formula = params?.formula;
  if (!formula) return [];
  const D = params.dmax;
  const rounding = params.rounding != null ? params.rounding : 1;
  const factor = Math.pow(10, rounding);

  // Cutoff: tamices con abertura > cutoffMm → isNA
  const cutoffMm = D || tmnMm || null;

  const fn = (d) => {
    if (d <= 0) return 0;

    if (formula === "fuller" || formula === "FULLER_TALBOT") {
      if (!D || D <= 0) return 0;
      if (d >= D) return 100;
      return 100 * Math.pow(d / D, params.n || 0.5);
    } else if (formula === "andreasen" || formula === "ANDREASEN") {
      if (!D || D <= 0) return 0;
      if (d >= D) return 100;
      const dmin = params.dmin || 0;
      if (dmin > 0 && d <= dmin) return 0;
      return 100 * Math.pow(d / D, params.q || 0.37);
    } else if (formula === "modified_aa" || formula === "ANDREASEN_MOD") {
      if (!D || D <= 0) return 0;
      if (d >= D) return 100;
      const dmin = params.dmin || 0.075;
      const q = params.q || 0.37;
      if (d <= dmin) return 0;
      const num = Math.pow(d, q) - Math.pow(dmin, q);
      const den = Math.pow(D, q) - Math.pow(dmin, q);
      return den <= 0 ? 0 : 100 * (num / den);
    } else if (formula === "ROSIN_RAMMLER") {
      const x = params.x || 12.5;
      const k = params.k || 2.0;
      if (D && d >= D) return 100;
      let P = 100 * (1 - Math.exp(-Math.pow(d / x, k)));
      if (D && D > 0) {
        const PD = 100 * (1 - Math.exp(-Math.pow(D / x, k)));
        if (PD > 0) P = P / PD * 100;
      }
      return P;
    }
    return 0;
  };

  return serie.map((t, i) => {
    const exceedsCutoff = cutoffMm != null && t.aberturaMm > cutoffMm;
    if (exceedsCutoff) {
      return {
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        targetPct: null,
        pasaPct: null,
        isNA: true,
        orden: i,
      };
    }
    let val = fn(t.aberturaMm);
    val = Math.max(0, Math.min(100, val));
    const rounded = Math.round(val * factor) / factor;
    return {
      tamiz: t.tamiz,
      aberturaMm: t.aberturaMm,
      targetPct: rounded,
      pasaPct: rounded,
      isNA: false,
      orden: i,
    };
  });
}

/* ══════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════ */
const CurvaForm = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const showToast = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const regeneratingRef = useRef(false);
  const creatingSetsRef = useRef(false);
  const initialLoadDone = useRef(false);

  // Eagerly fetch tamices catalog (populates module-level cache)
  useEffect(() => { fetchTamicesCatalog(); }, []);

  // Form state — todos controlados
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("TEORICA");
  const [specMode, setSpecMode] = useState("RANGO");
  const [serieTamices, setSerieTamices] = useState("IRAM");
  const [tamizVariant, setTamizVariant] = useState("ESTANDAR");
  const [uso, setUso] = useState(null);
  const [tmnMm, setTmnMm] = useState(null);
  const [origenDatos, setOrigenDatos] = useState("");
  const [normaRef, setNormaRef] = useState("");
  const [formula, setFormula] = useState("FULLER_TALBOT");
  const [dmax, setDmax] = useState(25);
  const [dmin, setDmin] = useState(0.075);
  const [expN, setExpN] = useState(0.5);
  const [expQ, setExpQ] = useState(0.37);
  const [rrX, setRrX] = useState(12.5);
  const [rrK, setRrK] = useState(2.0);
  const [rounding, setRounding] = useState(1);
  const [metadataText, setMetadataText] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [version, setVersion] = useState("1.0");
  const [puntos, setPuntos] = useState([]);
  const [idCurvaSet, setIdCurvaSet] = useState(null);

  // Debug panel
  const [showDebug, setShowDebug] = useState(false);

  // Paste dialog
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [pasteText, setPasteText] = useState("");

  // CurvaSet templates
  const [curvaSets, setCurvaSets] = useState([]);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);

  // Total IRAM template selectors
  const [totalTmn, setTotalTmn] = useState(null);
  const [totalCurva, setTotalCurva] = useState(null);
  const [createSetABC, setCreateSetABC] = useState(false);
  const [creatingSets, setCreatingSets] = useState(false);

  // Regenerar state
  const [regenerating, setRegenerating] = useState(false);

  /* ── Construir objeto parametros desde states escalares ── */
  const parametros = useMemo(() => {
    if (tipo !== "TEORICA") return null;
    const p = { formula, dmax, rounding };
    if (formula === "fuller" || formula === "FULLER_TALBOT") {
      p.n = expN;
    } else if (formula === "andreasen" || formula === "ANDREASEN") {
      p.dmin = dmin;
      p.q = expQ;
    } else if (formula === "modified_aa" || formula === "ANDREASEN_MOD") {
      p.dmin = dmin;
      p.q = expQ;
    } else if (formula === "ROSIN_RAMMLER") {
      p.x = rrX;
      p.k = rrK;
    }
    return p;
  }, [tipo, formula, dmax, dmin, expN, expQ, rrX, rrK, rounding]);

  /* Fingerprint string para deps de useMemo — evita problemas de referencia */
  const paramFingerprint = useMemo(
    () => JSON.stringify(parametros),
    [parametros]
  );

  /* ── Serie actual de tamices ───────────────────── */
  const serieActual = useMemo(
    () => (serieTamices === "ASTM" ? TAMICES_ASTM : getIRAMTemplate(tamizVariant)),
    [serieTamices, tamizVariant]
  );

  /* ── Load existing curva ──────────────────────── */
  const fetchCurva = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await axios.get(
        `${config.backendUrl}/api/curvas-granulometricas/${id}`,
        { headers: config.headers }
      );
      const c = res.data;

      setNombre(c.nombre || "");
      setTipo(c.tipo || "TEORICA");
      setSpecMode(c.specMode || "RANGO");
      setSerieTamices(c.serieTamices || "IRAM");
      setUso(c.uso || null);
      setTmnMm(c.tmnMm || null);
      setOrigenDatos(c.origenDatos || "");
      setNormaRef(c.normaRef || "");
      setIsDefault(c.isDefault === true);
      setIsActive(c.isActive !== false);
      setVersion(c.version || "1.0");
      setIdCurvaSet(c.idCurvaSet || null);

      // Inicializar parámetros desde el backend (campo por campo)
      const params = c.parametros || {};
      const f = params.formula || params.formulaKey || "FULLER_TALBOT";
      setFormula(f);
      setDmax(params.dmax ?? params.D ?? 25);
      setDmin(params.dmin ?? 0.075);
      setExpN(params.n ?? 0.5);
      setExpQ(params.q ?? 0.37);
      setRrX(params.x ?? 12.5);
      setRrK(params.k ?? 2.0);
      setRounding(params.rounding != null ? params.rounding : 1);

      setMetadataText(c.metadata ? JSON.stringify(c.metadata, null, 2) : "");
      // Restaurar variante IRAM desde metadata
      if (c.metadata?.tamizVariant) {
        setTamizVariant(c.metadata.tamizVariant);
      } else if (c.serieTamices === "IRAM" && c.puntos?.length > 0) {
        // Auto-detect variant from existing puntos
        const altOnly = [50, 25, 12.5];
        const stdOnly = [53, 26.5, 13.2];
        const hasAlt = c.puntos.some(p => altOnly.some(a => Math.abs(a - p.aberturaMm) < 0.01));
        const hasStd = c.puntos.some(p => stdOnly.some(a => Math.abs(a - p.aberturaMm) < 0.01));
        if (hasAlt && !hasStd) setTamizVariant("ALTERNATIVO");
      }

      // Backfill missing ASTM tamices (e.g. 4", 3½" added after curve was saved)
      let pts = c.puntos || [];
      if (c.serieTamices === "ASTM" && c.tipo !== "TEORICA") {
        pts = ensureASTMGrid(pts);
      }
      setPuntos(pts);

      initialLoadDone.current = true;
    } catch (err) {
      console.error("Error al cargar curva:", err);
      showToast("error", "Error al cargar la curva");
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCurva();
  }, [fetchCurva]);

  /* ── Fetch CurvaSets (plantillas) ─────────────── */
  useEffect(() => {
    const fetchSets = async () => {
      try {
        const res = await axios.get(`${config.backendUrl}/api/curva-sets`, {
          headers: config.headers,
        });
        setCurvaSets(res.data || []);
      } catch {
        /* silently ignore */
      }
    };
    fetchSets();
  }, []);

  /* ── Initialize grid when tipo/serie changes ──── */
  const initializeGrid = useCallback(
    (newSerie, tamizFilter, overrideVariant) => {
      const variant = overrideVariant !== undefined ? overrideVariant : tamizVariant;
      const template = newSerie === "ASTM" ? TAMICES_ASTM : getIRAMTemplate(variant);
      const existing = puntos || [];
      // If tamizFilter provided, only include those tamices
      const filtered = tamizFilter
        ? template.filter((t) => tamizFilter.includes(t.tamiz))
        : template;
      const merged = filtered.map((t, i) => {
        const match = existing.find(
          (e) => Math.abs(e.aberturaMm - t.aberturaMm) < 0.01
        );
        return {
          tamiz: t.tamiz,
          aberturaMm: t.aberturaMm,
          pasaPct: match?.pasaPct ?? null,
          limInfPct: match?.limInfPct ?? null,
          limSupPct: match?.limSupPct ?? null,
          targetPct: match?.targetPct ?? null,
          isNA: match?.isNA ?? false,
          orden: i,
        };
      });
      setPuntos(merged);
    },
    [puntos, tamizVariant]
  );

  const handleSerieChange = (val) => {
    if (!val || val === serieTamices) return;
    setSerieTamices(val);
    if (tipo !== "TEORICA") {
      const newSerieArr = val === "ASTM" ? TAMICES_ASTM : getIRAMTemplate(tamizVariant);
      const filter = getTamizFilterForUso(uso, newSerieArr);
      initializeGrid(val, filter);
    }
  };

  const handleVariantChange = (val) => {
    if (!val || val === tamizVariant) return;
    if (serieTamices !== "IRAM") return;

    const oldVariant = tamizVariant;
    setTamizVariant(val);

    if (tipo !== "TEORICA") {
      // Remap: transferir datos de tamices equivalentes
      const remapTable = val === "ALTERNATIVO" ? VARIANT_REMAP.STD_TO_ALT : VARIANT_REMAP.ALT_TO_STD;
      const newTemplate = getIRAMTemplate(val);
      const filter = getTamizFilterForUso(uso, newTemplate);
      const filtered = filter ? newTemplate.filter(t => filter.includes(t.tamiz)) : newTemplate;

      const remapped = filtered.map((t, i) => {
        // 1) Buscar coincidencia exacta por abertura
        let source = puntos.find(p => Math.abs(p.aberturaMm - t.aberturaMm) < 0.01);
        // 2) Si no hay exacta, buscar en el remap inverso (la fila reemplazada)
        if (!source) {
          const inverseRemap = oldVariant === "ESTANDAR" ? VARIANT_REMAP.STD_TO_ALT : VARIANT_REMAP.ALT_TO_STD;
          // Buscar qué abertura vieja mapeaba a esta nueva
          for (const [from, to] of Object.entries(remapTable)) {
            if (Math.abs(to - t.aberturaMm) < 0.01) {
              source = puntos.find(p => Math.abs(p.aberturaMm - parseFloat(from)) < 0.01);
              break;
            }
          }
        }
        return {
          tamiz: t.tamiz,
          aberturaMm: t.aberturaMm,
          pasaPct: source?.pasaPct ?? null,
          limInfPct: source?.limInfPct ?? null,
          limSupPct: source?.limSupPct ?? null,
          targetPct: source?.targetPct ?? null,
          isNA: source?.isNA ?? false,
          orden: i,
        };
      });
      setPuntos(remapped);
    }
  };

  const handleTipoChange = (val) => {
    if (!val) return;
    setTipo(val);
    if (val === "TEORICA") {
      setSpecMode("OBJETIVO");
    }
    if (val !== "TEORICA" && (!puntos || puntos.length === 0)) {
      const filter = getTamizFilterForUso(uso, serieActual);
      initializeGrid(serieTamices, filter);
    }
  };

  /* ── Cambio de Uso (material) con confirmación ── */
  const handleUsoChange = (newUso) => {
    if (newUso === uso) return;
    if (tipo !== "TEORICA") {
      const hasData = puntos.some(
        (p) => p.pasaPct != null || p.limInfPct != null || p.limSupPct != null || p.targetPct != null
      );
      if (hasData && !window.confirm(
        "Cambiar el uso reinicializará la grilla de tamices.\nLos datos de tamices que no apliquen se perderán. ¿Continuar?"
      )) {
        return;
      }
      setUso(newUso);
      const filter = getTamizFilterForUso(newUso, serieActual);
      initializeGrid(serieTamices, filter);
    } else {
      setUso(newUso);
    }
  };

  /* ── Cambio de fórmula ────────────────────────── */
  const handleFormulaChange = (newFormula) => {
    if (!newFormula) return;
    setFormula(newFormula);
    const defaults = FORMULA_DEFAULTS[newFormula] || {};
    setDmax(defaults.dmax ?? dmax);
    if (newFormula === "fuller" || newFormula === "FULLER_TALBOT") {
      setExpN(defaults.n ?? 0.5);
    } else if (newFormula === "andreasen" || newFormula === "ANDREASEN") {
      setDmin(defaults.dmin ?? 0.075);
      setExpQ(defaults.q ?? 0.37);
    } else if (newFormula === "modified_aa" || newFormula === "ANDREASEN_MOD") {
      setDmin(defaults.dmin ?? 0.075);
      setExpQ(defaults.q ?? 0.37);
    } else if (newFormula === "ROSIN_RAMMLER") {
      setRrX(defaults.x ?? (defaults.dmax || dmax) / 2);
      setRrK(defaults.k ?? 2.0);
    }
  };

  /* ── Aplicar preset teórico ────────────────────── */
  const applyPreset = (preset) => {
    setTipo("TEORICA");
    setSpecMode("OBJETIVO");
    setFormula(preset.formula);
    setDmax(preset.params.dmax);
    if (preset.params.n != null) setExpN(preset.params.n);
    if (preset.params.q != null) setExpQ(preset.params.q);
    if (preset.params.dmin != null) setDmin(preset.params.dmin);
    if (preset.params.x != null) setRrX(preset.params.x);
    if (preset.params.k != null) setRrK(preset.params.k);
    if (!nombre.trim()) {
      setNombre(preset.label);
    }
    showToast("info", `Preset "${preset.label}" aplicado`);
  };

  /* ── Regenerar curva teórica (persiste en DB) ──── */
  const handleRegenerar = async () => {
    if (!isEdit || !id) return;
    if (regeneratingRef.current) return;
    regeneratingRef.current = true;
    setRegenerating(true);
    try {
      // Primero guardar los params actuales
      await axios.put(
        `${config.backendUrl}/api/curvas-granulometricas/${id}`,
        { parametros, serieTamices, tipo: "TEORICA", specMode: "OBJETIVO", nombre },
        { headers: config.headers }
      );
      // Luego regenerar
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/${id}/regenerar`,
        {},
        { headers: config.headers }
      );
      // Actualizar puntos locales desde la respuesta
      if (res.data?.puntos) {
        setPuntos(res.data.puntos);
      }
      showToast("success", "Curva regenerada");
    } catch (err) {
      console.error("Error al regenerar:", err);
      showToast("error", err.response?.data?.error || err.response?.data?.message || "Error al regenerar");
    } finally {
      regeneratingRef.current = false;
      setRegenerating(false);
    }
  };

  /* ── Grid editing ──────────────────────────────── */
  const handlePuntoChange = (index, field, value) => {
    const updated = [...puntos];
    if (field === "isNA" && value === true) {
      // When marking N/A, clear numeric values
      updated[index] = {
        ...updated[index],
        isNA: true,
        limInfPct: null,
        limSupPct: null,
        targetPct: null,
        pasaPct: null,
      };
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setPuntos(updated);
  };

  /* ── Paste inteligente ─────────────────────────── */
  const processPasteText = useCallback(
    (text) => {
      if (!text || typeof text !== "string") return 0;

      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 1) return 0;

      const parsed = [];
      let hasAberturaCol = false;
      const warnings = [];

      /* Helper: detect if a raw cell text is a N/A marker */
      const isNAMarker = (s) => {
        if (!s) return false;
        const t = s.trim();
        if (t === "" || t === "—" || t === "-" || t === "–") return true;
        const u = t.toUpperCase();
        return u === "N/A" || u === "N.A" || u === "NA" || u === "N/A." || u === "---";
      };

      for (const line of lines) {
        const rawParts = line.split(/\t|;/).map((s) => s.trim());
        if (rawParts.length === 0) continue;

        const firstVal = rawParts[0];
        const firstNum = parseFloat(firstVal.replace(",", "."));

        // Keep raw strings for N/A detection before converting to numbers
        const remainingRaw = rawParts.slice(1);
        const remaining = remainingRaw
          .map((p) => parseFloat(p.replace(",", ".")))
          .filter((n) => !isNaN(n));

        // Detect if any value column is a N/A marker
        const hasNAInCols = remainingRaw.some((r) => isNAMarker(r));
        // Are ALL value columns N/A markers (or empty)?
        const allColsNA = remainingRaw.length > 0 && remainingRaw.every((r) => isNAMarker(r) || r === "");

        let abertura = null;

        if (!isNaN(firstNum) && (remaining.length > 0 || hasNAInCols)) {
          let abCandidate = firstNum;
          // µm notation: "600 µm" parses as 600 — convert to mm
          const firstLower = firstVal.toLowerCase().trim();
          if (/[µμu]m/.test(firstLower) && abCandidate >= 1) {
            abCandidate = abCandidate / 1000;
          }
          const parsePool = serieTamices === "IRAM" ? ALL_TAMICES_IRAM : TAMICES_ASTM;
          const isKnownAb = parsePool.some(
            (t) => Math.abs(t.aberturaMm - abCandidate) < 0.01
          );
          if (isKnownAb) {
            abertura = abCandidate;
            hasAberturaCol = true;
          } else if (!hasNAInCols) {
            remaining.unshift(firstNum);
          }
        } else if (isNaN(firstNum) && (remaining.length > 0 || hasNAInCols)) {
          const lookupKey = firstVal.toLowerCase().trim();
          if (TAMIZ_TO_ABERTURA[lookupKey] !== undefined) {
            abertura = TAMIZ_TO_ABERTURA[lookupKey];
            hasAberturaCol = true;
          } else if (isNAMarker(firstVal)) {
            // Entire line is N/A marker
            parsed.push({ abertura: null, isNA: true });
            continue;
          }
        } else if (!isNaN(firstNum) && remaining.length === 0 && !hasNAInCols) {
          remaining.push(firstNum);
        }

        // If all value columns are N/A, mark row as N/A regardless of specMode
        if (allColsNA && remainingRaw.length > 0) {
          parsed.push({ abertura, isNA: true });
          continue;
        }

        // If we have some N/A columns in a RANGO row (e.g. one of min/max is "—"),
        // and the other is numeric, treat as N/A for the whole row
        if (hasNAInCols && tipo === "BANDA" && specMode === "RANGO" && remainingRaw.length >= 2) {
          parsed.push({ abertura, isNA: true });
          continue;
        }

        if (remaining.length === 0) {
          // No numeric values but we have abertura — check if line itself is N/A
          if (isNAMarker(line)) {
            parsed.push({ abertura, isNA: true });
          }
          continue;
        }

        const row = { abertura };
        if (specMode === "OBJETIVO") {
          // OBJETIVO: single value → targetPct (works for BANDA and TABULADA)
          let val = remaining[remaining.length - 1];
          if (isNaN(val)) continue;
          val = Math.max(0, Math.min(100, val));
          row.targetPct = Math.round(val * 100) / 100;
        } else if (tipo === "BANDA" && specMode === "MAX_ONLY") {
          // MAX_ONLY: take last value → limSupPct (if 3 cols, discard min)
          if (remaining.length >= 2) {
            warnings.push(`Fila ${parsed.length + 1}: modo Solo Máximo, se usó columna máx y se descartó mín (${remaining[0]})`);
          }
          let val = remaining[remaining.length - 1];
          if (isNaN(val)) continue;
          val = Math.max(0, Math.min(100, val));
          row.limSupPct = Math.round(val * 100) / 100;
        } else if (tipo === "BANDA" && specMode === "MIN_ONLY") {
          // MIN_ONLY: single value → limInfPct
          let val = remaining[remaining.length - 1];
          if (isNaN(val)) continue;
          val = Math.max(0, Math.min(100, val));
          row.limInfPct = Math.round(val * 100) / 100;
        } else if (tipo === "BANDA" && remaining.length >= 2) {
          let v1 = remaining[0];
          let v2 = remaining[1];
          // Clamp 0..100
          v1 = Math.max(0, Math.min(100, v1));
          v2 = Math.max(0, Math.min(100, v2));
          // Auto-swap if inverted
          if (v1 > v2) {
            warnings.push(`Fila ${parsed.length + 1}: lím. inf (${remaining[0]}) > lím. sup (${remaining[1]}), se intercambiaron`);
            [v1, v2] = [v2, v1];
          }
          row.limInfPct = Math.round(v1 * 100) / 100;
          row.limSupPct = Math.round(v2 * 100) / 100;
        } else if (tipo === "BANDA" && remaining.length === 1) {
          continue;
        } else {
          let val = remaining[remaining.length - 1];
          val = Math.max(0, Math.min(100, val));
          row.pasaPct = Math.round(val * 100) / 100;
        }

        // Check for N/A text in original line (fallback for single-column or headerless lines)
        const lineUpper = line.toUpperCase();
        if (!row.limInfPct && !row.limSupPct && !row.targetPct && !row.pasaPct) {
          if (lineUpper.includes("N/A") || lineUpper.includes("N.A") || lineUpper === "—" || lineUpper === "-") {
            row.isNA = true;
          }
        }

        parsed.push(row);
      }

      if (parsed.length === 0) return 0;

      /* Auto-detect IRAM variant from pasted aberturas */
      let variantSwitched = false;
      if (serieTamices === "IRAM" && hasAberturaCol) {
        const altOnly = [50, 25, 12.5];
        const stdOnly = [53, 26.5, 13.2];
        const hasAlt = parsed.some(r => r.abertura && altOnly.some(a => Math.abs(a - r.abertura) < 0.01));
        const hasStd = parsed.some(r => r.abertura && stdOnly.some(a => Math.abs(a - r.abertura) < 0.01));
        if (hasAlt && hasStd) {
          warnings.push("Los datos contienen tamices de ambas series IRAM (Estándar y Alternativos)");
        } else if (hasAlt && !hasStd && tamizVariant !== "ALTERNATIVO") {
          setTamizVariant("ALTERNATIVO");
          variantSwitched = "ALTERNATIVO";
        } else if (hasStd && !hasAlt && tamizVariant !== "ESTANDAR") {
          setTamizVariant("ESTANDAR");
          variantSwitched = "ESTANDAR";
        }
      }

      /* If variant auto-switched, rebuild grid with remap before merge */
      let updated;
      if (variantSwitched) {
        const remapTable = variantSwitched === "ALTERNATIVO"
          ? VARIANT_REMAP.STD_TO_ALT : VARIANT_REMAP.ALT_TO_STD;
        const newTpl = getIRAMTemplate(variantSwitched);
        const filter = getTamizFilterForUso(uso, newTpl);
        const filtered = filter ? newTpl.filter(t => filter.includes(t.tamiz)) : newTpl;
        updated = filtered.map((t, i) => {
          // Look for exact match first, then remap from old variant
          let source = puntos.find(p => Math.abs(p.aberturaMm - t.aberturaMm) < 0.01);
          if (!source) {
            for (const [from, to] of Object.entries(remapTable)) {
              if (Math.abs(to - t.aberturaMm) < 0.01) {
                source = puntos.find(p => Math.abs(p.aberturaMm - parseFloat(from)) < 0.01);
                break;
              }
            }
          }
          return {
            tamiz: t.tamiz, aberturaMm: t.aberturaMm,
            pasaPct: source?.pasaPct ?? null, limInfPct: source?.limInfPct ?? null,
            limSupPct: source?.limSupPct ?? null, targetPct: source?.targetPct ?? null,
            isNA: source?.isNA ?? false, orden: i,
          };
        });
      } else {
        updated = [...puntos];
      }

      if (hasAberturaCol) {
        for (const row of parsed) {
          if (row.abertura === null) continue;
          const idx = updated.findIndex(
            (p) => Math.abs(p.aberturaMm - row.abertura) < 0.01
          );
          if (idx < 0) continue;
          if (row.isNA) {
            updated[idx] = { ...updated[idx], isNA: true, limInfPct: null, limSupPct: null, targetPct: null, pasaPct: null };
          } else if (specMode === "OBJETIVO" && row.targetPct !== undefined) {
            updated[idx] = { ...updated[idx], targetPct: row.targetPct, isNA: false };
          } else if (specMode === "MAX_ONLY" && row.limSupPct !== undefined) {
            updated[idx] = { ...updated[idx], limSupPct: row.limSupPct, isNA: false };
          } else if (specMode === "MIN_ONLY" && row.limInfPct !== undefined) {
            updated[idx] = { ...updated[idx], limInfPct: row.limInfPct, isNA: false };
          } else if (tipo === "BANDA") {
            updated[idx] = {
              ...updated[idx],
              limInfPct: row.limInfPct ?? updated[idx].limInfPct,
              limSupPct: row.limSupPct ?? updated[idx].limSupPct,
              isNA: false,
            };
          } else {
            updated[idx] = { ...updated[idx], pasaPct: row.pasaPct };
          }
        }
      } else {
        for (let i = 0; i < Math.min(parsed.length, updated.length); i++) {
          if (parsed[i].isNA) {
            updated[i] = { ...updated[i], isNA: true, limInfPct: null, limSupPct: null, targetPct: null, pasaPct: null };
          } else if (specMode === "OBJETIVO" && parsed[i].targetPct !== undefined) {
            updated[i] = { ...updated[i], targetPct: parsed[i].targetPct, isNA: false };
          } else if (specMode === "MAX_ONLY" && parsed[i].limSupPct !== undefined) {
            updated[i] = { ...updated[i], limSupPct: parsed[i].limSupPct, isNA: false };
          } else if (specMode === "MIN_ONLY" && parsed[i].limInfPct !== undefined) {
            updated[i] = { ...updated[i], limInfPct: parsed[i].limInfPct, isNA: false };
          } else if (tipo === "BANDA") {
            updated[i] = {
              ...updated[i],
              limInfPct: parsed[i].limInfPct ?? updated[i].limInfPct,
              limSupPct: parsed[i].limSupPct ?? updated[i].limSupPct,
              isNA: false,
            };
          } else {
            updated[i] = { ...updated[i], pasaPct: parsed[i].pasaPct };
          }
        }
      }

      setPuntos(updated);

      if (warnings.length > 0) {
        console.warn("Paste warnings:", warnings);
      }

      return parsed.length;
    },
    [puntos, tipo, specMode, serieTamices, tamizVariant, uso]
  );

  const handlePasteEvent = useCallback(
    (e) => {
      const text = e?.clipboardData?.getData("text");
      if (!text) return;
      const count = processPasteText(text);
      if (count > 0) {
        e.preventDefault();
        showToast("success", `${count} filas importadas`);
      }
    },
    [processPasteText, showToast]
  );

  const handlePasteDialog = () => {
    const count = processPasteText(pasteText);
    if (count > 0) {
      showToast("success", `${count} filas importadas`);
      setShowPasteDialog(false);
      setPasteText("");
    } else {
      showToast("warn", "No se pudieron interpretar los datos pegados");
    }
  };

  const handlePasteButton = () => {
    if (navigator.clipboard?.readText) {
      navigator.clipboard
        .readText()
        .then((text) => {
          const count = processPasteText(text);
          if (count > 0) {
            showToast("success", `${count} filas importadas`);
          } else {
            setShowPasteDialog(true);
          }
        })
        .catch(() => {
          setShowPasteDialog(true);
        });
    } else {
      setShowPasteDialog(true);
    }
  };

  /* ── Importar desde CurvaSet template ──────────── */
  const importFromSet = (set) => {
    if (!set) return;
    const curvasCandidatas = set.curvas || [];
    const curvaTemplate = curvasCandidatas[0];

    setTipo(curvaTemplate?.tipo || "BANDA");
    setSerieTamices(set.serieTamices || "IRAM");
    setNormaRef(set.normaRef || "");
    setIdCurvaSet(set.idCurvaSet);

    // Populate new fields from set
    if (set.materialUso) {
      setUso(set.materialUso);
    }
    if (set.tmnMm) {
      setTmnMm(set.tmnMm);
    }
    if (set.normaRef) {
      setOrigenDatos(set.normaRef);
    }

    if (curvaTemplate?.puntos && curvaTemplate.puntos.length > 0) {
      setPuntos(
        curvaTemplate.puntos.map((p, i) => ({
          tamiz: p.tamiz,
          aberturaMm: p.aberturaMm,
          pasaPct: p.pasaPct ?? null,
          limInfPct: p.limInfPct ?? null,
          limSupPct: p.limSupPct ?? null,
          targetPct: p.targetPct ?? null,
          isNA: p.isNA ?? false,
          orden: i,
        }))
      );
    } else {
      initializeGrid(set.serieTamices || "IRAM");
    }

    if (!nombre.trim()) {
      setNombre(set.nombre);
    }

    setShowTemplateDialog(false);
    showToast("info", `Plantilla "${set.nombre}" aplicada`);
  };

  /* ── Importar desde plantilla IRAM 1627 ────────── */
  const importFromIRAMTemplate = (tpl) => {
    if (!tpl) return;
    const isASTM = tpl.serieTamices === "ASTM";
    setTipo(tpl.tipo || "BANDA");
    setSpecMode(tpl.specMode || "RANGO");
    setSerieTamices(isASTM ? "ASTM" : "IRAM");
    setNormaRef(tpl.normaRef || (isASTM ? "ASTM C33/C33M" : "IRAM 1627"));
    setUso(tpl.uso || null);
    setOrigenDatos(tpl.referenciaTabla || tpl.normaRef || (isASTM ? "ASTM C33/C33M" : "IRAM 1627"));
    if (tpl.tmnMm) setTmnMm(tpl.tmnMm);

    // Initialize grid with the relevant tamices
    const template = isASTM ? TAMICES_ASTM : ALL_TAMICES_IRAM;
    const tamizNames = tpl.tamices || [];
    const filtered = tamizNames
      .map((name) => template.find((t) => t.tamiz === name))
      .filter(Boolean);
    const puntosInit = filtered.map((t, i) => {
      // Pre-set isNA for sieves outside the declared range
      let na = false;
      if (tpl.naRange) {
        na = t.aberturaMm > tpl.naRange.abMax + 0.01 || t.aberturaMm < tpl.naRange.abMin - 0.01;
      }
      return {
        tamiz: t.tamiz,
        aberturaMm: t.aberturaMm,
        pasaPct: null,
        limInfPct: null,
        limSupPct: null,
        targetPct: null,
        isNA: na,
        orden: i,
      };
    });
    setPuntos(puntosInit);

    if (!nombre.trim()) {
      setNombre(tpl.label);
    }

    setShowTemplateDialog(false);
    showToast("info", `Plantilla "${tpl.label}" aplicada`);
  };

  /* ── Estado datos automático ────────────────── */
  const estadoDatosComputed = useMemo(() => {
    if (tipo === "TEORICA") return "COMPLETO";
    const nonNA = puntos.filter((p) => !p.isNA);
    let cnt;
    if (specMode === "OBJETIVO") {
      cnt = nonNA.filter((p) => p.targetPct != null).length;
    } else if (specMode === "MAX_ONLY") {
      cnt = nonNA.filter((p) => p.limSupPct != null).length;
    } else if (specMode === "MIN_ONLY") {
      cnt = nonNA.filter((p) => p.limInfPct != null).length;
    } else if (tipo === "TABULADA") {
      cnt = nonNA.filter((p) => p.pasaPct != null).length;
    } else {
      // RANGO: ambos min Y max
      cnt = nonNA.filter((p) => p.limInfPct != null && p.limSupPct != null).length;
    }
    return cnt >= 2 ? "COMPLETO" : "PENDIENTE";
  }, [puntos, tipo, specMode]);

  /* ── Conteo de puntos con datos ────────────────── */
  const puntosConLimites = useMemo(() => {
    const nonNA = puntos.filter((p) => !p.isNA);
    if (specMode === "OBJETIVO") {
      return nonNA.filter((p) => p.targetPct !== null && p.targetPct !== undefined).length;
    }
    if (specMode === "MAX_ONLY") {
      return nonNA.filter((p) => p.limSupPct !== null && p.limSupPct !== undefined).length;
    }
    if (specMode === "MIN_ONLY") {
      return nonNA.filter((p) => p.limInfPct !== null && p.limInfPct !== undefined).length;
    }
    if (tipo === "TABULADA") {
      return nonNA.filter((p) => p.pasaPct !== null && p.pasaPct !== undefined).length;
    }
    // RANGO
    return nonNA.filter(
      (p) => (p.limInfPct !== null && p.limInfPct !== undefined) ||
             (p.limSupPct !== null && p.limSupPct !== undefined)
    ).length;
  }, [puntos, tipo, specMode]);

  /* ── Computed points for preview (CLAVE) ───────── */
  const puntosPreview = useMemo(() => {
    if (tipo === "TEORICA") {
      return calcularPuntosTeorica(parametros, serieTamices, tamizVariant, tmnMm);
    }
    // Filter out N/A points for preview
    const nonNA = puntos.filter((p) => !p.isNA);
    if (specMode === "OBJETIVO") {
      return nonNA.filter((p) => p.targetPct !== null && p.targetPct !== undefined);
    }
    if (specMode === "MAX_ONLY") {
      return nonNA.filter((p) => p.limSupPct !== null && p.limSupPct !== undefined);
    }
    if (specMode === "MIN_ONLY") {
      return nonNA.filter((p) => p.limInfPct !== null && p.limInfPct !== undefined);
    }
    if (tipo === "BANDA") {
      return nonNA.filter((p) =>
        (p.limInfPct !== null && p.limInfPct !== undefined) ||
        (p.limSupPct !== null && p.limSupPct !== undefined)
      );
    }
    return nonNA.filter((p) => p.pasaPct !== null && p.pasaPct !== undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, specMode, paramFingerprint, serieTamices, puntos, tmnMm]);

  /* ── Debug info ────────────────────────────────── */
  const debugInfo = useMemo(() => {
    const pp = puntosPreview || [];
    const lastIdx = pp.length - 1;
    const fmtPt = (pt) => {
      if (!pt) return "—";
      if (tipo === "BANDA") return `${pt.aberturaMm} mm → [${pt.limInfPct}, ${pt.limSupPct}]`;
      return `${pt.aberturaMm} mm → ${pt.pasaPct}%`;
    };
    return {
      tipo,
      serieTamices,
      formula: tipo === "TEORICA" ? formula : "N/A",
      parametros: tipo === "TEORICA" ? parametros : null,
      cantidadPuntos: pp.length,
      primerPunto: fmtPt(pp[0]),
      ultimoPunto: fmtPt(pp[lastIdx]),
      idCurvaSet,
    };
  }, [tipo, serieTamices, formula, parametros, puntosPreview, idCurvaSet]);

  /* ── Save ──────────────────────────────────────── */
  const handleSave = async () => {
    if (savingRef.current) return;
    if (!nombre.trim()) {
      showToast("warn", "El nombre es obligatorio");
      return;
    }

    let metadata = null;
    if (metadataText.trim()) {
      try {
        metadata = JSON.parse(metadataText);
      } catch {
        showToast("warn", "El JSON de metadata no es válido");
        return;
      }
    }

    // Persistir variante IRAM en metadata
    if (serieTamices === "IRAM") {
      metadata = metadata || {};
      metadata.tamizVariant = tamizVariant;
    }

    const payload = {
      nombre,
      tipo,
      specMode: tipo !== "TEORICA" ? specMode : "OBJETIVO",
      serieTamices,
      uso: uso || null,
      tmnMm: tmnMm || null,
      origenDatos: origenDatos || null,
      estadoDatos: estadoDatosComputed,
      normaRef: normaRef || null,
      parametros: tipo === "TEORICA" ? parametros : null,
      metadata,
      isDefault,
      isActive,
      version,
      puntos: tipo !== "TEORICA" ? puntos : [],
      idCurvaSet: idCurvaSet || null,
    };

    savingRef.current = true;
    setSaving(true);
    try {
      if (isEdit) {
        await axios.put(
          `${config.backendUrl}/api/curvas-granulometricas/${id}`,
          payload,
          { headers: config.headers }
        );
        showToast("success", "Curva actualizada");
      } else {
        await axios.post(
          `${config.backendUrl}/api/curvas-granulometricas`,
          payload,
          { headers: config.headers }
        );
        showToast("success", "Curva creada");
      }
      window.history.back();
    } catch (err) {
      console.error("Error al guardar curva:", err);
      showToast("error", err.response?.data?.error || "Error al guardar la curva");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /* ── Loading ────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className="flex justify-content-center align-items-center"
        style={{ height: "60vh" }}
      >
        <i className="pi pi-spin pi-spinner" style={{ fontSize: "2rem" }} />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════ */
  return (
    <div className="p-3">
      <DetailPageHeader
        icon="fa-solid fa-bezier-curve"
        title={isEdit ? "Editar curva" : "Nueva curva"}
        subtitle="Curva granulométrica — teórica, banda o tabulada"
        actions={(
          <>
            {!isEdit && (
              <Button
                icon="fa-solid fa-file-import"
                label="Crear desde plantilla"
                severity="help"
                text
                size="small"
                onClick={() => setShowTemplateDialog(true)}
              />
            )}
            <Button
              icon="fa-solid fa-bug"
              label="Debug"
              severity="secondary"
              text
              size="small"
              onClick={() => setShowDebug(!showDebug)}
              tooltip="Mostrar/ocultar panel de diagnóstico"
              tooltipOptions={{ position: "left" }}
            />
          </>
        )}
      />

      {/* Debug panel */}
      {showDebug && (
        <div
          className="surface-100 border-round p-3 mb-3 text-xs"
          style={{ fontFamily: "monospace" }}
        >
          <div className="flex align-items-center gap-2 mb-2">
            <i className="fa-solid fa-bug text-orange-500" />
            <span className="font-bold">Debug — Estado actual</span>
          </div>
          <div className="grid">
            <div className="col-6 md:col-3">
              <b>tipo:</b>{" "}
              <Tag value={debugInfo.tipo} severity="info" className="text-xs ml-1" />
            </div>
            <div className="col-6 md:col-3">
              <b>serieTamices:</b>{" "}
              <Tag
                value={debugInfo.serieTamices}
                severity={debugInfo.serieTamices === "IRAM" ? "success" : "warning"}
                className="text-xs ml-1"
              />
            </div>
            <div className="col-6 md:col-3">
              <b>formula:</b>{" "}
              <span className="text-primary">{debugInfo.formula}</span>
            </div>
            <div className="col-6 md:col-3">
              <b>puntos:</b>{" "}
              <span className="text-primary">{debugInfo.cantidadPuntos}</span>
            </div>
          </div>
          {tipo === "TEORICA" && (
            <div className="mt-1">
              <b>params:</b>{" "}
              <span className="text-500">{JSON.stringify(debugInfo.parametros)}</span>
            </div>
          )}
          <div className="mt-1">
            <b>primer punto:</b>{" "}
            <span className="text-500">{debugInfo.primerPunto}</span>
            {" | "}
            <b>último:</b>{" "}
            <span className="text-500">{debugInfo.ultimoPunto}</span>
          </div>
          {debugInfo.idCurvaSet && (
            <div className="mt-1">
              <b>idCurvaSet:</b>{" "}
              <span className="text-500">{debugInfo.idCurvaSet}</span>
            </div>
          )}
        </div>
      )}

      <div className="grid">
        {/* ── Left: form ──────────────────────────── */}
        <div className="col-12 md:col-6">
          <div
            className="surface-border border-1 border-round p-3"
            style={{ maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}
          >
            {/* Nombre */}
            <div className="mb-3">
              <label className="font-bold text-sm block mb-1">
                Nombre <span className="text-red-500">*</span>
              </label>
              <InputText
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full"
                placeholder="Nombre de la curva"
              />
            </div>

            {/* Tipo */}
            <div className="mb-3">
              <label className="font-bold text-sm block mb-1">Tipo de curva</label>
              <Dropdown
                value={tipo}
                options={TIPO_OPTIONS}
                onChange={(e) => handleTipoChange(e.value)}
                className="w-full"
              />
            </div>

            {/* Serie de tamices — controlado con allowEmpty=false */}
            <div className="mb-3">
              <label className="font-bold text-sm block mb-1">Serie de tamices</label>
              <SelectButton
                value={serieTamices}
                options={SERIE_OPTIONS}
                onChange={(e) => {
                  if (e.value !== null && e.value !== undefined) {
                    handleSerieChange(e.value);
                  }
                }}
                allowEmpty={false}
              />
              <small className="text-500 block mt-1">
                Actualmente: <b>{serieTamices}</b>
              </small>
            </div>

            {/* Variante IRAM (Tabla 9) — solo visible cuando serie = IRAM */}
            {serieTamices === "IRAM" && (
              <div className="mb-3">
                <label className="font-bold text-sm block mb-1">
                  Variante de tamices <span className="text-500 font-normal">(Tabla 9 IRAM 1627:1997)</span>
                </label>
                <SelectButton
                  value={tamizVariant}
                  options={TAMIZ_VARIANT_OPTIONS}
                  onChange={(e) => {
                    if (e.value !== null && e.value !== undefined) {
                      handleVariantChange(e.value);
                    }
                  }}
                  allowEmpty={false}
                />
                <small className="text-500 block mt-1">
                  {tamizVariant === "ESTANDAR"
                    ? "Estándar: 53 — 26,5 — 13,2 mm"
                    : "Alternativos: 50 — 25 — 12,5 mm"}
                </small>
              </div>
            )}

            {/* Norma */}
            <div className="mb-3">
              <label className="font-bold text-sm block mb-1">Norma / Referencia</label>
              <InputText
                value={normaRef}
                onChange={(e) => setNormaRef(e.target.value)}
                className="w-full"
                placeholder="Ej: IRAM 1627"
              />
            </div>

            {/* Uso, TMN, Origen, Estado — visible para BANDA y TABULADA */}
            {tipo !== "TEORICA" && (
              <div className="grid mb-3">
                <div className="col-12 md:col-6">
                  <label className="font-bold text-sm block mb-1">Uso (material)</label>
                  <Dropdown
                    value={uso}
                    options={USO_OPTIONS}
                    onChange={(e) => handleUsoChange(e.value)}
                    placeholder="Seleccionar uso"
                    showClear
                    className="w-full"
                  />
                </div>
                <div className="col-12 md:col-6">
                  <label className="font-bold text-sm block mb-1">TMN (mm)</label>
                  <InputNumber
                    value={tmnMm}
                    onValueChange={(e) => setTmnMm(e.value)}
                    mode="decimal"
                    minFractionDigits={0}
                    maxFractionDigits={2}
                    min={0.01}
                    className="w-full"
                    placeholder="Ej: 25"
                  />
                </div>
                <div className="col-12 md:col-6">
                  <label className="font-bold text-sm block mb-1">Origen datos</label>
                  <InputText
                    value={origenDatos}
                    onChange={(e) => setOrigenDatos(e.target.value)}
                    className="w-full"
                    placeholder="Ej: IRAM 1627 Tabla 2"
                  />
                </div>
                <div className="col-12 md:col-6">
                  <label className="font-bold text-sm block mb-1">Estado datos</label>
                  <div className="flex align-items-center" style={{ height: "2.5rem" }}>
                    <Tag
                      value={estadoDatosComputed}
                      severity={estadoDatosComputed === "COMPLETO" ? "success" : "warning"}
                      icon={estadoDatosComputed === "COMPLETO" ? "fa-solid fa-check" : "fa-solid fa-clock"}
                    />
                    <span className="ml-2 text-xs text-400">(automático)</span>
                  </div>
                </div>
              </div>
            )}

            <Divider className="my-2" />

            {/* ── TEORICA: parámetros de fórmula ──── */}
            {tipo === "TEORICA" && (
              <div className="mb-3">
                <h4 className="mt-0 mb-2 flex align-items-center gap-2">
                  <i className="fa-solid fa-square-root-variable text-primary" />
                  Parámetros de fórmula
                </h4>

                <div className="mb-2">
                  <label className="font-bold text-sm block mb-1">Fórmula</label>
                  <Dropdown
                    value={formula}
                    options={FORMULA_OPTIONS_VISIBLE}
                    onChange={(e) => handleFormulaChange(e.value)}
                    placeholder="Seleccionar fórmula"
                    className="w-full"
                  />
                </div>

                <div className="grid">
                  <div className="col-12 md:col-6">
                    <label className="font-bold text-sm block mb-1">D máx (mm)</label>
                    <InputNumber
                      value={dmax}
                      onValueChange={(e) => setDmax(e.value)}
                      mode="decimal"
                      minFractionDigits={0}
                      maxFractionDigits={2}
                      min={0.1}
                      className="w-full"
                    />
                  </div>
                  {(formula === "ANDREASEN" || formula === "andreasen" || formula === "modified_aa" || formula === "ANDREASEN_MOD") && (
                    <div className="col-12 md:col-6">
                      <label className="font-bold text-sm block mb-1">D mín (mm)</label>
                      <InputNumber
                        value={dmin}
                        onValueChange={(e) => setDmin(e.value)}
                        mode="decimal"
                        minFractionDigits={0}
                        maxFractionDigits={4}
                        min={0.001}
                        className="w-full"
                      />
                    </div>
                  )}
                  {(formula === "fuller" || formula === "FULLER_TALBOT") && (
                    <div className="col-12 md:col-6">
                      <label className="font-bold text-sm block mb-1">n (exponente)</label>
                      <InputNumber
                        value={expN}
                        onValueChange={(e) => setExpN(e.value)}
                        mode="decimal"
                        minFractionDigits={0}
                        maxFractionDigits={3}
                        min={0.01}
                        max={1}
                        className="w-full"
                      />
                    </div>
                  )}
                  {(formula === "ANDREASEN" || formula === "andreasen" || formula === "modified_aa" || formula === "ANDREASEN_MOD") && (
                    <div className="col-12 md:col-6">
                      <label className="font-bold text-sm block mb-1">
                        q (distribution modulus)
                      </label>
                      <InputNumber
                        value={expQ}
                        onValueChange={(e) => setExpQ(e.value)}
                        mode="decimal"
                        minFractionDigits={0}
                        maxFractionDigits={3}
                        min={0.01}
                        max={1}
                        className="w-full"
                      />
                    </div>
                  )}
                  {formula === "ROSIN_RAMMLER" && (
                    <>
                      <div className="col-12 md:col-6">
                        <label className="font-bold text-sm block mb-1">x (escala, mm)</label>
                        <InputNumber
                          value={rrX}
                          onValueChange={(e) => setRrX(e.value)}
                          mode="decimal"
                          minFractionDigits={0}
                          maxFractionDigits={2}
                          min={0.01}
                          className="w-full"
                        />
                      </div>
                      <div className="col-12 md:col-6">
                        <label className="font-bold text-sm block mb-1">k (forma)</label>
                        <InputNumber
                          value={rrK}
                          onValueChange={(e) => setRrK(e.value)}
                          mode="decimal"
                          minFractionDigits={0}
                          maxFractionDigits={3}
                          min={0.1}
                          max={10}
                          className="w-full"
                        />
                      </div>
                    </>
                  )}
                  <div className="col-12 md:col-6">
                    <label className="font-bold text-sm block mb-1">Redondeo (decimales)</label>
                    <InputNumber
                      value={rounding}
                      onValueChange={(e) => setRounding(e.value)}
                      min={0}
                      max={4}
                      showButtons
                      className="w-full"
                    />
                  </div>
                </div>

                {/* Formula display */}
                <div className="surface-100 border-round p-2 mt-2">
                  <span className="text-xs text-500 font-italic">
                    {(formula === "fuller" || formula === "FULLER_TALBOT") && `P = 100 × (d / ${dmax})^${expN}`}
                    {(formula === "andreasen" || formula === "ANDREASEN") && `P = 100 × (d / ${dmax})^${expQ}  [Dmin=${dmin} corte]`}
                    {(formula === "modified_aa" || formula === "ANDREASEN_MOD") &&
                      `P = 100 × (d^${expQ} − ${dmin}^${expQ}) / (${dmax}^${expQ} − ${dmin}^${expQ})`}
                    {formula === "ROSIN_RAMMLER" &&
                      `P = 100 × (1 − exp(−(d/${rrX})^${rrK}))`}
                  </span>
                </div>

                {/* Regenerar button (solo en edición) */}
                {isEdit && (
                  <div className="mt-2">
                    <Button
                      icon="fa-solid fa-arrows-rotate"
                      label="Regenerar puntos"
                      severity="warning"
                      size="small"
                      loading={regenerating}
                      disabled={regenerating}
                      onClick={handleRegenerar}
                      tooltip="Guarda parámetros y recalcula todos los puntos en la base de datos"
                      tooltipOptions={{ position: "top" }}
                    />
                  </div>
                )}

                {/* ── Presets ──────────────────────── */}
                <Divider className="my-2" />
                <h5 className="mt-0 mb-2 flex align-items-center gap-2">
                  <i className="fa-solid fa-wand-magic-sparkles text-purple-500" />
                  Presets (configuraciones rápidas)
                </h5>
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {["Fuller / Talbot", "Andreasen & Andersen", "Funk & Dinger", "Rosin-Rammler"].map((groupName) => {
                    const items = THEORETICAL_PRESETS.filter((p) => p.group === groupName);
                    if (items.length === 0) return null;
                    return (
                      <div key={groupName} className="mb-2">
                        <span className="text-xs font-bold text-500 block mb-1">{groupName}</span>
                        <div className="flex flex-wrap gap-1">
                          {items.map((preset, idx) => (
                            <Button
                              key={idx}
                              label={`D=${preset.params.dmax}`}
                              icon={preset.icon}
                              size="small"
                              severity={preset.color}
                              text
                              className="text-xs p-1"
                              tooltip={preset.label}
                              tooltipOptions={{ position: "top" }}
                              onClick={() => applyPreset(preset)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── TABULADA / BANDA: grilla editable ── */}
            {tipo !== "TEORICA" && (
              <div className="mb-3" onPaste={handlePasteEvent}>
                <div className="flex align-items-center justify-content-between mb-2">
                  <h4 className="m-0 flex align-items-center gap-2">
                    <i
                      className={`fa-solid ${
                        tipo === "BANDA" ? "fa-arrows-up-down" : "fa-table"
                      } text-primary`}
                    />
                    {specMode === "OBJETIVO"
                      ? "Objetivo por tamiz"
                      : specMode === "MAX_ONLY"
                      ? "Máximos por tamiz"
                      : specMode === "MIN_ONLY"
                      ? "Mínimos por tamiz"
                      : tipo === "BANDA"
                      ? "Límites por tamiz"
                      : "% Pasa por tamiz"}
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      icon="fa-solid fa-paste"
                      label="Pegar"
                      size="small"
                      severity="help"
                      text
                      tooltip="Pegar datos desde clipboard (Ctrl+V sobre la tabla o click aquí)"
                      tooltipOptions={{ position: "top" }}
                      onClick={handlePasteButton}
                    />
                    <Button
                      icon="fa-solid fa-keyboard"
                      label="Pegar texto"
                      size="small"
                      severity="info"
                      text
                      tooltip="Abrir diálogo para pegar texto manualmente"
                      tooltipOptions={{ position: "top" }}
                      onClick={() => setShowPasteDialog(true)}
                    />
                    <Button
                      icon="fa-solid fa-rotate-left"
                      label="Reset"
                      size="small"
                      severity="secondary"
                      text
                      onClick={() => {
                        const filter = getTamizFilterForUso(uso, serieActual);
                        initializeGrid(serieTamices, filter);
                      }}
                    />
                  </div>
                </div>

                {/* Spec mode selector — for BANDA and TABULADA */}
                {(tipo === "BANDA" || tipo === "TABULADA") && (
                  <div className="mb-2">
                    <label className="font-bold text-xs block mb-1">Modo de especificación</label>
                    <Dropdown
                      value={specMode}
                      options={SPEC_MODE_OPTIONS}
                      onChange={(e) => setSpecMode(e.value)}
                      className="w-full"
                    />
                  </div>
                )}

                <div className="flex align-items-center gap-3 mb-2 flex-wrap">
                  <span className="text-xs text-500">
                    Filas: <b>{puntos.length}</b>
                  </span>
                  <span className="text-xs font-bold" style={{ color: puntosConLimites >= 2 ? 'var(--green-500)' : 'var(--orange-500)' }}>
                    Válidas: {puntosConLimites}
                  </span>
                  {puntos.some((p) => p.isNA) && (
                    <span className="text-xs text-orange-500">
                      N/A: {puntos.filter((p) => p.isNA).length}
                    </span>
                  )}
                  {puntosConLimites < 2 && (
                    <span className="text-xs text-orange-500">
                      (mínimo 2 para graficar)
                    </span>
                  )}
                </div>

                <DataTable responsiveLayout="scroll"
                  value={puntos}
                  size="small"
                  stripedRows
                  scrollable
                  scrollHeight="320px"
                  dataKey="orden"
                  rowClassName={(row) => (row.isNA ? "opacity-40" : "")}
                >
                  <Column header="Tamiz" field="tamiz" style={{ width: "90px" }} />
                  <Column
                    header="Abertura"
                    field="aberturaMm"
                    style={{ width: "80px" }}
                    body={(row) => (
                      <span className="text-xs text-500">{row.aberturaMm}</span>
                    )}
                  />

                  {/* TABULADA: % Pasa or Objetivo column depending on specMode */}
                  {tipo === "TABULADA" && specMode !== "OBJETIVO" && (
                    <Column
                      header="% Pasa"
                      style={{ width: "120px" }}
                      body={(row, { rowIndex }) => (
                        <InputNumber
                          value={row.pasaPct}
                          onValueChange={(e) =>
                            handlePuntoChange(rowIndex, "pasaPct", e.value)
                          }
                          mode="decimal"
                          minFractionDigits={0}
                          maxFractionDigits={2}
                          min={0}
                          max={100}
                          suffix=" %"
                          className="w-full"
                          inputClassName="text-right text-sm p-1"
                          inputStyle={{ width: "80px" }}
                          placeholder="—"
                          disabled={row.isNA}
                        />
                      )}
                    />
                  )}
                  {tipo === "TABULADA" && specMode === "OBJETIVO" && (
                    <Column
                      header="Objetivo %"
                      style={{ width: "120px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        return (
                          <InputNumber
                            value={row.targetPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "targetPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName="text-right text-sm p-1"
                            inputStyle={{ width: "80px" }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}

                  {/* BANDA + RANGO: Mín + Máx */}
                  {tipo === "BANDA" && specMode === "RANGO" && (
                    <Column
                      header="Mín. %"
                      style={{ width: "100px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        const invalid = row.limInfPct != null && row.limSupPct != null && row.limInfPct > row.limSupPct;
                        return (
                          <InputNumber
                            value={row.limInfPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "limInfPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName={`text-right text-sm p-1${invalid ? ' p-invalid' : ''}`}
                            inputStyle={{ width: "70px", ...(invalid ? { borderColor: 'var(--red-500)' } : {}) }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}
                  {tipo === "BANDA" && specMode === "RANGO" && (
                    <Column
                      header="Máx. %"
                      style={{ width: "100px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        const invalid = row.limInfPct != null && row.limSupPct != null && row.limInfPct > row.limSupPct;
                        return (
                          <InputNumber
                            value={row.limSupPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "limSupPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName={`text-right text-sm p-1${invalid ? ' p-invalid' : ''}`}
                            inputStyle={{ width: "70px", ...(invalid ? { borderColor: 'var(--red-500)' } : {}) }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}

                  {/* BANDA + MAX_ONLY: single Máximo column */}
                  {tipo === "BANDA" && specMode === "MAX_ONLY" && (
                    <Column
                      header="Máximo %"
                      style={{ width: "120px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        return (
                          <InputNumber
                            value={row.limSupPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "limSupPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName="text-right text-sm p-1"
                            inputStyle={{ width: "80px" }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}

                  {/* BANDA + MIN_ONLY: single Mínimo column */}
                  {tipo === "BANDA" && specMode === "MIN_ONLY" && (
                    <Column
                      header="Mínimo %"
                      style={{ width: "120px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        return (
                          <InputNumber
                            value={row.limInfPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "limInfPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName="text-right text-sm p-1"
                            inputStyle={{ width: "80px" }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}

                  {/* BANDA + OBJETIVO: targetPct column */}
                  {tipo === "BANDA" && specMode === "OBJETIVO" && (
                    <Column
                      header="Objetivo %"
                      style={{ width: "120px" }}
                      body={(row, { rowIndex }) => {
                        if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                        return (
                          <InputNumber
                            value={row.targetPct}
                            onValueChange={(e) =>
                              handlePuntoChange(rowIndex, "targetPct", e.value)
                            }
                            mode="decimal"
                            minFractionDigits={0}
                            maxFractionDigits={2}
                            min={0}
                            max={100}
                            suffix=" %"
                            className="w-full"
                            inputClassName="text-right text-sm p-1"
                            inputStyle={{ width: "80px" }}
                            placeholder="—"
                          />
                        );
                      }}
                    />
                  )}

                  {/* N/A toggle column — for BANDA and TABULADA with specMode */}
                  {(tipo === "BANDA" || (tipo === "TABULADA" && specMode === "OBJETIVO")) && (
                    <Column
                      header="N/A"
                      style={{ width: "50px" }}
                      body={(row, { rowIndex }) => (
                        <Checkbox
                          checked={row.isNA === true}
                          onChange={(e) => handlePuntoChange(rowIndex, "isNA", e.checked)}
                          tooltip="Marcar como N/A (sin dato)"
                          tooltipOptions={{ position: "left" }}
                        />
                      )}
                    />
                  )}
                </DataTable>
              </div>
            )}

            {/* ── TEORICA: grilla solo-lectura ── */}
            {tipo === "TEORICA" && puntosPreview.length > 0 && (
              <div className="mb-3">
                <div className="flex align-items-center justify-content-between mb-2">
                  <h4 className="m-0 flex align-items-center gap-2">
                    <i className="fa-solid fa-table text-primary" />
                    Objetivo por tamiz (calculado)
                  </h4>
                </div>

                <div className="flex align-items-center gap-3 mb-2 flex-wrap">
                  <span className="text-xs text-500">
                    Filas: <b>{puntosPreview.length}</b>
                  </span>
                  <span className="text-xs font-bold" style={{ color: puntosPreview.filter((p) => !p.isNA).length >= 2 ? 'var(--green-500)' : 'var(--orange-500)' }}>
                    Válidas: {puntosPreview.filter((p) => !p.isNA).length}
                  </span>
                  {puntosPreview.some((p) => p.isNA) && (
                    <span className="text-xs text-orange-500">
                      N/A: {puntosPreview.filter((p) => p.isNA).length}
                    </span>
                  )}
                </div>

                <DataTable responsiveLayout="scroll"
                  value={puntosPreview}
                  size="small"
                  stripedRows
                  scrollable
                  scrollHeight="320px"
                  dataKey="orden"
                  rowClassName={(row) => (row.isNA ? "opacity-40" : "")}
                >
                  <Column header="Tamiz" field="tamiz" style={{ width: "90px" }} />
                  <Column
                    header="Abertura"
                    field="aberturaMm"
                    style={{ width: "80px" }}
                    body={(row) => (
                      <span className="text-xs text-500">{row.aberturaMm}</span>
                    )}
                  />
                  <Column
                    header="Objetivo %"
                    style={{ width: "120px" }}
                    body={(row) => {
                      if (row.isNA) return <span className="text-xs text-400">N/A</span>;
                      return (
                        <span className="text-sm font-semibold">
                          {row.targetPct != null ? `${row.targetPct} %` : "—"}
                        </span>
                      );
                    }}
                  />
                  <Column
                    header="N/A"
                    style={{ width: "50px" }}
                    body={(row) => (
                      <Checkbox
                        checked={row.isNA === true}
                        disabled
                        tooltip="Determinado por tamaño máximo"
                        tooltipOptions={{ position: "left" }}
                      />
                    )}
                  />
                </DataTable>
              </div>
            )}

            <Divider className="my-2" />

            {/* Metadata, Default, Active */}
            <div className="grid mb-3">
              <div className="col-12 md:col-6">
                <label className="font-bold text-sm block mb-1">Versión</label>
                <InputText
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full"
                  placeholder="1.0"
                />
              </div>
              <div className="col-6 md:col-3 flex align-items-center gap-2 pt-4">
                <Checkbox
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.checked)}
                  tooltip="Curva de sistema (norma/teórica). Recomendación: no eliminar."
                  tooltipOptions={{ position: "top" }}
                />
                <span className="text-sm" title="Curva de sistema (norma/teórica). Recomendación: no eliminar.">Default</span>
              </div>
              <div className="col-6 md:col-3 flex align-items-center gap-2 pt-4">
                <Checkbox
                  checked={isActive}
                  onChange={(e) => setIsActive(e.checked)}
                  tooltip="Visible y usable en selectores. Desactivar la oculta sin perderla."
                  tooltipOptions={{ position: "top" }}
                />
                <span className="text-sm" title="Visible y usable en selectores. Desactivar la oculta sin perderla.">Activa</span>
              </div>
            </div>

            <div className="mb-3">
              <label className="font-bold text-sm block mb-1">Metadata (JSON)</label>
              <InputTextarea
                value={metadataText}
                onChange={(e) => setMetadataText(e.target.value)}
                rows={3}
                className="w-full text-sm"
                style={{ fontFamily: "monospace" }}
                placeholder='{"descripcion": "...", "tags": ["..."]}'
              />
            </div>

            {/* Save */}
            <div className="flex justify-content-end gap-2 pt-3 border-top-1 surface-border">
              <Button
                label="Cancelar"
                severity="secondary"
                text
                onClick={() => window.history.back()}
              />
              <Button
                label={isEdit ? "Actualizar" : "Crear"}
                icon="fa-solid fa-save"
                severity="success"
                loading={saving}
                disabled={saving}
                onClick={handleSave}
              />
            </div>
          </div>
        </div>

        {/* ── Right: chart preview ────────────────── */}
        <div className="col-12 md:col-6">
          <div className="surface-border border-1 border-round p-3">
            <div className="flex align-items-center gap-2 mb-2">
              <i className="fa-solid fa-chart-line text-primary" />
              <span className="font-bold text-sm">Preview del gráfico</span>
              <Tag
                value={tipo}
                severity={
                  tipo === "TEORICA"
                    ? "info"
                    : tipo === "BANDA"
                    ? "warning"
                    : "success"
                }
                className="text-xs"
              />
              <Tag
                value={serieTamices}
                severity={serieTamices === "IRAM" ? "success" : "warning"}
                className="text-xs"
              />
              {tipo === "TEORICA" && (
                <Tag value={formula} className="text-xs" />
              )}
              <span className="ml-auto text-xs text-500">
                {puntosPreview.length} puntos{tipo !== "TEORICA" && ` (${puntos.length} filas)`}
              </span>
            </div>
            <CurvaChart
              key={`${tipo}-${serieTamices}-${specMode}-${paramFingerprint}`}
              tipo={tipo}
              puntos={puntosPreview}
              nombre={nombre || "Sin nombre"}
              specMode={specMode}
            />
          </div>
        </div>
      </div>

      {/* ── Paste Dialog ──────────────────────────── */}
      <Dialog
        header="Pegar datos desde Excel/CSV"
        visible={showPasteDialog}
        onHide={() => setShowPasteDialog(false)}
        style={{ width: "90vw", maxWidth: "500px" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button
              label="Cancelar"
              severity="secondary"
              text
              onClick={() => setShowPasteDialog(false)}
            />
            <Button
              label="Importar"
              icon="fa-solid fa-file-import"
              severity="success"
              onClick={handlePasteDialog}
            />
          </div>
        }
      >
        <p className="text-sm text-500 mt-0">
          Pegá los datos copiados desde Excel. Formatos aceptados:
        </p>
        <ul className="text-xs text-500 mt-0 mb-3">
          {specMode === "MAX_ONLY" ? (
            <>
              <li><b>Con abertura:</b> <code>abertura(mm) [TAB] máx</code></li>
              <li><b>Con tamiz:</b> <code>tamiz [TAB] máx</code> (ej: 600 µm → 0.6 mm)</li>
              <li><b>Solo valores:</b> <code>máx</code> (se asigna por orden)</li>
              <li className="text-400">Si pegás 3 columnas (mín+máx), se toma solo el máximo.</li>
            </>
          ) : specMode === "MIN_ONLY" ? (
            <>
              <li><b>Con abertura:</b> <code>abertura(mm) [TAB] mín</code></li>
              <li><b>Con tamiz:</b> <code>tamiz [TAB] mín</code></li>
              <li><b>Solo valores:</b> <code>mín</code> (se asigna por orden)</li>
            </>
          ) : specMode === "OBJETIVO" ? (
            <>
              <li><b>Con abertura:</b> <code>abertura(mm) [TAB] objetivo</code></li>
              <li><b>Con tamiz:</b> <code>tamiz [TAB] objetivo</code></li>
              <li><b>Solo valores:</b> <code>objetivo</code> (se asigna por orden)</li>
            </>
          ) : tipo === "BANDA" ? (
            <>
              <li><b>Con abertura:</b> <code>abertura(mm) [TAB] limInf [TAB] limSup</code></li>
              <li><b>Con tamiz:</b> <code>tamiz [TAB] limInf [TAB] limSup</code></li>
              <li><b>Solo valores:</b> <code>limInf [TAB] limSup</code> (se asigna por orden)</li>
            </>
          ) : (
            <>
              <li><b>Con abertura:</b> <code>abertura(mm) [TAB] %pasa</code></li>
              <li><b>Con tamiz:</b> <code>tamiz [TAB] %pasa</code></li>
              <li><b>Solo valores:</b> <code>%pasa</code> (se asigna por orden)</li>
            </>
          )}
        </ul>
        <InputTextarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={10}
          className="w-full text-sm"
          style={{ fontFamily: "monospace" }}
          placeholder="Pegar datos aquí..."
          autoFocus
        />
      </Dialog>

      {/* ── Template (CurvaSet) Dialog ─────────────── */}
      <Dialog
        header="Crear desde plantilla"
        visible={showTemplateDialog}
        onHide={() => setShowTemplateDialog(false)}
        style={{ width: "90vw", maxWidth: "750px" }}
      >
        {/* IRAM 1627 Fino quick templates */}
        <div className="mb-4">
          <h5 className="mt-0 mb-2 flex align-items-center gap-2">
            <i className="fa-solid fa-bookmark text-primary" />
            Plantillas IRAM 1627 — Fino
          </h5>
          <p className="text-xs text-500 mt-0 mb-2">
            Estructuras predefinidas según IRAM 1627. Solo precarga tamices y modo, sin valores.
          </p>
          <div className="flex flex-column gap-1">
            {IRAM_1627_TEMPLATES.map((tpl, idx) => (
              <div key={idx} className="flex align-items-center justify-content-between surface-100 border-round p-2">
                <div className="flex align-items-center gap-2">
                  <Tag
                    value={tpl.uso}
                    severity={tpl.uso === "FINO" ? "info" : tpl.uso === "GRUESO" ? "warning" : "success"}
                    className="text-xs"
                  />
                  <Tag
                    value={tpl.specMode}
                    severity={tpl.specMode === "RANGO" ? "secondary" : tpl.specMode === "MAX_ONLY" ? "warning" : tpl.specMode === "OBJETIVO" ? "help" : "info"}
                    className="text-xs"
                  />
                  <span className="text-sm">{tpl.label}</span>
                  <span className="text-xs text-400">({tpl.tamices.length} tamices)</span>
                </div>
                <Button
                  icon="fa-solid fa-file-import"
                  label="Usar"
                  size="small"
                  text
                  onClick={() => importFromIRAMTemplate(tpl)}
                />
              </div>
            ))}
          </div>
        </div>

        <Divider />

        {/* IRAM 1627 Grueso — Tabla 2 — range selector */}
        <div className="mb-4">
          <h5 className="mt-0 mb-2 flex align-items-center gap-2">
            <i className="fa-solid fa-cubes text-orange-500" />
            Plantillas IRAM 1627:1997 — Grueso (Tabla 2)
          </h5>
          <p className="text-xs text-500 mt-0 mb-2">
            Seleccionar rango de tamaño del agregado grueso. Modo RANGO con soporte N/A.
          </p>
          <div className="flex flex-column gap-1">
            {IRAM_1627_GRUESO_RANGES.map((range, idx) => {
              const tpl = buildGruesoTemplate(range, tamizVariant);
              const serieLen = getIRAMTemplate(tamizVariant).length;
              return (
                <div key={idx} className="flex align-items-center justify-content-between surface-100 border-round p-2">
                  <div className="flex align-items-center gap-2">
                    <Tag value="GRUESO" severity="warning" className="text-xs" />
                    <Tag value="RANGO" severity="secondary" className="text-xs" />
                    <span className="text-sm font-semibold">{range.label} mm</span>
                    <span className="text-xs text-400">({serieLen} tamices)</span>
                  </div>
                  <Button
                    icon="fa-solid fa-file-import"
                    label="Usar"
                    size="small"
                    text
                    onClick={() => importFromIRAMTemplate(tpl)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <Divider />

        {/* IRAM 1627 — TOTAL (Tablas 3-8) — selectors TMN + Curva */}
        <div className="mb-4">
          <h5 className="mt-0 mb-2 flex align-items-center gap-2">
            <i className="fa-solid fa-bullseye text-green-600" />
            IRAM 1627 — Totales (Curvas A / B / C)
          </h5>
          <p className="text-xs text-500 mt-0 mb-2">
            Crear curva OBJETIVO para agregados totales. Seleccioná TMN y curva; se precargan los tamices sin valores.
          </p>
          <div className="flex align-items-end gap-3 mb-2 flex-wrap">
            <div>
              <label className="font-bold text-xs block mb-1">TMN (mm)</label>
              <Dropdown
                value={totalTmn}
                options={IRAM_1627_TOTAL_TMN.map((t) => ({ label: `${t.tmn} mm (${t.tabla})`, value: t.tmn }))}
                onChange={(e) => setTotalTmn(e.value)}
                placeholder="Seleccionar TMN"
                className="w-12rem"
              />
            </div>
            {!createSetABC && (
              <div>
                <label className="font-bold text-xs block mb-1">Curva</label>
                <SelectButton
                  value={totalCurva}
                  options={IRAM_1627_TOTAL_CURVAS.map((c) => ({ label: `Curva ${c}`, value: c }))}
                  onChange={(e) => { if (e.value) setTotalCurva(e.value); }}
                  allowEmpty={false}
                />
              </div>
            )}
            <div className="flex align-items-center gap-2 pb-1">
              <Checkbox
                checked={createSetABC}
                onChange={(e) => { setCreateSetABC(e.checked); if (e.checked) setTotalCurva(null); }}
              />
              <span className="text-sm font-bold">Crear set A/B/C</span>
            </div>
          </div>
          <div className="flex gap-2 mb-2">
            {!createSetABC && (
              <Button
                icon="fa-solid fa-file-import"
                label="Crear curva"
                size="small"
                severity="success"
                disabled={!totalTmn || !totalCurva}
                onClick={() => {
                  const info = IRAM_1627_TOTAL_TMN.find((t) => t.tmn === totalTmn);
                  const tpl = buildTotalTemplate(totalTmn, totalCurva, info?.tabla || "");
                  importFromIRAMTemplate(tpl);
                }}
              />
            )}
            {createSetABC && (
              <Button
                icon="fa-solid fa-layer-group"
                label="Crear set A/B/C"
                size="small"
                severity="success"
                loading={creatingSets}
                disabled={!totalTmn || creatingSets}
                onClick={async () => {
                  if (creatingSetsRef.current) return;
                  creatingSetsRef.current = true;
                  setCreatingSets(true);
                  try {
                    const res = await axios.post(
                      `${config.backendUrl}/api/curva-sets/iram1627/total`,
                      { tmnMm: totalTmn, createABC: true },
                      { headers: config.headers }
                    );
                    showToast("success", `Set creado con ${res.data.curvas?.length || 3} curvas`);
                    setShowTemplateDialog(false);
                    navigate(`/calidad/catalogos/curvas/set/${res.data.curvaSetId}`);
                  } catch (err) {
                    console.error("Error creating IRAM set:", err);
                    showToast("error", err.response?.data?.error || "Error al crear el set");
                  } finally {
                    creatingSetsRef.current = false;
                    setCreatingSets(false);
                  }
                }}
              />
            )}
          </div>
          {totalTmn && !createSetABC && totalCurva && (
            <div className="surface-100 border-round p-2 text-xs text-500">
              Se creará: <b>IRAM 1627:1997 — Total — TMN {totalTmn} — Curva {totalCurva}</b>
              {" · "}modo OBJETIVO · {TAMICES_TOTAL_IRAM.length} tamices · targetPct vacío
            </div>
          )}
          {totalTmn && createSetABC && (
            <div className="surface-100 border-round p-2 text-xs text-500">
              Se creará set: <b>IRAM 1627:1997 — Total — TMN {totalTmn}</b>
              {" · "}con 3 curvas (A, B, C) modo OBJETIVO · {TAMICES_TOTAL_IRAM.length} tamices c/u · targetPct vacío
            </div>
          )}
        </div>

        {/* ASTM C33 template sections removed — ASTM hidden from UI */}

        <Divider />

        {/* CurvaSet templates */}
        <h5 className="mt-0 mb-2 flex align-items-center gap-2">
          <i className="fa-solid fa-layer-group text-primary" />
          Sets / Paquetes existentes
        </h5>
        <p className="text-xs text-500 mt-0 mb-2">
          Importar estructura desde un set existente.
        </p>
        {curvaSets.length === 0 ? (
          <div className="text-center text-500 py-4">
            <i className="fa-solid fa-inbox text-3xl mb-2 block" />
            No hay sets disponibles
          </div>
        ) : (
          <DataTable responsiveLayout="scroll"
            value={curvaSets}
            size="small"
            stripedRows
            scrollable
            scrollHeight="250px"
            dataKey="idCurvaSet"
          >
            <Column field="nombre" header="Nombre" sortable />
            <Column
              field="materialUso"
              header="Material"
              style={{ width: "90px" }}
              body={(s) => (
                <Tag
                  value={s.materialUso || "—"}
                  severity={
                    s.materialUso === "FINO"
                      ? "info"
                      : s.materialUso === "GRUESO"
                      ? "warning"
                      : "success"
                  }
                  className="text-xs"
                />
              )}
            />
            <Column
              field="tmnMm"
              header="TMN"
              style={{ width: "70px" }}
              body={(s) => (
                <span className="text-sm">
                  {s.tmnMm ? `${s.tmnMm} mm` : "—"}
                </span>
              )}
            />
            <Column
              field="estado"
              header="Estado"
              style={{ width: "100px" }}
              body={(s) => (
                <Tag
                  value={s.estado}
                  severity={s.estado === "COMPLETO" ? "success" : "warning"}
                  className="text-xs"
                />
              )}
            />
            <Column
              header="Curvas"
              style={{ width: "70px" }}
              body={(s) => (
                <span className="text-sm">{(s.curvas || []).length}</span>
              )}
            />
            <Column
              header=""
              style={{ width: "80px" }}
              body={(s) => (
                <Button
                  icon="fa-solid fa-file-import"
                  label="Usar"
                  size="small"
                  text
                  onClick={() => importFromSet(s)}
                />
              )}
            />
          </DataTable>
        )}
      </Dialog>
    </div>
  );
};

export default CurvaForm;
