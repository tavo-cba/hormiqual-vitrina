import React, { useMemo, useState } from "react";
import { SelectButton } from "primereact/selectbutton";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { buildDosificacionTraceSections } from "./dosificacionTraceSections";

// ── Origen badges ─────────────────────────────────────────────────────────────
const ORIGEN_BADGE = {
  INPUT_USUARIO:    { severity: "info",      label: "Usuario" },
  MEZCLA:          { severity: "success",    label: "Mezcla" },
  MATERIAL_CEMENTO:{ severity: "secondary",  label: "Cemento" },
  MATERIAL_ADITIVO:{ severity: "secondary",  label: "Aditivo" },
  CURVA:           { severity: "warning",    label: "Curva" },
  CURVA_CEMENTO:   { severity: "warning",    label: "Curva cemento" },
  TABLA:           { severity: "warning",    label: "Tabla" },
  REGLA:           { severity: "secondary",  label: "Regla" },
  DURABILIDAD:     { severity: "danger",     label: "Durabilidad" },
  PLIEGO:          { severity: "info",       label: "Pliego" },
  DEFAULT:         { severity: "contrast",   label: "Default" },
  CALCULADO:       { severity: "secondary",  label: "Calculado" },
};

// ── Governing restriction severity ────────────────────────────────────────────
const AC_GOBERNANTE_SEVERITY = {
  RESISTENCIA: "success",
  EXPOSICION:  "warn",
  PLIEGO:      "info",
};

const CEMENTO_GOBERNANTE_SEVERITY = {
  CALCULO:    "success",
  PLIEGO:     "warn",
  AMC_PLIEGO: "warn",
};

const VIEW_OPTIONS = [
  { label: "Vista técnica", value: "tecnica" },
  { label: "Debug JSON", value: "debug" },
];

