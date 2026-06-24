// /routes/archivoRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireAdmin } = require('../middlewares/permissions');
const archivoController = require('../controllers/archivoController');

/* --- Categorías de archivos --- */
router.post('/categorias', verifyJwt, requireAdmin, archivoController.createCategoria);
router.get('/categorias', verifyJwt, archivoController.getCategorias);
router.put('/categorias/:id', verifyJwt, requireAdmin, archivoController.updateCategoria);
router.delete('/categorias/:id', verifyJwt, requireAdmin, archivoController.deleteCategoria);

router.get('/', verifyJwt, archivoController.getArchivos);
router.put('/:id', verifyJwt, archivoController.updateArchivo);
router.get('/:id/download', verifyJwt, archivoController.downloadArchivo);
router.get('/:id', verifyJwt, archivoController.getArchivo);
router.post(
  '/s3-only',
  verifyJwt,
  upload.single('file'),
  archivoController.uploadS3Only
);

router.post(
  '/',
  verifyJwt,
  upload.array('files', 25),
  archivoController.uploadArchivo
);
router.delete('/:id', verifyJwt, archivoController.deleteArchivo);



module.exports = router;
