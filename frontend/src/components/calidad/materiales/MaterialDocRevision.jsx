import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { Button } from "primereact/button";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import { Tag } from "primereact/tag";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { Divider } from "primereact/divider";
import { useToast } from "../../../context/ToastContext";
import GranulometriaEditor from "./GranulometriaEditor";

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

/* ── Helpers ────────────────────────────────────────── */
const resolveField = (f) => ({
  key: f.key || f.campo,
  label: f.label || f.key || f.campo,
  type: f.type || f.tipo || "string",
  unit: f.unit || f.unidad || "",
  required: f.required !== undefined ? f.required : true,
  min: f.min,
  max: f.max,
  enumValues: f.enum || null,
});

const isValueEmpty = (v) =>
  v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === "");

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

const MaterialDocRevision = () => {
  const { materialDocumentoId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();

  const [documento, setDocumento] = useState(null);
  const [schema, setSchema] = useState([]);
  const [formValues, setFormValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [isGranulometria, setIsGranulometria] = useState(false);
  const previewUrlRef = useRef(null);

  /* ── Fetch document detail ───────────────────────── */
  const fetchDocumento = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(
        `${config.backendUrl}/api/calidad/materiales/documentos/${materialDocumentoId}`,
        { headers: config.headers }
      );
      const doc = res.data;
      setDocumento(doc);

      // Detect Granulometría (robust: accent/case-insensitive)
      const isGrano = isGranulometriaCategoria(doc.categoria) && (doc.materialTipo || "").toUpperCase() === "AGREGADO";
      setIsGranulometria(isGrano);

      // Load schema from plantilla
      const schemaFields = (doc.extraccion?.plantilla?.schema || []).map(resolveField);
      setSchema(schemaFields);

      // Pre-populate form with existing extracted data
      const existing = doc.extraccion?.jsonExtraido || {};

      if (isGrano) {
        // Granulometría uses its own structured format
        setFormValues({
          serieTamices: existing.serieTamices || "IRAM",
          tipoAgregado: existing.tipoAgregado || null,
          fechaEnsayo: existing.fechaEnsayo || null,
          laboratorio: existing.laboratorio || null,
          tamices: existing.tamices || [],
          calculos: existing.calculos || null,
          comparacionCurva: existing.comparacionCurva || null,
        });
      } else {
        const initial = {};
        schemaFields.forEach((f) => {
          initial[f.key] = existing[f.key] ?? null;
        });
        setFormValues(initial);
      }

      // Load preview blob URL
      if (doc.archivo?.idCalidadArchivo) {
        const previewRes = await axios.get(
          `${config.backendUrl}/api/calidad/documentos/${doc.archivo.idCalidadArchivo}/download`,
          { headers: config.headers, responseType: "blob" }
        );
        if (previewUrlRef.current) window.URL.revokeObjectURL(previewUrlRef.current);
        const url = window.URL.createObjectURL(
          new Blob([previewRes.data], { type: doc.archivo.mimeType })
        );
        previewUrlRef.current = url;
        setPreviewUrl(url);
      }
    } catch (err) {
      console.error("Error al cargar documento:", err);
      showToast({ severity: "error", summary: "Error al cargar documento" });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialDocumentoId]);

  useEffect(() => {
    fetchDocumento();
    return () => {
      if (previewUrlRef.current) window.URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [fetchDocumento]);

  /* ── Form change handler ─────────────────────────── */
  const handleFieldChange = (key, value) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    // Clear field error on change
    setFieldErrors((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  };

  /* ── Client-side validation ──────────────────────── */
  const validateLocally = () => {
    const errs = {};
    for (const field of schema) {
      const val = formValues[field.key];
      if (isValueEmpty(val)) continue; // faltante check is separate
      if (field.type === "number" && val !== null) {
        if (field.min !== undefined && val < field.min) errs[field.key] = `Mín: ${field.min}`;
        if (field.max !== undefined && val > field.max) errs[field.key] = `Máx: ${field.max}`;
      }
      if ((field.type === "string" || field.type === "text") && field.enumValues && val) {
        if (!field.enumValues.includes(val)) errs[field.key] = `Debe ser: ${field.enumValues.join(", ")}`;
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  /* ── Save ────────────────────────────────────────── */
  const handleSave = async (marcarComoRevisado = false) => {
    if (savingRef.current) return;
    if (!validateLocally()) {
      showToast({ severity: "warn", summary: "Hay errores de validación en el formulario" });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const res = await axios.put(
        `${config.backendUrl}/api/calidad/materiales/documentos/${materialDocumentoId}/revision`,
        { jsonExtraido: formValues, marcarComoRevisado },
        { headers: config.headers }
      );
      const updated = res.data;
      setDocumento(updated);

      // Refresh schema & form
      const newSchema = (updated.extraccion?.plantilla?.schema || []).map(resolveField);
      setSchema(newSchema);
      const newExisting = updated.extraccion?.jsonExtraido || {};

      if (isGranulometria) {
        setFormValues({
          serieTamices: newExisting.serieTamices || "IRAM",
          tipoAgregado: newExisting.tipoAgregado || null,
          fechaEnsayo: newExisting.fechaEnsayo || null,
          laboratorio: newExisting.laboratorio || null,
          tamices: newExisting.tamices || [],
          calculos: newExisting.calculos || null,
          comparacionCurva: newExisting.comparacionCurva || null,
        });
      } else {
        const refreshed = {};
        newSchema.forEach((f) => {
          refreshed[f.key] = newExisting[f.key] ?? null;
        });
        setFormValues(refreshed);
      }

      const faltCount = updated.extraccion?.faltantes?.length || 0;
      const mensaje = updated._mensaje;

      if (mensaje) {
        showToast({ severity: "warn", summary: mensaje });
      } else {
        showToast({
          severity: marcarComoRevisado && faltCount === 0 ? "success" : "info",
          summary: marcarComoRevisado && faltCount === 0 ? "Marcado como revisado" : "Datos guardados",
          detail: faltCount > 0 ? `Faltan ${faltCount} campos requeridos` : "Todos los campos completos",
        });
      }
    } catch (err) {
      console.error("Error al guardar revisión:", err);
      showToast({
        severity: "error",
        summary: err.response?.data?.error || "Error al guardar",
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  /* ── Faltantes computation (required only) ─────── */
  const requiredFields = schema.filter((f) => f.required);
  const localFaltantesList = requiredFields.filter((f) => isValueEmpty(formValues[f.key]));
  const localFaltantes = localFaltantesList.length;
  const totalRequired = requiredFields.length;

  /* ── Render a field based on schema type ─────────── */
  const renderField = (field) => {
    const value = formValues[field.key];
    const error = fieldErrors[field.key];

    // String/text with enum → Dropdown
    if ((field.type === "string" || field.type === "text") && field.enumValues) {
      return (
        <div>
          <Dropdown
            value={value || null}
            options={field.enumValues.map((v) => ({ label: v, value: v }))}
            onChange={(e) => handleFieldChange(field.key, e.value)}
            placeholder={`Seleccionar ${field.label.toLowerCase()}`}
            className={`w-full ${error ? "p-invalid" : ""}`}
            showClear
          />
          {error && <small className="p-error block mt-1">{error}</small>}
        </div>
      );
    }

    switch (field.type) {
      case "number":
        return (
          <div>
            <div className="p-inputgroup flex-1">
              <InputNumber
                value={value}
                onValueChange={(e) => handleFieldChange(field.key, e.value)}
                mode="decimal"
                minFractionDigits={0}
                maxFractionDigits={4}
                className={`w-full ${error ? "p-invalid" : ""}`}
                placeholder={field.label}
              />
              {field.unit && <span className="p-inputgroup-addon text-xs">{field.unit}</span>}
            </div>
            <div className="flex justify-content-between mt-1">
              {error ? (
                <small className="p-error">{error}</small>
              ) : (
                <small className="text-400">
                  {field.min !== undefined && field.max !== undefined
                    ? `Rango: ${field.min} — ${field.max}`
                    : field.min !== undefined
                    ? `Mín: ${field.min}`
                    : field.max !== undefined
                    ? `Máx: ${field.max}`
                    : ""}
                </small>
              )}
            </div>
          </div>
        );
      case "date":
        return (
          <Calendar
            value={value ? new Date(value) : null}
            onChange={(e) =>
              handleFieldChange(field.key, e.value ? e.value.toISOString().split("T")[0] : null)
            }
            dateFormat="dd/mm/yy"
            showIcon
            className="w-full"
            placeholder={field.label}
          />
        );
      case "array":
        return (
          <InputTextarea
            value={
              value
                ? typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2)
                : ""
            }
            onChange={(e) => {
              const raw = e.target.value;
              try {
                const parsed = JSON.parse(raw);
                handleFieldChange(field.key, Array.isArray(parsed) ? parsed : raw);
              } catch {
                handleFieldChange(field.key, raw);
              }
            }}
            rows={3}
            className="w-full text-sm"
            style={{ fontFamily: "monospace" }}
            placeholder={`JSON array: [{"tamiz": "4.75mm", "pasa": 95}, ...]`}
          />
        );
      case "object":
        return (
          <InputTextarea
            value={
              value
                ? typeof value === "string"
                  ? value
                  : JSON.stringify(value, null, 2)
                : ""
            }
            onChange={(e) => {
              const raw = e.target.value;
              try {
                const parsed = JSON.parse(raw);
                handleFieldChange(field.key, typeof parsed === "object" && !Array.isArray(parsed) ? parsed : raw);
              } catch {
                handleFieldChange(field.key, raw);
              }
            }}
            rows={3}
            className="w-full text-sm"
            style={{ fontFamily: "monospace" }}
            placeholder={`JSON object: {"clave": "valor", ...}`}
          />
        );
      case "string":
      case "text":
      default:
        return (
          <InputText
            value={value || ""}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            className={`w-full ${error ? "p-invalid" : ""}`}
            placeholder={field.label}
          />
        );
    }
  };

  /* ── Derived state ───────────────────────────────── */
  const estado = documento?.extraccion?.estado || "PENDIENTE";
  const isRevisado = estado === "REVISADO";
  const mime = documento?.archivo?.mimeType || "";
  const isPreviewable = mime.startsWith("image/") || mime === "application/pdf";

  /* ── Loading / not found ─────────────────────────── */
  if (loading) {
    return (
      <div className="flex justify-content-center align-items-center" style={{ height: "60vh" }}>
        <i className="pi pi-spin pi-spinner" style={{ fontSize: "2rem" }} />
      </div>
    );
  }

  if (!documento) {
    return (
      <div className="p-4">
        <p className="text-red-500">Documento no encontrado</p>
        <Button label="Volver" icon="fa-solid fa-arrow-left" severity="secondary" onClick={() => navigate(-1)} />
      </div>
    );
  }

  /* ── Main render ─────────────────────────────────── */
  return (
    <div className="p-3">
      <DetailPageHeader
        icon="fa-solid fa-file-circle-check"
        title="Revisión de documento"
        subtitle={(
          <div className="flex align-items-center gap-2 flex-wrap">
            <Tag value={ESTADO_LABELS[estado] || estado} severity={ESTADO_COLORS[estado] || "secondary"} />
            <Tag
              value={isGranulometria ? "Modo: Granulometría" : "Modo: Genérico"}
              severity={isGranulometria ? "info" : "secondary"}
              icon={isGranulometria ? "fa-solid fa-chart-area" : "fa-solid fa-list"}
              className="text-xs"
            />
            {!isGranulometria && (
              <span className="text-sm text-color-secondary">
                {localFaltantes > 0
                  ? `Faltan ${localFaltantes} de ${totalRequired} campos requeridos`
                  : `${totalRequired} campos requeridos completos`}
              </span>
            )}
          </div>
        )}
        onBack={() => navigate(-1)}
      />

      {/* ── Info bar ───────────────────────────────── */}
      <div className="surface-100 border-round p-2 mb-3 flex align-items-center gap-3 text-sm flex-wrap">
        <span>
          <strong>Archivo:</strong> {documento.archivo?.originalName}
        </span>
        <span>
          <strong>Categoría:</strong> {documento.categoria}
        </span>
        <span>
          <strong>Plantilla:</strong>{" "}
          {documento.extraccion?.plantilla
            ? `#${documento.extraccion.plantilla.idExtraccionPlantilla}`
            : <em className="text-orange-500">sin plantilla — modo genérico</em>}
        </span>
        {documento.extraccion?.plantilla?.normaReferencia && (
          <span>
            <strong>Norma:</strong> {documento.extraccion.plantilla.normaReferencia}
          </span>
        )}
        {documento.fechaDocumento && (
          <span>
            <strong>Fecha doc:</strong> {documento.fechaDocumento}
          </span>
        )}
      </div>

      {/* ── Faltantes summary (generic only) ──────── */}
      {!isGranulometria && localFaltantes > 0 && !isRevisado && (
        <div className="surface-0 border-round border-1 border-orange-300 p-2 mb-3">
          <div className="flex align-items-center gap-2 mb-1">
            <i className="fa-solid fa-circle-exclamation text-orange-500" />
            <strong className="text-sm text-orange-700">
              Campos requeridos faltantes ({localFaltantes})
            </strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {localFaltantesList.map((f) => (
              <Tag
                key={f.key}
                value={f.label}
                severity="warning"
                className="text-xs"
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Split view: preview + form ─────────────── */}
      <div className="grid">
        {/* Left: document preview */}
        <div className="col-12 md:col-6">
          <div
            className="surface-border border-1 border-round"
            style={{ height: "calc(100vh - 300px)", overflow: "hidden" }}
          >
            {isPreviewable && previewUrl ? (
              mime === "application/pdf" ? (
                <iframe
                  src={previewUrl}
                  style={{ width: "100%", height: "100%", border: "none" }}
                  title="Vista previa del documento"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt="Vista previa"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              )
            ) : (
              <div className="flex flex-column align-items-center justify-content-center h-full text-500">
                <i className="fa-solid fa-file text-5xl mb-2" />
                <span>Vista previa no disponible para este tipo de archivo</span>
                <div className="flex gap-2 mt-2">
                  <Button
                    label="Descargar"
                    icon="fa-solid fa-download"
                    size="small"
                    outlined
                    onClick={() => {
                      const archivoId = documento.archivo?.idCalidadArchivo;
                      if (!archivoId) return;
                      axios
                        .get(`${config.backendUrl}/api/calidad/documentos/${archivoId}/download`, {
                          headers: config.headers,
                          responseType: "blob",
                        })
                        .then((res) => {
                          const url = window.URL.createObjectURL(new Blob([res.data]));
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = documento.archivo.originalName;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          window.URL.revokeObjectURL(url);
                        });
                    }}
                  />
                  <Button
                    label="Abrir en nueva pestaña"
                    icon="fa-solid fa-up-right-from-square"
                    size="small"
                    outlined
                    severity="secondary"
                    onClick={() => {
                      const archivoId = documento.archivo?.idCalidadArchivo;
                      if (!archivoId) return;
                      axios
                        .get(`${config.backendUrl}/api/calidad/documentos/${archivoId}/download`, {
                          headers: config.headers,
                          responseType: "blob",
                        })
                        .then((res) => {
                          const url = window.URL.createObjectURL(new Blob([res.data], { type: documento.archivo?.mimeType }));
                          window.open(url, "_blank");
                        });
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: dynamic form or specialized editor */}
        <div className="col-12 md:col-6">
          <div
            className="surface-border border-1 border-round p-3"
            style={{ height: "calc(100vh - 300px)", overflowY: "auto" }}
          >
            {isGranulometria ? (
              <GranulometriaEditor
                formValues={formValues}
                onFormChange={setFormValues}
                saving={saving}
                onSave={handleSave}
                isRevisado={isRevisado}
                showEnsayoHeaderFields
              />
            ) : (
              <>
                <h4 className="mt-0 mb-3">Datos del documento</h4>

                {schema.length === 0 ? (
                  <p className="text-500">No hay campos definidos para esta plantilla</p>
                ) : (
                  <div className="flex flex-column gap-3">
                    {schema.map((field) => {
                      const isFaltante = field.required && isValueEmpty(formValues[field.key]);
                      return (
                        <div key={field.key}>
                          <label className="font-bold text-sm mb-1 block">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                            {field.unit && (
                              <span className="text-400 font-normal ml-1">({field.unit})</span>
                            )}
                            {isFaltante && (
                              <span className="text-orange-500 text-xs font-normal ml-2">
                                — requerido
                              </span>
                            )}
                          </label>
                          {renderField(field)}
                        </div>
                      );
                    })}

                    {/* Optional fields separator if there are non-required fields */}
                    {schema.some((f) => !f.required) && schema.some((f) => f.required) && (
                      <Divider className="my-1" />
                    )}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex justify-content-end gap-2 mt-4 pt-3 border-top-1 surface-border">
                  {documento.extraccion?.errores && (
                    <span className="text-xs text-red-500 mr-auto align-self-center" style={{ maxWidth: "50%" }}>
                      <i className="fa-solid fa-triangle-exclamation mr-1" />
                      {documento.extraccion.errores}
                    </span>
                  )}
                  <Button
                    label="Guardar"
                    icon="fa-solid fa-save"
                    size="small"
                    severity="info"
                    outlined
                    loading={saving}
                    disabled={saving}
                    onClick={() => handleSave(false)}
                  />
                  <Button
                    label={
                      isRevisado
                        ? "Ya revisado"
                        : localFaltantes > 0
                        ? `Faltan ${localFaltantes} campo(s)`
                        : "Guardar y Marcar Revisado"
                    }
                    icon="fa-solid fa-check-circle"
                    size="small"
                    severity="success"
                    loading={saving}
                    onClick={() => handleSave(true)}
                    disabled={isRevisado || localFaltantes > 0 || saving}
                    tooltip={
                      localFaltantes > 0
                        ? "Complete todos los campos requeridos para marcar como revisado"
                        : undefined
                    }
                    tooltipOptions={{ position: "top" }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MaterialDocRevision;
