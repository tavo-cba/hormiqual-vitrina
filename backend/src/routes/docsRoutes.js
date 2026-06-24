'use strict';

/**
 * Endpoint para servir documentos operativos en formato markdown desde
 * `hormiqual-backend/docs/`. La idea es tener UNA SOLA fuente de verdad
 * (el .md versionado) accesible tanto vía editor (devs) como dentro de
 * la app (operarios) — sin duplicar el contenido en frontend.
 *
 * Whitelist explícita por seguridad: cualquier nombre fuera de la lista
 * devuelve 404. No exponemos archivos arbitrarios del filesystem ni
 * permitimos `..` u otros traversals.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

const router = express.Router();

// Whitelist de docs accesibles vía API. Cuando se agregue una doc nueva
// que deba ser visible desde la UI, sumarla acá.
const DOCS_ACCESIBLES = Object.freeze({
  'etiquetado-probetas': {
    file: 'etiquetado-probetas.md',
    titulo: 'Etiquetado de probetas con QR',
    rolesRequeridos: [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN],
  },
});

const DOCS_DIR = path.resolve(__dirname, '..', '..', 'docs');

router.get('/:slug', verifyJwt, async (req, res) => {
  const meta = DOCS_ACCESIBLES[req.params.slug];
  if (!meta) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }
  // Validación de rol específica del documento.
  const userRoles = (req.user?.roles || []).map((r) => (typeof r === 'string' ? r : r?.nombreRol)).filter(Boolean);
  const tieneAcceso = req.user?.isAdmin
    || meta.rolesRequeridos.some((r) => userRoles.includes(r));
  if (!tieneAcceso) {
    return res.status(403).json({ error: 'Sin permisos para ver este documento' });
  }
  try {
    const filePath = path.join(DOCS_DIR, meta.file);
    // Defense in depth: filePath debe seguir bajo DOCS_DIR.
    if (!filePath.startsWith(DOCS_DIR + path.sep) && filePath !== DOCS_DIR) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    const contenido = await fs.promises.readFile(filePath, 'utf8');
    res.json({
      slug: req.params.slug,
      titulo: meta.titulo,
      contenido,
    });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    console.error('Error leyendo doc:', err);
    res.status(500).json({ error: 'Error al cargar el documento' });
  }
});

// Para que el frontend pueda enumerar docs disponibles si se quiere.
const ensureRoleMatchesUser = (meta, user) => {
  const userRoles = (user?.roles || []).map((r) => (typeof r === 'string' ? r : r?.nombreRol)).filter(Boolean);
  return user?.isAdmin || meta.rolesRequeridos.some((r) => userRoles.includes(r));
};

router.get('/', verifyJwt, (req, res) => {
  const lista = Object.entries(DOCS_ACCESIBLES)
    .filter(([, meta]) => ensureRoleMatchesUser(meta, req.user))
    .map(([slug, meta]) => ({ slug, titulo: meta.titulo }));
  res.json(lista);
});

module.exports = router;
