import React, { useEffect, useMemo, useState, useCallback } from 'react';
import axios from 'axios';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Dropdown } from 'primereact/dropdown';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import LoadSpinner from '../../../common/components/loadspinner/LoadSpinner';
import NonPerm from '../../../common/components/nonperm/nonperm';
import { useToast } from '../../../context/ToastContext';
import { useUserContext } from '../../../context/UserContext';
import { config } from '../../../config/config';
import { ROLES_CALIDAD, ROL_LABEL, ROL_DESCRIPCION, ROL_SEVERITY } from '../../../lib/roles/calidadGates';
import WizardRolesCalidad from './WizardRolesCalidad';
import './WizardRolesCalidad.css';

/**
 * Roles de Calidad — pantalla de asignación.
 *
 * Lista las cuentas de usuario que tienen acceso al módulo Calidad (al menos
 * un check en algún submenú de Calidad, o isAdmin) y permite asignar a cada
 * una uno de los 3 roles operativos:
 *   - Operador de Calidad (default si NULL): carga ensayos, propone diseños.
 *   - Responsable de Calidad: aprueba transiciones, edita parámetros.
 *   - Director Técnico: lo anterior + firma certificados (req. matrícula).
 *
 * No toca el árbol de menús ni roles globales (EmpleadoRol).
 */
