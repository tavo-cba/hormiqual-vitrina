/**
 * Espejo del registro backend `src/domain/requisitosEnsayos.js` (P1.9).
 * Mantener ambas versiones sincronizadas. La fuente canónica es el backend.
 *
 * Define qué ensayos son obligatorios para un material según su contexto de
 * uso (tipo de agregado, exposición, resistencia, etc.). La policy de
 * emisión deniega el certificado si falta cualquiera.
 */

export const CODE = Object.freeze({
  GRANULOMETRIA:           'IRAM1505_GRANULOMETRIA',
  PASA_200:                'IRAM1674_MATERIAL_FINO_200',
  DENSIDAD_FINO:           'IRAM1520_DENSIDAD_ABSORCION_FINO',
  DENSIDAD_GRUESO:         'IRAM1533_DENSIDAD_GRUESO',
  TERRONES:                'IRAM1647_TERRONES_ARCILLA',
  SALES_SOLUBLES:          'IRAM1647_SALES_SOLUBLES',
  SULFATOS:                'IRAM1647_SULFATOS_SO3',
  CARBONOSAS:              'IRAM1647_MATERIAS_CARBONOSAS',
  CLORUROS:                'IRAM1882_CLORUROS_SOLUBLES',
  EQUIVALENTE_ARENA:       'IRAM1682_EQUIVALENTE_ARENA',
  LOS_ANGELES:             'IRAM1532_LOS_ANGELES',
  DURABILIDAD_SULFATO:     'IRAM1525_DURABILIDAD_SULFATO',
  PETROGRAFICO:            'IRAM1649_EXAMEN_PETROGRAFICO',
});

/**
 * Mirror del `ALIAS_MAP` del backend (`src/domain/ensayoResultRegistry.js`).
 * Cuando un ensayo se carga con un código variante (ej. el split
 * `_HORMIGON` / `_TBS` agregado por la migración 20260502d, o el alias
 * legacy `IRAM1532_DESGASTE_LA` ↔ `IRAM1532_LOS_ANGELES`), debemos
 * normalizar antes de comparar contra los `CODE.*` canónicos para evitar
 * que un ensayo presente se reporte como "faltante para el destino"
 * (bug X4 — auditoría `funcional-pdfs-reales.md` 2026-05-08).
 *
 * MANTENER SINCRONIZADO con el backend.
 */
export const ALIAS_MAP = Object.freeze({
  IRAM1505_GRANULOMETRIA_HORMIGON: CODE.GRANULOMETRIA,
  IRAM1505_GRANULOMETRIA_TBS:      CODE.GRANULOMETRIA,
  // El backend canoniza al revés (LOS_ANGELES → DESGASTE_LA); este mirror
  // canoniza ambos al canónico del frontend (LOS_ANGELES) para que
  // `getEnsayosFaltantes` reconozca el ensayo en cualquiera de las dos
  // formas. Esto es deuda de re-sync entre los dos catálogos.
  IRAM1532_DESGASTE_LA:            CODE.LOS_ANGELES,
  IRAM1512_DESGASTE_LA:            CODE.LOS_ANGELES,
});

/**
 * Normaliza un código de ensayo a su forma canónica usando `ALIAS_MAP`.
 * Si el código no es alias, se devuelve tal cual.
 */
export function getCanonicalCodigo(codigo) {
  if (!codigo) return codigo;
  return ALIAS_MAP[codigo] || codigo;
}

const CLASES_QUIMICAS_AGRESIVAS = new Set(['Q1', 'Q2', 'Q3']);

