import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "primereact/button";
import { Tooltip } from "primereact/tooltip";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { useTabContext } from "../../../context/TabContext";
import { useConfig } from "../../../context/ConfigContext";
import {
    getTipos,
    getEnsayoCountsByTipo,
    applyTemplate,
} from "../../../services/agregadoEnsayoService";
import { getNormas } from "../../../services/normaService";
// Reutilizamos las primitivas .wizard-mant-* y .wizard-cl-mockup-*:
import "../../admin/mantenimiento/WizardMantenimiento.css";
import "../../flota/mantenimiento/WizardChecklist.css";
import "./WizardCatalogoEnsayos.css";

/* ============================================================
   Wizard de configuración asistida · Catálogo de ensayos
   ============================================================
   Acompaña al usuario a entender QUÉ se configura en el catálogo
   de ensayos (no es alta de ensayos realizados — es la lista de
   tipos exigibles por material). Los conceptos clave:

     - Modelo dual prescriptivo / prestacional (PR9)
     - Multi-contexto Hormigón / TBS independientes
     - Niveles de caracterización (Ninguna / Básica / Avanzada)
     - Periodicidad y obligatoriedad por contexto
     - Set base CIRSOC/IRAM precargado
     - Snapshots de configuración

   9 pasos. Reutiliza el shell visual .wizard-mant-* del wizard
   de mantenimiento + las primitivas de mockup .wizard-cl-mockup-*. */

