// src/components/admin/despacho/uikit/AdminMuestra.jsx
import React, { useEffect, useMemo, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Fade } from "react-awesome-reveal";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import { useToast } from "../../../context/ToastContext";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import CellFade from "../empleado/uikit/CellFade";
import { formatDate, formatNumber, isOnPhone } from "../../../common/functions";
import { useUserContext } from "../../../context/UserContext";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import { useConfig } from "../../../context/ConfigContext";
import { generarFichaMuestraPdf } from "./fichaMuestraPdf";
import { SelectButton } from "primereact/selectbutton";
import {
  FORMATO_OPCIONES as ETIQ_FORMATO_OPCIONES,
  imprimirYMarcar as imprimirEtiquetasYMarcar,
  mensajeResultadoEtiquetas,
} from "../../../lib/etiquetasProbeta";
import './muestra.css'
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { useMenuContext } from "../../../context/MenuContext";
import WizardMuestras from "./WizardMuestras";
import "./WizardMuestras.css";
import DespachoSelectorDialog from "./uikit/DespachoSelectorDialog";

const origenOptions = [
  { label: 'Propias',  value: 'propio' },
  { label: 'Terceros', value: 'tercero' },
  { label: 'Pastones', value: 'paston' },
];

const muestraFecha = (m) => m?.fecha ?? m?.despacho?.fecha;
const muestraCliente = (m) => m?.cliente ?? m?.despacho?.cliente;
const muestraPlanta = (m) => m?.planta ?? m?.despacho?.planta;
const muestraTipoHormigon = (m) =>
  m?.tipoHormigon?.tipoHormigon ??
  m?.dosificacion?.tipoHormigon?.tipoHormigon ??
  m?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;

const clienteNombre = (cliente) => {
  if (!cliente) return null;
  return cliente.tipoPersona === 'Jurídica' ? cliente.razonSocial : cliente.nombre;
};

/**
 * Refactor 2026-05-20 — admite render embebido en `MuestrasPage` con
 * buscador compartido.
 * Props:
 *  - embedded: si true, oculta PageHeader y SelectButton (los pone el wrapper).
 *  - searchTerm / onSearchChange: si vienen, el buscador es controlado.
 */
