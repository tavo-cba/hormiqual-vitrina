'use strict';

/**
 * estadoGlobalConsolidator.js
 *
 * Consolida el estado global de un diseño de dosificación a partir de
 * todas las verificaciones parciales. Fuente única de verdad para estados.
 *
 * Estados globales: APTO | APTO_CON_OBSERVACIONES | NO_APTO | INCOMPLETO
 * Estados de verificación: CUMPLE | CUMPLE_CON_DATOS | NO_CUMPLE | NO_CONCLUYENTE | NO_EVALUADO
 */

const { resolveExpuestoDesgaste } = require('./aptitudCtxHelpers');

const ESTADO_GLOBAL = {
  APTO: 'APTO',
  APTO_OBS: 'APTO_CON_OBSERVACIONES',
  NO_APTO: 'NO_APTO',
  INCOMPLETO: 'INCOMPLETO',
};

const ESTADO_VERIF = {
  CUMPLE: 'CUMPLE',
  CUMPLE_CON_DATOS: 'CUMPLE_CON_DATOS',
  NO_CUMPLE: 'NO_CUMPLE',
  NO_CONCLUYENTE: 'NO_CONCLUYENTE',
  NO_EVALUADO: 'NO_EVALUADO',
};

/**
 * Consolida el estado global de aptitud de un material individual.
 * @param {Array} items - Array de { estado, parametro, ... }
 * @returns {{ estado, resumen, detalles }}
 */
function consolidarAptitudMaterial(items) {
  if (!items || items.length === 0) return { estado: ESTADO_VERIF.NO_EVALUADO, resumen: 'Sin verificaciones disponibles.', detalles: [] };

  let cumple = 0, noCumple = 0, noConcluyente = 0, sinDato = 0, informativo = 0;
  const detalles = [];

  for (const it of items) {
    const est = (it.estado || '').toLowerCase();
    if (est === 'cumple') cumple++;
    else if (est === 'no_cumple') { noCumple++; detalles.push(`No cumple: ${it.parametro || it.key || '?'}`); }
    else if (est === 'no_concluyente') { noConcluyente++; detalles.push(`No concluyente: ${it.parametro || it.key || '?'}`); }
    else if (est === 'sin_dato' || est === 'pendiente') { sinDato++; detalles.push(`Sin dato: ${it.parametro || it.key || '?'}`); }
    else if (est === 'informativo') informativo++;
    else sinDato++;
  }

  const total = cumple + noCumple + noConcluyente + sinDato;
  let estado, resumen;

  if (noCumple > 0) {
    estado = ESTADO_VERIF.NO_CUMPLE;
    resumen = `No cumple: ${noCumple} requisito(s) incumplido(s) de ${total} verificado(s).`;
  } else if (noConcluyente > 0 || sinDato > 0) {
    estado = 'CUMPLE_CON_OBSERVACIONES';
    const parts = [];
    if (cumple > 0) parts.push(`${cumple} cumple(n)`);
    if (noConcluyente > 0) parts.push(`${noConcluyente} no concluyente(s)`);
    if (sinDato > 0) parts.push(`${sinDato} sin dato`);
    resumen = `Cumple con observaciones: ${parts.join('; ')}.`;
  } else if (cumple > 0) {
    estado = ESTADO_VERIF.CUMPLE;
    resumen = `Cumple: ${cumple} requisito(s) verificado(s).`;
  } else {
    estado = ESTADO_VERIF.NO_EVALUADO;
    resumen = 'Sin verificaciones concluyentes.';
  }

  return { estado, resumen, detalles, conteo: { cumple, noCumple, noConcluyente, sinDato, informativo } };
}

/**
 * Consolida el estado de cloruros globales del hormigón.
 * @param {{ clConocido, clTotal, componentes, componentesND, limite, esParcial }}
 * @returns {{ estado, resumen }}
 */
function consolidarClorurosGlobal({ clConocido, limite, componentesND, esParcial }) {
  if (clConocido == null || limite == null) return { estado: ESTADO_VERIF.NO_EVALUADO, resumen: 'No se dispone de datos suficientes para evaluar cloruros globales.' };

  if (clConocido > limite) {
    return { estado: ESTADO_VERIF.NO_CUMPLE, resumen: `No cumple: Cl total ${clConocido.toFixed(3)} kg/m\u00b3 supera el l\u00edmite de ${limite.toFixed(2)} kg/m\u00b3.` };
  }

  if (esParcial || (componentesND && componentesND.length > 0)) {
    const ndList = (componentesND || []).join(', ') || 'algunos componentes';
    return {
      estado: ESTADO_VERIF.CUMPLE_CON_DATOS,
      resumen: `Cumple con datos disponibles: Cl total calculado ${clConocido.toFixed(3)} kg/m\u00b3 (l\u00edmite ${limite.toFixed(2)} kg/m\u00b3). Componentes sin dato expl\u00edcito: ${ndList}.`,
    };
  }

  return { estado: ESTADO_VERIF.CUMPLE, resumen: `Cumple: Cl total ${clConocido.toFixed(3)} kg/m\u00b3 dentro del l\u00edmite de ${limite.toFixed(2)} kg/m\u00b3.` };
}