const STEPS = [
    { id: 'bienvenida',     label: 'Bienvenida',         icon: 'fa-solid fa-house' },
    { id: 'modelo-dual',    label: 'Modelo dual',        icon: 'fa-solid fa-scale-balanced' },
    { id: 'set-base',       label: 'Set base',           icon: 'fa-solid fa-flask-vial' },
    { id: 'contexto',       label: 'Hormigón / TBS',     icon: 'fa-solid fa-arrows-split-up-and-left' },
    { id: 'caracterizacion', label: 'Caracterización',    icon: 'fa-solid fa-layer-group' },
    { id: 'periodicidad',   label: 'Periodicidad',       icon: 'fa-solid fa-calendar-day' },
    { id: 'carga-ensayo',   label: 'Carga de ensayo',    icon: 'fa-solid fa-microscope' },
    { id: 'evaluacion',     label: 'Evaluación + snapshots', icon: 'fa-solid fa-bolt' },
    { id: 'listo',          label: 'Listo',              icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'cat_ens_wizard_step';
const PAUSED_KEY = 'cat_ens_wizard_paused';

const WizardCatalogoEnsayos = ({ visible, onClose, onFinish }) => {
    const showToast = useToast();
    const tabCtx = useTabContext();
    const cfg = useConfig();
    const navigate = useNavigate();
    const location = useLocation();

    const openInTab = useCallback((path, label) => {
        const [targetPath, targetHash] = path.split('#');
        const samePath = targetPath === location.pathname;
        if (onClose) onClose();
        if (samePath && targetHash) {
            setTimeout(() => navigate(`${location.pathname}${location.search || ''}#${targetHash}`, { replace: false }), 50);
            return;
        }
        if (tabCtx?.openNewTab) {
            setTimeout(() => {
                tabCtx.openNewTab(targetPath, label);
                if (targetHash) setTimeout(() => navigate(`${targetPath}#${targetHash}`), 150);
            }, 50);
        } else {
            window.open(path, '_blank');
        }
    }, [tabCtx, onClose, navigate, location.pathname, location.search]);

    const [stepIdx, setStepIdx] = useState(() => {
        const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        return Number.isFinite(saved) && saved >= 0 && saved < STEPS.length ? saved : 0;
    });
    const [completados, setCompletados] = useState(() => new Set());
    const bodyRef = useRef(null);

    // Datos verificados
    const [tiposAgregado, setTiposAgregado] = useState([]);
    const [tiposAgua, setTiposAgua] = useState([]);
    const [normas, setNormas] = useState([]);
    const [ensayoCounts, setEnsayoCounts] = useState({});
    const [loading, setLoading] = useState(false);

    // Métricas derivadas
    const totalTipos = tiposAgregado.length + tiposAgua.length;
    const tiposConHormigon = useMemo(() => (
        [...tiposAgregado, ...tiposAgua].filter((t) => t.aplicaAHormigon)
    ), [tiposAgregado, tiposAgua]);
    const tiposConTBS = useMemo(() => (
        [...tiposAgregado, ...tiposAgua].filter((t) => t.aplicaATBS)
    ), [tiposAgregado, tiposAgua]);
    const tiposObligatorios = useMemo(() => (
        [...tiposAgregado, ...tiposAgua].filter((t) => t.obligatorioHormigon || t.obligatorioTBS)
    ), [tiposAgregado, tiposAgua]);
    const totalEnsayosRealizados = useMemo(() => (
        Object.values(ensayoCounts).reduce((acc, c) => acc + (c?.total || 0), 0)
    ), [ensayoCounts]);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const [agRes, agRes2, nRes, cRes] = await Promise.all([
                getTipos({ material: 'AGREGADOS' }).catch(() => []),
                getTipos({ material: 'AGUA' }).catch(() => []),
                getNormas().catch(() => []),
                getEnsayoCountsByTipo().catch(() => ({})),
            ]);
            const tagr = Array.isArray(agRes) ? agRes : [];
            const tagua = Array.isArray(agRes2) ? agRes2 : [];
            const nr = Array.isArray(nRes) ? nRes : [];
            setTiposAgregado(tagr);
            setTiposAgua(tagua);
            setNormas(nr);
            setEnsayoCounts(cRes || {});

            // Auto-marcar pasos completos
            const done = new Set();
            done.add('bienvenida');
            done.add('modelo-dual');     // informativo
            done.add('contexto');        // informativo
            done.add('caracterizacion'); // informativo
            done.add('periodicidad');    // informativo
            done.add('carga-ensayo');    // informativo
            done.add('evaluacion');      // informativo
            // set-base: done si hay al menos 10 tipos cargados (set base mínimo)
            if (tagr.length + tagua.length >= 10) done.add('set-base');
            setCompletados(done);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (visible) cargarEstado();
    }, [visible, cargarEstado]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, String(stepIdx));
        if (visible && stepIdx > 0 && stepIdx < STEPS.length - 1) {
            localStorage.setItem(PAUSED_KEY, '1');
        }
        if (bodyRef.current) {
            bodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, [stepIdx, visible]);

    useEffect(() => {
        if (!visible) return;
        document.body.classList.add('wizard-mant-active');
        return () => document.body.classList.remove('wizard-mant-active');
    }, [visible]);

    if (!visible) return null;

    const currentStep = STEPS[stepIdx];
    const goNext = () => setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    const goPrev = () => setStepIdx((i) => Math.max(i - 1, 0));
    const goTo = (i) => setStepIdx(i);
    const finish = () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PAUSED_KEY);
        if (onFinish) onFinish();
        if (onClose) onClose();
    };

    const content = (
        <div className="wizard-mant wizard-mant-cat-ens">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-cat-ens-sidebar-icon">
                        <i className="fa-solid fa-flask-vial" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Catálogo de ensayos</h3>
                    </div>
                </div>

                <ol className="wizard-mant-steps">
                    {STEPS.map((s, i) => {
                        const isDone = completados.has(s.id);
                        const isActive = i === stepIdx;
                        return (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    className={`wizard-mant-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                                    onClick={() => goTo(i)}
                                >
                                    <span className="wizard-mant-step-marker">
                                        {isDone
                                            ? <i className="fa-solid fa-check" />
                                            : <span>{i + 1}</span>}
                                    </span>
                                    <span className="wizard-mant-step-label">
                                        <i className={s.icon} />
                                        {s.label}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>

                <div className="wizard-mant-sidebar-footer">
                    <small>Progreso</small>
                    <div className="wizard-mant-progress">
                        <div
                            className="wizard-mant-progress-fill wizard-cat-ens-progress-fill"
                            style={{ width: `${(completados.size / STEPS.length) * 100}%` }}
                        />
                    </div>
                    <small>{completados.size} / {STEPS.length} pasos</small>
                </div>
            </aside>

            <main className="wizard-mant-main">
                <header className="wizard-mant-header">
                    <div className="wizard-mant-header-step">
                        <i className={currentStep.icon} />
                        <span>Paso {stepIdx + 1} de {STEPS.length}</span>
                    </div>
                    <Button
                        icon="fa-solid fa-xmark"
                        rounded text size="small"
                        tooltip="Cerrar (podés retomar después)"
                        tooltipOptions={{ position: 'left' }}
                        onClick={onClose}
                        className="wizard-mant-close"
                    />
                </header>

                <div className="wizard-mant-body" ref={bodyRef}>
                    <StepContent
                        stepId={currentStep.id}
                        tiposAgregado={tiposAgregado}
                        tiposAgua={tiposAgua}
                        normas={normas}
                        totalTipos={totalTipos}
                        tiposConHormigon={tiposConHormigon}
                        tiposConTBS={tiposConTBS}
                        tiposObligatorios={tiposObligatorios}
                        totalEnsayosRealizados={totalEnsayosRealizados}
                        usaTBS={!!cfg?.usaTBS}
                        loading={loading}
                        reload={cargarEstado}
                        showToast={showToast}
                        openInTab={openInTab}
                    />
                </div>

                <footer className="wizard-mant-footer">
                    <Button
                        label="Anterior"
                        icon="fa-solid fa-arrow-left"
                        size="small"
                        text
                        onClick={goPrev}
                        disabled={stepIdx === 0}
                    />
                    <div className="wizard-mant-footer-spacer" />
                    {stepIdx === STEPS.length - 1 ? (
                        <Button
                            label="Finalizar"
                            icon="fa-solid fa-flag-checkered"
                            severity="success"
                            onClick={finish}
                        />
                    ) : (
                        <Button
                            label="Siguiente"
                            icon="fa-solid fa-arrow-right"
                            iconPos="right"
                            onClick={goNext}
                        />
                    )}
                </footer>
            </main>
        </div>
    );

    return createPortal(content, document.body);
};

/* ============================================================
   Router de pasos
   ============================================================ */
const StepContent = (props) => {
    const { stepId } = props;
    if (stepId === 'bienvenida')      return <StepBienvenida {...props} />;
    if (stepId === 'modelo-dual')     return <StepModeloDual {...props} />;
    if (stepId === 'set-base')        return <StepSetBase {...props} />;
    if (stepId === 'contexto')        return <StepContexto {...props} />;
    if (stepId === 'caracterizacion') return <StepCaracterizacion {...props} />;
    if (stepId === 'periodicidad')    return <StepPeriodicidad {...props} />;
    if (stepId === 'carga-ensayo')    return <StepCargaEnsayo {...props} />;
    if (stepId === 'evaluacion')      return <StepEvaluacion {...props} />;
    if (stepId === 'listo')           return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-cat-ens-hero-icon">
                <i className="fa-solid fa-flask-vial" />
            </div>
            <h2>Bienvenido al Catálogo de ensayos</h2>
            <p>
                El catálogo define <strong>qué tipos de ensayo se exigen para cada material</strong> en
                tu instalación: granulometrías, equivalente arena, abrasión Los Ángeles, durabilidad, etc.
                No es la lista de ensayos realizados, sino la lista de ensayos <strong>exigibles</strong>:
                lo que vas a configurar acá determina cómo se evalúan tus materiales y qué aparece
                en informes, fichas técnicas y certificados.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-cat-ens-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-scale-balanced" style={{ color: '#8b5cf6' }} />
                <strong>Modelo dual</strong>
                <small>Prescriptivo (norma soberana) vs prestacional (catálogo soberano).</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-arrows-split-up-and-left" style={{ color: '#0ea5e9' }} />
                <strong>Multi-contexto</strong>
                <small>Cada ensayo decide si aplica a Hormigón, TBS o ambos — independiente.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-layer-group" style={{ color: '#f59e0b' }} />
                <strong>Niveles de caracterización</strong>
                <small>Ninguna / Básica / Avanzada — controla qué aparece en la ficha del material.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-calendar-day" style={{ color: '#16a34a' }} />
                <strong>Periodicidad</strong>
                <small>Cada cuántos meses vence un ensayo y cuántos días antes se preavisa.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-flask-vial" style={{ color: '#ef4444' }} />
                <strong>Set base</strong>
                <small>Set CIRSOC 200-2024 + IRAM precargable con un click.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-clock-rotate-left" style={{ color: '#6e79eb' }} />
                <strong>Snapshots</strong>
                <small>Guardá la configuración del catálogo y restaurala más tarde.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Podés cerrar el asistente cuando quieras y al volver vas a retomar exactamente
                donde dejaste. Tus cambios en la configuración se aplican en tiempo real.
            </span>
        </div>
    </div>
);

/* ─── 1. Modelo dual prescriptivo / prestacional ──────────── */
const StepModeloDual = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-scale-balanced" /> El modelo dual: prescriptivo vs prestacional</h2>
        <p>
            Esto es lo más importante de entender del catálogo. HormiQual evalúa tus materiales
            bajo <strong>dos modos paralelos</strong> y vos elegís cuál vale en cada documento. El
            catálogo que configurás acá <strong>solo manda en modo prestacional</strong> — el modo prescriptivo
            ignora tu catálogo y va directo a la norma.
        </p>

        <div className="wizard-cat-ens-compare">
            <div className="wizard-cat-ens-compare-col prest">
                <div className="wizard-cat-ens-compare-head">
                    <div className="wizard-cat-ens-compare-icon" style={{ background: '#8b5cf6' }}>
                        <i className="fa-solid fa-building-shield" />
                    </div>
                    <div>
                        <h4>Prestacional</h4>
                        <small>Tu catálogo es soberano</small>
                    </div>
                </div>
                <ul>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Solo se exigen ensayos <strong>marcados como obligatorios en tu catálogo</strong></span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Ensayos no exigidos por vos <strong>no aparecen como faltantes</strong></span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Es el modo que usan las <strong>fichas técnicas e informes públicos</strong> por default</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Lo que firmás como cumplimiento queda atado a esta configuración</span>
                    </li>
                </ul>
                <div className="wizard-cat-ens-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Default público. Documentos firmados, informes a clientes, certificados.</p>
                </div>
            </div>

            <div className="wizard-cat-ens-compare-col presc">
                <div className="wizard-cat-ens-compare-head">
                    <div className="wizard-cat-ens-compare-icon" style={{ background: '#ef4444' }}>
                        <i className="fa-solid fa-book-bookmark" />
                    </div>
                    <div>
                        <h4>Prescriptivo</h4>
                        <small>La norma es soberana, ignora tu catálogo</small>
                    </div>
                </div>
                <ul>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Se exigen <strong>todos los ensayos que pide CIRSOC/IRAM</strong> aunque no estén en tu catálogo</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Detecta ensayos faltantes que tu configuración "silenciaría"</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Lo usan internamente la <strong>sugerencia automática</strong> y las <strong>alertas reactivas</strong></span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Disponible como opción en informes para auditorías externas</span>
                    </li>
                </ul>
                <div className="wizard-cat-ens-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Auditoría externa, motor de sugerencia, alertas. Toggle manual en PDFs.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Por qué importa:</strong>
                <p>
                    Si dejás un ensayo desactivado en tu catálogo (ej. abrasión Los Ángeles para arena),
                    en modo prestacional no se exige. Pero si la norma sí lo exige, en modo prescriptivo
                    aparecerá como faltante. La decisión es tuya — el sistema solo te muestra ambas miradas
                    para que sepas cuándo estás "ocultando" algo respecto a la norma.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 2. Set base CIRSOC/IRAM ─────────────────────────────── */
const StepSetBase = ({ tiposAgregado, tiposAgua, totalTipos, loading, reload, showToast }) => {
    const [installing, setInstalling] = useState(false);
    const installingRef = useRef(false);

    const tieneSet = totalTipos >= 10;

    const instalarSet = (material, label) => {
        confirmDialog({
            message: `Se crearán los ensayos de ${label} que falten en el catálogo. Los ensayos que ya existen NO se modifican — tu configuración se respeta. ¿Continuar?`,
            header: `Instalar set base de ${label}`,
            icon: 'fa-solid fa-flask-vial',
            acceptLabel: 'Instalar',
            rejectLabel: 'Cancelar',
            accept: async () => {
                if (installingRef.current) return;
                installingRef.current = true;
                setInstalling(true);
                try {
                    const templateKey = material === 'AGREGADOS' ? 'CORE_AGREGADOS' : 'CORE_AGUA';
                    const result = await applyTemplate({ material, template: templateKey });
                    const { created = 0, skipped = 0, total = 0 } = result;
                    if (created > 0) {
                        showToast('success', `${created} ensayo${created !== 1 ? 's' : ''} creado${created !== 1 ? 's' : ''}. ${skipped} ya existían.`);
                    } else {
                        showToast('info', `El catálogo ya tiene los ${total} ensayos definidos. Sin cambios.`);
                    }
                    await reload();
                } catch (err) {
                    console.error(err);
                    showToast('error', err?.response?.data?.error || 'Error al instalar set base');
                } finally {
                    installingRef.current = false;
                    setInstalling(false);
                }
            },
        });
    };

    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-flask-vial" /> Set base CIRSOC 200-2024 + IRAM</h2>
            <p>
                HormiQual viene con un set predefinido de ensayos basado en la <strong>normativa argentina</strong>:
                granulometría (IRAM 1505), peso específico, equivalente arena (IRAM 1682), abrasión Los Ángeles
                (IRAM 1532), durabilidad sulfato de sodio (IRAM 1525), reactividad alcali-agregado, y muchos más.
                En lugar de cargarlos uno por uno, lo instalás de una sola vez.
            </p>

            <div className="wizard-mant-status">
                {loading ? (
                    <span className="wizard-mant-status-loading"><i className="fa-solid fa-spinner fa-spin" /> Verificando…</span>
                ) : tieneSet ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{totalTipos}</strong> tipos de ensayo cargados
                        ({tiposAgregado.length} de Agregados, {tiposAgua.length} de Agua)
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Tu catálogo tiene <strong>{totalTipos}</strong> tipos. Te recomendamos instalar el set base.
                    </span>
                )}
            </div>

            <div className="wizard-cat-ens-set-grid">
                <div className="wizard-cat-ens-set-card">
                    <div className="wizard-cat-ens-set-icon agregados">
                        <i className="fa-solid fa-mountain" />
                    </div>
                    <div className="wizard-cat-ens-set-body">
                        <strong>Agregados</strong>
                        <p>~15 ensayos: granulometría, peso específico, equivalente arena, abrasión, durabilidad,
                        reactividad alcali-agregado, terrones friables, etc.</p>
                        <small className="wizard-cat-ens-set-count">
                            {tiposAgregado.length} cargado{tiposAgregado.length !== 1 ? 's' : ''} actualmente
                        </small>
                    </div>
                    <Button
                        label="Instalar"
                        icon="fa-solid fa-download"
                        size="small"
                        severity="success"
                        outlined
                        loading={installing}
                        disabled={installing}
                        onClick={() => instalarSet('AGREGADOS', 'Agregados')}
                    />
                </div>

                <div className="wizard-cat-ens-set-card">
                    <div className="wizard-cat-ens-set-icon agua">
                        <i className="fa-solid fa-droplet" />
                    </div>
                    <div className="wizard-cat-ens-set-body">
                        <strong>Agua</strong>
                        <p>Ensayos de IRAM 1601: pH, sólidos disueltos, sulfatos, cloruros, materia orgánica.
                        Indispensables si vas a usar agua no potable.</p>
                        <small className="wizard-cat-ens-set-count">
                            {tiposAgua.length} cargado{tiposAgua.length !== 1 ? 's' : ''} actualmente
                        </small>
                    </div>
                    <Button
                        label="Instalar"
                        icon="fa-solid fa-download"
                        size="small"
                        severity="success"
                        outlined
                        loading={installing}
                        disabled={installing}
                        onClick={() => instalarSet('AGUA', 'Agua')}
                    />
                </div>
            </div>

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-shield-halved" />
                <div>
                    <strong>Seguridad de la operación:</strong>
                    <p>
                        Instalar el set base <strong>nunca pisa configuración existente</strong>. Solo crea los tipos
                        que faltan. Si ya editaste obligatoriedad, periodicidad o niveles para algún ensayo,
                        esos cambios se respetan. Es seguro tocar el botón aunque ya hayas hecho ajustes.
                    </p>
                </div>
            </div>
        </div>
    );
};

/* ─── 3. Multi-contexto Hormigón / TBS ─────────────────────── */
const StepContexto = ({ tiposConHormigon, tiposConTBS, totalTipos, usaTBS }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-arrows-split-up-and-left" /> Aplicación por contexto: Hormigón y TBS</h2>
        <p>
            Cada tipo de ensayo decide <strong>independientemente</strong> si aplica a hormigón, a TBS
            (tratamientos bituminosos superficiales) o a ambos. Esto es importante porque algunos ensayos
            son comunes (granulometría) pero otros solo tienen sentido en uno de los dos contextos
            (ej. equivalente arena pesa distinto en hormigón que en TBS).
        </p>

        <div className="wizard-mant-status">
            <span className="wizard-mant-status-ok">
                <i className="fa-solid fa-circle-check" />
                <strong>{tiposConHormigon.length}</strong> aplican a Hormigón ·
                <strong> {tiposConTBS.length}</strong> aplican a TBS · de {totalTipos} totales
            </span>
        </div>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-table" />
            Cómo se ve en la tabla del catálogo
        </h3>
        <p>
            Cada fila tiene una columna <em>Contexto</em> con dos chips clicables — verde si aplica,
            gris si no. Al apagar un contexto, el sistema deja en cero la caracterización y la
            obligatoriedad para ese contexto (preserva coherencia automáticamente).
        </p>

        <ContextoChipsMockup />

        {!usaTBS && (
            <div className="wizard-mant-callout">
                <i className="fa-solid fa-circle-info" />
                <div>
                    <strong>No tenés TBS habilitado en tu instalación:</strong>
                    <p>
                        Por eso, el filtro del catálogo oculta los ensayos que aplican solo a TBS para
                        no ensuciar la vista. Podés cambiar el filtro al modo <em>Todos</em> en cualquier
                        momento desde el panel superior de la página.
                    </p>
                </div>
            </div>
        )}

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Si más adelante habilitás TBS, no perdés nada — los ensayos ya configurados
                como solo-Hormigón siguen igual. Solo se vuelven editables los que también aplican a TBS.
            </span>
        </div>
    </div>
);

const ContextoChipsMockup = () => (
    <div className="wizard-cl-mockup">
        <div className="wizard-cl-mockup-window">
            <div className="wizard-cl-mockup-bar">
                <span className="wizard-cl-mockup-dot" style={{ background: '#ff5f56' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#ffbd2e' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#27c93f' }} />
                <span className="wizard-cl-mockup-url">
                    <i className="fa-solid fa-lock" /> hormiqual.com/calidad/catalogos/ensayos
                </span>
            </div>
            <div className="wizard-cl-mockup-body">
                <table className="wizard-cat-ens-mockup-table">
                    <thead>
                        <tr>
                            <th>Nombre</th>
                            <th>Norma</th>
                            <th>Contexto</th>
                            <th>Caract.</th>
                            <th>Oblig.</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Granulometría</td>
                            <td><span className="wizard-cat-ens-norma">IRAM 1505</span></td>
                            <td>
                                <span className="wizard-cat-ens-chip on">H</span>
                                <span className="wizard-cat-ens-chip on">TBS</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag basica">H: Bás.</span>
                                <span className="wizard-cat-ens-tag basica">TBS: Bás.</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag oblig">H ✓</span>
                                <span className="wizard-cat-ens-tag oblig">TBS ✓</span>
                            </td>
                        </tr>
                        <tr>
                            <td>Equivalente arena</td>
                            <td><span className="wizard-cat-ens-norma">IRAM 1682</span></td>
                            <td>
                                <span className="wizard-cat-ens-chip on">H</span>
                                <span className="wizard-cat-ens-chip off">TBS</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag avanzada">H: Avz.</span>
                                <span className="wizard-cat-ens-tag muted">TBS: —</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag oblig">H ✓</span>
                                <span className="wizard-cat-ens-tag muted">TBS</span>
                            </td>
                        </tr>
                        <tr>
                            <td>Pérdida x calentamiento</td>
                            <td><span className="wizard-cat-ens-norma">DNV E.7</span></td>
                            <td>
                                <span className="wizard-cat-ens-chip off">H</span>
                                <span className="wizard-cat-ens-chip on">TBS</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag muted">H: —</span>
                                <span className="wizard-cat-ens-tag basica">TBS: Bás.</span>
                            </td>
                            <td>
                                <span className="wizard-cat-ens-tag muted">H</span>
                                <span className="wizard-cat-ens-tag oblig">TBS ✓</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div className="wizard-mant-mockup-note">
                    <i className="fa-solid fa-arrow-up" />
                    <span>Los chips son clicables: un click activa/desactiva el contexto. La coherencia
                    (caracterización y obligatoriedad) se ajusta sola al desactivar un contexto.</span>
                </div>
            </div>
        </div>
    </div>
);

/* ─── 4. Niveles de caracterización ───────────────────────── */
const StepCaracterizacion = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-layer-group" /> Niveles de caracterización</h2>
        <p>
            Para cada contexto activo, definís un <strong>nivel</strong> que controla dos cosas a la vez:
            si el ensayo aparece en la ficha del material, y si es obligatorio. Hay tres niveles —
            cuanto más alto, más exigente:
        </p>

        <div className="wizard-cat-ens-niveles">
            <div className="wizard-cat-ens-nivel">
                <div className="wizard-cat-ens-nivel-icon ninguna">
                    <i className="fa-solid fa-minus" />
                </div>
                <div className="wizard-cat-ens-nivel-body">
                    <h4>Ninguna <small>(—)</small></h4>
                    <ul>
                        <li><i className="fa-solid fa-eye-slash" /><span>No aparece en la ficha del material</span></li>
                        <li><i className="fa-solid fa-ban" /><span>No exigible (obligatorio fijo en false)</span></li>
                        <li><i className="fa-solid fa-circle-info" /><span>Útil cuando el ensayo no tiene sentido para ese contexto</span></li>
                    </ul>
                </div>
            </div>

            <div className="wizard-cat-ens-nivel">
                <div className="wizard-cat-ens-nivel-icon basica">
                    <i className="fa-solid fa-circle" />
                </div>
                <div className="wizard-cat-ens-nivel-body">
                    <h4>Básica</h4>
                    <ul>
                        <li><i className="fa-solid fa-eye" /><span>Aparece en la ficha del material</span></li>
                        <li><i className="fa-solid fa-lock" /><span>Obligatorio fijo en true (no editable)</span></li>
                        <li><i className="fa-solid fa-shield" /><span>El sistema garantiza que se exige siempre</span></li>
                    </ul>
                </div>
            </div>

            <div className="wizard-cat-ens-nivel">
                <div className="wizard-cat-ens-nivel-icon avanzada">
                    <i className="fa-solid fa-star" />
                </div>
                <div className="wizard-cat-ens-nivel-body">
                    <h4>Avanzada</h4>
                    <ul>
                        <li><i className="fa-solid fa-eye" /><span>Aparece en la ficha del material</span></li>
                        <li><i className="fa-solid fa-toggle-on" /><span>Obligatorio editable (lo elegís vos)</span></li>
                        <li><i className="fa-solid fa-flask" /><span>Para ensayos opcionales o experimentales</span></li>
                    </ul>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>La coherencia se aplica automáticamente:</strong>
                <p>
                    Si bajás un ensayo de <em>Avanzada</em> a <em>Ninguna</em>, el sistema apaga la obligatoriedad solo.
                    Si subís a <em>Básica</em>, la obligatoriedad se fuerza a true. No tenés que pelear contra
                    estados inconsistentes — el modelo te empuja a la combinación que tiene sentido.
                </p>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Recomendación: arrancá con todos los ensayos del set base en <strong>Básica</strong> y bajá a
                <em> Ninguna</em> los que tu operación no necesita. Es más fácil restar que sumar.
            </span>
        </div>
    </div>
);

/* ─── 5. Periodicidad ──────────────────────────────────────── */
const StepPeriodicidad = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-calendar-day" /> Periodicidad y vencimientos</h2>
        <p>
            Cada tipo de ensayo puede tener una <strong>periodicidad en meses</strong>: cada cuánto se debe
            re-ensayar el material para que el ensayo siga siendo válido. Junto a la periodicidad,
            podés definir un <strong>warning en días</strong>: cuántos días antes del vencimiento el sistema
            te muestra el preaviso amarillo en la ficha del material.
        </p>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-table" />
            Ejemplos típicos
        </h3>

        <table className="wizard-cat-ens-period-table">
            <thead>
                <tr>
                    <th>Tipo de ensayo</th>
                    <th>Periodicidad sugerida</th>
                    <th>Warning</th>
                    <th>Por qué</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Granulometría</strong></td>
                    <td>3 meses</td>
                    <td>15 días</td>
                    <td className="text-color-secondary">Cambia con la cantera, lluvias, lote</td>
                </tr>
                <tr>
                    <td><strong>Equivalente arena</strong></td>
                    <td>6 meses</td>
                    <td>30 días</td>
                    <td className="text-color-secondary">Sensible al lavado de la arena</td>
                </tr>
                <tr>
                    <td><strong>Peso específico</strong></td>
                    <td>12 meses</td>
                    <td>30 días</td>
                    <td className="text-color-secondary">Estable para el mismo origen</td>
                </tr>
                <tr>
                    <td><strong>Abrasión Los Ángeles</strong></td>
                    <td>24 meses</td>
                    <td>60 días</td>
                    <td className="text-color-secondary">Propiedad estructural del agregado</td>
                </tr>
                <tr>
                    <td><strong>Reactividad alcali-agregado</strong></td>
                    <td>36 meses</td>
                    <td>90 días</td>
                    <td className="text-color-secondary">Determinación inicial, raras veces se repite</td>
                </tr>
            </tbody>
        </table>

        <div className="wizard-cat-ens-vencimiento-mock">
            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-bell" />
                Cómo se ven los vencimientos en la ficha
            </h3>
            <div className="wizard-cat-ens-status-row">
                <div className="wizard-cat-ens-status-card valid">
                    <i className="fa-solid fa-circle-check" />
                    <div>
                        <strong>Válido</strong>
                        <small>Vence en más de N días</small>
                    </div>
                </div>
                <div className="wizard-cat-ens-status-card warn">
                    <i className="fa-solid fa-triangle-exclamation" />
                    <div>
                        <strong>Por vencer</strong>
                        <small>Faltan menos de N días (warning)</small>
                    </div>
                </div>
                <div className="wizard-cat-ens-status-card expired">
                    <i className="fa-solid fa-circle-xmark" />
                    <div>
                        <strong>Vencido</strong>
                        <small>Pasó la fecha de validez</small>
                    </div>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Sin periodicidad = sin vencimiento:</strong>
                <p>
                    Si dejás la periodicidad en blanco, el ensayo se considera válido para siempre
                    desde el momento de carga. Útil para ensayos de caracterización inicial que no
                    se vuelven a hacer (ej. forma de partículas).
                </p>
            </div>
        </div>
    </div>
);

/* ─── 6. Cómo se carga un ensayo ──────────────────────────── */
const StepCargaEnsayo = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-microscope" /> Cómo se carga un ensayo realizado</h2>
        <p>
            El catálogo solo define <strong>qué ensayos se exigen</strong>. La carga de los ensayos
            <strong> realizados</strong> (el resultado concreto de un ensayo en un material específico)
            se hace desde la <strong>ficha del material</strong>. Acá un overview del flujo:
        </p>

        <FichaMaterialMockup />

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-arrows-split-up-and-left" />
            Dos formas de cargar: individual o por campaña
        </h3>
        <p>
            Desde la pestaña <em>Ensayos</em> de la ficha hay <strong>dos botones</strong> según cómo
            te llegan los resultados del laboratorio. Los dos terminan guardando ensayos en el mismo
            material — la diferencia está en qué tan bien aprovechás los datos compartidos.
        </p>

        <div className="wizard-cat-ens-compare wizard-cat-ens-compare-tight">
            <div className="wizard-cat-ens-compare-col indiv">
                <div className="wizard-cat-ens-compare-head">
                    <div className="wizard-cat-ens-compare-icon" style={{ background: '#0ea5e9' }}>
                        <i className="fa-solid fa-pen-to-square" />
                    </div>
                    <div>
                        <h4>Carga individual</h4>
                        <small>Un ensayo a la vez · botón "Nuevo ensayo"</small>
                    </div>
                </div>
                <ul>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Cada ensayo tiene su <strong>propio header</strong> (fecha, laboratorio, informe)</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Form completo del tipo elegido, con todos sus campos normalizados</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Útil cuando llega un <strong>ensayo aislado</strong> (un solo resultado, sin contexto compartido)</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Es el flujo recomendado para <strong>granulometría</strong> (tiene su propio form de tamizado)</span>
                    </li>
                </ul>
                <div className="wizard-cat-ens-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>Resultado suelto que no comparte origen con otros, o cualquier carga de granulometría.</p>
                </div>
            </div>

            <div className="wizard-cat-ens-compare-col camp">
                <div className="wizard-cat-ens-compare-head">
                    <div className="wizard-cat-ens-compare-icon" style={{ background: '#8b5cf6' }}>
                        <i className="fa-solid fa-clipboard-list" />
                    </div>
                    <div>
                        <h4>Carga por campaña</h4>
                        <small>Múltiples ensayos · botón "Cargar campaña"</small>
                    </div>
                </div>
                <ul>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span><strong>Header común</strong> para todos: fecha de ensayo, fecha de muestreo, laboratorio, número de informe, observaciones</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Lista de <strong>secciones plegables</strong> — una por tipo de ensayo aplicable. Abrís solo las que vas a completar</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Se guarda todo <strong>de una sola vez</strong> — todo o nada, sin riesgo de quedar a mitad de camino</span>
                    </li>
                    <li>
                        <i className="fa-solid fa-check" />
                        <span>Granulometría queda excluida (carga aparte por la complejidad del tamizado)</span>
                    </li>
                </ul>
                <div className="wizard-cat-ens-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>El laboratorio te entrega <strong>un informe único con N resultados</strong> al mismo material y misma fecha. Es muchísimo más rápido que cargar uno por uno.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                <strong>Regla práctica:</strong> si el informe del laboratorio tiene 2+ ensayos del mismo
                material en la misma fecha, usá <em>campaña</em>. Si es un único ensayo, da igual cuál uses.
            </span>
        </div>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-list-ol" />
            Pasos para cargar un ensayo
        </h3>
        <ol className="wizard-cat-ens-steps-list">
            <li>
                <strong>Andá al material</strong> (Calidad → Catálogos → Materiales → click en el agregado/agua/etc).
            </li>
            <li>
                <strong>Pestaña <em>Ensayos</em></strong> dentro de la ficha — ahí ves la lista cronológica
                de ensayos cargados, con su cumplimiento normativo.
            </li>
            <li>
                Elegí el flujo: <strong>"Nuevo ensayo"</strong> para uno solo, o <strong>"Cargar campaña"</strong>
                si tenés varios del mismo informe. La UI te muestra solo los tipos que aplican al material
                (según contexto, perfil y nivel de caracterización configurados en este catálogo).
            </li>
            <li>
                Cargás laboratorio, fecha, número de informe y los <strong>resultados normalizados</strong>.
                En campaña, el header se completa una sola vez para todos.
            </li>
            <li>
                <strong>Al guardar</strong>, el sistema evalúa cada ensayo contra la norma vinculada y
                marca <em>Cumple / No cumple / Pendiente</em>. El estado del material puede cambiar
                automáticamente y dispara alertas reactivas en dosificaciones afectadas.
            </li>
            <li>
                <strong>Si el ensayo es nuevo</strong> y todavía no figura en el catálogo, podés
                agregarlo desde acá (botón <em>Configurar</em> de esta misma página) — el asistente
                te guía para vincular la norma, definir los campos a completar, el perfil y a qué
                contextos aplica (Hormigón, TBS o ambos).
            </li>
        </ol>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Materiales"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/calidad/catalogos/materiales', 'Materiales')}
            />
        </div>
    </div>
);

const FichaMaterialMockup = () => (
    <div className="wizard-cl-mockup">
        <div className="wizard-cl-mockup-window">
            <div className="wizard-cl-mockup-bar">
                <span className="wizard-cl-mockup-dot" style={{ background: '#ff5f56' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#ffbd2e' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#27c93f' }} />
                <span className="wizard-cl-mockup-url">
                    <i className="fa-solid fa-lock" /> hormiqual.com/calidad/catalogos/materiales/detalle/agregado/12
                </span>
            </div>

            <div className="wizard-cl-mockup-body">
                <div className="wizard-cl-mockup-header">
                    <div className="wizard-cl-mockup-page-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                        <i className="fa-solid fa-mountain" />
                    </div>
                    <div>
                        <div className="wizard-cl-mockup-title">Arena Río Limay</div>
                        <div className="wizard-cl-mockup-subtitle">Agregado fino · TMN 4,75 mm · Planta Centenario</div>
                    </div>
                </div>

                <div className="wizard-cl-mockup-subtabs">
                    <div className="wizard-cl-mockup-subtab">
                        <i className="fa-solid fa-circle-info" /> Datos generales
                    </div>
                    <div className="wizard-cl-mockup-subtab active">
                        <i className="fa-solid fa-microscope" /> Ensayos
                        <span className="wizard-cl-mockup-mini-badge">12</span>
                    </div>
                    <div className="wizard-cl-mockup-subtab">
                        <i className="fa-solid fa-chart-line" /> Granulometría
                    </div>
                    <div className="wizard-cl-mockup-subtab">
                        <i className="fa-solid fa-file-lines" /> Documentos
                    </div>
                </div>

                <div className="wizard-cat-ens-mockup-toolbar">
                    <span className="wizard-cat-ens-mockup-search">
                        <i className="fa-solid fa-magnifying-glass" /> Buscar tipo de ensayo…
                    </span>
                    <span className="wizard-cat-ens-mockup-add">
                        <i className="fa-solid fa-plus" /> Nuevo ensayo
                    </span>
                </div>

                <table className="wizard-cat-ens-mockup-table">
                    <thead>
                        <tr>
                            <th>Tipo</th>
                            <th>Fecha</th>
                            <th>Resultado</th>
                            <th>Cumple</th>
                            <th>Vence</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Granulometría</td>
                            <td>03/05/2026</td>
                            <td>Mód. fineza: 2,82</td>
                            <td><span className="wizard-cat-ens-tag oblig">✓</span></td>
                            <td>03/08/2026</td>
                        </tr>
                        <tr>
                            <td>Equivalente arena</td>
                            <td>15/04/2026</td>
                            <td>EA = 78%</td>
                            <td><span className="wizard-cat-ens-tag oblig">✓</span></td>
                            <td>15/10/2026</td>
                        </tr>
                        <tr>
                            <td>Peso específico</td>
                            <td>10/01/2026</td>
                            <td>2,64 g/cm³</td>
                            <td><span className="wizard-cat-ens-tag oblig">✓</span></td>
                            <td>10/01/2027</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
);

/* ─── 7. Evaluación automática + configuraciones guardadas ─ */
const StepEvaluacion = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-bolt" /> Evaluación automática y configuraciones guardadas</h2>
        <p>
            Tu catálogo no es un documento estático — es la regla que el sistema aplica cada vez que
            pasa algo en calidad. Hay dos comportamientos importantes que conviene entender:
        </p>

        <div className="wizard-cat-ens-feature-grid">
            <div className="wizard-cat-ens-feature">
                <div className="wizard-cat-ens-feature-icon" style={{ background: '#f59e0b' }}>
                    <i className="fa-solid fa-bolt" />
                </div>
                <div className="wizard-cat-ens-feature-body">
                    <h4>Re-evaluación automática</h4>
                    <p>
                        Cuando guardás un ensayo, el sistema vuelve a evaluar el material contra la norma
                        de forma automática. Si el resultado cambia el cumplimiento (apto → no apto, o
                        viceversa), las <strong>dosificaciones que usan ese material reciben alertas en
                        el mismo momento</strong> sin que vos tengas que hacer nada.
                    </p>
                    <small>Lo mismo pasa cuando ajustás el catálogo: si subís o bajás la obligatoriedad
                    de un ensayo, los materiales se re-evalúan al toque.</small>
                </div>
            </div>

            <div className="wizard-cat-ens-feature">
                <div className="wizard-cat-ens-feature-icon" style={{ background: '#6e79eb' }}>
                    <i className="fa-solid fa-clock-rotate-left" />
                </div>
                <div className="wizard-cat-ens-feature-body">
                    <h4>Configuraciones guardadas</h4>
                    <p>
                        Antes de hacer cambios masivos al catálogo, sacate una <strong>foto</strong>:
                        el botón <em>Configuraciones guardadas</em> del panel superior te deja guardar,
                        listar y restaurar configuraciones completas del catálogo. Si te arrepentís de
                        un cambio, volvés a la versión anterior en un click.
                    </p>
                    <small>Particularmente útil cuando vas a probar un esquema de obligatoriedades nuevo.</small>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>Cuidado al desactivar ensayos críticos:</strong>
                <p>
                    Si bajás un ensayo que estaba en <em>Básica</em> a <em>Ninguna</em>, los materiales
                    que tenían ese ensayo cargado <strong>pueden cambiar su estado de aptitud</strong> en
                    modo prestacional. Antes de hacerlo, revisá el modo prescriptivo (opción disponible
                    en las fichas técnicas) — ahí vas a ver lo que la norma sigue exigiendo aunque tu
                    catálogo no lo pida.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Alertas de calidad"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/calidad/alertas', 'Alertas calidad')}
            />
        </div>
    </div>
);

/* ─── 8. Listo ─────────────────────────────────────────────── */
const StepListo = ({ tiposAgregado, tiposAgua, tiposObligatorios, totalEnsayosRealizados, normas }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Tu catálogo de ensayos está configurado</h2>
            <p>
                Ya conocés cómo se exigen los ensayos en tu instalación. Cualquier ajuste que hagas
                desde acá impacta inmediatamente en evaluaciones, fichas técnicas y dosificaciones
                vinculadas.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-mountain" />
                <span>Tipos de ensayo de Agregados</span>
                <strong>{tiposAgregado.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-droplet" />
                <span>Tipos de ensayo de Agua</span>
                <strong>{tiposAgua.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-shield" />
                <span>Tipos obligatorios (en al menos un contexto)</span>
                <strong>{tiposObligatorios.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-book" />
                <span>Normas catalogadas</span>
                <strong>{normas.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-microscope" />
                <span>Ensayos realizados a la fecha</span>
                <strong>{totalEnsayosRealizados}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Si necesitás ajustar algo puntual, todo el catálogo es editable inline desde la tabla
                principal. Acordate de usar <strong>Configuraciones guardadas</strong> antes de cambios masivos.
            </span>
        </div>
    </div>
);

export default WizardCatalogoEnsayos;
