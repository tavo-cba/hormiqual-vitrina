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
import "./WizardMezclasAgregados.css";

/* ============================================================
   Wizard de configuración asistida · Mezclas de agregados
   ============================================================
   La pantalla "Mezclas de agregados" es una herramienta de cálculo
   interactiva. Combina 2 o 3 agregados en distintas proporciones
   y muestra la curva combinada resultante, comparándola contra
   bandas normativas y curvas teóricas (Fuller, MAA, Andreasen).
   El wizard explica los conceptos principales y cómo se trabaja
   con la herramienta.

   8 pasos. */

const STEPS = [
    { id: 'bienvenida',   label: 'Bienvenida',         icon: 'fa-solid fa-house' },
    { id: 'prerreq',      label: 'Agregados con curva', icon: 'fa-solid fa-circle-check' },
    { id: 'anatomia',     label: 'La pantalla',         icon: 'fa-solid fa-table-list' },
    { id: 'modo',         label: 'Manual vs Auto',      icon: 'fa-solid fa-arrows-split-up-and-left' },
    { id: 'objetivo',     label: 'Tipo de objetivo',    icon: 'fa-solid fa-bullseye' },
    { id: 'teorica',      label: 'Curvas teóricas',     icon: 'fa-solid fa-chart-line' },
    { id: 'catalogo',     label: 'Catálogo guardado',   icon: 'fa-solid fa-bookmark' },
    { id: 'listo',        label: 'Listo',               icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'mezcla_wizard_step';
const PAUSED_KEY = 'mezcla_wizard_paused';

const WizardMezclasAgregados = ({ visible, onClose, onFinish }) => {
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

    const [agregados, setAgregados] = useState([]);
    // curvasCatalogo = curvas teóricas + bandas normativas (Fuller, MAA, IRAM, etc.)
    // del menú "Catálogos → Curvas granulométricas". NO son las granulometrías
    // reales de cada agregado (esas se cargan como ensayos en la ficha del agregado).
    const [curvasCatalogo, setCurvasCatalogo] = useState([]);
    const [mezclasGuardadas, setMezclasGuardadas] = useState([]);
    const [loading, setLoading] = useState(false);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const [aRes, cRes, mRes] = await Promise.all([
                axios.get(`${config.backendUrl}/api/agregados`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/curvas-granulometricas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/mezclas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
            ]);
            const ag = Array.isArray(aRes.data) ? aRes.data : (aRes.data?.data || []);
            const cu = Array.isArray(cRes.data) ? cRes.data : (cRes.data?.data || []);
            const mz = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.data || []);
            setAgregados(ag);
            setCurvasCatalogo(cu);
            setMezclasGuardadas(mz);

            const done = new Set();
            done.add('bienvenida');
            done.add('anatomia');   // informativo
            done.add('modo');       // informativo
            done.add('objetivo');   // informativo
            done.add('teorica');    // informativo
            // prerreq mínimo verificable desde acá: ≥2 agregados.
            // Que cada agregado tenga granulometría cargada se verifica desde la ficha
            // de cada material (no hay endpoint trivial que lo cuente desde acá).
            if (ag.length >= 2) done.add('prerreq');
            if (mz.length > 0) done.add('catalogo');
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
        <div className="wizard-mant wizard-mant-mezcla">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-mezcla-sidebar-icon">
                        <i className="fa-solid fa-blender" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Mezclas de agregados</h3>
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
                            className="wizard-mant-progress-fill wizard-mezcla-progress-fill"
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
                        agregados={agregados}
                        curvasCatalogo={curvasCatalogo}
                        mezclasGuardadas={mezclasGuardadas}
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
    if (stepId === 'bienvenida') return <StepBienvenida />;
    if (stepId === 'prerreq')    return <StepPrerreq {...props} />;
    if (stepId === 'anatomia')   return <StepAnatomia />;
    if (stepId === 'modo')       return <StepModo />;
    if (stepId === 'objetivo')   return <StepObjetivo />;
    if (stepId === 'teorica')    return <StepTeorica />;
    if (stepId === 'catalogo')   return <StepCatalogo {...props} />;
    if (stepId === 'listo')      return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-mezcla-hero-icon">
                <i className="fa-solid fa-blender" />
            </div>
            <h2>Bienvenido a Mezclas de agregados</h2>
            <p>
                Una mezcla de agregados es la <strong>combinación ponderada</strong> de dos o tres
                agregados en distintos porcentajes para obtener una curva granulométrica conjunta.
                La pantalla de mezclas es una <strong>calculadora interactiva</strong> que te permite
                probar combinaciones, ver la curva resultante en un gráfico y compararla contra
                una banda normativa o una curva teórica de referencia.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-mezcla-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-mountain" style={{ color: '#f59e0b' }} />
                <strong>2 o 3 agregados</strong>
                <small>Combinás finos y gruesos en proporciones que sumen 100%.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-arrows-split-up-and-left" style={{ color: '#6366f1' }} />
                <strong>Manual o Automática</strong>
                <small>Vos elegís las proporciones, o el sistema busca la mejor combinación.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-bullseye" style={{ color: '#0ea5e9' }} />
                <strong>3 tipos de objetivo</strong>
                <small>Banda normativa, curva teórica de referencia, o ambas combinadas.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-chart-line" style={{ color: '#16a34a' }} />
                <strong>Gráfico interactivo</strong>
                <small>La curva combinada se actualiza en vivo cuando movés los porcentajes.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-bookmark" style={{ color: '#8b5cf6' }} />
                <strong>Catálogo guardado</strong>
                <small>Las mezclas que te sirven se guardan para reutilizar en dosificaciones.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-file-pdf" style={{ color: '#ef4444' }} />
                <strong>Informe en PDF</strong>
                <small>Exportás un PDF con la curva, la evaluación y los datos del agregado.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Esta pantalla no guarda nada por defecto — es una calculadora que te deja
                experimentar. Solo cuando le decís expresamente "guardar" la mezcla queda en
                el catálogo persistente.
            </span>
        </div>
    </div>
);

/* ─── 1. Prerrequisito: agregados con granulometría ───────── */
const StepPrerreq = ({ agregados, loading, reload, openInTab }) => {
    const tieneAgregados = agregados.length >= 2;

    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-circle-check" /> Prerrequisito: agregados con granulometría</h2>
            <p>
                Para combinar agregados necesitás <strong>al menos dos agregados cargados</strong> en
                el catálogo, y cada uno tiene que tener al menos una <strong>granulometría cargada</strong>
                como ensayo en su ficha. La granulometría es lo que el sistema usa para calcular la
                curva combinada de la mezcla — sin ella, no hay nada que combinar.
            </p>

            <div className="wizard-mant-status">
                {loading ? (
                    <span className="wizard-mant-status-loading"><i className="fa-solid fa-spinner fa-spin" /> Verificando…</span>
                ) : tieneAgregados ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{agregados.length}</strong> agregado{agregados.length !== 1 ? 's' : ''} cargado{agregados.length !== 1 ? 's' : ''}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Te faltan agregados — necesitás al menos 2 (tenés {agregados.length})
                    </span>
                )}
            </div>

            <div className="wizard-mezcla-prereq-cards">
                <div className={`wizard-mezcla-prereq-card ${tieneAgregados ? 'ok' : 'pending'}`}>
                    <i className={tieneAgregados ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-exclamation'} />
                    <div>
                        <strong>Al menos 2 agregados</strong>
                        <small>Tenés <strong>{agregados.length}</strong> cargado{agregados.length !== 1 ? 's' : ''}</small>
                    </div>
                </div>
                <div className="wizard-mezcla-prereq-card pending">
                    <i className="fa-solid fa-circle-info" />
                    <div>
                        <strong>Cada agregado con su granulometría</strong>
                        <small>Verificá esto desde la ficha de cada agregado (no se puede contar desde acá)</small>
                    </div>
                </div>
            </div>

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-circle-info" />
                <div>
                    <strong>Dónde se carga la granulometría del agregado:</strong>
                    <p>
                        Andá a la <em>ficha del agregado → pestaña Ensayos → "Nuevo ensayo" → tipo
                        "Granulometría"</em>. La granulometría es un ensayo más, igual que peso
                        específico o equivalente arena, pero con un formulario propio para cargar
                        el porcentaje pasante por cada tamiz. <strong>No la confundas con el menú
                        "Catálogos → Curvas granulométricas"</strong>, que es para curvas teóricas
                        y bandas normativas (Fuller, MAA, IRAM) que se usan como objetivo de
                        comparación.
                    </p>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Materiales (agregados)"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/calidad/catalogos/materiales?tipo=agregados', 'Materiales')}
                />
                <Button
                    label="Verificar de nuevo"
                    icon="fa-solid fa-rotate"
                    onClick={reload}
                    loading={loading}
                    severity={tieneAgregados ? 'success' : undefined}
                />
            </div>
        </div>
    );
};

/* ─── 2. Anatomía de la pantalla ──────────────────────────── */
const StepAnatomia = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-table-list" /> Anatomía de la pantalla</h2>
        <p>
            La pantalla de mezclas tiene cuatro zonas principales. Conviene reconocer cada una
            antes de empezar a trabajar para no perderse entre tantos controles. La idea es que
            arriba elegís el contexto general, en el medio configurás los agregados y abajo
            ves los resultados con la curva combinada.
        </p>

        <PantallaMezclasMockup />

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-list-ol" />
            Las cuatro zonas
        </h3>
        <ol className="wizard-mezcla-steps-list">
            <li>
                <strong>Encabezado de contexto</strong> — arriba elegís planta, tipo de mezcla
                (Finos, Gruesos o Total) y modo de cálculo (Manual o Automática).
            </li>
            <li>
                <strong>Selección y proporciones de agregados</strong> — agregás 2 o 3 agregados
                y, en modo Manual, asignás el porcentaje de cada uno. La suma debe dar 100%.
            </li>
            <li>
                <strong>Configuración del objetivo</strong> — elegís contra qué se compara la
                curva combinada: una banda normativa, una curva teórica, o ambas.
            </li>
            <li>
                <strong>Gráfico y evaluación</strong> — el sistema dibuja la curva combinada y
                muestra si cumple el objetivo, con detalles de cada tamiz.
            </li>
        </ol>
    </div>
);

