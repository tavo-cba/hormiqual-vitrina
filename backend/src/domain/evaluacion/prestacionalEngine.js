'use strict';

/**
 * prestacionalEngine.js — Modo PRESTACIONAL.
 *
 * El catálogo del tecnólogo es soberano. Este engine SOLO evalúa los
 * ensayos que el tenant declaró como obligatorios para el contexto en
 * cuestión (Hormigón / TBS). Los ensayos no obligatorios no se mencionan
 * en absoluto, ni siquiera como informativos — el usuario ya decidió que
 * no son vinculantes para su responsabilidad técnica.
 *
 * Reglas semánticas:
 *
 *   1. Filtro por contexto: items cuyo `tipo.aplicaA{Hormigon|TBS}` esté
 *      en false para el contexto activo se descartan.
 *
 *   2. Filtro por obligatoriedad: items cuyo `tipo.obligatorio{Hormigon|TBS}`
 *      esté en false (o legacy `tipo.obligatorio` !== true) NO entran al
 *      informe ni cuentan como faltantes. Se asume el default seguro:
 *      undefined / null = NO obligatorio.
 *
 *   3. Faltantes: tipos del catálogo declarados como obligatorios pero
 *      sin resultado cargado (compliance.status pending/notEvaluated).
 *
 *   4. Desvíos: items obligatorios cargados con compliance.status === 'fail'.
 *
 *   5. Veredicto:
 *      - APTO: todo obligatorio cargado y ok.
 *      - APTO_CON_OBSERVACIONES: hay condicionales / observaciones pero ningún fail.
 *      - NO_APTO: al menos un desvío bloqueante.
 *      - INCOMPLETO: faltan ensayos obligatorios sin resultado.
 *
 * Función PURA: no toca DB, ni HTTP, ni Sequelize. Recibe `items` (cada
 * uno con `tipo` + opcionalmente `compliance`) y opciones, devuelve
 * `EvaluacionResult` con shape contractual.
 */

const {
  MODO_PRESTACIONAL,
  VEREDICTO,
  SEVERIDAD_FALTANTE,
  SEVERIDAD_DESVIO,
  emptyEvaluacionResult,
} = require('./modos');
const { aplicaACanonico } = require('../normativa/aplicabilidadEnsayos');

/**
 * Determina si un tipo aplica al contexto del agregado.
 * Lógica idéntica al helper del PDF (PR9.0). Si los flags multi-contexto
 * no están declarados, el default es asumir que aplica (compat con catálogos
 * legacy donde el concepto multi-contexto no existía).
 */
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

/**
 * Determina si un tipo de ensayo aplica al TIPO DE AGREGADO concreto
 * (FINO/GRUESO). El catálogo declara `tipo.aplicaA` como array `['FINO']`,
 * `['GRUESO']` o `['FINO', 'GRUESO']`/null para indicar a qué tipos aplica.
 *
 * PR9-fix: antes el motor NO filtraba por esto, así que listaba como
 * "obligatorios pendientes" ensayos solo-FINO (ej. IRAM 1520 densidad fino,
 * materia orgánica, equivalente arena) en agregados gruesos. Bug confirmado
 * en test22.pdf donde un ripio grueso 6-19mm pedía ensayos de fino.
 *
 * Orden de resolución:
 *   1. Si la BD declara `tipo.aplicaA` no vacío → manda la BD.
 *   2. Si la BD no declara nada y el código está en el registry canónico
 *      (`aplicabilidadEnsayos`) → manda el registry. Esto cubre instalaciones
 *      viejas donde el seed no actualizó `aplicaA` por no correr con
 *      `--reset` (regla canónica de la norma, no configuración del tenant).
 *   3. Si nada de lo anterior aplica → default permisivo (aplica a todo).
 */
