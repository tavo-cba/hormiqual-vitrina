const express = require('express');
const router = express.Router();
const piletaController = require('../controllers/piletaController');
const { verifyLabApiKey } = require('../middlewares/verifyLabApiKey');

// El lab postea su estado periódicamente
router.post('/', verifyLabApiKey, piletaController.recibirReporteLaboratorio);

// El lab pollea comandos pendientes cada ~5 segundos
router.get('/comandos', verifyLabApiKey, piletaController.getComandosPendientes);

module.exports = router;
