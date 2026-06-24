import React, { useState, useEffect, useCallback, useRef } from "react";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import {
  getTipologias,
  crearTipologia,
  actualizarTipologia,
  eliminarTipologia,
  restaurarDefaultsTipologia,
} from "../../../services/tipologiaHormigonService";

const CURVA_FAMILIA_OPTIONS = [
  { label: "Fuller-Talbot", value: "FULLER_TALBOT" },
  { label: "Andreasen", value: "ANDREASEN" },
  { label: "Andreasen Modificada (Funk-Dinger)", value: "ANDREASEN_MOD" },
  { label: "Rosin-Rammler", value: "ROSIN_RAMMLER" },
];

const CURVA_FAMILIA_LABELS = {
  FULLER_TALBOT: "Fuller-Talbot",
  ANDREASEN: "Andreasen",
  ANDREASEN_MOD: "Andreasen Mod.",
  ROSIN_RAMMLER: "Rosin-Rammler",
};

const EMPTY_FORM = {
  codigo: "",
  nombre: "",
  descripcion: "",
  curvaFamilia: "FULLER_TALBOT",
  curvaExponente: 0.5,
  orden: 50,
  restriccionesGranulometricas: {},
  restriccionesDosificacion: {},
};

export default function TipologiasConfigPage() {
  const showToast = useToast();
  const [tipologias, setTipologias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editDialog, setEditDialog] = useState(false);
  const [editMode, setEditMode] = useState("crear"); // "crear" | "editar"
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getTipologias();
      setTipologias(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error cargando tipologías:", err);
      showToast("error", "Error cargando tipologías");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditMode("crear");
    setEditDialog(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      descripcion: row.descripcion || "",
      curvaFamilia: row.curvaFamilia || "FULLER_TALBOT",
      curvaExponente: row.curvaExponente != null ? Number(row.curvaExponente) : 0.5,
      orden: row.orden ?? 50,
      esPredefinida: row.esPredefinida,
      restriccionesGranulometricas: row.restriccionesGranulometricas || {},
      restriccionesDosificacion: row.restriccionesDosificacion || {},
    });
    setEditMode("editar");
    setEditDialog(true);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.nombre?.trim()) {
      showToast("warn", "El nombre es obligatorio");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (editMode === "crear") {
        if (!form.codigo?.trim()) {
          showToast("warn", "El código es obligatorio");
          savingRef.current = false;
          setSaving(false);
          return;
        }
        await crearTipologia(form);
        showToast("success", "Tipología creada");
      } else {
        await actualizarTipologia(form.id, {
          nombre: form.nombre,
          descripcion: form.descripcion,
          curvaFamilia: form.curvaFamilia,
          curvaExponente: form.curvaExponente,
          orden: form.orden,
          restriccionesGranulometricas: form.restriccionesGranulometricas,
          restriccionesDosificacion: form.restriccionesDosificacion,
        });
        showToast("success", "Tipología actualizada");
      }
      setEditDialog(false);
      fetchData();
    } catch (err) {
      console.error("Error guardando tipología:", err);
      const msg = err.response?.data?.message || "Error al guardar";
      showToast("error", msg);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row) => {
    if (row.esPredefinida) {
      showToast("warn", "Las tipologías predefinidas no se pueden eliminar");
      return;
    }
    confirmDialog({
      message: `¿Eliminar la tipología "${row.nombre}"?`,
      header: "Confirmar eliminación",
      icon: "fa-solid fa-triangle-exclamation",
      acceptClassName: "p-button-danger",
      acceptLabel: "Eliminar",
      rejectLabel: "Cancelar",
      accept: async () => {
        try {
          await eliminarTipologia(row.id);
          showToast("success", "Tipología eliminada");
          fetchData();
        } catch (err) {
          console.error(err);
          showToast("error", "Error al eliminar");
        }
      },
    });
  };

  const handleRestaurar = (row) => {
    confirmDialog({
      message: `¿Restaurar "${row.nombre}" a sus valores por defecto?`,
      header: "Restaurar valores",
      icon: "fa-solid fa-rotate-left",
      acceptLabel: "Restaurar",
      rejectLabel: "Cancelar",
      accept: async () => {
        try {
          await restaurarDefaultsTipologia(row.id);
          showToast("success", "Valores restaurados");
          fetchData();
        } catch (err) {
          console.error(err);
          const msg = err.response?.data?.message || "Error al restaurar";
          showToast("error", msg);
        }
      },
    });
  };

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  /* ── Restricciones helpers ── */
  const setRestGranulo = (key, value) => {
    setForm((prev) => ({
      ...prev,
      restriccionesGranulometricas: { ...prev.restriccionesGranulometricas, [key]: value },
    }));
  };
  const setRestDosif = (key, value) => {
    setForm((prev) => ({
      ...prev,
      restriccionesDosificacion: { ...prev.restriccionesDosificacion, [key]: value },
    }));
  };

  const filtered = tipologias.filter((t) =>
    (t.nombre || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.codigo || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  const rg = form.restriccionesGranulometricas || {};
  const rd = form.restriccionesDosificacion || {};

  return (
    <Fade direction="up" duration={500} triggerOnce>
      {/* ── Edit / Create Dialog ── */}
      <Dialog
        visible={editDialog}
        onHide={() => setEditDialog(false)}
        header={editMode === "crear" ? "Nueva tipología" : `Editar: ${form.nombre}`}
        className="w-11 xl:w-7"
        modal
      >
        <div className="flex flex-column gap-3 p-2">
          {/* Row 1 — Código + Nombre */}
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-column flex-1">
              <label className="font-bold text-sm mb-1">Código</label>
              <InputText
                value={form.codigo}
                onChange={(e) => setField("codigo", e.target.value)}
                disabled={editMode === "editar"}
                placeholder="ej: bombeable"
                className="w-full"
              />
            </div>
            <div className="flex flex-column flex-1">
              <label className="font-bold text-sm mb-1">Nombre</label>
              <InputText
                value={form.nombre}
                onChange={(e) => setField("nombre", e.target.value)}
                placeholder="ej: Hormigón bombeable"
                className="w-full"
              />
            </div>
            <div className="flex flex-column" style={{ width: "5rem" }}>
              <label className="font-bold text-sm mb-1">Orden</label>
              <InputNumber
                value={form.orden}
                onValueChange={(e) => setField("orden", e.value)}
                min={0}
                max={999}
                className="w-full"
              />
            </div>
          </div>

          {/* Row 2 — Descripción */}
          <div className="flex flex-column">
            <label className="font-bold text-sm mb-1">Descripción</label>
            <InputTextarea
              value={form.descripcion}
              onChange={(e) => setField("descripcion", e.target.value)}
              rows={2}
              autoResize
              className="w-full"
            />
          </div>

          {/* Row 3 — Curva teórica */}
          <div className="flex flex-wrap gap-3 align-items-end">
            <div className="flex flex-column flex-1">
              <label className="font-bold text-sm mb-1">Familia de curva</label>
              <Dropdown
                value={form.curvaFamilia}
                options={CURVA_FAMILIA_OPTIONS}
                onChange={(e) => setField("curvaFamilia", e.value)}
                className="w-full"
              />
            </div>
            <div className="flex flex-column" style={{ width: "8rem" }}>
              <label className="font-bold text-sm mb-1">Exponente</label>
              <InputNumber
                value={form.curvaExponente}
                onValueChange={(e) => setField("curvaExponente", e.value)}
                minFractionDigits={2}
                maxFractionDigits={3}
                min={0.1}
                max={1.0}
                step={0.01}
                className="w-full"
              />
            </div>
          </div>

          {/* Row 4 — Restricciones granulométricas */}
          <fieldset className="border-1 border-300 border-round p-3">
            <legend className="font-bold text-sm px-2">Restricciones granulométricas</legend>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-column" style={{ width: "7rem" }}>
                <label className="text-xs mb-1">Pasa 0.15 mín (%)</label>
                <InputNumber value={rg.pasa_0_15_min ?? null} onValueChange={(e) => setRestGranulo("pasa_0_15_min", e.value)} min={0} max={100} maxFractionDigits={1} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "7rem" }}>
                <label className="text-xs mb-1">Pasa 0.30 mín (%)</label>
                <InputNumber value={rg.pasa_0_30_min ?? null} onValueChange={(e) => setRestGranulo("pasa_0_30_min", e.value)} min={0} max={100} maxFractionDigits={1} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "6rem" }}>
                <label className="text-xs mb-1">TMN máx (mm)</label>
                <InputNumber value={rg.tmn_max ?? null} onValueChange={(e) => setRestGranulo("tmn_max", e.value)} min={0} maxFractionDigits={1} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "6rem" }}>
                <label className="text-xs mb-1">TMN mín (mm)</label>
                <InputNumber value={rg.tmn_min ?? null} onValueChange={(e) => setRestGranulo("tmn_min", e.value)} min={0} maxFractionDigits={1} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "5.5rem" }}>
                <label className="text-xs mb-1">MF máx</label>
                <InputNumber value={rg.mf_max ?? null} onValueChange={(e) => setRestGranulo("mf_max", e.value)} min={0} max={10} maxFractionDigits={2} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "5.5rem" }}>
                <label className="text-xs mb-1">MF mín</label>
                <InputNumber value={rg.mf_min ?? null} onValueChange={(e) => setRestGranulo("mf_min", e.value)} min={0} max={10} maxFractionDigits={2} className="w-full" />
              </div>
            </div>
          </fieldset>

          {/* Row 5 — Restricciones de dosificación */}
          <fieldset className="border-1 border-300 border-round p-3">
            <legend className="font-bold text-sm px-2">Restricciones de dosificación</legend>
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-column" style={{ width: "7rem" }}>
                <label className="text-xs mb-1">Asent. mín (mm)</label>
                <InputNumber value={rd.asentamiento_min ?? null} onValueChange={(e) => setRestDosif("asentamiento_min", e.value)} min={0} max={300} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "7rem" }}>
                <label className="text-xs mb-1">Asent. máx (mm)</label>
                <InputNumber value={rd.asentamiento_max ?? null} onValueChange={(e) => setRestDosif("asentamiento_max", e.value)} min={0} max={300} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "7rem" }}>
                <label className="text-xs mb-1">Vol. pasta mín</label>
                <InputNumber value={rd.vol_pasta_min ?? null} onValueChange={(e) => setRestDosif("vol_pasta_min", e.value)} min={0} max={1} maxFractionDigits={3} step={0.01} className="w-full" />
              </div>
              <div className="flex flex-column" style={{ width: "8rem" }}>
                <label className="text-xs mb-1">Cemento máx (kg)</label>
                <InputNumber value={rd.cemento_max_kg ?? null} onValueChange={(e) => setRestDosif("cemento_max_kg", e.value)} min={0} max={800} className="w-full" />
              </div>
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex justify-content-end gap-2 mt-2">
            <Button label="Cancelar" severity="secondary" outlined size="small" onClick={() => setEditDialog(false)} />
            <Button label={editMode === "crear" ? "Crear" : "Guardar"} icon="fa-solid fa-check" size="small" loading={saving} disabled={saving} onClick={handleSave} />
          </div>
        </div>
      </Dialog>

      {/* ── Page ── */}
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader
          icon="fa-solid fa-layer-group"
          title="Tipologías de hormigón"
          subtitle="Configuración de curvas teóricas y restricciones por tipología"
        />

        <div className="flex align-items-center w-full mb-2 gap-2">
          <span className="search-bar-wrapper">
            <InputText
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar tipología..."
              title="Buscar por nombre o código"
              className="search-bar"
            />
          </span>
          <Button
            label="Nueva tipología"
            rounded
            icon="fa-solid fa-plus"
            severity="success"
            size="small"
            onClick={openCreate}
          />
        </div>

        <DataTable responsiveLayout="scroll"
          value={filtered}
          stripedRows
          paginator
          rows={20}
          emptyMessage="No hay tipologías configuradas"
          className="w-full"
          sortField="orden"
          sortOrder={1}
        >
          <Column
            field="orden"
            header="#"
            sortable
            style={{ width: "3rem" }}
          />
          <Column
            field="nombre"
            header="Nombre"
            sortable
            body={(row) => (
              <span
                className="font-bold hover-blue cursor-pointer"
                onClick={() => openEdit(row)}
              >
                {row.nombre}
              </span>
            )}
          />
          <Column
            field="codigo"
            header="Código"
            sortable
            body={(row) => <code>{row.codigo}</code>}
          />
          <Column
            field="curvaFamilia"
            header="Curva"
            body={(row) => (
              <span>
                {CURVA_FAMILIA_LABELS[row.curvaFamilia] || row.curvaFamilia}
                {" "}
                <small className="text-500">n={Number(row.curvaExponente).toFixed(3)}</small>
              </span>
            )}
          />
          <Column
            field="esPredefinida"
            header="Tipo"
            style={{ width: "6rem" }}
            body={(row) => (
              <Tag
                value={row.esPredefinida ? "Predefinida" : "Custom"}
                severity={row.esPredefinida ? "info" : "warning"}
                className="text-xs"
              />
            )}
          />
          <Column
            header="Acciones"
            style={{ width: "10rem" }}
            body={(row) => (
              <div className="flex gap-1">
                <Button
                  icon="fa-solid fa-pen"
                  rounded
                  text
                  size="small"
                  tooltip="Editar"
                  tooltipOptions={{ position: "top" }}
                  onClick={() => openEdit(row)}
                />
                {row.esPredefinida && (
                  <Button
                    icon="fa-solid fa-rotate-left"
                    rounded
                    text
                    size="small"
                    severity="secondary"
                    tooltip="Restaurar defaults"
                    tooltipOptions={{ position: "top" }}
                    onClick={() => handleRestaurar(row)}
                  />
                )}
                {!row.esPredefinida && (
                  <Button
                    icon="fa-solid fa-trash"
                    rounded
                    text
                    size="small"
                    severity="danger"
                    tooltip="Eliminar"
                    tooltipOptions={{ position: "top" }}
                    onClick={() => handleDelete(row)}
                  />
                )}
              </div>
            )}
          />
        </DataTable>
      </div>
    </Fade>
  );
}
