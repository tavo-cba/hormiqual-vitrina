'use strict';

/**
 * mantenimientoGates.js — Engine puro de gates de autoridad para el
 * módulo Mantenimiento.
 *
 * Mismo patrón que `flotaGates.js` (que a su vez espeja `calidadGates.js`):
 * dos capas ortogonales de autorización + bypass admin.
 *
 * Niveles jerárquicos:
 *   - MANT_MECANICO  (1): ejecuta checklists asignados, reporta hallazgos,
 *                          completa mantenimientos planificados.
 *   - MANT_ENCARGADO (2): encargado de taller. Programa mantenimientos,
 *                          asigna mecánicos, autoriza repuestos y crea
 *                          plantillas/categorías de checklist.
 *   - MANT_JEFE      (3): jefe de taller. Borra historiales/plantillas y
 *                          autoriza reparaciones mayores.
 *
 * Bypass admin completo. Sin requisitos de matrícula (los mantenimientos
 * vehiculares no requieren firma profesional como un certificado de
 * Calidad).
 */

const ROLES_MANTENIMIENTO = Object.freeze({
    MECANICO:  'MANT_MECANICO',
    ENCARGADO: 'MANT_ENCARGADO',
    JEFE:      'MANT_JEFE',
});

const ROLES_MANTENIMIENTO_LIST = Object.freeze(Object.values(ROLES_MANTENIMIENTO));

const NIVEL = Object.freeze({
    [ROLES_MANTENIMIENTO.MECANICO]:  1,
    [ROLES_MANTENIMIENTO.ENCARGADO]: 2,
    [ROLES_MANTENIMIENTO.JEFE]:      3,
});

const ROL_LABEL = Object.freeze({
    [ROLES_MANTENIMIENTO.MECANICO]:  'Mecánico',
    [ROLES_MANTENIMIENTO.ENCARGADO]: 'Encargado de Taller',
    [ROLES_MANTENIMIENTO.JEFE]:      'Jefe de Taller',
});

const ROL_DESCRIPCION = Object.freeze({
    [ROLES_MANTENIMIENTO.MECANICO]:
        'Ejecuta checklists asignados, reporta hallazgos y completa mantenimientos programados.',
    [ROLES_MANTENIMIENTO.ENCARGADO]:
        'Programa mantenimientos, asigna mecánicos, autoriza repuestos, gestiona plantillas y categorías de checklist.',
    [ROLES_MANTENIMIENTO.JEFE]:
        'Todo lo anterior + autoriza talleres externos, cierra historiales, borra plantillas y firma aptitud técnica de vehículos.',
});

function rolMantenimientoDe(user) {
    if (!user) return null;
    const r = user.rolMantenimiento;
    if (r && ROLES_MANTENIMIENTO_LIST.includes(r)) return r;
    return null;
}

function nivelDe(user) {
    if (!user) return 0;
    const r = rolMantenimientoDe(user);
    if (r) return NIVEL[r];
    return 0;
}

function tieneRolMinimo(user, rolMinimo) {
    if (!user || !ROLES_MANTENIMIENTO_LIST.includes(rolMinimo)) return false;
    if (!!user.isAdmin) return true;
    return nivelDe(user) >= NIVEL[rolMinimo];
}

