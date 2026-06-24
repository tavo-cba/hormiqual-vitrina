import React, { useEffect, useState, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import {
    listSnapshots,
    createSnapshot,
    deleteSnapshot,
    previewRestoreSnapshot,
    restoreSnapshot,
} from "../../../services/agregadoEnsayoService";

/**
 * SnapshotsManagerDialog
 *
 * Permite al usuario:
 *  - Ver el listado de snapshots de configuración del catálogo.
 *  - Crear un snapshot nuevo (capturar el estado actual con un nombre).
 *  - Restaurar el catálogo desde un snapshot (con preview de qué cambia).
 *  - Eliminar snapshots viejos.
 *
 * Reemplaza al flujo "exportar/importar paquete JSON" como mecanismo
 * principal — ese sigue existiendo como utilidad técnica oculta.
 */
const SnapshotsManagerDialog = ({ visible, onHide, material = "AGREGADOS", onRestored }) => {
    const showToast = useToast();
    const [loading, setLoading] = useState(false);
    const [snapshots, setSnapshots] = useState([]);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [nuevoNombre, setNuevoNombre] = useState("");
    const [nuevaDescripcion, setNuevaDescripcion] = useState("");

    const fetchSnapshots = async () => {
        setLoading(true);
        try {
            const data = await listSnapshots({ material });
            setSnapshots(data || []);
        } catch (err) {
            showToast("error", "No se pudieron cargar los snapshots");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (visible) {
            fetchSnapshots();
            setNuevoNombre("");
            setNuevaDescripcion("");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, material]);

    const handleCreate = async () => {
        if (creatingRef.current) return;
        const nombre = (nuevoNombre || "").trim();
        if (!nombre) {
            showToast("warn", "El snapshot necesita un nombre.");
            return;
        }
        creatingRef.current = true;
        setCreating(true);
        try {
            await createSnapshot({ nombre, descripcion: nuevaDescripcion || null, material });
            showToast("success", `Snapshot "${nombre}" creado`);
            setNuevoNombre("");
            setNuevaDescripcion("");
            await fetchSnapshots();
        } catch (err) {
            showToast("error", err.response?.data?.error || "Error al crear snapshot");
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    };

    const handleDelete = (snap) => {
        confirmDialog({
            message: `Eliminar el snapshot "${snap.nombre}"? Esta acción no se puede deshacer.`,
            header: "Confirmar eliminación",
            icon: "fa-solid fa-trash",
            acceptLabel: "Eliminar",
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    await deleteSnapshot(snap.idCatalogoEnsayoSnapshot);
                    showToast("success", "Snapshot eliminado");
                    await fetchSnapshots();
                } catch (err) {
                    showToast("error", err.response?.data?.error || "Error al eliminar");
                }
            },
        });
    };

    const handleRestore = async (snap) => {
        let preview;
        try {
            preview = await previewRestoreSnapshot(snap.idCatalogoEnsayoSnapshot);
        } catch (err) {
            showToast("error", err.response?.data?.error || "Error al previsualizar restauración");
            return;
        }
        const cambios = (preview.preview || []).filter((p) => p.estado !== "igual");
        if (cambios.length === 0) {
            showToast("info", "El catálogo actual coincide con el snapshot — no hay cambios para aplicar.");
            return;
        }
        confirmDialog({
            message: `El snapshot "${snap.nombre}" tiene ${preview.nuevos} ensayo(s) nuevo(s) y ${preview.difieren} diferente(s) respecto al catálogo actual. ¿Aplicar todos los cambios?`,
            header: "Confirmar restauración",
            icon: "fa-solid fa-rotate-left",
            acceptLabel: "Restaurar",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    const seleccionados = cambios.map((p) => p.codigo);
                    const r = await restoreSnapshot(snap.idCatalogoEnsayoSnapshot, seleccionados);
                    showToast(
                        "success",
                        `Restaurado: ${r.actualizados} actualizado(s), ${r.creados} creado(s)`
                    );
                    if (onRestored) onRestored();
                } catch (err) {
                    showToast("error", err.response?.data?.error || "Error al restaurar");
                }
            },
        });
    };

    const fmtFecha = (v) => {
        if (!v) return "";
        const d = new Date(v);
        return `${d.toLocaleDateString("es-AR")} ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
    };

    const accionesBody = (row) => (
        <div className="flex gap-1">
            <Button
                icon="fa-solid fa-rotate-left"
                rounded
                text
                size="small"
                tooltip="Restaurar el catálogo desde este snapshot"
                tooltipOptions={{ position: "top" }}
                onClick={() => handleRestore(row)}
            />
            <Button
                icon="fa-solid fa-trash"
                rounded
                text
                size="small"
                severity="danger"
                tooltip="Eliminar snapshot"
                tooltipOptions={{ position: "top" }}
                onClick={() => handleDelete(row)}
            />
        </div>
    );

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header="Configuraciones guardadas"
            style={{ width: "90vw", maxWidth: "850px" }}
            modal
        >
            <div className="mb-3">
                <p className="text-sm text-color-secondary mt-0">
                    Cada snapshot guarda la configuración actual del catálogo (qué ensayos
                    son obligatorios, en qué contexto aplican, periodicidad, visibilidad).
                    Sirve para volver a un estado conocido si hacés cambios y querés
                    revertirlos.
                </p>
            </div>

            <div className="surface-card border-1 surface-border border-round p-3 mb-3">
                <h4 className="mt-0 mb-2">
                    <i className="fa-solid fa-bookmark mr-2 text-primary" />
                    Guardar configuración actual
                </h4>
                <div className="grid">
                    <div className="col-12 md:col-5 flex flex-column mb-2">
                        <small>Nombre del snapshot *</small>
                        <InputText
                            value={nuevoNombre}
                            onChange={(e) => setNuevoNombre(e.target.value)}
                            placeholder="Ej: Pre-pastón mayo 2026"
                            className="w-full"
                            maxLength={120}
                        />
                    </div>
                    <div className="col-12 md:col-7 flex flex-column mb-2">
                        <small>Descripción (opcional)</small>
                        <InputTextarea
                            value={nuevaDescripcion}
                            onChange={(e) => setNuevaDescripcion(e.target.value)}
                            placeholder="Notas sobre este snapshot..."
                            rows={2}
                            autoResize
                            className="w-full"
                        />
                    </div>
                </div>
                <div className="flex justify-content-end mt-2">
                    <Button
                        label="Guardar snapshot"
                        icon="fa-solid fa-floppy-disk"
                        size="small"
                        loading={creating}
                        disabled={!nuevoNombre.trim() || creating}
                        onClick={handleCreate}
                    />
                </div>
            </div>

            <h4 className="mb-2"><i className="fa-solid fa-clock-rotate-left mr-2 text-primary" />Snapshots disponibles</h4>
            <DataTable
                value={snapshots}
                loading={loading}
                emptyMessage="Aún no hay snapshots guardados. Creá uno para tener un punto de restauración."
                size="small"
                stripedRows
            >
                <Column field="nombre" header="Nombre" body={(r) => (
                    <div className="flex flex-column">
                        <span className="font-semibold">{r.nombre}</span>
                        {r.descripcion && (
                            <small className="text-color-secondary">{r.descripcion}</small>
                        )}
                    </div>
                )} />
                <Column header="Ensayos capturados" body={(r) => <Tag value={r.cantidadEnsayos} severity="info" />} style={{ width: "8rem" }} />
                <Column header="Creado" body={(r) => fmtFecha(r.createdAt)} style={{ width: "11rem" }} />
                <Column header="Acciones" body={accionesBody} style={{ width: "8rem" }} />
            </DataTable>
        </Dialog>
    );
};

export default SnapshotsManagerDialog;
