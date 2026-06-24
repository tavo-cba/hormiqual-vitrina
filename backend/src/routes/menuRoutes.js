const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menuController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireAdmin } = require('../middlewares/permissions');

router.get('/', verifyJwt, requireAdmin, menuController.getMenus);
router.get('/user', verifyJwt, menuController.getMenusForUser);

// Cross-tenant admin (solo desde MASTER_TENANT, validación en el controller)
router.get('/admin/tenants', verifyJwt, requireAdmin, menuController.adminListTenants);
router.get('/admin/tenant/:tenant', verifyJwt, requireAdmin, menuController.adminGetMenusOfTenant);
router.post('/admin/multi', verifyJwt, requireAdmin, menuController.adminCreateMenuMulti);
router.put('/admin/tenant/:tenant/:id/reorder', verifyJwt, requireAdmin, menuController.adminReorderMenu);
router.put('/admin/tenant/:tenant/:id', verifyJwt, requireAdmin, menuController.adminUpdateMenu);
router.delete('/admin/tenant/:tenant/:id', verifyJwt, requireAdmin, menuController.adminDeleteMenu);

router.post('/', verifyJwt, requireAdmin, menuController.createMenu);
router.put('/:id/reorder', verifyJwt, requireAdmin, menuController.reorderMenu);
router.put('/:id', verifyJwt, requireAdmin, menuController.updateMenu);
router.delete('/:id', verifyJwt, requireAdmin, menuController.deleteMenu);
router.post('/:id/permissions/:userId', verifyJwt, requireAdmin, menuController.addPermission);
router.put('/:id/permissions/:userId', verifyJwt, requireAdmin, menuController.updatePermission);
router.delete('/:id/permissions/:userId', verifyJwt, requireAdmin, menuController.removePermission);

module.exports = router;