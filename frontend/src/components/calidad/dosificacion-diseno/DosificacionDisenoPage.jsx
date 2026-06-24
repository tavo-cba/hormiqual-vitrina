import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { SelectButton } from "primereact/selectbutton";
import { RadioButton } from "primereact/radiobutton";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { Dialog } from "primereact/dialog";
import { Divider } from "primereact/divider";
import { Checkbox } from "primereact/checkbox";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tooltip } from "primereact/tooltip";
import { TabMenu } from "primereact/tabmenu";
import { Fade } from "react-awesome-reveal";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import { useUserContext } from "../../../context/UserContext";
import { getRolPrincipal, ROL_LABEL } from "../../../lib/roles";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import { detectarAutoAprobacion } from "../../../lib/dosificacion/clasificacionAutoAprobacion";
import { aplicarAjusteCemento } from "../../../lib/dosificacion/ajusteCementoEngine";
import { deriveTrazabilidadConsistente } from "../../../lib/dosificacion/trazabilidadPostAjuste";
import { MOTIVOS_DROPDOWN_OPTIONS, MOTIVOS_AJUSTE_CEMENTO } from "../../../lib/dosificacion/motivosAjusteCemento";
import { derivarTipoHormigon, MODOS_FCE } from "../../../lib/normativa/tipoHormigonIRAM1666";
import OverrideRequestDialog from "../compliance/OverrideRequestDialog";
import OverridePastonDialog from "./OverridePastonDialog";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import DebugDosificacionDialog from "./DebugDosificacionDialog"; // [DEBUG-DOSIF]
import WizardDosificacion from "./WizardDosificacion";
import "./WizardDosificacion.css";
import DosificacionTrazabilidadView from "./DosificacionTrazabilidadView";
import PdfSectionSelector from "../common/PdfSectionSelector";
import DisenoHistorialTimeline from "./DisenoHistorialTimeline";
import CostosSection from "./CostosSection";
import { getCaracterizacionBulk } from "../../../services/agregadoEnsayoService";
import { generarInformeDosificacionPdf } from "./dosificacionInformePdf";
import RecetaObraSection from "./RecetaObraSection";
import PastonPruebaSection from "./PastonPruebaSection";
import AptitudMaterialesPanel from "./AptitudMaterialesPanel";
import EditorProporcionesModal from "./EditorProporcionesModal";
import AditivoDivergenciaAlert from "./AditivoDivergenciaAlert";
import BetonmaticPublicacionWidget from "./BetonmaticPublicacionWidget";
import RedosificacionesObraSection from "./RedosificacionesObraSection";
import PrediccionFrescoPanel from "./PrediccionFrescoPanel";
import { FORMA_LABELS } from "./dosificacionTraceSections";
import { CATEGORIA_COLORS, VEREDICTO } from "../../../lib/compliance";
import { getTipologias } from "../../../services/tipologiaHormigonService";
import {
  calcularDosificacion,
  guardarDosificacion,
  getDosificacion,
  getCementos,
  getAdiciones,
  getAditivos,
  getMezclas,
  getMezcla,
  getPlantas,
  getDurabilidadExposicion,
  transicionarEstado,
  crearNuevaVersion,
  obtenerResultadosProduccion,
  getDosificacionesCatalogo,
  vincularCatalogo,
  obtenerHistorial,
  getConsistenciaClases,
  listarPastones,
  listarCorrecciones,
  getMaterialesParaMezcla,
  sugerirMezclas,
  crearMezclaSugerida,
  getAlertasDosificacion,
  resolverAlertaDosificacion,
  listarRevisoresDisponibles,
} from "../../../services/dosificacionDisenoService";

/* ─────────────── Helpers de mapeo a categorías visuales (Prompt 3 C5) ─────────────── */

/**
 * Mapeo del vocabulario `estado` de la caracterización-aptitud → categoría canónica.
 * Vocabulario backend: cumple | cumple_con_atencion | cumple_condicional | no_cumple | sin_dato.
 */
function categoriaDeAptitudEstado(estado) {
  switch (estado) {
    case 'cumple':              return VEREDICTO.APTO;
    case 'cumple_con_atencion': return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'cumple_condicional':  return VEREDICTO.APTITUD_CONDICIONADA;
    case 'no_cumple':           return VEREDICTO.NO_APTO;
    case 'sin_dato':
    case 'incompleto':          return VEREDICTO.EVALUACION_INCOMPLETA;
    default:                    return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

/**
 * Boolean cumple (true/false/null) → categoría canónica. Usado por las
 * verificaciones aire/pulverulento/HP que producen resultado binario sin
 * compliance canónico desde el backend.
 *   true → APTO ; false → NO APTO ; null → EVALUACIÓN INCOMPLETA
 */
function categoriaDeBoolean(cumple) {
  if (cumple === true)  return VEREDICTO.APTO;
  if (cumple === false) return VEREDICTO.NO_APTO;
  return VEREDICTO.EVALUACION_INCOMPLETA;
}

/**
 * Formatea un objeto `detail` heterogéneo a línea legible.
 *
 * Shapes soportados:
 *   - { campo, msg }                          → frontend validation local
 *   - { message }                             → SDK genérico
 *   - { agregadoNombre, descripcion, codigo } → backend ENSAYOS_FUNCIONALES_FALTANTES
 *   - { tipo, mensaje }                       → warning del motor de cálculo
 *   - string                                  → ya formateado
 *
 * Antes el render hacía `String(detail)` cuando ningún campo conocido coincidía,
 * lo que producía "[object Object]" cliente-facing. Este helper cubre los shapes
 * conocidos y degrada con un JSON.stringify legible si llega uno nuevo.
 */
function formatDetailLine(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  // Shape backend: ensayos funcionales faltantes
  if (detail.agregadoNombre && detail.descripcion) {
    const codigo = detail.codigo ? ` [${detail.codigo}]` : '';
    return `"${detail.agregadoNombre}": falta ${detail.descripcion}${codigo}`;
  }
  // Shape genérico con campo de validación
  if (detail.campo) return `[${detail.campo}] ${detail.msg || detail.message || ''}`;
  // Shape warning del motor
  if (detail.tipo && detail.mensaje) return `${detail.tipo}: ${detail.mensaje}`;
  // Mensajes simples
  if (detail.msg) return detail.msg;
  if (detail.message) return detail.message;
  // Última opción: serializar de forma legible
  try { return JSON.stringify(detail); } catch { return ''; }
}

/**
 * Detecta si los `details` ya están incluidos en el `message` del status,
 * para evitar mostrarlos dos veces. El backend de ensayos funcionales
 * devuelve un mensaje multilínea que YA contiene la lista de faltantes;
 * en ese caso no hace falta renderizarlos otra vez como bullets debajo.
 */
function esDetailYaIncluidoEnMensaje(status) {
  if (!status?.message || !Array.isArray(status?.details)) return false;
  const msg = String(status.message);
  // Heurística: si el mensaje ya menciona el primer agregado con su código,
  // se asume que la lista completa también está adentro.
  const primero = status.details[0];
  if (primero?.codigo && msg.includes(primero.codigo)) return true;
  if (primero?.agregadoNombre && msg.includes(primero.agregadoNombre) && msg.includes('falta')) return true;
  return false;
}

/* ════════════════════════════════════════
   Constants
   ════════════════════════════════════════ */

const EDAD_PRESETS = [3, 7, 28, 56, 90];
const EDAD_OPTIONS = [
  ...EDAD_PRESETS.map((d) => ({ label: `${d}d`, value: d })),
  { label: "Otra", value: -1 },
];

const MODO_EFECTO_GROUPED = [
  {
    label: "Efectos con cálculo",
    items: [
      { label: "Ahorro de agua", value: "AHORRO_AGUA" },
      { label: "Aumento de asentamiento", value: "AUMENTO_ASENTAMIENTO" },
    ],
  },
  {
    label: "Efectos informativos",
    items: [
      { label: "Retardante de fraguado", value: "RETARDANTE" },
      { label: "Acelerante de fraguado", value: "ACELERANTE_FRAGUE" },
      { label: "Acelerante de endurecimiento", value: "ACELERANTE_ENDURECIMIENTO" },
      { label: "Incorporador de aire", value: "INCORPORADOR_AIRE" },
      { label: "Espumígeno (HRDC)", value: "ESPUMIGENO" },
      { label: "Anticongelante", value: "ANTICONGELANTE" },
      { label: "Reductor de retracción", value: "REDUCTOR_RETRACCION" },
      { label: "Expansivo / Compensador", value: "EXPANSIVO" },
      { label: "Inhibidor de corrosión", value: "INHIBIDOR_CORROSION" },
      { label: "Modificador de viscosidad (VMA)", value: "VISCOSANTE" },
      { label: "Impermeabilizante", value: "IMPERMEABILIZANTE" },
      { label: "Refuerzo con fibras", value: "FIBRAS" },
      { label: "Otro (ver observaciones)", value: "OTRO" },
    ],
  },
];

const EFECTOS_INFORMATIVOS = new Set([
  "RETARDANTE", "ACELERANTE_FRAGUE", "ACELERANTE_ENDURECIMIENTO",
  "INCORPORADOR_AIRE", "ESPUMIGENO", "ANTICONGELANTE", "REDUCTOR_RETRACCION",
  "EXPANSIVO", "INHIBIDOR_CORROSION", "VISCOSANTE",
  "IMPERMEABILIZANTE", "FIBRAS", "OTRO",
]);

const LEGACY_EXPOSICION_CODES = new Set([
  "NO_APLICA", "MODERADA", "SEVERA", "MUY_SEVERA",
  "SULFATOS_MODERADA", "SULFATOS_SEVERA", "CORROSION_CLORUROS",
]);

const AC_MODO_OPTIONS = [
  { label: "Límite (cap)", value: "LIMITE" },
  { label: "Fijo (forzado)", value: "FIJO" },
];

// Sugerencias CIRSOC se obtienen de la BD (durabilidadRows) — no hardcodeadas

const METODO_LABELS = {
  asentamiento: "Asentamiento (IRAM 1536)",
  remoldeo: "Remoldeo VeBe (IRAM 1767)",
  extendido: "Extendido (IRAM 1690)",
};
const METODO_UNITS = {
  asentamiento: "cm",
  remoldeo: "s",
  extendido: "cm",
};

const esTipologiaHRDC = (codigo) => String(codigo || "").toLowerCase() === "hrdc";
// Sesión 2026-05-29 — Hormigón Alivianado (telgopor en perlas).
const esTipologiaAlivianado = (codigo) => String(codigo || "").toLowerCase() === "alivianado";

const EMPTY_FORM = {
  metodo: "HORMIQUAL",
  tipologiaCodigo: "convencional",
  // Refactor 2026-05-20: modo de interpretación de f'ce al derivar la clase
  // IRAM 1666. 'ESPECIFICADO' = pliego (clase inmediata superior — default);
  // 'OBJETIVO' = media de diseño con sobrediseño aplicado (clase más cercana).
  tipoHormigonModoFce: "ESPECIFICADO",
  // HRDC (sólo se usan si tipologiaCodigo === "hrdc")
  cementoKgM3: null,
  densidadObjetivoKgM3: null,
  // Alivianado (sólo se usan si tipologiaCodigo === "alivianado")
  idMaterialLiviano: null,
  dosisPerlasLM3: 240, // default obra típico del usuario (14 kg/m³ × 240 L = 3,36 kg/m³)
  expuestoDesgaste: false,
  tipoHormigonParticular: null,
  claseHormigonParticular: null,
  espesorElementoMm: null,
  aspectoSuperficialImportante: false,
  tipoArmadura: "armado",
  nombre: "",
  descripcion: "",
  idPlanta: null,
  resistenciaMpa: null,
  edadDias: 28,
  asentamientoMm: null,
  consistenciaClase: null,
  consistenciaMetodo: null,
  consistenciaValor: null,
  tmnMm: null,
  airePct: null,
  aireAtrapado: null,       // null = auto from TMN table
  aireAtapadoAuto: true,    // true = use TMN lookup
  aireIncorporado: null,    // extra entrained air %
  formaAgregado: null,
  mezclaId: null,
  cementoId: null,
  modoCurvaAC: "ICPA", // "ICPA" = Abaco 2 genérica, "FABRICANTE" = curva específica del cemento
  adicion1Id: null,
  adicion1Pct: null,
  adicion2Id: null,
  adicion2Pct: null,
  aditivo1Id: null,
  aditivo1Dosis: null,
  aditivo1Modo: null,
  aditivo1OtroDesc: "",
  aditivo2Id: null,
  aditivo2Dosis: null,
  aditivo2Modo: null,
  aditivo2OtroDesc: "",
  aditivo3Id: null,
  aditivo3Dosis: null,
  aditivo3Modo: null,
  aditivo3OtroDesc: "",
  aditivo1Etapa: "PLANTA",
  aditivo2Etapa: "PLANTA",
  aditivo3Etapa: "PLANTA",
  aditivo1EsCorreccion: false,
  aditivo2EsCorreccion: false,
  aditivo3EsCorreccion: false,
  // Fibras
  idMacrofibra: null,
  nombreMacrofibra: "",
  dosisMacrofibraKgM3: null,
  idMicrofibra: null,
  nombreMicrofibra: "",
  dosisMicrofibraKgM3: null,
  // ICPA-specific
  fce: null,
  desvioS: null,
  origenS: null,
  exposicion: null,
  tipoHormigonEstructural: "ARMADO",
  factorPrudencial: 1.00,
  // Restricciones de pliego (opcionales)
  acMaxPliego: null,
  acModo: "LIMITE",
  amcMaxPliego: null,
  cementoMinPliego: null,
  // Logística de colocación
  modoAsentamiento: "EN_PLANTA",   // "EN_PLANTA" o "EN_OBRA"
  metodoColocacion: "CONVENCIONAL",// "CONVENCIONAL" | "BOMBEADO" — afecta excepción §4.1.3 pulverulento
  tiempoViaje: 30,                 // min
  tiempoDescarga: 30,              // min
  tiempoEspera: 0,                 // min
  temperaturaAmbiente: 25,         // °C
};

/* ════════════════════════════════════════
   Component
   ════════════════════════════════════════ */

export default function DosificacionDisenoPage() {
  const showToast = useToast();
  const cfg = useConfig();
  const location = useLocation();

  /* ── Wizard de configuración asistida (modelo Liquidaciones) ── */
  const [setupWizardVisible, setSetupWizardVisible] = useState(false);
  const [debugDosifVisible, setDebugDosifVisible] = useState(false); // [DEBUG-DOSIF]
  const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("dos_wizard_paused") === "1"
  );

  useEffect(() => {
    const sync = () => setSetupWizardPaused(localStorage.getItem("dos_wizard_paused") === "1");
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [setupWizardVisible]);

  const descartarSetupWizard = () => {
    localStorage.removeItem("dos_wizard_step");
    localStorage.removeItem("dos_wizard_paused");
    setSetupWizardPaused(false);
  };

  /* ── Data catalogs ── */
  const [plantas, setPlantas] = useState([]);
  const [cementos, setCementos] = useState([]);
  const [adiciones, setAdiciones] = useState([]);
  const [aditivos, setAditivos] = useState([]);
  const [fibras, setFibras] = useState([]);
  const [mezclas, setMezclas] = useState([]);
  const [selectedMezclaDetail, setSelectedMezclaDetail] = useState(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [exposicionOpciones, setExposicionOpciones] = useState([]);
  const [durabilidadRows, setDurabilidadRows] = useState([]);
  const [tipologias, setTipologias] = useState([]);
  const [consistenciaClases, setConsistenciaClases] = useState([]);
  // Sesión 2026-05-29 — Materiales livianos para Hormigón Alivianado.
  // Catálogo aparte de Agregados (los livianos viven en `Material` tipo
  // 'Liviano' — no pasan por validaciones IRAM pétreas ni requieren
  // ensayos de caracterización).
  const [materialesLivianos, setMaterialesLivianos] = useState([]);

  /* ── Form state ── */
  const [form, setForm] = useState({ ...EMPTY_FORM });

  /* ── Flag HRDC (deriva de tipologiaCodigo) ── */
  const esHRDC = useMemo(() => esTipologiaHRDC(form.tipologiaCodigo), [form.tipologiaCodigo]);
  /* ── Flag Alivianado (deriva de tipologiaCodigo) ── */
  const esAlivianado = useMemo(() => esTipologiaAlivianado(form.tipologiaCodigo), [form.tipologiaCodigo]);

  /* ── Tipo de hormigón derivado (clase IRAM 1666 o HRDC). Refactor 2026-05-20.
       El backend hace la derivación canónica al guardar; acá mostramos el
       resultado en tiempo real para que el usuario vea qué clase queda
       asignada antes de persistir.  ── */
  const tipoHormigonDerivado = useMemo(() => derivarTipoHormigon({
    fce: form.fce,
    tipologiaCodigo: form.tipologiaCodigo,
    modoFce: form.tipoHormigonModoFce,
  }), [form.fce, form.tipologiaCodigo, form.tipoHormigonModoFce]);

  /* ── Auto-seteo de modoEfecto para aditivos ESPUMIGENO ──
     Cuando el usuario elige un aditivo cuyo tipoFuncional es ESPUMIGENO,
     pre-seleccionamos el modo de efecto ESPUMIGENO en ese slot para que
     el motor lo detecte sin requerir un click extra del usuario. */
  useEffect(() => {
    const slots = [
      ['aditivo1Id', 'aditivo1Modo'],
      ['aditivo2Id', 'aditivo2Modo'],
      ['aditivo3Id', 'aditivo3Modo'],
    ];
    setForm(prev => {
      let next = prev;
      for (const [idKey, modoKey] of slots) {
        const id = prev[idKey];
        if (!id) continue;
        const ad = aditivos.find(a => a.idAditivo === id);
        if (ad?.tipoFuncional === 'ESPUMIGENO' && prev[modoKey] !== 'ESPUMIGENO') {
          if (next === prev) next = { ...prev };
          next[modoKey] = 'ESPUMIGENO';
        }
      }
      return next;
    });
  }, [form.aditivo1Id, form.aditivo2Id, form.aditivo3Id, aditivos]);

  /* ── Aditivos ESPUMIGENO disponibles en el catálogo ──
     Para HRDC el motor exige tener un espumígeno cargado. Si hay uno solo en
     catálogo, lo autoseleccionamos en el slot principal cuando el usuario
     elige tipología HRDC. Si hay varios, sugerimos el "más apropiado":
     el que tiene aire incorporado declarado más alto y dosis habitual definida
     (criterio simple, predecible). Si no hay ninguno, mostramos un mensaje
     explícito para que el usuario lo cargue antes.
   */
  const espumigenosCatalogo = useMemo(
    () => (aditivos || []).filter(a => a.tipoFuncional === 'ESPUMIGENO' && a.activo !== false),
    [aditivos]
  );
  const espumigenoSugerido = useMemo(() => {
    if (espumigenosCatalogo.length === 0) return null;
    if (espumigenosCatalogo.length === 1) return espumigenosCatalogo[0];
    // Criterio para "más apropiado": preferir el que tenga aireIncorporadoPctEsperado
    // declarado y mayor, con dosisHabitual definida.
    return [...espumigenosCatalogo].sort((a, b) => {
      const aHasDosis = a.dosisHabitual != null ? 1 : 0;
      const bHasDosis = b.dosisHabitual != null ? 1 : 0;
      if (aHasDosis !== bHasDosis) return bHasDosis - aHasDosis;
      const aAire = Number(a.aireIncorporadoPctEsperado) || 0;
      const bAire = Number(b.aireIncorporadoPctEsperado) || 0;
      return bAire - aAire;
    })[0];
  }, [espumigenosCatalogo]);

  /* ── Autoselección reactiva: cuando el usuario elige HRDC y el slot 1 está
     vacío, cargar el espumígeno sugerido del catálogo. Resuelve la carrera
     con el fetch de aditivos: el usuario puede haber cambiado a HRDC mientras
     `aditivos` aún se estaba cargando, o haber abierto un diseño guardado.
     El useEffect reacciona también a la carga de aditivos posterior. */
  useEffect(() => {
    if (!esHRDC) return;
    if (form.aditivo1Id) return; // ya hay algo en el slot — no pisar
    if (!espumigenoSugerido) return; // todavía no hay espumígenos cargados
    setForm(prev => ({
      ...prev,
      aditivo1Id: espumigenoSugerido.idAditivo,
      aditivo1Dosis: espumigenoSugerido.dosisHabitual != null
        ? Number(espumigenoSugerido.dosisHabitual)
        : prev.aditivo1Dosis,
      aditivo1Etapa: prev.aditivo1Etapa || 'PLANTA',
    }));
  }, [esHRDC, espumigenoSugerido, form.aditivo1Id]);

  /* ── Validación HRDC: se necesita un aditivo ESPUMIGENO en algún slot ── */
  const espumigenoCargado = useMemo(() => {
    if (!esHRDC) return null;
    const slots = [form.aditivo1Id, form.aditivo2Id, form.aditivo3Id];
    for (const id of slots) {
      if (!id) continue;
      const ad = aditivos.find(a => a.idAditivo === id);
      if (ad && ad.tipoFuncional === 'ESPUMIGENO') return ad;
    }
    return null;
  }, [esHRDC, form.aditivo1Id, form.aditivo2Id, form.aditivo3Id, aditivos]);
  const hrdcBloqueoEspumigeno = esHRDC && !espumigenoCargado;

  /* ── Calculation ── */
  const [calculating, setCalculating] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [trazabilidad, setTrazabilidad] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [calcErrors, setCalcErrors] = useState([]);
  const [traceVisible, setTraceVisible] = useState(false);
  const [calcStatus, setCalcStatus] = useState({ status: "idle", message: null, details: [] });
  const [saveStatus, setSaveStatus] = useState({ status: "idle", message: null, details: [] });

  /* ── Ajuste manual de cemento (sesión 2026-06-11) ── */
  // Snapshot del resultado ORIGINAL del motor — para poder revertir el ajuste
  // o re-aplicarlo con valores distintos sin perder la base de cálculo.
  const [resultadoOriginal, setResultadoOriginal] = useState(null);
  // Estado del panel: { cementoAdoptadoKgM3, motivo, motivoOtro }.
  const [ajusteCementoForm, setAjusteCementoForm] = useState({ cementoAdoptadoKgM3: null, motivo: null, motivoOtro: '' });
  const [ajusteCementoErrors, setAjusteCementoErrors] = useState([]);

  /* ── Corrección por humedad ── */
  const [humedadAgregados, setHumedadAgregados] = useState({});  // { [idAgregado]: humedadPct }

  /* ── Save / PDF ── */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const transicionRef = useRef(false);
  // Guard de doble-submit para acciones inline de escritura (nueva versión,
  // crear mezcla sugerida, transiciones standalone con motivo, etc.).
  const accionRef = useRef(false);
  const [saveDialogVisible, setSaveDialogVisible] = useState(false);
  const [saveNotes, setSaveNotes] = useState("");
  const [pdfDialogVisible, setPdfDialogVisible] = useState(false);
  const [pdfSource, setPdfSource] = useState(null);

  /* ── Enviar a revisión dialog ── */
  const [revisionDialogVisible, setRevisionDialogVisible] = useState(false);
  const [revisionObservaciones, setRevisionObservaciones] = useState("");
  const [revisionPastonRefId, setRevisionPastonRefId] = useState(null);
  // PR7 — `revisionRevisor` ahora guarda el `username` del User real elegido
  // del dropdown, no un string libre. La lista de candidatos se carga del
  // endpoint /revisores-disponibles (usuarios con rol RESPONSABLE_CALIDAD,
  // DIRECTOR_TECNICO o ADMIN).
  const [revisionRevisor, setRevisionRevisor] = useState("");
  const [revisoresDisponibles, setRevisoresDisponibles] = useState([]);
  const [revisoresLoading, setRevisoresLoading] = useState(false);

  // Cargar revisores cuando se abre el modal de envío a revisión.
  useEffect(() => {
    if (!revisionDialogVisible) return;
    setRevisoresLoading(true);
    listarRevisoresDisponibles()
      .then((rs) => setRevisoresDisponibles(rs || []))
      .catch(() => setRevisoresDisponibles([]))
      .finally(() => setRevisoresLoading(false));
  }, [revisionDialogVisible]);

  /* ── Historial timeline ── */
  const [historialVisible, setHistorialVisible] = useState(false);
  const [historialData, setHistorialData] = useState([]);
  const [historialResumen, setHistorialResumen] = useState(null);
  const [historialLoading, setHistorialLoading] = useState(false);

  /* ── Generic prompt dialogs (replace native window.prompt) ── */
  const [promptDialog, setPromptDialog] = useState({ visible: false, title: '', label: '', value: '', resolver: null });
  const askValue = useCallback(({ title, label, defaultValue = '' }) => {
    return new Promise((resolve) => {
      setPromptDialog({ visible: true, title, label, value: defaultValue, resolver: resolve });
    });
  }, []);
  const handlePromptAccept = () => {
    promptDialog.resolver?.(promptDialog.value);
    setPromptDialog({ visible: false, title: '', label: '', value: '', resolver: null });
  };
  const handlePromptCancel = () => {
    promptDialog.resolver?.(null);
    setPromptDialog({ visible: false, title: '', label: '', value: '', resolver: null });
  };

  /* ── Fase 2: confirmación informativa de auto-aprobación ── */
  const [autoAprobDialog, setAutoAprobDialog] = useState({ visible: false, titulo: '', descripcion: '', resolver: null });
  const askAutoAprobacion = useCallback(({ titulo, descripcion }) => {
    return new Promise((resolve) => {
      setAutoAprobDialog({ visible: true, titulo, descripcion, resolver: resolve });
    });
  }, []);
  const handleAutoAprobAccept = () => {
    autoAprobDialog.resolver?.(true);
    setAutoAprobDialog({ visible: false, titulo: '', descripcion: '', resolver: null });
  };
  const handleAutoAprobCancel = () => {
    autoAprobDialog.resolver?.(false);
    setAutoAprobDialog({ visible: false, titulo: '', descripcion: '', resolver: null });
  };

  /** Flag to skip the "clear results on mezcla change" effect during saved design load */
  const skipMezclaClearRef = useRef(false);
  /**
   * Refs por card de sugerencia + índice de la card recientemente ajustada.
   * Sesión 2026-05-27 (Issue 1): tras cerrar el editor de proporciones, hacemos
   * scroll automático + pulso visual sobre la card editada para que el usuario
   * no pierda de vista cuál modificó (antes el sufijo "(ajustada)" era muy
   * sutil y el usuario podía seleccionar la equivocada).
   */
  const sugCardRefs = useRef([]);
  const [sugRecienAjustadaIdx, setSugRecienAjustadaIdx] = useState(null);

  /* ── Loaded design lifecycle info ── */
  const [loadedDosif, setLoadedDosif] = useState(null); // full row from API
  const loadedEstado = loadedDosif?.estado || "BORRADOR";
  const isEditable = !loadedDosif || loadedEstado === 'BORRADOR';
  const [viewMode, setViewMode] = useState(false);
  const [sugerencias, setSugerencias] = useState([]);
  const [sugerenciasLoading, setSugerenciasLoading] = useState(false);
  // Editor interactivo de proporciones (modal post-selección de sugerencia)
  const [editorSugerencia, setEditorSugerencia] = useState(null);
  const [editorParametros, setEditorParametros] = useState(null);
  // Issue 2 (sesión 2026-05-27): editor de proporciones para la mezcla ya
  // seleccionada. Cuando este state contiene un payload de tipo
  // {componentes, indicadores, ...} idéntico al shape de una sugerencia, el
  // modal abre en modo 'mezcla' y al confirmar persiste via el endpoint
  // /dosificacion-diseno/:id/mezcla/proporciones (inplace o fork).
  const [editorMezclaEnUso, setEditorMezclaEnUso] = useState(null);
  // Banner amarillo "la mezcla cambió, recalculá" tras editar proporciones.
  const [mezclaCambioDesdeUltimoCalculo, setMezclaCambioDesdeUltimoCalculo] = useState(false);
  // Issue 3 (sesión 2026-05-27): recomendación de aditivos del último cálculo.
  // El motor SIEMPRE respeta la elección manual; este state alimenta el banner
  // <AditivoDivergenciaAlert> que muestra qué hubiera sugerido el motor.
  const [aditivosRecomendadosUltimoCalculo, setAditivosRecomendadosUltimoCalculo] = useState(null);
  const [alertasMaterial, setAlertasMaterial] = useState([]);
  const [materialesDisponibles, setMaterialesDisponibles] = useState(null); // { finos: [], gruesos: [], selected: Set }
  const [showMaterialSelector, setShowMaterialSelector] = useState(false);
  const [ocultarMezclasGuardadas, setOcultarMezclasGuardadas] = useState(false);
  // Listas visibles (filtradas opcionalmente por el toggle "Ocultar mezclas guardadas")
  const finosVisibles = useMemo(() => {
    if (!materialesDisponibles?.finos) return [];
    return ocultarMezclasGuardadas
      ? materialesDisponibles.finos.filter(m => !m.esMezcla)
      : materialesDisponibles.finos;
  }, [materialesDisponibles, ocultarMezclasGuardadas]);
  const gruesosVisibles = useMemo(() => {
    if (!materialesDisponibles?.gruesos) return [];
    return ocultarMezclasGuardadas
      ? materialesDisponibles.gruesos.filter(m => !m.esMezcla)
      : materialesDisponibles.gruesos;
  }, [materialesDisponibles, ocultarMezclasGuardadas]);
  const [logisticaResult, setLogisticaResult] = useState(null);
  const [aditivosRecomendados, setAditivosRecomendados] = useState(null);
  const isReadOnly = viewMode || (loadedDosif && !isEditable);
  const isAPrueba = loadedEstado === 'A_PRUEBA';

  /* ── Vista por fase (tabs) ── */
  // En BORRADOR no hay tabs (todo visible). Fuera de BORRADOR, tabs contextuales.
  const showTabs = loadedDosif && loadedEstado !== 'BORRADOR';
  const [activeTab, setActiveTab] = useState('resumen');

  // Tabs disponibles según estado
  const tabItems = useMemo(() => {
    if (!showTabs) return [];
    const items = [];
    if (['A_PRUEBA'].includes(loadedEstado)) {
      items.push({ label: 'Prueba', icon: 'fa-solid fa-flask-vial', command: () => setActiveTab('prueba') });
    }
    items.push({ label: 'Resumen', icon: 'fa-solid fa-clipboard-list', command: () => setActiveTab('resumen') });
    if (['EN_PRODUCCION', 'APROBADO', 'SUSPENDIDO'].includes(loadedEstado)) {
      items.push({ label: 'Producción', icon: 'fa-solid fa-industry', command: () => setActiveTab('produccion') });
    }
    items.push({ label: 'Diseño completo', icon: 'fa-solid fa-drafting-compass', command: () => setActiveTab('diseno') });
    return items;
  }, [showTabs, loadedEstado]);

  const activeTabIndex = useMemo(() => {
    const labels = tabItems.map(t => t.label);
    const map = { prueba: 'Prueba', resumen: 'Resumen', produccion: 'Producción', diseno: 'Diseño completo' };
    const idx = labels.indexOf(map[activeTab]);
    return idx >= 0 ? idx : 0;
  }, [tabItems, activeTab]);

  // Al cambiar de estado, resetear al tab default de ese estado
  useEffect(() => {
    if (!showTabs) return;
    if (loadedEstado === 'A_PRUEBA') setActiveTab('prueba');
    else if (['EN_PRODUCCION', 'APROBADO'].includes(loadedEstado)) setActiveTab('resumen');
    else setActiveTab('resumen');
  }, [loadedEstado, showTabs]);

  /* ── Production results (FUNC-05) ── */
  const [prodResults, setProdResults] = useState(null);
  const [prodLoading, setProdLoading] = useState(false);
  const [dosifCatalogo, setDosifCatalogo] = useState([]);
  const [linkingCatalogo, setLinkingCatalogo] = useState(false);
  const showProduccion = loadedDosif && ['APROBADO', 'EN_PRODUCCION', 'SUSPENDIDO'].includes(loadedEstado);

  const { user } = useUserContext();

  // RBAC Fase 1 — gateo en frontend con tabla central de acciones (espejo del
  // backend). `can('accion')` es el predicado granular; `puedeAprobarTransiciones`
  // queda como alias retrocompatible para los botones de transición existentes.
  // Para acciones nuevas (override, suspender, archivar específicos) usar `can`
  // directamente con la acción correspondiente.
  const can = useCanPerform(user);
  const puedeAprobarTransiciones = useMemo(
    () => can('dosif.aprobarProduccion'),
    [can]
  );

  const rolPrincipal = useMemo(() => getRolPrincipal(user), [user]);

  // K.3 — estado del dialog de override. Se abre cuando el backend devuelve
  // 422 con overridable=true / code=REQUIRES_TECHNICAL_EVIDENCE.
  const [overrideDialog, setOverrideDialog] = useState({
    visible: false,
    context: null,
    retry: null,
  });

  // Fase 3 — estado del dialog de override de pastón aprobado. Se abre cuando
  // el backend devuelve 422 con `code: PASTON_REQUERIDO` al transicionar a
  // EN_PRODUCCION sin un pastón APROBADO.
  const [overridePastonDialog, setOverridePastonDialog] = useState({
    visible: false,
    motivoError: null,
    onConfirm: null,
  });

  // K.3 — wrapper de transicionarEstado que detecta el error de evidencia
  // faltante y abre el dialog con retry automático tras firmar el override.
  // Fase 2 — además detecta auto-aprobación con datos ya cargados y muestra
  // confirm informativo no-bloqueante. Si el backend devuelve `_aviso` en la
  // response (clasificación oficial), muestra toast amarillo destacado.
  const transicionarConOverride = useCallback(async (id, payload, onSuccess) => {
    if (transicionRef.current) return null;
    // Detección frontend (UX). Si hay concentración, pedir confirmación
    // explícita antes de disparar la transición. Si el user cancela,
    // abortamos sin tocar nada.
    const aviso = detectarAutoAprobacion(loadedDosif, user, payload?.nuevoEstado);
    if (aviso) {
      const ok = await askAutoAprobacion({ titulo: aviso.titulo, descripcion: aviso.descripcion });
      if (!ok) return null;
    }

    transicionRef.current = true;
    try {
      const res = await transicionarEstado(id, payload);
      // Toast post-acción si el backend confirmó concentración. Esto es la
      // fuente de verdad — la detección frontend puede dar falsos negativos
      // (datos desactualizados) pero el backend siempre clasifica correcto.
      if (res?._aviso?.tipo === 'concentracion_responsabilidad' && typeof showToast === 'function') {
        const flagsTxt = (res._aviso.etiquetas || []).map(e => e.titulo).join(', ');
        showToast('warn', `Concentración registrada en auditoría: ${flagsTxt || res._aviso.flags.join(', ')}`);
      }
      // Fase 2C — side-effect Betonmatic (toast no bloqueante).
      if (res?._betonmatic && typeof showToast === 'function') {
        const bt = res._betonmatic;
        if (bt.ok) {
          if (bt.accion === 'publicada') {
            showToast('success', `Fórmula publicada en Betonmatic (${bt.codigoDeHormigon || ''})`);
          } else if (bt.accion === 'borrada') {
            showToast('info', 'Fórmula borrada de Betonmatic');
          }
        } else {
          showToast('warn', `Transición OK pero la sincronización con Betonmatic falló: ${bt.mensaje}`);
        }
      }
      if (typeof onSuccess === 'function') await onSuccess(res);
      return res;
    } catch (err) {
      const data = err.response?.data;
      // Fase 3 — Override de pastón aprobado.
      if (data?.code === 'PASTON_REQUERIDO' && data?.overridable) {
        setOverridePastonDialog({
          visible: true,
          motivoError: data.error || data.message || null,
          onConfirm: async ({ firmadoPor, motivo }) => {
            const retryPayload = {
              ...payload,
              metadata: {
                ...(payload?.metadata || {}),
                overridePaston: { firmadoPor, motivo },
              },
            };
            // Llamada directa (sin recursión por transicionarConOverride)
            // para evitar re-disparar la detección de auto-aprobación, que
            // ya pasó en el primer intento.
            const res = await transicionarEstado(id, retryPayload);
            if (res?._overrideAplicado && typeof showToast === 'function') {
              const concentrada = res._overrideAplicado.firmaConcentrada
                ? ' (firmante = aprobador, queda destacado)'
                : '';
              showToast('warn', `Override de pastón firmado por ${res._overrideAplicado.firmadoPor}${concentrada}.`);
            }
            if (typeof onSuccess === 'function') await onSuccess(res);
            return res;
          },
        });
        return null;
      }
      // K.3 — Override de evidencia técnica de mezcla.
      if (data?.overridable && data?.mezclaId && id) {
        setOverrideDialog({
          visible: true,
          context: {
            idDosificacionDisenada: id,
            idMezcla: data.mezclaId,
            mezclaNombre: data.mezclaNombre,
            motivoError: data.error || data.message,
          },
          retry: () => transicionarConOverride(id, payload, onSuccess),
        });
        return null;
      }
      throw err;
    } finally {
      transicionRef.current = false;
    }
  }, [loadedDosif, user, askAutoAprobacion, showToast]);

  /* ── Field setter ── */
  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  /* ═══ Load catalogs on mount ═══ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, c, ad, at, dur, tip, cons, fib, livianos] = await Promise.all([
          getPlantas(),
          getCementos(),
          getAdiciones(),
          getAditivos(),
          getDurabilidadExposicion(),
          getTipologias().catch(() => []),
          getConsistenciaClases().catch(() => []),
          (async () => { try { const { listarFibras } = await import("../../../services/dosificacionDisenoService"); return await listarFibras(); } catch { return []; } })(),
          // 2026-05-29 — Materiales livianos (telgopor, perlita, arcilla
          // expandida). Catálogo separado de Agregados. Si falla silencioso
          // (back-compat con tenants pre-fix) queda [] y la UI alivianado
          // muestra "no hay materiales livianos cargados — agregá uno desde
          // el catálogo".
          (async () => { try { const { listarMaterialesLivianos } = await import("../../../services/materialLivianoService"); return await listarMaterialesLivianos(); } catch { return []; } })(),
        ]);
        if (cancelled) return;
        setPlantas(Array.isArray(p) ? p : p?.data || []);
        setCementos(Array.isArray(c) ? c : []);
        setAdiciones(Array.isArray(ad) ? ad : []);
        setAditivos(Array.isArray(at) ? at : []);
        setFibras(Array.isArray(fib) ? fib : (fib?.data || []));
        setTipologias(Array.isArray(tip) ? tip : []);
        setMaterialesLivianos(Array.isArray(livianos) ? livianos : []);
        setConsistenciaClases(Array.isArray(cons) ? cons.sort((a, b) => (a.orden || 0) - (b.orden || 0)) : []);
        const durRows = Array.isArray(dur) ? dur : [];
        setDurabilidadRows(durRows);
        setExposicionOpciones(durRows.map((d) => ({
          label: `${d.codigo} — ${d.descripcionCorta || d.grupo}`,
          value: d.codigo,
        })));
      } catch (e) {
        console.error("Error cargando catálogos:", e);
        showToast("error", "Error cargando catálogos de referencia");
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══ Load mezclas + catalogos por planta cuando cambia la planta ═══ */
  useEffect(() => {
    if (!form.idPlanta) {
      setMezclas([]);
      setSelectedMezclaDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [m, c, ad, at, fib] = await Promise.all([
          getMezclas(form.idPlanta),
          getCementos(form.idPlanta),
          getAdiciones(form.idPlanta),
          getAditivos(form.idPlanta),
          (async () => { try { const { listarFibras } = await import("../../../services/dosificacionDisenoService"); const r = await listarFibras(form.idPlanta); return r; } catch { return []; } })(),
        ]);
        if (cancelled) return;
        setMezclas(Array.isArray(m) ? m : []);
        setCementos(Array.isArray(c) ? c : []);
        setAdiciones(Array.isArray(ad) ? ad : []);
        setAditivos(Array.isArray(at) ? at : []);
        setFibras(Array.isArray(fib) ? fib : (fib?.data || []));
      } catch (e) {
        console.error("Error cargando catálogos por planta:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [form.idPlanta]);

  useEffect(() => {
    if (!form.mezclaId) {
      setSelectedMezclaDetail(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const mezcla = await getMezcla(form.mezclaId);
        if (!cancelled) setSelectedMezclaDetail(mezcla || null);
      } catch (e) {
        console.error("Error cargando detalle de mezcla:", e);
        if (!cancelled) setSelectedMezclaDetail(null);
      }
    })();

    return () => { cancelled = true; };
  }, [form.mezclaId]);

  /* ═══ Fetch production results when design is loaded in viewable state ═══ */
  useEffect(() => {
    if (!showProduccion || !loadedDosif?.id) {
      setProdResults(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setProdLoading(true);
      try {
        const res = await obtenerResultadosProduccion(loadedDosif.id);
        if (!cancelled) setProdResults(res);
      } catch (err) {
        console.error('Error cargando resultados de producción:', err);
        if (!cancelled) setProdResults(null);
      } finally {
        if (!cancelled) setProdLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showProduccion, loadedDosif?.id]);


  /* ═══ Load saved dosificación from navigation state ═══
     Sesión 2026-05-29: además del `location.state.loadDosificacionId` (usado
     por DosificacionesCatalogoPage al crear una nueva versión), aceptamos el
     query param `?load=<id>` para soportar deep linking desde alertas del
     panel de inicio y desde BetonmaticPanel (window.open). El query param
     no necesita state — funciona si el user pega la URL o vuelve atrás. */
  useEffect(() => {
    const queryParams = new URLSearchParams(location.search || '');
    const loadIdFromQuery = queryParams.get('load');
    const duplicateId = location.state?.duplicateDosificacionId
      || (queryParams.get('duplicate') ? Number(queryParams.get('duplicate')) : null);
    const loadId = duplicateId
      || location.state?.loadDosificacionId
      || (loadIdFromQuery ? Number(loadIdFromQuery) : null);
    // Duplicar: copia datos pero arranca como diseño nuevo (no viewMode).
    const isDuplicate = !!duplicateId;
    if (!isDuplicate && location.state?.viewMode) setViewMode(true);
    else setViewMode(false);
    if (!loadId) {
      // No loadId means fresh design — reset if there was a previous loaded design
      if (loadedDosif) {
        setLoadedDosif(null);
        setForm({ ...EMPTY_FORM });
        setResultado(null);
        setTrazabilidad(null);
        setWarnings([]);
        setCalcErrors([]);
        setCalcStatus({ status: "idle", message: null, details: [] });
        setSaveStatus({ status: "idle", message: null, details: [] });
        setPdfSource(null);
      }
      return;
    }
    if (dataLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await getDosificacion(loadId);
        if (cancelled || !row) return;
        // Duplicar: NO asociamos `loadedDosif` ni alertas — el guardado debe
        // crear un registro nuevo, no actualizar el original.
        if (!isDuplicate) {
          setLoadedDosif(row);
          try {
            const alertas = await getAlertasDosificacion(row.id || row.idDosificacionDisenada);
            setAlertasMaterial(Array.isArray(alertas) ? alertas : []);
          } catch { setAlertasMaterial([]); }
        } else {
          setLoadedDosif(null);
          setAlertasMaterial([]);
        }
        const params = (() => {
          const v = row.parametrosObjetivoJson;
          if (v == null) return {};
          if (typeof v === "object") return v;
          try { return JSON.parse(v); } catch { return {}; }
        })();
        const storedResultado = (() => {
          const v = row.resultadoJson;
          if (v == null) return null;
          if (typeof v === "object") return v;
          try { return JSON.parse(v); } catch { return null; }
        })();
        const storedTrazabilidad = (() => {
          const v = row.trazabilidadJson;
          if (v == null) return null;
          if (typeof v === "object") return v;
          try { return JSON.parse(v); } catch { return null; }
        })();

        // Prevent the "clear on mezcla change" effect from wiping loaded results
        skipMezclaClearRef.current = true;
        // Inferencia defensiva de tipología cuando ni `row.tipologiaCodigo`
        // ni `params.tipologiaCodigo` están poblados (típico en diseños
        // guardados antes de que la columna existiera): si el resultado o
        // la trazabilidad declaran HRDC/ALIVIANADO, derivamos desde ahí.
        const _metodoFromTraza = String(
          storedTrazabilidad?.metodoCalculo
          || storedResultado?.metodoCalculo
          || storedResultado?.metodo
          || ''
        ).toUpperCase();
        let _tipologiaResuelta = row.tipologiaCodigo || params.tipologiaCodigo || null;
        if (!_tipologiaResuelta) {
          if (_metodoFromTraza === 'ALIVIANADO' || params.idMaterialLiviano || storedResultado?.idMaterialLiviano) {
            _tipologiaResuelta = 'alivianado';
          } else if (_metodoFromTraza === 'HRDC') {
            _tipologiaResuelta = 'hrdc';
          } else {
            _tipologiaResuelta = 'convencional';
          }
        }
        setForm({
          ...EMPTY_FORM,
          metodo: "HORMIQUAL",
          tipologiaCodigo: _tipologiaResuelta,
          // Sesión 2026-05-29: rehidratar inputs específicos de Alivianado
          // desde parametrosObjetivoJson. El backend los persiste ahí (no
          // como columnas propias) — ver `parametrosObjetivoJson` build en
          // handleSave + el snapshot del motor.
          idMaterialLiviano: params.idMaterialLiviano != null ? Number(params.idMaterialLiviano) : null,
          dosisPerlasLM3: params.dosisPerlasLM3 != null ? Number(params.dosisPerlasLM3) : EMPTY_FORM.dosisPerlasLM3,
          // HRDC inputs (rehidratados desde parametrosObjetivoJson)
          cementoKgM3: params.cementoKgM3 != null ? Number(params.cementoKgM3) : null,
          densidadObjetivoKgM3: params.densidadObjetivoKgM3 != null ? Number(params.densidadObjetivoKgM3) : null,
          expuestoDesgaste: row.expuestoDesgaste ?? false,
          aspectoSuperficialImportante: row.aspectoSuperficialImportante ?? false,
          tipoArmadura: row.tipoArmadura || "armado",
          tipoHormigonParticular: row.tipoHormigonParticular || null,
          claseHormigonParticular: row.claseHormigonParticular || null,
          espesorElementoMm: row.espesorElementoMm != null ? Number(row.espesorElementoMm) : null,
          requiereHormigonParticular: !!row.tipoHormigonParticular,
          // Duplicar: limpiar identificación para forzar nombre nuevo y que
          // el guardado cree una fila independiente. Conservamos parámetros,
          // materiales, mezcla, aditivos y resultado del cálculo.
          nombre: isDuplicate ? "" : (row.nombre || ""),
          descripcion: isDuplicate ? "" : (row.descripcion || ""),
          idPlanta: row.idPlanta || null,
          resistenciaMpa: params.resistenciaMpa != null ? Number(params.resistenciaMpa) : null,
          edadDias: params.edadDias != null ? Number(params.edadDias) : 28,
          asentamientoMm: params.asentamientoMm != null ? Number(params.asentamientoMm) : null,
          consistenciaClase: params.consistenciaClase || null,
          consistenciaMetodo: params.consistenciaMetodo || null,
          consistenciaValor: params.consistenciaValor != null ? Number(params.consistenciaValor) : null,
          tmnMm: params.tmnMm != null ? Number(params.tmnMm) : null,
          airePct: params.airePct != null ? Number(params.airePct) : null,
          aireAtrapado: params.aireAtrapado != null ? Number(params.aireAtrapado) : null,
          aireAtapadoAuto: params.aireAtrapado == null && params.airePct == null,
          aireIncorporado: params.aireIncorporado != null ? Number(params.aireIncorporado) : null,
          formaAgregado: params.formaAgregado ?? null,
          mezclaId: row.idMezcla || null,
          cementoId: row.idCemento || null,
          adicion1Id: row.idAdicion1 || null,
          adicion1Pct: row.pctReemplazoAdicion1 != null ? Number(row.pctReemplazoAdicion1) : null,
          adicion2Id: row.idAdicion2 || null,
          adicion2Pct: row.pctReemplazoAdicion2 != null ? Number(row.pctReemplazoAdicion2) : null,
          aditivo1Id: row.idAditivo1 || null,
          aditivo1Dosis: row.dosisAditivo1 != null ? Number(row.dosisAditivo1) : null,
          aditivo1Modo: row.modoEfectoAditivo1 || null,
          aditivo2Id: row.idAditivo2 || null,
          aditivo2Dosis: row.dosisAditivo2 != null ? Number(row.dosisAditivo2) : null,
          aditivo2Modo: row.modoEfectoAditivo2 || null,
          aditivo3Id: row.idAditivo3 || null,
          aditivo3Dosis: row.dosisAditivo3 != null ? Number(row.dosisAditivo3) : null,
          aditivo3Modo: row.modoEfectoAditivo3 || null,
          aditivo1Etapa: row.etapaAditivo1 || "PLANTA",
          aditivo2Etapa: row.etapaAditivo2 || "PLANTA",
          aditivo3Etapa: row.etapaAditivo3 || "PLANTA",
          aditivo1EsCorreccion: row.esCorreccionAditivo1 === true || row.esCorreccionAditivo1 === 1,
          aditivo2EsCorreccion: row.esCorreccionAditivo2 === true || row.esCorreccionAditivo2 === 1,
          aditivo3EsCorreccion: row.esCorreccionAditivo3 === true || row.esCorreccionAditivo3 === 1,
          idMacrofibra: row.idMacrofibra || null,
          nombreMacrofibra: row.nombreMacrofibra || "",
          dosisMacrofibraKgM3: row.dosisMacrofibraKgM3 != null ? Number(row.dosisMacrofibraKgM3) : null,
          idMicrofibra: row.idMicrofibra || null,
          nombreMicrofibra: row.nombreMicrofibra || "",
          dosisMicrofibraKgM3: row.dosisMicrofibraKgM3 != null ? Number(row.dosisMicrofibraKgM3) : null,
          // ICPA-specific
          fce: params.fce != null ? Number(params.fce) : null,
          desvioS: params.desvioS != null ? Number(params.desvioS) : null,
          origenS: params.origenS ?? null,
          exposicion: params.exposicion ?? null,
          tipoHormigonEstructural: params.tipoHormigonEstructural ?? EMPTY_FORM.tipoHormigonEstructural,
          factorPrudencial: params.factorPrudencial != null ? Number(params.factorPrudencial) : EMPTY_FORM.factorPrudencial,
          modoCurvaAC: params.modoCurvaAC || EMPTY_FORM.modoCurvaAC,
          // Restricciones de pliego
          acMaxPliego: params.acMaxPliego != null ? Number(params.acMaxPliego) : null,
          acModo: params.acModo ?? EMPTY_FORM.acModo,
          amcMaxPliego: params.amcMaxPliego != null ? Number(params.amcMaxPliego) : null,
          cementoMinPliego: params.cementoMinPliego != null ? Number(params.cementoMinPliego) : null,
          // Logística y colocación
          modoAsentamiento: params.modoAsentamiento ?? EMPTY_FORM.modoAsentamiento,
          metodoColocacion: row.metodoColocacion || params.metodoColocacion || EMPTY_FORM.metodoColocacion,
          tiempoViaje: params.tiempoViaje != null ? Number(params.tiempoViaje) : EMPTY_FORM.tiempoViaje,
          tiempoDescarga: params.tiempoDescarga != null ? Number(params.tiempoDescarga) : EMPTY_FORM.tiempoDescarga,
          tiempoEspera: params.tiempoEspera != null ? Number(params.tiempoEspera) : EMPTY_FORM.tiempoEspera,
          temperaturaAmbiente: params.temperaturaAmbiente != null ? Number(params.temperaturaAmbiente) : EMPTY_FORM.temperaturaAmbiente,
        });
        if (storedResultado) setResultado(storedResultado);
        if (storedTrazabilidad) setTrazabilidad(storedTrazabilidad);
        if (params.humedadAgregados) setHumedadAgregados(params.humedadAgregados);
        if (storedResultado) {
          // Reconstruir el "resultado original" del motor para el panel de
          // ajuste manual de cemento. Si el diseño guardado tiene ajuste
          // aplicado (resultadoJson.ajusteCemento.aplicado === true), el
          // `cementoKgM3` actual es el ADOPTADO, no el calculado original.
          // Como no podemos re-correr el motor desde acá sin viajar al
          // backend, usamos los snapshots embebidos en `ajusteCemento`.
          if (storedResultado.ajusteCemento?.aplicado) {
            const aj = storedResultado.ajusteCemento;
            // Reconstrucción aproximada del resultado original: cemento +
            // agregados re-escalados al volumen original.
            const cementoCalc = aj.cementoCalculadoKgM3;
            const volAgregadosOriginal = aj.volAgregadosOriginalM3;
            const volAgregadosActual = storedResultado.volumenAgregados || aj.volAgregadosAjustadoM3;
            const factorVol = volAgregadosActual > 0 ? volAgregadosOriginal / volAgregadosActual : 1;
            const agregadosOriginales = (storedResultado.agregados || []).map((ag) => ({
              ...ag,
              volAbsolutoM3: Math.round((ag.volAbsolutoM3 || 0) * factorVol * 10000) / 10000,
              kgM3: Math.round((ag.kgM3 || 0) * factorVol),
            }));
            setResultadoOriginal({
              ...storedResultado,
              cementoKgM3: cementoCalc,
              cementoTotalKgM3: storedResultado.cementoTotalKgM3 != null
                ? Math.round((Number(storedResultado.cementoTotalKgM3) - aj.deltaKg) * 100) / 100
                : storedResultado.cementoTotalKgM3,
              agregados: agregadosOriginales,
              volumenAgregados: volAgregadosOriginal,
              ajusteCemento: undefined,
            });
            setAjusteCementoForm({
              cementoAdoptadoKgM3: aj.cementoAdoptadoKgM3,
              motivo: aj.motivo,
              motivoOtro: aj.motivoOtro || '',
            });
          } else {
            setResultadoOriginal(storedResultado);
            setAjusteCementoForm({
              cementoAdoptadoKgM3: storedResultado.cementoKgM3,
              motivo: null,
              motivoOtro: '',
            });
          }
          setAjusteCementoErrors([]);
          if (isDuplicate) {
            // Al duplicar el estado de guardado debe ser "idle" — no hay
            // diseño persistido todavía.
            setCalcStatus({ status: "ok", message: "Datos copiados desde el diseño original. Asigná un nombre nuevo antes de guardar.", details: [] });
            setSaveStatus({ status: "idle", message: null, details: [] });
            showToast("info", `Duplicado desde "${row.nombre || `Diseño #${row.id}`}". Cambiá nombre y datos identificatorios antes de guardar.`);
          } else {
            setCalcStatus({ status: "ok", message: "Resultado cargado desde diseño guardado.", details: [] });
            setSaveStatus({ status: "ok", message: null, details: [] });
          }
        }
      } catch (e) {
        console.error("Error cargando dosificación guardada:", e);

        showToast("error", "No se pudo cargar el diseño guardado");
      }
    })();
    return () => { cancelled = true; };
  }, [location.state?.loadDosificacionId, location.state?.duplicateDosificacionId, location.search, dataLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ═══ Dropdown options ═══ */
  // Fallback HRDC: la fila se siembra por migración (20260429-seed-tipologia-hrdc),
  // pero si esa migración no corrió todavía aseguramos que la opción aparezca igual.
  // El motor HRDC tiene los límites hardcoded en domain/, así que no depende de la
  // metadata de la fila para funcionar.
  const tipologiaOptions = useMemo(() => {
    const opciones = tipologias.map((t) => ({ label: t.nombre, value: t.codigo }));
    if (!opciones.some(o => o.value === 'hrdc')) {
      opciones.push({ label: "HRDC — Hormigón de Resistencia y Densidad Controlada", value: "hrdc" });
    }
    // Sesión 2026-05-29: tipología Hormigón Alivianado (telgopor en perlas).
    // Como HRDC, queda fuera del flujo CIRSOC y se calcula con motor propio.
    if (!opciones.some(o => o.value === 'alivianado')) {
      opciones.push({ label: "Alivianado — Hormigón con agregado liviano (telgopor)", value: "alivianado" });
    }
    return opciones;
  }, [tipologias]);

  const plantaOptions = useMemo(() => plantas.map((p) => ({
    label: p.nombre, value: p.idPlanta,
  })), [plantas]);

  const cementoOptions = useMemo(() => cementos.map((c) => ({
    label: `${c.nombreComercial || "Sin nombre"} — ${c.fabricante || ""}`.trim(),
    value: c.idCemento,
  })), [cementos]);

  const adicionOptions = useMemo(() => adiciones.map((a) => ({
    label: a.nombre || a._sourceId || "Adición",
    value: a._sourceId || a.id,
  })), [adiciones]);

  const aditivoOptions = useMemo(() => aditivos.map((a) => {
    const marca = (a.marca || "Sin marca").trim();
    const funcion = (a.funcion || "").trim();
    const lm = marca.toLowerCase(), lf = funcion.toLowerCase();
    const dedup = funcion && !(lm.includes(lf) || lf.includes(lm));
    return { label: dedup ? `${marca} — ${funcion}` : marca, value: a.idAditivo };
  }), [aditivos]);

  // Si hay fibras tipificadas como MACRO/MICRO, filtramos; si no, mostramos todas
  // las activas en ambos dropdowns (para no bloquear al usuario mientras se
  // tipifican las existentes en el catálogo).
  const fibrasActivas = useMemo(() => (fibras || []).filter(f => f.activo !== false), [fibras]);
  const hayTipadas = useMemo(() => fibrasActivas.some(f => f.tipo === 'MACRO' || f.tipo === 'MICRO'), [fibrasActivas]);
  const fmtFibra = (f) => `${f.marca}${f.fabrica ? ` — ${f.fabrica}` : ''}${f.tipo && f.tipo !== 'OTRO' ? ` [${f.tipo}]` : ''}`;
  const macrofibraOptions = useMemo(() =>
    fibrasActivas.filter(f => !hayTipadas || f.tipo === 'MACRO' || f.tipo === 'OTRO')
      .map(f => ({ label: fmtFibra(f), value: f.idFibra, nombre: f.marca })),
    [fibrasActivas, hayTipadas]);
  const microfibraOptions = useMemo(() =>
    fibrasActivas.filter(f => !hayTipadas || f.tipo === 'MICRO' || f.tipo === 'OTRO')
      .map(f => ({ label: fmtFibra(f), value: f.idFibra, nombre: f.marca })),
    [fibrasActivas, hayTipadas]);

  const mezclaOptions = useMemo(() => mezclas
    .filter((m) => (m.tipoMezcla || "TOTAL") === "TOTAL")
    .map((m) => ({
      label: m.nombre,
      value: m.idMezcla,
    })), [mezclas]);

  const cementosById = useMemo(
    () => Object.fromEntries(cementos.map((item) => [item.idCemento, item])),
    [cementos]
  );

  const adicionesById = useMemo(
    () => Object.fromEntries(adiciones.map((item) => [item._sourceId || item.id, item])),
    [adiciones]
  );

  const aditivosById = useMemo(
    () => Object.fromEntries(aditivos.map((item) => [item.idAditivo, item])),
    [aditivos]
  );

  /* ═══ Selected mezcla info ═══ */
  const selectedMezclaBase = useMemo(
    () => mezclas.find((m) => m.idMezcla === form.mezclaId),
    [mezclas, form.mezclaId]
  );

  const selectedMezcla = useMemo(() => {
    if (selectedMezclaDetail?.idMezcla === form.mezclaId) return selectedMezclaDetail;
    return selectedMezclaBase || null;
  }, [form.mezclaId, selectedMezclaBase, selectedMezclaDetail]);

  /* ═══ Derived TMN and forma from mezcla ═══ */
  const hasMezcla = !!selectedMezcla;
  const derivedTmn = selectedMezcla?.tmnCalculadoMm ? Number(selectedMezcla.tmnCalculadoMm) : null;
  const derivedForma = hasMezcla ? (selectedMezcla?.derivedForma || "NO_DEFINIDO") : null;
  const effectiveTmn = hasMezcla ? derivedTmn : null;
  const effectiveForma = hasMezcla ? derivedForma : null;
  const derivedFormaResolved = !!derivedForma && derivedForma !== "NO_DEFINIDO";

  /* ═══ Validation ═══ */
  const legacyExposicionWarning = form.exposicion != null && LEGACY_EXPOSICION_CODES.has(form.exposicion);

  // Sugerencias CIRSOC Tabla 2.5 por clase de exposición — desde datos de BD
  const sugerenciaCIRSOC = useMemo(() => {
    if (!form.exposicion || !durabilidadRows.length) return null;
    const row = durabilidadRows.find(d => d.codigo === form.exposicion);
    if (!row) return null;
    const tipo = (form.tipoArmadura || 'armado').toLowerCase();
    const acMax = tipo === 'simple' ? row.acMaxSimple : tipo === 'pretensado' ? row.acMaxPretensado : row.acMaxArmado;
    const fcMin = tipo === 'simple' ? row.fcminSimple : tipo === 'pretensado' ? row.fcminPretensado : row.fcminArmado;
    const cementoMin = tipo === 'simple' ? null : 280; // §4.1.5.2
    return {
      acMax: acMax != null ? Number(acMax) : null,
      fcMin: fcMin != null ? Number(fcMin) : null,
      cementoMin,
      claseBase: row.codigo,
    };
  }, [form.exposicion, form.tipoArmadura, durabilidadRows]);

  // Detect if any additive slot has INCORPORADOR_AIRE effect
  const hasIncorporadorAire = [form.aditivo1Modo, form.aditivo2Modo, form.aditivo3Modo].includes("INCORPORADOR_AIRE");

  // Detectar aditivos duplicados (mismo ID seleccionado en más de un slot)
  const aditivoIds = [form.aditivo1Id, form.aditivo2Id, form.aditivo3Id].filter(Boolean);
  const aditivoDuplicado = aditivoIds.length !== new Set(aditivoIds).size;
  const canCalc = useMemo(() => {
    const hasInputs = !!form.idPlanta && !!form.mezclaId && !!form.cementoId;
    if (esHRDC) {
      // HRDC/RDC (Fase 3): cemento input directo + espumígeno + CONSISTENCIA
      // objetivo (gobierna el agua, AAHE N°16 / Segerer). f'c es OPCIONAL.
      const hasConsistRDC = (form.consistenciaMetodo && form.consistenciaValor > 0) || form.asentamientoMm > 0;
      return hasInputs && Number(form.cementoKgM3) > 0 && hasConsistRDC && !hrdcBloqueoEspumigeno;
    }
    if (esAlivianado) {
      // Alivianado (2026-05-29): modelo análogo a HRDC. Cemento input
      // directo + consistencia gobierna el agua + material liviano +
      // dosis. f'c es OPCIONAL (verificación orientativa por banda).
      const hasConsistAli = (form.consistenciaMetodo && form.consistenciaValor > 0) || form.asentamientoMm > 0;
      return hasInputs
        && Number(form.cementoKgM3) > 0
        && hasConsistAli
        && !!form.idMaterialLiviano
        && Number(form.dosisPerlasLM3) > 0;
    }
    const hasTmn = hasMezcla && !!derivedTmn;
    const hasForma = hasMezcla && derivedFormaResolved;
    const hasConsistencia = (form.consistenciaClase && form.consistenciaMetodo && form.consistenciaValor > 0) || form.asentamientoMm > 0;
    return hasInputs && form.fce > 0 && hasConsistencia && hasTmn && hasForma;
  }, [esHRDC, esAlivianado, hrdcBloqueoEspumigeno, form.idPlanta, form.mezclaId, form.cementoId, form.cementoKgM3, form.fce, form.asentamientoMm, form.consistenciaClase, form.consistenciaMetodo, form.consistenciaValor, form.idMaterialLiviano, form.dosisPerlasLM3, hasMezcla, derivedTmn, derivedFormaResolved]);

  const canSave = !!resultado && canCalc;

  /* ── Preview del ajuste manual de cemento ──
     Si el usuario completó el valor adoptado distinto al calculado, corremos
     el engine localmente para mostrar el delta, el nuevo a/c efectivo y los
     agregados redistribuidos en vivo, sin viajar al backend. Si todavía no
     hay motivo válido, el preview muestra los deltas pero los errores del
     engine se muestran inline para guiar al usuario. */
  const previewAjusteCemento = useMemo(() => {
    if (!resultadoOriginal || ajusteCementoForm.cementoAdoptadoKgM3 == null) return null;
    const cementoAdoptado = Number(ajusteCementoForm.cementoAdoptadoKgM3);
    if (!Number.isFinite(cementoAdoptado)) return null;
    // Si no hay delta, no hay ajuste — devolvemos pseudo-preview de "sin cambios".
    if (Math.abs(cementoAdoptado - Number(resultadoOriginal.cementoKgM3)) < 0.05) {
      return { sinCambios: true };
    }
    return aplicarAjusteCemento(resultadoOriginal, {
      cementoAdoptadoKgM3: cementoAdoptado,
      motivo: ajusteCementoForm.motivo || 'REDONDEO',  // motivo placeholder para que el engine procese
      motivoOtro: ajusteCementoForm.motivoOtro,
    });
  }, [resultadoOriginal, ajusteCementoForm.cementoAdoptadoKgM3, ajusteCementoForm.motivo, ajusteCementoForm.motivoOtro]);

  /**
   * Aplica el ajuste al `resultado` que se va a guardar. Llama al engine con
   * el motivo real (validado), persiste el resultado ajustado en estado y
   * limpia errores. Si falla la validación (motivo vacío, OTRO sin texto)
   * setea errores inline sin tocar `resultado`.
   */
  const aplicarAjusteAlResultado = () => {
    if (!resultadoOriginal) return;
    const { resultadoAjustado, errores } = aplicarAjusteCemento(resultadoOriginal, {
      cementoAdoptadoKgM3: Number(ajusteCementoForm.cementoAdoptadoKgM3),
      motivo: ajusteCementoForm.motivo,
      motivoOtro: ajusteCementoForm.motivoOtro,
      usuario: user?.name || user?.username || null,
    });
    if (errores && errores.length > 0) {
      setAjusteCementoErrors(errores);
      showToast('warn', errores[0].mensaje);
      return;
    }
    setAjusteCementoErrors([]);
    setResultado(resultadoAjustado);
    showToast('success', 'Ajuste de cemento aplicado al diseño');
  };

  /** Revierte el ajuste y deja el resultado original del motor. */
  const revertirAjusteCemento = () => {
    if (!resultadoOriginal) return;
    setResultado(resultadoOriginal);
    setAjusteCementoForm({ cementoAdoptadoKgM3: resultadoOriginal.cementoKgM3, motivo: null, motivoOtro: '' });
    setAjusteCementoErrors([]);
    showToast('info', 'Ajuste de cemento revertido');
  };

  /* ═══ Computed f'cm for display ═══
     Refleja la misma semántica que `icpaCalcEngine` Step 1:
       ESPECIFICADO (default) → f'cm = f'ce + 1,65·S
       OBJETIVO               → f'cm = f'ce (sin sumar sobrediseño)
     Antes este memo siempre aplicaba la fórmula ESPECIFICADO, por lo que el
     badge "f'cm (calculado)" mostraba el mismo valor en ambos modos del
     toggle de interpretación de f'ce — un bug visible. */
  const fcmDisplay = useMemo(() => {
    if (!form.fce) return null;
    const S = form.desvioS || 0;
    const fceNum = Number(form.fce);
    const sNum = Number(S);
    const fcm = form.tipoHormigonModoFce === 'OBJETIVO'
      ? fceNum
      : fceNum + 1.65 * sNum;
    return Math.round(fcm * 10) / 10;
  }, [form.fce, form.desvioS, form.tipoHormigonModoFce]);

  const mezclaComponentesText = useMemo(() => {
    if (!selectedMezcla?.items?.length) return null;
    return [...selectedMezcla.items]
      .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      .map((it) => `${it.nombreAgregado || it.agregado?.nombre || `Ag. ${it.idAgregado}`} (${it.porcentajeFinal || it.porcentaje}%)`)
      .join(" · ");
  }, [selectedMezcla]);

  /* ═══ Consistency helpers ═══ */
  const selectedConsClass = useMemo(
    () => consistenciaClases.find((c) => c.codigo === form.consistenciaClase) || null,
    [consistenciaClases, form.consistenciaClase]
  );

  // Allowed methods for selected class
  const allowedMethods = useMemo(() => {
    if (!selectedConsClass) return [];
    const m = [];
    if (selectedConsClass.permiteRemoldeo) m.push("remoldeo");
    if (selectedConsClass.permiteAsentamiento) m.push("asentamiento");
    if (selectedConsClass.permiteExtendido) m.push("extendido");
    return m;
  }, [selectedConsClass]);

  // Range/tolerance for selected class + method
  const consistenciaRange = useMemo(() => {
    if (!selectedConsClass || !form.consistenciaMetodo) return null;
    const met = form.consistenciaMetodo;
    const min = Number(selectedConsClass[`${met}Min`]) || 0;
    const max = Number(selectedConsClass[`${met}Max`]) || 0;
    const tol = Number(selectedConsClass[`${met}Tolerancia`]) || 0;
    return { min, max, tol, unit: METODO_UNITS[met] || "" };
  }, [selectedConsClass, form.consistenciaMetodo]);

  // When class changes, auto-select default method
  const handleConsistenciaClaseChange = useCallback((codigo) => {
    const cls = consistenciaClases.find((c) => c.codigo === codigo);
    setForm((prev) => ({
      ...prev,
      consistenciaClase: codigo,
      consistenciaMetodo: cls?.metodoDefecto || null,
      consistenciaValor: null,
      // Keep asentamientoMm for backward compat — will be derived from consistency on calc
      asentamientoMm: null,
    }));
  }, [consistenciaClases]);

  // When method changes, reset value
  const handleConsistenciaMetodoChange = useCallback((metodo) => {
    setForm((prev) => ({
      ...prev,
      consistenciaMetodo: metodo,
      consistenciaValor: null,
      asentamientoMm: null,
    }));
  }, []);

  const parseStoredJson = useCallback((value) => {
    if (value == null) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }, []);

  const getCementoLabel = useCallback((idCemento) => {
    const cemento = cementosById[idCemento];
    if (!cemento) return null;
    return `${cemento.nombreComercial || "Sin nombre"} — ${cemento.fabricante || ""}`.trim();
  }, [cementosById]);

  const getAdicionLabel = useCallback((idAdicion) => {
    const adicion = adicionesById[idAdicion];
    return adicion ? adicion.nombre || adicion._sourceId || "Adición" : null;
  }, [adicionesById]);

  const getAditivoLabel = useCallback((idAditivo) => {
    const aditivo = aditivosById[idAditivo];
    if (!aditivo) return null;
    const marca = (aditivo.marca || "Sin marca").trim();
    const funcion = (aditivo.funcion || "").trim();
    const lm = marca.toLowerCase(), lf = funcion.toLowerCase();
    const dedup = funcion && !(lm.includes(lf) || lf.includes(lm));
    return dedup ? `${marca} — ${funcion}` : marca;
  }, [aditivosById]);

  /* ═══ Corrección por humedad (cálculo client-side) ═══ */
  const correccionHumedad = useMemo(() => {
    if (!resultado?.agregados?.length) return null;
    const entries = Object.entries(humedadAgregados).filter(([, v]) => v != null && v !== "");
    if (entries.length === 0) return null;

    const round1 = (v) => Math.round(v * 10) / 10;
    let totalDeltaAgua = 0;
    const items = resultado.agregados.map((ag) => {
      const idAg = ag.idAgregado || ag.id;
      const hPct = humedadAgregados[idAg] != null ? Number(humedadAgregados[idAg]) : null;
      const absPct = ag.absorcionPct != null ? Number(ag.absorcionPct) : null;
      const kgSSS = ag.kgM3 != null ? Number(ag.kgM3) : null;
      if (hPct == null || absPct == null || kgSSS == null || kgSSS === 0) {
        return { nombre: ag.nombre, idAgregado: idAg, kgSSS, absorcionPct: absPct, humedadPct: hPct, deltaAgua: null, kgNatural: null };
      }
      const deltaAgua = round1(kgSSS * (hPct - absPct) / 100);
      totalDeltaAgua += deltaAgua;
      const kgNatural = round1(kgSSS * (100 + hPct) / (100 + absPct));
      return { nombre: ag.nombre, idAgregado: idAg, kgSSS, absorcionPct: absPct, humedadPct: hPct, deltaAgua, kgNatural };
    });
    totalDeltaAgua = round1(totalDeltaAgua);
    const aguaObra = round1(Number(resultado.aguaLtsM3) - totalDeltaAgua);
    return { aguaObra, deltaAguaTotal: totalDeltaAgua, items };
  }, [resultado, humedadAgregados]);

  const buildDraftSnapshot = useCallback(() => {
    const mMeta = parseStoredJson(selectedMezcla?.metadataResultadoJson) || {};
    const curvaTeoricaRef = (() => {
      if (!selectedMezcla) return null;
      if (mMeta._refs?.teoricaLabel) return mMeta._refs.teoricaLabel;
      if (!selectedMezcla.curvaTeorica) return null;
      const c = selectedMezcla.curvaTeorica;
      return `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ''}`;
    })();
    return {
      isDraft: saveStatus.status !== "ok",
      nombre: form.nombre?.trim() || null,
      descripcion: form.descripcion || null,
      metodo: "HORMIQUAL",
      plantaLabel: plantaOptions.find((item) => item.value === form.idPlanta)?.label || null,
      mezclaLabel: selectedMezcla?.nombre
        ? (selectedMezcla.codigo ? `${selectedMezcla.nombre} (${selectedMezcla.codigo})` : selectedMezcla.nombre)
        : null,
      // ROUND-FINAL 1: propagate mezcla base state so the PDF portada can flag
      // "mezcla base no liberada / fuera de banda" as a critical motivo.
      mezclaEstado: selectedMezcla?.estado || null,
      mezclaEstadoTecnico: selectedMezcla?.estadoTecnico || null,
      mezclaComponentesText,
      tmnMm: effectiveTmn,
      formaAgregado: effectiveForma || "NO_DEFINIDO",
      resistenciaMpa: form.fce,
      fce: form.fce,
      desvioS: form.desvioS,
      origenS: form.origenS,
      fcm: resultado?.fcm ?? fcmDisplay,
      asentamientoMm: form.asentamientoMm,
      consistenciaClase: form.consistenciaClase || null,
      consistenciaMetodo: form.consistenciaMetodo || null,
      consistenciaValor: form.consistenciaValor,
      consistenciaClaseNombre: selectedConsClass?.nombre || null,
      consistenciaRange,
      airePct: form.airePct ?? resultado?.airePct ?? null,
      aireAtrapado: form.aireAtapadoAuto ? null : form.aireAtrapado,
      aireIncorporado: form.aireIncorporado || null,
      exposicion: form.exposicion || null,
      cementoLabel: getCementoLabel(form.cementoId),
      cementoFamilia: cementosById[form.cementoId]?.familiaCemento || cementosById[form.cementoId]?.composicion || null,
      adiciones: [
        form.adicion1Id ? { label: getAdicionLabel(form.adicion1Id), reemplazoPct: form.adicion1Pct } : null,
        form.adicion2Id ? { label: getAdicionLabel(form.adicion2Id), reemplazoPct: form.adicion2Pct } : null,
      ].filter(Boolean),
      aditivos: [
        form.aditivo1Id ? { label: getAditivoLabel(form.aditivo1Id), dosis: form.aditivo1Dosis, modoEfecto: form.aditivo1Modo, etapa: form.aditivo1Etapa || 'PLANTA', esCorreccion: form.aditivo1EsCorreccion === true } : null,
        form.aditivo2Id ? { label: getAditivoLabel(form.aditivo2Id), dosis: form.aditivo2Dosis, modoEfecto: form.aditivo2Modo, etapa: form.aditivo2Etapa || 'PLANTA', esCorreccion: form.aditivo2EsCorreccion === true } : null,
        form.aditivo3Id ? { label: getAditivoLabel(form.aditivo3Id), dosis: form.aditivo3Dosis, modoEfecto: form.aditivo3Modo, etapa: form.aditivo3Etapa || 'PLANTA', esCorreccion: form.aditivo3EsCorreccion === true } : null,
      ].filter(Boolean),
      curvaTeoricaRef,
      curvaTeoricaFamilia: selectedMezcla?.curvaTeorica?.familia || null,
      curvaTeoricaParams: selectedMezcla?.curvaTeorica?.parametros
        ? parseStoredJson(selectedMezcla.curvaTeorica.parametros)
        : null,
      tipologiaCodigo: form.tipologiaCodigo || "convencional",
      resultado,
      // Bug DOS-6UCPY6-K72: si hay ajuste manual de cemento aplicado, la
      // trazabilidad del backend quedó PRE-ajuste. Re-derivamos los sub-objetos
      // dependientes del cemento (balance vol., pulverulento, distribución de
      // agregados) desde el `resultado` ajustado — fuente única de verdad. Sin
      // ajuste, passthrough.
      trazabilidad: deriveTrazabilidadConsistente(resultado, trazabilidad),
      warnings,
      correccionHumedad,
      // Lifecycle info for PDF watermarks/stamps
      estado: loadedDosif?.estado || "BORRADOR",
      version: loadedDosif?.version || 1,
      aprobadoPor: loadedDosif?.aprobadoPor || null,
      fechaAprobacion: loadedDosif?.fechaAprobacion || null,
    };
  }, [
    cementosById,
    correccionHumedad,
    effectiveForma,
    effectiveTmn,
    fcmDisplay,
    form,
    getAditivoLabel,
    getAdicionLabel,
    getCementoLabel,
    mezclaComponentesText,
    plantaOptions,
    resultado,
    saveStatus.status,
    selectedMezcla,
    trazabilidad,
    warnings,
    loadedDosif,
    selectedConsClass,
    consistenciaRange,
  ]);

  const buildSavedSnapshot = useCallback((row) => {
    const params = parseStoredJson(row?.parametrosObjetivoJson) || {};
    const storedResultado = parseStoredJson(row?.resultadoJson);
    const storedTrazabilidad = parseStoredJson(row?.trazabilidadJson);
    // Respeta tipoHormigonModoFce persistido: OBJETIVO no suma 1,65·S. Igual
    // criterio que el motor (`icpaCalcEngine` Step 1) y el badge en vivo
    // (`fcmDisplay`). Antes del fix 2026-05-27 esto siempre sumaba, lo que
    // generaba un f'cm "guardado" inconsistente con OBJETIVO.
    const modoFceSaved = row?.tipoHormigonModoFce === 'OBJETIVO' ? 'OBJETIVO' : 'ESPECIFICADO';
    const fcmSaved = params?.fce != null
      ? Math.round(
          (modoFceSaved === 'OBJETIVO'
            ? Number(params.fce)
            : Number(params.fce) + 1.65 * Number(params.desvioS || 0)
          ) * 10
        ) / 10
      : null;

    const mMeta = parseStoredJson(row?.mezcla?.metadataResultadoJson) || {};
    const curvaTeoricaRef = (() => {
      if (mMeta._refs?.teoricaLabel) return mMeta._refs.teoricaLabel;
      if (!row?.mezcla?.curvaTeorica) return null;
      const c = row.mezcla.curvaTeorica;
      return `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ''}`;
    })();

    return {
      isDraft: false,
      nombre: row?.nombre || null,
      descripcion: row?.descripcion || null,
      metodo: row?.metodo || params?.metodo || null,
      plantaLabel: row?.planta?.nombre || null,
      mezclaLabel: row?.mezcla?.nombre
        ? (row.mezcla.codigo ? `${row.mezcla.nombre} (${row.mezcla.codigo})` : row.mezcla.nombre)
        : null,
      // ROUND-FINAL 1: also expose mezcla base state when loading a saved design
      mezclaEstado: row?.mezcla?.estado || null,
      mezclaEstadoTecnico: row?.mezcla?.estadoTecnico || null,
      mezclaComponentesText: null,
      tmnMm: params?.tmnMm ?? row?.mezcla?.tmnCalculadoMm ?? null,
      formaAgregado: params?.formaAgregado || "NO_DEFINIDO",
      resistenciaMpa: row?.metodo === "ICPA" ? null : params?.resistenciaMpa ?? null,
      fce: params?.fce ?? null,
      desvioS: params?.desvioS ?? null,
      fcm: storedResultado?.fcm ?? fcmSaved,
      asentamientoMm: params?.asentamientoMm ?? null,
      airePct: params?.airePct ?? storedResultado?.airePct ?? null,
      exposicion: params?.exposicion || "NO_APLICA",
      cementoLabel: row?.cemento ? `${row.cemento.nombreComercial || "Sin nombre"} — ${row.cemento.composicion || ""}`.trim() : getCementoLabel(row?.idCemento),
      cementoFamilia: row?.cemento?.familiaCemento || row?.cemento?.composicion || null,
      adiciones: [
        row?.idAdicion1 ? { label: row?.adicion1?.nombre || getAdicionLabel(row.idAdicion1), reemplazoPct: row?.pctReemplazoAdicion1 } : null,
        row?.idAdicion2 ? { label: row?.adicion2?.nombre || getAdicionLabel(row.idAdicion2), reemplazoPct: row?.pctReemplazoAdicion2 } : null,
      ].filter(Boolean),
      aditivos: [
        row?.idAditivo1 ? { label: row?.aditivo1 ? getAditivoLabel(row.idAditivo1) || `${row.aditivo1.marca || "Sin marca"}` : getAditivoLabel(row.idAditivo1), dosis: row?.dosisAditivo1 != null ? Number(row.dosisAditivo1) : null, modoEfecto: row?.modoEfectoAditivo1, etapa: row?.etapaAditivo1 || 'PLANTA', esCorreccion: row?.esCorreccionAditivo1 === true || row?.esCorreccionAditivo1 === 1 } : null,
        row?.idAditivo2 ? { label: row?.aditivo2 ? getAditivoLabel(row.idAditivo2) || `${row.aditivo2.marca || "Sin marca"}` : getAditivoLabel(row.idAditivo2), dosis: row?.dosisAditivo2 != null ? Number(row.dosisAditivo2) : null, modoEfecto: row?.modoEfectoAditivo2, etapa: row?.etapaAditivo2 || 'PLANTA', esCorreccion: row?.esCorreccionAditivo2 === true || row?.esCorreccionAditivo2 === 1 } : null,
        row?.idAditivo3 ? { label: row?.aditivo3 ? getAditivoLabel(row.idAditivo3) || `${row.aditivo3.marca || "Sin marca"}` : getAditivoLabel(row.idAditivo3), dosis: row?.dosisAditivo3 != null ? Number(row.dosisAditivo3) : null, modoEfecto: row?.modoEfectoAditivo3, etapa: row?.etapaAditivo3 || 'PLANTA', esCorreccion: row?.esCorreccionAditivo3 === true || row?.esCorreccionAditivo3 === 1 } : null,
      ].filter(Boolean),
      curvaTeoricaRef,
      curvaTeoricaFamilia: row?.mezcla?.curvaTeorica?.familia || null,
      curvaTeoricaParams: row?.mezcla?.curvaTeorica?.parametros
        ? parseStoredJson(row.mezcla.curvaTeorica.parametros)
        : null,
      tipologiaCodigo: row?.tipologiaCodigo || params?.tipologiaCodigo || "convencional",
      resultado: storedResultado,
      // Bug DOS-6UCPY6-K72: diseños guardados con ajuste manual persistieron
      // la trazabilidad PRE-ajuste (`trazabilidadJson`). Re-derivamos al
      // reabrir para que el PDF de un diseño guardado también sea coherente.
      trazabilidad: deriveTrazabilidadConsistente(storedResultado, storedTrazabilidad),
      warnings: [],
      correccionHumedad: null, // reconstructed at PDF level from saved humedadAgregados
      humedadAgregados: params?.humedadAgregados || null,
      // Lifecycle info for PDF watermarks/stamps
      estado: row?.estado || "BORRADOR",
      version: row?.version || 1,
      aprobadoPor: row?.aprobadoPor || null,
      fechaAprobacion: row?.fechaAprobacion || null,
    };
  }, [getAditivoLabel, getAdicionLabel, getCementoLabel, parseStoredJson]);

  // Bug DOS-6UCPY6-K72: trazabilidad coherente con el resultado liberado para
  // los consumidores ON-SCREEN (la card de pulverulento). Pura y memoizada;
  // passthrough si no hay ajuste manual de cemento.
  const trazabilidadVista = useMemo(
    () => deriveTrazabilidadConsistente(resultado, trazabilidad),
    [resultado, trazabilidad],
  );

  const activeTraceSnapshot = useMemo(() => buildDraftSnapshot(), [buildDraftSnapshot]);
  const activePdfSnapshot = useMemo(() => {
    if (pdfSource?.type === "saved" && pdfSource?.row) return buildSavedSnapshot(pdfSource.row);
    return buildDraftSnapshot();
  }, [buildDraftSnapshot, buildSavedSnapshot, pdfSource]);

  /* ═══ Clear results when mezcla changes (skip during saved design load) ═══ */
  useEffect(() => {
    if (skipMezclaClearRef.current) {

      skipMezclaClearRef.current = false;
      return;
    }

    setResultado(null);
    setTrazabilidad(null);
    setWarnings([]);
    setCalcErrors([]);
    setCalcStatus({ status: "idle", message: null, details: [] });
    setSaveStatus({ status: "idle", message: null, details: [] });
  }, [form.mezclaId]);

  /* ═══ Calculate ═══ */
  const handleCalc = useCallback(async () => {
    // HRDC: validaciones específicas que reemplazan a las CIRSOC
    if (esHRDC) {
      if (!form.cementoKgM3 || Number(form.cementoKgM3) <= 0) {
        showToast('error', 'HRDC: indique el contenido de cemento por m³.');
        setCalcStatus({ status: 'error', message: 'Cemento (kg/m³) requerido para HRDC.' });
        return;
      }
      if (hrdcBloqueoEspumigeno) {
        showToast('error', 'HRDC requiere un aditivo espumígeno cargado en algún slot.');
        setCalcStatus({ status: 'error', message: 'Aditivo espumígeno requerido (HRDC).' });
        return;
      }
    } else {
      if (!derivedFormaResolved) {
        const message = "No se puede calcular: la forma del agregado grueso quedó no definida para la mezcla seleccionada.";
        setCalcStatus({ status: "error", message, details: [{ campo: "formaAgregado", msg: "Complete la clasificación de los agregados gruesos o sus nombres." }] });
        setCalcErrors([{ tipo: "error", msg: message }]);
        showToast("error", message);
        return;
      }

      // CIRSOC 200:2024 — hormigón armado requiere clase de exposición (mínimo A1)
      if ((form.tipoArmadura === 'armado' || form.tipoArmadura === 'pretensado') && !form.exposicion) {
        showToast('error', 'CIRSOC 200:2024 requiere declarar clase de exposición para hormigón armado. Mínimo recomendado: A1.');
        setCalcStatus({ status: 'error', message: 'Clase de exposición requerida para hormigón armado.' });
        return;
      }
    }

    setCalculating(true);
    setResultado(null);
    setTrazabilidad(null);
    setWarnings([]);
    setCalcErrors([]);
    setCalcStatus({ status: "idle", message: null, details: [] });
    setSaveStatus({ status: "idle", message: null, details: [] });
    try {
      const body = {
        idPlanta: form.idPlanta,
        tipologiaCodigo: form.tipologiaCodigo || "convencional",
        // HRDC + Alivianado: cementoKgM3 es input directo (ambas tipologías
        // saltean ICPA y reciben el CUC desde el wizard).
        cementoKgM3: (esHRDC || esAlivianado) ? Number(form.cementoKgM3) : null,
        densidadObjetivoKgM3: esHRDC && form.densidadObjetivoKgM3 != null ? Number(form.densidadObjetivoKgM3) : null,
        // Alivianado inputs (sólo se consumen si tipologiaCodigo === 'alivianado')
        idMaterialLiviano: esAlivianado ? Number(form.idMaterialLiviano) || null : null,
        dosisPerlasLM3: esAlivianado && form.dosisPerlasLM3 != null ? Number(form.dosisPerlasLM3) : null,
        resistenciaMpa: form.fce,
        fce: form.fce,
        desvioS: form.desvioS,
        origenS: form.origenS,
        edadDias: form.edadDias,
        asentamientoMm: form.asentamientoMm,
        consistenciaClase: form.consistenciaClase || null,
        consistenciaMetodo: form.consistenciaMetodo || null,
        consistenciaValor: form.consistenciaValor,
        tmnMm: effectiveTmn,
        airePct: form.aireAtapadoAuto && !form.aireIncorporado
          ? null   // let backend auto-resolve from TMN table
          : (form.aireAtrapado || 0) + (form.aireIncorporado || 0),
        aireAtrapado: form.aireAtapadoAuto ? null : form.aireAtrapado,
        aireIncorporado: form.aireIncorporado || null,
        aireIntencional: hasIncorporadorAire && (form.aireIncorporado || 0) > 0,
        formaAgregado: effectiveForma,
        cementoId: form.cementoId,
        // modoCurvaAC ya no se envía: el backend resuelve la curva desde CementoPlanta (fuente de verdad)
        mezclaId: form.mezclaId,
        exposicion: form.exposicion || null,
        tipoHormigonEstructural: (form.tipoArmadura || "armado").toUpperCase(),
        // factorPrudencialCurva eliminado — S cubre el margen estadístico
        acMaxPliego: form.acMaxPliego ?? null,
        acModo: form.acModo || null,
        amcMaxPliego: form.amcMaxPliego ?? null,
        cementoMinPliego: form.cementoMinPliego ?? null,
        adicion1: form.adicion1Id ? { id: form.adicion1Id, reemplazoPct: form.adicion1Pct || 0 } : null,
        adicion2: form.adicion2Id ? { id: form.adicion2Id, reemplazoPct: form.adicion2Pct || 0 } : null,
        aditivo1: form.aditivo1Id ? { id: form.aditivo1Id, dosis: form.aditivo1Dosis, modoEfecto: form.aditivo1Modo, etapa: form.aditivo1Etapa, esCorreccion: form.aditivo1EsCorreccion === true } : null,
        aditivo2: form.aditivo2Id ? { id: form.aditivo2Id, dosis: form.aditivo2Dosis, modoEfecto: form.aditivo2Modo, etapa: form.aditivo2Etapa, esCorreccion: form.aditivo2EsCorreccion === true } : null,
        aditivo3: form.aditivo3Id ? { id: form.aditivo3Id, dosis: form.aditivo3Dosis, modoEfecto: form.aditivo3Modo, etapa: form.aditivo3Etapa, esCorreccion: form.aditivo3EsCorreccion === true } : null,
        idMacrofibra: form.idMacrofibra || null,
        nombreMacrofibra: form.nombreMacrofibra || null,
        dosisMacrofibraKgM3: form.dosisMacrofibraKgM3 != null ? Number(form.dosisMacrofibraKgM3) : null,
        idMicrofibra: form.idMicrofibra || null,
        nombreMicrofibra: form.nombreMicrofibra || null,
        dosisMicrofibraKgM3: form.dosisMicrofibraKgM3 != null ? Number(form.dosisMicrofibraKgM3) : null,
        // Logística de colocación
        modoAsentamiento: form.modoAsentamiento || 'EN_PLANTA',
        metodoColocacion: form.metodoColocacion || 'CONVENCIONAL',
        tiempoViaje: form.tiempoViaje ?? 30,
        tiempoDescarga: form.tiempoDescarga ?? 30,
        tiempoEspera: form.tiempoEspera ?? 0,
        temperaturaAmbiente: form.temperaturaAmbiente ?? 20,
      };
      if (process.env.NODE_ENV === 'development') {
        console.debug('[dosificacion] payload:', body);
      }
      const res = await calcularDosificacion(body);
      if (process.env.NODE_ENV === 'development') {
        console.debug('[dosificacion] response:', res);
      }

      // B.1 — Envelope validation: backend now wraps in { ok, resultado, ... }
      if (res?.ok === false) {
        const errMsg = res.message || res.error || "Error en el cálculo";
        setCalcErrors([{ tipo: "error", msg: errMsg }]);
        setWarnings(res.details || []);
        setCalcStatus({ status: "error", message: errMsg, details: res.details || [] });
        showToast("error", errMsg);
        return;
      }

      // B.2 — Extract payload (support both envelope and flat shapes)
      const resultado = res?.resultado ?? null;
      const trazabilidad = res?.trazabilidad ?? null;
      const warns = res?.warnings || [];

      // Attach tipología info if returned by engine
      if (res?.tipologia && trazabilidad) {
        trazabilidad._tipologia = res.tipologia;
      }

      setTrazabilidad(trazabilidad);
      setWarnings(warns);
      // Issue 3 (sesión 2026-05-27): capturamos la recomendación del motor
      // para alimentar el banner de divergencia en el panel de aditivos. El
      // form NUNCA se modifica acá — solo se ofrece la opción al usuario.
      setAditivosRecomendadosUltimoCalculo(res?.aditivosRecomendadosMotor || null);

      if (resultado && resultado.aguaLtsM3 != null) {
        setResultado(resultado);
        // Guardamos el snapshot del resultado original del motor antes de
        // cualquier ajuste manual. El panel de ajuste de cemento usa este
        // snapshot como base para re-calcular cuando el usuario cambia el
        // valor adoptado o el motivo.
        setResultadoOriginal(resultado);
        setAjusteCementoForm({ cementoAdoptadoKgM3: resultado.cementoKgM3, motivo: null, motivoOtro: '' });
        setAjusteCementoErrors([]);
        setCalcStatus({ status: "ok", message: "Cálculo realizado correctamente.", details: warns.filter((item) => item.tipo === "advertencia") });
        // Issue 2: un cálculo exitoso reabsorbe los cambios pendientes de
        // mezcla — el banner "Recalculá" deja de tener sentido.
        setMezclaCambioDesdeUltimoCalculo(false);
        showToast("success", "Cálculo realizado");
      } else {
        setResultado(null);
        const blocking = warns.filter(w => w.tipo === "error");
        if (blocking.length > 0) {
          setCalcErrors(blocking);
        } else if (warns.length > 0) {
          setCalcErrors([{ tipo: "error", msg: "No se pudo completar el cálculo — ver advertencias" }]);
        } else {
          setCalcErrors([{ tipo: "error", msg: "No se pudo calcular la dosificación. La respuesta del motor vino incompleta o inválida." }]);
        }
        setCalcStatus({ status: "error", message: "El cálculo no produjo un resultado persistible.", details: blocking.length > 0 ? blocking : warns });
        showToast("warn", "No se pudo completar el cálculo — ver panel de errores");
      }
    } catch (e) {
      console.error("Error en cálculo:", e);
      const data = e.response?.data;
      const httpMsg = data?.message || data?.error || null;
      if (httpMsg) {
        setCalcErrors([{ tipo: "error", msg: httpMsg }]);
        if (Array.isArray(data?.details)) setWarnings(data.details);
        setCalcStatus({ status: "error", message: httpMsg, details: data?.details || [] });
        showToast("error", httpMsg);
      } else {
        setCalcErrors([{ tipo: "error", msg: "Error inesperado al ejecutar el cálculo. Intente nuevamente o verifique los datos ingresados." }]);
        setCalcStatus({ status: "error", message: "Error inesperado al ejecutar el cálculo.", details: [] });
        showToast("error", "Error inesperado al ejecutar el cálculo");
      }
    } finally {
      setCalculating(false);
    }
  }, [derivedFormaResolved, effectiveForma, effectiveTmn, form, selectedMezcla, showToast, esHRDC, hrdcBloqueoEspumigeno]);

  /* ═══ Historial ═══ */
  const handleVerHistorial = useCallback(async () => {
    if (!loadedDosif?.id) return;
    setHistorialVisible(true);
    setHistorialLoading(true);
    try {
      // Fase 4.2 — endpoint enriquecido devuelve { eventos, resumen }.
      const { obtenerHistorialEnriquecido } = await import("../../../services/dosificacionDisenoService");
      const data = await obtenerHistorialEnriquecido(loadedDosif.id);
      setHistorialData(Array.isArray(data?.eventos) ? data.eventos : []);
      setHistorialResumen(data?.resumen || null);
    } catch (err) {
      console.error('[DosificacionDisenoPage] obtenerHistorial:', err);
      setHistorialData([]);
      setHistorialResumen(null);
    } finally {
      setHistorialLoading(false);
    }
  }, [loadedDosif?.id]);

  /* ═══ Save ═══ */
  // Open save dialog (pre-validation then show dialog)
  const openSaveDialog = useCallback(() => {
    if (!form.nombre?.trim()) {
      setSaveStatus({ status: "error", message: "No se pudo guardar: falta el nombre del diseño.", details: [{ campo: "nombre", msg: "Ingrese un nombre para guardar el diseño." }] });
      showToast("warn", "Ingrese un nombre para guardar el diseño");
      return;
    }
    // RDC/HRDC es sólo arena (sin agregado grueso): no tiene "forma del
    // agregado grueso". El backend ya exime a HRDC; el pre-chequeo del
    // frontend debe hacer lo mismo o no se puede guardar un diseño RDC.
    if (!derivedFormaResolved && !esHRDC) {
      const message = "No se pudo guardar el diseño: falta forma del agregado.";
      setSaveStatus({ status: "error", message, details: [{ campo: "formaAgregado", msg: "La mezcla seleccionada no permitió derivar la forma del agregado grueso." }] });
      showToast("error", message);
      return;
    }
    setSaveNotes("");
    setSaveDialogVisible(true);
  }, [form.nombre, derivedFormaResolved, esHRDC, showToast]);

  const handleSave = useCallback(async (notasCambio) => {
    if (savingRef.current) return;
    setSaveDialogVisible(false);
    savingRef.current = true;
    setSaving(true);
    setSaveStatus({ status: "idle", message: null, details: [] });
    try {
      const response = await guardarDosificacion({
        nombre: form.nombre,
        descripcion: form.descripcion,
        idPlanta: form.idPlanta,
        metodo: "HORMIQUAL",
        tipologiaCodigo: form.tipologiaCodigo || "convencional",
        // Refactor 2026-05-20: modo de interpretación de f'ce para derivar
        // la clase IRAM 1666 en el backend. El service usa este flag para
        // mapear "clase inmediata superior" (ESPECIFICADO) vs "más cercana"
        // (OBJETIVO). Default ESPECIFICADO si vino vacío.
        tipoHormigonModoFce: form.tipoHormigonModoFce || "ESPECIFICADO",
        fce: form.fce != null ? Number(form.fce) : null,
        expuestoDesgaste: form.expuestoDesgaste || false,
        aspectoSuperficialImportante: form.aspectoSuperficialImportante || false,
        tipoArmadura: form.tipoArmadura || "armado",
        tipoHormigonParticular: form.tipoHormigonParticular || null,
        claseHormigonParticular: form.claseHormigonParticular || null,
        espesorElementoMm: form.espesorElementoMm != null ? Number(form.espesorElementoMm) : null,
        metodoColocacion: form.metodoColocacion === 'BOMBEADO' ? 'BOMBEADO' : 'CONVENCIONAL',
        // Alivianado (sólo si tipologiaCodigo === 'alivianado')
        idMaterialLiviano: esAlivianado ? Number(form.idMaterialLiviano) || null : null,
        dosisPerlasLM3: esAlivianado && form.dosisPerlasLM3 != null ? Number(form.dosisPerlasLM3) : null,
        idMezcla: form.mezclaId,
        idCemento: form.cementoId,
        idAdicion1: form.adicion1Id,
        pctReemplazoAdicion1: form.adicion1Pct,
        idAdicion2: form.adicion2Id,
        pctReemplazoAdicion2: form.adicion2Pct,
        idAditivo1: form.aditivo1Id,
        dosisAditivo1: form.aditivo1Dosis,
        modoEfectoAditivo1: form.aditivo1Modo,
        idAditivo2: form.aditivo2Id,
        dosisAditivo2: form.aditivo2Dosis,
        modoEfectoAditivo2: form.aditivo2Modo,
        idAditivo3: form.aditivo3Id,
        dosisAditivo3: form.aditivo3Dosis,
        modoEfectoAditivo3: form.aditivo3Modo,
        etapaAditivo1: form.aditivo1Etapa || "PLANTA",
        etapaAditivo2: form.aditivo2Etapa || "PLANTA",
        etapaAditivo3: form.aditivo3Etapa || "PLANTA",
        esCorreccionAditivo1: form.aditivo1EsCorreccion === true,
        esCorreccionAditivo2: form.aditivo2EsCorreccion === true,
        esCorreccionAditivo3: form.aditivo3EsCorreccion === true,
        idMacrofibra: form.idMacrofibra || null,
        nombreMacrofibra: form.nombreMacrofibra || null,
        dosisMacrofibraKgM3: form.dosisMacrofibraKgM3 || null,
        idMicrofibra: form.idMicrofibra || null,
        nombreMicrofibra: form.nombreMicrofibra || null,
        dosisMicrofibraKgM3: form.dosisMicrofibraKgM3 || null,
        parametrosObjetivoJson: JSON.stringify({
          metodo: "HORMIQUAL",
          // 2026-05-29 — Alivianado: persistir inputs específicos para
          // poder rehidratar el form al reabrir la dosificación. El backend
          // los re-lee desde este JSON en cálculos posteriores.
          ...(esAlivianado ? {
            idMaterialLiviano: Number(form.idMaterialLiviano) || null,
            dosisPerlasLM3: form.dosisPerlasLM3 != null ? Number(form.dosisPerlasLM3) : null,
            cementoKgM3: form.cementoKgM3 != null ? Number(form.cementoKgM3) : null,
          } : {}),
          tipologiaCodigo: form.tipologiaCodigo || "convencional",
          // HRDC inputs persistidos
          ...(esHRDC && {
            cementoKgM3: form.cementoKgM3 != null ? Number(form.cementoKgM3) : null,
            densidadObjetivoKgM3: form.densidadObjetivoKgM3 != null ? Number(form.densidadObjetivoKgM3) : null,
          }),
          resistenciaMpa: form.fce,
          fce: form.fce,
          desvioS: form.desvioS,
          origenS: form.origenS,
          edadDias: form.edadDias,
          asentamientoMm: form.asentamientoMm,
          consistenciaClase: form.consistenciaClase || null,
          consistenciaMetodo: form.consistenciaMetodo || null,
          consistenciaValor: form.consistenciaValor,
          tmnMm: effectiveTmn,
          airePct: form.airePct,
          aireAtrapado: form.aireAtapadoAuto ? null : form.aireAtrapado,
          aireIncorporado: form.aireIncorporado || null,
          formaAgregado: effectiveForma,
          exposicion: form.exposicion || null,
          // modoCurvaAC eliminado: backend resuelve desde CementoPlanta
          tipoHormigonEstructural: (form.tipoArmadura || "armado").toUpperCase(),
          factorPrudencial: form.factorPrudencial,
          // Restricciones de pliego
          ...(form.acMaxPliego != null && { acMaxPliego: form.acMaxPliego, acModo: form.acModo }),
          ...(form.amcMaxPliego != null && { amcMaxPliego: form.amcMaxPliego }),
          ...(form.cementoMinPliego != null && { cementoMinPliego: form.cementoMinPliego }),
          // Logística y colocación
          modoAsentamiento: form.modoAsentamiento || 'EN_PLANTA',
          metodoColocacion: form.metodoColocacion || 'CONVENCIONAL',
          tiempoViaje: form.tiempoViaje ?? 30,
          tiempoDescarga: form.tiempoDescarga ?? 30,
          tiempoEspera: form.tiempoEspera ?? 0,
          temperaturaAmbiente: form.temperaturaAmbiente ?? 25,
          // Corrección por humedad
          ...(Object.keys(humedadAgregados).length > 0 && { humedadAgregados }),
        }),
        resultadoJson: resultado ? JSON.stringify(resultado) : null,
        // Bug DOS-6UCPY6-K72: persistir la trazabilidad COHERENTE con el
        // resultado liberado. Si hubo ajuste manual de cemento, se guarda la
        // versión re-derivada (no la PRE-ajuste del motor).
        trazabilidadJson: trazabilidad
          ? JSON.stringify(deriveTrazabilidadConsistente(resultado, trazabilidad))
          : null,
        notasCambio: notasCambio || null,
      });

      if (response?.ok === false) {
        const message = response.message || "No se pudo guardar el diseño.";
        setSaveStatus({ status: "error", message, details: response.details || [] });
        showToast("error", message);
        return;
      }

      setSaveStatus({ status: "ok", message: "Diseño guardado correctamente.", details: [] });
      showToast("success", "Diseño guardado");

      // Hidratar `loadedDosif` con el registro persistido para habilitar las
      // acciones in-place (Enviar a prueba, sección de pastón) sin tener que
      // entrar por Catálogos. Re-fetch vía getDosificacion para traer el row
      // enriquecido (mismas asociaciones que usa la carga desde catálogo).
      const savedId = response?.data?.id || response?.data?.idDosificacionDisenada || loadedDosif?.id;
      if (savedId) {
        try {
          const savedRow = await getDosificacion(savedId);
          if (savedRow) setLoadedDosif(savedRow);
        } catch (reloadErr) {
          console.warn("No se pudo recargar el diseño guardado:", reloadErr);
        }
      }
    } catch (e) {
      console.error("Error guardando:", e);
      const data = e.response?.data;
      const message = data?.message || data?.error || "No se pudo guardar el diseño.";
      setSaveStatus({ status: "error", message, details: Array.isArray(data?.details) ? data.details : [] });
      // K.3 — si el error es recuperable vía override (evidencia técnica faltante),
      // abrir el dialog para que el responsable técnico pueda liberar en el acto.
      if (data?.overridable && data?.mezclaId && loadedDosif?.id) {
        setOverrideDialog({
          visible: true,
          context: {
            idDosificacionDisenada: loadedDosif.id,
            idMezcla: data.mezclaId,
            mezclaNombre: data.mezclaNombre,
            motivoError: message,
          },
          retry: () => handleSave(notasCambio),
        });
      } else {
        showToast("error", message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [effectiveForma, effectiveTmn, form, resultado, showToast, trazabilidad, loadedDosif]);

  const openDraftPdfDialog = useCallback(() => {
    // P0.5 — Bloquear export si el resultado está obsoleto por correcciones no recalculadas
    if (loadedDosif?.resultadoStale) {
      showToast("error", "El resultado está obsoleto por correcciones aplicadas. Recalculá la dosificación antes de exportar.");
      return;
    }
    setPdfSource({ type: "draft" });
    setPdfDialogVisible(true);
  }, [loadedDosif, showToast]);

  const handleExportPdf = useCallback(async (pdfOpts = {}) => {
    setPdfDialogVisible(false);

    if (!activePdfSnapshot?.resultado) {
      showToast("warn", "No hay un resultado calculado para exportar a PDF.");
      return;
    }

    try {
      // Fetch aggregate characterization data for materials annex
      let materialesData = null;
      if (pdfOpts.includeAnexoMateriales) {
        const agItems = activePdfSnapshot?.trazabilidad?.agregadosDistribucion?.items || [];
        const ids = [...new Set(agItems.map(a => a.idAgregado).filter(Boolean))];
        if (ids.length > 0) {
          try {
            materialesData = await getCaracterizacionBulk(ids);
          } catch (err) {
            console.warn("No se pudo cargar caracterización de agregados para el anexo:", err);
          }
        }
      }

      // Fetch historial for PDF if requested
      let historialPdf = null;
      if (pdfOpts.includeHistorial && loadedDosif?.id) {
        try {
          historialPdf = await obtenerHistorial(loadedDosif.id);
        } catch (err) {
          console.warn("No se pudo cargar historial para el PDF:", err);
        }
      }

      // Fetch correcciones post-pastón (siempre que haya una dosificación
      // guardada; el PDF decide si las muestra o no). Fase 2A: el informe
      // trae la lista para la sección "Historial de modificaciones".
      let correccionesPdf = [];
      if (loadedDosif?.id) {
        try {
          const { listarCorrecciones } = await import("../../../services/dosificacionDisenoService");
          correccionesPdf = await listarCorrecciones(loadedDosif.id);
        } catch (err) {
          console.warn("No se pudo cargar correcciones para el PDF:", err);
        }
      }

      // Fetch pastones for Section K (verificación experimental)
      let pastonesPdf = null;
      if (loadedDosif?.id) {
        try {
          pastonesPdf = await listarPastones(loadedDosif.id);
          // Fase 2B: enriquecer cada pastón con sus mediciones seriadas.
          // El informe principal incluye tabla + gráfico de slump loss por pastón.
          if (Array.isArray(pastonesPdf) && pastonesPdf.length > 0) {
            const { listarMedicionesPaston } = await import("../../../services/dosificacionDisenoService");
            await Promise.all(pastonesPdf.map(async (p) => {
              try {
                p.mediciones = await listarMedicionesPaston(p.idPastonPrueba).catch(() => []);
              } catch { p.mediciones = []; }
            }));
          }
        } catch (err) {
          console.warn("No se pudo cargar pastones para el PDF:", err);
        }
      }

      // Fetch análisis de eficiencia por pastón (para secciones de prueba del PDF)
      let analisisEficienciaPdf = null;
      if (Array.isArray(pastonesPdf) && pastonesPdf.length > 0) {
        try {
          const { obtenerAnalisisEficiencia } = await import("../../../services/dosificacionDisenoService");
          // Usar el último pastón con veredicto, o el último en general
          const pastonAnalisis = pastonesPdf.find(p => p.veredicto === 'APROBADO') || pastonesPdf[pastonesPdf.length - 1];
          analisisEficienciaPdf = await obtenerAnalisisEficiencia(pastonAnalisis.idPastonPrueba);
        } catch (err) {
          console.warn("No se pudo cargar análisis de eficiencia:", err);
        }
      }

      // Fetch redosificaciones en obra para la sección trazable del PDF
      let redosificacionesPdf = null;
      if (loadedDosif?.id) {
        try {
          const { listarRedosificaciones } = await import("../../../services/dosificacionDisenoService");
          redosificacionesPdf = await listarRedosificaciones(loadedDosif.id);
        } catch (err) {
          console.warn("No se pudo cargar redosificaciones para el PDF:", err);
        }
      }

      // Predicción de comportamiento fresco: prioridad al valor in-memory del
      // cálculo actual; fallback a la última persistida si no hay.
      let prediccionFrescoPdf = activePdfSnapshot?.resultado?.prediccionFresco || null;
      if (!prediccionFrescoPdf && loadedDosif?.id) {
        try {
          const { obtenerPrediccionFresco } = await import("../../../services/dosificacionDisenoService");
          prediccionFrescoPdf = await obtenerPrediccionFresco(loadedDosif.id);
        } catch (err) {
          // 404 es esperado si nunca se guardó
          if (err?.response?.status !== 404) {
            console.warn("No se pudo cargar predicción fresca para el PDF:", err);
          }
        }
      }

      // Fetch aptitud data for the PDF.
      // Fuente de verdad: el FORM vigente. Si el usuario cambió destino
      // (expuestoDesgaste / aspecto / tipoArmadura / tipología) pero no guardó,
      // el PDF debe reflejar lo que está en pantalla, no el contexto persistido.
      // Por eso intentamos PRIMERO `byParams` con el form actual; sólo si falta
      // `mezclaId` caemos al fetch persistido (caso: dosificación antigua que
      // se consulta sin abrir el form).
      let aptitudData = null;
      const dosifId = loadedDosif?.id || loadedDosif?.idDosificacionDisenada;
      if (form.mezclaId) {
        try {
          const { verificarAptitudMaterialesByParams } = await import("../../../services/dosificacionDisenoService");
          aptitudData = await verificarAptitudMaterialesByParams({
            mezclaId: form.mezclaId,
            expuestoDesgaste: form.expuestoDesgaste || false,
            aspectoSuperficialImportante: form.aspectoSuperficialImportante || false,
            tipoArmadura: form.tipoArmadura || 'armado',
            claseExposicion: form.exposicion || null,
            fc: form.fce || null,
          });
        } catch (err) { console.warn("No se pudo calcular aptitud por params:", err); }
      }
      if (!aptitudData && dosifId) {
        try {
          const { verificarAptitudMateriales: fetchAptitud } = await import("../../../services/dosificacionDisenoService");
          aptitudData = await fetchAptitud(dosifId);
        } catch (err) { console.warn("No se pudo cargar aptitud persistida para el PDF:", err); }
      }

      await generarInformeDosificacionPdf({
        snapshot: {
          ...activePdfSnapshot,
          nombre: pdfOpts.titulo || activePdfSnapshot?.nombre,
          pastones: pastonesPdf || [],
          aptitudMateriales: aptitudData,
          redosificaciones: redosificacionesPdf || [],
          prediccionFresco: prediccionFrescoPdf || null,
          // K.4 — override CIRSOC §3.2.3.2 f) para estampar en el PDF
          overrideActivo: loadedDosif?.overrideActivo || null,
          // Fase 2A — historial de modificaciones (Sección P del PDF)
          correccionesPostPaston: correccionesPdf || [],
          numeroRondaPrueba: loadedDosif?.numeroRondaPrueba || 1,
          cementoKgM3Adoptado: loadedDosif?.cementoKgM3Adoptado || null,
          proporcionesAgregadosAdoptadasJson: loadedDosif?.proporcionesAgregadosAdoptadasJson || null,
          // Modo de reporte (filosofía prestacional vs. cumplimiento estricto).
          // Lo consume buildAssessment() en dosificacionInformePdf.js.
          reportMode: pdfOpts.reportMode || 'PRESTACIONAL',
        },
        empresa: cfg?.nombreEmpresa,
        planta: activePdfSnapshot?.plantaLabel,
        usuario: user ? `${user.name || ""} ${user.lastname || ""}`.trim() : null,
        logoUrl: cfg?.thumbnail,
        titulo: pdfOpts.titulo || null,
        // Derive legacy flags from secciones map (backward compat)
        includeAnexo: pdfOpts.secciones?.anexoTecnico ?? pdfOpts.includeAnexo ?? false,
        includeGlosario: pdfOpts.secciones?.glosario ?? pdfOpts.includeGlosario ?? true,
        includeFullTrace: pdfOpts.secciones?.anexoTecnico ?? pdfOpts.includeFullTrace ?? false,
        includeCostos: pdfOpts.secciones?.costos ?? pdfOpts.includeCostos ?? false,
        costosData: (pdfOpts.secciones?.costos || pdfOpts.includeCostos) ? pdfOpts.costosData || null : null,
        includeAnexoMateriales: pdfOpts.secciones?.anexoMateriales ?? pdfOpts.includeAnexoMateriales ?? false,
        materialesData,
        includeHistorial: pdfOpts.secciones?.historial ?? pdfOpts.includeHistorial ?? false,
        historialData: historialPdf,
        includeVolDiagram: pdfOpts.secciones?.volDiagram ?? pdfOpts.includeVolDiagram ?? true,
        includeSensibilidad: pdfOpts.secciones?.sensibilidad ?? pdfOpts.includeSensibilidad ?? false,
        secciones: pdfOpts.secciones || null,
        modoEvaluacion: pdfOpts.modoEvaluacion || 'PRESTACIONAL',
        // Análisis de eficiencia (sólo se envía si alguna sección de prueba está seleccionada)
        analisisEficiencia: (pdfOpts.secciones?.analisisEficiencia || pdfOpts.secciones?.balanceMateriales)
          ? analisisEficienciaPdf : null,
      });
      showToast("success", "PDF generado correctamente");
    } catch (error) {
      console.error("Error generando PDF:", error);
      const detalle = error?.response?.data?.error || error?.message || 'Error desconocido';
      showToast("error", `No se pudo generar el PDF del diseño: ${detalle}`);
    }
  }, [activePdfSnapshot, cfg, showToast, user, loadedDosif, form]);

  /* ═══ Reset form ═══ */
  const handleReset = useCallback(() => {
    setForm({ ...EMPTY_FORM });
    setResultado(null);
    setTrazabilidad(null);
    setWarnings([]);
    setCalcErrors([]);
    setHumedadAgregados({});
    setCalcStatus({ status: "idle", message: null, details: [] });
    setSaveStatus({ status: "idle", message: null, details: [] });
    setPdfSource(null);
    setPdfDialogVisible(false);
    setLoadedDosif(null);
    setProdResults(null);
  }, []);

  // Envía el diseño guardado directo a prueba (sin revisión externa). Misma
  // lógica que el botón del pie de página, extraída para reutilizarla desde el
  // placeholder del pastón: el usuario no necesita ir a Catálogos para esto.
  const handleEnviarAPrueba = useCallback(async () => {
    if (!loadedDosif?.id) return;
    try {
      const res = await transicionarConOverride(
        loadedDosif.id,
        { nuevoEstado: 'A_PRUEBA', usuario: user?.nombre },
        async () => {
          showToast.current?.show({ severity: 'success', summary: 'A prueba', detail: 'Diseño enviado a prueba directamente' });
          const row = await getDosificacion(loadedDosif.id);
          setLoadedDosif(row);
        },
      );
      if (res === null) return; // dialog de override abierto
    } catch (err) {
      showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo enviar a prueba' });
    }
  }, [loadedDosif, user, transicionarConOverride]);

  const currentPdfTitle = useMemo(() => {
    if (pdfSource?.type === "saved") {
      return pdfSource?.row?.nombre || "Diseño de dosificación";
    }
    return form.nombre?.trim() || "Diseño de dosificación — Borrador";
  }, [form.nombre, pdfSource]);

  /* ════════════════════════════════════════
     Render helpers
     ════════════════════════════════════════ */

  const FIELD_TOOLTIPS = {
    "f'ce (MPa)": "Resistencia característica especificada del hormigón a 28 días (CIRSOC 200-2024).",
    "Desvío S (MPa)": "Desviación estándar de la resistencia, estimada según registros de producción. A menor desvío, menor sobrediseño necesario.",
    "TMN (mm)": "Tamaño Máximo Nominal del agregado. Se obtiene de la mezcla granular seleccionada.",
    "Clase de exposición (CIRSOC 200:2024)": "Define requisitos de durabilidad (a/c máxima, cemento mínimo) según CIRSOC 200-2024 Tabla 2.5.",
    "Tipo de armadura": "Simple: sin armadura. Armado: con barras de acero. Pretensado: con cables tensados. Afecta límites de cloruros y durabilidad.",
    "Aire atrapado (%)": "Porcentaje de aire atrapado naturalmente en la mezcla. Si está en Auto, se calcula según el TMN.",
    "a/c máxima (pliego)": "Relación agua/cemento máxima exigida por pliego o cliente. El motor no superará este valor.",
    "Cemento mínimo (pliego, kg/m³)": "Contenido mínimo de cemento exigido por pliego o cliente.",
    "Curva a/c": "Curva de relación a/c vs resistencia. Referencia general: curva genérica por familia. Cemento: curva específica del fabricante.",
    "Edad de diseño (días)": "Edad a la cual se verifica la resistencia. 28 días es el estándar.",
    "Asentamiento (cm)": "Asentamiento objetivo medido con cono de Abrams (IRAM 1536).",
    "Mezcla granulométrica": "Mezcla de agregados optimizada que define el esqueleto granular del hormigón.",
  };

  const fieldLabel = (label, required) => (
    <small className="font-bold mb-1 flex align-items-center gap-1">
      {required && <small className="color-danger">* </small>}
      {label}
      {FIELD_TOOLTIPS[label] && (
        <i
          className="fa-solid fa-circle-question text-color-secondary cursor-help field-help-icon"
          style={{fontSize: '0.75rem'}}
          data-pr-tooltip={FIELD_TOOLTIPS[label]}
          data-pr-position="top"
        />
      )}
    </small>
  );

  const warningsSeverity = (w) => {
    if (w.tipo === "error") return "error";
    if (w.tipo === "advertencia") return "warn";
    return "info";
  };

  const statusSeverity = (status) => {
    if (status === "ok") return "success";
    if (status === "error") return "danger";
    return "info";
  };

  const statusLabel = (status) => {
    if (status === "ok") return "OK";
    if (status === "error") return "ERROR";
    return "PENDIENTE";
  };

  /* ════════════════════════════════════════
     RENDER
     ════════════════════════════════════════ */

  if (dataLoading) {
    return (
      <div className="flex align-items-center justify-content-center" style={{ minHeight: "300px" }}>
        <ProgressSpinner strokeWidth="3" />
      </div>
    );
  }

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-4">
        {/* Tooltip global para los íconos de ayuda (?) de los labels.
            Reemplaza el title nativo (lento, sin touch) por el de PrimeReact. */}
        <Tooltip target=".field-help-icon" showDelay={150} />
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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <PageHeader
            icon="fa-solid fa-calculator"
            title="Diseño de dosificación"
            subtitle="Motor de diseño HormiQual 1.0"
          />
          <Button
            label="Configurar"
            icon="fa-solid fa-wand-magic-sparkles"
            size="small"
            outlined
            severity="success"
            className="mant-wizard-btn"
            onClick={() => setSetupWizardVisible(true)}
            tooltip="Asistente paso a paso para entender el diseño de dosificación"
            tooltipOptions={{ position: "left" }}
          />
          {/* [DEBUG-DOSIF] Sólo admins y sólo si el backend habilita el flag. */}
          {user?.isAdmin && cfg?.allowDebugDosificacion && (
            <Button
              label="Dosif. de depuración"
              icon="fa-solid fa-flask-vial"
              size="small"
              outlined
              severity="warning"
              onClick={() => setDebugDosifVisible(true)}
              tooltip="Crear una dosificación arbitraria (p. ej. sólo agua) para probar el envío a planta Betonmatic"
              tooltipOptions={{ position: "left" }}
            />
          )}
        </div>

        <WizardDosificacion
          visible={setupWizardVisible}
          onClose={() => setSetupWizardVisible(false)}
          onFinish={() => setSetupWizardVisible(false)}
        />

        {/* [DEBUG-DOSIF] Diálogo de dosificación de depuración (herramienta temporal). */}
        {user?.isAdmin && cfg?.allowDebugDosificacion && (
          <DebugDosificacionDialog
            visible={debugDosifVisible}
            onHide={() => setDebugDosifVisible(false)}
            onCreated={() => {
              showToast("info", "Dosificación de depuración guardada en Borrador. Buscala en el listado para promoverla y enviarla a planta.");
            }}
          />
        )}

        {/* PR13 — Banner "Resultado obsoleto" cuando hay correcciones aplicadas
            que invalidan el cálculo cacheado. Hasta que el usuario recalcule,
            el PDF queda bloqueado. Aparece solo si la dosif está en estado
            editable; en estados firmados (EN_PRODUCCION, etc.) el flag se
            limpia al recalcular en una nueva versión. */}
        {loadedDosif?.resultadoStale && (
          <Message
            severity="warn"
            className="w-full mt-3"
            content={(
              <div className="flex align-items-center justify-content-between w-full gap-3 flex-wrap">
                <div>
                  <strong><i className="fa-solid fa-triangle-exclamation mr-2" />Resultado obsoleto.</strong>
                  {' '}
                  Se aplicaron correcciones a la dosificación. El cálculo y los PDFs cacheados ya no reflejan los valores actuales — recalculá para sincronizar antes de exportar o cambiar de estado.
                </div>
                <Button
                  label="Recalcular ahora"
                  icon="fa-solid fa-arrows-rotate"
                  size="small"
                  severity="warning"
                  onClick={() => {
                    showToast('info', 'Volvé a presionar "Calcular" para regenerar el resultado con los datos actuales.');
                  }}
                />
              </div>
            )}
          />
        )}

        {/* ── Estado & versión banner ── */}
        {loadedDosif && (
          <div className="form-card br-15 p-3 mt-3 flex align-items-center gap-3 flex-wrap" style={{
            borderLeft: `4px solid ${
              ({ APROBADO: '#27ae60', A_PRUEBA: '#f39c12', PENDIENTE_REVISION: '#e67e22', SUSPENDIDO: '#e74c3c', ARCHIVADO: '#7f8c8d' })[loadedEstado] || '#95a5a6'
            }`
          }}>
            <div className="flex align-items-center gap-2">
              <Tag
                value={
                  ({ BORRADOR: 'Borrador', A_PRUEBA: 'A prueba', PENDIENTE_REVISION: 'Pendiente de revisión', APROBADO: 'Aprobado', SUSPENDIDO: 'Suspendido', ARCHIVADO: 'Archivado' })[loadedEstado] || loadedEstado
                }
                severity={
                  ({ APROBADO: 'success', SUSPENDIDO: 'danger', ARCHIVADO: 'secondary', A_PRUEBA: 'warning', PENDIENTE_REVISION: 'warning' })[loadedEstado] || 'info'
                }
              />
              <Tag value={`v${loadedDosif.version || 1}`} severity="secondary" />
              {loadedDosif.codigo && (
                <Tag value={loadedDosif.codigo} severity="secondary" className="font-mono" />
              )}
            </div>

            <span className="font-semibold">{loadedDosif.nombre || '—'}</span>

            {loadedDosif.aprobadoPor && (
              <span className="text-color-secondary text-sm">
                Aprobado por: {loadedDosif.aprobadoPor}
                {loadedDosif.fechaAprobacion && ` — ${new Date(loadedDosif.fechaAprobacion).toLocaleDateString('es-AR')}`}
              </span>
            )}
            {loadedDosif.enviadoRevisionPor && loadedEstado === 'PENDIENTE_REVISION' && (
              <span className="text-color-secondary text-sm">
                Enviado por: {loadedDosif.enviadoRevisionPor}
                {loadedDosif.fechaEnvioRevision && ` — ${new Date(loadedDosif.fechaEnvioRevision).toLocaleDateString('es-AR')}`}
              </span>
            )}
            {loadedDosif.motivoSuspension && loadedEstado === 'SUSPENDIDO' && (
              <span className="text-color-secondary text-sm">
                Motivo: {loadedDosif.motivoSuspension}
              </span>
            )}

            {loadedDosif.hashIntegridad && (
              <span className="text-color-secondary text-sm font-mono" title={`Hash completo: ${loadedDosif.hashIntegridad}`}>
                <i className="fa-solid fa-fingerprint mr-1" />{loadedDosif.hashIntegridad.substring(0, 12)}
              </span>
            )}

            {/* Banner action buttons */}
            <div className="flex gap-2 ml-auto">
              <Button
                label="Historial"
                icon="fa-solid fa-clock-rotate-left"
                size="small"
                className="p-button-outlined p-button-secondary"
                onClick={handleVerHistorial}
              />
              {(loadedEstado === 'APROBADO' || loadedEstado === 'SUSPENDIDO') && (
                <Button
                  label="Crear nueva versión"
                  icon="fa-solid fa-code-branch"
                  size="small"
                  className="p-button-outlined"
                  onClick={async () => {
                    if (accionRef.current) return;
                    accionRef.current = true;
                    try {
                      const newRow = await crearNuevaVersion(loadedDosif.id);
                      showToast.current?.show({ severity: 'success', summary: 'Nueva versión', detail: `v${newRow.version} creada como borrador` });
                      window.location.href = `/calidad/dosificacion-diseno?load=${newRow.id}`;
                    } catch (err) {
                      const msg = err.response?.data?.error || 'No se pudo crear la nueva versión';
                      showToast.current?.show({ severity: 'error', summary: 'Error', detail: msg });
                    } finally {
                      accionRef.current = false;
                    }
                  }}
                />
              )}
              {(['APROBADO', 'SUSPENDIDO', 'ARCHIVADO'].includes(loadedEstado)) && (
                <Button
                  label="Verificar integridad"
                  icon="fa-solid fa-shield-check"
                  size="small"
                  className="p-button-outlined p-button-secondary"
                  onClick={async () => {
                    try {
                      const { verificarIntegridad } = await import("../../../services/dosificacionDisenoService");
                      const result = await verificarIntegridad(loadedDosif.id);
                      if (result.ok) {
                        showToast.current?.show({ severity: 'success', summary: 'Integridad OK', detail: `Hash verificado: ${result.hashCortoRecalculado}`, life: 5000 });
                      } else {
                        showToast.current?.show({ severity: 'error', summary: 'Integridad comprometida', detail: result.reason || `Hash almacenado: ${result.hashCortoAlmacenado}, recalculado: ${result.hashCortoRecalculado}`, life: 8000 });
                      }
                    } catch (err) {
                      showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo verificar' });
                    }
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Estado de publicación Betonmatic (Fase 2C) ──
            El widget se auto-oculta si la planta no opera con Betonmatic
            (lo resuelve internamente vía el endpoint estado-publicacion). */}
        {loadedDosif?.id && (
          <BetonmaticPublicacionWidget
            dosificacion={loadedDosif}
            toastRef={showToast}
          />
        )}

        {isReadOnly && !viewMode && loadedDosif && (
          <Message
            severity={isAPrueba ? "warn" : "info"}
            className="w-full mt-2 mb-0"
            text={isAPrueba
              ? "Estado A PRUEBA — el diseño está bloqueado. Para modificarlo, use \"Requiere corrección\" para volver a borrador."
              : `Este diseño está ${
                ({ PENDIENTE_REVISION: 'pendiente de revisión', APROBADO: 'aprobado', EN_PRODUCCION: 'en producción', SUSPENDIDO: 'suspendido', ARCHIVADO: 'archivado', DESCARTADO: 'descartado' })[loadedEstado] || loadedEstado.toLowerCase()
              } y no puede editarse directamente.`
            }
          />
        )}
        {viewMode && isEditable && (
          <div className="flex align-items-center gap-2 mt-2 mb-0 p-2 border-round" style={{background: 'var(--surface-100)'}}>
            <i className="fa-solid fa-eye text-primary" />
            <span className="text-sm text-color-secondary">Modo visualización</span>
            <Button
              label="Editar"
              icon="fa-solid fa-pen-to-square"
              size="small"
              className="ml-auto"
              onClick={() => setViewMode(false)}
            />
          </div>
        )}

        {/* ── Banner de divergencia de mezcla ── */}
        {loadedDosif?._mezclaDivergencia && (
          <div className="mt-2 mb-0 p-3 border-round" style={{backgroundColor: 'rgba(220, 38, 38, 0.1)', borderLeft: '4px solid #dc2626'}}>
            <div className="flex align-items-center gap-2 mb-1">
              <i className="fa-solid fa-shield-halved text-red-500" style={{fontSize: '1.1rem'}} />
              <strong className="text-red-500">Mezcla modificada desde el diseño</strong>
            </div>
            <div className="text-sm">
              La mezcla de agregados fue modificada después de que esta dosificación salió de borrador.
              Los datos del diseño corresponden al snapshot capturado al momento de enviar a prueba.
            </div>
            <div className="mt-1 text-sm text-color-secondary">
              {loadedDosif._mezclaDivergencia.map((d, i) => (
                <div key={i}>• {d}</div>
              ))}
            </div>
          </div>
        )}

        {/* ── Banner de alertas de materiales ── */}
        {alertasMaterial.length > 0 && (
          <div className="mt-2 mb-0 p-3 border-round" style={{backgroundColor: 'rgba(245, 158, 11, 0.1)', borderLeft: '4px solid #f59e0b'}}>
            <div className="flex align-items-center gap-2 mb-2">
              <i className="fa-solid fa-triangle-exclamation text-yellow-500" style={{fontSize: '1.2rem'}} />
              <strong className="text-yellow-600">Alertas de materiales ({alertasMaterial.length})</strong>
            </div>
            {alertasMaterial.map((al, i) => (
              <div key={al.id || i} className="flex align-items-start gap-2 mb-2 text-sm">
                <Tag value={al.nivel} severity={al.nivel === 'critico' ? 'danger' : al.nivel === 'alto' ? 'warning' : 'info'} style={{fontSize: '0.7rem'}} />
                <div className="flex-1">
                  <strong>{al.nombreMaterial || 'Material'}</strong>: {al.mensaje}
                  <small className="block text-color-secondary mt-1">{al.nombreEnsayo} — {al.createdAt ? new Date(al.createdAt).toLocaleDateString('es-AR') : ''}</small>
                </div>
                <div className="flex gap-1">
                  {al.requiereRecalculo && <Button icon="fa-solid fa-calculator" tooltip="Recalcular" tooltipOptions={{position:'top'}} rounded text size="small" severity="warning" onClick={() => { showToast('info', 'Recalcule la dosificación para actualizar los valores.'); }} />}
                  <Button icon="fa-solid fa-check" tooltip="Resolver" tooltipOptions={{position:'top'}} rounded text size="small" severity="success" onClick={async () => {
                    try {
                      await resolverAlertaDosificacion(al.id, { estado: 'RESUELTA' });
                      setAlertasMaterial(prev => prev.filter(a => a.id !== al.id));
                      showToast('success', 'Alerta resuelta');
                    } catch { showToast('error', 'Error al resolver alerta'); }
                  }} />
                  <Button icon="fa-solid fa-eye-slash" tooltip="Ignorar" tooltipOptions={{position:'top'}} rounded text size="small" severity="secondary" onClick={async () => {
                    try {
                      await resolverAlertaDosificacion(al.id, { estado: 'IGNORADA' });
                      setAlertasMaterial(prev => prev.filter(a => a.id !== al.id));
                    } catch {}
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════════════════════
            TAB BAR — Vista por fase
           ═══════════════════════════════════ */}
        {showTabs && (
          <div className="mt-3" style={{
            display: 'flex', gap: '4px', borderBottom: '2px solid var(--surface-300)', paddingBottom: 0,
          }}>
            {tabItems.map((tab, idx) => {
              const isActive = idx === activeTabIndex;
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => tab.command()}
                  style={{
                    background: isActive ? 'var(--primary-color)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-color-secondary)',
                    border: 'none',
                    borderBottom: isActive ? '3px solid var(--primary-color)' : '3px solid transparent',
                    borderRadius: '6px 6px 0 0',
                    padding: '10px 20px',
                    fontSize: 14,
                    fontWeight: isActive ? 700 : 500,
                    cursor: 'pointer',
                    marginBottom: '-2px',
                    transition: 'all 0.15s ease',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--surface-100)'; e.currentTarget.style.color = 'var(--text-color)'; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-color-secondary)'; } }}
                >
                  <i className={tab.icon} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ═══════════════════════════════════
            TAB: Resumen — card compacta con datos clave del diseño
           ═══════════════════════════════════ */}
        {showTabs && activeTab === 'resumen' && resultado && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            <h3 className="mt-0 mb-3">
              <i className="fa-solid fa-clipboard-list mr-2 text-primary" />
              Resumen del diseño
            </h3>

            {/* KPIs principales */}
            <div className="grid mb-3">
              {resultado.fcm != null && (
                <div className="col-6 md:col-4 lg:col-2">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-xs text-color-secondary">f'cm</div>
                    <div className="text-2xl font-bold text-orange-500">{resultado.fcm}</div>
                    <div className="text-xs text-color-secondary">MPa</div>
                  </div>
                </div>
              )}
              {/* Resistencia estimada (HRDC): inversa a/c → f'c desde la curva del cemento */}
              {resultado.resistenciaEstimada?.resistenciaMpa != null && (
                <div className="col-6 md:col-4 lg:col-2">
                  <div
                    className="surface-ground border-round p-3 text-center"
                    title={`Curva: ${resultado.resistenciaEstimada.curvaNombre || '—'}\nMétodo: ${resultado.resistenciaEstimada.metodo || '—'}${resultado.resistenciaEstimada.warning ? `\n${resultado.resistenciaEstimada.warning}` : ''}`}
                  >
                    <div className="text-xs text-color-secondary">
                      f'c estimada ({resultado.resistenciaEstimada.edadDias || 28} d)
                      {resultado.resistenciaEstimada.extrapolacion && (
                        <i className="fa-solid fa-triangle-exclamation text-orange-400 ml-1" title="Extrapolación fuera de rango" />
                      )}
                    </div>
                    <div className="text-2xl font-bold text-primary">{resultado.resistenciaEstimada.resistenciaMpa}</div>
                    <div className="text-xs text-color-secondary">MPa</div>
                  </div>
                </div>
              )}
              <div className="col-6 md:col-4 lg:col-2">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-xs text-color-secondary">a/c</div>
                  <div className="text-2xl font-bold text-primary">{resultado.ac != null ? Number(resultado.ac).toFixed(2) : '—'}</div>
                </div>
              </div>
              <div className="col-6 md:col-4 lg:col-2">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-xs text-color-secondary">Agua</div>
                  <div className="text-2xl font-bold text-primary">{resultado.aguaLtsM3}</div>
                  <div className="text-xs text-color-secondary">L/m³</div>
                </div>
              </div>
              <div className="col-6 md:col-4 lg:col-2">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-xs text-color-secondary">Cemento</div>
                  <div className="text-2xl font-bold text-primary">{resultado.cementoTotalKgM3}</div>
                  <div className="text-xs text-color-secondary">kg/m³</div>
                </div>
              </div>
              <div className="col-6 md:col-4 lg:col-2">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-xs text-color-secondary">Aire</div>
                  <div className="text-2xl font-bold text-primary">{resultado.airePct != null ? Number(resultado.airePct).toFixed(1) : '—'}%</div>
                </div>
              </div>
              {resultado.puvKgM3 != null && (
                <div className="col-6 md:col-4 lg:col-2">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-xs text-color-secondary">PUV</div>
                    <div className="text-2xl font-bold text-primary">{Number(resultado.puvKgM3).toFixed(0)}</div>
                    <div className="text-xs text-color-secondary">kg/m³</div>
                  </div>
                </div>
              )}
            </div>

            {/* Tabla de componentes */}
            <DataTable responsiveLayout="scroll"
              value={buildResultRows(resultado)}
              size="small"
              stripedRows
              className="text-sm"
            >
              <Column field="componente" header="Componente" />
              <Column field="cantidad" header="Cantidad" style={{ width: "120px" }} />
              <Column field="unidad" header="Unidad" style={{ width: "100px" }} />
            </DataTable>

            {/* Info contextual */}
            <div className="flex flex-wrap gap-4 mt-3 text-sm text-color-secondary">
              {loadedDosif?.nombre && <span><strong>Nombre:</strong> {loadedDosif.nombre}</span>}
              {form.tipologiaCodigo && <span><strong>Tipología:</strong> {form.tipologiaCodigo}</span>}
              {form.fce && <span><strong>f'ce:</strong> {form.fce} MPa</span>}
              {resultado.volumenPasta != null && <span><strong>V. pasta:</strong> {(resultado.volumenPasta * 1000).toFixed(0)} L/m³</span>}
            </div>

            {/* Botones de acción rápida */}
            <div className="flex gap-2 mt-3">
              <Button
                label="Exportar PDF"
                icon="fa-solid fa-file-pdf"
                onClick={openDraftPdfDialog}
                className="p-button-outlined p-button-secondary"
                size="small"
              />
              <Button
                label="Ver trazabilidad"
                icon="pi pi-eye"
                className="p-button-text p-button-sm"
                onClick={() => setTraceVisible(true)}
              />
            </div>
          </div>
        )}
        {showTabs && activeTab === 'resumen' && !resultado && (
          <Message severity="info" className="w-full mt-3" text="Este diseño aún no tiene un resultado calculado." />
        )}

        {/* ═══════════════════════════════════
            PANEL: Ajuste manual de cemento (sesión 2026-06-11)
            Aparece después de calcular, antes de guardar — visible en
            CUALQUIER tab donde haya un resultado para que el tecnólogo
            no tenga que cazar la pantalla de Resumen. Permite adoptar un
            valor distinto al calculado (ej. redondeo a múltiplo de 5 kg)
            y redistribuir el delta volumétrico entre los agregados
            manteniendo sus proporciones. Si el ajuste supera ±3% del valor
            calculado, se muestra alerta no bloqueante.
           ═══════════════════════════════════ */}
        {resultado && resultadoOriginal && !isReadOnly && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            <h3 className="mt-0 mb-1">
              <i className="fa-solid fa-sliders mr-2 text-primary" />
              Ajuste manual de cemento
              {resultado?.ajusteCemento?.aplicado && (
                <Tag value="Ajuste aplicado" severity="info" className="ml-2" />
              )}
            </h3>
            <p className="text-color-secondary text-sm mt-0 mb-3">
              El motor calculó <strong>{Number(resultadoOriginal.cementoKgM3).toFixed(1)} kg/m³</strong>. Si necesitás adoptar otro valor (redondeo, decisión del cliente, etc.), modificalo acá: el sistema redistribuye el volumen entre los agregados manteniendo sus proporciones de la mezcla.
            </p>

            <div className="grid">
              <div className="col-12 md:col-3 flex flex-column">
                <label className="text-sm mb-1">Cemento calculado</label>
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-2xl font-bold">{Number(resultadoOriginal.cementoKgM3).toFixed(1)}</div>
                  <div className="text-xs text-color-secondary">kg/m³</div>
                </div>
              </div>
              <div className="col-12 md:col-3 flex flex-column">
                <label className="text-sm mb-1">Cemento adoptado *</label>
                <InputNumber
                  value={ajusteCementoForm.cementoAdoptadoKgM3}
                  onValueChange={(e) => setAjusteCementoForm((s) => ({ ...s, cementoAdoptadoKgM3: e.value }))}
                  min={1} max={1000}
                  step={1}
                  minFractionDigits={0} maxFractionDigits={1}
                  showButtons buttonLayout="horizontal"
                  decrementButtonClassName="p-button-secondary"
                  incrementButtonClassName="p-button-secondary"
                  suffix=" kg/m³"
                  className="w-full"
                  inputClassName="w-full text-center"
                />
              </div>
              <div className="col-12 md:col-3 flex flex-column">
                <label className="text-sm mb-1">Delta</label>
                {previewAjusteCemento && !previewAjusteCemento.sinCambios && previewAjusteCemento.ajusteJson ? (
                  <div
                    className="border-round p-3 text-center"
                    style={{
                      background: Math.abs(previewAjusteCemento.ajusteJson.deltaPct) < 1 ? 'rgba(40,130,60,0.12)'
                        : Math.abs(previewAjusteCemento.ajusteJson.deltaPct) < 3 ? 'rgba(180,130,20,0.14)'
                        : 'rgba(230,100,0,0.18)',
                      color: Math.abs(previewAjusteCemento.ajusteJson.deltaPct) < 1 ? '#1e7a36'
                        : Math.abs(previewAjusteCemento.ajusteJson.deltaPct) < 3 ? '#8a6210'
                        : '#a85000',
                    }}
                  >
                    <div className="text-2xl font-bold">{previewAjusteCemento.ajusteJson.deltaKg >= 0 ? '+' : ''}{previewAjusteCemento.ajusteJson.deltaKg} kg</div>
                    <div className="text-xs">{previewAjusteCemento.ajusteJson.deltaPct >= 0 ? '+' : ''}{previewAjusteCemento.ajusteJson.deltaPct}%</div>
                  </div>
                ) : (
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-2xl font-bold text-color-secondary">—</div>
                    <div className="text-xs text-color-secondary">sin cambios</div>
                  </div>
                )}
              </div>
              <div className="col-12 md:col-3 flex flex-column">
                <label className="text-sm mb-1">a/c efectivo</label>
                {previewAjusteCemento?.ajusteJson?.acEfectivo != null ? (
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-2xl font-bold">{previewAjusteCemento.ajusteJson.acEfectivo.toFixed(3)}</div>
                    <div className="text-xs text-color-secondary">
                      original {previewAjusteCemento.ajusteJson.acOriginal?.toFixed(3) || '—'}
                    </div>
                  </div>
                ) : (
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-2xl font-bold text-color-secondary">—</div>
                  </div>
                )}
              </div>
            </div>

            {/* Motivo del ajuste — siempre visible para guiar al usuario; queda
                inerte si no hay cambio en el valor del cemento adoptado. */}
            <div className="grid mt-2">
              <div className="col-12 md:col-6 flex flex-column">
                <label className="text-sm mb-1">
                  Motivo del ajuste {previewAjusteCemento && !previewAjusteCemento.sinCambios && <span className="text-red-500">*</span>}
                </label>
                <Dropdown
                  value={ajusteCementoForm.motivo}
                  options={MOTIVOS_DROPDOWN_OPTIONS}
                  onChange={(e) => setAjusteCementoForm((s) => ({ ...s, motivo: e.value }))}
                  placeholder="Seleccionar motivo"
                  className="w-full"
                  disabled={!previewAjusteCemento || previewAjusteCemento.sinCambios}
                  showClear
                />
                {ajusteCementoForm.motivo && MOTIVOS_AJUSTE_CEMENTO[ajusteCementoForm.motivo] && (
                  <small className="text-color-secondary mt-1">
                    {MOTIVOS_AJUSTE_CEMENTO[ajusteCementoForm.motivo].descripcion}
                  </small>
                )}
              </div>
              {ajusteCementoForm.motivo === 'OTRO' && (
                <div className="col-12 md:col-6 flex flex-column">
                  <label className="text-sm mb-1">Detalle del motivo <span className="text-red-500">*</span> <small className="text-color-secondary">(mín. 10 caracteres)</small></label>
                  <InputText
                    value={ajusteCementoForm.motivoOtro}
                    onChange={(e) => setAjusteCementoForm((s) => ({ ...s, motivoOtro: e.target.value }))}
                    placeholder="Describir el motivo del ajuste"
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {/* Mensaje guía cuando no hay cambio: explicita qué hacer. */}
            {(!previewAjusteCemento || previewAjusteCemento.sinCambios) && (
              <Message
                severity="info"
                className="w-full mt-3"
                text="Modificá el valor de 'Cemento adoptado' (con los botones +/- o tipeando el valor) para activar el ajuste. El sistema redistribuye automáticamente el delta entre los agregados manteniendo sus proporciones."
              />
            )}

            {/* Warnings del engine (Δ ≥ 3%) */}
            {previewAjusteCemento?.warnings?.length > 0 && (
              <Message
                severity="warn"
                className="w-full mt-3"
                text={previewAjusteCemento.warnings[0].mensaje}
              />
            )}

            {/* Errores de validación al intentar aplicar */}
            {ajusteCementoErrors.length > 0 && (
              <Message
                severity="error"
                className="w-full mt-2"
                text={ajusteCementoErrors[0].mensaje}
              />
            )}

            {/* Preview de agregados redistribuidos */}
            {previewAjusteCemento && !previewAjusteCemento.sinCambios && previewAjusteCemento.resultadoAjustado?.agregados && (
              <div className="mt-3">
                <div className="text-sm font-bold mb-2">Agregados redistribuidos (volumen conservado):</div>
                <div className="grid">
                  {previewAjusteCemento.resultadoAjustado.agregados.map((ag, i) => {
                    const original = resultadoOriginal.agregados[i];
                    const deltaKg = ag.kgM3 - (original?.kgM3 ?? 0);
                    return (
                      <div key={i} className="col-12 md:col-6 lg:col-4">
                        <div className="surface-ground border-round p-2 text-sm">
                          <div className="font-bold">{ag.nombre}</div>
                          <div className="flex justify-content-between text-color-secondary">
                            <span>{original?.kgM3 ?? '—'} → {ag.kgM3} kg/m³</span>
                            <span style={{ color: Math.abs(deltaKg) < 1 ? '#888' : deltaKg > 0 ? '#1e7a36' : '#a85000' }}>
                              {deltaKg >= 0 ? '+' : ''}{deltaKg} kg
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Botonera */}
            <div className="flex gap-2 mt-3 flex-wrap">
              <Button
                label="Aplicar ajuste"
                icon="fa-solid fa-check"
                onClick={aplicarAjusteAlResultado}
                disabled={
                  !previewAjusteCemento
                  || previewAjusteCemento.sinCambios
                  || !ajusteCementoForm.motivo
                  || (ajusteCementoForm.motivo === 'OTRO' && (ajusteCementoForm.motivoOtro || '').trim().length < 10)
                }
                size="small"
              />
              {resultado?.ajusteCemento?.aplicado && (
                <Button
                  label="Revertir ajuste"
                  icon="fa-solid fa-rotate-left"
                  onClick={revertirAjusteCemento}
                  className="p-button-outlined p-button-secondary"
                  size="small"
                />
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════
            SECTION 1 — Datos generales
            (visible en BORRADOR siempre, o en tab 'diseno')
           ═══════════════════════════════════ */}
        {(!showTabs || activeTab === 'diseno') && (
        <>
        <fieldset disabled={isReadOnly} style={{ border: 'none', padding: 0, margin: 0, opacity: isReadOnly ? 0.75 : 1 }}>
        <div className="form-card br-15 p-3 sm:p-4 mt-3">
          <h3 className="mt-0 mb-3">
            <i className="fa-solid fa-circle-info mr-2 text-primary" />
            Datos generales
          </h3>
          <div className="grid">
            <div className="col-12 sm:col-6 md:col-3">
              {fieldLabel("Motor de diseño")}
              <div className="p-inputtext p-component flex align-items-center gap-2" style={{ background: 'var(--surface-100)', cursor: 'default' }}>
                <i className="fa-solid fa-microchip text-primary" />
                <strong>HormiQual 1.0</strong>
              </div>
            </div>
            {tipologiaOptions.length > 0 && (
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("Tipología de hormigón")}
                <Dropdown
                  value={form.tipologiaCodigo}
                  options={tipologiaOptions}
                  onChange={(e) => {
                    setField("tipologiaCodigo", e.value);
                    const tip = (e.value || "").toLowerCase().replace(/[_\-\s]+/g, '');
                    // Smart defaults bidireccionales: la tipología pre-configura
                    // los checkboxes según el destino típico. El usuario siempre
                    // puede desmarcarlos después si su caso lo justifica.
                    // Pattern matching robusto: el código puede ser "pavimento",
                    // "pavimento_rigido", "PAVIMENTO", etc.
                    const impliesDesgaste = /pavimento|rcc/.test(tip);
                    const impliesAspecto = /hac|autocompact|arquitect/.test(tip);
                    const esHrdcSelect = tip === 'hrdc';
                    setField("expuestoDesgaste", esHrdcSelect ? false : impliesDesgaste);
                    setField("aspectoSuperficialImportante", esHrdcSelect ? false : impliesAspecto);
                    if (impliesDesgaste) setField("tipoArmadura", "simple");
                    if (esHrdcSelect) {
                      setField("tipoArmadura", "simple");
                      setField("exposicion", null);
                      setField("requiereHormigonParticular", false);
                      setField("tipoHormigonParticular", null);
                      setField("claseHormigonParticular", null);
                      // La autoselección del espumígeno se hace desde el
                      // useEffect que escucha esHRDC + espumigenoSugerido,
                      // así también cubre el caso de carrera si los aditivos
                      // todavía no se cargaron en el momento del click.
                      // Si ya sabemos que el catálogo está vacío, avisamos.
                      if (espumigenosCatalogo.length === 0 && aditivos.length > 0) {
                        showToast(
                          'warn',
                          'No hay aditivos con tipo Espumígeno en el catálogo. HRDC requiere uno: cargá un espumígeno en Calidad → Catálogos → Materiales → Aditivos para poder diseñar.'
                        );
                      }
                    }
                  }}
                  placeholder="Seleccionar tipología"
                  className="w-full"
                  disabled={isReadOnly}
                />
              </div>
            )}
            {/* Sesión 2026-05-29 — Campos específicos del Hormigón Alivianado.
                Modelo análogo a HRDC: cemento (CUC) directo + consistencia
                gobierna el agua. f'c es opcional (verificación orientativa).
                Fuera de CIRSOC 200 (modelo no normativo). */}
            {esAlivianado && (
              <>
                <div className="col-12 sm:col-6 md:col-3">
                  {fieldLabel("Cemento (kg/m³) — Alivianado", true)}
                  <InputNumber
                    value={form.cementoKgM3}
                    onValueChange={(e) => setField("cementoKgM3", e.value)}
                    min={100}
                    max={450}
                    minFractionDigits={0}
                    suffix=" kg/m³"
                    placeholder="Ej: 300"
                    className="w-full"
                    disabled={isReadOnly}
                  />
                  <small className="block text-color-secondary mt-1">
                    Input directo. No se deriva de f'ce. Típico 200-400 kg/m³.
                  </small>
                </div>
                <div className="col-12 sm:col-6 md:col-3">
                  {fieldLabel("Material liviano", true)}
                  <Dropdown
                    value={form.idMaterialLiviano}
                    options={materialesLivianos.map((m) => ({
                      label: `${m.nombre}${m.densidad ? ` — ${m.densidad} kg/m³` : ''}`,
                      value: m.id ?? m.idMaterial,
                    }))}
                    onChange={(e) => setField("idMaterialLiviano", e.value)}
                    placeholder={materialesLivianos.length === 0
                      ? "Sin materiales livianos cargados — cargar uno desde Catálogos → Materiales livianos"
                      : "Seleccionar material liviano"}
                    disabled={isReadOnly || materialesLivianos.length === 0}
                    showClear
                    className="w-full"
                  />
                </div>
                <div className="col-12 sm:col-6 md:col-3">
                  {fieldLabel("Dosis de perlas (L/m³)", true)}
                  <InputNumber
                    value={form.dosisPerlasLM3}
                    onValueChange={(e) => setField("dosisPerlasLM3", e.value)}
                    min={50}
                    max={400}
                    step={10}
                    suffix=" L/m³"
                    disabled={isReadOnly}
                    className="w-full"
                  />
                  <small className="text-color-secondary">
                    Carga MANUAL en planta. Típico: 240 L/m³.
                  </small>
                </div>
              </>
            )}
            {esHRDC && (
              <>
                <div className="col-12 sm:col-6 md:col-3">
                  {fieldLabel("Cemento (kg/m³) — HRDC", true)}
                  <InputNumber
                    value={form.cementoKgM3}
                    onValueChange={(e) => setField("cementoKgM3", e.value)}
                    min={50}
                    max={400}
                    minFractionDigits={0}
                    suffix=" kg/m³"
                    placeholder="Ej: 150"
                    className="w-full"
                    disabled={isReadOnly}
                  />
                  {form.cementoKgM3 > 0 && (
                    <small className="block text-color-secondary mt-1">
                      Identificación: <strong>HRDC-{Math.round(form.cementoKgM3 / 10) * 10}</strong>
                    </small>
                  )}
                </div>
                <div className="col-12 sm:col-6 md:col-3">
                  {fieldLabel("Densidad objetivo (kg/m³) — opcional")}
                  <InputNumber
                    value={form.densidadObjetivoKgM3}
                    onValueChange={(e) => setField("densidadObjetivoKgM3", e.value)}
                    min={400}
                    max={2200}
                    minFractionDigits={0}
                    suffix=" kg/m³"
                    placeholder="Ej: 1200"
                    className="w-full"
                    disabled={isReadOnly}
                  />
                </div>
                {hrdcBloqueoEspumigeno && (
                  <div className="col-12">
                    <Message
                      severity={espumigenosCatalogo.length === 0 ? "error" : "warn"}
                      text={espumigenosCatalogo.length === 0
                        ? "No hay aditivos con tipo Espumígeno en el catálogo. HRDC no se puede diseñar sin un espumígeno: cargue uno en Calidad → Catálogos → Materiales → Aditivos antes de continuar."
                        : "HRDC requiere un aditivo espumígeno cargado en algún slot. Seleccione uno con tipo funcional ESPUMIGENO antes de calcular."}
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
            {!esHRDC && (
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("Tipo de armadura")}
                <Dropdown
                  value={form.tipoArmadura}
                  options={[
                    { label: "Simple", value: "simple" },
                    { label: "Armado", value: "armado" },
                    { label: "Pretensado", value: "pretensado" },
                  ]}
                  onChange={(e) => setField("tipoArmadura", e.value)}
                  className="w-full"
                  disabled={isReadOnly}
                />
              </div>
            )}
            {!esHRDC && (
              <div className="col-12 md:col-3 flex flex-column justify-content-end gap-2">
                <div className="flex align-items-center gap-2">
                  <Checkbox
                    inputId="desgaste"
                    checked={form.expuestoDesgaste}
                    onChange={(e) => setField("expuestoDesgaste", e.checked)}
                    disabled={isReadOnly}
                  />
                  <label htmlFor="desgaste" className="text-sm">Expuesto a desgaste</label>
                </div>
                <div className="flex align-items-center gap-2">
                  <Checkbox
                    inputId="aspecto"
                    checked={form.aspectoSuperficialImportante}
                    onChange={(e) => setField("aspectoSuperficialImportante", e.checked)}
                    disabled={isReadOnly}
                  />
                  <label htmlFor="aspecto" className="text-sm">Aspecto superficial importante</label>
                </div>
              </div>
            )}

            {/* CIRSOC 200-2024 Tabla 9.3 — Hormigones con características particulares */}
            {!esHRDC && (
              <div className="col-12 flex align-items-center gap-2 mt-1">
                <Checkbox
                  inputId="hpReq"
                  checked={!!form.requiereHormigonParticular}
                  onChange={(e) => {
                    setField("requiereHormigonParticular", e.checked);
                    if (!e.checked) {
                      setField("tipoHormigonParticular", null);
                      setField("claseHormigonParticular", null);
                      setField("espesorElementoMm", null);
                    }
                  }}
                  disabled={isReadOnly}
                />
                <label htmlFor="hpReq" className="text-sm">
                  Requiere requisitos particulares (<strong>CIRSOC 200-2024 Tabla 9.3</strong>: bajo agua, impermeabilidad, abrasión)
                </label>
              </div>
            )}
            {!esHRDC && form.requiereHormigonParticular && (
              <>
                <div className="col-12 md:col-8">
                  {fieldLabel("Caso (Tabla 9.3)")}
                  <Dropdown
                    value={form.tipoHormigonParticular && form.claseHormigonParticular
                      ? `${form.tipoHormigonParticular}|${form.claseHormigonParticular}` : null}
                    options={[
                      { label: "Clase I — Hormigón a colocar bajo agua (pilotes de gran diámetro)",         value: "BAJO_AGUA|I" },
                      { label: "Clase II — Elevada impermeabilidad (cisternas, depósitos, tuberías)",       value: "IMPERMEABILIDAD|II" },
                      { label: "Clase III — Abrasión: materiales a granel, movimiento de objetos pesados", value: "ABRASION|III" },
                      { label: "Clase IV — Abrasión: escurrimiento de agua ≥ 12 m/s con partículas",       value: "ABRASION|IV" },
                    ]}
                    onChange={(e) => {
                      if (!e.value) {
                        setField("tipoHormigonParticular", null);
                        setField("claseHormigonParticular", null);
                      } else {
                        const [t, c] = e.value.split("|");
                        setField("tipoHormigonParticular", t);
                        setField("claseHormigonParticular", c);
                      }
                    }}
                    className="w-full"
                    disabled={isReadOnly}
                    placeholder="Seleccionar caso"
                    showClear
                  />
                </div>
                <div className="col-12 md:col-4">
                  {fieldLabel("Espesor del elemento (mm)")}
                  <InputNumber
                    value={form.espesorElementoMm || null}
                    onValueChange={(e) => setField("espesorElementoMm", e.value)}
                    min={0} max={5000} suffix=" mm"
                    className="w-full"
                    disabled={isReadOnly}
                    placeholder="Opcional — resuelve sub-condiciones por espesor"
                  />
                </div>
              </>
            )}
            <div className="col-12 sm:col-6 md:col-4">
              {fieldLabel("Planta", true)}
              <Dropdown
                value={form.idPlanta}
                options={plantaOptions}
                onChange={(e) => {
                  setField("idPlanta", e.value);
                  setField("mezclaId", null);
                }}
                placeholder="Seleccionar planta"
                className="w-full"
                filter
                disabled={isReadOnly}
              />
            </div>
            <div className="col-12 sm:col-6 md:col-4">
              {fieldLabel("Nombre del diseño")}
              <InputText
                value={form.nombre}
                onChange={(e) => setField("nombre", e.target.value)}
                placeholder="Ej: H-30 TMN 19"
                className="w-full"
              />
            </div>
            <div className="col-12 sm:col-6 md:col-4">
              {fieldLabel("Descripción")}
              <InputTextarea
                value={form.descripcion}
                onChange={(e) => setField("descripcion", e.target.value)}
                rows={1}
                autoResize
                placeholder="Observaciones"
                className="w-full"
              />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════
            SECTION 2 — Parámetros objetivo
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 sm:p-4 mt-3">
          <h3 className="mt-0 mb-3">
            <i className="fa-solid fa-bullseye mr-2 text-primary" />
            Parámetros objetivo
          </h3>
          {/* Fila 1 — Resistencia + Edad + Asentamiento + TMN */}
          <div className="grid">
            <div className="col-12 sm:col-6 md:col-3">
              {(esHRDC || esAlivianado)
                ? fieldLabel("f'c (MPa) — opcional")
                : fieldLabel("f'ce (MPa)", true)}
              <InputNumber
                value={form.fce}
                onValueChange={(e) => setField("fce", e.value)}
                min={(esHRDC || esAlivianado) ? 0 : 5}
                max={100}
                minFractionDigits={0}
                maxFractionDigits={1}
                placeholder={(esHRDC || esAlivianado) ? "Opcional (orientativo)" : "Ej: 30"}
                className="w-full"
              />
              {esHRDC && (
                <small className="block text-color-secondary mt-1">
                  En RDC el f'c es opcional: a veces es sólo relleno sin
                  requisito de resistencia. El agua la gobierna la consistencia
                  objetivo; el cemento, la resistencia esperada. Si cargás un
                  f'c, se contrasta sólo de forma orientativa.
                </small>
              )}
              {esAlivianado && (
                <small className="block text-color-secondary mt-1">
                  En alivianado el f'c es opcional: el objetivo no es resistencia
                  sino aislación térmica / aligeramiento. Si lo cargás, se
                  contrasta contra una banda orientativa por densidad y CUC
                  (no calibrada con datos propios de la planta — el ensayo de probeta
                  es el que manda).
                </small>
              )}
              {/* Refactor 2026-05-20 — Tipo de hormigón derivado + modo del f'ce.
                  Solo se muestra cuando hay derivación válida. En HRDC el tipo
                  es fijo "HRDC" sin toggle. La nota indica origen normativo de
                  la clase (IRAM 1666:2020, CIRSOC 200:2024, o legacy). */}
              {tipoHormigonDerivado.nombre && (() => {
                const d = tipoHormigonDerivado;
                const esLegacy = !!d.notaLegacy && d.motivo !== 'hrdc';
                const severity = d.adHoc ? 'warning' : (esLegacy ? 'secondary' : 'info');
                const normas = [];
                if (d.enIram1666) normas.push('IRAM 1666:2020');
                if (d.enCirsoc200) normas.push('CIRSOC 200:2024');
                return (
                  <div
                    className="mt-2 p-2 border-round"
                    style={{
                      background: d.adHoc ? 'var(--surface-200)' : 'var(--surface-100)',
                      border: '1px solid var(--surface-border)',
                    }}
                  >
                    <div className="flex align-items-center justify-content-between gap-2 flex-wrap">
                      <small className="text-color-secondary">Tipo de hormigón</small>
                      <Tag value={d.nombre} severity={severity} />
                    </div>
                    {normas.length > 0 && (
                      <small className="block text-color-secondary mt-1" style={{ fontSize: '0.7rem' }}>
                        <i className="fa-solid fa-check mr-1" />Vigente en {normas.join(' + ')}.
                      </small>
                    )}
                    {esLegacy && (
                      <small className="block text-color-secondary mt-1" style={{ fontSize: '0.7rem' }}>
                        <i className="fa-solid fa-clock-rotate-left mr-1" />
                        Clase histórica ({d.notaLegacy}). Incluida por usos y costumbres — sigue apareciendo en pliegos y solicitudes.
                      </small>
                    )}
                    {d.adHoc && (
                      <small className="block text-color-secondary mt-1" style={{ fontSize: '0.7rem' }}>
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        f'ce fuera de las normas vigentes (H-5 a H-110). Clase ad-hoc — revisar antes de guardar.
                      </small>
                    )}
                    {!esHRDC && d.motivo !== 'sin_fce' && (
                      <div className="mt-2">
                        <small className="text-color-secondary block mb-1">Interpretar f'ce como:</small>
                        <SelectButton
                          value={form.tipoHormigonModoFce}
                          onChange={(e) => e.value && setField("tipoHormigonModoFce", e.value)}
                          options={[
                            { label: 'Especificado (pliego)', value: MODOS_FCE.ESPECIFICADO },
                            { label: 'Objetivo (con sobrediseño)', value: MODOS_FCE.OBJETIVO },
                          ]}
                          className="dosif-modofce-toggle"
                        />
                        <small className="block text-color-secondary mt-1" style={{ fontSize: '0.7rem', lineHeight: 1.4 }}>
                          {form.tipoHormigonModoFce === MODOS_FCE.OBJETIVO
                            ? "f'ce ya incluye el sobrediseño (k·σ aplicado afuera). El motor usa f'cm = f'ce sin sumar nada y mapea a la clase más cercana."
                            : "f'ce viene del pliego (CIRSOC 200:2024 §6.2.3). El motor calcula f'cm = f'ce + 1,65·S internamente y mapea a la clase inmediata superior."}
                        </small>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {!esHRDC && (
            <div className="col-12 sm:col-6 md:col-3">
              {fieldLabel("Desvío S (MPa)")}
              <InputNumber
                value={form.desvioS}
                onValueChange={(e) => setField("desvioS", e.value)}
                min={0}
                max={15}
                minFractionDigits={1}
                maxFractionDigits={1}
                placeholder="Ej: 3.5"
                className="w-full"
              />
              <Dropdown
                value={form.origenS}
                options={[
                  { label: 'Historial (>=15 ensayos)', value: 'H' },
                  { label: 'Estimado', value: 'E' },
                  { label: 'Normativo mínimo', value: 'N' },
                ]}
                onChange={(e) => setField('origenS', e.value)}
                placeholder="Origen"
                className="w-full mt-1"
                disabled={isReadOnly}
              />
              {form.desvioS != null && form.desvioS > 0 && form.desvioS < 2.5 && (
                <small className="text-yellow-500 block mt-1">S bajo — verificar historial suficiente (min. 15 ensayos)</small>
              )}
              {form.desvioS != null && form.desvioS > 7 && (
                <small className="text-orange-500 block mt-1">S elevado — revisar proceso de producción</small>
              )}
            </div>
            )}
            {!esHRDC && fcmDisplay != null && (
              <div className="col-12 sm:col-6 md:col-3">
                <small className="font-bold mb-1">f'cm (calculado)</small>
                <div className="p-inputtext p-component w-full surface-200 font-bold text-primary flex align-items-center">
                  {fcmDisplay} MPa
                </div>
              </div>
            )}
            {!esHRDC && (
            <div className="col-12 sm:col-6 md:col-4">
              {fieldLabel("Edad de diseño (días)", true)}
              <div className="flex flex-wrap gap-2 align-items-center">
                <SelectButton
                  value={EDAD_PRESETS.includes(form.edadDias) ? form.edadDias : -1}
                  options={EDAD_OPTIONS}
                  onChange={(e) => {
                    if (e.value == null) return;
                    if (e.value === -1) {
                      // Switch to custom — keep current value if already custom, else blank
                      if (!EDAD_PRESETS.includes(form.edadDias)) return;
                      setField("edadDias", null);
                    } else {
                      setField("edadDias", e.value);
                    }
                  }}
                />
                {!EDAD_PRESETS.includes(form.edadDias) && (
                  <InputNumber
                    value={form.edadDias}
                    onValueChange={(e) => setField("edadDias", e.value)}
                    min={1}
                    max={365}
                    placeholder="días"
                    className="w-5rem"
                    inputClassName="p-inputtext-sm"
                  />
                )}
              </div>
            </div>
            )}
            <div className="col-12 sm:col-6 md:col-3">
              {fieldLabel("TMN (mm)", true)}
              {hasMezcla && derivedTmn ? (
                <div className="p-inputtext p-component w-full" style={{ background: 'var(--surface-100)', cursor: 'default' }}>
                  <strong>{derivedTmn} mm</strong><small className="block text-color-secondary mt-1">Derivado de la mezcla</small>
                </div>
              ) : (
                <Dropdown
                  value={form.tmnMm}
                  options={[
                    { label: 'Sin restricción', value: null },
                    { label: '9,5 mm', value: 9.5 },
                    { label: '13,2 mm', value: 13.2 },
                    { label: '19 mm', value: 19 },
                    { label: '26,5 mm', value: 26.5 },
                    { label: '37,5 mm', value: 37.5 },
                    { label: '53 mm', value: 53 },
                  ]}
                  onChange={(e) => setForm(f => ({ ...f, tmnMm: e.value }))}
                  placeholder="Opcional — restringe sugerencias"
                  className="w-full"
                  showClear
                  disabled={isReadOnly}
                />
              )}
            </div>
          </div>

          {/* ── Consistencia (CIRSOC 200:2024 Tablas 4.1/4.2) ── */}
          {consistenciaClases.length > 0 && (
            <div className="surface-card border-round border-1 border-300 p-3 mt-2">
              <div className="flex align-items-center gap-2 mb-2">
                <i className="fa-solid fa-arrows-down-to-line text-primary" />
                <span className="font-bold text-sm">Consistencia (CIRSOC 200:2024)</span>
              </div>
              {/* Row 1: Class buttons */}
              <div className="mb-2">
                <small className="font-bold block mb-1">Clase de consistencia</small>
                <div className="flex align-items-center gap-2 flex-wrap">
                  <SelectButton
                    value={form.consistenciaClase}
                    options={consistenciaClases
                      // HRDC sólo admite Fluida o Muy fluida (asentamiento ≥ 15 cm)
                      .filter(c => !esHRDC || /fluid/i.test(c.codigo) || /fluid/i.test(c.nombre))
                      .map((c) => ({ label: c.nombre, value: c.codigo }))}
                    onChange={(e) => {
                      if (e.value != null) handleConsistenciaClaseChange(e.value);
                    }}
                    className="flex-wrap"
                    disabled={isReadOnly}
                  />
                  {form.consistenciaClase && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm(prev => ({
                          ...prev,
                          consistenciaClase: null,
                          consistenciaMetodo: null,
                          consistenciaValor: null,
                        }));
                      }}
                      className="p-link text-color-secondary text-sm"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      disabled={isReadOnly}
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>
              {/* Row 2: Method + Value + Range (shown when class is selected) */}
              {selectedConsClass && (
                <div className="grid mt-1">
                  <div className="col-12 sm:col-6 lg:col-4">
                    <small className="font-bold block mb-1">Método de ensayo</small>
                    <div className="flex flex-column gap-2">
                      {allowedMethods.map((met) => (
                        <div key={met} className="flex align-items-center gap-2">
                          <RadioButton
                            inputId={`met_${met}`}
                            value={met}
                            checked={form.consistenciaMetodo === met}
                            onChange={() => handleConsistenciaMetodoChange(met)}
                          />
                          <label htmlFor={`met_${met}`} className="text-sm cursor-pointer">
                            {METODO_LABELS[met] || met}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                  {form.consistenciaMetodo && consistenciaRange && (
                    <>
                      <div className="col-12 sm:col-6 lg:col-3">
                        <small className="font-bold block mb-1">
                          Valor nominal ({consistenciaRange.unit})
                        </small>
                        <InputNumber
                          value={form.consistenciaValor}
                          onValueChange={(e) => {
                            setField("consistenciaValor", e.value);
                            setField("asentamientoMm", null);
                          }}
                          min={consistenciaRange.min}
                          max={consistenciaRange.max}
                          minFractionDigits={1}
                          maxFractionDigits={1}
                          placeholder={`${consistenciaRange.min} – ${consistenciaRange.max}`}
                          className="w-full"
                        />
                      </div>
                      <div className="col-12 md:col-5">
                        <small className="font-bold block mb-1">Rango y tolerancia</small>
                        <div className="surface-100 border-round p-2 text-sm">
                          <div>
                            Rango de clase: <strong>{consistenciaRange.min} – {consistenciaRange.max} {consistenciaRange.unit}</strong>
                          </div>
                          <div>
                            Tolerancia: <strong>± {consistenciaRange.tol} {consistenciaRange.unit}</strong>
                          </div>
                          {form.consistenciaValor != null && (
                            <div className="mt-1">
                              Aceptable: <strong>
                                {Math.max(0, form.consistenciaValor - consistenciaRange.tol).toFixed(1)} – {(form.consistenciaValor + consistenciaRange.tol).toFixed(1)} {consistenciaRange.unit}
                              </strong>
                            </div>
                          )}
                          {selectedConsClass.requiereSuperplastificante && (
                            <div className="mt-1 text-orange-600">
                              <i className="fa-solid fa-triangle-exclamation mr-1" />
                              Requiere aditivo superplastificante (Art. 4.1.1.2)
                            </div>
                          )}
                          {!selectedConsClass.requiereSuperplastificante && selectedConsClass.recomiendaFluidificante && (
                            <div className="mt-1 text-blue-600">
                              <i className="fa-solid fa-circle-info mr-1" />
                              Se recomienda el uso de fluidificantes y/o superfluidificantes (C 4.1.1.1)
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Fallback: direct asentamiento input if no classes loaded or user prefers legacy */}
              {!form.consistenciaClase && (
                <div className="mt-2">
                  <small className="text-color-secondary block mb-1">
                    O ingrese directamente el asentamiento objetivo:
                  </small>
                  <div className="flex align-items-center gap-2" style={{ maxWidth: '20rem' }}>
                    <InputNumber
                      value={form.asentamientoMm != null ? form.asentamientoMm / 10 : null}
                      onValueChange={(e) => {
                        const cm = e.value;
                        const mm = cm != null ? cm * 10 : null;
                        setField("asentamientoMm", mm);
                        // Auto-detect consistency class from asentamiento
                        if (cm != null && consistenciaClases.length > 0) {
                          const match = consistenciaClases.find(c => {
                            const min = Number(c.asentamientoMin) || 0;
                            const max = Number(c.asentamientoMax) || 999;
                            return cm >= min && cm <= max;
                          });
                          if (match && match.codigo !== form.consistenciaClase) {
                            setField("consistenciaClase", match.codigo);
                            setField("consistenciaMetodo", match.metodoDefecto || "asentamiento");
                            setField("consistenciaValor", cm);
                          }
                        }
                      }}
                      min={0}
                      max={30}
                      minFractionDigits={1}
                      maxFractionDigits={1}
                      placeholder="Asentamiento (cm)"
                      className="flex-1"
                      disabled={isReadOnly}
                    />
                    <span className="text-sm text-color-secondary">cm</span>
                    {form.asentamientoMm != null && (
                      <span className="text-xs text-color-secondary">
                        ({form.asentamientoMm} mm)
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Legacy fallback when no consistency classes available */}
          {consistenciaClases.length === 0 && (
            <div className="grid mt-1">
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("Asentamiento (cm)", true)}
                <InputNumber
                  value={form.asentamientoMm != null ? form.asentamientoMm / 10 : null}
                  onValueChange={(e) => setField("asentamientoMm", e.value != null ? e.value * 10 : null)}
                  min={0}
                  max={30}
                  minFractionDigits={1}
                  maxFractionDigits={1}
                  placeholder="Ej: 10"
                  className="w-full"
                  disabled={isReadOnly}
                />
              </div>
            </div>
          )}

          {/* Fila 2 — Aire + Forma + Exposición */}
          <div className="grid mt-1">
            <div className="col-12 sm:col-6 md:col-3">
              {fieldLabel("Aire atrapado (%)")}
              <div className="flex align-items-center gap-2">
                {form.aireAtapadoAuto ? (
                  <div
                    className="p-inputtext p-component flex-1"
                    style={{ background: 'var(--surface-100)', cursor: 'default' }}
                  >
                    <span className="text-color-secondary">Auto (por TMN)</span>
                  </div>
                ) : (
                  <InputNumber
                    value={form.aireAtrapado}
                    onValueChange={(e) => setField("aireAtrapado", e.value)}
                    min={0}
                    max={10}
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    placeholder="Atrapado"
                    className="flex-1"
                    inputClassName="w-full"
                  />
                )}
                <Button
                  icon={form.aireAtapadoAuto ? "pi pi-pencil" : "pi pi-replay"}
                  tooltip={form.aireAtapadoAuto ? "Ingresar manualmente" : "Volver a auto (TMN)"}
                  tooltipOptions={{ position: "top" }}
                  outlined
                  size="small"
                  rounded
                  onClick={() => {
                    if (form.aireAtapadoAuto) {
                      setField("aireAtapadoAuto", false);
                    } else {
                      setField("aireAtapadoAuto", true);
                      setField("aireAtrapado", null);
                    }
                  }}
                />
              </div>
              {hasIncorporadorAire && (
                <div className="mt-2">
                  {fieldLabel("Aire incorporado (%)")}
                  <InputNumber
                    value={form.aireIncorporado}
                    onValueChange={(e) => setField("aireIncorporado", e.value)}
                    min={0}
                    max={10}
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    placeholder="Incorporado"
                    className="w-full"
                    inputClassName="w-full"
                  />
                </div>
              )}
              {(form.aireIncorporado > 0 || (!form.aireAtapadoAuto && form.aireAtrapado != null)) && (
                <div className="mt-1 text-xs text-color-secondary">
                  Total: {((form.aireAtapadoAuto ? 0 : (form.aireAtrapado || 0)) + (form.aireIncorporado || 0)).toFixed(1)}%
                  {form.aireAtapadoAuto && " + auto atrapado"}
                </div>
              )}
            </div>
            <div className="col-12 sm:col-6 md:col-4 lg:col-4">
              {fieldLabel("Forma del agregado")}
              {hasMezcla ? (
                <div className="p-inputtext p-component w-full" style={{ background: 'var(--surface-100)', cursor: 'default' }}>
                  <strong>{FORMA_LABELS[derivedForma] || derivedForma}</strong>
                  <small className="block text-color-secondary mt-1">Derivado de la mezcla seleccionada</small>
                </div>
              ) : (
                <div className="p-inputtext p-component w-full" style={{ background: 'var(--surface-100)', cursor: 'default', opacity: 0.7 }}>
                  <span className="text-color-secondary">Se define al seleccionar mezcla</span>
                </div>
              )}
            </div>
            {!esHRDC && (
              <div className="col-12 sm:col-6 md:col-5">
                {fieldLabel("Clase de exposición (CIRSOC 200:2024)")}
                <Dropdown
                  value={form.exposicion}
                  options={exposicionOpciones}
                  onChange={(e) => setField("exposicion", e.value)}
                  placeholder="Sin clase (sin restricción)"
                  showClear
                  filter
                  disabled={isReadOnly}
                  className={`w-full${legacyExposicionWarning ? " p-invalid" : ""}`}
                />
                {legacyExposicionWarning && (
                  <small className="p-error block mt-1">
                    El diseño guardado usaba una clase de exposición legacy. Seleccione la clase CIRSOC 200:2024 correspondiente.
                  </small>
                )}
              </div>
            )}
          </div>
          {hasMezcla && !derivedFormaResolved && (
            <div className="mt-3">
              <Message
                severity="warn"
                text="La mezcla seleccionada no permite derivar la forma del agregado grueso. Revise la clasificación o el nombre de los agregados gruesos antes de calcular o guardar."
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════
            SECTION 2a2 — Logística y colocación
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 sm:p-4 mt-3">
          <h3 className="mt-0 mb-3">
            <i className="fa-solid fa-truck mr-2 text-primary" />
            {"Logística y colocación"}
          </h3>
          {/* Responsive (fix desborde test54): los SelectButton tienen labels
              largos y van media fila c/u; los 4 numéricos en su propia fila a
              1/4 (2-por-fila mobile). Antes sumaban 16 cols en md y el
              InputNumber desbordaba la columna de 16%. */}
          <div className="grid">
            <div className="col-12 md:col-6">
              <label className="font-medium text-sm block mb-1">Modo de asentamiento</label>
              <SelectButton
                value={form.modoAsentamiento}
                options={[
                  { label: "En planta", value: "EN_PLANTA" },
                  { label: "En obra", value: "EN_OBRA" },
                ]}
                onChange={(e) => e.value && setField("modoAsentamiento", e.value)}
                className="w-full"
                disabled={isReadOnly}
              />
              <small className="text-color-secondary block mt-1">
                {form.modoAsentamiento === "EN_OBRA"
                  ? "El sistema calcula el asentamiento de despacho necesario."
                  : "Diseño directo con asentamiento en planta."}
              </small>
            </div>
            <div className="col-12 md:col-6">
              <label className="font-medium text-sm block mb-1">Método de colocación</label>
              <SelectButton
                value={form.metodoColocacion}
                options={[
                  { label: "Convencional", value: "CONVENCIONAL" },
                  { label: "Bombeado", value: "BOMBEADO" },
                ]}
                onChange={(e) => e.value && setField("metodoColocacion", e.value)}
                className="w-full"
                disabled={isReadOnly}
              />
              <small className="text-color-secondary block mt-1">
                {form.metodoColocacion === "BOMBEADO"
                  ? "Hormigón bombeado: no aplica la excepción del mínimo de pulverulento (CIRSOC §4.1.3)."
                  : "Sin bombeo: si f'c ≤ H-20 y sin clase agresiva, aplica la excepción §4.1.3."}
              </small>
            </div>
            <div className="col-6 sm:col-3">
              <label className="font-medium text-sm block mb-1">Viaje (min)</label>
              <InputNumber value={form.tiempoViaje} onValueChange={(e) => setField("tiempoViaje", e.value)} min={5} max={120} className="w-full" inputClassName="w-full" disabled={isReadOnly} />
            </div>
            <div className="col-6 sm:col-3">
              <label className="font-medium text-sm block mb-1">Descarga (min)</label>
              <InputNumber value={form.tiempoDescarga} onValueChange={(e) => setField("tiempoDescarga", e.value)} min={15} max={90} className="w-full" inputClassName="w-full" disabled={isReadOnly} />
            </div>
            <div className="col-6 sm:col-3">
              <label className="font-medium text-sm block mb-1">Espera (min)</label>
              <InputNumber value={form.tiempoEspera} onValueChange={(e) => setField("tiempoEspera", e.value)} min={0} max={60} className="w-full" inputClassName="w-full" disabled={isReadOnly} />
            </div>
            <div className="col-6 sm:col-3">
              <label className="font-medium text-sm block mb-1">{"Temp. amb. (\u00b0C)"}</label>
              <InputNumber value={form.temperaturaAmbiente} onValueChange={(e) => setField("temperaturaAmbiente", e.value)} min={5} max={45} className="w-full" inputClassName="w-full" disabled={isReadOnly} />
            </div>
          </div>
          {form.modoAsentamiento === "EN_OBRA" && (
            <div className="mt-2 p-2 border-round surface-ground text-sm">
              <i className="fa-solid fa-info-circle text-primary mr-1" />
              Tiempo total: <strong>{(form.tiempoViaje || 0) + (form.tiempoDescarga || 0) + (form.tiempoEspera || 0)} min</strong>.
              El asentamiento de despacho se calculará automáticamente al calcular la dosificación.
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════
            SECTION 2b — Factor prudencial + Restricciones de pliego
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 sm:p-4 mt-3">
          <h3 className="mt-0 mb-3">
            <i className="fa-solid fa-shield-halved mr-2 text-primary" />
            {"Restricciones del diseño"}
          </h3>
            <div className="grid">
              {/* Factor prudencial — oculto, ya no se usa (reemplazado por desvío estándar) */}

              {/* Tipo estructural — derivado de tipoArmadura */}
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("Tipo estructural")}
                <div className="p-inputtext p-component p-disabled w-full" style={{backgroundColor: 'var(--surface-100)', cursor: 'default', padding: '0.5rem 0.75rem'}}>
                  {(form.tipoArmadura || 'armado').charAt(0).toUpperCase() + (form.tipoArmadura || 'armado').slice(1)}
                </div>
                <small className="text-color-secondary">Derivado del tipo de armadura</small>
              </div>

              {/* a/c máxima pliego */}
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("a/c máxima (pliego)")}
                <div className="flex flex-column gap-2">
                  <InputNumber
                    value={form.acMaxPliego}
                    onValueChange={(e) => setField("acMaxPliego", e.value ?? null)}
                    min={0.20}
                    max={0.90}
                    minFractionDigits={2}
                    maxFractionDigits={2}
                    step={0.01}
                    placeholder="Sin restricción"
                    className="w-full"
                    showButtons={false}
                  />
                  <Dropdown
                    value={form.acModo}
                    options={AC_MODO_OPTIONS}
                    onChange={(e) => setField("acModo", e.value)}
                    className="w-full"
                    disabled={form.acMaxPliego == null}
                  />
                </div>
                <small className="text-color-secondary">L&iacute;mite o valor fijo exigido por pliego / cliente</small>
                {sugerenciaCIRSOC && (
                  <small className="block mt-1" style={{color: 'var(--blue-500)'}}>
                    <i className="fa-solid fa-info-circle mr-1" />
                    {sugerenciaCIRSOC.acMax != null
                      ? `CIRSOC Tabla 2.5: a/c <= ${sugerenciaCIRSOC.acMax.toFixed(2).replace('.', ',')} para ${sugerenciaCIRSOC.claseBase} (${form.tipoArmadura || 'armado'})`
                      : `CIRSOC Tabla 2.5: sin requisito de a/c para ${sugerenciaCIRSOC.claseBase} (${form.tipoArmadura || 'armado'})`
                    }
                    {sugerenciaCIRSOC.fcMin != null && ` | f'c min: ${sugerenciaCIRSOC.fcMin} MPa`}
                  </small>
                )}
              </div>

              {/* a/mc máxima */}
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("a/(mat. cem.) máxima (pliego)")}
                <InputNumber
                  value={form.amcMaxPliego}
                  onValueChange={(e) => setField("amcMaxPliego", e.value ?? null)}
                  min={0.20}
                  max={0.90}
                  minFractionDigits={2}
                  maxFractionDigits={2}
                  step={0.01}
                  placeholder="Sin restricción"
                  className="w-full"
                />
                <small className="text-color-secondary">Relación agua / material cementicio total máxima</small>
              </div>

              {/* Cemento mínimo pliego */}
              <div className="col-12 sm:col-6 md:col-3">
                {fieldLabel("Cemento mínimo (pliego, kg/m³)")}
                <InputNumber
                  value={form.cementoMinPliego}
                  onValueChange={(e) => setField("cementoMinPliego", e.value ?? null)}
                  min={100}
                  max={600}
                  minFractionDigits={0}
                  maxFractionDigits={0}
                  placeholder="Sin mínimo"
                  className="w-full"
                />
                <small className="text-color-secondary">Cemento m&iacute;nimo exigido por pliego o cliente</small>
                {sugerenciaCIRSOC?.cementoMin != null && (
                  <small className="block mt-1" style={{color: 'var(--blue-500)'}}>
                    <i className="fa-solid fa-info-circle mr-1" />
                    {'CIRSOC §4.1.5.2: material cementicio >= '}{sugerenciaCIRSOC.cementoMin}{' kg/m³ para hormigón '}{form.tipoArmadura || 'armado'}
                  </small>
                )}
              </div>
            </div>
          </div>

        {/* ═══════════════════════════════════
            SECTION 3 — Esqueleto granular
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 sm:p-4 mt-3">
          <h3 className="mt-0 mb-3">
            <i className="fa-solid fa-cubes-stacked mr-2 text-primary" />
            Esqueleto granular
          </h3>
          <div className="flex flex-wrap gap-3 align-items-end">
            <div className="flex flex-column">
              {fieldLabel("Mezcla granulométrica")}
              <Dropdown
                value={form.mezclaId}
                options={mezclaOptions}
                onChange={(e) => setField("mezclaId", e.value)}
                placeholder={form.idPlanta ? "Seleccionar mezcla" : "Elegir planta primero"}
                className="w-full md:w-20rem"
                filter
                disabled={!form.idPlanta || isReadOnly}
                showClear
              />
            </div>
            {form.idPlanta && !isReadOnly && (
              <Button
                label="Sugerir mezclas"
                icon="fa-solid fa-wand-magic-sparkles"
                className="p-button-outlined p-button-sm"
                loading={sugerenciasLoading}
                disabled={!form.idPlanta || (!esHRDC && !esAlivianado && !form.fce)}
                onClick={async () => {
                  // Step 1: fetch materials and show selector
                  setSugerenciasLoading(true);
                  try {
                    const matData = await getMaterialesParaMezcla(form.idPlanta);
                    const materiales = matData?.materiales || [];
                    // HRDC: admite mezcla s\u00f3lo con arena (sin grueso). Otras tipolog\u00edas exigen al menos 1 fino + 1 grueso.
                    const minRequerido = esHRDC ? 1 : 2;
                    if (materiales.length < minRequerido) {
                      showToast('warn', esHRDC
                        ? 'Se necesita al menos 1 fino con granulometr\u00eda'
                        : 'Se necesitan al menos 1 fino y 1 grueso con granulometr\u00eda');
                      setSugerenciasLoading(false); return;
                    }
                    const finos = materiales.filter(m => (m.tipo || '').toUpperCase() === 'FINO');
                    const gruesos = materiales.filter(m => (m.tipo || '').toUpperCase() !== 'FINO');
                    const selected = new Set(materiales.map(m => m.id));
                    setMaterialesDisponibles({ finos, gruesos, all: materiales, selected, cantidadTolvas: matData?.cantidadTolvas || 4 });
                    setShowMaterialSelector(true);
                    setSugerencias([]);
                  } catch (e) {
                    console.error(e);
                    showToast('error', e.response?.data?.error || 'Error cargando materiales');
                  } finally { setSugerenciasLoading(false); }
                }}
              />
            )}
          </div>
          {/* Panel de selección de materiales */}
          {showMaterialSelector && materialesDisponibles && (
            <div className="mt-3 p-3 border-round surface-ground">
              <div className="flex justify-content-between align-items-center mb-2">
                <strong className="text-sm"><i className="fa-solid fa-filter mr-2" />Materiales disponibles en planta</strong>
                <Button icon="fa-solid fa-times" rounded text size="small" onClick={() => setShowMaterialSelector(false)} />
              </div>
              <div className="flex flex-wrap gap-3 align-items-center mb-2">
                <p className="text-xs text-color-secondary m-0">Desactive los materiales que no desea incluir en la mezcla.</p>
                <div className="flex align-items-center gap-2">
                  <Checkbox
                    inputId="ocultar-mezclas-guardadas"
                    checked={ocultarMezclasGuardadas}
                    onChange={(e) => {
                      const checked = !!e.checked;
                      setOcultarMezclasGuardadas(checked);
                      // Al ocultar, deseleccionar las mezclas guardadas para
                      // que no entren al sugeridor.
                      if (checked && materialesDisponibles) {
                        const next = new Set(materialesDisponibles.selected);
                        for (const m of materialesDisponibles.all) {
                          if (m.esMezcla) next.delete(m.id);
                        }
                        setMaterialesDisponibles(prev => ({ ...prev, selected: next }));
                      }
                    }}
                  />
                  <label htmlFor="ocultar-mezclas-guardadas" className="text-xs cursor-pointer">
                    Ocultar mezclas ya guardadas en catálogo
                  </label>
                </div>
              </div>
              <div className="grid">
                {/* Finos */}
                <div className="col-12 md:col-6">
                  <div className="text-sm font-bold mb-1 text-blue-400"><i className="fa-solid fa-water mr-1" />Finos ({finosVisibles.length})</div>
                  {finosVisibles.map(m => (
                    <div key={m.id} className="flex align-items-center gap-2 py-1">
                      <Checkbox inputId={`mat-${m.id}`} checked={materialesDisponibles.selected.has(m.id)}
                        onChange={(e) => {
                          const next = new Set(materialesDisponibles.selected);
                          e.checked ? next.add(m.id) : next.delete(m.id);
                          setMaterialesDisponibles(prev => ({ ...prev, selected: next }));
                        }} />
                      <label htmlFor={`mat-${m.id}`} className="text-sm cursor-pointer">
                        {m.esMezcla && <span className="border-round px-1 text-xs font-bold mr-1" style={{ background: 'var(--blue-200)', color: 'var(--blue-900)' }}>Mezcla</span>}
                        {m.nombre} <small className="text-color-secondary">MF: {m.mf?.toFixed(2) || '?'}</small>
                      </label>
                    </div>
                  ))}
                  {finosVisibles.length === 0 && <small className="text-color-secondary">No hay finos con granulometr&iacute;a</small>}
                </div>
                {/* Gruesos */}
                <div className="col-12 md:col-6">
                  <div className="text-sm font-bold mb-1 text-orange-400"><i className="fa-solid fa-mountain mr-1" />Gruesos ({gruesosVisibles.length})</div>
                  {gruesosVisibles.map(m => (
                    <div key={m.id} className="flex align-items-center gap-2 py-1">
                      <Checkbox inputId={`mat-${m.id}`} checked={materialesDisponibles.selected.has(m.id)}
                        onChange={(e) => {
                          const next = new Set(materialesDisponibles.selected);
                          e.checked ? next.add(m.id) : next.delete(m.id);
                          setMaterialesDisponibles(prev => ({ ...prev, selected: next }));
                        }} />
                      <label htmlFor={`mat-${m.id}`} className="text-sm cursor-pointer">
                        {m.esMezcla && <span className="border-round px-1 text-xs font-bold mr-1" style={{ background: 'var(--orange-200)', color: 'var(--orange-900)' }}>Mezcla</span>}
                        {m.nombre} <small className="text-color-secondary">TMN: {m.tmn || '?'} mm</small>
                      </label>
                    </div>
                  ))}
                  {gruesosVisibles.length === 0 && <small className="text-color-secondary">No hay gruesos con granulometr&iacute;a</small>}
                </div>
              </div>
              <div className="flex justify-content-between align-items-center mt-3">
                <small className="text-color-secondary">{materialesDisponibles.selected.size} de {materialesDisponibles.all.length} seleccionados · Tolvas: {materialesDisponibles.cantidadTolvas}</small>
                <Button label="Generar sugerencias" icon="fa-solid fa-play" size="small" severity="success"
                  disabled={materialesDisponibles.selected.size < (esHRDC ? 1 : 2)}
                  loading={sugerenciasLoading}
                  onClick={async () => {
                    setSugerenciasLoading(true);
                    setSugerencias([]);
                    try {
                      // Filtro defensivo: respeta `selected` Y, si el toggle "Ocultar
                      // mezclas guardadas" está activo, excluye explícitamente las
                      // mezclas del catálogo aunque hubieran quedado seleccionadas
                      // por algún path no cubierto.
                      const materiales = materialesDisponibles.all.filter(m =>
                        materialesDisponibles.selected.has(m.id)
                        && !(ocultarMezclasGuardadas && m.esMezcla)
                      );
                      const hasFino = materiales.some(m => (m.tipo || '').toUpperCase() === 'FINO');
                      const hasGrueso = materiales.some(m => (m.tipo || '').toUpperCase() !== 'FINO');
                      // HRDC: sólo se exige al menos 1 fino (la mezcla puede ser 100% arena).
                      if (!hasFino) {
                        showToast('warn', 'Se necesita al menos 1 fino seleccionado');
                        setSugerenciasLoading(false); return;
                      }
                      if (!esHRDC && !hasGrueso) {
                        showToast('warn', 'Se necesita al menos 1 grueso seleccionado');
                        setSugerenciasLoading(false); return;
                      }
                      // Modo de reporte — mismo setting que el PDF selector.
                      // Default PRESTACIONAL; si el usuario eligió "Cumplimiento estricto"
                      // alguna vez, ese modo también rige la exclusión en el sugeridor.
                      let reportMode = 'PRESTACIONAL';
                      try {
                        const saved = localStorage.getItem('hq_pdf_report_mode');
                        if (saved === 'NORMATIVO_ESTRICTO') reportMode = 'NORMATIVO_ESTRICTO';
                      } catch { /* ignore */ }
                      const sugerirParams = {
                        asentamientoMm: form.asentamientoMm || (form.consistenciaValor ? form.consistenciaValor * 10 : 120),
                        airePct: form.aireAtrapado || 2,
                        cementanteEstimado: null,
                        tmnObjetivo: form.tmnMm || null,
                        maxResultados: 4,
                        maxComponentes: materialesDisponibles.cantidadTolvas,
                        tipologia: form.tipologiaCodigo || 'convencional',
                        bombeable: (form.tipologiaCodigo || '').toLowerCase() === 'bombeable',
                        aspectoSuperficial: form.aspectoSuperficialImportante || false,
                        expuestoDesgaste: form.expuestoDesgaste || false,
                        tipoArmadura: form.tipoArmadura || 'armado',
                        fc: form.fce || 25,
                        desvioS: form.desvioS || 4,
                        formaAgregado: form.formaAgregado || null,
                        tiempoViaje: form.tiempoViaje || 30,
                        tiempoDescarga: form.tiempoDescarga || 30,
                        tiempoEspera: form.tiempoEspera || 0,
                        temperatura: form.temperaturaAmbiente || 20,
                        claseExposicion: form.exposicion || null,
                        acMaxPliego: form.acMaxPliego || null,
                        cementoMinPliego: form.cementoMinPliego || null,
                        reportMode,
                      };
                      const sugData = await sugerirMezclas(materiales, sugerirParams);
                      // Guardamos los parámetros para reusarlos en el editor interactivo
                      setEditorParametros(sugerirParams);
                      setSugerencias(sugData?.sugerencias || []);
                      setAditivosRecomendados(sugData?.aditivosRecomendados || null);
                      if (!sugData?.sugerencias?.length) showToast('info', 'No se encontraron mezclas factibles con los materiales seleccionados.');
                      setShowMaterialSelector(false);
                    } catch (e) {
                      console.error(e);
                      showToast('error', e.response?.data?.error || 'Error generando sugerencias');
                    } finally { setSugerenciasLoading(false); }
                  }}
                />
              </div>
            </div>
          )}

          {/* Sugerencias de mezcla */}
          {sugerencias.length > 0 && (
            <div className="mt-3">
              <h4 className="mt-0 mb-2"><i className="fa-solid fa-lightbulb mr-2 text-yellow-500" />Mezclas sugeridas ({sugerencias.length})</h4>
              {/* Advertencias TMN */}
              {sugerencias[0]?._meta?.advertencias?.length > 0 && (
                <div className="mb-2 p-2 border-round" style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                  {sugerencias[0]._meta.advertencias.map((adv, i) => (
                    <div key={i} className="text-xs flex align-items-start gap-2 py-1" style={{ color: 'var(--yellow-500)' }}>
                      <i className="fa-solid fa-triangle-exclamation mt-1" />
                      <span>{adv.mensaje}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Materiales excluidos */}
              {sugerencias[0]?._meta?.excluidos?.length > 0 && (
                <div className="mb-2 text-xs text-color-secondary">
                  <i className="fa-solid fa-filter mr-1" />Materiales excluidos:
                  {sugerencias[0]._meta.excluidos.map((ex, i) => (
                    <span key={i} className="ml-2"><i className="fa-solid fa-times text-red-400 mr-1" />{ex.nombre}: {ex.motivo}</span>
                  ))}
                  <span className="ml-2">(TMN {"máx."}: {sugerencias[0]._meta.tmnMaximo} mm — {sugerencias[0]._meta.tmnFuente})</span>
                </div>
              )}
              <div className="grid">
                {sugerencias.map((sug, idx) => {
                  const ind = sug.indicadores || {};
                  const zonaNombre = ind.zona?.nombre || ind.zona?.zona || '—';
                  const estrellas = '\u2605'.repeat(sug.estrellas || 0) + '\u2606'.repeat(Math.max(0, 4 - (sug.estrellas || 0)));
                  // Issue 1 (sesión 2026-05-27): detección de card ajustada.
                  // Marca canónica = sufijo "(ajustada)" en `etiqueta`, que el
                  // onConfirm del editor agrega al mutar la sugerencia. Si en
                  // el futuro el motor expone `_edicionManual` como flag,
                  // contemplarlo acá también (defensa contra dependencia única).
                  const esAjustada = (sug.etiqueta && /ajustada/i.test(sug.etiqueta)) || sug._edicionManual === true;
                  const aplicarPulso = idx === sugRecienAjustadaIdx;
                  return (
                    <div key={idx} className="col-12 md:col-6 lg:col-3">
                      <div
                        ref={(el) => { sugCardRefs.current[idx] = el; }}
                        className={[
                          'surface-card border-round p-3 h-full',
                          idx === 0 ? 'border-2 border-primary' : 'border-1 border-300',
                          esAjustada ? 'dosif-sug-card-ajustada' : '',
                          aplicarPulso ? 'dosif-sug-card-pulse' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <div className="flex justify-content-between align-items-center mb-2">
                          <strong className="text-sm">{"Opción"} {sug.ranking}</strong>
                          <span className="text-yellow-500">{estrellas}</span>
                        </div>
                        {/* Issue 1: badge "MODIFICADA" prominente reemplaza al
                            Tag de etiqueta cuando la sugerencia fue ajustada.
                            Cuando NO está ajustada, mantenemos el Tag original. */}
                        {esAjustada ? (
                          <div className="dosif-sug-badge-modificada">
                            <i className="fa-solid fa-pen" style={{ fontSize: '0.65rem' }} />
                            Modificada
                          </div>
                        ) : (
                          sug.etiqueta && <Tag value={sug.etiqueta} severity="success" className="mb-2" />
                        )}
                        <div className="text-xs text-color-secondary mb-2">
                          {sug.componentes?.map(c => `${c.nombre || 'Material'} (${c.porcentaje}%)`).join(' + ')}
                        </div>
                        <div className="grid text-xs mb-2">
                          <div className="col-12 md:col-6">MF: <strong>{ind.mf?.toFixed(2) || '—'}</strong></div>
                          <div className="col-12 md:col-6">TMN: <strong>{ind.tmn || '—'} mm</strong></div>
                          <div className="col-12 md:col-6">FdG: <strong>{ind.fdg?.toFixed(1) || '—'}%</strong></div>
                          <div className="col-12 md:col-6">FdT: <strong>{ind.fdt?.toFixed(1) || '—'}%</strong></div>
                          <div className="col-12 md:col-6">SE: <strong>{ind.se?.toFixed(1) || '—'}</strong></div>
                          <div className="col-12 md:col-6">FdA: <strong>{ind.fda?.toFixed(1) || '—'}</strong></div>
                        </div>
                        <div className="text-xs mb-2">
                          {(() => {
                            const sh = sug._meta?.shilstone;
                            const z = ind.zona?.zona || '';
                            const esTMNBajo = (ind.tmn || 0) <= 13.2;
                            const zonasOk = sh?.zonaObjetivo ? (esTMNBajo ? (sh.zonaAceptableTMNBajo || sh.zonaObjetivo) : sh.zonaObjetivo) : ['II'];
                            const esObjetivo = sh?.zonaObjetivo?.includes(z);
                            const esAceptable = zonasOk.includes(z);
                            const sev = !sh?.zonaObjetivo ? 'info' : esObjetivo ? 'success' : esAceptable ? 'success' : 'warning';
                            const sufijo = sh?.severidad === 'informativo' ? ' (orientativo)' : sh?.severidad === 'advertencia' && !esAceptable ? ' (obs.)' : '';
                            return <Tag value={`Zona ${z || '—'} — ${zonaNombre}${sufijo}`} severity={sev} />;
                          })()}
                        </div>
                        {sug._meta?.shilstone?.nota && sug._meta.shilstone.severidad !== 'obligatorio' && (
                          <div className="text-xs text-color-secondary mb-1" style={{ fontStyle: 'italic', fontSize: '0.7rem' }}>
                            <i className="fa-solid fa-info-circle mr-1" />{sug._meta.shilstone.nota}
                          </div>
                        )}
                        {/* Cumplimiento de aptitud IRAM 1512 (suma nocivas ponderada, etc.) — C5 canónico */}
                        {sug.cumplimientoAptitud && (() => {
                          const ca = sug.cumplimientoAptitud;
                          const cat = categoriaDeAptitudEstado(ca.estado);
                          const cfg = CATEGORIA_COLORS[cat];
                          const label = `Aptitud: ${cat}`;
                          const suma = ca.sumaNocivasPond;
                          const ctxTxt = ca.contexto?.expuestoDesgaste ? 'con desgaste' : 'sin desgaste';
                          return (
                            <div className="mb-2">
                              <Tag value={label} severity={cfg.severity} icon={cfg.icon} />
                              {suma != null && (
                                <small className="ml-2 text-color-secondary" style={{ fontSize: '0.7rem' }}>
                                  suma nocivas pond. {suma.toFixed(2).replace('.', ',')}% ({ctxTxt})
                                </small>
                              )}
                              {ca.problemas && ca.problemas.length > 0 && (
                                <div className="text-xs mt-1" style={{ fontSize: '0.7rem', color: 'var(--orange-400)' }}>
                                  <i className="fa-solid fa-triangle-exclamation mr-1" />
                                  {ca.problemas[0]}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <div className="text-xs text-color-secondary mb-1">
                          Cemento est.: <strong>{ind.cemento ? Math.round(ind.cemento) : '—'} {"kg/m³"}</strong> | Finos: {ind.proporcionFinos?.toFixed(0)}%
                        </div>
                        {/* Mini granulometry curve with IRAM 1627 band */}
                        {sug.granulometria && (() => {
                          // Collect all available sieves from the granulometry data
                          const gran = sug.granulometria;
                          const allKeys = Object.keys(gran).map(Number).filter(k => k > 0 && gran[k] != null).sort((a, b) => a - b);
                          if (allKeys.length < 3) return null;
                          const W = 200, H = 55, PAD = 2;
                          const logMin = Math.log10(allKeys[0] * 0.9), logMax = Math.log10(allKeys[allKeys.length - 1] * 1.1);
                          const logRange = logMax - logMin;
                          const sx = (t) => PAD + ((Math.log10(t) - logMin) / logRange) * (W - 2 * PAD);
                          const sy = (pasa) => H - PAD - (pasa / 100) * (H - 2 * PAD);
                          const pts = allKeys.map(t => ({ t, pasa: gran[t] }));
                          const line = pts.map(p => `${sx(p.t).toFixed(1)},${sy(p.pasa).toFixed(1)}`).join(' ');

                          // Band from sugerencias metadata (if available via _meta)
                          const band = sug._meta?.bandaPuntos;
                          let bandPath = null;
                          if (band?.length) {
                            const bPts = allKeys.map(t => {
                              const bp = band.find(b => Math.abs(b.aberturaMm - t) < 0.5 || Math.abs(b.aberturaMm - t) / t < 0.05);
                              return bp && bp.limInfPct != null && bp.limSupPct != null ? { t, lo: bp.limInfPct, hi: bp.limSupPct } : null;
                            }).filter(Boolean);
                            if (bPts.length >= 2) {
                              const upper = bPts.map(b => `${sx(b.t).toFixed(1)},${sy(b.hi).toFixed(1)}`).join(' ');
                              const lower = [...bPts].reverse().map(b => `${sx(b.t).toFixed(1)},${sy(b.lo).toFixed(1)}`).join(' ');
                              bandPath = `${upper} ${lower}`;
                            }
                          }

                          // Grid lines (subtle, theme-aware)
                          const gridLines = [0, 25, 50, 75, 100].map(pct => (
                            <line key={pct} x1={PAD} y1={sy(pct)} x2={W - PAD} y2={sy(pct)} stroke="var(--surface-border, #444)" strokeWidth="0.3" strokeOpacity="0.5" />
                          ));

                          return (
                            <svg viewBox={`0 0 ${W} ${H}`} className="w-full mb-2" style={{height: 55, background: 'var(--surface-ground, #1e1e2e)', borderRadius: 6, border: '1px solid var(--surface-border, #333)'}}>
                              {gridLines}
                              {bandPath && <polygon points={bandPath} fill="rgba(34,197,94,0.2)" stroke="rgba(34,197,94,0.4)" strokeWidth="0.5" />}
                              <polyline points={line} fill="none" stroke="#60A5FA" strokeWidth="1.8" strokeLinejoin="round" />
                              {pts.map((p, pi) => <circle key={pi} cx={sx(p.t)} cy={sy(p.pasa)} r="2" fill="#60A5FA" stroke="var(--surface-card, #2a2a3d)" strokeWidth="1" />)}
                            </svg>
                          );
                        })()}
                        {aditivosRecomendados?.principal && (
                          <div className="text-xs mb-2" style={{borderTop: '1px solid var(--surface-300)', paddingTop: '4px'}}>
                            <div className="flex align-items-center gap-1 mb-1">
                              <i className="fa-solid fa-flask text-primary" style={{fontSize: '0.7rem'}} />
                              <strong className="text-color-secondary">Aditivos recomendados:</strong>
                            </div>
                            <div className="text-color-secondary">
                              <i className="fa-solid fa-droplet mr-1" style={{fontSize: '0.6rem'}} />
                              {aditivosRecomendados.principal.marca} — {aditivosRecomendados.dosisPrincipal?.dosis}% s/cem
                              <small className="block ml-3" style={{opacity: 0.7}}>
                                {"Reducción agua: "}{aditivosRecomendados.dosisPrincipal?.reduccionAguaPct?.toFixed(0) || '—'}%
                                {aditivosRecomendados.dosisPrincipal?.aireColateral > 0 && ` | Aire: +${aditivosRecomendados.dosisPrincipal.aireColateral.toFixed(1)}%`}
                              </small>
                            </div>
                            {aditivosRecomendados.retardante && (
                              <div className="text-color-secondary mt-1">
                                <i className="fa-solid fa-clock mr-1" style={{fontSize: '0.6rem'}} />
                                {aditivosRecomendados.retardante.marca} — {aditivosRecomendados.dosisRetardante?.dosis}% s/cem
                                <small className="block ml-3" style={{opacity: 0.7}}>
                                  {aditivosRecomendados.necesitaRetardante?.motivo || 'Retardante de fraguado'}
                                </small>
                              </div>
                            )}
                            {aditivosRecomendados.alertas?.length > 0 && aditivosRecomendados.alertas.map((al, ai) => (
                              <div key={ai} className="text-yellow-500 mt-1">
                                <i className="fa-solid fa-triangle-exclamation mr-1" style={{fontSize: '0.6rem'}} />{al.mensaje}
                              </div>
                            ))}
                          </div>
                        )}
                        <Button
                          label="Editar proporciones"
                          icon="fa-solid fa-sliders"
                          className="p-button-sm p-button-outlined w-full mb-1"
                          severity="help"
                          onClick={() => setEditorSugerencia(sug)}
                        />
                        <Button
                          label="Seleccionar"
                          icon="fa-solid fa-check"
                          className="p-button-sm w-full"
                          severity={idx === 0 ? undefined : 'secondary'}
                          outlined={idx !== 0}
                          onClick={async () => {
                            if (accionRef.current) return;
                            try {
                              const plantaId = form.idPlanta;
                              const plantaNombre = plantaOptions.find(p => p.value === plantaId)?.label || '';
                              const dosifNombre = form.nombre || ('H-' + (form.fce || ''));
                              const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                              const defaultName = `Mezcla ${plantaNombre} ${dosifNombre} ${fecha}`.trim();
                              const nombreMezcla = await askValue({
                                title: 'Crear mezcla sugerida',
                                label: 'Nombre de la mezcla',
                                defaultValue: defaultName,
                              });
                              if (nombreMezcla === null) return; // user cancelled
                              accionRef.current = true;
                              const nombreFinal = nombreMezcla.trim() || defaultName;
                              const result = await crearMezclaSugerida({
                                componentes: sug.componentes,
                                indicadores: sug.indicadores,
                                granulometria: sug.granulometria || null,
                                idPlanta: plantaId,
                                nombre: nombreFinal,
                                designName: dosifNombre,
                              });
                              if (result?.idMezcla) {
                                // Reload mezclas dropdown to include the new one
                                try {
                                  const m = await getMezclas(form.idPlanta);
                                  setMezclas(Array.isArray(m) ? m : []);
                                } catch {}
                                setField('mezclaId', result.idMezcla);
                                // Auto-fill recommended additives.
                                // En HRDC el slot 1 está reservado al espumígeno
                                // (auto-seleccionado al elegir tipología), por lo
                                // que el plastificante recomendado va al primer
                                // slot disponible (2 o 3). Si no hay slot libre,
                                // no se sobrescribe nada manual.
                                const findFreeSlot = (preferredSlot) => {
                                  if (!form[`aditivo${preferredSlot}Id`]) return preferredSlot;
                                  for (const s of [2, 3]) {
                                    if (!form[`aditivo${s}Id`]) return s;
                                  }
                                  return null;
                                };
                                if (aditivosRecomendados?.principal) {
                                  const slotPlast = esHRDC ? findFreeSlot(2) : 1;
                                  if (slotPlast) {
                                    setField(`aditivo${slotPlast}Id`, aditivosRecomendados.principal.idAditivo);
                                    setField(`aditivo${slotPlast}Dosis`, aditivosRecomendados.dosisPrincipal?.dosis);
                                    setField(`aditivo${slotPlast}Modo`, aditivosRecomendados.principal.modoEfectoSugerido || 'AHORRO_AGUA');
                                  }
                                }
                                if (aditivosRecomendados?.retardante) {
                                  const slotRet = esHRDC ? findFreeSlot(3) : 2;
                                  if (slotRet) {
                                    setField(`aditivo${slotRet}Id`, aditivosRecomendados.retardante.idAditivo);
                                    setField(`aditivo${slotRet}Dosis`, aditivosRecomendados.dosisRetardante?.dosis);
                                    setField(`aditivo${slotRet}Modo`, 'RETARDANTE');
                                  }
                                }
                                if (aditivosRecomendados?.principal) {
                                  setField('aditivosAutoSeleccionados', true);
                                }
                                setSugerencias([]);
                                setAditivosRecomendados(null);
                                showToast('success', `Mezcla "${result.nombre}" creada y vinculada${aditivosRecomendados?.principal ? ' con aditivos recomendados' : ''}.`);
                              }
                            } catch (e) {
                              console.error(e);
                              showToast('error', e.response?.data?.error || 'Error al crear la mezcla');
                            } finally {
                              accionRef.current = false;
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!form.idPlanta && (
            <div className="mt-3 p-3 surface-ground border-round text-center text-color-secondary text-sm">
              <i className="fa-solid fa-info-circle mr-2" />
              Seleccione una planta para listar mezclas disponibles.
            </div>
          )}
          {form.idPlanta && !form.mezclaId && (
            <div className="mt-3 p-3 surface-ground border-round text-center text-color-secondary text-sm">
              <i className="fa-solid fa-hand-pointer mr-2" />
              Seleccione una mezcla granulométrica guardada.
            </div>
          )}
          {selectedMezcla && (
            <div className="mt-3 p-3 surface-ground border-round">
              <div className="flex align-items-center gap-3 text-sm flex-wrap">
                <Tag value={selectedMezcla.tipoMezcla || "TOTAL"} severity="info" />
                <span className="font-semibold">{selectedMezcla.nombre}</span>
                {selectedMezcla.tmnCalculadoMm && (
                  <span>TMN: <strong>{selectedMezcla.tmnCalculadoMm} mm</strong></span>
                )}
                {selectedMezcla.moduloFinura && (
                  <span>MF: <strong>{selectedMezcla.moduloFinura}</strong></span>
                )}
                {selectedMezcla.items?.length > 0 && (
                  <span>{selectedMezcla.items.length} componente{selectedMezcla.items.length !== 1 ? 's' : ''}</span>
                )}
                {/* Issue 2 (sesión 2026-05-27): botón para reajustar las
                    proporciones de la mezcla seleccionada sin tener que pedir
                    nuevas sugerencias. Solo aparece en BORRADOR (el backend
                    también lo gatea — defensa en profundidad). */}
                {isEditable && selectedMezcla.items?.length >= 2 && (
                  <Button
                    label="Modificar proporciones"
                    icon="fa-solid fa-sliders"
                    size="small"
                    outlined
                    className="ml-auto"
                    tooltip="Ajustá las proporciones de cada componente sin pedir nuevas sugerencias. Solo se puede mientras la dosificación esté en BORRADOR."
                    tooltipOptions={{ position: "top" }}
                    onClick={() => {
                      // Mapear el shape de la mezcla guardada (items[]) al
                      // shape que espera el EditorProporcionesModal
                      // (componentes[]). El editor consume `id`, `nombre`,
                      // `tipo` y `porcentaje`; el resto es opcional.
                      const componentes = (selectedMezcla.items || []).map((it) => {
                        const ag = it.agregado || {};
                        const esFino = ag.esFino === true
                          || ag.tipo === 'FINO'
                          || /arena/i.test(ag.nombre || it.nombreAgregado || '');
                        return {
                          id: it.idAgregado,
                          nombre: ag.nombre || it.nombreAgregado || `Material ${it.idAgregado}`,
                          tipo: esFino ? 'FINO' : 'GRUESO',
                          porcentaje: Number(it.porcentajeFinal) || 0,
                        };
                      });
                      setEditorMezclaEnUso({
                        componentes,
                        indicadores: {
                          mf: selectedMezcla.moduloFinura,
                          tmn: selectedMezcla.tmnCalculadoMm,
                        },
                        granulometria: selectedMezcla.curvaMezclaJson || null,
                      });
                    }}
                  />
                )}
              </div>
              {selectedMezcla.items?.length > 0 && (
                <div className="mt-2 text-sm text-color-secondary">
                  {mezclaComponentesText}
                </div>
              )}
              {/* Banner de aviso cuando la mezcla cambió desde el último
                  cálculo (Issue 2): el resultado vigente puede no reflejar la
                  nueva curva — invitar a recalcular. */}
              {mezclaCambioDesdeUltimoCalculo && (
                <div
                  className="mt-2 p-2 border-round text-xs"
                  style={{ background: 'rgba(245, 158, 11, 0.15)', borderLeft: '3px solid var(--orange-500)' }}
                >
                  <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                  La mezcla cambió. Recalculá la dosificación para obtener los valores actualizados.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════
            SECTION 4 — Material cementante
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 mt-3">
          <h3 className="mt-0 mb-2">
            <i className="fa-solid fa-mortar-pestle mr-2 text-primary" />
            Material cementante
          </h3>

          {/* Cemento */}
          <div className="flex flex-wrap gap-3 align-items-end">
            <div className="flex flex-column">
              {fieldLabel("Cemento", true)}
              <Dropdown
                value={form.cementoId}
                options={cementoOptions}
                onChange={(e) => setField("cementoId", e.value)}
                placeholder="Seleccionar cemento"
                className="w-full md:w-20rem"
                filter
                disabled={isReadOnly}
              />
            </div>
            {form.cementoId && (() => {
              const cem = cementosById[form.cementoId];
              const familia = cem?.familiaCemento || cem?.composicion || null;
              if (!familia) return (
                <div className="flex flex-column">
                  <small className="text-orange-500 mt-1">
                    <i className="fa-solid fa-triangle-exclamation mr-1" />
                    Cemento sin familia asignada (CP30/CP40/CP50)
                  </small>
                </div>
              );
              const nombreCem = cem?.nombre || cem?.descripcion || 'Cemento';
              const cfg = cem?.cementoPlantaConfig;
              const modo = cfg?.modoCurva || 'ICPA';
              const factor = cfg?.factorAjuste != null ? Number(cfg.factorAjuste) : 1.0;
              const curvaResolvedLabel = modo === 'ICPA'
                ? `Referencia general - ${familia}`
                : modo === 'PROPIA'
                  ? `Curva propia (id ${cfg?.idCurvaPropia || '?'})`
                  : `Curva del fabricante (${nombreCem})`;
              const factorLabel = Math.abs(factor - 1) < 0.001
                ? 'sin ajuste (1.000)'
                : factor > 1
                  ? `factor ${factor.toFixed(3)} → rinde ${((factor - 1) * 100).toFixed(1)}% más`
                  : `factor ${factor.toFixed(3)} → rinde ${((1 - factor) * 100).toFixed(1)}% menos`;
              return (
                <div className="flex flex-column w-full md:w-auto">
                  {fieldLabel("Curva a/c (resuelta desde el cemento × planta)")}
                  <div className="surface-card border-1 surface-border border-round p-2">
                    <div className="font-semibold">
                      <i className="fa-solid fa-chart-line mr-2 text-primary" />
                      {curvaResolvedLabel}
                    </div>
                    <small className="text-color-secondary block mt-1">
                      Factor de ajuste planta: {factorLabel}
                    </small>
                  </div>
                  <small className="text-color-secondary mt-1" style={{ fontSize: '0.7rem' }}>
                    <i className="fa-solid fa-circle-info mr-1" />
                    Para cambiar la curva, edite la ficha del cemento (sección "Disponibilidad y curvas por planta").
                  </small>
                </div>
              );
            })()}
          </div>

          <Divider className="my-2" />

          {/* Adiciones */}
          <small className="font-bold text-color-secondary">Adiciones minerales (opcional)</small>
          <div className="flex flex-wrap gap-3 align-items-end mt-2">
            <div className="flex flex-column">
              {fieldLabel("Adición 1")}
              <Dropdown
                value={form.adicion1Id}
                options={adicionOptions}
                onChange={(e) => setField("adicion1Id", e.value)}
                placeholder="Sin adición"
                className="w-full sm:w-15rem"
                filter
                showClear
                disabled={isReadOnly}
              />
            </div>
            {form.adicion1Id && (
              <div className="flex flex-column">
                {fieldLabel("Reemplazo (%)")}
                <InputNumber
                  value={form.adicion1Pct}
                  onValueChange={(e) => setField("adicion1Pct", e.value)}
                  min={0}
                  max={60}
                  suffix=" %"
                  className="w-full sm:w-8rem"
                  disabled={isReadOnly}
                />
              </div>
            )}
            <div className="flex flex-column">
              {fieldLabel("Adición 2")}
              <Dropdown
                value={form.adicion2Id}
                options={adicionOptions}
                onChange={(e) => setField("adicion2Id", e.value)}
                placeholder="Sin adición"
                className="w-full sm:w-15rem"
                filter
                showClear
                disabled={isReadOnly}
              />
            </div>
            {form.adicion2Id && (
              <div className="flex flex-column">
                {fieldLabel("Reemplazo (%)")}
                <InputNumber
                  value={form.adicion2Pct}
                  onValueChange={(e) => setField("adicion2Pct", e.value)}
                  min={0}
                  max={60}
                  suffix=" %"
                  className="w-full sm:w-8rem"
                  disabled={isReadOnly}
                />
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════
            SECTION 5 — Aditivos
           ═══════════════════════════════════ */}
        <div className="form-card br-15 p-3 mt-3">
          <h3 className="mt-0 mb-2">
            <i className="fa-solid fa-flask-vial mr-2 text-primary" />
            Aditivos
          </h3>
          {/* Issue 3 (sesión 2026-05-27): banner no bloqueante que muestra la
              recomendación del motor cuando diverge de la elección manual.
              El motor de cálculo NUNCA pisa la selección del usuario; este
              alert solo INFORMA y ofrece "Aplicar recomendación" con un click. */}
          <AditivoDivergenciaAlert
            recomendacion={aditivosRecomendadosUltimoCalculo}
            aditivosForm={[
              { id: form.aditivo1Id, dosis: form.aditivo1Dosis },
              { id: form.aditivo2Id, dosis: form.aditivo2Dosis },
              { id: form.aditivo3Id, dosis: form.aditivo3Dosis },
            ]}
            aditivosCatalogo={aditivos}
            esHRDC={esHRDC}
            onAplicar={(slotIdx, recomendado) => {
              const n = slotIdx + 1;
              setField(`aditivo${n}Id`, recomendado.idAditivo);
              if (recomendado.dosis != null) setField(`aditivo${n}Dosis`, recomendado.dosis);
              if (recomendado.modoEfecto) setField(`aditivo${n}Modo`, recomendado.modoEfecto);
            }}
          />
          {/* Aditivo principal */}
          <div className="grid">
            <div className="col-12">
              {fieldLabel("Aditivo principal")}
              <Dropdown
                value={form.aditivo1Id}
                options={aditivoOptions}
                onChange={(e) => setField("aditivo1Id", e.value)}
                placeholder="Sin aditivo"
                className="w-full"
                filter
                showClear
                disabled={isReadOnly}
                tooltip={aditivoOptions.find(a => a.value === form.aditivo1Id)?.label}
                tooltipOptions={{ position: "top", showDelay: 400 }}
              />
            </div>
            {form.aditivo1Id && (
              <>
                <div className="col-12">
                  {(() => {
                const ad = aditivos.find(a => a.idAditivo === form.aditivo1Id);
                return ad ? (
                  <small className="block mt-1 text-color-secondary">
                    <i className="fa-solid fa-flask mr-1" />
                    {ad.funcion || 'Sin efecto definido'}
                    {ad.dosisMinima != null && ad.dosisMaxima != null && ` | Dosis: ${ad.dosisMinima}–${ad.dosisMaxima}%`}
                    {ad.dosisHabitual != null && ` (hab. ${ad.dosisHabitual}%)`}
                    {ad.reduccionAguaPctEsperada != null && ad.reduccionAguaPctEsperada > 0 && ` | Reducci\u00F3n agua: ${ad.reduccionAguaPctEsperada}%`}
                  </small>
                ) : null;
              })()}
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Dosis")}
                  <InputNumber
                    value={form.aditivo1Dosis}
                    onValueChange={(e) => setField("aditivo1Dosis", e.value)}
                    min={0}
                    max={20}
                    minFractionDigits={2}
                    maxFractionDigits={2}
                    className="w-full mt-auto"
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Efecto")}
                  <Dropdown
                    value={form.aditivo1Modo}
                    options={MODO_EFECTO_GROUPED}
                    optionLabel="label"
                    optionValue="value"
                    optionGroupLabel="label"
                    optionGroupChildren="items"
                    onChange={(e) => setField("aditivo1Modo", e.value)}
                    placeholder="Seleccionar"
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Etapa")}
                  <Dropdown
                    value={form.aditivo1Etapa || "PLANTA"}
                    options={[{ label: "Planta", value: "PLANTA" }, { label: "Obra", value: "OBRA" }]}
                    onChange={(e) => {
                      setField("aditivo1Etapa", e.value);
                      if (e.value === "OBRA" && form.aditivo1Modo === "AHORRO_AGUA") setField("aditivo1Modo", null);
                    }}
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12">
                  {EFECTOS_INFORMATIVOS.has(form.aditivo1Modo) && (
                    <small className="text-color-secondary mt-1 block">
                      <i className="pi pi-info-circle mr-1" />Informativo — no modifica el cálculo
                    </small>
                  )}
                  {form.aditivo1Etapa === "OBRA" && form.aditivo1Modo === "AHORRO_AGUA" && (
                    <small className="text-red-500 mt-1 block">Un aditivo en obra no puede reducir agua.</small>
                  )}
                  <div className="flex align-items-center gap-2 mt-2">
                    <Checkbox
                      inputId="correccion1"
                      checked={!!form.aditivo1EsCorreccion}
                      onChange={(e) => setField("aditivo1EsCorreccion", e.checked)}
                      disabled={isReadOnly}
                    />
                    <label htmlFor="correccion1" className="text-sm cursor-pointer" title="Dosis de corrección: uso variable en obra. No se incluye en el cálculo volumétrico.">
                      Dosis de corrección <small className="text-color-secondary">(no entra al volumen)</small>
                    </label>
                  </div>
                </div>
                {form.aditivo1Modo === "OTRO" && (
                  <div className="col-12">
                    <InputText
                      value={form.aditivo1OtroDesc}
                      onChange={(e) => setField("aditivo1OtroDesc", e.target.value)}
                      placeholder="Descripción del efecto (obligatorio)"
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {/* Aditivo secundario */}
          <div className="grid">
            <div className="col-12">
              {fieldLabel("Aditivo secundario")}
              <Dropdown
                value={form.aditivo2Id}
                options={aditivoOptions}
                onChange={(e) => setField("aditivo2Id", e.value)}
                placeholder="Sin aditivo"
                className="w-full"
                filter
                showClear
                disabled={isReadOnly}
                tooltip={aditivoOptions.find(a => a.value === form.aditivo2Id)?.label}
                tooltipOptions={{ position: "top", showDelay: 400 }}
              />
            </div>
            {form.aditivo2Id && (
              <>
                <div className="col-12">
                  {(() => {
                const ad = aditivos.find(a => a.idAditivo === form.aditivo2Id);
                return ad ? (
                  <small className="block mt-1 text-color-secondary">
                    <i className="fa-solid fa-flask mr-1" />
                    {ad.funcion || 'Sin efecto definido'}
                    {ad.dosisMinima != null && ad.dosisMaxima != null && ` | Dosis: ${ad.dosisMinima}–${ad.dosisMaxima}%`}
                    {ad.dosisHabitual != null && ` (hab. ${ad.dosisHabitual}%)`}
                    {ad.reduccionAguaPctEsperada != null && ad.reduccionAguaPctEsperada > 0 && ` | Reducci\u00F3n agua: ${ad.reduccionAguaPctEsperada}%`}
                  </small>
                ) : null;
              })()}
                  {form.aditivo2Id && <small className="block mt-1 text-orange-400"><i className="fa-solid fa-triangle-exclamation mr-1" />Informativo — no modifica el c&aacute;lculo</small>}
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Dosis")}
                  <InputNumber
                    value={form.aditivo2Dosis}
                    onValueChange={(e) => setField("aditivo2Dosis", e.value)}
                    min={0}
                    max={20}
                    minFractionDigits={2}
                    maxFractionDigits={2}
                    className="w-full mt-auto"
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Efecto")}
                  <Dropdown
                    value={form.aditivo2Modo}
                    options={MODO_EFECTO_GROUPED}
                    optionLabel="label"
                    optionValue="value"
                    optionGroupLabel="label"
                    optionGroupChildren="items"
                    onChange={(e) => setField("aditivo2Modo", e.value)}
                    placeholder="Seleccionar"
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Etapa")}
                  <Dropdown
                    value={form.aditivo2Etapa || "PLANTA"}
                    options={[{ label: "Planta", value: "PLANTA" }, { label: "Obra", value: "OBRA" }]}
                    onChange={(e) => {
                      setField("aditivo2Etapa", e.value);
                      if (e.value === "OBRA" && form.aditivo2Modo === "AHORRO_AGUA") setField("aditivo2Modo", null);
                    }}
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12">
                  {EFECTOS_INFORMATIVOS.has(form.aditivo2Modo) && (
                    <small className="text-color-secondary mt-1 block">
                      <i className="pi pi-info-circle mr-1" />Informativo — no modifica el cálculo
                    </small>
                  )}
                  {form.aditivo2Etapa === "OBRA" && form.aditivo2Modo === "AHORRO_AGUA" && (
                    <small className="text-red-500 mt-1 block">Un aditivo en obra no puede reducir agua.</small>
                  )}
                  <div className="flex align-items-center gap-2 mt-2">
                    <Checkbox
                      inputId="correccion2"
                      checked={!!form.aditivo2EsCorreccion}
                      onChange={(e) => setField("aditivo2EsCorreccion", e.checked)}
                      disabled={isReadOnly}
                    />
                    <label htmlFor="correccion2" className="text-sm cursor-pointer" title="Dosis de corrección: uso variable en obra. No se incluye en el cálculo volumétrico.">
                      Dosis de corrección <small className="text-color-secondary">(no entra al volumen)</small>
                    </label>
                  </div>
                </div>
                {form.aditivo2Modo === "OTRO" && (
                  <div className="col-12">
                    <InputText
                      value={form.aditivo2OtroDesc}
                      onChange={(e) => setField("aditivo2OtroDesc", e.target.value)}
                      placeholder="Descripción del efecto (obligatorio)"
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {/* Aditivo terciario */}
          <div className="grid">
            <div className="col-12">
              {fieldLabel("Aditivo terciario")}
              <Dropdown
                value={form.aditivo3Id}
                options={aditivoOptions}
                onChange={(e) => setField("aditivo3Id", e.value)}
                placeholder="Sin aditivo"
                className="w-full"
                filter
                showClear
                disabled={isReadOnly}
                tooltip={aditivoOptions.find(a => a.value === form.aditivo3Id)?.label}
                tooltipOptions={{ position: "top", showDelay: 400 }}
              />
            </div>
            {form.aditivo3Id && (
              <>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Dosis")}
                  <InputNumber
                    value={form.aditivo3Dosis}
                    onValueChange={(e) => setField("aditivo3Dosis", e.value)}
                    min={0}
                    max={20}
                    minFractionDigits={2}
                    maxFractionDigits={2}
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Efecto")}
                  <Dropdown
                    value={form.aditivo3Modo}
                    options={MODO_EFECTO_GROUPED}
                    optionLabel="label"
                    optionValue="value"
                    optionGroupLabel="label"
                    optionGroupChildren="items"
                    onChange={(e) => setField("aditivo3Modo", e.value)}
                    placeholder="Seleccionar"
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12 sm:col-4 flex flex-column">
                  {fieldLabel("Etapa")}
                  <Dropdown
                    value={form.aditivo3Etapa || "PLANTA"}
                    options={[{ label: "Planta", value: "PLANTA" }, { label: "Obra", value: "OBRA" }]}
                    onChange={(e) => {
                      setField("aditivo3Etapa", e.value);
                      if (e.value === "OBRA" && form.aditivo3Modo === "AHORRO_AGUA") setField("aditivo3Modo", null);
                    }}
                    className="w-full mt-auto"
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-12">
                  {EFECTOS_INFORMATIVOS.has(form.aditivo3Modo) && (
                    <small className="text-color-secondary mt-1 block">
                      <i className="pi pi-info-circle mr-1" />Informativo — no modifica el cálculo
                    </small>
                  )}
                  {form.aditivo3Etapa === "OBRA" && form.aditivo3Modo === "AHORRO_AGUA" && (
                    <small className="text-red-500 mt-1 block">Un aditivo en obra no puede reducir agua.</small>
                  )}
                  <div className="flex align-items-center gap-2 mt-2">
                    <Checkbox
                      inputId="correccion3"
                      checked={!!form.aditivo3EsCorreccion}
                      onChange={(e) => setField("aditivo3EsCorreccion", e.checked)}
                      disabled={isReadOnly}
                    />
                    <label htmlFor="correccion3" className="text-sm cursor-pointer" title="Dosis de corrección: uso variable en obra. No se incluye en el cálculo volumétrico.">
                      Dosis de corrección <small className="text-color-secondary">(no entra al volumen)</small>
                    </label>
                  </div>
                </div>
                {form.aditivo3Modo === "OTRO" && (
                  <div className="col-12">
                    <InputText
                      value={form.aditivo3OtroDesc}
                      onChange={(e) => setField("aditivo3OtroDesc", e.target.value)}
                      placeholder="Descripción del efecto (obligatorio)"
                      className="w-full"
                      disabled={isReadOnly}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          {aditivoDuplicado && (
            <div className="mt-2">
              <Message
                severity="info"
                text="El mismo producto aparece en más de un slot. El motor consolida la dosis para calcular el aire colateral una sola vez (P1.2). Verificá que sea intencional — por ejemplo, dosis dividida entre planta y obra."
                className="w-full"
              />
            </div>
          )}

          {/* ── Fibras: macrofibra estructural + microfibra polimérica ── */}
          <div className="grid mt-3">
            <div className="col-12">
              <h5 className="mt-0 mb-2 text-sm text-primary">
                <i className="fa-solid fa-grip-lines mr-2" />Fibras (opcional)
              </h5>
            </div>
            <div className="col-12 sm:col-8 lg:col-4">
              {fieldLabel("Macrofibra estructural (catálogo)")}
              <Dropdown
                value={form.idMacrofibra}
                options={macrofibraOptions}
                onChange={(e) => {
                  const opt = macrofibraOptions.find(o => o.value === e.value);
                  setField("idMacrofibra", e.value || null);
                  setField("nombreMacrofibra", opt?.nombre || null);
                }}
                placeholder={macrofibraOptions.length ? "Seleccionar macrofibra" : "Sin macrofibras cargadas en catálogo"}
                className="w-full"
                filter showClear
                disabled={isReadOnly || !macrofibraOptions.length}
                emptyMessage="Cargá fibras tipo MACRO en el catálogo"
              />
            </div>
            <div className="col-12 sm:col-4 lg:col-2">
              {fieldLabel("Dosis (kg/m³)")}
              <InputNumber
                value={form.dosisMacrofibraKgM3}
                onValueChange={(e) => setField("dosisMacrofibraKgM3", e.value)}
                min={0} max={100}
                minFractionDigits={2} maxFractionDigits={3}
                className="w-full"
                inputClassName="w-full"
                disabled={isReadOnly || !form.idMacrofibra}
              />
            </div>
            <div className="col-12 sm:col-8 lg:col-4">
              {fieldLabel("Microfibra (catálogo)")}
              <Dropdown
                value={form.idMicrofibra}
                options={microfibraOptions}
                onChange={(e) => {
                  const opt = microfibraOptions.find(o => o.value === e.value);
                  setField("idMicrofibra", e.value || null);
                  setField("nombreMicrofibra", opt?.nombre || null);
                }}
                placeholder={microfibraOptions.length ? "Seleccionar microfibra" : "Sin microfibras cargadas"}
                className="w-full"
                filter showClear
                disabled={isReadOnly || !microfibraOptions.length}
                emptyMessage="Cargá fibras tipo MICRO en el catálogo"
              />
            </div>
            <div className="col-12 sm:col-4 lg:col-2">
              {fieldLabel("Dosis (kg/m³)")}
              <InputNumber
                value={form.dosisMicrofibraKgM3}
                onValueChange={(e) => setField("dosisMicrofibraKgM3", e.value)}
                min={0} max={10}
                minFractionDigits={2} maxFractionDigits={3}
                className="w-full"
                inputClassName="w-full"
                disabled={isReadOnly || !form.idMicrofibra}
              />
            </div>
          </div>
        </div>

        </fieldset>

        {/* ═══════════════════════════════════
            ACTIONS
           ═══════════════════════════════════ */}
        <div className="flex gap-2 mt-3 align-items-center flex-wrap">
          {/* Editable actions (solo BORRADOR) */}
          {isEditable && (
            <>
              <Button
                label="Calcular dosificación"
                icon="pi pi-calculator"
                onClick={handleCalc}
                disabled={!canCalc || calculating}
                loading={calculating}
                className="p-button-primary"
              />
              <span
                className="save-btn-wrapper"
                data-pr-tooltip={!resultado ? "Primero debe calcular la dosificación" : undefined}
                data-pr-position="top"
              >
                <Button
                  label="Guardar diseño"
                  icon="pi pi-save"
                  onClick={openSaveDialog}
                  disabled={!canSave || saving}
                  loading={saving}
                  className="p-button-outlined"
                />
              </span>
              {!resultado && <Tooltip target=".save-btn-wrapper" />}
            </>
          )}

          {/* PDF always available if there's a resultado */}
          <Button
            label="Exportar PDF"
            icon="fa-solid fa-file-pdf"
            onClick={openDraftPdfDialog}
            disabled={!resultado}
            className="p-button-outlined p-button-secondary"
          />

          {/* BORRADOR actions */}
          {isEditable && loadedEstado === 'BORRADOR' && (
            <>
              <Button
                label="Limpiar"
                icon="pi pi-eraser"
                onClick={handleReset}
                className="p-button-secondary p-button-text"
              />
              {loadedDosif && resultado && (
                <>
                  {/* Camino con revisión externa: para equipos con separación
                      de roles (creador ≠ revisor ≠ aprobador). */}
                  <Button
                    label="Enviar a revisión"
                    icon="fa-solid fa-paper-plane"
                    className="p-button-outlined"
                    style={{ color: 'var(--orange-600)', borderColor: 'var(--orange-600)' }}
                    tooltip="Asigna un revisor externo (otro usuario con rol Responsable de Calidad, Director Técnico o Admin) que valide tu diseño antes de pasar a prueba. Recomendado en equipos con separación de roles."
                    tooltipOptions={{ position: 'top', showDelay: 200 }}
                    onClick={() => {
                      setRevisionObservaciones("");
                      setRevisionPastonRefId(null);
                      setRevisionDialogVisible(true);
                    }}
                  />
                  {/* Camino directo: para equipos chicos donde la misma
                      persona crea, prueba y aprueba. El paso a producción
                      sigue requiriendo rol Responsable/Admin (control vía
                      rol, no vía separación de personas). */}
                  <Button
                    label="Enviar a prueba (sin revisión)"
                    icon="fa-solid fa-flask"
                    severity="warning"
                    className="p-button-outlined"
                    tooltip="Salta la revisión externa y va directo a prueba. Útil en equipos chicos donde una sola persona crea, prueba y aprueba. Requiere que vos (o quien apruebe luego) tenga rol Responsable de Calidad o Admin para pasar a producción."
                    tooltipOptions={{ position: 'top', showDelay: 200 }}
                    onClick={handleEnviarAPrueba}
                  />
                  {/* Pase directo a producción SIN fase de prueba. Sólo visible
                      para roles que pueden aprobar. Reutiliza el flujo de
                      override (PASTON_REQUERIDO → modal de firma + justificación
                      ≥50 chars). Caso de uso: dosificaciones ya en uso antes
                      del sistema, que no necesitan repetir el pastón. Queda
                      registrado en la trazabilidad con hash + flag
                      `salteoPruebaCompleto`. */}
                  {puedeAprobarTransiciones && (
                    <Button
                      label="Aprobar directo a producción (sin prueba)"
                      icon="fa-solid fa-circle-check"
                      severity="danger"
                      className="p-button-outlined"
                      tooltip="Salta TODA la fase de prueba y pasa directo a producción. Sólo para dosificaciones ya validadas/en uso antes del sistema. Requiere tu firma con rol autorizado y una justificación (mín. 50 caracteres) que queda en la trazabilidad."
                      tooltipOptions={{ position: 'top', showDelay: 200 }}
                      onClick={async () => {
                        try {
                          const res = await transicionarConOverride(
                            loadedDosif.id,
                            { nuevoEstado: 'EN_PRODUCCION', usuario: user?.nombre },
                            async () => {
                              showToast.current?.show({ severity: 'success', summary: 'En producción', detail: 'Diseño pasado a producción directamente (sin prueba)' });
                              const row = await getDosificacion(loadedDosif.id);
                              setLoadedDosif(row);
                            },
                          );
                          if (res === null) return; // dialog de override abierto
                        } catch (err) {
                          showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo pasar a producción' });
                        }
                      }}
                    />
                  )}
                </>
              )}
              {loadedDosif && puedeAprobarTransiciones && (
                <Button
                  label="Archivar"
                  icon="fa-solid fa-archive"
                  severity="secondary"
                  className="p-button-outlined"
                  onClick={async () => {
                    const motivo = await askValue({ title: 'Archivar diseno', label: 'Motivo de archivo' });
                    if (!motivo) return;
                    if (accionRef.current) return;
                    accionRef.current = true;
                    try {
                      await transicionarEstado(loadedDosif.id, { nuevoEstado: 'ARCHIVADO', usuario: user?.nombre, motivo });
                      showToast.current?.show({ severity: 'info', summary: 'Archivado', detail: 'Diseño archivado' });
                      const row = await getDosificacion(loadedDosif.id);
                      setLoadedDosif(row);
                    } catch (err) {
                      showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo archivar' });
                    } finally {
                      accionRef.current = false;
                    }
                  }}
                />
              )}
              {/* Hint contextual según rol del usuario actual: ayuda a entender
                  qué camino le conviene a quien crea la dosificación. */}
              {loadedDosif && resultado && (
                <small className="text-color-secondary" style={{ flex: '1 0 100%', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  <i className="fa-solid fa-circle-info mr-1" />
                  {puedeAprobarTransiciones
                    ? 'Tu rol te permite aprobar el pase a producción. Si querés, podés saltar la revisión externa con "Enviar a prueba (sin revisión)" y aprobar vos mismo cuando esté listo el pastón.'
                    : 'Tu rol no te permite aprobar el pase a producción. Tenés que enviar a revisión a un Responsable de Calidad / Director Técnico / Admin, que será quien apruebe luego.'}
                </small>
              )}
            </>
          )}

          {/* A_PRUEBA actions → movidos al tab Prueba */}

          {/* PENDIENTE_REVISION actions (reviewer) — PR7: solo el revisor
              asignado o un ADMIN ven los botones. Si otro usuario está
              mirando la dosif en este estado, queda en read-only y se le
              muestra el mensaje "esperando revisión de [nombre]". */}
          {loadedEstado === 'PENDIENTE_REVISION' && loadedDosif && (() => {
            const revisorAsignado = loadedDosif.revisorAsignado || null;
            const usernameActual = user?.username || user?.nombre || null;
            const esRevisor = revisorAsignado && usernameActual && revisorAsignado === usernameActual;
            const esAdmin = (user?.roles || []).some((r) => (typeof r === 'string' ? r : r?.nombreRol) === 'ADMIN') || user?.isAdmin === true;
            if (!esRevisor && !esAdmin) {
              return (
                <Tag
                  severity="warning"
                  icon="fa-solid fa-clock"
                  value={`Esperando revisión de ${revisorAsignado || 'revisor no asignado'}`}
                />
              );
            }
            return null;
          })()}
          {loadedEstado === 'PENDIENTE_REVISION' && loadedDosif && (() => {
            const revisorAsignado = loadedDosif.revisorAsignado || null;
            const usernameActual = user?.username || user?.nombre || null;
            const esRevisor = revisorAsignado && usernameActual && revisorAsignado === usernameActual;
            const esAdmin = (user?.roles || []).some((r) => (typeof r === 'string' ? r : r?.nombreRol) === 'ADMIN') || user?.isAdmin === true;
            return (esRevisor || esAdmin);
          })() && (
            <>
              <Button
                label="Aprobar para prueba"
                icon="fa-solid fa-flask"
                severity="success"
                className="p-button-outlined"
                onClick={async () => {
                  try {
                    const res = await transicionarConOverride(
                      loadedDosif.id,
                      { nuevoEstado: 'A_PRUEBA', usuario: user?.nombre },
                      async () => {
                        showToast.current?.show({ severity: 'success', summary: 'A prueba', detail: 'Revisión aprobada, diseño enviado a prueba' });
                        const row = await getDosificacion(loadedDosif.id);
                        setLoadedDosif(row);
                      },
                    );
                    if (res === null) return;
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo aprobar' });
                  }
                }}
              />
              <Button
                label="Aprobar para producción"
                icon="fa-solid fa-circle-check"
                severity="success"
                tooltip="Aprobar directo a producción saltando la fase de prueba. Requiere pastón aprobado u override firmado."
                tooltipOptions={{ position: 'top', showDelay: 200 }}
                onClick={async () => {
                  try {
                    const res = await transicionarConOverride(
                      loadedDosif.id,
                      { nuevoEstado: 'EN_PRODUCCION', usuario: user?.nombre },
                      async () => {
                        showToast.current?.show({ severity: 'success', summary: 'En producción', detail: 'Revisión aprobada, diseño pasado a producción directamente' });
                        const row = await getDosificacion(loadedDosif.id);
                        setLoadedDosif(row);
                      },
                    );
                    if (res === null) return;
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'No se pudo aprobar a producción' });
                  }
                }}
              />
              <Button
                label="Rechazar (a borrador)"
                icon="fa-solid fa-times"
                severity="danger"
                className="p-button-outlined"
                onClick={async () => {
                  const motivo = await askValue({ title: 'Rechazar diseno', label: 'Observaciones del rechazo' });
                  if (motivo === null) return;
                  if (accionRef.current) return;
                  accionRef.current = true;
                  try {
                    await transicionarEstado(loadedDosif.id, { nuevoEstado: 'BORRADOR', usuario: user?.nombre, observaciones: motivo || 'Rechazado en revisión' });
                    showToast.current?.show({ severity: 'warn', summary: 'Rechazado', detail: 'Diseño devuelto a borrador' });
                    const row = await getDosificacion(loadedDosif.id);
                    setLoadedDosif(row);
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                  } finally {
                    accionRef.current = false;
                  }
                }}
              />
            </>
          )}

          {/* EN_PRODUCCION / APROBADO actions — solo Responsable+ */}
          {(loadedEstado === 'EN_PRODUCCION' || loadedEstado === 'APROBADO') && loadedDosif && puedeAprobarTransiciones && (
            <>
              <Button
                label="Suspender"
                icon="fa-solid fa-pause"
                severity="danger"
                className="p-button-outlined"
                onClick={async () => {
                  const motivo = await askValue({ title: 'Suspender diseno', label: 'Motivo de suspension' });
                  if (!motivo) return;
                  if (accionRef.current) return;
                  accionRef.current = true;
                  try {
                    await transicionarEstado(loadedDosif.id, { nuevoEstado: 'SUSPENDIDO', usuario: user?.nombre, motivo });
                    showToast.current?.show({ severity: 'warn', summary: 'Suspendido', detail: 'Diseño suspendido' });
                    const row = await getDosificacion(loadedDosif.id);
                    setLoadedDosif(row);
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                  } finally {
                    accionRef.current = false;
                  }
                }}
              />
              <Button
                label="Archivar"
                icon="fa-solid fa-archive"
                severity="secondary"
                className="p-button-outlined"
                onClick={async () => {
                  const motivo = await askValue({ title: 'Archivar diseno', label: 'Motivo de archivo' });
                  if (!motivo) return;
                  if (accionRef.current) return;
                  accionRef.current = true;
                  try {
                    await transicionarEstado(loadedDosif.id, { nuevoEstado: 'ARCHIVADO', usuario: user?.nombre, motivo });
                    showToast.current?.show({ severity: 'info', summary: 'Archivado', detail: 'Diseño archivado' });
                    const row = await getDosificacion(loadedDosif.id);
                    setLoadedDosif(row);
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                  } finally {
                    accionRef.current = false;
                  }
                }}
              />
            </>
          )}

          {/* SUSPENDIDO actions — solo Responsable+ */}
          {loadedEstado === 'SUSPENDIDO' && loadedDosif && puedeAprobarTransiciones && (
            <>
              <Button
                label="Reactivar"
                icon="fa-solid fa-play"
                severity="success"
                className="p-button-outlined"
                onClick={async () => {
                  try {
                    const res = await transicionarConOverride(
                      loadedDosif.id,
                      { nuevoEstado: 'EN_PRODUCCION', usuario: user?.nombre },
                      async () => {
                        showToast.current?.show({ severity: 'success', summary: 'Reactivado', detail: 'Diseño reactivado en producción' });
                        const row = await getDosificacion(loadedDosif.id);
                        setLoadedDosif(row);
                      },
                    );
                    if (res === null) return;
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                  }
                }}
              />
              <Button
                label="Archivar"
                icon="fa-solid fa-archive"
                severity="secondary"
                className="p-button-outlined"
                onClick={async () => {
                  const motivo = await askValue({ title: 'Archivar diseno', label: 'Motivo de archivo' });
                  if (!motivo) return;
                  if (accionRef.current) return;
                  accionRef.current = true;
                  try {
                    await transicionarEstado(loadedDosif.id, { nuevoEstado: 'ARCHIVADO', usuario: user?.nombre, motivo });
                    showToast.current?.show({ severity: 'info', summary: 'Archivado', detail: 'Diseño archivado' });
                    const row = await getDosificacion(loadedDosif.id);
                    setLoadedDosif(row);
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                  } finally {
                    accionRef.current = false;
                  }
                }}
              />
            </>
          )}
        </div>

        <div className="surface-ground border-round p-3 mt-3">
          <div className="flex flex-wrap gap-4 align-items-center mb-2">
            <div className="flex align-items-center gap-2">
              <span className="text-sm text-color-secondary">Cálculo</span>
              <Tag severity={statusSeverity(calcStatus.status)} value={statusLabel(calcStatus.status)} />
            </div>
            <div className="flex align-items-center gap-2">
              <span className="text-sm text-color-secondary">Guardado</span>
              <Tag severity={statusSeverity(saveStatus.status)} value={statusLabel(saveStatus.status)} />
            </div>
          </div>
          {calcStatus.message && (
            <Message
              severity={calcStatus.status === "error" ? "error" : "success"}
              text={calcStatus.message}
              className="w-full mb-2"
              pt={calcStatus.status !== "error" ? {
                root: { style: { backgroundColor: "var(--green-50)", borderColor: "var(--green-200)" } },
                wrapper: { style: { color: "var(--green-900)" } },
                icon: { style: { color: "var(--green-900)" } },
                text: { style: { color: "var(--green-900)", fontWeight: 600 } },
              } : {
                root: { style: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' } },
                icon: { style: { color: 'var(--red-500)' } },
                text: { style: { color: 'var(--red-300)', fontWeight: 600 } },
              }}
            />
          )}
          {saveStatus.message && (
            <Message
              severity={saveStatus.status === "error" ? "error" : "success"}
              text={saveStatus.message}
              className="w-full"
              pt={saveStatus.status !== "error" ? {
                root: { style: { backgroundColor: "var(--green-50)", borderColor: "var(--green-200)" } },
                wrapper: { style: { color: "var(--green-900)" } },
                icon: { style: { color: "var(--green-900)" } },
                text: { style: { color: "var(--green-900)", fontWeight: 600 } },
              } : {
                // Mismo tratamiento de contraste que el error de cálculo: el
                // default de PrimeReact dejaba texto claro sobre rosa claro
                // (ilegible). Tokens temáticos → contraste correcto dark/light.
                root: { style: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' } },
                icon: { style: { color: 'var(--red-500)' } },
                text: { style: { color: 'var(--red-300)', fontWeight: 600 } },
              }}
            />
          )}
          {calcStatus.details?.length > 0 && !esDetailYaIncluidoEnMensaje(calcStatus) && (
            <div className="mt-2 text-sm text-color-secondary">
              {calcStatus.details.map((detail, index) => (
                <div key={`calc-detail-${index}`}>• {formatDetailLine(detail)}</div>
              ))}
            </div>
          )}
          {saveStatus.details?.length > 0 && !esDetailYaIncluidoEnMensaje(saveStatus) && (
            <div className="mt-2 text-sm text-color-secondary">
              {saveStatus.details.map((detail, index) => (
                <div key={`save-detail-${index}`}>• {formatDetailLine(detail)}</div>
              ))}
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════
            ERRORS & WARNINGS PANEL
           ═══════════════════════════════════ */}
        {(calcErrors.length > 0 || warnings.length > 0) && (() => {
          // Sesión 2026-05-29: evitamos duplicar el mensaje del header
          // (`calcStatus.message`) en el panel de errores cuando es el mismo
          // texto. Bug visual: dos banners idénticos rojo y rosa claro.
          const headerMsg = calcStatus?.status === 'error' ? (calcStatus.message || '') : '';
          const dedupedErrors = calcErrors.filter((e) => (e?.msg || '').trim() !== headerMsg.trim());
          if (dedupedErrors.length === 0 && warnings.length === 0) return null;

          // pt defensivo con contraste correcto por severity. El default de
          // PrimeReact en dark mode renderiza texto pastel sobre fondos
          // pastel → ilegible. Forzamos colores que cumplen WCAG en ambos
          // temas (los tokens var(--*-300/500) ya resuelven a colores
          // saturados que destacan sobre fondo semi-transparente al 15%).
          const ptBySeverity = {
            error: {
              root: { style: { backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.4)' } },
              icon: { style: { color: 'var(--red-500)' } },
              text: { style: { color: 'var(--red-300)', fontWeight: 600 } },
            },
            warn: {
              root: { style: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.4)' } },
              icon: { style: { color: 'var(--yellow-500)' } },
              text: { style: { color: 'var(--yellow-300)', fontWeight: 600 } },
            },
            info: {
              root: { style: { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.4)' } },
              icon: { style: { color: 'var(--blue-500)' } },
              text: { style: { color: 'var(--blue-300)', fontWeight: 600 } },
            },
          };

          // Sesión 2026-05-29: agrupar por gravedad y ordenar de mayor a
          // menor. Los errores arriba, después warnings, después info. Dentro
          // de cada grupo se mantiene el orden de aparición original.
          const ORDEN_SEVERIDAD = { error: 0, warn: 1, info: 2 };
          const items = [
            ...dedupedErrors.map((e) => ({ severity: 'error', text: e.msg, key: `err-${e.campo || ''}-${e.msg}` })),
            ...warnings.map((w) => ({
              severity: warningsSeverity(w),
              text: `${w.campo ? `[${w.campo}] ` : ''}${w.msg}`,
              key: `warn-${w.campo || ''}-${w.msg}`,
            })),
          ].sort((a, b) => (ORDEN_SEVERIDAD[a.severity] ?? 99) - (ORDEN_SEVERIDAD[b.severity] ?? 99));

          return (
            <div className="mt-3 flex flex-column gap-2">
              {items.map((it) => (
                <Message
                  key={it.key}
                  severity={it.severity}
                  text={it.text}
                  className="w-full"
                  pt={ptBySeverity[it.severity] || ptBySeverity.info}
                />
              ))}
            </div>
          );
        })()}

        {/* ═══════════════════════════════════
            SECTION 6 — Resultado
           ═══════════════════════════════════ */}
        {resultado && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            {/* P0.5 — Banner de resultado obsoleto cuando hay correcciones no recalculadas */}
            {loadedDosif?.resultadoStale && (
              <div className="mb-3 p-3 border-round" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', borderLeft: '4px solid #dc2626' }}>
                <div className="flex align-items-center gap-2 mb-1">
                  <i className="fa-solid fa-triangle-exclamation text-red-500" />
                  <strong className="text-red-500">Resultado obsoleto</strong>
                </div>
                <div className="text-sm">
                  Se aplicaron correcciones que cambiaron los inputs del cálculo, pero el resultado mostrado todavía corresponde
                  a los valores anteriores. Para emitir PDFs o cambiar de estado, recalculá la dosificación con los valores actuales.
                </div>
              </div>
            )}
            <div className="flex align-items-center justify-content-between mb-3">
              <h3 className="mt-0 mb-0">
                <i className="fa-solid fa-clipboard-check mr-2 text-green-500" />
                Resultado del cálculo
              </h3>
              <Button
                label="Ver trazabilidad"
                icon="pi pi-eye"
                className="p-button-text p-button-sm"
                onClick={() => setTraceVisible(true)}
              />
            </div>

            {/* Summary cards */}
            <div className="grid">
              {resultado.fcm != null && (
                <div className="col-12 md:col-6 lg:col-3">
                  <div className="surface-ground border-round p-3 text-center">
                    <div className="text-sm text-color-secondary">f'cm</div>
                    <div className="text-2xl font-bold text-orange-500">{resultado.fcm}</div>
                    <div className="text-xs text-color-secondary">MPa</div>
                  </div>
                </div>
              )}
              <div className="col-12 md:col-6 lg:col-3">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-sm text-color-secondary">Agua</div>
                  <div className="text-2xl font-bold text-primary">{resultado.aguaLtsM3}</div>
                  <div className="text-xs text-color-secondary">lts/m³</div>
                </div>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-sm text-color-secondary">Relación a/c</div>
                  <div className="text-2xl font-bold text-primary">{resultado.ac != null ? Number(resultado.ac).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
                  <div className="text-xs text-color-secondary">&nbsp;</div>
                </div>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-sm text-color-secondary">Cemento total</div>
                  <div className="text-2xl font-bold text-primary">{resultado.cementoTotalKgM3}</div>
                  <div className="text-xs text-color-secondary">kg/m³</div>
                </div>
              </div>
              <div className="col-12 md:col-6 lg:col-3">
                <div className="surface-ground border-round p-3 text-center">
                  <div className="text-sm text-color-secondary">Aire total</div>
                  <div className="text-2xl font-bold text-primary">{resultado.airePct != null ? Number(resultado.airePct).toFixed(1) : '—'}%</div>
                  <div className="text-xs text-color-secondary">
                    {resultado.tipoAire === 'INTENCIONAL'
                      ? `${resultado.aireAtrapado != null ? Number(resultado.aireAtrapado).toFixed(1) : '—'}% atrap. + ${resultado.aireIncorporado != null ? Number(resultado.aireIncorporado).toFixed(1) : '—'}% incorp.`
                      : 'atrapado'}
                  </div>
                </div>
              </div>
            </div>

            {/* β factor and verification ages */}
            {trazabilidad?.factorEdad && (
              <div className="surface-card border-round border-1 border-300 p-3 mt-3">
                <div className="flex align-items-center gap-2 mb-2">
                  <i className="fa-solid fa-clock text-orange-500" />
                  <span className="font-bold text-sm">Diseño a {trazabilidad.factorEdad.edadDiseno} días — Factor de edad β = {trazabilidad.factorEdad.beta}</span>
                </div>
                <div className="text-sm text-color-secondary mb-2">
                  {trazabilidad.factorEdad.formula}
                </div>
                <div className="flex gap-3">
                  <div className="surface-ground border-round p-2 text-center">
                    <div className="text-xs text-color-secondary">f'cm({trazabilidad.factorEdad.edadDiseno}d)</div>
                    <div className="text-lg font-bold text-orange-500">{trazabilidad.factorEdad.fcmEdadDiseno} MPa</div>
                  </div>
                  <div className="surface-ground border-round p-2 text-center">
                    <div className="text-xs text-color-secondary">f'cm(28d equiv.)</div>
                    <div className="text-lg font-bold text-primary">{trazabilidad.factorEdad.fcm28Equiv} MPa</div>
                  </div>
                </div>
              </div>
            )}

            {trazabilidad?.edadesVerificacion?.length > 0 && (
              <div className="mt-3">
                <div className="flex align-items-center gap-2 mb-2">
                  <i className="fa-solid fa-list-check text-blue-500" />
                  <span className="font-bold text-sm">Resistencias esperadas por edad</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trazabilidad.edadesVerificacion.map((ev) => (
                    <div
                      key={ev.edadDias}
                      className={`border-round p-2 text-center ${
                        ev.edadDias === (form.edadDias || 28)
                          ? 'surface-ground border-2 border-primary'
                          : 'surface-ground border-1 border-300'
                      }`}
                      style={{ minWidth: '5rem' }}
                    >
                      <div className="text-xs text-color-secondary">{ev.edadDias}d (β={ev.factor})</div>
                      <div className={`font-bold ${ev.edadDias === (form.edadDias || 28) ? 'text-primary' : 'text-900'}`}>
                        {ev.resistenciaEsperada} MPa
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Air verification (Tabla 4.3) — C5 canónico */}
            {trazabilidad?.verificacionAire && (() => {
              const cat = categoriaDeBoolean(trazabilidad.verificacionAire.cumple);
              const cfg = CATEGORIA_COLORS[cat];
              const borderClass = trazabilidad.verificacionAire.cumple === false ? 'border-red-400'
                : trazabilidad.verificacionAire.cumple === true ? 'border-green-400'
                : 'border-orange-400';
              const iconColorClass = trazabilidad.verificacionAire.cumple === false ? 'text-red-500'
                : trazabilidad.verificacionAire.cumple === true ? 'text-green-500'
                : 'text-orange-500';
              return (
              <div className={`surface-card border-round border-1 p-3 mt-3 ${borderClass}`}>
                <div className="flex align-items-center gap-2 mb-2">
                  <i className={`fa-solid fa-snowflake ${iconColorClass}`} />
                  <span className="font-bold text-sm">
                    Aire incorporado — Tabla 4.3 (Clase {trazabilidad.verificacionAire.clase}, TMN {trazabilidad.verificacionAire.tmnMm} mm)
                  </span>
                  <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <span>Requerido: <strong>{Number(trazabilidad.verificacionAire.aireRequeridoEfectivo).toFixed(1)}%</strong> ± {Number(trazabilidad.verificacionAire.tolerancia).toFixed(1)}%</span>
                  {trazabilidad.verificacionAire.aireActual != null && (
                    <span>Actual: <strong>{Number(trazabilidad.verificacionAire.aireActual).toFixed(1)}%</strong></span>
                  )}
                  {trazabilidad.verificacionAire.excepcionH35 && (
                    <Tag severity="info" value="Reducción H-35 aplicada" className="text-xs" />
                  )}
                </div>
              </div>
              );
            })()}

            {/* Pulverulent material verification (Tabla 4.4).
                Bug DOS-6UCPY6-K72: usa la trazabilidad re-derivada para que la
                card on-screen muestre el veredicto POST-ajuste de cemento,
                igual que el PDF. */}
            {trazabilidadVista?.verificacionPulverulento && (() => {
              const vp = trazabilidadVista.verificacionPulverulento;
              const cat = categoriaDeBoolean(vp.cumple);
              const cfg = CATEGORIA_COLORS[cat];
              const borderClass = vp.cumple ? 'border-green-400' : 'border-red-400';
              const iconColorClass = vp.cumple ? 'text-green-500' : 'text-red-500';
              return (
              <div className={`surface-card border-round border-1 p-3 mt-3 ${borderClass}`}>
                <div className="flex align-items-center gap-2 mb-2">
                  <i className={`fa-solid fa-mortar-pestle ${iconColorClass}`} />
                  <span className="font-bold text-sm">
                    Material pulverulento — Tabla 4.4 (TMN {vp.tmnMm} mm)
                  </span>
                  <Tag value={cat} severity={cfg.severity} icon={cfg.icon} />
                  {vp.excepcionH20 && (
                    <Tag severity="info" value="Excepción ≤ H-20" className="ml-1" />
                  )}
                </div>
                <div className="flex flex-wrap gap-3 text-sm">
                  <span>Mínimo: <strong>{vp.minimoKgM3} kg/m³</strong></span>
                  <span>Estimado: <strong>{vp.totalPulverulento} kg/m³</strong></span>
                  <span className="text-color-secondary text-xs">
                    (Cemento: {vp.cementoPulv}
                    {vp.adicionesPulv > 0 ? ` + Adiciones: ${vp.adicionesPulv}` : ''}
                    {vp.finosAgregadoPulv > 0 ? ` + Finos < 300 \u00B5m: ${vp.finosAgregadoPulv}` : ''})
                  </span>
                </div>
                {vp.finosDetalle?.length > 0 && (
                  <div className="text-xs text-color-secondary mt-1 ml-3">
                    {vp.finosDetalle.map((d, i) => (
                      <span key={i} className="mr-3">{d.nombre}: {d.aporteKg} kg ({d.kgM3} × {d.p300Pct?.toFixed(1)}%)</span>
                    ))}
                  </div>
                )}
              </div>
              );
            })()}

            {/* Detail breakdown */}
            <div className="mt-3">
              <DataTable responsiveLayout="scroll"
                value={buildResultRows(resultado)}
                size="small"
                stripedRows
                className="text-sm"
              >
                <Column field="componente" header="Componente" />
                <Column field="cantidad" header="Cantidad" style={{ width: "120px" }} />
                <Column field="unidad" header="Unidad" style={{ width: "100px" }} />
              </DataTable>
            </div>

            {/* Volumen pasta check */}
            {resultado.volumenPasta != null && (
              <div className="mt-2 text-sm text-color-secondary">
                Volumen de pasta estimado: <strong>{(resultado.volumenPasta * 1000).toFixed(0)} lts/m³</strong>
                {resultado.volumenPasta > 0.45 && (
                  <Tag severity="warning" value="Pasta alta" className="ml-2" />
                )}
                {trazabilidad?.volumenesAbsolutos?.volFibras > 0 && (
                  <span className="ml-3">
                    Volumen de fibras: <strong>{(trazabilidad.volumenesAbsolutos.volFibras * 1000).toFixed(2)} lts/m³</strong>
                  </span>
                )}
                {resultado.volumenAgregados != null && (
                  <span className="ml-3">
                    Volumen de agregados: <strong>{(resultado.volumenAgregados * 1000).toFixed(0)} lts/m³</strong>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        </>
        )}

        {/* ═══════════════════════════════════
            TAB: Prueba — Pastón + Redosificaciones
            (visible en BORRADOR siempre, o en tab 'prueba')
           ═══════════════════════════════════ */}
        {(!showTabs || activeTab === 'prueba') && (
        <>

        {/* ═══════════════════════════════════
            Pastón de prueba (laboratorio)
           ═══════════════════════════════════ */}
        {resultado && (() => {
          const PASTON_ESTADOS = ['A_PRUEBA', 'PENDIENTE_REVISION', 'APROBADO', 'EN_PRODUCCION', 'SUSPENDIDO'];
          // Sólo cuando el pastón realmente se puede guardar (dosif persistida
          // y en un estado >= A_PRUEBA). Antes se mostraba con `!loadedDosif`,
          // lo que dejaba la sección visible pero con "Guardar pastón"
          // deshabilitado en diseños sin guardar — confuso para el usuario.
          const pastonHabilitado = !!loadedDosif && PASTON_ESTADOS.includes(loadedEstado);
          if (pastonHabilitado) {
            return (
              <PastonPruebaSection
                resultado={resultado}
                loadedDosif={loadedDosif}
                showToast={showToast}
                user={user}
                logoUrl={cfg?.thumbnail}
                empresa={cfg?.nombreEmpresa}
                contexto={{
                  cementoLabel: cementosById[form.cementoId]?.nombreComercial || "Cemento",
                  adiciones: [
                    form.adicion1Id ? { label: adicionesById[form.adicion1Id]?.nombre || "Adición 1" } : null,
                    form.adicion2Id ? { label: adicionesById[form.adicion2Id]?.nombre || "Adición 2" } : null,
                  ].filter(Boolean),
                  /* `incrementoAsentamientoEsperado` y `reduccionAguaPctEsperada`
                     vienen de la ficha técnica del aditivo (modelo Aditivo).
                     El PDF los usa para comparar el efecto observado en el
                     pastón contra el efecto declarado por el fabricante. */
                  aditivos: [
                    form.aditivo1Id ? {
                      label: aditivosById[form.aditivo1Id]?.marca || "Aditivo 1",
                      unidadDosis: aditivosById[form.aditivo1Id]?.unidadDosificacion || null,
                      incrementoAsentamientoEsperado: aditivosById[form.aditivo1Id]?.incrementoAsentamientoEsperado != null
                        ? Number(aditivosById[form.aditivo1Id].incrementoAsentamientoEsperado) : null,
                      reduccionAguaPctEsperada: aditivosById[form.aditivo1Id]?.reduccionAguaPctEsperada != null
                        ? Number(aditivosById[form.aditivo1Id].reduccionAguaPctEsperada) : null,
                      modoEfectoSugerido: aditivosById[form.aditivo1Id]?.modoEfectoSugerido || null,
                    } : null,
                    form.aditivo2Id ? {
                      label: aditivosById[form.aditivo2Id]?.marca || "Aditivo 2",
                      unidadDosis: aditivosById[form.aditivo2Id]?.unidadDosificacion || null,
                      incrementoAsentamientoEsperado: aditivosById[form.aditivo2Id]?.incrementoAsentamientoEsperado != null
                        ? Number(aditivosById[form.aditivo2Id].incrementoAsentamientoEsperado) : null,
                      reduccionAguaPctEsperada: aditivosById[form.aditivo2Id]?.reduccionAguaPctEsperada != null
                        ? Number(aditivosById[form.aditivo2Id].reduccionAguaPctEsperada) : null,
                      modoEfectoSugerido: aditivosById[form.aditivo2Id]?.modoEfectoSugerido || null,
                    } : null,
                    form.aditivo3Id ? {
                      label: aditivosById[form.aditivo3Id]?.marca || "Aditivo 3",
                      unidadDosis: aditivosById[form.aditivo3Id]?.unidadDosificacion || null,
                      incrementoAsentamientoEsperado: aditivosById[form.aditivo3Id]?.incrementoAsentamientoEsperado != null
                        ? Number(aditivosById[form.aditivo3Id].incrementoAsentamientoEsperado) : null,
                      reduccionAguaPctEsperada: aditivosById[form.aditivo3Id]?.reduccionAguaPctEsperada != null
                        ? Number(aditivosById[form.aditivo3Id].reduccionAguaPctEsperada) : null,
                      modoEfectoSugerido: aditivosById[form.aditivo3Id]?.modoEfectoSugerido || null,
                    } : null,
                  ].filter(Boolean),
                }}
              />
            );
          }
          const enBorradorGuardado = loadedDosif && loadedEstado === 'BORRADOR';
          return (
            <div className="card mt-3">
              <div className="flex align-items-center gap-2">
                <i className="fa-solid fa-flask-vial text-color-secondary" />
                <span className="font-bold text-color-secondary">Pastón de prueba</span>
                <Tag severity="warning" value="Aún no disponible" className="ml-2" />
              </div>
              {!loadedDosif ? (
                <p className="text-sm text-color-secondary mt-2 mb-0">
                  Guardá el diseño para poder enviarlo a prueba y registrar el pastón.
                </p>
              ) : enBorradorGuardado ? (
                <>
                  <p className="text-sm text-color-secondary mt-2 mb-3">
                    El pastón de prueba se registra una vez que el diseño está <strong>a prueba</strong>.
                    Podés enviarlo directamente desde acá, sin pasar por el catálogo.
                  </p>
                  {isEditable && (
                    <Button
                      label="Enviar a prueba (sin revisión)"
                      icon="fa-solid fa-flask"
                      severity="warning"
                      className="p-button-outlined"
                      tooltip="Pasa el diseño a estado «A prueba» y habilita el registro del pastón. Equivale al botón del pie del diseño."
                      tooltipOptions={{ position: 'top', showDelay: 200 }}
                      onClick={handleEnviarAPrueba}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-color-secondary mt-2 mb-0">
                  El pastón de prueba no está disponible en el estado actual del diseño.
                </p>
              )}
            </div>
          );
        })()}

        {/* Acciones de agregado de materiales — sección histórica para
            EN_PRODUCCION / APROBADO. Durante A_PRUEBA las acciones se cargan
            dentro del Timeline del pastón (sesión 2026-06-12) para que cada
            agregado quede vinculado a la medición que lo motivó y al remanente
            del camión en ese momento. Mostrar la sección aparte sólo cuando
            el diseño ya está en producción (acciones de obra reales sobre
            despachos, no sobre el pastón). */}
        {(loadedDosif?.idDosificacionDisenada || loadedDosif?.id) && ['EN_PRODUCCION', 'APROBADO', 'SUSPENDIDO'].includes(loadedEstado) && (
          <div className="card mt-3">
            <h3 className="mt-0 mb-2">
              <i className="fa-solid fa-syringe mr-2 text-primary" />
              Acciones de agregado de materiales en obra
            </h3>
            <RedosificacionesObraSection
              dosificacionId={loadedDosif.idDosificacionDisenada || loadedDosif.id}
              aditivosOptions={aditivos.map(a => ({
                label: `${a.nombre || a.marca || 'Aditivo'}${a.marca && a.nombre ? ` — ${a.marca}` : ''}`,
                value: a.idAditivo,
                unidadDosificacion: a.unidadDosificacion || null,
                dosisHabitual: a.dosisHabitual ?? null,
              }))}
              showToast={showToast}
            />
          </div>
        )}

        {/* Botones de acción A_PRUEBA en tab Prueba */}
        {showTabs && loadedEstado === 'A_PRUEBA' && loadedDosif && (
          <div className="flex gap-2 mt-3 align-items-center flex-wrap">
            <Button
              label={`Nueva ronda de prueba${loadedDosif.numeroRondaPrueba ? ` (N°${(loadedDosif.numeroRondaPrueba || 1) + 1})` : ''}`}
              icon="fa-solid fa-rotate-right"
              className="p-button-outlined"
              severity="info"
              tooltip="Registra una nueva ronda de prueba tras incorporar ajustes en la dosificación"
              onClick={async () => {
                const motivo = await askValue({
                  title: 'Nueva ronda de prueba',
                  label: 'Motivo / observaciones de los ajustes aplicados',
                });
                if (motivo === null) return;
                try {
                  const { enviarNuevaRondaPrueba } = await import('../../../services/dosificacionDisenoService');
                  const res = await enviarNuevaRondaPrueba(loadedDosif.id, { motivo: motivo || null });
                  showToast.current?.show({
                    severity: 'info',
                    summary: `Ronda ${res.numeroRondaPrueba}`,
                    detail: 'Nueva ronda de prueba registrada',
                  });
                  const row = await getDosificacion(loadedDosif.id);
                  setLoadedDosif(row);
                } catch (err) {
                  showToast.current?.show({
                    severity: 'error',
                    summary: 'Error',
                    detail: err.response?.data?.error || 'No se pudo iniciar nueva ronda',
                  });
                }
              }}
            />
            {puedeAprobarTransiciones && (
              <Button
                label="Aprobar para producción"
                icon="fa-solid fa-industry"
                severity="success"
                className="p-button-outlined"
                onClick={async () => {
                  try {
                    const res = await transicionarConOverride(
                      loadedDosif.id,
                      { nuevoEstado: 'EN_PRODUCCION', usuario: user?.nombre },
                      async () => {
                        showToast.current?.show({ severity: 'success', summary: 'En producción', detail: 'Diseño aprobado para producción' });
                        const row = await getDosificacion(loadedDosif.id);
                        setLoadedDosif(row);
                      },
                    );
                    if (res === null) return;
                  } catch (err) {
                    showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Requiere pastón con veredicto aprobado' });
                  }
                }}
              />
            )}
            <Button
              label="Requiere corrección"
              icon="fa-solid fa-arrow-left"
              className="p-button-outlined p-button-secondary"
              onClick={async () => {
                const motivo = await askValue({ title: 'Requiere correccion', label: 'Observaciones sobre la correccion necesaria' });
                if (motivo === null) return;
                if (accionRef.current) return;
                accionRef.current = true;
                try {
                  await transicionarEstado(loadedDosif.id, { nuevoEstado: 'BORRADOR', usuario: user?.nombre, motivo: motivo || 'Requiere corrección tras prueba' });
                  showToast.current?.show({ severity: 'info', summary: 'Borrador', detail: 'Diseño devuelto para corrección' });
                  const row = await getDosificacion(loadedDosif.id);
                  setLoadedDosif(row);
                } catch (err) {
                  showToast.current?.show({ severity: 'error', summary: 'Error', detail: err.response?.data?.error || 'Error' });
                } finally {
                  accionRef.current = false;
                }
              }}
            />
            <Button
              label="Exportar PDF"
              icon="fa-solid fa-file-pdf"
              onClick={openDraftPdfDialog}
              disabled={!resultado}
              className="p-button-outlined p-button-secondary"
            />
          </div>
        )}

        </>
        )}

        {/* ═══════════════════════════════════
            Secciones compartidas: Costos, Receta, Aptitud, Predicción, Trabajabilidad
            (visible en diseño completo, resumen, o producción)
           ═══════════════════════════════════ */}
        {(!showTabs || activeTab === 'diseno' || activeTab === 'resumen' || activeTab === 'produccion') && (
        <>

        {/* ═══════════════════════════════════
            Costos por m³ (FUNC-02)
           ═══════════════════════════════════ */}
        {resultado && (
          <div className="card mt-3">
            <CostosSection
              resultado={resultado}
              contexto={{
                cementoId: form.cementoId,
                cementoLabel: cementosById[form.cementoId]?.nombreComercial || "Cemento",
                adiciones: [
                  form.adicion1Id ? { sourceId: form.adicion1Id, label: adicionesById[form.adicion1Id]?.nombre || "Adición 1" } : null,
                  form.adicion2Id ? { sourceId: form.adicion2Id, label: adicionesById[form.adicion2Id]?.nombre || "Adición 2" } : null,
                ].filter(Boolean),
                aditivos: [
                  form.aditivo1Id ? { sourceId: form.aditivo1Id, label: aditivosById[form.aditivo1Id]?.marca || "Aditivo 1" } : null,
                  form.aditivo2Id ? { sourceId: form.aditivo2Id, label: aditivosById[form.aditivo2Id]?.marca || "Aditivo 2" } : null,
                  form.aditivo3Id ? { sourceId: form.aditivo3Id, label: aditivosById[form.aditivo3Id]?.marca || "Aditivo 3" } : null,
                ].filter(Boolean),
              }}
            />
          </div>
        )}

        {/* ═══════════════════════════════════
            Corrección por humedad — Receta de obra
            (solo en diseño completo o producción — no durante prueba)
           ═══════════════════════════════════ */}
        {(!showTabs || activeTab === 'diseno' || activeTab === 'produccion') && (
          <RecetaObraSection
            resultado={resultado}
            loadedDosif={loadedDosif}
            showToast={showToast}
            user={user}
            nombreDosif={form.nombre}
            plantaLabel={plantas.find((p) => p.idPlanta === form.idPlanta)?.nombre}
            logoUrl={cfg?.thumbnail}
            empresa={cfg?.nombreEmpresa}
            onHumedadesChange={setHumedadAgregados}
          />
        )}

        {/* ═══════════════════════════════════
            SECTION 6.7 — Evaluación de trabajabilidad (Shilstone + Ken Day)
           ═══════════════════════════════════ */}
        {/* Panel de logística (retención de asentamiento) */}
        {trazabilidad?.logistica && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            <h3 className="mt-0 mb-3">
              <i className="fa-solid fa-truck mr-2 text-primary" />
              {"Retención de asentamiento"}
            </h3>
            <div className="grid">
              <div className="col-6 md:col-3">
                <small className="text-color-secondary block">Asentamiento obra</small>
                <span className="text-xl font-bold">{trazabilidad.logistica.asentamientoObra} cm</span>
              </div>
              <div className="col-6 md:col-3">
                <small className="text-color-secondary block">Asentamiento planta</small>
                <span className="text-xl font-bold text-primary">{trazabilidad.logistica.asentamientoPlanta} cm</span>
              </div>
              <div className="col-6 md:col-3">
                <small className="text-color-secondary block">{"Pérdida estimada"}</small>
                <span className="text-xl font-bold">{trazabilidad.logistica.perdida?.perdidaCm} cm</span>
              </div>
              <div className="col-6 md:col-3">
                <small className="text-color-secondary block">Ventana</small>
                <span className="text-xl font-bold">{trazabilidad.logistica.ventana?.minutosMaximos} min</span>
              </div>
            </div>
            {trazabilidad.logistica.curva && (
              <div className="mt-3 surface-ground border-round p-2">
                <small className="font-bold text-color-secondary">Curva de asentamiento estimada</small>
                <div className="flex gap-3 flex-wrap mt-1 text-xs">
                  {trazabilidad.logistica.curva.map((p, i) => (
                    <span key={i} className={p.asentamientoCm < trazabilidad.logistica.asentamientoObra ? 'text-red-400' : ''}>
                      {p.minutos}min: <strong>{p.asentamientoCm} cm</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {trazabilidad.logistica.redosificacion?.necesaria && (
              <div className="mt-2 p-2 border-round border-left-3 border-yellow-500" style={{backgroundColor: 'rgba(245,158,11,0.1)'}}>
                <small><i className="fa-solid fa-syringe mr-1" />{trazabilidad.logistica.redosificacion.mensaje}</small>
              </div>
            )}
          </div>
        )}

        {resultado?.trabajabilidad && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            <h3 className="mt-0 mb-3">
              <i className="fa-solid fa-hands-holding mr-2 text-primary" />
              Evaluacion de trabajabilidad
            </h3>
            <div className="grid">
              {/* Shilstone */}
              <div className="col-12 md:col-6">
                <div className="surface-ground border-round p-3 h-full">
                  <strong className="text-sm block mb-2"><i className="fa-solid fa-chart-scatter mr-1" /> Grafico de Shilstone (1990)</strong>
                  <div className="grid">
                    <div className="col-12 md:col-6">
                      <small className="text-color-secondary block">Factor de Grosor (FdG)</small>
                      <span className="text-xl font-bold">{resultado.trabajabilidad.fdg != null ? resultado.trabajabilidad.fdg.toFixed(1) : '—'} %</span>
                    </div>
                    <div className="col-12 md:col-6">
                      <small className="text-color-secondary block">Factor de Trabajabilidad (FdT)</small>
                      <span className="text-xl font-bold">{resultado.trabajabilidad.fdt != null ? resultado.trabajabilidad.fdt.toFixed(1) : '—'} %</span>
                    </div>
                  </div>
                  {resultado.trabajabilidad.zonaShilstone && (
                    <div className="mt-2 p-2 border-round" style={{
                      backgroundColor: resultado.trabajabilidad.zonaShilstone === 'II' || resultado.trabajabilidad.zonaShilstone === 'III' ? 'rgba(34,197,94,0.1)' :
                        resultado.trabajabilidad.zonaShilstone === 'V' || resultado.trabajabilidad.zonaShilstone === 'I' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                      borderLeft: `3px solid ${resultado.trabajabilidad.zonaShilstone === 'II' || resultado.trabajabilidad.zonaShilstone === 'III' ? '#22c55e' :
                        resultado.trabajabilidad.zonaShilstone === 'V' || resultado.trabajabilidad.zonaShilstone === 'I' ? '#ef4444' : '#f59e0b'}`
                    }}>
                      <strong>Zona {resultado.trabajabilidad.zonaShilstone}</strong>
                      <span className="text-sm ml-2">{resultado.trabajabilidad.zonaShilstoneNombre}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* Ken Day */}
              <div className="col-12 md:col-6">
                <div className="surface-ground border-round p-3 h-full">
                  <strong className="text-sm block mb-2"><i className="fa-solid fa-gauge-high mr-1" /> Factor de Aptitud (Ken Day)</strong>
                  <div className="grid">
                    <div className="col-12 md:col-6">
                      <small className="text-color-secondary block">Superficie Especifica (SE)</small>
                      <span className="text-xl font-bold">{resultado.trabajabilidad.se != null ? resultado.trabajabilidad.se.toFixed(1) : '—'}</span>
                    </div>
                    <div className="col-12 md:col-6">
                      <small className="text-color-secondary block">Factor de Aptitud (FdA)</small>
                      <span className="text-xl font-bold">{resultado.trabajabilidad.fda != null ? resultado.trabajabilidad.fda.toFixed(1) : '—'}</span>
                    </div>
                  </div>
                  {resultado.trabajabilidad.fdaInterpretacion && (
                    <div className="mt-2 p-2 border-round surface-100">
                      <small className="text-color-secondary block">Uso recomendado:</small>
                      <span className="text-sm">{resultado.trabajabilidad.fdaInterpretacion}</span>
                      {resultado.trabajabilidad.fdaConoEstimado && (
                        <span className="text-sm ml-2 text-color-secondary">(Cono: {resultado.trabajabilidad.fdaConoEstimado})</span>
                      )}
                    </div>
                  )}
                  {resultado.trabajabilidad.coherencia && (
                    <div className="mt-2 p-2 border-round" style={{
                      backgroundColor: resultado.trabajabilidad.coherencia === 'coherente' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                      borderLeft: `3px solid ${resultado.trabajabilidad.coherencia === 'coherente' ? '#22c55e' : '#f59e0b'}`
                    }}>
                      <small className="text-sm">
                        {resultado.trabajabilidad.coherencia === 'coherente'
                          ? 'Coherente con el asentamiento objetivo.'
                          : resultado.trabajabilidad.coherencia === 'fda_alto'
                            ? 'FdA sugiere asentamiento mayor al objetivo. Posible exceso de finos o cementante.'
                            : 'FdA sugiere asentamiento menor al objetivo. Considerar mas finos, cementante o aditivo.'}
                      </small>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <small className="text-color-secondary mt-2 block">
              Métodos: Shilstone (1990) "Concrete Mixture Optimization". Ken Day "Concrete Mix Design, Quality Control and Specification".
            </small>
          </div>
        )}

        {/* Sugerencia de optimización granulométrica */}
        {resultado?.sugerenciaGranulometrica?.length > 0 && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3" style={{borderLeft: '4px solid #f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.05)'}}>
            <h3 className="mt-0 mb-3">
              <i className="fa-solid fa-wand-magic-sparkles mr-2 text-yellow-500" />
              Sugerencia de optimización granulométrica
            </h3>
            <p className="text-sm text-color-secondary mt-0 mb-3">
              Se detectó zona {resultado.trabajabilidad?.zonaShilstone} ({resultado.trabajabilidad?.zonaShilstoneNombre}).
              El optimizador calculó alternativas con los materiales disponibles.
            </p>
            <div className="grid">
              {resultado.sugerenciaGranulometrica.map((sug, i) => (
                <div key={i} className="col-12 md:col-6">
                  <div className="surface-card border-round p-3 h-full" style={{border: i === 0 ? '2px solid #22c55e' : '1px solid var(--surface-border)'}}>
                    <div className="flex justify-content-between align-items-center mb-2">
                      <strong>{sug.etiqueta || `Alternativa ${sug.ranking}`}</strong>
                      <Tag value={`Zona ${sug.zona}`} severity={sug.zona === 'II' ? 'success' : sug.zona === 'III' ? 'success' : 'warning'} />
                    </div>
                    {sug.componentes?.map((c, j) => (
                      <div key={j} className="flex justify-content-between text-sm py-1" style={{borderBottom: '1px solid var(--surface-100)'}}>
                        <span>{c.nombre}</span>
                        <strong>{c.porcentaje}%</strong>
                      </div>
                    ))}
                    <div className="flex gap-3 mt-2 text-xs text-color-secondary">
                      <span>FdT: {sug.wf?.toFixed(1)}%</span>
                      <span>FdG: {sug.fdg?.toFixed(1)}%</span>
                      <span>MF: {sug.mf?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <small className="text-color-secondary block mt-2">
              Para aplicar, recalcular el diseño con las nuevas proporciones. Cemento, agua y a/c no cambian.
            </small>
          </div>
        )}

        </>
        )}

        {/* ═══════════════════════════════════
            SECTION 7 — Resultados de producción (FUNC-05)
            (visible en diseño completo, resumen, o producción)
           ═══════════════════════════════════ */}
        {(!showTabs || activeTab === 'produccion') && showProduccion && (
          <div className="form-card br-15 p-3 sm:p-4 mt-3">
            <h3 className="mt-0 mb-3">
              <i className="fa-solid fa-chart-line mr-2 text-primary" />
              Resultados de producción
            </h3>

            {prodLoading ? (
              <div className="flex align-items-center gap-2 text-color-secondary">
                <ProgressSpinner strokeWidth="4" style={{ width: '24px', height: 'clamp(160px, 30vh, 24px)' }} />
                <span>Cargando resultados...</span>
              </div>
            ) : prodResults && !prodResults.vinculada ? (
              /* Not linked — show link control */
              <div>
                <Message
                  severity="info"
                  className="w-full mb-3"
                  text={prodResults.mensaje}
                />
                <div className="flex align-items-end gap-3 flex-wrap">
                  <div className="flex flex-column">
                    <small className="font-bold mb-1">Dosificación del catálogo de producción</small>
                    <Dropdown
                      value={linkingCatalogo ? null : undefined}
                      options={dosifCatalogo.map(d => ({
                        label: `${d.nombre}${d.tipoHormigon?.tipoHormigon ? ` (${d.tipoHormigon.tipoHormigon})` : ''}`,
                        value: d.idDosificacion,
                      }))}
                      onChange={async (e) => {
                        if (!e.value || !loadedDosif?.id) return;
                        setLinkingCatalogo(true);
                        try {
                          await vincularCatalogo(loadedDosif.id, e.value);
                          const row = await getDosificacion(loadedDosif.id);
                          setLoadedDosif(row);
                          // Re-fetch prod results
                          const res = await obtenerResultadosProduccion(loadedDosif.id);
                          setProdResults(res);
                          showToast("success", "Dosificación vinculada correctamente");
                        } catch (err) {
                          showToast("error", err.response?.data?.error || "No se pudo vincular");
                        } finally {
                          setLinkingCatalogo(false);
                        }
                      }}
                      placeholder="Seleccionar dosificación"
                      className="w-20rem"
                      filter
                      loading={linkingCatalogo}
                      onShow={() => {
                        if (dosifCatalogo.length === 0) {
                          getDosificacionesCatalogo()
                            .then(d => setDosifCatalogo(Array.isArray(d) ? d : []))
                            .catch((err) => { console.warn('[getDosificacionesCatalogo]', err?.message || err); });
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : prodResults && prodResults.vinculada && !prodResults.kpis ? (
              /* Linked but no ensayos */
              <div>
                <div className="flex align-items-center gap-2 mb-3">
                  <Tag value="Vinculada" severity="success" icon="pi pi-link" />
                  <span className="text-sm text-color-secondary">{prodResults.nombreCatalogo || `#${prodResults.idDosificacionCatalogo}`}</span>
                </div>
                <Message severity="info" className="w-full" text={prodResults.mensaje || "Sin ensayos registrados."} />
              </div>
            ) : prodResults && prodResults.kpis ? (
              /* Has data — show KPIs + comparison */
              <div>
                <div className="flex align-items-center gap-2 mb-3">
                  <Tag value="Vinculada" severity="success" icon="pi pi-link" />
                  <span className="text-sm text-color-secondary">{prodResults.nombreCatalogo || `#${prodResults.idDosificacionCatalogo}`}</span>
                  <span className="text-sm text-color-secondary ml-2">{prodResults.kpis.n} ensayos</span>
                </div>

                {/* KPI Cards */}
                <div className="grid">
                  <div className="col-6 md:col-3 lg:col-2">
                    <div className="surface-ground border-round p-3 text-center">
                      <div className="text-xs text-color-secondary">f'cm real</div>
                      <div className="text-xl font-bold text-primary">{prodResults.kpis.fcm}</div>
                      <div className="text-xs text-color-secondary">MPa</div>
                    </div>
                  </div>
                  <div className="col-6 md:col-3 lg:col-2">
                    <div className="surface-ground border-round p-3 text-center">
                      <div className="text-xs text-color-secondary">f'ck real</div>
                      <div className={`text-xl font-bold ${prodResults.comparacion?.cumple === true ? 'text-green-500' : prodResults.comparacion?.cumple === false ? 'text-red-500' : 'text-primary'}`}>
                        {prodResults.kpis.fck}
                      </div>
                      <div className="text-xs text-color-secondary">MPa</div>
                    </div>
                  </div>
                  <div className="col-6 md:col-3 lg:col-2">
                    <div className="surface-ground border-round p-3 text-center">
                      <div className="text-xs text-color-secondary">Desvío S</div>
                      <div className="text-xl font-bold text-primary">{prodResults.kpis.desvio}</div>
                      <div className="text-xs text-color-secondary">MPa</div>
                    </div>
                  </div>
                  <div className="col-6 md:col-3 lg:col-2">
                    <div className={`surface-ground border-round p-3 text-center ${prodResults.comparacion?.alertaCv ? 'border-red-300' : ''}`} style={prodResults.comparacion?.alertaCv ? { borderLeft: '3px solid #e74c3c' } : undefined}>
                      <div className="text-xs text-color-secondary">CV</div>
                      <div className={`text-xl font-bold ${prodResults.comparacion?.alertaCv ? 'text-red-500' : 'text-primary'}`}>
                        {prodResults.kpis.cv}%
                      </div>
                      <div className="text-xs text-color-secondary">{prodResults.comparacion?.alertaCv ? 'Alto (>15%)' : ''}</div>
                    </div>
                  </div>
                  <div className="col-6 md:col-3 lg:col-2">
                    <div className="surface-ground border-round p-3 text-center">
                      <div className="text-xs text-color-secondary">Mín / Máx</div>
                      <div className="text-lg font-bold text-primary">{prodResults.kpis.min} — {prodResults.kpis.max}</div>
                      <div className="text-xs text-color-secondary">MPa</div>
                    </div>
                  </div>
                  {prodResults.comparacion?.cumple != null && (() => {
                    // C5: comparación de producto (HP) — booleano binario, no compliance canónico.
                    const cat = categoriaDeBoolean(prodResults.comparacion.cumple);
                    const cfg = CATEGORIA_COLORS[cat];
                    const borderStyle = !prodResults.comparacion.cumple
                      ? { borderLeft: '3px solid #e74c3c' }
                      : { borderLeft: '3px solid #27ae60' };
                    const borderClass = prodResults.comparacion.cumple ? '' : 'border-red-300';
                    const textColorClass = prodResults.comparacion.cumple ? 'text-green-500' : 'text-red-500';
                    return (
                    <div className="col-6 md:col-3 lg:col-2">
                      <div className={`surface-ground border-round p-3 text-center ${borderClass}`} style={borderStyle}>
                        <div className="text-xs text-color-secondary">Cumplimiento</div>
                        <div className={`text-xl font-bold ${textColorClass}`}>
                          {cat}
                        </div>
                        <div className="text-xs text-color-secondary">f'ck vs f'c={prodResults.comparacion.resistenciaDiseno}</div>
                      </div>
                    </div>
                    );
                  })()}
                </div>

                {/* Comparison table */}
                {prodResults.comparacion && (
                  <div className="mt-3">
                    <DataTable responsiveLayout="scroll"
                      value={[
                        { parametro: "f'c diseño (MPa)", diseno: prodResults.comparacion.resistenciaDiseno, real: '—' },
                        { parametro: "f'cm (MPa)", diseno: resultado?.fcm ?? '—', real: prodResults.comparacion.fcmReal },
                        { parametro: "f'ck (MPa)", diseno: prodResults.comparacion.resistenciaDiseno, real: prodResults.comparacion.fckReal },
                        { parametro: "Desvío S (MPa)", diseno: '—', real: prodResults.comparacion.desvioReal },
                        { parametro: "CV (%)", diseno: '—', real: prodResults.comparacion.cvReal },
                        { parametro: "N ensayos", diseno: '—', real: prodResults.comparacion.nEnsayos },
                      ]}
                      size="small"
                      stripedRows
                      className="text-sm"
                    >
                      <Column field="parametro" header="Parámetro" />
                      <Column field="diseno" header="Diseño" style={{ width: '120px' }} />
                      <Column field="real" header="Producción real" style={{ width: '140px' }}
                        body={(row) => {
                          const val = row.real;
                          if (val === '—' || val == null) return '—';
                          return <strong>{val}</strong>;
                        }}
                      />
                    </DataTable>
                  </div>
                )}
              </div>
            ) : (
              <Message severity="warn" className="w-full" text="No se pudieron cargar resultados." />
            )}
          </div>
        )}

        {/* ═══════════════════════════════════
            DIALOG — Trazabilidad
           ═══════════════════════════════════ */}
        <Dialog
          header="Trazabilidad del cálculo"
          visible={traceVisible}
          onHide={() => setTraceVisible(false)}
          style={{ width: "90vw", maxWidth: "900px" }}
          maximizable
        >
          {trazabilidad && (
            <DosificacionTrazabilidadView
              snapshot={activeTraceSnapshot}
              showDebug={process.env.NODE_ENV === "development"}
            />
          )}
        </Dialog>

        {/* Save dialog with optional notes */}
        <Dialog
          header="Guardar diseño"
          visible={saveDialogVisible}
          onHide={() => setSaveDialogVisible(false)}
          style={{ width: "90vw", maxWidth: "28rem" }}
          footer={
            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" icon="pi pi-times" className="p-button-text" onClick={() => setSaveDialogVisible(false)} />
              <Button label="Guardar sin notas" icon="pi pi-save" className="p-button-outlined" onClick={() => handleSave(null)} loading={saving} disabled={saving} />
              <Button label="Guardar" icon="pi pi-save" onClick={() => handleSave(saveNotes)} loading={saving} disabled={!saveNotes.trim() || saving} />
            </div>
          }
        >
          <div className="flex flex-column gap-2">
            <label htmlFor="save-notes" className="font-medium text-sm">Notas del cambio (opcional):</label>
            <InputTextarea
              id="save-notes"
              value={saveNotes}
              onChange={(e) => setSaveNotes(e.target.value)}
              rows={3}
              autoResize
              placeholder="Ej: Ajusté la a/c de pliego según nuevo pliego cliente"
              className="w-full"
            />
            <small className="text-color-secondary">
              Estas notas quedan registradas en el historial de trazabilidad del diseño.
            </small>
          </div>
        </Dialog>

        {/* Historial timeline dialog */}
        <Dialog
          header={`Historial — ${loadedDosif?.nombre || 'Diseño'}`}
          visible={historialVisible}
          onHide={() => setHistorialVisible(false)}
          style={{ width: "90vw", maxWidth: "36rem" }}
          maximizable
        >
          {historialLoading ? (
            <div className="flex justify-content-center p-4">
              <ProgressSpinner style={{ width: "40px", height: "clamp(160px, 30vh, 40px)" }} />
            </div>
          ) : (
            <DisenoHistorialTimeline
              historial={historialData}
              resumen={historialResumen}
              dosifLabel={loadedDosif?.codigo || `dosif-${loadedDosif?.id || ''}`}
            />
          )}
        </Dialog>

        {/* ── Enviar a revisión — summary dialog ── */}
        <Dialog
          header="Enviar a revisión — Resumen"
          visible={revisionDialogVisible}
          onHide={() => setRevisionDialogVisible(false)}
          style={{ width: "90vw", maxWidth: "44rem" }}
          footer={
            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" className="p-button-text" onClick={() => setRevisionDialogVisible(false)} />
              <Button
                label="Enviar a revisión"
                icon="fa-solid fa-paper-plane"
                style={{ backgroundColor: 'var(--orange-600)', borderColor: 'var(--orange-600)' }}
                disabled={!revisionRevisor}
                onClick={async () => {
                  if (!revisionRevisor) {
                    showToast('warn', 'Asigná un revisor antes de enviar.');
                    return;
                  }
                  if (accionRef.current) return;
                  accionRef.current = true;
                  try {
                    await transicionarEstado(loadedDosif.id, {
                      nuevoEstado: 'PENDIENTE_REVISION',
                      usuario: user?.name,
                      observaciones: revisionObservaciones || null,
                      metadata: {
                        pastonReferenciaId: revisionPastonRefId || null,
                        observacionesRevision: revisionObservaciones || null,
                        revisorAsignado: revisionRevisor || null,
                      },
                    });
                    showToast('success', 'Diseño enviado a revisión');
                    const row = await getDosificacion(loadedDosif.id);
                    setLoadedDosif(row);
                    setRevisionDialogVisible(false);
                  } catch (err) {
                    const msg = err.response?.data?.error || err.message || 'No se pudo enviar';
                    showToast('error', msg);
                  } finally {
                    accionRef.current = false;
                  }
                }}
              />
            </div>
          }
        >
          <div className="mb-3">
            <label className="font-bold text-sm block mb-1">Asignar revisor <span className="text-red-500">*</span></label>
            {/* PR7 — Dropdown de usuarios reales con rol RESPONSABLE_CALIDAD,
                DIRECTOR_TECNICO o ADMIN, en vez del InputText libre anterior.
                Sesión 2026-05-29: el creador SÍ aparece en la lista (puede
                asignarse como su propio revisor en plantas chicas). Se marca
                con sufijo "· vos (auto-aprobación)" para identificarlo.
                Ver politicaRevision.js — el sistema marca, no bloquea. */}
            <Dropdown
              value={revisionRevisor}
              onChange={(e) => setRevisionRevisor(e.value)}
              options={(revisoresDisponibles || [])
                .map((r) => {
                  // Mostramos el rol del sistema del revisor (derivado de los
                  // flags + rolCalidad post-refactor 2026-05-20) para distinguir
                  // visualmente quién puede aprobar qué nivel.
                  const rolPrincipal = getRolPrincipal(r);
                  const rolLabel = rolPrincipal ? ROL_LABEL[rolPrincipal] : null;
                  const creador = loadedDosif?.creadoPor || loadedDosif?.usuarioCreador;
                  const esCreador = creador && r.username === creador;
                  // Sesión 2026-05-29: el creador puede asignarse como su
                  // propio revisor (auto-aprobación, ver politicaRevision.js).
                  // Lo mostramos con sufijo "(vos — auto-aprobación)" para que
                  // el usuario lo identifique rápido sin tener que recordar
                  // su username.
                  const sufijoRol = rolLabel ? ` — ${rolLabel}` : '';
                  const sufijoCreador = esCreador ? ' · vos (auto-aprobación)' : '';
                  return {
                    label: `${r.displayName || r.username}${sufijoRol}${sufijoCreador}`,
                    value: r.username,
                  };
                })
              }
              placeholder={revisoresLoading
                ? "Cargando revisores..."
                : ((revisoresDisponibles || []).length === 0
                  ? "No hay usuarios con rol suficiente cargados en el sistema"
                  : "Seleccione un revisor")
              }
              filter
              showClear
              disabled={revisoresLoading}
              className="w-full"
            />
            <small className="text-color-secondary">Solo se listan usuarios con rol Responsable de Calidad, Director Técnico o Admin. Si te asignás como tu propio revisor, el sistema lo registra como auto-aprobación en el historial de la dosificación.</small>
          </div>
          <RevisionSummaryContent
            loadedDosif={loadedDosif}
            resultado={resultado}
            observaciones={revisionObservaciones}
            onObservacionesChange={setRevisionObservaciones}
            pastonRefId={revisionPastonRefId}
            onPastonRefChange={setRevisionPastonRefId}
          />
        </Dialog>

        <PdfSectionSelector
          tipo="DOSIFICACION"
          visible={pdfDialogVisible}
          onHide={() => setPdfDialogVisible(false)}
          onConfirm={handleExportPdf}
          defaultTitulo={currentPdfTitle}
          // HRDC y Alivianado están fuera de CIRSOC/IRAM → sólo modo
          // DESCRIPTIVO (no ofrecer "Normativo / Cumplimiento estricto").
          // Detección con fallback al método de cálculo del resultado por si
          // la dosificación se rehidrató sin `form.tipologiaCodigo` correcto.
          soloPrestacional={
            esHRDC
            || esAlivianado
            || resultado?.trazabilidad?.metodoCalculo === 'HRDC'
            || resultado?.trazabilidad?.metodoCalculo === 'ALIVIANADO'
            || String(resultado?.metodoCalculo || '').toUpperCase() === 'HRDC'
            || String(resultado?.metodoCalculo || '').toUpperCase() === 'ALIVIANADO'
          }
        />

        {/* K.3 — Dialog de override CIRSOC §3.2.3.2 f) */}
        <OverrideRequestDialog
          visible={overrideDialog.visible}
          onHide={() => setOverrideDialog({ visible: false, context: null, retry: null })}
          context={overrideDialog.context}
          rolUsuario={rolPrincipal}
          onSuccess={() => {
            showToast('success', 'Override firmado. Re-intentando la acción...');
            const retry = overrideDialog.retry;
            setOverrideDialog({ visible: false, context: null, retry: null });
            if (typeof retry === 'function') {
              Promise.resolve().then(retry).catch((err) => {
                console.error('[override retry]', err);
              });
            }
          }}
        />

        {/* Fase 3 — Dialog de override de pastón aprobado.
             Se abre cuando el backend devuelve 422 con code=PASTON_REQUERIDO.
             El callback firma el override y hace retry de la transición. */}
        <OverridePastonDialog
          visible={overridePastonDialog.visible}
          onHide={() => setOverridePastonDialog({ visible: false, motivoError: null, onConfirm: null })}
          motivoError={overridePastonDialog.motivoError}
          userActual={user}
          onConfirm={async (firma) => {
            if (typeof overridePastonDialog.onConfirm === 'function') {
              await overridePastonDialog.onConfirm(firma);
            }
          }}
        />

        {/* Issue 2 (sesión 2026-05-27) — Editor de proporciones sobre la
            mezcla YA seleccionada (no sobre una sugerencia). Al confirmar
            llama al endpoint /dosificacion-diseno/:id/mezcla/proporciones que
            decide inplace vs fork automáticamente y devuelve el idMezcla
            (nuevo si forkeó). */}
        <EditorProporcionesModal
          visible={!!editorMezclaEnUso}
          onHide={() => setEditorMezclaEnUso(null)}
          sugerencia={editorMezclaEnUso}
          parametros={editorParametros}
          modoEdicion="mezcla"
          onConfirm={async (solucionAjustada) => {
            const idDosi = loadedDosif?.id;
            const idMezclaActual = form.mezclaId;
            if (!idMezclaActual) {
              showToast('warn', 'Seleccioná primero una mezcla del catálogo.');
              return;
            }
            try {
              const proporciones = (solucionAjustada.componentes || []).map((c) => ({
                idAgregado: c.id,
                porcentajeFinal: Number(c.porcentaje) || 0,
              }));
              // Cuando la dosi está guardada (BORRADOR) usamos el endpoint
              // dosi-aware: cuenta dosis "OTRAS" (excluye la actual) para
              // decidir si la mezcla es exclusiva de esta dosi. Cuando la
              // dosi todavía no fue guardada, usamos la variante sin-dosi
              // que cuenta todas las dosis activas y nunca reapunta
              // automáticamente — el setField('mezclaId', …) lo hace el
              // frontend con el id que devuelva el backend.
              const {
                modificarProporcionesMezcla,
                modificarProporcionesMezclaPorId,
                getMezclas,
                getMezcla,
              } = await import("../../../services/dosificacionDisenoService");
              const r = idDosi
                ? await modificarProporcionesMezcla(idDosi, proporciones)
                : await modificarProporcionesMezclaPorId(idMezclaActual, proporciones);
              // Refrescar lista de mezclas y reapuntar si forkeó.
              try {
                const m = await getMezclas(form.idPlanta);
                setMezclas(Array.isArray(m) ? m : []);
              } catch {}
              if (r.modo === 'fork' && r.idMezcla && r.idMezcla !== form.mezclaId) {
                setField('mezclaId', r.idMezcla);
                showToast('success', `Se creó la nueva versión "${r.mezcla?.nombre || 'mezcla modificada'}" porque la mezcla anterior era usada por otras dosificaciones.`);
              } else {
                // Inplace: la mezcla cambió en BD pero `form.mezclaId` sigue
                // siendo el mismo → el useEffect que rehidrata
                // `selectedMezclaDetail` no se dispara y el frontend mostraría
                // (y enviaría al motor) las proporciones viejas cacheadas.
                // Forzamos el refresh del detalle inmediatamente.
                try {
                  const fresh = await getMezcla(idMezclaActual);
                  if (fresh) setSelectedMezclaDetail(fresh);
                } catch (refreshErr) {
                  console.warn('[modificarProporcionesMezcla] no se pudo refrescar el detalle de mezcla:', refreshErr);
                }
                showToast('success', 'Proporciones actualizadas.');
              }
              // Invalidar resultado: la curva cambió.
              setResultado(null);
              setTrazabilidad(null);
              setMezclaCambioDesdeUltimoCalculo(true);
              setEditorMezclaEnUso(null);
            } catch (e) {
              console.error('[modificarProporcionesMezcla] error:', e);
              const msg = e.response?.data?.error || e.message || 'No se pudieron actualizar las proporciones.';
              showToast('error', msg);
            }
          }}
        />

        {/* Editor interactivo de proporciones sobre una sugerencia */}
        <EditorProporcionesModal
          visible={!!editorSugerencia}
          onHide={() => setEditorSugerencia(null)}
          sugerencia={editorSugerencia}
          parametros={editorParametros}
          onConfirm={(solucionAjustada) => {
            // Reemplazar la sugerencia editada en el array. El usuario sigue
            // viendo la card actualizada y puede clickear "Seleccionar" para
            // crear la mezcla ya ajustada.
            let idxAjustada = -1;
            setSugerencias(prev => {
              idxAjustada = prev.findIndex((s) => s === editorSugerencia);
              return prev.map((s, i) => (i === idxAjustada ? {
                ...s,
                ...solucionAjustada,
                // Preservar metadata de ranking / estrellas del original
                ranking: s.ranking,
                estrellas: s.estrellas,
                etiqueta: s.etiqueta ? `${s.etiqueta} (ajustada)` : 'Ajustada',
                _meta: { ...(s._meta || {}), ...(solucionAjustada._meta || {}) },
              } : s));
            });
            setEditorSugerencia(null);
            // Issue 1 — feedback visual al cerrar el editor:
            //   1) badge "MODIFICADA" + borde azul (reactivo a `etiqueta`)
            //   2) scroll suave a la card editada (espera al próximo frame
            //      porque el ref se mide después del setState/re-render)
            //   3) animación de pulso de 1.2s en la card editada
            // Sin esto el cambio era invisible y el operador podía seleccionar
            // la sugerencia equivocada (queja del usuario, sesión 2026-05-27).
            if (idxAjustada >= 0) {
              requestAnimationFrame(() => {
                const el = sugCardRefs.current[idxAjustada];
                if (el && typeof el.scrollIntoView === 'function') {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                setSugRecienAjustadaIdx(idxAjustada);
                // Limpiamos el flag de pulso después de la animación (1.4 s
                // = animación 1.2 s + margen) para que el efecto sea único.
                setTimeout(() => setSugRecienAjustadaIdx((prev) => (prev === idxAjustada ? null : prev)), 1400);
              });
            }
            showToast('success', 'Proporciones ajustadas. Revisá los indicadores y confirmá con "Seleccionar".');
          }}
        />

        {/* Generic prompt dialog (replaces native window.prompt) */}
        <Dialog
          visible={promptDialog.visible}
          onHide={handlePromptCancel}
          header={promptDialog.title}
          style={{ width: '90vw', maxWidth: '500px' }}
          modal
          closable
          dismissableMask={false}
          footer={
            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" text onClick={handlePromptCancel} />
              <Button label="Aceptar" icon="fa-solid fa-check" onClick={handlePromptAccept} />
            </div>
          }
        >
          <div className="flex flex-column gap-2 pt-2">
            <label className="text-sm font-bold">{promptDialog.label}</label>
            <InputText
              value={promptDialog.value}
              onChange={(e) => setPromptDialog(p => ({ ...p, value: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePromptAccept(); }}
              autoFocus
              className="w-full"
            />
          </div>
        </Dialog>

        {/* Fase 2 — confirmación informativa de auto-aprobación.
             No bloquea: el usuario puede continuar con un click. La acción
             queda registrada en la auditoría sin necesidad de justificación
             extra (el sistema sirve para empresas chicas donde una persona
             cubre todo el ciclo). */}
        <Dialog
          visible={autoAprobDialog.visible}
          onHide={handleAutoAprobCancel}
          header={autoAprobDialog.titulo}
          style={{ width: '90vw', maxWidth: '560px' }}
          modal
          closable
          dismissableMask={false}
          footer={
            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" text onClick={handleAutoAprobCancel} />
              <Button label="Continuar" icon="fa-solid fa-arrow-right" severity="warning" onClick={handleAutoAprobAccept} />
            </div>
          }
        >
          <div className="flex flex-column gap-3 pt-2">
            <div className="flex align-items-start gap-3">
              <i className="fa-solid fa-circle-exclamation" style={{ fontSize: '1.5rem', color: 'var(--yellow-500, #f59e0b)' }} />
              <p className="m-0 line-height-3" style={{ color: 'var(--text-color)' }}>
                {autoAprobDialog.descripcion}
              </p>
            </div>
            <small style={{ color: 'var(--text-color-secondary)' }}>
              Esta acción quedará registrada en el historial de auditoría con su correspondiente bandera.
            </small>
          </div>
        </Dialog>
      </div>
    </Fade>
  );
}

/* ════════════════════════════════════════
   RevisionSummaryContent — dialog for A_PRUEBA → PENDIENTE_REVISION
   ════════════════════════════════════════ */

function RevisionSummaryContent({ loadedDosif, resultado, observaciones, onObservacionesChange, pastonRefId, onPastonRefChange }) {
  const [pastones, setPastones] = React.useState([]);
  const [correcciones, setCorrecciones] = React.useState([]);
  const dosifId = loadedDosif?.id;

  React.useEffect(() => {
    if (!dosifId) return;
    listarPastones(dosifId).then(data => {
      setPastones(data || []);
      if (data?.length > 0 && !pastonRefId) {
        onPastonRefChange(data[data.length - 1].idPastonPrueba);
      }
    }).catch((err) => { console.warn('[listarPastones]', err?.message || err); });
    listarCorrecciones(dosifId)
      .then(data => setCorrecciones(data || []))
      .catch((err) => { console.warn('[listarCorrecciones]', err?.message || err); });
  }, [dosifId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pastonRef = pastones.find(p => p.idPastonPrueba === pastonRefId) || pastones[pastones.length - 1];
  const pastonRefIdx = pastonRef ? pastones.indexOf(pastonRef) + 1 : null;

  const fmtN = (v, d = 1) => v != null ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

  // Build comparison rows: parámetro | teórico | adoptado | verificado
  const rows = [];

  // Asentamiento
  const asentDiseno = resultado?.asentamientoNominalCm;
  const asentMedido = pastonRef?.asentamientoMedido != null ? Number(pastonRef.asentamientoMedido) : null;
  rows.push({
    param: "Asentamiento", unit: "cm",
    teorico: asentDiseno, adoptado: asentMedido, fuente: pastonRef ? `Pastón #${pastonRefIdx}` : null,
    ok: asentMedido != null && asentDiseno != null ? Math.abs(asentMedido - asentDiseno) <= 2.0 : null,
  });

  // PUV
  rows.push({
    param: "PUV", unit: "kg/m³",
    teorico: resultado?.puvKgM3, adoptado: pastonRef?.puvMedido != null ? Number(pastonRef.puvMedido) : null,
    fuente: pastonRef ? `Pastón #${pastonRefIdx}` : null, ok: null,
  });

  // Aire
  rows.push({
    param: "Aire total", unit: "%",
    teorico: resultado?.airePct, adoptado: pastonRef?.aireMedido != null ? Number(pastonRef.aireMedido) : null,
    fuente: pastonRef ? `Pastón #${pastonRefIdx}` : null, ok: null,
  });

  // Dosis aditivos — compare current design value with original calc
  if (resultado?.aditivos) {
    resultado.aditivos.forEach((ad, idx) => {
      const currentDosis = Number(loadedDosif?.[`dosisAditivo${idx + 1}`]);
      const origDosis = ad.dosisOriginal ?? ad.dosisPctPc;
      if (currentDosis && origDosis && currentDosis !== Number(origDosis)) {
        rows.push({
          param: `Dosis ${ad.label || `aditivo ${idx + 1}`}`, unit: "%",
          teorico: Number(origDosis), adoptado: currentDosis,
          fuente: "Corregido", ok: null,
        });
      }
    });
  }

  return (
    <div>
      {pastones.length === 0 && (
        <div className="p-message p-message-warn mb-3 p-3 border-round surface-100">
          <i className="pi pi-exclamation-triangle mr-2" />
          No se registraron pastones de prueba. Se enviará con valores teóricos.
        </div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-sm mb-3" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
              <th className="text-left py-2 px-2">Parámetro</th>
              <th className="text-right py-2 px-2">Teórico</th>
              <th className="text-right py-2 px-2">Adoptado</th>
              <th className="text-right py-2 px-2">Verificado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.param} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                <td className="py-2 px-2">{r.param}</td>
                <td className="text-right py-2 px-2 text-color-secondary">{r.teorico != null ? `${fmtN(r.teorico)} ${r.unit}` : "—"}</td>
                <td className="text-right py-2 px-2 font-bold">
                  {r.adoptado != null ? `${fmtN(r.adoptado)} ${r.unit}` : "—"}
                </td>
                <td className="text-right py-2 px-2">
                  {r.fuente ? (
                    <span style={{ color: r.ok === false ? "var(--orange-600)" : r.ok === true ? "var(--green-600)" : "var(--text-color-secondary)" }}>
                      {r.fuente} {r.ok === true ? "✓" : r.ok === false ? "⚠" : ""}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pastones.length > 0 && (
        <div className="mb-3">
          <span className="text-sm">
            Pastones realizados: <strong>{pastones.length}</strong>
          </span>
          {pastones.length > 1 && (
            <div className="mt-2">
              <label className="block text-sm font-bold mb-1">Pastón de referencia</label>
              <select
                className="p-inputtext w-full text-sm"
                value={pastonRefId || ""}
                onChange={e => onPastonRefChange(Number(e.target.value))}
              >
                {pastones.map((p, i) => (
                  <option key={p.idPastonPrueba} value={p.idPastonPrueba}>
                    Pastón #{i + 1} — {p.fecha || "sin fecha"} {p.operador ? `(${p.operador})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Corrections summary */}
      {correcciones.length > 0 && (
        <div className="mb-3">
          <span className="text-sm font-bold block mb-1">
            <i className="fa-solid fa-wrench mr-1" />
            Correcciones aplicadas ({correcciones.length})
          </span>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
                <th className="text-left py-1 px-2">Campo</th>
                <th className="text-right py-1 px-2">Anterior</th>
                <th className="text-right py-1 px-2">Nuevo</th>
                <th className="text-left py-1 px-2">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {correcciones.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                  <td className="py-1 px-2">{c.campoLabel}</td>
                  <td className="text-right py-1 px-2 text-color-secondary">{c.valorAnterior} {c.unidad || ""}</td>
                  <td className="text-right py-1 px-2 font-bold text-primary">{c.valorNuevo} {c.unidad || ""}</td>
                  <td className="py-1 px-2 text-color-secondary">{c.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <label className="block text-sm font-bold mb-1">Observaciones para el revisor</label>
        <textarea
          className="p-inputtextarea p-inputtext w-full text-sm"
          rows={3}
          value={observaciones}
          onChange={e => onObservacionesChange(e.target.value)}
          placeholder="Ej: Dosificación ajustada tras 2 pastones. Dosis de aditivo reducida..."
        />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   Helpers
   ════════════════════════════════════════ */

function buildResultRows(r) {
  const rows = [];
  rows.push({ componente: "Agua", cantidad: r.aguaLtsM3, unidad: "lts/m³" });
  rows.push({ componente: "Cemento (neto)", cantidad: r.cementoKgM3, unidad: "kg/m³" });
  if (r.adicion1KgM3) rows.push({ componente: "Adición 1", cantidad: r.adicion1KgM3, unidad: "kg/m³" });
  if (r.adicion2KgM3) rows.push({ componente: "Adición 2", cantidad: r.adicion2KgM3, unidad: "kg/m³" });
  if (r.aditivos) {
    r.aditivos.forEach((a) => {
      rows.push({ componente: `Aditivo (${a.label})`, cantidad: a.kgM3 != null ? a.kgM3 : a.dosis, unidad: a.kgM3 != null ? "kg/m³" : a.unidad });
    });
  }
  if (r.agregados) {
    r.agregados.forEach((a) => {
      if (a.kgM3 != null) {
        const pct = a.proporcionNormalizada != null ? ` (${a.proporcionNormalizada}%)` : "";
        rows.push({ componente: a.nombre, cantidad: `${a.kgM3}${pct}`, unidad: "kg/m³" });
      } else {
        rows.push({ componente: a.nombre, cantidad: a.proporcionNormalizada, unidad: "% del total" });
      }
    });
  }
  if (r.fibras?.macrofibra?.dosisKgM3) {
    const f = r.fibras.macrofibra;
    const lbl = f.nombre ? `Macrofibra (${f.nombre})` : "Macrofibra";
    rows.push({ componente: lbl, cantidad: Number(f.dosisKgM3).toFixed(3), unidad: "kg/m³" });
  }
  if (r.fibras?.microfibra?.dosisKgM3) {
    const f = r.fibras.microfibra;
    const lbl = f.nombre ? `Microfibra (${f.nombre})` : "Microfibra";
    rows.push({ componente: lbl, cantidad: Number(f.dosisKgM3).toFixed(3), unidad: "kg/m³" });
  }
  if (r.tipoAire === 'INTENCIONAL' && r.aireAtrapado != null) {
    rows.push({ componente: "Aire atrapado", cantidad: `${Number(r.aireAtrapado).toFixed(1)}%`, unidad: "" });
    rows.push({ componente: "Aire incorporado", cantidad: `${Number(r.aireIncorporado).toFixed(1)}%`, unidad: "" });
    rows.push({ componente: "Aire total", cantidad: `${Number(r.airePct).toFixed(1)}%`, unidad: "" });
  } else {
    rows.push({ componente: "Aire atrapado", cantidad: `${r.airePct != null ? Number(r.airePct).toFixed(1) : '—'}%`, unidad: "" });
  }
  return rows;
}
