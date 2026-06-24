'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tamicesController');

// GET /api/tamices/catalogo — catálogo completo (sin auth)
router.get('/catalogo', ctrl.getCatalogo);

module.exports = router;
