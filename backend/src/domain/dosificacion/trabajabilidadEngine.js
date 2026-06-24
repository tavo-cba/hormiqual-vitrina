'use strict';

/**
 * trabajabilidadEngine.js
 *
 * Evaluación de trabajabilidad basada en:
 * - Gráfico de Shilstone (1990): Factor de Grosor (FdG) y Factor de Trabajabilidad (FdT)
 * - Factor de Aptitud de Ken Day: Superficie Específica + cementante + aire → asentamiento estimado
 *
 * Fase 1: Verificación post-diseño. No modifica la dosificación.
 */

/* ═══════════════════════════════════════════════════════════
   Constantes (defaults — pueden ser overridden por BD vía dbParams)
   ═══════════════════════════════════════════════════════════ */

/** Get effective params (DB override or hardcoded defaults).
 *  Accepts either the processed format { factoresSE, rangosFdaBase, offsetsTmn }
 *  or the raw API format { FACTOR_SE, RANGO_FDA, OFFSET_TMN } with row objects.
 *  El caller (service layer) es responsable de cargar los rows desde `req.db`
 *  con scope por request — este engine es puro y no toca la DB.
 */
function getEffectiveParams(dbParams) {
  if (!dbParams) {
    return { factoresSE: FACTORES_SE, rangosFdaBase: RANGOS_FDA_BASE, offsetsTmn: OFFSETS_TMN };
  }

  if (dbParams.factoresSE || dbParams.rangosFdaBase || dbParams.offsetsTmn) {
    return {
      factoresSE: dbParams.factoresSE || FACTORES_SE,
      rangosFdaBase: dbParams.rangosFdaBase || RANGOS_FDA_BASE,
      offsetsTmn: dbParams.offsetsTmn || OFFSETS_TMN,
    };
  }

  // Raw API format (from GET /api/parametros-trabajabilidad): { FACTOR_SE, RANGO_FDA, OFFSET_TMN }
  const factoresSE = dbParams.FACTOR_SE
    ? dbParams.FACTOR_SE.map(r => ({ tamiz: Number(r.clave), factor: Number(r.valor) }))
    : FACTORES_SE;

  const rangosFdaBase = dbParams.RANGO_FDA
    ? dbParams.RANGO_FDA.map(r => ({
        min: Number(r.valor ?? r.valorMin ?? 0),
        max: r.valorMax != null ? Number(r.valorMax) : 999,
        conoMin: r.conoMin != null ? Number(r.conoMin) : null,
        conoMax: r.conoMax != null ? Number(r.conoMax) : null,
        uso: r.etiqueta || '',
        nivel: r.nivel || 'ok',
      }))
    : RANGOS_FDA_BASE;

  const offsetsTmn = dbParams.OFFSET_TMN
    ? dbParams.OFFSET_TMN.map(r => ({ tmn: Number(r.clave), offset: Number(r.valor) }))
    : OFFSETS_TMN;

  return { factoresSE, rangosFdaBase, offsetsTmn };
}

// Factores de Superficie Específica por tamiz (adimensional)
// Fuente: Ken Day / Edwards (1918) / Loudon (1952)
const FACTORES_SE = [
  { tamiz: 75,    factor: 2 },
  { tamiz: 53,    factor: 2 },
  { tamiz: 37.5,  factor: 2 },
  { tamiz: 26.5,  factor: 2 },
  { tamiz: 19,    factor: 2 },
  { tamiz: 13.2,  factor: 4 },
  { tamiz: 9.5,   factor: 4 },
  { tamiz: 4.75,  factor: 8 },
  { tamiz: 2.36,  factor: 16 },
  { tamiz: 1.18,  factor: 27 },
  { tamiz: 0.6,   factor: 39 },
  { tamiz: 0.3,   factor: 58 },
  { tamiz: 0.15,  factor: 81 },
  { tamiz: 0.075, factor: 105 },
];

// Mapeo tamiz alternativo → principal IRAM
const ALT_TO_STD = { 4.8: 4.75, 2.4: 2.36, 1.2: 1.18, 12.5: 13.2, 25: 26.5, 50: 53, 13: 13.2 };