const RolesCalidadPage = () => {
    const { hasPermission } = useUserContext();
    const showToast = useToast();
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState(null);
    const [users, setUsers] = useState([]);
    const [filtro, setFiltro] = useState('');

    // Wizard de configuración asistida (modelo Liquidaciones)
    const [setupWizardVisible, setSetupWizardVisible] = useState(false);
    const [setupWizardPaused, setSetupWizardPaused] = useState(() =>
        typeof window !== 'undefined' && localStorage.getItem('roles_cal_wizard_paused') === '1'
    );

    useEffect(() => {
        const sync = () => setSetupWizardPaused(localStorage.getItem('roles_cal_wizard_paused') === '1');
        sync();
        window.addEventListener('focus', sync);
        document.addEventListener('visibilitychange', sync);
        return () => {
            window.removeEventListener('focus', sync);
            document.removeEventListener('visibilitychange', sync);
        };
    }, [setupWizardVisible]);

    const descartarSetupWizard = () => {
        localStorage.removeItem('roles_cal_wizard_step');
        localStorage.removeItem('roles_cal_wizard_paused');
        setSetupWizardPaused(false);
    };

    const opciones = useMemo(() => ([
        { value: null, label: 'Operador (por defecto)', descripcion: 'Sin rol explícito asignado.' },
        ...Object.values(ROLES_CALIDAD).map((value) => ({
            value,
            label: ROL_LABEL[value],
            descripcion: ROL_DESCRIPCION[value],
        })),
    ]), []);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get(`${config.backendUrl}/api/calidad/roles/usuarios`, { headers: config.headers });
            setUsers(res.data || []);
        } catch (err) {
            console.error('Error cargando usuarios de Calidad:', err);
            showToast('error', 'No se pudieron cargar los usuarios');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const onChangeRol = async (user, nuevoRol) => {
        if (user.rolCalidad === nuevoRol) return;
        setSavingId(user.id);
        try {
            await axios.put(
                `${config.backendUrl}/api/calidad/roles/usuarios/${user.id}`,
                { rol: nuevoRol },
                { headers: config.headers }
            );
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, rolCalidad: nuevoRol } : u)));
            showToast('success', `Rol actualizado para ${user.username}`);
        } catch (err) {
            console.error('Error asignando rol:', err);
            showToast('error', err.response?.data?.error || 'No se pudo asignar el rol');
        } finally {
            setSavingId(null);
        }
    };

    const usersFiltrados = useMemo(() => {
        if (!filtro.trim()) return users;
        const f = filtro.toLowerCase();
        return users.filter((u) =>
            (u.username || '').toLowerCase().includes(f) ||
            (`${u.name || ''} ${u.lastname || ''}`).toLowerCase().includes(f) ||
            (u.empleado?.nombre || '').toLowerCase().includes(f) ||
            (u.empleado?.apellido || '').toLowerCase().includes(f)
        );
    }, [users, filtro]);

    if (!hasPermission('ADMIN')) return <NonPerm />;

    const empleadoBody = (u) => {
        if (u.empleado) return `${u.empleado.apellido}, ${u.empleado.nombre}`;
        return <span className="text-color-secondary">—</span>;
    };

    const usuarioBody = (u) => (
        <div className="flex flex-column">
            <span className="font-semibold">{u.username}</span>
            <small className="text-color-secondary">{u.name} {u.lastname}</small>
            {u.isAdmin && (
                <Tag value="Admin del sistema" severity="warning" className="mt-1" style={{ width: 'fit-content' }} />
            )}
        </div>
    );

    const rolActualBody = (u) => {
        if (!u.rolCalidad) {
            return <Tag value="Operador (implícito)" severity="info" />;
        }
        return <Tag value={ROL_LABEL[u.rolCalidad]} severity={ROL_SEVERITY[u.rolCalidad]} />;
    };

    const asignarBody = (u) => (
        <Dropdown
            value={u.rolCalidad}
            options={opciones}
            optionLabel="label"
            optionValue="value"
            disabled={savingId === u.id}
            onChange={(e) => onChangeRol(u, e.value)}
            className="w-full"
            itemTemplate={(opt) => (
                <div className="flex flex-column">
                    <span className="font-semibold">{opt.label}</span>
                    <small className="text-color-secondary">{opt.descripcion}</small>
                </div>
            )}
        />
    );

    return (
        <div className="flex flex-column w-full p-3">
            {/* Banner de wizard pausado */}
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

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <PageHeader
                    icon="fa-solid fa-user-shield"
                    title="Roles de Calidad"
                    subtitle="Asigná autoridad de aprobación, edición de parámetros y firma de certificados a cada usuario que tenga acceso al módulo."
                />
                <Button
                    label="Configurar"
                    icon="fa-solid fa-wand-magic-sparkles"
                    size="small"
                    outlined
                    severity="success"
                    className="mant-wizard-btn"
                    onClick={() => setSetupWizardVisible(true)}
                    tooltip="Asistente paso a paso para entender cómo funcionan los roles de Calidad"
                    tooltipOptions={{ position: 'left' }}
                />
            </div>

            <WizardRolesCalidad
                visible={setupWizardVisible}
                onClose={() => setSetupWizardVisible(false)}
                onFinish={() => { setSetupWizardVisible(false); fetchUsers(); }}
            />

            <div className="roles-cal-info-box" role="note">
                <i className="fa-solid fa-circle-info roles-cal-info-box-icon" aria-hidden="true" />
                <div className="roles-cal-info-box-text">
                    <strong>Cómo funciona.</strong> El árbol de Cuentas de usuario sigue controlando qué pantallas ve y qué CRUD puede hacer cada usuario.
                    El rol de Calidad es un <em>segundo gate</em> que habilita acciones de autoridad: aprobar dosificaciones, transicionar pastones,
                    editar parámetros de planta y firmar certificados. Si un usuario no tiene árbol en Calidad, el rol no le da permisos extra.
                </div>
            </div>

            <div className="flex justify-content-between align-items-center mb-3 mt-2 gap-2 flex-wrap">
                <span className="p-input-icon-left flex-1" style={{ minWidth: 240 }}>
                    <i className="pi pi-search" />
                    <InputText
                        value={filtro}
                        onChange={(e) => setFiltro(e.target.value)}
                        placeholder="Buscar por usuario, nombre o empleado…"
                        className="w-full"
                    />
                </span>
                <small className="text-color-secondary">
                    {usersFiltrados.length} de {users.length} usuario(s) con acceso a Calidad
                </small>
            </div>

            {loading ? (
                <div className="flex justify-content-center py-5">
                    <LoadSpinner />
                </div>
            ) : users.length === 0 ? (
                <Message
                    severity="warn"
                    style={{ width: '100%' }}
                    text="Ningún usuario tiene aún acceso al módulo Calidad. Asigná permisos de menú desde Administrar → Cuentas de usuario."
                />
            ) : (
                <DataTable
                    value={usersFiltrados}
                    dataKey="id"
                    paginator
                    rows={20}
                    rowsPerPageOptions={[10, 20, 50]}
                    responsiveLayout="stack"
                    breakpoint="960px"
                    emptyMessage="Sin coincidencias para el filtro."
                >
                    <Column header="Usuario" body={usuarioBody} style={{ minWidth: 180 }} />
                    <Column header="Empleado vinculado" body={empleadoBody} style={{ minWidth: 200 }} />
                    <Column header="Rol actual" body={rolActualBody} style={{ minWidth: 180 }} />
                    <Column header="Asignar" body={asignarBody} style={{ minWidth: 280 }} />
                </DataTable>
            )}
        </div>
    );
};

export default RolesCalidadPage;
