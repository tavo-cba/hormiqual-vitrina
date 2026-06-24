/**
 * Espejo del modelo de evaluación dual del backend
 * (`hormiqual-backend/src/domain/evaluacion/`).
 *
 * Decisión 2026-05-28 (supersedes PR9 2026-05-04): modelo renombrado a
 * DESCRIPTIVO / NORMATIVO. Ver detalle en
 * `hormiqual-backend/src/domain/evaluacion/modos.js`.
 *
 *   DESCRIPTIVO: documento sin valoración normativa. No emite veredicto.
 *   Para dosificación incluye los valores normativos como referencia al
 *   lado de los calculados pero sin juicio.
 *
 *   NORMATIVO: evalúa contra la matriz CIRSOC 200:2024 + IRAM estricta,
 *   independiente del catálogo. Emite veredicto.
 *
 * Back-compat: los nombres viejos `MODO_PRESTACIONAL` / `MODO_PRESCRIPTIVO`
 * siguen exportándose como alias (`@deprecated`). `normalizarModo` mapea
 * los strings viejos al canónico nuevo.
 *
 * MANTENER SINCRONIZADO con el backend.
 */

// La matriz consolidada vive en `lib/normativa/`. El engine normativo del
// mirror la consume para reportar todo lo que la norma exige según el
// contexto del material.
import {
  obtenerEnsayosExigibles as _obtenerEnsayosExigibles,
  metadataExigibilidad as _metadataExigibilidad,
} from '../normativa/matrizPrescriptiva';
import { aplicaACanonico as _aplicaACanonico } from '../normativa/aplicabilidadEnsayos';

/* ════════════════════════════════════════════════════════════════════
   Constantes del contrato
   ════════════════════════════════════════════════════════════════════ */

// Nombres canónicos (2026-05-28)
export const MODO_DESCRIPTIVO = 'DESCRIPTIVO';
export const MODO_NORMATIVO   = 'NORMATIVO';

// Aliases deprecados (back-compat, migrar callers progresivamente)
/** @deprecated Usar MODO_DESCRIPTIVO. */
export const MODO_PRESTACIONAL = 'PRESTACIONAL';
/** @deprecated Usar MODO_NORMATIVO. */
export const MODO_PRESCRIPTIVO = 'PRESCRIPTIVO';

export const MODOS_VALIDOS = new Set([
  MODO_DESCRIPTIVO,
  MODO_NORMATIVO,
  MODO_PRESTACIONAL,   // alias entrada
  MODO_PRESCRIPTIVO,   // alias entrada
]);

export const VEREDICTO = Object.freeze({
  APTO:                    'APTO',
  APTO_CON_OBSERVACIONES:  'APTO_CON_OBSERVACIONES',
  NO_APTO:                 'NO_APTO',
  INCOMPLETO:              'INCOMPLETO',
});

export const SEVERIDAD_FALTANTE = Object.freeze({
  OBLIGATORIO: 'obligatorio',
  RECOMENDADO: 'recomendado',
});

export const SEVERIDAD_DESVIO = Object.freeze({
  BLOQUEANTE:    'bloqueante',
  NO_BLOQUEANTE: 'no_bloqueante',
});

/**
 * Normaliza un modo provisto por el caller a uno de los nombres canónicos
 * nuevos. Mapea aliases viejos. Default DESCRIPTIVO si no se reconoce.
 */
export function normalizarModo(modo) {
  if (typeof modo !== 'string') return MODO_DESCRIPTIVO;
  const upper = modo.toUpperCase();
  if (upper === MODO_DESCRIPTIVO || upper === MODO_PRESTACIONAL) return MODO_DESCRIPTIVO;
  if (upper === MODO_NORMATIVO   || upper === MODO_PRESCRIPTIVO) return MODO_NORMATIVO;
  return MODO_DESCRIPTIVO;
}

