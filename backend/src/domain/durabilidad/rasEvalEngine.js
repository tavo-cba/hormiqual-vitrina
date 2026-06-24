'use strict';

/**
 * rasEvalEngine.js — PR8.12
 *
 * Sistema RAS (Reacción Álcali-Sílice) prescriptivo completo según
 * CIRSOC 200:2024 Anexo A2-2.
 *
 * El Anexo A2-2 implementa un protocolo de prevención determinista basado
 * en cinco tablas:
 *
 *   Tabla A2-2.2 — Niveles de reactividad del agregado (R0..R3) a partir
 *                  de ensayos petrográfico (IRAM 1649) y métodos acelerados
 *                  (IRAM 1674 barra de mortero, IRAM 1700 prismas hormigón).
 *   Tabla A2-2.3 — Matriz de riesgo: dimensión del elemento × clase de
 *                  exposición × nivel R → riesgo {bajo, medio, alto, muy_alto}.
 *   Tabla A2-2.4 — Clase de la estructura S1..S4 (vida útil + consecuencias
 *                  de falla, p.ej. S1 vida 50 años + consecuencias bajas).
 *   Tabla A2-2.5 — Matriz de prevención: riesgo × S → nivel de prevención
 *                  {V, W, X, Y, Z, ZZ}. ZZ = no permitido.
 *   Tabla A2-2.6 — Contenido máximo de álcalis del hormigón (kg Na₂O eq /m³)
 *                  por nivel de prevención.
 *   Tabla A2-2.7 — Contenido mínimo de adición mineral activa (AMA) requerido
 *                  por nivel de prevención + tipo de adición.
 *
 * El motor:
 *  1. Determina el nivel R del agregado (a partir de los ensayos cargados o
 *     del nivel declarado por el usuario / Tabla A2-2.2 default por origen).
 *  2. Determina el riesgo (Tabla A2-2.3) usando dimensión + exposición + R.
 *  3. Lee la clase S de la estructura (Tabla A2-2.4).
 *  4. Determina el nivel de prevención (Tabla A2-2.5) usando riesgo × S.
 *  5. Lee los requisitos del nivel: álcalis máximos (Tabla A2-2.6) +
 *     adición mineral activa mínima (Tabla A2-2.7).
 *  6. Si el nivel es ZZ → la combinación NO está permitida (error técnico).
 *
 * Función PURA: recibe parámetros + ensayos + catálogos, devuelve veredicto.
 * No toca DB.
 *
 * Las constantes numéricas reproducen valores de Anexo A2-2 CIRSOC 200:2024.
 * Si la norma se actualiza, modificarlas acá y los tests se actualizan.
 */

const NIVELES_R = ['R0', 'R1', 'R2', 'R3']; // R0 = no reactivo; R3 = muy reactivo
const CLASES_S = ['S1', 'S2', 'S3', 'S4'];   // S1 = bajo riesgo; S4 = crítico
const NIVELES_PREVENCION = ['V', 'W', 'X', 'Y', 'Z', 'ZZ']; // V = mínimo; ZZ = no permitido

// Niveles de riesgo según Tabla A2-2.3 (CIRSOC 200:2024 Anexo A2-2): 1..5,
// donde 1 es el menor y 5 el mayor. La norma usa números, NO categorías
// textuales (auditoría 01-calidad C7 sesión 2026-05-07).
const RIESGOS = [1, 2, 3, 4, 5];

