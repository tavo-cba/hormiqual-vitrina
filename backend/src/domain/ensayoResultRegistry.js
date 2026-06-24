'use strict';

/**
 * ensayoResultRegistry.js
 *
 * Contrato de Resultado para ensayos de agregados.
 * Define schemas canónicos, alias de códigos, validación y normalización
 * del campo `resultado` de AgregadoEnsayo por tipoCodigo.
 *
 * Garantiza que tanto la carga manual como el import PDF/Excel converjan
 * al mismo formato canónico.
 */

/* ═══════════════════════════════════════════════════════════
   Alias → Código canónico
   ═══════════════════════════════════════════════════════════ */

/**
 * Mapa de alias → código canónico.
 * El canónico es el que se usa para validar/normalizar y para agrupar en resumen.
 */
const ALIAS_MAP = {
  // Granulometría: IRAM 1627 es alias/hidden → IRAM 1505 canónico
  IRAM1627_GRANULOMETRIA_ESPECIFICA: 'IRAM1505_GRANULOMETRIA',
  // PR6: PR3 separó IRAM1505_GRANULOMETRIA en dos tipos del catálogo
  // (_HORMIGON, _TBS). El motor de evaluación sigue conociendo solo el código
  // legacy `IRAM1505_GRANULOMETRIA`. Sin estos alias, `getCanonicalCodigo`
  // dejaba pasar los nuevos códigos sin transformar; el motor no encontraba
  // evaluador y retornaba `notEvaluated`/`notApplicable`, por lo que la
  // granulometría con `cumple=false` desaparecía del veredicto global.
  // Resultado observable (test5/test6): un agregado con granulometría fuera
  // de banda salía como "EVALUACIÓN INCOMPLETA" en vez de "NO APTO".
  //
  // Nota TBS: el evaluador legacy contrasta contra IRAM 1627 (curvas de
  // hormigón). Para `_TBS` la evaluación correcta es contra huso DNV y vive
  // en otro path (`agregadoEnsayoService.evaluarContraHusoReferencia`).
  // El alias canónico apunta igual al legacy para que el form/registry
  // encuentren el spec — el caller TBS NO debe usar `evaluarEnsayo`.
  IRAM1505_GRANULOMETRIA_HORMIGON: 'IRAM1505_GRANULOMETRIA',
  IRAM1505_GRANULOMETRIA_TBS: 'IRAM1505_GRANULOMETRIA',
  // Los Ángeles: IRAM 1512 es la antigua, IRAM 1532 la vigente
  IRAM1512_DESGASTE_LA: 'IRAM1532_DESGASTE_LA',
  IRAM1532_LOS_ANGELES: 'IRAM1532_DESGASTE_LA',
  // Densidad/Absorción grueso: old codes → canónico IRAM1533_DENSIDAD_GRUESO
  IRAM1520_DENSIDAD_ABSORCION_GRUESO: 'IRAM1533_DENSIDAD_GRUESO',
  IRAM1533_DENSIDAD_ABSORCION: 'IRAM1533_DENSIDAD_GRUESO',
  // Densidad/Absorción fino: old code → canónico IRAM1520_DENSIDAD_ABSORCION_FINO
  IRAM1520_DENSIDAD_ABSORCION: 'IRAM1520_DENSIDAD_ABSORCION_FINO',
  // Peso unitario: IRAM 1548 es la norma correcta, IRAM1531 era el código legacy
  IRAM1548_PESO_UNITARIO: 'IRAM1531_PESO_UNITARIO',
  // Equivalente arena: IRAM 1692 es la norma correcta, IRAM1882 era el código legacy
  IRAM1682_EQUIVALENTE_ARENA: 'IRAM1882_VALOR_EQUIVALENTE_ARENA',
};

/**
 * @param {string} codigo
 * @returns {string} El código canónico (o el mismo si no es alias)
 */
const getCanonicalCodigo = (codigo) => ALIAS_MAP[codigo] || codigo;

/**
 * @param {string} codigo
 * @returns {boolean} true si `codigo` es un alias (no es canónico)
 */
const isAliasCodigo = (codigo) => codigo in ALIAS_MAP;

/**
 * @returns {string[]} Lista de alias codes
 */
const getAliasCodesFor = (canonicalCodigo) =>
  Object.entries(ALIAS_MAP)
    .filter(([, v]) => v === canonicalCodigo)
    .map(([k]) => k);

/* ═══════════════════════════════════════════════════════════
   Helpers comunes
   ═══════════════════════════════════════════════════════════ */

