'use strict';

/**
 * ensayoFormSpecRegistry.js
 *
 * Centralised Form Specification registry for ensayos de agregados.
 * Provides field-level metadata (type, unit, range, options) so the
 * frontend can render correct inputs and validate client-side.
 *
 * Aligned 1:1 with ensayoResultRegistry.js canonical codes.
 */

const { getCanonicalCodigo, isDerivedCodigo, isAliasCodigo } = require('./ensayoResultRegistry');

/** Global spec version — bump on any structural change to specs */
const SPEC_VERSION = '1.1.0';

/** Campo operador reutilizable para todos los ensayos con límites normativos */
const OPERADOR_FIELD = {
  path: 'operador', label: 'Operador', type: 'enum', unit: null, required: false,
  options: [
    { label: '= (valor exacto)', value: 'exacto' },
    { label: '< (menor que)', value: 'menor_que' },
    { label: '> (mayor que)', value: 'mayor_que' },
  ],
};

/* ═══════════════════════════════════════════════════════════
   Spec definitions per canonical código
   ═══════════════════════════════════════════════════════════ */

const specs = {};

// ── GRANULOMETRÍA (canónico: IRAM1505; IRAM1627 resuelve aquí vía alias) ──
specs['IRAM1505_GRANULOMETRIA'] = {
  codigo: 'IRAM1505_GRANULOMETRIA',
  titulo: 'Análisis granulométrico (IRAM 1505)',
  categoria: 'fisica',
  modo: 'GRANULO',
  fields: [],
};
// IRAM1627_GRANULOMETRIA_ESPECIFICA se resuelve a IRAM1505 vía ALIAS_MAP en getCanonicalCodigo()