// ════════════════════════════════════════════════════════════════════════════
// Tabla A2-2.2 — Niveles R por método (umbrales)
// ════════════════════════════════════════════════════════════════════════════
//
// Atribución de fuentes (revisión 2026-05-04, ver
// docs/normativa/IRAM_RAS_alcances.md):
//
//   - IRAM 1649 (petrográfico): solo clasifica binariamente "cumple /
//     no cumple". Los niveles R los asigna acá la matriz de CIRSOC, no
//     la propia IRAM 1649.
//
//   - IRAM 1674 (barra de mortero, método acelerado 16 d a 80°C, NaOH 1N):
//     IRAM 1674 establece un único umbral binario clásico (~0,10 %).
//     Los escalones intermedios y R3 (0,20 / 0,30 %) provienen de
//     CIRSOC 200-2024 Anexo A2-2 Tabla A2-2.2, no de IRAM 1674.
//
//   - IRAM 1700:1997 (prismas de hormigón a 38°C, expansión final L%):
//     IRAM 1700 §B.3 establece UN único umbral binario:
//       "el valor límite de expansión aconsejado por la literatura
//        internacional y la experiencia existente en nuestro país es de
//        0,04 % a los 12 meses de edad"
//     Los escalones 0,08 % y 0,12 % NO están en IRAM 1700 — provienen de
//     CIRSOC 200-2024 Anexo A2-2 Tabla A2-2.2 (cuatro niveles R0..R3).
//
//   El motor implementa la matriz CIRSOC porque es la fuente de los
//   cuatro niveles R. Si solo se quisiera el dictamen binario IRAM 1700,
//   usar `cumpleUmbralIRAM1700()` más abajo.
function nivelRDesdeMortero(expansionPct) {
  // CIRSOC 200-2024 Tabla A2-2.2, fila "Mortero acelerado IRAM 1674".
  if (expansionPct < 0.10) return 'R0';
  if (expansionPct < 0.20) return 'R1';
  if (expansionPct < 0.30) return 'R2';
  return 'R3';
}

function nivelRDesdePrisma(expansionPct) {
  // CIRSOC 200-2024 Tabla A2-2.2, fila "Prismas de hormigón IRAM 1700".
  if (expansionPct < 0.04) return 'R0';
  if (expansionPct < 0.08) return 'R1';
  if (expansionPct < 0.12) return 'R2';
  return 'R3';
}

/**
 * Veredicto binario directo según IRAM 1700:1997 §B.3 (valor límite 0,04 %
 * a 12 meses). Útil para reportes de cumplimiento normativo "puro" de IRAM
 * cuando no se quiere mezclar con la matriz CIRSOC.
 *
 * @param {number} expansionPct  Expansión final L (%) del prisma a 12 meses.
 * @returns {{cumple:boolean, limite:number, mensaje:string}}
 */
function cumpleUmbralIRAM1700(expansionPct) {
  const limite = 0.04;
  const cumple = Number(expansionPct) < limite;
  return {
    cumple,
    limite,
    mensaje: cumple
      ? `Expansión ${expansionPct}% < ${limite}% a 12 meses (IRAM 1700:1997 §B.3) — agregado no reactivo.`
      : `Expansión ${expansionPct}% ≥ ${limite}% a 12 meses (IRAM 1700:1997 §B.3) — agregado potencialmente reactivo.`,
    norm: 'IRAM 1700:1997 §B.3',
  };
}

// Si hay múltiples ensayos, se toma el peor caso (mayor R).
function _peorR(rs) {
  return rs.reduce((peor, r) => NIVELES_R.indexOf(r) > NIVELES_R.indexOf(peor) ? r : peor, 'R0');
}

/**
 * @param {object} ensayos - {
 *   petrografico: 'cumple' | 'no_cumple_reactivo' | 'no_cumple_otro',
 *   morteroAceleradoExpansion16dPct: number,
 *   prismaHormigonExpansionFinalPct: number,
 * }
 * @param {string} nivelDeclarado - opcional, default por origen
 * @returns {{ nivelR, fuente, detalle }}
 */