// Rangos base para TMN 19 mm (referencia) — actualizados con rangos continuos modernos
const RANGOS_FDA_BASE = [
  { min: 0,  max: 16, conoMin: null, conoMax: null, uso: 'Inutilizable — mezcla demasiado pedregosa', nivel: 'critico' },
  { min: 16, max: 20, conoMin: 0,    conoMax: 0,    uso: '\u00c1spera \u2014 solo adecuada para asentamiento 0', nivel: 'advertencia' },
  { min: 20, max: 22, conoMin: 0,    conoMax: 80,   uso: 'Pisos resistentes al desgaste, premoldeados con vibraci\u00f3n externa', nivel: 'ok' },
  { min: 22, max: 24, conoMin: 80,   conoMax: 120,  uso: 'Estructural convencional', nivel: 'optimo' },
  { min: 24, max: 26, conoMin: 120,  conoMax: 150,  uso: 'Bombeable est\u00e1ndar', nivel: 'optimo' },
  { min: 26, max: 28, conoMin: 140,  conoMax: 180,  uso: 'Bombeable fluido', nivel: 'optimo' },
  { min: 28, max: 31, conoMin: 180,  conoMax: 220,  uso: 'Fluido superplastificado', nivel: 'ok' },
  { min: 31, max: 999, conoMin: null, conoMax: null, uso: 'Exceso de finos o cementante — revisar mezcla', nivel: 'advertencia' },
];

// Offsets teoricos por TMN (calculados con curvas Fuller)
const OFFSETS_TMN = [
  { tmn: 9.5,  offset:  5.0 },
  { tmn: 12.5, offset:  3.5 },
  { tmn: 13.2, offset:  3.2 },
  { tmn: 19,   offset:  0   },
  { tmn: 25,   offset: -2.3 },
  { tmn: 26.5, offset: -2.5 },
  { tmn: 37.5, offset: -5.0 },
  { tmn: 50,   offset: -6.8 },
];

function obtenerOffsetTMN(tmn, offsetsArr) {
  if (tmn == null) return 0;
  const sorted = [...(offsetsArr || OFFSETS_TMN)].sort((a, b) => a.tmn - b.tmn);
  const exacto = sorted.find(o => Math.abs(o.tmn - tmn) < 0.5);
  if (exacto) return exacto.offset;
  if (tmn <= sorted[0].tmn) return sorted[0].offset;
  if (tmn >= sorted[sorted.length - 1].tmn) return sorted[sorted.length - 1].offset;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (tmn >= sorted[i].tmn && tmn <= sorted[i + 1].tmn) {
      const t = (tmn - sorted[i].tmn) / (sorted[i + 1].tmn - sorted[i].tmn);
      return sorted[i].offset + t * (sorted[i + 1].offset - sorted[i].offset);
    }
  }
  return 0;
}

function obtenerRangosFdA(tmn, rangosBase, offsetsArr) {
  const offset = obtenerOffsetTMN(tmn, offsetsArr);
  return (rangosBase || RANGOS_FDA_BASE).map(r => ({
    ...r,
    min: Math.round((r.min + offset) * 10) / 10,
    max: r.max >= 999 ? 999 : Math.round((r.max + offset) * 10) / 10,
    cono: r.conoMin != null && r.conoMax != null
      ? (r.conoMin === r.conoMax ? `${r.conoMin} mm` : `${r.conoMin}–${r.conoMax} mm`)
      : null,
  }));
}

// Legacy compat
const RANGOS_FDA = obtenerRangosFdA(19);

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

/**
 * Normaliza aberturas alternativas al tamiz IRAM principal.
 */
function normAbertura(ab) {
  return ALT_TO_STD[ab] ?? ab;
}

/**
 * Obtiene el % pasante de la granulometría para un tamiz dado.
 * Busca el tamiz exacto y alternativos comunes.
 * @param {object} granMap - Map de aberturaMm → pasaPct
 * @param {number} tamiz - Abertura del tamiz IRAM en mm
 * @returns {number|null}
 */
function getPasante(granMap, tamiz) {
  if (granMap[tamiz] != null) return granMap[tamiz];
  // Buscar alternativo
  for (const [alt, std] of Object.entries(ALT_TO_STD)) {
    if (std === tamiz && granMap[alt] != null) return granMap[alt];
  }
  return null;
}

/**
 * Construye un mapa aberturaMm → pasaPct desde la curva de mezcla.
 * Acepta array de objetos { aberturaMm, pasaPct } o { tamiz, pasaPct }.
 */
function buildGranMap(curvaMezcla) {
  const map = {};
  if (!Array.isArray(curvaMezcla)) return map;
  for (const p of curvaMezcla) {
    const ab = normAbertura(p.aberturaMm ?? p.abertura ?? p.tamiz);
    const pasa = p.pasaPct ?? p.pasa;
    if (ab != null && pasa != null) {
      map[ab] = Number(pasa);
    }
  }
  return map;
}

