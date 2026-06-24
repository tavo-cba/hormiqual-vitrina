'use strict';

const { getTamizAbertura } = require('../catalog/tamicesCatalog');
const {
  sanitizeCurvaPayload,
  validatePuntosBySpecMode,
  ValidationError,
} = require('../helpers/curvaValidation');

/* ═══════════════════════════════════════════════════════════
   Export / Import de curvas granulométricas (JSON)
   ═══════════════════════════════════════════════════════════ */

const EXPORT_VERSION = '1.0';

/**
 * Campos de CurvaGranulometrica que se exportan.
 */
const CURVA_FIELDS = [
  'nombre', 'tipo', 'specMode', 'serieTamices', 'uso', 'tmnMm',
  'curveLetter', 'origenDatos', 'estadoDatos', 'normaRef',
  'parametros', 'metadata', 'isDefault', 'isActive', 'version',
];

/**
 * Campos de CurvaPunto que se exportan.
 */
const PUNTO_FIELDS = [
  'tamiz', 'aberturaMm', 'pasaPct', 'limInfPct', 'limSupPct',
  'targetPct', 'isNA', 'orden',
];

/* ── Lookup de tamiz → aberturaMm (delegado al catálogo) ── */
const TAMIZ_ABERTURA = getTamizAbertura();

/**
 * Exporta curvas seleccionadas a un objeto JSON portable.
 *
 * @param {Object} db — Sequelize database connection (tenant)
 * @param {number[]} ids — IDs de curvas a exportar. Si vacío, exporta todas.
 * @returns {Object} JSON payload listo para descargar
 */
async function exportCurvasToJson(db, ids) {
  const where = {};
  if (ids && ids.length > 0) {
    const { Op } = require('sequelize');
    where.idCurva = { [Op.in]: ids.map(Number) };
  }

  const curvas = await db.CurvaGranulometrica.findAll({
    where,
    include: [
      { model: db.CurvaPunto, as: 'puntos', order: [['orden', 'ASC']] },
    ],
    order: [['nombre', 'ASC']],
  });

  const exported = curvas.map(c => {
    const plain = c.get({ plain: true });
    const obj = {};
    for (const f of CURVA_FIELDS) {
      obj[f] = plain[f] ?? null;
    }
    obj.puntos = (plain.puntos || []).map(p => {
      const pt = {};
      for (const f of PUNTO_FIELDS) {
        pt[f] = p[f] ?? null;
      }
      return pt;
    });
    return obj;
  });

  return {
    _format: 'hormiqual-curvas',
    _version: EXPORT_VERSION,
    _exportedAt: new Date().toISOString(),
    _count: exported.length,
    curvas: exported,
  };
}

/**
 * Importa curvas desde un JSON exportado.
 *
 * @param {Object} db — Sequelize database connection (tenant)
 * @param {Object} payload — JSON importado
 * @param {Object} options
 * @param {boolean} [options.reset=false] — Si true, borra curvas existentes con la misma normaRef
 * @param {string}  [options.normaRef] — Filtro para reset (solo borra curvas con esa normaRef)
 * @param {Function} [options.onLog] — Callback (level, msg)
 * @returns {Object} { curvasCreated, curvasUpdated, pointsCreated, errors }
 */
