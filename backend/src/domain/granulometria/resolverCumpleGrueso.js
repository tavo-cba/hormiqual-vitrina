'use strict';

/**
 * resolverCumpleGrueso — veredicto unificado para granulometría de AG.
 *
 * Función pura extraída de `services/granulometriaEvalService` en la
 * auditoría 01-calidad Fase C R2 (sesión 2026-05-07). El servicio
 * `granulometriaEvalService` la sigue exportando como pasarela back-compat,
 * pero la lógica vive aquí (domain) para que el engine `ensayoEvalEngine`
 * la consuma sin cruzar capas.
 *
 * Lógica (copiada literal del original):
 * Cuando el AG tiene asignada una curva objetivo (banda específica
 * `idCurvaObjetivo` con su `evaluacion`) Y al mismo tiempo se ejecutó la
 * auto-evaluación contra Tabla 3.5 (`evaluacionAutoGrueso`), preferimos el
 * veredicto de la curva objetivo:
 *   - Razonamiento: la curva objetivo refleja la decisión del usuario sobre
 *     a qué banda debe pertenecer el agregado. La auto-eval Tabla 3.5
 *     calcula el TMN heurísticamente, lo cual puede equivocarse cuando hay
 *     un agregado fraccionado (p. ej. TMN=37,5 → "37,5 a 4,75" en vez de
 *     "37,5 a 19,0"). El usuario conoce mejor el material que la heurística.
 *   - Si las dos difieren, se registra `_discrepanciaBanda` en el resultado
 *     para que la UI avise que la curva objetivo puede estar mal elegida.
 *   - Si no hay curva objetivo → se usa la auto-eval (comportamiento previo).
 *
 * **Mutación**: la función muta `resultado.granulometria._discrepanciaBanda`
 * in-place (lo setea o lo borra). Esa mutación está documentada y aceptada;
 * el caller pasa el objeto que luego persiste con esa marca.
 *
 * @param {object} resultado - Resultado del ensayo (mutable). Debe tener
 *   `granulometria` con shape { idCurvaObjetivo?, evaluacion?, evaluacionAutoGrueso? }.
 * @returns {'CUMPLE' | 'NO_CUMPLE' | null}
 */
function resolverCumpleGrueso(resultado) {
  const g = resultado?.granulometria;
  if (!g) return null;
  const evUsuario = g.evaluacion;
  const eag = g.evaluacionAutoGrueso;
  const hasCurvaObjetivo = g.idCurvaObjetivo != null;

  // Limpiar flag previo — si la condición que lo generó ya no aplica, debe desaparecer
  if (g._discrepanciaBanda) delete g._discrepanciaBanda;

  if (hasCurvaObjetivo && evUsuario && typeof evUsuario.cumple === 'boolean') {
    const cumpleCurva = !!evUsuario.cumple;
    if (eag && !eag.error && typeof eag.cumple === 'boolean' && eag.cumple !== cumpleCurva) {
      // X10 (auditoría 2026-05-08): el mensaje original sugería al usuario
      // que revisara su curva objetivo cuando en realidad la heurística
      // automática es la que puede equivocarse en agregados fraccionados
      // (ej. ripio 19-28 mm con TMN=37,5 mm para el cual la heurística
      // legacy elegía "37,5 a 4,75" en vez de "37,5 a 19,0"). La curva
      // objetivo manual del usuario es la fuente de verdad; la auto-eval
      // es heurística y se reporta como diagnóstico complementario.
      g._discrepanciaBanda = {
        tipo: 'curva_objetivo_vs_tabla_3_5',
        curvaObjetivoCumple: cumpleCurva,
        tabla35Cumple: eag.cumple,
        bandaTabla35: eag.bandaNominal,
        tmnCalculado: eag.tmnMm,
        mensaje:
          `Curva objetivo asignada (manual): ${cumpleCurva ? 'CUMPLE' : 'NO CUMPLE'}. ` +
          `Auto-evaluación heurística contra Tabla 3.5 CIRSOC (banda "${eag.bandaNominal}" ` +
          `inferida por TMN=${eag.tmnMm} mm): ${eag.cumple ? 'CUMPLE' : 'NO CUMPLE'}. ` +
          `Discrepancia esperable en agregados fraccionados — la curva objetivo manual es la fuente de verdad. ` +
          `Si dudás, verificá que el material corresponda a la curva objetivo asignada.`,
      };
    }
    return cumpleCurva ? 'CUMPLE' : 'NO_CUMPLE';
  }

  if (eag && !eag.error && typeof eag.cumple === 'boolean') {
    return eag.cumple ? 'CUMPLE' : 'NO_CUMPLE';
  }

  return null;
}

module.exports = {
  resolverCumpleGrueso,
};
