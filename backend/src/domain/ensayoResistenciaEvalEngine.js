'use strict';

/**
 * Motor puro para el cálculo de resistencia a compresión de probetas
 * cilíndricas (Bloque 3 auditoría 08).
 *
 * Reemplaza la lógica que vivía hardcoded en frontend (`ensayoForm.jsx`),
 * de modo que el backend pueda RECALCULAR y rechazar valores enviados por
 * el cliente que difieran del recálculo (C-LOG-01: hoy un cliente con
 * token JWT puede mandar `resistencia: 99999` y se guarda).
 *
 * Funciones puras — sin DB, sin HTTP, sin fetch. Testeable aisladamente.
 *
 * Normas implementadas:
 *  - IRAM 1546:2013 §6 (procedimiento del ensayo)
 *  - IRAM 1551 §10 — factor de corrección por esbeltez para TESTIGOS
 *    extraídos (NO aplica a probetas moldeadas)
 *  - σ = 4·F / (π·d²) con d en mm
 *
 * R5 (revisor-civil 2026-05-08): NO existe §10.4 en IRAM 1546:2013. La
 * tabla H/D del proyecto era atribución incorrecta — el factor de
 * esbeltez es de IRAM 1551 (testigos extraídos). En probetas MOLDEADAS,
 * cuando H/D ≠ 2 lo normativamente correcto es DESCARTARLAS (IRAM
 * 1524/1534 establecen H/D = 2 como condición de moldeo).
 *
 * Decisión del proyecto (sesión 2026-05-08): para probetas moldeadas se
 * exige H/D = 2 ± tolerancia con `validarHDProbetaMoldeada`. Si no
 * cumple, el ensayo se rechaza. La `TABLA_FACTOR_HD` y `factorCorreccionHD`
 * quedan exportadas para un futuro flujo de testigos (cuando se
 * implemente IRAM 1551), pero NO se aplican al cálculo de resistencia
 * de probetas moldeadas: `evaluarEnsayoResistencia` siempre usa factor
 * 1.000.
 */

/**
 * Tabla de factor de corrección por esbeltez — IRAM 1551 (testigos
 * extraídos). NO aplica a probetas moldeadas (que deben tener H/D=2 por
 * IRAM 1524/1534).
 *
 * Cada entrada es [H/D, factor]. Interpolación lineal entre puntos.
 *
 * VERIFICAR contra IRAM 1551 (no provista en docs/normativa/fuentes/).
 * Los 5 valores son los típicos referenciados en ASTM C39 / IRAM 1546
 * (cita histórica) — confirmar contra IRAM 1551 cuando se implemente
 * el flujo de testigos.
 */
const TABLA_FACTOR_HD = Object.freeze([
  [2.00, 1.000],
  [1.75, 0.980],
  [1.50, 0.960],
  [1.25, 0.930],
  [1.00, 0.870],
]);

/**
 * Tolerancia para considerar H/D=2 dentro de norma (probetas moldeadas).
 * ±5% cubre ruido de medición y desgaste por encabezado pequeño. Un
 * descabezado serio cae fuera de esta tolerancia y el ensayo se rechaza.
 *
 * Antes (R5): se usaba ±0,02 como tolerancia para "no aplicar factor".
 * Ahora ±5% es la tolerancia para "aceptar la probeta como válida".
 */
const HD_TOLERANCIA_PROBETA_MOLDEADA_PCT = 0.05;
const HD_TOLERANCIA_NO_CORRECCION = 0.02; // back-compat para callers que usen factorCorreccionHD

/**
 * Tipos de rotura admitidos (IRAM 1546:2013 §11 — Figura 2 + modif 2017).
 *
 * R8 (revisor-civil 2026-05-08): la norma define 6 tipos numerados con
 * descripción gráfica (Figura 2). Mantenemos los nombres semánticos del
 * proyecto en el ENUM (estabilidad de migración) pero documentamos la
 * correspondencia exacta. La modif 2017 §7.g exige declarar el tipo según
 * Figura 2 — los emisores de informes deben mapear semántico ↔ Tipo X.
 *
 *   CONO          → Tipo 1: conos bien formados en ambos extremos.
 *   CONO_CORTANTE → Tipo 2: cono bien formado en un extremo y mal definido
 *                           en el otro, con fisuras verticales (columnares)
 *                           que comienzan en la base.
 *   COLUMNAR      → Tipo 3: rotura columnar (vertical) a través de ambas
 *                           bases. Se pueden observar conos mal formados.
 *   DIAGONAL      → Tipo 4: rotura diagonal (golpear con martillo para
 *                           diferenciarla del Tipo 1).
 *   CORTANTE      → Tipo 5: rotura usual cuando las bases no están
 *                           preparadas o se usa encabezado de neopreno.
 *   OTRO          → Tipo 6: fractura similar al Tipo 5, con extremo de la
 *                           probeta en forma de punta. (Mapea también a
 *                           cualquier fractura no clasificable.)
 */
