// backend/routes/ordersRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/user', verifyJwt, authController.getUser);
router.post('/login', authController.login);
router.post('/verify', authController.verifyToken);

module.exports = router;