// ── Shared row grid ───────────────────────────────────────────────────────────
function RowGrid({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="grid mt-2">
      {rows.map(([label, value]) => (
        <div key={label} className="col-12 md:col-6 lg:col-4">
          <div className="text-xs text-color-secondary mb-1">{label}</div>
          <div className="font-medium text-sm">{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section card wrapper ──────────────────────────────────────────────────────
function StageCard({ title, icon, children, collapsible = false, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="surface-ground border-round p-3">
      <div
        className="flex align-items-center gap-2 mb-2"
        style={collapsible ? { cursor: "pointer", userSelect: "none" } : undefined}
        onClick={collapsible ? () => setCollapsed((v) => !v) : undefined}
      >
        {icon && <span className="text-lg">{icon}</span>}
        <h4 className="m-0 text-base flex-1">{title}</h4>
        {collapsible && (
          <span className="text-color-secondary text-xs">{collapsed ? "▶ Expandir" : "▼ Colapsar"}</span>
        )}
      </div>
      {!collapsed && children}
    </section>
  );
}

// ── Resumen card ──────────────────────────────────────────────────────────────
function ResumenCard({ section }) {
  return (
    <StageCard title={section.title} icon="📋">
      <RowGrid rows={section.rows} />

      {section.acGobernanteTexto && (
        <div className="mt-3">
          <Message
            severity={AC_GOBERNANTE_SEVERITY[section.acGobernante] || "info"}
            text={section.acGobernanteTexto}
            className="w-full"
            style={{ fontSize: "0.85rem" }}
          />
        </div>
      )}
      {section.cementoGobernanteTexto && (
        <div className="mt-2">
          <Message
            severity={CEMENTO_GOBERNANTE_SEVERITY[section.cementoGobernante] || "info"}
            text={section.cementoGobernanteTexto}
            className="w-full"
            style={{ fontSize: "0.85rem" }}
          />
        </div>
      )}
    </StageCard>
  );
}

// ── AC section card ───────────────────────────────────────────────────────────
// Mini-tabla con los puntos de la curva a/c-resistencia usados en el cálculo
// (sesión 2026-05-27). Permite al operador verificar de un vistazo si los
// puntos cargados son razonables o si hay alguno mal capturado que esté
// distorsionando el a/c. Las filas usadas para la interpolación / lookup
// directo se resaltan.
function CurvaPuntosTabla({ traza }) {
  if (!traza) return null;
  const { puntosCurvaEdad, puntosUsados, abramsParams, metodo, fcmConsulta } = traza;

  if (Array.isArray(puntosCurvaEdad) && puntosCurvaEdad.length > 0) {
    const usadasKey = new Set(
      (puntosUsados || []).map((p) => `${Number(p.resistenciaMpa)}_${Number(p.relacionAc)}`)
    );
    const fmt = (n, d = 3) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(d).replace(".", ","));
    return (
      <div className="mt-3">
        <div className="text-xs text-color-secondary mb-1">
          Puntos de la curva usados (edad {metodo === 'ABRAMS_FALLBACK' ? "(Abrams)" : null} | método: {metodo || "—"}
          {fcmConsulta != null ? ` | f'cm de consulta: ${fmt(fcmConsulta, 1)} MPa` : ""})
        </div>
        <div className="overflow-auto">
          <table className="text-xs" style={{ borderCollapse: "collapse", minWidth: 280 }}>
            <thead>
              <tr>
                <th className="p-2 text-left font-semibold text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                  Resistencia (MPa)
                </th>
                <th className="p-2 text-right font-semibold text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                  a/c
                </th>
                <th className="p-2 text-center font-semibold text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)", width: 80 }}>
                  Usado
                </th>
              </tr>
            </thead>
            <tbody>
              {puntosCurvaEdad.map((p, idx) => {
                const k = `${Number(p.resistenciaMpa)}_${Number(p.relacionAc)}`;
                const esUsado = usadasKey.has(k);
                return (
                  <tr
                    key={idx}
                    style={{
                      background: esUsado ? "rgba(59, 130, 246, 0.10)" : undefined,
                      fontWeight: esUsado ? 600 : undefined,
                    }}
                  >
                    <td className="p-2" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                      {fmt(p.resistenciaMpa, 1)}
                    </td>
                    <td className="p-2 text-right" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                      {fmt(p.relacionAc, 3)}
                    </td>
                    <td className="p-2 text-center" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                      {esUsado ? <Tag value="✓" severity="info" /> : <span className="text-color-secondary">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-color-secondary mt-1">
          Los puntos resaltados se usaron para resolver el a/c. Si ves un valor
          atípico (ej. a/c muy alto para resistencia alta), revisá la carga de la
          curva en el catálogo del cemento.
        </div>
      </div>
    );
  }

  // Fallback Abrams: mostramos los parámetros A/B.
  if (abramsParams) {
    return (
      <div className="mt-3">
        <div className="text-xs text-color-secondary mb-1">
          Sin puntos cargados a {abramsParams.edadDias} días — se usó la ley de Abrams
        </div>
        <div className="grid">
          <div className="col-12 md:col-4">
            <div className="text-xs text-color-secondary mb-1">Parámetro A</div>
            <div className="font-medium text-sm">{abramsParams.parametroA}</div>
          </div>
          <div className="col-12 md:col-4">
            <div className="text-xs text-color-secondary mb-1">Parámetro B</div>
            <div className="font-medium text-sm">{abramsParams.parametroB}</div>
          </div>
          <div className="col-12 md:col-4">
            <div className="text-xs text-color-secondary mb-1">Fórmula</div>
            <div className="font-medium text-sm">a/c = log(A / f'cm) / log(B)</div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ACCard({ section }) {
  return (
    <StageCard title={section.title} icon="⚗️">
      <RowGrid rows={section.rows} />
      <CurvaPuntosTabla traza={section.curvaTraza} />
      {section.acGobernanteTexto && (
        <div className="mt-3">
          <Message
            severity={AC_GOBERNANTE_SEVERITY[section.acGobernante] || "info"}
            text={section.acGobernanteTexto}
            className="w-full"
            style={{ fontSize: "0.85rem" }}
          />
        </div>
      )}
    </StageCard>
  );
}

// ── Cemento section card ──────────────────────────────────────────────────────
function CementoCard({ section }) {
  return (
    <StageCard title={section.title} icon="🧱">
      <RowGrid rows={section.rows} />
      {section.cementoGobernanteTexto && (
        <div className="mt-3">
          <Message
            severity={CEMENTO_GOBERNANTE_SEVERITY[section.cementoGobernante] || "info"}
            text={section.cementoGobernanteTexto}
            className="w-full"
            style={{ fontSize: "0.85rem" }}
          />
        </div>
      )}
    </StageCard>
  );
}

// ── Per-aditivo card ──────────────────────────────────────────────────────────
function AditivoCard({ aditivo }) {
  const { label, modoEfecto, modoEfetoLabel, dosis, kgM3, correccion } = aditivo;
  const isAhorro = modoEfecto === "AHORRO_AGUA";
  const isAsentamiento = modoEfecto === "AUMENTO_ASENTAMIENTO";

  return (
    <div className="surface-section border-1 surface-border border-round p-3 mb-2">
      <div className="flex align-items-center gap-2 mb-2">
        <span className="font-semibold text-sm">{label}</span>
        <Tag
          value={modoEfetoLabel}
          severity={isAhorro ? "success" : isAsentamiento ? "info" : "secondary"}
          className="text-xs"
        />
      </div>
      <div className="grid">
        <div className="col-12 sm:col-6 lg:col-4">
          <div className="text-xs text-color-secondary mb-1">Dosis</div>
          <div className="font-medium text-sm">{dosis != null ? `${dosis}` : "—"}</div>
        </div>
        <div className="col-12 sm:col-6 lg:col-4">
          <div className="text-xs text-color-secondary mb-1">Dosificación calculada</div>
          <div className="font-medium text-sm">{kgM3 != null ? `${kgM3} kg/m³` : "—"}</div>
        </div>
        <div className="col-12 sm:col-6 lg:col-4">
          <div className="text-xs text-color-secondary mb-1">Efecto</div>
          <div className="font-medium text-sm">{modoEfetoLabel}</div>
        </div>
      </div>

      {isAhorro && correccion && correccion.aguaAntes != null && (
        <div className="mt-2 p-2 surface-ground border-round text-sm">
          <span className="text-color-secondary">Agua antes: </span>
          <span className="font-medium">{correccion.aguaAntes} L/m³</span>
          <span className="mx-2">→</span>
          <span className="text-color-secondary">Agua después: </span>
          <span className="font-medium text-green-700">{correccion.aguaDespues} L/m³</span>
          <span className="ml-2 text-xs text-color-secondary">(−{correccion.reduccionPct} %)</span>
        </div>
      )}
      {isAhorro && correccion?.nota && !correccion.aguaAntes && (
        <div className="mt-2">
          <Message severity="warn" text={correccion.nota} className="w-full" style={{ fontSize: "0.8rem" }} />
        </div>
      )}
      {isAsentamiento && correccion && (
        <div className="mt-2 p-2 surface-ground border-round text-sm">
          <span className="text-color-secondary">Efecto reológico: </span>
          <span className="font-medium">
            {correccion.incrementoAsentamientoMm != null
              ? `+${correccion.incrementoAsentamientoMm} mm de asentamiento estimado`
              : "Mejora de trabajabilidad (sin dato de incremento)"}
          </span>
          <div className="text-xs text-color-secondary mt-1">El agua de amasado no se modifica.</div>
        </div>
      )}
    </div>
  );
}

// ── Aditivos section ──────────────────────────────────────────────────────────
function AditivosCard({ section }) {
  return (
    <StageCard title={section.title} icon="🧪">
      {section.aditivosDetalle?.length > 0
        ? section.aditivosDetalle.map((ad, i) => <AditivoCard key={i} aditivo={ad} />)
        : <p className="text-sm text-color-secondary m-0">Sin aditivos en este diseño.</p>
      }
    </StageCard>
  );
}

// ── Warnings section ──────────────────────────────────────────────────────────
function WarningsCard({ section }) {
  const hasWarnings = section.warningCount > 0;
  return (
    <StageCard title={section.title} icon={hasWarnings ? "⚠️" : "✅"}>
      {hasWarnings ? (
        <ul className="m-0 pl-3 text-sm">
          {section.lines.map((line, i) => (
            <li key={i} className="mb-1 text-orange-700">{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-color-secondary m-0">Sin advertencias técnicas registradas.</p>
      )}
    </StageCard>
  );
}

// ── Fuentes table ─────────────────────────────────────────────────────────────
function FuentesCard({ section }) {
  return (
    <StageCard title={section.title} icon="🔍" collapsible defaultCollapsed>
      {section.fuentesCalculo && (
        <div className="overflow-auto mt-2">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Parámetro", "Valor", "Origen", "Regla aplicada", "Observación"].map((h) => (
                  <th key={h} className="text-left p-2 text-xs font-semibold text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.fuentesCalculo.map((f, i) => {
                const badge = ORIGEN_BADGE[f.origenTipo] || { severity: "secondary", label: f.origenTipo || "—" };
                return (
                  <tr key={i} style={{ background: f.criticidad === "FALLBACK" ? "var(--yellow-50)" : f.criticidad === "WARNING" ? "var(--orange-50)" : undefined }}>
                    <td className="p-2 font-medium" style={{ borderBottom: "1px solid var(--surface-border)", whiteSpace: "nowrap" }}>{f.parametro}</td>
                    <td className="p-2" style={{ borderBottom: "1px solid var(--surface-border)" }}>{f.valor}</td>
                    <td className="p-2" style={{ borderBottom: "1px solid var(--surface-border)", whiteSpace: "nowrap" }}>
                      <Tag severity={badge.severity} value={badge.label} className="text-xs" />
                      {f.origenRef && <span className="ml-1 text-xs text-color-secondary">{f.origenRef}</span>}
                    </td>
                    <td className="p-2 text-xs text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)" }}>{f.regla || "—"}</td>
                    <td className="p-2 text-xs" style={{ borderBottom: "1px solid var(--surface-border)", color: f.observacion ? "var(--orange-700)" : undefined }}>{f.observacion || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </StageCard>
  );
}

// ── Generic section (entradas, agua, agregados, resultado, glosario) ──────────
const STAGE_ICONS = {
  entradas:   "📐",
  agua:       "💧",
  agregados:  "🪨",
  resultado:  "✅",
  glosario:   "📖",
};

function GenericCard({ section }) {
  return (
    <StageCard
      title={section.title}
      icon={STAGE_ICONS[section.stageType] || "📄"}
      collapsible={section.collapsible}
      defaultCollapsed={section.collapsible}
    >
      <RowGrid rows={section.rows} />
      {section.lines?.length > 0 && (
        <ul className="m-0 pl-3 text-sm mt-2">
          {section.lines.map((line, i) => (
            <li key={i} className="mb-1">{line}</li>
          ))}
        </ul>
      )}
      {section.table && (
        <div className="overflow-auto mt-2">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {section.table.headers.map((header) => (
                  <th key={header} className="text-left p-2 text-xs font-semibold text-color-secondary" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="p-2 text-sm" style={{ borderBottom: "1px solid var(--surface-border)" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </StageCard>
  );
}

// ── Section router ────────────────────────────────────────────────────────────
function SectionRouter({ section }) {
  switch (section.stageType) {
    case "resumen":   return <ResumenCard section={section} />;
    case "ac":        return <ACCard section={section} />;
    case "cemento":   return <CementoCard section={section} />;
    case "aditivos":  return <AditivosCard section={section} />;
    case "warnings":  return <WarningsCard section={section} />;
    case "fuentes":   return <FuentesCard section={section} />;
    default:          return <GenericCard section={section} />;
  }
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function DosificacionTrazabilidadView({ snapshot, showDebug = false }) {
  const [viewMode, setViewMode] = useState("tecnica");

  const sections = useMemo(
    () => buildDosificacionTraceSections(snapshot, { includeGlossary: true }),
    [snapshot]
  );

  if (!snapshot?.trazabilidad && !snapshot?.resultado) {
    return <div className="text-color-secondary">No hay trazabilidad disponible.</div>;
  }

  return (
    <div className="flex flex-column gap-3">
      {showDebug && (
        <div className="flex justify-content-end">
          <SelectButton
            value={viewMode}
            options={VIEW_OPTIONS}
            onChange={(e) => e.value && setViewMode(e.value)}
          />
        </div>
      )}

      {showDebug && viewMode === "debug" ? (
        <pre className="text-xs overflow-auto surface-ground p-3 border-round" style={{ maxHeight: "60vh" }}>
          {JSON.stringify(snapshot?.trazabilidad, null, 2)}
        </pre>
      ) : (
        sections.map((section) => (
          <SectionRouter key={section.key} section={section} />
        ))
      )}
    </div>
  );
}
