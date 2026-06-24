'use strict';

const express = require('express');
const multer = require('multer');
const router = express.Router();
const ctrl = require('../controllers/curvaCementoController');
const { verifyJwt } = require('../middlewares/verifyToken');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/analizar-pdf', verifyJwt, upload.single('pdf'), ctrl.analizarPdf);

router.get('/',     verifyJwt, ctrl.getCurvasCemento);
router.get('/:id',  verifyJwt, ctrl.getCurvaCemento);
router.post('/',    verifyJwt, ctrl.createCurvaCemento);
router.put('/:id',  verifyJwt, ctrl.updateCurvaCemento);
router.delete('/:id', verifyJwt, ctrl.deleteCurvaCemento);

module.exports = router;
