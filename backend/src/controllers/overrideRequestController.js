'use strict';

const svc = require('../services/overrideRequestService');
const { getRolesDeUsuario, ROLES } = require('../domain/roles');

const userInfo = (req) => {
  const nombre = req.user
    ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username
    : null;
  const rolesActivos = getRolesDeUsuario(req.user);
  return { usuario: nombre, rol: rolesActivos[0] || null, rolesActivos };
};

const canResolver = (ambito, rolesActivos) => {
  if (ambito === 'OBRA') {
    return rolesActivos.includes(ROLES.DIRECTOR_TECNICO) || rolesActivos.includes(ROLES.ADMIN);
  }
  if (ambito === 'AUTOCONTROL_PLANTA') {
    return rolesActivos.includes(ROLES.RESPONSABLE)
      || rolesActivos.includes(ROLES.DIRECTOR_TECNICO)
      || rolesActivos.includes(ROLES.ADMIN);
  }
  return false;
};

const listar = async (req, res) => {
  try {
    const { idDosificacionDisenada, idMezcla, estado, includeInactive } = req.query;
    const out = await svc.listar(req.db, {
      idDosificacionDisenada,
      idMezcla,
      estado,
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
    res.json({ items: out });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const obtener = async (req, res) => {
  try {
    const out = await svc.obtener(req.db, Number(req.params.id));
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const crear = async (req, res) => {
  try {
    const { usuario, rol } = userInfo(req);
    const out = await svc.crear(req.db, req.body || {}, { usuario, rol });
    res.status(201).json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const aprobar = async (req, res) => {
  try {
    const { usuario, rol, rolesActivos } = userInfo(req);
    const pedido = await svc.obtener(req.db, Number(req.params.id));
    if (!canResolver(pedido.ambito, rolesActivos)) {
      return res.status(403).json({
        error: pedido.ambito === 'OBRA'
          ? 'Solo Director Técnico puede aprobar overrides de ámbito OBRA.'
          : 'Solo Responsable de Calidad o Director Técnico pueden aprobar overrides de autocontrol de planta.',
      });
    }
    const { matricula, observaciones } = req.body || {};
    const out = await svc.aprobar(req.db, Number(req.params.id), {
      usuario, rol, matricula, observaciones,
    });
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const rechazar = async (req, res) => {
  try {
    const { usuario, rol, rolesActivos } = userInfo(req);
    const pedido = await svc.obtener(req.db, Number(req.params.id));
    if (!canResolver(pedido.ambito, rolesActivos)) {
      return res.status(403).json({
        error: 'No tiene rol suficiente para resolver este override.',
      });
    }
    const { observaciones } = req.body || {};
    const out = await svc.rechazar(req.db, Number(req.params.id), { usuario, rol, observaciones });
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const revocar = async (req, res) => {
  try {
    const { usuario } = userInfo(req);
    const { observaciones } = req.body || {};
    const out = await svc.revocar(req.db, Number(req.params.id), { usuario, observaciones });
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

module.exports = { listar, obtener, crear, aprobar, rechazar, revocar };
