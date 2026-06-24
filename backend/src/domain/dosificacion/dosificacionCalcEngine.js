'use strict';

/**
 * @deprecated Este motor queda como fallback de compatibilidad.
 * El motor principal es ahora HormiQual 1.0 (hormiqualCalcEngine.js).
 * No se deben agregar features nuevas aquí.
 *
 * Motor de cálculo de dosificación simplificado (legacy ACI 211.1).
 * Función pura: (inputs) => { resultado, trazabilidad, warnings }
 */

const { pushFuente, ORIGEN_TIPO, CRITICIDAD } = require('./fuentesHelper');

/**
 * Identidad unificada HormiQual (sesión 2026-05-18). Motor ACI 211.1 LEGACY
 * (deprecado, sólo helpers a/c). La marca user-facing es HormiQual; el modelo
 * es "ACI 211.1 (legacy)". Forward-only; snapshots viejos conservan
 * 'ACI211-v1.2.0'. Ver hormiqualCalcEngine / docs/decisiones_arquitectura.md.
 */
const MOTOR_VERSION_ACI = 'HormiQual v2.0';
const MODELO_CALCULO_LABEL_ACI = 'ACI 211.1 (legacy, deprecado)';

/** Labels legibles para unidades de dosificación de aditivos. */
const UNIDAD_DOSIS_LABELS = {
  PORC_SOBRE_CEMENTO:  '% sobre cemento',
  ML_POR_100KG_CEMENTO: 'mL/100 kg cemento',
  KG_M3:               'kg/m³',
};

const FORMA_LABELS = { TRITURADO: 'Triturado', CANTO_RODADO: 'Canto rodado', MIXTO: 'Mixto', NO_DEFINIDO: 'No definido' };
const formaLabel = (f) => FORMA_LABELS[f] || f;

const METODO_LABELS = {
  DIRECTO: 'Lectura directa', INTERPOLACION_ASENTAMIENTO: 'Interpolación por asentamiento',
  INTERPOLACION_TMN: 'Interpolación por TMN', TMN_CERCANO: 'TMN más cercano',
  TABLA_DIRECTO: 'Lectura directa de tabla', TABLA_INTERPOLACION: 'Interpolación de tabla',
  TABLA_EXTRAPOLACION: 'Extrapolación de tabla', INTERPOLACION: 'Interpolación',
};
const metodoLabel = (m) => METODO_LABELS[m] || m;

const MODO_EFECTO_LABELS = {
  AHORRO_AGUA: 'Ahorro de agua', AUMENTO_ASENTAMIENTO: 'Aumento de asentamiento',
  RETARDANTE: 'Retardante de fraguado', ACELERANTE_FRAGUE: 'Acelerante de fraguado',
  ACELERANTE_ENDURECIMIENTO: 'Acelerante de endurecimiento', INCORPORADOR_AIRE: 'Incorporador de aire',
  ANTICONGELANTE: 'Anticongelante', REDUCTOR_RETRACCION: 'Reductor de retracción',
  EXPANSIVO: 'Expansivo / Compensador de retracción', INHIBIDOR_CORROSION: 'Inhibidor de corrosión',
  VISCOSANTE: 'Modificador de viscosidad (VMA)', IMPERMEABILIZANTE: 'Impermeabilizante',
  FIBRAS: 'Refuerzo con fibras', OTRO: 'Otro',
};
const modoEfectoLabel = (m) => MODO_EFECTO_LABELS[m] || m || '—';
const EFECTOS_CON_CALCULO = new Set(['AHORRO_AGUA', 'AUMENTO_ASENTAMIENTO']);

const unidadDosisLabel = (u) => UNIDAD_DOSIS_LABELS[u] || u || '';

/** Build additive display name avoiding duplicated substrings between marca and funcion. */
const buildAditivoNombre = (ad) => {
  if (!ad) return null;
  const marca = (ad.marca || '').trim();
  const funcion = (ad.funcion || '').trim();
  if (!marca && !funcion) return null;
  if (!funcion) return marca;
  if (!marca) return funcion;
  const lm = marca.toLowerCase(), lf = funcion.toLowerCase();
  if (lm.includes(lf) || lf.includes(lm)) return marca.length >= funcion.length ? marca : funcion;
  return `${marca} ${funcion}`;
};

/**
 * Interpolación lineal entre dos puntos.
 */
function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Estima agua base a partir de la tabla agua-asentamiento.
 */
