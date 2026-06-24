'use strict';

/**
 * alivianadoCalcEngine — Motor de dosificación para Hormigón Alivianado con
 * agregado liviano (telgopor en perlas / EPS / perlita / arcilla expandida).
 *
 * Hormigón alivianado NO busca resistencia mecánica como hormigón estructural.
 * Su uso típico es no estructural: contrapisos térmico-acústicos, encofrados
 * perdidos, rellenos livianos. El telgopor reduce drásticamente la
 * resistencia comparado con un hormigón normal de mismo CUC. Por eso usar el
 * Ábaco a/c del cemento (calibrado con áridos pétreos densos) introduce un
 * error sistemático: el cemento sobra y el f'c declarado es ficticio.
 *
 * Modelo de cálculo (decisión 2026-05-29, análogo a HRDC):
 *   - Fuera de CIRSOC 200 (modelo no normativo, equivalente a HRDC).
 *   - Input directo del operario: CEMENTO (kg/m³). NO se deriva de f'ce.
 *   - Agua gobernada por CONSISTENCIA OBJETIVO (asentamiento o extendido),
 *     usando anclas Segerer reusadas de HRDC. NO se usa Ábaco 1 ICPA.
 *   - a/c queda como CONSECUENCIA INFORMATIVA, no se exige.
 *   - f'ce es OPCIONAL. Si se carga, solo verificación orientativa contra
 *     la banda de resistencia esperada por (cemento × densidad fresca).
 *   - La densidad fresca SE CALCULA (suma de masas) y reporta como dato
 *     principal — es el output que el usuario busca.
 *   - Verificaciones CIRSOC NO se aplican (igual que HRDC).
 *
 * Pureza: engine puro (no DB, no HTTP, no Sequelize).
 *
 * @see docs/decisiones_arquitectura.md §10 (identidad de motor)
 * @see hrdcCalcEngine.js (mismo patrón para RDC)
 */

const { consolidarPorProducto } = require('./consolidarAditivos');

const MOTOR_VERSION = 'HormiQual v2.0';
const MODELO_CALCULO_LABEL = 'Alivianado — Hormigón con agregado liviano (modelo no normativo)';

/* ── Constantes físicas y por defecto ────────────────────────────────────── */

const DENSIDAD_CEMENTO_DEFAULT_GCM3 = 3.10;
const DENSIDAD_ADITIVO_DEFAULT_GCM3 = 1.05;
const DENSIDAD_AGUA_KGM3 = 1000;

// Rango operativo de cemento (CUC, kg/m³). Alivianados típicos 200-400.
const CEMENTO_MIN_KGM3 = 100;
const CEMENTO_MAX_KGM3 = 450;

// Aire atrapado típico en hormigón alivianado (1-2%). NO es aire celular
// intencional como en HRDC — el alivianado reduce densidad por las perlas
// físicas, no por aire.
const AIRE_ATRAPADO_DEFAULT_PCT = 2;

// Rango operativo de la dosis de perlas (L/m³).
const DOSIS_PERLAS_MIN_LM3 = 50;
const DOSIS_PERLAS_MAX_LM3 = 400;
const DOSIS_PERLAS_DEFAULT_LM3 = 240;

// Densidad típica de telgopor expandido (EPS) en perlas (kg/m³). Se
// sobrescribe con la `densidad` del material liviano elegido si está
// cargada. 14 kg/m³ es el valor típico de obra del usuario.
const DENSIDAD_TELGOPOR_DEFAULT_KGM3 = 14;

/* ── Anclas agua por consistencia ────────────────────────────────────────────
   Reusan las de HRDC (validadas con dosificaciones reales). El alivianado
   usa el mismo principio: el agua la gobierna la consistencia objetivo. La
   calibración por planta (`factorAguaConsistencia`) se reusa también del
   `Planta.rdcFactorAguaConsistencia` para no agregar otra columna. */
const AGUA_ANCLAS = {
  // Asentamiento (cono de Abrams, cm) → agua base L/m³.
  ASENTAMIENTO: [
    { x: 8,  agua: 155 }, { x: 12, agua: 168 }, { x: 18, agua: 182 },
    { x: 22, agua: 192 }, { x: 25, agua: 203 },
  ],
  // Extendido del cono (escurrimiento, cm) → agua base L/m³.
  EXTENDIDO_CONO: [
    { x: 35, agua: 175 }, { x: 44, agua: 188 }, { x: 50, agua: 200 },
  ],
};
const CONSISTENCIA_METODOS = Object.keys(AGUA_ANCLAS);

/* ── Resistencia esperada (banda orientativa) ────────────────────────────────
   Tabla referencial 2D — densidad fresca × CUC → banda f'c (MPa) esperada.
   100% orientativa. Sin dataset propio del tenant, el ensayo de probeta es
   el que manda. La banda se reporta como "informativa" en el output, NO
   como veredicto. Ejemplo: hormigón liviano 1500-1800 kg/m³ con 300 kg/m³
   de cemento → f'c esperado 6-12 MPa orientativos. */
const RESISTENCIA_ESPERADA_TABLA = [
  // { densidadMin, densidadMax, bandas: { CUC: [rMin, rMax] } }
  { densidadMin: 800,  densidadMax: 1200, bandas: { 200: [0.5, 1.5], 300: [1.5, 3],  400: [3, 5]  } },
  { densidadMin: 1200, densidadMax: 1500, bandas: { 200: [1, 3],     300: [3, 6],    400: [6, 10] } },
  { densidadMin: 1500, densidadMax: 1800, bandas: { 200: [3, 6],     300: [6, 12],   400: [10, 18] } },
  { densidadMin: 1800, densidadMax: 2100, bandas: { 200: [5, 10],    300: [10, 18],  400: [15, 25] } },
];

/* ── Helpers de matemática pura ──────────────────────────────────────────── */

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function redondear(n, dec = 2) {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, dec);
  return Math.round(n * f) / f;
}

