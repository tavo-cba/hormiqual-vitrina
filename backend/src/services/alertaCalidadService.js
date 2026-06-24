'use strict';

/**
 * alertaCalidadService.js
 *
 * Generates, manages and distributes quality alerts.
 * Designed to run on a daily cron job + on-demand after test saves.
 */

/**
 * Check all active aggregates for upcoming/expired tests.
 * Generates ENSAYO_POR_VENCER and ENSAYO_VENCIDO alerts.
 */
const verificarVencimientosEnsayos = async (db) => {
  const hoy = new Date();
  const alertasCreadas = [];

  // Get all active aggregates
  const agregados = await db.Agregado.findAll({ where: { activo: true }, raw: true });

  for (const ag of agregados) {
    // Get resumen for this aggregate
    const { getResumen } = require('./agregadoEnsayoService');
    let resumen;
    try { resumen = await getResumen(db, ag.idAgregado); } catch { continue; }
    if (!resumen?.items) continue;

    for (const item of resumen.items) {
      if (item.estado === 'NO_APLICA' || item.estado === 'VIGENTE') continue;

      const tipoAlerta = item.estado === 'VENCIDO' ? 'ENSAYO_VENCIDO'
        : item.estado === 'POR_VENCER' ? 'ENSAYO_POR_VENCER'
        : null;
      if (!tipoAlerta) continue;

      const nivel = tipoAlerta === 'ENSAYO_VENCIDO' ? 'ALTO'
        : (item.diasParaVencer != null && item.diasParaVencer <= 7) ? 'ALTO' : 'MEDIO';

      // Check if we already have a pending alert for this
      const existing = await db.AlertaCalidad.findOne({
        where: {
          tipo: tipoAlerta,
          idMaterial: ag.idAgregado,
          estado: 'PENDIENTE',
          [db.Sequelize.Op.and]: db.Sequelize.literal(
            `JSON_EXTRACT(detalle, '$.codigoEnsayo') = '${item.tipo?.codigo || ''}'`
          ),
        },
      });
      if (existing) continue; // Don't duplicate

      const diasMsg = item.diasParaVencer != null ? `${item.diasParaVencer} días` : '';
      const mensaje = tipoAlerta === 'ENSAYO_VENCIDO'
        ? `Ensayo "${item.tipo?.nombre}" de "${ag.nombre}" VENCIDO.`
        : `Ensayo "${item.tipo?.nombre}" de "${ag.nombre}" vence en ${diasMsg}.`;

      const alerta = await db.AlertaCalidad.create({
        tipo: tipoAlerta,
        nivel,
        mensaje,
        detalle: {
          codigoEnsayo: item.tipo?.codigo,
          nombreEnsayo: item.tipo?.nombre,
          normaRef: item.tipo?.normaRef,
          diasParaVencer: item.diasParaVencer,
          fechaVencimiento: item.ultimoEnsayo?.fechaVencimiento,
          idAgregadoEnsayo: item.ultimoEnsayo?.id,
        },
        idPlanta: ag.idPlanta || null,
        idMaterial: ag.idAgregado,
        nombreMaterial: ag.nombre,
      });
      alertasCreadas.push(alerta);
    }
  }

  return alertasCreadas;
};

/**
 * Check resistance results for anomalies.
 * Called after each EnsayoResistencia save.
 */
const verificarResistenciaAnomal = async (db, ensayo, probeta) => {
  if (!ensayo?.resistencia || !probeta?.idMuestra) return null;

  const muestra = await db.Muestra.findByPk(probeta.idMuestra, { raw: true });
  if (!muestra) return null;

  // Get other probetas from same muestra
  const otrasEnsayos = await db.EnsayoResistencia.findAll({
    where: { idProbeta: { [db.Sequelize.Op.ne]: probeta.idProbeta } },
    include: [{ model: db.Probeta, as: 'probeta', where: { idMuestra: probeta.idMuestra } }],
    raw: true,
  });

  if (otrasEnsayos.length < 2) return null; // Need at least 2 others to compare

  const resistencias = otrasEnsayos.map(e => Number(e.resistencia)).filter(r => r > 0);
  if (resistencias.length === 0) return null;

  const media = resistencias.reduce((s, v) => s + v, 0) / resistencias.length;
  const desvioPct = media > 0 ? ((ensayo.resistencia - media) / media) * 100 : 0;

  // Alert if >15% below average
  if (desvioPct < -15) {
    return db.AlertaCalidad.create({
      tipo: 'RESISTENCIA_ANOMALA',
      nivel: desvioPct < -25 ? 'CRITICO' : 'ALTO',
      mensaje: `Probeta con resistencia ${Number(ensayo.resistencia).toFixed(2)} MPa (${desvioPct.toFixed(1)}% debajo del promedio ${media.toFixed(2)} MPa).`,
      detalle: {
        resistencia: ensayo.resistencia,
        media,
        desvioPct,
        idMuestra: probeta.idMuestra,
        nombreMuestra: muestra.nombre,
      },
      idPlanta: muestra.idPlanta || null,
      nombreMaterial: muestra.nombre,
    });
  }
  return null;
};

