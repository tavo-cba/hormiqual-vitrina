import React, { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import {
  listarMedicionesPaston,
  crearMedicionPaston,
  actualizarMedicionPaston,
  eliminarMedicionPaston,
} from "../../../services/dosificacionDisenoService";
import { calcularAcumulados, clasificarEvento, validarEvento } from "../../../lib/dosificacion/pastonTimelineEngine";

/**
 * Panel de mediciones seriadas dentro de un pastón (Fase 2B).
 *
 * Un pastón real es una serie temporal de muestras: planta → transporte →
 * obra, con slump y temperatura en cada momento. Este panel permite cargar
 * esas muestras ordenadas y ver el slump loss.
 *
 * Props:
 *   - idPastonPrueba: FK al pastón.
 *   - showToast: helper PrimeReact.
 */

const ETAPA_OPTS = [
  { label: "Planta", value: "PLANTA" },
  { label: "Transporte", value: "TRANSPORTE" },
  { label: "Obra", value: "OBRA" },
];

const etapaSeverity = (e) =>
  e === "PLANTA" ? "warning" : e === "TRANSPORTE" ? "info" : "success";

const emptyForm = () => ({
  id: null,
  etapa: "PLANTA",
  etiqueta: "",
  fechaHora: new Date(),
  asentamientoMm: null,
  temperaturaHormigonC: null,
  temperaturaAmbienteC: null,
  aireMedidoPct: null,
  aspecto: null,
  aguaAgregadaLts: null,
  aditivosAgregadosJson: [],
  aguaRetenidaLts: null,
  // Solo se popula en la Medición #1 (base). Lista de aditivos y fibras
  // retenidos para usar en mediciones siguientes.
  aditivosRetenidosJson: [],
  fibrasRetenidasJson: [],
  volumenRemanenteM3: null,
  observacion: "",
});


const ASPECTO_OPTS = [
  { label: "Bueno", value: "Bueno" },
  { label: "Regular", value: "Regular" },
  { label: "Malo", value: "Malo" },
];

function fmtNum(v, d = 1) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(d).replace(".", ",");
}
function fmtHora(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export default function MedicionesPastonPanel({
  idPastonPrueba,
  showToast,
  pastonFecha = null,
  pastonVolumenM3 = null,
  pastonAsentamientoMedidoCm = null,
  // B1 — límites de a/c para alertar (no bloquear) si la a/c final del
  // timeline los supera. acMaxPliego = contractual; acMaxDurabilidad =
  // Tabla 2.5 CIRSOC 200:2024 según clase de exposición.
  acMaxPliego = null,
  acMaxDurabilidad = null,
  claseExposicion = null,
  // Base del pastón para calcular acumulados y a/c efectivo en el timeline.
  // Vienen del resultado del cálculo de la dosificación (o del propio pastón).
  cementoKgM3 = null,
  aguaInicialLts = null,
  // Aditivos y fibras del diseño — el usuario solo puede AGREGAR estos en
  // las mediciones siguientes a la primera. Cada item: { nombre, dosisDiseno, unidad }.
  aditivosDiseno = [],
  fibrasDiseno = [],
  // Callback que el parent (PastonPruebaSection) usa para refrescar el pastón
  // — el backend espeja Medición #1 → campos legacy de PastonPrueba para que
  // PDFs y tabla de resumen muestren los datos del timeline.
  onMedicionesChange = null,
}) {
  // Base de fecha (YYYY-MM-DD) desde el pastón, para fijar fecha y pedir sólo hora.
  const baseFecha = useMemo(() => {
    if (!pastonFecha) return null;
    const d = typeof pastonFecha === "string" ? pastonFecha.slice(0, 10) : new Date(pastonFecha).toISOString().slice(0, 10);
    return d;
  }, [pastonFecha]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = no editing, 'new' = nueva fila, number = edit
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const refresh = async () => {
    if (!idPastonPrueba) { setRows([]); return; }
    try {
      setLoading(true);
      const list = await listarMedicionesPaston(idPastonPrueba);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      showToast?.current?.show?.({
        severity: "error",
        summary: "Mediciones",
        detail: err?.response?.data?.error || "Error al cargar mediciones",
      });
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [idPastonPrueba]);

  // Ordenado + enriquecido con cálculos del timeline (tipo, acumulados, a/c
  // efectivo, remanente vigente). El engine es puro y vive en
  // `lib/dosificacion/pastonTimelineEngine` (mirror del backend).
  const sortedRows = useMemo(() => {
    return calcularAcumulados(rows, {
      cementoKgM3: cementoKgM3 || 0,
      aguaInicialLts: aguaInicialLts || 0,
      volumenTotalM3: pastonVolumenM3 || 1,
    });
  }, [rows, cementoKgM3, aguaInicialLts, pastonVolumenM3]);

  const openNew = () => {
    const base = emptyForm();
    // Hora default: la hora actual fijada sobre la fecha del pastón. El usuario sólo edita la hora.
    if (baseFecha) {
      const now = new Date();
      base.fechaHora = new Date(`${baseFecha}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00`);
    }
    // Default de volumen remanente: última medición que lo haya declarado, si no, volumen del pastón.
    const ultConDato = [...sortedRows].reverse().find(r => r.volumenRemanenteM3 != null);
    base.volumenRemanenteM3 = ultConDato?.volumenRemanenteM3 != null
      ? Number(ultConDato.volumenRemanenteM3)
      : (pastonVolumenM3 != null ? Number(pastonVolumenM3) : null);
    setForm(base);
    setEditingId("new");
  };
  const openEdit = (r) => {
    setForm({
      id: r.id,
      etapa: r.etapa || "PLANTA",
      etiqueta: r.etiqueta || "",
      fechaHora: r.fechaHora ? new Date(r.fechaHora) : new Date(),
      asentamientoMm: r.asentamientoMm != null ? Number(r.asentamientoMm) : null,
      temperaturaHormigonC: r.temperaturaHormigonC != null ? Number(r.temperaturaHormigonC) : null,
      temperaturaAmbienteC: r.temperaturaAmbienteC != null ? Number(r.temperaturaAmbienteC) : null,
      probetasMoldeadas: r.probetasMoldeadas != null ? Number(r.probetasMoldeadas) : null,
      aspecto: r.aspecto || null,
      aguaAgregadaLts: r.aguaAgregadaLts != null ? Number(r.aguaAgregadaLts) : null,
      aditivosAgregadosJson: (() => {
        let arr = r.aditivosAgregadosJson;
        if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
        if (Array.isArray(arr) && arr.length > 0) return arr;
        // Fallback legacy (campos individuales)
        if (r.aditivoAgregadoNombre || r.aditivoAgregadoCantidad != null) {
          return [{
            nombre: r.aditivoAgregadoNombre || "",
            cantidad: r.aditivoAgregadoCantidad != null ? Number(r.aditivoAgregadoCantidad) : null,
            unidad: r.aditivoAgregadoUnidad || "cc",
            esOtro: true,
          }];
        }
        return [];
      })(),
      volumenRemanenteM3: r.volumenRemanenteM3 != null ? Number(r.volumenRemanenteM3) : null,
      aireMedidoPct: r.aireMedidoPct != null ? Number(r.aireMedidoPct) : null,
      // Retenidos (solo se cargan si vienen del backend; en mediciones
      // siguientes a la #1 estos quedan vacíos por diseño).
      aguaRetenidaLts: r.aguaRetenidaLts != null ? Number(r.aguaRetenidaLts) : null,
      aditivosRetenidosJson: (() => {
        let arr = r.aditivosRetenidosJson;
        if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
        if (Array.isArray(arr)) return arr;
        // Fallback legacy: un solo aditivo retenido en campos individuales.
        if (r.aditivoRetenidoNombre && r.aditivoRetenidoCantidad != null) {
          return [{ nombre: r.aditivoRetenidoNombre, cantidad: Number(r.aditivoRetenidoCantidad), unidad: r.aditivoRetenidoUnidad || 'kg' }];
        }
        return [];
      })(),
      fibrasRetenidasJson: (() => {
        let arr = r.fibrasRetenidasJson;
        if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
        return Array.isArray(arr) ? arr : [];
      })(),
      observacion: r.observacion || "",
    });
    setEditingId(r.id);
  };
  const cancelEdit = () => { setEditingId(null); setForm(emptyForm()); };

  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  // Sesión 2026-06-13 — la validación se relajó: el slump ya no es obligatorio,
  // tampoco las temperaturas, aire ni aspecto. Lo único realmente exigido es
  // identificar la lectura (etapa + etiqueta + hora). El volumen remanente
  // pasa a ser obligatorio sólo si la medición incorpora material (agua,
  // aditivo o fibra), porque sin remanente no se puede calcular a/c efectivo
  // ni acumular correctamente.
  const tieneAgregadoEnForm = useMemo(() => {
    if ((Number(form.aguaAgregadaLts) || 0) > 0) return true;
    if (Array.isArray(form.aditivosAgregadosJson) && form.aditivosAgregadosJson.some((x) => Number(x.cantidad) > 0)) return true;
    return false;
  }, [form.aguaAgregadaLts, form.aditivosAgregadosJson]);

  const validacionForm = useMemo(() => {
    const errors = [];
    if (!form.etapa) errors.push("Falta indicar la etapa.");
    if (!(form.etiqueta || "").trim()) errors.push("Falta la etiqueta de la lectura.");
    if (!form.fechaHora) errors.push("Falta la hora de la lectura.");
    if (tieneAgregadoEnForm && form.volumenRemanenteM3 == null) {
      errors.push("Si se agrega agua/aditivo/fibra, indicá el volumen remanente del camión en ese momento.");
    }
    return errors;
  }, [form.etapa, form.etiqueta, form.fechaHora, form.volumenRemanenteM3, tieneAgregadoEnForm]);

  const canSave = validacionForm.length === 0;

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!canSave) {
      showToast?.current?.show?.({ severity: "warn", summary: "Mediciones", detail: validacionForm.join(" ") });
      return;
    }
    // Forzar la fecha del pastón (sólo hora es editable). La hora puede ser un Date (con fecha de "hoy" puesta por el Calendar timeOnly)
    // o cualquier otra cosa; nos quedamos con horas + minutos y los pegamos a baseFecha.
    let fechaHoraFinal = form.fechaHora;
    if (baseFecha) {
      let hh = 0, mm = 0;
      if (fechaHoraFinal instanceof Date) {
        hh = fechaHoraFinal.getHours();
        mm = fechaHoraFinal.getMinutes();
      } else if (typeof fechaHoraFinal === "string" && fechaHoraFinal) {
        const d = new Date(fechaHoraFinal);
        if (!isNaN(d.getTime())) { hh = d.getHours(); mm = d.getMinutes(); }
      }
      // Fecha local a ISO sin perder día por zona horaria
      fechaHoraFinal = new Date(`${baseFecha}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
    }

    // Validación timeline pre-submit: orden cronológico inter-etapa y remanente
    // monotónicamente decreciente. El backend valida también (defensa en
    // profundidad); acá damos feedback inmediato al usuario.
    if (editingId === "new" || editingId !== null) {
      const eventosOtros = editingId === "new"
        ? sortedRows
        : sortedRows.filter((r) => r.id !== editingId);
      const errTimeline = validarEvento(eventosOtros, {
        etapa: form.etapa,
        fechaHora: fechaHoraFinal instanceof Date ? fechaHoraFinal.toISOString() : fechaHoraFinal,
        volumenRemanenteM3: form.volumenRemanenteM3,
      });
      if (errTimeline) {
        showToast?.current?.show?.({ severity: "warn", summary: "Timeline", detail: errTimeline.mensaje });
        return;
      }
    }

    // Se permiten horarios en cualquier orden; la lista se reordena cronológicamente.
    try {
      savingRef.current = true;
      setSaving(true);
      const payload = {
        ...form,
        fechaHora: fechaHoraFinal instanceof Date ? fechaHoraFinal.toISOString() : fechaHoraFinal,
      };
      if (editingId === "new") {
        await crearMedicionPaston(idPastonPrueba, payload);
      } else {
        await actualizarMedicionPaston(editingId, payload);
      }
      showToast?.current?.show?.({ severity: "success", summary: "Mediciones", detail: "Guardado" });
      cancelEdit();
      await refresh();
      onMedicionesChange?.();
    } catch (err) {
      showToast?.current?.show?.({
        severity: "error",
        summary: "Mediciones",
        detail: err?.response?.data?.error || "Error al guardar",
      });
    } finally { savingRef.current = false; setSaving(false); }
  };

  const handleDelete = async (r) => {
    if (!window.confirm(`¿Eliminar medición #${r.ordenSecuencia}${r.etiqueta ? ` (${r.etiqueta})` : ""}?`)) return;
    if (deletingRef.current) return;
    try {
      deletingRef.current = true;
      await eliminarMedicionPaston(r.id);
      showToast?.current?.show?.({ severity: "success", summary: "Mediciones", detail: "Eliminada" });
      await refresh();
      onMedicionesChange?.();
    } catch (err) {
      showToast?.current?.show?.({
        severity: "error",
        summary: "Mediciones",
        detail: err?.response?.data?.error || "Error al eliminar",
      });
    } finally {
      deletingRef.current = false;
    }
  };

  // Slump loss mini-chart: SVG simple.
  const chart = useMemo(() => {
    const pts = sortedRows
      .filter(r => r.asentamientoMm != null && r.fechaHora)
      .map(r => ({
        t: new Date(r.fechaHora).getTime(),
        slump: Number(r.asentamientoMm),
        etapa: r.etapa,
      }));
    if (pts.length < 2) return null;
    const W = 360, H = 95, PADL = 22, PADR = 10, PADT = 8, PADB = 30;
    const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
    const sMin = 0;
    const sMax = Math.max(...pts.map(p => p.slump), 220);
    const sx = (t) => PADL + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - PADL - PADR);
    const sy = (s) => H - PADB - ((s - sMin) / (sMax - sMin)) * (H - PADT - PADB);
    const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.slump).toFixed(1)}`).join(" ");
    return { W, H, PADL, PADB, PADT, pts, pathD, sx, sy, sMax };
  }, [sortedRows]);

  // Cómputos finales del timeline (sesión 2026-06-13): sumar todo lo
  // agregado vs lo retenido y mostrar el resumen para que el tecnólogo cierre
  // el balance al final del pastón.
  const computos = useMemo(() => {
    if (sortedRows.length === 0) return null;
    const baseRow = sortedRows[0]; // primera medición = retenidos declarados
    const retenido = {
      aguaLts: Number(baseRow.aguaRetenidaLts) || 0,
      aditivos: (() => {
        // Soporte legacy: campos individuales + JSON
        const arr = [];
        if (baseRow.aditivoRetenidoNombre && Number(baseRow.aditivoRetenidoCantidad) > 0) {
          arr.push({
            nombre: baseRow.aditivoRetenidoNombre,
            cantidad: Number(baseRow.aditivoRetenidoCantidad),
            unidad: baseRow.aditivoRetenidoUnidad || 'kg',
          });
        }
        const legacy = baseRow.aditivosRetenidosJson;
        if (Array.isArray(legacy)) arr.push(...legacy);
        return arr;
      })(),
    };

    // Acumulado de agregados a lo largo del timeline (incluye base si tiene).
    let aguaAgregadaLts = 0;
    const aditivosAgregadosByName = {};
    for (const r of sortedRows) {
      aguaAgregadaLts += Number(r.aguaAgregadaLts) || 0;
      if (Array.isArray(r.aditivosAgregadosJson)) {
        for (const ad of r.aditivosAgregadosJson) {
          const k = (ad.nombre || '').trim().toLowerCase() || 'sin-nombre';
          if (!aditivosAgregadosByName[k]) {
            aditivosAgregadosByName[k] = { nombre: ad.nombre, cantidad: 0, unidad: ad.unidad || 'kg' };
          }
          aditivosAgregadosByName[k].cantidad += Number(ad.cantidad) || 0;
        }
      } else if (r.aditivoAgregadoNombre && Number(r.aditivoAgregadoCantidad) > 0) {
        const k = r.aditivoAgregadoNombre.trim().toLowerCase();
        if (!aditivosAgregadosByName[k]) {
          aditivosAgregadosByName[k] = { nombre: r.aditivoAgregadoNombre, cantidad: 0, unidad: r.aditivoAgregadoUnidad || 'kg' };
        }
        aditivosAgregadosByName[k].cantidad += Number(r.aditivoAgregadoCantidad) || 0;
      }
    }
    const aditivosAgregados = Object.values(aditivosAgregadosByName);

    // a/c final = el del último evento del timeline.
    const ultimo = sortedRows[sortedRows.length - 1];
    const acFinal = ultimo?._calc?.acEfectivo ?? null;
    const remanenteFinal = ultimo?._calc?.remanenteVigenteM3 ?? null;
    const cementoRestante = ultimo?._calc?.cementoRestanteKg ?? null;

    // Excedente de agua: si se agregó más de lo retenido + 0.5L, alerta.
    const aguaExcede = aguaAgregadaLts > retenido.aguaLts + 0.5;

    // Excedentes de aditivo: por nombre, comparar contra el retenido del mismo nombre.
    const excedentesAditivos = [];
    for (const ag of aditivosAgregados) {
      const ret = retenido.aditivos.find((r) => (r.nombre || '').trim().toLowerCase() === (ag.nombre || '').trim().toLowerCase());
      const cantRet = ret ? Number(ret.cantidad) || 0 : 0;
      if (ag.cantidad > cantRet + 0.001) {
        excedentesAditivos.push({ nombre: ag.nombre, agregado: ag.cantidad, retenido: cantRet, unidad: ag.unidad });
      }
    }

    // % de aditivos sobre cemento restante final.
    const pctAditivos = cementoRestante > 0
      ? Object.values(aditivosAgregadosByName).reduce((s, a) => {
          // Normalizar a kg
          const cant = Number(a.cantidad) || 0;
          const u = String(a.unidad || 'kg').toLowerCase();
          const kg = (u === 'g' || u === 'cc' || u === 'ml') ? cant / 1000 : cant;
          return s + kg;
        }, 0) / cementoRestante * 100
      : null;

    return { retenido, aguaAgregadaLts, aditivosAgregados, acFinal, remanenteFinal, cementoRestante, aguaExcede, excedentesAditivos, pctAditivos };
  }, [sortedRows]);

  if (!idPastonPrueba) return null;

  return (
    <div className="mt-3">
      <div className="flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
        <div>
          <strong className="text-sm">
            <i className="fa-solid fa-timeline mr-2 text-primary" />
            Timeline del pastón
          </strong>
          <div className="text-xs text-color-secondary mt-1">
            Acá se registran las mediciones de slump/aire/temperatura y los agregados de agua/aditivos en cada etapa (planta, transporte, obra). El sistema calcula a/c efectivo y acumulados.
          </div>
        </div>
        {editingId === null && (
          <Button
            label="Agregar evento"
            icon="fa-solid fa-plus"
            size="small"
            onClick={openNew}
          />
        )}
      </div>

      {loading && (
        <div className="text-xs text-color-secondary py-2">
          <i className="fa-solid fa-spinner fa-spin mr-1" />Cargando…
        </div>
      )}

      {!loading && sortedRows.length === 0 && editingId === null && (
        <div className="surface-100 border-round p-4 my-2" style={{ borderLeft: "4px solid var(--primary-color)" }}>
          <div className="flex align-items-center gap-3 flex-wrap">
            <i className="fa-solid fa-flask-vial text-primary" style={{ fontSize: "1.75rem" }} />
            <div className="flex-1" style={{ minWidth: 240 }}>
              <div className="font-bold text-sm mb-1">Cargá la Medición #1 (base) del pastón</div>
              <div className="text-xs text-color-secondary">
                En la medición base se registran el slump, temperaturas, aire y aspecto iniciales del hormigón fresco, además de los <strong>materiales retenidos</strong> (agua/aditivos/fibras dosificados pero no incorporados al mix). Las mediciones siguientes (#2, #3…) sólo agregan materiales.
              </div>
            </div>
            <Button
              label="Cargar primera medición"
              icon="fa-solid fa-plus"
              onClick={openNew}
              className="p-button-sm"
            />
          </div>
        </div>
      )}

      {/* P0.8 — Validación cruzada: el campo asentamientoMedido del pastón
          debería corresponder a alguna de las mediciones de la serie. Si no
          está dentro del rango, advertir al usuario que hay desconexión. */}
      {(() => {
        if (pastonAsentamientoMedidoCm == null) return null;
        const slumpsCm = sortedRows
          .filter(r => r.asentamientoMm != null)
          .map(r => Number(r.asentamientoMm) / 10);
        if (slumpsCm.length === 0) return null;
        const minS = Math.min(...slumpsCm);
        const maxS = Math.max(...slumpsCm);
        const valor = Number(pastonAsentamientoMedidoCm);
        // Tolerancia ±1 cm sobre el rango
        const dentroRango = valor >= minS - 1 && valor <= maxS + 1;
        if (dentroRango) return null;
        return (
          <div className="surface-100 border-round p-2 mb-2 text-xs" style={{ borderLeft: "3px solid #f59e0b" }}>
            <i className="fa-solid fa-triangle-exclamation mr-1" style={{ color: "var(--orange-500)" }} />
            <strong>Inconsistencia en el asentamiento medido:</strong> el valor cargado en el protocolo del pastón
            es <strong>{fmtNum(valor, 1)} cm</strong>, pero la serie de mediciones tiene valores entre{" "}
            <strong>{fmtNum(minS, 1)}</strong> y <strong>{fmtNum(maxS, 1)} cm</strong>.
            Verificá si el valor del protocolo corresponde a alguna medición de la serie o actualizá el dato.
          </div>
        );
      })()}

      {sortedRows.length > 0 && (
        <div className="mb-2" style={{ overflowX: "auto" }}>
          <table className="text-xs" style={{ borderCollapse: "collapse", width: "100%", minWidth: 1100, tableLayout: "fixed" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--surface-300)", color: "var(--text-color-secondary)" }}>
                <th className="text-left py-1 px-2" style={{ width: "11%" }}>Medición</th>
                <th className="text-left py-1 px-2" style={{ width: "8%" }}>Etapa</th>
                <th className="text-left py-1 px-2" style={{ width: "8%" }}>Tipo</th>
                <th className="text-left py-1 px-2" style={{ width: "6%" }}>Hora</th>
                <th className="text-right py-1 px-2" style={{ width: "7%" }}>Slump</th>
                <th className="text-right py-1 px-2" style={{ width: "6%" }}>T° H°</th>
                <th className="text-right py-1 px-2" style={{ width: "6%" }}>Aire</th>
                <th className="text-right py-1 px-2" style={{ width: "8%" }} title="Agua acumulada durante el timeline">Agua acum.</th>
                <th className="text-right py-1 px-2" style={{ width: "8%" }} title="Volumen remanente en el camión (m³)">Reman.</th>
                <th className="text-right py-1 px-2" style={{ width: "7%" }} title="a/c efectivo en este punto del timeline">A/C ef.</th>
                <th className="text-left py-1 px-2" style={{ width: "8%" }}>Aspecto</th>
                <th className="text-right py-1 px-2" style={{ width: "13%" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, idx) => {
                const c = r._calc || {};
                const tipoSeverity = c.tipo === 'ACCION' ? 'warning' : c.tipo === 'MIXTO' ? 'success' : c.tipo === 'REMANENTE' ? 'info' : 'secondary';
                const tipoLabel = c.tipo === 'MEDICION' ? 'Medición' : c.tipo === 'ACCION' ? 'Acción' : c.tipo === 'MIXTO' ? 'Mixto' : c.tipo === 'REMANENTE' ? 'Remanente' : 'Obs.';
                // Etiqueta automática: la primera medición es la "base" (donde
                // se cargan las temperaturas iniciales, aire, asentamiento base
                // y los materiales retenidos). Las siguientes son "Medición #N"
                // donde se incorporan agregados.
                const esBase = idx === 0;
                return (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                  <td className="py-1 px-2">
                    <strong>Medición #{idx + 1}</strong>
                    {esBase && <span className="text-color-secondary ml-1" style={{ fontSize: '0.7rem' }}>(base)</span>}
                    {r.etiqueta && <div className="text-color-secondary" style={{ fontSize: '0.7rem' }}>{r.etiqueta}</div>}
                  </td>
                  <td className="py-1 px-2">
                    <Tag value={r.etapa} severity={etapaSeverity(r.etapa)} />
                  </td>
                  <td className="py-1 px-2">
                    <Tag value={tipoLabel} severity={tipoSeverity} style={{ fontSize: '0.65rem' }} />
                  </td>
                  <td className="py-1 px-2">{fmtHora(r.fechaHora)}</td>
                  <td className="text-right py-1 px-2 font-bold">
                    {r.asentamientoMm != null ? `${fmtNum(Number(r.asentamientoMm) / 10, 1)} cm` : "—"}
                  </td>
                  <td className="text-right py-1 px-2">
                    {r.temperaturaHormigonC != null ? `${fmtNum(r.temperaturaHormigonC, 1)}°` : "—"}
                  </td>
                  <td className="text-right py-1 px-2">
                    {r.aireMedidoPct != null ? `${fmtNum(r.aireMedidoPct, 1)}%` : "—"}
                  </td>
                  <td className="text-right py-1 px-2" title={`Agua agregada en este evento: ${(Number(r.aguaAgregadaLts) || 0).toFixed(1)} L`}>
                    {c.aguaAcumuladaLts != null ? <strong>{fmtNum(c.aguaAcumuladaLts, 1)} L</strong> : "—"}
                  </td>
                  <td className="text-right py-1 px-2">
                    {c.remanenteVigenteM3 != null ? `${fmtNum(c.remanenteVigenteM3, 2)} m³` : "—"}
                  </td>
                  <td className="text-right py-1 px-2 font-bold" style={{ color: c.acEfectivo != null && c.acEfectivo > 0.6 ? 'var(--orange-500)' : undefined }}>
                    {c.acEfectivo != null ? fmtNum(c.acEfectivo, 3) : "—"}
                  </td>
                  <td className="py-1 px-2">
                    {r.aspecto ? (
                      <Tag value={r.aspecto} severity={r.aspecto === "Bueno" ? "success" : r.aspecto === "Regular" ? "warning" : "danger"} />
                    ) : <span className="text-color-secondary">—</span>}
                  </td>
                  <td className="py-1 px-2 text-right" style={{ whiteSpace: "nowrap", minWidth: 90 }}>
                    <button type="button" onClick={() => openEdit(r)}
                      style={{ background: "var(--blue-500)", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer", marginRight: 4 }}>
                      Editar
                    </button>
                    <button type="button" onClick={() => handleDelete(r)}
                      style={{ background: "var(--red-500)", color: "#fff", border: "none", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
                      Borrar
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fila de edición / nueva.
          Lógica contextual (sesión 2026-06-13):
            - PRIMERA medición (Medición #1 / base): campos de RETENCIÓN
              (agua, aditivos del diseño, fibras del diseño) + datos base.
            - SIGUIENTES (Medición #2, #3, ...): campos de AGREGADO
              restringidos a los productos del diseño + alerta no bloqueante
              si se excede lo retenido. */}
      {editingId !== null && (() => {
        // Es la primera medición si no hay otras (modo new) o si esta es la
        // primera cronológicamente (modo edit).
        const esPrimera = editingId === 'new'
          ? sortedRows.length === 0
          : sortedRows.length > 0 && sortedRows[0].id === editingId;
        const numeroMedicion = editingId === 'new' ? sortedRows.length + 1
          : (sortedRows.findIndex((r) => r.id === editingId) + 1) || 1;
        return (
        <div className="surface-50 border-round p-3 mb-2" style={{ borderLeft: `4px solid ${esPrimera ? 'var(--blue-500)' : 'var(--green-500)'}` }}>
          <div className="mb-2">
            <strong className="text-sm">
              <i className={`fa-solid ${esPrimera ? 'fa-flag' : 'fa-plus-circle'} mr-2`} style={{ color: esPrimera ? 'var(--blue-500)' : 'var(--green-500)' }} />
              Medición #{numeroMedicion} {esPrimera && <span className="text-color-secondary">(base — datos iniciales y materiales retenidos)</span>}
              {!esPrimera && <span className="text-color-secondary">(agregados de agua/aditivos/fibras durante el ciclo)</span>}
            </strong>
          </div>
          <div className="grid formgrid">
            <div className="field col-6 md:col-3">
              <label className="text-xs">Etapa <span style={{ color: "var(--red-500)" }}>*</span></label>
              <Dropdown value={form.etapa} options={ETAPA_OPTS} onChange={(e) => setField("etapa", e.value)} className="w-full" />
            </div>
            <div className="field col-6 md:col-3">
              <label className="text-xs">Etiqueta <span style={{ color: "var(--red-500)" }}>*</span></label>
              <InputText value={form.etiqueta} onChange={(e) => setField("etiqueta", e.target.value)} className="w-full p-inputtext-sm" placeholder={esPrimera ? "Ej: Salida de planta" : "Ej: Tras remezcla en obra"} />
            </div>
            <div className="field col-6 md:col-3">
              <label className="text-xs">Hora{baseFecha ? ` (${baseFecha.split("-").reverse().join("/")})` : ""} <span style={{ color: "var(--red-500)" }}>*</span></label>
              <input
                type="time"
                className="p-inputtext p-inputtext-sm w-full"
                value={(() => {
                  const v = form.fechaHora;
                  if (!v) return "";
                  const d = v instanceof Date ? v : new Date(v);
                  if (isNaN(d.getTime())) return "";
                  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                })()}
                onChange={(e) => {
                  const [hh, mm] = (e.target.value || "").split(":").map(n => Number(n));
                  if (isNaN(hh) || isNaN(mm)) { setField("fechaHora", null); return; }
                  const dateBase = baseFecha ? baseFecha : new Date().toISOString().slice(0, 10);
                  setField("fechaHora", new Date(`${dateBase}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`));
                }}
              />
            </div>
            <div className="field col-6 md:col-3">
              <label className="text-xs">Slump (cm)</label>
              <InputNumber
                value={form.asentamientoMm != null ? form.asentamientoMm / 10 : null}
                onValueChange={(e) => setField("asentamientoMm", e.value != null ? Math.round(e.value * 10) : null)}
                min={0} max={35}
                minFractionDigits={1} maxFractionDigits={1}
                inputClassName="w-full"
              />
            </div>
            <div className="field col-6 md:col-3">
              <label className="text-xs">T° hormigón (°C)</label>
              <InputNumber value={form.temperaturaHormigonC} onValueChange={(e) => setField("temperaturaHormigonC", e.value)} min={-5} max={80} minFractionDigits={0} maxFractionDigits={1} inputClassName="w-full" />
            </div>
            <div className="field col-6 md:col-3">
              <label className="text-xs">T° ambiente (°C)</label>
              <InputNumber value={form.temperaturaAmbienteC} onValueChange={(e) => setField("temperaturaAmbienteC", e.value)} min={-30} max={60} minFractionDigits={0} maxFractionDigits={1} inputClassName="w-full" />
            </div>
            {/* "Probetas moldeadas" eliminado de Mediciones (sesión 2026-06-12):
                ya queda registrado en los datos iniciales del pastón cuando se
                planifican las probetas + se crea la MuestraPaston. Repetirlo
                acá generaba doble carga y datos inconsistentes. */}
            <div className="field col-6 md:col-3">
              <label className="text-xs">Aspecto</label>
              <Dropdown value={form.aspecto} options={ASPECTO_OPTS} onChange={(e) => setField("aspecto", e.value)} showClear className="w-full" />
            </div>
            <div className="field col-12 md:col-6">
              <label className="text-xs">Observación</label>
              <InputText value={form.observacion} onChange={(e) => setField("observacion", e.target.value)} className="w-full p-inputtext-sm" placeholder="Ej: tras remezcla 10 min" />
            </div>

            {/* ── Volumen remanente ── */}
            <div className="field col-12 md:col-4">
              <label className="text-xs">Volumen remanente (m³){tieneAgregadoEnForm ? <span style={{ color: "var(--red-500)" }}> *</span> : null}</label>
              <InputNumber
                value={form.volumenRemanenteM3}
                onValueChange={(e) => setField("volumenRemanenteM3", e.value)}
                min={0} max={50}
                minFractionDigits={2} maxFractionDigits={3}
                suffix=" m³"
                className="w-full"
                placeholder={pastonVolumenM3 != null ? `${Number(pastonVolumenM3).toFixed(2)} (total)` : "—"}
              />
            </div>
            <div className="field col-12 md:col-4">
              <label className="text-xs">Aire medido (%)</label>
              <InputNumber
                value={form.aireMedidoPct}
                onValueChange={(e) => setField("aireMedidoPct", e.value)}
                min={0} max={20}
                minFractionDigits={1} maxFractionDigits={2}
                className="w-full"
              />
            </div>

          </div>

          {/* ── Sección contextual: RETENCIÓN (solo medición #1 / base) ─── */}
          {esPrimera && (
            <div className="mt-3 p-2 border-round" style={{ background: 'rgba(59, 130, 246, 0.08)', borderLeft: '3px solid var(--blue-500)' }}>
              <small className="font-bold block mb-2">
                <i className="fa-solid fa-warehouse mr-1" />Material retenido (no incorporado al mix — queda en reserva para etapas siguientes)
              </small>
              <div className="grid formgrid">
                <div className="field col-12 md:col-4">
                  <label className="text-xs">Agua retenida (L)</label>
                  <InputNumber
                    value={form.aguaRetenidaLts}
                    onValueChange={(e) => setField("aguaRetenidaLts", e.value)}
                    min={0} max={500}
                    minFractionDigits={0} maxFractionDigits={2}
                    inputClassName="w-full"
                  />
                </div>
                {/* Aditivos retenidos: matching por refIdx (no por nombre),
                    porque dos aditivos pueden tener la misma label/fallback
                    y al .find() por nombre se propagaba el valor a todos. */}
                {(aditivosDiseno || []).map((ad) => {
                  const arr = Array.isArray(form.aditivosRetenidosJson) ? form.aditivosRetenidosJson : [];
                  const item = arr.find((x) => x.tipo === 'ADITIVO' && x.refIdx === ad.refIdx);
                  return (
                    <div key={`ret-ad-${ad.refIdx}`} className="field col-12 md:col-4">
                      <label className="text-xs">{ad.nombre} (kg)</label>
                      <InputNumber
                        value={item?.cantidad ?? null}
                        onValueChange={(e) => {
                          const next = arr.filter((x) => !(x.tipo === 'ADITIVO' && x.refIdx === ad.refIdx));
                          if (e.value != null && Number(e.value) > 0) {
                            next.push({ tipo: 'ADITIVO', refIdx: ad.refIdx, nombre: ad.nombre, cantidad: Number(e.value), unidad: 'kg' });
                          }
                          setField("aditivosRetenidosJson", next);
                        }}
                        min={0} max={500}
                        minFractionDigits={0} maxFractionDigits={3}
                        inputClassName="w-full"
                      />
                      <small className="text-color-secondary block" style={{ fontSize: '0.65rem' }}>Diseño: {Number(ad.dosisDiseno).toFixed(3)} {ad.unidad}</small>
                    </div>
                  );
                })}
                {(fibrasDiseno || []).map((fb) => {
                  const arr = Array.isArray(form.fibrasRetenidasJson) ? form.fibrasRetenidasJson : [];
                  const item = arr.find((x) => x.tipo === 'FIBRA' && x.refIdx === fb.refIdx);
                  return (
                    <div key={`ret-fb-${fb.refIdx}`} className="field col-12 md:col-4">
                      <label className="text-xs">{fb.nombre} (kg) — fibra</label>
                      <InputNumber
                        value={item?.cantidad ?? null}
                        onValueChange={(e) => {
                          const next = arr.filter((x) => !(x.tipo === 'FIBRA' && x.refIdx === fb.refIdx));
                          if (e.value != null && Number(e.value) > 0) {
                            next.push({ tipo: 'FIBRA', refIdx: fb.refIdx, nombre: fb.nombre, cantidad: Number(e.value), unidad: 'kg' });
                          }
                          setField("fibrasRetenidasJson", next);
                        }}
                        min={0} max={50}
                        minFractionDigits={0} maxFractionDigits={3}
                        inputClassName="w-full"
                      />
                      <small className="text-color-secondary block" style={{ fontSize: '0.65rem' }}>Diseño: {Number(fb.dosisDiseno).toFixed(3)} {fb.unidad}</small>
                    </div>
                  );
                })}
              </div>
              <small className="text-color-secondary block mt-1">
                Estos valores quedan disponibles para incorporar en las mediciones siguientes. No se pueden retener agregados ni cemento.
              </small>
            </div>
          )}

          {/* ── Sección contextual: AGREGADO (mediciones #2, #3...) ─── */}
          {!esPrimera && (
            <div className="mt-3 p-2 border-round" style={{ background: 'rgba(34, 197, 94, 0.08)', borderLeft: '3px solid var(--green-500)' }}>
              <small className="font-bold block mb-2">
                <i className="fa-solid fa-syringe mr-1" />Material agregado al pastón en esta etapa
              </small>
              <div className="grid formgrid">
                <div className="field col-12 md:col-4">
                  <label className="text-xs">Agua agregada (L)</label>
                  <InputNumber
                    value={form.aguaAgregadaLts}
                    onValueChange={(e) => setField("aguaAgregadaLts", e.value)}
                    min={0} max={500}
                    minFractionDigits={0} maxFractionDigits={2}
                    inputClassName="w-full"
                  />
                </div>
                {/* Mismo fix: matching por (tipo, refIdx) en lugar de nombre,
                    para evitar que tipear en un aditivo se propague al resto.
                    Aditivos y fibras comparten el array aditivosAgregadosJson,
                    por eso `tipo` discrimina (ADITIVO vs FIBRA). */}
                {(aditivosDiseno || []).map((ad) => {
                  const arr = Array.isArray(form.aditivosAgregadosJson) ? form.aditivosAgregadosJson : [];
                  const item = arr.find((x) => x.tipo === 'ADITIVO' && x.refIdx === ad.refIdx);
                  return (
                    <div key={`agr-ad-${ad.refIdx}`} className="field col-12 md:col-4">
                      <label className="text-xs">{ad.nombre} (kg)</label>
                      <InputNumber
                        value={item?.cantidad ?? null}
                        onValueChange={(e) => {
                          const next = arr.filter((x) => !(x.tipo === 'ADITIVO' && x.refIdx === ad.refIdx));
                          if (e.value != null && Number(e.value) > 0) {
                            next.push({ tipo: 'ADITIVO', refIdx: ad.refIdx, nombre: ad.nombre, cantidad: Number(e.value), unidad: 'kg' });
                          }
                          setField("aditivosAgregadosJson", next);
                        }}
                        min={0} max={500}
                        minFractionDigits={0} maxFractionDigits={3}
                        inputClassName="w-full"
                      />
                      <small className="text-color-secondary block" style={{ fontSize: '0.65rem' }}>Diseño: {Number(ad.dosisDiseno).toFixed(3)} {ad.unidad}</small>
                    </div>
                  );
                })}
                {(fibrasDiseno || []).map((fb) => {
                  const arr = Array.isArray(form.aditivosAgregadosJson) ? form.aditivosAgregadosJson : [];
                  const item = arr.find((x) => x.tipo === 'FIBRA' && x.refIdx === fb.refIdx);
                  return (
                    <div key={`agr-fb-${fb.refIdx}`} className="field col-12 md:col-4">
                      <label className="text-xs">{fb.nombre} (kg) — fibra</label>
                      <InputNumber
                        value={item?.cantidad ?? null}
                        onValueChange={(e) => {
                          const next = arr.filter((x) => !(x.tipo === 'FIBRA' && x.refIdx === fb.refIdx));
                          if (e.value != null && Number(e.value) > 0) {
                            next.push({ tipo: 'FIBRA', refIdx: fb.refIdx, nombre: fb.nombre, cantidad: Number(e.value), unidad: 'kg' });
                          }
                          setField("aditivosAgregadosJson", next);
                        }}
                        min={0} max={50}
                        minFractionDigits={0} maxFractionDigits={3}
                        inputClassName="w-full"
                      />
                      <small className="text-color-secondary block" style={{ fontSize: '0.65rem' }}>Diseño: {Number(fb.dosisDiseno).toFixed(3)} {fb.unidad}</small>
                    </div>
                  );
                })}
              </div>
              <small className="text-color-secondary block mt-1">
                Solo se pueden incorporar productos del diseño. Si se excede lo retenido en la Medición #1, se mostrará una alerta no bloqueante en el resumen final.
              </small>
            </div>
          )}

          <div className="flex justify-content-end gap-2 mt-3">
            <Button label="Cancelar" className="p-button-text p-button-sm" onClick={cancelEdit} />
            <Button label={editingId === "new" ? "Agregar" : "Guardar"} icon="fa-solid fa-check" className="p-button-sm" onClick={handleSave} disabled={!canSave || saving} loading={saving} />
          </div>
        </div>
        );
      })()}

      {/* Panel de cómputo final del pastón (sesión 2026-06-13). Aparece
          cuando hay al menos 1 medición. Muestra retenido vs agregado, a/c
          final, % aditivos sobre cemento restante, y alertas no bloqueantes
          si se excedió el retenido declarado en la primera medición. */}
      {computos && sortedRows.length > 0 && (
        <div className="surface-card border-round border-1 border-300 p-3 mt-3 mb-2">
          <strong className="text-sm">
            <i className="fa-solid fa-calculator mr-2 text-primary" />
            Cómputo final del pastón
          </strong>
          <div className="text-xs text-color-secondary mb-2 mt-1">
            Balance entre el material retenido (declarado en la Medición #1) y los agregados acumulados durante el timeline.
          </div>

          {/* KPIs principales */}
          <div className="grid mt-2">
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center">
                <div className="text-xs text-color-secondary">Agua retenida</div>
                <div className="font-bold">{fmtNum(computos.retenido.aguaLts, 1)} L</div>
              </div>
            </div>
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center" style={{ borderLeft: computos.aguaExcede ? '3px solid var(--orange-500)' : undefined }}>
                <div className="text-xs text-color-secondary">Agua agregada</div>
                <div className="font-bold" style={{ color: computos.aguaExcede ? 'var(--orange-500)' : undefined }}>
                  {fmtNum(computos.aguaAgregadaLts, 1)} L
                </div>
              </div>
            </div>
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center">
                <div className="text-xs text-color-secondary">Remanente final</div>
                <div className="font-bold">{computos.remanenteFinal != null ? `${fmtNum(computos.remanenteFinal, 2)} m³` : '—'}</div>
              </div>
            </div>
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center">
                <div className="text-xs text-color-secondary">Cemento restante</div>
                <div className="font-bold">{computos.cementoRestante != null ? `${fmtNum(computos.cementoRestante, 0)} kg` : '—'}</div>
              </div>
            </div>
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center" style={{ borderLeft: computos.acFinal != null && computos.acFinal > 0.6 ? '3px solid var(--orange-500)' : undefined }}>
                <div className="text-xs text-color-secondary">a/c final</div>
                <div className="font-bold" style={{ color: computos.acFinal != null && computos.acFinal > 0.6 ? 'var(--orange-500)' : undefined }}>
                  {computos.acFinal != null ? fmtNum(computos.acFinal, 3) : '—'}
                </div>
              </div>
            </div>
            <div className="col-6 sm:col-4 lg:col-2">
              <div className="surface-100 border-round p-2 text-center">
                <div className="text-xs text-color-secondary">% aditivos / cemento</div>
                <div className="font-bold">{computos.pctAditivos != null ? `${fmtNum(computos.pctAditivos, 2)} %` : '—'}</div>
              </div>
            </div>
          </div>

          {/* Detalle de aditivos: retenido vs agregado por producto */}
          {(computos.retenido.aditivos.length > 0 || computos.aditivosAgregados.length > 0) && (
            <div className="mt-3">
              <small className="font-bold block mb-1">Aditivos — retenido vs agregado</small>
              <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface-300)' }}>
                    <th className="text-left py-1 px-2">Producto</th>
                    <th className="text-right py-1 px-2">Retenido</th>
                    <th className="text-right py-1 px-2">Agregado</th>
                    <th className="text-right py-1 px-2">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const all = new Map();
                    for (const r of computos.retenido.aditivos) {
                      const k = (r.nombre || '').trim().toLowerCase();
                      all.set(k, { nombre: r.nombre, retenido: Number(r.cantidad) || 0, agregado: 0, unidad: r.unidad });
                    }
                    for (const a of computos.aditivosAgregados) {
                      const k = (a.nombre || '').trim().toLowerCase();
                      if (!all.has(k)) {
                        all.set(k, { nombre: a.nombre, retenido: 0, agregado: Number(a.cantidad) || 0, unidad: a.unidad });
                      } else {
                        all.get(k).agregado = Number(a.cantidad) || 0;
                      }
                    }
                    return Array.from(all.values()).map((row, i) => {
                      const diff = row.agregado - row.retenido;
                      const excede = diff > 0.001;
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--surface-200)' }}>
                          <td className="py-1 px-2">{row.nombre || '—'}</td>
                          <td className="text-right py-1 px-2">{fmtNum(row.retenido, 3)} {row.unidad}</td>
                          <td className="text-right py-1 px-2">{fmtNum(row.agregado, 3)} {row.unidad}</td>
                          <td className="text-right py-1 px-2" style={{ color: excede ? 'var(--orange-500)' : 'var(--green-500)' }}>
                            {diff >= 0 ? '+' : ''}{fmtNum(diff, 3)} {row.unidad}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {/* B1 — Alerta de desvío normativo de a/c (visual, NO bloqueante).
              El a/c máx (pliego / Tabla 2.5 durabilidad) es límite de
              cumplimiento obligatorio y aplica sobre la a/c REAL del pastón.
              Se alerta sin degradar el veredicto (decisión de producto). */}
          {(() => {
            const lims = [
              acMaxPliego != null && Number.isFinite(Number(acMaxPliego))
                ? { v: Number(acMaxPliego), f: 'pliego' } : null,
              acMaxDurabilidad != null && Number.isFinite(Number(acMaxDurabilidad))
                ? { v: Number(acMaxDurabilidad), f: `durabilidad CIRSOC 200:2024 Tabla 2.5${claseExposicion ? ` — clase ${claseExposicion}` : ''}` } : null,
            ].filter(Boolean);
            if (lims.length === 0 || computos.acFinal == null) return null;
            const gob = lims.reduce((a, b) => (b.v < a.v ? b : a));
            if (computos.acFinal <= gob.v + 0.005) return null;
            return (
              <div className="mt-3 p-2 border-round" style={{ background: 'rgba(220, 38, 38, 0.12)', borderLeft: '3px solid var(--red-500)' }}>
                <strong className="text-sm" style={{ color: 'var(--red-600)' }}>
                  <i className="fa-solid fa-triangle-exclamation mr-2" />
                  Desvío normativo de a/c
                </strong>
                <div className="text-xs mt-1">
                  La a/c efectiva final (<strong>{fmtNum(computos.acFinal, 3)}</strong>) supera el a/c máximo de {gob.f} (<strong>{fmtNum(gob.v, 3)}</strong>).
                  Es un límite de cumplimiento obligatorio (CIRSOC 200:2024 §2.2.4/§6) sobre la a/c REAL. Verificá conformidad / justificá el desvío antes de liberar a producción.
                </div>
              </div>
            );
          })()}

          {/* Alertas no bloqueantes de exceso */}
          {(computos.aguaExcede || computos.excedentesAditivos.length > 0) && (
            <div className="mt-3 p-2 border-round" style={{ background: 'rgba(245, 158, 11, 0.15)', borderLeft: '3px solid var(--orange-500)' }}>
              <strong className="text-sm" style={{ color: 'var(--orange-700)' }}>
                <i className="fa-solid fa-triangle-exclamation mr-2" />
                Atención: agregados que exceden lo retenido
              </strong>
              <ul className="text-xs mt-1 mb-0" style={{ paddingLeft: '1.5rem' }}>
                {computos.aguaExcede && (
                  <li>
                    Se agregaron <strong>{fmtNum(computos.aguaAgregadaLts, 1)} L de agua</strong>, pero solo se habían retenido <strong>{fmtNum(computos.retenido.aguaLts, 1)} L</strong>.
                    Esto modifica el a/c del diseño original.
                  </li>
                )}
                {computos.excedentesAditivos.map((ex, i) => (
                  <li key={i}>
                    <strong>{ex.nombre}</strong>: agregado {fmtNum(ex.agregado, 3)} {ex.unidad}, retenido {fmtNum(ex.retenido, 3)} {ex.unidad}.
                  </li>
                ))}
              </ul>
              <div className="text-xs mt-1 text-color-secondary">
                No bloqueante — el pastón se puede guardar igual. Verificá la consistencia técnica antes de aprobar.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mini-chart slump loss */}
      {chart && (
        <div className="surface-50 border-round p-2">
          <div className="text-xs text-color-secondary mb-1">Slump vs tiempo</div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: "100%", maxWidth: 400, height: chart.H }}>
            {/* eje X baseline */}
            <line x1={chart.PADL} y1={chart.H - chart.PADB} x2={chart.W - 10} y2={chart.H - chart.PADB} stroke="#ccc" strokeWidth="0.5" />
            {/* eje Y baseline */}
            <line x1={chart.PADL} y1={chart.PADT} x2={chart.PADL} y2={chart.H - chart.PADB} stroke="#ccc" strokeWidth="0.5" />
            {/* ticks Y */}
            {[0, 50, 100, 150, 200].filter(s => s <= chart.sMax).map(s => (
              <g key={s}>
                <line x1={chart.PADL - 2} y1={chart.sy(s)} x2={chart.PADL} y2={chart.sy(s)} stroke="#888" strokeWidth="0.5" />
                <text x={chart.PADL - 4} y={chart.sy(s) + 3} textAnchor="end" fontSize="8" fill="#666">{s}</text>
              </g>
            ))}
            {/* serie */}
            <path d={chart.pathD} fill="none" stroke="var(--blue-500)" strokeWidth="1.5" />
            {chart.pts.map((p, i) => (
              <circle
                key={i}
                cx={chart.sx(p.t)} cy={chart.sy(p.slump)} r="2.5"
                fill={p.etapa === "PLANTA" ? "var(--orange-500)" : p.etapa === "TRANSPORTE" ? "var(--cyan-500)" : "var(--green-500)"}
              />
            ))}
            {/* ticks X con hora de cada medición, rotados 45° sobre el eje */}
            {chart.pts.map((p, i) => {
              const hora = new Date(p.t).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
              const tx = chart.sx(p.t);
              const ty = chart.H - chart.PADB;
              return (
                <g key={`t-${i}`}>
                  <line x1={tx} y1={ty} x2={tx} y2={ty + 2} stroke="#888" strokeWidth="0.5" />
                  <text
                    x={tx} y={ty + 4}
                    textAnchor="start" fontSize="7" fill="#555"
                    transform={`rotate(45 ${tx} ${ty + 4})`}
                  >
                    {hora}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}