function determinarNivelR(ensayos = {}, nivelDeclarado = null) {
  const detalle = [];
  const candidatos = [];

  if (ensayos.morteroAceleradoExpansion16dPct != null) {
    const r = nivelRDesdeMortero(Number(ensayos.morteroAceleradoExpansion16dPct));
    candidatos.push(r);
    detalle.push(`Mortero acelerado IRAM 1674: ${ensayos.morteroAceleradoExpansion16dPct}% → ${r}`);
  }
  if (ensayos.prismaHormigonExpansionFinalPct != null) {
    const r = nivelRDesdePrisma(Number(ensayos.prismaHormigonExpansionFinalPct));
    candidatos.push(r);
    detalle.push(`Prisma de hormigón IRAM 1700: ${ensayos.prismaHormigonExpansionFinalPct}% → ${r}`);
  }
  if (ensayos.petrografico === 'cumple') {
    candidatos.push('R0');
    detalle.push('Petrográfico IRAM 1649: no reactivo → R0');
  } else if (ensayos.petrografico === 'no_cumple_reactivo') {
    candidatos.push('R2');
    detalle.push('Petrográfico IRAM 1649: potencialmente reactivo → R2 (default sin métodos cuantitativos)');
  }

  if (candidatos.length === 0 && nivelDeclarado) {
    detalle.push(`Sin ensayos — nivel declarado por origen: ${nivelDeclarado}`);
    return { nivelR: nivelDeclarado, fuente: 'declarado', detalle };
  }
  if (candidatos.length === 0) {
    return { nivelR: null, fuente: 'sin_dato', detalle: ['Sin ensayos ni nivel declarado.'] };
  }

  const peor = _peorR(candidatos);
  return { nivelR: peor, fuente: 'ensayos (peor caso)', detalle };
}

// ════════════════════════════════════════════════════════════════════════════
// Tabla A2-2.3 — Riesgo de RAS (CIRSOC 200:2024 Anexo A2-2)
// ════════════════════════════════════════════════════════════════════════════
//
// La tabla literal tiene 3 filas de combinación tamaño × condición de
// exposición, cada una con 4 columnas (R0, R1, R2, R3):
//
//                                                       R0  R1  R2  R3
//   ≤ 0,90 m  +  seco (HR < 60% promedio)                1   1   2   3
//   > 0,90 m  +  seco                                    1   2   3   4
//   Aire húmedo / enterrado / sumergido (cualquier dim)  1   3   4   5
//
// Nota (1) Tabla A2-2.3: "Se considera ambiente seco cuando la humedad
// relativa ambiente promedio es menor a 60%."
//
// Mapeo de clases CIRSOC §2.2.4 a la condición binaria seco / no seco:
//   seco (HR < 60%)     → A1 (atmósfera benigna interior),
//                         A2 (atmósfera moderada exterior — HR baja)
//   no seco             → A3 (atmósfera agresiva, HR alta) y todas las
//                         clases con humedad explícita: CL/M/C/Q
//
// Mapeo de dimensión:
//   `dimension` puede llegar como número (metros) o como categoría textual
//   ('pequeña' / 'mediana' / 'grande'). En textual: ≤ 0,90 m corresponde a
//   'pequeña' o 'mediana' (legacy hasta 1 m); > 0,90 m corresponde a 'grande'.
//
// @returns número 1..5 (riesgo de RAS), o null si nivelR es desconocido.
const _CLASES_SECAS = new Set(['A1', 'A2']);

function _esCondicionSeca(exposicion) {
  const expClass = String(exposicion || '').toUpperCase();
  return _CLASES_SECAS.has(expClass);
}

function _dimensionEsMayorDe090(dimension) {
  if (typeof dimension === 'number' && Number.isFinite(dimension)) {
    return dimension > 0.90;
  }
  const dim = String(dimension || '').toLowerCase();
  // Categorías textuales legacy: 'pequeña' (≤ 0,5), 'mediana' (0,5–1), 'grande' (> 1).
  // Para Tabla A2-2.3 lo único que importa es el corte 0,90 m → 'grande' es el único > 0,90 m.
  return dim === 'grande';
}

function matrizRiesgo(dimension, exposicion, nivelR) {
  const rNum = NIVELES_R.indexOf(nivelR);
  if (rNum < 0) return null; // R desconocido

  const seco = _esCondicionSeca(exposicion);
  const dimGrande = _dimensionEsMayorDe090(dimension);

  // Tabla A2-2.3 literal: cada fila es un array indexado por nivelR (0=R0..3=R3).
  //   Fila A: ≤ 0,90 m + seco       → [1, 1, 2, 3]
  //   Fila B: > 0,90 m + seco       → [1, 2, 3, 4]
  //   Fila C: aire húmedo/sumergido → [1, 3, 4, 5]
  if (seco) {
    return dimGrande ? [1, 2, 3, 4][rNum] : [1, 1, 2, 3][rNum];
  }
  return [1, 3, 4, 5][rNum];
}