/* ═══════════════════════════════════════════════════════════
   Cálculos principales
   ═══════════════════════════════════════════════════════════ */

/**
 * Factor de Grosor (Shilstone)
 * FdG = (% Ret. Acum. 9,5 mm) / (% Ret. Acum. 2,36 mm) × 100
 */
function calcularFactorGrosor(granMap) {
  const pasante_9_5 = getPasante(granMap, 9.5);
  const pasante_2_36 = getPasante(granMap, 2.36);

  if (pasante_9_5 == null || pasante_2_36 == null) return null;

  const ret_9_5 = 100 - pasante_9_5;
  const ret_2_36 = 100 - pasante_2_36;

  if (ret_2_36 <= 0) return null;

  return Math.round((ret_9_5 / ret_2_36) * 1000) / 10; // 1 decimal
}

/**
 * Factor de Trabajabilidad (Shilstone, 1990)
 *
 * Fórmula original: WF = % pasante 2,36 mm + 2,5 × (Cc - 5,0)
 * donde Cc = bolsas de cemento por yd³ (Shilstone usó bolsas de 94 lb = 42,6 kg)
 *
 * Adaptación HormiQual a unidades SI:
 *   Cc = cementante_kg_m3 / 42,6   (bolsas equivalentes de 94 lb — Day 2006)
 *   WF = pasante_236 + 2,5 × (Cc - 5,0)
 *
 * El valor de referencia Cc = 5,0 bolsas corresponde a ~213 kg/m³ de cemento
 * (5 × 42,6 = 213), que era la dosis típica baja en la época de Day/Shilstone.
 * Para dosis modernas (~300-400 kg/m³), Cc va de 7 a 9,4 → WF sube 5-11 pp.
 *
 * Sin cementante, WF = pasante_236 (solo esqueleto árido).
 * Con cementante, WF incorpora el efecto de la pasta en la trabajabilidad.
 *
 * Fuente: Shilstone, J.M. (1990) "Concrete Mixture Optimization", Concrete International, Vol. 12, N.6.
 * Cc: Ken Day (2006), 3ra ed., bolsas de 94 lb = 42,6 kg.
 */
function calcularFactorTrabajabilidad(granMap, cementanteKgM3 = null) {
  const pasante_2_36 = getPasante(granMap, 2.36);
  if (pasante_2_36 == null) return null;

  if (cementanteKgM3 != null && cementanteKgM3 > 0) {
    // Corrección por contenido de cementante (Shilstone WF, bolsas Day 42,6 kg)
    const Cc = cementanteKgM3 / 42.6;
    const wf = pasante_2_36 + 2.5 * (Cc - 5.0);
    return Math.round(wf * 10) / 10;
  }

  // Sin cementante: solo esqueleto árido
  return Math.round(pasante_2_36 * 10) / 10;
}

/**
 * Zona Shilstone basada en FdG y FdT.
 * Barra de tendencia diagonal: FdT ≈ -0,857 × FdG + 89,3
 */
function determinarZonaShilstone(fdg, fdt) {
  if (fdg == null || fdt == null) return null;

  // ── Banda de la Zona II de Shilstone ──
  //
  // Constantes del paper original — Shilstone, James M. (Jr.):
  //   "Concrete Mixture Optimization", Concrete International Vol. 12 N.6,
  //   June 1990, American Concrete Institute (ACI), pp. 33-39.
  //
  //   WF_min(FdG) = 0,125 · FdG + 27,25   (límite inferior Zona II)
  //   WF_max(FdG) = 0,125 · FdG + 35,25   (límite superior Zona II)
  //
  // La banda tiene ancho fijo (8 puntos en WF) y pendiente 0,125 sobre el
  // FdG (Coarseness Factor en el paper). Pendiente positiva: a mayor FdG →
  // mayor WF necesario para equilibrar.
  //
  // NO es norma argentina ni CIRSOC; es convención del método Shilstone,
  // validada por la práctica internacional. El motor la usa para clasificar
  // zonas (I-V) sin override por DB porque los offsets son del método mismo,
  // no parámetros de planta.
  const bandaInf = 0.125 * fdg + 27.25;
  const bandaSup = 0.125 * fdg + 35.25;
  const bandaCentro = (bandaInf + bandaSup) / 2;
  const dentroEnBanda = fdt >= bandaInf && fdt <= bandaSup;
  const arribaDesBanda = fdt > bandaSup;
  const abajoDesBanda = fdt < bandaInf;

  // Verticales
  const derechaDeV1 = fdg < 45; // FdG < 45 = zona III
  const izquierdaDeV2 = fdg > 75; // FdG > 75 = zona I/V

  // Rectángulo Óptimo (datos Excel): FdG 52-68, FdT según pendiente ~33-39
  const optSup = 39 - (fdg - 52) * (39 - 37) / (68 - 52); // superior: (52,39) a (68,37)
  const optInf = 35 - (fdg - 52) * (35 - 33) / (68 - 52); // inferior: (52,35) a (68,33)
  const enOptimo = fdg >= 52 && fdg <= 68 && fdt >= optInf && fdt <= optSup;

  // Sub-zona Óptima (rectángulo punteado, puede extenderse arriba de la banda)
  if (enOptimo) {
    return { zona: 'II', nombre: 'Zona \u00f3ptima', color: '#1e8449',
      descripcion: 'Mezcla en la sub-zona \u00f3ptima. Equilibrio ideal entre fracciones.',
      accion: null };
  }

  // Zona II — Deseable (dentro de la banda, entre V1 y V2)
  if (dentroEnBanda && !derechaDeV1 && !izquierdaDeV2) {
    return { zona: 'II', nombre: 'Deseable', color: '#22c55e',
      descripcion: 'Mezcla en zona deseable. Buen equilibrio entre fracciones.',
      accion: null };
  }

  // Zonas de Shilstone — Shilstone (1990) "Concrete Mixture Optimization"
  // Concrete International Vol. 12 N.6. ACI.
  // lim_inf = bandaInf (piecewise)  |  lim_sup = bandaSup (piecewise)
  // Zona I:   fdg > 75 (siempre, independiente de wf)
  // Zona II:  dentro de la banda Y fdg <= 75
  // Zona III: fdg < 25 Y wf < lim_inf
  // Zona IV:  wf > lim_sup Y fdg <= 45
  // Zona V:   wf < lim_inf Y 25 <= fdg <= 75

  // Zona I — Mal Graduado (FdG > 75, prioridad máxima)
  if (fdg > 75) {
    return { zona: 'I', nombre: 'Mal graduado', color: '#ef4444',
      descripcion: 'Mezcla con alto potencial de segregaci\u00f3n. Exceso de gruesos con d\u00e9ficit de fracci\u00f3n intermedia.',
      accion: 'Aumentar fracci\u00f3n intermedia (2,36\u20139,5 mm) o reducir gruesos.' };
  }

  // Zona III — Óptima para TMN <= 12,5 mm (fdg < 25, debajo de banda)
  if (fdg < 25 && abajoDesBanda) {
    return { zona: 'III', nombre: '\u00d3ptima para TMN <= 12,5 mm', color: '#22c55e',
      descripcion: 'Mezcla \u00f3ptima para hormig\u00f3n con agregado grueso de TMN <= 12,5 mm.',
      accion: null };
  }

  // Zona IV — Exceso de finos (arriba de la banda, fdg <= 45)
  if (arribaDesBanda && fdg <= 45) {
    return { zona: 'IV', nombre: 'Exceso de finos', color: '#f59e0b',
      descripcion: 'Mezcla con exceso de finos. Riesgo de alta permeabilidad, retracci\u00f3n y fisuraci\u00f3n.',
      accion: 'Reducir el porcentaje de arena fina o agregar agregado intermedio.' };
  }

  // Zona V — Muy grueso (debajo de la banda, 25 <= fdg <= 75)
  if (abajoDesBanda && fdg >= 25 && fdg <= 75) {
    return { zona: 'V', nombre: 'Mezcla demasiado gruesa', color: '#ef4444',
      descripcion: 'Mezcla demasiado gruesa y no pl\u00e1stica. D\u00e9ficit de agregado fino.',
      accion: 'Aumentar el porcentaje de agregado fino en la mezcla.' };
  }

  // Zona III ampliada — fdg < 25, dentro o arriba de banda
  if (fdg < 25) {
    return { zona: 'III', nombre: '\u00d3ptima para TMN <= 12,5 mm', color: '#22c55e',
      descripcion: 'Mezcla \u00f3ptima para hormig\u00f3n con agregado grueso de TMN <= 12,5 mm.',
      accion: null };
  }

  // Transiciones — arriba de banda, fdg > 45
  if (arribaDesBanda) {
    return { zona: 'IV', nombre: 'Tendencia a exceso de finos', color: '#f59e0b',
      descripcion: 'Mezcla con tendencia a exceso de finos respecto al equilibrio \u00f3ptimo.',
      accion: 'Considerar reducir la fracci\u00f3n fina o aumentar la intermedia.' };
  }

  // Fallback — debajo de banda pero no clasificado arriba (no debería llegar aquí)
  if (abajoDesBanda) {
    return { zona: 'V', nombre: 'Tendencia a mezcla gruesa', color: '#f59e0b',
      descripcion: 'Mezcla con tendencia a ser demasiado gruesa.',
      accion: 'Considerar aumentar la fracci\u00f3n fina.' };
  }

  // Zona II — Deseable (default: dentro de la banda)
  return { zona: 'II', nombre: 'Deseable', color: '#22c55e',
    descripcion: 'Mezcla en zona deseable. Buen equilibrio entre fracciones.',
    accion: null };
}

