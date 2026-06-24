'use strict';

/**
 * correccionHumedadEngine.js — PR9
 *
 * Engine PURO: ajusta cantidades de agregado y agua del pastón cuando los
 * agregados tienen humedad superficial medida en planta (no coinciden con
 * el supuesto seco-saturado del cálculo de diseño).
 *
 * Lógica simplificada (corrección clásica IRAM/CIRSOC):
 *
 *   - El cálculo de diseño asume agregados en condición SSS (superficie seca
 *     saturada). En obra los agregados suelen tener:
 *       humedadPct  = humedad superficial total medida (% sobre seco).
 *       absorcionPct = absorción del agregado (% que llena los poros).
 *
 *   - Humedad libre = humedadPct − absorcionPct
 *       Si humedad libre > 0: el agregado APORTA agua al mix → restamos del
 *         agua de mezclado y AUMENTAMOS la masa del agregado a cargar (porque
 *         pesa más en estado húmedo).
 *       Si humedad libre < 0: el agregado ABSORBE agua del mix → sumamos al
 *         agua de mezclado y reducimos la masa de agregado.
 *
 *   - Fórmulas (cantidades por m³):
 *       masaHumeda = masaSeca * (1 + humedadPct/100)
 *       aguaCorrec = aguaTeorica − Σ masaSeca_i * (humedadLibre_i/100)
 *
 * Función PURA: recibe arrays + valores, devuelve resultado. Sin DB.
 */

/**
 * Calcula la corrección de cantidades de agregados y agua para un mix
 * dado a partir de los datos de humedad medidos.
 *
 * @param {object} params
 * @param {Array<{idAgregado:number, masaSecaKgM3:number, humedadPct?:number, absorcionPct?:number, nombre?:string}>} params.agregados
 * @param {number} params.aguaTeoricaLM3 - Agua de mezclado teórica (L/m³ = kg/m³).
 * @returns {{
 *   aguaCorregidaLM3: number,                      // agua de mezclado real (L/m³)
 *   deltaAguaLM3: number,                          // (corregida - teórica) — negativo si los agregados aportan agua
 *   agregadosCorregidos: Array<{
 *     idAgregado, nombre, masaSecaKgM3, masaHumedaKgM3,
 *     humedadPct, absorcionPct, humedadLibrePct,
 *     aportaAguaLM3,                                // delta agua que ese agregado aporta (positivo) o absorbe (negativo)
 *   }>,
 *   advertencias: string[],
 * }}
 */
function calcularCorreccionHumedad({ agregados = [], aguaTeoricaLM3 = 0 } = {}) {
  const advertencias = [];
  let totalDeltaAgua = 0;
  let confiable = true; // M2 — flag de confiabilidad de la corrección
  const agregadosCorregidos = [];

  for (const ag of agregados) {
    const masaSeca = Number(ag.masaSecaKgM3) || 0;
    if (masaSeca <= 0) continue;
    const humedadPct = ag.humedadPct != null ? Number(ag.humedadPct) : null;
    const absorcionPct = ag.absorcionPct != null ? Number(ag.absorcionPct) : null;

    // Si no hay humedad medida, no se puede corregir ese agregado — lo
    // dejamos pasar como estaba.
    if (humedadPct == null) {
      agregadosCorregidos.push({
        idAgregado: ag.idAgregado || null,
        nombre: ag.nombre || null,
        masaSecaKgM3: round3(masaSeca),
        masaHumedaKgM3: round3(masaSeca),
        humedadPct: null,
        absorcionPct,
        humedadLibrePct: null,
        aportaAguaLM3: 0,
      });
      continue;
    }
    if (humedadPct < 0 || humedadPct > 30) {
      advertencias.push(`Humedad del agregado "${ag.nombre || ag.idAgregado}" (${humedadPct}%) está fuera de rango razonable (0–30%). La corrección se calcula igual pero NO debería aplicarse al despacho hasta verificar la medición.`);
      confiable = false;
    }
    const absor = absorcionPct != null && Number.isFinite(absorcionPct) ? absorcionPct : 0;
    const humedadLibrePct = humedadPct - absor;
    const masaHumeda = masaSeca * (1 + humedadPct / 100);
    // Agua que aporta el agregado al mix (kg = L, asumiendo densidad agua = 1).
    const aportaAgua = masaSeca * (humedadLibrePct / 100);
    totalDeltaAgua += aportaAgua;

    agregadosCorregidos.push({
      idAgregado: ag.idAgregado || null,
      nombre: ag.nombre || null,
      masaSecaKgM3: round3(masaSeca),
      masaHumedaKgM3: round3(masaHumeda),
      humedadPct,
      absorcionPct: absor,
      humedadLibrePct: round3(humedadLibrePct),
      aportaAguaLM3: round3(aportaAgua),
    });
  }

  // El agua del mix se reduce por lo que aportan los agregados (humedad libre
  // positiva) o se aumenta por lo que absorben (negativo).
  const aguaCorregida = aguaTeoricaLM3 - totalDeltaAgua;
  const aguaCorregidaSafe = Math.max(0, aguaCorregida);

  if (aguaCorregidaSafe < 0.5 * aguaTeoricaLM3) {
    advertencias.push(
      `Corrección agresiva: el agua corregida (${round3(aguaCorregidaSafe)} L/m³) quedó por debajo del 50% del teórico (${round3(aguaTeoricaLM3)} L/m³). Verificá los valores de humedad medidos.`
    );
    confiable = false;
  }
  if (aguaCorregidaSafe > 1.5 * aguaTeoricaLM3) {
    advertencias.push(
      `Corrección agresiva: el agua corregida (${round3(aguaCorregidaSafe)} L/m³) excede el 150% del teórico (${round3(aguaTeoricaLM3)} L/m³). Verificá las absorciones declaradas.`
    );
    confiable = false;
  }

  return {
    aguaCorregidaLM3: round3(aguaCorregidaSafe),
    deltaAguaLM3: round3(aguaCorregidaSafe - aguaTeoricaLM3),
    agregadosCorregidos,
    advertencias,
    // M2 — false si alguna humedad está fuera del rango razonable (0-30%)
    // o si la corrección queda <50% o >150% del agua teórica. El caller
    // (UI/PDF) puede usar este flag para mostrar un banner/sello visible y
    // bloquear la firma/despacho hasta que se verifique.
    confiable,
  };
}

function round3(v) { return v == null ? null : Math.round(Number(v) * 1000) / 1000; }

module.exports = {
  calcularCorreccionHumedad,
};