function estimarAguaBase(curvas, tmnMm, asentamientoMm) {
  if (!curvas || curvas.length === 0) {
    return { aguaLtsM3: null, metodo: 'SIN_DATOS', curvasUsadas: [], error: 'No hay curvas agua-asentamiento disponibles' };
  }

  // ACI engine only uses rows that belong to ACI_211 (metodo = 'ACI_211' or null/undefined, and no moduloFinura)
  const aciCurvas = curvas.filter(c => c.moduloFinura == null || c.metodo === 'ACI_211');

  const aplicables = aciCurvas.filter(c =>
    Number(c.asentamientoMinMm) <= asentamientoMm && asentamientoMm <= Number(c.asentamientoMaxMm)
  );

  if (aplicables.length === 0) {
    const allForTmn = aciCurvas.filter(c => Math.abs(Number(c.tmnMm) - tmnMm) < 0.5);
    if (allForTmn.length >= 2) {
      allForTmn.sort((a, b) => {
        const midA = (Number(a.asentamientoMinMm) + Number(a.asentamientoMaxMm)) / 2;
        const midB = (Number(b.asentamientoMinMm) + Number(b.asentamientoMaxMm)) / 2;
        return midA - midB;
      });
      for (let i = 0; i < allForTmn.length - 1; i++) {
        const midA = (Number(allForTmn[i].asentamientoMinMm) + Number(allForTmn[i].asentamientoMaxMm)) / 2;
        const midB = (Number(allForTmn[i + 1].asentamientoMinMm) + Number(allForTmn[i + 1].asentamientoMaxMm)) / 2;
        if (midA <= asentamientoMm && asentamientoMm <= midB) {
          const agua = lerp(asentamientoMm, midA, Number(allForTmn[i].aguaLtsM3), midB, Number(allForTmn[i + 1].aguaLtsM3));
          return {
            aguaLtsM3: Math.round(agua * 10) / 10,
            metodo: 'INTERPOLACION_ASENTAMIENTO',
            curvasUsadas: [allForTmn[i], allForTmn[i + 1]],
          };
        }
      }
    }
    return { aguaLtsM3: null, metodo: 'SIN_RANGO', curvasUsadas: [], error: 'No hay curva para el asentamiento solicitado' };
  }

  const exactTmn = aplicables.filter(c => Math.abs(Number(c.tmnMm) - tmnMm) < 0.5);
  if (exactTmn.length > 0) {
    const agua = Number(exactTmn[0].aguaLtsM3);
    return { aguaLtsM3: agua, metodo: 'DIRECTO', curvasUsadas: [exactTmn[0]] };
  }

  const tmns = [...new Set(aplicables.map(c => Number(c.tmnMm)))].sort((a, b) => a - b);
  let lower = null, upper = null;
  for (const t of tmns) {
    if (t <= tmnMm) lower = t;
    if (t >= tmnMm && !upper) upper = t;
  }

  if (lower !== null && upper !== null && lower !== upper) {
    const rowLower = aplicables.find(c => Math.abs(Number(c.tmnMm) - lower) < 0.5);
    const rowUpper = aplicables.find(c => Math.abs(Number(c.tmnMm) - upper) < 0.5);
    if (rowLower && rowUpper) {
      const agua = lerp(tmnMm, lower, Number(rowLower.aguaLtsM3), upper, Number(rowUpper.aguaLtsM3));
      return {
        aguaLtsM3: Math.round(agua * 10) / 10,
        metodo: 'INTERPOLACION_TMN',
        curvasUsadas: [rowLower, rowUpper],
      };
    }
  }

  const nearest = aplicables.reduce((best, c) =>
    Math.abs(Number(c.tmnMm) - tmnMm) < Math.abs(Number(best.tmnMm) - tmnMm) ? c : best
  );
  return {
    aguaLtsM3: Number(nearest.aguaLtsM3),
    metodo: 'TMN_CERCANO',
    curvasUsadas: [nearest],
  };
}

/**
 * Estima relación a/c usando una curva de cemento específica (CurvaCemento).
 *
 * Soporta:
 *   - tipoCurva ABRAMS:              a/c = log(A / f'c) / log(B)
 *   - tipoCurva TABLA_AC_RESISTENCIA: interpolación sobre los puntos cargados
 *
 * @param {object} curvaCemento - Registro CurvaCemento con .abrams[] y .puntos[]
 * @param {number} resistenciaMpa
 * @param {number} edadDias
 * @returns {{ acEstimado, metodo, curvaNombre, curvaOrigen, warning? } | null}
 *   null si la curva no tiene datos suficientes para la edad solicitada.
 */
function estimarACdesdeCurvaCemento(curvaCemento, resistenciaMpa, edadDias) {
  if (!curvaCemento) return null;

  const curvaNombre = curvaCemento.nombre;

  // Prioridad 1: interpolar sobre la tabla a/c vs resistencia por edad
  const puntos = (curvaCemento.puntos || [])
    .filter(p => Number(p.edadDias) === edadDias)
    .sort((a, b) => Number(b.resistenciaMpa) - Number(a.resistenciaMpa));

  // Trazabilidad: devolvemos la curva completa (para la edad) que se considera
  // y los puntos específicos usados en la interpolación, para que el usuario
  // pueda inspeccionar si los datos son razonables o detectar puntos atípicos
  // (sesión 2026-05-27). `puntosCurvaEdad` es el dataset filtrado por edad
  // ordenado desc por resistencia, y `puntosUsados` enumera el subconjunto
  // realmente consultado (1 si exacto/extrapolado, 2 si interpolado).
  const puntosCurvaEdad = puntos.map((p) => ({
    resistenciaMpa: Number(p.resistenciaMpa),
    relacionAc: Number(p.relacionAc),
  }));

  if (puntos.length >= 2) {
    const exact = puntos.find(p => Math.abs(Number(p.resistenciaMpa) - resistenciaMpa) < 0.5);
    if (exact) {
      const ptExact = { resistenciaMpa: Number(exact.resistenciaMpa), relacionAc: Number(exact.relacionAc) };
      return {
        acEstimado: Number(exact.relacionAc),
        metodo: 'TABLA_DIRECTO',
        curvaNombre,
        puntosCurvaEdad,
        puntosUsados: [ptExact],
      };
    }

    for (let i = 0; i < puntos.length - 1; i++) {
      const r1 = Number(puntos[i].resistenciaMpa), r2 = Number(puntos[i + 1].resistenciaMpa);
      if ((r1 >= resistenciaMpa && resistenciaMpa >= r2) || (r2 >= resistenciaMpa && resistenciaMpa >= r1)) {
        const ac = lerp(resistenciaMpa, r1, Number(puntos[i].relacionAc), r2, Number(puntos[i + 1].relacionAc));
        const puntosUsados = [
          { resistenciaMpa: r1, relacionAc: Number(puntos[i].relacionAc) },
          { resistenciaMpa: r2, relacionAc: Number(puntos[i + 1].relacionAc) },
        ];
        return {
          acEstimado: Math.round(ac * 1000) / 1000,
          metodo: 'TABLA_INTERPOLACION',
          curvaNombre,
          puntosCurvaEdad,
          puntosUsados,
        };
      }
    }

    // Extrapolación por punto más cercano
    const nearest = puntos.reduce((best, p) =>
      Math.abs(Number(p.resistenciaMpa) - resistenciaMpa) < Math.abs(Number(best.resistenciaMpa) - resistenciaMpa) ? p : best
    );
    return {
      acEstimado: Number(nearest.relacionAc),
      metodo: 'TABLA_EXTRAPOLACION',
      curvaNombre,
      puntosCurvaEdad,
      puntosUsados: [{ resistenciaMpa: Number(nearest.resistenciaMpa), relacionAc: Number(nearest.relacionAc) }],
      warning: `Resistencia ${resistenciaMpa} MPa fuera del rango de la curva; se usó el punto más cercano (${nearest.resistenciaMpa} MPa).`,
    };
  }

  // Prioridad 2 (fallback): parámetros Abrams A/B si la tabla no tiene datos para esta edad
  const abramsRows = (curvaCemento.abrams || []).filter(r => Number(r.edadDias) === edadDias);
  if (abramsRows.length > 0) {
    const { parametroA: A, parametroB: B } = abramsRows[0];
    const a = Number(A), b = Number(B);
    if (a > 0 && b > 1 && resistenciaMpa > 0) {
      // Ley de Abrams: f'c = A / B^(a/c)  =>  a/c = log(A/f'c) / log(B)
      const ratio = a / resistenciaMpa;
      if (ratio > 0) {
        const ac = Math.log(ratio) / Math.log(b);
        if (Number.isFinite(ac) && ac > 0) {
          return {
            acEstimado: Math.round(ac * 1000) / 1000,
            metodo: 'ABRAMS_FALLBACK',
            curvaNombre,
            puntosCurvaEdad,
            abramsParams: { parametroA: a, parametroB: b, edadDias },
            warning: 'No hay tabla a/c para esta edad; se usaron parámetros Abrams A/B como fallback.',
          };
        }
      }
    }
  }

  return null;
}