async function importCurvasFromJson(db, payload, options = {}) {
  const { reset = false, normaRef, onLog = () => {} } = options;

  // Validar formato
  if (!payload || !Array.isArray(payload.curvas)) {
    throw new ValidationError('El JSON no tiene el formato esperado. Se requiere { curvas: [...] }');
  }

  const stats = {
    curvasCreated: 0,
    curvasUpdated: 0,
    pointsCreated: 0,
    errors: [],
  };

  // Reset: borrar curvas existentes con la normaRef indicada
  if (reset && normaRef) {
    onLog('warn', `Reset: eliminando curvas con normaRef="${normaRef}"...`);
    const existing = await db.CurvaGranulometrica.findAll({
      where: { normaRef },
      attributes: ['idCurva'],
    });
    const idsToDelete = existing.map(c => c.idCurva);
    if (idsToDelete.length > 0) {
      await db.CurvaPunto.destroy({ where: { idCurva: idsToDelete } });
      await db.CurvaGranulometrica.destroy({ where: { idCurva: idsToDelete } });
      onLog('info', `Reset: ${idsToDelete.length} curvas eliminadas`);
    }
  }

  for (let i = 0; i < payload.curvas.length; i++) {
    const curvaData = payload.curvas[i];
    const label = curvaData.nombre || `curva[${i}]`;
    try {
      // Normalizar aberturaMm desde tamiz si falta
      if (Array.isArray(curvaData.puntos)) {
        for (const p of curvaData.puntos) {
          if (p.aberturaMm == null && p.tamiz) {
            const key = p.tamiz.toLowerCase().trim();
            if (TAMIZ_ABERTURA[key] != null) {
              p.aberturaMm = TAMIZ_ABERTURA[key];
            }
          }
        }
      }

      // Sanitize
      sanitizeCurvaPayload(curvaData);

      // Validate puntos
      if (curvaData.tipo !== 'TEORICA' && Array.isArray(curvaData.puntos) && curvaData.puntos.length > 0) {
        validatePuntosBySpecMode(curvaData.specMode || 'RANGO', curvaData.puntos);
      }

      // Check if curve with same name already exists → update
      const existing = await db.CurvaGranulometrica.findOne({
        where: { nombre: curvaData.nombre },
      });

      const t = await db.sequelize.transaction();
      try {
        if (existing) {
          // Update existing
          const updateFields = {};
          for (const f of CURVA_FIELDS) {
            if (f !== 'nombre' && curvaData[f] !== undefined) {
              updateFields[f] = curvaData[f];
            }
          }
          await existing.update(updateFields, { transaction: t });

          // Replace puntos
          await db.CurvaPunto.destroy({ where: { idCurva: existing.idCurva }, transaction: t });
          if (curvaData.puntos && curvaData.puntos.length > 0) {
            const puntos = curvaData.puntos.map((p, j) => ({
              idCurva: existing.idCurva,
              tamiz: p.tamiz,
              aberturaMm: p.aberturaMm ?? null,
              pasaPct: p.pasaPct ?? null,
              limInfPct: p.limInfPct ?? null,
              limSupPct: p.limSupPct ?? null,
              targetPct: p.targetPct ?? null,
              isNA: p.isNA === true,
              orden: p.orden ?? j,
            }));
            await db.CurvaPunto.bulkCreate(puntos, { transaction: t });
            stats.pointsCreated += puntos.length;
          }

          await t.commit();
          stats.curvasUpdated++;
          onLog('info', `Actualizada: "${label}"`);
        } else {
          // Create new
          const curva = await db.CurvaGranulometrica.create({
            nombre: curvaData.nombre,
            tipo: curvaData.tipo || 'BANDA',
            specMode: curvaData.specMode || 'RANGO',
            serieTamices: curvaData.serieTamices || 'IRAM',
            uso: curvaData.uso || null,
            tmnMm: curvaData.tmnMm ?? null,
            curveLetter: curvaData.curveLetter || null,
            origenDatos: curvaData.origenDatos || null,
            estadoDatos: curvaData.estadoDatos || 'COMPLETO',
            normaRef: curvaData.normaRef || null,
            parametros: curvaData.parametros || null,
            metadata: curvaData.metadata || null,
            isDefault: curvaData.isDefault || false,
            isActive: curvaData.isActive !== false,
            version: curvaData.version || '1.0',
          }, { transaction: t });

          if (curvaData.puntos && curvaData.puntos.length > 0) {
            const puntos = curvaData.puntos.map((p, j) => ({
              idCurva: curva.idCurva,
              tamiz: p.tamiz,
              aberturaMm: p.aberturaMm ?? null,
              pasaPct: p.pasaPct ?? null,
              limInfPct: p.limInfPct ?? null,
              limSupPct: p.limSupPct ?? null,
              targetPct: p.targetPct ?? null,
              isNA: p.isNA === true,
              orden: p.orden ?? j,
            }));
            await db.CurvaPunto.bulkCreate(puntos, { transaction: t });
            stats.pointsCreated += puntos.length;
          }

          await t.commit();
          stats.curvasCreated++;
          onLog('ok', `Creada: "${label}"`);
        }
      } catch (err) {
        await t.rollback();
        throw err;
      }
    } catch (err) {
      const msg = `Error en "${label}": ${err.message}`;
      stats.errors.push(msg);
      onLog('error', msg);
    }
  }

  return stats;
}

module.exports = {
  exportCurvasToJson,
  importCurvasFromJson,
};
