/**
 * useHomeAlerts.js
 *
 * Hook que concentra TODA la obtención de datos del inicio: las ~17 consultas
 * a la API, sus permisos, el refresco periódico y la construcción del árbol de
 * alertas agrupadas por categoría (`alertGroups`).
 *
 * Se extrajo de `home.jsx` para que la pantalla quede como vista pura.
 */
import { useEffect, useCallback, useState, useMemo } from "react";
import axios from "axios";
import { config } from "../../config/config";
import { formatDateDMY } from "../../common/functions";
import { useUserContext } from "../../context/UserContext";
import { useMenuContext } from "../../context/MenuContext";
import dayjs from "dayjs";
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// import { useRolProduccion } from "../../lib/roles/useRolProduccion";
// import { detalleEstaPendiente } from "../flota/mantenimiento/utils/checklistEstados";
// [VITRINA] stubs: módulos Producción/Flota fuera de alcance. useRolProduccion
// replica el SHAPE del hook original ({ user, rol, isAdmin, esCoordinador, esPlantista })
// leyendo isAdmin del user real, para no romper los consumidores (rolProd.isAdmin/.rol/...).
const useRolProduccion = () => {
  const { user } = useUserContext();
  return useMemo(() => {
    const isAdmin = !!(user?.isAdmin || user?.permissions?.esAdmin);
    return { user, rol: null, isAdmin, esCoordinador: false, esPlantista: false };
  }, [user]);
};
const detalleEstaPendiente = () => false;     // stub (checklist de flota fuera de alcance)

/* helper: frase del día relativo para cumpleaños/aniversarios próximos */
const diaRelativo = (dias) =>
  dias <= 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`;

/* helper: "en 2 días / 4 h" */
const diffString = (fechaISO) => {
  const ms = new Date(fechaISO) - Date.now();
  const d = Math.floor(ms / 86_400_000);
  const h = Math.round((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d} día${d > 1 ? "s" : ""}` : `${h} h`;
};

/*
 * Fix 2026-05-20 — `idPlanta` canónico de una probeta. Antes se leía sólo de
 * `p.muestra.despacho.planta.idPlanta`, lo que descartaba:
 *   (a) probetas de pastón (tienen `muestraPaston.planta`, no `muestra`),
 *   (b) probetas de muestras nuevas con planta-snapshot directo en
 *       `muestra.planta` (no via despacho).
 * Cascade idéntico al `probetaPlanta` de `probeta.jsx`.
 */
const probetaPlantaId = (p) =>
  p?.muestra?.planta?.idPlanta ??
  p?.muestra?.despacho?.planta?.idPlanta ??
  p?.muestraPaston?.planta?.idPlanta ??
  p?.muestraPaston?.idPlanta ??
  null;

