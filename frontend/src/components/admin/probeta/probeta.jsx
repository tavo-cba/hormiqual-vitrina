import React, { useEffect, useMemo, useState, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Fade } from "react-awesome-reveal";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDate, formatDateDMY } from "../../../common/functions";
import "./probeta.css";
import { useUserContext } from "../../../context/UserContext";
import { useMenuContext } from "../../../context/MenuContext";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { Checkbox } from "primereact/checkbox";
import { SelectButton } from "primereact/selectbutton";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import MotivoDialog from "../../../common/components/MotivoDialog/MotivoDialog";
import QrScanner from "../../../common/components/QrScanner/QrScanner";
import ProbetaDetailDialog from "./uikit/ProbetaDetailDialog";
import PiletaTemperaturaDialog from "./uikit/PiletaTemperaturaDialog";
import { downloadPlanillaCampoMoldeo } from "../../calidad/reportes/planillaCampoMoldeoPdf";
import {
  FORMATO_OPCIONES,
  QUICK_FILTROS_FECHA,
  imprimirYMarcar,
  mensajeResultadoEtiquetas,
} from "../../../lib/etiquetasProbeta";
import {
  ESTADO_PROBETA,
  ESTADO_PROBETA_LABEL,
  ESTADO_PROBETA_KEY,
  ESTADO_PROBETA_CLASS,
  ESTADO_PROBETA_FILTRO_OPCIONES,
} from "../../../lib/constants/estadoProbeta";

const origenOptions = [
  { label: 'Propio', value: 'propio' },
  { label: 'Tercero', value: 'tercero' },
];

/* Helpers para leer datos contextuales de una probeta propia.
 * La Muestra ahora tiene snapshot directo (cliente, planta, tipoHormigon,
 * fecha) que es la fuente preferida — el despacho se mantiene como fallback
 * para datos que solo viven allí (hora, remito) o registros legacy aún no
 * backfilleados. */
// Probetas de pastón (propias): no tienen `muestra` sino `muestraPaston`.
// Cada accessor cae a esa fuente para que la grilla muestre cliente/planta/
// tipo/fecha igual que una probeta propia normal.
const probetaCliente = (p) =>
  p?.muestra?.cliente ?? p?.muestra?.despacho?.cliente ?? p?.muestraPaston?.cliente ?? null;
const probetaPlanta = (p) =>
  p?.muestra?.planta ?? p?.muestra?.despacho?.planta ?? p?.muestraPaston?.planta ?? null;
const probetaTipoHormigon = (p) =>
  p?.muestra?.tipoHormigon?.tipoHormigon ??
  p?.muestra?.dosificacion?.tipoHormigon?.tipoHormigon ??
  p?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon ??
  p?.muestraPaston?.tipoHormigon?.tipoHormigon ??
  // Fallback 2026-05-20: MuestraPaston creadas antes del fix de backfill
  // tenían idTipoHormigon=NULL. El service ahora expone dosificacion.tipoHormigon
  // (DosificacionDisenada → TipoHormigon) como fuente de respaldo.
  p?.muestraPaston?.dosificacion?.tipoHormigon?.tipoHormigon ??
  null;
const probetaFechaMuestra = (p) =>
  p?.muestra?.fecha ?? p?.muestra?.despacho?.fecha ?? p?.muestraPaston?.fecha ?? null;
const clienteNombre = (cliente) => {
  if (!cliente) return null;
  if (cliente.tipoPersona === "Jurídica") return cliente.razonSocial;
  return [cliente.apellido, cliente.nombre].filter(Boolean).join(', ') || cliente.nombre;
};

/**
 * Refactor 2026-05-20 — convertible en sub-componente:
 *  - prop `embedded`: si true, NO renderiza PageHeader ni SelectButton
 *    (los pone el wrapper `ProbetasPage`).
 *  - prop `origen`: 'propias' (default) o 'paston'. Manda al backend como
 *    query param para filtrar la fuente.
 *  - prop `searchTerm` / `onSearchChange`: cuando vienen, el buscador se
 *    vuelve "controlado" desde el wrapper (buscador compartido entre tabs).
 */
