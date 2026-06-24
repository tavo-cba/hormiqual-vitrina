import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { SelectButton } from "primereact/selectbutton";
import { ToggleButton } from "primereact/togglebutton";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { isOnPhone } from "../../../common/functions";
import MaterialDocumentos from "./MaterialDocumentos";
import MaterialPrecioPanel from "./MaterialPrecioPanel";
import MaterialPrecioImportDialog from "./MaterialPrecioImportDialog";
import FichaTecnicaModal from "../ensayos-agregados/FichaTecnicaModal";
import WizardMateriales from "./WizardMateriales";
import "./material.css";

/* Mapeo _source → materialTipo para la API de documentos */
const SOURCE_TO_TIPO = {
  agregado: "AGREGADO",
  cemento: "CEMENTO",
  aditivo: "ADITIVO",
  fibra: "FIBRA",
  adicion: "ADICION",
  agua: "AGUA",
};

/* Mapa de labels para el botón "Nuevo" según tipo (keys = nombre.toUpperCase() del MaterialTipo) */
const MATERIAL_LABELS = {
  AGREGADOS: { singular: "agregado", plural: "agregados", articulo: "Nuevo", genero: "m" },
  CEMENTOS:  { singular: "cemento",  plural: "cementos",  articulo: "Nuevo", genero: "m" },
  ADITIVOS:  { singular: "aditivo",  plural: "aditivos",  articulo: "Nuevo", genero: "m" },
  FIBRAS:    { singular: "fibra",    plural: "fibras",    articulo: "Nueva", genero: "f" },
  ADICIONES: { singular: "adición",  plural: "adiciones", articulo: "Nueva", genero: "f" },
  AGUA:      { singular: "agua",     plural: "aguas",     articulo: "Nueva", genero: "f" },
};

