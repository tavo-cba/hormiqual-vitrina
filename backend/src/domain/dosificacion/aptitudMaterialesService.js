'use strict';

/**
 * aptitudMaterialesService.js
 *
 * Verificación de aptitud de materiales según CIRSOC 200-2024.
 * §3.2.3.3 Tabla 3.4 — Sustancias nocivas en agregado fino
 * §3.2.3.4 — Materia orgánica
 * §3.2.3.5 — Durabilidad del AF
 *
 * Recibe: contexto de dosificación + últimos ensayos del AF
 * Retorna: tabla de verificación con límites dinámicos, valores, estados
 */

const { limiteClorurosCirsocTabla26 } = require('./estadoGlobalConsolidator');
const { resolveExpuestoDesgaste } = require('./aptitudCtxHelpers');

/* ═══════════════════════════════════════════════════════════
   Resolución de límites — Tabla 3.4 CIRSOC 200-2024
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {object} ctx - Contexto de la dosificación
 * @param {boolean} ctx.expuestoDesgaste - Hormigón expuesto a desgaste superficial
 * @param {boolean} ctx.aspectoSuperficialImportante - Aspecto superficial importante
 * @param {string}  ctx.tipoArmadura - 'simple' | 'armado' | 'pretensado'
 * @param {string}  ctx.subtipoMaterial - 'ARENA_NATURAL' | 'ARENA_TRITURACION' | etc.
 * @param {string}  ctx.claseExposicion - Clase de exposición CIRSOC (C1, C2, etc.)
 * @returns {object} Límites resueltos por sustancia
 */
function resolverLimitesAF(ctx = {}) {
  const limites = {};
  const notas = [];

  // ── Terrones de arcilla — límite fijo ──
  limites.terronesArcilla = {
    parametro: 'Terrones de arcilla y partículas friables',
    ensayoCodigo: 'IRAM1647_TERRONES_ARCILLA',
    max: 3.0,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'Tabla 3.4',
  };

  // ── Pasante #200 — criterio BINARIO CONTEXTUAL (PR8.8) ──
  // CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 distingue dos límites:
  //   - 3,0% si el hormigón está expuesto a desgaste superficial (estricto)
  //   - 5,0% en hormigones sin desgaste superficial (estándar)
  // Para arena de trituración, ambos límites suben +2 pp (Nota 1).
  //
  // Resolución del veredicto (PR8.8 — alineación estricta):
  //   v ≤ maxAplicable        → cumple
  //   v > maxAplicable        → no_cumple
  //
  // El contexto del diseño define qué límite es vinculante (`maxAplicable`).
  // Antes existía una zona intermedia (maxStrict, maxStandard] que producía
  // `cumple_condicional` con exclude_destination. Esa lógica se eliminó:
  // si el operador declara el contexto, el resultado debe ser binario
  // contra el límite aplicable. La zona intermedia generaba ambigüedad
  // y “zona gris” que no está en la norma.
  //
  // Antes el sistema solo aplicaba `maxPasante = conDesgaste ? 3 : 5` y
  // colapsaba a "cumple" silenciosamente cualquier valor ≤ 5%, sin avisar
  // al motor de dosificación que la arena no era apta para destinos con
  // desgaste. Bug P0.11 (caso "Arena prueba 1" en H-30 OPS Pisos).
  const conDesgaste = !!ctx.expuestoDesgaste;
  const esTrituracion = ['ARENA_TRITURACION', 'TRITURADO_ARTIFICIAL'].includes(ctx.subtipoMaterial);
  const ajusteTrituracion = esTrituracion ? 2.0 : 0.0;
  const maxStrict = 3.0 + ajusteTrituracion;
  const maxStandard = 5.0 + ajusteTrituracion;
  const maxAplicable = conDesgaste ? maxStrict : maxStandard;

  notas.push(conDesgaste
    ? `Límite 3,0% por exposición a desgaste superficial${esTrituracion ? ` (+2 pp arena trituración → ${maxStrict}%)` : ''}`
    : `Límite 5,0% — hormigón sin desgaste superficial${esTrituracion ? ` (+2 pp arena trituración → ${maxStandard}%)` : ''}`);

  // PR8.9 — Cita normativa actualizada: el ajuste +2pp por arena de trituración
  // proviene de CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 Nota (1), NO de IRAM 1512.
  // (IRAM 1512:2006 no incluye esa nota; sí la incluye CIRSOC.)
  limites.pasante200 = {
    parametro: 'Finos pasante tamiz 0,075 mm (N. 200)',
    ensayoCodigo: 'IRAM1674_MATERIAL_FINO_200',
    max: maxAplicable,                  // único límite vinculante (PR8.8 binario contextual)
    maxStrict,                          // informativo: límite con desgaste
    maxStandard,                        // informativo: límite sin desgaste
    expuestoDesgasteEnContexto: conDesgaste,
    expuestoEnContexto: conDesgaste,    // C7: nombre genérico para verifier
    binarioContextual: true,            // PR8.8 — fuerza evaluación binaria estricta vs lim.max
    unidad: '%',
    norma: 'IRAM 1540',                 // método de ensayo
    apartado: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',
    fuenteAjusteTrituracion: esTrituracion ? 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 Nota (1)' : null,
    condicion: conDesgaste
      ? `Límite 3,0% por exposición a desgaste superficial${esTrituracion ? ' (+2 pp por arena de trituración — CIRSOC §3.2.3.3 Nota 1)' : ''}`
      : `Límite 5,0% — sin desgaste superficial${esTrituracion ? ' (+2 pp por arena de trituración — CIRSOC §3.2.3.3 Nota 1)' : ''}`,
  };

  // ── Materias carbonosas — BINARIO CONTEXTUAL (PR8.8) ──
  // 0,5%  = límite estricto (aspecto superficial importante)
  // 1,0%  = límite estándar (aspecto no crítico)
  // El contexto declara cuál aplica; resultado binario contra `lim.max`.
  // Antes existía una zona (0,5; 1,0] que producía cumple_condicional
  // con exclude 'surface_wear'. Eliminada en PR8.8 por las mismas razones
  // que pasante200: la condicional sobre el mismo destino que el contexto
  // ya declara generaba ambigüedad sin respaldo normativo.
  const aspectoImportante = ctx.aspectoSuperficialImportante || false;
  limites.materiasCarb = {
    parametro: 'Materias carbonosas',
    ensayoCodigo: 'IRAM1647_MATERIAS_CARBONOSAS',
    max: aspectoImportante ? 0.5 : 1.0,
    maxStrict: 0.5,                      // informativo
    maxStandard: 1.0,                    // informativo
    expuestoEnContexto: aspectoImportante,
    binarioContextual: true,             // PR8.8 — evaluación binaria estricta
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',  // PR8.9 — cita explícita
    condicion: aspectoImportante
      ? 'Límite 0,5% por aspecto superficial importante'
      : 'Límite 1,0% — aspecto superficial no es factor crítico',
  };

  // ── Sulfatos — límite fijo ──
  limites.sulfatos = {
    parametro: 'Sulfatos (como SO3)',
    ensayoCodigo: 'IRAM1647_SULFATOS_SO3',
    max: 0.1,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',  // PR8.9
  };

  // ── Sales solubles — límite fijo ──
  limites.salesSolubles = {
    parametro: 'Sales solubles totales',
    ensayoCodigo: 'IRAM1647_SALES_SOLUBLES',
    max: 1.5,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',  // PR8.9
  };

  // ── Cloruros AF — límite IRAM 1882 + CIRSOC Tabla 3.4: <= 0,04% ──
  // PR8.9 — la cita canónica es CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (que
  // remite a método de ensayo IRAM 1882). La verificación a nivel hormigón
  // se cierra en CIRSOC §2.2.8 Tabla 2.6 (PR8.7).
  limites.cloruros = {
    parametro: 'Cloruros solubles',
    ensayoCodigo: 'IRAM1882_CLORUROS_SOLUBLES',
    max: 0.04,
    unidad: '%',
    norma: 'IRAM 1882',                                // método de ensayo
    apartado: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',    // PR8.9 — cita canónica
    condicion: 'Límite <= 0,04% (CIRSOC §3.2.3.3 Tabla 3.4). Además se verifica a nivel hormigón endurecido (CIRSOC §2.2.8 Tabla 2.6).',
  };

  // ── Materia orgánica — cualitativo ──
  limites.materiaOrganica = {
    parametro: 'Materia orgánica',
    ensayoCodigo: 'IRAM1647_MATERIA_ORGANICA',
    max: 500,
    unidad: 'mg/kg',
    norma: 'IRAM 1647',
    apartado: '§3.2.3.4',
    excepcion: 'Admisible si ensayo comparativo de morteros >= 95% del patrón a 7 días',
    cualitativo: true,
  };

  return { limites, notas };
}

