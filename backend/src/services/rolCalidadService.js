'use strict';

/**
 * rolCalidadService — administra `User.rolCalidad`.
 *
 * Responsabilidades:
 *   1. Listar usuarios candidatos a recibir un rol de Calidad. Un candidato es
 *      un user con AL MENOS UN check en algún submenú del módulo Calidad
 *      (modulo='calidad' en la tabla Menu). isAdmin también cuenta.
 *   2. Asignar/cambiar/quitar el rol de Calidad de un user.
 *
 * Lo que NO hace:
 *   - No toca el árbol PermisoMenu del usuario (ortogonal).
 *   - No toca EmpleadoRol (los 5 roles canónicos del sistema son otra cosa,
 *     ver `domain/roles/index.js`). El rol de Calidad es específico al módulo
 *     y vive en `User.rolCalidad`.
 *   - No toca isAdmin.
 */

const { ROLES_CALIDAD_LIST, tieneAccesoAModuloCalidad } = require('../domain/roles/calidadGates');

/**
 * Devuelve los IDs de los menús de Calidad (modulo='calidad') del tenant.
 * Cacheable a futuro; por ahora simple query.
 */
async function getMenusCalidadIds(db) {
    const menus = await db.Menu.findAll({
        where: { modulo: 'calidad' },
        attributes: ['idMenu'],
        raw: true,
    });
    return menus.map((m) => Number(m.idMenu));
}

/**
 * Lista usuarios candidatos: tienen acceso al módulo Calidad (un check en
 * cualquier submenú) o son isAdmin. Devuelve shape consumible por la UI:
 *
 *   [{ id, username, name, lastname, isAdmin, rolCalidad,
 *      empleado: { idEmpleado, nombre, apellido, matricula? },
 *      tieneAccesoCalidad: true }]
 *
 * Excluye CLIENTE explícitamente (futuro: si CLIENTE se materializa en User).
 */
async function listarCandidatos(db) {
    const menusCalidad = await getMenusCalidadIds(db);
    if (menusCalidad.length === 0) return [];

    const users = await db.User.findAll({
        where: { hidden: 0 },
        attributes: ['id', 'username', 'name', 'lastname', 'isAdmin', 'rolCalidad', 'idEmpleado'],
        include: [
            { model: db.Empleado, as: 'empleado', attributes: ['idEmpleado', 'nombre', 'apellido'] },
        ],
        order: [['username', 'ASC']],
    });

    // Cargar permisos de menú en bulk para evitar N+1.
    const userIds = users.map((u) => u.id);
    const perms = userIds.length === 0 ? [] : await db.PermisoMenu.findAll({
        where: { idUser: userIds, idMenu: menusCalidad },
        raw: true,
    });
    const permsByUser = new Map();
    for (const p of perms) {
        if (!permsByUser.has(p.idUser)) permsByUser.set(p.idUser, {});
        permsByUser.get(p.idUser)[p.idMenu] = p;
    }

    const result = [];
    for (const u of users) {
        const plain = u.get({ plain: true });
        plain.menuPerms = permsByUser.get(u.id) || {};
        const tieneAcceso = tieneAccesoAModuloCalidad(plain, menusCalidad);
        if (!tieneAcceso) continue;
        result.push({
            id: plain.id,
            username: plain.username,
            name: plain.name,
            lastname: plain.lastname,
            isAdmin: plain.isAdmin,
            rolCalidad: plain.rolCalidad,
            empleado: plain.empleado || null,
            tieneAccesoCalidad: true,
        });
    }
    return result;
}

/**
 * Asigna o quita el rol de Calidad a un user.
 *   - rol = string canónico de ROLES_CALIDAD → asigna.
 *   - rol = null o '' → quita.
 *   - rol no válido → throw.
 */
async function asignarRol(db, idUser, rol) {
    const user = await db.User.findByPk(idUser);
    if (!user) throw new Error('Usuario no encontrado');

    const target = rol === '' || rol === undefined ? null : rol;
    if (target !== null && !ROLES_CALIDAD_LIST.includes(target)) {
        throw new Error(`Rol de Calidad inválido: ${target}`);
    }

    await user.update({ rolCalidad: target });
    return {
        id: user.id,
        username: user.username,
        rolCalidad: user.rolCalidad,
    };
}

module.exports = {
    listarCandidatos,
    asignarRol,
    getMenusCalidadIds,
};
