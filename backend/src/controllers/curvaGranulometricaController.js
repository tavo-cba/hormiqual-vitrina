const curvaService = require('../services/curvaGranulometricaService');
const { ValidationError } = require('../helpers/curvaValidation');
const { importIRAM1627 } = require('../services/importIRAM1627Service');
// [VITRINA] fuera de alcance: el sistema usa solo normas IRAM.
// const { importASTMC33 } = require('../services/importASTMC33Service');
const { exportCurvasToJson, importCurvasFromJson } = require('../services/curvaExportImportService');

/**
 * Wrapper para errores: devuelve 422 si es ValidationError, 500 en otro caso.
 * Siempre loguea el stack completo en consola.
 */
function handleError(res, error, label) {
  console.error(`[${label}]`, error.stack || error);

  if (error instanceof ValidationError || error.status === 422) {
    return res.status(422).json({
      message: error.message || 'Error de validación',
      details: error.details || [],
    });
  }

  const isNotFound = error.message && error.message.includes('no encontrad');
  if (isNotFound) {
    return res.status(404).json({ error: error.message });
  }

  const payload = { error: error.message || 'Error interno' };
  if (process.env.NODE_ENV !== 'production') {
    payload.stack = error.stack;
  }
  return res.status(500).json(payload);
}

/**
 * Compute a virtual refTipo that classifies curves as 'BANDA' (band-like)
 * or 'CURVA' (single-line). Used for IRAM 1505 modal filtering.
 */
function computeRefTipo(c) {
  if (c.tipo === 'BANDA' && ['RANGO', 'MAX_ONLY', 'MIN_ONLY'].includes(c.specMode)) {
    return 'BANDA';
  }
  return 'CURVA';
}

/**
 * GET /catalogo
 * Devuelve lista ligera de curvas para selector (sin puntos completos).
 * Query: serieTamices, uso, normaRef, tipo, refTipo (BANDA|CURVA), tmnMm, q
 *
 * Filtering: if `uso` is provided, returns ONLY curves whose aplicaA JSON
 * array contains that uso value (strict). Falls back to legacy `uso` column
 * for curves that don't have aplicaA set yet.
 *
 * refTipo: virtual filter — 'BANDA' matches band-like curves (BANDA+RANGO/MAX_ONLY/MIN_ONLY),
 *   'CURVA' matches single-line curves (TABULADA, TEORICA, BANDA+OBJETIVO).
 *   If not specified, returns all types.
 */
const getCatalogo = async (req, res) => {
  try {
    const { serieTamices, uso, normaRef, tipo, refTipo, tmnMm, q } = req.query;
    const curvas = await curvaService.getCurvas(req.db, {
      tipo: tipo || undefined,
      isActive: true,
      serieTamices: serieTamices || undefined,
      // Don't pass uso to getCurvas — filter by aplicaA below
    });

    let filtered = curvas;

    // Filter by refTipo (virtual: BANDA = band-like, CURVA = single-line)
    if (refTipo) {
      filtered = filtered.filter(c => computeRefTipo(c) === refTipo);
    }

    // Filter by uso via aplicaA (strict)
    if (uso) {
      filtered = filtered.filter(c => {
        if (c.aplicaA && Array.isArray(c.aplicaA)) {
          return c.aplicaA.includes(uso);
        }
        // Legacy fallback: match against `uso` column
        return c.uso === uso;
      });
    }

    // Filter by normaRef if provided
    if (normaRef) {
      filtered = filtered.filter(c => c.normaRef && c.normaRef.toLowerCase().includes(normaRef.toLowerCase()));
    }

    // Filter by q (search term) if provided
    if (q) {
      const lower = q.toLowerCase();
      filtered = filtered.filter(c => c.nombre.toLowerCase().includes(lower));
    }

    // TMN-based ranking: when tmnMm is provided, compute distance and
    // sort by proximity. The closest curves get recomendada=true.
    const userTmn = tmnMm != null && tmnMm !== '' ? Number(tmnMm) : null;

    // Return lightweight payload (no full puntos)
    let result = filtered.map(c => ({
      idCurva: c.idCurva,
      nombre: c.nombre,
      normaRef: c.normaRef,
      uso: c.uso,
      aplicaA: c.aplicaA,
      tmnMm: c.tmnMm,
      tmnMinMm: c.tmnMinMm,
      tmnMaxMm: c.tmnMaxMm,
      curveLetter: c.curveLetter,
      serieTamices: c.serieTamices,
      specMode: c.specMode,
      tipo: c.tipo,
      refTipo: computeRefTipo(c),
    }));

    result = curvaService.rankCurvasByTmn(result, userTmn);

    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, 'getCatalogo');
  }
};

