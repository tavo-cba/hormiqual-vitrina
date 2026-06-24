const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/dosificacionController");
const { verifyJwt } = require("../middlewares/verifyToken");
const { cacheResponse } = require("../cache");

/* ─────────────  CRUD Dosificación  ───────────── */
router.get("/",       verifyJwt, ctrl.getDosificaciones);
router.get("/:id(\\d+)", verifyJwt, ctrl.getDosificacion);
router.post("/",      verifyJwt, ctrl.createDosificacion);
router.put("/:id(\\d+)",  verifyJwt, ctrl.updateDosificacion);
router.delete("/:id(\\d+)", verifyJwt, ctrl.deleteDosificacion);

/* ─────────────  Importar Excel  ───────────── */
router.post("/importar", verifyJwt, ctrl.importarDosificaciones);

/* ─────────────  Catálogos para los dropdowns  ───────────── */
router.get("/catalogos/basicos", verifyJwt, cacheResponse('catalogos', 3600), ctrl.getCatalogosBasicos);

module.exports = router;