/* ═══════════════════════════════════════════════════════════════════
   alertarResultadoFueraDeEspec — Dispatcher de alertas (Prompt 1, Commit 6)
   ═══════════════════════════════════════════════════════════════════

   Convierte el resultado de un ensayo a una alerta `AlertaCalidad` (o a
   nada, si el resultado no requiere alerta).

   Acepta el resultado en dos formatos:
     1. `ComplianceResult` canónico (con `status` válido). Recomendado.
     2. Shape legacy del motor `evaluarEnsayo()` (`{ cumple, estado, mensaje, ... }`)
        o un string suelto. Se convierte vía `fromLegacyEval` antes del dispatch.

   Tabla de disparadores:
     pass                                 → null (no alerta)
     passWithObservations                 → null (cumple, solo observación)
     conditionalPass                      → APTITUD_CONDICIONADA / MEDIO
     fail con severity='bloqueante'       → ENSAYO_NO_CUMPLE_BLOQUEANTE / CRITICO
     fail con severity null|'no_bloqueante' → ENSAYO_NO_CUMPLE / ALTO
     inconclusive (con options.exigible)  → ENSAYO_INCONCLUYENTE / BAJO
     inconclusive (sin exigible explícito) → null (TODO: depende de contexto, Prompt 2)
     notEvaluated                         → null (estado técnico, no normativo)
     informative                          → null (sin criterio de cumplimiento)
     expired (con options.exigible)       → ENSAYO_VENCIDO / MEDIO
     expired (sin exigible explícito)     → null (cron `verificarVencimientosEnsayos`
                                            ya cubre vencimientos por su cuenta — D4 del plan)
     pending (con options.exigible)       → MATERIAL_SIN_ENSAYO / MEDIO
     pending (sin exigible explícito)     → null (TODO: depende de contexto, Prompt 2)
     notApplicable                        → null (no exigible por contexto)

   Sobre "exigible en el contexto": la noción formal de exigibilidad llega en
   Prompt 2. Por ahora seguimos el principio "falso negativo controlado >
   falso positivo masivo": si el caller no pasa `options.exigible: true`,
   los disparadores de `inconclusive`, `expired` y `pending` quedan dormidos.
   Esto evita que el usuario aprenda a ignorar alertas falsas.
*/

const _ALERT_TRIGGERS = {
  conditionalPass: () => ({ tipo: 'APTITUD_CONDICIONADA',          nivel: 'MEDIO' }),
  failBloqueante:  () => ({ tipo: 'ENSAYO_NO_CUMPLE_BLOQUEANTE',   nivel: 'CRITICO' }),
  failStandard:    () => ({ tipo: 'ENSAYO_NO_CUMPLE',              nivel: 'ALTO' }),
  inconclusive:    () => ({ tipo: 'ENSAYO_INCONCLUYENTE',          nivel: 'BAJO' }),
  expired:         () => ({ tipo: 'ENSAYO_VENCIDO',                nivel: 'MEDIO' }),
  pending:         () => ({ tipo: 'MATERIAL_SIN_ENSAYO',           nivel: 'MEDIO' }),
};

