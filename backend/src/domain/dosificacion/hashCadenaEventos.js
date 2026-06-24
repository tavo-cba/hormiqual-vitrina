'use strict';

/**
 * Hash chain de eventos de auditoría (Fase 4.4).
 *
 * Encadena los eventos de `DisenoHistorial` mediante SHA-256 acumulativo:
 *
 *   hashCadena[i] = sha256(hashCadenaPrevio + JSON.stringify(payloadCanonico))
 *
 * Engine puro: NO toca DB, NO importa Sequelize. Recibe inputs explícitos.
 *
 * Cobertura:
 *   - Edición de un evento existente → su hashCadena recalculado difiere.
 *   - Borrado de un evento del medio → el siguiente evento tiene un
 *     hashCadenaPrevio que ya no existe; el recalculo no coincide.
 *   - Reordenamiento → idem.
 *
 * NO cubre:
 *   - Inserción de eventos al final por un atacante que conoce el algoritmo.
 *     Eso requeriría firma con clave secreta o time-stamping notarial.
 *
 * El payload canónico se construye normalizando el evento a un objeto con
 * keys ordenadas alfabéticamente (vía JSON.stringify ordenado) para que
 * la cadena sea determinista entre nodos y no dependa del orden de
 * inserción de keys en el objeto JS.
 */

const crypto = require('crypto');

/**
 * Genera el payload canónico (string) para un evento. Solo incluye campos
 * estables del modelo `DisenoHistorial`. Excluye `id` y `createdAt`
 * porque el hash debe poder calcularse antes de persistir el evento.
 *
 * El orden de las claves se ordena alfabéticamente vía sortKeys + JSON.
 */
function payloadCanonico(evento) {
  const e = evento || {};
  const subset = {
    entidadTipo:      e.entidadTipo || null,
    entidadId:        e.entidadId != null ? Number(e.entidadId) : null,
    tipoEvento:       e.tipoEvento || null,
    estadoAnterior:   e.estadoAnterior || null,
    estadoNuevo:      e.estadoNuevo || null,
    usuario:          e.usuario || null,
    motivo:           e.motivo || null,
    observaciones:    e.observaciones || null,
    hashAlMomento:    e.hashAlMomento || null,
    metadata:         e.metadata != null ? e.metadata : null,
  };
  return JSON.stringify(sortKeys(subset));
}

function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Calcula el hashCadena de un evento dado el hashCadena previo.
 *
 * @param {Object} evento - el evento a hashear (campos del modelo).
 * @param {string|null} hashCadenaPrevio - hashCadena del evento anterior, o null si es el primero.
 * @returns {string} SHA-256 hex.
 */
function calcularHashCadena(evento, hashCadenaPrevio) {
  const previoNorm = hashCadenaPrevio || '';
  const payload = payloadCanonico(evento);
  return crypto
    .createHash('sha256')
    .update(previoNorm + '|' + payload, 'utf8')
    .digest('hex');
}

/**
 * Verifica la integridad de una secuencia de eventos. Recorre la lista en
 * orden cronológico, recalcula el `hashCadena` esperado para cada uno y
 * lo compara con el persistido.
 *
 * Tolerancia para datos legacy: eventos sin `hashCadena` persistido se
 * consideran "no encadenados" (ok=null) y no detienen la verificación.
 * El primer evento con hashCadena no nulo se vuelve el ancla y a partir
 * de ahí se verifica la cadena.
 *
 * @param {Array<Object>} eventos - eventos planos ordenados por createdAt ASC.
 * @returns {{
 *   ok: boolean,
 *   total: number,
 *   verificados: number,
 *   sinCadena: number,
 *   primerEventoRoto: number | null,  // id del primer evento donde rompe
 *   detalles: Array<{ id, ok, hashEsperado, hashAlmacenado }>
 * }}
 */
function verificarCadena(eventos) {
  const lista = Array.isArray(eventos) ? eventos : [];
  const detalles = [];
  let hashPrevio = null;
  let verificados = 0;
  let sinCadena = 0;
  let primerEventoRoto = null;

  for (const e of lista) {
    if (!e || e.hashCadena == null) {
      // Evento legacy sin cadena. Lo ignoramos para encadenar pero
      // tomamos el último hashPrevio conocido como ancla.
      sinCadena += 1;
      detalles.push({ id: e?.id || null, ok: null, hashEsperado: null, hashAlmacenado: null, motivo: 'sin_cadena' });
      continue;
    }
    const esperado = calcularHashCadena(e, hashPrevio);
    const ok = esperado === e.hashCadena;
    detalles.push({
      id: e.id, ok, hashEsperado: esperado, hashAlmacenado: e.hashCadena,
    });
    if (!ok && primerEventoRoto == null) primerEventoRoto = e.id;
    verificados += 1;
    // Avanza la cadena con el hash REAL (no el esperado) — así
    // un evento corrupto no propaga su error a los siguientes.
    hashPrevio = e.hashCadena;
  }

  const ok = verificados > 0 && primerEventoRoto == null;
  return {
    ok,
    total: lista.length,
    verificados,
    sinCadena,
    primerEventoRoto,
    detalles,
  };
}

module.exports = {
  calcularHashCadena,
  verificarCadena,
  payloadCanonico,
};
