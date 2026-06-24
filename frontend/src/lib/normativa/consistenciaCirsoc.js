/**
 * consistenciaCirsoc.js — Tablas 4.1 y 4.2 CIRSOC 200-2024 §4.1.1
 *
 * Tablas usadas para evaluar conformidad del hormigón fresco respecto a la
 * consistencia (asentamiento) de consigna. La Tabla 4.3 (aire por TMN × clase
 * de exposición) requiere datos que la `Dosificacion` legacy no expone aún
 * (TMN del agregado grueso, clase de exposición); queda como TODO.
 *
 * Fuentes:
 * - CIRSOC 200-2024 §4.1.1 (pág. 4-100): Tabla 4.1 + Tabla 4.2.
 * - §6.7.3.3 (pág. 6-189): "se debe considerar que un resultado de ensayo de
 *   consistencia es no conforme cuando el resultado obtenido no cumpla con lo
 *   especificado en el artículo 4.1.1".
 *
 * Validado contra fuente por subagente revisor-civil (sesión 2026-05-09).
 */

/**
 * Tabla 4.1 — Rangos de asentamiento (mm) por clase de consistencia.
 * Permite identificar la consistencia desde el valor de consigna.
 *
 * Nota: los rangos típicos según práctica argentina son:
 *   Seca:        0–25 mm
 *   Plástica:    25–80 mm
 *   Muy plástica: 80–150 mm
 *   Fluida:      150–220 mm
 *   Muy fluida:  220+ mm (extendido por mesa de fluidez)
 */
export const CONSISTENCIA_RANGOS_MM = Object.freeze([
  { codigo: 'SECA',         label: 'Seca',          min: 0,   max: 25 },
  { codigo: 'PLASTICA',     label: 'Plástica',      min: 25,  max: 80 },
  { codigo: 'MUY_PLASTICA', label: 'Muy plástica',  min: 80,  max: 150 },
  { codigo: 'FLUIDA',       label: 'Fluida',        min: 150, max: 220 },
  { codigo: 'MUY_FLUIDA',   label: 'Muy fluida',    min: 220, max: Infinity },
]);

/**
 * Tabla 4.2 — Tolerancias sobre la consigna (mm).
 * Validado por revisor-civil contra CIRSOC 200-2024 pág. 4-100.
 */
export const TOLERANCIAS_ASENTAMIENTO_MM = Object.freeze({
  SECA:         10,
  PLASTICA:     20,
  MUY_PLASTICA: 20,
  FLUIDA:       30,
  MUY_FLUIDA:   20,
});

/**
 * Identifica la clase de consistencia para un asentamiento dado (mm).
 * @param {number|null} asentMm
 * @returns {{codigo: string, label: string} | null}
 */
export function clasificarConsistencia(asentMm) {
  if (asentMm == null || !Number.isFinite(Number(asentMm))) return null;
  const v = Number(asentMm);
  for (const r of CONSISTENCIA_RANGOS_MM) {
    if (v >= r.min && v < r.max) {
      return { codigo: r.codigo, label: r.label };
    }
  }
  return null;
}

/**
 * Evalúa si un asentamiento medido cumple la consigna ± tolerancia
 * (CIRSOC 200-2024 Tabla 4.2). La tolerancia depende de la clase de
 * consistencia derivada de la consigna.
 *
 * @param {number|null} medidoMm    asentamiento medido en obra (mm).
 * @param {number|null} consignaMm  asentamiento de consigna del diseño (mm).
 * @returns {{
 *   evaluable: boolean,
 *   cumple?: boolean,
 *   consistencia?: {codigo, label},
 *   toleranciaMm?: number,
 *   minMm?: number,
 *   maxMm?: number,
 *   medidoMm?: number,
 *   consignaMm?: number,
 *   cita: string,
 * }}
 */