const PantallaMezclasMockup = () => (
    <div className="wizard-cl-mockup">
        <div className="wizard-cl-mockup-window">
            <div className="wizard-cl-mockup-bar">
                <span className="wizard-cl-mockup-dot" style={{ background: '#ff5f56' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#ffbd2e' }} />
                <span className="wizard-cl-mockup-dot" style={{ background: '#27c93f' }} />
                <span className="wizard-cl-mockup-url">
                    <i className="fa-solid fa-lock" /> hormiqual.com/calidad/diseno
                </span>
            </div>

            <div className="wizard-cl-mockup-body">
                <div className="wizard-cl-mockup-header">
                    <div className="wizard-cl-mockup-page-icon" style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}>
                        <i className="fa-solid fa-blender" />
                    </div>
                    <div>
                        <div className="wizard-cl-mockup-title">Mezclas de agregados</div>
                        <div className="wizard-cl-mockup-subtitle">Calculadora de combinación granulométrica</div>
                    </div>
                </div>

                <div className="wizard-mezcla-mockup-zone z1">
                    <span className="wizard-mezcla-mockup-zone-num">1</span>
                    <span className="wizard-mezcla-mockup-zone-label">
                        Planta: <strong>Centenario</strong> · Tipo: <strong>Total</strong> · Modo: <strong>Manual</strong>
                    </span>
                </div>

                <div className="wizard-mezcla-mockup-zone z2">
                    <span className="wizard-mezcla-mockup-zone-num">2</span>
                    <div className="wizard-mezcla-mockup-agregados">
                        <div>
                            <span className="wizard-mezcla-mockup-ag">Arena natural</span>
                            <span className="wizard-mezcla-mockup-pct">42%</span>
                        </div>
                        <div>
                            <span className="wizard-mezcla-mockup-ag">Piedra 6-19 mm</span>
                            <span className="wizard-mezcla-mockup-pct">58%</span>
                        </div>
                    </div>
                </div>

                <div className="wizard-mezcla-mockup-zone z3">
                    <span className="wizard-mezcla-mockup-zone-num">3</span>
                    <span className="wizard-mezcla-mockup-zone-label">
                        Objetivo: <strong>Banda + Curva teórica</strong> (Fuller, n=0,50, TMN 19 mm)
                    </span>
                </div>

                <div className="wizard-mezcla-mockup-zone z4">
                    <span className="wizard-mezcla-mockup-zone-num">4</span>
                    <div className="wizard-mezcla-mockup-graph">
                        <svg viewBox="0 0 200 70" preserveAspectRatio="none">
                            <path d="M5,60 Q40,50 70,40 T130,20 T195,8" stroke="#6366f1" strokeWidth="2" fill="none" />
                            <path d="M5,55 Q40,45 70,35 T130,15 T195,4" stroke="#16a34a" strokeWidth="1.5" fill="none" strokeDasharray="3,2" />
                            <path d="M5,65 Q40,55 70,45 T130,25 T195,12" stroke="#ef4444" strokeWidth="1.5" fill="none" strokeDasharray="3,2" />
                        </svg>
                        <div className="wizard-mezcla-mockup-leyenda">
                            <span><span className="dot" style={{ background: '#6366f1' }} /> Mezcla</span>
                            <span><span className="dot" style={{ background: '#16a34a' }} /> Banda inf.</span>
                            <span><span className="dot" style={{ background: '#ef4444' }} /> Banda sup.</span>
                        </div>
                    </div>
                </div>

                <div className="wizard-mant-mockup-note">
                    <i className="fa-solid fa-arrow-up" />
                    <span>Cada número en el mockup se corresponde con la zona que se explica abajo. La
                    distribución real puede variar levemente según el ancho de pantalla.</span>
                </div>
            </div>
        </div>
    </div>
);

/* ─── 3. Modo Manual vs Automática ────────────────────────── */
const StepModo = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-arrows-split-up-and-left" /> Modo Manual vs Automática</h2>
        <p>
            La pantalla tiene dos modos de trabajo bien distintos. En modo <strong>Manual</strong>
            vos decidís las proporciones a mano, viendo en vivo cómo cambia la curva. En modo
            <strong> Automática</strong> el sistema busca la mejor combinación posible de
            proporciones que se ajuste al objetivo. Cada modo se usa en momentos distintos.
        </p>

        <div className="wizard-mezcla-compare">
            <div className="wizard-mezcla-compare-col manual">
                <div className="wizard-mezcla-compare-head">
                    <div className="wizard-mezcla-compare-icon" style={{ background: '#0ea5e9' }}>
                        <i className="fa-solid fa-hand" />
                    </div>
                    <div>
                        <h4>Manual</h4>
                        <small>Vos elegís las proporciones</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Asignás un porcentaje a cada agregado a mano</span></li>
                    <li><i className="fa-solid fa-check" /><span>El gráfico se actualiza en vivo cada vez que cambiás un valor</span></li>
                    <li><i className="fa-solid fa-check" /><span>Útil cuando ya sabés más o menos la proporción que querés probar</span></li>
                    <li><i className="fa-solid fa-check" /><span>Te deja explorar combinaciones específicas y ver cuánto se desvían del objetivo</span></li>
                </ul>
                <div className="wizard-mezcla-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>Cuando ya tenés una proporción de referencia (de obras anteriores o del proveedor) y
                    querés validarla o ajustarla manualmente.</p>
                </div>
            </div>

            <div className="wizard-mezcla-compare-col auto">
                <div className="wizard-mezcla-compare-head">
                    <div className="wizard-mezcla-compare-icon" style={{ background: '#6366f1' }}>
                        <i className="fa-solid fa-wand-magic-sparkles" />
                    </div>
                    <div>
                        <h4>Automática</h4>
                        <small>El sistema busca la mejor combinación</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>El sistema prueba muchas combinaciones y se queda con la mejor</span></li>
                    <li><i className="fa-solid fa-check" /><span>Los porcentajes que devuelve son los que mejor se ajustan al objetivo elegido</span></li>
                    <li><i className="fa-solid fa-check" /><span>Después de calcular, podés afinar manualmente desde ese punto de partida</span></li>
                    <li><i className="fa-solid fa-check" /><span>Más rápido cuando arrancás de cero y no tenés idea de la proporción</span></li>
                </ul>
                <div className="wizard-mezcla-compare-when">
                    <strong>Cuándo conviene…</strong>
                    <p>Cuando estás explorando una mezcla nueva y necesitás un punto de partida sin
                    sesgos, o cuando cambiaste la curva de un agregado y querés re-optimizar.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                <strong>Flujo típico:</strong> arrancás en Automática para tener un punto de partida,
                pasás a Manual para afinar la proporción según otros criterios (precio, disponibilidad
                en planta), y guardás la mezcla final en el catálogo.
            </span>
        </div>
    </div>
);

