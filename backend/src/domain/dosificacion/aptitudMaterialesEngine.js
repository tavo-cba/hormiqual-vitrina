'use strict';

/**
 * aptitudMaterialesEngine.js
 *
 * Módulo 6.6 — Verificación de aptitud de materiales en contexto de dosificación.
 * Resuelve límites variables de Tablas 3.4 (AF) y 3.6 (AG) según condiciones reales
 * del hormigón (desgaste, aspecto, f'c, clase exposición, tipo armadura).
 *
 * A diferencia de ensayoEvalEngine.js (que evalúa sin contexto, mostrando TODOS los
 * límites posibles), este módulo resuelve a UN SOLO límite por propiedad.
 */

/**
 * Resolve limits for AF (Tabla 3.4 CIRSOC 200-2024 + IRAM 1512)
 * @param {object} ctx - Dosification context
 * @param {boolean} ctx.expuestoDesgaste
 * @param {boolean} ctx.aspectoSuperficialImportante
 * @param {string}  ctx.tipoArmadura - 'simple'|'armado'|'pretensado'
 * @param {string}  ctx.claseExposicion - 'A1'|'C1'|'C2'|etc.
 * @param {number}  ctx.fc - Resistencia especificada (MPa)
 * @param {string}  ctx.tipoArena - 'ARENA_NATURAL'|'ARENA_TRITURACION'|'MEZCLA'
 * @param {number}  ctx.contenidoCemento - kg/m³
 * @param {number}  ctx.aireIncorporadoPct - %
 * @param {boolean} ctx.tieneAdicionMineral
 * @returns {Array<{propiedad, unidad, limite, operador, valor?, estado?, mensaje, normaRef, condicion}>}
 */
