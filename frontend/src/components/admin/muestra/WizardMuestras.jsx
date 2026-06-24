import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Button } from "primereact/button";
import { Tooltip } from "primereact/tooltip";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useTabContext } from "../../../context/TabContext";
import "../mantenimiento/WizardMantenimiento.css";
import "../../flota/mantenimiento/WizardChecklist.css";
import "./WizardMuestras.css";

/* ============================================================
   Wizard de configuración asistida · Muestras de calidad
   ============================================================
   Acompaña al usuario por todo el ciclo de vida del control de
   calidad sobre el hormigón producido o recibido:

     pastón / despacho → muestra → probetas → curado en pileta
     → ensayo de rotura a edad → resultado → carta de control
     → reportes y certificados

   Incluye también el manejo del consumible más sensible del
   ensayo: las placas de elastómero de la prensa, que tienen
   ciclo de vida propio y afectan la validez del resultado.

   10 pasos. */

const STEPS = [
    { id: 'bienvenida',  label: 'Bienvenida',         icon: 'fa-solid fa-house' },
    { id: 'flujo',       label: 'El ciclo completo',  icon: 'fa-solid fa-route' },
    { id: 'origen',      label: 'Propio vs Tercero',  icon: 'fa-solid fa-arrows-split-up-and-left' },
    { id: 'alta',        label: 'Alta de muestra',    icon: 'fa-solid fa-vial' },
    { id: 'probetas',    label: 'Probetas y curado',  icon: 'fa-solid fa-flask' },
    { id: 'rotura',      label: 'Ensayo de rotura',   icon: 'fa-solid fa-hammer' },
    { id: 'placas',      label: 'Placas de elastómero', icon: 'fa-solid fa-circle-half-stroke' },
    { id: 'control',     label: 'Carta de control',   icon: 'fa-solid fa-chart-line' },
    { id: 'informes',    label: 'Informes y reportes', icon: 'fa-solid fa-file-pdf' },
    { id: 'listo',       label: 'Listo',              icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'muestras_wizard_step';
const PAUSED_KEY = 'muestras_wizard_paused';

const WizardMuestras = ({ visible, onClose, onFinish }) => {
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

    const [muestras, setMuestras] = useState([]);
    const [probetas, setProbetas] = useState([]);
    const [placas, setPlacas] = useState([]);
    const [loading, setLoading] = useState(false);

    const placasStats = useMemo(() => {
        const s = { total: placas.length, enStock: 0, enUso: 0, agotadas: 0, descartadas: 0 };
        placas.forEach((p) => {
            if (p.estado === 'EN_STOCK')   s.enStock += 1;
            else if (p.estado === 'EN_USO') s.enUso += 1;
            else if (p.estado === 'AGOTADO') s.agotadas += 1;
            else if (p.estado === 'DESCARTADO') s.descartadas += 1;
        });
        return s;
    }, [placas]);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const [mRes, pRes, plRes] = await Promise.all([
                axios.get(`${config.backendUrl}/api/muestras`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/probetas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
                axios.get(`${config.backendUrl}/api/placas-elastomero`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
            ]);
            const ms = Array.isArray(mRes.data) ? mRes.data : (mRes.data?.data || []);
            const ps = Array.isArray(pRes.data) ? pRes.data : (pRes.data?.data || []);
            const pls = Array.isArray(plRes.data) ? plRes.data : (plRes.data?.data || []);
            setMuestras(ms);
            setProbetas(ps);
            setPlacas(pls);

            const done = new Set();
            done.add('bienvenida');
            done.add('flujo');     // informativo
            done.add('origen');    // informativo
            done.add('rotura');    // informativo
            done.add('control');   // informativo
            done.add('informes');  // informativo
            if (ms.length > 0) done.add('alta');
            if (ps.length > 0) done.add('probetas');
            if (pls.length > 0) done.add('placas');
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
        <div className="wizard-mant wizard-mant-muestras">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-muestras-sidebar-icon">
                        <i className="fa-solid fa-vials" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Muestras de calidad</h3>
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
                            className="wizard-mant-progress-fill wizard-muestras-progress-fill"
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
                        muestras={muestras}
                        probetas={probetas}
                        placas={placas}
                        placasStats={placasStats}
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
    if (stepId === 'flujo')      return <StepFlujo />;
    if (stepId === 'origen')     return <StepOrigen {...props} />;
    if (stepId === 'alta')       return <StepAlta {...props} />;
    if (stepId === 'probetas')   return <StepProbetas {...props} />;
    if (stepId === 'rotura')     return <StepRotura {...props} />;
    if (stepId === 'placas')     return <StepPlacas {...props} />;
    if (stepId === 'control')    return <StepControl {...props} />;
    if (stepId === 'informes')   return <StepInformes {...props} />;
    if (stepId === 'listo')      return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-muestras-hero-icon">
                <i className="fa-solid fa-vials" />
            </div>
            <h2>Bienvenido al control de calidad por muestras</h2>
            <p>
                Acá vive todo el control de calidad <strong>aguas abajo</strong> de la producción:
                la toma de la muestra de hormigón fresco, el moldeo de las probetas, el curado en
                pileta, el ensayo de rotura a la edad correspondiente, y todo lo que sale de ahí
                — la carta de control estadística, los informes y los certificados. Es la cadena
                que demuestra que el hormigón que entregaste cumple lo que se diseñó.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-muestras-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-vial" style={{ color: '#06b6d4' }} />
                <strong>Muestra fresca</strong>
                <small>La toma del hormigón en planta o en obra, asociada a un despacho o pastón.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-flask" style={{ color: '#0ea5e9' }} />
                <strong>Probetas moldeadas</strong>
                <small>Cada muestra genera la cantidad de probetas que vos definís, a las edades que vos elegís.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-water" style={{ color: '#16a34a' }} />
                <strong>Curado en pileta</strong>
                <small>Las probetas viven en pileta con temperatura controlada hasta el día del ensayo.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-hammer" style={{ color: '#f59e0b' }} />
                <strong>Ensayo de rotura</strong>
                <small>El día que cumple su edad, la probeta se rompe en prensa y se mide la resistencia.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-circle-half-stroke" style={{ color: '#8b5cf6' }} />
                <strong>Placas de elastómero</strong>
                <small>Las placas de la prensa son consumibles y afectan la validez del ensayo.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-chart-line" style={{ color: '#ef4444' }} />
                <strong>Carta de control</strong>
                <small>Los resultados se grafican en una carta Shewhart con detección de anomalías.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                El control de calidad por muestras no es solo cumplir un trámite — es la herramienta
                que te dice cuándo tu producción se está saliendo del rango antes de que llegue a una
                queja del cliente. Cuanto más cuidado el flujo, más útiles los resultados.
            </span>
        </div>
    </div>
);

/* ─── 1. El ciclo completo (timeline) ─────────────────────── */
const StepFlujo = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-route" /> El ciclo completo de una muestra</h2>
        <p>
            Una muestra atraviesa un recorrido de varios días desde que se toma el hormigón hasta
            que el resultado entra en la carta de control. Conviene tener el cuadro completo en la
            cabeza para entender cuándo interviene cada actor (operario, plantista, responsable de
            calidad) y por qué cada paso importa.
        </p>

        <ol className="wizard-muestras-timeline">
            <li>
                <span className="wizard-muestras-tl-num">1</span>
                <div>
                    <strong>Toma de la muestra</strong>
                    <small>Día 0 · operario o plantista</small>
                    <p>Durante el despacho o el pastón, se toma una muestra del hormigón fresco
                    (típicamente al pie de la mixer o en boca de descarga). Se mide asentamiento,
                    temperatura y se moldean las probetas.</p>
                </div>
            </li>
            <li>
                <span className="wizard-muestras-tl-num">2</span>
                <div>
                    <strong>Carga en el sistema</strong>
                    <small>Día 0 · operario o plantista</small>
                    <p>La muestra se carga acá, asociada a un despacho (si es propio) o a un cliente
                    externo (si es tercero). Se indica número de muestra, datos del hormigón y
                    cantidad de probetas moldeadas.</p>
                </div>
            </li>
            <li>
                <span className="wizard-muestras-tl-num">3</span>
                <div>
                    <strong>Confirmación y curado</strong>
                    <small>Día 1 · responsable de pileta</small>
                    <p>La muestra se confirma indicando en qué pileta de curado quedan las probetas
                    y con qué número de lote. La pileta tiene control de temperatura propio.</p>
                </div>
            </li>
            <li>
                <span className="wizard-muestras-tl-num">4</span>
                <div>
                    <strong>Ensayo de rotura</strong>
                    <small>Día que cumple edad · operario de prensa</small>
                    <p>Al cumplirse la edad definida para esa probeta, se la saca de la pileta, se
                    mide su masa, se centra en la prensa con sus placas de elastómero y se aplica
                    carga hasta la rotura. La prensa registra la fuerza máxima.</p>
                </div>
            </li>
            <li>
                <span className="wizard-muestras-tl-num">5</span>
                <div>
                    <strong>Resultado y validación</strong>
                    <small>Día del ensayo · responsable de calidad</small>
                    <p>El sistema calcula la resistencia (fuerza / área) y la compara con el objetivo
                    de la dosificación. Si la rotura tiene problemas (geometría rara, desviación
                    grosera), se invalida y se aclara.</p>
                </div>
            </li>
            <li>
                <span className="wizard-muestras-tl-num">6</span>
                <div>
                    <strong>Carta de control y reportes</strong>
                    <small>Continuo · responsable de calidad</small>
                    <p>Cada resultado válido entra en la carta de control. Si dispara una alerta
                    estadística, vas a verla acá. Los resultados también alimentan los reportes que
                    podés enviar al cliente o usar en auditorías.</p>
                </div>
            </li>
        </ol>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                El paso más fácil de descuidar es el <strong>3 (confirmación y pileta)</strong>:
                si nadie confirma la muestra, queda como "pendiente" y no se sabe dónde están
                físicamente las probetas. Es importante que el responsable de pileta haga la
                confirmación apenas las recibe.
            </span>
        </div>
    </div>
);

/* ─── 2. Origen propio vs tercero ─────────────────────────── */
const StepOrigen = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-arrows-split-up-and-left" /> Muestras propias vs de terceros</h2>
        <p>
            El sistema separa dos orígenes de muestras, porque el flujo y los datos asociados son
            distintos. La pantalla principal muestra solo las muestras propias por defecto; con un
            click en el selector superior pasás a las de terceros, que viven en una pantalla aparte.
        </p>

        <div className="wizard-muestras-compare">
            <div className="wizard-muestras-compare-col propio">
                <div className="wizard-muestras-compare-head">
                    <div className="wizard-muestras-compare-icon" style={{ background: '#06b6d4' }}>
                        <i className="fa-solid fa-industry" />
                    </div>
                    <div>
                        <h4>Propio</h4>
                        <small>Hormigón producido por vos</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Puede ir <strong>asociada a un despacho</strong> (hereda cliente, planta, tipo de hormigón y dosificación)</span></li>
                    <li><i className="fa-solid fa-check" /><span>O cargada <strong>sin despacho</strong>, completando los datos a mano (útil para pastones de prueba o cuando el despacho aún no está cargado)</span></li>
                    <li><i className="fa-solid fa-check" /><span>Resultados entran en la carta de control de tu producción</span></li>
                </ul>
                <div className="wizard-muestras-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Producción propia. La gran mayoría de las muestras de una elaboradora.</p>
                </div>
            </div>

            <div className="wizard-muestras-compare-col tercero">
                <div className="wizard-muestras-compare-head">
                    <div className="wizard-muestras-compare-icon" style={{ background: '#8b5cf6' }}>
                        <i className="fa-solid fa-user-tie" />
                    </div>
                    <div>
                        <h4>Tercero</h4>
                        <small>Hormigón de un cliente externo</small>
                    </div>
                </div>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Sin despacho asociado — los datos del cliente y la obra se cargan a mano</span></li>
                    <li><i className="fa-solid fa-check" /><span>Sirve para laboratorios que prestan servicios a terceros</span></li>
                    <li><i className="fa-solid fa-check" /><span>Maneja su propia tabla y sus propias probetas</span></li>
                    <li><i className="fa-solid fa-check" /><span>El informe se entrega al cliente externo, no entra en tu carta de control</span></li>
                </ul>
                <div className="wizard-muestras-compare-when">
                    <strong>Cuándo aplica…</strong>
                    <p>Servicios de laboratorio a otros productores u obras particulares que te traen probetas.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Cómo cambiar entre vistas:</strong>
                <p>
                    Arriba de la tabla hay un selector con dos botones: <em>Propio</em> y
                    <em> Tercero</em>. Al tocar Tercero, te llevamos a la pantalla de Muestras de
                    Terceros. El flujo de probetas, ensayos y placas es el mismo, solo cambia la
                    fuente de los datos del encabezado.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Muestras de terceros"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/calidad/ensayos/muestras-terceros', 'Muestras terceros')}
            />
        </div>
    </div>
);

/* ─── 3. Alta de muestra ──────────────────────────────────── */
const StepAlta = ({ muestras, loading, reload }) => {
    const tiene = muestras.length > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-vial" /> Alta de una muestra</h2>
            <p>
                El alta de una muestra propia se puede hacer de dos maneras según los datos que tengas
                disponibles en el momento. La idea es que el operario o el plantista nunca quede
                bloqueado por falta de información — siempre puede cargar la muestra y completar lo
                que falte después.
            </p>

            <div className="wizard-mant-status">
                {loading ? (
                    <span className="wizard-mant-status-loading"><i className="fa-solid fa-spinner fa-spin" /> Verificando…</span>
                ) : tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Hay <strong>{muestras.length}</strong> muestra{muestras.length !== 1 ? 's' : ''} cargada{muestras.length !== 1 ? 's' : ''} en el sistema
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Todavía no hay muestras cargadas
                    </span>
                )}
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-arrows-split-up-and-left" />
                Las dos modalidades de alta
            </h3>

            <div className="wizard-muestras-compare">
                <div className="wizard-muestras-compare-col propio">
                    <div className="wizard-muestras-compare-head">
                        <div className="wizard-muestras-compare-icon" style={{ background: '#06b6d4' }}>
                            <i className="fa-solid fa-truck" />
                        </div>
                        <div>
                            <h4>Asociada a despacho</h4>
                            <small>Recomendada cuando hay despacho cargado</small>
                        </div>
                    </div>
                    <ul>
                        <li><i className="fa-solid fa-check" /><span>Elegís el despacho desde la lista — el sistema completa solo cliente, planta, tipo de hormigón y dosificación</span></li>
                        <li><i className="fa-solid fa-check" /><span>Garantiza consistencia con lo que se entregó realmente</span></li>
                        <li><i className="fa-solid fa-check" /><span>Reduce la chance de tipear mal datos del cliente o el tipo de hormigón</span></li>
                    </ul>
                    <div className="wizard-muestras-compare-when">
                        <strong>Cuándo conviene…</strong>
                        <p>Producción habitual donde el despacho ya está cargado en el sistema antes de que se tome la muestra.</p>
                    </div>
                </div>

                <div className="wizard-muestras-compare-col tercero">
                    <div className="wizard-muestras-compare-head">
                        <div className="wizard-muestras-compare-icon" style={{ background: '#8b5cf6' }}>
                            <i className="fa-solid fa-pen-to-square" />
                        </div>
                        <div>
                            <h4>Sin despacho</h4>
                            <small>Carga manual de los datos</small>
                        </div>
                    </div>
                    <ul>
                        <li><i className="fa-solid fa-check" /><span>Cargás cliente, planta, tipo de hormigón y dosificación a mano</span></li>
                        <li><i className="fa-solid fa-check" /><span>Útil cuando se toma la muestra antes de que se cargue el despacho, o no hay despacho asociado</span></li>
                        <li><i className="fa-solid fa-check" /><span>También sirve para ensayos de calibración o pastones de prueba que no van a un cliente</span></li>
                    </ul>
                    <div className="wizard-muestras-compare-when">
                        <strong>Cuándo conviene…</strong>
                        <p>Pastones de prueba, calibraciones internas, o cuando el despacho no se cargó todavía y no podés esperar.</p>
                    </div>
                </div>
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-list-ol" />
                Pasos para cargar una muestra
            </h3>
            <ol className="wizard-muestras-steps-list">
                <li>
                    En la pantalla principal, tocá el botón <strong>"Nueva muestra"</strong> arriba
                    a la derecha. Se abre el formulario de alta.
                </li>
                <li>
                    Si tenés despacho disponible, elegilo de la lista — los datos del hormigón se
                    completan solos. Si no, completás los datos del hormigón a mano.
                </li>
                <li>
                    Cargá los datos del hormigón fresco: <strong>asentamiento</strong> (cm),
                    <strong> temperatura</strong> (°C), y cualquier observación visual relevante
                    (color, exudación, segregación).
                </li>
                <li>
                    Indicá la <strong>cantidad de probetas moldeadas</strong> y a qué edad se
                    ensayará cada una. Vos definís cuántas y a qué edades — el sistema no impone
                    una combinación fija.
                </li>
                <li>
                    Guardá la muestra. Queda en estado <em>Pendiente</em> hasta que el responsable
                    de pileta la confirme indicando dónde se curan las probetas.
                </li>
            </ol>

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-circle-info" />
                <div>
                    <strong>Estado de la muestra:</strong>
                    <p>
                        <em>Pendiente</em> = cargada por el operario, sin asignar pileta todavía.
                        <em> Confirmada</em> = el responsable la recibió en pileta, le asignó número
                        de lote y pileta. Solo las muestras confirmadas tienen ubicación física
                        conocida — las pendientes están "en el aire".
                    </p>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Verificar de nuevo"
                    icon="fa-solid fa-rotate"
                    onClick={reload}
                    loading={loading}
                    severity={tiene ? 'success' : undefined}
                />
            </div>
        </div>
    );
};

