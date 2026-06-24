'use strict';

/**
 * hacConsistenciaEngine.js — PR8.20
 *
 * Evaluador de consistencia para Hormigón Autocompactante (HAC) según
 * CIRSOC 200:2024 §9.2.3.1 y normas IRAM relacionadas.
 *
 * El HAC se clasifica por destino (tipo de elemento estructural) con
 * extendido objetivo distinto:
 *
 *   Tipo elemento            Extendido objetivo (mm)   Tolerancia (±mm)
 *   horizontal               560                       50
 *   vertical                 630                       50
 *   densamente_armado        700                       50
 *
 * Adicionalmente, todo HAC debe verificar (§9.2.3.1):
 *   - VSI (Visual Stability Index) ≤ 1
 *   - T50 (tiempo en alcanzar extendido = 500 mm) ≤ 4 s
 *     (sólo en hormigón visto / control reforzado)
 *   - Anillo J:
 *       - Diferencia diametros ≤ 25 mm (estándar)
 *       - ≤ 50 mm (en elementos no críticos)
 *
 * Función PURA: recibe medición + tipo, devuelve veredicto. No toca DB.
 *
 * NOTA NORMATIVA: estos valores están en CIRSOC §9.2.3.1 y siguen los
 * criterios EFNARC adoptados por IRAM. Si el cliente usa otra referencia
 * (ASTM C1611, EN 12350-8), el adaptador de inputs debe convertir antes.
 */

const TIPOS_ELEMENTO_HAC = {
  horizontal:        { extendidoObjetivoMm: 560, toleranciaMm: 50, descripcion: 'Elemento horizontal (losas, pavimentos)' },
  vertical:          { extendidoObjetivoMm: 630, toleranciaMm: 50, descripcion: 'Elemento vertical (columnas, muros con armadura normal)' },
  densamente_armado: { extendidoObjetivoMm: 700, toleranciaMm: 50, descripcion: 'Elemento densamente armado (cuantías altas, secciones complejas)' },
};

const VSI_LIMITE = 1;            // Visual Stability Index ≤ 1 (escala 0-3)
const T50_LIMITE_S = 4;          // Tiempo a 500 mm ≤ 4 s
const ANILLO_J_DIF_LIMITE_MM = 25;       // Estándar
const ANILLO_J_DIF_LIMITE_NO_CRITICO_MM = 50; // Elementos no críticos

/**
 * Evalúa una medición de HAC contra los criterios CIRSOC §9.2.3.1.
 *
 * @param {object} medicion - {
 *   extendidoMm,        // requerido (slump-flow / Mesa Graf)
 *   vsi,                // opcional (0-3)
 *   t50Seg,             // opcional
 *   anilloJDifMm,       // opcional (J-Ring blocking step)
 * }
 * @param {object} ctx - {
 *   tipoElemento,       // 'horizontal' | 'vertical' | 'densamente_armado'
 *   esVisto,            // boolean — exige T50
 *   esElementoNoCritico, // boolean — relaja Anillo J a ≤ 50 mm
 * }
 * @returns {{
 *   valido, tipoElemento, extendidoObjetivo, extendidoMedido, dentroExtendido,
 *   vsi: { ok, valor }, t50: { ok, valor, exigido }, anilloJ: { ok, valor, limite },
 *   advertencias, mensajes, fuente
 * }}
 */