export function getEnsayosRequeridos(ctx = {}) {
  const tipo = (ctx.tipoAgregado || '').toUpperCase();
  if (tipo !== 'FINO' && tipo !== 'GRUESO') return [];

  const requeridos = [];
  const add = (codigo, motivo) => {
    if (!requeridos.find((r) => r.codigo === codigo)) requeridos.push({ codigo, motivo });
  };

  add(CODE.GRANULOMETRIA, 'Caracterización granulométrica del agregado (IRAM 1505).');
  add(CODE.PASA_200,      'Material fino que pasa tamiz #200 — incidencia en agua y dosificación (IRAM 1540).');

  if (tipo === 'FINO') {
    add(CODE.DENSIDAD_FINO,      'Densidad y absorción — base del cálculo de dosificación (IRAM 1520).');
    add(CODE.EQUIVALENTE_ARENA,  'Equivalente de arena — limpieza del fino (IRAM 1682).');
  } else {
    add(CODE.DENSIDAD_GRUESO,    'Densidad y absorción — base del cálculo de dosificación (IRAM 1533).');
  }

  add(CODE.TERRONES,       'Terrones de arcilla — componente de la suma de sustancias nocivas.');
  add(CODE.SALES_SOLUBLES, 'Sales solubles — componente de la suma de sustancias nocivas.');
  add(CODE.SULFATOS,       'Sulfatos (SO₃) — componente de la suma de sustancias nocivas y crítico para durabilidad.');
  add(CODE.CARBONOSAS,     'Materias carbonosas — componente de la suma de sustancias nocivas.');
  add(CODE.CLORUROS,       'Cloruros solubles — componente de la suma; crítico para corrosión de armaduras.');

  if (ctx.expuestoDesgaste === true && tipo === 'GRUESO') {
    add(CODE.LOS_ANGELES, 'Destino con desgaste superficial — IRAM 1512/1531 exige Los Ángeles ≤ 30%.');
  }

  if (CLASES_QUIMICAS_AGRESIVAS.has(ctx.claseExposicion)) {
    add(CODE.DURABILIDAD_SULFATO, `Clase de exposición ${ctx.claseExposicion} (ataque químico) — requiere ensayo de durabilidad por sulfato de sodio (IRAM 1525).`);
  }

  const fce = Number(ctx.fceMpa);
  if (Number.isFinite(fce) && fce >= 35) {
    add(CODE.PETROGRAFICO, `Hormigón H${Math.round(fce)} — se exige examen petrográfico para verificar mineralogía y descartar fases reactivas (IRAM 1649).`);
  }

  return requeridos;
}

export function getEnsayosFaltantes(ctx, presentCodes = []) {
  const requeridos = getEnsayosRequeridos(ctx);
  // X4 (2026-05-08): normalizar `presentCodes` a sus alias canónicos antes
  // de comparar. Sin esto, un ensayo cargado como
  // `IRAM1505_GRANULOMETRIA_HORMIGON` (código post-split) se reporta como
  // "faltante" pese a estar evaluado y APTO en la tabla del mismo informe.
  const presentes = new Set((presentCodes || []).map((c) => getCanonicalCodigo(c)));
  return requeridos.filter((r) => !presentes.has(r.codigo));
}

/**
 * Mapeo código canónico → nombre legible. Espejo de
 * `hormiqual-backend/src/domain/requisitosEnsayos.js`. Si los dos divergen,
 * los tests del frontend (helpers test) y del backend lo detectan.
 */
export const DISPLAY_NAME = Object.freeze({
  [CODE.GRANULOMETRIA]:        'Granulometría',
  [CODE.PASA_200]:             'Material fino #200',
  [CODE.DENSIDAD_FINO]:        'Densidad y absorción (fino)',
  [CODE.DENSIDAD_GRUESO]:      'Densidad y absorción (grueso)',
  [CODE.TERRONES]:             'Terrones de arcilla',
  [CODE.SALES_SOLUBLES]:       'Sales solubles',
  [CODE.SULFATOS]:             'Sulfatos (SO₃)',
  [CODE.CARBONOSAS]:           'Materias carbonosas',
  [CODE.CLORUROS]:             'Cloruros solubles',
  [CODE.EQUIVALENTE_ARENA]:    'Equivalente de arena',
  [CODE.LOS_ANGELES]:          'Los Ángeles',
  [CODE.DURABILIDAD_SULFATO]:  'Durabilidad por sulfato',
  [CODE.PETROGRAFICO]:         'Examen petrográfico',
});

/**
 * Nombre legible del código. Fallback defensivo: si no está mapeado, devuelve
 * el sufijo del código (sin prefijo IRAM) con underscores reemplazados por
 * espacios. La UI no debería mostrar `MATERIAL_FINO_200` crudo aunque alguien
 * sume un código nuevo y olvide actualizar el mapa.
 */
export function getDisplayName(codigo) {
  if (!codigo || typeof codigo !== 'string') return '';
  if (DISPLAY_NAME[codigo]) return DISPLAY_NAME[codigo];
  const stripped = codigo.replace(/^IRAM\d+_/, '').replace(/_/g, ' ').toLowerCase();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
