import React, { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { SelectButton } from "primereact/selectbutton";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Checkbox } from "primereact/checkbox";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import axios from "axios";
import { config } from "../../../config/config";
import GranulometriaChart from "./GranulometriaChart";
import CurvaChart from "../curvas/CurvaChart";
import { getTamicesCatalogSync, fetchTamicesCatalog } from "../../../services/tamicesCatalogService";
import { listHusosDnv, getHusoDnv } from "../../../services/husosDnvService";

/* ══════════════════════════════════════════════════════
   Tamices — consumidos del catálogo centralizado
   ══════════════════════════════════════════════════════ */
const _cat = getTamicesCatalogSync();
const TAMICES_IRAM_STD = _cat.IRAM.standard;       // 13 tamices estándar
const TAMICES_IRAM_ALL = _cat.IRAM.superset;        // 18 tamices (std + alt + 75mm + 75µm)
const TAMICES_ASTM = _cat.ASTM.superset;
// TBS_DNV: 13 tamices del Pliego DNV 2017 (incluye 31.5, 16, 6.3, 3.35 mm, 425 µm
// que no están en la serie IRAM estándar).
const TAMICES_TBS_DNV = _cat.TBS_DNV?.superset || [];
const MIN_TAMICES_REVISADO = _cat.helpers.minTamicesRevisado;

/**
 * FM sieves — serie estándar relación 2:1 basada en #100 (0.15 mm).
 * [150, 75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15]
 */
const FM_SIEVES_MM = [150, 75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15];

/**
 * Contexto de aplicación del ensayo. Determina contra qué normas se auto-evalúa.
 *   HORMIGON → IRAM 1627 / CIRSOC (comportamiento histórico)
 *   TBS      → Huso DNV al armar Dotación de Obra; no evalúa hormigón
 *   AMBOS    → Cumple ambos contextos; serie de tamices elegible
 */
const CONTEXTO_OPTIONS = [
  { label: "Hormigón", value: "HORMIGON" },
  { label: "TBS", value: "TBS" },
  { label: "Ambos", value: "AMBOS" },
];

const SERIE_IRAM_OPTION = { label: "IRAM", value: "IRAM" };
const SERIE_TBS_OPTION = { label: "TBS-DNV", value: "TBS_DNV" };

const TIPO_OPTIONS = [
  { label: "Fino", value: "FINO" },
  { label: "Grueso", value: "GRUESO" },
  { label: "Mezcla", value: "MEZCLA" },
];

const METODO_INFORME_OPTIONS = [
  { label: "% pasa", value: "PASA" },
  { label: "% retenido parcial", value: "RET_PARCIAL" },
  { label: "% retenido acumulado", value: "RET_ACUM" },
];

/* ══════════════════════════════════════════════════════
   Client-side calculation (mirrors backend)
   ══════════════════════════════════════════════════════ */

/**
 * Interpolación log-lineal — misma lógica que backend.
 */
function interpolarLogLinealLocal(medidosSorted, d) {
  if (!medidosSorted.length || d <= 0) return null;
  const logD = Math.log10(d);

  // Exact match
  for (const m of medidosSorted) {
    if (Math.abs(m.aberturaMm - d) / Math.max(d, 0.001) < 0.001) return m.pasaPct;
  }

  // Ascending for bracket search
  const asc = [...medidosSorted].reverse();
  if (d < asc[0].aberturaMm || d > asc[asc.length - 1].aberturaMm) return null;

  for (let i = 0; i < asc.length - 1; i++) {
    const lo = asc[i], hi = asc[i + 1];
    if (d >= lo.aberturaMm && d <= hi.aberturaMm) {
      if (lo.aberturaMm === hi.aberturaMm) return lo.pasaPct;
      const logLo = Math.log10(lo.aberturaMm);
      const logHi = Math.log10(hi.aberturaMm);
      const t = (logD - logLo) / (logHi - logLo);
      return Math.round(Math.max(0, Math.min(100, lo.pasaPct + t * (hi.pasaPct - lo.pasaPct))) * 100) / 100;
    }
  }
  return null;
}

/**
 * Resuelve pasaPct para una abertura dada usando:
 *   1) Valor exacto / interpolación
 *   2) Completado lógico por monotonicidad
 */
function resolverPasaPctLocal(medidosSorted, d) {
  if (!medidosSorted.length || d <= 0) return null;

  // 1) Exact + interpolation
  const interp = interpolarLogLinealLocal(medidosSorted, d);
  if (interp !== null) return interp;

  // 2) Logical completion: larger sieve with pasaPct=0 → this one = 0
  for (const m of medidosSorted) {
    if (m.aberturaMm > d && m.pasaPct <= 0.001) return 0;
  }

  // 3) Logical completion: smaller sieve with pasaPct=100 → this one = 100
  for (const m of medidosSorted) {
    if (m.aberturaMm < d && m.pasaPct >= 99.999) return 100;
  }

  // 4) Extrapolation below: smallest measured = 0 → below = 0
  const smallest = medidosSorted[medidosSorted.length - 1];
  if (d < smallest.aberturaMm && smallest.pasaPct <= 0.001) return 0;

  // 5) Extrapolation above: largest measured = 100 → above = 100
  const largest = medidosSorted[0];
  if (d > largest.aberturaMm && largest.pasaPct >= 99.999) return 100;

  return null;
}