function _tipoAplicaAlAgregado(tipo, tipoAgregado) {
  if (!tipo) return false;
  if (!tipoAgregado) return true; // sin info de tipo → no podemos filtrar
  const aplicaA = tipo.aplicaA;
  const declaradoEnBD = Array.isArray(aplicaA) && aplicaA.length > 0;
  if (declaradoEnBD) {
    const target = String(tipoAgregado).toUpperCase();
    return aplicaA.some((a) => String(a).toUpperCase() === target);
  }
  const canonico = aplicaACanonico(tipo.codigo, tipoAgregado);
  if (canonico !== null) return canonico;
  return true; // último recurso: back-compat permisivo
}

/**
 * Determina si un tipo es obligatorio en el contexto.
 * Default seguro PR9.0: si los flags no están declarados, NO es obligatorio.
 * El usuario debe marcarlo EXPLÍCITAMENTE como obligatorio para que aparezca.
 */
function _tipoEsObligatorioEnCtx(tipo, contextoAgregado) {
  if (!tipo) return false;
  const usaH = contextoAgregado === 'HORMIGON' || contextoAgregado === 'AMBOS';
  const usaTBS = contextoAgregado === 'TBS' || contextoAgregado === 'AMBOS';
  const tieneFlagsMultiCtx = (tipo.obligatorioHormigon !== undefined || tipo.obligatorioTBS !== undefined);
  if (!tieneFlagsMultiCtx) return tipo.obligatorio === true;
  if (usaH && tipo.obligatorioHormigon) return true;
  if (usaTBS && tipo.obligatorioTBS) return true;
  return false;
}

/** Heurística: ¿el item tiene resultado cargado por el laboratorio? */
function _itemTieneResultado(item) {
  const r = item?.ultimoEnsayo?.resultado;
  if (!r) return false;
  if (typeof r === 'object' && Object.keys(r).length === 0) return false;
  return true;
}

/**
 * Clasifica un item por su compliance.status.
 * Devuelve uno de: 'ok' | 'fail' | 'condicional' | 'observacion' |
 * 'no_concluyente' | 'pendiente'.
 *
 * - 'no_concluyente' = el ensayo SÍ tiene resultado cargado, pero el motor
 *   normativo no pudo emitir veredicto (ej. precisión del ensayo insuficiente
 *   para verificar el límite). Se debe distinguir de 'pendiente' (sin
 *   resultado) porque el wording cliente-facing es completamente distinto.
 * - 'pendiente' = no hay resultado cargado o el ensayo no fue evaluado.
 */
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
  // Sin compliance: si tiene resultado, asumimos OK; si no, pendiente.
  if (_itemTieneResultado(item)) return 'ok';
  return 'pendiente';
}

/**
 * Evalúa un material en modo PRESTACIONAL.
 *
 * @param {object} input
 *   - items: array de items del resumen del agregado, cada uno con
 *            `{ tipo, ultimoEnsayo, compliance, ... }`.
 *   - contextoAgregado: 'HORMIGON' | 'TBS' | 'AMBOS' (default 'HORMIGON').
 *   - tiposCatalogo: opcional, array completo del catálogo del tenant
 *            (incluye tipos que el agregado NO ensayó pero podrían ser
 *            obligatorios). Se usa para detectar faltantes que NO están
 *            en `items`. Si no se pasa, se infieren faltantes solo de los
 *            items con status pendiente.
 *   - severidadFailFn: opcional `(item) => 'bloqueante'|'no_bloqueante'`
 *            para clasificar desvíos. Default: todos no_bloqueante.
 * @returns {EvaluacionResult}
 */