const AdminMuestra = ({ embedded = false, searchTerm, onSearchChange } = {}) => {
  // Estados locales
  const [muestras, setMuestras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [delLoad, setDelLoad] = useState(false);
  const [searchLocal, setSearchLocal] = useState("");
  const isSearchControlled = typeof searchTerm === 'string';
  const search = isSearchControlled ? searchTerm : searchLocal;
  const setSearch = isSearchControlled
    ? (v) => onSearchChange?.(typeof v === 'function' ? v(searchTerm) : v)
    : setSearchLocal;
  const [first, setFirst] = useState(0);
  const [page, setPage] = useState(0);
  const [plantaFilter, setPlantaFilter] = useState("TODAS");
  const [confirmDialogVisible, setConfirmDialogVisible] = useState(false);
  const [selectedMuestra, setSelectedMuestra] = useState(null);
  const [loteNumero, setLoteNumero] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [piletasPlanta, setPiletasPlanta] = useState([]);
  const [idPiletaConfirm, setIdPiletaConfirm] = useState(null);

  // 2026-05-28 — multi-select para imprimir etiquetas QR de las probetas de
  // todas las muestras seleccionadas. Reusa el mismo PDF y el mismo backend
  // que la vista "Etiquetas pendientes".
  const [seleccionMuestras, setSeleccionMuestras] = useState([]);
  const [formatoEtiqueta, setFormatoEtiqueta] = useState('a4');
  const [imprimiendoEtiquetas, setImprimiendoEtiquetas] = useState(false);

  // Selector de despacho previo a crear una muestra propia. Permite indicar
  // a qué despacho corresponde la muestra fresca / probetas (ver
  // DespachoSelectorDialog). La muestra se crea por Calidad sin pasar por el
  // guardado del despacho (que requiere rol de Producción "Coordinador").
  const [selectorDespachoVisible, setSelectorDespachoVisible] = useState(false);

  // Wizard de configuración asistida (modelo Liquidaciones)
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("muestras_wizard_paused") === "1"
  );

  useEffect(() => {
    const sync = () => setSetupWizardPaused(localStorage.getItem("muestras_wizard_paused") === "1");
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [setupWizardVisible]);

  const descartarSetupWizard = () => {
    localStorage.removeItem("muestras_wizard_step");
    localStorage.removeItem("muestras_wizard_paused");
    setSetupWizardPaused(false);
  };

  const toast = useToast();
  const navigate = useNavigate();

  const { user } = useUserContext();
  const { getActions } = useMenuContext();
  const { puedeAgregar } = getActions('/calidad/ensayos/muestras');
  // Bloque 1 RBAC (auditoría 08): los nombres "Operario" y "Plantista" eran de
  // un sistema legacy y no coincidían con los roles canónicos
  // (OPERADOR/RESPONSABLE_CALIDAD/...). Migramos a useCanPerform que consulta
  // la matriz central de acciones.
  const can = useCanPerform(user);
  const puedeConfirmar = can('muestra.confirmar');
  const puedeEliminar  = can('muestra.eliminar');
  const cfgEmpresa = useConfig();
  const [fichaLoad, setFichaLoad] = useState(false);

  // N-06 (auditoría 08): genera el PDF "Ficha de muestra".
  const descargarFicha = async (idMuestra) => {
    try {
      setFichaLoad(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/muestras/${idMuestra}/ficha`,
        { headers: config.headers }
      );
      const { buffer, filename } = await generarFichaMuestraPdf(data, {
        nombreEmpresa: cfgEmpresa?.nombreEmpresa || 'HormiQual',
        direccion: cfgEmpresa?.direccion,
        logoLink: cfgEmpresa?.logoLink || cfgEmpresa?.logoLightLink || null,
      });
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('success', 'Ficha generada');
    } catch (err) {
      console.error('Error generando ficha:', err);
      toast('error', err.response?.data?.error || err.message || 'No se pudo generar la ficha');
    } finally {
      setFichaLoad(false);
    }
  };

  const estadoLabels = {
    false: "Pendiente",
    true: "Confirmada",
  };

  const visiblePlantaIds = useMemo(() => {                           // ★
    if (user?.plantaIds?.length) return user.plantaIds.map(Number);
    if (user?.allPlantas?.length)
      return user.allPlantas.map((p) => Number(p.idPlanta));
    return [];
  }, [user]);

  const extraerLote = (nombre = '') => {
    if (!nombre) return null;
    const fin = /\d/.test(nombre[2]) ? 3
      : 2;
    return parseInt(nombre.substring(1, fin), 10);
  };


  const estadoStyle = (id) => {
    switch (id) {
      case false: // Pendiente
        return { background: "#fee2e2", color: "#b91c1c" };
      case true: // Confirmada
        return { background: "#d1fae5", color: "#047857" };
    }
  };

  // Cargar todas las muestras desde el backend
  const loadMuestras = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${config.backendUrl}/api/muestras`, {
        headers: config.headers,
      });
      setMuestras(data);
    } catch (error) {
      console.error("Error al cargar muestras:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMuestras();
  }, []);

  const abrirConfirmacion = async (muestra) => {
    setSelectedMuestra(muestra);
    setLoteNumero(extraerLote(muestra.probetas?.[0]?.nombre));
    setIdPiletaConfirm(null);
    const plantaId = muestraPlanta(muestra)?.idPlanta;
    if (plantaId) {
      try {
        const { data } = await axios.get(`${config.backendUrl}/api/piletas/planta/${plantaId}`, { headers: config.headers });
        setPiletasPlanta(data);
      } catch { setPiletasPlanta([]); }
    } else {
      setPiletasPlanta([]);
    }
    setConfirmDialogVisible(true);
  };

  const confirmarMuestra = async () => {
    if (!selectedMuestra) return;
    try {
      setConfirmLoading(true);
      const { data } = await axios.put(
        `${config.backendUrl}/api/muestras/confirmar/${selectedMuestra.idMuestra}`,
        { loteNumero, idPileta: idPiletaConfirm || null },
        { headers: config.headers }
      );
      setMuestras((prev) =>
        prev.map((m) =>
          m.idMuestra === selectedMuestra.idMuestra ? data : m
        )
      );
      toast("success", "Muestra confirmada");
      setConfirmDialogVisible(false);
    } catch (error) {
      console.error("Error al confirmar muestra:", error);
      toast("error", error.response.data.message);
    } finally {
      setConfirmLoading(false);
    }
  };

  // Función para borrar una muestra
  const borrarMuestra = async (id) => {
    try {
      setDelLoad(true);
      await axios.delete(`${config.backendUrl}/api/muestras/${id}`, {
        headers: config.headers,
      });
      setMuestras((prev) => prev.filter((m) => m.idMuestra !== id));
      toast("success", "Muestra eliminada");
    } catch (error) {
      console.error("Error al borrar muestra:", error);
      toast("error", "Error al eliminar");
    } finally {
      setDelLoad(false);
    }
  };

  const confirmarBorrado = (id) =>
    confirmDialog({
      header: "Eliminar muestra",
      message:
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}></i>
          <span>
            ¿Estás seguro que quieres borrar esta muestra?
          </span>
        </div>,
      acceptClassName: "p-button-danger",
      acceptLabel: (
        <span>
          <i className="fa-solid fa-trash mr-2" />
          Borrar
        </span>
      ),
      accept: () => borrarMuestra(id),
      rejectLabel: "Cancelar",
    });

  // Filtrar la lista según el término de búsqueda (por fecha)
  const filteredMuestras = muestras.filter((m) => {
    const fecha = formatDate(muestraFecha(m));
    const cliente = clienteNombre(muestraCliente(m));

    return (
      fecha.toLowerCase().includes(search.toLowerCase()) ||
      String(m.idMuestra).includes(search) ||
      cliente?.toLowerCase().includes(search.toLowerCase())
    );
  });
  /* ── Opciones de planta (derivadas de las muestras visibles del usuario) ── */
  const plantaOptions = useMemo(() => {
    const byId = new Map();
    muestras.forEach((m) => {
      const p = muestraPlanta(m);
      if (p?.idPlanta == null || byId.has(p.idPlanta)) return;
      // Respetar las plantas autorizadas del usuario.
      if (visiblePlantaIds.length && !visiblePlantaIds.includes(p.idPlanta)) return;
      byId.set(p.idPlanta, { label: p.nombre || `Planta ${p.idPlanta}`, value: p.idPlanta });
    });
    const plantas = Array.from(byId.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "es-AR")
    );
    return [{ label: "Todas las plantas", value: "TODAS" }, ...plantas];
  }, [muestras, visiblePlantaIds]);

  const muestrasVisibles = useMemo(() => {                           // ★
    let list = filteredMuestras;
    // Recorte por plantas autorizadas del usuario.
    if (visiblePlantaIds.length) {
      list = list.filter((p) => visiblePlantaIds.includes(muestraPlanta(p)?.idPlanta));
    }
    // Filtro explícito elegido en el dropdown.
    if (plantaFilter !== "TODAS") {
      list = list.filter((p) => muestraPlanta(p)?.idPlanta === plantaFilter);
    }
    return list;
  }, [filteredMuestras, visiblePlantaIds, plantaFilter]);
  // Manejar la paginación de la tabla
  const handlePage = (e) => {
    setPage(e.page);
    setFirst(e.first);
  };

  // 2026-05-28 — limpiar selección al cambiar búsqueda (los items pueden
  // dejar de estar visibles y seguir contando como seleccionados).
  useEffect(() => {
    setSeleccionMuestras([]);
  }, [search, plantaFilter]);

  /**
   * 2026-05-28 — Imprimir etiquetas QR de TODAS las probetas activas
   * (CURANDO/PENDIENTE) de las muestras seleccionadas. El backend (POST
   * /api/probetas/etiquetas-por-muestras) hace el join y filtra estados.
   * Tras imprimir, marca las probetas como impresas.
   */
  const imprimirEtiquetasMuestrasSeleccionadas = async () => {
    if (seleccionMuestras.length === 0) {
      toast('warn', 'Seleccioná al menos una muestra');
      return;
    }
    const idsMuestra = seleccionMuestras.map((m) => m.idMuestra);
    const ejecutar = async () => {
      try {
        setImprimiendoEtiquetas(true);
        const { data: probetas } = await axios.post(
          `${config.backendUrl}/api/probetas/etiquetas-por-muestras`,
          { idsMuestra },
          { headers: config.headers },
        );
        if (!Array.isArray(probetas) || probetas.length === 0) {
          toast('warn', 'Las muestras seleccionadas no tienen probetas activas (curando/pendientes)');
          return;
        }
        const res = await imprimirEtiquetasYMarcar(probetas, { formato: formatoEtiqueta });
        const { severity, mensaje } = mensajeResultadoEtiquetas(res);
        toast(severity, `${mensaje} (${idsMuestra.length} muestra(s))`);
        setSeleccionMuestras([]);
      } catch (err) {
        console.error('Error generando etiquetas QR desde muestras:', err);
        const data = err.response?.data;
        const msg = data?.detail
          ? `${data.error || 'Error'}: ${data.detail}`
          : (data?.error || 'No se pudieron generar las etiquetas');
        toast('error', msg);
      } finally {
        setImprimiendoEtiquetas(false);
      }
    };
    if (idsMuestra.length > 50) {
      confirmDialog({
        header: 'Confirmar impresión masiva',
        message: (
          <div className="p-3">
            <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
            Vas a generar etiquetas para las probetas de <strong>{idsMuestra.length} muestras</strong>.
            Si querés acotar, deseleccioná muestras antes de continuar.
          </div>
        ),
        acceptLabel: 'Generar',
        rejectLabel: 'Cancelar',
        acceptClassName: 'p-button-warning',
        accept: ejecutar,
      });
      return;
    }
    ejecutar();
  };


  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  // Refactor 2026-05-20 — modo embebido en MuestrasPage (sin header propio).
  const Container = embedded ? React.Fragment : Fade;
  const containerProps = embedded ? {} : { direction: "up", duration: 500, triggerOnce: true };

  return (
    <Container {...containerProps}>
      <Dialog
        visible={confirmDialogVisible}
        onHide={() => setConfirmDialogVisible(false)}
        className="w-11 xl:w-4"
        header='Confirmar lote'
        footer={
          <div className="flex justify-content-center mt-4 w-full">
            <Button
              label="Confirmar"
              icon="fa-solid fa-check"
              size="small"
              rounded
              severity="success"
              className="mr-2"
              loading={confirmLoading}
              onClick={confirmarMuestra}
            />
            <Button
              label="Cancelar"
              icon="fa-solid fa-xmark"
              size="small"
              rounded
              text
              severity="danger"
              onClick={() => setConfirmDialogVisible(false)}
            />
          </div>
        }
      >
        <div className="p-4 flex flex-column">
          <div className="flex w-full align-items-center">
            <span className="text-center w-6">Confirmar la siguiente muestra con el lote número:</span>
            <div className="flex flex-column text-center">
              <small className="mb-2">Lote n°</small>
              <InputNumber value={loteNumero} onChange={(e) => setLoteNumero(e.value)} maxFractionDigits={3} inputClassName="lote-input" size={2} />
            </div>
          </div>
          {piletasPlanta.length > 0 && (
            <div className="flex flex-column mt-4">
              <label className="mb-2">Pileta de curado</label>
              <Dropdown
                value={idPiletaConfirm}
                onChange={(e) => setIdPiletaConfirm(e.value)}
                options={piletasPlanta.map(pl => ({ label: pl.nombre, value: pl.idPileta }))}
                placeholder="Seleccionar pileta (opcional)"
                showClear
                className="w-full"
              />
            </div>
          )}
        </div>
      </Dialog>
      {/* Sesión 2026-05-28: padding condicional por `embedded`. Cuando este
          componente vive dentro de MuestrasPage (modo embedded), el wrapper
          de la página ya aplica el `xl:p-6 xl:pl-0 xl:pt-0`. Si repetimos el
          mismo padding acá adentro se DUPLICA el margen derecho (~48 px en
          xl) y la tabla recorta el botón de borrar de la última columna.
          Mismo patrón que ya usaban muestraTerceros.jsx:310 y
          muestraPaston.jsx:300. */}
      <div className={embedded
        ? "w-full flex flex-column align-items-start"
        : "w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0"}>
        {/* Banner de wizard pausado */}
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

        {!embedded && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <PageHeader
              icon="fa-solid fa-vials"
              title="Muestras"
              subtitle="Gestión de muestras de hormigón para control de calidad"
            />
            <Button
              label="Configurar"
              icon="fa-solid fa-wand-magic-sparkles"
              size="small"
              outlined
              severity="success"
              className="mant-wizard-btn"
              onClick={() => setSetupWizardVisible(true)}
              tooltip="Asistente paso a paso del ciclo completo de muestras y ensayos"
              tooltipOptions={{ position: "left" }}
            />
          </div>
        )}

        <WizardMuestras
          visible={setupWizardVisible}
          onClose={() => setSetupWizardVisible(false)}
          onFinish={() => { setSetupWizardVisible(false); loadMuestras(); }}
        />

        <DespachoSelectorDialog
          visible={selectorDespachoVisible}
          onHide={() => setSelectorDespachoVisible(false)}
          onSelect={(idDespacho) => {
            setSelectorDespachoVisible(false);
            navigate(`/calidad/ensayos/muestras/nueva?idDespacho=${idDespacho}`);
          }}
          onSinDespacho={() => {
            setSelectorDespachoVisible(false);
            navigate('/calidad/ensayos/muestras/nueva');
          }}
        />

        {/* Selector de origen — solo cuando no está embebido (el wrapper lo provee) */}
        {!embedded && (
          <div className="flex w-full align-items-center mb-2 mt-2">
            <SelectButton
              value="propio"
              options={origenOptions}
              onChange={(e) => {
                if (e.value === 'tercero') navigate('/calidad/ensayos/muestras-terceros');
                else if (e.value === 'paston') navigate('/calidad/ensayos/muestras-pastones');
              }}
            />
          </div>
        )}

        {muestras.length ? (
          <>
            {/* Barra de búsqueda y botón para crear nueva muestra */}
            <div className="flex align-items-center w-full mb-2 gap-2 flex-wrap justify-content-between">
              <div className="flex align-items-center gap-2 flex-wrap">
                <span className="search-bar-wrapper">
                  <InputText
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar muestra..."
                    title="Buscar por código, tipo H° o cliente"
                    className="search-bar"
                  />
                </span>
                {plantaOptions.length > 2 && (
                  <Dropdown
                    value={plantaFilter}
                    options={plantaOptions}
                    onChange={(e) => { setPlantaFilter(e.value); setFirst(0); }}
                    title="Filtrar por planta"
                    style={{ minWidth: "12rem" }}
                  />
                )}
              </div>
              <div className="flex align-items-center gap-2 flex-wrap">
                {/* 2026-05-28 — etiquetas QR de las probetas activas de las
                    muestras tildadas. Útil cuando el operario olvidó imprimir
                    al moldear o necesita reimprimir un lote específico. */}
                <Dropdown
                  value={formatoEtiqueta}
                  options={ETIQ_FORMATO_OPCIONES}
                  onChange={(e) => setFormatoEtiqueta(e.value)}
                  style={{ minWidth: '18rem' }}
                  tooltip="Formato de las etiquetas (PDF o impresión directa Zebra)"
                  tooltipOptions={{ position: 'top' }}
                />
                <Button
                  label={imprimiendoEtiquetas ? 'Generando…' : 'Etiquetas QR'}
                  icon="fa-solid fa-qrcode"
                  outlined
                  severity="secondary"
                  size="small"
                  disabled={seleccionMuestras.length === 0 || imprimiendoEtiquetas}
                  onClick={imprimirEtiquetasMuestrasSeleccionadas}
                  tooltip={
                    seleccionMuestras.length === 0
                      ? 'Tildá una o más muestras para habilitar la impresión'
                      : `Imprimir etiquetas QR de todas las probetas activas de las ${seleccionMuestras.length} muestra(s) seleccionada(s)`
                  }
                  tooltipOptions={{ position: 'top' }}
                />
                <Button
                  label="Nueva"
                  icon="fa-solid fa-plus"
                  rounded
                  size="small"
                  onClick={() => setSelectorDespachoVisible(true)}
                  style={{ display: puedeAgregar === false ? 'none' : null }}
                />
              </div>
            </div>

            {/* Tabla de muestras */}
            <DataTable
              value={muestrasVisibles}
              emptyMessage={<h3>No hay coincidencias</h3>}
              stripedRows
              paginator
              rows={50}
              first={first}
              onPage={handlePage}
              pageLinkSize={isOnPhone ? 2 : 6}
              className="w-full"
              selectionMode="multiple"
              selection={seleccionMuestras}
              onSelectionChange={(e) => setSeleccionMuestras(e.value)}
              dataKey="idMuestra"
            >
              <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
              <Column
                header="ID"
                body={(row) => (
                  <CellFade uniqueKey={`id-${page}-${row.idMuestra}`}>
                    {row.idMuestra}
                  </CellFade>
                )}
              />
              <Column
                header="Fecha"
                sort
                body={(row) => (
                  <CellFade uniqueKey={`fecha-${page}-${row.idMuestra}`}>
                    {formatDate(muestraFecha(row))}
                  </CellFade>
                )}
              />
              <Column
                header="Cliente"
                body={(r) => (
                  <CellFade uniqueKey={`thclient-${page}-${r.idMuestra}`}>
                    {clienteNombre(muestraCliente(r))}
                  </CellFade>
                )}
              />
              <Column
                header="Tipo H°"
                body={(r) => (
                  <CellFade uniqueKey={`th-${page}-${r.idMuestra}`}>
                    {muestraTipoHormigon(r)}
                  </CellFade>
                )}
              />
              <Column
                header="Volumen"
                body={(r) => (
                  <CellFade uniqueKey={`th-desp-${page}-${r.idMuestra}`}>
                    {r.despacho?.volumenDepacho ? `${r.despacho.volumenDepacho} m³` : '—'}
                  </CellFade>
                )}
              />
              <Column
                header="Lote"
                body={(row) => (
                  <CellFade uniqueKey={`lote-${page}-${row.idMuestra}`}>
                    {extraerLote(row.probetas?.[0]?.nombre)}
                  </CellFade>
                )}
              />
              <Column
                header="Remito"
                body={(r) => (
                  <CellFade uniqueKey={`th-rem-${page}-${r.idMuestra}`}>
                    {r.despacho?.remito || '—'}
                  </CellFade>
                )}
              />
              <Column
                header="Planta"
                sort
                body={(row) => (
                  <CellFade uniqueKey={`planta-${page}-${row.idMuestra}`}>
                    {muestraPlanta(row)?.nombre}
                  </CellFade>
                )}
              />

              <Column
                header="Cant. Probetas"
                body={(row) => (
                  <CellFade uniqueKey={`probetas-${page}-${row.idMuestra}`}>
                    {formatNumber(row.cantidadProbetas)}
                  </CellFade>
                )}
              />
              <Column
                header="Estado"
                body={(row) => (
                  <CellFade uniqueKey={`estado-${page}-${row.idMuestra}`}>
                    <span
                      style={{
                        ...estadoStyle(row.estado),
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 550,
                        minWidth: 100,
                        textAlign: "center",
                      }}
                    >
                      {estadoLabels[row.estado] || "-"}
                    </span>
                  </CellFade>
                )}
              />

              <Column
                header="Acciones"
                body={(row) => (
                  <CellFade uniqueKey={`acciones-${page}-${row.idMuestra}`}>
                    <div className="font-bold flex w-full justify-content-center">
                      {
                        !row.estado && puedeConfirmar && (
                          <Button
                            rounded
                            icon="fa-solid fa-check"
                            className="mr-2"
                            size="small"
                            severity="success"
                            tooltip="Confirmar muestra (asigna número de lote)"
                            tooltipOptions={{ position: 'top' }}
                            onClick={() => abrirConfirmacion(row)}
                          />
                        )
                      }
                      <Button
                        rounded
                        icon="fa-solid fa-pencil"
                        className="mr-2"
                        size="small"
                        onClick={() =>
                          navigate(`/calidad/ensayos/muestras/editar/${row.idMuestra}`)
                        }
                      />
                      <Button
                        rounded
                        icon="fa-solid fa-file-pdf"
                        className="mr-2"
                        size="small"
                        severity="info"
                        loading={fichaLoad}
                        tooltip="Ficha de muestra (PDF)"
                        tooltipOptions={{ position: 'top' }}
                        onClick={() => descargarFicha(row.idMuestra)}
                      />
                      {puedeEliminar && (
                        <Button
                          rounded
                          icon="fa-solid fa-trash"
                          severity="danger"
                          size="small"
                          loading={delLoad}
                          onClick={() => confirmarBorrado(row.idMuestra)}
                        />
                      )}
                    </div>
                  </CellFade>
                )}
              />
            </DataTable>
          </>
        ) : (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center cursor-pointer" onClick={() => navigate("/calidad/ensayos/muestras/nueva")}>
            <h2 className="mb-2 mt-0">Aún no hay muestras</h2>
            <span>
              Crea tu primera muestra o registrá un despacho con muestreo
            </span>
          </div>
        )}
      </div>
    </Container>
  );
};

export default AdminMuestra;