// ════════════════════════════════════════════════════════════════════════════
// Tabla A2-2.5 — Niveles de prevención requeridos (CIRSOC 200:2024 Anexo A2-2)
// ════════════════════════════════════════════════════════════════════════════
// Riesgo (filas, 1..5) × Clase de estructura (columnas, S1..S4):
//
//   Riesgo  S1  S2  S3  S4
//     1     V   V   V   V
//     2     V   V   W   X
//     3     V   W   X   Y
//     4     W   X   Y   Z
//     5     X   Y   Z   ZZ
//
// Tabla literal de CIRSOC 200:2024 Anexo A2-2 §5 (auditoría 01-calidad C7
// sesión 2026-05-07: reemplazo de matriz heurística por tabla literal).
const MATRIZ_PREVENCION = {
  1: { S1: 'V', S2: 'V', S3: 'V', S4: 'V' },
  2: { S1: 'V', S2: 'V', S3: 'W', S4: 'X' },
  3: { S1: 'V', S2: 'W', S3: 'X', S4: 'Y' },
  4: { S1: 'W', S2: 'X', S3: 'Y', S4: 'Z' },
  5: { S1: 'X', S2: 'Y', S3: 'Z', S4: 'ZZ' },
};

function nivelPrevencion(riesgo, claseS) {
  const fila = MATRIZ_PREVENCION[riesgo];
  if (!fila) return null;
  return fila[claseS] || null;
}

// ════════════════════════════════════════════════════════════════════════════
// Tabla A2-2.6 — Álcalis máximos (kg Na₂O eq /m³ hormigón) por nivel
// ════════════════════════════════════════════════════════════════════════════
// Valores literales de Tabla A2-2.6 CIRSOC 200:2024 (auditoría 01-calidad C7,
// corrección 2026-05-07: V=null era 4.0; Z=1.8 era 1.2 espurio):
//   V   → "No se requiere ningún límite" → null
//   W   → 3,0
//   X   → 2,4
//   Y   → 1,8
//   Z   → (ver Tabla A2-2.8: 1,8 con AMA correspondiente al nivel Y; sin AMA no se admite)
//   ZZ  → (ver Tablas A2-2.7 y A2-2.8: 1,8 con AMA correspondiente al nivel Z; sin AMA no permitido)
//
// Para Z y ZZ usamos 1,8 (criterio Tabla A2-2.8 con AMA limitada). Si la
// dosificación no incorpora AMA, debería bloquearse antes de llegar a esta
// verificación.
const ALCALIS_MAX_KG_M3 = {
  V:  null, // no se requiere límite
  W:  3.0,
  X:  2.4,
  Y:  1.8,
  Z:  1.8,  // Tabla A2-2.8: con álcalis ≤ 1,8 + AMA nivel Y
  ZZ: null, // no permitido sin AMA (manejado fuera del flujo de álcalis)
};

