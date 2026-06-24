/**
 * Espejo del SSoT normativo del backend
 * (`hormiqual-backend/src/domain/normativa/matrizPrescriptiva.js`).
 *
 * MANTENER SINCRONIZADO. La fuente canónica es el backend; este mirror
 * existe para que el frontend pueda hacer evaluaciones prescriptivas
 * livianas sin round-trip al servidor (ej. dual display en cards).
 *
 * ESM con export named — funciones puras, sin React/axios/DOM.
 *
 * Si los tests cross-suite detectan divergencia (códigos, citas, predicados),
 * actualizar este archivo para resincronizar con el backend.
 */

/* ════════════════════════════════════════════════════════════════════
   MATRIZ
   ════════════════════════════════════════════════════════════════════ */

export const MATRIZ_PRESCRIPTIVA = Object.freeze({

  /* ─── Caracterización física ─── */

  IRAM1505_GRANULOMETRIA: Object.freeze({
    codigo: 'IRAM1505_GRANULOMETRIA',
    nombre: 'Granulometría',
    normaRef: 'IRAM 1505',
    cita: 'IRAM 1505 — Caracterización siempre exigible para diseño de mezclas',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1520_DENSIDAD_ABSORCION_FINO: Object.freeze({
    codigo: 'IRAM1520_DENSIDAD_ABSORCION_FINO',
    nombre: 'Densidad y absorción (fino)',
    normaRef: 'IRAM 1520',
    cita: 'IRAM 1520 — Base del cálculo de dosificación',
    aplicaA: ['FINO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1533_DENSIDAD_GRUESO: Object.freeze({
    codigo: 'IRAM1533_DENSIDAD_GRUESO',
    nombre: 'Densidad y absorción (grueso)',
    normaRef: 'IRAM 1533',
    cita: 'IRAM 1533 — Base del cálculo de dosificación',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1531_PESO_UNITARIO: Object.freeze({
    codigo: 'IRAM1531_PESO_UNITARIO',
    nombre: 'Peso unitario suelto',
    normaRef: 'IRAM 1548',
    cita: 'IRAM 1548 — Exigido para AG (≥ 1120 kg/m³ típico). Para AF es informativo',
    // aplicaA = a qué tipos es **exigible normativamente**. NO confundir con
    // `aplicabilidadEnsayos.js` (registry funcional). IRAM 1548 cubre AF y AG
    // metodológicamente, pero CIRSOC 200 solo lo exige para AG.
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: false,
  }),

  /* ─── Sustancias nocivas (siempre exigibles) ─── */

  IRAM1674_MATERIAL_FINO_200: Object.freeze({
    codigo: 'IRAM1674_MATERIAL_FINO_200',
    nombre: 'Material fino que pasa tamiz N.° 200',
    normaRef: 'IRAM 1540',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1647_TERRONES_ARCILLA: Object.freeze({
    codigo: 'IRAM1647_TERRONES_ARCILLA',
    nombre: 'Terrones de arcilla y partículas friables',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1647_SULFATOS_SO3: Object.freeze({
    codigo: 'IRAM1647_SULFATOS_SO3',
    nombre: 'Sulfatos (como SO₃)',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 / §3.2.4 Tabla 3.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1647_SALES_SOLUBLES: Object.freeze({
    codigo: 'IRAM1647_SALES_SOLUBLES',
    nombre: 'Sales solubles totales',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 / §3.2.4 Tabla 3.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1882_CLORUROS_SOLUBLES: Object.freeze({
    codigo: 'IRAM1882_CLORUROS_SOLUBLES',
    nombre: 'Cloruros solubles',
    normaRef: 'IRAM 1882',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / IRAM 1531 Tabla 1 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1647_MATERIA_ORGANICA: Object.freeze({
    codigo: 'IRAM1647_MATERIA_ORGANICA',
    nombre: 'Materia orgánica',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.4 — exigible para AF',
    aplicaA: ['FINO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1647_MATERIAS_CARBONOSAS: Object.freeze({
    codigo: 'IRAM1647_MATERIAS_CARBONOSAS',
    nombre: 'Materias carbonosas',
    normaRef: 'IRAM 1647',
    cita: 'CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (AF) / §3.2.4 Tabla 3.6 (AG)',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  /* ─── Forma y desgaste (grueso) ─── */

  IRAM1687_1_LAJOSIDAD: Object.freeze({
    codigo: 'IRAM1687_1_LAJOSIDAD',
    nombre: 'Lajosidad',
    normaRef: 'IRAM 1687-1',
    cita: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1687_2_ELONGACION: Object.freeze({
    codigo: 'IRAM1687_2_ELONGACION',
    nombre: 'Elongación',
    normaRef: 'IRAM 1687-2',
    cita: 'CIRSOC 200:2024 §3.2.4.6 Tabla 3.7',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1532_DESGASTE_LA: Object.freeze({
    codigo: 'IRAM1532_DESGASTE_LA',
    nombre: 'Desgaste Los Angeles',
    normaRef: 'IRAM 1532',
    cita: 'CIRSOC 200:2024 §3.2.4.5',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  IRAM1644_PARTICULAS_BLANDAS: Object.freeze({
    codigo: 'IRAM1644_PARTICULAS_BLANDAS',
    nombre: 'Partículas blandas',
    normaRef: 'IRAM 1644',
    cita: 'CIRSOC 200:2024 §3.2.4.1.b',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: true,
  }),

  // Equivalente de arena (IRAM 1682) eliminado de exigibilidad/bloqueante en
  // auditoría 01-calidad C21 (sesión 2026-05-07). IRAM 1682:1992 es método
  // para mezclas bituminosas y bases de pavimentos; ni CIRSOC 200:2024 ni
  // IRAM 1512:2006 lo exigen para AF en hormigón. Ver entrada equivalente
  // en backend para la nota completa.


  IRAM1883_POLVO_ADHERIDO: Object.freeze({
    codigo: 'IRAM1883_POLVO_ADHERIDO',
    nombre: 'Polvo adherido',
    normaRef: 'IRAM 1883',
    cita: 'IRAM 1883',
    aplicaA: ['GRUESO'],
    exigibleSiempre: true,
    bloqueante: false,
  }),

  /* ─── Durabilidad contextual ─── */

  IRAM1525_DURABILIDAD_SULFATO: Object.freeze({
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

  IRAM1519_ESTABILIDAD_BASALTICAS: Object.freeze({
    codigo: 'IRAM1519_ESTABILIDAD_BASALTICAS',
    nombre: 'Estabilidad de rocas basálticas (etilenglicol)',
    normaRef: 'IRAM 1519 / IRAM 1874-2',
    cita: 'IRAM 1519 — solo si origen basáltico',
    aplicaA: ['GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { tipoRoca: 'BASALTICA' },
    ],
    bloqueante: true,
  }),

  /* ─── RAS / Petrográfico ─── */

  IRAM1649_EXAMEN_PETROGRAFICO: Object.freeze({
    codigo: 'IRAM1649_EXAMEN_PETROGRAFICO',
    nombre: 'Examen petrográfico',
    normaRef: 'IRAM 1649',
    cita: 'CIRSOC 200:2024 §3.2.3.6',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { fceMpa: { gte: 35 } },
      { claseExposicion: ['C1', 'C2', 'Q1', 'Q2', 'Q3', 'Q4'] },
    ],
    bloqueante: false,
  }),

  IRAM1674_RAS_ACELERADO: Object.freeze({
    codigo: 'IRAM1674_RAS_ACELERADO',
    nombre: 'RAS acelerado (barra de mortero)',
    normaRef: 'IRAM 1674',
    cita: 'IRAM 1674 / IRAM 1512 §5.6.5',
    aplicaA: ['FINO', 'GRUESO'],
    exigibleSiempre: false,
    exigibleCuando: [
      { claseExposicion: ['Q3', 'Q4'] },
      { evaluacionRas: 'POTENCIALMENTE_REACTIVO' },
    ],
    bloqueante: true,
  }),

  // Sincronizado con backend (auditoría 01-calidad C19 sesión 2026-05-07): la key
  // canónica es `IRAM1700_PRISMA_HORMIGON_RAA` (no `IRAM1874_1_RAP_PRISMA` —
  // IRAM 1874-1 es congelación/deshielo, no RAS). El back-compat para callers
  // que aún consulten con la key vieja vive en CODE_ALIASES más abajo.
  IRAM1700_PRISMA_HORMIGON_RAA: Object.freeze({
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

// Aliases código catálogo → canónico de la matriz. Sincronizado con
// `hormiqual-backend/src/domain/normativa/matrizPrescriptiva.js` CODE_ALIASES
// (auditoría 01-calidad C4/C19 sesión 2026-05-07).
export const CODE_ALIASES = Object.freeze({
  'IRAM1548_PESO_UNITARIO': 'IRAM1531_PESO_UNITARIO',
  'IRAM1532_LOS_ANGELES': 'IRAM1532_DESGASTE_LA',
  // El catálogo BD persiste `IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA` (legacy y
  // engañoso — IRAM 1700 NO es método químico). Renombre del código persistido
  // se hace en sesión dedicada; este alias garantiza que el motor prescriptivo
  // resuelva la regla cuando llega con el código legacy.
  'IRAM1700_REACTIVIDAD_ALCALINA_QUIMICA': 'IRAM1700_PRISMA_HORMIGON_RAA',
  // Back-compat para callers que aún usen la key vieja del mirror.
  'IRAM1874_1_RAP_PRISMA': 'IRAM1700_PRISMA_HORMIGON_RAA',
});

/* ════════════════════════════════════════════════════════════════════
   Predicados (espejo backend)
   ════════════════════════════════════════════════════════════════════ */

function _evalKey(actual, esperado) {
  if (actual === undefined || actual === null) return 'unknown';
  if (Array.isArray(esperado)) return esperado.includes(actual) ? 'true' : 'false';
  if (esperado && typeof esperado === 'object') {
    if ('gte' in esperado) return Number(actual) >= esperado.gte ? 'true' : 'false';
    if ('lte' in esperado) return Number(actual) <= esperado.lte ? 'true' : 'false';
    if ('eq' in esperado) return actual === esperado.eq ? 'true' : 'false';
    if ('in' in esperado && Array.isArray(esperado.in)) return esperado.in.includes(actual) ? 'true' : 'false';
    return 'false';
  }
  return actual === esperado ? 'true' : 'false';
}

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

export function getEntrada(codigo) {
  if (!codigo) return undefined;
  const canonical = CODE_ALIASES[codigo] || codigo;
  return MATRIZ_PRESCRIPTIVA[canonical];
}

export function esExigible(codigo, contexto = {}) {
  const entrada = getEntrada(codigo);
  if (!entrada) return 'unknown';
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

export function obtenerEnsayosExigibles(contexto = {}, opciones = {}) {
  const unknownComoRequired = opciones.unknownComoRequired !== false;
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
        fuente: r,
      });
    }
  }
  return exigibles;
}

export function metadataExigibilidad(codigo, contexto = {}) {
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
