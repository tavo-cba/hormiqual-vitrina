const express = require('express');
const router = express.Router();
const obraController = require('../controllers/obraController');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const obraEmpleadoController = require('../controllers/obraEmpleadoController');
// const obraCentroCostoController = require('../controllers/obraCentroCostoController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Obras propias (debe ir ANTES de '/:id' para no colisionar)
router.get('/propias', verifyJwt, obraController.getObrasPropias);

// Resumen económico/operativo de una obra (Fase ② — dashboard del Portal de Obra)
router.get('/:id/resumen', verifyJwt, obraController.getResumenObra);

// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// (asignación de empleados y centros de costo a obra — RRHH/costos)
// router.get('/:id/empleados', verifyJwt, obraEmpleadoController.listByObra);
// router.post('/:id/empleados', verifyJwt, obraEmpleadoController.addEmpleado);
// router.put('/empleados/:idObraEmpleado', verifyJwt, obraEmpleadoController.updateEmpleado);
// router.delete('/empleados/:idObraEmpleado', verifyJwt, obraEmpleadoController.removeEmpleado);
// router.get('/:id/centros-costo', verifyJwt, obraCentroCostoController.listByObra);
// router.post('/:id/centros-costo', verifyJwt, obraCentroCostoController.addCentroCosto);
// router.delete('/centros-costo/:idObraCentroCosto', verifyJwt, obraCentroCostoController.removeCentroCosto);

// Rutas para CRUD de Obra
router.get('/:id', verifyJwt, obraController.getObra);      // Obtener una obra por ID
router.get('/', verifyJwt, obraController.getObras);        // Obtener todas las obras
router.post('/', verifyJwt, obraController.createObra);     // Crear nueva obra
router.put('/:id', verifyJwt, obraController.updateObra);   // Actualizar obra existente
router.delete('/:id', verifyJwt, obraController.deleteObra);// Borrar obra

module.exports = router;
