import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { Dialog } from "primereact/dialog";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import { InputSwitch } from "primereact/inputswitch";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import EnsayoFormModal from "./EnsayoFormModal";
import CampaignFormModal from "./CampaignFormModal";
import ImportPdfModal from "./ImportPdfModal";
import FichaTecnicaModal from "./FichaTecnicaModal";
import EnsayoPrintDialog from "./EnsayoPrintDialog";
import { CumplimientoBadge } from "../common/CumplimientoBadge";
import { CATEGORIA_COLORS, VEREDICTO } from "../../../lib/compliance";
import {
    getResumen,
    getEnsayos,
    deleteEnsayo,
    getAgregadoMeta,
    getCaracterizacion,
} from "../../../services/agregadoEnsayoService";
import { openNormaPdf } from "../../../services/normaService";
import "./ensayosAgregados.css";

/* ══════════════════════════════════════════════════════
   Constants & Helpers
   ══════════════════════════════════════════════════════ */

const USO_OPTIONS = [
    { label: "Fino", value: "FINO" },
    { label: "Grueso", value: "GRUESO" },
];

const ESTADO_CONFIG = {
    VIGENTE:    { icon: "fa-solid fa-circle-check",           color: "#22c55e", label: "Vigente",     dotClass: "semaforo-verde" },
    POR_VENCER: { icon: "fa-solid fa-triangle-exclamation",   color: "#eab308", label: "Por vencer",  dotClass: "semaforo-amarillo" },
    VENCIDO:    { icon: "fa-solid fa-circle-xmark",           color: "#ef4444", label: "Vencido",     dotClass: "semaforo-rojo" },
    SIN_DATOS:  { icon: "fa-solid fa-circle-question",        color: "#9ca3af", label: "Sin datos",   dotClass: "semaforo-gris" },
    NO_APLICA:  { icon: "fa-solid fa-ban",                    color: "#d1d5db", label: "No aplica",   dotClass: "semaforo-na" },
};

const CATEGORIA_LABELS = {
    fisica: "Propiedades Físicas",
    mecanica: "Propiedades Mecánicas",
    limpieza: "Limpieza y Contaminantes",
    forma: "Forma y Textura",
    durabilidad: "Durabilidad",
};

const formatDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/* ══════════════════════════════════════════════════════
   GranulometriaDetalleModal — Read-only detail modal
   ══════════════════════════════════════════════════════ */

