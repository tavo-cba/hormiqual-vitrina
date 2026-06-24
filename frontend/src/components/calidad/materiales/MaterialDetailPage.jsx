import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { config } from "../../../config/config";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Tooltip } from "primereact/tooltip";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Panel } from "primereact/panel";
import { BreadCrumb } from "primereact/breadcrumb";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import FichaTecnicaModal from "../ensayos-agregados/FichaTecnicaModal";
import CumplimientoNormativoTable from "./CumplimientoNormativoTable";
import DestinoUsoDialog from "./DestinoUsoDialog";
import CertificateApprovalDialog from "../compliance/CertificateApprovalDialog";
import DualVeredictoBadge from "../common/DualVeredictoBadge";
import { hasRole, ROLES } from "../../../lib/roles";
import RolBadge from "../../../common/components/RolBadge/RolBadge";
import { getCaracterizacion, getResumen } from "../../../services/agregadoEnsayoService";
import {
  CATEGORIA_COLORS,
  VEREDICTO,
  getCategoriaVeredicto,
  fromLegacyEval,
} from "../../../lib/compliance";
import { formatNumber, formatSubtipoAgregado } from "../../../lib/format";
import { formatParamValue, paramKeyForCodigo, specFor } from "../../../lib/format/agregado";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import "chart.js/auto";

/* ─────────────── Helpers de mapeo a categorías visuales (Prompt 3 C6) ─────────────── */

/**
 * Decide la categoría visual canónica para un ensayo individual.
 *
 * Preferencias:
 *   1. `ensayo.resultado._evaluacion.compliance.status` (post-C6 backend).
 *   2. `fromLegacyEval(ensayo)` desde el shape legacy.
 *   3. Default: EVALUACIÓN INCOMPLETA.
 *
 * Hybrid Option B activo: si el ensayo trae compliance canónico (caso
 * Petrográfico reactivo, RAS reactivo, granulometría individual fuera de
 * banda, materias carbonosas zona dual, estabilidad basálticas zona dual),
 * la categoría se deriva del compliance — el usuario ve APTO CON
 * OBSERVACIONES o APTITUD CONDICIONADA en lugar de NO APTO rojo.
 */
function categoriaDeEnsayo(ensayo) {
  if (!ensayo) return VEREDICTO.EVALUACION_INCOMPLETA;
  let r = ensayo.resultado;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { r = null; }
  }
  const persisted = r?._evaluacion?.compliance;
  if (persisted?.status) return getCategoriaVeredicto(persisted);
  // Fallback al shape legacy
  return getCategoriaVeredicto(fromLegacyEval(ensayo));
}

// Prompt 3 C10 (6.1): consolidado en lib/format. Antes este componente usaba
// vocabulario coloquial divergente ("Grava" / "Grava partida" / "Piedra partida")
// mientras que los PDFs y el certificado usaban vocabulario técnico-normativo
// ("Canto rodado" / "Triturado natural" / "Triturado artificial"). El usuario
// del mismo material veía dos voces distintas según el documento — síntoma de
// sistema con dos vocabularios. Post-unificación: una sola voz alineada al
// estándar IRAM/CIRSOC. Las claves legacy GRAVA_PARTIDA / PIEDRA_PARTIDA / MIXTO
// (que no existen en el ENUM canónico de AgregadoMeta) caen al fallback de
// formatEnum (devuelve el valor crudo) — datos viejos no rompen.
const TIPO_ROCA_LABELS = {
  GRANITICA: "Granítica", BASALTICA: "Basáltica", CALCAREA: "Calcárea", CUARCITICA: "Cuarcítica", OTRA: "Otra",
};
const RAS_LABELS = {
  NO_EVALUADO: "No evaluado", NO_REACTIVO: "No reactivo", POTENCIALMENTE_REACTIVO: "Potencialmente reactivo",
};

const COMPOSICION_LABELS = {
  CPN: "CPN (Normal)",
  CPF: "CPF (con filler)",
  CPC: "CPC (compuesto)",
  CPP: "CPP (puzolánico)",
  CPE: "CPE (con escoria)",
  CAH: "CAH (alto horno)",
};
const DESARROLLO_LABELS = {
  RAPIDO: "Rápido (ARI)",
  NORMAL: "Normal",
  LENTO: "Lento",
};
const PROPIEDAD_LABELS = {
  ARI: "Alta resistencia inicial",
  ARS: "Altamente resistente a sulfatos",
  MRS: "Moderadamente resistente a sulfatos",
  BCH: "Bajo calor de hidratación",
  RRAA: "Resistente reacción álcali-agregado",
  B: "Blanco",
};
const MODO_CURVA_LABELS = {
  REFERENCIA_GENERAL: "Referencia general",
  ICPA: "Referencia general",
  FABRICANTE: "Curva del fabricante",
  PROPIA: "Curva propia",
};

const TYPE_CONFIG = {
  agregado: { icon: "fa-solid fa-mountain", color: "#8B6F47", label: "Agregado" },
  cemento: { icon: "fa-solid fa-industry", color: "#607D8B", label: "Cemento" },
  aditivo: { icon: "fa-solid fa-flask", color: "#9C27B0", label: "Aditivo" },
  fibra: { icon: "fa-solid fa-grip-lines", color: "#FF9800", label: "Fibra" },
  adicion: { icon: "fa-solid fa-plus-circle", color: "#00BCD4", label: "Adición" },
  agua: { icon: "fa-solid fa-droplet", color: "#2196F3", label: "Agua" },
};

const headers = () => ({ ...config.headers, Authorization: `Bearer ${localStorage.getItem('token')}` });

