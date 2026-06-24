import React, { useEffect, useState, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Chart } from "primereact/chart";
import { Divider } from "primereact/divider";
import { SelectButton } from "primereact/selectbutton";
import { MODO_DESCRIPTIVO, MODO_NORMATIVO } from "../../../lib/evaluacion";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { getDosificacion, obtenerResultadosProduccion } from "../../../services/dosificacionDisenoService";
import { getPreciosVigentesBulk } from "../../../services/materialPrecioService";
import { calcularCostosDosificacion } from "./costosUtils";
import { generarComparacionPdf } from "./comparacionInformePdf";

const ESTADO_LABELS = {
  BORRADOR: "Borrador", A_PRUEBA: "A prueba", PENDIENTE_REVISION: "Pendiente revisión",
  APROBADO: "Aprobado", SUSPENDIDO: "Suspendido", ARCHIVADO: "Archivado",
  VALIDADO: "Aprobado", EN_PRODUCCION: "Aprobado", OBSOLETO: "Archivado",
};
const METODO_LABELS = { HORMIQUAL: "HormiQual 1.0", ICPA: "HormiQual", ACI_211: "HormiQual" };

const RADAR_COLORS = ["rgba(37,99,235,0.5)", "rgba(239,68,68,0.5)", "rgba(16,185,129,0.5)", "rgba(245,158,11,0.5)"];
const RADAR_BORDERS = ["rgb(37,99,235)", "rgb(239,68,68)", "rgb(16,185,129)", "rgb(245,158,11)"];

/**
 * Rangos de normalización del radar chart (R14).
 *
 * IMPORTANTE: estos valores producen un **índice visual cualitativo**, NO una
 * métrica normativa. Los rangos cubren los hormigones convencionales más usados
 * en planta y permiten comparar dos diseños entre sí; los extremos del rango se
 * eligieron empíricamente para que las puntas del radar queden en zonas
 * informativas. Si algún valor cae fuera del rango se clipea a 0/100.
 *
 * - resistenciaMaxMpa = 60     → f'cm ≥ 60 MPa pinta el eje al máximo (alta resistencia).
 * - costoBaselineArs  = 30000  → costo total < ~$30k/m³ pinta el eje al máximo.
 * - acRangoMin / Max  = 0.30 / 0.70 → la durabilidad sube cuando a/c baja en ese rango.
 * - asentamientoMaxMm = 200    → s = 20 cm pinta el eje al máximo (mayor trabajabilidad).
 * - cementoRangoMin / Max = 200 / 500 kg/m³ → la "sustentabilidad" sube cuando el cemento baja.
 *
 * No usar estos valores como umbrales de aceptación. Para ver cumplimiento normativo
 * mirá las verificaciones CIRSOC del informe individual de cada diseño.
 */
const RADAR_NORM = Object.freeze({
  resistenciaMaxMpa: 60,
  costoBaselineArs: 30000,
  acRangoMin: 0.30,
  acRangoMax: 0.70,
  asentamientoMaxMm: 200,
  cementoRangoMin: 200,
  cementoRangoMax: 500,
});

const formatNum = (v, d = 1) => v != null ? Number(v).toFixed(d) : "-";
const formatCurrency = (v) => v != null ? `$${Number(v).toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : "-";

function delta(a, b, digits = 1) {
  if (a == null || b == null) return { abs: "-", pct: "-", cls: "" };
  const diff = b - a;
  const pct = a !== 0 ? (diff / a) * 100 : 0;
  const cls = Math.abs(pct) < 1 ? "text-color-secondary" : diff < 0 ? "text-green-600" : "text-red-600";
  return {
    abs: `${diff >= 0 ? "+" : ""}${diff.toFixed(digits)}`,
    pct: `${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
    cls,
  };
}

