import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { RadioButton } from "primereact/radiobutton";
import { Checkbox } from "primereact/checkbox";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";

/**
 * Flexible numeric input that accepts both '.' and ',' as decimal separators.
 * Displays using locale comma but stores as a JS number.
 */
const FlexNumericInput = ({ value, onChange, min, max, maxFractionDigits = 2, className, disabled, placeholder, inputStyle }) => {
    const [text, setText] = useState(() =>
        value != null ? Number(value).toLocaleString("es-AR", { maximumFractionDigits: maxFractionDigits, useGrouping: false }) : ""
    );
    const lastPushedRef = useRef(value);

    // Sync external value changes (e.g. parent setState)
    const displayText = useMemo(() => {
        if (value !== lastPushedRef.current) {
            const formatted = value != null
                ? Number(value).toLocaleString("es-AR", { maximumFractionDigits: maxFractionDigits, useGrouping: false })
                : "";
            lastPushedRef.current = value;
            // We can't call setText here but we can return the value for controlled mode
            return formatted;
        }
        return null; // means use local text state
    }, [value, maxFractionDigits]);

    // If we detect an external change, sync to local text on next render
    const effectiveText = displayText !== null ? displayText : text;

    const handleChange = (e) => {
        const raw = e.target.value;
        // Allow digits, single decimal point or comma, optional leading minus
        const sanitized = raw.replace(/[^0-9.,-]/g, "");
        setText(sanitized);
    };

    const handleBlur = () => {
        if (text === "" || text === "-") {
            setText("");
            lastPushedRef.current = null;
            onChange(null);
            return;
        }
        // Normalize: replace comma with period for parsing
        const normalized = text.replace(",", ".");
        const num = parseFloat(normalized);
        if (isNaN(num)) {
            setText("");
            lastPushedRef.current = null;
            onChange(null);
            return;
        }
        // Clamp (optional, user can still see warning)
        const formatted = num.toLocaleString("es-AR", { maximumFractionDigits: maxFractionDigits, useGrouping: false });
        setText(formatted);
        lastPushedRef.current = num;
        onChange(num);
    };

    return (
        <InputText
            value={effectiveText}
            onChange={handleChange}
            onBlur={handleBlur}
            className={className}
            disabled={disabled}
            placeholder={placeholder}
            inputMode="decimal"
            style={inputStyle}
        />
    );
};

/**
 * EnsayoTipoForm
 *
 * Renders a dynamic form based on a form spec (from ensayoFormSpecRegistry).
 * Handles number, enum, text, textarea field types, plus an optional
 * editable DataTable for arrayTable fields (e.g. reactividad series).
 *
 * Props:
 *  - spec         {object}   Form specification from backend /form-spec/:codigo
 *  - resultado    {object}   Current resultado draft object
 *  - onChange     {function} (nextResultado) => void
 *  - disabled     {boolean}  Disable all inputs (e.g. during save)
 */
