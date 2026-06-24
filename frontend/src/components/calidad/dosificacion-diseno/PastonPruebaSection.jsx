import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Tag } from "primereact/tag";
import { Divider } from "primereact/divider";
import { Checkbox } from "primereact/checkbox";
import { Message } from "primereact/message";
import { Tooltip } from "primereact/tooltip";
import { RadioButton } from "primereact/radiobutton";
import { Dialog } from "primereact/dialog";
import { SelectButton } from "primereact/selectbutton";
import {
  listarPastones,
  generarProbetasDesdePaston,
  crearPaston,
  eliminarPaston,
  actualizarPaston,
  listarCorrecciones,
  aplicarCorrecciones,
} from "../../../services/dosificacionDisenoService";
import { generarPastonPruebaPdf } from "./pastonPruebaPdf";
import { MODO_DESCRIPTIVO, MODO_NORMATIVO } from "../../../lib/evaluacion";
import MedicionesPastonPanel from "./MedicionesPastonPanel";
import ProbetasPastonEditor from "../../admin/muestra-paston/ProbetasPastonEditor";
import AnalisisEficienciaPanel from "./AnalisisEficienciaPanel";
import axios from "axios";
import { config } from "../../../config/config";
import { handleDecimalKey } from "../../../lib/format/decimalKeyboard";

/* ═══════════════════════════════════════
   Constants
   ═══════════════════════════════════════ */

const round = (v, d = 1) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const fmtNum = (v, dec = 1) =>
  v != null
    ? Number(v).toLocaleString("es-AR", {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      })
    : "—";

/**
 * Serializa la hora del pastón a "HH:mm" 24h determinístico para la columna
 * TIME del backend. `toLocaleTimeString("es-AR")` produce "07:09 a. m." (12h
 * + sufijo AM/PM con espacio fino), que MySQL rechaza ("Incorrect time
 * value"). Acepta Date (del Calendar timeOnly) o string ya "HH:mm".
 */
