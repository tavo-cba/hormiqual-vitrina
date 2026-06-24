/**
 * Utility functions for cost calculation in dosification.
 * FUNC-02: Análisis de costos por m³
 */

/**
 * Convert price to $/kg based on unidad.
 * @param {number} precioUnitario - Price value
 * @param {string} unidad - 'kg', 'tn', 'L', 'm3'
 * @returns {number} Price per kg (or per L for liquids)
 */
export function convertirPrecioAKg(precioUnitario, unidad) {
  const precio = Number(precioUnitario) || 0;
  switch (unidad) {
    case "tn": return precio / 1000;
    case "kg": return precio;
    case "L":  return precio; // for water/liquids, 1L ≈ 1kg
    case "m3": return precio / 1000; // 1m³ water ≈ 1000L
    default:   return precio;
  }
}

/**
 * Build cost breakdown for a dosification result.
 * @param {object} resultado - Result from calcularDosificacion
 * @param {object} preciosVigentes - Map of `${source}_${sourceId}` → price record
 * @param {object} contexto - { cementoId, cementoSource, adiciones, aditivos, mezclaItems }
 * @returns {{ items: array, totalMateriales: number, totalFlete: number, totalConFlete: number, missingPrecios: string[] }}
 */
export function calcularCostosDosificacion(resultado, preciosVigentes, contexto) {
  if (!resultado || !preciosVigentes) {
    return { items: [], totalMateriales: 0, totalFlete: 0, totalConFlete: 0, missingPrecios: [] };
  }

  const items = [];
  const missingPrecios = [];
  let totalMateriales = 0;
  let totalFlete = 0;

  // Helper to get price for a material
  const getPrice = (source, sourceId) => {
    const key = `${source}_${sourceId}`;
    return preciosVigentes[key] || null;
  };

  // Helper to add a cost item
  const addItem = (nombre, tipo, cantidadKg, cantidadLabel, unidadCantidad, source, sourceId) => {
    const precio = getPrice(source, sourceId);
    if (!precio) {
      missingPrecios.push(nombre);
      items.push({ nombre, tipo, cantidad: cantidadKg, cantidadLabel, unidadCantidad, precioUnit: null, subtotal: null, pct: null, flete: null });
      return;
    }

    const precioPerKg = convertirPrecioAKg(precio.precioUnitario, precio.unidad);
    const subtotal = cantidadKg * precioPerKg;
    totalMateriales += subtotal;

    let flete = 0;
    if (!precio.incluyeFlete && precio.costoFlete) {
      const fletePerKg = convertirPrecioAKg(precio.costoFlete, precio.unidad);
      flete = cantidadKg * fletePerKg;
      totalFlete += flete;
    }

    items.push({
      nombre,
      tipo,
      cantidad: cantidadKg,
      cantidadLabel: cantidadLabel || `${Number(cantidadKg).toFixed(1)}`,
      unidadCantidad: unidadCantidad || "kg",
      precioUnit: precio.precioUnitario,
      precioUnidad: precio.unidad,
      subtotal,
      pct: null, // computed later
      flete,
    });
  };

  // 1. Agua (water) — M9: el costo del agua no está en el catálogo de
  // materiales, por lo que se reporta como "Sin precio" (no como 0). Si el
  // tenant carga un precio del agua en el futuro, se podrá mapear acá.
  if (resultado.aguaLtsM3) {
    items.push({
      nombre: "Agua",
      tipo: "agua",
      cantidad: resultado.aguaLtsM3,
      cantidadLabel: `${Number(resultado.aguaLtsM3).toFixed(1)}`,
      unidadCantidad: "L",
      precioUnit: null,
      subtotal: null,
      pct: null,
      flete: null,
    });
    missingPrecios.push("Agua");
  }

  // 2. Cemento
  if (resultado.cementoKgM3 && contexto.cementoId) {
    addItem(
      contexto.cementoLabel || "Cemento",
      "cemento",
      resultado.cementoKgM3,
      `${Number(resultado.cementoKgM3).toFixed(0)}`,
      "kg",
      "cemento",
      contexto.cementoId
    );
  }

  // 3. Adiciones
  if (resultado.adicion1KgM3 && contexto.adiciones?.[0]) {
    const ad = contexto.adiciones[0];
    addItem(
      ad.label || "Adición 1",
      "adicion",
      resultado.adicion1KgM3,
      `${Number(resultado.adicion1KgM3).toFixed(1)}`,
      "kg",
      "adicion",
      ad.sourceId
    );
  }
  if (resultado.adicion2KgM3 && contexto.adiciones?.[1]) {
    const ad = contexto.adiciones[1];
    addItem(
      ad.label || "Adición 2",
      "adicion",
      resultado.adicion2KgM3,
      `${Number(resultado.adicion2KgM3).toFixed(1)}`,
      "kg",
      "adicion",
      ad.sourceId
    );
  }

  // 4. Aditivos
  if (resultado.aditivos) {
    resultado.aditivos.forEach((adit, i) => {
      if (!adit.kgM3 || !contexto.aditivos?.[i]) return;
      const ctx = contexto.aditivos[i];
      addItem(
        ctx.label || adit.label || `Aditivo ${i + 1}`,
        "aditivo",
        adit.kgM3,
        `${Number(adit.kgM3).toFixed(2)}`,
        "kg",
        "aditivo",
        ctx.sourceId
      );
    });
  }

  // 5. Agregados
  if (resultado.agregados) {
    resultado.agregados.forEach((ag) => {
      if (!ag.kgM3) return;
      const sourceId = ag.idAgregado;
      if (!sourceId) {
        missingPrecios.push(ag.nombre || "Agregado");
        items.push({
          nombre: ag.nombre || "Agregado",
          tipo: "agregado",
          cantidad: ag.kgM3,
          cantidadLabel: `${Number(ag.kgM3).toFixed(0)}`,
          unidadCantidad: "kg",
          precioUnit: null,
          subtotal: null,
          pct: null,
          flete: null,
        });
        return;
      }
      addItem(
        ag.nombre || "Agregado",
        "agregado",
        ag.kgM3,
        `${Number(ag.kgM3).toFixed(0)}`,
        "kg",
        "agregado",
        sourceId
      );
    });
  }

  // Compute percentages
  if (totalMateriales > 0) {
    items.forEach(item => {
      if (item.subtotal != null && item.subtotal > 0) {
        item.pct = (item.subtotal / totalMateriales) * 100;
      }
    });
  }

  return {
    items,
    totalMateriales,
    totalFlete,
    totalConFlete: totalMateriales + totalFlete,
    missingPrecios: [...new Set(missingPrecios)],
  };
}

