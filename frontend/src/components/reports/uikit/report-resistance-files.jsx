import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";

import "./reports-shared.css";
import "./report-resistance-files.css";
import { config } from "../../../config/config";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { formatDateDMY, formatDateDMYExact, formatPersonName } from "../../../common/functions";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";

const ReporteResistenciaFiles = () => {
    const [reportes, setReportes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [deletingId, setDeletingId] = useState(null);
    const [probetasDialogOpen, setProbetasDialogOpen] = useState(false);
    const [selectedReporte, setSelectedReporte] = useState(null);
    const showToast = useToast();

    const loadReportes = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${config.backendUrl}/api/reportes-resistencia`, {
                headers: config.headers,
            });
            setReportes(response.data ?? []);
        } catch (error) {
            console.error(error);
            setReportes([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadReportes();
    }, []);

    const formatFecha = (value) => (value ? formatDateDMYExact(value) : "—");

    const getClienteName = (probeta) => {
        const cliente = probeta.muestra?.despacho?.cliente || probeta?.muestraTerceros?.cliente;
        if (!cliente) return "Cliente sin asignar";
        if (cliente.tipoPersona === "Jurídica") return cliente.razonSocial || "Cliente";
        const persona = formatPersonName(cliente.nombre, cliente.apellido).trim();
        return persona || cliente.nombre || "Cliente";
    };

    const getMuestraInfo = (probeta) => {
        const propiaId = probeta.muestra?.idMuestra ?? probeta.idMuestra;
        const tercerosId = probeta.muestraTerceros?.idMuestraTerceros ?? probeta.idMuestraTerceros;
        if (propiaId) {
            return {
                key: `propia-${propiaId}`,
                label: `Muestra #${propiaId}`,
                origen: "Propio",
            };
        }
        if (tercerosId) {
            return {
                key: `terceros-${tercerosId}`,
                label: `Muestra #${tercerosId}`,
                origen: "Terceros",
            };
        }
        return {
            key: `sin-muestra-${probeta.idProbeta}`,
            label: "Muestra sin identificar",
            origen: probeta.idMuestraTerceros ? "Terceros" : "Propio",
        };
    };

    const getFechaConfeccion = (probeta) => probeta.muestra?.despacho?.fecha || probeta.muestraTerceros?.fecha;

    const getPeriodo = (reporte) => {
        const desde = formatFecha(reporte.fechaDesde);
        const hasta = formatFecha(reporte.fechaHasta);
        if (desde !== "—" && hasta !== "—") {
            return `${desde} - ${hasta}`;
        }
        if (desde !== "—") return `Desde ${desde}`;
        if (hasta !== "—") return `Hasta ${hasta}`;
        return "—";
    };

    const getOrigenReporte = (reporte) => {
        const probetas = reporte.probetas ?? [];
        const hasTerceros = probetas.some((p) => p.idMuestraTerceros);
        const hasPropias = probetas.some((p) => p.idMuestra);
        if (hasTerceros && hasPropias) return "Mixto";
        if (hasTerceros) return "Terceros";
        if (hasPropias) return "Propio";
        return "—";
    };

    const getOrigenClass = (origen) => {
        switch (origen) {
            case "Terceros":
                return "rpt-pill--warning";
            case "Propio":
                return "rpt-pill--info";
            case "Mixto":
                return "rpt-pill--mixed";
            default:
                return "rpt-pill--neutral";
        }
    };

    const filteredReportes = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return reportes;
        return reportes.filter((reporte) => {
            const empleado = formatPersonName(reporte.empleado?.nombre, reporte.empleado?.apellido).toLowerCase();
            const link = (reporte.link || "").toLowerCase();
            const probetas = (reporte.probetas || [])
                .map((p) => `${p.nombre ?? ""} ${p.codigo ?? ""}`.trim().toLowerCase())
                .join(" ");
            const periodo = getPeriodo(reporte).toLowerCase();
            return empleado.includes(term) || link.includes(term) || probetas.includes(term) || periodo.includes(term);
        });
    }, [reportes, searchTerm]);

    const stats = useMemo(() => {
        if (!reportes.length) return null;
        const oficiales = reportes.filter((r) => r.oficial).length;
        const noOficiales = reportes.length - oficiales;
        const totalProbetas = reportes.reduce((acc, r) => acc + (r.probetas?.length || 0), 0);
        const terceros = reportes.filter((r) => getOrigenReporte(r) === "Terceros").length;
        return {
            total: reportes.length,
            oficiales,
            noOficiales,
            totalProbetas,
            terceros,
        };
    }, [reportes]);

    const handleDownload = (reporte) => {
        if (!reporte?.link) return;
        const anchor = document.createElement("a");
        anchor.href = reporte.link;
        anchor.target = "_blank";
        anchor.rel = "noreferrer";
        const urlSegments = reporte.link.split("/");
        anchor.download = urlSegments[urlSegments.length - 1] || "reporte-resistencia";
        anchor.click();
    };

    const confirmDelete = (reporte) => {
        confirmDialog({
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i
                        className="fa-solid fa-triangle-exclamation mb-3"
                        style={{ fontSize: "2.6rem", color: "var(--lightred)" }}
                    ></i>
                    <span>
                        ¿Seguro que querés borrar el reporte #{reporte.idReporteResistencia}? Esta acción no se puede
                        deshacer.
                    </span>
                </div>
            ),
            header: "Borrar reporte",
            defaultFocus: "accept",
            acceptLabel: (
                <span className="mr-2 ml-2">
                    <i className="fa-solid fa-trash mr-2"></i>Borrar
                </span>
            ),
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: () => handleDelete(reporte.idReporteResistencia),
            reject: null,
        });
    };

    const handleDelete = async (id) => {
        try {
            setDeletingId(id);
            await axios.delete(`${config.backendUrl}/api/reportes-resistencia/${id}`, {
                headers: config.headers,
            });
            setReportes((prev) => prev.filter((r) => r.idReporteResistencia !== id));
            showToast("success", "Reporte eliminado correctamente");
        } catch (error) {
            console.error(error);
            showToast("error", "No se pudo eliminar el reporte");
        } finally {
            setDeletingId(null);
        }
    };

    const oficialTemplate = (reporte) => (
        <span className={`rpt-pill ${reporte.oficial ? "rpt-pill--success" : "rpt-pill--neutral"}`}>
            <i className={`fa-solid ${reporte.oficial ? "fa-circle-check" : "fa-circle-info"}`} />
            {reporte.oficial ? "Oficial" : "Borrador"}
        </span>
    );

    const origenTemplate = (reporte) => {
        const origen = getOrigenReporte(reporte);
        return (
            <span className={`rpt-pill ${getOrigenClass(origen)}`}>
                <i className="fa-solid fa-layer-group" />
                {origen}
            </span>
        );
    };

    const empleadoTemplate = (reporte) => {
        const nombre = formatPersonName(reporte.empleado?.nombre, reporte.empleado?.apellido);
        return (
            <span className={nombre ? "rpt-text-strong" : "rpt-text-muted"}>{nombre || "Sin asignar"}</span>
        );
    };

    const renderProbetasList = (probetas) => {
        const grouped = probetas.reduce((acc, probeta) => {
            const cliente = getClienteName(probeta);
            const muestra = getMuestraInfo(probeta);
            if (!acc[cliente]) {
                acc[cliente] = { cliente, muestras: {} };
            }
            if (!acc[cliente].muestras[muestra.key]) {
                acc[cliente].muestras[muestra.key] = { ...muestra, probetas: [] };
            }
            acc[cliente].muestras[muestra.key].probetas.push(probeta);
            return acc;
        }, {});

        const clientes = Object.values(grouped).sort((a, b) => a.cliente.localeCompare(b.cliente));

        return (
            <div className="rpt-probetas-groups">
                {clientes.map((grupo) => {
                    const muestras = Object.values(grupo.muestras).sort((a, b) => a.label.localeCompare(b.label));
                    const totalProbetas = muestras.reduce((acc, muestra) => acc + muestra.probetas.length, 0);
                    return (
                        <div key={grupo.cliente} className="rpt-probetas-group">
                            <div className="rpt-probetas-group-header">
                                <div>
                                    <p className="rpt-probetas-group-label">Cliente</p>
                                    <h4 className="rpt-probetas-group-title">{grupo.cliente}</h4>
                                </div>
                                <span className="rpt-probetas-group-count">
                                    {totalProbetas} probeta{totalProbetas !== 1 ? "s" : ""}
                                </span>
                            </div>
                            <div className="rpt-probetas-muestras">
                                {muestras.map((muestra) => (
                                    <div key={muestra.key} className="rpt-probetas-muestra">
                                        <div className="rpt-probetas-muestra-header">
                                            <div className="rpt-probetas-muestra-title">
                                                <span>{muestra.label}</span>
                                                <span
                                                    className={`rpt-probeta-pill ${muestra.origen === "Terceros" ? "rpt-probeta-pill--terceros" : "rpt-probeta-pill--propio"
                                                        }`}
                                                >
                                                    {muestra.origen}
                                                </span>
                                            </div>
                                            <span className="rpt-probetas-muestra-count">
                                                {muestra.probetas.length} probeta{muestra.probetas.length !== 1 ? "s" : ""}
                                            </span>
                                        </div>
                                        <div className="rpt-probeta-list">
                                            {muestra.probetas
                                                .slice()
                                                .sort((a, b) => {
                                                    const nameA = a.nombre || a.codigo || "";
                                                    const nameB = b.nombre || b.codigo || "";
                                                    return nameA.localeCompare(nameB);
                                                })
                                                .map((probeta) => (
                                                    <div key={probeta.idProbeta} className="rpt-probeta-item">
                                                        <div className="rpt-probeta-main justify-content-between">
                                                            <span className="rpt-probeta-name">
                                                                {probeta.nombre ?? `Probeta #${probeta.idProbeta}`}
                                                            </span>
                                                            <div className="flex gap-4">
                                                                {probeta.idProbeta && (
                                                                    <span className="rpt-probeta-code">ID #{probeta.idProbeta}</span>
                                                                )}
                                                                {probeta.codigo && (
                                                                    <span className="rpt-probeta-code">Código #{probeta.codigo}</span>
                                                                )}
                                                            </div>

                                                        </div>
                                                        <div className="rpt-probeta-meta">
                                                            <span>
                                                                <i className="fa-solid fa-calendar-check" />
                                                                Confección: {formatFecha(getFechaConfeccion(probeta))}
                                                            </span>
                                                            <span>
                                                                <i className="fa-solid fa-calendar-day" />
                                                                Rotura: {formatFecha(probeta.fechaRotura)}
                                                            </span>
                                                            {probeta.diasRotura && (
                                                                <span>
                                                                    <i className="fa-solid fa-hourglass-half" />
                                                                    {probeta.diasRotura} días
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const openProbetasDialog = (reporte) => {
        setSelectedReporte(reporte);
        setProbetasDialogOpen(true);
    };

    const probetasTemplate = (reporte) => {
        const probetas = reporte.probetas ?? [];
        if (!probetas.length) {
            return <span className="rpt-text-muted">Sin probetas asociadas</span>;
        }
        return (
            <button type="button" className="rpt-probeta-link" onClick={() => openProbetasDialog(reporte)}>
                <i className="fa-solid fa-flask" />
                Ver probetas ({probetas.length})
            </button>
        );
    };

    const accionesTemplate = (reporte) => (
        <div className="rpt-action-buttons">
            <Button
                rounded
                icon="fa-solid fa-download"
                label=""
                size="small"
                onClick={() => handleDownload(reporte)}
                disabled={!reporte.link}
            />
            <Button
                rounded
                icon="fa-solid fa-trash"
                label=""
                size="small"
                severity="danger"
                loading={deletingId === reporte.idReporteResistencia}
                onClick={() => confirmDelete(reporte)}
            />
        </div>
    );

    return (
        <div className="reports-module reports-resistencia">
            <Dialog
                visible={probetasDialogOpen}
                onHide={() => setProbetasDialogOpen(false)}
                header={`Probetas del reporte #${selectedReporte?.idReporteResistencia ?? ""}`}
                className="rpt-probetas-dialog"
                draggable={false}
                resizable={false}
            >
                {selectedReporte?.probetas?.length ? (
                    renderProbetasList(selectedReporte.probetas)
                ) : (
                    <span className="rpt-text-muted">Sin probetas asociadas</span>
                )}
            </Dialog>
            <div className="rpt-main-panel">
                <PageHeader
                    icon="fa-solid fa-file-shield"
                    title="Reportes de resistencia"
                    subtitle="Gestión de archivos PDF de reportes de ensayos"
                />
                {reportes.length > 0 && (
                    <div className="flex justify-content-end mb-3">
                        <span className="rpt-report-badge rpt-report-badge--resistencia">
                            <i className="fa-solid fa-folder-open" />
                            {reportes.length} reporte{reportes.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                )}

                {stats && !loading && (
                    <div className="rpt-stats-row">
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Total reportes</p>
                            <p className="rpt-stat-value">{stats.total}</p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Oficiales</p>
                            <p className="rpt-stat-value" style={{ color: "var(--green-500)" }}>
                                {stats.oficiales}
                            </p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Borradores</p>
                            <p className="rpt-stat-value" style={{ color: "var(--orange-500)" }}>
                                {stats.noOficiales}
                            </p>
                        </div>
                        <div className="rpt-stat-card">
                            <p className="rpt-stat-label">Reportes terceros</p>
                            <p className="rpt-stat-value" style={{ color: "var(--purple-500)" }}>
                                {stats.terceros}
                            </p>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="rpt-loading">
                        <LoadSpinner />
                    </div>
                ) : reportes.length > 0 ? (
                    <div className="rpt-table-card w-full">
                        <div className="rpt-table-header rpt-table-header--stack">
                            <div>
                                <h3 className="rpt-table-title">
                                    <i className="fa-solid fa-list rpt-table-title-icon rpt-table-title-icon--resistencia" />
                                    Listado de reportes
                                </h3>
                                <span className="rpt-table-count">
                                    {filteredReportes.length} registro{filteredReportes.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            <span className="rpt-search">
                                
                                <InputText
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar reporte..."
                                    title="Buscar por empleado, período o probeta"
                                    className="search-bar"
                                />
                            </span>
                        </div>
                        <div className="rpt-datatable">
                            <DataTable
                                value={filteredReportes}
                                paginator
                                rows={20}
                                rowsPerPageOptions={[20, 50, 100]}
                                scrollable
                                emptyMessage={
                                    <div className="rpt-empty-state" style={{ padding: "2rem" }}>
                                        <p>No se encontraron reportes con esos filtros.</p>
                                    </div>
                                }
                            >
                                <Column
                                    header="Reporte"
                                    body={(row) => (
                                        <span className="rpt-text-strong">#{row.idReporteResistencia}</span>
                                    )}
                                />
                                <Column header="Período" body={getPeriodo} sortable field="fechaDesde" />
                                <Column header="Oficial" body={oficialTemplate} sortable field="oficial" />
                                <Column header="Origen" body={origenTemplate} />
                                <Column header="Empleado" body={empleadoTemplate} sortable />
                                <Column
                                    header="Creado"
                                    body={(row) => formatFecha(row.createdAt)}
                                    sortable
                                    field="createdAt"
                                />
                                <Column header="Probetas" body={probetasTemplate} />
                                <Column header="Acciones" body={accionesTemplate} />
                            </DataTable>
                        </div>
                    </div>
                ) : (
                    <div className="rpt-empty-state">
                        <div className="rpt-empty-state-icon">
                            <i className="fa-solid fa-file-shield" />
                        </div>
                        <h2 className="rpt-empty-state-title">Sin reportes</h2>
                        <p className="rpt-empty-state-text">
                            Todavía no se cargaron reportes de resistencia. Cuando haya archivos disponibles, vas a poder
                            descargarlos y gestionarlos desde acá.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReporteResistenciaFiles;