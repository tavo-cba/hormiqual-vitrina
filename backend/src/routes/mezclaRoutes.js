'use strict';

const express = require('express');
const router = express.Router();
const mezclaController = require('../controllers/mezclaController');
const { verifyJwt } = require('../middlewares/verifyToken');

// Agregados filtrados por planta + tipo (con estado de granulometría)
router.get('/agregados',     verifyJwt, mezclaController.getAgregadosParaMezcla);
router.get('/agregados/:id/granulometria', verifyJwt, mezclaController.getGranulometria);

// Evaluar mezcla manual
router.post('/evaluar',      verifyJwt, mezclaController.evaluarMezcla);

// Preview dynamic theoretical curve (no persistence)
router.post('/curva-teorica/preview', verifyJwt, mezclaController.previewCurvaTeorica);

// Optimizar mezcla
router.post('/optimizar',    verifyJwt, mezclaController.optimizarMezcla);

// Sugerir proporciones óptimas para materiales ya seleccionados
router.post('/sugerir-proporciones', verifyJwt, mezclaController.sugerirProporciones);

// Combined physical/chemical properties for a blend
router.post('/propiedades-combinadas', verifyJwt, mezclaController.getPropiedadesCombinadas);

// Banda IRAM 1627 normativa para un TMN dado (desde seed data autoritativo)
router.get('/banda-iram1627', verifyJwt, async (req, res) => {
  try {
    const { loadSeedData } = require('../services/importIRAM1627Service');
    const seed = loadSeedData();
    const tipo = (req.query.tipo || 'TOTAL').toUpperCase(); // FINO, GRUESO, TOTAL

    // ── FINO: single table, no TMN parameter needed ──
    if (tipo === 'FINO') {
      const finos = seed.finos;
      if (!finos?.curvas?.A || !finos?.curvas?.B || !finos?.curvas?.C) return res.json({ found: false });
      const ptsA = finos.curvas.A.puntos || [];
      const ptsB = finos.curvas.B.puntos || [];
      const ptsC = finos.curvas.C.puntos || [];
      // Finos seed uses { aberturaMm, max } — A is the most restrictive (lowest), C is most permissive (highest)
      const buildBandaFino = (cLow, cHigh) => cLow.map(pL => {
        const pH = cHigh.find(p => Math.abs(p.aberturaMm - pL.aberturaMm) < pL.aberturaMm * 0.05 + 0.01);
        return pH ? { aberturaMm: pL.aberturaMm, limInf: pL.max, limSup: pH.max } : null;
      }).filter(Boolean);
      return res.json({
        found: true,
        tipo: 'FINO',
        tablaRef: finos.referenciaTabla || 'Tabla 1',
        bandaAB: buildBandaFino(ptsA, ptsB),
        bandaAC: buildBandaFino(ptsA, ptsC),
        curvaA: ptsA.map(p => ({ aberturaMm: p.aberturaMm, target: p.max })),
        curvaB: ptsB.map(p => ({ aberturaMm: p.aberturaMm, target: p.max })),
        curvaC: ptsC.map(p => ({ aberturaMm: p.aberturaMm, target: p.max })),
      });
    }

    // ── GRUESO: rangos by TMN pair ──
    if (tipo === 'GRUESO') {
      const tmn = Number(req.query.tmnMm);
      if (!tmn) return res.status(400).json({ error: 'tmnMm requerido para gruesos' });
      const rangos = seed.gruesos?.rangos;
      if (!rangos) return res.json({ found: false });
      // Find rango matching TMN
      let rango = null;
      for (const r of Object.values(rangos)) {
        const rangoStr = r.rango || '';
        // Parse "4.75 - 19" or similar
        const parts = rangoStr.split(/\s*[-–]\s*/).map(Number);
        if (parts.length === 2 && Math.abs(parts[1] - tmn) < 1) { rango = r; break; }
      }
      if (!rango || !rango.puntos?.length) return res.json({ found: false });
      // Gruesos have min/max per sieve
      const bandaPts = rango.puntos.map(p => ({ aberturaMm: p.aberturaMm, limInf: p.min, limSup: p.max })).filter(p => p.limInf != null && p.limSup != null);
      return res.json({
        found: true,
        tipo: 'GRUESO',
        tablaRef: seed.gruesos.referenciaTabla || 'Tabla 2',
        rango: rango.rango,
        bandaAB: bandaPts, // Gruesos only have one band
        bandaAC: bandaPts,
      });
    }

    // ── TOTAL: tables by TMN ──
    const tmn = Number(req.query.tmnMm);
    if (!tmn) return res.status(400).json({ error: 'tmnMm requerido' });

    let tabla = seed.totales?.tablas?.[String(tmn)];
    if (!tabla) {
      const keys = Object.keys(seed.totales?.tablas || {}).map(Number).sort((a, b) => Math.abs(a - tmn) - Math.abs(b - tmn));
      if (keys.length > 0 && Math.abs(keys[0] - tmn) <= 5) tabla = seed.totales.tablas[String(keys[0])];
    }
    if (!tabla) return res.json({ found: false });

    const buildBanda = (cA, cRef) => cA.map(pA => {
      const pRef = cRef.find(p => Math.abs(p.aberturaMm - pA.aberturaMm) < pA.aberturaMm * 0.05 + 0.01);
      return pRef ? { aberturaMm: pA.aberturaMm, limInf: pA.target, limSup: pRef.target } : null;
    }).filter(Boolean);

    const bandaAB = tabla.curvas.A && tabla.curvas.B ? buildBanda(tabla.curvas.A, tabla.curvas.B) : null;
    const bandaAC = tabla.curvas.A && tabla.curvas.C ? buildBanda(tabla.curvas.A, tabla.curvas.C) : null;

    res.json({
      found: true,
      tipo: 'TOTAL',
      tmnMm: tabla.tmnMm || tmn,
      tablaRef: tabla.referenciaTabla,
      bandaAB, bandaAC,
      curvaA: tabla.curvas.A?.map(p => ({ aberturaMm: p.aberturaMm, target: p.target })),
      curvaB: tabla.curvas.B?.map(p => ({ aberturaMm: p.aberturaMm, target: p.target })),
      curvaC: tabla.curvas.C?.map(p => ({ aberturaMm: p.aberturaMm, target: p.target })),
    });
  } catch (err) {
    console.error('[banda-iram1627]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// CRUD mezclas guardadas (order matters: specific routes before /:id)
router.post('/',             verifyJwt, mezclaController.guardarMezcla);
router.get('/',              verifyJwt, mezclaController.listarMezclas);
router.post('/:id/duplicar',             verifyJwt, mezclaController.duplicarMezcla);
router.post('/:id/transicion',           verifyJwt, mezclaController.transicionarEstado);
router.post('/:id/nueva-version',        verifyJwt, mezclaController.crearNuevaVersion);
router.get('/:id/versiones',             verifyJwt, mezclaController.obtenerVersiones);
router.get('/:id/historial',             verifyJwt, mezclaController.obtenerHistorial);
router.get('/:id/verificar-integridad',  verifyJwt, mezclaController.verificarIntegridad);
router.get('/:id',           verifyJwt, mezclaController.getMezclaPorId);
router.put('/:id',           verifyJwt, mezclaController.actualizarMezcla);
router.delete('/:id',        verifyJwt, mezclaController.eliminarMezcla);

module.exports = router;
