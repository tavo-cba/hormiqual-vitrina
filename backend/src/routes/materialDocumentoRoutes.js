const express = require('express');
const router = express.Router();
const multer = require('multer');
const materialDocumentoController = require('../controllers/materialDocumentoController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Memory storage — we write to disk manually in the service for hashing + controlled path
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// POST   /api/calidad/materiales/:materialTipo/:materialId/documentos
router.post(
  '/materiales/:materialTipo/:materialId/documentos',
  verifyJwt,
  upload.single('file'),
  materialDocumentoController.uploadDocumento
);

// GET    /api/calidad/materiales/:materialTipo/:materialId/documentos
router.get(
  '/materiales/:materialTipo/:materialId/documentos',
  verifyJwt,
  materialDocumentoController.getDocumentos
);

// GET    /api/calidad/documentos/:archivoId/download
router.get(
  '/documentos/:archivoId/download',
  verifyJwt,
  materialDocumentoController.downloadArchivo
);

// GET    /api/calidad/materiales/documentos/:materialDocumentoId
router.get(
  '/materiales/documentos/:materialDocumentoId',
  verifyJwt,
  materialDocumentoController.getDocumento
);

// PUT    /api/calidad/materiales/documentos/:materialDocumentoId/revision
router.put(
  '/materiales/documentos/:materialDocumentoId/revision',
  verifyJwt,
  materialDocumentoController.guardarRevision
);

// DELETE /api/calidad/materiales/documentos/:materialDocumentoId
router.delete(
  '/materiales/documentos/:materialDocumentoId',
  verifyJwt,
  materialDocumentoController.deleteDocumento
);

// POST   /api/calidad/materiales/documentos/:materialDocumentoId/extraccion/run
router.post(
  '/materiales/documentos/:materialDocumentoId/extraccion/run',
  verifyJwt,
  materialDocumentoController.runExtraccion
);

// POST   /api/calidad/materiales/documentos/:materialDocumentoId/extraccion/revisado
router.post(
  '/materiales/documentos/:materialDocumentoId/extraccion/revisado',
  verifyJwt,
  materialDocumentoController.marcarRevisado
);

module.exports = router;
