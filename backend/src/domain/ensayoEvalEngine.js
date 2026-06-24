'use strict';

/**
 * ensayoEvalEngine.js
 *
 * Motor de evaluación automática para los ensayos del catálogo.
 * Recibe: código del tipo de ensayo + resultado JSON + tipo de agregado
 * Retorna: { cumple, estado, mensaje, detalle[], observaciones[] }
 *
 * Estados: CUMPLE | NO_CUMPLE | NO_EVAL | SIN_PARAMETROS
 *
 * Operador: el campo `operador` del resultado indica cómo interpretar el valor:
 *   null / undefined  → valor exacto
 *   'menor_que'       → "< valor" (por debajo del límite de detección)
 *   'mayor_que'       → "> valor" (por encima del rango de medición)
 *   (legacy: esMenorQue=true se interpreta como 'menor_que')
 */

const { getCanonicalCodigo } = require('./ensayoResultRegistry');

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

/** Prefijo de display para el operador */
function operadorPrefix(op) {
  if (op === 'menor_que') return '< ';
  if (op === 'mayor_que') return '> ';
  return '';
}

/** Lee el operador del resultado (con backward compat esMenorQue) */
function getOperador(r) {
  if (r.operador === 'menor_que' || r.operador === 'mayor_que') return r.operador;
  if (r.operador === 'exacto' || r.operador === '') return null;
  if (r.esMenorQue) return 'menor_que';
  return null; // exacto
}

function pctOfLimit(valor, limite) {
  if (!limite || limite === 0) return null;
  return Math.round((valor / limite) * 100);
}

// PR9-fix: helpers aceptan `unidad` opcional (default '') para que los mensajes
// declaren la unidad del valor y el límite (ej. '%', 'mm', 'kg/m³'). Antes se
// generaban mensajes como "Terrones: 2.9 supera límite 2" sin unidad, lo que
// confunde al lector cliente-facing. Si el caller no pasa `unidad`, el comportamiento
// es idéntico al anterior (back-compat).
// También se reemplaza ≤/≥ por <=/>= ASCII para evitar kerning roto en jsPDF.
function evalMax(valor, limite, label, unidad = '') {
  if (valor == null || limite == null) return null;
  const u = unidad || '';
  const pct = pctOfLimit(valor, limite);
  if (valor > limite) return { cumple: false, msg: `${label}: ${valor}${u} supera límite ${limite}${u}`, pct };
  if (pct >= 95) return { cumple: true, alerta: true, msg: `${label}: ${valor}${u} — CUMPLE (${pct}% del límite). Valor cercano al límite.`, pct };
  return { cumple: true, alerta: false, msg: `${label}: ${valor}${u} — CUMPLE (${pct}% del límite)`, pct };
}

function evalMin(valor, limite, label, unidad = '') {
  if (valor == null || limite == null) return null;
  const u = unidad || '';
  if (valor < limite) return { cumple: false, msg: `${label}: ${valor}${u} por debajo del mínimo ${limite}${u}` };
  return { cumple: true, alerta: false, msg: `${label}: ${valor}${u} — CUMPLE (>= ${limite}${u})` };
}

/**
 * Evalúa un valor con operador contra un límite máximo.
 * operador: null → evaluación normal
 * 'menor_que': < valor → si valor <= limite → CUMPLE (el real es aún menor)
 *                         si valor > limite → NO_CONCLUYENTE (precisión insuficiente)
 * 'mayor_que': > valor → si valor > limite → NO_CUMPLE (el real es aún mayor, seguro excede)
 *                         si valor <= limite → NO_CONCLUYENTE (el real podría superar el límite)
 */
function evalMaxConOperador(valor, limite, label, operador, unidad = '') {
  if (valor == null || limite == null) return null;
  const u = unidad || '';
  // Backward compat: boolean true → 'menor_que'
  if (operador === true) operador = 'menor_que';
  if (operador === 'menor_que') {
    if (valor <= limite) {
      return { cumple: true, alerta: false, estado: 'CUMPLE', msg: `${label}: < ${valor}${u} <= ${limite}${u} — CUMPLE (por debajo del límite de detección).` };
    }
    return { cumple: null, alerta: true, estado: 'NO_CONCLUYENTE', msg: `${label}: < ${valor}${u} vs límite ${limite}${u} — No concluyente. Se requiere ensayo con menor límite de detección.` };
  }
  if (operador === 'mayor_que') {
    if (valor > limite) {
      return { cumple: false, alerta: false, estado: 'NO_CUMPLE', msg: `${label}: > ${valor}${u} supera límite ${limite}${u} — NO CUMPLE.` };
    }
    return { cumple: null, alerta: true, estado: 'NO_CONCLUYENTE', msg: `${label}: > ${valor}${u} vs límite ${limite}${u} — No concluyente. El valor real podría superar el límite.` };
  }
  return evalMax(valor, limite, label, unidad);
}

/**
 * Evalúa un valor con operador contra un límite mínimo.
 * operador: null → evaluación normal
 * 'mayor_que': > valor → si valor >= limite → CUMPLE (el real es aún mayor)
 *                          si valor < limite → NO_CONCLUYENTE (podría cumplir)
 * 'menor_que': < valor → si valor < limite → NO_CUMPLE (el real es aún menor, seguro no cumple)
 *                          si valor >= limite → NO_CONCLUYENTE (el real podría estar por debajo)
 */
function evalMinConOperador(valor, limite, label, operador, unidad = '') {
  if (valor == null || limite == null) return null;
  const u = unidad || '';
  if (operador === true) operador = 'menor_que';
  if (operador === 'mayor_que') {
    if (valor >= limite) {
      return { cumple: true, alerta: false, estado: 'CUMPLE', msg: `${label}: > ${valor}${u} >= ${limite}${u} — CUMPLE (el valor real es aún mayor).` };
    }
    return { cumple: null, alerta: true, estado: 'NO_CONCLUYENTE', msg: `${label}: > ${valor}${u} vs mínimo ${limite}${u} — No concluyente. El valor real podría cumplir.` };
  }
  if (operador === 'menor_que') {
    if (valor < limite) {
      return { cumple: false, alerta: false, estado: 'NO_CUMPLE', msg: `${label}: < ${valor}${u} por debajo del mínimo ${limite}${u} — NO CUMPLE.` };
    }
    return { cumple: null, alerta: true, estado: 'NO_CONCLUYENTE', msg: `${label}: < ${valor}${u} vs mínimo ${limite}${u} — No concluyente. El valor real podría estar por debajo.` };
  }
  return evalMin(valor, limite, label, unidad);
}

/** Mapea el estado de un resultado con operador al estado del ensayo */
function estadoDesdeOperador(e) {
  if (!e) return null;
  if (e.estado === 'NO_CONCLUYENTE') return 'NO_EVAL';
  if (e.cumple === true) return 'CUMPLE';
  if (e.cumple === false) return 'NO_CUMPLE';
  return 'NO_EVAL';
}

/* ═══════════════════════════════════════════════════════════
   Evaluación por tipo de ensayo
   ═══════════════════════════════════════════════════════════ */

const evaluadores = {};

// 1. Densidad y absorción — AF (IRAM 1520)
// Sin límites prescriptivos — siempre informativo. La absorción > 3% se anota
// como observación pero no afecta el veredicto.
evaluadores['IRAM1520_DENSIDAD_ABSORCION_FINO'] = (r) => {
  const abs = r.absorcionPct;
  const obs = [];
  if (abs != null && abs > 3) obs.push('Absorción elevada (> 3%), puede afectar demanda de agua.');
  return {
    estado: 'CUMPLE',
    mensaje: `d3: ${r.densidadRelativaAparenteSSS ?? '—'} · Absorción: ${abs ?? '—'}%. Sin límites prescriptivos.`,
    observaciones: obs,
    informativo: true,
    measured: typeof abs === 'number' && Number.isFinite(abs) ? abs : null,
    norm: 'IRAM 1520',
  };
};