/* ═══════════════════════════════════════════════════════════
   Helper compartido AF/AG — evaluación de un item contra su lim
   ═══════════════════════════════════════════════════════════
   C7: la lógica per-item se generalizó en este helper para que AG comparta
   el patrón dual-limit + conditions[] declarativas (lim.condicional). El
   helper NO sabe de qué evaluador viene la condición — se basa en los
   campos `maxStrict/maxStandard/expuestoEnContexto/condicional` del lim.
   ═══════════════════════════════════════════════════════════ */

/**
 * Evalúa un único item de aptitud contra los límites resueltos del contexto.
 *
 * @param {string} key - clave del item (pasante200, lajosidad, etc.)
 * @param {object} lim - límite resuelto por resolverLimitesAF/AG
 * @param {object|null} ensayo - resultado del laboratorio { valor, operador?, ... }
 * @returns {object} item completo con estado, conditions, etc.
 */
function _evaluateItem(key, lim, ensayo) {
  let valor = ensayo?.valor ?? null;
  let estado = 'sin_dato';
  let detalle = null;
  let conditions = null;
  const operador = ensayo?.operador || (ensayo?.esMenorQue ? 'menor_que' : null);

  if (ensayo) {
    // Materia orgánica — cualitativo (solo AF)
    if (lim.cualitativo) {
      const colorimetrico = ensayo.resultadoColorimetrico;
      if (colorimetrico === 'menor_500') {
        estado = 'cumple';
        valor = '< 500';
      } else if (colorimetrico === 'igual_o_mayor_500') {
        estado = ensayo.excepcionValida ? 'excepcion' : 'no_cumple';
        valor = '>= 500';
        if (ensayo.excepcionValida) {
          detalle = `Excepción §3.2.3.4 b) — ensayo morteros: ${ensayo.excepcionPct}%`;
        }
      } else {
        estado = 'pendiente';
      }
    }
    // Informativo (sin límite numérico)
    else if (lim.informativo) {
      estado = 'informativo';
      if (operador === 'menor_que') valor = `< ${valor}`;
      else if (operador === 'mayor_que') valor = `> ${valor}`;
    }
    // Numérico — con manejo de operador
    else if (valor != null) {
      const v = Number(valor);
      if (operador === 'menor_que') {
        if (v <= lim.max) {
          estado = 'cumple';
          valor = `< ${valor}`;
        } else {
          estado = 'no_concluyente';
          valor = `< ${valor}`;
          detalle = `Precisión del resultado (${v}${lim.unidad || ''}) insuficiente para verificar límite (${lim.max}${lim.unidad || ''}). Solicitar ensayo con precisión <= ${lim.max}${lim.unidad || ''}.`;
        }
      } else if (operador === 'mayor_que') {
        if (v > lim.max) {
          estado = 'no_cumple';
          valor = `> ${valor}`;
        } else {
          estado = 'no_concluyente';
          valor = `> ${valor}`;
          detalle = `Valor reportado > ${v}${lim.unidad || ''} vs límite ${lim.max}${lim.unidad || ''}. El valor real podría superar el límite.`;
        }
      }
      // ── Dual-limit (C7 generalizado): cualquier evaluador con
      // maxStrict/maxStandard + lim.condicional puede emitir conditions[].
      // PR8.8 — `binarioContextual` desactiva la zona intermedia: el
      // contexto ya define `lim.max` y el resultado es binario.
      else if (lim.binarioContextual === true) {
        // Evaluación estricta contra lim.max (ya resuelto por el contexto).
        if (v > lim.max) {
          estado = 'no_cumple';
          detalle = `Valor ${v}${lim.unidad || ''} supera el límite aplicable (${lim.max}${lim.unidad || ''}). ${lim.condicion || ''}`.trim();
        } else {
          estado = 'cumple';
        }
      }
      else if (lim.maxStrict != null && lim.maxStandard != null) {
        if (v > lim.maxStandard) {
          estado = 'no_cumple';
          detalle = `Valor ${v}${lim.unidad || ''} supera el límite estándar (${lim.maxStandard}${lim.unidad || ''}). No apto bajo ${lim.norma || lim.apartado || 'la norma aplicable'}.`;
        } else if (v > lim.maxStrict) {
          if (lim.expuestoEnContexto) {
            // El contexto declara la condición severa → no cumple por contexto.
            // Incluimos lim.condicion en el detalle para preservar la
            // terminología específica (desgaste superficial / aspecto
            // importante / alta resistencia / abrasión) que los tests y la
            // UI esperan ver en el mensaje al usuario.
            estado = 'no_cumple';
            detalle = `Valor ${v}${lim.unidad || ''} supera el límite estricto (${lim.maxStrict}${lim.unidad || ''}) aplicable al contexto declarado. ${lim.condicion || ''} NO apta para este diseño.`.trim();
          } else {
            estado = 'cumple_condicional';
            // Inyección declarativa: la condición vive en el lim, no
            // hardcoded por evaluador. Backward-compat: si lim no trae
            // condicional, fall back al patrón legacy (caso histórico de
            // pasante200 si se pierde el campo en algún re-build del lim).
            const cond = lim.condicional || (key === 'pasante200' ? {
              kind: 'exclude_destination',
              key: 'exclude_destination',
              value: ['surface_wear'],
              description: 'Solo apta para hormigón SIN desgaste superficial.',
              source: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4',
            } : null);
            if (cond) conditions = [cond];
            // Incluimos source para que la UI/PDF muestre la referencia normativa
            // que origina la restricción (ej: CIRSOC §3.2.3.3, IRAM 1532).
            const sourceRef = cond?.source ? ` (${cond.source})` : '';
            detalle = `Valor ${v}${lim.unidad || ''} en zona dual (${lim.maxStrict}-${lim.maxStandard}${lim.unidad || ''}). ${cond?.description || 'Aplica condición de uso restringido.'}${sourceRef}`;
          }
        } else {
          estado = 'cumple';
        }
      } else if (v > lim.max) {
        estado = 'no_cumple';
      } else {
        estado = 'cumple';
      }
    }
  }

  // INC 5: Compute % of the applicable limit so the PDF can flag proximity alerts
  let pctLimite = null;
  let alertaProximidad = false;
  if (estado === 'cumple' && typeof valor === 'number' && typeof lim.max === 'number' && lim.max > 0) {
    pctLimite = Math.round((valor / lim.max) * 100);
    alertaProximidad = pctLimite >= 90;
  }

  return {
    key,
    ...lim,
    valor,
    fecha: ensayo?.fecha || null,
    informe: ensayo?.informe || null,
    estado,
    detalle,
    pctLimite,
    alertaProximidad,
    conditions,
  };
}

