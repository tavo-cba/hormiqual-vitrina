'use strict';

/**
 * matrizPrescriptiva.js — Single Source of Truth normativa de HormiQual.
 *
 * Esta es la fuente única de reglas prescriptivas (CIRSOC 200:2024 +
 * serie IRAM) usada por el modo PRESCRIPTIVO de evaluación. Cada entrada
 * declara, para un código de ensayo:
 *
 *   - Datos legibles (nombre, normaRef, cita exacta).
 *   - Cuándo es exigible (predicados estructurados sobre el contexto).
 *   - A qué tipos de agregado aplica (FINO, GRUESO, ambos).
 *   - Si su ausencia es bloqueante o sólo observación.
 *
 * Política PR9.2:
 *   - Esta tabla es la SSoT prescriptiva. Cuando se actualice CIRSOC o
 *     IRAM, se modifica acá y los tests por celda se ajustan.
 *   - El motor `prescriptivoEngine.js` consume esta tabla a través del
 *     getter `obtenerEnsayosExigibles(contexto)`.
 *   - La `EXIGIBILITY_TABLE` legacy en `compliance/required.js` se
 *     mantiene por compatibilidad con consumidores no migrados; se
 *     migrará progresivamente.
 *   - Esta tabla NO sustituye al catálogo del tenant (modo PRESTACIONAL):
 *     el catálogo SIEMPRE puede ser MÁS estricto que esta matriz.
 *
 * Función PURA: el módulo es 100% datos + funciones puras. Sin DB, sin
 * HTTP, sin Sequelize.
 *
 * Estructura de cada entrada:
 *
 *   {
 *     codigo:    'IRAM1525_DURABILIDAD_SULFATO',
 *     nombre:    'Durabilidad por sulfato de sodio',
 *     normaRef:  'IRAM 1525',
 *     cita:      'CIRSOC 200:2024 §3.2.3.5 (AF) / §3.2.4.4 (AG) — clases C/M/Q',
 *     aplicaA:   ['FINO', 'GRUESO'],          // dónde puede ensayarse
 *     exigibleSiempre: false,                  // shortcut para reglas universales
 *     exigibleCuando:  [                       // OR de predicados, si exigibleSiempre=false
 *       { claseExposicion: ['C1','C2','M1','M2','M3','Q1','Q2','Q3','Q4'] },
 *     ],
 *     bloqueante: true,                        // si falta o no cumple → veredicto NO_APTO
 *   }
 *
 * Predicados:
 *   - { campo: valor }       → match exacto
 *   - { campo: [a, b, c] }   → match si está en el array
 *   - { campo: { gte: N } }  → comparación numérica
 *   - { campo: { lte: N } }
 *   - AND entre claves del mismo predicado.
 *   - OR entre predicados del array `exigibleCuando`.
 *   - Si una clave evalúa a `null`/`undefined` en el contexto → la regla
 *     se considera 'unknown' (regla conservadora: el getter por default
 *     trata 'unknown' como exigible).
 */

/* ════════════════════════════════════════════════════════════════════
   MATRIZ
   ════════════════════════════════════════════════════════════════════ */

