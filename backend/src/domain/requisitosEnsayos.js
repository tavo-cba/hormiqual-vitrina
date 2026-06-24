'use strict';

/**
 * Registro de ensayos REQUERIDOS por contexto de uso (P1.9).
 *
 * RAZÓN:
 * El sistema permitía emitir un Certificado de Cumplimiento aunque faltaran
 * ensayos críticos para el destino del material. Ej: una arena para hormigón
 * H30 con ataque químico (Q2) podía certificarse sin tener Durabilidad por
 * sulfatos ni Los Ángeles, simplemente porque "los ensayos cargados cumplían".
 *
 * Este módulo declara qué ensayos son OBLIGATORIOS para cada combinación de
 * contexto. La policy de emisión consume este registro y deniega el
 * certificado si falta cualquiera de los ensayos requeridos. Los faltantes
 * son distintos de los "no cumplen": ambos bloquean, pero el motivo es
 * diferente.
 *
 * Los criterios reflejan:
 *   - CIRSOC 200:2024 §3.x (durabilidad por clase de exposición)
 *   - IRAM 1512 / 1531 (requisitos por destino con/sin desgaste)
 *   - Práctica habitual de control de calidad en hormigón estructural
 *
 * Se priorizó cobertura conservadora: ante la duda, exigir el ensayo. Cada
 * organización puede agregar requisitos propios a futuro.
 */

/**
 * Códigos canónicos de los ensayos referenciados (deben coincidir con
 * AgregadoEnsayoTipo.codigo).
 */