const GranulometriaDetalleModal = ({ visible, onHide, ensayo }) => {
    const g = ensayo?.resultado?.granulometria;
    const ev = g?.evaluacion;
    const obj = g?.objetivo;
    const warnings = ensayo?.resultado?._warnings;

    // Lazy import Chart
    const ChartComponent = useMemo(() => {
        try {
            require("chart.js/auto");
            const { Chart: PrimeChart } = require("primereact/chart");
            return PrimeChart;
        } catch {
            return null;
        }
    }, []);

    // Build table data from series + fueraDeBanda/faltantes/deducidos
    const tableData = useMemo(() => {
        if (!ev) return [];

        // New format: use series
        if (ev.series) {
            const { medida, bandaMin, bandaMax } = ev.series;
            const medMap = new Map();
            const deducMap = new Map();
            for (const pt of (medida || [])) {
                medMap.set(String(pt.aberturaMm), pt.pasaPct);
                if (pt.deducido) deducMap.set(String(pt.aberturaMm), true);
            }
            // Also mark deducidos from top-level array (belt & suspenders)
            for (const d of (ev.deducidos || [])) deducMap.set(String(d.aberturaMm), true);

            const minMap = new Map();
            for (const pt of (bandaMin || [])) minMap.set(String(pt.aberturaMm), pt.pasaPct);
            const maxMap = new Map();
            for (const pt of (bandaMax || [])) maxMap.set(String(pt.aberturaMm), pt.pasaPct);

            const fueraMap = new Map();
            for (const fb of (ev.fueraDeBanda || [])) fueraMap.set(String(fb.aberturaMm), fb);
            const faltMap = new Map();
            for (const f of (ev.faltantes || [])) faltMap.set(String(f.aberturaMm), f);

            const allAberturas = new Set([
                ...(bandaMin || []).map(p => p.aberturaMm),
                ...(bandaMax || []).map(p => p.aberturaMm),
            ]);

            return [...allAberturas]
                .sort((a, b) => b - a)
                .map((abMm) => {
                    const key = String(abMm);
                    const fb = fueraMap.get(key);
                    const falt = faltMap.get(key);
                    const deducido = deducMap.has(key);
                    let estado = "OK";
                    if (falt) estado = "N/A";
                    else if (fb) estado = "FUERA";

                    return {
                        tamiz: fb?.tamiz || falt?.tamiz || `${abMm} mm`,
                        aberturaMm: abMm,
                        pasaPct: medMap.get(key) ?? null,
                        limInfPct: minMap.get(key) ?? null,
                        limSupPct: maxMap.get(key) ?? null,
                        estado,
                        deducido,
                    };
                });
        }

        // Legacy fallback
        return [];
    }, [ev]);

    // Build chart data from series
    const chartData = useMemo(() => {
        if (!ev?.series) return null;
        const { medida, bandaMin, bandaMax } = ev.series;
        const datasets = [];

        if (bandaMax?.length > 0) {
            datasets.push({
                label: "Límite superior",
                data: bandaMax.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
                borderColor: "rgba(239,68,68,0.6)", backgroundColor: "transparent",
                borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, fill: false, tension: 0, order: 2,
            });
        }
        if (bandaMin?.length > 0) {
            datasets.push({
                label: "Límite inferior",
                data: bandaMin.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
                borderColor: "rgba(239,68,68,0.6)", backgroundColor: "rgba(239,68,68,0.08)",
                borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, fill: bandaMax?.length > 0 ? "-1" : false, tension: 0, order: 2,
            });
        }
        if (medida?.length > 0) {
            datasets.push({
                label: "Medida", data: medida.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
                borderColor: "#3B82F6", backgroundColor: "rgba(59,130,246,0.15)",
                borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: "#3B82F6", pointBorderColor: "#fff",
                pointBorderWidth: 1.5, fill: false, tension: 0, order: 1,
            });
        }

        return { datasets };
    }, [ev]);

    const chartOptions = useMemo(
        () => ({
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "nearest", intersect: false },
            scales: {
                x: {
                    type: "logarithmic",
                    title: { display: true, text: "Abertura (mm)", font: { size: 11, weight: "bold" } },
                    min: 0.05, max: 100,
                    ticks: {
                        callback: (val) => {
                            const labels = [0.075, 0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 12.5, 19, 25, 37.5, 50, 75];
                            if (labels.some((l) => Math.abs(val - l) < 0.001)) return val;
                            return "";
                        },
                        autoSkip: false, maxRotation: 45, font: { size: 9 },
                    },
                    grid: { color: "rgba(0,0,0,0.06)" },
                },
                y: {
                    title: { display: true, text: "% Pasa", font: { size: 11, weight: "bold" } },
                    min: 0, max: 100,
                    ticks: { stepSize: 10, font: { size: 10 } },
                    grid: { color: "rgba(0,0,0,0.06)" },
                },
            },
            plugins: {
                legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
                tooltip: { backgroundColor: "rgba(0,0,0,0.85)", titleColor: "#fff", bodyColor: "#fff", padding: 8, cornerRadius: 6 },
            },
        }),
        []
    );

    if (!g || !ev) return null;

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header="Detalle de evaluación granulométrica"
            className="w-12 xl:w-8"
            modal
            dismissableMask
        >
            {/* Summary */}
            <div className="flex align-items-center gap-3 mb-3 flex-wrap">
                {(() => {
                    // ev.estado del servicio de evaluación (CUMPLE / INCOMPLETO / otro).
                    // Mismo mapeo que EnsayoFormModal C7: CUMPLE → APTO, INCOMPLETO → EVAL INCOMPLETA, otro → NO APTO.
                    const cat = ev.estado === "CUMPLE"     ? VEREDICTO.APTO
                              : ev.estado === "INCOMPLETO" ? VEREDICTO.EVALUACION_INCOMPLETA
                              : ev.estado                  ? VEREDICTO.NO_APTO
                              : (ev.cumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO);
                    const cfg = CATEGORIA_COLORS[cat];
                    return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />;
                })()}
                {ev.stats && (
                    <span className="text-sm">
                        Evaluados: {ev.stats.nTamices}
                        {ev.stats.nDeducidos > 0 && (
                            <span className="text-blue-400 ml-2">
                                ({ev.stats.nDeducidos} deducido{ev.stats.nDeducidos > 1 ? "s" : ""})
                            </span>
                        )}
                        {ev.stats.nFuera > 0 && (
                            <span className="text-red-500 font-semibold ml-2">
                                Fuera de banda: {ev.stats.nFuera}
                            </span>
                        )}
                        {ev.stats.peorDesvioPct > 0 && (
                            <span className="text-orange-500 ml-2">
                                (peor desvío: {ev.stats.peorDesvioPct}%)
                            </span>
                        )}
                    </span>
                )}
                {obj && (
                    <span className="text-sm text-color-secondary">
                        Curva: {obj.nombre} ({obj.normaRef || "—"}) — {obj.serieTamices}
                        {obj.tmnMm ? ` TMN ${obj.tmnMm}` : ""}
                    </span>
                )}
                {ev.faltantes?.length > 0 && (
                    <span className="text-xs text-orange-500">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        {ev.faltantes.length} tamiz(es) sin dato
                    </span>
                )}
            </div>

            {/* Calculos derivados: MF y TMN */}
            {ev.calculos && (
                <div className="surface-100 border-round p-2 mb-3 flex align-items-center gap-4 flex-wrap">
                    <div className="flex align-items-center gap-2">
                        <i className="fa-solid fa-calculator text-primary text-sm" />
                        <span className="font-semibold text-sm">Calculados:</span>
                    </div>
                    <div className="flex align-items-center gap-2">
                        <span className="text-sm text-600">MF:</span>
                        <span className="font-bold text-primary">
                            {ev.calculos.moduloFinura?.valor != null
                                ? ev.calculos.moduloFinura.valor.toFixed(2)
                                : "—"}
                        </span>
                        {ev.calculos.moduloFinura && !ev.calculos.moduloFinura.completo && (
                            <Tag value="parcial" severity="warning" className="text-xs" style={{ fontSize: "0.6rem", padding: "0 3px" }} />
                        )}
                    </div>
                    <div className="flex align-items-center gap-2">
                        <span className="text-sm text-600">TMN:</span>
                        <span className="font-bold text-primary">
                            {ev.calculos.tmn?.valor != null
                                ? `${ev.calculos.tmn.valor} mm`
                                : "—"}
                        </span>
                        {ev.calculos.tmn?.tamiz && (
                            <span className="text-xs text-500">({ev.calculos.tmn.tamiz})</span>
                        )}
                    </div>
                </div>
            )}

            {/* Warnings from registry validation */}
            {warnings?.length > 0 && (
                <div className="mb-3">
                    {warnings.map((w, i) => (
                        <Message key={i} severity="warn" text={w} className="mb-1 w-full text-xs" />
                    ))}
                </div>
            )}

            <div className="grid">
                {/* Table */}
                <div className="col-12 lg:col-6">
                    <DataTable responsiveLayout="scroll"
                        value={tableData}
                        size="small"
                        stripedRows
                        scrollable
                        scrollHeight="350px"
                        emptyMessage="Sin datos"
                        className="text-sm"
                    >
                        <Column header="Tamiz" field="tamiz" style={{ width: "100px" }} frozen />
                        <Column header="% Pasa" field="pasaPct" body={(r) => {
                            if (r.pasaPct == null) return "—";
                            return (
                                <span>{r.pasaPct.toFixed(1)}{r.deducido && <i className="fa-solid fa-wand-magic-sparkles text-blue-400 ml-1" title="Deducido por saturación" style={{ fontSize: '0.7rem' }} />}</span>
                            );
                        }} style={{ width: "80px" }} />
                        <Column header="Lím. inf." field="limInfPct" body={(r) => r.limInfPct != null ? r.limInfPct.toFixed(1) : "—"} style={{ width: "70px" }} />
                        <Column header="Lím. sup." field="limSupPct" body={(r) => r.limSupPct != null ? r.limSupPct.toFixed(1) : "—"} style={{ width: "70px" }} />
                        <Column
                            header="Estado"
                            body={(r) => {
                                // Etiqueta corta por celda; severity vía CATEGORIA_COLORS.
                                // "Deducido" es metadato no-compliance (origen del dato), no veredicto.
                                if (r.estado === "FUERA") {
                                    const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APTO];
                                    return <Tag value="FUERA" severity={cfg.severity} className="text-xs" />;
                                }
                                if (r.estado === "N/A") {
                                    const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APLICA];
                                    return <Tag value="N/A" severity={cfg.severity} className="text-xs" />;
                                }
                                if (r.deducido) return <Tag value="Deducido" severity="info" className="text-xs" />;
                                const cfg = CATEGORIA_COLORS[VEREDICTO.APTO];
                                return <Tag value="OK" severity={cfg.severity} className="text-xs" />;
                            }}
                            style={{ width: "80px" }}
                        />
                    </DataTable>
                </div>

                {/* Chart */}
                <div className="col-12 lg:col-6">
                    {chartData && ChartComponent && (
                        <div style={{ height: "clamp(240px, 50vh, 350px)" }}>
                            <ChartComponent type="line" data={chartData} options={chartOptions} style={{ height: "100%", width: "100%" }} />
                        </div>
                    )}
                </div>
            </div>
        </Dialog>
    );
};

