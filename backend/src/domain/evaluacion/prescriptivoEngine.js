'use strict';

/**
 * prescriptivoEngine.js — Modo PRESCRIPTIVO.
 *
 * La normativa argentina (CIRSOC 200:2024 + serie IRAM) es soberana.
 * Este engine ignora completamente el flag `obligatorio*` del catálogo
 * del tenant y aplica las reglas de exigibilidad declarativas que viven
 * en `domain/compliance/required.js` (`EXIGIBILITY_TABLE`).
 *
 * Reglas semánticas:
 *
 *   1. Filtro por contexto: se evalúan SOLO los códigos cuya `isRequired`
 *      retorne `'required'` para el contexto (UsageContext + MaterialContext)
 *      provisto. Los `'not_applicable'` se omiten. Los `'unknown'` (datos
 *      contextuales incompletos) se conservadoriza a `'required'` — modo
 *      prescriptivo prefiere falso positivo a falso negativo.
 *
 *   2. Faltantes: códigos con `isRequired === required` que NO están en
 *      `items` o cuyo item no tiene resultado.
 *
 *   3. Desvíos: items presentes con compliance.status === 'fail'.
 *
 *   4. Veredicto: igual que prestacional (APTO / OBS / NO_APTO / INCOMPLETO),
 *      pero la lista de obligatorios viene de la matriz, no del catálogo.
 *
 * NOTA sobre la matriz: hoy `EXIGIBILITY_TABLE` cubre los ensayos del
 * pipeline normativo principal pero NO está completa contra toda la
 * matriz (clase exposición × clase hormigón × destino × tipo estructura).
 * Esa consolidación es PR9.2. Este engine ya está listo para consumirla
 * cuando esté.
 *
 * Función PURA.
 */

const {
  MODO_PRESCRIPTIVO,
  VEREDICTO,
  SEVERIDAD_FALTANTE,
  SEVERIDAD_DESVIO,
  emptyEvaluacionResult,
} = require('./modos');

// PR9.2 — Single Source of Truth normativa: `domain/normativa/matrizPrescriptiva.js`.
// El engine consume el getter unificado `obtenerEnsayosExigibles(contexto)`,
// que internamente honra los predicados estructurados de cada entrada.
const {
  obtenerEnsayosExigibles,
  metadataExigibilidad,
  esExigible,
} = require('../normativa/matrizPrescriptiva');

// Compatibilidad: la EXIGIBILITY_TABLE legacy sigue disponible para
// consumidores no migrados (alertas, etc.). PR9.2 NO la elimina.
const {
  isRequired,
  REQUIRED,
  UNKNOWN,
} = require('../compliance/required');

/**
 * Mismo `_clasificarItem` que prestacional (la lógica es idéntica para
 * ambos modos — sólo cambia QUÉ items se consideran, no cómo se clasifican).
 */
function _clasificarItem(item) {
  const status = item?.compliance?.status;
  if (status === 'pass') return 'ok';
  if (status === 'fail') return 'fail';
  if (status === 'conditionalPass') return 'condicional';
  if (status === 'passWithObservations') return 'observacion';
  if (status === 'pending' || status === 'notEvaluated' || status === 'inconclusive') return 'pendiente';
  if (item?.ultimoEnsayo?.resultado) return 'ok';
  return 'pendiente';
}

/**
 * Resuelve la severidad de un fail. Si el caller no provee función,
 * intenta leer `item.compliance.severity` (nuestro shape canónico
 * `'bloqueante'`/`'no_bloqueante'`); si tampoco está, asume bloqueante
 * (modo conservador prescriptivo: cualquier desvío normativo no resuelto
 * es bloqueante hasta que la matriz lo desmienta).
 */
function _severidadFail(item, severidadFn) {
  if (typeof severidadFn === 'function') return severidadFn(item);
  if (item?.compliance?.severity === SEVERIDAD_DESVIO.NO_BLOQUEANTE) return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
  if (item?.compliance?.severity === SEVERIDAD_DESVIO.BLOQUEANTE) return SEVERIDAD_DESVIO.BLOQUEANTE;
  return SEVERIDAD_DESVIO.BLOQUEANTE;
}

