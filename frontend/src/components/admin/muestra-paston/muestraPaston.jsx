import React, { useEffect, useMemo, useState, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { Fade } from "react-awesome-reveal";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import ProbetasPastonEditor from "./ProbetasPastonEditor";
import axios from "axios";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useNavigate } from "react-router-dom";
import { formatDate, formatNumber, isOnPhone } from "../../../common/functions";
import { useUserContext } from "../../../context/UserContext";
import { useConfig } from "../../../context/ConfigContext";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import { generarFichaMuestraPdf } from "../muestra/fichaMuestraPdf";
import { listarMedicionesPaston } from "../../../services/dosificacionDisenoService";
import { SelectButton } from "primereact/selectbutton";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";

/**
 * Listado de Muestras de Pastón (sesión 2026-06-12).
 *
 * Tercera fuente de probetas: las moldeadas durante un pastón de prueba
 * quedan agrupadas en `MuestraPaston` con `origen` (PLANTA/OBRA) y nombre
 * autogenerado `T{lote}-{O|P}-P{n}`. Se crean automáticamente al guardar el
 * pastón desde `PastonPruebaSection`. Esta pantalla es solo de consulta.
 */

const origenOptions = [
  { label: 'Propias',  value: 'propio' },
  { label: 'Terceros', value: 'tercero' },
  { label: 'Pastones', value: 'paston' },
];

const ORIGEN_LABEL = {
  PLANTA: 'Planta',
  OBRA: 'Obra',
};

const ORIGEN_SEVERITY = {
  PLANTA: 'info',
  OBRA: 'warning',
};

/**
 * Refactor 2026-05-20 — admite render embebido en `MuestrasPage`.
 */
