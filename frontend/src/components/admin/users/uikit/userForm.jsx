import React, { useEffect, useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Checkbox } from 'primereact/checkbox';
import { InputSwitch } from 'primereact/inputswitch';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { config } from '../../../../config/config';
import { useToast } from '../../../../context/ToastContext';
import { Fade } from 'react-awesome-reveal';
import { useUserContext } from '../../../../context/UserContext';
import NonPerm from '../../../../common/components/nonperm/nonperm';
import { Dropdown } from 'primereact/dropdown';
import { MultiSelect } from 'primereact/multiselect';
import MenuPermTree from './menuPermTree';
import LoadSpinner from '../../../../common/components/loadspinner/LoadSpinner';
import './userForm.css';

export default function UsersForm() {
    const { id } = useParams();
    const isEdit = Boolean(id);
    const navigate = useNavigate();
    const toast = useToast();
    const { hasPermission } = useUserContext();

    const [loading, setLoading] = useState(false);
    const [dataLoading, setDataLoading] = useState(false);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [lastname, setLastname] = useState('');
    const [hidden, setHidden] = useState('');
    const [empleados, setEmpleados] = useState([]);
    const [idEmpleado, setIdEmpleado] = useState(null);
    const [plantas, setPlantas] = useState([]);
    const [plantaIds, setPlantaIds] = useState([]);
    const [allPlantas, setAllPlantas] = useState(false);
    const [soloObra, setSoloObra] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminCreateModify, setAdminCreateModify] = useState(false);
    const [adminDelete, setAdminDelete] = useState(false);
    const [prodCreateModify, setProdCreateModify] = useState(false);
    const [prodDelete, setProdDelete] = useState(false);
    const [menuPerms, setMenuPerms] = useState({});

    // Refactor roles 2026-05-20 — la "autoridad del sistema" tiene un solo
    // toggle: Administrador. El concepto de "Cliente externo" se postergó
    // (no hay portal cliente activo) y se reanalizará cuando aparezca un
    // caso de uso concreto. La jerarquía por módulo (Calidad / Flota /
    // Mantenimiento) se administra en Configuración → Administración de
    // Roles, no acá.

    const mapOpt = (arr, l, v) => arr.map((o) => ({ label: o[l], value: o[v] }));

    useEffect(() => {
        if (!isEdit) return;
        setDataLoading(true);
        axios.get(`${config.backendUrl}/api/users/${id}`, { headers: config.headers })
            .then(res => {
                const u = res.data;
                setUsername(u.username);
                setName(u.name);
                setLastname(u.lastname);
                setIsAdmin(u.isAdmin);
                setAdminCreateModify(u.adminCreateModify);
                setAdminDelete(u.adminDelete);
                setProdCreateModify(u.prodCreateModify);
                setProdDelete(u.prodDelete);
                setHidden(u.hidden);
                setIdEmpleado(u.empleado.idEmpleado);
                setPlantaIds(u.plantas?.map(p => Number(p.idPlanta)) || []);
                setAllPlantas(u.allPlantas);
                setSoloObra(u.soloObra ?? false);
                setMenuPerms(u.menuPerms || {});
            })
            .catch(() => toast('error', 'No se pudo cargar el usuario'))
            .finally(setDataLoading(false));
    }, [id]);

    useEffect(() => {
        getEmpleados();
        getPlantas();
    }, [])

    const getEmpleados = async () => {
        try {
            const response = await axios.get(`${config.backendUrl}/api/empleados`, { headers: config.headers });
            setEmpleados(response.data.map((e) => ({ ...e, fullName: `${e.apellido}, ${e.nombre}` })));
        } catch (error) {
            console.error(error);
            toast('error', 'No se pudieron cargar los empleados');
        }
    }
    const getPlantas = async () => {
        try {
            const response = await axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers });
            setPlantas(response.data || []);
        } catch (error) {
            console.error(error);
            toast('error', 'No se pudieron cargar las plantas');
        }
    }
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true)
        if (!username || (!isEdit && !password) || !idEmpleado || (!allPlantas && plantaIds == [])) {
            return toast('warn', 'Completa todos los campos obligatorios');
        }

        const payload = {
            username,
            ...(password && { password }),
            name,
            lastname,
            isAdmin,
            adminCreateModify,
            adminDelete,
            prodCreateModify,
            prodDelete,
            idEmpleado,
            allPlantas,
            plantaIds,
            soloObra,
            accesoAgente: false,
            menuPerms,
        };
        try {
            if (isEdit) {
                await axios.put(`${config.backendUrl}/api/users/${id}`, payload, { headers: config.headers });
                toast('success', 'Usuario actualizado');
            } else {
                await axios.post(`${config.backendUrl}/api/users`, payload, { headers: config.headers });
                toast('success', 'Usuario creado');
            }
            navigate('/admin/usuarios');
        } catch (err) {
            const msg = err.response?.data?.error || 'Error al guardar';
            toast('error', msg);
        } finally {
            setLoading(false);
        }
    };

    const disableOthers = isAdmin;
    if (!hasPermission('ADMIN')) {
        return <NonPerm />
    }

    if (dataLoading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }
    return (
        <Fade direction="up" duration={500} triggerOnce >
            <div className='user-form-container'>
                <div className="user-form-header">
                    <div className="flex align-items-center gap-3">
                        <div className="header-icon-wrapper">
                            <i className={`fa-solid ${isEdit ? 'fa-user-pen' : 'fa-user-plus'}`} />
                        </div>
                        <div>
                            <h2 className="m-0">{isEdit ? "Editar usuario" : "Nuevo usuario"}</h2>
                            <small className="text-color-secondary">
                                {isEdit ? "Modifica la información del usuario" : "Crea un nuevo usuario del sistema"}
                            </small>
                        </div>
                    </div>
                    <Button
                        icon="fa-solid fa-arrow-left"
                        text
                        rounded
                        className="back-button"
                        onClick={() => navigate("/admin/usuarios")}
                        tooltip="Volver al listado"
                        tooltipOptions={{ position: 'left' }}
                    />
                </div>

                <div className="user-form-content">
                    <form onSubmit={handleSubmit} autoComplete="off">
                        {/* Honeypot para frenar autofill agresivo de password
                            managers (Chrome ignora autoComplete="off" en
                            login-shaped forms y autofillea las credenciales del
                            propio admin sobre el form). Estos inputs falsos
                            absorben el autofill y quedan ocultos. */}
                        <input
                            type="text"
                            name="fake-username"
                            autoComplete="username"
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
                        />
                        <input
                            type="password"
                            name="fake-password"
                            autoComplete="current-password"
                            tabIndex={-1}
                            aria-hidden="true"
                            style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
                        />
                        {/* Sección: Información básica */}
                        <div className="form-section">
                            <div className="section-header">
                                <i className="fa-solid fa-id-card section-icon"></i>
                                <h3>Información básica</h3>
                            </div>
                            <div className="section-content">
                                <div className="p-fluid formgrid grid">
                                    <div className="field col-12 md:col-6">
                                        <label htmlFor="username" className="form-label">
                                            <span className="required-mark">*</span> Usuario
                                        </label>
                                        <InputText
                                            id="username"
                                            name="hq-admin-username"
                                            autoComplete="off"
                                            value={username}
                                            onChange={e => setUsername(e.target.value)}
                                        />
                                    </div>
                                    {!hidden && (
                                        <div className="field col-12 md:col-6">
                                            <label htmlFor="password" className="form-label">
                                                <span className="required-mark">*</span> Contraseña
                                            </label>
                                            <Password
                                                id="password"
                                                inputId="password"
                                                name="hq-admin-new-password"
                                                autoComplete="new-password"
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
                                                feedback={false}
                                                toggleMask
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Sección: Empleado y plantas */}
                        <div className="form-section">
                            <div className="section-header">
                                <i className="fa-solid fa-building section-icon"></i>
                                <h3>Asignación de empleado y plantas</h3>
                            </div>
                            <div className="section-content">
                                <div className="p-fluid formgrid grid">
                                    <div className="field col-12 md:col-6">
                                        <label htmlFor="empleado" className="form-label">
                                            <span className="required-mark">*</span> Empleado
                                        </label>
                                        <Dropdown 
                                            id="empleado"
                                            showClear 
                                            value={idEmpleado} 
                                            onChange={(e) => setIdEmpleado(e.value)} 
                                            options={mapOpt(empleados, "fullName", "idEmpleado")} 
                                            filter 
                                        />
                                        <div className="flex align-items-center mt-3">
                                            <Checkbox
                                                inputId="soloObra"
                                                checked={soloObra}
                                                onChange={e => setSoloObra(e.checked)}
                                                className='mr-2'
                                            />
                                            <label htmlFor="soloObra" className="checkbox-label">
                                                Solo empleados de obra
                                            </label>
                                        </div>
                                    </div>
                                    <div className="field col-12 md:col-6">
                                        <div className='flex align-items-center justify-content-between mb-2'>
                                            <label htmlFor="plantas" className="form-label">
                                                <span className="required-mark">*</span> Plantas
                                            </label>
                                            <div className='flex align-items-center'>
                                                <Checkbox 
                                                    inputId="allPlantas" 
                                                    checked={allPlantas} 
                                                    onChange={e => setAllPlantas(e.checked)} 
                                                    className='mr-2' 
                                                />
                                                <label htmlFor="allPlantas" className="checkbox-label">Todas</label>
                                            </div>
                                        </div>
                                        <MultiSelect
                                            id="plantas"
                                            value={plantaIds}
                                            onChange={(e) => setPlantaIds(e.value)}
                                            options={plantas}
                                            optionLabel="nombre"
                                            optionValue="idPlanta"
                                            placeholder="Seleccionar plantas..."
                                            className="w-full"
                                            disabled={allPlantas}
                                            display="chip"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Sección: Autoridad del sistema (refactor 2026-05-20).
                            Un solo toggle: Administrador. El bypass total es el único
                            caso extremo necesario por ahora. Para permisos intermedios
                            se usa el árbol de "Sistema de permisos" abajo, y la
                            jerarquía dentro de cada módulo se administra en
                            Configuración → Administración de Roles. */}
                        <div className="form-section">
                            <div className="section-header">
                                <i className="fa-solid fa-user-shield section-icon"></i>
                                <h3>Autoridad del sistema</h3>
                            </div>
                            <div className="section-content">
                                <Message
                                    severity="info"
                                    className="w-full mb-3"
                                    content={
                                        <div className="text-sm" style={{ lineHeight: 1.6 }}>
                                            <strong className="block mb-2">Tildalo solo si esta persona administra la cuenta de la empresa.</strong>
                                            <p className="m-0 mb-2">
                                                Para usuarios con permisos intermedios <strong>dejá la opción apagada</strong> y definí qué pueden hacer en:
                                            </p>
                                            <ul className="m-0 pl-4">
                                                <li>
                                                    <strong>Sistema de permisos</strong> (sección de abajo) — qué
                                                    pantallas ve y qué puede crear / editar / borrar en cada una.
                                                </li>
                                                <li>
                                                    <strong>Administración de Roles</strong> (en Configuración) —
                                                    nivel dentro de cada módulo (cargador, supervisor, aprobador)
                                                    para acciones como aprobar dosificaciones o firmar certificados.
                                                </li>
                                            </ul>
                                        </div>
                                    }
                                />
                                <div className="p-fluid formgrid grid">
                                    <div className="field col-12">
                                        <div className="flex align-items-start gap-3">
                                            <InputSwitch
                                                inputId="isAdmin"
                                                checked={isAdmin}
                                                onChange={(e) => setIsAdmin(e.value)}
                                            />
                                            <div className="flex-1">
                                                <label htmlFor="isAdmin" className="font-semibold cursor-pointer block">
                                                    Administrador de la empresa
                                                </label>
                                                <small className="text-color-secondary block mt-1">
                                                    Acceso total al sistema. <strong>Ignora cualquier permiso
                                                    configurado abajo</strong> y puede entrar, modificar o borrar
                                                    en todas las pantallas. Reservar solo para quienes administran
                                                    la cuenta de la empresa.
                                                </small>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>


                        {/* Sección: Sistema de permisos (Ver / Crear / Editar / Borrar
                            por módulo). Es el sistema activo en producción y controla
                            qué puede hacer cada usuario en cada pantalla. */}
                        <div className="form-section permissions-section">
                            <div className="section-header">
                                <i className="fa-solid fa-shield-halved section-icon"></i>
                                <h3>Sistema de permisos</h3>
                            </div>
                            <div className="section-content">
                                <small className="text-color-secondary block mb-3">
                                    Configurá los permisos específicos para cada módulo del sistema.
                                </small>
                                <MenuPermTree value={menuPerms} onChange={setMenuPerms} />
                            </div>
                        </div>

                        {/* Botón de guardar */}
                        <div className='form-actions'>
                            <Button 
                                label="Cancelar" 
                                icon="fa-solid fa-xmark" 
                                type="button" 
                                severity="secondary"
                                onClick={() => navigate("/admin/usuarios")} 
                                rounded 
                                size='small' 
                            />
                            <Button 
                                label={isEdit ? "Actualizar usuario" : "Crear usuario"} 
                                icon="fa-solid fa-check" 
                                type="submit" 
                                loading={loading} 
                                rounded 
                                size='small' 
                            />
                        </div>
                    </form>
                </div>
            </div>
        </Fade>
    );
}