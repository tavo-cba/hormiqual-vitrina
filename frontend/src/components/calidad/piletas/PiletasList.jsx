import React, { useEffect, useState, useCallback, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { confirmDialog } from "primereact/confirmdialog";
import { Fade } from "react-awesome-reveal";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useMenuContext } from "../../../context/MenuContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { listLaboratorios } from "../../../services/laboratorioService";
import "./PiletasList.css";

const PiletasList = () => {
    const [piletas, setPiletas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [delLoad, setDelLoad] = useState(false);
    const [selectedPiletas, setSelectedPiletas] = useState([]);
    const [bulkDialog, setBulkDialog] = useState({ visible: false, idLaboratorio: null });
    const [labsForBulk, setLabsForBulk] = useState([]);
    const [bulkLoading, setBulkLoading] = useState(false);
    const bulkRef = useRef(false);
    const delRef = useRef(false);
    const toast = useToast();
    const navigate = useNavigate();
    const { getActions } = useMenuContext();
    const { puedeAgregar, puedeEditar, puedeBorrar } = getActions('/calidad/piletas');

    const openBulkDialog = async () => {
        try {
            const data = await listLaboratorios();
            setLabsForBulk(Array.isArray(data) ? data : []);
            setBulkDialog({ visible: true, idLaboratorio: null });
        } catch {
            toast('error', 'No se pudieron cargar los laboratorios.');
        }
    };

    const handleBulkAssign = async () => {
        if (bulkRef.current) return;
        if (!bulkDialog.idLaboratorio) {
            toast('warn', 'Seleccioná un laboratorio.');
            return;
        }
        bulkRef.current = true;
        setBulkLoading(true);
        try {
            const { data } = await axios.post(
                `${config.backendUrl}/api/piletas/bulk-assign-lab`,
                {
                    idLaboratorio: bulkDialog.idLaboratorio,
                    idsPileta: selectedPiletas.map((p) => p.idPileta),
                },
                { headers: config.headers }
            );
            toast('success', `${data.updated} pileta(s) asignada(s) al laboratorio.`);
            setBulkDialog({ visible: false, idLaboratorio: null });
            setSelectedPiletas([]);
            // re-fetch
            const res = await axios.get(`${config.backendUrl}/api/piletas`, { headers: config.headers });
            setPiletas(res.data);
        } catch (err) {
            toast('error', err?.response?.data?.error || 'No se pudo asignar el laboratorio.');
        } finally {
            bulkRef.current = false;
            setBulkLoading(false);
        }
    };

    const fetchPiletas = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await axios.get(`${config.backendUrl}/api/piletas`, { headers: config.headers });
            setPiletas(data);
        } catch {
            toast("error", "No se pudieron cargar las piletas");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPiletas();
        const interval = setInterval(fetchPiletas, 60000);
        return () => clearInterval(interval);
    }, [fetchPiletas]);

    const borrar = async (id) => {
        if (delRef.current) return;
        try {
            delRef.current = true;
            setDelLoad(true);
            await axios.delete(`${config.backendUrl}/api/piletas/${id}`, { headers: config.headers });
            setPiletas(prev => prev.filter(p => p.idPileta !== id));
            toast("success", "Pileta eliminada");
        } catch {
            toast("error", "Error al eliminar");
        } finally {
            delRef.current = false;
            setDelLoad(false);
        }
    };

    const confirmarBorrado = (id) =>
        confirmDialog({
            header: "Eliminar pileta",
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}></i>
                    <span>¿Estás seguro que quieres borrar esta pileta?</span>
                </div>
            ),
            acceptClassName: "p-button-danger",
            acceptLabel: <span><i className="fa-solid fa-trash mr-2" />Borrar</span>,
            accept: () => borrar(id),
            rejectLabel: "Cancelar",
        });

    const getEstado = (p) => {
        if (!p.estado) return { label: "Sin datos", severity: "secondary", icon: "fa-solid fa-circle-question" };
        const mins = p.estado.ultimaActualizacion
            ? Math.floor((Date.now() - new Date(p.estado.ultimaActualizacion).getTime()) / 60000)
            : null;
        if (mins !== null && mins > 5) return { label: `Sin conexión (${mins} min)`, severity: "warning", icon: "fa-solid fa-plug-circle-xmark" };
        if (p.estado.temperaturaActual != null && p.estado.temperaturaObjetivo != null) {
            const diff = Math.abs(Number(p.estado.temperaturaActual) - Number(p.estado.temperaturaObjetivo));
            if (diff > Number(p.umbralAlerta)) return { label: "Alerta", severity: "danger", icon: "fa-solid fa-triangle-exclamation" };
        }
        return { label: "Normal", severity: "success", icon: "fa-solid fa-check-circle" };
    };

    const formatTemp = (val) => val != null ? `${Number(val).toFixed(1)}°C` : "—";
    const formatTime = (iso) => {
        if (!iso) return "—";
        const d = new Date(iso);
        return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    };

    const cols = [
        {
            header: "Nombre",
            body: (p) => (
                <div className="flex align-items-center gap-1">
                    <Button rounded icon="fa-solid fa-sliders" size="small" severity="info" text
                        tooltip="Panel de control" tooltipOptions={{ position: 'top' }}
                        onClick={() => navigate(`/calidad/piletas/${p.idPileta}/panel`)} />
                    <span className="font-bold">{p.nombre}</span>
                    {puedeEditar && (
                        <Button rounded icon="fa-solid fa-pencil" size="small" style={{ scale: '0.8' }}
                            onClick={() => navigate(`/calidad/piletas/editar/${p.idPileta}`)} />
                    )}
                </div>
            ),
        },
        { header: "Planta", body: (p) => <span>{p.planta?.nombre || "—"}</span> },
        {
            header: "Curando",
            body: (p) => {
                const n = Number(p.probetasCurando || 0);
                return n > 0
                    ? <Tag value={`${n} probeta${n !== 1 ? 's' : ''}`} severity="info" icon="fa-solid fa-flask" />
                    : <span className="text-500">—</span>;
            },
        },
        {
            header: "Temp. Actual",
            body: (p) => {
                const estado = getEstado(p);
                return <span className={estado.severity === "danger" ? "font-bold text-red-500" : "font-bold"}>
                    {formatTemp(p.estado?.temperaturaActual)}
                </span>;
            },
        },
        { header: "Temp. Objetivo", body: (p) => <span>{formatTemp(p.estado?.temperaturaObjetivo)}</span> },
        {
            header: "Bombas",
            body: (p) => p.estado ? (
                <Tag value={p.estado.bombasEncendidas ? "Encendidas" : "Apagadas"}
                    severity={p.estado.bombasEncendidas ? "success" : "secondary"}
                    icon={p.estado.bombasEncendidas ? "fa-solid fa-power-off" : "fa-solid fa-power-off"} />
            ) : "—",
        },
        {
            header: "Resistencias",
            body: (p) => p.estado ? (
                <Tag value={p.estado.resistenciasEncendidas ? "Encendidas" : "Apagadas"}
                    severity={p.estado.resistenciasEncendidas ? "success" : "secondary"}
                    icon={p.estado.resistenciasEncendidas ? "fa-solid fa-fire" : "fa-solid fa-fire"} />
            ) : "—",
        },
        {
            header: "Estado",
            body: (p) => {
                const e = getEstado(p);
                return <Tag value={e.label} severity={e.severity} icon={e.icon} />;
            },
        },
        { header: "Última actualización", body: (p) => <span className="text-sm">{formatTime(p.estado?.ultimaActualizacion)}</span> },
        ...(puedeBorrar ? [{
            header: "",
            body: (p) => (
                <Button rounded icon="fa-solid fa-trash" size="small" severity="danger" text
                    loading={delLoad} onClick={() => confirmarBorrado(p.idPileta)} />
            ),
        }] : []),
    ];

    if (loading && !piletas.length) {
        return <div className="cover-container w-full h-full flex align-self-center justify-content-center"><LoadSpinner /></div>;
    }

    return (
        <Fade direction="up" duration={500} triggerOnce>
            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
                <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
                    <PageHeader icon="fa-solid fa-water" title="Piletas de curado" subtitle="Monitoreo de temperatura y estado del laboratorio" />
                    <div className="flex gap-2 flex-wrap">
                        {puedeEditar && selectedPiletas.length > 0 && (
                            <Button
                                label={`Asignar a laboratorio (${selectedPiletas.length})`}
                                icon="fa-solid fa-flask-vial"
                                severity="help"
                                outlined
                                size="small"
                                onClick={openBulkDialog}
                            />
                        )}
                        {puedeAgregar && (
                            <Button label="Nueva pileta" icon="fa-solid fa-plus" size="small" rounded
                                onClick={() => navigate('/calidad/piletas/nueva')} />
                        )}
                    </div>
                </div>
                <DataTable
                    responsiveLayout="scroll"
                    value={piletas}
                    emptyMessage="No hay piletas registradas"
                    stripedRows
                    scrollable
                    className="w-full mt-3 piletas-desktop-table"
                    selection={selectedPiletas}
                    onSelectionChange={(e) => setSelectedPiletas(e.value)}
                    dataKey="idPileta"
                    selectionMode="checkbox"
                >
                    <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
                    {cols.map((c, i) => <Column key={i} header={c.header} body={c.body} />)}
                </DataTable>

                <Dialog
                    header={`Asignar ${selectedPiletas.length} pileta(s) a un laboratorio`}
                    visible={bulkDialog.visible}
                    onHide={() => setBulkDialog({ visible: false, idLaboratorio: null })}
                    modal
                    style={{ width: '90vw', maxWidth: '480px' }}
                    footer={
                        <div className="flex justify-content-end gap-2">
                            <Button label="Cancelar" severity="secondary" outlined onClick={() => setBulkDialog({ visible: false, idLaboratorio: null })} disabled={bulkLoading} />
                            <Button label="Asignar" icon="fa-solid fa-check" onClick={handleBulkAssign} loading={bulkLoading} disabled={bulkLoading} />
                        </div>
                    }
                >
                    <p className="text-sm text-color-secondary mt-0 mb-2">
                        Las piletas seleccionadas pasarán a pertenecer al laboratorio elegido.
                    </p>
                    <Dropdown
                        value={bulkDialog.idLaboratorio}
                        options={labsForBulk.map((l) => ({ label: l.nombre, value: l.idLaboratorio }))}
                        onChange={(e) => setBulkDialog({ ...bulkDialog, idLaboratorio: e.value })}
                        placeholder="Seleccionar laboratorio…"
                        className="w-full"
                        filter
                    />
                </Dialog>

                {/* Mobile card view */}
                <div className="piletas-mobile-cards">
                    {piletas.length === 0 ? (
                        <span className="text-500 text-center p-3">No hay piletas registradas</span>
                    ) : piletas.map(p => {
                        const e = getEstado(p);
                        return (
                            <div key={p.idPileta} className="piletas-card" onClick={() => navigate(`/calidad/piletas/${p.idPileta}/panel`)}>
                                <div className="piletas-card__header">
                                    <div>
                                        <div className="piletas-card__nombre">{p.nombre}</div>
                                        {p.planta?.nombre && <div className="piletas-card__planta">{p.planta.nombre}</div>}
                                    </div>
                                    <Tag value={e.label} severity={e.severity} icon={e.icon} />
                                </div>
                                <div className="piletas-card__stats">
                                    <div className="piletas-card__stat">
                                        <span className="piletas-card__stat-label">Temp. actual</span>
                                        <span className="piletas-card__stat-value">
                                            {formatTemp(p.estado?.temperaturaActual)}
                                        </span>
                                    </div>
                                    <div className="piletas-card__stat">
                                        <span className="piletas-card__stat-label">Temp. objetivo</span>
                                        <span className="piletas-card__stat-value">
                                            {formatTemp(p.estado?.temperaturaObjetivo)}
                                        </span>
                                    </div>
                                </div>
                                <div className="piletas-card__devices">
                                    {p.estado ? (
                                        <>
                                            <Tag value={p.estado.bombasEncendidas ? "Bombas ON" : "Bombas OFF"}
                                                severity={p.estado.bombasEncendidas ? "success" : "secondary"}
                                                icon="fa-solid fa-water-ladder" style={{ fontSize: '0.72rem' }} />
                                            <Tag value={p.estado.resistenciasEncendidas ? "Resist. ON" : "Resist. OFF"}
                                                severity={p.estado.resistenciasEncendidas ? "success" : "secondary"}
                                                icon="fa-solid fa-fire" style={{ fontSize: '0.72rem' }} />
                                        </>
                                    ) : <span className="text-500 text-xs">Sin datos</span>}
                                    {Number(p.probetasCurando || 0) > 0 && (
                                        <Tag value={`${p.probetasCurando} probeta${Number(p.probetasCurando) !== 1 ? 's' : ''}`}
                                            severity="info" icon="fa-solid fa-flask" style={{ fontSize: '0.72rem' }} />
                                    )}
                                </div>
                                <div className="piletas-card__footer">
                                    <span className="piletas-card__time">
                                        <i className="fa-solid fa-clock mr-1" />
                                        {formatTime(p.estado?.ultimaActualizacion)}
                                    </span>
                                    <div className="piletas-card__actions">
                                        {puedeEditar && (
                                            <Button rounded icon="fa-solid fa-pencil" size="small" text
                                                onClick={(ev) => { ev.stopPropagation(); navigate(`/calidad/piletas/editar/${p.idPileta}`); }} />
                                        )}
                                        {puedeBorrar && (
                                            <Button rounded icon="fa-solid fa-trash" size="small" severity="danger" text
                                                loading={delLoad} onClick={(ev) => { ev.stopPropagation(); confirmarBorrado(p.idPileta); }} />
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Fade>
    );
};

export default PiletasList;