const MATRIZ_PRESCRIPTIVA = Object.freeze({

  /* ─── Caracterización física ─── */

  'IRAM1505_GRANULOMETRIA': Object.freeze({
    codigo: 'IRAM1505_GRANULOMETRIA',
    nombre: 'Granulometría',
    normaRef: 'IRAM 1505',
    cita: 'IRAM 1505 — Caracterización siempre exigible para diseño de mezclas',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1520_DENSIDAD_ABSORCION_FINO': Object.freeze({
    codigo: 'IRAM1520_DENSIDAD_ABSORCION_FINO',
    nombre: 'Densidad y absorción (fino)',
    normaRef: 'IRAM 1520',
    cita: 'IRAM 1520 — Base del cálculo de dosificación',
    aplicaA: ['FINO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1533_DENSIDAD_GRUESO': Object.freeze({
    codigo: 'IRAM1533_DENSIDAD_GRUESO',
    nombre: 'Densidad y absorción (grueso)',
    normaRef: 'IRAM 1533',
    cita: 'IRAM 1533 — Base del cálculo de dosificación',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1531_PESO_UNITARIO': Object.freeze({
    codigo: 'IRAM1531_PESO_UNITARIO',
    nombre: 'Peso unitario suelto',
    normaRef: 'IRAM 1548',
    cita: 'IRAM 1548 — Exigido para AG (≥ 1120 kg/m³ típico). Para AF es informativo',
    // aplicaA = a qué tipos es **exigible normativamente**. NO confundir con
    // `aplicabilidadEnsayos.js` (registry funcional: a qué tipos puede
    // registrarse el ensayo). IRAM 1548 cubre AF y AG metodológicamente
    // (puede cargarse para ambos), pero CIRSOC 200 solo lo exige para AG;
    // para AF es informativo y no se evalúa contra umbrales.
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: false,
  }),

  /* ─── Sustancias nocivas (siempre exigibles) ─── */

  'IRAM1674_MATERIAL_FINO_200': Object.freeze({
    codigo: 'IRAM1674_MATERIAL_FINO_200',
    nombre: 'Material fino que pasa tamiz N.° 200',
    normaRef: 'IRAM 1540',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1647_TERRONES_ARCILLA': Object.freeze({
    codigo: 'IRAM1647_TERRONES_ARCILLA',
    nombre: 'Terrones de arcilla y partículas friables',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1647_SULFATOS_SO3': Object.freeze({
    codigo: 'IRAM1647_SULFATOS_SO3',
    nombre: 'Sulfatos (como SO₃)',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 / §3.2.4 Tabla 3.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1647_SALES_SOLUBLES': Object.freeze({
    codigo: 'IRAM1647_SALES_SOLUBLES',
    nombre: 'Sales solubles totales',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 / §3.2.4 Tabla 3.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1882_CLORUROS_SOLUBLES': Object.freeze({
    codigo: 'IRAM1882_CLORUROS_SOLUBLES',
    nombre: 'Cloruros solubles',
    normaRef: 'IRAM 1882',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / IRAM 1531 Tabla 1 (AG) — verificación a nivel hormigón en §2.2.8 Tabla 2.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1647_MATERIA_ORGANICA': Object.freeze({
    codigo: 'IRAM1647_MATERIA_ORGANICA',
    nombre: 'Materia orgánica',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.4 — exigible para AF',
    aplicaA: ['FINO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1647_MATERIAS_CARBONOSAS': Object.freeze({
    codigo: 'IRAM1647_MATERIAS_CARBONOSAS',
    nombre: 'Materias carbonosas',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG) — binario contextual PR8.8',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  /* ─── Forma y desgaste (grueso) ─── */

  'IRAM1687_1_LAJOSIDAD': Object.freeze({
    codigo: 'IRAM1687_1_LAJOSIDAD',
    nombre: 'Lajosidad',
    normaRef: 'IRAM 1687-1',
    cita: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7 — dual-limit por clase de hormigón (≥ H-50 vs uso general)',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1687_2_ELONGACION': Object.freeze({
    codigo: 'IRAM1687_2_ELONGACION',
    nombre: 'Elongación',
    normaRef: 'IRAM 1687-2',
    cita: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7 — dual-limit por clase de hormigón',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1532_DESGASTE_LA': Object.freeze({
    codigo: 'IRAM1532_DESGASTE_LA',
    nombre: 'Desgaste Los Angeles',
    normaRef: 'IRAM 1532',
    cita: 'CIRSOC 200:2024 §3.2.4.5 — dual-limit (≤ 30% con abrasión severa / ≤ 50% general)',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  'IRAM1644_PARTICULAS_BLANDAS': Object.freeze({
    codigo: 'IRAM1644_PARTICULAS_BLANDAS',
    nombre: 'Partículas blandas',
    normaRef: 'IRAM 1644',
    cita: 'CIRSOC 200:2024 §3.2.4.1.b — exigible para AG',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  // Equivalente de arena (IRAM 1682) eliminado de exigibilidad/bloqueante en
  // auditoría 01-calidad C21 (sesión 2026-05-07): la norma IRAM 1682:1992 es
  // método para mezclas bituminosas/bases de pavimentos y no establece
  // límite numérico para hormigón. Ni CIRSOC 200:2024 ni IRAM 1512:2006 lo
  // exigen para AF. El ensayo sigue siendo cargable y se evalúa contra el
  // límite operativo 75% (referencia industrial), pero no es ni exigible ni
  // bloqueante a nivel matriz prescriptiva. Si un tenant quiere ocultarlo,
  // usa los flags `visibleEnUI`/`isActive` del catálogo `AgregadoEnsayoTipo`.

  'IRAM1883_POLVO_ADHERIDO': Object.freeze({
    codigo: 'IRAM1883_POLVO_ADHERIDO',
    nombre: 'Polvo adherido',
    normaRef: 'IRAM 1883',
    cita: 'IRAM 1883 — exigible para AG',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: false,
  }),

  /* ─── Durabilidad contextual ─── */

  'IRAM1525_DURABILIDAD_SULFATO': Object.freeze({
    codigo: 'IRAM1525_DURABILIDAD_SULFATO',
    nombre: 'Durabilidad por sulfato de sodio (IRAM 1525)',
    normaRef: 'IRAM 1525',
    cita: 'CIRSOC 200:2024 §3.2.3.5 (AF, ≤10%) / §3.2.4.4 (AG, ≤12%) — agente: solución de sulfato de sodio (Na₂SO₄). Exigible solo para C1/C2 (ciclos de congelación-deshielo, Tabla 2.5)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { claseExposicion: ['C1', 'C2'] },
    ],
    bloqueante: true,
  }),

  'IRAM1519_ESTABILIDAD_BASALTICAS': Object.freeze({
    codigo: 'IRAM1519_ESTABILIDAD_BASALTICAS',
    nombre: 'Estabilidad de rocas basálticas (etilenglicol)',
    normaRef: 'IRAM 1519 / IRAM 1874-2',
    cita: 'IRAM 1519 — exigible solo si el agregado es de origen basáltico',
    aplicaA: ['GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { tipoRoca: 'BASALTICA' },
    ],
    bloqueante: true,
  }),

  /* ─── RAS / Petrográfico ─── */

  'IRAM1649_EXAMEN_PETROGRAFICO': Object.freeze({
    codigo: 'IRAM1649_EXAMEN_PETROGRAFICO',
    nombre: 'Examen petrográfico',
    normaRef: 'IRAM 1649',
    cita: 'CIRSOC 200:2024 §3.2.3.6 — caracterización mineralógica + reactividad RAS, exigible para hormigones de alta resistencia (f\'c ≥ 35) y/o exposición agresiva',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { fceMpa: { gte: 35 } },
      { claseExposicion: ['C1', 'C2', 'Q1', 'Q2', 'Q3', 'Q4'] },
    ],
    bloqueante: false,
  }),

  'IRAM1674_RAS_ACELERADO': Object.freeze({
    codigo: 'IRAM1674_RAS_ACELERADO',
    nombre: 'Reactividad álcali-sílice — método acelerado (barra de mortero)',
    normaRef: 'IRAM 1674',
    cita: 'IRAM 1674 / IRAM 1512 §5.6.5 — exigible si exposición Q3/Q4 o si el petrográfico indica reactividad potencial',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { claseExposicion: ['Q3', 'Q4'] },
      { evaluacionRas: 'POTENCIALMENTE_REACTIVO' },
    ],
    bloqueante: true,
  }),

  // PR1.5 — Antes la key era `IRAM1874_1_RAP_PRISMA` con `normaRef: 'IRAM 1700'`,
  // mezcla de dos normas distintas. IRAM 1874-1:2004 es "Resistencia a
  // congelación y deshielo" (NO RAS); IRAM 1700:1997 sí es prismas de hormigón
  // para RAS (ver docs/normativa/IRAM_RAS_alcances.md). Renombrado a la key
  // que refleja la norma real, y se agrega alias hacia el código persistido
  // por el catálogo (`IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA`) — ese código
  // legacy también es engañoso (no es método químico) pero se renombra en
  // sesión dedicada porque toca seed + datos persistidos.
  'IRAM1700_PRISMA_HORMIGON_RAA': Object.freeze({
    codigo: 'IRAM1700_PRISMA_HORMIGON_RAA',
    nombre: 'Reactividad álcali-agregado — prismas de hormigón',
    normaRef: 'IRAM 1700:1997',
    cita: 'IRAM 1700:1997 §B.3 — umbral 0,04% expansión a 12 meses (binario). CIRSOC 200:2024 Anexo A2-2 Tabla A2-2.2 — escalones R0..R3 (0,04 / 0,08 / 0,12 %). Prelación sobre IRAM 1674 cuando ambos están disponibles.',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { claseExposicion: ['Q3', 'Q4'] },
      { evaluacionRas: 'POTENCIALMENTE_REACTIVO' },
    ],
    bloqueante: true,
  }),
});

/* ════════════════════════════════════════════════════════════════════
   Aliases (mismo evaluador físico, mismo código de matriz)
   ════════════════════════════════════════════════════════════════════ */

const CODE_ALIASES = Object.freeze({
  // Sincronizado con `src/domain/compliance/required.js` CODE_ALIASES.
  // El catálogo BD vivo usa los códigos modernos (`IRAM1548_*`,
  // `IRAM1682_*`, `IRAM1532_LOS_ANGELES`); estos aliases redirigen al
  // canónico que está en la matriz prescriptiva, así PR9 prescriptivo
  // resuelve exigibilidad correctamente cuando consulta con el código
  // persistido (auditoría 01-calidad C4 — sesión 2026-05-07).
  'IRAM1548_PESO_UNITARIO': 'IRAM1531_PESO_UNITARIO',
  'IRAM1532_LOS_ANGELES': 'IRAM1532_DESGASTE_LA',
  // PR1.5: el código persistido por el catálogo de tipos de ensayo es
  // `IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA` (legacy, engañoso — IRAM 1700 NO
  // es método químico, es prismas de hormigón). El renombre del código
  // persistido se hace en sesión dedicada; por ahora, este alias asegura que
  // el motor prescriptivo encuentre la regla cuando consulta por el código
  // legacy.
  'IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA': 'IRAM1700_PRISMA_HORMIGON_RAA',
  'IRAM1874_1_RAP_PRISMA': 'IRAM1700_PRISMA_HORMIGON_RAA', // back-compat con la key vieja
});

/* ════════════════════════════════════════════════════════════════════
   Evaluación de predicados
   ════════════════════════════════════════════════════════════════════ */

/**
 * Evalúa una sola clave del predicado contra el contexto.
 * Retorna 'true', 'false' o 'unknown'.
 */
function _evalKey(actual, esperado) {
  if (actual === undefined || actual === null) return 'unknown';
  if (Array.isArray(esperado)) {
    return esperado.includes(actual) ? 'true' : 'false';
  }
  if (esperado && typeof esperado === 'object') {
    if ('gte' in esperado) return Number(actual) >= esperado.gte ? 'true' : 'false';
    if ('lte' in esperado) return Number(actual) <= esperado.lte ? 'true' : 'false';
    if ('eq'  in esperado) return actual === esperado.eq ? 'true' : 'false';
    if ('in'  in esperado && Array.isArray(esperado.in)) {
      return esperado.in.includes(actual) ? 'true' : 'false';
    }
    return 'false'; // operador no reconocido
  }
  return actual === esperado ? 'true' : 'false';
}

/**
 * Evalúa un predicado completo (AND entre sus claves) contra el contexto.
 * Retorna 'true' (todas matchean), 'false' (alguna no matchea aunque otras
 * sean unknown), o 'unknown' (todas las conocidas matchean pero hay unknowns).
 */
function _evalPredicado(predicado, contexto) {
  let huboUnknown = false;
  for (const [campo, esperado] of Object.entries(predicado)) {
    const r = _evalKey(contexto[campo], esperado);
    if (r === 'false') return 'false';
    if (r === 'unknown') huboUnknown = true;
  }
  return huboUnknown ? 'unknown' : 'true';
}

/* ════════════════════════════════════════════════════════════════════
   Getters públicos
   ════════════════════════════════════════════════════════════════════ */

/**
 * Devuelve la entrada cruda de la matriz para inspección/tests.
 */
function getEntrada(codigo) {
  if (!codigo) return undefined;
  const canonical = CODE_ALIASES[codigo] || codigo;
  return MATRIZ_PRESCRIPTIVA[canonical];
}

/**
 * Determina si un ensayo es exigible bajo el contexto provisto.
 *
 * @param {string} codigo - código IRAM/CIRSOC del ensayo.
 * @param {object} contexto - { tipoAgregado, claseExposicion, fceMpa,
 *                              tipoRoca, evaluacionRas, ... }
 * @returns {'required' | 'not_applicable' | 'unknown'}
 */
function esExigible(codigo, contexto = {}) {
  const entrada = getEntrada(codigo);
  if (!entrada) return 'unknown'; // código desconocido — caller decide

  // Filtro por tipo de agregado.
  if (Array.isArray(entrada.aplicaA) && entrada.aplicaA.length > 0) {
    if (contexto.tipoAgregado && !entrada.aplicaA.includes(contexto.tipoAgregado)) {
      return 'not_applicable';
    }
  }

  if (entrada.exigibleSiempre) return 'required';

  if (Array.isArray(entrada.exigibleCuando) && entrada.exigibleCuando.length > 0) {
    let huboUnknown = false;
    for (const pred of entrada.exigibleCuando) {
      const r = _evalPredicado(pred, contexto);
      if (r === 'true') return 'required';
      if (r === 'unknown') huboUnknown = true;
    }
    return huboUnknown ? 'unknown' : 'not_applicable';
  }

  return 'not_applicable';
}

/**
 * Devuelve la lista completa de ensayos exigibles bajo el contexto provisto,
 * con metadata enriquecida lista para consumir desde engines/PDFs.
 *
 * Política: por default trata 'unknown' como 'required' (regla conservadora —
 * preferimos falso positivo a falso negativo cuando la información contextual
 * es incompleta). El caller puede pasar `{ unknownComoRequired: false }` para
 * comportamiento estricto (sólo retorna los exigibles confirmados).
 *
 * @param {object} contexto - mismo shape que `esExigible`.
 * @param {object} [opciones]
 *   - unknownComoRequired: boolean (default true)
 * @returns {Array<{
 *   codigo, nombre, normaRef, cita, aplicaA, bloqueante, fuente: 'required'|'unknown'
 * }>}
 */
function obtenerEnsayosExigibles(contexto = {}, opciones = {}) {
  const unknownComoRequired = opciones.unknownComoRequired !== false; // default true

  const exigibles = [];
  for (const codigo of Object.keys(MATRIZ_PRESCRIPTIVA)) {
    const r = esExigible(codigo, contexto);
    if (r === 'required' || (r === 'unknown' && unknownComoRequired)) {
      const e = MATRIZ_PRESCRIPTIVA[codigo];
      exigibles.push({
        codigo: e.codigo,
        nombre: e.nombre,
        normaRef: e.normaRef,
        cita: e.cita,
        aplicaA: e.aplicaA,
        bloqueante: !!e.bloqueante,
        fuente: r, // 'required' | 'unknown' — útil para reportar incertidumbre
      });
    }
  }
  return exigibles;
}

/**
 * Versión por código: dado un código, devuelve su metadata enriquecida si es
 * exigible bajo el contexto, o null si no aplica.
 */
function metadataExigibilidad(codigo, contexto = {}) {
  const r = esExigible(codigo, contexto);
  if (r === 'not_applicable') return null;
  const e = getEntrada(codigo);
  if (!e) return null;
  return {
    codigo: e.codigo,
    nombre: e.nombre,
    normaRef: e.normaRef,
    cita: e.cita,
    aplicaA: e.aplicaA,
    bloqueante: !!e.bloqueante,
    fuente: r,
  };
}

/* ════════════════════════════════════════════════════════════════════
   REGLAS DE ACEPTACIÓN DE LOTE (CIRSOC 200-2024 §6.2)
   ════════════════════════════════════════════════════════════════════
   Reglas determinísticas para evaluar conformidad de un lote de hormigón
   estructural según el Modo de Producción de la planta. Son entidades
   distintas de los ensayos exigibles de la `MATRIZ_PRESCRIPTIVA` (que
   responde "¿qué ensayo aplica?"). Acá la pregunta es "¿el lote cumple
   los criterios numéricos?".

   Fuentes:
   - Modo 1 (planta con SGC) → §6.2.3 (criterios estadísticos sobre
     medias móviles + estimadores). Implementa §6.2.3.7 (estimadores),
     que es la variante por default. §6.2.3.6 y §6.2.3.8 quedan como
     roadmap.
   - Modo 2 (planta sin SGC) → §6.2.4.
   - Cambio automático Modo 1 ↔ Modo 2 → §6.2.2.2.

   Cada regla expone una función pura `calc(fc)` que devuelve el límite
   numérico aplicable. El engine consume estos límites; la SSoT de la
   norma vive acá. */

const REGLAS_ACEPTACION_LOTE = Object.freeze({

  MODO_1: Object.freeze({
    fuente: 'CIRSOC 200-2024 §6.2.3',

    // Fórmula (6-3): media móvil de 3 ensayos consecutivos
    mediaMovilMin: Object.freeze({
      cita: "CIRSOC 200-2024 §6.2.3.7 a) fórmula (6-3): f'cm,3 ≥ f'c",
      formula: "f'cm,3 ≥ f'c",
      calc: (fc) => fc,
    }),

    // Fórmulas (6-4) y (6-5): tolerancia individual por f'c
    individualMin: Object.freeze({
      cita: "CIRSOC 200-2024 §6.2.3.7 b) (6-4): f'ci ≥ f'c − 3,5 si f'c ≤ 35 MPa; c) (6-5): f'ci ≥ f'c − 0,10·f'c si f'c > 35 MPa",
      formula: "f'ci ≥ f'c − tol(f'c)",
      calc: (fc) => fc - (fc <= 35 ? 3.5 : 0.10 * fc),
    }),
  }),

  MODO_2: Object.freeze({
    fuente: 'CIRSOC 200-2024 §6.2.4',

    // Fórmula (6-7)
    mediaMovilMin: Object.freeze({
      cita: "CIRSOC 200-2024 §6.2.4 fórmula (6-7): f'cm,3 ≥ f'c + 5 MPa",
      formula: "f'cm,3 ≥ f'c + 5",
      calc: (fc) => fc + 5,
    }),

    // Fórmula (6-8)
    individualMin: Object.freeze({
      cita: "CIRSOC 200-2024 §6.2.4 fórmula (6-8): f'ci ≥ f'c",
      formula: "f'ci ≥ f'c",
      calc: (fc) => fc,
    }),
  }),

  CAMBIO_AUTOMATICO_MODO: Object.freeze({
    fuente: 'CIRSOC 200-2024 §6.2.2.2',
    cita: "CIRSOC 200-2024 §6.2.2.2: en Modo 1, ante un lote no conforme se debe pasar a Modo 2 hasta que cuatro lotes seguidos resulten conformes.",
    forzarModo2: 'al primer lote no conforme en Modo 1',
    volverAModo1: 'tras 4 lotes consecutivos conformes en Modo 2',
    rachaConformesVolverAModo1: 4,
  }),
});

module.exports = {
  MATRIZ_PRESCRIPTIVA,
  CODE_ALIASES,
  REGLAS_ACEPTACION_LOTE,
  getEntrada,
  esExigible,
  obtenerEnsayosExigibles,
  metadataExigibilidad,
  // Helpers expuestos para test:
  _evalKey,
  _evalPredicado,
};
