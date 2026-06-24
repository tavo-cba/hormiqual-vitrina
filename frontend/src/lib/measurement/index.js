/**
 * Módulo measurement (frontend) — espejo simplificado del backend.
 *
 * El backend (hormiqual-backend/src/domain/measurement) tiene la implementación
 * canónica con conversor de unidades dimensional y adapter completo. Acá
 * mantenemos solo lo necesario para:
 *   - Adaptar formato legacy a MeasuredValue al leer del API
 *   - Renderizar correctamente en PDFs y formularios
 *
 * Si necesitás conversiones (ppm ↔ %, etc.), pedí el dato ya convertido al
 * backend o duplicá la tabla acá.
 */

const VALID_QUALIFIERS = new Set(['<', '>', '<=', '>=', '=', null]);

const NOT_MEASURED_TOKENS = new Set([
  'no medido', 'sin medir', 'no determinado', 'nd', 'n/d', 'n.d.',
  '\u2014', '-', '--', 'pendiente',
]);

const QUALIFIER_PATTERNS = [
  { regex: /^<=/, qualifier: '<=' },
  { regex: /^>=/, qualifier: '>=' },
  { regex: /^\u2264/, qualifier: '<=' },
  { regex: /^\u2265/, qualifier: '>=' },
  { regex: /^</, qualifier: '<' },
  { regex: /^>/, qualifier: '>' },
];

/**
 * Crea un MeasuredValue validado.
 */
export function create({ value = null, qualifier = null, unit = null, isCensored, detectionLimit, source } = {}) {
  if (value !== null && !Number.isFinite(Number(value))) {
    throw new Error(`MeasuredValue: value debe ser finito o null. Recibido: ${value}`);
  }
  if (!VALID_QUALIFIERS.has(qualifier)) {
    throw new Error(`MeasuredValue: qualifier inválido "${qualifier}".`);
  }
  const numValue = value !== null ? Number(value) : null;
  const censored = isCensored != null
    ? !!isCensored
    : (qualifier === '<' || qualifier === '>' || qualifier === '<=' || qualifier === '>=');
  const dl = detectionLimit != null ? Number(detectionLimit) : (censored && numValue != null ? numValue : undefined);
  return {
    value: numValue,
    qualifier: qualifier || null,
    unit: unit || null,
    isCensored: censored,
    ...(dl != null ? { detectionLimit: dl } : {}),
    ...(source ? { source } : {}),
  };
}

export function notMeasured(unit = null) {
  return { value: null, qualifier: null, unit, isCensored: false };
}

export function hasValue(mv) {
  return mv != null && mv.value != null;
}

export function asConservativeEstimate(mv) {
  if (!mv) return { value: null, isEstimate: false };
  if (!mv.isCensored) return { value: mv.value, isEstimate: false };
  return {
    value: mv.detectionLimit ?? mv.value,
    isEstimate: true,
    reason: `Valor censurado (${mv.qualifier} ${mv.detectionLimit}). Estimación conservadora.`,
  };
}

/**
 * Parser de strings a MeasuredValue.
 */
export function parse(input, options = {}) {
  const { defaultUnit = null } = options;

  if (input == null || input === '') return notMeasured(defaultUnit);

  if (typeof input === 'object') {
    if ('value' in input && 'qualifier' in input) return create(input);
    if ('valor' in input || 'esMenorQue' in input || 'operador' in input) {
      const qualifier =
        input.esMenorQue === true ? '<' :
        input.operador === 'menor_que' ? '<' :
        input.operador === 'mayor_que' ? '>' :
        null;
      return create({
        value: input.valor != null ? Number(input.valor) : null,
        qualifier,
        unit: input.unidad || defaultUnit,
      });
    }
    return notMeasured(defaultUnit);
  }

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      return { ...notMeasured(defaultUnit), _parseWarning: `Valor numérico no finito: ${input}` };
    }
    return create({ value: input, unit: defaultUnit });
  }

  let str = String(input).trim();
  if (!str) return notMeasured(defaultUnit);
  if (NOT_MEASURED_TOKENS.has(str.toLowerCase())) return notMeasured(defaultUnit);

  let qualifier = null;
  for (const pat of QUALIFIER_PATTERNS) {
    if (pat.regex.test(str)) {
      qualifier = pat.qualifier;
      str = str.replace(pat.regex, '').trim();
      break;
    }
  }

  const numMatch = str.match(/^(-?\d+(?:[.,]\d+)?(?:[.,]\d+)?)\s*(.*)$/);
  if (!numMatch) {
    return { ...notMeasured(defaultUnit), _parseWarning: `No se pudo extraer número de "${input}"` };
  }

  const numRaw = numMatch[1];
  const unitStr = numMatch[2].trim();

  let normalized = numRaw;
  const hasComma = numRaw.includes(',');
  const hasDot = numRaw.includes('.');
  if (hasComma && hasDot) {
    const lastComma = numRaw.lastIndexOf(',');
    const lastDot = numRaw.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = numRaw.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = numRaw.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = numRaw.replace(',', '.');
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ...notMeasured(defaultUnit), _parseWarning: `No se pudo parsear "${numRaw}"` };
  }

  return create({ value, qualifier, unit: unitStr || defaultUnit });
}

/**
 * Adapta un input de cualquier formato (legacy DB, string, número, MeasuredValue)
 * al formato unificado. Único punto de entrada para datos que vienen del API.
 */
export function adapt(input, options = {}) {
  if (input == null) return notMeasured(options.defaultUnit);

  if (typeof input === 'object' && 'value' in input && 'qualifier' in input) {
    return create(input);
  }

  if (typeof input === 'object' && ('valor' in input || 'esMenorQue' in input || 'operador' in input)) {
    const qualifier =
      input.esMenorQue === true ? '<' :
      input.operador === 'menor_que' ? '<' :
      input.operador === 'mayor_que' ? '>' :
      null;
    return create({
      value: input.valor != null ? Number(input.valor) : null,
      qualifier,
      unit: input.unidad || options.defaultUnit || null,
      source: input.idEnsayo ? `ensayo:${input.idEnsayo}` : undefined,
    });
  }

  return parse(input, options);
}
