// backend/routes/aditivoRoutes.js
const express = require("express");
const router = express.Router();
const aditivoController = require("../controllers/aditivoController");
const { verifyJwt } = require("../middlewares/verifyToken");

/* ─────────  Catálogo de unidades  ───────── */
router.get("/unidadesmedida", verifyJwt, aditivoController.getUnidadesMedida);

/* ─────────  CRUD Aditivo  ───────── */
router.get("/",          verifyJwt, aditivoController.getAditivos);
router.get("/:id",       verifyJwt, aditivoController.getAditivo);
router.post("/",         verifyJwt, aditivoController.createAditivo);
router.put("/:id",       verifyJwt, aditivoController.updateAditivo);
router.delete("/:id",    verifyJwt, aditivoController.deleteAditivo);



module.exports = router;
