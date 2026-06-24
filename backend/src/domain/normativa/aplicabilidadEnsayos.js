'use strict';

/**
 * aplicabilidadEnsayos.js — Registry canónico de aplicabilidad por tipo de
 * agregado (FINO / GRUESO).
 *
 * El catálogo persistido (AgregadoEnsayoTipo) tiene un campo `aplicaA` que
 * declara a qué tipos de agregado aplica cada ensayo (`['FINO']`, `['GRUESO']`
 * o `['FINO','GRUESO']`). Sin embargo, en instalaciones viejas algunos tipos
 * quedaron con `aplicaA = NULL` porque el seed solo lo persiste cuando se
 * corre con `--reset` (`scripts/seed-ensayos-agregados.js`). Si el motor de
 * evaluación se basa exclusivamente en lo que llega de la BD, esos tipos
 * pasan el filtro y se siguen exigiendo en agregados del tipo equivocado
 * (caso reportado: IRAM 1520 fino apareciendo como pendiente en un grueso).
 *
 * Este registry es la **fuente única de verdad** para la aplicabilidad
 * normativa de los códigos conocidos. El motor lo consulta como fallback
 * cuando la BD no declara `aplicaA`. No reemplaza a la BD: si la BD declara
 * algo distinto y consistente, gana la BD.
 *
 * Los códigos listados acá deben coincidir con `seed-data/iram/
 * ensayos_agregados_tipos.json`. Mantener sincronizado.
 */

/** Mapa código → array de tipos de agregado donde aplica. */
const APLICABILIDAD = Object.freeze({
  // ── Sólo FINO ──
  'IRAM1520_DENSIDAD_ABSORCION_FINO': ['FINO'],
  'IRAM1682_EQUIVALENTE_ARENA':       ['FINO'],
  'IRAM1647_MATERIA_ORGANICA':        ['FINO'],

  // ── Sólo GRUESO ──
  'IRAM1533_DENSIDAD_GRUESO':         ['GRUESO'],
  'IRAM1532_LOS_ANGELES':             ['GRUESO'],
  'IRAM1687_1_LAJOSIDAD':             ['GRUESO'],
  'IRAM1687_2_ELONGACION':            ['GRUESO'],
  'IRAM1883_POLVO_ADHERIDO':          ['GRUESO'],
  'IRAM1644_PARTICULAS_BLANDAS':      ['GRUESO'],
  'IRAM1519_ESTABILIDAD_BASALTICAS':  ['GRUESO'],

  // ── FINO y GRUESO ──
  'IRAM1505_GRANULOMETRIA':           ['FINO', 'GRUESO'],
  'IRAM1505_GRANULOMETRIA_HORMIGON':  ['FINO', 'GRUESO'],
  'IRAM1674_MATERIAL_FINO_200':       ['FINO', 'GRUESO'],
  'IRAM1647_TERRONES_ARCILLA':        ['FINO', 'GRUESO'],
  'IRAM1647_SALES_SOLUBLES':          ['FINO', 'GRUESO'],
  'IRAM1647_SULFATOS_SO3':            ['FINO', 'GRUESO'],
  'IRAM1647_MATERIAS_CARBONOSAS':     ['FINO', 'GRUESO'],
  'IRAM1882_CLORUROS_SOLUBLES':       ['FINO', 'GRUESO'],
  'IRAM1525_DURABILIDAD_SULFATO':     ['FINO', 'GRUESO'],
  'IRAM1548_PESO_UNITARIO':           ['FINO', 'GRUESO'],
  'IRAM1649_EXAMEN_PETROGRAFICO':     ['FINO', 'GRUESO'],
});

/**
 * Devuelve el array de tipos de agregado canónico para un código, o null
 * si el código no está registrado. El motor usa esto como fallback cuando
 * la BD no declara `aplicaA` o lo declara vacío.
 */
function getAplicabilidadCanonica(codigo) {
  if (!codigo || typeof codigo !== 'string') return null;
  return APLICABILIDAD[codigo] || null;
}

/**
 * Determina si un código aplica a un tipo de agregado, usando el registry
 * canónico. Devuelve `null` si el código no está registrado (caller debe
 * decidir el default).
 */
function aplicaACanonico(codigo, tipoAgregado) {
  const lista = getAplicabilidadCanonica(codigo);
  if (!lista) return null;
  if (!tipoAgregado) return true;
  const target = String(tipoAgregado).toUpperCase();
  return lista.some((a) => String(a).toUpperCase() === target);
}

module.exports = {
  APLICABILIDAD,
  getAplicabilidadCanonica,
  aplicaACanonico,
};