export function evaluarConsistencia(medidoMm, consignaMm) {
  const cita = 'CIRSOC 200-2024 §4.1.1 Tabla 4.2 (verificación §6.7.3.3)';
  if (medidoMm == null || consignaMm == null) {
    return { evaluable: false, cita };
  }
  const m = Number(medidoMm);
  const c = Number(consignaMm);
  if (!Number.isFinite(m) || !Number.isFinite(c)) {
    return { evaluable: false, cita };
  }
  const consistencia = clasificarConsistencia(c);
  if (!consistencia) return { evaluable: false, cita };

  const tol = TOLERANCIAS_ASENTAMIENTO_MM[consistencia.codigo];
  if (tol == null) return { evaluable: false, cita };

  const minMm = c - tol;
  const maxMm = c + tol;
  const cumple = m >= minMm && m <= maxMm;

  return {
    evaluable: true,
    cumple,
    consistencia,
    toleranciaMm: tol,
    minMm,
    maxMm,
    medidoMm: m,
    consignaMm: c,
    cita,
  };
}

/**
 * Tabla 4.3 — Total de aire natural e intencionalmente incorporado al
 * hormigón, por TMN del agregado grueso × clase de exposición.
 *
 * Validado por revisor-civil contra CIRSOC 200-2024 §4.1.2 pág. 4-101
 * (sesión 2026-05-09). Tolerancia ±1,5 % en cada celda (§6.7.4.3 pág.
 * 6-189). Para hormigones H-35 o superiores, la banda inferior puede
 * reducirse hasta 1,0 punto (§4.1.2.4) — el caller debe aplicar esta
 * regla si corresponde.
 *
 * Excepción §4.1.2.3: para TMN ≥ 53 mm el aire se mide sobre la
 * fracción luego de tamizar a 37,5 mm. La función de evaluación NO lo
 * detecta; es responsabilidad del operador de planta.
 */
export const AIRE_INCORPORADO_TABLA_43 = Object.freeze({
  // TMN (mm) → { c1: { centro, tolerancia }, c2: { centro, tolerancia } }
  // C1 incluye también "hormigón a colocar bajo agua".
  13.2: { c1: { centro: 5.5, tolerancia: 1.5 }, c2: { centro: 7.0, tolerancia: 1.5 } },
  19.0: { c1: { centro: 5.0, tolerancia: 1.5 }, c2: { centro: 6.0, tolerancia: 1.5 } },
  26.5: { c1: { centro: 4.5, tolerancia: 1.5 }, c2: { centro: 6.0, tolerancia: 1.5 } },
  37.5: { c1: { centro: 4.5, tolerancia: 1.5 }, c2: { centro: 5.5, tolerancia: 1.5 } },
});

const TMNS_TABLA_43 = [13.2, 19.0, 26.5, 37.5];
const TMN_TOLERANCIA_MM = 0.1; // Para tolerar 19 vs 19.0 etc.

/**
 * Match exacto contra los TMN tabulados (con tolerancia ±0,1 mm para
 * variaciones numéricas inocuas tipo 19 vs 19,0). Devuelve `null` si
 * el TMN no coincide con ninguna fila de la Tabla 4.3.
 *
 * Por hallazgo del revisor-civil (sesión 2026-05-10): NO se hace
 * redondeo al más cercano. Un TMN no tabulado dispara
 * `evaluable: false` con motivo claro, para no producir veredictos
 * de auditoría sobre datos fuera de tabla.
 */
function tmnTabla43Exact(tmnMm) {
  if (tmnMm == null || !Number.isFinite(Number(tmnMm))) return null;
  const v = Number(tmnMm);
  for (const t of TMNS_TABLA_43) {
    if (Math.abs(v - t) <= TMN_TOLERANCIA_MM) return t;
  }
  return null;
}

