import React, { useEffect, useState, useCallback } from "react";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { SelectButton } from "primereact/selectbutton";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { isOnPhone } from "../../../common/functions";
import {
  listarAlertas,
  marcarLeida,
  resolver,
  ignorar,
  verificarVencimientos,
} from "../../../services/alertaCalidadService";
import "./AlertasCalidadPage.css";

/* ─── Constantes ─────────────────────────────────────────── */

const NIVEL_MAP = {
  CRITICO: { label: "Critico", severity: "danger",  icon: "fa-solid fa-circle-exclamation" },
  ALTO:    { label: "Alto",    severity: "warning", icon: "fa-solid fa-triangle-exclamation" },
  MEDIO:   { label: "Medio",   severity: "info",    icon: "fa-solid fa-circle-info" },
  BAJO:    { label: "Bajo",    severity: "success", icon: "fa-solid fa-circle-check" },
  INFO:    { label: "Info",    severity: null,       icon: "fa-solid fa-info" },
};

const ESTADO_MAP = {
  PENDIENTE: { label: "Pendiente", severity: "warning" },
  LEIDA:     { label: "Leida",     severity: "info" },
  RESUELTA:  { label: "Resuelta",  severity: "success" },
  IGNORADA:  { label: "Ignorada",  severity: null },
};

const TIPO_LABELS = {
  ENSAYO_POR_VENCER:  "Ensayo por vencer",
  ENSAYO_VENCIDO:     "Ensayo vencido",
  ENSAYO_NO_CUMPLE:   "No cumple",
  RESISTENCIA_BAJA:   "Resistencia baja",
  RESISTENCIA_ANOMALA: "Resistencia anomala",
  SPC_FUERA_CONTROL:  "SPC fuera de control",
  PLACA_LIMITE:       "Placa al limite",
  PLACA_AGOTADA:      "Placa agotada",
  MATERIAL_SIN_ENSAYO: "Material sin ensayo",
  DOSIFICACION_PENDIENTE_REVISION: "Dosificacion pendiente de revision",
};

const ESTADO_OPTIONS = [
  { label: "Pendientes", value: "PENDIENTE" },
  { label: "Leidas",     value: "LEIDA" },
  { label: "Resueltas",  value: "RESUELTA" },
  { label: "Ignoradas",  value: "IGNORADA" },
  { label: "Todas",      value: "TODAS" },
];

const NIVEL_OPTIONS = [
  { label: "Todos", value: null },
  { label: "Critico", value: "CRITICO" },
  { label: "Alto", value: "ALTO" },
  { label: "Medio", value: "MEDIO" },
  { label: "Bajo", value: "BAJO" },
];

const TIPO_OPTIONS = [
  { label: "Todos", value: null },
  ...Object.entries(TIPO_LABELS).map(([value, label]) => ({ label, value })),
];

/* ─── Componente ─────────────────────────────────────────── */

