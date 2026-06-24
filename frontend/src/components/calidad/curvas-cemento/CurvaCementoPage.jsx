import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { TabView, TabPanel } from "primereact/tabview";
import { confirmDialog } from "primereact/confirmdialog";
import { Message } from "primereact/message";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
  getCurvasCemento,
  createCurvaCemento,
  updateCurvaCemento,
  deleteCurvaCemento,
  analizarCurvaCementoPdf,
} from "../../../services/curvaCementoService";
import { config } from "../../../config/config";
import axios from "axios";

const FAMILIA_OPTIONS = [
  { label: "CP30", value: "CP30" },
  { label: "CP40", value: "CP40" },
  { label: "CP50", value: "CP50" },
  { label: "Otra", value: "OTRA" },
];

const EDAD_OPCIONES = [1, 2, 3, 7, 14, 28, 56, 90, 180, 365];

/* ─── helpers ─── */
const ORIGEN_OPTIONS = [
  { label: 'Referencia general', value: 'ICPA' },
  { label: 'Fabricante', value: 'FABRICANTE' },
  { label: 'Curva propia', value: 'PROPIA' },
];

const emptyHeader = () => ({
  cementoId: null,
  familiaCemento: null,
  idPlanta: null,
  nombre: "",
  tipoCurva: "TABLA_AC_RESISTENCIA",
  origenCurva: "PROPIA",
  fabricante: "",
  plantaFabrica: "",
  anioVigencia: null,
  fuenteDocumento: "",
  observaciones: "",
  version: "",
  metadataJson: null,
});

const emptyDraft = () => ({
  nombre: null,
  tipoCurva: null,
  cementoId: null,
  familiaCemento: null,
  fabricante: null,
  plantaFabrica: null,
  anioVigencia: null,
  fuenteDocumento: null,
  observaciones: null,
});

const emptyPunto = (edad) => ({ edadDias: edad, relacionAc: null, resistenciaMpa: null, orden: 0 });

/* ─── Draft indicator style ─── */
const draftInputStyle = { border: "2px solid #3b82f6", borderRadius: "6px" };