// 2. Densidad y absorción — AG (IRAM 1533)
// IRAM 1531 Tabla 4: Absorción <= 10,0%
evaluadores['IRAM1533_DENSIDAD_GRUESO'] = (r) => {
  const abs = r.absorcionPct;
  const op = getOperador(r);
  const detalle = [];
  const obs = [];
  let estado = 'CUMPLE';
  const meta = {
    measured: typeof abs === 'number' && Number.isFinite(abs) ? abs : null,
    limit: { value: 10.0, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1533 / IRAM 1531 Tabla 4',
  };
  if (abs != null) {
    if (op) {
      const eAbs = evalMaxConOperador(abs, 10.0, 'Absorcion AG (IRAM 1531 Tabla 4)', op);
      detalle.push(eAbs);
      estado = estadoDesdeOperador(eAbs);
    } else {
      const eAbs = evalMax(abs, 10.0, 'Absorcion AG (IRAM 1531 Tabla 4)');
      detalle.push(eAbs);
      if (!eAbs.cumple) estado = 'NO_CUMPLE';
    }
    if (abs > 2) obs.push('Absorción elevada para agregado grueso (> 2%).');
  }
  const pfx = operadorPrefix(op);
  const out = {
    estado,
    mensaje: `d3: ${r.densidadRelativaAparenteSSS ?? '—'} · Absorcion: ${pfx}${abs ?? '—'}%. Límite absorción ≤ 10% (IRAM 1531).`,
    detalle,
    observaciones: obs,
    informativo: estado === 'CUMPLE' && !op,
    ...meta,
  };
  if (estado === 'NO_EVAL') {
    out.complianceHint = { resultado: 'inconclusive', reason: out.mensaje, detection_limit: meta.measured };
  }
  return out;
};

// 3. Pasante tamiz #200 (IRAM 1540) — CASO LAS QUEBRADAS
//
// AF: zona dual (3% strict / 5% standard). Caso intermedio → conditionalPass
// con exclude_destination: ['surface_wear']. Es el caso paradigmático del
// Concepto 1 del Prompt 2 generalizado a conditions[] con kind discriminante.
//
// AG: caso intermedio (1.0% grava / 1.5% piedra partida) hoy se reporta
// como CUMPLE + alerta. Su migración a conditional_pass con exclude_subtype
// queda fuera de alcance del Prompt 2 — requiere modelar el subtipo del
// material en el contexto. Por ahora se mapea a passWithObservations.
evaluadores['IRAM1674_MATERIAL_FINO_200'] = (r, ctx) => {
  const val = r.pasa200Pct ?? r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const esAF = ctx.tipoAgregado === 'FINO' || ctx.tipoAgregado === 'Fino';
  const detalle = [];
  const pfx = operadorPrefix(op);

  const baseMeta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    norm: 'IRAM 1540 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
  };

  if (esAF) {
    const limMeta = { ...baseMeta, limit: { strict: 3.0, standard: 5.0 } };

    if (op) {
      const e1 = evalMaxConOperador(val, 3.0, 'Con desgaste superficial', op, '%');
      const e2 = evalMaxConOperador(val, 5.0, 'Sin desgaste superficial', op, '%');
      detalle.push(e1, e2);
      const est2 = estadoDesdeOperador(e2);
      const est1 = estadoDesdeOperador(e1);
      if (est2 === 'NO_CUMPLE') {
        return { estado: 'NO_CUMPLE', mensaje: `Pasante #200: ${pfx}${val}% supera ambos límites (3,0% y 5,0%).`, detalle, ...limMeta };
      }
      if (est2 === 'NO_EVAL') {
        return {
          estado: 'NO_CONCLUYENTE',
          mensaje: `Pasante #200: ${pfx}${val}% — No concluyente para ambos límites.`,
          detalle, alerta: true, ...limMeta,
          complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 3,0% ni 5,0%.`, detection_limit: baseMeta.measured },
        };
      }
      if (est1 === 'NO_CUMPLE') {
        return {
          estado: 'CUMPLE',
          mensaje: `Cumple para hormigones sin desgaste (≤ 5,0%). NO cumple para desgaste superficial (> 3,0%).`,
          detalle, alerta: true, ...limMeta,
          complianceHint: {
            resultado: 'conditional_pass',
            conditions: [{
              kind: 'exclude_destination',
              key: 'exclude_destination',
              value: ['surface_wear'],
              description: 'Apta solo para hormigón sin desgaste superficial. No usar en pisos industriales, pavimentos ni otros destinos con abrasión.',
              source: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',
            }],
          },
        };
      }
      if (est1 === 'NO_EVAL') {
        return {
          estado: 'CUMPLE',
          mensaje: `Cumple sin desgaste (≤ 5,0%). No concluyente para desgaste superficial (≤ 3,0%).`,
          detalle, alerta: true, ...limMeta,
          complianceHint: {
            resultado: 'pass_with_observations',
            observation: `Cumple sin desgaste (≤5%). El resultado "${pfx}${val}%" no permite verificar el límite estricto de 3% para desgaste superficial.`,
          },
        };
      }
      return { estado: 'CUMPLE', mensaje: `Pasante #200: ${pfx}${val}% — cumple para cualquier destino.`, detalle, ...limMeta };
    }
    const e1 = evalMax(val, 3.0, 'Con desgaste superficial', '%');
    const e2 = evalMax(val, 5.0, 'Sin desgaste superficial', '%');
    detalle.push(e1, e2);
    if (!e2.cumple) {
      return { estado: 'NO_CUMPLE', mensaje: `Pasante #200: ${val}% supera ambos límites (3,0% y 5,0%).`, detalle, ...limMeta };
    }
    if (!e1.cumple) {
      // Caso Las Quebradas: 5,34% → CUMPLE para sin desgaste, NO para con desgaste
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para hormigones sin desgaste (≤ 5,0%). NO cumple para desgaste superficial (> 3,0%).`,
        detalle, alerta: true, ...limMeta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: [{
            kind: 'exclude_destination',
            key: 'exclude_destination',
            value: ['surface_wear'],
            description: 'Apta solo para hormigón sin desgaste superficial. No usar en pisos industriales, pavimentos ni otros destinos con abrasión.',
            source: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',
          }],
        },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Pasante #200: ${val}% — cumple para cualquier destino.`, detalle, ...limMeta };
  } else {
    // AG: límite por subtipo de roca (CIRSOC 200 Tabla 3.6 — IRAM 1540).
    // - PIEDRA_PARTIDA → 1,5% (más tolerante)
    // - Grava / canto rodado / triturado natural / artificial → 1,0%
    //
    // PR8.15 — Bonus IP < 2 (IRAM 1540 Anexo / IRAM 1531):
    // Si el ensayo reporta `indicePlasticidadIP` y es estrictamente menor a 2,
    // los finos pasantes son no-plásticos (silt) y no afectan adherencia.
    // Se eleva el límite de grava al de piedra partida (1.5% en vez de 1.0%).
    //
    // C6 (auditoría 01-calidad sesión 2026-05-07): el evaluador ahora resuelve
    // el subtipo desde `ctx.subtipoMaterial`. Cuando el subtipo no es conocido
    // y el bonus IP no aplica, los valores en zona intermedia (1,0% < val ≤ 1,5%)
    // emiten `inconclusive` en vez de `pass_with_observations` — porque sin
    // subtipo no se puede determinar veredicto, hace falta dato.
    const subtipoMaterial = String(ctx.subtipoMaterial || ctx.subtipoAgregado || '').toUpperCase();
    const PIEDRA_PARTIDA = 'PIEDRA_PARTIDA';
    const SUBTIPOS_GRAVA = new Set(['CANTO_RODADO', 'GRAVA', 'TRITURADO_NATURAL', 'TRITURADO_ARTIFICIAL']);
    const subtipoConocido = subtipoMaterial === PIEDRA_PARTIDA || SUBTIPOS_GRAVA.has(subtipoMaterial);
    const esPiedraPartida = subtipoMaterial === PIEDRA_PARTIDA;

    const ip = (typeof r.indicePlasticidadIP === 'number') ? r.indicePlasticidadIP : null;
    const ipBonus = (ip != null && ip < 2);

    // Límite efectivo: piedra partida o bonus IP→1,5; grava sin bonus→1,0; sin subtipo→1,0 conservador.
    const limEfectivo = (esPiedraPartida || ipBonus) ? 1.5 : 1.0;
    const limMeta = { ...baseMeta, limit: { strict: 1.0, standard: 1.5 } };

    let label;
    if (esPiedraPartida) label = 'Piedra partida (≤ 1,5%)';
    else if (ipBonus) label = `Grava / canto rodado (bonus IP=${ip} < 2 → 1,5%)`;
    else if (subtipoConocido) label = `Grava / canto rodado (≤ 1,0%)`;
    else label = `Subtipo desconocido — límite conservador 1,0%`;

    // Si subtipo es conocido (o ipBonus aplica), verifica directo contra `limEfectivo`.
    if (subtipoConocido || ipBonus) {
      if (op) {
        const e = evalMaxConOperador(val, limEfectivo, label, op, '%');
        const est = estadoDesdeOperador(e);
        if (est === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', mensaje: `Pasante #200 AG: ${pfx}${val}% supera el límite ${limEfectivo}% (${label}).`, detalle: [e], ...limMeta };
        if (est === 'NO_EVAL') return { estado: 'NO_CONCLUYENTE', mensaje: `Pasante #200 AG: ${pfx}${val}% — No concluyente.`, detalle: [e], alerta: true, ...limMeta, complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra ${limEfectivo}%.`, detection_limit: baseMeta.measured } };
        return { estado: 'CUMPLE', mensaje: `Pasante #200 AG: ${pfx}${val}% — cumple ${label}.`, detalle: [e], ...limMeta };
      }
      const e = evalMax(val, limEfectivo, label, '%');
      if (!e.cumple) return { estado: 'NO_CUMPLE', mensaje: `Pasante #200 AG: ${val}% supera el límite ${limEfectivo}% (${label}).`, detalle: [e], ...limMeta };
      return { estado: 'CUMPLE', mensaje: `Pasante #200 AG: ${val}% — cumple ${label}.`, detalle: [e], ...limMeta };
    }

    // Sin subtipo y sin bonus IP: evaluar contra ambos límites; zona intermedia → inconclusive.
    if (op) {
      const e1 = evalMaxConOperador(val, 1.0, 'Grava / canto rodado', op, '%');
      const e2 = evalMaxConOperador(val, 1.5, 'Piedra partida', op, '%');
      const est2 = estadoDesdeOperador(e2);
      const est1 = estadoDesdeOperador(e1);
      if (est2 === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', mensaje: `Pasante #200 AG: ${pfx}${val}% supera ambos límites (1,0% y 1,5%).`, detalle: [e1, e2], ...limMeta };
      if (est2 === 'NO_EVAL') return { estado: 'NO_CONCLUYENTE', mensaje: `Pasante #200 AG: ${pfx}${val}% — No concluyente.`, detalle: [e1, e2], alerta: true, ...limMeta, complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 1,0% ni 1,5%.`, detection_limit: baseMeta.measured } };
      if (est1 === 'NO_CUMPLE') {
        // Zona intermedia (1,0% < val ≤ 1,5%) sin subtipo → inconclusive (no pass_with_observations).
        return {
          estado: 'NO_CONCLUYENTE',
          mensaje: `Pasante #200 AG: ${pfx}${val}% — Subtipo del agregado no provisto. Cumple ≤1,5% (piedra partida) pero excede 1,0% (grava). No se puede determinar veredicto sin subtipo.`,
          detalle: [e1, e2], alerta: true, ...limMeta,
          complianceHint: { resultado: 'inconclusive', reason: `Sin subtipo del agregado, ${pfx}${val}% queda en zona intermedia entre 1,0% (grava) y 1,5% (piedra partida).`, detection_limit: baseMeta.measured },
        };
      }
      if (est1 === 'NO_EVAL') return { estado: 'CUMPLE', mensaje: `Cumple para piedra partida (≤ 1,5%). No concluyente para grava (≤ 1,0%).`, detalle: [e1, e2], alerta: true, ...limMeta };
      return { estado: 'CUMPLE', mensaje: `Pasante #200 AG: ${pfx}${val}% — cumple para cualquier tipo de roca.`, detalle: [e1, e2], ...limMeta };
    }
    const e1 = evalMax(val, 1.0, 'Grava / canto rodado', '%');
    const e2 = evalMax(val, 1.5, 'Piedra partida', '%');
    if (!e2.cumple) return { estado: 'NO_CUMPLE', mensaje: `Pasante #200 AG: ${val}% supera ambos límites (1,0% y 1,5%).`, detalle: [e1, e2], ...limMeta };
    if (!e1.cumple) {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Pasante #200 AG: ${val}% — Subtipo del agregado no provisto. Cumple ≤1,5% (piedra partida) pero excede 1,0% (grava). No se puede determinar veredicto sin subtipo.`,
        detalle: [e1, e2], alerta: true, ...limMeta,
        complianceHint: { resultado: 'inconclusive', reason: `Sin subtipo del agregado, ${val}% queda en zona intermedia entre 1,0% (grava) y 1,5% (piedra partida).`, detection_limit: baseMeta.measured },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Pasante #200 AG: ${val}% — cumple para cualquier tipo de roca.`, detalle: [e1, e2], ...limMeta };
  }
};

// 4. Terrones de arcilla (IRAM 1647)
evaluadores['IRAM1647_TERRONES_ARCILLA'] = (r, ctx) => {
  const val = r.valor;
  if (val == null) return null;
  const esAF = ctx.tipoAgregado === 'FINO' || ctx.tipoAgregado === 'Fino';
  const limite = esAF ? 3.0 : 2.0;
  const label = `Terrones de arcilla (${esAF ? 'AF' : 'AG'})`;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: limite, comparator: '<=' },
    norm: 'IRAM 1647 / CIRSOC 200 §3.2.3.3 Tabla 3.4',
  };
  if (op) {
    const e = evalMaxConOperador(val, limite, label, op, '%');
    const out = { estado: estadoDesdeOperador(e), mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
    if (out.estado === 'NO_EVAL' && e.estado === 'NO_CONCLUYENTE') {
      out.estado = 'NO_CONCLUYENTE';
      out.complianceHint = { resultado: 'inconclusive', reason: e.msg, detection_limit: meta.measured };
    }
    return out;
  }
  const e = evalMax(val, limite, label, '%');
  return { estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE', mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
};

// 5. Granulometría — evaluada por granulometriaEvalService, aquí solo pass-through
// 5. Granulometría (IRAM 1505 / IRAM 1627)
//
// IMPORTANTE — Concepto 1 (separación de niveles), C10:
// Este evaluador opera a NIVEL 1 (agregado individual). El comportamiento
// normativo de banda A-B/A-C / MF es informativo a nivel de agregado;
// la verificación crítica es a NIVEL 2 (mezcla — IRAM 1627 sobre la curva
// combinada, ahora en `domain/compliance/granulometriaMezcla.js`).
//
// ─── Asimetría legacy/canónica (Option B — C10, mismo patrón D15) ───
// Cuando una banda falla:
//   - estado: 'NO_CUMPLE' legacy (preservado para back-compat con counters,
//     badges, ENUM `cumple` y la lógica granulometry-específica de
//     `agregadoEnsayoService.js:1066-1087` que asigna cumpleValue).
//   - complianceHint: { resultado: 'pass_with_observations', ... } canónico:
//     reflejando que un agregado individual fuera de banda NO es bloqueante
//     — la verificación crítica es Nivel 2.
//
// **Cambio observable importante de C10:** los call sites que migren a leer
// `compliance.status` (vía `_evaluacion.compliance` en createEnsayo) verán
// `passWithObservations` en vez de `fail` para banda fails. Como el dispatcher
// de alertas trata `passWithObservations` como NO disparable, los ensayos
// de granulometría con tamices fuera de banda dejarán de generar alertas
// `ENSAYO_NO_CUMPLE_BLOQUEANTE / CRITICO` — desaparece la "alerta de Nivel 1
// que hoy se ve como falla". Se queda como observación; la decisión real
// la toma la verificación de mezcla (Nivel 2).
//
// IRAM1505_GRANULOMETRIA ya tenía `defaultBlocking: false` en blocking.js
// desde C3 (cierra Concepto 1 desde el lado verdict-tree).
evaluadores['IRAM1505_GRANULOMETRIA'] = (r, ctx) => {
  const evAuto = r.granulometria?.evaluacionAuto;
  const ev = r.granulometria?.evaluacion;
  const tipoAg = (ctx?.tipoAgregado || r.granulometria?.tipoAgregado || '').toUpperCase();
  const esFino = tipoAg === 'FINO';
  const norm = 'IRAM 1505 / IRAM 1627 / CIRSOC 200 §3.2.3.x';

  // Helper: arma el output canónico para el caso "fuera de banda".
  // Legacy NO_CUMPLE preservado, canónico = passWithObservations.
  // El observation es informativo + apunta a Nivel 2.
  const _outFuera = (mensaje, detalle, evaluacion, extra = {}) => ({
    estado: 'NO_CUMPLE',
    mensaje,
    detalle,
    evaluacion,
    norm,
    ...extra,
    complianceHint: {
      resultado: 'pass_with_observations',
      observation: `${mensaje} A nivel agregado individual es informativo; la conformidad efectiva se verifica a nivel mezcla (IRAM 1627).`,
    },
  });

  if (evAuto?.resultadoGlobal) {
    const rg = evAuto.resultadoGlobal;
    const bandaOk = rg.bandaAB === 'cumple' || rg.bandaAB === 'cumple_con_tolerancia' || rg.bandaAC === 'cumple';
    const mfOk = esFino ? (rg.mf !== 'no_cumple') : true;
    const cumple = bandaOk && mfOk;
    const detalles = [];
    if (rg.bandaAB === 'cumple') detalles.push('Banda A-B: cumple');
    else if (rg.bandaAB === 'cumple_con_tolerancia') detalles.push('Banda A-B: cumple con tolerancia');
    else if (rg.bandaAC === 'cumple') detalles.push('Banda A-C: cumple');
    else detalles.push('Fuera de banda');
    if (esFino) {
      // PR8.1 — MF se evalúa contra MF de diseño (variación ±0.20). Mensaje
      // refleja la nueva semántica: warning, no fuera de rango fijo.
      if (rg.mfEstado === 'dentro_tolerancia') detalles.push('MF: dentro de tolerancia (±0.20 vs diseño)');
      else if (rg.mfEstado === 'desviado') detalles.push('MF: warning — desviado del MF de diseño (>0.20)');
      else if (rg.mfEstado === 'sin_diseno') detalles.push('MF: medido (sin MF de diseño para comparar)');
      // sin_dato: no se reporta MF en detalles
    }
    if (cumple) {
      return {
        estado: 'CUMPLE',
        mensaje: detalles.join('. ') + '.',
        detalle: detalles,
        evaluacion: evAuto,
        norm,
      };
    }
    return _outFuera(detalles.join('. ') + '.', detalles, evAuto);
  }

  const evAutoG = r.granulometria?.evaluacionAutoGrueso;
  if (evAutoG) {
    // Auditoría 01-calidad Fase C R2: import desde domain/ (no de services).
    const { resolverCumpleGrueso } = require('./granulometria/resolverCumpleGrueso');
    const resolved = resolverCumpleGrueso(r);
    if (resolved) {
      const bandaOk = resolved === 'CUMPLE';
      const discrepancia = r.granulometria?._discrepanciaBanda;
      const usaCurva = r.granulometria?.idCurvaObjetivo != null && r.granulometria?.evaluacion != null;
      let msg;
      if (usaCurva) {
        msg = bandaOk ? 'Cumple contra curva objetivo asignada.' : `${r.granulometria.evaluacion?.stats?.nFuera || 0} tamiz(es) fuera de banda (curva objetivo).`;
        if (discrepancia) msg += ` [Atención] ${discrepancia.mensaje}`;
      } else {
        msg = bandaOk ? 'Cumple banda granulométrica.' : `${evAutoG.nFuera || 0} tamiz(es) fuera de banda.`;
      }
      if (bandaOk) {
        return { estado: 'CUMPLE', mensaje: msg, detalle: [msg], evaluacion: evAutoG, alerta: !!discrepancia, norm };
      }
      return _outFuera(msg, [msg], evAutoG, { alerta: !!discrepancia });
    }
    const bandaOk = evAutoG.cumple === true;
    const msg = bandaOk ? 'Cumple banda granulométrica.' : `${evAutoG.nFuera || 0} tamiz(es) fuera de banda.`;
    if (bandaOk) {
      return { estado: 'CUMPLE', mensaje: msg, detalle: [msg], evaluacion: evAutoG, norm };
    }
    return _outFuera(msg, [msg], evAutoG);
  }

  if (ev) {
    const msg = ev.estado === 'INCOMPLETO' ? 'Datos insuficientes.' : `${ev.stats?.nFuera || 0} tamices fuera de banda.`;
    if (ev.cumple) {
      return { estado: 'CUMPLE', mensaje: msg, detalle: [msg], evaluacion: ev, norm };
    }
    return _outFuera(msg, [msg], ev);
  }

  return { estado: 'NO_EVAL', mensaje: 'Granulometría sin evaluación contra banda.', detalle: [], norm };
};

// 6. Sulfatos SO3 (IRAM 1647)
evaluadores['IRAM1647_SULFATOS_SO3'] = (r, ctx) => {
  const val = r.valor;
  if (val == null) return null;
  const esAF = ctx.tipoAgregado === 'FINO' || ctx.tipoAgregado === 'Fino';
  const limite = esAF ? 0.1 : 0.075;
  const label = `Sulfatos SO3 (${esAF ? 'AF' : 'AG'})`;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: limite, comparator: '<=' },
    norm: 'IRAM 1647 / IRAM 1512 §5.2.2',
  };
  if (op) {
    const e = evalMaxConOperador(val, limite, label, op, '%');
    const out = { estado: estadoDesdeOperador(e), mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
    if (out.estado === 'NO_EVAL' && e.estado === 'NO_CONCLUYENTE') {
      out.estado = 'NO_CONCLUYENTE';
      out.complianceHint = { resultado: 'inconclusive', reason: e.msg, detection_limit: meta.measured };
    }
    return out;
  }
  const e = evalMax(val, limite, label, '%');
  return { estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE', mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
};

// 7. Equivalente de arena (IRAM 1682)
evaluadores['IRAM1882_VALOR_EQUIVALENTE_ARENA'] = (r) => {
  const val = r.equivalenteArenaPct ?? r.ea_promedio;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: 75, comparator: '>=', unidad: '%' },
    // IRAM 1512:2006 NO contiene este ensayo (verificado §6.6 sesión
    // 2026-05-07); el método de equivalente arena es IRAM 1682. Valor 75 a
    // confirmar contra IRAM 1682 (no disponible en /docs/normativa/fuentes).
    norm: 'IRAM 1682 (método del equivalente de arena)',
  };
  if (op) {
    const e = evalMinConOperador(val, 75, 'Equivalente de arena', op, '%');
    const estado = estadoDesdeOperador(e);
    const out = { estado, mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
    if (estado === 'NO_EVAL') {
      out.complianceHint = { resultado: 'inconclusive', reason: e.msg, detection_limit: meta.measured };
    }
    return out;
  }
  const e = evalMin(val, 75, 'Equivalente de arena', '%');
  return { estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE', mensaje: e.msg, detalle: [e], ...meta };
};
evaluadores['IRAM1682_EQUIVALENTE_ARENA'] = evaluadores['IRAM1882_VALOR_EQUIVALENTE_ARENA'];

// 8. Polvo adherido (IRAM 1883:2015)
//
// R5 (auditoría 01-calidad sesión 2026-05-07): IRAM 1883:2015 es PURAMENTE
// metodológica — secciones 1-8 cubren objeto, instrumental, reactivos,
// preparación, procedimiento e informe; NO establece límites de aceptación.
// CIRSOC 200:2024 e IRAM 1531:2006 tampoco la citan con un límite directo.
//
// El valor 1,5% es operativo (uso típico vialidad / pavimentos / DNV) — no es
// un límite normativo. Por eso el evaluador es INFORMATIVO: muestra el valor
// y la referencia 1,5% como "atención" si la excede, pero NO emite veredicto
// APTO/NO APTO. Antes el estado plano "NO_CUMPLE" hacía caer el material como
// no apto sin respaldo normativo.
const POLVO_ADHERIDO_REF_PCT = 1.5;
evaluadores['IRAM1883_POLVO_ADHERIDO'] = (r) => {
  const val = r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    // referencia: true marca el límite como operativo (no normativo).
    limit: { value: POLVO_ADHERIDO_REF_PCT, comparator: '<=', unidad: '%', referencia: true },
    norm: 'IRAM 1883:2015 (método; sin límite normativo). Referencia operativa 1,5% (uso vialidad).',
    informativo: true,
  };

  // Si hay operador (< / >), usamos la rama generalizada y devolvemos NO_EVAL/PASS_WITH_OBS.
  if (op) {
    const e = evalMaxConOperador(val, POLVO_ADHERIDO_REF_PCT, 'Polvo adherido (referencia)', op, '%');
    const pfx = operadorPrefix(op);
    const obs = [
      `Polvo adherido: ${pfx}${val}% (referencia operativa 1,5%).`,
      'IRAM 1883:2015 es metodológica; CIRSOC 200 no fija límite.',
    ];
    const out = { estado: 'CUMPLE', informativo: true, mensaje: `Polvo adherido ${pfx}${val}%.`, detalle: [e], observaciones: obs, ...meta };
    return out;
  }

  // Sin operador: comparamos contra la referencia y emitimos:
  //  - <= 1,5% → "INFORMATIVO" (registro normal)
  //  - > 1,5%  → "INFORMATIVO" + observación de atención (no veredicto APTO/NO APTO)
  const excedeRef = Number(val) > POLVO_ADHERIDO_REF_PCT;
  const obs = excedeRef
    ? [
        `Polvo adherido ${val}% excede la referencia operativa 1,5% — atención.`,
        'IRAM 1883:2015 establece solo el método; no fija límite normativo. Verificar requisitos del proyecto / pliego DNV si aplica.',
      ]
    : [`Polvo adherido ${val}% dentro de la referencia operativa 1,5%.`,
       'IRAM 1883:2015 es metodológica (sin límite normativo CIRSOC 200/IRAM 1531).'];
  return {
    estado: 'CUMPLE',
    informativo: true,
    mensaje: `Polvo adherido ${val}% (sin requisito normativo).`,
    detalle: [{ msg: 'IRAM 1883 — registro informativo', valor: val, limite: null, cumple: null }],
    observaciones: obs,
    alerta: excedeRef,
    ...meta,
  };
};

// 9. Partículas blandas (IRAM 1644)
//
// R5 (auditoría 01-calidad sesión 2026-05-07): IRAM 1644 es solo método de
// determinación. CIRSOC 200:2024 NO la cita directamente. IRAM 1531:2006
// Tabla 1 último ítem "Otras sustancias perjudiciales" tiene cota AGREGADA
// ≤ 5,0% (suma de partículas blandas + otras sustancias relevantes
// determinadas por petrografía IRAM 1649) — NO una cota individual de
// partículas blandas. Aplicar 5% al valor individual sobreestimaría el
// margen disponible cuando hay otros ítems sumando.
//
// Por eso el evaluador es INFORMATIVO: registra el valor, marca la
// referencia 5,0% como cota agregada compartida y deja la decisión al
// resumen global de sustancias nocivas (que SÍ acumula). Antes emitía
// CUMPLE/NO_CUMPLE como si fuera límite individual.
const PART_BLANDAS_REF_PCT = 5.0;
evaluadores['IRAM1644_PARTICULAS_BLANDAS'] = (r) => {
  if (r.resultadoCualitativo === 'no_contiene') {
    return {
      estado: 'CUMPLE',
      mensaje: 'No contiene partículas blandas.',
      norm: 'IRAM 1644',
    };
  }
  const val = r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: PART_BLANDAS_REF_PCT, comparator: '<=', unidad: '%', referencia: true, agregada: true },
    norm: 'IRAM 1644 (método). CIRSOC 200:2024 sin requisito directo. IRAM 1531:2006 Tabla 1 cota AGREGADA ≤ 5,0% para "otras sustancias perjudiciales" (incluye blandas + otras vía IRAM 1649) — el evaluador individual es informativo.',
    informativo: true,
  };
  if (op) {
    const e = evalMaxConOperador(val, PART_BLANDAS_REF_PCT, 'Partículas blandas (referencia agregada)', op, '%');
    const pfx = operadorPrefix(op);
    const obs = [
      `Partículas blandas ${pfx}${val}% — referencia agregada IRAM 1531 Tabla 1 ≤ 5,0% (cota compartida con otras sustancias perjudiciales por IRAM 1649).`,
      'CIRSOC 200:2024 no fija límite individual. El veredicto de cumplimiento se evalúa contra la suma agregada, no contra este ítem solo.',
    ];
    const out = { estado: 'CUMPLE', informativo: true, mensaje: `Partículas blandas ${pfx}${val}%.`, detalle: [e], observaciones: obs, ...meta };
    return out;
  }
  // R5: rama sin operador — evaluador informativo, no emite veredicto
  // APTO/NO APTO. La cota agregada IRAM 1531 Tabla 1 (≤5,0%) se respeta a
  // través del agregador `sumaSustanciasNocivas` que sí acumula los ítems.
  const excedeRef = Number(val) > PART_BLANDAS_REF_PCT;
  const obs = excedeRef
    ? [
        `Partículas blandas ${val}% excede individualmente la cota agregada 5,0% — atención.`,
        'IRAM 1531:2006 Tabla 1 establece la cota como SUMA de "otras sustancias perjudiciales" (no individual). Si solo este ítem ya supera 5%, el agregado no cumple la suma agregada.',
      ]
    : [
        `Partículas blandas ${val}% — referencia agregada IRAM 1531 Tabla 1 ≤ 5,0% (cota compartida).`,
        'El veredicto de cumplimiento se evalúa contra la suma agregada de sustancias perjudiciales, no contra este ítem solo.',
      ];
  return {
    estado: 'CUMPLE',
    informativo: true,
    mensaje: `Partículas blandas ${val}% (sin requisito directo, cota agregada).`,
    detalle: [{ msg: 'IRAM 1644 — registro informativo', valor: val, limite: null, cumple: null }],
    observaciones: obs,
    alerta: excedeRef,
    ...meta,
  };
};

// 10. Lajosidad (IRAM 1687-1) — Tabla 3.7 CIRSOC 200:2024
// Dual-limit por CLASE DE HORMIGÓN: 25% para clase ≥ H-50 / 30% uso general.
// IMPORTANTE: H-50 = clase del HORMIGÓN (f'c ≥ 50 MPa), NO índice del agregado.
// Zona 25-30 → conditional_pass + exclude_destination 'high_strength'.
evaluadores['IRAM1687_1_LAJOSIDAD'] = (r) => {
  const val = r.lajosidadPct;
  if (val == null) return null;
  const op = getOperador(r);
  const pfx = operadorPrefix(op);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { strict: 25, standard: 30, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1687-1 / CIRSOC 200 §3.x Tabla 3.7',
  };
  const condExcludeHighStrength = [{
    kind: 'exclude_destination',
    key: 'exclude_high_strength',
    value: ['high_strength'],
    description: 'Apto para uso general (≤ 30%) pero excluye hormigones H ≥ 50 (≤ 25%).',
    source: 'CIRSOC 200 Tabla 3.7',
  }];
  if (op) {
    const e1 = evalMaxConOperador(val, 25, 'H >= 50 (Tabla 3.7)', op, '%');
    const e2 = evalMaxConOperador(val, 30, 'Uso general (Tabla 3.7)', op, '%');
    const est2 = estadoDesdeOperador(e2);
    const est1 = estadoDesdeOperador(e1);
    if (est2 === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', mensaje: `Lajosidad ${pfx}${val}% supera límite general (30%).`, detalle: [e1, e2], ...meta };
    if (est2 === 'NO_EVAL') {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Lajosidad ${pfx}${val}% — No concluyente.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 25% ni 30%.`, detection_limit: meta.measured },
      };
    }
    if (est1 === 'NO_CUMPLE') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para uso general (≤ 30%) pero NO para H ≥ 50 (≤ 25%). Verificar resistencia.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExcludeHighStrength,
          message: `Lajosidad ${pfx}${val}% en zona 25-30% — apto para uso general, no apto para H ≥ 50.`,
        },
      };
    }
    if (est1 === 'NO_EVAL') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para uso general (≤ 30%). No concluyente para H ≥ 50 (≤ 25%).`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'pass_with_observations',
          observation: `Cumple uso general (≤ 30%). El resultado "${pfx}${val}%" no permite verificar el límite estricto (≤ 25%) para H ≥ 50.`,
        },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Lajosidad ${pfx}${val}% — cumple para cualquier resistencia.`, detalle: [e1, e2], ...meta };
  }
  const e1 = evalMax(val, 25, 'H >= 50 (Tabla 3.7)', '%');
  const e2 = evalMax(val, 30, 'Uso general (Tabla 3.7)', '%');
  if (!e2.cumple) return { estado: 'NO_CUMPLE', mensaje: `Lajosidad ${val}% supera límite general (30%).`, detalle: [e1, e2], ...meta };
  if (!e1.cumple) {
    return {
      estado: 'CUMPLE',
      mensaje: `Cumple para uso general (≤ 30%) pero NO para H ≥ 50 (≤ 25%). Verificar resistencia.`,
      detalle: [e1, e2], alerta: true, ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExcludeHighStrength,
        message: `Lajosidad ${val}% en zona 25-30% — apto para uso general, no apto para H ≥ 50.`,
      },
    };
  }
  return { estado: 'CUMPLE', mensaje: `Lajosidad ${val}% — cumple para cualquier resistencia.`, detalle: [e1, e2], ...meta };
};

// 11. Elongación (IRAM 1687-2) — Tabla 3.7 CIRSOC 200:2024
// Dual-limit por clase de hormigón: 40% para clase ≥ H-50 / 45% uso general.
// (Misma semántica que lajosidad: H-50 = clase del HORMIGÓN, no agregado.)
// Dual-limit (40 H≥50 / 45 general). Mismo patrón que lajosidad.
evaluadores['IRAM1687_2_ELONGACION'] = (r) => {
  const val = r.elongacionPct;
  if (val == null) return null;
  const op = getOperador(r);
  const pfx = operadorPrefix(op);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { strict: 40, standard: 45, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1687-2 / CIRSOC 200 §3.x Tabla 3.7',
  };
  const condExcludeHighStrength = [{
    kind: 'exclude_destination',
    key: 'exclude_high_strength',
    value: ['high_strength'],
    description: 'Apto para uso general (≤ 45%) pero excluye hormigones H ≥ 50 (≤ 40%).',
    source: 'CIRSOC 200 Tabla 3.7',
  }];
  if (op) {
    const e1 = evalMaxConOperador(val, 40, 'H >= 50 (Tabla 3.7)', op);
    const e2 = evalMaxConOperador(val, 45, 'Uso general (Tabla 3.7)', op);
    const est2 = estadoDesdeOperador(e2);
    const est1 = estadoDesdeOperador(e1);
    if (est2 === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', mensaje: `Elongación ${pfx}${val}% supera límite general (45%).`, detalle: [e1, e2], ...meta };
    if (est2 === 'NO_EVAL') {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Elongación ${pfx}${val}% — No concluyente.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 40% ni 45%.`, detection_limit: meta.measured },
      };
    }
    if (est1 === 'NO_CUMPLE') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para uso general (≤ 45%) pero NO para H ≥ 50 (≤ 40%). Verificar resistencia.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExcludeHighStrength,
          message: `Elongación ${pfx}${val}% en zona 40-45% — apto para uso general, no apto para H ≥ 50.`,
        },
      };
    }
    if (est1 === 'NO_EVAL') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para uso general (≤ 45%). No concluyente para H ≥ 50 (≤ 40%).`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'pass_with_observations',
          observation: `Cumple uso general (≤ 45%). El resultado "${pfx}${val}%" no permite verificar el límite estricto (≤ 40%) para H ≥ 50.`,
        },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Elongación ${pfx}${val}% — cumple para cualquier resistencia.`, detalle: [e1, e2], ...meta };
  }
  const e1 = evalMax(val, 40, 'H >= 50 (Tabla 3.7)');
  const e2 = evalMax(val, 45, 'Uso general (Tabla 3.7)');
  if (!e2.cumple) return { estado: 'NO_CUMPLE', mensaje: `Elongación ${val}% supera límite general (45%).`, detalle: [e1, e2], ...meta };
  if (!e1.cumple) {
    return {
      estado: 'CUMPLE',
      mensaje: `Cumple para uso general (≤ 45%) pero NO para H ≥ 50 (≤ 40%). Verificar resistencia.`,
      detalle: [e1, e2], alerta: true, ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExcludeHighStrength,
        message: `Elongación ${val}% en zona 40-45% — apto para uso general, no apto para H ≥ 50.`,
      },
    };
  }
  return { estado: 'CUMPLE', mensaje: `Elongación ${val}% — cumple para cualquier resistencia.`, detalle: [e1, e2], ...meta };
};

