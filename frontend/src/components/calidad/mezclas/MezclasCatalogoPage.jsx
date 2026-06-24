import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { Link, useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
  transicionarEstadoMezcla,
  crearNuevaVersionMezcla,
  obtenerVersionesMezcla,
  obtenerHistorialMezcla,
  verificarIntegridadMezcla,
} from "../../../services/mezclaEstadoService";
import DisenoHistorialTimeline from "../dosificacion-diseno/DisenoHistorialTimeline";

const TIPO_COLORS = { FINO: "info", GRUESO: "warning", TOTAL: "success" };
const MODO_LABELS = { BANDA: "Banda", CURVA: "Curva teórica", COMBINADO: "Combinado" };

const ESTADO_LABELS = {
  BORRADOR: "Borrador", A_PRUEBA: "A prueba", PENDIENTE_REVISION: "Pendiente revisión",
  APROBADO: "Aprobado", SUSPENDIDO: "Suspendido", ARCHIVADO: "Archivado",
};
const ESTADO_SEV = {
  BORRADOR: "info", A_PRUEBA: "warning", PENDIENTE_REVISION: "warning",
  APROBADO: "success", SUSPENDIDO: "danger", ARCHIVADO: "secondary",
};
const ESTADO_ICON = {
  BORRADOR: "fa-solid fa-pencil", A_PRUEBA: "fa-solid fa-flask",
  PENDIENTE_REVISION: "fa-solid fa-clock", APROBADO: "fa-solid fa-check",
  SUSPENDIDO: "fa-solid fa-pause", ARCHIVADO: "fa-solid fa-archive",
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

const MezclasCatalogoPage = () => {
  const toast = useToast();
  const navigate = useNavigate();
  const [mezclas, setMezclas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("TODOS");
  const [first, setFirst] = useState(0);

  // Versiones/historial dialog
  const [versionesDialog, setVersionesDialog] = useState(false);
  const [versiones, setVersiones] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [versionesTitle, setVersionesTitle] = useState("");

  // Transition motivo dialog
  const [transicionDialog, setTransicionDialog] = useState(null); // { id, nuevoEstado, label }
  const [motivoTexto, setMotivoTexto] = useState("");

  const { user } = useUserContext();

  const fetchMezclas = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/mezclas`, { headers: config.headers });
      setMezclas(data);
    } catch (err) {
      console.error(err);
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudieron cargar las mezclas" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchMezclas(); }, [fetchMezclas]);

  /* ── Acciones ── */
  const handleDelete = (mezcla) => {
    if (mezcla.estado && mezcla.estado !== "BORRADOR") {
      toast.current?.show({ severity: "warn", summary: "No permitido", detail: "Solo se pueden eliminar borradores." });
      return;
    }
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: "2.6rem", color: "var(--lightred)" }} />
          <span>¿Eliminar el borrador <b>{mezcla.nombre}</b>?</span>
          <small className="mt-2 text-color-secondary">Esta acción se puede revertir contactando al administrador del sistema.</small>
        </div>
      ),
      header: "Eliminar borrador",
      defaultFocus: "reject",
      acceptLabel: "Eliminar",
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: async () => {
        try {
          const { data } = await axios.delete(`${config.backendUrl}/api/mezclas/${mezcla.idMezcla}`, { headers: config.headers });
          toast.current?.show({ severity: "success", summary: "Eliminada", detail: data.message || "Mezcla eliminada" });
          fetchMezclas();
        } catch (err) {
          const msg = err.response?.data?.error || "No se pudo eliminar la mezcla";
          toast.current?.show({ severity: "error", summary: "Error", detail: msg });
        }
      },
    });
  };

  const handleDuplicar = async (mezcla) => {
    try {
      const { data } = await axios.post(
        `${config.backendUrl}/api/mezclas/${mezcla.idMezcla}/duplicar`, {},
        { headers: config.headers }
      );
      toast.current?.show({ severity: "success", summary: "Duplicada", detail: `Se creó "${data.nombre}". Abriendo editor…` });
      navigate('/calidad/diseno', { state: { editMezcla: data } });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudo duplicar la mezcla" });
    }
  };

  const handleTransicion = async (id, nuevoEstado) => {
    try {
      await transicionarEstadoMezcla(id, { nuevoEstado, usuario: user?.nombre });
      toast.current?.show({ severity: "success", summary: "Actualizado", detail: `Estado cambiado a ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}` });
      fetchMezclas();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.response?.data?.error || "No se pudo cambiar el estado" });
    }
  };

  const MOTIVO_OBLIGATORIO = new Set(["SUSPENDIDO", "ARCHIVADO", "BORRADOR"]); // BORRADOR from PENDIENTE_REVISION = rechazar

  const handleTransicionConMotivo = (id, nuevoEstado, label) => {
    setTransicionDialog({ id, nuevoEstado, label });
    setMotivoTexto("");
  };

  const confirmTransicion = async () => {
    if (!transicionDialog) return;
    const { id, nuevoEstado } = transicionDialog;
    try {
      await transicionarEstadoMezcla(id, { nuevoEstado, usuario: user?.nombre, motivo: motivoTexto || null });
      toast.current?.show({ severity: "success", summary: "Actualizado", detail: `Estado cambiado a ${ESTADO_LABELS[nuevoEstado] || nuevoEstado}` });
      fetchMezclas();
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.response?.data?.error || "Error" });
    }
    setTransicionDialog(null);
  };

  const motivoRequerido = transicionDialog && MOTIVO_OBLIGATORIO.has(transicionDialog.nuevoEstado);

  const handleNuevaVersion = async (row) => {
    try {
      const newRow = await crearNuevaVersionMezcla(row.idMezcla, { usuario: user?.nombre });
      toast.current?.show({ severity: "success", summary: "Nueva versión", detail: `v${newRow.version} creada como borrador` });
      navigate('/calidad/diseno', { state: { editMezcla: newRow } });
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.response?.data?.error || "No se pudo crear la nueva versión" });
    }
  };

  const handleVerVersiones = async (row) => {
    try {
      const [ver, hist] = await Promise.all([
        obtenerVersionesMezcla(row.idMezcla),
        obtenerHistorialMezcla(row.idMezcla),
      ]);
      setVersiones(ver);
      setHistorial(hist);
      setVersionesTitle(`Versiones — ${row.nombre}`);
      setVersionesDialog(true);
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudieron cargar las versiones" });
    }
  };

  const handleVerificarIntegridad = async (row) => {
    try {
      const result = await verificarIntegridadMezcla(row.idMezcla);
      if (result.ok) {
        toast.current?.show({ severity: "success", summary: "Integridad OK", detail: `Hash verificado: ${result.hashCortoRecalculado}`, life: 5000 });
      } else {
        toast.current?.show({ severity: "error", summary: "Integridad comprometida", detail: result.reason || `Almacenado: ${result.hashCortoAlmacenado}, recalculado: ${result.hashCortoRecalculado}`, life: 8000 });
      }
    } catch (err) {
      toast.current?.show({ severity: "error", summary: "Error", detail: err.response?.data?.error || "No se pudo verificar" });
    }
  };

  /* ── Filtro ── */
  const filtered = mezclas.filter((m) => {
    if (estadoFilter !== "TODOS" && m.estado !== estadoFilter) return false;
    if (estadoFilter === "TODOS" && m.estado === "ARCHIVADO") return false;
    if (!searchTerm) return true;
    const lc = searchTerm.toLowerCase();
    return (
      (m.nombre || "").toLowerCase().includes(lc) ||
      (m.descripcion || "").toLowerCase().includes(lc) ||
      (m.tipoMezcla || "").toLowerCase().includes(lc) ||
      (m.planta?.nombre || "").toLowerCase().includes(lc)
    );
  });

  /* ── Column bodies ── */
  const nombreBody = (row) => (
    <span
      className="font-bold hover-blue cursor-pointer"
      onClick={() => navigate(`/calidad/catalogos/mezclas/${row.idMezcla}`)}
    >
      {row.nombre}
    </span>
  );
  const plantaBody = (row) => row.planta?.nombre || "—";
  const tipoBody = (row) => <Tag value={row.tipoMezcla} severity={TIPO_COLORS[row.tipoMezcla] || "secondary"} />;
  const modoBody = (row) => row.objetivoModo ? (MODO_LABELS[row.objetivoModo] || row.objetivoModo) : "—";
  const estadoBody = (row) => (
    <div className="flex align-items-center gap-1 flex-wrap">
      <Tag value={ESTADO_LABELS[row.estado] || row.estado || "Borrador"} severity={ESTADO_SEV[row.estado] || "info"} icon={ESTADO_ICON[row.estado]} />
      {row.dosificacionCount > 0 && (
        <Tag
          value={`${row.dosificacionCount} dosif.`}
          icon="fa-solid fa-link"
          severity="warning"
          className="text-xs"
          title={`Utilizada por ${row.dosificacionCount} dosificación(es) — no se puede eliminar`}
        />
      )}
    </div>
  );
  const versionBody = (row) => (
    <span
      className="cursor-pointer hover:underline text-color-secondary"
      onClick={() => handleVerVersiones(row)}
      title="Ver historial de versiones"
    >
      v{row.version || 1}
    </span>
  );
  const tmnBody = (row) => row.tmnCalculadoMm != null ? `${row.tmnCalculadoMm} mm` : "—";
  const itemsBody = (row) => row.items ? row.items.length : 0;
  const fechaBody = (row) => row.createdAt ? new Date(row.createdAt).toLocaleDateString("es-AR") : "—";

  const accionesBody = (row) => {
    const estado = row.estado || "BORRADOR";
    return (
      <div className="flex gap-1 flex-wrap">
        <Button icon="fa-solid fa-eye" rounded text size="small"
          tooltip="Ver detalle" tooltipOptions={{ position: "top" }}
          onClick={() => navigate(`/calidad/catalogos/mezclas/${row.idMezcla}`)}
        />
        <Button icon="fa-solid fa-file-arrow-down" rounded text size="small"
          tooltip="Exportar PDF" tooltipOptions={{ position: "top" }}
          onClick={() => navigate(`/calidad/catalogos/mezclas/${row.idMezcla}`, { state: { openPdf: true } })}
        />
        <Button icon="fa-solid fa-copy" rounded text size="small"
          tooltip="Duplicar" tooltipOptions={{ position: "top" }}
          onClick={() => handleDuplicar(row)}
        />
        {estado === "BORRADOR" && (
          <Button icon="fa-solid fa-flask" rounded text size="small" severity="warning"
            tooltip="Enviar a prueba" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.idMezcla, "A_PRUEBA")}
          />
        )}
        {estado === "A_PRUEBA" && (
          <Button icon="fa-solid fa-paper-plane" rounded text size="small"
            tooltip="Enviar a revisión" tooltipOptions={{ position: "top" }}
            style={{ color: "#e67e22" }}
            onClick={() => handleTransicion(row.idMezcla, "PENDIENTE_REVISION")}
          />
        )}
        {estado === "PENDIENTE_REVISION" && (
          <Button icon="fa-solid fa-check" rounded text size="small" severity="success"
            tooltip="Aprobar" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.idMezcla, "APROBADO")}
          />
        )}
        {estado === "PENDIENTE_REVISION" && (
          <Button icon="fa-solid fa-times" rounded text size="small" severity="danger"
            tooltip="Rechazar" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.idMezcla, "BORRADOR", "Rechazar mezcla")}
          />
        )}
        {(estado === "APROBADO" || estado === "SUSPENDIDO") && (
          <Button icon="fa-solid fa-code-branch" rounded text size="small"
            tooltip="Crear nueva versión" tooltipOptions={{ position: "top" }}
            onClick={() => handleNuevaVersion(row)}
          />
        )}
        {estado === "APROBADO" && (
          <Button icon="fa-solid fa-pause" rounded text size="small" severity="danger"
            tooltip="Suspender" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.idMezcla, "SUSPENDIDO", "Suspender mezcla")}
          />
        )}
        {estado === "SUSPENDIDO" && (
          <Button icon="fa-solid fa-play" rounded text size="small" severity="success"
            tooltip="Reactivar" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicion(row.idMezcla, "APROBADO")}
          />
        )}
        {(estado === "APROBADO" || estado === "SUSPENDIDO") && (
          <Button icon="fa-solid fa-archive" rounded text size="small" severity="secondary"
            tooltip="Archivar" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.idMezcla, "ARCHIVADO", "Archivar mezcla")}
          />
        )}
        {(estado === "APROBADO" || estado === "SUSPENDIDO" || estado === "ARCHIVADO") && (
          <Button icon="fa-solid fa-shield-check" rounded text size="small" severity="secondary"
            tooltip="Verificar integridad" tooltipOptions={{ position: "top" }}
            onClick={() => handleVerificarIntegridad(row)}
          />
        )}
        {estado === "BORRADOR" && (
          <Button icon="fa-solid fa-archive" rounded text size="small" severity="secondary"
            tooltip="Archivar" tooltipOptions={{ position: "top" }}
            onClick={() => handleTransicionConMotivo(row.idMezcla, "ARCHIVADO", "Archivar mezcla")}
          />
        )}
        {estado === "BORRADOR" && (
          <Button icon="fa-solid fa-trash" rounded text size="small" severity="danger"
            tooltip={row.dosificacionCount > 0 ? `No se puede eliminar: usada por ${row.dosificacionCount} dosificación(es)` : "Eliminar"}
            tooltipOptions={{ position: "top" }}
            disabled={row.dosificacionCount > 0}
            onClick={() => handleDelete(row)}
          />
        )}
      </div>
    );
  };

  if (loading) return <LoadSpinner />;

  return (
    <div>
      <PageHeader title="Mezclas guardadas" icon="fa-solid fa-blender" />

      <div className="flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="flex gap-2 align-items-center flex-1">
          <span className="p-input-icon-left search-bar-wrapper">
            <i className="pi pi-search" />
            <InputText
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setFirst(0); }}
              placeholder="Buscar mezcla..."
              title="Buscar por nombre, planta o estado"
              className="search-bar"
            />
          </span>
          <Dropdown
            value={estadoFilter}
            options={ESTADO_FILTER_OPTIONS}
            onChange={(e) => { setEstadoFilter(e.value); setFirst(0); }}
            className="w-12rem"
          />
        </div>
        <Link to="/calidad/diseno">
          <Button label="Ir a Diseño" icon="pi pi-compass" className="p-button-outlined" />
        </Link>
      </div>

      <DataTable responsiveLayout="scroll"
        value={filtered}
        paginator
        rows={15}
        first={first}
        onPage={(e) => setFirst(e.first)}
        emptyMessage="No se encontraron mezclas."
        sortField="createdAt"
        sortOrder={-1}
        rowHover
        stripedRows
        size="small"
      >
        <Column field="nombre" header="Nombre" body={nombreBody} sortable style={{ minWidth: "200px" }} />
        <Column field="tipoMezcla" header="Tipo" body={tipoBody} sortable style={{ width: "90px" }} />
        <Column header="Planta" body={plantaBody} sortable sortField="planta.nombre" style={{ minWidth: "120px" }} />
        <Column header="Agregados" body={itemsBody} style={{ width: "80px" }} />
        <Column field="tmnCalculadoMm" header="TMN" body={tmnBody} sortable style={{ width: "80px" }} />
        <Column field="estado" header="Estado" body={estadoBody} sortable style={{ minWidth: "140px" }} />
        <Column field="createdAt" header="Fecha" body={fechaBody} sortable style={{ width: "100px" }} />
        <Column header="" body={accionesBody} style={{ minWidth: "180px" }} />
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
              disabled={motivoRequerido && !motivoTexto.trim()}
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
        header={versionesTitle}
        visible={versionesDialog}
        onHide={() => setVersionesDialog(false)}
        style={{ width: "60vw" }}
        maximizable
      >
        {versiones.length > 0 && (
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
                      navigate(`/calidad/catalogos/mezclas/${r.idMezcla}`);
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
        )}
        <div className="mt-3">
          <h4 className="mb-2">Registro de cambios</h4>
          <DisenoHistorialTimeline historial={historial} />
        </div>
      </Dialog>
    </div>
  );
};

export default MezclasCatalogoPage;