/**
 * Estima relación a/c desde tabla a/c vs resistencia.
 */
function estimarAC(curvas, resistenciaMpa, edadDias, familiaCemento) {
  if (!curvas || curvas.length === 0) {
    return { acEstimado: null, metodo: 'SIN_DATOS', curvasUsadas: [], error: 'No hay curvas a/c-resistencia disponibles' };
  }

  let filtered = curvas.filter(c => Number(c.edadDias) === edadDias);
  if (familiaCemento) {
    const familyRows = filtered.filter(c => c.familiaCemento === familiaCemento);
    if (familyRows.length > 0) filtered = familyRows;
    else filtered = filtered.filter(c => !c.familiaCemento);
  } else {
    filtered = filtered.filter(c => !c.familiaCemento);
  }

  if (filtered.length === 0) {
    filtered = curvas.filter(c => !c.familiaCemento);
    if (filtered.length === 0) filtered = curvas;
  }

  filtered.sort((a, b) => Number(b.resistenciaMpa) - Number(a.resistenciaMpa));

  const exact = filtered.find(c => Math.abs(Number(c.resistenciaMpa) - resistenciaMpa) < 0.5);
  if (exact) {
    return { acEstimado: Number(exact.acEstimado), metodo: 'DIRECTO', curvasUsadas: [exact] };
  }

  for (let i = 0; i < filtered.length - 1; i++) {
    const r1 = Number(filtered[i].resistenciaMpa);
    const r2 = Number(filtered[i + 1].resistenciaMpa);
    if ((r1 >= resistenciaMpa && resistenciaMpa >= r2) || (r2 >= resistenciaMpa && resistenciaMpa >= r1)) {
      const ac = lerp(resistenciaMpa, r1, Number(filtered[i].acEstimado), r2, Number(filtered[i + 1].acEstimado));
      return {
        acEstimado: Math.round(ac * 1000) / 1000,
        metodo: 'INTERPOLACION',
        curvasUsadas: [filtered[i], filtered[i + 1]],
      };
    }
  }

  const nearest = filtered.reduce((best, c) =>
    Math.abs(Number(c.resistenciaMpa) - resistenciaMpa) < Math.abs(Number(best.resistenciaMpa) - resistenciaMpa) ? c : best
  );
  return {
    acEstimado: Number(nearest.acEstimado),
    metodo: 'EXTRAPOLACION_CERCANO',
    curvasUsadas: [nearest],
    warning: `Resistencia ${resistenciaMpa} MPa fuera del rango de la tabla; se usó el punto más cercano (${nearest.resistenciaMpa} MPa)`,
  };
}

/**
 * Ejecuta el cálculo de dosificación ACI 211.1 Simplificado.
 *
 * @param {object} params
 * @param {object} [params.context] - Display labels for fuentes:
 *   { cementoNombre, mezclaNombre, adicion1Nombre, adicion2Nombre,
 *     aditivo1Nombre, aditivo2Nombre, tmnSource, formaSource }
 */
