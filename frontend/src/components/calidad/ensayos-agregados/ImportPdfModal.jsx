import React, { useState, useMemo, useCallback, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { FileUpload } from "primereact/fileupload";
import { Dropdown } from "primereact/dropdown";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Checkbox } from "primereact/checkbox";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { ProgressBar } from "primereact/progressbar";
import { Message } from "primereact/message";
import { Accordion, AccordionTab } from "primereact/accordion";
import { Tooltip } from "primereact/tooltip";
import { previewPdfImport, confirmPdfImport } from "../../../services/agregadoEnsayoService";
import { useToast } from "../../../context/ToastContext";

const USO_OPTIONS = [
    { label: "Auto-detectar", value: null },
    { label: "Fino", value: "FINO" },
    { label: "Grueso", value: "GRUESO" },
    { label: "Total", value: "TOTAL" },
    { label: "Mezcla", value: "MEZCLA" },
];

const CONFIDENCE_SEVERITY = (c) => {
    if (c >= 0.8) return "success";
    if (c >= 0.5) return "warning";
    return "danger";
};

const CONFIDENCE_LABEL = (c) => {
    if (c >= 0.8) return "Alta";
    if (c >= 0.5) return "Media";
    return "Baja";
};

const ImportPdfModal = ({ visible, onHide, legacyAgregadoId, onImported, defaultUsoAgregado }) => {
    const showToast = useToast();

    // ─── State ──────────────────────────────────────────────
    const [step, setStep] = useState("upload"); // upload | preview | confirming | done
    const [uso, setUso] = useState(defaultUsoAgregado || null);
    const [extracting, setExtracting] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const confirmingRef = useRef(false);
    const [pdfFile, setPdfFile] = useState(null);
    const [pdfBase64, setPdfBase64] = useState(null);

    // Preview data
    const [documentMeta, setDocumentMeta] = useState(null);
    const [items, setItems] = useState([]);
    const [selected, setSelected] = useState(new Set());

    // Confirm results
    const [confirmResult, setConfirmResult] = useState(null);
    const [confirmErrors, setConfirmErrors] = useState([]);

    // ─── Reset on close ─────────────────────────────────────
    const handleHide = useCallback(() => {
        setStep("upload");
        setUso(null);
        setExtracting(false);
        setConfirming(false);
        setPdfFile(null);
        setPdfBase64(null);
        setDocumentMeta(null);
        setItems([]);
        setSelected(new Set());
        setConfirmResult(null);
        setConfirmErrors([]);
        onHide();
    }, [onHide]);

    // ─── Upload + Extract ───────────────────────────────────
    const handleUpload = useCallback(async (event) => {
        const file = event.files?.[0];
        if (!file) return;

        setPdfFile(file);
        setExtracting(true);

        try {
            // Convert to base64 for later confirm
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(",")[1];
                setPdfBase64(base64);
            };
            reader.readAsDataURL(file);

            const result = await previewPdfImport(file, legacyAgregadoId, uso);
            setDocumentMeta(result.documentMeta);
            setItems(result.items || []);
            // Auto-select all items with a valid tipo AND not disabled
            const autoSelect = new Set();
            (result.items || []).forEach((item, idx) => {
                if (item._idAgregadoEnsayoTipo && !item.disabled) {
                    autoSelect.add(idx);
                }
            });
            setSelected(autoSelect);
            setStep("preview");
        } catch (err) {
            console.error("Error al procesar PDF:", err);
            showToast("error", err.response?.data?.error || "Error al procesar PDF con Claude");
        } finally {
            setExtracting(false);
        }
    }, [legacyAgregadoId, uso, showToast]);

    // ── Toggle selection (skip disabled) ───────────────────────────
    const toggleItem = useCallback((idx) => {
        if (items[idx]?.disabled) return;
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    }, []);

    // ─── Edit item field ────────────────────────────────────
    const updateItemField = useCallback((idx, fieldPath, value) => {
        setItems((prev) => {
            const next = [...prev];
            const item = { ...next[idx] };
            const campos = { ...item.campos };

            campos[fieldPath] = value;
            item.campos = campos;
            next[idx] = item;
            return next;
        });
    }, []);

    // ─── Confirm ────────────────────────────────────────────
    const handleConfirm = useCallback(async () => {
        if (confirmingRef.current) return;
        const selections = items
            .filter((_, idx) => selected.has(idx))
            .map((item) => ({
                tipoCodigo: item.tipoCodigo,
                campos: item.campos,
                resultado: item.resultado,
                confidence: item.confidence,
                warnings: item.warnings,
                pageRange: item.pageRange,
            }));

        if (selections.length === 0) {
            showToast("warn", "Seleccioná al menos un ensayo para importar");
            return;
        }

        confirmingRef.current = true;
        setConfirming(true);
        setConfirmErrors([]);
        try {
            const result = await confirmPdfImport({
                legacyAgregadoId,
                selections,
                pdfBase64,
                pdfFilename: pdfFile?.name || "informe.pdf",
            });
            setConfirmResult(result);
            setStep("done");
            showToast("success", result.message);
            onImported?.();
        } catch (err) {
            console.error("Error al confirmar importación:", err);
            const errData = err.response?.data;
            if (err.response?.status === 400 && errData) {
                // Show structured errors in panel
                const msgs = [];
                if (errData.error) msgs.push(errData.error);
                if (errData.errors && Array.isArray(errData.errors)) {
                    errData.errors.forEach((e) => msgs.push(typeof e === 'string' ? e : `${e.tipoCodigo || ''}: ${e.error || JSON.stringify(e)}`));
                }
                setConfirmErrors(msgs.length > 0 ? msgs : [errData.error || "Error de validación"]);
            } else {
                showToast("error", errData?.error || "Error al confirmar importación");
            }
        } finally {
            confirmingRef.current = false;
            setConfirming(false);
        }
    }, [items, selected, legacyAgregadoId, pdfBase64, pdfFile, showToast, onImported]);

    // ─── Computed ───────────────────────────────────────────
    const selectedCount = selected.size;

    // ─── Render: Upload step ────────────────────────────────
    const renderUploadStep = () => (
        <div className="flex flex-column gap-3">
            {!defaultUsoAgregado && (
            <div className="grid">
                <div className="col-12 md:col-6">
                    <label className="block font-bold mb-1">Tipo de material (opcional)</label>
                    <Dropdown
                        value={uso}
                        onChange={(e) => setUso(e.value)}
                        options={USO_OPTIONS}
                        placeholder="Auto-detectar"
                        className="w-full"
                    />
                    <small className="text-color-secondary">Ayuda a Claude a clasificar mejor los ensayos</small>
                </div>
            </div>
            )}

            <div>
                <label className="block font-bold mb-1">Archivo PDF del informe</label>
                <FileUpload
                    mode="basic"
                    accept="application/pdf"
                    maxFileSize={30 * 1024 * 1024}
                    auto
                    customUpload
                    uploadHandler={handleUpload}
                    chooseLabel="Seleccionar PDF"
                    chooseOptions={{
                        icon: "fa-solid fa-file-pdf",
                        className: "p-button-outlined",
                    }}
                    disabled={extracting}
                />
            </div>

            {extracting && (
                <div className="mt-2">
                    <ProgressBar mode="indeterminate" style={{ height: "clamp(160px, 30vh, 6px)" }} />
                    <p className="text-sm text-color-secondary mt-1">
                        <i className="fa-solid fa-robot mr-2" />
                        Procesando PDF con Claude... Esto puede tomar 15-30 segundos.
                    </p>
                </div>
            )}
        </div>
    );

    // ─── Render: Preview step ───────────────────────────────
    const renderPreviewStep = () => (
        <div className="flex flex-column gap-3">
            {/* Document meta */}
            {documentMeta && (
                <div className="surface-100 border-round p-3">
                    <div className="flex align-items-center gap-3 flex-wrap">
                        <div className="flex align-items-center gap-2">
                            <i className="fa-solid fa-file-pdf text-red-500" />
                            <span className="font-semibold">{documentMeta.filename}</span>
                        </div>
                        <Tag value={`${documentMeta.pages} página(s)`} severity="info" className="text-xs" />
                        {documentMeta.detectedLab && (
                            <Tag value={`Lab: ${documentMeta.detectedLab}`} severity="success" className="text-xs" />
                        )}
                        {documentMeta.detectedFormat && (
                            <Tag value={documentMeta.detectedFormat} className="text-xs" />
                        )}
                        <span className="text-xs text-500 ml-auto">
                            Modelo: {documentMeta.extractionModel}
                        </span>
                    </div>
                </div>
            )}

            {items.length === 0 && (
                <Message severity="warn" text="No se detectaron ensayos en el PDF" />
            )}

            {/* Confirm validation errors panel */}
            {confirmErrors.length > 0 && (
                <div className="border-round border-1 border-red-300 surface-ground p-3">
                    <div className="flex align-items-center gap-2 mb-2">
                        <i className="fa-solid fa-circle-xmark text-red-500" />
                        <span className="font-semibold text-red-700 text-sm">Error de validación al importar</span>
                    </div>
                    {confirmErrors.map((msg, i) => (
                        <Message key={i} severity="error" text={msg} className="mb-1 w-full text-xs" />
                    ))}
                </div>
            )}

            {/* Items list */}
            {items.length > 0 && (
                <>
                    <div className="flex align-items-center justify-content-between">
                        <span className="font-semibold">
                            {items.length} ensayo(s) detectado(s) — {selectedCount} seleccionado(s)
                        </span>
                        <div className="flex gap-2">
                            <Button
                                label="Seleccionar todos"
                                size="small"
                                text
                                onClick={() => {
                                    const selectable = new Set();
                                    items.forEach((it, i) => { if (!it.disabled) selectable.add(i); });
                                    setSelected(selectable);
                                }}
                            />
                            <Button
                                label="Ninguno"
                                size="small"
                                text
                                severity="secondary"
                                onClick={() => setSelected(new Set())}
                            />
                        </div>
                    </div>

                    <Accordion multiple>
                        {items.map((item, idx) => (
                            <AccordionTab
                                key={idx}
                                header={
                                    <div className={`flex align-items-center gap-2 w-full ${item.disabled ? 'opacity-50' : ''}`}>
                                        <span
                                            className={item.disabled ? `disabled-import-item-${idx}` : ''}
                                            data-pr-tooltip={item.disabledReason || ''}
                                            data-pr-position="top"
                                        >
                                            <Checkbox
                                                checked={selected.has(idx)}
                                                onChange={() => toggleItem(idx)}
                                                onClick={(e) => e.stopPropagation()}
                                                disabled={!!item.disabled}
                                            />
                                        </span>
                                        {item.disabled && (
                                            <Tooltip target={`.disabled-import-item-${idx}`} />
                                        )}
                                        <span className="font-semibold text-sm">
                                            {item.tipoNombre || item.tipoCodigo}
                                        </span>
                                        {item.norma && (
                                            <Tag value={item.norma} className="text-xs" severity="info" />
                                        )}
                                        <Tag
                                            value={`${CONFIDENCE_LABEL(item.confidence.overall)} (${Math.round(item.confidence.overall * 100)}%)`}
                                            severity={CONFIDENCE_SEVERITY(item.confidence.overall)}
                                            className="text-xs"
                                        />
                                        {item.warnings.length > 0 && (
                                            <Tag
                                                value={`${item.warnings.length} aviso(s)`}
                                                severity="warning"
                                                icon="fa-solid fa-triangle-exclamation"
                                                className="text-xs"
                                            />
                                        )}
                                        {!item._idAgregadoEnsayoTipo && !item.disabled && (
                                            <Tag value="Sin tipo mapeado" severity="danger" className="text-xs" />
                                        )}
                                        {item.disabled && (
                                            <Tag value="Derivado" severity="secondary" className="text-xs" icon="fa-solid fa-lock" />
                                        )}
                                        <span className="text-xs text-500 ml-auto">
                                            Pág. {item.pageRange?.[0]}–{item.pageRange?.[1]}
                                        </span>
                                    </div>
                                }
                            >
                                {/* Editable fields */}
                                <div className="grid mb-3">
                                    <div className="col-12 sm:col-6 lg:col-3">
                                        <label className="block text-sm font-semibold mb-1">Fecha ensayo</label>
                                        <Calendar
                                            value={item.campos.fechaEnsayo ? new Date(item.campos.fechaEnsayo + "T12:00:00") : null}
                                            onChange={(e) =>
                                                updateItemField(idx, "fechaEnsayo", e.value ? e.value.toISOString().slice(0, 10) : null)
                                            }
                                            dateFormat="dd/mm/yy"
                                            showIcon
                                            className="w-full"
                                        />
                                    </div>
                                    <div className="col-12 sm:col-6 lg:col-3">
                                        <label className="block text-sm font-semibold mb-1">Fecha muestreo</label>
                                        <Calendar
                                            value={item.campos.fechaMuestreo ? new Date(item.campos.fechaMuestreo + "T12:00:00") : null}
                                            onChange={(e) =>
                                                updateItemField(idx, "fechaMuestreo", e.value ? e.value.toISOString().slice(0, 10) : null)
                                            }
                                            dateFormat="dd/mm/yy"
                                            showIcon
                                            className="w-full"
                                        />
                                    </div>
                                    <div className="col-12 sm:col-6 lg:col-3">
                                        <label className="block text-sm font-semibold mb-1">Laboratorio</label>
                                        <InputText
                                            value={item.campos.laboratorio || ""}
                                            onChange={(e) => updateItemField(idx, "laboratorio", e.target.value)}
                                            className="w-full"
                                        />
                                    </div>
                                    <div className="col-12 sm:col-6 lg:col-3">
                                        <label className="block text-sm font-semibold mb-1">Nro. informe</label>
                                        <InputText
                                            value={item.campos.nroInforme || ""}
                                            onChange={(e) => updateItemField(idx, "nroInforme", e.target.value)}
                                            className="w-full"
                                        />
                                    </div>
                                </div>

                                {/* Warnings */}
                                {item.warnings.length > 0 && (
                                    <div className="mb-2">
                                        {item.warnings.map((w, wi) => (
                                            <Message
                                                key={wi}
                                                severity="warn"
                                                text={w}
                                                className="mb-1 w-full text-xs"
                                            />
                                        ))}
                                    </div>
                                )}

                                {/* Preview resultado */}
                                {item.resultado && (
                                    <div className="surface-ground border-round p-2">
                                        <span className="font-semibold text-sm block mb-2">
                                            <i className="fa-solid fa-database mr-2" />
                                            Datos extraídos
                                        </span>
                                        {renderResultadoPreview(item)}
                                    </div>
                                )}
                            </AccordionTab>
                        ))}
                    </Accordion>
                </>
            )}
        </div>
    );

    // ─── Render resultado preview per tipo ───────────────────
    const renderResultadoPreview = (item) => {
        const { tipoCodigo, resultado } = item;

        // Granulometría: show tamices table + reportado
        if (tipoCodigo.includes("GRANULOMETRIA") && resultado?.granulometria) {
            const tamices = resultado.granulometria.tamices || [];
            const reportado = resultado.granulometria.reportado;
            return (
                <div>
                    <div className="flex align-items-center gap-2 mb-2">
                        <Tag value={resultado.granulometria.serieTamices || "IRAM"} className="text-xs" />
                        {resultado.granulometria.tipoAgregado && (
                            <Tag value={resultado.granulometria.tipoAgregado} severity="info" className="text-xs" />
                        )}
                        <span className="text-xs text-500">{tamices.length} tamices</span>
                    </div>
                    {reportado && (reportado.moduloFinura != null || reportado.tmnMm != null) && (
                        <div className="flex align-items-center gap-2 mb-2 surface-100 border-round p-2">
                            <Tag value="Reportado en PDF" severity="info" icon="fa-solid fa-file-lines" className="text-xs" />
                            {reportado.moduloFinura != null && (
                                <span className="text-sm">
                                    <strong>MF:</strong> {reportado.moduloFinura}
                                </span>
                            )}
                            {reportado.tmnMm != null && (
                                <span className="text-sm">
                                    <strong>TMN:</strong> {reportado.tmnMm} mm
                                </span>
                            )}
                            <span className="text-xs text-500 ml-auto">
                                (se comparará con cálculo del sistema)
                            </span>
                        </div>
                    )}
                    <DataTable responsiveLayout="scroll" value={tamices} size="small" scrollable scrollHeight="200px" className="text-xs">
                        <Column header="Tamiz" field="tamiz" style={{ width: "120px" }} />
                        <Column
                            header="Abertura (mm)"
                            field="aberturaMm"
                            body={(row) => row.aberturaMm}
                            style={{ width: "100px" }}
                        />
                        <Column
                            header="% Pasa"
                            field="pasaPct"
                            body={(row) => (row.pasaPct != null ? row.pasaPct.toFixed(1) : "—")}
                            style={{ width: "80px" }}
                        />
                    </DataTable>
                </div>
            );
        }

        // Other tipos: show key-value pairs
        const entries = Object.entries(resultado).filter(
            ([k]) => k !== "extraction" && k !== "granulometria"
        );

        if (entries.length === 0) return <span className="text-500 text-xs">Sin datos</span>;

        return (
            <div className="flex flex-column gap-1">
                {entries.map(([key, val]) => (
                    <div key={key} className="flex align-items-center gap-2">
                        <span className="text-xs text-600 font-semibold" style={{ minWidth: "120px" }}>
                            {key}:
                        </span>
                        <span className="text-xs">
                            {val != null ? (typeof val === "object" ? JSON.stringify(val) : String(val)) : "—"}
                        </span>
                    </div>
                ))}
            </div>
        );
    };

    // ─── Render: Done step ──────────────────────────────────
    const renderDoneStep = () => (
        <div className="flex flex-column gap-3">
            <Message severity="success" text={confirmResult?.message || "Importación completada"} className="w-full" />

            {confirmResult?.created?.length > 0 && (
                <div>
                    <h5 className="mt-0 mb-2">Ensayos creados:</h5>
                    <DataTable responsiveLayout="scroll" value={confirmResult.created} size="small" className="text-sm">
                        <Column field="tipoNombre" header="Tipo" />
                        <Column field="fechaEnsayo" header="Fecha" />
                        <Column field="idAgregadoEnsayo" header="ID" />
                    </DataTable>
                </div>
            )}

            {confirmResult?.errors?.length > 0 && (
                <div>
                    <h5 className="mt-0 mb-2 text-red-500">Errores:</h5>
                    {confirmResult.errors.map((e, i) => (
                        <Message key={i} severity="error" text={`${e.tipoCodigo}: ${e.error}`} className="mb-1 w-full" />
                    ))}
                </div>
            )}

            {confirmResult?.warnings?.length > 0 && (
                <div>
                    <h5 className="mt-0 mb-2 text-orange-500">Avisos:</h5>
                    {confirmResult.warnings.map((w, i) => (
                        <Message key={i} severity="warn" text={w} className="mb-1 w-full" />
                    ))}
                </div>
            )}
        </div>
    );

    // ─── Footer ─────────────────────────────────────────────
    const footer = useMemo(() => {
        if (step === "upload") {
            return (
                <div className="flex justify-content-end">
                    <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" rounded size="small" onClick={handleHide} />
                </div>
            );
        }
        if (step === "preview") {
            return (
                <div className="flex justify-content-between">
                    <Button
                        label="Volver"
                        icon="fa-solid fa-arrow-left"
                        severity="secondary"
                        rounded
                        size="small"
                        onClick={() => setStep("upload")}
                    />
                    <div className="flex gap-2">
                        <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" rounded size="small" onClick={handleHide} />
                        <Button
                            label={`Importar ${selectedCount} ensayo(s)`}
                            icon="fa-solid fa-check"
                            rounded
                            size="small"
                            loading={confirming}
                            disabled={selectedCount === 0 || confirming}
                            onClick={handleConfirm}
                        />
                    </div>
                </div>
            );
        }
        // done
        return (
            <div className="flex justify-content-end">
                <Button label="Cerrar" icon="fa-solid fa-check" rounded size="small" onClick={handleHide} />
            </div>
        );
    }, [step, selectedCount, confirming, handleHide, handleConfirm]);

    return (
        <Dialog
            visible={visible}
            onHide={handleHide}
            header={
                <span>
                    <i className="fa-solid fa-file-import mr-2" />
                    Importar ensayos desde PDF
                </span>
            }
            footer={footer}
            className="w-12 xl:w-8"
            modal
            dismissableMask={step !== "confirming"}
        >
            {step === "upload" && renderUploadStep()}
            {step === "preview" && renderPreviewStep()}
            {step === "done" && renderDoneStep()}
        </Dialog>
    );
};

export default ImportPdfModal;
