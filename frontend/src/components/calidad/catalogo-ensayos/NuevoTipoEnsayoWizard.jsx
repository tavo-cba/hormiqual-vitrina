import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Steps } from "primereact/steps";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { MultiSelect } from "primereact/multiselect";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { useToast } from "../../../context/ToastContext";
import { createTipo, getSchemaKeys, getSugerenciaPorNorma } from "../../../services/agregadoEnsayoService";

// ─── Constants ──────────────────────────────────────────────
const MATERIAL_OPTIONS = [
    { label: "Agregados", value: "AGREGADOS" },
    { label: "Hormigón (próximamente)", value: "HORMIGON", disabled: true },
    { label: "Cemento (próximamente)", value: "CEMENTO", disabled: true },
    { label: "Agua", value: "AGUA" },
    { label: "Aditivos (próximamente)", value: "ADITIVOS", disabled: true },
];

const APLICA_OPTIONS = [
    { label: "FINO", value: "FINO" },
    { label: "GRUESO", value: "GRUESO" },
];

const CATEGORIA_OPTIONS = [
    { label: "Física", value: "fisica" },
    { label: "Mecánica", value: "mecanica" },
    { label: "Limpieza", value: "limpieza" },
    { label: "Forma", value: "forma" },
    { label: "Durabilidad", value: "durabilidad" },
    { label: "Otros", value: "otros" },
];

const WIZARD_STEPS = [
    { label: "Material" },
    { label: "Norma" },
    { label: "Método" },
    { label: "Configuración" },
];