const MaterialList = () => {
  const [materiales, setMateriales] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [first, setFirst] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  /* ── Estado del dialog de documentos ───── */
  const [docsMaterial, setDocsMaterial] = useState(null);
  /* ── Estado del dialog de precios ───── */
  const [preciosMaterial, setPreciosMaterial] = useState(null);
  const [importPreciosVisible, setImportPreciosVisible] = useState(false);
  const [fichaTecnicaMaterial, setFichaTecnicaMaterial] = useState(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const tipoFromUrl = searchParams.get("tipo");
  const [tipoActivo, setTipoActivoState] = useState(tipoFromUrl || "_pending_default");
  const [initialLoad, setInitialLoad] = useState(true);

  // Wizard de configuración asistida (modelo Liquidaciones)
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("mat_wizard_paused") === "1"
  );

  const deletingRef = useRef(false);
  const restoringRef = useRef(false);

  const navigate = useNavigate();
  const showToast = useToast();

  // Wrapper that also updates URL search params
  const setTipoActivo = useCallback((valOrFn) => {
    setTipoActivoState(prev => {
      const next = typeof valOrFn === 'function' ? valOrFn(prev) : valOrFn;
      if (next && next !== '_pending_default' && next !== 'todos') {
        setSearchParams({ tipo: next }, { replace: true });
      }
      return next;
    });
  }, [setSearchParams]);

  // Sync from URL on browser back/forward
  useEffect(() => {
    if (tipoFromUrl && tipoFromUrl !== tipoActivo && tipoFromUrl !== '_pending_default') {
      setTipoActivoState(tipoFromUrl);
    }
  }, [tipoFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Fetch tipos ────────────────────────────── */
  const fetchTipos = useCallback(async () => {
    try {
      const res = await axios.get(`${config.backendUrl}/api/materiales/tipos`, {
        headers: config.headers,
      });
      const tiposList = res.data || [];
      setTipos(tiposList);
      // Default to "Agregados" tab only when no tipo in URL
      setTipoActivo(prev => {
        if (prev !== '_pending_default') return prev; // URL already had a valid tipo
        const agregados = tiposList.find(t => t.nombre?.toUpperCase().includes('AGREGADO'));
        return agregados ? String(agregados.idMaterialTipo) : (tiposList[0] ? String(tiposList[0].idMaterialTipo) : prev);
      });
    } catch (err) {
      console.error("Error al obtener tipos:", err);
      if (tipoActivo === '_pending_default') setTipoActivo('todos');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Fetch materiales ── */
  const fetchMateriales = useCallback(async (tipo, inclArchived) => {
    if (tipo === '_pending_default') return; // wait for tipo resolution
    try {
      setLoading(true);
      const params = {};
      if (tipo === "todos") {
        params.tipo = "ALL";
      } else {
        params.tipo = tipo;
      }
      if (inclArchived) params.includeArchived = "true";
      const res = await axios.get(`${config.backendUrl}/api/materiales`, {
        headers: config.headers,
        params,
      });
      // ALL returns { data, meta }, single-type returns plain array
      if (tipo === "todos" && res.data && res.data.data) {
        setMateriales(res.data.data || []);
      } else if (Array.isArray(res.data)) {
        setMateriales(res.data);
      } else if (res.data && res.data.data) {
        setMateriales(res.data.data || []);
      } else {
        setMateriales([]);
      }
    } catch (err) {
      console.error("Error al obtener materiales:", err);
      setMateriales([]);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchTipos();
  }, [fetchTipos]);

  useEffect(() => {
    fetchMateriales(tipoActivo, showArchived);
  }, [tipoActivo, showArchived, fetchMateriales]);

  // Re-evaluamos el flag de "wizard pausado" cuando la pestaña vuelve a foco
  useEffect(() => {
    const sync = () => setSetupWizardPaused(localStorage.getItem("mat_wizard_paused") === "1");
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [setupWizardVisible]);

  const descartarSetupWizard = () => {
    localStorage.removeItem("mat_wizard_step");
    localStorage.removeItem("mat_wizard_paused");
    setSetupWizardPaused(false);
  };

  const recargarTodoSetup = () => {
    fetchTipos();
    fetchMateriales(tipoActivo, showArchived);
  };

  /* ── Tipo tabs ──────────────────────────────── */
  const tipoOptions = tipos.map((t) => ({ label: t.nombre, value: String(t.idMaterialTipo) }));

  const onTipoChange = (e) => {
    const val = e.value;
    if (val === null || val === undefined) return;
    setMateriales([]);   // limpiar datos anteriores inmediatamente
    setLoading(true);    // evitar flash de empty state
    setTipoActivo(val);  // dispara useEffect → fetchMateriales(val)
    setFirst(0);
  };

  /* ── Dynamic "Nuevo" button label ───────────── */
  const tipoActivoObj = tipos.find((t) => String(t.idMaterialTipo) === tipoActivo);
  const tipoActivoKey = tipoActivoObj ? tipoActivoObj.nombre.toUpperCase() : null;
  const labelInfo = tipoActivoKey ? MATERIAL_LABELS[tipoActivoKey] : null;
  const nuevoLabel = labelInfo
    ? `${labelInfo.articulo} ${labelInfo.singular}`
    : tipoActivo === "todos"
    ? "Nuevo material"
    : "Nuevo material";

  /* ── Rutas de creación por tipo ── */
  // Sesión 2026-05-27: agregados/cementos/aditivos/fibras movidos a
  // /calidad/catalogos/{tipo}/nuevo para que el operador de Calidad llegue
  // sin requerir permisos del módulo Administración. /admin/{tipo}/nuevo
  // siguen funcionando como alias para back-compat.
  const NUEVO_ROUTES = {
    AGREGADOS: "/calidad/catalogos/agregados/nuevo",
    CEMENTOS: "/calidad/catalogos/cementos/nuevo",
    ADITIVOS: "/calidad/catalogos/aditivos/nuevo",
    FIBRAS: "/calidad/catalogos/fibras/nuevo",
    ADICIONES: "/calidad/catalogos/materiales/nuevo",
    AGUA: "/calidad/catalogos/materiales/agua/nuevo",
    // Sesión 2026-05-29: livianos manufacturados (telgopor / EPS / perlita
    // / arcilla expandida) — fuera de CIRSOC, form mínimo (densidad).
    LIVIANO: "/calidad/catalogos/materiales/liviano/nuevo",
  };

  const nuevoRoute = tipoActivoKey ? NUEVO_ROUTES[tipoActivoKey] : null;
  const canCreateHere = tipoActivo !== "todos";

  /* ── Navigate to detail (click on name) ─────── */
  const verDetalleMaterial = (mat) => {
    // For agregados, include tipoAgregado in query string
    const extra = mat._source === 'agregado' ? `?tipo=${encodeURIComponent((mat.detalle || '').split(' — ')[0] || 'Fino')}` : '';
    navigate(`/calidad/catalogos/materiales/detalle/${mat._source}/${mat._sourceId}${extra}`);
  };

  /* ── Navigate to edit ───────────────────────── */
  const editarMaterial = (mat) => {
    if (mat._source === "agua") {
      navigate(`/calidad/catalogos/materiales/agua/editar/${mat._sourceId}`);
    } else if (mat._editRoute) {
      navigate(mat._editRoute);
    } else if (mat._source === "liviano") {
      // Sesión 2026-05-29: livianos editan con form propio (form mínimo).
      navigate(`/calidad/catalogos/materiales/liviano/editar/${mat._sourceId || mat.idMaterial}`);
    } else if (mat._source === "adicion") {
      navigate(`/calidad/catalogos/materiales/editar/${mat.idMaterial}`);
    }
  };

  /* ── Delete ────────────────────────────────── */
  const getDeleteUrl = (mat) => {
    switch (mat._source) {
      case 'agregado': {
        const tipoAg = (mat.detalle || '').split(' — ')[0] || 'Fino';
        return `${config.backendUrl}/api/agregados/${mat._sourceId}?tipoAgregado=${encodeURIComponent(tipoAg)}`;
      }
      case 'cemento':  return `${config.backendUrl}/api/cementos/${mat._sourceId}`;
      case 'aditivo':  return `${config.backendUrl}/api/aditivos/${mat._sourceId}`;
      case 'fibra':    return `${config.backendUrl}/api/fibras/${mat._sourceId}`;
      case 'adicion':  return `${config.backendUrl}/api/materiales/${mat._sourceId}`;
      case 'agua':     return `${config.backendUrl}/api/aguas/${mat._sourceId}`;
      default:         return null;
    }
  };

  const confirmarBorrado = (mat) => {
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: "2.6rem", color: "var(--lightred)" }} />
          <span>¿Estás seguro que quieres borrar <b>{mat.nombre}</b>?</span>
        </div>
      ),
      header: "Borrar material",
      defaultFocus: "accept",
      acceptLabel: (<span className="mr-2 ml-2"><i className="fa-solid fa-trash mr-2" />Borrar</span>),
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: () => borrarMaterial(mat),
    });
  };

  const borrarMaterial = async (mat) => {
    if (deletingRef.current) return;
    const url = getDeleteUrl(mat);
    if (!url) { showToast("error", "Tipo de material desconocido"); return; }
    try {
      deletingRef.current = true;
      const { data } = await axios.delete(url, { headers: config.headers });
      if (data.action === 'archived') {
        showToast("info", data.message || "Material archivado porque tiene referencias históricas");
        // Refetch to update the list with archived status
        fetchMateriales(tipoActivo, showArchived);
      } else {
        setMateriales((prev) => prev.filter((m) => !(m._source === mat._source && m._sourceId === mat._sourceId)));
        showToast("success", data.message || "Material eliminado");
      }
    } catch (err) {
      console.error(err);
      showToast("error", "Error al borrar el material");
    } finally {
      deletingRef.current = false;
    }
  };

  /* ── Filter ─────────────────────────────────── */
  const filtered = materiales.filter((m) => {
    const term = searchTerm.toLowerCase();
    return (
      (m.nombre || "").toLowerCase().includes(term) ||
      (m.proveedor || "").toLowerCase().includes(term) ||
      (m.origen || "").toLowerCase().includes(term) ||
      (m.detalle || "").toLowerCase().includes(term)
    );
  });

  /* ── Restore (unarchive) ───────────────────── */
  const restaurarMaterial = async (mat) => {
    if (restoringRef.current) return;
    try {
      restoringRef.current = true;
      await axios.post(
        `${config.backendUrl}/api/materiales/restore`,
        { source: mat._source, sourceId: mat._sourceId },
        { headers: config.headers }
      );
      showToast("success", "Material restaurado");
      fetchMateriales(tipoActivo, showArchived);
    } catch (err) {
      console.error(err);
      showToast("error", "Error al restaurar el material");
    } finally {
      restoringRef.current = false;
    }
  };

  /* ── Render ─────────────────────────────────── */
  if (initialLoad) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        {/* Banner de wizard pausado — solo si el user dejó el asistente a la mitad */}
        {setupWizardPaused && !setupWizardVisible && (
          <div className="mant-wizard-resume-banner">
            <div className="mant-wizard-resume-banner-text">
              <i className="fa-solid fa-wand-magic-sparkles" />
              <div>
                <strong>Configuración del módulo en pausa</strong>
                <small>Continuá donde dejaste el asistente para terminar de dejar todo listo.</small>
              </div>
            </div>
            <div className="mant-wizard-resume-banner-actions">
              <Button
                label="Descartar"
                size="small"
                text
                severity="secondary"
                onClick={descartarSetupWizard}
              />
              <Button
                label="Continuar configuración"
                icon="fa-solid fa-arrow-right"
                iconPos="right"
                size="small"
                severity="success"
                onClick={() => setSetupWizardVisible(true)}
              />
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <PageHeader
            icon="fa-solid fa-cubes"
            title="Materiales"
            subtitle={`Catálogo unificado — ${tipoActivoObj?.nombre || "Materiales"}`}
          />
          <Button
            label="Configurar"
            icon="fa-solid fa-wand-magic-sparkles"
            size="small"
            outlined
            severity="success"
            className="mant-wizard-btn"
            onClick={() => setSetupWizardVisible(true)}
            tooltip="Asistente paso a paso para entender y configurar el catálogo de materiales"
            tooltipOptions={{ position: "left" }}
          />
        </div>

        <WizardMateriales
          visible={setupWizardVisible}
          onClose={() => setSetupWizardVisible(false)}
          onFinish={() => { setSetupWizardVisible(false); recargarTodoSetup(); }}
        />

        {/* Tipo filter */}
        <div className="w-full flex flex-column xl:flex-row align-items-start xl:align-items-center justify-content-between mb-3 gap-2">
          <SelectButton
            value={tipoActivo}
            options={tipoOptions}
            onChange={onTipoChange}
            allowEmpty={false}
            className="material-tipo-selector"
          />
          <div className="flex align-items-center gap-2">
            <ToggleButton
              checked={showArchived}
              onChange={(e) => setShowArchived(e.value)}
              onLabel="Archivados"
              offLabel="Archivados"
              onIcon="fa-solid fa-eye"
              offIcon="fa-solid fa-eye-slash"
              className="p-button-sm"
              tooltip={showArchived ? "Ocultar materiales archivados" : "Mostrar materiales archivados"}
              tooltipOptions={{ position: "top" }}
            />
            <Button
              icon="fa-solid fa-file-import"
              className="p-button-outlined p-button-sm"
              tooltip="Importar lista de precios"
              tooltipOptions={{ position: "top" }}
              onClick={() => setImportPreciosVisible(true)}
            />
            <span className="search-bar-wrapper">
              <InputText
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar material..."
                title="Buscar por nombre, fabricante/productor u origen"
                className="search-bar"
              />
            </span>
            {canCreateHere && (
              <Button
                label={isOnPhone ? "" : nuevoLabel}
                rounded
                icon="fa-solid fa-plus"
                severity="success"
                size="small"
                tooltip="Crear nuevo material"
                tooltipOptions={{ position: "left" }}
                onClick={() => nuevoRoute && navigate(nuevoRoute)}
              />
            )}
          </div>
        </div>

        {!loading && materiales.length === 0 ? (
          <div className="form-card br-15 flex p-4 xl:p-6 align-items-center justify-content-center flex-column align-self-start w-full">
            <h2 className="text-center mb-4 mt-0">
              {labelInfo
                ? `No hay ${labelInfo.plural} ${labelInfo.genero === "f" ? "cargadas" : "cargados"}`
                : "No hay materiales cargados"}
            </h2>
            <small className="text-center">
              {tipoActivo === "todos"
                ? "Seleccioná un tipo y usá el botón para crear uno nuevo."
                : `Podés crear ${labelInfo?.genero === "f" ? "una nueva" : "un nuevo"} ${labelInfo?.singular || "material"} con el botón de arriba.`}
            </small>
            {nuevoRoute && (
              <Button
                label={nuevoLabel}
                icon="fa-solid fa-plus"
                severity="success"
                size="small"
                rounded
                className="mt-3"
                onClick={() => navigate(nuevoRoute)}
              />
            )}
          </div>
        ) : (
          <DataTable responsiveLayout="scroll"
            value={filtered}
            loading={loading}
            emptyMessage={<h3>No hay coincidencias con la búsqueda</h3>}
            stripedRows
            paginator
            rows={50}
            pageLinkSize={4}
            first={first}
            onPage={(e) => setFirst(e.first)}
            className="w-full"
            rowClassName={(m) => {
              const classes = [];
              if (m._source !== "adicion") classes.push("material-legacy-row");
              if (m.activo === false) classes.push("material-archived-row");
              return classes.join(" ");
            }}
          >
            <Column
              field="nombre"
              header="Nombre"
              sortable
              body={(m) => (
                <span
                  className={`font-bold hover-blue cursor-pointer${m.activo === false ? ' opacity-60' : ''}`}
                  onClick={() => verDetalleMaterial(m)}
                >
                  {m.nombre}
                  {m.activo === false && (
                    <Tag value="Archivado" severity="warning" className="ml-2 text-xs" />
                  )}
                </span>
              )}
            />
            <Column
              field="tipo.nombre"
              header="Tipo"
              sortable
              body={(m) => (
                <Tag
                  value={m.tipo?.nombre || "-"}
                  icon={m.tipo?.icono || "fa-solid fa-cube"}
                  className="material-tipo-tag"
                />
              )}
            />
            <Column field="proveedor" header="Fabricante / Productor" sortable body={(m) => m.proveedor || "-"} />
            <Column
              header=""
              style={{ width: "150px" }}
              body={(m) => (
                <div className="flex gap-1">
                  {m._source === "agregado" && (
                    <Button
                      icon="fa-solid fa-file-arrow-down"
                      rounded
                      text
                      size="small"
                      tooltip="Ficha técnica"
                      tooltipOptions={{ position: "top" }}
                      onClick={() => setFichaTecnicaMaterial(m)}
                    />
                  )}
                  <Button
                    icon="fa-solid fa-flask-vial"
                    rounded
                    text
                    size="small"
                    tooltip={["agregado", "agua"].includes(m._source) ? "Ensayos" : "Ensayos (próximamente)"}
                    tooltipOptions={{ position: "top" }}
                    disabled={!["agregado", "agua"].includes(m._source)}
                    onClick={() => {
                      if (m._source === "agregado") navigate(`/calidad/agregados/${m._sourceId}/ensayos`);
                      else if (m._source === "agua") navigate(`/calidad/agua/${m._sourceId}/ensayos`);
                    }}
                  />
                  <Button
                    icon="fa-solid fa-dollar-sign"
                    rounded
                    text
                    size="small"
                    tooltip="Precios"
                    tooltipOptions={{ position: "top" }}
                    onClick={() => setPreciosMaterial(m)}
                  />
                  <Button
                    icon="fa-solid fa-folder-open"
                    rounded
                    text
                    size="small"
                    tooltip="Documentos"
                    tooltipOptions={{ position: "top" }}
                    onClick={() => setDocsMaterial(m)}
                  />
                  <Button
                    icon="fa-solid fa-pencil"
                    rounded
                    text
                    size="small"
                    tooltip="Editar material"
                    tooltipOptions={{ position: "left" }}
                    onClick={() => editarMaterial(m)}
                  />
                  {m.activo === false ? (
                    <Button
                      icon="fa-solid fa-rotate-left"
                      rounded
                      text
                      severity="success"
                      size="small"
                      tooltip="Restaurar material"
                      tooltipOptions={{ position: "left" }}
                      onClick={() => restaurarMaterial(m)}
                    />
                  ) : (
                    <Button
                      icon="fa-solid fa-trash"
                      rounded
                      text
                      severity="danger"
                      size="small"
                      tooltip="Borrar material"
                      tooltipOptions={{ position: "left" }}
                      onClick={() => confirmarBorrado(m)}
                    />
                  )}
                </div>
              )}
            />
          </DataTable>
        )}

        {/* Dialog de documentos */}
        <MaterialDocumentos
          visible={!!docsMaterial}
          onHide={() => setDocsMaterial(null)}
          materialTipo={docsMaterial ? SOURCE_TO_TIPO[docsMaterial._source] || "" : ""}
          materialId={docsMaterial ? docsMaterial._sourceId : null}
          materialNombre={docsMaterial ? docsMaterial.nombre : ""}
        />

        {/* Dialog de precios */}
        <MaterialPrecioPanel
          visible={!!preciosMaterial}
          onHide={() => setPreciosMaterial(null)}
          materialSource={preciosMaterial ? preciosMaterial._source : null}
          materialSourceId={preciosMaterial ? preciosMaterial._sourceId : null}
          materialNombre={preciosMaterial ? preciosMaterial.nombre : ""}
        />

        {/* Dialog de importación masiva de precios */}
        <MaterialPrecioImportDialog
          visible={importPreciosVisible}
          onHide={() => setImportPreciosVisible(false)}
          materiales={materiales}
          onImported={() => fetchMateriales(tipoActivo, showArchived)}
        />

        {/* Dialog de ficha técnica (agregados) */}
        <FichaTecnicaModal
          visible={!!fichaTecnicaMaterial}
          onHide={() => setFichaTecnicaMaterial(null)}
          legacyAgregadoId={fichaTecnicaMaterial?._sourceId}
          agregadoNombre={fichaTecnicaMaterial?.nombre}
          agregadoTipo={fichaTecnicaMaterial?.detalle?.split(' — ')[0] || null}
        />
      </div>
    </Fade>
  );
};

export default MaterialList;