function calcularLocal(tamices, tipoAgregado) {
  const datos = tamices
    .filter((t) => t.habilitado && t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "")
    .map((t) => ({ ...t, pasaPct: Number(t.pasaPct), aberturaMm: Number(t.aberturaMm) }))
    .sort((a, b) => b.aberturaMm - a.aberturaMm);

  if (datos.length < 2) return { mf: null, mfFaltantes: [], tmn: null, cantTamices: datos.length, monotonia: true, errores: [] };

  // Retenido acumulado
  const retAcum = [];
  let acum = 0;
  for (let i = 0; i < datos.length; i++) {
    const ret = i === 0 ? 100 - datos[i].pasaPct : datos[i - 1].pasaPct - datos[i].pasaPct;
    acum += Math.max(0, ret);
    retAcum.push({ aberturaMm: datos[i].aberturaMm, retAcumPct: Math.round(acum * 100) / 100 });
  }

  // Monotonicity
  const errores = [];
  let monotonia = true;
  for (let i = 1; i < datos.length; i++) {
    if (datos[i].pasaPct > datos[i - 1].pasaPct + 0.5) {
      monotonia = false;
      errores.push(`${datos[i].tamiz} (${datos[i].pasaPct}%) > ${datos[i - 1].tamiz} (${datos[i - 1].pasaPct}%)`);
    }
  }

  // Infer tipo
  let tipo = tipoAgregado;
  if (!tipo) {
    const t475 = datos.find((d) => Math.abs(d.aberturaMm - 4.75) < 0.01);
    tipo = t475 ? (t475.pasaPct >= 85 ? "FINO" : "GRUESO") : datos[datos.length - 1].aberturaMm <= 0.3 ? "FINO" : "GRUESO";
  }

  // MF — using FM_SIEVES_MM with logical completion
  const isGrueso = tipo === "GRUESO";
  let mf = null;
  const mfFaltantes = [];
  {
    let sum = 0, cnt = 0;
    for (const ab of FM_SIEVES_MM) {
      let pasaPct = resolverPasaPctLocal(datos, ab);
      // GRUESO: sieves ≤4.75 mm not present → assume 0% pasa (100% retained)
      if (pasaPct === null && isGrueso && ab <= 4.75) {
        pasaPct = 0;
      }
      if (pasaPct === null) {
        mfFaltantes.push(ab);
        continue;
      }
      cnt++;
      sum += (100 - pasaPct);
    }
    if (cnt >= FM_SIEVES_MM.length / 2) {
      mf = Math.round((sum / 100) * 100) / 100;
    }
  }

  // TMN
  let tmn = null;
  if (tipo === "GRUESO" || tipo === "MEZCLA") {
    for (let i = 0; i < datos.length; i++) {
      if (100 - datos[i].pasaPct > 10) {
        tmn = i > 0 ? datos[i - 1].aberturaMm : datos[i].aberturaMm;
        break;
      }
    }
    if (tmn === null) {
      for (const d of datos) {
        if (d.pasaPct < 95) { tmn = d.aberturaMm; break; }
      }
    }
  }

  // Range validations
  for (const d of datos) {
    if (d.pasaPct < 0 || d.pasaPct > 100) errores.push(`${d.tamiz}: % pasa fuera de rango`);
  }

  return { mf, mfFaltantes, mfCompleto: mfFaltantes.length === 0, tmn, cantTamices: datos.length, monotonia, errores, tipoInferido: tipo };
}

