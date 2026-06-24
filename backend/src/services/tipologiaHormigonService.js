'use strict';

/**
 * tipologiaHormigonService.js
 *
 * Las constantes Shilstone (`SHILSTONE_POR_TIPOLOGIA`, `SHILSTONE_ALIASES`)
 * y la función pura `getShilstoneConfig` viven en
 * `domain/dosificacion/shilstoneConfig` desde la auditoría 01-calidad Fase C
 * R2 (sesión 2026-05-07). Acá las re-exportamos para preservar el contrato
 * del service para callers existentes (tests `tipologiaHrdc.test.js`,
 * resto del service, etc.). Los callers nuevos en `domain/` deben importar
 * directamente del módulo de domain.
 */
const {
  SHILSTONE_POR_TIPOLOGIA,
  SHILSTONE_ALIASES,
  getShilstoneConfig,
} = require('../domain/dosificacion/shilstoneConfig');

/**
 * Default tipología configurations (used as fallback if DB is empty).
 */
const TIPOLOGIA_DEFAULTS = {
  convencional:     { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.500 },
  bombeable:        { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.450 },
  autocompactante:  { curvaFamilia: 'ANDREASEN_MOD', curvaExponente: 0.280 },
  masivo:           { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.550 },
  pavimento_rigido: { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.500 },
  proyectado:       { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.400 },
  alta_resistencia: { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.450 },
  arquitectonico:   { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.420 },
  rcc:              { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.550 },
  hrdc:             { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.500 },
  personalizado:    { curvaFamilia: 'FULLER_TALBOT', curvaExponente: 0.500 },
};

/** Get all active tipologías */
const listar = async (db) => {
  return db.TipologiaHormigon.findAll({
    where: { activa: true },
    order: [['orden', 'ASC'], ['nombre', 'ASC']],
  });
};

/** Get a single tipología by codigo */
const obtenerPorCodigo = async (db, codigo) => {
  const row = await db.TipologiaHormigon.findOne({ where: { codigo } });
  if (!row) {
    // Return defaults if predefined code is known
    const defaults = TIPOLOGIA_DEFAULTS[codigo];
    if (defaults) {
      return { codigo, ...defaults, restriccionesGranulometricas: {}, restriccionesDosificacion: {} };
    }
    return null;
  }
  return row;
};

/** Get a single tipología by id */
const obtener = async (db, id) => {
  return db.TipologiaHormigon.findByPk(id);
};

/** Create a new tipología */
const crear = async (db, data) => {
  return db.TipologiaHormigon.create({
    codigo: data.codigo,
    nombre: data.nombre,
    descripcion: data.descripcion || null,
    curvaFamilia: data.curvaFamilia || 'FULLER_TALBOT',
    curvaExponente: data.curvaExponente != null ? data.curvaExponente : 0.500,
    restriccionesGranulometricas: data.restriccionesGranulometricas || {},
    restriccionesDosificacion: data.restriccionesDosificacion || {},
    esPredefinida: false,
    orden: data.orden || 50,
  });
};

/** Update a tipología */
const actualizar = async (db, id, data) => {
  const row = await db.TipologiaHormigon.findByPk(id);
  if (!row) throw Object.assign(new Error('Tipología no encontrada'), { status: 404 });

  const updates = {};
  if (data.nombre != null) updates.nombre = data.nombre;
  if (data.descripcion !== undefined) updates.descripcion = data.descripcion;
  if (data.curvaFamilia != null) updates.curvaFamilia = data.curvaFamilia;
  if (data.curvaExponente != null) updates.curvaExponente = data.curvaExponente;
  if (data.restriccionesGranulometricas !== undefined) updates.restriccionesGranulometricas = data.restriccionesGranulometricas;
  if (data.restriccionesDosificacion !== undefined) updates.restriccionesDosificacion = data.restriccionesDosificacion;
  if (data.orden != null) updates.orden = data.orden;
  if (data.activa != null) updates.activa = data.activa;
  // codigo and esPredefinida are not updatable

  await row.update(updates);
  return row;
};

/** Delete a tipología (only non-predefined) */
const eliminar = async (db, id) => {
  const row = await db.TipologiaHormigon.findByPk(id);
  if (!row) throw Object.assign(new Error('Tipología no encontrada'), { status: 404 });
  if (row.esPredefinida) throw Object.assign(new Error('No se pueden eliminar tipologías predefinidas.'), { status: 422 });

  await row.destroy();
  return { ok: true, message: 'Tipología eliminada.' };
};

/** Reset a predefined tipología to its defaults */
const restaurarDefaults = async (db, id) => {
  const row = await db.TipologiaHormigon.findByPk(id);
  if (!row) throw Object.assign(new Error('Tipología no encontrada'), { status: 404 });

  const defaults = TIPOLOGIA_DEFAULTS[row.codigo];
  if (!defaults) throw Object.assign(new Error('No hay valores por defecto para esta tipología.'), { status: 422 });

  // Re-seed from defaults — we keep the simple curve params, reset restrictions
  await row.update({
    curvaFamilia: defaults.curvaFamilia,
    curvaExponente: defaults.curvaExponente,
  });
  return row;
};

module.exports = {
  TIPOLOGIA_DEFAULTS,
  SHILSTONE_POR_TIPOLOGIA,
  getShilstoneConfig,
  listar,
  obtenerPorCodigo,
  obtener,
  crear,
  actualizar,
  eliminar,
  restaurarDefaults,
};