function lerp(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

/**
 * Detecta si un componente representa un agregado grueso. Acepta tanto el
 * shape canónico de ICPA (`{tipo:'FINO'|'GRUESO'}`) como variantes legacy.
 */
function esAgregadoGrueso(c) {
  if (!c) return false;
  const tipo = String(c.tipo || '').toUpperCase();
  const tipoAg = String(c.tipoAgregado || '').toUpperCase();
  const uso = String(c.uso || '').toUpperCase();
  if (tipo === 'AGREGADO_LIVIANO' || tipo === 'LIVIANO' || c.esLiviano === true) return false;
  if (tipo === 'GRUESO' || tipoAg === 'GRUESO') return true;
  if (uso === 'GRUESO' || uso === 'AG') return true;
  if (tipo === 'AGREGADO_GRUESO' || tipo === 'AG') return true;
  return false;
}

function obtenerDensidadKgM3(c) {
  if (!c) return 0;
  if (Number(c.densidadKgM3) > 0) return Number(c.densidadKgM3);
  if (Number(c.densidadAparenteSSS) > 0) return Number(c.densidadAparenteSSS) * 1000;
  if (Number(c.densidad) > 0) {
    const d = Number(c.densidad);
    return d < 10 ? d * 1000 : d;
  }
  return 0;
}

/* ── Cálculo del agua desde consistencia ─────────────────────────────────── */

/**
 * Agua base por consistencia (interpolación lineal sobre anclas, clamp
 * fuera de rango). Mismo patrón que HRDC.
 */
function aguaBaseDesdeConsistencia(metodo, valorCm) {
  const anclas = AGUA_ANCLAS[metodo];
  if (!anclas || valorCm == null || !Number.isFinite(Number(valorCm))) return null;
  const v = Number(valorCm);
  if (v <= anclas[0].x) return { agua: anclas[0].agua, clamp: v < anclas[0].x ? 'min' : null };
  const last = anclas[anclas.length - 1];
  if (v >= last.x) return { agua: last.agua, clamp: v > last.x ? 'max' : null };
  for (let i = 0; i < anclas.length - 1; i++) {
    const a = anclas[i], b = anclas[i + 1];
    if (v >= a.x && v <= b.x) {
      return { agua: Math.round(lerp(v, a.x, a.agua, b.x, b.agua) * 10) / 10, clamp: null };
    }
  }
  return null;
}

/* ── Resistencia esperada ────────────────────────────────────────────────── */

/**
 * Banda de resistencia esperada (MPa) en función del CUC y la densidad
 * fresca. Interpolación lineal entre claves de cemento. Devuelve {min, max}
 * MPa o null si fuera de rango. SOLO ORIENTATIVA — el ensayo de probeta es
 * el que manda.
 */
function bandaResistenciaEsperada(cementoKgM3, densidadFrescaKgM3) {
  const c = Number(cementoKgM3);
  const d = Number(densidadFrescaKgM3);
  if (!Number.isFinite(c) || c <= 0 || !Number.isFinite(d) || d <= 0) return null;

  // Buscar la fila de densidad que contiene d (clamp a la más cercana).
  let fila = RESISTENCIA_ESPERADA_TABLA.find(f => d >= f.densidadMin && d < f.densidadMax);
  if (!fila) {
    if (d < RESISTENCIA_ESPERADA_TABLA[0].densidadMin) fila = RESISTENCIA_ESPERADA_TABLA[0];
    else fila = RESISTENCIA_ESPERADA_TABLA[RESISTENCIA_ESPERADA_TABLA.length - 1];
  }

  const cucKeys = Object.keys(fila.bandas).map(Number).sort((a, b) => a - b);
  // Clamp + interp para CUC.
  if (c <= cucKeys[0]) {
    const [rMin, rMax] = fila.bandas[cucKeys[0]];
    return { rMin, rMax, clamp: c < cucKeys[0] ? 'cementoBajo' : null };
  }
  const cLast = cucKeys[cucKeys.length - 1];
  if (c >= cLast) {
    const [rMin, rMax] = fila.bandas[cLast];
    return { rMin, rMax, clamp: c > cLast ? 'cementoAlto' : null };
  }
  for (let i = 0; i < cucKeys.length - 1; i++) {
    const a = cucKeys[i], b = cucKeys[i + 1];
    if (c >= a && c <= b) {
      const [aMin, aMax] = fila.bandas[a];
      const [bMin, bMax] = fila.bandas[b];
      return {
        rMin: redondear(lerp(c, a, aMin, b, bMin), 1),
        rMax: redondear(lerp(c, a, aMax, b, bMax), 1),
        clamp: null,
      };
    }
  }
  return null;
}

/* ── Tipología check ─────────────────────────────────────────────────────── */

const esTipologiaAlivianado = (codigo) => String(codigo || '').toLowerCase() === 'alivianado';

/* ── Cálculo principal ───────────────────────────────────────────────────── */

/**
 * Calcula la dosificación de un hormigón alivianado.
 *
 * Análogo a HRDC: input directo de cemento (CUC) + consistencia para agua.
 * NO consulta curva a/c del cemento. NO depende del motor normal (ICPA).
 *
 * @param {Object} params
 * @param {number} params.cementoKgM3 — input directo (obligatorio, 100-450).
 * @param {Object} params.consistencia — { metodo: 'ASENTAMIENTO'|'EXTENDIDO_CONO', valorCm }.
 * @param {number} [params.airePct] — default 2% (atrapado típico).
 * @param {Object} params.mezcla — { items: [{nombre, porcentaje, densidad, tipo}] }.
 * @param {Object} params.materialLiviano — { id, nombre, densidad }.
 * @param {number} [params.dosisPerlasLM3] — default 240 L/m³.
 * @param {Object} [params.cemento] — { densidadRelativa, nombre }.
 * @param {Array} [params.aditivos] — [{ nombre, dosisKgM3, densidad }].
 * @param {number} [params.factorAguaConsistencia] — calibración por planta (default 1.0).
 * @param {number} [params.fce] — OPCIONAL, solo verificación orientativa.
 *
 * @returns {{ resultado, trazabilidad, warnings }}
 */
function calcularDosificacionAlivianado(params = {}) {
  const warnings = [];

  // 1) Validaciones de inputs críticos.
  const cementoKgM3 = clamp(Number(params.cementoKgM3) || 0, CEMENTO_MIN_KGM3, CEMENTO_MAX_KGM3);
  if (!params.cementoKgM3 || Number(params.cementoKgM3) <= 0) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'cementoKgM3', tipo: 'error', msg: 'El contenido de cemento (kg/m³) es obligatorio para hormigón alivianado.' }],
    };
  }
  if (Number(params.cementoKgM3) < CEMENTO_MIN_KGM3 || Number(params.cementoKgM3) > CEMENTO_MAX_KGM3) {
    warnings.push({
      campo: 'cementoKgM3',
      tipo: 'advertencia',
      msg: `Cemento ${params.cementoKgM3} kg/m³ está fuera del rango típico (${CEMENTO_MIN_KGM3}-${CEMENTO_MAX_KGM3} kg/m³). Se ajustó al borde más cercano.`,
    });
  }

  const consist = params.consistencia || {};
  const metodoConsist = String(consist.metodo || 'ASENTAMIENTO').toUpperCase();
  if (!CONSISTENCIA_METODOS.includes(metodoConsist)) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'consistencia', tipo: 'error', msg: `Método de consistencia "${consist.metodo}" no soportado. Use ASENTAMIENTO o EXTENDIDO_CONO.` }],
    };
  }

  const materialLiviano = params.materialLiviano;
  if (!materialLiviano || !materialLiviano.id) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'materialLiviano', tipo: 'error', msg: 'Hormigón alivianado requiere un material liviano del catálogo.' }],
    };
  }
  const densidadLivianoKgM3 = Number(materialLiviano.densidad) > 0
    ? Number(materialLiviano.densidad)
    : DENSIDAD_TELGOPOR_DEFAULT_KGM3;

  const dosisPerlasLM3 = clamp(
    Number(params.dosisPerlasLM3) || DOSIS_PERLAS_DEFAULT_LM3,
    DOSIS_PERLAS_MIN_LM3,
    DOSIS_PERLAS_MAX_LM3,
  );

  const mezclaItems = (params.mezcla && Array.isArray(params.mezcla.items)) ? params.mezcla.items : [];
  if (mezclaItems.length === 0) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'mezcla', tipo: 'error', msg: 'La mezcla de agregados es obligatoria (al menos un agregado).' }],
    };
  }

  // 2) Agua desde consistencia × factor planta.
  const factorAgua = Number(params.factorAguaConsistencia) > 0 ? Number(params.factorAguaConsistencia) : 1.0;
  const aguaResp = aguaBaseDesdeConsistencia(metodoConsist, consist.valorCm);
  if (!aguaResp) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'consistencia', tipo: 'error', msg: `Valor de consistencia inválido para método ${metodoConsist}.` }],
    };
  }
  let aguaCalc = aguaResp.agua * factorAgua;
  if (aguaResp.clamp) {
    warnings.push({
      campo: 'consistencia',
      tipo: 'advertencia',
      msg: `Consistencia ${consist.valorCm} cm fuera del rango de anclas ${metodoConsist}. Se extrapoló al borde más cercano.`,
    });
  }

  // 2.b) Reducción de agua por aditivos AHORRO_AGUA en planta. Aplicamos
  //   la misma semántica simplificada que ICPA: si el aditivo declara
  //   modoEfecto='AHORRO_AGUA' y tiene reduccionAguaPctEsperada > 0 y
  //   NO está en etapa OBRA, descuenta `reduccion% × factorDosis` del
  //   agua base. El factorDosis es 1.0 si la dosis usada está dentro del
  //   rango habitual; se interpola lineal entre dosisMinima y dosisHabitual.
  const correccionAditivoTraza = [];
  const aditivosIn2 = Array.isArray(params.aditivos) ? params.aditivos : [];
  // Asignamos el slot por índice para que el shape coincida con el contrato
  // del renderer (que busca `aditivo: "Aditivo N"`, no nombre comercial).
  aditivosIn2.forEach((ad, idx) => {
    if (!ad) return;
    const slotIdx = Number.isFinite(Number(ad.slotIdx)) ? Number(ad.slotIdx) : idx;
    const slotLabel = ad.slotLabel || `Aditivo ${slotIdx + 1}`;
    if (ad.modoEfecto !== 'AHORRO_AGUA') return;
    if (ad.etapa === 'OBRA') {
      correccionAditivoTraza.push({
        aditivo: slotLabel,
        aditivoNombre: ad.nombre,
        modo: 'AHORRO_AGUA', etapa: 'OBRA',
        nota: 'No se aplicó reducción — aditivo en obra',
      });
      return;
    }
    const reduccionDeclaradaPct = Number(ad.reduccionAguaPctEsperada) || 0;
    if (reduccionDeclaradaPct <= 0) return;
    const dosisUsada = Number(ad.dosis) || 0;
    const dosisMin = Number(ad.dosisMinima) || 0;
    const dosisRec = Number(ad.dosisHabitual) || Number(ad.dosisMaxima) || dosisUsada;
    let factorDosis = 1;
    if (dosisUsada > 0) {
      if (dosisMin > 0 && dosisUsada < dosisMin) {
        factorDosis = 0;
      } else if (dosisRec > 0 && dosisUsada < dosisRec) {
        factorDosis = dosisMin > 0
          ? (dosisUsada - dosisMin) / (dosisRec - dosisMin)
          : dosisUsada / dosisRec;
        factorDosis = clamp(factorDosis, 0, 1);
      } else {
        factorDosis = 1;
      }
    }
    const reduccionReal = redondear(reduccionDeclaradaPct * factorDosis, 2);
    const aguaAntes = redondear(aguaCalc, 1);
    aguaCalc = aguaCalc * (1 - reduccionReal / 100);
    const aguaDespues = redondear(aguaCalc, 1);
    correccionAditivoTraza.push({
      aditivo: slotLabel,
      aditivoNombre: ad.nombre,
      modo: 'AHORRO_AGUA',
      reduccionDeclaradaPct,
      factorDosis: redondear(factorDosis, 3),
      // Alias dual: `reduccionPct` es el contrato del renderer (ICPA);
      // `reduccionRealPct` se mantiene como nombre semántico interno.
      reduccionPct: reduccionReal,
      reduccionRealPct: reduccionReal,
      aguaAntes,
      aguaDespues,
    });
  });
  const aguaLtsM3 = Math.round(aguaCalc);

  // 3) Aire atrapado (default 2%).
  const airePct = Number.isFinite(Number(params.airePct)) ? Number(params.airePct) : AIRE_ATRAPADO_DEFAULT_PCT;
  const aireFrac = airePct / 100;

  // 4) Aditivos (opcionales) — masa por m³.
  const aditivosIn = Array.isArray(params.aditivos) ? params.aditivos : [];
  const aditivosConsolidados = (typeof consolidarPorProducto === 'function')
    ? consolidarPorProducto(aditivosIn.map(a => ({ ...a, dosisPctSobreCemento: Number(a.dosis || a.dosisPctSobreCemento) || 0 })))
    : aditivosIn;
  const aditivosCalc = (aditivosConsolidados || []).map(a => {
    const dosisPct = Number(a.dosisPctSobreCemento ?? a.dosis) || 0;
    const dosisKgM3 = (dosisPct / 100) * cementoKgM3;
    const densGcm3 = Number(a.densidad) > 0 ? Number(a.densidad) : DENSIDAD_ADITIVO_DEFAULT_GCM3;
    const volM3 = dosisKgM3 / (densGcm3 * 1000);
    return { nombre: a.nombre, kgM3: redondear(dosisKgM3, 2), densidad: densGcm3, volM3, dosisPctSobreCemento: dosisPct };
  });

  // 5) Volumen de pasta.
  const densCementoGcm3 = Number(params.cemento?.densidadRelativa) > 0 ? Number(params.cemento.densidadRelativa) : DENSIDAD_CEMENTO_DEFAULT_GCM3;
  const volCemento = cementoKgM3 / (densCementoGcm3 * 1000);
  const volAgua = aguaLtsM3 / 1000;
  const volAditivos = aditivosCalc.reduce((a, ad) => a + ad.volM3, 0);
  const volPasta = volCemento + volAgua + volAditivos;

  // 6) Volumen para agregados (pétreos + perlas).
  const volAgTotal = 1 - volPasta - aireFrac;
  if (volAgTotal <= 0) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'cementoKgM3', tipo: 'error', msg: 'Volumen disponible para agregados ≤ 0. Reducí el cemento o la dosis de aditivos.' }],
    };
  }

  // 7) Sustitución por perlas. Las perlas reemplazan parcialmente al
  // agregado grueso (sus volúmenes en la mezcla pétrea se reducen).
  const volPerlasM3 = dosisPerlasLM3 / 1000;
  if (volPerlasM3 >= volAgTotal) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{
        campo: 'dosisPerlasLM3',
        tipo: 'error',
        msg: `Dosis de perlas (${dosisPerlasLM3} L/m³) excede el volumen disponible para agregados (${Math.round(volAgTotal * 1000)} L/m³). Reducí dosis o cemento.`,
      }],
    };
  }

  // 8) Distribuir volumen de agregados pétreos según porcentajes de la mezcla.
  // Las perlas se sustraen del subtotal de GRUESOS (no del fino, que sigue
  // funcionando como envoltorio de las perlas).
  const sumaPct = mezclaItems.reduce((s, it) => s + Number(it.porcentaje || it.porcentajeFinal || 0), 0);
  if (sumaPct <= 0) {
    return {
      resultado: null,
      trazabilidad: { motorVersion: MOTOR_VERSION, modeloCalculoLabel: MODELO_CALCULO_LABEL },
      warnings: [{ campo: 'mezcla', tipo: 'error', msg: 'La mezcla no tiene porcentajes válidos.' }],
    };
  }

  const volAgregadosPetreos = volAgTotal - volPerlasM3;
  const itemsPetreos = mezclaItems.map((it) => {
    const pct = Number(it.porcentaje || it.porcentajeFinal || 0);
    const pctNorm = pct / sumaPct;
    const densItem = Number(it.densidad);
    const densKgM3 = densItem ? (densItem < 10 ? densItem * 1000 : densItem) : 2600;
    const tipo = (it.tipo || it.tipoAgregado || '').toUpperCase() || (densKgM3 > 2700 ? 'GRUESO' : null);
    return { nombre: it.nombre || 'Agregado', porcentaje: pct, pctNorm, densidad: densItem || 2.6, densKgM3, tipo, idAgregado: it.idAgregado };
  });

  const tieneGrueso = itemsPetreos.some(it => esAgregadoGrueso(it));
  if (!tieneGrueso) {
    warnings.push({
      campo: 'mezcla',
      tipo: 'advertencia',
      msg: 'La mezcla no declara agregado grueso. Las perlas sustituyen volumen proporcional al total. Verificá que los tipos de agregado estén bien clasificados.',
    });
  }

  // Cálculo de masas: distribuir volAgregadosPetreos según pctNorm.
  const agregadosOut = itemsPetreos.map((it) => {
    const volItem = volAgregadosPetreos * it.pctNorm;
    const kgM3 = Math.round(volItem * it.densKgM3);
    return {
      nombre: it.nombre,
      tipo: it.tipo || null,
      tipoAgregado: it.tipo || null,
      porcentaje: it.porcentaje,
      proporcionNormalizada: redondear(it.pctNorm * 100, 1),
      volAbsolutoM3: redondear(volItem, 4),
      kgM3,
      densidad: it.densidad,
      densidadOrigen: 'MATERIAL_AGREGADO',
      idAgregado: it.idAgregado,
    };
  });

  // Agregar material liviano como item adicional.
  const masaPerlasKgM3 = volPerlasM3 * densidadLivianoKgM3;
  agregadosOut.push({
    nombre: materialLiviano.nombre || 'Material liviano',
    tipo: 'LIVIANO',
    tipoAgregado: 'LIVIANO',
    porcentaje: 0,
    proporcionNormalizada: 0,
    volAbsolutoM3: redondear(volPerlasM3, 4),
    kgM3: redondear(masaPerlasKgM3, 2),
    densidad: densidadLivianoKgM3,
    densidadSss: densidadLivianoKgM3, // alias para el diagrama volumétrico
    densidadOrigen: 'DECLARADA_FABRICANTE',
    idMaterialLiviano: materialLiviano.id,
    esLiviano: true,
    cargaManual: true,
  });

  // Anotamos `densidadSss` (kg/m³) en cada agregado pétreo para que el
  // diagrama de composición volumétrica pueda recomputar el volumen por
  // ítem como kgM3 / densidadSss.
  agregadosOut.forEach((ag) => {
    if (ag.densidadSss == null && Number(ag.densidad) > 0) {
      const d = Number(ag.densidad);
      ag.densidadSss = d < 10 ? d * 1000 : d;
    }
  });

  // 9) Densidad fresca = suma de masas / 1 m³.
  const masaAgregados = agregadosOut.reduce((a, ag) => a + (Number(ag.kgM3) || 0), 0);
  const masaAditivos = aditivosCalc.reduce((a, ad) => a + ad.kgM3, 0);
  const densidadFrescaKgM3 = cementoKgM3 + aguaLtsM3 + masaAgregados + masaAditivos;

  // 9.b) Balance volumétrico por m³ (todos los valores en L/m³). Se usa
  //   para el diagrama de composición volumétrica y para el PUV teórico.
  //   volPerlasM3 ya está sumado dentro de vAgregados (vagregadosOut incluye
  //   las perlas como item LIVIANO).
  const volAgregadosFinalL = agregadosOut.reduce(
    (a, ag) => a + (Number(ag.volAbsolutoM3) || 0) * 1000, 0,
  );
  const balanceVolumenes = {
    vAgua: Math.round(volAgua * 1000 * 10) / 10,
    vCemento: Math.round(volCemento * 1000 * 10) / 10,
    vAdiciones: 0,
    vAire: Math.round(aireFrac * 1000 * 10) / 10,
    vAditivos: Math.round(volAditivos * 1000 * 10) / 10,
    vAgregados: Math.round(volAgregadosFinalL * 10) / 10,
    vFibras: 0,
    totalLM3: 1000,
  };
  const puvTeorico = {
    valor: Math.round(densidadFrescaKgM3),
    unidad: 'kg/m³',
    nota: 'Suma de masas en condición SSS (incluye perlas livianas).',
  };

  // 10) Banda de resistencia esperada (orientativa).
  const banda = bandaResistenciaEsperada(cementoKgM3, densidadFrescaKgM3);

  // Verificación opcional contra f'ce cargado por el usuario.
  if (params.fce && banda) {
    const fce = Number(params.fce);
    if (Number.isFinite(fce) && fce > 0) {
      if (fce > banda.rMax) {
        warnings.push({
          campo: 'fce',
          tipo: 'advertencia',
          msg: `f'c objetivo ${fce} MPa supera la banda orientativa para esta densidad y CUC (${banda.rMin}-${banda.rMax} MPa). El ensayo de probeta es el que manda.`,
        });
      } else if (fce < banda.rMin) {
        warnings.push({
          campo: 'fce',
          tipo: 'info',
          msg: `f'c objetivo ${fce} MPa está por debajo de la banda orientativa (${banda.rMin}-${banda.rMax} MPa). Sobra margen.`,
        });
      }
    }
  }

  // 11) Observaciones para trazabilidad y PDF.
  const observaciones = [
    'Hormigón alivianado — modelo no normativo (fuera de CIRSOC 200).',
    `Cemento adoptado: ${cementoKgM3} kg/m³ (input directo, no derivado de f'ce).`,
    `Agua adoptada: ${aguaLtsM3} L/m³ (consistencia ${consist.valorCm} cm × factor planta ${factorAgua}).`,
    `Dosis de perlas adoptada: ${dosisPerlasLM3} L/m³ (densidad ${densidadLivianoKgM3} kg/m³ → ${redondear(masaPerlasKgM3, 1)} kg/m³).`,
    `Densidad fresca esperada: ${Math.round(densidadFrescaKgM3)} kg/m³.`,
    banda
      ? `Resistencia esperada orientativa: ${banda.rMin}-${banda.rMax} MPa (banda referencial por densidad y CUC, no calibrada con datos propios de la planta — el ensayo de probeta es el que manda).`
      : 'Resistencia esperada: fuera del rango referencial.',
    'Las perlas se cargan MANUALMENTE en planta (slot manual en Betonmatic).',
  ];

  // 12) Output con shape compatible.
  const resultado = {
    metodo: 'HORMIQUAL',
    motorVersion: MOTOR_VERSION,
    tipologiaCodigo: 'alivianado',
    tmnMm: null,
    asentamientoMm: metodoConsist === 'ASENTAMIENTO' ? Number(consist.valorCm) * 10 : null,
    asentamientoCm: metodoConsist === 'ASENTAMIENTO' ? Number(consist.valorCm) : null,
    extendidoConoCm: metodoConsist === 'EXTENDIDO_CONO' ? Number(consist.valorCm) : null,
    aguaLtsM3,
    cementoTotalKgM3: cementoKgM3,
    cementoKgM3,
    airePct,
    aireAtrapado: airePct,
    aireIncorporado: 0,
    tipoAire: 'ATRAPADO',
    aditivos: aditivosCalc,
    agregados: agregadosOut,
    densidadCementoUsada: densCementoGcm3,
    volumenPasta: redondear(volPasta, 3),
    volumenAgregados: redondear(volAgTotal, 3),
    densidadFrescaKgM3: Math.round(densidadFrescaKgM3),
    densidadFrescaCalc: Math.round(densidadFrescaKgM3), // alias compat HRDC
    balanceVolumenes,
    puvTeorico,
    masaPerlasKgM3: redondear(masaPerlasKgM3, 2),
    dosisPerlasLM3,
    densidadLivianoKgM3,
    idMaterialLiviano: materialLiviano.id,
    nombreMaterialLiviano: materialLiviano.nombre,
    resistenciaEsperadaBanda: banda ? { rMinMpa: banda.rMin, rMaxMpa: banda.rMax, esOrientativa: true } : null,
    // a/c queda como dato informativo, NO se exige.
    ac: redondear(aguaLtsM3 / cementoKgM3, 3),
    fce: params.fce != null ? Number(params.fce) : null,
  };

  const trazabilidad = {
    metodoCalculo: 'ALIVIANADO',
    motorVersion: MOTOR_VERSION,
    modeloCalculoLabel: MODELO_CALCULO_LABEL,
    tipologiaCodigo: 'alivianado',
    // Snapshot de los inputs (necesario para que el guardado considere la
    // trazabilidad completa — el validator exige `trazabilidadJson.inputs`).
    inputs: {
      cementoKgM3,
      consistenciaMetodo: metodoConsist,
      consistenciaValorCm: consist.valorCm,
      airePct,
      dosisPerlasLM3,
      densidadLivianoKgM3,
      idMaterialLiviano: materialLiviano.id,
      factorAguaConsistencia: factorAgua,
      fce: params.fce != null ? Number(params.fce) : null,
    },
    cementoKgM3,
    aguaLtsM3,
    aguaBaseAntesFactor: aguaResp.agua,
    factorAguaConsistencia: factorAgua,
    correccionAditivo: correccionAditivoTraza,
    dosisPerlasLM3,
    densidadLivianoKgM3,
    idMaterialLiviano: materialLiviano.id,
    densidadFrescaKgM3: Math.round(densidadFrescaKgM3),
    masaPerlas: redondear(masaPerlasKgM3, 2),
    bandaResistenciaEsperada: banda,
    observaciones,
  };

  return { resultado, trazabilidad, warnings };
}

