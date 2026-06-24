// src/middlewares/permissions.js

// ─── @deprecated (Fase 6) ───────────────────────────────────────────────────
// Los middlewares basados en bitmask (`requireAdmin`, `requireAdministrar`,
// `requireAdministrarBorrar`, `requireProduccion`, `requireProduccionBorrar`)
// son legacy y serán reemplazados por `requireRole(ROLES.*)` en una fase
// posterior. Mientras tanto, en NODE_ENV !== 'production' emitimos un
// `console.warn` por cada invocación para detectarlos en logs y planear su
// reemplazo. Migración recomendada:
//
//   requireAdmin                 → requireRole(ROLES.ADMIN)
//   requireAdministrar           → requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)
//   requireAdministrarBorrar     → requireRole(ROLES.ADMIN)
//   requireProduccion            → requireRole(ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.ADMIN)
//   requireProduccionBorrar      → requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)
// ────────────────────────────────────────────────────────────────────────────

const _DEPRECATION_NOTIFICADOS = new Set();
const _DEPRECATION_WARN = (nombreMiddleware, sugerencia) => {
  if (process.env.NODE_ENV === 'production') return;
  if (_DEPRECATION_NOTIFICADOS.has(nombreMiddleware)) return;
  _DEPRECATION_NOTIFICADOS.add(nombreMiddleware);
  // eslint-disable-next-line no-console
  console.warn(`[permissions] @deprecated: ${nombreMiddleware} es legacy. Usar ${sugerencia} (RBAC canónico).`);
};