// 12. Desgaste Los Ángeles (IRAM 1532)
// Dual-limit (30 pavimentos / 50 general). Zona 30-50 → conditional_pass + exclude_destination 'pavement_abrasion'.
evaluadores['IRAM1532_DESGASTE_LA'] = (r) => {
  const val = r.losAngelesPct ?? r.perdidaPct ?? r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const pfx = operadorPrefix(op);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { strict: 30, standard: 50, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1532',
  };
  const condExcludePavement = [{
    kind: 'exclude_destination',
    key: 'exclude_pavement_abrasion',
    value: ['pavement_abrasion'],
    description: 'Apto para hormigón convencional (≤ 50%) pero excluye pavimentos / superficies con abrasión (≤ 30%).',
    source: 'IRAM 1532',
  }];
  if (op) {
    const e1 = evalMaxConOperador(val, 30, 'Con abrasión (pavimentos)', op);
    const e2 = evalMaxConOperador(val, 50, 'General', op);
    const est2 = estadoDesdeOperador(e2);
    const est1 = estadoDesdeOperador(e1);
    if (est2 === 'NO_CUMPLE') return { estado: 'NO_CUMPLE', mensaje: `Desgaste ${pfx}${val}% supera límite general (50%).`, detalle: [e1, e2], ...meta };
    if (est2 === 'NO_EVAL') {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Desgaste ${pfx}${val}% — No concluyente.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 30% ni 50%.`, detection_limit: meta.measured },
      };
    }
    if (est1 === 'NO_CUMPLE') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para convencional (≤ 50%) pero NO para pavimentos (≤ 30%). Verificar destino.`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExcludePavement,
          message: `Desgaste ${pfx}${val}% en zona 30-50% — apto para hormigón convencional, no apto para pavimentos.`,
        },
      };
    }
    if (est1 === 'NO_EVAL') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple para convencional (≤ 50%). No concluyente para pavimentos (≤ 30%).`,
        detalle: [e1, e2], alerta: true, ...meta,
        complianceHint: {
          resultado: 'pass_with_observations',
          observation: `Cumple convencional (≤ 50%). El resultado "${pfx}${val}%" no permite verificar el límite estricto (≤ 30%) para pavimentos.`,
        },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Desgaste ${pfx}${val}% — cumple para cualquier destino.`, detalle: [e1, e2], ...meta };
  }
  const e1 = evalMax(val, 30, 'Con abrasión (pavimentos)');
  const e2 = evalMax(val, 50, 'General');
  if (!e2.cumple) return { estado: 'NO_CUMPLE', mensaje: `Desgaste ${val}% supera límite general (50%).`, detalle: [e1, e2], ...meta };
  if (!e1.cumple) {
    return {
      estado: 'CUMPLE',
      mensaje: `Cumple para convencional (≤ 50%) pero NO para pavimentos (≤ 30%). Verificar destino.`,
      detalle: [e1, e2], alerta: true, ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExcludePavement,
        message: `Desgaste ${val}% en zona 30-50% — apto para hormigón convencional, no apto para pavimentos.`,
      },
    };
  }
  return { estado: 'CUMPLE', mensaje: `Desgaste ${val}% — cumple para cualquier destino.`, detalle: [e1, e2], ...meta };
};
// Alias for different DB code
evaluadores['IRAM1532_LOS_ANGELES'] = evaluadores['IRAM1532_DESGASTE_LA'];