/* ═══════════════════════════════════════════════════════════
   Helper compartido — agregación de items en compliance global
   ═══════════════════════════════════════════════════════════ */

/**
 * Convierte el estado legacy de aptitud al status canónico de ComplianceResult.
 * Tabla:
 *   cumple              → pass
 *   cumple_condicional  → conditionalPass
 *   excepcion           → passWithObservations  (materia orgánica con excepción §3.2.3.4 b)
 *   cumple_con_atencion → passWithObservations
 *   no_cumple           → fail
 *   no_concluyente      → inconclusive
 *   sin_dato            → notEvaluated
 *   incompleto          → notEvaluated
 *   pendiente           → notEvaluated
 *   informativo         → informative
 */
function _legacyEstadoToStatus(estado) {
  switch (estado) {
    case 'cumple': return 'pass';
    case 'cumple_condicional': return 'conditionalPass';
    case 'excepcion': return 'passWithObservations';
    case 'cumple_con_atencion': return 'passWithObservations';
    case 'no_cumple': return 'fail';
    case 'no_concluyente': return 'inconclusive';
    case 'informativo': return 'informative';
    case 'sin_dato':
    case 'incompleto':
    case 'pendiente':
    default: return 'notEvaluated';
  }
}

/**
 * Construye un ComplianceResult per-item usando buildCompliance, con
 * severity calculada vía isBlockingInContext cuando el estado es no_cumple
 * (cierra D5: el motor de aptitud ahora calcula severidad por contexto).
 *
 * @param {object} item - resultado de _evaluateItem
 * @param {object} usageContext - contexto de la dosificación (UsageContext canónico)
 * @param {object} materialContext - contexto del material (MaterialContext canónico)
 * @returns {ComplianceResult|null}
 */
function _buildItemCompliance(item, usageContext, materialContext) {
  const { buildCompliance } = require('../compliance/buildCompliance');
  const codigo = item.ensayoCodigo || null;
  const status = _legacyEstadoToStatus(item.estado);
  const measured = (typeof item.valor === 'number' && Number.isFinite(item.valor)) ? item.valor : null;
  const limit = item.maxStrict != null && item.maxStandard != null
    ? { strict: item.maxStrict, standard: item.maxStandard, comparator: '<=', unidad: item.unidad }
    : (typeof item.max === 'number' ? { value: item.max, comparator: '<=', unidad: item.unidad } : null);
  const norm = item.norma ? `${item.norma}${item.apartado ? ' / ' + item.apartado : ''}` : null;

  switch (status) {
    case 'pass':
      return buildCompliance({ resultado: 'pass', measured, limit, norm, message: item.detalle || null });
    case 'passWithObservations':
      return buildCompliance({
        resultado: 'pass_with_observations',
        observation: item.detalle || 'Cumple con observaciones.',
        measured, limit, norm,
      });
    case 'conditionalPass':
      return buildCompliance({
        resultado: 'conditional_pass',
        conditions: item.conditions || [],
        message: item.detalle || null,
        measured, limit, norm,
      });
    case 'fail':
      return buildCompliance({
        resultado: 'fail',
        codigo, usageContext, materialContext,    // ← severity vía isBlockingInContext
        reasons: [item.detalle || `No cumple criterio (${item.parametro || codigo || item.key})`],
        measured, limit, norm,
      });
    case 'inconclusive':
      return buildCompliance({
        resultado: 'inconclusive',
        reason: item.detalle || 'Resultado no concluyente.',
        detection_limit: measured,
        measured, limit, norm,
      });
    case 'informative':
      return buildCompliance({ resultado: 'informative', measured, norm });
    case 'notEvaluated':
    default:
      return buildCompliance({
        resultado: 'not_evaluated',
        reason: item.estado === 'sin_dato' ? 'Sin dato del laboratorio.'
              : item.estado === 'pendiente' ? 'Pendiente de carga colorimétrica.'
              : 'Sin evaluación.',
        norm,
      });
  }
}

/**
 * C9.1 — Construcción del Compliance global del material desde el resultado
 * agregado de la verificación. Reemplaza el call site de `fromAnyLegacy(string)`
 * que perdía info canónica para 'cumple_con_atencion' y 'incompleto'.
 *
 * Mapeo (alineado con el adapter `fromAptitudServiceShape`):
 *   no_cumple            → fail con severity calculada desde items
 *   cumple_condicional   → conditionalPass con conditions[] agregadas
 *   cumple_con_atencion  → passWithObservations (observation desde notas[0])
 *   incompleto           → pending (dispara MATERIAL_SIN_ENSAYO con exigible)
 *   cumple               → pass
 *   default              → notEvaluated
 *
 * @param {string} resultadoGlobal
 * @param {Array} items - items[] con compliance per-item ya construido
 * @param {Array} allConditions - conditions agregadas de items en zona condicional
 * @param {string} normRef - referencia normativa global (ej: 'CIRSOC 200-2024 §3.2.4 Tabla 3.6')
 * @param {Array} [notas]
 * @returns {ComplianceResult}
 */
function _buildAptitudGlobalCompliance(resultadoGlobal, items, allConditions, normRef, notas = []) {
  const { Compliance, SEVERITY } = require('../compliance');

  if (resultadoGlobal === 'no_cumple') {
    const failItems = items.filter(i => i.estado === 'no_cumple');
    const anyBlocking = failItems.some(i => i.compliance?.severity === SEVERITY.BLOQUEANTE);
    return Compliance.fail({
      reasons: failItems.map(i => i.detalle || `${i.parametro || i.key}: no cumple`),
      severity: anyBlocking ? SEVERITY.BLOQUEANTE : SEVERITY.NO_BLOQUEANTE,
      norm: normRef,
    });
  }
  if (resultadoGlobal === 'cumple_condicional' && allConditions.length > 0) {
    return Compliance.conditionalPass({
      conditions: allConditions,
      message: 'Cumple con condiciones de aplicabilidad declaradas',
      norm: normRef,
    });
  }
  if (resultadoGlobal === 'cumple_con_atencion') {
    const obs = (Array.isArray(notas) && notas[0])
      || items.find(i => i.estado === 'cumple_con_atencion' || i.estado === 'atencion')?.detalle
      || 'Cumple con observaciones técnicas en uno o más parámetros';
    return Compliance.passWithObservations({ observation: obs, norm: normRef });
  }
  if (resultadoGlobal === 'incompleto') {
    return Compliance.pending({
      reason: 'Faltan ensayos requeridos para concluir el veredicto del material. ' +
        'Cargar los ensayos pendientes para completar la evaluación.',
      norm: normRef,
    });
  }
  if (resultadoGlobal === 'cumple') {
    return Compliance.pass({ norm: normRef });
  }
  return Compliance.notEvaluated({
    reason: `resultadoGlobal "${resultadoGlobal}" no reconocido`,
    norm: normRef,
  });
}