const toHHMM = (v) => {
  if (!v) return null;
  if (typeof v === "string") {
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  }
  const dt = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  return `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
};

/* ── Volúmenes de referencia por ensayo/probeta ── */

const PROBETA_TYPES = [
  { key: "cilindrica_15x30", nombre: "Cilíndrica 15×30 cm", volumen_L: 5.30, norma: "IRAM 1524" },
  { key: "cilindrica_10x20", nombre: "Cilíndrica 10×20 cm", volumen_L: 1.57, norma: "IRAM 1524" },
  { key: "prismatica_15x15x60", nombre: "Prismática 15×15×60 cm", volumen_L: 13.50, norma: "IRAM 1547" },
  { key: "cubo_15", nombre: "Cubo 15×15×15 cm", volumen_L: 3.38, norma: "EN 12390-1" },
];

const ENSAYO_FRESCO_TYPES = [
  { key: "cono_abrams", nombre: "Cono de Abrams", volumen_L: 6.0, norma: "IRAM 1536 / 1690" },
  { key: "aire_washington", nombre: "Contenido de aire (Washington)", volumen_L: 7.0, norma: "IRAM 1602" },
  { key: "puv_recipiente", nombre: "PUV (recipiente de medida)", volumen_L: 7.0, norma: "IRAM 1562" },
  { key: "v_funnel", nombre: "V-Funnel (HAC)", volumen_L: 12.0, norma: "IRAM 1837" },
  { key: "l_box", nombre: "L-Box (HAC)", volumen_L: 14.0, norma: "IRAM 1838" },
];

const FACTOR_IRAM_1541 = 1.40;

const ASPECTO_OPTIONS = [
  { label: "Bueno", value: "Bueno" },
  { label: "Regular", value: "Regular" },
  { label: "Malo", value: "Malo" },
];

const METODO_MEDICION_LABELS = {
  asentamiento: "Asentamiento medido (cm)",
  remoldeo: "Remoldeo VeBe medido (s)",
  extendido: "Extendido medido (cm)",
};

/* ── Presets rápidos ── */

// Solo 2 presets: la escala determina TODO (probetas, ensayos, unidades,
// volumen mínimo). El usuario ya no elige una matriz de combinaciones —
// elige el contexto del pastón y el sistema configura lo demás.
//
// LABORATORIO: pastón reducido para validación técnica → 6 cilíndricas 15×30
//   + cono Abrams + aire + PUV. Materiales en g/mL.
// PRODUCCION: pastón real de planta → 6 cilíndricas 15×30 + 2 conos + aire +
//   PUV. Materiales en kg/L. Volumen mínimo recomendado 2.5 m³.
const PRESETS = [
  {
    label: "Escala laboratorio",
    desc: "Vol. reducido en litros, materiales en kg + L (validación técnica)",
    probetas: { cilindrica_15x30: 6 },
    ensayos: { cono_abrams: 1, aire_washington: 1, puv_recipiente: 1 },
    escala: 'LABORATORIO',
  },
  {
    label: "Escala producción",
    desc: "Pastón real de planta, m³, recomendado ≥ 2.5 m³ (kg + L)",
    probetas: { cilindrica_15x30: 6 },
    ensayos: { cono_abrams: 2, aire_washington: 1, puv_recipiente: 1 },
    escala: 'PRODUCCION',
  },
];

/* ── Ensayos frescos disponibles por consistencia ── */

function ensayosFrescoDisponibles(consistenciaCodigo) {
  const disponibles = new Set(["puv_recipiente", "aire_washington", "cono_abrams"]);
  if (consistenciaCodigo === "muy_fluida") {
    disponibles.add("v_funnel");
    disponibles.add("l_box");
  }
  return disponibles;
}

/* ── Label dinámico del cono según método de consistencia ── */

function conoLabel(consistenciaMetodo) {
  if (consistenciaMetodo === "extendido") return "Cono de Abrams (extendido)";
  if (consistenciaMetodo === "asentamiento") return "Cono de Abrams (asentamiento)";
  return "Cono de Abrams (asentamiento / extendido)";
}

/* ── Escalar componentes de la dosificación ── */

function escalarComponentes(resultado, volM3, contexto) {
  if (!resultado) return [];
  const comps = [];

  // Escala producción (≥ 1 m³): kg / L. Escala laboratorio: g / mL.
  const escalaProd = volM3 >= 1;
  const factor = escalaProd ? 1 : 1000;            // kgM3 * volM3 * factor
  const unidadSolido = escalaProd ? "kg" : "g";
  const unidadLiquido = escalaProd ? "L" : "mL";
  const decSolido = escalaProd ? 2 : 0;
  const decLiquido = escalaProd ? 1 : 0;

  // Agua
  if (resultado.aguaLtsM3) {
    comps.push({
      componente: "Agua", tipo: "AGUA",
      kgM3: resultado.aguaLtsM3,
      cantidadScaled: round(resultado.aguaLtsM3 * volM3 * factor, decLiquido),
      unidad: unidadLiquido,
    });
  }

  // Cemento
  if (resultado.cementoKgM3) {
    comps.push({
      componente: contexto?.cementoLabel || "Cemento", tipo: "CEMENTO",
      kgM3: resultado.cementoKgM3,
      cantidadScaled: round(resultado.cementoKgM3 * volM3 * factor, decSolido),
      unidad: unidadSolido,
    });
  }

  // Adiciones
  const adicionNames = contexto?.adiciones || [];
  if (resultado.adicion1KgM3) {
    comps.push({
      componente: adicionNames[0]?.label || "Adición 1", tipo: "ADICION",
      kgM3: resultado.adicion1KgM3,
      cantidadScaled: round(resultado.adicion1KgM3 * volM3 * factor, decSolido),
      unidad: unidadSolido,
    });
  }
  if (resultado.adicion2KgM3) {
    comps.push({
      componente: adicionNames[1]?.label || "Adición 2", tipo: "ADICION",
      kgM3: resultado.adicion2KgM3,
      cantidadScaled: round(resultado.adicion2KgM3 * volM3 * factor, decSolido),
      unidad: unidadSolido,
    });
  }

  // Aditivos (from resultado.aditivos array)
  const aditivoNames = contexto?.aditivos || [];
  if (resultado.aditivos?.length) {
    resultado.aditivos.forEach((ad, idx) => {
      if (ad.kgM3) {
        const scaled = ad.kgM3 * volM3 * factor;
        const dec = escalaProd ? (scaled < 1 ? 3 : 2) : (scaled < 100 ? 1 : 0);
        comps.push({
          componente: aditivoNames[idx]?.label || `Aditivo ${idx + 1}`, tipo: "ADITIVO",
          kgM3: ad.kgM3,
          cantidadScaled: round(scaled, dec),
          unidad: unidadSolido,
        });
      }
    });
  }

  // Agregados (from resultado.agregados array)
  // Propagamos `absorcionPct` + `absorcionOrigen` + `idAgregado` para que la
  // tabla de "Corregir cantidades por humedad" pueda pre-poblar la columna
  // Absorción desde la ficha técnica o el ensayo IRAM 1520/1533 del agregado
  // (resuelto por el backend en `dosificacionDisenoService` antes de pasar al
  // motor — ver línea 774 del service). Sin estos campos, la tabla pedía
  // ingreso manual incluso cuando el dato existía en BD.
  if (resultado.agregados?.length) {
    resultado.agregados.forEach((ag) => {
      if (ag.nombre && ag.kgM3 > 0) {
        comps.push({
          componente: ag.nombre, tipo: "AGREGADO",
          kgM3: round(ag.kgM3, 1),
          cantidadScaled: round(ag.kgM3 * volM3 * factor, decSolido),
          unidad: unidadSolido,
          idAgregado: ag.idAgregado || null,
          absorcionPct: ag.absorcionPct != null ? Number(ag.absorcionPct) : null,
          absorcionOrigen: ag.absorcionOrigen || null,
          absorcionEnsayoId: ag.absorcionEnsayoId || null,
          densidad: ag.densidad != null ? Number(ag.densidad) : null,
        });
      }
    });
  }

  // Fibras
  if (resultado.fibras?.macrofibra?.dosisKgM3) {
    const kg = Number(resultado.fibras.macrofibra.dosisKgM3);
    comps.push({
      componente: `Macrofibra${resultado.fibras.macrofibra.nombre ? ` (${resultado.fibras.macrofibra.nombre})` : ""}`,
      tipo: "FIBRA",
      kgM3: round(kg, 3),
      cantidadScaled: round(kg * volM3 * factor, escalaProd ? 3 : 1),
      unidad: unidadSolido,
    });
  }
  if (resultado.fibras?.microfibra?.dosisKgM3) {
    const kg = Number(resultado.fibras.microfibra.dosisKgM3);
    comps.push({
      componente: `Microfibra${resultado.fibras.microfibra.nombre ? ` (${resultado.fibras.microfibra.nombre})` : ""}`,
      tipo: "FIBRA",
      kgM3: round(kg, 3),
      cantidadScaled: round(kg * volM3 * factor, escalaProd ? 3 : 1),
      unidad: unidadSolido,
    });
  }

  return comps;
}

/* ═══════════════════════════════════════
   Correctable fields definition
   ═══════════════════════════════════════ */

const CORRECTABLE_FIELDS = [
  { campo: "dosisAditivo1", label: "Dosis aditivo 1", unidad: "% s/cemento", source: "dosif" },
  { campo: "dosisAditivo2", label: "Dosis aditivo 2", unidad: "% s/cemento", source: "dosif" },
  { campo: "dosisAditivo3", label: "Dosis aditivo 3", unidad: "% s/cemento", source: "dosif" },
  { campo: "consistenciaValor", label: "Consistencia objetivo", unidad: "cm", source: "parametros" },
  { campo: "aguaLtsM3", label: "Agua", unidad: "L/m³", source: "resultado" },
  { campo: "cementoKgM3", label: "Cemento", unidad: "kg/m³", source: "resultado" },
  { campo: "tmnMm", label: "TMN de la mezcla", unidad: "mm", source: "resultado" },
  { campo: "moduloFinura", label: "Módulo de finura", unidad: "—", source: "resultado" },
  { campo: "airePct", label: "Aire total", unidad: "%", source: "resultado" },
  { campo: "aireAtrapado", label: "Aire atrapado", unidad: "%", source: "resultado" },
  { campo: "aireIncorporado", label: "Aire incorporado", unidad: "%", source: "resultado" },
  { campo: "pctReemplazoAdicion1", label: "% reemplazo adición 1", unidad: "%", source: "dosif" },
  { campo: "pctReemplazoAdicion2", label: "% reemplazo adición 2", unidad: "%", source: "dosif" },
  { campo: "dosisMacrofibraKgM3", label: "Dosis macrofibra", unidad: "kg/m³", source: "dosif" },
  { campo: "dosisMicrofibraKgM3", label: "Dosis microfibra", unidad: "kg/m³", source: "dosif" },
  { campo: "otro", label: "Otro (texto libre)", unidad: "", source: "libre" },
];

function getFieldValue(campo, loadedDosif, resultado) {
  const def = CORRECTABLE_FIELDS.find(f => f.campo === campo);
  if (!def) return null;
  if (def.source === "dosif") return loadedDosif?.[campo];
  if (def.source === "parametros") {
    try {
      const p = typeof loadedDosif?.parametrosObjetivoJson === "string"
        ? JSON.parse(loadedDosif.parametrosObjetivoJson) : loadedDosif?.parametrosObjetivoJson;
      return p?.[campo];
    } catch { return null; }
  }
  if (def.source === "resultado") return resultado?.[campo];
  return null;
}

/* ═══════════════════════════════════════
   CorreccionesPanel — per-paston corrections
   ═══════════════════════════════════════ */

const CorreccionesPanel = ({ paston, loadedDosif, resultado, dosifId, showToast, onCorrectionApplied, correcciones: allCorrecciones }) => {
  // `decision` se DERIVA del veredicto del pastón (no es estado propio).
  // Eliminamos el radio button duplicado "Resultados satisfactorios / Necesita
  // correcciones" porque ya existía en el bloque de Veredicto abajo — pedir
  // dos veces lo mismo confundía al usuario (sesión 2026-06-12).
  //   APROBADO            → "ok" (muestra mensaje satisfactorio).
  //   APROBADO_PRELIMINAR → "ok_preliminar" (apto provisorio pendiente rotura).
  //   RECHAZADO           → "corregir" (muestra bloque de correcciones a aplicar).
  //   OBSERVADO           → "corregir" (idem).
  //   null/Sin evaluar    → no muestra nada hasta que el usuario emita veredicto.
  const decision = paston.veredicto === 'APROBADO' ? 'ok'
    : paston.veredicto === 'APROBADO_PRELIMINAR' ? 'ok_preliminar'
    : (paston.veredicto === 'RECHAZADO' || paston.veredicto === 'OBSERVADO') ? 'corregir'
    : null;
  const [corrItems, setCorrItems] = useState([]);
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);

  // Corrections for this specific paston
  const pastonCorrecciones = useMemo(
    () => (allCorrecciones || []).filter(c => c.pastonId === paston.idPastonPrueba),
    [allCorrecciones, paston.idPastonPrueba]
  );

  const addCorrItem = useCallback(() => {
    setCorrItems(prev => [...prev, { campo: "", valorNuevo: "", motivo: "" }]);
  }, []);

  const updateCorrItem = useCallback((idx, key, val) => {
    setCorrItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: val };
      return next;
    });
  }, []);

  const removeCorrItem = useCallback((idx) => {
    setCorrItems(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAplicar = useCallback(async () => {
    if (applyingRef.current) return;
    if (!corrItems.length) return;
    const invalid = corrItems.some(c => !c.campo || !c.valorNuevo || !c.motivo);
    if (invalid) {
      showToast?.("warn", "Complete todos los campos de cada corrección");
      return;
    }

    const correcciones = corrItems.map(c => {
      const def = CORRECTABLE_FIELDS.find(f => f.campo === c.campo);
      const valorAnterior = getFieldValue(c.campo, loadedDosif, resultado);
      return {
        campo: c.campo,
        campoLabel: def?.label || c.campo,
        valorAnterior: valorAnterior != null ? String(valorAnterior) : "—",
        valorNuevo: String(c.valorNuevo),
        unidad: def?.unidad || null,
        motivo: c.motivo,
        pastonId: paston.idPastonPrueba,
      };
    });

    applyingRef.current = true;
    setApplying(true);
    try {
      await aplicarCorrecciones(dosifId, correcciones);
      showToast?.("success", "Correcciones aplicadas");
      setCorrItems([]);
      // `decision` se deriva del veredicto; no hay setter local que limpiar.
      onCorrectionApplied?.();
    } catch (err) {
      showToast?.("error", err?.response?.data?.error || "Error al aplicar correcciones");
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }, [corrItems, loadedDosif, resultado, dosifId, paston.idPastonPrueba, showToast, onCorrectionApplied]);

  // Si ya hay veredicto emitido, el panel queda en modo read-only (solo historial de correcciones)
  return (
    <div className="mt-3">
      {/* Radio button "Evaluación: Resultados satisfactorios / Necesita
          correcciones" eliminado (sesión 2026-06-12) porque duplicaba el
          dropdown de Veredicto del bloque inferior. El estado se deriva
          ahora del veredicto seleccionado. */}

      {decision === "ok" && (
        <Message severity="success" text="Los resultados del pastón son satisfactorios. No se requieren correcciones." className="w-full mb-2" />
      )}

      {decision === "ok_preliminar" && (
        <Message
          severity="info"
          text="Aprobación preliminar: el hormigón fresco cumplió los criterios (slump, T°, aire, aspecto), pero la aprobación definitiva queda condicionada a los resultados de rotura de probetas."
          className="w-full mb-2"
        />
      )}

      {decision === "corregir" && (
        <div className="surface-100 border-round p-3 mb-2">
          <div className="flex align-items-center justify-content-between mb-2">
            <span className="text-sm font-bold">Correcciones a aplicar</span>
            <Button icon="pi pi-plus" label="Agregar" size="small" outlined onClick={addCorrItem} />
          </div>

          {corrItems.map((item, idx) => (
            <div key={idx} className="grid align-items-end mb-2 surface-card border-round p-2">
              <div className="col-12 sm:col-3">
                <label className="block text-xs font-bold mb-1">Campo</label>
                <Dropdown
                  value={item.campo}
                  options={CORRECTABLE_FIELDS.map(f => ({ label: f.label, value: f.campo }))}
                  onChange={(e) => updateCorrItem(idx, "campo", e.value)}
                  placeholder="Seleccionar campo"
                  className="w-full"
                  size="small"
                />
              </div>
              <div className="col-6 sm:col-2">
                <label className="block text-xs font-bold mb-1">
                  {item.campo === "otro" ? "Descripción del campo" : "Valor actual"}
                </label>
                {item.campo === "otro" ? (
                  <InputText
                    value={item.campoLibre || ""}
                    onChange={(e) => updateCorrItem(idx, "campoLibre", e.target.value)}
                    className="w-full"
                    placeholder="Ej: TMN, forma AG…"
                  />
                ) : (
                  <InputText
                    value={item.campo ? String(getFieldValue(item.campo, loadedDosif, resultado) ?? "—") : ""}
                    disabled
                    className="w-full"
                  />
                )}
              </div>
              <div className="col-6 sm:col-2">
                <label className="block text-xs font-bold mb-1">Valor nuevo</label>
                <InputText
                  value={item.valorNuevo}
                  onChange={(e) => updateCorrItem(idx, "valorNuevo", e.target.value)}
                  className="w-full"
                  placeholder="Nuevo valor"
                />
              </div>
              <div className="col-10 sm:col-4">
                <label className="block text-xs font-bold mb-1">Motivo</label>
                <InputText
                  value={item.motivo}
                  onChange={(e) => updateCorrItem(idx, "motivo", e.target.value)}
                  className="w-full"
                  placeholder="Justificación de la corrección"
                />
              </div>
              <div className="col-2 sm:col-1 flex justify-content-center">
                <Button icon="pi pi-trash" className="p-button-text p-button-danger p-button-sm" onClick={() => removeCorrItem(idx)} />
              </div>
            </div>
          ))}

          {corrItems.length > 0 && (
            <div className="flex justify-content-end mt-2">
              <Button
                label="Aplicar correcciones"
                icon="pi pi-check"
                onClick={handleAplicar}
                loading={applying}
                disabled={applying}
                size="small"
              />
            </div>
          )}
        </div>
      )}

      {/* Historial de correcciones para este pastón */}
      {pastonCorrecciones.length > 0 && (
        <div className="mt-2">
          <small className="font-bold block mb-1">
            <i className="fa-solid fa-history mr-1" />
            Correcciones aplicadas ({pastonCorrecciones.length})
          </small>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
                <th className="text-left py-1 px-2">Campo</th>
                <th className="text-right py-1 px-2">Anterior</th>
                <th className="text-right py-1 px-2">Nuevo</th>
                <th className="text-left py-1 px-2">Motivo</th>
                <th className="text-right py-1 px-2">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {pastonCorrecciones.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                  <td className="py-1 px-2">{c.campoLabel}</td>
                  <td className="text-right py-1 px-2 text-color-secondary">{c.valorAnterior} {c.unidad || ""}</td>
                  <td className="text-right py-1 px-2 font-bold text-primary">{c.valorNuevo} {c.unidad || ""}</td>
                  <td className="py-1 px-2 text-color-secondary">{c.motivo}</td>
                  <td className="text-right py-1 px-2 text-color-secondary">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-AR") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ═══════════════════════════════════════
   Component
   ═══════════════════════════════════════ */

const PastonPruebaSection = ({ resultado, loadedDosif, showToast, user, contexto, logoUrl, empresa }) => {
  const dosifId = loadedDosif?.idDosificacionDisenada || loadedDosif?.id;
  // Decisión 2026-05-28: modo del documento del pastón. Default DESCRIPTIVO.
  // El veredicto APROBADO/RECHAZADO/OBSERVADO del pastón se preserva en
  // ambos modos (lock-in D26 — vocabulario propio del flow experimental).
  const [modoEvaluacion, setModoEvaluacion] = useState(MODO_DESCRIPTIVO);

  // Consistency info from saved design
  const consParams = useMemo(() => {
    try {
      const p = typeof loadedDosif?.parametrosObjetivoJson === "string"
        ? JSON.parse(loadedDosif.parametrosObjetivoJson)
        : loadedDosif?.parametrosObjetivoJson;
      return p || {};
    } catch { return {}; }
  }, [loadedDosif?.parametrosObjetivoJson]);

  // B1 — Límites de a/c para alertar desvío en el informe de pastón.
  // acMaxPliego: techo contractual (parametrosObjetivo o traza del cálculo).
  // acMaxDurabilidad: Tabla 2.5 CIRSOC 200:2024 (salida del motor).
  const acLimites = useMemo(() => {
    const acMaxPliego = consParams?.acMaxPliego
      ?? resultado?.trazabilidad?.pliego?.acMaxPliego
      ?? null;
    const acMaxDurabilidad = resultado?.durabilidad?.acMax
      ?? resultado?.trazabilidad?.durabilidad?.acMax
      ?? null;
    const claseExposicion = consParams?.exposicion
      ?? consParams?.claseExposicion
      ?? null;
    return { acMaxPliego, acMaxDurabilidad, claseExposicion };
  }, [consParams, resultado]);

  const consMetodo = consParams.consistenciaMetodo || null;
  const consCodigo = consParams.consistenciaClase || null;
  const consValor = consParams.consistenciaValor != null ? Number(consParams.consistenciaValor) : null;
  const medicionLabel = METODO_MEDICION_LABELS[consMetodo] || "Asentamiento medido (cm)";

  // Available fresh tests for this consistency class
  const ensayosDisponibles = useMemo(() => ensayosFrescoDisponibles(consCodigo), [consCodigo]);

  /* ── Planned tests state ── */
  const initProbetas = () => Object.fromEntries(PROBETA_TYPES.map(p => [p.key, 0]));
  const initEnsayos = () => Object.fromEntries(ENSAYO_FRESCO_TYPES.map(e => [e.key, 0]));

  const [probetasCant, setProbetasCant] = useState(initProbetas);
  const [ensayosCant, setEnsayosCant] = useState(initEnsayos);
  const [volumenAdoptadoL, setVolumenAdoptadoL] = useState(31);
  const [correccionHumedad, setCorreccionHumedad] = useState(false);
  // PR8 — Escala del pastón. LABORATORIO (default): vol. en litros, materiales
  // en kg+L. PRODUCCION: pastón a escala real en planta, kg+m³, recomendado
  // ≥ 2.5 m³ para tener al menos 2 batches y poder corregir el primero.
  const [escalaPaston, setEscalaPaston] = useState('LABORATORIO');
  const [aceptarVolumenBajo, setAceptarVolumenBajo] = useState(false);
  // Origen del pastón (sesión 2026-06-12, revisión 2026-06-13):
  // El usuario puede tomar muestras en planta Y/O en obra (no son excluyentes).
  // Cada origen seleccionado genera una MuestraPaston separada con sus probetas
  // autonumeradas (`T{lote}-P-P{n}` para planta, `T{lote}-O-P{n}` para obra).
  // `cantPlanta` y `cantObra` dividen las probetas planificadas entre las dos
  // muestras; si solo se elige uno, esa cantidad es la total y la otra es 0.
  const [origenPlanta, setOrigenPlanta] = useState(true);
  const [origenObra, setOrigenObra] = useState(false);
  const [distribucionProbetas, setDistribucionProbetas] = useState({ planta: 0, obra: 0 });

  // Edades de rotura configurables (sesión 2026-06-13). Default [7, 28] —
  // las más comunes en obra civil. El usuario puede agregar/quitar edades
  // (ej. 14, 56, 90 días). Las probetas planificadas se distribuyen entre
  // las edades de forma equilibrada al guardar el pastón.
  const [edadesRotura, setEdadesRotura] = useState([7, 28]);
  const [nuevaEdad, setNuevaEdad] = useState(null);

  const agregarEdad = useCallback(() => {
    if (nuevaEdad == null || nuevaEdad <= 0) return;
    setEdadesRotura((prev) => {
      if (prev.includes(nuevaEdad)) return prev;
      return [...prev, nuevaEdad].sort((a, b) => a - b);
    });
    setNuevaEdad(null);
  }, [nuevaEdad]);

  const quitarEdad = useCallback((edad) => {
    setEdadesRotura((prev) => prev.length > 1 ? prev.filter((e) => e !== edad) : prev);
  }, []);
  // PR9 — Humedad medida por agregado al momento del pastón. Array de
  // { idAgregado, nombre, humedadPct, absorcionPct }. Usado por el motor
  // correccionHumedadEngine para ajustar agua y masas reales a cargar.
  const [humedadAgregados, setHumedadAgregados] = useState([]);

  // Protocol fields
  const [fecha, setFecha] = useState(null);
  const [hora, setHora] = useState(null);
  const [operador, setOperador] = useState("");
  const [consistenciaMedida, setConsistenciaMedida] = useState(null);
  const [temperaturaHormigon, setTemperaturaHormigon] = useState(null);
  const [temperaturaAmbiente, setTemperaturaAmbiente] = useState(null);
  const [puvMedido, setPuvMedido] = useState(null);
  const [aireMedido, setAireMedido] = useState(null);
  const [aspecto, setAspecto] = useState(null);
  const [probetasMoldeadas, setProbetasMoldeadas] = useState(null);
  const [identificacionProbetas, setIdentificacionProbetas] = useState("");
  const [observaciones, setObservaciones] = useState("");

  // Saved pastones & corrections
  const [pastones, setPastones] = useState([]);
  const [correcciones, setCorrecciones] = useState([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [editPaston, setEditPaston] = useState(null); // pastón en edición (dialog)
  const [editSaving, setEditSaving] = useState(false);
  const editSavingRef = useRef(false);
  // Guard de doble-submit del "Guardar veredicto" por pastón (id → bool).
  const [veredictoSavingId, setVeredictoSavingId] = useState(null);
  const veredictoSavingRef = useRef(false);
  // Probetas de las MuestraPaston del pastón en edición (1 por origen).
  // editMuestras: [{ idMuestraPaston, origen, probetas: [...] }]
  const [editMuestras, setEditMuestras] = useState([]);
  const [tiposProbeta, setTiposProbeta] = useState([]);

  // Al abrir el dialog de edición, cargar las muestras de pastón (con sus
  // probetas) y el catálogo de tipos para poder corregirlas.
  useEffect(() => {
    const idP = editPaston?.idPastonPrueba;
    if (!idP) { setEditMuestras([]); return; }
    let cancel = false;
    (async () => {
      try {
        const [muestrasRes, tiposRes] = await Promise.all([
          axios.get(`${config.backendUrl}/api/muestras-pastones?idPastonPrueba=${idP}`, { headers: config.headers }),
          tiposProbeta.length
            ? Promise.resolve({ data: tiposProbeta })
            : axios.get(`${config.backendUrl}/api/muestras/tipoprobeta`, { headers: config.headers }),
        ]);
        if (cancel) return;
        setTiposProbeta(tiposRes.data || []);
        setEditMuestras(
          (muestrasRes.data || []).map((m) => ({
            idMuestraPaston: m.idMuestraPaston,
            origen: m.origen,
            loteNumero: m.loteNumero,
            probetas: Array.isArray(m.probetas) ? m.probetas : [],
          }))
        );
      } catch (err) {
        if (!cancel) {
          console.error("Error cargando probetas del pastón:", err);
          setEditMuestras([]);
        }
      }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPaston?.idPastonPrueba]);

  const setProbetasDeMuestra = (idMuestraPaston, lista) =>
    setEditMuestras((prev) =>
      prev.map((m) => (m.idMuestraPaston === idMuestraPaston ? { ...m, probetas: lista } : m))
    );

  const setEditField = (k, v) => setEditPaston(prev => prev ? { ...prev, [k]: v } : prev);

  const handleGuardarEdicion = async () => {
    if (editSavingRef.current) return;
    if (!editPaston || !dosifId) return;
    try {
      editSavingRef.current = true;
      setEditSaving(true);
      // PR10 unificación (sesión 2026-06-13) — el edit dialog ya no permite
      // editar campos de medición (asentamiento, T° hormigón, T° ambiente,
      // aire, aspecto). La SSoT está en MedicionPaston (medición #1, base) y
      // los campos legacy de PastonPrueba se mantienen como mirror automático
      // desde `_mirrorBaseAPaston` en el service. PUV sí queda acá porque es
      // un dato único del pastón completo, no por medición.
      const payload = {
        fecha: editPaston.fecha || null,
        hora: editPaston.hora || null,
        operador: editPaston.operador || null,
        puvMedido: editPaston.puvMedido != null ? Number(editPaston.puvMedido) : null,
        observaciones: editPaston.observaciones || null,
      };
      if (Array.isArray(editPaston.componentes)) payload.componentes = editPaston.componentes;
      await actualizarPaston(dosifId, editPaston.idPastonPrueba, payload);

      // Sincronizar probetas de cada MuestraPaston (corregir cantidad/tipo/
      // edad). Las ya ensayadas el backend las protege.
      let resumenProbetas = "";
      for (const m of editMuestras) {
        const probetasPayload = (m.probetas || []).map((p) => ({
          idProbeta: p.idProbeta ?? null,
          idTipoProbeta: p.idTipoProbeta ?? p.tipoProbeta?.idTipoProbeta ?? null,
          diasRotura: p.diasRotura ?? 28,
          codigo: p.codigo || null,
          observaciones: p.observaciones || null,
          idEstadoProbeta: p.idEstadoProbeta ?? 1,
        }));
        const { data } = await axios.put(
          `${config.backendUrl}/api/muestras-pastones/${m.idMuestraPaston}/probetas`,
          { probetas: probetasPayload },
          { headers: config.headers }
        );
        if (data) {
          resumenProbetas += ` · ${m.origen === "OBRA" ? "Obra" : "Planta"}: +${data.creadas}/−${data.eliminadas}` +
            (data.bloqueadas ? ` (${data.bloqueadas} ensayada(s) intactas)` : "");
        }
      }
      showToast?.("success", `Pastón actualizado${resumenProbetas}`);
      const updated = await listarPastones(dosifId);
      setPastones(updated || []);
      setEditPaston(null);
    } catch (err) {
      showToast?.("error", err?.response?.data?.error || "Error al actualizar el pastón");
    } finally {
      editSavingRef.current = false;
      setEditSaving(false);
    }
  };

  /* ── Volume calculation (IRAM 1541) ── */

  // Total de probetas planificadas (suma de todos los tipos).
  const totalProbetasPlanificadas = useMemo(() => {
    return PROBETA_TYPES.reduce((sum, pt) => sum + (probetasCant[pt.key] || 0), 0);
  }, [probetasCant]);

  // Auto-distribución: cuando cambia la selección de orígenes o el total de
  // probetas, se reasigna la distribución por defecto. Solo planta → todas
  // a planta. Solo obra → todas a obra. Ambos → mitad y mitad (con resto a
  // planta si es impar). El usuario puede ajustar manualmente después.
  useEffect(() => {
    const total = totalProbetasPlanificadas;
    if (origenPlanta && !origenObra) {
      setDistribucionProbetas({ planta: total, obra: 0 });
    } else if (!origenPlanta && origenObra) {
      setDistribucionProbetas({ planta: 0, obra: total });
    } else if (origenPlanta && origenObra) {
      const mitad = Math.ceil(total / 2);
      setDistribucionProbetas({ planta: mitad, obra: total - mitad });
    } else {
      setDistribucionProbetas({ planta: 0, obra: 0 });
    }
  }, [origenPlanta, origenObra, totalProbetasPlanificadas]);

  const volCalc = useMemo(() => {
    let volProbetas = 0;
    let volEnsayos = 0;

    for (const pt of PROBETA_TYPES) {
      volProbetas += (probetasCant[pt.key] || 0) * pt.volumen_L;
    }
    for (const et of ENSAYO_FRESCO_TYPES) {
      volEnsayos += (ensayosCant[et.key] || 0) * et.volumen_L;
    }

    const volTotal = volProbetas + volEnsayos;
    const volMinimo = Math.ceil(volTotal * FACTOR_IRAM_1541);

    return { volProbetas, volEnsayos, volTotal, volMinimo };
  }, [probetasCant, ensayosCant]);

  // Enforce minimum
  useEffect(() => {
    if (volCalc.volMinimo > 0 && volumenAdoptadoL < volCalc.volMinimo) {
      setVolumenAdoptadoL(volCalc.volMinimo);
    }
  }, [volCalc.volMinimo]); // eslint-disable-line react-hooks/exhaustive-deps

  const volAdoptadoM3 = volumenAdoptadoL / 1000;

  // Components scaled to adopted volume
  const componentes = useMemo(
    () => escalarComponentes(resultado, volAdoptadoM3, contexto),
    [resultado, volAdoptadoM3, contexto]
  );

  // Retenidos por componente (solo agua y aditivos): key = nombre componente → número en la unidad de la fila
  const [retenidos, setRetenidos] = useState({});
  const setRetenido = (componente, val) => setRetenidos(prev => ({ ...prev, [componente]: val }));
  const esRetenible = (tipo) => tipo === "AGUA" || tipo === "ADITIVO";

  // Total row
  const componentesTotal = useMemo(() => {
    const totalKg = componentes.reduce((s, c) => s + (c.unidad === "g" ? c.kgM3 : c.kgM3), 0);
    const totalScaled = componentes.reduce((s, c) => s + c.cantidadScaled, 0);
    const totalCargado = componentes.reduce((s, c, i) => {
      const key = `${c.tipo}|${i}|${c.componente}`;
      const ret = Number(retenidos[key] || 0);
      return s + Math.max(c.cantidadScaled - ret, 0);
    }, 0);
    return { totalKg, totalScaled, totalCargado };
  }, [componentes, retenidos]);

  /* ── Presets ── */
  const applyPreset = useCallback((preset) => {
    const newP = initProbetas();
    const newE = initEnsayos();
    for (const [k, v] of Object.entries(preset.probetas || {})) newP[k] = v;
    for (const [k, v] of Object.entries(preset.ensayos || {})) newE[k] = v;
    setProbetasCant(newP);
    setEnsayosCant(newE);
    if (preset.volumenL) setVolumenAdoptadoL(preset.volumenL);
    // Sincronizar selector de escala con el preset elegido. Esto evita la
    // duplicación visual previa donde el preset "Escala producción" no
    // actualizaba el radio button de Escala del pastón.
    if (preset.escala === 'LABORATORIO' || preset.escala === 'PRODUCCION') {
      setEscalaPaston(preset.escala);
    }
  }, []);

  // Apply default preset on mount
  useEffect(() => {
    applyPreset(PRESETS[0]); // Mínimo
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load saved pastones & corrections ── */
  const loadCorrecciones = useCallback(() => {
    if (!dosifId) return;
    listarCorrecciones(dosifId)
      .then((data) => setCorrecciones(data || []))
      .catch(() => {});
  }, [dosifId]);

  useEffect(() => {
    if (!dosifId) return;
    listarPastones(dosifId)
      .then((data) => setPastones(data || []))
      .catch(() => {});
    loadCorrecciones();
  }, [dosifId, loadCorrecciones]);

  /* ── Save ── */
  const handleGuardar = useCallback(async () => {
    if (savingRef.current) return;
    if (!dosifId) {
      showToast?.("warn", "Debe guardar la dosificación primero");
      return;
    }
    // PR8 — Guard de volumen mínimo cuando escala = PRODUCCION (≥ 2.5 m³).
    // Si el operador acepta explícitamente ir con menos, mandamos
    // `acceptVolumenBajo: true` al backend para que no rechace.
    if (escalaPaston === 'PRODUCCION' && volAdoptadoM3 < 2.5 && !aceptarVolumenBajo) {
      showToast?.(
        "warn",
        `Para escala PRODUCCION se recomienda ≥ 2.5 m³ (≥ 2 batches de planta). Tu volumen actual es ${volAdoptadoM3.toFixed(2)} m³. Marcá "Aceptar volumen bajo" para continuar igual o aumentá el volumen.`
      );
      setSaving(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const body = {
        escala: escalaPaston,
        acceptVolumenBajo: aceptarVolumenBajo,
        volumenM3: volAdoptadoM3,
        factorExcedente: FACTOR_IRAM_1541,
        volumenEfectivoM3: volAdoptadoM3,
        correccionHumedad,
        humedadAgregadosJson: humedadAgregados.length > 0 ? humedadAgregados : null,
        componentes: componentes.map((c, i) => {
          const key = `${c.tipo}|${i}|${c.componente}`;
          const ret = Number(retenidos[key] || 0);
          return { ...c, retenido: ret > 0 ? ret : null, cargado: Math.max(c.cantidadScaled - ret, 0) };
        }),
        ensayosPlanificados: {
          probetas: PROBETA_TYPES.filter(p => probetasCant[p.key] > 0).map(p => ({ tipo: p.key, cantidad: probetasCant[p.key] })),
          ensayos_fresco: ENSAYO_FRESCO_TYPES.filter(e => ensayosCant[e.key] > 0).map(e => ({ tipo: e.key, cantidad: ensayosCant[e.key] })),
        },
        volumenEnsayosL: volCalc.volTotal,
        volumenMinimoL: volCalc.volMinimo,
        volumenAdoptadoL,
        fecha: fecha ? fecha.toISOString().slice(0, 10) : null,
        hora: toHHMM(hora),
        operador: operador || null,
        asentamientoMedido: consistenciaMedida,
        consistenciaMetodo: consMetodo,
        temperaturaHormigon,
        temperaturaAmbiente,
        puvMedido,
        aireMedido,
        aspecto,
        probetasMoldeadas,
        tipoProbeta: PROBETA_TYPES.find(p => probetasCant[p.key] > 0)?.key || "cilindrica_15x30",
        identificacionProbetas: identificacionProbetas || null,
        observaciones: observaciones || null,
      };
      const saved = await crearPaston(dosifId, body);
      setPastones((prev) => [...prev, saved]);
      showToast?.("success", "Pastón de prueba guardado");

      // Crear las MuestraPaston asociadas con las probetas auto-nombradas
      // `T{lote}-{O|P}-P{n}`. Si el usuario eligió ambos orígenes, se crean
      // dos muestras independientes con sus probetas distribuidas según
      // `distribucionProbetas` (sesión 2026-06-13). Si solo eligió uno,
      // todas las probetas van a esa única muestra.
      try {
        // Distribución round-robin de las probetas entre las edades configuradas.
        // Ej: 6 probetas × edades [7, 28, 56] → 2 a 7d, 2 a 28d, 2 a 56d.
        // Si la división no es exacta, el resto se asigna a la primera edad.
        const probetasFlat = [];
        const edades = edadesRotura.length > 0 ? edadesRotura : [28];
        PROBETA_TYPES.forEach((pt) => {
          const cant = probetasCant[pt.key] || 0;
          for (let i = 0; i < cant; i++) {
            probetasFlat.push({
              tipo: pt.key,
              diasRotura: edades[i % edades.length],
              idEstadoProbeta: 1,
            });
          }
        });

        const muestrasACrear = [];
        if (origenPlanta && distribucionProbetas.planta > 0) {
          muestrasACrear.push({ origen: 'PLANTA', probetas: probetasFlat.slice(0, distribucionProbetas.planta) });
        }
        if (origenObra && distribucionProbetas.obra > 0) {
          const desde = origenPlanta ? distribucionProbetas.planta : 0;
          muestrasACrear.push({ origen: 'OBRA', probetas: probetasFlat.slice(desde, desde + distribucionProbetas.obra) });
        }

        if (muestrasACrear.length > 0) {
          const resultados = await Promise.all(muestrasACrear.map((m) => axios.post(`${config.backendUrl}/api/muestras-pastones`, {
            idPastonPrueba: saved.idPastonPrueba,
            idDosificacion: dosifId,
            idPlanta: loadedDosif?.idPlanta,
            idObra: loadedDosif?.idObra || null,
            idCliente: loadedDosif?.idCliente || null,
            idTipoHormigon: loadedDosif?.idTipoHormigon || null,
            origen: m.origen,
            fecha: fecha ? fecha.toISOString().slice(0, 10) : null,
            temperaturaAmbiente,
            temperaturaHormigon,
            asentamiento: consistenciaMedida,
            aireincorporado: aireMedido,
            observaciones,
            probetas: m.probetas,
          }, { headers: config.headers })));
          const detalle = resultados.map((r, i) => `${muestrasACrear[i].probetas.length} en ${muestrasACrear[i].origen === 'OBRA' ? 'obra' : 'planta'}`).join(' + ');
          showToast?.("info", `Muestra(s) de pastón creadas: ${detalle}`);
        }
      } catch (err) {
        console.warn('Pastón guardado, pero no se pudo crear la muestra de pastón asociada:', err);
        showToast?.("warn", "El pastón se guardó, pero hubo un problema al crear las muestras (las probetas no quedaron auto-nombradas). Revisar más tarde.");
      }
    } catch (err) {
      showToast?.("error", err?.response?.data?.error || "Error al guardar pastón");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [
    dosifId, volAdoptadoM3, correccionHumedad, componentes, retenidos,
    probetasCant, ensayosCant, volCalc, volumenAdoptadoL,
    fecha, hora, operador, consistenciaMedida, consMetodo,
    temperaturaHormigon, temperaturaAmbiente, puvMedido, aireMedido,
    aspecto, probetasMoldeadas, identificacionProbetas, observaciones,
    origenPlanta, origenObra, distribucionProbetas, edadesRotura, loadedDosif, showToast,
  ]);

  const handleEliminar = useCallback(async (pid) => {
    if (!dosifId) return;
    try {
      await eliminarPaston(dosifId, pid);
      setPastones((prev) => prev.filter((p) => p.idPastonPrueba !== pid));
      showToast?.("success", "Pastón eliminado");
    } catch {
      showToast?.("error", "Error al eliminar");
    }
  }, [dosifId, showToast]);

  // Ronda actual y si ya hay pastón registrado
  const rondaActual = Number(loadedDosif?.numeroRondaPrueba) || 1;
  const yaHayEnRonda = (pastones || []).some(p => (Number(p.numeroRondaPrueba) || 1) === rondaActual);

  if (!resultado) return null;

  return (
    <div className="card mt-3">
      <div className="flex align-items-center justify-content-between mb-3">
        <h3 className="m-0">
          <i className="fa-solid fa-flask-vial mr-2 text-purple-500" />
          Pastón de prueba
        </h3>
      </div>

      {/* ═══ Formulario oculto si ya hay pastón en la ronda actual ═══ */}
      {yaHayEnRonda ? (
        <Message
          severity="info"
          className="w-full mb-3"
          text={`Ya hay un pastón registrado para la ronda #${rondaActual}. Para registrar otro, enviá la dosificación a una nueva ronda de prueba.`}
        />
      ) : (
      <>

      {/* ═══ Planificación de ensayos ═══ */}
      <div className="surface-card border-round border-1 border-300 p-3 mb-3">
        <div className="flex align-items-center gap-2 mb-3">
          <i className="fa-solid fa-vials text-primary" />
          <span className="font-bold text-sm">Ensayos y probetas planificados</span>
        </div>

        {/* Selector de escala (única fuente — elimina la duplicación previa
            entre presets y radio button al final). Cada botón configura las
            probetas+ensayos default, las unidades de la tabla y sincroniza
            `escalaPaston` para que el resto del componente reaccione. */}
        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((preset) => {
            const isActive = escalaPaston === preset.escala;
            return (
              <Button
                key={preset.label}
                label={preset.label}
                tooltip={preset.desc}
                tooltipOptions={{ position: "top" }}
                outlined={!isActive}
                severity={isActive ? undefined : 'secondary'}
                icon={preset.escala === 'PRODUCCION' ? 'fa-solid fa-industry' : 'fa-solid fa-flask'}
                size="small"
                onClick={() => applyPreset(preset)}
              />
            );
          })}
          <small className="text-color-secondary align-self-center ml-2">
            {escalaPaston === 'PRODUCCION'
              ? 'Pastón real de planta — ingresá el volumen abajo.'
              : 'Pastón de validación técnica en laboratorio.'}
          </small>
        </div>

        {/* Origen(es) de la muestra — checkboxes NO excluyentes (sesión
            2026-06-13). El usuario puede tomar muestras en planta Y/O en obra.
            Si elige ambos, se generan 2 MuestraPaston separadas con las
            probetas distribuidas según los inputs de cantidad. */}
        <div className="surface-100 border-round p-2 mb-3">
          <div className="flex align-items-center gap-3 flex-wrap mb-2">
            <span className="text-sm font-bold">¿Dónde se toma la muestra?</span>
            <div className="flex align-items-center gap-2">
              <Checkbox
                inputId="origen_planta_chk"
                checked={origenPlanta}
                onChange={(e) => setOrigenPlanta(e.checked)}
              />
              <label htmlFor="origen_planta_chk" className="text-sm cursor-pointer">
                En planta <span className="text-color-secondary">(T{1}-P-Pn)</span>
              </label>
            </div>
            <div className="flex align-items-center gap-2">
              <Checkbox
                inputId="origen_obra_chk"
                checked={origenObra}
                onChange={(e) => setOrigenObra(e.checked)}
              />
              <label htmlFor="origen_obra_chk" className="text-sm cursor-pointer">
                En obra <span className="text-color-secondary">(T{1}-O-Pn)</span>
              </label>
            </div>
          </div>

          {/* Distribución de probetas — solo si hay ambos orígenes activos.
              Cuando solo hay uno, todas las probetas planificadas van a esa muestra. */}
          {origenPlanta && origenObra && totalProbetasPlanificadas > 0 && (
            <div className="flex align-items-center gap-3 flex-wrap mt-1 pl-2" style={{ borderLeft: '2px solid var(--surface-300)' }}>
              <small className="text-color-secondary">
                Distribuir las <strong>{totalProbetasPlanificadas}</strong> probetas planificadas:
              </small>
              <div className="flex align-items-center gap-2">
                <label className="text-xs">En planta:</label>
                <InputNumber
                  value={distribucionProbetas.planta}
                  onValueChange={(e) => {
                    const planta = Math.max(0, Math.min(totalProbetasPlanificadas, e.value || 0));
                    setDistribucionProbetas({ planta, obra: totalProbetasPlanificadas - planta });
                  }}
                  min={0}
                  max={totalProbetasPlanificadas}
                  showButtons buttonLayout="horizontal"
                  decrementButtonClassName="p-button-secondary"
                  incrementButtonClassName="p-button-secondary"
                  inputStyle={{ width: '50px', textAlign: 'center' }}
                />
              </div>
              <div className="flex align-items-center gap-2">
                <label className="text-xs">En obra:</label>
                <InputNumber
                  value={distribucionProbetas.obra}
                  onValueChange={(e) => {
                    const obra = Math.max(0, Math.min(totalProbetasPlanificadas, e.value || 0));
                    setDistribucionProbetas({ planta: totalProbetasPlanificadas - obra, obra });
                  }}
                  min={0}
                  max={totalProbetasPlanificadas}
                  showButtons buttonLayout="horizontal"
                  decrementButtonClassName="p-button-secondary"
                  incrementButtonClassName="p-button-secondary"
                  inputStyle={{ width: '50px', textAlign: 'center' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Edades de rotura (días) — configurables por el usuario.
            Default [7, 28]. Las probetas planificadas se distribuyen
            round-robin entre las edades elegidas al guardar el pastón. */}
        <div className="mb-3 surface-100 border-round p-2">
          <div className="flex align-items-center gap-2 flex-wrap">
            <small className="font-bold">Edades de rotura (días):</small>
            {edadesRotura.map((edad) => (
              <Tag
                key={edad}
                value={`${edad} d`}
                severity="info"
                icon="fa-solid fa-clock"
                style={{ cursor: edadesRotura.length > 1 ? 'pointer' : 'default' }}
                onClick={() => quitarEdad(edad)}
                title={edadesRotura.length > 1 ? 'Click para quitar' : 'Mínimo una edad requerida'}
              />
            ))}
            <div className="flex align-items-center gap-1">
              <InputNumber
                value={nuevaEdad}
                onValueChange={(e) => setNuevaEdad(e.value)}
                min={1}
                max={365}
                placeholder="d"
                showButtons={false}
                inputStyle={{ width: '60px' }}
              />
              <Button
                icon="fa-solid fa-plus"
                size="small"
                outlined
                onClick={agregarEdad}
                disabled={!nuevaEdad || edadesRotura.includes(nuevaEdad)}
                tooltip="Agregar esta edad de rotura"
                tooltipOptions={{ position: 'top' }}
              />
            </div>
          </div>
          <small className="text-color-secondary block mt-1">
            Las {totalProbetasPlanificadas || 0} probetas planificadas se reparten entre estas edades de forma equilibrada.
          </small>
        </div>

        {/* Probetas de resistencia */}
        <div className="mb-3">
          <small className="font-bold block mb-2">Probetas de resistencia</small>
          <div className="flex flex-column gap-2">
            {PROBETA_TYPES.map((pt) => (
              <div key={pt.key} className="flex align-items-center gap-2">
                <button
                  type="button"
                  className="p-button p-button-outlined p-button-secondary p-button-sm flex align-items-center justify-content-center"
                  style={{ width: "2rem", height: "2rem", padding: 0, fontSize: "1.1rem", lineHeight: 1 }}
                  onClick={() => setProbetasCant(prev => ({ ...prev, [pt.key]: Math.max(0, (prev[pt.key] || 0) - 1) }))}
                  disabled={!probetasCant[pt.key]}
                >
                  −
                </button>
                <span className="font-bold text-center" style={{ width: "1.5rem" }}>
                  {probetasCant[pt.key] || 0}
                </span>
                <button
                  type="button"
                  className="p-button p-button-outlined p-button-secondary p-button-sm flex align-items-center justify-content-center"
                  style={{ width: "2rem", height: "2rem", padding: 0, fontSize: "1.1rem", lineHeight: 1 }}
                  onClick={() => setProbetasCant(prev => ({ ...prev, [pt.key]: Math.min(20, (prev[pt.key] || 0) + 1) }))}
                >
                  +
                </button>
                <span
                  className="text-sm cursor-help"
                  data-pr-tooltip={`${pt.volumen_L} L por unidad · ${pt.norma}`}
                  data-pr-position="top"
                >
                  {pt.nombre}
                </span>
              </div>
            ))}
          </div>
        </div>
        <Tooltip target="[data-pr-tooltip]" />

        {/* Ensayos en estado fresco */}
        <div className="mb-3">
          <small className="font-bold block mb-2">Ensayos en estado fresco</small>
          <div className="flex flex-column gap-2">
            {ENSAYO_FRESCO_TYPES.filter(et => ensayosDisponibles.has(et.key)).map((et) => (
              <div key={et.key} className="flex align-items-center gap-2">
                <button
                  type="button"
                  className="p-button p-button-outlined p-button-secondary p-button-sm flex align-items-center justify-content-center"
                  style={{ width: "2rem", height: "2rem", padding: 0, fontSize: "1.1rem", lineHeight: 1 }}
                  onClick={() => setEnsayosCant(prev => ({ ...prev, [et.key]: Math.max(0, (prev[et.key] || 0) - 1) }))}
                  disabled={!ensayosCant[et.key]}
                >
                  −
                </button>
                <span className="font-bold text-center" style={{ width: "1.5rem" }}>
                  {ensayosCant[et.key] || 0}
                </span>
                <button
                  type="button"
                  className="p-button p-button-outlined p-button-secondary p-button-sm flex align-items-center justify-content-center"
                  style={{ width: "2rem", height: "2rem", padding: 0, fontSize: "1.1rem", lineHeight: 1 }}
                  onClick={() => setEnsayosCant(prev => ({ ...prev, [et.key]: Math.min(10, (prev[et.key] || 0) + 1) }))}
                >
                  +
                </button>
                <span
                  className="text-sm cursor-help"
                  data-pr-tooltip={`${et.volumen_L} L por ensayo · ${et.norma}`}
                  data-pr-position="top"
                >
                  {et.key === "cono_abrams" ? conoLabel(consMetodo) : et.nombre}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de volúmenes */}
        <div className="surface-100 border-round p-3">
          <div className="flex flex-wrap align-items-end gap-3">
            <div className="flex flex-column gap-1 text-sm flex-grow-1">
              <div className="flex align-items-center gap-3 flex-wrap">
                <span>Vol. ensayos: <strong>{fmtNum(volCalc.volTotal, 1)} L</strong></span>
                <span className="text-color-secondary">×{FACTOR_IRAM_1541.toFixed(2)} (IRAM 1541)</span>
                <span>Mín: <strong>{volCalc.volMinimo} L</strong></span>
              </div>
            </div>
            <div style={{ minWidth: "140px" }}>
              <label className="block text-sm font-bold mb-1">Vol. adoptado</label>
              <InputNumber
                value={volumenAdoptadoL / 1000}
                onValueChange={(e) => {
                  const m3 = e.value || 0;
                  const litros = Math.round(m3 * 1000);
                  setVolumenAdoptadoL(Math.max(litros, volCalc.volMinimo));
                }}
                min={(volCalc.volMinimo || 1) / 1000}
                max={20}
                mode="decimal"
                minFractionDigits={2}
                maxFractionDigits={2}
                suffix=" m³"
                className="w-full"
              />
              <div className="text-xs text-color-secondary mt-1">
                = {volumenAdoptadoL.toLocaleString('es-AR')} L
              </div>
            </div>
          </div>
          <div className="flex align-items-center gap-2 mt-2">
            <Checkbox
              checked={correccionHumedad}
              onChange={(e) => {
                setCorreccionHumedad(e.checked);
                // PR9 — Cuando se activa el flag, pre-poblar la tabla de
                // humedades con los agregados detectados en componentes.
                // La absorción se pre-puebla automáticamente desde
                // `absorcionPct` (que el backend resolvió desde la ficha
                // técnica del agregado o desde el ensayo IRAM 1520/1533);
                // solo si no hay dato queda en null para ingreso manual.
                if (e.checked && humedadAgregados.length === 0) {
                  const agreg = (componentes || []).filter((c) => c.tipo === 'AGREGADO' || c.tipo === 'AGREGADO_FINO' || c.tipo === 'AGREGADO_GRUESO');
                  setHumedadAgregados(agreg.map((c) => ({
                    idAgregado: c.idAgregado || c.id || null,
                    nombre: c.componente || c.nombre || '—',
                    humedadPct: null,
                    absorcionPct: c.absorcionPct != null ? Number(c.absorcionPct) : (c.absorcion != null ? Number(c.absorcion) : null),
                    absorcionOrigen: c.absorcionOrigen || null,
                  })));
                }
              }}
            />
            <label className="text-sm">Corregir cantidades por humedad de agregados</label>
          </div>

          {/* PR9 — Tabla de humedad por agregado (solo si flag activo) */}
          {correccionHumedad && humedadAgregados.length > 0 && (
            <div className="surface-100 border-round p-2 mt-2">
              <small className="font-bold block mb-1">Humedad medida en planta (% sobre seco)</small>
              <table style={{ width: '100%', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Agregado</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Humedad (%)</th>
                    <th style={{ textAlign: 'right', width: 110 }}>Absorción (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {humedadAgregados.map((row, idx) => {
                    // Indicador visual del origen de la absorción:
                    //   ENSAYO_AGREGADO → dato proviene de un ensayo IRAM 1520/1533 cargado en el agregado.
                    //   MATERIAL_AGREGADO → dato proviene de la ficha técnica del agregado.
                    //   null → no se encontró dato; el usuario debe ingresarlo a mano.
                    const origenLabel = row.absorcionOrigen === 'ENSAYO_AGREGADO' ? 'Ensayo'
                      : row.absorcionOrigen === 'MATERIAL_AGREGADO' ? 'Ficha'
                      : null;
                    return (
                    <tr key={`${row.idAgregado || idx}`}>
                      <td>{row.nombre}</td>
                      <td style={{ textAlign: 'right' }}>
                        <InputNumber
                          value={row.humedadPct}
                          onValueChange={(e) => {
                            const next = [...humedadAgregados];
                            next[idx] = { ...next[idx], humedadPct: e.value };
                            setHumedadAgregados(next);
                          }}
                          onKeyDown={handleDecimalKey}
                          min={0}
                          max={20}
                          minFractionDigits={1}
                          maxFractionDigits={1}
                          showButtons={false}
                          inputStyle={{ width: '90px', textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex justify-content-end align-items-center gap-2">
                          {origenLabel && (
                            <Tag
                              value={origenLabel}
                              severity={row.absorcionOrigen === 'ENSAYO_AGREGADO' ? 'success' : 'info'}
                              tooltip={row.absorcionOrigen === 'ENSAYO_AGREGADO' ? 'Dato proveniente de ensayo IRAM 1520/1533' : 'Dato proveniente de la ficha técnica del agregado'}
                              style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}
                            />
                          )}
                          <InputNumber
                            value={row.absorcionPct}
                            onValueChange={(e) => {
                              const next = [...humedadAgregados];
                              // Si el usuario edita manualmente, el origen pasa a MANUAL para
                              // que la trazabilidad refleje que ya no es el dato canónico del agregado.
                              next[idx] = { ...next[idx], absorcionPct: e.value, absorcionOrigen: 'MANUAL' };
                              setHumedadAgregados(next);
                            }}
                            onKeyDown={handleDecimalKey}
                            min={0}
                            max={10}
                            minFractionDigits={1}
                            maxFractionDigits={2}
                            showButtons={false}
                            inputStyle={{ width: '90px', textAlign: 'right' }}
                          />
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <small className="text-color-secondary block mt-1">
                Humedad libre = humedad medida − absorción. Si es positiva, el agregado aporta agua al mix; si es negativa, la absorbe.
              </small>
            </div>
          )}

          {/* Alerta de volumen mínimo cuando se eligió Escala Producción. El
              selector explícito de escala se eliminó: ahora vive en los
              botones grandes de arriba (Escala laboratorio / Escala producción)
              que son la única fuente y configuran probetas + ensayos. */}
          {escalaPaston === 'PRODUCCION' && volAdoptadoM3 < 2.5 && (
            <div className="mt-3">
              <Message
                severity="warn"
                className="w-full"
                text={`En escala PRODUCCION conviene un volumen ≥ 2.5 m³ para tener al menos 2 batches de planta (~1.5 m³/batch) y poder corregir errores del primer batch antes del despacho. Tu volumen actual es ${volAdoptadoM3.toFixed(2)} m³.`}
              />
              <div className="flex align-items-center gap-2 mt-2">
                <Checkbox
                  inputId="aceptar_vol_bajo"
                  checked={aceptarVolumenBajo}
                  onChange={(e) => setAceptarVolumenBajo(e.checked)}
                />
                <label htmlFor="aceptar_vol_bajo" className="text-sm cursor-pointer">
                  Aceptar volumen bajo y guardar igual (queda registrado en el historial).
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Tabla de componentes escalados ═══ */}
      {componentes.length > 0 && (
        <>
          <h4 className="mt-0 mb-2">
            <i className="fa-solid fa-list-check mr-2" />
            Cantidades para {volumenAdoptadoL} L
          </h4>
          <DataTable responsiveLayout="scroll"
            value={componentes}
            size="small"
            stripedRows
            className="text-sm mb-2"
            footer={
              <div className="flex justify-content-between font-bold px-2">
                <span>TOTAL CARGADO (real)</span>
                <span>{fmtNum(componentesTotal.totalCargado, 0)}</span>
              </div>
            }
          >
            <Column field="componente" header="Componente" />
            <Column
              field="kgM3"
              header="Dosif. (kg/m³)"
              body={(row) => fmtNum(row.kgM3, 1)}
              style={{ width: "110px", textAlign: "right" }}
            />
            <Column
              field="cantidadScaled"
              header="Dosificado (pastón)"
              body={(row) => (
                <span className="text-color-secondary">
                  {fmtNum(row.cantidadScaled, row.cantidadScaled < 100 ? 1 : 0)} {row.unidad}
                </span>
              )}
              style={{ width: "130px", textAlign: "right" }}
            />
            {/* Columnas "Retenido" y "Cargado (real)" eliminadas (sesión
                2026-06-13): los retenidos se cargan en la Medición #1 del
                Timeline (con identificación correcta de cada aditivo/fibra
                por nombre). Tener dos lugares para lo mismo generaba
                inconsistencias entre el protocolo y el timeline. */}
          </DataTable>

          {correccionHumedad && (
            <Message
              severity="info"
              text="Corrija manualmente las cantidades de agregados y agua según la humedad real de los materiales al momento de la mezcla."
              className="mb-3 w-full"
            />
          )}
        </>
      )}

      <Divider />

      {/* ═══ Protocolo de ensayo ═══ */}
      <h4 className="mt-0 mb-3">
        <i className="fa-solid fa-clipboard-list mr-2" />
        Protocolo de ensayo
      </h4>

      {/* Fila 1: Datos del ensayo */}
      <div className="grid">
        <div className="col-6 sm:col-3">
          <label className="block text-sm font-bold mb-1">Fecha</label>
          <Calendar
            value={fecha}
            onChange={(e) => setFecha(e.value)}
            dateFormat="dd/mm/yy"
            showIcon
            className="w-full"
          />
        </div>
        <div className="col-6 sm:col-3">
          <label className="block text-sm font-bold mb-1">Hora</label>
          <Calendar
            value={hora}
            onChange={(e) => setHora(e.value)}
            timeOnly
            showIcon
            icon={() => <i className="fa-solid fa-clock" />}
            className="w-full"
          />
        </div>
        <div className="col-12 sm:col-3">
          <label className="block text-sm font-bold mb-1">Operador</label>
          <InputText
            value={operador}
            onChange={(e) => setOperador(e.target.value)}
            placeholder="Nombre del operador"
            className="w-full"
          />
        </div>
        <div className="col-6 sm:col-3">
          <label className="block text-sm font-bold mb-1">PUV (kg/m³)</label>
          <InputNumber
            value={puvMedido}
            onValueChange={(e) => setPuvMedido(e.value)}
            min={1500}
            max={3000}
            className="w-full"
            tooltip="Peso unitario verificado del hormigón fresco completo. Es un único dato del pastón, no por medición."
            tooltipOptions={{ position: 'top' }}
          />
        </div>
      </div>

      {/* PR10 — Las mediciones (slump, T°, aire, aspecto, probetas) ya no se
          cargan acá. Cada muestreo (planta, transporte, obra) va al panel
          "Mediciones" más abajo. Los campos legacy del backend siguen aceptados
          por back-compat — si el caller los manda, el service los redirige
          automáticamente a la primera MedicionPaston. */}
      <Message
        severity="info"
        className="mt-3 w-full"
        text={`Las mediciones (${medicionLabel}, temperaturas, aire) Y los agregados de agua/aditivos en obra se cargan en el "Timeline del pastón" (sección Mediciones más abajo) — cada evento queda contabilizado y permite calcular el a/c efectivo final. No usar el campo Observaciones para contabilizar materiales: ahí no quedan trazados.`}
      />

      {/* Fila 3: solo observaciones generales — el campo "Identificación
          probetas" fue eliminado (sesión 2026-06-12) porque las probetas se
          autonombran T{lote}-{O|P}-Pn al crear la MuestraPaston asociada. */}
      <div className="grid mt-2">
        <div className="col-12">
          <label className="block text-sm font-bold mb-1">Observaciones generales</label>
          <InputTextarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={2}
            className="w-full"
            autoResize
          />
        </div>
      </div>

      {/* Buttons. El PDF de acá es la PLANILLA DE CAMPO previa al moldeo
          (cantidades a cargar, probetas a moldear, ensayos planificados). Es
          distinto del "Informe completo" que aparece en cada fila de pastón
          guardado (que incluye mediciones reales + correcciones aplicadas). */}
      <div className="flex justify-content-end align-items-center mt-3 gap-2">
        <div className="flex align-items-center gap-2 pr-3 mr-2"
             style={{ borderRight: '1px solid var(--surface-border)' }}>
          <span className="text-xs text-color-secondary">Modo PDF:</span>
          <SelectButton
            value={modoEvaluacion}
            onChange={(e) => e.value && setModoEvaluacion(e.value)}
            options={[
              { label: "Descriptivo", value: MODO_DESCRIPTIVO },
              { label: "Normativo",   value: MODO_NORMATIVO },
            ]}
            pt={{ button: { className: 'text-xs py-1 px-2' } }}
          />
        </div>
        <Button
          label="Planilla de campo (PDF)"
          icon="pi pi-file-pdf"
          tooltip="Imprime la planilla previa al moldeo con cantidades, probetas a moldear y ensayos planificados"
          tooltipOptions={{ position: 'top' }}
          className="p-button-outlined"
          onClick={() => {
            generarPastonPruebaPdf(
              {
                volumenM3: volAdoptadoM3,
                factorExcedente: FACTOR_IRAM_1541,
                volumenEfectivoM3: volAdoptadoM3,
                correccionHumedad,
                componentes,
                ensayosPlanificados: {
                  probetas: PROBETA_TYPES.filter(p => probetasCant[p.key] > 0).map(p => ({ tipo: p.key, nombre: p.nombre, cantidad: probetasCant[p.key] })),
                  ensayos_fresco: ENSAYO_FRESCO_TYPES.filter(e => ensayosCant[e.key] > 0).map(e => ({ tipo: e.key, nombre: e.nombre, cantidad: ensayosCant[e.key] })),
                },
                volumenEnsayosL: volCalc.volTotal,
                volumenMinimoL: volCalc.volMinimo,
                volumenAdoptadoL,
                fecha: fecha ? fecha.toISOString().slice(0, 10) : null,
                hora: toHHMM(hora),
                operador,
                asentamientoMedido: consistenciaMedida,
                consistenciaMetodo: consMetodo,
                temperaturaHormigon,
                temperaturaAmbiente,
                puvMedido,
                aireMedido,
                aspecto,
                probetasMoldeadas,
                tipoProbeta: PROBETA_TYPES.find(p => probetasCant[p.key] > 0)?.key || "cilindrica_15x30",
                identificacionProbetas,
                observaciones,
              },
              {
                dosifNombre: loadedDosif?.nombre, logoUrl, empresa,
                acMaxPliego: acLimites.acMaxPliego,
                acMaxDurabilidad: acLimites.acMaxDurabilidad,
                claseExposicion: acLimites.claseExposicion,
                modoEvaluacion,
              }
            );
          }}
        />
        <Button
          label="Guardar pastón"
          icon="pi pi-save"
          onClick={handleGuardar}
          loading={saving}
          disabled={!dosifId || saving}
          tooltip={!dosifId ? "Guarde la dosificación primero" : undefined}
        />
      </div>

      </>
      )}

      {/* ═══ Saved pastones with comparison panel ═══ */}
      {pastones.length > 0 && (
        <>
          <Divider />
          <h4 className="mt-0 mb-2">
            <i className="fa-solid fa-list mr-2" />
            Pastones registrados ({pastones.length})
          </h4>
          {pastones.map((p, idx) => {
            const tol = consParams.consistenciaRange?.tol ?? 2.0;
            const diffAsent = p.asentamientoMedido != null && consValor != null
              ? Number(p.asentamientoMedido) - consValor : null;
            const asentOk = diffAsent != null ? Math.abs(diffAsent) <= tol : null;
            const diffPuv = p.puvMedido != null && resultado?.puvKgM3 != null
              ? Number(p.puvMedido) - resultado.puvKgM3 : null;
            const diffAire = p.aireMedido != null && resultado?.airePct != null
              ? Number(p.aireMedido) - resultado.airePct : null;

            const compRows = [
              { param: consMetodo === "extendido" ? "Extendido" : "Asentamiento",
                unit: "cm", diseno: consValor, medido: p.asentamientoMedido != null ? Number(p.asentamientoMedido) : null,
                diff: diffAsent, ok: asentOk },
              { param: "PUV", unit: "kg/m³", diseno: resultado?.puvKgM3, medido: p.puvMedido != null ? Number(p.puvMedido) : null,
                diff: diffPuv, ok: diffPuv != null ? Math.abs(diffPuv) <= 30 : null },
              { param: "Aire", unit: "%", diseno: resultado?.airePct, medido: p.aireMedido != null ? Number(p.aireMedido) : null,
                diff: diffAire, ok: diffAire != null ? Math.abs(diffAire) <= 0.5 : null },
              { param: "Temp. hormigón", unit: "°C", diseno: null, medido: p.temperaturaHormigon != null ? Number(p.temperaturaHormigon) : null, diff: null, ok: null },
              { param: "Temp. ambiente", unit: "°C", diseno: null, medido: p.temperaturaAmbiente != null ? Number(p.temperaturaAmbiente) : null, diff: null, ok: null },
            ].filter(r => r.medido != null || r.diseno != null);

            return (
              <div key={p.idPastonPrueba} className="surface-card border-round border-1 border-300 p-3 mb-3">
                <div className="flex align-items-center justify-content-between mb-2">
                  <div className="flex align-items-center gap-2">
                    <span className="font-bold">PASTÓN #{idx + 1}</span>
                    <span className="text-color-secondary">— {p.fecha || "Sin fecha"}</span>
                    {p.operador && <span className="text-color-secondary">│ {p.operador}</span>}
                    <span className="text-color-secondary">│ {fmtNum((p.volumenAdoptadoL || p.volumenM3 * 1000), 0)} L</span>
                  </div>
                  {/* Estilo unificado con Button de PrimeReact: tooltip claro,
                      ícono + label, severities semánticas. El botón "+ Acción"
                      se eliminó (sesión 2026-06-12): las acciones ahora se
                      cargan dentro del Timeline del pastón con "Agregar evento". */}
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      icon="fa-solid fa-file-pdf"
                      label="Informe"
                      size="small"
                      severity="secondary"
                      outlined
                      tooltip="Informe completo del pastón con mediciones y correcciones aplicadas"
                      tooltipOptions={{ position: 'top' }}
                      onClick={async () => {
                        let mediciones = [], ajustes = [], muestrasPaston = [];
                        try {
                          const { listarMedicionesPaston, listarRedosificaciones, listarMuestrasDePaston } = await import("../../../services/dosificacionDisenoService");
                          [mediciones, ajustes, muestrasPaston] = await Promise.all([
                            listarMedicionesPaston(p.idPastonPrueba).catch(() => []),
                            loadedDosif?.id ? listarRedosificaciones(loadedDosif.id).catch(() => []) : Promise.resolve([]),
                            listarMuestrasDePaston(p.idPastonPrueba).catch(() => []),
                          ]);
                        } catch (err) { console.warn("No se pudieron cargar mediciones/ajustes/muestras:", err); }
                        try {
                          /* aditivosMeta: ficha técnica resumida de cada aditivo
                             (efecto declarado en slump y reducción de agua) para
                             que el PDF compare el efecto observado contra el
                             esperado. Tomado del contexto que viene desde la
                             página padre (DosificacionDisenoPage) populado con
                             aditivosById de la API. */
                          const aditivosMeta = (resultado?.aditivos || [])
                            .map((a, idx) => ({
                              refIdx: idx,
                              nombre: contexto?.aditivos?.[idx]?.label || `Aditivo ${idx + 1}`,
                              dosisDiseno: Number(a.kgM3) || 0,
                              unidad: 'kg/m³',
                              incrementoAsentamientoEsperado: contexto?.aditivos?.[idx]?.incrementoAsentamientoEsperado ?? null,
                              reduccionAguaPctEsperada: contexto?.aditivos?.[idx]?.reduccionAguaPctEsperada ?? null,
                              modoEfectoSugerido: contexto?.aditivos?.[idx]?.modoEfectoSugerido ?? null,
                            }))
                            .filter(a => a.dosisDiseno > 0);
                          await generarPastonPruebaPdf(p, { dosifNombre: loadedDosif?.nombre, logoUrl, empresa, mediciones, ajustes, aditivosMeta, muestrasPaston, acMaxPliego: acLimites.acMaxPliego, acMaxDurabilidad: acLimites.acMaxDurabilidad, claseExposicion: acLimites.claseExposicion, modoEvaluacion });
                        } catch (err) {
                          console.error("Error generando PDF del pastón:", err);
                          showToast?.("error", "No se pudo generar el PDF del pastón");
                        }
                      }}
                    />
                    <Button
                      icon="fa-solid fa-pencil"
                      label="Editar"
                      size="small"
                      outlined
                      tooltip="Editar datos del pastón"
                      tooltipOptions={{ position: 'top' }}
                      onClick={() => {
                        let comps = p.componentes;
                        if (typeof comps === "string") { try { comps = JSON.parse(comps); } catch { comps = []; } }
                        if (!Array.isArray(comps)) comps = [];
                        setEditPaston({
                          idPastonPrueba: p.idPastonPrueba,
                          escala: p.escala || 'LABORATORIO',
                          fecha: p.fecha || null,
                          hora: p.hora || null,
                          operador: p.operador || "",
                          puvMedido: p.puvMedido != null ? Number(p.puvMedido) : null,
                          observaciones: p.observaciones || "",
                          componentes: comps,
                        });
                      }}
                    />
                    {/* Botón "Probetas 7d/28d" eliminado (sesión 2026-06-13):
                        las probetas se crean automáticamente al guardar el
                        pastón con los días de rotura indicados en cada tipo.
                        El botón era de una versión anterior y resultaba confuso. */}
                    <Button
                      icon="fa-solid fa-trash"
                      label="Borrar"
                      size="small"
                      severity="danger"
                      outlined
                      tooltip="Eliminar pastón"
                      tooltipOptions={{ position: 'top' }}
                      onClick={() => handleEliminar(p.idPastonPrueba)}
                    />
                  </div>
                </div>

                {/* Comparison table */}
                {compRows.length > 0 && (
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
                        <th className="text-left py-1 px-2" style={{ width: "35%" }}>Parámetro</th>
                        <th className="text-right py-1 px-2" style={{ width: "20%" }}>Diseño</th>
                        <th className="text-right py-1 px-2" style={{ width: "20%" }}>Medido</th>
                        <th className="text-right py-1 px-2" style={{ width: "25%" }}>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compRows.map((r) => (
                        <tr key={r.param} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                          <td className="py-1 px-2">{r.param}</td>
                          <td className="text-right py-1 px-2 text-color-secondary">
                            {r.diseno != null ? `${fmtNum(r.diseno, 1)} ${r.unit}` : "—"}
                          </td>
                          <td className="text-right py-1 px-2 font-bold">
                            {r.medido != null ? `${fmtNum(r.medido, 1)} ${r.unit}` : "—"}
                          </td>
                          <td className="text-right py-1 px-2">
                            {r.diff != null ? (
                              <span style={{ color: r.ok ? "var(--green-600)" : "var(--orange-600)", fontWeight: 600 }}>
                                {r.diff > 0 ? "+" : ""}{fmtNum(r.diff, 1)} {r.unit}{" "}
                                {r.ok ? "✓" : "⚠"}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Aspecto + Probetas */}
                <div className="flex flex-wrap gap-3 mt-2 text-sm">
                  {p.aspecto && (
                    <span>Aspecto: <Tag value={p.aspecto} severity={p.aspecto === "Bueno" ? "success" : p.aspecto === "Regular" ? "warning" : "danger"} /></span>
                  )}
                  {p.probetasMoldeadas != null && (
                    <span>Probetas: <strong>{p.probetasMoldeadas}</strong> {p.tipoProbeta && `(${p.tipoProbeta})`}</span>
                  )}
                  {p.identificacionProbetas && (
                    <span className="text-color-secondary">ID: {p.identificacionProbetas}</span>
                  )}
                </div>

                {/* Observaciones */}
                {p.observaciones && (
                  <div className="mt-2 text-sm surface-100 border-round p-2">
                    <i className="fa-solid fa-comment-dots mr-1 text-color-secondary" />
                    {p.observaciones}
                  </div>
                )}

                {/* Timeline del pastón (mediciones + acciones + remanente).
                    Pasamos `cementoKgM3` y `aguaInicialLts` del resultado del
                    cálculo + la lista de aditivos y fibras del diseño para
                    que en las mediciones siguientes a la base el usuario
                    pueda elegir AGREGAR solo de esos productos (no se
                    pueden incorporar agregados ni cemento, decisión 2026-06-13). */}
                <MedicionesPastonPanel
                  idPastonPrueba={p.idPastonPrueba}
                  pastonFecha={p.fecha || null}
                  pastonVolumenM3={Number(p.volumenM3) || null}
                  pastonAsentamientoMedidoCm={p.asentamientoMedido != null ? Number(p.asentamientoMedido) : null}
                  acMaxPliego={acLimites.acMaxPliego}
                  acMaxDurabilidad={acLimites.acMaxDurabilidad}
                  claseExposicion={acLimites.claseExposicion}
                  cementoKgM3={resultado?.cementoKgM3 != null ? Number(resultado.cementoKgM3) : null}
                  aguaInicialLts={resultado?.aguaLtsM3 != null ? Number(resultado.aguaLtsM3) * (Number(p.volumenM3) || 1) : null}
                  /* Cada aditivo/fibra se identifica con `refIdx` único — la
                     panel matchea por (tipo, refIdx) para evitar el bug donde
                     dos aditivos con la misma label (o sin label) compartían
                     estado y al tipear en uno se llenaban los otros. El
                     `nombre` viene de `contexto.aditivos[idx].label` (la
                     selección real del usuario en el motor) con fallback
                     numerado. */
                  aditivosDiseno={(resultado?.aditivos || [])
                    .map((a, idx) => ({
                      refIdx: idx,
                      nombre: contexto?.aditivos?.[idx]?.label || `Aditivo ${idx + 1}`,
                      dosisDiseno: Number(a.kgM3) || 0,
                      unidad: 'kg/m³',
                    }))
                    .filter((a) => a.dosisDiseno > 0)}
                  fibrasDiseno={[
                    ...(resultado?.fibras?.macrofibra ? [{ refIdx: 0, nombre: resultado.fibras.macrofibra.nombre || 'Macrofibra', dosisDiseno: Number(resultado.fibras.macrofibra.dosisKgM3) || 0, unidad: 'kg/m³' }] : []),
                    ...(resultado?.fibras?.microfibra ? [{ refIdx: 1, nombre: resultado.fibras.microfibra.nombre || 'Microfibra', dosisDiseno: Number(resultado.fibras.microfibra.dosisKgM3) || 0, unidad: 'kg/m³' }] : []),
                  ]}
                  showToast={{ current: { show: (opts) => showToast?.(opts.severity, opts.detail) } }}
                  /* Refrescar el pastón en el header cuando cambian las
                     mediciones: la Medición #1 se espeja en el backend hacia
                     los campos legacy de PastonPrueba (asentamientoMedido,
                     temperaturaHormigon, temperaturaAmbiente, aireMedido,
                     aspecto) y la tabla Diseño/Medido/Diferencia lee de ahí. */
                  onMedicionesChange={async () => {
                    try {
                      const updated = await listarPastones(dosifId);
                      setPastones(updated || []);
                    } catch (err) {
                      console.warn("No se pudo refrescar el pastón tras cambio de medición:", err);
                    }
                  }}
                />

                {/* ── Análisis de eficiencia ── */}
                <AnalisisEficienciaPanel idPastonPrueba={p.idPastonPrueba} />

                {/* ── Veredicto de prueba ── */}
                <div className="mt-3 p-3 surface-ground border-round">
                  <div className="flex align-items-center gap-2 mb-2">
                    <i className="fa-solid fa-gavel text-primary" />
                    <strong className="text-sm">Veredicto de la prueba</strong>
                  </div>
                  {loadedDosif?.estado === "A_PRUEBA" ? (
                    <>
                      {/* Si ya hay veredicto emitido → vista read-only con botón para modificar */}
                      {p.veredicto && !p._editandoVeredicto ? (
                        <div>
                          <div className="flex align-items-center gap-3 flex-wrap">
                            <Tag
                              value={
                                p.veredicto === 'APROBADO' ? 'Prueba aprobada'
                                : p.veredicto === 'APROBADO_PRELIMINAR' ? 'Aprobada preliminar (pend. rotura)'
                                : p.veredicto === 'RECHAZADO' ? 'Prueba rechazada'
                                : 'Observado'
                              }
                              severity={
                                p.veredicto === 'APROBADO' ? 'success'
                                : p.veredicto === 'APROBADO_PRELIMINAR' ? 'info'
                                : p.veredicto === 'RECHAZADO' ? 'danger'
                                : 'warning'
                              }
                            />
                            {p.evaluadoPor && <small className="text-color-secondary">Evaluado por: <strong>{p.evaluadoPor}</strong></small>}
                            {p.veredictoEmitidoPor && <small className="text-color-secondary">Emitido por: <strong>{p.veredictoEmitidoPor}</strong></small>}
                            {p.fechaVeredicto && <small className="text-color-secondary">Fecha: <strong>{new Date(p.fechaVeredicto).toLocaleDateString("es-AR")}</strong></small>}
                            <button
                              type="button"
                              onClick={() => setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, _editandoVeredicto: true } : x))}
                              style={{ background: "transparent", border: "1px solid var(--surface-400)", borderRadius: 4, padding: "2px 10px", fontSize: 11, cursor: "pointer", color: "var(--text-color-secondary)" }}
                            >
                              <i className="fa-solid fa-pen mr-1" />Modificar
                            </button>
                          </div>
                          {p.observacionesGenerales && (
                            <div className="mt-2 text-sm surface-100 border-round p-2">
                              <i className="fa-solid fa-comment-dots mr-1 text-color-secondary" />
                              {p.observacionesGenerales}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Formulario editable (sin veredicto aún, o en modo edición).
                           El emisor del veredicto se auto-popula con el usuario
                           logueado (`user.name + lastname`) — backend valida que
                           haya AL MENOS un firmante. El campo "Evaluado por" es
                           opcional para distinguir cuando el operador del ensayo
                           es distinto del responsable que emite el veredicto. */
                        (() => {
                          const emisorAuto = [user?.name, user?.lastname].filter(Boolean).join(" ").trim() || null;
                          return (
                          <>
                          <div className="grid">
                            <div className="col-12 md:col-4 flex flex-column gap-1">
                              <small>Veredicto</small>
                              <Dropdown
                                value={p.veredicto || null}
                                options={[
                                  { label: 'Sin evaluar', value: null },
                                  // APROBADO_PRELIMINAR (sesión 2026-06-14): el
                                  // pastón cumplió slump/T°/aire/aspecto pero las
                                  // probetas siguen curando — apto provisorio para
                                  // arrancar producción a riesgo. Se promueve a
                                  // APROBADO cuando las probetas confirmen fc.
                                  { label: 'Aprobado preliminar (pendiente rotura)', value: 'APROBADO_PRELIMINAR' },
                                  { label: 'Aprobado', value: 'APROBADO' },
                                  { label: 'Rechazado', value: 'RECHAZADO' },
                                  { label: 'Observado', value: 'OBSERVADO' },
                                ]}
                                onChange={async (e) => {
                                  try {
                                    await axios.put(`${config.backendUrl}/api/dosificaciones-diseno/${loadedDosif.id}/pastones/${p.idPastonPrueba}`, {
                                      veredicto: e.value,
                                      // Auto-firmar con datos del usuario logueado. Si no hay sesión
                                      // resuelta, mandamos lo que haya en p.evaluadoPor (back-end exige
                                      // al menos UNO).
                                      veredictoEmitidoPor: emisorAuto,
                                      evaluadoPor: p.evaluadoPor || null,
                                      fechaVeredicto: e.value ? new Date().toISOString() : null,
                                    }, { headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` } });
                                    setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? {
                                      ...x, veredicto: e.value,
                                      veredictoEmitidoPor: emisorAuto,
                                      fechaVeredicto: e.value ? new Date().toISOString() : null,
                                      _editandoVeredicto: false,
                                    } : x));
                                    showToast?.("success", `Veredicto: ${e.value || 'Sin evaluar'}`);
                                  } catch (err) {
                                    const msg = err?.response?.data?.error || "Error al guardar veredicto";
                                    showToast?.("error", msg);
                                  }
                                }}
                                className="w-full"
                                placeholder="Seleccionar..."
                              />
                              {/* Emisor auto-firmante visible para que el operador
                                  sepa qué nombre quedará registrado. */}
                              <small className="text-color-secondary mt-1" style={{ fontSize: "0.7rem" }}>
                                <i className="fa-solid fa-user-pen mr-1" />
                                {emisorAuto ? `Emite: ${emisorAuto}` : "Sin sesión activa — no se podrá firmar"}
                              </small>
                            </div>
                            <div className="col-12 md:col-4 flex flex-column gap-1">
                              <small>¿Quién realizó el ensayo?</small>
                              {/* Modo "yo mismo": evaluadoPor queda null y el PDF
                                  condensa todo en una sola firma centrada.
                                  Modo "otra persona": se habilita el input. Si
                                  queda vacío, el PDF imprime una línea libre
                                  para firma + sello manual (cliente, supervisor
                                  de obra, etc.). El estado derivado se calcula
                                  desde p.evaluadoPor: si es null → "yo"; si
                                  tiene contenido o el operador eligió explícito
                                  → "otra". */}
                              {(() => {
                                const esOtra = p._evaluadorEsOtra === true
                                  || (p._evaluadorEsOtra === undefined && (p.evaluadoPor || "").trim().length > 0);
                                const guardarEvaluador = async (val) => {
                                  try {
                                    await axios.put(`${config.backendUrl}/api/dosificaciones-diseno/${loadedDosif.id}/pastones/${p.idPastonPrueba}`, {
                                      evaluadoPor: val,
                                    }, { headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` } });
                                  } catch (err) {
                                    const msg = err?.response?.data?.error || "No se pudo guardar 'Evaluado por'";
                                    showToast?.("error", msg);
                                  }
                                };
                                return (
                                  <>
                                    <div className="flex flex-column gap-1">
                                      <label className="flex align-items-center gap-2 cursor-pointer" style={{ fontSize: "0.85rem" }}>
                                        <RadioButton
                                          inputId={`ev-yo-${p.idPastonPrueba}`}
                                          checked={!esOtra}
                                          onChange={() => {
                                            setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, _evaluadorEsOtra: false, evaluadoPor: null } : x));
                                            guardarEvaluador(null);
                                          }}
                                        />
                                        Yo mismo ({emisorAuto || "usuario"}) — firma única
                                      </label>
                                      <label className="flex align-items-center gap-2 cursor-pointer" style={{ fontSize: "0.85rem" }}>
                                        <RadioButton
                                          inputId={`ev-otra-${p.idPastonPrueba}`}
                                          checked={esOtra}
                                          onChange={() => {
                                            setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, _evaluadorEsOtra: true } : x));
                                          }}
                                        />
                                        Otra persona (cliente, supervisión, etc.)
                                      </label>
                                    </div>
                                    {esOtra && (
                                      <InputText
                                        value={p.evaluadoPor || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, evaluadoPor: val } : x));
                                        }}
                                        onBlur={(e) => guardarEvaluador(e.target.value || null)}
                                        className="w-full mt-1" placeholder="Nombre, o vacío para firma manual"
                                      />
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                            <div className="col-12 md:col-4 flex flex-column gap-1">
                              <small>Observaciones de la prueba</small>
                              <InputTextarea
                                value={p.observacionesGenerales || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, observacionesGenerales: val } : x));
                                }}
                                onBlur={async (e) => {
                                  try {
                                    await axios.put(`${config.backendUrl}/api/dosificaciones-diseno/${loadedDosif.id}/pastones/${p.idPastonPrueba}`, {
                                      observacionesGenerales: e.target.value || null,
                                    }, { headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` } });
                                  } catch { showToast?.("error", "No se pudo guardar 'Observaciones'"); }
                                }}
                                rows={2} autoResize className="w-full" placeholder="Observaciones técnicas..."
                              />
                            </div>
                          </div>
                          {/* Botones de guardar / cancelar. Aunque cada campo
                              auto-guarda en blur, agregamos un botón explícito
                              "Guardar veredicto" para cerrar el ciclo y dar
                              feedback claro. Hace un PUT con el estado actual
                              y sale de edición. */}
                          <div className="flex justify-content-end gap-2 mt-2">
                            {p._editandoVeredicto && (
                              <Button
                                label="Cancelar edición"
                                icon="pi pi-times"
                                size="small"
                                severity="secondary"
                                outlined
                                onClick={() => setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? { ...x, _editandoVeredicto: false } : x))}
                              />
                            )}
                            <Button
                              label="Guardar veredicto"
                              icon="pi pi-check"
                              size="small"
                              disabled={!p.veredicto || !emisorAuto || veredictoSavingId === p.idPastonPrueba}
                              loading={veredictoSavingId === p.idPastonPrueba}
                              tooltip={!p.veredicto ? "Seleccioná un veredicto primero" : !emisorAuto ? "Sin sesión activa — no se puede firmar" : "Guardar todos los cambios"}
                              tooltipOptions={{ position: 'top' }}
                              onClick={async () => {
                                if (veredictoSavingRef.current) return;
                                veredictoSavingRef.current = true;
                                setVeredictoSavingId(p.idPastonPrueba);
                                try {
                                  await axios.put(`${config.backendUrl}/api/dosificaciones-diseno/${loadedDosif.id}/pastones/${p.idPastonPrueba}`, {
                                    veredicto: p.veredicto,
                                    veredictoEmitidoPor: emisorAuto,
                                    evaluadoPor: p.evaluadoPor || null,
                                    observacionesGenerales: p.observacionesGenerales || null,
                                    fechaVeredicto: p.fechaVeredicto || new Date().toISOString(),
                                  }, { headers: { ...config.headers, Authorization: `Bearer ${localStorage.getItem("token")}` } });
                                  setPastones(prev => prev.map(x => x.idPastonPrueba === p.idPastonPrueba ? {
                                    ...x,
                                    veredictoEmitidoPor: emisorAuto,
                                    fechaVeredicto: x.fechaVeredicto || new Date().toISOString(),
                                    _editandoVeredicto: false,
                                  } : x));
                                  showToast?.("success", "Veredicto guardado");
                                } catch (err) {
                                  const msg = err?.response?.data?.error || "Error al guardar veredicto";
                                  showToast?.("error", msg);
                                } finally {
                                  veredictoSavingRef.current = false;
                                  setVeredictoSavingId(null);
                                }
                              }}
                            />
                          </div>
                          </>
                          );
                        })()
                      )}
                    </>
                  ) : (
                    <div>
                      <div className="flex align-items-center gap-3 flex-wrap">
                        {p.veredicto ? (
                          <Tag
                            value={
                              p.veredicto === 'APROBADO' ? 'Prueba aprobada'
                              : p.veredicto === 'APROBADO_PRELIMINAR' ? 'Aprobada preliminar (pend. rotura)'
                              : p.veredicto === 'RECHAZADO' ? 'Prueba rechazada'
                              : 'Observado'
                            }
                            severity={
                              p.veredicto === 'APROBADO' ? 'success'
                              : p.veredicto === 'APROBADO_PRELIMINAR' ? 'info'
                              : p.veredicto === 'RECHAZADO' ? 'danger'
                              : 'warning'
                            }
                          />
                        ) : (
                          <span className="text-color-secondary text-sm">Sin veredicto emitido</span>
                        )}
                        {p.evaluadoPor && <small className="text-color-secondary">Evaluado por: <strong>{p.evaluadoPor}</strong></small>}
                        {p.veredictoEmitidoPor && <small className="text-color-secondary">Emitido por: <strong>{p.veredictoEmitidoPor}</strong></small>}
                        {p.fechaVeredicto && <small className="text-color-secondary">Fecha: <strong>{new Date(p.fechaVeredicto).toLocaleDateString("es-AR")}</strong></small>}
                      </div>
                      {p.observacionesGenerales && (
                        <div className="mt-2 text-sm surface-100 border-round p-2">
                          <i className="fa-solid fa-comment-dots mr-1 text-color-secondary" />
                          {p.observacionesGenerales}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Correcciones post-prueba */}
                {loadedDosif?.estado === "A_PRUEBA" && (
                  <CorreccionesPanel
                    paston={p}
                    loadedDosif={loadedDosif}
                    resultado={resultado}
                    dosifId={dosifId}
                    showToast={showToast}
                    onCorrectionApplied={loadCorrecciones}
                    correcciones={correcciones}
                  />
                )}

                {/* Show correction history even when not editable */}
                {loadedDosif?.estado !== "A_PRUEBA" && (correcciones || []).filter(c => c.pastonId === p.idPastonPrueba).length > 0 && (
                  <div className="mt-2">
                    <small className="font-bold block mb-1">
                      <i className="fa-solid fa-history mr-1" />
                      Correcciones aplicadas ({correcciones.filter(c => c.pastonId === p.idPastonPrueba).length})
                    </small>
                    <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
                          <th className="text-left py-1 px-2">Campo</th>
                          <th className="text-right py-1 px-2">Anterior</th>
                          <th className="text-right py-1 px-2">Nuevo</th>
                          <th className="text-left py-1 px-2">Motivo</th>
                          <th className="text-right py-1 px-2">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {correcciones.filter(c => c.pastonId === p.idPastonPrueba).map((c) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                            <td className="py-1 px-2">{c.campoLabel}</td>
                            <td className="text-right py-1 px-2 text-color-secondary">{c.valorAnterior} {c.unidad || ""}</td>
                            <td className="text-right py-1 px-2 font-bold text-primary">{c.valorNuevo} {c.unidad || ""}</td>
                            <td className="py-1 px-2 text-color-secondary">{c.motivo}</td>
                            <td className="text-right py-1 px-2 text-color-secondary">{c.createdAt ? new Date(c.createdAt).toLocaleDateString("es-AR") : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── Dialog: editar datos del pastón ── */}
      <Dialog
        header="Editar datos del pastón"
        visible={!!editPaston}
        style={{ width: "90vw", maxWidth: "780px" }}
        modal
        onHide={() => !editSaving && setEditPaston(null)}
      >
        {editPaston && (
          <div className="grid formgrid">
            <div className="field col-12 sm:col-6 md:col-4">
              <label className="text-xs font-bold block mb-1">Fecha</label>
              <Calendar
                value={editPaston.fecha ? new Date(editPaston.fecha + "T00:00:00") : null}
                onChange={(e) => setEditField("fecha", e.value ? e.value.toISOString().slice(0, 10) : null)}
                dateFormat="dd/mm/yy" className="w-full"
              />
            </div>
            <div className="field col-12 sm:col-6 md:col-4">
              <label className="text-xs font-bold block mb-1">Hora</label>
              <InputText value={editPaston.hora || ""} onChange={(e) => setEditField("hora", e.target.value)} placeholder="HH:MM" className="w-full" />
            </div>
            <div className="field col-12 md:col-4">
              <label className="text-xs font-bold block mb-1">Operador</label>
              <InputText value={editPaston.operador || ""} onChange={(e) => setEditField("operador", e.target.value)} className="w-full" />
            </div>

            {/* Asentamiento, T° hormigón, T° ambiente, aire y aspecto ya no se
                editan acá (sesión 2026-06-13). Esos datos viven en
                MedicionPaston #1 (base) y se sincronizan automáticamente a los
                campos legacy de PastonPrueba para PDFs/dashboards. Editarlos
                acá generaba "doble primera medición" reportada por el usuario.
                Para corregir esos valores, editar Medición #1 en el Timeline.
                PUV queda porque es un único dato del pastón completo. */}
            <div className="field col-12 sm:col-6 md:col-4">
              <label className="text-xs font-bold block mb-1">PUV (kg/m³)</label>
              <InputNumber value={editPaston.puvMedido} onValueChange={(e) => setEditField("puvMedido", e.value)} onKeyDown={handleDecimalKey} min={0} max={3500} maxFractionDigits={2} className="w-full" inputClassName="w-full" />
            </div>
            <div className="field col-12 md:col-8">
              <Message
                severity="info"
                className="w-full"
                text="Los valores de slump, temperaturas, aire y aspecto se editan dentro del Timeline (Medición #1 — base). Acá quedan solo los datos administrativos y de pastón completo."
              />
            </div>
            <div className="field col-12">
              <label className="text-xs font-bold block mb-1">Observaciones</label>
              <InputTextarea rows={2} value={editPaston.observaciones || ""} onChange={(e) => setEditField("observaciones", e.target.value)} className="w-full" />
            </div>

            {/* Probetas moldeadas: se autogeneran al guardar el pastón, pero
                acá se pueden CORREGIR (cantidad / tipo / edad de rotura) si el
                operador se equivocó. Las ya ensayadas quedan bloqueadas
                (sesión 2026-05-18). */}
            {editMuestras.length > 0 && (
              <div className="field col-12">
                <label className="text-xs font-bold block mb-2">
                  <i className="fa-solid fa-vials mr-1" />Probetas moldeadas
                </label>
                {editMuestras.map((m) => (
                  <div key={m.idMuestraPaston} className="mb-3">
                    <div className="text-xs font-bold mb-1" style={{ color: "var(--text-color-secondary)" }}>
                      {m.origen === "OBRA" ? "Confeccionadas en obra" : "Confeccionadas en planta"}
                      {m.loteNumero ? ` · Lote ${m.loteNumero}` : ""}
                    </div>
                    <ProbetasPastonEditor
                      value={m.probetas}
                      tipos={tiposProbeta}
                      edadesSugeridas={edadesRotura.length ? edadesRotura : [7, 28]}
                      disabled={editSaving}
                      onChange={(lista) => setProbetasDeMuestra(m.idMuestraPaston, lista)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* ── Retenidos por componente (solo agua y aditivos) ── */}
            {Array.isArray(editPaston.componentes) && editPaston.componentes.some(c => c.tipo === "AGUA" || c.tipo === "ADITIVO") && (
              <div className="field col-12 mt-2">
                <label className="text-xs font-bold block mb-1">
                  <i className="fa-solid fa-hand-holding-droplet mr-1" />Material retenido (no incorporado al mix)
                </label>
                <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--surface-300)" }}>
                      <th className="text-left py-1 px-2" style={{ width: "45%" }}>Componente</th>
                      <th className="text-right py-1 px-2" style={{ width: "25%" }}>Dosificado</th>
                      <th className="text-right py-1 px-2" style={{ width: "30%" }}>Retenido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editPaston.componentes.map((c, i) => {
                      if (c.tipo !== "AGUA" && c.tipo !== "ADITIVO") return null;
                      const dosif = Number(c.cantidadScaled || 0);
                      const ret = Number(c.retenido || 0);
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                          <td className="py-1 px-2">{c.componente}</td>
                          <td className="text-right py-1 px-2 text-color-secondary">
                            {fmtNum(dosif, dosif < 100 ? 1 : 0)} {c.unidad}
                          </td>
                          <td className="text-right py-1 px-2">
                            <InputNumber
                              value={ret || null}
                              onValueChange={(e) => {
                                const newComps = [...editPaston.componentes];
                                const nuevoRet = Number(e.value || 0);
                                newComps[i] = {
                                  ...newComps[i],
                                  retenido: nuevoRet > 0 ? nuevoRet : null,
                                  cargado: Math.max(dosif - nuevoRet, 0),
                                };
                                setEditField("componentes", newComps);
                              }}
                              min={0} max={dosif}
                              minFractionDigits={dosif < 100 ? 1 : 0}
                              maxFractionDigits={dosif < 100 ? 2 : 0}
                              suffix={` ${c.unidad}`}
                              inputClassName="w-full p-inputtext-sm"
                              placeholder="0"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="text-xs text-color-secondary mt-1" style={{ fontStyle: "italic" }}>
                  Indica cuánta agua o aditivo se dejó en reserva al cargar el pastón; el cargado real = dosificado − retenido.
                </div>
              </div>
            )}

            <div className="col-12 flex justify-content-end gap-2 mt-2">
              <Button label="Cancelar" className="p-button-text" onClick={() => setEditPaston(null)} disabled={editSaving} />
              <Button label="Guardar cambios" icon="pi pi-save" onClick={handleGuardarEdicion} loading={editSaving} disabled={editSaving} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default PastonPruebaSection;