const CODE = Object.freeze({
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
 * Clases de exposición consideradas "agresivas" para efectos químicos.
 * Coincide con el orden de niveles definido en mezclaCompliance.checkCondition.
 */
const CLASES_QUIMICAS_AGRESIVAS = new Set(['Q1', 'Q2', 'Q3']);

/**
 * Determina los ensayos requeridos para un material dado su contexto de uso.
 *
 * @param {Object} ctx
 * @param {('FINO'|'GRUESO')} ctx.tipoAgregado - obligatorio
 * @param {boolean} [ctx.expuestoDesgaste=false] - destino con desgaste superficial (pavimentos, pisos industriales)
 * @param {string}  [ctx.claseExposicion] - 'A1'|'A2'|'CL'|'C1'|'C2'|'M1'|'M2'|'Q1'|'Q2'|'Q3'
 * @param {number}  [ctx.fceMpa] - resistencia característica del hormigón a diseñar
 * @param {('PASIVA'|'ACTIVA'|null)} [ctx.tipoArmadura] - acero (activa = pretensado)
 * @returns {Array<{ codigo: string, motivo: string }>}
 */
function getEnsayosRequeridos(ctx = {}) {
  const tipo = (ctx.tipoAgregado || '').toUpperCase();
  if (tipo !== 'FINO' && tipo !== 'GRUESO') return [];

  const requeridos = [];
  const add = (codigo, motivo) => {
    if (!requeridos.find((r) => r.codigo === codigo)) requeridos.push({ codigo, motivo });
  };

  // ── Base universal para todo agregado destinado a hormigón estructural ──
  add(CODE.GRANULOMETRIA, 'Caracterización granulométrica del agregado (IRAM 1505).');
  add(CODE.PASA_200,      'Material fino que pasa tamiz #200 — incidencia en agua y dosificación (IRAM 1540).');

  if (tipo === 'FINO') {
    add(CODE.DENSIDAD_FINO,      'Densidad y absorción — base del cálculo de dosificación (IRAM 1520).');
    add(CODE.EQUIVALENTE_ARENA,  'Equivalente de arena — limpieza del fino (IRAM 1682).');
  } else {
    add(CODE.DENSIDAD_GRUESO,    'Densidad y absorción — base del cálculo de dosificación (IRAM 1533).');
  }

  // Sustancias nocivas (suma) — los 6 componentes son obligatorios para evaluar
  // el límite IRAM 1512/1531. Se exigen individualmente.
  add(CODE.TERRONES,       'Terrones de arcilla — componente de la suma de sustancias nocivas.');
  add(CODE.SALES_SOLUBLES, 'Sales solubles — componente de la suma de sustancias nocivas.');
  add(CODE.SULFATOS,       'Sulfatos (SO₃) — componente de la suma de sustancias nocivas y crítico para durabilidad.');
  add(CODE.CARBONOSAS,     'Materias carbonosas — componente de la suma de sustancias nocivas.');
  add(CODE.CLORUROS,       'Cloruros solubles — componente de la suma; crítico para corrosión de armaduras.');

  // ── Requisitos contextuales ──

  // 1) Desgaste superficial → Los Ángeles obligatorio (solo grueso lo controla)
  if (ctx.expuestoDesgaste === true && tipo === 'GRUESO') {
    add(CODE.LOS_ANGELES, 'Destino con desgaste superficial — IRAM 1512/1531 exige Los Ángeles ≤ 30%.');
  }

  // 2) Clase de exposición química agresiva → durabilidad por sulfatos
  if (CLASES_QUIMICAS_AGRESIVAS.has(ctx.claseExposicion)) {
    add(CODE.DURABILIDAD_SULFATO, `Clase de exposición ${ctx.claseExposicion} (ataque químico) — requiere ensayo de durabilidad por sulfato de sodio (IRAM 1525).`);
  }

  // 3) Hormigón de alta resistencia o pretensado → caracterización mineralógica
  const fce = Number(ctx.fceMpa);
  if (Number.isFinite(fce) && fce >= 35) {
    add(CODE.PETROGRAFICO, `Hormigón H${Math.round(fce)} — se exige examen petrográfico para verificar mineralogía y descartar fases reactivas (IRAM 1649).`);
  }

  // 4) Armadura activa (pretensado) → control estricto de cloruros (ya está
  //    incluido en base; acá podríamos exigir además vigencia más reciente, lo
  //    que se controla vía vigenciaEnsayos por separado).

  return requeridos;
}

/**
 * Detecta los ensayos REQUERIDOS que NO están presentes en una lista de
 * ensayos cargados. Un ensayo se considera "presente" si su código aparece
 * en `presentCodes`.
 *
 * @param {Object} ctx - mismo shape que getEnsayosRequeridos
 * @param {string[]} presentCodes - códigos de ensayos cargados (con o sin resultado válido)
 * @returns {Array<{ codigo, motivo }>}
 */
function getEnsayosFaltantes(ctx, presentCodes = []) {
  const requeridos = getEnsayosRequeridos(ctx);
  const presentes = new Set(presentCodes || []);
  return requeridos.filter((r) => !presentes.has(r.codigo));
}

/**
 * Mapeo código canónico → nombre legible para presentación (chips, PDFs,
 * mensajes de error). Source of truth: backend; frontend espeja en
 * `lib/compliance/requisitosEnsayos.js`.
 *
 * Si un código no está mapeado, `getDisplayName` aplica un fallback
 * heurístico (strip prefijo IRAM + reemplazo de underscores) para que la
 * UI no muestre `XYZ_ABC_DEF` crudo aunque el mapeo esté desactualizado.
 */
const DISPLAY_NAME = Object.freeze({
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
 * Devuelve el nombre legible para un código canónico. Si no hay mapeo,
 * cae a un display defensivo que tira el prefijo IRAM y reemplaza
 * underscores por espacios (mejor que mostrar `MATERIAL_FINO_200`).
 *
 * @param {string} codigo
 * @returns {string}
 */
function getDisplayName(codigo) {
  if (!codigo || typeof codigo !== 'string') return '';
  if (DISPLAY_NAME[codigo]) return DISPLAY_NAME[codigo];
  // Fallback: IRAM1505_GRANULOMETRIA → "Granulometria"
  const stripped = codigo.replace(/^IRAM\d+_/, '').replace(/_/g, ' ').toLowerCase();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

module.exports = {
  CODE,
  CLASES_QUIMICAS_AGRESIVAS,
  DISPLAY_NAME,
  getEnsayosRequeridos,
  getEnsayosFaltantes,
  getDisplayName,
};
