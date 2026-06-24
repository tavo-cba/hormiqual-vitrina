'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dosificacionDisenoController');
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

// ============================================================================
// RBAC — Gating por jerarquía prescriptiva.
//
// Filosofía: la flexibilidad para empresas chicas viene de asignar el rol
// adecuado en `User.rolCalidad`. Un OPERADOR no aprueba; si esa persona
// necesita aprobar, se le sube a RESPONSABLE_CALIDAD desde Administración
// de Roles.
//
// Refactor 2026-05-20: la capa de "cliente externo" se revirtió en la misma
// sesión que se introdujo. No hay portal cliente activo. Si se retoma, se
// reintroducirá el middleware específico con el caso de uso a la vista.
// ============================================================================
const ROLES_INTERNOS = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_OPERATIVOS = [ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN];
const ROLES_CATALOGO = [ROLES.RESPONSABLE, ROLES.ADMIN];

// ============================================================================
// Enriquecimiento común para sugerir-mezclas y preview-mezcla. Carga bandas,
// curvas ICPA, precios, aditivo preseleccionado y calcula aptitudSummary por
// material. Muta `materiales` (agrega aptitudSummary) y `parametros` (agrega
// _bandasPorTMN, _aguaCurvasICPA, _acCurvasICPA, _preciosMateriales,
// _reduccionAguaAditivoPct, _aptitudCtx).
// ============================================================================
async function enriquecerParametrosYMateriales(req, materiales, parametros, tag = 'enrich') {
  // 1) Bandas IRAM 1627 A-B y A-C
  try {
    const { loadSeedData } = require('../services/importIRAM1627Service');
    const seed = loadSeedData();
    const buildBanda = (curvaLow, curvaHigh) => curvaLow.map(pA => {
      const pRef = curvaHigh.find(p => Math.abs(p.aberturaMm - pA.aberturaMm) < pA.aberturaMm * 0.05 + 0.01);
      return pRef ? { aberturaMm: pA.aberturaMm, limInfPct: pA.target, limSupPct: pRef.target } : null;
    }).filter(Boolean);
    const bandasPorTMN = {};
    for (const [tmnKey, tabla] of Object.entries(seed.totales?.tablas || {})) {
      if (tabla.curvas?.A && tabla.curvas?.B) {
        bandasPorTMN[tmnKey] = {
          bandaAB: buildBanda(tabla.curvas.A, tabla.curvas.B),
          bandaAC: tabla.curvas.C ? buildBanda(tabla.curvas.A, tabla.curvas.C) : null,
        };
      }
    }
    parametros._bandasPorTMN = bandasPorTMN;
  } catch (e) { console.warn(`[${tag}] Band loading skipped:`, e.message); }

  // 2) Curvas ICPA de agua y a/c
  try {
    const { getAbacoCurvaICPA, getCurvasACResistencia } = require('../services/dosificacionDisenoService');
    const [aguaCurvas, acCurvas] = await Promise.all([
      getAbacoCurvaICPA(req.db),
      getCurvasACResistencia(req.db),
    ]);
    if (aguaCurvas?.length) parametros._aguaCurvasICPA = aguaCurvas;
    if (acCurvas?.length) parametros._acCurvasICPA = acCurvas;
  } catch (e) { console.warn(`[${tag}] ICPA curves loading skipped:`, e.message); }

  // 3) Precios de materiales (opcional)
  try {
    if (req.db.MaterialPrecio) {
      const precios = await req.db.MaterialPrecio.findAll({
        where: { activo: true },
        order: [['fechaVigencia', 'DESC']],
        raw: true,
      });
      const precioMap = {};
      for (const p of precios) {
        const key = p.materialId || p.idAgregado || p.legacyAgregadoId;
        if (key && !precioMap[key]) precioMap[key] = Number(p.precioUnitario || p.precio || 0);
      }
      if (Object.keys(precioMap).length > 0) parametros._preciosMateriales = precioMap;
    }
  } catch { /* non-blocking */ }

  // 4) Aditivo preseleccionado (para estimar reducción de agua sobre cemento)
  try {
    const { seleccionarAditivos } = require('../domain/dosificacion/seleccionAditivosEngine');
    const aditivos = await req.db.Aditivo.findAll({ where: { activo: true }, raw: true });
    const aditivosPre = seleccionarAditivos(aditivos, parametros);
    if (aditivosPre?.dosisPrincipal?.reduccionAguaPct) {
      parametros._reduccionAguaAditivoPct = aditivosPre.dosisPrincipal.reduccionAguaPct;
    }
  } catch { /* non-blocking */ }

  // 5) Aptitud por material según contexto del destino
  try {
    if (req.db.AgregadoEnsayo) {
      const { buildAptitudSummary } = require('../domain/dosificacion/aptitudMaterialesService');
      const { getCanonicalCodigo } = require('../domain/ensayoResultRegistry');

      const CODE_MAP_AF = {
        'IRAM1647_TERRONES_ARCILLA': 'terronesArcilla',
        'IRAM1674_MATERIAL_FINO_200': 'pasante200',
        'IRAM1540_PASA200': 'pasante200',
        'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
        'IRAM1647_SULFATOS_SO3': 'sulfatos',
        'IRAM1647_SALES_SOLUBLES': 'salesSolubles',
        'IRAM1882_CLORUROS_SOLUBLES': 'cloruros',
        'IRAM1647_MATERIA_ORGANICA': 'materiaOrganica',
      };
      const CODE_MAP_AG = {
        'IRAM1647_TERRONES_ARCILLA': 'terronesArcilla',
        'IRAM1674_MATERIAL_FINO_200': 'pasante200',
        'IRAM1647_MATERIAS_CARBONOSAS': 'materiasCarb',
        'IRAM1647_SULFATOS_SO3': 'sulfatos',
        'IRAM1647_SALES_SOLUBLES': 'salesSolubles',
        'IRAM1882_CLORUROS_SOLUBLES': 'cloruros',
        'IRAM1687_1_LAJOSIDAD': 'lajosidad',
        'IRAM1687_2_ELONGACION': 'elongacion',
        'IRAM1532_DESGASTE_LA': 'desgasteLA',
        'IRAM1532_LOS_ANGELES': 'desgasteLA',
        'IRAM1525_DURABILIDAD_SULFATO': 'durabilidad',
      };
      const ctxAptitud = {
        expuestoDesgaste: !!parametros.expuestoDesgaste,
        aspectoSuperficialImportante: !!parametros.aspectoSuperficial || !!parametros.aspectoSuperficialImportante,
        tipoArmadura: parametros.tipoArmadura || parametros.tipoHormigonEstructural || 'armado',
        claseExposicion: parametros.claseExposicion || null,
        fc: parametros.fc || null,
      };

      for (const m of materiales) {
        // Skip si ya viene con aptitudSummary del cliente (preview post-sugerencia)
        if (m.aptitudSummary) continue;
        try {
          const isFino = (m.tipo || '').toUpperCase() === 'FINO';
          const codeMap = isFino ? CODE_MAP_AF : CODE_MAP_AG;
          const ensayos = await req.db.AgregadoEnsayo.findAll({
            where: { legacyAgregadoId: m.id, isActive: true },
            include: [{ model: req.db.AgregadoEnsayoTipo, as: 'tipo' }],
            order: [['fechaEnsayo', 'DESC']],
          });
          const ensayoMap = {};
          for (const e of ensayos) {
            const codigo = getCanonicalCodigo(e.tipo?.codigo || '');
            const mapKey = codeMap[codigo];
            if (mapKey && !ensayoMap[mapKey]) {
              let resultado = e.resultado;
              if (typeof resultado === 'string') try { resultado = JSON.parse(resultado); } catch { resultado = {}; }
              resultado = resultado || {};
              ensayoMap[mapKey] = {
                valor: resultado.valor ?? resultado.terronesPct ?? resultado.pasa200Pct
                  ?? resultado.materiasCarbonosaPct ?? resultado.salesSolublesPct
                  ?? resultado.sulfatosSO3Pct ?? resultado.losAngelesPct
                  ?? resultado.lajosidadPct ?? resultado.elongacionPct
                  ?? resultado.perdidaPct ?? null,
                fecha: e.fechaEnsayo,
                informe: e.nroInforme,
                operador: resultado.operador || (resultado.esMenorQue ? 'menor_que' : null),
                resultadoColorimetrico: resultado.resultadoColorimetrico || null,
                excepcionValida: resultado.excepcionValida || false,
                excepcionPct: resultado.excepcionPct || null,
              };
            }
          }
          m.aptitudSummary = buildAptitudSummary({ tipo: m.tipo, subtipoMaterial: m.subtipoMaterial }, ensayoMap, ctxAptitud);
        } catch (eMat) {
          console.warn(`[${tag}] aptitud para material ${m.id} no disponible:`, eMat.message);
        }
      }
      parametros._aptitudCtx = ctxAptitud;
    }
  } catch (e) {
    console.warn(`[${tag}] enriquecimiento de aptitud skipped:`, e.message);
  }
}