/* ─── 4. Probetas y curado ────────────────────────────────── */
const StepProbetas = ({ probetas, openInTab }) => {
    const tiene = probetas.length > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-flask" /> Probetas y curado en pileta</h2>
            <p>
                Cada muestra genera <strong>la cantidad de probetas que vos definís</strong>, a las
                edades que vos elegís. No hay un mínimo ni un máximo impuesto por el sistema —
                podés moldear una sola probeta para una calibración, o varias a edades distintas
                (3, 7, 14, 28, 56 días, las que tu plan de control pida). Las probetas son los
                cilindros de hormigón —generalmente de 15 cm de diámetro por 30 cm de altura—
                que efectivamente se ensayan en la prensa. Entre el moldeo y el ensayo, viven en
                una pileta de curado con temperatura controlada que simula condiciones óptimas
                de hidratación.
            </p>

            <div className="wizard-mant-status">
                {tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Hay <strong>{probetas.length}</strong> probeta{probetas.length !== 1 ? 's' : ''} registrada{probetas.length !== 1 ? 's' : ''}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Todavía no hay probetas registradas
                    </span>
                )}
            </div>

            <div className="wizard-muestras-feature-grid">
                <div className="wizard-muestras-feature">
                    <div className="wizard-muestras-feature-icon" style={{ background: '#06b6d4' }}>
                        <i className="fa-solid fa-flask" />
                    </div>
                    <div>
                        <h4>Generación automática</h4>
                        <p>Cuando cargás una muestra y decís cuántas probetas moldeaste, el sistema
                        crea las probetas con su numeración correlativa y las asocia a la muestra.
                        No hay que cargarlas una por una.</p>
                    </div>
                </div>
                <div className="wizard-muestras-feature">
                    <div className="wizard-muestras-feature-icon" style={{ background: '#16a34a' }}>
                        <i className="fa-solid fa-water" />
                    </div>
                    <div>
                        <h4>Pileta de curado</h4>
                        <p>Cada planta tiene una o más piletas. Al confirmar la muestra se elige
                        en cuál quedan las probetas. La pileta lleva un registro propio de
                        temperatura — se anota a diario para tener trazabilidad.</p>
                    </div>
                </div>
                <div className="wizard-muestras-feature">
                    <div className="wizard-muestras-feature-icon" style={{ background: '#f59e0b' }}>
                        <i className="fa-solid fa-clock" />
                    </div>
                    <div>
                        <h4>Edad de ensayo</h4>
                        <p>Cada probeta tiene su edad objetivo, definida por vos al momento del
                        alta (3, 7, 14, 28, 56 días o cualquier otra). El sistema sabe cuándo le
                        toca a cada una y te avisa con anticipación cuáles corresponden a romper
                        en los próximos días.</p>
                    </div>
                </div>
                <div className="wizard-muestras-feature">
                    <div className="wizard-muestras-feature-icon" style={{ background: '#8b5cf6' }}>
                        <i className="fa-solid fa-tag" />
                    </div>
                    <div>
                        <h4>Identificación física</h4>
                        <p>Cada probeta lleva un código numérico que se rotula sobre el cilindro
                        antes del moldeo. Ese mismo código aparece en el sistema, así no hay
                        manera de confundir cuál probeta es cuál a la hora del ensayo.</p>
                    </div>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Probetas"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/calidad/ensayos/probetas', 'Probetas')}
                />
            </div>
        </div>
    );
};