/**
 * PR8.7 — Cloruros máximos en hormigón endurecido (CIRSOC §2.2.8 Tabla 2.6).
 *
 * La cita canónica vigente es CIRSOC 200:2024 §2.2.8 Tabla 2.6, que expresa
 * los límites en **% masa del cemento** (no en kg/m³ como las versiones
 * anteriores del sistema). Tabla 2.6 reagrupa por clase de exposición:
 *
 *   - SIN_ARMAR (cualquier clase): 1.20%
 *   - ARMADO_CURADO_NORMAL en CL1/CL2/M1/M2/M3/C2: 0.15%
 *   - ARMADO_CURADO_NORMAL en A1/A2/A3/C1/Q1/Q2/Q3/Q4: 0.30%
 *   - ARMADO_CURADO_VAPOR (cualquier clase): 0.10%
 *   - PRETENSADO (cualquier clase): 0.06%
 *   - Q1-Q4 con cloruros en suelos → reducir a 0.15%
 *
 * Devuelve la tabla completa de límites por par (tipoEstructura × claseExp).
 *
 * @param {string} tipoEstructura - 'SIN_ARMAR'|'ARMADO_CURADO_NORMAL'|'ARMADO_CURADO_VAPOR'|'PRETENSADO'
 * @param {string} claseExposicion - 'A1'|'A2'|'A3'|'CL1'|'CL2'|'M1'|'M2'|'M3'|'C1'|'C2'|'Q1'|'Q2'|'Q3'|'Q4'
 * @param {boolean} qConCloruros - true si claseExp es Q* y suelos con cloruros (reduce a 0.15)
 * @returns {{ pctMasaCemento: number, regla: string, fuente: string }}
 */
function limiteClorurosCirsocTabla26(tipoEstructura, claseExposicion, qConCloruros = false) {
  const tipo = String(tipoEstructura || '').toUpperCase();
  const clase = String(claseExposicion || '').toUpperCase();

  if (tipo === 'SIN_ARMAR') {
    return { pctMasaCemento: 1.20, regla: 'Sin armar — cualquier clase', fuente: 'CIRSOC 200:2024 §2.2.8 Tabla 2.6' };
  }
  if (tipo === 'PRETENSADO') {
    return { pctMasaCemento: 0.06, regla: 'Pretensado — cualquier clase', fuente: 'CIRSOC 200:2024 §2.2.8 Tabla 2.6' };
  }
  if (tipo === 'ARMADO_CURADO_VAPOR') {
    return { pctMasaCemento: 0.10, regla: 'Armado con curado a vapor — cualquier clase', fuente: 'CIRSOC 200:2024 §2.2.8 Tabla 2.6' };
  }
  // ARMADO_CURADO_NORMAL — depende de clase de exposición
  const exigentesArmadoNormal = ['CL1', 'CL2', 'M1', 'M2', 'M3', 'C2'];
  if (exigentesArmadoNormal.includes(clase)) {
    return { pctMasaCemento: 0.15, regla: `Armado curado normal en ${clase} (clase con cloruros/marina/congelación con sales)`, fuente: 'CIRSOC 200:2024 §2.2.8 Tabla 2.6' };
  }
  // Q* + cloruros en suelos → reducir a 0.15
  if (qConCloruros && ['Q1', 'Q2', 'Q3', 'Q4'].includes(clase)) {
    return { pctMasaCemento: 0.15, regla: `Armado curado normal en ${clase} con cloruros en suelos (reducción §2.2.8)`, fuente: 'CIRSOC 200:2024 §2.2.8' };
  }
  // Default armado curado normal
  return { pctMasaCemento: 0.30, regla: `Armado curado normal en ${clase || 'sin clase'} (default Tabla 2.6)`, fuente: 'CIRSOC 200:2024 §2.2.8 Tabla 2.6' };
}

/**
 * Computa el estado de cloruros solubles totales en el hormigón con lógica
 * worst-case para componentes sin dato (cemento + agua).
 *
 * Reproduce la lógica que antes vivía solo en el frontend PDF generator
 * (dosificacionInformePdf.js, sección "Cloruros solubles totales").
 *
 * PR8.7 — además del cálculo legacy en kg/m³, se reportan los campos nuevos
 * `clPctMasaCemento`, `clPctMasaCementoMax`, `limitePctMasaCemento` (CIRSOC
 * §2.2.8 Tabla 2.6) cuando se proveen `claseExposicion` y `tipoEstructura`.
 *
 * @param {object} opts
 *   - aptitudVerificaciones: array de { tipoAgregado, items: [{ key|ensayoCodigo|parametro, valor, estado }] }
 *   - agregadosDosif: array de { nombre, kgM3, tipo|tipoAgregado, moduloFinura }
 *   - cementoKgM3: number
 *   - aguaKgM3: number
 *   - tipoArmadura: 'simple'|'armado'|'pretensado'  (legacy, mapea a tipoEstructura)
 *   - tipoEstructura: 'SIN_ARMAR'|'ARMADO_CURADO_NORMAL'|'ARMADO_CURADO_VAPOR'|'PRETENSADO' (PR8.7)
 *   - claseExposicion: clase CIRSOC §2.2.4 (PR8.7)
 *   - qConCloruros: boolean (PR8.7)
 * @returns {{ estado, resumen, clTotalParcial, clTotalMax, limite, componentesND, clPctMasaCemento?, limitePctMasaCemento?, ... }}
 */
