import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { TabView, TabPanel } from "primereact/tabview";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
  getAireEsperado,
  getDurabilidadExposicion,
  getAbacoCurvaICPA, createAbacoCurvaICPA, updateAbacoCurvaICPA, deleteAbacoCurvaICPA, restoreAbacoCurvaICPADefaults,
  getAireDurabilidad,
  getPulverulentoMinimo,
  getConsistenciaClases,
  getHormigonParticular,
} from "../../../services/dosificacionDisenoService";
import { Checkbox } from "primereact/checkbox";
import axios from "axios";
import { config } from "../../../config/config";

const FORMA_OPTIONS = [
  { label: "Triturado", value: "TRITURADO" },
  { label: "Canto rodado", value: "CANTO_RODADO" },
];
const FORMA_LABELS = { TRITURADO: "Triturado", CANTO_RODADO: "Canto rodado", MIXTO: "Mixto" };

// Clases normativas CIRSOC 200:2024
const EXPOSICION_LABELS = {
  A1: "A1 — Carbonatación (seco / sumergido)",
  A2: "A2 — Carbonatación (húmedo-seco)",
  A3: "A3 — Carbonatación (mojado-secado)",
  CL1: "CL1 — Cloruros no marinos (húmedo)",
  CL2: "CL2 — Cloruros no marinos (gas Cl₂)",
  M1: "M1 — Marino (>1 km de marea)",
  M2: "M2 — Marino (<1 km de marea)",
  M3: "M3 — Marino (mareas/salpicaduras)",
  C1: "C1 — Congelación sin sales",
  C2: "C2 — Congelación con sales",
  Q1: "Q1 — Ataque químico moderado",
  Q2: "Q2 — Ataque químico fuerte",
  Q3: "Q3 — Ataque químico muy fuerte",
  Q4: "Q4 — Ataque químico muy fuerte (cloacal)",
};

/* ─────────────────────────────────────────────────────────
   Diálogo tabla de agua base: asentamiento (cm) + MF + forma → agua base (entero)
───────────────────────────────────────────────────────── */
const MF_ANCHOR_OPTIONS = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5].map(v => ({
  label: `MF ${v.toFixed(1)}`,
  value: v,
}));

const FORMA_ABACO_OPTIONS = [
  { label: "Canto rodado (base)", value: "CANTO_RODADO" },
  { label: "Mixto (base × 1.05)", value: "MIXTO" },
  { label: "Triturado (base × 1.10)", value: "TRITURADO" },
];