/* ══════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════ */
const GranulometriaEditor = ({
  formValues,
  onFormChange,
  saving,
  onSave,
  isRevisado,
  showEnsayoHeaderFields = false,
  embeddedInEnsayoForm = false,
  defaultTipoAgregado = null,
  showAjusteTeorico = false,
}) => {
  // DEV guardrail: warn if header fields are shown while embedded in an ensayo form
  if (process.env.NODE_ENV === "development" && showEnsayoHeaderFields && embeddedInEnsayoForm) {
    console.warn(
      "[GranulometriaEditor] showEnsayoHeaderFields={true} while embeddedInEnsayoForm={true}. " +
      "This will duplicate general ensayo fields (laboratorio/fecha). Set showEnsayoHeaderFields={false} when embedded."
    );
  }

  const contextoAplicacion = formValues.contextoAplicacion || "HORMIGON";
  const idHusoDnvReferencia = formValues.idHusoDnvReferencia ?? null;
  // Si contexto es TBS, la serie default es TBS_DNV. Para HORMIGON/AMBOS se
  // respeta lo que ya haya en formValues.serieTamices (default IRAM).
  const serie = formValues.serieTamices
    || (contextoAplicacion === "TBS" ? "TBS_DNV" : "IRAM");
  const tipoAgregado = formValues.tipoAgregado || defaultTipoAgregado || null;
  const metodoInforme = formValues.metodoInforme || "PASA";

  // Opciones de serie según contexto:
  //   HORMIGON → solo IRAM
  //   TBS      → solo TBS-DNV (bloqueado)
  //   AMBOS    → IRAM + TBS-DNV
  const serieOptions = useMemo(() => {
    if (contextoAplicacion === "TBS") return [SERIE_TBS_OPTION];
    if (contextoAplicacion === "AMBOS") return [SERIE_IRAM_OPTION, SERIE_TBS_OPTION];
    return [SERIE_IRAM_OPTION];
  }, [contextoAplicacion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tamices = useMemo(() => formValues.tamices || [], [formValues.tamices]);
  const [showAlternativos, setShowAlternativos] = useState(false);

  // ── Husos DNV (solo cuando contexto incluye TBS) ──────────
  const [husosDnv, setHusosDnv] = useState([]);
  const [loadingHusos, setLoadingHusos] = useState(false);
  const aplicaHuso = contextoAplicacion === "TBS" || contextoAplicacion === "AMBOS";
  useEffect(() => {
    if (!aplicaHuso) {
      setHusosDnv([]);
      return;
    }
    let cancelled = false;
    setLoadingHusos(true);
    listHusosDnv()
      .then((data) => { if (!cancelled) setHusosDnv(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setHusosDnv([]); })
      .finally(() => { if (!cancelled) setLoadingHusos(false); });
    return () => { cancelled = true; };
  }, [aplicaHuso]);
  const husoOptions = useMemo(() => husosDnv.map((h) => ({
    label: `${h.codigo}  ·  ${h.tipoTBS}${h.capa ? ` ${h.capa}` : ''}  ·  TMN ${h.tmnMm} mm`,
    value: h.idHusoDNV,
  })), [husosDnv]);

  // Detalle del huso seleccionado → Set de aberturas recomendadas (resaltadas en la tabla)
  const [husoDetalle, setHusoDetalle] = useState(null);
  useEffect(() => {
    if (!aplicaHuso || !idHusoDnvReferencia) {
      setHusoDetalle(null);
      return;
    }
    let cancelled = false;
    getHusoDnv(idHusoDnvReferencia)
      .then((data) => { if (!cancelled) setHusoDetalle(data || null); })
      .catch(() => { if (!cancelled) setHusoDetalle(null); });
    return () => { cancelled = true; };
  }, [aplicaHuso, idHusoDnvReferencia]);
  const aberturasRecomendadas = useMemo(() => {
    if (!husoDetalle?.puntos) return null;
    return new Set(husoDetalle.puntos.map((p) => Number(p.aberturaMm).toFixed(3)));
  }, [husoDetalle]);
  const esRecomendada = useCallback((aberturaMm) => {
    if (!aberturasRecomendadas) return false;
    return aberturasRecomendadas.has(Number(aberturaMm).toFixed(3));
  }, [aberturasRecomendadas]);

  // Whether tipo is locked (determined by the aggregate, not user-selectable)
  const tipoLocked = !!(embeddedInEnsayoForm && defaultTipoAgregado);

  /**
   * Build the filtered tamiz template based on serie, tipo, and showAlternativos.
   * Filtering by tipoAgregado uses aperture thresholds:
   *   GRUESO => aberturaMm >= 4.75
   *   FINO   => aberturaMm <= 4.75  (includes 4.75 as boundary)
   *   MEZCLA/null => no filter
   */
  const getFilteredTemplate = useCallback((serieSel, tipoSel, inclAlt) => {
    if (serieSel === "ASTM") return TAMICES_ASTM;
    if (serieSel === "TBS_DNV") {
      // Serie DNV: todos los 13 tamices del Pliego 2017. No se filtra por tipo
      // (el usuario habilita/deshabilita por fila según huso/TMN del tramo).
      return TAMICES_TBS_DNV;
    }
    // FINO: siempre serie estándar (no existen alternativos para finos) y excluye 75µm
    if (tipoSel === "FINO") {
      return TAMICES_IRAM_STD.filter(t => t.aberturaMm <= 9.5 && t.aberturaMm > 0.075);
    }
    // Base grid: standard (13) or full superset (18) when alternos shown
    const base = inclAlt ? TAMICES_IRAM_ALL : TAMICES_IRAM_STD;
    // Filter by tipo using aperture threshold
    if (!tipoSel || tipoSel === "MEZCLA" || tipoSel === "TOTAL") return base;
    if (tipoSel === "GRUESO") return base.filter(t => t.aberturaMm >= 2.36);
    return base;
  }, []);

  /* ── Initialize tamices when serie/tipo/alt changes ── */
  const initializeTamices = useCallback(
    (newSerie, newTipo, inclAlt) => {
      const template = getFilteredTemplate(newSerie, newTipo, inclAlt);
      const existing = formValues.tamices || [];

      // Merge: keep values for matching aberturas
      const merged = template.map((t) => {
        const match = existing.find((e) => Math.abs(e.aberturaMm - t.aberturaMm) < 0.01);
        return {
          tamiz: t.tamiz,
          aberturaMm: t.aberturaMm,
          pasaPct: match ? match.pasaPct : null,
          retenidoParcialPct: match ? (match.retenidoParcialPct ?? null) : null,
          retenidoAcumPct: match ? (match.retenidoAcumPct ?? null) : null,
          habilitado: match ? match.habilitado !== false : true,
        };
      });
      onFormChange({
        ...formValues,
        serieTamices: newSerie,
        tipoAgregado: newTipo ?? formValues.tipoAgregado,
        tamices: merged,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formValues, getFilteredTemplate]
  );

  // On first mount, if tamices empty, initialize from serie
  const initialized = useRef(false);
  useEffect(() => {
    fetchTamicesCatalog(); // eagerly populate module-level cache
    if (!initialized.current) {
      initialized.current = true;
      // Only init if no tamices loaded (new ensayo); skip on edit (tamices already populated)
      if (!tamices.length) initializeTamices(serie, tipoAgregado, showAlternativos);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync tipoAgregado into formValues when locked from parent and value differs
  useEffect(() => {
    if (tipoLocked && defaultTipoAgregado && formValues.tipoAgregado !== defaultTipoAgregado) {
      onFormChange({ ...formValues, tipoAgregado: defaultTipoAgregado });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoLocked, defaultTipoAgregado]);

  /* ── Local calculations ──────────────────────────── */
  const calc = useMemo(() => calcularLocal(tamices, tipoAgregado), [tamices, tipoAgregado]);

  const tamicesConDatos = useMemo(
    () => tamices.filter((t) => t.habilitado && (
      (t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "") ||
      (t.retenidoParcialPct !== null && t.retenidoParcialPct !== undefined && t.retenidoParcialPct !== "") ||
      (t.retenidoAcumPct !== null && t.retenidoAcumPct !== undefined && t.retenidoAcumPct !== "")
    )),
    [tamices]
  );

  /* ── Handlers ────────────────────────────────────── */
  const handleSerieChange = (val) => {
    if (val && val !== serie) initializeTamices(val, tipoAgregado, showAlternativos);
  };

  const handleContextoChange = (val) => {
    if (!val || val === contextoAplicacion) return;
    // Al cambiar contexto, forzamos serie coherente:
    //   HORMIGON → IRAM
    //   TBS      → TBS_DNV
    //   AMBOS    → mantener serie actual si está en las opciones; si no, IRAM
    let nuevaSerie = serie;
    if (val === "HORMIGON") nuevaSerie = "IRAM";
    else if (val === "TBS") nuevaSerie = "TBS_DNV";
    else if (val === "AMBOS" && serie !== "IRAM" && serie !== "TBS_DNV") nuevaSerie = "IRAM";

    onFormChange({
      ...formValues,
      contextoAplicacion: val,
      // Si la serie cambia, reinicializamos tamices; el initializeTamices lo
      // propaga por onFormChange. Para evitar dos llamadas seguidas, lo hacemos
      // en un solo update si la serie no cambió.
    });
    if (nuevaSerie !== serie) {
      // Reinicializamos con la serie nueva en el próximo tick.
      setTimeout(() => initializeTamices(nuevaSerie, tipoAgregado, showAlternativos), 0);
    }
  };

  const handleTipoChange = (val) => {
    onFormChange({ ...formValues, tipoAgregado: val });
    // Re-filter grid when tipo changes
    if (serie === "IRAM") {
      initializeTamices(serie, val, showAlternativos);
    }
  };

  const handleShowAlternativosChange = (checked) => {
    setShowAlternativos(checked);
    if (serie === "IRAM") {
      initializeTamices(serie, tipoAgregado, checked);
    }
  };

  /** Generic handler: sets the primary input field and auto-derives the other two */
  const handleInputChange = (index, field, value) => {
    const updated = [...tamices];
    updated[index] = { ...updated[index], [field]: value };

    // ── Helper: monotonía por borde (0 ó 100) ─────────────
    // Propaga el valor de borde a los tamices habilitados cuando:
    //   - la celda destino está vacía, o
    //   - la celda destino tiene un valor que viola la monotonía física.
    // Física: con serie ordenada por abertura, un tamiz menor no puede
    // dejar pasar más que uno mayor.
    //   pasaPct=0 en abertura A → todo tamiz con ab < A debe pasar 0
    //   pasaPct=100 en abertura A → todo tamiz con ab > A debe pasar 100
    const propagarMonotonia = (arr, refIndex, pasaPctValue) => {
      if (pasaPctValue !== 0 && pasaPctValue !== 100) return arr;
      const refAb = arr[refIndex]?.aberturaMm || 0;
      return arr.map((row, i) => {
        if (i === refIndex || !row.habilitado) return row;
        const ab = row.aberturaMm || 0;
        const actual = row.pasaPct;
        const vacia = actual === null || actual === undefined || actual === "";
        if (pasaPctValue === 0 && ab < refAb) {
          const violaMonotonia = !vacia && Number(actual) > 0;
          if (vacia || violaMonotonia) {
            return { ...row, pasaPct: 0, retenidoAcumPct: 100 };
          }
        }
        if (pasaPctValue === 100 && ab > refAb) {
          const violaMonotonia = !vacia && Number(actual) < 100;
          if (vacia || violaMonotonia) {
            return { ...row, pasaPct: 100, retenidoAcumPct: 0 };
          }
        }
        return row;
      });
    };

    // Auto-compute derived columns based on metodoInforme
    if (field === "pasaPct") {
      if (value === 0 || value === 100) {
        const propagated = propagarMonotonia(updated, index, value);
        for (let i = 0; i < updated.length; i++) updated[i] = propagated[i];
      }
    } else if (field === "retenidoAcumPct") {
      // RET_ACUM → derive pasaPct
      if (value !== null && value !== undefined && value !== "") {
        const pasaPctDerived = Math.round((100 - Number(value)) * 100) / 100;
        updated[index].pasaPct = pasaPctDerived;
        if (pasaPctDerived === 0 || pasaPctDerived === 100) {
          const propagated = propagarMonotonia(updated, index, pasaPctDerived);
          for (let i = 0; i < updated.length; i++) updated[i] = propagated[i];
        }
      } else {
        updated[index].pasaPct = null;
      }
    } else if (field === "retenidoParcialPct") {
      // RET_PARCIAL → we calculate retAcum and pasaPct from the cumulative sum
      // Done in batch after setting the value
    }

    // For RET_PARCIAL: recompute retAcum and pasaPct for ALL tamices from cumulative sum
    if (field === "retenidoParcialPct") {
      const sorted = updated
        .map((t, i) => ({ ...t, _i: i }))
        .filter(t => t.habilitado)
        .sort((a, b) => (b.aberturaMm || 0) - (a.aberturaMm || 0));
      let acum = 0;
      for (const t of sorted) {
        const rp = t.retenidoParcialPct !== null && t.retenidoParcialPct !== undefined && t.retenidoParcialPct !== ""
          ? Number(t.retenidoParcialPct) : null;
        if (rp !== null) {
          acum += rp;
          updated[t._i] = {
            ...updated[t._i],
            retenidoAcumPct: Math.round(acum * 100) / 100,
            pasaPct: Math.round((100 - acum) * 100) / 100,
          };
        } else {
          updated[t._i] = { ...updated[t._i], retenidoAcumPct: null, pasaPct: null };
        }
      }
    }

    onFormChange({ ...formValues, tamices: updated });
  };

  const handleMetodoInformeChange = (val) => {
    if (!val) return;
    onFormChange({ ...formValues, metodoInforme: val });
  };

  const handleHabilitadoChange = (index, checked) => {
    const updated = [...tamices];
    updated[index] = { ...updated[index], habilitado: checked };
    onFormChange({ ...formValues, tamices: updated });
  };

  const handleFieldChange = (key, value) => {
    onFormChange({ ...formValues, [key]: value });
  };

  const handleClearAll = () => {
    const cleared = tamices.map((t) => ({ ...t, pasaPct: null, retenidoParcialPct: null, retenidoAcumPct: null }));
    onFormChange({ ...formValues, tamices: cleared });
  };

  /* ── Paste from Excel/clipboard ──────────────────── */
  const handlePaste = useCallback(
    (e) => {
      const text = e.clipboardData?.getData("text");
      if (!text) return;

      // Try to parse as tab/newline separated (Excel paste)
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return; // Not structured data

      // Detect format: could be [tamiz, %pasa] or just [%pasa] values
      const parsed = [];
      for (const line of lines) {
        const parts = line.split(/\t|;|,/).map((s) => s.trim());
        if (parts.length >= 2) {
          // Two-column: tamiz name + value
          const val = parseFloat(parts[parts.length - 1].replace(",", "."));
          if (!isNaN(val)) parsed.push({ label: parts[0], pasaPct: val });
        } else if (parts.length === 1) {
          const val = parseFloat(parts[0].replace(",", "."));
          if (!isNaN(val)) parsed.push({ label: null, pasaPct: val });
        }
      }

      if (parsed.length === 0) return;
      e.preventDefault();

      // Match parsed values to tamices
      const updated = [...tamices];

      if (parsed[0].label) {
        // Match by tamiz name (fuzzy)
        for (const p of parsed) {
          const idx = updated.findIndex((t) =>
            t.tamiz.toLowerCase().replace(/\s/g, "").includes(p.label.toLowerCase().replace(/\s/g, ""))
          );
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], pasaPct: Math.min(100, Math.max(0, p.pasaPct)), habilitado: true };
          }
        }
      } else {
        // Match by order — fill enabled tamices top-to-bottom
        const enabledIndices = updated.map((t, i) => (t.habilitado ? i : -1)).filter((i) => i >= 0);
        for (let i = 0; i < Math.min(parsed.length, enabledIndices.length); i++) {
          updated[enabledIndices[i]] = {
            ...updated[enabledIndices[i]],
            pasaPct: Math.min(100, Math.max(0, parsed[i].pasaPct)),
          };
        }
      }

      onFormChange({ ...formValues, tamices: updated });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tamices, formValues]
  );

  /* ── Computed columns (all 3 pct fields) ──────────── */
  const computedMap = useMemo(() => {
    // Build computed pasaPct / retAcumPct / retParcialPct for all tamices regardless of method
    const sorted = tamices
      .map((t, i) => ({ ...t, _i: i }))
      .filter((t) => t.habilitado)
      .sort((a, b) => (b.aberturaMm || 0) - (a.aberturaMm || 0));

    const map = {};

    // First pass: resolve pasaPct (may come from any input mode)
    for (const t of sorted) {
      const pasa = t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "" ? Number(t.pasaPct) : null;
      const acum = t.retenidoAcumPct !== null && t.retenidoAcumPct !== undefined && t.retenidoAcumPct !== "" ? Number(t.retenidoAcumPct) : null;
      map[t.aberturaMm] = { pasaPct: pasa, retAcumPct: acum, retParcialPct: null };
    }

    // Compute retAcumPct from pasaPct if missing
    for (const t of sorted) {
      const m = map[t.aberturaMm];
      if (m.retAcumPct === null && m.pasaPct !== null) {
        m.retAcumPct = Math.round((100 - m.pasaPct) * 100) / 100;
      }
    }

    // Compute retParcialPct from retAcumPct diffs
    for (let i = 0; i < sorted.length; i++) {
      const m = map[sorted[i].aberturaMm];
      if (m.retAcumPct !== null) {
        const prevAcum = i === 0 ? 0 : (map[sorted[i - 1].aberturaMm]?.retAcumPct ?? 0);
        m.retParcialPct = Math.round(Math.max(0, m.retAcumPct - prevAcum) * 100) / 100;
      }
      // If we have raw retenidoParcialPct from input, prefer that for display when in RET_PARCIAL mode
      const rp = sorted[i].retenidoParcialPct;
      if (rp !== null && rp !== undefined && rp !== "" && metodoInforme === "RET_PARCIAL") {
        m.retParcialPct = Number(rp);
      }
    }

    return map;
  }, [tamices, metodoInforme]);

  /* ── Faltantes / validation summary ──────────────── */
  const canRevisar = useMemo(() => {
    return (
      calc.cantTamices >= MIN_TAMICES_REVISADO &&
      calc.monotonia &&
      calc.errores.length === 0 &&
      tipoAgregado
    );
  }, [calc, tipoAgregado]);

  const localFaltantes = useMemo(() => {
    const f = [];
    if (!tipoAgregado) f.push("Tipo de agregado");
    if (tamicesConDatos.length < MIN_TAMICES_REVISADO) f.push(`Mínimo ${MIN_TAMICES_REVISADO} tamices con datos`);
    if (!calc.monotonia) f.push("Monotonicidad no cumple");
    return f;
  }, [tipoAgregado, tamicesConDatos, calc]);

  /* ── DataTable row data ──────────────────────────── */
  const rowData = useMemo(
    () =>
      tamices.map((t, idx) => ({
        ...t,
        _index: idx,
        _computed: computedMap[t.aberturaMm] || null,
      })),
    [tamices, computedMap]
  );

  /* ── Column templates ────────────────────────────── */
  const habilitadoBody = (row) => (
    <Checkbox
      checked={row.habilitado !== false}
      onChange={(e) => handleHabilitadoChange(row._index, e.checked)}
      disabled={isRevisado}
    />
  );

  const tamizBody = (row) => (
    <span className={!row.habilitado ? "text-400 line-through" : ""}>
      {row.tamiz}
    </span>
  );

  const aberturaBody = (row) => (
    <span className={`text-xs ${!row.habilitado ? "text-400" : "text-500"}`}>
      {row.aberturaMm}
    </span>
  );

  const pasaPctBody = (row) => {
    if (!row.habilitado) return <span className="text-400">—</span>;
    if (metodoInforme === "PASA") {
      return (
        <InputNumber
          value={row.pasaPct}
          onValueChange={(e) => handleInputChange(row._index, "pasaPct", e.value)}
          mode="decimal"
          minFractionDigits={0}
          maxFractionDigits={2}
          min={0}
          max={100}
          suffix=" %"
          className="w-full"
          inputClassName="text-right text-sm p-1"
          inputStyle={{ width: "80px" }}
          disabled={isRevisado}
          placeholder="—"
        />
      );
    }
    // Read-only computed
    const c = row._computed;
    if (!c || c.pasaPct === null) return <span className="text-400">—</span>;
    return <span className="text-sm">{c.pasaPct.toFixed(2)} %</span>;
  };

  const retenidoBody = (row) => {
    if (!row.habilitado) return <span className="text-400">—</span>;
    if (metodoInforme === "RET_PARCIAL") {
      return (
        <InputNumber
          value={row.retenidoParcialPct}
          onValueChange={(e) => handleInputChange(row._index, "retenidoParcialPct", e.value)}
          mode="decimal"
          minFractionDigits={0}
          maxFractionDigits={2}
          min={0}
          max={100}
          suffix=" %"
          className="w-full"
          inputClassName="text-right text-sm p-1"
          inputStyle={{ width: "80px" }}
          disabled={isRevisado}
          placeholder="—"
        />
      );
    }
    // Read-only computed
    const c = row._computed;
    if (!c || c.retParcialPct === null) return <span className="text-400">—</span>;
    return <span className="text-sm">{c.retParcialPct.toFixed(2)} %</span>;
  };

  const retAcumBody = (row) => {
    if (!row.habilitado) return <span className="text-400">—</span>;
    if (metodoInforme === "RET_ACUM") {
      return (
        <InputNumber
          value={row.retenidoAcumPct}
          onValueChange={(e) => handleInputChange(row._index, "retenidoAcumPct", e.value)}
          mode="decimal"
          minFractionDigits={0}
          maxFractionDigits={2}
          min={0}
          max={100}
          suffix=" %"
          className="w-full"
          inputClassName="text-right text-sm p-1"
          inputStyle={{ width: "80px" }}
          disabled={isRevisado}
          placeholder="—"
        />
      );
    }
    // Read-only computed
    const c = row._computed;
    if (!c || c.retAcumPct === null) return <span className="text-400">—</span>;
    return <span className="text-sm font-semibold">{c.retAcumPct.toFixed(2)} %</span>;
  };

  /* ── Row class for validation highlighting ───────── */
  const rowClass = (row) => {
    if (!row.habilitado) return "opacity-50";
    if (row.pasaPct !== null && row.pasaPct !== undefined && row.pasaPct !== "") {
      const v = Number(row.pasaPct);
      if (v < 0 || v > 100) return "bg-red-50";
    }
    if (esRecomendada(row.aberturaMm)) return "bg-blue-50";
    return "";
  };

  /* ══════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-column gap-3" onPaste={handlePaste}>
      <h4 className="mt-0 mb-1 flex align-items-center gap-2">
        <i className="fa-solid fa-chart-area text-primary" />
        Ensayo de Granulometría
      </h4>

      {/* ── Contexto de aplicación ─────────────────── */}
      <div className="grid">
        <div className="col-12">
          <label className="font-bold text-sm block mb-1">
            Contexto de aplicación
            <span className="text-muted ml-2 font-normal">
              (Hormigón: evalúa contra IRAM 1627 · TBS: se evalúa al armar Dotación · Ambos: cumple ambos)
            </span>
          </label>
          <SelectButton
            value={contextoAplicacion}
            options={CONTEXTO_OPTIONS}
            onChange={(e) => handleContextoChange(e.value)}
            disabled={isRevisado}
            className="w-full"
          />
        </div>
      </div>

      {/* ── Huso DNV de referencia (opcional, contexto TBS/AMBOS) ── */}
      {aplicaHuso && (
        <div className="grid">
          <div className="col-12">
            <label className="font-bold text-sm block mb-1">
              Huso DNV de referencia
              <span className="text-muted ml-2 font-normal">
                (Opcional. Si lo declarás, el sistema evalúa automáticamente Cumple/No cumple contra este huso.)
              </span>
            </label>
            <Dropdown
              value={idHusoDnvReferencia}
              options={husoOptions}
              onChange={(e) => onFormChange({ ...formValues, idHusoDnvReferencia: e.value ?? null })}
              placeholder={loadingHusos ? "Cargando husos..." : "Sin huso — no se evalúa automáticamente"}
              disabled={isRevisado || loadingHusos}
              className="w-full"
              filter
              showClear
            />
          </div>
        </div>
      )}

      {/* ── Serie & Tipo ───────────────────────────── */}
      <div className="grid">
        <div className="col-12 md:col-6">
          <label className="font-bold text-sm block mb-1">Serie de tamices</label>
          <SelectButton
            value={serie}
            options={serieOptions}
            onChange={(e) => handleSerieChange(e.value)}
            disabled={isRevisado || serieOptions.length === 1}
            className="w-full"
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="font-bold text-sm block mb-1">
            Tipo de agregado <span className="text-red-500">*</span>
          </label>
          <Dropdown
            value={tipoAgregado}
            options={TIPO_OPTIONS}
            onChange={(e) => handleTipoChange(e.value)}
            placeholder="Seleccionar tipo"
            className="w-full"
            disabled={isRevisado || tipoLocked}
            showClear={!tipoLocked}
          />
        </div>
      </div>

      {/* ── Metodología del informe (IRAM 1505 – 8.1) ── */}
      <div className="grid">
        <div className="col-12">
          <label className="font-bold text-sm block mb-1">
            Metodología del informe (IRAM 1505 – 8.1)
          </label>
          <SelectButton
            value={metodoInforme}
            options={METODO_INFORME_OPTIONS}
            onChange={(e) => handleMetodoInformeChange(e.value)}
            disabled={isRevisado}
            className="w-full"
          />
        </div>
      </div>

      {/* ── Ensayo header fields: only shown in standalone mode (showEnsayoHeaderFields=true) ─ */}
      {showEnsayoHeaderFields && (
        <div className="grid">
          <div className="col-12 md:col-6">
            <label className="font-bold text-sm block mb-1">Fecha de ensayo</label>
            <Calendar
              value={formValues.fechaEnsayo ? new Date(formValues.fechaEnsayo) : null}
              onChange={(e) =>
                handleFieldChange("fechaEnsayo", e.value ? e.value.toISOString().split("T")[0] : null)
              }
              dateFormat="dd/mm/yy"
              showIcon
              className="w-full"
              placeholder="Fecha de ensayo"
              disabled={isRevisado}
            />
          </div>
          <div className="col-12 md:col-6">
            <label className="font-bold text-sm block mb-1">Laboratorio</label>
            <InputText
              value={formValues.laboratorio || ""}
              onChange={(e) => handleFieldChange("laboratorio", e.target.value)}
              className="w-full"
              placeholder="Nombre del laboratorio"
              disabled={isRevisado}
            />
          </div>
        </div>
      )}

      <Divider className="my-1" />

      {/* ── Tamiz grid toolbar ─────────────────────── */}
      <div className="flex align-items-center justify-content-between">
        <div className="flex align-items-center gap-2">
          <span className="font-bold text-sm">Grilla de tamices</span>
          <Tag
            value={`${tamicesConDatos.length} tamices con datos`}
            severity={tamicesConDatos.length >= MIN_TAMICES_REVISADO ? "success" : "warning"}
            className="text-xs"
          />
          {serie === "IRAM" && tipoAgregado !== "FINO" && (
            <div className="flex align-items-center gap-1 ml-2">
              <Checkbox
                inputId="showAlt"
                checked={showAlternativos}
                onChange={(e) => handleShowAlternativosChange(e.checked)}
                disabled={isRevisado}
              />
              <label htmlFor="showAlt" className="text-xs text-500 cursor-pointer">
                Mostrar alternativos
              </label>
            </div>
          )}
        </div>
        <div className="flex align-items-center gap-2">
          <Button
            icon="fa-solid fa-paste"
            label="Pegar Excel"
            size="small"
            severity="help"
            text
            tooltip="Copie datos desde Excel y péguelos aquí (Ctrl+V)"
            tooltipOptions={{ position: "top" }}
            disabled={isRevisado}
            onClick={() => navigator.clipboard?.readText().then((t) => {
              handlePaste({ clipboardData: { getData: () => t }, preventDefault: () => {} });
            }).catch(() => {})}
          />
          <Button
            icon="fa-solid fa-eraser"
            label="Limpiar"
            size="small"
            severity="danger"
            text
            disabled={isRevisado || tamicesConDatos.length === 0}
            onClick={handleClearAll}
          />
        </div>
      </div>

      {/* ── Leyenda de tamices recomendados por huso ── */}
      {aberturasRecomendadas && aberturasRecomendadas.size > 0 && (
        <div className="flex align-items-center gap-2 text-xs text-600 -mb-2">
          <span className="inline-block" style={{ width: 14, height: 14, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 3 }} />
          <span>
            Filas resaltadas: tamices exigidos por <strong>{husoDetalle?.codigo}</strong>
            {husoDetalle?.capa ? ` (${husoDetalle.tipoTBS} ${husoDetalle.capa})` : ''}.
            Podés cargar también los demás tamices para caracterizar el agregado de forma genérica.
          </span>
        </div>
      )}

      {/* ── DataTable ──────────────────────────────── */}
      <DataTable responsiveLayout="scroll"
        value={rowData}
        size="small"
        stripedRows
        scrollable
        scrollHeight="320px"
        rowClassName={rowClass}
        emptyMessage="No hay tamices configurados"
        dataKey="_index"
      >
        <Column header="" body={habilitadoBody} style={{ width: "40px" }} />
        <Column header="Tamiz" body={tamizBody} style={{ width: "100px" }} />
        <Column header="Abertura (mm)" body={aberturaBody} style={{ width: "90px" }} />
        <Column header={metodoInforme === "PASA" ? "% Pasa ✎" : "% Pasa"} body={pasaPctBody} style={{ width: "120px" }} />
        <Column header={metodoInforme === "RET_PARCIAL" ? "% Ret. ✎" : "% Ret."} body={retenidoBody} style={{ width: "100px" }} />
        <Column header={metodoInforme === "RET_ACUM" ? "% Ret. Acum. ✎" : "% Ret. Acum."} body={retAcumBody} style={{ width: "120px" }} />
      </DataTable>

      <Divider className="my-1" />

      {/* ── Calculations summary ───────────────────── */}
      <div className="surface-100 border-round p-3">
        <div className="font-bold text-sm mb-2 flex align-items-center gap-2">
          <i className="fa-solid fa-calculator text-primary" />
          Resultados calculados
        </div>
        <div className="grid">
          <div className="col-12 sm:col-6 md:col-4 text-center">
            <div className="text-xs text-500 mb-1">Módulo de Finura</div>
            {calc.mf !== null ? (
              <>
                <div className="text-xl font-bold text-primary">
                  {calc.mf.toFixed(2)}
                </div>
                <div className="text-xs mt-1">
                  {calc.tipoInferido === "FINO" ? (
                    calc.mf >= 2.3 && calc.mf <= 3.1 ? (
                      <Tag value="En rango (2.3–3.1)" severity="success" className="text-xs" />
                    ) : (
                      <Tag value="Fuera de rango (2.3–3.1)" severity="warning" className="text-xs" />
                    )
                  ) : null}
                </div>
                {!calc.mfCompleto && calc.mfFaltantes?.length > 0 && (
                  <div className="text-xs mt-1 text-orange-500">
                    Incompleto — faltan: {calc.mfFaltantes.join(", ")} mm
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="text-xl font-bold text-500">—</div>
                {calc.mfFaltantes?.length > 0 && (
                  <div className="text-xs mt-1 text-orange-500">
                    Faltan: {calc.mfFaltantes.join(", ")} mm
                  </div>
                )}
              </>
            )}
          </div>
          <div className="col-12 sm:col-6 md:col-4 text-center">
            <div className="text-xs text-500 mb-1">TMN</div>
            <div className="text-xl font-bold text-primary">
              {calc.tmn !== null ? `${calc.tmn} mm` : "—"}
            </div>
          </div>
          <div className="col-12 sm:col-6 md:col-4 text-center">
            <div className="text-xs text-500 mb-1">Tamices</div>
            <div className="text-xl font-bold">
              {calc.cantTamices}
            </div>
            <div className="text-xs mt-1">
              {calc.cantTamices >= MIN_TAMICES_REVISADO ? (
                <Tag value="Suficientes" severity="success" className="text-xs" />
              ) : (
                <Tag value={`Mín: ${MIN_TAMICES_REVISADO}`} severity="warning" className="text-xs" />
              )}
            </div>
          </div>
        </div>

        {/* Monotonicity */}
        <div className="mt-2">
          <div className="flex align-items-center gap-2">
            <i className={`fa-solid ${calc.monotonia ? "fa-check-circle text-green-500" : "fa-exclamation-circle text-orange-500"}`} />
            <span className="text-sm">
              {calc.monotonia ? "Monotonicidad: OK" : "Monotonicidad: NO cumple"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Validation errors ──────────────────────── */}
      {calc.errores.length > 0 && (
        <div className="flex flex-column gap-1">
          {calc.errores.map((err, i) => (
            <Message key={i} severity="warn" text={err} className="w-full text-xs" />
          ))}
        </div>
      )}

      {/* ── Granulometric curve chart ──────────────── */}
      {tamicesConDatos.length >= 2 && (
        <>
          <Divider className="my-1" />
          <GranulometriaChart
            tamices={tamicesConDatos}
            tipoAgregado={calc.tipoInferido || tipoAgregado}
            husoAberturas={husoDetalle?.puntos?.map((p) => Number(p.aberturaMm)) || null}
          />
        </>
      )}

      {/* ── Ajuste a curva teórica (biblioteca) — solo para mezclas ──── */}
      {showAjusteTeorico && (
      <>
      <Divider className="my-1" />
      <AjusteTeoricoSection
        tamices={tamicesConDatos}
        serieTamices={serie}
        ajusteTeorico={formValues.ajusteTeorico}
        onResult={(resultado) => onFormChange({ ...formValues, ajusteTeorico: resultado })}
        disabled={isRevisado}
      />
      </>
      )}

      {/* ── Faltantes panel ────────────────────────── */}
      {localFaltantes.length > 0 && !isRevisado && (
        <div className="surface-0 border-round border-1 border-orange-300 p-2">
          <div className="flex align-items-center gap-2 mb-1">
            <i className="fa-solid fa-circle-exclamation text-orange-500" />
            <strong className="text-sm text-orange-700">
              Requisitos para marcar Revisado ({localFaltantes.length})
            </strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {localFaltantes.map((f, i) => (
              <Tag key={i} value={f} severity="warning" className="text-xs" />
            ))}
          </div>
        </div>
      )}

      {/* ── Action buttons ─────────────────────────── */}
      <div className="flex justify-content-end gap-2 mt-2 pt-3 border-top-1 surface-border">
        <Button
          label="Guardar"
          icon="fa-solid fa-save"
          size="small"
          severity="info"
          outlined
          loading={saving}
          onClick={() => onSave(false)}
          disabled={isRevisado || saving}
        />
        <Button
          label={
            isRevisado
              ? "Ya revisado"
              : !canRevisar
              ? `Faltan requisitos`
              : "Guardar y Marcar Revisado"
          }
          icon="fa-solid fa-check-circle"
          size="small"
          severity="success"
          loading={saving}
          onClick={() => onSave(true)}
          disabled={isRevisado || !canRevisar || saving}
          tooltip={
            !canRevisar
              ? "Complete todos los requisitos para marcar como revisado"
              : undefined
          }
          tooltipOptions={{ position: "top" }}
        />
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════
   Shared hook: fetch curves filtered by refTipo
   ══════════════════════════════════════════════════════ */
function useCurvasCatalogo(serieTamices, refTipo) {
  const [curvas, setCurvas] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchCurvas = async () => {
      try {
        setLoading(true);
        const params = { isActive: true };
        if (serieTamices) params.serieTamices = serieTamices;
        if (refTipo) params.refTipo = refTipo;
        const res = await axios.get(`${config.backendUrl}/api/curvas-granulometricas/catalogo`, {
          headers: config.headers,
          params,
        });
        if (!cancelled) setCurvas(res.data || []);
      } catch (err) {
        console.error("Error al cargar curvas:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchCurvas();
    return () => { cancelled = true; };
  }, [serieTamices, refTipo]);

  return { curvas, loading };
}

function useCompare(tamices, onResult) {
  const [selectedCurvaId, setSelectedCurvaId] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [comparing, setComparing] = useState(false);
  const prevFpRef = useRef(null);

  const doCompare = useCallback(async (curvaId, tamicesData) => {
    if (!curvaId || !tamicesData || tamicesData.length < 2) return;
    setComparing(true);
    try {
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/comparar`,
        { tamices: tamicesData, curvaId },
        { headers: config.headers }
      );
      setResultado(res.data);
      onResult(res.data);
    } catch (err) {
      console.error("Error al comparar:", err);
    } finally {
      setComparing(false);
    }
  }, [onResult]);

  const handleSelect = useCallback((curvaId) => {
    setSelectedCurvaId(curvaId);
    if (!curvaId) {
      setResultado(null);
      onResult(null);
      return;
    }
    doCompare(curvaId, tamices);
  }, [tamices, doCompare, onResult]);

  // Re-compare on tamices change (debounced)
  useEffect(() => {
    if (!selectedCurvaId || !tamices || tamices.length < 2) return;
    const fp = tamices.map(t => `${t.aberturaMm}:${t.pasaPct}`).join('|');
    if (prevFpRef.current === fp) return;
    prevFpRef.current = fp;
    const timer = setTimeout(() => doCompare(selectedCurvaId, tamices), 600);
    return () => clearTimeout(timer);
  }, [tamices, selectedCurvaId, doCompare]);

  return { selectedCurvaId, resultado, comparing, handleSelect };
}

/* ══════════════════════════════════════════════════════
   Sección 2: Ajuste a curva teórica (biblioteca)
   — Solo TEORICA / TABULADA
   — Métricas de ajuste, sin "cumple/no cumple"
   ══════════════════════════════════════════════════════ */
const AjusteTeoricoSection = ({ tamices, serieTamices, ajusteTeorico, onResult, disabled }) => {
  const { curvas, loading } = useCurvasCatalogo(serieTamices, "CURVA");
  const { selectedCurvaId, resultado, comparing, handleSelect } = useCompare(tamices, onResult);

  const [selectedCurvaFull, setSelectedCurvaFull] = useState(null);

  // Fetch full curva data when selection changes (catalog is lightweight)
  useEffect(() => {
    if (!selectedCurvaId) { setSelectedCurvaFull(null); return; }
    let cancelled = false;
    axios.get(`${config.backendUrl}/api/curvas-granulometricas/${selectedCurvaId}`, {
      headers: config.headers,
    }).then(res => { if (!cancelled) setSelectedCurvaFull(res.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedCurvaId]);

  const curvaOptions = curvas.map((c) => ({
    label: `${c.nombre}${c.curveLetter ? ` (${c.curveLetter})` : ""}`,
    value: c.idCurva,
  }));

  const curvaPuntos = useMemo(() => {
    if (!selectedCurvaFull) return [];
    if (selectedCurvaFull.tipo === "TEORICA") return selectedCurvaFull.puntosCalculados || [];
    return selectedCurvaFull.puntos || [];
  }, [selectedCurvaFull]);

  return (
    <div className="surface-100 border-round p-3">
      <div className="flex align-items-center gap-2 mb-2">
        <i className="fa-solid fa-square-root-variable text-primary" />
        <span className="font-bold text-sm">Ajuste a curva teórica (biblioteca)</span>
        {resultado && resultado.rmse != null && (
          <span className="text-xs ml-auto surface-0 border-round border-1 surface-border px-2 py-1">
            RMSE {resultado.rmse.toFixed(1)}% | MAE {(resultado.mae ?? 0).toFixed(1)}% | Máx desvío {(resultado.maxDesvio ?? 0).toFixed(1)}%
          </span>
        )}
      </div>

      {curvas.length === 0 && !loading ? (
        <div className="text-center p-3 text-500">
          <i className="fa-solid fa-square-root-variable text-3xl mb-2 block opacity-40" />
          <span className="text-sm">No hay curvas teóricas disponibles{serieTamices ? ` para serie ${serieTamices}` : ""}.</span>
        </div>
      ) : (
        <>
          <div className="flex align-items-end gap-2 mb-3">
            <div className="flex-1">
              <label className="text-xs text-500 block mb-1">Seleccionar curva teórica</label>
              <Dropdown
                value={selectedCurvaId}
                options={curvaOptions}
                onChange={(e) => handleSelect(e.value)}
                placeholder="Elegir curva teórica..."
                className="w-full"
                filter
                showClear
                loading={loading}
                disabled={disabled}
              />
            </div>
            {comparing && (
              <div className="flex align-items-center gap-1 text-xs text-500 pb-2">
                <i className="fa-solid fa-spinner fa-spin" /> Calculando ajuste...
              </div>
            )}
          </div>

          {/* Chart: muestra + curva teórica */}
          {selectedCurvaFull && tamices.length >= 2 && (
            <div className="mb-3">
              <CurvaChart
                tipo={selectedCurvaFull.tipo}
                puntos={curvaPuntos}
                nombre={selectedCurvaFull.nombre}
                tamicesMuestra={tamices}
                specMode={selectedCurvaFull.specMode}
              />
            </div>
          )}

          {/* Metrics — NO cumple/no cumple */}
          {resultado && resultado.tipo !== "BANDA" && (
            <div className="surface-0 border-round border-1 surface-border p-2">
              <div className="flex align-items-center gap-2 mb-2 flex-wrap">
                <i className="fa-solid fa-chart-bar text-primary" />
                <span className="font-bold text-sm">
                  RMSE: {resultado.rmse != null ? resultado.rmse.toFixed(2) + "%" : "—"}
                </span>
                <span className="text-sm text-600">
                  | MAE: {resultado.mae != null ? resultado.mae.toFixed(2) + "%" : "—"}
                </span>
                <span className="text-sm text-600">
                  | Máx desvío: {resultado.maxDesvio != null ? resultado.maxDesvio.toFixed(2) + "%" : "—"}
                </span>
                {resultado.r2 != null && (
                  <span className="text-sm text-600">
                    | R²: {resultado.r2.toFixed(4)}
                  </span>
                )}
                <span className="text-xs text-500 ml-auto">
                  {resultado.cantidadComparados} tamices comparados
                </span>
              </div>

              {resultado.rmse != null && (
                <div className="mb-2">
                  <Tag
                    value={resultado.rmse < 5 ? "Ajuste excelente" : resultado.rmse < 10 ? "Ajuste bueno" : resultado.rmse < 20 ? "Ajuste moderado" : "Ajuste pobre"}
                    severity={resultado.rmse < 5 ? "success" : resultado.rmse < 10 ? "info" : resultado.rmse < 20 ? "warning" : "danger"}
                    className="text-xs"
                  />
                </div>
              )}

              {resultado.desvios && resultado.desvios.length > 0 && (
                <DataTable responsiveLayout="scroll"
                  value={resultado.desvios}
                  size="small"
                  stripedRows
                  scrollable
                  scrollHeight="150px"
                  className="text-xs"
                >
                  <Column field="tamiz" header="Tamiz" style={{ width: "90px" }} />
                  <Column header="Muestra" body={(r) => `${r.pasaPctMuestra.toFixed(1)}%`} style={{ width: "70px" }} />
                  <Column header="Curva" body={(r) => `${r.pasaPctCurva.toFixed(1)}%`} style={{ width: "70px" }} />
                  <Column
                    header="Error"
                    body={(r) => (
                      <span className={r.errorAbs > 10 ? "text-red-500 font-bold" : ""}>
                        {r.error > 0 ? "+" : ""}{r.error.toFixed(1)}%
                      </span>
                    )}
                    style={{ width: "70px" }}
                  />
                </DataTable>
              )}

              {resultado.observaciones?.length > 0 && (
                <div className="mt-2 pt-2 border-top-1 surface-border">
                  <div className="text-xs text-500 mb-1 font-bold">
                    <i className="fa-solid fa-lightbulb mr-1" />Observaciones
                  </div>
                  <div className="flex flex-column gap-1">
                    {resultado.observaciones.map((obs, i) => (
                      <div key={i} className="text-xs flex align-items-center gap-1">
                        <i className="fa-solid fa-circle text-orange-400" style={{ fontSize: "5px" }} />
                        {obs}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GranulometriaEditor;
