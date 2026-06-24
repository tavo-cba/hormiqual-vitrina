import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { Checkbox } from "primereact/checkbox";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
  getDosificaciones,
  eliminarDosificacion,
  transicionarEstado,
  crearNuevaVersion,
  obtenerVersiones,
  obtenerHistorial,
} from "../../../services/dosificacionDisenoService";
import DisenoHistorialTimeline from "./DisenoHistorialTimeline";
import { generarDosificacionesListadoPdf } from "./dosificacionesListadoPdf";

const METODO_LABELS = { HORMIQUAL: "HormiQual", ICPA: "HormiQual", ACI_211: "HormiQual" };
const METODO_SEV = { HORMIQUAL: "info", ICPA: "info", ACI_211: "info" };

const ESTADO_LABELS = {
  BORRADOR: "Borrador",
  A_PRUEBA: "A prueba",
  PENDIENTE_REVISION: "Pendiente revisión",
  APROBADO: "Aprobado",
  SUSPENDIDO: "Suspendido",
  ARCHIVADO: "Archivado",
  // Legacy
  VALIDADO: "Aprobado",
  EN_PRODUCCION: "Aprobado",
  OBSOLETO: "Archivado",
};

const ESTADO_SEV = {
  BORRADOR: "info",
  A_PRUEBA: "warning",
  PENDIENTE_REVISION: "warning",
  APROBADO: "success",
  SUSPENDIDO: "danger",
  ARCHIVADO: "secondary",
  VALIDADO: "success",
  EN_PRODUCCION: "success",
  OBSOLETO: "secondary",
};

const ESTADO_ICON = {
  BORRADOR: "fa-solid fa-pencil",
  A_PRUEBA: "fa-solid fa-flask",
  PENDIENTE_REVISION: "fa-solid fa-clock",
  APROBADO: "fa-solid fa-check",
  SUSPENDIDO: "fa-solid fa-pause",
  ARCHIVADO: "fa-solid fa-archive",
};

const ESTADO_FILTER_OPTIONS = [
  { label: "Todos", value: "TODOS" },
  { label: "Borrador", value: "BORRADOR" },
  { label: "A prueba", value: "A_PRUEBA" },
  { label: "Pendiente revisión", value: "PENDIENTE_REVISION" },
  { label: "Aprobado", value: "APROBADO" },
  { label: "Suspendido", value: "SUSPENDIDO" },
  { label: "Archivado", value: "ARCHIVADO" },
];

