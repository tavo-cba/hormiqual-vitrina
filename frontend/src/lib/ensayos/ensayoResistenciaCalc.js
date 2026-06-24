/**
 * Espejo frontend del motor de cálculo de resistencia
 * `hormiqual-backend/src/domain/ensayoResistenciaEvalEngine.js`
 * (Bloque 3 auditoría 08).
 *
 * El backend es la fuente de verdad: recalcula y rechaza valores enviados
 * que difieran > 1 % del recálculo. Este espejo existe para que el
 * frontend pueda mostrar el preview en vivo sin round-trip al backend, y
 * para que las dos implementaciones queden bit-a-bit consistentes
 * (mismo input → mismo output).
 *
 * Si modificás algo acá, modificá el archivo backend equivalente y agregá
 * el test correspondiente en ambos.
 *
 * Normas:
 *  - IRAM 1546:2013 §10.4 (factor H/D)
 *  - IRAM 1546:2013 §11 (tipo de fractura)
 */

export const TABLA_FACTOR_HD = Object.freeze([
  [2.00, 1.000],
  [1.75, 0.980],
  [1.50, 0.960],
  [1.25, 0.930],
  [1.00, 0.870],
]);

export const HD_TOLERANCIA_NO_CORRECCION = 0.02;

/**
 * Tipos de rotura — IRAM 1546:2013 §11 Figura 2 (con modificación 2017
 * que en §7.g exige declarar el tipo según Figura 2).
 *
 * R8 (revisor-civil 2026-05-08): labels alineados a los 6 tipos numerados
 * de la norma. Mantenemos el `value` (ENUM persistido) sin migración.
 */
export const TIPOS_ROTURA_OPCIONES = Object.freeze([
  { value: 'CONO',          label: 'Tipo 1 — Conos bien formados en ambos extremos' },
  { value: 'CONO_CORTANTE', label: 'Tipo 2 — Cono y fisuras verticales en el otro extremo' },
  { value: 'COLUMNAR',      label: 'Tipo 3 — Columnar (rotura vertical a través de ambas bases)' },
  { value: 'DIAGONAL',      label: 'Tipo 4 — Diagonal' },
  { value: 'CORTANTE',      label: 'Tipo 5 — Cortante (bases mal preparadas o neopreno)' },
  { value: 'OTRO',          label: 'Tipo 6 — Otro (extremo en punta o no clasificable)' },
]);

export const TIPOS_ROTURA = Object.freeze(TIPOS_ROTURA_OPCIONES.map((o) => o.value));

export function factorCorreccionHD(altura, diametro) {
  const h = Number(altura);
  const d = Number(diametro);
  if (!Number.isFinite(h) || !Number.isFinite(d) || d <= 0 || h <= 0) {
    return 1.000;
  }
  const hd = h / d;
  if (hd >= 2.00 - HD_TOLERANCIA_NO_CORRECCION) return 1.000;
  for (let i = 0; i < TABLA_FACTOR_HD.length - 1; i++) {
    const [hdHigh, fHigh] = TABLA_FACTOR_HD[i];
    const [hdLow, fLow] = TABLA_FACTOR_HD[i + 1];
    if (hd <= hdHigh && hd >= hdLow) {
      const t = (hd - hdLow) / (hdHigh - hdLow);
      const factor = fLow + t * (fHigh - fLow);
      return Math.round(factor * 1000) / 1000;
    }
  }
  return TABLA_FACTOR_HD[TABLA_FACTOR_HD.length - 1][1];
}

export function calcularCargaAplicada({ lecturaPrensa, prensa }) {
  if (lecturaPrensa == null || !prensa) return null;
  const v = Number(lecturaPrensa);
  if (!Number.isFinite(v)) return null;
  const c1 = Number(prensa.coeficienteUno);
  const c2 = Number(prensa.coeficienteDos);
  const c3 = Number(prensa.coeficienteTres);
  if ([c1, c2, c3].some((n) => !Number.isFinite(n))) return v;
  return c1 * v * v + c2 * v - c3;
}

export function esUnidadToneladaFuerza(unidad) {
  if (!unidad) return false;
  const u = String(unidad).toLowerCase().trim();
  return /\b(ton|tonf|tnf|tn|tonelada)\b/.test(u);
}

