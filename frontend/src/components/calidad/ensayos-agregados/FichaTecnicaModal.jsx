import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { Message } from 'primereact/message';
import { SelectButton } from 'primereact/selectbutton';
import { getAgregadoMeta, getCaracterizacion, getEnsayos, getResumen } from '../../../services/agregadoEnsayoService';
import { generarFichaTecnicaAgregadoPdf } from './agregadoFichaTecnicaPdf';
import { config } from '../../../config/config';
import { MODO_NORMATIVO, MODO_DESCRIPTIVO } from '../../../lib/evaluacion';

// Decisión 2026-05-28: el modo Descriptivo es el default público.
// El Normativo es opcional (auditoría/licitación).
const MODO_OPTIONS = [
    { label: 'Descriptivo', value: MODO_DESCRIPTIVO },
    { label: 'Normativo',   value: MODO_NORMATIVO },
];

/**
 * PR6: deriva el contexto del agregado ('HORMIGON' | 'TBS' | 'AMBOS') desde
 * el array `aptitudes` del agregado. Espejo del helper backend
 * `resolverContextoAplicacion` ([agregadoEnsayoService.js:131]).
 *
 * Comportamiento:
 *   - aptitudes vacías / no array → 'HORMIGON' (default seguro: la mayoría de
 *     tenants y agregados son solo-hormigón).
 *   - solo 'HORMIGON' → 'HORMIGON'.
 *   - solo TBS_* → 'TBS'.
 *   - HORMIGON + TBS_* → 'AMBOS'.
 */
function derivarContextoDesdeAptitudes(aptitudes) {
    let arr = aptitudes;
    if (typeof arr === 'string') {
        try { arr = JSON.parse(arr); } catch { arr = []; }
    }
    if (!Array.isArray(arr) || arr.length === 0) return 'HORMIGON';
    const tieneHormigon = arr.includes('HORMIGON');
    const tieneTbs = arr.some((a) => typeof a === 'string' && a.startsWith('TBS'));
    if (tieneHormigon && tieneTbs) return 'AMBOS';
    if (tieneTbs) return 'TBS';
    return 'HORMIGON';
}

// Orden de secciones del PDF. Las letras (A, B, C...) se asignan dinámicamente
// en el generador del PDF según las secciones que se incluyan; acá el label
// es solo informativo del orden relativo, sin numeración fija.
const SECTIONS = [
    { key: 'identificacion',  label: 'Identificación del agregado' },
    { key: 'caracterizacion', label: 'Caracterización básica' },
    { key: 'granulometria',   label: 'Granulometría (tabla + gráfico + evaluación)' },
    { key: 'complementarios', label: 'Ensayos realizados' },
    { key: 'cumplimiento',    label: 'Cumplimiento normativo (CIRSOC 200-2024)' },
    { key: 'veredicto',       label: 'Veredicto del agregado' },
    { key: 'advertencia',     label: 'Advertencia técnica' },
];

