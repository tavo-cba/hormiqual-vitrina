'use strict';

/**
 * flotaGates.js — Engine puro de gates de autoridad para el módulo Flota.
 *
 * Espejo del patrón de `calidadGates.js`: dos capas ortogonales de
 * autorización + bypass admin.
 *
 *   1. Árbol de menús (PermisoMenu): primer gate, "qué pantallas ve".
 *   2. Rol de Flota (User.rolFlota): segundo gate, "qué acciones de
 *      autoridad puede ejecutar dentro de Flota".
 *
 * Niveles jerárquicos (nivel mayor incluye permisos del menor):
 *   - FLOTA_OPERADOR  (1): chofer / operador. Registra cargas de combustible
 *                          en su vehículo, ve sus equipos asignados.
 *   - FLOTA_SUPERVISOR (2): supervisor / despachador. Asigna choferes,
 *                          planifica despachos, edita registros.
 *   - FLOTA_JEFE      (3): jefe de flota. Da de alta/baja vehículos y
 *                          fuentes; borra registros.
 *
 * Diferencias con calidadGates:
 *   - Ningún gate requiere matrícula profesional.
 *   - Bypass admin completo: ADMIN del sistema puede hacer cualquier
 *     acción de Flota sin asignación explícita de rolFlota.
 *   - Sin caso especial tipo "puedeDesaprobarEnsayo" (KISS).
 */

const ROLES_FLOTA = Object.freeze({
    OPERADOR:   'FLOTA_OPERADOR',
    SUPERVISOR: 'FLOTA_SUPERVISOR',
    JEFE:       'FLOTA_JEFE',
});

const ROLES_FLOTA_LIST = Object.freeze(Object.values(ROLES_FLOTA));

const NIVEL = Object.freeze({
    [ROLES_FLOTA.OPERADOR]:   1,
    [ROLES_FLOTA.SUPERVISOR]: 2,
    [ROLES_FLOTA.JEFE]:       3,
});

const ROL_LABEL = Object.freeze({
    [ROLES_FLOTA.OPERADOR]:   'Operador de Flota',
    [ROLES_FLOTA.SUPERVISOR]: 'Supervisor de Flota',
    [ROLES_FLOTA.JEFE]:       'Jefe de Flota',
});

const ROL_DESCRIPCION = Object.freeze({
    [ROLES_FLOTA.OPERADOR]:
        'Chofer u operador. Registra cargas de combustible, recargas de fuente y datos de uso (km/horas) de sus equipos asignados.',
    [ROLES_FLOTA.SUPERVISOR]:
        'Asigna empleados a equipos, planifica despachos, edita registros existentes y gestiona geocercas / grupos de vehículos.',
    [ROLES_FLOTA.JEFE]:
        'Todo lo anterior + alta/baja de vehículos y fuentes, borrado de registros y configuración de planificación por planta.',
});

// ─── Helpers de chequeo (espejos del patrón calidadGates) ─────────────────

function rolFlotaDe(user) {
    if (!user) return null;
    const r = user.rolFlota;
    if (r && ROLES_FLOTA_LIST.includes(r)) return r;
    return null;
}

function nivelDe(user) {
    if (!user) return 0;
    const r = rolFlotaDe(user);
    if (r) return NIVEL[r];
    // Sin rol asignado: nivel 0 (no asume OPERADOR implícito porque queremos
    // que la asignación sea explícita — el chofer no opera Flota sin que un
    // admin lo dé de alta como FLOTA_OPERADOR).
    return 0;
}