/**
 * Bridge ctx legacy de aptitud → UsageContext canónico (parcial — solo
 * los campos relevantes para isBlockingInContext). Si ctx ya viene como
 * usageContext canónico, passthrough.
 */
function _ctxToUsageContext(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return {};
  // Detectar si ya es UsageContext canónico (campos canónicos vs ctx legacy)
  if (ctx.exposureClass !== undefined || ctx.tipologiaCodigo !== undefined) {
    return ctx;
  }
  // ctx legacy → mapeo a UsageContext mínimo
  return {
    exposureClass: ctx.claseExposicion || null,
    tipoArmadura: ctx.tipoArmadura || 'armado',
    expuestoDesgaste: !!ctx.expuestoDesgaste,
    aspectoSuperficialImportante: !!ctx.aspectoSuperficialImportante,
    fc: ctx.fc || null,
  };
}

/* ═══════════════════════════════════════════════════════════
   Evaluación de aptitud del AF
   ═══════════════════════════════════════════════════════════ */

/**
 * Verificación N/A para tipologías fuera de alcance CIRSOC 200 (HRDC).
 * Devuelve el mismo shape que `verificarAptitudAF/AG` para que el frontend
 * pueda renderizar el panel mostrando "no aplica" en vez de tratarlo como
 * un fallo de validación.
 */
function _verificacionNoAplicaHRDC(material) {
  return {
    material,
    items: [],
    resultadoGlobal: 'no_aplica',
    conditions: [],
    compliance: { status: 'informative', detalle: 'HRDC fuera de alcance CIRSOC 200.' },
    notas: ['HRDC: Tabla 3.4/3.6 CIRSOC 200 no aplica a hormigones celulares de resistencia y densidad controlada.'],
    normaRef: null,
    aplicaCirsoc: false,
  };
}

/**
 * @param {object} ctx - Contexto de dosificación
 * @param {object} ensayos - Últimos resultados del AF { terronesArcilla, pasante200, ... }
 *   Cada ensayo: { valor, fecha, informe, cumple, operador?, resultadoColorimetrico? }
 * @returns {object} Verificación completa
 */
function verificarAptitudAF(ctx, ensayos = {}) {
  // HRDC: la aptitud CIRSOC 200 (Tabla 3.4) no aplica a hormigones livianos
  // celulares de resistencia y densidad controlada. Devolver verificación N/A
  // explícita para que el frontend pueda mostrar el panel correctamente.
  if (String(ctx?.tipologiaCodigo || '').toLowerCase() === 'hrdc') {
    return _verificacionNoAplicaHRDC('AF');
  }
  const { limites, notas } = resolverLimitesAF(ctx);
  const items = [];

  for (const [key, lim] of Object.entries(limites)) {
    const ensayo = ensayos[key] || null;
    items.push(_evaluateItem(key, lim, ensayo));
  }

  // ── P1: Suma de sustancias nocivas (IRAM 1512 §5.2.2 / Tabla 1) ──
  // Only sum the numeric components (terrones + pasante200 + carbonosas + sulfatos + sales + cloruros).
  // When "expuestoDesgaste" is set the limit is 5,0% (strict), otherwise 7,0% (lax).
  // The verdict becomes NO_CUMPLE if the sum exceeds the applicable limit.
  try {
    const terronesVal = Number(ensayos.terronesArcilla?.valor);
    const pasa200Val = Number(ensayos.pasante200?.valor);
    const carbVal = Number(ensayos.materiasCarb?.valor);
    const sulfVal = Number(ensayos.sulfatos?.valor);
    const salesVal = Number(ensayos.salesSolubles?.valor);
    const clVal = Number(ensayos.cloruros?.valor);
    const valores = [terronesVal, pasa200Val, carbVal, sulfVal, salesVal, clVal];
    const tieneDatos = valores.some(v => !Number.isNaN(v) && v != null);
    if (tieneDatos) {
      const suma = valores.reduce((acc, v) => acc + (!Number.isNaN(v) && v != null ? v : 0), 0);
      const sumaRedondeada = Math.round(suma * 100) / 100;
      // Limit depends on desgaste exposure — IRAM 1512 Tabla 1 / §5.2.2
      // Auditoría 2026-05-08 (X2): usar el helper canónico que también
      // promueve a `true` cuando `tipologiaCodigo` implica desgaste, para
      // mantener consistencia con `estadoGlobalConsolidator`.
      const conDesgaste = resolveExpuestoDesgaste(ctx);
      const limiteSuma = conDesgaste ? 5.0 : 7.0;
      const contextoDesc = conDesgaste ? 'con desgaste superficial' : 'sin desgaste superficial';
      let estadoSuma, detalleSuma;
      const fmtPct = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const fmtComp = (n) => Number.isNaN(n) || n == null ? '0' : fmtPct(n);
      const sumaFmt = fmtPct(sumaRedondeada);
      const limiteFmt = fmtPct(limiteSuma);
      if (sumaRedondeada <= limiteSuma) {
        estadoSuma = 'cumple';
        detalleSuma = `Suma de sustancias nocivas IRAM 1512: ${sumaFmt}% <= ${limiteFmt}% (${contextoDesc}).`;
      } else {
        estadoSuma = 'no_cumple';
        detalleSuma = `Suma de sustancias nocivas IRAM 1512: ${sumaFmt}% supera el limite de ${limiteFmt}% (${contextoDesc}). Componentes sumados: terrones ${fmtComp(terronesVal)}%, pasa #200 ${fmtComp(pasa200Val)}%, carbonosas ${fmtComp(carbVal)}%, sulfatos ${fmtComp(sulfVal)}%, sales ${fmtComp(salesVal)}%, cloruros ${fmtComp(clVal)}%.`;
      }
      const pctLimiteSuma = Math.round((sumaRedondeada / limiteSuma) * 100);
      items.push({
        key: 'sumaSustanciasNocivas',
        parametro: 'Suma de sustancias nocivas',
        ensayoCodigo: 'SUMA_NOCIVAS_AF',
        max: limiteSuma,
        unidad: '%',
        norma: 'IRAM 1512',
        apartado: '§5.2.2 / Tabla 1',
        condicion: conDesgaste
          ? 'Limite 5,0% por exposicion a desgaste superficial'
          : 'Limite 7,0% - sin desgaste superficial',
        valor: sumaRedondeada,
        fecha: null,
        informe: null,
        estado: estadoSuma,
        detalle: detalleSuma,
        pctLimite: pctLimiteSuma,
        alertaProximidad: estadoSuma === 'cumple' && pctLimiteSuma >= 90,
      });
    }
  } catch { /* non-blocking */ }

  // C7: per-item compliance via buildCompliance (con severity calculada por
  // contexto cuando el estado es no_cumple — cierra D5).
  const usageContext = _ctxToUsageContext(ctx);
  const materialContext = ctx.materialContext || {};
  for (const item of items) {
    item.compliance = _buildItemCompliance(item, usageContext, materialContext);
  }

  // Resultado global (P0.11: cumple_condicional propaga al global)
  const estados = items.map(i => i.estado);
  let resultadoGlobal = 'cumple';
  if (estados.some(e => e === 'no_cumple')) resultadoGlobal = 'no_cumple';
  else if (estados.some(e => e === 'sin_dato')) resultadoGlobal = 'incompleto';
  // Bug cloruros (revisor-civil 2026-06-14): un ensayo `no_concluyente`
  // (p.ej. cloruros del AG informados "< 0,01%" cuando el límite IRAM 1531
  // es 0,003% — el método no tiene sensibilidad suficiente) NO demuestra
  // conformidad. Sin esta rama caía al default `cumple` → material APTO
  // (falso conforme) y la dosificación/pastón quedaba liberable. Es
  // "ausencia de demostración" → `incompleto` (NO `no_cumple`: tampoco está
  // probado el incumplimiento). Precede a cumple_condicional/atencion: un
  // parámetro normativo sin demostrar domina sobre "apto condicional".
  else if (estados.some(e => e === 'no_concluyente')) resultadoGlobal = 'incompleto';
  else if (estados.some(e => e === 'cumple_condicional')) resultadoGlobal = 'cumple_condicional';
  else if (estados.some(e => e === 'atencion')) resultadoGlobal = 'cumple_con_atencion';

  const allConditions = items
    .filter(i => i.conditions && i.conditions.length > 0)
    .flatMap(i => i.conditions);

  // C9.1: Compliance global construido con factories canónicos explícitos.
  // Antes: `fromAnyLegacy(resultadoGlobal)` para casos no especiales, lo que
  // colapsaba 'cumple_con_atencion' → pass (perdía passWithObservations) y
  // 'incompleto' → notEvaluated (perdía pending → no disparaba MATERIAL_SIN_ENSAYO).
  // Cierra D6 (parte) — este call site ya no usa el dispatcher genérico.
  const compliance = _buildAptitudGlobalCompliance(
    resultadoGlobal, items, allConditions, 'CIRSOC 200-2024 §3.2.3.3 Tabla 3.4', notas
  );

  return {
    material: 'AF',
    items,
    resultadoGlobal,
    conditions: allConditions,
    compliance,
    notas,
    normaRef: 'CIRSOC 200-2024 §3.2.3.3 Tabla 3.4',
  };
}