const FichaTecnicaModal = ({
    visible,
    onHide,
    legacyAgregadoId,
    agregadoNombre,
    agregadoTipo,
    caract: caractProp,
    ensayos: ensayosProp,
    resumen: resumenProp,
}) => {
    const [sections, setSections] = useState({
        identificacion:  true,
        caracterizacion: true,
        granulometria:   true,
        complementarios: true,
        cumplimiento:    true,
        veredicto:       true,
        advertencia:     true,
    });
    const [meta, setMeta] = useState(null);
    const [metaLoading, setMetaLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState(null);
    // Modo del documento (decisión 2026-05-28).
    //   DESCRIPTIVO (default público): muestra los datos sin emitir juicio.
    //   NORMATIVO: evalúa contra matriz CIRSOC/IRAM completa, sin filtros
    //   por catálogo del tenant. Para auditoría/licitación.
    const [modoEvaluacion, setModoEvaluacion] = useState(MODO_DESCRIPTIVO);

    // Auto-fetched data (when props are not provided)
    const [fetchedCaract, setFetchedCaract] = useState(null);
    const [fetchedEnsayos, setFetchedEnsayos] = useState(null);
    const [fetchedResumen, setFetchedResumen] = useState(null);

    // Resolved values: prefer props, fall back to fetched
    const caract = caractProp ?? fetchedCaract;
    const ensayos = ensayosProp ?? fetchedEnsayos;
    const resumen = resumenProp ?? fetchedResumen;

    // Fetch AgregadoMeta + missing data when modal opens
    useEffect(() => {
        if (!visible || !legacyAgregadoId) return;
        let cancelled = false;
        setMetaLoading(true);
        setMeta(null);
        setError(null);
        setFetchedCaract(null);
        setFetchedEnsayos(null);
        setFetchedResumen(null);

        const promises = [
            getAgregadoMeta(legacyAgregadoId).catch(() => ({})),
        ];
        // Only fetch if not provided via props
        if (caractProp == null) {
            promises.push(getCaracterizacion(legacyAgregadoId, agregadoTipo || null).catch(() => ({})));
        }
        if (ensayosProp == null) {
            promises.push(getEnsayos({ legacyAgregadoId }).catch(() => []));
        }
        if (resumenProp == null) {
            // Pasamos `modo` al backend: en DESCRIPTIVO no se calcula
            // veredicto ni compliance; en NORMATIVO se evalúa contra la
            // matriz completa.
            promises.push(getResumen(legacyAgregadoId, {
                uso: agregadoTipo || undefined,
                modo: modoEvaluacion,
            }).catch(() => null));
        }

        Promise.all(promises).then(results => {
            if (cancelled) return;
            let idx = 0;
            setMeta(results[idx++]);
            if (caractProp == null) setFetchedCaract(results[idx++]);
            if (ensayosProp == null) setFetchedEnsayos(results[idx++]);
            if (resumenProp == null) setFetchedResumen(results[idx++]);
        }).catch(() => {
            if (!cancelled) setMeta({});
        }).finally(() => {
            if (!cancelled) setMetaLoading(false);
        });

        return () => { cancelled = true; };
    }, [visible, legacyAgregadoId, agregadoTipo, caractProp, ensayosProp, resumenProp, modoEvaluacion]);

    const toggleSection = (key) => {
        setSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const allSelected = SECTIONS.every(s => sections[s.key]);
    const toggleAll = () => {
        const newVal = !allSelected;
        const next = {};
        SECTIONS.forEach(s => { next[s.key] = newVal; });
        setSections(next);
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            // PR6: derivar contexto del agregado desde sus aptitudes para que el
            // PDF filtre ensayos TBS-only / hormigón-only correctamente y lea
            // los flags `obligatorio[contexto]` del catálogo nuevo.
            // Default seguro: HORMIGON.
            const contextoAgregado = derivarContextoDesdeAptitudes(meta?.aptitudes);
            await generarFichaTecnicaAgregadoPdf({
                agregadoNombre,
                agregadoTipo,
                legacyAgregadoId,
                meta: meta || {},
                caract: caract || {},
                ensayos: ensayos || [],
                resumen: resumen || null,
                contextoAgregado,
                sections,
                logoUrl: config.thumbnail || null,
                modoEvaluacion,                            // PR9.3
            });
            onHide();
        } catch (err) {
            console.error('[FichaTecnica] Error generando PDF:', err);
            setError('Error al generar el PDF: ' + (err.message || 'Error desconocido'));
        } finally {
            setGenerating(false);
        }
    };

    const footer = (
        <div className="flex justify-content-end gap-2">
            <Button
                label="Cancelar"
                icon="fa-solid fa-xmark"
                severity="secondary"
                outlined
                size="small"
                onClick={onHide}
                disabled={generating}
            />
            <Button
                label={generating ? 'Generando...' : 'Descargar PDF'}
                icon={generating ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-pdf'}
                severity="danger"
                size="small"
                onClick={handleGenerate}
                disabled={generating || metaLoading || !SECTIONS.some(s => sections[s.key])}
            />
        </div>
    );

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header={
                <div className="flex align-items-center gap-2">
                    <i className="fa-solid fa-file-pdf text-red-500" />
                    <span>Exportar ficha técnica</span>
                </div>
            }
            footer={footer}
            style={{ width: '90vw', maxWidth: '420px' }}
            modal
            closable={!generating}
        >
            <div className="flex flex-column gap-3">
                {/* Aggregate summary */}
                <div className="surface-100 border-round p-3">
                    <div className="font-semibold text-sm mb-1">
                        <i className="fa-solid fa-cube mr-2 text-primary" />
                        {agregadoNombre || `Agregado #${legacyAgregadoId}`}
                    </div>
                    <div className="text-xs text-500">
                        {agregadoTipo && <span className="mr-3">Tipo: {agregadoTipo}</span>}
                        {meta?.cantera && <span className="mr-3">Cantera: {meta.cantera}</span>}
                        {meta?.productor && <span>Productor: {meta.productor}</span>}
                    </div>
                </div>

                {/* Modo del documento (decisión 2026-05-28) */}
                <div>
                    <div className="flex align-items-center justify-content-between mb-2">
                        <span className="font-semibold text-sm">Modo del documento</span>
                    </div>
                    <SelectButton
                        value={modoEvaluacion}
                        onChange={(e) => e.value && setModoEvaluacion(e.value)}
                        options={MODO_OPTIONS}
                        className="w-full"
                        pt={{ button: { className: 'text-xs' } }}
                    />
                    <div className="text-xs text-500 mt-2">
                        {modoEvaluacion === MODO_DESCRIPTIVO
                            ? 'El documento lista los datos del agregado (caracterización, ensayos realizados, granulometría) sin emitir valoración normativa. Apto para documentación interna y entrega al cliente como ficha técnica.'
                            : 'Verifica contra la matriz CIRSOC 200:2024 + serie IRAM completa, sin filtros por catálogo del tenant. Apto para auditorías externas, licitaciones y contraste técnico.'}
                    </div>
                </div>

                {/* Section toggles */}
                <div>
                    <div className="flex align-items-center justify-content-between mb-2">
                        <span className="font-semibold text-sm">Secciones a incluir</span>
                        <Button
                            label={allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                            link
                            size="small"
                            className="p-0 text-xs"
                            onClick={toggleAll}
                        />
                    </div>
                    <div className="flex flex-column gap-2">
                        {SECTIONS
                            // En modo Descriptivo el documento no emite
                            // veredicto ni tabla de cumplimiento normativo;
                            // ocultamos esos toggles para no ofrecer secciones
                            // que el PDF descriptivo no renderiza.
                            .filter(s => modoEvaluacion !== MODO_DESCRIPTIVO
                                || (s.key !== 'cumplimiento' && s.key !== 'veredicto'))
                            .map(s => (
                                <div key={s.key} className="flex align-items-center gap-2">
                                    <Checkbox
                                        inputId={`section-${s.key}`}
                                        checked={sections[s.key]}
                                        onChange={() => toggleSection(s.key)}
                                    />
                                    <label htmlFor={`section-${s.key}`} className="text-sm cursor-pointer">
                                        {s.label}
                                    </label>
                                </div>
                            ))}
                    </div>
                </div>

                {error && (
                    <Message severity="error" text={error} className="w-full" />
                )}

                <Message
                    severity="info"
                    text="Los datos de caracterización corresponden al ensayo más reciente para cada propiedad."
                    className="w-full"
                />
            </div>
        </Dialog>
    );
};

export default FichaTecnicaModal;
