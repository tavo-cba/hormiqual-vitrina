'use strict';

const mezclaService = require('../services/mezclaService');
const agregadoService = require('../services/agregadoService');
const agregadoEnsayoService = require('../services/agregadoEnsayoService');

/**
 * GET /api/mezclas/agregados?plantaId=...&tipo=FINO|GRUESO|TOTAL
 * Lista agregados filtrados por planta y tipo de mezcla,
 * incluyendo estado de granulometría.
 */
const getAgregadosParaMezcla = async (req, res) => {
  try {
    const { plantaId, tipo } = req.query;
    if (!plantaId) return res.status(400).json({ error: 'plantaId es requerido' });

    const todos = await agregadoService.getAgregados(req.db);

    // Filter by planta
    let filtrados = todos.filter(a => a.idPlanta === Number(plantaId));

    // Filter by tipo de mezcla
    if (tipo === 'FINO') {
      filtrados = filtrados.filter(a => a.tipoAgregado === 'Fino');
    } else if (tipo === 'GRUESO') {
      filtrados = filtrados.filter(a => a.tipoAgregado === 'Grueso');
    }
    // TOTAL → no filter by tipo

    // P1.8: precomputar resumen de vigencia para todos los agregados (single query
    // batch en lugar de N queries dentro del map).
    const vigenciaMap = await agregadoEnsayoService.getVigenciaResumenPorAgregado(
      req.db,
      filtrados.map((a) => a.idAgregado),
    );

    // Enrich with granulometry status
    const enriched = await Promise.all(
      filtrados.map(async (a) => {
        const grano = await mezclaService.getUltimaGranulometria(req.db, a.idAgregado);
        return {
          id: a.idAgregado,
          nombre: a.nombre,
          tipoAgregado: a.tipoAgregado,
          origen: a.origen,
          densidad: a.densidad,
          moduloFinura: a.moduloFinura,
          planta: a.planta,
          tieneGranulometria: !!grano,
          granulometria: grano ? {
            fecha: grano.fechaEnsayo,
            codigo: grano.codigo,
            nPuntos: grano.puntos.length,
            puntos: grano.puntos,
          } : null,
          vigenciaResumen: vigenciaMap.get(a.idAgregado) || null,
        };
      })
    );

    // For TOTAL mode, also include saved FINO/GRUESO mixes as virtual aggregates.
    // They use negative IDs: -idMezcla (e.g. mix #5 → id: -5).
    if (tipo === 'TOTAL') {
      const virtuales = await mezclaService.listarMezclasComoAgregadosVirtuales(req.db, plantaId);
      enriched.push(...virtuales);
    }

    res.json(enriched);
  } catch (err) {
    console.error('[getAgregadosParaMezcla]', err);
    res.status(500).json({ error: err.message || 'Error al obtener agregados' });
  }
};

/**
 * GET /api/mezclas/agregados/:id/granulometria
 * Devuelve la última granulometría normalizada de un agregado.
 */
const getGranulometria = async (req, res) => {
  try {
    const { id } = req.params;
    const grano = await mezclaService.getUltimaGranulometria(req.db, Number(id));
    if (!grano) return res.status(404).json({ error: 'No se encontró granulometría para este agregado' });
    res.json(grano);
  } catch (err) {
    console.error('[getGranulometria]', err);
    res.status(500).json({ error: err.message || 'Error al obtener granulometría' });
  }
};

/**
 * POST /api/mezclas/evaluar
 * Calcula la mezcla manual y opcionalmente evalúa contra un objetivo.
 */
const evaluarMezcla = async (req, res) => {
  try {
    const result = await mezclaService.evaluar(req.db, req.body);
    res.json(result);
  } catch (err) {
    console.error('[evaluarMezcla]', err);
    res.status(400).json({ error: err.message || 'Error al evaluar mezcla' });
  }
};

