import React, { useState, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { FileUpload } from "primereact/fileupload";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { useToast } from "../../../context/ToastContext";
import { importarPrecios } from "../../../services/materialPrecioService";

/**
 * Parse CSV text into rows. Supports pipe-separated or comma-separated.
 * Expected columns: material_nombre | precio_unitario | unidad | fecha_vigencia | incluye_flete | costo_flete
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  // Detect separator (pipe or comma)
  const sep = lines[0].includes("|") ? "|" : ",";
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));

  return lines.slice(1).map((line, idx) => {
    const cols = line.split(sep).map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] || ""; });
    row._lineNum = idx + 2;
    return row;
  });
}

/**
 * Try to match parsed rows against the materiales catalog.
 */
function matchRows(parsedRows, materiales) {
  return parsedRows.map(row => {
    const nombre = (row.material_nombre || row.nombre || "").toLowerCase();
    const match = materiales.find(m => (m.nombre || "").toLowerCase() === nombre);

    // Parse date dd/mm/yyyy or yyyy-mm-dd
    let fechaVigencia = row.fecha_vigencia || "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaVigencia)) {
      const [d, m, y] = fechaVigencia.split("/");
      fechaVigencia = `${y}-${m}-${d}`;
    }

    const incluyeFlete = ["si", "sí", "true", "1", "yes"].includes((row.incluye_flete || "").toLowerCase());

    return {
      _lineNum: row._lineNum,
      _nombreOriginal: row.material_nombre || row.nombre || "",
      _matched: !!match,
      materialSource: match?._source || null,
      materialSourceId: match?._sourceId || null,
      materialNombre: match?.nombre || null,
      precioUnitario: parseFloat((row.precio_unitario || "0").replace(/[^0-9.,]/g, "").replace(",", ".")),
      unidad: row.unidad || "tn",
      fechaVigencia,
      incluyeFlete,
      costoFlete: row.costo_flete ? parseFloat(row.costo_flete.replace(/[^0-9.,]/g, "").replace(",", ".")) : null,
      proveedor: row.proveedor || null,
    };
  });
}

export default function MaterialPrecioImportDialog({ visible, onHide, materiales, onImported }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);

  const handleFileSelect = (e) => {
    const file = e.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsed = parseCSV(text);
      const matched = matchRows(parsed, materiales || []);
      setPreview(matched);
    };
    reader.readAsText(file);

    // Clear fileupload widget
    if (fileRef.current) fileRef.current.clear();
  };

  const matchedCount = preview.filter(r => r._matched).length;
  const unmatchedCount = preview.length - matchedCount;

  const handleImport = async () => {
    if (importingRef.current) return;
    const validItems = preview.filter(r => r._matched && r.precioUnitario > 0);
    if (validItems.length === 0) {
      toast?.current?.show({ severity: "warn", summary: "Sin datos", detail: "No hay precios válidos para importar" });
      return;
    }

    importingRef.current = true;
    setImporting(true);
    try {
      const result = await importarPrecios(validItems);
      toast?.current?.show({ severity: "success", summary: "Importación exitosa", detail: `${result.imported} precios importados` });
      setPreview([]);
      onImported?.();
      onHide();
    } catch (err) {
      console.error(err);
      toast?.current?.show({ severity: "error", summary: "Error", detail: "No se pudo importar" });
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const formatCurrency = (val) => {
    if (val == null || isNaN(val)) return "-";
    return Number(val).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
  };

  return (
    <Dialog
      visible={visible}
      onHide={() => { setPreview([]); onHide(); }}
      header="Importar lista de precios"
      style={{ width: "90vw", maxWidth: "50rem" }}
      modal
      maximizable
    >
      <div className="flex flex-column gap-3">
        <div className="text-sm text-color-secondary">
          Suba un archivo CSV con columnas: <code>material_nombre | precio_unitario | unidad | fecha_vigencia | incluye_flete | costo_flete</code>
          <br />Separado por <code>|</code> o <code>,</code>. Los precios anteriores se marcar&aacute;n como vencidos autom&aacute;ticamente.
        </div>

        <FileUpload
          ref={fileRef}
          mode="basic"
          accept=".csv,.txt"
          maxFileSize={1048576}
          chooseLabel="Seleccionar CSV"
          customUpload
          uploadHandler={handleFileSelect}
          auto
        />

        {preview.length > 0 && (
          <>
            <div className="flex gap-2 align-items-center">
              <Tag value={`${matchedCount} coincidencias`} severity="success" />
              {unmatchedCount > 0 && <Tag value={`${unmatchedCount} sin coincidencia`} severity="danger" />}
            </div>

            <DataTable responsiveLayout="scroll" value={preview} size="small" stripedRows scrollable scrollHeight="300px">
              <Column header="Línea" body={(r) => r._lineNum} style={{ width: "50px" }} />
              <Column header="Nombre original" body={(r) => r._nombreOriginal} style={{ minWidth: "150px" }} />
              <Column
                header="Match"
                body={(r) => r._matched
                  ? <Tag value={r.materialNombre} severity="success" />
                  : <Tag value="No encontrado" severity="danger" />
                }
                style={{ minWidth: "140px" }}
              />
              <Column header="Precio" body={(r) => `${formatCurrency(r.precioUnitario)} /${r.unidad}`} style={{ width: "130px" }} />
              <Column header="Vigencia" body={(r) => r.fechaVigencia || "-"} style={{ width: "100px" }} />
              <Column header="Flete" body={(r) => r.incluyeFlete ? "Incluido" : r.costoFlete ? formatCurrency(r.costoFlete) : "-"} style={{ width: "100px" }} />
            </DataTable>

            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" className="p-button-text p-button-sm" onClick={() => { setPreview([]); onHide(); }} />
              <Button
                label={`Importar ${matchedCount} precios`}
                icon="fa-solid fa-file-import"
                className="p-button-sm"
                onClick={handleImport}
                loading={importing}
                disabled={matchedCount === 0 || importing}
              />
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
