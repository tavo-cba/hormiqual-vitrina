// Precisión canónica por parámetro de agregado (SSoT, CLAUDE.md). El
// formatNumber local de este módulo usa minimumFractionDigits:0 → una
// absorción entera (1,0) salía "1". formatParamValue fuerza 1 decimal.
import { formatParamValue } from "../../../lib/format/agregado";

export const FORMA_LABELS = {
  TRITURADO: "Triturado",
  CANTO_RODADO: "Canto rodado",
  MIXTO: "Mixto",
  NO_DEFINIDO: "No definido",
};

export const METODO_LABELS = {
  HORMIQUAL: "Motor HormiQual v2.0",
  ACI_211: "Motor HormiQual v2.0",
  ICPA: "Motor HormiQual v2.0",
};

/**
 * Genera la descripción real del método según lo que realmente usa el motor.
 * Si usa curva específica o factor de ajuste ICPA, lo indica.
 */
export function buildMetodoDescripcion(snapshot) {
  const traz = snapshot?.trazabilidad || {};
  // RDC/HRDC est\u00e1 FUERA de CIRSOC: modelo de ingenier\u00eda no normativo
  // (Segerer 2017 / AAHE N\u00b016). No debe figurar "verificaciones CIRSOC".
  const esHRDC = traz?.metodoCalculo === 'HRDC'
    || String(traz?.motorVersion || '').toUpperCase().startsWith('HRDC')
    || String(snapshot?.tipologiaCodigo || '').toLowerCase() === 'hrdc';
  if (esHRDC) {
    return "Motor HormiQual \u2014 HRDC (Hormig\u00f3n de Resistencia y Densidad Controlada): modelo no normativo, fuera de CIRSOC";
  }
  const parts = ["Motor HormiQual v2.0"];
  if (traz?.curvaCementoUsada) parts.push("curva espec\u00edfica de cemento");
  // Siempre incluir CIRSOC — el motor aplica verificaciones de aptitud, pulverulento, etc.
  parts.push("verificaciones CIRSOC 200:2024");
  if (traz?.durabilidad?.codigo) parts.push(`durabilidad clase ${traz.durabilidad.codigo}`);
  if (traz?.pliego?.acMaxPliego != null || traz?.pliego?.cementoMinPliego != null) parts.push("restricciones de pliego");
  return parts.join(" + ");
}

/**
 * Etiqueta CORTA del método para el ENCABEZADO del informe. El motor de
 * cálculo es siempre HormiQual; la base metodológica (Segerer 2017 / AAHE
 * N°16) y el disclaimer "no normativo / fuera de CIRSOC" del RDC/HRDC NO van
 * en el encabezado, sino en la sección de metodología del cuerpo (ver
 * `buildMetodoDescripcion` + bloque disclaimer HRDC). Mover una atribución al
 * cuerpo no es problema de copyright; lo que sí importa legalmente es que el
 * disclaimer de "fuera de CIRSOC" siga visible en el cuerpo (no acá).
 */
export function buildMetodoHeaderLabel(snapshot) {
  // Identidad unificada: el encabezado muestra SOLO el motor (marca + versión),
  // nunca el modelo (eso va en la fila "Modelo de cálculo" del cuerpo) ni la
  // base metodológica/disclaimer. Antes devolvía "Motor HormiQual — HRDC", que
  // volvía a pegar el modelo al nombre del motor (lo que acordamos NO hacer) y
  // omitía la versión. Forward-only: si el snapshot trae una motorVersion
  // vieja (ej. "HRDC-1.0") se respeta tal cual (trazabilidad de auditoría).
  const traz = snapshot?.trazabilidad || {};
  const mv = traz?.motorVersion || snapshot?.resultado?.motorVersion;
  return mv ? `Motor ${mv}` : "Motor HormiQual v2.0";
}

// CIRSOC 200:2024 Tablas 2.1/2.2 \u2014 códigos normativos de clase de exposición.
export const EXPOSICION_LABELS = {
  A1:  "A1 \u2014 Ambiente seco o permanentemente sumergido (carbonatación \u2014 CIRSOC 200:2024 Tablas 2.1/2.2)",
  A2:  "A2 \u2014 Ambientes húmedos excepcionalmente secos (carbonatación \u2014 CIRSOC 200:2024 Tablas 2.1/2.2)",
  A3:  "A3 \u2014 Ambientes expuestos a ciclos de mojado y secado (carbonatación \u2014 CIRSOC 200:2024 Tablas 2.1/2.2)",
  CL1: "CL1 \u2014 Húmedo o sumergido, cloruros no marinos (CIRSOC 200:2024 Tablas 2.1/2.2)",
  CL2: "CL2 \u2014 Expuesto a emanaciones de gas Cl\u2082 (CIRSOC 200:2024 Tablas 2.1/2.2)",
  M1:  "M1 \u2014 Al aire, a más de 1 km de la línea de marea alta (CIRSOC 200:2024 Tablas 2.1/2.2)",
  M2:  "M2 \u2014 Al aire, a menos de 1 km de la línea de marea alta (CIRSOC 200:2024 Tablas 2.1/2.2)",
  M3:  "M3 \u2014 Zona de mareas / salpicaduras / marino severo (CIRSOC 200:2024 Tablas 2.1/2.2)",
  C1:  "C1 \u2014 Congelación y deshielo sin sales descongelantes (CIRSOC 200:2024 Tablas 2.1/2.2)",
  C2:  "C2 \u2014 Congelación y deshielo con sales descongelantes (CIRSOC 200:2024 Tablas 2.1/2.2)",
  Q1:  "Q1 \u2014 Ataque químico moderado (CIRSOC 200:2024 Tablas 2.1/2.2)",
  Q2:  "Q2 \u2014 Ataque químico fuerte (CIRSOC 200:2024 Tablas 2.1/2.2)",
  Q3:  "Q3 \u2014 Ataque químico muy fuerte (CIRSOC 200:2024 Tablas 2.1/2.2)",
  Q4:  "Q4 \u2014 Ataque químico muy fuerte, líquidos cloacales (CIRSOC 200:2024 Tablas 2.1/2.2)",
};

/** Versión corta para tablas compactas */
export const EXPOSICION_LABELS_SHORT = {
  A1: "A1 \u2014 Seco/sumergido", A2: "A2 \u2014 Húmedo exc. seco", A3: "A3 \u2014 Ciclos mojado/secado",
  CL1: "CL1 \u2014 Cloruros no marinos", CL2: "CL2 \u2014 Gas Cl\u2082",
  M1: "M1 \u2014 Marino >1 km", M2: "M2 \u2014 Marino <1 km", M3: "M3 \u2014 Marino severo",
  C1: "C1 \u2014 Congelación s/sales", C2: "C2 \u2014 Congelación c/sales",
  Q1: "Q1 \u2014 Quím. moderado", Q2: "Q2 \u2014 Quím. fuerte", Q3: "Q3 \u2014 Quím. muy fuerte", Q4: "Q4 \u2014 Cloacales",
};