/** Convierte string con coma decimal a number. Returns NaN si no parseable. */
const toNumber = (val) => {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').trim();
    const n = Number(cleaned);
    return isNaN(n) ? NaN : n;
  }
  return NaN;
};

/** Valida rango numérico; agrega a errors/warnings según strictness. */
const checkRange = (val, name, min, max, ctx) => {
  if (val == null) return;
  const n = toNumber(val);
  if (isNaN(n)) {
    ctx.errors.push(`${name}: valor no numérico (${val})`);
    return NaN;
  }
  if (n < min || n > max) {
    ctx.warnings.push(`${name}: valor ${n} fuera de rango esperado [${min}, ${max}]`);
  }
  return n;
};

/** Convierte un valor a number si es string; null pasa. */
const coerceNum = (val) => {
  if (val == null) return null;
  const n = toNumber(val);
  return isNaN(n) ? null : n;
};

/**
 * Like coerceNum but reports errors for non-numeric values.
 * Returns the coerced number or null.
 */
const coerceNumField = (obj, field, ctx) => {
  const val = obj[field];
  if (val == null) { obj[field] = null; return null; }
  const n = toNumber(val);
  if (isNaN(n)) {
    ctx.errors.push(`${field}: valor no numérico (${val})`);
    obj[field] = null;
    return null;
  }
  obj[field] = n;
  return n;
};

/** Valores válidos del campo operador (almacenados en DB) */
const OPERADOR_VALUES = [null, 'menor_que', 'mayor_que'];

/**
 * Normaliza el campo `operador` del resultado.
 * - 'exacto' o '' → null (valor exacto, no se persiste)
 * - Migra `esMenorQue: true` → `operador: 'menor_que'` (backward compat).
 * - Elimina `esMenorQue` del resultado tras la migración.
 */
const normalizeOperador = (resultado, ctx) => {
  // Backward compat: esMenorQue boolean → operador string
  if (resultado.esMenorQue != null && resultado.operador == null) {
    if (resultado.esMenorQue === true || resultado.esMenorQue === 'true') {
      resultado.operador = 'menor_que';
      ctx.warnings.push('Campo "esMenorQue" migrado a "operador: menor_que" (legacy compat)');
    }
    delete resultado.esMenorQue;
  } else if (resultado.esMenorQue != null && resultado.operador != null) {
    // Both present — prefer operador, drop esMenorQue
    delete resultado.esMenorQue;
  }
  // Normalize 'exacto' and '' to null (exact value = no operator stored)
  if (resultado.operador === 'exacto' || resultado.operador === '') {
    resultado.operador = null;
  }
  // Validate operador
  if (resultado.operador != null) {
    if (!OPERADOR_VALUES.includes(resultado.operador)) {
      ctx.warnings.push(`Operador "${resultado.operador}" no reconocido; se ignora.`);
      resultado.operador = null;
    }
  }
  return resultado;
};

/* ═══════════════════════════════════════════════════════════
   Schema definitions per canonical código
   ═══════════════════════════════════════════════════════════ */

/**
 * Cada entrada define:
 *   container  – string|null: si el resultado vive dentro de un contenedor (ej. "granulometria")
 *   validate   – (resultado, ctx) => normalized resultado
 *                ctx = { errors:[], warnings:[] }
 *
 * Si container != null, el resultado canónico es { [container]: {...} }.
 * El validador puede coexistir con otros campos (extraction, _warnings, etc.).
 */

const schemas = {};

