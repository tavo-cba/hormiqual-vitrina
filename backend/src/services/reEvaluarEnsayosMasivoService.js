'use strict';

/**
 * reEvaluarEnsayosMasivoService.js
 *
 * Re-evalúa ensayos viejos con el motor de evaluación actual.
 *
 * Problema que resuelve: el motor de evaluación persiste su veredicto
 * en `resultado._evaluacion` (ensayos comunes) y/o `resultado.granulometria.evaluacion`
 * + `evaluacionAuto` + `reglasCIRSOC` (granulometrías). Cuando el motor
 * cambia (nueva regla, fix de bug, wording corregido), los ensayos
 * guardados ANTES siguen mostrando el veredicto/wording viejo en los PDFs
 * porque el PDF lee esos campos persistidos sin recalcular.
 *
 * Este servicio recorre todos los ensayos del tenant, re-evalúa con el
 * motor actual y persiste si hay cambios. Soporta:
 *   - dryRun: reporta qué cambiaría sin escribir.
 *   - filtros: por id de agregado, por tipo de ensayo, por fecha desde.
 *   - paginación interna (batches) para no cargar miles de ensayos en memoria.
 *
 * Multi-tenant: recibe `db` (instancia Sequelize del tenant) explícitamente.
 * No usa engines impuros — delega a las funciones existentes de
 * `agregadoEnsayoService` y `granulometriaEvalService`.
 */

const {
  autoEvaluarGranulometriaFinoIRAM1627,
} = require('./granulometriaEvalService');

const { evaluarEnsayo } = require('../domain/ensayoEvalEngine');

// Helpers internos que ya viven en agregadoEnsayoService — los importamos
// indirectamente (no son parte de su superficie pública). Para no crear
// dependencia circular, copiamos la lógica mínima necesaria.

/**
 * Auto-evalúa granulometría de grueso contra Tabla 3.5 CIRSOC.
 * Es una versión simplificada de la que vive en agregadoEnsayoService:
 * solo necesitamos invocarla si hay tamices y `tipoAgregado === 'GRUESO'`.
 *
 * NO replicamos toda la lógica acá; en este servicio importamos la versión
 * canónica si existe. Ver más abajo.
 */
let _autoEvaluarGranulometriaGrueso = null;
try {
  // Intentar reutilizar la implementación canónica.
  const aes = require('./agregadoEnsayoService');
  _autoEvaluarGranulometriaGrueso = aes.autoEvaluarGranulometriaGrueso || null;
} catch { /* no-op: si hay circular, dejamos null */ }

/**
 * Lee el resultado JSON del ensayo. Soporta string (DB) y object (memoria).
 */
function _parseResultado(ensayo) {
  let r = ensayo.resultado;
  if (r == null) return null;
  if (typeof r === 'string') {
    try { return JSON.parse(r); } catch { return null; }
  }
  return r;
}

/**
 * Re-evalúa un único ensayo (in memory). Devuelve:
 *   { resultado, cumpleNuevo, cambios: [...string], huboCambio: bool }
 * NO persiste — lo hace el caller.
 */
function _reEvaluarUno(ensayo) {
  const cambios = [];
  const r = _parseResultado(ensayo);
  if (!r) return { resultado: r, cumpleNuevo: ensayo.cumple, cambios, huboCambio: false };

  // Snapshot before — para detectar cambios.
  const snapshotBefore = JSON.stringify({
    eval: r.granulometria?.evaluacion ?? null,
    evalAuto: r.granulometria?.evaluacionAuto ?? null,
    evalAutoG: r.granulometria?.evaluacionAutoGrueso ?? null,
    reglasCI: r.granulometria?.evaluacionAuto?.reglasCIRSOC ?? null,
    _eval: r._evaluacion ?? null,
  });
  const cumpleBefore = ensayo.cumple;

  const tipoAg = (
    r.granulometria?.tipoAgregado
    || ensayo.tipo?.aplicaA?.[0]
    || null
  );
  const tipoAgUpper = (tipoAg || '').toUpperCase();
  let cumpleNuevo = ensayo.cumple;

  // ── Granulometría: regenerar evaluacionAuto + implicancias + reglasCIRSOC ──
  if (r.granulometria?.tamices?.length) {
    if (tipoAgUpper === 'FINO') {
      try { autoEvaluarGranulometriaFinoIRAM1627(r); } catch { /* ignore */ }
    }
    if (tipoAgUpper === 'GRUESO' && _autoEvaluarGranulometriaGrueso) {
      try { _autoEvaluarGranulometriaGrueso(r); } catch { /* ignore */ }
    }
  }

  // ── Ensayos no granulometría: regenerar `_evaluacion` con motor actual ──
  const codigo = ensayo.tipo?.codigo;
  if (codigo && !codigo.includes('GRANULOMETRIA') && codigo !== 'IRAM1505_GRANULOMETRIA') {
    try {
      const evalResult = evaluarEnsayo(codigo, r, { tipoAgregado: tipoAg });
      if (evalResult) {
        r._evaluacion = {
          estado: evalResult.estado,
          mensaje: evalResult.mensaje,
          informativo: evalResult.informativo,
          alerta: evalResult.alerta,
          compliance: evalResult.compliance || null,
        };
        if (evalResult.cumple) {
          cumpleNuevo = evalResult.cumple;
        }
      }
    } catch { /* ignore */ }
  }

  // Snapshot after
  const snapshotAfter = JSON.stringify({
    eval: r.granulometria?.evaluacion ?? null,
    evalAuto: r.granulometria?.evaluacionAuto ?? null,
    evalAutoG: r.granulometria?.evaluacionAutoGrueso ?? null,
    reglasCI: r.granulometria?.evaluacionAuto?.reglasCIRSOC ?? null,
    _eval: r._evaluacion ?? null,
  });

  if (snapshotBefore !== snapshotAfter) cambios.push('evaluacion-actualizada');
  if (cumpleNuevo !== cumpleBefore) cambios.push(`cumple: ${cumpleBefore} → ${cumpleNuevo}`);

  return {
    resultado: r,
    cumpleNuevo,
    cambios,
    huboCambio: cambios.length > 0,
  };
}