function evaluarHAC(medicion, ctx = {}) {
  const out = {
    valido: false,
    tipoElemento: null,
    extendidoObjetivo: null,
    toleranciaExt: null,
    extendidoMedido: null,
    dentroExtendido: null,
    vsi: null,
    t50: null,
    anilloJ: null,
    advertencias: [],
    mensajes: [],
    fuente: 'CIRSOC 200:2024 §9.2.3.1',
  };

  // ── Validar tipo de elemento ──
  const tipo = String(ctx.tipoElemento || '').toLowerCase();
  const cfg = TIPOS_ELEMENTO_HAC[tipo];
  if (!cfg) {
    out.mensajes.push(`Tipo de elemento HAC desconocido: "${ctx.tipoElemento}". Esperado: horizontal | vertical | densamente_armado.`);
    return out;
  }
  out.tipoElemento = tipo;
  out.extendidoObjetivo = cfg.extendidoObjetivoMm;
  out.toleranciaExt = cfg.toleranciaMm;

  // ── Extendido (requerido) ──
  if (medicion.extendidoMm == null || !Number.isFinite(Number(medicion.extendidoMm))) {
    out.mensajes.push('Extendido (slump-flow) requerido para HAC.');
    return out;
  }
  const extMm = Number(medicion.extendidoMm);
  out.extendidoMedido = extMm;
  const extMin = cfg.extendidoObjetivoMm - cfg.toleranciaMm;
  const extMax = cfg.extendidoObjetivoMm + cfg.toleranciaMm;
  out.dentroExtendido = (extMm >= extMin && extMm <= extMax);
  if (!out.dentroExtendido) {
    out.mensajes.push(`Extendido ${extMm} mm fuera del rango [${extMin}, ${extMax}] mm para "${tipo}".`);
  }

  // ── VSI (opcional pero recomendado) ──
  if (medicion.vsi != null && Number.isFinite(Number(medicion.vsi))) {
    const v = Number(medicion.vsi);
    out.vsi = { valor: v, limite: VSI_LIMITE, ok: v <= VSI_LIMITE };
    if (!out.vsi.ok) {
      out.mensajes.push(`VSI=${v} excede límite ${VSI_LIMITE} (Visual Stability Index, §9.2.3.1).`);
    }
  } else {
    out.vsi = { valor: null, limite: VSI_LIMITE, ok: null };
    out.advertencias.push('VSI no medido — recomendado para HAC.');
  }

  // ── T50 (sólo exigido en hormigón visto / control reforzado) ──
  if (medicion.t50Seg != null && Number.isFinite(Number(medicion.t50Seg))) {
    const t = Number(medicion.t50Seg);
    out.t50 = { valor: t, limite: T50_LIMITE_S, ok: t <= T50_LIMITE_S, exigido: !!ctx.esVisto };
    if (ctx.esVisto && !out.t50.ok) {
      out.mensajes.push(`T50=${t} s excede límite ${T50_LIMITE_S} s (hormigón visto, §9.2.3.1).`);
    }
  } else if (ctx.esVisto) {
    out.t50 = { valor: null, limite: T50_LIMITE_S, ok: null, exigido: true };
    out.advertencias.push('T50 no medido — exigido en hormigón visto (§9.2.3.1).');
  } else {
    out.t50 = { valor: null, limite: T50_LIMITE_S, ok: null, exigido: false };
  }

  // ── Anillo J (opcional pero recomendado) ──
  const limAnillo = ctx.esElementoNoCritico ? ANILLO_J_DIF_LIMITE_NO_CRITICO_MM : ANILLO_J_DIF_LIMITE_MM;
  if (medicion.anilloJDifMm != null && Number.isFinite(Number(medicion.anilloJDifMm))) {
    const dif = Number(medicion.anilloJDifMm);
    out.anilloJ = { valor: dif, limite: limAnillo, ok: dif <= limAnillo };
    if (!out.anilloJ.ok) {
      out.mensajes.push(`Anillo J: diferencia ${dif} mm excede límite ${limAnillo} mm.`);
    }
  } else {
    out.anilloJ = { valor: null, limite: limAnillo, ok: null };
    out.advertencias.push('Anillo J no medido — recomendado para HAC.');
  }

  // ── Veredicto global ──
  // Válido si:
  //  - extendido dentro de tolerancia
  //  - VSI ok (si se midió)
  //  - T50 ok (si se exigía y se midió)
  //  - Anillo J ok (si se midió)
  out.valido = out.dentroExtendido
    && (out.vsi.ok !== false)
    && (out.t50.ok !== false || !out.t50.exigido)
    && (out.anilloJ.ok !== false);

  if (out.valido) {
    out.mensajes.unshift(`HAC apto para destino "${tipo}" (${cfg.descripcion}). Extendido ${extMm} mm dentro de [${extMin}, ${extMax}].`);
  }

  return out;
}

module.exports = {
  evaluarHAC,
  TIPOS_ELEMENTO_HAC,
  VSI_LIMITE,
  T50_LIMITE_S,
  ANILLO_J_DIF_LIMITE_MM,
  ANILLO_J_DIF_LIMITE_NO_CRITICO_MM,
};
