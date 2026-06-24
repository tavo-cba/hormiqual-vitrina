import React, { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Button } from "primereact/button";
import { Tooltip } from "primereact/tooltip";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useTabContext } from "../../../context/TabContext";
import "../../admin/mantenimiento/WizardMantenimiento.css";
import "../../flota/mantenimiento/WizardChecklist.css";
import "./WizardDosificacion.css";

/* ============================================================
   Wizard de configuración asistida · Diseño de dosificación
   ============================================================
   La pantalla de dosificación es el motor de cálculo más
   completo del sistema. Toma los materiales, las mezclas, una
   tipología de hormigón y devuelve una receta dosificada con
   verificaciones automáticas. Acompaña al usuario a entender
   los pasos, las verificaciones, los modos y la trazabilidad.

   10 pasos. */

const STEPS = [
    { id: 'bienvenida',    label: 'Bienvenida',          icon: 'fa-solid fa-house' },
    { id: 'prerreq',       label: 'Prerrequisitos',      icon: 'fa-solid fa-circle-check' },
    { id: 'tipologias',    label: 'Tipologías',          icon: 'fa-solid fa-shapes' },
    { id: 'parametros',    label: 'Parámetros del motor', icon: 'fa-solid fa-sliders' },
    { id: 'calculo',       label: 'Cálculo / Sugerencia', icon: 'fa-solid fa-calculator' },
    { id: 'modo-dual',     label: 'Modo dual',           icon: 'fa-solid fa-scale-balanced' },
    { id: 'verificaciones', label: 'Verificaciones',      icon: 'fa-solid fa-shield-halved' },
    { id: 'aprobacion',    label: 'Aprobación y versión', icon: 'fa-solid fa-stamp' },
    { id: 'pastones',      label: 'Pastones de prueba',  icon: 'fa-solid fa-vial' },
    { id: 'listo',         label: 'Listo',               icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'dos_wizard_step';
const PAUSED_KEY = 'dos_wizard_paused';

const WizardDosificacion = ({ visible, onClose, onFinish }) => {
    const showToast = useToast();
    const tabCtx = useTabContext();
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

    const [tipologias, setTipologias] = useState([]);
    const [mezclas, setMezclas] = useState([]);
    const [plantas, setPlantas] = useState([]);
    const [dosificaciones, setDosificaciones] = useState([]);
    const [agregadosCount, setAgregadosCount] = useState(0);
    const [cementosCount, setCementosCount] = useState(0);
    const [loading, setLoading] = useState(false);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const [tipoRes, mezclaRes, plantaRes, dosRes, agRes, cemRes] = await Promise.all([
                axios.get(`${config.backendUrl}/api/tipologias-hormigon`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/mezclas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/plantas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/dosificaciones`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/agregados`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/cementos`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
            ]);
            const tip = Array.isArray(tipoRes.data) ? tipoRes.data : (tipoRes.data?.data || []);
            const mz = Array.isArray(mezclaRes.data) ? mezclaRes.data : (mezclaRes.data?.data || []);
            const pl = Array.isArray(plantaRes.data) ? plantaRes.data : (plantaRes.data?.data || []);
            const ds = Array.isArray(dosRes.data) ? dosRes.data : (dosRes.data?.data || []);
            const ag = Array.isArray(agRes.data) ? agRes.data : (agRes.data?.data || []);
            const ce = Array.isArray(cemRes.data) ? cemRes.data : (cemRes.data?.data || []);

            setTipologias(tip);
            setMezclas(mz);
            setPlantas(pl);
            setDosificaciones(ds);
            setAgregadosCount(ag.length);
            setCementosCount(ce.length);

            const done = new Set();
            done.add('bienvenida');
            done.add('calculo');         // informativo
            done.add('modo-dual');       // informativo
            done.add('verificaciones');  // informativo
            done.add('aprobacion');      // informativo
            done.add('pastones');        // informativo
            // Prerreq: necesitamos cementos, agregados, mezclas, plantas, tipologías
            const tienePrerreq = ag.length > 0 && ce.length > 0 && mz.length > 0 && pl.length > 0;
            if (tienePrerreq) done.add('prerreq');
            if (tip.length > 0) done.add('tipologias');
            // parametros: marcamos done si hay tipologías (no podemos verificar parámetros directos)
            if (tip.length > 0) done.add('parametros');
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
        <div className="wizard-mant wizard-mant-dos">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-dos-sidebar-icon">
                        <i className="fa-solid fa-calculator" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Dosificación</h3>
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
                            className="wizard-mant-progress-fill wizard-dos-progress-fill"
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
                        tipologias={tipologias}
                        mezclas={mezclas}
                        plantas={plantas}
                        dosificaciones={dosificaciones}
                        agregadosCount={agregadosCount}
                        cementosCount={cementosCount}
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
    if (stepId === 'bienvenida')      return <StepBienvenida />;
    if (stepId === 'prerreq')         return <StepPrerreq {...props} />;
    if (stepId === 'tipologias')      return <StepTipologias {...props} />;
    if (stepId === 'parametros')      return <StepParametros {...props} />;
    if (stepId === 'calculo')         return <StepCalculo />;
    if (stepId === 'modo-dual')       return <StepModoDual />;
    if (stepId === 'verificaciones')  return <StepVerificaciones {...props} />;
    if (stepId === 'aprobacion')      return <StepAprobacion />;
    if (stepId === 'pastones')        return <StepPastones />;
    if (stepId === 'listo')           return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-dos-hero-icon">
                <i className="fa-solid fa-calculator" />
            </div>
            <h2>Bienvenido al Diseño de dosificación</h2>
            <p>
                La pantalla de dosificación es el <strong>motor de cálculo más completo del sistema</strong>.
                Toma los materiales del catálogo, una mezcla de agregados, una tipología de hormigón
                y los parámetros del motor, y devuelve una receta dosificada con verificaciones
                automáticas de cumplimiento normativo. Es la herramienta que conecta todo lo demás.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-dos-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-shapes" style={{ color: 'var(--green-500)' }} />
                <strong>Tipologías</strong>
                <small>Convencional, HRDC y otras: cada una con su lógica de cálculo.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-sliders" style={{ color: 'var(--cyan-500)' }} />
                <strong>Parámetros del motor</strong>
                <small>Calibración por planta para que el cálculo se ajuste a tu realidad.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-shield-halved" style={{ color: 'var(--green-600)' }} />
                <strong>Verificaciones automáticas</strong>
                <small>Aptitud de materiales, trabajabilidad, retención de asentamiento.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-wand-magic-sparkles" style={{ color: 'var(--purple-500)' }} />
                <strong>Sugerencia automática</strong>
                <small>El sistema te propone combinaciones desde el inventario disponible.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-stamp" style={{ color: 'var(--red-500)' }} />
                <strong>Aprobación y versionado</strong>
                <small>Cambios mayores generan nueva versión. Aprobaciones quedan registradas.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-vial" style={{ color: 'var(--orange-500)' }} />
                <strong>Pastones de prueba</strong>
                <small>Carga de resultados reales para ajustar la dosificación.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Este asistente te explica los conceptos y el flujo. La pantalla de dosificación es
                muy completa, pero entendiéndola por capas se vuelve manejable.
            </span>
        </div>
    </div>
);

/* ─── 1. Prerrequisitos ───────────────────────────────────── */
const StepPrerreq = ({ agregadosCount, cementosCount, mezclas, plantas, tipologias, loading, reload, openInTab }) => {
    const checks = [
        { ok: agregadosCount > 0, label: `Agregados (${agregadosCount} cargados)`, route: '/calidad/catalogos/materiales?tipo=agregados', tab: 'Materiales' },
        { ok: cementosCount > 0, label: `Cementos (${cementosCount} cargados)`, route: '/calidad/catalogos/materiales?tipo=cementos', tab: 'Materiales' },
        { ok: mezclas.length > 0, label: `Mezclas de agregados (${mezclas.length} guardadas)`, route: '/calidad/catalogos/mezclas', tab: 'Mezclas' },
        { ok: plantas.length > 0, label: `Plantas (${plantas.length} cargadas)`, route: '/admin/plantas', tab: 'Plantas' },
        { ok: tipologias.length > 0, label: `Tipologías de hormigón (${tipologias.length} configuradas)`, route: '/calidad/catalogos/tipologias', tab: 'Tipologías' },
    ];
    const todoOk = checks.every((c) => c.ok);

    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-circle-check" /> Prerrequisitos</h2>
            <p>
                Antes de calcular una dosificación necesitás tener varios catálogos cargados.
                La dosificación es el último eslabón de la cadena: depende de materiales, mezclas,
                plantas y tipologías. Si te falta algo, el cálculo te lo va a avisar con un mensaje
                claro, pero conviene tenerlo todo listo desde el principio para no interrumpir el
                trabajo a la mitad.
            </p>

            <div className="wizard-mant-status">
                {loading ? (
                    <span className="wizard-mant-status-loading"><i className="fa-solid fa-spinner fa-spin" /> Verificando…</span>
                ) : todoOk ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Todos los prerrequisitos están cubiertos
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Te faltan {checks.filter((c) => !c.ok).length} de {checks.length} prerrequisitos
                    </span>
                )}
            </div>

            <ul className="wizard-dos-prereq-list">
                {checks.map((c, i) => (
                    <li key={i} className={c.ok ? 'ok' : 'pending'}>
                        <i className={c.ok ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation'} />
                        <span>{c.label}</span>
                        {!c.ok && (
                            <Button
                                label="Abrir"
                                icon="fa-solid fa-arrow-up-right-from-square"
                                size="small"
                                text
                                onClick={() => openInTab(c.route, c.tab)}
                            />
                        )}
                    </li>
                ))}
            </ul>

            <div className="wizard-mant-actions">
                <Button
                    label="Verificar de nuevo"
                    icon="fa-solid fa-rotate"
                    onClick={reload}
                    loading={loading}
                    severity={todoOk ? 'success' : undefined}
                />
            </div>
        </div>
    );
};

/* ─── 2. Tipologías ───────────────────────────────────────── */
const StepTipologias = ({ tipologias, openInTab }) => {
    const tiene = tipologias.length > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-shapes" /> Tipologías de hormigón</h2>
            <p>
                Una tipología es un <strong>tipo de hormigón con reglas de cálculo propias</strong>.
                No es lo mismo dosificar un hormigón convencional H20 que un hormigón de alta
                resistencia o un hormigón rodillado de calzada (HRDC) — cambian las fórmulas, los
                valores típicos, las restricciones. HormiQual viene con las tipologías más comunes
                precargadas, y podés agregar más si tu obra lo requiere.
            </p>

            <div className="wizard-mant-status">
                {tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{tipologias.length}</strong> tipología{tipologias.length !== 1 ? 's' : ''} configurada{tipologias.length !== 1 ? 's' : ''}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        No hay tipologías configuradas
                    </span>
                )}
            </div>

            {tiene && (
                <ul className="wizard-mant-list">
                    {tipologias.slice(0, 6).map((t) => (
                        <li key={t.idTipologiaHormigon || t.codigo}>
                            <i className="fa-solid fa-shapes" />
                            <strong>{t.nombre || t.codigo}</strong>
                            <small>{t.descripcion || ''}</small>
                        </li>
                    ))}
                    {tipologias.length > 6 && <li className="wizard-mant-list-more">+ {tipologias.length - 6} más…</li>}
                </ul>
            )}

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-circle-info" />
                <div>
                    <strong>Cuándo cambiás de tipología:</strong>
                    <p>
                        Cuando elegís la tipología en la pantalla de cálculo, aparecen o desaparecen
                        campos según corresponda. Por ejemplo, HRDC pide cantidad de cemento por m³
                        y densidad objetivo, mientras que el convencional pide resistencia objetivo
                        y asentamiento. La tipología te guía hacia los datos relevantes.
                    </p>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Tipologías"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/calidad/catalogos/tipologias', 'Tipologías')}
                />
            </div>
        </div>
    );
};

/* ─── 3. Parámetros del motor ─────────────────────────────── */
const StepParametros = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-sliders" /> Parámetros del motor</h2>
        <p>
            El motor de dosificación viene con valores por defecto razonables, pero la realidad
            de cada planta es distinta. Los <strong>parámetros del motor</strong> te dejan
            calibrar el cálculo: límites de relación agua/cemento, márgenes de seguridad para la
            resistencia objetivo, factores de corrección por TMN, y otros valores técnicos. La
            calibración se hace por planta — cada planta tiene su propio juego de parámetros.
        </p>

        <div className="wizard-dos-param-grid">
            <div className="wizard-dos-param-card">
                <i className="fa-solid fa-water" />
                <strong>Relación agua/cemento</strong>
                <small>Mínimos y máximos típicos según durabilidad y resistencia. Sirven como
                guardrails — el cálculo te avisa si la mezcla intenta salirse del rango.</small>
            </div>
            <div className="wizard-dos-param-card">
                <i className="fa-solid fa-shield-halved" />
                <strong>Margen de resistencia</strong>
                <small>Cuánto por encima de la resistencia objetivo apunta el cálculo, para
                cubrir variabilidad de obra. Se ajusta según calidad histórica de tu planta.</small>
            </div>
            <div className="wizard-dos-param-card">
                <i className="fa-solid fa-magnifying-glass" />
                <strong>Factores por TMN</strong>
                <small>Correcciones según el tamaño máximo nominal del agregado grueso. Cambian
                la cantidad de agua, aire incorporado y módulo de fineza ideal.</small>
            </div>
            <div className="wizard-dos-param-card">
                <i className="fa-solid fa-flask" />
                <strong>Curvas de calibración</strong>
                <small>Curvas resistencia-edad y resistencia-relación a/c específicas de cada
                planta. Se cargan desde la ficha del cemento (datos por planta).</small>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>Editá con cuidado:</strong>
                <p>
                    Los parámetros del motor afectan a todos los cálculos de la planta. Conviene
                    cambiarlos sólo cuando tengás evidencia clara: muestreos de hormigón producido
                    versus el calculado, calibraciones de laboratorio, o ajustes pedidos por el
                    responsable técnico. Antes de un cambio masivo, sacá una nota del valor anterior.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Parámetros del motor"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/calidad/catalogos/parametros-motor', 'Parámetros motor')}
            />
            <Button
                label="Abrir Curvas de cemento"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/calidad/catalogos/curvas-cemento', 'Curvas cemento')}
            />
        </div>
    </div>
);

/* ─── 4. Cálculo directo / Sugerencia automática ──────────── */
const StepCalculo = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-calculator" /> Dos formas de llegar a una dosificación</h2>
        <p>
            La pantalla te ofrece dos caminos para obtener una dosificación. El <strong>cálculo
            directo</strong> es para cuando ya sabés qué materiales querés usar. La <strong>sugerencia
            automática</strong> es para cuando querés que el sistema te proponga combinaciones desde
            el inventario disponible. Los dos caminos terminan en una receta verificada.
        </p>

        <div className="wizard-dos-compare">
            <div className="wizard-dos-compare-col directo">
                <div className="wizard-dos-compare-head">
                    <div className="wizard-dos-compare-icon" style={{ background: 'var(--green-500)' }}>
                        <i className="fa-solid fa-pen-to-square" />
                    </div>
                    <div>
                        <h4>Cálculo directo</h4>
                        <small>Vos elegís cada material</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Seleccionás cemento, mezcla de agregados, aditivos uno por uno</span></li>
                    <li><i className="fa-solid fa-check" /><span>Indicás resistencia objetivo, asentamiento, condiciones de exposición</span></li>
                    <li><i className="fa-solid fa-check" /><span>El sistema calcula la receta con esos materiales puntuales</span></li>
                    <li><i className="fa-solid fa-check" /><span>Útil cuando ya tenés definido qué materiales querés usar</span></li>
                </ul>
                <div className="wizard-dos-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>Diseño puntual de un hormigón específico para una obra que ya tiene
                    proveedores definidos.</p>
                </div>
            </div>

            <div className="wizard-dos-compare-col sugerencia">
                <div className="wizard-dos-compare-head">
                    <div className="wizard-dos-compare-icon" style={{ background: 'var(--purple-500)' }}>
                        <i className="fa-solid fa-wand-magic-sparkles" />
                    </div>
                    <div>
                        <h4>Sugerencia automática</h4>
                        <small>El sistema propone combinaciones</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Indicás resistencia objetivo y restricciones (planta, tipología)</span></li>
                    <li><i className="fa-solid fa-check" /><span>El sistema busca <strong>combinaciones factibles</strong> desde tu inventario</span></li>
                    <li><i className="fa-solid fa-check" /><span>Las opciones se rankean por aptitud, costo y disponibilidad</span></li>
                    <li><i className="fa-solid fa-check" /><span>Elegís una de las propuestas y la sistema la convierte en cálculo directo</span></li>
                </ul>
                <div className="wizard-dos-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>Exploración inicial, optimización de costos, o cuando tenés varios cementos
                    disponibles y no sabés cuál conviene para un H30.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                La sugerencia automática usa internamente el <strong>modo prescriptivo</strong>
                — exige todo lo que la norma pide, no solo lo que tu catálogo configuró como
                obligatorio. Eso hace que las sugerencias sean más conservadoras y seguras de
                cara a auditorías. El siguiente paso te explica el modo dual.
            </span>
        </div>
    </div>
);

/* ─── 5. Modo dual prescriptivo / prestacional ─────────────── */
const StepModoDual = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-scale-balanced" /> Modo dual: prescriptivo vs prestacional</h2>
        <p>
            HormiQual evalúa cada dosificación bajo <strong>dos modos paralelos</strong>. La diferencia
            está en quién manda al definir qué se considera "cumplimiento": tu catálogo o la norma
            directamente. Lo importante es saber cuándo usás cada uno y qué firmás en cada caso.
        </p>

        <div className="wizard-dos-compare">
            <div className="wizard-dos-compare-col directo">
                <div className="wizard-dos-compare-head">
                    <div className="wizard-dos-compare-icon" style={{ background: 'var(--green-500)' }}>
                        <i className="fa-solid fa-building-shield" />
                    </div>
                    <div>
                        <h4>Prestacional</h4>
                        <small>Tu catálogo es soberano</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Solo se exigen los ensayos que <strong>marcaste como obligatorios</strong> en tu catálogo</span></li>
                    <li><i className="fa-solid fa-check" /><span>Es el modo default para informes públicos firmados</span></li>
                    <li><i className="fa-solid fa-check" /><span>Lo que firmás como cumplimiento queda atado a esta configuración</span></li>
                </ul>
                <div className="wizard-dos-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Default. Documentos firmados, informes a clientes, certificados.</p>
                </div>
            </div>

            <div className="wizard-dos-compare-col sugerencia">
                <div className="wizard-dos-compare-head">
                    <div className="wizard-dos-compare-icon" style={{ background: 'var(--red-500)' }}>
                        <i className="fa-solid fa-book-bookmark" />
                    </div>
                    <div>
                        <h4>Prescriptivo</h4>
                        <small>La norma es soberana</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Se exigen <strong>todos los ensayos que pide CIRSOC/IRAM</strong> aunque no estén en tu catálogo</span></li>
                    <li><i className="fa-solid fa-check" /><span>Lo usan internamente la sugerencia automática y las alertas</span></li>
                    <li><i className="fa-solid fa-check" /><span>Disponible como opción en informes para auditorías externas</span></li>
                </ul>
                <div className="wizard-dos-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Auditorías externas, motor de sugerencia, alertas reactivas. Opción manual en PDFs.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Por qué importa al diseñar:</strong>
                <p>
                    Si una dosificación cumple en modo prestacional pero no en prescriptivo, el
                    sistema te lo va a marcar. Eso te avisa que tu configuración del catálogo
                    "silencia" una exigencia normativa real. La decisión es tuya, pero el sistema
                    te muestra ambas miradas para que sepas qué estás firmando.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 6. Verificaciones automáticas ───────────────────────── */
const StepVerificaciones = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-shield-halved" /> Verificaciones automáticas</h2>
        <p>
            Cuando se calcula una dosificación, el sistema corre varios chequeos automáticos en
            paralelo. Cada uno mira un aspecto distinto de la receta: aptitud de los materiales,
            trabajabilidad esperada, retención de asentamiento, selección de aditivos, durabilidad.
            En la pantalla aparecen como secciones separadas con su propio veredicto.
        </p>

        <div className="wizard-dos-veri-grid">
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-cubes" /></div>
                <div>
                    <strong>Aptitud de materiales</strong>
                    <p>Verifica que cada material (agregado, cemento, aditivo) cumpla los ensayos
                    exigidos para el contexto de uso. Veredicto por material y consolidado.</p>
                </div>
            </div>
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-droplet" /></div>
                <div>
                    <strong>Trabajabilidad</strong>
                    <p>Calcula propiedades en estado fresco (asentamiento, factor de aptitud,
                    cohesión) y compara con el rango esperado para la tipología.</p>
                </div>
            </div>
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-clock" /></div>
                <div>
                    <strong>Retención de asentamiento</strong>
                    <p>Estima la pérdida de asentamiento en obra y planta según tiempo, temperatura
                    y dosificación de aditivo. Avisa si va a haber problemas de transporte.</p>
                </div>
            </div>
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-flask" /></div>
                <div>
                    <strong>Selección de aditivos</strong>
                    <p>Si pediste un efecto (ahorro de agua, retardante, etc.), el sistema rankea
                    los aditivos disponibles y elige el más apropiado según tus catálogos.</p>
                </div>
            </div>
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-cloud-rain" /></div>
                <div>
                    <strong>Durabilidad y exposición</strong>
                    <p>Verifica relación agua/cemento, contenido de cemento mínimo, aire incorporado
                    y otros parámetros según la condición de exposición elegida.</p>
                </div>
            </div>
            <div className="wizard-dos-veri">
                <div className="wizard-dos-veri-icon"><i className="fa-solid fa-magnifying-glass" /></div>
                <div>
                    <strong>Consistencia y método</strong>
                    <p>Confirma que el método de medición (asentamiento, remoldeo VeBe, extendido)
                    sea consistente con la clase de consistencia configurada.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Veredictos posibles:</strong>
                <p>
                    Cada verificación devuelve uno de cinco estados: <em>Apto</em>, <em>Apto con
                    observaciones</em>, <em>Aptitud condicionada</em>, <em>No apto</em>, o
                    <em> Evaluación incompleta</em> (cuando faltan datos para evaluar). El veredicto
                    consolidado de la dosificación toma el peor caso, así te aseguras que ninguna
                    verificación queda tapada por las demás.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 7. Aprobación, versionado y trazabilidad ─────────────── */
const StepAprobacion = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-stamp" /> Aprobación, versionado y trazabilidad</h2>
        <p>
            Una dosificación no es un documento estático — es una entidad con ciclo de vida.
            Después del cálculo entra en un proceso de <strong>aprobación</strong>, después se
            puede <strong>versionar</strong> si hay cambios mayores, y todo el historial queda
            registrado para trazabilidad de auditoría.
        </p>

        <div className="wizard-dos-flow">
            <div className="wizard-dos-flow-step">
                <span className="wizard-dos-flow-num">1</span>
                <div>
                    <strong>Borrador</strong>
                    <p>Recién calculada, no firmada. Editable libremente. Útil para iterar y probar
                    cosas.</p>
                </div>
            </div>
            <div className="wizard-dos-flow-arrow"><i className="fa-solid fa-arrow-right" /></div>
            <div className="wizard-dos-flow-step">
                <span className="wizard-dos-flow-num">2</span>
                <div>
                    <strong>Pendiente de aprobación</strong>
                    <p>El responsable técnico la revisa. Mientras tanto se bloquea para edición.</p>
                </div>
            </div>
            <div className="wizard-dos-flow-arrow"><i className="fa-solid fa-arrow-right" /></div>
            <div className="wizard-dos-flow-step">
                <span className="wizard-dos-flow-num">3</span>
                <div>
                    <strong>Aprobada</strong>
                    <p>Firmada por el responsable. Lista para usarse en producción. Cualquier cambio
                    posterior obliga a generar una nueva versión.</p>
                </div>
            </div>
        </div>

        <div className="wizard-dos-feature-grid">
            <div className="wizard-dos-feature">
                <i className="fa-solid fa-code-branch" />
                <div>
                    <strong>Versionado automático</strong>
                    <p>Cuando una dosificación aprobada necesita un cambio mayor, se crea una nueva
                    versión vinculada a la anterior. Las dos quedan en el historial — la anterior
                    como referencia.</p>
                </div>
            </div>
            <div className="wizard-dos-feature">
                <i className="fa-solid fa-clock-rotate-left" />
                <div>
                    <strong>Línea de tiempo</strong>
                    <p>Cada cambio queda registrado con autor, fecha y motivo. Útil para entender
                    cómo evolucionó una dosificación a lo largo del tiempo.</p>
                </div>
            </div>
            <div className="wizard-dos-feature">
                <i className="fa-solid fa-bell" />
                <div>
                    <strong>Alertas reactivas</strong>
                    <p>Si un material vinculado cambia de estado de aptitud (por un nuevo ensayo no
                    apto), la dosificación recibe una alerta. Podés evaluarla y, si corresponde,
                    abrir una nueva versión.</p>
                </div>
            </div>
            <div className="wizard-dos-feature">
                <i className="fa-solid fa-file-pdf" />
                <div>
                    <strong>Informe firmado en PDF</strong>
                    <p>Generás un PDF profesional con la receta, las verificaciones, el sello de
                    aprobación y los anexos elegidos. Apto para clientes y auditores.</p>
                </div>
            </div>
        </div>
    </div>
);

/* ─── 8. Pastones de prueba ────────────────────────────────── */
const StepPastones = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-vial" /> Pastones de prueba y ajuste</h2>
        <p>
            Una dosificación calculada es una <strong>predicción</strong>. Para validarla se hacen
            pastones de prueba: pastones reales que se elaboran y miden. Los resultados de esos
            pastones se cargan en la dosificación, y el sistema los usa para calibrar el motor y
            mejorar las predicciones futuras.
        </p>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-list-ol" />
            Flujo típico
        </h3>
        <ol className="wizard-dos-steps-list">
            <li>
                <strong>Diseño y aprobación</strong> — calculás la dosificación en la pantalla y
                la dejás aprobada.
            </li>
            <li>
                <strong>Pastón de prueba en planta</strong> — preparás un pastón real con la receta
                y medís: asentamiento, densidad fresca, temperatura, aire incorporado, contenido
                de cemento medido (si tenés calibración).
            </li>
            <li>
                <strong>Probetas y ensayos a edad</strong> — moldeás probetas y las ensayás a las
                edades indicadas (típicamente 7 y 28 días).
            </li>
            <li>
                <strong>Carga del pastón en el sistema</strong> — desde la sección de pastones de la
                dosificación, cargás los resultados reales (frescos y endurecidos).
            </li>
            <li>
                <strong>Comparación y ajuste</strong> — el sistema compara lo predicho con lo medido
                y propone correcciones. Si las diferencias son significativas, generás una nueva
                versión con los datos ajustados.
            </li>
        </ol>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>El pastón también alimenta el catálogo:</strong>
                <p>
                    Los datos reales medidos en pastones se usan para refinar las curvas de
                    resistencia del cemento por planta y los factores de calibración del motor.
                    Cuanto más pastones cargues, más fina queda la calibración.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 9. Listo ─────────────────────────────────────────────── */
const StepListo = ({ tipologias, mezclas, plantas, dosificaciones }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, var(--green-500), var(--green-700))' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Ya conocés cómo trabajar con dosificaciones</h2>
            <p>
                Tenés el panorama completo: prerrequisitos, tipologías, parámetros del motor,
                las dos formas de calcular, el modo dual, las verificaciones automáticas, el
                ciclo de aprobación y los pastones de prueba. Es la pantalla más densa del
                sistema, pero ahora cada zona tiene sentido en el conjunto.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-shapes" />
                <span>Tipologías configuradas</span>
                <strong>{tipologias.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-blender" />
                <span>Mezclas guardadas</span>
                <strong>{mezclas.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-industry" />
                <span>Plantas</span>
                <strong>{plantas.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-calculator" />
                <span>Dosificaciones existentes</span>
                <strong>{dosificaciones.length}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Cuando dudes en algo puntual, recordá que la pantalla tiene tooltips en casi cada
                control. El asistente <em>Configurar</em> está siempre arriba a la derecha si necesitás
                volver a un concepto del wizard.
            </span>
        </div>
    </div>
);

export default WizardDosificacion;
