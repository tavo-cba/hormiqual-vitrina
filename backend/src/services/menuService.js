const { getCacheForDb } = require('./cacheHelpers');

/** TTL en segundos */
const MENUS_TTL = 1800; // 30 min (invalidado por mutaciones)

const invalidateMenuCache = (db) => {
  const tc = getCacheForDb(db);
  tc.invalidate('menus');
};

const sortTree = (nodes) => {
  nodes.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  nodes.forEach((n) => sortTree(n.children));
};

const buildTree = (items) => {
  const map = new Map();
  const roots = [];
  items.forEach((item) => {
    item.children = [];
    map.set(item.idMenu, item);
  });
  items.forEach((item) => {
    if (item.idMenuPadre) {
      const parent = map.get(item.idMenuPadre);
      if (parent) parent.children.push(item);
      else roots.push(item);
    } else {
      roots.push(item);
    }
  });
  sortTree(roots);
  return roots;
};

const filterTree = (nodes, allowed) => {
  return nodes
    .map((n) => {
      const children = filterTree(n.children, allowed);
      if (allowed.has(n.idMenu) || children.length) {
        return { ...n, children };
      }
      return null;
    })
    .filter(Boolean);
};

/**
 * PR3: filtra la lista plana de menús según la Config del tenant.
 *   - `modulosHabilitados` (legacy): si está definido, solo aparecen módulos en la lista.
 *   - `usaTBS` (PR3): si false, se ocultan los menús con `modulo='tbs'`.
 * Las dos reglas se aplican en cascada (ambas deben pasar).
 *
 * Regla `modulo`:
 *   - `null` o vacío → siempre visible (no es de un módulo)
 *   - 'tbs'          → visible solo si `usaTBS=true`
 *   - cualquier otro → visible si está en `modulosHabilitados` (o si éste no se configuró)
 */
const _filterMenusByConfig = (menus, configRow) => {
  const enabledModules = configRow?.modulosHabilitados
    ? JSON.parse(configRow.modulosHabilitados)
    : null;
  const usaTBS = !!configRow?.usaTBS;
  return menus.filter((m) => {
    if (m.modulo === 'tbs' && !usaTBS) return false;
    if (enabledModules && m.modulo && m.modulo !== 'tbs' && !enabledModules.includes(m.modulo)) return false;
    return true;
  });
};

const getMenus = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('menus', 'tree');
  if (cached) return cached;

  const [menus, configRow] = await Promise.all([
    db.Menu.findAll({
      where: { activo: true },
      order: [['orden', 'ASC']],
      raw: true,
    }),
    db.Config.findOne({
      attributes: ['modulosHabilitados', 'usaTBS'],
      raw: true,
    }),
  ]);

  const filteredMenus = _filterMenusByConfig(menus, configRow);
  const tree = buildTree(filteredMenus);
  tc.set('menus', 'tree', tree, MENUS_TTL);
  return tree;
};

const getMenusByUser = async (db, idUser) => {
  const tc = getCacheForDb(db);
  const cacheKey = `user:${idUser}`;
  const cached = tc.get('menus', cacheKey);
  if (cached) return cached;

  const [menus, permisos, user, configRow] = await Promise.all([
    /* ───── todos los menús activos ───── */
    db.Menu.findAll({
      where: { activo: true },
      order: [['orden', 'ASC']],
      raw: true,
    }),
    /* ───── permisos específicos del usuario ───── */
    db.PermisoMenu.findAll({
      where: { idUser },
      raw: true,
    }),
    /* ───── buscamos el usuario para chequear is_admin ───── */
    db.User.findByPk(idUser, {
      attributes: ['is_admin'],
      raw: true,
    }),
    /* ───── config para módulos habilitados + usaTBS ───── */
    db.Config.findOne({
      attributes: ['modulosHabilitados', 'usaTBS'],
      raw: true,
    }),
  ]);

  const filteredMenus = _filterMenusByConfig(menus, configRow);
  const tree = buildTree(filteredMenus);

  /* ───────── si es admin, devuelve todo el árbol con permisos ───────── */
  if (user?.is_admin) {
    const grantAll = (nodes) => {
      nodes.forEach((n) => {
        n.puedeVer = true;
        n.puedeAgregar = true;
        n.puedeEditar = true;
        n.puedeBorrar = true;
        if (n.children?.length) grantAll(n.children);
      });
    };
    grantAll(tree);
    tc.set('menus', cacheKey, tree, MENUS_TTL);
    return tree;
  }

  /* ───────── sino, filtra por permisos como antes ───────── */
  const allowed = new Set(
    permisos
      .filter((p) => p.puedeVer)
      .map((p) => p.idMenu)
  );

  const result = filterTree(tree, allowed);
  tc.set('menus', cacheKey, result, MENUS_TTL);
  return result;
};