export function emptyEvaluacionResult(modo, fuente = 'Sin datos') {
  // Ver nota en backend `modos.js`: el engine siempre devuelve veredicto;
  // el "modo descriptivo no juzga" se hace cumplir en la capa de presentación.
  return {
    modo: normalizarModo(modo),
    fuente,
    itemsVisibles: [],
    ensayosFaltantes: [],
    ensayosNoConcluyentes: [],
    desviosNormativos: [],
    conteo: { ok: 0, fail: 0, condicional: 0, faltantes: 0, observaciones: 0, noConcluyentes: 0 },
    veredicto: VEREDICTO.INCOMPLETO,
    notas: ['Sin datos suficientes para evaluar.'],
  };
}

/* ════════════════════════════════════════════════════════════════════
   Helpers compartidos (espejo de backend)
   ════════════════════════════════════════════════════════════════════ */

function _tipoAplicaAlCtx(tipo, contextoAgregado) {
  if (!tipo) return false;
  const usaH = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
  const usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';
  const tieneFlagsMultiCtx = (tipo.aplicaAHormigon !== undefined || tipo.aplicaATBS !== undefined);
  if (!tieneFlagsMultiCtx) return true;
  if (usaH && tipo.aplicaAHormigon) return true;
  if (usaTBS && tipo.aplicaATBS) return true;
  return false;
}

function _tipoEsObligatorioEnCtx(tipo, contextoAgregado) {
  if (!tipo) return false;
  const usaH = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
  const usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';
  const tieneFlagsMultiCtx = (tipo.obligatorioHormigon !== undefined || tipo.obligatorioTBS !== undefined);
  // PR9.0 default seguro: undefined/null → NO obligatorio.
  if (!tieneFlagsMultiCtx) return tipo.obligatorio === true;
  if (usaH && tipo.obligatorioHormigon) return true;
  if (usaTBS && tipo.obligatorioTBS) return true;
  return false;
}

// PR9-fix: filtra por tipoAgregado (FINO/GRUESO) usando `tipo.aplicaA`.
// Mirror de backend `prestacionalEngine._tipoAplicaAlAgregado`.
//
// Orden: BD primero (si declara aplicaA no vacío), registry canónico segundo
// (cubre catálogos viejos donde el seed dejó aplicaA en NULL), default
// permisivo tercero.
function _tipoAplicaAlAgregado(tipo, tipoAgregado) {
  if (!tipo) return false;
  if (!tipoAgregado) return true;
  const aplicaA = tipo.aplicaA;
  const declaradoEnBD = Array.isArray(aplicaA) && aplicaA.length > 0;
  if (declaradoEnBD) {
    const target = String(tipoAgregado).toUpperCase();
    return aplicaA.some((a) => String(a).toUpperCase() === target);
  }
  const canonico = _aplicaACanonico(tipo.codigo, tipoAgregado);
  if (canonico !== null) return canonico;
  return true;
}

function _itemTieneResultado(item) {
  const r = item?.ultimoEnsayo?.resultado;
  if (!r) return false;
  if (typeof r === 'object' && Object.keys(r).length === 0) return false;
  return true;
}

function _clasificarItem(item) {
  const status = item?.compliance?.status;
  if (status === 'pass') return 'ok';
  if (status === 'fail') return 'fail';
  if (status === 'conditionalPass') return 'condicional';
  if (status === 'passWithObservations') return 'observacion';
  if (status === 'inconclusive') {
    return _itemTieneResultado(item) ? 'no_concluyente' : 'pendiente';
  }
  if (status === 'pending' || status === 'notEvaluated') return 'pendiente';
  if (_itemTieneResultado(item)) return 'ok';
  return 'pendiente';
}

/* ════════════════════════════════════════════════════════════════════
   Engine PRESTACIONAL
   ════════════════════════════════════════════════════════════════════ */