/**
 * Genera conclusiones cualitativas de comparación entre dos diseños (delta de
 * cemento, agua, a/c, costo, y resultado de producción si existe).
 *
 * Alcance (R15): es un resumen narrativo para la UI, NO un veredicto normativo.
 * Cada diseño tiene su propia evaluación de aptitud / cumplimiento CIRSOC en su
 * informe individual; este helper sólo destaca diferencias entre dos diseños.
 * En particular, la comparación `prodX.fck >= objX` (resistencia característica
 * de producción vs especificada) es directa: para evaluación rigurosa de la
 * resistencia de producción según IRAM 1666 (modo 1 / modo 2) usar el flujo
 * dedicado de modo de producción, no este resumen.
 */
function buildConclusiones(designs, costosMap = {}, produccionMap = {}) {
  if (designs.length < 2) return [];
  const conclusiones = [];
  const a = designs[0];
  const b = designs[1];
  const ra = a.resultadoJson || {};
  const rb = b.resultadoJson || {};

  // Cement difference
  if (ra.cementoKgM3 && rb.cementoKgM3) {
    const diff = rb.cementoKgM3 - ra.cementoKgM3;
    const pct = ((diff / ra.cementoKgM3) * 100).toFixed(1);
    if (Math.abs(diff) > ra.cementoKgM3 * 0.02) {
      const waterDiff = rb.aguaLtsM3 && ra.aguaLtsM3 ? rb.aguaLtsM3 - ra.aguaLtsM3 : null;
      let txt = `El Diseño B utiliza ${Math.abs(diff).toFixed(0)} kg/m³ ${diff > 0 ? "más" : "menos"} de cemento (${pct}%)`;
      if (waterDiff != null && Math.abs(waterDiff) > 1) {
        txt += ` y ${Math.abs(waterDiff).toFixed(1)} L/m³ ${waterDiff > 0 ? "más" : "menos"} de agua`;
      }
      txt += ` que el Diseño A.`;
      conclusiones.push(txt);
    }
  }

  // A/C difference
  const acA = ra.ac;
  const acB = rb.ac;
  if (acA && acB && Math.abs(acB - acA) > 0.01) {
    const more = acB < acA ? "más restrictiva" : "menos restrictiva";
    conclusiones.push(`La relación a/c del Diseño B (${acB.toFixed(2)}) es ${more}, lo que implica ${acB < acA ? "mayor durabilidad pero mayor costo de cemento" : "menor costo pero menor durabilidad"}.`);
  }

  // Cost comparison
  const costA = costosMap[a.id]?.totalMateriales;
  const costB = costosMap[b.id]?.totalMateriales;
  if (costA && costB) {
    const diff = costB - costA;
    const pct = ((diff / costA) * 100).toFixed(1);
    if (Math.abs(Number(pct)) > 2) {
      conclusiones.push(`El costo por m³ del Diseño B es ${Math.abs(pct)}% ${diff > 0 ? "superior" : "inferior"} ($${Number(costB).toLocaleString("es-AR", { maximumFractionDigits: 0 })} vs $${Number(costA).toLocaleString("es-AR", { maximumFractionDigits: 0 })}).`);
    }
  }

  // Production results
  const prodA = produccionMap[a.id];
  const prodB = produccionMap[b.id];
  if (prodA && prodB) {
    const objA = (a.parametrosObjetivoJson || {}).resistenciaMpa || 0;
    const objB = (b.parametrosObjetivoJson || {}).resistenciaMpa || 0;
    const cumpleA = prodA.fck != null && prodA.fck >= objA;
    const cumpleB = prodB.fck != null && prodB.fck >= objB;
    if (cumpleA !== cumpleB) {
      const cual = cumpleB ? "B" : "A";
      const no = cumpleB ? "A" : "B";
      const fckCumple = cumpleB ? prodB.fck : prodA.fck;
      const fckNo = cumpleB ? prodA.fck : prodB.fck;
      conclusiones.push(`En producción, el Diseño ${cual} cumple la especificación (f'ck ${fckCumple?.toFixed(2)}) mientras que el Diseño ${no} no cumplía (f'ck ${fckNo?.toFixed(2)}).`);
    }
  }

  return conclusiones;
}