// ── DESGASTE LOS ÁNGELES ─────────────────────────────────
specs['IRAM1532_DESGASTE_LA'] = {
  codigo: 'IRAM1532_DESGASTE_LA',
  titulo: 'Resistencia a la degradación — Máquina Los Ángeles',
  categoria: 'mecanica',
  modo: 'GENERIC',
  fields: [
    { path: 'losAngelesPct', label: 'Desgaste Los Ángeles', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
  ],
};

// ── LAJOSIDAD ─────────────────────────────────────────────
specs['IRAM1687_1_LAJOSIDAD'] = {
  codigo: 'IRAM1687_1_LAJOSIDAD',
  titulo: 'Índice de lajosidad',
  categoria: 'forma',
  modo: 'GENERIC',
  fields: [
    { path: 'lajosidadPct', label: 'Índice de lajosidad', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
  ],
};

// ── ELONGACIÓN ────────────────────────────────────────────
specs['IRAM1687_2_ELONGACION'] = {
  codigo: 'IRAM1687_2_ELONGACION',
  titulo: 'Índice de elongación',
  categoria: 'forma',
  modo: 'GENERIC',
  fields: [
    { path: 'elongacionPct', label: 'Índice de elongación', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
  ],
};

// ── MATERIAL FINO PASA N°200 ──────────────────────────────
// PR8.15 — campo opcional `indicePlasticidadIP` (IRAM 1540 Anexo, Atterberg).
// Si IP < 2 → el límite del pasante #200 en AG sube al de piedra partida (1.5%)
// aún para grava/canto rodado, ya que los finos no plásticos no afectan adherencia.
specs['IRAM1674_MATERIAL_FINO_200'] = {
  codigo: 'IRAM1674_MATERIAL_FINO_200',
  titulo: 'Material fino que pasa tamiz N.º 200',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'pasa200Pct', label: 'Pasa N.º 200', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    { path: 'indicePlasticidadIP', label: 'Índice de plasticidad (IP)', type: 'number', unit: '', required: false, min: 0, max: 50, step: 0.1, help: 'Opcional. IRAM 1540 Anexo (Atterberg). Si IP < 2: bonus 1,5% en AG aún para grava.' },
    OPERADOR_FIELD,
  ],
};

// ── ESTABILIDAD SULFATOS ──────────────────────────────────
specs['IRAM1648_ESTABILIDAD_SULFATOS'] = {
  codigo: 'IRAM1648_ESTABILIDAD_SULFATOS',
  titulo: 'Estabilidad mediante sulfato de sodio o magnesio',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [
    { path: 'perdidaPct', label: 'Pérdida por sulfatos', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    { path: 'ciclos', label: 'Ciclos', type: 'number', unit: null, required: false, min: 1, max: 50, step: 1 },
    {
      path: 'sulfato', label: 'Tipo de sulfato', type: 'enum', unit: null, required: false,
      options: [
        { label: 'Sodio', value: 'sodio' },
        { label: 'Magnesio', value: 'magnesio' },
      ],
    },
  ],
};

// ── DENSIDAD / ABSORCIÓN FINO ─────────────────────────────
specs['IRAM1520_DENSIDAD_ABSORCION_FINO'] = {
  codigo: 'IRAM1520_DENSIDAD_ABSORCION_FINO',
  titulo: 'Densidad relativa y absorción — Agregado fino',
  categoria: 'fisica',
  modo: 'GENERIC',
  fields: [
    { path: 'densidadRelativaAparenteSSS', label: 'Densidad rel. aparente (SSS)', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'densidadRelativaAparenteSeca', label: 'Densidad rel. aparente (seca)', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'densidadRelativaReal', label: 'Densidad relativa real', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'absorcionPct', label: 'Absorción', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.01 },
  ],
};

// ── DENSIDAD / ABSORCIÓN GRUESO ───────────────────────────
specs['IRAM1533_DENSIDAD_GRUESO'] = {
  codigo: 'IRAM1533_DENSIDAD_GRUESO',
  titulo: 'Densidad, densidad relativa y absorción — Agregado grueso',
  categoria: 'fisica',
  modo: 'GENERIC',
  fields: [
    { path: 'densidadRelativaAparenteSSS', label: 'Densidad rel. aparente (SSS)', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'densidadRelativaAparenteSeca', label: 'Densidad rel. aparente (seca)', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'densidadRelativaReal', label: 'Densidad relativa real', type: 'number', unit: 'g/cm³', required: false, min: 0.5, max: 5, step: 0.001 },
    { path: 'absorcionPct', label: 'Absorción', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.01 },
    OPERADOR_FIELD,
  ],
};

// ── PESO UNITARIO SUELTO Y COMPACTADO (IRAM 1548) ────────
specs['IRAM1531_PESO_UNITARIO'] = {
  codigo: 'IRAM1531_PESO_UNITARIO',
  titulo: 'Peso unitario suelto y compactado',
  categoria: 'fisica',
  modo: 'GENERIC',
  // PUC y PUS son siempre valores medidos exactos (masa/volumen del recipiente
  // calibrado). No tiene sentido un operador `<` ni `>` — por eso este ensayo
  // NO incluye OPERADOR_FIELD.
  fields: [
    { path: 'puc', label: 'PUC (compactado)', type: 'number', unit: 'kg/m³', required: true, min: 0, max: 3000, step: 1 },
    { path: 'pus', label: 'PUS (suelto)', type: 'number', unit: 'kg/m³', required: true, min: 0, max: 3000, step: 1 },
    { path: 'vaciosCompactado', label: 'V% compactado', type: 'number', unit: '%', required: false, min: 0, max: 100, step: 0.1, computed: true },
    { path: 'vaciosSuelto', label: 'V% suelto', type: 'number', unit: '%', required: false, min: 0, max: 100, step: 0.1, computed: true },
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── IMPUREZAS ORGÁNICAS ───────────────────────────────────
specs['IRAM1649_IMPUREZAS_ORGANICAS'] = {
  codigo: 'IRAM1649_IMPUREZAS_ORGANICAS',
  titulo: 'Impurezas orgánicas (colorimetría)',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'colorNro', label: 'Color N.º (Gardner)', type: 'number', unit: null, required: false, min: 1, max: 5, step: 1 },
    {
      path: 'resultado', label: 'Resultado', type: 'enum', unit: null, required: false,
      options: [
        { label: 'Aceptable', value: 'aceptable' },
        { label: 'No aceptable', value: 'no aceptable' },
      ],
    },
  ],
};

// ── EQUIVALENTE DE ARENA (IRAM 1682) ─────────────────────
specs['IRAM1882_VALOR_EQUIVALENTE_ARENA'] = {
  codigo: 'IRAM1882_VALOR_EQUIVALENTE_ARENA',
  titulo: 'Equivalente de arena',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'equivalenteArenaPct', label: 'EA promedio', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 1 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── AZUL DE METILENO ──────────────────────────────────────
specs['IRAM1887_AZUL_METILENO'] = {
  codigo: 'IRAM1887_AZUL_METILENO',
  titulo: 'Ensayo de azul de metileno',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'azulMetilenoGKg', label: 'Azul de metileno', type: 'number', unit: 'g/kg', required: true, min: 0, max: 100, step: 0.1 },
  ],
};

// ── PARTÍCULAS DESMENUZABLES ──────────────────────────────
specs['IRAM1540_PARTICULAS_DESMENUZABLES'] = {
  codigo: 'IRAM1540_PARTICULAS_DESMENUZABLES',
  titulo: 'Partículas desmenuzables (terrones de arcilla)',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'desmenuzablesPct', label: 'Partículas desmenuzables', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
  ],
};

// ── DURABILIDAD POR SULFATO DE SODIO (IRAM 1525) ─────────
specs['IRAM1525_DURABILIDAD_SULFATO'] = {
  codigo: 'IRAM1525_DURABILIDAD_SULFATO',
  titulo: 'Durabilidad por ataque con sulfato de sodio',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Pérdida de masa', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
    { path: 'ciclos', label: 'Ciclos', type: 'number', unit: null, required: false, min: 1, max: 50, step: 1 },
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── POLVO ADHERIDO (IRAM 1883) ───────────────────────────
specs['IRAM1883_POLVO_ADHERIDO'] = {
  codigo: 'IRAM1883_POLVO_ADHERIDO',
  titulo: 'Polvo adherido',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Polvo adherido', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── PARTÍCULAS BLANDAS (IRAM 1644) ───────────────────────
specs['IRAM1644_PARTICULAS_BLANDAS'] = {
  codigo: 'IRAM1644_PARTICULAS_BLANDAS',
  titulo: 'Partículas blandas',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    {
      path: 'resultadoCualitativo', label: 'Resultado', type: 'enum', unit: null, required: true,
      options: [
        { label: 'No contiene', value: 'no_contiene' },
        { label: 'Contiene (indicar %)', value: 'contiene' },
      ],
    },
    { path: 'valor', label: 'Porcentaje (si contiene)', type: 'number', unit: '%', required: false, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── ESTABILIDAD BASÁLTICAS (IRAM 1519) ────────────────────
specs['IRAM1519_ESTABILIDAD_BASALTICAS'] = {
  codigo: 'IRAM1519_ESTABILIDAD_BASALTICAS',
  titulo: 'Estabilidad de rocas basálticas (inmersión en etilenglicol)',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Pérdida de masa a 30 días', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── EXAMEN PETROGRÁFICO (IRAM 1649) ──────────────────────
// PR8.11 — campo opcional `ftanitaPct` (% de ftanita / chert) y `conchillasPct`
// (% de conchillas, PR8.21). Ambos se obtienen del examen petrográfico y
// alimentan evaluadores específicos cuando AG.
specs['IRAM1649_EXAMEN_PETROGRAFICO'] = {
  codigo: 'IRAM1649_EXAMEN_PETROGRAFICO',
  titulo: 'Examen petrográfico',
  categoria: 'quimica',
  modo: 'GENERIC',
  fields: [
    {
      path: 'conclusion', label: 'Conclusión', type: 'enum', unit: null, required: true,
      options: [
        { label: 'Cumple requisitos IRAM 1531/1512 — No reactivo', value: 'cumple' },
        { label: 'No cumple requisitos — Potencialmente reactivo', value: 'no_cumple_reactivo' },
        { label: 'No cumple requisitos — Otros motivos', value: 'no_cumple_otro' },
      ],
    },
    { path: 'ftanitaPct', label: 'Ftanita / chert (%)', type: 'number', unit: '%', required: false, min: 0, max: 100, step: 0.1, help: 'Opcional. CIRSOC §3.2.4 Tabla 3.6: ≤ 3% en hormigón visto C1/C2; ≤ 5% en estructural C1/C2.' },
    { path: 'conchillasPct', label: 'Conchillas (%)', type: 'number', unit: '%', required: false, min: 0, max: 100, step: 0.1, help: 'Opcional. CIRSOC §3.2.4.1.b: ≤ 15% (TMN 13.2 mm), ≤ 5% (TMN 26.5 mm), ≤ 2% (TMN 37.5 mm).' },
    { path: 'observaciones', label: 'Observaciones (descripción petrográfica, minerales identificados, etc.)', type: 'text', unit: null, required: false },
  ],
};

// ── RAS ACELERADO — BARRA DE MORTERO (IRAM 1674) ─────────
specs['IRAM1674_RAS_ACELERADO'] = {
  codigo: 'IRAM1674_RAS_ACELERADO',
  titulo: 'Reactividad álcali-sílice — Método acelerado (barra de mortero)',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [
    { path: 'expansion16d', label: 'Expansión a 16 días', type: 'number', unit: '%', required: true, min: 0, max: 10, step: 0.001 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── REACTIVIDAD ALCALINA — 4 variantes ────────────────────
const REACTIVIDAD_FIELDS = [
  { path: 'expansionFinalPct', label: 'Expansión final', type: 'number', unit: '%', required: false, min: 0, max: 10, step: 0.001 },
];
const REACTIVIDAD_TABLE = {
  path: 'series',
  label: 'Lecturas de expansión',
  columns: [
    { path: 'edadDias', label: 'Edad (días)', type: 'number', min: 0, max: 1000, step: 1 },
    { path: 'expansionPct', label: 'Expansión (%)', type: 'number', min: -1, max: 10, step: 0.001 },
  ],
};

specs['IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA'] = {
  codigo: 'IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA',
  titulo: 'Reactividad alcalina potencial — Método químico',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [...REACTIVIDAD_FIELDS],
  table: REACTIVIDAD_TABLE,
};

specs['IRAM1874_1_RAP_PRISMA'] = {
  codigo: 'IRAM1874_1_RAP_PRISMA',
  titulo: 'Reactividad alcalina potencial — Prisma de hormigón',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [...REACTIVIDAD_FIELDS],
  table: REACTIVIDAD_TABLE,
};

specs['IRAM1874_2_RAP_BARRA_MORTERO'] = {
  codigo: 'IRAM1874_2_RAP_BARRA_MORTERO',
  titulo: 'Reactividad alcalina potencial — Barra de mortero',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [...REACTIVIDAD_FIELDS],
  table: REACTIVIDAD_TABLE,
};

specs['IRAM1874_3_RAP_BARRA_MORTERO_ACELERADO'] = {
  codigo: 'IRAM1874_3_RAP_BARRA_MORTERO_ACELERADO',
  titulo: 'Reactividad alcalina potencial — Barra de mortero (acelerado)',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [...REACTIVIDAD_FIELDS],
  table: REACTIVIDAD_TABLE,
};

// ── PETROGRAFÍA ───────────────────────────────────────────
specs['PETROGRAFIA_IRAM'] = {
  codigo: 'PETROGRAFIA_IRAM',
  titulo: 'Estudio petrográfico',
  categoria: 'durabilidad',
  modo: 'GENERIC',
  fields: [
    { path: 'descripcion', label: 'Descripción macroscópica', type: 'textarea', unit: null, required: false },
    { path: 'composicion', label: 'Composición mineralógica', type: 'textarea', unit: null, required: false },
    { path: 'reactivosPotenciales', label: 'Reactivos potenciales', type: 'textarea', unit: null, required: false },
    { path: 'sustanciasPerjudiciales', label: 'Sustancias perjudiciales', type: 'textarea', unit: null, required: false },
    { path: 'conclusiones', label: 'Conclusiones', type: 'textarea', unit: null, required: false },
  ],
};

// ── TERRONES DE ARCILLA Y PARTÍCULAS FRIABLES (IRAM 1647 — Cap. 4) ──
specs['IRAM1647_TERRONES_ARCILLA'] = {
  codigo: 'IRAM1647_TERRONES_ARCILLA',
  titulo: 'Terrones de arcilla y partículas friables',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Resultado', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.1 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── SALES SOLUBLES TOTALES (IRAM 1647 — Cap. 6) ──────────
specs['IRAM1647_SALES_SOLUBLES'] = {
  codigo: 'IRAM1647_SALES_SOLUBLES',
  titulo: 'Sales solubles totales',
  categoria: 'quimica',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Resultado', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.01 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── SULFATOS COMO SO₃ (IRAM 1647 — Cap. 8.9) ────────────
specs['IRAM1647_SULFATOS_SO3'] = {
  codigo: 'IRAM1647_SULFATOS_SO3',
  titulo: 'Sulfatos (expresados como SO₃)',
  categoria: 'quimica',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Resultado', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.001 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── CLORUROS SOLUBLES (IRAM 1882) ────────────────────────
specs['IRAM1882_CLORUROS_SOLUBLES'] = {
  codigo: 'IRAM1882_CLORUROS_SOLUBLES',
  titulo: 'Cloruros solubles',
  categoria: 'quimica',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Resultado', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.01 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── MATERIA ORGÁNICA (IRAM 1647 — Cap. 5) ────────────────
specs['IRAM1647_MATERIA_ORGANICA'] = {
  codigo: 'IRAM1647_MATERIA_ORGANICA',
  titulo: 'Materia orgánica',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    {
      path: 'resultadoColorimetrico', label: 'Resultado', type: 'enum', unit: null, required: true,
      options: [
        { label: 'Menor a 500 ppm', value: 'menor_500' },
        { label: 'Igual o mayor a 500 ppm', value: 'igual_o_mayor_500' },
      ],
    },
    // Excepción §3.2.3.4 b) — solo visible si resultado >= 500 ppm
    { path: 'excepcionResistenciaArena7d', label: 'Resistencia mortero con arena (7d)', type: 'number', unit: 'MPa', required: false, min: 0, max: 200, step: 0.1 },
    { path: 'excepcionResistenciaPatron7d', label: 'Resistencia mortero patrón (7d)', type: 'number', unit: 'MPa', required: false, min: 0, max: 200, step: 0.1 },
    { path: 'excepcionInforme', label: 'Informe del ensayo de morteros', type: 'text', unit: null, required: false },
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

// ── MATERIAS CARBONOSAS (IRAM 1647 — Cap. 3) ─────────────
specs['IRAM1647_MATERIAS_CARBONOSAS'] = {
  codigo: 'IRAM1647_MATERIAS_CARBONOSAS',
  titulo: 'Materias carbonosas',
  categoria: 'limpieza',
  modo: 'GENERIC',
  fields: [
    { path: 'valor', label: 'Resultado', type: 'number', unit: '%', required: true, min: 0, max: 100, step: 0.01 },
    OPERADOR_FIELD,
    { path: 'observaciones', label: 'Observaciones', type: 'text', unit: null, required: false },
  ],
};

/* ═══════════════════════════════════════════════════════════
   ENSAYO DE AGUA — Análisis químico (IRAM 1601:2012)
   Formulario unificado con todos los parámetros de la Tabla 1.
   ═══════════════════════════════════════════════════════════ */

specs['IRAM1601_ANALISIS_QUIMICO'] = {
  codigo: 'IRAM1601_ANALISIS_QUIMICO',
  titulo: 'Análisis químico del agua',
  categoria: 'quimica',
  modo: 'GENERIC',
  fields: [
    // Residuo sólido (Ap. 10.1)
    { path: 'residuoSolido',        label: 'Residuo sólido',                 type: 'number', unit: 'mg/L', required: false, min: 0, max: 100000, step: 1 },
    // Materia orgánica (Ap. 10.2)
    { path: 'materiaOrganica',      label: 'Materia orgánica',               type: 'number', unit: 'mg/L', required: false, min: 0, max: 1000,   step: 0.1 },
    // pH (Ap. 10.3)
    { path: 'ph',                   label: 'pH',                             type: 'number', unit: 'UpH',  required: false, min: 0, max: 14,     step: 0.1 },
    // Sulfato como SO₄²⁻ (Ap. 10.4)
    { path: 'sulfato',              label: 'Sulfato (como SO₄²⁻)',           type: 'number', unit: 'mg/L', required: false, min: 0, max: 100000, step: 1 },
    // Cloruro como Cl⁻ (Ap. 10.5)
    { path: 'cloruro',              label: 'Cloruro (como Cl⁻)',             type: 'number', unit: 'mg/L', required: false, min: 0, max: 100000, step: 1 },
    // Hierro como Fe³⁺ (Ap. 10.6)
    { path: 'hierro',               label: 'Hierro (como Fe³⁺)',             type: 'number', unit: 'mg/L', required: false, min: 0, max: 1000,   step: 0.01 },
    // Álcalis (Ap. 10.7)
    { path: 'alcalis',              label: 'Álcalis (Na₂O + 0,658 K₂O)',    type: 'number', unit: 'mg/L', required: false, min: 0, max: 100000, step: 1 },
    // Observaciones generales
    { path: 'observaciones',        label: 'Observaciones',                  type: 'text',   unit: null,   required: false },
    // Contexto (guardado en resultado, no visible como campo — manejado por el componente)
  ],
};

// ── DERIVADOS ─────────────────────────────────────────────
specs['IRAM1525_MODULO_FINEZA'] = {
  codigo: 'IRAM1525_MODULO_FINEZA',
  titulo: 'Módulo de fineza (derivado)',
  categoria: 'fisica',
  modo: 'DERIVADO',
  derivadoDeCodigo: 'IRAM1505_GRANULOMETRIA',
  derivadoClave: 'moduloFinura',
  fields: [],
};

specs['IRAM1505_TMN'] = {
  codigo: 'IRAM1505_TMN',
  titulo: 'Tamaño máximo nominal — TMN (derivado)',
  categoria: 'fisica',
  modo: 'DERIVADO',
  derivadoDeCodigo: 'IRAM1505_GRANULOMETRIA',
  derivadoClave: 'tmn',
  fields: [],
};

/* ═══════════════════════════════════════════════════════════
   schemaKey → spec mapping
   Maps each schemaKey (technical method) to its canonical codigo spec.
   ═══════════════════════════════════════════════════════════ */

const SCHEMA_KEY_MAP = {
  GRANULOMETRIA_1505: 'IRAM1505_GRANULOMETRIA',
  DENSIDAD_ABSORCION: 'IRAM1520_DENSIDAD_ABSORCION_FINO', // shared structure fino/grueso
  LOS_ANGELES: 'IRAM1532_DESGASTE_LA',
  LAJOSIDAD: 'IRAM1687_1_LAJOSIDAD',
  ELONGACION: 'IRAM1687_2_ELONGACION',
  PASA_200: 'IRAM1674_MATERIAL_FINO_200',
  ORGANICAS: 'IRAM1649_IMPUREZAS_ORGANICAS',
  EQ_ARENA: 'IRAM1882_VALOR_EQUIVALENTE_ARENA',
  AZUL_METILENO: 'IRAM1887_AZUL_METILENO',
  DESMENUZABLES: 'IRAM1540_PARTICULAS_DESMENUZABLES',
  SULFATOS: 'IRAM1648_ESTABILIDAD_SULFATOS',
  REACTIVIDAD: 'IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA',
  PETROGRAFIA: 'PETROGRAFIA_IRAM',
  PESO_UNITARIO: 'IRAM1531_PESO_UNITARIO',
  MATERIAS_CARBONOSAS: 'IRAM1647_MATERIAS_CARBONOSAS',
  TERRONES_ARCILLA: 'IRAM1647_TERRONES_ARCILLA',
  MATERIA_ORGANICA: 'IRAM1647_MATERIA_ORGANICA',
  SALES_SOLUBLES: 'IRAM1647_SALES_SOLUBLES',
  SULFATOS_SO3: 'IRAM1647_SULFATOS_SO3',
  CLORUROS_SOLUBLES: 'IRAM1882_CLORUROS_SOLUBLES',
  DURABILIDAD_SULFATO: 'IRAM1525_DURABILIDAD_SULFATO',
  POLVO_ADHERIDO: 'IRAM1883_POLVO_ADHERIDO',
  PARTICULAS_BLANDAS: 'IRAM1644_PARTICULAS_BLANDAS',
  ESTABILIDAD_BASALTICAS: 'IRAM1519_ESTABILIDAD_BASALTICAS',
  EXAMEN_PETROGRAFICO: 'IRAM1649_EXAMEN_PETROGRAFICO',
  RAS_ACELERADO: 'IRAM1674_RAS_ACELERADO',
  // Agua (IRAM 1601)
  AGUA_ANALISIS_QUIMICO: 'IRAM1601_ANALISIS_QUIMICO',
};

/**
 * Supported schemaKeys with friendly names for the wizard UI.
 */
const SCHEMA_KEY_OPTIONS = [
  { schemaKey: 'GRANULOMETRIA_1505', label: 'Granulometría (IRAM 1505)', modo: 'GRANULO' },
  { schemaKey: 'DENSIDAD_ABSORCION', label: 'Densidad relativa y absorción', modo: 'GENERIC' },
  { schemaKey: 'LOS_ANGELES', label: 'Desgaste Los Ángeles', modo: 'GENERIC' },
  { schemaKey: 'LAJOSIDAD', label: 'Índice de lajosidad', modo: 'GENERIC' },
  { schemaKey: 'ELONGACION', label: 'Índice de elongación', modo: 'GENERIC' },
  { schemaKey: 'PASA_200', label: 'Material fino pasa N.º 200', modo: 'GENERIC' },
  { schemaKey: 'ORGANICAS', label: 'Impurezas orgánicas', modo: 'GENERIC' },
  { schemaKey: 'EQ_ARENA', label: 'Equivalente de arena', modo: 'GENERIC' },
  { schemaKey: 'AZUL_METILENO', label: 'Azul de metileno', modo: 'GENERIC' },
  { schemaKey: 'DESMENUZABLES', label: 'Partículas desmenuzables', modo: 'GENERIC' },
  { schemaKey: 'SULFATOS', label: 'Estabilidad mediante sulfatos', modo: 'GENERIC' },
  { schemaKey: 'REACTIVIDAD', label: 'Reactividad alcalina potencial', modo: 'GENERIC' },
  { schemaKey: 'PETROGRAFIA', label: 'Estudio petrográfico', modo: 'GENERIC' },
  { schemaKey: 'PESO_UNITARIO', label: 'Peso unitario (masa unitaria)', modo: 'GENERIC' },
  { schemaKey: 'MATERIAS_CARBONOSAS', label: 'Materias carbonosas', modo: 'GENERIC' },
  { schemaKey: 'TERRONES_ARCILLA', label: 'Terrones de arcilla y partículas friables', modo: 'GENERIC' },
  { schemaKey: 'MATERIA_ORGANICA', label: 'Materia orgánica', modo: 'GENERIC' },
  { schemaKey: 'SALES_SOLUBLES', label: 'Sales solubles totales', modo: 'GENERIC' },
  { schemaKey: 'SULFATOS_SO3', label: 'Sulfatos (expresados como SO₃)', modo: 'GENERIC' },
  { schemaKey: 'CLORUROS_SOLUBLES', label: 'Cloruros solubles', modo: 'GENERIC' },
  { schemaKey: 'DURABILIDAD_SULFATO', label: 'Durabilidad por sulfato de sodio (IRAM 1525)', modo: 'GENERIC' },
  { schemaKey: 'POLVO_ADHERIDO', label: 'Polvo adherido (IRAM 1883)', modo: 'GENERIC' },
  { schemaKey: 'PARTICULAS_BLANDAS', label: 'Partículas blandas (IRAM 1644)', modo: 'GENERIC' },
  // Agua (IRAM 1601)
  { schemaKey: 'AGUA_ANALISIS_QUIMICO', label: 'Análisis químico del agua (IRAM 1601)', modo: 'GENERIC' },
];

/* ═══════════════════════════════════════════════════════════
   Public API
   ═══════════════════════════════════════════════════════════ */

/**
 * Get form spec for a given tipoCodigo (resolves alias).
 * @param {string} codigo
 * @returns {object|null} spec or null if unknown
 */
const getFormSpec = (codigo) => {
  const canonical = getCanonicalCodigo(codigo);
  const spec = specs[canonical] || null;
  if (!spec) return null;
  // Return enriched copy
  return {
    ...spec,
    canonicalCodigo: canonical,
    esDerivado: isDerivedCodigo(canonical),
    esAlias: isAliasCodigo(codigo),
    requestedCodigo: codigo !== canonical ? codigo : undefined,
    version: SPEC_VERSION,
  };
};

/**
 * Get form spec by schemaKey (technical method identifier).
 * @param {string} schemaKey
 * @returns {object|null} spec or null if unknown schemaKey
 */
const getFormSpecBySchemaKey = (schemaKey) => {
  const canonicalCodigo = SCHEMA_KEY_MAP[schemaKey];
  if (!canonicalCodigo) return null;
  const spec = specs[canonicalCodigo] || null;
  if (!spec) return null;
  return {
    ...spec,
    canonicalCodigo,
    schemaKey,
    esDerivado: isDerivedCodigo(canonicalCodigo),
    esAlias: false,
    version: SPEC_VERSION,
  };
};

/**
 * Get all form specs keyed by canonical code.
 * @returns {Object<string, object>}
 */
const getAllFormSpecs = () => {
  const result = {};
  for (const [key, spec] of Object.entries(specs)) {
    result[key] = {
      ...spec,
      canonicalCodigo: key,
      esDerivado: isDerivedCodigo(key),
      version: SPEC_VERSION,
    };
  }
  return result;
};

/** Returns the global spec version string */
const getSpecVersion = () => SPEC_VERSION;

module.exports = {
  getFormSpec,
  getFormSpecBySchemaKey,
  getAllFormSpecs,
  getSpecVersion,
  SPEC_VERSION,
  SCHEMA_KEY_MAP,
  SCHEMA_KEY_OPTIONS,
};