// ─── Component ──────────────────────────────────────────────
const NuevoTipoEnsayoWizard = ({ visible, onHide, normasList = [], onCreated }) => {
    const showToast = useToast();
    const [activeStep, setActiveStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [schemaKeyOptions, setSchemaKeyOptions] = useState([]);

    // Suggestion state
    const [suggestion, setSuggestion] = useState(null);      // current norma-based suggestion
    const [suggestionLocked, setSuggestionLocked] = useState(false); // schemaKey locked from suggestion
    const [userEdited, setUserEdited] = useState({});        // tracks which fields user manually changed
    const [consistencyWarnings, setConsistencyWarnings] = useState([]);
    const fetchRef = useRef(0); // debounce/race guard

    // Wizard form state
    const INITIAL_FORM = {
        material: "AGREGADOS",
        normaId: null,
        normaRef: "",
        schemaKey: null,
        codigo: "",
        nombre: "",
        aplicaA: ["FINO", "GRUESO"],
        categoria: "fisica",
        obligatorio: false,
        periodicidadMeses: null,
        warningDays: null,
        perfil: "AVANZADO",
        visibleEnUI: true,
        visibleEnCards: true,
        orden: 50,
    };

    const [formData, setFormData] = useState(INITIAL_FORM);

    // Reset on visibility change
    useEffect(() => {
        if (visible) {
            setActiveStep(0);
            setFormData({ ...INITIAL_FORM });
            setSaving(false);
            setSuggestion(null);
            setSuggestionLocked(false);
            setUserEdited({});
            setConsistencyWarnings([]);
        }
    }, [visible]);

    // Fetch schema key options
    useEffect(() => {
        if (visible && schemaKeyOptions.length === 0) {
            getSchemaKeys()
                .then(setSchemaKeyOptions)
                .catch(() => {});
        }
    }, [visible, schemaKeyOptions.length]);

    // Norma dropdown options
    const normaOptions = useMemo(() => {
        return [
            { label: "(Sin norma vinculada)", value: null },
            ...normasList.map((n) => ({
                label: `${n.codigo} — ${n.titulo}`,
                value: n.id,
                normaRef: n.codigo,
            })),
        ];
    }, [normasList]);

    // SchemaKey dropdown options
    const schemaKeyDropdownOptions = useMemo(() => {
        return schemaKeyOptions.map((sk) => ({
            label: `${sk.label} (${sk.schemaKey})`,
            value: sk.schemaKey,
        }));
    }, [schemaKeyOptions]);

    // ─── Fetch suggestion when norma changes ────
    const fetchSuggestion = useCallback(async (material, normaCodigo) => {
        if (!normaCodigo || !material) {
            setSuggestion(null);
            setSuggestionLocked(false);
            return;
        }
        const seq = ++fetchRef.current;
        try {
            const s = await getSugerenciaPorNorma(material, normaCodigo);
            if (fetchRef.current !== seq) return; // stale
            if (!s) {
                setSuggestion(null);
                setSuggestionLocked(false);
                return;
            }
            setSuggestion(s);
            setSuggestionLocked(true);
            setUserEdited({});

            // Auto-fill form with suggestion
            setFormData((prev) => ({
                ...prev,
                schemaKey: s.schemaKey,
                codigo: s.codigoSugerido || prev.codigo,
                nombre: s.nombreSugerido || prev.nombre,
                aplicaA: s.aplicaA || prev.aplicaA,
                categoria: s.categoria || prev.categoria,
                perfil: s.perfilDefault || prev.perfil,
                obligatorio: s.obligatorioDefault ?? prev.obligatorio,
                periodicidadMeses: s.periodicidadMesesDefault ?? prev.periodicidadMeses,
                warningDays: s.warningDaysDefault ?? prev.warningDays,
            }));
        } catch {
            if (fetchRef.current !== seq) return;
            setSuggestion(null);
            setSuggestionLocked(false);
        }
    }, []);

    // Auto-fill normaRef when norma is selected + trigger suggestion
    const handleNormaChange = (normaId) => {
        const norma = normasList.find((n) => n.id === normaId);
        const normaRef = norma ? norma.codigo : "";
        setFormData((prev) => ({
            ...prev,
            normaId,
            normaRef,
            // Reset suggestion-filled fields if norma cleared
            ...(!normaId ? { schemaKey: null, codigo: "", nombre: "" } : {}),
        }));
        if (normaRef) {
            fetchSuggestion(formData.material, normaRef);
        } else {
            setSuggestion(null);
            setSuggestionLocked(false);
            setUserEdited({});
        }
    };

    // Also fetch suggestion if normaRef typed manually and looks complete
    const handleNormaRefChange = (normaRef) => {
        setFormData((prev) => ({ ...prev, normaRef }));
        // Try to fetch suggestion if it looks like a complete code (e.g. "IRAM 1505")
        if (/^IRAM\s?\d{3,5}(-\d+)?$/i.test(normaRef.trim())) {
            fetchSuggestion(formData.material, normaRef.trim());
        }
    };

    // ─── Apply / restore suggestion ─────────────
    const applySuggestion = () => {
        if (!suggestion) return;
        setSuggestionLocked(true);
        setUserEdited({});
        setFormData((prev) => ({
            ...prev,
            schemaKey: suggestion.schemaKey,
            codigo: suggestion.codigoSugerido || prev.codigo,
            nombre: suggestion.nombreSugerido || prev.nombre,
            aplicaA: suggestion.aplicaA || prev.aplicaA,
            categoria: suggestion.categoria || prev.categoria,
            perfil: suggestion.perfilDefault || prev.perfil,
            obligatorio: suggestion.obligatorioDefault ?? prev.obligatorio,
            periodicidadMeses: suggestion.periodicidadMesesDefault ?? prev.periodicidadMeses,
            warningDays: suggestion.warningDaysDefault ?? prev.warningDays,
        }));
    };

    // Track user manual edits
    const setField = (field, value) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (suggestion) {
            setUserEdited((prev) => ({ ...prev, [field]: true }));
        }
    };

    // Unlock schemaKey for manual editing
    const unlockSchemaKey = () => {
        setSuggestionLocked(false);
    };

    // ─── Consistency warnings ───────────────────
    useEffect(() => {
        if (!suggestion || !formData.aplicaA?.length) {
            setConsistencyWarnings([]);
            return;
        }
        const suggestedSet = new Set(suggestion.aplicaA);
        const actualSet = new Set(formData.aplicaA);
        const warns = [];
        for (const v of actualSet) {
            if (!suggestedSet.has(v)) {
                warns.push(`"${formData.normaRef}" normalmente aplica a ${suggestion.aplicaA.join("+")} pero se incluyó ${v}.`);
            }
        }
        for (const v of suggestedSet) {
            if (!actualSet.has(v)) {
                warns.push(`"${formData.normaRef}" normalmente aplica a ${suggestion.aplicaA.join("+")} pero falta ${v}.`);
            }
        }
        setConsistencyWarnings(warns);
    }, [suggestion, formData.aplicaA, formData.normaRef]);

    // Auto-suggest codigo when schemaKey and norma change (only if no suggestion active)
    useEffect(() => {
        if (!suggestion && formData.schemaKey && !formData.codigo) {
            const normaCode = formData.normaRef?.replace(/\s+/g, "").replace("IRAM", "IRAM") || "";
            const code = normaCode
                ? `${normaCode}_${formData.schemaKey}`.toUpperCase().replace(/\s+/g, "_")
                : formData.schemaKey;
            setFormData((prev) => ({ ...prev, codigo: code }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.schemaKey, formData.normaRef, suggestion]);

    // ─── Validation per step ────────────────────
    const canProceed = () => {
        switch (activeStep) {
            case 0: return !!formData.material;
            case 1: return true; // norma is optional
            case 2: return !!formData.schemaKey;
            case 3: return !!formData.codigo && !!formData.nombre && formData.aplicaA?.length > 0;
            default: return false;
        }
    };

    // ─── Save ───────────────────────────────────
    const handleSave = async () => {
        if (savingRef.current) return;
        if (!canProceed()) return;
        savingRef.current = true;
        setSaving(true);
        try {
            await createTipo({
                codigo: formData.codigo,
                nombre: formData.nombre,
                normaRef: formData.normaRef || null,
                normaId: formData.normaId || null,
                aplicaA: formData.aplicaA,
                categoria: formData.categoria,
                obligatorio: formData.obligatorio,
                periodicidadMeses: formData.periodicidadMeses,
                warningDays: formData.warningDays,
                visibleEnUI: formData.visibleEnUI,
                visibleEnCards: formData.visibleEnCards,
                visibleEnDosificacion: formData.perfil === "CORE",
                schemaKey: formData.schemaKey,
                perfil: formData.perfil,
                material: formData.material,
                orden: formData.orden,
            });
            showToast("success", `Tipo "${formData.codigo}" creado correctamente`);
            if (onCreated) onCreated();
        } catch (err) {
            const msg = err.response?.data?.error || err.message || "Error al crear tipo";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    // ─── Suggestion badge component ─────────────
    const SuggestionBadge = () => {
        if (!suggestion) return null;
        const hasEdits = Object.keys(userEdited).length > 0;
        return (
            <div className="flex align-items-center gap-2 mb-2">
                <Tag value="Sugerido por norma" icon="fa-solid fa-wand-magic-sparkles" severity="success" className="text-xs" />
                {hasEdits && (
                    <Button
                        label="Restaurar sugerencia"
                        icon="fa-solid fa-rotate-left"
                        size="small"
                        severity="secondary"
                        text
                        className="text-xs p-1"
                        onClick={applySuggestion}
                    />
                )}
            </div>
        );
    };

    // ─── Step content ───────────────────────────
    const renderStepContent = () => {
        switch (activeStep) {
            case 0:
                return (
                    <div className="flex flex-column gap-3 p-3">
                        <h3 className="mt-0 mb-2">Paso 1: Material</h3>
                        <p className="text-color-secondary mt-0 text-sm">
                            Seleccione el material al que pertenece el nuevo tipo de ensayo.
                        </p>
                        <Dropdown
                            value={formData.material}
                            options={MATERIAL_OPTIONS}
                            onChange={(e) => setFormData({ ...formData, material: e.value })}
                            className="w-full md:w-20rem"
                        />
                        <Message severity="info" text="Por ahora solo se soporta AGREGADOS. Cemento y hormigón próximamente." className="mt-2" />
                    </div>
                );
            case 1:
                return (
                    <div className="flex flex-column gap-3 p-3">
                        <h3 className="mt-0 mb-2">Paso 2: Norma</h3>
                        <p className="text-color-secondary mt-0 text-sm">
                            Seleccione la norma IRAM de referencia (opcional). Si hay una sugerencia, se autocompletarán los pasos siguientes.
                        </p>
                        <div className="flex flex-column gap-1">
                            <label className="font-semibold text-sm">Norma vinculada</label>
                            <Dropdown
                                value={formData.normaId}
                                options={normaOptions}
                                onChange={(e) => handleNormaChange(e.value)}
                                placeholder="Seleccionar norma..."
                                showClear
                                filter
                                filterPlaceholder="Buscar norma..."
                                className="w-full"
                            />
                        </div>
                        <div className="flex flex-column gap-1">
                            <label className="font-semibold text-sm">Referencia textual (normaRef)</label>
                            <InputText
                                value={formData.normaRef}
                                onChange={(e) => handleNormaRefChange(e.target.value)}
                                placeholder="e.g. IRAM 1505"
                                className="w-full md:w-20rem"
                            />
                        </div>
                        {suggestion && (
                            <div className="surface-ground border-round p-3 mt-1 flex align-items-center gap-2">
                                <Tag value="Sugerencia encontrada" icon="fa-solid fa-wand-magic-sparkles" severity="success" className="text-xs" />
                                <span className="text-sm">
                                    <span className="font-mono font-semibold">{suggestion.schemaKey}</span>
                                    {" — "}
                                    {suggestion.nombreSugerido}
                                    {" · "}
                                    <Tag value={suggestion.perfilDefault} severity={suggestion.perfilDefault === "CORE" ? "success" : "info"} className="text-xs" />
                                </span>
                            </div>
                        )}
                    </div>
                );
            case 2:
                return (
                    <div className="flex flex-column gap-3 p-3">
                        <h3 className="mt-0 mb-2">Paso 3: Método técnico (schemaKey)</h3>
                        <p className="text-color-secondary mt-0 text-sm">
                            El schema key define la estructura de resultado y el formulario de carga.
                            {suggestion && " El método fue sugerido por la norma seleccionada."}
                        </p>
                        <SuggestionBadge />
                        {suggestionLocked ? (
                            <div className="flex align-items-center gap-2">
                                <InputText
                                    value={formData.schemaKey || ""}
                                    disabled
                                    className="flex-1 font-mono"
                                />
                                <Button
                                    label="Editar manual"
                                    icon="fa-solid fa-pen"
                                    size="small"
                                    severity="warning"
                                    text
                                    onClick={unlockSchemaKey}
                                    tooltip="Desbloquear para seleccionar un método diferente al sugerido"
                                    tooltipOptions={{ position: "top" }}
                                />
                            </div>
                        ) : (
                            <Dropdown
                                value={formData.schemaKey}
                                options={schemaKeyDropdownOptions}
                                onChange={(e) => setField("schemaKey", e.value)}
                                placeholder="Seleccionar método..."
                                filter
                                className="w-full"
                            />
                        )}
                        {formData.schemaKey && (
                            <div className="surface-ground border-round p-3 mt-1">
                                <div className="flex align-items-center gap-2">
                                    <Tag value={formData.schemaKey} className="font-mono text-xs" />
                                    {schemaKeyOptions.find((s) => s.schemaKey === formData.schemaKey)?.modo && (
                                        <Tag
                                            value={schemaKeyOptions.find((s) => s.schemaKey === formData.schemaKey).modo}
                                            severity={schemaKeyOptions.find((s) => s.schemaKey === formData.schemaKey).modo === "GRANULO" ? "warning" : "info"}
                                            className="text-xs"
                                        />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 3:
                return (
                    <div className="flex flex-column gap-3 p-3">
                        <h3 className="mt-0 mb-2">Paso 4: Configuración</h3>
                        <SuggestionBadge />

                        {/* Consistency warnings */}
                        {consistencyWarnings.length > 0 && (
                            <div className="flex flex-column gap-1 mb-1">
                                {consistencyWarnings.map((w, i) => (
                                    <Message key={i} severity="warn" text={w} className="w-full text-xs" />
                                ))}
                            </div>
                        )}

                        <div className="flex gap-3">
                            <div className="flex flex-column gap-1 flex-1">
                                <label className="font-semibold text-sm">Código * <span className="text-xs text-500 font-normal">(auto-generado, no editable)</span></label>
                                <InputText
                                    value={formData.codigo}
                                    disabled
                                    className="font-mono"
                                    tooltip="El código se genera automáticamente a partir de la norma y el método. No es editable."
                                    tooltipOptions={{ position: "top" }}
                                />
                            </div>
                            <div className="flex flex-column gap-1 flex-1">
                                <label className="font-semibold text-sm">Nombre *</label>
                                <InputText
                                    value={formData.nombre}
                                    onChange={(e) => setField("nombre", e.target.value)}
                                    placeholder="Nombre descriptivo del ensayo"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="flex flex-column gap-1 flex-1">
                                <label className="font-semibold text-sm">Aplica a *</label>
                                <MultiSelect
                                    value={formData.aplicaA}
                                    options={APLICA_OPTIONS}
                                    onChange={(e) => setField("aplicaA", e.value)}
                                    placeholder="Seleccionar..."
                                    display="chip"
                                />
                            </div>
                            <div className="flex flex-column gap-1 flex-1">
                                <label className="font-semibold text-sm">Categoría</label>
                                <Dropdown
                                    value={formData.categoria}
                                    options={CATEGORIA_OPTIONS}
                                    onChange={(e) => setField("categoria", e.value)}
                                />
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <div className="flex flex-column gap-1" style={{ width: "160px" }}>
                                <label className="font-semibold text-sm">Perfil</label>
                                <Dropdown
                                    value={formData.perfil}
                                    options={[{ label: "CORE", value: "CORE" }, { label: "AVANZADO", value: "AVANZADO" }]}
                                    onChange={(e) => setField("perfil", e.value)}
                                />
                            </div>
                            <div className="flex flex-column gap-1" style={{ width: "130px" }}>
                                <label className="font-semibold text-sm">Periodicidad (meses)</label>
                                <InputNumber
                                    value={formData.periodicidadMeses}
                                    onValueChange={(e) => setField("periodicidadMeses", e.value)}
                                    min={0}
                                    useGrouping={false}
                                    placeholder="—"
                                />
                            </div>
                            <div className="flex flex-column gap-1" style={{ width: "120px" }}>
                                <label className="font-semibold text-sm">Warning (días)</label>
                                <InputNumber
                                    value={formData.warningDays}
                                    onValueChange={(e) => setField("warningDays", e.value)}
                                    min={0}
                                    useGrouping={false}
                                    placeholder="—"
                                />
                            </div>
                            <div className="flex flex-column gap-1" style={{ width: "80px" }}>
                                <label className="font-semibold text-sm">Orden</label>
                                <InputNumber
                                    value={formData.orden}
                                    onValueChange={(e) => setField("orden", e.value)}
                                    min={0}
                                    useGrouping={false}
                                />
                            </div>
                        </div>

                        <div className="flex gap-4 flex-wrap pt-1">
                            <div className="flex align-items-center gap-2">
                                <InputSwitch
                                    checked={formData.obligatorio}
                                    onChange={(e) => setField("obligatorio", e.value)}
                                />
                                <label className="text-sm">Obligatorio</label>
                            </div>
                            <div className="flex align-items-center gap-2">
                                <InputSwitch
                                    checked={formData.visibleEnUI}
                                    onChange={(e) => setField("visibleEnUI", e.value)}
                                />
                                <label className="text-sm">Visible en UI</label>
                            </div>
                            <div className="flex align-items-center gap-2">
                                <InputSwitch
                                    checked={formData.visibleEnCards}
                                    onChange={(e) => setField("visibleEnCards", e.value)}
                                />
                                <label className="text-sm">Visible en cards</label>
                            </div>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    // ─── Render ─────────────────────────────────
    return (
        <Dialog
            header="Nuevo tipo de ensayo"
            visible={visible}
            onHide={onHide}
            style={{ width: "90vw", maxWidth: "700px" }}
            modal
            closable
            footer={
                <div className="flex justify-content-between">
                    <Button
                        label="Anterior"
                        icon="fa-solid fa-arrow-left"
                        severity="secondary"
                        text
                        onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
                        disabled={activeStep === 0}
                    />
                    {activeStep < 3 ? (
                        <Button
                            label="Siguiente"
                            icon="fa-solid fa-arrow-right"
                            iconPos="right"
                            onClick={() => setActiveStep((s) => Math.min(3, s + 1))}
                            disabled={!canProceed()}
                        />
                    ) : (
                        <Button
                            label="Crear tipo de ensayo"
                            icon="fa-solid fa-save"
                            onClick={handleSave}
                            loading={saving}
                            disabled={!canProceed() || saving}
                        />
                    )}
                </div>
            }
        >
            <Steps
                model={WIZARD_STEPS}
                activeIndex={activeStep}
                onSelect={(e) => setActiveStep(e.index)}
                readOnly={false}
                className="mb-3"
            />
            {renderStepContent()}
        </Dialog>
    );
};

export default NuevoTipoEnsayoWizard;