/* ═══════════════════════════════════════════════════════════
   Resolución de límites — Tabla 3.6 CIRSOC 200-2024 / IRAM 1531
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {object} ctx - Contexto de la dosificación
 * @param {boolean} ctx.expuestoDesgaste - Hormigón expuesto a desgaste superficial
 * @param {string}  ctx.tipoArmadura - 'simple' | 'armado' | 'pretensado'
 * @param {string}  ctx.subtipoMaterial - 'PIEDRA_PARTIDA' | 'GRAVA' | etc.
 * @param {string}  ctx.claseExposicion - Clase de exposición CIRSOC (C1, C2, etc.)
 * @param {number}  ctx.fc - Resistencia especificada (MPa)
 * @returns {object} Límites resueltos por sustancia
 */
function resolverLimitesAG(ctx = {}) {
  const limites = {};
  const notas = [];

  // CIRSOC 200:2024 Tabla 3.6 — única propiedad del AG con condicional por
  // clase de exposición es "materias carbonosas" (0,5% si C1/C2, sino 1,0%).
  // Las clases Q y M no aparecen en Tabla 3.6 con límites diferenciados.
  const esClaseCarbonosaEstricta = ctx.claseExposicion === 'C1' || ctx.claseExposicion === 'C2';
  // IRAM 1525 (durabilidad por sulfato) — también solo C1/C2 (§3.2.4.4).
  const esClaseDurabilidadSulfato = ctx.claseExposicion === 'C1' || ctx.claseExposicion === 'C2';
  const esPiedraPartida = ctx.subtipoMaterial === 'PIEDRA_PARTIDA';
  const fc = ctx.fc || 0;

  // ── Pasante #200 — depende de subtipo (no dual-limit conditional aún) ──
  // C7: a diferencia del AF, el AG resuelve por subtipo del material (grava
  // vs piedra partida). No hay zona condicional con exclude_destination — la
  // promoción a conditional_pass por subtipo desconocido queda fuera de
  // alcance del Prompt 2 (requiere modelar subtipo en MaterialContext).
  const maxPasante = esPiedraPartida ? 1.5 : 1.0;
  const notaPasante = esPiedraPartida
    ? 'Límite 1,5% — piedra partida (Tabla 3.6)'
    : 'Límite 1,0% — grava / grava partida (Tabla 3.6)';
  notas.push(notaPasante);

  limites.pasante200 = {
    parametro: 'Finos pasante tamiz 0,075 mm (N. 200)',
    ensayoCodigo: 'IRAM1674_MATERIAL_FINO_200',
    max: maxPasante,
    unidad: '%',
    norma: 'IRAM 1540',
    apartado: 'Tabla 3.6',
    condicion: notaPasante,
  };

  // ── Terrones de arcilla — límite fijo ──
  limites.terronesArcilla = {
    parametro: 'Terrones de arcilla y partículas friables',
    ensayoCodigo: 'IRAM1647_TERRONES_ARCILLA',
    max: 2.0,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'Tabla 3.6',
  };

  // ── Sulfatos — límite fijo ──
  limites.sulfatos = {
    parametro: 'Sulfatos (como SO3)',
    ensayoCodigo: 'IRAM1647_SULFATOS_SO3',
    max: 0.075,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'Tabla 3.6',
  };

  // ── Sales solubles — límite fijo ──
  limites.salesSolubles = {
    parametro: 'Sales solubles totales',
    ensayoCodigo: 'IRAM1647_SALES_SOLUBLES',
    max: 1.5,
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'Tabla 3.6',
  };

  // ── Cloruros — IRAM 1531 ──
  limites.cloruros = {
    parametro: 'Cloruros solubles',
    ensayoCodigo: 'IRAM1882_CLORUROS_SOLUBLES',
    max: 0.003,
    unidad: '%',
    norma: 'IRAM 1531',
    apartado: 'Tabla 1',
  };

  // ── Materias carbonosas — BINARIO CONTEXTUAL (PR8.8) ──
  // 0,5% estricto por C1/C2 o desgaste · 1,0% estándar.
  // El contexto define cuál aplica; resultado binario contra `lim.max`.
  // Antes existía una zona (0,5; 1,0] que producía cumple_condicional
  // con exclude 'surface_wear'. Eliminada en PR8.8 (ver nota equivalente
  // en AF carbonosas).
  const carbExpuesto = !!(esClaseCarbonosaEstricta || ctx.expuestoDesgaste);
  limites.materiasCarb = {
    parametro: 'Materias carbonosas',
    ensayoCodigo: 'IRAM1647_MATERIAS_CARBONOSAS',
    max: carbExpuesto ? 0.5 : 1.0,
    maxStrict: 0.5,                      // informativo
    maxStandard: 1.0,                    // informativo
    expuestoEnContexto: carbExpuesto,
    binarioContextual: true,             // PR8.8 — evaluación binaria estricta
    unidad: '%',
    norma: 'IRAM 1647',
    apartado: 'Tabla 3.6',
    condicion: carbExpuesto
      ? 'Límite 0,5% por C1/C2 o desgaste'
      : 'Límite 1,0% — sin exposición severa',
  };

  // ── Lajosidad — dual-limit por CLASE DE HORMIGÓN ──
  // CIRSOC 200:2024 §3.2.4.6 Tabla 3.7:
  //   Lajosas:   30% (uso general) · 25% (clase ≥ H-50, es decir f'c ≥ 50 MPa)
  //   Elongadas: 45% (uso general) · 40% (clase ≥ H-50)
  // IMPORTANTE: "H-50" se refiere a la CLASE DE HORMIGÓN (resistencia
  // especificada f'c ≥ 50 MPa), NO a un índice del agregado mismo.
  // Por eso `fc` aquí proviene del contexto de la dosificación.
  // Zona (25; 30] para lajosidad / (40; 45] para elongación → cumple_condicional
  // con exclude 'high_strength' si f'c < 50 MPa.
  const esAltaResistencia = !!(fc && fc >= 50);
  limites.lajosidad = {
    parametro: 'Lajosidad',
    ensayoCodigo: 'IRAM1687_1_LAJOSIDAD',
    max: esAltaResistencia ? 25 : 30,
    maxStrict: 25,
    maxStandard: 30,
    expuestoEnContexto: esAltaResistencia,
    unidad: '%',
    norma: 'IRAM 1687-1',
    apartado: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    condicion: esAltaResistencia
      ? `Límite 25% para hormigón clase ≥ H-50 (Tabla 3.7)`
      : `Límite 30% para uso general. Si clase ≥ H-50 (f'c ≥ 50 MPa): 25%`,
    condicional: {
      kind: 'exclude_destination',
      key: 'exclude_destination',
      value: ['high_strength'],
      description: 'Apto para uso general (≤ 30%) pero excluye hormigones de clase ≥ H-50 (≤ 25%).',
      source: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    },
  };

  // ── Elongación — dual-limit por clase de hormigón (paralelo a lajosidad) ──
  limites.elongacion = {
    parametro: 'Elongación',
    ensayoCodigo: 'IRAM1687_2_ELONGACION',
    max: esAltaResistencia ? 40 : 45,
    maxStrict: 40,
    maxStandard: 45,
    expuestoEnContexto: esAltaResistencia,
    unidad: '%',
    norma: 'IRAM 1687-2',
    apartado: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    condicion: esAltaResistencia
      ? `Límite 40% para hormigón clase ≥ H-50 (Tabla 3.7)`
      : `Límite 45% para uso general. Si clase ≥ H-50 (f'c ≥ 50 MPa): 40%`,
    condicional: {
      kind: 'exclude_destination',
      key: 'exclude_destination',
      value: ['high_strength'],
      description: 'Apto para uso general (≤ 45%) pero excluye hormigones de clase ≥ H-50 (≤ 40%).',
      source: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    },
  };

  // ── Desgaste Los Angeles — dual-limit por exposición a desgaste ──
  // 30% estricto (con abrasión severa) · 50% estándar.
  // Zona (30; 50]: cumple_condicional con exclude 'pavement_abrasion' si
  // ningún desgaste declarado en el contexto.
  //
  // PR8.19 — Mapeo del flag operativo `expuestoDesgaste = true` ⇒
  // ABRASION_SEVERA según CIRSOC 200:2024 §3.2.4.5.b. El reglamento define
  // como casos de abrasión severa:
  //   - tránsito vehicular intenso (pavimentos con tráfico pesado)
  //   - resbalamiento de granel (silos, tolvas con flujo de áridos)
  //   - escurrimiento rápido de agua con material en suspensión
  //     (canales de descarga, vertederos)
  // Este flag NO está atado a una clase de exposición específica del CIRSOC
  // §2.2.4 (CL/M/C/A/Q): es una decisión del usuario al cargar la dosificación
  // para indicar el destino físico del hormigón. La clase de exposición habla
  // de durabilidad química/ambiental; ABRASION_SEVERA habla de desgaste
  // mecánico de superficie.
  limites.desgasteLA = {
    parametro: 'Desgaste Los Angeles',
    ensayoCodigo: 'IRAM1532_DESGASTE_LA',
    max: ctx.expuestoDesgaste ? 30 : 50,
    maxStrict: 30,
    maxStandard: 50,
    expuestoEnContexto: !!ctx.expuestoDesgaste,
    unidad: '%',
    norma: 'IRAM 1532',
    apartado: 'CIRSOC 200:2024 §3.2.4.5 (PR8.19 — abrasión severa según §3.2.4.5.b)',
    condicion: ctx.expuestoDesgaste
      ? 'Con abrasión severa (≤ 30%) — tránsito intenso / resbalamiento granel / escurrimiento rápido (CIRSOC §3.2.4.5.b)'
      : 'General (≤ 50%) — sin abrasión severa declarada',
    condicional: {
      kind: 'exclude_destination',
      key: 'exclude_destination',
      value: ['pavement_abrasion'],
      description: 'Apto para hormigón convencional (≤ 50%) pero excluye destinos con abrasión severa (≤ 30%): pavimentos con tránsito intenso, silos/tolvas con resbalamiento granel, canales con escurrimiento rápido.',
      source: 'IRAM 1532 / CIRSOC 200:2024 §3.2.4.5.b',
    },
  };

  // ── Durabilidad — solo C1/C2 ──
  // CIRSOC 200:2024 §3.2.3.5 (AF) y §3.2.4.4 (AG) condicionan IRAM 1525 a
  // ciclos de congelación-deshielo (clases C1/C2 según Tabla 2.5).
  // IRAM 1525 es el método de ensayo.
  if (esClaseDurabilidadSulfato) {
    limites.durabilidad = {
      parametro: 'Durabilidad Na₂SO₄',
      ensayoCodigo: 'IRAM1525_DURABILIDAD_SULFATO',
      max: 12,
      unidad: '%',
      norma: 'IRAM 1525',                              // método de ensayo
      apartado: 'CIRSOC 200:2024 §3.2.3.5 (AF) / §3.2.4.4 (AG)',
      condicion: `Clase ${ctx.claseExposicion} — congelación-deshielo`,
    };
    notas.push(`Durabilidad requerida por clase de exposición ${ctx.claseExposicion}`);
  }

  // ── Absorción — IRAM 1531:2006 §5.2.3 Tabla 4 (escoria de alto horno) ──
  // Tabla 4 fija Absorción≤10% específicamente para AG de escoria. Para AG
  // natural y triturado IRAM 1531:2006 no fija un máximo análogo, por lo que
  // el límite se exige sólo cuando `subtipoMaterial === 'ESCORIA_ALTO_HORNO'`.
  // R5 auditoría 02-dosi cerrada (2026-05-07).
  if (String(ctx.subtipoMaterial || '').toUpperCase() === 'ESCORIA_ALTO_HORNO') {
    limites.absorcion = {
      parametro: 'Absorción',
      ensayoCodigo: 'IRAM1533_DENSIDAD_GRUESO',
      max: 10.0,
      unidad: '%',
      norma: 'IRAM 1531:2006',
      apartado: '§5.2.3 Tabla 4 (escoria de alto horno)',
      condicion: 'Aplica sólo a AG de escoria de alto horno.',
    };
  }

  return { limites, notas };
}

