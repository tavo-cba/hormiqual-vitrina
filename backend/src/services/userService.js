const bcrypt = require('bcryptjs');
const { getCacheForDb } = require('./cacheHelpers');
const SALT_ROUNDS = 10;

/** TTL para lista de usuarios: 15 min (invalidado por hooks) */
const USERS_TTL = 900;

// Refactor 2026-05-20: la "autoridad del sistema" del usuario vive directamente
// en columnas de Users (isAdmin, esClienteExterno, rolCalidad). El helper viejo
// `syncRolSistemaEmpleado` que escribía a EmpleadoRol fue eliminado; los flags
// ahora se persisten directamente en `db.User.create/update`.

exports.getUsers = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('usuarios', 'all');
  if (cached) return cached;

  const users = await db.User.findAll({
    where: { hidden: 0 },
    attributes: { exclude: ['password'] },
    include: [
      {
        model: db.Empleado,
        as: 'empleado'
      },
      {
        model: db.Planta,
        as: 'plantas',
      }
    ]
  });
  const plain = users.map(u => u.get({ plain: true }));
  tc.set('usuarios', 'all', plain, USERS_TTL);
  return plain;
};

exports.getUser = async (db, id) => {
  const user = await db.User.findOne({
    where: { id, hidden: 0 },
    attributes: { exclude: ['password'] },
    include: [
      {
        model: db.Empleado,
        as: 'empleado',
        include: [{
          model: db.Rol,
          as: 'roles',
          through: { attributes: [] },
          attributes: ['idRol', 'nombreRol'],
        }],
      },
      { model: db.Planta, as: 'plantas' },
    ],
  });
  if (!user) return null;
  const result = user.get({ plain: true });
  const perms = await db.PermisoMenu.findAll({ where: { idUser: id }, raw: true });
  result.menuPerms = {};
  perms.forEach((p) => {
    result.menuPerms[p.idMenu] = {
      idMenu: p.idMenu,
      puedeVer: p.puedeVer,
      puedeAgregar: p.puedeAgregar,
      puedeEditar: p.puedeEditar,
      puedeBorrar: p.puedeBorrar,
    };
  });
  // isAdmin, esClienteExterno, rolCalidad/rolFlota/rolMantenimiento vienen
  // directamente en los attributes del User (modelo). El frontend los lee
  // de ahí — ya no se deriva el legacy `rolSistemaEmpleado` (eliminado en B7).
  return result;
};

exports.createUser = async (db, data) => {
  const {
    username,
    password,
    idEmpleado,
    name,
    lastname,
    plantaIds = [],
    allPlantas = false,
    soloObra = false,
    accesoAgente = false,
    isAdmin = false,
    adminCreateModify = false,
    adminDelete = false,
    prodCreateModify = false,
    prodDelete = false,
    menuPerms = {},
  } = data;
  let empleado = null;
  if (idEmpleado) {
    empleado = await db.Empleado.findByPk(idEmpleado);
    if (!empleado) throw new Error('Empleado no encontrado');
  } else if (!isAdmin) {
    throw new Error('El empleado es requerido para usuarios no administradores');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const newUser = await db.User.create({
    username,
    password: passwordHash,
    name: empleado?.nombre ?? name ?? username,
    lastname: empleado?.apellido ?? lastname ?? '',
    allPlantas,
    soloObra,
    accesoAgente,
    isAdmin,
    adminCreateModify,
    adminDelete,
    prodCreateModify,
    prodDelete,
    idEmpleado: idEmpleado || null,
  });

  if (!allPlantas && Array.isArray(plantaIds) && plantaIds.length > 0) {
    await db.UserPlanta.bulkCreate(
      plantaIds.map(idPlanta => ({ idUser: newUser.id, idPlanta }))
    );
  }

  if (menuPerms && typeof menuPerms === 'object') {
    const rows = Object.values(menuPerms)
      .map(p => ({
        idUser: newUser.id,
        idMenu: p.idMenu,
        puedeVer: !!p.puedeVer,
        puedeAgregar: !!p.puedeAgregar,
        puedeEditar: !!p.puedeEditar,
        puedeBorrar: !!p.puedeBorrar,
      }))
      .filter(r => r.puedeVer || r.puedeAgregar || r.puedeEditar || r.puedeBorrar);
    if (rows.length) await db.PermisoMenu.bulkCreate(rows);
  }

  const result = newUser.get({ plain: true });
  delete result.password;
  result.menuPerms = menuPerms;
  return result;
};


exports.updateUser = async (db, id, data) => {
  const user = await db.User.findByPk(id);
  if (!user) throw new Error('Usuario no encontrado');
  let empleado = null;
  if (data.idEmpleado) {
    empleado = await db.Empleado.findByPk(data.idEmpleado);
    if (!empleado) throw new Error('Empleado no encontrado');
  }

  if (data.password) {
    data.password = await bcrypt.hash(data.password, SALT_ROUNDS);
  }
  await user.update({
    username: data.username,
    ...(data.password && { password: data.password }),
    name: empleado?.nombre ?? user.name,
    lastname: empleado?.apellido ?? user.lastname,
    ...(data.allPlantas !== undefined && { allPlantas: data.allPlantas }),
    ...(data.soloObra !== undefined && { soloObra: data.soloObra }),
    ...(data.accesoAgente !== undefined && { accesoAgente: data.accesoAgente }),
    isAdmin: data.isAdmin,
    adminCreateModify: data.adminCreateModify,
    adminDelete: data.adminDelete,
    prodCreateModify: data.prodCreateModify,
    prodDelete: data.prodDelete,
    ...(data.idEmpleado && { idEmpleado: data.idEmpleado })
  })

  if (data.plantaIds) {
    await db.UserPlanta.destroy({ where: { idUser: user.id } });
    if (!data.allPlantas && Array.isArray(data.plantaIds) && data.plantaIds.length > 0) {
      await db.UserPlanta.bulkCreate(
        data.plantaIds.map(idPlanta => ({ idUser: user.id, idPlanta }))
      );
    }
  }
  
  if (data.menuPerms) {
    await db.PermisoMenu.destroy({ where: { idUser: user.id } });
    const rows = Object.values(data.menuPerms)
      .map(p => ({
        idUser: user.id,
        idMenu: p.idMenu,
        puedeVer: !!p.puedeVer,
        puedeAgregar: !!p.puedeAgregar,
        puedeEditar: !!p.puedeEditar,
        puedeBorrar: !!p.puedeBorrar,
      }))
      .filter(r => r.puedeVer || r.puedeAgregar || r.puedeEditar || r.puedeBorrar);
    if (rows.length) await db.PermisoMenu.bulkCreate(rows);
  }

  const result = user.get({ plain: true });
  delete result.password;
  if (data.menuPerms) {
    result.menuPerms = data.menuPerms;
  }
  return result;
};

exports.deleteUser = async (db, id) => {
  const user = await db.User.findByPk(id);
  if (!user) throw new Error('Usuario no encontrado');
  await user.destroy();
};
