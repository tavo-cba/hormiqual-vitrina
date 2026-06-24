'use strict';

/**
 * calidadGates.js — Engine puro de gates de autoridad para el módulo Calidad.
 *
 * Filosofía: dos capas ortogonales de autorización.
 *
 *   1. Árbol de menús (PermisoMenu): "qué pantallas ve y qué CRUD puede".
 *      Lo administra el admin desde Cuentas de usuario. Sigue siendo el
 *      primer gate.
 *
 *   2. Rol de Calidad (User.rolCalidad): "qué acciones de autoridad puede
 *      ejecutar dentro de Calidad". Es un segundo gate, ADITIVO.
 *
 * Resultado: una acción se permite SOLO si pasa AMBAS capas. Esto evita
 * dos clases de bugs:
 *   - Exceso: alguien con rol DIRECTOR_TECNICO pero sin árbol de Calidad
 *     no puede hacer nada (el árbol falla). Nunca se "filtra" por el rol.
 *   - Defecto: usuarios actuales con árbol siguen pudiendo ver/crear/editar
 *     como antes; sólo pierden las acciones de autoridad si no tienen rol.
 *
 * Bypass único: User.isAdmin (flag legacy). El admin del sistema puede
 * APROBAR todo, pero NO puede FIRMAR certificados sin rol DT explícito —
 * la firma de certificados requiere matrícula declarada en el empleado,
 * que es un acto físico/legal, no un permiso de software.
 */

const ROLES_CALIDAD = Object.freeze({
    OPERADOR:            'OPERADOR',
    RESPONSABLE_CALIDAD: 'RESPONSABLE_CALIDAD',
    DIRECTOR_TECNICO:    'DIRECTOR_TECNICO',
});

const ROLES_CALIDAD_LIST = Object.freeze(Object.values(ROLES_CALIDAD));

/**
 * Jerarquía implícita: nivel mayor incluye los permisos del menor.
 * OPERADOR < RESPONSABLE_CALIDAD < DIRECTOR_TECNICO.
 */
const NIVEL = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:            1,
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]: 2,
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:    3,
});

const ROL_LABEL = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:            'Operador de Calidad',
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]: 'Responsable de Calidad',
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:    'Director Técnico',
});

const ROL_DESCRIPCION = Object.freeze({
    [ROLES_CALIDAD.OPERADOR]:
        'Carga ensayos y mediciones; propone diseños. NO aprueba transiciones a producción ni firma certificados.',
    [ROLES_CALIDAD.RESPONSABLE_CALIDAD]:
        'Aprueba dosificaciones a producción, suspende y archiva. Edita parámetros de planta y mezclas.',
    [ROLES_CALIDAD.DIRECTOR_TECNICO]:
        'Todo lo anterior + firma certificados de aptitud. Requiere matrícula declarada en el empleado.',
});

/**
 * Devuelve el rol de Calidad efectivo del user (string o null si OPERADOR
 * implícito).
 */
function rolCalidadDe(user) {
    if (!user) return null;
    const r = user.rolCalidad;
    if (r && ROLES_CALIDAD_LIST.includes(r)) return r;
    return null;
}

/**
 * Devuelve el nivel jerárquico del user (1 mínimo, 3 máximo, 0 si no aplica).
 * NULL → 1 (OPERADOR implícito).
 */
function nivelDe(user) {
    if (!user) return 0;
    const r = rolCalidadDe(user);
    if (r) return NIVEL[r];
    return NIVEL[ROLES_CALIDAD.OPERADOR];
}

/**
 * True si el user tiene rol >= mínimo requerido (jerárquico).
 * Acepta isAdmin como bypass para roles <= RESPONSABLE_CALIDAD; para
 * DIRECTOR_TECNICO se requiere asignación explícita siempre.
 */
