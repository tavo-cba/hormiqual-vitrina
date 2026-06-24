/**
 * Re-derivación de la trazabilidad tras un ajuste manual de cemento.
 *
 * PROBLEMA (bug DOS-6UCPY6-K72): el ajuste manual de cemento sólo reemplaza
 * `resultado` (vía `aplicarAjusteCemento`). El objeto `trazabilidad` que vino
 * del backend queda PRE-ajuste. La Sección F (G en el informe) lee `resultado`
 * (POST), pero G.1 (balance de volúmenes), I (pulverulento), N (receta de obra)
 * y el Anexo leen de `trazabilidad` → renderizan estado PRE-ajuste, dejando el
 * informe internamente inconsistente.
 *
 * SOLUCIÓN: una proyección pura que re-deriva ÚNICAMENTE los tres sub-objetos
 * de `trazabilidad` que dependen del cemento / volumen de agregados, a partir
 * del `resultado` ajustado (la única fuente de verdad del diseño liberado):
 *   - `agregadosDistribucion`  (kg y volumen por agregado, total)
 *   - `balanceVolumenes`       (V_cemento, V_agregados, total, V_pasta)
 *   - `verificacionPulverulento` (cemento + finos + VEREDICTO Tabla 4.4)
 *
 * El veredicto de pulverulento (CIRSOC 200:2024 Tabla 4.4) NO es cosmético:
 * cambiar el cemento cambia `totalPulverulento` y puede invertir CUMPLE/NO
 * CUMPLE. Por eso se RE-CALCULA, no se re-renderiza. La lógica espeja
 * exactamente la del motor backend
 * (`hormiqual-backend/src/domain/dosificacion/icpaCalcEngine.js` §
 * "Verificación material pulverulento", líneas ~1933-2001):
 *
 *     totalPulverulento = round(cementoNeto + adiciones + Σ(kgAgregado·p300/100))
 *     cumple = totalPulverulento >= minimoKgM3 || excepcionH20
 *
 * `excepcionH20` depende de f'c / exposición / método de colocación — NO del
 * cemento — así que es invariante bajo el ajuste y se reusa tal cual.
 *
 * La Sección B del informe (que muestra explícitamente el delta antes/después)
 * NO usa esto: lee `resultado.ajusteCemento` directamente. Esta proyección es
 * para que TODO EL RESTO del informe sea coherente con el diseño liberado.
 *
 * Es una función PURA: sin estado, sin I/O. Si no hay ajuste aplicado o falta
 * trazabilidad, devuelve la trazabilidad sin tocar (passthrough) — por eso es
 * seguro aplicarla siempre en el boundary de armado del snapshot.
 */

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {object|null} resultado     resultado del motor (POST-ajuste si hubo).
 * @param {object|null} trazabilidad  trazabilidad original del backend (PRE).
 * @returns {object|null} trazabilidad coherente con `resultado`.
 */