const AlertasCalidadPage = () => {
  const [alertas, setAlertas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [first, setFirst] = useState(0);

  // Filtros
  const [estadoFiltro, setEstadoFiltro] = useState("PENDIENTE");
  const [nivelFiltro, setNivelFiltro] = useState(null);
  const [tipoFiltro, setTipoFiltro] = useState(null);
  // Bug 2 / 2026-05-29: filtro "Solo asignadas a mi" para que el revisor vea
  // sus pendientes sin ruido del resto de la planta.
  const [soloMias, setSoloMias] = useState(false);

  // Dialog resolver
  const [resolverDialog, setResolverDialog] = useState(false);
  const [alertaSeleccionada, setAlertaSeleccionada] = useState(null);
  const [notasResolucion, setNotasResolucion] = useState("");

  const showToast = useToast();
  const { user } = useUserContext();
  const usuario = user?.nombre || user?.email || "usuario";
  // Username canónico que el backend usa al setear `asignadaA`. Coincide con
  // `user.username` cuando existe; si no, cae a `user.nombre`. Mantener
  // alineado con cómo `revisorAsignado` se setea al enviar a revisión.
  const usernameActual = user?.username || user?.nombre || null;

  /* ─── Fetch ──────────────────────────────────────────── */
  const fetchAlertas = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: 200, offset: 0 };
      if (estadoFiltro && estadoFiltro !== "TODAS") params.estado = estadoFiltro;
      if (nivelFiltro) params.nivel = nivelFiltro;
      if (tipoFiltro) params.tipo = tipoFiltro;
      // Bug 2 / 2026-05-29: filtro estricto al backend cuando el chip
      // "Solo asignadas a mi" esta activo. El backend filtra por
      // asignadaA = usernameActual (no incluye globales).
      if (soloMias && usernameActual) params.asignadaA = usernameActual;

      const result = await listarAlertas(params);
      setAlertas(Array.isArray(result) ? result : result.rows || []);
    } catch (err) {
      console.error("Error al cargar alertas:", err);
      showToast("error", "Error al cargar alertas");
      setAlertas([]);
    } finally {
      setLoading(false);
    }
  }, [estadoFiltro, nivelFiltro, tipoFiltro, soloMias, usernameActual, showToast]);

  useEffect(() => { fetchAlertas(); }, [fetchAlertas]);

  /* ─── Acciones ───────────────────────────────────────── */
  const handleLeer = async (alerta) => {
    try {
      await marcarLeida(alerta.idAlertaCalidad, usuario);
      showToast("success", "Alerta marcada como leida");
      fetchAlertas();
    } catch {
      showToast("error", "Error al marcar como leida");
    }
  };

  const handleResolver = async () => {
    if (!alertaSeleccionada) return;
    try {
      await resolver(alertaSeleccionada.idAlertaCalidad, { usuario, notas: notasResolucion });
      showToast("success", "Alerta resuelta");
      setResolverDialog(false);
      setNotasResolucion("");
      setAlertaSeleccionada(null);
      fetchAlertas();
    } catch {
      showToast("error", "Error al resolver alerta");
    }
  };

  const handleIgnorar = async (alerta) => {
    try {
      await ignorar(alerta.idAlertaCalidad, usuario);
      showToast("info", "Alerta ignorada");
      fetchAlertas();
    } catch {
      showToast("error", "Error al ignorar alerta");
    }
  };

  const handleVerificarVencimientos = async () => {
    try {
      const res = await verificarVencimientos();
      showToast(
        "success",
        `Verificacion completada: ${res.alertasCreadas} nuevas, ${res.alertasAutoResueltas} auto-resueltas`
      );
      fetchAlertas();
    } catch {
      showToast("error", "Error al verificar vencimientos");
    }
  };

  const abrirResolver = (alerta) => {
    setAlertaSeleccionada(alerta);
    setNotasResolucion("");
    setResolverDialog(true);
  };

  /* ─── Filtro texto ───────────────────────────────────── */
  const filtered = alertas.filter((a) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (a.mensaje || "").toLowerCase().includes(term) ||
      (a.nombreMaterial || "").toLowerCase().includes(term) ||
      (TIPO_LABELS[a.tipo] || "").toLowerCase().includes(term)
    );
  });

  /* ─── Templates de columna ──────────────────────────── */
  const nivelTemplate = (row) => {
    const cfg = NIVEL_MAP[row.nivel] || NIVEL_MAP.MEDIO;
    return (
      <Tag severity={cfg.severity} rounded>
        <i className={`${cfg.icon} mr-1`} style={{ fontSize: "0.75rem" }} />
        {cfg.label}
      </Tag>
    );
  };

  const estadoTemplate = (row) => {
    const cfg = ESTADO_MAP[row.estado] || ESTADO_MAP.PENDIENTE;
    return <Tag value={cfg.label} severity={cfg.severity} rounded />;
  };

  const tipoTemplate = (row) => (
    <span style={{ fontSize: "0.85rem" }}>{TIPO_LABELS[row.tipo] || row.tipo}</span>
  );

  const fechaTemplate = (row) => {
    if (!row.createdAt) return "—";
    const d = new Date(row.createdAt);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const accionesTemplate = (row) => {
    const isPending = row.estado === "PENDIENTE";
    const isLeida = row.estado === "LEIDA";
    return (
      <div className="flex gap-1">
        {isPending && (
          <Button
            icon="fa-solid fa-eye"
            rounded text size="small"
            tooltip="Marcar como leida"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleLeer(row)}
          />
        )}
        {(isPending || isLeida) && (
          <Button
            icon="fa-solid fa-check"
            rounded text size="small"
            severity="success"
            tooltip="Resolver"
            tooltipOptions={{ position: "top" }}
            onClick={() => abrirResolver(row)}
          />
        )}
        {(isPending || isLeida) && (
          <Button
            icon="fa-solid fa-ban"
            rounded text size="small"
            severity="warning"
            tooltip="Ignorar"
            tooltipOptions={{ position: "top" }}
            onClick={() => handleIgnorar(row)}
          />
        )}
      </div>
    );
  };

  /* ─── Render ─────────────────────────────────────────── */
  if (loading && alertas.length === 0) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  return (
    <Fade triggerOnce duration={300}>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader
          icon="fa-solid fa-bell"
          title="Alertas de Calidad"
          subtitle="Gestion de alertas del sistema de calidad"
        />

        {/* ─── Filtros ─────────────────────────────── */}
        <div className="w-full flex flex-column xl:flex-row align-items-start xl:align-items-center justify-content-between mb-3 gap-2">
          <SelectButton
            value={estadoFiltro}
            options={ESTADO_OPTIONS}
            onChange={(e) => { setEstadoFiltro(e.value); setFirst(0); }}
            allowEmpty={false}
          />

          <div className="flex align-items-center gap-2 flex-wrap">
            <Dropdown
              value={nivelFiltro}
              options={NIVEL_OPTIONS}
              onChange={(e) => { setNivelFiltro(e.value); setFirst(0); }}
              placeholder="Nivel"
              className="w-auto"
              style={{ minWidth: "120px" }}
            />

            <Dropdown
              value={tipoFiltro}
              options={TIPO_OPTIONS}
              onChange={(e) => { setTipoFiltro(e.value); setFirst(0); }}
              placeholder="Tipo"
              className="w-auto"
              style={{ minWidth: "180px" }}
            />

            <span className="search-bar-wrapper">
              <InputText
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="search-bar"
              />
            </span>

            <Button
              icon="fa-solid fa-user-check"
              rounded
              severity={soloMias ? "warning" : "secondary"}
              outlined={!soloMias}
              size="small"
              tooltip={soloMias ? "Mostrando solo las asignadas a vos" : "Mostrar solo las asignadas a vos"}
              tooltipOptions={{ position: "top" }}
              onClick={() => { setSoloMias(!soloMias); setFirst(0); }}
            />

            <Button
              icon="fa-solid fa-rotate"
              rounded
              severity="info"
              size="small"
              tooltip="Verificar vencimientos ahora"
              tooltipOptions={{ position: "top" }}
              onClick={handleVerificarVencimientos}
            />
          </div>
        </div>

        {/* ─── Tabla ───────────────────────────────── */}
        {!loading && filtered.length === 0 ? (
          <div className="form-card br-15 flex p-4 align-items-center justify-content-center flex-column w-full">
            <i className="fa-solid fa-bell-slash mb-3" style={{ fontSize: "2.5rem", opacity: 0.3 }} />
            <h2 className="text-center mb-2">No hay alertas</h2>
            <p className="text-500">No se encontraron alertas con los filtros seleccionados.</p>
          </div>
        ) : (
          <DataTable responsiveLayout="scroll"
            value={filtered}
            loading={loading}
            stripedRows
            paginator
            rows={isOnPhone ? 20 : 50}
            first={first}
            onPage={(e) => setFirst(e.first)}
            className="w-full"
            sortField="createdAt"
            sortOrder={-1}
            rowClassName={(row) => ({
              "opacity-60": row.estado === "RESUELTA" || row.estado === "IGNORADA",
              // Bug 2 / 2026-05-29: resaltar las alertas asignadas al
              // usuario actual con fondo ambar suave cuando estan pendientes.
              "alerta-asignada-a-mi": row.asignadaA && row.asignadaA === usernameActual && row.estado === "PENDIENTE",
            })}
          >
            <Column
              field="nivel"
              header="Nivel"
              sortable
              body={nivelTemplate}
              style={{ width: "110px" }}
            />
            <Column
              field="tipo"
              header="Tipo"
              sortable
              body={tipoTemplate}
              style={{ width: "160px" }}
            />
            <Column
              field="mensaje"
              header="Mensaje"
              sortable
              body={(row) => (
                <span style={{ fontSize: "0.85rem" }} title={row.mensaje}>
                  {row.mensaje}
                </span>
              )}
            />
            <Column
              field="nombreMaterial"
              header="Material"
              sortable
              style={{ width: "160px" }}
              body={(row) => row.nombreMaterial || "—"}
            />
            <Column
              field="asignadaA"
              header="Asignada a"
              sortable
              style={{ width: "140px" }}
              body={(row) => {
                if (!row.asignadaA) return <span className="text-color-secondary">—</span>;
                const esParaMi = row.asignadaA === usernameActual;
                return (
                  <Tag
                    value={esParaMi ? "Vos" : row.asignadaA}
                    severity={esParaMi ? "warning" : "info"}
                    icon={esParaMi ? "fa-solid fa-user" : null}
                    rounded
                  />
                );
              }}
            />
            <Column
              field="estado"
              header="Estado"
              sortable
              body={estadoTemplate}
              style={{ width: "110px" }}
            />
            <Column
              field="createdAt"
              header="Fecha"
              sortable
              body={fechaTemplate}
              style={{ width: "100px" }}
            />
            <Column
              header="Acciones"
              body={accionesTemplate}
              style={{ width: "130px" }}
            />
          </DataTable>
        )}

        {/* ─── Dialog Resolver ─────────────────────── */}
        <Dialog
          visible={resolverDialog}
          onHide={() => setResolverDialog(false)}
          header="Resolver alerta"
          style={{ width: isOnPhone ? "95vw" : "500px" }}
          modal
          footer={
            <div className="flex justify-content-end gap-2">
              <Button
                label="Cancelar"
                icon="fa-solid fa-xmark"
                severity="secondary"
                text
                onClick={() => setResolverDialog(false)}
              />
              <Button
                label="Resolver"
                icon="fa-solid fa-check"
                severity="success"
                onClick={handleResolver}
              />
            </div>
          }
        >
          {alertaSeleccionada && (
            <div className="flex flex-column gap-3">
              <div>
                <label className="font-bold text-sm">Alerta</label>
                <p className="mt-1 mb-0">{alertaSeleccionada.mensaje}</p>
              </div>
              <div>
                <label className="font-bold text-sm mb-2 block">Notas de resolucion</label>
                <InputTextarea
                  value={notasResolucion}
                  onChange={(e) => setNotasResolucion(e.target.value)}
                  rows={3}
                  className="w-full"
                  placeholder="Describir como se resolvio la alerta..."
                  autoFocus
                />
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </Fade>
  );
};

export default AlertasCalidadPage;