/**
 * Decide si un ComplianceResult debe disparar una alerta y, en tal caso,
 * con qué tipo y nivel.
 *
 * @param {ComplianceResult} compliance
 * @param {Object} options - { exigible?: boolean } — para los estados
 *   `inconclusive`, `expired` y `pending` el dispatch solo emite si
 *   `options.exigible === true`. En cualquier otro caso (false, null,
 *   undefined) la función retorna null.
 * @returns {{tipo: string, nivel: string}|null}
 */
function _resolveAlertTrigger(compliance, options = {}) {
  const { matchExt, SEVERITY } = require('../domain/compliance');
  return matchExt(compliance, {
    pass:                 () => null,
    passWithObservations: () => null,
    informative:          () => null,
    notApplicable:        () => null,
    notEvaluated:         () => null,
    conditionalPass:      () => _ALERT_TRIGGERS.conditionalPass(),
    fail: () => (compliance.severity === SEVERITY.BLOQUEANTE
      ? _ALERT_TRIGGERS.failBloqueante()
      : _ALERT_TRIGGERS.failStandard()),
    inconclusive: () => (options.exigible === true
      ? _ALERT_TRIGGERS.inconclusive()
      : null),
    expired: () => (options.exigible === true
      ? _ALERT_TRIGGERS.expired()
      : null),
    pending: () => (options.exigible === true
      ? _ALERT_TRIGGERS.pending()
      : null),
  });
}

/**
 * Normaliza un input heterogéneo a un ComplianceResult canónico.
 *
 * Acepta tres formas en orden de preferencia:
 *   1. ComplianceResult canónico directo (tiene `status` válido).
 *   2. Wrapper `_evaluacion` del motor que lleva `compliance` anidado
 *      (Prompt 2 C6) — `_evaluacion.compliance` es el ComplianceResult.
 *   3. Shape legacy del motor (`{ estado, mensaje, ... }`) o string suelto —
 *      pasa por `fromLegacyEval`. Pierde estructura rica (severity,
 *      conditions[], detection_limit) que sí preserva la forma 2.
 *
 * Cuando los call sites pasan `_evaluacion` con `compliance` poblado
 * (post-C6), se prefiere ese campo aunque coexista con el shape legacy
 * — el canónico siempre gana sobre la derivación desde `estado`.
 *
 * Prompt 4 C2: migrado de `fromAnyLegacy` (alias deprecated) a
 * `fromLegacyEval` directo. Misma función, nombre canónico.
 */
function _normalizeToCompliance(evalResult) {
  const { ALL_STATUSES, fromLegacyEval } = require('../domain/compliance');
  if (!evalResult || typeof evalResult !== 'object') {
    return fromLegacyEval(evalResult);
  }
  // Forma 1: ComplianceResult directo
  if (evalResult.status && ALL_STATUSES.includes(evalResult.status)) {
    return evalResult;
  }
  // Forma 2: wrapper _evaluacion con compliance anidado (preferido post-C6)
  if (evalResult.compliance &&
      typeof evalResult.compliance === 'object' &&
      ALL_STATUSES.includes(evalResult.compliance.status)) {
    return evalResult.compliance;
  }
  // Forma 3: legacy via adapter
  return fromLegacyEval(evalResult);
}

/**
 * Construye el mensaje legible para la alerta a partir del compliance.
 */
function _buildAlertMessage(trigger, compliance, ensayo, material) {
  const { getLongLabel } = require('../domain/compliance');
  const ensayoNombre = ensayo?.tipo?.nombre || ensayo?.tipo?.codigo || 'Ensayo';
  const materialNombre = material?.nombre || material?.idAgregado || 'material';
  const veredicto = getLongLabel(compliance);
  const detalleTexto =
    compliance.message
      || (Array.isArray(compliance.reasons) && compliance.reasons[0])
      || compliance.observation
      || compliance.reason
      || '';
  const sufijo = detalleTexto ? `: ${detalleTexto}` : '';
  return `${veredicto} — Ensayo "${ensayoNombre}" de "${materialNombre}"${sufijo}`;
}

