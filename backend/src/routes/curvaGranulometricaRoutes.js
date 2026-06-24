const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/curvaGranulometricaController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Importar catálogo IRAM 1627:1997 completo (admin)
router.post('/import/iram1627', verifyJwt, ctrl.importIRAM1627);

// [VITRINA] fuera de alcance: el sistema usa solo normas IRAM.
// router.post('/import/astm-c33', verifyJwt, ctrl.importASTMC33);

// Importar curvas desde JSON
router.post('/import/json', verifyJwt, ctrl.importCurvasJson);

// Exportar curvas seleccionadas a JSON
router.post('/export', verifyJwt, ctrl.exportCurvas);

// Catálogo de curvas para selector (filtrado ligero, sin puntos completos)
router.get('/catalogo', verifyJwt, ctrl.getCatalogo);

// Comparar granulometría contra una curva (antes de /:id para que no colisione)
router.post('/comparar', verifyJwt, ctrl.compararGranulometria);

// Generar puntos de preview (sin persistir)
router.post('/generate-points', verifyJwt, ctrl.generatePoints);

// Regenerar puntos de una curva teórica desde sus parámetros
router.post('/:id/regenerar', verifyJwt, ctrl.regenerarCurva);

// Serie de datos de una curva para overlay en charts
router.get('/:id/serie', verifyJwt, ctrl.getSerie);

// CRUD de curvas granulométricas
router.get('/',    verifyJwt, ctrl.getCurvas);
router.get('/:id', verifyJwt, ctrl.getCurva);
router.post('/',   verifyJwt, ctrl.createCurva);
router.put('/:id', verifyJwt, ctrl.updateCurva);
router.delete('/:id', verifyJwt, ctrl.deleteCurva);

module.exports = router;