function calcularDosificacion(params) {
  // Gate de deprecación — M4 auditoría 02-dosi.
  // Este motor (ACI 211.1) está deprecado en favor de HormiQual 1.0
  // (`hormiqualCalcEngine.calcularDosificacionHormiqual`). Los exports `estimarAC`,
  // `estimarAguaBase` y `estimarACdesdeCurvaCemento` siguen siendo usados
  // por hormiqualCalcEngine como helpers, pero `calcularDosificacion` (el
  // pipeline completo legacy) NO debería invocarse desde código nuevo.
  if (process.env.NODE_ENV !== 'test' && !params._allowLegacy) {
    // eslint-disable-next-line no-console
    console.warn(
      '[dosificacionCalcEngine.calcularDosificacion] DEPRECATED — usar `calcularDosificacionHormiqual` (HormiQual 1.0). ' +
      'Para silenciar este aviso en un caller legítimo, pasar `_allowLegacy: true` en params.'
    );
  }
  const warnings = [];
  const fuentesCalculo = [];
  const trazabilidad = {
    metodoCalculo: 'ACI_211',
    motorVersion: MOTOR_VERSION_ACI,
    modeloCalculoLabel: MODELO_CALCULO_LABEL_ACI,
    inputs: { ...params, curvasAgua: undefined, curvasAC: undefined, aireEsperado: undefined },
  };
  trazabilidad.fuentesCalculo = fuentesCalculo;

  const {
    resistenciaMpa, edadDias, asentamientoMm, tmnMm,
    formaAgregado = 'TRITURADO',
    cemento, adicion1, adicion2,
    aditivo1, aditivo2,
    mezcla, curvasAgua, curvasAC, aireEsperado,
    curvaCemento = null,       // CurvaCemento específica del cemento seleccionado
    curvaCementoOrigen = null, // 'ESPECIFICA' | 'FAMILIA' | null
    context: ctx = {},
  } = params;

  let airePct = params.airePct;
  const inputAireAtrapado = params.aireAtrapado;
  const inputAireIncorporado = params.aireIncorporado;

  // ── Fuentes: entradas del usuario ──────────────────────────────────────────
  pushFuente(fuentesCalculo, {
    parametro: 'Método de cálculo',
    valor: 'ACI 211.1 Simplificado',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Seleccionado por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Resistencia objetivo',
    valor: resistenciaMpa != null ? `${resistenciaMpa} MPa` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresada por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Edad de ensayo',
    valor: edadDias != null ? `${edadDias} días` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresada por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Asentamiento objetivo',
    valor: asentamientoMm != null ? `${asentamientoMm} mm` : '—',
    origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
    regla: 'Ingresado por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'TMN',
    valor: tmnMm != null ? `${tmnMm} mm` : '—',
    origenTipo: ctx.tmnSource === 'MEZCLA' ? ORIGEN_TIPO.MEZCLA : ORIGEN_TIPO.INPUT_USUARIO,
    origenRef: ctx.tmnSource === 'MEZCLA' ? (ctx.mezclaNombre || null) : null,
    regla: ctx.tmnSource === 'MEZCLA'
      ? 'Derivado automáticamente desde la mezcla seleccionada'
      : 'Ingresado manualmente por el usuario',
  });
  pushFuente(fuentesCalculo, {
    parametro: 'Forma del agregado',
    valor: formaAgregado,
    origenTipo: ctx.formaSource === 'MEZCLA' ? ORIGEN_TIPO.MEZCLA : ORIGEN_TIPO.INPUT_USUARIO,
    origenRef: ctx.formaSource === 'MEZCLA' ? (ctx.mezclaNombre || null) : null,
    regla: ctx.formaSource === 'MEZCLA'
      ? 'Derivada de la clasificación de los agregados gruesos (ensayos granulométricos)'
      : 'Ingresada manualmente por el usuario',
  });

  // ── Fuentes: materiales ─────────────────────────────────────────────────────
  if (mezcla) {
    pushFuente(fuentesCalculo, {
      parametro: 'Mezcla granulométrica',
      valor: mezcla.nombre || `Mezcla #${mezcla.idMezcla}`,
      origenTipo: ORIGEN_TIPO.MEZCLA,
      origenRef: mezcla.nombre || null,
      regla: 'Mezcla seleccionada como base para la distribución de agregados',
    });
  }

  const _cementoNombre = ctx.cementoNombre || cemento?.nombreComercial || (cemento ? `Cemento #${cemento.idCemento}` : null);
  if (cemento) {
    pushFuente(fuentesCalculo, {
      parametro: 'Cemento',
      valor: _cementoNombre,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _cementoNombre,
      regla: 'Cemento seleccionado por el usuario',
    });
    const _dens = cemento.densidadRelativa ? Number(cemento.densidadRelativa) : null;
    pushFuente(fuentesCalculo, {
      parametro: 'Densidad relativa del cemento',
      valor: _dens ?? 3.15,
      origenTipo: _dens ? ORIGEN_TIPO.MATERIAL_CEMENTO : ORIGEN_TIPO.DEFAULT,
      origenRef: _dens ? _cementoNombre : null,
      regla: _dens ? 'Tomada de la ficha técnica del cemento' : null,
      observacion: !_dens ? 'Se usó valor por defecto 3.15 (ficha técnica no disponible)' : null,
      criticidad: !_dens ? CRITICIDAD.FALLBACK : CRITICIDAD.INFO,
    });
  }

  if (adicion1?.reemplazoPct > 0) {
    const _n = ctx.adicion1Nombre || adicion1.nombre || 'Adición 1';
    pushFuente(fuentesCalculo, {
      parametro: 'Adición 1',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _n,
      regla: `Reemplazo parcial del cemento al ${adicion1.reemplazoPct} %`,
    });
  }
  if (adicion2?.reemplazoPct > 0) {
    const _n = ctx.adicion2Nombre || adicion2.nombre || 'Adición 2';
    pushFuente(fuentesCalculo, {
      parametro: 'Adición 2',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_CEMENTO,
      origenRef: _n,
      regla: `Reemplazo parcial del cemento al ${adicion2.reemplazoPct} %`,
    });
  }
  if (aditivo1?.dosis) {
    const _n = ctx.aditivo1Nombre || buildAditivoNombre(aditivo1) || 'Aditivo 1';
    pushFuente(fuentesCalculo, {
      parametro: 'Aditivo 1',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
      origenRef: _n,
      regla: `Dosis: ${aditivo1.dosis} ${unidadDosisLabel(aditivo1.unidadDosificacion)} · Efecto: ${modoEfectoLabel(aditivo1.modoEfecto)}`,
    });
  }
  if (aditivo2?.dosis) {
    const _n = ctx.aditivo2Nombre || buildAditivoNombre(aditivo2) || 'Aditivo 2';
    pushFuente(fuentesCalculo, {
      parametro: 'Aditivo 2',
      valor: _n,
      origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
      origenRef: _n,
      regla: `Dosis: ${aditivo2.dosis} ${unidadDosisLabel(aditivo2.unidadDosificacion)} · Efecto: ${modoEfectoLabel(aditivo2.modoEfecto)}`,
    });
  }

  // ── Validations ──────────────────────────────────────────────────────────────
  if (!resistenciaMpa || resistenciaMpa <= 0) warnings.push({ campo: 'resistenciaMpa', msg: 'Resistencia objetivo no definida o inválida' });
  if (!asentamientoMm || asentamientoMm <= 0) warnings.push({ campo: 'asentamientoMm', msg: 'Asentamiento objetivo no definido' });
  if (!tmnMm || tmnMm <= 0) warnings.push({ campo: 'tmnMm', msg: 'TMN no definido' });
  if (!cemento) warnings.push({ campo: 'cemento', msg: 'Cemento no seleccionado' });
  if (resistenciaMpa > 60) warnings.push({ campo: 'resistenciaMpa', msg: 'Resistencia muy alta; resultados pueden ser imprecisos', tipo: 'advertencia' });
  if (asentamientoMm > 250) warnings.push({ campo: 'asentamientoMm', msg: 'Asentamiento muy alto; verificar especificación', tipo: 'advertencia' });

  // ── Step 1: Aire base (atrapado) ─────────────────────────────────────────────
  let aireAtrapado;
  if (inputAireAtrapado != null && inputAireAtrapado !== '') {
    aireAtrapado = Number(inputAireAtrapado);
    trazabilidad.aireBase = { fuente: 'usuario', airePct: aireAtrapado };
    pushFuente(fuentesCalculo, {
      parametro: 'Aire atrapado',
      valor: `${aireAtrapado} %`,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Ingresado manualmente por el usuario',
    });
  } else if (airePct != null && airePct !== '') {
    aireAtrapado = Number(airePct);
    trazabilidad.aireBase = { fuente: 'usuario', airePct: aireAtrapado };
    pushFuente(fuentesCalculo, {
      parametro: 'Aire atrapado',
      valor: `${aireAtrapado} %`,
      origenTipo: ORIGEN_TIPO.INPUT_USUARIO,
      regla: 'Ingresado manualmente por el usuario (valor total)',
    });
  } else {
    const aireRow = (aireEsperado || []).find(a => Math.abs(Number(a.tmnMm) - tmnMm) < 1);
    if (aireRow) {
      aireAtrapado = Number(aireRow.aireBasePct);
      trazabilidad.aireBase = { fuente: 'tabla', tmnMm, airePct: aireAtrapado, fila: aireRow };
      pushFuente(fuentesCalculo, {
        parametro: 'Aire atrapado',
        valor: `${aireAtrapado} %`,
        origenTipo: ORIGEN_TIPO.TABLA,
        origenRef: 'Tabla aire esperado por TMN',
        regla: `Selección directa por TMN ${tmnMm} mm`,
      });
    } else {
      aireAtrapado = 2.0;
      trazabilidad.aireBase = { fuente: 'default', airePct: 2.0 };
      pushFuente(fuentesCalculo, {
        parametro: 'Aire atrapado',
        valor: '2.0 %',
        origenTipo: ORIGEN_TIPO.DEFAULT,
        regla: `No se encontró fila de tabla para TMN ${tmnMm} mm`,
        observacion: 'Se usó valor por defecto 2.0 % (sin datos de tabla)',
        criticidad: CRITICIDAD.FALLBACK,
      });
      warnings.push({ campo: 'aire', msg: `No se encontró tabla de aire para TMN ${tmnMm}mm; se usó ${aireAtrapado}%`, tipo: 'advertencia' });
    }
  }

  // ── Aire incorporado (entrained) ──────────────────────────────────────────────
  const aireIntencionalACI = params.aireIntencional === true;
  const aireIncorporado = aireIntencionalACI && inputAireIncorporado ? Number(inputAireIncorporado) : 0;
  airePct = aireAtrapado + aireIncorporado;

  // ── Step 2: Agua base ────────────────────────────────────────────────────────
  const formaFiltro = formaAgregado === 'MIXTO' ? 'TRITURADO' : formaAgregado;
  const curvasAguaFiltradas = (curvasAgua || []).filter(c => c.formaAgregado === formaFiltro);
  const aguaResult = estimarAguaBase(curvasAguaFiltradas, tmnMm, asentamientoMm);
  trazabilidad.aguaBase = aguaResult;

  if (!aguaResult.aguaLtsM3) {
    warnings.push({ campo: 'agua', msg: aguaResult.error || 'No se pudo estimar agua base', tipo: 'error' });
    return { resultado: null, trazabilidad, warnings };
  }

  const _curvaAguaRef = aguaResult.curvasUsadas?.[0]?.nombre
    ? `ACI agua-asentamiento v1 · ${aguaResult.curvasUsadas[0].nombre}`
    : `ACI agua-asentamiento v1 (${formaFiltro})`;
  pushFuente(fuentesCalculo, {
    parametro: 'Agua base',
    valor: `${aguaResult.aguaLtsM3} L/m³`,
    origenTipo: ORIGEN_TIPO.CURVA,
    origenRef: _curvaAguaRef,
    regla: `${metodoLabel(aguaResult.metodo)} · TMN ${tmnMm} mm · Asentamiento ${asentamientoMm} mm · Forma ${formaLabel(formaFiltro)}`,
  });

  let aguaFinal = aguaResult.aguaLtsM3;

  // ── Step 3: Corrección por aditivo ───────────────────────────────────────────
  trazabilidad.correccionAditivo = [];

  const _trazarInformativo = (adLabel, adNombre, aditivo) => {
    const efLabel = modoEfectoLabel(aditivo.modoEfecto);
    trazabilidad.correccionAditivo.push({
      aditivo: adLabel, modo: aditivo.modoEfecto, informativo: true,
      nota: `${efLabel} — efecto informativo, sin incidencia en el cálculo de agua`,
    });
    pushFuente(fuentesCalculo, {
      parametro: `Función — ${adLabel}`,
      valor: efLabel,
      origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
      origenRef: adNombre || adLabel,
      regla: 'Efecto informativo: no modifica agua ni asentamiento. Incluido en volumen y peso de la dosificación.',
    });
  };

  if (aditivo1 && aditivo1.dosis) {
    if (aditivo1.modoEfecto && !EFECTOS_CON_CALCULO.has(aditivo1.modoEfecto)) {
      _trazarInformativo('aditivo1', ctx.aditivo1Nombre, aditivo1);
    } else if (aditivo1.modoEfecto === 'AHORRO_AGUA' && aditivo1.reduccionAguaPctEsperada) {
      const reduccion = Number(aditivo1.reduccionAguaPctEsperada);
      const aguaAntes = aguaFinal;
      aguaFinal = aguaFinal * (1 - reduccion / 100);
      const aguaDespues = Math.round(aguaFinal * 10) / 10;
      trazabilidad.correccionAditivo.push({ aditivo: 'aditivo1', modo: 'AHORRO_AGUA', reduccionPct: reduccion, aguaAntes, aguaDespues });
      pushFuente(fuentesCalculo, {
        parametro: 'Corrección agua — Aditivo 1',
        valor: `${aguaAntes} → ${aguaDespues} L/m³`,
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: ctx.aditivo1Nombre || 'Aditivo 1',
        regla: `Reducción del ${reduccion}% por efecto de ahorro de agua`,
      });
    } else if (aditivo1.modoEfecto === 'AUMENTO_ASENTAMIENTO') {
      trazabilidad.correccionAditivo.push({ aditivo: 'aditivo1', modo: 'AUMENTO_ASENTAMIENTO', nota: 'Agua se mantiene; el aditivo mejora trabajabilidad' });
      pushFuente(fuentesCalculo, {
        parametro: 'Corrección agua — Aditivo 1',
        valor: 'Sin cambio',
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: ctx.aditivo1Nombre || 'Aditivo 1',
        regla: 'Efecto de aumento de asentamiento: el agua no se reduce, el aditivo mejora la trabajabilidad',
      });
    }
  }
  if (aditivo2 && aditivo2.dosis) {
    if (aditivo2.modoEfecto && !EFECTOS_CON_CALCULO.has(aditivo2.modoEfecto)) {
      _trazarInformativo('aditivo2', ctx.aditivo2Nombre, aditivo2);
    } else if (aditivo2.modoEfecto === 'AHORRO_AGUA' && aditivo2.reduccionAguaPctEsperada) {
      const reduccion = Number(aditivo2.reduccionAguaPctEsperada);
      const aguaAntes = aguaFinal;
      aguaFinal = aguaFinal * (1 - reduccion / 100);
      const aguaDespues = Math.round(aguaFinal * 10) / 10;
      trazabilidad.correccionAditivo.push({ aditivo: 'aditivo2', modo: 'AHORRO_AGUA', reduccionPct: reduccion, aguaAntes, aguaDespues });
      pushFuente(fuentesCalculo, {
        parametro: 'Corrección agua — Aditivo 2',
        valor: `${aguaAntes} → ${aguaDespues} L/m³`,
        origenTipo: ORIGEN_TIPO.MATERIAL_ADITIVO,
        origenRef: ctx.aditivo2Nombre || 'Aditivo 2',
        regla: `Reducción del ${reduccion}% por efecto de ahorro de agua`,
      });
    }
  }

  aguaFinal = Math.round(aguaFinal * 10) / 10;
  trazabilidad.aguaFinal = aguaFinal;
  pushFuente(fuentesCalculo, {
    parametro: 'Agua final',
    valor: `${aguaFinal} L/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: trazabilidad.correccionAditivo.length > 0
      ? 'Agua base corregida por efecto de aditivos reductores de agua'
      : 'Igual al agua base (sin correcciones por aditivos)',
  });

  // ── Step 4: Relación a/c ─────────────────────────────────────────────────────
  // Prioridad: curva específica del cemento → tabla genérica CurvaACResistencia
  let acResult = null;
  let acOrigenTipo = ORIGEN_TIPO.CURVA;
  let acOrigenRef = null;
  let acOrigenObs = null;

  const curvaCementoResult = estimarACdesdeCurvaCemento(curvaCemento, resistenciaMpa, edadDias);
  if (curvaCementoResult) {
    acResult = { acEstimado: curvaCementoResult.acEstimado, metodo: curvaCementoResult.metodo, curvasUsadas: [], warning: curvaCementoResult.warning };
    acOrigenTipo = ORIGEN_TIPO.CURVA_CEMENTO;
    acOrigenRef = curvaCementoResult.curvaNombre;
    const origenLabel = curvaCementoOrigen === 'FAMILIA' ? 'Curva de familia del cemento' : 'Curva específica del cemento';
    acOrigenObs = curvaCementoOrigen === 'FAMILIA'
      ? `Curva de familia (${cemento.familiaCemento || '—'}) usada por no existir curva específica del cemento.`
      : null;
    trazabilidad.curvaCementoUsada = { id: curvaCemento.id, nombre: curvaCemento.nombre, origen: curvaCementoOrigen, origenLabel };
  } else {
    // Fallback a la tabla genérica CurvaACResistencia
    acResult = estimarAC(curvasAC, resistenciaMpa, edadDias, cemento.familiaCemento || cemento.composicion || null);
    acOrigenTipo = ORIGEN_TIPO.CURVA;
    acOrigenRef = acResult.curvasUsadas?.[0]?.nombre
      ? `ACI a/c-resistencia · ${acResult.curvasUsadas[0].nombre}`
      : 'ACI a/c-resistencia';
    if (curvaCemento) {
      // Curva cargada pero sin datos para esta edad
      acOrigenObs = `La curva "${curvaCemento.nombre}" no tiene datos para ${edadDias} días; se usó tabla genérica a/c-resistencia.`;
    } else if (curvaCementoOrigen === null && cemento) {
      acOrigenObs = 'El cemento seleccionado no tiene curva de cemento específica ni de familia cargada; se usó tabla genérica a/c-resistencia.';
    }
  }

  trazabilidad.relacionAC = acResult;

  if (!acResult.acEstimado) {
    warnings.push({ campo: 'ac', msg: acResult.error || 'No se pudo estimar a/c', tipo: 'error' });
    return { resultado: null, trazabilidad, warnings };
  }
  if (acResult.warning) {
    warnings.push({ campo: 'ac', msg: acResult.warning, tipo: 'advertencia' });
  }
  if (acOrigenObs && acOrigenTipo !== ORIGEN_TIPO.CURVA_CEMENTO) {
    warnings.push({ campo: 'curvaCemento', msg: acOrigenObs, tipo: 'info' });
  }

  pushFuente(fuentesCalculo, {
    parametro: 'Curva de cemento (a/c)',
    valor: trazabilidad.curvaCementoUsada
      ? `${trazabilidad.curvaCementoUsada.nombre} — ${edadDias} días`
      : 'Tabla genérica a/c-resistencia',
    origenTipo: acOrigenTipo,
    origenRef: acOrigenRef,
    regla: trazabilidad.curvaCementoUsada
      ? trazabilidad.curvaCementoUsada.origenLabel
      : 'Fallback: sin curva de cemento cargada para el cemento seleccionado',
    observacion: acOrigenObs,
    criticidad: acOrigenObs ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
  });
  pushFuente(fuentesCalculo, {
    parametro: 'a/c estimada',
    valor: acResult.acEstimado,
    origenTipo: acOrigenTipo,
    origenRef: acOrigenRef,
    regla: `${metodoLabel(acResult.metodo)} · Resistencia ${resistenciaMpa} MPa · Edad ${edadDias} días`,
    observacion: acResult.warning || null,
    criticidad: acResult.warning ? CRITICIDAD.WARNING : CRITICIDAD.INFO,
  });

  const ac = acResult.acEstimado;

  // ── Step 5: Cemento total ────────────────────────────────────────────────────
  const cementoTotal = Math.round(aguaFinal / ac);
  trazabilidad.cementoCalculado = { aguaFinal, ac, cementoTotal, formula: 'cemento = agua / (a/c)' };
  pushFuente(fuentesCalculo, {
    parametro: 'Cemento calculado',
    valor: `${cementoTotal} kg/m³`,
    origenTipo: ORIGEN_TIPO.CALCULADO,
    regla: `cemento = agua / (a/c) = ${aguaFinal} / ${ac} ≈ ${cementoTotal} kg/m³`,
  });

  if (cementoTotal < 200) warnings.push({ campo: 'cemento', msg: `Cemento ${cementoTotal} kg/m³ es muy bajo`, tipo: 'advertencia' });
  if (cementoTotal > 550) warnings.push({ campo: 'cemento', msg: `Cemento ${cementoTotal} kg/m³ es muy alto`, tipo: 'advertencia' });
  if (ac < 0.30) warnings.push({ campo: 'ac', msg: `a/c ${ac.toFixed(2)} es muy baja`, tipo: 'advertencia' });
  if (ac > 0.80) warnings.push({ campo: 'ac', msg: `a/c ${ac.toFixed(2)} es muy alta`, tipo: 'advertencia' });

  // ── Step 6: Adiciones (reemplazo) ───────────────────────────────────────────
  let cementoKg = cementoTotal;
  let adicion1Kg = 0;
  let adicion2Kg = 0;
  trazabilidad.adiciones = [];

  if (adicion1 && adicion1.reemplazoPct > 0) {
    adicion1Kg = Math.round(cementoTotal * adicion1.reemplazoPct / 100);
    cementoKg = cementoTotal - adicion1Kg;
    trazabilidad.adiciones.push({ adicion: 'adicion1', reemplazoPct: adicion1.reemplazoPct, kgM3: adicion1Kg, cementoRestante: cementoKg });
  }
  if (adicion2 && adicion2.reemplazoPct > 0) {
    adicion2Kg = Math.round(cementoTotal * adicion2.reemplazoPct / 100);
    cementoKg = cementoKg - adicion2Kg;
    trazabilidad.adiciones.push({ adicion: 'adicion2', reemplazoPct: adicion2.reemplazoPct, kgM3: adicion2Kg, cementoRestante: cementoKg });
  }

  // ── Step 7: Aditivos (dosis) ─────────────────────────────────────────────────
  const aditivos = [];
  trazabilidad.aditivos = [];

  const calcDosisAditivo = (adit, label) => {
    if (!adit || !adit.dosis) return;
    const dosis = Number(adit.dosis);
    let kgM3 = null;
    const unidad = adit.unidadDosificacion || 'PORC_SOBRE_CEMENTO';
    const unidadLabel = UNIDAD_DOSIS_LABELS[unidad] || unidad;
    if (unidad === 'PORC_SOBRE_CEMENTO') {
      kgM3 = Math.round((cementoTotal * dosis / 100) * 100) / 100;
    } else if (unidad === 'ML_POR_100KG_CEMENTO') {
      kgM3 = Math.round((cementoTotal * dosis / 100000) * 100) / 100;
    } else if (unidad === 'KG_M3') {
      kgM3 = dosis;
    }
    aditivos.push({ label, dosis, unidad, unidadLabel, kgM3 });
    trazabilidad.aditivos.push({ label, dosis, unidad, unidadLabel, kgM3 });
  };
  calcDosisAditivo(aditivo1, 'aditivo1');
  calcDosisAditivo(aditivo2, 'aditivo2');

  // ── Step 8: Agregados (distribución según mezcla) ───────────────────────────
  const agregados = [];
  trazabilidad.mezclaBase = mezcla
    ? { idMezcla: mezcla.idMezcla, nombre: mezcla.nombre, codigo: mezcla.codigo || null, tmnCalculadoMm: mezcla.tmnCalculadoMm }
    : null;

  if (mezcla && mezcla.items && mezcla.items.length > 0) {
    const totalPct = mezcla.items.reduce((s, it) => s + Number(it.porcentaje || 0), 0);
    mezcla.items.forEach(it => {
      const pct = totalPct > 0 ? Number(it.porcentaje) / totalPct : 0;
      agregados.push({
        nombre: it.nombre,
        porcentaje: Number(it.porcentaje),
        proporcionNormalizada: Math.round(pct * 10000) / 100,
        // Granulometry source metadata (MEJ-5)
        granulometriaFecha: it._granulometriaFecha || null,
        granulometriaEnsayoId: it._granulometriaEnsayoId || null,
        granulometriaCodigo: it._granulometriaCodigo || null,
        granulometriaPuntos: it._granulometriaPuntos || null,
        pasante300um: it._pasante300um ?? null,
        pasante75um: it._pasante75um ?? null,
      });
    });
    trazabilidad.agregadosDistribucion = {
      metodo: 'PROPORCIONAL',
      nota: 'Distribución proporcional según mezcla; método de volumen absoluto pendiente de implementar',
      items: agregados,
    };
    pushFuente(fuentesCalculo, {
      parametro: 'Distribución de agregados',
      valor: 'Proporcional',
      origenTipo: ORIGEN_TIPO.MEZCLA,
      origenRef: mezcla.nombre || null,
      regla: 'Distribución proporcional según los porcentajes de la mezcla granulométrica seleccionada',
    });
  } else {
    warnings.push({ campo: 'mezcla', msg: 'No hay mezcla granulométrica seleccionada', tipo: 'advertencia' });
  }

  // ── Step 9: Densidad cemento para chequeo ────────────────────────────────────
  const densidadCemento = cemento.densidadRelativa ? Number(cemento.densidadRelativa) : 3.15;

  // ── Tipo de aire ──
  const tipoAire = aireIntencionalACI ? 'INTENCIONAL' : 'NATURAL';
  trazabilidad.tipoAire = tipoAire;
  trazabilidad.aireAtrapado = aireAtrapado;
  trazabilidad.aireIncorporado = aireIncorporado;

  // ── Balance de volúmenes ──────────────────────────────────────────────────
  const volAgua = aguaFinal / 1000;
  const volCemento = cementoKg / (densidadCemento * 1000);
  const volAire = airePct / 100;
  let volAdiciones = 0;
  if (adicion1Kg > 0 && adicion1?.densidadRelativa) volAdiciones += adicion1Kg / (Number(adicion1.densidadRelativa) * 1000);
  if (adicion2Kg > 0 && adicion2?.densidadRelativa) volAdiciones += adicion2Kg / (Number(adicion2.densidadRelativa) * 1000);
  const volPasta = volAgua + volCemento + volAire + volAdiciones;
  const volAgregadosTotal = 1.0 - volPasta;

  const balanceVol = {
    vAgua:      Math.round(volAgua * 1000 * 10) / 10,
    vCemento:   Math.round(volCemento * 1000 * 10) / 10,
    vAire:      Math.round(volAire * 1000 * 10) / 10,
    vAdiciones: Math.round(volAdiciones * 1000 * 10) / 10,
    vPasta:     Math.round(volPasta * 1000 * 10) / 10,
    vAgregados: Math.round(volAgregadosTotal * 1000 * 10) / 10,
    totalLM3:   Math.round((volPasta + volAgregadosTotal) * 1000 * 10) / 10,
    formula: 'V_agua + V_cemento + V_aire + V_adiciones + V_agregados = 1000 L/m³',
  };
  trazabilidad.balanceVolumenes = balanceVol;

  // ── PUV teórico ───────────────────────────────────────────────────────────
  const pesoAgregados = agregados.reduce((s, ag) => s + (ag.kgM3 || 0), 0);
  const puvTeorico = Math.round(aguaFinal + cementoTotal + adicion1Kg + adicion2Kg + pesoAgregados);
  trazabilidad.puvTeorico = { valor: puvTeorico, unidad: 'kg/m³', nota: 'Suma de pesos SSS — dato de referencia para pastón de prueba' };

  // ── Build resultado ──────────────────────────────────────────────────────────
  const resultado = {
    metodo: 'ACI_211',
    motorVersion: MOTOR_VERSION_ACI,
    aguaLtsM3: aguaFinal,
    ac,
    airePct,
    aireAtrapado,
    aireIncorporado,
    tipoAire,
    cementoTotalKgM3: cementoTotal,
    cementoKgM3: cementoKg,
    adicion1KgM3: adicion1Kg || null,
    adicion2KgM3: adicion2Kg || null,
    aditivos,
    agregados,
    densidadCementoUsada: densidadCemento,
    volumenPasta: Math.round(volPasta * 1000) / 1000,
    volumenAgregados: Math.round(volAgregadosTotal * 1000) / 1000,
    balanceVolumenes: balanceVol,
    puvTeorico,
  };

  return { resultado, trazabilidad, warnings };
}

module.exports = { calcularDosificacion, estimarAguaBase, estimarAC, estimarACdesdeCurvaCemento, MOTOR_VERSION_ACI, UNIDAD_DOSIS_LABELS };