/* ══════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════ */

const AgregadoEnsayosPage = () => {
    const { legacyAgregadoId } = useParams();
    const navigate = useNavigate();
    const showToast = useToast();

    // Data
    const [resumen, setResumen] = useState(null);
    const [ensayos, setEnsayos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [agregadoNombre, setAgregadoNombre] = useState("");
    const [agregadoTipo, setAgregadoTipo] = useState(null); // "Fino" | "Grueso"

    // Filters
    const [uso, setUso] = useState(null); // null until resolved from aggregate type
    const [filtroTipo, setFiltroTipo] = useState(null);

    // Uso is locked when the aggregate has a definite type (Fino or Grueso)
    const usoLocked = agregadoTipo === "Fino" || agregadoTipo === "Grueso";

    // Modal
    const [formVisible, setFormVisible] = useState(false);
    const [editEnsayo, setEditEnsayo] = useState(null);
    const [formReadOnly, setFormReadOnly] = useState(false);

    // PDF import modal
    const [importVisible, setImportVisible] = useState(false);

    // ─── Impresión PDF ─────────────────────────────────────
    const [selectedEnsayos, setSelectedEnsayos] = useState([]);
    const [printDialogVisible, setPrintDialogVisible] = useState(false);
    const [printDialogEnsayos, setPrintDialogEnsayos] = useState([]);
    const [campaignVisible, setCampaignVisible] = useState(false);

    // Ficha técnica modal
    const [fichaTecnicaVisible, setFichaTecnicaVisible] = useState(false);

    // Detalle granulometría modal
    const [detalleVisible, setDetalleVisible] = useState(false);
    const [detalleEnsayo, setDetalleEnsayo] = useState(null);

    // Card perfil toggle
    const [showAvanzadosCards, setShowAvanzadosCards] = useState(false);

    // Caracterización del agregado
    const [caract, setCaract] = useState(null);
    const [caractLoading, setCaractLoading] = useState(false);
    const [caractError, setCaractError] = useState(null);
    const [caractDebugOpen, setCaractDebugOpen] = useState(false);

    // ─── Fetch ──────────────────────────────────────────────
    const fetchData = useCallback(async (currentUso) => {
        try {
            setLoading(true);
            // Decisión 2026-05-28: pantalla interna del operador →
            // pedimos modo NORMATIVO para mostrar veredictos y semáforos
            // (las cards/badges del operador necesitan juicio para decidir
            // si avanzar; el documento descriptivo es solo para PDFs).
            const [resData, ensData] = await Promise.all([
                getResumen(legacyAgregadoId, { uso: currentUso, modo: 'NORMATIVO' }),
                getEnsayos({ legacyAgregadoId }),
            ]);
            setResumen(resData);
            setEnsayos(ensData);
        } catch (err) {
            console.error(err);
            showToast("error", "Error al cargar ensayos");
        } finally {
            setLoading(false);
        }
    }, [legacyAgregadoId, showToast]);

    // Fetch caracterización
    const fetchCaracterizacion = useCallback(async () => {
        try {
            setCaractLoading(true);
            setCaractError(null);
            const data = await getCaracterizacion(legacyAgregadoId, uso);
            setCaract(data);
        } catch (err) {
            console.error('[Caracterización] Error al cargar:', err);
            setCaractError(err?.response?.data?.error || err.message || 'Error desconocido');
            setCaract(null);
        } finally {
            setCaractLoading(false);
        }
    }, [legacyAgregadoId, uso]);

    // Fetch agregado name + type from legacy to resolve default uso
    const fetchAgregadoInfo = useCallback(async () => {
        try {
            const { data } = await axios.get(`${config.backendUrl}/api/agregados`, { headers: config.headers });
            const found = (data || []).find((a) => String(a.id) === String(legacyAgregadoId));
            if (found) {
                setAgregadoNombre(found.nombre || "");
                setAgregadoTipo(found.tipoAgregado || null);
                // Set default uso based on aggregate type (only if not yet set)
                setUso((prev) => {
                    if (prev !== null) return prev; // user already changed it
                    return found.tipoAgregado === "Grueso" ? "GRUESO" : "FINO";
                });
            } else {
                // Fallback: default to FINO if aggregate not found
                setUso((prev) => prev ?? "FINO");
            }
        } catch {
            setUso((prev) => prev ?? "FINO");
        }
    }, [legacyAgregadoId]);

    useEffect(() => {
        fetchAgregadoInfo();
    }, [legacyAgregadoId, fetchAgregadoInfo]);

    // Only fetch ensayo data once uso is resolved
    useEffect(() => {
        if (uso) {
            fetchData(uso);
            fetchCaracterizacion();
        }
    }, [legacyAgregadoId, uso, fetchData, fetchCaracterizacion]);

    const onSaved = useCallback(() => {
        setFormVisible(false);
        fetchData(uso);
        fetchCaracterizacion();
    }, [fetchData, fetchCaracterizacion, uso]);

    // ─── Derived ────────────────────────────────────────────
    // Tipos para el modal (todos los que aplican)
    const tiposParaModal = useMemo(() => {
        if (!resumen) return [];
        return resumen.items
            .filter((it) => it.estado !== "NO_APLICA")
            .map((it) => ({
                idAgregadoEnsayoTipo: it.tipo.id,
                nombre: it.tipo.nombre,
                codigo: it.tipo.codigo,
                normaRef: it.tipo.normaRef,
                esDerivado: it.tipo.esDerivado || false,
                visibleEnDosificacion: it.tipo.visibleEnDosificacion || false,
                perfil: it.tipo.perfil || "AVANZADO",
                schemaKey: it.tipo.schemaKey || null,
                periodicidadMeses: null, // not needed for modal
            }));
    }, [resumen]);

    // Items agrupados por categoría (derivados filtered server-side, safety filter here)
    const categorizedItems = useMemo(() => {
        if (!resumen) return [];
        const cats = {};
        for (const item of resumen.items) {
            if (item.tipo.esDerivado || item.tipo.visibleEnCards === false) continue;
            // Perfil filter: por defecto solo CORE, salvo toggle "Mostrar avanzados"
            if (!showAvanzadosCards && item.tipo.perfil && item.tipo.perfil !== 'CORE') continue;
            const cat = item.tipo.categoria || "otros";
            if (!cats[cat]) cats[cat] = [];
            cats[cat].push(item);
        }
        // Orden de categorías conocidas
        const order = ["fisica", "mecanica", "limpieza", "forma", "durabilidad", "otros"];
        return order
            .filter((c) => cats[c]?.length > 0)
            .map((c) => ({ categoria: c, label: CATEGORIA_LABELS[c] || c, items: cats[c] }));
    }, [resumen, showAvanzadosCards]);

    // Filtered history
    const filteredEnsayos = useMemo(() => {
        if (!filtroTipo) return ensayos;
        return ensayos.filter((e) => e.idAgregadoEnsayoTipo === filtroTipo);
    }, [ensayos, filtroTipo]);

    const tipoOptions = useMemo(() => {
        if (!resumen) return [];
        return resumen.items
            .filter((it) => it.estado !== "NO_APLICA")
            .map((it) => ({ label: it.tipo.nombre, value: it.tipo.id }));
    }, [resumen]);

    // ─── Actions ────────────────────────────────────────────
    const openNew = () => {
        setEditEnsayo(null);
        setFormReadOnly(false);
        setFormVisible(true);
    };

    const openEdit = (ensayo) => {
        setEditEnsayo(ensayo);
        setFormReadOnly(false);
        setFormVisible(true);
    };

    const openView = (ensayo) => {
        setEditEnsayo(ensayo);
        setFormReadOnly(true);
        setFormVisible(true);
    };

    const confirmDelete = (ensayo) => {
        confirmDialog({
            message: "¿Desactivar este ensayo? Se quitará del listado activo.",
            header: "Desactivar ensayo",
            icon: "fa-solid fa-triangle-exclamation",
            acceptLabel: "Desactivar",
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    await deleteEnsayo(ensayo.idAgregadoEnsayo);
                    showToast("success", "Ensayo desactivado");
                    fetchData(uso);
                } catch {
                    showToast("error", "Error al desactivar ensayo");
                }
            },
        });
    };

    // ─── Render ─────────────────────────────────────────────
    if (loading && !resumen) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    const totals = resumen?.totals || {};

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <EnsayoFormModal
                visible={formVisible}
                onHide={() => setFormVisible(false)}
                legacyAgregadoId={legacyAgregadoId}
                tipos={tiposParaModal}
                ensayo={editEnsayo}
                onSaved={onSaved}
                defaultUsoAgregado={uso}
                readOnly={formReadOnly}
            />

            <CampaignFormModal
                visible={campaignVisible}
                onHide={() => setCampaignVisible(false)}
                legacyAgregadoId={legacyAgregadoId}
                tipos={resumen?.items || []}
                onSaved={() => { setCampaignVisible(false); fetchData(uso); }}
                defaultUsoAgregado={uso}
            />

            <ImportPdfModal
                visible={importVisible}
                onHide={() => setImportVisible(false)}
                legacyAgregadoId={legacyAgregadoId}
                onImported={() => { setImportVisible(false); fetchData(uso); }}
                defaultUsoAgregado={uso}
            />

            <FichaTecnicaModal
                visible={fichaTecnicaVisible}
                onHide={() => setFichaTecnicaVisible(false)}
                legacyAgregadoId={legacyAgregadoId}
                agregadoNombre={agregadoNombre}
                agregadoTipo={agregadoTipo}
                caract={caract}
                ensayos={ensayos}
                resumen={resumen}
            />

            {/* Modal detalle granulometría (solo lectura) */}
            <GranulometriaDetalleModal
                visible={detalleVisible}
                onHide={() => { setDetalleVisible(false); setDetalleEnsayo(null); }}
                ensayo={detalleEnsayo}
            />

            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader
                    icon="fa-solid fa-flask-vial"
                    title={`Ensayos — Agregado #${legacyAgregadoId}${agregadoNombre ? ` (${agregadoNombre})` : ""}`}
                    subtitle="Estado y historial de ensayos IRAM"
                />

                {/* ═══ Tipo de agregado ═══ */}
                <div className="flex align-items-center gap-3 mt-3 mb-3">
                    <span className="font-semibold text-sm">Tipo de agregado:</span>
                    <Tag value={agregadoTipo || uso} className="text-sm" severity="info" />
                </div>

                {/* ═══ Totales rápidos ═══ */}
                <div className="flex gap-3 flex-wrap mb-4">
                    <div className="resumen-total-chip vigente">
                        <i className="fa-solid fa-circle-check mr-1" />
                        {totals.vigentes ?? 0} Vigentes
                    </div>
                    <div className="resumen-total-chip por-vencer">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        {totals.porVencer ?? 0} Por vencer
                    </div>
                    <div className="resumen-total-chip vencido">
                        <i className="fa-solid fa-circle-xmark mr-1" />
                        {totals.vencidos ?? 0} Vencidos
                    </div>
                    <div className="resumen-total-chip sin-datos">
                        <i className="fa-solid fa-circle-question mr-1" />
                        {totals.sinDatos ?? 0} Sin datos
                    </div>
                    {totals.noCumple > 0 && (
                        <div className="resumen-total-chip no-cumple">
                            <i className="fa-solid fa-exclamation mr-1" />
                            {totals.noCumple} No cumple
                        </div>
                    )}
                </div>

                {/* ═══ Caracterización del agregado ═══ */}
                {caractLoading && (
                    <div className="w-full mb-4 surface-card border-round p-3 shadow-1">
                        <div className="font-bold text-sm mb-2 flex align-items-center gap-2">
                            <i className="fa-solid fa-clipboard-list text-primary" />
                            Caracterización del agregado
                        </div>
                        <div className="text-500 text-sm">
                            <i className="pi pi-spin pi-spinner mr-2" />
                            Cargando caracterización…
                        </div>
                    </div>
                )}
                {caractError && !caractLoading && (
                    <div className="w-full mb-4">
                        <Message severity="error" text={`No se pudo cargar caracterización: ${caractError}`} className="w-full" />
                    </div>
                )}
                {caract && !caractLoading && !caractError && (
                    <div className="w-full mb-4 surface-card border-round p-3 shadow-1">
                        <div className="font-bold text-sm mb-2 flex align-items-center gap-2">
                            <i className="fa-solid fa-clipboard-list text-primary" />
                            Caracterización del agregado
                        </div>
                        <div className="grid">
                            {[
                                { label: "TMN", data: caract.tmnMm, fmt: (v) => `${v} mm`, usos: ["GRUESO", "TOTAL"] },
                                { label: "Módulo de finura", data: caract.moduloFinura, fmt: (v) => Number(v).toFixed(2) },
                                { label: "Dens. rel. ap. (SSS)", data: caract.densidadRelativaAparenteSSS, fmt: (v) => Number(v).toFixed(3) },
                                { label: "Dens. rel. ap. (seca)", data: caract.densidadRelativaAparenteSeca, fmt: (v) => Number(v).toFixed(3) },
                                { label: "Dens. relativa real", data: caract.densidadRelativaReal, fmt: (v) => Number(v).toFixed(3) },
                                { label: "Absorción", data: caract.absorcionPct, fmt: (v) => `${Number(v).toFixed(2)}%` },
                                { label: "Desgaste LA", data: caract.losAngelesPct || caract.desgasteLAPct, fmt: (v) => `${Number(v).toFixed(1)}%`, usos: ["GRUESO", "TOTAL"] },
                                { label: "Lajosidad", data: caract.lajosidadPct, fmt: (v) => `${Number(v).toFixed(1)}%`, usos: ["GRUESO", "TOTAL"] },
                                { label: "Elongación", data: caract.elongacionPct, fmt: (v) => `${Number(v).toFixed(1)}%`, usos: ["GRUESO", "TOTAL"] },
                                { label: "Pasa N.º 200", data: caract.pasa200Pct, fmt: (v) => `${Number(v).toFixed(1)}%`, usos: ["FINO", "TOTAL"] },
                                { label: "PUC", data: caract.puc, fmt: (v) => `${Math.round(v)} kg/m³` },
                                { label: "PUS", data: caract.pus, fmt: (v) => `${Math.round(v)} kg/m³` },
                            ].filter(({ usos: u }) => !u || u.includes(uso)).map(({ label, data, fmt }) => (
                                <div key={label} className="col-6 md:col-3 lg:col-2 text-center mb-2">
                                    <div className="text-xs text-500 mb-1">{label}</div>
                                    {data ? (
                                        <>
                                            <div className="text-lg font-bold text-primary">{fmt(data.valor)}</div>
                                            <div
                                                className={`text-xs ${data.estado === 'VENCIDO' ? 'text-orange-500' : data.fuenteLegacy ? 'text-blue-400' : 'text-400'}`}
                                                title={data.fuenteLegacy
                                                    ? 'Dato de ficha del agregado (legacy)'
                                                    : `Ensayo #${data.idAgregadoEnsayo} — ${data.laboratorio || ''}${data.nroInforme ? ` — Inf. ${data.nroInforme}` : ''}${data.estado === 'VENCIDO' ? ' (vencido)' : ''}`}
                                            >
                                                {data.fuenteLegacy ? (
                                                    <span className="text-blue-400">Ficha agregado</span>
                                                ) : (
                                                    <>
                                                        {formatDate(data.fechaEnsayo)}
                                                        {data.nroInforme ? ` · ${data.nroInforme}` : ""}
                                                    </>
                                                )}
                                                {data.estado === 'VENCIDO' && (
                                                    <span className="ml-1 text-orange-500 font-semibold">(vencido)</span>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-lg text-400">—</div>
                                    )}
                                </div>
                            ))}
                        </div>
                        {/* Dev debug: raw JSON from /caracterizacion */}
                        {process.env.NODE_ENV === 'development' && (
                            <div className="mt-2 border-top-1 surface-border pt-2">
                                <div
                                    className="text-xs text-500 cursor-pointer flex align-items-center gap-1"
                                    onClick={() => setCaractDebugOpen((prev) => !prev)}
                                >
                                    <i className={`pi ${caractDebugOpen ? 'pi-chevron-down' : 'pi-chevron-right'} text-xs`} />
                                    Debug (dev only)
                                </div>
                                {caractDebugOpen && (
                                    <pre className="text-xs mt-1 p-2 surface-ground border-round overflow-auto" style={{ maxHeight: '300px' }}>
                                        {JSON.stringify(caract, null, 2)}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ═══ Cards por categoría ═══ */}
                <div className="flex align-items-center gap-2 mb-3 w-full">
                    <InputSwitch checked={showAvanzadosCards} onChange={(e) => setShowAvanzadosCards(e.value)} />
                    <label
                        className="text-sm text-color-secondary cursor-pointer"
                        onClick={() => setShowAvanzadosCards(!showAvanzadosCards)}
                    >
                        Mostrar avanzados
                    </label>
                </div>
                {categorizedItems.filter((group) => group.items.some((it) => it.estado !== "NO_APLICA")).map((group) => (
                    <div key={group.categoria} className="w-full mb-4">
                        <h4 className="mt-0 mb-2 text-color-secondary">
                            <i className="fa-solid fa-layer-group mr-2" />
                            {group.label}
                        </h4>
                        <div className="grid w-full">
                            {group.items.filter((item) => item.estado !== "NO_APLICA").map((item) => {
                                const cfg = ESTADO_CONFIG[item.estado] || ESTADO_CONFIG.SIN_DATOS;
                                return (
                                    <div key={item.tipo.id} className="col-12 md:col-6 lg:col-4 xl:col-3">
                                        <div
                                            className={`ensayo-card surface-card border-round p-3 shadow-1 h-full flex flex-column gap-2 ${item.needsAttention ? "ensayo-card-attention" : ""}`}
                                        >
                                            <div className="flex align-items-center justify-content-between">
                                                <span className="font-bold text-sm line-clamp-2" title={item.tipo.nombre}>
                                                    {item.tipo.nombre}
                                                </span>
                                                <span className={`semaforo-dot ${cfg.dotClass}`} title={cfg.label} />
                                            </div>
                                            <div className="flex align-items-center gap-2">
                                                {item.tipo.normaId ? (
                                                    <a
                                                        href="#"
                                                        onClick={(e) => { e.preventDefault(); openNormaPdf(item.tipo.normaId); }}
                                                        className="text-sm text-primary no-underline hover:underline flex align-items-center gap-1 cursor-pointer"
                                                        title="Ver norma (PDF)"
                                                    >
                                                        <i className="fa-solid fa-file-pdf text-xs" />
                                                        {item.tipo.normaRef || "Ver norma"}
                                                    </a>
                                                ) : (
                                                    <small className="text-color-secondary">{item.tipo.normaRef || ""}</small>
                                                )}
                                                {item.tipo.obligatorio && (
                                                    <Tag value="Obligatorio" severity="warning" className="text-xs" style={{ fontSize: "0.65rem", padding: "0 4px" }} />
                                                )}
                                            </div>

                                            {item.ultimoEnsayo ? (
                                                <>
                                                    <div className="flex justify-content-between align-items-center">
                                                        <span className="text-sm">
                                                            Ensayo: {formatDate(item.ultimoEnsayo.fechaEnsayo)}
                                                        </span>
                                                        <CumplimientoBadge
                                                            ensayo={item.ultimoEnsayo}
                                                            compliance={item.compliance}
                                                            title={item.ultimoEnsayo.resultado?._evaluacion?.mensaje || ''}
                                                        />
                                                    </div>
                                                    {/* Granulometría evaluation summary */}
                                                    {item.ultimoEnsayo.resultado?.granulometria?.evaluacion && (
                                                        <div className="flex align-items-center gap-2">
                                                            {(() => {
                                                                const ev = item.ultimoEnsayo.resultado.granulometria.evaluacion;
                                                                const obj = item.ultimoEnsayo.resultado.granulometria.objetivo;
                                                                return (
                                                                    <>
                                                                        {ev.estado === "INCOMPLETO" && (
                                                                            <small className="text-orange-500 font-semibold">
                                                                                <i className="fa-solid fa-circle-exclamation mr-1" />
                                                                                Incompleto
                                                                            </small>
                                                                        )}
                                                                        {ev.stats && ev.stats.nFuera > 0 && (
                                                                            <small className="text-red-500 font-semibold">
                                                                                <i className="fa-solid fa-exclamation-triangle mr-1" />
                                                                                Fuera: {ev.stats.nFuera}/{ev.stats.nTamices}
                                                                            </small>
                                                                        )}
                                                                        {ev.stats && ev.stats.nFuera === 0 && ev.estado !== "INCOMPLETO" && (
                                                                            <small className="text-green-500">
                                                                                <i className="fa-solid fa-check mr-1" />
                                                                                {ev.stats.nTamices} tamices OK
                                                                            </small>
                                                                        )}
                                                                        <Button
                                                                            label="Ver detalle"
                                                                            icon="fa-solid fa-eye"
                                                                            size="small"
                                                                            text
                                                                            className="p-0 text-xs"
                                                                            style={{ fontSize: "0.7rem" }}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setDetalleEnsayo(item.ultimoEnsayo);
                                                                                setDetalleVisible(true);
                                                                            }}
                                                                        />
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    )}
                                                    <div className="flex justify-content-between align-items-center">
                                                        <span className="text-sm">
                                                            Vence: {formatDate(item.ultimoEnsayo.fechaVencimiento)}
                                                        </span>
                                                        {item.diasParaVencer !== null && item.estado !== "VIGENTE" && (
                                                            <small className="font-semibold" style={{ color: cfg.color }}>
                                                                {item.diasParaVencer < 0
                                                                    ? `${Math.abs(item.diasParaVencer)}d vencido`
                                                                    : `${item.diasParaVencer}d restantes`}
                                                            </small>
                                                        )}
                                                    </div>
                                                    {item.ultimoEnsayo.resultado?._warnings?.length > 0 && (
                                                        <div className="flex align-items-center gap-1">
                                                            <Tag
                                                                value={`${item.ultimoEnsayo.resultado._warnings.length} aviso(s)`}
                                                                severity="warning"
                                                                icon="fa-solid fa-triangle-exclamation"
                                                                className="text-xs"
                                                                style={{ fontSize: "0.6rem", padding: "0 4px" }}
                                                                title="Ver detalle del ensayo para más información"
                                                            />
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-xs text-color-secondary">
                                                    Sin ensayos registrados
                                                    {item.tipo.obligatorio && (
                                                        <i className="fa-solid fa-circle-exclamation ml-2" style={{ color: "#eab308" }} title="Obligatorio" />
                                                    )}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {/* ═══ Sección: Historial ═══ */}
                <div className="flex align-items-center justify-content-between w-full mt-3 mb-2 flex-wrap gap-2">
                    <h3 className="m-0">
                        <i className="fa-solid fa-clock-rotate-left mr-2" />
                        Historial
                    </h3>
                    <div className="flex gap-2 align-items-center">
                        <Dropdown
                            value={filtroTipo}
                            onChange={(e) => setFiltroTipo(e.value)}
                            options={tipoOptions}
                            placeholder="Todos los tipos"
                            className="w-15rem"
                            showClear
                            filter
                        />
                        <Button
                            label="Ficha técnica"
                            icon="fa-solid fa-file-arrow-down"
                            rounded
                            size="small"
                            severity="danger"
                            outlined
                            onClick={() => setFichaTecnicaVisible(true)}
                        />
                        <Button
                            label="Cargar campaña"
                            icon="fa-solid fa-clipboard-list"
                            rounded
                            size="small"
                            severity="info"
                            outlined
                            onClick={() => setCampaignVisible(true)}
                        />
                        <Button
                            label="Nuevo ensayo"
                            icon="fa-solid fa-plus"
                            rounded
                            size="small"
                            severity="success"
                            onClick={openNew}
                        />
                    </div>
                </div>

                {selectedEnsayos.length > 0 && (
                    <div className="flex align-items-center justify-content-between mb-2 p-2 surface-100 border-round">
                        <span className="text-sm">
                            <i className="fa-solid fa-check-square mr-1" />
                            {selectedEnsayos.length} ensayo(s) seleccionado(s)
                        </span>
                        <div className="flex gap-2">
                            <Button
                                label="Imprimir seleccionados"
                                icon="fa-solid fa-file-pdf"
                                size="small"
                                onClick={() => {
                                    setPrintDialogEnsayos(selectedEnsayos.map((r) => ({
                                        idAgregadoEnsayo: r.idAgregadoEnsayo,
                                        tipoCodigo: r.tipo?.codigo,
                                        tipoNombre: r.tipo?.nombre,
                                        contextoAplicacion: r.contextoAplicacion || 'HORMIGON',
                                    })));
                                    setPrintDialogVisible(true);
                                }}
                            />
                            <Button
                                label="Limpiar selección"
                                icon="pi pi-times"
                                size="small"
                                text
                                onClick={() => setSelectedEnsayos([])}
                            />
                        </div>
                    </div>
                )}

                <DataTable responsiveLayout="scroll"
                    value={filteredEnsayos}
                    emptyMessage="No hay ensayos para mostrar"
                    stripedRows
                    paginator
                    rows={20}
                    className="w-full"
                    rowClassName={(_, i) => (i % 2 === 0 ? "even-row" : "odd-row")}
                    selection={selectedEnsayos}
                    onSelectionChange={(e) => setSelectedEnsayos(e.value)}
                    selectionMode="checkbox"
                    dataKey="idAgregadoEnsayo"
                >
                    <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
                    <Column
                        header="Fecha ensayo"
                        field="fechaEnsayo"
                        sortable
                        body={(row) => formatDate(row.fechaEnsayo)}
                        style={{ width: "120px" }}
                    />
                    <Column
                        header="Tipo"
                        body={(row) => row.tipo?.nombre || "—"}
                        sortable
                        sortField="tipo.nombre"
                    />
                    <Column
                        header="Norma"
                        body={(row) => row.tipo?.normaRef || "—"}
                        style={{ width: "120px" }}
                    />
                    <Column
                        header="Laboratorio"
                        field="laboratorio"
                        body={(row) => row.laboratorio || "—"}
                    />
                    <Column
                        header="N.º informe"
                        field="nroInforme"
                        body={(row) => row.nroInforme || "—"}
                        style={{ width: "120px" }}
                    />
                    <Column
                        header="Cumple"
                        body={(row) => <CumplimientoBadge ensayo={row} />}
                        style={{ width: "120px" }}
                    />
                    <Column
                        header="Vencimiento"
                        body={(row) => {
                            const dotClass = (() => {
                                if (!row.fechaVencimiento) return "semaforo-gris";
                                const hoy = new Date(); hoy.setHours(0,0,0,0);
                                const venc = new Date(row.fechaVencimiento); venc.setHours(0,0,0,0);
                                if (venc < hoy) return "semaforo-rojo";
                                if ((venc - hoy) / 86400000 <= 30) return "semaforo-amarillo";
                                return "semaforo-verde";
                            })();
                            return (
                                <div className="flex align-items-center gap-2">
                                    <span className={`semaforo-dot ${dotClass}`} />
                                    {formatDate(row.fechaVencimiento)}
                                </div>
                            );
                        }}
                        style={{ width: "140px" }}
                    />
                    <Column
                        header="Acciones"
                        style={{ width: "160px" }}
                        body={(row) => (
                            <div className="flex gap-1 align-items-center">
                                {row.resultado?._warnings?.length > 0 && (
                                    <i
                                        className="fa-solid fa-triangle-exclamation text-orange-500 text-xs"
                                        title={`${row.resultado._warnings.length} aviso(s)`}
                                    />
                                )}
                                {row.esAutoCalculado && (
                                    <Tag value="Auto" severity="info" className="text-xs mr-1" style={{ fontSize: "0.6rem", padding: "0 3px" }}
                                         title="Generado automáticamente desde granulometría" />
                                )}
                                <Button
                                    icon="fa-solid fa-eye"
                                    rounded
                                    text
                                    size="small"
                                    onClick={() => openView(row)}
                                    tooltip="Ver"
                                    tooltipOptions={{ position: "top" }}
                                />
                                <Button
                                    icon="fa-solid fa-pencil"
                                    rounded
                                    text
                                    size="small"
                                    onClick={() => openEdit(row)}
                                    tooltip={row.esAutoCalculado ? "No editable (auto-calculado)" : "Editar"}
                                    tooltipOptions={{ position: "top" }}
                                    disabled={row.esAutoCalculado}
                                />
                                <Button
                                    icon="fa-solid fa-trash"
                                    rounded
                                    text
                                    severity="danger"
                                    size="small"
                                    onClick={() => confirmDelete(row)}
                                    tooltip={row.esAutoCalculado ? "No eliminable (auto-calculado)" : "Desactivar"}
                                    tooltipOptions={{ position: "top" }}
                                    disabled={row.esAutoCalculado}
                                />
                                <Button
                                    icon="fa-solid fa-file-pdf"
                                    rounded
                                    text
                                    severity="info"
                                    size="small"
                                    onClick={() => {
                                        setPrintDialogEnsayos([{
                                            idAgregadoEnsayo: row.idAgregadoEnsayo,
                                            tipoCodigo: row.tipo?.codigo,
                                            tipoNombre: row.tipo?.nombre,
                                            contextoAplicacion: row.contextoAplicacion || 'HORMIGON',
                                        }]);
                                        setPrintDialogVisible(true);
                                    }}
                                    tooltip="Imprimir PDF"
                                    tooltipOptions={{ position: "top" }}
                                />
                            </div>
                        )}
                    />
                </DataTable>

            </div>

            <EnsayoPrintDialog
                visible={printDialogVisible}
                onHide={() => setPrintDialogVisible(false)}
                ensayos={printDialogEnsayos}
                idAgregado={Number(legacyAgregadoId)}
                tmnMm={(() => {
                    // caract.tmnMm puede venir como { valor, fechaEnsayo, ... } o como número crudo
                    const t = caract?.tmnMm;
                    if (t == null) return null;
                    if (typeof t === 'object') return t.valor ?? null;
                    return t;
                })()}
                agregadoNombre={agregadoNombre}
            />
        </Fade>
    );
};

export default AgregadoEnsayosPage;
