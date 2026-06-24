'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/rolCalidadController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireAdmin } = require('../middlewares/permissions');

// Catálogo (lectura): cualquier usuario autenticado puede leerlo (lo necesita
// la UI para mostrar etiquetas legibles).
router.get('/catalogo', verifyJwt, ctrl.getCatalogo);

// Listado y mutación: sólo admin del sistema. La asignación de roles de
// Calidad es una tarea de configuración de seguridad.
router.get('/usuarios', verifyJwt, requireAdmin, ctrl.listarCandidatos);
router.put('/usuarios/:id', verifyJwt, requireAdmin, ctrl.asignarRol);

module.exports = router;
