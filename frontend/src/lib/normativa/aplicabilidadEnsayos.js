/**
 * aplicabilidadEnsayos.js — Registry canónico de aplicabilidad por tipo de
 * agregado (FINO / GRUESO).
 *
 * Mirror exacto de `hormiqual-backend/src/domain/normativa/
 * aplicabilidadEnsayos.js`. La fuente canónica es el backend; mantener
 * sincronizado.
 *
 * Motivo: el catálogo persistido en BD puede tener `aplicaA = NULL` en
 * instalaciones viejas (el seed solo lo persiste con `--reset`). Si el
 * filtro del motor depende exclusivamente de la BD, los ensayos solo-FINO
 * pasan en agregados gruesos (caso reportado: IRAM 1520 fino apareciendo
 * como pendiente en un grueso 6-19 mm). Este registry tapa ese hueco.
 */

export const APLICABILIDAD = Object.freeze({
  // Sólo FINO
  'IRAM1520_DENSIDAD_ABSORCION_FINO': ['FINO'],
  'IRAM1682_EQUIVALENTE_ARENA':       ['FINO'],
  'IRAM1647_MATERIA_ORGANICA':        ['FINO'],

  // Sólo GRUESO
  'IRAM1533_DENSIDAD_GRUESO':         ['GRUESO'],
  'IRAM1532_LOS_ANGELES':             ['GRUESO'],
  'IRAM1687_1_LAJOSIDAD':             ['GRUESO'],
  'IRAM1687_2_ELONGACION':            ['GRUESO'],
  'IRAM1883_POLVO_ADHERIDO':          ['GRUESO'],
  'IRAM1644_PARTICULAS_BLANDAS':      ['GRUESO'],
  'IRAM1519_ESTABILIDAD_BASALTICAS':  ['GRUESO'],

  // FINO y GRUESO
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

export function getAplicabilidadCanonica(codigo) {
  if (!codigo || typeof codigo !== 'string') return null;
  return APLICABILIDAD[codigo] || null;
}

export function aplicaACanonico(codigo, tipoAgregado) {
  const lista = getAplicabilidadCanonica(codigo);
  if (!lista) return null;
  if (!tipoAgregado) return true;
  const target = String(tipoAgregado).toUpperCase();
  return lista.some((a) => String(a).toUpperCase() === target);
}