/* ─── 4. Tipo de objetivo ─────────────────────────────────── */
const StepObjetivo = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-bullseye" /> Tipo de objetivo</h2>
        <p>
            El objetivo es contra qué se compara la curva combinada de tu mezcla. Hay tres opciones,
            según qué tipo de control de calidad necesites en tu obra. Las tres se grafican junto a
            la curva de la mezcla, así ves a simple vista si el ajuste es bueno o no.
        </p>

        <div className="wizard-mezcla-objetivos">
            <div className="wizard-mezcla-objetivo">
                <div className="wizard-mezcla-objetivo-icon banda">
                    <i className="fa-solid fa-grip-lines" />
                </div>
                <div className="wizard-mezcla-objetivo-body">
                    <h4>Banda normativa</h4>
                    <p>
                        Compara la curva de tu mezcla contra una banda definida por norma
                        (un rango de valores aceptables por cada tamiz). Si la curva entra dentro
                        de la banda, la mezcla cumple. Útil cuando la norma del proyecto exige
                        cumplir un rango específico.
                    </p>
                </div>
            </div>
            <div className="wizard-mezcla-objetivo">
                <div className="wizard-mezcla-objetivo-icon teorica">
                    <i className="fa-solid fa-chart-line" />
                </div>
                <div className="wizard-mezcla-objetivo-body">
                    <h4>Curva teórica</h4>
                    <p>
                        Compara la curva contra una curva ideal calculada matemáticamente
                        (Fuller, MAA o Andreasen). El sistema te muestra el desvío promedio y
                        máximo respecto a la teórica. Útil para diseños donde buscás densidad
                        máxima de empaquetamiento.
                    </p>
                </div>
            </div>
            <div className="wizard-mezcla-objetivo">
                <div className="wizard-mezcla-objetivo-icon combo">
                    <i className="fa-solid fa-layer-group" />
                </div>
                <div className="wizard-mezcla-objetivo-body">
                    <h4>Banda + Curva (combinado)</h4>
                    <p>
                        Las dos cosas a la vez: la curva debe estar dentro de la banda y, además,
                        ajustarse a la curva teórica. Podés indicar una <strong>prioridad</strong>
                        (banda primero o curva primero) que el modo Automática usa para decidir
                        en caso de conflicto.
                    </p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Cómo se ve la evaluación:</strong>
                <p>
                    Para banda, el sistema te muestra qué tamices están dentro y cuáles fuera, con
                    cuánto se desvían. Para curva teórica, te muestra el desvío promedio (área
                    entre las dos curvas) y el desvío máximo en algún tamiz. Para combinado, las
                    dos métricas a la vez.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 5. Curvas teóricas ──────────────────────────────────── */
