'use strict';
const express = require('express');
const router = express.Router();
const { verifyJwt } = require('../middlewares/verifyToken');
const svc = require('../services/placaElastomeroService');

// Listar (por laboratorio, por planta, o todas).
// La SSoT de pertenencia es `idLaboratorio` desde 2026-06-11; `idPlanta` queda
// como filtro back-compat (cache).
router.get('/', verifyJwt, async (req, res) => {
  try {
    let rows;
    if (req.query.idLaboratorio) {
      rows = await svc.listarPorLaboratorio(req.db, Number(req.query.idLaboratorio));
    } else if (req.query.idPlanta) {
      rows = await svc.listarPorPlanta(req.db, Number(req.query.idPlanta));
    } else {
      rows = await svc.listarTodas(req.db);
    }
    res.json(rows.map(r => r.get ? r.get({ plain: true }) : r));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stock de una planta (legacy)
router.get('/stock/:idPlanta', verifyJwt, async (req, res) => {
  try {
    const rows = await svc.getStock(req.db, Number(req.params.idPlanta));
    res.json(rows.map(r => r.get({ plain: true })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stock de un laboratorio
router.get('/stock-lab/:idLaboratorio', verifyJwt, async (req, res) => {
  try {
    const rows = await svc.getStockPorLaboratorio(req.db, Number(req.params.idLaboratorio));
    res.json(rows.map(r => r.get({ plain: true })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Activas de una prensa
router.get('/activas/:idPrensa', verifyJwt, async (req, res) => {
  try {
    const rows = await svc.getActivasPorPrensa(req.db, req.params.idPrensa);
    res.json(rows.map(r => r.get({ plain: true })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Estado para formulario de ensayo
router.get('/estado-ensayo', verifyJwt, async (req, res) => {
  try {
    const { idPrensa, diametroProbetaMm } = req.query;
    const estado = await svc.getEstadoParaEnsayo(req.db, idPrensa, Number(diametroProbetaMm || 0));
    res.json(estado);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear (va a stock). Acepta opcionalmente `control` con los 4 checks de
// recepción + observaciones (se persiste en ControlRecepcionPlaca).
router.post('/', verifyJwt, async (req, res) => {
  try {
    const placa = await svc.crearJuego(req.db, { ...req.body, creadoPor: req.body.usuario || null });
    res.status(201).json(placa.get({ plain: true }));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Crear lote con varios juegos distribuidos entre laboratorios.
// Body: { durezaShoreA, fechaAlta?, marca?, observaciones?, distribucion: [{ idLaboratorio, cantidadPG, cantidadPC }] }
router.post('/lote-multiple', verifyJwt, async (req, res) => {
  try {
    const creadas = await svc.crearLoteMultiple(req.db, { ...req.body, creadoPor: req.body.usuario || null });
    res.status(201).json({ cantidad: creadas.length, placas: creadas });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Cargar / actualizar el control de recepción de una placa (1:1).
router.post('/:id/control-recepcion', verifyJwt, async (req, res) => {
  try {
    const control = await svc.setControlRecepcion(req.db, Number(req.params.id), {
      ...req.body,
      controladoPor: req.body.controladoPor || req.body.usuario || null,
    });
    res.json(control);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Activar en prensa(s) (stock → en uso). Acepta `idPrensa` (string, back-compat)
// o `idPrensas` (array de strings). Todas deben pertenecer al mismo laboratorio.
router.post('/:id/activar', verifyJwt, async (req, res) => {
  try {
    const payload = Array.isArray(req.body.idPrensas) ? req.body.idPrensas : req.body.idPrensa;
    const result = await svc.activarEnPrensa(req.db, Number(req.params.id), payload);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Registrar uso (desde ensayo de rotura)
router.post('/registrar-uso', verifyJwt, async (req, res) => {
  try {
    const { idPrensa, diametroProbetaMm } = req.body;
    if (!idPrensa || !diametroProbetaMm) return res.status(422).json({ error: 'idPrensa y diametroProbetaMm requeridos' });
    const result = await svc.registrarUso(req.db, idPrensa, Number(diametroProbetaMm));
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Extender uso (+1)
router.post('/:id/extender', verifyJwt, async (req, res) => {
  try {
    const result = await svc.extenderUso(req.db, Number(req.params.id));
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Descartar
router.post('/:id/descartar', verifyJwt, async (req, res) => {
  try {
    const placa = await svc.descartar(req.db, Number(req.params.id), req.body);
    res.json(placa);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Tabla IRAM 1709
router.get('/tabla-iram1709', verifyJwt, (req, res) => {
  res.json({ tabla: svc.TABLA_REUSOS, extensionMaxPct: svc.EXTENSION_MAX_PCT });
});

module.exports = router;
