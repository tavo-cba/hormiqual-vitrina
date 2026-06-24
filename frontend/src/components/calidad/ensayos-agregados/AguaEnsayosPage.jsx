import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import EnsayoFormModal from "./EnsayoFormModal";
import { CumplimientoBadge } from "../common/CumplimientoBadge";
import { getEnsayos, deleteEnsayo, getTipos } from "../../../services/agregadoEnsayoService";
import { getAgua } from "../../../services/aguaService";
import "./ensayosAgregados.css";

/* ══════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════ */

const ESTADO_CONFIG = {
    VIGENTE:    { icon: "fa-solid fa-circle-check",         color: "#22c55e", label: "Vigente",    dotClass: "semaforo-verde" },
    POR_VENCER: { icon: "fa-solid fa-triangle-exclamation", color: "#eab308", label: "Por vencer", dotClass: "semaforo-amarillo" },
    VENCIDO:    { icon: "fa-solid fa-circle-xmark",         color: "#ef4444", label: "Vencido",    dotClass: "semaforo-rojo" },
    SIN_DATOS:  { icon: "fa-solid fa-circle-question",      color: "#9ca3af", label: "Sin datos",  dotClass: "semaforo-gris" },
};

const formatDate = (d) => d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
const fmtVal = (v, dec = 1) => v != null ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";

const PARAMETROS = [
    { key: "residuoSolido",   label: "Residuo sólido",      unit: "mg/L", dec: 0 },
    { key: "materiaOrganica", label: "Materia orgánica",     unit: "mg/L", dec: 1 },
    { key: "ph",              label: "pH",                   unit: "UpH",  dec: 1 },
    { key: "sulfato",         label: "Sulfato (SO₄²⁻)",     unit: "mg/L", dec: 0 },
    { key: "cloruro",         label: "Cloruro (Cl⁻)",       unit: "mg/L", dec: 0 },
    { key: "hierro",          label: "Hierro (Fe³⁺)",       unit: "mg/L", dec: 2 },
    { key: "alcalis",         label: "Álcalis",              unit: "mg/L", dec: 0 },
];

const FUENTE_LABELS = {
    RED_PUBLICA: "Agua potable de red",
    POZO: "Pozo",
    RECUPERADA_HORMIGON: "Recuperada (industria hormigón)",
    RESIDUAL_INDUSTRIAL: "Residual industrial",
    SUBTERRANEA: "Fuentes subterráneas",
    LLUVIA: "Agua de lluvia",
    SUPERFICIAL: "Superficial natural",
    MAR_SALOBRE: "Mar / salobre",
    RESIDUAL_CLOACAL_TRATADA: "Residual cloacal tratada",
};

/* ══════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════ */

