import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";

import { Tag } from "primereact/tag";
import { MultiSelect } from "primereact/multiselect";
import { Checkbox } from "primereact/checkbox";
import { Tooltip } from "primereact/tooltip";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Message } from "primereact/message";
import { Chart } from "primereact/chart";
import GranulometriaEditor from "../materiales/GranulometriaEditor";
import EnsayoTipoForm from "./EnsayoTipoForm";
import { createEnsayo, updateEnsayo, getEnsayo as fetchEnsayoById, evaluarGranulometria, evaluarBandaCompuesta, ajustarContraTeorica, getCurvasCatalogo, getFormSpec, getCaracterizacion } from "../../../services/agregadoEnsayoService";
import { useToast } from "../../../context/ToastContext";
import { CATEGORIA_COLORS, VEREDICTO } from "../../../lib/compliance";

/* ─────────────── Helpers de mapeo a categorías visuales (Prompt 3 C7) ─────────────── */

/**
 * Mapeo del vocabulario `cumple` legacy del modal (4 valores) → categoría
 * visual canónica. El state interno del form se mantiene en valores legacy
 * porque se persiste en BD así (ENUM AgregadoEnsayo.cumple), pero el render
 * usa la categoría visual.
 */
function categoriaDeCumpleLegacy(cumple) {
    switch (cumple) {
        case 'CUMPLE':         return VEREDICTO.APTO;
        case 'NO_CUMPLE':      return VEREDICTO.NO_APTO;
        case 'NO_EVAL':        return VEREDICTO.EVALUACION_INCOMPLETA;
        case 'SIN_PARAMETROS': return VEREDICTO.EVALUACION_INCOMPLETA;
        default:               return VEREDICTO.EVALUACION_INCOMPLETA;
    }
}

/**
 * Vocabulario `estado` de granulometría: cumple | cumple_con_tolerancia | no_cumple.
 * `cumple_con_tolerancia` (§3.2.4) → APTO_CON_OBSERVACIONES (caso paradigmático
 * D15/D20: cumple con nota técnica, no es un cumple plano).
 */
function categoriaDeEstadoGranulometria(estado) {
    switch (estado) {
        case 'cumple':                 return VEREDICTO.APTO;
        case 'cumple_con_tolerancia':  return VEREDICTO.APTO_CON_OBSERVACIONES;
        case 'no_cumple':              return VEREDICTO.NO_APTO;
        default:                       return VEREDICTO.EVALUACION_INCOMPLETA;
    }
}

/**
 * Boolean cumple → categoría. Usado por las cards de reglas CIRSOC
 * (`evalResult.reglasCIRSOC.<regla>.cumple`).
 */
function categoriaDeBoolean(cumple) {
    if (cumple === true)  return VEREDICTO.APTO;
    if (cumple === false) return VEREDICTO.NO_APTO;
    return VEREDICTO.EVALUACION_INCOMPLETA;
}