/* ─── 5. Ensayo de rotura ─────────────────────────────────── */
const StepRotura = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-hammer" /> Ensayo de rotura</h2>
        <p>
            Llegado el día, la probeta se saca de la pileta, se prepara y se rompe en una prensa
            hidráulica. La prensa aplica carga axial creciente hasta que la probeta cede; el sistema
            registra la fuerza máxima y, dividiéndola por el área transversal, calcula la resistencia
            del hormigón. Es el momento de verdad de toda la cadena.
        </p>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-list-ol" />
            Pasos del ensayo
        </h3>
        <ol className="wizard-muestras-steps-list">
            <li>
                <strong>Selección de la probeta del día</strong>: el sistema te muestra qué probetas
                cumplen edad hoy. Las marcás como "para ensayar" para que el operario sepa cuáles
                sacar de la pileta.
            </li>
            <li>
                <strong>Preparación física</strong>: la probeta se mide (alto y diámetro real), se
                pesa (para densidad) y se centra en la prensa entre las placas de elastómero. La
                centralidad es clave — un descentrado distorsiona el resultado.
            </li>
            <li>
                <strong>Aplicación de carga</strong>: la prensa aumenta la fuerza a velocidad
                normalizada (típicamente 0,25 ± 0,05 MPa/s). El sistema o el operario registran la
                fuerza máxima al instante de la rotura.
            </li>
            <li>
                <strong>Cálculo de resistencia</strong>: el sistema calcula la resistencia
                (Fuerza / Área) y la compara contra el objetivo de la dosificación. Aparece en la
                pantalla de Probetas con su veredicto.
            </li>
            <li>
                <strong>Forma de rotura</strong>: se anota cómo rompió la probeta (cono, conoide,
                splitting, columnar, etc.). Una rotura "rara" puede invalidar el resultado por
                problemas de moldeo o centrado.
            </li>
            <li>
                <strong>Validación o invalidación</strong>: el responsable de calidad valida el
                resultado, o lo invalida con motivo (geometría, edad fuera de norma, prensa fuera
                de calibración). Solo los validados entran en la carta de control.
            </li>
        </ol>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>La velocidad de carga importa:</strong>
                <p>
                    Una carga muy rápida da resistencias artificialmente altas; una muy lenta, lo
                    contrario. Si tu prensa permite control automático, conviene dejarlo siempre
                    activado. Si es manual, el operario tiene que estar entrenado para mantener el
                    régimen normalizado.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 6. Placas de elastómero ─────────────────────────────── */