export function evaluarPrestacional(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const contextoAgregado = input.contextoAgregado || 'HORMIGON';
  const tiposCatalogo = Array.isArray(input.tiposCatalogo) ? input.tiposCatalogo : null;
  const incluirNoObligCargados = !!input.incluirNoObligatoriosCargados;
  // PR9-fix: tipoAgregado del material concreto ('FINO' | 'GRUESO').
  const tipoAgregado = input.tipoAgregado || null;

  const severidadFailFn = typeof input.severidadFailFn === 'function'
    ? input.severidadFailFn
    : (item) => {
        const sev = item?.compliance?.severity;
        if (sev === SEVERIDAD_DESVIO.BLOQUEANTE) return SEVERIDAD_DESVIO.BLOQUEANTE;
        if (sev === SEVERIDAD_DESVIO.NO_BLOQUEANTE) return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
        return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
      };

  if (items.length === 0 && (!tiposCatalogo || tiposCatalogo.length === 0)) {
    return emptyEvaluacionResult(MODO_PRESTACIONAL, 'Catálogo de obligatoriedad del tenant — sin items');
  }

  const itemsVisibles = [];
  const ensayosFaltantes = [];
  const ensayosNoConcluyentes = [];
  const desviosNormativos = [];
  const conteo = { ok: 0, fail: 0, condicional: 0, faltantes: 0, observaciones: 0, noConcluyentes: 0 };

  for (const it of items) {
    if (!_tipoAplicaAlCtx(it.tipo, contextoAgregado)) continue;
    if (!_tipoAplicaAlAgregado(it.tipo, tipoAgregado)) continue; // PR9-fix
    const esObligatorio = _tipoEsObligatorioEnCtx(it.tipo, contextoAgregado);
    if (!esObligatorio && !incluirNoObligCargados) continue;
    if (!esObligatorio && incluirNoObligCargados && !_itemTieneResultado(it)) continue;

    const clase = _clasificarItem(it);

    if (clase === 'pendiente') {
      if (esObligatorio) {
        ensayosFaltantes.push({
          codigo: it.tipo?.codigo || null,
          nombre: it.tipo?.nombre || it.tipo?.codigo || 'Ensayo sin nombre',
          normaRef: it.tipo?.normaRef || null,
          motivo: 'Declarado obligatorio en el plan de control de calidad de la planta — sin resultado cargado.',
          severidad: SEVERIDAD_FALTANTE.OBLIGATORIO,
        });
        conteo.faltantes++;
      }
      continue;
    }

    if (clase === 'no_concluyente') {
      itemsVisibles.push(it);
      conteo.noConcluyentes++;
      const motivoBase = it.compliance?.reason || it.compliance?.message;
      ensayosNoConcluyentes.push({
        codigo: it.tipo?.codigo || null,
        nombre: it.tipo?.nombre || it.tipo?.codigo || 'Ensayo sin nombre',
        normaRef: it.tipo?.normaRef || null,
        valor: it.compliance?.measured ?? null,
        limite: it.compliance?.limit ?? null,
        motivo: motivoBase
          ? `Resultado cargado pero no concluyente: ${motivoBase}`
          : 'Resultado cargado pero no concluyente: la precisión declarada no permite verificar el límite normativo.',
      });
      continue;
    }

    itemsVisibles.push(it);
    if (clase === 'ok') conteo.ok++;
    else if (clase === 'fail') {
      conteo.fail++;
      desviosNormativos.push({
        codigo: it.tipo?.codigo || null,
        nombre: it.tipo?.nombre || it.tipo?.codigo || 'Ensayo sin nombre',
        normaRef: it.tipo?.normaRef || null,
        valor: it.compliance?.measured ?? null,
        limite: it.compliance?.limit ?? null,
        motivo: it.compliance?.reason || it.compliance?.message || 'Incumplimiento normativo declarado por el catálogo.',
        severidad: severidadFailFn(it),
      });
    }
    else if (clase === 'condicional') conteo.condicional++;
    else if (clase === 'observacion') conteo.observaciones++;
  }

  if (tiposCatalogo && tiposCatalogo.length > 0) {
    const codigosVistos = new Set(items.map((i) => i.tipo?.codigo).filter(Boolean));
    const faltantesCodigos = new Set(ensayosFaltantes.map((f) => f.codigo).filter(Boolean));
    for (const tipo of tiposCatalogo) {
      if (!_tipoAplicaAlCtx(tipo, contextoAgregado)) continue;
      if (!_tipoAplicaAlAgregado(tipo, tipoAgregado)) continue; // PR9-fix
      if (!_tipoEsObligatorioEnCtx(tipo, contextoAgregado)) continue;
      const cod = tipo.codigo;
      if (!cod || codigosVistos.has(cod) || faltantesCodigos.has(cod)) continue;
      ensayosFaltantes.push({
        codigo: cod,
        nombre: tipo.nombre || cod,
        normaRef: tipo.normaRef || null,
        motivo: 'Declarado obligatorio en el plan de control de calidad de la planta — nunca ensayado.',
        severidad: SEVERIDAD_FALTANTE.OBLIGATORIO,
      });
      conteo.faltantes++;
    }
  }

  let veredicto;
  if (conteo.fail > 0 && desviosNormativos.some((d) => d.severidad === SEVERIDAD_DESVIO.BLOQUEANTE)) {
    veredicto = VEREDICTO.NO_APTO;
  } else if (conteo.faltantes > 0) {
    veredicto = VEREDICTO.INCOMPLETO;
  } else if (conteo.fail > 0 || conteo.condicional > 0 || conteo.observaciones > 0 || conteo.noConcluyentes > 0) {
    veredicto = VEREDICTO.APTO_CON_OBSERVACIONES;
  } else if (conteo.ok > 0) {
    veredicto = VEREDICTO.APTO;
  } else {
    veredicto = VEREDICTO.INCOMPLETO;
  }

  const notas = [];
  if (incluirNoObligCargados) {
    notas.push('Se incluyeron ensayos no obligatorios que tienen resultado cargado, sin afectar el veredicto (modo informativo).');
  }
  if (ensayosFaltantes.length > 0) {
    notas.push(`${ensayosFaltantes.length} ensayo(s) declarados obligatorios en el catálogo sin resultado.`);
  }
  if (ensayosNoConcluyentes.length > 0) {
    notas.push(`${ensayosNoConcluyentes.length} ensayo(s) cargados con resultado no concluyente (revisar precisión declarada).`);
  }

  return {
    modo: MODO_PRESTACIONAL,
    fuente: 'Catálogo de obligatoriedad del tenant',
    itemsVisibles,
    ensayosFaltantes,
    ensayosNoConcluyentes,
    desviosNormativos,
    conteo,
    veredicto,
    notas,
  };
}