function computeClorurosGlobal({
  aptitudVerificaciones, agregadosDosif, cementoKgM3, aguaKgM3, tipoArmadura,
  tipoEstructura, claseExposicion, qConCloruros,    // PR8.7
}) {
  if (!aptitudVerificaciones?.length || !agregadosDosif?.length) {
    return { estado: ESTADO_VERIF.NO_EVALUADO, resumen: 'Sin datos para evaluar cloruros globales.' };
  }

  const tipoArm = String(tipoArmadura || 'armado').toUpperCase();
  // Legacy limit en kg/m³ (mantenido por backward-compat con tests existentes
  // y consumidores que aún no migraron a Tabla 2.6).
  const limite = tipoArm === 'PRETENSADO' ? 0.10 : tipoArm === 'SIMPLE' ? 0.60 : 0.30;
  const limiteLabel = tipoArm === 'PRETENSADO' ? 'pretensado' : tipoArm === 'SIMPLE' ? 'simple' : 'armado';

  // PR8.7 — Mapeo de tipoArmadura legacy a tipoEstructura CIRSOC si no se provee:
  //   'simple'     → SIN_ARMAR
  //   'armado'     → ARMADO_CURADO_NORMAL
  //   'pretensado' → PRETENSADO
  const tipoEstrCirsoc = tipoEstructura || (
    tipoArm === 'SIMPLE' ? 'SIN_ARMAR' :
    tipoArm === 'PRETENSADO' ? 'PRETENSADO' :
    'ARMADO_CURADO_NORMAL'
  );
  const claseExpUpper = claseExposicion ? String(claseExposicion).toUpperCase() : null;

  // Map Cl% por tipo de agregado
  const clByTipo = {};
  for (const v of aptitudVerificaciones) {
    const clItem = (v.items || []).find(it => {
      const k = String(it.codigo || it.key || it.ensayoCodigo || it.parametro || '').toUpperCase();
      return k.includes('CLORURO') || k.includes('CHLOR') || k === 'CL';
    });
    if (clItem?.valor != null) {
      const tipo = String(v.tipoAgregado || '').toUpperCase();
      const esMenor = clItem.estado === 'no_concluyente'
        || String(clItem.valor).startsWith('<')
        || (typeof clItem.valor === 'string' && clItem.valor.includes('<'));
      const esMayor = String(clItem.valor).startsWith('>')
        || (typeof clItem.valor === 'string' && clItem.valor.includes('>'));
      const operador = esMenor ? 'menor_que' : esMayor ? 'mayor_que' : null;
      if (!clByTipo[tipo]) {
        clByTipo[tipo] = {
          valor: Number(String(clItem.valor).replace(/[<>=\s]/g, '')),
          operador,
        };
      }
    }
  }

  let clTotal = 0;
  const componentesND = [];
  for (const ag of agregadosDosif) {
    let clPct = null;
    const agName = String(ag.nombre || '').toLowerCase();

    // Matching por verificaciones (ID → name → tipo)
    for (const v of aptitudVerificaciones) {
      const vName = String(v.agregadoNombre || v.nombreMaterial || '').toLowerCase();
      const nameMatch = agName && vName && (agName === vName || agName.includes(vName) || vName.includes(agName));
      if (nameMatch) {
        for (const it of (v.items || [])) {
          const itId = String(it.codigo || it.key || it.ensayoCodigo || it.parametro || '').toUpperCase();
          if (itId.includes('CLORURO') || itId.includes('CHLOR') || itId === 'CLORUROS') {
            clPct = it.valor ?? null;
            if (clPct != null) { clPct = Number(String(clPct).replace(/[<>=\s]/g, '')); break; }
          }
        }
        if (clPct != null) break;
      }
    }
    // Fallback por tipo FINO/GRUESO
    if (clPct == null) {
      const agTipo = String(ag.tipo || ag.tipoAgregado || '').toUpperCase();
      const isFino = agTipo === 'FINO' || (ag.moduloFinura != null && ag.moduloFinura < 4)
        || agName.includes('arena') || agName.includes('sand');
      const tipo = isFino ? 'FINO' : 'GRUESO';
      if (clByTipo[tipo]) clPct = clByTipo[tipo].valor;
    }
    const kgM3 = ag.kgM3 || 0;
    const aporte = (clPct != null && kgM3 > 0) ? (clPct / 100) * kgM3 : null;
    if (aporte != null) clTotal += aporte;
    else componentesND.push(ag.nombre || 'agregado');
  }

  // Cemento + agua: siempre N/D. Worst-case: Cl = 0,010%.
  const CL_ASUMIDO_ND = 0.010;
  const cemKg = cementoKgM3 || 0;
  const aguaKg = aguaKgM3 || 0;
  componentesND.push('cemento', 'agua');

  const clTotalParcial = Math.round(clTotal * 1000) / 1000;
  const clAporteND = (CL_ASUMIDO_ND / 100) * (cemKg + aguaKg);
  const clTotalMax = Math.round((clTotal + clAporteND) * 1000) / 1000;

  // PR8.7 \u2014 % masa cemento (CIRSOC \u00a72.2.8 Tabla 2.6)
  const limiteCirsoc = limiteClorurosCirsocTabla26(tipoEstrCirsoc, claseExpUpper, qConCloruros);
  const limitePctMasaCemento = limiteCirsoc.pctMasaCemento;
  const reglaPct = limiteCirsoc.regla;
  const fuentePct = limiteCirsoc.fuente;
  const clPctMasaCemento = cemKg > 0 ? Math.round((clTotalParcial / cemKg) * 100 * 10000) / 10000 : null;
  const clPctMasaCementoMax = cemKg > 0 ? Math.round((clTotalMax / cemKg) * 100 * 10000) / 10000 : null;

  // Estado primario: usar % masa cemento si hay cemKg y claseExposicion \u2192 fuente can\u00f3nica CIRSOC.
  // Fallback al legacy kg/m\u00b3 si no hay datos para el c\u00e1lculo CIRSOC.
  let estado, resumen;
  const evaluarPorPct = cemKg > 0 && claseExpUpper && clPctMasaCemento != null;

  if (evaluarPorPct) {
    if (clPctMasaCemento > limitePctMasaCemento) {
      estado = ESTADO_VERIF.NO_CUMPLE;
      resumen = `Cl total parcial ${clPctMasaCemento.toFixed(3)}% del cemento excede el l\u00edmite de ${limitePctMasaCemento.toFixed(2)}% (${reglaPct}). [${fuentePct}]`;
    } else if (clPctMasaCementoMax != null && clPctMasaCementoMax <= limitePctMasaCemento) {
      estado = ESTADO_VERIF.CUMPLE;
      resumen = `Cumple incluso con estimaci\u00f3n conservadora: Cl m\u00e1x. estimado ${clPctMasaCementoMax.toFixed(3)}% del cemento <= l\u00edmite ${limitePctMasaCemento.toFixed(2)}% (${reglaPct}). [${fuentePct}]`;
    } else {
      estado = ESTADO_VERIF.CUMPLE_CON_DATOS;
      resumen = `Cumple con datos disponibles: Cl parcial ${clPctMasaCemento.toFixed(3)}% del cemento <= l\u00edmite ${limitePctMasaCemento.toFixed(2)}% (${reglaPct}), pero Cl m\u00e1x. estimado ${clPctMasaCementoMax?.toFixed(3) ?? '?'}% supera el l\u00edmite asumiendo 0,010% para componentes sin dato (${componentesND.join(', ')}). [${fuentePct}]`;
    }
  } else {
    // Legacy kg/m\u00b3 fallback (sin claseExposicion o sin cemKg)
    if (clTotalParcial > limite) {
      estado = ESTADO_VERIF.NO_CUMPLE;
      resumen = `Cl total parcial ${clTotalParcial.toFixed(3)} kg/m\u00b3 excede el l\u00edmite de ${limite.toFixed(2)} kg/m\u00b3 (${limiteLabel}).`;
    } else if (clTotalMax <= limite) {
      estado = ESTADO_VERIF.CUMPLE;
      resumen = `Cumple incluso con estimaci\u00f3n conservadora: Cl m\u00e1x. estimado ${clTotalMax.toFixed(3)} kg/m\u00b3 <= l\u00edmite ${limite.toFixed(2)} kg/m\u00b3 (${limiteLabel}).`;
    } else {
      estado = ESTADO_VERIF.CUMPLE_CON_DATOS;
      resumen = `Cumple con datos disponibles: Cl parcial ${clTotalParcial.toFixed(3)} kg/m\u00b3 <= l\u00edmite ${limite.toFixed(2)} kg/m\u00b3 (${limiteLabel}), pero Cl m\u00e1x. estimado ${clTotalMax.toFixed(3)} kg/m\u00b3 supera el l\u00edmite asumiendo 0,010% para componentes sin dato (${componentesND.join(', ')}).`;
    }
  }

  return {
    estado,
    resumen,
    // Legacy kg/m\u00b3 (backward compat)
    clTotalParcial,
    clTotalMax,
    limite,
    componentesND,
    // PR8.7 \u2014 CIRSOC \u00a72.2.8 Tabla 2.6 (% masa cemento)
    clPctMasaCemento,
    clPctMasaCementoMax,
    limitePctMasaCemento,
    reglaPctMasaCemento: reglaPct,
    fuentePctMasaCemento: fuentePct,
    tipoEstructuraEvaluado: tipoEstrCirsoc,
    claseExposicionEvaluada: claseExpUpper,
  };
}

