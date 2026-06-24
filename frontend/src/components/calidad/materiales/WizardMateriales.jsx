import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Button } from "primereact/button";
import { Tooltip } from "primereact/tooltip";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useTabContext } from "../../../context/TabContext";
// Reutilizamos las primitivas .wizard-mant-* y .wizard-cl-mockup-*:
import "../../admin/mantenimiento/WizardMantenimiento.css";
import "../../flota/mantenimiento/WizardChecklist.css";
import "./WizardMateriales.css";

/* ============================================================
   Wizard de configuración asistida · Catálogo de materiales
   ============================================================
   Acompaña al usuario a entender el catálogo unificado de
   materiales. Cada agregado, cemento, aditivo, fibra, adición
   o agua es la entrada que después usan ensayos, mezclas y
   dosificaciones. La configuración correcta acá determina la
   trazabilidad y el cumplimiento aguas abajo.

   9 pasos. */

const STEPS = [
    { id: 'bienvenida',     label: 'Bienvenida',       icon: 'fa-solid fa-house' },
    { id: 'categorias',     label: 'Las 6 categorías', icon: 'fa-solid fa-layer-group' },
    { id: 'plantas',        label: 'Plantas',          icon: 'fa-solid fa-industry' },
    { id: 'pivote-planta',  label: 'Por planta',       icon: 'fa-solid fa-arrows-split-up-and-left' },
    { id: 'alta-material',  label: 'Alta de material', icon: 'fa-solid fa-plus' },
    { id: 'granulometria',  label: 'Granulometría del agregado', icon: 'fa-solid fa-chart-line' },
    { id: 'documentacion',  label: 'Documentación',    icon: 'fa-solid fa-folder-open' },
    { id: 'reactividad',    label: 'Ensayos vinculados', icon: 'fa-solid fa-bolt' },
    { id: 'listo',          label: 'Listo',            icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'mat_wizard_step';
const PAUSED_KEY = 'mat_wizard_paused';

const WizardMateriales = ({ visible, onClose, onFinish }) => {
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

    const [counts, setCounts] = useState({
        agregados: 0, cementos: 0, aditivos: 0, fibras: 0, adiciones: 0, agua: 0,
    });
    const [plantas, setPlantas] = useState([]);
    const [loading, setLoading] = useState(false);

    const totalMateriales = useMemo(() => (
        Object.values(counts).reduce((a, b) => a + b, 0)
    ), [counts]);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const [matRes, plaRes] = await Promise.all([
                axios.get(`${config.backendUrl}/api/materiales`, {
                    headers: config.headers, params: { tipo: 'ALL' },
                }).catch(() => ({ data: null })),
                axios.get(`${config.backendUrl}/api/plantas`, {
                    headers: config.headers,
                }).catch(() => ({ data: [] })),
            ]);

            // Counts: el endpoint ALL devuelve { data, meta: { counts: { agregados, ... } } }
            const matData = matRes.data;
            const newCounts = {
                agregados: matData?.meta?.counts?.agregados || 0,
                cementos:  matData?.meta?.counts?.cementos  || 0,
                aditivos:  matData?.meta?.counts?.aditivos  || 0,
                fibras:    matData?.meta?.counts?.fibras    || 0,
                adiciones: matData?.meta?.counts?.adiciones || 0,
                agua:      matData?.meta?.counts?.agua      || 0,
            };
            // Fallback si no hay meta: usar length del array
            if (!matData?.meta && Array.isArray(matData?.data)) {
                matData.data.forEach((m) => {
                    const src = m._source;
                    if (src && newCounts[src + 's'] !== undefined) newCounts[src + 's'] += 1;
                    else if (src === 'agua') newCounts.agua += 1;
                    else if (src === 'adicion') newCounts.adiciones += 1;
                });
            }
            setCounts(newCounts);

            const pl = Array.isArray(plaRes.data) ? plaRes.data : [];
            setPlantas(pl);

            const done = new Set();
            done.add('bienvenida');
            done.add('categorias');     // informativo
            done.add('pivote-planta');  // informativo
            done.add('granulometria');  // informativo (no hay endpoint trivial para contar granulometrías por agregado)
            done.add('documentacion');  // informativo
            done.add('reactividad');    // informativo
            if (pl.length > 0) done.add('plantas');
            const totMat = Object.values(newCounts).reduce((a, b) => a + b, 0);
            if (totMat > 0) done.add('alta-material');
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
        <div className="wizard-mant wizard-mant-mat">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-mat-sidebar-icon">
                        <i className="fa-solid fa-cubes" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Materiales</h3>
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
                            className="wizard-mant-progress-fill wizard-mat-progress-fill"
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
                        counts={counts}
                        totalMateriales={totalMateriales}
                        plantas={plantas}
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
    if (stepId === 'bienvenida')    return <StepBienvenida />;
    if (stepId === 'categorias')    return <StepCategorias {...props} />;
    if (stepId === 'plantas')       return <StepPlantas {...props} />;
    if (stepId === 'pivote-planta') return <StepPivotePlanta />;
    if (stepId === 'alta-material') return <StepAltaMaterial {...props} />;
    if (stepId === 'granulometria') return <StepGranulometria {...props} />;
    if (stepId === 'documentacion') return <StepDocumentacion {...props} />;
    if (stepId === 'reactividad')   return <StepReactividad {...props} />;
    if (stepId === 'listo')         return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-mat-hero-icon">
                <i className="fa-solid fa-cubes" />
            </div>
            <h2>Bienvenido al Catálogo de materiales</h2>
            <p>
                El catálogo de materiales es la <strong>base de todo lo demás</strong>. Cada agregado,
                cemento, aditivo, fibra, adición o agua que cargás acá es la entrada que después
                consumen los ensayos, las mezclas de agregados y las dosificaciones. Si un material
                está mal cargado o le falta información, todo lo que dependa de él arrastra el
                problema. Por eso conviene dedicarle un rato a entender cómo se organiza.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-mat-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-layer-group" style={{ color: '#f59e0b' }} />
                <strong>6 categorías</strong>
                <small>Agregado, Cemento, Aditivo, Fibra, Adición, Agua. Cada una con su propio modelo.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-industry" style={{ color: '#0ea5e9' }} />
                <strong>Por planta</strong>
                <small>Curvas, factores de calibración y precios se cargan por planta, no globales.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-chart-line" style={{ color: '#16a34a' }} />
                <strong>Granulometría histórica</strong>
                <small>Cada agregado guarda sus granulometrías históricas con fecha y planta de origen.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-folder-open" style={{ color: '#8b5cf6' }} />
                <strong>Documentación</strong>
                <small>Fichas técnicas, certificados de origen y comprobantes adjuntos por material.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-flask-vial" style={{ color: '#ef4444' }} />
                <strong>Ensayos vinculados</strong>
                <small>Cada material acumula sus ensayos. Los resultados disparan re-evaluación automática.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-link" style={{ color: '#6e79eb' }} />
                <strong>Aguas abajo</strong>
                <small>Mezclas y dosificaciones referencian los materiales de este catálogo.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Podés cerrar el asistente cuando quieras y al volver vas a retomar exactamente donde
                dejaste. Los datos que cargues durante el asistente se guardan inmediatamente.
            </span>
        </div>
    </div>
);

/* ─── 1. Las 6 categorías ──────────────────────────────────── */
const StepCategorias = ({ counts }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-layer-group" /> Las 6 categorías de material</h2>
        <p>
            HormiQual maneja seis categorías de material, cada una con sus propios datos relevantes y
            su propio formulario de carga. No es lo mismo cargar un cemento (que tiene clase, tipo,
            curva resistencia) que un aditivo (con sus efectos y dosificación recomendada). El sistema
            ya viene preparado para cada caso.
        </p>

        <div className="wizard-mat-categorias">
            <CategoriaCard
                icon="fa-solid fa-mountain" color="#f59e0b"
                titulo="Agregados" count={counts.agregados}
                desc="Finos y gruesos. Tamaño máximo nominal, peso específico, módulo de fineza,
                      curvas granulométricas por planta. Es la categoría más numerosa."
            />
            <CategoriaCard
                icon="fa-solid fa-bag-shopping" color="#6e79eb"
                titulo="Cementos" count={counts.cementos}
                desc="Tipo, clase resistente, marca, certificado IRAM. Cada cemento tiene curva de
                      resistencia por planta para calibrar el motor de dosificación."
            />
            <CategoriaCard
                icon="fa-solid fa-flask" color="#16a34a"
                titulo="Aditivos" count={counts.aditivos}
                desc="Plastificantes, retardantes, acelerantes, incorporadores de aire, fibras
                      químicas, etc. Cada uno declara sus efectos y dosificación recomendada."
            />
            <CategoriaCard
                icon="fa-solid fa-magnet" color="#ef4444"
                titulo="Fibras" count={counts.fibras}
                desc="Acero, polipropileno, vidrio. Datos de longitud, esbeltez, dosificación típica
                      y aporte estructural."
            />
            <CategoriaCard
                icon="fa-solid fa-dust" color="#8b5cf6"
                titulo="Adiciones" count={counts.adiciones}
                desc="Cenizas volantes, microsílice, escoria de alto horno, filler calizo. Sustituyen
                      parcialmente al cemento o aportan finos."
            />
            <CategoriaCard
                icon="fa-solid fa-droplet" color="#0ea5e9"
                titulo="Agua" count={counts.agua}
                desc="Cada fuente de agua se trata como un material separado, con sus ensayos de
                      pH, sólidos disueltos, sulfatos y cloruros."
            />
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>El listado está unificado:</strong>
                <p>
                    En la pantalla principal de Materiales tenés un selector arriba para alternar
                    entre las seis categorías. La búsqueda y los filtros funcionan dentro de la
                    categoría seleccionada. Hay también un toggle para ver materiales archivados
                    (los que tienen referencias históricas y no se pueden borrar duro).
                </p>
            </div>
        </div>
    </div>
);

const CategoriaCard = ({ icon, color, titulo, count, desc }) => (
    <div className="wizard-mat-categoria">
        <div className="wizard-mat-categoria-icon" style={{ background: color }}>
            <i className={icon} />
        </div>
        <div className="wizard-mat-categoria-body">
            <div className="wizard-mat-categoria-head">
                <strong>{titulo}</strong>
                <span className="wizard-mat-categoria-count">{count} cargado{count !== 1 ? 's' : ''}</span>
            </div>
            <p>{desc}</p>
        </div>
    </div>
);

/* ─── 2. Plantas ───────────────────────────────────────────── */
const StepPlantas = ({ plantas, loading, reload, openInTab }) => {
    const tiene = plantas.length > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-industry" /> Tus plantas (prerrequisito)</h2>
            <p>
                Antes de cargar materiales conviene tener cargadas las plantas en las que vas a
                trabajar. Cada planta es un origen físico distinto: una elaboradora de hormigón
                en Centenario, otra en Plottier, etc. Los datos de los materiales —especialmente
                curvas, factores de calibración y precios— se asocian a una planta específica.
            </p>

            <div className="wizard-mant-status">
                {loading ? (
                    <span className="wizard-mant-status-loading"><i className="fa-solid fa-spinner fa-spin" /> Verificando…</span>
                ) : tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{plantas.length}</strong> {plantas.length === 1 ? 'planta cargada' : 'plantas cargadas'}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        No hay plantas cargadas. Creá al menos una antes de cargar materiales.
                    </span>
                )}
            </div>

            {tiene && (
                <ul className="wizard-mant-list">
                    {plantas.slice(0, 5).map((p) => (
                        <li key={p.idPlanta}>
                            <i className="fa-solid fa-industry" />
                            <strong>{p.nombre || p.detalle || `Planta ${p.idPlanta}`}</strong>
                            <small>{p.direccion || p.localidad || ''}</small>
                        </li>
                    ))}
                    {plantas.length > 5 && <li className="wizard-mant-list-more">+ {plantas.length - 5} más…</li>}
                </ul>
            )}

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Plantas"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/admin/plantas', 'Plantas')}
                />
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

/* ─── 3. Pivote material × planta ─────────────────────────── */
const StepPivotePlanta = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-arrows-split-up-and-left" /> Datos por planta</h2>
        <p>
            Hay un detalle clave de cómo se modelan los materiales en HormiQual: para cementos,
            aditivos, adiciones y fibras, los <strong>datos que pueden variar de planta en planta</strong>
            (curvas de resistencia, factores de calibración, precios) se cargan por planta. El
            material es el mismo —el cemento "CPC40 Avellaneda" sigue siendo uno solo—, pero su
            curva de resistencia en la planta de Centenario puede ser distinta a la de Plottier.
        </p>

        <div className="wizard-mat-pivote-grid">
            <div className="wizard-mat-pivote-col">
                <div className="wizard-mat-pivote-head">
                    <i className="fa-solid fa-cube" />
                    <h4>Datos compartidos</h4>
                </div>
                <small>Iguales en todas las plantas</small>
                <ul>
                    <li><i className="fa-solid fa-check" /><span>Nombre, fabricante o productor, marca</span></li>
                    <li><i className="fa-solid fa-check" /><span>Tipo, clase, descripción</span></li>
                    <li><i className="fa-solid fa-check" /><span>Certificados y fichas técnicas</span></li>
                    <li><i className="fa-solid fa-check" /><span>Ensayos de caracterización general</span></li>
                </ul>
            </div>
            <div className="wizard-mat-pivote-col by-planta">
                <div className="wizard-mat-pivote-head">
                    <i className="fa-solid fa-industry" />
                    <h4>Datos por planta</h4>
                </div>
                <small>Pueden variar entre plantas del mismo material</small>
                <ul>
                    <li><i className="fa-solid fa-check" /><span><strong>Curva granulométrica</strong> (agregados): cada planta procesa el agregado distinto</span></li>
                    <li><i className="fa-solid fa-check" /><span><strong>Curva de resistencia</strong> (cementos): calibración con el silo de esa planta</span></li>
                    <li><i className="fa-solid fa-check" /><span><strong>Factor de ajuste</strong> del motor de dosificación, por planta</span></li>
                    <li><i className="fa-solid fa-check" /><span><strong>Precio</strong>: cada planta puede tener proveedores y costos distintos</span></li>
                </ul>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>Importante para el motor de dosificación:</strong>
                <p>
                    Cuando le pedís al motor que calcule una dosificación, tenés que indicarle
                    qué planta. El motor toma las curvas y factores de esa planta específica.
                    Si te falta cargar la curva de un material en una planta, el cálculo te lo
                    avisa con un mensaje claro.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 4. Alta de material ──────────────────────────────────── */
const StepAltaMaterial = ({ counts, totalMateriales, openInTab }) => {
    const tiene = totalMateriales > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-plus" /> Cómo dar de alta un material</h2>
            <p>
                Para crear un material nuevo, primero seleccionás la categoría desde el selector
                superior de la página (Agregados, Cementos, etc.) y después tocás el botón
                <strong> "Nuevo …"</strong> de arriba a la derecha. La etiqueta del botón cambia
                según la categoría seleccionada — siempre te dice exactamente qué vas a crear.
            </p>

            <div className="wizard-mant-status">
                {tiene ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Ya tenés <strong>{totalMateriales}</strong> material{totalMateriales !== 1 ? 'es' : ''} cargado{totalMateriales !== 1 ? 's' : ''} en total
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        Todavía no hay materiales cargados. Empezá creando un agregado o un cemento.
                    </span>
                )}
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-list-ol" />
                Pasos para dar de alta
            </h3>
            <ol className="wizard-mat-steps-list">
                <li>
                    En la página principal de Materiales, elegí la <strong>categoría</strong> arriba
                    (Agregados, Cementos, Aditivos, Fibras, Adiciones o Agua).
                </li>
                <li>
                    Tocá el botón verde <strong>"Nuevo …"</strong> arriba a la derecha. La etiqueta
                    cambia según la categoría seleccionada.
                </li>
                <li>
                    Completá los datos generales del material (nombre, fabricante o productor,
                    descripción). Estos campos son <strong>compartidos entre plantas</strong>.
                </li>
                <li>
                    Si la categoría lo requiere (cementos, aditivos, adiciones, fibras), después
                    podés agregar los datos por planta desde la ficha del material: curva de
                    resistencia, factor de ajuste, precio.
                </li>
                <li>
                    Para agregados, además vas a poder cargar curvas granulométricas con su fecha
                    y planta de origen — eso lo cubre el siguiente paso.
                </li>
            </ol>

            <div className="wizard-mant-tip">
                <i className="fa-solid fa-lightbulb" />
                <span>
                    Si un material que ya no usás todavía aparece referenciado en ensayos o
                    dosificaciones históricas, no lo vas a poder borrar definitivamente. En ese
                    caso, el sistema lo <strong>archiva</strong> automáticamente. Podés verlo
                    activando el toggle "Archivados" del panel superior.
                </span>
            </div>

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
};

/* ─── 5. Granulometría del agregado ───────────────────────── */
const StepGranulometria = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-chart-line" /> Granulometría del agregado</h2>
        <p>
            La granulometría de un agregado es el resultado de un <strong>ensayo de tamizado</strong>:
            el porcentaje que pasa por cada tamiz. Es uno de los datos más importantes para
            diseñar mezclas y dosificaciones. Cada agregado puede tener <strong>varias granulometrías
            históricas</strong>, cada una con su fecha y planta de origen — así ves cómo evoluciona
            el agregado a lo largo del tiempo.
        </p>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-circle-info" />
            Cómo se carga la granulometría
        </h3>
        <p>
            La granulometría se carga como <strong>un ensayo más del agregado</strong>, desde la
            ficha del material. Andá a <em>Materiales → click en el agregado → pestaña Ensayos →
            "Nuevo ensayo" → tipo "Granulometría"</em>. El formulario es distinto al de los otros
            ensayos: trabaja sobre una serie de tamices con sus respectivos porcentajes pasantes,
            y tiene herramientas específicas de carga y validación.
        </p>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-triangle-exclamation" />
            <div>
                <strong>No confundir con "Catálogos → Curvas granulométricas":</strong>
                <p>
                    Hay un menú aparte en <em>Catálogos → Curvas granulométricas</em>, pero ese
                    menú es para <strong>curvas teóricas y bandas normativas</strong> (Fuller, MAA,
                    Andreasen, IRAM, etc.), que se usan como <strong>objetivos de comparación</strong>
                    cuando diseñás mezclas y dosificaciones. No contiene las granulometrías reales
                    de tus agregados — esas están en cada ficha de material.
                </p>
            </div>
        </div>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-arrows-split-up-and-left" />
            La diferencia, resumida
        </h3>

        <div className="wizard-mat-granu-compare">
            <div className="wizard-mat-granu-card real">
                <div className="wizard-mat-granu-icon"><i className="fa-solid fa-mountain" /></div>
                <div>
                    <strong>Granulometría real del agregado</strong>
                    <small>Ensayo en la ficha del material</small>
                    <p>Es el resultado de tamizar una muestra del agregado en un momento dado. Cada
                    carga tiene fecha, planta y resultado por tamiz. Se hace desde la pestaña Ensayos
                    de la ficha del agregado.</p>
                </div>
            </div>
            <div className="wizard-mat-granu-card teorica">
                <div className="wizard-mat-granu-icon"><i className="fa-solid fa-chart-line" /></div>
                <div>
                    <strong>Curvas teóricas y bandas (catálogo)</strong>
                    <small>Menú Catálogos → Curvas granulométricas</small>
                    <p>Son referencias matemáticas (Fuller, MAA, Andreasen) o rangos normativos
                    (IRAM) que se usan como <em>objetivo</em> al diseñar una mezcla. No describen
                    un agregado puntual, describen un ideal a alcanzar.</p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Materiales"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/calidad/catalogos/materiales?tipo=agregados', 'Materiales')}
            />
            <Button
                label="Abrir Curvas teóricas y bandas"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/calidad/catalogos/curvas', 'Curvas teóricas')}
            />
        </div>
    </div>
);

