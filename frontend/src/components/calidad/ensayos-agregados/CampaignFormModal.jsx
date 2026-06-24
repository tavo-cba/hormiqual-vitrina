import React, { useState, useEffect, useMemo, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Calendar } from "primereact/calendar";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import EnsayoTipoForm from "./EnsayoTipoForm";
import { createBatchEnsayos, getFormSpec } from "../../../services/agregadoEnsayoService";
import { useToast } from "../../../context/ToastContext";

/**
 * CampaignFormModal — Formulario unificado de campaña de ensayos.
 * Permite cargar múltiples ensayos en una sola pantalla con secciones plegables.
 * Todos comparten encabezado común (fecha, laboratorio, informe).
 */
const CampaignFormModal = ({ visible, onHide, legacyAgregadoId, tipos = [], onSaved, defaultUsoAgregado = null }) => {
    const showToast = useToast();

    // ── Common header fields ──
    const [fechaEnsayo, setFechaEnsayo] = useState(null);
    const [fechaMuestreo, setFechaMuestreo] = useState(null);
    const [laboratorio, setLaboratorio] = useState("");
    const [nroInforme, setNroInforme] = useState("");
    const [observaciones, setObservaciones] = useState("");

    // ── Per-ensayo state: { [tipoId]: { resultado, expanded, spec, loading } } ──
    const [sections, setSections] = useState({});
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [saveResult, setSaveResult] = useState(null);

    // Normalize tipos from resumen.items — extract the tipo object
    const campaignTipos = useMemo(() => {
        const EXCLUDED = ['GRANULOMETRIA'];
        return tipos.map(t => {
            // resumen items have { tipo: {...}, ultimoEnsayo, estado }
            // direct tipos have { id, nombre, codigo, ... }
            return t.tipo || t;
        }).filter(tipo => {
            const cod = tipo.codigo || '';
            if (EXCLUDED.some(ex => cod.includes(ex))) return false;
            if (tipo.esDerivado) return false;
            if (tipo.visibleEnUI === false) return false;
            // Filter by aplicaA
            if (defaultUsoAgregado) {
                let arr = tipo.aplicaA;
                if (typeof arr === 'string') try { arr = JSON.parse(arr); } catch { arr = []; }
                if (Array.isArray(arr) && arr.length > 0 && !arr.includes(defaultUsoAgregado.toUpperCase())) return false;
            }
            return true;
        });
    }, [tipos, defaultUsoAgregado]);

    // Reset on open
    useEffect(() => {
        if (visible) {
            setFechaEnsayo(new Date());
            setFechaMuestreo(null);
            setLaboratorio("");
            setNroInforme("");
            setObservaciones("");
            setSaveResult(null);
            // Initialize sections — all collapsed, no resultado
            const init = {};
            campaignTipos.forEach(tipo => {
                const id = tipo.idAgregadoEnsayoTipo || tipo.id;
                if (id) init[id] = { resultado: {}, expanded: false, spec: null, loading: false };
            });
            setSections(init);
        }
    }, [visible, campaignTipos]);

    // Load form spec when section is expanded
    const toggleSection = async (tipoId) => {
        setSections(prev => {
            const s = { ...prev };
            s[tipoId] = { ...s[tipoId], expanded: !s[tipoId]?.expanded };
            return s;
        });

        // Load spec when expanding (if not yet loaded)
        const currentSec = sections[tipoId];
        const willExpand = !currentSec?.expanded;
        if (willExpand && !currentSec?.spec && !currentSec?.loading) {
            const tipo = campaignTipos.find(t => (t.idAgregadoEnsayoTipo || t.id) === tipoId);
            const codigo = tipo?.codigo;
            if (codigo) {
                setSections(prev => ({ ...prev, [tipoId]: { ...prev[tipoId], loading: true } }));
                try {
                    const spec = await getFormSpec(codigo);
                    setSections(prev => ({ ...prev, [tipoId]: { ...prev[tipoId], spec, loading: false } }));
                } catch (err) {
                    console.error(`[Campaign] Error loading spec for ${codigo}:`, err);
                    setSections(prev => ({ ...prev, [tipoId]: { ...prev[tipoId], loading: false } }));
                }
            }
        }
    };

    const updateResultado = (tipoId, resultado) => {
        setSections(prev => ({
            ...prev,
            [tipoId]: { ...prev[tipoId], resultado },
        }));
    };

    // Check if a section has data entered
    const sectionHasData = (tipoId) => {
        const r = sections[tipoId]?.resultado;
        if (!r || typeof r !== 'object') return false;
        return Object.values(r).some(v => v != null && v !== '' && v !== false);
    };

    const sectionsWithData = useMemo(() =>
        Object.keys(sections).filter(id => sectionHasData(id)),
    [sections]);

    // Save campaign
    const handleSave = async () => {
        if (savingRef.current) return;
        if (!fechaEnsayo) {
            showToast("warn", "La fecha de ensayo es obligatoria.");
            return;
        }
        if (sectionsWithData.length === 0) {
            showToast("warn", "Complete al menos un ensayo antes de guardar.");
            return;
        }

        savingRef.current = true;
        setSaving(true);
        setSaveResult(null);

        const ensayos = sectionsWithData.map(tipoId => ({
            idAgregadoEnsayoTipo: Number(tipoId),
            resultado: sections[tipoId].resultado,
            tipoAgregado: defaultUsoAgregado || null,
        }));

        try {
            const result = await createBatchEnsayos({
                legacyAgregadoId: Number(legacyAgregadoId),
                fechaEnsayo: fechaEnsayo.toISOString().slice(0, 10),
                fechaMuestreo: fechaMuestreo ? fechaMuestreo.toISOString().slice(0, 10) : null,
                laboratorio: laboratorio || null,
                nroInforme: nroInforme || null,
                observaciones: observaciones || null,
                ensayos,
            });

            setSaveResult(result);

            if (result.errors?.length === 0) {
                showToast("success", `${result.created.length} ensayo(s) creados exitosamente.`);
                onSaved?.();
                onHide();
            } else if (result.created?.length > 0) {
                showToast("warn", `${result.created.length} creados, ${result.errors.length} con errores.`);
                onSaved?.();
            } else {
                showToast("error", "No se pudo crear ningún ensayo.");
            }
        } catch (err) {
            showToast("error", err.response?.data?.error || "Error al guardar campaña.");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const footer = (
        <div className="flex justify-content-between align-items-center">
            <span className="text-sm text-color-secondary">
                {sectionsWithData.length} de {campaignTipos.length} ensayos con datos
            </span>
            <div className="flex gap-2">
                <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" text onClick={onHide} disabled={saving} />
                <Button label={`Guardar ${sectionsWithData.length} ensayo(s)`} icon="fa-solid fa-save" severity="success" onClick={handleSave} loading={saving} disabled={sectionsWithData.length === 0 || saving} />
            </div>
        </div>
    );

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header="Cargar campaña de ensayos"
            footer={footer}
            style={{ width: "90vw", maxWidth: "900px" }}
            maximizable
            modal
            className="campaign-modal"
        >
            {/* ── Common header ── */}
            <div className="surface-ground border-round p-3 mb-3">
                <h5 className="mt-0 mb-3">
                    <i className="fa-solid fa-clipboard-list mr-2 text-primary" />
                    Datos comunes de la campaña
                </h5>
                <div className="grid">
                    <div className="col-12 md:col-4">
                        <label className="block text-sm font-semibold mb-1">Fecha ensayo *</label>
                        <Calendar value={fechaEnsayo} onChange={(e) => setFechaEnsayo(e.value)} dateFormat="dd/mm/yy" className="w-full" showIcon />
                    </div>
                    <div className="col-12 md:col-4">
                        <label className="block text-sm font-semibold mb-1">Fecha muestreo</label>
                        <Calendar value={fechaMuestreo} onChange={(e) => setFechaMuestreo(e.value)} dateFormat="dd/mm/yy" className="w-full" showIcon />
                    </div>
                    <div className="col-12 md:col-4">
                        <label className="block text-sm font-semibold mb-1">N.° informe</label>
                        <InputText value={nroInforme} onChange={(e) => setNroInforme(e.target.value)} className="w-full" placeholder="Ej: RT04-1033-26" />
                    </div>
                    <div className="col-12 md:col-6">
                        <label className="block text-sm font-semibold mb-1">Laboratorio</label>
                        <InputText value={laboratorio} onChange={(e) => setLaboratorio(e.target.value)} className="w-full" placeholder="Nombre del laboratorio" />
                    </div>
                    <div className="col-12 md:col-6">
                        <label className="block text-sm font-semibold mb-1">Observaciones generales</label>
                        <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className="w-full" rows={1} autoResize />
                    </div>
                </div>
            </div>

            {/* ── Ensayo sections (accordions) ── */}
            <div className="flex flex-column gap-2">
                {campaignTipos.map(tipo => {
                    const tipoId = tipo.idAgregadoEnsayoTipo || tipo.id;
                    const sec = sections[tipoId] || {};
                    const hasData = sectionHasData(tipoId);
                    const isExpanded = !!sec.expanded;

                    return (
                        <div key={tipoId} className="surface-ground border-round overflow-hidden">
                            {/* Header — clickable to toggle */}
                            <div
                                className="flex align-items-center justify-content-between p-3 cursor-pointer hover:surface-hover"
                                onClick={() => toggleSection(tipoId)}
                                style={{ borderLeft: hasData ? '3px solid #22c55e' : '3px solid transparent' }}
                            >
                                <div className="flex align-items-center gap-2 flex-wrap">
                                    {hasData && <Tag value="Con datos" severity="success" className="text-xs" style={{ fontSize: '0.6rem', padding: '0 4px' }} />}
                                    <span className="text-sm font-semibold">{tipo.nombre}</span>
                                    <Tag value={tipo.normaRef} className="text-xs" severity="info" style={{ fontSize: '0.6rem', padding: '0 4px' }} />
                                    <Tag value={tipo.categoria} className="text-xs" style={{ fontSize: '0.6rem', padding: '0 4px', backgroundColor: 'rgba(100,100,100,0.3)' }} />
                                </div>
                                <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'} text-color-secondary`} />
                            </div>
                            {/* Body — only rendered when expanded */}
                            {isExpanded && (
                                <div className="p-3 pt-0">
                                    {sec.loading && <p className="text-color-secondary text-sm"><i className="fa-solid fa-spinner fa-spin mr-2" />Cargando formulario...</p>}
                                    {sec.spec && (
                                        <EnsayoTipoForm
                                            spec={sec.spec}
                                            resultado={sec.resultado}
                                            onChange={(r) => updateResultado(tipoId, r)}
                                            readOnly={false}
                                        />
                                    )}
                                    {!sec.loading && !sec.spec && (
                                        <p className="text-color-secondary text-sm m-0">No hay formulario configurado para este ensayo.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Save result ── */}
            {saveResult && (
                <div className="mt-3">
                    {saveResult.errors?.length > 0 && (
                        <Message severity="warn" className="w-full mb-2" text={`${saveResult.errors.length} ensayo(s) con error: ${saveResult.errors.map(e => e.error).join('; ')}`} />
                    )}
                </div>
            )}
        </Dialog>
    );
};

export default CampaignFormModal;
