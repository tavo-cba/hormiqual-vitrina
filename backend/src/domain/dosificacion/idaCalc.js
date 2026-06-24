'use strict';

/**
 * Índice de Demanda de Agua (IDA) — Motor HormiQual 1.0
 *
 * ⚠ ÍNDICE HEURÍSTICO HORMIQUAL — NO NORMATIVO ⚠
 *
 * Cada material tiene un IDA que modifica la demanda de agua de la mezcla.
 * IDA = 1.000 → material estándar (sin corrección).
 * IDA > 1.000 → material que demanda más agua.
 * IDA < 1.000 → material que demanda menos agua.
 *
 * Las reglas y los umbrales (3% / 5% / 10% pasante #200, MF<2.0, abs>2.5%,
 * etc.) son **SUGERENCIAS** empíricas basadas en propiedades del material.
 * NO provienen de CIRSOC, IRAM ni de un método publicado: son convención
 * interna HormiQual para enriquecer el cálculo cuando el operador no tiene
 * un valor de IDA medido para sus materiales puntuales.
 *
 * Implicancias:
 *   - El usuario SIEMPRE puede sobrescribir el IDA con un valor manual.
 *   - El output NO debe usarse como veredicto normativo.
 *   - Los rangos están calibrados para hormigones convencionales H-20 a H-40
 *     con agregados típicos argentinos; pueden ser conservadores o
 *     no aplicables a hormigones especiales (HRDC, alta resistencia, etc.).
 */

/**
 * Calcula el IDA sugerido para un agregado fino basándose en sus propiedades.
 * @param {object} props - { pasaTamiz200, absorcion, moduloFinura, subtipo }
 * @returns {number} IDA sugerido (3 decimales)
 */
function calcularIdaSugeridoFino({ pasaTamiz200, absorcion, moduloFinura, subtipo } = {}) {
  let ida = 1.000;

  // Pasa tamiz 200 (material fino < 75 μm) — más finos = más superficie = más agua
  const p200 = Number(pasaTamiz200) || 0;
  if (p200 > 3 && p200 <= 5) ida += 0.02;
  else if (p200 > 5 && p200 <= 10) ida += 0.05;
  else if (p200 > 10) ida += 0.10;

  // Absorción alta en finos
  const abs = Number(absorcion) || 0;
  if (abs > 2.5 && abs <= 4.0) ida += 0.02;
  else if (abs > 4.0) ida += 0.03;

  // MF muy bajo (arena muy fina = más superficie específica)
  const mf = Number(moduloFinura) || 0;
  if (mf > 0 && mf < 2.0) ida += 0.03;

  // Arena de trituración (partículas angulosas + finos de trituración)
  if (subtipo === 'ARENA_TRITURACION' || subtipo === 'TRITURADO_ARTIFICIAL') {
    ida += 0.05;
  }

  return Math.round(ida * 1000) / 1000;
}

/**
 * Calcula el IDA sugerido para un agregado grueso basándose en sus propiedades.
 * @param {object} props - { absorcion, indiceLabjas }
 * @returns {number} IDA sugerido (3 decimales)
 */
function calcularIdaSugeridoGrueso({ absorcion, indiceLajas } = {}) {
  let ida = 1.000;

  // Absorción alta en gruesos
  const abs = Number(absorcion) || 0;
  if (abs > 2.0 && abs <= 3.0) ida += 0.02;
  else if (abs > 3.0) ida += 0.03;

  // Índice de lajas alto
  const lajas = Number(indiceLajas) || 0;
  if (lajas > 25) ida += 0.02;

  return Math.round(ida * 1000) / 1000;
}

/**
 * Calcula el IDA ponderado de una dosificación completa.
 * Promedio ponderado por volumen absoluto de cada componente.
 *
 * @param {Array} componentes - [{ volumenLts, ida }] — volumen en L/m³
 * @returns {{ idaPonderado: number, detalles: Array }}
 */
function calcularIdaPonderado(componentes) {
  if (!componentes?.length) return { idaPonderado: 1.000, detalles: [] };

  let sumIdaVol = 0;
  let sumVol = 0;
  const detalles = [];

  for (const c of componentes) {
    const vol = Number(c.volumenLts) || 0;
    const ida = Number(c.ida) || 1.000;
    if (vol <= 0) continue;

    sumIdaVol += ida * vol;
    sumVol += vol;
    detalles.push({
      nombre: c.nombre || 'Componente',
      volumenLts: vol,
      ida,
      aporte: Math.round((ida - 1) * vol * 10) / 10, // L/m³ de efecto neto
    });
  }

  const idaPonderado = sumVol > 0
    ? Math.round((sumIdaVol / sumVol) * 1000) / 1000
    : 1.000;

  return { idaPonderado, detalles };
}

module.exports = {
  calcularIdaSugeridoFino,
  calcularIdaSugeridoGrueso,
  calcularIdaPonderado,
};