/**
 * Superficie Específica del agregado (Ken Day)
 * Suma de (% retenido fracción / 100) × factor SE por tamiz
 */
function calcularSuperficieEspecifica(granMap, factoresSE) {
  const _factores = factoresSE || FACTORES_SE;
  let se = 0;
  let pasanteAnterior = 100;
  const detalle = [];

  for (const { tamiz, factor } of _factores) {
    const pasanteActual = getPasante(granMap, tamiz) ?? pasanteAnterior;
    const retenido = pasanteAnterior - pasanteActual;

    if (retenido > 0) {
      const aporte = (retenido / 100) * factor;
      se += aporte;
      detalle.push({ tamiz, pasante: pasanteActual, retenido: Math.round(retenido * 10) / 10, factor, aporte: Math.round(aporte * 100) / 100 });
    } else if (pasanteActual !== pasanteAnterior) {
      detalle.push({ tamiz, pasante: pasanteActual, retenido: 0, factor, aporte: 0 });
    }

    pasanteAnterior = pasanteActual;
  }

  // Fondo (pasante 0,075 mm)
  if (pasanteAnterior > 0) {
    const aporteFondo = (pasanteAnterior / 100) * 105;
    se += aporteFondo;
    detalle.push({ tamiz: 'fondo', pasante: 0, retenido: Math.round(pasanteAnterior * 10) / 10, factor: 105, aporte: Math.round(aporteFondo * 100) / 100 });
  }

  return { valor: Math.round(se * 100) / 100, detalle };
}

/**
 * Factor de Aptitud (Ken Day, 2006)
 *
 * Fórmula original Day: FdA = SE + Cc - 7,5 + 0,25 × (A - 1)
 *   donde Cc = bolsas de cemento (94 lb = 42,6 kg por bolsa)
 *
 * Fuente: Ken Day, "Concrete Mix Design, Quality Control and Specification",
 *   3ra ed., Taylor & Francis, 2006, Cap. 4 "Suitability Factor".
 *
 * Adaptación HormiQual a unidades SI (kg/m³):
 *   Cc = cementante_kg_m3 / 42,6   (bolsas equivalentes de 94 lb)
 *   FdA = SE + (cem / 42,6) - 7,5 + 0,25 × (aire - 1)
 *
 * Equivalencia del coeficiente:
 *   1 / 42,6 ≈ 0,02347 kg⁻¹ (Day original con 94 lb)
 *   Versiones anteriores de HormiQual usaban 0,025 (≡ 1/40 kg)
 *   Diferencia: ~0,5 puntos de FdA para 350 kg/m³ de cemento.
 *
 * Constante -7,5: calibración original Day para Dmax 19 mm, canto rodado.
 *   Absorbe la conversión de unidades (bolsas/yd³ → bolsas/m³) implícitamente
 *   porque Day calibró con ~5 bolsas/yd³ como referencia central.
 *
 * Factor 0,25 sobre (Aire - 1): cada 1% de aire por encima del 1% base
 *   incrementa el FdA en 0,25 (efecto lubricante de las burbujas).
 *
 * Validación: pendiente — requiere datos de pastones de prueba.
 */
function calcularFactorAptitud(se, cementanteKgM3, airePct) {
  if (se == null || cementanteKgM3 == null) return null;
  const aire = airePct ?? 1;
  // Cc = bolsas equivalentes de 94 lb (42,6 kg) — Day 2006 original
  const Cc = cementanteKgM3 / 42.6;
  return Math.round((se + Cc - 7.5 + 0.25 * (aire - 1)) * 100) / 100;
}