/**
 * Consolida el estado global del diseño de dosificación.
 * @param {Object} params
 * @param {Array} params.aptitudMateriales - Array de { estado, nombre }
 * @param {Object} params.clorurosGlobal - { estado }
 * @param {Object} params.trabajabilidad - { coherencia, zona }
 * @param {Object} params.verificacionesCIRSOC - { pulverulento: { cumple } }
 * @param {boolean} params.curvaFallback - si la curva de cemento es fallback
 * @param {string} params.origenS - origen del desvío estándar
 * @param {boolean} params.validacionExperimentalPendiente
 * @returns {{ estado, motivos, resumen }}
 */
function consolidarEstadoGlobal(params) {
  // Motivos clasificados por prioridad: bloqueantes > incompletos > observaciones
  const motivosBloqueantes = [];
  const motivosIncompletos = [];
  const motivosObservaciones = [];
  let hayNoCumpleBloqueante = false;
  let hayObservaciones = false;
  let hayIncompleto = false;

  // 1. Aptitud de materiales
  const aptitudes = params.aptitudMateriales || [];
  for (const apt of aptitudes) {
    if (apt.estado === ESTADO_VERIF.NO_CUMPLE) {
      hayNoCumpleBloqueante = true;
      motivosBloqueantes.push(`Material \u201c${apt.nombre}\u201d: no cumple requisitos normativos.`);
    } else if (apt.estado === 'CUMPLE_CON_OBSERVACIONES' || apt.estado === ESTADO_VERIF.NO_CONCLUYENTE) {
      hayObservaciones = true;
      motivosObservaciones.push(`Material \u201c${apt.nombre}\u201d: cumple con observaciones.`);
    } else if (apt.estado === ESTADO_VERIF.NO_EVALUADO) {
      hayIncompleto = true;
      motivosIncompletos.push(`Material \u201c${apt.nombre}\u201d: sin verificación completa.`);
    }
  }

  // 2. Cloruros globales
  const cl = params.clorurosGlobal;
  if (cl) {
    if (cl.estado === ESTADO_VERIF.NO_CUMPLE) {
      hayNoCumpleBloqueante = true;
      motivosBloqueantes.push('Cloruros globales del hormigón: no cumple.');
    } else if (cl.estado === ESTADO_VERIF.CUMPLE_CON_DATOS) {
      hayObservaciones = true;
      motivosObservaciones.push('Cloruros globales informados con datos disponibles.');
    } else if (cl.estado === ESTADO_VERIF.NO_CONCLUYENTE || cl.estado === ESTADO_VERIF.NO_EVALUADO) {
      hayIncompleto = true;
      motivosIncompletos.push('Cloruros globales: datos insuficientes.');
    }
  }

  // 3. Verificaciones CIRSOC
  const cirsoc = params.verificacionesCIRSOC;
  if (cirsoc?.pulverulento && !cirsoc.pulverulento.cumple) {
    hayNoCumpleBloqueante = true;
    motivosBloqueantes.push('Material pulverulento no alcanza el mínimo CIRSOC 200:2024.');
  }
  if (cirsoc?.aire && cirsoc.aire.cumple === false) {
    hayNoCumpleBloqueante = true;
    motivosBloqueantes.push('Contenido de aire no cumple requerimiento CIRSOC 200:2024.');
  }

  // 4. Curva de cemento fallback
  if (params.curvaFallback) {
    hayObservaciones = true;
    motivosObservaciones.push('Relación a/c estimada con curva genérica ICPA (sin curva del fabricante).');
  }

  // 5. Trabajabilidad — discrepancia
  if (params.trabajabilidad?.coherencia && params.trabajabilidad.coherencia !== 'coherente') {
    hayObservaciones = true;
    motivosObservaciones.push('Análisis de trabajabilidad con discrepancia respecto al objetivo.');
  }

  // 6. Validación experimental
  if (params.validacionExperimentalPendiente !== false) {
    hayObservaciones = true;
    motivosObservaciones.push('Validación experimental pendiente.');
  }

  // 7. Origen de S (menor — solo marca flag, no agrega motivo propio)
  if (params.origenS === 'E' || !params.origenS) {
    hayObservaciones = true;
  }

  // Consolidar estado
  let estado;
  if (hayNoCumpleBloqueante) {
    estado = ESTADO_GLOBAL.NO_APTO;
  } else if (hayIncompleto) {
    estado = ESTADO_GLOBAL.INCOMPLETO;
  } else if (hayObservaciones) {
    estado = ESTADO_GLOBAL.APTO_OBS;
  } else {
    estado = ESTADO_GLOBAL.APTO;
  }

  // Armar lista de motivos priorizada: bloqueantes primero, luego incompletos, luego observaciones.
  // Máximo 6 motivos para no sobrecargar la portada.
  const motivosOrdenados = [...motivosBloqueantes, ...motivosIncompletos, ...motivosObservaciones];
  const motivosTop = motivosOrdenados.slice(0, 6);

  return { estado, motivos: motivosTop, resumen: `${estado}: ${motivosTop.length > 0 ? motivosTop.join(' ') : 'Sin observaciones.'}` };
}

