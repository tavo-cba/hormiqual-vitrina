'use strict';

const express = require('express');
const router = express.Router();
const { verifyJwt } = require('../middlewares/verifyToken');
const svc = require('../services/alertaCalidadService');

// Listar alertas (con filtros)
router.get('/', verifyJwt, async (req, res) => {
  try {
    const result = await svc.listarAlertas(req.db, req.query);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Contar pendientes (para badge)
router.get('/pendientes/count', verifyJwt, async (req, res) => {
  try {
    const count = await svc.contarPendientes(req.db, {
      idPlanta: req.query.idPlanta,
      // Bug 2 / 2026-05-29: contar solo las asignadas al usuario para el badge personal.
      asignadaA: req.query.asignadaA,
    });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Marcar como leída
router.post('/:id/leer', verifyJwt, async (req, res) => {
  try {
    const result = await svc.marcarLeida(req.db, Number(req.params.id), req.body.usuario);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Resolver
router.post('/:id/resolver', verifyJwt, async (req, res) => {
  try {
    const result = await svc.resolver(req.db, Number(req.params.id), req.body);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ignorar
router.post('/:id/ignorar', verifyJwt, async (req, res) => {
  try {
    const result = await svc.ignorar(req.db, Number(req.params.id), req.body.usuario);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ejecutar verificación manual de vencimientos
router.post('/verificar-vencimientos', verifyJwt, async (req, res) => {
  try {
    const alertas = await svc.verificarVencimientosEnsayos(req.db);
    const resueltas = await svc.autoResolverVencimientos(req.db);
    res.json({ alertasCreadas: alertas.length, alertasAutoResueltas: resueltas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
