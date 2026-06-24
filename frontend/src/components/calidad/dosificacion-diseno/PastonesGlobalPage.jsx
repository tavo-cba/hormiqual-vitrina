import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { useToast } from "../../../context/ToastContext";
import { listarPastonesGlobal } from "../../../services/dosificacionDisenoService";

/**
 * PR11 — Dashboard global de pastones del tenant.
 *
 * Pantalla read-only que muestra todos los pastones cargados con filtros
 * por veredicto, estado de la dosificación asociada, planta y rango de
 * fechas. Permite saltar a la dosificación correspondiente para revisar el
 * pastón en detalle.
 */

const VEREDICTO_OPTIONS = [
    { label: "Todos", value: null },
    { label: "Pendiente (sin veredicto)", value: "PENDIENTE" },
    { label: "Aprobado", value: "APROBADO" },
    { label: "Rechazado", value: "RECHAZADO" },
    { label: "Observado", value: "OBSERVADO" },
];

const ESTADO_OPTIONS = [
    { label: "Todos", value: null },
    { label: "Borrador", value: "BORRADOR" },
    { label: "Pendiente revisión", value: "PENDIENTE_REVISION" },
    { label: "A prueba", value: "A_PRUEBA" },
    { label: "En producción", value: "EN_PRODUCCION" },
    { label: "Suspendido", value: "SUSPENDIDO" },
    { label: "Archivado", value: "ARCHIVADO" },
];

const veredictoSeverity = (v) => {
    if (!v) return "warning";
    if (v === "APROBADO") return "success";
    if (v === "RECHAZADO") return "danger";
    return "info";
};

const fmtFecha = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("es-AR");
};

const PastonesGlobalPage = () => {
    const showToast = useToast();
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState([]);
    const [veredicto, setVeredicto] = useState(null);
    const [estado, setEstado] = useState(null);
    const [search, setSearch] = useState("");

    const fetchPastones = async () => {
        setLoading(true);
        try {
            const data = await listarPastonesGlobal({
                veredicto: veredicto || undefined,
                estado: estado || undefined,
            });
            setRows(data || []);
        } catch (err) {
            console.error("Error cargando pastones globales:", err);
            showToast("error", "No se pudieron cargar los pastones");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPastones();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [veredicto, estado]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) =>
            (r.dosificacionDisenada?.nombre || "").toLowerCase().includes(q)
            || (r.dosificacionDisenada?.codigoHormigon || "").toLowerCase().includes(q)
            || (r.operador || "").toLowerCase().includes(q)
        );
    }, [rows, search]);

    return (
        <div className="p-3">
            <PageHeader
                icon="fa-solid fa-flask"
                title="Pastones de prueba"
                subtitle="Vista global de todos los pastones. Filtrá por veredicto, estado o planta y entrá a la dosificación para ver el detalle."
            />

            <div className="surface-card border-1 surface-border border-round p-3 mb-3 flex gap-2 align-items-end flex-wrap">
                <div className="flex flex-column">
                    <small className="font-bold mb-1">Veredicto</small>
                    <Dropdown
                        value={veredicto}
                        options={VEREDICTO_OPTIONS}
                        onChange={(e) => setVeredicto(e.value)}
                        showClear
                        placeholder="Todos"
                        style={{ minWidth: 220 }}
                    />
                </div>
                <div className="flex flex-column">
                    <small className="font-bold mb-1">Estado de la dosificación</small>
                    <Dropdown
                        value={estado}
                        options={ESTADO_OPTIONS}
                        onChange={(e) => setEstado(e.value)}
                        showClear
                        placeholder="Todos"
                        style={{ minWidth: 220 }}
                    />
                </div>
                <div className="flex flex-column flex-1" style={{ minWidth: 220 }}>
                    <small className="font-bold mb-1">Buscar (nombre dosif. / código / operador)</small>
                    <InputText value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." />
                </div>
                <Button
                    icon="fa-solid fa-arrows-rotate"
                    label="Refrescar"
                    onClick={fetchPastones}
                    size="small"
                    outlined
                />
            </div>

            {loading ? (
                <div className="flex justify-content-center p-5"><LoadSpinner /></div>
            ) : (
                <DataTable
                    value={filtered}
                    paginator
                    rows={20}
                    emptyMessage="Sin pastones para los filtros aplicados."
                    size="small"
                    stripedRows
                >
                    <Column header="Fecha" body={(r) => fmtFecha(r.fecha || r.createdAt)} style={{ width: "9rem" }} />
                    <Column header="Dosificación" body={(r) => (
                        <Link to={`/calidad/dosificacion-diseno/${r.dosificacionDisenada?.id || r.idDosificacionDisenada}`}>
                            {r.dosificacionDisenada?.nombre || `Dosif #${r.idDosificacionDisenada}`}
                            {r.dosificacionDisenada?.codigoHormigon && (
                                <span className="text-color-secondary text-xs ml-2">({r.dosificacionDisenada.codigoHormigon})</span>
                            )}
                        </Link>
                    )} />
                    <Column header="Estado dosif." body={(r) => (
                        <Tag value={r.dosificacionDisenada?.estado || "—"} severity="secondary" />
                    )} style={{ width: "11rem" }} />
                    <Column header="Escala" body={(r) => r.escala || "LABORATORIO"} style={{ width: "7rem" }} />
                    <Column header="Volumen" body={(r) => `${Number(r.volumenM3).toFixed(3)} m³`} style={{ width: "7rem" }} />
                    <Column header="Ronda" body={(r) => `#${r.numeroRondaPrueba || 1}`} style={{ width: "5rem" }} />
                    <Column header="Veredicto" body={(r) => (
                        <Tag
                            value={r.veredicto || "PENDIENTE"}
                            severity={veredictoSeverity(r.veredicto)}
                        />
                    )} style={{ width: "8rem" }} />
                    <Column header="Operador" field="operador" body={(r) => r.operador || "—"} style={{ width: "10rem" }} />
                    <Column header="Creado" body={(r) => r.createdBy || "—"} style={{ width: "10rem" }} />
                </DataTable>
            )}
        </div>
    );
};

export default PastonesGlobalPage;