/* ════════════════════════════════════════════════════════════════════════════
   MODELO PRESTACIONAL MULTI-EJE (filosofía 2026)
   ════════════════════════════════════════════════════════════════════════════
   El consolidador legacy `consolidarEstadoGlobal` queda intacto para no romper
   consumidores existentes. `buildAssessment` produce un modelo paralelo de
   5 ejes que reclasifica los hallazgos por severidad técnica real.

   PRINCIPIO: una no conformidad normativa NO implica automáticamente
   "bloqueado" ni "no recomendado". El bloqueo se reserva para incompatibilidad
   real (mezcla suspendida, cloruros excedidos en hormigón final, riesgo de
   durabilidad/seguridad/contractual).

   Toda la información sigue siendo visible: nada se omite, nada se suaviza.
   Solo cambia su INTERPRETACIÓN y COMUNICACIÓN.

   Esta lógica es el espejo backend de `buildAssessment` en el PDF generator
   (dosificacionInformePdf.js). Mantenerlas sincronizadas.
   ════════════════════════════════════════════════════════════════════════════ */

const SEVERITY = {
  INFO: 'info',
  OBS: 'obs',
  CONDICION: 'condicion',
  DESVIO_NORM: 'desvio_norm',
  RIESGO: 'riesgo',
  BLOQ: 'bloq',
};

const ESTADO_GENERAL = {
  EN_EVALUACION:    'EN_EVALUACION',
  EN_VALIDACION:    'EN_VALIDACION',
  CONDICIONADO:     'CONDICIONADO',
  VALIDADO:         'VALIDADO',
  REQUIERE_AJUSTE:  'REQUIERE_AJUSTE',
  BLOQUEADO:        'BLOQUEADO',
};

const CONFORMIDAD_NORMATIVA = {
  CONFORME:        'CONFORME',
  CON_DESVIOS:     'CON_DESVIOS',
  NO_CONFORME:     'NO_CONFORME',
  NO_CONCLUYENTE:  'NO_CONCLUYENTE',
};

const VIABILIDAD_TECNICA = {
  FAVORABLE:               'FAVORABLE',
  POTENCIALMENTE_VIABLE:   'POTENCIALMENTE_VIABLE',
  CONDICIONADA:            'CONDICIONADA',
  RIESGO_ALTO:             'RIESGO_ALTO',
  NO_RECOMENDADA:          'NO_RECOMENDADA',
};

