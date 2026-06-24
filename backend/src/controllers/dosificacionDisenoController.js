'use strict';

const svc = require('../services/dosificacionDisenoService');

/* [DEBUG-DOSIF] ──────────────────────────────────────────────────────────────
 * Gate para la dosificación de depuración: sólo un administrador y sólo si el
 * flag de ambiente ALLOW_DEBUG_DOSIFICACION está activo. Devuelve una respuesta
 * de error (y `true`) si el pedido es debug y no está autorizado; `false` si no
 * es un pedido debug (sigue el flujo normal). Removible con grep. */
const bloquearDebugNoAutorizado = (req, res) => {
  const esDebug = svc.esTipologiaDebug(req.body?.tipologiaCodigo)
    || req.body?.trazabilidadJson?.esDebug === true
    || req.body?.debug != null;
  if (!esDebug) return false;
  if (!svc.debugDosificacionHabilitado()) {
    res.status(403).json({
      ok: false, error: 'DEBUG_DOSIF_DESHABILITADO',
      message: 'El modo de dosificación de depuración no está habilitado en este entorno.',
    });
    return true;
  }
  const { hasRole, ROLES } = require('../domain/roles');
  if (!hasRole(req.user, ROLES.ADMIN)) {
    res.status(403).json({
      ok: false, error: 'DEBUG_DOSIF_SOLO_ADMIN',
      message: 'Sólo un administrador puede crear dosificaciones de depuración.',
    });
    return true;
  }
  return false;
};

/* ═══ Curvas Agua-Asentamiento ═══ */

const getCurvasAgua = async (req, res) => {
  try {
    const rows = await svc.getCurvasAguaAsentamiento(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getCurvasAgua:', err);
    res.status(500).json({ error: 'Error al obtener curvas agua-asentamiento' });
  }
};

const createCurvaAgua = async (req, res) => {
  try {
    const row = await svc.createCurvaAguaAsentamiento(req.db, req.body);
    res.status(201).json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] createCurvaAgua:', err);
    res.status(500).json({ error: 'Error al crear curva' });
  }
};

const updateCurvaAgua = async (req, res) => {
  try {
    const row = await svc.updateCurvaAguaAsentamiento(req.db, req.params.id, req.body);
    res.json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] updateCurvaAgua:', err);
    res.status(err.message.includes('no encontrada') ? 404 : 500).json({ error: err.message });
  }
};