const AdminProbeta = ({ embedded = false, origen = 'propias', searchTerm, onSearchChange } = {}) => {
  const [probetas, setProbetas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchLocal, setSearchLocal] = useState("");
  const isSearchControlled = typeof searchTerm === 'string';
  const search = isSearchControlled ? searchTerm : searchLocal;
  const setSearch = isSearchControlled
    ? (v) => onSearchChange?.(typeof v === 'function' ? v(searchTerm) : v)
    : setSearchLocal;
  const [criteria, setCriteria] = useState({
    nombre: true,
    cliente: true,
    fechaDespacho: true,
    fechaRotura: true,
    fechaEnsayo: true,
  });
  const [searchParams] = useSearchParams();
  // M-UX-07 fix (auditoría 08, Bloque 15): el default era 'PEND', que dejaba
  // a los usuarios nuevos sin ver las probetas en pileta (Curando) ni las
  // ya ensayadas. Ahora abrimos en 'ALL' y el usuario filtra a su gusto;
  // si la URL trae ?estado=XXX (ej. desde dashboard "Próximas a romper") se
  // respeta el filtro pedido.
  const [filtro, setFiltro] = useState(
    searchParams.get("estado")?.toUpperCase() || 'ALL'
  );

  const [delLoad, setDelLoad] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [tempProbeta, setTempProbeta] = useState(null); // { id, nombre }

  // N-01 — filtro de rango de fechas para fechaRotura (rotura prevista).
  // Permite acotar la lista al día del operario o a una semana, evitando que
  // el botón "Etiquetas QR" tome todas las probetas históricas del tenant.
  const [rangoFechaRotura, setRangoFechaRotura] = useState(null); // [Date, Date] | null

  // 2026-05-28 — quick-filter por fecha de MOLDEO (muestra.fecha). Es el caso
  // de uso habitual del operario que vuelve del taller con las probetas del
  // día/semana/mes en la mano y necesita imprimir sus etiquetas.
  const [quickFiltroMoldeo, setQuickFiltroMoldeo] = useState('todo');
  const [rangoMoldeoCustom, setRangoMoldeoCustom] = useState(null); // [Date, Date] | null

  // 2026-05-28 — multi-select sobre la tabla. Si hay selección, "Etiquetas QR"
  // imprime sólo lo seleccionado; si no, imprime el listado filtrado.
  const [seleccion, setSeleccion] = useState([]);
  const [formatoEtiqueta, setFormatoEtiqueta] = useState('a4');

  // N-01 (Bloque 22) — scanner QR interno (la cámara del SO da error).
  const [qrScannerOpen, setQrScannerOpen] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useUserContext();                                 // ★
  const { getActions } = useMenuContext();
  // Bloque 1 RBAC (auditoría 08): el botón borrar se muestra solo si el rol
  // canónico lo permite. `puedeBorrar` legacy de menús queda como guard adicional
  // (un Admin con permiso de menú deshabilitado igual no debería ver el botón).
  const { puedeBorrar: puedeBorrarMenuLegacy } = getActions('/calidad/ensayos/probetas');
  const can = useCanPerform(user);
  const puedeBorrar = puedeBorrarMenuLegacy && can('probeta.eliminar');
  // Mej-16 auditoría 08: anular probeta (estado DESCARTADA con motivo).
  const puedeAnular = can('probeta.anular');
  const [anularProbetaId, setAnularProbetaId] = useState(null);
  const anulandoRef = useRef(false);

  /* -------- plantas visibles -------- */
  const visiblePlantaIds = useMemo(() => {                           // ★
    if (user?.plantaIds?.length) return user.plantaIds.map(Number);
    if (user?.allPlantas?.length)
      return user.allPlantas.map((p) => Number(p.idPlanta));
    return [];
  }, [user]);
  // ★

  /* ---------- fetch ---------- */
  const loadProbetas = async () => {
    try {
      setLoading(true);
      // Refactor 2026-05-20: query param `origen` (propias|paston) filtra la
      // fuente en backend. Default 'propias' (back-compat: antes este endpoint
      // devolvía tanto propias-directas como de-pastón en la misma respuesta;
      // ahora cada pestaña pide solo lo suyo).
      const { data } = await axios.get(
        `${config.backendUrl}/api/probetas?origen=${origen}`,
        { headers: config.headers }
      );
      // Filtro local extra: muestras activas (las baja-lógicas no se ven). Las
      // de pastón no tienen `muestra` sino `muestraPaston` y entran siempre.
      setProbetas(
        data.filter((d) => d?.muestra?.estado == true || d?.esPaston === true || d?.muestraPaston)
      );
    } catch (error) {
      console.log(error);
      toast("error", "No se pudieron cargar las probetas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProbetas();
    // Re-fetch cuando cambia el origen (al cambiar de tab en el wrapper).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origen]);

  // 2026-05-28 — limpiar selección al cambiar cualquier filtro, así no
  // queda "lo seleccionado" oculto bajo el filtro nuevo.
  useEffect(() => {
    setSeleccion([]);
  }, [filtro, rangoFechaRotura, quickFiltroMoldeo, rangoMoldeoCustom, search, origen]);

  // N-01 (Bloque 22): si la URL trae `?detail=ID` (vino de un QR escaneado
  // o link directo), abrir el dialog automáticamente al cargar la pantalla.
  useEffect(() => {
    const detailQuery = searchParams.get('detail');
    if (detailQuery) {
      const idNum = Number(detailQuery);
      if (Number.isFinite(idNum) && idNum > 0) setDetailId(idNum);
    }
  }, [searchParams]);

  /* ---------- anular (Mej-16) ---------- */
  const anularProbeta = async (motivo) => {
    if (!anularProbetaId) return;
    if (anulandoRef.current) return;
    anulandoRef.current = true;
    try {
      await axios.post(
        `${config.backendUrl}/api/probetas/${anularProbetaId}/anular`,
        { motivo },
        { headers: config.headers }
      );
      // Marcar como descartada en la lista local y re-fetch.
      setProbetas((prev) =>
        prev.map((p) => p.idProbeta === anularProbetaId
          ? { ...p, idEstadoProbeta: 4, motivoAnulacion: motivo }
          : p)
      );
      toast('success', 'Probeta anulada');
      setAnularProbetaId(null);
    } catch (err) {
      console.error('Error al anular probeta:', err);
      toast('error', err.response?.data?.error || err.message || 'Error al anular');
      throw err; // que el modal no se cierre
    } finally {
      anulandoRef.current = false;
    }
  };

  /* ---------- borrar ---------- */
  const borrarProbeta = async (id) => {
    try {
      setDelLoad(true);
      await axios.delete(`${config.backendUrl}/api/probetas/${id}`, {
        headers: config.headers,
      });
      setProbetas((prev) => prev.filter((p) => p.idProbeta !== id));
      toast("success", "Probeta eliminada");
    } catch (error) {
      console.error("Error al borrar probeta:", error);
      toast("error", "Error al eliminar");
    } finally {
      setDelLoad(false);
    }
  };

  const confirmarBorrado = (id) =>
    confirmDialog({
      header: "Eliminar probeta",
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}></i>
          <span>¿Estás seguro que quieres borrar esta probeta?</span>
        </div>
      ),
      acceptClassName: "p-button-danger",
      acceptLabel: (
        <span>
          <i className="fa-solid fa-trash mr-2" />
          Borrar
        </span>
      ),
      accept: () => borrarProbeta(id),
      rejectLabel: "Cancelar",
    });

  /* ---------- helpers ---------- */
  const byFechaAsc = (a, b) => new Date(a.fechaRotura) - new Date(b.fechaRotura);
  const byFechaDesc = (a, b) => -byFechaAsc(a, b);

  /* --- aplica filtro de planta antes de cualquier otra cosa --- */
  const probetasVisibles = useMemo(() => {                           // ★
    if (!visiblePlantaIds.length) return probetas;
    return probetas.filter((p) => {
      // Para muestras propias: la planta ahora vive directa en Muestra
      // (snapshot). Las creadas antes de la migración pueden tenerla solo
      // bajo despacho, así que mantenemos el fallback.
      const idPlanta =
        p.muestra?.planta?.idPlanta ??
        p.muestra?.idPlanta ??
        p.muestra?.despacho?.planta?.idPlanta ??
        p.muestra?.despacho?.idPlanta ??
        p.muestraPaston?.planta?.idPlanta ??
        p.muestraPaston?.idPlanta;
      return visiblePlantaIds.includes(idPlanta);
    });
  }, [probetas, visiblePlantaIds]);                                  // ★

  const getListado = () => {
    switch (filtro) {
      case ESTADO_PROBETA_KEY[ESTADO_PROBETA.PENDIENTE]:
        return probetasVisibles
          .filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.PENDIENTE)
          .sort(byFechaAsc);
      case ESTADO_PROBETA_KEY[ESTADO_PROBETA.CURANDO]:
        return probetasVisibles
          .filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.CURANDO)
          .sort(byFechaAsc);
      case ESTADO_PROBETA_KEY[ESTADO_PROBETA.ENSAYADA]:
        return probetasVisibles
          .filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA)
          .sort(byFechaDesc);
      case ESTADO_PROBETA_KEY[ESTADO_PROBETA.DESCARTADA]:
        return probetasVisibles.filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.DESCARTADA);
      case ESTADO_PROBETA_KEY[ESTADO_PROBETA.PERDIDA]:
        return probetasVisibles.filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.PERDIDA);
      default:
        return [...probetasVisibles].sort(byFechaAsc);
    }
  };

  // N-01 fix — aplicar filtro de rango de fechas (rotura prevista) ANTES
  // del filtro textual. Sirve principalmente para limitar la generación
  // de etiquetas QR a un set manejable (un día / una semana de moldeos).
  const listadoConRangoRotura = getListado().filter((p) => {
    if (!rangoFechaRotura || !rangoFechaRotura[0]) return true;
    if (!p.fechaRotura) return false;
    const fr = new Date(p.fechaRotura);
    const desde = new Date(rangoFechaRotura[0]); desde.setHours(0, 0, 0, 0);
    const hasta = rangoFechaRotura[1] ? new Date(rangoFechaRotura[1]) : new Date(rangoFechaRotura[0]);
    hasta.setHours(23, 59, 59, 999);
    return fr >= desde && fr <= hasta;
  });

  // 2026-05-28 — filtro por fecha de MOLDEO (muestra.fecha). Quick-filter
  // (hoy/semana/mes) o rango custom. Independiente del filtro de rotura;
  // se combinan en AND.
  const moldeoRange = (() => {
    if (quickFiltroMoldeo === 'todo') return null;
    if (quickFiltroMoldeo === 'custom') {
      if (!rangoMoldeoCustom || !rangoMoldeoCustom[0]) return null;
      const desde = new Date(rangoMoldeoCustom[0]); desde.setHours(0, 0, 0, 0);
      const hasta = rangoMoldeoCustom[1] ? new Date(rangoMoldeoCustom[1]) : new Date(rangoMoldeoCustom[0]);
      hasta.setHours(23, 59, 59, 999);
      return [desde, hasta];
    }
    const opt = QUICK_FILTROS_FECHA.find((o) => o.value === quickFiltroMoldeo);
    return opt?.getRange ? opt.getRange() : null;
  })();
  const listadoConRango = listadoConRangoRotura.filter((p) => {
    if (!moldeoRange) return true;
    const fechaMoldeo = probetaFechaMuestra(p);
    if (!fechaMoldeo) return false;
    const fm = new Date(fechaMoldeo);
    return fm >= moldeoRange[0] && fm <= moldeoRange[1];
  });

  // Normaliza para búsqueda: minúsculas + sin tildes (así "paston" encuentra
  // "pastón" y viceversa).
  const norm = (s) =>
    (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const listado = listadoConRango.filter((p) => {
    const q = norm(search);
    if (!q) return true;
    let match = false;
    if (criteria.nombre && norm(p.nombre).includes(q)) match = true;
    // Probetas de pastón: no tienen la palabra "pastón" en ningún campo
    // (su nombre es T{lote}-{O|P}-P{n}). Las hacemos buscables por la
    // palabra "pastón", por origen (planta/obra) y por la dosificación.
    if (criteria.nombre && p.esPaston) {
      const textoPaston = norm(
        [
          "paston pastón pastones",
          p.pastonOrigen === "OBRA" ? "obra" : "planta",
          p.muestraPaston?.loteNumero != null ? `t${p.muestraPaston.loteNumero}` : "",
          p.muestraPaston?.dosificacion?.nombre || "",
        ].join(" ")
      );
      if (textoPaston.includes(q)) match = true;
    }
    if (
      criteria.fechaDespacho &&
      formatDate(probetaFechaMuestra(p)).toLowerCase().includes(q)
    )
      match = true;
    if (
      criteria.fechaRotura &&
      formatDateDMY(p.fechaRotura).toLowerCase().includes(q)
    )
      match = true;
    if (
      criteria.fechaEnsayo &&
      formatDate(p.ensayo?.fechaEnsayo).toLowerCase().includes(q)
    )
      match = true;
    if (
      criteria.cliente &&
      clienteNombre(probetaCliente(p))?.toLowerCase().includes(q)
    )
      match = true;
    return match;
  });

  // N-01 — preset rápido: rango de fechas que cubra rotura prevista del día.
  const setRangoHoy = () => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    setRangoFechaRotura([hoy, hoy]);
  };
  // N-01 — preset rápido: hoy + próximos 7 días (planificación semanal).
  const setRangoProximaSemana = () => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const en7 = new Date(hoy); en7.setDate(en7.getDate() + 7);
    setRangoFechaRotura([hoy, en7]);
  };
  const limpiarRango = () => setRangoFechaRotura(null);

  const cols = [
    {
      header: "Fecha muestra",
      body: (p) => formatDate(probetaFechaMuestra(p)),
      frozen: true,
    },
    {
      header: "Nombre",
      body: (p) =>
        <div className="flex align-items-center">
          <span className="font-bold mr-1 hover-blue cursor-pointer" onClick={() => setDetailId(p.idProbeta)}>{p.nombre}</span>
          {p.esPaston && (
            <span
              className="probeta-paston-badge mr-1"
              title={`Probeta de pastón de prueba${p.pastonOrigen ? ` (${p.pastonOrigen === 'OBRA' ? 'en obra' : 'en planta'})` : ''}`}
            >
              <i className="fa-solid fa-vials mr-1" />Pastón
            </span>
          )}
          <Button
            rounded
            icon="fa-solid fa-pencil"
            size="small"
            style={{ scale: '0.8' }}
            onClick={() => navigate(`/calidad/ensayos/probetas/editar/${p.idProbeta}`)}
          />
        </div>,
      frozen: true,
    },
    {
      header: "Cliente",
      body: (p) => <span>{clienteNombre(probetaCliente(p))}</span>,
    },
    {
      header: "Tipo H°",
      body: (p) => (
        <span className="font-bold">{probetaTipoHormigon(p)}</span>
      ),
    },
    { header: "Rotura prevista", body: (p) => formatDateDMY(p.fechaRotura) },
    { header: "Rotura real", body: (p) => formatDate(p.ensayo?.fechaEnsayo) || "—" },
    {
      header: "Planta",
      body: (p) => (
        <span className="font-medium">{probetaPlanta(p)?.nombre}</span>
      ),
      sortable: true,
    },
    {
      header: "Estado",
      body: (p) => (
        // M-UX-01 fix (auditoría 08, Bloque 8): clases CSS con override dark
        // mode en `probeta.css` en vez de colores inline hardcoded.
        <span className={ESTADO_PROBETA_CLASS[p.idEstadoProbeta] || 'estado-badge'}>
          {ESTADO_PROBETA_LABEL[p.idEstadoProbeta] || '-'}
        </span>
      ),
    },

    {
      header: "Muestra",
      // Refactor 2026-05-20 — unificar con las otras pestañas mostrando el
      // número de muestra clickeable. Para probetas de pastón se navega al
      // listado de muestras-pastones (no hay ruta de edición individual; el
      // editor abre en un dialog desde esa pantalla).
      body: (p) =>
        p.esPaston ? (
          <div className="flex align-items-center justify-content-center">
            <span
              className="flex-1 truncate font-bold hover-blue cursor-pointer"
              title="Ver muestra de pastón"
              onClick={() => navigate('/calidad/ensayos/muestras-pastones')}
            >
              {p.muestraPaston?.idMuestraPaston ?? '—'}
            </span>
          </div>
        ) : (
          <div className="flex align-items-center justify-content-center">
            <span className="flex-1 truncate font-bold hover-blue cursor-pointer" onClick={() => navigate(`/calidad/ensayos/muestras/editar/${p.muestra?.idMuestra}`)}>{p.muestra?.idMuestra}</span>
          </div>
        ),
    },
    {
      header: "Acciones",
      body: (p) => (
        <div className="flex align-items-center gap-1">
          {p.idPileta && (
            <Button
              rounded
              icon="fa-solid fa-temperature-half"
              size="small"
              severity="info"
              text
              tooltip="Temperatura de curado"
              tooltipOptions={{ position: "top" }}
              onClick={() => setTempProbeta({ id: p.idProbeta, nombre: p.nombre })}
            />
          )}
          {puedeAnular && p.idEstadoProbeta !== 4 && p.idEstadoProbeta !== 5 && (
            <Button
              rounded
              icon="fa-solid fa-ban"
              size="small"
              severity="warning"
              text
              tooltip="Anular probeta (con motivo)"
              tooltipOptions={{ position: 'top' }}
              onClick={() => setAnularProbetaId(p.idProbeta)}
            />
          )}
          {puedeBorrar && (
            <Button
              rounded
              icon="fa-solid fa-trash"
              size="small"
              severity="danger"
              text
              loading={delLoad}
              tooltip="Eliminar (físico — sólo Admin)"
              tooltipOptions={{ position: 'top' }}
              onClick={() => confirmarBorrado(p.idProbeta)}
            />
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  // Refactor 2026-05-20 — cuando se renderiza embebido en `ProbetasPage`,
  // el wrapper provee PageHeader, SelectButton y buscador. En ese modo
  // saltamos el header y arrancamos directo con la barra de filtros.
  const Container = embedded ? React.Fragment : Fade;
  const containerProps = embedded ? {} : { direction: "up", duration: 500, triggerOnce: true };

  return (
    <Container {...containerProps}>
      <div className={embedded ? "w-full flex flex-column align-items-start" : "w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0"}>
        {!embedded && (
          <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
            <PageHeader
              icon="fa-solid fa-flask"
              title="Probetas"
              subtitle="Gestión de probetas y ensayos de resistencia"
            />
            <SelectButton
              value="propio"
              options={origenOptions}
              onChange={(e) => { if (e.value === 'tercero') navigate('/calidad/ensayos/probetas-terceros'); }}
              className="mb-2"
            />
          </div>
        )}

        {/* Bloque 22 — barra reorganizada en 2 filas semánticas:
              (1) BÚSQUEDA: input + criterios sobre los que filtra el texto.
              (2) FILTROS Y ACCIONES: estado, rango de fechas y botones de
                  generación / scanner alineados con labels homogéneas. */}
        <div className="form-card p-3 br-10 flex flex-column w-full gap-3">
          {/* ─── FILA 1 — BÚSQUEDA ─────────────────────────────────────── */}
          <div className="flex flex-column md:flex-row md:flex-wrap md:align-items-center gap-3">
            {/* Refactor 2026-05-20 — buscador con `flex-1` para aprovechar el ancho
                disponible (antes era una caja de ~16rem que dejaba ~60% de la fila
                vacío). Mantiene un mínimo razonable en mobile y un máximo holgado
                en desktop para que no se estire infinitamente. */}
            <div className="flex align-items-center flex-1" style={{ minWidth: '18rem', maxWidth: '40rem' }}>
              <i className="fa-solid fa-search mr-2 text-500" />
              <span className="search-bar-wrapper flex-1">
                <InputText
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar probeta... (escribí 'pastón' para ver las de pastón)"
                  title="Buscar por código o muestra. Para las probetas de pastón de prueba, escribí 'pastón' (o el origen: planta / obra, o la dosificación)."
                  className="w-full br-7 search-bar"
                />
              </span>
            </div>
            <div className="flex flex-wrap gap-3 align-items-center">
              <small className="text-500 font-semibold">Buscar en:</small>
              {[
                { id: 'crit-nombre',    label: 'Nombre',         key: 'nombre' },
                { id: 'crit-cliente',   label: 'Cliente',        key: 'cliente' },
                { id: 'crit-despacho',  label: 'Fecha muestra',  key: 'fechaDespacho' },
                { id: 'crit-rotura',    label: 'Rotura prevista', key: 'fechaRotura' },
                { id: 'crit-ensayo',    label: 'Rotura real',    key: 'fechaEnsayo' },
              ].map((c) => (
                <div key={c.id} className="flex align-items-center">
                  <Checkbox
                    inputId={c.id}
                    checked={criteria[c.key]}
                    onChange={(e) => setCriteria((prev) => ({ ...prev, [c.key]: e.checked }))}
                  />
                  <label htmlFor={c.id} className="ml-2 cursor-pointer text-sm">{c.label}</label>
                </div>
              ))}
            </div>
          </div>

          {/* Divider sutil entre secciones. */}
          <div style={{ height: 1, background: 'var(--surface-border)' }} />

          {/* ─── FILA 2 — FILTROS + ACCIONES ──────────────────────────── */}
          <div className="flex flex-column lg:flex-row lg:align-items-end lg:justify-content-between gap-3">
            {/* Bloque de filtros (izquierda). */}
            <div className="flex flex-column md:flex-row md:flex-wrap gap-3 align-items-stretch md:align-items-end">
              <div className="flex flex-column" style={{ minWidth: '12rem' }}>
                <label className="text-xs text-500 font-semibold mb-1 uppercase">Estado</label>
                <Dropdown
                  value={filtro}
                  onChange={(e) => {
                    setFiltro(e.value);
                    navigate(`/calidad/ensayos/probetas?estado=${e.value}`, { replace: true });
                  }}
                  options={ESTADO_PROBETA_FILTRO_OPCIONES}
                  className="w-full br-7"
                />
              </div>
              {/* N-01 fix Bloque 22 — rango de rotura prevista. */}
              <div className="flex flex-column" style={{ minWidth: '20rem' }}>
                <label className="text-xs text-500 font-semibold mb-1 uppercase">Rotura prevista</label>
                <div className="p-inputgroup flex-1">
                  <Calendar
                    value={rangoFechaRotura}
                    onChange={(e) => setRangoFechaRotura(e.value)}
                    selectionMode="range"
                    readOnlyInput
                    showIcon
                    placeholder="Rango de fechas"
                    dateFormat="dd/mm/yy"
                    className="flex-1"
                  />
                  <Button
                    icon="fa-solid fa-calendar-day"
                    outlined
                    tooltip="Hoy"
                    tooltipOptions={{ position: 'top' }}
                    onClick={setRangoHoy}
                  />
                  <Button
                    label="7d"
                    outlined
                    tooltip="Hoy + próximos 7 días"
                    tooltipOptions={{ position: 'top' }}
                    onClick={setRangoProximaSemana}
                  />
                  {rangoFechaRotura && (
                    <Button
                      icon="fa-solid fa-xmark"
                      outlined
                      severity="secondary"
                      tooltip="Limpiar rango"
                      tooltipOptions={{ position: 'top' }}
                      onClick={limpiarRango}
                    />
                  )}
                </div>
              </div>
              {/* 2026-05-28 — quick-filter por fecha de MOLDEO.
                  Cubre el caso típico: "imprimir etiquetas de las probetas
                  que moldeé hoy / esta semana / este mes". */}
              <div className="flex flex-column" style={{ minWidth: '20rem' }}>
                <label className="text-xs text-500 font-semibold mb-1 uppercase">Fecha de moldeo</label>
                <SelectButton
                  value={quickFiltroMoldeo}
                  options={QUICK_FILTROS_FECHA.map(({ label, value }) => ({ label, value }))}
                  onChange={(e) => { if (e.value) setQuickFiltroMoldeo(e.value); }}
                  className="w-full"
                />
                {quickFiltroMoldeo === 'custom' && (
                  <Calendar
                    value={rangoMoldeoCustom}
                    onChange={(e) => setRangoMoldeoCustom(e.value)}
                    selectionMode="range"
                    readOnlyInput
                    showIcon
                    placeholder="Rango personalizado"
                    dateFormat="dd/mm/yy"
                    className="mt-2"
                  />
                )}
              </div>
            </div>

            {/* Bloque de acciones (derecha). */}
            <div className="flex flex-column">
              <label className="text-xs text-500 font-semibold mb-1 uppercase">Acciones</label>
              <div className="flex flex-wrap gap-2">
                {/* N-02 — planilla en blanco. */}
                <Button
                  label="Planilla en blanco"
                  icon="fa-solid fa-print"
                  outlined
                  severity="secondary"
                  onClick={() => downloadPlanillaCampoMoldeo({
                    tenantNombre: user?.tenantNombre ?? '',
                    plantaNombre: visiblePlantaIds.length === 1
                      ? (user?.allPlantas?.find((p) => Number(p.idPlanta) === Number(visiblePlantaIds[0]))?.nombre ?? '')
                      : '',
                  })}
                  tooltip="Imprimir planilla de moldeo en blanco para completar a mano en obra"
                  tooltipOptions={{ position: 'top' }}
                />
                {/* N-01 etiqueta QR (sesión 2026-05-09): atajo a la vista
                    de etiquetas pendientes para reimprimir lo que quedó
                    sin imprimir desde el flujo de creación de muestra. */}
                <Button
                  label="Etiquetas pendientes"
                  icon="fa-solid fa-tag"
                  outlined
                  severity="secondary"
                  onClick={() => navigate('/calidad/ensayos/probetas/etiquetas-pendientes')}
                  tooltip="Listar y reimprimir etiquetas QR de probetas sin etiqueta impresa"
                  tooltipOptions={{ position: 'top' }}
                />
                {/* N-01 etiqueta QR (sesión 2026-05-09): procedimiento operativo
                    leído desde el .md versionado del backend. */}
                <Button
                  label="Procedimiento etiquetas"
                  icon="fa-solid fa-book"
                  outlined
                  severity="secondary"
                  onClick={() => navigate('/calidad/ensayos/probetas/etiquetado-doc')}
                  tooltip="Guía operativa de etiquetado: materiales, pegado, fallback con marcador"
                  tooltipOptions={{ position: 'top' }}
                />
                {/* N-01 (auditoría 08, Bloque 19): etiquetas QR del listado actual.
                    El operario las pega en cada probeta al moldear; al ir a romper,
                    las escanea desde el planificador (N-05) para confirmar identidad.

                    Bloque 22: si listado > 50, pedir confirmación antes de
                    imprimir (probable error / falta de filtro).

                    2026-05-28: si hay filas tildadas en la tabla, imprime sólo
                    esas (ignora filtros); si no, imprime el listado filtrado.
                    Tras imprimir marca las probetas como impresas. */}
                <Dropdown
                  value={formatoEtiqueta}
                  options={FORMATO_OPCIONES}
                  onChange={(e) => setFormatoEtiqueta(e.value)}
                  style={{ minWidth: '18rem' }}
                  tooltip="Formato del PDF de etiquetas"
                  tooltipOptions={{ position: 'top' }}
                />
                <Button
                  label="Etiquetas QR"
                  icon="fa-solid fa-qrcode"
                  outlined
                  severity="secondary"
                  disabled={(seleccion.length === 0) && (!listado || listado.length === 0)}
                  onClick={() => {
                    const fuente = seleccion.length > 0 ? seleccion : (listado || []);
                    const generar = () => {
                      imprimirYMarcar(fuente, { formato: formatoEtiqueta })
                        .then((res) => {
                          const { severity, mensaje } = mensajeResultadoEtiquetas(res);
                          toast(severity, mensaje);
                          // Re-fetch para que `etiquetaImpresaAt` se vea actualizado.
                          loadProbetas();
                          setSeleccion([]);
                        })
                        .catch((err) => {
                          console.error('Error generando etiquetas QR:', err);
                          toast('error', 'No se pudieron generar las etiquetas');
                        });
                    };
                    const n = fuente.length;
                    if (n > 50) {
                      const hojas = Math.ceil(n / 21);
                      confirmDialog({
                        header: 'Confirmar impresión masiva',
                        message: (
                          <div className="p-3">
                            <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                            Vas a generar etiquetas para <strong>{n} probetas</strong> ({hojas} hojas A4).
                            Si querés acotar la lista, usá los filtros de <strong>"Fecha de moldeo"</strong> o <strong>"Rotura prevista"</strong>,
                            o tildá un subconjunto en la tabla.
                          </div>
                        ),
                        acceptLabel: `Generar ${hojas} hojas`,
                        rejectLabel: 'Cancelar',
                        acceptClassName: 'p-button-warning',
                        accept: generar,
                      });
                      return;
                    }
                    generar();
                  }}
                  tooltip={
                    seleccion.length > 0
                      ? `Imprimir etiquetas QR de las ${seleccion.length} probeta(s) tildada(s)`
                      : 'Imprimir etiquetas QR de las probetas listadas (con filtros aplicados)'
                  }
                  tooltipOptions={{ position: 'top' }}
                />
                {seleccion.length > 0 && (
                  <small className="text-blue-600 align-self-center font-semibold">
                    <i className="fa-solid fa-check-double mr-1" />
                    Imprimiendo {seleccion.length} seleccionada(s) — ignorando filtros
                  </small>
                )}
                {/* N-01 (Bloque 22) — Scanner interno con cámara para evitar el
                    error que reporta el user con la cámara nativa del teléfono. */}
                <Button
                  label="Escanear"
                  icon="fa-solid fa-camera"
                  outlined
                  severity="info"
                  onClick={() => setQrScannerOpen(true)}
                  tooltip="Escanear etiqueta QR de una probeta"
                  tooltipOptions={{ position: 'top' }}
                />
              </div>
            </div>
          </div>
        </div>

        <DataTable
          value={listado}
          emptyMessage="Sin registros"
          stripedRows
          scrollable
          paginator
          rows={30}
          className="w-full mt-3"
          selectionMode="multiple"
          selection={seleccion}
          onSelectionChange={(e) => setSeleccion(e.value)}
          dataKey="idProbeta"
        >
          <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
          {cols.map((c, i) => (
            <Column
              sortable={c.sortable}
              key={i}
              header={c.header}
              body={c.body}
              frozen={c.frozen}
            />
          ))}
        </DataTable>

        <ProbetaDetailDialog
          visible={!!detailId}
          onHide={() => setDetailId(null)}
          idProbeta={detailId}
        />

        <PiletaTemperaturaDialog
          visible={!!tempProbeta}
          onHide={() => setTempProbeta(null)}
          idProbeta={tempProbeta?.id}
          nombreProbeta={tempProbeta?.nombre}
        />

        {/* Mej-16 auditoría 08 — modal de anulación con motivo */}
        <MotivoDialog
          visible={!!anularProbetaId}
          onHide={() => setAnularProbetaId(null)}
          onConfirm={anularProbeta}
          title="Anular probeta"
          icon="fa-solid fa-ban"
          severity="warning"
          confirmLabel="Anular"
          mensaje={(
            <span>
              <i className="fa-solid fa-circle-info mr-2" />
              La probeta queda en estado <strong>Descartada</strong>. Esta acción
              se registra con tu nombre, fecha y motivo para auditoría. No es
              reversible.
            </span>
          )}
        />

        {/* N-01 (Bloque 22) — Scanner QR interno. Si el QR contiene una URL
            del mismo origen (lo esperado, ver etiquetasProbetaQrPdf), abrimos
            el detalle in-app. Si es externa, abrimos en pestaña nueva. */}
        <QrScanner
          visible={qrScannerOpen}
          onClose={() => setQrScannerOpen(false)}
          onScan={(text) => {
            setQrScannerOpen(false);
            try {
              const url = new URL(text);
              if (url.origin === window.location.origin) {
                navigate(`${url.pathname}${url.search}${url.hash}`);
                return;
              }
              window.open(text, '_blank', 'noopener,noreferrer');
            } catch {
              // Texto que no es URL: si parece un id numérico, abrir directo.
              const idNum = Number(String(text).trim());
              if (Number.isFinite(idNum) && idNum > 0) {
                setDetailId(idNum);
              } else {
                toast('warn', `QR no reconocido: ${String(text).slice(0, 60)}`);
              }
            }
          }}
        />
      </div>
    </Container>
  );
};

export default AdminProbeta;