export default function DosificacionComparacionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const dosificacionIds = location.state?.dosificacionIds || [];

  const [designs, setDesigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [costosMap, setCostosMap] = useState({});
  const [produccionMap, setProduccionMap] = useState({});
  // Decisión 2026-05-28: modo del documento. Default DESCRIPTIVO.
  const [modoEvaluacion, setModoEvaluacion] = useState(MODO_DESCRIPTIVO);

  useEffect(() => {
    if (dosificacionIds.length < 2) {
      toast.current?.show({ severity: "warn", summary: "Selección insuficiente", detail: "Seleccione al menos 2 dosificaciones" });
      navigate("/calidad/catalogos/dosificaciones");
      return;
    }

    // Fix audit 2026-05-28 (test95): el backend devuelve los campos JSON
    // como strings (no parseados) en algunas configuraciones de Sequelize.
    // Sin este parse, todos los accesos `(d.resultadoJson || {}).foo`
    // devuelven undefined y las tablas quedan vacías ("—") aunque haya
    // datos. Mismo patrón que `parseStoredJson` de DosificacionDisenoPage.
    const parseStoredJson = (value) => {
      if (value == null) return null;
      if (typeof value === "object") return value;
      if (typeof value !== "string") return null;
      try { return JSON.parse(value); } catch { return null; }
    };
    const hidratarDiseno = (d) => {
      if (!d) return d;
      return {
        ...d,
        resultadoJson: parseStoredJson(d.resultadoJson) || {},
        parametrosObjetivoJson: parseStoredJson(d.parametrosObjetivoJson) || {},
        trazabilidadJson: parseStoredJson(d.trazabilidadJson) || {},
      };
    };

    const fetchDesigns = async () => {
      setLoading(true);
      try {
        const results = await Promise.all(dosificacionIds.map(id => getDosificacion(id)));
        setDesigns(results.filter(Boolean).map(hidratarDiseno));
      } catch (err) {
        console.error(err);
        toast.current?.show({ severity: "error", summary: "Error", detail: "No se pudieron cargar las dosificaciones" });
      } finally {
        setLoading(false);
      }
    };
    fetchDesigns();
    // M15 — el effect debe correr UNA sola vez al montar (los IDs vienen de
    // navegación inicial via location.state). Si el array de IDs cambia, la
    // página se desmonta/remonta. Las dependencias del scope (toast, navigate,
    // dosificacionIds) son estables o se usan defensivamente, así que el
    // disable explícito es intencional, no un descuido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch production results for all designs
  useEffect(() => {
    if (designs.length === 0) return;
    const fetchProduccion = async () => {
      const results = {};
      await Promise.all(designs.map(async (d) => {
        try {
          const data = await obtenerResultadosProduccion(d.id);
          if (data && data.muestras > 0) results[d.id] = data;
        } catch { /* no production data available */ }
      }));
      setProduccionMap(results);
    };
    fetchProduccion();
  }, [designs]);

  // Fetch costs for all designs
  useEffect(() => {
    if (designs.length === 0) return;

    const fetchCosts = async () => {
      const allMaterials = [];
      designs.forEach(d => {
        const r = d.resultadoJson || {};
        if (d.idCemento) allMaterials.push({ materialSource: "cemento", materialSourceId: d.idCemento });
        (r.agregados || []).forEach(ag => {
          if (ag.idAgregado) allMaterials.push({ materialSource: "agregado", materialSourceId: ag.idAgregado });
        });
      });

      if (allMaterials.length === 0) return;

      try {
        const uniqueMats = [];
        const seen = new Set();
        allMaterials.forEach(m => {
          const key = `${m.materialSource}_${m.materialSourceId}`;
          if (!seen.has(key)) { seen.add(key); uniqueMats.push(m); }
        });

        const preciosMap = await getPreciosVigentesBulk(uniqueMats);
        const costos = {};
        designs.forEach(d => {
          const r = d.resultadoJson || {};
          const contexto = {
            cementoId: d.idCemento,
            cementoLabel: d.cemento?.nombreComercial || "Cemento",
            adiciones: [],
            aditivos: [],
          };
          costos[d.id] = calcularCostosDosificacion(r, preciosMap, contexto);
        });
        setCostosMap(costos);
      } catch (err) {
        console.error("Error fetching costs for comparison:", err);
      }
    };
    fetchCosts();
  }, [designs]);

  const labels = useMemo(() => designs.map((_, i) => `Diseño ${String.fromCharCode(65 + i)}`), [designs]);

  // Radar chart data
  const radarData = useMemo(() => {
    if (designs.length < 2) return null;

    const axes = ["Resistencia", "Economía", "Durabilidad", "Trabajabilidad", "Sustentabilidad"];

    const datasets = designs.map((d, i) => {
      const r = d.resultadoJson || {};
      const params = d.parametrosObjetivoJson || {};
      const costos = costosMap[d.id];

      // Normalización 0-100 con clipping. Los valores de referencia están
      // documentados en RADAR_NORM (índice cualitativo, no normativo).
      const clip = (v) => Math.max(0, Math.min(100, v));
      const N = RADAR_NORM;
      const acRange = N.acRangoMax - N.acRangoMin;
      const cementoRange = N.cementoRangoMax - N.cementoRangoMin;

      const resistencia = clip(((r.fcm || params.resistenciaMpa || 30) / N.resistenciaMaxMpa) * 100);
      const economia = costos?.totalMateriales
        ? clip((N.costoBaselineArs / costos.totalMateriales) * 100)
        : 50;
      const durabilidad = r.ac
        ? clip(((N.acRangoMax - r.ac) / acRange) * 100)
        : 50;
      const trabajabilidad = params.asentamientoMm
        ? clip((params.asentamientoMm / N.asentamientoMaxMm) * 100)
        : 50;
      const sustentabilidad = r.cementoKgM3
        ? clip(((N.cementoRangoMax - r.cementoKgM3) / cementoRange) * 100)
        : 50;

      return {
        label: labels[i],
        data: [resistencia, economia, durabilidad, trabajabilidad, sustentabilidad],
        backgroundColor: RADAR_COLORS[i],
        borderColor: RADAR_BORDERS[i],
        borderWidth: 2,
        pointRadius: 3,
      };
    });

    return { labels: axes, datasets };
  }, [designs, labels, costosMap]);

  const radarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } },
    plugins: { legend: { position: "top" } },
  };

  const conclusiones = useMemo(() => buildConclusiones(designs, costosMap, produccionMap), [designs, costosMap, produccionMap]);

  if (loading) return <LoadSpinner />;

  if (designs.length < 2) return null;

  const ref = designs[0]; // reference design for delta calculations

  return (
    // Fix audit 2026-05-28: el contenedor sin padding hacía que el focus
    // outline del botón Exportar PDF desbordara por la izquierda de la
    // pantalla. Agregamos padding y overflow-hidden para contener.
    <div className="p-3" style={{ overflowX: 'hidden' }}>
      <PageHeader
        title="Comparación de dosificaciones"
        icon="fa-solid fa-code-compare"
        subtitle={`${designs.length} diseños`}
      />

      <div className="flex align-items-center gap-2 mb-3 flex-wrap">
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
          label="Exportar PDF"
          icon="fa-solid fa-file-pdf"
          className="p-button-outlined p-button-sm"
          onClick={() => generarComparacionPdf({ designs, labels, costosMap, conclusiones, modoEvaluacion })}
        />
      </div>

      {/* Section 1: Identificación */}
      <div className="card mb-3">
        <h5 className="mb-2">Identificación</h5>
        <DataTable responsiveLayout="scroll" value={[
          { campo: "Nombre", values: designs.map(d => d.nombre || `#${d.id}`) },
          { campo: "Versión", values: designs.map(d => `v${d.version || 1}`) },
          { campo: "Estado", values: designs.map(d => ESTADO_LABELS[d.estado] || d.estado) },
          { campo: "Método", values: designs.map(d => METODO_LABELS[d.metodo] || d.metodo) },
          { campo: "Planta", values: designs.map(d => d.planta?.nombre || "-") },
          { campo: "Cemento", values: designs.map(d => d.cemento?.nombreComercial || "-") },
        ]} size="small" stripedRows showGridlines>
          <Column field="campo" header="" style={{ width: "140px", fontWeight: "bold" }} />
          {designs.map((_, i) => (
            <Column key={i} header={labels[i]} body={(row) => row.values[i]} />
          ))}
        </DataTable>
      </div>

      {/* Section 2: Parámetros objetivo */}
      <div className="card mb-3">
        <h5 className="mb-2">Parámetros objetivo</h5>
        {(() => {
          const paramRows = [
            { campo: "f'ck (MPa)", key: "resistenciaMpa" },
            { campo: "Asentamiento (mm)", key: "asentamientoMm" },
            { campo: "TMN (mm)", key: "tmnMm" },
          ];
          const data = paramRows.map(pr => {
            const vals = designs.map(d => (d.parametrosObjetivoJson || {})[pr.key]);
            const refVal = vals[0];
            return { campo: pr.campo, vals, deltas: vals.map(v => delta(refVal, v)) };
          });
          return (
            <DataTable responsiveLayout="scroll" value={data} size="small" stripedRows showGridlines>
              <Column field="campo" header="" style={{ width: "140px", fontWeight: "bold" }} />
              {designs.map((_, i) => (
                <Column key={i} header={labels[i]} body={(row) => formatNum(row.vals[i])} />
              ))}
              {designs.length === 2 && (
                <Column header={`\u0394 ${labels[0]}\u2192${labels[1]}`} body={(row) => {
                  const d = row.deltas[1];
                  return d.abs === "-" ? "=" : <span className={d.cls}>{d.abs} ({d.pct})</span>;
                }} />
              )}
            </DataTable>
          );
        })()}
      </div>

      {/* Section 3: Restricciones adoptadas */}
      <div className="card mb-3">
        <h5 className="mb-2">Restricciones adoptadas</h5>
        {(() => {
          const data = [
            { campo: "a/c adoptada", vals: designs.map(d => (d.resultadoJson || {}).ac), fmt: (v) => v != null ? v.toFixed(2) : "-" },
          ];
          const refAc = data[0].vals[0];
          return (
            <DataTable responsiveLayout="scroll" value={data} size="small" stripedRows showGridlines>
              <Column field="campo" header="" style={{ width: "140px", fontWeight: "bold" }} />
              {designs.map((_, i) => (
                <Column key={i} header={labels[i]} body={(row) => row.fmt(row.vals[i])} />
              ))}
              {designs.length === 2 && (
                <Column header={"\u0394"} body={(row) => {
                  const d = delta(row.vals[0], row.vals[1], 2);
                  return d.abs === "-" ? "=" : <span className={d.cls}>{d.abs}</span>;
                }} />
              )}
            </DataTable>
          );
        })()}
      </div>

      {/* Section 4: Dosificación resultante */}
      <div className="card mb-3">
        <h5 className="mb-2">Dosificación resultante</h5>
        {(() => {
          // Collect all component names across all designs
          const rows = [];

          // Fixed components
          rows.push({ campo: "Agua (L/m³)", key: "aguaLtsM3", tipo: "agua" });
          rows.push({ campo: "Cemento (kg/m³)", key: "cementoKgM3", tipo: "cemento" });

          // Build aggregate rows from first design (they should share same mezcla)
          const allAggNames = new Set();
          designs.forEach(d => {
            ((d.resultadoJson || {}).agregados || []).forEach(ag => allAggNames.add(ag.nombre));
          });
          allAggNames.forEach(name => {
            rows.push({ campo: `${name} (kg)`, aggName: name, tipo: "agregado" });
          });

          rows.push({ campo: "PUV (kg/m³)", key: "puvTeorico", tipo: "puv" });

          const data = rows.map(row => {
            const vals = designs.map(d => {
              const r = d.resultadoJson || {};
              if (row.key) return r[row.key];
              if (row.aggName) {
                const ag = (r.agregados || []).find(a => a.nombre === row.aggName);
                return ag?.kgM3 ?? null;
              }
              return null;
            });
            return { ...row, vals, deltas: vals.map(v => delta(vals[0], v, 1)) };
          });

          return (
            <DataTable responsiveLayout="scroll" value={data} size="small" stripedRows showGridlines>
              <Column field="campo" header="" style={{ width: "180px", fontWeight: "bold" }} />
              {designs.map((_, i) => (
                <Column key={i} header={labels[i]} body={(row) => formatNum(row.vals[i])} align="right" />
              ))}
              {designs.length >= 2 && (
                <>
                  <Column header={"\u0394"} body={(row) => {
                    const d = row.deltas[1];
                    return d.abs === "-" ? "=" : <span className={d.cls}>{d.abs}</span>;
                  }} align="right" />
                  <Column header={"\u0394%"} body={(row) => {
                    const d = row.deltas[1];
                    return d.pct === "-" ? "-" : <span className={d.cls}>{d.pct}</span>;
                  }} align="right" />
                </>
              )}
            </DataTable>
          );
        })()}
      </div>

      {/* Section 4b: Verificaciones y trabajabilidad */}
      <div className="card mb-3">
        <h5 className="mb-2">Verificaciones e indicadores</h5>
        {(() => {
          const rows = [
            { campo: 'a/c final', get: d => d.resultadoJson?.acFinal },
            { campo: 'Zona Shilstone', get: d => d.resultadoJson?.trabajabilidad?.zonaShilstone || '—' },
            { campo: 'FdG (%)', get: d => d.resultadoJson?.trabajabilidad?.factorGrosor },
            { campo: 'FdT (%)', get: d => d.resultadoJson?.trabajabilidad?.factorTrabajabilidad },
            { campo: 'FdA', get: d => d.resultadoJson?.trabajabilidad?.kenDay?.factorAptitud },
            { campo: 'SE', get: d => d.resultadoJson?.trabajabilidad?.kenDay?.superficieEspecifica },
            { campo: 'IRAM 1627', get: d => d.resultadoJson?.verificacionIRAM?.estado || '—' },
            { campo: 'Pulverulento', get: d => {
              const p = d.trazabilidadJson?.verificacionPulverulento;
              return p ? (p.cumple ? `Cumple (${p.totalPulverulento} kg/m³)` : `No cumple (${p.totalPulverulento} kg/m³)`) : '—';
            }},
            { campo: 'Coherencia FdA', get: d => {
              const c = d.resultadoJson?.trabajabilidad?.coherencia;
              return typeof c === 'string' ? c : c?.estado || '—';
            }},
          ];

          const data = rows.map(row => {
            const vals = designs.map(d => {
              const v = row.get(d);
              return v;
            });
            return { campo: row.campo, vals };
          });

          return (
            <DataTable responsiveLayout="scroll" value={data} size="small" stripedRows showGridlines>
              <Column field="campo" header="" style={{ width: "180px", fontWeight: "bold" }} />
              {designs.map((_, i) => (
                <Column key={i} header={labels[i]} body={(row) => {
                  const v = row.vals[i];
                  if (v == null) return '—';
                  if (typeof v === 'number') return formatNum(v, 2);
                  const str = String(v);
                  const sev = str.includes('CUMPLE') && !str.includes('NO') ? 'success'
                    : str.includes('NO_CUMPLE') || str.includes('No cumple') ? 'danger'
                    : str === 'coherente' ? 'success'
                    : null;
                  return sev ? <Tag value={str.replace(/_/g, ' ')} severity={sev} /> : str;
                }} align="center" />
              ))}
            </DataTable>
          );
        })()}
      </div>

      {/* Section 5: Costos */}
      {Object.keys(costosMap).length > 0 && (
        <div className="card mb-3">
          <h5 className="mb-2">Costos</h5>
          {(() => {
            const rows = [
              { campo: "Costo materiales", vals: designs.map(d => costosMap[d.id]?.totalMateriales) },
              { campo: "Costo con flete", vals: designs.map(d => costosMap[d.id]?.totalConFlete) },
            ];
            return (
              <DataTable responsiveLayout="scroll" value={rows} size="small" stripedRows showGridlines>
                <Column field="campo" header="" style={{ width: "180px", fontWeight: "bold" }} />
                {designs.map((_, i) => (
                  <Column key={i} header={labels[i]} body={(row) => formatCurrency(row.vals[i])} align="right" />
                ))}
                {designs.length === 2 && (
                  <>
                    <Column header={"\u0394"} body={(row) => {
                      const d = delta(row.vals[0], row.vals[1], 0);
                      return d.abs === "-" ? "-" : <span className={d.cls}>{formatCurrency(row.vals[1] - row.vals[0])}</span>;
                    }} align="right" />
                    <Column header={"\u0394%"} body={(row) => {
                      const d = delta(row.vals[0], row.vals[1], 0);
                      return d.pct === "-" ? "-" : <span className={d.cls}>{d.pct}</span>;
                    }} align="right" />
                  </>
                )}
              </DataTable>
            );
          })()}
        </div>
      )}

      {/* Section 6: Production results */}
      {Object.keys(produccionMap).length > 0 && (
        <div className="card mb-3">
          <h5 className="mb-2">Resultados de producción</h5>
          {(() => {
            const rows = [
              { campo: "Muestras", vals: designs.map(d => produccionMap[d.id]?.muestras ?? "-") },
              { campo: "f'cm real (MPa)", vals: designs.map(d => produccionMap[d.id]?.fcm != null ? formatNum(produccionMap[d.id].fcm, 2) : "-") },
              { campo: "f'ck real (MPa)", vals: designs.map(d => produccionMap[d.id]?.fck != null ? formatNum(produccionMap[d.id].fck, 2) : "-") },
              { campo: "Cumple", vals: designs.map(d => {
                const prod = produccionMap[d.id];
                if (!prod || prod.fck == null) return "-";
                const objetivo = (d.parametrosObjetivoJson || {}).resistenciaMpa || 0;
                return prod.fck >= objetivo ? "Sí" : "No";
              })},
            ];
            return (
              <DataTable responsiveLayout="scroll" value={rows} size="small" stripedRows showGridlines>
                <Column field="campo" header="" style={{ width: "140px", fontWeight: "bold" }} />
                {designs.map((_, i) => (
                  <Column key={i} header={labels[i]} body={(row) => {
                    const val = row.vals[i];
                    if (row.campo === "Cumple") {
                      return val === "Sí" ? <Tag value="Sí" severity="success" /> : val === "No" ? <Tag value="No" severity="danger" /> : "-";
                    }
                    return val;
                  }} />
                ))}
              </DataTable>
            );
          })()}
        </div>
      )}

      {/* Section 7: Radar chart */}
      {radarData && (
        <div className="card mb-3">
          <h5 className="mb-2">Gráfico radar comparativo</h5>
          <div style={{ width: "100%", maxWidth: "500px", height: "clamp(240px, 50vh, 350px)", margin: "0 auto" }}>
            <Chart type="radar" data={radarData} options={radarOptions} style={{ width: "100%", height: "100%" }} />
          </div>
          <small className="text-color-secondary block mt-2" style={{ fontSize: "0.72rem", lineHeight: 1.4 }}>
            Índice visual cualitativo (NO normativo). Los ejes están normalizados con rangos de referencia
            empíricos para hormigones convencionales — útil para comparar diseños entre sí, no para evaluar
            cumplimiento normativo. Ver verificaciones CIRSOC en el informe individual de cada diseño.
          </small>
        </div>
      )}

      {/* Conclusiones */}
      {conclusiones.length > 0 && (
        <div className="card mb-3">
          <h5 className="mb-2">Conclusiones</h5>
          <ol className="pl-4">
            {conclusiones.map((c, i) => (
              <li key={i} className="mb-2 text-sm">{c}</li>
            ))}
          </ol>
          <p className="text-xs text-color-secondary mt-2 mb-0">
            Las conclusiones son factuales y no constituyen una recomendación.
          </p>
        </div>
      )}
    </div>
  );
}