/**
 * Re-evalúa todos los ensayos del tenant con el motor actual.
 *
 * @param {object} db - Sequelize del tenant.
 * @param {object} opts
 *   - dryRun: boolean (default false). Si true, NO persiste, solo reporta.
 *   - batchSize: number (default 100). Tamaño de batch para paginación.
 *   - filtros: { idAgregado?, codigoTipo?, fechaDesde? }
 *   - sampleCambios: number (default 50). Cuántos cambios listar en el response.
 * @returns {Promise<{
 *   stats: { total, cambiaron, errores, dryRun },
 *   sampleCambios: Array<{ idEnsayo, codigoTipo, idAgregado, cambios }>,
 *   completadoEn: number (ms),
 * }>}
 */
async function reEvaluarTodosLosEnsayos(db, opts = {}) {
  const start = Date.now();
  const dryRun = !!opts.dryRun;
  const batchSize = Math.max(1, Math.min(500, opts.batchSize || 100));
  const sampleMax = Math.max(0, Math.min(500, opts.sampleCambios ?? 50));
  const filtros = opts.filtros || {};

  if (!db?.AgregadoEnsayo) {
    throw new Error('reEvaluarTodosLosEnsayos: db.AgregadoEnsayo no disponible.');
  }

  const where = {};
  // El FK del agregado en este modelo se llama `legacyAgregadoId` (no
  // `idAgregado`) por razones legacy. Aceptamos `filtros.idAgregado` como
  // alias amigable y lo mapeamos.
  if (filtros.idAgregado != null) where.legacyAgregadoId = filtros.idAgregado;
  if (filtros.fechaDesde) where.fechaEnsayo = { [require('sequelize').Op.gte]: filtros.fechaDesde };

  // Filtro por código de tipo: incluir join.
  const include = [{
    model: db.AgregadoEnsayoTipo,
    as: 'tipo',
    required: false,
    ...(filtros.codigoTipo ? { where: { codigo: filtros.codigoTipo }, required: true } : {}),
  }];

  const stats = { total: 0, evaluados: 0, cambiaron: 0, errores: 0, dryRun };
  const sample = [];

  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ensayos = await db.AgregadoEnsayo.findAll({
      where,
      include,
      limit: batchSize,
      offset,
      // PK del modelo es `idAgregadoEnsayo` (no `id`).
      order: [['idAgregadoEnsayo', 'ASC']],
    });
    if (ensayos.length === 0) break;

    for (const ensayo of ensayos) {
      stats.total++;
      try {
        const out = _reEvaluarUno(ensayo);
        stats.evaluados++;
        if (out.huboCambio) {
          stats.cambiaron++;
          if (sample.length < sampleMax) {
            sample.push({
              idEnsayo: ensayo.idAgregadoEnsayo ?? ensayo.id ?? null,
              codigoTipo: ensayo.tipo?.codigo || null,
              idAgregado: ensayo.legacyAgregadoId ?? ensayo.idAgregado ?? null,
              cambios: out.cambios,
            });
          }
          if (!dryRun) {
            await ensayo.update({
              resultado: out.resultado,
              cumple: out.cumpleNuevo,
            });
          }
        }
      } catch (err) {
        stats.errores++;
      }
    }
    offset += batchSize;
  }

  return {
    stats,
    sampleCambios: sample,
    completadoEnMs: Date.now() - start,
  };
}

module.exports = {
  reEvaluarTodosLosEnsayos,
  // Exportado para test unitario:
  _reEvaluarUno,
  _parseResultado,
};