/**
 * P-V-03 (auditoría 08, Bloque 21) — política de unidad de carga.
 *
 * Convierte 1 tonf ≈ 9,80665 kN (gravedad estándar).
 */
export const KN_POR_TONF = 9.80665;

/**
 * Formatea la carga según la política configurada por el tenant.
 *
 * @param {number} cargaAplicada Valor numérico de la carga.
 * @param {string} unidadOriginal Unidad nativa de la prensa (ej. "kN", "tonf").
 * @param {'ORIGINAL'|'SI_KN'|'AMBAS'} [politica='ORIGINAL']
 * @param {object} [opts]
 * @param {number} [opts.precision=2]
 * @returns {string}  Texto listo para imprimir, ej. "125,00 kN" o "125,00 kN (12,75 tonf)".
 */
export function formatCargaPolicy(cargaAplicada, unidadOriginal, politica = 'ORIGINAL', opts = {}) {
  if (cargaAplicada == null || !Number.isFinite(Number(cargaAplicada))) return '-';
  const Q = Number(cargaAplicada);
  const precision = opts.precision ?? 2;
  const esTonf = esUnidadToneladaFuerza(unidadOriginal);
  const fmt = (v) => v.toLocaleString('es-AR', {
    minimumFractionDigits: precision, maximumFractionDigits: precision,
  });
  const Qkn   = esTonf ? Q * KN_POR_TONF : Q;
  const Qtonf = esTonf ? Q : Q / KN_POR_TONF;

  switch (politica) {
    case 'SI_KN':
      // Forzar kN siempre. Si la prensa reportaba tonf, convertir.
      return `${fmt(Qkn)} kN`;
    case 'AMBAS':
      // Mostrar ambas unidades.
      return `${fmt(Qkn)} kN (${fmt(Qtonf)} tonf)`;
    case 'ORIGINAL':
    default:
      return `${fmt(Q)} ${unidadOriginal || 'kN'}`;
  }
}

export function calcularResistencia({ cargaAplicada, diametro, altura, unidad, factorHD }) {
  if (cargaAplicada == null || diametro == null) return null;
  const d = Number(diametro);
  const Q = Number(cargaAplicada);
  if (!Number.isFinite(d) || d === 0 || !Number.isFinite(Q)) return null;
  const esTonf = esUnidadToneladaFuerza(unidad);
  const FACTOR_KN = 1273.239545;
  const FACTOR_TONF = 12486.214581;
  const factor = esTonf ? FACTOR_TONF : FACTOR_KN;
  const sigmaSinCorreccion = (factor * Q) / (d * d);
  const factorHDAplicado = factorHD != null
    ? Number(factorHD)
    : factorCorreccionHD(altura, d);
  const sigma = sigmaSinCorreccion * factorHDAplicado;
  return {
    resistencia: Math.round(sigma * 100) / 100,
    factorHDAplicado,
    unidadDetectada: esTonf ? 'tonf' : 'kN',
  };
}

export function evaluarEnsayoResistencia(input) {
  if (!input) return null;
  const { lecturaPrensa, prensa, diametro, altura, cargaAplicada } = input;
  const unidad = prensa?.unidadMedida?.unidad ?? prensa?.unidad ?? null;
  const tipoOperacion = prensa?.tipoOperacion || 'MANUAL';

  // Branch AUTOMATICA / SEMIAUTOMATICA: la prensa reporta la carga directa.
  // No se aplica ecuación de calibración; `lecturaPrensa` se ignora.
  let carga;
  if (tipoOperacion === 'AUTOMATICA' || tipoOperacion === 'SEMIAUTOMATICA') {
    if (cargaAplicada == null) return null;
    const v = Number(cargaAplicada);
    if (!Number.isFinite(v)) return null;
    carga = v;
  } else {
    carga = calcularCargaAplicada({ lecturaPrensa, prensa });
    if (carga == null) return null;
  }

  const r = calcularResistencia({
    cargaAplicada: carga,
    diametro,
    altura,
    unidad,
    factorHD: input.factorCorreccionHD,
  });
  if (!r) return null;
  return {
    cargaAplicada: Math.round(carga * 100) / 100,
    resistencia: r.resistencia,
    factorCorreccionHD: r.factorHDAplicado,
    unidadDetectada: r.unidadDetectada,
    tipoOperacion,
  };
}