const StepPlacas = ({ placasStats, openInTab }) => {
    const tiene = placasStats.total > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-circle-half-stroke" /> Placas de elastómero</h2>
            <p>
                Las placas de elastómero (también llamadas "neoprenes" o "almohadillas") son los
                discos de goma dura que se interponen entre la probeta y los platos de la prensa.
                Cumplen una función crítica: <strong>distribuyen uniformemente la carga</strong>
                y compensan pequeñas irregularidades de la cara superior de la probeta. Sin ellas,
                el ensayo se vuelve poco confiable.
            </p>

            <div className="wizard-mant-status">
                {tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{placasStats.total}</strong> placa{placasStats.total !== 1 ? 's' : ''} registrada{placasStats.total !== 1 ? 's' : ''}
                        ({placasStats.enUso} en uso, {placasStats.enStock} en stock)
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        No hay placas registradas todavía
                    </span>
                )}
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-circle-info" />
                Por qué importan tanto
            </h3>
            <p>
                El elastómero es un consumible: se desgasta con cada ensayo y a partir de un cierto
                número de roturas pierde su capacidad de distribuir carga. Una placa demasiado usada
                puede generar resistencias falsamente bajas o roturas con geometrías raras. Por eso
                el sistema lleva un control específico: cada placa tiene su <strong>dureza Shore</strong>
                (50, 60 o 70 según rango de resistencia), su <strong>diámetro</strong> (100 o 150 mm),
                su <strong>cantidad de usos acumulados</strong> y su <strong>estado</strong>.
            </p>

            <div className="wizard-muestras-placas-grid">
                <div className="wizard-muestras-placa-card stock">
                    <i className="fa-solid fa-box" />
                    <strong>{placasStats.enStock}</strong>
                    <small>En stock</small>
                </div>
                <div className="wizard-muestras-placa-card uso">
                    <i className="fa-solid fa-play" />
                    <strong>{placasStats.enUso}</strong>
                    <small>En uso</small>
                </div>
                <div className="wizard-muestras-placa-card agotadas">
                    <i className="fa-solid fa-ban" />
                    <strong>{placasStats.agotadas}</strong>
                    <small>Agotadas</small>
                </div>
                <div className="wizard-muestras-placa-card descartadas">
                    <i className="fa-solid fa-trash" />
                    <strong>{placasStats.descartadas}</strong>
                    <small>Descartadas</small>
                </div>
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-arrows-rotate" />
                Ciclo de vida de una placa
            </h3>
            <ol className="wizard-muestras-steps-list">
                <li>
                    <strong>En stock</strong>: la placa nueva se carga al sistema y queda
                    disponible. Indicás dureza, diámetro y planta.
                </li>
                <li>
                    <strong>En uso</strong>: cuando se monta en una prensa, queda asignada a esa
                    prensa. El contador de usos arranca en cero y suma uno con cada rotura.
                </li>
                <li>
                    <strong>Agotada</strong>: al alcanzar el tope de usos definido, el sistema la
                    marca como agotada y bloquea su uso para nuevos ensayos. Hay que reemplazarla
                    por una nueva del stock.
                </li>
                <li>
                    <strong>Descartada</strong>: si una placa se daña antes de agotarse (deterioro
                    visible, golpe), se descarta manualmente con motivo. Queda registrada para
                    auditoría.
                </li>
            </ol>

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-triangle-exclamation" />
                <div>
                    <strong>Una placa por rango de resistencia:</strong>
                    <p>
                        Las dureza Shore se eligen según el rango de resistencia del hormigón: 50
                        para 10-40 MPa, 60 para 20-50 MPa, 70 para 30-85 MPa. Usar la dureza
                        equivocada distorsiona el resultado. El sistema te avisa si intentás usar
                        una placa fuera de su rango.
                    </p>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Placas de elastómero"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/calidad/placas-elastomero', 'Placas elastómero')}
                />
            </div>
        </div>
    );
};

