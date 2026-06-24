'use strict';

/**
 * Punto de entrada del módulo measurement.
 *
 * Uso típico:
 *   const { parse, adapt, convertMeasuredValue, asConservativeEstimate } = require('./domain/measurement');
 */

const MeasuredValue = require('./MeasuredValue');
const { parse } = require('./parser');
const units = require('./units');
const adapter = require('./adapter');

module.exports = {
  // Constructor + helpers
  create: MeasuredValue.create,
  notMeasured: MeasuredValue.notMeasured,
  hasValue: MeasuredValue.hasValue,
  asConservativeEstimate: MeasuredValue.asConservativeEstimate,
  VALID_QUALIFIERS: MeasuredValue.VALID_QUALIFIERS,

  // Parser
  parse,

  // Conversor de unidades
  convert: units.convert,
  convertMeasuredValue: units.convertMeasuredValue,
  areCompatible: units.areCompatible,
  UNITS: units.UNITS,

  // Adaptador legacy → nuevo
  adapt: adapter.adapt,
  adaptResultado: adapter.adaptResultado,
};