/**
 * POST /api/mezclas/curva-teorica/preview
 * Generate preview points for a dynamic theoretical curve (no persistence).
 */
const previewCurvaTeorica = async (req, res) => {
  try {
    const result = mezclaService.previewCurvaTeorica(req.body);
    res.json(result);
  } catch (err) {
    console.error('[previewCurvaTeorica]', err);
    res.status(400).json({ error: err.message || 'Error al generar curva teórica' });
  }
};

/**
 * POST /api/mezclas/optimizar
 * Optimiza los porcentajes de la mezcla contra un objetivo.
 */
const optimizarMezcla = async (req, res) => {
  try {
    const result = await mezclaService.optimizar(req.db, req.body);
    res.json(result);
  } catch (err) {
    console.error('[optimizarMezcla]', err);
    res.status(400).json({ error: err.message || 'Error al optimizar mezcla' });
  }
};

/**
 * POST /api/mezclas
 * Guardar una mezcla en el catálogo.
 */
const guardarMezcla = async (req, res) => {
  try {
    const mezcla = await mezclaService.guardarMezcla(req.db, req.body);
    res.status(201).json(mezcla);
  } catch (err) {
    console.error('[guardarMezcla]', err);
    res.status(400).json({ error: err.message || 'Error al guardar mezcla' });
  }
};

/**
 * GET /api/mezclas?plantaId=...&tipoMezcla=...
 * Listar mezclas guardadas.
 */
const listarMezclas = async (req, res) => {
  try {
    const mezclas = await mezclaService.listarMezclas(req.db, req.query);
    res.json(mezclas);
  } catch (err) {
    console.error('[listarMezclas]', err);
    res.status(500).json({ error: err.message || 'Error al listar mezclas' });
  }
};

/**
 * GET /api/mezclas/:id
 * Obtener detalle de una mezcla guardada.
 */
const getMezclaPorId = async (req, res) => {
  try {
    const mezcla = await mezclaService.getMezcla(req.db, Number(req.params.id));
    if (!mezcla) return res.status(404).json({ error: 'Mezcla no encontrada' });
    res.json(mezcla);
  } catch (err) {
    console.error('[getMezclaPorId]', err);
    res.status(500).json({ error: err.message || 'Error al obtener mezcla' });
  }
};

/**
 * DELETE /api/mezclas/:id
 * Eliminar una mezcla guardada.
 */
const eliminarMezcla = async (req, res) => {
  try {
    const usuario = req.user?.nombre || req.user?.email || 'desconocido';
    const result = await mezclaService.eliminarMezcla(req.db, Number(req.params.id), usuario);
    res.json(result);
  } catch (err) {
    console.error('[eliminarMezcla]', err);
    const status = err.statusCode || 400;
    res.status(status).json({ error: err.message || 'Error al eliminar mezcla' });
  }
};

/**
 * POST /api/mezclas/:id/duplicar
 * Duplicar una mezcla existente.
 */
const duplicarMezcla = async (req, res) => {
  try {
    const copia = await mezclaService.duplicarMezcla(req.db, Number(req.params.id));
    res.status(201).json(copia);
  } catch (err) {
    console.error('[duplicarMezcla]', err);
    res.status(400).json({ error: err.message || 'Error al duplicar mezcla' });
  }
};

/**
 * PUT /api/mezclas/:id
 * Actualizar una mezcla existente.
 */
const actualizarMezcla = async (req, res) => {
  try {
    const mezcla = await mezclaService.guardarMezcla(req.db, {
      ...req.body,
      idMezcla: Number(req.params.id),
    });
    res.json(mezcla);
  } catch (err) {
    console.error('[actualizarMezcla]', err);
    res.status(400).json({ error: err.message || 'Error al actualizar mezcla' });
  }
};

/* ═══ Estado transitions & versioning ═══ */