/* ═══════════════════════════════════════════════════════════
   Evaluación de aptitud del AG
   ═══════════════════════════════════════════════════════════ */

/**
 * @param {object} ctx - Contexto de dosificación
 * @param {object} ensayos - Últimos resultados del AG { terronesArcilla, pasante200, ... }
 *   Cada ensayo: { valor, fecha, informe, operador? }
 * @returns {object} Verificación completa
 */
function verificarAptitudAG(ctx, ensayos = {}) {
  // HRDC: aptitud CIRSOC 200 (Tabla 3.6) no aplica.
  if (String(ctx?.tipologiaCodigo || '').toLowerCase() === 'hrdc') {
    return _verificacionNoAplicaHRDC('AG');
  }
  const { limites, notas } = resolverLimitesAG(ctx);
  const items = [];

  // C7: AG ahora usa el mismo helper compartido que AF, con dual-limit
  // habilitado para materiasCarb / lajosidad / elongacion / desgasteLA
  // (zona condicional emite conditions[] con kind 'exclude_destination').
  for (const [key, lim] of Object.entries(limites)) {
    const ensayo = ensayos[key] || null;
    items.push(_evaluateItem(key, lim, ensayo));
  }

  // ── PR8.22 — Suma compuesta: terrones de arcilla + ftanita/chert ≤ 5%
  // (CIRSOC 200:2024 §3.2.4 Tabla 3.6, fila combinada).
  // Aún cuando cada componente individual cumple su límite, su SUMA no debe
  // exceder 5% en AG. La ftanita se obtiene del examen petrográfico
  // (`ensayos.examenPetrografico.ftanitaPct`) o directamente como
  // `ensayos.ftanitaPct` (si el orquestador la extrajo previamente).
  try {
    const terronesAg = Number(ensayos.terronesArcilla?.valor);
    const ftanitaAg = Number(
      ensayos.ftanitaPct?.valor ??
      ensayos.examenPetrografico?.ftanitaPct ??
      ensayos.examenPetrografico?.valor?.ftanitaPct ??
      NaN
    );
    if (!Number.isNaN(terronesAg) || !Number.isNaN(ftanitaAg)) {
      const sumComp = (Number.isFinite(terronesAg) ? terronesAg : 0)
        + (Number.isFinite(ftanitaAg) ? ftanitaAg : 0);
      const sumRedondeado = Math.round(sumComp * 100) / 100;
      const limite = 5.0;
      const cumple = sumRedondeado <= limite;
      const detalleParts = [];
      if (Number.isFinite(terronesAg)) detalleParts.push(`terrones ${terronesAg}%`);
      if (Number.isFinite(ftanitaAg)) detalleParts.push(`ftanita ${ftanitaAg}%`);
      else detalleParts.push('ftanita sin dato');
      items.push({
        key: 'sumaTerronesArcillaFtanita',
        parametro: 'Suma terrones de arcilla + ftanita/chert',
        ensayoCodigo: 'AG_SUMA_TERRONES_FTANITA',
        max: limite,
        unidad: '%',
        norma: 'IRAM 1647 + IRAM 1649',
        apartado: 'CIRSOC 200:2024 §3.2.4 Tabla 3.6 (suma compuesta)',
        condicion: 'Suma combinada ≤ 5% aún si cada componente individual cumple.',
        valor: sumRedondeado,
        fecha: null,
        informe: null,
        estado: cumple ? 'cumple' : 'no_cumple',
        detalle: cumple
          ? `Suma terrones+ftanita: ${sumRedondeado}% ≤ ${limite}% (${detalleParts.join(' + ')}).`
          : `Suma terrones+ftanita: ${sumRedondeado}% supera ${limite}% (${detalleParts.join(' + ')}). CIRSOC §3.2.4 Tabla 3.6.`,
        pctLimite: Math.round((sumRedondeado / limite) * 100),
        alertaProximidad: cumple && (sumRedondeado / limite) >= 0.9,
      });
    }
  } catch { /* non-blocking */ }

  // Per-item compliance (cierra D5 — severity por contexto en fail)
  const usageContext = _ctxToUsageContext(ctx);
  const materialContext = ctx.materialContext || {};
  for (const item of items) {
    item.compliance = _buildItemCompliance(item, usageContext, materialContext);
  }

  // Resultado global (C7: cumple_condicional ahora propaga al global, igual que en AF)
  const estados = items.map(i => i.estado);
  let resultadoGlobal = 'cumple';
  if (estados.some(e => e === 'no_cumple')) resultadoGlobal = 'no_cumple';
  else if (estados.some(e => e === 'sin_dato')) resultadoGlobal = 'incompleto';
  // Bug cloruros (revisor-civil 2026-06-14): un ensayo `no_concluyente`
  // (p.ej. cloruros del AG informados "< 0,01%" cuando el límite IRAM 1531
  // es 0,003% — el método no tiene sensibilidad suficiente) NO demuestra
  // conformidad. Sin esta rama caía al default `cumple` → material APTO
  // (falso conforme) y la dosificación/pastón quedaba liberable. Es
  // "ausencia de demostración" → `incompleto` (NO `no_cumple`: tampoco está
  // probado el incumplimiento). Precede a cumple_condicional/atencion: un
  // parámetro normativo sin demostrar domina sobre "apto condicional".
  else if (estados.some(e => e === 'no_concluyente')) resultadoGlobal = 'incompleto';
  else if (estados.some(e => e === 'cumple_condicional')) resultadoGlobal = 'cumple_condicional';
  else if (estados.some(e => e === 'atencion')) resultadoGlobal = 'cumple_con_atencion';

  const allConditions = items
    .filter(i => i.conditions && i.conditions.length > 0)
    .flatMap(i => i.conditions);

  // C9.1: ver _buildAptitudGlobalCompliance — cierra D6 parcial.
  const compliance = _buildAptitudGlobalCompliance(
    resultadoGlobal, items, allConditions, 'CIRSOC 200-2024 §3.2.4 Tabla 3.6', notas
  );

  return {
    material: 'AG',
    items,
    resultadoGlobal,
    conditions: allConditions,
    compliance,
    notas,
    normaRef: 'CIRSOC 200-2024 §3.2.4 Tabla 3.6',
  };
}