const StepTeorica = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-chart-line" /> Familias de curvas teóricas</h2>
        <p>
            Las curvas teóricas son fórmulas matemáticas que definen una distribución granulométrica
            ideal para distintos objetivos. HormiQual incluye tres familias clásicas que cubren la
            mayoría de los casos. Para cada una elegís el tamaño máximo nominal (TMN) y el parámetro
            de exponente, y el sistema dibuja la curva teórica resultante. Estas curvas, junto con
            las bandas normativas (IRAM, etc.), están en el menú <em>Catálogos → Curvas granulométricas</em>.
        </p>

        <div className="wizard-mezcla-teoricas">
            <div className="wizard-mezcla-teorica">
                <strong>Fuller / Talbot</strong>
                <small>p(d) = 100 · (d / TMN)<sup>n</sup></small>
                <p>
                    La más conocida y usada. Apunta a densidad máxima del esqueleto granular.
                    El exponente <strong>n</strong> (típicamente entre 0,3 y 0,8, default 0,5)
                    controla la pendiente. Adecuada para hormigones convencionales.
                </p>
            </div>
            <div className="wizard-mezcla-teorica">
                <strong>MAA (Funk &amp; Dinger)</strong>
                <small>Variante moderna de Fuller con tamaño mínimo de partícula</small>
                <p>
                    Considera un tamaño mínimo de partícula —no asume que el agregado va hasta
                    polvo infinito— y ajusta la curva para empaquetamiento más realista. El
                    parámetro <strong>q</strong> (típico 0,37) controla la pendiente.
                </p>
            </div>
            <div className="wizard-mezcla-teorica">
                <strong>Andreasen</strong>
                <small>Pensada para mezclas de alto desempeño</small>
                <p>
                    Distribución similar a MAA pero con otra base teórica de empaquetamiento.
                    Más usada en hormigones autocompactantes y de alta resistencia, donde la
                    distribución granular fina es crítica.
                </p>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>Si dudás cuál usar:</strong>
                <p>
                    Para un hormigón convencional H20-H30 con materiales habituales, <strong>Fuller
                    con n=0,5</strong> es un buen default. Para hormigones autocompactantes o de
                    alta resistencia, conviene Andreasen o MAA. Si tu obra tiene una norma o pliego
                    que indica una familia específica, seguila tal cual.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Curvas y bandas"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/calidad/catalogos/curvas', 'Curvas teóricas')}
            />
        </div>
    </div>
);