const transicionarEstado = async (req, res) => {
  try {
    const { nuevoEstado, motivo, observaciones, metadata } = req.body;
    const usuario = req.body.usuario || req.user?.nombre || 'sistema';
    const row = await mezclaService.transicionarEstadoMezcla(req.db, Number(req.params.id), {
      nuevoEstado, usuario, motivo, observaciones, metadata,
    });
    res.json(row);
  } catch (err) {
    const status = err.status || 400;
    console.error('[mezcla] transicionarEstado:', err);
    res.status(status).json({ error: err.message });
  }
};

const crearNuevaVersion = async (req, res) => {
  try {
    const usuario = req.body.usuario || req.user?.nombre || 'sistema';
    const motivo = req.body.motivo || null;
    const row = await mezclaService.crearNuevaVersionMezcla(req.db, Number(req.params.id), { usuario, motivo });
    res.status(201).json(row);
  } catch (err) {
    const status = err.status || 400;
    console.error('[mezcla] crearNuevaVersion:', err);
    res.status(status).json({ error: err.message });
  }
};

const obtenerVersiones = async (req, res) => {
  try {
    const rows = await mezclaService.obtenerVersionesMezcla(req.db, Number(req.params.id));
    res.json(rows);
  } catch (err) {
    const status = err.status || 500;
    console.error('[mezcla] obtenerVersiones:', err);
    res.status(status).json({ error: err.message });
  }
};

const obtenerHistorial = async (req, res) => {
  try {
    const rows = await mezclaService.obtenerHistorialMezcla(req.db, Number(req.params.id));
    res.json(rows);
  } catch (err) {
    console.error('[mezcla] obtenerHistorial:', err);
    res.status(500).json({ error: err.message });
  }
};

const verificarIntegridad = async (req, res) => {
  try {
    const result = await mezclaService.verificarIntegridadMezcla(req.db, Number(req.params.id));
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('[mezcla] verificarIntegridad:', err);
    res.status(status).json({ error: err.message });
  }
};

