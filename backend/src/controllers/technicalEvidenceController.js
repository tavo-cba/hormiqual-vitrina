'use strict';

const svc = require('../services/technicalEvidenceService');
const { hasRole, ROLES, getRolesDeUsuario } = require('../domain/roles');

const userInfo = (req) => {
  const nombre = req.user
    ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username
    : null;
  const rolesActivos = getRolesDeUsuario(req.user);
  // Reportar rol "principal" (el de mayor severidad) o el primero
  const rolPrincipal = rolesActivos[0] || null;
  return { usuario: nombre, rol: rolPrincipal };
};

const listar = async (req, res) => {
  try {
    const { materialId, dosificacionId, tipo, includeInactive } = req.query;
    const out = await svc.listar(req.db, {
      materialId: materialId != null ? Number(materialId) : undefined,
      dosificacionId: dosificacionId != null ? Number(dosificacionId) : undefined,
      tipo,
      includeInactive: includeInactive === 'true' || includeInactive === '1',
    });
    res.json({ items: out });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
};

const obtener = async (req, res) => {
  try {
    const out = await svc.obtener(req.db, Number(req.params.id));
    res.json(out);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
};

const crear = async (req, res) => {
  try {
    const { usuario, rol } = userInfo(req);
    const out = await svc.crear(req.db, req.body || {}, { usuario, rol });
    res.status(201).json(out);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
};

const actualizar = async (req, res) => {
  try {
    const out = await svc.actualizar(req.db, Number(req.params.id), req.body || {});
    res.json(out);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
};

const eliminar = async (req, res) => {
  try {
    const { usuario } = userInfo(req);
    const out = await svc.eliminar(req.db, Number(req.params.id), { usuario });
    res.json(out);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
};

module.exports = { listar, obtener, crear, actualizar, eliminar };