/* ─── 6. Catálogo guardado ────────────────────────────────── */
const StepCatalogo = ({ mezclasGuardadas, openInTab }) => {
    const tiene = mezclasGuardadas.length > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-bookmark" /> Catálogo de mezclas guardadas</h2>
            <p>
                Cuando una mezcla te termina convenciendo (cumple el objetivo, las proporciones son
                viables en planta, los costos cierran), la guardás en el catálogo. Las mezclas
                guardadas tienen un nombre y quedan disponibles para usar como entrada en las
                dosificaciones. Mientras no las guardes, lo que probás en la pantalla es solo
                exploración — no queda nada persistido.
            </p>

            <div className="wizard-mant-status">
                {tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Hay <strong>{mezclasGuardadas.length}</strong> mezcla{mezclasGuardadas.length !== 1 ? 's' : ''} guardada{mezclasGuardadas.length !== 1 ? 's' : ''}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Todavía no hay mezclas guardadas en el catálogo
                    </span>
                )}
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-circle-info" />
                Qué se guarda
            </h3>
            <p>
                Una mezcla guardada incluye: los agregados que la componen, las proporciones de
                cada uno, la planta de origen, el objetivo configurado (banda y/o curva teórica
                con parámetros) y la curva combinada calculada en el momento del guardado. Si
                cambia la curva de un agregado a futuro, la mezcla guardada conserva su versión
                histórica — para refrescarla, abrís la mezcla y la volvés a guardar.
            </p>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Catálogo de mezclas"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/calidad/catalogos/mezclas', 'Mezclas')}
                />
            </div>
        </div>
    );
};

/* ─── 7. Listo ─────────────────────────────────────────────── */
const StepListo = ({ agregados, curvasCatalogo, mezclasGuardadas }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Ya conocés cómo trabajar con mezclas</h2>
            <p>
                A partir de acá podés empezar a explorar combinaciones de agregados, evaluar
                contra bandas y curvas teóricas, y guardar las que te sirvan en el catálogo
                para usarlas después en dosificaciones.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-mountain" />
                <span>Agregados disponibles</span>
                <strong>{agregados.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-chart-line" />
                <span>Curvas teóricas y bandas catalogadas</span>
                <strong>{curvasCatalogo.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-bookmark" />
                <span>Mezclas guardadas en el catálogo</span>
                <strong>{mezclasGuardadas.length}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Cuando termines de explorar una mezcla y la guardes, podés ir directo al módulo de
                Dosificación a usarla. Allí también hay un asistente disponible que te guía por el
                cálculo completo.
            </span>
        </div>
    </div>
);

export default WizardMezclasAgregados;
