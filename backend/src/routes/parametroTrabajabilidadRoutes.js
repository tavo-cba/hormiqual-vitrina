const express = require('express');
const router = express.Router();
const controller = require('../controllers/parametroTrabajabilidadController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, controller.getAll);
router.post('/', verifyJwt, controller.create);
router.put('/:id', verifyJwt, controller.update);
router.delete('/:id', verifyJwt, controller.remove);

module.exports = router;
