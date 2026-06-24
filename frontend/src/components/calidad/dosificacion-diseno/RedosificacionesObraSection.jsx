import React, { useEffect, useMemo, useState, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Tag } from "primereact/tag";
import { InputTextarea } from "primereact/inputtextarea";
import { Message } from "primereact/message";
import {
  listarRedosificaciones,
  crearRedosificacion,
  actualizarRedosificacion,
  eliminarRedosificacion,
} from "../../../services/dosificacionDisenoService";

/**
 * Panel unificado de acciones de agregado de materiales.
 *
 * Registra acciones trazables durante la vida del pastón: agua, aditivos,
 * fibras, ajustes de aire, u otros materiales. Cada acción se vincula
 * opcionalmente a mediciones antes/después para registrar el efecto.
 */

const TIPO_ACCION_OPTS = [
  { label: "Aditivo", value: "ADITIVO", icon: "fa-solid fa-flask", color: "#8b5cf6" },
  { label: "Agua", value: "AGUA", icon: "fa-solid fa-droplet", color: "#3b82f6" },
  { label: "Fibra", value: "FIBRA", icon: "fa-solid fa-grip-lines", color: "#f59e0b" },
  { label: "Aire", value: "AIRE", icon: "fa-solid fa-wind", color: "#06b6d4" },
  { label: "Otro", value: "OTRO", icon: "fa-solid fa-ellipsis", color: "#6b7280" },
];

const ETAPA_OPTS = [
  { label: "Planta (pre-salida)", value: "PLANTA" },
  { label: "Transporte", value: "TRANSPORTE" },
  { label: "Obra", value: "OBRA" },
];

const MODO_EFECTO_OPTS = [
  { label: "Aumento de asentamiento", value: "AUMENTO_ASENTAMIENTO" },
  { label: "Ahorro de agua", value: "AHORRO_AGUA" },
  { label: "Retardante", value: "RETARDANTE" },
  { label: "Acelerante de fragüe", value: "ACELERANTE_FRAGUE" },
  { label: "Incorporador de aire", value: "INCORPORADOR_AIRE" },
  { label: "Fibras", value: "FIBRAS" },
  { label: "Otro", value: "OTRO" },
];

const UNIDAD_DEFAULTS = {
  ADITIVO: "cc", AGUA: "L", FIBRA: "kg", AIRE: "%", OTRO: "kg",
};

/**
 * Mapeo del ENUM `Aditivo.unidadDosificacion` a string visible para el
 * usuario. La unidad oficial del aditivo está en su ficha; este diálogo la
 * autocompleta cuando el usuario lo selecciona.
 */
const UNIDAD_ADITIVO_LABEL = {
  PORC_SOBRE_CEMENTO: '%',
  ML_POR_100KG_CEMENTO: 'mL/100kg cem',
  KG_M3: 'kg/m³',
};

const emptyForm = {
  tipoAccion: "ADITIVO",
  idAditivo: null,
  idFibra: null,
  nombreMaterial: "",
  cantidad: null,
  unidad: "cc",
  modoEfecto: "AUMENTO_ASENTAMIENTO",
  etapa: "OBRA",
  motivo: "",
  observaciones: "",
  fecha: new Date(),
  medicionAntesId: null,
  medicionDespuesId: null,
  asentamientoAntes: null,
  asentamientoDespues: null,
  aireMedidoAntes: null,
  aireMedidoDespues: null,
  volumenHormigonM3: null,
  pastonRefId: null,
};