// 13. Sales solubles (IRAM 1647)
evaluadores['IRAM1647_SALES_SOLUBLES'] = (r) => {
  const val = r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: 1.5, comparator: '<=' },
    norm: 'IRAM 1647',
  };
  if (op) {
    const e = evalMaxConOperador(val, 1.5, 'Sales solubles', op);
    const out = { estado: estadoDesdeOperador(e), mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
    if (out.estado === 'NO_EVAL' && e.estado === 'NO_CONCLUYENTE') {
      out.estado = 'NO_CONCLUYENTE';
      out.complianceHint = { resultado: 'inconclusive', reason: e.msg, detection_limit: meta.measured };
    }
    return out;
  }
  const e = evalMax(val, 1.5, 'Sales solubles');
  return { estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE', mensaje: e.msg, detalle: [e], alerta: e.alerta, ...meta };
};

// 14. Cloruros solubles (IRAM 1882)
// NOTA: la lógica de pretensado (límite 0.003% incluso para AF) se agrega en C4.3.
// Por ahora el límite sigue siendo el legacy: AF=0.04% / AG=0.003%, ignorando tipoArmadura.
// 14. Cloruros solubles (IRAM 1882)
//
// IMPORTANTE — diferenciación armado / pretensado:
//
// El destino del hormigón (armado vs pretensado) afecta el control de
// cloruros en DOS niveles distintos. NO confundirlos:
//
//   1) Nivel agregado (este evaluador) — IRAM 1512 Tabla 1:
//      - AF armado:    ≤ 0,04% (sobre masa de agregado seco)
//      - AF pretensado: ≤ 0,01%  ← override por tipoArmadura
//      - AG armado/pretensado: ≤ 0,003% (IRAM 1531 — NO diferencia
//        por tipoArmadura, el límite del agregado es el mismo).
//
//   2) Nivel mezcla (control aguas abajo, art. 2.2.8 CIRSOC) — suma de
//      cloruros aportados por cemento + agua + aditivos + agregados,
//      con límite total mucho más estricto en pretensado. NO se controla
//      acá: este evaluador no conoce las dosis ni los aportes ajenos.
//
// Por eso el AG pretensado NO modifica el límite (sería inventar un
// requisito que la norma no establece a nivel agregado), pero SÍ
// emite pass_with_observations recordando que el control mezcla-nivel
// (art. 2.2.8) es lo que finalmente decide aptitud para pretensado.
// Esa decisión la toma el motor de mezcla, no éste.
evaluadores['IRAM1882_CLORUROS_SOLUBLES'] = (r, ctx) => {
  const esAF = ctx.tipoAgregado === 'FINO' || ctx.tipoAgregado === 'Fino';
  const val = r.valor;
  if (val == null) return null;
  // tipoArmadura viene de UsageContext (creado por usageContextFromCalcularBody
  // o usageContextFromDosificacion). Si no está, default conservador 'armado'.
  const tipoArmadura = ctx.usageContext?.tipoArmadura || null;
  const esPretensado = tipoArmadura === 'pretensado';
  const limite = esPretensado && esAF ? 0.01 : (esAF ? 0.04 : 0.003);
  const normaLabel = esAF
    ? (esPretensado ? 'IRAM 1512 Tabla 1 (pretensado)' : 'IRAM 1512 Tabla 1')
    : 'IRAM 1531 Tabla 1';
  const tipoLabel = esAF ? 'AF' : 'AG';
  const op = getOperador(r);

  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: limite, comparator: '<=', unidad: '%' },
    norm: `IRAM 1882 / ${normaLabel} / CIRSOC 200 art. 2.2.8`,
  };

  // Para AG en contexto pretensado, el límite del agregado no cambia
  // (IRAM 1531 no lo distingue por tipoArmadura), pero el control
  // mezcla-nivel (art. 2.2.8) sí es más restrictivo. Marcamos
  // pass_with_observations canónico cuando el agregado cumple.
  const obsBase = `Límite ≤ ${limite}% según ${normaLabel}. Adicionalmente se verifica aporte al hormigón (art. 2.2.8).`;
  const obsPretensadoAG = esPretensado && !esAF
    ? 'Atención: hormigón pretensado — el aporte de cloruros del AG debe sumarse a cemento/agua para verificar art. 2.2.8 (límite total más estricto en pretensado).'
    : null;

  if (op) {
    const e = evalMaxConOperador(val, limite, `Cloruros ${tipoLabel} (${normaLabel})`, op);
    const estado = estadoDesdeOperador(e);
    if (estado === 'NO_EVAL') {
      // Caso NO_CONCLUYENTE: el evaluador antes lo aplastaba a NO_EVAL.
      // Ahora exponemos NO_CONCLUYENTE explícito + hint para que evaluarEnsayo
      // construya un Compliance.inconclusive con detection_limit.
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: e.msg,
        alerta: true,
        observaciones: [`${obsBase} El resultado "${operadorPrefix(op)}${val}%" no permite confirmar cumplimiento. Solicitar mayor precisión al laboratorio.`],
        ...meta,
        complianceHint: {
          resultado: 'inconclusive',
          reason: e.msg,
          detection_limit: meta.measured,
        },
      };
    }
    const out = {
      estado, mensaje: e.msg, detalle: [e],
      observaciones: obsPretensadoAG ? [obsBase, obsPretensadoAG] : [obsBase],
      ...meta,
    };
    if (estado === 'CUMPLE' && obsPretensadoAG) {
      out.alerta = true;
      out.complianceHint = {
        resultado: 'pass_with_observations',
        observation: obsPretensadoAG,
      };
    }
    return out;
  }
  // Valor exacto
  const e = evalMax(val, limite, `Cloruros ${tipoLabel} (${normaLabel})`);
  const observaciones = obsPretensadoAG ? [obsBase, obsPretensadoAG] : [obsBase];
  const out = {
    estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE',
    mensaje: e.msg,
    detalle: [e],
    observaciones,
    ...meta,
  };
  if (e.cumple && obsPretensadoAG) {
    out.alerta = true;
    out.complianceHint = {
      resultado: 'pass_with_observations',
      observation: obsPretensadoAG,
    };
  }
  return out;
};

