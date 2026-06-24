const express = require("express");
const router = express.Router();
const fibraController = require("../controllers/fibraController");
const { verifyJwt } = require("../middlewares/verifyToken");



/* ─────────  CRUD Fibra  ───────── */
router.get("/",          verifyJwt, fibraController.getFibras);
router.get("/:id",       verifyJwt, fibraController.getFibra);
router.post("/",         verifyJwt, fibraController.createFibra);
router.put("/:id",       verifyJwt, fibraController.updateFibra);
router.delete("/:id",    verifyJwt, fibraController.deleteFibra);



module.exports = router;