/**
 * Evalúa si el aire incorporado medido cumple Tabla 4.3 CIRSOC
 * 200-2024 §4.1.2 (pág. 4-101) ± 1,5 %.
 *
 * @param {number|null} airePct       Aire medido en %.
 * @param {number|null} tmnMm         TMN del agregado grueso en mm. Debe
 *                                    coincidir (±0,1 mm) con uno de los
 *                                    4 TMN tabulados: 13,2 / 19,0 / 26,5
 *                                    / 37,5. Cualquier otro valor produce
 *                                    `evaluable: false` con motivo claro
 *                                    (no se redondea al más cercano).
 * @param {'C1'|'C2'|null} claseExp   Clase de exposición de durabilidad.
 *                                    Si es null, no es evaluable (no asumimos).
 * @param {object} [opts]
 * @param {boolean} [opts.tamizadoPrevio]  Para TMN ≥ 53 mm (fuera de
 *                                    tabla pero contemplado por
 *                                    §4.1.2.3): el aire debe medirse
 *                                    sobre la fracción tamizada por
 *                                    37,5 mm. Si el caller declara
 *                                    `tamizadoPrevio: true`, evaluamos
 *                                    contra la fila 37,5; sino devolvemos
 *                                    `evaluable: false` con motivo.
 * @param {number} [opts.fcMpa]       f'c del hormigón. Si ≥ 35, la banda
 *                                    inferior puede bajar 1,0 % (§4.1.2.4).
 *                                    Aplicación a discreción del usuario;
 *                                    por defecto NO se aplica (criterio
 *                                    conservador).
 * @returns {{
 *   evaluable: boolean,
 *   motivo?: string,
 *   cumple?: boolean,
 *   centro?: number,
 *   tolerancia?: number,
 *   minPct?: number,
 *   maxPct?: number,
 *   medidoPct?: number,
 *   tmnTabla?: number,
 *   claseExposicion?: string,
 *   cita: string,
 * }}
 *
 * Motivos cuando evaluable=false:
 *   - 'DATOS_INCOMPLETOS': falta airePct, tmnMm o claseExp.
 *   - 'CLASE_EXPOSICION_INVALIDA': clase distinta de C1/C2.
 *   - 'TMN_NO_TABULADO': TMN no coincide con 13,2/19/26,5/37,5.
 *   - 'REQUIERE_TAMIZADO_37_5_PREVIO': TMN ≥ 53 sin `tamizadoPrevio: true`.
 */
export function evaluarAire(airePct, tmnMm, claseExp, opts = {}) {
  const cita = 'CIRSOC 200-2024 §4.1.2 Tabla 4.3 (pág. 4-101) ± 1,5 % (verificación §6.7.4.3)';
  if (airePct == null || tmnMm == null || claseExp == null) {
    return { evaluable: false, motivo: 'DATOS_INCOMPLETOS', cita };
  }
  const m = Number(airePct);
  const v = Number(tmnMm);
  if (!Number.isFinite(m) || !Number.isFinite(v)) {
    return { evaluable: false, motivo: 'DATOS_INCOMPLETOS', cita };
  }

  const clase = String(claseExp).toUpperCase();
  if (clase !== 'C1' && clase !== 'C2') {
    return { evaluable: false, motivo: 'CLASE_EXPOSICION_INVALIDA', cita };
  }

  // §4.1.2.3 — TMN ≥ 53 mm: el aire se mide sobre la fracción tamizada
  // por 37,5 mm. Si el caller no declara tamizadoPrevio=true, no es
  // evaluable contra la Tabla 4.3 (el procedimiento es distinto).
  let tmnRef = tmnTabla43Exact(v);
  if (tmnRef == null && v >= 53) {
    if (opts.tamizadoPrevio === true) {
      tmnRef = 37.5;
    } else {
      return { evaluable: false, motivo: 'REQUIERE_TAMIZADO_37_5_PREVIO', cita };
    }
  }
  if (tmnRef == null) {
    return { evaluable: false, motivo: 'TMN_NO_TABULADO', cita };
  }

  const cell = AIRE_INCORPORADO_TABLA_43[tmnRef];
  const target = clase === 'C2' ? cell.c2 : cell.c1;
  const minPct = target.centro - target.tolerancia;
  const maxPct = target.centro + target.tolerancia;
  const cumple = m >= minPct && m <= maxPct;

  return {
    evaluable: true,
    cumple,
    centro: target.centro,
    tolerancia: target.tolerancia,
    minPct,
    maxPct,
    medidoPct: m,
    tmnTabla: tmnRef,
    claseExposicion: clase,
    cita,
  };
}

// NOTA: para que `evaluarAire` sea efectivamente usable desde report-fresh.jsx
// y aceptacionLote.ejs, el endpoint backend `/api/muestras` debe incluir:
//   - `dosificacion.tamanioMaximoNominal.tamanio` (ya disponible en
//     muestraService getFichaMuestra; falta en getMuestras list).
//   - `dosificacion.claseExposicion` (campo nuevo, no existe en modelo
//     Dosificacion legacy — requiere migration y formulario de dosificación
//     que lo capture).
// Mientras estos datos no lleguen, `evaluarAire` retornará `evaluable: false`.
// La UI debe mostrar el aire medido sin badge de cumplimiento, no fallar.