/* ── Back-compat: wrapper de ajuste sobre resultado base ─────────────────── */

/**
 * @deprecated Mantenido por back-compat. El motor ahora calcula de forma
 * independiente — esta función traduce el resultado base + extras al input
 * de `calcularDosificacionAlivianado`.
 */
function ajustarDosificacionPorAlivianado(resultadoBase, alivianado = {}) {
  if (!resultadoBase || typeof resultadoBase !== 'object') {
    throw Object.assign(
      new Error('El cálculo del Motor HormiQual no devolvió un resultado base válido.'),
      { code: 'ALIVIANADO_RESULTADO_BASE_INVALIDO' },
    );
  }
  // Traducción mínima: reusa el motor independiente. Útil para tests legacy
  // que pasan un stub con shape ICPA.
  const inner = resultadoBase.resultado || {};
  const items = Array.isArray(inner.agregados)
    ? inner.agregados.filter(ag => !ag.esLiviano).map(ag => ({
        nombre: ag.nombre,
        porcentaje: ag.porcentaje || ag.proporcionNormalizada || 0,
        densidad: ag.densidad,
        tipo: ag.tipo,
        idAgregado: ag.idAgregado,
      }))
    : [];
  const out = calcularDosificacionAlivianado({
    cementoKgM3: Number(inner.cementoTotalKgM3 || inner.cementoKgM3 || 350),
    consistencia: {
      metodo: inner.asentamientoCm != null ? 'ASENTAMIENTO' : 'ASENTAMIENTO',
      valorCm: inner.asentamientoCm != null ? Number(inner.asentamientoCm) : 18,
    },
    airePct: Number(inner.airePct) || AIRE_ATRAPADO_DEFAULT_PCT,
    mezcla: { items },
    materialLiviano: alivianado.agregadoLiviano,
    dosisPerlasLM3: alivianado.dosisPerlasLM3,
    aditivos: inner.aditivos || [],
  });
  // Shape compatible con tests: { ...resultadoBase, resultado, trazabilidad }
  return {
    ...resultadoBase,
    resultado: out.resultado,
    trazabilidad: { ...(resultadoBase.trazabilidad || {}), ...out.trazabilidad },
    warnings: [ ...(resultadoBase.warnings || []), ...out.warnings ],
  };
}

module.exports = {
  calcularDosificacionAlivianado,
  ajustarDosificacionPorAlivianado,
  esTipologiaAlivianado,
  aguaBaseDesdeConsistencia,
  bandaResistenciaEsperada,
  // Exports para tests
  _internal: {
    DOSIS_PERLAS_MIN_LM3,
    DOSIS_PERLAS_MAX_LM3,
    DOSIS_PERLAS_DEFAULT_LM3,
    DENSIDAD_TELGOPOR_DEFAULT_KGM3,
    AIRE_ATRAPADO_DEFAULT_PCT,
    CEMENTO_MIN_KGM3,
    CEMENTO_MAX_KGM3,
    MOTOR_VERSION,
    MODELO_CALCULO_LABEL,
    esAgregadoGrueso,
    obtenerDensidadKgM3,
    CONSISTENCIA_METODOS,
  },
};