const TIPOS_ROTURA = Object.freeze([
  'CONO',
  'CONO_CORTANTE',
  'COLUMNAR',
  'DIAGONAL',
  'CORTANTE',
  'OTRO',
]);

/**
 * Correspondencia tipo semántico ↔ número de Figura 2 IRAM 1546:2013.
 * Útil para informes que deben citar literal "Tipo X (Figura 2)".
 */
const TIPOS_ROTURA_FIGURA_2 = Object.freeze({
  CONO:           { numero: 1, descripcion: 'Conos bien formados en ambos extremos' },
  CONO_CORTANTE:  { numero: 2, descripcion: 'Cono y fisuras verticales en el otro extremo' },
  COLUMNAR:       { numero: 3, descripcion: 'Rotura columnar (vertical) a través de ambas bases' },
  DIAGONAL:       { numero: 4, descripcion: 'Rotura diagonal (verificar con martillo vs. Tipo 1)' },
  CORTANTE:       { numero: 5, descripcion: 'Bases mal preparadas o encabezado de neopreno' },
  OTRO:           { numero: 6, descripcion: 'Extremo en punta o fractura no clasificable' },
});

/**
 * Calcula el factor de corrección H/D para una probeta dada.
 *
 * @param {number} altura   Altura útil de la probeta en mm.
 * @param {number} diametro Diámetro de la probeta en mm.
 * @returns {number} Factor entre 0,87 y 1,00. Si H/D ≥ 2 → 1,000.
 *                  Si datos inválidos → 1,000 (defensivo: no degrada el
 *                  resultado, pero el caller debería validar antes).
 */
function factorCorreccionHD(altura, diametro) {
  const h = Number(altura);
  const d = Number(diametro);
  if (!Number.isFinite(h) || !Number.isFinite(d) || d <= 0 || h <= 0) {
    return 1.000;
  }
  const hd = h / d;
  // H/D ≥ 2 (con tolerancia) → no se aplica corrección.
  if (hd >= 2.00 - HD_TOLERANCIA_NO_CORRECCION) return 1.000;
  // Buscar el segmento de interpolación (la tabla está ordenada DESC en H/D).
  for (let i = 0; i < TABLA_FACTOR_HD.length - 1; i++) {
    const [hdHigh, fHigh] = TABLA_FACTOR_HD[i];
    const [hdLow, fLow] = TABLA_FACTOR_HD[i + 1];
    if (hd <= hdHigh && hd >= hdLow) {
      const t = (hd - hdLow) / (hdHigh - hdLow);
      const factor = fLow + t * (fHigh - fLow);
      // Redondeo a 3 decimales (igual que la columna DECIMAL(4,3) del modelo).
      return Math.round(factor * 1000) / 1000;
    }
  }
  // H/D < 1.00 → último valor de la tabla.
  return TABLA_FACTOR_HD[TABLA_FACTOR_HD.length - 1][1];
}

/**
 * Calcula la carga real aplicada a la probeta a partir de la lectura de
 * la prensa y sus coeficientes de calibración.
 *
 * Polinomio de calibración: F = c1·v² + c2·v − c3, donde v = lecturaPrensa.
 * Si la prensa no tiene coeficientes válidos, devuelve la lectura cruda.
 *
 * @param {object} args
 * @param {number} args.lecturaPrensa  Valor leído en el dial de la prensa.
 * @param {object} args.prensa         { coeficienteUno, coeficienteDos, coeficienteTres }.
 * @returns {number|null} Carga aplicada (en la unidad nativa de la prensa).
 */
function calcularCargaAplicada({ lecturaPrensa, prensa }) {
  if (lecturaPrensa == null || !prensa) return null;
  const v = Number(lecturaPrensa);
  if (!Number.isFinite(v)) return null;
  const c1 = Number(prensa.coeficienteUno);
  const c2 = Number(prensa.coeficienteDos);
  const c3 = Number(prensa.coeficienteTres);
  if ([c1, c2, c3].some((n) => !Number.isFinite(n))) return v;
  return c1 * v * v + c2 * v - c3;
}