function fmtNum(v, d = 2) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(d).replace(".", ",");
}
function fmtFecha(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function RedosificacionesObraSection({ dosificacionId, aditivosOptions = [], fibrasOptions = [], medicionesDisponibles = [], pastones = [], showToast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const [saveError, setSaveError] = useState(null);

  const refresh = async () => {
    if (!dosificacionId) { setRows([]); return; }
    try {
      setLoading(true);
      const list = await listarRedosificaciones(dosificacionId);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      showToast?.("error", err?.response?.data?.error || "No se pudo cargar las acciones");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [dosificacionId]);

  // Listen for "Ajuste" button from pastón
  useEffect(() => {
    const handler = (ev) => {
      const { pastonRefId, etapa } = ev.detail || {};
      setEditing(null);
      setForm({ ...emptyForm, pastonRefId: pastonRefId || null, etapa: etapa || 'PLANTA' });
      setDialogVisible(true);
      setTimeout(() => {
        document.getElementById('redosificaciones-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    };
    window.addEventListener('redosif:nuevo-ajuste', handler);
    return () => window.removeEventListener('redosif:nuevo-ajuste', handler);
  }, []);

  const aditivoById = useMemo(() => {
    const m = {};
    for (const a of aditivosOptions) m[a.value] = a.label;
    return m;
  }, [aditivosOptions]);

  // Mediciones dropdown options
  const medicionOpts = useMemo(() => {
    return (medicionesDisponibles || []).map(m => ({
      label: `#${m.ordenSecuencia || m.id} — ${m.etapa || ''} ${m.fechaHora ? new Date(m.fechaHora).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : ''}${m.asentamientoMm != null ? ` — ${(Number(m.asentamientoMm) / 10).toFixed(1)} cm` : ''}`,
      value: m.id,
      slump: m.asentamientoMm,
      aire: m.aireMedidoPct,
    }));
  }, [medicionesDisponibles]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogVisible(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      tipoAccion: row.tipoAccion || "ADITIVO",
      idAditivo: row.idAditivo,
      idFibra: row.idFibra || null,
      nombreMaterial: row.nombreMaterial || "",
      cantidad: row.cantidad != null ? Number(row.cantidad) : (row.dosis != null ? Number(row.dosis) : null),
      unidad: row.unidad || UNIDAD_DEFAULTS[row.tipoAccion || "ADITIVO"],
      modoEfecto: row.modoEfecto || "AUMENTO_ASENTAMIENTO",
      etapa: row.etapa || "OBRA",
      motivo: row.motivo || "",
      observaciones: row.observaciones || "",
      fecha: row.fecha ? new Date(row.fecha) : new Date(),
      medicionAntesId: row.medicionAntesId || null,
      medicionDespuesId: row.medicionDespuesId || null,
      asentamientoAntes: row.asentamientoAntes != null ? Number(row.asentamientoAntes) : null,
      asentamientoDespues: row.asentamientoDespues != null ? Number(row.asentamientoDespues) : null,
      aireMedidoAntes: row.aireMedidoAntes != null ? Number(row.aireMedidoAntes) : null,
      aireMedidoDespues: row.aireMedidoDespues != null ? Number(row.aireMedidoDespues) : null,
      volumenHormigonM3: row.volumenHormigonM3 != null ? Number(row.volumenHormigonM3) : null,
      pastonRefId: row.pastonRefId || null,
    });
    setDialogVisible(true);
  };

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // When changing tipo, update defaults
  const handleTipoChange = (tipo) => {
    setField("tipoAccion", tipo);
    setField("unidad", UNIDAD_DEFAULTS[tipo] || "kg");
    if (tipo === "AGUA") setField("modoEfecto", "AUMENTO_ASENTAMIENTO");
    else if (tipo === "FIBRA") setField("modoEfecto", "FIBRAS");
    else if (tipo === "AIRE") setField("modoEfecto", "INCORPORADOR_AIRE");
    // Clear material references
    if (tipo !== "ADITIVO") setField("idAditivo", null);
    if (tipo !== "FIBRA") setField("idFibra", null);
  };

  // Auto-fill slump from medición selection
  const handleMedicionAntesChange = (id) => {
    setField("medicionAntesId", id);
    const m = medicionOpts.find(o => o.value === id);
    if (m?.slump != null) setField("asentamientoAntes", Number(m.slump));
    if (m?.aire != null) setField("aireMedidoAntes", Number(m.aire));
  };
  const handleMedicionDespuesChange = (id) => {
    setField("medicionDespuesId", id);
    const m = medicionOpts.find(o => o.value === id);
    if (m?.slump != null) setField("asentamientoDespues", Number(m.slump));
    if (m?.aire != null) setField("aireMedidoDespues", Number(m.aire));
  };

  // Diagnóstico de por qué no se puede guardar — surface en UI para que
  // el usuario sepa exactamente qué le falta antes de hacer clic.
  const faltantesGuardar = [];
  if (!(form.cantidad > 0)) faltantesGuardar.push('cantidad > 0');
  if (String(form.motivo || '').trim().length < 3) faltantesGuardar.push('motivo (≥ 3 caracteres)');
  if (form.tipoAccion === 'ADITIVO' && !form.idAditivo) faltantesGuardar.push('seleccionar aditivo');
  if (form.tipoAccion === 'FIBRA' && !form.idFibra && !form.nombreMaterial) faltantesGuardar.push('seleccionar fibra o ingresar nombre');
  if (form.tipoAccion === 'OTRO' && !form.nombreMaterial) faltantesGuardar.push('nombre del material');
  const canSave = faltantesGuardar.length === 0;

  const handleSave = async () => {
    if (savingRef.current) return;
    setSaveError(null);
    if (!canSave) {
      const msg = `Complete: ${faltantesGuardar.join(', ')}`;
      setSaveError(msg);
      showToast?.("warn", msg);
      return;
    }
    if (!dosificacionId && !editing?.id) {
      const msg = 'No se identifica la dosificación destino. Recargá la página y volvé a intentarlo.';
      setSaveError(msg);
      showToast?.("error", msg);
      return;
    }
    try {
      savingRef.current = true;
      setSaving(true);
      const payload = { ...form };
      if (payload.fecha instanceof Date) payload.fecha = payload.fecha.toISOString();
      // Legacy compat
      payload.dosis = payload.cantidad;
      if (editing?.id) {
        await actualizarRedosificacion(editing.id, payload);
        showToast?.("success", "Acción actualizada");
      } else {
        await crearRedosificacion(dosificacionId, payload);
        showToast?.("success", "Acción registrada");
      }
      setDialogVisible(false);
      await refresh();
    } catch (err) {
      // Hacer visible el error tanto en toast como dentro del diálogo,
      // así el usuario lo ve aunque el toast del bottom se le pierda.
      const detail = err?.response?.data?.error
        || err?.response?.data?.message
        || err?.message
        || 'Error al guardar';
      const status = err?.response?.status ? ` (HTTP ${err.response.status})` : '';
      setSaveError(`${detail}${status}`);
      showToast?.("error", detail);
      // Diagnóstico extra en consola para debug
      if (err?.response) {
        // eslint-disable-next-line no-console
        console.error('[RedosificacionesObraSection.handleSave] Backend error:', err.response.status, err.response.data);
      } else {
        // eslint-disable-next-line no-console
        console.error('[RedosificacionesObraSection.handleSave] Error sin respuesta:', err);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`¿Eliminar la acción del ${fmtFecha(row.fecha)}?`)) return;
    if (deletingRef.current) return;
    try {
      deletingRef.current = true;
      await eliminarRedosificacion(row.id);
      showToast?.("success", "Acción eliminada");
      await refresh();
    } catch (err) {
      showToast?.("error", err?.response?.data?.error || "Error al eliminar");
    } finally {
      deletingRef.current = false;
    }
  };

  if (!dosificacionId) {
    return (
      <div className="text-sm text-color-secondary p-3">
        <i className="fa-solid fa-info-circle mr-2" />
        Guardá la dosificación para poder registrar acciones.
      </div>
    );
  }

  const getTipoMeta = (tipo) => TIPO_ACCION_OPTS.find(t => t.value === tipo) || TIPO_ACCION_OPTS[4];

  return (
    <div id="redosificaciones-section" className="flex flex-column gap-2">
      <div className="flex justify-content-between align-items-center">
        <div className="text-sm text-color-secondary">
          Acciones de agregado de materiales durante la vida del pastón (agua, aditivos, fibras, aire).
        </div>
        <Button
          label="Agregar acción"
          icon="fa-solid fa-plus"
          size="small"
          onClick={openNew}
        />
      </div>

      {loading && (
        <div className="text-sm text-color-secondary p-2">
          <i className="fa-solid fa-spinner fa-spin mr-1" />Cargando...
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="surface-card border-round p-3 text-center text-color-secondary text-sm">
          <i className="fa-solid fa-inbox mr-2" />
          Sin acciones registradas.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex flex-column gap-2">
          {rows.map((r) => {
            const tipo = getTipoMeta(r.tipoAccion || 'ADITIVO');
            const materialNombre = r.tipoAccion === 'AGUA' ? 'Agua'
              : r.tipoAccion === 'AIRE' ? 'Aire incorporado'
              : r.aditivo?.marca || r.nombreMaterial || aditivoById[r.idAditivo] || `Material #${r.idAditivo || '?'}`;
            const cant = r.cantidad != null ? Number(r.cantidad) : (r.dosis != null ? Number(r.dosis) : null);
            const unidad = r.unidad || UNIDAD_DEFAULTS[r.tipoAccion || 'ADITIVO'];
            const etapa = r.etapa || 'OBRA';
            const etapaSeverity = etapa === 'PLANTA' ? 'warning' : etapa === 'TRANSPORTE' ? 'info' : 'success';

            // Delta slump
            const deltaSlump = r.asentamientoAntes != null && r.asentamientoDespues != null
              ? Number(r.asentamientoDespues) - Number(r.asentamientoAntes) : null;

            return (
              <div key={r.id} className="surface-card border-round p-2 border-1 border-200">
                <div className="flex justify-content-between align-items-start gap-2">
                  <div className="flex-1">
                    <div className="flex align-items-center gap-2 mb-1 flex-wrap">
                      <Tag value={ETAPA_OPTS.find(e => e.value === etapa)?.label || etapa} severity={etapaSeverity} />
                      <span style={{ color: tipo.color }}><i className={`${tipo.icon} mr-1`} /><strong className="text-sm">{materialNombre}</strong></span>
                      {cant != null && <Tag value={`${fmtNum(cant, cant < 10 ? 2 : 1)} ${unidad}`} severity="info" />}
                      <small className="text-color-secondary">{fmtFecha(r.fecha)}</small>
                    </div>
                    <div className="text-sm">{r.motivo}</div>
                    {/* Efecto medido */}
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-color-secondary">
                      {r.asentamientoAntes != null && (
                        <span>Slump antes: <strong>{fmtNum(r.asentamientoAntes, 0)} mm</strong></span>
                      )}
                      {r.asentamientoDespues != null && (
                        <span>Slump después: <strong>{fmtNum(r.asentamientoDespues, 0)} mm</strong></span>
                      )}
                      {deltaSlump != null && (
                        <span style={{ color: deltaSlump >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          ({deltaSlump > 0 ? '+' : ''}{fmtNum(deltaSlump, 0)} mm)
                        </span>
                      )}
                      {r.aireMedidoAntes != null && <span>Aire antes: <strong>{fmtNum(r.aireMedidoAntes, 1)}%</strong></span>}
                      {r.aireMedidoDespues != null && <span>Aire después: <strong>{fmtNum(r.aireMedidoDespues, 1)}%</strong></span>}
                      {r.volumenHormigonM3 != null && <span>Vol: <strong>{fmtNum(r.volumenHormigonM3, 2)} m³</strong></span>}
                    </div>
                  </div>
                  <div className="flex flex-column gap-1">
                    <Button icon="fa-solid fa-pen" className="p-button-text p-button-sm" onClick={() => openEdit(r)} />
                    <Button icon="fa-solid fa-trash" className="p-button-text p-button-sm p-button-danger" onClick={() => handleDelete(r)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        header={editing ? "Editar acción" : "Registrar acción de agregado"}
        visible={dialogVisible}
        onHide={() => { setSaveError(null); setDialogVisible(false); }}
        style={{ width: "90vw", maxWidth: "46rem" }}
        modal
        draggable={false}
        footer={(
          <div className="flex flex-column gap-2 align-items-stretch w-full">
            {saveError && (
              <Message severity="error" text={saveError} className="w-full" />
            )}
            <div className="flex justify-content-end gap-2 align-items-center flex-wrap">
              {!canSave && !saveError && (
                <small className="text-orange-600" style={{ marginRight: 'auto' }}>
                  <i className="fa-solid fa-circle-exclamation mr-1" />
                  Falta: {faltantesGuardar.join(' · ')}
                </small>
              )}
              <Button label="Cancelar" className="p-button-text p-button-sm" onClick={() => { setSaveError(null); setDialogVisible(false); }} />
              <Button
                label={editing ? "Guardar cambios" : "Registrar"}
                icon="fa-solid fa-check"
                className="p-button-sm"
                onClick={handleSave}
                disabled={!canSave || saving}
                loading={saving}
                tooltip={!canSave ? `Falta: ${faltantesGuardar.join(', ')}` : undefined}
                tooltipOptions={{ position: 'top' }}
              />
            </div>
          </div>
        )}
      >
        <div className="grid formgrid">
          {/* Tipo de acción */}
          <div className="field col-12">
            <label className="text-sm font-semibold">Tipo de acción</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {TIPO_ACCION_OPTS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTipoChange(t.value)}
                  style={{
                    background: form.tipoAccion === t.value ? t.color : 'var(--surface-100)',
                    color: form.tipoAccion === t.value ? '#fff' : 'var(--text-color)',
                    border: form.tipoAccion === t.value ? `2px solid ${t.color}` : '2px solid var(--surface-300)',
                    borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  <i className={`${t.icon} mr-1`} />{t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Material según tipo */}
          {form.tipoAccion === "ADITIVO" && (
            <div className="field col-12 md:col-6">
              <label className="text-sm font-semibold">Aditivo *</label>
              <Dropdown
                value={form.idAditivo}
                options={aditivosOptions}
                onChange={(e) => {
                  // Autocompletar unidad desde la ficha del aditivo elegido
                  const opt = aditivosOptions.find((o) => o.value === e.value);
                  const unidadFicha = opt?.unidadDosificacion
                    ? UNIDAD_ADITIVO_LABEL[opt.unidadDosificacion] || opt.unidadDosificacion
                    : null;
                  setForm((prev) => ({
                    ...prev,
                    idAditivo: e.value,
                    unidad: unidadFicha || prev.unidad || UNIDAD_DEFAULTS.ADITIVO,
                  }));
                }}
                placeholder="Seleccionar aditivo"
                filter className="w-full"
              />
            </div>
          )}
          {form.tipoAccion === "FIBRA" && (
            <div className="field col-12 md:col-6">
              <label className="text-sm font-semibold">Fibra *</label>
              {fibrasOptions.length > 0 ? (
                <Dropdown
                  value={form.idFibra}
                  options={fibrasOptions}
                  onChange={(e) => setField("idFibra", e.value)}
                  placeholder="Seleccionar fibra"
                  filter className="w-full"
                />
              ) : (
                <InputText
                  value={form.nombreMaterial}
                  onChange={(e) => setField("nombreMaterial", e.target.value)}
                  placeholder="Nombre de la fibra"
                  className="w-full"
                />
              )}
            </div>
          )}
          {form.tipoAccion === "OTRO" && (
            <div className="field col-12 md:col-6">
              <label className="text-sm font-semibold">Material *</label>
              <InputText
                value={form.nombreMaterial}
                onChange={(e) => setField("nombreMaterial", e.target.value)}
                placeholder="Nombre del material"
                className="w-full"
              />
            </div>
          )}

          {/* Cantidad + unidad */}
          <div className="field col-6 md:col-3">
            <label className="text-sm font-semibold">Cantidad *</label>
            <InputNumber
              value={form.cantidad}
              onValueChange={(e) => setField("cantidad", e.value)}
              minFractionDigits={0} maxFractionDigits={3}
              min={0}
              inputClassName="w-full"
            />
          </div>
          <div className="field col-6 md:col-3">
            <label className="text-sm font-semibold">Unidad</label>
            <InputText
              value={form.unidad}
              onChange={(e) => setField("unidad", e.target.value)}
              className="w-full"
            />
          </div>

          {/* Etapa + Efecto */}
          <div className="field col-12 md:col-6">
            <label className="text-sm font-semibold">Etapa</label>
            <Dropdown value={form.etapa} options={ETAPA_OPTS} onChange={(e) => setField("etapa", e.value)} className="w-full" />
          </div>
          <div className="field col-12 md:col-6">
            <label className="text-sm font-semibold">Efecto principal</label>
            <Dropdown value={form.modoEfecto} options={MODO_EFECTO_OPTS} onChange={(e) => setField("modoEfecto", e.value)} className="w-full" />
          </div>

          {/* Motivo */}
          <div className="field col-12">
            <label className="text-sm font-semibold">Motivo *</label>
            <InputText value={form.motivo} onChange={(e) => setField("motivo", e.target.value)} placeholder="Ej: recuperar slump tras espera de 45 min" className="w-full" />
          </div>

          {/* Mediciones vinculadas (antes / después) */}
          {medicionOpts.length > 0 && (
            <>
              <div className="field col-12">
                <div className="text-xs font-bold text-primary mb-1">
                  <i className="fa-solid fa-link mr-1" />Vincular mediciones (causa → efecto)
                </div>
              </div>
              <div className="field col-12 md:col-6">
                <label className="text-sm">Medición ANTES</label>
                <Dropdown
                  value={form.medicionAntesId}
                  options={[{ label: "— ninguna —", value: null }, ...medicionOpts]}
                  onChange={(e) => handleMedicionAntesChange(e.value)}
                  className="w-full" showClear
                />
              </div>
              <div className="field col-12 md:col-6">
                <label className="text-sm">Medición DESPUÉS</label>
                <Dropdown
                  value={form.medicionDespuesId}
                  options={[{ label: "— ninguna —", value: null }, ...medicionOpts]}
                  onChange={(e) => handleMedicionDespuesChange(e.value)}
                  className="w-full" showClear
                />
              </div>
            </>
          )}

          {/* Valores medidos (manual o auto-filled) */}
          <div className="field col-6 md:col-3">
            <label className="text-sm">Slump antes (mm)</label>
            <InputNumber value={form.asentamientoAntes} onValueChange={(e) => setField("asentamientoAntes", e.value)} min={0} maxFractionDigits={1} inputClassName="w-full" />
          </div>
          <div className="field col-6 md:col-3">
            <label className="text-sm">Slump después (mm)</label>
            <InputNumber value={form.asentamientoDespues} onValueChange={(e) => setField("asentamientoDespues", e.value)} min={0} maxFractionDigits={1} inputClassName="w-full" />
          </div>
          {(form.tipoAccion === "AIRE" || form.tipoAccion === "ADITIVO") && (
            <>
              <div className="field col-6 md:col-3">
                <label className="text-sm">Aire antes (%)</label>
                <InputNumber value={form.aireMedidoAntes} onValueChange={(e) => setField("aireMedidoAntes", e.value)} min={0} max={20} maxFractionDigits={2} inputClassName="w-full" />
              </div>
              <div className="field col-6 md:col-3">
                <label className="text-sm">Aire después (%)</label>
                <InputNumber value={form.aireMedidoDespues} onValueChange={(e) => setField("aireMedidoDespues", e.value)} min={0} max={20} maxFractionDigits={2} inputClassName="w-full" />
              </div>
            </>
          )}

          <div className="field col-6 md:col-3">
            <label className="text-sm">Volumen hormigón (m³)</label>
            <InputNumber value={form.volumenHormigonM3} onValueChange={(e) => setField("volumenHormigonM3", e.value)} min={0} maxFractionDigits={3} inputClassName="w-full" />
          </div>
          <div className="field col-6 md:col-3">
            <label className="text-sm">Fecha y hora</label>
            <Calendar value={form.fecha} onChange={(e) => setField("fecha", e.value)} showTime hourFormat="24" dateFormat="dd/mm/yy" className="w-full" />
          </div>

          <div className="field col-12">
            <label className="text-sm">Observaciones</label>
            <InputTextarea value={form.observaciones} onChange={(e) => setField("observaciones", e.target.value)} rows={2} className="w-full" placeholder="Opcional" />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