/* ─── 6. Documentación ────────────────────────────────────── */
const StepDocumentacion = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-folder-open" /> Documentación adjunta</h2>
        <p>
            Cada material puede tener documentos asociados: la <strong>ficha técnica del fabricante</strong>,
            <strong> certificados de origen</strong>, comprobantes de cumplimiento normativo,
            informes de ensayos externos, etc. Estos documentos quedan vinculados al material y se
            pueden referenciar desde fichas técnicas y certificados que emite el sistema.
        </p>

        <div className="wizard-mat-doc-grid">
            <div className="wizard-mat-doc-card">
                <i className="fa-solid fa-file-pdf" />
                <strong>Fichas técnicas</strong>
                <small>El PDF que te entrega el proveedor con propiedades, dosificación recomendada, advertencias.</small>
            </div>
            <div className="wizard-mat-doc-card">
                <i className="fa-solid fa-certificate" />
                <strong>Certificados</strong>
                <small>Certificados IRAM, sello de calidad, ensayos del proveedor con su laboratorio.</small>
            </div>
            <div className="wizard-mat-doc-card">
                <i className="fa-solid fa-file-lines" />
                <strong>Informes externos</strong>
                <small>Si encargás ensayos a un laboratorio independiente, podés adjuntar el informe.</small>
            </div>
            <div className="wizard-mat-doc-card">
                <i className="fa-solid fa-image" />
                <strong>Imágenes</strong>
                <small>Fotos del material, de la cantera, del silo. Útil para distinguir variaciones visuales.</small>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Cómo se usan en informes:</strong>
                <p>
                    Cuando generás un informe técnico o un certificado del material, podés
                    incluir las fichas y certificados adjuntos como anexo del PDF. Eso evita que
                    el destinatario tenga que pedirte aparte el documento original del proveedor.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 7. Reactividad y ensayos ────────────────────────────── */
