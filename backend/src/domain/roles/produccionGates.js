'use strict';

/**
 * produccionGates.js — Engine puro de gates de autoridad para el módulo Producción.
 *
 * Filosofía: mismo patrón ortogonal que `calidadGates.js`.
 *
 *   1. Árbol de menús (PermisoMenu): "qué pantallas ve y qué CRUD puede".
 *      Primer gate. Se administra desde Cuentas de usuario.
 *
 *   2. Rol de Producción (User.rolProduccion): "qué acciones puede ejecutar
 *      dentro del módulo". Segundo gate, ADITIVO.
 *
 * Una acción se permite solo si pasa AMBAS capas. Bypass único: User.isAdmin.
 *
 * A diferencia de Calidad (jerarquía Operador < RC < DT), Producción tiene dos
 * roles COMPLEMENTARIOS (no jerárquicos):
 *   - COORDINADOR: planifica — crea/edita/borra pedidos y despachos.
 *   - PLANTISTA:  ejecuta — reordena la cola, envía a Betonmatic, "trae de
 *                 vuelta" un despacho enviado para que el coordinador modifique.
 *
 * Una acción puede requerir UNO de los dos roles (lista de roles permitidos).
 */

const ROLES_PRODUCCION = Object.freeze({
    COORDINADOR: 'COORDINADOR',
    PLANTISTA:   'PLANTISTA',
});

const ROLES_PRODUCCION_LIST = Object.freeze(Object.values(ROLES_PRODUCCION));

const ROL_LABEL = Object.freeze({
    [ROLES_PRODUCCION.COORDINADOR]: 'Coordinador',
    [ROLES_PRODUCCION.PLANTISTA]:   'Plantista',
});

const ROL_DESCRIPCION = Object.freeze({
    [ROLES_PRODUCCION.COORDINADOR]:
        'Crea, edita y borra pedidos y despachos. Define qué se va a producir y para quién. No reordena la cola del plantista ni envía directamente a Betonmatic.',
    [ROLES_PRODUCCION.PLANTISTA]:
        'Ejecuta la producción: reordena la cola de pendientes, envía despachos a Betonmatic, y "trae de vuelta" un despacho ya enviado para que el coordinador lo modifique. No crea ni edita despachos.',
});

/**
 * Catálogo de acciones del módulo Producción — string-enum auto-referencial,
 * mismo patrón que `calidadGates.js`. El VALOR de cada acción es su NOMBRE,
 * para que cualquier consumidor (middlewares, tests, mirror del frontend)
 * pueda usarlo como cadena identificadora sin coercion accidental.
 */
const ACCIONES = Object.freeze({
    CREAR_PEDIDO:           'CREAR_PEDIDO',
    EDITAR_PEDIDO:          'EDITAR_PEDIDO',
    BORRAR_PEDIDO:          'BORRAR_PEDIDO',
    CREAR_DESPACHO:         'CREAR_DESPACHO',
    EDITAR_DESPACHO:        'EDITAR_DESPACHO',
    BORRAR_DESPACHO:        'BORRAR_DESPACHO',
    REORDENAR_PENDIENTES:   'REORDENAR_PENDIENTES',
    ENVIAR_BETONMATIC:      'ENVIAR_BETONMATIC',
    TRAER_DE_VUELTA:        'TRAER_DE_VUELTA',
});

const ACCIONES_LIST = Object.freeze(Object.values(ACCIONES));

/**
 * Mapeo acción → roles permitidos. ADMIN bypasea todas; rol NULL nunca alcanza
 * para ninguna acción.
 */
const ACCION_ROLES = Object.freeze({
    [ACCIONES.CREAR_PEDIDO]:           [ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.EDITAR_PEDIDO]:          [ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.BORRAR_PEDIDO]:          [ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.CREAR_DESPACHO]:         [ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.EDITAR_DESPACHO]:        [ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.BORRAR_DESPACHO]:        [ROLES_PRODUCCION.COORDINADOR],
    // Operación del plantista (compartida con coordinador como respaldo).
    [ACCIONES.REORDENAR_PENDIENTES]:   [ROLES_PRODUCCION.PLANTISTA, ROLES_PRODUCCION.COORDINADOR],
    [ACCIONES.ENVIAR_BETONMATIC]:      [ROLES_PRODUCCION.PLANTISTA, ROLES_PRODUCCION.COORDINADOR],
    // "Traer de vuelta" libera el ticket en Betonmatic para que el coordinador
    // pueda modificar. Lo dispara el plantista; coordinador no anula en planta
    // directamente — eso es decisión operativa de quien opera la planta.
    [ACCIONES.TRAER_DE_VUELTA]:        [ROLES_PRODUCCION.PLANTISTA],
});

/**
 * Devuelve true si `user` puede ejecutar `accion` en el módulo Producción.
 *
 * @param {Object} user - típicamente `req.user` (debe tener `isAdmin`, `rolProduccion`).
 * @param {string} accion - una clave de `ACCIONES`.
 * @returns {boolean}
 */
function puedeAccionProduccion(user, accion) {
    if (!user) return false;
    if (user.isAdmin === true) return true;
    const permitidos = ACCION_ROLES[accion];
    if (!Array.isArray(permitidos)) return false;
    return user.rolProduccion ? permitidos.includes(user.rolProduccion) : false;
}

module.exports = {
    ROLES_PRODUCCION,
    ROLES_PRODUCCION_LIST,
    ROL_LABEL,
    ROL_DESCRIPCION,
    ACCIONES,
    ACCIONES_LIST,
    ACCION_ROLES,
    puedeAccionProduccion,
};
