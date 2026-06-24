import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dialog } from "primereact/dialog";
import { FileUpload } from "primereact/fileupload";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";

/** Normalize a category string for accent/case-insensitive comparison */
const normalizeCategoria = (cat) => {
  if (!cat) return "";
  return cat
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};
const isGranulometriaCategoria = (cat) => normalizeCategoria(cat) === "granulometria";

const CATEGORIAS = [
  "Certificado",
  "Ficha técnica",
  "Hoja de seguridad",
  "Ensayo",
  "Protocolo",
  "Otro",
];

const ESTADO_COLORS = {
  PENDIENTE: "secondary",
  EXTRAIDO: "info",
  INCOMPLETO: "warning",
  REVISADO: "success",
  ERROR: "danger",
};

const ESTADO_LABELS = {
  PENDIENTE: "Pendiente",
  EXTRAIDO: "Extraído",
  INCOMPLETO: "Incompleto",
  REVISADO: "Revisado",
  ERROR: "Error",
};

/**
 * Panel de documentos para un material.
 * Props:
 *   materialTipo: string (AGREGADO|CEMENTO|ADITIVO|FIBRA|ADICION)
 *   materialId:   number
 *   materialNombre: string (for display)
 *   visible:      boolean
 *   onHide:       () => void
 */
const MaterialDocumentos = ({ materialTipo, materialId, materialNombre, visible, onHide }) => {
  const [documentos, setDocumentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const showToast = useToast();
  const navigate = useNavigate();

  /* ── Upload form state ─────────────────── */
  const [uploadFile, setUploadFile] = useState(null);
  const [categoria, setCategoria] = useState("Otro");
  const [fechaDocumento, setFechaDocumento] = useState(null);
  const [notas, setNotas] = useState("");
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const deletingRef = useRef(false);
  const marcandoRef = useRef(false);

  /* ── Fetch documents ───────────────────── */
  const fetchDocumentos = useCallback(async () => {
    if (!materialTipo || !materialId) return;
    try {
      setLoading(true);
      const res = await axios.get(
        `${config.backendUrl}/api/calidad/materiales/${materialTipo}/${materialId}/documentos`,
        { headers: config.headers }
      );
      setDocumentos(res.data || []);
    } catch (err) {
      console.error("Error al obtener documentos:", err);
    } finally {
      setLoading(false);
    }
  }, [materialTipo, materialId]);

  useEffect(() => {
    if (visible) fetchDocumentos();
  }, [visible, fetchDocumentos]);

  /* ── Upload submit ─────────────────────── */
  const handleUpload = async () => {
    if (uploadingRef.current) return;
    if (!uploadFile) {
      showToast({ severity: "warn", summary: "Seleccione un archivo" });
      return;
    }
    uploadingRef.current = true;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("categoria", categoria);
      if (fechaDocumento) formData.append("fechaDocumento", fechaDocumento.toISOString().split("T")[0]);
      if (notas) formData.append("notas", notas);

      await axios.post(
        `${config.backendUrl}/api/calidad/materiales/${materialTipo}/${materialId}/documentos`,
        formData,
        { headers: { ...config.headers, "Content-Type": "multipart/form-data" } }
      );

      showToast({ severity: "success", summary: "Documento subido correctamente" });
      setShowUpload(false);
      resetUploadForm();
      fetchDocumentos();
    } catch (err) {
      console.error("Error al subir documento:", err);
      showToast({ severity: "error", summary: err.response?.data?.error || "Error al subir documento" });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setCategoria("Otro");
    setFechaDocumento(null);
    setNotas("");
  };

  /* ── Download ──────────────────────────── */
  const handleDownload = async (doc) => {
    try {
      const archivoId = doc.archivo?.idCalidadArchivo || doc.idCalidadArchivo;
      const res = await axios.get(
        `${config.backendUrl}/api/calidad/documentos/${archivoId}/download`,
        { headers: config.headers, responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.archivo?.mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.archivo?.originalName || "documento";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error al descargar:", err);
      showToast({ severity: "error", summary: "Error al descargar archivo" });
    }
  };

  const handleView = async (doc) => {
    try {
      const archivoId = doc.archivo?.idCalidadArchivo || doc.idCalidadArchivo;
      const res = await axios.get(
        `${config.backendUrl}/api/calidad/documentos/${archivoId}/download`,
        { headers: config.headers, responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.archivo?.mimeType }));
      window.open(url, "_blank");
    } catch (err) {
      console.error("Error al ver archivo:", err);
      showToast({ severity: "error", summary: "Error al abrir archivo" });
    }
  };

  /* ── Delete ────────────────────────────── */
  const handleDelete = (doc) => {
    confirmDialog({
      message: `¿Eliminar "${doc.archivo?.originalName}"?`,
      header: "Confirmar eliminación",
      icon: "pi pi-exclamation-triangle",
      acceptLabel: "Eliminar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-danger",
      accept: async () => {
        if (deletingRef.current) return;
        try {
          deletingRef.current = true;
          await axios.delete(
            `${config.backendUrl}/api/calidad/materiales/documentos/${doc.idMaterialDocumento}`,
            { headers: config.headers }
          );
          showToast({ severity: "success", summary: "Documento eliminado" });
          fetchDocumentos();
        } catch (err) {
          showToast({ severity: "error", summary: "Error al eliminar documento" });
        } finally {
          deletingRef.current = false;
        }
      },
    });
  };

  /* ── File select handler ───────────────── */
  const onFileSelect = (e) => {
    if (e.files && e.files.length > 0) {
      setUploadFile(e.files[0]);
    }
  };

  /* ── Mark as revisado ───────────────── */
  const handleMarcarRevisado = async (doc) => {
    if (marcandoRef.current) return;
    try {
      marcandoRef.current = true;
      await axios.post(
        `${config.backendUrl}/api/calidad/materiales/documentos/${doc.idMaterialDocumento}/extraccion/revisado`,
        {},
        { headers: config.headers }
      );
      showToast({ severity: "success", summary: "Marcado como revisado" });
      fetchDocumentos();
    } catch (err) {
      showToast({ severity: "error", summary: "Error al marcar como revisado" });
    } finally {
      marcandoRef.current = false;
    }
  };

  /* ── Formatters ────────────────────────── */
  const formatSize = (bytes) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const mimeIcon = (mime) => {
    if (!mime) return "fa-solid fa-file";
    if (mime.includes("pdf")) return "fa-solid fa-file-pdf";
    if (mime.includes("image")) return "fa-solid fa-file-image";
    if (mime.includes("word") || mime.includes("document")) return "fa-solid fa-file-word";
    if (mime.includes("excel") || mime.includes("sheet")) return "fa-solid fa-file-excel";
    return "fa-solid fa-file";
  };

  /* ── Render ────────────────────────────── */
  return (
    <Dialog
      header={
        <div className="flex align-items-center gap-2">
          <i className="fa-solid fa-folder-open" />
          <span>Documentos — {materialNombre || "Material"}</span>
        </div>
      }
      visible={visible}
      onHide={() => { onHide(); setShowUpload(false); resetUploadForm(); }}
      style={{ width: "70vw", maxWidth: "900px" }}
      modal
      maximizable
      draggable={false}
    >
      {/* Toolbar */}
      <div className="flex justify-content-between align-items-center mb-3">
        <span className="text-sm text-500">
          {documentos.length} documento{documentos.length !== 1 ? "s" : ""}
        </span>
        <Button
          label="Subir documento"
          icon="fa-solid fa-upload"
          size="small"
          rounded
          severity="success"
          onClick={() => setShowUpload(true)}
        />
      </div>

      {/* Document list */}
      <DataTable responsiveLayout="scroll"
        value={documentos}
        loading={loading}
        emptyMessage="No hay documentos"
        stripedRows
        size="small"
        paginator={documentos.length > 10}
        rows={10}
      >
        <Column
          header="Archivo"
          body={(d) => (
            <div className="flex align-items-center gap-2">
              <i className={mimeIcon(d.archivo?.mimeType)} style={{ fontSize: "1.2rem", color: "var(--primary-color)" }} />
              <div>
                <div className="font-bold text-sm">{d.archivo?.originalName || "-"}</div>
                <div className="text-xs text-500">{formatSize(d.archivo?.sizeBytes)}</div>
              </div>
            </div>
          )}
        />
        <Column field="categoria" header="Categoría" style={{ width: "130px" }} />
        <Column
          header="Norma"
          style={{ width: "140px" }}
          body={(d) => {
            const norma = d.extraccion?.plantilla?.normaReferencia;
            return norma ? <span className="text-xs">{norma}</span> : <span className="text-xs text-400">—</span>;
          }}
        />
        <Column
          field="fechaDocumento"
          header="Fecha"
          style={{ width: "100px" }}
          body={(d) => d.fechaDocumento || "-"}
        />
        <Column
          header="Estado"
          style={{ width: "160px" }}
          body={(d) => {
            const est = d.extraccion?.estado || "PENDIENTE";
            const faltantes = d.extraccion?.faltantes;
            const count = Array.isArray(faltantes) ? faltantes.length : 0;
            const hasData = d.extraccion?.jsonExtraido && Object.values(d.extraccion.jsonExtraido).some((v) => v !== null);
            // Friendly label mapping
            let displayLabel = ESTADO_LABELS[est] || est;
            if (hasData && count > 0 && est !== "REVISADO") displayLabel = "Incompleto";
            return (
              <div className="flex flex-column gap-1">
                <Tag value={displayLabel} severity={ESTADO_COLORS[est] || "secondary"} className="text-xs" />
                {count > 0 && est !== "REVISADO" && (
                  <span className="text-xs text-500">Faltan {count} campos</span>
                )}
                {/* Granulometría mini summary for reviewed docs */}
                {est === "REVISADO" && isGranulometriaCategoria(d.categoria) && d.extraccion?.jsonExtraido?.calculos && (
                  <div className="text-xs text-500 flex flex-column gap-0">
                    {d.extraccion.jsonExtraido.calculos.moduloFinura != null && (
                      <span>MF: <strong>{d.extraccion.jsonExtraido.calculos.moduloFinura}</strong></span>
                    )}
                    {d.extraccion.jsonExtraido.calculos.tmnMm != null && (
                      <span>TMN: <strong>{d.extraccion.jsonExtraido.calculos.tmnMm} mm</strong></span>
                    )}
                    {d.extraccion.jsonExtraido.fechaEnsayo && (
                      <span>{d.extraccion.jsonExtraido.fechaEnsayo}</span>
                    )}
                  </div>
                )}
              </div>
            );
          }}
        />
        <Column
          header=""
          style={{ width: "160px" }}
          body={(d) => (
            <div className="flex gap-1">
              <Button icon="fa-solid fa-eye" rounded text size="small" tooltip="Ver" tooltipOptions={{ position: "top" }} onClick={() => handleView(d)} />
              <Button icon="fa-solid fa-pen-to-square" rounded text size="small" severity="info" tooltip="Revisar / Completar" tooltipOptions={{ position: "top" }} onClick={() => { onHide(); navigate(`/calidad/catalogos/materiales/documentos/${d.idMaterialDocumento}/revision`); }} />
              <Button icon="fa-solid fa-download" rounded text size="small" tooltip="Descargar" tooltipOptions={{ position: "top" }} onClick={() => handleDownload(d)} />
              {d.extraccion?.estado !== "REVISADO" && (
                <Button icon="fa-solid fa-check-circle" rounded text size="small" severity="success" tooltip="Marcar revisado" tooltipOptions={{ position: "top" }} onClick={() => handleMarcarRevisado(d)} />
              )}
              <Button icon="fa-solid fa-trash" rounded text severity="danger" size="small" tooltip="Eliminar" tooltipOptions={{ position: "top" }} onClick={() => handleDelete(d)} />
            </div>
          )}
        />
      </DataTable>

      {/* Upload Dialog */}
      <Dialog
        header="Subir documento"
        visible={showUpload}
        onHide={() => { setShowUpload(false); resetUploadForm(); }}
        style={{ width: "90vw", maxWidth: "480px" }}
        modal
      >
        <div className="flex flex-column gap-3">
          <div>
            <label className="font-bold text-sm mb-1 block">Archivo *</label>
            <FileUpload
              mode="basic"
              accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,.xlsx,.xls"
              maxFileSize={50 * 1024 * 1024}
              chooseLabel={uploadFile ? uploadFile.name : "Seleccionar archivo"}
              auto={false}
              customUpload
              onSelect={onFileSelect}
              onClear={() => setUploadFile(null)}
            />
          </div>

          <div>
            <label className="font-bold text-sm mb-1 block">Categoría</label>
            <Dropdown
              value={categoria}
              options={CATEGORIAS.map((c) => ({ label: c, value: c }))}
              onChange={(e) => setCategoria(e.value)}
              className="w-full"
            />
          </div>

          <div>
            <label className="font-bold text-sm mb-1 block">Fecha del documento</label>
            <Calendar
              value={fechaDocumento}
              onChange={(e) => setFechaDocumento(e.value)}
              dateFormat="dd/mm/yy"
              showIcon
              className="w-full"
            />
          </div>

          <div>
            <label className="font-bold text-sm mb-1 block">Notas</label>
            <InputTextarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              className="w-full"
            />
          </div>

          <div className="flex justify-content-end gap-2 mt-2">
            <Button
              label="Cancelar"
              text
              size="small"
              onClick={() => { setShowUpload(false); resetUploadForm(); }}
            />
            <Button
              label="Subir"
              icon="fa-solid fa-upload"
              size="small"
              loading={uploading}
              disabled={uploading}
              onClick={handleUpload}
            />
          </div>
        </div>
      </Dialog>
    </Dialog>
  );
};

export default MaterialDocumentos;