const getPropiedadesCombinadas = async (req, res) => {
  try {
    // Auditoría 01-calidad Fase C R3: `calcularPropiedadesCombinadas` (DB-aware)
    // vive en `services/mezclaPropsService.js`; `evaluarPropiedadesCombinadas`
    // (cálculo puro) sigue en domain.
    const { calcularPropiedadesCombinadas } = require('../services/mezclaPropsService');
    const { evaluarPropiedadesCombinadas } = require('../domain/mezclaPropsEngine');
    const { items, tipoMezcla } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items[] requerido' });

    // Enrich items with aggregate names if missing (MEJ-1: avoid "Componente fino #N" in observations)
    const enrichedItems = await mezclaService.enriquecerItemsConNombre(req.db, items);

    const propsResult = await calcularPropiedadesCombinadas(req.db, enrichedItems);
    const evaluacion = evaluarPropiedadesCombinadas(propsResult.combinadas, tipoMezcla || 'FINO', propsResult.componentes);

    res.json({ ...propsResult, evaluacion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/mezclas/sugerir-proporciones
 * Dado un set de materiales ya seleccionados, sugiere las proporciones óptimas.
 * A diferencia de /optimizar (que trabaja contra banda/curva), este endpoint
 * usa el motor de sugerencias (Shilstone + FdA + cemento) para encontrar
 * las mejores proporciones sin requerir una banda de referencia.
 */
const sugerirProporciones = async (req, res) => {
  try {
    const { optimizarProporciones, calcularGranulometriaCombinada, calcularTMNDesdeComponentes, obtenerTMNMaximo } = require('../domain/dosificacion/sugerenciaMezclaEngine');
    const { materiales, parametros = {} } = req.body;

    if (!Array.isArray(materiales) || materiales.length < 2) {
      return res.status(422).json({ error: 'Se requieren al menos 2 materiales con granulometría.' });
    }

    // Enrich materials with granulometry if not provided (fetch from DB)
    const enriched = [];
    for (const m of materiales) {
      let gran = m.granulometria;
      if ((!gran || Object.keys(gran).length === 0) && m.id && req.db) {
        try {
          const { getUltimaGranulometria } = require('../services/mezclaService');
          const g = await getUltimaGranulometria(req.db, m.id);
          if (g?.puntos) {
            gran = {};
            for (const p of g.puntos) {
              gran[p.aberturaMm] = p.pasaPct;
            }
          }
        } catch { /* skip */ }
      }
      if (!gran || Object.keys(gran).length === 0) continue;
      enriched.push({ ...m, granulometria: gran });
    }

    if (enriched.length < 2) {
      return res.status(422).json({ error: 'No hay suficientes materiales con granulometría.' });
    }

    // Build constraints from request
    const constraints = parametros.restricciones || {};
    const paramConRestricciones = {
      asentamientoMm: parametros.asentamientoMm || 120,
      airePct: parametros.airePct || 2,
      fce: parametros.fce || 25,
      cementanteEstimado: parametros.cementanteEstimado || null,
      proporcionFinosMin: constraints.finosMin || 25,
      proporcionFinosMax: constraints.finosMax || 55,
      tmnObjetivo: parametros.tmnObjetivo || null,
    };

    // Apply per-material min/max constraints
    if (constraints.materialesMin || constraints.materialesMax) {
      paramConRestricciones._materialesMin = constraints.materialesMin; // {id: minPct}
      paramConRestricciones._materialesMax = constraints.materialesMax; // {id: maxPct}
    }

    // Load IRAM 1627 band for scoring (if available)
    try {
      const db = req.db;
      if (db?.CurvaSet && db?.CurvaGranulometrica && db?.CurvaPunto) {
        const gruesos = enriched.filter(m => (m.tipo || '').toUpperCase() !== 'FINO');
        const tmnEst = gruesos.length > 0 ? Math.max(...gruesos.map(g => Number(g.tmn) || 0)) : 19;
        const bandaSets = await db.CurvaSet.findAll({
          where: { materialUso: 'TOTAL', isActive: true },
          include: [{ model: db.CurvaGranulometrica, as: 'curvas', where: { isActive: true, tipo: 'BANDA' }, required: true,
            include: [{ model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] }] }],
        });
        for (const set of bandaSets) {
          if (Math.abs(Number(set.tmnMm) - tmnEst) < 0.5) {
            const curva = (set.curvas || []).find(c => (c.puntos || []).some(p => p.limInfPct != null || p.limSupPct != null));
            if (curva) {
              paramConRestricciones._bandaPuntos = curva.puntos.filter(p => !p.isNA).map(p => ({
                aberturaMm: p.aberturaMm, limInfPct: p.limInfPct, limSupPct: p.limSupPct,
              }));
              break;
            }
          }
        }
      }
    } catch (e) { console.warn('[sugerirProporciones] Band loading skipped:', e.message); }

    const solucion = optimizarProporciones(enriched, paramConRestricciones);
    if (!solucion) {
      return res.status(200).json({ ok: false, mensaje: 'No se encontró una combinación factible con las restricciones dadas.' });
    }

    res.json({ ok: true, ...solucion });
  } catch (err) {
    console.error('[sugerirProporciones]', err);
    res.status(400).json({ error: err.message || 'Error al sugerir proporciones' });
  }
};

module.exports = {
  getAgregadosParaMezcla,
  getGranulometria,
  evaluarMezcla,
  previewCurvaTeorica,
  optimizarMezcla,
  sugerirProporciones,
  guardarMezcla,
  actualizarMezcla,
  listarMezclas,
  getMezclaPorId,
  eliminarMezcla,
  duplicarMezcla,
  transicionarEstado,
  crearNuevaVersion,
  obtenerVersiones,
  obtenerHistorial,
  verificarIntegridad,
  getPropiedadesCombinadas,
};
