import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Divider } from "primereact/divider";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { Message } from "primereact/message";
import { Tooltip } from "primereact/tooltip";
import { SelectButton } from "primereact/selectbutton";
import {
  guardarReceta,
  listarRecetas,
  obtenerUltimasHumedadesEnsayo,
} from "../../../services/recetaObraService";
import { generarRecetaObraPdf } from "./recetaObraPdf";
import { MODO_DESCRIPTIVO, MODO_NORMATIVO } from "../../../lib/evaluacion";

/* ═══════════════════════════════════════
   Helpers
   ═══════════════════════════════════════ */

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const roundBachada = (val) =>
  Math.abs(val) > 100 ? Math.round(val) : Math.round(val * 10) / 10;

const fmtNum = (v, dec = 1) =>
  v != null ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";

const VOLUMEN_PRESETS = [6, 7, 8, 9, 10];

/**
 * Determina el estado de humedad de un agregado.
 */
function estadoHumedad(humedadPct, absorcionPct) {
  if (humedadPct == null || absorcionPct == null) return null;
  const diff = humedadPct - absorcionPct;
  if (Math.abs(diff) <= 0.1) return { label: "SSS", severity: "info", icon: "pi-equals" };
  if (diff > 0) return { label: "Húmedo", severity: "success", icon: "pi-arrow-up" };
  return { label: "Seco", severity: "warning", icon: "pi-arrow-down" };
}

/**
 * Calcula corrección por humedad (client-side, igual que el useMemo existente).
 */
function calcCorreccion(resultado, humedades) {
  if (!resultado?.agregados?.length || !humedades?.length) return null;
  const filled = humedades.filter((h) => h.humedadPct != null && h.humedadPct !== "");
  if (filled.length === 0) return null;

  const humedadMap = new Map(filled.map((h) => [Number(h.idAgregado), Number(h.humedadPct)]));
  let totalDeltaAgua = 0;
  const items = resultado.agregados.map((ag) => {
    const idAg = ag.idAgregado || ag.id;
    const hPct = humedadMap.get(Number(idAg));
    const absPct = ag.absorcionPct != null ? Number(ag.absorcionPct) : null;
    const kgSSS = ag.kgM3 != null ? Number(ag.kgM3) : null;
    if (hPct == null || absPct == null || kgSSS == null || kgSSS === 0) {
      return { nombre: ag.nombre, idAgregado: idAg, kgSSS, absorcionPct: absPct, humedadPct: hPct ?? null, deltaAgua: null, kgNatural: null };
    }
    const deltaAgua = round1(kgSSS * (hPct - absPct) / 100);
    totalDeltaAgua += deltaAgua;
    const kgNatural = round1(kgSSS * (100 + hPct) / (100 + absPct));
    return { nombre: ag.nombre, idAgregado: idAg, kgSSS, absorcionPct: absPct, humedadPct: hPct, deltaAgua, kgNatural };
  });
  totalDeltaAgua = round1(totalDeltaAgua);
  const aguaObra = round1(Number(resultado.aguaLtsM3) - totalDeltaAgua);
  return { aguaObra, deltaAguaTotal: totalDeltaAgua, items, aguaDiseno: Number(resultado.aguaLtsM3) };
}

/* ═══════════════════════════════════════
   Component
   ═══════════════════════════════════════ */

