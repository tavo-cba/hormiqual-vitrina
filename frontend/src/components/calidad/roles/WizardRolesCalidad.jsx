import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
import "./WizardRolesCalidad.css";

/* ============================================================
   Wizard de configuración asistida · Roles de Calidad
   ============================================================
   Esta pantalla configura un segundo sistema de permisos —
   complementario al árbol de cuentas— que decide quién puede
   ejecutar acciones de autoridad: aprobar dosificaciones,
   editar parámetros de planta, firmar certificados.

   El wizard explica:
     - El modelo de doble gate (árbol vs rol de calidad)
     - Los 3 roles operativos y la jerarquía
     - Las acciones específicas que cada nivel habilita
     - El requisito de matrícula del Director Técnico
     - Cómo se asigna y se cambia un rol

   7 pasos. */

const STEPS = [
    { id: 'bienvenida',  label: 'Bienvenida',          icon: 'fa-solid fa-house' },
    { id: 'doble-gate',  label: 'Las dos llaves',      icon: 'fa-solid fa-key' },
    { id: 'tres-roles',  label: 'Los 3 roles',         icon: 'fa-solid fa-user-shield' },
    { id: 'acciones',    label: 'Quién hace qué',      icon: 'fa-solid fa-list-check' },
    { id: 'matricula',   label: 'Director Técnico',    icon: 'fa-solid fa-id-card' },
    { id: 'asignar',     label: 'Cómo asignar',        icon: 'fa-solid fa-user-pen' },
    { id: 'listo',       label: 'Listo',               icon: 'fa-solid fa-circle-check' },
];

const STORAGE_KEY = 'roles_cal_wizard_step';
const PAUSED_KEY = 'roles_cal_wizard_paused';