// ════════════════════════════════════════════════════════════════════════════
// Tabla A2-2.7 — AMA mínimo (% en masa del ligante) por nivel y tipo
// ════════════════════════════════════════════════════════════════════════════
//
// Estructura literal de Tabla A2-2.7 CIRSOC 200:2024 (auditoría 01-calidad
// C20 sesión 2026-05-07):
//
//   Tipo de AMA            % Na2Oeq de la AMA       W    X    Y    Z       ZZ
//   Ceniza volante F        < 3,0                   15   20   25   35
//   (CaO ≤ 18%)             3,0 – 4,5               20   25   30   40    Ver
//   Escoria alto horno      < 1,0                   25   35   50   65    Tabla
//   Humo de sílice          —                       2,0× 2,5× 3,0× 4,0×  A2-2.8
//   (Si2O ≥ 85%) (1)
//
//   (1) AH = contenido de álcalis del hormigón (kg Na2Oeq/m³). Para humo de
//       sílice los valores son factor × AH y el contenido nunca debe superar 7%.
//
// La norma cubre EXPLÍCITAMENTE solo CV-F, escoria de alto horno y humo de
// sílice. Otros tipos (puzolana natural, etc.) caen fuera de Tabla A2-2.7 y
// requieren ensayos específicos / criterio del Director de Obra.
//
// Tabla A2-2.9 (ajuste por contenido de álcalis del CEMENTO, no de la AMA)
// NO se aplica acá: ajusta el NIVEL de prevención, no las celdas de A2-2.7
// (deuda separada — se aplicaría antes de invocar `obtenerAmaMinPct`).
const TABLA_A2_2_7 = Object.freeze({
  ceniza_volante_F: Object.freeze({
    // Fila < 3,0% Na2Oeq (CV de bajo contenido de álcalis).
    baja_alcalis: Object.freeze({ W: 15, X: 20, Y: 25, Z: 35 }),
    // Fila 3,0–4,5% Na2Oeq.
    alta_alcalis: Object.freeze({ W: 20, X: 25, Y: 30, Z: 40 }),
    rangoAltoMin: 3.0,
    rangoAltoMax: 4.5,
  }),
  escoria_alto_horno: Object.freeze({
    // Fila < 1,0% Na2Oeq (escoria de bajo álcalis).
    valores: Object.freeze({ W: 25, X: 35, Y: 50, Z: 65 }),
    umbralAlcalisMaxPct: 1.0,
  }),
  humo_silice: Object.freeze({
    // Factor por nivel sobre AH (kg Na2Oeq/m³). Tope absoluto 7%.
    factores: Object.freeze({ W: 2.0, X: 2.5, Y: 3.0, Z: 4.0 }),
    capPct: 7,
  }),
});

const _AMA_TIPOS_CUBIERTOS = ['ceniza_volante_F', 'escoria_alto_horno', 'humo_silice'];

/**
 * Obtiene el % mínimo de AMA exigido por Tabla A2-2.7 para un nivel y tipo
 * dado. Devuelve forma rica con observaciones, no solo número, porque para
 * humo de sílice y CV alta-alcalis se necesita contexto adicional.
 *
 * @param {string} nivelPrev   'V'|'W'|'X'|'Y'|'Z'|'ZZ'
 * @param {string} amaTipo     'ceniza_volante_F'|'escoria_alto_horno'|'humo_silice'
 * @param {object} ctx
 * @param {number} [ctx.contenidoAlcalisAmaPct]   % Na2Oeq de la AMA (necesario p/ CV).
 * @param {number} [ctx.alcalisHormigonKgM3]      AH (necesario p/ humo de sílice).
 * @returns {{ pctMin:number|null, fuente:string|null, formula?:string, capAplicado?:boolean, observacion?:string }}
 */
