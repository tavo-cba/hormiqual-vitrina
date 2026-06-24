'use strict';

const { buildCatalogoPayload } = require('../catalog/tamicesCatalog');

/**
 * GET /api/tamices/catalogo
 * Devuelve el catálogo completo de tamices (IRAM + ASTM + helpers).
 * Sin autenticación para que el frontend pueda cachearlo libremente.
 */
const getCatalogo = (_req, res) => {
  try {
    res.status(200).json(buildCatalogoPayload());
  } catch (error) {
    console.error('[tamices/catalogo]', error);
    res.status(500).json({ error: 'Error al obtener catálogo de tamices' });
  }
};

module.exports = { getCatalogo };