const AdminMuestraPaston = ({ embedded = false, searchTerm, onSearchChange } = {}) => {
  const [muestras, setMuestras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchLocal, setSearchLocal] = useState("");
  const isSearchControlled = typeof searchTerm === 'string';
  const search = isSearchControlled ? searchTerm : searchLocal;
  const setSearch = isSearchControlled
    ? (v) => onSearchChange?.(typeof v === 'function' ? v(searchTerm) : v)
    : setSearchLocal;
  const [first, setFirst] = useState(0);
  const [page, setPage] = useState(0);

  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useUserContext();
  const cfgEmpresa = useConfig();
  const can = useCanPerform(user);
  const puedeEliminar = can('muestra.eliminar');
  const puedeEditar = can('muestra.editar');
  const [fichaLoad, setFichaLoad] = useState(false);

  // Ficha PDF de la muestra de pastón. Reusa el generador de la ficha de
  // muestra (`fichaMuestraPdf`) — el backend devuelve el mismo shape con
  // `esPaston: true`, así el PDF adapta la sección de Identificación.
  const descargarFicha = async (idMuestraPaston) => {
    try {
      setFichaLoad(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/muestras-pastones/${idMuestraPaston}/ficha`,
        { headers: config.headers }
      );
      const { buffer, filename } = await generarFichaMuestraPdf(data, {
        nombreEmpresa: cfgEmpresa?.nombreEmpresa || 'HormiQual',
        direccion: cfgEmpresa?.direccion,
        logoLink: cfgEmpresa?.logoLink || cfgEmpresa?.logoLightLink || null,
      }, {
        tituloDocumento: 'Ficha de pastón de prueba',
        subtituloDocumento: 'Resumen del moldeo y curado de probetas del pastón',
        filenamePrefix: 'Ficha_paston',
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
      console.error('Error generando ficha de pastón:', err);
      toast('error', err.response?.data?.error || err.message || 'No se pudo generar la ficha');
    } finally {
      setFichaLoad(false);
    }
  };

  // Edición de probetas de una muestra de pastón.
  const [editarMuestra, setEditarMuestra] = useState(null);
  const [probetasEdit, setProbetasEdit] = useState([]);
  const [tiposProbeta, setTiposProbeta] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const savingEditRef = useRef(false);
  // Mediciones del pastón asociadas a la muestra abierta + selección de la
  // medición vinculada (idMedicionPaston). Persistir esto le dice al sistema
  // "esta muestra se moldeó cuando el timeline estaba en esta medición" → el
  // PDF saca el slump/T° del fresco de la medición. Antes el campo existía en
  // el modelo pero no tenía UI para editar (sesión 2026-05-27).
  const [medicionesPaston, setMedicionesPaston] = useState([]);
  const [medicionVinculadaId, setMedicionVinculadaId] = useState(null);
  const [medicionesLoading, setMedicionesLoading] = useState(false);
  // Dialog de visualización del pastón asociado (timeline).
  const [verPaston, setVerPaston] = useState(null);
  const [verPastonMediciones, setVerPastonMediciones] = useState([]);
  const [verPastonLoading, setVerPastonLoading] = useState(false);

  const abrirEditor = async (m) => {
    setEditarMuestra(m);
    setProbetasEdit(Array.isArray(m.probetas) ? m.probetas : []);
    setMedicionVinculadaId(m.idMedicionPaston ?? null);
    if (!tiposProbeta.length) {
      try {
        const { data } = await axios.get(`${config.backendUrl}/api/muestras/tipoprobeta`, { headers: config.headers });
        setTiposProbeta(data || []);
      } catch (err) {
        console.error("Error cargando tipos de probeta:", err);
      }
    }
    // Traer las mediciones del pastón para que el operador pueda elegir cuál
    // representa el momento del moldeo de esta muestra.
    if (m.idPastonPrueba) {
      try {
        setMedicionesLoading(true);
        const meds = await listarMedicionesPaston(m.idPastonPrueba);
        setMedicionesPaston(Array.isArray(meds) ? meds : []);
      } catch (err) {
        console.error("Error cargando mediciones del pastón:", err);
        setMedicionesPaston([]);
      } finally {
        setMedicionesLoading(false);
      }
    } else {
      setMedicionesPaston([]);
    }
  };

  // Abre un Dialog read-only con el timeline del pastón asociado a una muestra.
  const abrirVerPaston = async (m) => {
    if (!m?.idPastonPrueba) {
      toast('warn', 'La muestra no tiene un pastón asociado');
      return;
    }
    setVerPaston(m);
    try {
      setVerPastonLoading(true);
      const meds = await listarMedicionesPaston(m.idPastonPrueba);
      setVerPastonMediciones(Array.isArray(meds) ? meds : []);
    } catch (err) {
      console.error("Error cargando timeline del pastón:", err);
      setVerPastonMediciones([]);
      toast('error', 'No se pudo cargar el timeline del pastón');
    } finally {
      setVerPastonLoading(false);
    }
  };

  const guardarProbetas = async () => {
    if (!editarMuestra) return;
    if (savingEditRef.current) return;
    try {
      savingEditRef.current = true;
      setSavingEdit(true);
      // 1) Actualizar el vínculo a la medición si cambió. NULL = sin medición
      //    vinculada explícita; el backend usará el fallback automático
      //    (última medición con etapa coincidente) al armar la ficha.
      if ((editarMuestra.idMedicionPaston ?? null) !== (medicionVinculadaId ?? null)) {
        await axios.put(
          `${config.backendUrl}/api/muestras-pastones/${editarMuestra.idMuestraPaston}`,
          { idMedicionPaston: medicionVinculadaId },
          { headers: config.headers }
        );
      }
      // 2) Sincronizar probetas (el endpoint cuenta creadas/eliminadas).
      const payload = (probetasEdit || []).map((p) => ({
        idProbeta: p.idProbeta ?? null,
        idTipoProbeta: p.idTipoProbeta ?? p.tipoProbeta?.idTipoProbeta ?? null,
        diasRotura: p.diasRotura ?? 28,
        codigo: p.codigo || null,
        observaciones: p.observaciones || null,
        idEstadoProbeta: p.idEstadoProbeta ?? 1,
      }));
      const { data } = await axios.put(
        `${config.backendUrl}/api/muestras-pastones/${editarMuestra.idMuestraPaston}/probetas`,
        { probetas: payload },
        { headers: config.headers }
      );
      toast(
        'success',
        `Muestra actualizada: probetas +${data?.creadas ?? 0} / −${data?.eliminadas ?? 0}` +
        (data?.bloqueadas ? ` (${data.bloqueadas} ensayada(s) intactas)` : '')
      );
      setEditarMuestra(null);
      await load();
    } catch (err) {
      console.error("Error al actualizar la muestra:", err);
      toast('error', err?.response?.data?.error || 'No se pudo actualizar la muestra');
    } finally {
      savingEditRef.current = false;
      setSavingEdit(false);
    }
  };

  const visiblePlantaIds = useMemo(() => {
    if (user?.plantaIds?.length) return user.plantaIds.map(Number);
    if (user?.allPlantas?.length) return user.allPlantas.map((p) => Number(p.idPlanta));
    return [];
  }, [user]);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${config.backendUrl}/api/muestras-pastones`, { headers: config.headers });
      setMuestras(data);
    } catch (err) {
      console.error("Error al cargar muestras de pastón:", err);
      toast('error', 'No se pudieron cargar las muestras de pastón');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleBorrar = async (id) => {
    try {
      await axios.delete(`${config.backendUrl}/api/muestras-pastones/${id}`, { headers: config.headers });
      setMuestras((prev) => prev.filter((m) => m.idMuestraPaston !== id));
      toast('success', 'Muestra eliminada');
    } catch (err) {
      console.error("Error al borrar muestra de pastón:", err);
      toast('error', 'Error al eliminar');
    }
  };

  const confirmarBorrado = (id) =>
    confirmDialog({
      header: "Eliminar muestra de pastón",
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }} />
          <span>¿Estás seguro que querés borrar esta muestra de pastón y sus probetas?</span>
        </div>
      ),
      acceptClassName: "p-button-danger",
      acceptLabel: <span><i className="fa-solid fa-trash mr-2" />Borrar</span>,
      accept: () => handleBorrar(id),
      rejectLabel: "Cancelar",
    });

  const filtradas = muestras.filter((m) => {
    const fecha = formatDate(m.fecha);
    const dosif = m.dosificacion?.nombre || '';
    return (
      fecha.toLowerCase().includes(search.toLowerCase())
      || String(m.idMuestraPaston).includes(search)
      || dosif.toLowerCase().includes(search.toLowerCase())
      || String(m.loteNumero).includes(search)
    );
  });

  const visibles = useMemo(() => {
    if (!visiblePlantaIds.length) return filtradas;
    return filtradas.filter((m) => visiblePlantaIds.includes(m.planta?.idPlanta));
  }, [filtradas, visiblePlantaIds]);

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  // Refactor 2026-05-20 — modo embebido en MuestrasPage.
  const Container = embedded ? React.Fragment : Fade;
  const containerProps = embedded ? {} : { direction: "up", duration: 500, triggerOnce: true };

  return (
    <Container {...containerProps}>
      <div className={embedded ? "w-full flex flex-column align-items-start" : "w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0"}>
        {!embedded && (
        <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
          <PageHeader
            icon="fa-solid fa-flask-vial"
            title="Muestras de pastón"
            subtitle="Probetas moldeadas durante un pastón de prueba (origen Planta u Obra)"
          />
          <SelectButton
            value="paston"
            options={origenOptions}
            onChange={(e) => {
              if (e.value === 'propio')  navigate('/calidad/ensayos/muestras');
              if (e.value === 'tercero') navigate('/calidad/ensayos/muestras-terceros');
            }}
            className="mb-2"
          />
        </div>
        )}

        {muestras.length ? (
          <>
            {/* Refactor 2026-05-20 — barra unificada al patrón de Muestras propias. */}
            <div className="flex align-items-center w-full mb-2 gap-2 justify-content-between">
              <span className="search-bar-wrapper">
                <InputText
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setFirst(0); }}
                  placeholder="Buscar muestra..."
                  title="Buscar por fecha, dosificación o lote"
                  className="search-bar"
                />
              </span>
            </div>
            <DataTable
              value={visibles}
              emptyMessage={<h3>No hay coincidencias</h3>}
              stripedRows
              paginator
              rows={50}
              first={first}
              onPage={(e) => { setPage(e.page); setFirst(e.first); }}
              pageLinkSize={isOnPhone ? 2 : 6}
              className="w-full"
            >
              <Column header="ID" body={(r) => r.idMuestraPaston} style={{ width: 70 }} />
              <Column header="Fecha" body={(r) => formatDate(r.fecha)} />
              <Column header="Lote" body={(r) => `T${r.loteNumero}`} style={{ width: 80 }} />
              <Column header="Origen" body={(r) => (
                <Tag value={ORIGEN_LABEL[r.origen] || r.origen} severity={ORIGEN_SEVERITY[r.origen] || 'info'} />
              )} style={{ width: 100 }} />
              {/* Enlace al pastón asociado: muestra el #N como botón link y
                  abre un dialog con el timeline (mediciones) del pastón. Permite
                  al operador ver de qué momento del moldeo viene esta muestra
                  sin tener que navegar al diseñador. */}
              <Column header="Pastón" body={(r) => (
                r.idPastonPrueba ? (
                  <Button
                    link
                    label={`#${r.idPastonPrueba}`}
                    icon="fa-solid fa-arrow-up-right-from-square"
                    iconPos="right"
                    size="small"
                    className="p-0"
                    tooltip="Ver timeline del pastón"
                    tooltipOptions={{ position: 'top' }}
                    onClick={() => abrirVerPaston(r)}
                  />
                ) : <span className="text-color-secondary">—</span>
              )} style={{ width: 110 }} />
              <Column header="Dosificación" body={(r) => r.dosificacion?.nombre || '—'} />
              <Column header="Planta" body={(r) => r.planta?.nombre || '—'} />
              <Column header="Tipo H°" body={(r) => (
                // Fallback chain (refactor 2026-05-20):
                //   1) idTipoHormigon directo en la muestra (post-backfill).
                //   2) idTipoHormigon en la DosificacionDisenada (post-refactor
                //      tipoHormigonIRAM1666).
                //   3) dosificacionCatalogo legacy (compat con catálogo viejo).
                r.tipoHormigon?.tipoHormigon
                || r.dosificacion?.tipoHormigon?.tipoHormigon
                || r.dosificacion?.dosificacionCatalogo?.tipoHormigon?.tipoHormigon
                || '—'
              )} />
              <Column header="Cant. Probetas" body={(r) => formatNumber(r.probetas?.length || 0)} style={{ width: 130, textAlign: 'center' }} />
              {/* Refactor 2026-05-20 — alineamos orden e iconografía con las pestañas
                  Propias y Terceros: pencil (editar) → PDF → trash. El botón de
                  editar usa el ícono pencil canónico aunque acá abre el editor de
                  probetas del pastón (no una página de edición separada como en
                  Propias). */}
              <Column header="Acciones" body={(r) => (
                <div className="font-bold flex w-full justify-content-center">
                  {puedeEditar && (
                    <Button
                      rounded
                      icon="fa-solid fa-pencil"
                      className="mr-2"
                      size="small"
                      tooltip="Editar probetas (cantidad / tipo / edad)"
                      tooltipOptions={{ position: 'top' }}
                      onClick={() => abrirEditor(r)}
                    />
                  )}
                  <Button
                    rounded
                    icon="fa-solid fa-file-pdf"
                    className="mr-2"
                    size="small"
                    severity="info"
                    loading={fichaLoad}
                    tooltip="Ficha de pastón (PDF) — detalle de probetas"
                    tooltipOptions={{ position: 'top' }}
                    onClick={() => descargarFicha(r.idMuestraPaston)}
                  />
                  {puedeEliminar && (
                    <Button
                      rounded
                      icon="fa-solid fa-trash"
                      severity="danger"
                      size="small"
                      tooltip="Eliminar muestra de pastón"
                      tooltipOptions={{ position: 'top' }}
                      onClick={() => confirmarBorrado(r.idMuestraPaston)}
                    />
                  )}
                </div>
              )} style={{ width: 150, textAlign: 'center' }} />
            </DataTable>
          </>
        ) : (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center">
            <h2 className="mb-2 mt-0">Aún no hay muestras de pastón</h2>
            <span>Se generan automáticamente al guardar un pastón de prueba con probetas planificadas.</span>
          </div>
        )}
      </div>

      <Dialog
        header={
          editarMuestra
            ? `Editar muestra — T${editarMuestra.loteNumero} · ${ORIGEN_LABEL[editarMuestra.origen] || editarMuestra.origen}`
            : "Editar muestra"
        }
        visible={!!editarMuestra}
        style={{ width: '90vw', maxWidth: '900px' }}
        onHide={() => !savingEdit && setEditarMuestra(null)}
        dismissableMask={!savingEdit}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" outlined disabled={savingEdit} onClick={() => setEditarMuestra(null)} />
            <Button
              label="Guardar"
              icon="fa-solid fa-floppy-disk"
              loading={savingEdit}
              disabled={savingEdit}
              onClick={guardarProbetas}
            />
          </div>
        }
      >
        {editarMuestra && (
          <>
            {/* Selector de medición vinculada (condición de mezcla al moldear).
                El valor seleccionado se persiste en MuestraPaston.idMedicionPaston
                y el backend usa esa medición como fuente de los datos del
                fresco (slump/temperatura/aire) en la ficha PDF. NULL = sin
                vínculo explícito; el backend cae a la última medición con
                etapa coincidente del timeline. */}
            <div className="surface-50 border-round p-3 mb-3" style={{ borderLeft: '3px solid var(--primary-color)' }}>
              <div className="font-bold text-sm mb-1">
                <i className="fa-solid fa-link mr-2" />Medición del timeline vinculada
              </div>
              <div className="text-xs text-color-secondary mb-2">
                Identifica en qué momento del pastón se moldeó esta muestra. Los datos
                de hormigón fresco (asentamiento, temperatura, aire) de la ficha se
                derivan de esa medición. Si dejás vacío, el sistema usa por defecto
                la última medición {editarMuestra.origen === 'OBRA' ? 'de obra' : 'de planta'} del timeline.
              </div>
              <Dropdown
                value={medicionVinculadaId}
                options={medicionesPaston.map((md, idx) => ({
                  value: md.id,
                  label: `Medición #${md.ordenSecuencia ?? idx + 1}`
                    + ` · ${md.etapa || '—'}`
                    + (md.etiqueta ? ` · ${md.etiqueta}` : '')
                    + (md.fechaHora ? ` · ${new Date(md.fechaHora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}` : '')
                    + (md.asentamientoMm != null ? ` · ${Number(md.asentamientoMm)} mm` : '')
                    + (md.temperaturaHormigonC != null ? ` · ${Number(md.temperaturaHormigonC)}°C` : ''),
                }))}
                onChange={(e) => setMedicionVinculadaId(e.value)}
                placeholder={medicionesLoading ? 'Cargando mediciones…' : (medicionesPaston.length ? 'Sin vínculo (default automático)' : 'El pastón aún no tiene mediciones cargadas')}
                showClear
                disabled={medicionesLoading || savingEdit}
                className="w-full"
              />
            </div>
            <ProbetasPastonEditor
              value={probetasEdit}
              tipos={tiposProbeta}
              disabled={savingEdit}
              onChange={setProbetasEdit}
            />
          </>
        )}
      </Dialog>

      {/* Dialog read-only para ver el timeline del pastón asociado a una muestra. */}
      <Dialog
        header={verPaston ? `Pastón #${verPaston.idPastonPrueba} — Timeline` : 'Pastón'}
        visible={!!verPaston}
        style={{ width: '90vw', maxWidth: '900px' }}
        onHide={() => setVerPaston(null)}
        dismissableMask
      >
        {verPaston && (
          <div>
            <div className="grid mb-3">
              <div className="col-12 md:col-4">
                <div className="text-xs text-color-secondary">Pastón</div>
                <div className="font-bold">#{verPaston.idPastonPrueba}</div>
              </div>
              <div className="col-12 md:col-4">
                <div className="text-xs text-color-secondary">Fecha</div>
                <div className="font-bold">{formatDate(verPaston.fecha)}</div>
              </div>
              <div className="col-12 md:col-4">
                <div className="text-xs text-color-secondary">Muestra</div>
                <div className="font-bold">T{verPaston.loteNumero} · {ORIGEN_LABEL[verPaston.origen] || verPaston.origen}</div>
              </div>
            </div>

            <div className="font-bold text-sm mb-2">
              <i className="fa-solid fa-timeline mr-2 text-primary" />
              Mediciones del timeline
            </div>
            {verPastonLoading ? (
              <div className="text-color-secondary text-sm">
                <i className="fa-solid fa-spinner fa-spin mr-2" />Cargando timeline…
              </div>
            ) : verPastonMediciones.length === 0 ? (
              <div className="surface-100 border-round p-3 text-sm text-color-secondary">
                Este pastón aún no tiene mediciones cargadas. Cargalas desde el diseñador
                (sección "Timeline del pastón" dentro del pastón de prueba).
              </div>
            ) : (() => {
              // Calcular qué medición está "en uso" como fuente del fresco del
              // PDF. Si la muestra tiene idMedicionPaston explícito, esa.
              // Si NO, el backend deriva: PLANTA → última PLANTA; OBRA → última
              // OBRA con fallback a TRANSPORTE. Replicamos esa lógica acá para
              // que el operador entienda qué se está usando sin tener que
              // generar el PDF.
              const ordenadas = [...verPastonMediciones].sort((a, b) => (a.ordenSecuencia || 0) - (b.ordenSecuencia || 0));
              let idEnUso = verPaston.idMedicionPaston ?? null;
              let modoVinculo = idEnUso != null ? 'explicito' : null;
              if (idEnUso == null) {
                const etapasPref = verPaston.origen === 'OBRA' ? ['OBRA', 'TRANSPORTE'] : ['PLANTA'];
                for (const etapa of etapasPref) {
                  const candidatas = ordenadas.filter((m) => m.etapa === etapa);
                  if (candidatas.length) {
                    idEnUso = candidatas[candidatas.length - 1].id;
                    modoVinculo = 'derivado';
                    break;
                  }
                }
              }
              return (
                <>
                  <DataTable
                    value={ordenadas}
                    size="small"
                    className="w-full text-sm"
                    rowClassName={(row) => row.id === idEnUso ? 'bg-primary-50' : ''}
                  >
                    <Column header="#" body={(r) => r.ordenSecuencia} style={{ width: 60 }} />
                    <Column header="Etapa" body={(r) => (
                      <Tag value={ORIGEN_LABEL[r.etapa] || r.etapa} severity={ORIGEN_SEVERITY[r.etapa] || 'secondary'} />
                    )} />
                    <Column header="Etiqueta" body={(r) => r.etiqueta || '—'} />
                    <Column header="Hora" body={(r) => r.fechaHora ? new Date(r.fechaHora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'} />
                    <Column header="Slump" body={(r) => r.asentamientoMm != null ? `${Number(r.asentamientoMm)} mm` : '—'} />
                    <Column header="T° H°" body={(r) => r.temperaturaHormigonC != null ? `${Number(r.temperaturaHormigonC)}°C` : '—'} />
                    <Column header="Aire" body={(r) => r.aireMedidoPct != null ? `${Number(r.aireMedidoPct)}%` : '—'} />
                    <Column header="En uso" body={(r) => {
                      if (r.id !== idEnUso) return <span className="text-color-secondary">—</span>;
                      return modoVinculo === 'explicito'
                        ? <Tag value="Vinculada" severity="success" tooltip="Vínculo explícito (se guardó al editar la muestra)" tooltipOptions={{ position: 'top' }} />
                        : <Tag value="Auto" severity="info" tooltip="Derivado por defecto del timeline (última medición con etapa coincidente). Podés fijarla explícitamente desde 'Editar muestra'." tooltipOptions={{ position: 'top' }} />;
                    }} style={{ width: 110 }} />
                  </DataTable>

                  <div className="mt-3 text-xs text-color-secondary">
                    <i className="fa-solid fa-info-circle mr-1" />
                    {modoVinculo === 'explicito'
                      ? 'La medición resaltada está vinculada explícitamente a esta muestra: es la fuente de los datos del fresco en la ficha PDF.'
                      : modoVinculo === 'derivado'
                        ? `Esta muestra no tiene una medición vinculada manualmente; el sistema usa por defecto la última medición ${verPaston.origen === 'OBRA' ? 'de obra' : 'de planta'} del timeline (fila resaltada). Para fijarla manualmente, usá "Editar muestra".`
                        : `No se pudo determinar una medición del timeline para esta muestra (origen ${verPaston.origen}). Los datos del fresco saldrán de los campos legacy del MuestraPaston si están cargados.`}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </Dialog>
    </Container>
  );
};

export default AdminMuestraPaston;