const deleteCurvaAgua = async (req, res) => {
  try {
    const result = await svc.deleteCurvaAguaAsentamiento(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[dosificacionDiseno] deleteCurvaAgua:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══ Curvas A/C-Resistencia ═══ */

const getCurvasAC = async (req, res) => {
  try {
    const rows = await svc.getCurvasACResistencia(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getCurvasAC:', err);
    res.status(500).json({ error: 'Error al obtener curvas a/c-resistencia' });
  }
};

const createCurvaAC = async (req, res) => {
  try {
    const row = await svc.createCurvaACResistencia(req.db, req.body);
    res.status(201).json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] createCurvaAC:', err);
    res.status(500).json({ error: 'Error al crear curva' });
  }
};

const updateCurvaAC = async (req, res) => {
  try {
    const row = await svc.updateCurvaACResistencia(req.db, req.params.id, req.body);
    res.json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] updateCurvaAC:', err);
    res.status(err.message.includes('no encontrada') ? 404 : 500).json({ error: err.message });
  }
};

const deleteCurvaAC = async (req, res) => {
  try {
    const result = await svc.deleteCurvaACResistencia(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[dosificacionDiseno] deleteCurvaAC:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══ Aire esperado ═══ */

const getAire = async (req, res) => {
  try {
    const rows = await svc.getAireEsperado(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getAire:', err);
    res.status(500).json({ error: 'Error al obtener aire esperado' });
  }
};

/* ═══ Ábaco 1 ICPA ═══ */

const getAbaco = async (req, res) => {
  try {
    const rows = await svc.getAbacoCurvaICPA(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getAbaco:', err);
    res.status(500).json({ error: 'Error al obtener el Ábaco 1 ICPA' });
  }
};

const createAbaco = async (req, res) => {
  try {
    const row = await svc.createAbacoCurvaICPA(req.db, req.body);
    res.status(201).json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] createAbaco:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

const updateAbaco = async (req, res) => {
  try {
    const row = await svc.updateAbacoCurvaICPA(req.db, req.params.id, req.body);
    res.json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] updateAbaco:', err);
    res.status(err.statusCode || (err.message.includes('no encontrado') ? 404 : 500)).json({ error: err.message });
  }
};

const deleteAbaco = async (req, res) => {
  try {
    const result = await svc.deleteAbacoCurvaICPA(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[dosificacionDiseno] deleteAbaco:', err);
    res.status(500).json({ error: err.message });
  }
};

const restoreAbacoDefaults = async (req, res) => {
  try {
    const result = await svc.restoreAbacoCurvaICPADefaults(req.db);
    res.json(result);
  } catch (err) {
    console.error('[dosificacionDiseno] restoreAbacoDefaults:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/* ═══ Correctores ICPA ═══ read-only — feature deprecada, sólo lectura interna */

const getCorrectores = async (req, res) => {
  try {
    const rows = await svc.getCorrectoresICPA(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getCorrectores:', err);
    res.status(500).json({ error: 'Error al obtener correctores ICPA' });
  }
};

/* ═══ Durabilidad Exposición ═══ */

const getDurabilidad = async (req, res) => {
  try {
    const rows = await svc.getDurabilidadExposicion(req.db);
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] getDurabilidad:', err);
    res.status(500).json({ error: 'Error al obtener durabilidad' });
  }
};

/* ═══ Cálculo ═══ */

const calcular = async (req, res) => {
  try {
    if (bloquearDebugNoAutorizado(req, res)) return; // [DEBUG-DOSIF]
    const result = await svc.calcular(req.db, req.body);
    // Wrap in consistent envelope
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[dosificacionDiseno] calcular:', err);
    const message = err.message || 'Error en el cálculo';
    // Business-logic errors → 400
    const status = err.statusCode || 400;
    res.status(status).json({
      ok: false,
      error: 'CALC_ERROR',
      message,
      details: err.details || [],
    });
  }
};

/* ═══ Persistencia ═══ */

const guardar = async (req, res) => {
  try {
    if (bloquearDebugNoAutorizado(req, res)) return; // [DEBUG-DOSIF]
    const usuario = req.user?.nombre || req.user?.email || 'desconocido';
    const row = await svc.guardar(req.db, req.body, usuario);
    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[dosificacionDiseno] guardar:', err);
    const status = err.statusCode || err.status || 400;
    const payload = {
      ok: false,
      error: err.code || 'SAVE_ERROR',
      message: err.message || 'No se pudo guardar el diseño.',
      details: err.details || [],
    };
    // K.2 — propagar metadata de override si el error es REQUIRES_TECHNICAL_EVIDENCE
    if (err.overridable) {
      payload.overridable = true;
      payload.mezclaId = err.mezclaId;
      payload.mezclaNombre = err.mezclaNombre;
    }
    res.status(status).json(payload);
  }
};

const listar = async (req, res) => {
  try {
    const rows = await svc.listar(req.db, { plantaId: req.query.plantaId });
    res.json(rows);
  } catch (err) {
    console.error('[dosificacionDiseno] listar:', err);
    res.status(500).json({ error: 'Error al listar diseños' });
  }
};

const obtener = async (req, res) => {
  try {
    const row = await svc.obtener(req.db, req.params.id);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  } catch (err) {
    console.error('[dosificacionDiseno] obtener:', err);
    res.status(500).json({ error: 'Error al obtener diseño', detail: err.message, sql: err.sql || null });
  }
};

const eliminar = async (req, res) => {
  try {
    const usuario = req.user?.nombre || req.user?.email || 'desconocido';
    const result = await svc.eliminar(req.db, req.params.id, usuario);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || err.status || 500;
    console.error('[dosificacionDiseno] eliminar:', err);
    res.status(status).json({ error: err.message });
  }
};

/* ═══ Estado transitions ═══ */

const transicionarEstado = async (req, res) => {
  try {
    const { nuevoEstado, motivo, observaciones, metadata } = req.body;
    const usuario = req.body.usuario || req.user?.nombre || 'sistema';

    // RBAC Fase 1: transiciones críticas requieren Responsable+ (o Admin).
    // El motivo legal: solo el responsable de calidad firma puesta en producción
    // o suspensión de un diseño.
    const transicionesCriticas = ['EN_PRODUCCION', 'APROBADO', 'SUSPENDIDO', 'ARCHIVADO'];
    if (transicionesCriticas.includes(nuevoEstado)) {
      const { hasRole, ROLES, ROL_LABEL } = require('../domain/roles');
      if (!hasRole(req.user, ROLES.RESPONSABLE, ROLES.ADMIN)) {
        return res.status(403).json({
          error: `La transición a "${nuevoEstado}" requiere rol ${ROL_LABEL[ROLES.RESPONSABLE]} o ${ROL_LABEL[ROLES.ADMIN]}.`,
          rolRequerido: [ROLES.RESPONSABLE, ROLES.ADMIN],
          rolesDelUsuario: req.user?.roles || [],
        });
      }
    }

    // Fase 3: si el frontend declara un override de pastón, inyectamos los
    // roles del firmante leyéndolos del catálogo de empleados del tenant.
    // Esto evita que el frontend pueda enviar roles arbitrarios — el backend
    // los resuelve desde DB y los inyecta en metadata para validación dura
    // en `transicionarEstado`.
    let metadataFinal = metadata || null;
    if (metadata?.overridePaston?.firmadoPor) {
      try {
        const rolesFirmante = await svc.obtenerRolesFirmante(req.db, metadata.overridePaston.firmadoPor);
        metadataFinal = {
          ...metadata,
          overridePaston: {
            ...metadata.overridePaston,
            _rolesFirmante: rolesFirmante,
          },
        };
      } catch (e) {
        console.warn('[transicionarEstado] No se pudieron resolver roles del firmante:', e.message);
      }
    }

    // PR7 — Inyectar los roles del usuario actual en metadata para que el
    // service pueda validar quién aprueba/rechaza una revisión (solo el
    // revisor asignado o un ADMIN). Refactor 2026-05-20: los roles ya no
    // viven en `req.user.roles[]` (canónicos en EmpleadoRol eliminados);
    // se derivan single-read de los flags y de `User.rolCalidad`.
    const { getRolesDeUsuario } = require('../domain/roles');
    const rolesActor = getRolesDeUsuario(req.user);
    metadataFinal = { ...(metadataFinal || {}), _rolesActor: rolesActor };

    const row = await svc.transicionarEstado(req.db, req.params.id, nuevoEstado, { usuario, motivo, observaciones, metadata: metadataFinal });

    // Fase 2: si la transición disparó flags de concentración (auto-aprobación,
    // auto-rechazo), las exponemos en la response para que el frontend muestre
    // un toast informativo no bloqueante. Las flags YA quedaron persistidas en
    // DisenoHistorial.metadata.flags por el service.
    const clasificacion = row?.dataValues?.__clasificacion;
    const overrideAplicado = row?.dataValues?.__overrideAplicado;
    const betonmaticSE = row?.dataValues?.__betonmatic;
    const payload = row.toJSON ? row.toJSON() : row;
    delete payload.__clasificacion;
    delete payload.__overrideAplicado;
    delete payload.__betonmatic;
    if (clasificacion && clasificacion.concentracion) {
      payload._aviso = {
        tipo: 'concentracion_responsabilidad',
        flags: clasificacion.flags,
        etiquetas: clasificacion.etiquetas,
      };
    }
    if (overrideAplicado) {
      payload._overrideAplicado = {
        firmadoPor: overrideAplicado.firmadoPor,
        firmaConcentrada: overrideAplicado.firmaConcentrada,
      };
    }
    if (betonmaticSE) {
      payload._betonmatic = betonmaticSE;
    }
    res.json(payload);
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    console.error('[dosificacionDiseno] transicionarEstado:', err);
    const payload = { error: err.message };
    if (err.code) payload.code = err.code;
    if (err.overridable) {
      payload.overridable = true;
      payload.mezclaId = err.mezclaId;
      payload.mezclaNombre = err.mezclaNombre;
    }
    res.status(status).json(payload);
  }
};

const crearNuevaVersion = async (req, res) => {
  try {
    const usuario = req.body.usuario || req.user?.nombre || 'sistema';
    const motivo = req.body.motivo || null;
    const row = await svc.crearNuevaVersion(req.db, req.params.id, { usuario, motivo });
    res.status(201).json(row);
  } catch (err) {
    const status = err.status || 500;
    console.error('[dosificacionDiseno] crearNuevaVersion:', err);
    res.status(status).json({ error: err.message });
  }
};

const obtenerVersiones = async (req, res) => {
  try {
    const rows = await svc.obtenerVersiones(req.db, req.params.id);
    res.json(rows);
  } catch (err) {
    const status = err.status || 500;
    console.error('[dosificacionDiseno] obtenerVersiones:', err);
    res.status(status).json({ error: err.message });
  }
};

const obtenerHistorial = async (req, res) => {
  try {
    const rows = await svc.obtenerHistorial(req.db, req.params.id);
    // Fase 4.2 — enriquecer eventos con label, categoría, destacado.
    // El engine puro recibe registros planos (no instancias Sequelize).
    const { enriquecerLista, resumirEventos } = require('../domain/dosificacion/historialPresentacion');
    const planos = (rows || []).map((r) => (typeof r.get === 'function' ? r.get({ plain: true }) : r));
    const eventos = enriquecerLista(planos);
    const resumen = resumirEventos(eventos);
    res.json({ eventos, resumen });
  } catch (err) {
    console.error('[dosificacionDiseno] obtenerHistorial:', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Fase 4.4 — Verifica la integridad de la cadena de hashes del historial.
 * Devuelve si la cadena coincide con lo persistido y, si rompe, en qué
 * evento. Útil para auditoría externa: detecta edición/borrado/reorden de
 * eventos. NO detecta inserciones legítimas al final por un atacante con
 * conocimiento del algoritmo.
 */
const verificarCadenaHistorial = async (req, res) => {
  try {
    const rows = await svc.obtenerHistorial(req.db, req.params.id);
    const planos = (rows || []).map((r) => (typeof r.get === 'function' ? r.get({ plain: true }) : r));
    const { verificarCadena } = require('../domain/dosificacion/hashCadenaEventos');
    const resultado = verificarCadena(planos);
    res.json(resultado);
  } catch (err) {
    console.error('[dosificacionDiseno] verificarCadenaHistorial:', err);
    res.status(500).json({ error: err.message });
  }
};

/* ═══ Resultados de producción ═══ */

const obtenerResultadosProduccion = async (req, res) => {
  try {
    const result = await svc.obtenerResultadosProduccion(req.db, req.params.id, {
      edadDias: req.query.edadDias,
    });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('[dosificacionDiseno] obtenerResultadosProduccion:', err);
    res.status(status).json({ error: err.message });
  }
};

const vincularCatalogo = async (req, res) => {
  try {
    const row = await svc.vincularCatalogo(req.db, req.params.id, req.body.idDosificacionCatalogo);
    res.json(row);
  } catch (err) {
    const status = err.status || 500;
    console.error('[dosificacionDiseno] vincularCatalogo:', err);
    res.status(status).json({ error: err.message });
  }
};

/* ═══ Verificar integridad ═══ */

const verificarIntegridad = async (req, res) => {
  try {
    const result = await svc.verificarIntegridadDosificacion(req.db, req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('[dosificacionDiseno] verificarIntegridad:', err);
    res.status(status).json({ error: err.message });
  }
};

/* ═══ Factores de edad ═══ */

const getFactoresEdad = async (req, res) => {
  try { res.json(await svc.getFactoresEdad(req.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
const createFactorEdad = async (req, res) => {
  try { res.status(201).json(await svc.createFactorEdad(req.db, req.body)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
const updateFactorEdad = async (req, res) => {
  try { res.json(await svc.updateFactorEdad(req.db, req.params.id, req.body)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
const deleteFactorEdad = async (req, res) => {
  try { res.json(await svc.deleteFactorEdad(req.db, req.params.id)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};

/* ═══ Pastón de pruebas ═══ */

const listarPastones = async (req, res) => {
  try { res.json(await svc.listarPastones(req.db, req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
const obtenerPaston = async (req, res) => {
  try { res.json(await svc.obtenerPaston(req.db, req.params.pid)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
const crearPaston = async (req, res) => {
  try { res.status(201).json(await svc.crearPaston(req.db, { ...req.body, idDosificacionDisenada: req.params.id }, req.user?.nombre)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
const actualizarPaston = async (req, res) => {
  try { res.json(await svc.actualizarPaston(req.db, req.params.pid, req.body)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};
const eliminarPaston = async (req, res) => {
  try { res.json(await svc.eliminarPaston(req.db, req.params.pid)); }
  catch (e) { res.status(e.statusCode || 500).json({ error: e.message }); }
};

/* ═══ Correcciones post-pastón ═══ */

const listarCorrecciones = async (req, res) => {
  try { res.json(await svc.listarCorrecciones(req.db, req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
const aplicarCorrecciones = async (req, res) => {
  try {
    const usuario = req.user?.nombre || req.user?.email || 'sistema';
    const result = await svc.aplicarCorrecciones(req.db, req.params.id, req.body.correcciones, usuario);
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
};

/* ═══ Aptitud de materiales (CIRSOC 200-2024 §3.2.3.3) ═══ */

const verificarAptitudMateriales = async (req, res) => {
  try {
    console.log('[aptitud-get] id:', req.params.id);
    const result = await svc.verificarAptitudMateriales(req.db, req.params.id);
    console.log('[aptitud-get] result:', result.resultadoGlobal, 'verificaciones:', result.verificaciones?.length);
    res.json(result);
  } catch (e) {
    console.error('[aptitud-get] error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
};

const verificarAptitudMaterialesByParams = async (req, res) => {
  try {
    console.log('[aptitud-calc] body:', JSON.stringify(req.body));
    const result = await svc.verificarAptitudMaterialesByParams(req.db, req.body);
    console.log('[aptitud-calc] result:', result.resultadoGlobal, 'verificaciones:', result.verificaciones?.length);
    res.json(result);
  } catch (e) {
    console.error('[aptitud-calc] error:', e.message);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
};

/* ═══ Consistencia (Tablas 4.1/4.2) ═══ read-only — valor normativo CIRSOC */

const getConsistencia = async (req, res) => {
  try { res.json(await svc.getConsistencia(req.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};

/* ═══ Aire durabilidad (Tabla 4.3) ═══ read-only — valor normativo CIRSOC */

const getAireDurabilidad = async (req, res) => {
  try { res.json(await svc.getAireDurabilidad(req.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};

/* ═══ Pulverulento mínimo (Tabla 4.4) ═══ read-only — valor normativo CIRSOC */

const getPulverulentoMinimo = async (req, res) => {
  try { res.json(await svc.getPulverulentoMinimo(req.db)); }
  catch (e) { res.status(500).json({ error: e.message }); }
};

module.exports = {
  getCurvasAgua, createCurvaAgua, updateCurvaAgua, deleteCurvaAgua,
  getCurvasAC, createCurvaAC, updateCurvaAC, deleteCurvaAC,
  getAire,
  getCorrectores,
  getAbaco, createAbaco, updateAbaco, deleteAbaco, restoreAbacoDefaults,
  getDurabilidad,
  getConsistencia,
  getAireDurabilidad,
  getPulverulentoMinimo,
  getFactoresEdad, createFactorEdad, updateFactorEdad, deleteFactorEdad,
  calcular,
  guardar, listar, obtener, eliminar,
  transicionarEstado, crearNuevaVersion, obtenerVersiones, obtenerHistorial, verificarCadenaHistorial,
  verificarIntegridad,
  obtenerResultadosProduccion,
  vincularCatalogo,
  listarPastones, obtenerPaston, crearPaston, actualizarPaston, eliminarPaston,
  listarCorrecciones, aplicarCorrecciones,
  verificarAptitudMateriales,
  verificarAptitudMaterialesByParams,
};