/* ═══════════════════════════════════════════════════════════
   Cloruros solubles totales a nivel hormigón — CIRSOC 200:2024 art. 2.2.8
   ═══════════════════════════════════════════════════════════ */

/**
 * Calcula cloruros solubles totales a nivel hormigón.
 *
 * PR8.7 — La cita normativa canónica vigente es CIRSOC 200:2024 §2.2.8 Tabla 2.6,
 * que expresa los límites en **% masa del cemento** (no en kg/m³). Los límites
 * legacy en kg/m³ (Tabla 2.3) se mantienen como respaldo para consumidores
 * antiguos hasta que migren.
 *
 *   Cl_total_kg = Σ (Cl_i_pct / 100 × kg_i_m3)              [kg Cl/m³]
 *   Cl_pct_cem  = (Cl_total_kg / cementoKgM3) × 100         [% masa cemento]
 *
 * @param {object} resultado - { agregados, cementoKgM3, aguaLtsM3, tipoArmadura,
 *                               tipoEstructura?, claseExposicion?, qConCloruros? }
 * @param {object} ensayosPorMaterial - { idMaterial → { cloruros: { valor } } }
 */
function calcularClorurosTotalesHormigon(resultado, ensayosPorMaterial) {
  // Legacy kg/m³ (backward compat — versiones anteriores del sistema)
  const LIMITES_CL = {
    PRETENSADO: 0.10,
    ARMADO_SEVERO: 0.20, // exposición B, C, M
    ARMADO: 0.30,
    SIMPLE: 0.60,
  };

  const componentes = [];
  let clTotal = 0;
  let datosIncompletos = false;

  // Aggregates
  if (resultado.agregados) {
    for (const ag of resultado.agregados) {
      const ensayos = ensayosPorMaterial?.[ag.id] || {};
      const clPct = ensayos.cloruros?.valor ?? null;
      const kgM3 = ag.kgM3 || 0;
      let aporte = null;
      if (clPct != null && kgM3 > 0) {
        aporte = (clPct / 100) * kgM3;
        clTotal += aporte;
      } else {
        datosIncompletos = true;
      }
      componentes.push({ nombre: ag.nombre || 'Agregado', tipo: 'agregado', clPct, kgM3, aporte });
    }
  }

  // Cement (Cl rara vez se mide — se marca incompleto)
  const cemKg = resultado.cementoKgM3 || resultado.cementoTotalKgM3 || 0;
  componentes.push({ nombre: 'Cemento', tipo: 'cemento', clPct: null, kgM3: cemKg, aporte: null });
  datosIncompletos = true;

  // Water
  const aguaKg = resultado.aguaLtsM3 || 0;
  componentes.push({ nombre: 'Agua', tipo: 'agua', clPct: null, kgM3: aguaKg, aporte: null });

  // PR8.7 — % masa cemento (CIRSOC §2.2.8 Tabla 2.6)
  const tipoArm = String(resultado.tipoArmadura || 'armado').toUpperCase();
  const tipoEstrCirsoc = resultado.tipoEstructura || (
    tipoArm === 'SIMPLE' ? 'SIN_ARMAR' :
    tipoArm === 'PRETENSADO' ? 'PRETENSADO' :
    'ARMADO_CURADO_NORMAL'
  );
  const claseExpUpper = resultado.claseExposicion ? String(resultado.claseExposicion).toUpperCase() : null;
  const qConCloruros = !!resultado.qConCloruros;

  const limiteCirsoc = limiteClorurosCirsocTabla26(tipoEstrCirsoc, claseExpUpper, qConCloruros);
  const clTotalRedondeado = Math.round(clTotal * 1000) / 1000;
  const clPctMasaCemento = cemKg > 0
    ? Math.round((clTotalRedondeado / cemKg) * 100 * 10000) / 10000
    : null;

  return {
    clTotal: clTotalRedondeado,
    componentes,
    datosIncompletos,
    // Legacy
    limites: LIMITES_CL,
    // PR8.7 — CIRSOC §2.2.8 Tabla 2.6
    clPctMasaCemento,
    limitePctMasaCemento: limiteCirsoc.pctMasaCemento,
    reglaPctMasaCemento: limiteCirsoc.regla,
    fuentePctMasaCemento: limiteCirsoc.fuente,
    tipoEstructuraEvaluado: tipoEstrCirsoc,
    claseExposicionEvaluada: claseExpUpper,
  };
}