export function deriveTrazabilidadConsistente(resultado, trazabilidad) {
  if (!trazabilidad || !resultado) return trazabilidad;
  // Sin ajuste manual aplicado → la trazabilidad del backend ya es coherente.
  if (!resultado.ajusteCemento || resultado.ajusteCemento.aplicado !== true) {
    return trazabilidad;
  }

  const next = { ...trazabilidad };
  const agregadosAjustados = Array.isArray(resultado.agregados) ? resultado.agregados : [];

  /* 1) agregadosDistribucion — kg/volumen por agregado y total ajustados.
        Consumido por: Sección N (receta de obra) y Anexo Técnico. */
  if (next.agregadosDistribucion && agregadosAjustados.length > 0) {
    next.agregadosDistribucion = {
      ...next.agregadosDistribucion,
      items: agregadosAjustados,
      volAgregadosTotal: resultado.volumenAgregados != null
        ? Math.round(Number(resultado.volumenAgregados) * 10000) / 10000
        : next.agregadosDistribucion.volAgregadosTotal,
    };
  }

  /* 2) balanceVolumenes — sólo V_cemento y V_agregados cambian con el ajuste
        (el cemento desplaza volumen hacia/desde agregados). El resto de
        volúmenes (agua, aire, adiciones, aditivos, fibras) es invariante.
        Consumido por: Sección G.1 y Anexo Técnico. */
  if (next.balanceVolumenes) {
    const bv = { ...next.balanceVolumenes };
    const densCemGcm3 = Number(resultado.densidadCementoUsada);
    if (Number.isFinite(densCemGcm3) && densCemGcm3 > 0 && resultado.cementoKgM3 != null) {
      // kg / (g/cm³) = L  (330 / 3,14 = 105,1 L/m³)
      bv.vCemento = r1(Number(resultado.cementoKgM3) / densCemGcm3);
    }
    if (resultado.volumenAgregados != null) {
      bv.vAgregados = r1(Number(resultado.volumenAgregados) * 1000);
    }
    // V_pasta = agua + cemento + aire + adiciones + aditivos (sin agregados).
    if (bv.vPasta != null) {
      bv.vPasta = r1(
        (bv.vAgua || 0) + (bv.vCemento || 0) + (bv.vAire || 0)
        + (bv.vAdiciones || 0) + (bv.vAditivos || 0),
      );
    }
    bv.totalLM3 = r1(
      (bv.vAgua || 0) + (bv.vCemento || 0) + (bv.vAire || 0)
      + (bv.vAdiciones || 0) + (bv.vAditivos || 0) + (bv.vFibras || 0)
      + (bv.vAgregados || 0),
    );
    next.balanceVolumenes = bv;
  }

  /* 3) verificacionPulverulento — RE-CALCULA el veredicto Tabla 4.4 con el
        cemento adoptado + los finos de los agregados re-balanceados.
        Espeja icpaCalcEngine §pulverulento. Consumido por: Sección I. */
  if (next.verificacionPulverulento) {
    const vp = { ...next.verificacionPulverulento };
    // Cemento NETO (sin adiciones) — igual que el motor (`cementoPulv = cementoKg`).
    const cementoPulvRaw = Number(resultado.cementoKgM3) || 0;
    // adicionesPulv: invariante bajo ajuste de cemento (sólo se mueve cemento↔
    // agregado). Usamos el valor (ya redondeado) de la trazabilidad original.
    const adicionesPulvRaw = Number(vp.adicionesPulv) || 0;

    // Finos < 300 µm de los agregados: p300 por agregado es propiedad
    // granulométrica (invariante), pero el kg/m³ cambió por el re-balance.
    let finosRaw = 0;
    const finosDetalle = Array.isArray(vp.finosDetalle)
      ? vp.finosDetalle.map((d) => {
        // Paridad con el motor (icpaCalcEngine §pulverulento): match por ID
        // primero (idAgregado/id/legacyAgregadoId), luego nombre exacto, y
        // sólo como último recurso substring (evita mapear mal cuando un
        // nombre es substring de otro). El re-balance preserva `nombre`, así
        // que en el flujo real el match exacto siempre acierta.
        const did = d.idAgregado ?? d.id ?? d.legacyAgregadoId ?? null;
        const nom = String(d.nombre || '').toLowerCase();
        const ag = (did != null && agregadosAjustados.find((a) =>
          a.id === did || a.idAgregado === did || a.legacyAgregadoId === did))
          || agregadosAjustados.find((a) => String(a.nombre || '').toLowerCase() === nom)
          || agregadosAjustados.find((a) => {
            const an = String(a.nombre || '').toLowerCase();
            return nom && an && (an.includes(nom) || nom.includes(an));
          });
        const kgAgregado = ag ? Number(ag.kgM3) || 0 : Number(d.kgM3) || 0;
        const p300 = Number(d.p300Pct) || 0;
        const aporte = kgAgregado * p300 / 100;
        finosRaw += aporte;
        return { ...d, kgM3: Math.round(kgAgregado), aporteKg: Math.round(aporte) };
      })
      : [];

    const finosAgregadoPulvRaw = finosRaw;
    const totalPulverulento = Math.round(
      cementoPulvRaw + adicionesPulvRaw + finosAgregadoPulvRaw,
    );
    // `excepcionH20` depende de f'c/exposición/método — NO del cemento.
    const cumple = totalPulverulento >= Number(vp.minimoKgM3) || vp.excepcionH20 === true;

    next.verificacionPulverulento = {
      ...vp,
      cementoPulv: Math.round(cementoPulvRaw),
      adicionesPulv: Math.round(adicionesPulvRaw),
      finosAgregadoPulv: Math.round(finosAgregadoPulvRaw),
      finosDetalle,
      totalPulverulento,
      cumple,
    };
  }

  /* 4) fuentesCalculo — el Anexo Técnico renderiza estos strings
        pre-formateados VERBATIM (no los objetos estructurados). El motor
        embebe ahí los valores PRE como texto, así que hay que re-emitir las
        entradas afectadas con los valores POST. Espeja EXACTAMENTE las
        plantillas del motor (icpaCalcEngine §Balance ~2039-2044 y
        §Pulverulento ~2003-2009) para no introducir drift. Audit test53
        marcó estos dos como BLOCKER (Anexo mostraba V_cem/estimado PRE). */
  if (Array.isArray(next.fuentesCalculo)) {
    const bv = next.balanceVolumenes;
    const vp = next.verificacionPulverulento;
    next.fuentesCalculo = next.fuentesCalculo.map((f) => {
      if (!f || typeof f !== 'object') return f;
      if (f.parametro === 'Balance de volúmenes' && bv) {
        return {
          ...f,
          valor: `${bv.totalLM3} L/m³`,
          regla: `V_agua(${bv.vAgua}) + V_cem(${bv.vCemento}) + V_aire(${bv.vAire}) + V_adic(${bv.vAdiciones}) + V_adit(${bv.vAditivos}) + V_agr(${bv.vAgregados}) = ${bv.totalLM3} L/m³`,
        };
      }
      if (f.parametro === 'Material pulverulento mínimo (Tabla 4.4)' && vp) {
        const exc = vp.excepcionH20 === true ? ' (excepción ≤ H-20)' : '';
        return {
          ...f,
          // `valor` (mínimo + TMN) es invariante al ajuste; sólo cambia el
          // `estimado` del `regla`.
          regla: `Mínimo ${vp.minimoKgM3} kg/m³ pasante 300 µm; estimado ${vp.totalPulverulento} kg/m³${exc}`,
        };
      }
      return f;
    });
  }

  return next;
}