function tieneRolMinimo(user, rolMinimo) {
    if (!user || !ROLES_CALIDAD_LIST.includes(rolMinimo)) return false;
    if (rolMinimo === ROLES_CALIDAD.DIRECTOR_TECNICO) {
        // Firma de certificados: SOLO con asignación explícita DT, sin bypass.
        return rolCalidadDe(user) === ROLES_CALIDAD.DIRECTOR_TECNICO;
    }
    if (!!user.isAdmin) return true;
    return nivelDe(user) >= NIVEL[rolMinimo];
}

/**
 * Lee un permiso del árbol de menús del user. Acepta dos shapes:
 *   - user.menuPerms[idMenu] = { puedeVer, puedeCrear, puedeEditar, puedeBorrar }
 *   - user.permisos[idMenu]  = idem
 *   - user.menuPerms = array de filas → se normaliza al objeto.
 *
 * Si el user no tiene el árbol cargado, devuelve false (gate fail-closed).
 *
 * @param {Object} user
 * @param {number|string} idMenu
 * @param {'ver'|'crear'|'editar'|'borrar'} accion
 */
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
 * True si el user tiene AL MENOS UN permiso (cualquier acción) en alguno
 * de los menús de Calidad. Útil para listar "candidatos" en la pantalla
 * de asignación de roles — sólo aparecen usuarios que ya tienen acceso
 * efectivo al módulo.
 *
 * @param {Object} user
 * @param {number[]} menusCalidadIds - IDs de los submenús de Calidad
 */