function tieneRolMinimo(user, rolMinimo) {
    if (!user || !ROLES_FLOTA_LIST.includes(rolMinimo)) return false;
    if (!!user.isAdmin) return true; // bypass admin completo
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

/**
 * True si el user tiene al menos un check (cualquier acción) en algún menú
 * de Flota. Usado por la pantalla de asignación de roles para mostrar sólo
 * candidatos que ya tienen acceso al módulo.
 */
function tieneAccesoAModuloFlota(user, menusFlotaIds) {
    if (!user || !Array.isArray(menusFlotaIds) || menusFlotaIds.length === 0) return false;
    if (!!user.isAdmin) return true;
    for (const id of menusFlotaIds) {
        if (
            tienePermisoArbol(user, id, 'ver') ||
            tienePermisoArbol(user, id, 'crear') ||
            tienePermisoArbol(user, id, 'editar') ||
            tienePermisoArbol(user, id, 'borrar')
        ) return true;
    }
    return false;
}

// ─── Catálogo de acciones de Flota ────────────────────────────────────────

const ACCIONES = Object.freeze({
    // Combustible
    REGISTRAR_COMBUSTIBLE:           'REGISTRAR_COMBUSTIBLE',
    EDITAR_REGISTRO_COMBUSTIBLE:     'EDITAR_REGISTRO_COMBUSTIBLE',
    BORRAR_REGISTRO_COMBUSTIBLE:     'BORRAR_REGISTRO_COMBUSTIBLE',
    RECARGAR_FUENTE:                 'RECARGAR_FUENTE',
    CREAR_FUENTE:                    'CREAR_FUENTE',
    EDITAR_FUENTE:                   'EDITAR_FUENTE',
    BORRAR_FUENTE:                   'BORRAR_FUENTE',
    // Vehículos / equipos
    ALTA_VEHICULO:                   'ALTA_VEHICULO',
    EDITAR_VEHICULO:                 'EDITAR_VEHICULO',
    BAJA_VEHICULO:                   'BAJA_VEHICULO',
    ASIGNAR_CHOFER:                  'ASIGNAR_CHOFER',
    // Matafuegos
    CREAR_MATAFUEGO:                 'CREAR_MATAFUEGO',
    EDITAR_MATAFUEGO:                'EDITAR_MATAFUEGO',
    BORRAR_MATAFUEGO:                'BORRAR_MATAFUEGO',
    // Planificación de despachos
    PROGRAMAR_DESPACHO:              'PROGRAMAR_DESPACHO',
    EDITAR_PLANIFICACION:            'EDITAR_PLANIFICACION',
    BORRAR_PLANIFICACION:            'BORRAR_PLANIFICACION',
    CONFIGURAR_PLANTA_PLANIFICACION: 'CONFIGURAR_PLANTA_PLANIFICACION',
    // Trazabilidad GPS (Geolocker)
    GESTIONAR_GEOCERCA:              'GESTIONAR_GEOCERCA',
    GESTIONAR_GRUPO_VEHICULOS:       'GESTIONAR_GRUPO_VEHICULOS',
    GESTIONAR_LINK_COMPARTIDO:       'GESTIONAR_LINK_COMPARTIDO',
});

const REQUISITOS = Object.freeze({
    // Combustible — el chofer registra; supervisor edita; jefe borra.
    [ACCIONES.REGISTRAR_COMBUSTIBLE]:           { rolMinimo: ROLES_FLOTA.OPERADOR,   accionArbol: 'crear'  },
    [ACCIONES.EDITAR_REGISTRO_COMBUSTIBLE]:     { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.BORRAR_REGISTRO_COMBUSTIBLE]:     { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'borrar' },
    [ACCIONES.RECARGAR_FUENTE]:                 { rolMinimo: ROLES_FLOTA.OPERADOR,   accionArbol: 'editar' },
    [ACCIONES.CREAR_FUENTE]:                    { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_FUENTE]:                   { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.BORRAR_FUENTE]:                   { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'borrar' },
    // Vehículos
    [ACCIONES.ALTA_VEHICULO]:                   { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'crear'  },
    [ACCIONES.EDITAR_VEHICULO]:                 { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.BAJA_VEHICULO]:                   { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'borrar' },
    [ACCIONES.ASIGNAR_CHOFER]:                  { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    // Matafuegos
    [ACCIONES.CREAR_MATAFUEGO]:                 { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_MATAFUEGO]:                { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.BORRAR_MATAFUEGO]:                { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'borrar' },
    // Planificación
    [ACCIONES.PROGRAMAR_DESPACHO]:              { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'crear'  },
    [ACCIONES.EDITAR_PLANIFICACION]:            { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.BORRAR_PLANIFICACION]:            { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'borrar' },
    [ACCIONES.CONFIGURAR_PLANTA_PLANIFICACION]: { rolMinimo: ROLES_FLOTA.JEFE,       accionArbol: 'editar' },
    // Geolocker
    [ACCIONES.GESTIONAR_GEOCERCA]:              { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.GESTIONAR_GRUPO_VEHICULOS]:       { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
    [ACCIONES.GESTIONAR_LINK_COMPARTIDO]:       { rolMinimo: ROLES_FLOTA.SUPERVISOR, accionArbol: 'editar' },
});

/**
 * Gate combinado para una acción de Flota.
 * Mismo contrato que `puedeAccionCalidad`.
 */
function puedeAccionFlota(user, accion, ctx = {}) {
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
    ROLES_FLOTA,
    ROLES_FLOTA_LIST,
    NIVEL,
    ROL_LABEL,
    ROL_DESCRIPCION,
    ACCIONES,
    REQUISITOS,
    rolFlotaDe,
    nivelDe,
    tieneRolMinimo,
    tienePermisoArbol,
    tieneAccesoAModuloFlota,
    puedeAccionFlota,
};
