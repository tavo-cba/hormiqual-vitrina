import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";

import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import { useUserContext } from "../../../context/UserContext";
import { getDosificaciones, getDosificacion } from "../../../services/dosificacionDisenoService";
import { deriveTrazabilidadConsistente } from "../../../lib/dosificacion/trazabilidadPostAjuste";
import { generarInformeDosificacionPdf } from "../dosificacion-diseno/dosificacionInformePdf";
import {
  SECCIONES_AGREGADO,
  SECCIONES_MEZCLA,
  SECCIONES_DOSIFICACION,
} from "../common/PdfSectionSelector";

/**
 * CU8 — Informe técnico configurable (variante MÍNIMA).
 *
 * Pantalla de dos paneles:
 *   IZQUIERDA  → configuración: tipo de informe, origen (planta), destinatario,
 *                plantilla (modo de reporte) + grilla de selección de secciones.
 *   DERECHA    → previsualización del PDF en <iframe> (visor nativo del navegador,
 *                sin pdfjs) + botón de descarga.
 *
 * Generación: reutiliza `generarInformeDosificacionPdf` con `outputMode:'doc'`
 * (devuelve el jsPDF) → `doc.output('bloburl')` para el preview, y `outputMode:'save'`
 * para la descarga. El snapshot se arma desde una DosificacionDisenada guardada,
 * espejando `buildSavedSnapshot` del Diseñador (mismo mecanismo, autocontenido para
 * no acoplar esta pantalla al estado del Diseñador).
 *
 * La generación de fichas de Agregado / Mezcla vive en sus propias pantallas; acá el
 * tipo cambia la grilla de secciones pero el preview se habilita para DOSIFICACIÓN.
 */

const TIPO_OPTIONS = [
  { label: "Dosificación", value: "DOSIFICACION" },
  { label: "Mezcla de agregados", value: "MEZCLA" },
  { label: "Ficha de agregado", value: "AGREGADO" },
];

const SECCIONES_MAP = {
  AGREGADO: SECCIONES_AGREGADO,
  MEZCLA: SECCIONES_MEZCLA,
  DOSIFICACION: SECCIONES_DOSIFICACION,
};

const PLANTILLA_OPTIONS = [
  { label: "Estándar (desarrollo prestacional)", value: "PRESTACIONAL" },
  { label: "Auditoría / licitación (cumplimiento estricto)", value: "NORMATIVO_ESTRICTO" },
];

const DEBOUNCE_MS = 500;

function parseStoredJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Arma el snapshot que consume `generarInformeDosificacionPdf` a partir de una fila
 * DosificacionDisenada (con asociaciones incluidas por GET /dosificaciones-diseno/:id).
 * Espejo autocontenido de `buildSavedSnapshot` del Diseñador.
 */