export const useHomeAlerts = () => {
  const { user } = useUserContext();
  const { getActions } = useMenuContext();
  // Rol del módulo Producción — para gatear alertas según destinatario.
  const rolProd = useRolProduccion();

  const [mensaje, setMensaje] = useState("Cargando…");
  const [, setSubtitulo] = useState("");
  const [probPendCount, setProbPendCount] = useState(0);
  // Refactor 2026-05-20 — separamos las probetas de pastón del conteo de propias.
  // El endpoint /api/probetas (origen='todas') trae ambas; las distinguimos por
  // el flag `esPaston` que el service marca en `marcarProbetasPaston`.
  const [probPastonPendCount, setProbPastonPendCount] = useState(0);
  const [mensajeTerc, setMensajeTerc] = useState("Cargando…");
  const [, setSubTerc] = useState("");
  const [probTercPendCount, setProbTercPendCount] = useState(0);
  const [, setLoadingTerc] = useState(false);
  const [, setLoading] = useState(false);
  const [despPendientes, setDespPendientes] = useState(0);
  // Alertas de despacho ↔ Betonmatic (Fase 3.4)
  const [alertasDespacho, setAlertasDespacho] = useState({
    porDespachar: 0, enCola: 0, traidosDeVuelta: 0, sinPublicacion: 0,
  });
  const [, setLoadingDesp] = useState(false);
  const [mantPendientes, setMantPendientes] = useState(0);
  const [fuentesBajas, setFuentesBajas] = useState([]);
  const [, setLoadingFuentes] = useState(false);
  const [licPendientes, setLicPendientes] = useState(0);
  const [vacPendientes, setVacPendientes] = useState(0);
  const [, setLoadingLic] = useState(false);
  // Empleados que cumplen años dentro de la próxima semana (diasRestantes <= 7).
  // Cada item trae { nombre, cumple, diasRestantes, idEmpleado } del endpoint
  // del Tablero RRHH.
  const [cumpleanosProximos, setCumpleanosProximos] = useState([]);
  // Empleados que cumplen aniversario laboral dentro de la próxima semana. El
  // mismo endpoint del Tablero RRHH devuelve `aniversarios` con { nombre,
  // anios, diasRestantes, idEmpleado }.
  const [aniversariosProximos, setAniversariosProximos] = useState([]);
  const [ensayosPendRev, setEnsayosPendRev] = useState(0);
  const [adelPendientes, setAdelPendientes] = useState(0);
  const [, setLoadingAdel] = useState(false);
  const [reintPendientes, setReintPendientes] = useState(0);
  const [reintAprobados, setReintAprobados] = useState(0);
  const [, setLoadingReint] = useState(false);
  const [vencRecientes, setVencRecientes] = useState(0);
  const [vencProximos, setVencProximos] = useState(0);
  const [, setLoadingVenc] = useState(false);
  const [pedidosPendientes, setPedidosPendientes] = useState(0);
  const [, setLoadingPedidosEpp] = useState(false);
  const [matafuegosProximos, setMatafuegosProximos] = useState(0);
  const [matafuegosVencidos, setMatafuegosVencidos] = useState(0);
  const [, setLoadingMatafuegos] = useState(false);
  const [checklistInconsistencias, setChecklistInconsistencias] = useState(0);
  const [, setLoadingChecklist] = useState(false);
  const [rtoProximos, setRtoProximos] = useState(0);
  const [rtoVencidos, setRtoVencidos] = useState(0);
  const [rtoTurnosProximos, setRtoTurnosProximos] = useState(0);
  const [, setLoadingRto] = useState(false);
  const [chequesProximos, setChequesProximos] = useState(0);
  const [chequesPendientes, setChequesPendientes] = useState(0);
  const [chequesVencidos, setChequesVencidos] = useState(0);
  const [, setLoadingCheques] = useState(false);
  const [remitoAlerts, setRemitoAlerts] = useState(null);
  const [, setLoadingRemitoAlerts] = useState(false);
  const [fcPendientesTotal, setFcPendientesTotal] = useState(0);
  const [fcPendientesLowConf, setFcPendientesLowConf] = useState(0);
  const [fcVencidas, setFcVencidas] = useState(0);
  const [fcPorVencer, setFcPorVencer] = useState(0);
  const [piletaAlertas, setPiletaAlertas] = useState([]);
  const [obligacionAvisos, setObligacionAvisos] = useState([]);
  // Dosificaciones donde el usuario logueado figura como revisor asignado
  // (DosificacionDisenada.revisorAsignado) y siguen en PENDIENTE_REVISION.
  // El endpoint ya filtra por usuario → llamarlo no requiere chequeo de rol.
  const [dosifPendRevCount, setDosifPendRevCount] = useState(0);
  // Sesión 2026-05-29: si hay UNA sola dosif pendiente, guardamos su id para
  // que el click en la alerta lleve directo al diseñador con esa dosif
  // cargada. Si hay 0 o >1, el link va al listado "Por revisar".
  const [dosifPendRevFirstId, setDosifPendRevFirstId] = useState(null);

  const probActions = getActions('/calidad/ensayos/probetas');
  const probTercActions = getActions('/calidad/ensayos/probetas-terceros');
  const fuenteActions = getActions('/flota/fuentes');
  const checklistActions = getActions('/flota/checklists');
  const adelActions = getActions('/admin/adelantos');
  const reintActions = getActions('/admin/reintegros');
  const pagoActions = getActions('/admin/pagos');
  const mantActions = getActions('/flota/mantenimiento') || {};
  const matafuegoActions = getActions('/flota/matafuegos') || {};
  const chequesActions = getActions('/admin/cheques') || {};
  const revEnsayoActions = getActions('/calidad/revisiones-ensayos');
  const piletaActions = getActions('/calidad/piletas');

  const compromisosActions = getActions('/admin/compromisos') || {};
  const puedeVerCompromisos =
    compromisosActions.puedeVer ||
    compromisosActions.puedeAgregar ||
    compromisosActions.puedeEditar ||
    compromisosActions.puedeBorrar;

  const obligacionesActions = getActions('/admin/obligaciones') || {};
  const puedeVerObligaciones =
    obligacionesActions.puedeVer ||
    obligacionesActions.puedeAgregar ||
    obligacionesActions.puedeEditar ||
    obligacionesActions.puedeBorrar;

  const despActions = getActions('/produccion/despachos');
  const despachosPermisos = despActions.puedeAgregar && despActions.puedeEditar && despActions.puedeBorrar;
  const fuentePermisos = fuenteActions.puedeVer;
  const matafuegoPermisos = matafuegoActions.puedeAgregar || matafuegoActions.puedeEditar || matafuegoActions.puedeBorrar;
  const chequesPermisos = chequesActions.puedeVer || chequesActions.puedeAgregar || chequesActions.puedeEditar || chequesActions.puedeBorrar;
  const licActions = getActions('/admin/licencias');
  const vacActions = getActions('/admin/vacaciones');
  const empleadoActions = getActions('/admin/empleados') || {};
  const puedeVerEmpleados =
    empleadoActions.puedeVer ||
    empleadoActions.puedeAgregar ||
    empleadoActions.puedeEditar ||
    empleadoActions.puedeBorrar;
  const vencActions = getActions('/admin/vencimientos');
  const vencPermisos = vencActions.puedeAgregar && vencActions.puedeEditar;
  const pedidosEppActions = getActions('/admin/pedidos-epp');
  const puedeVerPedidosEpp =
    pedidosEppActions.puedeVer ||
    pedidosEppActions.puedeEditar ||
    pedidosEppActions.puedeAgregar ||
    pedidosEppActions.puedeBorrar;

  // Facturas de compra — el inicio mostraba estas alertas SIN chequear permisos.
  // Cada alerta se gatea contra el menú al que enlaza.
  const facturaCompraActions = getActions('/admin/modulo-compras/factura-compra');
  const puedeVerFacturaCompra =
    facturaCompraActions.puedeVer ||
    facturaCompraActions.puedeAgregar ||
    facturaCompraActions.puedeEditar ||
    facturaCompraActions.puedeBorrar;

  const fcPendienteActions = getActions('/admin/modulo-compras/factura-compra-pendiente');
  const puedeVerFcPendientes =
    fcPendienteActions.puedeVer ||
    fcPendienteActions.puedeAgregar ||
    fcPendienteActions.puedeEditar ||
    fcPendienteActions.puedeBorrar;

  /* ---------- lista de plantas visibles ---------- */
  const visiblePlantaIds = useMemo(() => {
    if (user?.plantaIds?.length) return user.plantaIds.map(Number);
    if (user?.allPlantas?.length)
      return user.allPlantas.map((p) => Number(p.idPlanta));
    return [];
  }, [user]);

  const fetchFuentesBajas = useCallback(async () => {
    if (!fuentePermisos) return;
    try {
      setLoadingFuentes(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/combustible/fuentes`,
        { headers: config.headers },
      );
      const bajas = data.filter((f) => {
        if (f.stock == null) return false;
        const stock = Number(f.stock);
        if (!Number.isFinite(stock)) return false;

        const capacidad = Number(f.capacidadMaxima);
        if (Number.isFinite(capacidad) && capacidad > 0) {
          return stock < capacidad * 0.25;
        }

        return stock > 0 && stock < 1000;
      });
      setFuentesBajas(bajas);
    } catch {
      setFuentesBajas([]);
    } finally {
      setLoadingFuentes(false);
    }
  }, [fuentePermisos]);

  useEffect(() => {
    fetchFuentesBajas();
  }, [fetchFuentesBajas]);

  const fetchLicenciasPendientes = useCallback(async () => {
    if (!licActions.puedeEditar && !vacActions.puedeEditar) return;
    try {
      setLoadingLic(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/licencias-empleados`,
        { headers: config.headers },
      );
      const pendientes = data.filter((l) => l.estado === 'pendiente');
      // Las vacaciones se gestionan desde /admin/vacaciones (solapa Solicitudes),
      // no desde /admin/licencias. Por eso se cuentan por separado.
      setLicPendientes(pendientes.filter((l) => !l.vacaciones).length);
      setVacPendientes(pendientes.filter((l) => l.vacaciones).length);
    } catch {
      setLicPendientes(0);
      setVacPendientes(0);
    } finally {
      setLoadingLic(false);
    }
  }, [licActions.puedeEditar, vacActions.puedeEditar]);

  useEffect(() => {
    fetchLicenciasPendientes();
  }, [fetchLicenciasPendientes]);

  // Cumpleaños y aniversarios de la próxima semana. Reusamos el endpoint del
  // Tablero RRHH, que ya filtra por `dias` (HAVING diasRestantes <= :dias) y
  // ordena por cercanía. Pedimos 7 días para mostrarlos una semana antes. La
  // misma respuesta trae `cumpleanos` y `aniversarios`.
  const fetchCumpleanos = useCallback(async () => {
    if (!puedeVerEmpleados) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/tablero-rrhh/cumpleanos`,
        { headers: config.headers, params: { dias: 7 } },
      );
      setCumpleanosProximos(Array.isArray(data?.cumpleanos) ? data.cumpleanos : []);
      setAniversariosProximos(Array.isArray(data?.aniversarios) ? data.aniversarios : []);
    } catch {
      setCumpleanosProximos([]);
      setAniversariosProximos([]);
    }
  }, [puedeVerEmpleados]);

  useEffect(() => {
    fetchCumpleanos();
  }, [fetchCumpleanos]);

  const fetchEnsayosPendientesRevision = useCallback(async () => {
    if (!revEnsayoActions.puedeEditar && !revEnsayoActions.puedeVer) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/probetas/ensayos-pendientes-revision/count`,
        { headers: config.headers },
      );
      setEnsayosPendRev(data.count || 0);
    } catch {
      setEnsayosPendRev(0);
    }
  }, [revEnsayoActions.puedeEditar, revEnsayoActions.puedeVer]);

  useEffect(() => {
    fetchEnsayosPendientesRevision();
  }, [fetchEnsayosPendientesRevision]);

  const fetchAdelantosPendientes = useCallback(async () => {
    if (!adelActions.puedeEditar) return;
    try {
      setLoadingAdel(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/adelantos`,
        { headers: config.headers },
      );
      const pend = data.filter((a) => a.estado == 'pendiente');
      setAdelPendientes(pend.length);
    } catch {
      setAdelPendientes(0);
    } finally {
      setLoadingAdel(false);
    }
  }, [adelActions.puedeEditar]);

  useEffect(() => {
    fetchAdelantosPendientes();
  }, [fetchAdelantosPendientes]);

  const fetchReintegrosPendientes = useCallback(async () => {
    if (!reintActions.puedeEditar) return;
    try {
      setLoadingReint(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/reintegros`,
        { headers: config.headers },
      );
      const pend = data.filter((r) => r.estado === 'pendiente');
      const aprob = data.filter((r) => r.estado === 'aprobado');
      setReintPendientes(pend.length);
      setReintAprobados(aprob.length);
    } catch {
      setReintPendientes(0);
      setReintAprobados(0);
    } finally {
      setLoadingReint(false);
    }
  }, [reintActions.puedeEditar]);

  useEffect(() => {
    fetchReintegrosPendientes();
  }, [fetchReintegrosPendientes]);

  const fetchPedidosPendientes = useCallback(async () => {
    if (!puedeVerPedidosEpp) return;
    try {
      setLoadingPedidosEpp(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/elementos-pp/pedidos`,
        { headers: config.headers },
      );
      const pend = data.filter((p) => p.estado === 'pendiente');
      setPedidosPendientes(pend.length);
    } catch {
      setPedidosPendientes(0);
    } finally {
      setLoadingPedidosEpp(false);
    }
  }, [puedeVerPedidosEpp]);

  useEffect(() => {
    fetchPedidosPendientes();
  }, [fetchPedidosPendientes]);

  const fetchVencimientos = useCallback(async () => {
    if (!vencPermisos) return;
    try {
      setLoadingVenc(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/vencimientos`,
        { headers: config.headers },
      );
      const recientes = data.filter((v) => {
        const diff = dayjs().diff(dayjs(v.vencimiento), 'day');
        return diff >= 0 && diff <= 15;
      });
      const proximos = data.filter((v) => {
        const diff = dayjs(v.vencimiento).diff(dayjs().startOf('day'), 'day');
        return diff >= 0 && diff <= 30;
      });
      setVencRecientes(recientes.length);
      setVencProximos(proximos.length);
    } catch {
      setVencRecientes(0);
    } finally {
      setLoadingVenc(false);
    }
  }, [vencPermisos]);

  useEffect(() => {
    fetchVencimientos();
  }, [fetchVencimientos]);

  const fetchMatafuegos = useCallback(async () => {
    if (!matafuegoPermisos) return;
    try {
      setLoadingMatafuegos(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/matafuegos`,
        { headers: config.headers },
      );
      const list = Array.isArray(data) ? data : [];
      const today = dayjs().startOf('day');
      let proximos = 0;
      let vencidos = 0;
      list.forEach((m) => {
        const fechas = [m.fechaProximaCarga, m.fechaProximaPruebaHidraulica]
          .map((f) => (f ? dayjs(f) : null))
          .filter((d) => d && d.isValid());
        if (!fechas.length) return;
        const proximo = fechas.reduce((min, current) => (current.isBefore(min) ? current : min));
        const diff = proximo.diff(today, 'day');
        if (diff < 0) {
          vencidos += 1;
        } else if (diff <= 30) {
          proximos += 1;
        }
      });
      setMatafuegosProximos(proximos);
      setMatafuegosVencidos(vencidos);
    } catch {
      setMatafuegosProximos(0);
      setMatafuegosVencidos(0);
    } finally {
      setLoadingMatafuegos(false);
    }
  }, [matafuegoPermisos]);

  useEffect(() => {
    fetchMatafuegos();
  }, [fetchMatafuegos]);

  const fetchChecklistPendientes = useCallback(async () => {
    if (!(checklistActions.puedeAgregar || checklistActions.puedeEditar || checklistActions.puedeBorrar)) return;
    try {
      setLoadingChecklist(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/checklist-mecanicos`,
        { headers: config.headers },
      );
      const total = Array.isArray(data)
        ? data.filter(
          (cl) =>
            Array.isArray(cl.detalles) &&
            cl.detalles.some((d) => detalleEstaPendiente(d)),
        ).length
        : 0;
      setChecklistInconsistencias(total);
    } catch {
      setChecklistInconsistencias(0);
    } finally {
      setLoadingChecklist(false);
    }
  }, [checklistActions.puedeAgregar, checklistActions.puedeEditar, checklistActions.puedeBorrar]);

  useEffect(() => {
    fetchChecklistPendientes();
  }, [fetchChecklistPendientes]);

  const fetchChequesResumen = useCallback(async () => {
    if (!chequesPermisos) return;
    try {
      setLoadingCheques(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/cheques/resumen`,
        { headers: config.headers },
      );
      setChequesProximos(data.proximosAVencer || 0);
      setChequesPendientes(data.aDepositar || 0);
      setChequesVencidos(data.vencidos || 0);
    } catch {
      setChequesProximos(0);
      setChequesPendientes(0);
      setChequesVencidos(0);
    } finally {
      setLoadingCheques(false);
    }
  }, [chequesPermisos]);

  useEffect(() => {
    fetchChequesResumen();
  }, [fetchChequesResumen]);

  const fetchRtoEquipos = useCallback(async () => {
    if (!(mantActions.puedeVer || mantActions.puedeAgregar || mantActions.puedeEditar || mantActions.puedeBorrar)) return;
    try {
      setLoadingRto(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/equipos`,
        { headers: config.headers },
      );
      const hoy = new Date();
      let proximos = 0;
      let vencidos = 0;
      let turnosProx = 0;
      (data || []).forEach((e) => {
        if (e.vencimientoRto) {
          const diff = (new Date(e.vencimientoRto) - hoy) / 86400000;
          if (diff < 0) {
            vencidos += 1;
          } else if (diff <= 45) {
            proximos += 1;
          }
        }
        if (e.turnoRto) {
          const diffTurno = (new Date(e.turnoRto) - hoy) / 86400000;
          if (diffTurno >= 0 && diffTurno <= 45) {
            turnosProx += 1;
          }
        }
      });
      setRtoProximos(proximos);
      setRtoVencidos(vencidos);
      setRtoTurnosProximos(turnosProx);
    } catch {
      setRtoProximos(0);
      setRtoVencidos(0);
      setRtoTurnosProximos(0);
    } finally {
      setLoadingRto(false);
    }
  }, [mantActions.puedeVer, mantActions.puedeAgregar, mantActions.puedeEditar, mantActions.puedeBorrar]);

  useEffect(() => {
    fetchRtoEquipos();
  }, [fetchRtoEquipos]);

  /* ---------- carga de probetas ---------- */
  const fetchProbetasPendientes = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/probetas`,
        {
          headers: config.headers,
          params: { idEstadoProbeta: 2 },
        },
      );

      /* --- filtrar por plantas visibles --- */
      // Fix 2026-05-20 — usar el cascade canónico `probetaPlantaId`. El filtro
      // anterior `p.muestra?.despacho?.planta?.idPlanta` excluía probetas de
      // pastón (no tienen despacho) y probetas de muestras nuevas con planta-
      // snapshot directo en `muestra.planta`.
      const probetasVisibles = visiblePlantaIds.length
        ? data.filter((p) => visiblePlantaIds.includes(Number(probetaPlantaId(p))))
        : data;

      // Refactor 2026-05-20 — separar propias de pastones. El service del backend
      // marca con `esPaston=true` las probetas que vienen de `MuestraPaston`; el
      // resto son propias clásicas (con `muestra`).
      const pendientesTotal = probetasVisibles.filter((p) => p.idEstadoProbeta === 2);
      const pendientesPropias = pendientesTotal.filter((p) => !p.esPaston);
      const pendientesPaston = pendientesTotal.filter((p) => p.esPaston === true);
      const curando = probetasVisibles
        .filter((p) => p.idEstadoProbeta === 1)
        .sort((a, b) => new Date(a.fechaRotura) - new Date(b.fechaRotura));

      setProbPendCount(pendientesPropias.length);
      setProbPastonPendCount(pendientesPaston.length);

      if (pendientesTotal.length) {
        setMensaje(
          `Hay ${pendientesTotal.length} probeta${pendientesTotal.length > 1 ? "s" : ""} pendientes de ensayo`,
        );
        setSubtitulo("Hacé click para realizar el ensayo");
      } else if (curando.length) {
        const prox = curando[0];
        setMensaje(
          `Próxima probeta a ensayar en ${diffString(
            prox.fechaRotura,
          )} (${formatDateDMY(prox.fechaRotura)})`,
        );
        setSubtitulo("Por el momento no hay probetas pendientes de ensayo");
      } else {
        setMensaje("¡Estamos al día con las probetas!");
        setSubtitulo("Podés crear nuevas muestras desde la pestaña Despachos");
      }
    } catch {
      setMensaje("No se pudieron obtener las probetas");
      setProbPendCount(0);
      setProbPastonPendCount(0);
    } finally {
      setLoading(false);
    }
  }, [visiblePlantaIds]);

  useEffect(() => {
    fetchProbetasPendientes();
  }, [fetchProbetasPendientes]);

  // Dosificaciones en estado PENDIENTE_REVISION asignadas al usuario logueado.
  // El endpoint del backend filtra por revisorAsignado=user, así que cualquier
  // user puede pedirlo (si no es revisor de nada la lista queda vacía).
  // Sesión 2026-05-29: el path es `dosificaciones-diseno` (plural). Antes
  // estaba como `dosificacion-diseno` (singular) y el backend devolvía 404
  // silencioso que el catch swallowea — el contador quedaba en 0 siempre.
  // Pedimos la lista completa (no solo count) para poder saltar directo al
  // diseñador cuando hay una única dosif pendiente.
  const fetchDosifPendRev = useCallback(async () => {
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/dosificaciones-diseno/pendientes-revision/mias`,
        { headers: config.headers },
      );
      const lista = Array.isArray(data?.dosificaciones) ? data.dosificaciones : [];
      setDosifPendRevCount(lista.length);
      setDosifPendRevFirstId(lista.length === 1 ? (lista[0]?.id ?? null) : null);
    } catch {
      setDosifPendRevCount(0);
      setDosifPendRevFirstId(null);
    }
  }, []);

  useEffect(() => {
    fetchDosifPendRev();
  }, [fetchDosifPendRev]);

  const fetchProbetasTerceros = useCallback(async () => {
    try {
      setLoadingTerc(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/probetas/terceros`,
        { headers: config.headers }
      );
      // Fix 2026-05-20 — la relación es `muestraTerceros.planta`, no `muestra.planta`.
      // El filtro anterior leía `p.muestra?.planta?.idPlanta` que siempre era
      // `undefined` para probetas de terceros y dejaba la lista en cero cuando
      // el usuario tenía plantas filtradas.
      const visibles = visiblePlantaIds.length
        ? data.filter((p) =>
          visiblePlantaIds.includes(Number(p.muestraTerceros?.planta?.idPlanta ?? p.muestra?.planta?.idPlanta)),
        )
        : data;
      const pend = visibles.filter((p) => p.idEstadoProbeta === 2);
      setProbTercPendCount(pend.length);
      if (pend.length) {
        setMensajeTerc(`Hay ${pend.length} probeta${pend.length > 1 ? 's' : ''} de terceros pendientes`);
        setSubTerc('Click para realizar el ensayo');
      } else {
        setMensajeTerc('S/D');
        setSubTerc('');
      }
    } catch {
      setMensajeTerc('S/D');
      setProbTercPendCount(0);
    } finally {
      setLoadingTerc(false);
    }
  }, [visiblePlantaIds]);

  useEffect(() => {
    fetchProbetasTerceros();
  }, [fetchProbetasTerceros]);

  const fetchDespachosPendientes = useCallback(async () => {
    if (!(user.permissions.esAdmin || user.roles?.includes('Chofer'))) return;
    try {
      setLoadingDesp(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/despachos`,
        {
          headers: config.headers,
          params: { idDespachoEstado: 1 },
        },
      );

      let visibles = visiblePlantaIds.length
        ? data.filter((d) => visiblePlantaIds.includes(d.idPlanta))
        : data;

      if (!user.permissions.esAdmin && user.roles?.includes('Chofer')) {
        visibles = visibles.filter((d) => d.idEmpleado === user.idEmpleado);
      }

      const pendientes = visibles.filter((d) => d.idDespachoEstado === 1);
      setDespPendientes(pendientes.length);
    } catch {
      setDespPendientes(0);
    } finally {
      setLoadingDesp(false);
    }
  }, [user, visiblePlantaIds]);

  useEffect(() => {
    fetchDespachosPendientes();
  }, [fetchDespachosPendientes]);

  // Alertas de despacho ↔ Betonmatic — Fase 3.4. Cuenta agregada por tenant
  // de los 4 estados que interesan al coordinador y al plantista.
  const fetchAlertasDespacho = useCallback(async () => {
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/despachos/alertas-home`,
        { headers: config.headers },
      );
      setAlertasDespacho({
        porDespachar:    Number(data?.porDespachar)    || 0,
        enCola:          Number(data?.enCola)          || 0,
        traidosDeVuelta: Number(data?.traidosDeVuelta) || 0,
        sinPublicacion:  Number(data?.sinPublicacion)  || 0,
      });
    } catch {
      setAlertasDespacho({ porDespachar: 0, enCola: 0, traidosDeVuelta: 0, sinPublicacion: 0 });
    }
  }, []);

  useEffect(() => {
    fetchAlertasDespacho();
  }, [fetchAlertasDespacho]);

  const fetchMantenimientosPendientes = useCallback(async () => {
    if (!(mantActions.puedeVer || mantActions.puedeAgregar || mantActions.puedeEditar || mantActions.puedeBorrar)) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/equipos/mantenimientos/programados`,
        { headers: config.headers },
      );
      const union = [...data.porFecha, ...data.porUso];
      const unicos = union.filter((v, i, a) => a.findIndex(x => x.idMantenimientoProgramado === v.idMantenimientoProgramado) === i);
      const vencidos = unicos.filter(r => {
        const diffFecha = r.fechaMantenimiento ? (new Date(r.fechaMantenimiento) - Date.now()) / 86400000 : Infinity;
        const diffKm = r.kilometros != null && r.vehiculo?.kilometros != null ? r.kilometros - r.vehiculo.kilometros : Infinity;
        const diffHr = r.horas != null && r.vehiculo?.horas != null ? r.horas - r.vehiculo.horas : Infinity;
        return Math.min(diffFecha, diffKm, diffHr) <= 0 && !r.ejecutando;
      });
      setMantPendientes(vencidos.length);
    } catch {
      setMantPendientes(0);
    }
  }, [mantActions.puedeVer, mantActions.puedeAgregar, mantActions.puedeEditar, mantActions.puedeBorrar]);

  useEffect(() => {
    fetchMantenimientosPendientes();
  }, [fetchMantenimientosPendientes]);

  const fetchFcPendientes = useCallback(async () => {
    if (!puedeVerFcPendientes) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/facturas-compra-pendientes/count`,
        { headers: config.headers },
      );
      setFcPendientesTotal(data.total || 0);
      setFcPendientesLowConf(data.lowConfidence || 0);
    } catch {
      setFcPendientesTotal(0);
      setFcPendientesLowConf(0);
    }
  }, [puedeVerFcPendientes]);

  useEffect(() => {
    fetchFcPendientes();
  }, [fetchFcPendientes]);

  const fetchFcVencimientos = useCallback(async () => {
    if (!puedeVerFacturaCompra) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/facturas-compra/vencimientos-alerts`,
        { headers: config.headers },
      );
      setFcVencidas(data.vencidas || 0);
      setFcPorVencer(data.porVencer || 0);
    } catch {
      setFcVencidas(0);
      setFcPorVencer(0);
    }
  }, [puedeVerFacturaCompra]);

  useEffect(() => {
    fetchFcVencimientos();
  }, [fetchFcVencimientos]);

  const fetchRemitoAlerts = useCallback(async () => {
    if (!despachosPermisos) return;
    try {
      setLoadingRemitoAlerts(true);
      const { data } = await axios.get(
        `${config.backendUrl}/api/remito-electronico/alerts`,
        { headers: config.headers },
      );
      setRemitoAlerts(data);
    } catch {
      setRemitoAlerts(null);
    } finally {
      setLoadingRemitoAlerts(false);
    }
  }, [despachosPermisos]);

  useEffect(() => {
    fetchRemitoAlerts();
  }, [fetchRemitoAlerts]);

  const fetchPiletaAlertas = useCallback(async () => {
    if (!piletaActions.puedeVer && !piletaActions.puedeEditar) return;
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/piletas/alertas`, { headers: config.headers });
      setPiletaAlertas(data);
    } catch { setPiletaAlertas([]); }
  }, [piletaActions.puedeVer, piletaActions.puedeEditar]);

  useEffect(() => {
    fetchPiletaAlertas();
  }, [fetchPiletaAlertas]);

  const fetchObligacionAvisos = useCallback(async () => {
    if (!puedeVerObligaciones) return;
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/obligaciones/avisos`,
        { headers: config.headers },
      );
      setObligacionAvisos(Array.isArray(data) ? data : []);
    } catch {
      setObligacionAvisos([]);
    }
  }, [puedeVerObligaciones]);

  useEffect(() => {
    fetchObligacionAvisos();
  }, [fetchObligacionAvisos]);

  /* ---------- refresco periódico ---------- */
  useEffect(() => {
    const intervalId = setInterval(() => {
      fetchProbetasPendientes();
      fetchProbetasTerceros();
      fetchDespachosPendientes();
      fetchAlertasDespacho();
      fetchLicenciasPendientes();
      fetchAdelantosPendientes();
      fetchVencimientos();
      fetchMatafuegos();
      fetchChecklistPendientes();
      fetchFuentesBajas();
      fetchMantenimientosPendientes();
      fetchChequesResumen();
      fetchRtoEquipos();
      fetchRemitoAlerts();
      fetchFcPendientes();
      fetchFcVencimientos();
      fetchPiletaAlertas();
      fetchObligacionAvisos();
      fetchCumpleanos();
    }, 180000);

    return () => clearInterval(intervalId);
  }, [
    fetchAdelantosPendientes,
    fetchCumpleanos,
    fetchChecklistPendientes,
    fetchChequesResumen,
    fetchAlertasDespacho,
    fetchDespachosPendientes,
    fetchFcPendientes,
    fetchFcVencimientos,
    fetchFuentesBajas,
    fetchObligacionAvisos,
    fetchPiletaAlertas,
    fetchLicenciasPendientes,
    fetchMantenimientosPendientes,
    fetchMatafuegos,
    fetchProbetasPendientes,
    fetchProbetasTerceros,
    fetchRemitoAlerts,
    fetchRtoEquipos,
    fetchVencimientos,
  ]);

  /* ---------- alertas agrupadas por categoría ---------- */
  const mantPermisos = mantActions.puedeVer || mantActions.puedeAgregar || mantActions.puedeEditar || mantActions.puedeBorrar;
  const tieneChecklistPermisos = checklistActions.puedeAgregar || checklistActions.puedeEditar || checklistActions.puedeBorrar;

  // Calcular alertas de remito electrónico
  const caiProximoAVencer = useMemo(() => {
    if (!remitoAlerts?.caiVencimiento) return false;
    const venc = new Date(remitoAlerts.caiVencimiento + 'T00:00:00');
    const diffDias = Math.floor((venc - Date.now()) / 86_400_000);
    return diffDias <= 30 && diffDias >= 0 ? diffDias : false;
  }, [remitoAlerts]);

  const caiVencido = useMemo(() => {
    if (!remitoAlerts?.caiVencimiento) return false;
    const venc = new Date(remitoAlerts.caiVencimiento + 'T00:00:00');
    return venc < Date.now();
  }, [remitoAlerts]);

  const remitosRestantesBajos = remitoAlerts?.remitosRestantes != null && remitoAlerts.remitosRestantes <= 100;

  // Obligaciones: el endpoint /avisos ya devuelve vencidas + las que entraron
  // en su ventana de anticipación.
  const obligacionVencidas = obligacionAvisos.filter((o) => o.estado === 'vencido').length;
  const obligacionPorVencer = obligacionAvisos.filter((o) => o.estado !== 'vencido').length;

  const alertGroups = useMemo(() => [
    {
      key: 'produccion',
      label: 'Producción',
      icon: 'fa-solid fa-industry',
      items: [
        (despachosPermisos || user.roles?.includes('Chofer')) && despPendientes > 0 && {
          icon: 'fa-solid fa-truck-fast', to: '/produccion/despachos',
          text: `Hay ${despPendientes} despacho${despPendientes !== 1 ? 's' : ''} pendiente${despPendientes !== 1 ? 's' : ''}`,
          severity: 'warning',
        },
        // Alertas del flujo coordinador↔plantista. Visibilidad por rol:
        //   - "Por despachar" → plantista y coordinador (operación compartida).
        //   - "En cola" / "Traídos de vuelta" / "Sin publicar" → coordinador.
        // Usuarios sin rolProduccion o admin ven todos.
        (rolProd.isAdmin || !rolProd.rol || rolProd.esPlantista || rolProd.esCoordinador) &&
          alertasDespacho.porDespachar > 0 && {
          icon: 'fa-solid fa-grip-vertical', to: '/produccion/panel-plantista',
          text: `Tenés ${alertasDespacho.porDespachar} despacho${alertasDespacho.porDespachar !== 1 ? 's' : ''} por despachar`,
          severity: 'warning',
        },
        (rolProd.isAdmin || !rolProd.rol || rolProd.esCoordinador) &&
          alertasDespacho.enCola > 0 && {
          icon: 'fa-solid fa-clock-rotate-left', to: '/produccion/panel-plantista',
          text: `Hay ${alertasDespacho.enCola} despacho${alertasDespacho.enCola !== 1 ? 's' : ''} en cola en Betonmatic`,
          severity: 'warning',
        },
        (rolProd.isAdmin || !rolProd.rol || rolProd.esCoordinador) &&
          alertasDespacho.traidosDeVuelta > 0 && {
          icon: 'fa-solid fa-rotate-left', to: '/produccion/despachos',
          text: `${alertasDespacho.traidosDeVuelta} despacho${alertasDespacho.traidosDeVuelta !== 1 ? 's' : ''} traído${alertasDespacho.traidosDeVuelta !== 1 ? 's' : ''} de vuelta para modificar`,
          severity: 'danger',
        },
        (rolProd.isAdmin || !rolProd.rol || rolProd.esCoordinador) &&
          alertasDespacho.sinPublicacion > 0 && {
          icon: 'fa-solid fa-triangle-exclamation', to: '/produccion/despachos',
          text: `Hay ${alertasDespacho.sinPublicacion} despacho${alertasDespacho.sinPublicacion !== 1 ? 's' : ''} del día con dosificación sin publicar en Betonmatic`,
          severity: 'danger',
        },
        despachosPermisos && caiVencido && {
          icon: 'fa-solid fa-triangle-exclamation', to: '/configuracion',
          text: 'El CAI de remitos electrónicos está vencido',
          severity: 'danger',
        },
        despachosPermisos && caiProximoAVencer !== false && {
          icon: 'fa-solid fa-clock', to: '/configuracion',
          text: `El CAI de remitos vence en ${caiProximoAVencer} día${caiProximoAVencer !== 1 ? 's' : ''}`,
          severity: 'warning',
        },
        despachosPermisos && remitosRestantesBajos && {
          icon: 'fa-solid fa-file-lines', to: '/configuracion',
          text: remitoAlerts.remitosRestantes <= 0
            ? 'Se agotó la numeración autorizada de remitos'
            : `Quedan ${remitoAlerts.remitosRestantes} remito${remitoAlerts.remitosRestantes !== 1 ? 's' : ''} disponible${remitoAlerts.remitosRestantes !== 1 ? 's' : ''}`,
          severity: remitoAlerts.remitosRestantes <= 0 ? 'danger' : 'warning',
        },
      ],
    },
    {
      key: 'calidad',
      label: 'Control de calidad',
      icon: 'fa-solid fa-flask-vial',
      items: [
        // Refactor 2026-05-20 — 3 ítems separados (Propias / Terceros / Pastones)
        // con wording consistente: "Hay X probetas <origen> pendientes de ensayo".
        //
        // Gate intencionalmente ligero — solo `count > 0`, sin chequeo de
        // permisos. Bug encontrado en la sesión: cuando el menú se renombró de
        // `/produccion/probetas` → `/calidad/ensayos/probetas`, los
        // `user.menuPerms` quedaron asociados al `idMenu` viejo y los gates
        // `getActions(...).puedeEditar` / `puedeVer` / `canAccessRoute(...)`
        // devolvían false aunque el user pudiera navegar al menú. La alerta es
        // INFORMATIVA — el botón de acción real se gatea en la página destino
        // contra los permisos correctos. Mostrarle a un user que tiene N
        // probetas pendientes no es un escape de privilegios.
        probPendCount > 0 && {
          icon: 'fa-solid fa-vials', to: '/calidad/ensayos/probetas?vista=propias&estado=PEND',
          text: `Hay ${probPendCount} probeta${probPendCount !== 1 ? 's' : ''} Propias pendiente${probPendCount !== 1 ? 's' : ''} de ensayo`,
          severity: 'warning',
        },
        probTercPendCount > 0 && {
          icon: 'fa-solid fa-vial-circle-check', to: '/calidad/ensayos/probetas?vista=terceros&estado=PEND',
          text: `Hay ${probTercPendCount} probeta${probTercPendCount !== 1 ? 's' : ''} de Terceros pendiente${probTercPendCount !== 1 ? 's' : ''} de ensayo`,
          severity: 'warning',
        },
        probPastonPendCount > 0 && {
          icon: 'fa-solid fa-flask', to: '/calidad/ensayos/probetas?vista=pastones&estado=PEND',
          text: `Hay ${probPastonPendCount} probeta${probPastonPendCount !== 1 ? 's' : ''} de Pastones pendiente${probPastonPendCount !== 1 ? 's' : ''} de ensayo`,
          severity: 'warning',
        },
        (revEnsayoActions.puedeEditar || revEnsayoActions.puedeVer) && ensayosPendRev > 0 && {
          icon: 'fa-solid fa-clipboard-check', to: '/calidad/revisiones-ensayos',
          text: `Hay ${ensayosPendRev} ensayo${ensayosPendRev !== 1 ? 's' : ''} pendiente${ensayosPendRev !== 1 ? 's' : ''} de revision`,
          severity: 'warning',
        },
        // Alerta personal — solo aparece si el usuario logueado es revisor
        // asignado de al menos 1 dosificación en PENDIENTE_REVISION. Sin gate
        // de permiso adicional: el endpoint del backend ya filtra por user.
        // Sesión 2026-05-29: si hay 1 sola pendiente, el link va al diseñador
        // con esa dosif cargada (ahorra el clic intermedio en el listado).
        dosifPendRevCount > 0 && {
          icon: 'fa-solid fa-file-signature',
          to: dosifPendRevFirstId
            ? `/calidad/dosificacion-diseno?load=${dosifPendRevFirstId}`
            : '/calidad/revisiones-dosificaciones',
          text: `Tenés ${dosifPendRevCount} dosificación${dosifPendRevCount !== 1 ? 'es' : ''} pendiente${dosifPendRevCount !== 1 ? 's' : ''} de revisión`,
          severity: 'warning',
        },
        ...piletaAlertas.filter(a => a.tipo !== 'sin_conexion').map(a => ({
          icon: 'fa-solid fa-temperature-arrow-up', to: '/calidad/piletas',
          text: `Pileta ${a.nombre}: ${a.temperaturaActual}°C (objetivo: ${a.temperaturaObjetivo}°C)`,
          severity: 'danger',
        })),
        ...piletaAlertas.filter(a => a.tipo === 'sin_conexion').map(a => ({
          icon: 'fa-solid fa-plug-circle-xmark', to: '/calidad/piletas',
          text: `Pileta ${a.nombre}: sin conexión hace ${a.minutosDesconectada} min`,
          severity: 'warning',
        })),
      ],
    },
    {
      key: 'rrhh',
      label: 'Recursos Humanos',
      icon: 'fa-solid fa-users',
      items: [
        licActions.puedeEditar && licPendientes > 0 && {
          icon: 'fa-solid fa-calendar-check', to: '/admin/licencias',
          text: `Hay ${licPendientes} licencia${licPendientes !== 1 ? 's' : ''} pendiente${licPendientes !== 1 ? 's' : ''} de aprobación`,
          severity: 'warning',
        },
        vacActions.puedeEditar && vacPendientes > 0 && {
          icon: 'fa-solid fa-umbrella-beach', to: '/admin/vacaciones#solicitudes',
          text: `Hay ${vacPendientes} solicitud${vacPendientes !== 1 ? 'es' : ''} de vacaciones pendiente${vacPendientes !== 1 ? 's' : ''} de aprobación`,
          severity: 'warning',
        },
        adelActions.puedeEditar && adelPendientes > 0 && {
          icon: 'fa-solid fa-money-check-dollar', to: '/admin/adelantos',
          text: `Hay ${adelPendientes} adelanto${adelPendientes !== 1 ? 's' : ''} pendiente${adelPendientes !== 1 ? 's' : ''} de aprobación`,
          severity: 'warning',
        },
        reintActions.puedeEditar && reintPendientes > 0 && {
          icon: 'fa-solid fa-wallet', to: '/admin/reintegros',
          text: `Hay ${reintPendientes} reintegro${reintPendientes !== 1 ? 's' : ''} pendiente${reintPendientes !== 1 ? 's' : ''} de aprobación`,
          severity: 'warning',
        },
        pagoActions.puedeAgregar && reintAprobados > 0 && {
          icon: 'fa-solid fa-money-bill-transfer', to: '/admin/reintegros',
          text: `Hay ${reintAprobados} reintegro${reintAprobados !== 1 ? 's' : ''} aprobado${reintAprobados !== 1 ? 's' : ''} pendiente${reintAprobados !== 1 ? 's' : ''} de pago`,
          severity: 'warning',
        },
        puedeVerPedidosEpp && pedidosPendientes > 0 && {
          icon: 'fa-solid fa-helmet-safety', to: '/admin/pedidos-epp',
          text: `Hay ${pedidosPendientes} pedido${pedidosPendientes !== 1 ? 's' : ''} de EPP pendiente${pedidosPendientes !== 1 ? 's' : ''}`,
          severity: 'warning',
        },
        vencPermisos && vencRecientes > 0 && {
          icon: 'fa-solid fa-calendar-xmark', to: '/admin/vencimientos',
          text: `Hay ${vencRecientes} vencimiento${vencRecientes !== 1 ? 's' : ''} reciente${vencRecientes !== 1 ? 's' : ''}`,
          severity: 'danger',
        },
        vencPermisos && vencProximos > 0 && {
          icon: 'fa-solid fa-calendar-xmark', to: '/admin/vencimientos',
          text: `Hay ${vencProximos} vencimiento${vencProximos !== 1 ? 's' : ''} próximamente`,
          severity: 'warning',
        },
        // Cumpleaños de la próxima semana — un ítem por empleado, sin severity
        // (→ "Por atender"). Aparecen hasta 7 días antes con el día relativo.
        ...(puedeVerEmpleados ? cumpleanosProximos : []).map((c) => ({
          icon: 'fa-solid fa-cake-candles', to: '/admin/empleados',
          text: `${diaRelativo(c.diasRestantes)} es el cumpleaños de ${c.nombre}${c.cumple ? ` (cumple ${c.cumple})` : ''}`,
        })),
        // Aniversarios laborales de la próxima semana — un ítem por empleado.
        ...(puedeVerEmpleados ? aniversariosProximos : []).map((a) => ({
          icon: 'fa-solid fa-award', to: '/admin/empleados',
          text: `${diaRelativo(a.diasRestantes)} ${a.nombre} cumple ${a.anios} año${a.anios !== 1 ? 's' : ''} en la empresa`,
        })),
      ],
    },
    {
      key: 'mantenimiento',
      label: 'Mantenimiento',
      icon: 'fa-solid fa-screwdriver-wrench',
      items: [
        tieneChecklistPermisos && checklistInconsistencias > 0 && {
          icon: 'fa-solid fa-clipboard-check', to: '/flota/mantenimiento#checklists',
          text: `${checklistInconsistencias} ${checklistInconsistencias !== 1 ? 'camiones reportaron' : 'camión reportó'} inconsistencias`,
          severity: 'danger',
        },
        mantPermisos && rtoProximos > 0 && {
          icon: 'fa-solid fa-file-circle-exclamation', to: '/flota/mantenimiento#vencimientos-rto',
          text: `${rtoProximos} equipo${rtoProximos !== 1 ? 's' : ''} con RTO próxima a vencer`,
          severity: 'warning',
        },
        mantPermisos && rtoVencidos > 0 && {
          icon: 'fa-solid fa-file-circle-xmark', to: '/flota/mantenimiento#vencimientos-rto',
          text: `${rtoVencidos} equipo${rtoVencidos !== 1 ? 's' : ''} con RTO vencida`,
          severity: 'danger',
        },
        mantPermisos && rtoTurnosProximos > 0 && {
          icon: 'fa-solid fa-calendar-days', to: '/flota/mantenimiento#turnos-rto',
          text: `${rtoTurnosProximos} equipo${rtoTurnosProximos !== 1 ? 's' : ''} con turno de RTO próximo`,
          severity: 'warning',
        },
        mantPermisos && mantPendientes > 0 && {
          icon: 'fa-solid fa-screwdriver-wrench', to: '/flota/mantenimiento#programados',
          text: `Hay ${mantPendientes} equipo${mantPendientes !== 1 ? 's' : ''} para mantenimiento`,
          severity: 'warning',
        },
        matafuegoPermisos && matafuegosProximos > 0 && {
          icon: 'fa-solid fa-fire-extinguisher', to: '/flota/matafuegos',
          text: `Hay ${matafuegosProximos} matafuego${matafuegosProximos !== 1 ? 's' : ''} próxim${matafuegosProximos !== 1 ? 'os' : 'o'} a vencerse`,
          severity: 'warning',
        },
        matafuegoPermisos && matafuegosVencidos > 0 && {
          icon: 'fa-solid fa-fire-extinguisher', to: '/flota/matafuegos',
          text: `Hay ${matafuegosVencidos} matafuego${matafuegosVencidos !== 1 ? 's' : ''} vencid${matafuegosVencidos !== 1 ? 'os' : 'o'}`,
          severity: 'danger',
        },
        fuentePermisos && fuentesBajas.length > 0 && {
          icon: 'fa-solid fa-oil-can', to: '/flota/fuentes',
          text: `Hay ${fuentesBajas.length} fuente${fuentesBajas.length !== 1 ? 's' : ''} con poco combustible`,
          severity: 'warning',
        },
      ],
    },
    {
      key: 'compras',
      label: 'Compras / Ventas',
      icon: 'fa-solid fa-cash-register',
      items: [
        chequesPermisos && chequesProximos > 0 && {
          icon: 'fa-solid fa-money-check', to: '/admin/cheques',
          text: `${chequesProximos} cheque${chequesProximos !== 1 ? 's' : ''} próximo${chequesProximos !== 1 ? 's' : ''} a vencer`,
          severity: 'warning',
        },
        chequesPermisos && chequesPendientes > 0 && {
          icon: 'fa-solid fa-building-columns', to: '/admin/cheques',
          text: `${chequesPendientes} cheque${chequesPendientes !== 1 ? 's' : ''} a depositar`,
          severity: 'warning',
        },
        chequesPermisos && chequesVencidos > 0 && {
          icon: 'fa-solid fa-calendar-xmark', to: '/admin/cheques',
          text: `${chequesVencidos} cheque${chequesVencidos !== 1 ? 's' : ''} vencido${chequesVencidos !== 1 ? 's' : ''}`,
          severity: 'danger',
        },
        puedeVerFacturaCompra && fcVencidas > 0 && {
          icon: 'fa-solid fa-calendar-xmark', to: '/admin/modulo-compras/factura-compra',
          text: `${fcVencidas} factura${fcVencidas !== 1 ? 's' : ''} de compra vencida${fcVencidas !== 1 ? 's' : ''} sin pago`,
          severity: 'danger',
        },
        puedeVerFacturaCompra && fcPorVencer > 0 && {
          icon: 'fa-solid fa-clock', to: '/admin/modulo-compras/factura-compra',
          text: `${fcPorVencer} factura${fcPorVencer !== 1 ? 's' : ''} de compra próxima${fcPorVencer !== 1 ? 's' : ''} a vencer sin pago`,
          severity: 'warning',
        },
        puedeVerFcPendientes && fcPendientesTotal > 0 && {
          icon: 'fa-solid fa-file-invoice-dollar', to: '/admin/modulo-compras/factura-compra-pendiente',
          text: `${fcPendientesTotal} factura${fcPendientesTotal !== 1 ? 's' : ''} de compra pendiente${fcPendientesTotal !== 1 ? 's' : ''} de revisión`,
          severity: 'warning',
        },
        puedeVerFcPendientes && fcPendientesLowConf > 0 && {
          icon: 'fa-solid fa-triangle-exclamation', to: '/admin/modulo-compras/factura-compra-pendiente',
          text: `${fcPendientesLowConf} factura${fcPendientesLowConf !== 1 ? 's' : ''} con baja confianza de extracción`,
          severity: 'danger',
        },
      ],
    },
    {
      key: 'obligaciones',
      label: 'Obligaciones',
      icon: 'fa-solid fa-file-circle-check',
      items: [
        puedeVerObligaciones && obligacionVencidas > 0 && {
          icon: 'fa-solid fa-triangle-exclamation', to: '/admin/obligaciones#pendientes',
          text: `${obligacionVencidas} presentación${obligacionVencidas !== 1 ? 'es' : ''} normativa${obligacionVencidas !== 1 ? 's' : ''} vencida${obligacionVencidas !== 1 ? 's' : ''}`,
          severity: 'danger',
        },
        puedeVerObligaciones && obligacionPorVencer > 0 && {
          icon: 'fa-solid fa-calendar-day', to: '/admin/obligaciones',
          text: `${obligacionPorVencer} obligación${obligacionPorVencer !== 1 ? 'es' : ''} próxima${obligacionPorVencer !== 1 ? 's' : ''} a vencer`,
          severity: 'warning',
        },
      ],
    },
  ].map(g => ({ ...g, items: g.items.filter(Boolean) })).filter(g => g.items.length > 0),
    [
      despachosPermisos, user, despPendientes, caiVencido, caiProximoAVencer,
      remitosRestantesBajos, remitoAlerts, probPendCount,
      alertasDespacho, rolProd,
      probPastonPendCount,
      mensaje, probTercPendCount,
      mensajeTerc, revEnsayoActions.puedeEditar, revEnsayoActions.puedeVer, ensayosPendRev,
      dosifPendRevCount, dosifPendRevFirstId,
      puedeVerEmpleados, cumpleanosProximos, aniversariosProximos,
      piletaAlertas, licActions.puedeEditar, licPendientes, vacActions.puedeEditar, vacPendientes, adelActions.puedeEditar,
      adelPendientes, reintActions.puedeEditar, reintPendientes, pagoActions.puedeAgregar,
      reintAprobados, puedeVerPedidosEpp, pedidosPendientes, vencPermisos, vencRecientes,
      vencProximos, tieneChecklistPermisos, checklistInconsistencias, mantPermisos,
      rtoProximos, rtoVencidos, rtoTurnosProximos, mantPendientes, matafuegoPermisos,
      matafuegosProximos, matafuegosVencidos, fuentePermisos, fuentesBajas, chequesPermisos,
      chequesProximos, chequesPendientes, chequesVencidos, puedeVerFacturaCompra,
      fcVencidas, fcPorVencer, puedeVerFcPendientes, fcPendientesTotal,
      fcPendientesLowConf, puedeVerObligaciones, obligacionVencidas,
      obligacionPorVencer,
    ]);

  return { alertGroups, puedeVerCompromisos, puedeVerObligaciones };
};
