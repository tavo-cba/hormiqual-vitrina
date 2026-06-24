'use strict';

/**
 * Constantes canónicas de `EstadoProbeta` (Bloque 6 auditoría 08, Mej-05).
 *
 * Antes: los IDs (1..5) se hardcodeaban como magic numbers a lo largo de
 * `probetaService.js` y `muestraService.js`. Si el seeder cambiaba o un
 * tenant tenía un seed distinto, los servicios fallaban silenciosamente
 * (probetas en estado equivocado).
 *
 * Decisión: estas constantes se consideran SSoT del dominio. El seeder
 * de la tabla `EstadoProbeta` debe alinear los registros con estos IDs
 * EXACTOS. El frontend tiene un mirror equivalente en
 * `hormiqual-frontend/src/lib/constants/estadoProbeta.js` — mantener
 * sincronizado.
 */

const ESTADO_PROBETA = Object.freeze({
  CURANDO:    1,
  PENDIENTE:  2,
  ENSAYADA:   3,
  DESCARTADA: 4,
  PERDIDA:    5,
});

const ESTADO_PROBETA_LABEL = Object.freeze({
  [ESTADO_PROBETA.CURANDO]:    'Curando',
  [ESTADO_PROBETA.PENDIENTE]:  'Pendiente',
  [ESTADO_PROBETA.ENSAYADA]:   'Ensayada',
  [ESTADO_PROBETA.DESCARTADA]: 'Descartada',
  [ESTADO_PROBETA.PERDIDA]:    'Perdida',
});

/**
 * Estados que NO permiten cargar un ensayo (la probeta no está disponible
 * o ya fue resuelta). Usado por `createEnsayoResistencia` para validar
 * que no se sobreescriban estados terminales sin querer (M-LOG-10).
 */
const ESTADOS_NO_ENSAYABLES = Object.freeze([
  ESTADO_PROBETA.DESCARTADA,
  ESTADO_PROBETA.PERDIDA,
]);

/**
 * Estados activos: la probeta sigue en pileta y eventualmente se rompe.
 */
const ESTADOS_ACTIVOS = Object.freeze([
  ESTADO_PROBETA.CURANDO,
  ESTADO_PROBETA.PENDIENTE,
]);

module.exports = {
  ESTADO_PROBETA,
  ESTADO_PROBETA_LABEL,
  ESTADOS_NO_ENSAYABLES,
  ESTADOS_ACTIVOS,
};
