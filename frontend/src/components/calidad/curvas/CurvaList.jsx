import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { Dialog } from "primereact/dialog";
import { confirmDialog } from "primereact/confirmdialog";
import { FileUpload } from "primereact/fileupload";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";

const TIPO_OPTIONS = [
  { label: "Todas", value: "todas" },
  { label: "Teóricas", value: "TEORICA" },
  { label: "Bandas", value: "BANDA" },
  { label: "Tabuladas", value: "TABULADA" },
];

const USO_OPTIONS = [
  { label: "Todos", value: null },
  { label: "Fino", value: "FINO" },
  { label: "Grueso", value: "GRUESO" },
  { label: "Total", value: "TOTAL" },
];

const TMN_OPTIONS = [
  { label: "Todos", value: null },
  { label: "2.36 mm", value: 2.36 },
  { label: "4.75 mm", value: 4.75 },
  { label: "9.5 mm", value: 9.5 },
  { label: "12.5 mm", value: 12.5 },
  { label: "13.2 mm", value: 13.2 },
  { label: "19 mm", value: 19 },
  { label: "25 mm", value: 25 },
  { label: "26.5 mm", value: 26.5 },
  { label: "37.5 mm", value: 37.5 },
  { label: "50 mm", value: 50 },
  { label: "53 mm", value: 53 },
];

const CURVA_LETTER_OPTIONS = [
  { label: "Todas", value: null },
  { label: "Curva A", value: "A" },
  { label: "Curva B", value: "B" },
  { label: "Curva C", value: "C" },
];

const TIPO_SEVERITY = {
  TEORICA: "info",
  BANDA: "warning",
  TABULADA: "success",
};

const TIPO_ICON = {
  TEORICA: "fa-solid fa-square-root-variable",
  BANDA: "fa-solid fa-arrows-up-down",
  TABULADA: "fa-solid fa-table",
};