function resolverLimitesAF(ctx) {
  const limites = [];
  const esTrituracion = ctx.tipoArena === 'ARENA_TRITURACION' || ctx.tipoArena === 'MEZCLA';
  // CIRSOC 200:2024 Tabla 3.4 — ningún límite del AF varía por clase de
  // exposición. Las condicionales son por uso (`expuestoDesgaste`,
  // `aspectoSuperficialImportante`) o subtipo (`tipoArena`).
  // IRAM 1525 (durabilidad por sulfato) sí varía por clase: solo C1/C2.
  const esClaseDurabilidadSulfato = ctx.claseExposicion === 'C1' || ctx.claseExposicion === 'C2';

  // 1. Pasante #200 (Tabla 3.4)
  let limitePasa200 = ctx.expuestoDesgaste ? 3.0 : 5.0;
  let condPasa200 = ctx.expuestoDesgaste
    ? 'Con desgaste superficial (CIRSOC 200 Tabla 3.4)'
    : 'Sin desgaste superficial';
  if (esTrituracion) {
    limitePasa200 += 2.0;
    condPasa200 += ' + arena de trituracion (+2 pp, Nota 1 Tabla 3.4)';
  }
  limites.push({
    propiedad: 'Pasante tamiz #200', unidad: '%', limite: limitePasa200,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.4', condicion: condPasa200,
    ensayoCodigo: 'IRAM1674_MATERIAL_FINO_200', field: 'pasa200Pct',
  });

  // 2. Terrones de arcilla (fijo)
  limites.push({
    propiedad: 'Terrones de arcilla y p.f.', unidad: '%', limite: 3.0,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.4', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_TERRONES_ARCILLA', field: 'valor',
  });

  // 3. Materias carbonosas (Tabla 3.4)
  const limiteCarb = ctx.aspectoSuperficialImportante ? 0.5 : 1.0;
  limites.push({
    propiedad: 'Materias carbonosas', unidad: '%', limite: limiteCarb,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.4',
    condicion: ctx.aspectoSuperficialImportante
      ? 'Aspecto superficial importante (<= 0,5%)'
      : 'Aspecto superficial no critico (<= 1,0%)',
    ensayoCodigo: 'IRAM1647_MATERIAS_CARBONOSAS', field: 'valor',
  });

  // 4. Sulfatos SO3 (fijo)
  limites.push({
    propiedad: 'Sulfatos (SO3)', unidad: '%', limite: 0.1,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.4', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_SULFATOS_SO3', field: 'valor',
  });

  // 5. Sales solubles (fijo)
  limites.push({
    propiedad: 'Sales solubles totales', unidad: '%', limite: 1.5,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.4', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_SALES_SOLUBLES', field: 'valor',
  });

  // 6. Cloruros AF (IRAM 1512 Tabla 1)
  limites.push({
    propiedad: 'Cloruros solubles', unidad: '%', limite: 0.04,
    operador: '<=', normaRef: 'IRAM 1512 Tabla 1', condicion: 'Limite directo sobre AF',
    ensayoCodigo: 'IRAM1882_CLORUROS_SOLUBLES', field: 'valor',
  });

  // 7. Materia orgánica (fijo)
  limites.push({
    propiedad: 'Materia organica', unidad: 'mg/kg', limite: 500,
    operador: '<', normaRef: 'CIRSOC 200 §3.2.3.4', condicion: 'Excepcion posible con ensayo morteros >= 95%',
    ensayoCodigo: 'IRAM1647_MATERIA_ORGANICA', field: 'resultadoColorimetrico',
    evalCustom: (r) => {
      if (r.resultadoColorimetrico === 'menor_500') return { cumple: true, valor: '< 500 ppm' };
      return { cumple: false, valor: '>= 500 ppm' };
    },
  });

  // 8. Equivalente arena — eliminado de aptitud en auditoría 01-calidad C21
  //    (sesión 2026-05-07). Ni CIRSOC 200:2024 ni IRAM 1512:2006 lo exigen
  //    para AF en hormigón (IRAM 1682:1992 es método para mezclas bituminosas
  //    y bases de pavimentos). El ensayo sigue siendo cargable como
  //    informativo, pero no participa de la verificación de aptitud.

  // 9. Durabilidad Na2SO4 — CIRSOC 200:2024 §3.2.3.5 (solo C1/C2)
  if (esClaseDurabilidadSulfato) {
    limites.push({
      propiedad: 'Durabilidad Na2SO4', unidad: '%', limite: 10,
      operador: '<', normaRef: 'CIRSOC 200 §3.2.3.5', condicion: `Clase ${ctx.claseExposicion} (congelación-deshielo)`,
      ensayoCodigo: 'IRAM1525_DURABILIDAD_SULFATO', field: 'perdidaPct',
    });
  }

  // 10. MF (fijo)
  limites.push({
    propiedad: 'Modulo de finura', unidad: '-', limite: null,
    operador: 'rango', limiteMin: 2.3, limiteMax: 3.1,
    normaRef: 'CIRSOC 200 §3.2.3.2 b', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1505_GRANULOMETRIA', field: 'moduloFinura',
    evalCustom: (r) => {
      const mf = r.granulometria?.evaluacionAuto?.moduloFinura?.valor
        ?? r.granulometria?.evaluacion?.calculos?.moduloFinura?.valor;
      if (mf == null) return { cumple: null, valor: null };
      return { cumple: mf >= 2.3 && mf <= 3.1, valor: mf };
    },
  });

  // 11. Suma sustancias nocivas (IRAM 1512 §5.2.2)
  const limiteSuma = ctx.expuestoDesgaste ? 5.0 : 7.0;
  limites.push({
    propiedad: 'Suma sustancias nocivas', unidad: '%', limite: limiteSuma,
    operador: '<=', normaRef: 'IRAM 1512 §5.2.2',
    condicion: ctx.expuestoDesgaste ? 'Con desgaste (<= 5,0%)' : 'Sin desgaste (<= 7,0%)',
    ensayoCodigo: '_SUMA_NOCIVAS_AF', field: null,
  });

  // 12. Banda granulométrica (condicional a f'c)
  if (ctx.fc > 20) {
    limites.push({
      propiedad: 'Banda granulometrica', unidad: '-', limite: null,
      operador: 'banda', normaRef: 'CIRSOC 200 §3.2.3.2',
      condicion: `f\'c = ${ctx.fc} MPa > 20 → Solo banda A-B admisible`,
      ensayoCodigo: 'IRAM1505_GRANULOMETRIA', field: null,
      evalCustom: (r) => {
        const evalAuto = r.granulometria?.evaluacionAuto;
        if (!evalAuto) return { cumple: null, valor: 'Sin evaluacion' };
        return { cumple: evalAuto.bandaAB?.cumple || false, valor: evalAuto.bandaAB?.cumple ? 'Cumple A-B' : 'No cumple A-B' };
      },
    });
  }

  return limites;
}