const StepReactividad = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-bolt" /> Conexión con ensayos y dosificaciones</h2>
        <p>
            Los materiales no son entradas aisladas — están conectados con ensayos, mezclas y
            dosificaciones. Lo que pasa en un material puede repercutir automáticamente en todo
            lo que lo usa. Vale la pena entender bien estas conexiones antes de hacer cambios
            importantes a un material en producción.
        </p>

        <div className="wizard-mat-feature-grid">
            <div className="wizard-mat-feature">
                <div className="wizard-mat-feature-icon" style={{ background: '#f59e0b' }}>
                    <i className="fa-solid fa-bolt" />
                </div>
                <div className="wizard-mat-feature-body">
                    <h4>Re-evaluación automática</h4>
                    <p>
                        Cada vez que cargás o editás un ensayo del material, el sistema vuelve a
                        evaluar el cumplimiento normativo. Si el resultado cambia el estado del
                        material (apto → no apto), las <strong>dosificaciones que usan ese material
                        reciben alertas</strong> en el mismo momento, sin que vos tengas que hacer
                        nada manual.
                    </p>
                </div>
            </div>
            <div className="wizard-mat-feature">
                <div className="wizard-mat-feature-icon" style={{ background: '#0ea5e9' }}>
                    <i className="fa-solid fa-link" />
                </div>
                <div className="wizard-mat-feature-body">
                    <h4>Referencias aguas abajo</h4>
                    <p>
                        Las mezclas de agregados y las dosificaciones referencian a los materiales
                        de este catálogo por su identificador interno. Al editar un material, los
                        cambios se reflejan también en todo lo que lo usa. Para cambios estructurales
                        importantes, conviene crear un material nuevo en lugar de editar el viejo.
                    </p>
                </div>
            </div>
            <div className="wizard-mat-feature">
                <div className="wizard-mat-feature-icon" style={{ background: '#16a34a' }}>
                    <i className="fa-solid fa-clock-rotate-left" />
                </div>
                <div className="wizard-mat-feature-body">
                    <h4>Archivado automático</h4>
                    <p>
                        Si querés borrar un material que ya tiene ensayos o referencias en
                        dosificaciones históricas, el sistema lo <strong>archiva</strong> en lugar
                        de eliminarlo definitivamente — así las dosificaciones viejas no quedan
                        rotas. Podés volver a verlo activando el toggle "Archivados".
                    </p>
                </div>
            </div>
            <div className="wizard-mat-feature">
                <div className="wizard-mat-feature-icon" style={{ background: '#8b5cf6' }}>
                    <i className="fa-solid fa-bell" />
                </div>
                <div className="wizard-mat-feature-body">
                    <h4>Panel de alertas de calidad</h4>
                    <p>
                        Cuando un material cambia su estado de aptitud, las alertas generadas se
                        agrupan en el panel de <em>Alertas de calidad</em>. Desde ahí podés ver
                        qué dosificaciones quedaron afectadas y tomar acción.
                    </p>
                </div>
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
            <Button
                label="Abrir Catálogo de ensayos"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                severity="secondary"
                onClick={() => openInTab('/calidad/catalogos/ensayos', 'Catálogo de ensayos')}
            />
        </div>
    </div>
);

