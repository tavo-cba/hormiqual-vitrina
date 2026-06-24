'use strict';

/**
 * Defaults del Ábaco 1 — referencia ICPA original.
 *
 * Función PURA: sólo datos. Sin DB, sin HTTP, sin Sequelize.
 *
 * La tabla base (CANTO_RODADO) es la publicada por ICPA. Los valores de las
 * formas TRITURADO y MIXTO se derivan multiplicando por los factores 1.10 y
 * 1.05 respectivamente y redondeando al entero más cercano (consistente con
 * la migración seed `20260313-add-forma-to-abaco-icpa.js`).
 *
 * Usado por:
 *   - Migración seed inicial.
 *   - Endpoint "restaurar valores ICPA": pisa la tabla `AbacoCurvaICPA`
 *     con estos defaults cuando un usuario pidió revertir cambios locales.
 */

const MF_ANCHORS = [3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5];

// Cada fila: [asentamientoCm, agua@MF3.0, ..., agua@MF6.5] — base CANTO_RODADO.
const ABACO_BASE_CANTO_RODADO = Object.freeze([
  Object.freeze([ 4, 210, 195, 182, 171, 162, 153, 145, 138]),
  Object.freeze([ 5, 215, 199, 186, 175, 165, 156, 148, 141]),
  Object.freeze([ 6, 217, 203, 190, 178, 167, 159, 151, 144]),
  Object.freeze([ 7, 222, 205, 193, 181, 170, 162, 153, 146]),
  Object.freeze([ 8, 225, 208, 195, 184, 173, 164, 155, 147]),
  Object.freeze([ 9, 227, 211, 197, 185, 175, 165, 157, 149]),
  Object.freeze([10, 230, 213, 199, 186, 176, 166, 159, 150]),
  Object.freeze([11, 232, 215, 202, 189, 178, 168, 160, 152]),
  Object.freeze([12, 234, 216, 204, 191, 180, 170, 162, 154]),
  Object.freeze([13, 235, 218, 205, 193, 182, 172, 163, 155]),
  Object.freeze([14, 236, 221, 206, 194, 183, 173, 164, 156]),
  Object.freeze([15, 238, 222, 207, 195, 184, 174, 165, 157]),
  Object.freeze([16, 240, 224, 209, 196, 185, 175, 166, 158]),
  Object.freeze([17, 242, 225, 210, 197, 186, 176, 167, 159]),
  Object.freeze([18, 243, 226, 211, 198, 187, 177, 168, 160]),
  Object.freeze([19, 244, 227, 212, 200, 188, 178, 169, 161]),
  Object.freeze([20, 246, 229, 214, 201, 189, 179, 170, 162]),
]);

const FACTOR_POR_FORMA = Object.freeze({
  CANTO_RODADO: 1.00,
  MIXTO:        1.05,
  TRITURADO:    1.10,
});

/**
 * Genera el set completo de filas default (17 asentamientos × 8 MF × 3 formas
 * = 408 filas) listas para `bulkInsert` en la tabla `AbacoCurvaICPA`.
 *
 * Cada fila: { asentamientoCm, formaAgregado, moduloFinura, aguaBaseLM3, notas }.
 * Los timestamps los pone el caller para mantener la función pura.
 */
function generarFilasDefault() {
  const rows = [];
  for (const [forma, factor] of Object.entries(FACTOR_POR_FORMA)) {
    for (const dataRow of ABACO_BASE_CANTO_RODADO) {
      const asentamientoCm = dataRow[0];
      for (let i = 0; i < MF_ANCHORS.length; i++) {
        const aguaBase = dataRow[i + 1];
        rows.push({
          asentamientoCm,
          formaAgregado: forma,
          moduloFinura: MF_ANCHORS[i],
          aguaBaseLM3: Math.round(aguaBase * factor),
          notas: `Ábaco 1 ICPA — ${forma} — asentamiento ${asentamientoCm} cm, MF ${MF_ANCHORS[i].toFixed(1)}`,
        });
      }
    }
  }
  return rows;
}

module.exports = {
  MF_ANCHORS,
  ABACO_BASE_CANTO_RODADO,
  FACTOR_POR_FORMA,
  generarFilasDefault,
};