/** Versión media para cuerpo de informe (CIRSOC, sin tabla/año) */
export const EXPOSICION_LABELS_MED = {
  A1: "A1 \u2014 Ambiente seco o permanentemente sumergido (carbonatación)",
  A2: "A2 \u2014 Ambientes húmedos excepcionalmente secos (carbonatación)",
  A3: "A3 \u2014 Ciclos de mojado y secado (carbonatación)",
  CL1: "CL1 \u2014 Húmedo o sumergido, cloruros no marinos",
  CL2: "CL2 \u2014 Expuesto a emanaciones de gas Cl\u2082",
  M1: "M1 \u2014 Marino a más de 1 km de la costa",
  M2: "M2 \u2014 Marino a menos de 1 km de la costa",
  M3: "M3 \u2014 Zona de mareas / salpicaduras / marino severo",
  C1: "C1 \u2014 Congelación y deshielo sin sales descongelantes",
  C2: "C2 \u2014 Congelación y deshielo con sales descongelantes",
  Q1: "Q1 \u2014 Ataque químico moderado",
  Q2: "Q2 \u2014 Ataque químico fuerte",
  Q3: "Q3 \u2014 Ataque químico muy fuerte",
  Q4: "Q4 \u2014 Ataque químico muy fuerte, líquidos cloacales",
};

export const MODO_EFECTO_LABELS = {
  AHORRO_AGUA: "Ahorro de agua",
  AUMENTO_ASENTAMIENTO: "Aumento de asentamiento",
  RETARDANTE: "Retardante de fraguado",
  ACELERANTE_FRAGUE: "Acelerante de fraguado",
  ACELERANTE_ENDURECIMIENTO: "Acelerante de endurecimiento",
  INCORPORADOR_AIRE: "Incorporador de aire",
  ESPUMIGENO: "Espumígeno",
  ANTICONGELANTE: "Anticongelante",
  REDUCTOR_RETRACCION: "Reductor de retracción",
  EXPANSIVO: "Expansivo / Compensador de retracción",
  INHIBIDOR_CORROSION: "Inhibidor de corrosión",
  VISCOSANTE: "Modificador de viscosidad (VMA)",
  IMPERMEABILIZANTE: "Impermeabilizante / Reductor de permeabilidad",
  FIBRAS: "Refuerzo con fibras",
  OTRO: "Otro (ver observaciones)",
};

/** Efectos que integran cálculo de agua/asentamiento */
export const EFECTOS_CON_CALCULO = new Set(["AHORRO_AGUA", "AUMENTO_ASENTAMIENTO"]);

/** Descripciones técnicas para informe PDF */
export const MODO_EFECTO_DESCRIPCION = {
  AHORRO_AGUA: "Reduce el agua de amasado según el porcentaje de reducción del aditivo.",
  AUMENTO_ASENTAMIENTO: "Mejora la trabajabilidad sin modificar el agua de amasado.",
  RETARDANTE: "Prolonga el tiempo de inicio de fraguado del hormigón sin afectar significativamente la resistencia a largo plazo.",
  ACELERANTE_FRAGUE: "Reduce el tiempo de inicio de fraguado del hormigón.",
  ACELERANTE_ENDURECIMIENTO: "Aumenta la velocidad de desarrollo de resistencia a edades tempranas.",
  INCORPORADOR_AIRE: "Incorpora microburbujas de aire distribuidas uniformemente para mejorar la durabilidad frente a ciclos de hielo-deshielo.",
  ESPUMIGENO: "Genera grandes volúmenes de aire celular (típicamente 15–35%) para producir hormigones livianos de resistencia y densidad controlada (HRDC).",
  ANTICONGELANTE: "Permite el fraguado y endurecimiento del hormigón a temperaturas bajo cero, reduciendo el punto de congelación del agua de mezcla.",
  REDUCTOR_RETRACCION: "Reduce la retracción por secado del hormigón endurecido, minimizando la fisuración.",
  EXPANSIVO: "Produce una expansión controlada durante el fraguado para compensar la retracción posterior.",
  INHIBIDOR_CORROSION: "Protege la armadura de acero contra la corrosión inducida por cloruros u otros agentes agresivos.",
  VISCOSANTE: "Aumenta la cohesión y estabilidad de la mezcla fresca, reduciendo la segregación y exudación. Usado en hormigón autocompactante.",
  IMPERMEABILIZANTE: "Reduce la permeabilidad del hormigón endurecido al agua y otros fluidos.",
  FIBRAS: "Fibras (sintéticas, metálicas, vidrio, etc.) que mejoran la resistencia a la fisuración, tenacidad y/o resistencia residual post-fisuración.",
  OTRO: null,
};

/** Referencias normativas por tipo de efecto */
export const MODO_EFECTO_REF_NORMATIVA = {
  AHORRO_AGUA: "IRAM 1663-1 Tipo P / EN 934-2 T.3.1 / ASTM C494 Tipo A/F",
  AUMENTO_ASENTAMIENTO: "IRAM 1663-1 Tipo P / EN 934-2 T.3.1 / ASTM C494 Tipo A/F",
  RETARDANTE: "IRAM 1663-1 Tipo R / EN 934-2 T.8 / ASTM C494 Tipo B",
  ACELERANTE_FRAGUE: "IRAM 1663-1 Tipo Ac-f / EN 934-2 T.6 / ASTM C494 Tipo C",
  ACELERANTE_ENDURECIMIENTO: "IRAM 1663-1 Tipo Ac-e / EN 934-2 T.7 / ASTM C494 Tipo E",
  INCORPORADOR_AIRE: "IRAM 1663-1 Tipo IA / EN 934-2 T.5 / ASTM C260",
  VISCOSANTE: "EN 934-2 T.11.2",
};

export const UNIDAD_DOSIS_LABELS = {
  PORC_SOBRE_CEMENTO: "% sobre cemento",
  ML_POR_100KG_CEMENTO: "mL/100 kg cemento",
  KG_M3: "kg/m³",
};

export const TIPO_AIRE_LABELS = {
  NATURAL: "Naturalmente atrapado",
  INTENCIONAL: "Intencionalmente incorporado",
};

export const FAMILIA_CURVE_LABELS = {
  FULLER: "Fuller-Thompson",
  TALBOT: "Talbot",
  MAA: "Modificación de Andreasen (MAA)",
  ANDREASEN: "Andreasen",
  ROSIN_RAMMLER: "Rosin-Rammler",
};

const GLOSARIO = [
  "TMN: tamaño máximo nominal del agregado grueso.",
  "MF: módulo de finura de la mezcla total de agregados.",
  "a/c: relación agua/cemento adoptada para el diseño.",
  "f'ce: resistencia especificada del hormigón.",
  "f'cm: resistencia media requerida para diseño estadístico.",
  "FdG: Factor de Grosor (Shilstone) — porcentaje retenido acumulado entre tamiz 9,5 mm y 2,36 mm, relativo al retenido en 2,36 mm.",
  "FdT: Factor de Trabajabilidad (Shilstone) — porcentaje pasante tamiz 2,36 mm, corregido por cementante (Cc = cemento/42,6).",
  "FdA: Factor de Aptitud (Ken Day, 2006) — indicador compuesto de trabajabilidad. Fórmula: FdA = SE + Cc − 7,5 + 0,25 × (Aire − 1), donde Cc = cementante (kg/m³) / 42,6. El divisor 42,6 corresponde a bolsas de 94 lb del modelo original Day.",
  "SE: Superficie Específica de la mezcla de agregados (cm²/g), calculada como suma ponderada de factores por tamiz.",
  "PUV teórico: peso unitario volumétrico calculado (suma de pesos SSS).",
  "Volumen de pasta: suma de agua, aire y material cementante en 1 m³ de hormigón.",
  "Factor de ajuste de curva (familia de cemento): corrector aplicado al f'cm al consultar la curva genérica de referencia. Cuando existe, el motor DIVIDE el f'cm por este factor para obtener el valor de entrada a la curva (f'cm corregido = f'cm / factor). Calibra la curva genérica al cemento real del fabricante.",
];

