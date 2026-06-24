import React, { useEffect, useState, useCallback } from "react";
import { Dialog } from "primereact/dialog";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import axios from "axios";
import { config } from "../../../../config/config";
import { useToast } from "../../../../context/ToastContext";
import { formatNumber, getClienteDisplayName } from "../../../../common/functions";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";

/**
 * Selector de despacho para crear una muestra propia.
 *
 * Lista los despachos de la fecha elegida (default = hoy) para que el
 * laboratorista indique a qué despacho corresponde la muestra fresca /
 * probetas que va a registrar. El backend (`GET /api/despachos`) ya filtra
 * por las plantas autorizadas del usuario.
 *
 * Esta vía permite que un rol de Calidad cree la muestra sobre un despacho
 * sin pasar por el guardado del despacho (que requiere rol de Producción
 * "Coordinador"). La muestra se crea luego por `POST /api/muestras` con
 * `idDespacho`, ruta gateada por Calidad.
 *
 * Props:
 *  - visible: boolean
 *  - onHide: () => void
 *  - onSelect: (idDespacho) => void  — el padre navega al form de muestra.
 *  - onSinDespacho: () => void       — flujo de muestra sin despacho asociado.
 */
const toLocalISODate = (date) => {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const DespachoSelectorDialog = ({ visible, onHide, onSelect, onSinDespacho }) => {
  const toast = useToast();
  const [fecha, setFecha] = useState(new Date());
  const [despachos, setDespachos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [seleccionado, setSeleccionado] = useState(null);

  const fetchDespachos = useCallback(async (fechaSel) => {
    const iso = toLocalISODate(fechaSel);
    if (!iso) return;
    try {
      setLoading(true);
      setSeleccionado(null);
      const { data } = await axios.get(`${config.backendUrl}/api/despachos`, {
        headers: config.headers,
        params: { desde: iso, hasta: iso },
      });
      // Sin paginación el endpoint devuelve un array; con paginación, { despachos }.
      setDespachos(Array.isArray(data) ? data : (data?.despachos ?? []));
    } catch (err) {
      // [VITRINA] El módulo Despachos (Producción/Betonmatic) está recortado:
      // GET /api/despachos devuelve 404. Degradamos en silencio (lista vacía) en
      // vez de un toast de error — el diálogo igual ofrece "Muestra sin despacho",
      // que es el flujo de alta que usa Calidad en la vitrina.
      const status = err?.response?.status;
      if (status !== 404) {
        console.error("Error cargando despachos del día:", err);
        toast("error", "No se pudieron cargar los despachos");
      }
      setDespachos([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Al abrir el dialog, resetea a hoy y carga.
  useEffect(() => {
    if (!visible) return;
    const hoy = new Date();
    setFecha(hoy);
    fetchDespachos(hoy);
  }, [visible, fetchDespachos]);

  const handleFechaChange = (value) => {
    setFecha(value);
    if (value) fetchDespachos(value);
  };

  /* ---------- columnas ---------- */
  const horaTpl = (row) => (row.hora ? String(row.hora).slice(0, 5) : "—");
  const clienteTpl = (row) => getClienteDisplayName(row.cliente, "—");
  const obraTpl = (row) => row.obra?.nombre ?? "—";
  const dosifTpl = (row) => {
    const d = row.dosificacion || row.dosificacionDisenada;
    if (!d) return "—";
    return d.codigoEnPlanta
      ? `${d.codigoEnPlanta}${d.nombre ? ` — ${d.nombre}` : ""}`
      : (d.nombre ?? `Dosificación ${d.idDosificacion ?? ""}`);
  };
  const volumenTpl = (row) =>
    row.volumenDepacho != null ? `${formatNumber(row.volumenDepacho)} m³` : "—";
  const remitoTpl = (row) => row.remito || "—";
  const estadoTpl = (row) => row.estadoDespacho?.estado ?? "—";

  const footer = (
    <div className="flex flex-column sm:flex-row justify-content-between align-items-stretch sm:align-items-center gap-2">
      <Button
        label="Muestra sin despacho"
        icon="fa-solid fa-link-slash"
        text
        size="small"
        onClick={() => { onSinDespacho?.(); }}
        tooltip="Crear una muestra que no está asociada a ningún despacho"
        tooltipOptions={{ position: "top" }}
      />
      <div className="flex gap-2 justify-content-end">
        <Button
          label="Cancelar"
          icon="fa-solid fa-xmark"
          outlined
          severity="secondary"
          size="small"
          onClick={onHide}
        />
        <Button
          label="Crear muestra para este despacho"
          icon="fa-solid fa-flask"
          size="small"
          disabled={!seleccionado}
          onClick={() => seleccionado && onSelect?.(seleccionado.idDespacho)}
        />
      </div>
    </div>
  );

  return (
    <Dialog
      header="Seleccionar despacho para la muestra"
      visible={visible}
      onHide={onHide}
      footer={footer}
      style={{ width: "90vw", maxWidth: "900px" }}
      breakpoints={{ "640px": "100vw" }}
      dismissableMask
    >
      <div className="flex flex-column gap-3">
        <div className="flex flex-column sm:flex-row sm:align-items-end gap-2">
          <div className="flex flex-column">
            <label className="mb-1 text-color-secondary text-sm">Fecha del despacho</label>
            <Calendar
              value={fecha}
              onChange={(e) => handleFechaChange(e.value)}
              dateFormat="dd/mm/yy"
              showIcon
              maxDate={new Date()}
            />
          </div>
          <small className="text-color-secondary">
            Elegí el despacho al que corresponde la muestra. Por defecto se listan los del día.
          </small>
        </div>

        {loading ? (
          <div className="flex justify-content-center py-5">
            <LoadSpinner />
          </div>
        ) : (
          <DataTable
            value={despachos}
            selectionMode="single"
            selection={seleccionado}
            onSelectionChange={(e) => setSeleccionado(e.value)}
            dataKey="idDespacho"
            stripedRows
            responsiveLayout="scroll"
            paginator={despachos.length > 8}
            rows={8}
            emptyMessage="No hay despachos para esta fecha"
            className="w-full"
          >
            <Column field="hora" header="Hora" body={horaTpl} style={{ minWidth: "5rem" }} />
            <Column header="Cliente" body={clienteTpl} style={{ minWidth: "10rem" }} />
            <Column header="Obra" body={obraTpl} style={{ minWidth: "9rem" }} />
            <Column header="Dosificación" body={dosifTpl} style={{ minWidth: "11rem" }} />
            <Column header="Volumen" body={volumenTpl} style={{ minWidth: "7rem" }} />
            <Column header="Remito" body={remitoTpl} style={{ minWidth: "7rem" }} />
            <Column header="Estado" body={estadoTpl} style={{ minWidth: "8rem" }} />
          </DataTable>
        )}
      </div>
    </Dialog>
  );
};

export default DespachoSelectorDialog;
