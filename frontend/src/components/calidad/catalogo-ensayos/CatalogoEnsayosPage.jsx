import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Dropdown } from "primereact/dropdown";
import { InputSwitch } from "primereact/inputswitch";
import { SelectButton } from "primereact/selectbutton";
import { confirmDialog } from "primereact/confirmdialog";
import { Message } from "primereact/message";
import { FileUpload } from "primereact/fileupload";
import { Checkbox } from "primereact/checkbox";
import { useToast } from "../../../context/ToastContext";
import { useConfig } from "../../../context/ConfigContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { getTipos, updateTipo, createTipo, patchTipo, applyTemplate, getEnsayoCountsByTipo, getEnsayosByTipo, exportEnsayosPaquete, previewImportEnsayos, importEnsayosPaquete } from "../../../services/agregadoEnsayoService";
import { getNormas } from "../../../services/normaService";
import { CumplimientoBadge } from "../common/CumplimientoBadge";
import NuevoTipoEnsayoWizard from "./NuevoTipoEnsayoWizard";
import SnapshotsManagerDialog from "./SnapshotsManagerDialog";
import WizardCatalogoEnsayos from "./WizardCatalogoEnsayos";
import "./CatalogoEnsayos.css";

// ─── Constants ──────────────────────────────────────────────
const MATERIAL_OPTIONS = [
    { label: "Agregados", value: "AGREGADOS" },
    { label: "Hormigón (próximamente)", value: "HORMIGON", disabled: true },
    { label: "Cemento (próximamente)", value: "CEMENTO", disabled: true },
    { label: "Agua", value: "AGUA" },
    { label: "Aditivos (próximamente)", value: "ADITIVOS", disabled: true },
];

const PERFIL_OPTIONS = [
    { label: "Todos", value: "ALL" },
    { label: "Core", value: "CORE" },
    { label: "Avanzado", value: "AVANZADO" },
];

// PR2: filtro de contexto Hormigón / TBS / Todos (default según Config.usaTBS).
const CONTEXTO_OPTIONS = [
    { label: "Hormigón", value: "HORMIGON" },
    { label: "TBS", value: "TBS" },
    { label: "Todos", value: "TODOS" },
];

const NIVEL_OPTIONS = [
    { label: "—", value: "NINGUNA" },
    { label: "Básica", value: "BASICA" },
    { label: "Avanzada", value: "AVANZADA" },
];

const CONTEXTO_FILTRO_LS_KEY = "hormiqual.catalogoEnsayos.contextoFiltro";

const CATEGORIA_LABELS = {
    fisica: "Física",
    mecanica: "Mecánica",
    limpieza: "Limpieza",
    forma: "Forma",
    durabilidad: "Durabilidad",
    otros: "Otros",
};

const CATEGORIA_SEVERITIES = {
    fisica: "info",
    mecanica: "warning",
    limpieza: "success",
    forma: null,
    durabilidad: "danger",
    otros: "secondary",
};

