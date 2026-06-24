const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireAdmin } = require('../middlewares/permissions');

router.get('/', verifyJwt, requireAdmin, userController.getUsers);
router.get('/:id', verifyJwt, requireAdmin, userController.getUser);
router.post('/', verifyJwt, requireAdmin, userController.createUser);
router.put('/:id', verifyJwt, requireAdmin, userController.updateUser);
router.delete('/:id', verifyJwt, requireAdmin, userController.deleteUser);

module.exports = router;