/**
 * Genera una alerta `AlertaCalidad` desde el resultado de un ensayo.
 *
 * @param {Object} db - Sequelize db (debe exponer `db.AlertaCalidad`)
 * @param {Object} ensayo - { idAgregadoEnsayo, tipo: {codigo, nombre}, ... }
 * @param {Object|string} evalResult - ComplianceResult canónico o shape legacy
 * @param {Object} material - { idAgregado, nombre, idPlanta }
 * @param {Object} [options]
 * @param {boolean} [options.exigible] - Si el ensayo es exigible en el
 *   contexto del material/uso. Habilita los disparadores de inconclusive,
 *   expired y pending. Default: undefined (esos disparadores quedan dormidos).
 * @returns {Promise<Alerta|null>}
 */
const alertarResultadoFueraDeEspec = async (db, ensayo, evalResult, material, options = {}) => {
  if (!db?.AlertaCalidad) return null;

  const compliance = _normalizeToCompliance(evalResult);
  const trigger = _resolveAlertTrigger(compliance, options);
  if (!trigger) return null;

  return db.AlertaCalidad.create({
    tipo: trigger.tipo,
    nivel: trigger.nivel,
    mensaje: _buildAlertMessage(trigger, compliance, ensayo, material),
    detalle: {
      idAgregadoEnsayo: ensayo?.idAgregadoEnsayo || ensayo?.id,
      codigoEnsayo: ensayo?.tipo?.codigo,
      compliance,           // ComplianceResult canónico, queda persistido para auditoría
      complianceStatus: compliance.status,
    },
    idPlanta: material?.idPlanta || null,
    idMaterial: material?.idAgregado || null,
    nombreMaterial: material?.nombre || '',
  });
};

/**
 * PR4 — Trazabilidad activa de rescates por política del catálogo.
 *
 * Emite una alerta de tipo `RESCATE_POR_POLITICA` cuando un ensayo cargado
 * dio fuera de norma (`originalCompliance.status='fail'`) pero el catálogo
 * del tenant lo declaró `obligatorio=false` para el contexto del agregado,
 * por lo que `aptitudPolicyHelper` lo bajó a `informative` antes de armar el
 * veredicto.
 *
 * Severidad: `BAJO` (advisory). No bloquea ninguna operación. Su único
 * propósito es traer al panel del jefe técnico la decisión administrativa
 * de "rescate" para que quede en auditoría activa, no solo pasiva en el
 * detalle de la verificación.
 *
 * @param {Object} db - Sequelize db (debe exponer `db.AlertaCalidad`)
 * @param {Object} ensayo - { idAgregadoEnsayo?, tipo: {codigo, nombre} }
 * @param {Object} originalCompliance - ComplianceResult canónico con el fail original
 * @param {Object} material - { idAgregado, nombre, idPlanta }
 * @returns {Promise<Alerta|null>}
 */
const alertarRescatePorPolitica = async (db, ensayo, originalCompliance, material) => {
  if (!db?.AlertaCalidad || !originalCompliance) return null;
  const { ALL_STATUSES } = require('../domain/compliance');
  if (!ALL_STATUSES.includes(originalCompliance.status)) return null;

  const ensayoNombre = ensayo?.tipo?.nombre || ensayo?.tipo?.codigo || 'Ensayo';
  const materialNombre = material?.nombre || material?.idAgregado || 'material';
  const detalleTexto = (Array.isArray(originalCompliance.reasons) && originalCompliance.reasons[0])
    || originalCompliance.message
    || originalCompliance.reason
    || '';
  const sufijo = detalleTexto ? `: ${detalleTexto}` : '';

  return db.AlertaCalidad.create({
    tipo: 'RESCATE_POR_POLITICA',
    nivel: 'BAJO',
    mensaje: `Rescate por política — Ensayo "${ensayoNombre}" de "${materialNombre}" fuera de norma, ` +
             `pero el catálogo lo declaró no obligatorio para este contexto${sufijo}`,
    detalle: {
      idAgregadoEnsayo: ensayo?.idAgregadoEnsayo || ensayo?.id,
      codigoEnsayo: ensayo?.tipo?.codigo,
      originalCompliance,
      complianceStatus: 'informative',           // estado actual post-rescate
      originalStatus: originalCompliance.status, // estado real pre-rescate
      rescatePorPolitica: true,
    },
    idPlanta: material?.idPlanta || null,
    idMaterial: material?.idAgregado || null,
    nombreMaterial: material?.nombre || '',
  });
};

// ── Query functions ──