const getCurvas = async (req, res) => {
  try {
    const { tipo, isActive, serieTamices, uso, tmnMm, estadoDatos, idCurvaSet } = req.query;
    const curveLetter = req.query.curveLetter ?? req.query.letter ?? undefined;
    const curvas = await curvaService.getCurvas(req.db, {
      tipo: tipo || undefined,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      serieTamices: serieTamices || undefined,
      uso: uso || undefined,
      tmnMm: tmnMm || undefined,
      estadoDatos: estadoDatos || undefined,
      curveLetter: curveLetter || undefined,
      idCurvaSet: idCurvaSet || undefined,
    });
    res.status(200).json(curvas);
  } catch (error) {
    handleError(res, error, 'getCurvas');
  }
};

const getCurva = async (req, res) => {
  try {
    const curva = await curvaService.getCurva(req.db, req.params.id);
    if (!curva) return res.status(404).json({ error: 'Curva no encontrada' });
    res.status(200).json(curva);
  } catch (error) {
    handleError(res, error, 'getCurva');
  }
};

const createCurva = async (req, res) => {
  try {
    // Normalizar curveLetter (aceptar también "letter" por compatibilidad)
    const body = { ...req.body };
    if (body.curveLetter === undefined && body.letter !== undefined) {
      body.curveLetter = body.letter;
      delete body.letter;
    }
    const nueva = await curvaService.createCurva(req.db, body);
    res.status(201).json(nueva);
  } catch (error) {
    handleError(res, error, 'createCurva');
  }
};

const updateCurva = async (req, res) => {
  try {
    // Normalizar curveLetter (aceptar también "letter" por compatibilidad)
    const body = { ...req.body };
    if (body.curveLetter === undefined && body.letter !== undefined) {
      body.curveLetter = body.letter;
      delete body.letter;
    }
    const actualizada = await curvaService.updateCurva(req.db, req.params.id, body);
    res.status(200).json(actualizada);
  } catch (error) {
    handleError(res, error, 'updateCurva');
  }
};

const deleteCurva = async (req, res) => {
  try {
    // TODO: verificar si la curva está en uso (extracciones, ensayos, reportes)
    // Si lo estuviera → res.status(409).json({ error: 'Curva en uso, desactivar en vez de eliminar' });
    const result = await curvaService.deleteCurva(req.db, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, 'deleteCurva');
  }
};

const compararGranulometria = async (req, res) => {
  try {
    const { tamices, curvaId } = req.body;
    if (!tamices || !curvaId) {
      return res.status(400).json({ error: 'Se requieren tamices y curvaId' });
    }
    const curva = await curvaService.getCurva(req.db, curvaId);
    if (!curva) return res.status(404).json({ error: 'Curva no encontrada' });

    const resultado = curvaService.compararConCurva(tamices, curva);

    // If curva belongs to a set, also return sibling curves and envelope
    if (curva.idCurvaSet) {
      const hermanas = await curvaService.getCurvasHermanas(req.db, curva.idCurvaSet);
      resultado.envolvente = curvaService.computeEnvolvente(hermanas);
      resultado.curvasHermanas = hermanas.map(c => ({
        idCurva: c.idCurva,
        nombre: c.nombre,
        curveLetter: c.curveLetter,
        puntos: (c.puntos || []).filter(p => !p.isNA).map(p => ({
          tamiz: p.tamiz,
          aberturaMm: p.aberturaMm,
          pasaPct: p.pasaPct ?? p.targetPct,
        })),
      }));
    }

    res.status(200).json(resultado);
  } catch (error) {
    handleError(res, error, 'compararGranulometria');
  }
};

/**
 * POST /generate-points
 * Genera puntos de preview para una curva teórica sin persistir.
 * Body: { tipo, serieTamices, parametros: { formulaKey|formula, D|dmax, dmin, n, q, x, k, rounding } }
 */
const generatePoints = async (req, res) => {
  try {
    const { tipo, serieTamices, parametros, tmnMm } = req.body;

    if (tipo !== 'TEORICA') {
      return res.status(400).json({ error: 'generate-points solo aplica a curvas TEORICA' });
    }

    const result = curvaService.generarPuntosTeoricaValidated({
      tipo,
      serieTamices: serieTamices || 'IRAM',
      parametros: parametros || {},
      tmnMm: tmnMm ?? null,
    });

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.status(200).json({ puntos: result.puntos });
  } catch (error) {
    handleError(res, error, 'generatePoints');
  }
};

/**
 * POST /:id/regenerar
 * Recomputa puntos de una curva TEORICA desde sus parametros guardados.
 */
const regenerarCurva = async (req, res) => {
  try {
    const curva = await curvaService.regenerarCurva(req.db, req.params.id);
    res.status(200).json(curva);
  } catch (error) {
    handleError(res, error, 'regenerarCurva');
  }
};