/**
 * Group cost items by type for the pie chart.
 */
export function agruparCostosPorTipo(items) {
  const groups = {
    Cemento: 0,
    Adiciones: 0,
    Aditivos: 0,
    "Agregados finos": 0,
    "Agregados gruesos": 0,
    Agua: 0,
  };

  items.forEach(item => {
    if (item.subtotal == null) return;
    switch (item.tipo) {
      case "cemento": groups["Cemento"] += item.subtotal; break;
      case "adicion": groups["Adiciones"] += item.subtotal; break;
      case "aditivo": groups["Aditivos"] += item.subtotal; break;
      case "agregado": {
        // R13 — Prefiere `tipoCanonico`/`subtipo` del modelo; fallback heurístico
        // por nombre sólo cuando esos campos no están disponibles (datos legacy).
        const t = String(item.tipoCanonico || item.tipoAgregado || "").toUpperCase();
        const s = String(item.subtipo || item.subtipoMaterial || "").toUpperCase();
        const esFinoModelo =
          ["AF", "AGREGADO_FINO", "FINO", "ARENA"].includes(t) ||
          ["ARENA_NATURAL", "ARENA_TRITURACION", "MEZCLA"].includes(s);
        const esGruesoModelo =
          ["AG", "AGREGADO_GRUESO", "GRUESO"].includes(t) ||
          ["CANTO_RODADO", "PIEDRA_PARTIDA", "TRITURADO_NATURAL", "TRITURADO_ARTIFICIAL"].includes(s);
        let esFino = esFinoModelo;
        if (!esFinoModelo && !esGruesoModelo) {
          const lower = (item.nombre || "").toLowerCase();
          esFino = lower.includes("arena") || lower.includes("fino");
        }
        if (esFino) groups["Agregados finos"] += item.subtotal;
        else groups["Agregados gruesos"] += item.subtotal;
        break;
      }
      case "agua": groups["Agua"] += item.subtotal; break;
      default: break;
    }
  });

  // Filter out zero groups
  return Object.entries(groups)
    .filter(([, v]) => v > 0)
    .map(([label, value]) => ({ label, value }));
}