const AguaEnsayosPage = () => {
    const { idAgua } = useParams();
    const showToast = useToast();

    const [agua, setAgua] = useState(null);
    const [ensayos, setEnsayos] = useState([]);
    const [tipos, setTipos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [editEnsayo, setEditEnsayo] = useState(null);
    const [formReadOnly, setFormReadOnly] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [aguaData, ensayosData, tiposData] = await Promise.all([
                getAgua(idAgua),
                getEnsayos({ legacyAgregadoId: idAgua }),
                getTipos({ material: "AGUA" }),
            ]);
            setAgua(aguaData);
            setEnsayos(ensayosData || []);
            setTipos(tiposData || []);
        } catch {
            showToast("error", "Error al cargar datos");
        } finally {
            setLoading(false);
        }
    }, [idAgua, showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // ─── Último ensayo (para la card de caracterización) ──
    const ultimoEnsayo = useMemo(() => {
        if (!ensayos.length) return null;
        const activos = ensayos.filter(e => e.isActive !== false);
        if (!activos.length) return null;
        return activos.sort((a, b) => new Date(b.fechaEnsayo || 0) - new Date(a.fechaEnsayo || 0))[0];
    }, [ensayos]);

    const ultimoResultado = useMemo(() => {
        if (!ultimoEnsayo) return null;
        let r = ultimoEnsayo.resultado;
        if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
        return r;
    }, [ultimoEnsayo]);

    // ─── Estado del ensayo (vigente/vencido) ──
    const ensayoEstado = useMemo(() => {
        if (!ultimoEnsayo) return "SIN_DATOS";
        const venc = ultimoEnsayo.fechaVencimiento;
        if (!venc) return "VIGENTE";
        const hoy = new Date();
        const fv = new Date(venc);
        const diffDays = (fv - hoy) / (1000 * 60 * 60 * 24);
        if (diffDays < 0) return "VENCIDO";
        if (diffDays < 60) return "POR_VENCER";
        return "VIGENTE";
    }, [ultimoEnsayo]);

    // ─── Resumen cards por tipo ──
    const tipoCards = useMemo(() => {
        return tipos.filter(t => t.isActive && t.visibleEnCards).map(tipo => {
            const ensayosTipo = ensayos.filter(e => e.idAgregadoEnsayoTipo === tipo.idAgregadoEnsayoTipo && e.isActive !== false);
            const ultimo = ensayosTipo.sort((a, b) => new Date(b.fechaEnsayo || 0) - new Date(a.fechaEnsayo || 0))[0];

            let estado = "SIN_DATOS";
            if (ultimo) {
                const venc = ultimo.fechaVencimiento;
                if (!venc) estado = "VIGENTE";
                else {
                    const diffDays = (new Date(venc) - new Date()) / (1000 * 60 * 60 * 24);
                    if (diffDays < 0) estado = "VENCIDO";
                    else if (diffDays < 60) estado = "POR_VENCER";
                    else estado = "VIGENTE";
                }
            }

            return { tipo, ultimo, estado, count: ensayosTipo.length };
        });
    }, [tipos, ensayos]);

    // ─── Conteos ──
    const counts = useMemo(() => {
        const c = { vigentes: 0, porVencer: 0, vencidos: 0, sinDatos: 0 };
        tipoCards.forEach(tc => {
            if (tc.estado === "VIGENTE") c.vigentes++;
            else if (tc.estado === "POR_VENCER") c.porVencer++;
            else if (tc.estado === "VENCIDO") c.vencidos++;
            else c.sinDatos++;
        });
        return c;
    }, [tipoCards]);

    // ─── Handlers ──
    const handleDelete = (ensayo) => {
        confirmDialog({
            message: "¿Eliminar este ensayo?",
            header: "Confirmar eliminación",
            icon: "pi pi-exclamation-triangle",
            acceptLabel: "Eliminar",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    await deleteEnsayo(ensayo.idAgregadoEnsayo);
                    showToast("success", "Ensayo eliminado");
                    fetchData();
                } catch { showToast("error", "Error al eliminar"); }
            },
        });
    };

    const handleSaved = () => {
        setModalVisible(false);
        setEditEnsayo(null);
        fetchData();
    };

    if (loading) return <LoadSpinner />;

    const estCfg = ESTADO_CONFIG[ensayoEstado] || ESTADO_CONFIG.SIN_DATOS;

    return (
        <Fade triggerOnce>
            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader
                    icon="fa-solid fa-droplet"
                    title={`Ensayos — ${agua?.nombre || "Agua"}`}
                    subtitle={`Estado y historial de ensayos IRAM 1601`}
                />

                {/* Semáforo */}
                <div className="flex flex-wrap gap-2 mb-3">
                    <Tag icon="fa-solid fa-circle-check" value={`${counts.vigentes} Vigentes`} severity="success" />
                    <Tag icon="fa-solid fa-triangle-exclamation" value={`${counts.porVencer} Por vencer`} severity="warning" />
                    <Tag icon="fa-solid fa-circle-xmark" value={`${counts.vencidos} Vencidos`} severity="danger" />
                    <Tag icon="fa-solid fa-circle-question" value={`${counts.sinDatos} Sin datos`} severity="info" />
                </div>

                {/* Caracterización del agua */}
                <div className="surface-card border-round border-1 border-300 p-3 mb-3 w-full">
                    <div className="flex align-items-center gap-2 mb-2">
                        <i className="fa-solid fa-vial text-primary" />
                        <span className="font-bold text-sm">Caracterización del agua</span>
                        {agua?.fuenteOrigen && (
                            <Tag value={FUENTE_LABELS[agua.fuenteOrigen] || agua.fuenteOrigen} severity="info" className="text-xs" />
                        )}
                        {agua?.planta && (
                            <Tag value={agua.planta.nombre || agua.planta} className="text-xs" />
                        )}
                    </div>
                    {ultimoResultado ? (
                        <div className="flex flex-wrap gap-4">
                            {PARAMETROS.map(p => {
                                const val = ultimoResultado[p.key];
                                return (
                                    <div key={p.key} className="text-center" style={{ minWidth: 90 }}>
                                        <small className="block text-color-secondary text-xs">{p.label}</small>
                                        <strong className="text-primary">{fmtVal(val, p.dec)}</strong>
                                        <small className="block text-color-secondary text-xs">{p.unit}</small>
                                    </div>
                                );
                            })}
                            <div className="text-center" style={{ minWidth: 90 }}>
                                <small className="block text-color-secondary text-xs">Fecha ensayo</small>
                                <strong>{formatDate(ultimoEnsayo?.fechaEnsayo)}</strong>
                                <small className="block text-color-secondary text-xs">{ultimoEnsayo?.nroInforme || ""}</small>
                            </div>
                        </div>
                    ) : (
                        <small className="text-color-secondary">Sin ensayos registrados</small>
                    )}
                </div>

                {/* Cards por tipo de ensayo */}
                <h4 className="mt-2 mb-2">
                    <i className="fa-solid fa-flask-vial mr-2" />
                    Análisis químico
                </h4>
                <div className="flex flex-wrap gap-3 mb-3 w-full">
                    {tipoCards.map(({ tipo, ultimo, estado, count }) => {
                        const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.SIN_DATOS;
                        let r = ultimo?.resultado;
                        if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }

                        return (
                            <div
                                key={tipo.idAgregadoEnsayoTipo}
                                className="surface-card border-round border-1 p-3 cursor-pointer hover:surface-hover"
                                style={{ minWidth: 280, maxWidth: 400, flex: "1 1 300px", borderColor: cfg.color, borderLeftWidth: 3 }}
                                onClick={() => { setEditEnsayo(ultimo || null); setModalVisible(true); }}
                            >
                                <div className="flex align-items-center justify-content-between mb-2">
                                    <span className="font-bold text-sm">{tipo.nombre}</span>
                                    <div className={`semaforo-dot ${cfg.dotClass}`} title={cfg.label} />
                                </div>
                                <div className="text-xs text-color-secondary mb-1">
                                    <i className="fa-solid fa-book mr-1" />{tipo.normaRef}
                                    {tipo.obligatorio && <Tag value="Obligatorio" severity="warning" className="ml-2 text-xs" style={{ fontSize: "0.55rem", padding: "1px 4px" }} />}
                                </div>
                                {ultimo ? (
                                    <>
                                        <small className="block text-color-secondary">Ensayo: {formatDate(ultimo.fechaEnsayo)}</small>
                                        {ultimo.fechaVencimiento && <small className="block text-color-secondary">Vence: {formatDate(ultimo.fechaVencimiento)}</small>}
                                        <CumplimientoBadge
                                            ensayo={ultimo}
                                            className="mt-1"
                                            style={{ fontSize: "0.65rem" }}
                                        />
                                    </>
                                ) : (
                                    <small className="text-color-secondary">Sin ensayos registrados <span style={{ color: "#eab308" }}>●</span></small>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Historial */}
                <h4 className="mt-3 mb-2">
                    <i className="fa-solid fa-clock-rotate-left mr-2" />
                    Historial
                </h4>
                <div className="flex justify-content-between align-items-center w-full mb-2">
                    <span className="text-sm text-color-secondary">{ensayos.length} ensayo{ensayos.length !== 1 ? "s" : ""}</span>
                    <Button
                        label="Nuevo ensayo"
                        icon="fa-solid fa-plus"
                        size="small"
                        onClick={() => { setEditEnsayo(null); setModalVisible(true); }}
                    />
                </div>

                <DataTable responsiveLayout="scroll"
                    value={ensayos}
                    size="small"
                    stripedRows
                    className="w-full"
                    emptyMessage="No hay ensayos registrados."
                    paginator
                    rows={10}
                    sortField="fechaEnsayo"
                    sortOrder={-1}
                >
                    <Column header="Fecha ensayo" body={(e) => formatDate(e.fechaEnsayo)} sortable field="fechaEnsayo" style={{ width: "110px" }} />
                    <Column header="Tipo" body={(e) => e.tipo?.nombre || "—"} style={{ width: "180px" }} />
                    <Column header="Norma" body={(e) => e.tipo?.normaRef || "—"} style={{ width: "100px" }} />
                    <Column header="Laboratorio" field="laboratorio" body={(e) => e.laboratorio || "—"} style={{ width: "200px" }} />
                    <Column header="N.° Informe" field="nroInforme" body={(e) => e.nroInforme || "—"} style={{ width: "120px" }} />
                    <Column
                        header="Cumple"
                        style={{ width: "100px" }}
                        body={(e) => <CumplimientoBadge ensayo={e} style={{ fontSize: "0.7rem" }} />}
                    />
                    <Column
                        header="Vencimiento"
                        style={{ width: "120px" }}
                        body={(e) => {
                            if (!e.fechaVencimiento) return "—";
                            const days = (new Date(e.fechaVencimiento) - new Date()) / (1000 * 60 * 60 * 24);
                            const cfg = days < 0 ? ESTADO_CONFIG.VENCIDO : days < 60 ? ESTADO_CONFIG.POR_VENCER : ESTADO_CONFIG.VIGENTE;
                            return (
                                <span className="flex align-items-center gap-1">
                                    <div className={`semaforo-dot ${cfg.dotClass}`} style={{ width: 8, height: 8 }} />
                                    {formatDate(e.fechaVencimiento)}
                                </span>
                            );
                        }}
                    />
                    <Column
                        header="Acciones"
                        style={{ width: "110px" }}
                        body={(e) => (
                            <div className="flex gap-1">
                                <Button icon="pi pi-eye" rounded text size="small" tooltip="Ver" tooltipOptions={{ position: "top" }} onClick={() => { setEditEnsayo(e); setFormReadOnly(true); setModalVisible(true); }} />
                                <Button icon="pi pi-pencil" rounded text size="small" tooltip="Editar" tooltipOptions={{ position: "top" }} onClick={() => { setEditEnsayo(e); setFormReadOnly(false); setModalVisible(true); }} />
                                <Button icon="pi pi-trash" rounded text severity="danger" size="small" tooltip="Eliminar" tooltipOptions={{ position: "top" }} onClick={() => handleDelete(e)} />
                            </div>
                        )}
                    />
                </DataTable>

                {/* Modal */}
                <EnsayoFormModal
                    visible={modalVisible}
                    onHide={() => { setModalVisible(false); setEditEnsayo(null); setFormReadOnly(false); }}
                    legacyAgregadoId={Number(idAgua)}
                    tipos={tipos}
                    ensayo={editEnsayo}
                    readOnly={formReadOnly}
                    onSaved={handleSaved}
                />
            </div>
        </Fade>
    );
};

export default AguaEnsayosPage;
