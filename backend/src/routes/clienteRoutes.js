const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/clienteController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Resumen agregado (totales por moneda + counts) — para header de clienteDetalle
router.get('/:id/resumen', verifyJwt, clienteController.getResumen);

// Resumen de cuenta corriente (PDF)
router.get('/:id/resumen-cuenta', verifyJwt, clienteController.getResumenCuenta);

// Remitos de despacho (archivos) de un cliente
router.get('/:id/remitos-despacho', verifyJwt, clienteController.getRemitosDespacho);

// Obtener un cliente por ID
router.get('/:id', verifyJwt, clienteController.getCliente);

// Obtener lista de todos los clientes
router.get('/', verifyJwt, clienteController.getClientes);

// Crear un nuevo cliente
router.post('/', verifyJwt, clienteController.createCliente);

// Actualizar un cliente existente
router.put('/:id', verifyJwt, clienteController.updateCliente);

// Borrar un cliente (borrado lógico o físico, según tu controller)
router.delete('/:id', verifyJwt, clienteController.deleteCliente);

module.exports = router;
