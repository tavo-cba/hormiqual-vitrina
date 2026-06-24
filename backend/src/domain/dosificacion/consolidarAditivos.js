'use strict';

/**
 * consolidarAditivos — agrupa slots de aditivos por producto físico (id).
 *
 * RAZÓN (P1.2):
 * El diseño permite hasta 3 slots de aditivos. La UI no impide que el usuario
 * cargue el MISMO producto en dos slots distintos (ej: una vez como base en
 * planta y otra como corrección en obra; o por error). El motor `hormiqualCalcEngine`
 * iteraba los 3 slots sumando independientemente el "aire colateral", así que
 * un mismo producto con dosis 0,5% + 0,5% terminaba contando como 1,0% de
 * aire incorporado colateral cuando físicamente es UN producto con 1,0% de
 * dosis total.
 *
 * Regla aplicada: si dos slots referencian el mismo `id`, se consolidan en
 * una única entrada cuya `dosisTotal` es la suma de las dosis individuales.
 * Las propiedades intrínsecas del producto (aireIncorporadoPctEsperado,
 * dosisHabitual, etc.) se toman de la primera ocurrencia (son iguales por
 * tratarse del mismo producto).
 *
 * Esto NO modifica el ingreso de datos: los 3 slots se siguen guardando como
 * estaban. La consolidación se aplica solo en los puntos de cálculo donde
 * importa el efecto agregado del producto físico.
 */

/**
 * Devuelve los slots agrupados por id de producto.
 *
 * @param {Array<Object|null>} slots - típicamente [aditivo1, aditivo2, aditivo3]
 * @returns {Array<{
 *   id: number,
 *   dosisTotal: number,
 *   slotsContribuyentes: number[],
 *   esDuplicado: boolean,
 *   ...resto del producto (aireIncorporadoPctEsperado, dosisMinima, etc.)
 * }>}
 */
function consolidarPorProducto(slots) {
  if (!Array.isArray(slots)) return [];
  const grupos = new Map();

  slots.forEach((ad, idx) => {
    if (!ad || ad.id == null) return;
    const key = ad.id;
    const dosisNum = Number(ad.dosis) || 0;
    if (!grupos.has(key)) {
      grupos.set(key, {
        ...ad,
        dosisTotal: dosisNum,
        slotsContribuyentes: [idx + 1],
        // Mantener `dosis` apuntando al total para compatibilidad con código
        // que lee `ad.dosis` directamente.
        dosis: dosisNum,
      });
    } else {
      const existente = grupos.get(key);
      existente.dosisTotal += dosisNum;
      existente.dosis = existente.dosisTotal;
      existente.slotsContribuyentes.push(idx + 1);
    }
  });

  return Array.from(grupos.values()).map((g) => ({
    ...g,
    esDuplicado: g.slotsContribuyentes.length > 1,
  }));
}

/**
 * Devuelve los productos que aparecen en más de un slot.
 * Útil para emitir advertencias visibles al usuario.
 *
 * @param {Array<Object|null>} slots
 * @returns {Array<{ id, slots: number[], dosisTotal: number, nombre: string }>}
 */
function detectarDuplicados(slots) {
  return consolidarPorProducto(slots)
    .filter((g) => g.esDuplicado)
    .map((g) => ({
      id: g.id,
      slots: g.slotsContribuyentes,
      dosisTotal: g.dosisTotal,
      nombre: g.descripcion || g.nombre || g.marca || `Aditivo #${g.id}`,
    }));
}

module.exports = {
  consolidarPorProducto,
  detectarDuplicados,
};