function tieneAccesoAModuloCalidad(user, menusCalidadIds) {
    if (!user || !Array.isArray(menusCalidadIds) || menusCalidadIds.length === 0) return false;
    if (!!user.isAdmin) return true;
    for (const id of menusCalidadIds) {
        if (
            tienePermisoArbol(user, id, 'ver') ||
            tienePermisoArbol(user, id, 'crear') ||
            tienePermisoArbol(user, id, 'editar') ||
            tienePermisoArbol(user, id, 'borrar')
        ) return true;
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Catálogo de gates por acción.
//
// Cada entrada declara: { idMenuRequerido, accionArbol, rolMinimo, requiereMatricula }
// El check combinado es:
//   isAdmin (con limitaciones DT) OR (tienePermisoArbol AND tieneRolMinimo AND ...)
// ─────────────────────────────────────────────────────────────────────────

const ACCIONES = Object.freeze({
    APROBAR_DOSIFICACION:           'APROBAR_DOSIFICACION',
    SUSPENDER_DOSIFICACION:         'SUSPENDER_DOSIFICACION',
    ARCHIVAR_DOSIFICACION:          'ARCHIVAR_DOSIFICACION',
    EDITAR_PARAMETROS_PLANTA:       'EDITAR_PARAMETROS_PLANTA',
    EDITAR_PARAMETROS_MEZCLA:       'EDITAR_PARAMETROS_MEZCLA',
    APROBAR_PASTON_PRODUCCION:      'APROBAR_PASTON_PRODUCCION',
    FIRMAR_CERTIFICADO:             'FIRMAR_CERTIFICADO',
    EMITIR_CERTIFICADO:             'EMITIR_CERTIFICADO',
    // Sprint 2 (sesión 2026-05-10) — revisión de ensayos de resistencia.
    // IRAM 1666:2020 §A.7.10 (autocontrol del productor) + ISO 17025
    // §7.8 (control de informes).
    APROBAR_ENSAYO:                 'APROBAR_ENSAYO',
    APROBAR_ENSAYO_MASIVO:          'APROBAR_ENSAYO_MASIVO',
    APROBAR_ENSAYO_MASIVO_CON_DESVIOS: 'APROBAR_ENSAYO_MASIVO_CON_DESVIOS',
    DESAPROBAR_ENSAYO:              'DESAPROBAR_ENSAYO',
    CAMBIAR_CONFIG_APROBACION_AUTOMATICA: 'CAMBIAR_CONFIG_APROBACION_AUTOMATICA',
});

/**
 * Tabla de requisitos por acción. `accionArbol` indica qué celda del árbol
 * se chequea sobre `idMenu`. Si `idMenu` es null (no aplica una pantalla
 * concreta), se omite el gate de árbol y queda sólo el gate de rol.
 */
const REQUISITOS = Object.freeze({
    [ACCIONES.APROBAR_DOSIFICACION]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.SUSPENDER_DOSIFICACION]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.ARCHIVAR_DOSIFICACION]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.EDITAR_PARAMETROS_PLANTA]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.EDITAR_PARAMETROS_MEZCLA]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.APROBAR_PASTON_PRODUCCION]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    [ACCIONES.EMITIR_CERTIFICADO]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'crear',
    },
    [ACCIONES.FIRMAR_CERTIFICADO]: {
        rolMinimo: ROLES_CALIDAD.DIRECTOR_TECNICO,
        accionArbol: 'editar',
        requiereMatricula: true,
    },
    // Sprint 2 — revisión de ensayos.
    // APROBAR_ENSAYO: aprobación individual de un ensayo de resistencia
    // (uno por vez). El revisor firma asumiendo la responsabilidad
    // técnica de validación (IRAM 1666:2020 §A.7.10).
    [ACCIONES.APROBAR_ENSAYO]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    // APROBAR_ENSAYO_MASIVO: aprobación en lote de ensayos cuyo
    // resultado cae dentro del rango esperado para la edad ("verdes").
    // Mismo nivel que la individual: el RC firma el lote pero todos los
    // ensayos deben ser conformes.
    [ACCIONES.APROBAR_ENSAYO_MASIVO]: {
        rolMinimo: ROLES_CALIDAD.RESPONSABLE_CALIDAD,
        accionArbol: 'editar',
    },
    // APROBAR_ENSAYO_MASIVO_CON_DESVIOS: aprobación en lote de ensayos
    // que incluyen al menos uno fuera del rango esperado (naranja/rojo).
    // Sube a DT por la responsabilidad técnica adicional de validar
    // resultados no conformes en lote (ACI 318 §26.12 — resultados no
    // conformes requieren investigación documentada del firmante técnico).
    [ACCIONES.APROBAR_ENSAYO_MASIVO_CON_DESVIOS]: {
        rolMinimo: ROLES_CALIDAD.DIRECTOR_TECNICO,
        accionArbol: 'editar',
    },
    // DESAPROBAR_ENSAYO: revertir una aprobación previa. Por defecto
    // requiere DT, pero el RC que aprobó originalmente también puede
    // desaprobarse a sí mismo (se chequea separadamente en el service
    // contra `idAprobadoPor === user.idEmpleado`). Esa excepción está
    // en `puedeDesaprobarEnsayo` abajo, no en este REQUISITOS.
    [ACCIONES.DESAPROBAR_ENSAYO]: {
        rolMinimo: ROLES_CALIDAD.DIRECTOR_TECNICO,
        accionArbol: 'editar',
    },
    // CAMBIAR_CONFIG_APROBACION_AUTOMATICA: desactivar la revisión humana
    // es un cambio de protocolo de control de calidad. IRAM 1666 §A.7
    // (segregación de funciones) — debería requerir DT.
    [ACCIONES.CAMBIAR_CONFIG_APROBACION_AUTOMATICA]: {
        rolMinimo: ROLES_CALIDAD.DIRECTOR_TECNICO,
        accionArbol: null,  // no se mapea a un menú concreto; gate puro de rol
    },
});

/**
 * Evalúa un gate combinado para una acción del catálogo.
 *
 * @param {Object} user - shape: { isAdmin, rolCalidad, menuPerms, empleado? }
 * @param {string} accion - una de ACCIONES.*
 * @param {Object} ctx - { idMenu?, empleadoTieneMatricula? }
 * @returns {{ allowed: boolean, motivo: string|null }}
 */