/**
 * Interpretación del FdA según rangos de Ken Day, corregidos por TMN
 * @param {number} fda - Factor de Aptitud calculado
 * @param {number} [tmn=19] - TMN de la mezcla en mm
 */
function interpretarFdA(fda, tmn, rangosBase, offsetsArr) {
  if (fda == null) return null;
  const offset = obtenerOffsetTMN(tmn || 19, offsetsArr);
  const rangos = obtenerRangosFdA(tmn || 19, rangosBase, offsetsArr);
  const rango = rangos.find(r => fda >= r.min && fda < r.max);
  if (!rango) return { cono: null, uso: 'Fuera de rango', nivel: 'critico', offset };

  // For TMN with significant offset (> 19mm), the shifted ranges can produce
  // misleading interpretations. Apply two corrections:
  //
  // 1. "Exceso" near-miss: if FdA is within 3 pts of the boundary and offset < -2,
  //    soften from "advertencia" to "ok" (the exceso is likely a TMN correction artifact).
  // 2. Cono reference: also interpret against TMN 19 (no offset) to provide the
  //    "natural" interpretation alongside the corrected one.
  if (offset < -2) {
    // Check against base ranges (TMN 19) for a more intuitive interpretation
    const rangosBase19 = obtenerRangosFdA(19, rangosBase, offsetsArr);
    const rangoBase = rangosBase19.find(r => fda >= r.min && fda < r.max);

    if (rango.nivel === 'advertencia' && fda < rango.min + 3) {
      // Near-miss exceso: soften
      const rangoAnterior = rangos.find(r => r.nivel === 'ok' && r.max <= rango.min + 0.1);
      if (rangoAnterior) {
        return {
          ...rangoAnterior,
          min: rango.min, max: rango.min + 3,
          uso: rangoBase ? rangoBase.uso : 'Fluido — FdA elevado para el TMN',
          cono: rangoBase?.cono || rangoAnterior.cono,
          conoMin: rangoBase?.conoMin ?? rangoAnterior.conoMin,
          conoMax: rangoBase?.conoMax ?? rangoAnterior.conoMax,
          nivel: 'ok',
          offset,
          notaTMN: `Rangos corregidos por TMN ${tmn} mm (offset ${offset > 0 ? '+' : ''}${offset.toFixed(1)})`,
        };
      }
    }

    // Even if not exceso, prefer base interpretation if it exists and differs
    if (rangoBase && rangoBase.uso !== rango.uso && rangoBase.nivel !== 'advertencia' && rangoBase.nivel !== 'critico') {
      return {
        ...rango,
        uso: rangoBase.uso,
        cono: rangoBase.cono,
        conoMin: rangoBase.conoMin,
        conoMax: rangoBase.conoMax,
        offset,
        notaTMN: `Rangos corregidos por TMN ${tmn} mm (offset ${offset > 0 ? '+' : ''}${offset.toFixed(1)})`,
      };
    }
  }

  return { ...rango, offset };
}

/**
 * Verifica coherencia entre FdA estimado y asentamiento objetivo, corregido por TMN
 */
function verificarCoherenciaAsentamiento(fda, asentamientoObjetivoMm, tmn, rangosBase, offsetsArr) {
  // Use FdA normalizado (con TMN) for the interpretation label,
  // but compare against BOTH base AND TMN-corrected ranges for coherencia.
  // A design is "coherente" if the target falls within EITHER range.
  // This avoids false discrepancies from aggressive TMN corrections.
  const rangoTMN = interpretarFdA(fda, tmn, rangosBase, offsetsArr);
  const rangoBase = interpretarFdA(fda, 19, rangosBase, offsetsArr); // TMN 19 = no offset

  if ((!rangoTMN || rangoTMN.conoMin == null) && (!rangoBase || rangoBase.conoMin == null)) {
    return { estado: 'no_evaluable', mensaje: 'FdA fuera de rango interpretable.' };
  }

  const conoLabel = rangoTMN?.cono || rangoBase?.cono || '';
  const usoLabel = rangoTMN?.uso || rangoBase?.uso || '';

  // Check coherencia against both ranges
  const okTMN = rangoTMN?.conoMin != null && asentamientoObjetivoMm >= rangoTMN.conoMin && asentamientoObjetivoMm <= rangoTMN.conoMax;
  const okBase = rangoBase?.conoMin != null && asentamientoObjetivoMm >= rangoBase.conoMin && asentamientoObjetivoMm <= rangoBase.conoMax;

  if (okTMN || okBase) {
    return { estado: 'coherente', mensaje: `Asentamiento objetivo (${asentamientoObjetivoMm} mm) coherente con FdA (${fda.toFixed(1)} -> ${conoLabel}).` };
  }

  // Use TMN-corrected range for the discrepancy message
  const rango = rangoTMN?.conoMin != null ? rangoTMN : rangoBase;
  if (asentamientoObjetivoMm < (rango?.conoMin || 0)) {
    return { estado: 'fda_alto', mensaje: `FdA (${fda.toFixed(1)}) sugiere asentamiento mayor al objetivo (${asentamientoObjetivoMm} mm vs ${conoLabel}). Posible exceso de finos o cementante.` };
  }
  return { estado: 'fda_bajo', mensaje: `FdA (${fda.toFixed(1)}) sugiere asentamiento menor al objetivo (${asentamientoObjetivoMm} mm vs ${conoLabel}). Considerar m\u00e1s finos, cementante o aditivo.` };
}

