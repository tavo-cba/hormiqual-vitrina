// backend/routes/ordersRoutes.js
const express = require('express');
const router = express.Router();
const empleadoController = require('../controllers/empleadoController');
const { verifyJwt } = require('../middlewares/verifyToken');
const multer          = require('multer');
const upload = multer(); 

router.post(
  '/:id/avatar',
  upload.single('files'),              
  empleadoController.uploadAvatar,
);
router.post(
  '/:id/firma',
  upload.single('files'),
  empleadoController.uploadFirma,
);
router.get('/bajas', verifyJwt, empleadoController.getEmpleadosBaja);
//Roles
router.get('/roles', verifyJwt, empleadoController.getRoles);
router.post('/rol', verifyJwt, empleadoController.createRol);
router.delete('/rol/:id', verifyJwt, empleadoController.deleteRol);
router.post('/convenio/txt', verifyJwt, empleadoController.generateTxtConvenio);
router.get('/convenios', verifyJwt, empleadoController.getConvenios);
router.put('/salarios', verifyJwt, empleadoController.updateSalariosBrutos);
router.get('/:id', verifyJwt, empleadoController.getEmpleado);
router.get('/', verifyJwt, empleadoController.getEmpleados);
router.post('/', verifyJwt, empleadoController.createEmpleado);
router.put('/:id', verifyJwt, empleadoController.updateEmpleado);
router.put('/:id/baja', verifyJwt, empleadoController.bajaEmpleado);
router.delete('/:id', verifyJwt, empleadoController.deleteEmpleado);



module.exports = router;