/**
 * Resolve limits for AG (Tabla 3.6 CIRSOC 200-2024 + IRAM 1531)
 *
 * @param {object} ctx
 * @param {boolean} ctx.expuestoDesgaste
 * @param {string}  ctx.claseExposicion
 * @param {number}  ctx.fc
 * @param {string}  ctx.subtipoMaterial - 'CANTO_RODADO'|'TRITURADO_NATURAL'|
 *                                        'TRITURADO_ARTIFICIAL'|'ESCORIA_ALTO_HORNO'|
 *                                        'LIVIANO' (opcional). Activa los
 *                                        límites de Tabla 4 IRAM 1531:2006
 *                                        (PUS≥1120 + Absorción≤10) sólo cuando
 *                                        es 'ESCORIA_ALTO_HORNO'.
 */
function resolverLimitesAG(ctx) {
  const limites = [];
  // CIRSOC 200:2024 Tabla 3.6 — única propiedad del AG con condicional por
  // clase de exposición es "materias carbonosas" (límite 0,5% si C1/C2 o
  // factor de uso, sino 1,0%). Las clases Q y M no aparecen en Tabla 3.6.
  const esClaseCarbonosaEstricta = ctx.claseExposicion === 'C1' || ctx.claseExposicion === 'C2';
  // IRAM 1525 (durabilidad por sulfato) — solo C1/C2 (CIRSOC §3.2.4.4).
  const esClaseDurabilidadSulfato = ctx.claseExposicion === 'C1' || ctx.claseExposicion === 'C2';
  const esPiedraPartida = ctx.subtipoAG === 'PIEDRA_PARTIDA';

  // 1. Pasante #200 (Tabla 3.6)
  const limitePasa200 = esPiedraPartida ? 1.5 : 1.0;
  limites.push({
    propiedad: 'Pasante tamiz #200', unidad: '%', limite: limitePasa200,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.6',
    condicion: esPiedraPartida ? 'Piedra partida (<= 1,5%)' : 'Grava / grava partida (<= 1,0%)',
    ensayoCodigo: 'IRAM1674_MATERIAL_FINO_200', field: 'pasa200Pct',
  });

  // 2. Terrones (fijo)
  limites.push({
    propiedad: 'Terrones de arcilla y p.f.', unidad: '%', limite: 2.0,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.6', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_TERRONES_ARCILLA', field: 'valor',
  });

  // 3. Materias carbonosas (condicional) — Tabla 3.6:
  //    0,5% si superficie afectada por congelación-deshielo (C1/C2) o losa
  //    sujeta a abrasión (`expuestoDesgaste`); 1,0% en otros casos.
  const limiteCarb = (esClaseCarbonosaEstricta || ctx.expuestoDesgaste) ? 0.5 : 1.0;
  limites.push({
    propiedad: 'Materias carbonosas', unidad: '%', limite: limiteCarb,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.6',
    condicion: (esClaseCarbonosaEstricta || ctx.expuestoDesgaste)
      ? `C1/C2 o abrasion (<= 0,5%)`
      : 'Sin exposicion severa (<= 1,0%)',
    ensayoCodigo: 'IRAM1647_MATERIAS_CARBONOSAS', field: 'valor',
  });

  // 4. Sulfatos SO3 (fijo)
  limites.push({
    propiedad: 'Sulfatos (SO3)', unidad: '%', limite: 0.075,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.6', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_SULFATOS_SO3', field: 'valor',
  });

  // 5. Sales solubles (fijo)
  limites.push({
    propiedad: 'Sales solubles totales', unidad: '%', limite: 1.5,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.6', condicion: 'Sin condicion variable',
    ensayoCodigo: 'IRAM1647_SALES_SOLUBLES', field: 'valor',
  });

  // 6. Cloruros AG (IRAM 1531 Tabla 1)
  limites.push({
    propiedad: 'Cloruros solubles', unidad: '%', limite: 0.003,
    operador: '<=', normaRef: 'IRAM 1531 Tabla 1',
    condicion: 'Limite directo sobre AG. Precision analitica <= 0,001% requerida.',
    ensayoCodigo: 'IRAM1882_CLORUROS_SOLUBLES', field: 'valor',
  });

  // 7. Durabilidad — CIRSOC 200:2024 §3.2.4.4 (solo C1/C2)
  if (esClaseDurabilidadSulfato) {
    limites.push({
      propiedad: 'Durabilidad Na2SO4', unidad: '%', limite: 12,
      operador: '<=', normaRef: 'CIRSOC 200 §3.2.4.4', condicion: `Clase ${ctx.claseExposicion} (congelación-deshielo)`,
      ensayoCodigo: 'IRAM1525_DURABILIDAD_SULFATO', field: 'perdidaPct',
    });
  }

  // 8. Desgaste LA (condicional)
  const limiteLA = ctx.expuestoDesgaste ? 30 : 50;
  limites.push({
    propiedad: 'Desgaste Los Angeles', unidad: '%', limite: limiteLA,
    operador: '<=', normaRef: 'CIRSOC 200 §3.2.4.5',
    condicion: ctx.expuestoDesgaste ? 'Con abrasion (<= 30%)' : 'General (<= 50%)',
    ensayoCodigo: 'IRAM1532_DESGASTE_LA', field: 'losAngelesPct',
  });

  // 9. Lajosidad (condicional a f'c)
  const limiteLaj = ctx.fc >= 50 ? 25 : 30;
  limites.push({
    propiedad: 'Lajosidad', unidad: '%', limite: limiteLaj,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.7',
    condicion: ctx.fc >= 50 ? `H >= 50 (f'c=${ctx.fc}) → <= 25%` : `Uso general (f'c=${ctx.fc}) → <= 30%`,
    ensayoCodigo: 'IRAM1687_1_LAJOSIDAD', field: 'lajosidadPct',
  });

  // 10. Elongación (condicional a f'c)
  const limiteElong = ctx.fc >= 50 ? 40 : 45;
  limites.push({
    propiedad: 'Elongacion', unidad: '%', limite: limiteElong,
    operador: '<=', normaRef: 'CIRSOC 200 Tabla 3.7',
    condicion: ctx.fc >= 50 ? `H >= 50 (f'c=${ctx.fc}) → <= 40%` : `Uso general (f'c=${ctx.fc}) → <= 45%`,
    ensayoCodigo: 'IRAM1687_2_ELONGACION', field: 'elongacionPct',
  });

  // 11/12. Absorción y PUS — IRAM 1531:2006 §5.2.3 Tabla 4.
  //
  // Aclaraciones normativas (IRAM 1531:2006 lectura directa):
  //   - Tabla 4 ("Requisitos físicos") figura dentro de §5.2 "Escoria de alto
  //     horno como agregado grueso". Fija PUS≥1,12 kg/dm³ (1120 kg/m³) y
  //     Absorción≤10 g/100g específicamente para AG de escoria.
  //   - Para AG natural y triturado IRAM 1531:2006 no fija ni absorción
  //     máxima ni PUS mínimo análogos (los métodos de ensayo siguen siendo
  //     IRAM 1647 para absorción y IRAM 1548 para PUS).
  //
  // Aplicación: el límite se exige sólo cuando el subtipo del AG es
  // `ESCORIA_ALTO_HORNO`. Para los otros subtipos (CANTO_RODADO,
  // TRITURADO_*, LIVIANO) el límite no aplica y simplemente no se agrega.
  // R5 auditoría 02-dosi cerrada (2026-05-07).
  const esEscoria = String(ctx.subtipoMaterial || '').toUpperCase() === 'ESCORIA_ALTO_HORNO';
  if (esEscoria) {
    limites.push({
      propiedad: 'Absorcion', unidad: '%', limite: 10.0,
      operador: '<=',
      normaRef: 'IRAM 1531:2006 §5.2.3 Tabla 4 (escoria de alto horno); IRAM 1647 método',
      condicion: 'Aplica sólo a AG de escoria de alto horno.',
      ensayoCodigo: 'IRAM1533_DENSIDAD_GRUESO', field: 'absorcionPct',
    });
    limites.push({
      propiedad: 'Densidad a granel (PUS)', unidad: 'kg/m3', limite: 1120,
      operador: '>=',
      normaRef: 'IRAM 1531:2006 §5.2.3 Tabla 4 (escoria de alto horno); IRAM 1548 método',
      condicion: 'Aplica sólo a AG de escoria de alto horno.',
      ensayoCodigo: 'IRAM1531_PESO_UNITARIO', field: 'pus',
    });
  }

  // 13. Suma sustancias nocivas AG (IRAM 1531 §5.1.2.2)
  limites.push({
    propiedad: 'Suma sustancias nocivas', unidad: '%', limite: 5.0,
    operador: '<=', normaRef: 'IRAM 1531 §5.1.2.2', condicion: 'Sin condicion variable',
    ensayoCodigo: '_SUMA_NOCIVAS_AG', field: null,
  });

  return limites;
}