function AbacoCurvaICPADialog({ visible, onHide, onSave, initial, defaultForma }) {
  const makeEmpty = () => ({
    asentamientoCm: null,
    formaAgregado: defaultForma || "CANTO_RODADO",
    moduloFinura: null,
    aguaBaseLM3: null,
    notas: "",
  });

  const [form, setForm] = useState(makeEmpty());

  useEffect(() => {
    setForm(initial?.id ? {
      ...makeEmpty(),
      id: initial.id,
      asentamientoCm: initial.asentamientoCm ?? null,
      formaAgregado: initial.formaAgregado ?? defaultForma ?? "CANTO_RODADO",
      moduloFinura: initial.moduloFinura != null ? Number(initial.moduloFinura) : null,
      aguaBaseLM3: initial.aguaBaseLM3 != null ? Math.round(Number(initial.aguaBaseLM3)) : null,
      notas: initial.notas ?? "",
    } : {
      ...makeEmpty(),
      asentamientoCm: initial?.asentamientoCm ?? null,
      formaAgregado: initial?.formaAgregado ?? defaultForma ?? "CANTO_RODADO",
      moduloFinura: initial?.moduloFinura != null ? Number(initial.moduloFinura) : null,
    });
  }, [initial, visible, defaultForma]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const valid = form.asentamientoCm >= 4 && form.asentamientoCm <= 20
    && form.moduloFinura != null && form.aguaBaseLM3 != null && form.formaAgregado;

  const handleSave = () => onSave({ ...form, aguaBaseLM3: Math.round(Number(form.aguaBaseLM3)) });

  return (
    <Dialog header={form.id ? "Editar punto — Ábaco 1" : "Nuevo punto — Ábaco 1"} visible={visible} onHide={onHide} style={{ width: "90vw", maxWidth: "460px" }} modal>
      <div className="flex flex-column gap-3 pt-2">
        <div className="flex gap-3">
          <div className="flex flex-column gap-1 flex-1">
            <small>Forma del agregado *</small>
            <Dropdown value={form.formaAgregado} onChange={e => set("formaAgregado", e.value)}
              options={FORMA_ABACO_OPTIONS} className="w-full" />
          </div>
          <div className="flex flex-column gap-1 flex-1">
            <small>Módulo de finura (MF) *</small>
            <Dropdown value={form.moduloFinura} onChange={e => set("moduloFinura", e.value)}
              options={MF_ANCHOR_OPTIONS} className="w-full" placeholder="Seleccionar MF" />
          </div>
        </div>
        <div className="flex flex-column gap-1">
          <small>Asentamiento (cm) * — rango 4–20</small>
          <InputNumber value={form.asentamientoCm} onValueChange={e => set("asentamientoCm", e.value)}
            min={4} max={20} minFractionDigits={0} maxFractionDigits={0} showButtons />
        </div>
        <div className="flex flex-column gap-1">
          <small>Agua base (L/m³) * — entero</small>
          <InputNumber value={form.aguaBaseLM3} onValueChange={e => set("aguaBaseLM3", e.value)}
            minFractionDigits={0} maxFractionDigits={0} min={100} max={400} />
        </div>
        <div className="flex flex-column gap-1">
          <small>Notas</small>
          <InputText value={form.notas} onChange={e => set("notas", e.target.value)} />
        </div>
        <div className="flex justify-content-end gap-2 mt-2">
          <Button label="Cancelar" outlined size="small" onClick={onHide} />
          <Button label="Guardar" size="small" icon="fa-solid fa-check" disabled={!valid} onClick={handleSave} />
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Tabla de agua base — 3 vistas de matriz por forma
   CANTO_RODADO (base) · MIXTO (×1.05) · TRITURADO (×1.10)
───────────────────────────────────────────────────────── */
const MF_ANCHORS_DISPLAY = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];
const ASENTAMIENTOS = Array.from({ length: 17 }, (_, i) => i + 4); // 4..20

const FORMAS_ABACO = [
  { label: "Canto rodado", sublabel: "base", value: "CANTO_RODADO", color: "var(--blue-600)" },
  { label: "Mixto", sublabel: "base × 1.05", value: "MIXTO", color: "var(--orange-600)" },
  { label: "Triturado", sublabel: "base × 1.10", value: "TRITURADO", color: "var(--red-600)" },
];

function MatrizAbaco({ rows, formaActiva, onEditCell, onAddCell }) {
  const lookup = useMemo(() => {
    const m = {};
    rows.filter(r => r.formaAgregado === formaActiva).forEach(r => {
      const as = Number(r.asentamientoCm);
      const mfKey = Number(r.moduloFinura).toFixed(1);
      if (!m[as]) m[as] = {};
      m[as][mfKey] = r;
    });
    return m;
  }, [rows, formaActiva]);

  const formaInfo = FORMAS_ABACO.find(f => f.value === formaActiva);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ background: "var(--surface-100)" }}>
            <th style={{ padding: "6px 12px", border: "1px solid var(--surface-300)", textAlign: "center", fontWeight: 600, minWidth: "90px" }}>
              Asentamiento
            </th>
            {MF_ANCHORS_DISPLAY.map(mf => (
              <th key={mf} style={{ padding: "6px 10px", border: "1px solid var(--surface-300)", textAlign: "center", fontWeight: 600, minWidth: "68px", color: formaInfo?.color }}>
                MF {mf.toFixed(1)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ASENTAMIENTOS.map((as, idx) => (
            <tr key={as} style={{ background: idx % 2 === 0 ? "var(--surface-0)" : "var(--surface-50)" }}>
              <td style={{ padding: "5px 12px", border: "1px solid var(--surface-200)", textAlign: "center", fontWeight: 600, color: "var(--text-color-secondary)" }}>
                {as} cm
              </td>
              {MF_ANCHORS_DISPLAY.map(mf => {
                const row = lookup[as]?.[mf.toFixed(1)];
                return (
                  <td key={mf} style={{ padding: "4px 8px", border: "1px solid var(--surface-200)", textAlign: "center" }}>
                    {row ? (
                      <span
                        title="Click para editar"
                        style={{ cursor: "pointer", color: formaInfo?.color ?? "var(--primary-color)", fontWeight: 500 }}
                        onClick={() => onEditCell(row)}
                      >
                        {Math.round(Number(row.aguaBaseLM3))}
                      </span>
                    ) : (
                      <span
                        title="Sin dato — click para agregar"
                        style={{ cursor: "pointer", color: "var(--text-color-secondary)", fontSize: "0.75rem" }}
                        onClick={() => onAddCell(as, mf)}
                      >
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-color-secondary mt-2">
        Valores en L/m³ (enteros). Click sobre cualquier celda para editar.
      </p>
    </div>
  );
}

function TabAguaICPA() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formaActiva, setFormaActiva] = useState("CANTO_RODADO");
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await getAbacoCurvaICPA()); }
    catch { showToast("error", "No se pudo cargar el Ábaco 1"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    try {
      if (form.id) await updateAbacoCurvaICPA(form.id, form);
      else await createAbacoCurvaICPA(form);
      showToast("success", "Punto guardado");
      setDialogVisible(false);
      load();
    } catch (e) { showToast("error", e?.response?.data?.error || "Error al guardar"); }
  };

  const openEdit = (row) => { setEditing(row); setDialogVisible(true); };
  const openAdd = (asCm, mf) => { setEditing({ asentamientoCm: asCm, moduloFinura: mf, formaAgregado: formaActiva }); setDialogVisible(true); };

  const handleRestore = () => {
    confirmDialog({
      message: "¿Restaurar los valores de referencia originales del Ábaco 1? Esta acción reemplaza TODOS los puntos cargados (incluyendo cambios y agregados manuales) por la referencia general publicada. La operación no es reversible.",
      header: "Restaurar valores de referencia",
      icon: "fa-solid fa-triangle-exclamation",
      acceptLabel: "Restaurar",
      rejectLabel: "Cancelar",
      acceptClassName: "p-button-warning",
      accept: async () => {
        try {
          const r = await restoreAbacoCurvaICPADefaults();
          showToast("success", `Ábaco restaurado (${r.restored ?? 408} puntos).`);
          load();
        } catch (e) { showToast("error", e?.response?.data?.error || "Error al restaurar"); }
      },
    });
  };

  const formaInfo = FORMAS_ABACO.find(f => f.value === formaActiva);
  const countForma = rows.filter(r => r.formaAgregado === formaActiva).length;

  return (
    <>
      {/* ── Selector de forma ── */}
      <div className="flex justify-content-between align-items-start mb-3">
        <div>
          <p className="text-sm text-color-secondary m-0">
            Tabla de agua base — Motor HormiQual. Agua de mezclado (L/m³) en función de <strong>asentamiento (cm)</strong>, <strong>módulo de finura (MF)</strong> y <strong>forma del agregado</strong>.
            <br /><small className="text-xs">Fuente de referencia: Ábaco 1 de diseño de mezclas (curva de referencia general). Editable según experiencia local; el botón "Restaurar valores de referencia" pisa la tabla con la referencia original.</small>
          </p>
        </div>
        <div className="flex gap-2">
          <Button label="Restaurar valores de referencia" icon="fa-solid fa-rotate-left" size="small" outlined severity="warning"
            onClick={handleRestore} />
          <Button label="Nuevo punto" icon="fa-solid fa-plus" size="small"
            onClick={() => { setEditing({ formaAgregado: formaActiva }); setDialogVisible(true); }} />
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {FORMAS_ABACO.map(f => (
          <button
            key={f.value}
            onClick={() => setFormaActiva(f.value)}
            style={{
              padding: "6px 16px",
              border: `2px solid ${f.color}`,
              borderRadius: "6px",
              background: formaActiva === f.value ? f.color : "transparent",
              color: formaActiva === f.value ? "#fff" : f.color,
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
              transition: "all 0.15s",
            }}
          >
            {f.label}
            <span style={{ fontWeight: 400, fontSize: "0.75rem", marginLeft: "6px", opacity: 0.85 }}>
              ({f.sublabel})
            </span>
          </button>
        ))}
        <span className="text-xs text-color-secondary align-self-center ml-2">
          {countForma} puntos cargados
        </span>
      </div>

      {loading ? (
        <div className="flex justify-content-center py-5">
          <i className="fa-solid fa-spinner fa-spin text-2xl text-color-secondary" />
        </div>
      ) : (
        <MatrizAbaco
          rows={rows}
          formaActiva={formaActiva}
          onEditCell={openEdit}
          onAddCell={openAdd}
        />
      )}

      <AbacoCurvaICPADialog
        visible={dialogVisible}
        onHide={() => setDialogVisible(false)}
        onSave={handleSave}
        initial={editing}
        defaultForma={formaActiva}
      />
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Aire esperado
───────────────────────────────────────────────────────── */
function TabAireEsperado() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAireEsperado()
      .then(setRows)
      .catch(() => showToast("error", "No se pudo cargar el aire esperado"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="mb-3">
        <p className="text-sm text-color-secondary m-0 mb-1">
          Aire atrapado esperado según tamaño máximo nominal del agregado (TMN).
        </p>
        <p className="text-xs text-color-secondary m-0 line-height-3">
          Estos valores representan el aire que queda naturalmente atrapado en la mezcla por el proceso de mezclado, <strong>SIN incorporación intencional de aire</strong>.
          <br />Cuando se requiere aire intencionalmente incorporado (clases de exposición C1 o C2), los requisitos de aire <strong>total</strong> están en la pestaña "Aire C1/C2 (T.4.3)".
          <br /><em>Fuente de referencia: ACI Committee 211, adaptado.</em> Todos los valores son editables.
        </p>
      </div>
      <DataTable responsiveLayout="scroll" value={rows} loading={loading} size="small" stripedRows emptyMessage="Sin datos">
        <Column field="tmnMm" header="TMN (mm)" sortable />
        <Column field="aireBasePct" header="Aire atrapado esperado (%)" body={r => `${Number(r.aireBasePct).toFixed(1)} %`} />
        <Column field="notas" header="Notas" body={r => r.notas || "—"} />
      </DataTable>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Durabilidad / Exposición  (CIRSOC 200:2024)
───────────────────────────────────────────────────────── */

// Grupos en orden normativo con acento de color que funciona en light y dark mode.
// Se usa rgba para que el fondo de encabezado sea semi-transparente sobre la
// superficie del tema (var(--surface-card)) sin hardcodear ningún fondo.
const GRUPO_META = [
  { label: "Carbonatación",          icon: "fa-solid fa-cloud-sun",  accent: "#3b82f6" },
  { label: "Cloruros no marinos",    icon: "fa-solid fa-droplet",    accent: "#eab308" },
  { label: "Marino",                 icon: "fa-solid fa-water",      accent: "#10b981" },
  { label: "Congelación y deshielo", icon: "fa-solid fa-snowflake",  accent: "#8b5cf6" },
  { label: "Ataque químico",         icon: "fa-solid fa-flask-vial", accent: "#ef4444" },
];

// Estilos reutilizables para th (usamos función para mantener pureza)
const thBase = (extra = {}) => ({
  padding: "0.4rem 0.55rem",
  fontWeight: 600,
  fontSize: "0.7rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-color-secondary)",
  textAlign: "left",
  whiteSpace: "nowrap",
  background: "var(--surface-section, var(--surface-50))",
  borderBottom: "2px solid var(--surface-border)",
  ...extra,
});

const tdBase = (extra = {}) => ({
  padding: "0.5rem 0.55rem",
  fontSize: "0.83rem",
  color: "var(--text-color)",
  borderBottom: "1px solid var(--surface-border)",
  verticalAlign: "middle",
  ...extra,
});

const DIVIDER = { borderLeft: "1px solid var(--surface-border)" };

function DurabilidadTable({ rows }) {
  const grouped = GRUPO_META
    .map(g => ({ ...g, clases: rows.filter(r => r.grupo === g.label) }))
    .filter(g => g.clases.length > 0);

  if (grouped.length === 0) return (
    <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-color-secondary)", fontSize: "0.85rem" }}>
      Sin datos — ejecute la migración 20260314
    </div>
  );

  const fmtAC = v => v != null
    ? <span style={{ fontFamily: "monospace", fontSize: "0.84rem" }}>{Number(v).toFixed(2)}</span>
    : <span style={{ color: "var(--text-color-secondary)", opacity: 0.4, fontFamily: "monospace" }}>—</span>;

  const fmtFC = v => v != null
    ? <span style={{ fontFamily: "monospace", fontSize: "0.84rem" }}>{Number(v)}</span>
    : <span style={{ color: "var(--text-color-secondary)", opacity: 0.4, fontFamily: "monospace" }}>—</span>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>

        {/* Colgroup para anchos fijos */}
        <colgroup>
          <col style={{ width: "66px" }} />  {/* Código */}
          <col />                              {/* Descripción */}
          <col style={{ width: "54px" }} />  {/* a/c S */}
          <col style={{ width: "54px" }} />  {/* a/c A */}
          <col style={{ width: "54px" }} />  {/* a/c P */}
          <col style={{ width: "62px" }} />  {/* f'c S */}
          <col style={{ width: "62px" }} />  {/* f'c A */}
          <col style={{ width: "62px" }} />  {/* f'c P */}
          <col style={{ width: "44px" }} />  {/* Aire */}
          <col style={{ width: "44px" }} />  {/* Prot */}
        </colgroup>

        <thead>
          {/* Fila 1 — nombres de grupo de columnas */}
          <tr>
            <th style={thBase({ textAlign: "center" })}>Código</th>
            <th style={thBase()}>Descripción</th>
            <th colSpan={3} style={thBase({ textAlign: "center", ...DIVIDER })}>a/c máxima</th>
            <th colSpan={3} style={thBase({ textAlign: "center", ...DIVIDER })}>f'c mín. (MPa)</th>
            <th style={thBase({ textAlign: "center", ...DIVIDER, padding: "0.4rem 0.2rem" })}>
              <i className="fa-solid fa-wind" title="Requiere aire incorporado (Tabla 4.3 CIRSOC 200:2024)" style={{ fontSize: "0.85rem" }} />
            </th>
            <th style={thBase({ textAlign: "center", padding: "0.4rem 0.2rem" })}>
              <i className="fa-solid fa-shield-halved" title="Requiere protección superficial" style={{ fontSize: "0.85rem" }} />
            </th>
          </tr>
          {/* Fila 2 — etiquetas S / A / P */}
          <tr>
            <th style={thBase({ textAlign: "center", paddingTop: 0, borderBottom: "2px solid var(--surface-border)" })}></th>
            <th style={thBase({ paddingTop: 0, borderBottom: "2px solid var(--surface-border)" })}></th>
            {["S", "A", "P"].map((t, i) => (
              <th key={t} style={thBase({
                textAlign: "center", paddingTop: 0,
                borderBottom: "2px solid var(--surface-border)",
                ...(i === 0 ? DIVIDER : {}),
              })}>{t}</th>
            ))}
            {["S", "A", "P"].map((t, i) => (
              <th key={t} style={thBase({
                textAlign: "center", paddingTop: 0,
                borderBottom: "2px solid var(--surface-border)",
                ...(i === 0 ? DIVIDER : {}),
              })}>{t}</th>
            ))}
            <th style={thBase({ paddingTop: 0, borderBottom: "2px solid var(--surface-border)", ...DIVIDER })}></th>
            <th style={thBase({ paddingTop: 0, borderBottom: "2px solid var(--surface-border)" })}></th>
          </tr>
        </thead>

        <tbody>
          {grouped.map(g => {
            const accentRgba = `${g.accent}1a`; // ~10% opacity
            const accentBorder = `${g.accent}55`; // ~33% opacity

            return (
              <React.Fragment key={g.label}>

                {/* ── Encabezado de grupo ─────────────────────────────── */}
                <tr>
                  <td colSpan={10} style={{
                    padding: "0.45rem 0.85rem",
                    background: accentRgba,
                    borderLeft: `3px solid ${g.accent}`,
                    borderTop: "1px solid var(--surface-border)",
                    borderBottom: "1px solid var(--surface-border)",
                    fontWeight: 700,
                    fontSize: "0.72rem",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: g.accent,
                  }}>
                    <i className={`${g.icon} mr-2`} style={{ opacity: 0.9 }} />
                    {g.label}
                    <span style={{ marginLeft: "0.6rem", fontWeight: 400, fontSize: "0.68rem", opacity: 0.65 }}>
                      {g.clases.length} clase{g.clases.length !== 1 ? "s" : ""}
                    </span>
                  </td>
                </tr>

                {/* ── Filas de datos ──────────────────────────────────── */}
                {g.clases.map((row, idx) => (
                  <tr
                    key={row.codigo}
                    style={{ background: idx % 2 === 1 ? "rgba(128,128,128,0.04)" : "transparent" }}
                  >
                    {/* Código — badge con acento del grupo */}
                    <td style={tdBase({ textAlign: "center", padding: "0.45rem 0.4rem" })}>
                      <span style={{
                        display: "inline-block",
                        background: accentRgba,
                        color: g.accent,
                        border: `1px solid ${accentBorder}`,
                        borderRadius: "4px",
                        padding: "0.1rem 0.4rem",
                        fontWeight: 700,
                        fontFamily: "monospace",
                        fontSize: "0.82rem",
                        letterSpacing: "0.04em",
                        whiteSpace: "nowrap",
                      }}>
                        {row.codigo}
                      </span>
                    </td>

                    {/* Descripción */}
                    <td style={tdBase({ paddingLeft: "0.75rem", lineHeight: 1.35 })}>
                      {row.descripcionCorta}
                    </td>

                    {/* a/c S, A, P */}
                    {[row.acMaxSimple, row.acMaxArmado, row.acMaxPretensado].map((v, i) => (
                      <td key={i} style={tdBase({
                        textAlign: "center",
                        padding: "0.5rem 0.25rem",
                        ...(i === 0 ? DIVIDER : {}),
                      })}>
                        {fmtAC(v)}
                      </td>
                    ))}

                    {/* f'c S, A, P */}
                    {[row.fcminSimple, row.fcminArmado, row.fcminPretensado].map((v, i) => (
                      <td key={i} style={tdBase({
                        textAlign: "center",
                        padding: "0.5rem 0.25rem",
                        ...(i === 0 ? DIVIDER : {}),
                      })}>
                        {fmtFC(v)}
                      </td>
                    ))}

                    {/* Aire T4.3 */}
                    <td style={tdBase({ textAlign: "center", padding: "0.5rem 0.2rem", ...DIVIDER })}>
                      {row.requiereAireTabla43
                        ? <span title={`Requiere aire incorporado según Tabla 4.3 (CIRSOC 200:2024).\nClase ${row.codigo}: congelación ${row.codigo === 'C2' ? 'CON' : 'SIN'} sales descongelantes.\nTambién aplica a hormigón colocado bajo agua.\nExcepción Art. 4.1.2.4: reducción de 1% para ≥ H-35.`} style={{ color: "#eab308", fontSize: "1rem", cursor: "help" }}>●</span>
                        : <span style={{ color: "var(--text-color-secondary)", opacity: 0.25 }}>–</span>}
                    </td>

                    {/* Prot. Sup. */}
                    <td style={tdBase({ textAlign: "center", padding: "0.5rem 0.2rem" })}>
                      {row.requiereProteccionSuperficial
                        ? <span title="Requiere protección superficial adicional" style={{ color: "#ef4444", fontSize: "1rem" }}>●</span>
                        : <span style={{ color: "var(--text-color-secondary)", opacity: 0.25 }}>–</span>}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TabDurabilidad() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getDurabilidadExposicion()
      .then(setRows)
      .catch(() => showToast("error", "No se pudo cargar la tabla de durabilidad"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{
      border: "1px solid var(--surface-border)",
      borderRadius: "8px",
      overflow: "hidden",
    }}>
      {/* Cabecera de sección */}
      <div style={{
        padding: "0.65rem 1rem",
        borderBottom: "1px solid var(--surface-border)",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        justifyContent: "space-between",
        alignItems: "center",
        background: "var(--surface-section, var(--surface-50))",
      }}>
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-color-secondary)", lineHeight: 1.5 }}>
          Clases de exposición según{" "}
          <strong style={{ color: "var(--text-color)" }}>CIRSOC 200:2024</strong>.
          {" "}Clases definidas en Tablas 2.1 y 2.2. Requisitos de a/c máxima y f'c mínimo según Tabla 2.5.
          {" "}El indicador <span style={{ color: "#eab308" }}>●</span> señala clases que requieren aire incorporado (ver pestaña "Aire C1/C2").
          {" "}Los valores son requisitos normativos.
        </p>
        <div style={{ display: "flex", gap: "1.1rem", fontSize: "0.74rem", color: "var(--text-color-secondary)", flexShrink: 0, flexWrap: "wrap" }}>
          <span><strong style={{ color: "var(--text-color)" }}>S</strong> Simple</span>
          <span><strong style={{ color: "var(--text-color)" }}>A</strong> Armado</span>
          <span><strong style={{ color: "var(--text-color)" }}>P</strong> Pretensado</span>
          <span style={{ borderLeft: "1px solid var(--surface-border)", paddingLeft: "1.1rem" }}>
            <span style={{ color: "#eab308", marginRight: "0.3rem" }}>●</span>Aire T4.3
          </span>
          <span>
            <span style={{ color: "#ef4444", marginRight: "0.3rem" }}>●</span>Prot. Sup.
          </span>
        </div>
      </div>

      {/* Contenido */}
      {loading
        ? <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-color-secondary)" }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: "1.4rem" }} />
          </div>
        : <DurabilidadTable rows={rows} />
      }
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Aire Durabilidad (Tabla 4.3 CIRSOC 200:2024)
───────────────────────────────────────────────────────── */
function TabAireDurabilidad() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getAireDurabilidad()
      .then(setRows)
      .catch(() => showToast("error", "No se pudo cargar Tabla 4.3"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="mb-3">
        <p className="text-sm text-color-secondary m-0 mb-1">
          Aire total requerido para clases de exposición C1 y C2 — <strong>CIRSOC 200:2024, Tabla 4.3</strong>.
        </p>
        <p className="text-xs text-color-secondary m-0 line-height-3">
          Contenido de aire natural e intencionalmente incorporado al hormigón, en función del tamaño máximo nominal del agregado grueso.
          <br />• <strong>Clase C1:</strong> Congelación y deshielo SIN sales descongelantes. También aplica a hormigón a colocar bajo agua.
          <br />• <strong>Clase C2:</strong> Congelación y deshielo CON sales descongelantes.
          <br /><em>Excepción (Art. 4.1.2.4):</em> Para hormigones de clase ≥ H-35, las cantidades pueden reducirse hasta 1 punto porcentual, salvo indicación contraria del pliego.
          <br />Los valores son requisitos normativos y no son editables.
        </p>
      </div>
      <DataTable responsiveLayout="scroll" value={rows} loading={loading} size="small" stripedRows emptyMessage="Sin datos">
        <Column field="tmnMm" header="TMN (mm)" sortable body={r => Number(r.tmnMm).toFixed(1)} />
        <Column field="claseExposicion" header="Clase" sortable body={r => <Tag value={r.claseExposicion === "C1" ? "C1 y horm. bajo agua" : r.claseExposicion} severity={r.claseExposicion === "C2" ? "danger" : "warning"} />} />
        <Column field="aireTotalPct" header="Aire total (% vol.)" body={r => `${Number(r.aireTotalPct).toFixed(1)} %`} />
        <Column field="toleranciaPct" header="Tolerancia (±%)" body={r => `± ${Number(r.toleranciaPct).toFixed(1)} %`} />
      </DataTable>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Pulverulento Mínimo (Tabla 4.4 CIRSOC 200:2024)
───────────────────────────────────────────────────────── */
function TabPulverulentoMinimo() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getPulverulentoMinimo()
      .then(setRows)
      .catch(() => showToast("error", "No se pudo cargar Tabla 4.4"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="mb-3">
        <p className="text-sm text-color-secondary m-0 mb-1">
          Material pulverulento mínimo pasante 300 µm por TMN — <strong>CIRSOC 200:2024 Tabla 4.4, Art. 4.1.3</strong>.
        </p>
        <p className="text-xs text-color-secondary m-0 line-height-3">
          Los valores son requisitos normativos y no son editables.
        </p>
      </div>
      <DataTable responsiveLayout="scroll" value={rows} loading={loading} size="small" stripedRows emptyMessage="Sin datos">
        <Column field="tmnMm" header="TMN (mm)" sortable body={r => Number(r.tmnMm).toFixed(1)} />
        <Column field="minimoKgM3" header="Mínimo (kg/m³)" body={r => `${r.minimoKgM3} kg/m³`} />
      </DataTable>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Consistencia — Tablas 4.1/4.2 CIRSOC 200:2024
───────────────────────────────────────────────────────── */
const METODO_DEFECTO_OPTIONS = [
  { label: "Asentamiento", value: "asentamiento" },
  { label: "Remoldeo", value: "remoldeo" },
  { label: "Extendido", value: "extendido" },
];

const EMPTY_CONSISTENCIA = {
  codigo: "", nombre: "", orden: 0,
  permiteRemoldeo: false, permiteAsentamiento: true, permiteExtendido: false,
  metodoDefecto: "asentamiento",
  remoldeoMin: null, remoldeoMax: null, remoldeoTolerancia: null,
  asentamientoMin: null, asentamientoMax: null, asentamientoTolerancia: null,
  extendidoMin: null, extendidoMax: null, extendidoTolerancia: null,
  requiereSuperplastificante: false,
  recomiendaFluidificante: false,
};

function TabConsistencia() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getConsistenciaClases()
      .then((d) => setRows(Array.isArray(d) ? d.sort((a, b) => (a.orden || 0) - (b.orden || 0)) : []))
      .catch(() => showToast("error", "Error cargando clases de consistencia"))
      .finally(() => setLoading(false));
  }, [showToast]);

  const fmtRange = (min, max, unit) => {
    if (min == null && max == null) return "—";
    return `${min ?? "?"} – ${max ?? "?"} ${unit}`;
  };

  return (
    <>
      <Message severity="info" text="Clases de consistencia según Tablas 4.1 y 4.2 de CIRSOC 200:2024. Valores normativos, no editables." className="mb-2 w-full" />
      <DataTable responsiveLayout="scroll" value={rows} loading={loading} size="small" stripedRows sortField="orden" sortOrder={1}>
        <Column field="orden" header="#" style={{ width: '3rem' }} sortable />
        <Column field="codigo" header="Código" sortable />
        <Column field="nombre" header="Nombre" sortable />
        <Column header="Remoldeo (s)" body={(r) => r.permiteRemoldeo ? fmtRange(r.remoldeoMin, r.remoldeoMax, "s") : "—"} />
        <Column header="Asentamiento (cm)" body={(r) => r.permiteAsentamiento ? fmtRange(r.asentamientoMin, r.asentamientoMax, "cm") : "—"} />
        <Column header="Extendido (cm)" body={(r) => r.permiteExtendido ? fmtRange(r.extendidoMin, r.extendidoMax, "cm") : "—"} />
        <Column header="Aditivo" body={(r) => r.requiereSuperplastificante ? <Tag severity="danger" value="Obligatorio" /> : r.recomiendaFluidificante ? <Tag severity="info" value="Recomendado" /> : "—"} style={{ width: '8rem' }} />
      </DataTable>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab Hormigones con características particulares — Tabla 9.3
───────────────────────────────────────────────────────── */
const HP_TIPOS = [
  { label: "Hormigón a colocar bajo agua", value: "BAJO_AGUA" },
  { label: "Hormigón de elevada impermeabilidad", value: "IMPERMEABILIDAD" },
  { label: "Hormigón expuesto a abrasión", value: "ABRASION" },
];
const HP_CLASES = [{ label: "I", value: "I" }, { label: "II", value: "II" }, { label: "III", value: "III" }, { label: "IV", value: "IV" }];
const HP_AIRE = [
  { label: "Opcional", value: "OPCIONAL" },
  { label: "No (no se admite aire incorporado)", value: "NO" },
  { label: "Requerido", value: "REQUERIDO" },
];
const HP_CONSIST = [
  { label: "Seca", value: "SECA" },
  { label: "Plástica", value: "PLASTICA" },
  { label: "Muy plástica", value: "MUY_PLASTICA" },
  { label: "Fluida", value: "FLUIDA" },
  { label: "Muy fluida", value: "MUY_FLUIDA" },
];

function TabHormigonParticular() {
  const showToast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getHormigonParticular()
      .then(setRows)
      .catch(() => showToast("error", "No se pudo cargar Tabla 9.3"))
      .finally(() => setLoading(false));
  }, [showToast]);

  const tipoLabel = (v) => HP_TIPOS.find(t => t.value === v)?.label || v;
  const fmtEspesor = (r) => {
    if (r.espesorMmMin == null && r.espesorMmMax == null) return "—";
    if (r.espesorMmMin == null) return `≤ ${r.espesorMmMax} mm`;
    if (r.espesorMmMax == null) return `> ${r.espesorMmMin - 1} mm`;
    return `${r.espesorMmMin}–${r.espesorMmMax} mm`;
  };
  const fmtConsist = (cp) => {
    let arr = cp;
    if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { arr = []; } }
    if (!Array.isArray(arr) || arr.length === 0) return "—";
    return arr.map(c => HP_CONSIST.find(o => o.value === c)?.label || c).join(", ");
  };

  return (
    <>
      <Message severity="info" text="Hormigones con características particulares — CIRSOC 200:2024 Tabla 9.3. Complementa a la Tabla 2.5 (clases de exposición) con requisitos propios de bajo agua, impermeabilidad y abrasión. Valores normativos, no editables." className="mb-2 w-full" />
      <DataTable responsiveLayout="scroll" value={rows} loading={loading} size="small" stripedRows emptyMessage="Sin datos" rowGroupMode="subheader" groupRowsBy="tipoHormigon" sortField="tipoHormigon" sortOrder={1}
        rowGroupHeaderTemplate={(r) => <span className="font-bold">{tipoLabel(r.tipoHormigon)}</span>}>
        <Column field="clase" header="Clase" style={{ width: "6%" }} />
        <Column header="Descripción" body={(r) => r.casoTipico || "—"} style={{ width: "18%" }} />
        <Column header="Espesor" body={fmtEspesor} style={{ width: "10%" }} />
        <Column field="acMax" header="a/c máx" body={r => Number(r.acMax).toFixed(2)} style={{ width: "7%" }} />
        <Column field="claseMinima" header="Clase mín" style={{ width: "8%" }} />
        <Column field="aireIncorporado" header="Aire" body={r => HP_AIRE.find(o => o.value === r.aireIncorporado)?.label || r.aireIncorporado} style={{ width: "10%" }} />
        <Column header="Consistencia" body={r => fmtConsist(r.consistenciaPermitida)} style={{ width: "15%" }} />
        <Column field="penetracionAguaMaxMm" header="Pen. agua (mm)" body={r => r.penetracionAguaMaxMm ?? "—"} style={{ width: "8%" }} />
        <Column field="tmnMaxMm" header="TMN máx" body={r => r.tmnMaxMm != null ? `${r.tmnMaxMm} mm` : "—"} style={{ width: "7%" }} />
        <Column field="tmnMaxFraccionEspesor" header="TMN / esp." body={r => r.tmnMaxFraccionEspesor != null ? `≤ ${Math.round(r.tmnMaxFraccionEspesor * 1000) / 1000} e` : "—"} style={{ width: "8%" }} />
        <Column field="desgasteLAMaxPct" header="Los Ángeles" body={r => r.desgasteLAMaxPct != null ? `≤ ${r.desgasteLAMaxPct}%` : "—"} style={{ width: "8%" }} />
      </DataTable>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   Tab: Calibración HRDC por planta
   ─────────────────────────────────────────────────────────
   Antes este formulario vivía en Administrar → Plantas (form general de
   planta). Es calibración del MOTOR de dosificación, no datos generales de
   la planta → se reubicó acá. Los datos siguen viviendo en columnas
   `Planta.rdc*`; este tab los edita vía `PUT /api/plantas/:id/calibracion-hrdc`. */
function TabHRDCCalibracion() {
  const showToast = useToast();
  const [plantas, setPlantas] = useState([]);
  const [idPlanta, setIdPlanta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form, setForm] = useState({
    rdcModoDensidad: "REDUCCION_PCT",
    rdcReduccionPct: null,
    rdcPuvObjetivoKgM3: null,
    rdcPuvToleranciaKgM3: null,
    rdcFactorAguaConsistencia: null,
  });

  // Carga inicial: lista de plantas.
  useEffect(() => {
    axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers })
      .then(({ data }) => {
        const lista = Array.isArray(data) ? data : [];
        setPlantas(lista);
        if (lista.length > 0) setIdPlanta(lista[0].idPlanta);
      })
      .catch((err) => {
        console.error("Error cargando plantas:", err);
        showToast("error", "No se pudieron cargar las plantas");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambiar la planta seleccionada, traer su calibración actual.
  useEffect(() => {
    if (!idPlanta) return;
    setLoading(true);
    axios.get(`${config.backendUrl}/api/plantas/${idPlanta}`, { headers: config.headers })
      .then(({ data }) => {
        setForm({
          rdcModoDensidad: data.rdcModoDensidad || "REDUCCION_PCT",
          rdcReduccionPct: data.rdcReduccionPct != null ? Number(data.rdcReduccionPct) : null,
          rdcPuvObjetivoKgM3: data.rdcPuvObjetivoKgM3 != null ? Number(data.rdcPuvObjetivoKgM3) : null,
          rdcPuvToleranciaKgM3: data.rdcPuvToleranciaKgM3 != null ? Number(data.rdcPuvToleranciaKgM3) : null,
          rdcFactorAguaConsistencia: data.rdcFactorAguaConsistencia != null ? Number(data.rdcFactorAguaConsistencia) : null,
        });
      })
      .catch((err) => {
        console.error("Error cargando calibración HRDC:", err);
        showToast("error", "No se pudo cargar la calibración de la planta");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idPlanta]);

  const guardar = async () => {
    if (savingRef.current) return;
    if (!idPlanta) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await axios.put(
        `${config.backendUrl}/api/plantas/${idPlanta}/calibracion-hrdc`,
        form,
        { headers: config.headers }
      );
      const nombre = plantas.find((p) => p.idPlanta === idPlanta)?.nombre || `#${idPlanta}`;
      showToast("success", `Calibración HRDC actualizada para ${nombre}`);
    } catch (err) {
      console.error(err);
      showToast("error", err?.response?.data?.error || "Error al guardar");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="p-3">
      <Message
        severity="info"
        className="mb-3 w-full"
        text="Parámetros de calibración del motor HRDC (Hormigón de Resistencia y Densidad Controlada), por planta. HRDC es un modelo no normativo, fuera de CIRSOC. Si se dejan vacíos, el motor usa los valores por defecto indicados en cada campo."
      />

      <div className="grid mb-3">
        <div className="col-12 md:col-6 lg:col-4">
          <label className="font-medium block mb-1">Planta</label>
          <Dropdown
            value={idPlanta}
            options={plantas.map((p) => ({ label: p.nombre, value: p.idPlanta }))}
            onChange={(e) => setIdPlanta(e.value)}
            placeholder="Seleccionar planta"
            className="w-full"
            disabled={loading || saving}
          />
        </div>
      </div>

      <div className="grid">
        <div className="col-12 md:col-6 lg:col-3">
          <label className="font-medium block mb-1">Modo de densidad objetivo</label>
          <Dropdown
            value={form.rdcModoDensidad}
            onChange={(e) => setForm((f) => ({ ...f, rdcModoDensidad: e.value }))}
            options={[
              { label: "Reducción % sobre mortero base", value: "REDUCCION_PCT" },
              { label: "PUV objetivo (valor fijo)", value: "PUV_OBJETIVO" },
            ]}
            className="w-full"
            disabled={loading || saving}
          />
          <small className="text-color-secondary">Default: reducción %.</small>
        </div>

        <div className="col-12 sm:col-6 lg:col-3">
          <label className="font-medium block mb-1">Reducción de densidad (%)</label>
          <InputNumber
            value={form.rdcReduccionPct}
            onValueChange={(e) => setForm((f) => ({ ...f, rdcReduccionPct: e.value }))}
            min={0} max={60} minFractionDigits={0} maxFractionDigits={1} suffix=" %"
            disabled={form.rdcModoDensidad !== "REDUCCION_PCT" || loading || saving}
            placeholder="Default 22"
            className="w-full" inputClassName="w-full"
          />
          <small className="text-color-secondary">% respecto del mortero sin aire. Vacío → 22%.</small>
        </div>

        <div className="col-12 sm:col-6 lg:col-3">
          <label className="font-medium block mb-1">PUV objetivo (kg/m³)</label>
          <InputNumber
            value={form.rdcPuvObjetivoKgM3}
            onValueChange={(e) => setForm((f) => ({ ...f, rdcPuvObjetivoKgM3: e.value }))}
            min={800} max={2200} minFractionDigits={0} maxFractionDigits={0} suffix=" kg/m³"
            disabled={form.rdcModoDensidad !== "PUV_OBJETIVO" || loading || saving}
            placeholder="Default 1650"
            className="w-full" inputClassName="w-full"
          />
          <small className="text-color-secondary">Densidad fresca objetivo. Rango habitual 1550–1800.</small>
        </div>

        <div className="col-12 sm:col-6 lg:col-3">
          <label className="font-medium block mb-1">Tolerancia PUV (± kg/m³)</label>
          <InputNumber
            value={form.rdcPuvToleranciaKgM3}
            onValueChange={(e) => setForm((f) => ({ ...f, rdcPuvToleranciaKgM3: e.value }))}
            min={10} max={200} minFractionDigits={0} maxFractionDigits={0} suffix=" kg/m³"
            disabled={loading || saving}
            placeholder="Default 80"
            className="w-full" inputClassName="w-full"
          />
          <small className="text-color-secondary">Control de densidad. Vacío → ±80 kg/m³.</small>
        </div>

        <div className="col-12 sm:col-6 lg:col-3">
          <label className="font-medium block mb-1">Factor agua–consistencia</label>
          <InputNumber
            value={form.rdcFactorAguaConsistencia}
            onValueChange={(e) => setForm((f) => ({ ...f, rdcFactorAguaConsistencia: e.value }))}
            min={0.5} max={1.8} minFractionDigits={2} maxFractionDigits={3}
            disabled={loading || saving}
            placeholder="Default 1,000"
            className="w-full" inputClassName="w-full"
          />
          <small className="text-color-secondary">Calibra el agua que el modelo estima por consistencia (análogo al factor de las curvas de cemento). Vacío → 1,00.</small>
        </div>
      </div>

      <div className="flex justify-content-end mt-3">
        <Button
          label="Guardar calibración"
          icon="fa-solid fa-floppy-disk"
          loading={saving}
          disabled={!idPlanta || loading || saving}
          onClick={guardar}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Página principal
───────────────────────────────────────────────────────── */
export default function ParametrosMotorPage() {
  return (
    <div className="p-3">
      <PageHeader
        title="Motor de diseño HormiQual"
        subtitle="Tablas base y parámetros de referencia del Motor HormiQual 1.0. Las tablas normativas (CIRSOC) son de sólo lectura; el Ábaco 1 de referencia admite edición local con restauración a valores originales."
        icon="fa-solid fa-sliders"
      />
      <TabView className="mt-3">
        <TabPanel header="Tabla de agua base" leftIcon="fa-solid fa-droplet mr-2">
          <TabAguaICPA />
        </TabPanel>
        <TabPanel header="Aire" leftIcon="fa-solid fa-wind mr-2">
          <TabAireEsperado />
        </TabPanel>
        <TabPanel header="Durabilidad" leftIcon="fa-solid fa-shield-halved mr-2">
          <TabDurabilidad />
        </TabPanel>
        <TabPanel header="Aire C1/C2 (T.4.3)" leftIcon="fa-solid fa-snowflake mr-2">
          <TabAireDurabilidad />
        </TabPanel>
        <TabPanel header="Pulverulento (T.4.4)" leftIcon="fa-solid fa-mortar-pestle mr-2">
          <TabPulverulentoMinimo />
        </TabPanel>
        <TabPanel header="Consistencia (T.4.1/4.2)" leftIcon="fa-solid fa-arrows-down-to-line mr-2">
          <TabConsistencia />
        </TabPanel>
        <TabPanel header="Hormigones particulares (T.9.3)" leftIcon="fa-solid fa-hand-holding-droplet mr-2">
          <TabHormigonParticular />
        </TabPanel>
        <TabPanel header="Calibración HRDC por planta" leftIcon="fa-solid fa-fill-drip mr-2">
          <TabHRDCCalibracion />
        </TabPanel>
      </TabView>
    </div>
  );
}