/* ─── 7. Carta de control ─────────────────────────────────── */
const StepControl = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-chart-line" /> Carta de control de calidad</h2>
        <p>
            Cada resultado válido de ensayo entra en una <strong>carta de control de Shewhart</strong>
            por tipo de hormigón. La carta te muestra los puntos en orden cronológico, con la media
            y las bandas de uno, dos y tres sigmas. Es la herramienta que detecta cuándo tu
            producción se está saliendo de control estadístico, antes de que sea evidente a simple
            vista.
        </p>

        <div className="wizard-muestras-shewhart-mock">
            <svg viewBox="0 0 480 280" preserveAspectRatio="xMidYMid meet">
                {/* Título y eje */}
                <text x="240" y="22" textAnchor="middle" fill="currentColor" fontSize="13" fontWeight="600" opacity="0.85">
                    Resistencia (MPa) vs Nº de muestra
                </text>

                {/* Bandas con etiquetas */}
                <line x1="40" y1="140" x2="460" y2="140" stroke="#10B981" strokeWidth="2" />
                <text x="465" y="144" fill="#10B981" fontSize="11" fontWeight="600">μ</text>

                <line x1="40" y1="100" x2="460" y2="100" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="6,3" />
                <text x="465" y="104" fill="#F59E0B" fontSize="10">+1σ</text>
                <line x1="40" y1="180" x2="460" y2="180" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="6,3" />
                <text x="465" y="184" fill="#F59E0B" fontSize="10">−1σ</text>

                <line x1="40" y1="60" x2="460" y2="60" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="6,3" />
                <text x="465" y="64" fill="#EF4444" fontSize="10">+3σ</text>
                <line x1="40" y1="220" x2="460" y2="220" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="6,3" />
                <text x="465" y="224" fill="#EF4444" fontSize="10">−3σ</text>

                {/* Eje X */}
                <line x1="40" y1="250" x2="460" y2="250" stroke="currentColor" strokeWidth="1" opacity="0.3" />

                {/* Polilínea de datos */}
                <polyline
                    points="55,135 80,128 105,148 130,138 155,118 180,142 205,124 230,132 255,156 280,122 305,134 330,55 355,140 380,128 405,138 430,130"
                    fill="none" stroke="#3B82F6" strokeWidth="2.5"
                />
                {/* Puntos */}
                {[
                    [55,135],[80,128],[105,148],[130,138],[155,118],[180,142],[205,124],[230,132],
                    [255,156],[280,122],[305,134],[330,55],[355,140],[380,128],[405,138],[430,130]
                ].map(([cx, cy], i) => {
                    const violado = cy < 60;
                    return (
                        <circle key={i} cx={cx} cy={cy} r={violado ? 6 : 4.5}
                                fill={violado ? '#DC2626' : '#3B82F6'}
                                stroke="#fff" strokeWidth="2" />
                    );
                })}

                {/* Marca de violación */}
                <text x="330" y="42" textAnchor="middle" fill="#DC2626" fontSize="11" fontWeight="700">
                    ▲ violación
                </text>
            </svg>
            <div className="wizard-muestras-shewhart-leyenda">
                <span><span className="dot mean" /> Media (μ)</span>
                <span><span className="dot s1" /> ±1σ</span>
                <span><span className="dot s2" /> ±3σ</span>
                <span><span className="dot violation" /> Violación</span>
            </div>
        </div>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-shield-halved" />
            Reglas Western Electric
        </h3>
        <p>
            Además de la regla obvia de "punto fuera de ±3σ", el sistema aplica las
            <strong> reglas Western Electric</strong> para detectar patrones más sutiles que también
            indican que el proceso se está descontrolando: corridas largas a un lado de la media,
            tendencias monótonas, agrupaciones cerca del límite. Cuando una regla se activa, el
            punto correspondiente queda marcado para revisión.
        </p>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Modo absoluto vs normalizado:</strong>
                <p>
                    Podés ver la carta en MPa absolutos o como <em>porcentaje del objetivo</em>
                    de la dosificación. El modo normalizado es útil cuando querés ver el control
                    de varios tipos de hormigón juntos en una sola carta — todos quedan referidos
                    a 100 % del objetivo.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Carta de control"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/calidad/control', 'Control')}
            />
        </div>
    </div>
);