/**
 * Construye el `usageCtx` y `materialCtx` que `isRequired` espera, a partir
 * de los inputs del caller (que pueden venir con shape "amigable" del
 * frontend o con shape canónico). Adaptador simple.
 */
function _buildContextos(input = {}) {
  // Acepta dos formas:
  //  (a) caller pasa usageCtx/materialCtx directos
  //  (b) caller pasa shape simplificado: tipoAgregado, claseExposicion, fceMpa, etc.
  const usageCtx = input.usageCtx || {
    exposureClass: input.claseExposicion || null,
    fcMpa: input.fceMpa ?? input.fcMpa ?? null,
    tipologiaCodigo: input.tipologiaCodigo || null,
    expuestoDesgaste: input.expuestoDesgaste ?? null,
    aspectoSuperficialImportante: input.aspectoSuperficialImportante ?? null,
    tipoArmadura: input.tipoArmadura || null,
    tipoEstructura: input.tipoEstructura || null,
  };
  const materialCtx = input.materialContext || input.materialCtx || {
    tipoAgregado: input.tipoAgregado || null,
    subtipoMaterial: input.subtipoMaterial || null,
  };
  return { usageCtx, materialCtx };
}

/**
 * Evalúa un material en modo PRESCRIPTIVO.
 *
 * @param {object} input
 *   - items: array de items presentes (cargados o pendientes), c/u con
 *            `{ tipo: { codigo, nombre, normaRef, ... }, compliance, ... }`.
 *   - tipoAgregado / claseExposicion / fceMpa / ...: contexto simplificado, o
 *   - usageCtx + materialCtx: contexto canónico para `isRequired`.
 *   - codigosNormativosAdicionales: opcional array de códigos extra a
 *            verificar (útil cuando hay códigos que no aparecen en `items`
 *            pero la matriz exige; ej. petrográfico cuando f'c≥35).
 *   - severidadFailFn: opcional, igual que prestacional.
 * @returns {EvaluacionResult}
 */
