import React, { useEffect, useState, useCallback, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { useToast } from "../../../context/ToastContext";
import {
  getPrecios,
  createPrecio,
  deletePrecio,
} from "../../../services/materialPrecioService";

const UNIDAD_OPTIONS = [
  { label: "$/kg", value: "kg" },
  { label: "$/tn", value: "tn" },
  { label: "$/L", value: "L" },
  { label: "$/m³", value: "m3" },
];

const formatCurrency = (val) => {
  if (val == null) return "-";
  return Number(val).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
};

const formatDate = (d) => {
  if (!d) return "-";
  return new Date(d + "T12:00:00").toLocaleDateString("es-AR");
};

export default function MaterialPrecioPanel({ visible, onHide, materialSource, materialSourceId, materialNombre }) {
  const toast = useToast();
  const [precios, setPrecios] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [precioUnitario, setPrecioUnitario] = useState(null);
  const [unidad, setUnidad] = useState("tn");
  const [fechaVigencia, setFechaVigencia] = useState(new Date());
  const [proveedor, setProveedor] = useState("");
  const [incluyeFlete, setIncluyeFlete] = useState(false);
  const [costoFlete, setCostoFlete] = useState(null);
  const [observaciones, setObservaciones] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const fetchPrecios = useCallback(async () => {
    if (!materialSource || !materialSourceId) return;
    setLoading(true);
    try {
      const data = await getPrecios(materialSource, materialSourceId);
      setPrecios(data || []);
    } catch (err) {
      console.error("Error al obtener precios:", err);
    } finally {
      setLoading(false);
    }
  }, [materialSource, materialSourceId]);

  useEffect(() => {
    if (visible) fetchPrecios();
  }, [visible, fetchPrecios]);

  const resetForm = () => {
    setPrecioUnitario(null);
    setUnidad("tn");
    setFechaVigencia(new Date());
    setProveedor("");
    setIncluyeFlete(false);
    setCostoFlete(null);
    setObservaciones("");
    setShowForm(false);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!precioUnitario || precioUnitario <= 0) {
      toast?.current?.show({ severity: "warn", summary: "Precio requerido", detail: "Ingrese un precio unitario válido" });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const fv = fechaVigencia instanceof Date
        ? fechaVigencia.toISOString().slice(0, 10)
        : fechaVigencia;

      await createPrecio({
        materialSource,
        materialSourceId,
        precioUnitario,
        unidad,
        fechaVigencia: fv,
        proveedor: proveedor || null,
        incluyeFlete,
        costoFlete: incluyeFlete ? null : costoFlete,
        observaciones: observaciones || null,
        autoVencer: true,
      });
      toast?.current?.show({ severity: "success", summary: "Precio guardado", detail: "Nuevo precio registrado" });
      resetForm();
      fetchPrecios();
    } catch (err) {
      console.error(err);
      toast?.current?.show({ severity: "error", summary: "Error", detail: "No se pudo guardar el precio" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (deletingRef.current) return;
    try {
      deletingRef.current = true;
      await deletePrecio(row.id);
      toast?.current?.show({ severity: "success", summary: "Eliminado", detail: "Precio eliminado" });
      fetchPrecios();
    } catch (err) {
      console.error(err);
      toast?.current?.show({ severity: "error", summary: "Error", detail: "No se pudo eliminar" });
    } finally {
      deletingRef.current = false;
    }
  };

  const vigente = precios.find(p => !p.fechaVencimiento);

  return (
    <Dialog
      visible={visible}
      onHide={() => { resetForm(); onHide(); }}
      header={`Precios \u2014 ${materialNombre || "Material"}`}
      style={{ width: "90vw", maxWidth: "42rem" }}
      modal
      maximizable
    >
      {/* Precio vigente summary */}
      {vigente ? (
        <div className="surface-100 border-round p-3 mb-3">
          <div className="flex align-items-center gap-2 mb-1">
            <Tag value="Vigente" severity="success" />
            <span className="font-bold text-lg">{formatCurrency(vigente.precioUnitario)} /{vigente.unidad}</span>
          </div>
          <div className="text-sm text-color-secondary">
            Desde {formatDate(vigente.fechaVigencia)}
            {vigente.proveedor && <> &middot; {vigente.proveedor}</>}
            {vigente.incluyeFlete ? " · Incluye flete" : vigente.costoFlete ? ` · Flete: ${formatCurrency(vigente.costoFlete)} /${vigente.unidad}` : ""}
          </div>
        </div>
      ) : (
        <div className="surface-100 border-round p-3 mb-3 text-color-secondary">
          <i className="fa-solid fa-info-circle mr-2" />
          No hay precio vigente para este material.
        </div>
      )}

      {/* New price form */}
      {showForm ? (
        <div className="surface-50 border-round p-3 mb-3 flex flex-column gap-3">
          <div className="font-semibold">Nuevo precio</div>
          <div className="flex gap-2 align-items-end flex-wrap">
            <div className="flex flex-column gap-1 flex-1" style={{ minWidth: "140px" }}>
              <label className="text-sm font-semibold">Precio unitario *</label>
              <InputNumber
                value={precioUnitario}
                onValueChange={(e) => setPrecioUnitario(e.value)}
                mode="currency"
                currency="ARS"
                locale="es-AR"
                minFractionDigits={0}
                maxFractionDigits={2}
                className="p-inputtext-sm"
              />
            </div>
            <div className="flex flex-column gap-1" style={{ width: "100px" }}>
              <label className="text-sm font-semibold">Unidad</label>
              <Dropdown
                value={unidad}
                options={UNIDAD_OPTIONS}
                onChange={(e) => setUnidad(e.value)}
                className="p-inputtext-sm"
              />
            </div>
            <div className="flex flex-column gap-1" style={{ width: "140px" }}>
              <label className="text-sm font-semibold">Vigencia desde</label>
              <Calendar
                value={fechaVigencia}
                onChange={(e) => setFechaVigencia(e.value)}
                dateFormat="dd/mm/yy"
                className="p-inputtext-sm"
                showIcon
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-column gap-1 flex-1" style={{ minWidth: "180px" }}>
              <label className="text-sm font-semibold">Proveedor</label>
              <InputText
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                placeholder="Opcional"
                className="p-inputtext-sm"
              />
            </div>
          </div>
          <div className="flex align-items-center gap-3">
            <div className="flex align-items-center gap-2">
              <Checkbox inputId="mp-flete" checked={incluyeFlete} onChange={(e) => setIncluyeFlete(e.checked)} />
              <label htmlFor="mp-flete" className="text-sm">Incluye flete</label>
            </div>
            {!incluyeFlete && (
              <div className="flex flex-column gap-1" style={{ width: "160px" }}>
                <label className="text-sm font-semibold">Costo flete</label>
                <InputNumber
                  value={costoFlete}
                  onValueChange={(e) => setCostoFlete(e.value)}
                  mode="currency"
                  currency="ARS"
                  locale="es-AR"
                  minFractionDigits={0}
                  maxFractionDigits={2}
                  className="p-inputtext-sm"
                  placeholder="Opcional"
                />
              </div>
            )}
          </div>
          <div className="flex flex-column gap-1">
            <label className="text-sm font-semibold">Observaciones</label>
            <InputTextarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
              autoResize
              className="p-inputtext-sm"
              placeholder="Opcional"
            />
          </div>
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" className="p-button-text p-button-sm" onClick={resetForm} />
            <Button label="Guardar precio" icon="fa-solid fa-check" className="p-button-sm" onClick={handleSave} loading={saving} disabled={saving} />
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <Button label="Nuevo precio" icon="fa-solid fa-plus" className="p-button-outlined p-button-sm" onClick={() => setShowForm(true)} />
        </div>
      )}

      {/* Price history */}
      <div className="font-semibold mb-2">Historial de precios</div>
      <DataTable responsiveLayout="scroll"
        value={precios}
        loading={loading}
        size="small"
        emptyMessage="Sin precios registrados."
        stripedRows
        paginator={precios.length > 10}
        rows={10}
      >
        <Column
          header="Vigencia"
          body={(r) => formatDate(r.fechaVigencia)}
          style={{ width: "100px" }}
        />
        <Column
          header="Precio"
          body={(r) => (
            <span className="font-semibold">
              {formatCurrency(r.precioUnitario)} /{r.unidad}
            </span>
          )}
          style={{ width: "140px" }}
        />
        <Column
          header="Flete"
          body={(r) => r.incluyeFlete ? "Incluido" : r.costoFlete ? `${formatCurrency(r.costoFlete)} /${r.unidad}` : "-"}
          style={{ width: "120px" }}
        />
        <Column
          header="Estado"
          body={(r) => !r.fechaVencimiento ? <Tag value="Vigente" severity="success" /> : <Tag value={`Venció ${formatDate(r.fechaVencimiento)}`} severity="warning" />}
          style={{ width: "130px" }}
        />
        <Column
          header="Obs."
          body={(r) => r.observaciones || "-"}
        />
        <Column
          header=""
          style={{ width: "50px" }}
          body={(r) => (
            <Button
              icon="fa-solid fa-trash"
              rounded text size="small"
              severity="danger"
              tooltip="Eliminar"
              tooltipOptions={{ position: "top" }}
              onClick={() => handleDelete(r)}
            />
          )}
        />
      </DataTable>
    </Dialog>
  );
}