const DosificacionesCatalogoPage = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const cfg = useConfig();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("TODOS");
  const [plantaFilter, setPlantaFilter] = useState("TODAS");
  const [first, setFirst] = useState(0);

  // Versiones dialog
  const [versionesDialog, setVersionesDialog] = useState(false);
  const [versiones, setVersiones] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [versionesLoading, setVersionesLoading] = useState(false);
  const [selectedDosifName, setSelectedDosifName] = useState("");
  const deletingRef = useRef(false);
  const transitioningRef = useRef(false);
  const versioningRef = useRef(false);
  const [transitioning, setTransitioning] = useState(false);

  // Comparison selection (FUNC-03)
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Transition dialog (for motivo input)
  const [transicionDialog, setTransicionDialog] = useState(null); // { id, nuevoEstado, label }
  const [motivoTexto, setMotivoTexto] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDosificaciones();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      toast("error", "No se pudieron cargar las dosificaciones");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Eliminar ── */
  const handleDelete = (row) => {
    if (row.estado !== "BORRADOR") {
      toast("warn", "Solo se pueden eliminar borradores.");
      return;
    }
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: "2.6rem", color: "var(--lightred)" }} />
          <span>¿Eliminar el borrador <b>{row.nombre || `#${row.id}`}</b>?</span>
          <small className="mt-2 text-color-secondary">Esta acción se puede revertir contactando al administrador del sistema.</small>
        </div>
      ),
      header: "Eliminar borrador",
      defaultFocus: "reject",
      acceptLabel: "Eliminar",
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: async () => {
        if (deletingRef.current) return;
        try {
          deletingRef.current = true;
          await eliminarDosificacion(row.id);
          toast("success", "Dosificación eliminada");
          fetchAll();
        } catch (err) {
          console.error(err);
          const msg = err.response?.data?.error || "No se pudo eliminar";
          toast("error", msg);
        } finally {
          deletingRef.current = false;
        }
      },
    });
  };

  /* ── Transiciones de estado ── */
  const handleTransicion = async (id, nuevoEstado, motivo) => {
    if (transitioningRef.current) return;
    try {
      transitioningRef.current = true;
      setTransitioning(true);
      await transicionarEstado(id, { nuevoEstado, motivo });
      toast("success", `Estado actualizado: ${ESTADO_LABELS[nuevoEstado]}`);
      fetchAll();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.error || "No se pudo cambiar el estado";
      toast("error", msg);
    } finally {
      transitioningRef.current = false;
      setTransitioning(false);
    }
  };

  const handleTransicionConMotivo = (id, nuevoEstado, label) => {
    setTransicionDialog({ id, nuevoEstado, label });
    setMotivoTexto("");
  };

  const MOTIVO_OBLIGATORIO = new Set(["SUSPENDIDO", "ARCHIVADO", "BORRADOR"]); // BORRADOR from PENDIENTE_REVISION = rechazar

  const confirmTransicion = async () => {
    if (!transicionDialog) return;
    await handleTransicion(transicionDialog.id, transicionDialog.nuevoEstado, motivoTexto || null);
    setTransicionDialog(null);
  };

  const motivoRequerido = transicionDialog && MOTIVO_OBLIGATORIO.has(transicionDialog.nuevoEstado);

  /* ── Nueva versión ── */
  const handleNuevaVersion = (row) => {
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center">
          <i className="fa-solid fa-code-branch mb-3" style={{ fontSize: "2.4rem", color: "var(--primary-color)" }} />
          <span>Este diseño está <b>{ESTADO_LABELS[row.estado]}</b> y no puede modificarse directamente.</span>
          <span className="mt-2">¿Desea crear una nueva versión (v{(row.version || 1) + 1}) como borrador?</span>
          <small className="mt-2 text-color-secondary">La versión actual se mantiene sin cambios.</small>
        </div>
      ),
      header: "Crear nueva versión",
      acceptLabel: "Crear nueva versión",
      rejectLabel: "Cancelar",
      accept: async () => {
        if (versioningRef.current) return;
        try {
          versioningRef.current = true;
          const newRow = await crearNuevaVersion(row.id);
          toast("success", `Versión v${newRow.version} creada como borrador`);
          // Usar query param `?load=` además de state — más robusto: sobrevive
          // a hard refresh, bookmarks y al re-render que limpia location.state.
          navigate(`/calidad/dosificacion-diseno?load=${newRow.id}`, { state: { loadDosificacionId: newRow.id } });
        } catch (err) {
          console.error(err);
          const msg = err.response?.data?.error || "No se pudo crear la nueva versión";
          toast("error", msg);
        } finally {
          versioningRef.current = false;
        }
      },
    });
  };

  /* ── Ver versiones ── */
  const handleVerVersiones = async (row) => {
    setVersionesLoading(true);
    setSelectedDosifName(row.nombre || `#${row.id}`);
    setVersionesDialog(true);
    try {
      const [vers, hist] = await Promise.all([
        obtenerVersiones(row.id),
        obtenerHistorial(row.id),
      ]);
      setVersiones(vers || []);
      setHistorial(hist || []);
    } catch (err) {
      console.error(err);
    } finally {
      setVersionesLoading(false);
    }
  };

  /* ── Opciones de planta (derivadas de las dosificaciones cargadas) ── */
  const plantaOptions = useMemo(() => {
    const byId = new Map();
    rows.forEach((r) => {
      const p = r.planta;
      if (p?.idPlanta != null && !byId.has(p.idPlanta)) {
        byId.set(p.idPlanta, { label: p.nombre || `Planta ${p.idPlanta}`, value: p.idPlanta });
      }
    });
    const plantas = Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label, "es-AR"));
    return [{ label: "Todas", value: "TODAS" }, ...plantas];
  }, [rows]);

  /* ── Filtro ── */
  const filtered = rows.filter((r) => {
    // Planta filter
    if (plantaFilter !== "TODAS" && r.planta?.idPlanta !== plantaFilter) return false;

    // Estado filter (default: hide obsoletos)
    if (estadoFilter !== "TODOS" && r.estado !== estadoFilter) return false;
    if (estadoFilter === "TODOS" && r.estado === "ARCHIVADO") return false;

    if (!searchTerm) return true;
    const lc = searchTerm.toLowerCase();
    return (
      (r.nombre || "").toLowerCase().includes(lc) ||
      (r.descripcion || "").toLowerCase().includes(lc) ||
      (r.metodo || "").toLowerCase().includes(lc) ||
      (r.estado || "").toLowerCase().includes(lc) ||
      (r.planta?.nombre || "").toLowerCase().includes(lc) ||
      (r.cemento?.nombreComercial || "").toLowerCase().includes(lc) ||
      (r.mezcla?.nombre || "").toLowerCase().includes(lc)
    );
  });

  /* ── Comparison selection ── */
  const toggleCompareSelection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 4) {
          toast("warn", "Solo se pueden comparar hasta 4 dosificaciones.");
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const handleCompare = () => {
    const ids = Array.from(selectedIds);
    navigate("/calidad/dosificaciones-comparar", { state: { dosificacionIds: ids } });
  };

  /* ── Exportar listado a PDF (respeta los filtros aplicados) ── */
  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const plantaLabel =
        plantaFilter === "TODAS"
          ? "Todas"
          : (plantaOptions.find((p) => p.value === plantaFilter)?.label || "—");
      // Con "Todos" la grilla oculta los Archivados (ver `filtered`), así que el
      // PDF lo aclara para que el total al pie no parezca incompleto.
      const estadoLabel =
        estadoFilter === "TODOS"
          ? "Todos (excepto Archivado)"
          : (ESTADO_FILTER_OPTIONS.find((e) => e.value === estadoFilter)?.label || "Todos");
      await generarDosificacionesListadoPdf(filtered, {
        configEmpresa: {
          nombreEmpresa: cfg?.nombreEmpresa,
          direccion: cfg?.direccion,
          logoLink: cfg?.logoLink || cfg?.logoLightLink || null,
          thumbnail: cfg?.thumbnail,
        },
        filtros: {
          planta: plantaLabel,
          estado: estadoLabel,
          busqueda: searchTerm,
        },
      });
    } catch (err) {
      console.error("Error exportando listado de dosificaciones:", err);
      toast("error", "No se pudo generar el PDF");
    } finally {
      setExporting(false);
    }
  };

  /* ── Column bodies ── */
  const nombreBody = (row) => (
    <span
      className="font-bold cursor-pointer hover:underline"
      style={{ color: "var(--primary-color)" }}
      onClick={() => navigate("/calidad/dosificacion-diseno", { state: { loadDosificacionId: row.id, viewMode: true } })}
    >
      {row.nombre || `Diseño #${row.id}`}
    </span>
  );
  const plantaBody = (row) => row.planta?.nombre || "—";
  const metodoBody = (row) => (
    <Tag value={METODO_LABELS[row.metodo] || row.metodo} severity={METODO_SEV[row.metodo] || "secondary"} />
  );
  const estadoBody = (row) => {
    const label = ESTADO_LABELS[row.estado] || row.estado;
    const sev = ESTADO_SEV[row.estado] || "secondary";
    const icon = ESTADO_ICON[row.estado];
    return (
      <div className="flex align-items-center gap-1 flex-wrap">
        <Tag value={label} severity={sev} icon={icon} />
        {row.recetaCount > 0 && (
          <Tag
            value={`${row.recetaCount} receta${row.recetaCount > 1 ? 's' : ''}`}
            icon="fa-solid fa-link"
            severity="warning"
            className="text-xs"
            title={`Vinculada a ${row.recetaCount} receta(s) de obra — no se puede eliminar`}
          />
        )}
      </div>
    );
  };
  const versionBody = (row) => (
    <span
      className="cursor-pointer hover:underline text-color-secondary"
      onClick={() => handleVerVersiones(row)}
      title="Ver historial de versiones"
    >
      v{row.version || 1}
    </span>
  );
  const cementoBody = (row) => row.cemento?.nombreComercial || "—";
  const mezclaBody = (row) => row.mezcla?.nombre || "—";
  const fechaBody = (row) => row.updatedAt ? new Date(row.updatedAt).toLocaleDateString("es-AR") : "—";

  const accionesBody = (row) => {
    const estado = row.estado;
    return (
      <div className="flex gap-1 flex-wrap">
        {/* View */}
        <Button
          icon="fa-solid fa-eye"
          rounded text size="small"
          tooltip="Ver diseño"
          tooltipOptions={{ position: "top" }}
          onClick={() => navigate("/calidad/dosificacion-diseno", { state: { loadDosificacionId: row.id, viewMode: true } })}
        />
        {/* Edit (only for editable states) */}
        {(estado === "BORRADOR" || estado === "A_PRUEBA") && (
          <Button
            icon="fa-solid fa-pen-to-square"
            rounded text size="small"
            tooltip="Editar"
            tooltipOptions={{ position: "top" }}
            onClick={() => navigate("/calidad/dosificacion-diseno", { state: { loadDosificacionId: row.id } })}
          />
        )}

        {/* Duplicar (todos los estados): copia parámetros y materiales al
            diseñador como un diseño nuevo independiente. No traza la
            relación con la original — útil para variar H-21 → H-20, etc. */}
        <Button
          icon="fa-solid fa-clone"
          rounded text size="small"
          tooltip="Duplicar como nuevo diseño"
          tooltipOptions={{ position: "top" }}
          onClick={() => navigate("/calidad/dosificacion-diseno", { state: { duplicateDosificacionId: row.id } })}
        />

        {/* Enviar a prueba (from BORRADOR) */}
        {estado === "BORRADOR" && (
          <Button
            icon="fa-solid fa-flask"
            rounded text size="small"
            severity="warning"
            tooltip="Enviar a prueba"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.id, "A_PRUEBA")}
          />
        )}

        {/* Enviar a revisión (from BORRADOR or A_PRUEBA) */}
        {(estado === "BORRADOR" || estado === "A_PRUEBA") && (
          <Button
            icon="fa-solid fa-paper-plane"
            rounded text size="small"
            tooltip="Enviar a revisión"
            tooltipOptions={{ position: "top" }}
            style={{ color: "#e67e22" }}
            onClick={() => handleTransicion(row.id, "PENDIENTE_REVISION")}
          />
        )}

        {/* Aprobar (from PENDIENTE_REVISION) */}
        {estado === "PENDIENTE_REVISION" && (
          <Button
            icon="fa-solid fa-check"
            rounded text size="small"
            severity="success"
            tooltip="Aprobar"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.id, "APROBADO")}
          />
        )}

        {/* Rechazar (from PENDIENTE_REVISION → BORRADOR) */}
        {estado === "PENDIENTE_REVISION" && (
          <Button
            icon="fa-solid fa-times"
            rounded text size="small"
            severity="danger"
            tooltip="Rechazar (a borrador)"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.id, "BORRADOR", "Rechazar dosificación")}
          />
        )}

        {/* Nueva versión (from APROBADO or SUSPENDIDO) */}
        {(estado === "APROBADO" || estado === "SUSPENDIDO") && (
          <Button
            icon="fa-solid fa-code-branch"
            rounded text size="small"
            tooltip="Crear nueva versión"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleNuevaVersion(row)}
          />
        )}

        {/* Suspender (from APROBADO) */}
        {estado === "APROBADO" && (
          <Button
            icon="fa-solid fa-pause"
            rounded text size="small"
            severity="danger"
            tooltip="Suspender"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.id, "SUSPENDIDO", "Suspender dosificación")}
          />
        )}

        {/* Reactivar (from SUSPENDIDO → APROBADO) */}
        {estado === "SUSPENDIDO" && (
          <Button
            icon="fa-solid fa-play"
            rounded text size="small"
            severity="success"
            tooltip="Reactivar (aprobar)"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.id, "APROBADO")}
          />
        )}

        {/* Archivar (from APROBADO or SUSPENDIDO) */}
        {(estado === "APROBADO" || estado === "SUSPENDIDO") && (
          <Button
            icon="fa-solid fa-archive"
            rounded text size="small"
            severity="secondary"
            tooltip="Archivar"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.id, "ARCHIVADO", "Archivar dosificación")}
          />
        )}

        {/* Delete (only BORRADOR) */}
        {estado === "BORRADOR" && (
          <Button
            icon="fa-solid fa-trash"
            rounded text size="small"
            severity="danger"
            tooltip={row.recetaCount > 0 ? `No se puede eliminar: tiene ${row.recetaCount} receta(s) vinculada(s)` : "Eliminar"}
            tooltipOptions={{ position: "top" }}
            disabled={row.recetaCount > 0}
            onClick={() => handleDelete(row)}
          />
        )}
      </div>
    );
  };

  if (loading) return <LoadSpinner />;

  return (
    <div>
      <PageHeader title="Dosificaciones guardadas" icon="fa-solid fa-calculator" />

      <div className="flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="flex gap-2 align-items-center flex-wrap flex-1">
          <span className="p-input-icon-left search-bar-wrapper">
            <i className="pi pi-search" />
            <InputText
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setFirst(0); }}
              placeholder="Buscar dosificación..."
              title="Buscar por nombre, código o planta"
              className="search-bar"
            />
          </span>
          <Dropdown
            value={estadoFilter}
            options={ESTADO_FILTER_OPTIONS}
            onChange={(e) => { setEstadoFilter(e.value); setFirst(0); }}
            placeholder="Estado"
            style={{ minWidth: "160px" }}
          />
          {plantaOptions.length > 2 && (
            <SelectButton
              value={plantaFilter}
              options={plantaOptions}
              onChange={(e) => { if (e.value != null) { setPlantaFilter(e.value); setFirst(0); } }}
              allowEmpty={false}
            />
          )}
        </div>
        <div className="flex gap-2 align-items-center flex-wrap">
          <Button
            label="Imprimir listado"
            icon="fa-solid fa-file-pdf"
            className="p-button-outlined"
            severity="danger"
            onClick={handleExportPDF}
            disabled={filtered.length === 0 || exporting}
            loading={exporting}
            tooltip="Exportar a PDF el listado con los filtros aplicados"
            tooltipOptions={{ position: "top" }}
          />
          <Button
            label="Nuevo diseño"
            icon="fa-solid fa-plus"
            className="p-button-outlined"
            onClick={() => navigate("/calidad/dosificacion-diseno")}
          />
        </div>
      </div>

      <DataTable responsiveLayout="scroll"
        value={filtered}
        paginator
        rows={15}
        first={first}
        onPage={(e) => setFirst(e.first)}
        emptyMessage="No se encontraron dosificaciones."
        sortField="updatedAt"
        sortOrder={-1}
        rowHover
        stripedRows
        size="small"
      >
        <Column
          header=""
          style={{ width: "40px" }}
          body={(row) => (
            <Checkbox
              checked={selectedIds.has(row.id)}
              onChange={() => toggleCompareSelection(row.id)}
              tooltip="Seleccionar para comparar"
              tooltipOptions={{ position: "top" }}
            />
          )}
        />
        <Column field="nombre" header="Nombre" body={nombreBody} sortable style={{ minWidth: "160px" }} />
        <Column header="Planta" body={plantaBody} sortable sortField="planta.nombre" style={{ minWidth: "120px" }} />
        <Column field="metodo" header="Método" body={metodoBody} sortable style={{ width: "100px" }} />
        <Column field="estado" header="Estado" body={estadoBody} sortable style={{ minWidth: "170px" }} />
        <Column field="version" header="Versión" body={versionBody} sortable style={{ width: "80px" }} />
        <Column header="Cemento" body={cementoBody} style={{ minWidth: "140px" }} />
        <Column header="Mezcla" body={mezclaBody} style={{ minWidth: "130px" }} />
        <Column field="updatedAt" header="Actualizado" body={fechaBody} sortable style={{ width: "120px" }} />
        <Column header="Acciones" body={accionesBody} style={{ minWidth: "180px" }} />
      </DataTable>

      {/* Motivo dialog for state transitions */}
      <Dialog
        visible={!!transicionDialog}
        onHide={() => setTransicionDialog(null)}
        header={transicionDialog?.label || "Cambiar estado"}
        style={{ width: "90vw", maxWidth: "30rem" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" className="p-button-text" onClick={() => setTransicionDialog(null)} />
            <Button
              label="Confirmar"
              onClick={confirmTransicion}
              loading={transitioning}
              disabled={(motivoRequerido && !motivoTexto.trim()) || transitioning}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3">
          <label className="font-semibold">
            Motivo{motivoRequerido ? " (obligatorio)" : " (opcional)"}:
          </label>
          <InputTextarea
            value={motivoTexto}
            onChange={(e) => setMotivoTexto(e.target.value)}
            rows={3}
            placeholder="Ingrese el motivo del cambio..."
            autoResize
            className={motivoRequerido && !motivoTexto.trim() ? "p-invalid" : ""}
          />
          {motivoRequerido && !motivoTexto.trim() && (
            <small className="p-error">Debe ingresar un motivo para continuar.</small>
          )}
        </div>
      </Dialog>

      {/* Versiones/Historial dialog */}
      <Dialog
        visible={versionesDialog}
        onHide={() => setVersionesDialog(false)}
        header={`Historial — ${selectedDosifName}`}
        style={{ width: "90vw", maxWidth: "50rem" }}
        maximizable
      >
        {versionesLoading ? (
          <LoadSpinner />
        ) : (
          <div className="flex flex-column gap-4">
            <div>
              <h4 className="mb-2">Versiones</h4>
              <DataTable responsiveLayout="scroll" value={versiones} size="small" emptyMessage="Sin versiones." stripedRows>
                <Column
                  header="Versión"
                  body={(r) => (
                    <span
                      className="cursor-pointer hover:underline font-bold"
                      style={{ color: "var(--primary-color)" }}
                      onClick={() => {
                        setVersionesDialog(false);
                        navigate("/calidad/dosificacion-diseno", { state: { loadDosificacionId: r.id } });
                      }}
                    >
                      v{r.version}
                    </span>
                  )}
                  style={{ width: "80px" }}
                />
                <Column header="Código" body={(r) => r.codigo || "—"} style={{ width: "140px" }} />
                <Column field="estado" header="Estado" body={(r) => <Tag value={ESTADO_LABELS[r.estado] || r.estado} severity={ESTADO_SEV[r.estado]} />} style={{ width: "140px" }} />
                <Column header="Hash" body={(r) => r.hashIntegridad ? <span className="font-mono text-sm">{r.hashIntegridad.substring(0, 12)}</span> : "—"} style={{ width: "120px" }} />
                <Column header="Aprobado por" body={(r) => r.aprobadoPor || "—"} />
                <Column header="Fecha aprobación" body={(r) => r.fechaAprobacion ? new Date(r.fechaAprobacion).toLocaleDateString("es-AR") : "—"} />
                <Column header="Creado" body={(r) => r.createdAt ? new Date(r.createdAt).toLocaleDateString("es-AR") : "—"} />
              </DataTable>
            </div>

            <div>
              <h4 className="mb-2">Registro de cambios</h4>
              <DisenoHistorialTimeline historial={historial} />
            </div>
          </div>
        )}
      </Dialog>

      {/* Floating comparison bar (FUNC-03) */}
      {selectedIds.size >= 2 && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            background: "var(--surface-card)",
            borderRadius: "12px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <span className="font-semibold">{selectedIds.size} dosificaciones seleccionadas</span>
          <Button label="Comparar" icon="fa-solid fa-code-compare" className="p-button-sm" onClick={handleCompare} />
          <Button label="Cancelar" className="p-button-text p-button-sm" onClick={() => setSelectedIds(new Set())} />
        </div>
      )}
    </div>
  );
};

export default DosificacionesCatalogoPage;
