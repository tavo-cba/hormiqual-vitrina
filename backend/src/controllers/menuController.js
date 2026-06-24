const menuService = require('../services/menuService');
const { createDbConnection } = require('../models');
const { extractTenantFromRequest } = require('../middlewares/extractTenant');

const MASTER_TENANT = (process.env.MASTER_TENANT || 'arideros').toLowerCase();

const listAllTenants = () =>
  Object.keys(process.env)
    .filter((k) => k.startsWith('DATABASE_') && process.env[k])
    .map((k) => k.replace('DATABASE_', '').toLowerCase());

const ensureMasterTenant = (req, res) => {
  try {
    const current = extractTenantFromRequest(req);
    if (current !== MASTER_TENANT) {
      res.status(403).json({ error: `Esta operación solo está disponible desde el tenant "${MASTER_TENANT}"` });
      return null;
    }
    return current;
  } catch (err) {
    res.status(400).json({ error: 'No se pudo resolver el tenant del request' });
    return null;
  }
};

exports.getMenus = async (req, res) => {
  try {
    const menus = await menuService.getMenus(req.db);
    res.status(200).json(menus);
  } catch (err) {
    console.error('Error in getMenus:', err);
    res.status(500).json({ error: 'Error al obtener menús' });
  }
};

exports.getMenusForUser = async (req, res) => {
  try {
    const menus = await menuService.getMenusByUser(req.db, req.user.id);
    res.status(200).json(menus);
  } catch (err) {
    console.error('Error in getMenusForUser:', err);
    res.status(500).json({ error: 'Error al obtener menús' });
  }
};
exports.reorderMenu = async (req, res) => {
  try {
    const { id } = req.params;
    const { idMenuPadre, newOrder } = req.body;

    // Validar que newOrder sea un array
    if (!Array.isArray(newOrder) || newOrder.length === 0) {
      return res.status(400).json({
        error: 'El campo newOrder debe ser un array con los IDs ordenados'
      });
    }

    const result = await menuService.reorderMenu(req.db, parseInt(id), {
      idMenuPadre: idMenuPadre ? parseInt(idMenuPadre) : null,
      newOrder: newOrder.map(id => parseInt(id))
    });

    res.json(result);
  } catch (error) {
    console.error('Error al reordenar menú:', error);
    res.status(500).json({ error: error.message || 'Error al reordenar menú' });
  }
};

exports.createMenu = async (req, res) => {
  try {
    const menu = await menuService.createMenu(req.db, req.body);
    res.status(201).json(menu);
  } catch (err) {
    console.error('Error in createMenu:', err);
    res.status(500).json({ error: err.message || 'Error al crear menú' });
  }
};

exports.updateMenu = async (req, res) => {
  try {
    const menu = await menuService.updateMenu(req.db, req.params.id, req.body);
    res.status(200).json(menu);
  } catch (err) {
    console.error('Error in updateMenu:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar menú' });
  }
};

exports.deleteMenu = async (req, res) => {
  try {
    const msg = await menuService.deleteMenu(req.db, req.params.id);
    res.status(200).json(msg);
  } catch (err) {
    console.error('Error in deleteMenu:', err);
    res.status(500).json({ error: err.message || 'Error al eliminar menú' });
  }
};

exports.addPermission = async (req, res) => {
  try {
    const perm = await menuService.addPermission(
      req.db,
      req.params.id,
      req.params.userId,
      req.body
    );
    res.status(201).json(perm);
  } catch (err) {
    console.error('Error in addPermission:', err);
    res.status(500).json({ error: err.message || 'Error al asignar permiso' });
  }
};

exports.updatePermission = async (req, res) => {
  try {
    const perm = await menuService.updatePermission(
      req.db,
      req.params.id,
      req.params.userId,
      req.body
    );
    res.status(200).json(perm);
  } catch (err) {
    console.error('Error in updatePermission:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar permiso' });
  }
};

exports.removePermission = async (req, res) => {
  try {
    await menuService.removePermission(req.db, req.params.id, req.params.userId);
    res.status(200).json({ message: 'Permiso eliminado' });
  } catch (err) {
    console.error('Error in removePermission:', err);
    res.status(500).json({ error: err.message || 'Error al quitar permiso' });
  }
};

// ───────── Cross-tenant admin (solo desde MASTER_TENANT) ─────────

exports.adminListTenants = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  try {
    const tenants = listAllTenants();
    res.json({ tenants, master: MASTER_TENANT });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Error al listar tenants' });
  }
};

exports.adminGetMenusOfTenant = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  const target = (req.params.tenant || '').toLowerCase();
  if (!listAllTenants().includes(target)) {
    return res.status(404).json({ error: `Tenant "${target}" no encontrado` });
  }
  try {
    const targetDb = await createDbConnection(target);
    const tree = await menuService.getMenus(targetDb);
    res.json(tree);
  } catch (err) {
    console.error('Error in adminGetMenusOfTenant:', err);
    res.status(500).json({ error: err.message || 'Error al obtener menús' });
  }
};