/**
 * Detecta si la unidad de la prensa expresa la carga en toneladas-fuerza.
 *
 * M-CAL-02 fix: la versión anterior usaba `unidadCarga.toLowerCase().includes("ton")`
 * lo que fallaba con "Tonf", "Tn", "tonelada-fuerza". Probamos múltiples
 * tokens.
 */
function esUnidadToneladaFuerza(unidad) {
  if (!unidad) return false;
  const u = String(unidad).toLowerCase().trim();
  return /\b(ton|tonf|tnf|tn|tonelada)\b/.test(u);
}

/**
 * Calcula la resistencia a compresión σ [MPa] = 4·F / (π·d²) corregida
 * por factor H/D.
 *
 * - Si carga en kN y d en mm: σ [MPa] = (4000/π)/d² · F ≈ 1273,2395 · F / d²
 * - Si carga en tonf y d en mm: σ [MPa] = (4·9806,65/π)/d² · F ≈ 12486,2146 · F / d²
 *
 * @param {object} args
 * @param {number} args.cargaAplicada  Carga (kN o tonf según `unidad`).
 * @param {number} args.diametro       Diámetro de la probeta en mm.
 * @param {number} [args.altura]       Altura para auto-detectar factor H/D.
 * @param {string} [args.unidad]       Etiqueta de unidad de la prensa.
 * @param {number} [args.factorHD]     Factor explícito (override del auto). Si se omite, se calcula.
 * @returns {{ resistencia: number, factorHDAplicado: number, unidadDetectada: 'tonf'|'kN' } | null}
 */
function calcularResistencia({ cargaAplicada, diametro, altura, unidad, factorHD }) {
  if (cargaAplicada == null || diametro == null) return null;
  const d = Number(diametro);
  const Q = Number(cargaAplicada);
  if (!Number.isFinite(d) || d === 0 || !Number.isFinite(Q)) return null;
  const esTonf = esUnidadToneladaFuerza(unidad);
  // Constantes derivadas:
  //   FACTOR_KN  = 4·1000 / π             = 1273.2395447...
  //   FACTOR_TONF= 4·9806.65 / π          = 12486.2145806...
  // Las hardcodeamos con suficientes decimales para coincidir con la
  // implementación previa del frontend (compatibilidad bit-a-bit con tests
  // legacy del flujo viejo).
  const FACTOR_KN = 1273.239545;
  const FACTOR_TONF = 12486.214581;
  const factor = esTonf ? FACTOR_TONF : FACTOR_KN;
  const sigmaSinCorreccion = (factor * Q) / (d * d);
  const factorHDAplicado = factorHD != null
    ? Number(factorHD)
    : factorCorreccionHD(altura, d);
  const sigma = sigmaSinCorreccion * factorHDAplicado;
  return {
    resistencia: Math.round(sigma * 100) / 100, // 2 decimales (DECIMAL(5,2))
    factorHDAplicado,
    unidadDetectada: esTonf ? 'tonf' : 'kN',
  };
}

/**
 * API de alto nivel: dado el input completo del formulario de ensayo,
 * devuelve todos los valores derivados que el backend debe persistir.
 *
 * Esta es la función que debería invocarse tanto en frontend (preview de
 * UX) como en backend (recálculo + validación). Garantiza misma fuente
 * de verdad.
 *
 * @param {object} input
 * @param {number} input.lecturaPrensa
 * @param {object} input.prensa             { coeficienteUno, coeficienteDos, coeficienteTres, unidadMedida }
 *                                          o { ..., unidad } directo.
 * @param {number} input.diametro
 * @param {number} input.altura
 * @param {number} [input.factorCorreccionHD]   Override del auto-calculado.
 * @returns {{ cargaAplicada, resistencia, factorCorreccionHD, unidadDetectada } | null}
 */
