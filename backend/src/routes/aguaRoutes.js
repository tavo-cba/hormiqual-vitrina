'use strict';
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/aguaController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, ctrl.getAll);
router.get('/:id', verifyJwt, ctrl.getOne);
router.post('/', verifyJwt, ctrl.create);
router.put('/:id', verifyJwt, ctrl.update);
router.delete('/:id', verifyJwt, ctrl.remove);
router.post('/restore', verifyJwt, ctrl.restore);

module.exports = router;