function evaluarPrestacional(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  const contextoAgregado = input.contextoAgregado || 'HORMIGON';
  const tiposCatalogo = Array.isArray(input.tiposCatalogo) ? input.tiposCatalogo : null;
  // PR9-fix: tipoAgregado del material concreto ('FINO' | 'GRUESO').
  // Si se provee, el motor filtra por `tipo.aplicaA` para no exigir
  // ensayos de fino en gruesos ni viceversa. Si no se provee (back-compat),
  // se evalúa sin ese filtro.
  const tipoAgregado = input.tipoAgregado || null;
  // Default: respetar `item.compliance.severity` si viene declarada (canónico
  // de buildCompliance). Si no, no_bloqueante (modo prestacional es más
  // permisivo que prescriptivo en presunciones). El caller puede sobreescribir.
  const severidadFailFn = typeof input.severidadFailFn === 'function'
    ? input.severidadFailFn
    : (item) => {
        const sev = item?.compliance?.severity;
        if (sev === SEVERIDAD_DESVIO.BLOQUEANTE) return SEVERIDAD_DESVIO.BLOQUEANTE;
        if (sev === SEVERIDAD_DESVIO.NO_BLOQUEANTE) return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
        return SEVERIDAD_DESVIO.NO_BLOQUEANTE;
      };

  if (items.length === 0 && (!tiposCatalogo || tiposCatalogo.length === 0)) {
    return emptyEvaluacionResult(MODO_PRESTACIONAL, 'Catálogo del tenant — sin items');
  }

  // 1) Filtrar items que aplican al contexto Y son obligatorios.
  //    Adicionalmente, items NO obligatorios pero CARGADOS también pueden
  //    aparecer si el caller declara `incluirNoObligatoriosCargados=true`.
  //    Default false (regla pura: el catálogo es soberano).
  const incluirNoObligCargados = !!input.incluirNoObligatoriosCargados;
  const itemsVisibles = [];
  const ensayosFaltantes = [];
  const desviosNormativos = [];
  // PR9-fix: ensayos cargados pero con resultado no concluyente (ej. precisión
  // del laboratorio insuficiente para verificar el límite normativo). Se
  // separan de los faltantes para no decir "sin resultado cargado" cuando
  // sí lo hay.
  const ensayosNoConcluyentes = [];
  const conteo = { ok: 0, fail: 0, condicional: 0, faltantes: 0, observaciones: 0, noConcluyentes: 0 };

  for (const it of items) {
    if (!_tipoAplicaAlCtx(it.tipo, contextoAgregado)) continue;
    // PR9-fix: descartar ensayos que no aplican al tipo de agregado
    // (ej. IRAM 1520 fino en un grueso).
    if (!_tipoAplicaAlAgregado(it.tipo, tipoAgregado)) continue;
    const esObligatorio = _tipoEsObligatorioEnCtx(it.tipo, contextoAgregado);
    if (!esObligatorio && !incluirNoObligCargados) continue;
    if (!esObligatorio && incluirNoObligCargados && !_itemTieneResultado(it)) continue;

    const clase = _clasificarItem(it);

    if (clase === 'pendiente') {
      // Sólo cuenta como faltante si es obligatorio.
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
      // No lo metemos en itemsVisibles si no tiene resultado.
      continue;
    }

    if (clase === 'no_concluyente') {
      // Sí tiene resultado cargado, pero el motor no pudo emitir veredicto
      // definitivo. Se muestra como "no concluyente" para no inducir al
      // usuario a creer que falta cargar el ensayo.
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

  // 2) Detectar faltantes adicionales del catálogo (tipos obligatorios que
  //    NUNCA fueron ensayados, ni siquiera aparecen en items).
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

  // 3) Veredicto.
  //
  //    Los ensayos "no concluyentes" cuentan como observación: el dato está
  //    cargado pero el veredicto normativo queda en suspenso por una
  //    limitación del ensayo (típicamente precisión). No se trata como
  //    "incompleto" porque eso induciría al usuario a recargar lo mismo.
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

module.exports = {
  evaluarPrestacional,
  // Helpers expuestos para test y reuso (mismas reglas que el PDF, PR9.0):
  _tipoAplicaAlCtx,
  _tipoAplicaAlAgregado,
  _tipoEsObligatorioEnCtx,
  _clasificarItem,
  _itemTieneResultado,
};
