'use strict';

/**
 * Corrección por humedad de agregados (Método de volúmenes absolutos).
 *
 * El diseño de dosificación se calcula en condición SSS (Saturado Superficie Seca).
 * Los agregados en obra tienen una humedad natural distinta al estado SSS.
 *
 * Para cada agregado:
 *   Δagua_i = kgSSS_i × (humedad_i − absorción_i) / 100
 *     • humedad > absorción → agregado aporta agua → se resta del agua a agregar
 *     • humedad < absorción → agregado absorbe agua → se suma al agua a agregar
 *
 *   kgNatural_i = kgSSS_i × (100 + humedad_i) / (100 + absorción_i)
 *
 * @param {Object}   resultado       — resultado del motor de cálculo (con .agregados, .aguaLtsM3, .cementoTotalKgM3, etc.)
 * @param {Object[]} humedadInputs   — [{ idAgregado, humedadPct }] humedades naturales por agregado
 * @returns {{ recetaObra, correccionDetalle } | null}
 */
function calcularCorreccionHumedad(resultado, humedadInputs) {
  if (!resultado?.agregados?.length || !humedadInputs?.length) return null;

  // Index humidity by aggregate id
  const humedadMap = new Map();
  for (const h of humedadInputs) {
    if (h.idAgregado != null && h.humedadPct != null) {
      humedadMap.set(Number(h.idAgregado), Number(h.humedadPct));
    }
  }

  // Need at least one aggregate with humidity data
  if (humedadMap.size === 0) return null;

  const round2 = (v) => Math.round(v * 100) / 100;
  const round1 = (v) => Math.round(v * 10) / 10;

  let totalDeltaAgua = 0;
  const items = [];

  for (const ag of resultado.agregados) {
    const idAg = ag.idAgregado || ag.id;
    const humedadPct = humedadMap.get(Number(idAg));
    const absorcionPct = ag.absorcionPct != null ? Number(ag.absorcionPct) : null;
    const kgSSS = ag.kgM3 != null ? Number(ag.kgM3) : null;

    if (humedadPct == null || absorcionPct == null || kgSSS == null || kgSSS === 0) {
      items.push({
        nombre: ag.nombre,
        idAgregado: idAg,
        kgSSS,
        absorcionPct,
        humedadPct: humedadPct ?? null,
        deltaAgua: null,
        kgNatural: null,
        nota: humedadPct == null
          ? 'Sin humedad ingresada'
          : (absorcionPct == null ? 'Sin absorción disponible' : 'Sin peso SSS'),
      });
      continue;
    }

    // Δagua = kgSSS × (humedad − absorción) / 100
    const deltaAgua = round1(kgSSS * (humedadPct - absorcionPct) / 100);
    totalDeltaAgua += deltaAgua;

    // kg natural = kgSSS × (100 + humedad) / (100 + absorción)
    const kgNatural = round1(kgSSS * (100 + humedadPct) / (100 + absorcionPct));

    items.push({
      nombre: ag.nombre,
      idAgregado: idAg,
      kgSSS,
      absorcionPct,
      humedadPct,
      deltaAgua,
      kgNatural,
      nota: null,
    });
  }

  totalDeltaAgua = round1(totalDeltaAgua);

  // Agua de obra = agua de diseño − Δagua total
  // (si Δ > 0, los agregados aportan agua → se agrega menos)
  const aguaDiseno = Number(resultado.aguaLtsM3);
  const aguaObra = round1(aguaDiseno - totalDeltaAgua);

  // Receta de obra
  const recetaObra = {
    aguaLtsM3: aguaObra,
    cementoKgM3: resultado.cementoTotalKgM3 ?? resultado.cementoKgM3,
    adicion1KgM3: resultado.adicion1KgM3 || null,
    adicion2KgM3: resultado.adicion2KgM3 || null,
    aditivos: resultado.aditivos || [],
    agregados: items.map(it => ({
      nombre: it.nombre,
      idAgregado: it.idAgregado,
      kgM3: it.kgNatural ?? it.kgSSS,
      condicion: it.kgNatural != null ? 'NATURAL' : 'SSS',
    })),
    airePct: resultado.airePct,
  };

  // PUV de obra
  const pesoAgregadosObra = recetaObra.agregados.reduce((s, a) => s + (a.kgM3 || 0), 0);
  const cementoTotal = (recetaObra.cementoKgM3 || 0) + (recetaObra.adicion1KgM3 || 0) + (recetaObra.adicion2KgM3 || 0);
  recetaObra.puvObra = round1(aguaObra + cementoTotal + pesoAgregadosObra);

  return {
    recetaObra,
    correccionDetalle: {
      aguaDiseno,
      aguaObra,
      deltaAguaTotal: totalDeltaAgua,
      items,
    },
  };
}

module.exports = { calcularCorreccionHumedad };
