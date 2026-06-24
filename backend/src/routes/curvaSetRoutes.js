'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/curvaSetController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/',    verifyJwt, ctrl.getCurvaSets);
router.get('/:id', verifyJwt, ctrl.getCurvaSet);
router.post('/',   verifyJwt, ctrl.createCurvaSet);
router.post('/iram1627/total', verifyJwt, ctrl.createIRAM1627Total);
router.put('/:id', verifyJwt, ctrl.updateCurvaSet);
router.delete('/:id', verifyJwt, ctrl.deleteCurvaSet);

module.exports = router;