/* ─── Dialog principal ─── */
function CurvaCementoDialog({ visible, onHide, onSave, initial, cementos, plantas = [], readOnly = false, saving = false }) {
  const [form, setForm] = useState(emptyHeader());
  const [draftSources, setDraftSources] = useState(emptyDraft());
  const [puntos, setPuntos] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [pdfFile, setPdfFile] = useState(null);
  const [analyzingPdf, setAnalyzingPdf] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [validationError, setValidationError] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setForm({
        cementoId: initial.cementoId ?? null,
        familiaCemento: initial.familiaCemento ?? null,
        idPlanta: initial.idPlanta ?? null,
        nombre: initial.nombre ?? "",
        tipoCurva: initial.tipoCurva ?? "TABLA_AC_RESISTENCIA",
        origenCurva: initial.origenCurva ?? "FABRICANTE",
        fabricante: initial.fabricante ?? "",
        plantaFabrica: initial.plantaFabrica ?? "",
        anioVigencia: initial.anioVigencia ?? null,
        fuenteDocumento: initial.fuenteDocumento ?? "",
        observaciones: initial.observaciones ?? "",
        version: initial.version ?? "",
        metadataJson: initial.metadataJson ?? null,
      });
      setPuntos(initial.puntos?.length > 0 ? initial.puntos.map((p) => ({ ...p })) : []);
    } else {
      setForm(emptyHeader());
      setPuntos([]);
    }
    setDraftSources(emptyDraft());
    setPdfFile(null);
    setAnalyzeError("");
    setValidationError("");
    setActiveTab(0);
  }, [initial, visible]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const clearDraft = (k) => setDraftSources((d) => ({ ...d, [k]: null }));
  const isDraft = (k) => draftSources[k] === "AUTO";

  const setAndClearDraft = (k, v) => {
    set(k, v);
    clearDraft(k);
  };

  /* ── PDF analysis ── */
  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setPdfFile(f);
      setAnalyzeError("");
    }
  };

  const handleAnalyzePdf = async () => {
    if (!pdfFile) return;
    setAnalyzingPdf(true);
    setAnalyzeError("");
    try {
      const result = await analizarCurvaCementoPdf(pdfFile);
      const { meta, puntos: pts, confidence } = result;

      const newForm = { ...form };
      const newDraft = { ...draftSources };

      const fillField = (formKey, value) => {
        if (value !== null && value !== undefined && value !== "") {
          newForm[formKey] = value;
          newDraft[formKey] = "AUTO";
        }
      };

      fillField("nombre", meta?.nombre);
      fillField("fabricante", meta?.fabricante);
      fillField("plantaFabrica", meta?.plantaFabrica);
      fillField("anioVigencia", meta?.anioVigencia);
      fillField("familiaCemento", meta?.familiaCemento);
      fillField("observaciones", meta?.observaciones);
      if (meta?.fuenteDocumento) fillField("fuenteDocumento", meta.fuenteDocumento);

      // Fill tabla (primary) — always try first
      const ptsValidos = Array.isArray(pts) ? pts.filter((p) => p.relacionAc != null && p.resistenciaMpa != null) : [];
      if (ptsValidos.length > 0) {
        setPuntos(ptsValidos.map((p) => ({
          edadDias: p.edadDias,
          relacionAc: p.relacionAc,
          resistenciaMpa: p.resistenciaMpa,
          orden: 0,
        })));
      }

      const allWarnings = [...(result.warnings || [])];

      newForm.metadataJson = {
        pdfOriginalName: pdfFile.name,
        fechaAnalisis: new Date().toISOString(),
        camposAutoDetectados: Object.keys(newDraft).filter((k) => newDraft[k] === "AUTO"),
        confidence: confidence || {},
        warnings: allWarnings,
        paginasAnalizadas: result.paginasAnalizadas,
        puntosExtraidos: ptsValidos.length,
      };

      setForm(newForm);
      setDraftSources(newDraft);

      setActiveTab(0);

      if (ptsValidos.length === 0) {
        setAnalyzeError(
          "No se pudo extraer datos de la curva. Verificá que el PDF contenga una tabla a/c vs resistencia."
        );
      }
    } catch (err) {
      setAnalyzeError(err?.response?.data?.error || "Error al analizar el PDF.");
    } finally {
      setAnalyzingPdf(false);
    }
  };

  /* ── puntos helpers ── */
  const addEdadPunto = (edad) => {
    if (!puntos.find((p) => p.edadDias === edad))
      setPuntos((prev) => [...prev, emptyPunto(edad)]);
  };
  const removePuntoByEdad = (edad) => setPuntos((prev) => prev.filter((p) => p.edadDias !== edad));

  /* ── validation + save ── */
  const handleSave = () => {
    if (!form.nombre?.trim()) {
      setValidationError("El nombre de la curva es obligatorio.");
      return;
    }
    const puntosValidos = puntos.filter((p) => p.relacionAc != null && p.resistenciaMpa != null);

    const edadesConDatos = [...new Set(puntosValidos.map((p) => p.edadDias))].filter(
      (edad) => puntosValidos.filter((p) => p.edadDias === edad).length >= 2
    );
    if (edadesConDatos.length === 0) {
      setValidationError(
        "Debe cargar al menos una edad con 2 o más puntos válidos (a/c + resistencia)."
      );
      return;
    }

    setValidationError("");
    const payload = {
      ...form,
      tipoCurva: "TABLA_AC_RESISTENCIA",
      origenCurva: form.origenCurva || 'PROPIA',
      puntos,
      abrams: [],
    };
    onSave(payload);
  };
  const hasDraftFields = Object.values(draftSources).some((v) => v === "AUTO");

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label={readOnly ? "Cerrar" : "Cancelar"} severity="secondary" outlined onClick={onHide} />
      {!readOnly && <Button label="Guardar" icon="fa-solid fa-floppy-disk" onClick={handleSave} disabled={saving} loading={saving} />}
    </div>
  );

  return (
    <Dialog
      header={readOnly ? "Ver curva de cemento" : initial?.id ? "Editar curva de cemento" : "Nueva curva de cemento"}
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: "860px" }}
      modal
      footer={footer}
    >
      {/* Read-only mode: show chart first */}
      {readOnly && puntos.length > 0 && (
        <div className="mb-3 p-3 surface-ground border-round">
          <h4 className="mt-0 mb-2"><i className="fa-solid fa-chart-line mr-2 text-primary" />Curva a/c vs Resistencia</h4>
          <div style={{position: 'relative', height: 'clamp(200px, 40vh, 280px)'}}>
            {(() => {
              try {
                const Chart = require('primereact/chart').Chart;
                const pts = [...puntos]
                  .filter((p) => p.relacionAc != null && p.resistenciaMpa != null)
                  .sort((a, b) => Number(a.relacionAc) - Number(b.relacionAc));
                const chartData = {
                  datasets: [{
                    label: form.nombre || 'Curva',
                    data: pts.map(p => ({ x: Number(p.relacionAc), y: Number(p.resistenciaMpa) })),
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    pointBackgroundColor: '#3B82F6',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    borderWidth: 2.5,
                    tension: 0.3,
                    fill: true,
                  }],
                };
                const chartOpts = {
                  responsive: true, maintainAspectRatio: false, devicePixelRatio: 3,
                  scales: {
                    x: { type: 'linear', title: { display: true, text: 'Relaci\u00f3n a/c', font: { size: 13, weight: 'bold' } }, min: 0.25, max: 1.05, ticks: { stepSize: 0.05, font: { size: 11 } } },
                    y: { title: { display: true, text: 'Resistencia (MPa)', font: { size: 13, weight: 'bold' } }, min: 0, ticks: { font: { size: 11 } } },
                  },
                  plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 12 } } } },
                };
                return <Chart type="line" data={chartData} options={chartOpts} style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%'}} />;
              } catch { return <p className="text-color-secondary">Gr\u00e1fico no disponible</p>; }
            })()}
          </div>
        </div>
      )}
      <fieldset disabled={readOnly} style={{border: 'none', padding: 0, margin: 0}}>
      <TabView activeIndex={activeTab} onTabChange={(e) => setActiveTab(e.index)}>
        {/* ── Tab 1: Datos generales ── */}
        <TabPanel header="Datos generales">
          <div className="flex flex-column gap-3 pt-2">

            {/* PDF fuente */}
            <div className="p-3 border-1 border-round surface-ground flex flex-column gap-2">
              <div className="flex align-items-center gap-2">
                <i className="fa-solid fa-file-pdf text-primary" />
                <span className="font-semibold text-sm">PDF fuente (opcional)</span>
                {hasDraftFields && (
                  <Tag value="Datos autocompletados" severity="info" icon="fa-solid fa-wand-magic-sparkles" className="ml-auto" style={{ fontSize: "0.75rem" }} />
                )}
              </div>
              <div className="flex align-items-center gap-2 flex-wrap">
                <Button
                  label="Seleccionar PDF"
                  icon="fa-solid fa-upload"
                  severity="secondary"
                  outlined
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={analyzingPdf}
                />
                {pdfFile && (
                  <span className="text-sm text-color-secondary">
                    <i className="fa-solid fa-file-pdf mr-1" />
                    {pdfFile.name}
                  </span>
                )}
                {pdfFile && (
                  <Button
                    label={analyzingPdf ? "Analizando..." : "Analizar PDF"}
                    icon="fa-solid fa-wand-magic-sparkles"
                    size="small"
                    onClick={handleAnalyzePdf}
                    loading={analyzingPdf}
                  />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
              </div>
              {analyzeError && (
                <small className="text-red-500">
                  <i className="fa-solid fa-circle-exclamation mr-1" />{analyzeError}
                </small>
              )}
              {hasDraftFields && (
                <small className="text-blue-500">
                  <i className="fa-solid fa-circle-info mr-1" />
                  Los campos con borde azul fueron autocompletados. Podés editarlos antes de guardar.
                </small>
              )}
            </div>

            {/* Grid 12 columnas */}
            <div className="grid">
              {/* Fila 1: Nombre (12) */}
              <div className="col-12 flex flex-column gap-1">
                <small>Nombre <span className="text-red-500">*</span></small>
                <InputText
                  value={form.nombre}
                  onChange={(e) => setAndClearDraft("nombre", e.target.value)}
                  placeholder="Ej: Curva Zapala CP40 2025"
                  className="w-full"
                  style={isDraft("nombre") ? draftInputStyle : {}}
                />
                {isDraft("nombre") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>

              {/* Fila 1b: Origen */}
              <div className="col-12 sm:col-6 flex flex-column gap-1">
                <small>Origen de la curva <span className="text-red-500">*</span></small>
                <Dropdown
                  value={form.origenCurva}
                  onChange={(e) => {
                    set("origenCurva", e.value);
                    // ICPA y FABRICANTE son típicamente globales (sin planta); PROPIA suele ser por planta.
                    if (e.value === 'FABRICANTE' || e.value === 'ICPA') set("idPlanta", null);
                  }}
                  options={ORIGEN_OPTIONS}
                  className="w-full"
                  disabled={readOnly}
                />
                <small className="text-color-secondary" style={{ fontSize: '0.7rem' }}>
                  {form.origenCurva === 'PROPIA'
                    ? 'Curva calibrada con ensayos propios para este cemento + planta.'
                    : form.origenCurva === 'ICPA'
                      ? 'Curva genérica de referencia por familia (CP30/CP40/CP50).'
                      : 'Curva provista por el fabricante del cemento.'}
                </small>
              </div>

              {/* Fila 1c: Ámbito (planta) */}
              <div className="col-12 sm:col-6 flex flex-column gap-1">
                <small>Ámbito de la curva</small>
                <Dropdown
                  value={form.idPlanta}
                  onChange={(e) => set("idPlanta", e.value)}
                  options={[
                    { label: 'Global (todas las plantas)', value: null },
                    ...plantas.map(p => ({ label: `Planta: ${p.nombre}`, value: p.idPlanta })),
                  ]}
                  className="w-full"
                  disabled={readOnly}
                />
                <small className="text-color-secondary" style={{ fontSize: '0.7rem' }}>
                  {form.idPlanta == null
                    ? 'Curva disponible para todas las plantas (típicamente curvas del fabricante).'
                    : 'Curva exclusiva de esta planta (curva propia/experiencia local).'}
                </small>
              </div>

              {/* Fila 2: Cemento específico (8) / Familia (4) */}
              <div className="col-12 md:col-8 flex flex-column gap-1">
                <small>Cemento específico (opcional)</small>
                <Dropdown
                  value={form.cementoId}
                  onChange={(e) => setAndClearDraft("cementoId", e.value)}
                  options={[
                    { label: "— Sin cemento específico —", value: null },
                    ...cementos.map((c) => ({
                      label: `${c.nombreComercial} — ${c.fabricante}`,
                      value: c.idCemento,
                    })),
                  ]}
                  className="w-full"
                  filter
                  placeholder="Seleccionar cemento..."
                />
              </div>
              <div className="col-12 sm:col-6 lg:col-4 flex flex-column gap-1">
                <small>Familia (si no hay cemento)</small>
                <Dropdown
                  value={form.familiaCemento}
                  onChange={(e) => setAndClearDraft("familiaCemento", e.value)}
                  options={[{ label: "—", value: null }, ...FAMILIA_OPTIONS]}
                  className="w-full"
                  disabled={!!form.cementoId}
                  style={isDraft("familiaCemento") ? draftInputStyle : {}}
                />
                {isDraft("familiaCemento") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>

              {/* Fila 3: Fabricante (4) / Planta (4) / Año (4) */}
              <div className="col-12 sm:col-6 lg:col-4 flex flex-column gap-1">
                <small>Fabricante</small>
                <InputText
                  value={form.fabricante}
                  onChange={(e) => setAndClearDraft("fabricante", e.target.value)}
                  className="w-full"
                  style={isDraft("fabricante") ? draftInputStyle : {}}
                />
                {isDraft("fabricante") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>
              <div className="col-12 sm:col-6 lg:col-4 flex flex-column gap-1">
                <small>Planta / fábrica</small>
                <InputText
                  value={form.plantaFabrica}
                  onChange={(e) => setAndClearDraft("plantaFabrica", e.target.value)}
                  placeholder="Ej: Zapala"
                  className="w-full"
                  style={isDraft("plantaFabrica") ? draftInputStyle : {}}
                />
                {isDraft("plantaFabrica") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>
              <div className="col-12 sm:col-6 lg:col-4 flex flex-column gap-1">
                <small>Año vigencia</small>
                <InputNumber
                  value={form.anioVigencia}
                  onValueChange={(e) => setAndClearDraft("anioVigencia", e.value)}
                  useGrouping={false}
                  placeholder="2025"
                  className="w-full"
                  inputStyle={isDraft("anioVigencia") ? draftInputStyle : {}}
                />
                {isDraft("anioVigencia") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>

              {/* Fila 4: Documento fuente (8) / Versión (4) */}
              <div className="col-12 md:col-8 flex flex-column gap-1">
                <small>Documento fuente</small>
                <InputText
                  value={form.fuenteDocumento}
                  onChange={(e) => setAndClearDraft("fuenteDocumento", e.target.value)}
                  placeholder="Informe técnico / referencia"
                  className="w-full"
                  style={isDraft("fuenteDocumento") ? draftInputStyle : {}}
                />
                {isDraft("fuenteDocumento") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>
              <div className="col-12 sm:col-6 lg:col-4 flex flex-column gap-1">
                <small>Versión</small>
                <InputText
                  value={form.version}
                  onChange={(e) => set("version", e.target.value)}
                  className="w-full"
                />
              </div>

              {/* Fila 5: Observaciones (12) */}
              <div className="col-12 flex flex-column gap-1">
                <small>Observaciones</small>
                <InputTextarea
                  value={form.observaciones}
                  onChange={(e) => setAndClearDraft("observaciones", e.target.value)}
                  rows={2}
                  autoResize
                  className="w-full"
                  style={isDraft("observaciones") ? draftInputStyle : {}}
                />
                {isDraft("observaciones") && <small className="text-blue-400" style={{ fontSize: "0.7rem" }}>Autocompletado desde PDF</small>}
              </div>
            </div>

            {validationError && (
              <Message severity="error" text={validationError} className="w-full" />
            )}
          </div>
        </TabPanel>

        {/* ── Tab 2: Tabla a/c vs resistencia ── */}
        <TabPanel header="Tabla a/c vs resistencia">
          <div className="flex flex-column gap-3 pt-2">
            <div className="flex gap-2 flex-wrap align-items-center">
              <small className="text-color-secondary">Agregar edad:</small>
              {EDAD_OPCIONES.map((e) => (
                <Button
                  key={e}
                  label={`${e}d`}
                  size="small"
                  outlined
                  severity="secondary"
                  onClick={() => addEdadPunto(e)}
                />
              ))}
            </div>

            {puntos.length === 0 ? (
              <p className="text-color-secondary text-sm">
                Sin puntos cargados. Agregue una edad arriba para empezar, o analice un PDF.
              </p>
            ) : (
              [...new Set(puntos.map((p) => p.edadDias))]
                .sort((a, b) => a - b)
                .map((edad) => {
                  const ptosEdad = puntos
                    .filter((p) => p.edadDias === edad)
                    .sort((a, b) => (a.relacionAc ?? 0) - (b.relacionAc ?? 0));
                  const validCount = ptosEdad.filter((p) => p.relacionAc != null && p.resistenciaMpa != null).length;
                  return (
                    <div
                      key={edad}
                      className="flex flex-column gap-2 p-2 border-1 border-round surface-card"
                    >
                      <div className="flex justify-content-between align-items-center">
                        <div className="flex align-items-center gap-2">
                          <InputNumber
                            value={edad}
                            onValueChange={(e) => {
                              const newEdad = e.value;
                              if (!newEdad || newEdad === edad) return;
                              setPuntos((prev) =>
                                prev.map((p) => p.edadDias === edad ? { ...p, edadDias: newEdad } : p)
                              );
                            }}
                            useGrouping={false}
                            min={1}
                            max={3650}
                            inputStyle={{ width: "60px", fontWeight: "600", padding: "4px 6px" }}
                            tooltip="Editar edad"
                            tooltipOptions={{ position: "top" }}
                          />
                          <span className="font-semibold text-sm">días</span>
                          {validCount >= 2
                            ? <span className="text-green-500 text-xs">({validCount} puntos)</span>
                            : <span className="text-orange-400 text-xs">(mínimo 2)</span>
                          }
                        </div>
                        <div className="flex gap-2">
                          <Button
                            label="+ Punto"
                            size="small"
                            text
                            onClick={() =>
                              setPuntos((prev) => [
                                ...prev,
                                {
                                  edadDias: edad,
                                  relacionAc: null,
                                  resistenciaMpa: null,
                                  orden: prev.filter((p) => p.edadDias === edad).length,
                                },
                              ])
                            }
                          />
                          <Button
                            icon="fa-solid fa-trash"
                            size="small"
                            text
                            severity="danger"
                            onClick={() => removePuntoByEdad(edad)}
                          />
                        </div>
                      </div>
                      {ptosEdad.map((p, idx) => {
                        const globalIdx = puntos.findIndex(
                          (x) => x.edadDias === edad && x === p
                        );
                        return (
                          <div key={idx} className="flex gap-3 align-items-end">
                            <div className="flex flex-column gap-1" style={{ width: "120px" }}>
                              <small>a/c</small>
                              <InputNumber
                                value={p.relacionAc}
                                onValueChange={(e) => {
                                  setPuntos((prev) =>
                                    prev.map((x, i) =>
                                      i === globalIdx ? { ...x, relacionAc: e.value } : x
                                    )
                                  );
                                }}
                                minFractionDigits={2}
                                maxFractionDigits={3}
                                step={0.01}
                                inputStyle={{ width: "100%" }}
                                className="w-full"
                              />
                            </div>
                            <div className="flex flex-column gap-1" style={{ width: "150px" }}>
                              <small>Resistencia (MPa)</small>
                              <InputNumber
                                value={p.resistenciaMpa}
                                onValueChange={(e) => {
                                  setPuntos((prev) =>
                                    prev.map((x, i) =>
                                      i === globalIdx ? { ...x, resistenciaMpa: e.value } : x
                                    )
                                  );
                                }}
                                minFractionDigits={1}
                                maxFractionDigits={2}
                                inputStyle={{ width: "100%" }}
                                className="w-full"
                              />
                            </div>
                            <Button
                              icon="fa-solid fa-xmark"
                              text
                              severity="danger"
                              onClick={() =>
                                setPuntos((prev) => prev.filter((_, i) => i !== globalIdx))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })
            )}
          </div>
        </TabPanel>
      </TabView>
      </fieldset>
    </Dialog>
  );
}

/* ─── Página principal ─── */
export default function CurvaCementoPage() {
  const showToast = useToast();
  const showSuccess = (msg) => showToast("success", msg);
  const showError = (msg) => showToast("error", msg);
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cementos, setCementos] = useState([]);
  const [plantas, setPlantas] = useState([]);
  // Precargar filtros desde query string (entrada desde cementoForm)
  const initialIdPlantaQS = searchParams.get('idPlanta');
  const initialCementoIdQS = searchParams.get('cementoId');
  const initialOrigenQS = searchParams.get('origenCurva');
  const initialAmbitoQS = searchParams.get('ambito'); // 'GLOBAL' | null
  const [filtroIdPlanta, setFiltroIdPlanta] = useState(
    initialAmbitoQS === 'GLOBAL' ? 'GLOBAL' : (initialIdPlantaQS ? Number(initialIdPlantaQS) : null)
  );
  const [filtroCementoId, setFiltroCementoId] = useState(initialCementoIdQS ? Number(initialCementoIdQS) : null);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [viewMode, setViewMode] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  // Si vino con QS, abrir el dialog "Nueva curva" precargado al primer render
  const autoOpenedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 'GLOBAL' es filtro local (curvas con idPlanta=null); en ese caso no filtramos en backend
      const idPlantaParam = (filtroIdPlanta === 'GLOBAL' || filtroIdPlanta == null) ? null : filtroIdPlanta;
      let data = await getCurvasCemento({ includeArchived, idPlanta: idPlantaParam });
      if (filtroIdPlanta === 'GLOBAL') {
        data = (data || []).filter(c => c.idPlanta == null);
      }
      // Filtro local por cemento: incluye curvas con cementoId match + curvas globales sin cemento (compatibles)
      if (filtroCementoId != null) {
        data = (data || []).filter(c => Number(c.cementoId) === Number(filtroCementoId) || (!c.cementoId));
      }
      setRows(data);
    } catch {
      showError("Error al cargar curvas de cemento.");
    } finally {
      setLoading(false);
    }
  }, [includeArchived, filtroIdPlanta, filtroCementoId]); // eslint-disable-line

  const loadCementos = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/cementos`, {
        headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setCementos(data);
    } catch {
      /* non-blocking */
    }
  }, []);

  const loadPlantas = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/plantas`, {
        headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      setPlantas(data || []);
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => {
    load();
    loadCementos();
    loadPlantas();
  }, [load, loadCementos, loadPlantas]);

  // Auto-abrir dialog "Nueva curva" si venimos desde cementoForm con query strings
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!initialCementoIdQS && !initialIdPlantaQS) return;
    autoOpenedRef.current = true;
    setEditItem({
      cementoId: initialCementoIdQS ? Number(initialCementoIdQS) : null,
      idPlanta: initialAmbitoQS === 'GLOBAL' ? null : (initialIdPlantaQS ? Number(initialIdPlantaQS) : null),
      origenCurva: initialOrigenQS || 'PROPIA',
    });
    setViewMode(false);
    setDialogVisible(true);
    // Limpiar query strings sin recargar para que F5 no reabra el dialog
    setSearchParams({}, { replace: true });
  }, [initialCementoIdQS, initialIdPlantaQS, initialOrigenQS, initialAmbitoQS, setSearchParams]);

  const openNew = () => {
    setEditItem(null);
    setDialogVisible(true);
  };
  const openEdit = (row) => {
    setEditItem(row);
    setViewMode(false);
    setDialogVisible(true);
  };
  const openView = (row) => {
    setEditItem(row);
    setViewMode(true);
    setDialogVisible(true);
  };
  const closeDialog = () => { setDialogVisible(false); setViewMode(false); };

  const handleSave = async (payload) => {
    if (savingRef.current) return;
    try {
      savingRef.current = true;
      setSaving(true);
      if (editItem?.id) {
        await updateCurvaCemento(editItem.id, payload);
        showSuccess("Curva actualizada.");
      } else {
        await createCurvaCemento(payload);
        showSuccess("Curva creada.");
      }
      closeDialog();
      load();
    } catch {
      showError("Error al guardar la curva.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row) => {
    confirmDialog({
      message: `¿Archivar la curva "${row.nombre}"?`,
      header: "Confirmar",
      icon: "fa-solid fa-triangle-exclamation",
      accept: async () => {
        if (deletingRef.current) return;
        try {
          deletingRef.current = true;
          await deleteCurvaCemento(row.id);
          showSuccess("Curva archivada.");
          load();
        } catch {
          showError("Error al archivar la curva.");
        } finally {
          deletingRef.current = false;
        }
      },
    });
  };

  /* ── column templates ── */
  const cementoBody = (row) => {
    if (row.cemento)
      return (
        <span>
          {row.cemento.nombreComercial}{" "}
          <span className="text-color-secondary text-xs">({row.cemento.fabricante})</span>
        </span>
      );
    if (row.familiaCemento) return <Tag value={`Familia ${row.familiaCemento}`} severity="info" />;
    return <span className="text-color-secondary">—</span>;
  };

  const tipoBody = (row) => (
    <Tag
      value={row.tipoCurva === "ABRAMS" ? "Abrams" : "Tabla a/c"}
      severity={row.tipoCurva === "ABRAMS" ? "success" : "info"}
    />
  );

  const edadesBody = (row) => {
    let edades = row.edadesDisponiblesJson;
    if (typeof edades === 'string') try { edades = JSON.parse(edades); } catch { edades = null; }
    if (!Array.isArray(edades)) {
      edades = [
        ...new Set((row.puntos || []).map((p) => p.edadDias)),
      ].sort((a, b) => a - b);
    }
    return edades.length > 0 ? edades.join(", ") + " d" : "—";
  };

  const activoBody = (row) => (
    <Tag
      value={row.activo ? "Activa" : "Archivada"}
      severity={row.activo ? "success" : "secondary"}
    />
  );

  const accionesBody = (row) => (
    <div className="flex gap-1">
      <Button icon="fa-solid fa-pen" size="small" text onClick={() => openEdit(row)} />
      {row.activo && (
        <Button
          icon="fa-solid fa-trash"
          size="small"
          text
          severity="danger"
          onClick={() => handleDelete(row)}
        />
      )}
    </div>
  );

  return (
    <div className="p-3">
      <PageHeader
        icon="fa-solid fa-chart-line"
        title="Curvas de cemento"
        subtitle="Tablas a/c vs resistencia por cemento (referencia general, fabricante o propias)"
      />

      <div className="flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="flex gap-2 align-items-center">
          <Button
            label={includeArchived ? "Ocultar archivadas" : "Ver archivadas"}
            icon={includeArchived ? "fa-solid fa-eye-slash" : "fa-solid fa-eye"}
            size="small"
            outlined
            severity="secondary"
            onClick={() => setIncludeArchived((v) => !v)}
          />
          <Dropdown
            value={filtroIdPlanta}
            onChange={(e) => setFiltroIdPlanta(e.value)}
            options={[
              { label: 'Todas las plantas', value: null },
              { label: 'Solo globales (fabricante)', value: 'GLOBAL' },
              ...plantas.map(p => ({ label: `Planta: ${p.nombre}`, value: p.idPlanta })),
            ]}
            placeholder="Filtrar por planta"
            className="w-15rem"
            showClear
          />
          <Dropdown
            value={filtroCementoId}
            onChange={(e) => setFiltroCementoId(e.value)}
            options={[
              { label: 'Todos los cementos', value: null },
              ...cementos.map(c => ({
                label: `${c.nombreComercial} — ${c.fabricante}`,
                value: c.idCemento,
              })),
            ]}
            placeholder="Filtrar por cemento"
            className="w-18rem"
            filter
            showClear
          />
        </div>
        <Button label="Nueva curva" icon="fa-solid fa-plus" onClick={openNew} />
      </div>

      <DataTable responsiveLayout="scroll"
        value={rows}
        loading={loading}
        emptyMessage="Sin curvas de cemento cargadas."
        rowHover
        size="small"
        paginator
        rows={20}
      >
        <Column header="Nombre" sortable field="nombre" body={(row) => (
          <span className="cursor-pointer text-primary font-bold hover:underline" onClick={() => openView(row)}>{row.nombre}</span>
        )} />
        <Column header="Origen" body={(row) => {
          const origen = row.origenCurva || 'PROPIA';
          const cfg = origen === 'ICPA'
            ? { label: 'Referencia', severity: 'warning' }
            : origen === 'FABRICANTE'
              ? { label: 'Fabricante', severity: 'info' }
              : { label: 'Propia', severity: 'success' };
          return (
            <Tag
              value={cfg.label}
              severity={cfg.severity}
              style={{ fontSize: '0.75rem' }}
            />
          );
        }} style={{ width: "120px" }} />
        <Column header="Ámbito" body={(row) => (
          row.idPlanta == null
            ? <Tag value="Global" severity="info" icon="fa-solid fa-globe" style={{ fontSize: '0.75rem' }} />
            : <Tag value={row.planta?.nombre || `Planta ${row.idPlanta}`} severity="warning" icon="fa-solid fa-location-dot" style={{ fontSize: '0.75rem' }} />
        )} style={{ width: "150px" }} />
        <Column header="Cemento / Familia" body={cementoBody} />
        <Column header="Tipo" body={tipoBody} style={{ width: "140px" }} />
        <Column header="Fábrica" field="plantaFabrica" />
        <Column header="Año" field="anioVigencia" style={{ width: "80px" }} />
        <Column header="Edades (días)" body={edadesBody} />
        <Column header="Estado" body={activoBody} style={{ width: "110px" }} />
        <Column header="Acciones" body={accionesBody} style={{ width: "90px" }} />
      </DataTable>

      <CurvaCementoDialog
        visible={dialogVisible}
        onHide={closeDialog}
        onSave={handleSave}
        initial={editItem}
        readOnly={viewMode}
        cementos={cementos}
        plantas={plantas}
        saving={saving}
      />
    </div>
  );
}