function evaluarPrescriptivo(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const { usageCtx, materialCtx } = _buildContextos(input);
  const codigosExtra = Array.isArray(input.codigosNormativosAdicionales)
    ? input.codigosNormativosAdicionales
    : [];

  // NOTA: NO devolvemos empty si items=[]. El modo prescriptivo debe
  // poder reportar "todo lo que la norma exige" aún sin ensayos cargados —
  // ese es justamente el caso de "material recién registrado, ¿qué le piden?".
  // La lista de faltantes saldrá de iterar la matriz prescriptiva más abajo.

  // Map para rápido lookup por código.
  const itemPorCodigo = new Map();
  for (const it of items) {
    if (it.tipo?.codigo) itemPorCodigo.set(it.tipo.codigo, it);
  }

  // 1) Construir el contexto unificado para la matriz prescriptiva (PR9.2).
  //    El shape de la matriz es chato (no usa usageCtx/materialCtx separados).
  const contextoMatriz = {
    tipoAgregado: materialCtx.tipoAgregado || null,
    claseExposicion: usageCtx.exposureClass || input.claseExposicion || null,
    fceMpa: usageCtx.fcMpa ?? input.fceMpa ?? null,
    tipoRoca: materialCtx.tipoRoca || input.tipoRoca || null,
    evaluacionRas: materialCtx.evaluacionRas || input.evaluacionRas || null,
    tipologiaCodigo: usageCtx.tipologiaCodigo || null,
  };

  // 2) Universo de códigos a evaluar:
  //    - Todos los códigos presentes en items.
  //    - Más los códigos extra solicitados por el caller.
  //    - Más los códigos exigibles según la matriz para este contexto.
  const universo = new Set();
  for (const cod of itemPorCodigo.keys()) universo.add(cod);
  for (const cod of codigosExtra) universo.add(cod);

  // PR9.2 — usamos la matriz consolidada como SSoT (en vez de iterar
  // EXIGIBILITY_TABLE legacy directamente).
  const ensayosMatriz = obtenerEnsayosExigibles(contextoMatriz, { unknownComoRequired: true });
  const metaPorCodigo = new Map();
  for (const e of ensayosMatriz) {
    universo.add(e.codigo);
    metaPorCodigo.set(e.codigo, e);
  }

  const itemsVisibles = [];
  const ensayosFaltantes = [];
  const desviosNormativos = [];
  const conteo = { ok: 0, fail: 0, condicional: 0, faltantes: 0, observaciones: 0 };

  for (const codigo of universo) {
    const meta = metaPorCodigo.get(codigo)
              || metadataExigibilidad(codigo, contextoMatriz);
    // Si no hay metadata en la matriz, igual lo procesamos (puede venir
    // de items con código no consolidado todavía o de codigosExtra).
    const it = itemPorCodigo.get(codigo);

    if (!it) {
      // Código exigido por norma pero ningún ensayo cargado.
      const esUnknownContext = meta && meta.fuente === 'unknown';
      ensayosFaltantes.push({
        codigo,
        nombre: meta?.nombre || codigo,
        normaRef: meta?.normaRef || null,
        motivo: esUnknownContext
          ? `Exigible según contexto declarado (datos contextuales incompletos — se asume exigible). ${meta?.cita || ''}`.trim()
          : `Exigible por la normativa vigente. ${meta?.cita || ''}`.trim(),
        severidad: SEVERIDAD_FALTANTE.OBLIGATORIO,
      });
      conteo.faltantes++;
      continue;
    }

    const clase = _clasificarItem(it);
    if (clase === 'pendiente') {
      ensayosFaltantes.push({
        codigo,
        nombre: meta?.nombre || it.tipo?.nombre || codigo,
        normaRef: meta?.normaRef || it.tipo?.normaRef || null,
        motivo: `Exigible por la normativa vigente — sin resultado cargado. ${meta?.cita || ''}`.trim(),
        severidad: SEVERIDAD_FALTANTE.OBLIGATORIO,
      });
      conteo.faltantes++;
      continue;
    }

    itemsVisibles.push(it);
    if (clase === 'ok') conteo.ok++;
    else if (clase === 'fail') {
      conteo.fail++;
      // PR9.2 — la severidad bloqueante puede venir declarada en la matriz.
      // Si la matriz dice `bloqueante: false`, lo respetamos (no degradamos a NO_APTO).
      let severidadDesvio = _severidadFail(it, input.severidadFailFn);
      if (meta && meta.bloqueante === false) {
        severidadDesvio = SEVERIDAD_DESVIO.NO_BLOQUEANTE;
      }
      desviosNormativos.push({
        codigo,
        nombre: meta?.nombre || it.tipo?.nombre || codigo,
        normaRef: meta?.normaRef || it.tipo?.normaRef || null,
        valor: it.compliance?.measured ?? null,
        limite: it.compliance?.limit ?? null,
        motivo: it.compliance?.reason || it.compliance?.message || 'Incumplimiento normativo.',
        severidad: severidadDesvio,
      });
    }
    else if (clase === 'condicional') conteo.condicional++;
    else if (clase === 'observacion') conteo.observaciones++;
  }

  // 2) Veredicto.
  let veredicto;
  if (conteo.fail > 0 && desviosNormativos.some((d) => d.severidad === SEVERIDAD_DESVIO.BLOQUEANTE)) {
    veredicto = VEREDICTO.NO_APTO;
  } else if (conteo.faltantes > 0) {
    veredicto = VEREDICTO.INCOMPLETO;
  } else if (conteo.fail > 0 || conteo.condicional > 0 || conteo.observaciones > 0) {
    veredicto = VEREDICTO.APTO_CON_OBSERVACIONES;
  } else if (conteo.ok > 0) {
    veredicto = VEREDICTO.APTO;
  } else {
    veredicto = VEREDICTO.INCOMPLETO;
  }

  const notas = [];
  if (ensayosFaltantes.length > 0) {
    notas.push(`${ensayosFaltantes.length} ensayo(s) exigidos por norma sin resultado cargado.`);
  }
  if (conteo.fail > 0) {
    notas.push(`${conteo.fail} desvío(s) normativos detectados.`);
  }

  return {
    modo: MODO_PRESCRIPTIVO,
    fuente: 'CIRSOC 200:2024 + serie IRAM (matriz prescriptiva consolidada PR9.2)',
    itemsVisibles,
    ensayosFaltantes,
    desviosNormativos,
    conteo,
    veredicto,
    notas,
  };
}

module.exports = {
  evaluarPrescriptivo,
  _clasificarItem,
  _severidadFail,
  _buildContextos,
};