const resolveParentInTenant = async (db, parentRuta, parentNombre) => {
  if (parentRuta) {
    const p = await db.Menu.findOne({ where: { ruta: parentRuta, activo: true } });
    return p ? p.idMenu : null;
  }
  if (parentNombre) {
    const p = await db.Menu.findOne({ where: { nombre: parentNombre, idMenuPadre: null, activo: true } });
    return p ? p.idMenu : null;
  }
  return null;
};

const resolveParentByPath = async (db, path) => {
  if (!Array.isArray(path) || path.length === 0) return null;
  let currentParentId = null;
  for (const name of path) {
    const node = await db.Menu.findOne({
      where: { nombre: name, idMenuPadre: currentParentId, activo: true },
    });
    if (!node) return null;
    currentParentId = node.idMenu;
  }
  return currentParentId;
};

exports.adminCreateMenuMulti = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  const { tenants = [], nombre, ruta, icono, modulo, parentRuta, parentNombre, parentPath } = req.body || {};
  if (!Array.isArray(tenants) || tenants.length === 0) {
    return res.status(400).json({ error: 'Debe especificar al menos un tenant' });
  }
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'El nombre es obligatorio' });
  }
  const allowed = listAllTenants();
  const results = [];
  for (const raw of tenants) {
    const t = (raw || '').toLowerCase();
    if (!allowed.includes(t)) {
      results.push({ tenant: t, ok: false, error: 'Tenant no permitido' });
      continue;
    }
    try {
      const tDb = await createDbConnection(t);
      let idMenuPadre = null;
      const hasPath = Array.isArray(parentPath) && parentPath.length > 0;
      if (hasPath || parentRuta || parentNombre) {
        if (hasPath) {
          idMenuPadre = await resolveParentByPath(tDb, parentPath);
        }
        if (!idMenuPadre && (parentRuta || parentNombre)) {
          idMenuPadre = await resolveParentInTenant(tDb, parentRuta, parentNombre);
        }
        if (!idMenuPadre) {
          const label = hasPath
            ? `"${parentPath.join(' › ')}"`
            : parentRuta
              ? `con ruta "${parentRuta}"`
              : `"${parentNombre}"`;
          results.push({
            tenant: t,
            ok: false,
            error: `Padre ${label} no existe en este tenant`,
          });
          continue;
        }
      }
      const menu = await menuService.createMenu(tDb, { nombre, ruta, icono, modulo, idMenuPadre });
      results.push({ tenant: t, ok: true, idMenu: menu.idMenu });
    } catch (err) {
      results.push({ tenant: t, ok: false, error: err.message || 'Error desconocido' });
    }
  }
  res.json({ results });
};

exports.adminUpdateMenu = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  const target = (req.params.tenant || '').toLowerCase();
  if (!listAllTenants().includes(target)) {
    return res.status(404).json({ error: `Tenant "${target}" no encontrado` });
  }
  try {
    const tDb = await createDbConnection(target);
    const menu = await menuService.updateMenu(tDb, req.params.id, req.body);
    res.json(menu);
  } catch (err) {
    console.error('Error in adminUpdateMenu:', err);
    res.status(500).json({ error: err.message || 'Error al actualizar menú' });
  }
};

exports.adminDeleteMenu = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  const target = (req.params.tenant || '').toLowerCase();
  if (!listAllTenants().includes(target)) {
    return res.status(404).json({ error: `Tenant "${target}" no encontrado` });
  }
  try {
    const tDb = await createDbConnection(target);
    const result = await menuService.deleteMenu(tDb, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('Error in adminDeleteMenu:', err);
    res.status(500).json({ error: err.message || 'Error al eliminar menú' });
  }
};

exports.adminReorderMenu = async (req, res) => {
  if (!ensureMasterTenant(req, res)) return;
  const target = (req.params.tenant || '').toLowerCase();
  if (!listAllTenants().includes(target)) {
    return res.status(404).json({ error: `Tenant "${target}" no encontrado` });
  }
  try {
    const { idMenuPadre, newOrder } = req.body;
    if (!Array.isArray(newOrder) || newOrder.length === 0) {
      return res.status(400).json({ error: 'newOrder debe ser un array' });
    }
    const tDb = await createDbConnection(target);
    const result = await menuService.reorderMenu(tDb, parseInt(req.params.id), {
      idMenuPadre: idMenuPadre ? parseInt(idMenuPadre) : null,
      newOrder: newOrder.map((id) => parseInt(id)),
    });
    res.json(result);
  } catch (err) {
    console.error('Error in adminReorderMenu:', err);
    res.status(500).json({ error: err.message || 'Error al reordenar menú' });
  }
};