/**
 * Build a compact aptitud summary for a single material, suitable for passing
 * into the suggestion engine. Given the material's ensayos and the design
 * context (expuestoDesgaste / aspecto / armadura / subtipo), runs the full
 * aptitud verification and extracts the key numeric values.
 *
 * Returns a lean object the suggestion engine can use to compute a weighted
 * aptitud indicator for each candidate mezcla:
 *
 * {
 *   tipo: 'FINO'|'GRUESO',
 *   estado: 'cumple'|'cumple_con_atencion'|'no_cumple'|'incompleto',
 *   // Numeric values (null when there is no ensayo)
 *   sumaNocivasPct, clorurosPct, pasa200Pct, terronesPct, carbonosasPct, sulfatosPct, salesPct,
 *   // Límites aplicables para el contexto evaluado
 *   limites: { sumaNocivas, cloruros, pasa200, terrones, carbonosas, ... },
 *   // Lista plana de hallazgos para trazabilidad
 *   incumplimientos: string[],
 * }
 *
 * @param {object} material - { tipo: 'FINO'|'GRUESO', subtipoMaterial, ... }
 * @param {object} ensayoMap - mapa { key → { valor, ... } } armado por el service
 * @param {object} ctx - { expuestoDesgaste, aspectoSuperficialImportante, tipoArmadura, claseExposicion, fc }
 */
function buildAptitudSummary(material, ensayoMap, ctx = {}) {
  const tipo = String(material?.tipo || '').toUpperCase();
  const ctxEnriquecido = { ...ctx, subtipoMaterial: material.subtipoMaterial || null };

  const verificacion = tipo === 'FINO'
    ? verificarAptitudAF(ctxEnriquecido, ensayoMap)
    : verificarAptitudAG(ctxEnriquecido, ensayoMap);

  const byKey = {};
  for (const it of (verificacion.items || [])) byKey[it.key] = it;

  const num = (v) => {
    if (v == null) return null;
    const n = Number(String(v).replace(/[<>=\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const incumplimientos = [];
  for (const it of (verificacion.items || [])) {
    if (it.estado === 'no_cumple') {
      incumplimientos.push(`${it.parametro}: ${it.valor ?? '?'} ${it.unidad || ''} (límite ${it.max ?? '?'})`);
    }
  }

  return {
    tipo,
    estado: verificacion.resultadoGlobal,
    sumaNocivasPct: num(byKey.sumaSustanciasNocivas?.valor),
    clorurosPct: num(byKey.cloruros?.valor),
    pasa200Pct: num(byKey.pasante200?.valor),
    terronesPct: num(byKey.terronesArcilla?.valor),
    carbonosasPct: num(byKey.materiasCarb?.valor),
    sulfatosPct: num(byKey.sulfatos?.valor),
    salesPct: num(byKey.salesSolubles?.valor),
    limites: {
      sumaNocivas: byKey.sumaSustanciasNocivas?.max ?? null,
      cloruros: byKey.cloruros?.max ?? null,
      pasa200: byKey.pasante200?.max ?? null,
      terrones: byKey.terronesArcilla?.max ?? null,
      carbonosas: byKey.materiasCarb?.max ?? null,
    },
    incumplimientos,
  };
}

module.exports = {
  resolverLimitesAF,
  verificarAptitudAF,
  resolverLimitesAG,
  verificarAptitudAG,
  calcularClorurosTotalesHormigon,
  buildAptitudSummary,
  // Helpers expuestos para reuso por aptitudPolicyHelper (PR2 multi-contexto).
  // Pertenecen a la API semi-pública del módulo: son funciones puras y sirven
  // a quien necesite reusar la lógica de mapeo / construcción de compliance.
  ctxToUsageContext: _ctxToUsageContext,
  buildItemCompliance: _buildItemCompliance,
  buildAptitudGlobalCompliance: _buildAptitudGlobalCompliance,
};