/* ════════════════════════════════════════════════════════════════════
   Engine PRESCRIPTIVO (frontend mirror)
   ════════════════════════════════════════════════════════════════════
   PR9.3 — usa la matriz consolidada (`lib/normativa/matrizPrescriptiva`)
   como fuente única de exigibilidad. El caller pasa contexto chato
   (tipoAgregado, claseExposicion, fceMpa, tipoRoca, evaluacionRas) y el
   engine determina qué ensayos son exigibles, igual que el backend.
   Adicionalmente, `codigosNormativosAdicionales` permite extender la lista
   con códigos custom del caller.

   El import del módulo de matriz vive al tope del archivo (eslint
   import/first). _obtenerEnsayosExigibles y _metadataExigibilidad están
   importados arriba.
*/

export function evaluarPrescriptivo(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const codigosExtra = Array.isArray(input.codigosNormativosAdicionales)
    ? input.codigosNormativosAdicionales
    : [];

  // Contexto para la matriz prescriptiva (mismo shape que backend).
  const contextoMatriz = {
    tipoAgregado: input.tipoAgregado || null,
    claseExposicion: input.claseExposicion || null,
    fceMpa: input.fceMpa ?? null,
    tipoRoca: input.tipoRoca || null,
    evaluacionRas: input.evaluacionRas || null,
  };

  const severidadFailFn = typeof input.severidadFailFn === 'function'
    ? input.severidadFailFn
    : (item) => {
        const sev = item?.compliance?.severity;
        if (sev === SEVERIDAD_DESVIO.NO_BLOQUEANTE) return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
        if (sev === SEVERIDAD_DESVIO.BLOQUEANTE) return SEVERIDAD_DESVIO.BLOQUEANTE;
        return SEVERIDAD_DESVIO.BLOQUEANTE;
      };

  // PR9.3 — Universo desde la matriz consolidada del frontend.
  const ensayosMatriz = _obtenerEnsayosExigibles(contextoMatriz, { unknownComoRequired: true });

  if (items.length === 0 && codigosExtra.length === 0 && ensayosMatriz.length === 0) {
    return emptyEvaluacionResult(MODO_PRESCRIPTIVO, 'CIRSOC 200:2024 + serie IRAM (frontend mirror)');
  }

  const itemPorCodigo = new Map();
  for (const it of items) {
    if (it.tipo?.codigo) itemPorCodigo.set(it.tipo.codigo, it);
  }

  const universo = new Set();
  for (const cod of itemPorCodigo.keys()) universo.add(cod);
  for (const cod of codigosExtra) universo.add(cod);
  // PR9.3 — añadir códigos de la matriz exigibles para el contexto.
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
    const it = itemPorCodigo.get(codigo);
    const meta = metaPorCodigo.get(codigo) || _metadataExigibilidad(codigo, contextoMatriz);
    if (!it) {
      ensayosFaltantes.push({
        codigo,
        nombre: meta?.nombre || codigo,
        normaRef: meta?.normaRef || null,
        motivo: `Exigible por la normativa vigente. ${meta?.cita || ''}`.trim(),
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
      // PR9.3 — la matriz puede declarar bloqueante:false (ej. petrográfico).
      let sev = severidadFailFn(it);
      if (meta && meta.bloqueante === false) sev = SEVERIDAD_DESVIO.NO_BLOQUEANTE;
      desviosNormativos.push({
        codigo,
        nombre: meta?.nombre || it.tipo?.nombre || codigo,
        normaRef: meta?.normaRef || it.tipo?.normaRef || null,
        valor: it.compliance?.measured ?? null,
        limite: it.compliance?.limit ?? null,
        motivo: it.compliance?.reason || it.compliance?.message || 'Incumplimiento normativo.',
        severidad: sev,
      });
    }
    else if (clase === 'condicional') conteo.condicional++;
    else if (clase === 'observacion') conteo.observaciones++;
  }

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
    fuente: 'CIRSOC 200:2024 + serie IRAM (frontend mirror)',
    itemsVisibles,
    ensayosFaltantes,
    desviosNormativos,
    conteo,
    veredicto,
    notas,
  };
}