// M6 \u2014 formatter local con convenci\u00f3n espec\u00edfica (comma decimal sin
// separador de miles) para evitar la ambig\u00fcedad "1.208" vs "1,208" en
// trazabilidad de c\u00e1lculos. La SSoT del proyecto (`src/lib/format/index.js`)
// usa formato es-AR con thousands separator por default; ese estilo no
// aplica ac\u00e1. Mantener este wrapper local hasta que `formatNumber` de la
// SSoT exponga `useGrouping: false` como opci\u00f3n standard.
function formatNumber(value, digits = 2) {
  if (value == null || value === "") return "\u2014";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  // B3/M1: force comma decimal, no thousands separator (avoid "1.208" vs "1,208" ambiguity)
  const s = num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  return s.replace(".", ",");
}

function textOrDash(value) {
  return value == null || value === "" ? "\u2014" : String(value);
}

function compactList(items) {
  return (items || []).filter(Boolean);
}

export const ORIGEN_TIPO_LABELS = {
  INPUT_USUARIO:    'Usuario',
  MEZCLA:          'Mezcla',
  MATERIAL_CEMENTO:'Cemento',
  MATERIAL_ADITIVO:'Aditivo',
  CURVA:           'Curva',
  CURVA_CEMENTO:   'Curva cemento',
  TABLA:           'Tabla',
  REGLA:           'Regla',
  DURABILIDAD:     'Durabilidad',
  PLIEGO:          'Pliego',
  DEFAULT:         'Default',
  CALCULADO:       'Calculado',
  TABLA_REFERENCIA: 'Tabla de referencia',
  TABLA_NORMATIVA:  'Tabla normativa',
  PARAMETRO_MODELO: 'Parámetro del modelo',
};

// \u2500\u2500\u2500 AC governing source label \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// M7 — `AC_GOBERNANTE_LABELS` se importa desde la SSoT compartida
// `dosificacionLabels.js` (antes estaba duplicado con leve drift respecto
// al PDF principal).
const { AC_GOBERNANTE_LABELS } = require('./dosificacionLabels');

const CEMENTO_GOBERNANTE_LABELS = {
  CALCULO:    'Cálculo (agua ÷ a/c)',
  PLIEGO:     'Mínimo de pliego',
  AMC_PLIEGO: 'Mínimo por a/mc de pliego',
};

/** Translation map for internal regla codes -> human-readable labels */
const REGLA_LABELS = {
  PORC_SOBRE_CEMENTO:           '% sobre peso de cemento',
  AHORRO_AGUA:                  'Reducción porcentual de agua',
  AUMENTO_ASENTAMIENTO:         'Efecto reológico (asentamiento)',
  ICPA_BASE_DIRECTO:            'Lectura directa Ábaco 1',
  ICPA_BASE_INTERPOLACION_MF:   'Interpolación Ábaco 1 por MF',
  ICPA_BASE_INTERPOLACION_ASENTAMIENTO: 'Interpolación Ábaco 1 por asentamiento',
  ICPA_BASE_INTERPOLACION_BILINEAL: 'Interpolación bilineal Ábaco 1',
  TABLA_INTERPOLACION:          'Interpolación de tabla',
  TABLA_DIRECTA:                'Lectura directa de tabla',
  CURVA_CEMENTO:                'Curva específica del cemento',
  TABLA_ACI:                    'Tabla de agua por TMN (ref. ACI Committee 211)',
  DURABILIDAD_CIRSOC:           'CIRSOC 200:2024',
  ML_POR_100KG_CEMENTO:         'mL por cada 100 kg de cemento',
  KG_M3:                        'kg/m³',
  MIN_GOBERNANTE:               'Mínimo gobernante',
  FIJO:                         'Valor fijo',
  LIMITE_MAXIMO:                'Límite máximo',
};

function translateRegla(regla) {
  if (!regla) return '\u2014';
  if (REGLA_LABELS[regla]) return REGLA_LABELS[regla];
  // If it looks like an ENUM_CODE (all-caps with underscores), humanize it
  if (/^[A-Z0-9_]+$/.test(regla)) return regla.replace(/_/g, ' ').toLowerCase();
  // Otherwise it's already a human-readable string — pass through as-is
  return regla;
}

/**
 * Post-processing for fuentesCalculo text fields.
 * Applies abbreviation casing, unit fixes, decimal formatting (locale AR),
 * and sentence capitalization.
 */
export function polishTraceText(text) {
  if (!text || typeof text !== "string") return text;
  let s = text;

  // Fix abbreviations/acronyms to proper casing (word-boundary aware).
  // "icpa" se mapea a "referencia general" para no exponer la marca en trazabilidad.
  s = s.replace(/\bicpa\b/gi, "referencia general");
  s = s.replace(/\bcirsoc\b/gi, "CIRSOC");
  s = s.replace(/\btmn\b/gi, "TMN");
  s = s.replace(/\bmpa\b/gi, "MPa");
  s = s.replace(/\baci\b/gi, "ACI");
  s = s.replace(/\bmf\b/gi, "MF");

  // Fix "armado" in normative context (after class codes like A3, CL1, etc.)
  s = s.replace(/(\b[A-Z]+\d?\s*[-\u2014]\s*)armado\b/g, "$1ARMADO");

  // Fix unit patterns
  s = s.replace(/\bkgm3\b/gi, "kg/m³");
  s = s.replace(/\bkg\/m3\b/g, "kg/m³");
  s = s.replace(/\bL\/m3\b/g, "L/m³");
  s = s.replace(/\bporc sobre cemento\b/gi, "% sobre cemento");

  // Fix "x" used as multiplication sign between numbers
  s = s.replace(/(\d)\s*x\s*(\d)/g, "$1 × $2");

  // Decimal point -> comma for numbers (locale AR)
  s = s.replace(/(\d)\.(\d)/g, "$1,$2");

  // Sentence capitalization: uppercase first letter after start of string or after ". " or "; "
  s = s.replace(/(^|[.;]\s+)([a-záéíóúñ])/g, (_, prefix, letter) => prefix + letter.toUpperCase());

  return s;
}