// Mapa de bits de permisos (debe coincidir con el frontend)
const PERMISSIONS = {
    ADMIN:            1 << 0, // 1
    ADMIN_WRITE:      1 << 1, // 2
    ADMIN_DELETE:     1 << 2, // 4
    PROD_WRITE:       1 << 3, // 8
    PROD_DELETE:      1 << 4, //16
  };

  /**
   * @deprecated Fase 6 — usar `requireRole(ROLES.ADMIN)`.
   * Sólo administradores absolutos.
   */
  function requireAdmin(req, res, next) {
    _DEPRECATION_WARN('requireAdmin', 'requireRole(ROLES.ADMIN)');
    if (!(req.user.permission & PERMISSIONS.ADMIN)) {
      return res.status(403).json({ error: "Permiso de administrador requerido" });
    }
    next();
  }

  /**
   * @deprecated Fase 6 — usar `requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)`.
   * Carga/modificación en sección "Administrar".
   */
  function requireAdministrar(req, res, next) {
    _DEPRECATION_WARN('requireAdministrar', 'requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)');
    const mask = PERMISSIONS.ADMIN_WRITE | PERMISSIONS.ADMIN;
    if (!(req.user.permission & mask)) {
      return res.status(403).json({ error: "Permiso de crear/editar en Administrar requerido" });
    }
    next();
  }

  /**
   * @deprecated Fase 6 — usar `requireRole(ROLES.ADMIN)`.
   * Borrado en sección "Administrar".
   */
  function requireAdministrarBorrar(req, res, next) {
    _DEPRECATION_WARN('requireAdministrarBorrar', 'requireRole(ROLES.ADMIN)');
    const mask = PERMISSIONS.ADMIN_DELETE | PERMISSIONS.ADMIN;
    if (!(req.user.permission & mask)) {
      return res.status(403).json({ error: "Permiso de eliminación en Administrar requerido" });
    }
    next();
  }

  /**
   * @deprecated Fase 6 — usar `requireRole(ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.ADMIN)`.
   * Carga/modificación en sección "Producción".
   */
  function requireProduccion(req, res, next) {
    _DEPRECATION_WARN('requireProduccion', 'requireRole(ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.ADMIN)');
    const mask = PERMISSIONS.PROD_WRITE | PERMISSIONS.ADMIN;
    if (!(req.user.permission & mask)) {
      return res.status(403).json({ error: "Permiso de crear/editar en Producción requerido" });
    }
    next();
  }

  /**
   * @deprecated Fase 6 — usar `requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)`.
   * Borrado en sección "Producción".
   */
  function requireProduccionBorrar(req, res, next) {
    _DEPRECATION_WARN('requireProduccionBorrar', 'requireRole(ROLES.RESPONSABLE, ROLES.ADMIN)');
    const mask = PERMISSIONS.PROD_DELETE | PERMISSIONS.ADMIN;
    if (!(req.user.permission & mask)) {
      return res.status(403).json({ error: "Permiso de eliminación en Producción requerido" });
    }
    next();
  }
  
  /**
   * RBAC por rol funcional (HormiQual Fase 1).
   * Acepta uno o varios roles canónicos de `domain/roles`. El usuario pasa si
   * tiene CUALQUIERA de los roles indicados. ADMIN legacy (isAdmin) se trata
   * como ADMIN canónico para backward-compat.
   *
   * Uso:
   *   router.post('/...', verifyJwt, requireRole(ROLES.RESPONSABLE, ROLES.ADMIN), handler);
   */
  function requireRole(...rolesCanonicos) {
    const { hasRole } = require('../domain/roles');
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      if (hasRole(req.user, ...rolesCanonicos)) return next();
      return res.status(403).json({
        error: 'Permiso insuficiente',
        rolRequerido: rolesCanonicos,
        rolesDelUsuario: req.user.roles || [],
      });
    };
  }

  /**
   * Sprint 2 (sesión 2026-05-10) — gate combinado árbol + rol vía
   * `puedeAccionCalidad` del engine puro `domain/roles/calidadGates.js`.
   *
   * Uso:
   *   router.put('/algo', verifyJwt, requireAccionCalidad(ACCIONES.APROBAR_ENSAYO), ctrl);
   *
   * Por defecto el `idMenu` de chequeo del árbol es null (gate puro de rol).
   * Si la acción tiene `accionArbol` declarada (ver REQUISITOS) y se necesita
   * chequear el árbol también, pasar `idMenu` como segundo parámetro:
   *
   *   requireAccionCalidad(ACCIONES.APROBAR_ENSAYO, { idMenu: 201 })
   *
   * El comportamiento por defecto NO chequea árbol porque los menús varían
   * por tenant. La idea es que el frontend hace la primera capa de visibilidad
   * por menú y este middleware exige el segundo gate (rol). Si querés exigir
   * los dos, agregá `idMenu` explícito.
   */
  function requireAccionCalidad(accion, opts = {}) {
    const { puedeAccionCalidad } = require('../domain/roles/calidadGates');
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      const ctx = {
        idMenu: opts.idMenu ?? null,
        empleadoTieneMatricula: opts.empleadoTieneMatricula ?? null,
      };
      const r = puedeAccionCalidad(req.user, accion, ctx);
      if (r.allowed) return next();
      return res.status(403).json({
        error: 'Permiso insuficiente para esta acción',
        accion,
        motivo: r.motivo,
      });
    };
  }

  /**
   * Sesión 2026-05-11 — Gate combinado árbol + rol para el módulo Flota.
   * Mismo contrato que `requireAccionCalidad`. Ver `domain/roles/flotaGates.js`
   * para el catálogo de acciones (ACCIONES.*) y los requisitos por acción.
   *
   * Uso:
   *   const { ACCIONES: ACC_FLOTA } = require('../domain/roles/flotaGates');
   *   router.delete('/fuentes/:id', verifyJwt,
   *       requireAccionFlota(ACC_FLOTA.BORRAR_FUENTE),
   *       combustibleController.deleteFuente);
   *
   * Si querés exigir también el gate del árbol de menús, pasá idMenu:
   *   requireAccionFlota(ACC_FLOTA.BORRAR_FUENTE, { idMenu: 42 })
   */
  function requireAccionFlota(accion, opts = {}) {
    const { puedeAccionFlota } = require('../domain/roles/flotaGates');
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      const ctx = { idMenu: opts.idMenu ?? null };
      const r = puedeAccionFlota(req.user, accion, ctx);
      if (r.allowed) return next();
      return res.status(403).json({
        error: 'Permiso insuficiente para esta acción',
        accion,
        motivo: r.motivo,
      });
    };
  }

  /**
   * Sesión 2026-05-11 — Gate combinado árbol + rol para Mantenimiento.
   * Espejo de `requireAccionFlota`. Ver `domain/roles/mantenimientoGates.js`.
   */
  function requireAccionMantenimiento(accion, opts = {}) {
    const { puedeAccionMantenimiento, ROL_LABEL } = require('../domain/roles/mantenimientoGates');
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      const ctx = { idMenu: opts.idMenu ?? null };
      const r = puedeAccionMantenimiento(req.user, accion, ctx);
      if (r.allowed) return next();
      const motivo = r.motivo || '';
      let detalle = 'permiso insuficiente';
      const matchRol = motivo.match(/^rol_insuficiente_requiere_(.+)$/);
      const matchArbol = motivo.match(/^arbol_sin_permiso_(.+)$/);
      if (matchRol) {
        const rolReq = matchRol[1];
        const label = ROL_LABEL[rolReq] || rolReq;
        detalle = `requiere rol de Mantenimiento "${label}" o superior`;
      } else if (matchArbol) {
        detalle = `falta permiso "${matchArbol[1]}" en el árbol de menús`;
      } else if (motivo === 'accion_desconocida') {
        detalle = `acción "${accion}" no está registrada en el gate`;
      } else if (motivo) {
        detalle = motivo;
      }
      return res.status(403).json({
        error: `Permiso insuficiente: ${detalle}`,
        accion,
        motivo: r.motivo,
      });
    };
  }

  /**
   * Sesión 2026-06-03 — Gate del módulo Producción.
   * Ver `domain/roles/produccionGates.js` para el catálogo de acciones.
   *
   * Uso:
   *   const { ACCIONES: ACC_PROD } = require('../domain/roles/produccionGates');
   *   router.post('/pedidos', verifyJwt,
   *       requireAccionProduccion(ACC_PROD.CREAR_PEDIDO),
   *       pedidoController.createPedido);
   */
  function requireAccionProduccion(accion) {
    const { puedeAccionProduccion, ROL_LABEL, ACCION_ROLES } = require('../domain/roles/produccionGates');
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'No autenticado' });
      if (puedeAccionProduccion(req.user, accion)) return next();
      const rolesPermitidos = ACCION_ROLES[accion] || [];
      const labels = rolesPermitidos.map(r => ROL_LABEL[r] || r).join(' o ');
      return res.status(403).json({
        error: labels
          ? `Permiso insuficiente: esta acción requiere rol de Producción "${labels}".`
          : `Permiso insuficiente: acción "${accion}" no registrada en el gate.`,
        accion,
      });
    };
  }

  module.exports = {
    PERMISSIONS,
    requireAdmin,
    requireAdministrar,
    requireAdministrarBorrar,
    requireProduccion,
    requireProduccionBorrar,
    requireRole,
    requireAccionCalidad,
    requireAccionFlota,
    requireAccionMantenimiento,
    requireAccionProduccion,
  };