const NECESIDAD_VALIDACION = {
  TEORICO:                 'TEORICO',
  REQUIERE_PASTON:         'REQUIERE_PASTON',
  VERIFICACION_REFORZADA:  'VERIFICACION_REFORZADA',
  VALIDADO_EXP:            'VALIDADO_EXP',
  VALIDADO_PROD:           'VALIDADO_PROD',
};

const LIBERACION_ESTADO = {
  LIBERABLE:           'LIBERABLE',
  CONDICIONAL:         'CONDICIONAL',
  PENDIENTE_EVIDENCIA: 'PENDIENTE_EVIDENCIA',
  NO_LIBERABLE_AUN:    'NO_LIBERABLE_AUN',
};

/**
 * Construye una evaluación multi-eje a partir de los datos crudos del cálculo.
 * Reproduce la lógica del frontend (`buildAssessment` en dosificacionInformePdf.js)
 * para que cualquier consumidor del backend (alertas, dashboards, API externa)
 * obtenga el mismo modelo.
 *
 * @param {object} input
 *   - mezclaBase: { estado, estadoTecnico } (release + band conformity)
 *   - aptitudMateriales: array de { tipoAgregado, agregadoNombre, items: [{key,parametro,valor,estado}] }
 *   - expuestoDesgaste: boolean
 *   - clorurosGlobal: { estado } (CUMPLE | CUMPLE_CON_DATOS | NO_CUMPLE | NO_CONCLUYENTE | NO_EVALUADO)
 *   - verificacionesCIRSOC: { pulverulento: { cumple }, aire: { cumple } }
 *   - curvaFallback: boolean
 *   - trabajabilidad: { coherencia: 'coherente'|'fda_alto'|'fda_bajo', mensaje? }
 *   - validacionExperimentalPendiente: boolean
 *   - tieneVerifReal: boolean (snapshot.verificacionAprobacion?.parametros)
 *   - reportMode: 'PRESTACIONAL' (default) | 'NORMATIVO_ESTRICTO'
 */