function obtenerAmaMinPct(nivelPrev, amaTipo, ctx = {}) {
  if (nivelPrev === 'V') {
    return { pctMin: 0, fuente: 'nivel_V_sin_requisito' };
  }
  if (nivelPrev === 'ZZ') {
    return {
      pctMin: null,
      fuente: 'tabla_A2_2_8',
      observacion: 'Nivel ZZ: AMA como único método no permitido. Ver Tabla A2-2.8 (alternativa con álcalis ≤ 1,8 + AMA).',
    };
  }
  if (!['W', 'X', 'Y', 'Z'].includes(nivelPrev)) {
    return { pctMin: null, fuente: null };
  }
  if (!_AMA_TIPOS_CUBIERTOS.includes(amaTipo)) {
    return {
      pctMin: null,
      fuente: 'tipo_no_cubierto',
      observacion: `Tipo "${amaTipo}" fuera de Tabla A2-2.7 — requiere criterio del Director de Obra / ensayos específicos.`,
    };
  }

  if (amaTipo === 'ceniza_volante_F') {
    const alc = ctx.contenidoAlcalisAmaPct;
    if (alc == null) {
      return {
        pctMin: null,
        fuente: 'requiere_alcalis_ama',
        observacion: 'Ceniza volante F: especificar % Na2Oeq de la AMA (fila <3,0 vs 3,0–4,5 de Tabla A2-2.7).',
      };
    }
    if (alc < TABLA_A2_2_7.ceniza_volante_F.rangoAltoMin) {
      return { pctMin: TABLA_A2_2_7.ceniza_volante_F.baja_alcalis[nivelPrev], fuente: 'tabla_A2_2_7_cv_baja_alcalis' };
    }
    if (alc <= TABLA_A2_2_7.ceniza_volante_F.rangoAltoMax) {
      return { pctMin: TABLA_A2_2_7.ceniza_volante_F.alta_alcalis[nivelPrev], fuente: 'tabla_A2_2_7_cv_alta_alcalis' };
    }
    return {
      pctMin: null,
      fuente: 'cv_fuera_de_rango',
      observacion: `Ceniza volante con ${alc}% Na2Oeq excede 4,5% — fuera del rango de Tabla A2-2.7.`,
    };
  }

  if (amaTipo === 'escoria_alto_horno') {
    return { pctMin: TABLA_A2_2_7.escoria_alto_horno.valores[nivelPrev], fuente: 'tabla_A2_2_7_escoria' };
  }

  // humo_silice
  const ah = Number(ctx.alcalisHormigonKgM3);
  if (!Number.isFinite(ah)) {
    return {
      pctMin: null,
      fuente: 'requiere_ah',
      observacion: 'Humo de sílice: el mínimo se calcula como factor × AH (kg Na2Oeq/m³ del hormigón) — Tabla A2-2.7 nota (1).',
    };
  }
  const factor = TABLA_A2_2_7.humo_silice.factores[nivelPrev];
  const cap = TABLA_A2_2_7.humo_silice.capPct;
  const calc = factor * ah;
  const aplicaCap = calc > cap;
  return {
    pctMin: aplicaCap ? cap : calc,
    formula: `${factor} × AH(${ah} kg/m³) = ${calc.toFixed(2)}%`,
    capAplicado: aplicaCap,
    fuente: 'tabla_A2_2_7_humo_silice',
    observacion: aplicaCap ? `Se aplica tope de ${cap}% (Tabla A2-2.7 nota 1).` : undefined,
  };
}

// Vista heredada del catálogo plano (deprecada — preserva acceso por nivel/tipo
// para inspección externa; no para evaluación). Para CV usa la fila baja-álcalis
// (representativa); para humo de sílice expone factor (no %) — interpretación
// completa requiere `obtenerAmaMinPct`.
const AMA_MIN_PCT = Object.freeze({
  V:  Object.freeze({ ceniza_volante_F: 0,                                              escoria_alto_horno: 0,  humo_silice: 0   }),
  W:  Object.freeze({ ceniza_volante_F: TABLA_A2_2_7.ceniza_volante_F.baja_alcalis.W,    escoria_alto_horno: TABLA_A2_2_7.escoria_alto_horno.valores.W, humo_silice_factor_ah: TABLA_A2_2_7.humo_silice.factores.W }),
  X:  Object.freeze({ ceniza_volante_F: TABLA_A2_2_7.ceniza_volante_F.baja_alcalis.X,    escoria_alto_horno: TABLA_A2_2_7.escoria_alto_horno.valores.X, humo_silice_factor_ah: TABLA_A2_2_7.humo_silice.factores.X }),
  Y:  Object.freeze({ ceniza_volante_F: TABLA_A2_2_7.ceniza_volante_F.baja_alcalis.Y,    escoria_alto_horno: TABLA_A2_2_7.escoria_alto_horno.valores.Y, humo_silice_factor_ah: TABLA_A2_2_7.humo_silice.factores.Y }),
  Z:  Object.freeze({ ceniza_volante_F: TABLA_A2_2_7.ceniza_volante_F.baja_alcalis.Z,    escoria_alto_horno: TABLA_A2_2_7.escoria_alto_horno.valores.Z, humo_silice_factor_ah: TABLA_A2_2_7.humo_silice.factores.Z }),
});