// \u2500\u2500\u2500 Stage-based sections builder \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
export function buildDosificacionTraceSections(snapshot, { includeGlossary = true } = {}) {
  const resultado = snapshot?.resultado || {};
  const trazabilidad = snapshot?.trazabilidad || {};
  // RDC/HRDC: el aire es celular (espumígeno) → intencionalmente incorporado,
  // nunca "naturalmente atrapado". Misma detección que buildMetodoDescripcion.
  const esHRDC = trazabilidad?.metodoCalculo === 'HRDC'
    || String(trazabilidad?.motorVersion || '').toUpperCase().startsWith('HRDC')
    || String(snapshot?.tipologiaCodigo || '').toLowerCase() === 'hrdc';
  const _aireHRDCtxt = () => {
    const a = resultado?.airePct ?? resultado?.aireIncorporadoPct
      ?? trazabilidad?.airePct ?? trazabilidad?.aireIncorporadoPct ?? null;
    return a != null
      ? `${formatNumber(a, 2)} % — intencionalmente incorporado (espumígeno)`
      : "intencionalmente incorporado (espumígeno)";
  };
  const inputs = trazabilidad?.inputs || {};
  const aguaBase = trazabilidad?.aguaBase || {};
  const relacionAC = trazabilidad?.relacionAC || {};
  const curvaCementoUsada = trazabilidad?.curvaCementoUsada || null;
  const durabilidad = trazabilidad?.durabilidad || null;
  const pliego = trazabilidad?.pliego || null;
  const cementoCalculado = trazabilidad?.cementoCalculado || {};
  const resumenDecisiones = trazabilidad?.resumenDecisiones || null;
  const agregadosDistribucion = trazabilidad?.agregadosDistribucion || {};
  const absorcionMezcla = trazabilidad?.absorcionMezcla || null;
  const balanceVol = trazabilidad?.balanceVolumenes || resultado?.balanceVolumenes || null;
  const puvTeorico = trazabilidad?.puvTeorico || resultado?.puvTeorico || null;
  const tipoAire = trazabilidad?.tipoAire || resultado?.tipoAire || null;
  const aireColateral = trazabilidad?.aireColateral || 0;
  const validacionCruzada = trazabilidad?.validacionCruzada || [];

  const warnings = compactList(snapshot?.warnings).map((warning) => {
    if (typeof warning === "string") return warning;
    return `${warning.campo ? `[${warning.campo}] ` : ""}${warning.msg || warning.message || "Advertencia técnica"}`;
  });

  // Honest method description
  const metodoDesc = buildMetodoDescripcion(snapshot);

  // \u2500\u2500 Stage A: Resumen ejecutivo \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const stageResumen = {
    key: "resumen",
    stageType: "resumen",
    title: "Resumen del cálculo",
    rows: [
      ["Método real utilizado", metodoDesc],
      ["Agua final", resultado?.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : "\u2014"],
      ["a/c final adoptada", resultado?.ac != null ? formatNumber(resultado.ac, 2) : "\u2014"],
      ["Cemento total", resultado?.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "\u2014"],
      ["Aire", esHRDC ? _aireHRDCtxt() : resultado?.airePct != null
        ? (tipoAire === 'INTENCIONAL' && resultado.aireAtrapado != null
          ? `${formatNumber(resultado.airePct, 1, true)} % (${formatNumber(resultado.aireAtrapado, 1, true)}% atrap. + ${formatNumber(resultado.aireIncorporado, 1, true)}% incorp.${aireColateral > 0 ? ` + ${formatNumber(aireColateral, 2)}% colat.` : ""})`
          : `${formatNumber(resultado.airePct, 1, true)} % (${aireColateral > 0 ? `${formatNumber(trazabilidad?.aireAtrapado ?? resultado.airePct - aireColateral, 1, true)}% atrap. + ${formatNumber(aireColateral, 2)}% colat.` : "naturalmente atrapado"})`)
        : "\u2014"],
      ["Restricción gobernante a/c", resumenDecisiones?.acGobernante ? (AC_GOBERNANTE_LABELS[resumenDecisiones.acGobernante] || resumenDecisiones.acGobernante) : "\u2014"],
    ],
    acGobernante: resumenDecisiones?.acGobernante || null,
    acGobernanteLabel: resumenDecisiones?.acGobernante ? (AC_GOBERNANTE_LABELS[resumenDecisiones.acGobernante] || resumenDecisiones.acGobernante) : null,
    acGobernanteTexto: resumenDecisiones?.acGobernanteTexto || null,
    cementoGobernante: resumenDecisiones?.cementoGobernante || null,
    cementoGobernanteLabel: resumenDecisiones?.cementoGobernante ? (CEMENTO_GOBERNANTE_LABELS[resumenDecisiones.cementoGobernante] || resumenDecisiones.cementoGobernante) : null,
    cementoGobernanteTexto: resumenDecisiones?.cementoGobernanteTexto || null,
  };

  // \u2500\u2500 Stage B: Datos base del diseño \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const aguaBaseLabel = 'Agua base (tabla HormiQual)';

  const stageEntradas = {
    key: "entradas",
    stageType: "entradas",
    title: "Parámetros de entrada",
    rows: [
      ["Método", metodoDesc],
      ["Planta", textOrDash(snapshot?.plantaLabel)],
      ["Mezcla granular", textOrDash(snapshot?.mezclaLabel)],
      ["TMN (de mezcla total)", snapshot?.tmnMm != null ? `${formatNumber(snapshot.tmnMm, 1)} mm` : "\u2014"],
      ["Forma del agregado", FORMA_LABELS[snapshot?.formaAgregado] || textOrDash(snapshot?.formaAgregado)],
      ["f'ce", snapshot?.fce != null ? `${formatNumber(snapshot.fce, 1)} MPa` : "\u2014"],
      ["S (desvío)", snapshot?.desvioS != null ? `${formatNumber(snapshot.desvioS, 1)} MPa` : "\u2014"],
      ["f'cm calculado", snapshot?.fcm != null ? `${formatNumber(snapshot.fcm, 1)} MPa` : "\u2014"],
      ...(snapshot?.consistenciaClase
        ? [
            ["Consistencia", `${snapshot.consistenciaClaseNombre || snapshot.consistenciaClase} — ${snapshot.consistenciaMetodo || ""}`],
            ["Valor nominal", snapshot.consistenciaValor != null ? `${formatNumber(snapshot.consistenciaValor, 1)} ${snapshot.consistenciaRange?.unit || ""}` : "\u2014"],
          ]
        : [["Asentamiento objetivo", snapshot?.asentamientoMm != null ? `${formatNumber(snapshot.asentamientoMm, 0)} mm` : "\u2014"]]),
      ["Edad de diseño", `${inputs?.edadDias || snapshot?.edadDias || 28} días`],
      ["Aire", esHRDC ? _aireHRDCtxt() : resultado?.airePct != null
        ? (tipoAire === 'INTENCIONAL' && resultado.aireAtrapado != null
          ? `${formatNumber(resultado.airePct, 2)} % \u2014 ${formatNumber(resultado.aireAtrapado, 1)}% atrap. + ${formatNumber(resultado.aireIncorporado, 1)}% incorp.${aireColateral > 0 ? ` + ${formatNumber(aireColateral, 2)}% colat.` : ""}`
          : `${formatNumber(resultado.airePct, 2)} % \u2014 ${aireColateral > 0 ? `${formatNumber(trazabilidad?.aireAtrapado ?? resultado.airePct - aireColateral, 1)}% atrap. + ${formatNumber(aireColateral, 2)}% colat.` : "naturalmente atrapado"}`)
        : "Auto (tabla)"],
      ["Clase de exposición", EXPOSICION_LABELS[snapshot?.exposicion] || textOrDash(snapshot?.exposicion)],
      ["MF mezcla total", inputs?.moduloFinura != null ? formatNumber(inputs.moduloFinura, 2) : "\u2014"],
    ],
  };

  // \u2500\u2500 Stage C: Agua \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  // Build readable agua method label
  const aguaMetodoReadable = (() => {
    const m = aguaBase?.metodo;
    if (!m) return "\u2014";
    const MAP = {
      ICPA_BASE_DIRECTO: "Lectura directa del Ábaco 1",
      ICPA_BASE_INTERPOLACION_MF: "Interpolación del Ábaco 1 por módulo de finura",
      ICPA_BASE_INTERPOLACION_ASENTAMIENTO: "Interpolación del Ábaco 1 por asentamiento",
      ICPA_BASE_INTERPOLACION_BILINEAL: "Interpolación bilineal del Ábaco 1 (MF + asentamiento)",
      DIRECTO: "Lectura directa de tabla",
      INTERPOLACION_TMN: "Interpolación por TMN",
      INTERPOLACION_ASENTAMIENTO: "Interpolación por asentamiento",
      TMN_CERCANO: "TMN más cercano",
    };
    if (MAP[m]) return MAP[m];
    // RDC Fase 3: metodoAgua = `CONSISTENCIA:ASENTAMIENTO|EXTENDIDO_CONO`.
    // No filtrar la constante interna al cliente en el Anexo Técnico.
    if (String(m).startsWith("CONSISTENCIA:")) {
      const c = String(m).split(":")[1];
      if (c === "ASENTAMIENTO") return "Por consistencia (asentamiento objetivo)";
      if (c === "EXTENDIDO_CONO") return "Por consistencia (extendido de cono objetivo)";
      return "Por consistencia objetivo";
    }
    return String(m).replace(/[_:]/g, " ").toLowerCase();
  })();

  const correccionesAguaLines = compactList((trazabilidad?.correccionAditivo || []).map((item) => {
    if (item.modo === 'AUMENTO_ASENTAMIENTO') {
      const inc = item.incrementoAsentamientoMm != null ? ` +${item.incrementoAsentamientoMm} mm` : '';
      return `${item.aditivo} [Aumento de asentamiento${inc}]: ${item.nota || 'Efecto reológico \u2014 agua sin cambio'}`;
    }
    if (item.nota) return `${item.aditivo}: ${item.nota}`;
    return `${item.aditivo} [Ahorro de agua]: ${formatNumber(item.aguaAntes, 1)} -> ${formatNumber(item.aguaDespues, 1)} L/m³ (\u2212${formatNumber(item.reduccionPct, 1)}%)`;
  }));

  // Datos estructurados para renderizar como tabla en el PDF
  const correccionesAguaRows = (trazabilidad?.correccionAditivo || []).map((item) => {
    if (item.modo === 'AUMENTO_ASENTAMIENTO') {
      const inc = item.incrementoAsentamientoMm != null ? `+${item.incrementoAsentamientoMm} mm` : '';
      return {
        aditivo: item.aditivo,
        efecto: `Aumento de asentamiento${inc ? ` (${inc})` : ''}`,
        aguaAntes: '\u2014',
        aguaDespues: '\u2014',
        reduccion: '\u2014',
        nota: item.nota || 'Efecto reológico, agua sin cambio',
      };
    }
    if (item.nota) {
      return {
        aditivo: item.aditivo,
        efecto: '\u2014',
        aguaAntes: '\u2014',
        aguaDespues: '\u2014',
        reduccion: '\u2014',
        nota: item.nota,
      };
    }
    return {
      aditivo: item.aditivo,
      efecto: 'Ahorro de agua',
      aguaAntes: `${formatNumber(item.aguaAntes, 1)} L/m³`,
      aguaDespues: `${formatNumber(item.aguaDespues, 1)} L/m³`,
      reduccion: `-${formatNumber(item.reduccionPct, 1)}%`,
      nota: '',
    };
  });

  const stageAgua = {
    key: "agua",
    stageType: "agua",
    title: "Agua de amasado",
    rows: [
      [aguaBaseLabel, aguaBase?.aguaLtsM3 != null ? `${formatNumber(aguaBase.aguaLtsM3, 1)} L/m³` : "\u2014"],
      ["Método de estimación", aguaMetodoReadable],
      ["MF utilizado (mezcla total)", inputs?.moduloFinura != null ? formatNumber(inputs.moduloFinura, 2) : "\u2014"],
      ...(snapshot?.consistenciaClase
        ? [["Consistencia", `${snapshot.consistenciaClaseNombre || snapshot.consistenciaClase} (${snapshot.consistenciaValor ?? "?"} ${snapshot.consistenciaRange?.unit || ""})`]]
        : [["Asentamiento", snapshot?.asentamientoMm != null ? `${formatNumber(snapshot.asentamientoMm, 0)} mm` : "\u2014"]]),
      ["Forma del agregado", FORMA_LABELS[snapshot?.formaAgregado] || textOrDash(snapshot?.formaAgregado)],
      ["Agua final adoptada", resultado?.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : textOrDash(trazabilidad?.aguaFinal)],
    ],
    lines: [],
    correccionesData: correccionesAguaRows,
  };

  // \u2500\u2500 Stage D: Relación a/c (con etapas claras) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const acRows = [];

  // ROUND-X Priority 3: Factor de ajuste ICPA (familia cemento).
  // The engine DIVIDES f'cm by this factor when consulting the generic ICPA curve
  // (fcmCurva = fcm / factor). Show the chain clearly so glossary, formula and
  // traceability agree. The old "factor prudencial" was removed from the engine —
  // S (standard deviation) already covers the statistical margin.
  if (relacionAC?.factorAjusteAplicado != null && Math.abs(relacionAC.factorAjusteAplicado - 1.0) > 0.005) {
    acRows.push(["f'cm requerido (= f'ce + k*S)", relacionAC.fcmObjetivo != null ? `${formatNumber(relacionAC.fcmObjetivo, 1)} MPa` : "\u2014"]);
    acRows.push([
      "Factor de ajuste de curva (familia de cemento)",
      `\u00f7 ${formatNumber(relacionAC.factorAjusteAplicado, 2)} (calibra la curva generica al cemento real; f'cm curva = f'cm / factor)`,
    ]);
    const fcmEntrada = relacionAC.fcmConFactorAjuste ?? relacionAC.fcmParaCurvaCorregido ?? relacionAC.fcmParaCurva;
    acRows.push(["f'cm de entrada a la curva de referencia", fcmEntrada != null ? `${formatNumber(fcmEntrada, 1)} MPa` : "\u2014"]);
  }

  // a/c por resistencia
  acRows.push(["a/c por resistencia (curva)", relacionAC?.acEstimado != null ? formatNumber(relacionAC.acEstimado, 2) : "\u2014"]);
  acRows.push(["Curva de cemento utilizada", curvaCementoUsada ? textOrDash(curvaCementoUsada.nombre) : "Tabla genérica a/c-resistencia"]);
  if (curvaCementoUsada) acRows.push(["Origen de curva", textOrDash(curvaCementoUsada.origenLabel)]);

  // a/c por durabilidad
  acRows.push(["a/c máx. por exposición", durabilidad?.acMax != null ? formatNumber(durabilidad.acMax, 2) : "Sin restricción"]);
  if (durabilidad?.codigo) {
    acRows.push(["Clase de exposición", `${durabilidad.codigo} \u2014 ${durabilidad.grupo || ""} (CIRSOC 200:2024 Tabla 2.5)`]);
  }

  // a/c por pliego
  if (pliego?.acMaxPliego != null) {
    acRows.push(["a/c máx. por pliego", formatNumber(pliego.acMaxPliego, 2)]);
    acRows.push(["Modo pliego", pliego.acModo === "FIJO" ? "Valor fijo (forzado)" : "Límite máximo"]);
  }

  // a/c FINAL
  acRows.push(["a/c FINAL ADOPTADA", resultado?.ac != null ? formatNumber(resultado.ac, 2) : textOrDash(durabilidad?.acFinal)]);
  if (resumenDecisiones?.acGobernante) {
    acRows.push(["Restricción gobernante", AC_GOBERNANTE_LABELS[resumenDecisiones.acGobernante] || resumenDecisiones.acGobernante]);
  }

  // Sesión 2026-05-27: exponer los puntos de la curva consumidos para que
  // el operador pueda inspeccionar si el a/c devuelto se condice con la
  // curva del fabricante (caso reportado: f'cm 39,5 MPa daba a/c 0,50 en
  // una curva del fabricante vs ~0,42 en la curva ICPA genérica).
  // `puntosCurvaEdad`: dataset completo para la edad usada.
  // `puntosUsados`: subconjunto efectivamente consumido (1 si TABLA_DIRECTO/
  //   TABLA_EXTRAPOLACION, 2 si TABLA_INTERPOLACION).
  // `abramsParams`: cuando el motor cayó al fallback de la ley de Abrams.
  const curvaTraza = {
    puntosCurvaEdad: Array.isArray(relacionAC?.puntosCurvaEdad) ? relacionAC.puntosCurvaEdad : null,
    puntosUsados: Array.isArray(relacionAC?.puntosUsados) ? relacionAC.puntosUsados : null,
    abramsParams: relacionAC?.abramsParams || null,
    metodo: relacionAC?.metodo || null,
    fcmConsulta: relacionAC?.fcmConFactorAjuste ?? relacionAC?.fcmParaCurvaCorregido ?? relacionAC?.fcmParaCurva ?? null,
  };

  const stageAC = {
    key: "ac",
    stageType: "ac",
    title: "Relación agua/cemento (a/c)",
    rows: acRows,
    curvaTraza,
    acGobernante: resumenDecisiones?.acGobernante || null,
    acGobernanteTexto: resumenDecisiones?.acGobernanteTexto || null,
  };

  // \u2500\u2500 Stage E: Material cementante (con restricciones separadas) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const cemRows = [
    ["Cemento seleccionado", snapshot?.cementoLabel || "\u2014"],
  ];
  if (snapshot?.cementoFamilia) cemRows.push(["Familia / composición", snapshot.cementoFamilia]);
  if (snapshot?.adiciones?.length > 0) {
    snapshot.adiciones.forEach((item) => {
      const suffix = item.reemplazoPct != null ? ` (${formatNumber(item.reemplazoPct, 1)}%)` : "";
      cemRows.push(["Adición", `${item.label}${suffix}`]);
    });
  }
  cemRows.push(["Densidad relativa del cemento", resultado?.densidadCementoUsada != null ? formatNumber(resultado.densidadCementoUsada, 2) : "\u2014"]);

  // C.2 Restricciones de contenido de cemento
  cemRows.push(["Cemento por cálculo (agua ÷ a/c)", cementoCalculado?.cementoTotal != null ? `${formatNumber(cementoCalculado.cementoTotal, 0)} kg/m³` : "\u2014"]);
  if (durabilidad?.fcmin != null) {
    cemRows.push(["f'c mín. por exposición (informativo)", `${formatNumber(durabilidad.fcmin, 0)} MPa (CIRSOC 200:2024)`]);
  }
  if (pliego?.cementoMinPliego != null) {
    cemRows.push(["Cemento mínimo por pliego", `${formatNumber(pliego.cementoMinPliego, 0)} kg/m³`]);
  }
  if (pliego?.cementoMinFromAmc != null) {
    cemRows.push(["Cemento mínimo por a/mc pliego", `${formatNumber(pliego.cementoMinFromAmc, 0)} kg/m³`]);
    if (pliego.amcMaxPliego != null) cemRows.push(["a/mc máx. por pliego", formatNumber(pliego.amcMaxPliego, 3)]);
    if (pliego.amcResultante != null) cemRows.push(["a/mc resultante", formatNumber(pliego.amcResultante, 3)]);
  }
  cemRows.push(["CEMENTO TOTAL ADOPTADO", resultado?.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "\u2014"]);
  // Bug DOS-6UCPY6-K72: si hubo ajuste MANUAL de cemento, el descenso
  // calculado->adoptado NO es un redondeo — es decisión del tecnólogo
  // (Sección B). Atribuirlo a "redondeo al kg entero superior" es
  // factualmente falso (315 < 322) y borra la justificación profesional.
  const ajManual = resultado?.ajusteCemento?.aplicado === true ? resultado.ajusteCemento : null;
  if (ajManual) {
    const motivoTxt = ajManual.motivoLabel || ajManual.motivo || 'Ajuste manual del tecnólogo';
    cemRows.push([
      "Ajuste manual de cemento",
      `${formatNumber(ajManual.cementoCalculadoKgM3, 1)} kg/m³ (calculado) -> ${formatNumber(ajManual.cementoAdoptadoKgM3, 0)} kg/m³ (adoptado). Motivo: ${motivoTxt}${ajManual.motivoOtro ? ` — ${ajManual.motivoOtro}` : ''}`,
    ]);
  } else if (cementoCalculado?.cementoTotal != null && resultado?.cementoTotalKgM3 != null
      && Math.abs(cementoCalculado.cementoTotal - resultado.cementoTotalKgM3) > 0.1) {
    cemRows.push(["Regla de redondeo", `Valor exacto ${formatNumber(cementoCalculado.cementoTotal, 1)} kg/m³ -> redondeado al kg entero superior (${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³)`]);
  }
  if (cementoCalculado?.ajusteMinimo != null && cementoCalculado.ajusteMinimo > 0) {
    cemRows.push(["Ajuste por mínimo", `+${formatNumber(cementoCalculado.ajusteMinimo, 0)} kg/m³`]);
  }
  if (resumenDecisiones?.cementoGobernante) {
    cemRows.push(["Restricción gobernante", CEMENTO_GOBERNANTE_LABELS[resumenDecisiones.cementoGobernante] || resumenDecisiones.cementoGobernante]);
  }

  const stageCemento = {
    key: "cemento",
    stageType: "cemento",
    title: "Material cementante",
    rows: cemRows,
    cementoGobernante: resumenDecisiones?.cementoGobernante || null,
    cementoGobernanteTexto: resumenDecisiones?.cementoGobernanteTexto || null,
  };

  // \u2500\u2500 Stage F: Aditivos (con texto legible) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const aditivosDetalle = (snapshot?.aditivos || []).map((item, idx) => {
    const trazItem = (trazabilidad?.aditivos || [])[idx];
    const correccion = (trazabilidad?.correccionAditivo || []).find((c) => c.aditivo === `Aditivo ${idx + 1}` || c.aditivo === item.label);
    return {
      label: item.label,
      modoEfecto: item.modoEfecto,
      modoEfetoLabel: MODO_EFECTO_LABELS[item.modoEfecto] || item.modoEfecto || "\u2014",
      dosis: item.dosis,
      unidadLabel: trazItem?.unidadLabel || UNIDAD_DOSIS_LABELS[trazItem?.unidad] || trazItem?.unidad || "",
      kgM3: trazItem?.kgM3,
      correccion,
    };
  });

  const stageAditivos = {
    key: "aditivos",
    stageType: "aditivos",
    title: "Aditivos",
    aditivosDetalle,
    lines: aditivosDetalle.length === 0 ? ["Sin aditivos en este diseño."] : [],
  };

  // \u2500\u2500 Stage G: Agregados \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const tablaAgregados = compactList((agregadosDistribucion?.items || resultado?.agregados || []).map((item) => {
    const kgM3Str = item.kgM3 != null ? `${formatNumber(item.kgM3, 0)} kg/m³` : "No cuantificado";
    const estado = item.kgM3 != null ? "Calculado" : "Sin densidad";
    const absStr = item.absorcionPct != null ? `${formatParamValue('absorcion', item.absorcionPct)}%` : "\u2014";
    return [
      textOrDash(item.nombre),
      item.porcentaje != null ? `${formatNumber(item.porcentaje, 2)}%` : "\u2014",
      item.proporcionNormalizada != null ? `${formatNumber(item.proporcionNormalizada, 2)}%` : "\u2014",
      kgM3Str,
      absStr,
      estado,
    ];
  }));

  const absorcionRows = [];
  if (absorcionMezcla?.absorcionPonderada != null) {
    absorcionRows.push(["Abs. ponderada (inf.)", `${formatParamValue('absorcion', absorcionMezcla.absorcionPonderada)}%`]);
  }
  if (absorcionMezcla?.aguaAbsorbibleTeoricaLM3 != null) {
    absorcionRows.push(["Cap. absorción (inf.)", `${formatNumber(absorcionMezcla.aguaAbsorbibleTeoricaLM3, 1)} L/m³`]);
  }
  if (absorcionMezcla) {
    absorcionRows.push(["Nota absorción", absorcionMezcla.nota || "Dato informativo \u2014 no modifica el agua de diseño"]);
  }

  const stageAgregados = {
    key: "agregados",
    stageType: "agregados",
    title: "Agregados",
    rows: [
      ["Método de distribución",
        esHRDC
          // HRDC no usa distribución granulométrica clásica: la arena cierra
          // masa y el aire cierra volumen (motor RDC/HRDC, Segerer/AAHE).
          ? "Cierre de masa/volumen (motor RDC/HRDC)"
          : agregadosDistribucion?.metodo === "VOLUMEN_ABSOLUTO" ? "Volúmenes absolutos"
          : agregadosDistribucion?.metodo === "PROPORCIONAL" ? "Proporcional (sin densidades)"
          : textOrDash(agregadosDistribucion?.metodo)],
      ...(agregadosDistribucion?.nota ? [["Nota", agregadosDistribucion.nota]] : []),
      ...absorcionRows,
    ],
    table: tablaAgregados.length > 0 ? {
      headers: ["Agregado", "% mezcla", "% normalizado", "kg/m³", "Absorción", "Estado"],
      rows: tablaAgregados,
    } : null,
  };

  // \u2500\u2500 Stage H: Resultado final + balance de volúmenes + PUV \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const resultRows = [
    ["Agua", resultado?.aguaLtsM3 != null ? `${formatNumber(resultado.aguaLtsM3, 1)} L/m³` : "\u2014"],
    ["a/c", resultado?.ac != null ? formatNumber(resultado.ac, 2) : "\u2014"],
    ["Cemento total", resultado?.cementoTotalKgM3 != null ? `${formatNumber(resultado.cementoTotalKgM3, 0)} kg/m³` : "\u2014"],
    ["Aire", esHRDC ? _aireHRDCtxt() : resultado?.airePct != null
      ? (tipoAire === 'INTENCIONAL' && resultado.aireAtrapado != null
        ? `${formatNumber(resultado.airePct, 1, true)}% (${formatNumber(resultado.aireAtrapado, 1, true)}% atrap. + ${formatNumber(resultado.aireIncorporado, 1, true)}% incorp.${aireColateral > 0 ? ` + ${formatNumber(aireColateral, 2)}% colat.` : ""})`
        : `${formatNumber(resultado.airePct, 1, true)}% (${aireColateral > 0 ? `${formatNumber(trazabilidad?.aireAtrapado ?? resultado.airePct - aireColateral, 1, true)}% atrap. + ${formatNumber(aireColateral, 2)}% colat.` : "naturalmente atrapado"})`)
      : "\u2014"],
  ];

  // Note: Balance de volúmenes y PUV teórico se muestran solo en el cuerpo del informe (sección F.1),
  // no se duplican en el Anexo.

  // Motor + modelo de cálculo. La marca/motor es HormiQual (versión
  // unificada); el MODELO (CIRSOC / RDC-HRDC / ACI-legacy) es un descriptor
  // aparte para no diluir la identidad. Snapshots viejos pueden traer
  // "HRDC-1.0"/"HormiQual-1.0.0" (forward-only, auditoría) — se respetan.
  if (trazabilidad?.motorVersion || resultado?.motorVersion) {
    resultRows.push(["Versión del motor", trazabilidad.motorVersion || resultado.motorVersion]);
  }
  const _modeloLabel = trazabilidad?.modeloCalculoLabel
    || (esHRDC
      ? "HRDC — Hormigón de Resistencia y Densidad Controlada (modelo no normativo)"
      : "CIRSOC 200:2024 (prescriptivo)");
  resultRows.push(["Modelo de cálculo", _modeloLabel]);

  const stageResultado = {
    key: "resultado-final",
    stageType: "resultado",
    title: "Resultado final y trazabilidad resumida",
    rows: resultRows,
  };

  // \u2500\u2500 Stage: Verificaciones CIRSOC 200:2024 (Aire T.4.3 + Pulverulento T.4.4) \u2500\u2500
  const verificacionAire = trazabilidad?.verificacionAire;
  const verificacionPulverulento = trazabilidad?.verificacionPulverulento;
  let stageVerificaciones = null;
  if (verificacionAire || verificacionPulverulento) {
    const verifRows = [];
    if (verificacionAire) {
      verifRows.push(["Aire (Tabla 4.3)", `Clase ${verificacionAire.clase}, TMN ${verificacionAire.tmnMm} mm`]);
      verifRows.push(["Aire requerido", `${Number(verificacionAire.aireRequeridoEfectivo).toFixed(1)}% ± ${Number(verificacionAire.tolerancia).toFixed(1)}%${verificacionAire.excepcionH35 ? " (reducción H-35)" : ""}`]);
      if (verificacionAire.aireActual != null) verifRows.push(["Aire actual", `${Number(verificacionAire.aireActual).toFixed(1)}%`]);
      verifRows.push(["Resultado", verificacionAire.cumple === true ? "CUMPLE" : verificacionAire.cumple === false ? "NO CUMPLE" : "Sin dato"]);
    }
    if (verificacionPulverulento) {
      verifRows.push(["Pulverulento (Tabla 4.4)", `TMN ${verificacionPulverulento.tmnMm} mm \u2014 mínimo ${verificacionPulverulento.minimoKgM3} kg/m³`]);
      verifRows.push(["Estimado", `${verificacionPulverulento.totalPulverulento} kg/m³`]);
      verifRows.push(["Resultado", verificacionPulverulento.cumple ? "CUMPLE" + (verificacionPulverulento.excepcionH20 ? " (excepción \u2264 H-20)" : "") : "NO CUMPLE"]);
    }
    stageVerificaciones = { key: "verificaciones-cirsoc", stageType: "kv", title: "Verificaciones CIRSOC 200:2024 (T.4.3, T.4.4)", rows: verifRows };
  }

  // \u2500\u2500 Stage I: Advertencias \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  // Add validación cruzada to warnings if present
  const validacionWarnings = validacionCruzada
    .filter(v => v.resultado !== 'OK')
    .map(v => `[Validación cruzada] ${v.detalle}`);
  const allWarnings = [...warnings, ...validacionWarnings];

  const stageWarnings = {
    key: "warnings",
    stageType: "warnings",
    title: "Advertencias y validaciones",
    lines: allWarnings.length > 0 ? allWarnings : ["Sin advertencias técnicas registradas."],
    warningCount: allWarnings.length,
  };

  // ── Corrección por humedad ──
  const correccionHumedad = snapshot?.correccionHumedad;
  let stageHumedad = null;
  if (correccionHumedad && correccionHumedad.items?.length) {
    const correccionSign = correccionHumedad.deltaAguaTotal > 0 ? "\u2212" : "+";
    stageHumedad = {
      key: "correccion-humedad",
      stageType: "table",
      title: "Corrección por humedad \u2014 Receta de obra",
      lines: [
        `Agua de diseño (SSS): ${formatNumber(resultado.aguaLtsM3, 1)} L/m³`,
        `Corrección: ${correccionSign}${formatNumber(Math.abs(correccionHumedad.deltaAguaTotal), 1)} L/m³`,
        `Agua a agregar en obra: ${formatNumber(correccionHumedad.aguaObra, 1)} L/m³`,
      ],
      table: {
        headers: ["Agregado", "kg/m³ (SSS)", "Abs. %", "Hum. %", "\u0394 Agua (L)", "kg/m³ (natural)"],
        rows: correccionHumedad.items
          .filter((it) => it.humedadPct != null)
          .map((it) => [
            it.nombre || "\u2014",
            it.kgSSS != null ? formatNumber(it.kgSSS, 0) : "\u2014",
            it.absorcionPct != null ? formatParamValue('absorcion', it.absorcionPct) : "\u2014",
            formatNumber(it.humedadPct, 2),
            it.deltaAgua != null ? `${it.deltaAgua > 0 ? "\u2212" : "+"}${formatNumber(Math.abs(it.deltaAgua), 1)}` : "\u2014",
            it.kgNatural != null ? formatNumber(it.kgNatural, 0) : "\u2014",
          ]),
      },
    };
  }

  const sections = [
    stageResumen,
    stageEntradas,
    stageAgua,
    stageAC,
    stageCemento,
    stageAditivos,
    stageAgregados,
    stageResultado,
    stageVerificaciones,
    stageHumedad,
    stageWarnings,
  ].filter(Boolean);

  // \u2500\u2500 Fuentes detalladas (collapsible) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const fuentesCalculo = snapshot?.trazabilidad?.fuentesCalculo;
  if (Array.isArray(fuentesCalculo) && fuentesCalculo.length > 0) {
    sections.push({
      key: "fuentes-calculo",
      stageType: "fuentes",
      title: "Fuentes y supuestos del cálculo",
      collapsible: true,
      rows: [],
      lines: [],
      table: {
        headers: ["Parámetro", "Valor", "Origen", "Regla aplicada", "Observación"],
        rows: fuentesCalculo.map((f) => {
          let valor = f.valor;
          let regla = f.regla;

          // Override values from current snapshot for context parameters that may have been
          // changed after the last calculation. These determine the destination criteria and
          // must match what the current form has, not the historical trace snapshot.
          if (f.parametro === "Expuesto a desgaste superficial" && snapshot?.expuestoDesgaste != null) {
            const current = !!snapshot.expuestoDesgaste;
            valor = current ? "Sí" : "No";
            regla = current
              ? 'Marcado por el usuario (o auto-configurado por tipología). Activa criterio estricto IRAM 1512 de suma nocivas <= 5,0%'
              : 'No marcado. Se aplica criterio estándar IRAM 1512 de suma nocivas <= 7,0%';
          }
          if (f.parametro === "Aspecto superficial importante" && snapshot?.aspectoSuperficialImportante != null) {
            const current = !!snapshot.aspectoSuperficialImportante;
            valor = current ? "Sí" : "No";
            regla = current
              ? 'Marcado por el usuario (o auto-configurado por tipología). Activa límite de carbonosas <= 0,5%'
              : 'No marcado. Se aplica límite estándar de carbonosas <= 1,0%';
          }
          // Volumen de pasta: el motor lo expone vía pushFuente con su valor
          // interno (precisión float) que puede diferir 2-3 L/m³ del valor
          // mostrado en el panel ejecutivo de portada (suma de componentes
          // redondeados a 1 decimal de balanceVol). Para evitar la lectura
          // de "dos volúmenes de pasta distintos" en un mismo documento,
          // recomputamos el valor desde balanceVol (mismo método que el
          // panel ejecutivo) para que ambas vistas coincidan.
          if (f.parametro === "Volumen de pasta" && balanceVol) {
            const _vp = Number(balanceVol.vAgua || 0) + Number(balanceVol.vCemento || 0)
              + Number(balanceVol.vAire || 0) + Number(balanceVol.vAdiciones || 0)
              + Number(balanceVol.vAditivos || 0);
            valor = `${Math.round(_vp)} L/m³`;
          }

          if (valor == null || valor === '') valor = '\u2014';
          else if (typeof valor === 'number') {
            // a/c values: show precise value + rounded in parentheses for traceability
            if (f.parametro && f.parametro.toLowerCase().includes('a/c')) {
              const rounded = formatNumber(valor, 2);
              const precise = formatNumber(valor, 3);
              valor = rounded !== precise ? `${precise} (redondeado: ${rounded})` : rounded;
            } else {
              valor = formatNumber(valor);
            }
          }
          if (f.parametro === "Forma del agregado") valor = FORMA_LABELS[valor] || valor;

          // Fix origin for forma/MF: these derive from mezcla granulometrics, not user input
          let origenTipo = f.origenTipo;
          const hasMezcla = fuentesCalculo.some((x) => x.origenTipo === 'MEZCLA');
          if (hasMezcla && f.origenTipo === 'INPUT_USUARIO') {
            if (f.parametro === "Forma del agregado") {
              origenTipo = 'MEZCLA';
              regla = 'Derivada de la clasificación de los agregados gruesos (ensayos granulométricos)';
            } else if (f.parametro && f.parametro.includes("dulo de finura")) {
              origenTipo = 'MEZCLA';
              regla = 'Tomado del cálculo granulométrico de la mezcla seleccionada';
            }
          }

          return [
            f.parametro || "\u2014",
            polishTraceText(String(valor)),
            ORIGEN_TIPO_LABELS[origenTipo] || origenTipo || "\u2014",
            polishTraceText(translateRegla(regla)),
            polishTraceText(f.observacion || "\u2014"),
          ];
        }),
      },
      fuentesCalculo,
    });
  }

  if (includeGlossary) {
    // RDC/HRDC y Alivianado no usan Shilstone (FdG/FdT/FdA), SE ni el
    // Factor ICPA: filtrar esos términos para no confundir al lector.
    const _trazG = snapshot?.trazabilidad || {};
    const _tipCodigoG = String(snapshot?.tipologiaCodigo || '').toLowerCase();
    const _esHRDCg = _trazG?.metodoCalculo === 'HRDC'
      || String(_trazG?.motorVersion || '').toUpperCase().startsWith('HRDC')
      || _tipCodigoG === 'hrdc';
    const _esAlivianadoG = _trazG?.metodoCalculo === 'ALIVIANADO'
      || _tipCodigoG === 'alivianado';
    const glos = (_esHRDCg || _esAlivianadoG)
      ? GLOSARIO.filter(g => !/^(FdG|FdT|FdA|SE|Factor de ajuste de curva)\b/.test(g)
          && !/^Factor de ajuste de curva/.test(g))
      : GLOSARIO;
    sections.push({
      key: "glosario",
      stageType: "glosario",
      title: "Glosario breve",
      collapsible: true,
      rows: [],
      lines: glos,
    });
  }

  return sections.filter(Boolean);
}