function puedeAccionCalidad(user, accion, ctx = {}) {
    if (!user) return { allowed: false, motivo: 'usuario_no_autenticado' };
    const req = REQUISITOS[accion];
    if (!req) return { allowed: false, motivo: 'accion_desconocida' };

    // Bypass admin para acciones que no requieren matrícula.
    if (!!user.isAdmin && !req.requiereMatricula) {
        return { allowed: true, motivo: null };
    }

    // Gate 1: árbol de menús. Si idMenu no se provee O si la acción
    // declara `accionArbol: null` (gate puro de rol, ej. cambio de
    // configuración global), se omite.
    if (ctx.idMenu != null && req.accionArbol != null) {
        if (!tienePermisoArbol(user, ctx.idMenu, req.accionArbol)) {
            return { allowed: false, motivo: `arbol_sin_permiso_${req.accionArbol}` };
        }
    }

    // Gate 2: rol de Calidad jerárquico.
    if (!tieneRolMinimo(user, req.rolMinimo)) {
        return { allowed: false, motivo: `rol_insuficiente_requiere_${req.rolMinimo}` };
    }

    // Gate 3: matrícula (sólo firma de certificados).
    if (req.requiereMatricula && !ctx.empleadoTieneMatricula) {
        return { allowed: false, motivo: 'matricula_no_declarada' };
    }

    return { allowed: true, motivo: null };
}

/**
 * Sprint 2 — caso especial DESAPROBAR_ENSAYO.
 *
 * Reglas combinadas:
 *   1. Si el user es DT (o admin): puede desaprobar cualquier ensayo.
 *   2. Si el user es RC y es la MISMA persona que aprobó originalmente
 *      (idAprobadoPor === user.idEmpleado): puede desaprobar su propia
 *      firma (caso operativo: se equivocó, lo corrige el mismo día).
 *   3. En cualquier otro caso: denegado.
 *
 * `ctx` requiere: { idMenu?, idAprobadoPorOriginal, empleadoTieneMatricula? }
 *
 * Esta excepción se modeló acá (no en REQUISITOS) porque no se reduce a
 * "rolMinimo + accionArbol" — depende del valor del registro.
 */
function puedeDesaprobarEnsayo(user, ctx = {}) {
    if (!user) return { allowed: false, motivo: 'usuario_no_autenticado' };
    const idAprobadoPorOriginal = ctx.idAprobadoPorOriginal;

    // Gate 1: el árbol siempre se chequea (es una acción de pantalla).
    if (ctx.idMenu != null && !tienePermisoArbol(user, ctx.idMenu, 'editar')) {
        return { allowed: false, motivo: 'arbol_sin_permiso_editar' };
    }

    // Caso 1: DT con asignación explícita (o admin como bypass).
    if (!!user.isAdmin) return { allowed: true, motivo: null, via: 'admin' };
    if (rolCalidadDe(user) === ROLES_CALIDAD.DIRECTOR_TECNICO) {
        return { allowed: true, motivo: null, via: 'director_tecnico' };
    }

    // Caso 2: RC que firmó originalmente.
    if (
        tieneRolMinimo(user, ROLES_CALIDAD.RESPONSABLE_CALIDAD) &&
        idAprobadoPorOriginal != null &&
        user.idEmpleado != null &&
        Number(idAprobadoPorOriginal) === Number(user.idEmpleado)
    ) {
        return { allowed: true, motivo: null, via: 'firmante_original' };
    }

    return { allowed: false, motivo: 'rol_insuficiente_o_no_firmante' };
}

module.exports = {
    ROLES_CALIDAD,
    ROLES_CALIDAD_LIST,
    NIVEL,
    ROL_LABEL,
    ROL_DESCRIPCION,
    ACCIONES,
    REQUISITOS,
    rolCalidadDe,
    nivelDe,
    tieneRolMinimo,
    tienePermisoArbol,
    tieneAccesoAModuloCalidad,
    puedeAccionCalidad,
    puedeDesaprobarEnsayo,
};
