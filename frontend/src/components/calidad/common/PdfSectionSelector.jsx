import React, { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { Divider } from "primereact/divider";
import { SelectButton } from "primereact/selectbutton";

/**
 * Generic PDF section selector dialog.
 * Used for agregados, mezclas, and dosificaciones.
 *
 * @param {string} tipo - 'AGREGADO' | 'MEZCLA' | 'DOSIFICACION'
 * @param {boolean} visible
 * @param {function} onHide
 * @param {function} onConfirm - receives { titulo, secciones: { key: boolean } }
 * @param {string} defaultTitulo
 */

// ── Section definitions by report type ──

// Las letras (A, B, C...) se asignan dinámicamente en el generador del PDF.
// Las keys deben coincidir con las que destructura `agregadoFichaTecnicaPdf.js`.
const SECCIONES_AGREGADO = [
  { key: "identificacion",  label: "Identificación",                grupo: "Cuerpo principal", default: true },
  { key: "caracterizacion", label: "Caracterización básica",        grupo: "Cuerpo principal", default: true },
  { key: "granulometria",   label: "Granulometría",                 grupo: "Cuerpo principal", default: true },
  { key: "complementarios", label: "Ensayos realizados",            grupo: "Cuerpo principal", default: true },
  { key: "cumplimiento",    label: "Cumplimiento normativo",        grupo: "Verificaciones",   default: true },
  { key: "veredicto",       label: "Veredicto del agregado",        grupo: "Verificaciones",   default: true },
  { key: "advertencia",     label: "Advertencia técnica",           grupo: "Verificaciones",   default: true },
];

const SECCIONES_MEZCLA = [
  { key: "datosGenerales",       label: "Datos generales",                  grupo: "Cuerpo principal", default: true },
  { key: "componentesMezcla",   label: "Componentes de la mezcla",         grupo: "Cuerpo principal", default: true },
  { key: "curvaMezcla",         label: "Curva granulométrica",              grupo: "Gráficos",         default: true },
  { key: "comparacionBanda",    label: "Comparación con banda",             grupo: "Gráficos",         default: true },
  { key: "comparacionTeorica",  label: "Comparación con curva teórica",     grupo: "Gráficos",         default: true },
  { key: "vistaCombinada",      label: "Vista combinada",                   grupo: "Gráficos",         default: true },
  { key: "resultados",          label: "Resultados de optimización",        grupo: "Cuerpo principal", default: true },
  { key: "rangosOptimizacion",  label: "Rangos de optimización",            grupo: "Cuerpo principal", default: true },
  { key: "ajusteManual",        label: "Ajuste manual de proporciones",     grupo: "Cuerpo principal", default: true },
  { key: "caracterizacionComb", label: "Caracterización combinada",         grupo: "Verificaciones",   default: true },
  { key: "cumplimientoNormativo",label: "Cumplimiento normativo",           grupo: "Verificaciones",   default: true },
  { key: "anexoTrazabilidad",   label: "Anexo — Trazabilidad del cálculo",  grupo: "Anexos",           default: true },
  { key: "glosario",            label: "Glosario",                          grupo: "Anexos",           default: true },
];

const SECCIONES_DOSIFICACION = [
  { key: "resumenEjecutivo",     label: "A. Resumen ejecutivo",             grupo: "Cuerpo principal", default: true },
  { key: "parametros",           label: "B. Parámetros de diseño",          grupo: "Cuerpo principal", default: true },
  { key: "materiales",           label: "C. Materiales seleccionados",      grupo: "Cuerpo principal", default: true },
  { key: "criteriosAC",          label: "D. Criterios de relación a/c",     grupo: "Cuerpo principal", default: true },
  { key: "criteriosCemento",     label: "E. Criterios de material cementante", grupo: "Cuerpo principal", default: true },
  { key: "dosificacionFinal",    label: "F. Dosificación final por m³",     grupo: "Cuerpo principal", default: true },
  { key: "trazabilidadAgua",     label: "G. Trazabilidad del agua",         grupo: "Cuerpo principal", default: true },
  { key: "verificacionesCIRSOC", label: "H. Verificaciones CIRSOC 200:2024", grupo: "Verificaciones", default: true },
  { key: "trabajabilidad",       label: "I. Evaluación de trabajabilidad",  grupo: "Verificaciones", default: true },
  { key: "advertencias",         label: "J. Advertencias técnicas",         grupo: "Verificaciones", default: true },
  { key: "aptitudMateriales",    label: "K. Verificación de aptitud",       grupo: "Verificaciones", default: true },
  { key: "recetaObra",           label: "L. Receta de obra",                grupo: "Complementarios", default: false },
  { key: "sensibilidad",         label: "M. Análisis de sensibilidad",      grupo: "Complementarios", default: false },
  { key: "verificacionExp",      label: "N. Verificación experimental",     grupo: "Complementarios", default: false },
  { key: "costos",               label: "Análisis de costos",               grupo: "Complementarios", default: false },
  { key: "volDiagram",           label: "Diagrama volumétrico",             grupo: "Complementarios", default: true },
  { key: "anexoTecnico",         label: "Anexo técnico",                    grupo: "Anexos", default: false },
  { key: "glosario",             label: "Glosario",                         grupo: "Anexos", default: true },
  { key: "historial",            label: "Historial del diseño",             grupo: "Anexos", default: false },
  { key: "anexoMateriales",      label: "Anexo de materiales",              grupo: "Anexos", default: false },
  { key: "analisisEficiencia",  label: "Análisis de eficiencia de aditivos", grupo: "Prueba", default: false },
  { key: "balanceMateriales",   label: "Balance de materiales",            grupo: "Prueba", default: false },
];

const SECCIONES_MAP = {
  AGREGADO: SECCIONES_AGREGADO,
  MEZCLA: SECCIONES_MEZCLA,
  DOSIFICACION: SECCIONES_DOSIFICACION,
};

const LS_KEYS = {
  AGREGADO: "hq_pdf_secciones_agregado",
  MEZCLA: "hq_pdf_secciones_mezcla",
  DOSIFICACION: "hq_pdf_secciones_dosificacion",
};

const LS_KEY_REPORT_MODE = "hq_pdf_report_mode";

// Modos de reporte para dosificación. PRESTACIONAL es el default y refleja
// la filosofía actual: los desvíos normativos no producen veredictos
// terminales mientras la viabilidad técnica sea gestionable. NORMATIVO_ESTRICTO
// es el modo de auditoría/licitación: dos o más desvíos elevan el estado
// general a "Requiere ajuste".
const REPORT_MODE_OPTIONS = [
  { label: "Desarrollo prestacional", value: "PRESTACIONAL" },
  { label: "Cumplimiento estricto",   value: "NORMATIVO_ESTRICTO" },
];

function loadPrefs(tipo) {
  try { return JSON.parse(localStorage.getItem(LS_KEYS[tipo]) || "{}"); } catch { return {}; }
}
function savePrefs(tipo, prefs) {
  try { localStorage.setItem(LS_KEYS[tipo], JSON.stringify(prefs)); } catch {}
}

export default function PdfSectionSelector({ tipo = "DOSIFICACION", visible, onHide, onConfirm, defaultTitulo = "", soloPrestacional = false }) {
  const [titulo, setTitulo] = useState("");
  const [secciones, setSecciones] = useState({});
  const [reportMode, setReportMode] = useState("PRESTACIONAL");
  const seccionesDef = SECCIONES_MAP[tipo] || SECCIONES_DOSIFICACION;
  const grupos = [...new Set(seccionesDef.map(s => s.grupo))];
  // HRDC está FUERA de CIRSOC/IRAM: sólo se puede analizar prestacionalmente.
  // No ofrecer "Cumplimiento estricto" (no hay norma contra la cual exigir).
  const showReportMode = tipo === "DOSIFICACION";
  const modoEditable = showReportMode && !soloPrestacional;

  useEffect(() => {
    if (!visible) return;
    const prefs = loadPrefs(tipo);
    setTitulo(defaultTitulo || "");
    const init = {};
    for (const sec of seccionesDef) {
      init[sec.key] = prefs[sec.key] ?? sec.default;
    }
    setSecciones(init);
    if (soloPrestacional) {
      setReportMode("PRESTACIONAL");
    } else if (showReportMode) {
      try {
        const savedMode = localStorage.getItem(LS_KEY_REPORT_MODE);
        setReportMode(savedMode === "NORMATIVO_ESTRICTO" ? "NORMATIVO_ESTRICTO" : "PRESTACIONAL");
      } catch { setReportMode("PRESTACIONAL"); }
    }
  }, [visible, defaultTitulo, tipo, showReportMode, soloPrestacional]);

  const toggle = (key) => setSecciones(prev => ({ ...prev, [key]: !prev[key] }));

  const selectAll = (grupo) => {
    const keys = seccionesDef.filter(s => s.grupo === grupo).map(s => s.key);
    const allOn = keys.every(k => secciones[k]);
    setSecciones(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = !allOn; });
      return next;
    });
  };

  const handleConfirm = () => {
    savePrefs(tipo, secciones);
    const effMode = soloPrestacional ? "PRESTACIONAL" : reportMode;
    // Para HRDC no tocar la preferencia global del usuario: sólo forzamos
    // PRESTACIONAL en este informe (no hay norma contra la cual exigir).
    if (showReportMode && !soloPrestacional) {
      try { localStorage.setItem(LS_KEY_REPORT_MODE, reportMode); } catch {}
    }
    onConfirm({
      titulo: typeof titulo === "string" ? titulo.trim() || null : null,
      secciones,
      ...(showReportMode ? { reportMode: effMode } : {}),
    });
  };

  const countSelected = Object.values(secciones).filter(Boolean).length;

  const tipoLabels = { AGREGADO: "Ficha técnica del agregado", MEZCLA: "Informe de mezcla", DOSIFICACION: "Informe de dosificación" };

  return (
    <Dialog
      header={`Exportar PDF — ${tipoLabels[tipo] || "Informe"}`}
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: "36rem" }}
      modal
      draggable={false}
      footer={(
        <div className="flex justify-content-between align-items-center">
          <small className="text-color-secondary">{countSelected} de {seccionesDef.length} secciones</small>
          <div className="flex gap-2">
            <Button label="Cancelar" className="p-button-text p-button-sm" onClick={onHide} />
            <Button label="Generar PDF" icon="fa-solid fa-file-pdf" className="p-button-sm" onClick={handleConfirm} />
          </div>
        </div>
      )}
    >
      <div className="flex flex-column gap-2">
        {showReportMode && modoEditable && (
          <div className="flex flex-column gap-1 mb-1">
            <label className="font-semibold text-sm">Modo de reporte</label>
            <SelectButton
              value={reportMode}
              options={REPORT_MODE_OPTIONS}
              onChange={(e) => { if (e.value) setReportMode(e.value); }}
              className="text-xs"
              allowEmpty={false}
            />
            <small className="text-color-secondary">
              {reportMode === "NORMATIVO_ESTRICTO"
                ? "Auditoría/licitación: dos o más desvíos normativos elevan el estado a Requiere ajuste."
                : "Desarrollo técnico: los desvíos normativos no producen veredictos terminales mientras la viabilidad sea gestionable."}
            </small>
          </div>
        )}
        {showReportMode && soloPrestacional && (
          <div className="flex flex-column gap-1 mb-1">
            <label className="font-semibold text-sm">Modo de reporte</label>
            <div
              className="text-xs p-2 border-round"
              style={{ background: "var(--surface-100)", color: "var(--text-color-secondary)" }}
            >
              <i className="fa-solid fa-circle-info mr-1" />
              Desarrollo prestacional (único modo disponible). El HRDC está fuera del
              cuerpo normativo (CIRSOC 200 / IRAM), por lo que no aplica la verificación
              bajo cumplimiento estricto.
            </div>
          </div>
        )}

        <div className="flex flex-column gap-1 mb-1">
          <label className="font-semibold text-sm">Título del informe</label>
          <InputText value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={tipoLabels[tipo]} className="p-inputtext-sm" />
        </div>

        <Divider className="my-1" />
        <div className="text-sm font-semibold text-color-secondary mb-1">Secciones del informe</div>

        {grupos.map(grupo => {
          const items = seccionesDef.filter(s => s.grupo === grupo);
          const allOn = items.every(s => secciones[s.key]);
          return (
            <div key={grupo} className="mb-1">
              <div className="flex align-items-center gap-2 mb-1 cursor-pointer" onClick={() => selectAll(grupo)}>
                <Checkbox checked={allOn} onChange={() => selectAll(grupo)} />
                <strong className="text-xs text-color-secondary uppercase">{grupo}</strong>
              </div>
              <div className="pl-4 flex flex-column gap-1">
                {items.map(sec => (
                  <div key={sec.key} className="flex align-items-center gap-2">
                    <Checkbox inputId={`sec-${tipo}-${sec.key}`} checked={!!secciones[sec.key]} onChange={() => toggle(sec.key)} />
                    <label htmlFor={`sec-${tipo}-${sec.key}`} className="text-sm cursor-pointer">{sec.label}</label>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

export { SECCIONES_AGREGADO, SECCIONES_MEZCLA, SECCIONES_DOSIFICACION };