/* ─── 8. Listo ─────────────────────────────────────────────── */
const StepListo = ({ counts, totalMateriales, plantas }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Tu catálogo de materiales está configurado</h2>
            <p>
                Ya sabés cómo se organizan los materiales y cómo se conectan con el resto del
                sistema. A partir de acá podés seguir cargando materiales nuevos, sus curvas y
                documentación, y cualquier cambio se va a reflejar inmediatamente en lo que
                depende de ellos.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-mountain" />
                <span>Agregados</span>
                <strong>{counts.agregados}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-bag-shopping" />
                <span>Cementos</span>
                <strong>{counts.cementos}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-flask" />
                <span>Aditivos</span>
                <strong>{counts.aditivos}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-magnet" />
                <span>Fibras</span>
                <strong>{counts.fibras}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-dust" />
                <span>Adiciones</span>
                <strong>{counts.adiciones}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-droplet" />
                <span>Aguas</span>
                <strong>{counts.agua}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-industry" />
                <span>Plantas</span>
                <strong>{plantas.length}</strong>
            </div>
            <div className="wizard-mant-summary-row total">
                <i className="fa-solid fa-cubes" />
                <span>Total de materiales</span>
                <strong>{totalMateriales}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                A medida que crece el catálogo, usá el buscador y los filtros del panel superior
                para encontrar rápido lo que necesitás. El selector de categoría arriba siempre
                acota la vista a un tipo de material específico.
            </span>
        </div>
    </div>
);

export default WizardMateriales;