// ── GRANULOMETRÍA ─────────────────────────────────────────────
const validateGranulometria = (resultado, ctx) => {
  const granu = resultado.granulometria;
  if (!granu) {
    ctx.errors.push('Resultado de granulometría requiere campo "granulometria"');
    return resultado;
  }

  const tamices = granu.tamices || [];

  // Compat: map legacy retenidoPct → retenidoParcialPct
  let hasLegacyRet = false;
  for (const t of tamices) {
    if (t.retenidoPct != null && t.retenidoParcialPct == null && t.retenidoAcumPct == null) {
      t.retenidoParcialPct = t.retenidoPct;
      hasLegacyRet = true;
    }
    delete t.retenidoPct;
  }
  if (hasLegacyRet) {
    ctx.warnings.push('Campo "retenidoPct" mapeado a "retenidoParcialPct" (legacy)');
  }

  // Sort by abertura descending
  tamices.sort((a, b) => (b.aberturaMm || 0) - (a.aberturaMm || 0));

  // Compute pasaPct if missing
  const hasPasa = tamices.some(t => t.pasaPct != null);
  const hasAcum = tamices.some(t => t.retenidoAcumPct != null);
  const hasParcial = tamices.some(t => t.retenidoParcialPct != null);

  if (!hasPasa && tamices.length > 0) {
    if (hasAcum) {
      ctx.warnings.push('Se calculó % pasa desde retención acumulada');
      for (const t of tamices) {
        const acum = t.retenidoAcumPct != null ? Number(t.retenidoAcumPct) : 0;
        t.pasaPct = Math.round((100 - acum) * 10) / 10;
      }
    } else if (hasParcial) {
      ctx.warnings.push('Se convirtieron retenciones a % pasa automáticamente');
      // Heuristic: check if retenidoParcialPct is actually cumulative
      let isCumulative = tamices.length > 1;
      for (let i = 1; i < tamices.length; i++) {
        const prev = tamices[i - 1].retenidoParcialPct ?? 0;
        const curr = tamices[i].retenidoParcialPct ?? 0;
        if (curr < prev - 0.1) { isCumulative = false; break; }
      }

      if (isCumulative) {
        for (const t of tamices) {
          const ret = t.retenidoParcialPct != null ? Number(t.retenidoParcialPct) : 0;
          t.pasaPct = Math.round((100 - ret) * 10) / 10;
        }
      } else {
        let acum = 0;
        for (const t of tamices) {
          const ret = t.retenidoParcialPct != null ? Number(t.retenidoParcialPct) : 0;
          acum += ret;
          t.pasaPct = Math.round((100 - acum) * 10) / 10;
        }
      }
    }
  }

  // Monotonicity validation
  let monotonicIssue = false;
  for (let i = 1; i < tamices.length; i++) {
    if (tamices[i].pasaPct != null && tamices[i - 1].pasaPct != null) {
      if (tamices[i].pasaPct > tamices[i - 1].pasaPct + 0.1) {
        monotonicIssue = true;
        break;
      }
    }
  }
  if (monotonicIssue) {
    ctx.warnings.push('Los % pasa no son monótonos decrecientes — revisar datos');
  }

  // habilitado flag + coerce numbers
  for (const t of tamices) {
    if (t.habilitado === undefined) t.habilitado = true;
    if (t.pasaPct != null) t.pasaPct = Number(t.pasaPct);
    if (t.aberturaMm != null) t.aberturaMm = Number(t.aberturaMm);
  }

  // Range validation on pasaPct
  for (const t of tamices) {
    checkRange(t.pasaPct, `Pasa ${t.tamiz || t.aberturaMm}`, 0, 100, ctx);
  }

  // Reportado (MF/TMN from PDF — cross-check only)
  const reportado = {};
  if (granu.reportado) {
    if (granu.reportado.moduloFinura != null) {
      const mf = Number(granu.reportado.moduloFinura);
      reportado.moduloFinura = mf;
      if (isNaN(mf) || mf < 0 || mf > 10) {
        ctx.warnings.push(`MF reportado (${granu.reportado.moduloFinura}) fuera de rango razonable [0, 10]`);
      }
    }
    if (granu.reportado.tmnMm != null) {
      const tmn = Number(granu.reportado.tmnMm);
      reportado.tmnMm = tmn;
      if (isNaN(tmn) || tmn <= 0) {
        ctx.warnings.push(`TMN reportado (${granu.reportado.tmnMm}) fuera de rango razonable (> 0)`);
      }
    }
  }

  // ── Ensure all 3 pct fields are populated on each tamiz ──
  for (const t of tamices) {
    const pasa = t.pasaPct != null ? Number(t.pasaPct) : null;
    const acum = t.retenidoAcumPct != null ? Number(t.retenidoAcumPct) : null;
    // Derive retenidoAcumPct from pasaPct if missing
    if (acum == null && pasa != null) {
      t.retenidoAcumPct = Math.round((100 - pasa) * 100) / 100;
    }
    // Derive pasaPct from retenidoAcumPct if missing
    if (pasa == null && acum != null) {
      t.pasaPct = Math.round((100 - acum) * 100) / 100;
    }
  }
  // Compute retenidoParcialPct from retenidoAcumPct diffs (sorted desc by abertura)
  for (let i = 0; i < tamices.length; i++) {
    if (tamices[i].retenidoParcialPct == null && tamices[i].retenidoAcumPct != null) {
      const prevAcum = i === 0 ? 0 : (tamices[i - 1].retenidoAcumPct ?? 0);
      tamices[i].retenidoParcialPct = Math.round(Math.max(0, tamices[i].retenidoAcumPct - prevAcum) * 100) / 100;
    }
  }

  // Validate metodoInforme
  const METODOS_VALIDOS = ['PASA', 'RET_PARCIAL', 'RET_ACUM'];
  const metodoInforme = granu.metodoInforme && METODOS_VALIDOS.includes(granu.metodoInforme)
    ? granu.metodoInforme
    : null;

  // Rebuild normalized granulometria
  const normalized = {
    serieTamices: granu.serieTamices || 'IRAM',
    tipoAgregado: granu.tipoAgregado || null,
    metodoInforme,
    tamices,
  };

  if (Object.keys(reportado).length > 0) normalized.reportado = reportado;
  // Preserve evaluacion, objetivo, puntos, idCurvaObjetivo if present
  if (granu.evaluacion) normalized.evaluacion = granu.evaluacion;
  if (granu.objetivo) normalized.objetivo = granu.objetivo;
  if (granu.puntos) normalized.puntos = granu.puntos;
  if (granu.idCurvaObjetivo) normalized.idCurvaObjetivo = granu.idCurvaObjetivo;

  resultado.granulometria = normalized;
  return resultado;
};

