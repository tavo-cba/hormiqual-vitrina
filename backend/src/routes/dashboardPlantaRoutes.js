'use strict';

const express = require('express');
const router = express.Router();
const { verifyJwt } = require('../middlewares/verifyToken');

router.get('/', verifyJwt, async (req, res) => {
  try {
    const { getDashboard } = require('../services/dashboardPlantaService');
    const idPlanta = req.query.idPlanta;
    if (!idPlanta) return res.status(400).json({ error: 'idPlanta requerido' });
    const data = await getDashboard(req.db, Number(idPlanta));
    res.json(data);
  } catch (err) {
    console.error('[dashboard-planta]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