const createMenu = async (db, data) => {
  // Obtener el orden máximo actual para el padre especificado
  const siblings = await db.Menu.findAll({
    where: {
      idMenuPadre: data.idMenuPadre || null,
      activo: true,
    },
    raw: true,
  });

  const maxOrden = siblings.length > 0
    ? Math.max(...siblings.map(s => s.orden || 0))
    : 0;

  return await db.Menu.create({
    nombre: data.nombre,
    ruta: data.ruta || null,
    icono: data.icono || null,
    idMenuPadre: data.idMenuPadre || null,
    modulo: data.modulo || null,
    orden: maxOrden + 1,
  }).then(menu => { invalidateMenuCache(db); return menu; });
};

const updateMenu = async (db, id, data) => {
  const menu = await db.Menu.findByPk(id);
  if (!menu) throw new Error('Menú no encontrado');
  await menu.update({
    nombre: data.nombre,
    ruta: data.ruta,
    icono: data.icono,
    idMenuPadre: data.idMenuPadre,
    modulo: data.modulo !== undefined ? data.modulo : menu.modulo,
    orden: data.orden !== undefined ? data.orden : menu.orden,
    activo: data.activo !== undefined ? data.activo : menu.activo,
  });
  invalidateMenuCache(db);
  return menu;
};

/**
 * NUEVA FUNCIÓN: Reordena un menú y actualiza el orden de todos sus hermanos
 * Esta función soluciona el problema del drag & drop
 *
 * @param {Object} db - Instancia de la base de datos
 * @param {Number} idMenu - ID del menú que se está moviendo
 * @param {Object} data - { idMenuPadre: number|null, newOrder: number[] }
 *   - idMenuPadre: nuevo padre del menú (null para raíz)
 *   - newOrder: array con los IDs de todos los hermanos en el nuevo orden
 */
const reorderMenu = async (db, idMenu, data) => {
  const { idMenuPadre, newOrder } = data;

  // Validar que el menú existe
  const menu = await db.Menu.findByPk(idMenu);
  if (!menu) throw new Error('Menú no encontrado');

  // Validar que no se está intentando hacer que un menú sea hijo de sí mismo
  // o de uno de sus descendientes
  if (idMenuPadre) {
    const checkCircular = async (parentId) => {
      if (parentId === idMenu) return true;
      const parent = await db.Menu.findByPk(parentId);
      if (!parent || !parent.idMenuPadre) return false;
      return await checkCircular(parent.idMenuPadre);
    };

    const isCircular = await checkCircular(idMenuPadre);
    if (isCircular) {
      throw new Error('No se puede mover un menú dentro de sí mismo');
    }
  }

  // Usar transacción para asegurar consistencia
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Actualizar el padre del menú movido
    await menu.update({ idMenuPadre }, { transaction });

    // 2. Actualizar el orden de todos los hermanos según el array newOrder
    for (let i = 0; i < newOrder.length; i++) {
      await db.Menu.update(
        { orden: i },
        {
          where: { idMenu: newOrder[i] },
          transaction
        }
      );
    }

    await transaction.commit();
    invalidateMenuCache(db);
    return { message: 'Menú reordenado correctamente' };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const deleteMenu = async (db, id) => {
  const menu = await db.Menu.findByPk(id);
  if (!menu) throw new Error('Menú no encontrado');

  // Verificar si tiene hijos
  const children = await db.Menu.findAll({
    where: { idMenuPadre: id, activo: true }
  });

  if (children.length > 0) {
    throw new Error('No se puede eliminar un menú que tiene submenús. Elimine primero los submenús.');
  }

  await menu.update({ activo: false });
  invalidateMenuCache(db);
  return { message: 'Menu eliminado' };
};

const addPermission = async (db, idMenu, idUser, perms = {}) => {
  return await db.PermisoMenu.create({
    idMenu,
    idUser,
    puedeVer: !!perms.puedeVer,
    puedeAgregar: !!perms.puedeAgregar,
    puedeEditar: !!perms.puedeEditar,
    puedeBorrar: !!perms.puedeBorrar,
  });
};

const updatePermission = async (db, idMenu, idUser, perms = {}) => {
  const record = await db.PermisoMenu.findOne({ where: { idMenu, idUser } });
  if (!record) throw new Error('Permiso no encontrado');
  await record.update({
    puedeVer: perms.puedeVer !== undefined ? perms.puedeVer : record.puedeVer,
    puedeAgregar:
      perms.puedeAgregar !== undefined ? perms.puedeAgregar : record.puedeAgregar,
    puedeEditar:
      perms.puedeEditar !== undefined ? perms.puedeEditar : record.puedeEditar,
    puedeBorrar:
      perms.puedeBorrar !== undefined ? perms.puedeBorrar : record.puedeBorrar,
  });
  return record;
};

const removePermission = async (db, idMenu, idUser) => {
  await db.PermisoMenu.destroy({ where: { idMenu, idUser } });
};

module.exports = {
  getMenus,
  getMenusByUser,
  createMenu,
  updateMenu,
  reorderMenu,
  deleteMenu,
  addPermission,
  updatePermission,
  removePermission,
  // Helper expuesto para tests (PR3)
  _filterMenusByConfig,
};
