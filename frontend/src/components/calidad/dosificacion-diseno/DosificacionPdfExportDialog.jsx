import React, { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { Divider } from "primereact/divider";
import { SelectButton } from "primereact/selectbutton";
import { MODO_DESCRIPTIVO, MODO_NORMATIVO, normalizarModo } from "../../../lib/evaluacion";

const LS_KEY = "hormiqual_dosificacion_pdf_export_prefs";

// Decisión 2026-05-28: opciones del modo del documento.
//   Descriptivo (default público): datos + referencia CIRSOC sin emitir juicio.
//   Normativo: evaluación contra CIRSOC/IRAM estricta con veredictos.
const MODO_OPTIONS = [
  { label: "Descriptivo", value: MODO_DESCRIPTIVO },
  { label: "Normativo",   value: MODO_NORMATIVO },
];

// ── All sections available in the dosificación PDF ──
const SECCIONES_DOSIFICACION = [
  { key: "resumenEjecutivo",  label: "A. Resumen ejecutivo",             grupo: "Cuerpo principal", default: true },
  { key: "parametros",        label: "B. Parámetros de diseño",          grupo: "Cuerpo principal", default: true },
  { key: "materiales",        label: "C. Materiales seleccionados",      grupo: "Cuerpo principal", default: true },
  { key: "criteriosAC",       label: "D. Criterios de relación a/c",     grupo: "Cuerpo principal", default: true },
  { key: "criteriosCemento",  label: "E. Criterios de material cementante", grupo: "Cuerpo principal", default: true },
  { key: "dosificacionFinal", label: "F. Dosificación final por m³",     grupo: "Cuerpo principal", default: true },
  { key: "trazabilidadAgua",  label: "G. Trazabilidad del agua",         grupo: "Cuerpo principal", default: true },
  { key: "verificacionesCIRSOC", label: "H. Verificaciones CIRSOC 200:2024", grupo: "Verificaciones", default: true },
  { key: "granulometria",     label: "Granulometría combinada (banda IRAM 1627)", grupo: "Verificaciones", default: true },
  { key: "trabajabilidad",    label: "I. Evaluación de trabajabilidad",  grupo: "Verificaciones", default: true },
  { key: "advertencias",      label: "J. Advertencias técnicas",         grupo: "Verificaciones", default: true },
  { key: "aptitudMateriales", label: "K. Verificación de aptitud",       grupo: "Verificaciones", default: true },
  { key: "recetaObra",        label: "L. Receta de obra (corrección humedad)", grupo: "Complementarios", default: false },
  { key: "sensibilidad",      label: "M. Análisis de sensibilidad",      grupo: "Complementarios", default: false },
  { key: "verificacionExp",   label: "N. Verificación experimental",     grupo: "Complementarios", default: false },
  { key: "costos",            label: "Análisis de costos",               grupo: "Complementarios", default: false },
  { key: "volDiagram",        label: "Diagrama volumétrico (1 m³)",      grupo: "Complementarios", default: true },
  { key: "prediccionFresco",  label: "Comportamiento fresco esperado",   grupo: "Complementarios", default: true },
  { key: "balanceMateriales", label: "Balance de agua / materiales",     grupo: "Complementarios", default: false },
  { key: "anexoTecnico",      label: "Anexo técnico — Trazabilidad completa", grupo: "Anexos", default: false },
  { key: "glosario",          label: "Glosario de términos",             grupo: "Anexos", default: true },
  { key: "historial",         label: "Historial del diseño",             grupo: "Anexos", default: false },
  { key: "anexoMateriales",   label: "Anexo de materiales (granulometrías)", grupo: "Anexos", default: false },
];

const GRUPOS = ["Cuerpo principal", "Verificaciones", "Complementarios", "Anexos"];

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
}

// Back-compat: prefs viejas guardaban `prescriptivo: boolean`. El campo
// nuevo es `modo: 'DESCRIPTIVO' | 'NORMATIVO'`. Si solo está el viejo,
// derivamos el nuevo. Si está el nuevo, gana.
function resolverModoInicial(prefs) {
  if (typeof prefs.modo === "string") return normalizarModo(prefs.modo);
  if (prefs.prescriptivo === true) return MODO_NORMATIVO;
  return MODO_DESCRIPTIVO;
}