// 15. Materia orgánica (IRAM 1647)
evaluadores['IRAM1647_MATERIA_ORGANICA'] = (r) => {
  // La excepción §3.2.3.4 b) (ensayo comparativo de morteros >= 95% del
  // patrón a 7 días) cuando es válida produce passWithObservations — el
  // material es apto para todo destino, pero queda anotada la excepción.
  const norm = 'IRAM 1647 / CIRSOC 200 §3.2.3.4';
  if (r.resultadoColorimetrico === 'menor_500') {
    return {
      estado: 'CUMPLE',
      mensaje: 'Materia orgánica < 500 ppm — CUMPLE.',
      measured: '< 500 ppm',
      limit: { value: 500, comparator: '<=', unidad: 'ppm' },
      norm,
    };
  }
  if (r.resultadoColorimetrico === 'igual_o_mayor_500') {
    if (r.excepcionValida) {
      const obs = `Aprobado por excepción IRAM 1647 §3.2.3.4 b) — ensayo comparativo de morteros: ${r.excepcionPct}% (>= 95% del patrón a 7 días).`;
      return {
        estado: 'CUMPLE',
        mensaje: `Excepción §3.2.3.4 b) válida — ensayo morteros: ${r.excepcionPct}% (≥ 95%).`,
        alerta: true,
        measured: '>= 500 ppm',
        limit: { value: 500, comparator: '<=', unidad: 'ppm' },
        norm,
        complianceHint: {
          resultado: 'pass_with_observations',
          observation: obs,
        },
      };
    }
    return {
      estado: 'NO_CUMPLE',
      mensaje: 'Materia orgánica ≥ 500 ppm. Debe rechazarse, excepto por ensayo de morteros ≥ 95% (§3.2.3.4 b).',
      measured: '>= 500 ppm',
      limit: { value: 500, comparator: '<=', unidad: 'ppm' },
      norm,
    };
  }
  return null;
};

// 16. Materias carbonosas (IRAM 1647)
// CIRSOC 200 §3.2.3.4 — dual-limit:
//   ≤ 0,5% — apto para todo destino (incluye superficies con aspecto importante)
//   ≤ 1,0% — apto solo para destinos donde el aspecto superficial NO es crítico
//   > 1,0% — no apto (NO_CUMPLE)
// Zona 0,5-1,0% es conditional_pass canónico (exclude_destination: surface_wear).
evaluadores['IRAM1647_MATERIAS_CARBONOSAS'] = (r) => {
  const val = r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const norm = 'IRAM 1647 / CIRSOC 200 §3.2.3.4';
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { strict: 0.5, standard: 1.0, comparator: '<=', unidad: '%' },
    norm,
  };
  const condExcludeSurface = [{
    kind: 'exclude_destination',
    key: 'exclude_surface_wear',
    value: ['surface_wear'],
    description: 'Apto solo si el aspecto superficial no es crítico (excluye destinos con desgaste o vista).',
    source: 'CIRSOC 200 §3.2.3.4',
  }];

  if (op === 'menor_que') {
    const e = evalMaxConOperador(val, 0.5, 'Materias carbonosas', 'menor_que');
    if (e.estado === 'NO_CONCLUYENTE') {
      const e2 = evalMaxConOperador(val, 1.0, 'Materias carbonosas (otros)', 'menor_que');
      if (e2.estado === 'NO_CONCLUYENTE') {
        return {
          estado: 'NO_CONCLUYENTE',
          mensaje: e2.msg,
          detalle: [e, e2],
          alerta: true,
          ...meta,
          complianceHint: { resultado: 'inconclusive', reason: e2.msg, detection_limit: meta.measured },
        };
      }
      // < val cumple ≤1.0 pero no concluyente vs ≤0.5 — apto para destinos no críticos,
      // pero el destino "aspecto importante" no se puede confirmar.
      return {
        estado: 'CUMPLE',
        mensaje: `< ${val}% cumple para aspecto no crítico (≤ 1,0%). No concluyente para aspecto importante (≤ 0,5%).`,
        detalle: [e, e2],
        alerta: true,
        ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExcludeSurface,
          message: `< ${val}% cumple ≤ 1,0% (apto destinos no críticos). No concluyente vs ≤ 0,5% (aspecto superficial importante).`,
        },
      };
    }
    return { estado: 'CUMPLE', mensaje: e.msg, detalle: [e], ...meta };
  }
  if (op === 'mayor_que') {
    const e1 = evalMaxConOperador(val, 0.5, 'Aspecto superficial importante', 'mayor_que');
    const e2 = evalMaxConOperador(val, 1.0, 'Otros casos', 'mayor_que');
    const est2 = estadoDesdeOperador(e2);
    const est1 = estadoDesdeOperador(e1);
    if (est2 === 'NO_CUMPLE') {
      return { estado: 'NO_CUMPLE', mensaje: `Materias carbonosas > ${val}% supera ambos límites.`, detalle: [e1, e2], ...meta };
    }
    if (est1 === 'NO_CUMPLE') {
      return {
        estado: 'CUMPLE',
        mensaje: `Cumple si aspecto superficial no es crítico (≤ 1,0%). NO cumple para aspecto importante (> 0,5%).`,
        detalle: [e1, e2],
        alerta: true,
        ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExcludeSurface,
          message: `> ${val}% supera 0,5% pero cumple ≤ 1,0% (apto destinos no críticos).`,
        },
      };
    }
    return {
      estado: estadoDesdeOperador(e2),
      mensaje: `Materias carbonosas > ${val}% — ${e2.msg}`,
      detalle: [e1, e2],
      alerta: e2.alerta,
      ...meta,
      ...(est2 === 'NO_EVAL' ? { complianceHint: { resultado: 'inconclusive', reason: e2.msg, detection_limit: meta.measured } } : {}),
    };
  }
  // Valor exacto
  const e1 = evalMax(val, 0.5, 'Aspecto superficial importante');
  const e2 = evalMax(val, 1.0, 'Otros casos');
  if (!e2.cumple) return { estado: 'NO_CUMPLE', mensaje: `Materias carbonosas ${val}% supera ambos límites.`, detalle: [e1, e2], ...meta };
  if (!e1.cumple) {
    return {
      estado: 'CUMPLE',
      mensaje: `Cumple si aspecto superficial no es crítico (≤ 1,0%). NO cumple para aspecto importante (> 0,5%).`,
      detalle: [e1, e2],
      alerta: true,
      ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExcludeSurface,
        message: `Materias carbonosas ${val}% en zona 0,5-1,0% — apto solo si el aspecto superficial no es crítico.`,
      },
    };
  }
  return { estado: 'CUMPLE', mensaje: `Materias carbonosas ${val}% — cumple para cualquier destino.`, detalle: [e1, e2], ...meta };
};