/**
 * Evaluate resolved limits against actual ensayo data.
 * @param {Array} limites - From resolverLimitesAF or resolverLimitesAG
 * @param {object} ensayosMap - Map of canonicalCode → resultado JSON
 * @param {object} sumaFn - { af: calcularSumaSustanciasNocivasAF, ag: calcularSumaSustanciasNocivasAG }
 * @returns {Array<{propiedad, unidad, especificacion, valor, cumple, estado, mensaje, condicion}>}
 */
function evaluarContraLimites(limites, ensayosMap, sumaFn) {
  const resultados = [];

  for (const lim of limites) {
    const r = {};
    r.propiedad = lim.propiedad;
    r.unidad = lim.unidad;
    r.especificacion = lim.operador === 'rango'
      ? `${lim.limiteMin} a ${lim.limiteMax}`
      : lim.operador === 'banda' ? 'IRAM 1627'
      : `${lim.operador} ${lim.limite}`;
    r.condicion = lim.condicion;
    r.normaRef = lim.normaRef;

    // Handle special codes
    if (lim.ensayoCodigo === '_SUMA_NOCIVAS_AF' && sumaFn?.af) {
      const suma = sumaFn.af(ensayosMap);
      r.valor = suma.suma;
      r.cumple = suma.suma <= lim.limite;
      r.estado = r.cumple ? 'CUMPLE' : 'NO_CUMPLE';
      r.mensaje = `Suma: ${suma.suma}% (limite ${lim.limite}%)`;
      resultados.push(r);
      continue;
    }
    if (lim.ensayoCodigo === '_SUMA_NOCIVAS_AG' && sumaFn?.ag) {
      const suma = sumaFn.ag(ensayosMap);
      r.valor = suma.suma;
      r.cumple = suma.suma <= lim.limite;
      r.estado = r.cumple ? 'CUMPLE' : 'NO_CUMPLE';
      r.mensaje = `Suma: ${suma.suma}% (limite ${lim.limite}%)`;
      resultados.push(r);
      continue;
    }

    // Get ensayo result
    const ensayo = ensayosMap[lim.ensayoCodigo];
    if (!ensayo) {
      r.valor = null;
      r.cumple = null;
      r.estado = 'SIN_DATOS';
      r.mensaje = 'Ensayo no cargado';
      resultados.push(r);
      continue;
    }

    // Custom evaluator
    if (lim.evalCustom) {
      const evalResult = lim.evalCustom(ensayo);
      r.valor = evalResult.valor;
      r.cumple = evalResult.cumple;
      r.estado = evalResult.cumple === true ? 'CUMPLE' : evalResult.cumple === false ? 'NO_CUMPLE' : 'SIN_DATOS';
      r.mensaje = '';
      resultados.push(r);
      continue;
    }

    // Standard evaluation
    const val = lim.field ? (ensayo[lim.field] ?? ensayo.valor) : ensayo.valor;
    r.valor = val;

    if (val == null) {
      r.cumple = null;
      r.estado = 'SIN_DATOS';
      r.mensaje = 'Sin valor en el resultado';
      resultados.push(r);
      continue;
    }

    // Handle operador field (with backward compat for esMenorQue)
    const opEnsayo = ensayo.operador || (ensayo.esMenorQue ? 'menor_que' : null);
    const numVal = Number(val);

    if (opEnsayo === 'menor_que') {
      // "< val": for max limits, if val <= limit → cumple (real is lower). Otherwise no_concluyente.
      if (lim.operador === '<=' || lim.operador === '<') {
        if (numVal <= lim.limite) {
          r.cumple = true;
          r.estado = 'CUMPLE';
          r.mensaje = `< ${numVal} \u2264 ${lim.limite} \u2014 CUMPLE (por debajo del LD)`;
        } else {
          r.cumple = null;
          r.estado = 'NO_CONCLUYENTE';
          r.mensaje = `< ${numVal} vs l\u00edmite ${lim.limite} \u2014 No concluyente`;
        }
      } else if (lim.operador === '>=') {
        if (numVal < lim.limite) {
          r.cumple = false;
          r.estado = 'NO_CUMPLE';
          r.mensaje = `< ${numVal} por debajo del m\u00ednimo ${lim.limite}`;
        } else {
          r.cumple = null;
          r.estado = 'NO_CONCLUYENTE';
          r.mensaje = `< ${numVal} vs m\u00ednimo ${lim.limite} \u2014 No concluyente`;
        }
      } else {
        r.cumple = null; r.estado = 'NO_CONCLUYENTE'; r.mensaje = 'Operador no aplicable';
      }
      resultados.push(r);
      continue;
    }

    if (opEnsayo === 'mayor_que') {
      // "> val": for max limits, if val > limit → no cumple. Otherwise no_concluyente.
      if (lim.operador === '<=' || lim.operador === '<') {
        if (numVal > lim.limite) {
          r.cumple = false;
          r.estado = 'NO_CUMPLE';
          r.mensaje = `> ${numVal} supera l\u00edmite ${lim.limite}`;
        } else {
          r.cumple = null;
          r.estado = 'NO_CONCLUYENTE';
          r.mensaje = `> ${numVal} vs l\u00edmite ${lim.limite} \u2014 No concluyente`;
        }
      } else if (lim.operador === '>=') {
        if (numVal >= lim.limite) {
          r.cumple = true;
          r.estado = 'CUMPLE';
          r.mensaje = `> ${numVal} \u2265 ${lim.limite} \u2014 CUMPLE`;
        } else {
          r.cumple = null;
          r.estado = 'NO_CONCLUYENTE';
          r.mensaje = `> ${numVal} vs m\u00ednimo ${lim.limite} \u2014 No concluyente`;
        }
      } else {
        r.cumple = null; r.estado = 'NO_CONCLUYENTE'; r.mensaje = 'Operador no aplicable';
      }
      resultados.push(r);
      continue;
    }

    // Exact value — original logic
    const efectivo = numVal;

    if (lim.operador === '<=') {
      r.cumple = efectivo <= lim.limite;
    } else if (lim.operador === '<') {
      r.cumple = efectivo < lim.limite;
    } else if (lim.operador === '>=') {
      r.cumple = efectivo >= lim.limite;
    } else if (lim.operador === 'rango') {
      r.cumple = efectivo >= lim.limiteMin && efectivo <= lim.limiteMax;
    }

    const pct = lim.limite ? Math.round((efectivo / lim.limite) * 100) : null;
    r.estado = r.cumple ? 'CUMPLE' : 'NO_CUMPLE';
    r.mensaje = r.cumple ? `${pct != null ? pct + '% del limite' : 'OK'}` : `Supera limite`;
    r.alerta = r.cumple && pct != null && pct > 80;

    resultados.push(r);
  }

  return resultados;
}

module.exports = { resolverLimitesAF, resolverLimitesAG, evaluarContraLimites };