// Curvas de diseño — agua vs asentamiento
// GET: lectura interna autenticada. POST/PUT/DELETE: catálogo del tenant (RESPONSABLE+).
router.get('/curvas/agua-asentamiento',      verifyJwt, ctrl.getCurvasAgua);
router.post('/curvas/agua-asentamiento',     verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.createCurvaAgua);
router.put('/curvas/agua-asentamiento/:id',  verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.updateCurvaAgua);
router.delete('/curvas/agua-asentamiento/:id', verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.deleteCurvaAgua);

// Curvas de diseño — a/c vs resistencia
router.get('/curvas/ac-resistencia',         verifyJwt, ctrl.getCurvasAC);
router.post('/curvas/ac-resistencia',        verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.createCurvaAC);

// Factor de ajuste ICPA por familia (BEFORE :id routes to avoid param collision)
router.get('/curvas/ac-resistencia/factor-ajuste/:familia', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const factor = await svc.getFactorAjusteFamilia(req.db, req.params.familia);
    res.json({ familiaCemento: req.params.familia, factorAjuste: factor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/curvas/ac-resistencia/factor-ajuste/:familia', verifyJwt, requireRole(...ROLES_CATALOGO), async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const result = await svc.updateFactorAjusteFamilia(req.db, req.params.familia, req.body.factorAjuste);
    res.json(result);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/curvas/ac-resistencia/:id',     verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.updateCurvaAC);
router.delete('/curvas/ac-resistencia/:id',  verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.deleteCurvaAC);

// Aire esperado (read-only for now)
router.get('/curvas/aire-esperado',          verifyJwt, ctrl.getAire);

// Ábaco 1 ICPA — agua base f(asentamiento, MF)
router.get('/curvas/abaco-icpa',                 verifyJwt, ctrl.getAbaco);
router.post('/curvas/abaco-icpa',                verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.createAbaco);
router.put('/curvas/abaco-icpa/:id',             verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.updateAbaco);
router.delete('/curvas/abaco-icpa/:id',          verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.deleteAbaco);
// Restaurar valores ICPA originales — sobrescribe toda la tabla con los
// defaults de referencia. Requiere confirmación previa en la UI.
router.post('/curvas/abaco-icpa/restore-defaults', verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.restoreAbacoDefaults);

// Correctores metodológicos ICPA — feature deprecada, pestaña UI eliminada.
// Endpoint GET se mantiene para callers internos del motor durante el período
// de transición; los endpoints write se cerraron por inconsistencia de uso.
router.get('/curvas/correctores-icpa',           verifyJwt, ctrl.getCorrectores);

// Durabilidad por exposición — Tabla 2.5 CIRSOC 200:2024 (read-only: valor normativo)
router.get('/curvas/durabilidad-exposicion', verifyJwt, ctrl.getDurabilidad);

// Consistencia — Tablas 4.1/4.2 CIRSOC 200:2024 (read-only: valor normativo)
router.get('/curvas/consistencia',               verifyJwt, ctrl.getConsistencia);

// Aire durabilidad — Tabla 4.3 CIRSOC 200:2024 (read-only: valor normativo)
router.get('/curvas/aire-durabilidad',           verifyJwt, ctrl.getAireDurabilidad);

// Hormigones con características particulares — Tabla 9.3 CIRSOC 200:2024
// (read-only: valor normativo)
router.get('/curvas/hormigon-particular', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/hormigonParticularService');
    const rows = await svc.listar(req.db, { tipoHormigon: req.query.tipoHormigon });
    res.json(rows);
  } catch (err) { res.status(err.statusCode || 500).json({ error: err.message }); }
});

// Pulverulento mínimo — Tabla 4.4 CIRSOC 200:2024 (read-only: valor normativo)
router.get('/curvas/pulverulento-minimo',        verifyJwt, ctrl.getPulverulentoMinimo);

// Factores de edad por tipo de cemento
router.get('/curvas/factores-edad',             verifyJwt, ctrl.getFactoresEdad);
router.post('/curvas/factores-edad',            verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.createFactorEdad);
router.put('/curvas/factores-edad/:id',         verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.updateFactorEdad);
router.delete('/curvas/factores-edad/:id',      verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.deleteFactorEdad);

// Cálculo — operación interna disponible para todos los roles internos.
router.post('/calcular',                    verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.calcular);

// Sugerencia de mezclas
router.post('/sugerir-mezclas', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const { generarSugerencias } = require('../domain/dosificacion/sugerenciaMezclaEngine');
    const { materiales, parametros } = req.body;
    if (!materiales?.length) return res.status(400).json({ error: 'materiales[] requerido' });
    if (!parametros) return res.status(400).json({ error: 'parametros requerido' });

    await enriquecerParametrosYMateriales(req, materiales, parametros, 'sugerir-mezclas');

    const sugerencias = generarSugerencias(materiales, parametros, parametros.maxResultados || 4);

    // Attach band points to each suggestion's _meta for frontend chart rendering
    for (const sug of sugerencias) {
      if (!sug._meta) continue;
      const tmn = sug.indicadores?.tmn;
      if (tmn && parametros._bandasPorTMN) {
        const tmnKey = String(tmn);
        const closest = Object.keys(parametros._bandasPorTMN)
          .map(Number).sort((a, b) => Math.abs(a - tmn) - Math.abs(b - tmn))[0];
        const banda = parametros._bandasPorTMN[tmnKey] || (closest && Math.abs(closest - tmn) <= 5 ? parametros._bandasPorTMN[String(closest)] : null);
        if (banda) {
          sug._meta.bandaPuntos = banda.bandaAC || banda.bandaAB; // widest band for chart
          sug._meta.bandaAB = banda.bandaAB;
          sug._meta.bandaAC = banda.bandaAC;
        }
      }
    }

    // Enrich with additive recommendations
    let aditivosRecomendados = null;
    try {
      const { seleccionarAditivos } = require('../domain/dosificacion/seleccionAditivosEngine');
      const db = req.db;
      const aditivos = await db.Aditivo.findAll({ where: { activo: true }, raw: true });
      aditivosRecomendados = seleccionarAditivos(aditivos, parametros);
    } catch (e) { console.warn('[sugerir-mezclas] Error seleccionando aditivos:', e.message); }

    res.json({ sugerencias, totalCombinaciones: sugerencias.length, aditivosRecomendados });
  } catch (err) {
    console.error('[sugerir-mezclas]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Preview de una combinación ya elegida: evalúa indicadores para proporciones
// específicas sin optimizar. Lo usa el editor interactivo del frontend para
// mostrar MF/TMN/FdG/FdT/FdA/zona/suma nocivas pond. en vivo a medida que
// el usuario ajusta los porcentajes de cada fracción.
router.post('/preview-mezcla', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const { evaluarCombinacionStandalone } = require('../domain/dosificacion/sugerenciaMezclaEngine');
    const { componentes, proporciones, parametros } = req.body;
    if (!Array.isArray(componentes) || componentes.length === 0) {
      return res.status(400).json({ error: 'componentes[] requerido' });
    }
    if (!Array.isArray(proporciones) || proporciones.length !== componentes.length) {
      return res.status(400).json({ error: 'proporciones[] debe coincidir en longitud con componentes[]' });
    }
    if (!parametros) return res.status(400).json({ error: 'parametros requerido' });

    // Validación de Σ: el editor del frontend debe mandar porcentajes que sumen 100.
    const suma = proporciones.reduce((a, b) => a + Number(b || 0), 0);
    if (Math.abs(suma - 100) > 0.5) {
      return res.status(422).json({ error: `La suma de proporciones debe ser 100 (recibida: ${suma.toFixed(2)}).` });
    }

    // Enrich parámetros y materiales. Si el frontend ya mandó aptitudSummary
    // por componente, enriquecerParametrosYMateriales lo respeta y solo completa
    // lo que falta.
    await enriquecerParametrosYMateriales(req, componentes, parametros, 'preview-mezcla');

    // Relajar restricciones de búsqueda que aplican al generador — en preview
    // el usuario ya eligió la combinación, solo queremos los indicadores.
    // Clonamos parametros para no mutar las restricciones que pudiera traer.
    const paramsEval = { ...parametros };
    // proporcionFinosMin/Max: limpiar para que no rechace una edición agresiva.
    delete paramsEval.proporcionFinosMin;
    delete paramsEval.proporcionFinosMax;
    // _tmnMax: dejarlo si vino; el engine rechaza combinaciones por encima,
    // lo cual es una validación válida en preview también.

    const solucion = evaluarCombinacionStandalone(componentes, proporciones.map(Number), paramsEval);
    if (!solucion) {
      return res.status(422).json({ error: 'La combinación actual no pudo evaluarse (posiblemente TMN excede el máximo permitido o datos granulométricos insuficientes).' });
    }

    // Opcional: pegar bandaPuntos al _meta de la solución para preview gráfico.
    try {
      const tmn = solucion.indicadores?.tmn;
      if (tmn && parametros._bandasPorTMN) {
        const tmnKey = String(tmn);
        const closest = Object.keys(parametros._bandasPorTMN)
          .map(Number).sort((a, b) => Math.abs(a - tmn) - Math.abs(b - tmn))[0];
        const banda = parametros._bandasPorTMN[tmnKey] || (closest && Math.abs(closest - tmn) <= 5 ? parametros._bandasPorTMN[String(closest)] : null);
        if (banda) {
          solucion._meta = solucion._meta || {};
          solucion._meta.bandaPuntos = banda.bandaAC || banda.bandaAB;
          solucion._meta.bandaAB = banda.bandaAB;
          solucion._meta.bandaAC = banda.bandaAC;
        }
      }
    } catch { /* non-blocking */ }

    res.json({ solucion });
  } catch (err) {
    console.error('[preview-mezcla]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Crear mezcla desde sugerencia
router.post('/crear-mezcla-sugerida', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const mezclaService = require('../services/mezclaService');
    const { componentes, indicadores, idPlanta, nombre } = req.body;
    if (!componentes?.length || !idPlanta) return res.status(400).json({ error: 'componentes[] e idPlanta requeridos' });

    // Determine tipo de mezcla
    const tipos = componentes.map(c => (c.tipo || '').toUpperCase());
    const tieneFino = tipos.some(t => t === 'FINO');
    const tieneGrueso = tipos.some(t => t === 'GRUESO');
    const tipoMezcla = (tieneFino && tieneGrueso) ? 'TOTAL' : tieneFino ? 'FINO' : 'GRUESO';

    // Build curvaMezclaJson from the suggestion's granulometry
    let curvaMezclaJson = null;
    const { granulometria } = req.body;
    if (granulometria && typeof granulometria === 'object') {
      // Convert { abertura: pasaPct } to array format [{ aberturaMm, pasaPct, tamiz }]
      // Do NOT stringify — Sequelize handles JSON serialization for JSON columns
      curvaMezclaJson = Object.entries(granulometria)
        .map(([ab, pasa]) => ({ aberturaMm: Number(ab), pasaPct: Number(pasa), tamiz: `${ab} mm` }))
        .filter(p => p.pasaPct != null && !isNaN(p.aberturaMm))
        .sort((a, b) => a.aberturaMm - b.aberturaMm);
    }

    // ── Auto-select IRAM band and evaluate granulometry ──
    let idBanda = null;
    let evaluacionBanda = null;
    let selectedBanda = null;
    const tmn = indicadores?.tmn;

    if (tmn && curvaMezclaJson?.length > 0) {
      try {
        const { getCurvas } = require('../services/curvaGranulometricaService');
        let selectedTeorica = null;

        if (tipoMezcla === 'FINO') {
          // For FINO: find Banda A-B with specMode=RANGO
          const finosBandas = await getCurvas(req.db, { tipo: 'BANDA', isActive: true });
          selectedBanda = finosBandas.find(b => {
            const n = (b.nombre || '').toLowerCase();
            return b.specMode === 'RANGO' && (n.includes('fino') || n.includes('a-b'));
          });
          if (!selectedBanda) selectedBanda = finosBandas.find(b => (b.uso || '').toUpperCase() === 'FINO' && b.specMode === 'RANGO');
        } else if (tipoMezcla === 'GRUESO') {
          // For GRUESO: use RANGO band from Tabla 3.5 matching TMN
          const gruesoBandas = await getCurvas(req.db, { tipo: 'BANDA', isActive: true, uso: 'GRUESO', tmnMm: tmn });
          selectedBanda = gruesoBandas.find(b => b.specMode === 'RANGO');
          if (!selectedBanda) {
            const allRango = await getCurvas(req.db, { tipo: 'BANDA', isActive: true });
            const rangoBandas = allRango.filter(b => b.specMode === 'RANGO' && b.tmnMm && Math.abs(b.tmnMm - tmn) < 2);
            if (rangoBandas.length > 0) selectedBanda = rangoBandas[0];
          }
        } else {
          // For TOTAL: dual evaluation A-B → A-C from normative seed data (IRAM 1627:1997)
          try {
            const { loadSeedData } = require('../services/importIRAM1627Service');
            const seed = loadSeedData();
            const tmnKey = String(tmn);
            let tabla = seed.totales?.tablas?.[tmnKey];
            if (!tabla) {
              const keys = Object.keys(seed.totales?.tablas || {}).map(Number).sort((a, b) => Math.abs(a - tmn) - Math.abs(b - tmn));
              if (keys.length > 0 && Math.abs(keys[0] - tmn) <= 5) tabla = seed.totales.tablas[String(keys[0])];
            }
            if (tabla?.curvas?.A && tabla.curvas.B) {
              const buildPuntos = (cA, cRef) => cA.map(pA => {
                const pRef = cRef.find(p => Math.abs(p.aberturaMm - pA.aberturaMm) < pA.aberturaMm * 0.05 + 0.01);
                return pRef ? { aberturaMm: pA.aberturaMm, tamiz: `${pA.aberturaMm} mm`, limInfPct: pA.target, limSupPct: pRef.target, isNA: false } : null;
              }).filter(Boolean);

              // Try A-B first (more restrictive)
              const bandaAB = buildPuntos(tabla.curvas.A, tabla.curvas.B);
              selectedBanda = {
                tipo: 'BANDA', specMode: 'RANGO', tmnMm: tabla.tmnMm || tmn, uso: 'TOTAL',
                nombre: `IRAM 1627 — Total — TMN ${tabla.tmnMm || tmn} — Banda A-B (${tabla.referenciaTabla || ''})`,
                puntos: bandaAB,
              };

              // Pre-check: if A-B won't cumple, switch to A-C for the stored band
              if (curvaMezclaJson?.length > 0 && tabla.curvas.C) {
                const tamMix = curvaMezclaJson.map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.pasaPct, tamiz: p.tamiz }));
                const quickEval = mezclaService.evaluarContraObjetivo(curvaMezclaJson, selectedBanda);
                if (quickEval && !quickEval.cumple) {
                  // Try A-C
                  const bandaAC = buildPuntos(tabla.curvas.A, tabla.curvas.C);
                  selectedBanda = {
                    tipo: 'BANDA', specMode: 'RANGO', tmnMm: tabla.tmnMm || tmn, uso: 'TOTAL',
                    nombre: `IRAM 1627 — Total — TMN ${tabla.tmnMm || tmn} — Banda A-C (${tabla.referenciaTabla || ''})`,
                    puntos: bandaAC,
                  };
                }
              }
            }
          } catch (e) {
            console.warn('[crear-mezcla-sugerida] IRAM 1627 seed load failed:', e.message);
          }
        }

        if (selectedBanda) {
          idBanda = selectedBanda.idCurva || selectedBanda.id;
          evaluacionBanda = mezclaService.evaluarContraObjetivo(curvaMezclaJson, selectedBanda);
        }
      } catch (e) {
        console.warn('[crear-mezcla-sugerida] Error selecting band:', e.message);
      }
    }

    // ── Build metadataResultadoJson with evaluation ──
    let metadataResultadoJson = null;
    if (evaluacionBanda || indicadores) {
      metadataResultadoJson = {
        evaluacionBanda: evaluacionBanda || null,
        optimizacion: {
          metodo: 'sugerencia_automatica',
          factible: true,
          mensaje: 'Mezcla generada por optimización granulométrica automática.',
          rangos: componentes.map(c => ({
            idAgregado: c.id,
            nombre: c.nombre,
            optimalPct: c.porcentaje,
            minPct: Math.max(5, c.porcentaje - 15),
            maxPct: Math.min(95, c.porcentaje + 15),
          })),
        },
        resumen: {
          cumple: evaluacionBanda?.cumple ?? null,
          tamicesFuera: evaluacionBanda?.fueraDeBanda || [],
          rmse: null,
          mae: null,
        },
        _refs: {
          bandaLabel: evaluacionBanda ? `IRAM 1627 — ${tipoMezcla} — TMN ${tmn}` : null,
        },
      };
    }

    // Ensure unique name
    let nombreFinal = nombre || `${req.body.designName || 'Sugerencia'} ${tipoMezcla} (sugerida)`;
    try {
      const existing = await req.db.MezclaAgregados.findAll({ where: { nombre: { [req.db.Sequelize.Op.like]: `${nombreFinal}%` } }, attributes: ['nombre'], raw: true });
      if (existing.length > 0) {
        const existingNames = new Set(existing.map(e => e.nombre));
        if (existingNames.has(nombreFinal)) {
          let counter = 2;
          while (existingNames.has(`${nombreFinal} (${counter})`)) counter++;
          nombreFinal = `${nombreFinal} (${counter})`;
        }
      }
    } catch {}

    // Build bandaCompuestaJson for mezclas when using synthetic or non-persisted band
    let bandaCompuestaJson = null;
    if (evaluacionBanda && selectedBanda?.puntos) {
      // Store band points + metadata so MezclaDetallePage can reconstruct the chart
      bandaCompuestaJson = JSON.stringify({
        label: selectedBanda.nombre || `IRAM 1627 — ${tipoMezcla} — TMN ${tmn}`,
        tmnMm: tmn,
        specMode: selectedBanda.specMode || 'RANGO',
        puntos: selectedBanda.puntos.map(p => ({
          aberturaMm: p.aberturaMm,
          tamiz: p.tamiz || `${p.aberturaMm} mm`,
          limInfPct: p.limInfPct,
          limSupPct: p.limSupPct,
        })).filter(p => p.limInfPct != null || p.limSupPct != null),
      });
    }

    // Expand saved mixes (id = "mezcla_X") into their individual aggregate components
    const expandedItems = [];
    let orden = 0;
    for (const c of componentes) {
      const idStr = String(c.id);
      if (idStr.startsWith('mezcla_')) {
        // This component is a saved mix — expand into its individual aggregates
        const idMezcla = Number(idStr.replace('mezcla_', ''));
        try {
          const savedMix = await req.db.MezclaAgregados.findByPk(idMezcla, {
            include: [{ model: req.db.MezclaAgregadosItem, as: 'items' }],
          });
          if (savedMix?.items?.length) {
            const totalPct = savedMix.items.reduce((s, it) => s + (it.porcentajeFinal || 0), 0);
            for (const it of savedMix.items) {
              const subPct = totalPct > 0 ? (it.porcentajeFinal / totalPct) * c.porcentaje : 0;
              expandedItems.push({
                idAgregado: it.idAgregado,
                porcentajeFinal: Math.round(subPct * 100) / 100,
                orden: orden++,
              });
            }
          } else {
            // Fallback: can't expand, skip
            console.warn(`[crear-mezcla-sugerida] Mezcla ${idMezcla} no tiene items, omitida.`);
          }
        } catch (e) {
          console.warn(`[crear-mezcla-sugerida] Error expandiendo mezcla ${idMezcla}:`, e.message);
        }
      } else {
        expandedItems.push({
          idAgregado: Number(c.id) || c.id,
          porcentajeFinal: c.porcentaje,
          orden: orden++,
        });
      }
    }

    // Merge duplicate aggregates (same aggregate can appear from multiple sub-mixes)
    const mergedMap = new Map();
    for (const it of expandedItems) {
      const key = it.idAgregado;
      if (mergedMap.has(key)) {
        mergedMap.get(key).porcentajeFinal += it.porcentajeFinal;
      } else {
        mergedMap.set(key, { ...it });
      }
    }
    const finalItems = [...mergedMap.values()].map((it, i) => ({ ...it, orden: i, porcentajeFinal: Math.round(it.porcentajeFinal * 100) / 100 }));

    const mezclaData = {
      nombre: nombreFinal,
      idPlanta,
      tipoMezcla,
      objetivoModo: 'BANDA',
      idBanda: idBanda || null,
      bandaCompuestaJson,
      tmnCalculadoMm: tmn || null,
      moduloFinura: indicadores?.mf || null,
      curvaMezclaJson,
      metadataResultadoJson,
      proporcionesOptimasJson: JSON.stringify(
        Object.fromEntries(componentes.map(c => [c.nombre || c.id, c.porcentaje]))
      ),
      tipoOptimizacion: 'AUTOMATICA',
      items: finalItems,
    };

    const mezcla = await mezclaService.guardarMezcla(req.db, mezclaData);
    res.json({ idMezcla: mezcla.idMezcla, nombre: mezcla.nombre, codigo: mezcla.codigo });
  } catch (err) {
    console.error('[crear-mezcla-sugerida]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Alertas de materiales
router.get('/:id/alertas', verifyJwt, async (req, res) => {
  try {
    const { obtenerAlertasDosificacion } = require('../services/alertasMaterialService');
    const alertas = await obtenerAlertasDosificacion(req.db, req.params.id);
    res.json(alertas);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Resolver alerta: técnico (OPERADOR+). Un cliente nunca resuelve una alerta.
router.put('/alertas/:alertaId/resolver', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const { resolverAlerta } = require('../services/alertasMaterialService');
    const result = await resolverAlerta(req.db, req.params.alertaId, {
      estado: req.body.estado || 'RESUELTA',
      usuario: req.user?.nombre || req.user?.usuario || 'sistema',
      notas: req.body.notas || null,
    });
    res.json(result || { error: 'Alerta no encontrada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fase 3 — listar usuarios autorizados a firmar override de pastón
// (RESPONSABLE_CALIDAD, DIRECTOR_TECNICO, ADMIN). Devuelve solo campos
// básicos. ROLES_OPERATIVOS porque cualquier rol técnico puede consultar
// quién puede firmar antes de iniciar el override; el firmar dura está
// validado por el backend al transicionar.
router.get('/firmantes-override', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const firmantes = await svc.listarFirmantesOverride(req.db);
    res.json({ firmantes });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// PR12 — Generar probetas a partir de un pastón. Body opcional:
//   { diasRotura: [7, 28], cantidadPorDia: 3 }
router.post('/pastones/:id/probetas', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const { generarProbetas } = require('../services/probetasDesdePastonService');
    const r = await generarProbetas(req.db, req.params.id, req.body || {});
    res.status(201).json(r);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// PR11 — Dashboard global de pastones del tenant. Filtros opcionales:
//   ?estado=A_PRUEBA|EN_PRODUCCION  → solo dosificaciones en ese estado
//   ?veredicto=APROBADO|RECHAZADO|OBSERVADO|PENDIENTE
//   ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//   ?idPlanta=N
router.get('/pastones-global', verifyJwt, async (req, res) => {
  try {
    const { Op } = require('sequelize');
    const where = {};
    if (req.query.veredicto === 'PENDIENTE') {
      where.veredicto = null;
    } else if (req.query.veredicto) {
      where.veredicto = req.query.veredicto;
    }
    if (req.query.desde || req.query.hasta) {
      where.createdAt = {};
      if (req.query.desde) where.createdAt[Op.gte] = new Date(req.query.desde);
      if (req.query.hasta) where.createdAt[Op.lte] = new Date(`${req.query.hasta}T23:59:59`);
    }
    const includeDosif = {
      model: req.db.DosificacionDisenada,
      as: 'dosificacionDisenada',
      attributes: ['id', 'nombre', 'estado', 'idPlanta', 'codigoHormigon', 'fechaCreacion', 'creadoPor'],
      required: !!(req.query.estado || req.query.idPlanta),
    };
    if (req.query.estado) includeDosif.where = { estado: req.query.estado };
    if (req.query.idPlanta) includeDosif.where = { ...(includeDosif.where || {}), idPlanta: Number(req.query.idPlanta) };

    const rows = await req.db.PastonPrueba.findAll({
      where,
      include: [includeDosif],
      order: [['createdAt', 'DESC']],
      limit: Number(req.query.limit) || 200,
    });
    res.json(rows.map((r) => r.get({ plain: true })));
  } catch (err) {
    console.error('[pastones-global] Error:', err);
    res.status(500).json({ error: err.message || 'Error al listar pastones globales' });
  }
});

// PR7 — Listado de usuarios disponibles para asignar como revisor en BORRADOR
// → PENDIENTE_REVISION. Misma lista que `firmantes-override` (mismos roles
// autorizados: RESPONSABLE_CALIDAD / DIRECTOR_TECNICO / ADMIN). Endpoint
// dedicado para que el frontend lo invoque desde el modal "Enviar a revisión"
// sin acoplarse al wording "override" (que aplica solo a pastón).
router.get('/revisores-disponibles', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const revisores = await svc.listarFirmantesOverride(req.db);
    res.json({ revisores });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Pendientes de revisión asignadas al usuario logueado. Sin requireRole: el
// service ya filtra por `revisorAsignado=user`, así que si el usuario no es
// revisor de nada el resultado es []. Soporta tanto username como displayName
// (las dos formas en que el campo se persiste — ver service). IMPORTANTE: estas
// rutas van ANTES de `/:id` para evitar que Express las matchee como id.
function _identsDeUsuario(reqUser) {
  if (!reqUser) return [];
  const display = `${reqUser.name || ''} ${reqUser.lastname || ''}`.trim();
  return [reqUser.username, display].filter(Boolean);
}
function _plantasDeUsuario(reqUser) {
  if (!reqUser) return [];
  // Sesión 2026-05-29: coerce booleano en lugar de `=== true`. El driver
  // MySQL a veces deserializa BOOLEAN como `1` (TINYINT) y la comparación
  // estricta dejaba al admin sin acceso (caía al else con plantaIds vacíos
  // y devolvía [] → el service retornaba [] sin buscar).
  if (reqUser.isAdmin) return null; // null = sin filtrar por planta
  return Array.isArray(reqUser.plantaIds) ? reqUser.plantaIds : [];
}
router.get('/pendientes-revision/mias', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const rows = await svc.listarPendientesRevisionParaUsuario(
      req.db, _identsDeUsuario(req.user), _plantasDeUsuario(req.user),
    );
    res.json({ dosificaciones: rows });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
router.get('/pendientes-revision/mias/count', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const rows = await svc.listarPendientesRevisionParaUsuario(
      req.db, _identsDeUsuario(req.user), _plantasDeUsuario(req.user),
    );
    res.json({ count: rows.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Dosificaciones que usan un material específico (cemento/aditivo/fibra/adicion/agregado).
// IMPORTANTE: registrada ANTES de `/:id` para que Express no la matchee como id='vinculadas'.
// Reemplaza al endpoint legacy /api/agregados/:id/dosificaciones (que sólo soporta agregados).
router.get('/vinculadas', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const { source, sourceId, limit } = req.query;
    if (!source || !sourceId) {
      return res.status(400).json({ error: 'Faltan parámetros: source y sourceId.' });
    }
    const rows = await svc.listarDosificacionesVinculadas(req.db, source, sourceId, { limit });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CRUD diseños guardados
// GET listar/obtener: lectura interna. CLIENTE bloqueado (scope filtering Fase futura).
router.get('/',                              verifyJwt, ctrl.listar);
router.post('/',                             verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.guardar);
router.get('/:id',                           verifyJwt, ctrl.obtener);
// RBAC Fase 1: borrar dosificaciones solo Admin (cambio destructivo de catálogo)
router.delete('/:id',                        verifyJwt, requireRole(ROLES.ADMIN), ctrl.eliminar);

// Estado transitions & versioning
// RBAC: transiciones críticas (a EN_PRODUCCION/SUSPENDIDO/ARCHIVADO) requieren
// Responsable+. El controller valida internamente qué transición exige qué rol.
router.post('/:id/transicion',               verifyJwt, requireRole(ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.ADMIN), ctrl.transicionarEstado);
// Nueva versión: cualquier rol operativo puede iterar (OPERADOR puede clonar y editar BORRADOR).
router.post('/:id/nueva-version',            verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.crearNuevaVersion);
router.get('/:id/versiones',                 verifyJwt, ctrl.obtenerVersiones);
router.get('/:id/historial',                 verifyJwt, ctrl.obtenerHistorial);
// Fase 4.4 — verificación de la cadena de hashes del historial.
router.get('/:id/historial/verificar-cadena', verifyJwt, ctrl.verificarCadenaHistorial);

// Fase 2A — flujo post-prueba: nueva ronda incrementa contador, requiere rol operativo.
router.post('/:id/nueva-ronda-prueba', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/dosificacionDisenoService');
    const usuario = req.user ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username : null;
    const result = await svc.enviarNuevaRondaPrueba(req.db, Number(req.params.id), {
      usuario,
      motivo: req.body?.motivo || null,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});
router.get('/:id/verificar-integridad',      verifyJwt, ctrl.verificarIntegridad);
router.get('/:id/resultados-produccion',     verifyJwt, ctrl.obtenerResultadosProduccion);
// Vincular a catálogo: ata la dosificación a una entrada pública del tenant — RESPONSABLE+.
router.put('/:id/vincular-catalogo',         verifyJwt, requireRole(...ROLES_CATALOGO), ctrl.vincularCatalogo);

// Modificar proporciones de la mezcla vinculada al diseño. Solo BORRADOR.
// Si la mezcla es exclusiva de esta dosi → in-place; si está compartida con
// otras dosificaciones → fork automático y reapunte (ver mezclaService).
router.put('/:id/mezcla/proporciones', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const mezclaSvc = require('../services/mezclaService');
    const result = await mezclaSvc.modificarProporcionesEnUso(req.db, Number(req.params.id), req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || err.statusCode || 500).json({ error: err.message, code: err.code });
  }
});

// Variante sin dosificación guardada (sesión 2026-05-27): durante el diseño
// inicial el operador puede ajustar proporciones de una mezcla del catálogo
// sin haber guardado la dosi todavía. Mismo motor inplace/fork, pero el
// contexto es la mezcla en sí; el caller actualiza `form.mezclaId` con la
// nueva id si modo='fork'.
router.put('/proporciones-mezcla/:idMezcla', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const mezclaSvc = require('../services/mezclaService');
    const result = await mezclaSvc.modificarProporcionesMezclaSinDosi(req.db, Number(req.params.idMezcla), req.body || {});
    res.json(result);
  } catch (err) {
    res.status(err.status || err.statusCode || 500).json({ error: err.message, code: err.code });
  }
});

// Pastón de pruebas — operación de laboratorio (OPERADOR+).
router.get('/:id/pastones',                 verifyJwt, ctrl.listarPastones);
router.post('/:id/pastones',                verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.crearPaston);
router.get('/:id/pastones/:pid',            verifyJwt, ctrl.obtenerPaston);
router.put('/:id/pastones/:pid',            verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.actualizarPaston);
router.delete('/:id/pastones/:pid',         verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.eliminarPaston);

// Correcciones post-pastón — solo personal técnico.
router.get('/:id/correcciones',             verifyJwt, ctrl.listarCorrecciones);
router.post('/:id/correcciones',            verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.aplicarCorrecciones);

// Aptitud de materiales (consultas de evaluación normativa)
router.get('/:id/aptitud-materiales',       verifyJwt, ctrl.verificarAptitudMateriales);
router.post('/aptitud-materiales-calc',     verifyJwt, requireRole(...ROLES_OPERATIVOS), ctrl.verificarAptitudMaterialesByParams);

// ============================================================================
// Redosificaciones en obra — acciones trazables que se aplican sobre una
// dosificación ya existente (p.ej. recuperar asentamiento post-transporte).
// No son parte del diseño teórico: viven en su propia tabla y se listan/ABM
// aparte.
// ============================================================================
router.get('/:id/redosificaciones', verifyJwt, async (req, res) => {
  try {
    const redosSvc = require('../services/redosificacionObraService');
    const rows = await redosSvc.listar(req.db, Number(req.params.id));
    res.json({ redosificaciones: rows });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/:id/redosificaciones', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const redosSvc = require('../services/redosificacionObraService');
    const usuario = req.user ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username : null;
    const nueva = await redosSvc.crear(req.db, Number(req.params.id), req.body || {}, { usuario });
    res.status(201).json(nueva);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

router.put('/redosificaciones/:idRedos', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const redosSvc = require('../services/redosificacionObraService');
    const usuario = req.user ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username : null;
    const upd = await redosSvc.actualizar(req.db, Number(req.params.idRedos), req.body || {}, { usuario });
    res.json(upd);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/redosificaciones/:idRedos', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const redosSvc = require('../services/redosificacionObraService');
    const usuario = req.user ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username : null;
    const result = await redosSvc.eliminar(req.db, Number(req.params.idRedos), { usuario });
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

// ============================================================================
// Predicción de comportamiento fresco (V1 heurística)
// ============================================================================

// GET /:id/prediccion-fresco — última predicción persistida para esa dosificación
router.get('/:id/prediccion-fresco', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/prediccionFrescoService');
    const pred = await svc.obtener(req.db, Number(req.params.id));
    if (!pred) return res.status(404).json({ error: 'Sin predicción persistida para esta dosificación.' });
    res.json(pred);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /:id/prediccion-fresco — persistir (upsert) la predicción recibida.
// Acepta el objeto devuelto por el engine (shape: { versionModelo, indices,
// nivelConfianza, riesgos, recomendaciones, perfilTexto, datosEntradaSnapshot,
// disponibilidadDatos, fechaCalculo }).
router.post('/:id/prediccion-fresco', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/prediccionFrescoService');
    const saved = await svc.guardar(req.db, Number(req.params.id), req.body || {});
    if (!saved) return res.status(500).json({ error: 'No se pudo persistir la predicción.' });
    res.status(201).json(saved);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// Fase 2B — Mediciones seriadas de pastón (slump loss)
// ============================================================================
router.get('/pastones/:idPaston/mediciones', verifyJwt, async (req, res) => {
  try {
    const svc = require('../services/medicionPastonService');
    const rows = await svc.listar(req.db, Number(req.params.idPaston));
    res.json({ mediciones: rows });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/pastones/:idPaston/mediciones', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/medicionPastonService');
    const usuario = req.user ? `${req.user.name || ''} ${req.user.lastname || ''}`.trim() || req.user.username : null;
    const nueva = await svc.crear(req.db, Number(req.params.idPaston), req.body || {}, { usuario });
    res.status(201).json(nueva);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.put('/pastones/mediciones/:idMed', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/medicionPastonService');
    const upd = await svc.actualizar(req.db, Number(req.params.idMed), req.body || {});
    res.json(upd);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.delete('/pastones/mediciones/:idMed', verifyJwt, requireRole(...ROLES_OPERATIVOS), async (req, res) => {
  try {
    const svc = require('../services/medicionPastonService');
    const result = await svc.eliminar(req.db, Number(req.params.idMed));
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ============================================================================
// Análisis de eficiencia de acciones + mediciones por pastón
// ============================================================================
router.get('/pastones/:idPaston/analisis-eficiencia', verifyJwt, async (req, res) => {
  try {
    const medSvc = require('../services/medicionPastonService');
    const redosSvc = require('../services/redosificacionObraService');
    const { calcularEficiencia } = require('../domain/dosificacion/analisisEficienciaEngine');

    const paston = await req.db.PastonPrueba.findByPk(Number(req.params.idPaston), { raw: true });
    if (!paston) return res.status(404).json({ error: 'Pastón no encontrado' });

    const mediciones = await medSvc.listar(req.db, paston.idPastonPrueba);
    const allAcciones = await redosSvc.listar(req.db, paston.idDosificacionDisenada);
    const acciones = allAcciones.filter(a => a.pastonRefId === paston.idPastonPrueba);

    // Get resultado from dosificación
    const dosif = await req.db.DosificacionDisenada.findByPk(paston.idDosificacionDisenada, { attributes: ['resultadoJson'], raw: true });
    let resultado = {};
    if (dosif?.resultadoJson) {
      resultado = typeof dosif.resultadoJson === 'string' ? JSON.parse(dosif.resultadoJson) : dosif.resultadoJson;
    }

    const analisis = calcularEficiencia({ mediciones, acciones, paston, resultado });
    res.json(analisis);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

module.exports = router;
