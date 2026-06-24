import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { useToast } from "../../../context/ToastContext";
import {
    listarPendientesRevisionMias,
    obtenerHistorialEnriquecido,
} from "../../../services/dosificacionDisenoService";
import DisenoHistorialTimeline from "../dosificacion-diseno/DisenoHistorialTimeline";
import { formatDateDMY } from "../../../common/functions";

/**
 * "Por revisar" — lista las dosificaciones que esperan revisión asignadas al
 * usuario logueado (DosificacionDisenada.revisorAsignado coincide con el user).
 *
 * El listado se vacía automáticamente cuando el revisor aprueba (→ A_PRUEBA)
 * o rechaza (→ BORRADOR) desde el diseñador: el endpoint filtra por estado
 * PENDIENTE_REVISION, así que en el próximo refresh la fila desaparece sin
 * lógica adicional en el frontend.
 *
 * Trazabilidad: cada fila tiene un toggle "Historial" que renderiza el
 * `DisenoHistorialTimeline` ya usado en el diseñador (cambios de estado,
 * aprobaciones, rechazos, etc.) para que el revisor entienda el contexto sin
 * tener que entrar al diseñador.
 */

const fmtHora = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const fecha = formatDateDMY(d);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${fecha} ${h}:${m}`;
};

export default function RevisionesDosificaciones() {
    const navigate = useNavigate();
    const toast = useToast();

    const [dosificaciones, setDosificaciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [first, setFirst] = useState(0);
    const [expandedRows, setExpandedRows] = useState({});
    const [historialPorId, setHistorialPorId] = useState({}); // { idDosif: { eventos, resumen, loading } }

    const cargar = useCallback(async () => {
        try {
            setLoading(true);
            const data = await listarPendientesRevisionMias();
            setDosificaciones(data || []);
        } catch (err) {
            console.error("[RevisionesDosificaciones] cargar:", err);
            toast("error", "No se pudieron cargar las dosificaciones pendientes.");
            setDosificaciones([]);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { cargar(); }, [cargar]);

    useEffect(() => { setFirst(0); }, [search]);

    const filtradas = useMemo(() => {
        if (!search.trim()) return dosificaciones;
        const s = search.toLowerCase();
        return dosificaciones.filter((d) => {
            const haystack = [
                d.id,
                d.codigo,
                d.nombre,
                d.enviadoRevisionPor,
                d.planta?.nombre,
                d.tipoHormigon?.tipoHormigon,
            ].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(s);
        });
    }, [dosificaciones, search]);

    /* ── Historial perezoso por fila expandida ── */
    const cargarHistorial = useCallback(async (id) => {
        setHistorialPorId((prev) => ({
            ...prev,
            [id]: { ...(prev[id] || {}), loading: true },
        }));
        try {
            const data = await obtenerHistorialEnriquecido(id);
            setHistorialPorId((prev) => ({
                ...prev,
                [id]: { eventos: data?.eventos || [], resumen: data?.resumen || null, loading: false },
            }));
        } catch (err) {
            console.error("[RevisionesDosificaciones] obtenerHistorial:", err);
            toast("error", "No se pudo cargar el historial.");
            setHistorialPorId((prev) => ({ ...prev, [id]: { eventos: [], resumen: null, loading: false } }));
        }
    }, [toast]);

    const onRowExpand = (e) => {
        const row = e.data;
        if (!historialPorId[row.id]) cargarHistorial(row.id);
    };

    const rowExpansionTemplate = (row) => {
        const h = historialPorId[row.id];
        if (!h || h.loading) {
            return (
                <div className="p-3 flex justify-content-center">
                    <ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="4" />
                </div>
            );
        }
        return (
            <div className="p-3 surface-50 border-round">
                <DisenoHistorialTimeline
                    historial={h.eventos}
                    resumen={h.resumen}
                    dosifLabel={row.codigo || `dosif-${row.id}`}
                />
            </div>
        );
    };

    /* ── Renderers de columnas ── */
    const tipoHBody = (r) => {
        const nombre = r.tipoHormigon?.tipoHormigon;
        if (!nombre) return <span className="text-color-secondary">—</span>;
        return <Tag value={nombre} severity="info" />;
    };

    const accionesBody = (r) => (
        <div className="flex gap-2 justify-content-end">
            <Button
                label="Revisar"
                icon="fa-solid fa-arrow-up-right-from-square"
                size="small"
                tooltip="Abre el diseñador para inspeccionar el cálculo y aprobar/rechazar"
                tooltipOptions={{ position: "top" }}
                onClick={() => navigate(`/calidad/dosificacion-diseno?load=${r.id}`)}
            />
        </div>
    );

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader
                    icon="fa-solid fa-file-signature"
                    title="Dosificaciones por revisar"
                    subtitle="Diseños que esperan tu aprobación. Al aprobar para prueba o rechazar, salen del listado automáticamente."
                />

                <div className="flex align-items-center w-full mb-2 gap-2 justify-content-between">
                    <span className="search-bar-wrapper">
                        <InputText
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar por código, planta, tipo, quien envió…"
                            className="search-bar"
                        />
                    </span>
                    <Button
                        icon="fa-solid fa-rotate"
                        outlined
                        size="small"
                        tooltip="Refrescar"
                        tooltipOptions={{ position: "top" }}
                        onClick={cargar}
                        loading={loading}
                    />
                </div>

                {loading ? (
                    <div className="w-full flex justify-content-center p-5">
                        <ProgressSpinner />
                    </div>
                ) : dosificaciones.length === 0 ? (
                    <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center w-full">
                        <i className="fa-solid fa-check-circle text-color-secondary mb-2" style={{ fontSize: "2.4rem" }} />
                        <h2 className="mb-2 mt-0">No tenés dosificaciones para revisar</h2>
                        <span className="text-color-secondary">
                            Cuando alguien te asigne como revisor de un diseño, va a aparecer acá.
                        </span>
                    </div>
                ) : (
                    <DataTable
                        value={filtradas}
                        emptyMessage={<h3>No hay coincidencias</h3>}
                        stripedRows
                        paginator
                        rows={25}
                        first={first}
                        onPage={(e) => setFirst(e.first)}
                        className="w-full"
                        dataKey="id"
                        expandedRows={expandedRows}
                        onRowToggle={(e) => setExpandedRows(e.data)}
                        onRowExpand={onRowExpand}
                        rowExpansionTemplate={rowExpansionTemplate}
                    >
                        <Column expander style={{ width: 48 }} />
                        <Column header="Código" body={(r) => r.codigo || `#${r.id}`} style={{ width: 140 }} />
                        <Column header="Nombre" body={(r) => r.nombre || "—"} />
                        <Column header="Planta" body={(r) => r.planta?.nombre || "—"} />
                        <Column header="Tipo H°" body={tipoHBody} style={{ width: 110 }} />
                        <Column header="Versión" body={(r) => r.version ?? "—"} style={{ width: 90, textAlign: "center" }} />
                        <Column header="Enviado por" body={(r) => r.enviadoRevisionPor || "—"} />
                        <Column header="Fecha envío" body={(r) => fmtHora(r.fechaEnvioRevision)} style={{ width: 150 }} />
                        <Column header="Acciones" body={accionesBody} style={{ width: 140, textAlign: "right" }} />
                    </DataTable>
                )}
            </div>
        </Fade>
    );
}