// 17. Peso unitario (IRAM 1548)
// IRAM 1531 Tabla 4: Densidad a granel (PUS) >= 1.120 kg/m³ para AG
// PUC y PUS son siempre valores medidos exactos — no admiten operador `<`/`>`.
evaluadores['IRAM1531_PESO_UNITARIO'] = (r, ctx) => {
  const esAG = ctx.tipoAgregado === 'GRUESO' || ctx.tipoAgregado === 'Grueso';
  if (esAG && r.pus != null) {
    const e = evalMin(r.pus, 1120, 'Densidad a granel PUS (IRAM 1531 Tabla 4)');
    return {
      estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE',
      mensaje: e.msg,
      detalle: [e],
      observaciones: ['PUS ≥ 1.120 kg/m³ requerido para AG según IRAM 1531 Tabla 4.'],
      measured: r.pus,
      limit: { value: 1120, comparator: '>=', unidad: 'kg/m³' },
      norm: 'IRAM 1531 Tabla 4 / IRAM 1548',
    };
  }
  return {
    estado: 'CUMPLE',
    mensaje: 'Sin límites prescriptivos. Valores para diseño de mezclas.',
    informativo: true,
    measured: r.pus ?? r.puc ?? null,
    norm: 'IRAM 1548',
  };
};
evaluadores['IRAM1548_PESO_UNITARIO'] = evaluadores['IRAM1531_PESO_UNITARIO'];

// 18. Durabilidad sulfato de sodio (IRAM 1525:1985)
// AF: ≤ 10% (C1/C2 — congelación). Para otros casos es informativo.
// AG: ≤ 12% (IRAM 1531 / CIRSOC 201).
//
// R2 (auditoría 01-calidad sesión 2026-05-07): IRAM 1525:1985 §3.2 establece
// UN ÚNICO reactivo — solución saturada de SULFATO DE SODIO (Na₂SO₄,
// densidad 1,151–1,174). NO admite MgSO₄ (ese es ASTM C88). El método estándar
// son 5 ciclos de inmersión/secado. Los límites de CIRSOC 200:2024 (≤10% AF /
// ≤12% AG) están calibrados para ese método; otros agentes o ciclos atípicos
// invalidan la comparación directa.
evaluadores['IRAM1525_DURABILIDAD_SULFATO'] = (r, ctx) => {
  const val = r.perdidaPct ?? r.valor ?? r.perdidaPctTotal;
  if (val == null) return null;
  const esAF = ctx.tipoAgregado === 'FINO' || ctx.tipoAgregado === 'Fino';
  const limite = esAF ? 10 : 12;
  const label = esAF ? 'AF — C1/C2' : 'AG — C1/C2';
  const op = getOperador(r);

  // R2: defensa contra agentes/ciclos no normados.
  // Algunos formularios genéricos (IRAM1648_ESTABILIDAD_SULFATOS) admiten
  // 'sodio'|'magnesio' en `sulfato`/`agente`. Si llega 'magnesio' acá, el
  // resultado fue obtenido con un método cuya escala es distinta — el
  // evaluador lo marca inconclusive en vez de aplicar un límite que no
  // corresponde.
  const agenteRaw = String(r.agente ?? r.sulfato ?? '').trim().toLowerCase();
  const agenteEsMagnesio = agenteRaw === 'magnesio' || agenteRaw === 'mgso4' || agenteRaw === 'mg';
  if (agenteEsMagnesio) {
    return {
      estado: 'NO_CONCLUYENTE',
      mensaje: `Resultado obtenido con sulfato de magnesio. IRAM 1525 §3.2 prescribe sulfato de sodio (Na₂SO₄); los límites ${limite}% (C1/C2) no se aplican a ensayos con MgSO₄.`,
      detalle: [{ msg: 'Agente declarado: magnesio. Re-ensayar con Na₂SO₄ saturado (IRAM 1525 §3.2.1) o usar el evaluador genérico IRAM1648_ESTABILIDAD_SULFATOS sin contraste contra Tabla 2.5.' }],
      measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
      limit: { value: limite, comparator: '<=', unidad: '%' },
      norm: 'IRAM 1525:1985 §3.2 (Na₂SO₄ saturado)',
      complianceHint: {
        resultado: 'inconclusive',
        reason: 'Agente del ensayo (MgSO₄) no compatible con límites CIRSOC 200:2024 §3.2.3.5 / §3.2.4.4 (calibrados para Na₂SO₄ por IRAM 1525).',
      },
    };
  }

  // Ciclos atípicos: IRAM 1525 estándar = 5 ciclos. Otros conteos no invalidan
  // pero requieren flag para que el revisor sepa.
  const ciclos = Number(r.ciclos);
  const ciclosFlag = Number.isFinite(ciclos) && ciclos !== 5
    ? ` Ciclos declarados: ${ciclos} (estándar IRAM 1525 = 5 ciclos).`
    : '';

  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: limite, comparator: '<=', unidad: '%' },
    // R2 (auditoría 01-calidad): cita ampliada con la atribución del agente.
    // IRAM 1525:1985 = método (Na₂SO₄, 5 ciclos); CIRSOC 200:2024 §3.2.3.5
    // (AF) / §3.2.4.4 (AG) condiciona el ensayo a C1/C2 (Tabla 2.5).
    norm: esAF
      ? 'IRAM 1525:1985 §3.2 (Na₂SO₄ saturado, 5 ciclos) / CIRSOC 200:2024 §3.2.3.5 (C1/C2)'
      : 'IRAM 1525:1985 §3.2 (Na₂SO₄ saturado, 5 ciclos) / CIRSOC 200:2024 §3.2.4.4 (C1/C2)',
  };
  if (op) {
    const e = evalMaxConOperador(val, limite, 'Durabilidad sulfato ' + label, op);
    const estado = estadoDesdeOperador(e);
    const pfx = operadorPrefix(op);
    const obs = [`Durabilidad: ${pfx}${val}% vs limite ${limite}% — ${e.estado || (e.cumple ? 'CUMPLE' : 'NO_CUMPLE')}.${ciclosFlag}`];
    if (esAF) obs.push('Límite ≤ 10% aplica a estructuras C1/C2 (congelación-deshielo) según CIRSOC §3.2.3.5. Para otras clases es informativo.');
    else obs.push('Límite ≤ 12% para clases C1/C2 según CIRSOC §3.2.4.4.');
    const out = { estado, mensaje: e.msg, detalle: [e], observaciones: obs, alerta: e.alerta, ...meta };
    if (estado === 'NO_EVAL') {
      out.complianceHint = { resultado: 'inconclusive', reason: e.msg, detection_limit: meta.measured };
    }
    return out;
  }
  const e = evalMax(val, limite, label);
  const obs = esAF
    ? ['Límite ≤ 10% aplica a estructuras C1/C2 (congelación-deshielo) según CIRSOC §3.2.3.5. Para otras clases es informativo.']
    : ['Límite ≤ 12% para clases C1/C2 según CIRSOC §3.2.4.4.'];
  if (ciclosFlag) obs.push(ciclosFlag.trim());
  return { estado: e.cumple ? 'CUMPLE' : 'NO_CUMPLE', mensaje: e.msg, detalle: [e], observaciones: obs, alerta: e.alerta, ...meta };
};

// 19. Estabilidad basálticas (IRAM 1519)
// IRAM 1874-2: dual threshold —
//   ≤ 10%  → apto sin restricciones
//   10-30% → apto solo con experiencia > 25 años → conditional_pass + requires_documentation
//   > 30%  → no apto (NO_CUMPLE)
evaluadores['IRAM1519_ESTABILIDAD_BASALTICAS'] = (r) => {
  const val = r.perdidaPct ?? r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { strict: 10, standard: 30, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1519 / IRAM 1874-2',
  };
  const condExperience25y = [{
    kind: 'requires_documentation',
    key: 'experience_25y',
    value: 'experience_25y',
    description: 'Apto solo con documentación de experiencia > 25 años en obras con la misma roca/cantera (IRAM 1874-2).',
    source: 'IRAM 1874-2',
  }];

  if (op) {
    const pfx = operadorPrefix(op);
    const e10 = evalMaxConOperador(val, 10, 'Sin restricción', op);
    const e30 = evalMaxConOperador(val, 30, 'Con experiencia', op);
    const est30 = estadoDesdeOperador(e30);
    const est10 = estadoDesdeOperador(e10);
    if (est30 === 'NO_CUMPLE') {
      return { estado: 'NO_CUMPLE', mensaje: `Pérdida ${pfx}${val}% > 30% — No apto.`, detalle: [e10, e30], ...meta };
    }
    if (est30 === 'NO_EVAL') {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Pérdida ${pfx}${val}% — No concluyente vs límite 30%.`,
        detalle: [e10, e30],
        alerta: true,
        ...meta,
        complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra límite 30%.`, detection_limit: meta.measured },
      };
    }
    if (est10 === 'CUMPLE') {
      return { estado: 'CUMPLE', mensaje: `Pérdida ${pfx}${val}% < 10% — Apto sin restricciones.`, detalle: [e10, e30], ...meta };
    }
    if (est10 === 'NO_EVAL') {
      // Cumple ≤30% pero no concluyente vs ≤10% — conservadoramente conditional_pass.
      return {
        estado: 'CUMPLE',
        mensaje: `Pérdida ${pfx}${val}% — Cumple (≤ 30%). No concluyente vs 10%.`,
        detalle: [e10, e30],
        alerta: true,
        ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condExperience25y,
          message: `Pérdida ${pfx}${val}% — Cumple ≤ 30% pero no se puede confirmar < 10%. Requiere experiencia > 25 años.`,
        },
      };
    }
    // est10 === 'NO_CUMPLE' — supera 10% pero cumple ≤30%
    return {
      estado: 'CUMPLE',
      mensaje: `Pérdida ${pfx}${val}% entre 10-30% — Apto solo con experiencia > 25 años (IRAM 1874-2).`,
      alerta: true,
      detalle: [e10, e30],
      ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExperience25y,
        message: `Pérdida ${pfx}${val}% en zona 10-30% — Apto solo con experiencia documentada > 25 años.`,
      },
    };
  }
  if (val < 10) {
    return { estado: 'CUMPLE', mensaje: `Pérdida ${val}% < 10% — Apto sin restricciones.`, detalle: [evalMax(val, 10, 'Estabilidad basalticas')], ...meta };
  }
  if (val <= 30) {
    return {
      estado: 'CUMPLE',
      mensaje: `Pérdida ${val}% entre 10-30% — Apto solo con experiencia > 25 años (IRAM 1874-2).`,
      alerta: true,
      detalle: [evalMax(val, 10, 'Sin restricción'), evalMax(val, 30, 'Con experiencia')],
      ...meta,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condExperience25y,
        message: `Pérdida ${val}% en zona 10-30% — Apto solo con experiencia documentada > 25 años.`,
      },
    };
  }
  return { estado: 'NO_CUMPLE', mensaje: `Pérdida ${val}% > 30% — No apto.`, detalle: [evalMax(val, 30, 'Máximo admisible')], ...meta };
};