/* ─── 8. Informes y reportes ──────────────────────────────── */
const StepInformes = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-file-pdf" /> Informes y reportes</h2>
        <p>
            Todo lo que se carga en muestras y probetas se traduce en reportes listos para imprimir
            o enviar al cliente. Hay tres tipos principales que cubren los pedidos más comunes:
            las muestras frescas (datos del día de la toma), las probetas (resultados de rotura),
            y certificados específicos por proyecto u obra.
        </p>

        <div className="wizard-muestras-informes-grid">
            <div className="wizard-muestras-informe-card">
                <div className="wizard-muestras-informe-icon" style={{ background: '#06b6d4' }}>
                    <i className="fa-solid fa-vial" />
                </div>
                <div>
                    <h4>Reporte de muestras frescas</h4>
                    <p>Lista las muestras tomadas en un período con sus datos del estado fresco
                    (asentamiento, temperatura) y el despacho asociado. Se filtra por planta,
                    cliente, tipo de hormigón y fecha.</p>
                </div>
            </div>
            <div className="wizard-muestras-informe-card">
                <div className="wizard-muestras-informe-icon" style={{ background: '#0ea5e9' }}>
                    <i className="fa-solid fa-flask" />
                </div>
                <div>
                    <h4>Reporte de probetas</h4>
                    <p>Lista las probetas ensayadas con su resultado de resistencia, edad real,
                    forma de rotura y veredicto. Es el reporte que típicamente se envía al cliente
                    una vez completado el ensayo a la edad de control.</p>
                </div>
            </div>
            <div className="wizard-muestras-informe-card">
                <div className="wizard-muestras-informe-icon" style={{ background: '#16a34a' }}>
                    <i className="fa-solid fa-stamp" />
                </div>
                <div>
                    <h4>Certificados</h4>
                    <p>Documentos firmados por el Director Técnico que certifican el cumplimiento
                    de un lote o de una obra completa. Toman datos de varias muestras y producen
                    un PDF formal con sello y firma.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Reporte muestras frescas"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/reportes/muestras-frescas', 'Muestras frescas')}
            />
            <Button
                label="Reporte probetas"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/reportes/probetas', 'Probetas')}
            />
        </div>
    </div>
);

/* ─── 9. Listo ─────────────────────────────────────────────── */
const StepListo = ({ muestras, probetas, placasStats }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, #06b6d4, #0e7490)' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Ya conocés todo el ciclo de muestras</h2>
            <p>
                Tenés el panorama completo: desde la toma del hormigón fresco hasta el resultado en
                la carta de control y los reportes que se entregan. Cada eslabón depende del
                anterior, así que vale la pena cuidar cada paso.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-vial" />
                <span>Muestras cargadas</span>
                <strong>{muestras.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-flask" />
                <span>Probetas registradas</span>
                <strong>{probetas.length}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-circle-half-stroke" />
                <span>Placas de elastómero (total)</span>
                <strong>{placasStats.total}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-play" />
                <span>Placas en uso</span>
                <strong>{placasStats.enUso}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-box" />
                <span>Placas en stock</span>
                <strong>{placasStats.enStock}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Cuanto más constante sea la carga de muestras y la lectura de la carta de control,
                antes vas a detectar desvíos y más fácil va a ser corregirlos. Una buena rutina
                vale más que un control esporádico exhaustivo.
            </span>
        </div>
    </div>
);

export default WizardMuestras;