const WizardRolesCalidad = ({ visible, onClose, onFinish }) => {
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

    const [usuarios, setUsuarios] = useState([]);
    const [loading, setLoading] = useState(false);

    // Métricas derivadas — cuántos hay por rol
    const stats = useMemo(() => {
        const s = { total: usuarios.length, operadores: 0, responsables: 0, directores: 0, sinRol: 0 };
        usuarios.forEach((u) => {
            if (!u.rolCalidad) s.sinRol += 1;
            else if (u.rolCalidad === 'OPERADOR') s.operadores += 1;
            else if (u.rolCalidad === 'RESPONSABLE_CALIDAD') s.responsables += 1;
            else if (u.rolCalidad === 'DIRECTOR_TECNICO') s.directores += 1;
        });
        return s;
    }, [usuarios]);

    const cargarEstado = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${config.backendUrl}/api/calidad/roles/usuarios`, {
                headers: config.headers,
            }).catch(() => ({ data: [] }));
            const us = Array.isArray(res.data) ? res.data : [];
            setUsuarios(us);

            const done = new Set();
            done.add('bienvenida');
            done.add('doble-gate');  // informativo
            done.add('tres-roles');  // informativo
            done.add('acciones');    // informativo
            done.add('asignar');     // informativo
            // matricula: done si hay al menos un director técnico (significa que ya
            // alguien con matrícula está asignado)
            const tieneDirector = us.some((u) => u.rolCalidad === 'DIRECTOR_TECNICO');
            if (tieneDirector) done.add('matricula');
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
        <div className="wizard-mant wizard-mant-roles">
            <Tooltip target=".wizard-mant-step.locked" position="right" />

            <aside className="wizard-mant-sidebar">
                <div className="wizard-mant-sidebar-head">
                    <div className="wizard-mant-sidebar-icon wizard-roles-sidebar-icon">
                        <i className="fa-solid fa-user-shield" />
                    </div>
                    <div>
                        <small>Configuración asistida</small>
                        <h3>Roles de Calidad</h3>
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
                            className="wizard-mant-progress-fill wizard-roles-progress-fill"
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
                        usuarios={usuarios}
                        stats={stats}
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
    if (stepId === 'doble-gate') return <StepDobleGate {...props} />;
    if (stepId === 'tres-roles') return <StepTresRoles />;
    if (stepId === 'acciones')   return <StepAcciones />;
    if (stepId === 'matricula')  return <StepMatricula {...props} />;
    if (stepId === 'asignar')    return <StepAsignar {...props} />;
    if (stepId === 'listo')      return <StepListo {...props} />;
    return null;
};

/* ─── 0. Bienvenida ────────────────────────────────────────── */
const StepBienvenida = () => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon wizard-roles-hero-icon">
                <i className="fa-solid fa-user-shield" />
            </div>
            <h2>Bienvenido a Roles de Calidad</h2>
            <p>
                Esta pantalla decide <strong>quién tiene autoridad para qué</strong> dentro del módulo
                de Calidad. No define qué pantallas ve cada usuario (eso ya lo hace el árbol de
                cuentas), sino algo más fino: quién puede <em>aprobar</em> una dosificación, quién
                puede <em>editar parámetros del motor</em>, quién puede <em>firmar un certificado</em>.
                Es un control de autoridad, no de visibilidad.
            </p>
        </div>

        <div className="wizard-mant-cards wizard-roles-cards">
            <div className="wizard-mant-card">
                <i className="fa-solid fa-key" style={{ color: '#475569' }} />
                <strong>Doble llave</strong>
                <small>Árbol de cuentas + Rol de Calidad. Las dos tienen que estar para que se permita la acción.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-layer-group" style={{ color: '#0ea5e9' }} />
                <strong>3 niveles jerárquicos</strong>
                <small>Operador, Responsable, Director Técnico. Cada nivel hereda lo del anterior.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-stamp" style={{ color: '#16a34a' }} />
                <strong>Acciones de autoridad</strong>
                <small>Aprobar, suspender, editar parámetros, firmar certificados. Cada acción tiene su requisito.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-id-card" style={{ color: '#f59e0b' }} />
                <strong>Matrícula obligatoria</strong>
                <small>Para firmar certificados se requiere matrícula declarada en la ficha del empleado.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-user-clock" style={{ color: '#8b5cf6' }} />
                <strong>Operador por defecto</strong>
                <small>Si no le asignás un rol explícito, el usuario se considera Operador.</small>
            </div>
            <div className="wizard-mant-card">
                <i className="fa-solid fa-shield-halved" style={{ color: '#ef4444' }} />
                <strong>Validación en servidor</strong>
                <small>Aunque la pantalla oculte un botón, el sistema vuelve a verificar antes de ejecutar.</small>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Una buena configuración de roles evita errores graves: que cualquier usuario apruebe
                dosificaciones, que se editen parámetros del motor sin control, o que se firmen
                certificados sin matrícula. Vale la pena dedicarle un rato a entenderla bien.
            </span>
        </div>
    </div>
);

/* ─── 1. Las dos llaves (doble gate) ──────────────────────── */
const StepDobleGate = ({ openInTab }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-key" /> Las dos llaves: árbol y rol</h2>
        <p>
            Para que un usuario pueda hacer una acción de calidad, hacen falta <strong>dos llaves
            al mismo tiempo</strong>. Si le falta una sola, la acción se bloquea. Esto evita
            permisos accidentales: tener acceso a una pantalla no implica poder ejecutar acciones
            sensibles dentro de ella.
        </p>

        <div className="wizard-roles-keys">
            <div className="wizard-roles-key">
                <div className="wizard-roles-key-icon" style={{ background: '#0ea5e9' }}>
                    <i className="fa-solid fa-sitemap" />
                </div>
                <div>
                    <h4>Llave 1 — Árbol de cuentas</h4>
                    <p>
                        Define <strong>qué pantallas ve</strong> el usuario y qué CRUD tiene en
                        cada una (ver, crear, editar, borrar). Se configura desde
                        <em> Administrar → Cuentas de usuario</em>. Es la llave que abre la
                        puerta para entrar a una pantalla.
                    </p>
                </div>
            </div>

            <div className="wizard-roles-key-and">
                <span>+</span>
                <small>Las dos al mismo tiempo</small>
            </div>

            <div className="wizard-roles-key">
                <div className="wizard-roles-key-icon" style={{ background: '#475569' }}>
                    <i className="fa-solid fa-user-shield" />
                </div>
                <div>
                    <h4>Llave 2 — Rol de Calidad</h4>
                    <p>
                        Define <strong>qué actos de autoridad puede ejecutar</strong> dentro del
                        módulo: aprobar, suspender, editar parámetros sensibles, firmar. Se
                        configura desde esta pantalla. Es la llave que habilita los botones
                        de acción.
                    </p>
                </div>
            </div>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-circle-info" />
            <div>
                <strong>Ejemplo concreto:</strong>
                <p>
                    Un Responsable de Calidad <em>sin permiso de edición</em> en el árbol para la
                    pantalla de Dosificaciones <strong>no podrá aprobar una dosificación</strong>,
                    porque le falta la primera llave. Inversamente, un usuario con permiso completo
                    en el árbol pero <em>sin rol de calidad asignado</em> queda como Operador
                    implícito y tampoco podrá aprobar — le falta la segunda llave.
                </p>
            </div>
        </div>

        <div className="wizard-mant-actions">
            <Button
                label="Abrir Cuentas de usuario"
                icon="fa-solid fa-arrow-up-right-from-square"
                outlined
                onClick={() => openInTab('/admin/usuarios', 'Cuentas de usuario')}
            />
        </div>
    </div>
);

/* ─── 2. Los 3 roles ──────────────────────────────────────── */
const StepTresRoles = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-user-shield" /> Los 3 roles operativos</h2>
        <p>
            Hay tres roles ordenados de menor a mayor autoridad. Cada nivel <strong>hereda todo lo
            del anterior</strong> y suma capacidades nuevas. Si no le asignás un rol explícito a
            un usuario, el sistema lo trata como Operador.
        </p>

        <div className="wizard-roles-niveles">
            <div className="wizard-roles-nivel operador">
                <div className="wizard-roles-nivel-num">1</div>
                <div className="wizard-roles-nivel-icon"><i className="fa-solid fa-user" /></div>
                <div className="wizard-roles-nivel-body">
                    <h4>Operador de Calidad</h4>
                    <small>Default si no se asigna rol</small>
                    <ul>
                        <li><i className="fa-solid fa-check" /><span>Carga ensayos y mediciones</span></li>
                        <li><i className="fa-solid fa-check" /><span>Propone diseños de dosificación (en borrador)</span></li>
                        <li><i className="fa-solid fa-xmark danger" /><span>No aprueba transiciones a producción</span></li>
                        <li><i className="fa-solid fa-xmark danger" /><span>No firma certificados</span></li>
                    </ul>
                </div>
            </div>

            <div className="wizard-roles-nivel responsable">
                <div className="wizard-roles-nivel-num">2</div>
                <div className="wizard-roles-nivel-icon"><i className="fa-solid fa-user-tie" /></div>
                <div className="wizard-roles-nivel-body">
                    <h4>Responsable de Calidad</h4>
                    <small>Hereda todo lo del Operador</small>
                    <ul>
                        <li><i className="fa-solid fa-check" /><span>Aprueba dosificaciones para producción</span></li>
                        <li><i className="fa-solid fa-check" /><span>Suspende y archiva dosificaciones</span></li>
                        <li><i className="fa-solid fa-check" /><span>Aprueba pastones de producción</span></li>
                        <li><i className="fa-solid fa-check" /><span>Edita parámetros de planta y de mezclas</span></li>
                        <li><i className="fa-solid fa-check" /><span>Emite certificados (sin firma)</span></li>
                        <li><i className="fa-solid fa-xmark danger" /><span>No firma certificados de aptitud</span></li>
                    </ul>
                </div>
            </div>

            <div className="wizard-roles-nivel director">
                <div className="wizard-roles-nivel-num">3</div>
                <div className="wizard-roles-nivel-icon"><i className="fa-solid fa-user-graduate" /></div>
                <div className="wizard-roles-nivel-body">
                    <h4>Director Técnico</h4>
                    <small>Hereda todo lo anterior · Requiere matrícula</small>
                    <ul>
                        <li><i className="fa-solid fa-check" /><span>Todo lo del Responsable</span></li>
                        <li><i className="fa-solid fa-check" /><span><strong>Firma certificados de aptitud</strong> con su matrícula</span></li>
                        <li><i className="fa-solid fa-circle-info info" /><span>Requiere matrícula declarada en la ficha del empleado</span></li>
                    </ul>
                </div>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Asigná tantos Responsables como necesites para que el flujo de aprobación no se
                trabe. Pero cuidado con tener varios Directores Técnicos: cada uno firma con su
                propia matrícula, así que conviene reservarlo para quien efectivamente firma
                ante el cliente.
            </span>
        </div>
    </div>
);

/* ─── 3. Quién hace qué (matriz de acciones) ──────────────── */
const StepAcciones = () => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-list-check" /> Quién puede hacer qué</h2>
        <p>
            Acá está el detalle de las acciones de autoridad y qué rol mínimo se necesita para
            ejecutarlas. Recordá que además del rol, el usuario tiene que tener el permiso
            correspondiente en el árbol de cuentas para la pantalla donde se ejecuta la acción.
        </p>

        <div className="wizard-roles-matrix">
            <table>
                <thead>
                    <tr>
                        <th>Acción</th>
                        <th title="Operador">OP</th>
                        <th title="Responsable de Calidad">RC</th>
                        <th title="Director Técnico">DT</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Cargar ensayos y mediciones</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Proponer diseños de dosificación (borrador)</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr className="row-sep">
                        <td>Aprobar dosificación a producción</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Suspender o archivar dosificación</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Aprobar pastón de producción</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Editar parámetros de planta</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Editar parámetros de mezcla</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr>
                        <td>Emitir certificado (sin firma)</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                        <td className="ok">✓</td>
                    </tr>
                    <tr className="row-sep">
                        <td>Firmar certificado de aptitud <small>(requiere matrícula)</small></td>
                        <td className="no">—</td>
                        <td className="no">—</td>
                        <td className="ok">✓</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div className="wizard-mant-callout">
            <i className="fa-solid fa-shield-halved" />
            <div>
                <strong>Doble verificación:</strong>
                <p>
                    El sistema oculta o deshabilita los botones que el usuario actual no puede
                    ejecutar — no le mostramos cosas que va a recibir como error. Pero además,
                    cada vez que se ejecuta una acción, el servidor vuelve a verificar el rol y
                    el árbol antes de aplicar el cambio. Si alguien manipulara la pantalla, igual
                    no podría ejecutar la acción.
                </p>
            </div>
        </div>
    </div>
);

/* ─── 4. Director Técnico y matrícula ─────────────────────── */
const StepMatricula = ({ stats, openInTab }) => {
    const tieneDirector = stats.directores > 0;
    return (
        <div className="wizard-mant-step-content">
            <h2><i className="fa-solid fa-id-card" /> Director Técnico y matrícula</h2>
            <p>
                El rol de Director Técnico tiene una particularidad: <strong>requiere matrícula
                profesional declarada</strong> en la ficha del empleado vinculado a la cuenta.
                Esto es porque la firma de certificados de aptitud es un acto legal — la matrícula
                queda impresa en el PDF y es lo que da validez ante terceros.
            </p>

            <div className="wizard-mant-status">
                {tieneDirector ? (
                    <span className="wizard-mant-status-ok">
                        <i className="fa-solid fa-circle-check" />
                        Tenés <strong>{stats.directores}</strong> {stats.directores === 1 ? 'Director Técnico asignado' : 'Directores Técnicos asignados'}
                    </span>
                ) : (
                    <span className="wizard-mant-status-warn">
                        <i className="fa-solid fa-circle-exclamation" />
                        No hay Director Técnico asignado. Sin uno, nadie puede firmar certificados.
                    </span>
                )}
            </div>

            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-list-ol" />
                Pasos para asignar un Director Técnico
            </h3>
            <ol className="wizard-roles-steps-list">
                <li>
                    Verificá que la persona tenga su <strong>cuenta de usuario</strong> creada y
                    con permisos en el árbol de Calidad (al menos en las pantallas donde firma).
                </li>
                <li>
                    Asegurate de que su <strong>ficha de empleado</strong> tenga la <em>matrícula
                    profesional</em> cargada. Si no la tiene, andá a Administrar → Empleados,
                    abrí su ficha y completá el campo.
                </li>
                <li>
                    Volvé a esta pantalla, buscá al usuario por nombre y elegí
                    <strong> Director Técnico</strong> en el dropdown de la columna <em>Asignar</em>.
                </li>
                <li>
                    Si la matrícula no está cargada cuando intente firmar un certificado, el
                    sistema le va a mostrar un aviso explicando qué le falta.
                </li>
            </ol>

            <div className="wizard-mant-callout">
                <i className="fa-solid fa-triangle-exclamation" />
                <div>
                    <strong>Sin matrícula no hay firma:</strong>
                    <p>
                        Aunque le asignes el rol de Director Técnico, si la matrícula no está
                        cargada en la ficha del empleado, el botón de firmar va a quedar deshabilitado
                        con un aviso claro. La matrícula es la última verificación antes de imprimir
                        el certificado firmado.
                    </p>
                </div>
            </div>

            <div className="wizard-mant-actions">
                <Button
                    label="Abrir Empleados"
                    icon="fa-solid fa-arrow-up-right-from-square"
                    outlined
                    onClick={() => openInTab('/admin/empleados', 'Empleados')}
                />
            </div>
        </div>
    );
};

/* ─── 5. Cómo asignar y reasignar ─────────────────────────── */
const StepAsignar = ({ stats }) => (
    <div className="wizard-mant-step-content">
        <h2><i className="fa-solid fa-user-pen" /> Cómo asignar y reasignar roles</h2>
        <p>
            La asignación se hace directamente en la tabla principal de esta pantalla. La lista
            muestra solamente los usuarios que <strong>ya tienen acceso al módulo de Calidad</strong>
            por el árbol de cuentas. Si no aparece alguien que esperás ver, es porque todavía no
            tiene permisos en el árbol — eso se arregla desde Administrar → Cuentas de usuario.
        </p>

        <h3 className="wizard-mant-subtitle">
            <i className="fa-solid fa-list-ol" />
            Para cambiar el rol de un usuario
        </h3>
        <ol className="wizard-roles-steps-list">
            <li>
                Buscá al usuario en la tabla por nombre, apellido o usuario. El buscador filtra
                en vivo.
            </li>
                <li>
                En la columna <em>Asignar</em>, abrí el dropdown — vas a ver las cuatro opciones
                con su descripción: Operador (default), Responsable de Calidad, Director Técnico,
                o sin rol explícito (también queda como Operador).
            </li>
            <li>
                Elegí el rol y el cambio se guarda al instante. El usuario verá la nueva
                autoridad la próxima vez que cargue la pantalla.
            </li>
            <li>
                Para quitar autoridad a alguien, asignale <em>Operador</em> nuevamente. Sus
                permisos de visibilidad (árbol) no se tocan — solo le sacás el segundo gate.
            </li>
        </ol>

        <div className="wizard-roles-state">
            <h3 className="wizard-mant-subtitle">
                <i className="fa-solid fa-chart-pie" />
                Estado actual de tus asignaciones
            </h3>
            <div className="wizard-roles-state-grid">
                <div className="wizard-roles-state-card">
                    <span className="wizard-roles-state-num">{stats.total}</span>
                    <small>usuarios con acceso a Calidad</small>
                </div>
                <div className="wizard-roles-state-card">
                    <span className="wizard-roles-state-num">{stats.operadores + stats.sinRol}</span>
                    <small>Operadores (incluye implícitos)</small>
                </div>
                <div className="wizard-roles-state-card">
                    <span className="wizard-roles-state-num">{stats.responsables}</span>
                    <small>Responsables de Calidad</small>
                </div>
                <div className="wizard-roles-state-card">
                    <span className="wizard-roles-state-num">{stats.directores}</span>
                    <small>Directores Técnicos</small>
                </div>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Si un usuario aparece marcado como <strong>Admin del sistema</strong>, técnicamente
                puede ejecutar acciones de Responsable y Emisión de certificados — pero <em>no</em>
                puede firmar certificados sin ser Director Técnico con matrícula. La matrícula es
                personal y no se hereda por el rol de admin.
            </span>
        </div>
    </div>
);

/* ─── 6. Listo ─────────────────────────────────────────────── */
const StepListo = ({ stats }) => (
    <div className="wizard-mant-step-content">
        <div className="wizard-mant-hero">
            <div className="wizard-mant-hero-icon" style={{ background: 'linear-gradient(135deg, #475569, #1e293b)' }}>
                <i className="fa-solid fa-flag-checkered" />
            </div>
            <h2>¡Listo! Ya conocés cómo funcionan los roles de Calidad</h2>
            <p>
                Tenés el panorama completo del sistema de doble llave: árbol de cuentas + rol
                de Calidad. A partir de acá podés asignar roles con criterio y el flujo de
                aprobación de tu operación va a quedar bajo control.
            </p>
        </div>

        <div className="wizard-mant-summary">
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-users" />
                <span>Usuarios con acceso a Calidad</span>
                <strong>{stats.total}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-user" />
                <span>Operadores (asignados + implícitos)</span>
                <strong>{stats.operadores + stats.sinRol}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-user-tie" />
                <span>Responsables de Calidad</span>
                <strong>{stats.responsables}</strong>
            </div>
            <div className="wizard-mant-summary-row">
                <i className="fa-solid fa-user-graduate" />
                <span>Directores Técnicos</span>
                <strong>{stats.directores}</strong>
            </div>
        </div>

        <div className="wizard-mant-tip">
            <i className="fa-solid fa-lightbulb" />
            <span>
                Cuando agregues un usuario nuevo al árbol de Calidad desde Administrar → Cuentas,
                acordate de volver acá para asignarle el rol que corresponde. Si no lo hacés,
                queda como Operador implícito.
            </span>
        </div>
    </div>
);

export default WizardRolesCalidad;