// 20. Examen petrográfico (IRAM 1649)
// Conclusión 'no_cumple_reactivo' (potencialmente reactivo a RAS):
//   - estado legacy: 'NO_CUMPLE' (mantenido por back-compat con ENUM `cumple`
//     y para activar AlertaCalidad como hoy).
//   - canónico (complianceHint): 'conditional_pass' + requires_mitigation —
//     en realidad el agregado puede usarse con cemento bajo álcali u otras
//     medidas preventivas (CIRSOC 200 §3.2.3.5). La asimetría es transitoria
//     hasta que Prompt 3 migre los consumidores a `compliance.status`.
//     Ver D15 en DEFERRED.md.
evaluadores['IRAM1649_EXAMEN_PETROGRAFICO'] = (r, ctx) => {
  if (!r.conclusion && r.ftanitaPct == null && r.conchillasPct == null) return null;
  const norm = 'IRAM 1649 / CIRSOC 200 §3.2.3.5';

  // PR8.11 — Sub-veredicto ftanita/chert (CIRSOC §3.2.4 Tabla 3.6).
  //   Hormigón visto C1/C2: ≤ 3%
  //   Estructural C1/C2:    ≤ 5%
  //   Otras clases:         sin límite específico (cobertura por exam petrográfico)
  // Cita normativa exacta: CIRSOC 200:2024 §3.2.4 Tabla 3.6 fila ftanita/chert.
  let ftanitaSub = null;
  if (r.ftanitaPct != null && Number.isFinite(Number(r.ftanitaPct))) {
    const pct = Number(r.ftanitaPct);
    const claseSevera = ctx?.claseExposicion === 'C1' || ctx?.claseExposicion === 'C2';
    const esVisto = ctx?.hormigonVisto === true || ctx?.aspectoSuperficialImportante === true;
    if (claseSevera && esVisto) {
      ftanitaSub = pct <= 3
        ? { cumple: true,  limite: 3, mensaje: `Ftanita ${pct}% ≤ 3% (hormigón visto C${ctx.claseExposicion}).` }
        : { cumple: false, limite: 3, mensaje: `Ftanita ${pct}% supera 3% (hormigón visto C${ctx.claseExposicion}).` };
    } else if (claseSevera) {
      ftanitaSub = pct <= 5
        ? { cumple: true,  limite: 5, mensaje: `Ftanita ${pct}% ≤ 5% (estructural C${ctx.claseExposicion}).` }
        : { cumple: false, limite: 5, mensaje: `Ftanita ${pct}% supera 5% (estructural C${ctx.claseExposicion}).` };
    } else {
      ftanitaSub = { cumple: true, limite: null, mensaje: `Ftanita ${pct}% — sin límite específico para clase ${ctx?.claseExposicion || 'no declarada'}.`, informativo: true };
    }
  }

  // PR8.21 — Sub-veredicto conchillas (CIRSOC §3.2.4.1.b).
  //   TMN 13.2 mm → ≤ 15%
  //   TMN 26.5 mm → ≤ 5%
  //   TMN 37.5 mm → ≤ 2%
  let conchillasSub = null;
  if (r.conchillasPct != null && Number.isFinite(Number(r.conchillasPct))) {
    const pct = Number(r.conchillasPct);
    const tmn = Number(ctx?.tmnMm) || null;
    let lim = null;
    if (tmn != null) {
      if (tmn <= 13.2) lim = 15;
      else if (tmn <= 26.5) lim = 5;
      else lim = 2; // ≥ 37.5
    }
    if (lim != null) {
      conchillasSub = pct <= lim
        ? { cumple: true,  limite: lim, tmn, mensaje: `Conchillas ${pct}% ≤ ${lim}% (TMN ${tmn} mm).` }
        : { cumple: false, limite: lim, tmn, mensaje: `Conchillas ${pct}% supera ${lim}% (TMN ${tmn} mm).` };
    } else {
      conchillasSub = { cumple: true, limite: null, tmn: null, mensaje: `Conchillas ${pct}% — sin TMN declarado, no se puede aplicar §3.2.4.1.b.`, informativo: true };
    }
  }

  // Helper: ensambla resultado combinando conclusion principal + sub-veredictos.
  const buildResult = (estadoPrincipal, mensajePrincipal, extraFields = {}) => {
    const subFails = [];
    if (ftanitaSub && !ftanitaSub.cumple) subFails.push(ftanitaSub.mensaje);
    if (conchillasSub && !conchillasSub.cumple) subFails.push(conchillasSub.mensaje);

    const detalleSub = [];
    if (ftanitaSub) detalleSub.push({ tipo: 'ftanita_chert', ...ftanitaSub, fuente: 'CIRSOC §3.2.4 Tabla 3.6' });
    if (conchillasSub) detalleSub.push({ tipo: 'conchillas', ...conchillasSub, fuente: 'CIRSOC §3.2.4.1.b' });

    if (subFails.length > 0 && estadoPrincipal === 'CUMPLE') {
      return {
        estado: 'NO_CUMPLE',
        mensaje: `${mensajePrincipal} — Pero: ${subFails.join(' ')}`,
        norm,
        detalle: detalleSub,
        ...extraFields,
      };
    }
    return {
      estado: estadoPrincipal,
      mensaje: mensajePrincipal,
      norm,
      ...(detalleSub.length > 0 && { detalle: detalleSub }),
      ...extraFields,
    };
  };

  if (!r.conclusion) {
    // Solo se cargaron sub-criterios (ftanita / conchillas) — emitir veredicto sub.
    const hayFail = (ftanitaSub && !ftanitaSub.cumple) || (conchillasSub && !conchillasSub.cumple);
    return buildResult(hayFail ? 'NO_CUMPLE' : 'CUMPLE', hayFail ? 'No cumple criterios CIRSOC.' : 'Cumple criterios CIRSOC.');
  }

  if (r.conclusion === 'cumple') {
    return buildResult('CUMPLE', 'Cumple requisitos IRAM 1531/1512. No reactivo.');
  }
  if (r.conclusion === 'no_cumple_reactivo') {
    const condMitigation = [{
      kind: 'requires_mitigation',
      key: 'ras_mitigation',
      value: 'cement_low_alkali_or_iram1674_validation',
      description: 'Potencialmente reactivo a RAS. Requiere medidas preventivas (cemento bajo álcali, adiciones puzolánicas) o validación adicional vía IRAM 1674.',
      source: 'CIRSOC 200 §3.2.3.5 / IRAM 1512 §5.6.5',
    }];
    return buildResult('NO_CUMPLE', 'No cumple — Potencialmente reactivo (RAS). Requiere medidas preventivas o ensayo IRAM 1674.', {
      alerta: true,
      complianceHint: {
        resultado: 'conditional_pass',
        conditions: condMitigation,
        message: 'Potencialmente reactivo a RAS. Apto con medidas preventivas (cemento bajo álcali) o validación IRAM 1674.',
      },
    });
  }
  return buildResult('NO_CUMPLE', 'No cumple requisitos IRAM 1531/1512.');
};

// 21. RAS — Método acelerado barra de mortero (IRAM 1674)
// Expansión a 16 días:
//   < 0,10% → no reactivo (CUMPLE)
//   ≥ 0,10% → potencialmente reactivo (legacy NO_CUMPLE para activar alerta;
//              canónico conditional_pass + requires_mitigation, mismo patrón
//              que petrográfico reactivo — Option B documentada, ver D15).
evaluadores['IRAM1674_RAS_ACELERADO'] = (r) => {
  const val = r.expansion16d ?? r.valor;
  if (val == null) return null;
  const op = getOperador(r);
  const meta = {
    measured: typeof val === 'number' && Number.isFinite(val) ? val : null,
    limit: { value: 0.10, comparator: '<', unidad: '%' },
    norm: 'IRAM 1674 / IRAM 1512 §5.6.5',
  };
  const condMitigation = [{
    kind: 'requires_mitigation',
    key: 'ras_mitigation',
    value: 'cement_low_alkali_or_pozzolan',
    description: 'Expansión a 16 días ≥ 0,10% — potencialmente reactivo. Apto con medidas preventivas (cemento bajo álcali, adiciones puzolánicas).',
    source: 'IRAM 1512 §5.6.5 / CIRSOC 200 §3.2.3.5',
  }];

  if (op) {
    const pfx = operadorPrefix(op);
    const e = evalMaxConOperador(val, 0.10, 'RAS acelerado', op);
    const estado = estadoDesdeOperador(e);
    if (estado === 'NO_CUMPLE') {
      return {
        estado: 'NO_CUMPLE',
        mensaje: `Expansión ${pfx}${val}% ≥ 0,10% a 16 días — Potencialmente reactivo. Requiere medidas preventivas (IRAM 1512 §5.6.5).`,
        detalle: [e],
        alerta: true,
        ...meta,
        complianceHint: {
          resultado: 'conditional_pass',
          conditions: condMitigation,
          message: `Expansión ${pfx}${val}% ≥ 0,10% — apto solo con medidas preventivas.`,
        },
      };
    }
    if (estado === 'NO_EVAL') {
      return {
        estado: 'NO_CONCLUYENTE',
        mensaje: `Expansión ${pfx}${val}% — No concluyente vs límite 0,10%.`,
        detalle: [e],
        alerta: true,
        ...meta,
        complianceHint: { resultado: 'inconclusive', reason: `${pfx}${val}% no permite verificar contra 0,10%.`, detection_limit: meta.measured },
      };
    }
    return { estado: 'CUMPLE', mensaje: `Expansión ${pfx}${val}% < 0,10% a 16 días — No reactivo.`, detalle: [e], ...meta };
  }
  if (val < 0.10) {
    return { estado: 'CUMPLE', mensaje: `Expansión ${val}% < 0,10% a 16 días — No reactivo.`, detalle: [evalMax(val, 0.10, 'RAS acelerado')], ...meta };
  }
  return {
    estado: 'NO_CUMPLE',
    mensaje: `Expansión ${val}% ≥ 0,10% a 16 días — Potencialmente reactivo. Requiere medidas preventivas (IRAM 1512 §5.6.5).`,
    detalle: [evalMax(val, 0.10, 'RAS acelerado')],
    alerta: true,
    ...meta,
    complianceHint: {
      resultado: 'conditional_pass',
      conditions: condMitigation,
      message: `Expansión ${val}% ≥ 0,10% — apto solo con medidas preventivas (cemento bajo álcali / puzolanas).`,
    },
  };
};

// 22. RAS — Prisma de hormigón (método de ensayo IRAM 1700)  [PR8.6]
// El sistema cataloga este ensayo como `IRAM1874_1_RAP_PRISMA` (legado: la
// norma IRAM 1874-1 cubre evaluación en estructuras EN SERVICIO; el método
// para PRISMAS DE HORMIGÓN es IRAM 1700:2013). Mantenemos el código del
// catálogo por compat, pero el método de ensayo es IRAM 1700.
//
// CIRSOC 200:2024 §2.2.16.9 + Anexo A2-2 Tabla A2-2.1:
//   - Tradicional 38°C, 52 semanas (~364 días): expansión > 0.04% → reactivo
//   - Acelerado    60°C, 13 semanas (~91 días):  expansión > 0.04% → reactivo
//     (umbral 0.08% en acelerado para agregados con cuarzo tensionado/
//     microcristalino, según comentario CIRSOC; aquí se admite como flag)
//
// Prelación: IRAM 1700 tiene PRELACIÓN sobre IRAM 1674 cuando ambos están
// disponibles (CIRSOC §2.2.16.9.b / IRAM 1512 §5.6.3.3).
//
// Si la expansión supera el umbral → conditional_pass + requires_mitigation
// (mismo patrón que IRAM 1674 — el agregado puede usarse con medidas
// preventivas: cemento bajo álcali, AMA, etc.).
evaluadores['IRAM1874_1_RAP_PRISMA'] = (r) => {
  // Resolver expansión final: campo directo o última lectura de la serie.
  let expansion = r?.expansionFinalPct;
  let edadFinalDias = null;
  if (Array.isArray(r?.series) && r.series.length > 0) {
    // Última lectura cronológica
    const ordered = [...r.series]
      .filter((s) => Number.isFinite(s?.edadDias) && Number.isFinite(s?.expansionPct))
      .sort((a, b) => a.edadDias - b.edadDias);
    if (ordered.length > 0) {
      const last = ordered[ordered.length - 1];
      edadFinalDias = last.edadDias;
      if (expansion == null) expansion = last.expansionPct;
    }
  }
  if (expansion == null) return null;

  // Inferir método por edad final (60°C acelerado ~91 d / 38°C tradicional ~364 d).
  // Si no hay edad clara, el método se trata como ACELERADO (más conservador).
  const cuarzoTensionado = !!r?.cuarzoTensionado;
  let metodo = 'acelerado_60C';
  if (edadFinalDias != null) {
    if (edadFinalDias >= 350) metodo = 'tradicional_38C';
    else if (edadFinalDias >= 80 && edadFinalDias <= 100) metodo = 'acelerado_60C';
    else metodo = 'indeterminado';
  }

  // Umbral según método y tipo de agregado (CIRSOC Tabla A2-2.1):
  //   Tradicional 38°C 52 sem: 0.04% (sin distinción)
  //   Acelerado 60°C 13 sem: 0.04% por defecto, 0.08% si cuarzo tensionado
  let umbral = 0.04;
  let umbralMotivo = `${metodo === 'tradicional_38C' ? '52 sem 38°C' : '13 sem 60°C'} ≤ 0,04%`;
  if (metodo === 'acelerado_60C' && cuarzoTensionado) {
    umbral = 0.08;
    umbralMotivo = '13 sem 60°C ≤ 0,08% (agregado con cuarzo tensionado/microcristalino — A2-2.1 nota B)';
  }

  const meta = {
    measured: typeof expansion === 'number' && Number.isFinite(expansion) ? expansion : null,
    edadDias: edadFinalDias,
    metodo,
    cuarzoTensionado,
    limit: { value: umbral, comparator: '<=', unidad: '%' },
    norm: 'IRAM 1700:2013 / CIRSOC 200:2024 §2.2.16.9 / Anexo A2-2 Tabla A2-2.1',
  };

  const condMitigation = [{
    kind: 'requires_mitigation',
    key: 'ras_mitigation',
    value: 'cement_low_alkali_or_iram1700_validation',
    description: 'Expansión en prismas IRAM 1700 supera umbral — potencialmente reactivo. Apto con medidas preventivas (cemento RRAA, bajo álcali, o AMA según CIRSOC §2.2.16.12-15).',
    source: 'CIRSOC 200:2024 §2.2.16 / IRAM 1512 §5.6.5',
  }];

  // PR8.6 — IRAM 1700 tiene PRELACIÓN sobre IRAM 1674 (CIRSOC §2.2.16.9.b).
  // La nota se incluye en el mensaje para que el agregador la respete cuando
  // ambos ensayos están presentes.
  const notaPrelacion = ' (IRAM 1700 prevalece sobre IRAM 1674 cuando ambos están disponibles, CIRSOC §2.2.16.9.b)';

  if (metodo === 'indeterminado') {
    // M19 (auditoría 01-calidad): mensaje específico según en qué tramo de la
    // recta de edad cayó la última lectura. Antes era genérico ("verificar
    // lecturas") y dejaba al usuario adivinar si el ensayo está trunco, mal
    // catalogado o tiene lecturas pasadas el final esperado.
    let diagMsg;
    let diagReason;
    if (edadFinalDias < 80) {
      diagMsg = `Edad final ${edadFinalDias} d — ensayo aún en curso para método acelerado 60°C (que termina a ~91 d). Esperar la lectura final antes de evaluar.`;
      diagReason = `Ensayo IRAM 1700 inconcluso (${edadFinalDias} d < 80 d): falta lectura final del método acelerado 60°C`;
    } else if (edadFinalDias > 100 && edadFinalDias < 350) {
      diagMsg = `Edad final ${edadFinalDias} d — fuera del rango acelerado 60°C (~91 d) y antes del tradicional 38°C (~364 d). Si el ensayo es tradicional, esperar a 52 semanas; si es acelerado, la lectura está pasada de tiempo.`;
      diagReason = `Ensayo IRAM 1700 ambiguo (${edadFinalDias} d): no calza ni acelerado 60°C (~91 d) ni tradicional 38°C (~364 d)`;
    } else {
      // > 364 d (raro pero posible)
      diagMsg = `Edad final ${edadFinalDias} d — superior al tradicional 38°C (~364 d). Verificar criterio del laboratorio para lecturas tan tardías.`;
      diagReason = `Ensayo IRAM 1700 con edad ${edadFinalDias} d superior al cierre tradicional (~364 d)`;
    }
    return {
      estado: 'NO_CONCLUYENTE',
      mensaje: diagMsg,
      detalle: [{ msg: 'Edad final fuera de los rangos esperados de IRAM 1700' }],
      ...meta,
      complianceHint: {
        resultado: 'inconclusive',
        reason: diagReason,
        detection_limit: meta.measured,
      },
    };
  }

  if (expansion <= umbral) {
    return {
      estado: 'CUMPLE',
      mensaje: `Expansión ${expansion}% ≤ ${umbral}% — No reactivo (${umbralMotivo}).${notaPrelacion}`,
      detalle: [{ msg: umbralMotivo, valor: expansion, limite: umbral, cumple: true }],
      ...meta,
    };
  }

  return {
    estado: 'NO_CUMPLE',
    mensaje: `Expansión ${expansion}% > ${umbral}% (${umbralMotivo}) — Potencialmente reactivo. Requiere medidas preventivas (CIRSOC §2.2.16.12-15).${notaPrelacion}`,
    detalle: [{ msg: umbralMotivo, valor: expansion, limite: umbral, cumple: false }],
    alerta: true,
    ...meta,
    complianceHint: {
      resultado: 'conditional_pass',
      conditions: condMitigation,
      message: `Expansión ${expansion}% > ${umbral}% — apto solo con medidas preventivas RAS.`,
    },
  };
};