schemas['IRAM1505_GRANULOMETRIA'] = { container: 'granulometria', validate: validateGranulometria };
// IRAM1627 alias is resolved to IRAM1505 via ALIAS_MAP before schema lookup

// ── DESGASTE LOS ÁNGELES ─────────────────────────────────────
schemas['IRAM1532_DESGASTE_LA'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'losAngelesPct', ctx);
    checkRange(resultado.losAngelesPct, 'Desgaste Los Ángeles', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── LAJOSIDAD ─────────────────────────────────────────────────
schemas['IRAM1687_1_LAJOSIDAD'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'lajosidadPct', ctx);
    checkRange(resultado.lajosidadPct, 'Lajosidad', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── ELONGACIÓN ────────────────────────────────────────────────
schemas['IRAM1687_2_ELONGACION'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'elongacionPct', ctx);
    checkRange(resultado.elongacionPct, 'Elongación', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── MATERIAL FINO PASA N°200 ─────────────────────────────────
// PR8.15 — `indicePlasticidadIP` opcional (IRAM 1540 Anexo). Si IP < 2 → bonus en AG.
schemas['IRAM1674_MATERIAL_FINO_200'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'pasa200Pct', ctx);
    checkRange(resultado.pasa200Pct, 'Pasa Nº 200', 0, 100, ctx);
    if (resultado.indicePlasticidadIP != null && resultado.indicePlasticidadIP !== '') {
      coerceNumField(resultado, 'indicePlasticidadIP', ctx);
      checkRange(resultado.indicePlasticidadIP, 'Índice de plasticidad IP', 0, 50, ctx);
    }
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── ESTABILIDAD SULFATOS ──────────────────────────────────────
schemas['IRAM1648_ESTABILIDAD_SULFATOS'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'perdidaPct', ctx);
    resultado.ciclos = coerceNum(resultado.ciclos);
    checkRange(resultado.perdidaPct, 'Pérdida por sulfatos', 0, 100, ctx);
    if (resultado.sulfato != null && !['sodio', 'magnesio'].includes(resultado.sulfato)) {
      ctx.warnings.push(`Sulfato: valor "${resultado.sulfato}" no reconocido (esperado: "sodio" o "magnesio")`);
    }
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── REACTIVIDAD ALCALINA (IRAM 1700 / 1874 parts) ────────────
const validateReactividad = (resultado, ctx) => {
  if (resultado.series && Array.isArray(resultado.series)) {
    for (let i = 0; i < resultado.series.length; i++) {
      const s = resultado.series[i];
      s.edadDias = coerceNum(s.edadDias);
      s.expansionPct = coerceNum(s.expansionPct);
    }
    // Validate ages are increasing
    for (let i = 1; i < resultado.series.length; i++) {
      if (resultado.series[i].edadDias != null && resultado.series[i - 1].edadDias != null) {
        if (resultado.series[i].edadDias <= resultado.series[i - 1].edadDias) {
          ctx.warnings.push('Series de reactividad: edades no son crecientes');
          break;
        }
      }
    }
  }
  resultado.expansionFinalPct = coerceNum(resultado.expansionFinalPct);
  return resultado;
};

schemas['IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA'] = { container: null, validate: validateReactividad };
schemas['IRAM1874_1_RAP_PRISMA'] = { container: null, validate: validateReactividad };
schemas['IRAM1874_2_RAP_BARRA_MORTERO'] = { container: null, validate: validateReactividad };
schemas['IRAM1874_3_RAP_BARRA_MORTERO_ACELERADO'] = { container: null, validate: validateReactividad };

// ── IMPUREZAS ORGÁNICAS ──────────────────────────────────────
schemas['IRAM1649_IMPUREZAS_ORGANICAS'] = {
  container: null,
  validate: (resultado, ctx) => {
    resultado.colorNro = coerceNum(resultado.colorNro);
    if (resultado.resultado != null &&
        !['aceptable', 'no aceptable'].includes(resultado.resultado)) {
      ctx.warnings.push(`Impurezas orgánicas: resultado "${resultado.resultado}" no reconocido`);
    }
    return resultado;
  },
};

// ── DENSIDAD / ABSORCIÓN FINO ─────────────────────────────────
/**
 * Legacy → canonical field mapping for densidad.
 * Old names are silently migrated with a warning.
 */
const DENSIDAD_COMPAT_MAP = {
  densidadSSS: 'densidadRelativaAparenteSSS',
  densidadSeca: 'densidadRelativaAparenteSeca',
  densidadAparente: 'densidadRelativaReal',
};

const migrateLegacyDensidadFields = (resultado, ctx) => {
  for (const [oldKey, newKey] of Object.entries(DENSIDAD_COMPAT_MAP)) {
    if (resultado[oldKey] != null && resultado[newKey] == null) {
      resultado[newKey] = resultado[oldKey];
      delete resultado[oldKey];
      ctx.warnings.push(`Campo "${oldKey}" migrado a "${newKey}" (legacy compat)`);
    } else if (resultado[oldKey] != null && resultado[newKey] != null) {
      // Both present — prefer new, drop old
      delete resultado[oldKey];
      ctx.warnings.push(`Campo "${oldKey}" descartado (ya existe "${newKey}")`);
    }
  }
};

const validateDensidadAbsorcion = (resultado, ctx, label) => {
  // Backward compat: migrate old field names
  migrateLegacyDensidadFields(resultado, ctx);

  resultado.densidadRelativaAparenteSSS = coerceNum(resultado.densidadRelativaAparenteSSS);
  resultado.densidadRelativaAparenteSeca = coerceNum(resultado.densidadRelativaAparenteSeca);
  resultado.densidadRelativaReal = coerceNum(resultado.densidadRelativaReal);
  resultado.absorcionPct = coerceNum(resultado.absorcionPct);

  const checkDens = (val, name) => {
    if (val == null) return;
    if (val <= 0) ctx.warnings.push(`${label} — ${name}: debe ser > 0 (valor: ${val})`);
    if (val > 5) ctx.warnings.push(`${label} — ${name}: valor ${val} inusualmente alto (> 5 g/cm³)`);
  };
  checkDens(resultado.densidadRelativaAparenteSSS, 'densidadRelativaAparenteSSS');
  checkDens(resultado.densidadRelativaAparenteSeca, 'densidadRelativaAparenteSeca');
  checkDens(resultado.densidadRelativaReal, 'densidadRelativaReal');
  checkRange(resultado.absorcionPct, `${label} — Absorción`, 0, 100, ctx);
  return resultado;
};

schemas['IRAM1520_DENSIDAD_ABSORCION_FINO'] = {
  container: null,
  validate: (r, ctx) => validateDensidadAbsorcion(r, ctx, 'Densidad fino'),
};

schemas['IRAM1533_DENSIDAD_GRUESO'] = {
  container: null,
  validate: (r, ctx) => { normalizeOperador(r, ctx); return validateDensidadAbsorcion(r, ctx, 'Densidad grueso'); },
};

// ── PESO UNITARIO SUELTO Y COMPACTADO (IRAM 1548) ────────────
schemas['IRAM1531_PESO_UNITARIO'] = {
  container: null,
  validate: (resultado, ctx) => {
    resultado.puc = coerceNum(resultado.puc);
    resultado.pus = coerceNum(resultado.pus);
    resultado.vaciosCompactado = coerceNum(resultado.vaciosCompactado);
    resultado.vaciosSuelto = coerceNum(resultado.vaciosSuelto);
    // Legacy field migration
    if (resultado.pesoUnitarioCompactadoKgM3 != null && resultado.puc == null) {
      resultado.puc = coerceNum(resultado.pesoUnitarioCompactadoKgM3);
      delete resultado.pesoUnitarioCompactadoKgM3;
      ctx.warnings.push('Campo "pesoUnitarioCompactadoKgM3" migrado a "puc"');
    }
    if (resultado.pesoUnitarioSueltoKgM3 != null && resultado.pus == null) {
      resultado.pus = coerceNum(resultado.pesoUnitarioSueltoKgM3);
      delete resultado.pesoUnitarioSueltoKgM3;
      ctx.warnings.push('Campo "pesoUnitarioSueltoKgM3" migrado a "pus"');
    }
    const check = (val, name) => {
      if (val == null) return;
      if (val <= 0) ctx.warnings.push(`Peso unitario — ${name}: debe ser > 0 (valor: ${val})`);
      if (val > 3000) ctx.warnings.push(`Peso unitario — ${name}: valor ${val} inusualmente alto (> 3000 kg/m³)`);
    };
    check(resultado.puc, 'compactado');
    check(resultado.pus, 'suelto');
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── PETROGRAFÍA ───────────────────────────────────────────────
schemas['PETROGRAFIA_IRAM'] = {
  container: null,
  validate: (resultado, ctx) => {
    // Petrografía is mostly text, just ensure strings
    for (const key of ['descripcion', 'composicion', 'reactivosPotenciales', 'sustanciasPerjudiciales', 'conclusiones']) {
      if (resultado[key] != null && typeof resultado[key] !== 'string') {
        resultado[key] = String(resultado[key]);
      }
    }
    return resultado;
  },
};

// ── PARTÍCULAS DESMENUZABLES ──────────────────────────────────
schemas['IRAM1540_PARTICULAS_DESMENUZABLES'] = {
  container: null,
  validate: (resultado, ctx) => {
    resultado.desmenuzablesPct = coerceNum(resultado.desmenuzablesPct);
    checkRange(resultado.desmenuzablesPct, 'Partículas desmenuzables', 0, 100, ctx);
    return resultado;
  },
};

// ── EQUIVALENTE DE ARENA (IRAM 1692) ──────────────────────────
schemas['IRAM1882_VALOR_EQUIVALENTE_ARENA'] = {
  container: null,
  validate: (resultado, ctx) => {
    // Coerce all 6 readings
    for (const k of ['l1_1','l2_1','l1_2','l2_2','l1_3','l2_3']) {
      resultado[k] = coerceNum(resultado[k]);
    }
    // Auto-compute EA per reading and average
    const readings = [];
    for (let i = 1; i <= 3; i++) {
      const l1 = resultado[`l1_${i}`];
      const l2 = resultado[`l2_${i}`];
      if (l1 != null && l2 != null && l2 > 0) {
        const ea = Math.round((l1 / l2) * 100);
        resultado[`ea_${i}`] = ea;
        readings.push(ea);
      }
    }
    if (readings.length > 0 && resultado.equivalenteArenaPct == null) {
      resultado.equivalenteArenaPct = Math.round(readings.reduce((a, b) => a + b, 0) / readings.length);
    }
    resultado.equivalenteArenaPct = coerceNum(resultado.equivalenteArenaPct);
    checkRange(resultado.equivalenteArenaPct, 'Equivalente de arena', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── AZUL DE METILENO ──────────────────────────────────────────
schemas['IRAM1887_AZUL_METILENO'] = {
  container: null,
  validate: (resultado, ctx) => {
    resultado.azulMetilenoGKg = coerceNum(resultado.azulMetilenoGKg);
    if (resultado.azulMetilenoGKg != null && resultado.azulMetilenoGKg < 0) {
      ctx.warnings.push(`Azul de metileno: valor ${resultado.azulMetilenoGKg} negativo`);
    }
    return resultado;
  },
};

// ── TERRONES DE ARCILLA Y PARTÍCULAS FRIABLES (IRAM 1647 — Cap. 4) ──
schemas['IRAM1647_TERRONES_ARCILLA'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Terrones de arcilla', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── SALES SOLUBLES TOTALES (IRAM 1647 — Cap. 6) ──────────────
schemas['IRAM1647_SALES_SOLUBLES'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Sales solubles', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── SULFATOS COMO SO₃ (IRAM 1647 — Cap. 8.9) ─────────────────
schemas['IRAM1647_SULFATOS_SO3'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Sulfatos SO₃', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── CLORUROS SOLUBLES (IRAM 1882) ─────────────────────────────
schemas['IRAM1882_CLORUROS_SOLUBLES'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Cloruros solubles', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── MATERIA ORGÁNICA (IRAM 1647 — Cap. 5) ─────────────────────
schemas['IRAM1647_MATERIA_ORGANICA'] = {
  container: null,
  validate: (resultado, ctx) => {
    const validOpciones = ['menor_500', 'igual_o_mayor_500'];
    if (resultado.resultadoColorimetrico != null && !validOpciones.includes(resultado.resultadoColorimetrico)) {
      ctx.warnings.push(`Resultado colorimétrico: valor "${resultado.resultadoColorimetrico}" no reconocido`);
    }
    // Excepción §3.2.3.4 b) — ensayo comparativo de morteros
    resultado.excepcionResistenciaArena7d = coerceNum(resultado.excepcionResistenciaArena7d);
    resultado.excepcionResistenciaPatron7d = coerceNum(resultado.excepcionResistenciaPatron7d);
    if (resultado.excepcionResistenciaArena7d != null && resultado.excepcionResistenciaPatron7d != null && resultado.excepcionResistenciaPatron7d > 0) {
      const pct = Math.round((resultado.excepcionResistenciaArena7d / resultado.excepcionResistenciaPatron7d) * 1000) / 10;
      resultado.excepcionPct = pct;
      resultado.excepcionValida = pct >= 95;
    }
    return resultado;
  },
};

// ── MATERIAS CARBONOSAS (IRAM 1647 — Cap. 3) ──────────────────
schemas['IRAM1647_MATERIAS_CARBONOSAS'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Materias carbonosas', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── DURABILIDAD POR SULFATO DE SODIO (IRAM 1525) ─────────────
schemas['IRAM1525_DURABILIDAD_SULFATO'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    resultado.ciclos = coerceNum(resultado.ciclos);
    checkRange(resultado.valor, 'Pérdida por sulfato', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── POLVO ADHERIDO (IRAM 1883) ───────────────────────────────
schemas['IRAM1883_POLVO_ADHERIDO'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Polvo adherido', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── PARTÍCULAS BLANDAS (IRAM 1644) ───────────────────────────
schemas['IRAM1644_PARTICULAS_BLANDAS'] = {
  container: null,
  validate: (resultado, ctx) => {
    const validOpciones = ['no_contiene', 'contiene'];
    if (resultado.resultadoCualitativo != null && !validOpciones.includes(resultado.resultadoCualitativo)) {
      ctx.warnings.push(`Partículas blandas: valor "${resultado.resultadoCualitativo}" no reconocido`);
    }
    resultado.valor = coerceNum(resultado.valor);
    if (resultado.valor != null) {
      checkRange(resultado.valor, 'Partículas blandas', 0, 100, ctx);
    }
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── ESTABILIDAD BASÁLTICAS (IRAM 1519) ───────────────────────
schemas['IRAM1519_ESTABILIDAD_BASALTICAS'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'valor', ctx);
    checkRange(resultado.valor, 'Pérdida de masa a 30 días', 0, 100, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

// ── EXAMEN PETROGRÁFICO (IRAM 1649) ─────────────────────────
// PR8.11/PR8.21 — `ftanitaPct` y `conchillasPct` opcionales.
schemas['IRAM1649_EXAMEN_PETROGRAFICO'] = {
  container: null,
  validate: (resultado, ctx) => {
    const validConclusions = ['cumple', 'no_cumple_reactivo', 'no_cumple_otro'];
    if (resultado.conclusion && !validConclusions.includes(resultado.conclusion)) {
      ctx.errors.push(`Conclusión inválida: ${resultado.conclusion}`);
    }
    if (resultado.ftanitaPct != null && resultado.ftanitaPct !== '') {
      coerceNumField(resultado, 'ftanitaPct', ctx);
      checkRange(resultado.ftanitaPct, 'Ftanita / chert', 0, 100, ctx);
    }
    if (resultado.conchillasPct != null && resultado.conchillasPct !== '') {
      coerceNumField(resultado, 'conchillasPct', ctx);
      checkRange(resultado.conchillasPct, 'Conchillas', 0, 100, ctx);
    }
    return resultado;
  },
};

// ── RAS ACELERADO — BARRA DE MORTERO (IRAM 1674) ────────────
schemas['IRAM1674_RAS_ACELERADO'] = {
  container: null,
  validate: (resultado, ctx) => {
    coerceNumField(resultado, 'expansion16d', ctx);
    checkRange(resultado.expansion16d, 'Expansión a 16 días', 0, 10, ctx);
    normalizeOperador(resultado, ctx);
    return resultado;
  },
};

/* ═══════════════════════════════════════════════════════════
   ENSAYO DE AGUA — Análisis químico (IRAM 1601:2012)
   Formulario unificado: todos los parámetros en un resultado.
   ═══════════════════════════════════════════════════════════ */

schemas['IRAM1601_ANALISIS_QUIMICO'] = {
  container: null,
  validate: (resultado, ctx) => {
    resultado.residuoSolido   = coerceNum(resultado.residuoSolido);
    resultado.materiaOrganica = coerceNum(resultado.materiaOrganica);
    resultado.ph              = coerceNum(resultado.ph);
    resultado.sulfato         = coerceNum(resultado.sulfato);
    resultado.cloruro         = coerceNum(resultado.cloruro);
    resultado.hierro          = coerceNum(resultado.hierro);
    resultado.alcalis         = coerceNum(resultado.alcalis);
    checkRange(resultado.residuoSolido,   'Residuo sólido',   0, 100000, ctx);
    checkRange(resultado.materiaOrganica, 'Materia orgánica',  0, 1000,   ctx);
    checkRange(resultado.ph,              'pH',                0, 14,     ctx);
    checkRange(resultado.sulfato,         'Sulfato',           0, 100000, ctx);
    checkRange(resultado.cloruro,         'Cloruro',           0, 100000, ctx);
    checkRange(resultado.hierro,          'Hierro',            0, 1000,   ctx);
    checkRange(resultado.alcalis,         'Álcalis',           0, 100000, ctx);
    // Preserve context fields (prefixed with _)
    // _origenAgua, _usoAmasado, _usoCurado, _tipoHormigon, _agReactivos
    return resultado;
  },
};

// ── OTRO ──────────────────────────────────────────────────────
schemas['OTRO'] = {
  container: null,
  validate: (resultado, _ctx) => resultado,
};

// ── DERIVADOS (MF, TMN, etc.) ────────────────────────────────
const validateDerivado = (resultado, ctx) => {
  // Derivados generados por sync tienen { valor, detalle, fuenteEnsayoId }
  // No validar de más; solo asegurar coherencia mínima.
  if (resultado.valor === undefined && resultado.derivado === undefined) {
    ctx.warnings.push('Resultado de ensayo derivado sin campo "valor"');
  }
  return resultado;
};
schemas['IRAM1525_MODULO_FINEZA'] = { container: null, validate: validateDerivado };
schemas['IRAM1505_TMN'] = { container: null, validate: validateDerivado };

/* ═══════════════════════════════════════════════════════════
   Main API: validateAndNormalizeResultado
   ═══════════════════════════════════════════════════════════ */

/**
 * Validates and normalizes the `resultado` object for a given tipoCodigo.
 *
 * @param {string} codigo – AgregadoEnsayoTipo.codigo (puede ser alias o canónico)
 * @param {object|null} resultado – El campo resultado del ensayo
 * @returns {{ ok:boolean, normalized:object|null, errors:string[], warnings:string[] }}
 */
const validateAndNormalizeResultado = (codigo, resultado) => {
  const ctx = { errors: [], warnings: [] };

  // Null/undefined resultado is allowed (ensayo sin resultado aún)
  if (resultado == null) {
    return { ok: true, normalized: null, errors: [], warnings: [] };
  }

  // Resolve alias (silently — no warning needed for normal alias resolution)
  const canonical = getCanonicalCodigo(codigo);

  const schema = schemas[canonical];
  if (!schema) {
    // Unknown type — pass through with warning
    ctx.warnings.push(`Tipo "${canonical}" sin schema definido; resultado sin validar`);
    return { ok: true, normalized: resultado, errors: [], warnings: ctx.warnings };
  }

  // Deep clone to avoid mutating caller
  let normalized;
  try {
    normalized = JSON.parse(JSON.stringify(resultado));
  } catch {
    return { ok: false, normalized: null, errors: ['Resultado no es serializable a JSON'], warnings: [] };
  }

  // Run validator
  try {
    normalized = schema.validate(normalized, ctx);
  } catch (err) {
    ctx.errors.push(`Error al validar resultado: ${err.message}`);
  }

  return {
    ok: ctx.errors.length === 0,
    normalized,
    errors: ctx.errors,
    warnings: ctx.warnings,
  };
};

/* ═══════════════════════════════════════════════════════════
   Exported constants for external use
   ═══════════════════════════════════════════════════════════ */

/** Codes that are considered derived (auto-generated from granulometría) */
const DERIVED_CODES = new Set([
  'IRAM1525_MODULO_FINEZA',
  'IRAM1505_TMN',
]);

const isDerivedCodigo = (codigo) => DERIVED_CODES.has(codigo);

module.exports = {
  // Alias
  getCanonicalCodigo,
  isAliasCodigo,
  getAliasCodesFor,
  // Validation
  validateAndNormalizeResultado,
  // Derived
  isDerivedCodigo,
  DERIVED_CODES,
  ALIAS_MAP,
  // Operador
  normalizeOperador,
  OPERADOR_VALUES,
  // For testing
  coerceNum,
};
