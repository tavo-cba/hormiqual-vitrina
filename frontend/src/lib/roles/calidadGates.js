/**
 * calidadGates.js (frontend) — Mirror del backend `domain/roles/calidadGates.js`.
 *
 * Sirve para que la UI oculte/deshabilite botones según el rol y árbol del
 * usuario actual SIN tener que ir al servidor a preguntar. La verdad sigue
 * siendo el backend (re-evalúa en cada endpoint), pero un mirror evita que
 * un Operador vea el botón "Aprobar" y reciba un 403 al hacer click.
 *
 * Mantenerlo sincronizado con el backend. Cualquier cambio de jerarquía,
 * acción nueva o requisito modificado: tocar las dos copias.
 */

export const ROLES_CALIDAD = Object.freeze({
    OPERADOR:            'OPERADOR',
    RESPONSABLE_CALIDAD: 'RESPONSABLE_CALIDAD',
    DIRECTOR_TECNICO:    'DIRECTOR_TECNICO',
});

export const ROLES_CALIDAD_LIST = Object.freeze(Object.values(ROLES_CALIDAD));

export const NIVEL = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:            1,
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]: 2,
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:    3,
});

export const ROL_LABEL = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:            'Operador de Calidad',
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]: 'Responsable de Calidad',
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:    'Director Técnico',
});

export const ROL_DESCRIPCION = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:
        'Carga ensayos y mediciones; propone diseños. NO aprueba transiciones a producción ni firma certificados.',
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]:
        'Aprueba dosificaciones a producción, suspende y archiva. Edita parámetros de planta y mezclas.',
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:
        'Todo lo anterior + firma certificados de aptitud. Requiere matrícula declarada en el empleado.',
});

export const ROL_SEVERITY = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:            'info',
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]: 'success',
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:    'warning',
});

export const ACCIONES = Object.freeze({
    APROBAR_DOSIFICACION:           'APROBAR_DOSIFICACION',
    SUSPENDER_DOSIFICACION:         'SUSPENDER_DOSIFICACION',
    ARCHIVAR_DOSIFICACION:          'ARCHIVAR_DOSIFICACION',
    EDITAR_PARAMETROS_PLANTA:       'EDITAR_PARAMETROS_PLANTA',
    EDITAR_PARAMETROS_MEZCLA:       'EDITAR_PARAMETROS_MEZCLA',
    APROBAR_PASTON_PRODUCCION:      'APROBAR_PASTON_PRODUCCION',
    FIRMAR_CERTIFICADO:             'FIRMAR_CERTIFICADO',
    EMITIR_CERTIFICADO:             'EMITIR_CERTIFICADO',
});

const REQUISITOS = Object.freeze({
    [ACCIONES.APROBAR_DOSIFICACION]:      { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.SUSPENDER_DOSIFICACION]:    { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.ARCHIVAR_DOSIFICACION]:     { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.EDITAR_PARAMETROS_PLANTA]:  { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.EDITAR_PARAMETROS_MEZCLA]:  { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.APROBAR_PASTON_PRODUCCION]: { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'editar' },
    [ACCIONES.EMITIR_CERTIFICADO]:        { rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD, accionArbol: 'crear' },
    [ACCIONES.FIRMAR_CERTIFICADO]:        { rolMinimo: ROLES_CALIDAD.DIRECTOR_TECNICO,   accionArbol: 'editar', requiereMatricula: true },
});

export function rolCalidadDe(user) {
    if (!user) return null;
    const r = user.rolCalidad;
    return r && ROLES_CALIDAD_LIST.includes(r) ? r : null;
}

export function nivelDe(user) {
    if (!user) return 0;
    const r = rolCalidadDe(user);
    return r ? NIVEL[r] : NIVEL[ROLES_CALIDAD.OPERADOR];
}

export function tieneRolMinimo(user, rolMinimo) {
    if (!user || !ROLES_CALIDAD_LIST.includes(rolMinimo)) return false;
    if (rolMinimo === ROLES_CALIDAD.DIRECTOR_TECNICO) {
        return rolCalidadDe(user) === ROLES_CALIDAD.DIRECTOR_TECNICO;
    }
    if (user.isAdmin === true || user.permissions?.esAdmin === true) return true;
    return nivelDe(user) >= NIVEL[rolMinimo];
}

export function tienePermisoArbol(user, idMenu, accion) {
    if (!user || idMenu == null || !accion) return false;
    if (user.isAdmin === true || user.permissions?.esAdmin === true) return true;
    const raw = user.menuPerms || user.permisos || null;
    if (!raw) return false;
    let entry;
    if (Array.isArray(raw)) {
        entry = raw.find((p) => Number(p.idMenu) === Number(idMenu));
    } else {
        entry = raw[idMenu] || raw[String(idMenu)];
    }
    if (!entry) return false;
    switch (accion) {
        case 'ver':    return !!(entry.puedeVer ?? entry.ver);
        case 'crear':  return !!(entry.puedeCrear ?? entry.puedeAgregar ?? entry.crear);
        case 'editar': return !!(entry.puedeEditar ?? entry.editar);
        case 'borrar': return !!(entry.puedeBorrar ?? entry.borrar);
        default:       return false;
    }
}

/**
 * @param {Object} user
 * @param {string} accion - una de ACCIONES.*
 * @param {Object} ctx - { idMenu?, empleadoTieneMatricula? }
 * @returns {{ allowed: boolean, motivo: string|null }}
 */
export function puedeAccionCalidad(user, accion, ctx = {}) {
    if (!user) return { allowed: false, motivo: 'usuario_no_autenticado' };
    const req = REQUISITOS[accion];
    if (!req) return { allowed: false, motivo: 'accion_desconocida' };
    if ((user.isAdmin === true || user.permissions?.esAdmin === true) && !req.requiereMatricula) {
        return { allowed: true, motivo: null };
    }
    if (ctx.idMenu != null && !tienePermisoArbol(user, ctx.idMenu, req.accionArbol)) {
        return { allowed: false, motivo: `arbol_sin_permiso_${req.accionArbol}` };
    }
    if (!tieneRolMinimo(user, req.rolMinimo)) {
        return { allowed: false, motivo: `rol_insuficiente_requiere_${req.rolMinimo}` };
    }
    if (req.requiereMatricula && !ctx.empleadoTieneMatricula) {
        return { allowed: false, motivo: 'matricula_no_declarada' };
    }
    return { allowed: true, motivo: null };
}