export default function RecetaObraSection({
  resultado,
  loadedDosif,
  showToast,
  user,
  nombreDosif,
  plantaLabel,
  logoUrl,
  empresa,
  onHumedadesChange,
}) {
  // ── State ──
  const [collapsed, setCollapsed] = useState(true);
  const [volumenBachada, setVolumenBachada] = useState(8);
  const [humedades, setHumedades] = useState([]); // [{idAgregado, nombre, absorcionPct, humedadPct, fuente}]
  const [fechaMedicion, setFechaMedicion] = useState(new Date());
  const [medidoPor, setMedidoPor] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [historial, setHistorial] = useState([]);
  const [historialVisible, setHistorialVisible] = useState(false);
  const [loadingEnsayo, setLoadingEnsayo] = useState(false);
  // Decisión 2026-05-28: modo del documento. Default DESCRIPTIVO.
  const [modoEvaluacion, setModoEvaluacion] = useState(MODO_DESCRIPTIVO);

  const estado = loadedDosif?.estado || "BORRADOR";
  const canCreate = ["BORRADOR", "A_PRUEBA", "APROBADO", "EN_PRODUCCION"].includes(estado);
  const expandByDefault = ["APROBADO", "EN_PRODUCCION"].includes(estado);

  // Auto-expand for production states
  useEffect(() => {
    if (expandByDefault && resultado?.agregados?.length) setCollapsed(false);
  }, [expandByDefault, resultado]);

  // Initialize humedades from resultado agregados
  useEffect(() => {
    if (!resultado?.agregados?.length) return;
    setHumedades((prev) => {
      // Preserve existing values if matching
      const prevMap = new Map(prev.map((h) => [h.idAgregado, h]));
      return resultado.agregados.map((ag) => {
        const idAg = ag.idAgregado || ag.id;
        const existing = prevMap.get(idAg);
        return {
          idAgregado: idAg,
          nombre: ag.nombre,
          absorcionPct: ag.absorcionPct != null ? Number(ag.absorcionPct) : null,
          humedadPct: existing?.humedadPct ?? null,
          fuente: existing?.fuente || "manual",
          ensayoId: existing?.ensayoId || null,
        };
      });
    });
  }, [resultado]);

  // Load historial when dosif loaded
  useEffect(() => {
    if (!loadedDosif?.id) { setHistorial([]); return; }
    listarRecetas(loadedDosif.id)
      .then(setHistorial)
      .catch((err) => { console.warn('[listarRecetas]', err?.message || err); });
  }, [loadedDosif?.id]);

  // ── Humidity updater ──
  const setHumedad = useCallback((idAgregado, value) => {
    setHumedades((prev) =>
      prev.map((h) => h.idAgregado === idAgregado ? { ...h, humedadPct: value, fuente: "manual" } : h)
    );
  }, []);

  // ── Sync humedad changes back to parent (for PDF snapshot) ──
  useEffect(() => {
    if (onHumedadesChange) {
      const map = {};
      for (const h of humedades) {
        if (h.humedadPct != null) map[h.idAgregado] = h.humedadPct;
      }
      onHumedadesChange(map);
    }
  }, [humedades, onHumedadesChange]);

  // ── Corrección calc ──
  const correccion = useMemo(() => calcCorreccion(resultado, humedades), [resultado, humedades]);

  // ── Stale humidity alert ──
  const staleAlert = useMemo(() => {
    if (!["APROBADO", "EN_PRODUCCION"].includes(estado) || historial.length === 0) return null;
    const latest = historial[0]; // sorted by fecha DESC
    if (!latest?.fechaMedicion) return null;
    const lastDate = new Date(latest.fechaMedicion + "T12:00:00");
    const diffDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 2) {
      return `Humedades registradas hace ${diffDays} días (última: ${lastDate.toLocaleDateString("es-AR")}). Se recomienda medir antes de cada jornada.`;
    }
    return null;
  }, [estado, historial]);

  // ── Warnings ──
  const warnings = useMemo(() => {
    const w = [];
    if (staleAlert) w.push({ severity: "warn", text: staleAlert });
    if (!correccion) return w;
    if (correccion.aguaObra < 0) w.push({ severity: "error", text: "Los agregados aportan más agua que la necesaria. Verificar humedades." });
    else if (correccion.aguaObra < 50) w.push({ severity: "warn", text: `Agua corregida (${correccion.aguaObra} L/m³) inusualmente baja.` });
    if (Math.abs(correccion.deltaAguaTotal) < 1) w.push({ severity: "info", text: "Agregados prácticamente en condición SSS." });
    for (const h of humedades) {
      if (h.humedadPct == null) continue;
      if (h.absorcionPct == null) w.push({ severity: "error", text: `Falta absorción para ${h.nombre}. Cargar en catálogo.` });
      const isGrueso = (h.nombre || "").toLowerCase().includes("ripio") || (h.nombre || "").toLowerCase().includes("grava");
      const umbral = isGrueso ? 8 : 15;
      if (h.humedadPct > umbral) w.push({ severity: "warn", text: `${h.nombre}: humedad ${h.humedadPct}% inusualmente alta (umbral ${umbral}%).` });
    }
    return w;
  }, [correccion, humedades, staleAlert]);

  const hasBlockingError = warnings.some((w) => w.severity === "error");

  // ── Batch quantities ──
  const cantidadesBachada = useMemo(() => {
    if (!correccion || !volumenBachada) return null;
    const vol = Number(volumenBachada);
    const rows = [];
    // Agua
    rows.push({ componente: "Agua", porM3Teorico: `${resultado.aguaLtsM3} L`, porM3Corregido: `${fmtNum(correccion.aguaObra)} L`, porBachada: `${fmtNum(roundBachada(correccion.aguaObra * vol))} L`, tipo: "agua" });
    // Cemento
    const cem = resultado.cementoTotalKgM3 ?? resultado.cementoKgM3;
    rows.push({ componente: "Cemento", porM3Teorico: `${fmtNum(cem)} kg`, porM3Corregido: `${fmtNum(cem)} kg`, porBachada: `${fmtNum(roundBachada(cem * vol))} kg`, tipo: "cemento" });
    // Adiciones
    if (resultado.adicion1KgM3) rows.push({ componente: "Adición 1", porM3Teorico: `${fmtNum(resultado.adicion1KgM3)} kg`, porM3Corregido: `${fmtNum(resultado.adicion1KgM3)} kg`, porBachada: `${fmtNum(roundBachada(resultado.adicion1KgM3 * vol))} kg`, tipo: "cemento" });
    if (resultado.adicion2KgM3) rows.push({ componente: "Adición 2", porM3Teorico: `${fmtNum(resultado.adicion2KgM3)} kg`, porM3Corregido: `${fmtNum(resultado.adicion2KgM3)} kg`, porBachada: `${fmtNum(roundBachada(resultado.adicion2KgM3 * vol))} kg`, tipo: "cemento" });
    // Aditivos
    (resultado.aditivos || []).forEach((a) => {
      const kg = a.kgM3 != null ? Number(a.kgM3) : null;
      if (kg != null) {
        rows.push({ componente: `Aditivo (${a.label})`, porM3Teorico: `${fmtNum(kg, 2)} kg`, porM3Corregido: `${fmtNum(kg, 2)} kg`, porBachada: `${fmtNum(roundBachada(kg * vol), 1)} kg`, tipo: "aditivo" });
      }
    });
    // Agregados
    correccion.items.filter((it) => it.kgNatural != null).forEach((it) => {
      rows.push({
        componente: it.nombre,
        porM3Teorico: `${fmtNum(it.kgSSS)} kg SSS`,
        porM3Corregido: `${fmtNum(it.kgNatural)} kg`,
        porBachada: `${fmtNum(roundBachada(it.kgNatural * vol))} kg`,
        tipo: it.nombre.toLowerCase().includes("arena") ? "arena" : "ripio",
      });
    });
    return rows;
  }, [correccion, volumenBachada, resultado]);

  // ── Quick recipe card data ──
  const recetaRapida = useMemo(() => {
    if (!cantidadesBachada) return null;
    return cantidadesBachada.map((r) => ({ componente: r.componente, cantidad: r.porBachada, tipo: r.tipo }));
  }, [cantidadesBachada]);

  // ── Load from ensayo ──
  const handleCargarEnsayo = useCallback(async () => {
    if (!loadedDosif?.id) return;
    setLoadingEnsayo(true);
    try {
      const rows = await obtenerUltimasHumedadesEnsayo(loadedDosif.id);
      setHumedades((prev) =>
        prev.map((h) => {
          const match = rows.find((r) => Number(r.idAgregado) === Number(h.idAgregado));
          if (match?.humedadPct != null) {
            return { ...h, humedadPct: match.humedadPct, fuente: "ensayo", ensayoId: match.ensayoId };
          }
          return h;
        })
      );
      showToast("success", "Humedades cargadas desde ensayos");
    } catch (err) {
      showToast("warn", "No se encontraron ensayos de humedad recientes");
    } finally {
      setLoadingEnsayo(false);
    }
  }, [loadedDosif?.id, showToast]);

  // ── Save ──
  const handleGuardar = useCallback(async () => {
    if (savingRef.current) return;
    if (!loadedDosif?.id || hasBlockingError) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const userName = user ? `${user.name || ""} ${user.lastname || ""}`.trim() : "sistema";
      await guardarReceta({
        dosificacionDisenadaId: loadedDosif.id,
        volumenBachada,
        humedades,
        resultado,
        fechaMedicion: fechaMedicion ? fechaMedicion.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        medidoPor,
        creadoPor: userName,
      });
      showToast("success", "Receta guardada");
      // Refresh historial
      const rows = await listarRecetas(loadedDosif.id);
      setHistorial(rows);
    } catch (err) {
      showToast("error", err?.response?.data?.error || "Error al guardar receta");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [loadedDosif?.id, volumenBachada, humedades, resultado, fechaMedicion, medidoPor, user, showToast, hasBlockingError]);

  // ── Reload from historial ──
  const handleRecargar = useCallback((receta) => {
    const hums = typeof receta.humedadesJson === "string" ? JSON.parse(receta.humedadesJson) : receta.humedadesJson;
    setHumedades((prev) =>
      prev.map((h) => {
        const match = hums.find((r) => Number(r.idAgregado) === Number(h.idAgregado));
        return match ? { ...h, humedadPct: match.humedadPct, fuente: match.fuente || "historial" } : h;
      })
    );
    setVolumenBachada(Number(receta.volumenBachada));
    if (receta.medidoPor) setMedidoPor(receta.medidoPor);
    if (receta.fechaMedicion) setFechaMedicion(new Date(receta.fechaMedicion + "T12:00:00"));
    showToast("info", `Humedades recargadas del ${new Date(receta.fechaMedicion).toLocaleDateString("es-AR")}`);
  }, [showToast]);

  // ── Export PDF ──
  const handleExportPdf = useCallback(async () => {
    if (!correccion) return;
    try {
      await generarRecetaObraPdf({
        nombreDosif,
        codigoDosif: loadedDosif?.codigo || null,
        planta: plantaLabel,
        empresa,
        volumenBachada,
        fechaMedicion: fechaMedicion ? fechaMedicion.toLocaleDateString("es-AR") : null,
        medidoPor,
        resultado,
        correccion,
        humedades,
        estado,
        logoUrl,
        // R12 — adiciones con nombre comercial para evitar "ADICIÓN 1/2"
        adiciones: loadedDosif?.snapshot?.adiciones
          || loadedDosif?.mezclaSnapshotJson?.adiciones
          || loadedDosif?.adiciones
          || resultado?.adiciones
          || null,
        modoEvaluacion,
      });
    } catch (err) {
      console.error("Error generating recipe PDF:", err);
      showToast("error", "Error al generar PDF de receta");
    }
  }, [correccion, nombreDosif, loadedDosif?.codigo, plantaLabel, empresa, volumenBachada, fechaMedicion, medidoPor, resultado, humedades, estado, logoUrl, showToast, modoEvaluacion]);

  // ── Abort if no resultado ──
  if (!resultado?.agregados?.length) return null;

  // Color classes by component type
  const tipoColor = (tipo) => {
    switch (tipo) {
      case "agua": return "border-left-3 border-blue-500";
      case "cemento": return "border-left-3 border-500";
      case "arena": return "border-left-3 border-yellow-500";
      case "ripio": return "border-left-3 border-orange-500";
      case "aditivo": return "border-left-3 border-green-500";
      default: return "";
    }
  };

  return (
    <div className="card mt-3">
      {/* Header */}
      <div
        className="flex align-items-center justify-content-between cursor-pointer"
        onClick={() => setCollapsed((c) => !c)}
      >
        <h5 className="mb-0 flex align-items-center gap-2">
          <i className="fa-solid fa-scale-balanced text-primary" />
          Receta de obra — Corrección por humedad
        </h5>
        <Button
          icon={`pi pi-chevron-${collapsed ? "down" : "up"}`}
          className="p-button-text p-button-sm"
          onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
        />
      </div>

      {!collapsed && (
        <div className="mt-3">
          <p className="text-sm text-color-secondary mb-3">
            Corrija las cantidades de la dosificación según la humedad natural de los agregados en planta.
            El diseño base asume condición SSS (Saturado Superficie Seca).
          </p>

          {/* ═══ Volumen de bachada ═══ */}
          <div className="surface-ground border-round p-3 mb-3">
            <div className="text-sm font-bold mb-2">Volumen de bachada</div>
            <div className="flex align-items-center gap-2 flex-wrap">
              <InputNumber
                value={volumenBachada}
                onValueChange={(e) => setVolumenBachada(e.value)}
                suffix=" m³"
                min={0.5}
                max={20}
                minFractionDigits={1}
                maxFractionDigits={2}
                className="w-8rem"
                size="small"
              />
              <div className="flex gap-1">
                {VOLUMEN_PRESETS.map((v) => (
                  <Button
                    key={v}
                    label={`${v} m³`}
                    className={`p-button-sm ${volumenBachada === v ? "p-button-primary" : "p-button-outlined"}`}
                    onClick={() => setVolumenBachada(v)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ═══ Humedades ═══ */}
          <div className="surface-ground border-round p-3 mb-3">
            <div className="text-sm font-bold mb-2">Humedades naturales de los agregados</div>
            <DataTable responsiveLayout="scroll" value={humedades} size="small" stripedRows className="text-sm">
              <Column field="nombre" header="Agregado" />
              <Column
                header="Absorción"
                body={(row) => row.absorcionPct != null ? `${fmtNum(row.absorcionPct, 2)}%` : <Tag severity="danger" value="N/D" />}
                style={{ width: "100px" }}
              />
              <Column
                header="Humedad %"
                body={(row) => (
                  <InputNumber
                    value={row.humedadPct}
                    onValueChange={(e) => setHumedad(row.idAgregado, e.value)}
                    suffix=" %"
                    min={0}
                    max={30}
                    minFractionDigits={1}
                    maxFractionDigits={2}
                    className="w-7rem"
                    inputClassName="text-sm"
                    size="small"
                  />
                )}
                style={{ width: "130px" }}
              />
              <Column
                header="Estado"
                body={(row) => {
                  const est = estadoHumedad(row.humedadPct, row.absorcionPct);
                  if (!est) return "—";
                  return <Tag severity={est.severity} value={est.label} icon={`pi ${est.icon}`} />;
                }}
                style={{ width: "100px" }}
              />
              <Column
                header="Fuente"
                body={(row) => (
                  <span className="text-xs text-color-secondary">
                    {row.fuente === "ensayo" ? `Ensayo` : "Manual"}
                  </span>
                )}
                style={{ width: "80px" }}
              />
            </DataTable>

            <div className="flex align-items-center gap-3 mt-3 flex-wrap">
              <div className="flex align-items-center gap-2">
                <label className="text-xs text-color-secondary">Fecha:</label>
                <Calendar
                  value={fechaMedicion}
                  onChange={(e) => setFechaMedicion(e.value)}
                  dateFormat="dd/mm/yy"
                  className="w-9rem"
                  inputClassName="text-sm"
                />
              </div>
              <div className="flex align-items-center gap-2">
                <label className="text-xs text-color-secondary">Medido por:</label>
                <InputText
                  value={medidoPor}
                  onChange={(e) => setMedidoPor(e.target.value)}
                  placeholder="Nombre del operador"
                  className="w-12rem text-sm"
                />
              </div>
              <div className="flex gap-2 ml-auto">
                <Tooltip target=".btn-cargar-ensayo" />
                <Button
                  label="Cargar desde ensayo"
                  icon="pi pi-download"
                  className="p-button-outlined p-button-sm btn-cargar-ensayo"
                  onClick={handleCargarEnsayo}
                  loading={loadingEnsayo}
                  disabled={!loadedDosif?.id}
                  data-pr-tooltip={!loadedDosif?.id ? "Guarde la dosificación primero" : "Completa con último ensayo de humedad"}
                />
                {correccion && !hasBlockingError && (
                  <div className="flex align-items-center gap-2 pl-3 ml-2"
                       style={{ borderLeft: '1px solid var(--surface-border)' }}>
                    <span className="text-xs text-color-secondary">Modo:</span>
                    <SelectButton
                      value={modoEvaluacion}
                      onChange={(e) => e.value && setModoEvaluacion(e.value)}
                      options={[
                        { label: "Descriptivo", value: MODO_DESCRIPTIVO },
                        { label: "Normativo",   value: MODO_NORMATIVO },
                      ]}
                      pt={{ button: { className: 'text-xs py-1 px-2' } }}
                    />
                    <Button
                      label="PDF Receta"
                      icon="pi pi-file-pdf"
                      className="p-button-outlined p-button-sm p-button-danger"
                      onClick={handleExportPdf}
                    />
                  </div>
                )}
                {canCreate && loadedDosif?.id && (
                  <Button
                    label="Guardar receta"
                    icon="pi pi-save"
                    className="p-button-sm"
                    onClick={handleGuardar}
                    loading={saving}
                    disabled={!correccion || hasBlockingError || saving}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ═══ Warnings ═══ */}
          {warnings.length > 0 && (
            <div className="flex flex-column gap-2 mb-3">
              {warnings.map((w, i) => (
                <Message key={i} severity={w.severity} text={w.text} className="text-sm w-full" />
              ))}
            </div>
          )}

          {/* ═══ Resumen de corrección ═══ */}
          {correccion && (
            <>
              <div className="grid mb-3">
                <div className="col-12 sm:col-6 lg:col-4">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-sm text-color-secondary">Agua de diseño (SSS)</div>
                    <div className="text-xl font-bold">{fmtNum(correccion.aguaDiseno)} L/m³</div>
                  </div>
                </div>
                <div className="col-12 sm:col-6 lg:col-4">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-sm text-color-secondary">Agua a agregar en obra</div>
                    <div className={`text-2xl font-bold ${correccion.aguaObra < 0 ? "text-red-500" : "text-primary"}`}>
                      {fmtNum(correccion.aguaObra)} L/m³
                    </div>
                  </div>
                </div>
                <div className="col-12 sm:col-6 lg:col-4">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-sm text-color-secondary">Corrección</div>
                    <div className={`text-xl font-bold ${correccion.deltaAguaTotal > 0 ? "text-green-500" : correccion.deltaAguaTotal < 0 ? "text-red-500" : ""}`}>
                      {correccion.deltaAguaTotal > 0 ? "−" : "+"}{fmtNum(Math.abs(correccion.deltaAguaTotal))} L/m³
                    </div>
                    <div className="text-xs text-color-secondary">
                      ({fmtNum(Math.abs(correccion.deltaAguaTotal / correccion.aguaDiseno * 100))}%)
                      {" "}{correccion.deltaAguaTotal > 0 ? "Húmedo neto" : correccion.deltaAguaTotal < 0 ? "Seco neto" : ""}
                    </div>
                  </div>
                </div>
              </div>

              {/* ═══ Tabla corrección detallada ═══ */}
              <DataTable responsiveLayout="scroll"
                value={correccion.items.filter((it) => it.kgNatural != null)}
                size="small"
                stripedRows
                className="text-sm mb-3"
                footer={
                  <div className="flex justify-content-between font-bold text-sm">
                    <span>TOTAL corrección</span>
                    <span className={correccion.deltaAguaTotal > 0 ? "text-green-500" : correccion.deltaAguaTotal < 0 ? "text-red-500" : ""}>
                      {correccion.deltaAguaTotal > 0 ? "−" : "+"}{fmtNum(Math.abs(correccion.deltaAguaTotal))} L/m³
                      {" — Neto: "}{correccion.deltaAguaTotal > 0 ? "húmedo" : correccion.deltaAguaTotal < 0 ? "seco" : "SSS"}
                    </span>
                  </div>
                }
              >
                <Column field="nombre" header="Agregado" />
                <Column header="Absorción" body={(row) => `${fmtNum(row.absorcionPct, 2)}%`} style={{ width: "90px" }} />
                <Column header="Humedad" body={(row) => `${fmtNum(row.humedadPct, 2)}%`} style={{ width: "90px" }} />
                <Column
                  header="Agua efectiva"
                  body={(row) => (
                    <span className={row.deltaAgua > 0 ? "text-green-500" : row.deltaAgua < 0 ? "text-red-500" : ""}>
                      {row.deltaAgua > 0 ? "+" : ""}{fmtNum(row.deltaAgua)} L/m³
                    </span>
                  )}
                  style={{ width: "110px" }}
                />
                <Column
                  header="Condición"
                  body={(row) => {
                    const diff = row.humedadPct - row.absorcionPct;
                    return `${diff > 0.1 ? "Húmedo" : diff < -0.1 ? "Seco" : "SSS"} (${diff >= 0 ? "+" : ""}${fmtNum(diff, 2)}%)`;
                  }}
                  style={{ width: "140px" }}
                />
              </DataTable>

              {/* ═══ Tabla dosificación corregida ═══ */}
              {cantidadesBachada && (
                <>
                  <Divider />
                  <h6 className="mb-2">Dosificación corregida</h6>
                  <DataTable responsiveLayout="scroll" value={cantidadesBachada} size="small" stripedRows className="text-sm mb-3">
                    <Column
                      field="componente"
                      header="Componente"
                      body={(row) => <div className={`pl-2 ${tipoColor(row.tipo)}`}>{row.componente}</div>}
                    />
                    <Column field="porM3Teorico" header="Por m³ (teórico)" style={{ width: "130px" }} />
                    <Column field="porM3Corregido" header="Por m³ (corregido)" style={{ width: "140px" }} />
                    <Column
                      field="porBachada"
                      header={`Por bachada (${volumenBachada} m³)`}
                      style={{ width: "150px" }}
                      bodyClassName="font-bold"
                    />
                  </DataTable>
                </>
              )}

              {/* ═══ Tarjeta de receta rápida ═══ */}
              {recetaRapida && (
                <>
                  <Divider />
                  <div className="surface-card border-1 surface-border border-round p-3">
                    <div className="flex justify-content-between align-items-center mb-2 text-sm font-bold">
                      <span>{nombreDosif || "Dosificación"}</span>
                      <span>Bachada: {volumenBachada} m³</span>
                      <span>{fechaMedicion ? fechaMedicion.toLocaleDateString("es-AR") : ""}</span>
                    </div>
                    <Divider className="my-2" />
                    {recetaRapida.map((r, i) => (
                      <div key={i} className={`flex justify-content-between py-1 ${tipoColor(r.tipo)} pl-2`}>
                        <span className="font-bold text-sm uppercase">{r.componente}</span>
                        <span className="font-bold text-lg">{r.cantidad}</span>
                      </div>
                    ))}
                    <Divider className="my-2" />
                    <div className="text-xs text-color-secondary">
                      Humedades: {humedades.filter((h) => h.humedadPct != null).map((h) => `${h.nombre.split(" ")[0]} ${h.humedadPct}%`).join(" | ")}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ═══ Historial ═══ */}
          {historial.length > 0 && (
            <div className="mt-3">
              <div
                className="flex align-items-center gap-2 cursor-pointer text-sm font-bold mb-2"
                onClick={() => setHistorialVisible((v) => !v)}
              >
                <i className={`pi ${historialVisible ? "pi-chevron-down" : "pi-chevron-right"}`} />
                Historial de recetas ({historial.length})
              </div>
              {historialVisible && (
                <DataTable responsiveLayout="scroll"
                  value={historial}
                  size="small"
                  stripedRows
                  className="text-sm"
                  selectionMode="single"
                  onRowSelect={(e) => handleRecargar(e.data)}
                  emptyMessage="Sin recetas guardadas"
                >
                  <Column
                    header="Fecha"
                    body={(row) => new Date(row.fechaMedicion).toLocaleDateString("es-AR")}
                    style={{ width: "100px" }}
                  />
                  <Column
                    header="Agua corr."
                    body={(row) => `${fmtNum(Number(row.aguaCorregida))} L`}
                    style={{ width: "100px" }}
                  />
                  <Column
                    header="Corrección"
                    body={(row) => {
                      const delta = Number(row.correccionTotal);
                      return <span className={delta > 0 ? "text-green-500" : delta < 0 ? "text-red-500" : ""}>{delta > 0 ? "−" : "+"}{fmtNum(Math.abs(delta))} L</span>;
                    }}
                    style={{ width: "100px" }}
                  />
                  <Column
                    header="Volumen"
                    body={(row) => `${row.volumenBachada} m³`}
                    style={{ width: "80px" }}
                  />
                  <Column field="medidoPor" header="Medido por" style={{ width: "120px" }} />
                </DataTable>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
