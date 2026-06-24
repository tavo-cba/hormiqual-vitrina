import React, { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { confirmDialog } from "primereact/confirmdialog";
import { FileUpload } from "primereact/fileupload";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
    getNormas,
    getNorma,
    createNorma,
    updateNorma,
    deleteNorma,
    uploadNormaPdf,
    openNormaPdf,
    deleteNormaFile,
    getAplicaAOptions,
    createAplicaAOption,
    exportNormasPaquete,
    previewImportNormas,
    importNormasPaquete,
} from "../../../services/normaService";

const EMPTY_FORM = {
    codigo: "",
    titulo: "",
    organismo: "IRAM",
    version: "",
    anio: null,
    descripcion: "",
    aplicaAId: null,
};

const NormasPage = () => {
    const [normas, setNormas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [first, setFirst] = useState(0);

    // Form dialog
    const [formVisible, setFormVisible] = useState(false);
    const [formData, setFormData] = useState({ ...EMPTY_FORM });
    const [editingId, setEditingId] = useState(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    // "Aplica a" options
    const [aplicaAOpts, setAplicaAOpts] = useState([]);
    const [newAplicaAVisible, setNewAplicaAVisible] = useState(false);
    const [newAplicaANombre, setNewAplicaANombre] = useState("");
    const [creatingAplicaA, setCreatingAplicaA] = useState(false);
    const creatingAplicaARef = useRef(false);

    // Upload dialog
    const [uploadVisible, setUploadVisible] = useState(false);
    const [uploadNorma, setUploadNorma] = useState(null);
    const [legalChecked, setLegalChecked] = useState(false);
    const [uploading, setUploading] = useState(false);
    const uploadingRef = useRef(false);
    const fileUploadRef = useRef(null);

    // Import/Export
    const [importPreview, setImportPreview] = useState(null);
    const [importVisible, setImportVisible] = useState(false);
    const [importando, setImportando] = useState(false);
    const importandoRef = useRef(false);
    const [importResultado, setImportResultado] = useState(null);
    const [importResultVisible, setImportResultVisible] = useState(false);
    const [diffExpanded, setDiffExpanded] = useState({});
    const importFileRef = useRef(null);

    const showToast = useToast();

    // ─── Fetch ──────────────────────────────────
    const fetchNormas = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getNormas();
            setNormas(data);
        } catch (err) {
            console.error("Error al obtener normas:", err);
            showToast({ severity: "error", summary: "Error", detail: "No se pudieron cargar las normas" });
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    const fetchAplicaAOpts = useCallback(async () => {
        try {
            const data = await getAplicaAOptions();
            setAplicaAOpts(data);
        } catch {
            // Non-critical
        }
    }, []);

    useEffect(() => { fetchNormas(); }, [fetchNormas]);
    useEffect(() => { fetchAplicaAOpts(); }, [fetchAplicaAOpts]);

    // ─── Filtering ──────────────────────────────
    const filtered = normas.filter(Boolean).filter((n) => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return (
            (n.codigo || "").toLowerCase().includes(s) ||
            (n.titulo || "").toLowerCase().includes(s) ||
            (n.organismo || "").toLowerCase().includes(s)
        );
    });

    // ─── Form actions ───────────────────────────
    const openNew = () => {
        setFormData({ ...EMPTY_FORM });
        setEditingId(null);
        setFormVisible(true);
    };

    const openEdit = async (norma) => {
        try {
            const full = await getNorma(norma.id);
            setFormData({
                codigo: full.codigo || "",
                titulo: full.titulo || "",
                organismo: full.organismo || "",
                version: full.version || "",
                anio: full.anio || null,
                descripcion: full.descripcion || "",
                aplicaAId: full.aplicaAId || null,
            });
            setEditingId(full.id);
            setFormVisible(true);
        } catch {
            showToast({ severity: "error", summary: "Error", detail: "No se pudo cargar la norma" });
        }
    };

    const handleSave = async () => {
        if (savingRef.current) return;
        if (!formData.codigo || !formData.titulo) {
            showToast({ severity: "warn", summary: "Validacion", detail: "Nombre y titulo son requeridos" });
            return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            const body = {
                codigo: formData.codigo,
                titulo: formData.titulo,
                organismo: formData.organismo || null,
                version: formData.version || null,
                anio: formData.anio || null,
                descripcion: formData.descripcion || null,
                aplicaAId: formData.aplicaAId || null,
            };
            if (editingId) {
                await updateNorma(editingId, body);
                showToast({ severity: "success", summary: "Actualizada", detail: "Norma actualizada" });
            } else {
                await createNorma(body);
                showToast({ severity: "success", summary: "Creada", detail: "Norma creada" });
            }
            setFormVisible(false);
            fetchNormas();
        } catch (err) {
            const msg = err.response?.data?.error || "Error al guardar";
            showToast({ severity: "error", summary: "Error", detail: msg });
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleDelete = (norma) => {
        confirmDialog({
            message: `Eliminar la norma "${norma.codigo}"? Se perdera el archivo PDF asociado.`,
            header: "Eliminar norma",
            icon: "fa-solid fa-triangle-exclamation",
            acceptLabel: "Eliminar",
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    await deleteNorma(norma.id);
                    showToast({ severity: "success", summary: "Eliminada", detail: "Norma eliminada" });
                    fetchNormas();
                } catch {
                    showToast({ severity: "error", summary: "Error", detail: "No se pudo eliminar" });
                }
            },
        });
    };

    // ─── "Aplica a" — add new option ─────────────
    const handleCreateAplicaA = async () => {
        if (creatingAplicaARef.current) return;
        if (!newAplicaANombre.trim()) return;
        creatingAplicaARef.current = true;
        setCreatingAplicaA(true);
        try {
            const created = await createAplicaAOption({ nombre: newAplicaANombre.trim() });
            await fetchAplicaAOpts();
            setFormData((prev) => ({ ...prev, aplicaAId: created.id }));
            setNewAplicaAVisible(false);
            setNewAplicaANombre("");
        } catch (err) {
            const msg = err.response?.data?.error || "Error al crear opcion";
            showToast({ severity: "error", summary: "Error", detail: msg });
        } finally {
            creatingAplicaARef.current = false;
            setCreatingAplicaA(false);
        }
    };

    // ─── Upload actions ─────────────────────────
    const openUpload = (norma) => {
        setUploadNorma(norma);
        setLegalChecked(false);
        setUploadVisible(true);
    };

    const handleUpload = async (e) => {
        const file = e.files?.[0];
        if (!file) return;
        if (!legalChecked) {
            showToast({ severity: "warn", summary: "Aviso", detail: "Debe aceptar la declaracion de uso legal." });
            return;
        }
        if (uploadingRef.current) return;
        uploadingRef.current = true;
        setUploading(true);
        try {
            await uploadNormaPdf(uploadNorma.id, file);
            showToast({ severity: "success", summary: "Subido", detail: "PDF cargado correctamente" });
            setUploadVisible(false);
            fetchNormas();
        } catch (err) {
            const msg = err.response?.data?.error || "Error al subir archivo";
            showToast({ severity: "error", summary: "Error", detail: msg });
        } finally {
            uploadingRef.current = false;
            setUploading(false);
            if (fileUploadRef.current) fileUploadRef.current.clear();
        }
    };

    const handleDeleteFile = (norma) => {
        confirmDialog({
            message: `Eliminar el PDF de "${norma.codigo}"?`,
            header: "Eliminar archivo",
            icon: "fa-solid fa-triangle-exclamation",
            acceptLabel: "Eliminar",
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: async () => {
                try {
                    await deleteNormaFile(norma.id);
                    showToast({ severity: "success", summary: "Eliminado", detail: "Archivo eliminado" });
                    fetchNormas();
                } catch {
                    showToast({ severity: "error", summary: "Error", detail: "No se pudo eliminar el archivo" });
                }
            },
        });
    };

    const openPdf = (norma) => {
        openNormaPdf(norma.id);
    };

    // ─── Export/Import paquete ────────────────────
    const handleExport = async () => {
        try {
            const paquete = await exportNormasPaquete();
            const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `normas_export_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast({ severity: "success", summary: "Exportado", detail: `${paquete.cantidad} normas exportadas` });
        } catch (err) {
            showToast({ severity: "error", summary: "Error", detail: "Error al exportar normas" });
        }
    };

    const handleImportFile = async (e) => {
        const file = e.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const paquete = JSON.parse(text);
            const preview = await previewImportNormas(paquete);
            setImportPreview({ ...preview, _paquete: paquete });
            setDiffExpanded({});
            setImportVisible(true);
        } catch (err) {
            if (err instanceof SyntaxError) {
                showToast({ severity: "error", summary: "Error", detail: "El archivo no es un JSON válido" });
            } else {
                showToast({ severity: "error", summary: "Error", detail: err.response?.data?.error || "Error al previsualizar importación" });
            }
        } finally {
            if (importFileRef.current) importFileRef.current.clear();
        }
    };

    const toggleImportItem = (codigo) => {
        setImportPreview((prev) => ({
            ...prev,
            preview: prev.preview.map((p) =>
                p.codigo === codigo ? { ...p, selected: !p.selected } : p
            ),
        }));
    };

    const selectImportGroup = (mode) => {
        setImportPreview((prev) => ({
            ...prev,
            preview: prev.preview.map((p) => {
                if (mode === "nuevas") return { ...p, selected: p.estado === "nueva" };
                if (mode === "nuevas+mod") return { ...p, selected: p.estado !== "igual" };
                if (mode === "todas") return { ...p, selected: true };
                if (mode === "ninguna") return { ...p, selected: false };
                return p;
            }),
        }));
    };

    const importSelectedCount = importPreview?.preview?.filter((p) => p.selected).length || 0;

    const handleConfirmImport = async () => {
        if (importandoRef.current) return;
        if (!importPreview?._paquete || importSelectedCount === 0) return;
        importandoRef.current = true;
        setImportando(true);
        try {
            const seleccionados = importPreview.preview.filter((p) => p.selected).map((p) => p.codigo);
            const resultado = await importNormasPaquete(importPreview._paquete.normas, seleccionados);
            setImportResultado(resultado);
            setImportVisible(false);
            setImportResultVisible(true);
            fetchNormas();
        } catch (err) {
            showToast({ severity: "error", summary: "Error", detail: err.response?.data?.error || "Error al importar" });
        } finally {
            importandoRef.current = false;
            setImportando(false);
        }
    };

    // ─── Column templates ───────────────────────
    const hasArchivo = (norma) => Array.isArray(norma?.archivos) && norma.archivos.length > 0;

    const codigoBody = (row) => <span className="font-semibold">{row.codigo}</span>;

    const organismoBody = (row) => row.organismo ? <Tag value={row.organismo} severity="info" /> : "—";

    const anioBody = (row) => row.anio || "—";

    const versionBody = (row) => row.version || "—";

    const aplicaABody = (row) => {
        const nombre = row.aplicaAOpcion?.nombre;
        if (!nombre) return <span className="text-400">—</span>;
        return <span className="text-sm">{nombre}</span>;
    };

    const archivoBody = (row) => {
        if (hasArchivo(row)) {
            return (
                <div className="flex align-items-center gap-2">
                    <Tag value="PDF" severity="success" icon="fa-solid fa-file-pdf" />
                    <Button
                        icon="fa-solid fa-eye"
                        rounded
                        text
                        size="small"
                        tooltip="Ver PDF"
                        tooltipOptions={{ position: "top" }}
                        onClick={() => openPdf(row)}
                    />
                    <Button
                        icon="fa-solid fa-trash"
                        rounded
                        text
                        severity="danger"
                        size="small"
                        tooltip="Eliminar archivo"
                        tooltipOptions={{ position: "top" }}
                        onClick={() => handleDeleteFile(row)}
                    />
                </div>
            );
        }
        return <span className="text-color-secondary text-sm">Sin archivo</span>;
    };

    const actionsBody = (row) => (
        <div className="flex gap-1">
            <Button
                icon="fa-solid fa-upload"
                rounded
                text
                size="small"
                tooltip={hasArchivo(row) ? "Reemplazar PDF" : "Subir PDF"}
                tooltipOptions={{ position: "top" }}
                onClick={() => openUpload(row)}
            />
            <Button
                icon="fa-solid fa-pen"
                rounded
                text
                size="small"
                tooltip="Editar"
                tooltipOptions={{ position: "top" }}
                onClick={() => openEdit(row)}
            />
            <Button
                icon="fa-solid fa-trash"
                rounded
                text
                severity="danger"
                size="small"
                tooltip="Eliminar"
                tooltipOptions={{ position: "top" }}
                onClick={() => handleDelete(row)}
            />
        </div>
    );

    // ─── Dropdown options for "Aplica a" ────────
    const aplicaADropdownOpts = aplicaAOpts.map((o) => ({ label: o.nombre, value: o.id }));

    // ─── Render ─────────────────────────────────
    if (loading) return <LoadSpinner />;

    return (
        <div className="p-4">
            {/* Breadcrumb */}
            <div className="text-sm mb-2 flex align-items-center gap-1 text-color-secondary">
                <Link to="/calidad/catalogos" className="text-primary no-underline hover:underline">Calidad</Link>
                <i className="fa-solid fa-chevron-right text-xs mx-1" />
                <Link to="/calidad/catalogos" className="text-primary no-underline hover:underline">Catálogos</Link>
                <i className="fa-solid fa-chevron-right text-xs mx-1" />
                <span className="font-semibold text-color">Normas</span>
            </div>

            <PageHeader
                icon="fa-solid fa-book-open"
                title="Catálogo de Normas"
                subtitle="Normas IRAM, CIRSOC y otras aplicables a ensayos. Suba el PDF de cada norma para tener acceso rápido."
            />

            {/* Toolbar */}
            <div className="flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                <span className="p-input-icon-left search-bar-wrapper">
                    <i className="pi pi-search" />
                    <InputText
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setFirst(0); }}
                        placeholder="Buscar norma..."
                        title="Buscar por nombre, título u organismo"
                        className="search-bar"
                    />
                </span>
                <div className="flex align-items-center gap-2">
                    <FileUpload
                        ref={importFileRef}
                        mode="basic"
                        accept=".json"
                        maxFileSize={10000000}
                        auto
                        chooseLabel="Importar paquete"
                        chooseOptions={{
                            icon: "fa-solid fa-file-import",
                            className: "p-button-outlined p-button-sm",
                        }}
                        customUpload
                        uploadHandler={handleImportFile}
                    />
                    <Button
                        label="Exportar paquete"
                        icon="fa-solid fa-file-export"
                        size="small"
                        outlined
                        onClick={handleExport}
                        disabled={normas.length === 0}
                    />
                    <Button label="Nueva norma" icon="fa-solid fa-plus" onClick={openNew} />
                </div>
            </div>

            {/* DataTable */}
            <DataTable responsiveLayout="scroll"
                value={filtered}
                paginator
                rows={15}
                first={first}
                onPage={(e) => setFirst(e.first)}
                rowsPerPageOptions={[15, 30, 50]}
                emptyMessage="No hay normas cargadas. Use el botón + Nueva norma para agregar normas técnicas aplicables."
                size="small"
                stripedRows
                sortField="codigo"
                sortOrder={1}
                dataKey="id"
            >
                <Column header="#" body={(_, { rowIndex }) => first + rowIndex + 1} style={{ width: "50px" }} />
                <Column field="codigo" header="Nombre" body={codigoBody} sortable style={{ width: "120px" }} />
                <Column field="titulo" header="Título" sortable />
                <Column field="organismo" header="Organismo" body={organismoBody} sortable style={{ width: "100px" }} />
                <Column header="Aplica a" body={aplicaABody} sortable sortField="aplicaAOpcion.nombre" style={{ width: "140px" }} />
                <Column field="anio" header="Año" body={anioBody} sortable style={{ width: "70px" }} />
                <Column field="version" header="Versión" body={versionBody} sortable style={{ width: "90px" }} />
                <Column header="Archivo" body={archivoBody} style={{ width: "160px" }} />
                <Column header="" body={actionsBody} style={{ width: "140px" }} />
            </DataTable>

            {/* ═══ Form Dialog ═══ */}
            <Dialog
                header={editingId ? "Editar norma" : "Nueva norma"}
                visible={formVisible}
                onHide={() => setFormVisible(false)}
                style={{ width: "90vw", maxWidth: "550px" }}
                modal
                footer={
                    <div className="flex justify-content-end gap-2">
                        <Button label="Cancelar" severity="secondary" text onClick={() => setFormVisible(false)} />
                        <Button label="Guardar" icon="fa-solid fa-save" onClick={handleSave} loading={saving} disabled={saving} />
                    </div>
                }
            >
                <div className="flex flex-column gap-3 pt-2">
                    <div className="flex gap-3">
                        <div className="flex flex-column gap-1 flex-1">
                            <label className="font-semibold text-sm">Nombre *</label>
                            <InputText
                                value={formData.codigo}
                                onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                                placeholder="IRAM 1505"
                            />
                        </div>
                        <div className="flex flex-column gap-1" style={{ width: "120px" }}>
                            <label className="font-semibold text-sm">Organismo</label>
                            <InputText
                                value={formData.organismo}
                                onChange={(e) => setFormData({ ...formData, organismo: e.target.value })}
                                placeholder="IRAM"
                            />
                        </div>
                    </div>
                    <div className="flex flex-column gap-1">
                        <label className="font-semibold text-sm">Título *</label>
                        <InputText
                            value={formData.titulo}
                            onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                            placeholder="Título completo de la norma"
                        />
                    </div>
                    <div className="flex gap-3">
                        <div className="flex flex-column gap-1" style={{ width: "120px" }}>
                            <label className="font-semibold text-sm">Año</label>
                            <InputNumber
                                value={formData.anio}
                                onValueChange={(e) => setFormData({ ...formData, anio: e.value })}
                                useGrouping={false}
                                placeholder="2005"
                            />
                        </div>
                        <div className="flex flex-column gap-1" style={{ width: "120px" }}>
                            <label className="font-semibold text-sm">Versión</label>
                            <InputText
                                value={formData.version}
                                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                                placeholder="v1.0"
                            />
                        </div>
                        <div className="flex flex-column gap-1 flex-1">
                            <label className="font-semibold text-sm">Aplica a</label>
                            <div className="flex gap-1">
                                <Dropdown
                                    value={formData.aplicaAId}
                                    options={aplicaADropdownOpts}
                                    onChange={(e) => setFormData({ ...formData, aplicaAId: e.value })}
                                    placeholder="Seleccionar..."
                                    showClear
                                    className="flex-1"
                                />
                                <Button
                                    icon="fa-solid fa-plus"
                                    size="small"
                                    outlined
                                    tooltip="Agregar nueva categoría"
                                    tooltipOptions={{ position: "top" }}
                                    onClick={() => { setNewAplicaANombre(""); setNewAplicaAVisible(true); }}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-column gap-1">
                        <label className="font-semibold text-sm">Descripción</label>
                        <InputTextarea
                            value={formData.descripcion}
                            onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                            rows={3}
                            autoResize
                        />
                    </div>
                </div>
            </Dialog>

            {/* ═══ New "Aplica a" mini-dialog ═══ */}
            <Dialog
                header="Nueva categoría"
                visible={newAplicaAVisible}
                onHide={() => setNewAplicaAVisible(false)}
                style={{ width: "90vw", maxWidth: "360px" }}
                modal
                footer={
                    <div className="flex justify-content-end gap-2">
                        <Button label="Cancelar" severity="secondary" text onClick={() => setNewAplicaAVisible(false)} />
                        <Button
                            label="Agregar"
                            icon="fa-solid fa-plus"
                            onClick={handleCreateAplicaA}
                            loading={creatingAplicaA}
                            disabled={!newAplicaANombre.trim() || creatingAplicaA}
                        />
                    </div>
                }
            >
                <div className="flex flex-column gap-2 pt-2">
                    <label className="font-semibold text-sm">Nombre de la categoría</label>
                    <InputText
                        value={newAplicaANombre}
                        onChange={(e) => setNewAplicaANombre(e.target.value)}
                        placeholder="Ej: Geotecnia"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") handleCreateAplicaA(); }}
                    />
                </div>
            </Dialog>

            {/* ═══ Upload Dialog ═══ */}
            <Dialog
                header={`Subir PDF — ${uploadNorma?.codigo || ""}`}
                visible={uploadVisible}
                onHide={() => setUploadVisible(false)}
                style={{ width: "90vw", maxWidth: "480px" }}
                modal
            >
                <div className="flex flex-column gap-3 pt-2">
                    {hasArchivo(uploadNorma) && (
                        <div className="surface-ground border-round p-2 flex align-items-center gap-2">
                            <i className="fa-solid fa-file-pdf text-green-500" />
                            <span className="text-sm">
                                Archivo actual: <strong>{uploadNorma?.archivos?.[0]?.filename ?? "—"}</strong>
                            </span>
                            <small className="text-color-secondary ml-auto">
                                Será reemplazado al subir uno nuevo.
                            </small>
                        </div>
                    )}

                    <div
                        className="border-round p-3 flex align-items-start gap-3 cursor-pointer transition-colors transition-duration-200"
                        style={{
                            border: legalChecked
                                ? "1px solid rgba(76, 175, 80, 0.45)"
                                : "1px solid var(--surface-border)",
                            backgroundColor: legalChecked
                                ? "rgba(76, 175, 80, 0.10)"
                                : "var(--surface-ground)",
                            outline: "none",
                        }}
                        tabIndex={0}
                        role="checkbox"
                        aria-checked={legalChecked}
                        onClick={() => setLegalChecked((prev) => !prev)}
                        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setLegalChecked((prev) => !prev); } }}
                    >
                        <div className="flex-shrink-0 pt-1">
                            <i
                                className={`fa-solid fa-shield-halved text-lg ${legalChecked ? "text-green-400" : "text-500"}`}
                            />
                        </div>
                        <div className="flex align-items-start gap-2 flex-1">
                            <Checkbox
                                inputId="legalCheck"
                                checked={legalChecked}
                                onChange={(e) => { e.stopPropagation(); setLegalChecked(e.checked); }}
                                className="mt-1 flex-shrink-0"
                            />
                            <div className="flex flex-column gap-1">
                                <label htmlFor="legalCheck" className="text-sm font-medium line-height-3 cursor-pointer m-0 text-color">
                                    Declaro que cuento con licencia o autorización para almacenar este documento.
                                </label>
                                <small className="text-500 line-height-3">
                                    Se usará solo como referencia técnica interna.
                                </small>
                            </div>
                        </div>
                    </div>

                    <FileUpload
                        ref={fileUploadRef}
                        name="file"
                        accept="application/pdf"
                        maxFileSize={30 * 1024 * 1024}
                        customUpload
                        uploadHandler={handleUpload}
                        chooseLabel="Seleccionar PDF"
                        uploadLabel="Subir"
                        cancelLabel="Cancelar"
                        disabled={!legalChecked || uploading}
                        emptyTemplate={
                            <p className="text-center text-color-secondary m-0">
                                Arrastre un archivo PDF aquí o haga clic en "Seleccionar PDF".
                            </p>
                        }
                    />
                </div>
            </Dialog>

            {/* ═══ Import Preview Dialog ═══ */}
            <Dialog
                header="Importar paquete de normas"
                visible={importVisible}
                onHide={() => setImportVisible(false)}
                style={{ width: "90vw", maxWidth: "750px" }}
                modal
                footer={
                    <div className="flex justify-content-between align-items-center">
                        <span className="text-sm text-color-secondary">
                            Seleccionadas: {importSelectedCount}
                            {importPreview && ` de ${importPreview.cantidad}`}
                        </span>
                        <div className="flex gap-2">
                            <Button label="Cancelar" severity="secondary" text onClick={() => setImportVisible(false)} />
                            <Button
                                label={importSelectedCount > 0 ? `Importar ${importSelectedCount} norma${importSelectedCount !== 1 ? "s" : ""}` : "Importar"}
                                icon="fa-solid fa-file-import"
                                onClick={handleConfirmImport}
                                loading={importando}
                                disabled={importSelectedCount === 0 || importando}
                            />
                        </div>
                    </div>
                }
            >
                {importPreview && (
                    <div className="flex flex-column gap-3 pt-2">
                        {/* Summary counters */}
                        <div className="flex align-items-center gap-3 flex-wrap">
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Total</span>
                                <span className="text-2xl font-bold">{importPreview.cantidad}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Idénticas</span>
                                <span className="text-2xl font-bold text-color-secondary">{importPreview.iguales}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Difieren</span>
                                <span className="text-2xl font-bold text-orange-500">{importPreview.difieren}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Nuevas</span>
                                <span className="text-2xl font-bold text-green-500">{importPreview.nuevas}</span>
                            </div>
                        </div>

                        {importPreview.fecha_exportacion && (
                            <div className="text-sm text-color-secondary">
                                Fecha de exportación: {new Date(importPreview.fecha_exportacion).toLocaleDateString()}
                            </div>
                        )}

                        {/* Quick actions */}
                        <div className="flex gap-2 flex-wrap">
                            <Button label="Solo nuevas" size="small" text onClick={() => selectImportGroup("nuevas")} />
                            <Button label="Nuevas + modificadas" size="small" text severity="warning" onClick={() => selectImportGroup("nuevas+mod")} />
                            <Button label="Todas" size="small" text severity="secondary" onClick={() => selectImportGroup("todas")} />
                            <Button label="Ninguna" size="small" text severity="secondary" onClick={() => selectImportGroup("ninguna")} />
                        </div>

                        {/* Table with checkboxes */}
                        <DataTable responsiveLayout="scroll"
                            value={importPreview.preview}
                            size="small"
                            stripedRows
                            paginator={importPreview.preview.length > 15}
                            rows={15}
                            scrollable
                            scrollHeight="350px"
                            rowClassName={(row) => row.estado === "igual" ? "opacity-60" : ""}
                        >
                            <Column
                                style={{ width: "45px" }}
                                body={(row) => (
                                    <Checkbox checked={!!row.selected} onChange={() => toggleImportItem(row.codigo)} />
                                )}
                            />
                            <Column field="codigo" header="Nombre" style={{ width: "130px" }} body={(row) => <span className="font-semibold text-sm">{row.codigo}</span>} />
                            <Column field="titulo" header="Título" body={(row) => <span className="text-sm">{row.titulo}</span>} />
                            <Column header="Estado" style={{ width: "100px" }} body={(row) => {
                                const cfg = { nueva: { label: "Nueva", severity: "success", icon: "fa-solid fa-plus" }, difiere: { label: "Difiere", severity: "warning", icon: "fa-solid fa-pen" }, igual: { label: "Igual", severity: null, icon: "fa-solid fa-equals" } };
                                const c = cfg[row.estado] || cfg.igual;
                                return <Tag value={c.label} severity={c.severity} icon={c.icon} className="text-xs" />;
                            }} />
                            <Column header="" style={{ width: "50px" }} body={(row) => {
                                if (row.estado !== "difiere" || !row.diferencias?.length) return row.estado === "igual" ? <span className="text-xs text-400">(=)</span> : null;
                                return (
                                    <Button
                                        label="ver"
                                        size="small"
                                        text
                                        className="p-0 text-xs"
                                        onClick={() => setDiffExpanded((prev) => ({ ...prev, [row.codigo]: !prev[row.codigo] }))}
                                    />
                                );
                            }} />
                        </DataTable>

                        {/* Expanded diffs */}
                        {importPreview.preview.filter((p) => p.estado === "difiere" && diffExpanded[p.codigo]).map((p) => (
                            <div key={p.codigo} className="surface-ground border-round p-2 text-xs">
                                <span className="font-semibold">{p.codigo}</span> — Diferencias:
                                {p.diferencias.map((d, i) => (
                                    <div key={i} className="ml-3 mt-1">
                                        <span className="text-color-secondary">{d.campo}:</span>{" "}
                                        <span className="text-red-400 line-through">{d.antes}</span>{" "}
                                        <i className="fa-solid fa-arrow-right text-xs mx-1" />{" "}
                                        <span className="text-green-400">{d.despues}</span>
                                    </div>
                                ))}
                            </div>
                        ))}

                        <div className="flex align-items-center gap-2 text-color-secondary">
                            <i className="fa-solid fa-shield-halved text-blue-400" />
                            <small>Los archivos PDF NO se importan ni se eliminan. Los PDFs vinculados se conservan.</small>
                        </div>
                    </div>
                )}
            </Dialog>

            {/* ═══ Import Result Dialog ═══ */}
            <Dialog
                header="Importación completada"
                visible={importResultVisible}
                onHide={() => setImportResultVisible(false)}
                style={{ width: "90vw", maxWidth: "450px" }}
                modal
            >
                {importResultado && (
                    <div className="flex flex-column gap-3 pt-2">
                        <div className="flex align-items-center gap-3 flex-wrap">
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Creadas</span>
                                <span className="text-2xl font-bold text-green-500">{importResultado.creadas}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Actualizadas</span>
                                <span className="text-2xl font-bold text-orange-500">{importResultado.actualizadas}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Sin cambios</span>
                                <span className="text-2xl font-bold text-color-secondary">{importResultado.sin_cambios}</span>
                            </div>
                        </div>
                        {importResultado.detalle?.length > 0 && (
                            <div className="surface-ground border-round p-2 text-xs" style={{ maxHeight: "200px", overflow: "auto" }}>
                                {importResultado.detalle.map((d, i) => (
                                    <div key={i} className="flex align-items-center gap-2 mb-1">
                                        {d.accion === "creada" && <i className="fa-solid fa-plus text-green-500" />}
                                        {d.accion === "actualizada" && <i className="fa-solid fa-sync text-orange-500" />}
                                        {d.accion === "error" && <i className="fa-solid fa-xmark text-red-500" />}
                                        <span>{d.codigo}</span>
                                        {d.error && <span className="text-red-400">— {d.error}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        {importResultado.errores?.length > 0 && (
                            <div className="surface-ground border-round p-2">
                                <span className="text-sm text-red-500 font-bold">Errores:</span>
                                {importResultado.errores.map((e, i) => (
                                    <div key={i} className="text-xs text-red-400 mt-1">{e.codigo}: {e.error}</div>
                                ))}
                            </div>
                        )}
                        <div className="flex align-items-center gap-2 text-color-secondary text-xs">
                            <i className="fa-solid fa-shield-halved text-blue-400" />
                            Los archivos PDF existentes se conservaron.
                        </div>
                    </div>
                )}
            </Dialog>
        </div>
    );
};

export default NormasPage;