// ─── Component ──────────────────────────────────────────────
const CatalogoEnsayosPage = () => {
    const cfg = useConfig();
    const [tipos, setTipos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [material, setMaterial] = useState("AGREGADOS");
    const [searchTerm, setSearchTerm] = useState("");
    const [showHidden, setShowHidden] = useState(false);

    const [perfilFilter, setPerfilFilter] = useState("ALL");
    const [first, setFirst] = useState(0);

    // PR2: filtro de contexto. Default depende de Config.usaTBS:
    //   - usaTBS=true  → "TODOS" (mostrar todo)
    //   - usaTBS=false → "HORMIGON" (esconder ensayos solo-TBS por default)
    // Se persiste en localStorage para no resetear en cada navegación.
    const [contextoFiltro, setContextoFiltro] = useState(() => {
        try {
            const stored = localStorage.getItem(CONTEXTO_FILTRO_LS_KEY);
            if (stored && CONTEXTO_OPTIONS.some(o => o.value === stored)) return stored;
        } catch { /* localStorage no disponible */ }
        return cfg?.usaTBS ? "TODOS" : "HORMIGON";
    });
    useEffect(() => {
        try { localStorage.setItem(CONTEXTO_FILTRO_LS_KEY, contextoFiltro); } catch { /* ignore */ }
    }, [contextoFiltro]);

    // Edit dialog
    const [editVisible, setEditVisible] = useState(false);
    const [editData, setEditData] = useState(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);

    // Wizard "alta de tipo de ensayo" (existente)
    const [wizardVisible, setWizardVisible] = useState(false);

    // Wizard "configuración asistida del catálogo" (nuevo, modelo Liquidaciones)
    const [setupWizardVisible, setSetupWizardVisible] = useState(false);
    const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
        typeof window !== "undefined" && localStorage.getItem("cat_ens_wizard_paused") === "1"
    );

    // Template apply
    const [applyingTemplate, setApplyingTemplate] = useState(false);

    // Visible API error
    const [apiError, setApiError] = useState(null);

    // Normas catalog for dropdown
    const [normasList, setNormasList] = useState([]);

    // Ensayo counts per tipo
    const [ensayoCounts, setEnsayoCounts] = useState({});

    // Ensayo detail dialog
    const [ensayoDetailVisible, setEnsayoDetailVisible] = useState(false);
    const [ensayoDetailTipo, setEnsayoDetailTipo] = useState(null);
    const [ensayoDetailList, setEnsayoDetailList] = useState([]);
    const [ensayoDetailLoading, setEnsayoDetailLoading] = useState(false);
    const [ensayoDetailShowInactive, setEnsayoDetailShowInactive] = useState(false);

    // Import/Export paquete
    const [importPreview, setImportPreview] = useState(null);
    const [importVisible, setImportVisible] = useState(false);
    const [importando, setImportando] = useState(false);
    const importandoRef = useRef(false);
    const [importResultado, setImportResultado] = useState(null);
    const [importResultVisible, setImportResultVisible] = useState(false);
    const [diffExpanded, setDiffExpanded] = useState({});

    // Snapshots persistidos del catálogo (PR5)
    const [snapshotsVisible, setSnapshotsVisible] = useState(false);
    // Banner explicativo (dismissable, recordado en localStorage)
    const [bannerDismissed, setBannerDismissed] = useState(() => {
        try { return localStorage.getItem("hormiqual.catalogoEnsayos.bannerDismissed") === "1"; } catch { return false; }
    });
    const dismissBanner = () => {
        setBannerDismissed(true);
        try { localStorage.setItem("hormiqual.catalogoEnsayos.bannerDismissed", "1"); } catch {}
    };
    const showBanner = () => {
        setBannerDismissed(false);
        try { localStorage.removeItem("hormiqual.catalogoEnsayos.bannerDismissed"); } catch {}
    };
    // Toggle "herramientas avanzadas" (export/import JSON, instalar set base)
    const [advToolsVisible, setAdvToolsVisible] = useState(false);
    const importFileRef = useRef(null);

    const showToast = useToast();

    // ─── Fetch ──────────────────────────────────
    const fetchTipos = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getTipos({ material });
            setTipos(data);
            setApiError(null);
        } catch (err) {
            console.error("Error al obtener tipos:", err);
            showToast("error", "No se pudieron cargar los tipos de ensayo");
            setApiError("No se pudieron cargar los tipos de ensayo: " + (err.response?.data?.error || err.message || "Error desconocido"));
        } finally {
            setLoading(false);
        }
    }, [material, showToast]);

    const fetchNormas = useCallback(async () => {
        try {
            const data = await getNormas();
            setNormasList(data);
        } catch {
            // Non-critical — norma dropdown just won't populate
        }
    }, []);

    const fetchEnsayoCounts = useCallback(async () => {
        try {
            const counts = await getEnsayoCountsByTipo();
            setEnsayoCounts(counts);
        } catch {
            // Non-critical
        }
    }, []);

    useEffect(() => { fetchTipos(); }, [fetchTipos]);
    useEffect(() => { fetchNormas(); }, [fetchNormas]);
    useEffect(() => { fetchEnsayoCounts(); }, [fetchEnsayoCounts]);

    // Re-evaluamos el flag de "wizard pausado" cuando la pestaña vuelve a foco
    // (ej. el user fue a Materiales / Normas y volvió) y al abrir/cerrar el wizard.
    useEffect(() => {
        const sync = () => setSetupWizardPaused(localStorage.getItem("cat_ens_wizard_paused") === "1");
        sync();
        window.addEventListener("focus", sync);
        document.addEventListener("visibilitychange", sync);
        return () => {
            window.removeEventListener("focus", sync);
            document.removeEventListener("visibilitychange", sync);
        };
    }, [setupWizardVisible]);

    const descartarSetupWizard = () => {
        localStorage.removeItem("cat_ens_wizard_step");
        localStorage.removeItem("cat_ens_wizard_paused");
        setSetupWizardPaused(false);
    };

    const recargarTodoSetup = () => {
        fetchTipos();
        fetchEnsayoCounts();
    };

    // ─── Filtering ──────────────────────────────
    const filtered = useMemo(() => {
        return tipos.filter((t) => {
            // Always hide derivados (not relevant in catalog view)
            if (t.esDerivado) return false;
            // Hide non-visible unless toggle is on
            if (!showHidden && t.visibleEnUI === false) return false;
            // Perfil filter
            if (perfilFilter !== "ALL" && t.perfil && t.perfil !== perfilFilter) return false;
            // PR2: filtro por contexto. Si "HORMIGON", ocultar ensayos solo-TBS;
            // si "TBS", ocultar ensayos solo-Hormigón. "TODOS" no filtra.
            if (contextoFiltro === "HORMIGON" && !t.aplicaAHormigon) return false;
            if (contextoFiltro === "TBS" && !t.aplicaATBS) return false;
            // Search filter
            if (searchTerm) {
                const s = searchTerm.toLowerCase();
                return (
                    (t.codigo || "").toLowerCase().includes(s) ||
                    (t.nombre || "").toLowerCase().includes(s) ||
                    (t.normaRef || "").toLowerCase().includes(s) ||
                    (t.schemaKey || "").toLowerCase().includes(s)
                );
            }
            return true;
        });
    }, [tipos, searchTerm, showHidden, perfilFilter, contextoFiltro]);

    // Default de contexto activo según Config.usaTBS (para el botón "Limpiar filtros").
    const contextoDefault = cfg?.usaTBS ? "TODOS" : "HORMIGON";
    const hayFiltrosActivos =
        searchTerm.length > 0 ||
        perfilFilter !== "ALL" ||
        contextoFiltro !== contextoDefault ||
        showHidden;
    const limpiarFiltros = () => {
        setSearchTerm("");
        setPerfilFilter("ALL");
        setContextoFiltro(contextoDefault);
        setShowHidden(false);
        setFirst(0);
    };

    // ─── Edit actions ───────────────────────────
    const openEdit = (tipo) => {
        let rawAplicaA = tipo.aplicaA;
        // Normalize: if stored as JSON string, parse it
        if (typeof rawAplicaA === 'string') {
            try { rawAplicaA = JSON.parse(rawAplicaA); } catch (_) { /* keep as string */ }
        }
        const originalAplicaA = Array.isArray(rawAplicaA)
            ? [...rawAplicaA]
            : (typeof rawAplicaA === 'string' && rawAplicaA ? [rawAplicaA] : []);
        setEditData({
            id: tipo.idAgregadoEnsayoTipo,
            codigo: tipo.codigo,
            nombre: tipo.nombre || "",
            normaRef: tipo.normaRef || "",
            normaId: tipo.normaId || null,
            aplicaA: originalAplicaA,
            _aplicaATouched: false,
            categoria: tipo.categoria || "otros",
            obligatorio: !!tipo.obligatorio,
            periodicidadMeses: tipo.periodicidadMeses ?? null,
            warningDays: tipo.warningDays ?? null,
            visibleEnUI: tipo.visibleEnUI !== false,
            visibleEnCards: tipo.visibleEnCards !== false,
            visibleEnCaracterizacion: !!tipo.visibleEnCaracterizacion,
            orden: tipo.orden ?? 0,
            material: tipo.material || "AGREGADOS",
            esDerivado: !!tipo.esDerivado,
            derivadoDeCodigo: tipo.derivadoDeCodigo || null,
            derivadoClave: tipo.derivadoClave || null,
            schemaKey: tipo.schemaKey || "",
            perfil: tipo.perfil || "AVANZADO",
            // PR2 multi-contexto
            aplicaAHormigon: tipo.aplicaAHormigon !== false,  // default true por seguridad
            aplicaATBS: !!tipo.aplicaATBS,
            nivelCaracterizacionHormigon: tipo.nivelCaracterizacionHormigon || "NINGUNA",
            nivelCaracterizacionTBS: tipo.nivelCaracterizacionTBS || "NINGUNA",
            obligatorioHormigon: !!tipo.obligatorioHormigon,
            obligatorioTBS: !!tipo.obligatorioTBS,
        });
        setEditVisible(true);
    };

    const doSave = async () => {
        if (savingRef.current) return;
        if (!editData) return;
        savingRef.current = true;
        setSaving(true);
        try {
            // Protected fields (not sent): codigo, schemaKey, esDerivado, material, normaRef, aplicaA, categoria
            const payload = {
                nombre: editData.nombre,
                normaId: editData.normaId || null,
                obligatorio: editData.obligatorio,
                periodicidadMeses: editData.periodicidadMeses,
                warningDays: editData.warningDays,
                visibleEnUI: editData.visibleEnUI,
                visibleEnCards: editData.visibleEnCards,
                visibleEnCaracterizacion: editData.visibleEnCaracterizacion,
                orden: editData.orden,
                perfil: editData.perfil,
                // PR2 multi-contexto. El hook beforeValidate del backend
                // aplicará coherencia (NINGUNA→obligatorio=false, BASICA→true).
                aplicaAHormigon: editData.aplicaAHormigon,
                aplicaATBS: editData.aplicaATBS,
                nivelCaracterizacionHormigon: editData.nivelCaracterizacionHormigon,
                nivelCaracterizacionTBS: editData.nivelCaracterizacionTBS,
                obligatorioHormigon: editData.obligatorioHormigon,
                obligatorioTBS: editData.obligatorioTBS,
            };
            await updateTipo(editData.id, payload);
            showToast("success", "Tipo de ensayo actualizado");
            setEditVisible(false);
            fetchTipos();
        } catch (err) {
            const msg = err.response?.data?.error || "Error al guardar";
            showToast("error", msg);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleSave = () => doSave();

    // ─── Column templates ───────────────────────
    const normaBody = (row) => {
        if (!row.normaRef) return <span className="text-400">—</span>;
        return <span className="text-sm">{row.normaRef}</span>;
    };

    const perfilBody = (row) => {
        if (!row.perfil) return "—";
        return (
            <Tag
                value={row.perfil}
                severity={row.perfil === "CORE" ? "success" : "info"}
                className="text-xs"
            />
        );
    };

    const aplicaABody = (row) => {
        let raw = row.aplicaA;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { /* ignore */ } }
        const arr = Array.isArray(raw) ? raw : [];
        if (!arr.length) return "—";
        return arr.map((v) => (
            <Tag
                key={v}
                value={v}
                severity={v === "FINO" ? "info" : "warning"}
                className="mr-1 text-xs"
            />
        ));
    };

    const categoriaBody = (row) => {
        if (!row.categoria) return "—";
        return (
            <Tag
                value={CATEGORIA_LABELS[row.categoria] || row.categoria}
                severity={CATEGORIA_SEVERITIES[row.categoria] || null}
                className="text-xs"
            />
        );
    };

    const periodicidadBody = (row) => {
        if (!row.periodicidadMeses) return <span className="text-400">—</span>;
        return <span className="text-sm">{row.periodicidadMeses}m</span>;
    };

    const warningBody = (row) => {
        if (!row.warningDays) return <span className="text-400">—</span>;
        return <span className="text-sm">{row.warningDays}d</span>;
    };

    const ensayoCountBody = (row) => {
        const c = ensayoCounts[row.idAgregadoEnsayoTipo];
        const activos = c?.activos || 0;
        const total = c?.total || 0;
        if (total === 0) return <span className="text-400">0</span>;
        return (
            <Button
                label={String(activos)}
                badge={total !== activos ? String(total) : null}
                badgeClassName="p-badge-secondary"
                size="small"
                text
                severity={activos > 0 ? "info" : "secondary"}
                tooltip={`${activos} activo(s), ${total} total`}
                tooltipOptions={{ position: "top" }}
                onClick={() => openEnsayoDetail(row)}
                className="p-0"
                style={{ minWidth: "auto" }}
            />
        );
    };

    const openEnsayoDetail = async (tipo) => {
        setEnsayoDetailTipo(tipo);
        setEnsayoDetailVisible(true);
        setEnsayoDetailLoading(true);
        setEnsayoDetailShowInactive(false);
        try {
            const data = await getEnsayosByTipo(tipo.idAgregadoEnsayoTipo, { includeInactive: true });
            setEnsayoDetailList(data);
        } catch {
            showToast("error", "No se pudieron cargar los ensayos");
            setEnsayoDetailList([]);
        } finally {
            setEnsayoDetailLoading(false);
        }
    };

    // El borrado de tipos de ensayo está deshabilitado a propósito: el catálogo
    // es la fuente de verdad para evaluación de cumplimiento normativo. Para
    // ocultar un ensayo del UI usar el toggle "UI" (visibleEnUI). Para
    // restaurar el set inicial usar el botón "Crear ensayos".

    const actionsBody = (row) => {
        const oculto = row.visibleEnUI === false;
        return (
            <div className="flex gap-1">
                <Button
                    icon="fa-solid fa-pen"
                    rounded
                    text
                    size="small"
                    tooltip="Editar"
                    tooltipOptions={{ position: "top" }}
                    onClick={() => openEdit(row)}
                />
                <Button
                    icon={oculto ? "fa-solid fa-eye" : "fa-regular fa-eye-slash"}
                    rounded
                    text
                    size="small"
                    severity={oculto ? "info" : "secondary"}
                    tooltip={oculto ? "Restaurar (mostrar en catálogo)" : "Ocultar del catálogo"}
                    tooltipOptions={{ position: "top" }}
                    onClick={() => toggleVisibleEnUI(row)}
                />
            </div>
        );
    };

    // ─── Apply template ─────────────────────────
    const TEMPLATE_MAP = { AGREGADOS: "CORE_AGREGADOS", AGUA: "CORE_AGUA" };
    const templateAvailable = !!TEMPLATE_MAP[material];

    const handleApplyTemplate = () => {
        const templateKey = TEMPLATE_MAP[material];
        if (!templateKey) return;
        const materialLabel = MATERIAL_OPTIONS.find(o => o.value === material)?.label || material;
        confirmDialog({
            message: `Se crearán los ensayos de ${materialLabel} que falten en el catálogo. Los ensayos que ya existen NO se modifican — tu configuración personalizada se respeta. ¿Continuar?`,
            header: `Crear ensayos de ${materialLabel}`,
            icon: "fa-solid fa-flask-vial",
            acceptLabel: "Crear",
            rejectLabel: "Cancelar",
            accept: async () => {
                setApplyingTemplate(true);
                setApiError(null);
                try {
                    const result = await applyTemplate({ material, template: templateKey });
                    const { created = 0, skipped = 0, total = 0 } = result;
                    if (created > 0) {
                        showToast("success", `${created} ensayo${created > 1 ? "s" : ""} creado${created > 1 ? "s" : ""}. ${skipped} ya existían.`);
                    } else {
                        showToast("info", `El catálogo ya tiene los ${total} ensayos definidos. Sin cambios.`);
                    }
                    fetchTipos();
                } catch (err) {
                    const msg = err.response?.data?.error || err.message || "Error al crear ensayos";
                    showToast("error", msg);
                    setApiError(msg);
                } finally {
                    setApplyingTemplate(false);
                }
            },
        });
    };

    // ─── Export/Import paquete ────────────────────
    const handleExport = async () => {
        try {
            const paquete = await exportEnsayosPaquete();
            const blob = new Blob([JSON.stringify(paquete, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `ensayos_export_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast("success", `${paquete.cantidad} tipos de ensayo exportados`);
        } catch (err) {
            showToast("error", "Error al exportar ensayos");
        }
    };

    const handleImportFile = async (e) => {
        const file = e.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            const paquete = JSON.parse(text);
            const preview = await previewImportEnsayos(paquete);
            setImportPreview({ ...preview, _paquete: paquete });
            setDiffExpanded({});
            setImportVisible(true);
        } catch (err) {
            if (err instanceof SyntaxError) {
                showToast("error", "El archivo no es un JSON válido");
            } else {
                showToast("error", err.response?.data?.error || "Error al previsualizar importación");
            }
        } finally {
            if (importFileRef.current) importFileRef.current.clear();
        }
    };

    const toggleImportItem = (codigo) => {
        setImportPreview((prev) => ({
            ...prev,
            preview: prev.preview.map((p) =>
                p.codigo === codigo ? { ...p, selected: !p.selected } : p
            ),
        }));
    };

    const selectImportGroup = (mode) => {
        setImportPreview((prev) => ({
            ...prev,
            preview: prev.preview.map((p) => {
                if (mode === "nuevos") return { ...p, selected: p.estado === "nuevo" };
                if (mode === "nuevos+mod") return { ...p, selected: p.estado !== "igual" };
                if (mode === "todos") return { ...p, selected: true };
                if (mode === "ninguno") return { ...p, selected: false };
                return p;
            }),
        }));
    };

    const importSelectedCount = importPreview?.preview?.filter((p) => p.selected).length || 0;

    const handleConfirmImport = async () => {
        if (importandoRef.current) return;
        if (!importPreview?._paquete || importSelectedCount === 0) return;
        importandoRef.current = true;
        setImportando(true);
        try {
            const seleccionados = importPreview.preview.filter((p) => p.selected).map((p) => p.codigo);
            const resultado = await importEnsayosPaquete(importPreview._paquete.ensayos, seleccionados);
            setImportResultado(resultado);
            setImportVisible(false);
            setImportResultVisible(true);
            fetchTipos();
            fetchEnsayoCounts();
        } catch (err) {
            showToast("error", err.response?.data?.error || "Error al importar");
        } finally {
            importandoRef.current = false;
            setImportando(false);
        }
    };

    // ─── PR2: helpers para chips inline multi-contexto ───
    // Patch genérico que actualiza un campo + aplica coherencia local equivalente
    // al hook backend (NINGUNA→obligatorio=false, BASICA→obligatorio=true,
    // aplicaA=false→nivel=NINGUNA+obligatorio=false). El backend valida igual
    // pero esto evita un round-trip visualmente inconsistente.
    const aplicarCoherenciaLocal = (row, ctx /* 'Hormigon' | 'TBS' */) => {
        const aplicaKey = `aplicaA${ctx}`;
        const nivelKey = `nivelCaracterizacion${ctx}`;
        const oblKey = `obligatorio${ctx}`;
        let nivel = row[nivelKey];
        let obl = row[oblKey];
        if (row[aplicaKey] === false) {
            nivel = "NINGUNA";
            obl = false;
        } else if (nivel === "NINGUNA") {
            obl = false;
        } else if (nivel === "BASICA") {
            obl = true;
        }
        return { [aplicaKey]: row[aplicaKey], [nivelKey]: nivel, [oblKey]: obl };
    };

    const patchTipoMultiCtx = async (row, ctx, partial) => {
        // partial: { aplicaAHormigon? | aplicaATBS? | nivelCaracterizacionX? | obligatorioX? }
        const merged = { ...row, ...partial };
        const coherente = aplicarCoherenciaLocal(merged, ctx);
        const payload = { ...partial, ...coherente };
        try {
            await patchTipo(row.idAgregadoEnsayoTipo, payload);
            setTipos((prev) =>
                prev.map((t) =>
                    t.idAgregadoEnsayoTipo === row.idAgregadoEnsayoTipo
                        ? { ...t, ...payload }
                        : t
                )
            );
        } catch (err) {
            const msg = err.response?.data?.error || "No se pudo actualizar";
            showToast("error", msg);
        }
    };

    // PR2: ocultar/restaurar fila (visibleEnUI=false). Soft hide por tenant.
    const toggleVisibleEnUI = async (row) => {
        const newVal = !(row.visibleEnUI !== false);
        try {
            await patchTipo(row.idAgregadoEnsayoTipo, { visibleEnUI: newVal });
            setTipos((prev) =>
                prev.map((t) =>
                    t.idAgregadoEnsayoTipo === row.idAgregadoEnsayoTipo
                        ? { ...t, visibleEnUI: newVal }
                        : t
                )
            );
            showToast("success", newVal ? "Ensayo restaurado" : "Ensayo ocultado del catálogo");
        } catch {
            showToast("error", "No se pudo actualizar visibilidad");
        }
    };

    // Inline toggle for visibleEnCards
    const toggleVisibleEnCards = async (row) => {
        const newVal = !(row.visibleEnCards !== false);
        try {
            await patchTipo(row.idAgregadoEnsayoTipo, { visibleEnCards: newVal });
            setTipos((prev) =>
                prev.map((t) =>
                    t.idAgregadoEnsayoTipo === row.idAgregadoEnsayoTipo
                        ? { ...t, visibleEnCards: newVal }
                        : t
                )
            );
            showToast("success", `visibleEnCards → ${newVal}`);
        } catch {
            showToast("error", "No se pudo actualizar");
        }
    };

    const visibleEnCardsBody = (row) => (
        <InputSwitch
            checked={row.visibleEnCards !== false}
            onChange={() => toggleVisibleEnCards(row)}
            tooltip={row.visibleEnCards !== false ? "Visible en cards" : "Oculto en cards"}
            tooltipOptions={{ position: "top" }}
        />
    );

    // PR2: chips clicables para "Aplica a (contexto)" — Hormigón / TBS.
    const contextoBody = (row) => {
        const chip = (active, onClick, label, tooltip) => (
            <Tag
                value={label}
                severity={active ? "success" : "secondary"}
                className="text-xs cursor-pointer"
                style={{
                    opacity: active ? 1 : 0.4,
                    minWidth: "32px",
                    textAlign: "center",
                }}
                onClick={onClick}
                title={tooltip}
            />
        );
        return (
            <div className="flex gap-1">
                {chip(
                    row.aplicaAHormigon,
                    () => patchTipoMultiCtx(row, "Hormigon", { aplicaAHormigon: !row.aplicaAHormigon }),
                    "H",
                    row.aplicaAHormigon ? "Aplica a Hormigón (click para desactivar)" : "No aplica a Hormigón (click para activar)"
                )}
                {chip(
                    row.aplicaATBS,
                    () => patchTipoMultiCtx(row, "TBS", { aplicaATBS: !row.aplicaATBS }),
                    "TBS",
                    row.aplicaATBS ? "Aplica a TBS (click para desactivar)" : "No aplica a TBS (click para activar)"
                )}
            </div>
        );
    };

    // PR2: chips de "Caract." con dropdown inline para nivel por contexto.
    const caractMultiBody = (row) => {
        const renderChip = (ctxLabel, ctxKey, aplica, nivel) => {
            if (!aplica) {
                return (
                    <Tag
                        value={`${ctxLabel}: —`}
                        severity="secondary"
                        className="text-xs"
                        style={{ opacity: 0.4 }}
                    />
                );
            }
            const sevByNivel = { NINGUNA: "secondary", BASICA: "success", AVANZADA: "info" };
            const labelByNivel = { NINGUNA: "—", BASICA: "Bás.", AVANZADA: "Avz." };
            return (
                <Dropdown
                    value={nivel}
                    options={NIVEL_OPTIONS}
                    onChange={(e) => patchTipoMultiCtx(row, ctxKey, { [`nivelCaracterizacion${ctxKey}`]: e.value })}
                    valueTemplate={() => (
                        <Tag
                            value={`${ctxLabel}: ${labelByNivel[nivel] || nivel}`}
                            severity={sevByNivel[nivel] || "secondary"}
                            className="text-xs cursor-pointer"
                        />
                    )}
                    style={{ border: "none", background: "transparent" }}
                    panelClassName="text-sm"
                />
            );
        };
        return (
            <div className="flex flex-column gap-1">
                {renderChip("H", "Hormigon", row.aplicaAHormigon, row.nivelCaracterizacionHormigon || "NINGUNA")}
                {renderChip("TBS", "TBS", row.aplicaATBS, row.nivelCaracterizacionTBS || "NINGUNA")}
            </div>
        );
    };

    // PR2: chips de "Oblig." por contexto. Disabled cuando nivel=NINGUNA o BASICA.
    const obligMultiBody = (row) => {
        const renderChip = (ctxLabel, ctxKey, aplica, nivel, oblig) => {
            const disabled = !aplica || nivel === "NINGUNA" || nivel === "BASICA";
            const tooltip = !aplica
                ? `No aplica a ${ctxLabel}`
                : nivel === "NINGUNA"
                    ? "Caract. NINGUNA → no exigible"
                    : nivel === "BASICA"
                        ? "Caract. BÁSICA → siempre obligatorio (no editable)"
                        : oblig ? "Obligatorio (click para desactivar)" : "Opcional (click para activar)";
            const sev = !aplica ? "secondary" : oblig ? "danger" : "secondary";
            return (
                <Tag
                    value={`${ctxLabel}${oblig ? " ✓" : ""}`}
                    severity={sev}
                    className={`text-xs ${disabled ? "" : "cursor-pointer"}`}
                    style={{ opacity: disabled && !oblig ? 0.4 : 1, minWidth: "38px", textAlign: "center" }}
                    onClick={disabled ? undefined : () =>
                        patchTipoMultiCtx(row, ctxKey, { [`obligatorio${ctxKey}`]: !oblig })}
                    title={tooltip}
                />
            );
        };
        return (
            <div className="flex flex-column gap-1">
                {renderChip("H", "Hormigon", row.aplicaAHormigon, row.nivelCaracterizacionHormigon || "NINGUNA", !!row.obligatorioHormigon)}
                {renderChip("TBS", "TBS", row.aplicaATBS, row.nivelCaracterizacionTBS || "NINGUNA", !!row.obligatorioTBS)}
            </div>
        );
    };

    // ─── Norma options for dropdown ─────────────
    const normaOptions = useMemo(() => {
        return [
            { label: "(Sin norma vinculada)", value: null },
            ...normasList.map((n) => ({
                label: `${n.codigo} — ${n.titulo}`,
                value: n.id,
            })),
        ];
    }, [normasList]);

    // ─── Render ─────────────────────────────────
    if (loading) return <LoadSpinner />;

    return (
        <div className="p-4">
            {/* Breadcrumb */}
            <div className="text-sm mb-2 flex align-items-center gap-1 text-color-secondary">
                <Link to="/calidad/catalogos" className="text-primary no-underline hover:underline">Calidad</Link>
                <i className="fa-solid fa-chevron-right text-xs mx-1" />
                <Link to="/calidad/catalogos" className="text-primary no-underline hover:underline">Catálogos</Link>
                <i className="fa-solid fa-chevron-right text-xs mx-1" />
                <span className="font-semibold text-color">Catálogo de ensayos</span>
            </div>

            {/* Banner de wizard pausado — solo si el user dejó el asistente a la mitad */}
            {setupWizardPaused && !setupWizardVisible && (
                <div className="mant-wizard-resume-banner">
                    <div className="mant-wizard-resume-banner-text">
                        <i className="fa-solid fa-wand-magic-sparkles" />
                        <div>
                            <strong>Configuración del módulo en pausa</strong>
                            <small>Continuá donde dejaste el asistente para terminar de dejar todo listo.</small>
                        </div>
                    </div>
                    <div className="mant-wizard-resume-banner-actions">
                        <Button
                            label="Descartar"
                            size="small"
                            text
                            severity="secondary"
                            onClick={descartarSetupWizard}
                        />
                        <Button
                            label="Continuar configuración"
                            icon="fa-solid fa-arrow-right"
                            iconPos="right"
                            size="small"
                            severity="success"
                            onClick={() => setSetupWizardVisible(true)}
                        />
                    </div>
                </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <PageHeader
                    icon="fa-solid fa-flask-vial"
                    title="Catálogo de ensayos"
                    subtitle="Tipos de ensayo por material. Edite propiedades como norma, periodicidad, obligatoriedad y visibilidad."
                />
                <Button
                    label="Configurar"
                    icon="fa-solid fa-wand-magic-sparkles"
                    size="small"
                    outlined
                    severity="success"
                    className="mant-wizard-btn"
                    onClick={() => setSetupWizardVisible(true)}
                    tooltip="Asistente paso a paso para entender y configurar el catálogo de ensayos"
                    tooltipOptions={{ position: "left" }}
                />
            </div>

            <WizardCatalogoEnsayos
                visible={setupWizardVisible}
                onClose={() => setSetupWizardVisible(false)}
                onFinish={() => { setSetupWizardVisible(false); recargarTodoSetup(); }}
            />

            {/* PR5 — Banner explicativo: aclara qué se puede configurar acá y qué no.
                Dismissable, recordado en localStorage. */}
            {!bannerDismissed && (
                <div
                    className="surface-card border-1 border-round p-3 mb-3 flex align-items-start gap-2"
                    style={{ borderLeftColor: "var(--primary-color)", borderLeftWidth: "3px" }}
                >
                    <i className="fa-solid fa-circle-info text-primary mt-1" />
                    <div className="flex-1">
                        <strong>¿Cómo funciona este catálogo?</strong>
                        <p className="text-sm text-color-secondary m-0 mt-1">
                            Los ensayos disponibles son los del set de HormiQual basado en
                            normativa argentina (CIRSOC, IRAM). Acá podés configurar la
                            obligatoriedad por contexto (Hormigón / TBS), periodicidad,
                            visibilidad y agrupación. Si necesitás un ensayo que no está, contactanos
                            con la norma y un ejemplo para incorporarlo.
                            <br />
                            <strong>Tip:</strong> Guardá tu configuración periódicamente en
                            "Configuraciones guardadas" para poder restaurar a un estado conocido
                            ante cambios indeseados.
                        </p>
                    </div>
                    <Button
                        icon="fa-solid fa-xmark"
                        rounded
                        text
                        size="small"
                        onClick={dismissBanner}
                        tooltip="Ocultar este aviso"
                        tooltipOptions={{ position: "left" }}
                    />
                </div>
            )}

            {/* Visible API error */}
            {apiError && (
                <Message severity="error" text={apiError} className="w-full mb-3" />
            )}

            {/* Toolbar */}
            <div className="flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                <div className="flex align-items-center gap-3 flex-wrap flex-1">
                    <Dropdown
                        value={material}
                        options={MATERIAL_OPTIONS}
                        onChange={(e) => { setMaterial(e.value); setFirst(0); }}
                        style={{ width: "180px" }}
                    />
                    <SelectButton
                        value={perfilFilter}
                        options={PERFIL_OPTIONS}
                        onChange={(e) => { if (e.value) { setPerfilFilter(e.value); setFirst(0); } }}
                        allowEmpty={false}
                    />
                    <SelectButton
                        value={contextoFiltro}
                        options={CONTEXTO_OPTIONS}
                        onChange={(e) => { if (e.value) { setContextoFiltro(e.value); setFirst(0); } }}
                        allowEmpty={false}
                        tooltip="Filtra ensayos según el contexto donde aplican (Hormigón / TBS / ambos)"
                        tooltipOptions={{ position: "top" }}
                    />
                    <span className="p-input-icon-left search-bar-wrapper">
                        <i className="pi pi-search" />
                        <InputText
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setFirst(0); }}
                            placeholder="Buscar ensayo..."
                            title="Buscar por código, nombre o norma"
                            className="search-bar"
                        />
                    </span>
                </div>
                <div className="flex align-items-center gap-3 flex-wrap">
                    <div className="flex align-items-center gap-2">
                        <InputSwitch checked={showHidden} onChange={(e) => setShowHidden(e.value)} />
                        <label className="text-sm text-color-secondary cursor-pointer" onClick={() => setShowHidden(!showHidden)}>
                            Mostrar ocultos
                        </label>
                    </div>
                    <Button
                        label="Configuraciones guardadas"
                        icon="fa-solid fa-clock-rotate-left"
                        size="small"
                        outlined
                        onClick={() => setSnapshotsVisible(true)}
                        tooltip="Guardá la configuración actual del catálogo y restaurala más adelante"
                        tooltipOptions={{ position: "top" }}
                    />
                    {bannerDismissed && (
                        <Button
                            icon="fa-solid fa-circle-question"
                            size="small"
                            text
                            rounded
                            onClick={showBanner}
                            tooltip="Mostrar guía sobre cómo funciona este catálogo"
                            tooltipOptions={{ position: "top" }}
                        />
                    )}
                    <Button
                        icon={advToolsVisible ? "fa-solid fa-chevron-up" : "fa-solid fa-ellipsis-vertical"}
                        size="small"
                        text
                        rounded
                        onClick={() => setAdvToolsVisible(!advToolsVisible)}
                        tooltip="Herramientas avanzadas"
                        tooltipOptions={{ position: "top" }}
                    />
                </div>
            </div>

            {advToolsVisible && (
                <div className="surface-100 border-round p-3 mb-3 flex align-items-center gap-2 flex-wrap">
                    <small className="text-color-secondary mr-2">
                        <i className="fa-solid fa-screwdriver-wrench mr-1" />
                        Herramientas avanzadas:
                    </small>
                    <Button
                        label="Instalar ensayos faltantes"
                        icon="fa-solid fa-flask-vial"
                        size="small"
                        severity="info"
                        outlined
                        loading={applyingTemplate}
                        onClick={handleApplyTemplate}
                        disabled={!templateAvailable}
                        tooltip={templateAvailable ? "Agrega al catálogo los ensayos del set base de HormiQual que estén faltando. No modifica los que ya tenés." : "No hay plantilla disponible para este material"}
                        tooltipOptions={{ position: "top" }}
                    />
                    <FileUpload
                        ref={importFileRef}
                        mode="basic"
                        accept=".json"
                        maxFileSize={10000000}
                        auto
                        chooseLabel="Restaurar desde archivo JSON"
                        chooseOptions={{
                            icon: "fa-solid fa-file-import",
                            className: "p-button-outlined p-button-sm",
                        }}
                        customUpload
                        uploadHandler={handleImportFile}
                    />
                    <Button
                        label="Descargar configuración como JSON"
                        icon="fa-solid fa-file-export"
                        size="small"
                        outlined
                        onClick={handleExport}
                        disabled={filtered.length === 0}
                        tooltip="Exporta la configuración a un archivo JSON. Para uso técnico — el flujo recomendado es 'Configuraciones guardadas'."
                        tooltipOptions={{ position: "top" }}
                    />
                </div>
            )}

            {/* Summary + limpiar filtros */}
            <div className="mb-2 text-sm text-color-secondary flex align-items-center gap-2 flex-wrap">
                <span>
                    Mostrando {filtered.length} de {tipos.length} tipo{tipos.length !== 1 ? "s" : ""} de ensayo
                </span>
                {hayFiltrosActivos && (
                    <Button
                        label="Limpiar filtros"
                        icon="fa-solid fa-filter-circle-xmark"
                        size="small"
                        text
                        severity="secondary"
                        onClick={limpiarFiltros}
                        className="text-xs"
                    />
                )}
            </div>

            {/* DataTable */}
            <DataTable responsiveLayout="scroll"
                value={filtered}
                paginator
                rows={25}
                first={first}
                onPage={(e) => setFirst(e.first)}
                rowsPerPageOptions={[25, 50, 100]}
                emptyMessage="No se encontraron tipos de ensayo."
                size="small"
                stripedRows
                sortField="orden"
                sortOrder={1}
                dataKey="idAgregadoEnsayoTipo"
                rowClassName={(row) => (row.esDerivado ? "opacity-60" : "")}
            >
                <Column header="#" body={(_, { rowIndex }) => first + rowIndex + 1} style={{ width: "50px" }} />
                <Column field="nombre" header="Nombre" sortable />
                <Column field="normaRef" header="Norma" body={normaBody} sortable style={{ width: "110px" }} />
                <Column field="perfil" header="Perfil" body={perfilBody} sortable style={{ width: "85px" }} />
                <Column field="aplicaA" header="Tipo agreg." body={aplicaABody} style={{ width: "100px" }} />
                <Column field="categoria" header="Categoría" body={categoriaBody} sortable style={{ width: "100px" }} />
                {/* PR2: chips multi-contexto reemplazan columnas booleanas legacy */}
                <Column header="Contexto" body={contextoBody} style={{ width: "90px" }} />
                <Column header="Caract." body={caractMultiBody} style={{ width: "115px" }} />
                <Column header="Oblig." body={obligMultiBody} style={{ width: "85px" }} />
                <Column field="periodicidadMeses" header="Period." body={periodicidadBody} sortable style={{ width: "70px" }} />
                <Column header="Ensayos" body={ensayoCountBody} style={{ width: "75px" }} />
                <Column field="visibleEnCards" header="Cards" body={visibleEnCardsBody} sortable style={{ width: "70px" }} />
                <Column header="" body={actionsBody} style={{ width: "100px" }} />
            </DataTable>

            {/* ═══ Edit Dialog ═══ */}
            <Dialog
                header="Editar tipo de ensayo"
                visible={editVisible}
                onHide={() => setEditVisible(false)}
                style={{ width: "90vw", maxWidth: "600px" }}
                modal
                footer={
                    <div className="flex justify-content-end gap-2">
                        <Button label="Cancelar" severity="secondary" text onClick={() => setEditVisible(false)} />
                        <Button label="Guardar" icon="fa-solid fa-save" onClick={handleSave} loading={saving} disabled={saving} />
                    </div>
                }
            >
                {editData && (
                    <div className="flex flex-column gap-4 pt-2">
                        {/* Read-only technical fields */}
                        <div className="surface-ground border-round p-3">
                            <div className="text-xs text-color-secondary mb-2 font-semibold">Campos protegidos (solo lectura)</div>
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Código:</span>
                                <span className="font-mono font-bold text-sm">{editData.codigo}</span>
                            </div>
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Schema Key:</span>
                                <span className="font-mono text-sm">{editData.schemaKey || "—"}</span>
                            </div>
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Material:</span>
                                <Tag value={editData.material} className="text-xs" />
                            </div>
                            {editData.esDerivado && (
                                <div className="flex align-items-center gap-2 mb-1">
                                    <Tag value="Derivado" severity="warning" className="text-xs" />
                                    <span className="text-sm text-color-secondary">
                                        de <span className="font-mono">{editData.derivadoDeCodigo}</span>
                                        {editData.derivadoClave && <> · clave: <span className="font-mono">{editData.derivadoClave}</span></>}
                                    </span>
                                </div>
                            )}
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Norma ref.:</span>
                                <span className="text-sm">{editData.normaRef || "—"}</span>
                            </div>
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Aplica a:</span>
                                <span className="flex gap-1">
                                    {(editData.aplicaA || []).map(a => <Tag key={a} value={a} className="text-xs" />)}
                                    {!(editData.aplicaA?.length) && <span className="text-sm">—</span>}
                                </span>
                            </div>
                            <div className="flex align-items-center gap-2 mb-1">
                                <span className="text-xs text-500" style={{ minWidth: "72px" }}>Categoría:</span>
                                <span className="text-sm" style={{ textTransform: "capitalize" }}>{editData.categoria || "—"}</span>
                            </div>
                        </div>

                        {/* Nombre + Perfil — 2 col grid */}
                        <div
                            className="grid-form-2col"
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr auto",
                                gap: "0.75rem",
                                alignItems: "start",
                            }}
                        >
                            <div className="flex flex-column gap-1">
                                <label className="font-semibold text-sm">Nombre</label>
                                <InputText
                                    value={editData.nombre}
                                    onChange={(e) => setEditData({ ...editData, nombre: e.target.value })}
                                    className="w-full"
                                />
                            </div>
                            <div className="flex flex-column gap-1" style={{ minWidth: "150px" }}>
                                <label className="font-semibold text-sm">Perfil</label>
                                <Dropdown
                                    value={editData.perfil}
                                    options={[{ label: "CORE", value: "CORE" }, { label: "AVANZADO", value: "AVANZADO" }]}
                                    onChange={(e) => setEditData({ ...editData, perfil: e.value })}
                                    disabled={editData.esDerivado}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {/* Norma vinculada (catálogo) */}
                        <div className="flex flex-column gap-1">
                            <label className="font-semibold text-sm">Norma vinculada (catálogo)</label>
                            <Dropdown
                                value={editData.normaId}
                                options={normaOptions}
                                onChange={(e) => setEditData({ ...editData, normaId: e.value })}
                                placeholder="Seleccionar..."
                                showClear
                                filter
                                filterPlaceholder="Buscar norma..."
                                className="w-full"
                            />
                            <small className="text-color-secondary">Vincule con una norma del catálogo para acceder al PDF.</small>
                        </div>

                        {/* Periodicidad + Warning + Orden — 3 col grid (CSS scoped) */}
                        <div className="edit-tipo-numeros">
                            <div>
                                <label className="block mb-2 font-semibold text-sm">Periodicidad (meses)</label>
                                <InputNumber
                                    value={editData.periodicidadMeses}
                                    onValueChange={(e) => setEditData({ ...editData, periodicidadMeses: e.value })}
                                    min={0}
                                    useGrouping={false}
                                    placeholder="—"
                                />
                            </div>
                            <div>
                                <label className="block mb-2 font-semibold text-sm">Warning (días)</label>
                                <InputNumber
                                    value={editData.warningDays}
                                    onValueChange={(e) => setEditData({ ...editData, warningDays: e.value })}
                                    min={0}
                                    useGrouping={false}
                                    placeholder="—"
                                />
                            </div>
                            <div>
                                <label className="block mb-2 font-semibold text-sm">Orden</label>
                                <InputNumber
                                    value={editData.orden}
                                    onValueChange={(e) => setEditData({ ...editData, orden: e.value })}
                                    min={0}
                                    useGrouping={false}
                                />
                            </div>
                        </div>

                        {/* PR2: Aplicación por contexto (Hormigón / TBS) */}
                        <div className="surface-ground border-round p-3">
                            <div className="text-sm font-semibold mb-3">Aplicación por contexto</div>
                            <div className="grid">
                                {[
                                    { key: "Hormigon", label: "Hormigón", aplicaKey: "aplicaAHormigon", nivelKey: "nivelCaracterizacionHormigon", oblKey: "obligatorioHormigon" },
                                    { key: "TBS", label: "TBS", aplicaKey: "aplicaATBS", nivelKey: "nivelCaracterizacionTBS", oblKey: "obligatorioTBS" },
                                ].map(({ label, aplicaKey, nivelKey, oblKey }) => {
                                    const aplica = editData[aplicaKey];
                                    const nivel = editData[nivelKey];
                                    const obl = editData[oblKey];
                                    const oblDisabled = !aplica || nivel === "NINGUNA" || nivel === "BASICA";
                                    return (
                                        <div key={aplicaKey} className="col-12 md:col-6">
                                            <div className="border-round border-1 surface-border p-2">
                                                <div className="text-sm font-semibold mb-2">{label}</div>
                                                <div className="flex align-items-center gap-2 mb-2">
                                                    <InputSwitch
                                                        checked={aplica}
                                                        onChange={(e) => {
                                                            const next = { ...editData, [aplicaKey]: e.value };
                                                            // Coherencia local: si se desactiva, resetear nivel/oblig.
                                                            if (!e.value) {
                                                                next[nivelKey] = "NINGUNA";
                                                                next[oblKey] = false;
                                                            }
                                                            setEditData(next);
                                                        }}
                                                    />
                                                    <label className="text-sm">Aplica a {label}</label>
                                                </div>
                                                <div className="flex flex-column gap-1 mb-2">
                                                    <label className="text-xs text-color-secondary">Nivel de caracterización</label>
                                                    <Dropdown
                                                        value={nivel}
                                                        options={NIVEL_OPTIONS}
                                                        onChange={(e) => {
                                                            const next = { ...editData, [nivelKey]: e.value };
                                                            // Coherencia local: BASICA fuerza obligatorio=true,
                                                            // NINGUNA fuerza obligatorio=false.
                                                            if (e.value === "BASICA") next[oblKey] = true;
                                                            else if (e.value === "NINGUNA") next[oblKey] = false;
                                                            setEditData(next);
                                                        }}
                                                        disabled={!aplica}
                                                        className="w-full"
                                                    />
                                                </div>
                                                <div className="flex align-items-center gap-2">
                                                    <InputSwitch
                                                        checked={obl}
                                                        onChange={(e) => setEditData({ ...editData, [oblKey]: e.value })}
                                                        disabled={oblDisabled}
                                                    />
                                                    <label className={`text-sm ${oblDisabled ? "text-color-secondary" : ""}`}>
                                                        Obligatorio
                                                        {nivel === "BASICA" && aplica && (
                                                            <span className="text-xs text-color-secondary"> (forzado por nivel Básica)</span>
                                                        )}
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <small className="text-color-secondary block mt-2">
                                Nivel <strong>Básica</strong>: aparece en la ficha y es obligatorio (no editable).
                                Nivel <strong>Avanzada</strong>: aparece en la ficha y obligatoriedad configurable.
                                Nivel <strong>—</strong>: no aparece en la ficha.
                            </small>
                        </div>

                        {/* Visibilidad global (no contextual) */}
                        <div className="flex gap-4 flex-wrap pt-1">
                            <div className="flex align-items-center gap-2">
                                <InputSwitch
                                    checked={editData.visibleEnUI}
                                    onChange={(e) => setEditData({ ...editData, visibleEnUI: e.value })}
                                />
                                <label className="text-sm">Visible en UI</label>
                            </div>
                            <div className="flex align-items-center gap-2">
                                <InputSwitch
                                    checked={editData.visibleEnCards}
                                    onChange={(e) => setEditData({ ...editData, visibleEnCards: e.value })}
                                />
                                <label className="text-sm">Visible en cards</label>
                            </div>
                        </div>
                    </div>
                )}
            </Dialog>

            {/* ═══ Ensayo Detail Dialog ═══ */}
            <Dialog
                header={
                    ensayoDetailTipo
                        ? `Ensayos — ${ensayoDetailTipo.codigo}`
                        : "Ensayos"
                }
                visible={ensayoDetailVisible}
                onHide={() => setEnsayoDetailVisible(false)}
                style={{ width: "90vw", maxWidth: "700px" }}
                modal
            >
                {ensayoDetailLoading ? (
                    <div className="flex justify-content-center p-4">
                        <i className="pi pi-spin pi-spinner text-2xl" />
                    </div>
                ) : (
                    <>
                        <div className="flex align-items-center gap-2 mb-3">
                            <InputSwitch
                                checked={ensayoDetailShowInactive}
                                onChange={(e) => setEnsayoDetailShowInactive(e.value)}
                            />
                            <label className="text-sm text-color-secondary">
                                Mostrar inactivos ({ensayoDetailList.filter((e) => !e.isActive).length})
                            </label>
                            <span className="ml-auto text-sm text-color-secondary">
                                {ensayoDetailList.filter((e) => e.isActive).length} activo(s) / {ensayoDetailList.length} total
                            </span>
                        </div>
                        <DataTable responsiveLayout="scroll"
                            value={ensayoDetailList.filter(
                                (e) => ensayoDetailShowInactive || e.isActive
                            )}
                            size="small"
                            stripedRows
                            emptyMessage="Sin ensayos cargados."
                            paginator={ensayoDetailList.length > 10}
                            rows={10}
                            dataKey="idAgregadoEnsayo"
                        >
                            <Column field="idAgregadoEnsayo" header="ID" style={{ width: "55px" }} />
                            <Column field="fechaEnsayo" header="Fecha ensayo" sortable style={{ width: "110px" }} />
                            <Column field="laboratorio" header="Laboratorio" />
                            <Column field="nroInforme" header="Nro. Informe" style={{ width: "100px" }} />
                            <Column
                                field="cumple"
                                header="Cumple"
                                style={{ width: "120px" }}
                                body={(row) => <CumplimientoBadge ensayo={row} className="text-xs" />}
                            />
                            <Column
                                field="isActive"
                                header="Estado"
                                style={{ width: "70px" }}
                                body={(row) =>
                                    row.isActive
                                        ? <Tag value="Activo" severity="success" className="text-xs" />
                                        : <Tag value="Inactivo" severity="danger" className="text-xs" />
                                }
                            />
                        </DataTable>
                    </>
                )}
            </Dialog>

            {/* ═══ Import Preview Dialog ═══ */}
            <Dialog
                header="Importar paquete de ensayos"
                visible={importVisible}
                onHide={() => setImportVisible(false)}
                style={{ width: "90vw", maxWidth: "750px" }}
                modal
                footer={
                    <div className="flex justify-content-between align-items-center">
                        <span className="text-sm text-color-secondary">
                            Seleccionados: {importSelectedCount}
                            {importPreview && ` de ${importPreview.cantidad}`}
                        </span>
                        <div className="flex gap-2">
                            <Button label="Cancelar" severity="secondary" text onClick={() => setImportVisible(false)} />
                            <Button
                                label={importSelectedCount > 0 ? `Importar ${importSelectedCount} tipo${importSelectedCount !== 1 ? "s" : ""}` : "Importar"}
                                icon="fa-solid fa-file-import"
                                onClick={handleConfirmImport}
                                loading={importando}
                                disabled={importSelectedCount === 0 || importando}
                            />
                        </div>
                    </div>
                }
            >
                {importPreview && (
                    <div className="flex flex-column gap-3 pt-2">
                        <div className="flex align-items-center gap-3 flex-wrap">
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Total</span>
                                <span className="text-2xl font-bold">{importPreview.cantidad}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Idénticos</span>
                                <span className="text-2xl font-bold text-color-secondary">{importPreview.iguales}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Difieren</span>
                                <span className="text-2xl font-bold text-orange-500">{importPreview.difieren}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Nuevos</span>
                                <span className="text-2xl font-bold text-green-500">{importPreview.nuevos}</span>
                            </div>
                        </div>

                        {importPreview.fecha_exportacion && (
                            <div className="text-sm text-color-secondary">
                                Fecha de exportación: {new Date(importPreview.fecha_exportacion).toLocaleDateString()}
                            </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                            <Button label="Solo nuevos" size="small" text onClick={() => selectImportGroup("nuevos")} />
                            <Button label="Nuevos + modificados" size="small" text severity="warning" onClick={() => selectImportGroup("nuevos+mod")} />
                            <Button label="Todos" size="small" text severity="secondary" onClick={() => selectImportGroup("todos")} />
                            <Button label="Ninguno" size="small" text severity="secondary" onClick={() => selectImportGroup("ninguno")} />
                        </div>

                        <DataTable responsiveLayout="scroll"
                            value={importPreview.preview}
                            size="small"
                            stripedRows
                            paginator={importPreview.preview.length > 15}
                            rows={15}
                            scrollable
                            scrollHeight="350px"
                            rowClassName={(row) => row.estado === "igual" ? "opacity-60" : ""}
                        >
                            <Column
                                style={{ width: "45px" }}
                                body={(row) => (
                                    <Checkbox checked={!!row.selected} onChange={() => toggleImportItem(row.codigo)} />
                                )}
                            />
                            <Column field="codigo" header="Código" style={{ width: "200px" }} body={(row) => <span className="font-mono font-semibold text-xs">{row.codigo}</span>} />
                            <Column field="nombre" header="Nombre" body={(row) => <span className="text-sm">{row.nombre}</span>} />
                            <Column header="Estado" style={{ width: "100px" }} body={(row) => {
                                const cfg = { nuevo: { label: "Nuevo", severity: "success", icon: "fa-solid fa-plus" }, difiere: { label: "Difiere", severity: "warning", icon: "fa-solid fa-pen" }, igual: { label: "Igual", severity: null, icon: "fa-solid fa-equals" } };
                                const c = cfg[row.estado] || cfg.igual;
                                return <Tag value={c.label} severity={c.severity} icon={c.icon} className="text-xs" />;
                            }} />
                            <Column header="" style={{ width: "50px" }} body={(row) => {
                                if (row.estado !== "difiere" || !row.diferencias?.length) return row.estado === "igual" ? <span className="text-xs text-400">(=)</span> : null;
                                return (
                                    <Button
                                        label="ver"
                                        size="small"
                                        text
                                        className="p-0 text-xs"
                                        onClick={() => setDiffExpanded((prev) => ({ ...prev, [row.codigo]: !prev[row.codigo] }))}
                                    />
                                );
                            }} />
                        </DataTable>

                        {importPreview.preview.filter((p) => p.estado === "difiere" && diffExpanded[p.codigo]).map((p) => (
                            <div key={p.codigo} className="surface-ground border-round p-2 text-xs">
                                <span className="font-mono font-semibold">{p.codigo}</span> — Diferencias:
                                {p.diferencias.map((d, i) => (
                                    <div key={i} className="ml-3 mt-1">
                                        <span className="text-color-secondary">{d.campo}:</span>{" "}
                                        <span className="text-red-400 line-through">{d.antes}</span>{" "}
                                        <i className="fa-solid fa-arrow-right text-xs mx-1" />{" "}
                                        <span className="text-green-400">{d.despues}</span>
                                    </div>
                                ))}
                            </div>
                        ))}

                        {importPreview.preview.some(p => p.warnings?.length > 0) && (
                            <div className="surface-ground border-round p-2">
                                <span className="text-sm text-yellow-500 font-bold">Advertencias:</span>
                                {importPreview.preview.filter(p => p.warnings?.length > 0).map((p, i) =>
                                    p.warnings.map((w, j) => (
                                        <div key={`${i}-${j}`} className="text-xs text-yellow-400 mt-1">
                                            <span className="font-mono">{p.codigo}</span>: {w}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        <div className="flex align-items-center gap-2 text-color-secondary">
                            <i className="fa-solid fa-circle-info text-blue-400" />
                            <small>Al actualizar, solo se modifican campos editables. Los datos de ensayos realizados no se tocan.</small>
                        </div>
                    </div>
                )}
            </Dialog>

            {/* ═══ Import Result Dialog ═══ */}
            <Dialog
                header="Importación completada"
                visible={importResultVisible}
                onHide={() => setImportResultVisible(false)}
                style={{ width: "90vw", maxWidth: "450px" }}
                modal
            >
                {importResultado && (
                    <div className="flex flex-column gap-3 pt-2">
                        <div className="flex align-items-center gap-3 flex-wrap">
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Creados</span>
                                <span className="text-2xl font-bold text-green-500">{importResultado.creados}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Actualizados</span>
                                <span className="text-2xl font-bold text-orange-500">{importResultado.actualizados}</span>
                            </div>
                            <div className="flex flex-column align-items-center surface-ground border-round p-3 flex-1">
                                <span className="text-xs text-color-secondary mb-1">Sin cambios</span>
                                <span className="text-2xl font-bold text-color-secondary">{importResultado.sin_cambios}</span>
                            </div>
                        </div>
                        {importResultado.detalle?.length > 0 && (
                            <div className="surface-ground border-round p-2 text-xs" style={{ maxHeight: "200px", overflow: "auto" }}>
                                {importResultado.detalle.map((d, i) => (
                                    <div key={i} className="flex align-items-center gap-2 mb-1">
                                        {d.accion === "creado" && <i className="fa-solid fa-plus text-green-500" />}
                                        {d.accion === "actualizado" && <i className="fa-solid fa-sync text-orange-500" />}
                                        {d.accion === "error" && <i className="fa-solid fa-xmark text-red-500" />}
                                        <span className="font-mono">{d.codigo}</span>
                                        {d.error && <span className="text-red-400">— {d.error}</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                        {importResultado.errores?.length > 0 && (
                            <div className="surface-ground border-round p-2">
                                <span className="text-sm text-red-500 font-bold">Errores:</span>
                                {importResultado.errores.map((e, i) => (
                                    <div key={i} className="text-xs text-red-400 mt-1">{e.codigo}: {e.error}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </Dialog>

            {/* PR5 — Configuraciones guardadas (snapshots persistidos) */}
            <SnapshotsManagerDialog
                visible={snapshotsVisible}
                onHide={() => setSnapshotsVisible(false)}
                material={material}
                onRestored={() => {
                    setSnapshotsVisible(false);
                    fetchTipos();
                    fetchEnsayoCounts();
                }}
            />

        </div>
    );
};

export default CatalogoEnsayosPage;