function buildSnapshotFromRow(row) {
  const params = parseStoredJson(row?.parametrosObjetivoJson) || {};
  const storedResultado = parseStoredJson(row?.resultadoJson);
  const storedTrazabilidad = parseStoredJson(row?.trazabilidadJson);

  const modoFceSaved = row?.tipoHormigonModoFce === "OBJETIVO" ? "OBJETIVO" : "ESPECIFICADO";
  const fcmSaved = params?.fce != null
    ? Math.round(
        (modoFceSaved === "OBJETIVO"
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
    return `${c.nombre}${c.tmnMm ? ` (TMN ${c.tmnMm})` : ""}`;
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
    cementoLabel: row?.cemento
      ? `${row.cemento.nombreComercial || "Sin nombre"} — ${row.cemento.composicion || ""}`.trim()
      : null,
    cementoFamilia: row?.cemento?.familiaCemento || row?.cemento?.composicion || null,
    adiciones: [
      row?.idAdicion1 ? { label: row?.adicion1?.nombre || `Adición ${row.idAdicion1}`, reemplazoPct: row?.pctReemplazoAdicion1 } : null,
      row?.idAdicion2 ? { label: row?.adicion2?.nombre || `Adición ${row.idAdicion2}`, reemplazoPct: row?.pctReemplazoAdicion2 } : null,
    ].filter(Boolean),
    aditivos: [
      row?.idAditivo1 ? { label: row?.aditivo1?.marca || `Aditivo ${row.idAditivo1}`, dosis: row?.dosisAditivo1 != null ? Number(row.dosisAditivo1) : null, modoEfecto: row?.modoEfectoAditivo1, etapa: row?.etapaAditivo1 || "PLANTA", esCorreccion: row?.esCorreccionAditivo1 === true || row?.esCorreccionAditivo1 === 1 } : null,
      row?.idAditivo2 ? { label: row?.aditivo2?.marca || `Aditivo ${row.idAditivo2}`, dosis: row?.dosisAditivo2 != null ? Number(row.dosisAditivo2) : null, modoEfecto: row?.modoEfectoAditivo2, etapa: row?.etapaAditivo2 || "PLANTA", esCorreccion: row?.esCorreccionAditivo2 === true || row?.esCorreccionAditivo2 === 1 } : null,
      row?.idAditivo3 ? { label: row?.aditivo3?.marca || `Aditivo ${row.idAditivo3}`, dosis: row?.dosisAditivo3 != null ? Number(row.dosisAditivo3) : null, modoEfecto: row?.modoEfectoAditivo3, etapa: row?.etapaAditivo3 || "PLANTA", esCorreccion: row?.esCorreccionAditivo3 === true || row?.esCorreccionAditivo3 === 1 } : null,
    ].filter(Boolean),
    curvaTeoricaRef,
    curvaTeoricaFamilia: row?.mezcla?.curvaTeorica?.familia || null,
    curvaTeoricaParams: row?.mezcla?.curvaTeorica?.parametros
      ? parseStoredJson(row.mezcla.curvaTeorica.parametros)
      : null,
    tipologiaCodigo: row?.tipologiaCodigo || params?.tipologiaCodigo || "convencional",
    resultado: storedResultado,
    trazabilidad: deriveTrazabilidadConsistente(storedResultado, storedTrazabilidad),
    warnings: [],
    correccionHumedad: null,
    humedadAgregados: params?.humedadAgregados || null,
    estado: row?.estado || "BORRADOR",
    version: row?.version || 1,
    aprobadoPor: row?.aprobadoPor || null,
    fechaAprobacion: row?.fechaAprobacion || null,
    // Defaults seguros para campos opcionales que el generador puede leer.
    overrideActivo: row?.overrideActivo || null,
    pastones: [],
    aptitudMateriales: null,
    redosificaciones: [],
    prediccionFresco: null,
    correccionesPostPaston: [],
    numeroRondaPrueba: row?.numeroRondaPrueba || 1,
  };
}

export default function InformeConfigurablePage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const cfg = useConfig();
  const { user } = useUserContext();

  // ── catálogos ──
  const [dosifList, setDosifList] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [listLoading, setListLoading] = useState(true);

  // ── configuración (panel izquierdo) ──
  const [tipo, setTipo] = useState("DOSIFICACION");
  const [idDosif, setIdDosif] = useState(routeId ? Number(routeId) : null);
  const [origenPlanta, setOrigenPlanta] = useState(null);
  const [destinatario, setDestinatario] = useState("");
  const [plantilla, setPlantilla] = useState("PRESTACIONAL");
  const [titulo, setTitulo] = useState("");
  const [secciones, setSecciones] = useState({});

  // ── dosificación cargada + preview ──
  const [dosifRow, setDosifRow] = useState(null);
  const [rowLoading, setRowLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const blobUrlRef = useRef(null);
  const debounceRef = useRef(null);

  const seccionesDef = SECCIONES_MAP[tipo] || SECCIONES_DOSIFICACION;
  const grupos = useMemo(() => [...new Set(seccionesDef.map((s) => s.grupo))], [seccionesDef]);

  /* ── cargar catálogos (dosificaciones + plantas) ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      try {
        const [dosifs, plantasRes] = await Promise.all([
          getDosificaciones().catch(() => []),
          axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }).then((r) => r.data).catch(() => []),
        ]);
        if (cancelled) return;
        setDosifList(Array.isArray(dosifs) ? dosifs : []);
        const plOpts = (Array.isArray(plantasRes) ? plantasRes : []).map((p) => ({
          label: p.nombre || `Planta ${p.idPlanta}`,
          value: p.idPlanta,
        }));
        setPlantas(plOpts);
        if (plOpts.length === 1) setOrigenPlanta(plOpts[0].value);
      } catch (err) {
        console.error("No se pudieron cargar los catálogos del informe:", err);
        showToast("error", "No se pudieron cargar las listas de dosificaciones / plantas");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  /* ── inicializar secciones al cambiar de tipo ── */
  useEffect(() => {
    const init = {};
    for (const sec of seccionesDef) init[sec.key] = sec.default;
    setSecciones(init);
  }, [seccionesDef]);

  /* ── cargar la dosificación elegida ── */
  useEffect(() => {
    if (tipo !== "DOSIFICACION" || !idDosif) { setDosifRow(null); return; }
    let cancelled = false;
    (async () => {
      setRowLoading(true);
      setError(null);
      try {
        const row = await getDosificacion(idDosif);
        if (cancelled) return;
        if (!row) { setError("No se encontró la dosificación seleccionada."); setDosifRow(null); return; }
        setDosifRow(row);
        if (!titulo) setTitulo(row.nombre ? `Informe de dosificación — ${row.nombre}` : "");
        if (row.idPlanta && !origenPlanta) setOrigenPlanta(row.idPlanta);
      } catch (err) {
        console.error("Error cargando la dosificación para el informe:", err);
        if (!cancelled) { setError("No se pudo cargar la dosificación."); setDosifRow(null); }
      } finally {
        if (!cancelled) setRowLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idDosif, tipo]);

  const setBlob = useCallback((url) => {
    if (blobUrlRef.current) { try { URL.revokeObjectURL(blobUrlRef.current); } catch {} }
    blobUrlRef.current = url;
    setBlobUrl(url);
  }, []);

  /* ── generar el PDF (preview 'doc' o descarga 'save') ── */
  const generar = useCallback(async (outputMode) => {
    if (!dosifRow) return null;
    const snap = buildSnapshotFromRow(dosifRow);
    if (!snap.resultado) {
      throw new Error("La dosificación seleccionada no tiene un resultado calculado para generar el informe.");
    }
    const doc = await generarInformeDosificacionPdf({
      snapshot: { ...snap, reportMode: plantilla },
      empresa: cfg?.nombreEmpresa,
      planta: snap?.plantaLabel,
      usuario: user ? `${user.name || ""} ${user.lastname || ""}`.trim() : null,
      logoUrl: cfg?.thumbnail,
      titulo: titulo?.trim() || null,
      includeAnexo: secciones.anexoTecnico ?? false,
      includeGlosario: secciones.glosario ?? true,
      includeFullTrace: secciones.anexoTecnico ?? false,
      includeCostos: secciones.costos ?? false,
      costosData: null,
      includeAnexoMateriales: secciones.anexoMateriales ?? false,
      materialesData: null,
      includeHistorial: secciones.historial ?? false,
      historialData: null,
      includeVolDiagram: secciones.volDiagram ?? true,
      includeSensibilidad: secciones.sensibilidad ?? false,
      secciones,
      outputMode,
    });
    return doc;
  }, [dosifRow, plantilla, cfg, user, titulo, secciones]);

  /* ── regenerar el preview con debounce al cambiar la config ── */
  useEffect(() => {
    if (tipo !== "DOSIFICACION" || !dosifRow) { setBlob(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setGenerating(true);
      setError(null);
      try {
        const doc = await generar("doc");
        if (!doc) { setBlob(null); return; }
        const url = doc.output("bloburl");
        setBlob(typeof url === "string" ? url : URL.createObjectURL(doc.output("blob")));
      } catch (err) {
        console.error("Error generando el preview del informe:", err);
        setBlob(null);
        setError(err?.message || "No se pudo generar la previsualización del informe.");
      } finally {
        setGenerating(false);
      }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generar, dosifRow, tipo]);

  /* ── limpiar el blob al desmontar ── */
  useEffect(() => () => {
    if (blobUrlRef.current) { try { URL.revokeObjectURL(blobUrlRef.current); } catch {} }
  }, []);

  const handleDescargar = useCallback(async () => {
    try {
      await generar("save");
      showToast("success", "Informe descargado");
    } catch (err) {
      console.error("Error descargando el informe:", err);
      showToast("error", err?.message || "No se pudo descargar el informe");
    }
  }, [generar, showToast]);

  const toggleSeccion = (key) => setSecciones((p) => ({ ...p, [key]: !p[key] }));
  const toggleGrupo = (grupo) => {
    const keys = seccionesDef.filter((s) => s.grupo === grupo).map((s) => s.key);
    const allOn = keys.every((k) => secciones[k]);
    setSecciones((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { next[k] = !allOn; });
      return next;
    });
  };

  const onChangeTipo = (value) => { setTipo(value); setBlob(null); setError(null); };
  const onChangeDosif = (value) => {
    setIdDosif(value);
    setError(null);
    navigate(value ? `/calidad/informes/${value}` : "/calidad/informes", { replace: true });
  };

  const countSelected = Object.values(secciones).filter(Boolean).length;

  return (
    <div className="p-2">
      <PageHeader
        icon="fa-solid fa-file-pdf"
        title="Informes técnicos"
        subtitle="Generá un informe configurable y previsualizalo antes de descargar"
      />

      <div className="grid">
        {/* ── PANEL IZQUIERDO: configuración ── */}
        <div className="col-12 lg:col-4">
          <div className="surface-card border-round p-3 h-full">
            <div className="text-sm font-semibold text-color-secondary mb-2 uppercase">Configuración</div>

            <div className="flex flex-column gap-1 mb-3">
              <label className="font-semibold text-sm">Tipo de informe</label>
              <Dropdown value={tipo} options={TIPO_OPTIONS} onChange={(e) => onChangeTipo(e.value)} className="w-full" />
            </div>

            {tipo === "DOSIFICACION" && (
              <div className="flex flex-column gap-1 mb-3">
                <label className="font-semibold text-sm">Dosificación</label>
                <Dropdown
                  value={idDosif}
                  options={dosifList.map((d) => ({ label: d.nombre || `Diseño #${d.id}`, value: d.id }))}
                  onChange={(e) => onChangeDosif(e.value)}
                  placeholder={listLoading ? "Cargando..." : "Seleccionar dosificación"}
                  filter
                  showClear
                  className="w-full"
                  emptyMessage="No hay dosificaciones guardadas"
                />
              </div>
            )}

            <div className="flex flex-column gap-1 mb-3">
              <label className="font-semibold text-sm">Origen</label>
              <Dropdown
                value={origenPlanta}
                options={plantas}
                onChange={(e) => setOrigenPlanta(e.value)}
                placeholder="Planta emisora"
                className="w-full"
                showClear
                emptyMessage="Sin plantas"
              />
            </div>

            <div className="flex flex-column gap-1 mb-3">
              <label className="font-semibold text-sm">Destinatario</label>
              <InputText value={destinatario} onChange={(e) => setDestinatario(e.target.value)} placeholder="Ej: Dirección de obra, comitente, archivo interno" className="w-full" />
            </div>

            <div className="flex flex-column gap-1 mb-3">
              <label className="font-semibold text-sm">Plantilla</label>
              <Dropdown value={plantilla} options={PLANTILLA_OPTIONS} onChange={(e) => setPlantilla(e.value)} className="w-full" />
            </div>

            <div className="flex flex-column gap-1 mb-3">
              <label className="font-semibold text-sm">Título del informe</label>
              <InputText value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título del documento" className="w-full" />
            </div>

            <Divider />
            <div className="flex justify-content-between align-items-center mb-2">
              <span className="text-sm font-semibold text-color-secondary uppercase">Secciones</span>
              <small className="text-color-secondary">{countSelected} de {seccionesDef.length}</small>
            </div>

            {grupos.map((grupo) => {
              const items = seccionesDef.filter((s) => s.grupo === grupo);
              const allOn = items.every((s) => secciones[s.key]);
              return (
                <div key={grupo} className="mb-2">
                  <div className="flex align-items-center gap-2 mb-1 cursor-pointer" onClick={() => toggleGrupo(grupo)}>
                    <Checkbox checked={allOn} onChange={() => toggleGrupo(grupo)} />
                    <strong className="text-xs text-color-secondary uppercase">{grupo}</strong>
                  </div>
                  <div className="pl-4 flex flex-column gap-1">
                    {items.map((sec) => (
                      <div key={sec.key} className="flex align-items-center gap-2">
                        <Checkbox inputId={`sec-${tipo}-${sec.key}`} checked={!!secciones[sec.key]} onChange={() => toggleSeccion(sec.key)} />
                        <label htmlFor={`sec-${tipo}-${sec.key}`} className="text-sm cursor-pointer">{sec.label}</label>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── PANEL DERECHO: previsualización ── */}
        <div className="col-12 lg:col-8">
          <div className="surface-card border-round p-3 h-full flex flex-column">
            <div className="flex justify-content-between align-items-center mb-2">
              <span className="text-sm font-semibold text-color-secondary uppercase">Previsualización</span>
              <Button
                label="Descargar PDF"
                icon="fa-solid fa-download"
                className="p-button-sm"
                onClick={handleDescargar}
                disabled={tipo !== "DOSIFICACION" || !dosifRow || generating}
              />
            </div>

            <div
              className="border-round flex-1 flex align-items-center justify-content-center"
              style={{ background: "var(--surface-100)", minHeight: "70vh", position: "relative" }}
            >
              {tipo !== "DOSIFICACION" ? (
                <Message
                  severity="info"
                  text="La generación de fichas de agregado y de mezcla se realiza desde sus respectivas pantallas. Seleccioná tipo «Dosificación» para previsualizar acá."
                />
              ) : !idDosif ? (
                <Message severity="info" text="Elegí una dosificación para generar la previsualización." />
              ) : rowLoading ? (
                <ProgressSpinner style={{ width: 48, height: 48 }} />
              ) : error ? (
                <Message severity="error" text={error} />
              ) : (
                <>
                  {generating && (
                    <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                      <ProgressSpinner style={{ width: 28, height: 28 }} strokeWidth="5" />
                    </div>
                  )}
                  {blobUrl ? (
                    <iframe
                      title="Previsualización del informe"
                      src={blobUrl}
                      style={{ width: "100%", height: "100%", minHeight: "70vh", border: "none", borderRadius: 6 }}
                    />
                  ) : (
                    !generating && <Message severity="warn" text="No hay previsualización disponible." />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
