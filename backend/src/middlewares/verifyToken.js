// src/middlewares/verifyToken.js
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { createDbConnection } = require('../models');
const PERMISSIONS = require('../constants/permissions');
const { extractTenantFromRequest } = require('./extractTenant');
const cacheManager = require('../cache/CacheManager');

/** TTL del cache de autenticacion: 5 minutos */
const AUTH_CACHE_TTL = 300;

async function verifyJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.sendStatus(401);

  const parts = authHeader.split(' ');
  if (parts[0] !== 'Bearer' || !parts[1]) return res.sendStatus(401);
  const token = parts[1];

  jwt.verify(token, process.env.SECRET_KEY, async (err, payload) => {
    if (err) return res.sendStatus(403);

    try {
      // 1) Obtener tenant (desde subdominio)
      const tenant = extractTenantFromRequest(req);

      // 1.5) Validar que el tenant del JWT coincida con el del request
      if (payload.tenant && payload.tenant !== tenant) {
        return res.status(403).json({ error: 'Token no válido para este tenant' });
      }

      // 2) Cargar base de datos del tenant
      const db = await createDbConnection(tenant);

      // 3) Intentar obtener del cache
      const tc = cacheManager.forTenant(tenant);
      const cacheKey = `user:${payload.id}`;
      const cached = tc.get('auth', cacheKey);

      if (cached) {
        // Servir desde cache
        req.user = cached.user;
        const requestDb = Object.create(db);
        if (cached.user.soloObra) {
          requestDb.Empleado = db.Empleado.scope('soloObra');
        }
        requestDb._soloObra = cached.user.soloObra;
        req.db = requestDb;
        return next();
      }

      // 4) Cache miss: consultar DB
      const dbUser = await db.User.findByPk(payload.id, {
        attributes: { exclude: ['password'] },
        include: [
          {
            model: db.Planta,
            as: 'plantas',
            through: { attributes: [] }
          },
          {
            model: db.Empleado,
            as: 'empleado',
            include: [{
              model: db.Rol,
              as: 'roles',
              through: { attributes: [] }
            }]
          }
        ]

      });
      if (!dbUser) return res.sendStatus(403);

      const fullUser = dbUser.get({ plain: true });

      // Obtener menus + config de módulos en paralelo
      const [allMenusRaw, configRow] = await Promise.all([
        db.Menu.findAll({
          attributes: ['idMenu', 'ruta', 'nombre', 'modulo'],
          raw: true,
        }),
        db.Config.findOne({
          attributes: ['modulosHabilitados'],
          raw: true,
        }),
      ]);

      // Filtrar por módulos habilitados (null en modulosHabilitados = todos habilitados)
      const enabledModules = configRow?.modulosHabilitados
        ? JSON.parse(configRow.modulosHabilitados)
        : null;

      let allMenus;
      let disabledModuleRoutes = [];
      if (enabledModules) {
        allMenus = allMenusRaw.filter(m => !m.modulo || enabledModules.includes(m.modulo));

        // Rutas habilitadas: las que tienen al menos una entrada con módulo habilitado (o sin módulo)
        const enabledRoutes = new Set(
          allMenusRaw
            .filter(m => m.ruta && (!m.modulo || enabledModules.includes(m.modulo)))
            .map(m => m.ruta)
        );
        // Solo deshabilitar rutas que NO tienen ninguna entrada habilitada
        disabledModuleRoutes = allMenusRaw
          .filter(m => m.modulo && !enabledModules.includes(m.modulo) && m.ruta && !enabledRoutes.has(m.ruta))
          .map(m => m.ruta);
      } else {
        allMenus = allMenusRaw;
      }

      const menuById = {};
      allMenus.forEach((m) => {
        menuById[m.idMenu] = m;
      });

      const rawPerms = await db.PermisoMenu.findAll({
        where: { idUser: fullUser.id },
        raw: true,
      });
      const menuPerms = {};
      const menuPermsByRoute = {};

      rawPerms.forEach((p) => {
        const menu = menuById[p.idMenu];
        const permData = {
          idMenu: p.idMenu,
          ruta: menu?.ruta || null,
          nombre: menu?.nombre || null,
          puedeVer: p.puedeVer,
          puedeAgregar: p.puedeAgregar,
          puedeEditar: p.puedeEditar,
          puedeBorrar: p.puedeBorrar,
        };
        menuPerms[p.idMenu] = permData;
        if (menu?.ruta) {
          menuPermsByRoute[menu.ruta] = permData;
        }
      });

      if (fullUser.isAdmin) {
        allMenus.forEach((m) => {
          const permData = {
            idMenu: m.idMenu,
            ruta: m.ruta,
            nombre: m.nombre,
            puedeVer: true,
            puedeAgregar: true,
            puedeEditar: true,
            puedeBorrar: true,
          };
          menuPerms[m.idMenu] = permData;
          if (m.ruta) {
            menuPermsByRoute[m.ruta] = permData;
          }
        });
      }

      // 5) Construir permisos
      let permission = 0;
      if (fullUser.isAdmin) permission |= PERMISSIONS.ADMIN;

      // 6) Setear en request
      const { id, username, name, lastname, allPlantas, soloObra, accesoAgente, isAdmin, rolCalidad, rolFlota, rolMantenimiento, rolProduccion } = fullUser;
      const plantaIds = fullUser.plantas?.map(p => p.idPlanta) || [];
      const roles = fullUser.empleado?.roles?.map(r => r.nombreRol) || [];
      const idEmpleado = fullUser.idEmpleado;
      const userData = {
        id,
        username,
        name,
        lastname,
        permission,
        isAdmin,
        allPlantas,
        soloObra,
        accesoAgente,
        plantaIds,
        roles,
        idEmpleado,
        rolCalidad,
        rolFlota,
        rolMantenimiento,
        rolProduccion,
        menuPerms,
        menuPermsByRoute,
        disabledModuleRoutes,
      };

      req.user = userData;

      // 7) Guardar en cache
      tc.set('auth', cacheKey, { user: userData }, AUTH_CACHE_TTL);

      const requestDb = Object.create(db);
      if (soloObra) {
        requestDb.Empleado = db.Empleado.scope('soloObra');
      }
      requestDb._soloObra = soloObra;
      req.db = requestDb;

    } catch (e) {
      console.error('Error en verifyJwt:', e);
      return res.status(500).json({ error: e.message });
    }

    next();
  });
}

module.exports = { verifyJwt };