const EnsayoTipoForm = ({ spec, resultado = {}, onChange, disabled = false, densidadSSS = null }) => {
    // ─── Auto-compute logic for calculated fields ──────────
    const autoCompute = useCallback((draft) => {
        const code = spec?.codigo || "";
        // Peso unitario: calcular V% desde PUC/PUS + densidad SSS
        if ((code === "IRAM1531_PESO_UNITARIO" || code === "IRAM1548_PESO_UNITARIO") && densidadSSS > 0) {
            const d3 = Number(densidadSSS);
            if (draft.puc != null) {
                draft.vaciosCompactado = Math.round((1 - draft.puc / (d3 * 1000)) * 1000) / 10;
            }
            if (draft.pus != null) {
                draft.vaciosSuelto = Math.round((1 - draft.pus / (d3 * 1000)) * 1000) / 10;
            }
        }
        // Equivalente de arena: auto-compute from 6 readings
        if (code === "IRAM1882_VALOR_EQUIVALENTE_ARENA") {
            const readings = [];
            for (let i = 1; i <= 3; i++) {
                const l1 = draft[`l1_${i}`], l2 = draft[`l2_${i}`];
                if (l1 != null && l2 != null && l2 > 0) {
                    readings.push(Math.round((l1 / l2) * 100));
                }
            }
            if (readings.length > 0) {
                draft.equivalenteArenaPct = Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
            }
        }
        return draft;
    }, [spec?.codigo, densidadSSS]);

    // ─── Field change handler ───────────────────────────────
    const handleFieldChange = useCallback(
        (path, value) => {
            const draft = { ...resultado, [path]: value };
            onChange(autoCompute(draft));
        },
        [resultado, onChange, autoCompute]
    );

    // ─── Reactivo: recalcular campos derivados cuando llegan tarde sus
    // inputs (caso típico: `densidadSSS` se resuelve async desde
    // getCaracterizacion, o se abre un ensayo guardado sin V%). Sin esto,
    // `autoCompute` solo corre en handleFieldChange y nunca rellena los
    // computed si los datos llegaron en otro orden.
    useEffect(() => {
        if (!spec) return;
        const computed = autoCompute({ ...resultado });
        let changed = false;
        for (const f of spec.fields || []) {
            if (!f.computed) continue;
            const before = resultado[f.path];
            const after = computed[f.path];
            if ((before ?? null) !== (after ?? null)) { changed = true; break; }
        }
        if (changed) onChange(computed);
    }, [autoCompute, resultado, spec, onChange]);

    // ─── Table (series) handler ─────────────────────────────
    const handleTableChange = useCallback(
        (tablePath, newRows) => {
            onChange({ ...resultado, [tablePath]: newRows });
        },
        [resultado, onChange]
    );

    // ─── Build placeholder with range hint ────────────────
    const buildPlaceholder = useCallback((field) => {
        if (field.type === "number" && field.min != null && field.max != null) {
            if (field.computed) {
                return "Se calcula automáticamente";
            }
            // Para campos opcionales evitamos repetir el rango (que ya aparece
            // en el `<small>` debajo). Si el operador no midió el dato, debe
            // dejarlo vacío — lo decimos explícitamente.
            if (field.required === false) {
                return "Vacío si no se midió";
            }
            const unit = field.unit ? ` ${field.unit}` : "";
            return `${field.min}–${field.max}${unit}`;
        }
        return field.label;
    }, []);

    // ─── Render a single field ──────────────────────────────
    const renderField = useCallback(
        (field) => {
            const value = resultado[field.path];
            const key = field.path;

            switch (field.type) {
                case "number":
                    return (
                        <div key={key} className="col-12 md:col-6 lg:col-4">
                            <label className="block text-sm font-semibold mb-1">
                                {field.label}
                                {field.unit && (
                                    <span className="text-xs text-500 font-normal ml-1">({field.unit})</span>
                                )}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                                {field.computed && <span className="text-xs text-400 font-normal ml-1">(calculado)</span>}
                            </label>
                            <FlexNumericInput
                                value={value != null ? Number(value) : null}
                                onChange={(v) => handleFieldChange(key, v)}
                                min={field.min}
                                max={field.max}
                                maxFractionDigits={field.step != null ? Math.max(0, -Math.floor(Math.log10(field.step))) : 2}
                                className="w-full"
                                disabled={disabled || field.computed}
                                placeholder={buildPlaceholder(field)}
                            />
                            {field.min != null && field.max != null && !field.computed && (
                                <small className="text-xs text-400">Rango: {field.min}–{field.max}{field.unit ? ` ${field.unit}` : ""}</small>
                            )}
                        </div>
                    );

                case "enum":
                    return (
                        <div key={key} className="col-12 md:col-6 lg:col-4">
                            <label className="block text-sm font-semibold mb-1">
                                {field.label}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <Dropdown
                                value={value ?? null}
                                onChange={(e) => handleFieldChange(key, e.value)}
                                options={field.options || []}
                                optionLabel="label"
                                optionValue="value"
                                placeholder={`Seleccionar ${field.label.toLowerCase()}`}
                                className="w-full"
                                showClear
                                disabled={disabled}
                            />
                        </div>
                    );

                case "text":
                    return (
                        <div key={key} className="col-12 md:col-6">
                            <label className="block text-sm font-semibold mb-1">
                                {field.label}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <InputText
                                value={value || ""}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                className="w-full"
                                disabled={disabled}
                                placeholder={field.label}
                            />
                        </div>
                    );

                case "textarea":
                    return (
                        <div key={key} className="col-12">
                            <label className="block text-sm font-semibold mb-1">
                                {field.label}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <InputTextarea
                                value={value || ""}
                                onChange={(e) => handleFieldChange(key, e.target.value)}
                                className="w-full"
                                rows={3}
                                autoResize
                                disabled={disabled}
                                placeholder={field.label}
                            />
                        </div>
                    );

                default:
                    return null;
            }
        },
        [resultado, handleFieldChange, disabled, buildPlaceholder]
    );

    // ─── Editable table (for reactividad series, etc.) ──────
    const tableSpec = spec?.table;
    const tableRows = useMemo(
        () => (tableSpec ? resultado[tableSpec.path] || [] : []),
        [tableSpec, resultado]
    );

    // Auto-fill hint for expansionFinalPct
    const [autoFillHint, setAutoFillHint] = useState(null);

    const handleCellEdit = useCallback(
        (rowIdx, colPath, value) => {
            const newRows = tableRows.map((r, i) =>
                i === rowIdx ? { ...r, [colPath]: value } : r
            );
            handleTableChange(tableSpec.path, newRows);
        },
        [tableRows, tableSpec, handleTableChange]
    );

    const addRow = useCallback(() => {
        if (!tableSpec) return;
        const blank = {};
        for (const col of tableSpec.columns) {
            blank[col.path] = null;
        }
        handleTableChange(tableSpec.path, [...tableRows, blank]);
    }, [tableSpec, tableRows, handleTableChange]);

    const removeRow = useCallback(
        (idx) => {
            handleTableChange(
                tableSpec.path,
                tableRows.filter((_, i) => i !== idx)
            );
        },
        [tableSpec, tableRows, handleTableChange]
    );

    // Sort table rows by edadDias (ascending)
    const sortByAge = useCallback(() => {
        if (!tableSpec || tableRows.length === 0) return;
        const sorted = [...tableRows].sort((a, b) => {
            const aAge = a.edadDias != null ? Number(a.edadDias) : -1;
            const bAge = b.edadDias != null ? Number(b.edadDias) : -1;
            return aAge - bAge;
        });
        handleTableChange(tableSpec.path, sorted);
    }, [tableSpec, tableRows, handleTableChange]);

    // Auto-fill expansionFinalPct from highest-age row
    const autoFillExpansionFinal = useCallback(() => {
        if (!tableRows.length) return;
        // Find row with max edadDias
        let maxAge = -1;
        let maxExpansion = null;
        for (const row of tableRows) {
            const age = row.edadDias != null ? Number(row.edadDias) : -1;
            if (age > maxAge) {
                maxAge = age;
                maxExpansion = row.expansionPct;
            }
        }
        if (maxExpansion != null && resultado.expansionFinalPct == null) {
            onChange({ ...resultado, expansionFinalPct: maxExpansion });
            setAutoFillHint(`Expansión final seteada a ${maxExpansion}% (edad: ${maxAge} días)`);
            setTimeout(() => setAutoFillHint(null), 4000);
        }
    }, [tableRows, resultado, onChange]);

    // ─── IRAM 1601 limit checking ───────────────────────────
    const isAgua = spec?.codigo === "IRAM1601_ANALISIS_QUIMICO";

    const aguaCtx = useMemo(() => {
        if (!isAgua) return null;
        return {
            origenAgua:   resultado._origenAgua   ?? "otro_origen",
            usoAmasado:   resultado._usoAmasado   ?? true,
            usoCurado:    resultado._usoCurado     ?? true,
            tipoHormigon: resultado._tipoHormigon  ?? "armado",
            agReactivos:  resultado._agReactivos   ?? false,
        };
    }, [isAgua, resultado._origenAgua, resultado._usoAmasado, resultado._usoCurado, resultado._tipoHormigon, resultado._agReactivos]);

    const aguaLimites = useMemo(() => {
        if (!aguaCtx) return null;
        const usoCurado = aguaCtx.usoCurado;
        const usoAmasado = aguaCtx.usoAmasado;
        const limCloruro = { simple: 4500, armado: 1000, pretensado: 500 };
        return {
            residuoSolido:   { max: aguaCtx.origenAgua === "recuperada" ? 50000 : 5000, unit: "mg/L" },
            materiaOrganica: { max: 3, unit: "mg/L" },
            ph:              { min: (usoCurado ? 6.0 : usoAmasado ? 4.0 : 4.0), unit: "UpH" },
            sulfato:         { max: 2000, unit: "mg/L" },
            cloruro:         { max: limCloruro[aguaCtx.tipoHormigon] || 1000, unit: "mg/L" },
            hierro:          { max: usoCurado ? 0.5 : null, unit: "mg/L", nota: usoCurado ? "aspecto estético" : "sin límite (amasado)" },
            alcalis:         { max: aguaCtx.agReactivos ? 1500 : null, unit: "mg/L", nota: aguaCtx.agReactivos ? null : "no aplica (ag. no reactivos)" },
        };
    }, [aguaCtx]);

    const evaluarParam = useCallback((valor, lim) => {
        if (valor == null || valor === "") return "pendiente";
        if (lim.max == null && lim.min == null) return "no_aplica";
        const v = Number(valor);
        if (lim.min != null && v < lim.min) return "no_cumple";
        if (lim.max != null && v > lim.max) return "no_cumple";
        if (lim.max != null && v > lim.max * 0.8) return "atencion";
        if (lim.min != null && v < lim.min * 1.25) return "atencion";
        return "cumple";
    }, []);

    const aguaEvals = useMemo(() => {
        if (!aguaLimites) return null;
        return {
            residuoSolido:   evaluarParam(resultado.residuoSolido, aguaLimites.residuoSolido),
            materiaOrganica: evaluarParam(resultado.materiaOrganica, aguaLimites.materiaOrganica),
            ph:              evaluarParam(resultado.ph, aguaLimites.ph),
            sulfato:         evaluarParam(resultado.sulfato, aguaLimites.sulfato),
            cloruro:         evaluarParam(resultado.cloruro, aguaLimites.cloruro),
            hierro:          evaluarParam(resultado.hierro, aguaLimites.hierro),
            alcalis:         evaluarParam(resultado.alcalis, aguaLimites.alcalis),
        };
    }, [aguaLimites, resultado.residuoSolido, resultado.materiaOrganica, resultado.ph, resultado.sulfato, resultado.cloruro, resultado.hierro, resultado.alcalis, evaluarParam]);

    const ESTADO_ICONS = { cumple: { icon: "fa-solid fa-circle-check", color: "#22c55e" }, atencion: { icon: "fa-solid fa-triangle-exclamation", color: "#eab308" }, no_cumple: { icon: "fa-solid fa-circle-xmark", color: "#ef4444" }, no_aplica: { icon: "fa-solid fa-info-circle", color: "#9ca3af" }, pendiente: { icon: "fa-solid fa-circle-question", color: "#9ca3af" } };

    const limiteLabel = useCallback((lim) => {
        if (!lim) return "";
        if (lim.nota && lim.max == null && lim.min == null) return lim.nota;
        const parts = [];
        if (lim.min != null) parts.push(`Min: ${lim.min.toLocaleString("es-AR")}`);
        if (lim.max != null) parts.push(`Max: ${lim.max.toLocaleString("es-AR")} ${lim.unit || ""}`);
        if (lim.nota) parts.push(`(${lim.nota})`);
        return parts.join(" · ");
    }, []);

    const handleAguaCtxChange = useCallback((field, value) => {
        onChange({ ...resultado, [field]: value });
    }, [resultado, onChange]);

    if (!spec) return null;

    return (
        <div>
            {/* Title */}
            <div className="flex align-items-center gap-2 mb-3">
                <i className="fa-solid fa-flask text-primary" />
                <span className="font-bold text-sm">{spec.titulo}</span>
                {spec.categoria && (
                    <Tag
                        value={spec.categoria}
                        severity="info"
                        className="text-xs"
                        style={{ fontSize: "0.6rem", padding: "1px 5px" }}
                    />
                )}
            </div>

            {/* IRAM 1601: Condiciones de uso */}
            {isAgua && aguaCtx && (
                <div className="surface-100 border-round p-3 mb-3">
                    <div className="flex align-items-center gap-2 mb-2">
                        <i className="fa-solid fa-sliders text-primary text-sm" />
                        <span className="font-bold text-sm">Condiciones de uso</span>
                    </div>
                    <div className="grid">
                        <div className="col-12 md:col-6">
                            <small className="font-bold block mb-1">Origen del agua</small>
                            <div className="flex flex-column gap-2">
                                {[{ label: "Agua de red / otro origen", value: "otro_origen" }, { label: "Agua recuperada (industria hormigón)", value: "recuperada" }].map(opt => (
                                    <div key={opt.value} className="flex align-items-center gap-2">
                                        <RadioButton inputId={`origen-${opt.value}`} value={opt.value} checked={aguaCtx.origenAgua === opt.value} onChange={() => handleAguaCtxChange("_origenAgua", opt.value)} disabled={disabled} />
                                        <label htmlFor={`origen-${opt.value}`} className="text-sm">{opt.label}</label>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="col-12 md:col-6">
                            <small className="font-bold block mb-1">Uso del agua</small>
                            <div className="flex gap-3">
                                <div className="flex align-items-center gap-2">
                                    <Checkbox inputId="uso-amasado" checked={aguaCtx.usoAmasado} onChange={(e) => handleAguaCtxChange("_usoAmasado", e.checked)} disabled={disabled} />
                                    <label htmlFor="uso-amasado" className="text-sm">Amasado</label>
                                </div>
                                <div className="flex align-items-center gap-2">
                                    <Checkbox inputId="uso-curado" checked={aguaCtx.usoCurado} onChange={(e) => handleAguaCtxChange("_usoCurado", e.checked)} disabled={disabled} />
                                    <label htmlFor="uso-curado" className="text-sm">Curado</label>
                                </div>
                            </div>
                        </div>
                        <div className="col-12 md:col-6">
                            <small className="font-bold block mb-1">Tipo de hormigón destino</small>
                            <div className="flex gap-3">
                                {[{ label: "Simple", value: "simple" }, { label: "Armado", value: "armado" }, { label: "Pretensado", value: "pretensado" }].map(opt => (
                                    <div key={opt.value} className="flex align-items-center gap-2">
                                        <RadioButton inputId={`th-${opt.value}`} value={opt.value} checked={aguaCtx.tipoHormigon === opt.value} onChange={() => handleAguaCtxChange("_tipoHormigon", opt.value)} disabled={disabled} />
                                        <label htmlFor={`th-${opt.value}`} className="text-sm">{opt.label}</label>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="col-12 md:col-6">
                            <small className="font-bold block mb-1">Agregados potencialmente reactivos</small>
                            <div className="flex align-items-center gap-2">
                                <Checkbox inputId="ag-reactivos" checked={aguaCtx.agReactivos} onChange={(e) => handleAguaCtxChange("_agReactivos", e.checked)} disabled={disabled} />
                                <label htmlFor="ag-reactivos" className="text-sm">Sí, se esperan agregados reactivos</label>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Fields grid */}
            {spec.fields.length > 0 && (
                <div className="grid">{spec.fields.map(renderField)}</div>
            )}

            {/* IRAM 1601: Indicadores de límite por campo */}
            {isAgua && aguaLimites && aguaEvals && (
                <div className="surface-50 border-round p-3 mt-2">
                    <small className="font-bold block mb-2">
                        <i className="fa-solid fa-clipboard-check mr-1 text-primary" />
                        Verificación IRAM 1601 — Tabla 1
                    </small>
                    <div className="grid">
                        {[
                            { key: "residuoSolido",   label: "Residuo sólido" },
                            { key: "materiaOrganica", label: "Materia orgánica" },
                            { key: "ph",              label: "pH" },
                            { key: "sulfato",         label: "Sulfato (SO₄²⁻)" },
                            { key: "cloruro",         label: "Cloruro (Cl⁻)" },
                            { key: "hierro",          label: "Hierro (Fe³⁺)" },
                            { key: "alcalis",         label: "Álcalis" },
                        ].map(({ key, label }) => {
                            const lim = aguaLimites[key];
                            const ev = aguaEvals[key];
                            if (!lim) return null;
                            const est = ESTADO_ICONS[ev] || ESTADO_ICONS.pendiente;
                            const valor = resultado[key];
                            return (
                                <div key={key} className="col-12 md:col-6 lg:col-4 flex align-items-center gap-2 py-1">
                                    <i className={est.icon} style={{ color: est.color, fontSize: "0.9rem" }} />
                                    <div>
                                        <span className="text-sm font-semibold">{label}: </span>
                                        <span className="text-sm">{valor != null ? Number(valor).toLocaleString("es-AR") : "—"}</span>
                                        <small className="block text-xs" style={{ color: "var(--text-color-secondary)" }}>
                                            {limiteLabel(lim)}
                                        </small>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Editable table */}
            {tableSpec && (
                <div className="mt-3">
                    <div className="flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                        <label className="text-sm font-semibold">
                            <i className="fa-solid fa-table mr-1 text-xs" />
                            {tableSpec.label}
                        </label>
                        <div className="flex gap-1">
                            {tableRows.length > 1 && (
                                <Button
                                    icon="fa-solid fa-arrow-up-1-9"
                                    label="Ordenar por edad"
                                    size="small"
                                    text
                                    rounded
                                    onClick={sortByAge}
                                    disabled={disabled}
                                    className="text-xs"
                                />
                            )}
                            {tableRows.length > 0 && resultado.expansionFinalPct == null && (
                                <Button
                                    icon="fa-solid fa-arrow-right-to-bracket"
                                    label="Expansión final ← max edad"
                                    size="small"
                                    text
                                    rounded
                                    severity="help"
                                    onClick={autoFillExpansionFinal}
                                    disabled={disabled}
                                    className="text-xs"
                                />
                            )}
                            <Button
                                icon="fa-solid fa-plus"
                                label="Agregar fila"
                                size="small"
                                outlined
                                rounded
                                onClick={addRow}
                                disabled={disabled}
                            />
                        </div>
                    </div>
                    {autoFillHint && (
                        <div className="mb-2 p-2 border-round surface-100 border-1 border-blue-200 text-xs text-blue-700 flex align-items-center gap-2">
                            <i className="fa-solid fa-circle-info text-blue-400" />
                            {autoFillHint}
                        </div>
                    )}
                    <DataTable responsiveLayout="scroll"
                        value={tableRows}
                        size="small"
                        stripedRows
                        scrollable
                        scrollHeight="250px"
                        emptyMessage="Sin datos. Agregá filas con el botón."
                        className="text-sm"
                    >
                        {tableSpec.columns.map((col) => (
                            <Column
                                key={col.path}
                                header={col.label}
                                body={(row, { rowIndex }) => (
                                    <FlexNumericInput
                                        value={row[col.path] != null ? Number(row[col.path]) : null}
                                        onChange={(v) =>
                                            handleCellEdit(rowIndex, col.path, v)
                                        }
                                        maxFractionDigits={
                                            col.step != null
                                                ? Math.max(0, -Math.floor(Math.log10(col.step)))
                                                : 3
                                        }
                                        min={col.min}
                                        max={col.max}
                                        className="w-full"
                                        disabled={disabled}
                                        inputStyle={{ width: "100%" }}
                                    />
                                )}
                                style={{ width: "150px" }}
                            />
                        ))}
                        <Column
                            header=""
                            body={(_, { rowIndex }) => (
                                <Button
                                    icon="fa-solid fa-trash"
                                    className="p-button-text p-button-danger p-button-sm"
                                    onClick={() => removeRow(rowIndex)}
                                    disabled={disabled}
                                    style={{ width: "2rem", height: "2rem" }}
                                />
                            )}
                            style={{ width: "50px" }}
                        />
                    </DataTable>
                </div>
            )}
        </div>
    );
};

export default EnsayoTipoForm;