/**
 * Evalúa un diseño contra el sistema prescriptivo RAS.
 *
 * @param {object} params - {
 *   nivelR | ensayos { petrografico, morteroAceleradoExpansion16dPct, prismaHormigonExpansionFinalPct },
 *   dimension: 'pequeña' | 'mediana' | 'grande',
 *   claseExposicion: clase CIRSOC §2.2.4,
 *   claseS: 'S1' | 'S2' | 'S3' | 'S4',
 *   nivelDeclaradoR: opcional default por origen,
 *
 *   // Datos del diseño para verificar requisitos:
 *   alcalisCementoKgM3: kg Na₂O eq aportados por el cemento al hormigón (= cemento × %álcalis),
 *   alcalisHormigonKgM3: opcional. AH del hormigón (kg Na2Oeq/m³). Si no se pasa,
 *                        se asume = alcalisCementoKgM3 (§6.4: las AMAs no aportan AH).
 *   amaTipo: 'ceniza_volante_F' | 'escoria_alto_horno' | 'humo_silice' (los 3 cubiertos por A2-2.7),
 *   amaContenidoAlcalisPct: % Na2Oeq de la AMA (necesario para CV — fila <3,0 vs 3,0–4,5),
 *   amaPctSustitucion: % sustitución del cementicio,
 * }
 * @returns {{
 *   valido, nivelR, riesgo, claseS, nivelPrevencion, requisitos: { alcalisMaxKgM3, amaMinPct },
 *   verificaciones: { alcalis, ama }, mensajes, advertencias, fuente
 * }}
 */