function evaluarEnsayoResistencia(input) {
  if (!input) return null;
  const { lecturaPrensa, prensa, diametro, altura, cargaAplicada } = input;
  const unidad = prensa?.unidadMedida?.unidad ?? prensa?.unidad ?? null;
  const tipoOperacion = prensa?.tipoOperacion || 'MANUAL';

  // Branch AUTOMATICA / SEMIAUTOMATICA: la prensa reporta la carga directa.
  // No se aplica ecuación de calibración. El input debe traer `cargaAplicada`
  // (el operario la cargó del visor de la prensa). `lecturaPrensa` se ignora.
  // Sin valor → no se puede calcular.
  let carga;
  if (tipoOperacion === 'AUTOMATICA' || tipoOperacion === 'SEMIAUTOMATICA') {
    if (cargaAplicada == null) return null;
    const v = Number(cargaAplicada);
    if (!Number.isFinite(v)) return null;
    carga = v;
  } else {
    // Branch MANUAL: lectura de dial + polinomio de calibración.
    carga = calcularCargaAplicada({ lecturaPrensa, prensa });
    if (carga == null) return null;
  }

  // R5 (revisor-civil 2026-05-08): para probetas MOLDEADAS, el factor
  // H/D no aplica. La norma exige H/D=2 ± tolerancia y descartar la
  // probeta si está fuera. El caller debió validar antes con
  // `validarHDProbetaMoldeada`. Acá forzamos factor=1.000 siempre.
  // El `input.factorCorreccionHD` se ignora explícitamente.
  const r = calcularResistencia({
    cargaAplicada: carga,
    diametro,
    altura,
    unidad,
    factorHD: 1.000,
  });
  if (!r) return null;
  return {
    cargaAplicada: Math.round(carga * 100) / 100, // 2 decimales (DECIMAL(6,2))
    resistencia: r.resistencia,
    factorCorreccionHD: r.factorHDAplicado,
    unidadDetectada: r.unidadDetectada,
    tipoOperacion,
  };
}

/**
 * Valida que una probeta moldeada cumpla H/D = 2 dentro de tolerancia
 * (R5, revisor-civil 2026-05-08).
 *
 * Las probetas moldeadas por IRAM 1524/1534 deben tener H/D = 2. Si la
 * relación está fuera de tolerancia, el ensayo se rechaza (la probeta
 * pudo haberse descabezado por mal moldeo o rotura del encabezado).
 * El factor de corrección por esbeltez de IRAM 1551 SOLO aplica a
 * testigos extraídos, no a probetas moldeadas.
 *
 * @param {number} altura    en mm.
 * @param {number} diametro  en mm.
 * @param {number} [tolPct]  Tolerancia relativa (default 5%).
 * @returns {{ valido: boolean, hdReal: number|null, hdEsperado: 2, motivo: string }}
 */
function validarHDProbetaMoldeada(altura, diametro, tolPct = HD_TOLERANCIA_PROBETA_MOLDEADA_PCT) {
  const h = Number(altura);
  const d = Number(diametro);
  if (!Number.isFinite(h) || !Number.isFinite(d) || d <= 0 || h <= 0) {
    return {
      valido: false,
      hdReal: null,
      hdEsperado: 2,
      motivo: 'Altura o diámetro inválidos.',
    };
  }
  const hd = h / d;
  const min = 2 * (1 - tolPct);
  const max = 2 * (1 + tolPct);
  if (hd < min || hd > max) {
    return {
      valido: false,
      hdReal: Math.round(hd * 1000) / 1000,
      hdEsperado: 2,
      motivo: `Probeta moldeada con H/D=${hd.toFixed(3)} fuera de tolerancia [${min.toFixed(3)}, ${max.toFixed(3)}]. IRAM 1524/1534 exige H/D=2 al moldear. La probeta debe descartarse — el factor de IRAM 1551 sólo aplica a testigos extraídos.`,
    };
  }
  return {
    valido: true,
    hdReal: Math.round(hd * 1000) / 1000,
    hdEsperado: 2,
    motivo: 'H/D dentro de tolerancia.',
  };
}

/**
 * Verifica si dos valores numéricos coinciden dentro de una tolerancia
 * relativa. Usado por el backend para validar los valores enviados por
 * el frontend contra el recálculo del engine (C-LOG-01).
 *
 * @param {number} esperado     Valor calculado por el engine (autoritativo).
 * @param {number} recibido     Valor enviado por el cliente.
 * @param {number} [tolPct]     Tolerancia relativa (default 1 % = 0.01).
 * @returns {boolean}
 */
function valoresCoinciden(esperado, recibido, tolPct = 0.01) {
  const a = Number(esperado);
  const b = Number(recibido);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 0) return Math.abs(b) < 1e-6;
  return Math.abs(a - b) / Math.abs(a) <= tolPct;
}

module.exports = {
  TABLA_FACTOR_HD,
  TIPOS_ROTURA,
  TIPOS_ROTURA_FIGURA_2,
  HD_TOLERANCIA_NO_CORRECCION,
  HD_TOLERANCIA_PROBETA_MOLDEADA_PCT,
  factorCorreccionHD,
  validarHDProbetaMoldeada,
  calcularCargaAplicada,
  calcularResistencia,
  evaluarEnsayoResistencia,
  esUnidadToneladaFuerza,
  valoresCoinciden,
};