/* ═══════════════════════════════════════════════════════════
   API principal
   ═══════════════════════════════════════════════════════════ */

/**
 * Calcula todos los indicadores de trabajabilidad para una dosificación.
 *
 * @param {object} params
 * @param {Array}  params.curvaMezcla - Curva granulométrica del agregado total [{aberturaMm, pasaPct}]
 * @param {number} params.cementanteKgM3 - Cemento total + adiciones (kg/m³)
 * @param {number} params.airePct - Aire total (%)
 * @param {number} params.asentamientoObjetivoMm - Asentamiento objetivo (mm)
 * @param {number} params.tmnMm - TMN de la mezcla (mm)
 * @returns {object} Todos los indicadores calculados
 */
function evaluarTrabajabilidad({ curvaMezcla, cementanteKgM3, airePct, asentamientoObjetivoMm, tmnMm, dbParams = null }) {
  const params = getEffectiveParams(dbParams);
  const granMap = buildGranMap(curvaMezcla);

  // Shilstone (FdT incluye corrección por cementante — WF de Shilstone 1990)
  const fdg = calcularFactorGrosor(granMap);
  const fdtArido = calcularFactorTrabajabilidad(granMap); // solo esqueleto árido
  const fdt = calcularFactorTrabajabilidad(granMap, cementanteKgM3); // corregido por cementante
  const zonaShilstone = determinarZonaShilstone(fdg, fdt);

  // Ken Day — use effective params
  const seResult = calcularSuperficieEspecifica(granMap, params.factoresSE);
  const se = seResult.valor;
  const fda = calcularFactorAptitud(se, cementanteKgM3, airePct);
  const interpretacion = interpretarFdA(fda, tmnMm, params.rangosFdaBase, params.offsetsTmn);
  const coherencia = fda != null && asentamientoObjetivoMm != null
    ? verificarCoherenciaAsentamiento(fda, asentamientoObjetivoMm, tmnMm, params.rangosFdaBase, params.offsetsTmn)
    : null;

  // Nota sobre TMN
  const offsetTmn = obtenerOffsetTMN(tmnMm || 19);
  const notaTmn = tmnMm && Math.abs(tmnMm - 19) > 2
    ? `Rangos corregidos por TMN ${tmnMm} mm (offset ${offsetTmn > 0 ? '+' : ''}${offsetTmn.toFixed(1)}). Referencia original: Dmax 19-20 mm (Ken Day).`
    : null;

  return {
    shilstone: {
      factorGrosor: fdg,
      factorTrabajabilidad: fdt,
      factorTrabajabilidadArido: fdtArido, // sin corrección por cementante
      zona: zonaShilstone,
      notaWF: cementanteKgM3 ? `FdT = ${fdtArido} + 2,5 x (${(cementanteKgM3/42.6).toFixed(2)} - 5,0) = ${fdt} (Shilstone 1990, Cc = cem/42,6 kg — Day 2006)` : null,
    },
    kenDay: {
      superficieEspecifica: se,
      superficieEspecificaDetalle: seResult.detalle,
      factorAptitud: fda,
      interpretacion,
      coherencia,
    },
    tmnMm: tmnMm || null,
    offsetTmn,
    notaTmn,
    // Nota de discrepancia Shilstone vs FdA
    notaDiscrepancia: (() => {
      if (!zonaShilstone || !interpretacion) return null;
      const zonaStr = zonaShilstone.zona || '';
      const fdaNivel = interpretacion.nivel || '';
      // Check zone — use exact match to avoid 'IV'.includes('I') = true
      const esZonaV = zonaStr === 'V' || zonaStr === 'II/V' || zonaStr === 'I/V';
      const esZonaI = zonaStr === 'I';
      const esZonaIV = zonaStr === 'IV' || zonaStr === 'II/IV' || zonaStr === 'III/IV';
      const esZonaDesfavorable = esZonaV || esZonaI || esZonaIV;
      const esFdaFavorable = ['optimo', 'ok'].includes(fdaNivel);
      if (esZonaDesfavorable && esFdaFavorable) {
        // Dynamic text per zone — NEVER use a generic template
        let diagnostico;
        if (esZonaIV) {
          diagnostico = `La mezcla se clasifica en Zona IV (exceso de finos) en el gr\u00e1fico de Shilstone. ` +
            `Esto indica mayor proporci\u00f3n de material fino que lo deseable, lo que puede incrementar la demanda de agua y la retracci\u00f3n.`;
        } else if (esZonaV) {
          diagnostico = `La mezcla se clasifica en Zona V (muy grueso). El esqueleto \u00e1rido tiene d\u00e9ficit de finos, ` +
            `lo que puede producir mezclas \u00e1speras y dif\u00edciles de bombear.`;
        } else if (esZonaI) {
          diagnostico = `La mezcla se clasifica en Zona I (mal graduado). Hay exceso de gruesos y d\u00e9ficit ` +
            `de material intermedio, con riesgo de segregaci\u00f3n.`;
        } else {
          diagnostico = `La mezcla presenta desequilibrio granulom\u00e9trico (Shilstone: ${zonaShilstone.nombre}).`;
        }
        return diagnostico + ` El FdA de Ken Day, que incorpora el contenido de pasta (cemento + aditivo), ` +
          `indica aptitud para ${interpretacion.uso || 'el uso previsto'}. ` +
          `Para validar, se recomienda past\u00f3n de prueba.`;
      }
      return null;
    })(),
    // Nota de borde: cuando el punto está muy cerca del límite de zona
    notaBorde: (() => {
      if (!zonaShilstone || fdg == null || fdt == null) return null;
      // Mismas constantes Shilstone (1990) documentadas en `determinarZonaShilstone`.
      const limInf = 0.125 * fdg + 27.25;
      const limSup = 0.125 * fdg + 35.25;
      const distInf = Math.abs(fdt - limInf);
      const distSup = Math.abs(fdt - limSup);
      const minDist = Math.min(distInf, distSup);
      if (minDist < 1.5) {
        const borde = distInf < distSup ? 'inferior' : 'superior';
        const limiteVal = (borde === 'inferior' ? limInf : limSup).toFixed(1);
        const zonaActual = zonaShilstone.nombre || `Zona ${zonaShilstone.zona || '—'}`;
        // Redacción: diferencia explícita entre clasificación actual, cercanía
        // al umbral y sensibilidad. Si la clasificación actual ya es Zona II,
        // el mensaje describe proximidad al borde de salida; si es otra zona
        // (p. ej. IV), describe cercanía al límite de entrada a Zona II.
        const esZonaII = (zonaShilstone.zona === 'II');
        if (esZonaII) {
          return `Clasificación actual: ${zonaActual}. La mezcla se ubica cerca del límite ${borde} de la zona ` +
            `(FdT ${fdt.toFixed(1)}% vs umbral ${limiteVal}%, diferencia ${minDist.toFixed(1)} pp). ` +
            `Sensibilidad alta: pequeños cambios granulométricos podrían reclasificarla fuera de Zona II.`;
        }
        return `Clasificación actual: ${zonaActual}. La mezcla se ubica cerca del límite ${borde} de la Zona II ` +
          `(FdT ${fdt.toFixed(1)}% vs umbral ${limiteVal}%, diferencia ${minDist.toFixed(1)} pp). ` +
          `Sensibilidad alta: pequeños ajustes granulométricos podrían reclasificarla hacia Zona II.`;
      }
      return null;
    })(),
    granMap,
  };
}

module.exports = {
  evaluarTrabajabilidad,
  calcularFactorGrosor,
  calcularFactorTrabajabilidad,
  determinarZonaShilstone,
  calcularSuperficieEspecifica,
  calcularFactorAptitud,
  interpretarFdA,
  verificarCoherenciaAsentamiento,
  obtenerOffsetTMN,
  obtenerRangosFdA,
  FACTORES_SE,
  RANGOS_FDA,
  RANGOS_FDA_BASE,
  OFFSETS_TMN,
};