/* ════════════════════════════════════════════════════════════════════
   Entry point unificado
   ════════════════════════════════════════════════════════════════════ */

// Helper interno: el engine subyacente devuelve `modo: 'PRESTACIONAL' | 'PRESCRIPTIVO'`
// (nombres viejos). Lo normalizamos al canónico nuevo antes de exponer.
function _normalizarResultModo(result) {
  if (result && typeof result === 'object' && result.modo) {
    return { ...result, modo: normalizarModo(result.modo) };
  }
  return result;
}

export function evaluarMaterial(input = {}, options = {}) {
  const modo = normalizarModo(options.modo);
  if (modo === MODO_NORMATIVO) return _normalizarResultModo(evaluarPrescriptivo(input));
  return _normalizarResultModo(evaluarPrestacional(input));
}

export function evaluarDual(input = {}) {
  // Keys legacy se mantienen porque hay consumers que las leen como
  // `dual.prestacional` / `dual.prescriptivo`. Agregamos los nuevos keys
  // descriptivo/normativo como alias del mismo objeto.
  const descriptivo = _normalizarResultModo(evaluarPrestacional(input));
  const normativo   = _normalizarResultModo(evaluarPrescriptivo(input));
  return {
    // Nombres canónicos nuevos
    descriptivo,
    normativo,
    // Aliases deprecados (back-compat)
    prestacional: descriptivo,
    prescriptivo: normativo,
  };
}