export default function DosificacionPdfExportDialog({ visible, onHide, onConfirm, defaultTitulo = "" }) {
  const [titulo, setTitulo] = useState("");
  const [secciones, setSecciones] = useState({});
  // Decisión 2026-05-28: modo canónico DESCRIPTIVO / NORMATIVO. Default DESCRIPTIVO.
  const [modo, setModo] = useState(MODO_DESCRIPTIVO);

  useEffect(() => {
    if (!visible) return;
    const prefs = loadPrefs();
    setTitulo(defaultTitulo || "");
    setModo(resolverModoInicial(prefs));
    // Initialize sections from prefs or defaults
    const init = {};
    for (const sec of SECCIONES_DOSIFICACION) {
      init[sec.key] = prefs[sec.key] ?? sec.default;
    }
    setSecciones(init);
  }, [visible, defaultTitulo]);

  const toggle = (key) => setSecciones(prev => ({ ...prev, [key]: !prev[key] }));

  const selectAll = (grupo) => {
    const keys = SECCIONES_DOSIFICACION.filter(s => s.grupo === grupo).map(s => s.key);
    const allOn = keys.every(k => secciones[k]);
    setSecciones(prev => {
      const next = { ...prev };
      keys.forEach(k => { next[k] = !allOn; });
      return next;
    });
  };

  // En modo DESCRIPTIVO ocultamos toggles de secciones que solo tienen
  // sentido en modo NORMATIVO (emiten veredictos formales). Las podemos
  // tener listadas para que el usuario las vea pero deshabilitadas, o
  // filtrarlas — elegimos filtrar para no confundir.
  const SECCIONES_SOLO_NORMATIVO = new Set([
    'aptitudMateriales',
    'verificacionExp',
  ]);
  const seccionesVisibles = SECCIONES_DOSIFICACION.filter(s =>
    modo === MODO_NORMATIVO || !SECCIONES_SOLO_NORMATIVO.has(s.key)
  );

  const handleConfirm = () => {
    savePrefs({ ...secciones, modo, prescriptivo: modo === MODO_NORMATIVO });
    onConfirm({
      titulo: typeof titulo === "string" ? titulo.trim() || null : null,
      secciones,
      modoEvaluacion: modo,
      // Legacy fields (for existing PDF generator)
      includeAnexo: secciones.anexoTecnico,
      includeGlosario: secciones.glosario,
      includeFullTrace: secciones.anexoTecnico,
      includeCostos: secciones.costos,
      includeAnexoMateriales: secciones.anexoMateriales,
      includeHistorial: secciones.historial,
      includeVolDiagram: secciones.volDiagram,
      includeSensibilidad: secciones.sensibilidad,
    });
  };

  const countSelected = Object.values(secciones).filter(Boolean).length;

  return (
    <Dialog
      header="Exportar informe PDF"
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: "36rem" }}
      modal
      draggable={false}
      footer={(
        <div className="flex justify-content-between align-items-center">
          <small className="text-color-secondary">{countSelected} de {SECCIONES_DOSIFICACION.length} secciones seleccionadas</small>
          <div className="flex gap-2">
            <Button label="Cancelar" className="p-button-text p-button-sm" onClick={onHide} />
            <Button label="Generar PDF" icon="fa-solid fa-file-pdf" className="p-button-sm" onClick={handleConfirm} />
          </div>
        </div>
      )}
    >
      <div className="flex flex-column gap-2">
        <div className="flex flex-column gap-1 mb-2">
          <label htmlFor="dosif-pdf-titulo" className="font-semibold text-sm">Título del informe</label>
          <InputText
            id="dosif-pdf-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Diseño de dosificación — Borrador"
            className="p-inputtext-sm"
          />
        </div>

        <Divider className="my-1" />

        <div className="flex flex-column gap-1 mb-2">
          <div className="text-sm font-semibold text-color-secondary mb-1">Modo del documento</div>
          <SelectButton
            value={modo}
            onChange={(e) => e.value && setModo(e.value)}
            options={MODO_OPTIONS}
            className="w-full"
            pt={{ button: { className: 'text-xs' } }}
          />
          <small className="text-color-secondary text-xs mt-2">
            {modo === MODO_DESCRIPTIVO
              ? 'El documento lista los parámetros calculados de la dosificación con la referencia CIRSOC al lado, sin emitir valoración normativa. No declara CUMPLE / NO CUMPLE. Apto para documentación interna y entrega al cliente.'
              : 'Verifica contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros del plan de control de calidad de la planta productora. Emite veredictos formales. Apto para auditorías externas, licitaciones y contraste técnico.'}
          </small>
        </div>

        <Divider className="my-1" />

        <div className="text-sm font-semibold text-color-secondary mb-1">
          Secciones del informe
        </div>

        {GRUPOS.map(grupo => {
          const items = seccionesVisibles.filter(s => s.grupo === grupo);
          if (items.length === 0) return null;
          const allOn = items.every(s => secciones[s.key]);
          return (
            <div key={grupo} className="mb-2">
              <div className="flex align-items-center gap-2 mb-1 cursor-pointer" onClick={() => selectAll(grupo)}>
                <Checkbox checked={allOn} onChange={() => selectAll(grupo)} />
                <strong className="text-xs text-color-secondary uppercase">{grupo}</strong>
              </div>
              <div className="pl-4 flex flex-column gap-1">
                {items.map(sec => (
                  <div key={sec.key} className="flex align-items-center gap-2">
                    <Checkbox
                      inputId={`sec-${sec.key}`}
                      checked={!!secciones[sec.key]}
                      onChange={() => toggle(sec.key)}
                    />
                    <label htmlFor={`sec-${sec.key}`} className="text-sm cursor-pointer">{sec.label}</label>
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

// Export section keys for use in other PDF generators
export { SECCIONES_DOSIFICACION };