function tienePermisoArbol(user, idMenu, accion) {
    if (!user || idMenu == null || !accion) return false;
    if (!!user.isAdmin) return true;
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

function tieneAccesoAModuloMantenimiento(user, menusIds) {
    if (!user || !Array.isArray(menusIds) || menusIds.length === 0) return false;
    if (!!user.isAdmin) return true;
    for (const id of menusIds) {
        if (
            tienePermisoArbol(user, id, 'ver') ||
            tienePermisoArbol(user, id, 'crear') ||
            tienePermisoArbol(user, id, 'editar') ||
            tienePermisoArbol(user, id, 'borrar')
        ) return true;
    }
    return false;
}

// ─── Catálogo de acciones ─────────────────────────────────────────────────

const ACCIONES = Object.freeze({
    // Checklists
    EJECUTAR_CHECKLIST:              'EJECUTAR_CHECKLIST',
    COMPLETAR_CHECKLIST:             'COMPLETAR_CHECKLIST',
    CREAR_CATEGORIA_CHECKLIST:       'CREAR_CATEGORIA_CHECKLIST',
    EDITAR_CATEGORIA_CHECKLIST:      'EDITAR_CATEGORIA_CHECKLIST',
    BORRAR_CATEGORIA_CHECKLIST:      'BORRAR_CATEGORIA_CHECKLIST',
    CREAR_PLANTILLA_CHECKLIST:       'CREAR_PLANTILLA_CHECKLIST',
    EDITAR_PLANTILLA_CHECKLIST:      'EDITAR_PLANTILLA_CHECKLIST',
    BORRAR_PLANTILLA_CHECKLIST:      'BORRAR_PLANTILLA_CHECKLIST',
    // Mantenimiento programado
    PROGRAMAR_MANTENIMIENTO:         'PROGRAMAR_MANTENIMIENTO',
    EDITAR_MANTENIMIENTO_PROGRAMADO: 'EDITAR_MANTENIMIENTO_PROGRAMADO',
    BORRAR_MANTENIMIENTO_PROGRAMADO: 'BORRAR_MANTENIMIENTO_PROGRAMADO',
    COMPLETAR_MANTENIMIENTO:         'COMPLETAR_MANTENIMIENTO',
    AVISAR_EMPLEADO:                 'AVISAR_EMPLEADO',
    // Plantillas y tareas (Items mantenimiento)
    CREAR_PLANTILLA_MANTENIMIENTO:   'CREAR_PLANTILLA_MANTENIMIENTO',
    EDITAR_PLANTILLA_MANTENIMIENTO:  'EDITAR_PLANTILLA_MANTENIMIENTO',
    BORRAR_PLANTILLA_MANTENIMIENTO:  'BORRAR_PLANTILLA_MANTENIMIENTO',
    // Repuestos y taller externo
    AUTORIZAR_REPUESTO:              'AUTORIZAR_REPUESTO',
    AUTORIZAR_TALLER_EXTERNO:        'AUTORIZAR_TALLER_EXTERNO',
    // Historial
    CERRAR_HISTORIAL_MANTENIMIENTO:  'CERRAR_HISTORIAL_MANTENIMIENTO',
    // Cubiertas (sesión 2026-05-11)
    ALTA_CUBIERTA:                   'ALTA_CUBIERTA',
    EDITAR_CUBIERTA:                 'EDITAR_CUBIERTA',
    MONTAR_CUBIERTA:                 'MONTAR_CUBIERTA',
    DESMONTAR_CUBIERTA:              'DESMONTAR_CUBIERTA',
    INSPECCIONAR_CUBIERTA:           'INSPECCIONAR_CUBIERTA',
    REGISTRAR_EVENTO_CUBIERTA:       'REGISTRAR_EVENTO_CUBIERTA',
    DESCARTAR_CUBIERTA:              'DESCARTAR_CUBIERTA',
});

const REQUISITOS = Object.freeze({
    // Checklists (ejecución por mecánico, configuración por encargado)
    [ACCIONES.EJECUTAR_CHECKLIST]:              { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.COMPLETAR_CHECKLIST]:             { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.CREAR_CATEGORIA_CHECKLIST]:       { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_CATEGORIA_CHECKLIST]:      { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.BORRAR_CATEGORIA_CHECKLIST]:      { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'borrar' },
    [ACCIONES.CREAR_PLANTILLA_CHECKLIST]:       { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_PLANTILLA_CHECKLIST]:      { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.BORRAR_PLANTILLA_CHECKLIST]:      { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'borrar' },
    // Mantenimientos programados
    [ACCIONES.PROGRAMAR_MANTENIMIENTO]:         { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_MANTENIMIENTO_PROGRAMADO]: { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.BORRAR_MANTENIMIENTO_PROGRAMADO]: { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'borrar' },
    [ACCIONES.COMPLETAR_MANTENIMIENTO]:         { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.AVISAR_EMPLEADO]:                 { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    // Plantillas de items de mantenimiento (cada cuántos km/h se hace qué)
    [ACCIONES.CREAR_PLANTILLA_MANTENIMIENTO]:   { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_PLANTILLA_MANTENIMIENTO]:  { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.BORRAR_PLANTILLA_MANTENIMIENTO]:  { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'borrar' },
    // Autorizaciones
    [ACCIONES.AUTORIZAR_REPUESTO]:              { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.AUTORIZAR_TALLER_EXTERNO]:        { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'editar' },
    [ACCIONES.CERRAR_HISTORIAL_MANTENIMIENTO]:  { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'editar' },
    // Cubiertas: alta y edición del catálogo por encargado; montaje/
    // desmontaje/inspección por mecánico (trabajo de taller); descarte
    // por jefe (decisión final que da de baja el activo).
    [ACCIONES.ALTA_CUBIERTA]:                   { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_CUBIERTA]:                 { rolMinimo: ROLES_MANTENIMIENTO.ENCARGADO, accionArbol: 'editar' },
    [ACCIONES.MONTAR_CUBIERTA]:                 { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.DESMONTAR_CUBIERTA]:              { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.INSPECCIONAR_CUBIERTA]:           { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.REGISTRAR_EVENTO_CUBIERTA]:       { rolMinimo: ROLES_MANTENIMIENTO.MECANICO,  accionArbol: 'editar' },
    [ACCIONES.DESCARTAR_CUBIERTA]:              { rolMinimo: ROLES_MANTENIMIENTO.JEFE,      accionArbol: 'borrar' },
});

function puedeAccionMantenimiento(user, accion, ctx = {}) {
    if (!user) return { allowed: false, motivo: 'usuario_no_autenticado' };
    const req = REQUISITOS[accion];
    if (!req) return { allowed: false, motivo: 'accion_desconocida' };

    if (!!user.isAdmin) return { allowed: true, motivo: null };

    if (ctx.idMenu != null && req.accionArbol != null) {
        if (!tienePermisoArbol(user, ctx.idMenu, req.accionArbol)) {
            return { allowed: false, motivo: `arbol_sin_permiso_${req.accionArbol}` };
        }
    }

    if (!tieneRolMinimo(user, req.rolMinimo)) {
        return { allowed: false, motivo: `rol_insuficiente_requiere_${req.rolMinimo}` };
    }

    return { allowed: true, motivo: null };
}

module.exports = {
    ROLES_MANTENIMIENTO,
    ROLES_MANTENIMIENTO_LIST,
    NIVEL,
    ROL_LABEL,
    ROL_DESCRIPCION,
    ACCIONES,
    REQUISITOS,
    rolMantenimientoDe,
    nivelDe,
    tieneRolMinimo,
    tienePermisoArbol,
    tieneAccesoAModuloMantenimiento,
    puedeAccionMantenimiento,
};