function buildAssessment(input = {}) {
  const reportMode = input.reportMode === 'NORMATIVO_ESTRICTO' ? 'NORMATIVO_ESTRICTO' : 'PRESTACIONAL';
  const findings = [];
  const fortalezas = [];

  const cleanName = (n) => String(n || '').replace(/["«»]/g, '').replace(/\s+/g, ' ').trim();

  // (A) Mezcla base — release state
  const mezclaEstado = String(input.mezclaBase?.estado || '').toUpperCase();
  const mezclaLiberada = mezclaEstado === 'APROBADO' || mezclaEstado === 'EN_PRODUCCION';
  const mezclaRetirada = mezclaEstado === 'SUSPENDIDO' || mezclaEstado === 'ARCHIVADO';
  if (mezclaRetirada) {
    findings.push({
      severity: SEVERITY.BLOQ,
      mensaje: `Mezcla granular base ${mezclaEstado.toLowerCase()}: el material no está disponible para producción. Reemplazar por una mezcla activa antes de utilizar este diseño.`,
    });
  } else if (mezclaEstado && !mezclaLiberada) {
    const estadoReadable = mezclaEstado === 'BORRADOR' ? 'borrador'
      : mezclaEstado === 'A_PRUEBA' ? 'a prueba'
      : mezclaEstado === 'PENDIENTE_REVISION' ? 'pendiente de revisión'
      : mezclaEstado.toLowerCase();
    findings.push({
      severity: SEVERITY.CONDICION,
      mensaje: `Mezcla granular base en estado ${estadoReadable}: el diseño es teórico y no se libera para producción hasta aprobar la mezcla. La condición es de liberación, no de viabilidad técnica.`,
    });
  } else if (mezclaLiberada) {
    fortalezas.push('Mezcla granular base aprobada y liberada para uso.');
  }

  // (B) Mezcla base — band conformity
  const mezclaEstadoTecnico = input.mezclaBase?.estadoTecnico;
  if (mezclaEstadoTecnico === 'NO_CUMPLE') {
    findings.push({
      severity: SEVERITY.DESVIO_NORM,
      mensaje: 'Mezcla granular base con desvíos respecto de la banda IRAM 1627. El desempeño del esqueleto árido debe respaldarse con pastón de prueba; el desvío normativo no implica inviabilidad técnica per se.',
    });
  } else if (mezclaEstadoTecnico === 'REQUIERE_AJUSTE') {
    findings.push({
      severity: SEVERITY.DESVIO_NORM,
      mensaje: 'Mezcla granular base con tamices puntuales fuera de banda IRAM 1627. Gestionable con pastón de prueba y, eventualmente, aceptación técnica del desvío.',
    });
  } else if (mezclaEstadoTecnico === 'CUMPLE_OBS') {
    findings.push({
      severity: SEVERITY.OBS,
      mensaje: 'Mezcla granular base cumple con observaciones (desvíos menores en banda granulométrica).',
    });
  } else if (mezclaEstadoTecnico === 'CUMPLE') {
    // Nota: `CUMPLE` puede corresponder a A-B (estricto) o a A-C (más permisivo).
    // Para no exagerar el cumplimiento cuando el tier real es A-C, usamos un
    // wording neutro que no afirma "sin observaciones". El frontend replica el
    // mismo wording en su `buildAssessment` de fallback.
    fortalezas.push('Mezcla granular base dentro de banda IRAM 1627.');
  }

  // (C) Suma de sustancias nocivas en agregado fino
  // Auditoría 2026-05-08 (X2): el flag explícito `expuestoDesgaste` puede
  // llegar `false` aunque la tipología implique desgaste (ej. pavimento
  // rígido). Sincronizamos con `aptitudMaterialesService` usando el helper
  // canónico para evitar mensajes contradictorios sobre el mismo material
  // en el mismo PDF.
  const expuesto = resolveExpuestoDesgaste(input);
  const aptitud = input.aptitudMateriales || [];
  for (const verif of aptitud) {
    if (verif.tipoAgregado !== 'FINO') continue;
    for (const it of (verif.items || [])) {
      const key = String(it.key || it.parametro || '').toLowerCase();
      if (!key.includes('suma') || !key.includes('nociv')) continue;
      const valor = Number(it.valor);
      if (!Number.isFinite(valor)) continue;
      const nombreAg = cleanName(verif.agregadoNombre);
      const valorFmt = valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (valor > 7.0 && expuesto) {
        findings.push({
          severity: SEVERITY.RIESGO,
          mensaje: `Agregado fino «${nombreAg}»: suma de sustancias nocivas ${valorFmt}% supera ambos límites IRAM 1512 (5,0% con desgaste / 7,0% sin desgaste). Riesgo técnico relevante; requiere sustitución o tratamiento del fino.`,
        });
      } else if (valor > 5.0 && expuesto) {
        findings.push({
          severity: SEVERITY.DESVIO_NORM,
          mensaje: `Agregado fino «${nombreAg}»: suma de sustancias nocivas ${valorFmt}% supera el límite IRAM 1512 de 5,0% para destinos con desgaste superficial. Su uso queda condicionado a aceptación técnica del desvío y a validación experimental específica para el destino declarado.`,
        });
      } else if (valor > 5.0 && !expuesto) {
        findings.push({
          severity: SEVERITY.OBS,
          mensaje: `Agregado fino «${nombreAg}»: suma de sustancias nocivas ${valorFmt}% dentro del límite de 7,0% para destinos sin desgaste superficial. No utilizar en pavimentos sin sustitución.`,
        });
      }
    }
  }

  // (D) Cloruros del hormigón final
  const cl = input.clorurosGlobal;
  if (cl) {
    if (cl.estado === ESTADO_VERIF.NO_CUMPLE) {
      findings.push({ severity: SEVERITY.RIESGO, mensaje: cl.resumen || 'Cloruros del hormigón: no cumple límite CIRSOC.' });
    } else if (cl.estado === ESTADO_VERIF.CUMPLE_CON_DATOS) {
      findings.push({ severity: SEVERITY.OBS, mensaje: cl.resumen || 'Cloruros globales verificados con estimación conservadora.' });
    } else if (cl.estado === ESTADO_VERIF.NO_CONCLUYENTE || cl.estado === ESTADO_VERIF.NO_EVALUADO) {
      findings.push({ severity: SEVERITY.OBS, mensaje: cl.resumen || 'Cloruros globales: datos insuficientes para evaluación concluyente.' });
    }
  }

  // (E) Verificaciones CIRSOC (pulverulento, aire)
  const cirsoc = input.verificacionesCIRSOC;
  if (cirsoc?.pulverulento && cirsoc.pulverulento.cumple === false) {
    findings.push({ severity: SEVERITY.DESVIO_NORM, mensaje: 'Material pulverulento por debajo del mínimo CIRSOC 200:2024.' });
  }
  if (cirsoc?.aire && cirsoc.aire.cumple === false) {
    findings.push({ severity: SEVERITY.DESVIO_NORM, mensaje: 'Contenido de aire fuera de la tolerancia CIRSOC 200:2024.' });
  }

  // (F) Curva del cemento fallback
  if (input.curvaFallback) {
    findings.push({ severity: SEVERITY.OBS, mensaje: 'Relación a/c estimada con curva genérica ICPA (sin curva del fabricante).' });
  }

  // (G) Trabajabilidad — discrepancia FdA
  const trab = input.trabajabilidad;
  const cohEstado = typeof trab?.coherencia === 'object' ? trab.coherencia.estado : trab?.coherencia;
  if (cohEstado === 'fda_alto' || cohEstado === 'fda_bajo') {
    findings.push({ severity: SEVERITY.OBS, mensaje: 'FdA sugiere asentamiento fuera del objetivo. Considerar ajuste de finos, cementante o aditivo.' });
  }

  // (H) Validación experimental
  if (input.validacionExperimentalPendiente !== false) {
    findings.push({ severity: SEVERITY.OBS, mensaje: 'Validación experimental pendiente.' });
  }

  // ── Buckets por severidad ──
  const bucket = (s) => findings.filter(f => f.severity === s).map(f => f.mensaje);
  const bloqueantes = bucket(SEVERITY.BLOQ);
  const riesgos = bucket(SEVERITY.RIESGO);
  const desvios = bucket(SEVERITY.DESVIO_NORM);
  const condicionantes = bucket(SEVERITY.CONDICION);
  const observaciones = [...bucket(SEVERITY.OBS), ...bucket(SEVERITY.INFO)];

  // ── Derivación de los 5 ejes ──
  let conformidadNormativa;
  if (bloqueantes.length || riesgos.length) conformidadNormativa = CONFORMIDAD_NORMATIVA.NO_CONFORME;
  else if (desvios.length) conformidadNormativa = CONFORMIDAD_NORMATIVA.CON_DESVIOS;
  else if (observaciones.some(o => /no concluyente|sin dato/i.test(o))) conformidadNormativa = CONFORMIDAD_NORMATIVA.NO_CONCLUYENTE;
  else conformidadNormativa = CONFORMIDAD_NORMATIVA.CONFORME;

  let viabilidadTecnica;
  if (bloqueantes.length) viabilidadTecnica = VIABILIDAD_TECNICA.NO_RECOMENDADA;
  else if (riesgos.length) viabilidadTecnica = VIABILIDAD_TECNICA.RIESGO_ALTO;
  else if (desvios.length >= 2) viabilidadTecnica = VIABILIDAD_TECNICA.CONDICIONADA;
  else if (desvios.length === 1) viabilidadTecnica = VIABILIDAD_TECNICA.POTENCIALMENTE_VIABLE;
  else if (condicionantes.length || observaciones.length) viabilidadTecnica = VIABILIDAD_TECNICA.POTENCIALMENTE_VIABLE;
  else viabilidadTecnica = VIABILIDAD_TECNICA.FAVORABLE;

  let necesidadValidacion;
  if (bloqueantes.length || riesgos.length) necesidadValidacion = NECESIDAD_VALIDACION.VERIFICACION_REFORZADA;
  else if (input.tieneVerifReal && !desvios.length) necesidadValidacion = NECESIDAD_VALIDACION.VALIDADO_EXP;
  else necesidadValidacion = NECESIDAD_VALIDACION.REQUIERE_PASTON;

  let liberacion;
  if (bloqueantes.length) liberacion = LIBERACION_ESTADO.NO_LIBERABLE_AUN;
  else if (mezclaEstado && !mezclaLiberada) liberacion = LIBERACION_ESTADO.NO_LIBERABLE_AUN;
  else if (riesgos.length) liberacion = LIBERACION_ESTADO.NO_LIBERABLE_AUN;
  else if (desvios.length) liberacion = LIBERACION_ESTADO.CONDICIONAL;
  else if (necesidadValidacion === NECESIDAD_VALIDACION.VALIDADO_EXP) liberacion = LIBERACION_ESTADO.LIBERABLE;
  else liberacion = LIBERACION_ESTADO.PENDIENTE_EVIDENCIA;

  let estadoGeneral;
  if (bloqueantes.length) estadoGeneral = ESTADO_GENERAL.BLOQUEADO;
  else if (riesgos.length) estadoGeneral = ESTADO_GENERAL.REQUIERE_AJUSTE;
  else if (reportMode === 'NORMATIVO_ESTRICTO' && desvios.length >= 2) estadoGeneral = ESTADO_GENERAL.REQUIERE_AJUSTE;
  else if (desvios.length && mezclaEstado && !mezclaLiberada) estadoGeneral = ESTADO_GENERAL.EN_VALIDACION;
  else if (desvios.length) estadoGeneral = ESTADO_GENERAL.CONDICIONADO;
  else if (necesidadValidacion === NECESIDAD_VALIDACION.VALIDADO_EXP) estadoGeneral = ESTADO_GENERAL.VALIDADO;
  else if (mezclaEstado && !mezclaLiberada) estadoGeneral = ESTADO_GENERAL.EN_VALIDACION;
  else estadoGeneral = ESTADO_GENERAL.EN_EVALUACION;

  return {
    estadoGeneral,
    conformidadNormativa,
    viabilidadTecnica,
    necesidadValidacion,
    liberacion,
    sostenibilidad: {
      evaluado: false,
      ventajas: [],
      penalidades: [],
      nota: 'No evaluado — bloque preparado para integración futura de indicadores de cercanía, costo relativo, huella de carbono y disponibilidad logística.',
    },
    bloqueantes, riesgos, desvios, condicionantes, observaciones, fortalezas,
    findings,
    reportMode,
  };
}

// Labels para display
const ESTADO_GLOBAL_LABEL = {
  [ESTADO_GLOBAL.APTO]: 'Apto',
  [ESTADO_GLOBAL.APTO_OBS]: 'Apto con observaciones',
  [ESTADO_GLOBAL.NO_APTO]: 'No apto',
  [ESTADO_GLOBAL.INCOMPLETO]: 'Incompleto',
};

const ESTADO_GLOBAL_COLOR = {
  [ESTADO_GLOBAL.APTO]: 'success',
  [ESTADO_GLOBAL.APTO_OBS]: 'warning',
  [ESTADO_GLOBAL.NO_APTO]: 'danger',
  [ESTADO_GLOBAL.INCOMPLETO]: 'info',
};

const ESTADO_VERIF_LABEL = {
  [ESTADO_VERIF.CUMPLE]: 'Cumple',
  [ESTADO_VERIF.CUMPLE_CON_DATOS]: 'Cumple con datos disponibles',
  [ESTADO_VERIF.NO_CUMPLE]: 'No cumple',
  [ESTADO_VERIF.NO_CONCLUYENTE]: 'No concluyente',
  [ESTADO_VERIF.NO_EVALUADO]: 'No evaluado',
  'CUMPLE_CON_OBSERVACIONES': 'Cumple con observaciones',
};

module.exports = {
  ESTADO_GLOBAL,
  ESTADO_VERIF,
  ESTADO_GLOBAL_LABEL,
  ESTADO_GLOBAL_COLOR,
  ESTADO_VERIF_LABEL,
  consolidarAptitudMaterial,
  consolidarClorurosGlobal,
  consolidarEstadoGlobal,
  // Modelo prestacional multi-eje (filosofía 2026)
  computeClorurosGlobal,
  limiteClorurosCirsocTabla26, // PR8.7 — exportado para uso en aptitudMaterialesService
  buildAssessment,
  SEVERITY,
  ESTADO_GENERAL,
  CONFORMIDAD_NORMATIVA,
  VIABILIDAD_TECNICA,
  NECESIDAD_VALIDACION,
  LIBERACION_ESTADO,
};