const importIRAM1627Endpoint = async (req, res) => {
  try {
    const logs = [];
    const stats = await importIRAM1627(req.db, {
      onLog: (level, msg) => logs.push({ level, msg }),
    });
    res.status(200).json({
      message: 'Importación IRAM 1627:1997 completada',
      ...stats,
      logs,
    });
  } catch (error) {
    handleError(res, error, 'importIRAM1627');
  }
};

// [VITRINA] fuera de alcance: el sistema usa solo normas IRAM.
// (handler importASTMC33Endpoint removido — dependía de importASTMC33Service)

/**
 * POST /export
 * Body: { ids: [1, 2, 3] }  — si ids vacío o ausente, exporta todas.
 */
const exportCurvas = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const result = await exportCurvasToJson(req.db, ids);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error, 'exportCurvas');
  }
};

/**
 * POST /import/json
 * Body: { curvas: [...], reset?: bool, normaRef?: string }
 */
const importCurvasJson = async (req, res) => {
  try {
    const logs = [];
    const stats = await importCurvasFromJson(req.db, req.body, {
      reset: req.body.reset === true,
      normaRef: req.body.normaRef || undefined,
      onLog: (level, msg) => logs.push({ level, msg }),
    });
    res.status(200).json({
      message: 'Importación JSON completada',
      ...stats,
      logs,
    });
  } catch (error) {
    handleError(res, error, 'importCurvasJson');
  }
};

/**
 * GET /:id/serie
 * Devuelve los datos de dibujo de una curva para overlay en charts.
 * Respuesta:
 *   { idCurva, nombre, tipo, specMode, serieTamices,
 *     series: { curva?: [{xMm, yPct}], bandaMin?: [{xMm, yPct}], bandaMax?: [{xMm, yPct}] } }
 *
 * - BANDA / RANGO: devuelve bandaMin + bandaMax (limInfPct / limSupPct)
 * - OBJETIVO / MIN_ONLY / MAX_ONLY / TABULADA / TEORICA: devuelve curva
 *   (pasaPct o targetPct → yPct)
 */
const getSerie = async (req, res) => {
  try {
    const curva = await curvaService.getCurva(req.db, req.params.id);
    if (!curva) return res.status(404).json({ error: 'Curva no encontrada' });

    // Use puntosCalculados for TEORICAs, otherwise stored puntos
    const rawPuntos = curva.puntosCalculados || curva.puntos || [];
    // Sort by aberturaMm descending (largest opening first, like granulometría convention)
    // Support legacy `tamizMm` alias for test compatibility
    const sorted = [...rawPuntos].sort((a, b) => (b.aberturaMm ?? b.tamizMm) - (a.aberturaMm ?? a.tamizMm));

    const xOf = (p) => p.aberturaMm ?? p.tamizMm;

    const series = {};

    if (curva.specMode === 'RANGO') {
      // Band curve → two limit series (INF / SUP)
      series.bandaMin = sorted.map(p => ({ xMm: xOf(p), yPct: p.limInfPct ?? null }));
      series.bandaMax = sorted.map(p => ({ xMm: xOf(p), yPct: p.limSupPct ?? null }));
      // Optional 3rd line (OBJ / targetPct) inside the band
      const hasTarget = sorted.some(p => p.targetPct != null);
      if (hasTarget) {
        series.bandaObj = sorted.map(p => ({ xMm: xOf(p), yPct: p.targetPct ?? null }));
      }
    } else {
      // Single line curve (OBJETIVO, MAX_ONLY, MIN_ONLY, TABULADA, TEORICA)
      series.curva = sorted.map(p => ({
        xMm: xOf(p),
        yPct: p.pasaPct ?? p.targetPct ?? p.limSupPct ?? p.limInfPct ?? null,
      }));
    }

    res.status(200).json({
      idCurva: curva.idCurva,
      nombre: curva.nombre,
      tipo: curva.tipo,
      specMode: curva.specMode,
      serieTamices: curva.serieTamices,
      curveLetter: curva.curveLetter,
      refTipo: computeRefTipo(curva),
      series,
    });
  } catch (error) {
    handleError(res, error, 'getSerie');
  }
};

module.exports = {
  getCatalogo,
  getCurvas,
  getCurva,
  getSerie,
  createCurva,
  updateCurva,
  deleteCurva,
  compararGranulometria,
  generatePoints,
  regenerarCurva,
  importIRAM1627: importIRAM1627Endpoint,
  // [VITRINA] fuera de alcance: el sistema usa solo normas IRAM.
  // importASTMC33: importASTMC33Endpoint,
  exportCurvas,
  importCurvasJson,
};