const CurvaList = () => {
  const [curvas, setCurvas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("todas");
  const [usoFiltro, setUsoFiltro] = useState(null);
  const [tmnFiltro, setTmnFiltro] = useState(null);
  const [curvaLetterFiltro, setCurvaLetterFiltro] = useState(null);
  const [first, setFirst] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  // ASTM import state removed — ASTM curves hidden from UI
  const [selectedCurvas, setSelectedCurvas] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [showJsonImportDialog, setShowJsonImportDialog] = useState(false);
  const [jsonImportResult, setJsonImportResult] = useState(null);
  const fileUploadRef = useRef(null);
  const deletingRef = useRef(false);
  const importingRef = useRef(false);
  const importingJsonRef = useRef(false);

  const navigate = useNavigate();
  const showToast = useToast();

  const fetchCurvas = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (tipoFiltro !== "todas") params.tipo = tipoFiltro;
      if (usoFiltro) params.uso = usoFiltro;
      if (tmnFiltro) params.tmnMm = tmnFiltro;
      if (curvaLetterFiltro) params.curveLetter = curvaLetterFiltro;
      const res = await axios.get(`${config.backendUrl}/api/curvas-granulometricas`, {
        headers: config.headers,
        params,
      });
      setCurvas(res.data || []);
    } catch (err) {
      console.error("Error al obtener curvas:", err);
      showToast("error", "Error al obtener curvas");
    } finally {
      setLoading(false);
    }
  }, [tipoFiltro, usoFiltro, tmnFiltro, curvaLetterFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCurvas();
  }, [fetchCurvas]);

  const confirmarBorrado = (curva) => {
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: "2.6rem", color: "var(--lightred)" }} />
          <span>
            ¿Eliminar la curva <b>{curva.nombre}</b>?
          </span>
          <small className="mt-2 text-500">Esto no se puede deshacer. Se borrarán también sus puntos.</small>
        </div>
      ),
      header: "Eliminar curva",
      defaultFocus: "accept",
      acceptLabel: "Eliminar",
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: () => borrarCurva(curva),
    });
  };

  const borrarCurva = async (curva) => {
    if (deletingRef.current) return;
    try {
      deletingRef.current = true;
      const res = await axios.delete(`${config.backendUrl}/api/curvas-granulometricas/${curva.idCurva}`, {
        headers: config.headers,
      });
      setCurvas((prev) => prev.filter((c) => c.idCurva !== curva.idCurva));
      showToast("success", res.data?.message || "Curva eliminada");
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || err.response?.data?.message || "Error al eliminar la curva";
      showToast("error", msg);
    } finally {
      deletingRef.current = false;
    }
  };

  const handleImportIRAM1627 = async () => {
    if (importingRef.current) return;
    try {
      importingRef.current = true;
      setImporting(true);
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/import/iram1627`,
        {},
        { headers: config.headers }
      );
      setImportResult(res.data);
      setShowImportDialog(true);
      showToast("success", `Importación completada: ${res.data.curvasCreated} creadas, ${res.data.curvasUpdated} actualizadas`);
      fetchCurvas();
    } catch (err) {
      console.error("Error al importar IRAM 1627:", err);
      const msg = err.response?.data?.error || err.response?.data?.message || "Error al importar";
      showToast("error", msg);
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  // handleImportASTMC33 removed — ASTM import hidden from UI

  const handleExportSelected = async () => {
    if (selectedCurvas.length === 0) {
      showToast("warn", "Seleccioná al menos una curva para exportar");
      return;
    }
    try {
      setExporting(true);
      const ids = selectedCurvas.map((c) => c.idCurva);
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/export`,
        { ids },
        { headers: config.headers }
      );
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `curvas-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", `${res.data._count} curvas exportadas`);
      setSelectedCurvas([]);
    } catch (err) {
      console.error("Error al exportar:", err);
      showToast("error", err.response?.data?.error || "Error al exportar curvas");
    } finally {
      setExporting(false);
    }
  };

  const handleExportAll = async () => {
    try {
      setExporting(true);
      const ids = curvas.map((c) => c.idCurva);
      if (ids.length === 0) {
        showToast("warn", "No hay curvas para exportar");
        return;
      }
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/export`,
        { ids },
        { headers: config.headers }
      );
      const paquete = {
        tipo: "curvas_granulometricas",
        version_formato: "1.0",
        fecha_exportacion: new Date().toISOString(),
        cantidad: res.data._count || ids.length,
        ...res.data,
      };
      const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `curvas_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("success", `${paquete.cantidad} curvas exportadas`);
    } catch (err) {
      console.error("Error al exportar:", err);
      showToast("error", err.response?.data?.error || "Error al exportar curvas");
    } finally {
      setExporting(false);
    }
  };

  const handleJsonImport = async (event) => {
    const file = event.files?.[0];
    if (!file) return;
    if (importingJsonRef.current) return;
    try {
      importingJsonRef.current = true;
      setImportingJson(true);
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload.curvas || !Array.isArray(payload.curvas)) {
        showToast("error", "Archivo inválido: se esperaba { curvas: [...] }");
        return;
      }
      const res = await axios.post(
        `${config.backendUrl}/api/curvas-granulometricas/import/json`,
        payload,
        { headers: config.headers }
      );
      setJsonImportResult(res.data);
      setShowJsonImportDialog(true);
      showToast("success", `Importación completada: ${res.data.curvasCreated} creadas, ${res.data.curvasUpdated} actualizadas`);
      fetchCurvas();
    } catch (err) {
      console.error("Error al importar JSON:", err);
      if (err instanceof SyntaxError) {
        showToast("error", "El archivo no es un JSON válido");
      } else {
        showToast("error", err.response?.data?.message || err.response?.data?.error || "Error al importar");
      }
    } finally {
      importingJsonRef.current = false;
      setImportingJson(false);
      if (fileUploadRef.current) fileUploadRef.current.clear();
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return curvas.filter((c) =>
      (c.nombre || "").toLowerCase().includes(term) ||
      (c.normaRef || "").toLowerCase().includes(term) ||
      (c.tipo || "").toLowerCase().includes(term)
    );
  }, [curvas, searchTerm]);

  if (loading && curvas.length === 0) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader
          icon="fa-solid fa-bezier-curve"
          title="Biblioteca de Curvas"
          subtitle="Curvas granulométricas teóricas, bandas y tabuladas"
        />

        <div className="w-full flex flex-column xl:flex-row align-items-start xl:align-items-center justify-content-between mb-3 gap-2">
          <div className="flex align-items-center gap-2 flex-wrap">
            <SelectButton
              value={tipoFiltro}
              options={TIPO_OPTIONS}
              onChange={(e) => { if (e.value) { setTipoFiltro(e.value); setFirst(0); } }}
            />
            <Dropdown
              value={usoFiltro}
              options={USO_OPTIONS}
              onChange={(e) => { setUsoFiltro(e.value); setFirst(0); }}
              placeholder="Uso"
              className="w-8rem"
            />
            <Dropdown
              value={tmnFiltro}
              options={TMN_OPTIONS}
              onChange={(e) => { setTmnFiltro(e.value); setFirst(0); }}
              placeholder="TMN"
              className="w-8rem"
            />
            <Dropdown
              value={curvaLetterFiltro}
              options={CURVA_LETTER_OPTIONS}
              onChange={(e) => { setCurvaLetterFiltro(e.value); setFirst(0); }}
              placeholder="Curva"
              className="w-8rem"
            />
          </div>
          <div className="flex align-items-center gap-2 flex-wrap flex-1">
            <span className="search-bar-wrapper">
              <InputText
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar curva..."
                title="Buscar por nombre o norma de referencia"
                className="search-bar"
              />
            </span>
            {selectedCurvas.length > 0 && (
              <Button
                label={exporting ? "Exportando..." : `Exportar (${selectedCurvas.length})`}
                icon={exporting ? "pi pi-spin pi-spinner" : "fa-solid fa-file-export"}
                severity="help"
                size="small"
                outlined
                rounded
                disabled={exporting}
                onClick={handleExportSelected}
                tooltip="Exportar curvas seleccionadas a JSON"
                tooltipOptions={{ position: "bottom" }}
              />
            )}
            <Button
              label={exporting ? "Exportando..." : "Exportar paquete"}
              icon={exporting ? "pi pi-spin pi-spinner" : "fa-solid fa-file-export"}
              severity="secondary"
              size="small"
              outlined
              rounded
              disabled={exporting || curvas.length === 0}
              onClick={handleExportAll}
              tooltip="Exportar todas las curvas a un paquete JSON"
              tooltipOptions={{ position: "bottom" }}
            />
            <FileUpload
              ref={fileUploadRef}
              mode="basic"
              accept=".json"
              maxFileSize={10000000}
              auto
              chooseLabel={importingJson ? "Importando..." : "Importar paquete"}
              chooseOptions={{
                icon: importingJson ? "pi pi-spin pi-spinner" : "fa-solid fa-file-arrow-up",
                className: "p-button-outlined p-button-rounded p-button-sm p-button-warning",
              }}
              disabled={importingJson}
              customUpload
              uploadHandler={handleJsonImport}
            />
            <Button
              label={importing ? "Importando..." : "Importar IRAM 1627"}
              icon={importing ? "pi pi-spin pi-spinner" : "fa-solid fa-file-import"}
              severity="info"
              size="small"
              outlined
              rounded
              disabled={importing}
              onClick={handleImportIRAM1627}
              tooltip="Carga todas las tablas IRAM 1627:1997 (Finos, Gruesos, Totales)"
              tooltipOptions={{ position: "bottom" }}
            />
            {/* ASTM C33 import button removed — ASTM hidden from UI */}
            <Button
              label="Nueva curva"
              rounded
              icon="fa-solid fa-plus"
              severity="success"
              size="small"
              onClick={() => navigate("/calidad/catalogos/curvas/nueva")}
            />
          </div>
        </div>

        {filtered.length > 0 ? (
          <DataTable responsiveLayout="scroll"
            value={filtered}
            emptyMessage={<h3>No hay coincidencias</h3>}
            stripedRows
            paginator
            rows={25}
            first={first}
            onPage={(e) => setFirst(e.first)}
            className="w-full"
            selection={selectedCurvas}
            onSelectionChange={(e) => setSelectedCurvas(e.value)}
            dataKey="idCurva"
          >
            <Column selectionMode="multiple" headerStyle={{ width: "3rem" }} />
            <Column
              field="nombre"
              header="Nombre"
              sortable
              body={(c) => (
                <span
                  className="font-bold hover-blue cursor-pointer"
                  onClick={() => navigate(`/calidad/catalogos/curvas/editar/${c.idCurva}`)}
                >
                  {c.nombre}
                </span>
              )}
            />
            <Column
              field="tipo"
              header="Tipo"
              sortable
              style={{ width: "130px" }}
              body={(c) => (
                <Tag
                  value={c.tipo}
                  severity={TIPO_SEVERITY[c.tipo] || "secondary"}
                  icon={TIPO_ICON[c.tipo]}
                  className="text-xs"
                />
              )}
            />
            <Column
              field="serieTamices"
              header="Serie"
              sortable
              style={{ width: "90px" }}
              body={(c) => <span className="text-sm">{c.serieTamices}</span>}
            />
            <Column
              field="uso"
              header="Uso"
              sortable
              style={{ width: "90px" }}
              body={(c) =>
                c.uso ? (
                  <Tag
                    value={c.uso}
                    severity={c.uso === "FINO" ? "info" : c.uso === "GRUESO" ? "warning" : "success"}
                    className="text-xs"
                  />
                ) : <span className="text-xs text-400">—</span>
              }
            />
            <Column
              field="tmnMm"
              header="TMN"
              sortable
              style={{ width: "80px" }}
              body={(c) => (
                <span className="text-sm">{c.tmnMm ? `${c.tmnMm} mm` : "—"}</span>
              )}
            />
            <Column
              field="normaRef"
              header="Norma / Ref."
              sortable
              body={(c) => <span className="text-sm">{c.normaRef || "—"}</span>}
            />
            <Column
              field="estadoDatos"
              header="Estado"
              sortable
              style={{ width: "100px" }}
              body={(c) =>
                c.estadoDatos ? (
                  <Tag
                    value={c.estadoDatos}
                    severity={c.estadoDatos === "COMPLETO" ? "success" : "warning"}
                    className="text-xs"
                  />
                ) : null
              }
            />
            <Column
              header="Set"
              style={{ width: "90px" }}
              body={(c) =>
                c.set ? (
                  <Tag
                    value={c.set.materialUso || "Set"}
                    severity="help"
                    className="text-xs cursor-pointer"
                    onClick={() => navigate(`/calidad/catalogos/curvas/set/${c.set.idCurvaSet}`)}
                    style={{ cursor: "pointer" }}
                  />
                ) : null
              }
            />
            <Column
              header="Curva"
              style={{ width: "70px" }}
              body={(c) =>
                c.curveLetter ? (
                  <Tag value={c.curveLetter} severity="help" className="text-xs" />
                ) : null
              }
            />
            <Column
              header="Puntos"
              style={{ width: "80px" }}
              body={(c) => {
                const n = c.tipo === "TEORICA"
                  ? (c.puntosCalculados || []).length
                  : (c.puntos || []).length;
                return <span className="text-sm">{n}</span>;
              }}
            />
            <Column
              header="Default"
              style={{ width: "80px" }}
              body={(c) =>
                c.isDefault ? (
                  <i className="fa-solid fa-star text-yellow-500" title="Por defecto" />
                ) : null
              }
            />
            <Column
              header=""
              style={{ width: "120px" }}
              body={(c) => (
                <div className="flex gap-1">
                  <Button
                    icon="fa-solid fa-pencil"
                    rounded
                    text
                    size="small"
                    tooltip="Editar"
                    tooltipOptions={{ position: "left" }}
                    onClick={() => navigate(`/calidad/catalogos/curvas/editar/${c.idCurva}`)}
                  />
                  <Button
                    icon="fa-solid fa-trash"
                    rounded
                    text
                    severity="danger"
                    size="small"
                    tooltip="Eliminar"
                    tooltipOptions={{ position: "left" }}
                    onClick={() => confirmarBorrado(c)}
                  />
                </div>
              )}
            />
          </DataTable>
        ) : (
          !loading && (
            <div className="form-card br-15 flex p-4 xl:p-6 align-items-center justify-content-center flex-column align-self-start w-full">
              <h2 className="text-center mb-3 mt-0">No hay curvas cargadas en la biblioteca</h2>
              <div className="text-sm text-color-secondary text-left" style={{ maxWidth: "32rem" }}>
                <p className="mt-0 mb-2">Para comenzar:</p>
                <ul className="mt-0 mb-0 pl-4 line-height-3">
                  <li>Importe las bandas <strong>IRAM 1627</strong> usando el botón de importación de arriba.</li>
                  <li>Genere curvas teóricas (Fuller, Andreasen, etc.) con el botón <strong>+ Nueva curva</strong>.</li>
                  <li>Cargue curvas tabuladas manualmente.</li>
                </ul>
              </div>
            </div>
          )
        )}
      </div>

      {/* Dialog resultado importación IRAM 1627 */}
      <Dialog
        header="Resultado — Importación IRAM 1627:1997"
        visible={showImportDialog}
        onHide={() => setShowImportDialog(false)}
        style={{ width: "90vw", maxWidth: "500px" }}
      >
        {importResult && (
          <div className="flex flex-column gap-3">
            <div className="flex align-items-center gap-3 flex-wrap">
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Curvas creadas</span>
                <span className="text-2xl font-bold text-green-500">{importResult.curvasCreated}</span>
              </div>
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Actualizadas</span>
                <span className="text-2xl font-bold text-orange-500">{importResult.curvasUpdated}</span>
              </div>
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Sets</span>
                <span className="text-2xl font-bold text-blue-500">{importResult.setsCreated + (importResult.setsUpdated || 0)}</span>
              </div>
            </div>
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-circle-check text-green-500" />
              <span className="text-sm">
                {importResult.pointsCreated} puntos procesados
              </span>
            </div>
            {importResult.errors && importResult.errors.length > 0 && (
              <div className="surface-100 border-round p-2">
                <span className="text-sm text-red-500 font-bold">Errores:</span>
                {importResult.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-400 mt-1">{e}</div>
                ))}
              </div>
            )}
            <div className="text-xs text-400">
              Finos: 3 curvas (A/B/C) · Gruesos: 7 rangos · Totales: 18 curvas en 6 sets
            </div>
          </div>
        )}
      </Dialog>

      {/* ASTM C33 import dialog removed — ASTM hidden from UI */}

      {/* Dialog resultado importación JSON */}
      <Dialog
        header="Resultado — Importación JSON"
        visible={showJsonImportDialog}
        onHide={() => setShowJsonImportDialog(false)}
        style={{ width: "90vw", maxWidth: "500px" }}
      >
        {jsonImportResult && (
          <div className="flex flex-column gap-3">
            <div className="flex align-items-center gap-3 flex-wrap">
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Curvas creadas</span>
                <span className="text-2xl font-bold text-green-500">{jsonImportResult.curvasCreated}</span>
              </div>
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Actualizadas</span>
                <span className="text-2xl font-bold text-orange-500">{jsonImportResult.curvasUpdated}</span>
              </div>
              <div className="flex flex-column align-items-center surface-100 border-round p-3 flex-1">
                <span className="text-xs text-500 mb-1">Puntos</span>
                <span className="text-2xl font-bold text-blue-500">{jsonImportResult.pointsCreated}</span>
              </div>
            </div>
            {jsonImportResult.errors && jsonImportResult.errors.length > 0 && (
              <div className="surface-100 border-round p-2">
                <span className="text-sm text-red-500 font-bold">Errores:</span>
                {jsonImportResult.errors.map((e, i) => (
                  <div key={i} className="text-xs text-red-400 mt-1">{e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </Fade>
  );
};

export default CurvaList;