function evaluarRAS(params) {
  const out = {
    valido: false,
    nivelR: null,
    riesgo: null,
    claseS: null,
    nivelPrevencion: null,
    requisitos: {},
    verificaciones: {},
    mensajes: [],
    advertencias: [],
    fuente: 'CIRSOC 200:2024 Anexo A2-2',
  };

  // ── 1. Nivel R ──
  let determinacion;
  if (params.nivelR) {
    determinacion = { nivelR: params.nivelR, fuente: 'directo', detalle: [`Nivel R provisto: ${params.nivelR}`] };
  } else if (params.ensayos) {
    determinacion = determinarNivelR(params.ensayos, params.nivelDeclaradoR);
  } else if (params.nivelDeclaradoR) {
    determinacion = { nivelR: params.nivelDeclaradoR, fuente: 'declarado', detalle: [`Nivel R declarado por origen: ${params.nivelDeclaradoR}`] };
  } else {
    out.mensajes.push('Sin nivel R ni ensayos ni declaración por origen.');
    return out;
  }
  if (!determinacion.nivelR) {
    out.mensajes.push('No se pudo determinar nivel R del agregado.');
    return out;
  }
  out.nivelR = determinacion.nivelR;
  out.fuenteR = determinacion.fuente;
  out.detalleR = determinacion.detalle;

  // ── 2. Riesgo (Tabla A2-2.3) ──
  out.riesgo = matrizRiesgo(params.dimension, params.claseExposicion, out.nivelR);
  if (out.riesgo === null || out.riesgo === undefined) {
    out.mensajes.push('Falta dimensión o clase de exposición para evaluar riesgo.');
    return out;
  }

  // ── 3. Clase S ──
  out.claseS = String(params.claseS || '').toUpperCase();
  if (!CLASES_S.includes(out.claseS)) {
    out.mensajes.push(`Clase de estructura "${params.claseS}" inválida. Esperado: S1..S4.`);
    return out;
  }

  // ── 4. Nivel de prevención (Tabla A2-2.5) ──
  out.nivelPrevencion = nivelPrevencion(out.riesgo, out.claseS);
  if (!out.nivelPrevencion) {
    out.mensajes.push(`No se pudo determinar nivel de prevención para riesgo=${out.riesgo}, S=${out.claseS}.`);
    return out;
  }
  if (out.nivelPrevencion === 'ZZ') {
    out.mensajes.push(`Combinación riesgo=${out.riesgo} × ${out.claseS} → ZZ: NO PERMITIDA. Cambiar agregado o reducir clase de la estructura.`);
    return out;
  }

  // ── 5. Requisitos (Tabla A2-2.6 + A2-2.7) ──
  const alcalisMax = ALCALIS_MAX_KG_M3[out.nivelPrevencion];
  out.requisitos.alcalisMaxKgM3 = alcalisMax;

  const amaTipo = params.amaTipo || null;
  if (amaTipo) {
    // C20 (auditoría 01-calidad): Tabla A2-2.7 distingue CV por % de álcalis
    // y define humo de sílice como factor × AH (kg Na2Oeq/m³). Si AH no se
    // pasa explícito, se usa alcalisCementoKgM3 (§6.4: AH NO debe contar
    // álcalis de la AMA; cuando el cemento es la única fuente, AH = aporte
    // del cemento al hormigón).
    const ahParaAMA = params.alcalisHormigonKgM3 != null
      ? params.alcalisHormigonKgM3
      : params.alcalisCementoKgM3;
    const amaResolucion = obtenerAmaMinPct(out.nivelPrevencion, amaTipo, {
      contenidoAlcalisAmaPct: params.amaContenidoAlcalisPct,
      alcalisHormigonKgM3: ahParaAMA,
    });
    out.requisitos.amaMinPct = amaResolucion.pctMin;
    out.requisitos.amaTipo = amaTipo;
    out.requisitos.amaFuente = amaResolucion.fuente;
    if (amaResolucion.formula) out.requisitos.amaFormula = amaResolucion.formula;
    if (amaResolucion.capAplicado) out.requisitos.amaCapAplicado = true;
    if (amaResolucion.observacion) out.advertencias.push(amaResolucion.observacion);
  } else if (out.nivelPrevencion !== 'V' && out.nivelPrevencion !== 'ZZ') {
    out.requisitos.amaMinPct = null;
    out.advertencias.push('Tipo de adición mineral no provisto — no se puede verificar AMA mínimo.');
  }

  // ── 6. Verificaciones ──
  // Nivel V: sin requisito de álcalis (Tabla A2-2.6 → null). No verificar
  // ni emitir advertencia — el cumplimiento es trivial.
  if (alcalisMax === null) {
    out.verificaciones.alcalis = { valor: params.alcalisCementoKgM3 ?? null, max: null, ok: true, noAplica: true };
  } else if (params.alcalisCementoKgM3 != null) {
    const a = Number(params.alcalisCementoKgM3);
    out.verificaciones.alcalis = { valor: a, max: alcalisMax, ok: a <= alcalisMax };
    if (!out.verificaciones.alcalis.ok) {
      out.mensajes.push(`Álcalis del hormigón ${a} kg/m³ exceden máximo ${alcalisMax} kg/m³ (nivel ${out.nivelPrevencion}).`);
    }
  } else {
    out.verificaciones.alcalis = { valor: null, max: alcalisMax, ok: null };
    out.advertencias.push(`Álcalis del hormigón no provistos — exigido ≤ ${alcalisMax} kg/m³ (nivel ${out.nivelPrevencion}).`);
  }

  if (out.requisitos.amaMinPct != null && out.requisitos.amaMinPct > 0) {
    if (params.amaPctSustitucion == null) {
      out.advertencias.push(`AMA tipo ${amaTipo} ≥ ${out.requisitos.amaMinPct}% exigido — no provisto.`);
      out.verificaciones.ama = { valor: null, min: out.requisitos.amaMinPct, ok: null };
    } else {
      const p = Number(params.amaPctSustitucion);
      out.verificaciones.ama = { valor: p, min: out.requisitos.amaMinPct, ok: p >= out.requisitos.amaMinPct };
      if (!out.verificaciones.ama.ok) {
        out.mensajes.push(`AMA ${p}% por debajo del mínimo ${out.requisitos.amaMinPct}% (nivel ${out.nivelPrevencion}, ${amaTipo}).`);
      }
    }
  }

  out.valido = (out.verificaciones.alcalis?.ok !== false)
    && (out.verificaciones.ama?.ok !== false);

  if (out.valido) {
    out.mensajes.unshift(`RAS aprobado: agregado ${out.nivelR}, riesgo ${out.riesgo}, ${out.claseS} → nivel de prevención ${out.nivelPrevencion}.`);
  }

  return out;
}

module.exports = {
  evaluarRAS,
  determinarNivelR,
  nivelRDesdeMortero,
  nivelRDesdePrisma,
  cumpleUmbralIRAM1700,
  matrizRiesgo,
  nivelPrevencion,
  NIVELES_R,
  CLASES_S,
  NIVELES_PREVENCION,
  RIESGOS,
  MATRIZ_PREVENCION,
  ALCALIS_MAX_KG_M3,
  AMA_MIN_PCT,
  TABLA_A2_2_7,
  obtenerAmaMinPct,
};