const listarAlertas = async (db, { estado, tipo, nivel, idPlanta, asignadaA, paraUsuario, limit = 50, offset = 0 } = {}) => {
  const { Op } = require('sequelize');
  const where = {};
  if (estado) where.estado = estado;
  if (tipo) where.tipo = tipo;
  if (nivel) where.nivel = nivel;
  if (idPlanta) where.idPlanta = idPlanta;
  // Filtros nuevos (Bug 2 / 2026-05-29) — alertas asignadas a un usuario.
  //   `asignadaA`: filtra estricto por ese username (solo las suyas).
  //   `paraUsuario`: incluye las asignadas al usuario Y las globales (asignadaA = NULL).
  //                  Útil para el panel del usuario: ve sus pendientes + las generales.
  if (asignadaA) {
    where.asignadaA = asignadaA;
  } else if (paraUsuario) {
    where[Op.or] = [
      { asignadaA: paraUsuario },
      { asignadaA: null },
    ];
  }

  const { count, rows } = await db.AlertaCalidad.findAndCountAll({
    where,
    order: [['nivel', 'ASC'], ['createdAt', 'DESC']], // CRITICO first
    limit: Number(limit),
    offset: Number(offset),
  });
  return { total: count, alertas: rows.map(r => r.get({ plain: true })) };
};

const contarPendientes = async (db, { idPlanta, asignadaA } = {}) => {
  const where = { estado: 'PENDIENTE' };
  if (idPlanta) where.idPlanta = idPlanta;
  if (asignadaA) where.asignadaA = asignadaA;
  return db.AlertaCalidad.count({ where });
};

const marcarLeida = async (db, idAlertaCalidad, usuario) => {
  const alerta = await db.AlertaCalidad.findByPk(idAlertaCalidad);
  if (!alerta) return null;
  await alerta.update({ estado: 'LEIDA', leidaPor: usuario, fechaLectura: new Date() });
  return alerta.get({ plain: true });
};

const resolver = async (db, idAlertaCalidad, { usuario, notas } = {}) => {
  const alerta = await db.AlertaCalidad.findByPk(idAlertaCalidad);
  if (!alerta) return null;
  await alerta.update({ estado: 'RESUELTA', resueltaPor: usuario, fechaResolucion: new Date(), notasResolucion: notas || null });
  return alerta.get({ plain: true });
};

const ignorar = async (db, idAlertaCalidad, usuario) => {
  const alerta = await db.AlertaCalidad.findByPk(idAlertaCalidad);
  if (!alerta) return null;
  await alerta.update({ estado: 'IGNORADA', resueltaPor: usuario, fechaResolucion: new Date() });
  return alerta.get({ plain: true });
};

// ── Auto-resolve stale alerts ──

const autoResolverVencimientos = async (db) => {
  // Resolve ENSAYO_POR_VENCER alerts where the test was renewed
  const pendientes = await db.AlertaCalidad.findAll({
    where: { tipo: ['ENSAYO_POR_VENCER', 'ENSAYO_VENCIDO'], estado: 'PENDIENTE' },
  });

  let resueltas = 0;
  for (const al of pendientes) {
    const det = al.detalle;
    if (!det?.idAgregadoEnsayo) continue;
    // Check if there's a newer ensayo of the same type
    const tipoCode = det.codigoEnsayo;
    const matId = al.idMaterial;
    if (!tipoCode || !matId) continue;

    const newer = await db.AgregadoEnsayo.findOne({
      where: {
        legacyAgregadoId: matId,
        isActive: true,
        idAgregadoEnsayo: { [db.Sequelize.Op.gt]: det.idAgregadoEnsayo },
      },
      include: [{ model: db.AgregadoEnsayoTipo, as: 'tipo', where: { codigo: tipoCode } }],
    });
    if (newer) {
      await al.update({ estado: 'RESUELTA', notasResolucion: 'Auto-resuelta: nuevo ensayo registrado.' });
      resueltas++;
    }
  }
  return resueltas;
};

module.exports = {
  verificarVencimientosEnsayos,
  verificarResistenciaAnomal,
  alertarResultadoFueraDeEspec,
  alertarRescatePorPolitica,
  listarAlertas,
  contarPendientes,
  marcarLeida,
  resolver,
  ignorar,
  autoResolverVencimientos,
};