export default function MaterialDetailPage() {
  const { source, sourceId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const cfg = useConfig();
  const { user } = useUserContext();
  const tipoAgregadoParam = searchParams.get('tipo') || 'Fino';

  const [loading, setLoading] = useState(true);
  const [material, setMaterial] = useState(null);
  const [ensayos, setEnsayos] = useState([]);
  const [dosifVinculadas, setDosifVinculadas] = useState([]);
  const [fichaTecnicaVisible, setFichaTecnicaVisible] = useState(false);
  const [destinoDialogVisible, setDestinoDialogVisible] = useState(false);
  const [approvalDialog, setApprovalDialog] = useState({ visible: false, context: null, razon: null });
  const [caracterizacion, setCaracterizacion] = useState(null);
  const [pdfCaract, setPdfCaract] = useState(null);
  const [pdfResumen, setPdfResumen] = useState(null);
  // PR4: vista normativa CIRSOC — lazy-load al expandir el panel.
  const [vistaNormativa, setVistaNormativa] = useState(null);
  const [vistaNormativaLoading, setVistaNormativaLoading] = useState(false);
  const [vistaNormativaError, setVistaNormativaError] = useState(null);

  /* ── Build characterisation from ensayos ── */
  const buildCaracterizacion = (list) => {
    const c = {};
    for (const ens of list) {
      let r = ens.resultado;
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
      if (!r) continue;
      const f = ens.fechaEnsayo;
      const inf = ens.nroInforme;
      const venc = ens.fechaVencimiento;
      const codigo = ens.tipo?.codigo || ens.AgregadoEnsayoTipo?.codigo || '';
      const entry = (valor) => ({ valor, fecha: f, informe: inf, vence: venc });

      // Granulometría → MF & TMN (check evaluacionAuto first, then evaluacion.calculos, then root)
      if (r.granulometria) {
        const g = r.granulometria;
        const mf = g.evaluacionAuto?.moduloFinura?.valor ?? g.evaluacionAutoGrueso?.moduloFinura?.valor ?? g.evaluacion?.calculos?.moduloFinura?.valor ?? g.moduloFinura ?? g.reportado?.moduloFinura ?? null;
        if (mf != null && !c.mf) c.mf = entry(mf);
        const tmn = g.evaluacion?.calculos?.tmn?.valor ?? g.reportado?.tmnMm ?? null;
        if (tmn != null && !c.tmn) c.tmn = entry(tmn);
      }
      // Auto-calculated derived ensayos (MF, TMN) have valor directly
      if (ens.esAutoCalculado && r.valor != null) {
        if (codigo.includes('MODULO_FINEZA') || codigo.includes('MODULO_FINURA') || codigo.includes('_MF')) {
          c.mf = entry(r.valor);
        }
        if (codigo.includes('_TMN')) {
          c.tmn = entry(r.valor);
        }
      }
      // Densidad (IRAM 1520/1533)
      if (r.densidadRelativaAparenteSSS != null) c.densSSS = entry(r.densidadRelativaAparenteSSS);
      if (r.densidadRelativaAparenteSeca != null) c.densSeca = entry(r.densidadRelativaAparenteSeca);
      if (r.densidadRelativaReal != null) c.densReal = entry(r.densidadRelativaReal);
      if (r.absorcionPct != null && !c.absorcion) c.absorcion = entry(r.absorcionPct);
      // Pasante #200 (IRAM 1540) — field is pasa200Pct or valor depending on schema
      if (r.pasa200Pct != null) c.pasa200 = entry(r.pasa200Pct);
      else if (codigo.includes('1540') && r.valor != null) c.pasa200 = entry(r.valor);
      // Peso unitario (IRAM 1548)
      if (r.puc != null) c.puc = entry(r.puc);
      if (r.pus != null) c.pus = entry(r.pus);
      // Forma (IRAM 1687)
      if (r.lajosidadPct != null) c.lajosidad = entry(r.lajosidadPct);
      if (r.elongacionPct != null) c.elongacion = entry(r.elongacionPct);
    }
    setCaracterizacion(c);
  };

  /* ── Fetch material + ensayos ── */
  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const apiPaths = {
        agregado: `/api/agregados/${sourceId}?tipoAgregado=${encodeURIComponent(tipoAgregadoParam)}`,
        cemento: `/api/cementos/${sourceId}`,
        aditivo: `/api/aditivos/${sourceId}`,
        fibra: `/api/fibras/${sourceId}`,
        adicion: `/api/materiales/${sourceId}`,
        agua: `/api/aguas/${sourceId}`,
      };
      const apiPath = apiPaths[source];
      if (!apiPath) throw new Error('Tipo no soportado');

      const res = await axios.get(`${config.backendUrl}${apiPath}`, { headers: headers() });
      const raw = res.data;

      // Normalize material — preferimos la lista multi-planta (`raw.plantas`)
      // si viene poblada; si no, caemos a `raw.planta` legacy (single).
      const plantasActivas = Array.isArray(raw.plantas)
        ? raw.plantas.filter(p => p.activo !== false)
        : [];
      const plantaNombre = plantasActivas.length > 0
        ? plantasActivas.map(p => p.planta?.nombre || `Planta ${p.idPlanta}`).join(', ')
        : (typeof raw.planta === 'object' && raw.planta
            ? raw.planta.nombre
            : (raw.Planta?.nombre || raw.planta || null));
      const plantaLabel = plantasActivas.length > 1 ? 'Plantas' : 'Planta';

      // Resolve name by material type
      const matNombre = raw.nombre || raw.nombreComercial || raw.marca || raw.descripcion || '—';
      const matProductor = raw.productor || raw.fabricante || raw.fabrica || raw.proveedor || null;

      // Build tipo label
      const TIPO_LABELS = { agregado: 'Agregado', cemento: 'Cemento', aditivo: 'Aditivo', fibra: 'Fibra', adicion: 'Adicion', agua: 'Agua' };
      const tipoLabel = TIPO_LABELS[source] || source;

      // Type-specific fields
      const extraFields = {};
      if (source === 'cemento') {
        extraFields.composicion = raw.composicion || null;
        extraFields.resistencia = raw.resistencia || null;
        extraFields.familiaCemento = raw.familiaCemento || null;
        extraFields.tipoNormativo = raw.tipoNormativo || null;
        extraFields.propiedades = raw.propiedades || null;
        extraFields.desarrolloResistencia = raw.desarrolloResistencia || null;
        extraFields.origenFabrica = raw.origenFabrica || null;
        extraFields.densidadRelativa = raw.densidadRelativa != null ? Number(raw.densidadRelativa) : null;
        extraFields.edadReferenciaDefault = raw.edadReferenciaDefault || null;
        extraFields.observaciones = raw.observaciones || null;
        extraFields.configuracionPorPlanta = Array.isArray(raw.configuracionPorPlanta) ? raw.configuracionPorPlanta : [];
      } else if (source === 'aditivo') {
        extraFields.marca = raw.marca || null;
        extraFields.tipoFuncional = raw.tipoFuncional || null;
        extraFields.tipoAditivo = raw.subtipo || raw.tipo || raw.tipoAditivo || null;
        extraFields.funcion = raw.funcion || null;
        extraFields.baseQuimica = raw.baseQuimica || null;
        extraFields.densidad = raw.densidad || null;
        extraFields.dosisMinima = raw.dosisMinima || null;
        extraFields.dosisMaxima = raw.dosisMaxima || null;
        extraFields.dosisHabitual = raw.dosisHabitual || null;
        extraFields.unidadDosificacion = raw.unidadDosificacion || null;
        extraFields.reduccionAguaPct = raw.reduccionAguaPctEsperada || null;
        extraFields.incrementoAsentamiento = raw.incrementoAsentamientoEsperado || null;
        extraFields.retencionTrabajabilidad = raw.retencionTrabajabilidadMin || null;
        extraFields.solidosPct = raw.solidosPct || null;
        extraFields.observaciones = raw.observaciones || null;
      } else if (source === 'fibra') {
        extraFields.tipoFibra = raw.tipo || raw.tipoFibra || null;
        extraFields.material = raw.material || null;
      } else if (source === 'agua') {
        extraFields.fuenteOrigen = raw.fuenteOrigen || null;
      }

      const mat = {
        _source: source,
        _sourceId: sourceId,
        _tipoLabel: tipoLabel,
        nombre: matNombre,
        productor: matProductor,
        origen: raw.origen || raw.procedencia || null,
        cantera: raw.cantera || null,
        subtipo: raw.subtipoMaterial || raw.tipo || null,
        tipoRoca: raw.tipoRoca || null,
        evaluacionRas: raw.evaluacionRas || 'NO_EVALUADO',
        tipoAgregado: null,
        planta: plantaNombre,
        plantaLabel,
        expediente: raw.nroExpediente || null,
        fuenteOrigen: raw.fuenteOrigen || null,
        alertaClasificacion: raw.alertaClasificacion || null,
        _editRoute: null,
        ...extraFields,
      };

      if (source === 'agregado') {
        mat.tipoAgregado = raw.tipoAgregado || tipoAgregadoParam;
        // Sesión 2026-05-27 — rutas movidas a /calidad/catalogos/{tipo}.
        mat._editRoute = `/calidad/catalogos/agregados/editar/${mat.tipoAgregado}/${sourceId}`;
      } else if (source === 'agua') {
        mat._editRoute = `/calidad/catalogos/materiales/agua/editar/${sourceId}`;
      } else if (source === 'cemento') {
        mat._editRoute = `/calidad/catalogos/cementos/editar/${sourceId}`;
      } else if (source === 'aditivo') {
        mat._editRoute = `/calidad/catalogos/aditivos/editar/${sourceId}`;
      } else if (source === 'fibra') {
        mat._editRoute = `/calidad/catalogos/fibras/editar/${sourceId}`;
      } else if (source === 'adicion') {
        mat._editRoute = `/calidad/catalogos/materiales/editar/${sourceId}`;
      }

      setMaterial(mat);

      // Fetch ensayos + caract + resumen (same data as AgregadoEnsayosPage)
      if (source === 'agregado') {
        try {
          const tipoAg = mat.tipoAgregado || 'Fino';
          const [ensRes, caractData, resumenData] = await Promise.all([
            axios.get(`${config.backendUrl}/api/agregados-ensayos`, { headers: headers(), params: { legacyAgregadoId: sourceId } }),
            getCaracterizacion(sourceId, tipoAg).catch(err => { console.error('[MaterialDetail] getCaracterizacion failed:', err); return null; }),
            // Decisión 2026-05-28: las pantallas internas operativas
            // necesitan VER el veredicto para decidir si avanzar con el
            // material; pedimos `modo: NORMATIVO` para que el backend
            // evalúe contra la matriz completa. Los PDFs hacia afuera
            // eligen el modo que correspondan (la ficha técnica usa
            // Descriptivo por default — no juzga).
            getResumen(sourceId, { uso: tipoAg, modo: 'NORMATIVO' }).catch(err => { console.error('[MaterialDetail] getResumen failed:', err); return null; }),
          ]);
          const list = Array.isArray(ensRes.data) ? ensRes.data : ensRes.data?.data || [];
          setEnsayos(list);
          buildCaracterizacion(list);
          setPdfCaract(caractData);
          setPdfResumen(resumenData);
        } catch (e) { console.warn('Could not fetch ensayos', e); }
      } else if (source === 'agua') {
        // Water ensayos use the same AgregadoEnsayo table with legacyAgregadoId = agua ID
        try {
          const ensRes = await axios.get(`${config.backendUrl}/api/agregados-ensayos`, {
            headers: headers(),
            params: { legacyAgregadoId: sourceId },
          });
          const list = Array.isArray(ensRes.data) ? ensRes.data : ensRes.data?.data || [];
          setEnsayos(list);
        } catch (e) { console.warn('Could not fetch agua ensayos', e); }
      }

      // Dosificaciones vinculadas — endpoint genérico para todos los tipos de material
      try {
        const dvRes = await axios.get(`${config.backendUrl}/api/dosificaciones-diseno/vinculadas`, {
          headers: headers(),
          params: { source, sourceId },
        });
        setDosifVinculadas(Array.isArray(dvRes.data) ? dvRes.data : []);
      } catch { /* non-critical */ }
    } catch (err) {
      console.error('Error loading material', err);
      toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudo cargar el material." });
      navigate("/calidad/catalogos/materiales");
    } finally {
      setLoading(false);
    }
  }, [source, sourceId, tipoAgregadoParam]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // P1.5/P1.9 — emisión de certificado/informe pasa por el diálogo de destino.
  // CRÍTICO (P0.1): toda emisión pasa por emitDocument(), que aplica la
  // CertificateIssuancePolicy. Si hay incumplimientos se emite un Informe de
  // Evaluación (NO un certificado afirmando cumplimiento).
  // Definido antes de los early returns para no violar las reglas de hooks.
  const emitirDocumento = useCallback(async (destinoCtx = {}) => {
    if (!material) return;
    const { emitDocument } = await import('../../../lib/document-issuance');
    const items = (pdfResumen?.items || []);
    // C6: pasar el `veredictoGlobal` pre-computado por el backend (post-C10.5
    // Prompt 2 — getResumen lo expone en la respuesta). emitDocument lo
    // consume directo en lugar de re-agregar localmente con `aggregate()`
    // (eliminada en C2). Si el response no lo trae (datos pre-Prompt 2), el
    // fallback de emitDocument cae a notEvaluated documentadamente.
    const result = await emitDocument({
      material: { nombre: material.nombre, tipo: material.tipoMaterial || material.tipoAgregado, subtipo: material.subtipo, productor: material.productor, cantera: material.cantera },
      ensayos: items,
      veredictoGlobal: pdfResumen?.veredictoGlobal || null,
      metadata: {
        empresa: cfg?.nombreEmpresa || '',
        // P2.10 — datos completos del emisor para el footer del certificado
        cuitEmpresa: cfg?.cuitEmpresa || '',
        direccionEmpresa: cfg?.direccionEmpresa || '',
        emailEmpresa: cfg?.mailUser || '',
        planta: material.planta || '',
        nroCertificado: `CERT-${new Date().getFullYear()}-${String(sourceId).padStart(4, '0')}`,
        normaRef: material.tipoAgregado === 'Fino' ? 'CIRSOC 200:2024 / IRAM 1512' : 'CIRSOC 200:2024 / IRAM 1531',
        responsable: user?.nombre || '',
        validezHasta: items.reduce((min, it) => { const fv = it.ultimoEnsayo?.fechaVencimiento; return fv && (!min || fv < min) ? fv : min; }, null),
        expuestoDesgaste: destinoCtx.expuestoDesgaste,
        claseExposicion: destinoCtx.claseExposicion,
        fceMpa: destinoCtx.fceMpa,
      },
    });
    if (result.type === 'REQUIRES_APPROVAL') {
      // Fase 2 RBAC — el PDF no se generó: abrir dialog para solicitar firma.
      setApprovalDialog({
        visible: true,
        context: result.approvalContext,
        razon: result.reason,
      });
      return;
    }
    if (result.type === 'INFORME_EVALUACION') {
      toast?.current?.show?.({
        severity: 'warn',
        summary: 'Informe de Evaluación emitido',
        detail: `No se emitió Certificado de Cumplimiento. Motivos: ${result.reasons.slice(0, 2).join('; ')}`,
        life: 8000,
      });
    } else if (result.notes.length > 0) {
      toast?.current?.show?.({
        severity: 'info',
        summary: 'Certificado emitido con condiciones',
        detail: `${result.notes.length} condición(es) de aplicabilidad indicada(s) en el documento`,
        life: 6000,
      });
    } else {
      toast?.current?.show?.({
        severity: 'success',
        summary: 'Certificado emitido',
        detail: 'Certificado de Cumplimiento emitido correctamente',
        life: 4000,
      });
    }
  }, [pdfResumen, material, cfg, sourceId, user, toast]);

  if (loading) return <LoadSpinner />;
  if (!material) return <div className="p-4">Material no encontrado.</div>;

  const typeConf = TYPE_CONFIG[source] || TYPE_CONFIG.agregado;
  const isAgregado = source === 'agregado';
  const subtitleParts = [];
  if (material.tipoAgregado) subtitleParts.push(material.tipoAgregado);
  if (material.subtipo) subtitleParts.push(formatSubtipoAgregado(material.subtipo));
  if (material.productor && material.productor !== '—') subtitleParts.push(material.productor);
  if (material.planta) subtitleParts.push(material.planta);
  const subtitle = subtitleParts.join(' · ') || typeConf.label;

  // Ensayo summary table — extract display value from resultado JSON.
  // Toda salida pasa por formatParamValue() para garantizar coma decimal,
  // punto miles donde aplica, y precisión por parámetro (lib/format/agregado).
  const extractValorDisplay = (r, codigo) => {
    if (!r) return '—';
    // Granulometría
    if (r.granulometria) {
      const g = r.granulometria;
      const mf = g.evaluacionAuto?.moduloFinura?.valor ?? g.evaluacionAutoGrueso?.moduloFinura?.valor ?? g.evaluacion?.calculos?.moduloFinura?.valor ?? g.moduloFinura ?? g.reportado?.moduloFinura ?? null;
      const tmn = g.evaluacionAutoGrueso?.tmnMm ?? g.evaluacion?.calculos?.tmn?.valor ?? g.reportado?.tmnMm ?? null;
      const parts = [];
      if (mf != null) parts.push(`MF: ${formatParamValue('mf', mf)}`);
      if (tmn != null) parts.push(`TMN: ${formatParamValue('tmn', tmn)} mm`);
      return parts.length > 0 ? parts.join(' · ') : '—';
    }
    // Densidad fino/grueso (IRAM 1520/1533) — show all values
    if (r.densidadRelativaAparenteSSS != null || r.densidadRelativaReal != null) {
      const parts = [];
      if (r.densidadRelativaReal != null) parts.push(`d1: ${formatParamValue('densidadReal', r.densidadRelativaReal)}`);
      if (r.densidadRelativaAparenteSeca != null) parts.push(`d2: ${formatParamValue('densidadSeca', r.densidadRelativaAparenteSeca)}`);
      if (r.densidadRelativaAparenteSSS != null) parts.push(`d3: ${formatParamValue('densidadSSS', r.densidadRelativaAparenteSSS)}`);
      if (r.absorcionPct != null) parts.push(`A: ${formatParamValue('absorcion', r.absorcionPct)} %`);
      return parts.join(' · ');
    }
    // Peso unitario (kg/m³, miles)
    if (r.puc != null) {
      const pucFmt = formatParamValue('puc', r.puc);
      const pusFmt = r.pus != null ? formatParamValue('pus', r.pus) : '—';
      return `PUC: ${pucFmt} / PUS: ${pusFmt} kg/m³`;
    }
    // Equivalente de arena
    if (r.equivalenteArenaPct != null) return `${formatParamValue('equivalenteArena', r.equivalenteArenaPct)} %`;
    // Materia orgánica (cualitativo)
    if (r.resultadoColorimetrico) return r.resultadoColorimetrico === 'menor_500' ? '< 500 ppm' : '≥ 500 ppm';
    // Partículas blandas (cualitativo)
    if (r.resultadoCualitativo === 'no_contiene') return 'No contiene';
    if (r.resultadoCualitativo != null) {
      return r.valor != null ? `${formatParamValue('particulasBlandas', r.valor)} %` : '—';
    }
    // Generic valor field (terrones, sales, sulfatos, cloruros, carbonosas, pasante200, etc.)
    // Resuelve la clave canónica según el código del ensayo para aplicar precisión correcta.
    if (r.valor != null) {
      const paramKey = paramKeyForCodigo(codigo);
      const prefix = r.operador === 'menor_que' ? '< ' : r.operador === 'mayor_que' ? '> ' : (r.esMenorQue ? '< ' : '');
      const valFmt = paramKey
        ? formatParamValue(paramKey, r.valor)
        : formatNumber(r.valor, { precision: 1, forceDecimals: true, fallback: String(r.valor) });
      const unidad = r.unidad || (paramKey === 'puc' || paramKey === 'pus' ? 'kg/m³' : '%');
      return `${prefix}${valFmt} ${unidad}`;
    }
    // Named percentage fields — usar paramKey específico para cada uno
    if (r.pasa200Pct != null)   return `${formatParamValue('pasa200', r.pasa200Pct)} %`;
    if (r.losAngelesPct != null) return `${formatParamValue('losAngeles', r.losAngelesPct)} %`;
    if (r.lajosidadPct != null)  return `${formatParamValue('lajosidad', r.lajosidadPct)} %`;
    if (r.elongacionPct != null) return `${formatParamValue('elongacion', r.elongacionPct)} %`;
    if (r.perdidaPct != null)    return `${formatParamValue('perdidaSulfato', r.perdidaPct)} %`;
    if (r.perdidaPctTotal != null) return `${formatParamValue('perdidaSulfato', r.perdidaPctTotal)} %`;
    return '—';
  };

  // Filter ensayos: exclude auto-calculated and those that don't apply to this aggregate type
  const tipoUso = material.tipoAgregado?.toUpperCase(); // 'FINO' or 'GRUESO'
  const aplicaAlTipo = (ens) => {
    if (!tipoUso) return true;
    const tipo = ens.AgregadoEnsayoTipo || ens.tipo;
    if (!tipo?.aplicaA) return true;
    let arr = tipo.aplicaA;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return true; } }
    if (!Array.isArray(arr)) return true;
    return arr.includes(tipoUso);
  };

  // C6 + C6.5: preferimos `compliance` canónico re-evaluado del response de
  // getResumen. El backend lo expone al nivel `pdfResumen.items[i].compliance`
  // (post-C6.5) — fresh contra el motor actual incluso para ensayos persistidos
  // pre-Prompt 2. Esto activa el patrón Hybrid Option B (D15+D20) en el render:
  // Petrográfico reactivo / RAS reactivo / granulometría individual fuera de
  // banda → APTITUD CONDICIONADA / APTO CON OBSERVACIONES en lugar de NO APTO.
  // Match por código de tipo entre los ensayos raw y items del resumen.
  // PR4: además de compliance, retenemos los flags `_wasFailNonMandatory` y
  // `_originalCompliance` que el backend (PR2) propaga al item cuando un fail
  // se rescató por política del catálogo (obligatorio=false). Sirven para el
  // tooltip explicativo en items rescatados.
  const itemFromResumenByCodigo = (() => {
    const m = new Map();
    (pdfResumen?.items || []).forEach((it) => {
      const codigo = it.tipo?.codigo;
      if (codigo && it.compliance) m.set(codigo, it);
    });
    return m;
  })();

  const ensayoSummary = ensayos.filter(e => !e.esAutoCalculado && aplicaAlTipo(e)).map(ens => {
    const tipo = ens.AgregadoEnsayoTipo || ens.tipo || {};
    // resultado may come as string from MySQL JSON column
    let r = ens.resultado;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = {}; } }
    r = r || {};
    // Si pdfResumen tiene el compliance re-evaluado del backend para este
    // tipo de ensayo, usarlo. Sino, fallback a categoriaDeEnsayo (que lee
    // _evaluacion.compliance persistido o cae a fromLegacyEval).
    const itemResumen = itemFromResumenByCodigo.get(tipo.codigo);
    const complianceCanonico = itemResumen?.compliance;
    const categoria = complianceCanonico
      ? getCategoriaVeredicto(complianceCanonico)
      : categoriaDeEnsayo(ens);
    return {
      nombre: tipo.nombre || 'Sin nombre',
      norma: tipo.normaRef || '',
      fecha: ens.fechaEnsayo,
      valor: extractValorDisplay(r, tipo.codigo),
      cumple: ens.cumple || 'NO_EVAL',
      categoria,
      vencimiento: ens.fechaVencimiento,
      evalMsg: r._evaluacion?.mensaje || '',
      // PR4: flags de rescate por política (cuando aplica).
      wasFailNonMandatory: !!itemResumen?._wasFailNonMandatory,
      originalCompliance: itemResumen?._originalCompliance || null,
    };
  });

  const fmtDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  // C6: counters extendidos a las 7 categorías canónicas. Cambio observable
  // inmediato: ensayos que antes contaban como "NO CUMPLE" (5 evaluadores en
  // Hybrid Option B — ver D15 + D20 en DEFERRED.md) ahora cuentan en
  // APTO_CON_OBSERVACIONES o APTITUD_CONDICIONADA según corresponda.
  // El counter binario `noCumple` legacy queda eliminado — el usuario ve la
  // descomposición real en el bloque "Ensayos".
  const counts = {
    [VEREDICTO.APTO]:                   0,
    [VEREDICTO.APTO_CON_OBSERVACIONES]: 0,
    [VEREDICTO.APTITUD_CONDICIONADA]:   0,
    [VEREDICTO.NO_APTO]:                0,
    [VEREDICTO.EVALUACION_INCOMPLETA]:  0,
    [VEREDICTO.INFORMATIVO]:            0,
    [VEREDICTO.NO_APLICA]:              0,
  };
  ensayoSummary.forEach(e => {
    counts[e.categoria] = (counts[e.categoria] || 0) + 1;
  });

  const breadItems = [
    { label: 'Materiales', command: () => navigate('/calidad/catalogos/materiales') },
    { label: material.nombre },
  ];
  const breadHome = { icon: 'pi pi-home', command: () => navigate('/calidad/catalogos') };

  const ensayosRoute = isAgregado
    ? `/calidad/agregados/${sourceId}/ensayos`
    : source === 'agua'
      ? `/calidad/catalogos/materiales/ensayos-agua/${sourceId}`
      : null;

  const hasCaract = caracterizacion && Object.keys(caracterizacion).length > 0;

  return (
    <div className="p-3" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Tooltip real (PrimeReact) para los hints que antes usaban el title
          nativo — lento y sin soporte touch. */}
      <Tooltip target=".mat-help-icon" showDelay={150} />
      <DetailPageHeader
        icon={typeConf.icon}
        iconStyle={{ background: typeConf.color }}
        title={material.nombre}
        subtitle={subtitle}
        actions={(
          <>
            <RolBadge user={user} />
            {material._editRoute && <Button label="Editar" icon="fa-solid fa-pen" className="p-button-outlined p-button-sm" onClick={() => navigate(material._editRoute)} />}
            {isAgregado && <Button label="Ficha técnica" icon="fa-solid fa-file-arrow-down" rounded size="small" severity="danger" outlined onClick={() => setFichaTecnicaVisible(true)} />}
            {/* Operador genera versión draft, responsable+ aprueba — Fase 2 cierra el workflow. */}
            {isAgregado && (
              <Button label="Certificado" icon="fa-solid fa-certificate" rounded size="small" severity="success" outlined onClick={() => setDestinoDialogVisible(true)} />
            )}
          </>
        )}
      />

      {material.alertaClasificacion && (
        <div className="mb-3 p-3 border-round border-left-3 border-orange-500" style={{backgroundColor: 'rgba(245, 158, 11, 0.1)'}}>
          <div className="flex align-items-center gap-2">
            <i className="fa-solid fa-triangle-exclamation text-orange-500" />
            <strong className="text-orange-500">Advertencia de clasificacion</strong>
          </div>
          <p className="text-sm text-color-secondary mt-2 mb-0">{material.alertaClasificacion.mensaje}</p>
        </div>
      )}

      {/* Dual veredicto (decisión 2026-05-28):
          La pantalla interna muestra AMBOS lados — el operador necesita ver
          el juicio según norma y según catálogo para decidir si avanza con
          el material. Los PDFs hacia afuera son una conversación distinta
          (descriptivo no emite veredicto). */}
      {isAgregado && pdfResumen?.items?.length > 0 && (
        <div className="mb-3 p-2 border-round" style={{ background: 'var(--surface-100)' }}>
          <div className="text-xs text-color-secondary mb-1">Veredicto operativo (no se publica en la ficha descriptiva)</div>
          <DualVeredictoBadge
            items={pdfResumen.items}
            contextoAgregado={(material.aptitudes || []).includes('HORMIGON') ? 'HORMIGON' : 'HORMIGON'}
            tipoAgregado={material.tipoAgregado}
            compact
            idPrefix={`mat-${material.idAgregado || material.id}`}
          />
        </div>
      )}

      {/* ── Section 1: Datos generales ── */}
      <Panel header="Datos generales" toggleable className="mb-3">
        <div className="grid">
          <Field label="Nombre" value={material.nombre} />
          <Field label="Tipo" value={`${typeConf.label}${material.tipoAgregado ? ` — ${material.tipoAgregado}` : ''}`} />
          {material.subtipo && <Field label={isAgregado ? "Subtipo" : "Tipo / Clase"} value={formatSubtipoAgregado(material.subtipo)} />}
          {material.productor && <Field label="Fabricante / Productor" value={material.productor} />}
          {material.cantera && <Field label="Cantera / Yacimiento" value={material.cantera} />}
          {material.origen && <Field label="Origen" value={material.origen} />}
          {material.planta && <Field label={material.plantaLabel || "Planta"} value={material.planta} />}
          {material.fuenteOrigen && <Field label="Fuente de origen" value={material.fuenteOrigen} />}
          {material.tipoRoca && <Field label="Tipo de roca" value={TIPO_ROCA_LABELS[material.tipoRoca] || material.tipoRoca} />}
          {material.evaluacionRas && material.evaluacionRas !== 'NO_EVALUADO' && <Field label="Evaluación RAS" value={RAS_LABELS[material.evaluacionRas] || material.evaluacionRas} />}
          {/* Cement-specific (datos básicos) */}
          {source === 'cemento' && material.tipoNormativo && <Field label="Tipo normativo" value={material.tipoNormativo} />}
          {source === 'cemento' && material.origenFabrica && <Field label="Origen de la fábrica" value={material.origenFabrica} />}
          {/* Aditivo-specific */}
          {material.marca && source === 'aditivo' && <Field label="Marca" value={material.marca} />}
          {material.tipoFuncional && <Field label="Tipo funcional" value={material.tipoFuncional.replace(/_/g, ' ')} />}
          {material.tipoAditivo && <Field label="Subtipo" value={material.tipoAditivo} />}
          {material.funcion && <Field label="Función" value={material.funcion} />}
          {material.baseQuimica && <Field label="Base química" value={material.baseQuimica} />}
          {/* Fibra-specific */}
          {material.tipoFibra && <Field label="Tipo de fibra" value={material.tipoFibra} />}
          {material.material && <Field label="Material" value={material.material} />}
          {material.expediente && <Field label="N.° Expediente" value={material.expediente} />}
          <Field label="ID interno" value={`#${sourceId}`} />
        </div>
      </Panel>

      {/* ── Sections cemento: clasificación técnica + propiedades cálculo + curvas por planta ── */}
      {source === 'cemento' && (
        <>
          <Panel
            header={<span><i className="fa-solid fa-flask mr-2 text-primary" />Clasificación técnica</span>}
            toggleable
            className="mb-3"
          >
            <div className="grid">
              {material.composicion && <Field label="Composición" value={COMPOSICION_LABELS[material.composicion] || material.composicion} />}
              {material.resistencia && <Field label="Resistencia (clase)" value={`${material.resistencia} MPa`} />}
              {material.familiaCemento && <Field label="Familia (curvas a/c)" value={material.familiaCemento} />}
              {material.desarrolloResistencia && <Field label="Desarrollo de resistencia" value={DESARROLLO_LABELS[material.desarrolloResistencia] || material.desarrolloResistencia} />}
              {material.propiedades && (
                <div className="col-12 md:col-6 lg:col-12">
                  <small className="text-color-secondary block mb-1">Propiedades especiales</small>
                  <div className="flex flex-wrap gap-2">
                    {material.propiedades.split(',').map((p) => p.trim()).filter(Boolean).map((p) => (
                      <Tag
                        key={p}
                        value={PROPIEDAD_LABELS[p] || p}
                        severity="info"
                        style={{ fontSize: '0.75rem' }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {!material.composicion && !material.resistencia && !material.familiaCemento && !material.desarrolloResistencia && !material.propiedades && (
                <div className="col-12">
                  <p className="text-color-secondary m-0">Sin clasificación técnica cargada.</p>
                </div>
              )}
            </div>
          </Panel>

          <Panel
            header={<span><i className="fa-solid fa-calculator mr-2 text-primary" />Propiedades para cálculo</span>}
            toggleable
            className="mb-3"
          >
            <div className="grid">
              {material.densidadRelativa != null
                ? <Field label="Densidad real" value={`${material.densidadRelativa.toFixed(2)} g/cm³`} />
                : <Field label="Densidad real" value={<span className="text-orange-400"><i className="fa-solid fa-triangle-exclamation mr-1" />Sin cargar — no apto para dosificación</span>} />
              }
              {material.edadReferenciaDefault && <Field label="Edad de referencia" value={`${material.edadReferenciaDefault} días`} />}
            </div>
          </Panel>

          {Array.isArray(material.configuracionPorPlanta) && material.configuracionPorPlanta.length > 0 && (
            <Panel
              header={<span><i className="fa-solid fa-industry mr-2 text-primary" />Disponibilidad y curvas por planta</span>}
              toggleable
              className="mb-3"
            >
              <div className="flex flex-column gap-3">
                {material.configuracionPorPlanta
                  .filter((cfg) => cfg.activo !== false)
                  .map((cfg) => {
                    const factor = cfg.factorAjuste != null ? Number(cfg.factorAjuste) : 1.0;
                    const factorDelta = factor - 1.0;
                    const factorTexto = Math.abs(factorDelta) < 0.001
                      ? <span className="text-color-secondary">Sin efecto (1.000)</span>
                      : factorDelta > 0
                        ? <span style={{ color: 'var(--green-400)' }}><i className="fa-solid fa-arrow-up mr-1" />Rinde {(factorDelta * 100).toFixed(1)}% más</span>
                        : <span style={{ color: 'var(--orange-400)' }}><i className="fa-solid fa-arrow-down mr-1" />Rinde {(Math.abs(factorDelta) * 100).toFixed(1)}% menos</span>;
                    const precioVigente = cfg.precioVigente?.precioUnitario != null
                      ? `$ ${Number(cfg.precioVigente.precioUnitario).toLocaleString('es-AR')} / ${cfg.precioVigente.unidad || 'kg'}`
                      : <span className="text-color-secondary">— sin precio cargado —</span>;
                    const modoLabel = MODO_CURVA_LABELS[cfg.modoCurva] || cfg.modoCurva || 'Referencia general';
                    return (
                      <div
                        key={cfg.idCementoPlanta || cfg.idPlanta}
                        className="surface-card border-1 surface-border border-round p-3"
                      >
                        <div className="flex align-items-center gap-2 mb-2">
                          <i className="fa-solid fa-location-dot text-primary" />
                          <strong>{cfg.planta?.nombre || `Planta ${cfg.idPlanta}`}</strong>
                        </div>
                        <div className="grid">
                          <Field label="Modo de curva" value={modoLabel} col={4} />
                          <Field label="Factor de ajuste" value={<span><strong>{factor.toFixed(3)}</strong> &nbsp;{factorTexto}</span>} col={4} />
                          {cfg.curvaPropia?.nombre && <Field label="Curva propia" value={cfg.curvaPropia.nombre} col={4} />}
                          <Field label="Precio actual" value={precioVigente} col={4} />
                        </div>
                      </div>
                    );
                  })}
                {material.configuracionPorPlanta.filter((cfg) => cfg.activo !== false).length === 0 && (
                  <p className="text-color-secondary m-0">Este cemento no está habilitado en ninguna planta. No podrá usarse en dosificaciones.</p>
                )}
              </div>
            </Panel>
          )}

          {material.observaciones && (
            <Panel
              header={<span><i className="fa-solid fa-comment mr-2 text-primary" />Observaciones</span>}
              toggleable
              className="mb-3"
            >
              <p className="m-0" style={{ whiteSpace: 'pre-line' }}>{material.observaciones}</p>
            </Panel>
          )}
        </>
      )}

      {/* ── Section 1b: Características técnicas (aditivos) ── */}
      {source === 'aditivo' && (material.densidad || material.dosisMinima || material.reduccionAguaPct) && (
        <Panel header="Características técnicas" toggleable className="mb-3">
          <div className="grid">
            {material.densidad && <Field label="Densidad" value={`${material.densidad} g/cm³`} />}
            {material.solidosPct && <Field label="Sólidos" value={`${material.solidosPct} %`} />}
            {(material.dosisMinima || material.dosisMaxima) && (
              <Field label="Rango de dosis" value={`${material.dosisMinima || '—'} a ${material.dosisMaxima || '—'}${material.unidadDosificacion === 'PORC_SOBRE_CEMENTO' ? ' % s/cemento' : material.unidadDosificacion === 'ML_POR_100KG_CEMENTO' ? ' ml/100kg cem.' : material.unidadDosificacion === 'KG_M3' ? ' kg/m³' : ''}`} />
            )}
            {material.dosisHabitual && <Field label="Dosis habitual" value={`${material.dosisHabitual}${material.unidadDosificacion === 'PORC_SOBRE_CEMENTO' ? ' % s/cemento' : material.unidadDosificacion === 'ML_POR_100KG_CEMENTO' ? ' ml/100kg cem.' : material.unidadDosificacion === 'KG_M3' ? ' kg/m³' : ''}`} />}
            {material.reduccionAguaPct && <Field label="Reducción de agua esperada" value={`${material.reduccionAguaPct} %`} />}
            {material.incrementoAsentamiento && <Field label="Incremento asentamiento" value={`${material.incrementoAsentamiento} mm`} />}
            {material.retencionTrabajabilidad && <Field label="Retención trabajabilidad" value={`${material.retencionTrabajabilidad} min`} />}
            {material.observaciones && <Field label="Observaciones" value={material.observaciones} col={12} />}
          </div>
        </Panel>
      )}

      {/* ── Section 2: Caracterización ── */}
      {isAgregado && (
        <Panel header="Caracterización" toggleable className="mb-3">
          {hasCaract ? (
            <>
              <div className="flex flex-wrap gap-3">
                {/* Precisión y unidades resueltas desde lib/format/agregado.PRECISION_AGREGADO.
                    Cambiar la precisión de display de un parámetro requiere editar ese map. */}
                <CharCard label="MF" paramKey="mf" data={caracterizacion.mf} />
                {material.tipoAgregado === 'Grueso' && <CharCard label="TMN" paramKey="tmn" data={caracterizacion.tmn} />}
                <CharCard label="Dens. SSS" paramKey="densidadSSS" data={caracterizacion.densSSS} unit="" />
                <CharCard label="Dens. seca" paramKey="densidadSeca" data={caracterizacion.densSeca} unit="" />
                <CharCard label="Dens. real" paramKey="densidadReal" data={caracterizacion.densReal} unit="" />
                <CharCard label="Absorción" paramKey="absorcion" data={caracterizacion.absorcion} />
                <CharCard label="Pasa #200" paramKey="pasa200" data={caracterizacion.pasa200} />
                <CharCard label="PUC" paramKey="puc" data={caracterizacion.puc} />
                <CharCard label="PUS" paramKey="pus" data={caracterizacion.pus} />
                {caracterizacion.lajosidad && <CharCard label="Lajosidad" paramKey="lajosidad" data={caracterizacion.lajosidad} />}
                {caracterizacion.elongacion && <CharCard label="Elongación" paramKey="elongacion" data={caracterizacion.elongacion} />}
              </div>
              <small className="text-color-secondary block mt-2"><i className="pi pi-info-circle mr-1" />Valores derivados de los ensayos cargados.</small>
            </>
          ) : (
            <p className="text-color-secondary m-0">Sin ensayos de caracterización cargados.</p>
          )}
        </Panel>
      )}

      {/* ── Section: Cumplimiento normativo ── */}
      {isAgregado && ensayos.length > 0 && (
        <Panel header={`Cumplimiento normativo — CIRSOC 200-2024`} toggleable className="mb-3">
          <RequisitosBaseChecklist
            tipoAgregado={material.tipoAgregado}
            presentCodes={ensayos.map((e) => e.tipo?.codigo).filter(Boolean)}
          />
          <CumplimientoNormativoTable ensayos={ensayos} tipoAgregado={material.tipoAgregado || 'Fino'} />
        </Panel>
      )}

      {/* ── Section: Granulometría ── */}
      {isAgregado && (() => {
        const granEnsayo = ensayos.find(e => e.tipo?.codigo?.includes('GRANULOMETRIA') || e.tipo?.normaRef === 'IRAM 1505');
        const granResult = granEnsayo?.resultado;
        const g = typeof granResult === 'string' ? (() => { try { return JSON.parse(granResult); } catch { return null; } })() : granResult;
        const tamices = g?.granulometria?.tamices || [];
        if (tamices.length < 3) return null;
        const sorted = [...tamices].filter(t => t.pasaPct != null).sort((a, b) => a.aberturaMm - b.aberturaMm);
        const evalAuto = g?.granulometria?.evaluacionAuto;
        const evalBanda = g?.granulometria?.evaluacion;
        const mf = evalAuto?.moduloFinura?.valor ?? evalBanda?.calculos?.moduloFinura?.valor ?? null;
        const tmn = g?.granulometria?.evaluacionAutoGrueso?.tmnMm ?? evalBanda?.calculos?.tmn?.valor ?? null;

        try {
          const Chart = require('primereact/chart').Chart;
          const chartData = {
            datasets: [{
              label: 'Medida',
              data: sorted.map(t => ({ x: t.aberturaMm, y: t.pasaPct })),
              borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)',
              pointBackgroundColor: '#3B82F6', pointBorderColor: '#fff', pointBorderWidth: 2,
              pointRadius: 5, borderWidth: 2.5, tension: 0, fill: true,
            }],
          };
          // Add bands if available
          if (evalAuto?.bandaAB?.detalle?.length) {
            chartData.datasets.push({
              label: 'Lím. sup. (Curva B)', data: evalAuto.bandaAB.detalle.map(d => ({ x: d.aberturaMm, y: d.limSup })),
              borderColor: 'rgba(239,68,68,0.6)', borderDash: [5, 3], pointRadius: 0, tension: 0, fill: false, borderWidth: 1.5,
            }, {
              label: 'Lím. inf. (Curva A)', data: evalAuto.bandaAB.detalle.map(d => ({ x: d.aberturaMm, y: d.limInf })),
              borderColor: 'rgba(34,197,94,0.6)', borderDash: [5, 3], pointRadius: 0, tension: 0, fill: '-1', backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1.5,
            });
          } else if (evalBanda?.detalle?.length) {
            chartData.datasets.push({
              label: 'Lím. sup.', data: evalBanda.detalle.filter(d => d.limSup != null).map(d => ({ x: d.aberturaMm, y: d.limSup })),
              borderColor: 'rgba(239,68,68,0.6)', borderDash: [5, 3], pointRadius: 0, tension: 0, fill: false, borderWidth: 1.5,
            }, {
              label: 'Lím. inf.', data: evalBanda.detalle.filter(d => d.limInf != null).map(d => ({ x: d.aberturaMm, y: d.limInf })),
              borderColor: 'rgba(34,197,94,0.6)', borderDash: [5, 3], pointRadius: 0, tension: 0, fill: '-1', backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1.5,
            });
          }
          const chartOpts = {
            responsive: true, maintainAspectRatio: false, devicePixelRatio: 3,
            scales: {
              x: { type: 'logarithmic', title: { display: true, text: 'Abertura (mm)', font: { size: 13, weight: 'bold' } }, ticks: { callback: v => v, font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { min: 0, max: 100, title: { display: true, text: '% Pasa', font: { size: 13, weight: 'bold' } }, ticks: { stepSize: 10, font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.08)' } },
            },
            plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 12 }, padding: 16 } } },
          };

          // P0.9 / v2 audit — usar el estado consolidado del validador único
          // (`resultadoGlobal`) en lugar de leer `bandaAB.cumple` plano.
          // `cumple_con_tolerancia` se trata como pase válido §3.2.4.
          const estadoAB = evalAuto?.resultadoGlobal?.bandaAB; // 'cumple' | 'cumple_con_tolerancia' | 'no_cumple'
          const estadoAC = evalAuto?.resultadoGlobal?.bandaAC; // 'cumple' | 'no_cumple'
          const tolPp = evalAuto?.tolerancia_3_2_4?.excesoTotal ?? evalAuto?.tolerancia10pp?.excesoTotal;

          // Discrepancia curva objetivo vs Tabla 3.5 (grueso). Surge cuando el
          // usuario elige una curva fraccionada que difiere de la banda que la
          // heurística sugeriría por TMN — lo exponemos para que el usuario
          // confirme que la selección es la correcta.
          const discrepancia = g?.granulometria?._discrepanciaBanda;

          // Tabla por tamiz mostrando AMBAS bandas (P3.3): el usuario tiene
          // que poder ver por qué un valor está marcado FUERA en cada banda.
          const tamicesTabla = (evalAuto?.bandaAB?.detalle || []).map((dAB) => {
            const dAC = evalAuto?.bandaAC?.detalle?.find((x) => Math.abs(x.aberturaMm - dAB.aberturaMm) < 0.01);
            return {
              aberturaMm: dAB.aberturaMm,
              pasa: dAB.pasa,
              abInf: dAB.limInf,
              abSup: dAB.limSup,
              acInf: dAC?.limInf,
              acSup: dAC?.limSup,
              estadoAB: dAB.estado,
              estadoAC: dAC?.estado,
            };
          });

          return (
            <Panel header="Granulometría" toggleable className="mb-3">
              <div className="flex align-items-center gap-3 mb-2 flex-wrap">
                {mf != null && <span className="text-sm">MF: <strong>{formatParamValue('mf', mf)}</strong></span>}
                {tmn != null && <span className="text-sm">TMN: <strong>{formatParamValue('tmn', tmn)} mm</strong></span>}
              </div>
              {discrepancia && (
                <div className="mb-2 p-2 border-round" style={{ backgroundColor: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)' }}>
                  <div className="flex align-items-start gap-2">
                    <i className="pi pi-exclamation-triangle" style={{ color: '#ca8a04', fontSize: '1.1rem', marginTop: '2px' }} />
                    <div className="text-sm">
                      <strong style={{ color: '#92400e' }}>Atención &mdash; Discrepancia de banda</strong>
                      <div className="mt-1 text-color-secondary">{discrepancia.mensaje}</div>
                    </div>
                  </div>
                </div>
              )}
              <div style={{position: 'relative', height: 'clamp(200px, 40vh, 320px)'}}>
                <Chart type="line" data={chartData} options={chartOpts} style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%'}} />
              </div>
              {evalAuto && (
                <div className="flex gap-3 mt-2 flex-wrap">
                  {/* C6: Tags de banda A-B/A-C con categorías canónicas.
                      `cumple_con_tolerancia` (§3.2.4) se mapea a APTO_CON_OBSERVACIONES,
                      `cumple` a APTO, `no_cumple` a NO_APTO. Los sub-aspectos NO se
                      sobreescriben con compliance global (mismo patrón que C3 y C4). */}
                  {estadoAB === 'cumple' && (() => {
                    const cfg = CATEGORIA_COLORS[VEREDICTO.APTO];
                    return <Tag value={`Banda A-B: ${VEREDICTO.APTO}`} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  {estadoAB === 'cumple_con_tolerancia' && (() => {
                    const cfg = CATEGORIA_COLORS[VEREDICTO.APTO_CON_OBSERVACIONES];
                    return <Tag value={`Banda A-B: ${VEREDICTO.APTO_CON_OBSERVACIONES} §3.2.4 (Σ${tolPp ?? '?'} pp)`} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  {estadoAB === 'no_cumple' && (() => {
                    const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APTO];
                    return <Tag value={`Banda A-B: ${VEREDICTO.NO_APTO}`} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  {estadoAC === 'cumple' && (() => {
                    // §3.2.5 — apto solo en obras corrientes con control en obra: APTO CON OBSERVACIONES
                    const cfg = CATEGORIA_COLORS[VEREDICTO.APTO_CON_OBSERVACIONES];
                    return <Tag value={`Banda A-C: ${VEREDICTO.APTO_CON_OBSERVACIONES} (§3.2.5 obras corrientes)`} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                  {estadoAC === 'no_cumple' && (() => {
                    const cfg = CATEGORIA_COLORS[VEREDICTO.NO_APTO];
                    return <Tag value={`Banda A-C: ${VEREDICTO.NO_APTO}`} severity={cfg.severity} icon={cfg.icon} />;
                  })()}
                </div>
              )}
              {evalAuto?.implicancias && (
                <div className="mt-2 p-2 surface-100 border-round" style={{ fontSize: '0.85rem' }}>
                  {evalAuto.implicancias.split('\n').map((line, i) => (
                    <div key={i} className="text-color-secondary">{line}</div>
                  ))}
                </div>
              )}
              {tamicesTabla.length > 0 && (
                <div className="mt-3">
                  <small className="text-color-secondary block mb-1">Detalle por tamiz vs bandas IRAM 1627</small>
                  <DataTable responsiveLayout="scroll" value={tamicesTabla} size="small" stripedRows>
                    <Column header="Tamiz (mm)" body={(r) => formatParamValue('aberturaTamiz', r.aberturaMm)} className="text-center" style={{ width: 70 }} />
                    <Column header="% Pasa"     body={(r) => r.pasa != null ? formatParamValue('pasaPctTamiz', r.pasa) : '—'} className="text-center font-bold" style={{ width: 70 }} />
                    <Column header="A-B inf"    body={(r) => r.abInf} className="text-center text-color-secondary" style={{ width: 60 }} />
                    <Column header="A-B sup"    body={(r) => r.abSup} className="text-center text-color-secondary" style={{ width: 60 }} />
                    <Column header="A-C inf"    body={(r) => r.acInf} className="text-center text-color-secondary" style={{ width: 60 }} />
                    <Column header="A-C sup"    body={(r) => r.acSup} className="text-center text-color-secondary" style={{ width: 60 }} />
                    <Column
                      header="A-B"
                      body={(r) => (
                        <span style={{ color: r.estadoAB === 'OK' ? '#059669' : '#dc2626', fontWeight: 600 }}>
                          {r.estadoAB === 'OK' ? '✓' : 'FUERA'}
                        </span>
                      )}
                      className="text-center" style={{ width: 60 }}
                    />
                    <Column
                      header="A-C"
                      body={(r) => (
                        <span style={{ color: r.estadoAC === 'OK' ? '#059669' : '#dc2626', fontWeight: 600 }}>
                          {r.estadoAC === 'OK' ? '✓' : 'FUERA'}
                        </span>
                      )}
                      className="text-center" style={{ width: 60 }}
                    />
                  </DataTable>
                </div>
              )}
              {evalBanda && !evalAuto && (() => {
                // C6: tag de banda manual con categoría canónica.
                const cat = evalBanda.cumple ? VEREDICTO.APTO : VEREDICTO.NO_APTO;
                const cfg = CATEGORIA_COLORS[cat];
                const label = evalBanda.cumple ? 'Cumple banda' : `No cumple (${evalBanda.stats?.nFuera || 0} fuera)`;
                return <Tag value={label} severity={cfg.severity} icon={cfg.icon} className="mt-2" />;
              })()}
              <div className="mt-2">
                <small className="text-color-secondary">Ensayo: {granEnsayo.fechaEnsayo ? new Date(granEnsayo.fechaEnsayo).toLocaleDateString('es-AR') : '—'} · {granEnsayo.laboratorio || ''} · {granEnsayo.nroInforme || ''}</small>
              </div>
            </Panel>
          );
        } catch { return null; }
      })()}

      {/* ── Section 3: Ensayos ── (Prompt 3 C6: counters extendidos + categorías canónicas) */}
      <Panel header="Ensayos" toggleable className="mb-3">
        {ensayoSummary.length > 0 ? (
          <>
            <div className="flex align-items-center gap-3 mb-3 flex-wrap">
              {/* Counters extendidos: una entrada por categoría con valor > 0.
                  Cambio observable inmediato vs el counter binario legacy:
                  ensayos en Hybrid Option B (Petrográfico reactivo, RAS reactivo,
                  granulometría individual fuera de banda, materias carbonosas zona
                  dual, estabilidad basálticas zona dual) ya no contaminan
                  "No cumplen" — aparecen en su categoría correspondiente. */}
              {[
                VEREDICTO.APTO,
                VEREDICTO.APTO_CON_OBSERVACIONES,
                VEREDICTO.APTITUD_CONDICIONADA,
                VEREDICTO.NO_APTO,
                VEREDICTO.EVALUACION_INCOMPLETA,
                VEREDICTO.INFORMATIVO,
                VEREDICTO.NO_APLICA,
              ].filter(cat => counts[cat] > 0).map((cat) => {
                const cfg = CATEGORIA_COLORS[cat];
                return (
                  <Tag key={cat}
                    value={`${counts[cat]} ${cat}`}
                    severity={cfg.severity}
                    icon={cfg.icon}
                  />
                );
              })}
              <div className="flex-1" />
              {ensayosRoute && <Button label="Ver todos" icon="fa-solid fa-list" className="p-button-outlined p-button-sm" onClick={() => navigate(ensayosRoute)} />}
            </div>
            <DataTable responsiveLayout="scroll" value={ensayoSummary} size="small" stripedRows>
              <Column field="nombre" header="Ensayo" style={{ maxWidth: 250 }} />
              <Column field="norma" header="Norma" style={{ maxWidth: 100 }} />
              <Column field="valor" header="Resultado" style={{ maxWidth: 150 }} />
              <Column field="categoria" header="Estado" style={{ maxWidth: 160 }} body={(row) => {
                const cfg = CATEGORIA_COLORS[row.categoria] || CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
                // PR4: tooltip extendido en ensayos rescatados por política del catálogo
                // (obligatorio=false). El estado visible es 'INFORMATIVO' pero el
                // resultado original era 'NO APTO' — exponer al usuario la razón.
                const tooltip = row.wasFailNonMandatory
                  ? "Este ensayo dio fuera de norma pero el catálogo lo declaró no obligatorio para este contexto. No bloquea aptitud. Click para ver detalle."
                  : row.evalMsg;
                return (
                  <span className="flex align-items-center gap-1">
                    <Tag value={row.categoria} severity={cfg.severity} icon={cfg.icon} className="mat-help-icon" data-pr-tooltip={tooltip} data-pr-position="top" />
                    {row.wasFailNonMandatory && (
                      <i
                        className="fa-solid fa-circle-info text-orange-500 text-xs mat-help-icon"
                        data-pr-tooltip={tooltip}
                        data-pr-position="top"
                        style={{ cursor: 'help' }}
                      />
                    )}
                  </span>
                );
              }} />
              <Column field="fecha" header="Fecha" style={{ maxWidth: 90 }} body={(row) => fmtDate(row.fecha)} />
              <Column field="vencimiento" header="Vence" style={{ maxWidth: 90 }} body={(row) => fmtDate(row.vencimiento)} />
            </DataTable>
          </>
        ) : (
          <div className="text-center p-4 text-color-secondary">
            <i className="fa-solid fa-flask text-4xl mb-2 block" style={{ opacity: 0.3 }} />
            <p>No hay ensayos cargados para este material.</p>
            {ensayosRoute && <Button label="Ir a ensayos" icon="fa-solid fa-arrow-right" className="p-button-outlined p-button-sm" onClick={() => navigate(ensayosRoute)} />}
          </div>
        )}
      </Panel>

      {/* ── Section 3.5: Vista normativa CIRSOC (PR4) ── */}
      {/* Panel adicional independiente del catálogo del tenant. Para auditoría /
          supervisión externa. Lazy-load al expandir para no agregar peso a la
          carga inicial. */}
      {isAgregado && (
        <Panel
          header="Vista normativa CIRSOC (auditoría / supervisión)"
          toggleable
          collapsed
          onExpand={async () => {
            if (vistaNormativa || vistaNormativaLoading) return;
            setVistaNormativaLoading(true);
            setVistaNormativaError(null);
            try {
              const url = `${config.backendUrl}/api/agregados-ensayos/vista-normativa/${sourceId}`;
              const r = await axios.get(url, { headers: headers() });
              setVistaNormativa(r.data);
            } catch (err) {
              console.error('[MaterialDetail] vista normativa error:', err);
              setVistaNormativaError(err.response?.data?.error || 'No se pudo cargar la vista normativa.');
            } finally {
              setVistaNormativaLoading(false);
            }
          }}
          className="mb-3"
        >
          {vistaNormativaLoading && (
            <div className="text-center p-3 text-color-secondary">
              <i className="pi pi-spin pi-spinner mr-2" />Calculando vista normativa…
            </div>
          )}
          {vistaNormativaError && (
            <p className="text-red-600 m-0">{vistaNormativaError}</p>
          )}
          {vistaNormativa && (() => {
            const v = vistaNormativa.verificacion;
            const items = v?.items || [];
            const veredictoCat = getCategoriaVeredicto(v?.compliance);
            const cfgVer = CATEGORIA_COLORS[veredictoCat] || CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
            return (
              <div className="flex flex-column gap-3">
                <div className="text-sm text-color-secondary">{vistaNormativa.nota}</div>
                <div className="flex align-items-center gap-2 flex-wrap">
                  <span className="font-semibold">Veredicto bajo norma completa:</span>
                  <Tag value={veredictoCat} severity={cfgVer.severity} icon={cfgVer.icon} />
                  <span className="text-xs text-color-secondary">
                    Contexto evaluado: clase <strong>{vistaNormativa.contexto.claseExposicion}</strong>,
                    fc <strong>{vistaNormativa.contexto.fc}</strong> MPa,
                    {vistaNormativa.contexto.expuestoDesgaste ? ' con desgaste' : ' sin desgaste'},
                    {vistaNormativa.contexto.aspectoSuperficialImportante ? ' aspecto importante' : ' aspecto no crítico'}.
                  </span>
                </div>
                {items.length === 0 ? (
                  <p className="text-color-secondary m-0">No hay parámetros evaluables.</p>
                ) : (
                  <DataTable value={items} size="small" stripedRows responsiveLayout="scroll">
                    <Column field="parametro" header="Parámetro" />
                    <Column field="valor" header="Valor" style={{ maxWidth: 110 }} body={(row) =>
                      row.valor != null
                        ? <span>{row.valor}{row.unidad ? ` ${row.unidad}` : ''}</span>
                        : <span className="text-color-secondary">—</span>
                    } />
                    <Column header="Límite" style={{ maxWidth: 130 }} body={(row) => {
                      if (row.maxStrict != null && row.maxStandard != null) {
                        return <span className="text-xs">≤ {row.maxStrict} / {row.maxStandard}</span>;
                      }
                      if (row.max != null) return <span className="text-xs">≤ {row.max}</span>;
                      return <span className="text-color-secondary">—</span>;
                    }} />
                    <Column field="estado" header="Estado" style={{ maxWidth: 150 }} body={(row) => {
                      const cat = getCategoriaVeredicto(row.compliance) || row.estado;
                      const cfg = CATEGORIA_COLORS[cat] || CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
                      return <Tag value={cat} severity={cfg.severity} icon={cfg.icon} title={row.detalle || ''} />;
                    }} />
                    <Column field="norma" header="Norma" style={{ maxWidth: 110 }} body={(row) =>
                      <span className="text-xs">{row.norma}{row.apartado ? ` ${row.apartado}` : ''}</span>
                    } />
                  </DataTable>
                )}
                {(v?.notas?.length > 0) && (
                  <div className="text-xs text-color-secondary">
                    <strong>Notas del motor:</strong>
                    <ul className="m-0 pl-3">{v.notas.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </div>
                )}
              </div>
            );
          })()}
        </Panel>
      )}

      {/* ── Section 4: Dosificaciones vinculadas ── */}
      <Panel
        header={`Dosificaciones vinculadas${dosifVinculadas?.length ? ` (${dosifVinculadas.length})` : ''}`}
        toggleable
        collapsed={!dosifVinculadas?.length}
        className="mb-3"
      >
        {dosifVinculadas?.length > 0 ? (
          <DataTable responsiveLayout="scroll" value={dosifVinculadas} size="small" stripedRows>
            <Column header="Código" body={(row) => <span className="font-bold">{row.codigo || `#${row.id}`}</span>} style={{maxWidth: 140}} />
            <Column header="Nombre" field="nombre" />
            <Column header="Estado" body={(row) => <Tag value={row.estado} severity={row.estado === 'APROBADO' ? 'success' : row.estado === 'BORRADOR' ? 'info' : 'warning'} />} style={{maxWidth: 110}} />
            <Column header="Mezcla" field="mezclaNombre" style={{maxWidth: 180}} />
            <Column header="Fecha" body={(row) => row.createdAt ? new Date(row.createdAt).toLocaleDateString('es-AR') : '—'} style={{maxWidth: 100}} />
          </DataTable>
        ) : (
          <p className="text-color-secondary m-0">Este material no está vinculado a ninguna dosificación.</p>
        )}
      </Panel>

      {/* Ficha técnica modal */}
      {isAgregado && fichaTecnicaVisible && (
        <FichaTecnicaModal
          visible={fichaTecnicaVisible}
          onHide={() => setFichaTecnicaVisible(false)}
          legacyAgregadoId={sourceId}
          agregadoNombre={material.nombre}
          agregadoTipo={material.tipoAgregado || 'Fino'}
          caract={pdfCaract || undefined}
          ensayos={ensayos?.length > 0 ? ensayos : undefined}
          resumen={pdfResumen || undefined}
        />
      )}

      {/* Destino de uso para emisión de certificado/informe */}
      <DestinoUsoDialog
        visible={destinoDialogVisible}
        onHide={() => setDestinoDialogVisible(false)}
        onConfirm={async (ctx) => {
          setDestinoDialogVisible(false);
          await emitirDocumento(ctx);
        }}
      />

      <CertificateApprovalDialog
        visible={approvalDialog.visible}
        onHide={() => setApprovalDialog({ visible: false, context: null, razon: null })}
        approvalContext={approvalDialog.context}
        razon={approvalDialog.razon}
        tipoDocumento="CERTIFICADO"
        idMaterial={material?.idMaterial || Number(sourceId)}
        onSolicitado={() => {
          toast?.current?.show?.({
            severity: 'info',
            summary: 'Firma solicitada',
            detail: 'El pedido quedó pendiente en el panel del Director Técnico.',
            life: 5000,
          });
        }}
      />
    </div>
  );
}

/* ── Helper: field in datos generales ── */
function Field({ label, value, col }) {
  return (
    <div className={`col-${col || 6} md:col-${col ? Math.min(col, 12) : 4} mb-2`}>
      <label className="text-xs text-color-secondary block">{label}</label>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}

/* ── Helper: characterisation card ── */
/**
 * Calcula el estado de vigencia de un ensayo a partir de su fechaVencimiento.
 * Retorna { dias, estado, color, texto } o null si no hay fecha.
 *   estado: 'vencido' | 'critico' (≤7d) | 'proximo' (≤30d) | 'ok'
 */
function evaluarVigencia(fechaVencimiento) {
  if (!fechaVencimiento) return null;
  const venc = new Date(fechaVencimiento);
  if (isNaN(venc.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((venc - hoy) / 86400000);
  if (dias < 0)        return { dias, estado: 'vencido',  color: '#dc2626', texto: `Vencido hace ${Math.abs(dias)}d` };
  if (dias <= 7)       return { dias, estado: 'critico',  color: '#dc2626', texto: `Vence en ${dias}d` };
  if (dias <= 30)      return { dias, estado: 'proximo',  color: '#d97706', texto: `Vence en ${dias}d` };
  return { dias, estado: 'ok', color: '#059669', texto: `Vigente (${dias}d)` };
}

function CharCard({ label, data, unit, paramKey }) {
  if (!data) return (
    <div className="surface-100 border-round p-3 text-center" style={{ minWidth: 110 }}>
      <small className="text-color-secondary block mb-1">{label}</small>
      <div className="text-lg font-bold" style={{ color: '#666' }}>—</div>
      <small className="text-color-secondary block">Sin ensayo</small>
    </div>
  );
  // Formato unificado es-AR vía PRECISION_AGREGADO: coma decimal, punto miles
  // cuando aplica (PUC/PUS, mg/kg), precisión exacta por parámetro.
  const valorFmt = Number.isFinite(Number(data.valor))
    ? formatParamValue(paramKey, data.valor, { fallback: String(data.valor) })
    : String(data.valor);
  const effectiveUnit = unit !== undefined ? unit : (paramKey ? specFor(paramKey).unit : '');
  const display = effectiveUnit ? `${valorFmt} ${effectiveUnit}` : valorFmt;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
  const vig = evaluarVigencia(data.vence);
  // Borde izquierdo de aviso solo si hay urgencia (vencido / crítico / próximo)
  const borderClass = vig && vig.estado !== 'ok' ? 'border-left-3' : '';
  return (
    <div
      className={`surface-100 border-round p-3 text-center ${borderClass}`}
      style={{ minWidth: 110, borderLeftColor: vig && vig.estado !== 'ok' ? vig.color : undefined }}
      title={vig ? vig.texto : undefined}
    >
      <small className="text-color-secondary block mb-1">{label}</small>
      <div className="text-lg font-bold text-primary">{display}</div>
      <small className="text-color-secondary block">{fmtDate(data.fecha)}</small>
      {vig && (
        <small className="block mt-1" style={{ color: vig.color, fontSize: '0.7rem' }}>
          {vig.texto}
        </small>
      )}
    </div>
  );
}

/* ── Helper: ensayos requeridos vs presentes (P1.9) ── */
function RequisitosBaseChecklist({ tipoAgregado, presentCodes = [] }) {
  // Lazy import dinámico para no acoplar el bundle si la sección no se renderiza
  const [requeridos, setRequeridos] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('../../../lib/compliance/requisitosEnsayos');
      const tipo = (tipoAgregado || '').toLowerCase() === 'fino' ? 'FINO'
                 : (tipoAgregado || '').toLowerCase() === 'grueso' ? 'GRUESO'
                 : null;
      if (!tipo) { setRequeridos([]); return; }
      const r = mod.getEnsayosRequeridos({ tipoAgregado: tipo })
        .map((item) => ({ ...item, nombre: mod.getDisplayName(item.codigo) }));
      if (!cancelled) setRequeridos(r);
    })();
    return () => { cancelled = true; };
  }, [tipoAgregado]);

  if (!requeridos.length) return null;
  const presentes = new Set(presentCodes);
  const faltantes = requeridos.filter((r) => !presentes.has(r.codigo));
  const presentesCount = requeridos.length - faltantes.length;

  return (
    <div className="mb-3 p-3 surface-100 border-round">
      <div className="flex align-items-center justify-content-between mb-2">
        <strong className="text-sm">
          <i className="fa-solid fa-clipboard-check mr-2 text-primary" />
          Ensayos requeridos (base universal): {presentesCount}/{requeridos.length}
        </strong>
        {faltantes.length === 0 && (
          <Tag value="Completo" severity="success" />
        )}
        {faltantes.length > 0 && (
          <Tag value={`Faltan ${faltantes.length}`} severity="warning" />
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {requeridos.map((r) => {
          const ok = presentes.has(r.codigo);
          return (
            <span
              key={r.codigo}
              className="inline-flex align-items-center gap-1 px-2 py-1 border-round text-xs"
              style={{
                backgroundColor: ok ? 'rgba(34,197,94,0.12)' : 'rgba(217,119,6,0.12)',
                color: ok ? '#059669' : '#d97706',
                fontWeight: 500,
              }}
              title={`${r.codigo} — ${r.motivo}`}
            >
              <i className={`fa-solid ${ok ? 'fa-check' : 'fa-xmark'}`} />
              {r.nombre || r.codigo}
            </span>
          );
        })}
      </div>
      <small className="block mt-2 text-color-secondary text-xs">
        Esta es la base universal de ensayos requeridos por destino. Si elegís un destino con desgaste,
        clase Q1-Q3 o f'c ≥ 35 al emitir el certificado, se sumarán requisitos adicionales.
      </small>
    </div>
  );
}