/* ═══════════════════════════════════════════════════════════
   Public API
   ═══════════════════════════════════════════════════════════ */

/**
 * Evalúa un ensayo contra sus parámetros normativos.
 * @param {string} codigo - Código del tipo de ensayo (puede ser alias)
 * @param {object} resultado - JSON del resultado del ensayo
 * @param {object} ctx - Contexto: { tipoAgregado: 'FINO'|'GRUESO' }
 * @returns {{ cumple: string, estado: string, mensaje: string, detalle?, observaciones?, informativo? }}
 */
/**
 * Construye un ComplianceResult canónico a partir del output de un evaluador.
 *
 * Orden de prioridad:
 *   1. Si el evaluador expone `complianceHint`, usar ese hint para construir
 *      el ComplianceResult con buildCompliance() (caso C4.3 — evaluadores
 *      con lógica rica que producen passWithObservations / conditionalPass).
 *   2. Si no, derivar el resultado canónico desde el shape legacy:
 *      - estado === 'CUMPLE' + informativo:true → informative
 *      - estado === 'CUMPLE'                    → pass
 *      - estado === 'NO_CUMPLE'                 → fail
 *      - estado === 'NO_CONCLUYENTE'            → inconclusive (FIX C5/D14:
 *        antes se aplastaba a notEvaluated por el mapeo de `cumple`)
 *      - estado === 'NO_EVAL'                   → notEvaluated
 *      - estado === 'SIN_PARAMETROS'            → notEvaluated
 *
 * Esta separación permite refactorizar los evaluadores progresivamente:
 * los que no producen `complianceHint` siguen funcionando vía derivación
 * desde el shape legacy.
 *
 * ─── ⚠ MECANISMO DE TRANSICIÓN — `complianceHint` ─────────────────────
 * `complianceHint` permite que un evaluador exponga estados canónicos más
 * ricos (passWithObservations / conditionalPass) MIENTRAS mantiene un `estado`
 * legacy distinto para back-compat con call sites que aún leen el ENUM
 * `cumple`. Ej: petrográfico/RAS reactivo produce `estado: 'NO_CUMPLE'`
 * legacy + `complianceHint: { resultado: 'conditional_pass', ... }` canónico.
 * Ver D15 en DEFERRED.md.
 *
 * Cuando Prompt 3 migre los consumidores de `cumple` a `compliance.status`,
 * estos evaluadores deben volver a producir el `estado` legacy alineado con
 * el canónico (ej: `estado: 'CUMPLE'` para reactivos) y eliminar el hint.
 * `complianceHint` no es una API estable — es un puente de transición.
 */
function _buildComplianceFromEvaluadorOutput(codigo, result, ctx) {
  const { buildCompliance } = require('./compliance/buildCompliance');

  const usageContext    = ctx?.usageContext;
  const materialContext = ctx?.materialContext;
  const measured        = result.measured ?? null;
  const limit           = result.limit ?? null;
  const norm            = result.norm ?? null;

  // Caso 1: hint explícito del evaluador (C4.3 — lógica rica)
  if (result.complianceHint && typeof result.complianceHint === 'object') {
    const hint = result.complianceHint;
    return buildCompliance({
      resultado:        hint.resultado,
      codigo,
      usageContext,
      materialContext,
      measured:         hint.measured  ?? measured,
      limit:            hint.limit     ?? limit,
      norm:             hint.norm      ?? norm,
      observation:      hint.observation,
      conditions:       hint.conditions,
      reasons:          hint.reasons   ?? (result.estado === 'NO_CUMPLE' ? [result.mensaje] : undefined),
      reason:           hint.reason    ?? result.mensaje,
      detection_limit:  hint.detection_limit,
      severityOverride: hint.severityOverride,
      message:          hint.message   ?? result.mensaje,
      details:          hint.details   ?? (Array.isArray(result.detalle) ? result.detalle.filter(d => typeof d === 'string') : []),
    });
  }

  // Caso 2: derivar del shape legacy
  const baseArgs = {
    codigo,
    usageContext,
    materialContext,
    measured,
    limit,
    norm,
    message:  result.mensaje,
    details:  Array.isArray(result.detalle) ? result.detalle.filter(d => typeof d === 'string') : [],
  };

  // CRÍTICO C5/D14: NO_CONCLUYENTE → inconclusive (no notEvaluated)
  if (result.estado === 'NO_CONCLUYENTE') {
    return buildCompliance({
      resultado: 'inconclusive',
      reason: result.mensaje || 'Resultado no concluyente',
      ...baseArgs,
    });
  }

  if (result.estado === 'CUMPLE') {
    if (result.informativo) {
      return buildCompliance({ resultado: 'informative', ...baseArgs });
    }
    return buildCompliance({ resultado: 'pass', ...baseArgs });
  }

  if (result.estado === 'NO_CUMPLE') {
    return buildCompliance({
      resultado: 'fail',
      reasons: [result.mensaje || 'No cumple criterio normativo'],
      ...baseArgs,
    });
  }

  if (result.estado === 'SIN_PARAMETROS') {
    return buildCompliance({
      resultado: 'not_evaluated',
      reason: result.mensaje || 'Sin parámetros de evaluación',
      ...baseArgs,
    });
  }

  // Default: NO_EVAL u otro estado desconocido → notEvaluated
  return buildCompliance({
    resultado: 'not_evaluated',
    reason: result.mensaje || 'Sin datos para evaluar',
    ...baseArgs,
  });
}

function evaluarEnsayo(codigo, resultado, ctx = {}) {
  const { Compliance } = require('./compliance/ComplianceResult');

  if (!resultado) {
    return {
      cumple: 'NO_EVAL', estado: 'NO_EVAL',
      mensaje: 'Sin datos de resultado.',
      compliance: Compliance.notEvaluated({ reason: 'Sin datos de resultado.' }),
    };
  }

  const canonical = getCanonicalCodigo(codigo);
  const evaluador = evaluadores[canonical] || evaluadores[codigo];

  if (!evaluador) {
    return {
      cumple: 'NO_EVAL', estado: 'SIN_PARAMETROS',
      mensaje: 'No se encontraron parámetros de evaluación para este tipo de ensayo. Verifique la configuración del catálogo.',
      compliance: Compliance.notEvaluated({
        reason: 'Sin parámetros de evaluación configurados',
      }),
    };
  }

  const result = evaluador(resultado, ctx);
  if (!result) {
    return {
      cumple: 'NO_EVAL', estado: 'NO_EVAL',
      mensaje: 'Datos insuficientes para evaluar.',
      compliance: Compliance.notEvaluated({ reason: 'Datos insuficientes para evaluar.' }),
    };
  }

  // Mapeo legacy de cumple — preserva comportamiento histórico (back-compat)
  const cumple = result.estado === 'CUMPLE' ? 'CUMPLE'
               : result.estado === 'NO_CUMPLE' ? 'NO_CUMPLE'
               : 'NO_EVAL';

  // Construcción del compliance canónico (NUEVO — Prompt 2 C4.6)
  let compliance;
  try {
    compliance = _buildComplianceFromEvaluadorOutput(codigo, result, ctx);
  } catch (err) {
    // Defensa: si la construcción falla por shape inesperado del evaluador,
    // caer a notEvaluated en vez de romper el motor entero.
    compliance = Compliance.notEvaluated({
      reason: `Error construyendo compliance desde evaluador: ${err.message}`,
    });
  }

  return {
    cumple,
    estado: result.estado,
    mensaje: result.mensaje,
    detalle: result.detalle || [],
    observaciones: result.observaciones || [],
    informativo: result.informativo || false,
    alerta: result.alerta || false,
    compliance,
  };
}

/**
 * Cálculo de suma de sustancias nocivas — delegado al módulo consolidado
 * `domain/aggregate-properties/sumaSustanciasNocivas.js` (P1.6).
 *
 * Estos wrappers preservan la API anterior para no romper call sites. El nuevo
 * código debe importar directamente del módulo `aggregate-properties` para
 * obtener también el campo `compliance: ComplianceResult`.
 */
function calcularSumaSustanciasNocivasAF(ensayosMap) {
  const { evaluarAF } = require('./aggregate-properties/sumaSustanciasNocivas');
  return evaluarAF(ensayosMap);
}

function calcularSumaSustanciasNocivasAG(ensayosMap) {
  const { evaluarAG } = require('./aggregate-properties/sumaSustanciasNocivas');
  return evaluarAG(ensayosMap);
}

/**
 * Devuelve la lista de códigos de ensayo soportados por este motor (incluye
 * aliases). Útil para tests de cobertura de tablas declarativas:
 * `domain/compliance/required.js` y `domain/compliance/blocking.js` deben
 * tener entrada (directa o vía alias) para cada código que el motor reconoce.
 */
function getEvaluadorCodigos() {
  return Object.keys(evaluadores);
}

module.exports = {
  evaluarEnsayo,
  calcularSumaSustanciasNocivasAF,
  calcularSumaSustanciasNocivasAG,
  operadorPrefix,
  getOperador,
  getEvaluadorCodigos,
};