const EnsayoFormModal = ({ visible, onHide, legacyAgregadoId, tipos = [], ensayo = null, onSaved, defaultUsoAgregado = null, readOnly = false }) => {
    const showToast = useToast();
    const isEdit = !!ensayo;

    // ─── State ──────────────────────────────────────────────
    const [idAgregadoEnsayoTipo, setIdAgregadoEnsayoTipo] = useState(null);
    const [fechaEnsayo, setFechaEnsayo] = useState(null);
    const [fechaMuestreo, setFechaMuestreo] = useState(null);
    const [laboratorio, setLaboratorio] = useState("");
    const [nroInforme, setNroInforme] = useState("");
    const [observaciones, setObservaciones] = useState("");
    const [cumple, setCumple] = useState("NO_EVAL");
    const [resultadoJson, setResultadoJson] = useState("");
    // fechaVencimiento se calcula automáticamente en el backend
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saveErrors, setSaveErrors] = useState([]);
    const [showAvanzados, setShowAvanzados] = useState(false);

    // Form spec state (dynamic form rendering)
    const [formSpec, setFormSpec] = useState(null);
    const [genericResultado, setGenericResultado] = useState({});
    const [loadingSpec, setLoadingSpec] = useState(false);

    // Densidad SSS del agregado (para cálculo de vacíos en peso unitario)
    const [densidadSSS, setDensidadSSS] = useState(null);

    // Fresh ensayo data (re-fetched to get auto-eval results)
    const [freshEnsayo, setFreshEnsayo] = useState(null);
    useEffect(() => {
        if (visible && ensayo?.idAgregadoEnsayo) {
            fetchEnsayoById(ensayo.idAgregadoEnsayo)
                .then(data => {
                    setFreshEnsayo(data);
                })
                .catch((err) => {
                    console.error('[EnsayoFormModal] freshEnsayo fetch error:', err);
                    setFreshEnsayo(null);
                });
        } else {
            setFreshEnsayo(null);
        }
    }, [visible, ensayo?.idAgregadoEnsayo]);

    useEffect(() => {
        if (visible && legacyAgregadoId) {
            getCaracterizacion(legacyAgregadoId).then(data => {
                const d = data?.densidadRelativaAparenteSSS;
                setDensidadSSS(d?.valor ?? d ?? null);
            }).catch(() => setDensidadSSS(null));
        }
    }, [visible, legacyAgregadoId]);

    // Granulometría state
    const [granuloFormValues, setGranuloFormValues] = useState({
        serieTamices: "IRAM",
        tipoAgregado: null,
        metodoInforme: "PASA",
        tamices: [],
        contextoAplicacion: "HORMIGON",
        idHusoDnvReferencia: null,
    });

    // Curva objetivo state
    const [curvasCatalogo, setCurvasCatalogo] = useState([]);
    const [idCurvaObjetivo, setIdCurvaObjetivo] = useState(null);
    const [usoFiltro, setUsoFiltro] = useState(null);
    const [loadingCurvas, setLoadingCurvas] = useState(false);

    // Composite band state (Inserción en bandas)
    const [selectedBandaCompuesta, setSelectedBandaCompuesta] = useState(null); // { idCurvaMin, idCurvaMax, label }

    // Evaluación preview state (banda normativa)
    const [evalResult, setEvalResult] = useState(null);
    const [evaluating, setEvaluating] = useState(false);

    // Ajuste teórico state
    const [idCurvaTeorica, setIdCurvaTeorica] = useState(null);
    const [ajusteResult, setAjusteResult] = useState(null);
    const [evaluatingTeorica, setEvaluatingTeorica] = useState(false);

    // Incompatibility warning (non-intrusive inline)
    const [curvasWarning, setCurvasWarning] = useState(null);

    // Debounce refs for catalog fetch
    const fetchTimerRef = useRef(null);
    const lastQueryKeyRef = useRef(null);
    const abortRef = useRef(null);

    // ─── Prefill on edit ────────────────────────────────────
    useEffect(() => {
        if (ensayo) {
            setIdAgregadoEnsayoTipo(ensayo.idAgregadoEnsayoTipo);
            setFechaEnsayo(ensayo.fechaEnsayo ? new Date(ensayo.fechaEnsayo) : null);
            setFechaMuestreo(ensayo.fechaMuestreo ? new Date(ensayo.fechaMuestreo) : null);
            setLaboratorio(ensayo.laboratorio || "");
            setNroInforme(ensayo.nroInforme || "");
            setObservaciones(ensayo.observaciones || "");
            setCumple(ensayo.cumple || "NO_EVAL");
            // fechaVencimiento is auto-calculated by backend
            setSaveErrors([]);

            // resultado — parse string JSON if needed (legacy data)
            let rawRes = ensayo.resultado;
            if (typeof rawRes === 'string') {
                try { rawRes = JSON.parse(rawRes); } catch { rawRes = null; }
            }
            if (rawRes?.granulometria) {
                const g = rawRes.granulometria;
                const restoredTipo = g.tipoAgregado || defaultUsoAgregado || null;
                setGranuloFormValues({
                    serieTamices: g.serieTamices || "IRAM",
                    tipoAgregado: restoredTipo,
                    metodoInforme: g.metodoInforme || "PASA",
                    tamices: g.tamices || [],
                    contextoAplicacion: ensayo.contextoAplicacion || "HORMIGON",
                    idHusoDnvReferencia: ensayo.idHusoDnvReferencia ?? null,
                });
                const restoredObjetivo = g.idCurvaObjetivo || g.objetivo?.idCurvaObjetivo || null;
                setIdCurvaObjetivo(restoredObjetivo);
                setIdCurvaTeorica(g.idCurvaTeorica || null);
                setUsoFiltro(restoredTipo);
                setEvalResult(g.evaluacion || null);
                setAjusteResult(g.ajusteTeorico || null);
                setCurvasWarning(null);
                setResultadoJson("");
                setGenericResultado({});

                // Restore banda compuesta selection from saved objetivo
                const savedObj = g.evaluacion?.objetivo || g.objetivo;
                if (savedObj?.curvaMin?.idCurva && savedObj?.curvaMax?.idCurva) {
                    setSelectedBandaCompuesta({
                        idCurvaMin: savedObj.curvaMin.idCurva,
                        idCurvaMax: savedObj.curvaMax.idCurva,
                        idCurvaMiddle: savedObj.curvaMiddle?.idCurva || null,
                        label: savedObj.nombre || 'Banda restaurada',
                        _key: `${savedObj.curvaMin.idCurva}|${savedObj.curvaMax.idCurva}`,
                    });
                } else {
                    setSelectedBandaCompuesta(null);
                }
            } else if (rawRes) {
                // Non-granulometry resultado → populate genericResultado for EnsayoTipoForm
                setGenericResultado(rawRes);
                setResultadoJson(JSON.stringify(rawRes, null, 2));
                setIdCurvaObjetivo(null);
                setSelectedBandaCompuesta(null);
                setIdCurvaTeorica(null);
                setEvalResult(null);
                setAjusteResult(null);
            } else {
                setResultadoJson("");
                setGenericResultado({});
                setIdCurvaObjetivo(null);
                setSelectedBandaCompuesta(null);
                setIdCurvaTeorica(null);
                setEvalResult(null);
                setAjusteResult(null);
            }
        } else {
            // Reset
            setIdAgregadoEnsayoTipo(null);
            setFechaEnsayo(null);
            setFechaMuestreo(null);
            setLaboratorio("");
            setNroInforme("");
            setObservaciones("");
            setCumple("NO_EVAL");
            setResultadoJson("");
            // fechaVencimiento auto-calculated
            setGranuloFormValues({ serieTamices: "IRAM", tipoAgregado: defaultUsoAgregado || null, metodoInforme: "PASA", tamices: [], contextoAplicacion: "HORMIGON", idHusoDnvReferencia: null });
            setIdCurvaObjetivo(null);
            setSelectedBandaCompuesta(null);
            setIdCurvaTeorica(null);
            setEvalResult(null);
            setAjusteResult(null);
            setCurvasWarning(null);
            setSaveErrors([]);
            setGenericResultado({});
            setFormSpec(null);
        }
    }, [ensayo, visible]);

    // ─── Derived ────────────────────────────────────────────
    const selectedTipo = useMemo(
        () => tipos.find((t) => t.idAgregadoEnsayoTipo === idAgregadoEnsayoTipo),
        [tipos, idAgregadoEnsayoTipo]
    );

    const isGranulometria = useMemo(
        () => formSpec ? formSpec.modo === "GRANULO" : selectedTipo?.codigo?.includes("GRANULOMETRIA"),
        [selectedTipo, formSpec]
    );

    const isDerivado = useMemo(() => formSpec?.modo === "DERIVADO", [formSpec]);

    // ─── Fetch form spec when tipo changes ──────────────────
    // Prefer schemaKey resolution, fallback to codigo
    useEffect(() => {
        if (!selectedTipo?.codigo) {
            setFormSpec(null);
            return;
        }
        let cancelled = false;
        setLoadingSpec(true);
        // Try schemaKey first (if the tipo has one and it's not DERIVADO), then fall back to codigo
        const specKey = selectedTipo.schemaKey && selectedTipo.schemaKey !== 'DERIVADO'
            ? selectedTipo.schemaKey
            : selectedTipo.codigo;
        getFormSpec(specKey)
            .then((spec) => {
                if (!cancelled) {
                    setFormSpec(spec);
                    // Initialize genericResultado to empty when switching tipo
                    if (spec?.modo === "GENERIC" && Object.keys(genericResultado).length === 0) {
                        setGenericResultado({});
                    }
                }
            })
            .catch(() => {
                // If schemaKey lookup failed, try by codigo as fallback
                if (!cancelled && specKey !== selectedTipo.codigo) {
                    getFormSpec(selectedTipo.codigo)
                        .then((spec) => { if (!cancelled) setFormSpec(spec); })
                        .catch(() => { if (!cancelled) setFormSpec(null); });
                } else if (!cancelled) {
                    setFormSpec(null);
                }
            })
            .finally(() => { if (!cancelled) setLoadingSpec(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTipo?.codigo, selectedTipo?.schemaKey]);

    // ─── Computed TMN from evaluation (for catalog ranking) ─
    const tmnCalculado = useMemo(
        () => evalResult?.calculos?.tmn?.valor ?? null,
        [evalResult]
    );

    // ─── Auto-sync usoFiltro from tipoAgregado ─────────────
    useEffect(() => {
        const ta = granuloFormValues.tipoAgregado;
        if (ta && ta !== usoFiltro) {
            setUsoFiltro(ta);
        }
    }, [granuloFormValues.tipoAgregado]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Fetch curvas catálogo (debounced + deduped) ────────
    // Fetches ALL types (BANDA + CURVA) so both primary and overlay selectors
    // can filter client-side by refTipo.
    useEffect(() => {
        if (!visible || !isGranulometria) return;

        const queryKey = JSON.stringify({
            uso: usoFiltro || null,
            tmnMm: tmnCalculado != null ? Math.round(tmnCalculado * 10) / 10 : null,
            serieTamices: granuloFormValues.serieTamices || "IRAM",
        });

        // Dedupe: skip if same query
        if (queryKey === lastQueryKeyRef.current) return;

        // Clear any pending debounce
        if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);

        fetchTimerRef.current = setTimeout(async () => {
            // Abort previous in-flight request
            if (abortRef.current) abortRef.current.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                setLoadingCurvas(true);
                const params = {
                    serieTamices: granuloFormValues.serieTamices || undefined,
                };
                if (usoFiltro) params.uso = usoFiltro;
                if (tmnCalculado != null) params.tmnMm = tmnCalculado;
                const data = await getCurvasCatalogo(params, { signal: controller.signal });
                if (!controller.signal.aborted) {
                    lastQueryKeyRef.current = queryKey;
                    setCurvasCatalogo(data || []);
                }
            } catch (err) {
                if (!controller.signal.aborted) {
                    console.error("Error al cargar curvas catálogo:", err);
                    setCurvasCatalogo([]);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoadingCurvas(false);
                }
            }
        }, 250);

        return () => {
            if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
        };
    }, [visible, isGranulometria, usoFiltro, tmnCalculado, granuloFormValues.serieTamices]);

    // Reset queryKey when modal closes so re-open fetches fresh
    useEffect(() => {
        if (!visible) {
            lastQueryKeyRef.current = null;
            if (abortRef.current) abortRef.current.abort();
        }
    }, [visible]);

    // ─── Clear incompatible curva when uso/catalog changes ──
    useEffect(() => {
        if (!usoFiltro) { setCurvasWarning(null); return; }
        // Wait until catalog is loaded for this uso before checking
        if (loadingCurvas || curvasCatalogo.length === 0) return;

        const catalogIds = new Set(curvasCatalogo.map((c) => c.idCurva));
        let removed = 0;

        // Check objective curve compatibility (banda)
        if (idCurvaObjetivo && !catalogIds.has(idCurvaObjetivo)) {
            setIdCurvaObjetivo(null);
            setSelectedBandaCompuesta(null);
            setEvalResult(null);
            removed++;
        }

        // Check theoretical curve compatibility
        if (idCurvaTeorica && !catalogIds.has(idCurvaTeorica)) {
            setIdCurvaTeorica(null);
            setAjusteResult(null);
            removed++;
        }

        if (removed > 0) {
            setCurvasWarning(`Se removieron ${removed} curva(s) por incompatibilidad con el uso "${usoFiltro}" o por no existir en el catálogo.`);
        } else {
            setCurvasWarning(null);
        }
    }, [usoFiltro, curvasCatalogo, loadingCurvas]); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Evaluar preview ────────────────────────────────────
    const doEvaluar = useCallback(async () => {
        const hasCompuesta = !!selectedBandaCompuesta;
        if (!hasCompuesta && !idCurvaObjetivo) {
            showToast("warn", "Seleccioná una banda primero");
            return;
        }

        const puntos = (granuloFormValues.tamices || [])
            .filter((t) => t.habilitado && t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "")
            .map((t) => ({ aberturaMm: t.aberturaMm, pasaPct: Number(t.pasaPct), tamiz: t.tamiz }));

        if (puntos.length < 2) {
            showToast("warn", "Se necesitan al menos 2 tamices con datos para evaluar");
            return;
        }

        try {
            setEvaluating(true);
            let result;
            if (hasCompuesta) {
                const payload = {
                    serieTamices: granuloFormValues.serieTamices,
                    medidos: puntos,
                    idCurvaMin: selectedBandaCompuesta.idCurvaMin,
                    idCurvaMax: selectedBandaCompuesta.idCurvaMax,
                    tipoAgregado: granuloFormValues.tipoAgregado || undefined,
                };
                if (selectedBandaCompuesta.idCurvaMiddle) {
                    payload.idCurvaMiddle = selectedBandaCompuesta.idCurvaMiddle;
                }
                result = await evaluarBandaCompuesta(payload);
            } else {
                result = await evaluarGranulometria({
                    serieTamices: granuloFormValues.serieTamices,
                    medidos: puntos,
                    idCurvaObjetivo,
                    tipoAgregado: granuloFormValues.tipoAgregado || undefined,
                });
            }
            setEvalResult(result);
        } catch (err) {
            console.error("Error al evaluar:", err);
            showToast("error", err.response?.data?.error || "Error al evaluar granulometría");
        } finally {
            setEvaluating(false);
        }
    }, [idCurvaObjetivo, selectedBandaCompuesta, granuloFormValues, showToast]);

    // Auto-evaluate when curve changes
    useEffect(() => {
        const hasSelection = idCurvaObjetivo || selectedBandaCompuesta;
        if (hasSelection && isGranulometria && visible) {
            const puntos = (granuloFormValues.tamices || [])
                .filter((t) => t.habilitado && t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "");
            if (puntos.length >= 2) {
                doEvaluar();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idCurvaObjetivo, selectedBandaCompuesta]);

    // ─── Ajuste teórico preview ─────────────────────────────
    const doAjusteTeorico = useCallback(async () => {
        if (!idCurvaTeorica) return;

        const puntos = (granuloFormValues.tamices || [])
            .filter((t) => t.habilitado && t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "")
            .map((t) => ({ aberturaMm: t.aberturaMm, pasaPct: Number(t.pasaPct), tamiz: t.tamiz }));

        if (puntos.length < 2) {
            showToast("warn", "Se necesitan al menos 2 tamices con datos para ajustar");
            return;
        }

        try {
            setEvaluatingTeorica(true);
            const result = await ajustarContraTeorica({
                serieTamices: granuloFormValues.serieTamices,
                medidos: puntos,
                idCurvaTeorica,
                tipoAgregado: granuloFormValues.tipoAgregado || undefined,
            });
            setAjusteResult(result);
        } catch (err) {
            console.error("Error al ajustar contra teórica:", err);
            showToast("error", err.response?.data?.error || "Error al ajustar contra curva teórica");
        } finally {
            setEvaluatingTeorica(false);
        }
    }, [idCurvaTeorica, granuloFormValues, showToast]);

    // Auto-ajustar when theoretical curve changes
    useEffect(() => {
        if (idCurvaTeorica && isGranulometria && visible) {
            const puntos = (granuloFormValues.tamices || [])
                .filter((t) => t.habilitado && t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "");
            if (puntos.length >= 2) {
                doAjusteTeorico();
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idCurvaTeorica]);

    // ─── Curva options ──────────────────────────────────────
    // Options for banda normativa selector (BANDA only)
    const curvaBandaOptions = useMemo(() => {
        return curvasCatalogo
            .filter((c) => c.refTipo === 'BANDA')
            .map((c) => ({
                label: `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ""}${c.curveLetter ? ` – ${c.curveLetter}` : ""}`,
                value: c.idCurva,
                recomendada: !!c.recomendada,
                tmnDistancia: c.tmnDistancia,
                score: c.score,
                refTipo: c.refTipo,
            }));
    }, [curvasCatalogo]);

    // Composite band options: pair curves by curveLetter within same normaRef+uso group
    // Generates only: A-B and A-C (banda A-B-C eliminada según CIRSOC 200-2024)
    const bandaCompuestaOptions = useMemo(() => {
        const bandas = curvasCatalogo.filter((c) => c.refTipo === 'BANDA' && c.curveLetter);
        // Group by normaRef+uso+tmnMm
        const groups = {};
        for (const c of bandas) {
            const key = `${c.normaRef || ''}|${c.uso || ''}|${c.tmnMm || ''}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(c);
        }
        const options = [];
        for (const curves of Object.values(groups)) {
            if (curves.length < 2) continue;
            const sorted = [...curves].sort((a, b) => (a.curveLetter || '').localeCompare(b.curveLetter || ''));
            const prefix = sorted[0].normaRef ? `${sorted[0].normaRef} — ` : '';
            const usoLabel = sorted[0].uso ? `${sorted[0].uso} — ` : '';

            // Two-curve pairs only (A-B, A-C) — no A-B-C
            const first = sorted[0]; // A
            for (let j = 1; j < sorted.length; j++) {
                const max = sorted[j];
                options.push({
                    label: `${prefix}${usoLabel}Banda ${first.curveLetter}-${max.curveLetter}`,
                    value: `${first.idCurva}|${max.idCurva}`,
                    idCurvaMin: first.idCurva,
                    idCurvaMax: max.idCurva,
                });
            }
        }
        return options;
    }, [curvasCatalogo]);

    // Options for ajuste teórico selector (CURVA = TEORICA/TABULADA/OBJETIVO)
    const curvaTeoricaOptions = useMemo(() => {
        return curvasCatalogo
            .filter((c) => c.refTipo === 'CURVA')
            .map((c) => ({
                label: `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ""}${c.curveLetter ? ` – ${c.curveLetter}` : ""}`,
                value: c.idCurva,
                recomendada: !!c.recomendada,
                tmnDistancia: c.tmnDistancia,
                score: c.score,
                refTipo: c.refTipo,
            }));
    }, [curvasCatalogo]);

    const curvaItemTemplate = useCallback((option) => {
        if (!option) return null;
        return (
            <div className="flex align-items-center justify-content-between w-full gap-2">
                <span>{option.label}</span>
                <div className="flex gap-1">
                    {option.recomendada && option.score === 0 && (
                        <Tag value="Match TMN" severity="info" className="text-xs" style={{ fontSize: "0.6rem", padding: "1px 5px" }} />
                    )}
                    {option.recomendada && (
                        <Tag value="★ Recomendada" severity="success" className="text-xs" style={{ fontSize: "0.6rem", padding: "1px 5px" }} />
                    )}
                </div>
            </div>
        );
    }, []);

    // ─── Client-side validation for resultado (spec-based) ──
    const validateResultadoClient = useCallback((tipoCodigo, resultado, spec) => {
        const errors = [];
        if (!tipoCodigo || !resultado) return errors;

        // If we have a spec, validate using spec fields
        if (spec?.fields) {
            for (const f of spec.fields) {
                const val = resultado[f.path];
                const unitSuffix = f.unit ? ` ${f.unit}` : "";
                if (f.required && (val == null || val === "")) {
                    errors.push(`${f.label}${unitSuffix}: campo requerido`);
                    continue;
                }
                if (val == null || val === "") continue;

                if (f.type === "number") {
                    const n = typeof val === "string" ? Number(val.replace(",", ".")) : Number(val);
                    if (isNaN(n)) {
                        errors.push(`${f.label}${unitSuffix}: valor no numérico`);
                    } else {
                        if (f.min != null && n < f.min) errors.push(`${f.label}: mínimo ${f.min}${unitSuffix} (valor: ${n})`);
                        if (f.max != null && n > f.max) errors.push(`${f.label}: máximo ${f.max}${unitSuffix} (valor: ${n})`);
                    }
                }
                if (f.type === "enum" && f.options) {
                    const validValues = f.options.map((o) => typeof o === "object" ? o.value : o);
                    if (!validValues.includes(val)) {
                        errors.push(`${f.label}: valor no válido "${val}" (opciones: ${validValues.join(", ")})`);
                    }
                }
            }
            return errors;
        }

        // Fallback: legacy hardcoded checks when no spec available
        const pctField = (val, label) => {
            if (val == null || val === "") return;
            const n = typeof val === "string" ? Number(val.replace(",", ".")) : Number(val);
            if (isNaN(n)) errors.push(`${label}: valor no numérico`);
            else if (n < 0 || n > 100) errors.push(`${label}: debe estar entre 0 y 100 (valor: ${n})`);
        };

        const numField = (val, label) => {
            if (val == null || val === "") return;
            const n = typeof val === "string" ? Number(val.replace(",", ".")) : Number(val);
            if (isNaN(n)) errors.push(`${label}: valor no numérico`);
        };

        if (tipoCodigo.includes("DESGASTE_LA")) pctField(resultado.losAngelesPct, "Desgaste Los Ángeles");
        if (tipoCodigo.includes("LAJOSIDAD")) pctField(resultado.lajosidadPct, "Lajosidad");
        if (tipoCodigo.includes("ELONGACION")) pctField(resultado.elongacionPct, "Elongación");
        if (tipoCodigo.includes("MATERIAL_FINO")) pctField(resultado.pasa200Pct, "Pasa N° 200");
        if (tipoCodigo.includes("DESMENUZABLES")) pctField(resultado.desmenuzablesPct, "Partículas desmenuzables");
        if (tipoCodigo.includes("EQUIVALENTE_ARENA")) pctField(resultado.equivalenteArenaPct, "Equivalente de arena");
        if (tipoCodigo.includes("SULFATOS")) {
            pctField(resultado.perdidaPct, "Pérdida por sulfatos");
            if (resultado.sulfato && !["sodio", "magnesio"].includes(resultado.sulfato)) {
                errors.push(`Sulfato: debe ser "sodio" o "magnesio" (valor: "${resultado.sulfato}")`);
            }
        }
        if (tipoCodigo.includes("DENSIDAD")) {
            numField(resultado.absorcionPct, "Absorción");
            numField(resultado.densidadSSS, "Densidad SSS");
            numField(resultado.densidadSeca, "Densidad seca");
        }
        if (tipoCodigo.includes("PESO_UNITARIO")) {
            numField(resultado.pesoUnitarioSueltoKgM3, "PU suelto");
            numField(resultado.pesoUnitarioCompactadoKgM3, "PU compactado");
        }
        if (tipoCodigo.includes("AZUL_METILENO")) {
            numField(resultado.azulMetilenoGKg, "Azul de metileno");
        }

        return errors;
    }, []);

    // ─── Save ───────────────────────────────────────────────
    const guardar = async () => {
        if (savingRef.current) return;
        setSaveErrors([]);

        // Derivados cannot be saved manually
        if (isDerivado) {
            showToast("warn", "Los ensayos derivados se autogeneran. No se pueden guardar manualmente.");
            return;
        }

        if (!idAgregadoEnsayoTipo) {
            showToast("error", "Seleccioná un tipo de ensayo");
            return;
        }
        if (!fechaEnsayo) {
            showToast("error", "La fecha de ensayo es requerida");
            return;
        }

        // Build resultado
        let resultado = null;
        if (isGranulometria) {
            // Build tamices with all 3 pct fields
            const fullTamices = (granuloFormValues.tamices || []).map((t) => ({
                tamiz: t.tamiz,
                aberturaMm: t.aberturaMm,
                habilitado: t.habilitado,
                pasaPct: t.pasaPct !== null && t.pasaPct !== undefined && t.pasaPct !== "" ? Number(t.pasaPct) : null,
                retenidoParcialPct: t.retenidoParcialPct !== null && t.retenidoParcialPct !== undefined && t.retenidoParcialPct !== "" ? Number(t.retenidoParcialPct) : null,
                retenidoAcumPct: t.retenidoAcumPct !== null && t.retenidoAcumPct !== undefined && t.retenidoAcumPct !== "" ? Number(t.retenidoAcumPct) : null,
            }));
            const puntos = fullTamices
                .filter((t) => t.habilitado && t.pasaPct !== null)
                .map((t) => ({ aberturaMm: t.aberturaMm, pasaPct: t.pasaPct, tamiz: t.tamiz }));
            resultado = {
                granulometria: {
                    serieTamices: granuloFormValues.serieTamices,
                    tipoAgregado: granuloFormValues.tipoAgregado,
                    metodoInforme: granuloFormValues.metodoInforme || "PASA",
                    tamices: fullTamices,
                    puntos,
                    idCurvaObjetivo: idCurvaObjetivo || undefined,
                    idCurvaTeorica: idCurvaTeorica || undefined,
                    // Persist evaluation result and objetivo (banda compuesta)
                    ...(evalResult ? { evaluacion: evalResult, objetivo: evalResult.objetivo || undefined } : {}),
                },
            };
        } else if (isDerivado) {
            // Derivados: no manual resultado (computed server-side)
            resultado = null;
        } else if (formSpec?.modo === "GENERIC") {
            // Use genericResultado from EnsayoTipoForm
            const hasValues = Object.values(genericResultado).some((v) => v != null && v !== "");
            resultado = hasValues ? { ...genericResultado } : null;
        } else if (resultadoJson.trim()) {
            try {
                resultado = JSON.parse(resultadoJson);
            } catch {
                showToast("error", "El campo resultado no es JSON válido");
                return;
            }
        }

        // Client-side validation
        if (resultado && selectedTipo?.codigo) {
            const clientErrors = validateResultadoClient(selectedTipo.codigo, resultado, formSpec);
            if (clientErrors.length > 0) {
                setSaveErrors(clientErrors);
                return;
            }
        }

        const payload = {
            legacyAgregadoId: Number(legacyAgregadoId),
            idAgregadoEnsayoTipo,
            fechaEnsayo: fechaEnsayo.toISOString().slice(0, 10),
            fechaMuestreo: fechaMuestreo ? fechaMuestreo.toISOString().slice(0, 10) : null,
            laboratorio: laboratorio || null,
            nroInforme: nroInforme || null,
            observaciones: observaciones || null,
            cumple,
            resultado,
            // Contexto del ensayo (HORMIGON / TBS / AMBOS). Solo aplica a
            // granulometría — el backend ignora el campo para otros tipos.
            // Si el usuario no lo cambió, el backend lo deriva de aptitudes.
            contextoAplicacion: isGranulometria
                ? (granuloFormValues.contextoAplicacion || undefined)
                : undefined,
            // Huso DNV de referencia (opcional). Solo aplica a granulometría con
            // contexto TBS/AMBOS; si está seteado, el backend auto-evalúa y setea
            // `cumple`. Se envía también cuando es null para permitir desasociar.
            idHusoDnvReferencia: isGranulometria
                && ['TBS', 'AMBOS'].includes(granuloFormValues.contextoAplicacion)
                ? (granuloFormValues.idHusoDnvReferencia ?? null)
                : null,
            // fechaVencimiento se calcula automáticamente en el backend
        };

        try {
            savingRef.current = true;
            setSaving(true);
            if (isEdit) {
                await updateEnsayo(ensayo.idAgregadoEnsayo, payload);
                showToast("success", "Ensayo actualizado");
            } else {
                await createEnsayo(payload);
                showToast("success", "Ensayo creado");
            }
            onSaved?.();
            onHide();
        } catch (err) {
            console.error(err);
            const errData = err.response?.data;
            if (err.response?.status === 400 && errData) {
                const msgs = [];
                if (errData.error) msgs.push(errData.error);
                if (errData.errors && Array.isArray(errData.errors)) {
                    errData.errors.forEach((e) => msgs.push(typeof e === "string" ? e : JSON.stringify(e)));
                }
                setSaveErrors(msgs.length > 0 ? msgs : ["Error de validación"]);
            } else {
                showToast("error", errData?.error || "Error al guardar ensayo");
            }
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // ─── Render ─────────────────────────────────────────────
    const footer = isDerivado && !isEdit ? (
        // Derivado new: cannot create manually
        <div className="flex justify-content-end gap-2">
            <Button label="Cerrar" icon="fa-solid fa-xmark" severity="secondary" rounded size="small" onClick={onHide} />
        </div>
    ) : isDerivado && isEdit ? (
        // Derivado edit: read-only, close only
        <div className="flex justify-content-end gap-2">
            <Button label="Cerrar" icon="fa-solid fa-xmark" severity="secondary" rounded size="small" onClick={onHide} />
        </div>
    ) : (
        <div className="flex justify-content-end gap-2">
            <Button label={readOnly ? "Cerrar" : "Cancelar"} icon="fa-solid fa-xmark" severity="secondary" rounded size="small" onClick={onHide} />
            {!readOnly && <Button label={isEdit ? "Guardar" : "Crear"} icon="fa-solid fa-check" rounded size="small" loading={saving} disabled={saving} onClick={guardar} />}
        </div>
    );

    // Build evaluation table data from evalResult
    const evalTableData = useMemo(() => {
        if (!evalResult?.series) return [];
        const { medida, bandaMin, bandaMax } = evalResult.series;

        // Build lookup maps
        const medMap = new Map();
        for (const pt of (medida || [])) {
            medMap.set(String(pt.aberturaMm), pt.pasaPct);
        }
        const minMap = new Map();
        for (const pt of (bandaMin || [])) {
            minMap.set(String(pt.aberturaMm), pt.pasaPct);
        }
        const maxMap = new Map();
        for (const pt of (bandaMax || [])) {
            maxMap.set(String(pt.aberturaMm), pt.pasaPct);
        }

        // Collect all aberturas from band
        const allAberturas = new Set([
            ...(bandaMin || []).map(p => p.aberturaMm),
            ...(bandaMax || []).map(p => p.aberturaMm),
        ]);

        // Build fueraDeBanda lookup
        const fueraMap = new Map();
        for (const fb of (evalResult.fueraDeBanda || [])) {
            fueraMap.set(String(fb.aberturaMm), fb);
        }
        const faltMap = new Map();
        for (const f of (evalResult.faltantes || [])) {
            faltMap.set(String(f.aberturaMm), f);
        }

        return [...allAberturas]
            .sort((a, b) => b - a)
            .map((abMm) => {
                const key = String(abMm);
                const medido = medMap.get(key);
                const limInf = minMap.get(key);
                const limSup = maxMap.get(key);
                const fb = fueraMap.get(key);
                const falt = faltMap.get(key);

                let estado = "OK";
                if (falt) estado = "N/A";
                else if (fb) estado = "FUERA";

                return {
                    tamiz: fb?.tamiz || falt?.tamiz || `${abMm} mm`,
                    aberturaMm: abMm,
                    pasaPct: medido != null ? medido : null,
                    limInfPct: limInf != null ? limInf : null,
                    limSupPct: limSup != null ? limSup : null,
                    estado,
                    deltaMin: fb?.deltaMin,
                    deltaMax: fb?.deltaMax,
                };
            });
    }, [evalResult]);

    // Chart data (medida + banda curves)
    const evalChartData = useMemo(() => {
        if (!evalResult?.series) return null;

        const medida = evalResult?.series?.medida;
        const bandaMin = evalResult?.series?.bandaMin;
        const bandaMax = evalResult?.series?.bandaMax;

        const datasets = [];

        // Derive legend labels using actual curve letters when available
        const maxLetter = evalResult?.objetivo?.curvaMax?.curveLetter;
        const minLetter = evalResult?.objetivo?.curvaMin?.curveLetter;

        // Banda: upper limit (red)
        if (bandaMax?.length > 0) {
            datasets.push({
                label: maxLetter ? `Curva ${maxLetter}` : 'Límite superior',
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

        // Banda: lower limit (green)
        if (bandaMin?.length > 0) {
            datasets.push({
                label: minLetter ? `Curva ${minLetter}` : 'Límite inferior',
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

        // Banda: middle curve (e.g. curve B in A-B-C)
        const bandaMid = evalResult?.series?.bandaMid;
        if (bandaMid?.length > 0) {
            const midLetter = evalResult?.objetivo?.curvaMiddle?.curveLetter || '?';
            datasets.push({
                label: `Curva ${midLetter}`,
                data: bandaMid.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
                borderColor: "rgba(245,158,11,0.7)",
                backgroundColor: "transparent",
                borderWidth: 1.5,
                borderDash: [3, 3],
                pointRadius: 2,
                pointBackgroundColor: "rgba(245,158,11,0.7)",
                fill: false,
                tension: 0,
                order: 2,
            });
        }

        // Medida (interpolated on band grid)
        if (medida?.length > 0) {
            datasets.push({
                label: "Medida",
                data: medida.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
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

        return { datasets };
    }, [evalResult, curvasCatalogo, idCurvaObjetivo]);

    const evalIsFineScale = usoFiltro === 'FINO' || usoFiltro === 'TOTAL';

    // Compute dynamic X bounds from actual chart data
    const evalXBounds = useMemo(() => {
        if (!evalChartData?.datasets?.length) {
            return evalIsFineScale ? { min: 0.1, max: 12 } : { min: 0.05, max: 100 };
        }
        let dataMin = Infinity;
        let dataMax = -Infinity;
        for (const ds of evalChartData.datasets) {
            for (const pt of (ds.data || [])) {
                if (pt.x > 0) {
                    if (pt.x < dataMin) dataMin = pt.x;
                    if (pt.x > dataMax) dataMax = pt.x;
                }
            }
        }
        if (!isFinite(dataMin)) {
            return evalIsFineScale ? { min: 0.1, max: 12 } : { min: 0.05, max: 100 };
        }
        // Add margin: ~half order of magnitude below/above
        const min = Math.max(0.01, dataMin / 2);
        const max = dataMax * 1.5;
        return { min, max };
    }, [evalChartData, evalIsFineScale]);

    const evalChartOptions = useMemo(
        () => ({
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: false },
            scales: {
                x: {
                    type: "logarithmic",
                    title: { display: true, text: "Abertura (mm)", font: { size: 11, weight: "bold" } },
                    min: evalXBounds.min,
                    max: evalXBounds.max,
                    ticks: {
                        callback: (val) => {
                            const labels = evalIsFineScale
                                ? [0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5]
                                : [0.075, 0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 12.5, 19, 25, 37.5, 50, 75];
                            if (labels.some((l) => Math.abs(val - l) < 0.001)) return val;
                            return "";
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
                },
            },
        }),
        [evalIsFineScale, evalXBounds]
    );
    const ajusteChartData = useMemo(() => {
        if (!ajusteResult?.series) return null;
        const { medida, curvaRef } = ajusteResult.series;
        if (!medida?.length && !curvaRef?.length) return null;

        const curvaTeo = curvasCatalogo.find((c) => c.idCurva === idCurvaTeorica);
        const teoNombre = curvaTeo?.nombre || ajusteResult?.curva?.nombre || 'Curva teórica';

        const datasets = [];

        // Curva teórica de referencia
        if (curvaRef?.length > 0) {
            datasets.push({
                label: teoNombre,
                data: curvaRef.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
                borderColor: "rgba(234,88,12,0.7)",
                backgroundColor: "transparent",
                borderWidth: 2,
                borderDash: [6, 3],
                pointRadius: 3,
                pointBackgroundColor: "rgba(234,88,12,0.7)",
                pointBorderColor: "#fff",
                pointBorderWidth: 1,
                fill: false,
                tension: 0,
                order: 2,
            });
        }

        // Muestra
        if (medida?.length > 0) {
            datasets.push({
                label: "Muestra",
                data: medida.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
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

        return { datasets };
    }, [ajusteResult, curvasCatalogo, idCurvaTeorica]);

    // Need to import Chart for the eval overlay
    const ChartComponent = useMemo(() => {
        try {
            // eslint-disable-next-line
            require("chart.js/auto");
            const { Chart: PrimeChart } = require("primereact/chart");
            return PrimeChart;
        } catch {
            return null;
        }
    }, []);

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header={readOnly ? "Ver ensayo" : isEdit ? "Editar ensayo" : "Nuevo ensayo"}
            footer={footer}
            className={isGranulometria ? "w-12 xl:w-10" : formSpec?.modo === "GENERIC" ? "w-12 xl:w-8" : "w-11 xl:w-6"}
            modal
            dismissableMask
        >
            {/* Validation / save errors panel */}
            {saveErrors.length > 0 && (
                <div className="border-round border-1 border-red-400 bg-red-900 p-3 mb-3">
                    <div className="flex align-items-center gap-2 mb-2">
                        <i className="fa-solid fa-circle-xmark text-red-300" />
                        <span className="font-semibold text-sm text-red-300">Errores de validaci\u00f3n</span>
                    </div>
                    {saveErrors.map((msg, i) => (
                        <div key={i} className="mb-1 p-2 border-round bg-red-800 text-red-100 flex align-items-center gap-2 text-xs">
                            <i className="fa-solid fa-circle-xmark text-red-300 text-xs flex-shrink-0" />
                            {msg}
                        </div>
                    ))}
                </div>
            )}

            <div className="grid">
                {/* Tipo */}
                <div className="col-12 md:col-6">
                    <label className="block font-bold mb-1">Tipo de ensayo *</label>
                    <Dropdown
                        value={idAgregadoEnsayoTipo}
                        onChange={(e) => setIdAgregadoEnsayoTipo(e.value)}
                        options={tipos
                            .filter((t) => !t.esDerivado)
                            .map((t) => ({
                                label: `${t.nombre} (${t.normaRef || "—"})`,
                                value: t.idAgregadoEnsayoTipo,
                            }))}
                        placeholder="Seleccionar tipo"
                        className="w-full"
                        filter
                        disabled={isEdit}
                        itemTemplate={(option) => (
                            <div
                                className="white-space-normal line-height-3 text-sm"
                                title={option.label}
                                style={{ maxWidth: "100%" }}
                            >
                                {option.label}
                            </div>
                        )}
                    />
                    {!isEdit && (
                        <div className="flex align-items-center gap-2 mt-1">
                            <Checkbox
                                inputId="showAvanzados"
                                checked={showAvanzados}
                                onChange={(e) => setShowAvanzados(e.checked)}
                            />
                            <label htmlFor="showAvanzados" className="text-xs text-500 cursor-pointer">
                                Mostrar ensayos avanzados
                            </label>
                        </div>
                    )}
                </div>

                {/* Fecha ensayo */}
                <div className="col-12 sm:col-6 lg:col-3">
                    <label className="block font-bold mb-1">Fecha ensayo *</label>
                    <Calendar
                        value={fechaEnsayo}
                        onChange={(e) => setFechaEnsayo(e.value)}
                        dateFormat="dd/mm/yy"
                        className="w-full"
                        showIcon
                    />
                </div>

                {/* Fecha muestreo */}
                <div className="col-12 sm:col-6 lg:col-3">
                    <label className="block font-bold mb-1">Fecha muestreo</label>
                    <Calendar
                        value={fechaMuestreo}
                        onChange={(e) => setFechaMuestreo(e.value)}
                        dateFormat="dd/mm/yy"
                        className="w-full"
                        showIcon
                    />
                </div>

                {/* Laboratorio */}
                <div className="col-12 sm:col-6 lg:col-4">
                    <label className="block font-bold mb-1">Laboratorio</label>
                    <InputText value={laboratorio} onChange={(e) => setLaboratorio(e.target.value)} className="w-full" />
                </div>

                {/* Nro informe */}
                <div className="col-12 sm:col-6 lg:col-4">
                    <label className="block font-bold mb-1">N.º informe</label>
                    <InputText value={nroInforme} onChange={(e) => setNroInforme(e.target.value)} className="w-full" />
                </div>

                {/* Cumple (auto-evaluado, solo lectura) */}
                <div className="col-12 sm:col-6 lg:col-4">
                    <label className="block font-bold mb-1">Resultado</label>
                    {(() => {
                        const categoria = categoriaDeCumpleLegacy(cumple);
                        const cfg = CATEGORIA_COLORS[categoria];
                        const evalMsg = genericResultado?._evaluacion?.mensaje || ensayo?.resultado?._evaluacion?.mensaje || null;
                        return (
                            <div className="p-2 border-round surface-100" style={{ minHeight: '2.5rem' }}>
                                <div className="flex align-items-center gap-2">
                                    <i className={cfg.icon} style={{ color: cfg.hex }} />
                                    <Tag value={categoria} severity={cfg.severity} />
                                    <small className="text-color-secondary">(automático)</small>
                                </div>
                                {evalMsg && <small className="block text-xs text-color-secondary mt-1">{evalMsg}</small>}
                            </div>
                        );
                    })()}
                </div>

                {/* Fecha vencimiento — se calcula automáticamente según periodicidad del ensayo */}

                {/* Observaciones */}
                <div className="col-12 md:col-8">
                    <label className="block font-bold mb-1">Observaciones</label>
                    <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full" rows={2} autoResize />
                </div>

                {/* ─── Resultado ─────────────────────────────── */}
                {isGranulometria ? (
                    <div className="col-12">
                        <label className="block font-bold mb-2">
                            <i className="fa-solid fa-chart-line mr-2" />
                            Granulometría
                        </label>
                        <GranulometriaEditor
                            formValues={granuloFormValues}
                            onFormChange={setGranuloFormValues}
                            saving={saving}
                            onSave={() => {}}
                            isRevisado={false}
                            embeddedInEnsayoForm
                            defaultTipoAgregado={defaultUsoAgregado}
                        />

                        {/* ─── Incompatibility warning ─── */}
                        {curvasWarning && (
                            <div className="mt-2 p-2 border-round surface-100 border-1 border-yellow-300 flex align-items-center gap-2">
                                <i className="fa-solid fa-triangle-exclamation text-yellow-600 text-sm" />
                                <span className="text-sm text-yellow-700">{curvasWarning}</span>
                                <Button
                                    icon="fa-solid fa-xmark"
                                    className="p-button-text p-button-sm p-button-rounded ml-auto"
                                    style={{ width: "1.5rem", height: "1.5rem" }}
                                    onClick={() => setCurvasWarning(null)}
                                />
                            </div>
                        )}

                        {/* ════════════════════════════════════════════
                            SECCIÓN 2: Ajuste a curva teórica (solo MEZCLA/TOTAL)
                            ════════════════════════════════════════════ */}
                        {curvaTeoricaOptions.length > 0 && granuloFormValues.tipoAgregado && !['FINO','GRUESO'].includes(granuloFormValues.tipoAgregado.toUpperCase()) && (
                        <div className="surface-ground border-round p-3 mt-3">
                            <h5 className="mt-0 mb-2">
                                <i className="fa-solid fa-chart-line mr-2 text-orange-500" />
                                Ajuste a curva teórica (biblioteca)
                            </h5>
                            <small className="text-color-secondary block mb-2">
                                Compara la muestra contra una curva teórica (Fuller, Andreasen, etc.). Métricas de ajuste — sin cumple/no cumple.
                            </small>
                            <div className="grid">
                                <div className="col-12 md:col-10">
                                    <label className="block text-sm font-semibold mb-1">Curva teórica</label>
                                    <Dropdown
                                        value={idCurvaTeorica}
                                        onChange={(e) => {
                                            setIdCurvaTeorica(e.value);
                                            setAjusteResult(null);
                                        }}
                                        options={curvaTeoricaOptions}
                                        itemTemplate={curvaItemTemplate}
                                        placeholder={loadingCurvas ? "Cargando curvas..." : "Seleccionar curva teórica"}
                                        className="w-full"
                                        filter
                                        showClear
                                        loading={loadingCurvas}
                                        disabled={loadingCurvas}
                                    />
                                </div>
                                <div className="col-12 sm:col-6 lg:col-2 flex align-items-end">
                                    <Button
                                        label="Ajustar"
                                        icon="fa-solid fa-ruler-combined"
                                        size="small"
                                        rounded
                                        outlined
                                        severity="warning"
                                        className="w-full"
                                        loading={evaluatingTeorica}
                                        disabled={!idCurvaTeorica || evaluatingTeorica}
                                        onClick={doAjusteTeorico}
                                    />
                                </div>
                            </div>

                            {/* ─── Ajuste teórico result ─── */}
                            {ajusteResult && (
                                <div className="mt-3">
                                    {/* Métricas de ajuste */}
                                    <div className="surface-100 border-round p-2 mb-2">
                                        <div className="flex align-items-center gap-2 mb-2">
                                            <i className="fa-solid fa-ruler-combined text-orange-500 text-sm" />
                                            <span className="font-semibold text-sm">Métricas de ajuste</span>
                                            {ajusteResult.curva && (
                                                <span className="text-xs text-color-secondary ml-2">
                                                    ({ajusteResult.curva.nombre})
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-3">
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">MAE</span>
                                                <span className="font-bold text-lg text-orange-600">{ajusteResult.mae != null ? ajusteResult.mae.toFixed(2) : "—"}</span>
                                                <span className="text-xs text-400">%</span>
                                            </div>
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">RMSE</span>
                                                <span className="font-bold text-lg text-orange-600">{ajusteResult.rmse != null ? ajusteResult.rmse.toFixed(2) : "—"}</span>
                                                <span className="text-xs text-400">%</span>
                                            </div>
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">R²</span>
                                                <span className="font-bold text-lg text-primary">{ajusteResult.r2 != null ? ajusteResult.r2.toFixed(4) : "—"}</span>
                                            </div>
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">Máx. desvío</span>
                                                <span className="font-bold text-lg text-red-500">{ajusteResult.maxDesvio != null ? ajusteResult.maxDesvio.toFixed(2) : "—"}</span>
                                                <span className="text-xs text-400">%</span>
                                            </div>
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">Σ|error|</span>
                                                <span className="font-bold text-lg text-600">{ajusteResult.sumaAbs != null ? ajusteResult.sumaAbs.toFixed(2) : "—"}</span>
                                                <span className="text-xs text-400">%</span>
                                            </div>
                                            <div className="flex flex-column align-items-center surface-card border-round p-2" style={{ minWidth: "80px" }}>
                                                <span className="text-xs text-600">Tamices</span>
                                                <span className="font-bold text-lg text-600">{ajusteResult.cantidadComparados ?? "—"}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Calculos derivados: MF y TMN */}
                                    {ajusteResult.calculos && (
                                        <div className="surface-100 border-round p-2 mb-2 flex align-items-center gap-4 flex-wrap">
                                            <div className="flex align-items-center gap-2">
                                                <i className="fa-solid fa-calculator text-primary text-sm" />
                                                <span className="font-semibold text-sm">Calculados:</span>
                                            </div>
                                            <div className="flex align-items-center gap-2">
                                                <span className="text-sm text-600">MF:</span>
                                                <span className="font-bold text-primary">
                                                    {ajusteResult.calculos.moduloFinura?.valor != null
                                                        ? ajusteResult.calculos.moduloFinura.valor.toFixed(2)
                                                        : "—"}
                                                </span>
                                                {ajusteResult.calculos.moduloFinura && !ajusteResult.calculos.moduloFinura.completo && (
                                                    <Tag value="parcial" severity="warning" className="text-xs" style={{ fontSize: "0.6rem", padding: "0 3px" }} />
                                                )}
                                            </div>
                                            {usoFiltro !== 'FINO' && (
                                            <div className="flex align-items-center gap-2">
                                                <span className="text-sm text-600">TMN:</span>
                                                <span className="font-bold text-primary">
                                                    {ajusteResult.calculos.tmn?.valor != null
                                                        ? `${ajusteResult.calculos.tmn.valor} mm`
                                                        : "—"}
                                                </span>
                                                {ajusteResult.calculos.tmn?.tamiz && (
                                                    <span className="text-xs text-500">({ajusteResult.calculos.tmn.tamiz})</span>
                                                )}
                                            </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="grid">
                                        {/* Worst sieves table */}
                                        <div className={`col-12 ${ajusteChartData ? "lg:col-6" : ""}`}>
                                            <div className="text-sm font-semibold mb-1">Peores tamices</div>
                                            <DataTable responsiveLayout="scroll"
                                                value={ajusteResult.worstSieves || []}
                                                size="small"
                                                stripedRows
                                                scrollable
                                                scrollHeight="250px"
                                                emptyMessage="Sin datos"
                                                className="text-sm"
                                            >
                                                <Column header="Tamiz" field="tamiz" style={{ width: "90px" }} />
                                                <Column
                                                    header="Muestra"
                                                    body={(row) => row.pasaPctMuestra != null ? row.pasaPctMuestra.toFixed(1) : "—"}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="Teórica"
                                                    body={(row) => row.pasaPctCurva != null ? row.pasaPctCurva.toFixed(1) : "—"}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="Error"
                                                    body={(row) => (
                                                        <span className={row.errorAbs > 5 ? "text-red-500 font-semibold" : ""}>
                                                            {row.error != null ? `${row.error > 0 ? "+" : ""}${row.error.toFixed(2)}` : "—"}
                                                        </span>
                                                    )}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="|Error|"
                                                    body={(row) => (
                                                        <span className={row.errorAbs > 5 ? "text-red-500 font-bold" : "font-semibold"}>
                                                            {row.errorAbs != null ? row.errorAbs.toFixed(2) : "—"}
                                                        </span>
                                                    )}
                                                    style={{ width: "70px" }}
                                                />
                                            </DataTable>
                                            {ajusteResult.observaciones?.length > 0 && (
                                                <div className="mt-2">
                                                    {ajusteResult.observaciones.map((obs, i) => (
                                                        <div key={i} className="text-xs text-orange-600 flex align-items-center gap-1 mt-1">
                                                            <i className="fa-solid fa-circle-info text-xs" />
                                                            {obs}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {/* Ajuste chart */}
                                        {ajusteChartData && ChartComponent && (
                                            <div className="col-12 lg:col-6">
                                                <div style={{ height: "clamp(200px, 40vh, 280px)" }}>
                                                    <ChartComponent
                                                        type="line"
                                                        data={ajusteChartData}
                                                        options={evalChartOptions}
                                                        style={{ height: "100%", width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* ════════════════════════════════════════════
                            SECCIÓN 2b: Resultado de evaluación automática (solo FINO)
                            ════════════════════════════════════════════ */}
                        {granuloFormValues.tipoAgregado?.toUpperCase() === 'FINO' && (
                        <div className="surface-ground border-round p-3 mt-3">
                            <h5 className="mt-0 mb-2">
                                <i className="fa-solid fa-check-double mr-2 text-blue-500" />
                                Evaluación granulométrica (automática)
                            </h5>
                            <small className="text-color-secondary block mb-3">
                                Al guardar, el sistema evalúa automáticamente contra las bandas A-B y A-C (IRAM 1627) y las reglas CIRSOC 200-2024 §3.2.3.2.
                            </small>
                            {(() => {
                                const ea = freshEnsayo?.resultado?.granulometria?.evaluacionAuto || ensayo?.resultado?.granulometria?.evaluacionAuto || genericResultado?.granulometria?.evaluacionAuto;
                                if (!ea) return <p className="text-color-secondary text-sm m-0">Guarde el ensayo para ver la evaluación automática.</p>;
                                const rg = ea.resultadoGlobal || {};
                                const statusIcon = (st) => {
                                    const cfg = CATEGORIA_COLORS[categoriaDeEstadoGranulometria(st)];
                                    return <i className={`${cfg.icon} mr-1`} style={{ color: cfg.hex }} />;
                                };

                                // Helper to build chart data for a band evaluation
                                const buildBandChart = (bandaEval, bandaName, colorBand) => {
                                    if (!bandaEval?.detalle?.length) return null;
                                    const labels = bandaEval.detalle.map(d => d.aberturaMm < 1 ? `${d.aberturaMm}` : `${d.aberturaMm}`);
                                    const xVals = bandaEval.detalle.map(d => d.aberturaMm);
                                    return {
                                        labels: xVals,
                                        datasets: [
                                            {
                                                label: 'Medida',
                                                data: bandaEval.detalle.map(d => d.pasa),
                                                borderColor: '#3B82F6',
                                                backgroundColor: '#3B82F6',
                                                pointRadius: 5,
                                                pointBackgroundColor: bandaEval.detalle.map(d => d.estado === 'FUERA' ? '#EF4444' : '#22C55E'),
                                                pointBorderColor: bandaEval.detalle.map(d => d.estado === 'FUERA' ? '#EF4444' : '#22C55E'),
                                                tension: 0,
                                                fill: false,
                                                borderWidth: 2,
                                            },
                                            {
                                                label: `Lím. sup. (Curva ${bandaName.split('-')[1]})`,
                                                data: bandaEval.detalle.map(d => d.limSup),
                                                borderColor: colorBand,
                                                borderDash: [6, 3],
                                                pointRadius: 0,
                                                tension: 0,
                                                fill: false,
                                                borderWidth: 1.5,
                                            },
                                            {
                                                label: 'Lím. inf. (Curva A)',
                                                data: bandaEval.detalle.map(d => d.limInf),
                                                borderColor: '#22C55E',
                                                borderDash: [6, 3],
                                                pointRadius: 0,
                                                tension: 0,
                                                fill: '-1',
                                                backgroundColor: 'rgba(34,197,94,0.15)',
                                                borderWidth: 1.5,
                                            },
                                        ],
                                    };
                                };

                                const chartOpts = {
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 12, font: { size: 10 }, color: '#9CA3AF' } } },
                                    scales: {
                                        x: { type: 'logarithmic', title: { display: true, text: 'Abertura (mm)', color: '#9CA3AF', font: { size: 10 } }, ticks: { color: '#9CA3AF', font: { size: 9 }, callback: (v) => v < 1 ? v.toFixed(2) : v }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                        y: { min: 0, max: 100, title: { display: true, text: '% Pasa', color: '#9CA3AF', font: { size: 10 } }, ticks: { color: '#9CA3AF', font: { size: 9 }, stepSize: 10 }, grid: { color: 'rgba(255,255,255,0.08)' } },
                                    },
                                };

                                const abChartData = buildBandChart(ea.bandaAB, 'A-B', '#EF4444');
                                const acChartData = buildBandChart(ea.bandaAC, 'A-C', '#F59E0B');

                                return (
                                    <div className="flex flex-column gap-3">
                                        {/* Band charts side by side */}
                                        <div className="grid">
                                            {/* Band A-B chart */}
                                            <div className="col-12 md:col-6">
                                                <div className="surface-100 border-round p-2 h-full">
                                                    <div className="flex align-items-center mb-2">
                                                        {statusIcon(rg.bandaAB)}
                                                        <strong className="text-sm">Banda A-B</strong>
                                                        <span className="text-color-secondary text-xs ml-2">
                                                            {categoriaDeEstadoGranulometria(rg.bandaAB)}
                                                            {ea.bandaAB?.fueraDeBanda > 0 && ` — ${ea.bandaAB.fueraDeBanda} fuera, desvío ${ea.bandaAB.peorDesvio} pp`}
                                                        </span>
                                                    </div>
                                                    {abChartData && <div style={{position:'relative', width:'100%', height: 'clamp(200px, 40vh, 300px)'}}><Chart type="line" data={abChartData} options={chartOpts} style={{position:'absolute', top:0, left:0, width:'100%', height:'100%'}} /></div>}
                                                </div>
                                            </div>

                                            {/* Band A-C chart */}
                                            <div className="col-12 md:col-6">
                                                <div className="surface-100 border-round p-2 h-full">
                                                    <div className="flex align-items-center mb-2">
                                                        {statusIcon(rg.bandaAC)}
                                                        <strong className="text-sm">Banda A-C</strong>
                                                        <span className="text-color-secondary text-xs ml-2">
                                                            {categoriaDeEstadoGranulometria(rg.bandaAC)}
                                                            {rg.bandaAC === 'cumple' && ' (restricción: solo H <= 20)'}
                                                        </span>
                                                    </div>
                                                    {acChartData && <div style={{position:'relative', width:'100%', height: 'clamp(200px, 40vh, 300px)'}}><Chart type="line" data={acChartData} options={chartOpts} style={{position:'absolute', top:0, left:0, width:'100%', height:'100%'}} /></div>}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Additional rules */}
                                        <div className="flex flex-column gap-1 text-sm">
                                            <div>{statusIcon(rg.mf)} <strong>Módulo de finura:</strong> {ea.moduloFinura?.valor != null ? ea.moduloFinura.valor.toFixed(2) : '—'} <span className="text-color-secondary">(req. 2,3 a 3,1)</span></div>
                                            {ea.tolerancia10pp?.aplica && (
                                                <div>{statusIcon(ea.tolerancia10pp.cumple ? 'cumple' : 'no_cumple')} <strong>Tolerancia 10 pp sobre Curva B:</strong> {ea.tolerancia10pp.excesoTotal} pp <span className="text-color-secondary">(max. 10 pp)</span></div>
                                            )}
                                            <div>{statusIcon(rg.fraccion)} <strong>Fracción máx. entre tamices:</strong> {ea.fraccionMaxima?.peorValor != null ? `${ea.fraccionMaxima.peorValor}%` : '—'} {ea.fraccionMaxima?.peorEntre && <span className="text-color-secondary">({ea.fraccionMaxima.peorEntre}, req. &le; 45%)</span>}</div>
                                        </div>

                                        {ea.implicancias && <div className="p-2 surface-100 border-round text-xs" style={{whiteSpace:'pre-line'}}>{ea.implicancias}</div>}
                                    </div>
                                );
                            })()}
                        </div>
                        )}

                        {/* ════════════════════════════════════════════
                            SECCIÓN 3: Inserción en bandas (oculto para FINO — evaluación automática)
                            ════════════════════════════════════════════ */}
                        {(curvaBandaOptions.length > 0 || bandaCompuestaOptions.length > 0) && granuloFormValues.tipoAgregado?.toUpperCase() !== 'FINO' && (
                        <div className="surface-ground border-round p-3 mt-3">
                            <h5 className="mt-0 mb-2">
                                <i className="fa-solid fa-bullseye mr-2 text-blue-500" />
                                Inserción en bandas
                            </h5>
                            <small className="text-color-secondary block mb-2">
                                Evalúa la muestra contra la envolvente de una banda normativa. Resultado: CUMPLE / NO CUMPLE.
                            </small>
                            <div className="grid">
                                <div className="col-12 md:col-8">
                                    <label className="block text-sm font-semibold mb-1">Banda de referencia</label>
                                    {bandaCompuestaOptions.length > 0 ? (
                                        <Dropdown
                                            value={selectedBandaCompuesta?._key || null}
                                            onChange={(e) => {
                                                const opt = bandaCompuestaOptions.find((o) => o.value === e.value);
                                                if (opt) {
                                                    setSelectedBandaCompuesta({ idCurvaMin: opt.idCurvaMin, idCurvaMax: opt.idCurvaMax, idCurvaMiddle: opt.idCurvaMiddle || null, label: opt.label, _key: opt.value });
                                                    setIdCurvaObjetivo(null);
                                                } else {
                                                    setSelectedBandaCompuesta(null);
                                                }
                                                setEvalResult(null);
                                            }}
                                            options={bandaCompuestaOptions}
                                            placeholder={loadingCurvas ? "Cargando curvas..." : "Seleccionar banda compuesta"}
                                            className="w-full"
                                            filter
                                            showClear
                                            loading={loadingCurvas}
                                            disabled={loadingCurvas}
                                        />
                                    ) : (
                                        <Dropdown
                                            value={idCurvaObjetivo}
                                            onChange={(e) => {
                                                const newId = e.value;
                                                setIdCurvaObjetivo(newId);
                                                setSelectedBandaCompuesta(null);
                                                setEvalResult(null);
                                            }}
                                            options={curvaBandaOptions}
                                            itemTemplate={curvaItemTemplate}
                                            placeholder={loadingCurvas ? "Cargando curvas..." : "Seleccionar banda"}
                                            className="w-full"
                                            filter
                                            showClear
                                            loading={loadingCurvas}
                                            disabled={loadingCurvas}
                                        />
                                    )}
                                </div>
                                <div className="col-12 sm:col-6 lg:col-2 flex align-items-end">
                                    <Button
                                        label="Evaluar"
                                        icon="fa-solid fa-magnifying-glass-chart"
                                        size="small"
                                        rounded
                                        outlined
                                        className="w-full"
                                        loading={evaluating}
                                        disabled={(!idCurvaObjetivo && !selectedBandaCompuesta) || evaluating}
                                        onClick={doEvaluar}
                                    />
                                </div>

                            </div>

                            {/* ─── Evaluation result ─── */}
                            {evalResult && (
                                <div className="mt-3">
                                    {/* Summary bar */}
                                    <div className="flex align-items-center gap-3 mb-2 flex-wrap">
                                        {(() => {
                                            // evalResult.estado del servicio de evaluación de bandas:
                                            // "CUMPLE" → APTO; "INCOMPLETO" → EVALUACIÓN INCOMPLETA;
                                            // cualquier otro estado presente → NO APTO. Sin estado, fallback al boolean.cumple.
                                            const cat = evalResult.estado === "CUMPLE"     ? VEREDICTO.APTO
                                                      : evalResult.estado === "INCOMPLETO" ? VEREDICTO.EVALUACION_INCOMPLETA
                                                      : evalResult.estado                  ? VEREDICTO.NO_APTO
                                                      : categoriaDeBoolean(evalResult.cumple);
                                            const cfg = CATEGORIA_COLORS[cat];
                                            return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} className="text-sm" />;
                                        })()}
                                        {evalResult.stats && (
                                            <span className="text-sm text-color-secondary">
                                                Evaluados: {evalResult.stats.nTamices}
                                                {evalResult.stats.nFuera > 0 && (
                                                    <span className="text-red-500 font-semibold ml-2">
                                                        Fuera de banda: {evalResult.stats.nFuera}
                                                    </span>
                                                )}
                                                {evalResult.stats.peorDesvioPct > 0 && (
                                                    <span className="text-orange-500 ml-2">
                                                        (peor desvío: {evalResult.stats.peorDesvioPct}%)
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                        {evalResult.objetivo && (
                                            <span className="text-xs text-color-secondary">
                                                ({evalResult.objetivo.nombre} — {evalResult.objetivo.normaRef || "sin norma"})
                                            </span>
                                        )}
                                        {evalResult.faltantes?.length > 0 && (
                                            <span className="text-xs text-orange-500">
                                                <i className="fa-solid fa-triangle-exclamation mr-1" />
                                                {evalResult.faltantes.length} tamiz(es) sin dato
                                            </span>
                                        )}
                                    </div>



                                    <div className="grid">
                                        {/* Table */}
                                        <div className={`col-12 ${evalChartData ? "lg:col-6" : ""}`}>
                                            <DataTable responsiveLayout="scroll"
                                                value={evalTableData}
                                                size="small"
                                                stripedRows
                                                scrollable
                                                scrollHeight="300px"
                                                emptyMessage="Sin datos de evaluación"
                                                className="text-sm"
                                            >
                                                <Column
                                                    header="Tamiz"
                                                    field="tamiz"
                                                    style={{ width: "100px" }}
                                                    frozen
                                                />
                                                <Column
                                                    header="% Pasa"
                                                    field="pasaPct"
                                                    body={(row) => row.pasaPct != null ? row.pasaPct.toFixed(1) : "—"}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="Lím. inf."
                                                    field="limInfPct"
                                                    body={(row) => row.limInfPct != null ? row.limInfPct.toFixed(1) : "—"}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="Lím. sup."
                                                    field="limSupPct"
                                                    body={(row) => row.limSupPct != null ? row.limSupPct.toFixed(1) : "—"}
                                                    style={{ width: "70px" }}
                                                />
                                                <Column
                                                    header="Estado"
                                                    body={(row) => {
                                                        // Etiqueta corta por celda (no se reemplaza por la categoría
                                                        // canónica para no saturar la columna), pero la severity
                                                        // viene del mapa canónico.
                                                        if (row.estado === "FUERA") {
                                                            const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APTO];
                                                            return <Tag value="FUERA" severity={cfg.severity} className="text-xs" />;
                                                        }
                                                        if (row.estado === "N/A") {
                                                            const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APLICA];
                                                            return <Tag value="N/A" severity={cfg.severity} className="text-xs" />;
                                                        }
                                                        const cfg = CATEGORIA_COLORS[VEREDICTO.APTO];
                                                        return <Tag value="OK" severity={cfg.severity} className="text-xs" />;
                                                    }}
                                                    style={{ width: "70px" }}
                                                />
                                            </DataTable>
                                        </div>

                                        {/* Chart (shows if eval or additional curves exist) */}
                                        {evalChartData && ChartComponent && (
                                            <div className="col-12 lg:col-6">
                                                <div style={{ height: "clamp(200px, 40vh, 300px)" }}>
                                                    <ChartComponent
                                                        type="line"
                                                        data={evalChartData}
                                                        options={evalChartOptions}
                                                        style={{ height: "100%", width: "100%" }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* ═══ Reglas CIRSOC 200-2024 §3.2.3.2 (solo fino) ═══ */}
                                    {evalResult?.reglasCIRSOC && (
                                        <div className="mt-3 surface-50 border-round p-3">
                                            <div className="flex align-items-center gap-2 mb-2">
                                                <i className="fa-solid fa-clipboard-check text-primary" />
                                                <span className="font-bold text-sm">Verificación CIRSOC 200-2024 §3.2.3.2</span>
                                            </div>

                                            {/* Regla 2 — MF */}
                                            {evalResult.reglasCIRSOC.moduloFinura && (
                                                <div className="flex align-items-center gap-2 py-1 border-bottom-1 surface-border">
                                                    {(() => {
                                                        const cfg = CATEGORIA_COLORS[categoriaDeBoolean(evalResult.reglasCIRSOC.moduloFinura.cumple)];
                                                        return <i className={cfg.icon} style={{ color: cfg.hex }} />;
                                                    })()}
                                                    <span className="text-sm">
                                                        <strong>Módulo de finura:</strong>{" "}
                                                        {evalResult.reglasCIRSOC.moduloFinura.valor != null ? evalResult.reglasCIRSOC.moduloFinura.valor.toLocaleString("es-AR") : "—"}
                                                        <span className="text-color-secondary ml-2">(requerido: 2,3 a 3,1)</span>
                                                    </span>
                                                </div>
                                            )}

                                            {/* Regla 3 — Tolerancia 10pp */}
                                            {evalResult.reglasCIRSOC.tolerancia10pp && (
                                                <div className="py-1 border-bottom-1 surface-border">
                                                    <div className="flex align-items-center gap-2">
                                                        {(() => {
                                                            // .nota presente significa "no aplica para este caso" → INFORMATIVO.
                                                            const cat = evalResult.reglasCIRSOC.tolerancia10pp.nota
                                                                ? VEREDICTO.INFORMATIVO
                                                                : categoriaDeBoolean(evalResult.reglasCIRSOC.tolerancia10pp.cumple);
                                                            const cfg = CATEGORIA_COLORS[cat];
                                                            return <i className={cfg.icon} style={{ color: cfg.hex }} />;
                                                        })()}
                                                        <span className="text-sm">
                                                            <strong>Tolerancia ±10 pp sobre Curva B</strong>
                                                            {evalResult.reglasCIRSOC.tolerancia10pp.nota ? (
                                                                <span className="text-color-secondary ml-2">({evalResult.reglasCIRSOC.tolerancia10pp.nota})</span>
                                                            ) : evalResult.reglasCIRSOC.tolerancia10pp.aplica ? (
                                                                <span className="ml-2">
                                                                    Exceso total: {evalResult.reglasCIRSOC.tolerancia10pp.excesoTotal.toLocaleString("es-AR")} pp
                                                                    <span className="text-color-secondary"> (máx: 10 pp)</span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-color-secondary ml-2">Sin excesos sobre Curva B</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    {evalResult.reglasCIRSOC.tolerancia10pp.detalle?.length > 0 && (
                                                        <div className="ml-4 mt-1">
                                                            {evalResult.reglasCIRSOC.tolerancia10pp.detalle.map((d) => (
                                                                <small key={d.aberturaMm} className="block text-xs text-color-secondary">
                                                                    Tamiz {d.aberturaMm} mm: {d.medido}% vs B={d.limiteB}% → +{d.exceso} pp
                                                                </small>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Regla 4 — Fracción máxima */}
                                            {evalResult.reglasCIRSOC.fraccionMaxima && (
                                                <div className="py-1 border-bottom-1 surface-border">
                                                    <div className="flex align-items-center gap-2">
                                                        {(() => {
                                                            const cfg = CATEGORIA_COLORS[categoriaDeBoolean(evalResult.reglasCIRSOC.fraccionMaxima.cumple)];
                                                            return <i className={cfg.icon} style={{ color: cfg.hex }} />;
                                                        })()}
                                                        <span className="text-sm">
                                                            <strong>Fracción máxima entre tamices ≤ 45%</strong>
                                                            {!evalResult.reglasCIRSOC.fraccionMaxima.cumple && (
                                                                <span className="text-red-500 ml-2">
                                                                    {evalResult.reglasCIRSOC.fraccionMaxima.fraccionMaxEntre}: {evalResult.reglasCIRSOC.fraccionMaxima.fraccionMax}%
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    {evalResult.reglasCIRSOC.fraccionMaxima.detalle?.some(d => !d.cumple) && (
                                                        <div className="ml-4 mt-1">
                                                            {evalResult.reglasCIRSOC.fraccionMaxima.detalle.filter(d => !d.cumple).map((d) => (
                                                                <small key={d.entre} className="block text-xs text-red-400">
                                                                    {d.entre}: {d.pasaSup}% → {d.pasaInf}% = {d.fraccion}% {"(> 45%)"}
                                                                </small>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Resultado global */}
                                            {evalResult.reglasCIRSOC.resultadoGlobal && (
                                                <div className="flex align-items-center gap-2 pt-2">
                                                    {(() => {
                                                        const cat = categoriaDeBoolean(evalResult.reglasCIRSOC.resultadoGlobal.cumple);
                                                        const cfg = CATEGORIA_COLORS[cat];
                                                        return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />;
                                                    })()}
                                                    <span className="text-sm text-color-secondary">
                                                        {evalResult.reglasCIRSOC.resultadoGlobal.reglasOk}/{evalResult.reglasCIRSOC.resultadoGlobal.totalReglas} reglas OK
                                                        {evalResult.reglasCIRSOC.resultadoGlobal.reglasIncumplidas.length > 0 && (
                                                            <span className="ml-1">
                                                                (incumple: {evalResult.reglasCIRSOC.resultadoGlobal.reglasIncumplidas.join(", ")})
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}


                        </div>
                        )}
                    </div>
                ) : isDerivado ? (
                    <div className="col-12">
                        <div className="surface-100 border-round p-3 flex align-items-center gap-2">
                            <i className="fa-solid fa-calculator text-primary" />
                            <span className="text-sm text-color-secondary">
                                {isEdit ? (
                                    <>Este ensayo es un <strong>valor derivado</strong> calculado automáticamente. Solo lectura.</>
                                ) : (
                                    <>Los ensayos derivados (MF, TMN) <strong>se autogeneran desde Granulometría</strong>. No se pueden crear manualmente.</>
                                )}
                            </span>
                        </div>
                        {isEdit && ensayo?.resultado && (
                            <div className="surface-ground border-round p-3 mt-2">
                                <label className="block text-sm font-semibold mb-1">Resultado (autocalculado)</label>
                                <pre className="text-xs text-color-secondary m-0" style={{ whiteSpace: 'pre-wrap' }}>
                                    {JSON.stringify(ensayo.resultado, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                ) : formSpec?.modo === "GENERIC" ? (
                    <div className="col-12">
                        {loadingSpec ? (
                            <div className="flex align-items-center gap-2 p-3">
                                <i className="fa-solid fa-spinner fa-spin text-primary" />
                                <span className="text-sm text-color-secondary">Cargando formulario...</span>
                            </div>
                        ) : (
                            <EnsayoTipoForm
                                spec={formSpec}
                                resultado={genericResultado}
                                onChange={(newRes) => {
                                    setGenericResultado(newRes);
                                    // Auto-cumple for IRAM 1601 agua
                                    if (formSpec?.codigo === "IRAM1601_ANALISIS_QUIMICO") {
                                        const ctx = {
                                            origenAgua:   newRes._origenAgua   ?? "otro_origen",
                                            usoAmasado:   newRes._usoAmasado   ?? true,
                                            usoCurado:    newRes._usoCurado     ?? true,
                                            tipoHormigon: newRes._tipoHormigon  ?? "armado",
                                            agReactivos:  newRes._agReactivos   ?? false,
                                        };
                                        const limCl = { simple: 4500, armado: 1000, pretensado: 500 };
                                        const lims = {
                                            residuoSolido:   { max: ctx.origenAgua === "recuperada" ? 50000 : 5000 },
                                            materiaOrganica: { max: 3 },
                                            ph:              { min: ctx.usoCurado ? 6.0 : 4.0 },
                                            sulfato:         { max: 2000 },
                                            cloruro:         { max: limCl[ctx.tipoHormigon] || 1000 },
                                            hierro:          { max: ctx.usoCurado ? 0.5 : null },
                                            alcalis:         { max: ctx.agReactivos ? 1500 : null },
                                        };
                                        const fields = ["residuoSolido","materiaOrganica","ph","sulfato","cloruro","hierro","alcalis"];
                                        let hasValue = false, hasFail = false;
                                        for (const f of fields) {
                                            const v = newRes[f]; const l = lims[f];
                                            if (v == null) continue;
                                            hasValue = true;
                                            if (l.max == null && l.min == null) continue;
                                            if (l.min != null && Number(v) < l.min) hasFail = true;
                                            if (l.max != null && Number(v) > l.max) hasFail = true;
                                        }
                                        if (hasValue) setCumple(hasFail ? "NO_CUMPLE" : "CUMPLE");
                                    }
                                }}
                                disabled={saving}
                                densidadSSS={densidadSSS}
                            />
                        )}
                    </div>
                ) : (
                    <div className="col-12">
                        <label className="block font-bold mb-1">Resultado (JSON)</label>
                        <InputTextarea
                            value={resultadoJson}
                            onChange={(e) => setResultadoJson(e.target.value)}
                            className="w-full font-mono text-sm"
                            rows={4}
                            autoResize
                            placeholder='{"clave": "valor"}'
                        />
                    </div>
                )}
            </div>
        </Dialog>
    );
};

export default EnsayoFormModal;
