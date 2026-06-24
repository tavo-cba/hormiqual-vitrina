'use strict';

/**
 * aptitudCtxHelpers.js
 *
 * Helpers puros para resolver flags de contexto de aptitud que históricamente
 * se inferían de manera inconsistente entre engines (X2 — auditoría
 * `funcional-pdfs-reales.md` 2026-05-08).
 *
 * Caso concreto detectado: la misma dosificación con `tipologia = pavimento_rigido`
 * recibía `expuestoDesgaste = true` en `aptitudMaterialesService` (que aplicaba
 * el límite IRAM 1512 §5.2.2 estricto de 5,0%) y `expuestoDesgaste = false` en
 * `estadoGlobalConsolidator` (que generaba el mensaje "dentro del límite de 7,0%
 * para destinos sin desgaste superficial. No utilizar en pavimentos sin
 * sustitución."). El mismo PDF mostraba dos veredictos contradictorios para
 * el mismo material en la misma página.
 *
 * Lógica canónica:
 *   1. Si el caller declara explícitamente `expuestoDesgaste = true`, prevalece.
 *   2. Si el caller declara `expuestoDesgaste = false` pero la tipología
 *      implica desgaste superficial (pavimento, pavimento rígido,
 *      arquitectónico de uso intensivo, etc.), se promueve a `true` y se
 *      registra el motivo.
 *   3. Si no hay tipología que implique desgaste y el flag es `false`,
 *      retorna `false`.
 *
 * Esta función NO toca BD ni I/O. El caller es responsable de proveer la
 * tipología (puede venir como código `'pavimento_rigido'` o como objeto
 * `{ codigo: 'pavimento_rigido' }`).
 */

/**
 * Conjunto de tipologías cuya selección por sí sola implica desgaste
 * superficial relevante a IRAM 1512 §5.2.2 (límite 5,0% de suma nocivas).
 *
 * No incluimos `'estructural'`, `'rcc'`, `'hac'`, `'arquitectonico'` (que no
 * siempre implica desgaste) — esos siguen rigiéndose por el flag explícito.
 */
const TIPOLOGIAS_CON_DESGASTE = Object.freeze(new Set([
  'pavimento',
  'pavimento_rigido',
  'pavimento_rígido',
  'piso_industrial',
]));

/**
 * Normaliza un input ambiguo a un código de tipología en lowercase
 * snake_case sin acentos, o `null`.
 *
 * Acepta:
 *   - string: `'pavimento_rigido'`, `'Pavimento rígido'`, etc.
 *   - objeto: `{ codigo, nombre }` — prefiere `codigo`.
 *   - `null`/`undefined`.
 */
function _normalizarTipologia(tip) {
  if (tip == null) return null;
  let raw;
  if (typeof tip === 'string') raw = tip;
  else if (typeof tip === 'object') raw = tip.codigo || tip.nombre || null;
  else return null;
  if (!raw) return null;
  return String(raw)
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove diacritics
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/**
 * `true` si la tipología implica desgaste superficial por sí sola.
 *
 * @param {string|{codigo?: string, nombre?: string}|null|undefined} tipologia
 * @returns {boolean}
 */
function tipologiaImplicaDesgaste(tipologia) {
  const norm = _normalizarTipologia(tipologia);
  if (!norm) return false;
  return TIPOLOGIAS_CON_DESGASTE.has(norm);
}

/**
 * Resolve canonical `expuestoDesgaste` flag consistent across consumers.
 *
 * @param {object} ctx
 * @param {boolean} [ctx.expuestoDesgaste] - flag explícito del caller (form/body).
 * @param {string|{codigo?: string}} [ctx.tipologiaCodigo] - código de tipología.
 * @param {string|{codigo?: string}} [ctx.tipologia] - alternativo: tipología completa.
 * @returns {boolean}
 */
function resolveExpuestoDesgaste(ctx = {}) {
  if (ctx == null || typeof ctx !== 'object') return false;
  if (ctx.expuestoDesgaste === true) return true;
  // Flag explícito false (o no seteado) → mirar tipología.
  const tip = ctx.tipologiaCodigo ?? ctx.tipologia ?? null;
  if (tipologiaImplicaDesgaste(tip)) return true;
  return false;
}

module.exports = {
  resolveExpuestoDesgaste,
  tipologiaImplicaDesgaste,
  TIPOLOGIAS_CON_DESGASTE,
};
