'use strict';

const svc = require('../services/documentApprovalRequestService');
const { getRolesDeUsuario, ROLES } = require('../domain/roles');

const userInfo = (req) => {
  const nombre = req.user
    ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username
    : null;
  const rolesActivos = getRolesDeUsuario(req.user);
  return { usuario: nombre, rol: rolesActivos[0] || null, rolesActivos };
};

const puedeAprobar = (rolesActivos) =>
  rolesActivos.includes(ROLES.DIRECTOR_TECNICO) || rolesActivos.includes(ROLES.ADMIN);

const puedeRechazar = (rolesActivos) =>
  rolesActivos.includes(ROLES.DIRECTOR_TECNICO)
  || rolesActivos.includes(ROLES.ADMIN)
  || rolesActivos.includes(ROLES.RESPONSABLE);

const listar = async (req, res) => {
  try {
    const { estado, tipoDocumento, idMaterial, idDosificacionDisenada, includeInactive } = req.query;
    const out = await svc.listar(req.db, {
      estado,
      tipoDocumento,
      idMaterial,
      idDosificacionDisenada,
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
    if (!puedeAprobar(rolesActivos)) {
      return res.status(403).json({
        error: 'Solo Director Técnico o Admin pueden aprobar la emisión de certificados.',
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
    if (!puedeRechazar(rolesActivos)) {
      return res.status(403).json({
        error: 'No tiene rol suficiente para rechazar este pedido.',
      });
    }
    const { observaciones } = req.body || {};
    const out = await svc.rechazar(req.db, Number(req.params.id), { usuario, rol, observaciones });
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const registrarEmisionPdf = async (req, res) => {
  try {
    const { usuario } = userInfo(req);
    const out = await svc.registrarEmisionPdf(req.db, Number(req.params.id), { usuario });
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

module.exports = { listar, obtener, crear, aprobar, rechazar, registrarEmisionPdf };
